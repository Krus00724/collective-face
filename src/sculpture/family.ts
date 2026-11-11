import { EMOTIONS } from '../data/expressions';
import * as THREE from 'three';
import { CLOSE_LAYOUT, FIGURES, FIGURE_IDS, type FigureId } from '../data/figures';
import { sampleContributions, SAMPLE_WEEKS, type Contribution } from '../data/sampleHistory';
import { debug } from '../debug';
import { closedWeeks, closeOf } from '../services/archive';
import { useStore, type WeekSummary } from '../store';
import { createEngine, type Engine, type FrozenState } from './runtime';

export interface Week extends WeekSummary { states: Record<FigureId, FrozenState> }
interface Tween { to: FrozenState; t: number; dur: number; wave: number; ripple: number; done?: () => void }

const FIRST_REAL_WEEK = '2026-11-08';
const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * The family as data. The contribution log is the source of truth: the state of each bust is a
 * fold over it, so history can be rebuilt on any device and a past week can never change.
 */
export class Family {
  readonly engine: Engine;
  weeks: Week[] = [];
  /** What is on show right now, per figure. */
  shown = {} as Record<FigureId, FrozenState>;
  private live: Contribution[] = [];
  private cage = {} as Record<FigureId, Float32Array>;
  private revision = 0;
  /** The twelve simulated weeks. A real week takes the place of the one with its number. */
  private simulated: Week[] = [];
  private tweens = {} as Record<FigureId, Tween | undefined>;
  private hold = { mother: 3500, child: 5500, father: 7500 } as Record<FigureId, number>;
  private mood = { mother: 0, child: 0, father: 0 } as Record<FigureId, number>;
  private speaking = {} as Record<FigureId, { level: () => number; value: number } | undefined>;
  private shownT = 0;
  private mixCompare = 0;
  private wasArchive = false;
  private frozen = false;

  constructor(levels: number, wrinkles: THREE.Texture, details: THREE.Texture[], private calm: boolean) {
    this.engine = createEngine(levels, wrinkles, details);
    this.simulate();
    this.rebuild();
    for (const id of FIGURE_IDS) {
      this.shown[id] = this.state(id, FIGURES[id].moods[0]);
      this.engine.figures[id].arrange(this.shown[id], this.shown[id]);
    }
    this.publish();
  }

  private state(id: FigureId, emotion: string): FrozenState {
    return { key: `live:${this.revision}:${emotion}`, cage: this.cage[id], emotion };
  }

  /** Runs the simulated weeks on the clay, keeps what they made, and puts the faces back. */
  private simulate() {
    const closes = SAMPLE_WEEKS.map(closeOf);
    const all = sampleContributions(closes);
    const lists = {} as Record<FigureId, Contribution[]>;
    for (const id of FIGURE_IDS) lists[id] = all.filter((c) => c.figure === id);
    const cursor = { mother: 0, father: 0, child: 0 } as Record<FigureId, number>;
    SAMPLE_WEEKS.forEach((iso, w) => {
      const states = {} as Record<FigureId, FrozenState>;
      const counts = {} as Record<FigureId, number>;
      for (const id of FIGURE_IDS) {
        const f = this.engine.figures[id];
        const list = lists[id];
        let end = cursor[id];
        while (end < list.length && list[end].t <= closes[w]) end++;
        f.fold(list.slice(cursor[id], end));
        cursor[id] = end;
        counts[id] = end;
        const moods = FIGURES[id].moods;
        states[id] = { key: `week:${w}`, cage: Float32Array.from(f.head.cage), emotion: moods[w % moods.length] };
      }
      this.simulated.push({ iso, number: w + 1, counts, states, sample: true });
    });
  }

  private publish() {
    const counts = { mother: 0, father: 0, child: 0 } as Record<FigureId, number>;
    for (const c of this.live) counts[c.figure]++;
    useStore.getState().set({
      counts, total: counts.mother + counts.father + counts.child,
      weeks: this.weeks.map(({ iso, number, counts: k, sample }) => ({ iso, number, counts: k, sample })),
    });
  }

