import { BUST_META, FACE_U, FACE_V, PART, QUADS, REF, REST_CHILD, REST_FATHER, REST_MOTHER, TRIS, UNIT_IDX, UNIT_VAL } from '../data/bustData';
import type { Mix } from '../data/expressions';
import type { FigureId } from '../data/figures';
import * as HAIR from '../data/hairData';
import { refine, subdivision, type Polys, type Subdivision } from './subdivide';

const bytes = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const i16 = (b64: string) => { const b = bytes(b64); return new Int16Array(b.buffer, 0, b.length >> 1); };
const u16 = (b64: string) => { const b = bytes(b64); return new Uint16Array(b.buffer, 0, b.length >> 1); };

/** Decimetres in the data file, metres in the scene. */
const UNIT = 0.1 / 2500;

function positions(b64: string) {
  const q = i16(b64);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * UNIT;
  return out;
}

export interface Shared {
  cage: Polys;
  verts: number;
  part: Uint8Array;
  ref: Float32Array;
  faceU: Float32Array;
  faceV: Float32Array;
  neighbours: { start: Uint32Array; list: Uint32Array };
  units: Map<string, { idx: Uint16Array; val: Float32Array }>;
  sub: Subdivision;
  /** Dense static attributes. */
  denseRef: Float32Array;
  denseFace: Float32Array;
  densePart: Float32Array;
  indices: Uint32Array;
}

function adjacency(cage: Polys) {
  const sets: Set<number>[] = Array.from({ length: cage.verts }, () => new Set<number>());
  for (let f = 0; f < cage.start.length - 1; f++) {
    const s = cage.start[f];
    const e = cage.start[f + 1];
    for (let i = s; i < e; i++) {
      const a = cage.index[i];
      const b = cage.index[i + 1 === e ? s : i + 1];
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  const start = new Uint32Array(cage.verts + 1);
  sets.forEach((s, i) => { start[i + 1] = start[i] + s.size; });
  const list = new Uint32Array(start[cage.verts]);
  sets.forEach((s, i) => { let k = start[i]; s.forEach((n) => { list[k++] = n; }); });
  return { start, list };
}

export function loadShared(levels: number): Shared {
  const quads = u16(QUADS);
  const tris = u16(TRIS);
  const nq = quads.length / 4;
  const nt = tris.length / 3;
  const start = new Uint32Array(nq + nt + 1);
  const index = new Uint32Array(quads.length + tris.length);
  index.set(quads, 0);
  index.set(tris, quads.length);
  for (let i = 0; i < nq; i++) start[i + 1] = (i + 1) * 4;
  for (let i = 0; i < nt; i++) start[nq + i + 1] = quads.length + (i + 1) * 3;
  const verts = BUST_META.verts;
  const cage: Polys = { start, index, verts };

  const units = new Map<string, { idx: Uint16Array; val: Float32Array }>();
  const allIdx = u16(UNIT_IDX);
  const allVal = i16(UNIT_VAL);
  let at = 0;
  for (const [name, count] of BUST_META.units as [string, number][]) {
    const val = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) val[i] = allVal[at * 3 + i] * UNIT;
    units.set(name, { idx: allIdx.subarray(at, at + count), val });
    at += count;
  }

  const ref = positions(REF);
  const fu = u16(FACE_U);
  const fv = u16(FACE_V);
  const faceU = new Float32Array(verts);
  const faceV = new Float32Array(verts);
  const face2 = new Float32Array(verts * 2);
  for (let i = 0; i < verts; i++) {
    faceU[i] = fu[i] / 65535;
    faceV[i] = fv[i] / 65535;
    face2[i * 2] = faceU[i];
    face2[i * 2 + 1] = faceV[i];
  }
  const part = bytes(PART);
  const sub = subdivision(cage, levels);
  const denseRef = new Float32Array(sub.verts * 3);
  refine(sub, ref, 3, denseRef);
  const denseFace = new Float32Array(sub.verts * 2);
  refine(sub, face2, 2, denseFace);
  const densePart = new Float32Array(sub.verts);
  refine(sub, Float32Array.from(part), 1, densePart);
  const q = sub.surface.index;
  const indices = new Uint32Array((q.length / 4) * 6);
  for (let i = 0, k = 0; i < q.length; i += 4) {
    indices[k++] = q[i]; indices[k++] = q[i + 1]; indices[k++] = q[i + 2];
    indices[k++] = q[i]; indices[k++] = q[i + 2]; indices[k++] = q[i + 3];
  }
  return { cage, verts, part, ref, faceU, faceV, neighbours: adjacency(cage), units, sub, denseRef, denseFace, densePart, indices };
}

/** Hair and brows: a mesh of its own, tied to the cage so it moves with the head. */
export interface Hair {
  count: number;
  rest: Float32Array;
  normal: Float32Array;
  occ: Float32Array;
  index: Uint16Array;
  bind: Uint16Array;
  weight: Float32Array;
  /** The cage the rest shape was made on. */
  identity: Float32Array;
}

export function loadHair(id: FigureId, identity: Float32Array): Hair {
  const key = id.toUpperCase() as 'MOTHER' | 'FATHER' | 'CHILD';
  const q = i16(HAIR[`HAIR_${key}_POS`]);
  const n8 = bytes(HAIR[`HAIR_${key}_NOR`]);
  const o8 = bytes(HAIR[`HAIR_${key}_OCC`]);
  const count = o8.length;
  const rest = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    rest[i] = q[i] * UNIT;
    normal[i] = ((n8[i] << 24) >> 24) / 127;
  }
  const bind = u16(HAIR[`HAIR_${key}_BIND`]);
  const weight = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      const c = bind[i * 3 + k];
      const d2 = (rest[i * 3] - identity[c * 3]) ** 2 + (rest[i * 3 + 1] - identity[c * 3 + 1]) ** 2 + (rest[i * 3 + 2] - identity[c * 3 + 2]) ** 2;
      weight[i * 3 + k] = 1 / (d2 + 1e-6);
      sum += weight[i * 3 + k];
    }
    for (let k = 0; k < 3; k++) weight[i * 3 + k] /= sum;
  }
  const occ = new Float32Array(count);
  for (let i = 0; i < count; i++) occ[i] = o8[i] / 255;
  return { count, rest, normal, occ, index: u16(HAIR[`HAIR_${key}_IDX`]), bind, weight, identity };
}

