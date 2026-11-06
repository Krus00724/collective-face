import type { FigureId } from '../data/figures';
import { debug } from '../debug';
import type { Family } from '../sculpture/family';
import { onLeave, useStore } from '../store';
import type { DbLike, DocLike } from './persistence';
import { hashCode, remote } from './remote';

/**
 * Voice messages of up to 10 seconds. A recording is reduced to 16 kHz mono and packed as 8 bit
 * mu-law, so one message is about 210 KB and fits in a single database document. Nothing is heard
 * by anyone until the artist approves it. Pending messages live where only the artist can read them.
 */
export const MAX_SECONDS = 10;
const RATE = 16000;

export interface VoiceRef { id: string; figure: FigureId; t: number }
export interface PendingVoice extends VoiceRef { from: string; data: string }
export interface RemovalRequest { from: string; id: string; t: number }

export class VoiceProblem extends Error {}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8190) s += String.fromCharCode(...bytes.subarray(i, i + 8190));
  return btoa(s);
};
const unb64 = (text: string) => {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const MU = 255;
function encode(pcm: Float32Array) {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    const y = (Math.sign(x) * Math.log1p(MU * Math.abs(x))) / Math.log1p(MU);
    out[i] = Math.round((y + 1) * 127.5);
  }
  return out;
}
function decode(bytes: Uint8Array) {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const y = bytes[i] / 127.5 - 1;
    out[i] = (Math.sign(y) * (Math.pow(1 + MU, Math.abs(y)) - 1)) / MU;
  }
  return out;
}

/** Any sound or video file the browser can read becomes a clean, level mono message. */
export async function prepare(blob: Blob): Promise<{ data: string; seconds: number }> {
  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(raw);
  } catch {
    throw new VoiceProblem('This file could not be read. Try a voice memo or an MP3.');
  } finally {
    ctx.close();
  }
  if (audio.duration > MAX_SECONDS + 0.3) {
    throw new VoiceProblem(`This recording is ${Math.ceil(audio.duration)} seconds long. The limit is ${MAX_SECONDS}.`);
  }
  const length = Math.ceil(audio.duration * RATE);
  const off = new OfflineAudioContext(1, length, RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak < 0.005) throw new VoiceProblem('This recording is silent. Try again.');
  const gain = 0.92 / peak;
  const level = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) level[i] = mono[i] * gain;
  return { data: b64(encode(level)), seconds: audio.duration };
}

export interface VoiceStore {
  send(figure: FigureId, id: string, data: string, code: string): Promise<void>;
  cancelPending(): Promise<void>;
  requestRemoval(id: string): Promise<void>;
  audio(id: string): Promise<string | null>;
  approve(p: PendingVoice): Promise<void>;
  reject(p: PendingVoice): Promise<void>;
  remove(id: string): Promise<void>;
  clearRemoval(r: RemovalRequest): Promise<void>;
  listen(): void;
}

const isFigure = (v: unknown): v is FigureId => v === 'mother' || v === 'father' || v === 'child';
const toRef = (d: DocLike): VoiceRef | null => {
  const v = d.data();
  return v && isFigure(v.figure) && typeof v.t === 'number' ? { id: d.id, figure: v.figure, t: v.t } : null;
};
function publishRefs(list: VoiceRef[]) {
  const voices: Record<FigureId, VoiceRef[]> = { mother: [], father: [], child: [] };
  for (const r of list) voices[r.figure].push(r);
  useStore.getState().set({ voices });
}

