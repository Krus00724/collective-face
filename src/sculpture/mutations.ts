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
const ramp = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The hair is a separate sculpted mass. Four numbers after the cage say how it has been
 * reshaped: volume, length, sweep and how wild it has become. They start at zero.
 */
export const HAIR_PARAMS = 4;
export type HairParam = 0 | 1 | 2 | 3;

export class Head {
  cage: Float32Array;
  identity: Float32Array;
  private tmp: Float32Array;
  private normal: Float32Array;
  /** How much each cage vertex belongs to the left and the right ear. */
  private ears: [Float32Array, Float32Array];
  /** How much each cage vertex belongs to the neck. */
  private neckBand: Float32Array;

  constructor(readonly shared: Shared, rest: Float32Array, readonly size: number) {
    this.cage = new Float32Array(rest.length + HAIR_PARAMS);
    this.cage.set(rest);
    this.identity = Float32Array.from(this.cage);
    this.tmp = new Float32Array(this.cage.length);
    this.normal = this.normals(rest);
    this.ears = [this.earMask(-1), this.earMask(1)];
    this.neckBand = this.mask((_x, y) => Math.exp(-(((y - 0.595) / 0.03) ** 2)));
  }

  private mask(fn: (x: number, y: number, z: number) => number) {
    const { ref, verts } = this.shared;
    const m = new Float32Array(verts);
    for (let v = 0; v < verts; v++) m[v] = fn(ref[v * 3], ref[v * 3 + 1], ref[v * 3 + 2]);
    return m;
  }

  private earMask(s: number) {
    return this.mask((x, y, z) => {
      const X = x * s;
      if (X < 0.058) return 0;
      return ramp(0.06, 0.071, X) * Math.exp(-(((y - 0.715) / 0.028) ** 4)) * Math.exp(-(((z - 0.043) / 0.02) ** 4));
    });
  }

