import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** A plain photo studio: a soft overhead wash, a brighter side, a pale bounce from below. */
function useStudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const env = new THREE.Scene();
    const paint = (color: string, pos: [number, number, number], rot: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.rotation.set(...rot);
      env.add(m);
    };
    paint('#7d7c7c', [0, -6, 0], [-Math.PI / 2, 0, 0]);
    paint('#f2f1ef', [0, 7, 0], [Math.PI / 2, 0, 0]);
    paint('#6a6a6a', [0, 0, -9], [0, 0, 0]);
    paint('#d9d8d6', [-9, 1, 0], [0, Math.PI / 2, 0]);
    paint('#8d8c8c', [9, 0, 0], [0, -Math.PI / 2, 0]);
    paint('#b2b1b0', [0, 0, 10], [0, Math.PI, 0]);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(env, 0.03);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.62;
    pmrem.dispose();
    return () => { rt.dispose(); };
  }, [gl, scene]);
}

export function Lighting({ quality }: { quality: 'high' | 'low' }) {
  useStudioEnvironment();
  const scene = useThree((s) => s.scene);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    scene.add(target);
    target.position.set(0, 0.5, 0);
    return () => { scene.remove(target); };
  }, [scene, target]);
  const size = quality === 'high' ? 2048 : 1024;
  return (
    <directionalLight
      target={target} position={[-2.3, 2.5, 2.1]} intensity={2.9} color="#fff9f2"
      castShadow shadow-mapSize-width={size} shadow-mapSize-height={size} shadow-bias={-0.00006} shadow-normalBias={0.004} shadow-radius={6}
      shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={1.4} shadow-camera-bottom={-1.2} shadow-camera-near={0.5} shadow-camera-far={7}
    />
  );
}
