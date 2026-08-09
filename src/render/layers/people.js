// People. Two thousand and sixty nine residents and up to four and a half thousand visitors, on
// screen, doing the thing the simulation says they are doing.
//
// WHY THIS IS THE LAYER THAT MATTERS
//   Everything under it already worked. population.js knows every person's name, age, household,
//   job and mood; needs.js knows what they are doing and why; schedule.js knows who is on shift;
//   crowd.js knows exactly where each of them is standing. None of it was visible. An island with
//   two thousand people on it and nobody drawn is a map, and a map is not a place.
//
// WHAT YOU CAN SEE FROM HERE, AND WHY IT IS TRUE
//   A surfer at dawn carries a board and walks to the water. A tradesperson wears hi-vis and does
//   not. Somebody in the queue at the Junner Street pontoon stands in a line facing the water. The
//   people on the North Gorge Walk are strung out along the published 1.375 km track and moving
//   along it, because that is what people on a walking track are doing. At half past five in the
//   morning almost nobody is out, and that is not a bug: needs.js has 1,782 of them asleep. The
//   island fills at breakfast, empties at lunch on a hot day and fills again at four.
//
// HOW IT DRAWS FOUR AND A HALF THOUSAND PEOPLE IN FOUR DRAW CALLS
//   Three levels of detail, one thin-instanced mesh each, and one more for what people carry.
//     FIGURE     under 190 m. Six boxes: head, torso, two arms, two legs. The legs and arms swing
//                in the vertex shader from a phase and a stride carried per instance, so a walk
//                cycle costs nothing on the CPU and everybody's is their own.
//     BILLBOARD  190 m to 950 m. One camera-facing quad, shaded to a person-shaped silhouette in
//                the fragment shader. Two triangles each.
//     DOT        beyond that, held to a minimum size on screen, so from orbit the townships and
//                the beaches read as the crowd they are.
//   No instance matrix is composed in JavaScript: the shader builds the rotation from a heading,
//   so a frame is a handful of float writes per person instead of a 4x4 multiply.
//
// CULTURAL NOTE
//   Nobody in this world is assigned Aboriginality, clan, cultural role or cultural dress, and
//   nothing here draws or generates Aboriginal design of any kind. data/lore.json prohibitions
//   no-aboriginal-characters-with-invented-culture and no-generated-aboriginal-art are absolute.
//   These are ordinary people in ordinary Queensland coastal clothes.
//
// Reads: world.residents, the visitor components, crowd, traffic, daylight, weather, camera.
// Draws nothing headless: every path returns early when there is no stage.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The pose list from src/systems/movement/crowd.js. Repeated, not imported: a render layer
    never imports a simulation system. If that list changes, this one changes with it. */
const POSE = { STAND: 0, WALK: 1, SIT: 2, WADE: 3, RIDE: 4, BOARD: 5, DOG: 6, WORK: 7, QUEUE: 8, DRIVE: 9 };

/** Level of detail thresholds in metres. */
const LOD_FIGURE = 190;
const LOD_BILLBOARD = 950;
const LOD_DOT = 6200;

/** Instance ceilings. Past these the furthest are dropped, which only ever happens from orbit. */
const CAP_FIGURE = 900;
const CAP_BILLBOARD = 2600;
const CAP_DOT = 5200;

/**
 * Clothing. Queensland coastal, and specifically a sand island in spring: a lot of faded cotton, a
 * lot of pale blue and white, board shorts, one high visibility yellow for anybody at work, and
 * nothing saturated. No pattern, no motif, no design of any kind: see the cultural note above.
 */
const SHIRTS = [
  [0.90, 0.90, 0.88], [0.80, 0.86, 0.90], [0.95, 0.93, 0.86], [0.62, 0.74, 0.80],
  [0.76, 0.84, 0.72], [0.94, 0.86, 0.70], [0.54, 0.66, 0.74], [0.88, 0.76, 0.64],
  [0.46, 0.56, 0.62], [0.96, 0.94, 0.92], [0.70, 0.80, 0.72], [0.84, 0.68, 0.58],
  [0.92, 0.82, 0.78], [0.66, 0.72, 0.84]
];
const HIVIS = [0.94, 0.82, 0.10];
const WETSUIT = [0.10, 0.12, 0.16];
/** Skin, from pale to deep. Nothing is read into this: it is a range of people. */
const SKIN = [
  [0.86, 0.71, 0.60], [0.78, 0.62, 0.50], [0.68, 0.52, 0.40], [0.52, 0.38, 0.28],
  [0.40, 0.28, 0.21], [0.30, 0.21, 0.16], [0.90, 0.76, 0.66], [0.60, 0.45, 0.34]
];

