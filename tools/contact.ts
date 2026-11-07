// Fast offline contact sheet: every emotion, smooth shaded, no browser needed.
import { writeFileSync } from 'node:fs';
import { EMOTIONS } from '../src/data/expressions';
import { applyEmotion, bakeSurface, blankSurface, dress, loadHair, loadShared, restShape } from '../src/sculpture/bust';
import type { FigureId } from '../src/data/figures';
import { applyContribution, Head, prng, SETTLE_EVERY } from '../src/sculpture/mutations';

const fig = (process.argv[2] || 'mother') as FigureId;
const names = (process.argv[3] ? process.argv[3].split(process.argv[3].includes('|') ? '|' : ',') : Object.keys(EMOTIONS));
const shared = loadShared(2);
const rest = restShape(fig);
const head = new Head(shared, rest, 1);
const fold = +(process.env.FOLD || 0);
const rr = prng(fig.length * 91);
for (let i = 1; i <= fold; i++) { applyContribution(head, Math.floor(rr() * 2 ** 31)); if (i % SETTLE_EVERY === 0) head.settle(); }
const W = 300, H = 380, cols = 6, rows = Math.ceil(names.length / cols);
const img = new Uint8Array(W * cols * H * rows);
const hair = loadHair(fig, rest, shared.ref);
const surf = blankSurface(shared, hair);
const tri = dress(shared, hair).index;
const ang0 = +(process.argv[4] || 0.32);
let ymin = 1e9, ymax = -1e9;
for (let i = 0; i < rest.length; i += 3) { ymin = Math.min(ymin, rest[i + 1]); ymax = Math.max(ymax, rest[i + 1]); }
names.forEach((entry, n) => {
  const [pose, op] = entry.split('#');
  const [name, turn] = pose.split('@');
  const ang = turn ? +turn : ang0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let cage = Float32Array.from(head.cage);
  if (op) {
    const h = new Head(shared, rest, 1);
    h.cage.set(head.cage);
    if (op.startsWith('seed=')) for (const n of op.slice(5).split('+')) applyContribution(h, +n);
    // eslint-disable-next-line no-new-func
    else new Function('h', op.replace(/;/g, ';h.').replace(/^/, 'h.'))(h);
    cage = Float32Array.from(h.cage);
  }
  applyEmotion(shared, cage, EMOTIONS[name] ?? {}, 1, 1);
  bakeSurface(shared, cage, null, surf, hair);
  const P = surf.position, N = surf.normal;
  const zb = new Float32Array(W * H).fill(-1e9);
  const sh = new Float32Array(W * H);
  const sc = H / (ymax - ymax * 0.68 + 0.02) * 0.62;
  const yc = ymax - 0.135;
  const px = (v: number) => W / 2 + (P[v * 3] * ca + P[v * 3 + 2] * sa) * sc;
  const py = (v: number) => H / 2 - (P[v * 3 + 1] - yc) * sc;
  const pz = (v: number) => -P[v * 3] * sa + P[v * 3 + 2] * ca;
  for (let i = 0; i < tri.length; i += 3) {
    {
      const a = tri[i], b = tri[i + 1], c = tri[i + 2];
      const x0 = px(a), y0 = py(a), x1 = px(b), y1 = py(b), x2 = px(c), y2 = py(c);
      const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (d >= 0) continue;
      const mnx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), mxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const mny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), mxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const z0 = pz(a), z1 = pz(b), z2 = pz(c);
      for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) {
        const u = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
        const v = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
        const w = 1 - u - v;
        if (u < -0.001 || v < -0.001 || w < -0.001) continue;
        const z = u * z0 + v * z1 + w * z2;
        if (z <= zb[y * W + x]) continue;
        zb[y * W + x] = z;
        const nx = u * N[a * 3] + v * N[b * 3] + w * N[c * 3];
        const ny = u * N[a * 3 + 1] + v * N[b * 3 + 1] + w * N[c * 3 + 1];
        const nz = u * N[a * 3 + 2] + v * N[b * 3 + 2] + w * N[c * 3 + 2];
        const rx = nx * ca + nz * sa, rz = -nx * sa + nz * ca;
        const l = Math.hypot(rx, ny, rz) || 1;
        const occ = u * surf.extra[a * 2 + 1] + v * surf.extra[b * 2 + 1] + w * surf.extra[c * 2 + 1];
        sh[y * W + x] = (0.18 + 0.82 * Math.max(0, (-0.42 * rx + 0.56 * ny + 0.71 * rz) / l)) * (0.35 + 0.65 * occ);
      }
    }
  }
  const ox = (n % cols) * W, oy = Math.floor(n / cols) * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[(oy + y) * W * cols + ox + x] = Math.min(255, sh[y * W + x] * 255);
});
writeFileSync(process.env.OUT!, Buffer.concat([Buffer.from(`P5\n${W * cols} ${H * rows}\n255\n`), Buffer.from(img)]));
console.log('verts', shared.sub.verts, 'names', names.join(' '));