  /** Weighted centre of the cage under a mask. */
  private middle(m: Float32Array): [number, number, number] {
    const c = this.cage;
    let x = 0, y = 0, z = 0, w = 0;
    for (let v = 0; v < m.length; v++) {
      const a = m[v];
      if (!a) continue;
      x += c[v * 3] * a; y += c[v * 3 + 1] * a; z += c[v * 3 + 2] * a; w += a;
    }
    return [x / (w || 1), y / (w || 1), z / (w || 1)];
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

  /** Turns an ear about its front root, so it stands away from the head or lies flat. */
  earOut(s: number, angle: number) {
    const w = this.ears[s > 0 ? 1 : 0];
    const c = this.cage;
    const [ex, , ez] = this.middle(w);
    const px = ex - s * 0.008 * this.size, pz = ez + 0.012 * this.size;
    for (let v = 0; v < w.length; v++) {
      if (!w[v]) continue;
      const a = angle * s * w[v];
      const dx = c[v * 3] - px, dz = c[v * 3 + 2] - pz;
      c[v * 3] = px + dx * Math.cos(a) - dz * Math.sin(a);
      c[v * 3 + 2] = pz + dx * Math.sin(a) + dz * Math.cos(a);
    }
  }

  /** Grows or shrinks an ear from where it meets the head. */
  earScale(s: number, k: number) {
    const w = this.ears[s > 0 ? 1 : 0];
    const c = this.cage;
    const [ex, ey, ez] = this.middle(w);
    const p = [ex - s * 0.007 * this.size, ey, ez + 0.004 * this.size];
    for (let v = 0; v < w.length; v++) {
      if (!w[v]) continue;
      for (let a = 0; a < 3; a++) c[v * 3 + a] = p[a] + (c[v * 3 + a] - p[a]) * (1 + k * w[v]);
    }
  }

  earLift(s: number, d: number) {
    const w = this.ears[s > 0 ? 1 : 0];
    const c = this.cage;
    for (let v = 0; v < w.length; v++) if (w[v]) c[v * 3 + 1] += d * this.size * w[v];
  }

  /** Lets the lobe hang lower, or pulls it up. */
  earLobe(s: number, d: number) {
    const w = this.ears[s > 0 ? 1 : 0];
    const { ref } = this.shared;
    const c = this.cage;
    for (let v = 0; v < w.length; v++) {
      if (!w[v]) continue;
      const lobe = ramp(0.708, 0.692, ref[v * 3 + 1]);
      c[v * 3 + 1] -= d * this.size * w[v] * lobe;
      c[v * 3 + 2] += d * 0.4 * this.size * w[v] * lobe;
    }
  }

  /** A thicker or thinner neck. */
  girth(k: number) {
    const w = this.neckBand;
    const c = this.cage;
    const [cx, , cz] = this.middle(w);
    for (let v = 0; v < w.length; v++) {
      if (w[v] < 0.01) continue;
      c[v * 3] += (c[v * 3] - cx) * k * w[v];
      c[v * 3 + 2] += (c[v * 3 + 2] - cz) * k * w[v];
    }
  }

  /** Raises the whole head on a longer neck, or sinks it. */
  headLift(d: number) {
    const { ref, verts } = this.shared;
    const c = this.cage;
    for (let v = 0; v < verts; v++) c[v * 3 + 1] += d * this.size * ramp(0.57, 0.64, ref[v * 3 + 1]);
  }

  /** Tilts the head to one side, or tips it forward and back, bending the neck. */
  tilt(angle: number, nod: boolean) {
    const { ref, verts } = this.shared;
    const c = this.cage;
    const [cx, cy, cz] = this.middle(this.neckBand);
    const axis = nod ? 2 : 0;
    const p = nod ? cz : cx;
    for (let v = 0; v < verts; v++) {
      const w = ramp(0.56, 0.66, ref[v * 3 + 1]);
      if (!w) continue;
      const a = angle * w;
      const du = c[v * 3 + axis] - p, dy = c[v * 3 + 1] - cy;
      c[v * 3 + axis] = p + du * Math.cos(a) - dy * Math.sin(a);
      c[v * 3 + 1] = cy + du * Math.sin(a) + dy * Math.cos(a);
    }
  }

  /** The whole head grows or shrinks on the same shoulders. */
  scaleHead(k: number) {
    const { ref, verts } = this.shared;
    const c = this.cage;
    const top = this.mask((_x, y) => (y > 0.67 ? 1 : 0));
    const [cx, cy, cz] = this.middle(top);
    for (let v = 0; v < verts; v++) {
      const w = ramp(0.6, 0.67, ref[v * 3 + 1]);
      if (!w) continue;
      c[v * 3] = cx + (c[v * 3] - cx) * (1 + k * w);
      c[v * 3 + 1] = cy + (c[v * 3 + 1] - cy) * (1 + k * w);
      c[v * 3 + 2] = cz + (c[v * 3 + 2] - cz) * (1 + k * w);
    }
  }

  /** Changes one of the hair numbers. */
  hair(param: HairParam, amount: number) {
    this.cage[this.shared.verts * 3 + param] += amount;
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
    const limit = 0.026 * this.size;
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
    const base = this.shared.verts * 3;
    for (let k = 0; k < HAIR_PARAMS; k++) {
      let p = c[base + k] * 0.97;
      const a = Math.abs(p);
      if (a > 1.2) p = Math.sign(p) * (1.2 + (a - 1.2) * 0.4);
      c[base + k] = p;
    }
  }

  /** Older changes to the hair grow stronger. */
  amplifyHair(gain: number) {
    const base = this.shared.verts * 3;
    for (let k = 0; k < HAIR_PARAMS; k++) this.cage[base + k] *= gain;
  }
}

type Trait = (h: Head, r: Rng, m: number) => void;

const nose: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.3) { const d = signOf(r); h.swell(R.nose, d * m * between(r, 0.0015, 0.0045)); h.bloat(R.nose, d * m * 0.14); }
  else if (k < 0.55) h.push({ ...R.bridge, ry: 0.036 }, signOf(r) * m * 0.0045, signOf(r) * m * 0.0015);
  else if (k < 0.8) h.bloat(R.wings, m * 0.22 * signOf(r), 0);
  else { const d = signOf(r); h.push(R.nose, 0, d * m * 0.0035, -d * m * 0.002); }
};

const eye: Trait = (h, r, m) => {
  const s = signOf(r);
  const k = r();
  const g = R.eye(s);
  if (k < 0.34) h.bloat(g, m * 0.2 * signOf(r));
  else if (k < 0.66) h.push({ ...g, rx: 0.03, ry: 0.024 }, s * m * 0.0034, between(r, -1, 1) * m * 0.0048);
  else if (k < 0.84) h.twirl({ ...g, rx: 0.03, ry: 0.024 }, s * m * 0.3);
  else h.swell(R.brow(s), signOf(r) * m * 0.003);
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
  if (r() < 0.5) h.swell(R.cheek(s), signOf(r) * m * between(r, 0.003, 0.0075));
  else h.swell(R.hollow(s), signOf(r) * m * between(r, 0.003, 0.007));
};

