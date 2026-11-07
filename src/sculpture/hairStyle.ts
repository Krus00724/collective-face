/**
 * How the hair has been reshaped, kept as numbers after the cage. Four qualities (volume,
 * length, sweep, wildness) once for the whole head, then again for each patch of the head,
 * so one lock can grow longer or one side curl while the rest stays as it was.
 */
export const HAIR_QUALITIES = 4;

/** Patches of the head, as directions from the middle of the skull. */
export const HAIR_ZONES: [number, number, number][] = [
  [0, 0.5, 0.87], // fringe
  [0, 1, 0], // crown
  [-0.98, 0.15, 0.1], // left side
  [0.98, 0.15, 0.1], // right side
  [0, 0.25, -0.97], // back
  [-0.62, -0.1, -0.78], // nape, left
  [0.62, -0.1, -0.78], // nape, right
  [-0.7, 0.35, 0.62], // temple, left
  [0.7, 0.35, 0.62], // temple, right
].map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as [number, number, number]; });

export const HAIR_SLOTS = HAIR_QUALITIES * (1 + HAIR_ZONES.length);

/** Where one quality of one patch lives after the cage. No zone means the whole head. */
export const hairSlot = (quality: number, zone?: number) => (zone === undefined ? 0 : 1 + zone) * HAIR_QUALITIES + quality;

/** How much a direction from the middle of the skull belongs to a patch. */
export const zoneWeight = (zone: number, x: number, y: number, z: number) => {
  const d = HAIR_ZONES[zone];
  return Math.exp((d[0] * x + d[1] * y + d[2] * z - 1) / 0.16);
};

/** The patch closest to another one, for changes that reach over two. */
export function neighbour(zone: number, pick: number) {
  const d = HAIR_ZONES[zone];
  const near = HAIR_ZONES.map((e, i) => ({ i, dot: i === zone ? -2 : d[0] * e[0] + d[1] * e[1] + d[2] * e[2] }))
    .sort((a, b) => b.dot - a.dot);
  return near[Math.min(near.length - 1, Math.floor(pick * 2))].i;
}
