import { create } from 'zustand';
import type { FigureId } from './data/figures';
import type { LibraryPortrait } from './services/remote';
import type { PendingVoice, RemovalRequest, VoiceRef } from './services/voice';

export type View = 'family' | 'contribute' | 'studio' | 'archive' | 'about' | 'review';
export type Phase = 'form' | 'becoming' | 'done';

export interface WeekSummary {
  iso: string;
  number: number;
  counts: Record<FigureId, number>;
  sample: boolean;
}

interface State {
  ready: boolean;
  view: View;
  /** The bust being looked at closely, in the family view or while contributing. */
  selected: FigureId | null;
  phase: Phase;
  counts: Record<FigureId, number>;
  total: number;
  /** Anonymous code of the visitor's latest trace. Random, so it says nothing about how many came before. */
  lastCode: string | null;
  /** The artist. Only this person sees the review view. */
  owner: boolean;
  /** Voice messages can be sent from this view. */
  canSend: boolean;
  /** Approved messages by figure. */
  voices: Record<FigureId, VoiceRef[]>;
  pending: PendingVoice[];
  removals: RemovalRequest[];
  speaking: FigureId | null;
  weeks: WeekSummary[];
  /** Fractional index into weeks, for the timeline. */
  archiveT: number;
  compare: boolean;
  previews: Record<string, string>;
  storage: 'shared' | 'local' | 'connecting';
  /** Tall screen: the family stands closer together. */
  close: boolean;
  /** Who is signed in. Only someone adding a portrait, or the artist. */
  account: { email: string } | null;
  /** Portraits people gave to the studio, newest first. */
  library: LibraryPortrait[];
  libraryOpen: boolean;
  go(view: View): void;
  pick(id: FigureId | null): void;
  set(patch: Partial<State>): void;
}

/** Set by the voice hub, so leaving a bust always stops its voice. */
let voiceStop: (() => void) | null = null;
export const onLeave = (fn: () => void) => { voiceStop = fn; };

const mark = (hash: string) => {
  try { history.replaceState(null, '', `#${hash}`); } catch { location.hash = hash; }
};

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: 'family',
  selected: null,
  phase: 'form',
  counts: { mother: 0, father: 0, child: 0 },
  total: 0,
  lastCode: null,
  owner: false,
  canSend: false,
  voices: { mother: [], father: [], child: [] },
  pending: [],
  removals: [],
  speaking: null,
  weeks: [],
  archiveT: 0,
  compare: false,
  previews: {},
  storage: 'connecting',
  close: innerWidth / Math.max(1, innerHeight) < 0.85,
  account: null,
  library: [],
  libraryOpen: false,
  go(view) {
    const s = get();
    if (s.phase === 'becoming') return;
    voiceStop?.();
    if (view !== 'contribute') set({ selected: null, phase: 'form' });
    if (view === 'archive') set({ archiveT: Math.max(0, s.weeks.filter((w) => !w.sample).length - 1), compare: false });
    set({ view });
    if (location.hash.slice(1) !== view) mark(view);
  },
  pick(id) {
    const s = get();
    if (s.phase === 'becoming') return;
    if (s.view === 'archive' || s.view === 'about' || s.view === 'studio') return;
    if (!id) voiceStop?.();
    set({ selected: id, phase: 'form' });
    if (id) mark(id);
    else mark(s.view);
  },
  set(patch) { set(patch); },
}));
