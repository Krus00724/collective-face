import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Family } from '../sculpture/family';
import { useStore } from '../store';

interface Pose { x: number; y: number; z: number; az: number; pol: number; r: number; side: number; lift: number }

const FOV = 22;
const HALF = Math.tan((FOV / 2) * (Math.PI / 180));

/** Distance at which the whole row of three fills the frame. */
const rowDistance = (aspect: number, width: number) => Math.max(width / 2 / (HALF * aspect), 2.6);

function goal(aspect: number, family: Family): Pose {
  const s = useStore.getState();
  const portrait = aspect < 0.85;
  const row = { x: 0, y: portrait ? 0.46 : 0.4, z: 0, az: 0, pol: 0.05, r: rowDistance(aspect, portrait ? 1.18 : 2.05), side: 0, lift: 0 };
  if (s.selected) {
    const f = family.faceOf(s.selected);
    const r = portrait ? 1.22 : 0.98;
    const panel = s.view === 'contribute' && s.phase === 'form';
    return {
      x: f.x, y: f.y, z: f.z, az: f.facing, pol: 0.04, r: panel && !portrait ? 1.02 : r,
      side: panel && !portrait ? -0.135 * Math.min(1.1, aspect / 1.68) : 0,
      lift: portrait && (panel || s.phase === 'done') ? -0.13 : 0,
    };
  }
  if (s.view === 'contribute') return { ...row, side: portrait ? 0 : -0.5, r: row.r * 1.2, lift: portrait ? -0.3 : 0 };
  if (s.view === 'archive') return { ...row, r: row.r * 1.25, lift: portrait ? -0.3 : -0.2 };
  if (s.view === 'about') return { ...row, side: portrait ? 0 : -0.55, r: row.r * 1.15 };
  return row;
}

export function CameraRig({ family, reduced }: { family: Family; reduced: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const dom = useThree((s) => s.gl.domElement);
  const size = useThree((s) => s.size);
  const cur = useRef<Pose | null>(null);
  const user = useRef({ az: 0, pol: 0, zoom: 1, azT: 0, polT: 0, zoomT: 1, dragging: false, x: 0, y: 0 });
  const lastKey = useRef('');

  useEffect(() => {
    const u = user.current;
    const pointers = new Map<number, [number, number]>();
    let pinch = 0;
    const close = () => !!useStore.getState().selected;
    const clampZoom = (z: number) => (close() ? Math.max(0.2, Math.min(1.4, z)) : Math.max(0.5, Math.min(1.25, z)));
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      u.dragging = true; u.x = e.clientX; u.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch > 0) u.zoomT = clampZoom(u.zoomT * (pinch / d));
        pinch = d;
        return;
      }
      if (!u.dragging) return;
      const dx = e.clientX - u.x;
      const dy = e.clientY - u.y;
      u.x = e.clientX; u.y = e.clientY;
      const lim = close() ? 1.45 : 0.75;
      const slow = 0.0034 * Math.min(1, 0.4 + u.zoom);
      u.azT = Math.max(-lim, Math.min(lim, u.azT - dx * slow));
      u.polT = Math.max(-0.36, Math.min(0.62, u.polT + dy * slow * 0.75));
    };
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) u.dragging = false; pinch = 0; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      u.zoomT = clampZoom(u.zoomT * Math.exp(e.deltaY * 0.0011));
    };
    dom.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    return () => {
      dom.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel);
    };
  }, [dom]);

  useFrame(({ clock }, dt) => {
    const aspect = size.width / Math.max(1, size.height);
    const g = goal(aspect, family);
    const s = useStore.getState();
    const u = user.current;
    const key = `${s.view}:${s.selected}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      u.azT = 0; u.polT = 0; u.zoomT = 1;
    }
    if (!cur.current) cur.current = { ...g };
    const c = cur.current;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 1.7);
    (Object.keys(c) as (keyof Pose)[]).forEach((n) => { c[n] += (g[n] - c[n]) * k; });
    const ku = 1 - Math.exp(-dt * 6);
    u.az += (u.azT - u.az) * ku;
    u.pol += (u.polT - u.pol) * ku;
    u.zoom += (u.zoomT - u.zoom) * ku;

    const t = clock.elapsedTime;
    const drift = reduced ? 0 : Math.sin(t * 0.05) * 0.012 + Math.sin(t * 0.023 + 1) * 0.01;
    const az = c.az + u.az + drift;
    const pol = c.pol + u.pol;
    const r = c.r * u.zoom;
    const rx = Math.cos(az);
    const rz = -Math.sin(az);
    const fx = c.x + rx * c.side;
    const fz = c.z + rz * c.side;
    camera.position.set(fx + r * Math.sin(az) * Math.cos(pol), Math.max(0.1, c.y + c.lift + r * Math.sin(pol)), fz + r * Math.cos(az) * Math.cos(pol));
    camera.lookAt(fx, c.y + c.lift, fz);
    if (camera.fov !== FOV) { camera.fov = FOV; camera.updateProjectionMatrix(); }
  });
  return null;
}