class SharedVoices implements VoiceStore {
  constructor(private db: DbLike, private me: string, private owner: boolean) {}
  private c(name: string) { return this.db.collection(name); }
  /** One waiting message per person: it keeps the queue honest and short. */
  async send(figure: FigureId, id: string, data: string) {
    await this.c('inbox').doc(this.me).set({ id, figure, t: Date.now(), data });
  }
  async cancelPending() { await this.c('inbox').doc(this.me).delete(); }
  async requestRemoval(id: string) { await this.c('removals').doc(this.me).set({ id, t: Date.now() }); }
  async audio(id: string) {
    const d = await this.c('voiceAudio').doc(id).get();
    const v = d.data();
    return typeof v?.data === 'string' ? v.data : null;
  }
  async approve(p: PendingVoice) {
    await this.c('voiceAudio').doc(p.id).set({ data: p.data });
    await this.c('voices').doc(p.id).set({ figure: p.figure, t: p.t });
    await this.c('inbox').doc(p.from).delete();
  }
  async reject(p: PendingVoice) { await this.c('inbox').doc(p.from).delete(); }
  async remove(id: string) {
    await this.c('voices').doc(id).delete();
    await this.c('voiceAudio').doc(id).delete();
  }
  async clearRemoval(r: RemovalRequest) { await this.c('removals').doc(r.from).delete(); }
  listen() {
    this.c('voices').onSnapshot((s) => publishRefs(s.docs.map(toRef).filter((r): r is VoiceRef => !!r)));
    if (!this.owner) return;
    this.c('inbox').onSnapshot((s) => {
      const pending: PendingVoice[] = [];
      for (const d of s.docs) {
        const v = d.data();
        if (v && isFigure(v.figure) && typeof v.data === 'string' && typeof v.id === 'string' && typeof v.t === 'number') {
          pending.push({ from: d.id, id: v.id, figure: v.figure, t: v.t, data: v.data });
        }
      }
      useStore.getState().set({ pending: pending.sort((a, b) => a.t - b.t) });
    });
    this.c('removals').onSnapshot((s) => {
      const removals: RemovalRequest[] = [];
      for (const d of s.docs) {
        const v = d.data();
        if (v && typeof v.id === 'string' && typeof v.t === 'number') removals.push({ from: d.id, id: v.id, t: v.t });
      }
      useStore.getState().set({ removals });
    });
  }
}

/** The public site: anyone can leave a message, only the artist can read what waits. */
class RemoteVoices implements VoiceStore {
  private refs = async () => {
    const { data } = await remote!.from('voices').select('id, figure, t');
    if (data) publishRefs(data.filter((r) => isFigure(r.figure)) as VoiceRef[]);
  };
  private inbox = async () => {
    if (!useStore.getState().owner) { useStore.getState().set({ pending: [] }); return; }
    const { data } = await remote!.from('voice_inbox').select('id, figure, t, data').order('t');
    if (data) useStore.getState().set({ pending: data.filter((r) => isFigure(r.figure)).map((r) => ({ ...r, from: 'visitor' })) as PendingVoice[] });
  };
  async send(figure: FigureId, id: string, data: string, code: string) {
    const { error } = await remote!.from('voice_inbox').insert({ id, figure, t: Date.now(), data, code_hash: await hashCode(code) });
    if (error) throw error;
  }
  async cancelPending() {}
  async requestRemoval() {}
  async audio(id: string) {
    const { data } = await remote!.from('voices').select('data').eq('id', id).maybeSingle();
    return data?.data ?? null;
  }
  async approve(p: PendingVoice) {
    const { error } = await remote!.rpc('approve_voice', { voice: p.id });
    if (error) throw error;
    await Promise.all([this.refs(), this.inbox()]);
  }
  async reject(p: PendingVoice) {
    const { error } = await remote!.from('voice_inbox').delete().eq('id', p.id);
    if (error) throw error;
    await this.inbox();
  }
  async remove(id: string) {
    const { error } = await remote!.from('voices').delete().eq('id', id);
    if (error) throw error;
    await this.refs();
  }
  async clearRemoval() {}
  listen() {
    this.refs();
    this.inbox();
    useStore.subscribe((s, before) => { if (s.owner !== before.owner) this.inbox(); });
    setInterval(() => { if (!document.hidden) { this.refs(); this.inbox(); } }, 60000);
  }
}

