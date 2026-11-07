import { BUST_META, FACE_U, FACE_V, PART, QUADS, REF, REST_CHILD, REST_FATHER, REST_MOTHER, TRIS, UNIT_IDX, UNIT_VAL } from '../data/bustData';
import type { Mix } from '../data/expressions';
import type { FigureId } from '../data/figures';
import * as HAIR from '../data/hairData';
import { HAIR_QUALITIES, HAIR_SLOTS, HAIR_ZONES, zoneWeight } from './hairStyle';
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
  /** Outward from the middle of the skull, per vertex. */
  dir: Float32Array;
  /** 0 on the scalp, 1 on the outermost layer. */
  depth: Float32Array;
  /** 0 at the top of the hair, 1 at its lowest ends. */
  drop: Float32Array;
  /** 0 for the brows, which never take part in a change of hairstyle. */
  free: Float32Array;
  /** How far a strand in front of the face may fall, so a fringe never covers the eyes. */
  room: Float32Array;
  /** Normals of the rest mesh, so deformed normals can be found relative to the baked ones. */
  meshNormal: Float32Array;
  centre: [number, number, number];
  /** How much each vertex belongs to each patch of the head. */
  zone: Float32Array;
  /** 1 on the top of the head, fading to 0 down the sides, for combing over. */
  top: Float32Array;
}

function meshNormals(p: Float32Array, index: Uint16Array, out: Float32Array, at = 0) {
  out.fill(0);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] + at, b = index[i + 1] + at, c = index[i + 2] + at;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const oa = (a - at) * 3, ob = (b - at) * 3, oc = (c - at) * 3;
    out[oa] += nx; out[oa + 1] += ny; out[oa + 2] += nz;
    out[ob] += nx; out[ob + 1] += ny; out[ob + 2] += nz;
    out[oc] += nx; out[oc + 1] += ny; out[oc + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
}

