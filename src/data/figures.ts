/** The three members of the family. Everything that makes them differ at the start lives here. */
export type FigureId = 'mother' | 'father' | 'child';
export const FIGURE_IDS: FigureId[] = ['mother', 'father', 'child'];

export interface FigureSpec {
  id: FigureId;
  name: string;
  /** Position along the row in metres. */
  x: number;
  /** Depth position in metres. */
  z: number;
  /** Turn around the vertical axis in radians. */
  facing: number;
  /** Uniform scale of the bust. */
  scale: number;
  /** Height of the socle in metres. */
  socle: number;
  /** Plasticine, colours sampled from the reference photograph. */
  clay: { kind: number; base: string; deep: string; pale: string };
  /** Order the emotions come in, so the three never move in step. */
  moods: string[];
}

/** On a tall phone screen the family stands close together, like people in a photograph. */
export const CLOSE_LAYOUT: Record<FigureId, [number, number]> = { mother: [-0.35, -0.12], child: [0, 0.24], father: [0.37, -0.12] };

export const FIGURES: Record<FigureId, FigureSpec> = {
  mother: {
    id: 'mother', name: 'Mother', x: -0.56, z: 0, facing: 0.16, scale: 1, socle: 0.13,
    clay: { kind: 1, base: '#cd256f', deep: '#940241', pale: '#ff69b2' },
    moods: ['rest', 'wide smile', 'sorrow', 'rest', 'surprise', 'contempt', 'scream', 'rest', 'sleep', 'laughter', 'doubt', 'fear'],
  },
  child: {
    id: 'child', name: 'Child', x: 0, z: 0.08, facing: 0, scale: 1, socle: 0.16,
    clay: { kind: 2, base: '#2c9f64', deep: '#02442d', pale: '#87e0a9' },
    moods: ['rest', 'grimace', 'laughter', 'rest', 'pout', 'wink', 'scream', 'rest', 'sleep', 'whistle', 'wide smile', 'surprise', 'sorrow'],
  },
  father: {
    id: 'father', name: 'Father', x: 0.58, z: 0, facing: -0.16, scale: 1, socle: 0.13,
    clay: { kind: 0, base: '#064588', deep: '#003269', pale: '#1d6dbd' },
    moods: ['rest', 'grimace', 'rage', 'rest', 'disgust', 'wide smile', 'doubt', 'rest', 'sorrow', 'scream', 'contempt', 'laughter'],
  },
};
