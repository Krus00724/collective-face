import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FIGURE_IDS, FIGURES } from '../data/figures';
import type { Family, Week } from '../sculpture/family';
import type { FigureRuntime, FrozenState } from '../sculpture/runtime';
import { formatDate } from './archive';

/** Bakes a frozen state into plain geometry. This is what opens in Blender. */
async function glb(rt: FigureRuntime, state: FrozenState): Promise<Uint8Array> {
  const spec = FIGURES[rt.id];
  const surface = rt.solid(state);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(surface.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(surface.normal, 3));
  geo.setAttribute('uv', rt.buffers.face);
  geo.setIndex(rt.buffers.index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: spec.clay.base, roughness: 0.72 }));
  mesh.name = spec.name;
  const buffer = (await new GLTFExporter().parseAsync(mesh, { binary: true })) as ArrayBuffer;
  return new Uint8Array(buffer);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal stored zip. GLB is already binary, and the viewer only saves zips. */
function zip(files: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(head.buffer), name, f.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, f.data.length, true);
    dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

export async function exportWeek(family: Family, week: Week, preview?: string) {
  const files: { name: string; data: Uint8Array }[] = [];
  for (const id of FIGURE_IDS) {
    files.push({ name: `${id}.glb`, data: await glb(family.engine.figures[id], week.states[id]) });
  }
  const meta = {
    work: 'Collective Face',
    week: week.number,
    date: formatDate(week.iso),
    closed: '23:59 Europe/Berlin',
    sample: week.sample,
  };
  files.push({ name: 'week.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });
  if (preview) {
    const bytes = new Uint8Array(await (await fetch(preview)).arrayBuffer());
    files.push({ name: 'preview.jpg', data: bytes });
  }
  const blob = zip(files);
  const filename = `collective-face-week-${String(week.number).padStart(3, '0')}.zip`;
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  const downloads = claude?.use ? ((await claude.use('downloads').catch(() => null)) as { save(r: { filename: string; data: Blob }): Promise<unknown> } | null) : null;
  if (downloads) {
    await downloads.save({ filename, data: blob });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
