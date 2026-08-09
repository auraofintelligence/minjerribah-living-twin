// Weather, on the ground.
//
// The weather system is a synoptic state machine driving continuous fields: a nor'easter sea
// breeze day, an inland trough, storms building west, a southerly change through, an east coast
// low sitting offshore. It publishes real numbers every tick: millimetres of rain an hour, knots
// of wind and where from, metres of swell, degrees of temperature and dew point, cloud, visibility
// and a fire danger index. None of it was visible. This layer is what those numbers look like
// standing on the island.
//
// Everything below is driven off `world.read('weather')`, `world.read('daylight')`,
// `world.read('tide')` and `world.read('vegetation')`. Nothing here decides the weather and
// nothing here changes it. Where a threshold appears it is a physical one and it is written down.
//
//   RAIN falls at the published rate. Not on or off: 0.2 mm an hour is a few streaks you notice
//   against a dark headland, 12 mm an hour is a wall of it. The streaks lean with the wind and
//   they lengthen with the fall speed, and where they land there is a ring on the ground.
//
//   THE GROUND REMEMBERS. Rain wets the sand, and the sand takes hours to dry. Wet sand is darker
//   and it is glossy, and in the hollows it holds standing water. The wetness rises with the rain
//   and drains on a timescale set by the sun and the wind, so a shower at four in the afternoon is
//   still on the ground at dusk and gone by mid morning.
//
//   CLOUD SHADOW crosses the island. On a day with broken cloud the light on the ground is not one
//   value: a shadow the size of a township runs across the heath at the speed of the wind at cloud
//   height, and the whole place changes colour as it passes. This is drawn as a real moving field
//   on the ground and it also pulls the sun light down, so the change is in the shading of
//   everything and not only in a texture.
//
//   FOG lies in the hollows before dawn. Radiation fog forms when the air cools to its dew point
//   on a clear, still night. The weather system publishes both temperature and dew point, so the
//   condition is the real one: a spread under about a degree and a half, wind under six knots,
//   little cloud. It pools in Eighteen Mile Swamp and around the lakes because those are the low
//   ground, and it burns off in the couple of hours after sunrise.
//
//   SPRAY comes off the rock when the swell is up. Point Lookout is the only rock on this island;
//   everywhere else is sand. So the spray sites are found by asking the heightfield where the rock
//   meets the water, and there is nowhere else they can be.
//
//   SMOKE comes from a burn. The vegetation system runs a hazard reduction programme with a dial
//   on it and emits `ecology:burn` when a block goes up. A burn upwind of a township is a burn the
//   town smells for two days, which is the real cost of hazard reduction on an island where
//   everybody lives inside three villages, and here it is a plume you can see and follow.
//
//   LIGHTNING goes off to the west, because that is where the storms build over the mainland
//   before they cross the bay. The flash is on the ground as well as in the sky, and the thunder
//   arrives at three hundred and forty three metres a second afterwards, which at thirty
//   kilometres is an eighty seven second wait.
//
// The wind in the vegetation is the flora layer's, not this one's: it already runs a per species
// wind model off the same weather state, and two layers moving the same leaves would fight. What
// this layer adds is the wind you can see in the air rather than in the plants: sand streaming off
// a dune crest and spray torn off a wave face.
//
// How it draws. Everything is one thin-instanced mesh with a shader, and the whole layer is seven
// meshes. The ground overlay reads the island heightfield out of a texture in the vertex shader,
// so it conforms to the terrain at any camera altitude and costs nothing on the CPU per frame.
// The rain is entirely on the GPU: the instance buffer is uploaded once and the shader positions
// every streak from a hash and the clock.
//
// Determinism: one integer from world.rng.stream('weatherfx') at registration. Everything else is
// a pure hash. No simulation state is written from this file and nothing here enters a save.

import { MEAN_SEA_LEVEL, COVERS } from '../../world/island.js';

const B = typeof window !== 'undefined' ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const TAU = Math.PI * 2;