const REST: Record<FigureId, string> = { mother: REST_MOTHER, father: REST_FATHER, child: REST_CHILD };
export const restShape = (id: FigureId) => positions(REST[id]);

const name = (unit: string, side: 'left' | 'right') => {
  if (unit.startsWith('eyebrows-')) return unit.replace('eyebrows-', `eyebrows-${side}-`);
  if (unit.startsWith('eye-')) return unit.replace('eye-', `eye-${side}-`);
  if (unit === 'nose-elevation') return `nose-${side}-elevation`;
  if (unit === 'nose-dilatation') return `nose-${side}-dilatation`;
  return null;
};

/** Adds an emotion to a copy of the cage. Scales with the size of the head it lands on. */
export function applyEmotion(shared: Shared, cage: Float32Array, mix: Mix, gain: number, size: number) {
  const { units, ref } = shared;
  const add = (u: { idx: Uint16Array; val: Float32Array }, l: number, r: number) => {
    for (let i = 0; i < u.idx.length; i++) {
      const v = u.idx[i];
      const x = ref[v * 3];
      const t = Math.min(1, Math.max(0, x / 0.04 + 0.5));
      const w = (r + (l - r) * t) * gain * size;
      cage[v * 3] += u.val[i * 3] * w;
      cage[v * 3 + 1] += u.val[i * 3 + 1] * w;
      cage[v * 3 + 2] += u.val[i * 3 + 2] * w;
    }
  };
  for (const [unit, value] of Object.entries(mix)) {
    const [l, r] = typeof value === 'number' ? [value, value] : value;
    const left = name(unit, 'left');
    if (left) {
      const a = units.get(left);
      const b = units.get(name(unit, 'right')!);
      if (a) add(a, l, l);
      if (b) add(b, r, r);
    } else {
      const u = units.get(unit);
      if (u) add(u, l, r);
    }
  }
}

export interface Surface {
  position: Float32Array;
  normal: Float32Array;
  /** Skin compression, then soft occlusion, per vertex. */
  extra: Float32Array;
}

/** A place to bake one state of the dense surface into. */
export function blankSurface(shared: Shared, hair?: Hair): Surface {
  const n = shared.sub.verts + (hair?.count ?? 0);
  return { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), extra: new Float32Array(n * 2) };
}

const cagePlus = { occ: new Float32Array(0), blur: new Float32Array(0) };

