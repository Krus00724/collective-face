import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOSE_LAYOUT } from '../data/figures';
import type { FigureRuntime } from '../sculpture/runtime';
import { voiceHub } from '../services/voice';
import { useStore } from '../store';

function socleGeometry(h: number, k: number) {
  const profile: [number, number][] = [
    [0, 0], [0.122, 0], [0.128, 0.02], [0.124, 0.06], [0.1, 0.14], [0.074, 0.3], [0.064, 0.44],
    [0.062, 0.56], [0.058, 0.62], [0, 0.62],
  ];
  const pts = profile.map(([r, y]) => new THREE.Vector2(r * k, (y / 0.62) * h));
  const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(90), 96);
  const n = geo.getAttribute('position').count;
  const extra = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) extra[i * 2 + 1] = 1;
  geo.setAttribute('posB', geo.getAttribute('position'));
  geo.setAttribute('norB', geo.getAttribute('normal'));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  geo.setAttribute('extB', geo.getAttribute('aExtra'));
  geo.setAttribute('aRef', geo.getAttribute('position'));
  geo.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geo;
}

function contactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  r.addColorStop(0, 'rgba(18,17,18,.72)');
  r.addColorStop(0.42, 'rgba(18,17,18,.44)');
  r.addColorStop(1, 'rgba(18,17,18,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function Bust({ runtime, reduced }: { runtime: FigureRuntime; reduced: boolean }) {
  const spec = runtime.spec;
  const group = useRef<THREE.Group>(null!);
  const k = spec.id === 'child' ? 0.78 : 1;
  const socle = useMemo(() => socleGeometry(spec.socle, k), [spec, k]);
  const contact = useMemo(contactShadow, []);
  const hit = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.34, 0.2, 1.1, 10);
    g.translate(0, 0.55, 0);
    return g;
  }, []);
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  const pick = useStore((s) => s.pick);

  useFrame(({ camera, clock }, dt) => {
    runtime.uniforms.uTime.value = clock.elapsedTime;
    const s = useStore.getState();
    const dim = s.view === 'about' ? 0.5
      : s.selected ? (s.selected !== runtime.id ? 0.96 : 0)
      : s.hovered && s.hovered !== runtime.id ? 0.62 : 0;
    const u = runtime.uniforms.uDim;
    u.value += (dim - u.value) * (1 - Math.exp(-dt * 2.4));
    const [tx, tz] = s.close ? CLOSE_LAYOUT[runtime.id] : [spec.x, spec.z];
    group.current.position.x += (tx - group.current.position.x) * (1 - Math.exp(-dt * 3));
    group.current.position.z += (tz - group.current.position.z) * (1 - Math.exp(-dt * 3));
    if (reduced) return;
    // each head turns toward you by a degree or two, slowly enough that you doubt it happened
    const to = Math.atan2(camera.position.x - spec.x, camera.position.z - spec.z);
    const delta = Math.atan2(Math.sin(to - spec.facing), Math.cos(to - spec.facing));
    const wanted = spec.facing + Math.max(-0.08, Math.min(0.08, delta * 0.14));
    group.current.rotation.y += (wanted - group.current.rotation.y) * (1 - Math.exp(-dt * 0.22));
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; };
  const out = () => { document.body.style.cursor = ''; };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    pick(runtime.id);
    if (useStore.getState().view === 'family') voiceHub.playRandom(runtime.id);
  };

  return (
    <group ref={group} position={[spec.x, 0, spec.z]} rotation-y={spec.facing}>
      <mesh
        geometry={runtime.geometry} material={runtime.material} customDepthMaterial={runtime.depthMaterial}
        position-y={spec.socle - runtime.baseY - 0.012} castShadow receiveShadow frustumCulled={false}
      />
      <mesh geometry={socle} material={runtime.material} customDepthMaterial={runtime.depthMaterial} castShadow receiveShadow />
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <planeGeometry args={[0.62 * k, 0.62 * k]} />
        <meshBasicMaterial map={contact} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={hit} material={hitMat} onPointerOver={over} onPointerOut={out} onClick={click} />
    </group>
  );
}