/** Only for the headless walkthrough: the same flow, kept in memory. */
class TestVoices implements VoiceStore {
  private inbox: PendingVoice[] = [];
  private refs: VoiceRef[] = [];
  private audioById = new Map<string, string>();
  private push() {
    publishRefs(this.refs);
    useStore.getState().set({ pending: [...this.inbox] });
  }
  async send(figure: FigureId, id: string, data: string) { this.inbox = [{ from: 'me', id, figure, t: Date.now(), data }]; this.push(); }
  async cancelPending() { this.inbox = []; this.push(); }
  async requestRemoval(id: string) { useStore.getState().set({ removals: [{ from: 'me', id, t: Date.now() }] }); }
  async audio(id: string) { return this.audioById.get(id) ?? null; }
  async approve(p: PendingVoice) {
    this.audioById.set(p.id, p.data);
    this.refs.push({ id: p.id, figure: p.figure, t: p.t });
    this.inbox = this.inbox.filter((x) => x.id !== p.id);
    this.push();
  }
  async reject(p: PendingVoice) { this.inbox = this.inbox.filter((x) => x.id !== p.id); this.push(); }
  async remove(id: string) { this.refs = this.refs.filter((r) => r.id !== id); this.audioById.delete(id); this.push(); }
  async clearRemoval() { useStore.getState().set({ removals: [] }); }
  listen() {}
}

type User = { id(): Promise<string | null>; isOwner(): Promise<boolean> };

export async function connectVoices(db: DbLike | null): Promise<VoiceStore | null> {
  if (debug.on) {
    useStore.getState().set({ owner: true, canSend: true });
    return new TestVoices();
  }
  if (remote) {
    useStore.getState().set({ canSend: true });
    return new RemoteVoices();
  }
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!db || !claude?.use) return null;
  const user = (await claude.use('user').catch(() => null)) as User | null;
  const me = (await user?.id().catch(() => null)) ?? null;
  const owner = (await user?.isOwner().catch(() => false)) ?? false;
  if (!me) return null;
  useStore.getState().set({ owner, canSend: true });
  return new SharedVoices(db, me, owner);
}

/** Plays messages, and makes a bust speak them. */
class Hub {
  store: VoiceStore | null = null;
  family: Family | null = null;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wave = new Float32Array(1024);
  private bag: Record<FigureId, string[]> = { mother: [], father: [], child: [] };

  private level = () => {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.wave);
    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) sum += this.wave[i] * this.wave[i];
    return Math.min(1, Math.sqrt(sum / this.wave.length) * 4.2);
  };

  stop() {
    this.source?.stop();
    this.source = null;
    const s = useStore.getState();
    if (s.speaking) {
      this.family?.silence(s.speaking);
      s.set({ speaking: null });
    }
  }

  private unlock() {
    this.ctx ??= new AudioContext();
    this.ctx.resume();
    return this.ctx;
  }

  private start(data: string, figure: FigureId | null) {
    const ctx = this.unlock();
    const pcm = decode(unb64(data));
    const buffer = ctx.createBuffer(1, pcm.length, RATE);
    buffer.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    src.onended = () => { if (this.source === src) this.stop(); };
    this.source = src;
    if (figure) {
      this.family?.speak(figure, this.level);
      useStore.getState().set({ speaking: figure });
    }
    src.start();
  }

  /** A random approved message, never the same one twice until all have played. */
  async playRandom(figure: FigureId) {
    const ctx = this.unlock(); // inside the tap, or the browser keeps it silent
    void ctx;
    this.stop();
    const refs = useStore.getState().voices[figure];
    if (!refs.length || !this.store) return;
    if (!this.bag[figure].length) this.bag[figure] = refs.map((r) => r.id).sort(() => Math.random() - 0.5);
    const id = this.bag[figure].pop()!;
    const data = await this.store.audio(id);
    if (data) this.start(data, figure);
  }

  preview(data: string) {
    this.unlock();
    this.stop();
    this.start(data, null);
  }
}

export const voiceHub = new Hub();
onLeave(() => voiceHub.stop());
