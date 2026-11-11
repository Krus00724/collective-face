import * as THREE from 'three';
import { EMOTIONS, type Mix } from '../data/expressions';
import { FIGURES, FIGURE_IDS, type FigureId } from '../data/figures';
import { WRINKLE_RECT } from '../data/wrinkles';
import { backdropRGB } from '../theme';
import { applyEmotion, bakeSurface, blankSurface, dress, loadHair, loadShared, restShape, type Hair, type Shared, type Surface } from './bust';
import { applyContribution, Head, SETTLE_EVERY } from './mutations';
import { FRAG_COLOR, FRAG_DIM, FRAG_HEAD, FRAG_LIGHT, FRAG_NORMAL, FRAG_ROUGH, VERT_DEPTH, VERT_HEAD, VERT_NORMAL, VERT_POSITION } from './shaders';

/** A frozen state: the shape of the clay, and the expression it holds. */
export interface FrozenState {
  key: string;
  cage: Float32Array;
  emotion: string;
  /** Added on top of the emotion, for a mouth that speaks. */
  extra?: Mix;
}

interface Slot { surface: Surface; pos: THREE.BufferAttribute; nor: THREE.BufferAttribute; ext: THREE.BufferAttribute; key: string }

/** They are young: at rest the skin is smooth, and the wrinkles come when a face moves. */
const AGE: Record<FigureId, number> = { mother: 0.08, father: 0.12, child: 0.06 };
const FOLD: Record<FigureId, number> = { mother: 0.02, father: 0.04, child: 0.02 };
const EXPRESSION_SCALE: Record<FigureId, number> = { mother: 1, father: 1.04, child: 0.96 };

export interface StaticBuffers {
  shared: Shared;
  ref: THREE.BufferAttribute;
  face: THREE.BufferAttribute;
  part: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
  head: THREE.BufferAttribute;
  blink: THREE.BufferAttribute;
}

/** One bust: its clay, its head, and two baked surfaces on the GPU. */
export class FigureRuntime {
  readonly head: Head;
  readonly hair: Hair;
  readonly buffers: StaticBuffers;
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly restArea: Float32Array;
  readonly spec: (typeof FIGURES)[FigureId];
  /** Eye level and depth, for framing the face. */
  readonly face: { y: number; z: number };
  /** Lowest point of the bust, for standing it on its socle. */
  readonly baseY: number;
  applied = 0;
  private slots: [Slot, Slot, Slot];
  private front = 0;

  constructor(readonly id: FigureId, shared: Shared, wrinkles: THREE.Texture, detail: THREE.Texture) {
    const spec = FIGURES[id];
    this.spec = spec;
    const rest = restShape(id);
    const hair = loadHair(id, rest, shared.ref);
    this.hair = hair;
    const still = dress(shared, hair);
    // closing the eyes, as a movement the shader can add at any moment
    const open = blankSurface(shared);
    const shut = blankSurface(shared);
    const lids = Float32Array.from(rest);
    applyEmotion(shared, lids, { 'eye-closure': 1 }, 1, EXPRESSION_SCALE[id]);
    bakeSurface(shared, rest, null, open);
    bakeSurface(shared, lids, null, shut);
    const blink = new Float32Array(still.ref.length);
    for (let i = 0; i < open.position.length; i++) blink[i] = shut.position[i] - open.position[i];
    let nx = 0, ny = 0, nz = 0, nn = 0;
    for (let v = 0; v < shared.verts; v++) {
      const y = shared.ref[v * 3 + 1];
      if (y > 0.575 && y < 0.615) { nx += rest[v * 3]; ny += rest[v * 3 + 1]; nz += rest[v * 3 + 2]; nn++; }
    }
    const buffers: StaticBuffers = {
      shared,
      ref: new THREE.BufferAttribute(still.ref, 3),
      face: new THREE.BufferAttribute(still.face, 2),
      part: new THREE.BufferAttribute(still.part, 1),
      index: new THREE.BufferAttribute(still.index, 1),
      head: new THREE.BufferAttribute(still.head, 1),
      blink: new THREE.BufferAttribute(blink, 3),
    };
    this.buffers = buffers;
    let ey = 0, ez = 0, en = 0;
    for (let v = 0; v < shared.verts; v++) if (shared.part[v] === 3) { ey += rest[v * 3 + 1]; ez += rest[v * 3 + 2]; en++; }
    this.face = { y: ey / en, z: ez / en };
    this.head = new Head(shared, rest, EXPRESSION_SCALE[id]);
    let low = Infinity;
    for (let i = 1; i < rest.length; i += 3) low = Math.min(low, rest[i]);
    this.baseY = low;
    const scratch = blankSurface(shared);
    this.restArea = bakeSurface(shared, rest, null, scratch);
    const slot = (): Slot => {
      const surface = blankSurface(shared, hair);
      return {
        surface,
        pos: new THREE.BufferAttribute(surface.position, 3).setUsage(THREE.DynamicDrawUsage),
        nor: new THREE.BufferAttribute(surface.normal, 3).setUsage(THREE.DynamicDrawUsage),
        ext: new THREE.BufferAttribute(surface.extra, 2).setUsage(THREE.DynamicDrawUsage),
        key: '',
      };
    };
    this.slots = [slot(), slot(), slot()];
    this.geometry.setIndex(buffers.index);
    this.geometry.setAttribute('aRef', buffers.ref);
    this.geometry.setAttribute('aFace', buffers.face);
    this.geometry.setAttribute('aPart', buffers.part);
    this.geometry.setAttribute('aHead', buffers.head);
    this.geometry.setAttribute('aBlink', buffers.blink);
    this.attach(0, 1);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 0.6);

