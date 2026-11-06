import type { Shared } from './bust';

/**
 * The living head. Every contribution works on the control cage the way hands work on
 * plasticine: press, pinch, drag, swell. The cage cannot tear and the subdivision keeps every
 * result smooth. A recipe picks one trait in secret; the choice is never stored or reported.
 */

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Region { x: number; y: number; z: number; rx: number; ry: number; rz: number }
type Rng = () => number;
const between = (r: Rng, a: number, b: number) => a + (b - a) * r();
const signOf = (r: Rng) => (r() < 0.5 ? -1 : 1);

/** Face regions in metres, in the shared reference head. */
const R = {
  eye: (s: number): Region => ({ x: s * 0.03, y: 0.736, z: 0.118, rx: 0.024, ry: 0.016, rz: 0.03 }),
  brow: (s: number): Region => ({ x: s * 0.032, y: 0.762, z: 0.122, rx: 0.03, ry: 0.012, rz: 0.03 }),
  nose: { x: 0, y: 0.7, z: 0.15, rx: 0.018, ry: 0.02, rz: 0.03 } as Region,
  bridge: { x: 0, y: 0.726, z: 0.14, rx: 0.012, ry: 0.026, rz: 0.03 } as Region,
  wings: { x: 0, y: 0.689, z: 0.14, rx: 0.026, ry: 0.012, rz: 0.03 } as Region,
  mouth: { x: 0, y: 0.665, z: 0.135, rx: 0.034, ry: 0.017, rz: 0.035 } as Region,
  chin: { x: 0, y: 0.628, z: 0.12, rx: 0.032, ry: 0.024, rz: 0.04 } as Region,
  cheek: (s: number): Region => ({ x: s * 0.048, y: 0.697, z: 0.1, rx: 0.028, ry: 0.026, rz: 0.04 }),
  hollow: (s: number): Region => ({ x: s * 0.046, y: 0.664, z: 0.095, rx: 0.026, ry: 0.024, rz: 0.04 }),
  jaw: (s: number): Region => ({ x: s * 0.055, y: 0.64, z: 0.07, rx: 0.03, ry: 0.03, rz: 0.05 }),
  temple: (s: number): Region => ({ x: s * 0.07, y: 0.762, z: 0.06, rx: 0.024, ry: 0.03, rz: 0.04 }),
  forehead: { x: 0, y: 0.798, z: 0.112, rx: 0.06, ry: 0.03, rz: 0.05 } as Region,
  crown: { x: 0, y: 0.836, z: 0.02, rx: 0.07, ry: 0.05, rz: 0.09 } as Region,
  face: { x: 0, y: 0.7, z: 0.11, rx: 0.075, ry: 0.09, rz: 0.08 } as Region,
};

const REACH = 2.5;
export class Head {
  cage: Float32Array;
  identity: Float32Array;
  private tmp: Float32Array;
  private normal: Float32Array;

  constructor(readonly shared: Shared, rest: Float32Array, readonly size: number) {
    this.cage = Float32Array.from(rest);
    this.identity = Float32Array.from(rest);
    this.tmp = new Float32Array(rest.length);
    this.normal = this.normals(rest);
  }

