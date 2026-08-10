// The camera rig. One Babylon camera, five controllers, and a blend between them, so no
// mode change is ever a cut. Everything below drives position/target/fov/roll directly:
// Babylon's own camera inputs are cleared, because two things fighting over one transform
// is what makes a camera feel cheap.
//
// Modes: planner (default orbit/pan/zoom), street (eye height, WASD), follow (spring arm),
// drone (6DOF), cinematic (rail shots with a depth-of-field handoff to the postfx layer).
//
// The island is modelled in local metres. Longitude/latitude convert through the terrain
// module when it exists (world.island.toLocal), otherwise through the local projection below.
// Ground height comes from world.island.height(x, z) when it exists, and never hard-crashes
// when it does not: a survey scaffold stands in so the rig can still be flown and judged.

import { makeNoise2D } from '../kernel/rng.js';

const B = window.BABYLON;

/* ------------------------------------------------------------------ projection */

// Local metre grid. Origin sits near the middle of Minjerribah so the whole island,
// Amity Point in the north to Jumpinpin in the south, fits inside +/- 20 km.
const ORIGIN = { lat: -27.56, lon: 153.47 };
const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LON = 98683; // 111320 * cos(27.56 deg)

function projectLocal(lon, lat) {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, z: (lat - ORIGIN.lat) * M_PER_DEG_LAT };
}
function unprojectLocal(x, z) {
  return { lon: ORIGIN.lon + x / M_PER_DEG_LON, lat: ORIGIN.lat + z / M_PER_DEG_LAT };
}

/* ------------------------------------------------------------------ places */

// Approximate published coordinates for real named places on Minjerribah, used for camera
// bookmarks, the "looking at" readout and the cinematic rails. Coordinates are rounded to
// roughly 100 m. When data/places.json lands, that pack wins and this list is only a fallback.
const FALLBACK_PLACES = [
  { id: 'dunwich', label: 'Dunwich (Goompi)', lon: 153.4008, lat: -27.4967, kind: 'township', reach: 1800 },
  { id: 'amity', label: 'Amity Point (Pulan)', lon: 153.4372, lat: -27.399, kind: 'township', reach: 1600 },
  { id: 'pointlookout', label: 'Point Lookout', lon: 153.5386, lat: -27.43, kind: 'township', reach: 1700 },
  { id: 'gorge', label: 'North Gorge', lon: 153.545, lat: -27.4278, kind: 'headland', reach: 700 },
  { id: 'cylinder', label: 'Cylinder Beach', lon: 153.531, lat: -27.4265, kind: 'beach', reach: 700 },
  { id: 'home', label: 'Home Beach', lon: 153.524, lat: -27.4245, kind: 'beach', reach: 700 },
  { id: 'deadmans', label: 'Deadmans Beach', lon: 153.541, lat: -27.43, kind: 'beach', reach: 550 },
  { id: 'frenchmans', label: 'Frenchmans Beach', lon: 153.5455, lat: -27.4325, kind: 'beach', reach: 550 },
  { id: 'adderrock', label: 'Adder Rock', lon: 153.519, lat: -27.423, kind: 'beach', reach: 550 },
  { id: 'mainbeach', label: 'Main Beach', lon: 153.532, lat: -27.48, kind: 'beach', reach: 4200 },
  { id: 'flinders', label: 'Flinders Beach', lon: 153.49, lat: -27.418, kind: 'beach', reach: 3200 },
  { id: 'onemile', label: 'One Mile', lon: 153.406, lat: -27.49, kind: 'locality', reach: 900 },
  { id: 'myora', label: 'Myora Springs', lon: 153.41, lat: -27.462, kind: 'locality', reach: 900 },
  { id: 'brownlake', label: 'Brown Lake (Bummiera)', lon: 153.4319, lat: -27.4772, kind: 'lake', reach: 900 },
  { id: 'bluelake', label: 'Blue Lake (Karboora)', lon: 153.47, lat: -27.4986, kind: 'lake', reach: 900 },
  { id: 'eighteenmile', label: 'Eighteen Mile Swamp', lon: 153.475, lat: -27.6, kind: 'wetland', reach: 6000 },
  { id: 'jumpinpin', label: 'Jumpinpin', lon: 153.429, lat: -27.712, kind: 'channel', reach: 2600 }
];

const BOOKMARK_KEYS = ['dunwich', 'amity', 'pointlookout', 'gorge'];

/* ------------------------------------------------------------------ cinematic shots */

// Rails are lists of {lon, lat, alt}. `look` is a fixed point, `lookPath` a second rail for
// a moving look-at. Notes describe real geography and nothing else.
const SHOTS = {
  'island-reveal': {
    label: 'Island reveal',
    note: 'East across Moreton Bay toward Dunwich.',
    dur: 30, fov: 0.56, ease: 'sine',
    path: [
      { lon: 153.318, lat: -27.522, alt: 5200 },
      { lon: 153.352, lat: -27.508, alt: 4100 },
      { lon: 153.382, lat: -27.499, alt: 3000 }
    ],
    look: { lon: 153.4008, lat: -27.4967, alt: 0 },
    dof: { fStop: 5.6, focalLengthMm: 55 }
  },
  'gorge-dawn': {
    label: 'North Gorge',
    note: 'Along the headland walk at Point Lookout, out to the open water.',
    dur: 26, fov: 0.68, ease: 'sine',
    path: [
      { lon: 153.5482, lat: -27.4312, alt: 120 },
      { lon: 153.5464, lat: -27.4288, alt: 96 },
      { lon: 153.5438, lat: -27.4262, alt: 78 }
    ],
    look: { lon: 153.5472, lat: -27.4272, alt: 0 },
    dof: { fStop: 2.8, focalLengthMm: 35 }
  },
  'dunwich-arrival': {
    label: 'Dunwich arrival',
    note: 'The approach every visitor makes, across the bay to Goompi.',
    dur: 22, fov: 0.74, ease: 'sine',
    path: [
      { lon: 153.3818, lat: -27.4931, alt: 26 },
      { lon: 153.3902, lat: -27.4946, alt: 20 },
      { lon: 153.3972, lat: -27.4961, alt: 15 }
    ],
    look: { lon: 153.4008, lat: -27.4967, alt: 12 },
    dof: { fStop: 4, focalLengthMm: 40 }
  },
  'main-beach-south': {
    label: 'Main Beach south',
    note: 'Running south down the ocean side toward Eighteen Mile Swamp.',
    dur: 34, fov: 0.62, ease: 'sine',
    path: [
      { lon: 153.5392, lat: -27.443, alt: 58 },
      { lon: 153.5334, lat: -27.4705, alt: 50 },
      { lon: 153.5232, lat: -27.5105, alt: 44 }
    ],
    lookPath: [
      { lon: 153.5352, lat: -27.4585, alt: 0 },
      { lon: 153.5288, lat: -27.4865, alt: 0 },
      { lon: 153.5176, lat: -27.5285, alt: 0 }
    ],
    dof: { fStop: 4.5, focalLengthMm: 50 }
  },
  'amity-flats': {
    label: 'Amity flats',
    note: 'Over the sand flats at Amity Point, where the bay goes shallow.',
    dur: 26, fov: 0.66, ease: 'sine',
    path: [
      { lon: 153.4298, lat: -27.3928, alt: 92 },
      { lon: 153.4358, lat: -27.3974, alt: 72 },
      { lon: 153.4416, lat: -27.4021, alt: 54 }
    ],
    look: { lon: 153.4372, lat: -27.399, alt: 0 },
    dof: { fStop: 3.5, focalLengthMm: 45 }
  }
};

/* ------------------------------------------------------------------ tuning */

const MIN_DIST = 6;          // metres from the pivot: close enough to read a sign
const MAX_DIST = 46000;      // far enough to hold the whole island in frame
const LN_MIN = Math.log(MIN_DIST);
const LN_SPAN = Math.log(MAX_DIST) - LN_MIN;
const PITCH_LOW = 0.18;      // radians above horizontal when right in
const PITCH_HIGH = 1.34;     // near map view when right out
const EYE_HEIGHT = 1.68;
const WALK_SPEED = 1.45;
const RUN_SPEED = 4.4;
const EDGE_BAND = 26;        // pixels
const EDGE_IDLE = 1.5;       // seconds since the pointer last moved before edge pan sleeps

/* ------------------------------------------------------------------ small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
/** Frame-rate independent exponential approach. lambda is "how fast", not "how much". */
const damp = (cur, tgt, lambda, dt) => tgt + (cur - tgt) * Math.exp(-lambda * dt);
const shortAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function fmtDist(m) {
  if (!Number.isFinite(m)) return '-';
  const a = Math.abs(m);
  if (a < 1000) return Math.round(m) + ' m';
  if (a < 10000) return (m / 1000).toFixed(2) + ' km';
  return (m / 1000).toFixed(1) + ' km';
}
function fmtAlt(m) {
  if (!Number.isFinite(m)) return '-';
  return Math.abs(m) < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
}
const SCALE_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

/* ================================================================== register */

export function registerCamera(world) {
  const state = world.publish('camera', {
    mode: 'planner',
    previousMode: null,
    transitioning: false,
    transitionT: 1,
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    lonLat: { lon: ORIGIN.lon, lat: ORIGIN.lat },
    altitudeM: 0,
    groundHeightM: 0,
    heightAboveGroundM: 0,
    distanceM: 0,
    headingDeg: 0,
    pitchDeg: 0,
    fovDeg: 46,
    speedMs: 0,
    odometerM: 0,
    lookingAt: { place: null, label: null, lon: 0, lat: 0, x: 0, z: 0, distanceM: 0, kind: null },
    metresPerPixel: 0,
    photoMode: false,
    letterbox: false,
    labels: false,
    lockedTo: null,
    shot: null,
    dof: { enabled: false, focusDistanceM: 0, fStop: 4, focalLengthMm: 50 },
    bookmarks: [],
    terrainSource: 'none',
    frames: 0
  });

  const places = resolvePlaces(world);
  const dwell = Object.create(null); // place id -> sim minutes with the camera looking at it
  let lastPlace = null;
  let placeChanges = 0;

  // The system half. It exists so the camera shows up in TWIN.probe() and so the island
  // learns where the player actually spends their attention: a wayfinding read the UI,
  // the narrative director and the chronicle can all use.
  world.register({
    id: 'camera',
    phase: 'presentation',
    order: 90,
    tick() {
      const la = state.lookingAt;
      if (la && la.place) {
        dwell[la.place] = (dwell[la.place] || 0) + 10; // one tick is ten sim-minutes
        if (la.place !== lastPlace) {
          lastPlace = la.place;
          placeChanges++;
          world.bus.emit('camera:place', { place: la.place, label: la.label, mode: state.mode });
        }
      }
    },
    describe() {
      const top = Object.entries(dwell).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, mins]) => ({ place: id, minutes: mins }));
      return {
        mode: state.mode,
        transitioning: state.transitioning,
        altitudeM: Math.round(state.altitudeM),
        groundHeightM: +state.groundHeightM.toFixed(1),
        heightAboveGroundM: +state.heightAboveGroundM.toFixed(1),
        headingDeg: Math.round(state.headingDeg),
        pitchDeg: Math.round(state.pitchDeg),
        fovDeg: +state.fovDeg.toFixed(1),
        lookingAt: state.lookingAt.label,
        metresPerPixel: +state.metresPerPixel.toFixed(3),
        odometerM: Math.round(state.odometerM),
        frames: state.frames,
        placesSeen: Object.keys(dwell).length,
        placeChanges,
        dwellTop: top,
        photoMode: state.photoMode,
        shot: state.shot ? state.shot.name : null,
        terrainSource: state.terrainSource
      };
    },
    save() { return { dwell: { ...dwell } }; },
    load(w, s) { if (s && s.dwell) Object.assign(dwell, s.dwell); }
  });

  if (!world.stage) return; // headless: the read model exists, nothing renders

  attachRig(world, state, places, dwell);
}

/* ------------------------------------------------------------------ places helper */

function resolvePlaces(world) {
  const pack = world.data && world.data.places;
  const items = pack && Array.isArray(pack.items) ? pack.items : null;
  const src = items && items.length
    ? items.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    : FALLBACK_PLACES;
  const list = (src.length ? src : FALLBACK_PLACES).map((p) => {
    const local = projectLocal(p.lon, p.lat);
    return {
      id: p.id || String(p.label || 'place').toLowerCase().replace(/[^a-z0-9]+/g, ''),
      label: p.label || p.name || p.id,
      kind: p.kind || 'place',
      lon: p.lon, lat: p.lat,
      x: local.x, z: local.z,
      reach: p.reach || 1200
    };
  });
  return list;
}

/* ================================================================== the rig */

