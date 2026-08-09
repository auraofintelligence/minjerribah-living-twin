// Fauna. The animals the ecology systems already track, put on the screen.
//
// Nothing here decides anything. Every animal drawn in this file is standing where a simulation
// system put it, doing what that system says it is doing. The whales come from
// `world.read('whales').pods`, which are pods on corridors measured off the island's own east
// coast. The koalas are entities in `world.store`, each one an animal with a home range, a
// condition and a chlamydia status. The shorebirds are `world.read('shorebirds').roosts`, and
// when one of those roosts goes up it is because the shorebird system decided a dog got off a
// lead. The renderer's job is to make that legible from a headland, and to make it worth standing
// still and looking at.
//
// What is on the water, and why it is the centre of the file:
//
//   HUMPBACKS. Deep water comes unusually close to the Point Lookout headland, which is the whole
//   reason the east Australian migration can be watched for free from land here. The southbound
//   leg, roughly September to November and peaking about October, is cows with calves and it runs
//   close inshore. So a pod on the Gorge walk in October is not a dot: it is a fourteen metre
//   animal with a four metre calf on her flank, blowing every twenty seconds, and now and then a
//   competitive group turning itself inside out. This layer draws the blow first and the body
//   second, because that is the order you see them in. A blow carries to twelve kilometres on a
//   calm clear day and the body does not carry past about six, so the whale you see at range is a
//   white bush of vapour hanging over the water, exactly as it is from the walk.
//
//   THE COST OF A BOAT. `pod.pushedOffshore` is the whales system saying a vessel came inside the
//   approach distance. Those pods stop surfacing and move out. Nothing is announced. The headland
//   just gets quieter, which is the trade the whole mechanic is about.
//
//   THE LIFT. A shorebird roost that gets flushed goes up as one sheet, wheels, and comes back
//   down over half a minute. The energy that costs is invisible in every other medium, and a bar
//   chart of fuel loss is not the same thing as watching five hundred birds leave the sand.
//
//   KOALAS ON THE GROUND. A koala up a tree is safe and boring. A koala on the ground is how they
//   die here, and vehicle strike is the largest recorded cause on this island. The animals on the
//   ground are the ones the sim says are on the ground, and the ones near the sealed road are
//   counted and published.
//
// Everything that is not an individual in a simulation system is placed by habitat from
// data/ecology.json and labelled as modelled in the read model. The pack has no island count for
// kangaroos, wallabies, goannas or the raptors, and this file does not invent one: it places them
// on the land cover the pack lists as their habitat, at a density it publishes as a modelling
// choice, driven by the pack's own monthly activity curve.
//
// How it draws:
//   * One mesh per species, thin instances, one shared shader family with three deformation
//     models: swimmers, walkers and fliers. Fifteen species is fifteen draw calls, plus four for
//     the vapour, the whitewater, the wakes and the sea surface marks.
//   * Animation is in the vertex shader off four floats an instance, so a flock of five hundred
//     birds flapping costs the same upload as five hundred birds standing still.
//   * Submerged animals are drawn over the water rather than under it, because the ocean layer's
//     water is opaque below about six centimetres of depth. They fade with depth and with the
//     marine system's own turbidity figure, so a flood plume out of the mainland catchment takes
//     the dugong away from you as well as from the seagrass.
//   * Land occlusion for those through-water animals is tested against the heightfield on a
//     rolling budget, so a dugong on the western banks is not visible through the island from the
//     Gorge.
//
// Determinism: one integer is drawn from world.rng.stream('fauna') at registration. Everything
// after that is a pure hash of that integer and an index, so the same island holds the same
// kangaroos on the same verges at any frame rate. Render-side animation state is never read by
// any simulation system and never enters a save.

import { MEAN_SEA_LEVEL } from '../../world/island.js';

const B = typeof window !== 'undefined' ? window.BABYLON : null;

/* ------------------------------------------------------------------ small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const TAU = Math.PI * 2;

/** Deterministic 32 bit hash. Two integers in, a float in [0,1) out. No shared state. */
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

/* ------------------------------------------------------------------ geometry toolkit

Bodies are built at a reference length of one, nose at z = +0.5, tail at z = -0.5, up is +y.
The instance matrix scales to metres, so every constant in the vertex shader is in body lengths
and a dolphin and a humpback swim with the same code.

`part` is carried in the vertex colour alpha as part/8, and the vertex shader decodes it:
  0 body   1 left appendage   2 right appendage   3 tail or flukes   4 head
  5 forelimb   6 hindlimb   7 dorsal fin   8 spanwise membrane (ray wings) */

const PART = { BODY: 0, LEFT: 1, RIGHT: 2, TAIL: 3, HEAD: 4, FORE: 5, HIND: 6, DORSAL: 7, WING: 8 };

function newGeo() { return { p: [], n: [], u: [], c: [], i: [] }; }

function pushVert(g, x, y, z, nx, ny, nz, u, v, col, part) {
  g.p.push(x, y, z);
  g.n.push(nx, ny, nz);
  g.u.push(u, v);
  g.c.push(col[0], col[1], col[2], part / 8);
}

/**
 * Loft a body from a radius profile. `prof` entries are [t, rVertical, yOffset, widthMul].
 * `seg` radial segments. Returns nothing; appends into g.
 */
function loft(g, prof, seg, col, colBelly, part) {
  const base = g.p.length / 3;
  const rows = prof.length;
  for (let i = 0; i < rows; i++) {
    const [t, r, yo, wm] = prof[i];
    const z = 0.5 - t;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = sa * r * wm;
      const y = ca * r + yo;
      // Normal from the local ellipse, tilted by the profile slope so the nose is not flat shaded.
      const i0 = Math.max(0, i - 1), i1 = Math.min(rows - 1, i + 1);
      const dr = (prof[i1][1] * prof[i1][3] - prof[i0][1] * prof[i0][3]) / Math.max(1e-4, prof[i1][0] - prof[i0][0]);
      let nx = sa / Math.max(0.02, wm), ny = ca, nz = dr * 0.5;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      // Countershading: pale below, dark above, which is what every one of these animals is.
      const belly = clamp(-ca * 0.5 + 0.5, 0, 1);
      const cc = [
        lerp(col[0], colBelly[0], belly * belly),
        lerp(col[1], colBelly[1], belly * belly),
        lerp(col[2], colBelly[2], belly * belly)
      ];
      pushVert(g, x, y, z, nx, ny, nz, t, s / seg, cc, part);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const a = base + i * (seg + 1) + s;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      g.i.push(a, c, b, b, c, d);
    }
  }
}

/** A tapered flat blade: fins, flukes, wings, ears, legs, tails. Two sided, slight thickness. */
function blade(g, rx, ry, rz, tx, ty, tz, wRoot, wTip, ux, uy, uz, col, colTip, part, curve) {
  const base = g.p.length / 3;
  const STEPS = 4;
  // Span direction and the blade's own width axis.
  let dx = tx - rx, dy = ty - ry, dz = tz - rz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  // Width axis: the supplied up crossed with the span.
  let wx = uy * dz - uz * dy, wy = uz * dx - ux * dz, wz = ux * dy - uy * dx;
  const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
  wx /= wl; wy /= wl; wz /= wl;
  const nx = dy * wz - dz * wy, ny = dz * wx - dx * wz, nz = dx * wy - dy * wx;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const w = lerp(wRoot, wTip, t * t * 0.6 + t * 0.4) * 0.5;
    // A trailing sweep, so a pectoral is a scythe rather than a plank.
    const sw = (curve || 0) * t * t * dl;
    const cx = rx + dx * dl * t + nx * 0 + wx * sw;
    const cy = ry + dy * dl * t + wy * sw;
    const cz = rz + dz * dl * t + wz * sw;
    const cc = [lerp(col[0], colTip[0], t), lerp(col[1], colTip[1], t), lerp(col[2], colTip[2], t)];
    pushVert(g, cx - wx * w, cy - wy * w, cz - wz * w, nx, ny, nz, t, 0, cc, part);
    pushVert(g, cx + wx * w, cy + wy * w, cz + wz * w, nx, ny, nz, t, 1, cc, part);
  }
  for (let i = 0; i < STEPS; i++) {
    const a = base + i * 2;
    g.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    g.i.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);   // back faces, so a fin is solid from below
  }
}