function hash2(a, b) {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(a, b, c) {
  let h = (a ^ Math.imul(b, 0x27d4eb2d) ^ Math.imul(c, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Speed of sound in air at about twenty degrees, metres a second. */
const SOUND_MS = 343;

/* ================================================================== shaders */

/* Shared noise, written once and pasted into each shader that needs it. Value noise with a
   hash, because a texture lookup for cloud shape is a texture this layer does not need to own. */
const GLSL_NOISE = `
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.7) * 0.28 + vnoise(p * 4.7 - 3.1) * 0.17;
}
`;

/* ---- the ground overlay -------------------------------------------------

One camera-following lattice warped so the middle of it is metres across and the edge of it is
kilometres. Height comes out of a texture of the island's own heightfield, so the sheet lies on
the ground at any altitude with no CPU work. Two passes over the same geometry: one multiplies
(cloud shadow, wet sand), one adds (the sheen off standing water, and the mirage over hot sand). */

const GROUND_VERT = `
precision highp float;
attribute vec3 position;      // x,z in [-1,1], y unused
uniform mat4 viewProjection;
uniform vec4 uCentre;         // xz camera centre, z span metres, w warp power
uniform vec4 uField;          // x0, z0, cell, 0        island heightfield origin
uniform vec4 uFieldN;         // nx, nz, 1/nx, 1/nz
uniform sampler2D texH;
varying vec3 vPos;
varying vec2 vUvW;
varying float vGround;
varying float vSand;
varying float vHollow;
varying float vEdge;

vec4 sampleField(vec2 world) {
  vec2 uv = (world - uField.xy) / (uField.z * vec2(uFieldN.x, uFieldN.y));
  return texture2D(texH, clamp(uv, 0.001, 0.999));
}
float decodeH(vec4 t) { return (t.r + t.g / 255.0) * 300.0 - 40.0; }

void main() {
  vec2 w = sign(position.xz) * pow(abs(position.xz), vec2(uCentre.w));
  vec2 world = uCentre.xy + w * uCentre.z;
  vec4 f = sampleField(world);
  float h = decodeH(f);
  // A four tap of the neighbourhood tells the shader whether this is a hollow, which is where
  // water stands, and how steep it is, which is where water does not.
  float c = uField.z * 3.0;
  float h1 = decodeH(sampleField(world + vec2(c, 0.0)));
  float h2 = decodeH(sampleField(world - vec2(c, 0.0)));
  float h3 = decodeH(sampleField(world + vec2(0.0, c)));
  float h4 = decodeH(sampleField(world - vec2(0.0, c)));
  float mean = (h1 + h2 + h3 + h4) * 0.25;
  vHollow = clamp((mean - h) * 0.5 + 0.5, 0.0, 1.0);
  vSand = f.b;
  vGround = h;
  vEdge = 1.0 - smoothstep(0.72, 1.0, length(position.xz));
  vec3 p = vec3(world.x, h + 0.35, world.y);
  vPos = p;
  vUvW = world;
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

const GROUND_SHADOW_FRAG = `
precision highp float;
${GLSL_NOISE}
varying vec3 vPos;
varying vec2 vUvW;
varying float vGround;
varying float vSand;
varying float vHollow;
varying float vEdge;
uniform vec3 uCam;
uniform vec4 uCloud;   // x cover 0..1, y drift x, z drift z, w cell size metres
uniform vec4 uWet;     // x wetness 0..1, y sea level, z rain mm/hr, w puddle level
uniform vec4 uSunCol;  // rgb sun colour, a intensity
void main() {
  // Cloud shadow. Two scales: the cell of a cumulus field and the ragged edge on it. The field
  // moves at the wind at cloud height, which is why a shadow crosses faster than the sea breeze.
  vec2 q = (vUvW + vec2(uCloud.y, uCloud.z)) / uCloud.w;
  float n = fbm(q) * 0.72 + fbm(q * 3.3) * 0.28;
  // Coverage sets the threshold: at a tenth cover you get a few shadows, at nine tenths a few
  // patches of sun.
  float thr = mix(0.86, 0.16, uCloud.x);
  float shade = smoothstep(thr - 0.10, thr + 0.10, n);
  float dark = shade * (0.34 + 0.22 * uCloud.x) * uSunCol.a * 0.55;

  // Wet ground. Sand with water in the pores is darker, and a hollow that has filled is darker
  // still. Only sand, only above the waterline, and it dries from the top of the dune down.
  float land = step(uWet.y, vGround);
  float wet = uWet.x * vSand * land;
  float pool = smoothstep(0.55, 0.95, vHollow) * smoothstep(0.35, 0.9, uWet.w) * land;
  dark += wet * 0.30 + pool * 0.22;

  float d = length(uCam - vPos);
  float far = 1.0 - smoothstep(3000.0, 6200.0, d);
  float a = clamp(dark, 0.0, 0.62) * vEdge * far;
  // Written the negative way round so a NaN anywhere upstream discards instead of reaching the
  // blend. A multiply pass that lets one NaN through does not darken a patch of sand: it turns
  // the whole frame white, and it did.
  if (!(a > 0.004)) discard;
  // The destination alpha is left alone. This pass darkens colour and has no business writing
  // coverage into a buffer the exposure meter and the bloom threshold both read back.
  gl_FragColor = vec4(vec3(1.0 - a), 0.0);
}
`;

const GROUND_SHEEN_FRAG = `
precision highp float;
${GLSL_NOISE}
varying vec3 vPos;
varying vec2 vUvW;
varying float vGround;
varying float vSand;
varying float vHollow;
varying float vEdge;
uniform vec3 uCam;
uniform vec4 uWet;     // x wetness, y sea level, z rain mm/hr, w puddle level
uniform vec4 uSun;     // xyz direction to the sun, w day factor
uniform vec4 uSunCol;
uniform vec4 uSkyHz;
uniform vec4 uHeat;    // x mirage strength, y time, z wind knots, w sand temperature
void main() {
  vec3 dv = uCam - vPos;
  float dvl = length(dv);
  vec3 V = dvl > 1e-5 ? dv / dvl : vec3(0.0, 1.0, 0.0);
  float land = step(uWet.y, vGround);
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 hv = uSun.xyz + V;
  float hl = length(hv);
  vec3 H = hl > 1e-5 ? hv / hl : vec3(0.0, 1.0, 0.0);
  float gloss = pow(max(dot(N, H), 1e-4), 220.0);

  // Standing water in a hollow is a mirror; wet sand is only glossy.
  float pool = smoothstep(0.55, 0.95, vHollow) * smoothstep(0.35, 0.9, uWet.w) * land;
  float wet = uWet.x * vSand * land;
  vec3 add = uSunCol.rgb * uSunCol.a * gloss * (wet * 0.55 + pool * 2.4);
  // A puddle also holds the sky, which is what you actually see at a grazing angle.
  float graze = pow(max(1.0 - max(V.y, 0.0), 1e-4), 4.0);
  add += uSkyHz.rgb * graze * (pool * 0.55 + wet * 0.12);

  // Heat shimmer. Hot dry sand at a grazing angle takes on the colour of the sky and the boundary
  // wobbles. It needs sun on the ground, dry sand and light wind, which is a February noon here.
  if (uHeat.x > 0.01) {
    float band = smoothstep(0.14, 0.0, abs(V.y)) * vSand * land;
    float w = fbm(vec2(vUvW.x * 0.06 + uHeat.y * 1.4, vUvW.y * 0.06 - uHeat.y * 0.9));
    float w2 = fbm(vec2(vUvW.x * 0.19 - uHeat.y * 2.6, vUvW.y * 0.19 + uHeat.y * 1.7));
    add += uSkyHz.rgb * band * uHeat.x * (0.30 + 0.70 * w * w2) * 0.9;
  }

  float d = length(uCam - vPos);
  float far = 1.0 - smoothstep(3000.0, 6200.0, d);
  add *= vEdge * far;
  add = clamp(add, 0.0, 2.0);
  float m = max(add.r, max(add.g, add.b));
  if (!(m > 0.004)) discard;
  gl_FragColor = vec4(add, 0.0);
}
`;

/* ---- rain ---------------------------------------------------------------

Entirely on the GPU. The instance buffer is three hashed coordinates and a size, uploaded once at
build. Every frame the shader wraps each streak inside a box that follows the camera and slides it
down the fall vector, so a hundred thousand raindrops cost one buffer that never moves again. */

const RAIN_VERT = `
precision highp float;
attribute vec3 position;    // unit quad, x across, y along the streak
attribute vec2 uv;
attribute vec4 aR;          // hashed cell coordinates and a size
uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uBox;          // xyz box centre, w box size metres
uniform vec4 uFall;         // xyz fall velocity metres a second, w time
uniform vec4 uRain;         // x streak length, y streak width, z opacity, w near fade metres
varying vec2 vUv;
varying float vA;
varying vec3 vPos;
void main() {
  float S = uBox.w;
  vec3 v = uFall.xyz;
  float speed = length(v);
  vec3 dir = v / max(speed, 0.001);
  // Wrap the drop inside the box. The vertical term carries the clock, so it falls.
  vec3 cell = aR.xyz;
  float drop = fract(cell.y + uFall.w * speed / S);
  vec3 p;
  p.x = uBox.x + (fract(cell.x + uFall.w * v.x / S) - 0.5) * S;
  p.z = uBox.z + (fract(cell.z + uFall.w * v.z / S) - 0.5) * S;
  p.y = uBox.y + (0.5 - drop) * S;
  // Build the streak facing the camera, stretched along the fall direction.
  vec3 toCam = normalize(uCam - p);
  vec3 right = normalize(cross(dir, toCam));
  float len = uRain.x * (0.65 + 0.7 * aR.w);
  float wid = uRain.y * (0.7 + 0.6 * aR.w);
  vec3 wp = p + right * position.x * wid + dir * position.y * len;
  float d = length(uCam - p);
  // Fade the far corners of the box and the drops that are right on the lens.
  vA = uRain.z * (1.0 - smoothstep(S * 0.30, S * 0.52, d)) * smoothstep(uRain.w * 0.4, uRain.w, d);
  vUv = uv;
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const RAIN_FRAG = `
precision highp float;
varying vec2 vUv;
varying float vA;
varying vec3 vPos;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
void main() {
  // A streak is bright in the middle and nothing at the ends.
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = sin(vUv.y * 3.14159);
  float a = vA * across * across * along;
  if (!(a > 0.006)) discard;
  vec3 col = uSkyHz.rgb * 0.75 + uSky.rgb * 0.5 + uSunCol.rgb * uSunCol.a * 0.18;
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

/* ---- splash rings, fog slabs, puffs and the bolt ------------------------ */

const SPLASH_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aP;      // x phase 0..1, y radius metres, z kind, w opacity
uniform mat4 viewProjection;
varying vec2 vUv;
varying vec4 vP;
varying vec3 vPos;
void main() {
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 wp = W * vec4(position, 1.0);
  vUv = uv; vP = aP; vPos = wp.xyz;
  gl_Position = viewProjection * wp;
}
`;

const SPLASH_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec4 vP;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uSunCol;
uniform vec4 uSkyHz;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  // An expanding ring with a bright leading edge, which is what a drop makes on wet sand.
  float ring = smoothstep(1.0, 0.82, r) * smoothstep(0.55, 0.86, r);
  float a = ring * vP.w;
  if (!(a > 0.006)) discard;
  vec3 col = uSkyHz.rgb * 0.62 + uSunCol.rgb * uSunCol.a * 0.45 + vec3(0.16);
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

const FOG_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec4 uFog;      // x centre x, y centre z, z base altitude, w slab spacing
varying vec3 vPos;
varying float vSlab;
void main() {
  // Each slab carries its index in uv.y so one mesh is the whole stack.
  vSlab = uv.y;
  vec3 p = vec3(position.x + uFog.x, uFog.z + vSlab * uFog.w, position.z + uFog.y);
  vPos = p;
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

const FOG_FRAG = `
precision highp float;
${GLSL_NOISE}
varying vec3 vPos;
varying float vSlab;
uniform vec3 uCam;
uniform vec4 uFogA;     // x amount 0..1, y drift x, z drift z, w slab count
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
void main() {
  vec2 q = (vPos.xz + vec2(uFogA.y, uFogA.z)) * 0.0032;
  float n = fbm(q) * 0.7 + fbm(q * 3.7 + vSlab * 4.0) * 0.3;
  // The bank thins upward: the top of a radiation fog is ragged and the bottom is solid.
  float vert = 1.0 - vSlab / max(1.0, uFogA.w);
  float a = uFogA.x * vert * vert * smoothstep(0.34, 0.78, n) * 0.34;
  float d = length(uCam.xz - vPos.xz);
  // No square edge: the sheet fades out well inside its own extent.
  a *= smoothstep(2400.0, 900.0, d);
  // And nothing right on the lens, so walking into it does not white the screen out.
  a *= smoothstep(3.0, 22.0, length(uCam - vPos));
  if (!(a > 0.004)) discard;
  vec3 col = uSkyHz.rgb * 0.85 + uSky.rgb * 0.55 + uSunCol.rgb * uSunCol.a * 0.22;
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

const PUFF_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aP;    // x age 0..1, y size, z kind 0 spray 1 smoke 2 sand, w opacity
uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec3 uUp;
varying vec2 vUv;
varying vec4 vP;
varying vec3 vPos;
void main() {
  vec3 c = vec3(world3.x, world3.y, world3.z);
  vec3 f = normalize(uCam - c);
  vec3 r = normalize(cross(uUp, f));
  vec3 u = cross(f, r);
  vec3 wp = c + (r * position.x + u * position.y) * aP.y;
  vUv = uv; vP = aP; vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const PUFF_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec4 vP;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uSmoke;   // rgb smoke colour, a flame gain
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = dot(d, d);
  if (r > 1.0) discard;
  float soft = pow(1.0 - r, 1.5);
  float edge = 0.70 + 0.30 * sin(d.x * 8.0 + vP.x * 7.0) * sin(d.y * 6.0 - vP.x * 5.0);
  float a = soft * edge * vP.w;
  vec3 spray = uSkyHz.rgb * 0.6 + uSunCol.rgb * uSunCol.a * 0.75 + vec3(0.24);
  vec3 sand = vec3(0.62, 0.58, 0.48) * (0.4 + uSunCol.a * 0.7);
  vec3 col = vP.z < 0.5 ? spray : (vP.z < 1.5 ? uSmoke.rgb : sand);
  float dist = length(uCam - vPos);
  col = mix(col, uSkyHz.rgb * 0.9, (1.0 - exp(-dist * 0.000045)) * 0.85);
  if (!(a > 0.004)) discard;
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

const BOLT_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uBolt;    // x base x, y base z, z scale, w width
uniform vec4 uBolt2;   // x top altitude, y bottom altitude, z jag seed, w brightness
varying vec2 vUv;
varying float vB;
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
void main() {
  // A jagged line from the cloud base down, built in the shader from a hash so the bolt is a
  // different bolt every time without a buffer upload.
  float t = uv.y;
  float y = mix(uBolt2.x, uBolt2.y, t);
  float seg = floor(t * 9.0);
  float j1 = h11(seg + uBolt2.z) - 0.5;
  float j2 = h11(seg + 1.0 + uBolt2.z) - 0.5;
  float f = fract(t * 9.0);
  float off = mix(j1, j2, f) * uBolt.z * 0.16 * (0.3 + t);
  vec3 c = vec3(uBolt.x, y, uBolt.y);
  vec3 toCam = normalize(uCam - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 wp = c + right * (off + position.x * uBolt.w * (1.2 - t * 0.6));
  vUv = uv; vB = uBolt2.w;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const BOLT_FRAG = `
precision highp float;
varying vec2 vUv;
varying float vB;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = pow(max(across, 1e-4), 2.2) * vB * (0.35 + 0.65 * (1.0 - vUv.y));
  if (!(a > 0.01)) discard;
  gl_FragColor = vec4(vec3(0.95, 0.96, 1.0), min(a, 1.0));
}
`;

/* ================================================================== registration */

export function registerWeatherFx(world) {
  const SEED = world.rng.stream('weatherfx').int(1, 1 << 28);

  const state = world.publish('weatherfx', {
    ready: false,
    rendered: false,
    source: 'weather, daylight, tide and vegetation read models',
    renderer: '',
    rainMmHr: 0,
    rainStreaks: 0,
    groundWetness: 0,
    puddleLevel: 0,
    dryingHoursLeft: 0,
    cloudShadow: 0,
    cloudShadowSpeedMs: 0,
    sunDimmedTo: 1,
    fogIndex: 0,
    fogReason: '',
    fogTopM: 0,
    spraySites: 0,
    sprayNow: 0,
    sandDrift: 0,
    heatShimmer: 0,
    smokePlumes: 0,
    smokeOverTownship: 0,
    lightning: { active: false, bearingDeg: 0, distanceKm: 0, strikes: 0, lastFlashAgoS: 0 },
    thunder: { pending: 0, lastDelayS: 0, lastDistanceKm: 0, heard: 0 },
    notes: [
      'The wind in the vegetation belongs to the flora layer, which runs a per species wind model '
        + 'off the same weather state. This layer draws the wind you can see in the air instead: '
        + 'sand off a dune crest and spray torn off a wave face.',
      'Radiation fog forms on the published temperature and dew point spread, not on a time of day. '
        + 'A clear still night with a spread under about a degree and a half is what makes it.',
      'Thunder is delayed by distance at 343 m/s. The delay is published next to the distance so it '
        + 'can be checked against the flash.'
    ]
  });

  world.register({
    id: 'weatherfx',
    phase: 'presentation',
    order: 62,
    describe(w) {
      const wx = w.read('weather');
      return {
        rendered: state.rendered,
        synoptic: wx ? wx.synoptic : null,
        rainMmHr: wx ? +wx.rainMmHr.toFixed(2) : 0,
        windKt: wx ? +wx.windKt.toFixed(1) : 0,
        swellM: wx ? +wx.swellM.toFixed(2) : 0,
        spreadC: wx ? +(wx.tempC - wx.dewPointC).toFixed(2) : null,
        wetness: state.groundWetness,
        puddles: state.puddleLevel,
        fog: state.fogIndex,
        cloudShadow: state.cloudShadow,
        sunDimmedTo: state.sunDimmedTo,
        shimmer: state.heatShimmer,
        spray: state.sprayNow,
        plumes: state.smokePlumes,
        lightning: state.lightning.active ? state.lightning.distanceKm : 0,
        thunderDelayS: state.thunder.lastDelayS
      };
    },
    save() { return null; },
    load() {}
  });

  if (!world.stage || !B) {
    state.notes.push('headless: the weather is simulated, nothing is drawn.');
    return;
  }
  try {
    buildWeatherFx(world, SEED, state);
  } catch (e) {
    console.error('[weatherfx] renderer failed to build', e);
    state.notes.push('renderer failed to build: ' + (e && e.message));
  }
}

/* ================================================================== the renderer */

function buildWeatherFx(world, SEED, state) {
  const stage = world.stage;
  const scene = stage.scene;
  const island = world.island;
  if (!island || !island.grid) {
    state.notes.push('no world.island: the ground effects need the heightfield.');
    return;
  }
  const seaLevel = island.seaLevel != null ? island.seaLevel : MEAN_SEA_LEVEL;
  const g = island.grid;
  const t0 = performance.now();

  /* ---- the heightfield as a texture -------------------------------------

  Height in sixteen bits across red and green over a range of minus forty to two hundred and sixty
  metres, which covers the deepest seabed the model carries and the two hundred and thirty three
  metre high point with about four millimetres to spare. Blue carries how sandy the ground is,
  which is what decides whether rain darkens it and whether it shimmers. Alpha carries the bay
  side, which is not used yet and is there because the texture is already paid for. */

  const SAND_BY_COVER = {
    beach: 1.0, foredune: 0.95, rock: 0.0, heath: 0.28, forest: 0.10, swamp: 0.05,
    lake: 0.0, water: 0.0, saltmarsh: 0.20, mangrove: 0.05, cleared: 0.35, urban: 0.25,
    rehab: 0.45
  };
  const sandByIndex = new Float32Array(COVERS.length);
  for (let i = 0; i < COVERS.length; i++) sandByIndex[i] = SAND_BY_COVER[COVERS[i]] ?? 0.2;

  const caps = stage.engine.getCaps();
  const vtx = caps && (caps.maxVertexTextureImageUnits ?? caps.vertexTextureUnits ?? 4);
  if (!vtx) {
    state.notes.push('this device cannot sample a texture in a vertex shader: the ground overlay '
      + '(cloud shadow, puddles, shimmer) is off. Rain, fog, spray, smoke and lightning still run.');
  }

  let texH = null;
  if (vtx) {
    const data = new Uint8Array(g.nx * g.nz * 4);
    for (let i = 0; i < g.nx * g.nz; i++) {
      const h = clamp((g.height[i] + 40) / 300, 0, 0.999999);
      const q = Math.floor(h * 65535);
      data[i * 4] = q >> 8;
      data[i * 4 + 1] = q & 255;
      data[i * 4 + 2] = Math.round(sandByIndex[g.cover[i]] * 255);
      data[i * 4 + 3] = g.bayness[i];
    }
    texH = new B.RawTexture(data, g.nx, g.nz, B.Engine.TEXTUREFORMAT_RGBA, scene, false, false,
      B.Texture.BILINEAR_SAMPLINGMODE);
    texH.wrapU = texH.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  }

  /* ---- the ground overlay geometry -------------------------------------- */

  const GRID_N = 128;
  let groundShadow = null, groundSheen = null, matShadow = null, matSheen = null;
  const vCentre = new B.Vector4(0, 0, 5200, 2.35);
  const vField = new B.Vector4(g.x0, g.z0, g.cell, 0);
  const vFieldN = new B.Vector4(g.nx, g.nz, 1 / g.nx, 1 / g.nz);
  const vCloud = new B.Vector4(0.3, 0, 0, 2400);
  const vWet = new B.Vector4(0, seaLevel, 0, 0);
  const vHeat = new B.Vector4(0, 0, 0, 0);

  if (texH) {
    const pos = [];
    const idx = [];
    for (let j = 0; j <= GRID_N; j++) {
      for (let i = 0; i <= GRID_N; i++) {
        pos.push((i / GRID_N) * 2 - 1, 0, (j / GRID_N) * 2 - 1);
      }
    }
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const a = j * (GRID_N + 1) + i;
        idx.push(a, a + GRID_N + 1, a + 1, a + 1, a + GRID_N + 1, a + GRID_N + 2);
      }
    }
    const mk = (name) => {
      const m = new B.Mesh(name, scene);
      const vd = new B.VertexData();
      vd.positions = new Float32Array(pos);
      vd.indices = new Uint32Array(idx);
      vd.applyToMesh(m, false);
      m.alwaysSelectAsActiveMesh = true;
      m.doNotSyncBoundingInfo = true;
      m.isPickable = false;
      return m;
    };
    const UNI = ['viewProjection', 'uCam', 'uCentre', 'uField', 'uFieldN', 'uCloud', 'uWet',
      'uSun', 'uSunCol', 'uSkyHz', 'uHeat'];
    groundShadow = mk('wx-ground-shadow');
    matShadow = new B.ShaderMaterial('wxGroundShadow', scene,
      { vertexSource: GROUND_VERT, fragmentSource: GROUND_SHADOW_FRAG },
      { attributes: ['position'], uniforms: UNI, samplers: ['texH'], needAlphaBlending: true });
    matShadow.setTexture('texH', texH);
    matShadow.alphaMode = B.Engine.ALPHA_MULTIPLY;
    matShadow.disableDepthWrite = true;
    matShadow.backFaceCulling = false;
    groundShadow.material = matShadow;
    groundShadow.alphaIndex = 30;

    groundSheen = mk('wx-ground-sheen');
    matSheen = new B.ShaderMaterial('wxGroundSheen', scene,
      { vertexSource: GROUND_VERT, fragmentSource: GROUND_SHEEN_FRAG },
      { attributes: ['position'], uniforms: UNI, samplers: ['texH'], needAlphaBlending: true });
    matSheen.setTexture('texH', texH);
    matSheen.alphaMode = B.Engine.ALPHA_ADD;
    matSheen.disableDepthWrite = true;
    matSheen.backFaceCulling = false;
    groundSheen.material = matSheen;
    groundSheen.alphaIndex = 31;
  }

  /* ---- rain -------------------------------------------------------------- */

  const RAIN_CAP = 9000;
  const rainMesh = new B.Mesh('wx-rain', scene);
  {
    const vd = new B.VertexData();
    vd.positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    vd.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    vd.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    vd.applyToMesh(rainMesh, false);
    rainMesh.alwaysSelectAsActiveMesh = true;
    rainMesh.doNotSyncBoundingInfo = true;
    rainMesh.isPickable = false;
    rainMesh.setEnabled(false);
  }
  const rainMat = new B.ShaderMaterial('wxRain', scene,
    { vertexSource: RAIN_VERT, fragmentSource: RAIN_FRAG },
    {
      attributes: ['position', 'uv', 'aR'],
      uniforms: ['viewProjection', 'uCam', 'uBox', 'uFall', 'uRain', 'uSunCol', 'uSky', 'uSkyHz'],
      needAlphaBlending: true
    });
  rainMat.backFaceCulling = false;
  rainMat.alphaMode = B.Engine.ALPHA_COMBINE;
  rainMat.disableDepthWrite = true;
  rainMesh.material = rainMat;
  rainMesh.alphaIndex = 80;
  {
    // The instance matrices are never used by the rain shader, but Babylon wants a matrix buffer
    // to know how many instances there are, so it is written once as identities and left alone.
    const m = new Float32Array(RAIN_CAP * 16);
    const r = new Float32Array(RAIN_CAP * 4);
    for (let i = 0; i < RAIN_CAP; i++) {
      m[i * 16] = m[i * 16 + 5] = m[i * 16 + 10] = m[i * 16 + 15] = 1;
      r[i * 4] = hash2(SEED + 1, i);
      r[i * 4 + 1] = hash2(SEED + 2, i);
      r[i * 4 + 2] = hash2(SEED + 3, i);
      r[i * 4 + 3] = hash2(SEED + 4, i);
    }
    rainMesh.thinInstanceSetBuffer('matrix', m, 16, true);
    rainMesh.thinInstanceSetBuffer('aR', r, 4, true);
    rainMesh.thinInstanceCount = 0;
  }
  const vBox = new B.Vector4(0, 0, 0, 90);
  const vFall = new B.Vector4(0, -8, 0, 0);
  const vRain = new B.Vector4(0.9, 0.02, 0.32, 2.2);

  /* ---- splash rings ------------------------------------------------------ */

  const SPLASH_CAP = 700;
  const splashMesh = new B.Mesh('wx-splash', scene);
  {
    const vd = new B.VertexData();
    vd.positions = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]);
    vd.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    vd.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    vd.applyToMesh(splashMesh, false);
    splashMesh.alwaysSelectAsActiveMesh = true;
    splashMesh.doNotSyncBoundingInfo = true;
    splashMesh.isPickable = false;
    splashMesh.setEnabled(false);
  }
  const splashMat = new B.ShaderMaterial('wxSplash', scene,
    { vertexSource: SPLASH_VERT, fragmentSource: SPLASH_FRAG },
    {
      attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3', 'aP'],
      uniforms: ['viewProjection', 'uCam', 'uSunCol', 'uSkyHz'],
      needAlphaBlending: true
    });
  splashMat.backFaceCulling = false;
  splashMat.alphaMode = B.Engine.ALPHA_COMBINE;
  splashMat.disableDepthWrite = true;
  splashMesh.material = splashMat;
  splashMesh.alphaIndex = 33;
  const splashM = new Float32Array(SPLASH_CAP * 16);
  const splashP = new Float32Array(SPLASH_CAP * 4);
  splashMesh.thinInstanceSetBuffer('matrix', splashM, 16, false);
  splashMesh.thinInstanceSetBuffer('aP', splashP, 4, false);
  splashMesh.thinInstanceCount = 0;
  // A fixed lattice of landing spots around the camera, resampled when the camera moves out of it.
  const splashSites = new Float32Array(SPLASH_CAP * 3);
  let splashOriginX = 1e9, splashOriginZ = 1e9;

  /* ---- fog slabs --------------------------------------------------------- */

  const FOG_SLABS = 7;
  const fogMesh = new B.Mesh('wx-fog', scene);
  {
    const pos = [], uv = [], idx = [];
    const R = 2600;
    for (let s = 0; s < FOG_SLABS; s++) {
      const b = pos.length / 3;
      pos.push(-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R);
      uv.push(0, s, 1, s, 1, s, 0, s);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      idx.push(b + 2, b + 1, b, b + 3, b + 2, b);
    }
    const vd = new B.VertexData();
    vd.positions = new Float32Array(pos);
    vd.uvs = new Float32Array(uv);
    vd.indices = new Uint32Array(idx);
    vd.applyToMesh(fogMesh, false);
    fogMesh.alwaysSelectAsActiveMesh = true;
    fogMesh.doNotSyncBoundingInfo = true;
    fogMesh.isPickable = false;
    fogMesh.setEnabled(false);
  }
  const fogMat = new B.ShaderMaterial('wxFog', scene,
    { vertexSource: FOG_VERT, fragmentSource: FOG_FRAG },
    {
      attributes: ['position', 'uv'],
      uniforms: ['viewProjection', 'uCam', 'uFog', 'uFogA', 'uSunCol', 'uSky', 'uSkyHz'],
      needAlphaBlending: true
    });
  fogMat.backFaceCulling = false;
  fogMat.alphaMode = B.Engine.ALPHA_COMBINE;
  fogMat.disableDepthWrite = true;
  fogMesh.material = fogMat;
  fogMesh.alphaIndex = 36;
  const vFog = new B.Vector4(0, 0, 2, 2.2);
  const vFogA = new B.Vector4(0, 0, 0, FOG_SLABS);

  /* ---- spray, smoke and sand drift --------------------------------------- */

  const PUFF_CAP = 1600;
  const puffMesh = new B.Mesh('wx-puff', scene);
  {
    const vd = new B.VertexData();
    vd.positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    vd.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    vd.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    vd.applyToMesh(puffMesh, false);
    puffMesh.alwaysSelectAsActiveMesh = true;
    puffMesh.doNotSyncBoundingInfo = true;
    puffMesh.isPickable = false;
    puffMesh.setEnabled(false);
  }
  const puffMat = new B.ShaderMaterial('wxPuff', scene,
    { vertexSource: PUFF_VERT, fragmentSource: PUFF_FRAG },
    {
      attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3', 'aP'],
      uniforms: ['viewProjection', 'uCam', 'uUp', 'uSunCol', 'uSky', 'uSkyHz', 'uSmoke'],
      needAlphaBlending: true
    });
  puffMat.backFaceCulling = false;
  puffMat.alphaMode = B.Engine.ALPHA_COMBINE;
  puffMat.disableDepthWrite = true;
  puffMesh.material = puffMat;
  puffMesh.alphaIndex = 74;
  const puffM = new Float32Array(PUFF_CAP * 16);
  const puffP = new Float32Array(PUFF_CAP * 4);
  puffMesh.thinInstanceSetBuffer('matrix', puffM, 16, false);
  puffMesh.thinInstanceSetBuffer('aP', puffP, 4, false);
  puffMesh.thinInstanceCount = 0;
  const puffs = [];
  for (let i = 0; i < PUFF_CAP; i++) {
    puffs.push({ a: 1e9, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 2, kind: 0, op: 1, buoy: 0 });
  }
  let puffCursor = 0;
  function emitPuff(x, y, z, vx, vy, vz, life, s0, s1, kind, op, buoy) {
    const p = puffs[puffCursor];
    puffCursor = (puffCursor + 1) % PUFF_CAP;
    p.a = 0; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.s0 = s0; p.s1 = s1; p.kind = kind; p.op = op; p.buoy = buoy || 0;
  }
  const vSmoke = new B.Vector4(0.42, 0.40, 0.37, 0);

  /* ---- the bolt ---------------------------------------------------------- */

  const boltMesh = new B.Mesh('wx-bolt', scene);
  {
    const pos = [], uv = [], idx = [];
    const N = 36;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pos.push(-0.5, 0, 0, 0.5, 0, 0);
      uv.push(0, t, 1, t);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      idx.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
    }
    const vd = new B.VertexData();
    vd.positions = new Float32Array(pos);
    vd.uvs = new Float32Array(uv);
    vd.indices = new Uint32Array(idx);
    vd.applyToMesh(boltMesh, false);
    boltMesh.alwaysSelectAsActiveMesh = true;
    boltMesh.doNotSyncBoundingInfo = true;
    boltMesh.isPickable = false;
    boltMesh.setEnabled(false);
  }
  const boltMat = new B.ShaderMaterial('wxBolt', scene,
    { vertexSource: BOLT_VERT, fragmentSource: BOLT_FRAG },
    {
      attributes: ['position', 'uv'],
      uniforms: ['viewProjection', 'uCam', 'uBolt', 'uBolt2'],
      needAlphaBlending: true
    });
  boltMat.backFaceCulling = false;
  boltMat.alphaMode = B.Engine.ALPHA_ADD;
  boltMat.disableDepthWrite = true;
  boltMesh.material = boltMat;
  boltMesh.alphaIndex = 90;
  const vBolt = new B.Vector4(0, 0, 1, 8);
  const vBolt2 = new B.Vector4(2600, 400, 0, 0);

  /* ---- spray sites -------------------------------------------------------

  Where the rock meets the water. Point Lookout is the only rock on this island, which the land
  cover says on its own, so this scan is the reason the spray can only ever be at the headland. */

  const spraySites = [];
  {
    const step = 2;
    for (let j = 1; j < g.nz - 1; j += step) {
      for (let i = 1; i < g.nx - 1; i += step) {
        const k = j * g.nx + i;
        if (COVERS[g.cover[k]] !== 'rock') continue;
        const h = g.height[k];
        if (h < seaLevel - 1.0 || h > seaLevel + 9) continue;
        // Only a cell with open water next to it: the back of the headland does not throw spray.
        let wet = false;
        for (let d = 1; d <= 3 && !wet; d++) {
          if (g.height[k - d] < seaLevel - 2 || g.height[k + d] < seaLevel - 2
            || g.height[k - d * g.nx] < seaLevel - 2 || g.height[k + d * g.nx] < seaLevel - 2) wet = true;
        }
        if (!wet) continue;
        const x = g.x0 + i * g.cell;
        const z = g.z0 + j * g.cell;
        spraySites.push({ x, z, y: h, seed: hash3(SEED + 5, i, j), t: hash3(SEED + 6, i, j) * 12 });
        if (spraySites.length >= 90) break;
      }
      if (spraySites.length >= 90) break;
    }
  }
  state.spraySites = spraySites.length;

  /* ---- burns ------------------------------------------------------------- */

  const plumes = [];
  world.bus.on('ecology:burn', (e) => {
    if (!e || !Number.isFinite(e.x)) return;
    // A block burns for hours. The plume is carried for three minutes of render time, which at
    // the twelve times speed a player watches a burn day at is about the length of the burn.
    plumes.push({
      x: e.x, z: e.z, r: Math.max(40, e.radiusM || 80), ha: e.ha || 60,
      cause: e.cause || 'planned', t: 0, life: 190, where: e.where || null
    });
    if (plumes.length > 6) plumes.shift();
  });

  /* ---- lightning and thunder --------------------------------------------- */

  const strikes = [];       // live bolts, render seconds
  const thunders = [];      // scheduled arrivals
  let strikeTimer = 4;
  let strikeCount = 0;
  let flash = 0;
  let lastFlashAgo = 999;

  // Sound belongs to src/audio/audio.js, which owns the one audio graph on the page. This layer
  // does not open a second one. What it does instead is put the flash and the arrival of the
  // thunder on the bus as separate events, with the distance, the delay and whether it is a crack
  // or a long roll, so the audio layer has everything it needs to place the sound and the delay
  // is a published number that can be checked against the flash without a speaker in the room.
  function thunderShape(distanceKm) {
    return distanceKm < 4 ? 'crack overhead'
      : distanceKm < 12 ? 'a hard clap'
        : distanceKm < 28 ? 'a long roll' : 'a distant rumble';
  }

  /* ---- the frame --------------------------------------------------------- */

  let clockT = 0;
  let wet = 0;              // ground wetness 0..1
  let puddle = 0;           // standing water 0..1, slower than wetness both ways
  let fogIdx = 0;
  let cloudDriftX = 0, cloudDriftZ = 0;
  let sunBase = null;
  const camPos = new B.Vector3();
  const vUp = new B.Vector3(0, 1, 0);
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.9, 0.4);
  let lastSimMin = null;

  const layer = stage.addLayer({
    id: 'weatherfx',
    order: 8,     // after the sky, which sets the sun and the fog this layer then modifies

    init() {
      state.ready = true;
      state.rendered = true;
      state.renderer = (texH ? 'ground overlay off a heightfield texture, ' : '')
        + 'GPU rain, splash rings, seven fog slabs, one puff pool for spray, smoke and sand, '
        + 'and a shader-built bolt: ' + (texH ? 7 : 5) + ' meshes';
      console.info('[weatherfx] built in ' + Math.round(performance.now() - t0) + ' ms: '
        + spraySites.length + ' spray sites on rock shoreline, heightfield texture '
        + (texH ? g.nx + 'x' + g.nz : 'off'));
    },

    frame(st, w, dt) {
      const d = Math.min(0.1, dt || 0.016);
      clockT += d;
      const cam = st.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      const camX = camPos.x, camY = camPos.y, camZ = camPos.z;

      const wx = w.read('weather');
      const dl = w.read('daylight');
      const veg = w.read('vegetation');
      if (!wx) return;

      /* --- the light, on the same expressions the terrain, ocean and flora use --- */
      const alt = dl && Number.isFinite(dl.altitude) ? dl.altitude : 0.9;
      const az = dl && Number.isFinite(dl.azimuth) ? dl.azimuth : Math.PI * 0.25;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx.cloud;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF, 0.4);

      // Simulated minutes since the last frame, so the ground dries on the island's clock rather
      // than on the wall clock, and fast forward dries it faster.
      const simMin = w.clock.dayIndex * 1440 + w.clock.minuteOfDay;
      const dMin = lastSimMin === null ? 0 : clamp(simMin - lastSimMin, 0, 720);
      lastSimMin = simMin;

      const windMs = wx.windKt * 0.514;
      const windTh = ((wx.windDirDeg + 180) * Math.PI) / 180;   // where it is going
      const windX = Math.sin(windTh), windZ = Math.cos(windTh);

      /* ============================================================ rain */

      const mm = wx.rainMmHr;
      state.rainMmHr = +mm.toFixed(2);
      // Drop count against rate. Twelve millimetres an hour is heavy rain and it fills the box.
      const rainFrac = clamp(Math.pow(clamp(mm / 12, 0, 1), 0.62), 0, 1);
      const nRain = Math.round(RAIN_CAP * rainFrac);
      rainMesh.setEnabled(nRain > 0);
      rainMesh.thinInstanceCount = nRain;
      state.rainStreaks = nRain;
      if (nRain > 0) {
        // Terminal velocity of a raindrop is about nine metres a second, and drizzle falls slower
        // than a downpour because the drops are smaller.
        const fallV = lerp(4.2, 9.2, clamp(mm / 8, 0, 1));
        const box = lerp(60, 130, rainFrac);
        vFall.set(windX * windMs * 0.85, -fallV, windZ * windMs * 0.85, clockT);
        vBox.set(camX, camY, camZ, box);
        vRain.set(lerp(0.55, 1.5, clamp(mm / 8, 0, 1)), 0.016 + 0.010 * rainFrac,
          0.16 + 0.30 * rainFrac, 2.4);
        rainMat.setVector3('uCam', camPos);
        rainMat.setVector4('uBox', vBox);
        rainMat.setVector4('uFall', vFall);
        rainMat.setVector4('uRain', vRain);
        rainMat.setVector4('uSunCol', vSunCol);
        rainMat.setVector4('uSky', vSky);
        rainMat.setVector4('uSkyHz', vSkyHz);
      }

      /* ============================================================ splashes */

      let nSplash = 0;
      if (mm > 0.15 && camY - island.height(camX, camZ) < 260) {
        if (Math.abs(camX - splashOriginX) > 20 || Math.abs(camZ - splashOriginZ) > 20) {
          splashOriginX = camX; splashOriginZ = camZ;
          for (let i = 0; i < SPLASH_CAP; i++) {
            const a = hash2(SEED + 8, i) * TAU;
            const r = 2 + Math.sqrt(hash2(SEED + 9, i)) * 44;
            const x = camX + Math.cos(a) * r;
            const z = camZ + Math.sin(a) * r;
            splashSites[i * 3] = x;
            splashSites[i * 3 + 1] = Math.max(island.height(x, z), seaLevel) + 0.03;
            splashSites[i * 3 + 2] = z;
          }
        }
        const rate = clamp(mm / 6, 0.05, 1.4);
        for (let i = 0; i < SPLASH_CAP; i++) {
          // Each site fires on its own hashed clock, so the pattern never repeats visibly.
          const period = 1.6 / rate;
          const ph = ((clockT / period) + hash2(SEED + 10, i)) % 1;
          if (ph > 0.30) continue;
          const t = ph / 0.30;
          const rr = 0.05 + t * (0.20 + 0.16 * rate);
          const j = nSplash * 16;
          splashM[j] = rr; splashM[j + 1] = 0; splashM[j + 2] = 0; splashM[j + 3] = 0;
          splashM[j + 4] = 0; splashM[j + 5] = 1; splashM[j + 6] = 0; splashM[j + 7] = 0;
          splashM[j + 8] = 0; splashM[j + 9] = 0; splashM[j + 10] = rr; splashM[j + 11] = 0;
          splashM[j + 12] = splashSites[i * 3];
          splashM[j + 13] = splashSites[i * 3 + 1];
          splashM[j + 14] = splashSites[i * 3 + 2];
          splashM[j + 15] = 1;
          const k = nSplash * 4;
          splashP[k] = t;
          splashP[k + 1] = rr;
          splashP[k + 2] = 0;
          splashP[k + 3] = (1 - t) * (1 - t) * clamp(0.25 + rate * 0.55, 0, 0.9);
          nSplash++;
          if (nSplash >= SPLASH_CAP) break;
        }
      }
      splashMesh.setEnabled(nSplash > 0);
      splashMesh.thinInstanceCount = nSplash;
      if (nSplash > 0) {
        splashMesh.thinInstancePartialBufferUpdate('matrix', splashM.subarray(0, nSplash * 16), 0);
        splashMesh.thinInstancePartialBufferUpdate('aP', splashP.subarray(0, nSplash * 4), 0);
        splashMat.setVector3('uCam', camPos);
        splashMat.setVector4('uSunCol', vSunCol);
        splashMat.setVector4('uSkyHz', vSkyHz);
      }

      /* ============================================================ wet ground */

      // Wetting is fast, drying is not. A drying rate in units of wetness an hour: sun on it and
      // wind over it dry sand, cloud and humidity keep it. Sand drains, which is why the puddles
      // on this island go before the wetness does.
      const dryPerHour = clamp(
        0.055 + 0.30 * Math.max(0, sy) * (1 - cloud * 0.7) + 0.020 * wx.windKt * (1 - wx.humidity),
        0.02, 0.9);
      const wetPerHour = clamp(mm * 0.55, 0, 6);
      const hours = dMin / 60;
      wet = clamp(wet + (wetPerHour - dryPerHour) * hours, 0, 1);
      // Standing water needs the ground already wet and more rain on top of it, and it drains
      // through sand fast: this is a sand island, not a clay one.
      const fill = clamp((mm - 1.6) * 0.22, 0, 2) * clamp(wet - 0.4, 0, 1) * 2.5;
      puddle = clamp(puddle + (fill - 0.55) * hours, 0, 1);
      state.groundWetness = +wet.toFixed(3);
      state.puddleLevel = +puddle.toFixed(3);
      state.dryingHoursLeft = +(wet / dryPerHour).toFixed(1);

      /* ============================================================ cloud shadow */

      // The cloud field moves with the wind at cloud height, which runs faster than the surface
      // wind and backed a little from it. A shadow crossing the heath at that speed is the thing
      // you actually notice.
      const cloudMs = windMs * 1.8 + 3;
      cloudDriftX -= windX * cloudMs * d;
      cloudDriftZ -= windZ * cloudMs * d;
      state.cloudShadowSpeedMs = +cloudMs.toFixed(1);
      const cellM = lerp(1500, 5200, clamp(cloud, 0, 1));
      vCloud.set(clamp(cloud, 0, 1), cloudDriftX, cloudDriftZ, cellM);

      // Sample the same field at the camera's ground point and pull the sun down with it, so the
      // shading of everything changes as the shadow crosses and not only the ground texture.
      const shadowHere = cloudFieldAt(camX + cloudDriftX, camZ + cloudDriftZ, cellM, cloud);
      state.cloudShadow = +shadowHere.toFixed(3);
      const sun = stage.sun, hemi = stage.hemi;
      if (sun) {
        if (sunBase === null) sunBase = sun.intensity;
        const dim = 1 - shadowHere * (0.40 + 0.25 * clamp(cloud, 0, 1));
        state.sunDimmedTo = +dim.toFixed(3);
        sun.intensity *= dim;
      }

      /* ============================================================ heat shimmer */

      // Hot dry sand, sun high, little wind. On this island that is a February noon on Main Beach,
      // and the pack's own summer is what puts the temperature there.
      const shimmer = clamp(
        smoothstep(28, 36, wx.tempC)
        * smoothstep(0.12, 0.45, Math.max(0, sy))
        * clamp(1 - wx.windKt / 22, 0, 1)
        * clamp(1 - wet * 2.2, 0, 1)
        * (1 - cloud * 0.6), 0, 1);
      state.heatShimmer = +shimmer.toFixed(3);
      vHeat.set(shimmer, clockT * 0.35, wx.windKt, wx.tempC);

      /* ============================================================ ground overlay */

      if (groundShadow) {
        const camH = Math.max(2, camY - island.height(camX, camZ));
        const span = clamp(camH * 5.5 + 260, 320, 5600);
        vCentre.set(camX, camZ, span, 2.35);
        vWet.set(wet, seaLevel, mm, puddle);
        // The overlay is a near-field sheet: wet sand, standing water, the shimmer over a beach
        // and the shadow crossing the ground you are standing on. Above about two kilometres it
        // would be a five kilometre patch in the middle of a thirty nine kilometre island, which
        // reads as a stain rather than as weather, so it stands down and the sun dimming below
        // carries the cloud shadow on its own.
        const near = camH < 2400;
        const on = near && (shadowHere > 0.001 || wet > 0.02 || shimmer > 0.01 || cloud > 0.03);
        groundShadow.setEnabled(on);
        groundSheen.setEnabled(on && (wet > 0.02 || shimmer > 0.01));
        if (on) {
          for (const m of [matShadow, matSheen]) {
            m.setVector3('uCam', camPos);
            m.setVector4('uCentre', vCentre);
            m.setVector4('uField', vField);
            m.setVector4('uFieldN', vFieldN);
            m.setVector4('uCloud', vCloud);
            m.setVector4('uWet', vWet);
            m.setVector4('uSun', vSun);
            m.setVector4('uSunCol', vSunCol);
            m.setVector4('uSkyHz', vSkyHz);
            m.setVector4('uHeat', vHeat);
          }
        }
      }

      /* ============================================================ fog */

      // Radiation fog. The condition is the published one: the air has cooled to within about a
      // degree and a half of its dew point, the wind is under six knots and the sky is clear
      // enough to radiate. It builds through the small hours and burns off after sunrise.
      const spread = wx.tempC - wx.dewPointC;
      const el = dl ? dl.elevationDeg : 0;
      const cond = smoothstep(2.4, 0.5, spread)
        * clamp(1 - wx.windKt / 8, 0, 1)
        * smoothstep(0.7, 0.25, cloud)
        * (el < 2 ? 1 : clamp(1 - (el - 2) / 9, 0, 1));
      // Burn off is quick once the sun is on it; forming takes hours.
      const rate = cond > fogIdx ? 0.9 : 3.4;
      fogIdx = clamp(fogIdx + (cond - fogIdx) * clamp(hours * rate, 0, 1), 0, 1);
      state.fogIndex = +fogIdx.toFixed(3);
      state.fogReason = fogIdx < 0.02 ? ''
        : `dew point spread ${spread.toFixed(1)} deg, wind ${Math.round(wx.windKt)} kt, cloud `
        + `${Math.round(cloud * 100)} per cent`;
      const fogBase = seaLevel + 0.5;
      const spacing = 1.5 + 1.4 * fogIdx;
      state.fogTopM = +(fogBase + FOG_SLABS * spacing - seaLevel).toFixed(1);
      fogMesh.setEnabled(fogIdx > 0.02);
      if (fogIdx > 0.02) {
        vFog.set(camX, camZ, fogBase, spacing);
        vFogA.set(fogIdx, -windX * windMs * clockT * 0.25, -windZ * windMs * clockT * 0.25, FOG_SLABS);
        fogMat.setVector3('uCam', camPos);
        fogMat.setVector4('uFog', vFog);
        fogMat.setVector4('uFogA', vFogA);
        fogMat.setVector4('uSunCol', vSunCol);
        fogMat.setVector4('uSky', vSky);
        fogMat.setVector4('uSkyHz', vSkyHz);
      }

      /* ============================================================ sea spray */

      let sprayNow = 0;
      if (wx.swellM > 1.3 && spraySites.length) {
        // A set arrives on the swell period. Every site fires on the same swell, offset by where
        // it sits along the rock, which is why the whole headland goes off together.
        const period = Math.max(6, wx.swellPeriodS);
        const force = clamp((wx.swellM - 1.3) / 3.2, 0, 1.4);
        for (let i = 0; i < spraySites.length; i++) {
          const s = spraySites[i];
          const dist = Math.hypot(s.x - camX, s.z - camZ);
          if (dist > 2400) continue;
          sprayNow++;
          const ph = ((clockT + s.t) / period) % 1;
          if (ph > 0.06) continue;
          if (hash3(SEED + 11, i, Math.floor((clockT + s.t) / period)) > 0.42 + force * 0.4) continue;
          const n = 2 + Math.round(force * 5);
          for (let q = 0; q < n; q++) {
            const hh = hash3(SEED + 12, i, q + Math.floor(clockT));
            emitPuff(
              s.x + (hh - 0.5) * 9, s.y + 1.0, s.z + (hash3(SEED + 13, i, q) - 0.5) * 9,
              windX * windMs * 0.8 + (hh - 0.5) * 5,
              7 + force * 15 + hh * 6,
              windZ * windMs * 0.8 + (hash3(SEED + 14, i, q) - 0.5) * 5,
              2.2 + hh * 1.6, 1.6, 7 + force * 8, 0, clamp(0.30 + force * 0.45, 0, 0.8), 0.35);
          }
        }
      }
      state.sprayNow = sprayNow;

      /* ============================================================ sand drift */

      // Sand streaming off a dune crest. It takes about twenty knots to move dry sand, and wet
      // sand does not move at all, which is why a southerly the day after rain is only wind.
      let drift = 0;
      if (wx.windKt > 18 && wet < 0.35) {
        drift = clamp((wx.windKt - 18) / 22, 0, 1) * (1 - wet * 2.8);
        const n = Math.round(drift * 5);
        for (let q = 0; q < n; q++) {
          const a = hash3(SEED + 15, q, Math.floor(clockT * 6)) * TAU;
          const r = 12 + hash3(SEED + 16, q, Math.floor(clockT * 7)) * 120;
          const x = camX + Math.cos(a) * r;
          const z = camZ + Math.sin(a) * r;
          const cov = island.landCover(x, z);
          if (cov !== 'beach' && cov !== 'foredune') continue;
          const y = island.height(x, z);
          emitPuff(x, y + 0.35, z,
            windX * windMs * 1.15, 0.5 + drift * 1.6, windZ * windMs * 1.15,
            1.6 + drift * 1.4, 0.6, 4.5, 2, 0.16 + drift * 0.28, 0.02);
        }
      }
      state.sandDrift = +drift.toFixed(3);

      /* ============================================================ smoke */

      let livePlumes = 0;
      for (let i = plumes.length - 1; i >= 0; i--) {
        const p = plumes[i];
        p.t += d;
        if (p.t > p.life) { plumes.splice(i, 1); continue; }
        livePlumes++;
        const dist = Math.hypot(p.x - camX, p.z - camZ);
        if (dist > 9000) continue;
        // A cool planned burn puts up a low white column; a wildfire puts up a brown one that
        // leans hard downwind. The cause comes from the vegetation system, not from here.
        const wild = p.cause !== 'planned';
        const rise = wild ? 9 : 4.2;
        const rate = clamp(p.ha / 90, 0.4, 3) * (1 - smoothstep(0.6, 1.0, p.t / p.life));
        const n = Math.round(rate * 3);
        for (let q = 0; q < n; q++) {
          const a = hash3(SEED + 17, q, Math.floor(clockT * 8) + i) * TAU;
          const r = Math.sqrt(hash3(SEED + 18, q, Math.floor(clockT * 9) + i)) * p.r;
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          const y = Math.max(island.height(x, z), seaLevel) + 1.2;
          emitPuff(x, y, z,
            windX * windMs * 0.55, rise * (0.6 + hash3(SEED + 19, q, i) * 0.8), windZ * windMs * 0.55,
            22 + hash3(SEED + 20, q, i) * 20, 6, 46 + (wild ? 40 : 0), 1,
            (wild ? 0.28 : 0.17) * clamp(1 - dist / 9000, 0.1, 1), 0.55);
        }
      }
      state.smokePlumes = livePlumes;
      const townSmoke = veg ? clamp(veg.smokeOverTownship || 0, 0, 1) : 0;
      state.smokeOverTownship = +townSmoke.toFixed(3);
      // Wildfire smoke is browner than a cool burn's. Both sit in the same colour family as the
      // haze the sky layer puts on the horizon so the plume does not look pasted on.
      const anyWild = plumes.some((p) => p.cause !== 'planned');
      vSmoke.set(anyWild ? 0.34 : 0.50, anyWild ? 0.29 : 0.49, anyWild ? 0.24 : 0.46, 0);
      if (townSmoke > 0.02) {
        // Smoke over a township is smoke you are looking through. Warm the fog the sky set and
        // bring the visibility down with it.
        const k = townSmoke * 0.35;
        scene.fogColor.set(
          lerp(scene.fogColor.r, 0.42, k),
          lerp(scene.fogColor.g, 0.35, k),
          lerp(scene.fogColor.b, 0.27, k)
        );
        scene.fogDensity = Math.min(9e-4, scene.fogDensity * (1 + townSmoke * 1.6));
      }

      /* ============================================================ lightning */

      const stormy = wx.synoptic === 'storm' || (wx.synoptic === 'trough' && wx.rainMmHr > 3);
      // Where the cell is. Storms build over the mainland to the west and come across the bay,
      // so the bearing is where the wind is from and the distance closes as the state runs on.
      const bearing = wx.windDirDeg;
      const distM = clamp(46000 - wx.hoursInState * 3400, 9000, 60000);
      state.lightning.active = stormy;
      state.lightning.bearingDeg = Math.round(bearing);
      state.lightning.distanceKm = +(distM / 1000).toFixed(1);
      lastFlashAgo += d;
      state.lightning.lastFlashAgoS = +lastFlashAgo.toFixed(1);

      if (stormy) {
        strikeTimer -= d;
        if (strikeTimer <= 0) {
          // Rate rises as the cell closes: a distant cell flickers, a near one is continuous.
          const near = clamp(1 - distM / 46000, 0, 1);
          strikeTimer = lerp(14, 2.4, near) * (0.4 + hash2(SEED + 21, strikeCount) * 1.4);
          strikeCount++;
          const th = ((bearing + 180) * Math.PI) / 180;
          // Spread the cell across a front rather than putting every bolt in one place.
          const spreadM = distM * 0.35;
          const sx = camX - Math.sin(th) * distM + (hash2(SEED + 22, strikeCount) - 0.5) * spreadM;
          const sz = camZ - Math.cos(th) * distM + (hash2(SEED + 23, strikeCount) - 0.5) * spreadM;
          const realDist = Math.hypot(sx - camX, sz - camZ);
          strikes.push({
            x: sx, z: sz, t: 0, life: 0.42, seed: hash2(SEED + 24, strikeCount) * 90,
            restrikes: 1 + Math.floor(hash2(SEED + 25, strikeCount) * 3)
          });
          if (strikes.length > 3) strikes.shift();
          flash = 1;
          lastFlashAgo = 0;
          const delayS = realDist / SOUND_MS;
          thunders.push({ at: clockT + delayS, km: realDist / 1000, delayS, x: sx, z: sz });
          state.thunder.lastDelayS = +delayS.toFixed(1);
          state.thunder.lastDistanceKm = +(realDist / 1000).toFixed(1);
          state.lightning.strikes = strikeCount;
          world.bus.emit('weather:lightning', {
            x: sx, z: sz,
            bearingDeg: Math.round(bearing),
            distanceKm: +(realDist / 1000).toFixed(1),
            thunderInS: +delayS.toFixed(1),
            shape: thunderShape(realDist / 1000),
            text: `Lightning ${Math.round(realDist / 1000)} km away. Thunder in about `
              + `${Math.round(delayS)} seconds.`
          });
        }
      }

      // The bolt itself. One at a time on screen, drawn as a shader-built jagged ribbon.
      let boltOn = false;
      for (let i = strikes.length - 1; i >= 0; i--) {
        const s = strikes[i];
        s.t += d;
        if (s.t > s.life) { strikes.splice(i, 1); continue; }
        if (boltOn) continue;
        // A stroke is a few flickers, not one steady line.
        const flick = Math.sin(s.t * 62 + s.seed) > -0.25 && s.t < s.life * 0.75 ? 1 : 0;
        if (!flick) continue;
        boltOn = true;
        const distKm = Math.hypot(s.x - camX, s.z - camZ) / 1000;
        vBolt.set(s.x, s.z, clamp(distKm * 300, 200, 4000), clamp(distKm * 8, 6, 90));
        vBolt2.set(2900, Math.max(island.height(s.x, s.z), seaLevel), s.seed,
          clamp(1 - s.t / s.life, 0, 1) * clamp(1.2 - distKm / 60, 0.25, 1));
        boltMat.setVector3('uCam', camPos);
        boltMat.setVector4('uBolt', vBolt);
        boltMat.setVector4('uBolt2', vBolt2);
      }
      boltMesh.setEnabled(boltOn);

      // The flash on the ground. It lights everything for a fraction of a second, which is what
      // separates lightning you see from lightning you are told about.
      flash *= Math.exp(-d * 7.5);
      if (flash > 0.004 && stage.hemi) {
        const near = clamp(1 - distM / 46000, 0.05, 1);
        stage.hemi.intensity += flash * 2.6 * near;
        if (stage.sun) stage.sun.intensity += flash * 0.6 * near;
      }

      // Thunder, when it gets here.
      let pending = 0;
      for (let i = thunders.length - 1; i >= 0; i--) {
        const t = thunders[i];
        if (clockT >= t.at) {
          thunders.splice(i, 1);
          state.thunder.heard++;
          state.thunder.lastShape = thunderShape(t.km);
          world.bus.emit('weather:thunder', {
            x: t.x, z: t.z,
            distanceKm: +t.km.toFixed(1), delayS: +t.delayS.toFixed(1),
            shape: thunderShape(t.km),
            text: `Thunder, ${Math.round(t.delayS)} seconds after the flash: about `
              + `${Math.round(t.km)} km away.`
          });
        } else pending++;
      }
      state.thunder.pending = pending;

      /* ============================================================ puffs */

      stepPuffs(d, windX * windMs, windZ * windMs);
      puffMat.setVector3('uCam', camPos);
      puffMat.setVector3('uUp', vUp);
      puffMat.setVector4('uSunCol', vSunCol);
      puffMat.setVector4('uSky', vSky);
      puffMat.setVector4('uSkyHz', vSkyHz);
      puffMat.setVector4('uSmoke', vSmoke);
    },

    dispose() {
      for (const m of [rainMesh, splashMesh, fogMesh, puffMesh, boltMesh, groundShadow, groundSheen]) {
        if (m) { if (m.material) m.material.dispose(); m.dispose(); }
      }
      if (texH) texH.dispose();
    }
  });

  /** The same cloud field the ground shader runs, evaluated once on the CPU for the sun light. */
  function cloudFieldAt(x, z, cellM, cover) {
    const q1 = fbmCpu(x / cellM, z / cellM);
    const q2 = fbmCpu((x / cellM) * 3.3, (z / cellM) * 3.3);
    const n = q1 * 0.72 + q2 * 0.28;
    const thr = lerp(0.86, 0.16, clamp(cover, 0, 1));
    return smoothstep(thr - 0.10, thr + 0.10, n);
  }
  function h21(px, pz) {
    let x = (px * 123.34) % 1, z = (pz * 456.21) % 1;
    const dp = x * x + z * z + 45.32;
    x = (x + dp) % 1; z = (z + dp) % 1;
    return Math.abs((x * z) % 1);
  }
  function vnoiseCpu(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    let fx = x - ix, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = h21(ix, iz), b = h21(ix + 1, iz);
    const c = h21(ix, iz + 1), e = h21(ix + 1, iz + 1);
    return lerp(lerp(a, b, fx), lerp(c, e, fx), fz);
  }
  function fbmCpu(x, z) {
    return vnoiseCpu(x, z) * 0.55 + vnoiseCpu(x * 2.13 + 7.7, z * 2.13 + 7.7) * 0.28
      + vnoiseCpu(x * 4.7 - 3.1, z * 4.7 - 3.1) * 0.17;
  }

  function stepPuffs(d, wxs, wzs) {
    let n = 0;
    for (let i = 0; i < PUFF_CAP; i++) {
      const p = puffs[i];
      if (p.a >= p.life) continue;
      p.a += d;
      if (p.a >= p.life) continue;
      const t = p.a / p.life;
      // Spray and sand fall; smoke rises until it runs out of buoyancy and then drifts.
      p.vy += (-7.0 + p.buoy * 22 * (1 - t)) * d;
      p.vx += (wxs * (p.kind === 1 ? 0.9 : 1.1) - p.vx) * d * 0.9;
      p.vz += (wzs * (p.kind === 1 ? 0.9 : 1.1) - p.vz) * d * 0.9;
      p.x += p.vx * d; p.y += p.vy * d; p.z += p.vz * d;
      const j = n * 16;
      puffM[j] = 1; puffM[j + 5] = 1; puffM[j + 10] = 1; puffM[j + 15] = 1;
      puffM[j + 1] = puffM[j + 2] = puffM[j + 3] = 0;
      puffM[j + 4] = puffM[j + 6] = puffM[j + 7] = 0;
      puffM[j + 8] = puffM[j + 9] = puffM[j + 11] = 0;
      puffM[j + 12] = p.x; puffM[j + 13] = p.y; puffM[j + 14] = p.z;
      const k = n * 4;
      puffP[k] = t;
      puffP[k + 1] = lerp(p.s0, p.s1, Math.sqrt(t));
      puffP[k + 2] = p.kind;
      puffP[k + 3] = p.op * (1 - t) * (1 - t) * smoothstep(0, 0.10, t);
      n++;
      if (n >= PUFF_CAP) break;
    }
    puffMesh.setEnabled(n > 0);
    puffMesh.thinInstanceCount = n;
    if (n > 0) {
      puffMesh.thinInstancePartialBufferUpdate('matrix', puffM.subarray(0, n * 16), 0);
      puffMesh.thinInstancePartialBufferUpdate('aP', puffP.subarray(0, n * 4), 0);
    }
  }

  return layer;
}