export function loadHair(id: FigureId, identity: Float32Array, ref: Float32Array): Hair {
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
  const bind = Uint16Array.from(u16(HAIR[`HAIR_${key}_BIND`]));
  // Hair that hangs past the jaw was tied to the neck and shoulders, so a thicker neck or a
  // tilted head would drag the ends about. Tie it to the lower skull instead: it hangs from the head.
  const nv = ref.length / 3;
  const skull: number[] = [];
  for (let c = 0; c < nv; c++) {
    const y = ref[c * 3 + 1], z = ref[c * 3 + 2];
    if (y > 0.665 && y < 0.75 && !(z > 0.05 && y < 0.71)) skull.push(c);
  }
  for (let i = 0; i < count; i++) {
    let low = false;
    for (let k = 0; k < 3; k++) if (ref[bind[i * 3 + k] * 3 + 1] < 0.655) low = true;
    if (!low) continue;
    const best = [-1, -1, -1], dist = [Infinity, Infinity, Infinity];
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    for (const c of skull) {
      const d = (x - identity[c * 3]) ** 2 + (y - identity[c * 3 + 1]) ** 2 + (z - identity[c * 3 + 2]) ** 2;
      if (d >= dist[2]) continue;
      let k = 2;
      while (k > 0 && d < dist[k - 1]) { dist[k] = dist[k - 1]; best[k] = best[k - 1]; k--; }
      dist[k] = d; best[k] = c;
    }
    for (let k = 0; k < 3; k++) bind[i * 3 + k] = best[k];
  }
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
  const index = u16(HAIR[`HAIR_${key}_IDX`]);

  // the brows are small separate pieces at the front of the face
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < index.length; i += 3) {
    const a = find(index[i]);
    parent[find(index[i + 1])] = a;
    parent[find(index[i + 2])] = a;
  }
  // this figure against the shared reference head: about a scale and a shift
  let rlo = Infinity, rhi = -Infinity, flo = Infinity, fhi = -Infinity;
  const mr = [0, 0, 0], mf = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    rlo = Math.min(rlo, ref[v * 3 + 1]); rhi = Math.max(rhi, ref[v * 3 + 1]);
    flo = Math.min(flo, identity[v * 3 + 1]); fhi = Math.max(fhi, identity[v * 3 + 1]);
    for (let a = 0; a < 3; a++) { mr[a] += ref[v * 3 + a] / nv; mf[a] += identity[v * 3 + a] / nv; }
  }
  const sc = (fhi - flo) / (rhi - rlo);
  const shift = [0, 1, 2].map((a) => mf[a] - sc * mr[a]);
  const inRef = (i: number, a: number) => (rest[i * 3 + a] - shift[a]) / sc;

  const free = new Float32Array(count);
  const groups = new Map<number, { n: number; y: number; z: number }>();
  for (let i = 0; i < count; i++) {
    const g = groups.get(find(i)) ?? { n: 0, y: 0, z: 0 };
    g.n++; g.y += inRef(i, 1); g.z += inRef(i, 2);
    groups.set(find(i), g);
  }
  for (let i = 0; i < count; i++) {
    const g = groups.get(find(i))!;
    const y = g.y / g.n, z = g.z / g.n;
    free[i] = g.n < 400 && z > 0.1 && y > 0.735 && y < 0.79 ? 0 : 1;
  }

  // the middle of the skull
  const centre = [0, 0.75, 0.03].map((c, a) => c * sc + shift[a]) as [number, number, number];
  centre[0] = 0;

  const dir = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const drop = new Float32Array(count);
  const room = new Float32Array(count).fill(Infinity);
  let hy = -Infinity, ly = Infinity;
  for (let i = 0; i < count; i++) {
    if (!free[i]) continue;
    hy = Math.max(hy, rest[i * 3 + 1]);
    ly = Math.min(ly, rest[i * 3 + 1]);
  }
  const far: number[] = [];
  const zones = HAIR_ZONES.length;
  const zone = new Float32Array(count * zones);
  const top = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    const dx = x - centre[0], dz = z - centre[2];
    let dy = y - centre[1];
    // hanging hair belongs to the patch it falls from, so a whole lock changes together
    const up = Math.min(1, Math.max(0, (dy / (Math.hypot(dx, dy, dz) || 1) + 0.1) / 0.7));
    top[i] = up * up * (3 - 2 * up);
    const zy = dy > 0 ? dy : dy * 0.12;
    const r = Math.hypot(dx, zy, dz) || 1;
    for (let k = 0; k < zones; k++) zone[i * zones + k] = zoneWeight(k, dx / r, zy / r, dz / r);
    if (dy < 0) dy *= 0.3;
    const l = Math.hypot(dx, dy, dz) || 1;
    dir[i * 3] = dx / l; dir[i * 3 + 1] = dy / l; dir[i * 3 + 2] = dz / l;
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 3; k++) {
      const c = bind[i * 3 + k], w = weight[i * 3 + k];
      sx += identity[c * 3] * w; sy += identity[c * 3 + 1] * w; sz += identity[c * 3 + 2] * w;
    }
    depth[i] = Math.hypot(x - sx, y - sy, z - sz);
    if (free[i]) far.push(depth[i]);
    drop[i] = Math.min(1, Math.max(0, (hy - y) / (hy - ly || 1)));
    const rx = inRef(i, 0), ry = inRef(i, 1), rz = inRef(i, 2);
    if (Math.abs(rx) < 0.065 && rz > 0.07 && ry > 0.7) room[i] = Math.max(0, ry - 0.752) * sc;
  }
  far.sort((a, b) => a - b);
  const deep = far[Math.floor(far.length * 0.95)] || 0.01;
  for (let i = 0; i < count; i++) depth[i] = Math.min(1, depth[i] / deep);
  const meshNormal = new Float32Array(count * 3);
  meshNormals(rest, index, meshNormal);
  return { count, rest, normal, occ, index, bind, weight, identity, dir, depth, drop, free, room, meshNormal, centre, zone, top };
}

const hairScratch = { n: new Float32Array(0) };

