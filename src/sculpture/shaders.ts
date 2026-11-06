/**
 * Two baked surfaces per bust, A and B, are blended in the vertex shader, so emotions, contributions
 * and the archive slider all morph through the same code. Everything fine lives in the fragment
 * shader: plasticine grain, and wrinkles that deepen where an expression compresses the skin.
 */
export const VERT_HEAD = /* glsl */ `
attribute vec3 posB;
attribute vec3 norB;
attribute vec2 aExtra;
attribute vec2 extB;
attribute vec3 aRef;
attribute vec2 aFace;
attribute float aPart;
uniform float uMorph;
uniform float uWave;
uniform float uRipple;
uniform float uTime;
varying vec3 vRef;
varying vec2 vFace;
varying vec2 vExtra;
varying float vPart;
varying vec3 vObjN;

float morphAt() {
  if (uWave <= 0.0) return uMorph;
  float ph = (1.0 - clamp((aRef.y - 0.38) / 0.47, 0.0, 1.0)) * 0.7
    + 0.15 * (sin(aRef.x * 41.0 + aRef.z * 23.0) * 0.5 + 0.5) + 0.15 * (sin(aRef.y * 67.0 - aRef.x * 37.0) * 0.5 + 0.5);
  return smoothstep(ph, ph + uWave, uMorph * (1.0 + uWave));
}
`;

export const VERT_NORMAL = /* glsl */ `
float sm = morphAt();
vec3 objectNormal = normalize(mix(normal, norB, sm));
vObjN = objectNormal;
vRef = aRef;
vFace = aFace;
vPart = aPart;
vExtra = mix(aExtra, extB, sm);
`;

const RIPPLE = /* glsl */ `
if (uRipple > 0.0) {
  float rp = sin(aRef.y * 54.0 + uTime * 1.2 + aRef.x * 21.0) * sin(aRef.x * 37.0 - uTime * 0.8 + aRef.z * 29.0);
  transformed += objectNormal * rp * uRipple;
}`;

export const VERT_POSITION = /* glsl */ `
vec3 transformed = mix(position, posB, sm);
${RIPPLE}
`;

export const VERT_DEPTH = /* glsl */ `
float sm = morphAt();
vec3 objectNormal = normalize(mix(normal, norB, sm));
vec3 transformed = mix(position, posB, sm);
${RIPPLE}
`;

export const FRAG_HEAD = /* glsl */ `
uniform mat3 normalMatrix;
uniform sampler2D uDetail;
uniform sampler2D uWrinkle;
uniform vec4 uRect;
uniform float uAge;
uniform float uFoldBase;
uniform float uGrain;
uniform vec3 uDeep;
uniform vec3 uPale;
uniform float uDim;
uniform vec3 uDimTo;
varying vec3 vRef;
varying vec2 vFace;
varying vec2 vExtra;
varying float vPart;
varying vec3 vObjN;

float wrinkleAt(vec2 uv, float press) {
  vec4 w = texture2D(uWrinkle, uv);
  float fold = (w.r - 0.5019) * 2.77;
  float line = (w.g - 0.5019) * 2.77;
  return fold * clamp(uFoldBase + press * 3.0, 0.0, 1.5) + line * uAge;
}
vec3 bumpN(vec3 p, vec3 n, vec2 d) {
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (d.x * r1 + d.y * r2);
  return normalize(abs(det) * n - g);
}
`;

