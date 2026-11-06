import type { Point } from './mix';
import { FIT } from './template';

/**
 * Gets a photo ready in the visitor's own browser: finds the face, checks it can be used, makes the
 * background white and fits the face to the template. Nothing is sent anywhere during this. If
 * something is wrong it says what, in words that help with the next photo.
 */
export class Retake extends Error {}

const BASE = '/mediapipe';
const OUT = 768;

interface Solution {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: Record<string, unknown>) => void): void;
  send(i: { image: CanvasImageSource }): Promise<void>;
  reset?(): void;
}
type Maker = new (o: { locateFile: (f: string) => string }) => Solution;

const scripts = new Map<string, Promise<void>>();
function script(src: string) {
  let found = scripts.get(src);
  if (!found) {
    found = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('The face tools could not be loaded.'));
      document.head.appendChild(s);
    });
    scripts.set(src, found);
  }
  return found;
}

let meshReady: Promise<Solution> | null = null;
function mesh() {
  meshReady ??= (async () => {
    await script(`${BASE}/face_mesh/face_mesh.js`);
    const make = (window as unknown as { FaceMesh: Maker }).FaceMesh;
    const fm = new make({ locateFile: (f) => `${BASE}/face_mesh/${f}` });
    fm.setOptions({ maxNumFaces: 2, refineLandmarks: false, minDetectionConfidence: 0.4, minTrackingConfidence: 0.4, selfieMode: false });
    return fm;
  })();
  return meshReady;
}

let cutReady: Promise<Solution> | null = null;
function cutter() {
  cutReady ??= (async () => {
    await script(`${BASE}/selfie_segmentation/selfie_segmentation.js`);
    const make = (window as unknown as { SelfieSegmentation: Maker }).SelfieSegmentation;
    const s = new make({ locateFile: (f) => `${BASE}/selfie_segmentation/${f}` });
    s.setOptions({ modelSelection: 0, selfieMode: false });
    return s;
  })();
  return cutReady;
}

function once<T>(tool: Solution, image: CanvasImageSource, read: (r: Record<string, unknown>) => T) {
  return new Promise<T>((resolve, reject) => {
    tool.onResults((r) => resolve(read(r)));
    tool.send({ image }).catch(reject);
  });
}

function decode(file: Blob) {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Retake('This photo could not be opened. Try a JPG or PNG.'));
    i.src = url;
  }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Loudest problem first, one at a time, so the next photo has one thing to fix. */
function inspect(face: Point[], w: number, h: number, pixels: Uint8ClampedArray) {
  const inside = [10, 152, 234, 454].every((i) => face[i].x > 0.01 && face[i].x < w - 1 && face[i].y > 0.01 && face[i].y < h - 1);
  if (!inside) return 'Your whole face should be in the picture. Step back a little.';
  const width = dist(face[234], face[454]);
  if (width < Math.min(w, h) * 0.26) return 'You are a little far away. Come closer to the camera.';
  const left = dist(face[1], face[234]);
  const right = dist(face[1], face[454]);
  if (Math.abs(left - right) / (left + right) > 0.2) return 'Look straight into the camera, with your head turned neither way.';
  const eyes = (face[33].y + face[263].y) / 2;
  const down = (face[1].y - eyes) / Math.max(1, face[152].y - eyes);
  if (down < 0.28 || down > 0.58) return 'Hold your head level, with the camera at eye height.';
  const open = (dist(face[159], face[145]) + dist(face[386], face[374])) / (dist(face[33], face[133]) + dist(face[362], face[263]));
  if (open < 0.13) return 'Keep your eyes open.';

  // light and sharpness, measured on the cheeks and across the middle of the face
  const box = { x0: Math.floor(Math.min(face[234].x, face[454].x)), x1: Math.ceil(Math.max(face[234].x, face[454].x)), y0: Math.floor(eyes), y1: Math.ceil(face[152].y) };
  const shade = (x: number, y: number) => {
    const i = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
    return 0.3 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2];
  };
  const patch = (p: Point) => {
    let sum = 0, n = 0;
    const r = Math.round(width * 0.06);
    for (let y = -r; y <= r; y += 2) for (let x = -r; x <= r; x += 2) { sum += shade(Math.round(p.x) + x, Math.round(p.y) + y); n++; }
    return sum / n;
  };
  const a = patch(face[117]);
  const b = patch(face[346]);
  const light = (a + b) / 2;
  if (light < 55) return 'It is too dark. Find more light, facing a window if you can.';
  if (light > 235) return 'It is too bright. Move away from the direct light.';
  if (Math.max(a, b) / Math.max(1, Math.min(a, b)) > 2) return 'One side of your face is in shadow. Turn towards the light.';
  const step = Math.max(1, Math.round(width / 180));
  let sum = 0, sq = 0, n = 0;
  for (let y = box.y0 + step; y < box.y1 - step; y += step) {
    for (let x = box.x0 + step; x < box.x1 - step; x += step) {
      const l = 4 * shade(x, y) - shade(x - step, y) - shade(x + step, y) - shade(x, y - step) - shade(x, y + step);
      sum += l; sq += l * l; n++;
    }
  }
  const sharp = sq / Math.max(1, n) - (sum / Math.max(1, n)) ** 2;
  if (sharp < 14) return 'The photo is blurred. Hold the phone still and tap on your face to focus.';
  return null;
}