/** An ellipsoid. The workhorse for a koala, a head, a rump, a shell. */
function ellipsoid(g, cx, cy, cz, rx, ry, rz, seg, ring, col, colLow, part, squash) {
  const base = g.p.length / 3;
  for (let j = 0; j <= ring; j++) {
    const v = (j / ring) * Math.PI;
    const sv = Math.sin(v), cv = Math.cos(v);
    for (let s = 0; s <= seg; s++) {
      const u = (s / seg) * TAU;
      const su = Math.sin(u), cu = Math.cos(u);
      const x = su * sv, y = cv, z = cu * sv;
      const yy = squash ? y * (0.6 + 0.4 * (1 - Math.abs(z))) : y;
      const belly = clamp(-yy * 0.5 + 0.5, 0, 1);
      const cc = [
        lerp(col[0], colLow[0], belly * belly),
        lerp(col[1], colLow[1], belly * belly),
        lerp(col[2], colLow[2], belly * belly)
      ];
      pushVert(g, cx + x * rx, cy + yy * ry, cz + z * rz, x, yy, z, s / seg, j / ring, cc, part);
    }
  }
  for (let j = 0; j < ring; j++) {
    for (let s = 0; s < seg; s++) {
      const a = base + j * (seg + 1) + s;
      g.i.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  }
}

function geoToMesh(scene, name, g) {
  const mesh = new B.Mesh(name, scene);
  const vd = new B.VertexData();
  vd.positions = new Float32Array(g.p);
  vd.normals = new Float32Array(g.n);
  vd.uvs = new Float32Array(g.u);
  vd.colors = new Float32Array(g.c);
  vd.indices = new Uint32Array(g.i);
  vd.applyToMesh(mesh, false);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

/* ------------------------------------------------------------------ the animals

Every species below is in data/ecology.json species[]. Lengths are the published adult sizes for
the species, not island measurements. Colours are linear reflectances kept in the same family as
the terrain and flora palettes so an animal does not float off the ground or the water it is on. */

const C = {
  whaleBack: [0.052, 0.055, 0.062], whaleBelly: [0.62, 0.63, 0.60],
  whaleFin: [0.86, 0.88, 0.86],
  dolphinBack: [0.115, 0.135, 0.155], dolphinBelly: [0.66, 0.66, 0.63],
  dugongBack: [0.175, 0.170, 0.148], dugongBelly: [0.40, 0.39, 0.35],
  turtleShell: [0.115, 0.135, 0.085], turtlePlast: [0.52, 0.50, 0.34],
  mantaBack: [0.045, 0.048, 0.058], mantaBelly: [0.80, 0.81, 0.80],
  sharkBack: [0.205, 0.200, 0.185], sharkBelly: [0.52, 0.51, 0.47],
  fish: [0.14, 0.16, 0.16], fishBelly: [0.55, 0.56, 0.54],
  koalaFur: [0.325, 0.330, 0.335], koalaBelly: [0.60, 0.59, 0.56],
  kangaroo: [0.300, 0.265, 0.215], kangarooBelly: [0.52, 0.47, 0.40],
  wallaby: [0.175, 0.150, 0.125], wallabyBelly: [0.36, 0.29, 0.22],
  goanna: [0.150, 0.145, 0.120], goannaBand: [0.52, 0.50, 0.40],
  waderBack: [0.290, 0.260, 0.215], waderBelly: [0.72, 0.71, 0.66],
  waderDark: [0.115, 0.110, 0.100],
  eagleBack: [0.230, 0.235, 0.240], eagleBelly: [0.86, 0.87, 0.88],
  ospreyBack: [0.190, 0.175, 0.155], ospreyBelly: [0.82, 0.82, 0.80]
};

const FAM = { SWIM: 0, WALK: 1, FLY: 2 };

/* ------------------------------------------------------------------ body builders */

function buildHumpback() {
  const g = newGeo();
  // Robust body, a broad knobbly head, a laterally compressed peduncle, and pectorals about a
  // third of the body length. The long-winged whale: the pectorals are the identifying feature.
  loft(g, [
    [0.00, 0.006, 0.000, 1.00], [0.05, 0.048, -0.006, 1.30], [0.12, 0.078, -0.008, 1.36],
    [0.20, 0.098, -0.002, 1.20], [0.30, 0.110, 0.000, 1.02], [0.42, 0.112, 0.000, 0.94],
    [0.55, 0.100, 0.002, 0.90], [0.66, 0.078, 0.004, 0.84], [0.78, 0.052, 0.008, 0.72],
    [0.88, 0.030, 0.010, 0.52], [0.96, 0.014, 0.011, 0.40], [1.00, 0.006, 0.011, 0.30]
  ], 12, C.whaleBack, C.whaleBelly, PART.BODY);
  // Pectorals. Root just behind the head, swept back, white on the leading edge and underside.
  blade(g, 0.100, -0.020, 0.290, 0.055, -0.115, -0.010, 0.075, 0.030, 0, 1, 0, C.whaleBack, C.whaleFin, PART.LEFT, 0.30);
  blade(g, -0.100, -0.020, 0.290, -0.055, -0.115, -0.010, 0.075, 0.030, 0, 1, 0, C.whaleBack, C.whaleFin, PART.RIGHT, -0.30);
  // Flukes, broad with a centre notch, white underneath. The fluke-up dive is the picture.
  blade(g, 0.000, 0.011, -0.480, 0.155, 0.011, -0.545, 0.060, 0.105, 0, 1, 0, C.whaleBack, C.whaleFin, PART.TAIL, 0.16);
  blade(g, 0.000, 0.011, -0.480, -0.155, 0.011, -0.545, 0.060, 0.105, 0, 1, 0, C.whaleBack, C.whaleFin, PART.TAIL, -0.16);
  // The hump the whale is named for, and the small fin on it.
  blade(g, 0.000, 0.075, -0.155, 0.000, 0.118, -0.190, 0.070, 0.024, 0, 0, 1, C.whaleBack, C.whaleBack, PART.DORSAL, 0);
  // The mesh runs one unit from the tip of the rostrum to the notch of the flukes, so the
  // instance scale is the animal's length in metres. Adult females reach about 16 m, males
  // about 13 to 14, and a newborn calf is 4 to 4.5.
  return { g, lengthM: 14.5, unit: 1.0, family: FAM.SWIM, lateral: 0, undulate: 0.030, beat: 1.05, wave: 3.1 };
}

function buildDolphin() {
  const g = newGeo();
  loft(g, [
    [0.00, 0.004, -0.010, 1.00], [0.05, 0.026, -0.014, 0.90], [0.10, 0.048, -0.008, 1.00],
    [0.18, 0.076, 0.000, 1.02], [0.30, 0.090, 0.000, 0.94], [0.44, 0.086, 0.000, 0.88],
    [0.58, 0.070, 0.002, 0.82], [0.72, 0.048, 0.004, 0.72], [0.85, 0.026, 0.006, 0.54],
    [0.94, 0.013, 0.006, 0.40], [1.00, 0.005, 0.006, 0.28]
  ], 10, C.dolphinBack, C.dolphinBelly, PART.BODY);
  blade(g, 0.070, -0.020, 0.220, 0.150, -0.075, 0.120, 0.055, 0.018, 0, 1, 0, C.dolphinBack, C.dolphinBack, PART.LEFT, 0.20);
  blade(g, -0.070, -0.020, 0.220, -0.150, -0.075, 0.120, 0.055, 0.018, 0, 1, 0, C.dolphinBack, C.dolphinBack, PART.RIGHT, -0.20);
  blade(g, 0.000, 0.006, -0.470, 0.120, 0.006, -0.520, 0.050, 0.070, 0, 1, 0, C.dolphinBack, C.dolphinBack, PART.TAIL, 0.14);
  blade(g, 0.000, 0.006, -0.470, -0.120, 0.006, -0.520, 0.050, 0.070, 0, 1, 0, C.dolphinBack, C.dolphinBack, PART.TAIL, -0.14);
  blade(g, 0.000, 0.078, 0.030, 0.000, 0.150, -0.030, 0.090, 0.020, 0, 0, 1, C.dolphinBack, C.dolphinBack, PART.DORSAL, 0);
  return { g, lengthM: 2.6, unit: 1.0, family: FAM.SWIM, lateral: 0, undulate: 0.040, beat: 2.6, wave: 3.4 };
}

function buildDugong() {
  const g = newGeo();
  // Fusiform, no dorsal fin, a broad downturned muzzle, and a fluked tail. Nothing else in the
  // bay looks like it, which is why a herd on the banks reads instantly.
  loft(g, [
    [0.00, 0.048, -0.030, 1.10], [0.06, 0.076, -0.020, 1.15], [0.16, 0.100, -0.004, 1.05],
    [0.30, 0.114, 0.000, 1.00], [0.46, 0.116, 0.000, 0.98], [0.62, 0.098, 0.002, 0.92],
    [0.76, 0.068, 0.004, 0.80], [0.88, 0.036, 0.006, 0.60], [0.96, 0.016, 0.007, 0.42],
    [1.00, 0.006, 0.007, 0.30]
  ], 10, C.dugongBack, C.dugongBelly, PART.BODY);
  blade(g, 0.086, -0.048, 0.270, 0.150, -0.090, 0.205, 0.060, 0.032, 0, 1, 0, C.dugongBack, C.dugongBack, PART.LEFT, 0.10);
  blade(g, -0.086, -0.048, 0.270, -0.150, -0.090, 0.205, 0.060, 0.032, 0, 1, 0, C.dugongBack, C.dugongBack, PART.RIGHT, -0.10);
  blade(g, 0.000, 0.007, -0.470, 0.145, 0.007, -0.520, 0.055, 0.085, 0, 1, 0, C.dugongBack, C.dugongBack, PART.TAIL, 0.10);
  blade(g, 0.000, 0.007, -0.470, -0.145, 0.007, -0.520, 0.055, 0.085, 0, 1, 0, C.dugongBack, C.dugongBack, PART.TAIL, -0.10);
  return { g, lengthM: 2.9, unit: 1.0, family: FAM.SWIM, lateral: 0, undulate: 0.030, beat: 1.4, wave: 2.6 };
}

function buildTurtle() {
  const g = newGeo();
  // A flattened, wide carapace and long front flippers that beat like wings.
  loft(g, [
    [0.00, 0.030, -0.010, 1.00], [0.08, 0.055, -0.005, 1.30], [0.18, 0.090, 0.000, 2.05],
    [0.34, 0.106, 0.004, 2.55], [0.52, 0.108, 0.004, 2.60], [0.70, 0.092, 0.002, 2.30],
    [0.86, 0.056, 0.000, 1.60], [1.00, 0.014, 0.000, 0.55]
  ], 12, C.turtleShell, C.turtlePlast, PART.BODY);
  blade(g, 0.180, -0.010, 0.230, 0.520, 0.010, 0.090, 0.090, 0.030, 0, 1, 0, C.turtleShell, C.turtleShell, PART.LEFT, 0.24);
  blade(g, -0.180, -0.010, 0.230, -0.520, 0.010, 0.090, 0.090, 0.030, 0, 1, 0, C.turtleShell, C.turtleShell, PART.RIGHT, -0.24);
  blade(g, 0.170, -0.020, -0.300, 0.290, -0.030, -0.400, 0.070, 0.026, 0, 1, 0, C.turtleShell, C.turtleShell, PART.BODY, 0.10);
  blade(g, -0.170, -0.020, -0.300, -0.290, -0.030, -0.400, 0.070, 0.026, 0, 1, 0, C.turtleShell, C.turtleShell, PART.BODY, -0.10);
  return { g, lengthM: 1.05, unit: 1.0, family: FAM.SWIM, lateral: 0, undulate: 0.004, beat: 1.1, wave: 1.0, flapWing: 0.55 };
}

function buildManta() {
  const g = newGeo();
  // A reef manta is a disc: the wings are the animal. Span runs wider than the length, so the
  // mesh is built wide and the spanwise flap lives on the membrane part code.
  loft(g, [
    [0.00, 0.020, 0.000, 1.60], [0.08, 0.038, 0.000, 4.20], [0.20, 0.052, 0.000, 9.60],
    [0.34, 0.056, 0.000, 15.80], [0.48, 0.048, 0.000, 17.20], [0.62, 0.034, 0.000, 13.60],
    [0.76, 0.020, 0.000, 7.20], [0.88, 0.010, 0.000, 2.60], [1.00, 0.004, 0.000, 0.40]
  ], 14, C.mantaBack, C.mantaBelly, PART.WING);
  // The cephalic lobes, which is the thing that makes a manta unmistakable head on.
  blade(g, 0.055, -0.020, 0.470, 0.075, -0.055, 0.560, 0.035, 0.020, 0, 1, 0, C.mantaBack, C.mantaBack, PART.BODY, 0.05);
  blade(g, -0.055, -0.020, 0.470, -0.075, -0.055, 0.560, 0.035, 0.020, 0, 1, 0, C.mantaBack, C.mantaBack, PART.BODY, -0.05);
  blade(g, 0.000, 0.004, -0.480, 0.000, 0.020, -0.760, 0.030, 0.004, 1, 0, 0, C.mantaBack, C.mantaBack, PART.TAIL, 0);
  // A reef manta is wider than it is long: about 3.5 m across the disc on an animal about 2 m
  // nose to tail. The mesh is one unit long and about 1.85 across, so the disc comes out right.
  return { g, lengthM: 1.95, unit: 1.0, family: FAM.SWIM, lateral: 0, undulate: 0.004, beat: 0.75, wave: 1.0, membrane: 0.115 };
}

function buildShark() {
  const g = newGeo();
  // Grey nurse: heavy in the middle, two dorsals of about the same size, and it hangs in the
  // gutters rather than cruising. Lateral tail beat, unlike everything else on this list.
  loft(g, [
    [0.00, 0.012, -0.006, 0.90], [0.07, 0.045, -0.002, 0.94], [0.18, 0.078, 0.000, 0.98],
    [0.32, 0.086, 0.000, 0.94], [0.46, 0.080, 0.000, 0.88], [0.60, 0.066, 0.000, 0.82],
    [0.74, 0.046, 0.002, 0.72], [0.86, 0.028, 0.004, 0.58], [0.95, 0.014, 0.006, 0.42],
    [1.00, 0.006, 0.008, 0.30]
  ], 10, C.sharkBack, C.sharkBelly, PART.BODY);
  blade(g, 0.070, -0.030, 0.220, 0.185, -0.080, 0.130, 0.070, 0.020, 0, 1, 0, C.sharkBack, C.sharkBack, PART.LEFT, 0.16);
  blade(g, -0.070, -0.030, 0.220, -0.185, -0.080, 0.130, 0.070, 0.020, 0, 1, 0, C.sharkBack, C.sharkBack, PART.RIGHT, -0.16);
  blade(g, 0.000, 0.080, -0.020, 0.000, 0.150, -0.075, 0.075, 0.022, 0, 0, 1, C.sharkBack, C.sharkBack, PART.DORSAL, 0);
  blade(g, 0.000, 0.062, -0.230, 0.000, 0.120, -0.275, 0.060, 0.020, 0, 0, 1, C.sharkBack, C.sharkBack, PART.DORSAL, 0);
  blade(g, 0.000, 0.010, -0.470, 0.000, 0.170, -0.640, 0.055, 0.030, 1, 0, 0, C.sharkBack, C.sharkBack, PART.TAIL, 0);
  blade(g, 0.000, 0.010, -0.470, 0.000, -0.075, -0.560, 0.050, 0.020, 1, 0, 0, C.sharkBack, C.sharkBelly, PART.TAIL, 0);
  // The upper lobe of the caudal runs past the tail root, so the mesh is 1.14 units nose to tip.
  return { g, lengthM: 2.7, unit: 1.14, family: FAM.SWIM, lateral: 1, undulate: 0.045, beat: 1.7, wave: 4.2 };
}

function buildMullet() {
  const g = newGeo();
  loft(g, [
    [0.00, 0.020, 0.000, 0.80], [0.14, 0.062, 0.000, 0.70], [0.34, 0.080, 0.000, 0.62],
    [0.56, 0.066, 0.000, 0.58], [0.76, 0.040, 0.000, 0.50], [0.90, 0.020, 0.000, 0.40],
    [1.00, 0.008, 0.000, 0.30]
  ], 7, C.fish, C.fishBelly, PART.BODY);
  blade(g, 0.000, 0.006, -0.440, 0.000, 0.100, -0.540, 0.045, 0.080, 1, 0, 0, C.fish, C.fish, PART.TAIL, 0);
  blade(g, 0.000, 0.006, -0.440, 0.000, -0.100, -0.540, 0.045, 0.080, 1, 0, 0, C.fish, C.fish, PART.TAIL, 0);
  blade(g, 0.000, 0.070, -0.030, 0.000, 0.125, -0.060, 0.070, 0.020, 0, 0, 1, C.fish, C.fish, PART.DORSAL, 0);
  return { g, lengthM: 0.44, unit: 1.04, family: FAM.SWIM, lateral: 1, undulate: 0.050, beat: 5.5, wave: 4.8 };
}

function buildKoala() {
  const g = newGeo();
  // Built sitting, which is how a koala spends about twenty hours a day. Torso upright, head
  // low into the shoulders, no tail, and the ears are half the silhouette.
  ellipsoid(g, 0, 0.00, 0, 0.185, 0.240, 0.175, 12, 8, C.koalaFur, C.koalaBelly, PART.BODY, false);
  ellipsoid(g, 0, 0.285, 0.030, 0.140, 0.135, 0.130, 12, 8, C.koalaFur, C.koalaBelly, PART.HEAD, false);
  ellipsoid(g, 0, 0.265, 0.150, 0.048, 0.055, 0.048, 8, 6, [0.045, 0.042, 0.040], [0.045, 0.042, 0.040], PART.HEAD, false);
  blade(g, 0.115, 0.345, 0.010, 0.245, 0.400, -0.020, 0.150, 0.130, 0, 0, 1, [0.44, 0.43, 0.42], [0.60, 0.59, 0.57], PART.HEAD, 0.05);
  blade(g, -0.115, 0.345, 0.010, -0.245, 0.400, -0.020, 0.150, 0.130, 0, 0, 1, [0.44, 0.43, 0.42], [0.60, 0.59, 0.57], PART.HEAD, -0.05);
  blade(g, 0.140, 0.090, 0.060, 0.185, -0.140, 0.130, 0.085, 0.055, 0, 0, 1, C.koalaFur, C.koalaFur, PART.FORE, 0.06);
  blade(g, -0.140, 0.090, 0.060, -0.185, -0.140, 0.130, 0.085, 0.055, 0, 0, 1, C.koalaFur, C.koalaFur, PART.FORE, -0.06);
  blade(g, 0.135, -0.150, 0.020, 0.170, -0.310, 0.075, 0.100, 0.060, 0, 0, 1, C.koalaFur, C.koalaFur, PART.HIND, 0.04);
  blade(g, -0.135, -0.150, 0.020, -0.170, -0.310, 0.075, 0.100, 0.060, 0, 0, 1, C.koalaFur, C.koalaFur, PART.HIND, -0.04);
  // Quoted as sitting height, which is what you judge a koala in a fork by. The mesh runs from
  // the hind foot at -0.31 to the ear tip at +0.40, so 0.71 of a unit.
  return { g, lengthM: 0.75, unit: 0.71, family: FAM.WALK, refUp: 0.30 };
}

function buildMacropod(col, colBelly, earLen, tailThick) {
  const g = newGeo();
  // Standing on the hind legs with the tail down: the shape you see on a verge at dusk.
  ellipsoid(g, 0, 0.00, 0.020, 0.150, 0.215, 0.230, 12, 8, col, colBelly, PART.BODY, false);
  ellipsoid(g, 0, 0.300, 0.180, 0.098, 0.115, 0.115, 10, 7, col, colBelly, PART.BODY, false);
  ellipsoid(g, 0, 0.395, 0.300, 0.078, 0.082, 0.130, 10, 7, col, colBelly, PART.HEAD, false);
  ellipsoid(g, 0, 0.375, 0.410, 0.040, 0.040, 0.050, 8, 6, [0.05, 0.045, 0.04], [0.05, 0.045, 0.04], PART.HEAD, false);
  blade(g, 0.055, 0.470, 0.300, 0.085, 0.470 + earLen, 0.250, 0.075, 0.045, 0, 0, 1, col, [0.10, 0.09, 0.08], PART.HEAD, 0.03);
  blade(g, -0.055, 0.470, 0.300, -0.085, 0.470 + earLen, 0.250, 0.075, 0.045, 0, 0, 1, col, [0.10, 0.09, 0.08], PART.HEAD, -0.03);
  blade(g, 0.105, 0.120, 0.150, 0.150, -0.060, 0.230, 0.060, 0.038, 0, 0, 1, col, col, PART.FORE, 0.05);
  blade(g, -0.105, 0.120, 0.150, -0.150, -0.060, 0.230, 0.060, 0.038, 0, 0, 1, col, col, PART.FORE, -0.05);
  blade(g, 0.115, -0.070, 0.030, 0.135, -0.330, 0.150, 0.150, 0.070, 0, 0, 1, col, col, PART.HIND, 0.10);
  blade(g, -0.115, -0.070, 0.030, -0.135, -0.330, 0.150, 0.150, 0.070, 0, 0, 1, col, col, PART.HIND, -0.10);
  loft(g, [
    [0.00, tailThick, -0.120, 1.00], [0.35, tailThick * 0.75, -0.270, 1.00],
    [0.70, tailThick * 0.45, -0.330, 1.00], [1.00, tailThick * 0.15, -0.345, 1.00]
  ], 7, col, colBelly, PART.TAIL);
  // Standing height, hind foot to ear tip: 0.93 of a unit in the mesh.
  return { g, lengthM: 1.45, unit: 0.93 + earLen, family: FAM.WALK, refUp: 0.40 };
}

function buildGoanna() {
  const g = newGeo();
  // Long, low, banded, with a tail longer than the body. Lace monitors are what you meet at a
  // campground table, and they are the reason food scraps at a campsite matter.
  loft(g, [
    [0.00, 0.020, 0.000, 0.90], [0.08, 0.040, 0.000, 1.00], [0.16, 0.036, 0.000, 1.05],
    [0.28, 0.058, 0.000, 1.25], [0.44, 0.062, 0.000, 1.30], [0.58, 0.052, 0.000, 1.15],
    [0.70, 0.036, 0.000, 0.95], [0.84, 0.022, 0.000, 0.70], [1.00, 0.008, 0.000, 0.45]
  ], 9, C.goanna, C.goannaBand, PART.BODY);
  blade(g, 0.000, 0.000, -0.500, 0.000, 0.010, -1.060, 0.045, 0.006, 1, 0, 0, C.goanna, C.goannaBand, PART.TAIL, 0);
  blade(g, 0.045, -0.030, 0.230, 0.170, -0.075, 0.270, 0.055, 0.028, 0, 0, 1, C.goanna, C.goanna, PART.FORE, 0.12);
  blade(g, -0.045, -0.030, 0.230, -0.170, -0.075, 0.270, 0.055, 0.028, 0, 0, 1, C.goanna, C.goanna, PART.FORE, -0.12);
  blade(g, 0.045, -0.030, -0.190, 0.185, -0.075, -0.245, 0.060, 0.030, 0, 0, 1, C.goanna, C.goanna, PART.HIND, 0.12);
  blade(g, -0.045, -0.030, -0.190, -0.185, -0.075, -0.245, 0.060, 0.030, 0, 0, 1, C.goanna, C.goanna, PART.HIND, -0.12);
  // Snout to tail tip, and on a lace monitor the tail is more than half of it: 1.56 units.
  return { g, lengthM: 1.6, unit: 1.56, family: FAM.WALK, refUp: 0.05, lateral: 1 };
}

function buildWader(back, belly, billLen, legLen, wingSpan) {
  const g = newGeo();
  loft(g, [
    [0.00, 0.018, 0.010, 0.80], [0.14, 0.070, 0.010, 0.90], [0.34, 0.098, 0.000, 1.00],
    [0.56, 0.086, -0.006, 0.96], [0.76, 0.058, -0.010, 0.80], [0.92, 0.030, -0.010, 0.55],
    [1.00, 0.012, -0.008, 0.35]
  ], 8, back, belly, PART.BODY);
  ellipsoid(g, 0, 0.115, 0.395, 0.058, 0.058, 0.070, 8, 6, back, belly, PART.HEAD, false);
  // The bill. An eastern curlew's is longer than its head, which is the field mark you would use.
  blade(g, 0.000, 0.105, 0.450, 0.000, 0.085 - billLen * 0.25, 0.450 + billLen, 0.022, 0.008, 1, 0, 0, C.waderDark, C.waderDark, PART.HEAD, 0);
  blade(g, 0.045, 0.060, 0.150, wingSpan, 0.075, -0.060, 0.190, 0.055, 0, 1, 0, back, C.waderDark, PART.LEFT, 0.30);
  blade(g, -0.045, 0.060, 0.150, -wingSpan, 0.075, -0.060, 0.190, 0.055, 0, 1, 0, back, C.waderDark, PART.RIGHT, -0.30);
  blade(g, 0.000, 0.000, -0.480, 0.000, 0.020, -0.680, 0.110, 0.070, 1, 0, 0, back, C.waderDark, PART.TAIL, 0);
  blade(g, 0.045, -0.060, 0.030, 0.048, -0.060 - legLen, 0.010, 0.020, 0.012, 0, 0, 1, C.waderDark, C.waderDark, PART.HIND, 0);
  blade(g, -0.045, -0.060, 0.030, -0.048, -0.060 - legLen, 0.010, 0.020, 0.012, 0, 0, 1, C.waderDark, C.waderDark, PART.HIND, 0);
  // Bill tip to tail tip. An eastern curlew's bill is longer than its head, so the mesh length
  // moves with the bill and the scale has to move with it.
  return { g, lengthM: 0.63, unit: 1.18 + billLen, family: FAM.FLY, refUp: 0.08 };
}

function buildRaptor(back, belly, span) {
  const g = newGeo();
  loft(g, [
    [0.00, 0.020, 0.010, 0.80], [0.14, 0.078, 0.010, 0.92], [0.34, 0.110, 0.000, 1.00],
    [0.58, 0.096, -0.006, 0.94], [0.78, 0.062, -0.010, 0.78], [0.93, 0.030, -0.010, 0.52],
    [1.00, 0.012, -0.008, 0.34]
  ], 8, back, belly, PART.BODY);
  ellipsoid(g, 0, 0.100, 0.400, 0.070, 0.068, 0.082, 8, 6, belly, belly, PART.HEAD, false);
  blade(g, 0.000, 0.090, 0.470, 0.000, 0.055, 0.545, 0.038, 0.012, 1, 0, 0, [0.14, 0.13, 0.11], [0.14, 0.13, 0.11], PART.HEAD, 0);
  // Broad, fingered wings held in a shallow dihedral: a sea-eagle soars in a distinct V.
  blade(g, 0.060, 0.070, 0.140, span, 0.180, -0.140, 0.300, 0.120, 0, 1, 0, back, [0.10, 0.10, 0.10], PART.LEFT, 0.34);
  blade(g, -0.060, 0.070, 0.140, -span, 0.180, -0.140, 0.300, 0.120, 0, 1, 0, back, [0.10, 0.10, 0.10], PART.RIGHT, -0.34);
  blade(g, 0.000, 0.000, -0.470, 0.000, 0.030, -0.800, 0.230, 0.190, 1, 0, 0, belly, back, PART.TAIL, 0);
  // Quoted as wingspan, which is what you identify a soaring bird by. The mesh spans 2 x span.
  return { g, lengthM: 2 * span, unit: 2 * span, family: FAM.FLY, refUp: 0.10 };
}

/* ================================================================== shaders */

const FAUNA_VERT = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 color;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aAnim;   // SWIM: phase, arch, flukeLift, pecRaise
                        // WALK: phase, bob, foreSwing, hindSwing
                        // FLY : phase, flapAmp, wristBend, tailSpread
attribute vec4 aTint;   // rgb tint multiplier, a fade

uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uMotion;   // x undulation amplitude, y beat rate, z wave number, w lateral flag
uniform vec4 uPivot;    // x tail pivot z, y shoulder z, z shoulder x, w membrane flap amplitude

varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vFade;
varying float vPart;

void rotX(inout vec3 p, inout vec3 n, float pz, float a) {
  float c = cos(a), s = sin(a);
  vec3 q = p - vec3(0.0, 0.0, pz);
  p = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c) + vec3(0.0, 0.0, pz);
  n = vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
}
void rotZ(inout vec3 p, inout vec3 n, vec2 pivot, float a) {
  float c = cos(a), s = sin(a);
  vec2 q = p.xy - pivot;
  p.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + pivot;
  n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
}

void main() {
  mat4 W = mat4(world0, world1, world2, world3);
  vec3 p = position;
  vec3 n = normal;
  float part = floor(color.a * 8.0 + 0.5);
  float t = uv.x;
  float ph = aAnim.x;

#ifdef SWIM
  // Body undulation. Cetaceans and dugong beat vertically, sharks and fish laterally, and the
  // amplitude grows toward the tail because that is where a body actually bends.
  float w = sin(ph * uMotion.y - t * uMotion.z);
  float amp = uMotion.x * pow(max(t - 0.22, 1e-4) / 0.78, 1.7);
  if (uMotion.w < 0.5) p.y += amp * w; else p.x += amp * w;
  // The back arches before a dive, which is what lifts the hump above the waterline.
  p.y -= aAnim.y * smoothstep(0.28, 1.0, t) * 0.14;
  if (part > 2.5 && part < 3.5) rotX(p, n, uPivot.x, aAnim.z);
  if (part > 0.5 && part < 2.5) {
    float side = part < 1.5 ? 1.0 : -1.0;
    rotZ(p, n, vec2(uPivot.z * side, 0.0), aAnim.w * side);
  }
  // A manta's wings are its body, so the flap is a spanwise travelling wave on the membrane.
  if (part > 7.5) {
    float sp = abs(p.x);
    p.y += sin(ph * uMotion.y - sp * 5.0) * sp * uPivot.w;
  }
#endif

#ifdef WALK
  float sw = sin(ph);
  p.y += aAnim.y * (0.5 + 0.5 * sin(ph * 2.0));
  if (part > 4.5 && part < 5.5) rotX(p, n, uPivot.y, aAnim.z * sw * sign(position.x + 0.0001));
  if (part > 5.5 && part < 6.5) rotX(p, n, uPivot.x, aAnim.w * -sw * sign(position.x + 0.0001));
  if (part > 2.5 && part < 3.5) {
    // The tail counterweights the stride, and on a goanna it is most of the animal.
    float k = smoothstep(0.0, -0.5, position.z);
    p.x += sin(ph - position.z * 2.4) * uMotion.x * k * 2.0 * uMotion.w;
    p.y += aAnim.y * k * 1.6;
  }
  if (part > 3.5 && part < 4.5) rotX(p, n, 0.30, aAnim.z * 0.22 * sin(ph * 0.5));
#endif

#ifdef FLY
  float flap = sin(ph) * aAnim.y;
  if (part > 0.5 && part < 2.5) {
    float side = part < 1.5 ? 1.0 : -1.0;
    rotZ(p, n, vec2(0.05 * side, 0.06), flap * side);
    // The wrist folds on the upstroke, so the wing is not a rigid plank hinged at the shoulder.
    float outer = smoothstep(0.35, 1.0, abs(position.x));
    p.y += outer * (flap * 0.55 + aAnim.z) * side * side;
    p.z += outer * abs(flap) * -0.10;
  }
  if (part > 2.5 && part < 3.5) {
    p.x *= 1.0 + aAnim.w;
    p.y += flap * 0.10;
  }
  if (part > 5.5 && part < 6.5) {
    // Legs trail on a bird in the air and stand under it on the ground.
    rotX(p, n, 0.03, aAnim.z * 2.6);
  }
#endif

  vec4 wp = W * vec4(p, 1.0);
  vPos = wp.xyz;
  vNrm = normalize((W * vec4(n, 0.0)).xyz);
  vCol = color.rgb * aTint.rgb;
  vUv = uv;
  vFade = aTint.a;
  vPart = part;
  gl_Position = viewProjection * wp;
}
`;

const FAUNA_FRAG = `
precision highp float;

varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vFade;
varying float vPart;

uniform vec3 uCam;
uniform vec4 uSun;      // xyz direction to the sun, w day factor
uniform vec4 uSunCol;   // rgb sun colour, a intensity
uniform vec4 uSky;      // rgb sky ambient, a cloud
uniform vec4 uSkyHz;    // rgb horizon colour
uniform vec4 uWater;    // x water level, y through-water strength, z turbidity extinction, w wet gloss

// Never normalise a vector that might be zero, and never raise zero to a power. Either one
// returns a NaN on some drivers, one NaN pixel poisons the average luminance the post chain
// reads back, and the exposure that comes out of that turns the whole frame white. It did.
vec3 safeNorm(vec3 v, vec3 fallback) {
  float l = length(v);
  return l > 1e-5 ? v / l : fallback;
}
float safePow(float x, float k) { return pow(max(x, 1e-4), k); }

void main() {
  vec3 N = safeNorm(vNrm, vec3(0.0, 1.0, 0.0));
  vec3 V = safeNorm(uCam - vPos, vec3(0.0, 0.0, 1.0));
  if (dot(N, V) < 0.0) N = -N;

  float lam = max(dot(N, uSun.xyz), 0.0);
  // Wrapped diffuse: a big smooth wet animal picks up a lot of light off the water and the sky.
  float wrap = max(0.0, (dot(N, uSun.xyz) + 0.35) / 1.35);
  vec3 lit = vCol * (uSunCol.rgb * uSunCol.a * (lam * 0.72 + wrap * 0.30)
                   + uSky.rgb * (0.55 + 0.45 * N.y));

  // A wet hide is glossy. This is most of what makes a whale's back read as a whale's back.
  vec3 H = safeNorm(uSun.xyz + V, vec3(0.0, 1.0, 0.0));
  float spec = safePow(max(dot(N, H), 0.0), 48.0) * uSun.w * uWater.w;
  lit += uSunCol.rgb * uSunCol.a * spec * 1.15;
  // Rim off the sky, which is what separates a dark back from dark water at range.
  float rim = safePow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += uSkyHz.rgb * rim * 0.30 * (0.35 + 0.65 * uSun.w);

  float alpha = vFade;

  // Below the waterline the animal is seen through moving water: it goes green, it loses
  // contrast, and the marine system's turbidity decides how fast.
  float depth = max(0.0, uWater.x - vPos.y);
  if (depth > 0.0 && uWater.y > 0.0) {
    float ext = exp(-depth * uWater.z);
    vec3 sea = uSkyHz.rgb * 0.30 + vec3(0.030, 0.085, 0.088);
    lit = mix(sea, lit, ext);
    alpha *= mix(1.0, ext, uWater.y);
  }

  float dist = length(uCam - vPos);
  float fog = 1.0 - exp(-dist * 0.000045);
  lit = mix(lit, uSkyHz.rgb * 0.9, fog * 0.85);

  // Written the negative way round so a NaN discards rather than reaching the framebuffer, and
  // clamped so nothing this layer draws can drive the bloom threshold or the exposure meter.
  if (!(alpha > 0.008)) discard;
  gl_FragColor = vec4(clamp(lit, 0.0, 16.0), min(alpha, 1.0));
}
`;

/* Vapour, whitewater and spray: soft billboards. One mesh, one draw call, used for blows,
   breach splash, pec and tail slap whitewater and the fine spray a fluke throws. */

const PUFF_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aP;     // x age 0..1, y size metres, z tint 0 vapour .. 1 foam, w opacity
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
  vUv = uv;
  vP = aP;
  vPos = wp;
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
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = dot(d, d);
  if (r > 1.0) discard;
  // A soft core with a ragged edge, so a blow is a bush of vapour and not a sphere.
  float soft = pow(1.0 - r, 1.6);
  float edge = 0.72 + 0.28 * sin(d.x * 9.0 + vP.x * 6.0) * sin(d.y * 7.0 - vP.x * 5.0);
  float a = soft * edge * vP.w;
  // Vapour is lit from everywhere; foam is whiter and brighter.
  vec3 vapour = uSky.rgb * 1.45 + uSunCol.rgb * uSunCol.a * 0.30;
  vec3 foam = uSkyHz.rgb * 0.55 + uSunCol.rgb * uSunCol.a * 0.85 + vec3(0.30);
  vec3 col = mix(vapour, foam, vP.z);
  float dist = length(uCam - vPos);
  col = mix(col, uSkyHz.rgb * 0.9, (1.0 - exp(-dist * 0.000045)) * 0.85);
  if (!(a > 0.004)) discard;
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

/* Marks on the sea surface: wakes, foam scars where a breach landed, the dark stain of a school
   of mullet under the surface. Horizontal quads on the waterline. */

const MARK_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 aP;     // x age 0..1, y kind (0 foam, 1 dark stain), z stretch, w opacity
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

const MARK_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec4 vP;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform float uTime;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  d.y *= vP.z;
  float r = length(d);
  if (r > 1.0) discard;
  float body = pow(1.0 - r, 1.3);
  // Foam breaks up as it ages; a fish school shimmers instead.
  float n = sin(d.x * 17.0 + uTime * 1.7) * sin(d.y * 13.0 - uTime * 2.1);
  float a;
  vec3 col;
  if (vP.y < 0.5) {
    a = body * (0.62 + 0.38 * n) * vP.w;
    col = uSkyHz.rgb * 0.5 + uSunCol.rgb * uSunCol.a * 0.8 + vec3(0.26);
  } else {
    a = body * (0.70 + 0.30 * n) * vP.w;
    col = vec3(0.020, 0.038, 0.042) + uSky.rgb * 0.10;
  }
  float dist = length(uCam - vPos);
  col = mix(col, uSkyHz.rgb * 0.9, (1.0 - exp(-dist * 0.000045)) * 0.85);
  if (!(a > 0.004)) discard;
  gl_FragColor = vec4(clamp(col, 0.0, 16.0), min(a, 1.0));
}
`;

/* ================================================================== registration */

export function registerFauna(world) {
  const rngSeed = world.rng.stream('fauna').int(1, 1 << 28);

  const state = world.publish('fauna', {
    ready: false,
    rendered: false,
    source: 'whales, koala, shorebirds and marine read models; ambient species placed by habitat '
      + 'from data/ecology.json',
    renderer: '',
    drawn: {
      whalePods: 0, whales: 0, blows: 0, breaches: 0, entangled: 0,
      koalas: 0, koalasOnGround: 0, koalasNearSealedRoad: 0,
      shorebirds: 0, roostsUp: 0,
      dolphins: 0, dugong: 0, turtles: 0, mantas: 0, sharks: 0, mullet: 0, vapourPuffs: 0,
      kangaroos: 0, wallabies: 0, goannas: 0, raptors: 0
    },
    lastSurfaceAction: null,
    lastFlush: null,
    sightingRangeKm: 0,
    turbidity: 0,
    meshes: 0,
    instances: 0,
    ambientBasis: 'Kangaroos, wallabies, goannas and the raptors are not counted by any simulation '
      + 'system and no island count is published for them. They are placed on the land cover the '
      + 'pack lists as their habitat, at a modelled density, and their numbers on screen follow the '
      + "pack's own monthly activity curve. The figure drawn is a drawing budget, not a census.",
    notes: []
  });

  // A describe-only system so the fauna slice is interrogable from TWIN.probe(). It has no tick,
  // so it costs the simulation nothing, and everything it reports headless is read straight off
  // the ecology systems rather than off the renderer, so --determinism is unaffected by frames.
  world.register({
    id: 'fauna',
    phase: 'presentation',
    order: 60,
    describe(w) {
      const wh = w.read('whales');
      const kl = w.read('koala');
      const sb = w.read('shorebirds');
      const mr = w.read('marine');
      return {
        rendered: state.rendered,
        podsAvailable: wh ? wh.pods.length : 0,
        visibleFromHeadland: wh ? wh.visibleFromHeadland : 0,
        sightingRangeKm: wh ? wh.sightingRangeKm : 0,
        koalasAvailable: kl ? kl.population : 0,
        koalasOnGround: kl ? kl.onGroundNow : 0,
        birdsAvailable: sb ? sb.onIslandNow : 0,
        tidePhase: sb ? sb.tidePhase : null,
        dolphinPods: mr && mr.dolphins ? mr.dolphins.pods.length : 0,
        drawn: state.rendered ? state.drawn : null,
        meshes: state.meshes,
        instances: state.instances
      };
    },
    save() { return null; },
    load() {}
  });

  if (!world.stage || !B) {
    state.notes.push('headless: the animals are simulated, nothing is drawn.');
    return;
  }
  try {
    buildFaunaRenderer(world, rngSeed, state);
  } catch (e) {
    console.error('[fauna] renderer failed to build', e);
    state.notes.push('renderer failed to build: ' + (e && e.message));
  }
}

/* ================================================================== the renderer */

function buildFaunaRenderer(world, SEED, state) {
  const stage = world.stage;
  const scene = stage.scene;
  const island = world.island;
  if (!island) {
    state.notes.push('no world.island: fauna needs the heightfield to stand animals on.');
    return;
  }
  const seaLevel = island.seaLevel != null ? island.seaLevel : MEAN_SEA_LEVEL;

  /* ---- species table ---------------------------------------------------- */

  const SPECIES = [
    { id: 'humpback', pack: 'sp-humpback-whale', build: buildHumpback, cap: 150, range: 7000, water: 1 },
    { id: 'dolphin', pack: 'sp-indo-pacific-bottlenose-dolphin', build: buildDolphin, cap: 200, range: 2600, water: 1 },
    { id: 'dugong', pack: 'sp-dugong', build: buildDugong, cap: 220, range: 1400, water: 1 },
    { id: 'turtle', pack: 'sp-green-turtle', build: buildTurtle, cap: 180, range: 900, water: 1 },
    { id: 'manta', pack: 'sp-reef-manta-ray', build: buildManta, cap: 26, range: 1100, water: 1 },
    { id: 'shark', pack: 'sp-grey-nurse-shark', build: buildShark, cap: 40, range: 900, water: 1 },
    { id: 'mullet', pack: 'sp-sea-mullet', build: buildMullet, cap: 420, range: 320, water: 1 },
    { id: 'koala', pack: 'sp-koala', build: buildKoala, cap: 200, range: 460, water: 0 },
    { id: 'kangaroo', pack: 'sp-eastern-grey-kangaroo', build: () => buildMacropod(C.kangaroo, C.kangarooBelly, 0.13, 0.055), cap: 90, range: 800, water: 0 },
    { id: 'wallaby', pack: 'sp-swamp-wallaby', build: () => buildMacropod(C.wallaby, C.wallabyBelly, 0.08, 0.048), cap: 90, range: 620, water: 0 },
    { id: 'goanna', pack: 'sp-lace-monitor', build: buildGoanna, cap: 40, range: 320, water: 0 },
    { id: 'wader', pack: 'sp-eastern-curlew', build: () => buildWader(C.waderBack, C.waderBelly, 0.42, 0.16, 0.62), cap: 900, range: 1500, water: 0 },
    { id: 'godwit', pack: 'sp-bar-tailed-godwit', build: () => buildWader([0.315, 0.290, 0.240], [0.76, 0.75, 0.70], 0.24, 0.12, 0.56), cap: 900, range: 1500, water: 0 },
    { id: 'oystercatcher', pack: 'sp-pied-oystercatcher', build: () => buildWader([0.055, 0.055, 0.058], [0.86, 0.86, 0.85], 0.20, 0.13, 0.54), cap: 160, range: 1200, water: 0 },
    { id: 'seaEagle', pack: 'sp-white-bellied-sea-eagle', build: () => buildRaptor(C.eagleBack, C.eagleBelly, 1.10), cap: 12, range: 3000, water: 0 },
    { id: 'osprey', pack: 'sp-eastern-osprey', build: () => buildRaptor(C.ospreyBack, C.ospreyBelly, 0.92), cap: 12, range: 2400, water: 0 }
  ];

  /* ---- meshes and materials -------------------------------------------- */

  const t0 = performance.now();
  const UNIFORMS = ['viewProjection', 'uCam', 'uMotion', 'uPivot', 'uSun', 'uSunCol', 'uSky',
    'uSkyHz', 'uWater'];
  const ATTRS = ['position', 'normal', 'uv', 'color', 'world0', 'world1', 'world2', 'world3',
    'aAnim', 'aTint'];

  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.9, 0.4);
  const vWater = new B.Vector4(seaLevel, 0, 0.18, 0.5);
  // Land species are never under the water, so their water level sits far below the world and
  // the depth branch in the fragment shader never runs. Held as one vector so the upload loop
  // allocates nothing.
  const vDry = new B.Vector4(-1e5, 0, 0.18, 0.5);
  const vCam = new B.Vector3();

  const S = new Map();
  let meshCount = 0;
  for (const sp of SPECIES) {
    const body = sp.build();
    const define = body.family === FAM.SWIM ? 'SWIM' : body.family === FAM.WALK ? 'WALK' : 'FLY';
    const mesh = geoToMesh(scene, 'fauna-' + sp.id, body.g);
    const mat = new B.ShaderMaterial('faunaMat-' + sp.id, scene,
      { vertexSource: FAUNA_VERT, fragmentSource: FAUNA_FRAG },
      { attributes: ATTRS, uniforms: UNIFORMS, defines: ['#define ' + define], needAlphaBlending: true });
    mat.backFaceCulling = false;
    mat.alphaMode = B.Engine.ALPHA_COMBINE;
    // Depth testing stays normal. An earlier pass drew the swimmers with the depth test forced to
    // always pass, so that a dugong under opaque water would still show: it did, and it also drew
    // over the sky, over the terrain, and into the post chain's depth prepass, which washed the
    // whole frame white. What a submerged animal gets instead is a dark shape on the water
    // surface, which is what you actually see from a boat or a headland anyway.
    mat.disableDepthWrite = true;
    mesh.alphaIndex = sp.water ? 60 : 40;
    mat.setVector4('uMotion', new B.Vector4(body.undulate || 0, body.beat || 1,
      body.wave || 1, body.lateral || 0));
    mat.setVector4('uPivot', new B.Vector4(-0.47, 0.24, 0.10, body.membrane || 0));
    mesh.material = mat;
    const cap = sp.cap;
    const mBuf = new Float32Array(cap * 16);
    const aBuf = new Float32Array(cap * 4);
    const tBuf = new Float32Array(cap * 4);
    mesh.thinInstanceSetBuffer('matrix', mBuf, 16, false);
    mesh.thinInstanceSetBuffer('aAnim', aBuf, 4, false);
    mesh.thinInstanceSetBuffer('aTint', tBuf, 4, false);
    mesh.thinInstanceCount = 0;
    meshCount++;
    S.set(sp.id, {
      sp, mesh, mat, mBuf, aBuf, tBuf, cap, n: 0,
      lengthM: body.lengthM, unit: body.unit || 1, refUp: body.refUp || 0,
      flapWing: body.flapWing || 0,
      tris: body.g.i.length / 3
    });
  }

  /** Write one instance. Yaw about Y, pitch about X, roll about Z, uniform scale. */
  function put(rec, x, y, z, yaw, pitch, roll, scale, a0, a1, a2, a3, tr, tg, tb, fade) {
    if (rec.n >= rec.cap) return false;
    const i = rec.n * 16;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz, column major as Babylon wants it.
    const m00 = cy * cr + sy * sp2 * sr, m01 = cp * sr, m02 = -sy * cr + cy * sp2 * sr;
    const m10 = -cy * sr + sy * sp2 * cr, m11 = cp * cr, m12 = sy * sr + cy * sp2 * cr;
    const m20 = sy * cp, m21 = -sp2, m22 = cy * cp;
    const b = rec.mBuf;
    b[i] = m00 * scale; b[i + 1] = m01 * scale; b[i + 2] = m02 * scale; b[i + 3] = 0;
    b[i + 4] = m10 * scale; b[i + 5] = m11 * scale; b[i + 6] = m12 * scale; b[i + 7] = 0;
    b[i + 8] = m20 * scale; b[i + 9] = m21 * scale; b[i + 10] = m22 * scale; b[i + 11] = 0;
    b[i + 12] = x; b[i + 13] = y; b[i + 14] = z; b[i + 15] = 1;
    const j = rec.n * 4;
    rec.aBuf[j] = a0; rec.aBuf[j + 1] = a1; rec.aBuf[j + 2] = a2; rec.aBuf[j + 3] = a3;
    rec.tBuf[j] = tr; rec.tBuf[j + 1] = tg; rec.tBuf[j + 2] = tb; rec.tBuf[j + 3] = fade;
    rec.n++;
    return true;
  }

  /* ---- vapour, foam and surface marks ----------------------------------- */

  function quadGeo(scene2, name) {
    const m = new B.Mesh(name, scene2);
    const vd = new B.VertexData();
    vd.positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    vd.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    vd.normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    vd.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    vd.applyToMesh(m, false);
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  }

  const PUFF_CAP = 1400;
  const puffMesh = quadGeo(scene, 'fauna-puff');
  const puffMat = new B.ShaderMaterial('faunaPuff', scene,
    { vertexSource: PUFF_VERT, fragmentSource: PUFF_FRAG },
    {
      attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3', 'aP'],
      uniforms: ['viewProjection', 'uCam', 'uUp', 'uSunCol', 'uSky', 'uSkyHz'],
      needAlphaBlending: true
    });
  puffMat.backFaceCulling = false;
  puffMat.alphaMode = B.Engine.ALPHA_COMBINE;
  puffMat.disableDepthWrite = true;
  puffMesh.material = puffMat;
  puffMesh.alphaIndex = 70;
  const puffM = new Float32Array(PUFF_CAP * 16);
  const puffP = new Float32Array(PUFF_CAP * 4);
  puffMesh.thinInstanceSetBuffer('matrix', puffM, 16, false);
  puffMesh.thinInstanceSetBuffer('aP', puffP, 4, false);
  puffMesh.thinInstanceCount = 0;
  meshCount++;

  const MARK_CAP = 600;
  const markMesh = new B.Mesh('fauna-mark', scene);
  {
    const vd = new B.VertexData();
    vd.positions = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]);
    vd.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    vd.normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    vd.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    vd.applyToMesh(markMesh, false);
    markMesh.alwaysSelectAsActiveMesh = true;
    markMesh.doNotSyncBoundingInfo = true;
    markMesh.isPickable = false;
    markMesh.setEnabled(false);
  }
  const markMat = new B.ShaderMaterial('faunaMark', scene,
    { vertexSource: MARK_VERT, fragmentSource: MARK_FRAG },
    {
      attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3', 'aP'],
      uniforms: ['viewProjection', 'uCam', 'uSunCol', 'uSky', 'uSkyHz', 'uTime'],
      needAlphaBlending: true
    });
  markMat.backFaceCulling = false;
  markMat.alphaMode = B.Engine.ALPHA_COMBINE;
  markMat.disableDepthWrite = true;
  markMesh.material = markMat;
  markMesh.alphaIndex = 58;
  const markM = new Float32Array(MARK_CAP * 16);
  const markP = new Float32Array(MARK_CAP * 4);
  markMesh.thinInstanceSetBuffer('matrix', markM, 16, false);
  markMesh.thinInstanceSetBuffer('aP', markP, 4, false);
  markMesh.thinInstanceCount = 0;
  meshCount++;

  // The pools. Fixed size, oldest recycled, so nothing allocates in a frame.
  const puffs = [];
  for (let i = 0; i < PUFF_CAP; i++) puffs.push({ a: 1e9, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 2, kind: 0, op: 1 });
  let puffCursor = 0;
  function emitPuff(x, y, z, vx, vy, vz, life, s0, s1, kind, op) {
    const p = puffs[puffCursor];
    puffCursor = (puffCursor + 1) % PUFF_CAP;
    p.a = 0; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.s0 = s0; p.s1 = s1; p.kind = kind; p.op = op;
  }
  // A submerged animal seen from above is a dark shape lying in the water: longer than it is
  // wide, softening and going out as it goes down, and gone entirely once the water is turbid.
  // These are rebuilt every frame rather than pooled, because the animal is still there.
  const shapes = [];
  for (let i = 0; i < 260; i++) shapes.push({ x: 0, y: 0, z: 0, yaw: 0, r: 1, stretch: 2.5, op: 0 });
  let shapeN = 0;
  function pushShape(x, y, z, yaw, lenM, depthM, ext) {
    if (shapeN >= shapes.length) return;
    // Visibility through water: the marine system's own turbidity decides how fast it goes.
    const op = Math.exp(-depthM * ext) * 0.62;
    if (op < 0.02) return;
    const s = shapes[shapeN++];
    s.x = x; s.y = y; s.z = z; s.yaw = yaw;
    // The shape spreads and softens with depth, the way a body under moving water does.
    s.r = lenM * (0.30 + depthM * 0.045);
    s.stretch = clamp(2.6 - depthM * 0.10, 1.3, 2.6);
    s.op = op;
  }

  const marks = [];
  for (let i = 0; i < MARK_CAP; i++) marks.push({ a: 1e9, x: 0, y: 0, z: 0, yaw: 0, r: 1, grow: 1, life: 1, kind: 0, stretch: 1, op: 1 });
  let markCursor = 0;
  function emitMark(x, y, z, yaw, r, grow, life, kind, stretch, op) {
    const m = marks[markCursor];
    markCursor = (markCursor + 1) % MARK_CAP;
    m.a = 0; m.x = x; m.y = y; m.z = z; m.yaw = yaw; m.r = r; m.grow = grow;
    m.life = life; m.kind = kind; m.stretch = stretch; m.op = op;
  }

  /* ---- the water surface, per side of the island ------------------------ */

  // The tide at Amity is not the tide at the Gorge, and the tide system publishes both. An animal
  // on the bay banks should sit on the bay's water.
  function waterAt(x, z) {
    const t = world.read('tide');
    if (!t) return seaLevel;
    const s = t.stations;
    if (!s) return t.height;
    const bay = ((s.dunwich ?? t.height) + (s.amity ?? t.height) + (s.onemile ?? t.height) + (s.myora ?? t.height)) * 0.25;
    const ocean = ((s.gorge ?? t.height) + (s.cylinder ?? t.height) + (s.mainbeach ?? t.height)) / 3;
    const b = island.bayness(x, z);
    return ocean + (bay - ocean) * b;
  }

  /* ---- ambient placement ------------------------------------------------

  Nothing below is a census. The pack has no island count for any of these species. Each list is a
  set of places the species could be, drawn once from the heightfield's own land cover, and how
  many of them are on screen at any moment follows the pack's monthly activity curve. */

  const ambient = { macropod: [], wallaby: [], goanna: [], dugong: [], turtle: [], raptor: [], flats: new Map() };

  function ambientPlaces(w) {
    const g = island.grid;
    const packSpecies = (w.data && w.data.ecology && w.data.ecology.species) || [];
    const byId = new Map(packSpecies.map((s) => [s.id, s]));
    ambient.season = (id, clock) => {
      const s = byId.get(id);
      if (!s || !s.seasonal_activity) return 0.7;
      const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      return s.seasonal_activity[MON[clock.month]] ?? 0.7;
    };

    // Sample the island on a coarse lattice rather than every cell: 1193112 cells is a scan
    // nobody needs, and a 160 m lattice is finer than any of these animals' home ranges.
    const STEP = 5;                 // 5 grid cells at 32 m
    const cell = g.cell * STEP;
    const nx = Math.floor(g.nx / STEP), nz = Math.floor(g.nz / STEP);
    const roads = w.read('roadNetwork');
    const roadPts = [];
    if (roads && Array.isArray(roads.edges)) {
      for (const e of roads.edges) {
        if (!e.sealed || !Array.isArray(e.pts)) continue;
        for (let i = 0; i < e.pts.length; i += 2) roadPts.push(e.pts[i]);
      }
    }
    let k = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        k++;
        const x = island.domain.minX + (i * STEP + 2) * g.cell;
        const z = island.domain.minZ + (j * STEP + 2) * g.cell;
        const cov = island.landCover(x, z);
        const h = island.height(x, z);
        const r1 = hash3(SEED, i, j);
        if (h > seaLevel + 0.4) {
          // Eastern grey kangaroo: the pack's own basis is road verges and open ground near
          // Dunwich and Amity, so open cover it is, and the verges get the weight.
          if ((cov === 'cleared' || cov === 'urban' || cov === 'rehab') && r1 < 0.22) {
            ambient.macropod.push({ x, z, y: h, seed: hash3(SEED + 11, i, j) });
          }
          // Swamp wallaby: dense cover, and it comes out to the edges at dusk.
          if ((cov === 'heath' || cov === 'forest' || cov === 'swamp') && r1 > 0.985) {
            ambient.wallaby.push({ x, z, y: h, seed: hash3(SEED + 23, i, j) });
          }
          // Lace monitor: forest and the township interface, which is why it turns up at a table.
          if ((cov === 'forest' || cov === 'urban' || cov === 'cleared') && r1 > 0.9955) {
            ambient.goanna.push({ x, z, y: h, seed: hash3(SEED + 37, i, j) });
          }
        } else {
          // The seagrass depth band the marine system uses: bay side, 0.4 m to 6.5 m of water.
          const depth = seaLevel - h;
          const bay = island.bayness(x, z);
          if (bay > 0.5 && depth > 0.4 && depth < 6.5) {
            if (r1 < 0.055) ambient.dugong.push({ x, z, depth, seed: hash3(SEED + 51, i, j) });
            if (r1 > 0.955) ambient.turtle.push({ x, z, depth, seed: hash3(SEED + 67, i, j) });
          }
        }
      }
    }
    // Pull the macropods toward the sealed road verges, which is where the pack says they graze
    // and where they get hit. Nothing invented: the roads come from the road network.
    if (roadPts.length) {
      for (const m of ambient.macropod) {
        let bd = 1e9, bx = 0, bz = 0;
        for (let i = 0; i < roadPts.length; i += 3) {
          const p = roadPts[i];
          const d = (p[0] - m.x) * (p[0] - m.x) + (p[1] - m.z) * (p[1] - m.z);
          if (d < bd) { bd = d; bx = p[0]; bz = p[1]; }
        }
        m.roadM = Math.sqrt(bd);
        if (m.roadM < 260) {
          const t = 0.55 + m.seed * 0.35;
          m.x = lerp(m.x, bx, t * (1 - m.roadM / 260));
          m.z = lerp(m.z, bz, t * (1 - m.roadM / 260));
          m.y = island.height(m.x, m.z);
        }
      }
    }
    state.notes.push(`${ambient.macropod.length} kangaroo places, ${ambient.wallaby.length} wallaby, `
      + `${ambient.goanna.length} goanna, ${ambient.dugong.length} dugong and ${ambient.turtle.length} `
      + 'turtle places drawn once off the heightfield land cover on a 160 m lattice. None of these is '
      + 'a count: no island population is published for any of them.');
  }

  // Raptor circuits: white-bellied sea-eagles and ospreys work the headland, the bay shore and the
  // lakes. The anchors are places in data/places.json, and nothing else is placed.
  function raptorCircuits(w) {
    const list = (w.data && w.data.places && w.data.places.places) || [];
    const want = [
      ['point-lookout-headland', 'seaEagle', 190],
      ['blue-lake', 'seaEagle', 150],
      ['amity-point', 'osprey', 130],
      ['one-mile-jetty', 'osprey', 120],
      ['myora-springs', 'seaEagle', 140],
      ['polka-point', 'osprey', 110]
    ];
    for (let i = 0; i < want.length; i++) {
      const [id, kind, alt] = want[i];
      const p = list.find((q) => q.id === id);
      if (!p || !Number.isFinite(p.lon)) continue;
      const xz = island.project(p.lon, p.lat);
      ambient.raptor.push({
        x: xz.x, z: xz.z, kind, alt,
        radius: 220 + hash2(SEED + 91, i) * 300,
        phase: hash2(SEED + 93, i) * TAU,
        rate: 0.055 + hash2(SEED + 97, i) * 0.045,
        label: p.name
      });
    }
  }

  /* ---- shorebird flats --------------------------------------------------

  For each roost, a set of points on the intertidal within reach of it, taken off the heightfield.
  A bird feeds where the flat is out of the water and roosts above the line the tide is at now,
  which is exactly the relationship the shorebird system models. */

  function buildFlats(sbState) {
    if (!sbState || !Array.isArray(sbState.roosts) || !sbState.roosts.length) return false;
    const g = island.grid;
    for (const r of sbState.roosts) {
      const pts = [];
      const R = 900;
      const step = 24;
      for (let dz = -R; dz <= R; dz += step) {
        for (let dx = -R; dx <= R; dx += step) {
          if (dx * dx + dz * dz > R * R) continue;
          const x = r.x + dx, z = r.z + dz;
          const h = island.height(x, z);
          // The intertidal band plus a strip of dry sand above it for the high-tide roost.
          if (h < seaLevel - 2.4 || h > seaLevel + 1.6) continue;
          if (hash3(SEED + 7, (x / 24) | 0, (z / 24) | 0) > 0.34) continue;
          pts.push(x, z, h);
        }
      }
      ambient.flats.set(r.id, { pts: new Float32Array(pts), n: pts.length / 3, x: r.x, z: r.z });
    }
    let total = 0;
    for (const f of ambient.flats.values()) total += f.n;
    state.notes.push(`${total} points of intertidal sampled off the heightfield around ${ambient.flats.size} `
      + 'roosts. Birds feed on the ones the tide has left dry and roost above the line it is at now.');
    return true;
  }

  /* ---- render-side animal state ----------------------------------------- */

  // Whale pods, keyed by the id the whales system gives them, dead reckoned between the hourly
  // republish so a pod moves smoothly rather than teleporting five kilometres an hour.
  const pods = new Map();
  let lastActionText = null;

  function podFor(p) {
    let r = pods.get(p.id);
    if (!r) {
      r = {
        id: p.id, x: p.x, z: p.z, tx: p.x, tz: p.z, yaw: p.heading === 'north' ? 0 : Math.PI,
        animals: [], action: null, actionT: 0, actionKind: 0, bout: 0, nextAction: 6 + hash2(SEED, p.id) * 24,
        seed: hash2(SEED + 3, p.id)
      };
      pods.set(p.id, r);
    }
    // Roles: a southbound cow with a calf, with escorts behind. Sizes are the published adult and
    // newborn lengths for the species, not island measurements.
    if (r.animals.length !== p.size) {
      r.animals.length = 0;
      for (let i = 0; i < p.size; i++) {
        const calf = p.calf && i === 1;
        r.animals.push({
          calf,
          lenM: calf ? 4.4 : (i === 0 ? 14.5 : 13.0),
          ox: calf ? 5.0 : (i === 0 ? 0 : ((i % 2) ? -9 : 9)),
          oz: calf ? -6.0 : (i === 0 ? 0 : -14 - i * 7),
          phase: hash3(SEED + 5, p.id, i) * TAU,
          cycle: 19 + hash3(SEED + 9, p.id, i) * 11,
          subm: 1, blown: false, flukeUp: 0
        });
      }
    }
    return r;
  }

  world.bus.on('whales:sighting', (e) => {
    // The whales system decided something worth the walk happened. Make the nearest pod do it, so
    // the notification and the water agree with each other.
    if (!e || !Number.isFinite(e.x)) return;
    let best = null, bd = 1e9;
    for (const r of pods.values()) {
      const d = (r.x - e.x) * (r.x - e.x) + (r.z - e.z) * (r.z - e.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best || bd > 2500 * 2500) return;
    const what = String(e.what || '');
    best.action = 'go';
    best.actionT = 0;
    best.actionKind = /breach/.test(what) ? 1 : /pec/.test(what) ? 2 : /tail/.test(what) ? 3 : 1;
    best.bout = best.actionKind === 1 ? 1 : 4 + Math.floor(hash2(SEED + 13, best.id) * 8);
    lastActionText = what;
    state.lastSurfaceAction = {
      what, from: e.from || null, distanceKm: e.distanceKm ?? null, time: world.clock.format()
    };
  });

  // Roost lifts. The shorebird system emits one every time a flat goes up, and this is the only
  // place the cost of that is visible.
  const flushes = new Map();
  world.bus.on('shorebirds:flush', (e) => {
    if (!e || !e.roost) return;
    flushes.set(e.roost, { t: 0, source: e.source || 'a disturbance', life: 26 + hash2(SEED + 17, flushes.size) * 16 });
    state.lastFlush = { roost: e.roost, label: e.label || e.roost, source: e.source || null, time: world.clock.format() };
  });

  // Entanglement. The whales system routes this to the state stranding hotline; here it puts a
  // trailing float on the animal so a player can see which one it is.
  const entangled = new Set();
  world.bus.on('wildlife:call', (e) => {
    if (e && /whale/i.test(e.species || '') && Number.isFinite(e.x)) entangled.add(Math.round(e.z / 40));
  });

  /* ---- through-water land occlusion ------------------------------------

  A dugong on the western banks must not be visible through the island from the Gorge walk. Six
  height samples along the ray answer that for about a microsecond an animal, and the answer is
  cached and refreshed on a rolling budget. */

  const occCache = new Map();
  let occCursor = 0;
  function occluded(camX, camY, camZ, x, y, z, key) {
    const c = occCache.get(key);
    if (c !== undefined && c.f > occCursor - 40) return c.v;
    let v = false;
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      const sx = camX + (x - camX) * t;
      const sz = camZ + (z - camZ) * t;
      const sy = camY + (y - camY) * t;
      if (island.height(sx, sz) > sy + 1.0) { v = true; break; }
    }
    occCache.set(key, { v, f: occCursor });
    return v;
  }

  /* ---- frame ------------------------------------------------------------ */

  let clockT = 0;
  const camPos = new B.Vector3();
  const vUp = new B.Vector3(0, 1, 0);
  let built = false;
  const drawn = state.drawn;

  const layer = stage.addLayer({
    id: 'fauna',
    order: 45,       // after the flora, before the info overlays

    init(st, w) {
      ambientPlaces(w);
      raptorCircuits(w);
      // A render layer is registered before world.boot(), so the shorebird system has not placed
      // its roosts yet. Wait for it to say so rather than sampling an empty list.
      if (!buildFlats(w.read('shorebirds'))) {
        w.bus.on('shorebirds:ready', () => buildFlats(w.read('shorebirds')));
      }
      built = true;
      let tris = 0;
      for (const r of S.values()) tris += r.tris;
      state.ready = true;
      state.rendered = true;
      state.meshes = meshCount;
      state.renderer = SPECIES.length + ' species as thin instances over ' + meshCount
        + ' meshes, ' + tris + ' triangles of source geometry, three deformation models in one shader';
      console.info('[fauna] built in ' + Math.round(performance.now() - t0) + ' ms: '
        + SPECIES.length + ' species, ' + meshCount + ' meshes, ' + tris + ' triangles');
    },

    frame(st, w, dt) {
      if (!built) return;
      const d = Math.min(0.1, dt || 0.016);
      clockT += d;
      occCursor++;
      const cam = st.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      const camX = camPos.x, camY = camPos.y, camZ = camPos.z;

      /* --- the light, on the same expressions the terrain, ocean and flora use, so an animal
             never disagrees with the ground or the water it is on. --- */
      const dl = w.read('daylight');
      const wx = w.read('weather');
      const alt = dl && Number.isFinite(dl.altitude) ? dl.altitude : 0.9;
      const az = dl && Number.isFinite(dl.azimuth) ? dl.azimuth : Math.PI * 0.25;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF, 0.4);

      // Turbidity. The marine system carries a flood plume out of the mainland catchment, and when
      // it is up you stop being able to see anything under the water. That is the real thing.
      const mr = w.read('marine');
      const turb = mr && mr.seagrass ? clamp(mr.seagrass.turbidity, 0, 1) : 0;
      state.turbidity = +turb.toFixed(3);
      const ext = 0.14 + turb * 0.85;
      const seaHere = waterAt(camX, camZ);
      vWater.set(seaHere, 1, ext, 0.55 + 0.35 * (wx ? clamp(1 - wx.cloud, 0, 1) : 0.6));

      for (const rec of S.values()) rec.n = 0;
      shapeN = 0;

      /* --- the whales --------------------------------------------------- */
      drawWhales(w, camX, camY, camZ, d, wx);

      /* --- everything else in the water --------------------------------- */
      drawMarine(w, camX, camY, camZ, d);

      /* --- the land ----------------------------------------------------- */
      drawKoalas(w, camX, camY, camZ);
      drawAmbientLand(w, camX, camY, camZ);
      drawShorebirds(w, camX, camY, camZ, d);
      drawRaptors(w, camX, camY, camZ, d);

      /* --- vapour, foam and surface marks -------------------------------- */
      stepPuffs(d, wx);
      stepMarks(d);

      /* --- upload -------------------------------------------------------- */
      let instances = 0;
      for (const rec of S.values()) {
        const n = rec.n;
        rec.mesh.setEnabled(n > 0);
        rec.mesh.thinInstanceCount = n;
        if (n > 0) {
          rec.mesh.thinInstancePartialBufferUpdate('matrix', rec.mBuf.subarray(0, n * 16), 0);
          rec.mesh.thinInstancePartialBufferUpdate('aAnim', rec.aBuf.subarray(0, n * 4), 0);
          rec.mesh.thinInstancePartialBufferUpdate('aTint', rec.tBuf.subarray(0, n * 4), 0);
          const m = rec.mat;
          m.setVector3('uCam', camPos);
          m.setVector4('uSun', vSun);
          m.setVector4('uSunCol', vSunCol);
          m.setVector4('uSky', vSky);
          m.setVector4('uSkyHz', vSkyHz);
          m.setVector4('uWater', rec.sp.water ? vWater : vDry);
        }
        instances += n;
      }
      state.instances = instances;
      puffMat.setVector3('uCam', camPos);
      puffMat.setVector3('uUp', vUp);
      puffMat.setVector4('uSunCol', vSunCol);
      puffMat.setVector4('uSky', vSky);
      puffMat.setVector4('uSkyHz', vSkyHz);
      markMat.setVector3('uCam', camPos);
      markMat.setVector4('uSunCol', vSunCol);
      markMat.setVector4('uSky', vSky);
      markMat.setVector4('uSkyHz', vSkyHz);
      markMat.setFloat('uTime', clockT);
    },

    dispose() {
      for (const rec of S.values()) { rec.mesh.material.dispose(); rec.mesh.dispose(); }
      puffMesh.dispose(); markMesh.dispose();
    }
  });

  /* ================================================================ whales */

  function drawWhales(w, camX, camY, camZ, d, wx) {
    const rec = S.get('humpback');
    const wh = w.read('whales');
    drawn.whalePods = 0; drawn.whales = 0; drawn.entangled = 0; drawn.blows = 0;
    if (!wh || !wh.ready || !Array.isArray(wh.pods)) return;
    state.sightingRangeKm = wh.sightingRangeKm;

    const windTh = ((wx ? wx.windDirDeg : 110) + 180) * Math.PI / 180;
    const windX = Math.sin(windTh), windZ = Math.cos(windTh);
    const windMs = (wx ? wx.windKt : 10) * 0.514;
    const seen = new Set();

    for (const p of wh.pods) {
      seen.add(p.id);
      const r = podFor(p);
      // Dead reckoning between republishes. The system moves a pod along its corridor at a known
      // speed and heading, so the renderer can carry it forward and ease onto the new fix rather
      // than jumping to it.
      r.tx = p.x; r.tz = p.z;
      const dirZ = p.heading === 'north' ? 1 : -1;
      const v = (p.speedKmh / 3.6);
      r.z += dirZ * v * d;
      const dz = r.tz - r.z, dx = r.tx - r.x;
      if (Math.abs(dz) > 500 || Math.abs(dx) > 500) { r.z = r.tz; r.x = r.tx; }
      else { r.z += dz * Math.min(1, d * 0.6); r.x += dx * Math.min(1, d * 0.9); }
      r.yaw = dirZ > 0 ? 0 : Math.PI;

      const distToCam = Math.hypot(r.x - camX, r.z - camZ);
      // The ocean layer displaces its surface by the swell, and the tide system's height is the
      // still water level underneath that. An animal placed on the still level sits inside the
      // wave crests and is occluded by its own sea, so it rides the swell like everything else
      // floating in it.
      const wlev = waterAt(r.x, r.z) + (wx ? wx.swellM : 1) * 0.75 + 0.45;

      /* --- what the pod is doing ------------------------------------- */
      const surfacing = !!p.surfacing && !p.pushedOffshore;
      if (p.behaviour === 'surface active' && !p.pushedOffshore) {
        r.nextAction -= d;
        if (r.nextAction <= 0 && !r.action) {
          // Real rates: a competitive group breaches or pec slaps in bouts, a lone animal less
          // often. Which action is drawn from the pod's own composition, which is what decides it.
          const u = hash3(SEED + 19, r.id, Math.floor(clockT));
          r.action = 'go'; r.actionT = 0;
          r.actionKind = p.escorts >= 2 ? (u < 0.42 ? 2 : u < 0.72 ? 1 : 3)
            : p.calf ? (u < 0.34 ? 1 : u < 0.62 ? 3 : 4)
              : (u < 0.30 ? 1 : u < 0.60 ? 3 : u < 0.85 ? 2 : 4);
          r.bout = r.actionKind === 1 ? 1 : r.actionKind === 4 ? 1 : 3 + Math.floor(u * 9);
          r.nextAction = 14 + u * 46;
        }
      } else if (!r.action) {
        r.nextAction = Math.max(r.nextAction, 8);
      }

      const ACTION_LEN = [0, 2.7, 1.45, 1.65, 4.2, 3.6];
      if (r.action) {
        r.actionT += d;
        if (r.actionT >= ACTION_LEN[r.actionKind]) {
          r.bout--;
          r.actionT = 0;
          if (r.bout <= 0) { r.action = null; r.actionKind = 0; }
        }
      }

      if (distToCam > 14000) continue;   // even a blow does not carry that far
      drawn.whalePods++;

      /* --- each animal in the pod ------------------------------------ */
      for (let ai = 0; ai < r.animals.length; ai++) {
        const a = r.animals[ai];
        const cs = Math.cos(r.yaw), sn = Math.sin(r.yaw);
        const ax = r.x + a.ox * cs + a.oz * sn;
        const az = r.z - a.ox * sn + a.oz * cs;
        const len = a.lenM;

        // Surfacing. A travelling humpback blows every few minutes and stays up for some of it,
        // which is what the whales system's `surfacing` flag carries. Between blows the animal is
        // a shape under the water, and that shape is what tells you to keep watching.
        const cyc = (clockT / a.cycle + a.phase) % 1;
        let target;
        if (surfacing) target = 0.02 + 0.32 * smoothstep(0.16, 0.62, cyc) * smoothstep(1.0, 0.72, cyc);
        else target = 0.72 + 0.22 * Math.sin(clockT * 0.11 + a.phase);
        a.subm += (target - a.subm) * Math.min(1, d * 1.4);

        let pitch = 0, roll = 0, y = wlev - a.subm * len * 0.42, arch = 0, fluke = 0, pec = 0;
        const actT = r.action ? r.actionT / ACTION_LEN[r.actionKind] : 0;

        // The mother leads and the calf goes with her; the escorts do their own thing.
        const acting = r.action && (ai === 0 || (a.calf && r.actionKind !== 2) || hash3(SEED + 29, r.id, ai) < 0.4);
        if (acting) {
          if (r.actionKind === 1) {
            // A breach. About two thirds of the animal comes clear, it turns onto its back, and
            // it lands on its side. This is the reason anyone stands on the Gorge walk.
            const up = Math.sin(Math.PI * clamp(actT * 1.15, 0, 1));
            y = wlev + up * len * 0.52 - a.subm * len * 0.12;
            pitch = -1.05 * up;
            roll = 1.5 * smoothstep(0.45, 1.0, actT);
            pec = 0.8 * up;
            if (actT > 0.88 && !a.splashed) {
              a.splashed = true;
              whitewater(ax, az, wlev, len * 0.95, 1.0);
            }
            if (actT < 0.2) a.splashed = false;
          } else if (r.actionKind === 2) {
            // Pec slapping: rolled onto one side with one five metre pectoral in the air, and it
            // goes on for a dozen slaps at a time.
            roll = 1.45;
            pec = 1.15 * Math.sin(actT * Math.PI);
            y = wlev - len * 0.06;
            if (actT > 0.80 && !a.splashed) { a.splashed = true; whitewater(ax + 3, az, wlev, len * 0.35, 0.55); }
            if (actT < 0.2) a.splashed = false;
          } else if (r.actionKind === 3) {
            // Lobtailing: the flukes come clear and come down hard.
            fluke = -1.5 * Math.sin(actT * Math.PI);
            arch = 0.9;
            y = wlev - len * 0.10;
            if (actT > 0.78 && !a.splashed) { a.splashed = true; whitewater(ax - Math.sin(r.yaw) * len * 0.4, az - Math.cos(r.yaw) * len * 0.4, wlev, len * 0.42, 0.7); }
            if (actT < 0.2) a.splashed = false;
          } else if (r.actionKind === 4) {
            // Spy hop: straight up, head clear, having a look at the people on the headland.
            const up = Math.sin(Math.PI * clamp(actT, 0, 1));
            pitch = -1.35 * up;
            y = wlev + up * len * 0.20 - len * 0.30;
          }
        } else if (a.subm < 0.10) {
          // At the surface between blows the back rolls through and the hump breaks the water.
          arch = 0.25 + 0.25 * Math.sin(clockT * 1.1 + a.phase);
        }

        // The blow. Fires as the animal comes up, and it is the thing you actually see at range.
        if (a.subm < 0.09 && !a.blown && surfacing) {
          a.blown = true;
          const bx = ax + Math.sin(r.yaw) * len * 0.32;
          const bz = az + Math.cos(r.yaw) * len * 0.32;
          const h = a.calf ? 1.6 : 3.2;
          for (let q = 0; q < 7; q++) {
            const s = q / 6;
            emitPuff(
              bx + (hash3(SEED + 31, r.id, q) - 0.5) * 0.8,
              wlev + 0.4 + s * h,
              bz + (hash3(SEED + 33, r.id, q) - 0.5) * 0.8,
              windX * windMs * 0.55 + (hash3(SEED + 35, r.id, q + 9) - 0.5) * 1.2,
              2.6 + s * 2.4,
              windZ * windMs * 0.55 + (hash3(SEED + 39, r.id, q + 3) - 0.5) * 1.2,
              3.4 + s * 1.6, 0.9 + s * 0.9, 5.5 + s * 4.5, 0.06, 0.92 - s * 0.24
            );
          }
          drawn.blows++;
        }
        if (a.subm > 0.22) a.blown = false;

        // A fluke-up dive on the way down, which is the other picture people wait for.
        if (!r.action && a.subm > 0.30 && a.subm < 0.62 && !a.calf) {
          const k = smoothstep(0.30, 0.52, a.subm) * smoothstep(0.62, 0.50, a.subm);
          fluke = -1.25 * k;
          arch = 0.85 * k;
        }

        // Wake. A travelling animal near the surface drags a foam trail behind it.
        if (a.subm < 0.24 && distToCam < 3500 && hash3(SEED + 41, r.id, Math.floor(clockT * 4) + ai) < 0.34 * d * 60) {
          emitMark(ax - Math.sin(r.yaw) * len * 0.5, wlev + 0.06, az - Math.cos(r.yaw) * len * 0.5,
            r.yaw, len * 0.30, 1.9, 5.5, 0, 2.4, 0.32);
        }

        // The mesh is one unit nose to flukes, so the scale is the animal's length in metres.
        // Under the surface: a dark shape lying in the water, which from the Gorge walk is what
        // tells you to keep watching that patch. It grows and softens as the animal goes down.
        if (a.subm > 0.10 && distToCam < 2600) {
          pushShape(ax, wlev + 0.35, az, r.yaw, len, a.subm * len * 0.55, 0.14 + 0.85 * (state.turbidity || 0));
        }
        const scale = len / rec.unit;
        const fade = clamp(1 - (distToCam - rec.sp.range) / 2200, 0, 1);
        if (fade > 0.02 && distToCam < rec.sp.range + 2200) {
          put(rec, ax, y, az, r.yaw, pitch, roll, scale,
            clockT * 1.4 + a.phase, arch, fluke, pec,
            1, 1, 1, fade);
          drawn.whales++;
          if (p.entangled) {
            drawn.entangled++;
            // The trailing gear, so a player can tell which animal the call is about.
            emitMark(ax - Math.sin(r.yaw) * len * 0.75, wlev + 0.05, az - Math.cos(r.yaw) * len * 0.75,
              r.yaw, 2.2, 1.0, 0.6, 0, 1.4, 0.5);
          }
        }
      }
    }
    for (const id of pods.keys()) if (!seen.has(id)) pods.delete(id);
    drawn.breaches = 0;
    for (const r of pods.values()) if (r.action && r.actionKind === 1) drawn.breaches++;
  }

  /** A body hitting the water. Foam scar, then the spray that comes off it. */
  function whitewater(x, z, wlev, size, force) {
    emitMark(x, wlev + 0.08, z, 0, size * 0.9, 2.3, 4.5, 0, 1.0, 0.85 * force);
    const n = Math.round(10 + force * 16);
    for (let q = 0; q < n; q++) {
      const a = hash3(SEED + 43, q, Math.floor(x)) * TAU;
      const sp2 = 3 + hash3(SEED + 45, q, Math.floor(z)) * 9 * force;
      emitPuff(x, wlev + 0.6, z,
        Math.cos(a) * sp2, 4 + hash3(SEED + 47, q, 7) * 9 * force, Math.sin(a) * sp2,
        1.5 + hash3(SEED + 49, q, 3) * 1.4, size * 0.14, size * 0.42, 0.95, 0.85 * force);
    }
  }

  /* ================================================================ marine */

  function drawMarine(w, camX, camY, camZ, d) {
    const mr = w.read('marine');
    const wxm = w.read('weather');
    const swellLift = (wxm ? wxm.swellM : 1) * 0.75 + 0.45;
    drawn.dolphins = 0; drawn.dugong = 0; drawn.turtles = 0;
    drawn.mantas = 0; drawn.sharks = 0; drawn.mullet = 0;
    if (!mr || !mr.ready) return;
    const clock = w.clock;

    /* --- dolphins. Pods move about a home range once a day, so the renderer walks them along
           a smooth path between fixes and porpoises the animals through the surface. --- */
    const rd = S.get('dolphin');
    if (mr.dolphins && Array.isArray(mr.dolphins.pods)) {
      for (const p of mr.dolphins.pods) {
        const dist = Math.hypot(p.x - camX, p.z - camZ);
        if (dist > rd.sp.range + 900) continue;
        const wlev = waterAt(p.x, p.z) + swellLift;
        const key = 'dp' + p.id;
        if (occluded(camX, camY, camZ, p.x, wlev, p.z, key)) continue;
        const seed = hash2(SEED + 53, p.x | 0);
        // The pod mills about its published fix rather than sitting on it.
        const drift = clockT * 0.06 + seed * TAU;
        const cx = p.x + Math.cos(drift) * 90;
        const cz = p.z + Math.sin(drift * 0.83) * 90;
        const head = Math.atan2(-Math.sin(drift) * 90 * 0.06, Math.cos(drift * 0.83) * 90 * 0.06 * 0.83) + Math.PI / 2;
        const n = Math.min(p.size, 14);
        for (let i = 0; i < n; i++) {
          const h1 = hash3(SEED + 55, p.x | 0, i);
          const h2 = hash3(SEED + 57, p.z | 0, i);
          const ox = (h1 - 0.5) * 26, oz = (h2 - 0.5) * 26;
          const x = cx + ox * Math.cos(head) + oz * Math.sin(head);
          const z = cz - ox * Math.sin(head) + oz * Math.cos(head);
          // Porpoising: the animal arcs clear of the water and goes back in.
          const ph = (clockT * 0.42 + h1 * 3 + i * 0.21) % 1;
          const up = Math.sin(ph * Math.PI * 2);
          const clear = up > 0.55 ? (up - 0.55) / 0.45 : 0;
          const y = wlev + clear * 0.55 - (1 - clear) * 0.75;
          const pitch = -0.7 * Math.cos(ph * Math.PI * 2) * clear;
          if (clear > 0.75 && hash3(SEED + 59, i, Math.floor(clockT * 3)) < 0.25) {
            emitMark(x, wlev + 0.05, z, head, 1.4, 2.0, 1.8, 0, 1.6, 0.5);
          }
          const fade = clamp(1 - (dist - rd.sp.range) / 900, 0, 1);
          if (clear < 0.2 && dist < 900) pushShape(x, wlev + 0.3, z, head, 2.6, 0.8, 0.14 + 0.85 * (state.turbidity || 0));
          put(rd, x, y, z, head, pitch, 0, rd.lengthM / rd.unit,
            clockT * 3.1 + h1 * 6, 0.1, 0, 0, 1, 1, 1, fade);
          drawn.dolphins++;
        }
      }
    }

    /* --- dugong. Herds on the seagrass, and they have to come up to breathe. --- */
    const rdu = S.get('dugong');
    const dug = mr.dugong;
    if (dug && ambient.dugong.length) {
      // How many of the modelled bay population are on the banks right now, spread over the
      // places the depth band allows. The count comes from the marine system; the places do not.
      const onBanks = dug.onEasternBanks || 0;
      const wantDraw = Math.min(rdu.cap, Math.round(onBanks * 0.35));
      let placed = 0;
      for (let i = 0; i < ambient.dugong.length && placed < wantDraw; i++) {
        const s = ambient.dugong[i];
        const dist = Math.hypot(s.x - camX, s.z - camZ);
        if (dist > rdu.sp.range) continue;
        const wlev = waterAt(s.x, s.z);
        if (occluded(camX, camY, camZ, s.x, wlev - s.depth * 0.5, s.z, 'du' + i)) continue;
        // Grazing: a slow wander over the patch, and a breath about every four minutes.
        const t = clockT * 0.05 + s.seed * TAU;
        const x = s.x + Math.cos(t) * 55;
        const z = s.z + Math.sin(t * 1.31) * 55;
        const breath = (clockT / 240 + s.seed) % 1;
        const up = breath > 0.94 ? smoothstep(0.94, 0.97, breath) * smoothstep(1.0, 0.975, breath) : 0;
        const bottom = wlev - Math.max(0.9, s.depth - 0.5);
        const y = lerp(bottom, wlev - 0.25, up);
        if (up > 0.7 && hash3(SEED + 61, i, Math.floor(clockT)) < 0.2) {
          emitPuff(x, wlev + 0.3, z, 0, 1.6, 0, 1.1, 0.25, 0.9, 0.2, 0.55);
        }
        const yaw = Math.atan2(-Math.sin(t) * 0.05, Math.cos(t * 1.31) * 1.31 * 0.05) + Math.PI / 2;
        const fade = clamp(1 - (dist - rdu.sp.range * 0.7) / (rdu.sp.range * 0.3), 0, 1);
        if (fade <= 0.02) continue;
        pushShape(x, wlev + 0.3, z, yaw, 2.9, wlev - y, 0.14 + 0.85 * (state.turbidity || 0));
        put(rdu, x, y, z, yaw, -0.18 + up * 0.30, 0, rdu.lengthM / rdu.unit,
          clockT * 1.3 + s.seed * 9, 0, 0, 0, 1, 1, 1, fade);
        drawn.dugong++;
        placed++;
      }
    }

    /* --- green turtles on the same meadows. --- */
    const rt = S.get('turtle');
    if (mr.turtles && mr.turtles.green && ambient.turtle.length) {
      const feeding = mr.turtles.green.feedingPopulation || 0;
      const wantDraw = Math.min(rt.cap, Math.round(feeding * 0.12));
      let placed = 0;
      for (let i = 0; i < ambient.turtle.length && placed < wantDraw; i++) {
        const s = ambient.turtle[i];
        const dist = Math.hypot(s.x - camX, s.z - camZ);
        if (dist > rt.sp.range) continue;
        const wlev = waterAt(s.x, s.z);
        if (occluded(camX, camY, camZ, s.x, wlev - s.depth * 0.5, s.z, 'tu' + i)) continue;
        const t = clockT * 0.09 + s.seed * TAU;
        const x = s.x + Math.cos(t) * 40;
        const z = s.z + Math.sin(t * 1.17) * 40;
        const breath = (clockT / 95 + s.seed) % 1;
        const up = breath > 0.9 ? smoothstep(0.90, 0.95, breath) * smoothstep(1.0, 0.96, breath) : 0;
        const y = lerp(wlev - Math.max(0.6, s.depth - 0.4), wlev - 0.10, up);
        const yaw = t * 0.9;
        const fade = clamp(1 - (dist - rt.sp.range * 0.7) / (rt.sp.range * 0.3), 0, 1);
        if (fade <= 0.02) continue;
        pushShape(x, wlev + 0.28, z, yaw, 1.4, wlev - y, 0.14 + 0.85 * (state.turbidity || 0));
        put(rt, x, y, z, yaw, -0.1, Math.sin(t * 2) * 0.2, rt.lengthM / rt.unit,
          clockT * 1.4 + s.seed * 7, 0, 0, rt.flapWing * Math.sin(clockT * 1.4 + s.seed * 7),
          1, 1, 1, fade);
        drawn.turtles++;
        placed++;
      }
    }

    /* --- the two reefs. Manta Bommie in the warm months, Flat Rock's grey nurse aggregation in
           winter. Both are the marine system's own presence figure, so a crowded dive site
           empties out and you can see it happen. --- */
    for (const reef of (mr.reefs || [])) {
      const isManta = reef.species === 'reef manta ray';
      const rec = S.get(isManta ? 'manta' : 'shark');
      const dist = Math.hypot(reef.x - camX, reef.z - camZ);
      if (dist > rec.sp.range + 400) continue;
      const wlev = waterAt(reef.x, reef.z);
      const bed = island.height(reef.x, reef.z);
      const n = Math.round(clamp(reef.presence, 0, 1) * (isManta ? 9 : 16));
      for (let i = 0; i < n; i++) {
        const h1 = hash3(SEED + 63, i, isManta ? 1 : 2);
        const h2 = hash3(SEED + 65, i, isManta ? 3 : 4);
        // Mantas circle the cleaning station; grey nurse hang in the gutter facing the current.
        const t = clockT * (isManta ? 0.10 : 0.035) + h1 * TAU;
        const rr = 22 + h2 * (isManta ? 40 : 26);
        const x = reef.x + Math.cos(t) * rr;
        const z = reef.z + Math.sin(t) * rr;
        const depth = isManta ? lerp(3, 15, h1) : lerp(6, 22, h2);
        const y = Math.max(bed + 0.8, wlev - depth);
        if (occluded(camX, camY, camZ, x, y, z, (isManta ? 'mr' : 'gn') + i)) continue;
        const yaw = t + Math.PI / 2;
        const fade = clamp(1 - (dist - rec.sp.range * 0.6) / (rec.sp.range * 0.4), 0, 1);
        if (fade <= 0.02) continue;
        pushShape(x, wlev + 0.3, z, yaw, isManta ? 3.5 : 2.7, wlev - y, 0.14 + 0.85 * (state.turbidity || 0));
        put(rec, x, y, z, yaw, isManta ? -0.05 : 0, Math.sin(t * 1.7) * 0.18,
          rec.lengthM / rec.unit,
          clockT * (isManta ? 1.0 : 1.5) + h1 * 8, 0, 0, 0, 1, 1, 1, fade);
        if (isManta) drawn.mantas++; else drawn.sharks++;
      }
    }

    /* --- the mullet run. Winter, along the beaches, in visible dark patches. Standing on the
           sand and watching one go past is a thing people on this island do. --- */
    const rm = S.get('mullet');
    const run = (mr.runs || []).find((r) => r.id === 'sp-sea-mullet');
    if (run && run.strength > 0.3) {
      // Schools track the ocean beaches northward. Anchor them on the east coast at the camera's
      // latitude so a player standing on Main Beach sees the run rather than reading about it.
      const nSchools = Math.round(run.strength * 5);
      for (let s = 0; s < nSchools; s++) {
        const seed = hash2(SEED + 69, s);
        const zBase = camZ + (seed - 0.5) * 2600;
        // Walk east from the camera to the waterline, then a little way out into the surf.
        let sx = camX, found = false;
        for (let step = 0; step < 220; step++) {
          const x = camX - 900 + step * 12;
          if (island.height(x, zBase) < seaLevel - 1.2) { sx = x + 40; found = true; break; }
        }
        if (!found) continue;
        const drift = ((clockT * 0.9 + seed * 900) % 3000) - 1500;
        const cz = zBase + drift;
        const wlev = waterAt(sx, cz);
        const dist = Math.hypot(sx - camX, cz - camZ);
        if (dist > 700) continue;
        // The dark stain first: that is what you see from the sand.
        emitMark(sx, wlev + 0.04, cz, 0, 22 + seed * 20, 1.0, 0.5, 1, 2.6, 0.55 * run.strength);
        if (dist > rm.sp.range) continue;
        const n = Math.min(rm.cap - rm.n, 90);
        for (let i = 0; i < n; i++) {
          const h1 = hash3(SEED + 71, s, i);
          const h2 = hash3(SEED + 73, s, i + 200);
          const x = sx + (h1 - 0.5) * 34;
          const z = cz + (h2 - 0.5) * 60;
          const y = wlev - 0.35 - h1 * 0.9;
          put(rm, x, y, z, 0.05 + Math.sin(clockT * 0.5 + h2 * 6) * 0.2, 0, 0, rm.lengthM / rm.unit,
            clockT * 6 + h1 * 20, 0, 0, 0, 1, 1, 1, 1);
          drawn.mullet++;
        }
      }
    }
  }

  /* ================================================================ koalas */

  function drawKoalas(w, camX, camY, camZ) {
    const rec = S.get('koala');
    const kl = w.read('koala');
    drawn.koalas = 0; drawn.koalasOnGround = 0; drawn.koalasNearSealedRoad = 0;
    if (!kl || !kl.ready) return;
    const map = w.store.all('koala');
    if (!map || map.size === 0) return;
    const roads = w.read('roadNetwork');
    const range = rec.sp.range;
    const r2 = (range + 220) * (range + 220);

    for (const [, a] of map) {
      if (a.dead) continue;
      const dx = a.x - camX, dz = a.z - camZ;
      const dd = dx * dx + dz * dz;
      if (dd > r2) continue;
      const dist = Math.sqrt(dd);
      const ground = island.height(a.x, a.z);
      const cov = island.landCover(a.x, a.z);
      // Canopy height by community. A high dune eucalypt forest carries a fifteen metre canopy;
      // the wallum heath behind the foredune is wind pruned to a couple of metres, which is why
      // a koala in the heath is a koala you can see.
      const canopy = cov === 'forest' ? 15 : cov === 'rehab' ? 8 : cov === 'swamp' ? 9
        : cov === 'heath' ? 3.2 : cov === 'urban' || cov === 'cleared' ? 9 : 4;
      const seed = hash2(SEED + 77, a.id);
      const perch = ground + canopy * (0.52 + seed * 0.26);
      const y = a.onGround ? ground : perch;

      // A koala on the ground near the sealed road is the whole mechanic: vehicle strike is the
      // largest recorded cause of death on this island.
      let nearRoad = false;
      if (a.onGround && roads && Array.isArray(roads.edges)) {
        for (const e of roads.edges) {
          if (!e.sealed || !Array.isArray(e.pts)) continue;
          for (let i = 0; i < e.pts.length; i++) {
            const p = e.pts[i];
            if (Math.abs(p[0] - a.x) < 30 && Math.abs(p[1] - a.z) < 30) { nearRoad = true; break; }
          }
          if (nearRoad) break;
        }
      }
      if (nearRoad) drawn.koalasNearSealedRoad++;
      if (a.onGround) drawn.koalasOnGround++;

      const fade = clamp(1 - (dist - range * 0.75) / (range * 0.25 + 220), 0, 1);
      if (fade <= 0.02) continue;

      // Facing: a moving animal faces where it went, a sitting one faces out from its home tree.
      const yaw = a.moving
        ? Math.atan2(a.x - a.lastX, a.z - a.lastZ)
        : (seed * TAU);
      // A sick animal sits differently: lower, more hunched, and it moves less. The condition
      // and the chlamydia status are the koala system's, not invented here.
      const ill = a.infection === 2 ? 1 : a.infection === 1 ? 0.35 : 0;
      const cond = clamp(a.cond ?? 0.7, 0, 1);
      const tint = lerp(1.0, 0.80, ill * 0.6 + (1 - cond) * 0.35);
      const phase = clockT * (a.moving ? 3.2 : 0.45) + seed * 9;
      const bob = a.moving ? 0.055 : 0.012 * (1 - ill * 0.6);
      // A koala reaches full size at about four years, so a young one is visibly smaller.
      const grown = a.age ? clamp(a.age / (365.25 * 4), 0.62, 1) : 1;
      const scale = (rec.lengthM / rec.unit) * grown * (1 - ill * 0.04);
      put(rec, a.x, y, a.z, yaw, a.onGround ? 0.22 : -0.06 - ill * 0.12, 0, scale,
        phase, bob, a.moving ? 0.55 : 0.05, a.moving ? 0.45 : 0.04,
        tint, tint * 0.99, tint * 0.97, fade);
      drawn.koalas++;
      if (rec.n >= rec.cap) break;
    }
  }

  /* ================================================================ land ambient */

  function drawAmbientLand(w, camX, camY, camZ) {
    const clock = w.clock;
    const dl = w.read('daylight');
    const el = dl ? dl.elevationDeg : 20;
    drawn.kangaroos = 0; drawn.wallabies = 0; drawn.goannas = 0;

    // Crepuscular: the hour either side of first and last light is when a mob is on a verge.
    const dusk = clamp(1 - Math.abs(el + 2) / 12, 0, 1);
    const night = el < -6 ? 0.55 : 0;
    const macroActive = clamp(Math.max(dusk, night) * (ambient.season ? ambient.season('sp-eastern-grey-kangaroo', clock) : 0.7), 0, 1);
    const wallActive = clamp(Math.max(dusk, night * 1.2) * (ambient.season ? ambient.season('sp-swamp-wallaby', clock) : 0.7), 0, 1);
    // A lace monitor is a warm-weather animal and it is asleep for most of winter, which the
    // pack's own activity curve says plainly.
    const gActive = clamp((el > 12 ? 1 : el > 0 ? 0.4 : 0) * (ambient.season ? ambient.season('sp-lace-monitor', clock) : 0.5), 0, 1);

    drawGroup(S.get('kangaroo'), ambient.macropod, macroActive, 1.45, camX, camZ, (n) => { drawn.kangaroos = n; }, 0);
    drawGroup(S.get('wallaby'), ambient.wallaby, wallActive, 0.88, camX, camZ, (n) => { drawn.wallabies = n; }, 1);
    drawGroup(S.get('goanna'), ambient.goanna, gActive, 1.6, camX, camZ, (n) => { drawn.goannas = n; }, 2);
  }

  function drawGroup(rec, places, active, sizeM, camX, camZ, report, kindIdx) {
    let n = 0;
    if (active <= 0.02 || !places.length) { report(0); return; }
    const range = rec.sp.range;
    for (let i = 0; i < places.length; i++) {
      const s = places[i];
      const dx = s.x - camX, dz = s.z - camZ;
      const dd = dx * dx + dz * dz;
      if (dd > range * range) continue;
      // Whether this place holds an animal right now is a hash against the activity level, so
      // the same lattice point holds an animal at the same time on the same day every time.
      if (s.seed > active) continue;
      const dist = Math.sqrt(dd);
      const fade = clamp(1 - (dist - range * 0.7) / (range * 0.3), 0, 1);
      if (fade <= 0.02) continue;
      // A slow graze around the place, and a head-up freeze every so often.
      const t = clockT * 0.10 + s.seed * TAU;
      const wander = kindIdx === 2 ? 6 : 14;
      const x = s.x + Math.cos(t) * wander;
      const z = s.z + Math.sin(t * 1.27) * wander;
      const y = island.height(x, z);
      const yaw = Math.atan2(-Math.sin(t), Math.cos(t * 1.27) * 1.27) + Math.PI / 2;
      const alert = hash3(SEED + 79, i, Math.floor(clockT / 6)) < 0.25;
      const stride = alert ? 0.4 : 2.4;
      put(rec, x, y, z, yaw, 0, 0, sizeM / rec.unit,
        clockT * stride + s.seed * 11,
        alert ? 0.008 : 0.035,
        alert ? 0.05 : (kindIdx === 2 ? 0.55 : 0.42),
        alert ? 0.05 : (kindIdx === 2 ? 0.55 : 0.50),
        1, 1, 1, fade);
      n++;
      if (rec.n >= rec.cap) break;
    }
    report(n);
  }

  /* ================================================================ shorebirds */

  function drawShorebirds(w, camX, camY, camZ, d) {
    const sb = w.read('shorebirds');
    drawn.shorebirds = 0; drawn.roostsUp = 0;
    if (!sb || !sb.ready || !Array.isArray(sb.roosts)) return;
    const tide = w.read('tide');
    const feeding = /feeding/.test(sb.tidePhase || '');

    // Which species are on the flats now, from the shorebird system's own species counts.
    const bySp = new Map();
    for (const s of (sb.bySpecies || [])) bySp.set(s.id, s.count);
    const totalCounted = Array.from(bySp.values()).reduce((a, b) => a + b, 0) || 1;

    for (const r of sb.roosts) {
      const flat = ambient.flats.get(r.id);
      if (!flat || !flat.n) continue;
      const dist = Math.hypot(r.x - camX, r.z - camZ);
      if (dist > 2600) continue;

      const lift = flushes.get(r.id);
      if (lift) {
        lift.t += d;
        if (lift.t > lift.life) flushes.delete(r.id);
        else drawn.roostsUp++;
      }
      // The lift curve: up hard, wheel, and settle back over about half a minute. Coming back
      // down takes longer than going up, which is what makes repeated flushing expensive.
      const up = lift ? smoothstep(0, 1.6, lift.t) * smoothstep(lift.life, lift.life - 12, lift.t) : 0;

      const wlev = tide ? (tide.stations ? (tide.stations.amity ?? tide.height) : tide.height) : seaLevel;
      // Draw a share of the roost. The rest are counted and published, not faked into the buffer.
      const want = Math.min(600, r.birds);
      const drawShare = Math.min(want, Math.max(0, 1400 - drawn.shorebirds));
      const step = Math.max(1, Math.floor(flat.n / Math.max(1, drawShare)));

      for (let i = 0, k = 0; i < flat.n && k < drawShare; i += step, k++) {
        const fx = flat.pts[i * 3], fz = flat.pts[i * 3 + 1], fh = flat.pts[i * 3 + 2];
        // Feeding birds walk the exposed flat; roosting birds stand above the waterline.
        const exposed = fh > wlev + 0.05;
        if (feeding ? !exposed : (fh < wlev + 0.25 || fh > wlev + 1.4)) continue;
        const h1 = hash3(SEED + 81, i, 1);
        const h2 = hash3(SEED + 83, i, 2);
        // Which species stands here, in the proportions the shorebird system publishes.
        const pick = h1 * totalCounted;
        let rec = S.get('wader');
        let sizeM = 0.63, run = 0;
        let acc = 0;
        for (const [id, c] of bySp) {
          acc += c;
          if (pick <= acc) {
            if (id === 'sp-bar-tailed-godwit') { rec = S.get('godwit'); sizeM = 0.41; }
            else if (id === 'sp-pied-oystercatcher') { rec = S.get('oystercatcher'); sizeM = 0.48; }
            else if (id === 'sp-eastern-curlew') { rec = S.get('wader'); sizeM = 0.63; }
            else { rec = S.get('godwit'); sizeM = 0.30; }
            break;
          }
        }
        if (rec.n >= rec.cap) continue;

        let x = fx, z = fz, y = fh + 0.02;
        let yaw = h2 * TAU;
        let pitch = 0, roll = 0, flap = 0, wrist = 0, leg = 0, tail = 0;
        const ph = clockT * 2.0 + h1 * 12;

        if (up > 0.01) {
          // The flock leaves as one sheet, wheels out over the water, and comes back. Every bird
          // holds a place in the flock, so it reads as a flock and not as five hundred birds.
          const wheelT = lift.t;
          const cx = flat.x + Math.sin(wheelT * 0.30) * 130 * up;
          const cz = flat.z + Math.cos(wheelT * 0.30) * 130 * up;
          const height = up * (12 + h1 * 26);
          const ox = (h1 - 0.5) * 46 * (0.4 + up);
          const oz = (h2 - 0.5) * 46 * (0.4 + up);
          x = lerp(fx, cx + ox, up);
          z = lerp(fz, cz + oz, up);
          y = lerp(fh + 0.02, Math.max(wlev, fh) + height, up);
          yaw = Math.atan2(Math.cos(wheelT * 0.30), -Math.sin(wheelT * 0.30)) + h2 * 0.3;
          roll = -0.55 * up * Math.cos(wheelT * 0.30) + (h1 - 0.5) * 0.3;
          pitch = -0.12 * up;
          // Hard flapping on the way up, gliding on the wheel, braking on the way down.
          flap = up > 0.9 ? 1.05 : 0.55 + 0.5 * up;
          leg = 0.85 * up;
          tail = 0.25 * up;
        } else {
          // On the ground. Feeding birds probe; roosting birds stand and now and then shuffle.
          const probe = feeding ? Math.max(0, Math.sin(ph * 0.7 + h2 * 6)) : 0;
          pitch = probe * 0.75;
          const walk = feeding ? Math.sin(clockT * 0.5 + h1 * 20) : 0;
          x += walk * 1.6 * Math.sin(yaw);
          z += walk * 1.6 * Math.cos(yaw);
          flap = hash3(SEED + 85, i, Math.floor(clockT / 3)) < 0.03 ? 0.45 : 0.02;
        }

        put(rec, x, y, z, yaw, pitch, roll, sizeM / rec.unit,
          ph * (up > 0.01 ? 3.4 : 1.0), flap, up > 0.01 ? wrist : leg * 0, tail,
          1, 1, 1, clamp(1 - (dist - 1100) / 1400, 0, 1));
        drawn.shorebirds++;
      }
    }
  }

  /* ================================================================ raptors */

  function drawRaptors(w, camX, camY, camZ, d) {
    drawn.raptors = 0;
    const dl = w.read('daylight');
    const wx = w.read('weather');
    if (!dl || dl.elevationDeg < 3) return;   // thermals need the sun on the ground
    const clock = w.clock;
    // A thermal needs heating and it dies in heavy rain, so a soaring bird is a fair-weather bird.
    const lift = clamp((dl.elevationDeg - 3) / 35, 0, 1) * (wx ? clamp(1 - wx.rainMmHr / 3, 0, 1) : 1);
    if (lift < 0.05) return;

    for (let i = 0; i < ambient.raptor.length; i++) {
      const c = ambient.raptor[i];
      const season = ambient.season
        ? ambient.season(c.kind === 'seaEagle' ? 'sp-white-bellied-sea-eagle' : 'sp-eastern-osprey', clock)
        : 0.8;
      if (hash2(SEED + 87, i) > season * lift) continue;
      const rec = S.get(c.kind);
      const t = clockT * c.rate + c.phase;
      // A soaring bird climbs as it circles and slides off downwind at the top.
      const climb = 0.5 + 0.5 * Math.sin(t * 0.23);
      const rr = c.radius * (0.7 + 0.3 * climb);
      const x = c.x + Math.cos(t) * rr;
      const z = c.z + Math.sin(t) * rr;
      const dist = Math.hypot(x - camX, z - camZ);
      if (dist > rec.sp.range) continue;
      const ground = Math.max(island.height(x, z), seaLevel);
      const y = ground + c.alt * (0.55 + 0.45 * climb);
      const yaw = t + Math.PI / 2;
      const fade = clamp(1 - (dist - rec.sp.range * 0.7) / (rec.sp.range * 0.3), 0, 1);
      if (fade <= 0.02) continue;
      // Soaring: wings held, a shallow bank into the turn, and a flap only now and then.
      const flapping = hash3(SEED + 89, i, Math.floor(clockT / 5)) < 0.22;
      put(rec, x, y, z, yaw, -0.03, -0.30, (c.kind === 'seaEagle' ? 2.2 : 1.7) / rec.unit,
        clockT * 2.1 + i * 3, flapping ? 0.55 : 0.05, 0.10, 0.18,
        1, 1, 1, fade);
      drawn.raptors++;
    }
  }

  /* ================================================================ vapour and foam */

  function stepPuffs(d, wx) {
    const windTh = ((wx ? wx.windDirDeg : 110) + 180) * Math.PI / 180;
    const wxs = Math.sin(windTh) * (wx ? wx.windKt : 10) * 0.514 * 0.18;
    const wzs = Math.cos(windTh) * (wx ? wx.windKt : 10) * 0.514 * 0.18;
    let n = 0;
    for (let i = 0; i < PUFF_CAP; i++) {
      const p = puffs[i];
      if (p.a >= p.life) continue;
      p.a += d;
      if (p.a >= p.life) continue;
      const t = p.a / p.life;
      p.vy -= 6.2 * d;                       // spray falls, vapour hangs
      if (p.kind < 0.5) p.vy += 5.4 * d;     // vapour is buoyant
      p.vx += (wxs - p.vx) * d * 1.4;
      p.vz += (wzs - p.vz) * d * 1.4;
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
      puffP[k + 3] = p.op * (1 - t) * (1 - t) * smoothstep(0, 0.12, t);
      n++;
      if (n >= PUFF_CAP) break;
    }
    puffMesh.setEnabled(n > 0);
    puffMesh.thinInstanceCount = n;
    if (n > 0) {
      puffMesh.thinInstancePartialBufferUpdate('matrix', puffM.subarray(0, n * 16), 0);
      puffMesh.thinInstancePartialBufferUpdate('aP', puffP.subarray(0, n * 4), 0);
    }
    drawn.vapourPuffs = n;
  }

  function stepMarks(d) {
    let n = 0;
    for (let i = 0; i < shapeN && n < MARK_CAP; i++) {
      const s = shapes[i];
      const j = n * 16;
      puffFill(markM, j, Math.cos(s.yaw) * s.r, Math.sin(s.yaw) * s.r, s.x, s.y, s.z, s.r);
      const k = n * 4;
      markP[k] = 0.5; markP[k + 1] = 1; markP[k + 2] = s.stretch; markP[k + 3] = s.op;
      n++;
    }
    for (let i = 0; i < MARK_CAP; i++) {
      const m = marks[i];
      if (m.a >= m.life) continue;
      m.a += d;
      if (m.a >= m.life) continue;
      const t = m.a / m.life;
      const r = m.r * lerp(1, m.grow, t);
      const j = n * 16;
      const cs = Math.cos(m.yaw), sn = Math.sin(m.yaw);
      puffFill(markM, j, cs * r, sn * r, m.x, m.y, m.z, r);
      const k = n * 4;
      markP[k] = t;
      markP[k + 1] = m.kind;
      markP[k + 2] = m.stretch;
      markP[k + 3] = m.op * (1 - t) * smoothstep(0, 0.1, t);
      n++;
      if (n >= MARK_CAP) break;
    }
    markMesh.setEnabled(n > 0);
    markMesh.thinInstanceCount = n;
    if (n > 0) {
      markMesh.thinInstancePartialBufferUpdate('matrix', markM.subarray(0, n * 16), 0);
      markMesh.thinInstancePartialBufferUpdate('aP', markP.subarray(0, n * 4), 0);
    }
  }

  function puffFill(buf, j, cs, sn, x, y, z, r) {
    buf[j] = cs; buf[j + 1] = 0; buf[j + 2] = -sn; buf[j + 3] = 0;
    buf[j + 4] = 0; buf[j + 5] = r; buf[j + 6] = 0; buf[j + 7] = 0;
    buf[j + 8] = sn; buf[j + 9] = 0; buf[j + 10] = cs; buf[j + 11] = 0;
    buf[j + 12] = x; buf[j + 13] = y; buf[j + 14] = z; buf[j + 15] = 1;
  }

  return layer;
}