  /** The living family: the friends' faces, then every real contribution, in order. */
  private rebuild() {
    for (const id of FIGURE_IDS) {
      const f = this.engine.figures[id];
      f.head.cage.set(f.head.identity);
      f.applied = 0;
    }
    const counts = { mother: 0, father: 0, child: 0 } as Record<FigureId, number>;
    let i = 0;
    const foldUntil = (limit: number) => {
      for (; i < this.live.length && this.live[i].t <= limit; i++) {
        const c = this.live[i];
        this.engine.figures[c.figure].fold([c]);
        counts[c.figure]++;
      }
    };
    const real: Week[] = [];
    closedWeeks(FIRST_REAL_WEEK, Date.now()).forEach((iso, k) => {
      foldUntil(closeOf(iso));
      const states = {} as Record<FigureId, FrozenState>;
      for (const id of FIGURE_IDS) {
        const moods = FIGURES[id].moods;
        states[id] = { key: `real:${k}:${this.revision}`, cage: Float32Array.from(this.engine.figures[id].head.cage), emotion: moods[k % moods.length] };
      }
      real.push({ iso, number: k + 1, counts: { ...counts }, states, sample: false });
    });
    this.weeks = [...real, ...this.simulated.slice(real.length)];
    foldUntil(Infinity);
    this.revision++;
    for (const id of FIGURE_IDS) this.cage[id] = Float32Array.from(this.engine.figures[id].head.cage);
  }

  /** Replace the live log, for example when the shared store reports a change. */
  syncLive(live: Contribution[], animate: boolean) {
    const sorted = [...live].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    if (sorted.length === this.live.length && sorted.every((c, i) => c.id === this.live[i].id)) return;
    const old = new Set(this.live.map((c) => c.id));
    const fresh = new Set(sorted.map((c) => c.id));
    const changed = new Set<FigureId>();
    for (const c of sorted) if (!old.has(c.id)) changed.add(c.figure);
    for (const c of this.live) if (!fresh.has(c.id)) changed.add(c.figure);
    this.live = sorted;
    this.rebuild();
    this.publish();
    for (const id of FIGURE_IDS) {
      const to = this.state(id, this.shown[id].emotion);
      if (animate && changed.has(id)) this.morph(id, to, 4200, 0.34, 0.0012);
      else if (!this.tweens[id]) { this.engine.figures[id].arrange(to, to); this.shown[id] = to; }
    }
  }

  /** The visitor's own contribution: fold it in, then let the clay change slowly. */
  contribute(c: Contribution, durationMs: number, done: () => void) {
    this.live = [...this.live, c].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    this.frozen = true;
    this.rebuild();
    this.publish();
    for (const id of FIGURE_IDS) {
      if (id === c.figure) continue;
      if (!this.tweens[id]) {
        const s = this.state(id, this.shown[id].emotion);
        this.engine.figures[id].arrange(s, s);
        this.shown[id] = s;
      }
    }
    this.morph(c.figure, this.state(c.figure, this.shown[c.figure].emotion), durationMs, 0.5, 0.0022, () => {
      this.frozen = false;
      done();
    });
  }

  private morph(id: FigureId, to: FrozenState, dur: number, wave: number, ripple: number, done?: () => void) {
    const rt = this.engine.figures[id];
    rt.arrange(this.shown[id], to);
    rt.uniforms.uMorph.value = 0;
    this.tweens[id] = { to, t: 0, dur, wave, ripple, done };
  }

  /** A stranger's voice comes out of this bust: its jaw follows the loudness of the sound. */
  speak(id: FigureId, level: () => number) {
    const rt = this.engine.figures[id];
    const tw = this.tweens[id];
    if (tw) {
      this.shown[id] = tw.to;
      this.tweens[id] = undefined;
      rt.uniforms.uWave.value = 0;
      rt.uniforms.uRipple.value = 0;
    }
    const base = this.shown[id];
    rt.arrange(base, { ...base, key: `${base.key}:speak`, extra: { 'mouth-open': 0.4, 'mouth-retraction': 0.12 } });
    rt.uniforms.uMorph.value = 0;
    this.speaking[id] = { level, value: 0 };
  }

  silence(id: FigureId) {
    if (!this.speaking[id]) return;
    this.speaking[id] = undefined;
    const rt = this.engine.figures[id];
    rt.arrange(this.shown[id], this.shown[id]);
    rt.uniforms.uMorph.value = 0;
    this.hold[id] = 2500;
  }