/** Thin plate spline through the landmarks: bends a photo onto the template without creases. */
function warp(pixels: Uint8ClampedArray, w: number, h: number, face: Point[]) {
  const scale = OUT / 512;
  const to: Point[] = FIT.points.map(([x, y]) => ({ x: x * scale, y: y * scale }));
  const from: Point[] = FIT.key.map((i) => face[i]);

  // a plain fit for everything far from the face
  const stable = [33, 133, 362, 263, 168, 1, 2, 61, 291, 13, 152].map((k) => FIT.key.indexOf(k)).filter((i) => i >= 0);
  const mean = (list: Point[]) => list.reduce((m, p) => ({ x: m.x + p.x / list.length, y: m.y + p.y / list.length }), { x: 0, y: 0 });
  const ca = mean(stable.map((i) => to[i]));
  const cb = mean(stable.map((i) => from[i]));
  let re = 0, im = 0, power = 0;
  for (const i of stable) {
    const ax = to[i].x - ca.x, ay = to[i].y - ca.y, bx = from[i].x - cb.x, by = from[i].y - cb.y;
    re += ax * bx + ay * by;
    im += ax * by - ay * bx;
    power += ax * ax + ay * ay;
  }
  re /= power; im /= power;
  const plain = (p: Point) => ({ x: cb.x + (p.x - ca.x) * re - (p.y - ca.y) * im, y: cb.y + (p.x - ca.x) * im + (p.y - ca.y) * re });
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (OUT - 1);
    for (const p of [{ x: t, y: 0 }, { x: t, y: OUT - 1 }, { x: 0, y: t }, { x: OUT - 1, y: t }]) {
      to.push(p);
      from.push(plain(p));
    }
  }

  const n = to.length;
  const size = n + 3;
  const kernel = (a: Point, b: Point) => {
    const r2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    return r2 > 1e-9 ? r2 * Math.log(r2) : 0;
  };
  const A = Array.from({ length: size }, () => new Float64Array(size + 2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = kernel(to[i], to[j]) + (i === j ? 8 : 0);
    A[i][n] = 1; A[i][n + 1] = to[i].x; A[i][n + 2] = to[i].y;
    A[n][i] = 1; A[n + 1][i] = to[i].x; A[n + 2][i] = to[i].y;
    A[i][size] = from[i].x; A[i][size + 1] = from[i].y;
  }
  for (let c = 0; c < size; c++) {
    let best = c;
    for (let r = c + 1; r < size; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    [A[c], A[best]] = [A[best], A[c]];
    const pivot = A[c][c];
    for (let r = 0; r < size; r++) {
      if (r === c) continue;
      const f = A[r][c] / pivot;
      if (f === 0) continue;
      for (let k = c; k < size + 2; k++) A[r][k] -= f * A[c][k];
    }
  }
  const wx = new Float64Array(size), wy = new Float64Array(size);
  for (let i = 0; i < size; i++) { wx[i] = A[i][size] / A[i][i]; wy[i] = A[i][size + 1] / A[i][i]; }

  const G = 49;
  const gx = new Float32Array(G * G), gy = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const p = { x: (i / (G - 1)) * (OUT - 1), y: (j / (G - 1)) * (OUT - 1) };
      let x = wx[n] + wx[n + 1] * p.x + wx[n + 2] * p.y;
      let y = wy[n] + wy[n + 1] * p.x + wy[n + 2] * p.y;
      for (let k = 0; k < n; k++) {
        const u = kernel(p, to[k]);
        x += wx[k] * u;
        y += wy[k] * u;
      }
      gx[j * G + i] = x;
      gy[j * G + i] = y;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUT;
  const c = canvas.getContext('2d')!;
  const out = c.createImageData(OUT, OUT);
  const K = (G - 1) / (OUT - 1);
  for (let y = 0; y < OUT; y++) {
    const fy = y * K, j = Math.min(G - 2, Math.floor(fy)), ty = fy - j;
    for (let x = 0; x < OUT; x++) {
      const fx = x * K, i = Math.min(G - 2, Math.floor(fx)), tx = fx - i;
      const q = j * G + i;
      const sx = (gx[q] * (1 - tx) + gx[q + 1] * tx) * (1 - ty) + (gx[q + G] * (1 - tx) + gx[q + G + 1] * tx) * ty;
      const sy = (gy[q] * (1 - tx) + gy[q + 1] * tx) * (1 - ty) + (gy[q + G] * (1 - tx) + gy[q + G + 1] * tx) * ty;
      const o = (y * OUT + x) * 4;
      out.data[o + 3] = 255;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out.data[o] = out.data[o + 1] = out.data[o + 2] = 255;
        continue;
      }
      const ax = sx - x0, ay = sy - y0, s = (y0 * w + x0) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out.data[o + ch] = (pixels[s + ch] * (1 - ax) + pixels[s + 4 + ch] * ax) * (1 - ay) + (pixels[s + w * 4 + ch] * (1 - ax) + pixels[s + w * 4 + 4 + ch] * ax) * ay;
      }
    }
  }
  c.putImageData(out, 0, 0);
  return canvas;
}