/** Occlusion from how far each cage vertex sits below the blurred surface. */
function occlusion(shared: Shared, cage: Float32Array, out: Float32Array) {
  const { neighbours, verts } = shared;
  if (cagePlus.blur.length !== verts * 3) cagePlus.blur = new Float32Array(verts * 3);
  const a = Float32Array.from(cage);
  const b = cagePlus.blur;
  for (let it = 0; it < 7; it++) {
    for (let v = 0; v < verts; v++) {
      const s = neighbours.start[v];
      const e = neighbours.start[v + 1];
      let x = 0, y = 0, z = 0;
      for (let i = s; i < e; i++) {
        const n = neighbours.list[i];
        x += a[n * 3]; y += a[n * 3 + 1]; z += a[n * 3 + 2];
      }
      const w = 1 / Math.max(1, e - s);
      b[v * 3] = a[v * 3] * 0.34 + x * w * 0.66;
      b[v * 3 + 1] = a[v * 3 + 1] * 0.34 + y * w * 0.66;
      b[v * 3 + 2] = a[v * 3 + 2] * 0.34 + z * w * 0.66;
    }
    a.set(b);
  }
  const quad = shared.cage;
  const nx = new Float32Array(verts), ny = new Float32Array(verts), nz = new Float32Array(verts);
  for (let f = 0; f < quad.start.length - 1; f++) {
    const s = quad.start[f], e = quad.start[f + 1];
    const p = quad.index[s], q = quad.index[s + 1], r = quad.index[e - 1];
    const ux = cage[q * 3] - cage[p * 3], uy = cage[q * 3 + 1] - cage[p * 3 + 1], uz = cage[q * 3 + 2] - cage[p * 3 + 2];
    const vx = cage[r * 3] - cage[p * 3], vy = cage[r * 3 + 1] - cage[p * 3 + 1], vz = cage[r * 3 + 2] - cage[p * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (let i = s; i < e; i++) { const c = quad.index[i]; nx[c] += cx; ny[c] += cy; nz[c] += cz; }
  }
  for (let v = 0; v < verts; v++) {
    const l = Math.hypot(nx[v], ny[v], nz[v]) || 1;
    const d = ((a[v * 3] - cage[v * 3]) * nx[v] + (a[v * 3 + 1] - cage[v * 3 + 1]) * ny[v] + (a[v * 3 + 2] - cage[v * 3 + 2]) * nz[v]) / l;
    const c = Math.max(0, d) / 0.012;
    let occ = 1 / (1 + c * c * 0.9 + c * 0.45);
    if (shared.part[v] === 1) occ *= 0.8;
    if (shared.part[v] === 2) occ *= 0.55;
    out[v] = occ;
  }
}

/**
 * Bakes one sculptural state: cage in, dense surface out, with normals, how much the skin is
 * being compressed (which drives the wrinkles), and occlusion for hollows.
 */
export function bakeSurface(shared: Shared, cage: Float32Array, restArea: Float32Array | null, out: Surface, hair?: Hair): Float32Array {
  const { sub } = shared;
  refine(sub, cage, 3, out.position);
  const n = sub.verts;
  const occ = new Float32Array(shared.verts);
  occlusion(shared, cage, occ);
  const denseOcc = new Float32Array(n);
  refine(sub, occ, 1, denseOcc);
  const P = out.position;
  const N = out.normal;
  N.fill(0);
  const area = new Float32Array(n);
  const q = sub.surface.index;
  for (let i = 0; i < q.length; i += 4) {
    const a = q[i], b = q[i + 1], c = q[i + 2], d = q[i + 3];
    const ax = P[c * 3] - P[a * 3], ay = P[c * 3 + 1] - P[a * 3 + 1], az = P[c * 3 + 2] - P[a * 3 + 2];
    const bx = P[d * 3] - P[b * 3], by = P[d * 3 + 1] - P[b * 3 + 1], bz = P[d * 3 + 2] - P[b * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const m = Math.sqrt(cx * cx + cy * cy + cz * cz);
    for (let k = 0; k < 4; k++) {
      const v = q[i + k];
      N[v * 3] += cx; N[v * 3 + 1] += cy; N[v * 3 + 2] += cz;
      area[v] += m;
    }
  }
  for (let v = 0; v < n; v++) {
    const l = 1 / (Math.sqrt(N[v * 3] ** 2 + N[v * 3 + 1] ** 2 + N[v * 3 + 2] ** 2) || 1);
    N[v * 3] *= l; N[v * 3 + 1] *= l; N[v * 3 + 2] *= l;
    const t = restArea ? Math.max(0, Math.min(1, (restArea[v] / Math.max(1e-9, area[v]) - 1) * 2.6)) : 0;
    out.extra[v * 2] = t;
    out.extra[v * 2 + 1] = denseOcc[v];
  }
  if (hair) {
    const { rest, normal, occ, bind, weight, identity } = hair;
    for (let i = 0; i < hair.count; i++) {
      let dx = 0, dy = 0, dz = 0;
      for (let k = 0; k < 3; k++) {
        const c = bind[i * 3 + k], w = weight[i * 3 + k];
        dx += (cage[c * 3] - identity[c * 3]) * w;
        dy += (cage[c * 3 + 1] - identity[c * 3 + 1]) * w;
        dz += (cage[c * 3 + 2] - identity[c * 3 + 2]) * w;
      }
      const o = n + i;
      P[o * 3] = rest[i * 3] + dx;
      P[o * 3 + 1] = rest[i * 3 + 1] + dy;
      P[o * 3 + 2] = rest[i * 3 + 2] + dz;
      N[o * 3] = normal[i * 3];
      N[o * 3 + 1] = normal[i * 3 + 1];
      N[o * 3 + 2] = normal[i * 3 + 2];
      out.extra[o * 2] = 0;
      out.extra[o * 2 + 1] = occ[i];
    }
  }
  return area;
}

/** Everything about a bust that never changes, skin and hair together. */
export function dress(shared: Shared, hair: Hair) {
  const n = shared.sub.verts;
  const m = n + hair.count;
  const ref = new Float32Array(m * 3);
  ref.set(shared.denseRef);
  ref.set(hair.rest, n * 3);
  const face = new Float32Array(m * 2);
  face.set(shared.denseFace);
  const part = new Float32Array(m);
  part.set(shared.densePart);
  part.fill(4, n);
  const index = new Uint32Array(shared.indices.length + hair.index.length);
  index.set(shared.indices);
  for (let i = 0; i < hair.index.length; i++) index[shared.indices.length + i] = hair.index[i] + n;
  return { ref, face, part, index };
}