/** Smooth value noise between -1 and 1, the same everywhere it is computed. */
function lumps(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => {
    let k = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
    k = Math.imul(k ^ (k >>> 13), 1274126177);
    return ((k ^ (k >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x0 = lerp(lerp(h(ix, iy, iz), h(ix + 1, iy, iz), ux), lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), ux), uy);
  const x1 = lerp(lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), ux), lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), ux), uy);
  return lerp(x0, x1, uz);
}

/** Reshapes the hair by the numbers kept after the cage: for the whole head, then for each patch. */
function restyle(hair: Hair, cage: Float32Array, base: number, P: Float32Array, N: Float32Array, at: number) {
  const { rest, dir, depth, drop, free, room, centre, count, zone, top } = hair;
  const zones = HAIR_ZONES.length;
  const q = HAIR_QUALITIES;
  for (let i = 0; i < count; i++) {
    if (!free[i]) continue;
    let V = cage[base], L = cage[base + 1], S = cage[base + 2], W = cage[base + 3];
    for (let k = 0; k < zones; k++) {
      const w = zone[i * zones + k];
      if (w < 0.002) continue;
      const o = base + (1 + k) * q;
      V += cage[o] * w; L += cage[o + 1] * w; S += cage[o + 2] * w; W += cage[o + 3] * w;
    }
    const phase = W < 0 ? 37 : 0;
    const wild = Math.abs(W);
    const o = (at + i) * 3;
    const t = depth[i], d = drop[i];
    const low = P[o + 1] - room[i];
    // fuller hair rises off the scalp, flatter hair presses down onto it
    const out = V > 0 ? V * 0.011 * (0.3 + 0.7 * t) : V * 0.008 * t;
    let x = P[o] + dir[i * 3] * out, y = P[o + 1] + dir[i * 3 + 1] * out, z = P[o + 2] + dir[i * 3 + 2] * out;
    // longer hair hangs lower at the ends, shorter hair is drawn up
    const fall = d ** 1.5;
    y -= L * (L > 0 ? 0.032 : 0.024) * fall;
    if (L > 0) {
      const hl = Math.hypot(dir[i * 3], dir[i * 3 + 2]) || 1;
      x += dir[i * 3] / hl * L * 0.005 * fall;
      z += dir[i * 3 + 2] / hl * L * 0.005 * fall;
    }
    y = Math.max(y, low);
    // combed over to one side: the top slides round the skull, the hanging hair stays
    if (S && top[i]) {
      const a = S * 0.3 * (0.35 + 0.65 * t) * top[i];
      const dx = x - centre[0], dy = y - centre[1];
      x = centre[0] + dx * Math.cos(a) - dy * Math.sin(a);
      y = centre[1] + dx * Math.sin(a) + dy * Math.cos(a);
    }
    // tufts lift and sink along the surface
    if (wild) {
      const n = lumps(rest[i * 3] * 70 + phase, rest[i * 3 + 1] * 55, rest[i * 3 + 2] * 70);
      const a = wild * 0.0055 * (0.25 + 0.75 * t) * n;
      x += hair.normal[i * 3] * a; y += hair.normal[i * 3 + 1] * a; z += hair.normal[i * 3 + 2] * a;
    }
    P[o] = x; P[o + 1] = y; P[o + 2] = z;
  }
  if (hairScratch.n.length !== count * 3) hairScratch.n = new Float32Array(count * 3);
  const now = hairScratch.n;
  meshNormals(P, hair.index, now, at);
  for (let i = 0; i < count; i++) {
    const o = (at + i) * 3;
    const x = hair.normal[i * 3] + now[i * 3] - hair.meshNormal[i * 3];
    const y = hair.normal[i * 3 + 1] + now[i * 3 + 1] - hair.meshNormal[i * 3 + 1];
    const z = hair.normal[i * 3 + 2] + now[i * 3 + 2] - hair.meshNormal[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    N[o] = x / l; N[o + 1] = y / l; N[o + 2] = z / l;
  }
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
    const base = shared.verts * 3;
    let styled = false;
    for (let k = base; k < Math.min(cage.length, base + HAIR_SLOTS); k++) if (cage[k]) { styled = true; break; }
    if (styled && cage.length >= base + HAIR_SLOTS) restyle(hair, cage, base, P, N, n);
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
