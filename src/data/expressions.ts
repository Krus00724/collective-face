/**
 * Emotions as mixtures of MakeHuman's 34 expression units. A value is a weight, or [left, right]
 * for one sided expressions. Shared names without a side expand to both sides of the face.
 */
export type Mix = Record<string, number | [number, number]>;

export const EMOTIONS: Record<string, Mix> = {
  rest: {},
  'wide smile': { 'mouth-corner-puller': 1, 'mouth-upward-retraction': 0.55, 'mouth-parling': 0.35, 'eye-slit': 0.55, 'eyebrows-up': 0.12, 'nose-dilatation': 0.3 },
  laughter: { 'mouth-open': 0.5, 'mouth-corner-puller': 1, 'mouth-upward-retraction': 0.7, 'eye-slit': 0.8, 'eye-closure': 0.25, 'eyebrows-up': 0.25, 'nose-elevation': 0.25 },
  grimace: { 'mouth-retraction': 1, 'mouth-part-later': 0.75, 'mouth-depression-retraction': 0.6, 'neck-platysma': 0.9, 'eye-slit': 0.8, 'eyebrows-down': 0.75, 'nose-elevation': 0.55 },
  scream: { 'mouth-open': 0.86, 'mouth-retraction': 0.5, 'eyebrows-up': 1, 'eyebrows-inner-up': 0.6, 'eye-opened-up': 1, 'neck-platysma': 0.4, 'nose-dilatation': 0.6 },
  rage: { 'eyebrows-down': 1, 'nose-compression': 0.7, 'eye-slit': 0.45, 'mouth-upward-retraction': 0.6, 'mouth-retraction': 0.55, 'mouth-parling': 0.5, 'nose-dilatation': 0.7, 'neck-platysma': 0.45 },
  disgust: { 'nose-elevation': 1, 'mouth-upward-retraction': 0.7, 'mouth-elevation': 0.5, 'eyebrows-down': 0.65, 'eye-slit': 0.65, 'mouth-depression': 0.2 },
  sorrow: { 'eyebrows-inner-up': 1, 'mouth-depression': 0.85, 'eye-closure': 0.28, 'mouth-compression': 0.25, 'mouth-elevation': 0.3 },
  fear: { 'eyebrows-up': 0.8, 'eyebrows-inner-up': 0.85, 'eye-opened-up': 0.9, 'mouth-retraction': 0.65, 'mouth-parling': 0.45, 'neck-platysma': 0.65 },
  surprise: { 'eyebrows-up': 1, 'eye-opened-up': 1, 'mouth-open': 0.5, 'mouth-pursing': 0.15 },
  contempt: { 'mouth-corner-puller': [0.8, 0], 'mouth-upward-retraction': [0.45, 0], 'eyebrows-up': [0.1, 0.5], 'eye-slit': [0.35, 0.1], 'nose-elevation': [0.3, 0] },
  pout: { 'mouth-protusion': 1, 'mouth-pursing': 0.6, 'mouth-eversion': 0.5, 'eyebrows-inner-up': 0.4, 'mouth-depression': 0.25 },
  sleep: { 'eye-closure': 1, 'mouth-compression': 0.15, 'eyebrows-inner-up': 0.1 },
  wink: { 'eye-closure': [1, 0], 'eye-slit': [0, 0.3], 'mouth-corner-puller': [0.8, 0.3], 'eyebrows-down': [0.4, 0], 'eyebrows-up': [0, 0.3] },
  doubt: { 'eyebrows-up': [0, 0.9], 'eyebrows-down': [0.6, 0], 'mouth-compression': 0.6, 'mouth-depression-retraction': 0.2 },
  whistle: { 'mouth-pursing': 1, 'mouth-protusion': 0.7, 'eyebrows-up': 0.4, 'eye-slit': 0.2 },
};

export const EMOTION_NAMES = Object.keys(EMOTIONS);
