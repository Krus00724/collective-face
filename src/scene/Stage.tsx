import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FIGURE_IDS } from '../data/figures';
import { WRINKLES } from '../data/wrinkles';
import { debug } from '../debug';
import { Family } from '../sculpture/family';
import { useStore } from '../store';
import { BACKDROP } from '../theme';
import { Bust } from './Bust';
import { CameraRig } from './CameraRig';
import { hand, watchHand } from './pointer';
import { Lighting } from './Lighting';
import { bakeClay } from './plasticine';
import { renderPreview, storePreview } from './previews';

function Director({ family }: { family: Family }) {
  const three = useThree();
  const frames = useRef(0);
  useEffect(() => { debug.expose({ __loop: three.setFrameloop, __three: three }); }, [three]);
  useEffect(watchHand, []);
  useFrame((_, dt) => {
    hand.still += dt;
    family.tick(Math.min(100, dt * 1000));
    frames.current++;
    if (frames.current === 3) useStore.getState().set({ ready: true });
    const state = useStore.getState();
    if (state.view === 'archive' && frames.current % 30 === 0) {
      const missing = family.weeks.find((w) => !state.previews[w.iso]);
      if (missing) storePreview(missing.iso, renderPreview(three.gl, three.scene, family, missing));
    }
    // shadows are the costliest pass, and only need every frame while a form is changing
    // the heads never quite hold still now, so the shadows follow every other frame
    if (family.moving() || hand.pressing || frames.current % 2 === 0) three.gl.shadowMap.needsUpdate = true;
  });
  return null;
}

/** Builds everything that needs the renderer: clay tiles, the wrinkle map, then the family. */
function Boot({ quality, calm, onFamily }: { quality: 'high' | 'low'; calm: boolean; onFamily: (f: Family) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let live = true;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    new THREE.TextureLoader().loadAsync(WRINKLES).then((wrinkles) => {
      if (!live) return;
      wrinkles.generateMipmaps = true;
      wrinkles.minFilter = THREE.LinearMipmapLinearFilter;
      wrinkles.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      wrinkles.needsUpdate = true;
      const clay = bakeClay(gl, quality === 'high' ? 2048 : 1024);
      onFamily(new Family(debug.on && !debug.high ? 1 : 2, wrinkles, clay, calm));
    });
    return () => { live = false; };
  }, [gl, quality, calm, onFamily]);
  return null;
}

function Pace({ onSlow }: { onSlow: () => void }) {
  const acc = useRef({ t: 0, n: 0, done: false });
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.done) return;
    a.t += dt; a.n++;
    if (a.t > 4) {
      if (a.n / a.t < 26) { a.done = true; onSlow(); }
      a.t = 0; a.n = 0;
    }
  });
  return null;
}

export function Stage({ family, onFamily, quality, reduced }: { family: Family | null; onFamily: (f: Family) => void; quality: 'high' | 'low'; reduced: boolean }) {
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 2));
  const pick = useStore((s) => s.pick);
  // the studio covers the whole page, so the busts rest while someone cuts
  const resting = useStore((s) => s.ready && s.view === 'studio');
  return (
    <Canvas
      className="stage"
      frameloop={resting ? 'never' : 'always'}
      dpr={dpr}
      shadows="variance"
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 22, near: 0.02, far: 60, position: [0, 0.8, 6] }}
      style={{ position: 'fixed', inset: 0 }}
      onPointerMissed={(e) => { if ((e as MouseEvent).button === 0) pick(null); }}
      aria-hidden="true"
    >
      <color attach="background" args={[BACKDROP]} />
      <Boot quality={quality} calm={reduced} onFamily={onFamily} />
      <Lighting quality={quality} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.2} color="#141314" />
      </mesh>
      {family && FIGURE_IDS.map((id) => <Bust key={id} runtime={family.engine.figures[id]} family={family} reduced={reduced} />)}
      {family && <CameraRig family={family} reduced={reduced} />}
      {family && <Director family={family} />}
      <Pace onSlow={() => setDpr((d) => Math.max(1, d * 0.72))} />
    </Canvas>
  );
}
