import type { Contribution } from '../data/sampleHistory';
import type { FigureId } from '../data/figures';
import { hashCode, remote } from './remote';

/**
 * Where contributions live. Everything else in the app talks to this interface, so a real
 * backend replaces it without touching the sculpture code. What is stored is deliberately
 * small: an id, the figure, a seed, a strength, a time. Never an image or face data.
 */
export interface ContributionStore {
  mode: 'shared' | 'local';
  add(c: Contribution, code: string): Promise<void>;
  remove(id: string): Promise<void>;
  subscribe(cb: (live: Contribution[]) => void): () => void;
  /** Look again now, instead of at the next regular look. */
  refresh?(): void;
}

const KEY = 'afmos.contributions.v1';
const MINE = 'afmos.mine.v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: this visit only */ }
}

class LocalStore implements ContributionStore {
  mode = 'local' as const;
  private items = readJson<Contribution[]>(KEY, []);
  private listeners = new Set<(l: Contribution[]) => void>();
  private emit() {
    writeJson(KEY, this.items);
    this.listeners.forEach((l) => l(this.items));
  }
  async add(c: Contribution) { this.items = [...this.items, c]; this.emit(); }
  async remove(id: string) { this.items = this.items.filter((c) => c.id !== id); this.emit(); }
  subscribe(cb: (l: Contribution[]) => void) {
    this.listeners.add(cb);
    cb(this.items);
    return () => { this.listeners.delete(cb); };
  }
}

export interface DocLike { id: string; exists?: boolean; data(): Record<string, unknown> | undefined }
export interface DbLike {
  collection(path: string): {
    doc(id?: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; get(): Promise<DocLike> };
    onSnapshot(next: (s: { docs: DocLike[] }) => void, error?: (e: unknown) => void): () => void;
  };
}

const isFigure = (v: unknown): v is FigureId => v === 'mother' || v === 'father' || v === 'child';

/**
 * Shared across viewers through the artifact database when this view allows it. A viewer
 * without write access still keeps their contribution, in this browser, through the fallback.
 */
class ArtifactStore implements ContributionStore {
  mode = 'shared' as const;
  private fallback = new LocalStore();
  private shared: Contribution[] = [];
  private local: Contribution[] = [];
  constructor(private db: DbLike) {}
  async add(c: Contribution) {
    try {
      await this.db.collection('contributions').doc(c.id).set({ figure: c.figure, seed: c.seed, strength: c.strength ?? 1, t: c.t });
    } catch {
      await this.fallback.add(c);
    }
  }
  async remove(id: string) {
    await this.fallback.remove(id);
    await this.db.collection('contributions').doc(id).delete().catch(() => undefined);
  }
  subscribe(cb: (l: Contribution[]) => void) {
    const emit = () => cb([...this.shared, ...this.local.filter((c) => !this.shared.some((s) => s.id === c.id))]);
    const offLocal = this.fallback.subscribe((l) => { this.local = l; emit(); });
    const offShared = this.db.collection('contributions').onSnapshot((snap) => {
      const list: Contribution[] = [];
      for (const d of snap.docs) {
        const v = d.data();
        if (!v || !isFigure(v.figure) || typeof v.seed !== 'number' || typeof v.t !== 'number') continue;
        list.push({ id: d.id, figure: v.figure, seed: v.seed, t: v.t, strength: typeof v.strength === 'number' ? Math.min(1.3, Math.max(0.5, v.strength)) : 1 });
      }
      this.shared = list;
      emit();
    });
    return () => { offLocal(); offShared(); };
  }
}

type Claude = { use?: (n: string) => Promise<unknown> };

/** The artifact database, or null when this view has none (signed out, or outside the viewer). */
export async function openDb(): Promise<DbLike | null> {
  const claude = (window as unknown as { claude?: Claude }).claude;
  if (!claude?.use) return null;
  try {
    return (await claude.use('db')) as DbLike | null;
  } catch {
    return null;
  }
}

/** The public site: every visitor reads the same log, and looks again every half minute. */
class RemoteStore implements ContributionStore {
  mode = 'shared' as const;
  private fallback = new LocalStore();
  private shared: Contribution[] = [];
  private local: Contribution[] = [];
  private cb: (l: Contribution[]) => void = () => undefined;
  private emit() { this.cb([...this.shared, ...this.local.filter((c) => !this.shared.some((s) => s.id === c.id))]); }
  async add(c: Contribution, code: string) {
    const { error } = await remote!.from('contributions').insert({
      id: c.id, figure: c.figure, seed: c.seed, strength: c.strength ?? 1, t: c.t, code_hash: await hashCode(code),
    });
    if (error) await this.fallback.add(c);
    else this.refresh();
  }
  async remove(id: string) { await this.fallback.remove(id); }
  refresh = async () => {
    const list: Contribution[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await remote!.from('contributions').select('id, figure, seed, strength, t').order('t').range(from, from + 999);
      if (error || !data) return;
      for (const r of data) if (isFigure(r.figure)) list.push({ id: r.id, figure: r.figure, seed: r.seed, t: r.t, strength: r.strength });
      if (data.length < 1000) break;
    }
    this.shared = list;
    this.emit();
  };
  subscribe(cb: (l: Contribution[]) => void) {
    this.cb = cb;
    const offLocal = this.fallback.subscribe((l) => { this.local = l; this.emit(); });
    this.refresh();
    const timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 30000);
    return () => { offLocal(); clearInterval(timer); };
  }
}

export async function connectStore(): Promise<ContributionStore> {
  if (remote) return new RemoteStore();
  const db = await openDb();
  return db ? new ArtifactStore(db) : new LocalStore();
}

export interface Mine { kind: 'contribution' | 'voice'; id: string }

/** Which traces this browser left, so it can withdraw them. Nothing here identifies a person. */
export function rememberMine(code: string, mine: Mine) {
  const all = readJson<Record<string, Mine>>(MINE, {});
  all[code] = mine;
  writeJson(MINE, all);
}
export function findMine(code: string): Mine | null {
  return readJson<Record<string, Mine>>(MINE, {})[code] ?? null;
}
export function forgetMine(code: string) {
  const all = readJson<Record<string, Mine>>(MINE, {});
  delete all[code];
  writeJson(MINE, all);
}

/** A short random code. It replaces a running number, which would reveal how many came before. */
export function newCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % alphabet.length]).join('');
}