  private normals(p: Float32Array) {
    const { cage: c, verts } = this.shared;
    const n = new Float32Array(verts * 3);
    for (let f = 0; f < c.start.length - 1; f++) {
      const s = c.start[f], e = c.start[f + 1];
      const a = c.index[s], b = c.index[s + 1], d = c.index[e - 1];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[d * 3] - p[a * 3], vy = p[d * 3 + 1] - p[a * 3 + 1], vz = p[d * 3 + 2] - p[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      for (let i = s; i < e; i++) { const v = c.index[i]; n[v * 3] += cx; n[v * 3 + 1] += cy; n[v * 3 + 2] += cz; }
    }
    for (let v = 0; v < verts; v++) {
      const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
      n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
    }
    return n;
  }

  /** Calls fn for every vertex inside a region, with a soft Gaussian weight. */
  private each(g: Region, fn: (v: number, w: number) => void) {
    const { ref, verts } = this.shared;
    const lim = REACH * REACH;
    for (let v = 0; v < verts; v++) {
      const dx = (ref[v * 3] - g.x) / g.rx;
      if (dx * dx > lim) continue;
      const dy = (ref[v * 3 + 1] - g.y) / g.ry;
      if (dy * dy > lim) continue;
      const dz = (ref[v * 3 + 2] - g.z) / g.rz;
      const q = dx * dx + dy * dy + dz * dz;
      if (q > lim) continue;
      fn(v, Math.exp(-q));
    }
  }

  private centre(g: Region) {
    let x = 0, y = 0, z = 0, w = 0;
    const c = this.cage;
    this.each(g, (v, a) => { x += c[v * 3] * a; y += c[v * 3 + 1] * a; z += c[v * 3 + 2] * a; w += a; });
    return [x / (w || 1), y / (w || 1), z / (w || 1)];
  }

  swell(g: Region, amount: number) {
    const { cage: c, normal: n } = this;
    const a = amount * this.size;
    this.each(g, (v, w) => {
      c[v * 3] += n[v * 3] * a * w;
      c[v * 3 + 1] += n[v * 3 + 1] * a * w;
      c[v * 3 + 2] += n[v * 3 + 2] * a * w;
    });
  }

  bloat(g: Region, k: number, ky = k) {
    const [cx, cy, cz] = this.centre(g);
    const c = this.cage;
    this.each(g, (v, w) => {
      c[v * 3] += (c[v * 3] - cx) * k * w;
      c[v * 3 + 1] += (c[v * 3 + 1] - cy) * ky * w;
      c[v * 3 + 2] += (c[v * 3 + 2] - cz) * Math.min(k, ky) * 0.4 * w;
    });
  }

  push(g: Region, x: number, y: number, z = 0) {
    const c = this.cage;
    const s = this.size;
    this.each(g, (v, w) => { c[v * 3] += x * s * w; c[v * 3 + 1] += y * s * w; c[v * 3 + 2] += z * s * w; });
  }

  twirl(g: Region, angle: number) {
    const [cx, cy] = this.centre(g);
    const c = this.cage;
    this.each(g, (v, w) => {
      const a = angle * w;
      const dx = c[v * 3] - cx, dy = c[v * 3 + 1] - cy;
      c[v * 3] = cx + dx * Math.cos(a) - dy * Math.sin(a);
      c[v * 3 + 1] = cy + dx * Math.sin(a) + dy * Math.cos(a);
    });
  }

  shear(g: Region, amount: number) {
    const { ref } = this.shared;
    const c = this.cage;
    const a = amount * this.size;
    this.each(g, (v, w) => { c[v * 3 + 1] += a * w * Math.tanh((ref[v * 3] - g.x) / g.rx); });
  }

  exaggerate(g: Region, gain: number) {
    const { cage: c, identity: i } = this;
    this.each(g, (v, w) => {
      const k = 1 + (gain - 1) * w;
      for (let a = 0; a < 3; a++) c[v * 3 + a] = i[v * 3 + a] + (c[v * 3 + a] - i[v * 3 + a]) * k;
    });
  }

  private smoothStep(amount: number, g?: Region) {
    const { neighbours: nb, verts } = this.shared;
    const { cage: c, identity: id, tmp } = this;
    // smooths the difference from the original, so features fade but never melt
    for (let i = 0; i < c.length; i++) tmp[i] = c[i] - id[i];
    const apply = (v: number, w: number) => {
      const s = nb.start[v], e = nb.start[v + 1];
      if (e === s) return;
      for (let a = 0; a < 3; a++) {
        let sum = 0;
        for (let i = s; i < e; i++) sum += tmp[nb.list[i] * 3 + a];
        c[v * 3 + a] += (sum / (e - s) - tmp[v * 3 + a]) * amount * w;
      }
    };
    if (g) this.each(g, apply);
    else for (let v = 0; v < verts; v++) apply(v, 1);
  }

  merge(g: Region) { this.smoothStep(0.8, g); this.smoothStep(0.8, g); }

  recall(g: Region, amount: number) {
    const { cage: c, identity: i } = this;
    this.each(g, (v, w) => {
      for (let a = 0; a < 3; a++) c[v * 3 + a] += (i[v * 3 + a] - c[v * 3 + a]) * amount * w;
    });
  }

  /** Every few contributions: old traces sink back, neighbours merge, and nothing runs away. */
  settle() {
    const { cage: c, identity: i } = this;
    this.smoothStep(0.22);
    const limit = 0.016 * this.size;
    for (let v = 0; v < this.shared.verts; v++) {
      let dx = (c[v * 3] - i[v * 3]) * 0.97, dy = (c[v * 3 + 1] - i[v * 3 + 1]) * 0.97, dz = (c[v * 3 + 2] - i[v * 3 + 2]) * 0.97;
      const m = Math.hypot(dx, dy, dz);
      if (m > limit) {
        const k = (limit + (m - limit) * 0.3) / m;
        dx *= k; dy *= k; dz *= k;
      }
      c[v * 3] = i[v * 3] + dx; c[v * 3 + 1] = i[v * 3 + 1] + dy; c[v * 3 + 2] = i[v * 3 + 2] + dz;
    }
    this.recall({ ...R.mouth, rx: 0.04, ry: 0.024 }, 0.05);
  }
}

type Trait = (h: Head, r: Rng, m: number) => void;

const nose: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.3) { h.swell(R.nose, m * between(r, 0.0015, 0.0045)); h.bloat(R.nose, m * 0.14); }
  else if (k < 0.55) h.push({ ...R.bridge, ry: 0.036 }, signOf(r) * m * 0.0045, -m * 0.0015);
  else if (k < 0.8) h.bloat(R.wings, m * 0.22 * signOf(r), 0);
  else h.push(R.nose, 0, -m * 0.0035, m * 0.002);
};

