import * as THREE from 'three';

/**
 * Three kinds of clay, painted on the GPU at load from the character of the reference photo:
 * 0 dense sandy dough with fine cracks, 1 stretched fibrous foam full of small pits,
 * 2 crumbly granular dough. The tiles repeat seamlessly and stay sharp at very close range.
 */
const COMMON = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.19)); }
float noise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 j = mod(i + 1.0, per);
  i = mod(i, per);
  return mix(mix(hash(i), hash(vec2(j.x, i.y)), f.x), mix(hash(vec2(i.x, j.y)), hash(j), f.x), f.y);
}
float fbm(vec2 p, float per, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < oct; i++) { s += a * noise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; }
  return s;
}
// cellular noise: distance to the nearest and second nearest seed
vec2 cells(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  float a = 8.0, b = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = hash2(mod(i + g, per));
    float d = length(g + o - f);
    if (d < a) { b = a; a = d; } else if (d < b) { b = d; }
  }
  return vec2(a, b);
}
`;

const CLAY = /* glsl */ `${COMMON}
uniform int uKind;
void main() {
  vec2 p = vUv;
  float h = 0.5, cav = 1.0;
  if (uKind == 0) {
    // sandy dough: broad soft planes, fine sand, thin dry cracks
    vec2 wp = p + (vec2(fbm(p * 6.0, 6.0, 4), fbm(p * 6.0 + 5.0, 6.0, 4)) - 0.5) * 0.06;
    h = 0.42 + 0.3 * fbm(p * 5.0, 5.0, 4);
    float sand = noise(p * 720.0, 720.0) * 0.55 + noise(p * 330.0, 330.0) * 0.45;
    h += (sand - 0.5) * 0.3;
    vec2 c = cells(wp * 7.0, 7.0);
    float crack = smoothstep(0.03, 0.0, c.y - c.x) * smoothstep(0.46, 0.66, fbm(p * 4.0 + 3.0, 4.0, 3));
    h -= crack * 0.3;
    cav = 1.0 - crack * 0.6;
  } else if (uKind == 1) {
    // stretched foam: fibres that swirl with the direction of the pull, pitted by small holes
    vec2 w = vec2(fbm(p * 3.0, 3.0, 4), fbm(p * 3.0 + 7.0, 3.0, 4));
    float ang = (w.x - 0.5) * 7.0;
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 n = vec2(-d.y, d.x);
    float fib = 0.0, a = 0.5;
    vec2 q = p;
    for (int i = 0; i < 5; i++) {
      vec2 st = q * (28.0 * float(1 << i));
      float per = 28.0 * float(1 << i);
      fib += a * (1.0 - abs(noise(st + n * fbm(st * 0.11, per * 0.11 + 1.0, 2) * 4.0 + (w - 0.5) * 16.0, per) * 2.0 - 1.0));
      a *= 0.55;
    }
    vec2 c = cells(p * 70.0 + (w - 0.5) * 6.0, 70.0);
    float pit = smoothstep(0.2, 0.06, c.x) * smoothstep(0.46, 0.66, fbm(p * 7.0 + 2.0, 7.0, 3));
    h = 0.3 + fib * 0.55 + (noise(p * 640.0, 640.0) - 0.5) * 0.14 - pit * 0.3;
    cav = 1.0 - pit * 0.3;
  } else {
    // crumbly dough: granules of several sizes, deep gaps between them
    vec2 wp = p + (vec2(fbm(p * 8.0, 8.0, 3), fbm(p * 8.0 + 5.0, 8.0, 3)) - 0.5) * 0.04;
    vec2 c1 = cells(wp * 44.0, 44.0);
    vec2 c2 = cells(wp * 96.0, 96.0);
    vec2 c3 = cells(wp * 210.0, 210.0);
    float g1 = 1.0 - smoothstep(0.0, 0.72, c1.x);
    float g2 = 1.0 - smoothstep(0.0, 0.72, c2.x);
    float g3 = 1.0 - smoothstep(0.0, 0.72, c3.x);
    float lump = smoothstep(0.34, 0.6, fbm(p * 5.0, 5.0, 3));
    h = 0.3 + mix(0.14, 0.28, lump) * g1 + 0.2 * g2 + 0.14 * g3 + (noise(p * 760.0, 760.0) - 0.5) * 0.1;
    float gap = smoothstep(0.03, 0.0, c1.y - c1.x) * lump;
    h -= gap * 0.16;
    cav = 1.0 - gap * 0.3;
  }
  outColor = vec4(clamp(h, 0.0, 1.0), clamp(cav, 0.0, 1.0), 0.0, 1.0);
}`;

const NORMAL = /* glsl */ `${COMMON}
uniform sampler2D uTex;
uniform float uTexel;
uniform float uK;
void main() {
  float l = texture(uTex, vUv - vec2(uTexel, 0)).r, r = texture(uTex, vUv + vec2(uTexel, 0)).r;
  float d = texture(uTex, vUv - vec2(0, uTexel)).r, u = texture(uTex, vUv + vec2(0, uTexel)).r;
  vec4 s = texture(uTex, vUv);
  vec3 n = normalize(vec3((l - r) * uK, (d - u) * uK, 1.0));
  outColor = vec4(n.xy * 0.5 + 0.5, s.r, s.g);
}`;

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(gl: THREE.WebGLRenderer, frag: string, uniforms: Record<string, THREE.IUniform>, size: number) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
  });
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(tri, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, new THREE.Camera());
  gl.setRenderTarget(prev);
  mat.dispose();
  tri.dispose();
  rt.texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  return rt;
}

export function bakeClay(gl: THREE.WebGLRenderer, size: number) {
  return [0, 1, 2].map((kind) => {
    const height = pass(gl, CLAY, { uKind: { value: kind } }, size);
    const final = pass(gl, NORMAL, { uTex: { value: height.texture }, uTexel: { value: 1 / size }, uK: { value: size / 170 } }, size);
    height.dispose();
    return final.texture;
  });
}