/** Runs after <color_fragment>. Samples the clay and works out the colour. */
export const FRAG_COLOR = /* glsl */ `
vec3 an = normalize(vObjN);
vec3 tw = pow(abs(an), vec3(5.0));
tw /= tw.x + tw.y + tw.z;
vec4 dx1 = texture2D(uDetail, vRef.zy * 6.1);
vec4 dy1 = texture2D(uDetail, vRef.xz * 6.1);
vec4 dz1 = texture2D(uDetail, vRef.xy * 6.1);
vec4 dx2 = texture2D(uDetail, vRef.zy * 19.3 + 0.37);
vec4 dy2 = texture2D(uDetail, vRef.xz * 19.3 + 0.37);
vec4 dz2 = texture2D(uDetail, vRef.xy * 19.3 + 0.37);
vec4 clay1 = dx1 * tw.x + dy1 * tw.y + dz1 * tw.z;
vec4 clay2 = dx2 * tw.x + dy2 * tw.y + dz2 * tw.z;
float clayH = clay1.b * 0.65 + clay2.b * 0.35;
float cavity = min(clay1.a, clay2.a * 0.5 + 0.5);

vec2 wuv = (vFace - uRect.xy) / uRect.zw;
float wedge = smoothstep(0.0, 0.03, wuv.x) * smoothstep(1.0, 0.97, wuv.x) * smoothstep(0.0, 0.03, wuv.y) * smoothstep(1.0, 0.97, wuv.y);
float skin = (vPart < 0.5 ? 1.0 : 0.0) * wedge;
float wrk = skin * wrinkleAt(wuv, vExtra.x);

vec3 tone = mix(uDeep, diffuseColor.rgb, smoothstep(0.1, 0.5, clayH) * 0.55 + 0.45);
tone = mix(tone, uPale, smoothstep(0.62, 0.95, clayH) * 0.3);
if (vPart > 0.5 && vPart < 1.5) tone = mix(tone, uPale, 0.72);
if (vPart > 2.5 && vPart < 3.5) {
  // a small round of the darker clay for the iris, and a dot of the darkest for the pupil
  float er0 = length(vec2(abs(vRef.x) - 0.0294, vRef.y - 0.7362));
  tone = mix(tone, uPale, 0.42 * smoothstep(0.0062, 0.0078, er0));
  tone = mix(tone, uDeep * 0.75, smoothstep(0.0036, 0.0028, er0) * 0.92);
}
if (vPart > 3.5) tone = mix(tone, uDeep, 0.3);
tone = mix(uDeep * 0.7, tone, cavity);
tone = mix(tone, uDeep * 0.7, smoothstep(0.0, -0.75, wrk) * 0.62);
float occ = clamp(vExtra.y, 0.0, 1.0);
tone = mix(uDeep * 0.5, tone, smoothstep(0.08, 0.86, occ));
diffuseColor.rgb = tone;
`;

export const FRAG_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor + (clayH - 0.5) * 0.3, 0.3, 1.0);
`;

/** Runs after <normal_fragment_maps>. */
export const FRAG_NORMAL = /* glsl */ `
vec2 nx1 = dx1.xy * 2.0 - 1.0, ny1 = dy1.xy * 2.0 - 1.0, nz1 = dz1.xy * 2.0 - 1.0;
vec2 nx2 = dx2.xy * 2.0 - 1.0, ny2 = dy2.xy * 2.0 - 1.0, nz2 = dz2.xy * 2.0 - 1.0;
vec3 dn = vec3(0.0, nx1.y, nx1.x) * tw.x + vec3(ny1.x, 0.0, ny1.y) * tw.y + vec3(nz1, 0.0) * tw.z;
dn += (vec3(0.0, nx2.y, nx2.x) * tw.x + vec3(ny2.x, 0.0, ny2.y) * tw.y + vec3(nz2, 0.0) * tw.z) * 0.7;
normal = normalize(normal + normalMatrix * dn * uGrain);
if (skin > 0.0) {
  vec2 ux = dFdx(wuv), uy = dFdy(wuv);
  float h0 = wrinkleAt(wuv, vExtra.x);
  float h1 = wrinkleAt(wuv + ux, vExtra.x);
  float h2 = wrinkleAt(wuv + uy, vExtra.x);
  normal = bumpN(-vViewPosition, normal, vec2(h1 - h0, h2 - h0) * 0.00125 * skin);
}
if (vPart > 2.5 && vPart < 3.5) {
  float er = length(vec2(abs(vRef.x) - 0.0294, vRef.y - 0.7362));
  float eh = -smoothstep(0.0084, 0.0052, er) * 0.7 - smoothstep(0.0040, 0.0016, er) * 1.1 + smoothstep(0.0112, 0.0072, er) * 0.2;
  normal = bumpN(-vViewPosition, normal, vec2(dFdx(eh), dFdy(eh)) * 0.0011);
}
`;

export const FRAG_LIGHT = /* glsl */ `
float occ2 = clamp(vExtra.y, 0.0, 1.0);
reflectedLight.indirectDiffuse *= occ2 * occ2;
reflectedLight.directDiffuse *= mix(0.55, 1.0, occ2);
reflectedLight.indirectSpecular *= occ2;
reflectedLight.directSpecular *= occ2;
float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
totalEmissiveRadiance += uPale * rim * 0.05 * occ2;
`;

/** Runs last, on final colours, so a figure can dissolve exactly into the backdrop. */
export const FRAG_DIM = /* glsl */ `
gl_FragColor.rgb = mix(gl_FragColor.rgb, uDimTo, uDim);
`;