  /** Called every frame. Decides what each bust shows. */
  tick(dtRaw: number) {
    const dtMs = dtRaw * debug.speed;
    const s = useStore.getState();
    const inArchive = s.view === 'archive' && this.weeks.length > 0;

    if (inArchive) {
      if (!this.wasArchive) { this.shownT = s.archiveT; this.mixCompare = 0; }
      this.shownT += (s.archiveT - this.shownT) * (1 - Math.exp(-dtMs / 180));
      this.mixCompare += ((s.compare ? 1 : 0) - this.mixCompare) * (1 - Math.exp(-dtMs / 420));
      const i = Math.min(this.weeks.length - 1, Math.floor(this.shownT));
      const j = Math.min(this.weeks.length - 1, i + 1);
      for (const id of FIGURE_IDS) {
        const rt = this.engine.figures[id];
        rt.uniforms.uWave.value = 0;
        rt.uniforms.uRipple.value = 0;
        if (this.mixCompare > 0.003) {
          const w = this.weeks[Math.round(this.shownT)].states[id];
          rt.arrange(w, this.shown[id]);
          rt.uniforms.uMorph.value = this.mixCompare;
        } else {
          rt.arrange(this.weeks[i].states[id], this.weeks[j].states[id]);
          rt.uniforms.uMorph.value = this.shownT - i;
        }
      }
      this.wasArchive = true;
      return;
    }

    if (this.wasArchive) {
      this.wasArchive = false;
      const i = Math.min(this.weeks.length - 1, Math.round(this.shownT));
      for (const id of FIGURE_IDS) {
        const target = this.shown[id];
        const rt = this.engine.figures[id];
        rt.arrange(this.weeks[i].states[id], target);
        rt.uniforms.uMorph.value = 0;
        this.tweens[id] = { to: target, t: 0, dur: 1100, wave: 0, ripple: 0 };
      }
    }

    for (const id of FIGURE_IDS) {
      const rt = this.engine.figures[id];
      const voice = this.speaking[id];
      if (voice) {
        const target = voice.level();
        voice.value += (target - voice.value) * (1 - Math.exp(-dtMs / (target > voice.value ? 40 : 110)));
        rt.uniforms.uMorph.value = voice.value;
        continue;
      }
      const tw = this.tweens[id];
      if (tw) {
        tw.t += dtMs;
        const p = Math.min(1, tw.t / tw.dur);
        rt.uniforms.uWave.value = tw.wave;
        rt.uniforms.uMorph.value = ease(p);
        rt.uniforms.uRipple.value = tw.ripple * Math.sin(Math.PI * p) ** 2;
        if (p >= 1) {
          this.shown[id] = tw.to;
          rt.uniforms.uWave.value = 0;
          rt.uniforms.uRipple.value = 0;
          rt.arrange(tw.to, tw.to);
          rt.uniforms.uMorph.value = 0;
          this.tweens[id] = undefined;
          tw.done?.();
        }
        continue;
      }
      if (this.calm || this.frozen) continue;
      this.hold[id] -= dtMs;
      if (this.hold[id] > 0) continue;
      // the next feeling. Each figure keeps its own slow rhythm, so they never move together.
      const moods = FIGURES[id].moods;
      this.mood[id] = (this.mood[id] + 1) % moods.length;
      const to = this.state(id, moods[this.mood[id]]);
      this.morph(id, to, 2300 + Math.random() * 1100, 0, 0);
      this.hold[id] = 2800 + Math.random() * 2800;
      break;
    }
  }

  /** Touched, a face answers at once: a start, a flinch, a wink. Then it goes back to its own rhythm. */
  react(id: FigureId) {
    if (this.calm || this.frozen || this.wasArchive || this.tweens[id] || this.speaking[id]) return;
    const answers = ['surprise', 'grimace', 'wink', 'doubt', 'laughter', 'pout'].filter((e) => e !== this.shown[id].emotion);
    this.morph(id, this.state(id, answers[Math.floor(Math.random() * answers.length)]), 380, 0, 0);
    this.hold[id] = 1100;
    // the feeling after a start is rest
    const moods = FIGURES[id].moods;
    this.mood[id] = (moods.indexOf('rest', this.mood[id]) + moods.length - 1) % moods.length;
  }

  /** How far the eyes are open right now, 0 to 1, so a blink never closes eyes that are shut. */
  eyesOpen(id: FigureId) {
    const shut = (emotion: string) => {
      const m = EMOTIONS[emotion] ?? {};
      const of = (k: string) => { const v = m[k]; return v === undefined ? 0 : typeof v === 'number' ? v : Math.max(v[0], v[1]); };
      return Math.min(1, Math.max(of('eye-closure'), of('eye-slit') * 0.5));
    };
    const tw = this.tweens[id];
    const a = shut(this.shown[id].emotion);
    if (!tw) return 1 - a;
    const p = ease(Math.min(1, tw.t / tw.dur));
    return 1 - (a + (shut(tw.to.emotion) - a) * p);
  }

  /** Where the middle of a face is in the scene. */
  faceOf(id: FigureId) {
    const rt = this.engine.figures[id];
    const y = rt.spec.socle - rt.baseY - 0.012 + rt.face.y + 0.006;
    const c = Math.cos(rt.spec.facing);
    const s = Math.sin(rt.spec.facing);
    const d = rt.face.z - 0.03;
    const [px, pz] = useStore.getState().close ? CLOSE_LAYOUT[id] : [rt.spec.x, rt.spec.z];
    return { x: px + s * d, y, z: pz + c * d, facing: rt.spec.facing };
  }

  moving() {
    return this.wasArchive || FIGURE_IDS.some((id) => this.tweens[id] || this.speaking[id]);
  }
}
