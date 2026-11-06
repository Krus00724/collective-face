import * as THREE from 'three';
import { FIGURE_IDS } from '../data/figures';
import type { Family, Week } from '../sculpture/family';
import { useStore } from '../store';

const camera = new THREE.PerspectiveCamera(22, 4 / 3, 0.02, 60);

/**
 * The rendered preview of a week. The frozen family is drawn once through a spare surface with a
 * fixed camera and copied to a small canvas before the browser presents anything.
 */
export function renderPreview(gl: THREE.WebGLRenderer, scene: THREE.Scene, family: Family, week: Week): string {
  const canvas = gl.domElement;
  const aspect = canvas.width / canvas.height;
  camera.aspect = aspect;
  const wide = 0.98 / (Math.tan((11 * Math.PI) / 180) * Math.min(aspect, 1.8));
  camera.position.set(0, 0.5, wide);
  camera.lookAt(0, 0.4, 0);
  camera.updateProjectionMatrix();
  const w = 360;
  const h = 200;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const run = (i: number) => {
    if (i < FIGURE_IDS.length) {
      const id = FIGURE_IDS[i];
      family.engine.figures[id].withState(week.states[id], () => run(i + 1));
      return;
    }
    gl.shadowMap.needsUpdate = true;
    gl.render(scene, camera);
    const scale = Math.max(w / canvas.width, h / canvas.height);
    const sw = w / scale;
    const sh = h / scale;
    out.getContext('2d')!.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, w, h);
  };
  run(0);
  gl.shadowMap.needsUpdate = true;
  return out.toDataURL('image/jpeg', 0.8);
}

export function storePreview(iso: string, url: string) {
  const s = useStore.getState();
  s.set({ previews: { ...s.previews, [iso]: url } });
}