const eye: Trait = (h, r, m) => {
  const s = signOf(r);
  const k = r();
  const g = R.eye(s);
  if (k < 0.34) h.bloat(g, m * 0.2 * signOf(r));
  else if (k < 0.66) h.push({ ...g, rx: 0.03, ry: 0.024 }, s * m * 0.0034, between(r, -1, 1) * m * 0.0048);
  else if (k < 0.84) h.twirl({ ...g, rx: 0.03, ry: 0.024 }, s * m * 0.3);
  else h.swell(R.brow(s), m * 0.003);
};

const mouth: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.3) h.bloat(R.mouth, m * 0.2 * signOf(r), 0);
  else if (k < 0.55) h.push({ ...R.mouth, rx: 0.04, ry: 0.024 }, signOf(r) * m * 0.0045, -m * 0.0012);
  else if (k < 0.75) h.shear({ ...R.mouth, rx: 0.036, ry: 0.024 }, signOf(r) * m * 0.0042);
  else if (k < 0.9) h.bloat(R.mouth, 0, m * 0.26 * signOf(r));
  else h.swell(R.mouth, m * 0.0028 * signOf(r));
};

const cheek: Trait = (h, r, m) => {
  const s = signOf(r);
  if (r() < 0.6) h.swell(R.cheek(s), m * between(r, 0.003, 0.0075));
  else h.swell(R.hollow(s), -m * between(r, 0.003, 0.007));
};

const jaw: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.4) h.push({ x: 0, y: 0.625, z: 0.1, rx: 0.06, ry: 0.03, rz: 0.06 }, 0, -m * 0.006);
  else if (k < 0.7) h.swell(R.jaw(signOf(r)), m * 0.0065);
  else h.push(R.chin, signOf(r) * m * 0.0048, 0);
};

const forehead: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.5) h.swell({ ...R.forehead, x: between(r, -0.03, 0.03) }, m * between(r, 0.003, 0.008));
  else if (k < 0.8) h.push(R.forehead, 0, m * 0.0065);
  else h.swell(R.crown, m * 0.008 * signOf(r));
};

const symmetry: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.5) h.shear({ ...R.face, ry: 0.06 }, signOf(r) * m * 0.005);
  else if (k < 0.8) h.twirl({ x: between(r, -0.02, 0.02), y: between(r, 0.65, 0.72), z: 0.11, rx: 0.045, ry: 0.05, rz: 0.08 }, signOf(r) * m * 0.11);
  else h.push({ ...R.face, rx: 0.04 }, signOf(r) * m * 0.0034, 0);
};

/** A stranger's thumb pressed into the clay. */
const thumb: Trait = (h, r, m) => {
  const side = between(r, -1, 1);
  const zone = r();
  const g: Region = zone < 0.5
    ? { x: side * 0.07, y: between(r, 0.62, 0.8), z: 0.08, rx: 0.016, ry: 0.02, rz: 0.03 }
    : zone < 0.8
      ? { x: side * 0.06, y: between(r, 0.8, 0.84), z: between(r, -0.04, 0.09), rx: 0.022, ry: 0.022, rz: 0.03 }
      : { x: side * 0.09, y: between(r, 0.42, 0.52), z: 0.05, rx: 0.026, ry: 0.024, rz: 0.04 };
  h.swell(g, -m * between(r, 0.004, 0.009));
  h.swell({ ...g, rx: g.rx * 1.9, ry: g.ry * 1.9 }, m * 0.0014);
};

/** Earlier traces are pushed further, or melted together. */
const memory: Trait = (h, r, m) => {
  const g: Region = { x: between(r, -0.05, 0.05), y: between(r, 0.63, 0.8), z: 0.1, rx: between(r, 0.025, 0.045), ry: between(r, 0.025, 0.045), rz: 0.06 };
  if (r() < 0.6) h.exaggerate(g, 1 + m * 0.28);
  else h.merge(g);
};

const TRAITS: [Trait, number][] = [
  [nose, 13], [eye, 17], [mouth, 15], [cheek, 9], [jaw, 10], [forehead, 8], [symmetry, 11], [thumb, 10], [memory, 7],
];
const TOTAL = TRAITS.reduce((a, t) => a + t[1], 0);

/** Applies one contribution. Deterministic: same seed, same change, on every device. */
export function applyContribution(head: Head, seed: number, strength = 1) {
  const r = prng(seed);
  let pick = r() * TOTAL;
  let trait = TRAITS[0][0];
  for (const [t, w] of TRAITS) {
    pick -= w;
    if (pick <= 0) { trait = t; break; }
  }
  let m = between(r, 0.2, 0.5);
  if (r() < 0.08) m *= 2.4;
  trait(head, r, m * strength);
}

export const SETTLE_EVERY = 6;