/** The mask is small: two box passes take the stair steps off its edge. */
function smooth(data: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(data.length);
  const line = (from: Float32Array, to: Float32Array, n: number, count: number, step: number, next: number) => {
    const norm = 1 / (2 * r + 1);
    for (let l = 0; l < count; l++) {
      const o = l * next;
      let sum = from[o] * (r + 1);
      for (let i = 1; i <= r; i++) sum += from[o + Math.min(n - 1, i) * step];
      for (let i = 0; i < n; i++) {
        to[o + i * step] = sum * norm;
        sum += from[o + Math.min(n - 1, i + r + 1) * step] - from[o + Math.max(0, i - r) * step];
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    line(data, tmp, w, h, 1, w);
    line(tmp, data, h, w, w, 1);
  }
}

/** Turns a chosen file into a portrait that fits the library, or says what to change. */
export async function prepare(file: Blob) {
  const image = await decode(file);
  const fit = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.round(image.naturalWidth * fit);
  const h = Math.round(image.naturalHeight * fit);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(image, 0, 0, w, h);

  const tool = await mesh();
  tool.reset?.();
  const found = await once(tool, canvas, (r) => (r.multiFaceLandmarks as { x: number; y: number }[][] | undefined) ?? []);
  if (!found.length) throw new Retake('We could not find a face. Take a new photo, looking at the camera.');
  const faces = found.map((f) => f.map((p) => ({ x: p.x * w, y: p.y * h })));
  // the tracker can report one face twice, so two only count when they stand apart
  const apart = faces.length > 1 && dist(faces[0][1], faces[1][1]) > dist(faces[0][234], faces[0][454]) * 0.5;
  if (apart) throw new Retake('There is more than one face here. Take a photo of just you.');
  const face = faces[0];
  const data = c.getImageData(0, 0, w, h);
  const problem = inspect(face, w, h, data.data);
  if (problem) throw new Retake(problem);

  // white background
  const matte = await once(await cutter(), canvas, (r) => {
    const m = document.createElement('canvas');
    m.width = w;
    m.height = h;
    const mc = m.getContext('2d', { willReadFrequently: true })!;
    mc.imageSmoothingQuality = 'high';
    mc.drawImage(r.segmentationMask as CanvasImageSource, 0, 0, w, h);
    return mc.getImageData(0, 0, w, h).data;
  });
  const soft = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) soft[i] = Math.max(matte[i * 4], matte[i * 4 + 3] === 255 ? 0 : matte[i * 4 + 3]) / 255;
  smooth(soft, w, h, Math.max(2, Math.round(Math.max(w, h) / 320)));
  const px = data.data;
  for (let i = 0; i < w * h; i++) {
    const t = Math.max(0, Math.min(1, (soft[i] - 0.48) / 0.3));
    const a = t * t * (3 - 2 * t);
    for (let k = 0; k < 3; k++) px[i * 4 + k] = px[i * 4 + k] * a + 255 * (1 - a);
  }
  const done = warp(px, w, h, face);
  return done.toDataURL('image/jpeg', 0.9);
}