/* ------------------------------------------------------------------ the parts */

/**
 * One person, six boxes, pivot at the feet, one metre tall so the instance scale is their height.
 * The `limb` attribute tells the vertex shader which part it is looking at, so it can swing it:
 *   0 torso, 1 head, 2 left leg, 3 right leg, 4 left arm, 5 right arm.
 * Each limb is modelled about its own pivot in y so a rotation about that pivot is a hinge.
 */
function personMesh(scene, name) {
  const pos = [], nrm = [], limb = [], mat = [], idx = [];

  const box = (cx, cy, cz, w, h, d, limbId, matId, pivotY) => {
    const faces = [
      { o: [0, 0, -0.5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
      { o: [0, 0, 0.5], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
      { o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
      { o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
      { o: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
      { o: [0, -0.5, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] }
    ];
    // cx, cy, cz is the centre; w, h, d are the full sizes, so each axis is scaled independently.
    for (const f of faces) {
      const base = pos.length / 3;
      for (const [su, sv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(
          cx + f.o[0] * w + f.u[0] * su * w + f.v[0] * sv * w,
          cy + f.o[1] * h + f.u[1] * su * h + f.v[1] * sv * h,
          cz + f.o[2] * d + f.u[2] * su * d + f.v[2] * sv * d
        );
        nrm.push(f.n[0], f.n[1], f.n[2]);
        limb.push(limbId, pivotY, 0, 0);
        mat.push(matId);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  // Proportions of a person: legs to just under half, torso to the shoulders, a head on top.
  // matId 0 shorts, 1 shirt, 2 skin.
  box(0, 0.235, 0, 0.115, 0.47, 0.115, 2, 0, 0.47);       // left leg, hinged at the hip
  box(0, 0.235, 0, 0.115, 0.47, 0.115, 3, 0, 0.47);       // right leg (offset in the shader)
  box(0, 0.655, 0, 0.30, 0.36, 0.17, 0, 1, 0.0);          // torso
  box(0, 0.665, 0, 0.075, 0.34, 0.09, 4, 2, 0.835);       // left arm, hinged at the shoulder
  box(0, 0.665, 0, 0.075, 0.34, 0.09, 5, 2, 0.835);       // right arm
  box(0, 0.905, 0, 0.155, 0.185, 0.16, 1, 2, 0.0);        // head

  return {
    pos: new Float32Array(pos), nrm: new Float32Array(nrm),
    limb: new Float32Array(limb), mat: new Float32Array(mat),
    idx: new Uint16Array(idx)
  };
}

/** A unit quad in the XY plane, pivot at the bottom centre. Used for both billboard tiers. */
function quadMesh() {
  return {
    pos: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
    nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    idx: new Uint16Array([0, 1, 2, 0, 2, 3])
  };
}

/** A surfboard, a dog and a bag, as one part list picked between by an instance flag. */
function carryMesh() {
  const pos = [], nrm = [], idx = [], kind = [];
  const push = (verts, normal, k) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); nrm.push(normal[0], normal[1], normal[2]); kind.push(k); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // 0: a board carried under the arm. Built standing on its edge already, 1.9 m nose to tail and
  // 520 mm across, which is a mal rather than a shortboard and is what most people here carry.
  // Two faces, so it reads from either side.
  for (const s of [-1, 1]) {
    const t = s * 0.03;
    push([[t, -0.26, -0.86], [t, 0.26, -0.86], [t, 0.26, 0.62], [t, -0.26, 0.62]], [s, 0, 0], 0);
    push([[t, -0.26, 0.62], [t, 0.26, 0.62], [t, 0.02, 0.95], [t, -0.02, 0.95]], [s, 0, 0], 0);
    push([[t, -0.26, -0.86], [t, -0.02, -0.98], [t, 0.02, -0.98], [t, 0.26, -0.86]], [s, 0, 0], 0);
  }
  // 1: a dog, a low box at the end of a lead. Kept as a silhouette: it is 400 mm tall.
  push([[-0.12, 0, -0.25], [0.12, 0, -0.25], [0.12, 0.34, -0.25], [-0.12, 0.34, -0.25]], [0, 0, -1], 1);
  push([[-0.12, 0, 0.25], [0.12, 0, 0.25], [0.12, 0.34, 0.25], [-0.12, 0.34, 0.25]], [0, 0, 1], 1);
  // 2: a bag or an esky, held at the side.
  push([[-0.14, 0, -0.10], [0.14, 0, -0.10], [0.14, 0.26, -0.10], [-0.14, 0.26, -0.10]], [0, 0, -1], 2);
  push([[-0.14, 0, 0.10], [0.14, 0, 0.10], [0.14, 0.26, 0.10], [-0.14, 0.26, 0.10]], [0, 0, 1], 2);
  return {
    pos: new Float32Array(pos), nrm: new Float32Array(nrm),
    kind: new Float32Array(kind), idx: new Uint16Array(idx)
  };
}

/* ------------------------------------------------------------------ shaders

The lighting is the same model the buildings layer uses, so a person standing next to a house is
lit by the same sun, sits in the same haze and goes the same colour at dusk. */

const COMMON_LIGHT = `
uniform vec3 uCam;
uniform vec4 uSun;      // xyz direction, w daylight 0..1
uniform vec4 uSunCol;   // rgb, a strength
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;     // x fog density, y wetness, z unused, w sea level
vec3 litColour(vec3 base, vec3 N, vec3 P) {
  float ndl = max(dot(N, uSun.xyz), 0.0);
  ndl = ndl * 0.86 + pow(max(dot(N, uSun.xyz) * 0.5 + 0.5, 0.0), 2.0) * 0.14;
  vec3 sun = uSunCol.rgb * uSunCol.a * ndl;
  // The sky is a dark blue at the top and a pale band at the horizon, and a person is a vertical
  // thing: almost none of their surface points up. So they take their ambient mostly from the
  // horizon, which is what a standing figure actually sees.
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.22) * (0.46 + 0.24 * clamp(N.y, 0.0, 1.0));
  // Bounce off the sand, and it is the whole reason a person on this island is not a silhouette.
  // Minjerribah is a sand island: the beaches are near white silica and the tracks are pale, and
  // at ten in the morning they throw a great deal of warm light straight back up at everybody
  // standing on them. Shading people the way a building is shaded left every one of them a dark
  // blue mark on bright sand, which is exactly what they are not.
  float sideways = clamp(1.0 - abs(N.y), 0.0, 1.0);
  vec3 bounce = vec3(0.88, 0.82, 0.70) * uSunCol.rgb * uSunCol.a
    * (0.10 + 0.30 * sideways + 0.24 * clamp(-N.y, 0.0, 1.0));
  return base * (sun + sky + bounce);
}
vec3 hazed(vec3 col, vec3 P) {
  float dist = length(P - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = mix(uSkyHz.rgb, uSky.rgb, 0.3);
  return mix(col, hz, fog * 0.86);
}
`;

const FIGURE_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 limb;      // x limb id, y hinge pivot height
attribute float matId;    // 0 shorts, 1 shirt, 2 skin
attribute vec4 iPos;      // x, y, z, heading in radians
attribute vec4 iAnim;     // x walk phase, y stride 0..1, z pose, w height in metres
attribute vec4 iShirt;    // rgb shirt, a hat 0/1
attribute vec4 iSkin;     // rgb skin, a shorts tint scale
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;

void main(void) {
  float h = iAnim.w;
  vec3 p = position;
  vec3 n = normal;
  float id = limb.x;
  float pivot = limb.y;
  float phase = iAnim.x;
  float stride = iAnim.y;
  float pose = iAnim.z;

  // Legs and arms are hinges. A walk swings them in opposite pairs; standing still leaves them
  // where they are; sitting folds the legs forward and drops the torso.
  float swing = sin(phase) * stride;
  float ang = 0.0;
  float lift = 0.0;
  if (id > 1.5 && id < 3.5) {                    // legs
    float side = (id < 2.5) ? 1.0 : -1.0;
    p.x += side * 0.075;
    ang = swing * side * 0.62;
    if (pose > 1.5 && pose < 2.5) { ang = side * 0.02 - 1.15; }        // sitting
  } else if (id > 3.5) {                          // arms
    float side = (id < 4.5) ? 1.0 : -1.0;
    p.x += side * 0.185;
    ang = -swing * side * 0.44;
    if (pose > 4.5 && pose < 5.5 && side > 0.0) ang = -1.35;           // carrying a board
    if (pose > 6.5 && pose < 7.5) ang = -0.30 - swing * side * 0.2;    // at work, hands busy
  } else if (id < 0.5) {                          // torso
    lift = -abs(swing) * 0.012;
    if (pose > 1.5 && pose < 2.5) lift -= 0.30;
  } else {                                        // head
    lift = -abs(swing) * 0.012;
    if (pose > 1.5 && pose < 2.5) lift -= 0.30;
  }
  if (ang != 0.0) {
    float c = cos(ang), s = sin(ang);
    float dy = p.y - pivot;
    p.y = pivot + dy * c - p.z * s;
    p.z = dy * s + p.z * c;
    float ny = n.y;
    n.y = ny * c - n.z * s;
    n.z = ny * s + n.z * c;
  }
  p.y += lift;
  // Wading: the lower half is under the water, so it is simply not drawn above it.
  if (pose > 2.5 && pose < 3.5) p.y = max(p.y, 0.42);

  p *= h;
  // Heading. One rotation about y, built here rather than as a matrix on the CPU.
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) + iPos.xyz;
  vec3 wn = vec3(n.x * ch + n.z * sh, n.y, -n.x * sh + n.z * ch);

  // Legs are shorts down to about the knee and skin below it, which is what everybody on this
  // island is wearing between about September and May.
  vec3 shorts = mix(vec3(0.28, 0.32, 0.38), vec3(0.52, 0.50, 0.44), iSkin.a);
  vCol = matId < 0.5 ? (position.y > 0.30 ? shorts : iSkin.rgb)
       : (matId < 1.5 ? iShirt.rgb : iSkin.rgb);
  // A hat is the top of the head going the colour of a hat.
  if (matId > 1.5 && position.y > 0.95 && iShirt.a > 0.5) vCol = vec3(0.86, 0.82, 0.70);
  vPos = wp;
  vNrm = normalize(wn);
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const FIGURE_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
${COMMON_LIGHT}
void main(void) {
  vec3 col = litColour(vCol, normalize(vNrm), vPos);
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

/**
 * The billboard tier. A camera-facing quad shaded into a person: head, shoulders, a taper to the
 * feet, and a pair of legs with a gap between them that opens and closes with the walk phase. At
 * two hundred metres that is every bit of shape the eye can resolve, and it is two triangles.
 */
const CARD_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 iPos;
attribute vec4 iAnim;
attribute vec4 iShirt;
attribute vec4 iSkin;
uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uPix;      // x metres per pixel at one metre, y minimum size in pixels
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vNrm;
varying float vPhase;
varying float vPose;
void main(void) {
  float h = iAnim.w;
  vec3 c = iPos.xyz;
  vec3 toCam = uCam - c;
  float d = length(toCam);
  vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
  // Never smaller than a pixel and a half: a person a kilometre away is a mark, not nothing.
  float minM = uPix.x * d * uPix.y;
  float s = max(h, minM);
  vec3 wp = c + right * (position.x * s * 0.44) + vec3(0.0, position.y * s, 0.0);
  vUv = uv;
  vPos = wp;
  vShirt = iShirt.rgb;
  vSkin = iSkin.rgb;
  // A person is a cylinder, not a card. Shading a card against a fixed normal made every
  // billboard the same value and turned a beach two hundred metres away into a row of dark marks.
  // This is the normal of the cylinder the card stands in for: out toward the viewer, and a
  // little up, so a crowd catches the sun the way the figures beside it do.
  vNrm = normalize(normalize(vec3(toCam.x, 0.0, toCam.z)) + vec3(0.0, 0.55, 0.0));
  vPhase = iAnim.x;
  vPose = iAnim.z;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const CARD_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vNrm;
varying float vPhase;
varying float vPose;
${COMMON_LIGHT}
void main(void) {
  float x = vUv.x - 0.5;
  float y = vUv.y;
  float a = 0.0;
  vec3 base = vShirt;
  // head
  float hd = length(vec2(x * 1.5, (y - 0.925) * 1.1));
  if (hd < 0.075) { a = 1.0; base = vSkin; }
  // shoulders and torso, tapering
  float halfW = 0.155 - 0.035 * max(0.0, y - 0.5);
  if (y > 0.44 && y < 0.855 && abs(x) < halfW) { a = 1.0; base = vShirt; }
  // legs, with the gap opening and closing on the walk
  float spread = 0.055 + 0.075 * abs(sin(vPhase)) * step(0.5, vPose) * step(vPose, 1.5);
  if (y < 0.47) {
    float lx = abs(x) - spread * (1.0 - y / 0.47) * 0.9;
    if (abs(x) > 0.022 && abs(lx) < 0.055) { a = 1.0; base = vSkin * 0.45 + vec3(0.12, 0.14, 0.18); }
    if (y > 0.30 && abs(x) < 0.13) { a = 1.0; base = vSkin * 0.34 + vec3(0.14, 0.16, 0.20); }
  }
  if (a < 0.5) discard;
  // Curve the normal round the cylinder so a shoulder catches the light and a flank does not.
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), vNrm));
  vec3 N = normalize(vNrm + side * (x * 2.4));
  vec3 col = litColour(base, N, vPos);
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

/** The dot tier: a screen-sized mark, held above a pixel, so a crowd reads from the air. */
const DOT_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 iPos;
attribute vec4 iShirt;
uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uPix;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vPos;
void main(void) {
  vec3 c = iPos.xyz + vec3(0.0, 0.9, 0.0);
  vec3 toCam = uCam - c;
  float d = length(toCam);
  vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x));
  vec3 up = normalize(cross(toCam, right));
  float s = max(1.4, uPix.x * d * uPix.z);
  vec3 wp = c + right * (position.x * s) + up * ((position.y - 0.5) * s);
  vUv = uv;
  vCol = iShirt.rgb;
  vPos = wp;
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const DOT_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vPos;
${COMMON_LIGHT}
void main(void) {
  vec2 d = vUv - 0.5;
  if (dot(d, d) > 0.25) discard;
  vec3 col = litColour(vCol, vec3(0.0, 1.0, 0.0), vPos) * 1.25 + vCol * 0.10;
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

const CARRY_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float kind;
attribute vec4 iPos;
attribute vec4 iAnim;    // x phase, y stride, z which item, w height
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
void main(void) {
  if (abs(kind - iAnim.z) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vPos = vec3(0.0); vNrm = vec3(0.0, 1.0, 0.0); return; }
  vec3 p = position;
  float h = iAnim.w;
  if (kind < 0.5) {
    // Under the arm, on its edge, nose forward, at about hip height and tucked to one side.
    p = vec3(p.x + 0.36, p.y + 0.90, p.z + 0.10) * h;
  } else if (kind < 1.5) {
    // A dog, out in front on a lead, trotting a bit ahead.
    p = vec3(p.x, p.y, p.z) * h + vec3(0.35 * h, 0.0, (1.05 + 0.12 * sin(iAnim.x * 2.0)) * h);
  } else {
    p = vec3(p.x, p.y, p.z) * h + vec3(0.28 * h, 0.46 * h, 0.0);
  }
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 wp = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch) + iPos.xyz;
  vec3 wn = vec3(normal.x * ch + normal.z * sh, normal.y, -normal.x * sh + normal.z * ch);
  vCol = kind < 0.5 ? vec3(0.90, 0.90, 0.88) : (kind < 1.5 ? vec3(0.42, 0.34, 0.26) : vec3(0.30, 0.34, 0.38));
  vPos = wp;
  vNrm = normalize(wn);
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const CARRY_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
${COMMON_LIGHT}
void main(void) {
  vec3 col = litColour(vCol, normalize(vNrm), vPos);
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

/* ================================================================== the layer */

export function registerPeople(world) {
  const state = world.publish('people', {
    rendered: false,
    drawn: 0,
    figures: 0,
    billboards: 0,
    dots: 0,
    carried: 0,
    residentsDrawn: 0,
    visitorsDrawn: 0,
    drawCalls: 0,
    culled: 0,
    buildMs: 0,
    notes: []
  });

  world.register({
    id: 'people',
    phase: 'presentation',
    order: 40,
    describe() {
      return {
        rendered: state.rendered,
        drawn: state.drawn,
        figures: state.figures,
        billboards: state.billboards,
        dots: state.dots,
        residents: state.residentsDrawn,
        visitors: state.visitorsDrawn,
        drawCalls: state.drawCalls,
        culled: state.culled
      };
    }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;

  /* ---------------------------------------------------------------- instance buffers */

  const F = {
    pos: new Float32Array(CAP_FIGURE * 4),
    anim: new Float32Array(CAP_FIGURE * 4),
    shirt: new Float32Array(CAP_FIGURE * 4),
    skin: new Float32Array(CAP_FIGURE * 4),
    mat: new Float32Array(CAP_FIGURE * 16),
    n: 0
  };
  const C = {
    pos: new Float32Array(CAP_BILLBOARD * 4),
    anim: new Float32Array(CAP_BILLBOARD * 4),
    shirt: new Float32Array(CAP_BILLBOARD * 4),
    skin: new Float32Array(CAP_BILLBOARD * 4),
    mat: new Float32Array(CAP_BILLBOARD * 16),
    n: 0
  };
  const D = {
    pos: new Float32Array(CAP_DOT * 4),
    shirt: new Float32Array(CAP_DOT * 4),
    mat: new Float32Array(CAP_DOT * 16),
    n: 0
  };
  const K = {
    pos: new Float32Array(400 * 4),
    anim: new Float32Array(400 * 4),
    mat: new Float32Array(400 * 16),
    n: 0
  };

  /* Thin instances need a matrix buffer to know how many there are, even when the shader builds
     the transform itself from a position and a heading. So every matrix here is the identity, is
     written once at build, and never touched again: the per-frame cost is the four small buffers
     above and nothing else. */
  function fillIdentity(m, cap) {
    for (let i = 0; i < cap; i++) {
      const o = i * 16;
      m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1;
    }
  }
  fillIdentity(F.mat, CAP_FIGURE);
  fillIdentity(C.mat, CAP_BILLBOARD);
  fillIdentity(D.mat, CAP_DOT);
  fillIdentity(K.mat, 400);

  const meshes = {};
  const mats = {};
  let ready = false;

  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.3, 0.5, 0.8, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.8, 0.4);
  const vTune = new B.Vector4(1e-5, 0, 0, 0);
  const vPix = new B.Vector4(0.001, 2.2, 3.0, 0);
  const camPos = new B.Vector3();

  function shader(name, vert, frag, attrs) {
    const m = new B.ShaderMaterial(name, stage.scene,
      { vertexSource: vert, fragmentSource: frag },
      {
        attributes: ['position', 'normal', 'uv', 'world0', 'world1', 'world2', 'world3'].concat(attrs),
        uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uPix']
      });
    m.backFaceCulling = true;
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

  /* ---------------------------------------------------------------- appearance

  Worked out once per person from their own id, so the same person is the same person every frame
  and on every run of the same seed. Nothing about a person's appearance reads anything cultural. */

  const look = new Map();
  function lookOf(id, age, sex, occ) {
    let l = look.get(id);
    if (l) return l;
    const h = hash32(id, 17);
    const shirt = SHIRTS[h % SHIRTS.length];
    const skin = SKIN[(h >>> 5) % SKIN.length];
    const shortsTint = ((h >>> 9) % 6) / 6;
    // Height: children are shorter, and it is the one thing that makes a family read as a family
    // from fifty metres away.
    const adult = 1.62 + ((h >>> 13) % 100) / 100 * 0.24;
    const height = age < 3 ? 0.86 : age < 12 ? 0.92 + (age - 3) * 0.058 : age < 17 ? 1.44 + (age - 12) * 0.036 : adult;
    const hat = ((h >>> 21) % 100) < 34 ? 1 : 0;
    l = { shirt, skin, shortsTint, height, hat, phase: ((h >>> 3) % 628) / 100 };
    look.set(id, l);
    return l;
  }

  /* ---------------------------------------------------------------- writing one person */

  let walkClock = 0;

  function put(x, y, z, headingRad, pose, gait, l, dist, hiVis) {
    // The walk cycle: two steps a second at 1.36 m/s, scaled with how fast they are actually going.
    const stride = gait > 0.05 ? clamp(gait / 1.5, 0.25, 1.5) : 0;
    const phase = l.phase + walkClock * (gait > 0.05 ? 3.2 * clamp(gait / 1.36, 0.5, 2.2) : 0);

    if (dist < LOD_FIGURE && F.n < CAP_FIGURE) {
      const i = F.n++;
      const o = i * 4;
      F.pos[o] = x; F.pos[o + 1] = y; F.pos[o + 2] = z; F.pos[o + 3] = headingRad;
      F.anim[o] = phase; F.anim[o + 1] = stride; F.anim[o + 2] = pose; F.anim[o + 3] = l.height;
      const s = hiVis ? HIVIS : (pose === POSE.BOARD || pose === POSE.WADE ? WETSUIT : l.shirt);
      F.shirt[o] = s[0]; F.shirt[o + 1] = s[1]; F.shirt[o + 2] = s[2]; F.shirt[o + 3] = l.hat;
      F.skin[o] = l.skin[0]; F.skin[o + 1] = l.skin[1]; F.skin[o + 2] = l.skin[2]; F.skin[o + 3] = l.shortsTint;
      // What they are carrying, if anything.
      const item = pose === POSE.BOARD ? 0 : pose === POSE.DOG ? 1 : pose === POSE.WORK ? 2 : -1;
      if (item >= 0 && K.n < 400) {
        const j = K.n++;
        const q = j * 4;
        K.pos[q] = x; K.pos[q + 1] = y; K.pos[q + 2] = z; K.pos[q + 3] = headingRad;
        K.anim[q] = phase; K.anim[q + 1] = stride; K.anim[q + 2] = item; K.anim[q + 3] = l.height;
      }
      return 0;
    }
    if (dist < LOD_BILLBOARD && C.n < CAP_BILLBOARD) {
      const i = C.n++;
      const o = i * 4;
      C.pos[o] = x; C.pos[o + 1] = y; C.pos[o + 2] = z; C.pos[o + 3] = headingRad;
      C.anim[o] = phase; C.anim[o + 1] = stride; C.anim[o + 2] = pose; C.anim[o + 3] = l.height;
      const s = hiVis ? HIVIS : (pose === POSE.BOARD || pose === POSE.WADE ? WETSUIT : l.shirt);
      C.shirt[o] = s[0]; C.shirt[o + 1] = s[1]; C.shirt[o + 2] = s[2]; C.shirt[o + 3] = l.hat;
      C.skin[o] = l.skin[0]; C.skin[o + 1] = l.skin[1]; C.skin[o + 2] = l.skin[2]; C.skin[o + 3] = l.shortsTint;
      return 1;
    }
    if (dist < LOD_DOT && D.n < CAP_DOT) {
      const i = D.n++;
      const o = i * 4;
      D.pos[o] = x; D.pos[o + 1] = y; D.pos[o + 2] = z; D.pos[o + 3] = headingRad;
      const s = hiVis ? HIVIS : l.shirt;
      D.shirt[o] = s[0]; D.shirt[o + 1] = s[1]; D.shirt[o + 2] = s[2]; D.shirt[o + 3] = 1;
      return 2;
    }
    return 3;
  }

  const DEG = Math.PI / 180;

  /* ---------------------------------------------------------------- the layer */

  stage.addLayer({
    id: 'people',
    order: 28,

    init(st) {
      const t0 = performance.now();
      const scene = st.scene;

      mats.figure = shader('peopleFigure', FIGURE_VERT, FIGURE_FRAG, ['limb', 'matId', 'iPos', 'iAnim', 'iShirt', 'iSkin']);
      mats.card = shader('peopleCard', CARD_VERT, CARD_FRAG, ['iPos', 'iAnim', 'iShirt', 'iSkin']);
      mats.card.backFaceCulling = false;
      mats.dot = shader('peopleDot', DOT_VERT, DOT_FRAG, ['iPos', 'iShirt']);
      mats.dot.backFaceCulling = false;
      mats.carry = shader('peopleCarry', CARRY_VERT, CARRY_FRAG, ['kind', 'iPos', 'iAnim']);
      mats.carry.backFaceCulling = false;

      const pm = personMesh(scene, 'p-person');
      meshes.figure = realise('people-figure', pm, mats.figure, [['limb', pm.limb, 4], ['matId', pm.mat, 1]]);
      const qm = quadMesh();
      meshes.card = realise('people-card', qm, mats.card, []);
      meshes.dot = realise('people-dot', qm, mats.dot, []);
      const cm = carryMesh();
      meshes.carry = realise('people-carry', cm, mats.carry, [['kind', cm.kind, 1]]);

      meshes.figure.thinInstanceSetBuffer('matrix', F.mat, 16, true);
      meshes.figure.thinInstanceSetBuffer('iPos', F.pos, 4, false);
      meshes.figure.thinInstanceSetBuffer('iAnim', F.anim, 4, false);
      meshes.figure.thinInstanceSetBuffer('iShirt', F.shirt, 4, false);
      meshes.figure.thinInstanceSetBuffer('iSkin', F.skin, 4, false);

      meshes.card.thinInstanceSetBuffer('matrix', C.mat, 16, true);
      meshes.card.thinInstanceSetBuffer('iPos', C.pos, 4, false);
      meshes.card.thinInstanceSetBuffer('iAnim', C.anim, 4, false);
      meshes.card.thinInstanceSetBuffer('iShirt', C.shirt, 4, false);
      meshes.card.thinInstanceSetBuffer('iSkin', C.skin, 4, false);

      meshes.dot.thinInstanceSetBuffer('matrix', D.mat, 16, true);
      meshes.dot.thinInstanceSetBuffer('iPos', D.pos, 4, false);
      meshes.dot.thinInstanceSetBuffer('iShirt', D.shirt, 4, false);

      meshes.carry.thinInstanceSetBuffer('matrix', K.mat, 16, true);
      meshes.carry.thinInstanceSetBuffer('iPos', K.pos, 4, false);
      meshes.carry.thinInstanceSetBuffer('iAnim', K.anim, 4, false);

      for (const m of Object.values(meshes)) {
        m.thinInstanceCount = 0;
        m.alphaIndex = 4;
      }
      ready = true;
      state.rendered = true;
      state.drawCalls = 4;
      state.buildMs = +(performance.now() - t0).toFixed(1);
      console.info(`[people] four draw calls: figure, billboard, dot and what they carry, built in ${state.buildMs} ms`);
    },

    frame(st, w, dt) {
      if (!ready) return;
      const R = w.residents;
      if (!R || !R.ready) return;
      const cam = st.scene.activeCamera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      walkClock += dt;

      /* --- lighting, matched to the buildings layer so a person and a house agree --- */
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
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), wx ? clamp(wx.rainMmHr / 5, 0, 1) : 0, 0, island ? island.seaLevel : 0);
      const px = (2 * Math.tan((cam.fov || 0.8) * 0.5)) / Math.max(1, st.engine.getRenderHeight());
      vPix.set(px, 2.4, 3.4, 0);

      F.n = 0; C.n = 0; D.n = 0; K.n = 0;
      let culled = 0;
      let residents = 0, visitors = 0;

      /* --- residents ------------------------------------------------------------- */
      const people = R.people;
      const cx = camPos.x, cz = camPos.z;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p.outdoors) continue;
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > LOD_DOT) { culled++; continue; }
        const l = lookOf(p.id, p.age);
        const y = island ? island.height(p.x, p.z) : 0;
        const tier = put(p.x, y, p.z, p.facing * DEG, p.pose, p.gait, l, d, p.pose === POSE.WORK);
        if (tier < 3) residents++; else culled++;
      }

      /* --- visitors. One party is a family, so it is drawn as one, spread around its point --- */
      for (const [id, c] of w.store.all('visitor')) {
        if (!c.outdoors || !Number.isFinite(c.x)) continue;
        const dx = c.x - cx, dz = c.z - cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > LOD_DOT) { culled++; continue; }
        // A party of four draws four. A school group of sixty draws thirty, which is as many as
        // reads as a group before it is just a texture, and the count is on show in the read model.
        const n = Math.min(c.size || 1, 30);
        const spread = c.spread || 2.2;
        const face = (c.facing || 0) * DEG;
        for (let k = 0; k < n; k++) {
          const h = hash32(id, k * 31 + 7);
          const a = (h % 1000) / 1000 * Math.PI * 2;
          const rr = Math.sqrt(((h >>> 10) % 1000) / 1000) * spread;
          const x = c.x + Math.cos(a) * rr;
          const z = c.z + Math.sin(a) * rr;
          // A visiting party is a mix of ages: two adults and a couple of kids is the median
          // holiday house on this island in the September holidays.
          const age = k < 2 ? 38 : 7 + (h >>> 20) % 10;
          const l = lookOf(hash32(id, k), age);
          const y = island ? island.height(x, z) : 0;
          const tier = put(x, y, z, face + ((h >>> 4) % 100) / 100 - 0.5, c.pose || POSE.STAND, 0, l, d, false);
          if (tier < 3) visitors++; else culled++;
        }
      }

      /* --- upload. Only the tiers that have anything in them, and only what they hold --- */
      const mF = meshes.figure, mC = meshes.card, mD = meshes.dot, mK = meshes.carry;
      mF.thinInstanceCount = F.n;
      mC.thinInstanceCount = C.n;
      mD.thinInstanceCount = D.n;
      mK.thinInstanceCount = K.n;
      if (F.n) {
        mF.thinInstanceBufferUpdated('iPos');
        mF.thinInstanceBufferUpdated('iAnim');
        mF.thinInstanceBufferUpdated('iShirt');
        mF.thinInstanceBufferUpdated('iSkin');
      }
      if (C.n) {
        mC.thinInstanceBufferUpdated('iPos');
        mC.thinInstanceBufferUpdated('iAnim');
        mC.thinInstanceBufferUpdated('iShirt');
        mC.thinInstanceBufferUpdated('iSkin');
      }
      if (D.n) {
        mD.thinInstanceBufferUpdated('iPos');
        mD.thinInstanceBufferUpdated('iShirt');
      }
      if (K.n) {
        mK.thinInstanceBufferUpdated('iPos');
        mK.thinInstanceBufferUpdated('iAnim');
      }

      for (const m of [mF, mC, mD, mK]) {
        const on = m.thinInstanceCount > 0;
        if (m.isEnabled(false) !== on) m.setEnabled(on);
      }

      const setAll = (mat) => {
        mat.setVector3('uCam', camPos);
        mat.setVector4('uSun', vSun);
        mat.setVector4('uSunCol', vSunCol);
        mat.setVector4('uSky', vSky);
        mat.setVector4('uSkyHz', vSkyHz);
        mat.setVector4('uTune', vTune);
        mat.setVector4('uPix', vPix);
      };
      setAll(mats.figure); setAll(mats.card); setAll(mats.dot); setAll(mats.carry);

      state.figures = F.n;
      state.billboards = C.n;
      state.dots = D.n;
      state.carried = K.n;
      state.drawn = F.n + C.n + D.n;
      state.residentsDrawn = residents;
      state.visitorsDrawn = visitors;
      state.culled = culled;
      state.drawCalls = (F.n ? 1 : 0) + (C.n ? 1 : 0) + (D.n ? 1 : 0) + (K.n ? 1 : 0);
    },

    dispose() {
      for (const m of Object.values(meshes)) { try { m.dispose(); } catch (e) { /* gone */ } }
      for (const m of Object.values(mats)) { try { m.dispose(); } catch (e) { /* gone */ } }
      ready = false;
    }
  });
}