const jaw: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.4) h.push({ x: 0, y: 0.625, z: 0.1, rx: 0.06, ry: 0.03, rz: 0.06 }, 0, signOf(r) * m * 0.006);
  else if (k < 0.7) h.swell(R.jaw(signOf(r)), signOf(r) * m * 0.0065);
  else h.push(R.chin, signOf(r) * m * 0.0048, 0);
};

const forehead: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.5) h.swell({ ...R.forehead, x: between(r, -0.03, 0.03) }, signOf(r) * m * between(r, 0.003, 0.008));
  else if (k < 0.8) h.push(R.forehead, 0, signOf(r) * m * 0.0065);
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
  const k = r();
  if (k < 0.5) h.exaggerate(g, 1 + m * 0.28);
  else if (k < 0.8) h.merge(g);
  else h.amplifyHair(1 + m * 0.4);
};

/** Ears stand out or lie flat, grow, shrink, rise, or their lobes hang. Sometimes both at once. */
const ear: Trait = (h, r, m) => {
  const sides = r() < 0.35 ? [-1, 1] : [signOf(r)];
  const k = r();
  const dir = r() < 0.65 ? 1 : -1;
  for (const s of sides) {
    if (k < 0.4) h.earOut(s, dir * m * between(r, 0.4, 0.7));
    else if (k < 0.7) h.earScale(s, dir * m * between(r, 0.25, 0.4));
    else if (k < 0.85) h.earLift(s, signOf(r) * m * 0.009);
    else h.earLobe(s, dir * m * 0.01);
  }
};

const neck: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.3) h.girth(signOf(r) * m * between(r, 0.18, 0.3));
  else if (k < 0.5) h.headLift(signOf(r) * m * 0.018);
  else if (k < 0.72) h.tilt(signOf(r) * m * between(r, 0.07, 0.12), false);
  else if (k < 0.88) h.tilt(signOf(r) * m * between(r, 0.05, 0.09), true);
  else h.swell({ x: 0, y: 0.6, z: 0.072, rx: 0.014, ry: 0.016, rz: 0.02 }, signOf(r) * m * 0.006);
};

/** The shape of the skull itself: the back, the crown, the temples, the whole size. */
const skull: Trait = (h, r, m) => {
  const k = r();
  if (k < 0.25) h.swell({ x: between(r, -0.025, 0.025), y: 0.77, z: -0.055, rx: 0.055, ry: 0.05, rz: 0.04 }, signOf(r) * m * between(r, 0.008, 0.013));
  else if (k < 0.45) h.push({ x: 0, y: 0.835, z: 0.01, rx: 0.06, ry: 0.035, rz: 0.08 }, 0, signOf(r) * m * 0.012);
  else if (k < 0.62) { const d = signOf(r) * m * 0.008; h.swell(R.temple(1), d); h.swell(R.temple(-1), d); }
  else if (k < 0.82) h.scaleHead(signOf(r) * m * between(r, 0.05, 0.08));
  else h.swell({ x: signOf(r) * 0.045, y: between(r, 0.77, 0.83), z: between(r, -0.04, 0.05), rx: 0.035, ry: 0.03, rz: 0.04 }, signOf(r) * m * 0.01);
};

/** The hair gets fuller or flatter, longer or shorter, combed round, or wild. */
const hair: Trait = (h, r, m) => {
  const k = Math.floor(r() * HAIR_PARAMS) as HairParam;
  h.hair(k, signOf(r) * m * between(r, 0.8, 1.5));
  if (r() < 0.25) h.hair(((k + 1 + Math.floor(r() * 3)) % HAIR_PARAMS) as HairParam, signOf(r) * m * 0.7);
};

const TRAITS: [Trait, number][] = [
  [nose, 11], [eye, 13], [mouth, 12], [cheek, 8], [jaw, 9], [forehead, 6], [symmetry, 8], [thumb, 8], [memory, 6],
  [ear, 9], [neck, 8], [skull, 8], [hair, 13],
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
  let m = between(r, 0.3, 0.65);
  if (r() < 0.1) m *= 2.2;
  trait(head, r, m * strength);
}

export const SETTLE_EVERY = 6;
