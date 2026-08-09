// Vehicles. What is actually on this island's roads, its sand and its water.
//
// EVERY ONE OF THESE IS A REAL THING ON MINJERRIBAH
//   The barge. SeaLink's vehicle ferry, fifty five metres of it, crossing Quandamooka (Moreton
//   Bay) between Toondah Harbour at Cleveland and the ramp at Junner Street, Dunwich (Goompi), on
//   the published forty five minute crossing. It is the island's front door and there is no bridge.
//   The passenger ferry on the twenty five minute walk-on crossing.
//   The bus. Route 880 to Point Lookout and route 881 to Amity Point, run by Transit Systems under
//   contract to Translink, on the printed December 2025 timetable, taking the published forty
//   three minutes out and thirty nine back.
//   Utes with boats on trailers, because a third of the households on this island have a boat and
//   the ramps at Amity Point and Dunwich are where they go.
//   Four wheel drives on Main Beach and Flinders Beach, on a permit, throwing sand.
//   The kerbside collection truck, the morning after bin night, crawling.
//
// WHAT MAKES IT LOOK LIKE THIS ISLAND AND NOT A CITY
//   Dust. A 4WD doing sixty on Main Beach or bouncing along a sand track pulls a plume behind it,
//   and the plume is the only thing you can see of a vehicle two kilometres up the beach. It is
//   built from the vehicle's own speed and the surface it is on, and it dies when the vehicle
//   stops or reaches bitumen.
//   Headlights, from the real daylight state, not from a clock guess. The sun sets at 17:44 in
//   late September here and the lights come on as it goes.
//   A wake behind the barge, because a fifty five metre vessel doing fourteen knots leaves one.
//
// DRAW CALLS
//   Six meshes, thin-instanced: body, cabin glass, wheels, trailer, vessel and the dust. Under a
//   hundred instances of anything at any time, because there are about a hundred vehicles moving
//   on this island at once and that is the real number, not a budget.
//
// Reads: traffic (positions, kinds, headings, dust), daylight, weather, island.
// Draws nothing headless.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const MAX_VEH = 560;
const MAX_DUST = 900;
const LOD_FAR = 3400;

/**
 * Every kind traffic.js can put on the road, with its real size. A Hilux is 5.3 m long; a Rosa
 * bus is about 7 and a Volvo B7 about 12.5; the barge is 55. These are the sizes that make a
 * street read as a street when you stand a person next to a car.
 */
const KIND = {
  car: { L: 4.4, W: 1.80, H: 1.46, cabin: 0.52, wheels: 4, kind: 0 },
  ute: { L: 5.3, W: 1.90, H: 1.86, cabin: 0.40, wheels: 4, kind: 1 },
  'ute-and-boat': { L: 5.3, W: 1.90, H: 1.86, cabin: 0.40, wheels: 4, kind: 1, trailer: 1 },
  fourwd: { L: 4.9, W: 1.92, H: 1.90, cabin: 0.55, wheels: 4, kind: 2 },
  'fourwd-and-camper': { L: 4.9, W: 1.92, H: 1.90, cabin: 0.55, wheels: 4, kind: 2, trailer: 2 },
  bus: { L: 12.5, W: 2.50, H: 3.10, cabin: 0.68, wheels: 6, kind: 3 },
  'waste-truck': { L: 9.4, W: 2.50, H: 3.30, cabin: 0.30, wheels: 6, kind: 4 },
  ambulance: { L: 6.2, W: 2.20, H: 2.60, cabin: 0.34, wheels: 4, kind: 5 },
  barge: { L: 55, W: 14, H: 5.5, cabin: 0.20, wheels: 0, kind: 6, vessel: true },
  'water-taxi': { L: 24, W: 6.4, H: 3.4, cabin: 0.45, wheels: 0, kind: 7, vessel: true }
};

/** Paint. Utes and 4WDs on this island are mostly white, silver or a faded colour. */
const PAINT = [
  [0.86, 0.86, 0.85], [0.86, 0.86, 0.85], [0.78, 0.79, 0.80], [0.62, 0.64, 0.66],
  [0.30, 0.32, 0.35], [0.46, 0.40, 0.36], [0.36, 0.44, 0.46], [0.70, 0.66, 0.58],
  [0.24, 0.26, 0.28], [0.54, 0.24, 0.20], [0.20, 0.34, 0.28], [0.90, 0.90, 0.88]
];
const BUS_PAINT = [0.92, 0.90, 0.86];
const TRUCK_PAINT = [0.36, 0.42, 0.38];
const AMBO_PAINT = [0.95, 0.95, 0.94];
const HULL = [0.90, 0.90, 0.88];
const HULL_LOWER = [0.16, 0.22, 0.30];

/* ------------------------------------------------------------------ parts */