    this.uniforms = {
      uMorph: { value: 0 }, uWave: { value: 0 }, uRipple: { value: 0 }, uTime: { value: 0 },
      uDetail: { value: detail }, uWrinkle: { value: wrinkles },
      uRect: { value: new THREE.Vector4(WRINKLE_RECT[0], WRINKLE_RECT[2], WRINKLE_RECT[1] - WRINKLE_RECT[0], WRINKLE_RECT[3] - WRINKLE_RECT[2]) },
      uAge: { value: AGE[id] }, uFoldBase: { value: FOLD[id] }, uGrain: { value: [0.34, 0.4, 0.62][spec.clay.kind] },
      uDeep: { value: new THREE.Color(spec.clay.deep) }, uPale: { value: new THREE.Color(spec.clay.pale) },
      uBlink: { value: 0 }, uTurn: { value: new THREE.Vector3() }, uNeck: { value: new THREE.Vector3(nx / nn, ny / nn, nz / nn) },
      uPokeO: { value: new THREE.Vector3() }, uPokeD: { value: new THREE.Vector3(0, 0, -1) }, uPoke: { value: 0 },
      uBreath: { value: 0 }, uGaze: { value: new THREE.Vector2() },
      uDim: { value: 0 }, uDimTo: { value: new THREE.Vector3(...backdropRGB()) },
    };
    this.material = new THREE.MeshStandardMaterial({ color: spec.clay.base, roughness: 0.72, metalness: 0, envMapIntensity: 1 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_POSITION);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_LIGHT}`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FRAG_DIM}`);
    };
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', VERT_DEPTH);
    };
  }

  private attach(a: number, b: number) {
    const g = this.geometry;
    const A = this.slots[a];
    const B = this.slots[b];
    g.setAttribute('position', A.pos);
    g.setAttribute('normal', A.nor);
    g.setAttribute('aExtra', A.ext);
    g.setAttribute('posB', B.pos);
    g.setAttribute('norB', B.nor);
    g.setAttribute('extB', B.ext);
  }

  private bake(slot: Slot, state: FrozenState) {
    const cage = Float32Array.from(state.cage);
    applyEmotion(this.buffers.shared, cage, EMOTIONS[state.emotion] ?? {}, 1, EXPRESSION_SCALE[this.id]);
    if (state.extra) applyEmotion(this.buffers.shared, cage, state.extra, 1, EXPRESSION_SCALE[this.id]);
    bakeSurface(this.buffers.shared, cage, this.restArea, slot.surface, this.hair);
    slot.key = state.key;
    slot.pos.needsUpdate = true;
    slot.nor.needsUpdate = true;
    slot.ext.needsUpdate = true;
  }

  /** Makes A and B show these two states, baking only what is not already on the GPU. */
  arrange(a: FrozenState, b: FrozenState) {
    const s0 = this.slots[this.front];
    const s1 = this.slots[1 - this.front];
    if (s0.key === b.key && s1.key === a.key && a.key !== b.key) {
      this.front = 1 - this.front;
    } else {
      if (s0.key !== a.key) this.bake(s0, a);
      if (s1.key !== b.key) this.bake(s1, b);
    }
    this.attach(this.front, 1 - this.front);
  }

  /** Renders a one-off state through a third surface, leaving A and B untouched. */
  withState(state: FrozenState, fn: () => void) {
    const c = this.slots[2];
    if (c.key !== state.key) this.bake(c, state);
    const morph = this.uniforms.uMorph.value;
    const wave = this.uniforms.uWave.value;
    this.uniforms.uMorph.value = 0;
    this.uniforms.uWave.value = 0;
    this.attach(2, 2);
    fn();
    this.attach(this.front, 1 - this.front);
    this.uniforms.uMorph.value = morph;
    this.uniforms.uWave.value = wave;
  }

  /** Dense geometry of a state, for export. */
  solid(state: FrozenState) {
    const surface = blankSurface(this.buffers.shared, this.hair);
    const cage = Float32Array.from(state.cage);
    applyEmotion(this.buffers.shared, cage, EMOTIONS[state.emotion] ?? {}, 1, EXPRESSION_SCALE[this.id]);
    bakeSurface(this.buffers.shared, cage, null, surface, this.hair);
    return surface;
  }

  fold(items: { seed: number; strength?: number }[]) {
    for (const c of items) {
      applyContribution(this.head, c.seed, c.strength ?? 1);
      this.applied++;
      if (this.applied % SETTLE_EVERY === 0) this.head.settle();
    }
  }
}

export interface Engine {
  figures: Record<FigureId, FigureRuntime>;
}

export function createEngine(levels: number, wrinkles: THREE.Texture, details: THREE.Texture[]): Engine {
  const shared = loadShared(levels);
  const figures = {} as Record<FigureId, FigureRuntime>;
  for (const id of FIGURE_IDS) figures[id] = new FigureRuntime(id, shared, wrinkles, details[FIGURES[id].clay.kind]);
  return { figures };
}
