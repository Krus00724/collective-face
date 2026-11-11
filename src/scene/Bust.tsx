import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOSE_LAYOUT } from '../data/figures';
import type { Family } from '../sculpture/family';
import type { FigureRuntime } from '../sculpture/runtime';
import { voiceHub } from '../services/voice';
import { useStore } from '../store';
import { hand } from './pointer';

const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aim = new THREE.Vector3();

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
  geo.setAttribute('aHead', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aBlink', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
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

export function Bust({ runtime, family, reduced }: { runtime: FigureRuntime; family: Family; reduced: boolean }) {
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
  const life = useRef({
    yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0,
    blink: 0, nextBlink: 1 + Math.random() * 4,
    poke: 0, pokeV: 0, seed: Math.random() * 100,
  });

  useFrame(({ camera, clock }, dt) => {
    runtime.uniforms.uTime.value = clock.elapsedTime;
    const s = useStore.getState();
    const dim = s.view === 'about' ? 0.5
      : s.selected ? (s.selected !== runtime.id ? 0.96 : 0)
      : s.hovered && s.hovered !== runtime.id ? 0.62 : 0;
    const u = runtime.uniforms.uDim;
    u.value += (dim - u.value) * (1 - Math.exp(-dt * 3.6));
    const [tx, tz] = s.close ? CLOSE_LAYOUT[runtime.id] : [spec.x, spec.z];
    group.current.position.x += (tx - group.current.position.x) * (1 - Math.exp(-dt * 4.2));
    group.current.position.z += (tz - group.current.position.z) * (1 - Math.exp(-dt * 4.2));
    if (reduced) return;

    const L = life.current;
    const U = runtime.uniforms;
    const t = clock.elapsedTime + L.seed;
    const step = Math.min(dt, 0.05);
    const face = family.faceOf(runtime.id);
    const ry = group.current.rotation.y;

    // what it looks at: the hand if there is one, the bust whose name is under the pointer, otherwise you
    ndc.set(hand.x, hand.y);
    ray.setFromCamera(ndc, camera);
    const away = camera.position.distanceTo(aim.set(face.x, face.y, face.z));
    if (s.hovered && s.hovered !== runtime.id && !s.selected) {
      const other = family.faceOf(s.hovered);
      aim.set(other.x, other.y, other.z + 0.25);
    } else if (hand.present && s.view !== 'archive') {
      aim.copy(ray.ray.direction).multiplyScalar(Math.max(0.2, away - 0.32)).add(ray.ray.origin);
    } else aim.copy(camera.position);
    const dx = aim.x - face.x, dy = aim.y - face.y, dz = aim.z - face.z;
    const lx = dx * Math.cos(ry) - dz * Math.sin(ry);
    const lz = dx * Math.sin(ry) + dz * Math.cos(ry);
    const wantYaw = clamp(Math.atan2(lx, Math.max(0.05, lz)), 0.6);
    const wantPitch = clamp(Math.atan2(dy, Math.hypot(lx, lz)), 0.34);
    // the head goes most of the way, slowly, and never quite holds still
    const sway = Math.sin(t * 0.31) * 0.022 + Math.sin(t * 0.13 + 2) * 0.018;
    const kh = 1 - Math.exp(-step * 3.2);
    const before = L.yaw;
    L.yaw += (clamp(wantYaw * 0.62, 0.3) + sway - L.yaw) * kh;
    L.pitch += (clamp(wantPitch * 0.6, 0.16) + Math.sin(t * 0.23 + 1) * 0.014 - L.pitch) * kh;
    L.roll += (clamp((L.yaw - before) / step * -0.05, 0.05) + Math.sin(t * 0.17) * 0.012 - L.roll) * (1 - Math.exp(-step * 2));
    U.uTurn.value.set(L.yaw, L.pitch, L.roll);
    // the eyes get there first and cover the rest
    const ke = 1 - Math.exp(-step * 11);
    L.gx += (clamp((wantYaw - L.yaw) * 0.011, 0.0034) - L.gx) * ke;
    L.gy += (clamp((wantPitch - L.pitch) * 0.009, 0.002) - L.gy) * ke;
    U.uGaze.value.set(L.gx, L.gy);

    // blinking, sometimes twice
    L.nextBlink -= step;
    if (L.nextBlink <= 0 && L.blink <= 0) {
      L.blink = 0.001;
      L.nextBlink = Math.random() < 0.2 ? 0.3 : 2.2 + Math.random() * 4.2;
    }
    if (L.blink > 0) {
      L.blink += step / 0.17;
      if (L.blink >= 1) L.blink = 0;
    }
    U.uBlink.value = Math.sin(Math.PI * L.blink) ** 0.7 * family.eyesOpen(runtime.id) || 0;
    U.uBreath.value = Math.sin(t * 1.25) * 0.0011;

    // a finger in the clay: it gives, and when you let go it springs back and trembles
    const want = hand.pressing === runtime.id ? 0.014 : hand.over === runtime.id && hand.mouse && !hand.down ? 0.0035 : 0;
    L.pokeV += ((want - L.poke) * 260 - L.pokeV * 13) * step;
    L.poke += L.pokeV * step;
    if (want || Math.abs(L.poke) > 0.00005 || Math.abs(L.pokeV) > 0.0005) {
      if (want) { U.uPokeO.value.copy(ray.ray.origin); U.uPokeD.value.copy(ray.ray.direction); }
      U.uPoke.value = L.poke;
    } else { U.uPoke.value = 0; L.poke = 0; L.pokeV = 0; }

    // each head turns toward you by a degree or two, slowly enough that you doubt it happened
    const to = Math.atan2(camera.position.x - spec.x, camera.position.z - spec.z);
    const delta = Math.atan2(Math.sin(to - spec.facing), Math.cos(to - spec.facing));
    const wanted = spec.facing + Math.max(-0.08, Math.min(0.08, delta * 0.14));
    group.current.rotation.y += (wanted - group.current.rotation.y) * (1 - Math.exp(-dt * 0.4));
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); hand.over = runtime.id; document.body.style.cursor = 'pointer'; };
  const out = () => { if (hand.over === runtime.id) hand.over = null; document.body.style.cursor = ''; };
  const press = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hand.over = runtime.id;
    hand.pressing = runtime.id;
    // up close, a touched face answers
    if (useStore.getState().selected === runtime.id) family.react(runtime.id);
  };
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
      <mesh geometry={hit} material={hitMat} onPointerOver={over} onPointerOut={out} onPointerDown={press} onClick={click} />
    </group>
  );
}