function boxMesh(withEnds) {
  const pos = [], nrm = [], part = [], idx = [];
  const faces = [
    { o: [0, 0, -0.5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
    { o: [0, 0, 0.5], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    { o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
    { o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
    { o: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    { o: [0, -0.5, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] }
  ];
  for (const f of faces) {
    if (!withEnds && (f.n[1] < -0.5)) continue;
    const base = pos.length / 3;
    for (const [su, sv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      pos.push(
        f.o[0] + f.u[0] * su + f.v[0] * sv,
        f.o[1] + f.u[1] * su + f.v[1] * sv + 0.5,
        f.o[2] + f.u[2] * su + f.v[2] * sv
      );
      nrm.push(f.n[0], f.n[1], f.n[2]);
      part.push(0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), part: new Float32Array(part), idx: new Uint16Array(idx) };
}

/** Four or six wheels as short cylinders, laid out along the instance's own length in the shader. */
function wheelMesh() {
  const pos = [], nrm = [], part = [], idx = [];
  const SEG = 8;
  for (let w = 0; w < 6; w++) {
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const base = pos.length / 3;
      pos.push(-0.5, s0, c0, 0.5, s0, c0, 0.5, s1, c1, -0.5, s1, c1);
      for (let k = 0; k < 4; k++) nrm.push(0, (s0 + s1) / 2, (c0 + c1) / 2);
      for (let k = 0; k < 4; k++) part.push(w);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), part: new Float32Array(part), idx: new Uint16Array(idx) };
}

/** A hull: a flat-bottomed barge shape, and a finer one for the passenger ferry. */
function hullMesh() {
  const pos = [], nrm = [], part = [], idx = [];
  // A ring of sections down the length, tapered at the bow.
  const sections = [
    { z: -0.50, w: 0.20, y0: -0.10, y1: 0.20 },
    { z: -0.34, w: 0.72, y0: -0.16, y1: 0.24 },
    { z: -0.10, w: 1.00, y0: -0.18, y1: 0.26 },
    { z: 0.24, w: 1.00, y0: -0.18, y1: 0.26 },
    { z: 0.44, w: 0.86, y0: -0.16, y1: 0.24 },
    { z: 0.50, w: 0.62, y0: -0.12, y1: 0.22 }
  ];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    const quad = (ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx2, dy2, dz2, n, p) => {
      const base = pos.length / 3;
      pos.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx2, dy2, dz2);
      for (let k = 0; k < 4; k++) { nrm.push(n[0], n[1], n[2]); part.push(p); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // sides
    quad(-a.w / 2, a.y0, a.z, -b.w / 2, b.y0, b.z, -b.w / 2, b.y1, b.z, -a.w / 2, a.y1, a.z, [-1, 0.1, 0], 0);
    quad(a.w / 2, a.y1, a.z, b.w / 2, b.y1, b.z, b.w / 2, b.y0, b.z, a.w / 2, a.y0, a.z, [1, 0.1, 0], 0);
    // deck
    quad(-a.w / 2, a.y1, a.z, -b.w / 2, b.y1, b.z, b.w / 2, b.y1, b.z, a.w / 2, a.y1, a.z, [0, 1, 0], 1);
    // bottom
    quad(a.w / 2, a.y0, a.z, b.w / 2, b.y0, b.z, -b.w / 2, b.y0, b.z, -a.w / 2, a.y0, a.z, [0, -1, 0], 0);
  }
  // A wheelhouse aft, which both vessels have.
  const wh = (x0, x1, y0, y1, z0, z1) => {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]];
    const f = [[0, 1, 2, 3, [0, 0, -1]], [4, 5, 6, 7, [0, 0, 1]], [5, 0, 3, 6, [-1, 0, 0]], [1, 4, 7, 2, [1, 0, 0]], [3, 2, 7, 6, [0, 1, 0]]];
    for (const q of f) {
      const base = pos.length / 3;
      for (let k = 0; k < 4; k++) { const v = c[q[k]]; pos.push(v[0], v[1], v[2]); nrm.push(q[4][0], q[4][1], q[4][2]); part.push(2); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  wh(-0.22, 0.22, 0.26, 0.50, -0.38, -0.18);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), part: new Float32Array(part), idx: new Uint16Array(idx) };
}

/** A boat on a trailer, and a camper trailer, as two shapes chosen by an instance flag. */
function trailerMesh() {
  const pos = [], nrm = [], part = [], idx = [];
  const quad = (v, n, p) => {
    const base = pos.length / 3;
    for (const q of v) { pos.push(q[0], q[1], q[2]); nrm.push(n[0], n[1], n[2]); part.push(p); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // part 1: a tinny, pointed bow, sitting on a trailer.
  quad([[-0.72, 0.55, -1.9], [0.72, 0.55, -1.9], [0.55, 0.55, 0.6], [-0.55, 0.55, 0.6]], [0, 1, 0], 1);
  quad([[-0.72, 0.55, -1.9], [-0.55, 0.55, 0.6], [-0.42, 0.16, 0.5], [-0.55, 0.16, -1.8]], [-1, 0.2, 0], 1);
  quad([[0.72, 0.55, -1.9], [0.55, 0.16, -1.8], [0.42, 0.16, 0.5], [0.55, 0.55, 0.6]], [1, 0.2, 0], 1);
  quad([[-0.55, 0.55, 0.6], [0.55, 0.55, 0.6], [0.0, 0.30, 1.5], [0.0, 0.30, 1.5]], [0, 0.4, 1], 1);
  // part 2: a camper trailer, a box with a lid.
  quad([[-0.85, 0.52, -1.6], [0.85, 0.52, -1.6], [0.85, 1.18, -1.6], [-0.85, 1.18, -1.6]], [0, 0, -1], 2);
  quad([[0.85, 0.52, 0.5], [-0.85, 0.52, 0.5], [-0.85, 1.18, 0.5], [0.85, 1.18, 0.5]], [0, 0, 1], 2);
  quad([[-0.85, 0.52, 0.5], [-0.85, 0.52, -1.6], [-0.85, 1.18, -1.6], [-0.85, 1.18, 0.5]], [-1, 0, 0], 2);
  quad([[0.85, 0.52, -1.6], [0.85, 0.52, 0.5], [0.85, 1.18, 0.5], [0.85, 1.18, -1.6]], [1, 0, 0], 2);
  quad([[-0.85, 1.18, -1.6], [0.85, 1.18, -1.6], [0.85, 1.18, 0.5], [-0.85, 1.18, 0.5]], [0, 1, 0], 2);
  // part 0: the drawbar, both have one.
  quad([[-0.06, 0.42, 0.5], [0.06, 0.42, 0.5], [0.06, 0.50, 2.2], [-0.06, 0.50, 2.2]], [0, 1, 0], 0);
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), part: new Float32Array(part), idx: new Uint16Array(idx) };
}

/** A dust puff: one camera-facing quad. */
function puffMesh() {
  return {
    pos: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    idx: new Uint16Array([0, 1, 2, 0, 2, 3])
  };
}

/* ------------------------------------------------------------------ shaders */

const LIGHT = `
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;     // x fog density, y wetness, z darkness 0..1, w sea level
vec3 litColour(vec3 base, vec3 N) {
  float ndl = max(dot(N, uSun.xyz), 0.0);
  ndl = ndl * 0.88 + pow(max(dot(N, uSun.xyz) * 0.5 + 0.5, 0.0), 2.0) * 0.12;
  vec3 sun = uSunCol.rgb * uSunCol.a * ndl;
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.5) * (0.34 + 0.40 * clamp(N.y, 0.0, 1.0));
  vec3 bounce = vec3(0.84, 0.78, 0.64) * uSunCol.rgb * uSunCol.a * 0.13 * clamp(-N.y, 0.0, 1.0);
  return base * (sun + sky + bounce);
}
vec3 hazed(vec3 col, vec3 P) {
  float dist = length(P - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  return mix(col, mix(uSkyHz.rgb, uSky.rgb, 0.3), fog * 0.86);
}
`;

const BODY_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float part;
attribute vec4 iPos;     // x, y, z, heading
attribute vec4 iSize;    // length, width, height, cabin fraction
attribute vec4 iPaint;   // rgb paint, a kind id
attribute vec4 iState;   // x speed m/s, y lights 0/1, z tilt, w brake
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vKind;
varying vec3 vLocal;
void main(void) {
  vec3 p = position;
  // The unit box has its base at y = 0 and is one unit in x and z. Scale to the real vehicle.
  p.x *= iSize.y;
  p.z *= iSize.x;
  // The cabin is a step in the roof line rather than a second box: the front cabin fraction of
  // the length is the bonnet and sits lower, which is what tells a ute from a wagon at a glance.
  float roof = iSize.z;
  float nose = smoothstep(0.5 - iSize.w, 0.5 - iSize.w + 0.08, position.z);
  float bonnet = mix(iSize.z * 0.56, iSize.z, nose);
  p.y *= (iPaint.a > 5.5) ? iSize.z : bonnet;
  p.y += 0.30 * step(iPaint.a, 5.5);        // ride height, only for things with wheels
  // A vehicle leans a little into a corner and dips under the brakes: small, but it is the
  // difference between a model moving and a vehicle being driven.
  p.y += iState.z * p.x * 0.03 - iState.w * (0.5 - position.z) * 0.05;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) + iPos.xyz;
  vec3 wn = vec3(normal.x * ch + normal.z * sh, normal.y, -normal.x * sh + normal.z * ch);
  vCol = iPaint.rgb;
  vKind = iPaint.a;
  vLocal = vec3(position.x, position.y, position.z);
  vPos = wp;
  vNrm = normalize(wn);
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const BODY_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vKind;
varying vec3 vLocal;
${LIGHT}
void main(void) {
  vec3 base = vCol;
  vec3 N = normalize(vNrm);
  // Glass: the upper band round the sides and the two ends of anything with a cabin.
  float glass = step(0.42, vLocal.y) * step(abs(N.y), 0.7) * step(vKind, 5.5);
  if (glass > 0.5) base = mix(vCol * 0.18, mix(uSkyHz.rgb, uSky.rgb, 0.6), 0.55);
  vec3 col = litColour(base, N);
  // Paint keeps a highlight; a wet road gives it more.
  vec3 V = normalize(vPos - uCam);
  vec3 H = normalize(uSun.xyz - V);
  col += uSunCol.rgb * uSunCol.a * pow(max(dot(N, H), 0.0), 58.0) * (0.30 + uTune.y * 0.5);
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

const WHEEL_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float part;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iPaint;
attribute vec4 iState;   // x speed, y lights, z tilt, w wheel count
uniform mat4 viewProjection;
uniform float uTime;
varying vec3 vPos;
varying vec3 vNrm;
void main(void) {
  float w = part;
  float count = iState.w;
  if (w >= count) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vPos = vec3(0.0); vNrm = vec3(0.0, 1.0, 0.0); return; }
  float axle = floor(w * 0.5);
  float side = (mod(w, 2.0) < 0.5) ? -1.0 : 1.0;
  float axles = max(1.0, floor(count * 0.5));
  // Axles spread down the length: front just behind the nose, rear just ahead of the tail.
  float f = (axles < 1.5) ? (axle < 0.5 ? 0.34 : -0.34) : (0.34 - axle * (0.68 / (axles - 1.0)));
  float r = 0.33;
  vec3 p = position;
  // Roll. A wheel that does not turn is a sticker.
  float ang = uTime * (iState.x / max(0.1, r));
  float c = cos(ang), s = sin(ang);
  vec3 q = vec3(p.x * 0.16, p.y * r * c - p.z * r * s, p.y * r * s + p.z * r * c);
  q.x += side * (iSize.y * 0.5 - 0.10);
  q.z += f * iSize.x;
  q.y += r;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(q.x * ch + q.z * sh, q.y, -q.x * sh + q.z * ch) + iPos.xyz;
  vec3 n2 = vec3(normal.x, normal.y * c - normal.z * s, normal.y * s + normal.z * c);
  vNrm = normalize(vec3(n2.x * ch + n2.z * sh, n2.y, -n2.x * sh + n2.z * ch));
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const WHEEL_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
${LIGHT}
void main(void) {
  vec3 col = litColour(vec3(0.10, 0.10, 0.11), normalize(vNrm));
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

const TRAILER_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float part;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iPaint;   // a: which trailer, 1 boat 2 camper
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
void main(void) {
  if (part > 0.5 && abs(part - iPaint.a) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vPos = vec3(0.0); vNrm = vec3(0.0, 1.0, 0.0); vCol = vec3(0.0); return; }
  // Hitched behind: the trailer sits back beyond the tow vehicle's tail.
  vec3 p = position + vec3(0.0, 0.0, -iSize.x * 0.5 - 1.9);
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) + iPos.xyz;
  vNrm = normalize(vec3(normal.x * ch + normal.z * sh, normal.y, -normal.x * sh + normal.z * ch));
  vCol = part < 1.5 ? vec3(0.86, 0.86, 0.84) : vec3(0.80, 0.79, 0.74);
  if (part < 0.5) vCol = vec3(0.24, 0.24, 0.26);
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const TRAILER_FRAG = BODY_FRAG.replace('varying float vKind;', 'const float vKind = 0.0;')
  .replace('varying vec3 vLocal;', 'const vec3 vLocal = vec3(0.0);');

const HULL_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float part;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iPaint;
attribute vec4 iState;
uniform mat4 viewProjection;
uniform float uTime;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
void main(void) {
  vec3 p = vec3(position.x * iSize.y, position.y * iSize.z, position.z * iSize.x);
  // A hull moves on the water: a slow roll and a slower pitch, both small.
  float roll = sin(uTime * 0.55 + iPos.x * 0.01) * 0.018;
  float pitch = sin(uTime * 0.41 + iPos.z * 0.01) * 0.012;
  p.y += p.x * roll + p.z * pitch;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) + iPos.xyz;
  vNrm = normalize(vec3(normal.x * ch + normal.z * sh, normal.y, -normal.x * sh + normal.z * ch));
  vCol = part < 0.5 ? mix(vec3(0.16, 0.22, 0.30), iPaint.rgb, step(0.0, position.y))
       : (part < 1.5 ? vec3(0.42, 0.44, 0.44) : iPaint.rgb);
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const HULL_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
${LIGHT}
void main(void) {
  vec3 col = litColour(vCol, normalize(vNrm));
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

/** Dust, and the wake behind a vessel. One camera-facing quad, soft edged, ageing out. */
const DUST_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 iPos;      // x, y, z, size in metres
attribute vec4 iLife;     // x age 0..1, y opacity, z tint 0 sand 1 water, w drift
uniform mat4 viewProjection;
uniform vec3 uCam;
varying vec2 vUv;
varying vec4 vLife;
varying vec3 vPos;
void main(void) {
  vec3 c = iPos.xyz;
  vec3 toCam = uCam - c;
  vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
  vec3 up = normalize(cross(toCam, right));
  float s = iPos.w * (0.55 + iLife.x * 1.6);
  vec3 wp = c + right * (position.x * s) + up * (position.y * s) + vec3(0.0, iLife.x * iPos.w * 0.5, 0.0);
  vUv = uv;
  vLife = iLife;
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const DUST_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec4 vLife;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;
void main(void) {
  vec2 d = vUv - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * vLife.y * (1.0 - vLife.x);
  // Silica sand off a beach track is nearly white and it catches the sun; a wake is whiter still.
  vec3 sand = vec3(0.86, 0.81, 0.70);
  vec3 foam = vec3(0.92, 0.95, 0.96);
  vec3 col = mix(sand, foam, vLife.z);
  col *= (0.35 + uSunCol.rgb * uSunCol.a * 0.85);
  float dist = length(vPos - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  col = mix(col, mix(uSkyHz.rgb, uSky.rgb, 0.3), fog * 0.7);
  gl_FragColor = vec4(col, a * 0.62);
}
`;

/** Headlights and tail lights: two small additive quads at each end. */
const LAMP_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iState;   // y lights 0..1, w brake
uniform mat4 viewProjection;
uniform vec3 uCam;
varying vec2 vUv;
varying float vOn;
varying float vRear;
void main(void) {
  if (iState.y < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vOn = 0.0; vRear = 0.0; return; }
  // Four lamps: two forward, two aft, from the quad's own corner index.
  float rear = step(0.5, uv.y);
  float side = (uv.x < 0.5) ? -1.0 : 1.0;
  vec3 local = vec3(side * (iSize.y * 0.36), 0.62, (rear > 0.5 ? -1.0 : 1.0) * iSize.x * 0.48);
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 c = vec3(local.x * ch + local.z * sh, local.y, -local.x * sh + local.z * ch) + iPos.xyz;
  vec3 toCam = uCam - c;
  vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
  vec3 up = normalize(cross(toCam, right));
  float s = (rear > 0.5 ? 0.85 : 1.35) * (1.0 + iState.w * 0.5);
  vec3 wp = c + right * (position.x * s) + up * (position.y * s);
  vUv = position.xy + 0.5;
  vOn = iState.y;
  vRear = rear;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const LAMP_FRAG = `
precision highp float;
varying vec2 vUv;
varying float vOn;
varying float vRear;
void main(void) {
  vec2 d = vUv - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.4) * vOn;
  vec3 col = vRear > 0.5 ? vec3(1.0, 0.14, 0.06) : vec3(1.0, 0.94, 0.80);
  gl_FragColor = vec4(col * a, a);
}
`;

/* ================================================================== the layer */

export function registerVehicles(world) {
  const state = world.publish('vehicles', {
    rendered: false,
    drawn: 0,
    onRoad: 0,
    afloat: 0,
    dustPuffs: 0,
    headlightsOn: false,
    drawCalls: 0,
    buildMs: 0,
    notes: []
  });

  world.register({
    id: 'vehicles',
    phase: 'presentation',
    order: 42,
    describe() {
      return {
        rendered: state.rendered,
        drawn: state.drawn,
        onRoad: state.onRoad,
        afloat: state.afloat,
        dust: state.dustPuffs,
        headlights: state.headlightsOn,
        drawCalls: state.drawCalls
      };
    }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;

  const V = {
    pos: new Float32Array(MAX_VEH * 4),
    size: new Float32Array(MAX_VEH * 4),
    paint: new Float32Array(MAX_VEH * 4),
    st: new Float32Array(MAX_VEH * 4),
    mat: new Float32Array(MAX_VEH * 16),
    n: 0
  };
  const W = {
    pos: new Float32Array(MAX_VEH * 4), size: new Float32Array(MAX_VEH * 4),
    paint: new Float32Array(MAX_VEH * 4), st: new Float32Array(MAX_VEH * 4),
    mat: new Float32Array(MAX_VEH * 16), n: 0
  };
  const T = {
    pos: new Float32Array(200 * 4), size: new Float32Array(200 * 4),
    paint: new Float32Array(200 * 4), mat: new Float32Array(200 * 16), n: 0
  };
  const H = {
    pos: new Float32Array(24 * 4), size: new Float32Array(24 * 4),
    paint: new Float32Array(24 * 4), st: new Float32Array(24 * 4),
    mat: new Float32Array(24 * 16), n: 0
  };
  const P = {
    pos: new Float32Array(MAX_DUST * 4), life: new Float32Array(MAX_DUST * 4),
    mat: new Float32Array(MAX_DUST * 16), n: 0
  };
  const L = {
    pos: new Float32Array(MAX_VEH * 4), size: new Float32Array(MAX_VEH * 4),
    st: new Float32Array(MAX_VEH * 4), mat: new Float32Array(MAX_VEH * 16), n: 0
  };

  function fillIdentity(m) {
    for (let i = 0; i < m.length / 16; i++) {
      const o = i * 16;
      m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1;
    }
  }
  for (const buf of [V.mat, W.mat, T.mat, H.mat, P.mat, L.mat]) fillIdentity(buf);

  /* ---------------------------------------------------------------- the dust

  A plume is not a particle system with a physics budget: it is a ring of puffs, each dropped where
  a vehicle was and left to grow and fade. One per vehicle per frame at most, aged in seconds, and
  the whole ring is nine hundred long, which at half a second of life is more than the island can
  ever fill. */

  const puffs = [];
  for (let i = 0; i < MAX_DUST; i++) puffs.push({ x: 0, y: 0, z: 0, size: 0, age: 1, life: 1, tint: 0, alpha: 0 });
  let puffHead = 0;

  function dropPuff(x, y, z, size, tint, alpha, life) {
    const p = puffs[puffHead];
    puffHead = (puffHead + 1) % MAX_DUST;
    p.x = x; p.y = y; p.z = z; p.size = size; p.age = 0; p.life = life; p.tint = tint; p.alpha = alpha;
  }

  const meshes = {};
  const mats = {};
  let ready = false;
  let clock = 0;

  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.3, 0.5, 0.8, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.8, 0.4);
  const vTune = new B.Vector4(1e-5, 0, 0, 0);
  const camPos = new B.Vector3();

  function shader(name, vert, frag, attrs, opts) {
    const m = new B.ShaderMaterial(name, stage.scene,
      { vertexSource: vert, fragmentSource: frag },
      {
        attributes: ['position', 'normal', 'uv', 'world0', 'world1', 'world2', 'world3'].concat(attrs),
        uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uTime']
      });
    m.backFaceCulling = opts && opts.twoSided ? false : true;
    if (opts && opts.blend) {
      m.needAlphaBlending = () => true;
      m.alphaMode = opts.additive ? B.Engine.ALPHA_ADD : B.Engine.ALPHA_COMBINE;
      m.disableDepthWrite = true;
    }
    return m;
  }

  function realise(name, data, material, extra) {
    const mesh = new B.Mesh(name, stage.scene);
    const vd = new B.VertexData();
    vd.positions = data.pos;
    vd.normals = data.nrm;
    vd.indices = data.idx;
    if (data.uv) vd.uvs = data.uv;
    vd.applyToMesh(mesh, false);
    for (const [k, arr, stride] of extra) mesh.setVerticesData(k, arr, false, stride);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }

  const paintOf = (kind, id) => {
    if (kind === 'bus') return BUS_PAINT;
    if (kind === 'waste-truck') return TRUCK_PAINT;
    if (kind === 'ambulance') return AMBO_PAINT;
    if (kind === 'barge' || kind === 'water-taxi') return HULL;
    return PAINT[hash32(id, 5) % PAINT.length];
  };

  const DEG = Math.PI / 180;
  const idNum = (id) => {
    let n = 0;
    for (let i = 4; i < id.length; i++) n = (n * 10 + (id.charCodeAt(i) - 48)) | 0;
    return n;
  };

  stage.addLayer({
    id: 'vehicles',
    order: 27,

    init(st) {
      const t0 = performance.now();
      mats.body = shader('vehBody', BODY_VERT, BODY_FRAG, ['part', 'iPos', 'iSize', 'iPaint', 'iState']);
      mats.wheel = shader('vehWheel', WHEEL_VERT, WHEEL_FRAG, ['part', 'iPos', 'iSize', 'iPaint', 'iState'], { twoSided: true });
      mats.trailer = shader('vehTrailer', TRAILER_VERT, TRAILER_FRAG, ['part', 'iPos', 'iSize', 'iPaint'], { twoSided: true });
      mats.hull = shader('vehHull', HULL_VERT, HULL_FRAG, ['part', 'iPos', 'iSize', 'iPaint', 'iState'], { twoSided: true });
      mats.dust = shader('vehDust', DUST_VERT, DUST_FRAG, ['iPos', 'iLife'], { twoSided: true, blend: true });
      mats.lamp = shader('vehLamp', LAMP_VERT, LAMP_FRAG, ['iPos', 'iSize', 'iState'], { twoSided: true, blend: true, additive: true });

      const bm = boxMesh(true);
      meshes.body = realise('veh-body', bm, mats.body, [['part', bm.part, 1]]);
      const wm = wheelMesh();
      meshes.wheel = realise('veh-wheel', wm, mats.wheel, [['part', wm.part, 1]]);
      const tm = trailerMesh();
      meshes.trailer = realise('veh-trailer', tm, mats.trailer, [['part', tm.part, 1]]);
      const hm = hullMesh();
      meshes.hull = realise('veh-hull', hm, mats.hull, [['part', hm.part, 1]]);
      const pm = puffMesh();
      meshes.dust = realise('veh-dust', pm, mats.dust, []);
      meshes.lamp = realise('veh-lamp', pm, mats.lamp, []);
      meshes.dust.alphaIndex = 12;
      meshes.lamp.alphaIndex = 14;

      const bind = (mesh, buf, list) => {
        mesh.thinInstanceSetBuffer('matrix', buf.mat, 16, true);
        for (const k of list) mesh.thinInstanceSetBuffer(k, buf[k === 'iPos' ? 'pos' : k === 'iSize' ? 'size' : k === 'iPaint' ? 'paint' : k === 'iLife' ? 'life' : 'st'], 4, false);
        mesh.thinInstanceCount = 0;
      };
      bind(meshes.body, V, ['iPos', 'iSize', 'iPaint', 'iState']);
      bind(meshes.wheel, W, ['iPos', 'iSize', 'iPaint', 'iState']);
      bind(meshes.trailer, T, ['iPos', 'iSize', 'iPaint']);
      bind(meshes.hull, H, ['iPos', 'iSize', 'iPaint', 'iState']);
      bind(meshes.dust, P, ['iPos', 'iLife']);
      bind(meshes.lamp, L, ['iPos', 'iSize', 'iState']);

      ready = true;
      state.rendered = true;
      state.buildMs = +(performance.now() - t0).toFixed(1);
      console.info(`[vehicles] body, wheels, trailer, hull, dust and lamps: six draw calls, built in ${state.buildMs} ms`);
    },

    frame(st, w, dt) {
      if (!ready) return;
      const tr = w.read('traffic');
      if (!tr || !tr.ready || typeof tr.all !== 'function') return;
      const list = tr.all();
      const cam = st.scene.activeCamera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      clock += dt;

      const dl = w.read('daylight');
      const wx = w.read('weather');
      const alt = dl ? dl.altitude : 0.9;
      const az = dl ? dl.azimuth : 0.4;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(
        0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF,
        0.4
      );
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      const wet = wx ? clamp(wx.rainMmHr / 5, 0, 1) : 0;
      // Headlights come on from the real sun elevation, not from a clock guess. In late September
      // here the sun sets at 17:44 and it is dark by about a quarter past six.
      const elev = dl ? dl.elevationDeg : 20;
      const dark = clamp((3 - elev) / 8, 0, 1);
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), wet, dark, island ? island.seaLevel : 0);
      state.headlightsOn = dark > 0.15;

      V.n = 0; W.n = 0; T.n = 0; H.n = 0; L.n = 0;
      let onRoad = 0, afloat = 0;
      const cx = camPos.x, cz = camPos.z;

      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        const spec = KIND[v.kind];
        if (!spec) continue;
        const dx = v.x - cx, dz = v.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > LOD_FAR * LOD_FAR && !spec.vessel) continue;
        const d = Math.sqrt(d2);
        const hd = v.hdg * DEG;
        const n = idNum(v.id);
        const paint = paintOf(v.kind, n);
        const speed = v.speedMs || 0;

        if (spec.vessel) {
          if (H.n >= 24) continue;
          const j = H.n++;
          const o = j * 4;
          H.pos[o] = v.x; H.pos[o + 1] = (island ? island.seaLevel : 0) + spec.H * 0.18; H.pos[o + 2] = v.z; H.pos[o + 3] = hd;
          H.size[o] = spec.L; H.size[o + 1] = spec.W; H.size[o + 2] = spec.H; H.size[o + 3] = spec.cabin;
          H.paint[o] = paint[0]; H.paint[o + 1] = paint[1]; H.paint[o + 2] = paint[2]; H.paint[o + 3] = spec.kind;
          H.st[o] = speed; H.st[o + 1] = dark; H.st[o + 2] = 0; H.st[o + 3] = 0;
          afloat++;
          // A wake. A fifty five metre vessel doing fourteen knots leaves one you can see from the
          // headland, and it is the only part of the crossing that reads at that distance.
          if (speed > 1 && d < 14000) {
            const back = spec.L * 0.55;
            dropPuff(v.x - Math.sin(hd) * back, (island ? island.seaLevel : 0) + 0.4, v.z - Math.cos(hd) * back,
              spec.W * 0.7, 1, 0.5, 3.2);
          }
          continue;
        }

        if (V.n >= MAX_VEH) break;
        const y = island ? island.height(v.x, v.z) : 0;
        const j = V.n++;
        const o = j * 4;
        V.pos[o] = v.x; V.pos[o + 1] = y; V.pos[o + 2] = v.z; V.pos[o + 3] = hd;
        V.size[o] = spec.L; V.size[o + 1] = spec.W; V.size[o + 2] = spec.H; V.size[o + 3] = spec.cabin;
        V.paint[o] = paint[0]; V.paint[o + 1] = paint[1]; V.paint[o + 2] = paint[2]; V.paint[o + 3] = spec.kind;
        const brake = v.waitTicks > 0 && speed < 1 ? 1 : 0;
        V.st[o] = speed; V.st[o + 1] = dark; V.st[o + 2] = 0; V.st[o + 3] = brake;
        onRoad++;

        // Wheels, on the near half of the island only: at six hundred metres a wheel is a pixel.
        if (d < 620 && W.n < MAX_VEH) {
          const k = W.n++;
          const q = k * 4;
          W.pos[q] = v.x; W.pos[q + 1] = y; W.pos[q + 2] = v.z; W.pos[q + 3] = hd;
          W.size[q] = spec.L; W.size[q + 1] = spec.W; W.size[q + 2] = spec.H; W.size[q + 3] = spec.cabin;
          W.paint[q] = paint[0]; W.paint[q + 1] = paint[1]; W.paint[q + 2] = paint[2]; W.paint[q + 3] = spec.kind;
          W.st[q] = speed; W.st[q + 1] = dark; W.st[q + 2] = 0; W.st[q + 3] = spec.wheels;
        }

        // Trailer.
        if (spec.trailer && T.n < 200) {
          const k = T.n++;
          const q = k * 4;
          T.pos[q] = v.x; T.pos[q + 1] = y; T.pos[q + 2] = v.z; T.pos[q + 3] = hd;
          T.size[q] = spec.L; T.size[q + 1] = spec.W; T.size[q + 2] = spec.H; T.size[q + 3] = 0;
          T.paint[q] = paint[0]; T.paint[q + 1] = paint[1]; T.paint[q + 2] = paint[2]; T.paint[q + 3] = spec.trailer;
        }

        // Lamps.
        if (dark > 0.02 && L.n < MAX_VEH) {
          const k = L.n++;
          const q = k * 4;
          L.pos[q] = v.x; L.pos[q + 1] = y; L.pos[q + 2] = v.z; L.pos[q + 3] = hd;
          L.size[q] = spec.L; L.size[q + 1] = spec.W; L.size[q + 2] = spec.H; L.size[q + 3] = 0;
          L.st[q] = speed; L.st[q + 1] = dark; L.st[q + 2] = 0; L.st[q + 3] = brake;
        }

        // Dust. Only off the bitumen, only when actually moving, and more of it the faster it goes.
        if (v.dust > 0.05 && speed > 4 && d < 5200) {
          const back = spec.L * 0.5 + 0.6;
          dropPuff(
            v.x - Math.sin(hd) * back + (hash32(n, (clock * 60) | 0) % 100) / 100 - 0.5,
            y + 0.25,
            v.z - Math.cos(hd) * back + ((hash32(n, ((clock * 60) | 0) + 7) % 100) / 100 - 0.5),
            1.5 + speed * 0.10, 0, clamp(v.dust, 0, 1) * clamp(speed / 16, 0.2, 1), 2.4
          );
        }
      }

      /* --- age the dust ------------------------------------------------------------ */
      P.n = 0;
      for (let i = 0; i < MAX_DUST; i++) {
        const p = puffs[i];
        if (p.age >= 1) continue;
        p.age += dt / p.life;
        if (p.age >= 1) continue;
        if (P.n >= MAX_DUST) break;
        const j = P.n++;
        const o = j * 4;
        P.pos[o] = p.x; P.pos[o + 1] = p.y; P.pos[o + 2] = p.z; P.pos[o + 3] = p.size;
        P.life[o] = p.age; P.life[o + 1] = p.alpha; P.life[o + 2] = p.tint; P.life[o + 3] = 0;
      }

      /* --- upload ------------------------------------------------------------------ */
      const up = (mesh, buf, keys, count) => {
        mesh.thinInstanceCount = count;
        if (count) for (const k of keys) mesh.thinInstanceBufferUpdated(k);
        const on = count > 0;
        if (mesh.isEnabled(false) !== on) mesh.setEnabled(on);
      };
      up(meshes.body, V, ['iPos', 'iSize', 'iPaint', 'iState'], V.n);
      up(meshes.wheel, W, ['iPos', 'iSize', 'iPaint', 'iState'], W.n);
      up(meshes.trailer, T, ['iPos', 'iSize', 'iPaint'], T.n);
      up(meshes.hull, H, ['iPos', 'iSize', 'iPaint', 'iState'], H.n);
      up(meshes.dust, P, ['iPos', 'iLife'], P.n);
      up(meshes.lamp, L, ['iPos', 'iSize', 'iState'], L.n);

      for (const m of Object.values(mats)) {
        m.setVector3('uCam', camPos);
        m.setVector4('uSun', vSun);
        m.setVector4('uSunCol', vSunCol);
        m.setVector4('uSky', vSky);
        m.setVector4('uSkyHz', vSkyHz);
        m.setVector4('uTune', vTune);
        m.setFloat('uTime', clock);
      }

      state.drawn = V.n + H.n;
      state.onRoad = onRoad;
      state.afloat = afloat;
      state.dustPuffs = P.n;
      state.drawCalls = (V.n ? 1 : 0) + (W.n ? 1 : 0) + (T.n ? 1 : 0) + (H.n ? 1 : 0) + (P.n ? 1 : 0) + (L.n ? 1 : 0);
    },

    dispose() {
      for (const m of Object.values(meshes)) { try { m.dispose(); } catch (e) { /* gone */ } }
      for (const m of Object.values(mats)) { try { m.dispose(); } catch (e) { /* gone */ } }
      ready = false;
    }
  });
}
