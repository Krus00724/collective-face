import { debug } from './debug';

/** Plain white ground. Change it here and in the --paper token in styles.css. */
export const BACKDROP = debug.backdrop ?? '#ffffff';

export function backdropRGB(): [number, number, number] {
  const n = parseInt(BACKDROP.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