function attachRig(world, state, places, dwell) {
  const stage = world.stage;
  const scene = stage.scene;
  const canvas = stage.canvas;

  /* --- one camera, driven by hand ------------------------------------- */
  const old = stage.camera;
  const cam = new B.UniversalCamera('rig', new B.Vector3(0, 800, -2000), scene);
  cam.inputs.clear();               // nothing but this module moves this camera
  cam.fov = 0.82;
  cam.minZ = 1;
  cam.maxZ = 120000;
  cam.rotationQuaternion = null;    // we drive euler rotation directly
  scene.activeCamera = cam;
  stage.camera = cam;
  if (old && old !== cam) {
    try { old.detachControl(); } catch (e) { /* older signature, harmless */ }
    old.dispose();
  }

  /* --- ground sampling -------------------------------------------------- */
  const noise = makeNoise2D(world.seed ^ 0x5ca4401d);
  let scaffoldOn = false;

  /** Calibration relief. Deliberately uniform rolling ground, not an island shape:
   *  it exists so the rig has something to hug until the terrain layer lands. */
  function scaffoldHeight(x, z) {
    const edge = smoothstep(clamp((20000 - Math.max(Math.abs(x), Math.abs(z))) / 5000, 0, 1));
    const n = noise.fbm(x / 3400, z / 3400, 4, 2.1, 0.5);
    const r = noise.ridged(x / 9000 + 11, z / 9000 - 7, 3);
    return edge * clamp(26 + n * 26 + r * 16, 0, 90);
  }

  let groundFn = null;
  let groundFails = 0;
  function groundAt(x, z) {
    const isl = world.island;
    const fn = isl && typeof isl.height === 'function' ? isl.height : null;
    if (fn !== groundFn) {
      groundFn = fn;
      state.terrainSource = fn ? 'world.island.height' : scaffoldOn ? 'camera-scaffold-calibration' : 'flat';
    }
    if (fn) {
      if (groundFails > 24) return 0;
      try {
        const h = fn.call(isl, x, z);
        return Number.isFinite(h) ? h : 0;
      } catch (e) {
        groundFails++;
        return 0;
      }
    }
    return scaffoldOn ? scaffoldHeight(x, z) : 0;
  }

  function toLocal(lon, lat) {
    const isl = world.island;
    if (isl && typeof isl.toLocal === 'function') {
      try {
        const p = isl.toLocal(lon, lat);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
      } catch (e) { /* fall through */ }
    }
    return projectLocal(lon, lat);
  }
  function toLonLat(x, z) {
    const isl = world.island;
    if (isl && typeof isl.toLonLat === 'function') {
      try {
        const p = isl.toLonLat(x, z);
        if (p && Number.isFinite(p.lon)) return p;
      } catch (e) { /* fall through */ }
    }
    return unprojectLocal(x, z);
  }

  /* --- pose ------------------------------------------------------------- */
  const newPose = () => ({ pos: new B.Vector3(), target: new B.Vector3(), fov: 0.82, roll: 0 });
  const copyPose = (dst, src) => {
    dst.pos.copyFrom(src.pos); dst.target.copyFrom(src.target);
    dst.fov = src.fov; dst.roll = src.roll;
    return dst;
  };
  const renderPose = newPose();
  const framePose = newPose();

  // Scratch. Nothing in the frame path allocates.
  const _v1 = new B.Vector3(), _v2 = new B.Vector3(), _v3 = new B.Vector3();
  const _ray = new B.Ray(new B.Vector3(), new B.Vector3(0, -1, 0), 1e6);
  const _id = B.Matrix.Identity();

  /** Orbit position from a pivot: yaw is the compass bearing the camera looks along. */
  function orbitPose(pose, pivot, yaw, pitch, dist, fov, roll) {
    const ch = Math.cos(pitch) * dist;
    pose.pos.set(pivot.x - Math.sin(yaw) * ch, pivot.y + Math.sin(pitch) * dist, pivot.z - Math.cos(yaw) * ch);
    pose.target.copyFrom(pivot);
    pose.fov = fov;
    pose.roll = roll || 0;
    return pose;
  }
  function dirPose(pose, pos, yaw, pitch, fov, roll) {
    pose.pos.copyFrom(pos);
    const cp = Math.cos(pitch);
    pose.target.set(pos.x + Math.sin(yaw) * cp * 100, pos.y + Math.sin(pitch) * 100, pos.z + Math.cos(yaw) * cp * 100);
    pose.fov = fov;
    pose.roll = roll || 0;
    return pose;
  }
  function poseHeading(pose) {
    return Math.atan2(pose.target.x - pose.pos.x, pose.target.z - pose.pos.z);
  }
  function posePitch(pose) {
    const dx = pose.target.x - pose.pos.x, dy = pose.target.y - pose.pos.y, dz = pose.target.z - pose.pos.z;
    return Math.atan2(dy, Math.hypot(dx, dz));
  }

  /** March a ray onto the ground. Two refinements is plenty for the relief we have. */
  function rayGround(ox, oy, oz, dx, dy, dz, out) {
    out.hit = false;
    if (dy > -1e-4) {                       // at or above the horizon: project a long way out
      const h = Math.hypot(dx, dz) || 1;
      out.set(ox + (dx / h) * 12000, 0, oz + (dz / h) * 12000);
      out.y = groundAt(out.x, out.z);
      return out;
    }
    let planeY = 0;
    for (let i = 0; i < 3; i++) {
      const t = (planeY - oy) / dy;
      if (!(t > 0) || t > 4e5) break;
      out.set(ox + dx * t, planeY, oz + dz * t);
      planeY = groundAt(out.x, out.z);
    }
    out.y = planeY;
    out.hit = true;
    return out;
  }
  const _hit = new B.Vector3(); _hit.hit = false;

  /** Ground point under a screen pixel, using the current render pose. */
  function screenGround(px, py, out) {
    scene.createPickingRayToRef(px, py, _id, _ray, cam);
    return rayGround(_ray.origin.x, _ray.origin.y, _ray.origin.z,
      _ray.direction.x, _ray.direction.y, _ray.direction.z, out);
  }

  /** Ray to a fixed horizontal plane. Grab-pan uses it so the anchor height stays put. */
  function screenGroundOnPlane(px, py, planeY, out) {
    scene.createPickingRayToRef(px, py, _id, _ray, cam);
    const dy = _ray.direction.y;
    out.hit = false;
    if (dy > -1e-4) return out;
    const t = (planeY - _ray.origin.y) / dy;
    if (!(t > 0) || t > 4e5) return out;
    out.set(_ray.origin.x + _ray.direction.x * t, planeY, _ray.origin.z + _ray.direction.z * t);
    out.hit = true;
    return out;
  }
  const _grab = new B.Vector3(); _grab.hit = false;

  /* --- input state ------------------------------------------------------ */
  const input = {
    keys: new Set(),
    pointers: new Map(),
    px: 0, py: 0,
    inside: false,
    lastMoveAt: -99,
    lastActionAt: -99,
    drag: null,          // {kind:'pan'|'orbit'|'look', id, dx, dy, anchor, planeY}
    pinch: null,
    locked: false,
    wheel: 0,
    touch: false
  };
  let now = 0;           // seconds since the rig started, accumulated from frame dt only
  const anyHeld = (...codes) => codes.some((c) => input.keys.has(c));
  const axis = (neg, pos) => (anyHeld(...pos) ? 1 : 0) - (anyHeld(...neg) ? 1 : 0);
  function markAction() { input.lastActionAt = now; }

  /* ================================================================ PLANNER */

  const planner = {
    id: 'planner',
    pivot: new B.Vector3(1200, 0, 4200),
    yaw: 0.16,
    pitchBias: -0.52,
    dist: 15000,
    panVel: new B.Vector3(),
    yawVel: 0,
    pitchVel: 0,
    zoomVel: 0,
    pose: newPose(),

    autoPitch(d) {
      // Low and oblique through the working range, map-like only at the far end of the
      // zoom. A curve, not a ramp: the tilt should feel like it belongs to the distance.
      const t = clamp((Math.log(clamp(d, MIN_DIST, MAX_DIST)) - LN_MIN) / LN_SPAN, 0, 1);
      return lerp(PITCH_LOW, PITCH_HIGH, Math.pow(t, 2.6));
    },
    zoomFrac() {
      return clamp((Math.log(clamp(this.dist, MIN_DIST, MAX_DIST)) - LN_MIN) / LN_SPAN, 0, 1);
    },
    /** How much room a downward tilt has below the auto curve at this distance. Tilting
     *  down has full authority from altitude and almost none at street zoom, so the manual
     *  tilt never fights the auto curve into a view of nothing but sky. */
    biasRoom(base) { return clamp((base - PITCH_LOW * 0.55) / (PITCH_HIGH - PITCH_LOW * 0.55), 0.06, 1); },
    pitch() {
      const base = this.autoPitch(this.dist);
      const b = this.pitchBias < 0 ? this.pitchBias * this.biasRoom(base) : this.pitchBias;
      return clamp(base + b, 0.05, 1.52);
    },
    /** Inverse of pitch(): what bias would produce this absolute tilt at this distance. */
    biasFor(pitch, dist) {
      const base = this.autoPitch(dist);
      return pitch < base ? clamp((pitch - base) / this.biasRoom(base), -1.02, 0.5) : clamp(pitch - base, -1.02, 0.5);
    },
    fov() { return lerp(0.96, 0.78, smoothstep(this.zoomFrac())); },

    enter(from) {
      // Continue from wherever the last mode left the eye: put the pivot where the view meets
      // the ground, keep the heading and keep the tilt the player was already using.
      const dx = from.target.x - from.pos.x, dy = from.target.y - from.pos.y, dz = from.target.z - from.pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      rayGround(from.pos.x, from.pos.y, from.pos.z, dx / len, dy / len, dz / len, _hit);
      this.pivot.copyFrom(_hit);
      this.dist = clamp(B.Vector3.Distance(from.pos, this.pivot), MIN_DIST, MAX_DIST);
      this.yaw = poseHeading(from);
      this.pitchBias = this.biasFor(clamp(-posePitch(from), 0.05, 1.52), this.dist);
      this.panVel.setAll(0); this.yawVel = 0; this.pitchVel = 0; this.zoomVel = 0;
    },

    /** Wheel and pinch both land here. Keeps the ground point under the pointer, under it. */
    zoomAt(mult, px, py) {
      const before = this.dist;
      const after = clamp(before * mult, MIN_DIST, MAX_DIST);
      if (after === before) return;
      if (px !== undefined && px !== null) {
        screenGround(px, py, _hit);
        if (_hit.hit) {
          const k = clamp(1 - after / before, -1.1, 0.9) * 0.9;
          this.pivot.x += (_hit.x - this.pivot.x) * k;
          this.pivot.z += (_hit.z - this.pivot.z) * k;
        }
      }
      this.dist = after;
    },

    update(dt) {
      const frac = this.zoomFrac();
      const scale = this.dist;

      if (input.wheel !== 0) { this.zoomVel += input.wheel * 2.4; input.wheel = 0; }
      const kz = axis(['KeyR', 'Equal', 'NumpadAdd'], ['KeyF', 'Minus', 'NumpadSubtract']);
      if (kz) { this.zoomVel += kz * 26 * dt; markAction(); }
      if (this.zoomVel !== 0) {
        this.zoomAt(Math.exp(this.zoomVel * dt * 0.17), input.inside ? input.px : null, input.py);
        this.zoomVel = damp(this.zoomVel, 0, 11, dt);
        if (Math.abs(this.zoomVel) < 0.002) this.zoomVel = 0;
      }

      let dyaw = 0, dpit = 0;
      const kr = axis(['KeyQ'], ['KeyE']);
      if (kr) { dyaw += kr * 1.15 * dt; markAction(); }
      const kt = axis(['PageDown'], ['PageUp']);
      if (kt) { dpit += kt * 0.75 * dt; markAction(); }
      if (input.drag && input.drag.kind === 'orbit') {
        dyaw += input.drag.dx * 0.0052;
        dpit += input.drag.dy * 0.0034;
        input.drag.dx = 0; input.drag.dy = 0;
      }
      this.yawVel += dyaw * 26;
      this.pitchVel += dpit * 26;
      this.yaw += this.yawVel * dt;
      this.pitchBias = clamp(this.pitchBias + this.pitchVel * dt, -1.02, 0.5);
      this.yawVel = damp(this.yawVel, 0, 9.5, dt);
      this.pitchVel = damp(this.pitchVel, 0, 11, dt);

      // Grab pan. The ground point you took hold of stays under the cursor, at every zoom.
      if (input.drag && input.drag.kind === 'pan') {
        const d = input.drag;
        screenGroundOnPlane(input.px, input.py, d.planeY, _grab);
        if (_grab.hit) {
          const lim = scale * 2.2;
          const mx = clamp(d.ax - _grab.x, -lim, lim);
          const mz = clamp(d.az - _grab.z, -lim, lim);
          this.pivot.x += mx;
          this.pivot.z += mz;
          d.vx = mx / Math.max(dt, 0.004);
          d.vz = mz / Math.max(dt, 0.004);
        }
      }

      const kx = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      const kf = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const boost = anyHeld('ShiftLeft', 'ShiftRight') ? 2.6 : 1;
      const panAcc = clamp(scale * 0.9, 30, 9000) * boost;
      if (kx || kf) {
        markAction();
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        const nx = kx * c + kf * s, nz = -kx * s + kf * c;
        const l = Math.hypot(nx, nz) || 1;
        this.panVel.x += (nx / l) * panAcc * dt * 3.2;
        this.panVel.z += (nz / l) * panAcc * dt * 3.2;
      }

      // Edge pan, but only while the pointer is genuinely in use. A parked cursor never
      // drifts the island out from under you, which is the usual reason people turn this off.
      if (!input.drag && !input.touch && input.inside && now - input.lastMoveAt < EDGE_IDLE) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        let ex = 0, ez = 0;
        if (input.px < EDGE_BAND) ex = -(1 - input.px / EDGE_BAND);
        else if (input.px > w - EDGE_BAND) ex = 1 - (w - input.px) / EDGE_BAND;
        if (input.py < EDGE_BAND) ez = 1 - input.py / EDGE_BAND;
        else if (input.py > h - EDGE_BAND) ez = -(1 - (h - input.py) / EDGE_BAND);
        if (ex || ez) {
          const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
          const l = Math.hypot(ex, ez) || 1;
          const e = smoothstep(clamp(l, 0, 1));
          const nx = (ex / l) * e, nz = (ez / l) * e;
          this.panVel.x += (nx * c + nz * s) * panAcc * dt * 2.2;
          this.panVel.z += (-nx * s + nz * c) * panAcc * dt * 2.2;
        }
      }

      const maxPan = clamp(scale * 1.6, 60, 26000);
      const pl = Math.hypot(this.panVel.x, this.panVel.z);
      if (pl > maxPan) { this.panVel.x *= maxPan / pl; this.panVel.z *= maxPan / pl; }
      this.pivot.x = clamp(this.pivot.x + this.panVel.x * dt, -60000, 60000);
      this.pivot.z = clamp(this.pivot.z + this.panVel.z * dt, -60000, 60000);
      this.panVel.x = damp(this.panVel.x, 0, 5.4, dt);
      this.panVel.z = damp(this.panVel.z, 0, 5.4, dt);

      // The pivot rides the terrain, so zooming into a dune does not bury you inside it.
      const g = groundAt(this.pivot.x, this.pivot.z);
      this.pivot.y = damp(this.pivot.y, g, frac > 0.75 ? 3.2 : 7.5, dt);

      orbitPose(this.pose, this.pivot, this.yaw, this.pitch(), this.dist, this.fov(), 0);
      this.pose.target.y += this.dist * 0.05 * (1 - smoothstep(frac));
      const clear = clamp(this.dist * 0.03, 1.6, 90);
      const eg = groundAt(this.pose.pos.x, this.pose.pos.z);
      if (this.pose.pos.y < eg + clear) this.pose.pos.y = eg + clear;
      return this.pose;
    }
  };

  // Mouse-look accumulators. Pointer lock and drag-look both feed these.
  input.lookDx = 0;
  input.lookDy = 0;
  // On foot and in the air the wheel is a lens, not a dolly: you can glass a headland
  // from the beach without walking to it.
  input.lens = 1;
  function takeLook(sens) {
    const dx = input.lookDx * sens, dy = input.lookDy * sens;
    input.lookDx = 0; input.lookDy = 0;
    if (dx || dy) markAction();
    return { dx, dy };
  }

  /* ================================================================= STREET */

  const street = {
    id: 'street',
    pos: new B.Vector3(),
    footY: 0,
    yaw: 0, pitch: -0.03,
    vel: new B.Vector3(),
    bob: 0, bobAmp: 0, speed: 0,
    pose: newPose(),

    enter(from) {
      // Drop at whatever the last mode was looking at, not at the eye: you land where
      // you were pointing, which is the only intuitive answer.
      const dx = from.target.x - from.pos.x, dy = from.target.y - from.pos.y, dz = from.target.z - from.pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      rayGround(from.pos.x, from.pos.y, from.pos.z, dx / len, dy / len, dz / len, _hit);
      this.pos.set(_hit.x, 0, _hit.z);
      this.footY = groundAt(this.pos.x, this.pos.z);
      this.yaw = poseHeading(from);
      this.pitch = clamp(posePitch(from) * 0.35, -0.5, 0.35);
      this.vel.setAll(0);
      this.bob = 0; this.bobAmp = 0; this.speed = 0;
    },

    update(dt) {
      const l = takeLook(0.0023);
      this.yaw += l.dx;
      this.pitch = clamp(this.pitch - l.dy, -1.45, 1.45);

      const kx = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      const kf = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const running = anyHeld('ShiftLeft', 'ShiftRight');
      const top = running ? RUN_SPEED : WALK_SPEED;
      if (kx || kf) markAction();
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      let wx = kx * c + kf * s, wz = -kx * s + kf * c;
      const wl = Math.hypot(wx, wz);
      if (wl > 0) { wx /= wl; wz /= wl; }
      const acc = 16;
      this.vel.x += (wx * top - this.vel.x) * clamp(acc * dt, 0, 1);
      this.vel.z += (wz * top - this.vel.z) * clamp(acc * dt, 0, 1);
      if (!wl) {
        this.vel.x = damp(this.vel.x, 0, 9, dt);
        this.vel.z = damp(this.vel.z, 0, 9, dt);
      }
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -60000, 60000);
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -60000, 60000);
      this.speed = Math.hypot(this.vel.x, this.vel.z);

      // Terrain following with a gentle floor: the eye can lag the ground going downhill,
      // never sink through it.
      const g = groundAt(this.pos.x, this.pos.z);
      this.footY = Math.max(damp(this.footY, g, 9, dt), g);

      // Headbob. Deliberately small: enough to say "you are walking", not enough to be felt.
      const target = this.speed > 0.05 ? (running ? 0.046 : 0.023) : 0;
      this.bobAmp = damp(this.bobAmp, target, 6, dt);
      this.bob += this.speed * 2.15 * dt;
      const bobY = Math.sin(this.bob * 2) * this.bobAmp * 0.55;
      const bobX = Math.sin(this.bob) * this.bobAmp * 0.42;
      const roll = Math.sin(this.bob) * this.bobAmp * 0.16;

      _v1.set(this.pos.x + c * bobX, this.footY + EYE_HEIGHT + bobY, this.pos.z - s * bobX);
      dirPose(this.pose, _v1, this.yaw, this.pitch,
        lerp(1.05, 1.12, clamp(this.speed / RUN_SPEED, 0, 1)) * input.lens, roll);
      return this.pose;
    }
  };

  /* ================================================================= FOLLOW */

  const follow = {
    id: 'follow',
    get: null,
    label: null,
    armYaw: 0, armPitch: 0.32, armDist: 16,
    smooth: new B.Vector3(),
    look: new B.Vector3(),
    last: new B.Vector3(),
    vel: new B.Vector3(),
    started: false,
    pose: newPose(),

    setTarget(t, label) {
      if (!t) { this.get = null; this.label = null; return; }
      if (typeof t === 'function') this.get = t;
      else if (t.get) { this.get = t.get; label = label || t.label; }
      else if (t.position) this.get = () => t.position;
      else if (Number.isFinite(t.x)) this.get = () => t;
      this.label = label || t.label || t.id || 'target';
      this.started = false;
      state.lockedTo = this.label;
    },
    read(out) {
      if (!this.get) return false;
      try {
        const p = this.get();
        if (!p || !Number.isFinite(p.x)) return false;
        out.set(p.x, p.y || 0, p.z);
        return true;
      } catch (e) { return false; }
    },

    enter(from) {
      this.armYaw = poseHeading(from);
      this.armPitch = clamp(-posePitch(from), 0.02, 1.1);
      this.armDist = clamp(B.Vector3.Distance(from.pos, from.target), 5, 260);
      this.smooth.copyFrom(from.pos);
      this.look.copyFrom(from.target);
      this.started = false;
      copyPose(this.pose, from);
    },

    update(dt) {
      if (input.wheel !== 0) { this.armDist = clamp(this.armDist * Math.exp(-input.wheel * 0.16), 3.5, 400); input.wheel = 0; }
      if (input.drag && (input.drag.kind === 'orbit' || input.drag.kind === 'pan')) {
        this.armYaw += input.drag.dx * 0.006;
        this.armPitch = clamp(this.armPitch + input.drag.dy * 0.004, -0.25, 1.25);
        input.drag.dx = 0; input.drag.dy = 0;
        markAction();
      }
      const l = takeLook(0.0025);
      this.armYaw += l.dx;
      this.armPitch = clamp(this.armPitch + l.dy, -0.25, 1.25);

      if (!this.read(_v1)) {
        // Nothing to lock to. Hold the last good frame rather than snapping to the origin.
        return this.pose;
      }
      if (!this.started) { this.last.copyFrom(_v1); this.started = true; this.smoothTo(_v1); }
      // Target velocity, smoothed, used to lead the shot rather than trail it.
      _v2.set((_v1.x - this.last.x) / Math.max(dt, 0.004), (_v1.y - this.last.y) / Math.max(dt, 0.004), (_v1.z - this.last.z) / Math.max(dt, 0.004));
      this.last.copyFrom(_v1);
      const k = clamp(6 * dt, 0, 1);
      this.vel.x += (_v2.x - this.vel.x) * k;
      this.vel.y += (_v2.y - this.vel.y) * k;
      this.vel.z += (_v2.z - this.vel.z) * k;

      const lead = 0.45;
      const px = _v1.x + this.vel.x * lead, py = _v1.y + this.vel.y * lead * 0.4, pz = _v1.z + this.vel.z * lead;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      // The arm sits behind the direction of travel once the target is actually moving.
      if (speed > 0.8) this.armYaw = damp(this.armYaw, this.armYaw + shortAngle(Math.atan2(this.vel.x, this.vel.z) - this.armYaw), 1.6, dt);

      const ch = Math.cos(this.armPitch) * this.armDist;
      _v3.set(px - Math.sin(this.armYaw) * ch, py + Math.sin(this.armPitch) * this.armDist + 1.2, pz - Math.cos(this.armYaw) * ch);

      // Critically damped, with a speed cap that scales with the gap, so a target that
      // jumps is chased in rather than snapped to.
      const gap = B.Vector3.Distance(this.smooth, _v3);
      const lam = gap > 600 ? 0.9 : gap > 60 ? 2.6 : 5.2;
      this.smooth.x = damp(this.smooth.x, _v3.x, lam, dt);
      this.smooth.y = damp(this.smooth.y, _v3.y, lam, dt);
      this.smooth.z = damp(this.smooth.z, _v3.z, lam, dt);
      const fg = groundAt(this.smooth.x, this.smooth.z) + 1.5;
      if (this.smooth.y < fg) this.smooth.y = fg;

      this.look.x = damp(this.look.x, _v1.x, 7, dt);
      this.look.y = damp(this.look.y, _v1.y + 1.1, 7, dt);
      this.look.z = damp(this.look.z, _v1.z, 7, dt);

      this.pose.pos.copyFrom(this.smooth);
      this.pose.target.copyFrom(this.look);
      this.pose.fov = 0.9;
      this.pose.roll = 0;
      return this.pose;
    },
    smoothTo(t) {
      const ch = Math.cos(this.armPitch) * this.armDist;
      this.smooth.set(t.x - Math.sin(this.armYaw) * ch, t.y + Math.sin(this.armPitch) * this.armDist + 1.2, t.z - Math.cos(this.armYaw) * ch);
      this.look.copyFrom(t);
    }
  };

  /* ================================================================== DRONE */

  const drone = {
    id: 'drone',
    pos: new B.Vector3(),
    yaw: 0, pitch: -0.2,
    vel: new B.Vector3(),
    roll: 0,
    pose: newPose(),

    enter(from) {
      this.pos.copyFrom(from.pos);
      this.yaw = poseHeading(from);
      this.pitch = posePitch(from);
      this.vel.setAll(0);
      this.roll = 0;
    },

    update(dt) {
      const l = takeLook(0.0021);
      this.yaw += l.dx;
      this.pitch = clamp(this.pitch - l.dy, -1.5, 1.5);

      const kx = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      const kf = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      const kv = axis(['ControlLeft', 'KeyQ'], ['Space', 'KeyE']);
      if (kx || kf || kv) markAction();

      // Height-scaled speed, the thing that makes free flight over an island bearable:
      // slow and precise near the sand, fast at altitude.
      const above = Math.max(0, this.pos.y - groundAt(this.pos.x, this.pos.z));
      const scale = clamp(1 + above / 200, 1, 16) * (anyHeld('ShiftLeft', 'ShiftRight') ? 5 : 1);
      const acc = 24 * scale;

      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const fx = s * cp, fy = sp, fz = c * cp;
      const rx = c, rz = -s;
      this.vel.x += (fx * kf + rx * kx) * acc * dt;
      this.vel.y += (fy * kf + kv) * acc * dt;
      this.vel.z += (fz * kf + rz * kx) * acc * dt;

      const drag = Math.exp(-dt / 0.55);
      this.vel.scaleInPlace(drag);
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -80000, 80000);
      this.pos.y = this.pos.y + this.vel.y * dt;
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -80000, 80000);

      const floor = groundAt(this.pos.x, this.pos.z) + 2;
      if (this.pos.y < floor) { this.pos.y = floor; if (this.vel.y < 0) this.vel.y *= 0.2; }
      if (this.pos.y > 26000) { this.pos.y = 26000; if (this.vel.y > 0) this.vel.y = 0; }

      // A whisper of bank on lateral movement. Enough to read as flight, not as a stunt.
      const lat = this.vel.x * rx + this.vel.z * rz;
      this.roll = damp(this.roll, clamp(-lat / (18 * scale), -0.2, 0.2), 3.2, dt);

      dirPose(this.pose, this.pos, this.yaw, this.pitch, 0.88 * input.lens, this.roll);
      return this.pose;
    }
  };

  /* ============================================================== CINEMATIC */

  function catmullTo(pts, t, out) {
    const n = pts.length;
    if (n === 1) return out.copyFrom(pts[0]);
    const f = clamp(t, 0, 1) * (n - 1);
    const seg = Math.min(n - 2, Math.floor(f));
    const u = f - seg;
    const p0 = pts[Math.max(0, seg - 1)], p1 = pts[seg], p2 = pts[seg + 1], p3 = pts[Math.min(n - 1, seg + 2)];
    const u2 = u * u, u3 = u2 * u;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    out.set(cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y), cr(p0.z, p1.z, p2.z, p3.z));
    return out;
  }

  function railPoints(list, clearance) {
    return list.map((p) => {
      const l = toLocal(p.lon, p.lat);
      const g = groundAt(l.x, l.z);
      const alt = Number.isFinite(p.alt) ? p.alt : 0;
      return new B.Vector3(l.x, Math.max(alt, g + clearance), l.z);
    });
  }

  const cinematic = {
    id: 'cinematic',
    shot: null,
    pose: newPose(),
    hold: false,

    prepare(name, opts = {}) {
      const def = SHOTS[name];
      if (!def) return null;
      const shot = {
        name,
        label: def.label,
        note: def.note,
        dur: opts.dur || def.dur,
        loop: !!opts.loop,
        t: 0,
        fov: def.fov || 0.7,
        path: railPoints(def.path, 3),
        lookPath: def.lookPath ? railPoints(def.lookPath, 0) : null,
        look: null,
        dof: def.dof || null
      };
      if (def.look) {
        const l = toLocal(def.look.lon, def.look.lat);
        shot.look = new B.Vector3(l.x, Number.isFinite(def.look.alt) ? def.look.alt : groundAt(l.x, l.z), l.z);
      }
      return shot;
    },

    enter(from) {
      if (!this.shot) copyPose(this.pose, from);
      this.hold = false;
    },

    update(dt) {
      const shot = this.shot;
      if (!shot) return this.pose;
      if (!this.hold) shot.t = clamp(shot.t + dt / shot.dur, 0, 1);
      const e = easeInOutSine(shot.t);
      catmullTo(shot.path, e, this.pose.pos);
      if (shot.lookPath) catmullTo(shot.lookPath, e, this.pose.target);
      else if (shot.look) this.pose.target.copyFrom(shot.look);
      this.pose.fov = shot.fov;
      this.pose.roll = 0;

      if (shot.dof) {
        const d = state.dof;
        d.enabled = true;
        d.focusDistanceM = B.Vector3.Distance(this.pose.pos, this.pose.target);
        d.fStop = shot.dof.fStop;
        d.focalLengthMm = shot.dof.focalLengthMm;
      }
      if (shot.t >= 1 && !this.hold) {
        if (shot.loop) shot.t = 0;
        else {
          this.hold = true;
          world.bus.emit('camera:cinematic-end', { shot: shot.name });
        }
      }
      return this.pose;
    }
  };

  const modes = { planner, street, follow, drone, cinematic };

  /* ============================================================ transitions */

  let mode = 'planner';
  let trans = null;  // {from: pose, t, dur, arc, opening}
  const _fromPose = newPose();

  function beginTransition(dur, opening) {
    copyPose(_fromPose, renderPose);
    const gap = B.Vector3.Distance(_fromPose.pos, modes[mode].pose.pos);
    trans = {
      from: _fromPose,
      t: 0,
      dur: Math.max(0.28, dur || clamp(0.55 + Math.log10(1 + gap) * 0.32, 0.55, 2.6)),
      arc: gap > 900 ? Math.min(gap * 0.16, 2400) : 0,
      opening: !!opening
    };
    state.transitioning = true;
  }

  function setMode(next, opts = {}) {
    if (!modes[next]) return state.mode;
    if (next === mode && !opts.force) return state.mode;
    // Let the incoming mode work out its own starting point from the live pose, then blend.
    if (next !== 'cinematic') { state.dof.enabled = false; cinematic.shot = null; state.shot = null; }
    modes[next].enter(renderPose);
    state.previousMode = mode;
    mode = next;
    state.mode = next;
    beginTransition(opts.dur);
    world.bus.emit('camera:mode', { mode: next, from: state.previousMode });
    if (ui.onMode) ui.onMode(next);
    return next;
  }

  function cycleMode(dir) {
    const order = ['planner', 'street', 'follow', 'drone', 'cinematic'];
    const i = order.indexOf(mode);
    setMode(order[(i + (dir || 1) + order.length) % order.length]);
  }

  function playShot(name, opts = {}) {
    const shot = cinematic.prepare(name, opts);
    if (!shot) { console.warn('[camera] no shot named', name); return null; }
    cinematic.shot = shot;
    cinematic.hold = false;
    state.shot = { name: shot.name, label: shot.label, note: shot.note, t: 0, duration: shot.dur };
    if (mode !== 'cinematic') setMode('cinematic', { dur: opts.transition });
    else { cinematic.enter(renderPose); beginTransition(opts.transition || 1.4); }
    world.bus.emit('camera:cinematic-start', { shot: name, label: shot.label, duration: shot.dur });
    return shot;
  }

  /* ================================================================= flyTo */

  // Height above the pivot rises monotonically with orbit distance, so a bisection always
  // lands. A fixed-point iteration does not: the tilt curve makes it oscillate.
  function distForAltitude(alt, groundY) {
    const want = alt - groundY;
    const heightAt = (d) => d * Math.sin(clamp(planner.autoPitch(d) + planner.pitchBias, 0.05, 1.52));
    if (want <= heightAt(MIN_DIST)) return MIN_DIST;
    if (want >= heightAt(MAX_DIST)) return MAX_DIST;
    let lo = MIN_DIST, hi = MAX_DIST;
    for (let i = 0; i < 44; i++) {
      const mid = Math.sqrt(lo * hi);      // bisect in log space: the zoom is exponential
      if (heightAt(mid) < want) lo = mid; else hi = mid;
    }
    return Math.sqrt(lo * hi);
  }

  /**
   * Fly the planner camera somewhere.
   *
   * Accepts `{x, z}` in local metres, `{lon, lat}`, or a place id string from `places()`, which is
   * the shape everybody reaches for first: `TWIN.camera.places()` hands back a list of ids, so
   * `TWIN.camera.flyTo('pointlookout')` looks like it should work and used to fly silently to the
   * projection origin off the west coast instead. A name that is not a place now says so and stays
   * where it is, rather than moving somewhere nobody asked for.
   */
  function flyTo(o = {}) {
    if (typeof o === 'string') o = { place: o };
    if (o.place) {
      const found = places.find((q) => q.id === o.place || q.label === o.place);
      if (!found) {
        console.warn('[camera] flyTo: no place "' + o.place + '". Try TWIN.camera.places().');
        return;
      }
      o = Object.assign({}, o, { x: found.x, z: found.z });
    }
    const p = Number.isFinite(o.x) && Number.isFinite(o.z)
      ? { x: o.x, z: o.z }
      : toLocal(Number.isFinite(o.lon) ? o.lon : ORIGIN.lon, Number.isFinite(o.lat) ? o.lat : ORIGIN.lat);
    const g = groundAt(p.x, p.z);
    if (mode !== 'planner') {
      state.previousMode = mode;
      mode = 'planner';
      state.mode = 'planner';
      state.dof.enabled = false;
      cinematic.shot = null;
      state.shot = null;
      if (ui.onMode) ui.onMode('planner');
      world.bus.emit('camera:mode', { mode: 'planner', from: state.previousMode });
    }
    planner.pivot.set(p.x, g, p.z);
    if (Number.isFinite(o.heading)) planner.yaw = (o.heading * Math.PI) / 180;
    if (Number.isFinite(o.pitchBias)) planner.pitchBias = clamp(o.pitchBias, -1.02, 0.5);
    if (Number.isFinite(o.dist)) planner.dist = clamp(o.dist, MIN_DIST, MAX_DIST);
    else if (Number.isFinite(o.alt)) planner.dist = distForAltitude(o.alt, g);
    if (Number.isFinite(o.pitch)) {
      planner.pitchBias = planner.biasFor(clamp((o.pitch * Math.PI) / 180, 0.05, 1.52), planner.dist);
    }
    planner.panVel.setAll(0); planner.yawVel = 0; planner.pitchVel = 0; planner.zoomVel = 0;
    planner.update(0);
    beginTransition(o.dur);
    return state;
  }

  /* ============================================================= bookmarks */

  const DEFAULT_HEADINGS = { dunwich: 250, amity: 318, pointlookout: 78, gorge: 44 };
  const DEFAULT_DISTS = { dunwich: 1300, amity: 1100, pointlookout: 1300, gorge: 520 };
  const bookmarks = [];
  function seedBookmarks() {
    bookmarks.length = 0;
    BOOKMARK_KEYS.forEach((id, i) => {
      const pl = places.find((p) => p.id === id) || places[i] || places[0];
      if (!pl) return;
      bookmarks.push({
        slot: i + 1,
        id: pl.id,
        label: pl.label,
        x: pl.x, z: pl.z,
        dist: DEFAULT_DISTS[id] || 1200,
        heading: DEFAULT_HEADINGS[id] || 0,
        pitchBias: -0.1
      });
    });
    try {
      const raw = localStorage.getItem('twin.camera.bookmarks');
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          for (const s of saved) {
            const b = bookmarks.find((k) => k.slot === s.slot);
            if (b && Number.isFinite(s.x)) Object.assign(b, s);
          }
        }
      }
    } catch (e) { /* private browsing, or a corrupt value: the defaults still work */ }
    state.bookmarks = bookmarks.map((b) => ({ slot: b.slot, id: b.id, label: b.label }));
  }

  function bookmark(nameOrSlot, opts = {}) {
    const b = typeof nameOrSlot === 'number'
      ? bookmarks.find((k) => k.slot === nameOrSlot)
      : bookmarks.find((k) => k.id === nameOrSlot || k.label === nameOrSlot);
    if (!b) return null;
    flyTo({ x: b.x, z: b.z, dist: b.dist, heading: b.heading, pitchBias: b.pitchBias, dur: opts.dur });
    world.bus.emit('camera:bookmark', { slot: b.slot, id: b.id, label: b.label });
    if (ui.flash) ui.flash(b.label);
    return b;
  }

  function setBookmark(slot) {
    const b = bookmarks.find((k) => k.slot === slot);
    if (!b) return null;
    b.x = planner.pivot.x; b.z = planner.pivot.z;
    b.dist = planner.dist; b.heading = (planner.yaw * 180) / Math.PI;
    b.pitchBias = planner.pitchBias;
    const near = nearestPlace(b.x, b.z);
    b.id = near ? near.id : b.id;
    b.label = near ? near.label : b.label;
    state.bookmarks = bookmarks.map((k) => ({ slot: k.slot, id: k.id, label: k.label }));
    try { localStorage.setItem('twin.camera.bookmarks', JSON.stringify(bookmarks)); } catch (e) { /* fine */ }
    if (ui.flash) ui.flash('F' + slot + ' set: ' + b.label);
    if (ui.refreshBookmarks) ui.refreshBookmarks();
    return b;
  }

  /* ============================================================ where am I */

  function nearestPlace(x, z) {
    let best = null, bestScore = Infinity;
    for (const p of places) {
      const d = Math.hypot(p.x - x, p.z - z);
      const score = d / Math.max(300, p.reach);   // a big place claims you from further out
      if (score < bestScore) { bestScore = score; best = p; best.__d = d; }
    }
    return best;
  }

  /* ================================================================== frame */

  const _sgA = new B.Vector3(); _sgA.hit = false;
  const _sgB = new B.Vector3(); _sgB.hit = false;
  const _prev = new B.Vector3();
  let scaleEvery = 0;
  let scaleBar = { px: 120, metres: 100, label: '100 m' };
  let dofEmit = 0;
  let uiEvery = 0;
  let firstFrame = true;

  function measureScale() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const cx = w * 0.5, cy = h * 0.55;
    screenGround(cx - 60, cy, _sgA);
    screenGround(cx + 60, cy, _sgB);
    if (!_sgA.hit || !_sgB.hit) return;
    const mpp = Math.hypot(_sgB.x - _sgA.x, _sgB.z - _sgA.z) / 120;
    if (!Number.isFinite(mpp) || mpp <= 0) return;
    state.metresPerPixel = mpp;
    let pick = SCALE_LADDER[0];
    for (const m of SCALE_LADDER) { if (m / mpp <= 190) pick = m; }
    scaleBar = { px: clamp(pick / mpp, 24, 200), metres: pick, label: fmtDist(pick) };
  }

  function applyPose() {
    cam.position.copyFrom(renderPose.pos);
    const dx = renderPose.target.x - renderPose.pos.x;
    const dy = renderPose.target.y - renderPose.pos.y;
    const dz = renderPose.target.z - renderPose.pos.z;
    const flat = Math.hypot(dx, dz);
    cam.rotation.y = Math.atan2(dx, dz);
    cam.rotation.x = -Math.atan2(dy, flat < 1e-5 ? 1e-5 : flat);
    cam.rotation.z = renderPose.roll;
    cam.fov = renderPose.fov;
  }

  let scaffoldChecked = false;
  function frame(_stage, _world, dtRaw) {
    const dt = clamp(dtRaw || 0.016, 0.0005, 0.06);
    now += dt;
    // Decided on the first frame, not at registration: by now every other layer exists,
    // so we can tell whether a real terrain layer has turned up.
    if (!scaffoldChecked) { scaffoldChecked = true; maybeBuildScaffold(); if (scaffold.on) ui.labels(true); }

    // An opening move that any input cuts short. It is a first impression, not a cutscene.
    if (trans && trans.opening && input.lastActionAt > 0.05) {
      trans.dur = Math.min(trans.dur, trans.t + 0.55);
      trans.opening = false;
    }

    const live = modes[mode].update(dt);

    if (trans) {
      trans.t += dt;
      const u = clamp(trans.t / trans.dur, 0, 1);
      const e = easeInOutCubic(u);
      const f = trans.from;
      renderPose.pos.set(lerp(f.pos.x, live.pos.x, e), lerp(f.pos.y, live.pos.y, e), lerp(f.pos.z, live.pos.z, e));
      renderPose.target.set(lerp(f.target.x, live.target.x, e), lerp(f.target.y, live.target.y, e), lerp(f.target.z, live.target.z, e));
      renderPose.pos.y += trans.arc * Math.sin(Math.PI * e);
      renderPose.fov = lerp(f.fov, live.fov, e);
      renderPose.roll = lerp(f.roll, live.roll, e);
      state.transitionT = u;
      if (u >= 1) { trans = null; state.transitioning = false; state.transitionT = 1; }
    } else {
      copyPose(renderPose, live);
      state.transitionT = 1;
    }

    if (firstFrame) { _prev.copyFrom(renderPose.pos); firstFrame = false; }
    const moved = B.Vector3.Distance(_prev, renderPose.pos);
    _prev.copyFrom(renderPose.pos);
    state.odometerM += moved;
    state.speedMs = moved / dt;

    applyPose();

    // Near and far planes ride the altitude, so a sign at two metres and a headland at
    // thirty kilometres are both in focus and neither z-fights.
    const groundHere = groundAt(renderPose.pos.x, renderPose.pos.z);
    const above = Math.max(0.4, renderPose.pos.y - groundHere);
    cam.minZ = clamp(above * 0.02, 0.12, 60);
    cam.maxZ = clamp(Math.max(above * 45, 9000), 9000, 260000);

    // What is under the middle of the screen, and which named place that belongs to.
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    screenGround(w * 0.5, h * 0.5, _hit);
    const near = nearestPlace(_hit.x, _hit.z);
    const la = state.lookingAt;
    la.x = _hit.x; la.z = _hit.z;
    const ll = toLonLat(_hit.x, _hit.z);
    la.lon = +ll.lon.toFixed(5); la.lat = +ll.lat.toFixed(5);
    if (near) {
      la.place = near.id; la.label = near.label; la.kind = near.kind;
      la.distanceM = Math.round(near.__d);
    }

    if (++scaleEvery % 4 === 0) measureScale();

    const p = renderPose.pos, t = renderPose.target;
    state.position.x = +p.x.toFixed(2); state.position.y = +p.y.toFixed(2); state.position.z = +p.z.toFixed(2);
    state.target.x = +t.x.toFixed(2); state.target.y = +t.y.toFixed(2); state.target.z = +t.z.toFixed(2);
    const pll = toLonLat(p.x, p.z);
    state.lonLat.lon = +pll.lon.toFixed(5); state.lonLat.lat = +pll.lat.toFixed(5);
    state.altitudeM = p.y;
    state.groundHeightM = groundHere;
    state.heightAboveGroundM = p.y - groundHere;
    state.distanceM = mode === 'planner' ? planner.dist : B.Vector3.Distance(p, t);
    state.headingDeg = ((cam.rotation.y * 180) / Math.PI + 360) % 360;
    state.pitchDeg = (-cam.rotation.x * 180) / Math.PI;
    state.fovDeg = (renderPose.fov * 180) / Math.PI;
    state.frames++;
    if (state.shot && cinematic.shot) state.shot.t = +cinematic.shot.t.toFixed(4);

    if (state.dof.enabled && now - dofEmit > 0.25) {
      dofEmit = now;
      world.bus.emit('camera:dof', {
        focusDistanceM: +state.dof.focusDistanceM.toFixed(1),
        fStop: state.dof.fStop,
        focalLengthMm: state.dof.focalLengthMm
      });
    }

    if (scaffold.frame) scaffold.frame(dt);
    if (++uiEvery % 3 === 0 && ui.update) {
      ui.update();
      if (ui.watchHint) ui.watchHint();
    }
  }

  /* ================================================================== input */

  // Pointer tuning, owned by the settings panel (src/ui/panels/settings.js) and reached only
  // through the bus, the same way the quality tier reaches postfx.js. Panning is deliberately
  // not scaled: a pan holds the ground under the pointer and has to track it exactly, so a
  // sensitivity multiplier there would make the island slide out from under your hand.
  const TUNE = { orbit: 1, look: 1, zoom: 1, invertX: false, invertY: false };
  world.bus.on('ui:intent', (p) => {
    if (!p || p.kind !== 'camera:tune') return;
    if (Number.isFinite(p.orbit)) TUNE.orbit = clamp(p.orbit, 0.2, 3);
    if (Number.isFinite(p.look)) TUNE.look = clamp(p.look, 0.2, 3);
    if (Number.isFinite(p.zoom)) TUNE.zoom = clamp(p.zoom, 0.2, 3);
    if (typeof p.invertX === 'boolean') TUNE.invertX = p.invertX;
    if (typeof p.invertY === 'boolean') TUNE.invertY = p.invertY;
  });

  const _anchor = new B.Vector3(); _anchor.hit = false;
  const listeners = [];
  function on(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  }

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    input.px = e.clientX - r.left;
    input.py = e.clientY - r.top;
  }

  function startPan(px, py) {
    screenGround(px, py, _anchor);
    if (!_anchor.hit) return null;
    return { kind: 'pan', ax: _anchor.x, az: _anchor.z, planeY: _anchor.y, dx: 0, dy: 0, vx: 0, vz: 0 };
  }

  function endDrag() {
    const d = input.drag;
    if (d && d.kind === 'pan' && mode === 'planner') {
      // Throw the island: momentum carries the pan on, weighted by how far out you are.
      planner.panVel.x += clamp(d.vx || 0, -planner.dist * 1.4, planner.dist * 1.4) * 0.62;
      planner.panVel.z += clamp(d.vz || 0, -planner.dist * 1.4, planner.dist * 1.4) * 0.62;
    }
    input.drag = null;
  }

  on(canvas, 'contextmenu', (e) => e.preventDefault());

  on(canvas, 'pointerdown', (e) => {
    canvasXY(e);
    input.inside = true;
    input.lastMoveAt = now;
    markAction();
    input.touch = e.pointerType === 'touch';
    input.pointers.set(e.pointerId, { x: input.px, y: input.py });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }

    if (input.pointers.size === 2) {
      // Two fingers: pan by the midpoint and pinch by the spread.
      const pts = [...input.pointers.values()];
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      input.px = mx; input.py = my;
      input.pinch = { spread: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
      input.drag = startPan(mx, my) || { kind: 'orbit', dx: 0, dy: 0 };
      return;
    }
    if (input.pointers.size > 2) return;

    const orbitButton = e.button === 2 || e.button === 1 || e.altKey;
    if (mode === 'street' || mode === 'drone') {
      input.drag = { kind: 'look', dx: 0, dy: 0 };
      if (!input.locked) { try { canvas.requestPointerLock(); } catch (err) { /* drag-look still works */ } }
    } else if (mode === 'follow' || orbitButton || (input.touch && mode === 'planner')) {
      input.drag = { kind: 'orbit', dx: 0, dy: 0 };
    } else {
      input.drag = startPan(input.px, input.py) || { kind: 'orbit', dx: 0, dy: 0 };
    }
  });

  on(canvas, 'pointermove', (e) => {
    if (input.locked) {
      input.lookDx += e.movementX || 0;
      input.lookDy += e.movementY || 0;
      input.lastMoveAt = now;
      return;
    }
    const prevX = input.px, prevY = input.py;
    canvasXY(e);
    input.inside = true;
    input.lastMoveAt = now;
    const rec = input.pointers.get(e.pointerId);
    if (rec) { rec.x = input.px; rec.y = input.py; }

    if (input.pointers.size >= 2) {
      const pts = [...input.pointers.values()];
      const spread = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      input.px = (pts[0].x + pts[1].x) / 2;
      input.py = (pts[0].y + pts[1].y) / 2;
      if (input.pinch && spread > 4 && input.pinch.spread > 4) {
        const mult = input.pinch.spread / spread;
        if (mode === 'planner') planner.zoomAt(clamp(mult, 0.5, 2), null);
        else if (mode === 'follow') follow.armDist = clamp(follow.armDist * clamp(mult, 0.5, 2), 3.5, 400);
        input.pinch.spread = spread;
      }
      return;
    }
    if (!input.drag) return;
    markAction();
    const sx = TUNE.invertX ? -1 : 1;
    const sy = TUNE.invertY ? -1 : 1;
    if (input.drag.kind === 'look') {
      input.lookDx += (input.px - prevX) * TUNE.look * sx;
      input.lookDy += (input.py - prevY) * TUNE.look * sy;
    } else if (input.drag.kind === 'orbit') {
      input.drag.dx += (input.px - prevX) * TUNE.orbit * sx;
      input.drag.dy += (input.py - prevY) * TUNE.orbit * sy;
    }
  });

  function releasePointer(e) {
    input.pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    if (input.pointers.size < 2) input.pinch = null;
    if (input.pointers.size === 0) endDrag();
  }
  on(canvas, 'pointerup', releasePointer);
  on(canvas, 'pointercancel', releasePointer);
  on(canvas, 'pointerleave', (e) => { if (!input.drag) input.inside = false; });
  on(canvas, 'pointerenter', () => { input.inside = true; });
  on(window, 'blur', () => { input.keys.clear(); endDrag(); input.pointers.clear(); input.inside = false; });

  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    canvasXY(e);
    input.inside = true;
    input.lastMoveAt = now;
    markAction();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const notches = clamp((e.deltaY * unit * TUNE.zoom) / 100, -3, 3);
    if (mode === 'planner' || mode === 'follow') input.wheel += notches;
    else input.lens = clamp(input.lens * Math.exp(notches * 0.13), 0.2, 1); // on foot and in the air the wheel is a lens
  }, { passive: false });

  on(document, 'pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked && input.drag && input.drag.kind === 'look') input.drag = null;
  });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  on(window, 'keydown', (e) => {
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.metaKey || e.ctrlKey) return;
    input.keys.add(e.code);
    markAction();
    const shift = e.shiftKey;

    if (e.code === 'Tab') { e.preventDefault(); cycleMode(shift ? -1 : 1); return; }
    if (/^(Digit|Numpad)[1-5]$/.test(e.code)) {
      const n = Number(e.code.slice(-1));
      if (e.altKey) { if (n <= 4) { e.preventDefault(); bookmark(n); } return; }
      if (world.flags && world.flags.has('camera-no-number-keys')) return;
      setMode(['planner', 'street', 'follow', 'drone', 'cinematic'][n - 1]);
      return;
    }
    if (/^F[1-4]$/.test(e.code)) {
      e.preventDefault();
      const slot = Number(e.code.slice(1));
      if (shift) setBookmark(slot); else bookmark(slot);
      return;
    }
    switch (e.code) {
      case 'KeyP': e.preventDefault(); ui.photo(!state.photoMode); break;
      case 'KeyL': ui.labels(!state.labels); break;
      case 'KeyH': ui.hud(); break;
      case 'KeyB': ui.letterbox(!state.letterbox); break;
      case 'KeyC': nextShot(); break;
      case 'Home': e.preventDefault(); frameIsland(); break;
      case 'Space': if (mode === 'drone') e.preventDefault(); break;
      case 'Escape':
        if (state.photoMode) ui.photo(false);
        else if (mode === 'cinematic') setMode(state.previousMode || 'planner');
        break;
      default: break;
    }
  });
  on(window, 'keyup', (e) => { input.keys.delete(e.code); });

  const SHOT_ORDER = Object.keys(SHOTS);
  let shotIndex = -1;
  function nextShot() {
    shotIndex = (shotIndex + 1) % SHOT_ORDER.length;
    playShot(SHOT_ORDER[shotIndex]);
  }

  function frameIsland() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of places) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    if (!Number.isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
    const span = Math.max(maxX - minX, maxZ - minZ, 4000);
    flyTo({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, dist: clamp(span * 1.15, 4000, MAX_DIST), heading: 8, pitchBias: -0.3 });
    if (ui.flash) ui.flash('Whole island');
  }

  /* =============================================================== scaffold */

  // A survey rig, not the island. It appears only while no terrain layer is loaded, so the
  // camera can still be flown, measured and judged against something with scale and relief.
  // The moment world.island.height or a terrain layer exists, none of this is built.
  const scaffold = { on: false, frame: null, meshes: [], dolly: null };
  const FOG = new B.Color3(0.043, 0.078, 0.098);

  function buildScaffold() {
    scaffoldOn = true;
    scaffold.on = true;
    state.terrainSource = 'camera-scaffold-calibration';

    B.Effect.ShadersStore.minjSurveyVertexShader = [
      'precision highp float;',
      'attribute vec3 position; attribute vec3 normal;',
      'uniform mat4 world; uniform mat4 worldViewProjection;',
      'varying vec3 vPos; varying vec3 vNorm;',
      'void main(void){',
      '  vec4 wp = world * vec4(position, 1.0);',
      '  vPos = wp.xyz;',
      '  vNorm = normalize((world * vec4(normal, 0.0)).xyz);',
      '  gl_Position = worldViewProjection * vec4(position, 1.0);',
      '}'
    ].join('\n');

    B.Effect.ShadersStore.minjSurveyFragmentShader = [
      'precision highp float;',
      'varying vec3 vPos; varying vec3 vNorm;',
      'uniform vec3 uCam; uniform float uPixel; uniform vec3 uFog; uniform float uRings;',
      'float lineAt(float c, float period, float w){',
      '  if (w > period * 0.3) return 0.0;',   // a line wider than its spacing is noise, not a grid
      '  float d = abs(mod(c + period * 0.5, period) - period * 0.5);',
      '  return 1.0 - smoothstep(w * 0.5, w * 1.5, d);',
      '}',
      'void main(void){',
      '  float dist = distance(vPos, uCam);',
      '  vec3 n = normalize(vNorm);',
      // Line width in world metres, widened by how close to edge on the surface is. A line
      // whose footprint no longer fits between its neighbours is dropped rather than aliased.
      '  float graze = max(abs(dot(normalize(uCam - vPos), n)), 0.02);',
      '  float w = max(uPixel * dist * 1.25 / graze, 0.015);',
      '  float vfine = max(lineAt(vPos.x, 1.0, w), lineAt(vPos.z, 1.0, w));',
      '  float fine  = max(lineAt(vPos.x, 10.0, w), lineAt(vPos.z, 10.0, w));',
      '  float minor = max(lineAt(vPos.x, 100.0, w), lineAt(vPos.z, 100.0, w));',
      '  float major = max(lineAt(vPos.x, 1000.0, w), lineAt(vPos.z, 1000.0, w));',
      '  float huge  = max(lineAt(vPos.x, 10000.0, w), lineAt(vPos.z, 10000.0, w));',
      '  float cont  = lineAt(vPos.y, 10.0, w * 0.3 + 0.05);',
      '  float vfineFade = 1.0 - smoothstep(6.0, 26.0, dist);',
      '  float fineFade  = 1.0 - smoothstep(60.0, 260.0, dist);',
      '  float minorFade = 1.0 - smoothstep(500.0, 2000.0, dist);',
      '  float contFade  = 1.0 - smoothstep(2200.0, 8000.0, dist);',
      '  vec3 low = vec3(0.036,0.062,0.078);',
      '  vec3 high = vec3(0.115,0.132,0.128);',
      '  vec3 base = mix(low, high, clamp(vPos.y/70.0, 0.0, 1.0));',
      '  float ndl = max(dot(n, normalize(vec3(-0.38,0.86,0.34))), 0.0);',
      '  float rim = pow(1.0 - abs(n.y), 2.0);',
      '  base *= 0.34 + 1.35 * ndl;',
      '  base += vec3(0.055,0.044,0.026) * rim * ndl;',
      '  vec3 sea = vec3(0.247,0.714,0.769);',
      '  vec3 sand = vec3(0.910,0.863,0.769);',
      '  float gz = smoothstep(0.02, 0.12, graze);',
      '  vec3 col = base;',
      '  col = mix(col, sea, minor * 0.16 * minorFade * gz);',
      '  col = mix(col, sand * 0.6, cont * 0.15 * contFade * gz);',
      '  col = mix(col, sea, major * 0.40 * gz);',
      '  col = mix(col, sand, huge * 0.52 * gz);',
      '  float r = length(vPos.xz);',
      '  float ring = 0.0;',
      '  ring = max(ring, 1.0 - smoothstep(w*0.6, w*1.9, abs(r - 5000.0)));',
      '  ring = max(ring, 1.0 - smoothstep(w*0.6, w*1.9, abs(r - 10000.0)));',
      '  ring = max(ring, 1.0 - smoothstep(w*0.6, w*1.9, abs(r - 20000.0)));',
      '  col = mix(col, vec3(0.941,0.706,0.161), ring * 0.28 * uRings * gz);',
      '  float f = 1.0 - exp(-0.000045 * dist);',
      '  col = mix(col, uFog, clamp(f, 0.0, 1.0));',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');

    const mat = new B.ShaderMaterial('survey', scene, 'minjSurvey', {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uPixel', 'uFog', 'uRings']
    });
    mat.setVector3('uCam', new B.Vector3(0, 0, 0));
    mat.setFloat('uPixel', 0.001);
    mat.setColor3('uFog', FOG);
    mat.setFloat('uRings', 1);
    mat.backFaceCulling = true;

    const SIZE = 40000, SUB = 320;
    const ground = B.MeshBuilder.CreateGround('survey-ground', { width: SIZE, height: SIZE, subdivisions: SUB, updatable: true }, scene);
    const pos = ground.getVerticesData(B.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = scaffoldHeight(pos[i], pos[i + 2]);
    ground.updateVerticesData(B.VertexBuffer.PositionKind, pos);
    const norms = new Float32Array(pos.length);
    B.VertexData.ComputeNormals(pos, ground.getIndices(), norms);
    ground.setVerticesData(B.VertexBuffer.NormalKind, norms);
    ground.material = mat;
    ground.isPickable = false;
    ground.freezeWorldMatrix();
    scaffold.meshes.push(ground);

    const skirt = B.MeshBuilder.CreateGround('survey-skirt', { width: 260000, height: 260000, subdivisions: 24 }, scene);
    skirt.position.y = -0.75;
    skirt.material = mat;
    skirt.isPickable = false;
    skirt.freezeWorldMatrix();
    scaffold.meshes.push(skirt);

    // Place pins: one line mesh for the lot, so the whole set costs a single draw call.
    const lines = [], colours = [];
    const seaC = new B.Color4(0.247, 0.714, 0.769, 0.85);
    const sunC = new B.Color4(0.941, 0.706, 0.161, 0.95);
    for (const p of places) {
      const bm = BOOKMARK_KEYS.includes(p.id);
      const c = bm ? sunC : seaC;
      const g = groundAt(p.x, p.z);
      const h = bm ? 320 : 190;
      lines.push([new B.Vector3(p.x, g, p.z), new B.Vector3(p.x, g + h, p.z)]);
      colours.push([new B.Color4(c.r, c.g, c.b, 0.15), c]);
      const ring = [], rc = [];
      const rad = bm ? 90 : 55;
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rx = p.x + Math.cos(a) * rad, rz = p.z + Math.sin(a) * rad;
        ring.push(new B.Vector3(rx, groundAt(rx, rz) + 1.5, rz));
        rc.push(c);
      }
      lines.push(ring);
      colours.push(rc);
    }
    const pins = B.MeshBuilder.CreateLineSystem('survey-pins', { lines, colors: colours, useVertexAlpha: true }, scene);
    pins.isPickable = false;
    pins.alwaysSelectAsActiveMesh = true;
    scaffold.meshes.push(pins);

    // A calibration dolly, so follow mode has something to lock onto before the vehicle,
    // ferry and resident layers exist. It moves on the simulation clock, so it stops when
    // the island is paused, which is the honest behaviour.
    const dolly = B.MeshBuilder.CreateBox('survey-dolly', { size: 4 }, scene);
    const dm = new B.StandardMaterial('survey-dolly-mat', scene);
    dm.emissiveColor = new B.Color3(0.94, 0.71, 0.16);
    dm.diffuseColor = new B.Color3(0.2, 0.16, 0.05);
    dm.specularColor = new B.Color3(0, 0, 0);
    dolly.material = dm;
    dolly.isPickable = false;
    scaffold.dolly = dolly;
    scaffold.meshes.push(dolly);

    scene.clearColor = new B.Color4(FOG.r, FOG.g, FOG.b, 1);

    const _dp = new B.Vector3();
    function dollyPos(out) {
      const c = world.clock;
      const base = places.find((p) => p.id === 'dunwich') || places[0] || { x: 0, z: 0 };
      const u = ((c.tick + (c.accumulator || 0)) / 400) * Math.PI * 2;
      out.set(base.x + Math.sin(u) * 1500, 0, base.z + Math.sin(u * 2) * 800);
      out.y = groundAt(out.x, out.z) + 2;
      return out;
    }
    if (!follow.get) {
      follow.setTarget(() => dollyPos(_dp), 'Calibration dolly');
    }

    scaffold.frame = () => {
      mat.setVector3('uCam', renderPose.pos);
      const h = stage.engine.getRenderHeight() || 900;
      mat.setFloat('uPixel', (2 * Math.tan(renderPose.fov / 2)) / h);
      dollyPos(_dp);
      dolly.position.copyFrom(_dp);
    };
  }

  function maybeBuildScaffold() {
    const params = new URLSearchParams(location.search);
    if (params.get('scaffold') === '0') return;
    const hasTerrain = !!(world.island && typeof world.island.height === 'function') || !!stage.layer('terrain');
    if (hasTerrain && params.get('scaffold') !== '1') return;
    try { buildScaffold(); } catch (e) { console.warn('[camera] survey scaffold skipped:', e && e.message); }
  }

  /* ===================================================================== ui */

  // When something else on the page claims the number keys (the HUD uses 0 to 4 for simulation
  // speed, the way every city builder does), this rig stops acting on them. The rail and the
  // opening hint stop advertising them too: a key chip on a button that does nothing is worse
  // than no chip at all. Tab still cycles the modes and the buttons still work.
  const noNumberKeys = () => !!(world.flags && world.flags.has('camera-no-number-keys'));

  const MODE_LABELS = {
    planner: ['Planner', '1'], street: ['Street', '2'], follow: ['Follow', '3'],
    drone: ['Drone', '4'], cinematic: ['Cinematic', '5']
  };

  const ui = {};
  const labelNodes = [];
  let hudHidden = false;
  let flashTimer = 0;

  const CSS = `
#cam-ui{position:fixed;inset:0;pointer-events:none;z-index:22;font-family:var(--f-ui,system-ui)}
#cam-ui .pe{pointer-events:auto}
#cam-rail{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;
  padding:5px 7px;background:var(--s-1,rgba(16,21,25,.86));backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge,rgba(232,220,196,.13));border-radius:var(--r-pill,99px);box-shadow:var(--shadow-2);
  transition:opacity .3s var(--ease),transform .3s var(--ease)}
#cam-rail button{appearance:none;background:transparent;border:1px solid transparent;color:var(--t-dim,#9aa3a8);
  font:600 11px/1 var(--f-ui,system-ui);letter-spacing:.07em;padding:6px 10px;border-radius:var(--r-pill,99px);
  cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;transition:all .12s var(--ease)}
#cam-rail button:hover{color:var(--t-hi,#f2ebdc);background:rgba(255,255,255,.07)}
#cam-rail button.on{background:var(--sea,#3fb6c4);border-color:var(--sea,#3fb6c4);color:#08110f}
#cam-rail button kbd{font:600 9px/1 var(--f-num,monospace);opacity:.62;border:1px solid currentColor;border-radius:3px;padding:1px 3px}
#cam-rail .sep{width:1px;height:18px;background:var(--edge,rgba(232,220,196,.16));margin:0 2px;flex:0 0 auto}
#cam-rail{flex-wrap:nowrap;max-width:calc(100vw - 16px);overflow-x:auto;scrollbar-width:none}
#cam-rail::-webkit-scrollbar{display:none}
#cam-bm{display:flex;align-items:center;gap:5px;flex:0 0 auto}
#cam-compass{width:26px;height:26px;margin:0 3px 0 2px;flex:0 0 auto}
#cam-read{position:fixed;left:50%;bottom:58px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;
  padding:5px 12px;border-radius:var(--r-pill,99px);background:rgba(8,12,15,.5);backdrop-filter:blur(8px);
  border:1px solid rgba(232,220,196,.09);transition:opacity .3s var(--ease);
  flex-wrap:wrap;justify-content:center;max-width:min(720px,calc(100vw - 16px))}
#cam-read .place{font:600 12px/1 var(--f-ui,system-ui);color:var(--t-hi,#f2ebdc);letter-spacing:.02em}
#cam-read .met{font:400 11px/1 var(--f-num,monospace);color:var(--t-dim,#9aa3a8);font-variant-numeric:tabular-nums}
#cam-read .met b{color:var(--sand,#e8dcc4);font-weight:400}
#cam-scale{display:flex;flex-direction:column;align-items:center;gap:2px}
#cam-scale .bar{height:6px;border-left:1px solid var(--sand,#e8dcc4);border-right:1px solid var(--sand,#e8dcc4);
  border-bottom:1px solid var(--sand,#e8dcc4);opacity:.75;transition:width .18s var(--ease)}
#cam-scale .lab{font:400 9px/1 var(--f-num,monospace);color:var(--t-faint,#6d767c);letter-spacing:.08em}
#cam-flash{position:fixed;left:50%;top:14%;transform:translateX(-50%) translateY(-6px);opacity:0;
  font:600 12px/1 var(--f-ui,system-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--sand,#e8dcc4);
  padding:7px 16px;border-radius:var(--r-pill,99px);background:rgba(8,12,15,.55);border:1px solid rgba(232,220,196,.12);
  backdrop-filter:blur(8px);transition:opacity .25s var(--ease),transform .25s var(--ease)}
#cam-flash.on{opacity:1;transform:translateX(-50%) translateY(0)}
#cam-hint{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);width:min(560px,92vw);
  background:var(--s-2,rgba(24,31,36,.95));backdrop-filter:var(--blur);border:1px solid var(--edge-strong,rgba(232,220,196,.26));
  border-radius:var(--r-3,10px);box-shadow:var(--shadow-3);padding:14px 16px;color:var(--t,#ddd4c2)}
#cam-hint h4{font:600 10px/1 var(--f-ui,system-ui);letter-spacing:.2em;text-transform:uppercase;color:var(--sea,#3fb6c4);margin-bottom:10px}
#cam-hint .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 18px}
#cam-hint .k{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t-dim,#9aa3a8)}
#cam-hint .k kbd{font:600 10px/1 var(--f-num,monospace);color:var(--t-hi,#f2ebdc);background:rgba(255,255,255,.07);
  border:1px solid var(--edge,rgba(232,220,196,.16));border-radius:3px;padding:3px 5px;min-width:20px;text-align:center}
#cam-hint .close{margin-top:12px;font-size:10.5px;color:var(--t-faint,#6d767c);letter-spacing:.1em;text-transform:uppercase}
#cam-labels{position:fixed;inset:0;overflow:hidden}
#cam-labels .lb{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;
  font:600 10.5px/1 var(--f-ui,system-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--sand,#e8dcc4);
  text-shadow:0 1px 6px rgba(0,0,0,.9);padding-bottom:5px}
#cam-labels .lb i{display:block;font:400 9px/1 var(--f-num,monospace);letter-spacing:.06em;text-transform:none;
  color:var(--t-faint,#8b949a);margin-top:3px}
#cam-labels .lb.bm{color:var(--sun,#f0b429)}
#cam-bars{position:fixed;inset:0;opacity:0;transition:opacity .5s var(--ease)}
#cam-bars.on{opacity:1}
#cam-bars i{position:absolute;left:0;right:0;height:11.6%;background:#000}
#cam-bars i.t{top:0}#cam-bars i.b{bottom:0}
#cam-reticle{position:fixed;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;
  background:rgba(232,220,196,.55);box-shadow:0 0 0 1px rgba(0,0,0,.4);opacity:0;transition:opacity .3s}
#cam-reticle.on{opacity:1}
#cam-photo{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:none;align-items:center;gap:14px;
  padding:9px 16px;background:var(--s-1,rgba(16,21,25,.86));backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge,rgba(232,220,196,.13));border-radius:var(--r-pill,99px);box-shadow:var(--shadow-2);z-index:40}
#cam-photo.on{display:flex}
#cam-photo label{font:600 9px/1 var(--f-ui,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--t-faint,#6d767c)}
#cam-photo input[type=range]{width:210px;accent-color:var(--sun,#f0b429);cursor:pointer}
#cam-photo .clk{font:400 13px/1 var(--f-num,monospace);color:var(--t-hi,#f2ebdc);min-width:64px;text-align:center}
#cam-photo button{appearance:none;background:var(--s-sunk,rgba(6,9,11,.5));border:1px solid var(--edge-strong,rgba(232,220,196,.26));
  color:var(--t,#ddd4c2);font:600 11px/1 var(--f-ui,system-ui);letter-spacing:.08em;padding:7px 12px;border-radius:var(--r-pill,99px);
  cursor:pointer;white-space:nowrap}
#cam-photo button:hover{background:rgba(63,182,196,.16);border-color:var(--sea,#3fb6c4);color:var(--t-hi,#f2ebdc)}
#cam-photo button.shutter{background:var(--sand,#e8dcc4);border-color:var(--sand,#e8dcc4);color:#0a0d10}
#cam-photo button[hidden]{display:none}
/* Photo mode hides the bar, so it carries the bar's own statement about what kind of moment this
   is. Same three words, same tones: sea for live, sun for a moment nobody has been to, iron for a
   simulation running forward. */
#cam-photo .when{font:700 9px/1.5 var(--f-ui,system-ui);letter-spacing:.14em;text-transform:uppercase;
  padding:5px 9px;border-radius:var(--r-pill,99px);white-space:nowrap;
  border:1px solid var(--edge,rgba(232,220,196,.13));color:var(--t-faint,#6d767c)}
#cam-photo .when.live{color:var(--sea,#3fb6c4);border-color:rgba(63,182,196,.42);background:rgba(63,182,196,.1)}
#cam-photo .when.scrub{color:var(--sun,#f0b429);border-color:rgba(240,180,41,.45);background:rgba(240,180,41,.1)}
#cam-photo .when.sim{color:var(--t,#ddd4c2)}
.cam-hidden{opacity:0!important;pointer-events:none!important}
@media (max-width:900px){#cam-rail button span{display:none}#cam-rail button{padding:6px 8px}#cam-read{gap:8px;bottom:56px}}
`;

  function buildUI() {
    const style = document.createElement('style');
    style.id = 'cam-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'cam-ui';
    root.innerHTML = `
<div id="cam-labels"></div>
<div id="cam-bars"><i class="t"></i><i class="b"></i></div>
<div id="cam-reticle"></div>
<div id="cam-flash"></div>
<div id="cam-read" class="pe">
  <span class="place">Minjerribah</span>
  <span class="met" id="cam-met"></span>
  <span id="cam-scale"><span class="bar" style="width:120px"></span><span class="lab">1 km</span></span>
</div>
<div id="cam-rail" class="pe">
  <svg id="cam-compass" viewBox="-13 -13 26 26" aria-hidden="true">
    <circle r="11.4" fill="none" stroke="rgba(232,220,196,.22)" stroke-width="1"></circle>
    <path d="M0,-8.6 L3.1,2.2 L0,0.5 L-3.1,2.2 Z" fill="#e2725b"></path>
    <path d="M0,8.6 L3.1,-2.2 L0,-0.5 L-3.1,-2.2 Z" fill="rgba(140,153,163,.55)"></path>
  </svg>
  <span class="sep"></span>
  ${Object.keys(MODE_LABELS).map((m) => `<button data-mode="${m}">${noNumberKeys() ? '' : `<kbd>${MODE_LABELS[m][1]}</kbd>`}<span>${MODE_LABELS[m][0]}</span></button>`).join('')}
  <span class="sep"></span>
  <span id="cam-bm"></span>
  <span class="sep"></span>
  <button data-act="photo" title="Photo mode"><kbd>P</kbd><span>Photo</span></button>
</div>
<div id="cam-photo">
  <label for="cam-tod">Time</label>
  <input id="cam-tod" type="range" min="0" max="1430" step="10" value="320">
  <span class="clk" id="cam-clk">5:20am</span>
  <span class="when" id="cam-when"></span>
  <button data-act="now" id="cam-now">Back to now</button>
  <button data-act="bars">Bars</button>
  <button class="shutter" data-act="shot">Capture</button>
  <button data-act="exit">Done</button>
</div>`;
    document.body.appendChild(root);

    const $ = (s) => root.querySelector(s);
    const railBtns = [...root.querySelectorAll('#cam-rail button[data-mode]')];
    const bmWrap = $('#cam-bm');
    const readEl = $('#cam-read');
    const railEl = $('#cam-rail');
    const placeEl = $('#cam-read .place');
    const metEl = $('#cam-met');
    const scaleBarEl = $('#cam-scale .bar');
    const scaleLabEl = $('#cam-scale .lab');
    const compassEl = $('#cam-compass');
    const flashEl = $('#cam-flash');
    const labelsEl = $('#cam-labels');
    const barsEl = $('#cam-bars');
    const reticleEl = $('#cam-reticle');
    const photoEl = $('#cam-photo');
    const todEl = $('#cam-tod');
    const clkEl = $('#cam-clk');
    const whenEl = $('#cam-when');
    const nowBtn = $('#cam-now');

    railBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    // The rig is registered before the UI panels are, so the flag can be set after this rail is
    // built. Re-read it once the app says it is ready and take the chips off then.
    ui.releaseNumberKeys = () => {
      if (!noNumberKeys()) return;
      for (const k of root.querySelectorAll('#cam-rail button[data-mode] kbd')) k.remove();
      const hintKeys = root.querySelector('#cam-hint .grid');
      if (hintKeys) {
        for (const row of hintKeys.querySelectorAll('.k')) {
          if (/planner, street/.test(row.textContent)) row.innerHTML = '<kbd>Tab</kbd> planner, street, follow, drone, cinematic';
        }
      }
    };
    root.querySelector('[data-act="photo"]').addEventListener('click', () => ui.photo(!state.photoMode));
    photoEl.querySelector('[data-act="exit"]').addEventListener('click', () => ui.photo(false));
    photoEl.querySelector('[data-act="bars"]').addEventListener('click', () => ui.letterbox(!state.letterbox));
    photoEl.querySelector('[data-act="shot"]').addEventListener('click', () => ui.download());
    todEl.addEventListener('input', () => scrubTime(Number(todEl.value)));
    nowBtn.addEventListener('click', () => {
      if (world.time) world.time.toPresent();
      ui.paintPhotoTime();
    });

    /**
     * Photo mode hides the whole interface, including the bar that says what kind of moment you
     * are looking at, so photo mode has to say it itself. Same three words the bar uses, from the
     * same clock, beside the same date: a photographer must not be the one person on this island
     * who cannot tell a projection from the real thing.
     */
    ui.paintPhotoTime = () => {
      const c = world.clock;
      clkEl.textContent = c.format();
      const scrubbing = c.scrubbing;
      const word = scrubbing
        ? (c.viewOffsetMin > 0 ? 'PROJECTION' : 'LOOKING BACK')
        : (c.mode === 'live' ? 'LIVE' : 'SIMULATED');
      const tone = scrubbing ? 'scrub' : (c.mode === 'live' ? 'live' : 'sim');
      const text = word + '  ' + c.formatDate();
      if (whenEl.textContent !== text) whenEl.textContent = text;
      if (whenEl.__tone !== tone) { whenEl.__tone = tone; whenEl.className = 'when ' + tone; }
      const showNow = scrubbing;
      if (nowBtn.__show !== showNow) { nowBtn.__show = showNow; nowBtn.hidden = !showNow; }
      const v = String(Math.round(c.minuteOfDay / 10) * 10);
      if (todEl.value !== v) todEl.value = v;
    };

    ui.refreshBookmarks = () => {
      bmWrap.innerHTML = bookmarks.map((b) =>
        `<button data-bm="${b.slot}" title="${b.label}"><kbd>F${b.slot}</kbd><span>${b.label.split(' (')[0]}</span></button>`).join('');
      [...bmWrap.querySelectorAll('button')].forEach((b) =>
        b.addEventListener('click', () => bookmark(Number(b.dataset.bm))));
    };
    ui.refreshBookmarks();

    for (const p of places) {
      const n = document.createElement('div');
      n.className = 'lb' + (BOOKMARK_KEYS.includes(p.id) ? ' bm' : '');
      n.innerHTML = `${p.label}<i></i>`;
      n.style.display = 'none';
      labelsEl.appendChild(n);
      labelNodes.push({ node: n, sub: n.querySelector('i'), place: p });
    }

    ui.onMode = (m) => {
      railBtns.forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
      reticleEl.classList.toggle('on', m === 'street' || m === 'drone');
      ui.letterbox(m === 'cinematic');
      if (m === 'planner') input.lens = 1;
    };

    ui.flash = (msg) => {
      flashEl.textContent = msg;
      flashEl.classList.add('on');
      flashTimer = now + 1.6;
    };

    ui.letterbox = (v) => {
      state.letterbox = !!v;
      barsEl.classList.toggle('on', state.letterbox);
    };

    ui.labels = (v) => {
      state.labels = !!v;
      labelsEl.style.display = state.labels ? '' : 'none';
    };

    ui.hud = () => {
      hudHidden = !hudHidden;
      railEl.classList.toggle('cam-hidden', hudHidden);
      readEl.classList.toggle('cam-hidden', hudHidden);
    };

    ui.photo = (v) => {
      state.photoMode = !!v;
      const uiRoot = document.getElementById('ui-root');
      if (uiRoot) uiRoot.style.display = state.photoMode ? 'none' : '';
      railEl.classList.toggle('cam-hidden', state.photoMode || hudHidden);
      readEl.classList.toggle('cam-hidden', state.photoMode || hudHidden);
      photoEl.classList.toggle('on', state.photoMode);
      if (state.photoMode) {
        ui.paintPhotoTime();
        dismissHint();
      }
      world.bus.emit('camera:photo', { on: state.photoMode });
    };

    ui.download = () => {
      const url = ui.capture();
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'minjerribah-' + (state.lookingAt.place || 'island') + '-' +
        world.clock.format().replace(/[:\s]/g, '') + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      ui.flash('Captured');
    };

    ui.capture = () => {
      try {
        stage.render(0.016);
        return canvas.toDataURL('image/png');
      } catch (e) {
        console.warn('[camera] capture failed', e && e.message);
        return null;
      }
    };

    const vp = new B.Viewport(0, 0, 1, 1);
    const _proj = new B.Vector3();
    const _wp = new B.Vector3();

    ui.update = () => {
      if (flashTimer && now > flashTimer) { flashEl.classList.remove('on'); flashTimer = 0; }
      compassEl.style.transform = 'rotate(' + (-state.headingDeg).toFixed(1) + 'deg)';
      if (!state.photoMode && !hudHidden) {
        const la = state.lookingAt;
        placeEl.textContent = la.label || 'Minjerribah';
        metEl.innerHTML = 'alt <b>' + fmtAlt(state.altitudeM) + '</b> &nbsp;ground <b>' +
          Math.round(state.groundHeightM) + ' m</b> &nbsp;hdg <b>' +
          String(Math.round(state.headingDeg)).padStart(3, '0') + '&deg;</b>' +
          (la.distanceM ? ' &nbsp;' + fmtDist(la.distanceM) + ' away' : '') +
          (input.lens < 0.98 ? ' &nbsp;lens <b>' + (1 / input.lens).toFixed(1) + '&times;</b>' : '');
        scaleBarEl.style.width = Math.round(scaleBar.px) + 'px';
        scaleLabEl.textContent = scaleBar.label;
      }
      if (state.photoMode) ui.paintPhotoTime();

      if (!state.labels || state.photoMode) return;
      const w = stage.engine.getRenderWidth(), h = stage.engine.getRenderHeight();
      const dpr = w / Math.max(1, canvas.clientWidth);
      vp.width = w; vp.height = h;
      const tm = scene.getTransformMatrix();
      const camAbove = Math.max(20, state.heightAboveGroundM);
      const reach = camAbove * 16 + 2600;
      // Nearest first, so when two labels collide the one you are closer to survives.
      const cand = [];
      for (const l of labelNodes) {
        const p = l.place;
        const d = Math.hypot(p.x - renderPose.pos.x, p.z - renderPose.pos.z);
        // A small beach stops shouting once you are a long way up; a township keeps its name.
        if (d > reach || p.reach * 30 < camAbove) { l.node.style.display = 'none'; continue; }
        // The name rides up the pin as you climb, and sits near the ground when you are on it.
        const pinH = BOOKMARK_KEYS.includes(p.id) ? 320 : 190;
        _wp.set(p.x, groundAt(p.x, p.z) + Math.min(pinH, Math.max(22, camAbove * 0.5)), p.z);
        B.Vector3.ProjectToRef(_wp, B.Matrix.IdentityReadOnly, tm, vp, _proj);
        if (_proj.z < 0 || _proj.z > 1 || _proj.x < -80 || _proj.x > w + 80 || _proj.y < -40 || _proj.y > h + 40) {
          l.node.style.display = 'none';
          continue;
        }
        cand.push({ l, d, x: _proj.x / dpr, y: _proj.y / dpr });
      }
      cand.sort((a, b) => a.d - b.d);
      placed.length = 0;
      for (const c of cand) {
        let clash = false;
        for (const q of placed) {
          if (Math.abs(q.x - c.x) < 96 && Math.abs(q.y - c.y) < 26) { clash = true; break; }
        }
        if (clash) { c.l.node.style.display = 'none'; continue; }
        placed.push(c);
        c.l.node.style.display = '';
        c.l.node.style.left = c.x.toFixed(1) + 'px';
        c.l.node.style.top = c.y.toFixed(1) + 'px';
        c.l.node.style.opacity = String(clamp(1.15 - c.d / reach, 0.25, 1));
        c.l.sub.textContent = fmtDist(c.d);
      }
    };
    const placed = [];

    // First-time hint. Shown once, dismissed by any camera input or after twelve seconds.
    let hintEl = null;
    function dismissHint() {
      if (!hintEl) return;
      hintEl.remove();
      hintEl = null;
      try { localStorage.setItem('twin.camera.hint', '1'); } catch (e) { /* fine */ }
    }
    ui.dismissHint = dismissHint;
    let seen = false;
    try { seen = localStorage.getItem('twin.camera.hint') === '1'; } catch (e) { /* fine */ }
    if (!seen) {
      hintEl = document.createElement('div');
      hintEl.id = 'cam-hint';
      hintEl.className = 'pe';
      hintEl.innerHTML = `
<h4>Moving around Minjerribah</h4>
<div class="grid">
  <div class="k"><kbd>Drag</kbd> hold the ground and move it</div>
  <div class="k"><kbd>Wheel</kbd> zoom, island to street sign</div>
  <div class="k"><kbd>Right drag</kbd> orbit and tilt</div>
  <div class="k"><kbd>W A S D</kbd> pan, walk or fly</div>
  <div class="k">${noNumberKeys()
    ? '<kbd>Tab</kbd> planner, street, follow, drone, cinematic'
    : '<kbd>1</kbd>&ndash;<kbd>5</kbd> planner, street, follow, drone, cinematic'}</div>
  <div class="k"><kbd>Tab</kbd> next mode</div>
  <div class="k"><kbd>F1</kbd>&ndash;<kbd>F4</kbd> townships and the Gorge</div>
  <div class="k"><kbd>Home</kbd> whole island</div>
  <div class="k"><kbd>P</kbd> photo mode</div>
  <div class="k"><kbd>C</kbd> next cinematic shot</div>
</div>
<div class="close">Move the camera to dismiss</div>`;
      root.appendChild(hintEl);
      setTimeout(dismissHint, 12000);
      const off = world.bus.on('camera:mode', dismissHint);
      listeners.push(off);
      ui.watchHint = () => { if (hintEl && input.lastActionAt > 0.5) dismissHint(); };
    }

    ui.root = root;
    ui.style = style;
    ui.onMode('planner');
  }

  /**
   * The photo-mode time slider. It moves the moment on screen, so it goes through `world.time`
   * like everything else that moves the moment, and for two reasons rather than tidiness.
   *
   * It used to write `world.clock.minuteOfDay` and `dayIndex` straight in. That left the bar
   * saying LIVE over a moment thirteen hours from the real one, put nothing on the clock record,
   * and could not be undone, because coming back to the present is a no-op when the clock believes
   * it is already there. Worse, on a paused island it called `world.step()`, so the photographer
   * silently made the island live through a tick to take a picture of it.
   *
   * Through the time control it is a declared scrub: the sun, the moon and the tide are recomputed
   * for the moment you slide to, everything the island has to live through stays at the island's
   * present and is tagged, the moment is on the record, and it is reversible.
   */
  function scrubTime(minuteOfDay) {
    if (!world.time) return;
    world.time.scrubToMinuteOfDay(minuteOfDay);
    if (ui.paintPhotoTime) ui.paintPhotoTime();
    world.bus.emit('clock:scrubbed', { minuteOfDay: world.clock.minuteOfDay, source: 'camera-photo' });
  }

  /* ============================================================ bus and api */

  world.bus.on('camera:cinematic', (p = {}) => playShot(p.shot || p.name, p));
  world.bus.on('camera:follow', (p = {}) => {
    follow.setTarget(p.get || p.target || p, p.label);
    if (mode !== 'follow') setMode('follow');
  });
  world.bus.on('camera:goto', (p = {}) => (p.bookmark ? bookmark(p.bookmark) : flyTo(p)));
  world.bus.on('camera:mode:set', (p = {}) => setMode(p.mode));

  const api = {
    /** @param {'planner'|'street'|'follow'|'drone'|'cinematic'} name */
    setMode: (name, opts) => setMode(name, opts),
    /** @param {{lon?:number, lat?:number, x?:number, z?:number, alt?:number, dist?:number, heading?:number, dur?:number}} o */
    flyTo: (o) => flyTo(o),
    /** @param {string|number} nameOrSlot */
    bookmark: (nameOrSlot, opts) => bookmark(nameOrSlot, opts),
    setBookmark: (slot) => setBookmark(slot),
    follow: (target, label) => {
      follow.setTarget(target, label);
      if (mode !== 'follow') setMode('follow');
      return state.lockedTo;
    },
    cinematic: (name, opts) => playShot(name, opts),
    nextShot,
    shots: () => Object.keys(SHOTS).map((k) => ({ name: k, label: SHOTS[k].label, note: SHOTS[k].note, duration: SHOTS[k].dur })),
    places: () => places.map((p) => ({ id: p.id, label: p.label, lon: p.lon, lat: p.lat, x: Math.round(p.x), z: Math.round(p.z) })),
    photo: (v) => ui.photo(v !== false),
    capture: () => ui.capture(),
    letterbox: (v) => ui.letterbox(v !== false),
    labels: (v) => ui.labels(v !== false),
    hud: () => ui.hud(),
    frameIsland,
    modes: ['planner', 'street', 'follow', 'drone', 'cinematic'],
    toLocal, toLonLat,
    get mode() { return mode; },
    get state() { return state; },
    get babylon() { return cam; },
    get pose() { return renderPose; }
  };

  /* ============================================================== the layer */

  const layer = stage.addLayer({
    id: 'camera',
    order: 5,
    init() {
      seedBookmarks();
      try { buildUI(); } catch (e) { console.warn('[camera] overlay failed', e); }

      planner.update(0.001);
      copyPose(renderPose, planner.pose);
      // Open a little wider and a little further round, then settle. Any input cuts it short.
      const open = newPose();
      orbitPose(open, planner.pivot, planner.yaw - 0.36, clamp(planner.pitch() * 1.1, 0.05, 1.5),
        clamp(planner.dist * 1.7, MIN_DIST, MAX_DIST), planner.fov(), 0);
      copyPose(renderPose, open);
      beginTransition(4.8, true);
      trans.arc = 0;
      applyPose();
    },
    frame,
    dispose() {
      for (const off of listeners) { try { off(); } catch (e) { /* already gone */ } }
      listeners.length = 0;
      for (const m of scaffold.meshes) { try { m.dispose(); } catch (e) { /* already gone */ } }
      scaffold.meshes.length = 0;
      if (ui.root) ui.root.remove();
      if (ui.style) ui.style.remove();
    }
  });

  Object.assign(layer, api);
  world.camera = api;
  stage.cameraRig = api;
  // TWIN is assembled after boot, so hang the rig off it once the app says it is ready.
  world.bus.on('app:ready', () => {
    if (window.TWIN) window.TWIN.camera = api;
    if (ui.releaseNumberKeys) ui.releaseNumberKeys();
  });
}
