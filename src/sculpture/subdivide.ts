/**
 * Catmull-Clark subdivision as a reusable plan. The control cage has about 5,600 vertices. All
 * shaping happens there, where it stays smooth and cannot tear, and the plan turns the cage into
 * the dense surface you see. Running a plan is linear, so it costs a few milliseconds.
 */
export interface Polys {
  /** Start of each face in `index`, length faces + 1. */
  start: Uint32Array;
  index: Uint32Array;
  verts: number;
}

interface Stage {
  nV: number;
  nF: number;
  nE: number;
  faces: Polys;
  /** v0, v1, f0, f1 per edge; f1 = -1 on an open boundary. */
  edges: Int32Array;
  vfStart: Uint32Array;
  vf: Uint32Array;
  veStart: Uint32Array;
  ve: Uint32Array;
  boundary: Uint8Array;
}

function plan(faces: Polys): { stage: Stage; next: Polys } {
  const nV = faces.verts;
  const nF = faces.start.length - 1;
  const map = new Map<number, number>();
  const list: number[] = [];
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  for (let f = 0; f < nF; f++) {
    const s = faces.start[f];
    const e = faces.start[f + 1];
    for (let i = s; i < e; i++) {
      const a = faces.index[i];
      const b = faces.index[i + 1 === e ? s : i + 1];
      const k = key(a, b);
      const at = map.get(k);
      if (at === undefined) {
        map.set(k, list.length / 4);
        list.push(a, b, f, -1);
      } else {
        list[at * 4 + 3] = f;
      }
    }
  }
  const edges = Int32Array.from(list);
  const nE = edges.length / 4;
  const vfCount = new Uint32Array(nV + 1);
  const veCount = new Uint32Array(nV + 1);
  for (let i = 0; i < faces.index.length; i++) vfCount[faces.index[i] + 1]++;
  for (let e = 0; e < nE; e++) { veCount[edges[e * 4] + 1]++; veCount[edges[e * 4 + 1] + 1]++; }
  for (let i = 0; i < nV; i++) { vfCount[i + 1] += vfCount[i]; veCount[i + 1] += veCount[i]; }
  const vf = new Uint32Array(vfCount[nV]);
  const ve = new Uint32Array(veCount[nV]);
  const fill1 = vfCount.slice();
  const fill2 = veCount.slice();
  for (let f = 0; f < nF; f++) for (let i = faces.start[f]; i < faces.start[f + 1]; i++) vf[fill1[faces.index[i]]++] = f;
  const boundary = new Uint8Array(nV);
  for (let e = 0; e < nE; e++) {
    const a = edges[e * 4];
    const b = edges[e * 4 + 1];
    ve[fill2[a]++] = e;
    ve[fill2[b]++] = e;
    if (edges[e * 4 + 3] < 0) { boundary[a] = 1; boundary[b] = 1; }
  }
  // new topology: every corner of every face becomes one quad
  const quads = new Uint32Array(faces.index.length * 4);
  let q = 0;
  for (let f = 0; f < nF; f++) {
    const s = faces.start[f];
    const e = faces.start[f + 1];
    for (let i = s; i < e; i++) {
      const v = faces.index[i];
      const next = faces.index[i + 1 === e ? s : i + 1];
      const prev = faces.index[i === s ? e - 1 : i - 1];
      quads[q++] = v;
      quads[q++] = nV + nF + map.get(key(v, next))!;
      quads[q++] = nV + f;
      quads[q++] = nV + nF + map.get(key(prev, v))!;
    }
  }
  const start = new Uint32Array(quads.length / 4 + 1);
  for (let i = 0; i < start.length; i++) start[i] = i * 4;
  return {
    stage: { nV, nF, nE, faces, edges, vfStart: vfCount, vf, veStart: veCount, ve, boundary },
    next: { start, index: quads, verts: nV + nF + nE },
  };
}

function run(st: Stage, src: Float32Array, dst: Float32Array, k: number) {
  const { nV, nF, nE, faces, edges, vfStart, vf, veStart, ve, boundary } = st;
  const fp = nV;
  const ep = nV + nF;
  for (let f = 0; f < nF; f++) {
    const s = faces.start[f];
    const e = faces.start[f + 1];
    const w = 1 / (e - s);
    for (let c = 0; c < k; c++) {
      let sum = 0;
      for (let i = s; i < e; i++) sum += src[faces.index[i] * k + c];
      dst[(fp + f) * k + c] = sum * w;
    }
  }
  for (let e = 0; e < nE; e++) {
    const a = edges[e * 4];
    const b = edges[e * 4 + 1];
    const f0 = edges[e * 4 + 2];
    const f1 = edges[e * 4 + 3];
    for (let c = 0; c < k; c++) {
      dst[(ep + e) * k + c] = f1 < 0
        ? (src[a * k + c] + src[b * k + c]) * 0.5
        : (src[a * k + c] + src[b * k + c] + dst[(fp + f0) * k + c] + dst[(fp + f1) * k + c]) * 0.25;
    }
  }
  for (let v = 0; v < nV; v++) {
    const es = veStart[v];
    const ee = veStart[v + 1];
    if (boundary[v]) {
      for (let c = 0; c < k; c++) {
        let sum = 0;
        let count = 0;
        for (let i = es; i < ee; i++) {
          const e = ve[i];
          if (edges[e * 4 + 3] >= 0) continue;
          const o = edges[e * 4] === v ? edges[e * 4 + 1] : edges[e * 4];
          sum += src[o * k + c];
          count++;
        }
        dst[v * k + c] = count ? 0.75 * src[v * k + c] + (0.25 * sum) / count : src[v * k + c];
      }
      continue;
    }
    const n = ee - es;
    const fs = vfStart[v];
    const fe = vfStart[v + 1];
    const nf = 1 / (fe - fs);
    for (let c = 0; c < k; c++) {
      let F = 0;
      for (let i = fs; i < fe; i++) F += dst[(fp + vf[i]) * k + c];
      let R = 0;
      for (let i = es; i < ee; i++) {
        const e = ve[i];
        R += (src[edges[e * 4] * k + c] + src[edges[e * 4 + 1] * k + c]) * 0.5;
      }
      dst[v * k + c] = (F * nf + (2 * R) / n + (n - 3) * src[v * k + c]) / n;
    }
  }
}

export interface Subdivision {
  stages: Stage[];
  surface: Polys;
  verts: number;
  /** One floats buffer per intermediate level, reused between runs. */
  buffers: Map<number, Float32Array[]>;
}

export function subdivision(cage: Polys, levels: number): Subdivision {
  const stages: Stage[] = [];
  let cur = cage;
  for (let l = 0; l < levels; l++) {
    const { stage, next } = plan(cur);
    stages.push(stage);
    cur = next;
  }
  return { stages, surface: cur, verts: cur.verts, buffers: new Map() };
}

/** Pushes per-vertex data with `k` channels through the plan. `out` receives the dense result. */
export function refine(sub: Subdivision, src: Float32Array, k: number, out: Float32Array) {
  let tmp = sub.buffers.get(k);
  if (!tmp) {
    tmp = sub.stages.slice(0, -1).map((_, i) => new Float32Array(sub.stages[i + 1].nV * k));
    sub.buffers.set(k, tmp);
  }
  let from = src;
  sub.stages.forEach((st, i) => {
    const to = i === sub.stages.length - 1 ? out : tmp![i];
    run(st, from, to, k);
    from = to;
  });
}
