/**
 * Everything the studio draws, away from the interface. Coordinates are in a 360 unit square, the
 * same on screen and in the file, and a finished mix is 1024 by 1024 pixels.
 */
import { ANCHOR } from './template';

export interface Point { x: number; y: number }
export interface Piece extends Point { id: string; portrait: string; outline: Point[]; rotation: number; scale: number; label?: string }

const SIZE = 1024;
const VIEW = 360;
const K = SIZE / VIEW;
/** Softness of a cut edge, in canvas units. */
export const FEATHER = 5;

export function centerOf(outline: Point[]): Point {
  return outline.reduce((sum, p) => ({ x: sum.x + p.x / outline.length, y: sum.y + p.y / outline.length }), { x: 0, y: 0 });
}

/** A hand drawn outline as a smooth closed curve. */
export function roundedOutline(outline: Point[]) {
  const mid = outline.map((p, i) => {
    const n = outline[(i + 1) % outline.length];
    return [(p.x + n.x) / 2, (p.y + n.y) / 2];
  });
  return `M ${mid[mid.length - 1].join(' ')} ${outline.map((p, i) => `Q ${p.x} ${p.y} ${mid[i].join(' ')}`).join(' ')} Z`;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function load(src: string) {
  let found = images.get(src);
  if (!found) {
    found = new Promise((resolve, reject) => {
      const image = new Image();
      if (/^https?:/.test(src)) image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This portrait could not be read.'));
      image.src = src;
    });
    images.set(src, found);
  }
  return found;
}

function sheet() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.scale(K, K);
  return { canvas, context };
}

function place(context: CanvasRenderingContext2D, piece: Piece) {
  const c = centerOf(piece.outline);
  context.translate(piece.x + c.x, piece.y + c.y);
  context.rotate((piece.rotation * Math.PI) / 180);
  context.scale(piece.scale, piece.scale);
  context.translate(-c.x, -c.y);
}

/** A wide soft blur from three box passes. Canvas filters are missing on Safari. */
function soften(data: Float32Array, radius: number) {
  const w = SIZE;
  const tmp = new Float32Array(data.length);
  const pass = (from: Float32Array, to: Float32Array, step: number, line: number) => {
    const norm = 1 / (2 * radius + 1);
    for (let l = 0; l < w; l++) {
      const o = l * line;
      let sum = from[o] * (radius + 1);
      for (let i = 1; i <= radius; i++) sum += from[o + Math.min(w - 1, i) * step];
      for (let i = 0; i < w; i++) {
        to[o + i * step] = sum * norm;
        sum += from[o + Math.min(w - 1, i + radius + 1) * step] - from[o + Math.max(0, i - radius) * step];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(data, tmp, 1, w);
    pass(tmp, data, w, 1);
  }
}

/** How much of this piece shows at each pixel, from 0 to 1. */
function matte(piece: Piece, radius: number) {
  const { context } = sheet();
  context.save();
  place(context, piece);
  context.fillStyle = '#fff';
  context.fill(new Path2D(roundedOutline(piece.outline)));
  context.restore();
  const rgba = context.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] / 255;
  if (radius > 0) soften(out, radius);
  return out;
}

async function pieceLayer(piece: Piece, sources: Map<string, string>) {
  const image = await load(sources.get(piece.portrait)!);
  const layer = sheet();
  layer.context.save();
  place(layer.context, piece);
  layer.context.drawImage(image, 0, 0, VIEW, VIEW);
  layer.context.restore();
  return layer;
}

/** The mix as you see it while working: cut pieces with soft edges on the last used portrait. */
export async function flatten(base: string, pieces: Piece[], sources: Map<string, string>) {
  const out = sheet();
  out.context.drawImage(await load(sources.get(base)!), 0, 0, VIEW, VIEW);
  for (const piece of pieces) {
    const layer = await pieceLayer(piece, sources);
    const alpha = matte(piece, Math.round(FEATHER * K));
    const pixels = layer.context.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] *= alpha[i];
    layer.context.putImageData(pixels, 0, 0);
    out.context.drawImage(layer.canvas, 0, 0, VIEW, VIEW);
  }
  return out.canvas;
}

interface Plane { w: number; h: number; data: Float32Array }

function smallDown(p: Plane): Plane {
  const w = Math.ceil(p.w / 2);
  const h = Math.ceil(p.h / 2);
  const out = new Float32Array(w * h);
  const tmp = new Float32Array(p.w * p.h);
  const at = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const r = y * p.w;
      tmp[r + x] = (p.data[r + at(x - 2, p.w)] + 4 * p.data[r + at(x - 1, p.w)] + 6 * p.data[r + x] + 4 * p.data[r + at(x + 1, p.w)] + p.data[r + at(x + 2, p.w)]) / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    const yy = y * 2;
    for (let x = 0; x < w; x++) {
      const xx = x * 2;
      out[y * w + x] = (tmp[at(yy - 2, p.h) * p.w + xx] + 4 * tmp[at(yy - 1, p.h) * p.w + xx] + 6 * tmp[yy * p.w + xx] + 4 * tmp[at(yy + 1, p.h) * p.w + xx] + tmp[at(yy + 2, p.h) * p.w + xx]) / 16;
    }
  }
  return { w, h, data: out };
}

