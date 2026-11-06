// Renders a bust head straight on, with a map from pixel to dense vertex, so detected landmarks can
// be placed on the mesh. Usage: node ... <figure|path/to/cage.bin> <out prefix>
import { readFileSync, writeFileSync } from 'node:fs';
import { bakeSurface, blankSurface, loadShared, restShape } from '../src/sculpture/bust';

const which = process.argv[2];
const prefix = process.argv[3];
const shared = loadShared(2);
const cage = which.endsWith('.bin') ? new Float32Array(new Uint8Array(readFileSync(which)).buffer) : restShape(which as 'mother');
const surf = blankSurface(shared);
bakeSurface(shared, cage, null, surf);
const P = surf.position, N = surf.normal, part = shared.densePart;
const q = shared.sub.surface.index;
const S = 1024;
// frame the head: eyes around the middle
let top = -1e9, ey = 0, ez = 0, en = 0;
for (let v = 0; v < cage.length / 3; v++) { top = Math.max(top, cage[v * 3 + 1]); if (shared.part[v] === 3) { ey += cage[v * 3 + 1]; ez += cage[v * 3 + 2]; en++; } }
ey /= en; ez /= en;
const scale = S / 0.34, cx = S / 2, cy = S / 2 - 0.0 * S;
const X = (v: number) => cx + P[v * 3] * scale;
const Y = (v: number) => cy - (P[v * 3 + 1] - (ey - 0.03)) * scale;
const Z = (v: number) => P[v * 3 + 2];
const zb = new Float32Array(S * S).fill(-1e9), id = new Int32Array(S * S).fill(-1);
const rgb = new Uint8Array(S * S * 3).fill(205);
for (let i = 0; i < q.length; i += 4) {
  for (const [a, b, c] of [[q[i], q[i + 1], q[i + 2]], [q[i], q[i + 2], q[i + 3]]]) {
    const x0 = X(a), y0 = Y(a), x1 = X(b), y1 = Y(b), x2 = X(c), y2 = Y(c);
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (d >= 0) continue;
    const mnx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), mxx = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
    const mny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), mxy = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) {
      const u = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
      const v = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      const w = 1 - u - v;
      if (u < -0.002 || v < -0.002 || w < -0.002) continue;
      const z = u * Z(a) + v * Z(b) + w * Z(c);
      if (z <= zb[y * S + x]) continue;
      zb[y * S + x] = z;
      const pick = u > v && u > w ? a : v > w ? b : c;
      id[y * S + x] = pick;
      const nx = u * N[a * 3] + v * N[b * 3] + w * N[c * 3], ny = u * N[a * 3 + 1] + v * N[b * 3 + 1] + w * N[c * 3 + 1], nz = u * N[a * 3 + 2] + v * N[b * 3 + 2] + w * N[c * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      const sh = 0.32 + 0.68 * Math.max(0, (-0.3 * nx + 0.45 * ny + 0.84 * nz) / l);
      const occ = u * surf.extra[a * 2 + 1] + v * surf.extra[b * 2 + 1] + w * surf.extra[c * 2 + 1];
      const k = sh * (0.5 + 0.5 * occ);
      const isEye = part[pick] > 2.5;
      let col = [228, 186, 160];
      if (isEye) {
        const r = Math.hypot(Math.abs(shared.denseRef[pick * 3]) - 0.0294, shared.denseRef[pick * 3 + 1] - 0.7362);
        col = r < 0.0062 ? [58, 42, 34] : [238, 236, 232];
      }
      rgb[(y * S + x) * 3] = Math.min(255, col[0] * k);
      rgb[(y * S + x) * 3 + 1] = Math.min(255, col[1] * k);
      rgb[(y * S + x) * 3 + 2] = Math.min(255, col[2] * k);
    }
  }
}
writeFileSync(prefix + '.ppm', Buffer.concat([Buffer.from(`P6\n${S} ${S}\n255\n`), Buffer.from(rgb)]));
writeFileSync(prefix + '.id.bin', Buffer.from(id.buffer));
writeFileSync(prefix + '.pos.bin', Buffer.from(P.buffer));
console.log(which, 'dense', shared.sub.verts);