function grownUp(p: Plane, w: number, h: number): Plane {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(p.h - 1, y / 2);
    const y0 = Math.floor(fy);
    const y1 = Math.min(p.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(p.w - 1, x / 2);
      const x0 = Math.floor(fx);
      const x1 = Math.min(p.w - 1, x0 + 1);
      const tx = fx - x0;
      const top = p.data[y0 * p.w + x0] * (1 - tx) + p.data[y0 * p.w + x1] * tx;
      const low = p.data[y1 * p.w + x0] * (1 - tx) + p.data[y1 * p.w + x1] * tx;
      out[y * w + x] = top * (1 - ty) + low * ty;
    }
  }
  return { w, h, data: out };
}

const LEVELS = 7;
/**
 * How much of each band a piece keeps, fine to coarse. Features and skin texture stay its own, the
 * broad tone and light come from the face underneath, which is what makes it read as one face.
 */
const OWN_TONE = [1, 1, 1, 1, 1, 0.55, 0];

function gaussians(data: Float32Array) {
  const list: Plane[] = [{ w: SIZE, h: SIZE, data }];
  for (let i = 1; i < LEVELS; i++) list.push(smallDown(list[i - 1]));
  return list;
}

function details(g: Plane[]) {
  return g.map((p, i) => {
    if (i === g.length - 1) return p;
    const up = grownUp(g[i + 1], p.w, p.h);
    const data = new Float32Array(p.data.length);
    for (let k = 0; k < data.length; k++) data[k] = p.data[k] - up.data[k];
    return { ...p, data };
  });
}

/**
 * Melts a piece into what is under it. Each band of detail is mixed over a width that suits it:
 * skin tone and light across a wide area, pores and hair right at the edge.
 */
function melt(under: Float32Array, over: Float32Array, mask: Plane[]) {
  const a = details(gaussians(under));
  const b = details(gaussians(over));
  let result: Plane | null = null;
  for (let i = LEVELS - 1; i >= 0; i--) {
    const m = mask[i].data;
    const take = OWN_TONE[i];
    const data = new Float32Array(m.length);
    for (let k = 0; k < m.length; k++) {
      const w = m[k] * take;
      data[k] = a[i].data[k] * (1 - w) + b[i].data[k] * w;
    }
    if (result) {
      const up = grownUp(result, a[i].w, a[i].h);
      for (let k = 0; k < m.length; k++) data[k] += up.data[k];
    }
    result = { ...a[i], data };
  }
  return result!.data;
}

const nextPaint = () => new Promise<void>((r) => setTimeout(r, 16));

/** One face out of the pieces. It runs here in the browser, so no image goes anywhere. */
export async function blendPieces(base: string, pieces: Piece[], sources: Map<string, string>) {
  const out = sheet();
  out.context.drawImage(await load(sources.get(base)!), 0, 0, VIEW, VIEW);
  const first = out.context.getImageData(0, 0, SIZE, SIZE);
  const n = SIZE * SIZE;
  const rgb: Float32Array[] = [0, 1, 2].map((c) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = first.data[i * 4 + c];
    return p;
  });
  for (const piece of pieces) {
    await nextPaint();
    const layer = (await pieceLayer(piece, sources)).context.getImageData(0, 0, SIZE, SIZE).data;
    const alpha = matte(piece, 4);
    for (let i = 0; i < n; i++) alpha[i] *= layer[i * 4 + 3] / 255;
    const mask = gaussians(alpha);
    for (let c = 0; c < 3; c++) {
      const under = rgb[c];
      const over = new Float32Array(n);
      for (let i = 0; i < n; i++) over[i] = layer[i * 4 + 3] > 0 ? layer[i * 4 + c] : under[i];
      rgb[c] = melt(under, over, mask);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) first.data[i * 4 + c] = Math.max(0, Math.min(255, rgb[c][i]));
    first.data[i * 4 + 3] = 255;
  }
  out.context.putImageData(first, 0, 0);
  return out.canvas;
}

export const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be prepared.'))), 'image/png');
});

/** Lays a photo over the template by three points: the two eyes and the mouth. */
export async function fitPhoto(src: string, taps: Point[]) {
  const [p, q, r] = taps;
  const det = p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y);
  if (Math.abs(det) < 200) throw new Error('Those points are too close together. Try again.');
  const to = [ANCHOR.left, ANCHOR.right, ANCHOR.mouth];
  const solve = (u: number, v: number, w: number) => [
    (u * (q.y - r.y) + v * (r.y - p.y) + w * (p.y - q.y)) / det,
    (u * (r.x - q.x) + v * (p.x - r.x) + w * (q.x - p.x)) / det,
    (u * (q.x * r.y - r.x * q.y) + v * (r.x * p.y - p.x * r.y) + w * (p.x * q.y - q.x * p.y)) / det,
  ];
  const [a, c, e] = solve(to[0][0], to[1][0], to[2][0]);
  const [b, d, f] = solve(to[0][1], to[1][1], to[2][1]);
  const image = await load(src);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, SIZE, SIZE);
  context.setTransform(a, b, c, d, e * K, f * K);
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** A photo of your own, cut square. It lives in this page and goes when the page goes. */
export async function ownPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This photo could not be read. Try a JPG or PNG.'));
      i.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, SIZE, SIZE);
    c.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}
