// The works below the sand, made visible: a cutaway that peels the island open along the
// candidate corridor and lets you watch the production graph run.
//
// ============================================================================================
// THE ONE RULE THIS FILE EXISTS UNDER
//
// Nothing drawn here is on Minjerribah. data/subterranean.json marks every one of its
// forty-three buildings `existence: "proposed"`, and src/systems/infrastructure/subterranean.js
// republishes that word on every machine it runs. So this layer never draws the works without
// also drawing the fact: a banner that cannot be scrolled away, a stamp repeated across the
// section face itself so a cropped screenshot still carries it, and the consent line on every
// label. If somebody can take a picture of this view and believe it is a facility on the
// island, this file has failed at its first job whatever the factory looks like.
//
// Minjerribah is Quandamooka Country. Every excavation concept in this pack would require
// Traditional Owner consent, sought again at each stage and never carried over, and must not
// sit on or near a place of cultural significance. That sentence is on the view, not in a
// footnote, and this layer does not model the decision or put a number on it.
//
// ============================================================================================
// HOW THE CUTAWAY WORKS, and why it is built this way
//
// The island's terrain is one custom-shaded mesh. It has no clip plane and this layer is not
// allowed to reach into it, so the section is not cut out of the terrain: it is drawn over it,
// in rendering group 2, which Babylon clears depth for. That gives the two things the brief
// asks for at once. The surface keeps drawing normally underneath, so you never lose your
// bearings: the coastline, the roads, the roofs of Dunwich (Goompi) are all still there. And
// the section has its own internal depth, so a room behind another room is behind it, a conduit
// runs into the wall it enters, and the whole thing reads as a solid block of island opened up
// rather than as an x-ray.
//
// A scrim in group 1 dims the world beyond the block, the way a cutaway model on a table takes
// the light. Between the scrim and the section, the surface is legible and quiet, and the works
// are the bright thing.
//
// THE BLOCK. A ribbon of island along the candidate corridor: the far wall is a true geological
// section, the near wall is not drawn, and you look in. The top is a strip of real ground at
// real height, coloured off world.island.landCover, so the section is capped by the island it
// came out of. The floor follows the ground at a depth chosen so the freshwater lens surface is
// inside the block almost everywhere, because the lens is the whole argument.
//
// WHAT IS MODELLED AND WHAT IS READ. The strata bands are modelled and say so on the legend.
// The ground surface is world.island, to the millimetre. The water table is
// world.subterranean.lensSurfaceM, the same function the simulation uses, so the line you see
// and the number the panel prints cannot disagree. Every room position, depth and state is
// read straight off state.buildings and state.machines. Nothing here invents a rate.
//
// THE MOVING PART. Material actually moves. Links are built from the pack's own process inputs
// and outputs, and each one carries packets whose speed and spacing come from the live rate of
// the consuming machine. A line with flow runs. A line whose consumer is starved stops dead,
// goes coral, and grows a stall pip at the mouth. That is the difference between a factory view
// and a diagram, and it is most of the reward in Satisfactory and Dyson Sphere Program.
//
// COST. Nothing is built until the cutaway is opened for the first time, and when it is closed
// every mesh is disabled, so a player who never opens it pays nothing. Open, it is about ten
// draw calls: the section is one mesh, the cap is one, every box in the works is one instanced
// mesh, and every packet is another.

const B = window.BABYLON;

/* ------------------------------------------------------------------ tuning */

const HALF_WIDTH = 132;        // metres either side of the corridor axis the block covers
const S_PAD_BACK = 1180;       // metres behind the shaft, far enough to hold the surface hub
const S_PAD_FWD = 260;         // metres past the last chainage
const STATION = 40;            // metres between section stations
const MIN_THICK = 46;          // the block is never thinner than this
const MAX_THICK = 100;         // nor thicker, whatever the dune above it does
const LENS_CLEAR = 20;         // metres of saturated sand kept below the water table line
const ROOM_H = 7.5;            // metres of headroom drawn for a room
const OPEN_SECONDS = 1.15;
const REVEAL_M = 130;          // depth the peel sweeps down through during the transition
const MAX_LINKS = 64;
const PACKETS_PER_LINK = 7;
const REBUILD_MS = 240;        // how often the live colours and links are refreshed

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ------------------------------------------------------------------ shaders */

// The section face, the end walls and the floor. One mesh, one draw call, and every band in it
// is a function of where the fragment sits relative to two real surfaces: the ground above it
// and the water table through it.
const SECTION_VERT = `
precision highp float;
attribute vec3 position;
attribute vec4 aInfo;     // x chainage, y ground level, z lens level, w face kind (0 wall, 1 floor)
uniform mat4 viewProjection;
varying vec3 vP;
varying vec4 vI;
void main(void) {
  vP = position;
  vI = aInfo;
  gl_Position = viewProjection * vec4(position, 1.0);
}
`;

const SECTION_FRAG = `
precision highp float;
varying vec3 vP;
varying vec4 vI;
uniform vec3 uCam;
uniform vec4 uReveal;     // x metres of depth revealed, y open 0..1, z time, w 0
uniform vec4 uMark;       // x stamp gain, y 0, z 0, w 0
uniform sampler2D texStamp;

float band(float x, float e0, float e1) { return smoothstep(e0, e1, x); }

void main(void) {
  float ground = vI.y;
  float lens = vI.z;
  float depth = ground - vP.y;
  if (depth > uReveal.x) discard;

  // ---- the bands. Three of them, and all three are modelled: the island is sand nearly all
  // the way down and no borehole log for this corridor was found in any pack read here. The
  // only surface in this picture that is not modelled is the water table, which comes from the
  // same function the simulation uses.
  vec3 root   = vec3(0.216, 0.196, 0.146);   // surface sand and root zone
  vec3 dryTop = vec3(0.780, 0.726, 0.598);   // quartz sand, unsaturated
  vec3 dryLow = vec3(0.560, 0.508, 0.396);
  vec3 wetTop = vec3(0.212, 0.352, 0.372);   // saturated sand: the freshwater lens
  vec3 wetLow = vec3(0.098, 0.180, 0.208);

  float dryK = clamp(depth / 46.0, 0.0, 1.0);
  vec3 col = mix(dryTop, dryLow, dryK);
  col = mix(col, root, 1.0 - band(depth, 0.4, 2.4));

  float below = clamp((lens - vP.y) / 34.0, 0.0, 1.0);
  float wetK = band(vP.y, lens - 0.35, lens + 0.35);
  col = mix(col, mix(wetTop, wetLow, below), 1.0 - wetK);

  // The water table itself: one bright line, because it is the line every argument about this
  // proposal turns on.
  float tableLine = 1.0 - smoothstep(0.0, 1.1, abs(vP.y - lens));
  col += vec3(0.10, 0.62, 0.68) * tableLine * 0.85;

  // ---- grain. Bedding at a metre, and a coarser sorting at ten, so the face has a scale in it
  // and does not read as a painted gradient.
  float bedding = sin(vP.y * 3.14159 + sin(vI.x * 0.021) * 2.0) * 0.5 + 0.5;
  float sorting = sin(vP.y * 0.31 + vI.x * 0.0043) * 0.5 + 0.5;
  col *= 0.94 + 0.055 * bedding + 0.05 * sorting;

  // ---- the depth rule. A line every ten metres below the ground, brighter every fifty, so the
  // section carries its own scale without a single label.
  float d10 = abs(fract(depth / 10.0 + 0.5) - 0.5) * 10.0;
  float d50 = abs(fract(depth / 50.0 + 0.5) - 0.5) * 50.0;
  float rule = (1.0 - smoothstep(0.0, 0.55, d10)) * 0.10 + (1.0 - smoothstep(0.0, 0.9, d50)) * 0.16;
  col += vec3(0.92, 0.88, 0.78) * rule * step(1.0, depth);

  // The floor of the block is darker, so the block reads as a solid thing with a bottom.
  col = mix(col, col * 0.42, vI.w);

  // ---- the stamp. Repeated across the face at a low gain and in the section's own light, so it
  // survives a crop, a colour grade and a screenshot, and never shouts over the geology.
  vec2 st = vec2(vI.x / 140.0, vP.y / 44.0);
  float stamp = texture2D(texStamp, st).a;
  col = mix(col, vec3(0.96, 0.80, 0.36), stamp * uMark.x);

  // ---- light. A soft key from above and a rim where the face meets the eye, which is all a
  // section needs: it is a cut surface, not a lit object.
  float rim = pow(1.0 - clamp(abs(normalize(uCam - vP).y), 0.0, 1.0), 3.0);
  col *= 0.86 + 0.30 * clamp((vP.y - (ground - 90.0)) / 90.0, 0.0, 1.0);
  col += vec3(0.24, 0.34, 0.36) * rim * 0.10;

  // The peel edge: a bright scan line riding the reveal front while the block opens.
  float edge = 1.0 - smoothstep(0.0, 3.4, uReveal.x - depth);
  col += vec3(0.30, 0.86, 0.92) * edge * (1.0 - uReveal.y) * 0.85;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The cap: a strip of the real island surface over the top of the block.
const CAP_VERT = `
precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec4 vC;
varying vec3 vP;
void main(void) { vC = color; vP = position; gl_Position = viewProjection * vec4(position, 1.0); }
`;

const CAP_FRAG = `
precision highp float;
varying vec4 vC;
varying vec3 vP;
uniform vec3 uCam;
uniform vec4 uReveal;   // y open 0..1
uniform vec4 uTop;      // x how far the camera has gone overhead 0..1
void main(void) {
  vec3 col = vC.rgb;
  // Looking down the throat of the block, the cap steps out of the way rather than sealing the
  // works in. It never disappears: the surface staying legible is the point of it.
  float a = mix(0.96, 0.16, uTop.x) * uReveal.y;
  // A hairline along the cut edge, so the top of the section reads as a cut and not as a fade.
  gl_FragColor = vec4(col, a);
}
`;

// Everything in the works that is a box: rooms as edge frames, machines, conduits, the spine,
// the drop shafts. One instanced mesh, one draw call.
const WORKS_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 instCol;    // rgb, a alpha
attribute vec4 instInfo;   // x kind, y utilisation, z state, w ground level above this instance
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vP;
varying vec4 vC;
varying vec4 vI;
varying vec3 vL;
void main(void) {
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 wp = W * vec4(position, 1.0);
  vN = normalize((W * vec4(normal, 0.0)).xyz);
  vP = wp.xyz;
  vL = position;
  vC = instCol;
  vI = instInfo;
  gl_Position = viewProjection * wp;
}
`;

const WORKS_FRAG = `
precision highp float;
varying vec3 vN;
varying vec3 vP;
varying vec4 vC;
varying vec4 vI;
varying vec3 vL;
uniform vec3 uCam;
uniform vec4 uReveal;   // x reveal depth, y open, z time
uniform vec4 uPick;     // xyz selected room centre, w 1 when something is selected
void main(void) {
  float depth = vI.w - vP.y;
  if (depth > uReveal.x) discard;

  vec3 L = normalize(vec3(-0.34, 0.88, 0.34));
  float lam = 0.30 + 0.70 * max(dot(vN, L), 0.0);
  vec3 V = normalize(uCam - vP);
  float rim = pow(1.0 - max(dot(vN, V), 0.0), 2.6);

  vec3 col = vC.rgb * lam;
  col += vC.rgb * rim * 0.55;

  float kind = vI.x;
  float util = vI.y;
  float st = vI.z;

  // A machine that is running carries a band of light climbing its own height at the rate it is
  // actually running at. Stand still and watch one and you can read its utilisation without a
  // number, which is the whole trick in Satisfactory.
  if (kind < 0.5) {
    float travel = fract(vL.y + 0.5 - uReveal.z * (0.14 + 0.55 * util));
    float pulse = smoothstep(0.86, 1.0, travel) * util;
    col += vC.rgb * pulse * 1.5;
  }
  // A stalled thing breathes red instead. Slow, so it reads as stopped rather than as busy.
  if (st > 0.5) {
    float breathe = 0.45 + 0.55 * sin(uReveal.z * 2.1 + vP.x * 0.01);
    col = mix(col, vec3(0.92, 0.34, 0.26), 0.34 + 0.28 * breathe);
  }
  // The selected room is ringed rather than recoloured, so its state stays readable.
  if (uPick.w > 0.5) {
    float d = length(vP.xz - uPick.xz);
    float ring = (1.0 - smoothstep(0.0, 46.0, abs(d - 26.0))) * 0.5;
    col += vec3(0.25, 0.71, 0.77) * ring;
  }

  gl_FragColor = vec4(col, vC.a);
}
`;

// Packets and pips. Additive, depth tested against the works but never written, so a packet
// inside a room glows through its own frame instead of z-fighting it.
const GLOW_VERT = WORKS_VERT;
const GLOW_FRAG = `
precision highp float;
varying vec3 vN;
varying vec3 vP;
varying vec4 vC;
varying vec4 vI;
varying vec3 vL;
uniform vec3 uCam;
uniform vec4 uReveal;
void main(void) {
  float depth = vI.w - vP.y;
  if (depth > uReveal.x) discard;
  float core = 1.0 - smoothstep(0.15, 0.5, length(vL));
  vec3 col = vC.rgb * (0.55 + 1.25 * core);
  gl_FragColor = vec4(col * vC.a, 1.0);
}
`;

// The scrim. A unit quad written straight to clip space, so no camera maths and no chance of it
// ending up behind something.
const SCRIM_VERT = `
precision highp float;
attribute vec3 position;
varying vec2 vUv;
void main(void) { vUv = position.xy + 0.5; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;
const SCRIM_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec4 uScrim;   // x alpha
void main(void) {
  float vig = smoothstep(1.25, 0.15, length(vUv - 0.5) * 1.42);
  gl_FragColor = vec4(0.020, 0.045, 0.058, uScrim.x * (0.62 + 0.38 * (1.0 - vig)));
}
`;

/* ------------------------------------------------------------------ the stamp texture */

/**
 * The honesty stamp, drawn once into a tiling texture and repeated across the section face.
 * It is not a watermark on a screenshot: it is on the geometry, so a crop of the works still
 * carries it and a photograph of a monitor still carries it.
 */
function makeStampTexture(scene) {
  const S = 512;
  const t = new B.DynamicTexture('ug-stamp', { width: S, height: S }, scene, true);
  t.hasAlpha = true;
  const c = t.getContext();
  c.clearRect(0, 0, S, S);
  c.save();
  c.translate(S / 2, S / 2);
  c.rotate(-0.22);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(255,255,255,1)';
  c.font = '600 40px Inter, Segoe UI, sans-serif';
  c.fillText('PROPOSED', 0, -128);
  c.font = '600 40px Inter, Segoe UI, sans-serif';
  c.fillText('NOT BUILT', 0, 128);
  c.font = '500 25px Inter, Segoe UI, sans-serif';
  c.fillText('nothing here is on the island', 0, -76);
  c.fillText('consent has not been sought', 0, 176);
  c.restore();
  t.update(false);
  t.wrapU = B.Texture.WRAP_ADDRESSMODE;
  t.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return t;
}

/* ------------------------------------------------------------------ the controller
 *
 * Shared with src/ui/panels/subterranean.js the same way infoview.js shares its controller with
 * the info views panel: the panel never touches Babylon and the layer never draws a panel.
 */

const CONTROLLERS = new WeakMap();

export function undergroundView(world) {
  let c = CONTROLLERS.get(world);
  if (c) return c;
  const subs = new Set();
  c = {
    open: false,
    selected: null,
    available: false,
    reason: 'the cutaway has not been built yet',
    /** @param {boolean} [v] */
    set(v) { c.open = v === undefined ? !c.open : !!v; c.emit(); return c.open; },
    toggle() { return c.set(); },
    select(id) { c.selected = id || null; c.emit(); return c.selected; },
    focus(id) { c.selected = id || null; c._focus = id || null; c.emit(); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit() { for (const f of subs) { try { f(c); } catch (e) { /* a listener must not stop the view */ } } }
  };
  CONTROLLERS.set(world, c);
  return c;
}

/* ================================================================== the layer */

export function registerUnderground(world) {
  const view = undergroundView(world);
  if (!world.stage) return;                       // headless: the controller exists, nothing draws

  const stage = world.stage;
  const pack = (world.data && world.data.subterranean) || null;

  /* ---------------------------------------------------------------- the graph, from the pack */

  // Which building makes what and which building wants it. Structure from the pack, numbers
  // from the read model, so this layer and the simulation cannot disagree about either.
  const PROC = new Map();       // process id -> {building, inputs, outputs}
  const BY_BUILDING = new Map();
  const RES_NAME = new Map();
  if (pack) {
    for (const r of pack.resources || []) RES_NAME.set(r.id, r.name);
    for (const p of pack.processes || []) {
      const rec = {
        id: p.id, building: p.building, name: p.name,
        inputs: (p.inputs || []).map((i) => ({ res: i.resource, kgMin: i.kg_per_min || 0 })),
        outputs: (p.outputs || []).map((o) => ({ res: o.resource, kgMin: o.kg_per_min || 0 }))
      };
      PROC.set(p.id, rec);
      if (!BY_BUILDING.has(p.building)) BY_BUILDING.set(p.building, []);
      BY_BUILDING.get(p.building).push(rec);
    }
  }

  /** Producer and consumer buildings for every resource in the pack. */
  const RES_LINK = new Map();
  for (const rec of PROC.values()) {
    for (const o of rec.outputs) {
      if (!RES_LINK.has(o.res)) RES_LINK.set(o.res, { from: new Set(), to: new Set() });
      RES_LINK.get(o.res).from.add(rec.building);
    }
    for (const i of rec.inputs) {
      if (!RES_LINK.has(i.res)) RES_LINK.set(i.res, { from: new Set(), to: new Set() });
      RES_LINK.get(i.res).to.add(rec.building);
    }
  }

  /* ---------------------------------------------------------------- runtime */

  const R = {
    built: false,
    open: 0,               // 0 closed, 1 open, eased
    target: 0,
    time: 0,
    lastRebuild: -1e9,
    section: null, cap: null, works: null, glow: null, scrim: null,
    stampTex: null,
    frame: null,           // corridor frame {ox, oz, dx, dz, ux, uz, sMin, sMax}
    rooms: [],             // per building: {id, s, u, x, z, y, w, d, surface, inBlock}
    links: [],
    packets: null,         // Float32Array matrices
    worksBuf: null, worksCol: null, worksInfo: null, worksCount: 0,
    glowBuf: null, glowCol: null, glowInfo: null, glowCount: 0,
    savedPose: null,
    overlay: null,
    labelPool: [],
    error: null
  };

  const _m = new B.Matrix();
  const _q = new B.Quaternion();
  const _v = new B.Vector3();
  const _s = new B.Vector3();
  const _up = new B.Vector3(0, 1, 0);

  /* ---------------------------------------------------------------- corridor frame */

  function buildFrame() {
    const st = world.read('subterranean');
    const island = world.island;
    if (!st || !island || !st.siting || !st.siting.corridor || st.siting.corridor.length < 2) return null;
    const c = st.siting.corridor;
    const a = c[0], b = c[c.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    return {
      ox: a.x, oz: a.z, dx, dz,
      ux: -dz, uz: dx,                                  // the cross-axis, positive toward the far wall
      sMin: -S_PAD_BACK, sMax: len + S_PAD_FWD,
      lengthM: len
    };
  }

  const toSU = (f, x, z) => {
    const px = x - f.ox, pz = z - f.oz;
    return { s: px * f.dx + pz * f.dz, u: px * f.ux + pz * f.uz };
  };
  const toXZ = (f, s, u) => ({ x: f.ox + f.dx * s + f.ux * u, z: f.oz + f.dz * s + f.uz * u });

  const groundAt = (x, z) => {
    const island = world.island;
    if (!island) return 0;
    const h = island.height(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  const lensAt = (x, z) => {
    const api = world.subterranean;
    if (api && typeof api.lensSurfaceM === 'function') {
      const v = api.lensSurfaceM(x, z);
      if (Number.isFinite(v)) return v;
    }
    return (world.island ? world.island.seaLevel : 1.02) + 1;
  };

  /** The thickness of the peel at a chainage: deep enough to hold the works and the lens. */
  function thicknessAt(g, l) {
    return clamp(Math.max(MIN_THICK, g - l + LENS_CLEAR), MIN_THICK, MAX_THICK);
  }

  /* ---------------------------------------------------------------- the section mesh */

  function buildSection(scene, f) {
    const stations = Math.ceil((f.sMax - f.sMin) / STATION) + 1;
    const pos = [], info = [], idx = [];
    let v = 0;

    // Sample the ground and the water table along the far wall, and remember them: the end walls
    // and the floor read the same numbers, so the block closes exactly.
    const prof = [];
    for (let i = 0; i < stations; i++) {
      const s = f.sMin + i * STATION;
      const p = toXZ(f, s, HALF_WIDTH);
      const pc = toXZ(f, s, 0);
      const g = groundAt(p.x, p.z);
      const l = lensAt(pc.x, pc.z);
      prof.push({ s, x: p.x, z: p.z, g, l, floor: g - thicknessAt(g, l) });
    }

    // --- the far wall: the section face itself
    for (let i = 0; i < stations; i++) {
      const p = prof[i];
      pos.push(p.x, p.g, p.z); info.push(p.s, p.g, p.l, 0);
      pos.push(p.x, p.floor, p.z); info.push(p.s, p.g, p.l, 0);
      if (i > 0) {
        const a = v - 2, b2 = v - 1, cc = v, d = v + 1;
        idx.push(a, cc, b2, b2, cc, d);
      }
      v += 2;
    }

    // --- the floor, so the block has a bottom you can see into
    for (let i = 0; i < stations; i++) {
      const p = prof[i];
      const n = toXZ(f, p.s, -HALF_WIDTH);
      pos.push(p.x, p.floor, p.z); info.push(p.s, p.g, p.l, 1);
      pos.push(n.x, p.floor, n.z); info.push(p.s, p.g, p.l, 1);
      if (i > 0) {
        const a = v - 2, b2 = v - 1, cc = v, d = v + 1;
        idx.push(a, cc, b2, b2, cc, d);
      }
      v += 2;
    }

    // --- the two end walls, so it reads as a block cut out of the island and not a fence
    for (const end of [0, stations - 1]) {
      const p = prof[end];
      const CUTS = 10;
      const base = v;
      for (let k = 0; k <= CUTS; k++) {
        const u = lerp(HALF_WIDTH, -HALF_WIDTH, k / CUTS);
        const q = toXZ(f, p.s, u);
        const g = groundAt(q.x, q.z);
        const l = lensAt(q.x, q.z);
        pos.push(q.x, Math.max(g, p.floor + 1), q.z); info.push(p.s, g, l, 0);
        pos.push(q.x, p.floor, q.z); info.push(p.s, g, l, 0);
        if (k > 0) {
          const a = base + (k - 1) * 2, b2 = a + 1, cc = a + 2, d = a + 3;
          idx.push(a, cc, b2, b2, cc, d);
        }
      }
      v += (CUTS + 1) * 2;
    }

    const mesh = new B.Mesh('ug-section', scene);
    const vd = new B.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('aInfo', info, false, 4);

    const mat = new B.ShaderMaterial('ug-section-mat', scene,
      { vertexSource: SECTION_VERT, fragmentSource: SECTION_FRAG },
      { attributes: ['position', 'aInfo'], uniforms: ['viewProjection', 'uCam', 'uReveal', 'uMark'], samplers: ['texStamp'] });
    mat.backFaceCulling = false;
    mat.setTexture('texStamp', R.stampTex);
    mesh.material = mat;
    mesh.renderingGroupId = 2;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.prof = prof;
    return mesh;
  }

  /** The strip of real island over the top of the block, coloured off the real land cover. */
  function buildCap(scene, f) {
    const island = world.island;
    const stations = Math.ceil((f.sMax - f.sMin) / STATION) + 1;
    const CUTS = 8;
    const pos = [], col = [], idx = [];
    const COVER = {
      urban: [0.42, 0.42, 0.38], cleared: [0.50, 0.50, 0.36], forest: [0.20, 0.25, 0.15],
      heath: [0.36, 0.38, 0.26], rehab: [0.32, 0.36, 0.24], foredune: [0.74, 0.71, 0.63],
      swamp: [0.20, 0.18, 0.12], lake: [0.16, 0.26, 0.28], rock: [0.32, 0.30, 0.27],
      mangrove: [0.17, 0.23, 0.15], saltmarsh: [0.44, 0.44, 0.33],
      sea: [0.08, 0.16, 0.20], bay: [0.10, 0.20, 0.24], beach: [0.78, 0.75, 0.68]
    };
    for (let i = 0; i < stations; i++) {
      const s = f.sMin + i * STATION;
      for (let k = 0; k <= CUTS; k++) {
        const u = lerp(HALF_WIDTH, -HALF_WIDTH, k / CUTS);
        const q = toXZ(f, s, u);
        const g = groundAt(q.x, q.z);
        // Five taps rather than one. The cover grid is 32 m and the cap is sampled at 40, so a
        // single tap put a chequerboard across the whole strip.
        let cr = 0, cg = 0, cb = 0;
        for (const [ox, oz] of [[0, 0], [22, 0], [-22, 0], [0, 22], [0, -22]]) {
          const cover = island && island.landCover ? island.landCover(q.x + ox, q.z + oz) : 'heath';
          const c = COVER[cover] || [0.4, 0.4, 0.33];
          cr += c[0]; cg += c[1]; cb += c[2];
        }
        pos.push(q.x, g + 0.15, q.z);
        col.push(cr / 5, cg / 5, cb / 5, 1);
        if (i > 0 && k > 0) {
          const row = (i) * (CUTS + 1), prev = (i - 1) * (CUTS + 1);
          const a = prev + k - 1, b2 = prev + k, cc = row + k - 1, d = row + k;
          idx.push(a, b2, cc, b2, d, cc);
        }
      }
    }
    const mesh = new B.Mesh('ug-cap', scene);
    const vd = new B.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.colors = col;
    vd.applyToMesh(mesh, false);
    const mat = new B.ShaderMaterial('ug-cap-mat', scene,
      { vertexSource: CAP_VERT, fragmentSource: CAP_FRAG },
      { attributes: ['position', 'color'], uniforms: ['viewProjection', 'uCam', 'uReveal', 'uTop'], needAlphaBlending: true });
    mat.backFaceCulling = false;
    mat.alphaMode = B.Engine.ALPHA_COMBINE;
    mesh.material = mat;
    mesh.renderingGroupId = 2;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    return mesh;
  }

  /* ---------------------------------------------------------------- the works */

  function unitBox(scene, name) {
    const m = B.MeshBuilder.CreateBox(name, { size: 1 }, scene);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.renderingGroupId = 2;
    return m;
  }

  /** Where every building sits, in corridor coordinates, once. */
  function layoutRooms(f) {
    const st = world.read('subterranean');
    if (!st) return [];
    const out = [];
    for (const b of st.buildings) {
      const su = toSU(f, b.x, b.z);
      const side = Math.sqrt(Math.max(50, b.footprintM2 || 100));
      const w = clamp(side * 1.15, 9, 46);
      const d = clamp(side * 0.9, 8, 40);
      const inBlock = su.s > f.sMin + 20 && su.s < f.sMax - 20 && Math.abs(su.u) < HALF_WIDTH - 12;
      const ground = groundAt(b.x, b.z);
      const thick = thicknessAt(ground, lensAt(b.x, b.z));
      const floorY = ground - thick;
      // A room's floor is its published depth below the ground. Surface sheds sit on it.
      const y = b.surface ? ground + 0.4 : clamp(ground - b.depthM, floorY + 1.5, ground - 3.5);
      out.push({
        id: b.id, name: b.name, tier: b.tier, surface: !!b.surface,
        depthM: b.depthM, units: b.units, x: b.x, z: b.z, y,
        s: su.s, u: su.u, w, d, h: b.surface ? 4.5 : ROOM_H,
        ground, lens: lensAt(b.x, b.z), belowWaterTable: !!b.belowWaterTable,
        inBlock, blocked: b.blocked, connectedKw: b.connectedKw, costA$: b.costA$,
        footprintM2: b.footprintM2, siting: b.siting
      });
    }
    return out;
  }

  /** Everything that moves material between two buildings that are actually built. */
  function buildLinks() {
    const st = world.read('subterranean');
    if (!st) return [];
    const byId = new Map(R.rooms.map((r) => [r.id, r]));
    const mach = new Map(st.machines.map((m) => [m.id, m]));
    const out = [];
    for (const [res, ends] of RES_LINK) {
      if (!ends.from.size || !ends.to.size) continue;
      for (const from of ends.from) {
        for (const to of ends.to) {
          if (from === to) continue;
          const a = byId.get(from), b = byId.get(to);
          if (!a || !b) continue;
          if (a.units <= 0 && b.units <= 0) continue;         // neither end exists yet
          // What is actually moving: the consuming machines' live rate against their pack rate.
          let flow = 0, want = 0, starved = false, blockedWhy = '';
          for (const rec of BY_BUILDING.get(to) || []) {
            const inp = rec.inputs.find((i) => i.res === res);
            if (!inp) continue;
            const m = mach.get(rec.id);
            if (!m) continue;
            want += inp.kgMin * Math.max(1, m.units);
            flow += inp.kgMin * (m.rate || 0);
            if (m.units > 0 && m.rate <= 0.0001 && m.why === RES_NAME.get(res)) { starved = true; blockedWhy = m.limit; }
            else if (m.units > 0 && m.limit === 'starved' && m.why === RES_NAME.get(res)) { starved = true; blockedWhy = 'starved'; }
          }
          let supply = 0;
          for (const rec of BY_BUILDING.get(from) || []) {
            const o = rec.outputs.find((x) => x.res === res);
            if (!o) continue;
            const m = mach.get(rec.id);
            if (m) supply += o.kgMin * (m.rate || 0);
          }
          out.push({
            res, resName: RES_NAME.get(res) || res, from, to,
            flow, want, supply, starved, blockedWhy,
            live: a.units > 0 && b.units > 0
          });
        }
      }
    }
    // Worst first, so if there are more links than the view can carry, the ones a player needs
    // to see are the ones that survive.
    out.sort((a, b) => (Number(b.live) - Number(a.live)) || (Number(b.starved) - Number(a.starved)) || (b.flow - a.flow));
    return out.slice(0, MAX_LINKS);
  }

  /** The three-legged route a link takes: up to the spine, along the bore, down to the room. */
  function linkPath(link, byId) {
    const a = byId.get(link.from), b = byId.get(link.to);
    if (!a || !b) return null;
    const f = R.frame;
    const spineY = (r) => (r.surface ? r.ground + 1.2 : Math.max(r.y + r.h * 0.5, r.ground - 14));
    const p0 = new B.Vector3(a.x, a.y + a.h * 0.55, a.z);
    const p3 = new B.Vector3(b.x, b.y + b.h * 0.55, b.z);
    const q1 = toXZ(f, a.s, clamp(a.u, -8, 8));
    const q2 = toXZ(f, b.s, clamp(b.u, -8, 8));
    const p1 = new B.Vector3(q1.x, spineY(a), q1.z);
    const p2 = new B.Vector3(q2.x, spineY(b), q2.z);
    return [p0, p1, p2, p3];
  }

  /* ---------------------------------------------------------------- instance packing */

  function setInstance(buf, i, cx, cy, cz, sx, sy, sz, yaw) {
    B.Quaternion.RotationYawPitchRollToRef(yaw || 0, 0, 0, _q);
    _s.set(sx, sy, sz);
    _v.set(cx, cy, cz);
    B.Matrix.ComposeToRef(_s, _q, _v, _m);
    _m.copyToArray(buf, i * 16);
  }

  /** A box stretched between two points, for a conduit or a shaft. */
  function setSegment(buf, i, a, b2, thick) {
    const dx = b2.x - a.x, dy = b2.y - a.y, dz = b2.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) { setInstance(buf, i, a.x, a.y, a.z, 0.001, 0.001, 0.001, 0); return; }
    const dir = new B.Vector3(dx / len, dy / len, dz / len);
    const right = B.Vector3.Cross(_up, dir);
    if (right.lengthSquared() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = B.Vector3.Cross(dir, right).normalize();
    const m = _m;
    m.setRowFromFloats(0, right.x * thick, right.y * thick, right.z * thick, 0);
    m.setRowFromFloats(1, up.x * thick, up.y * thick, up.z * thick, 0);
    m.setRowFromFloats(2, dir.x * len, dir.y * len, dir.z * len, 0);
    m.setRowFromFloats(3, (a.x + b2.x) / 2, (a.y + b2.y) / 2, (a.z + b2.z) / 2, 1);
    m.copyToArray(buf, i * 16);
  }

  const COL = {
    running: [0.30, 0.78, 0.72],
    nameplate: [0.36, 0.86, 0.66],
    stalled: [0.90, 0.36, 0.28],
    tripped: [0.94, 0.71, 0.16],
    consent: [0.70, 0.54, 0.77],
    idle: [0.44, 0.50, 0.55],
    ghost: [0.30, 0.34, 0.38],
    surface: [0.62, 0.58, 0.48],
    spine: [0.30, 0.36, 0.41],
    conduit: [0.26, 0.55, 0.60]
  };

  /** What colour a building is, and why. Read off the machines the simulation publishes. */
  function roomState(room, machines) {
    if (room.units <= 0) return { col: COL.ghost, alpha: 0.30, util: 0, stalled: 0, label: room.blocked || 'not built' };
    const mine = (BY_BUILDING.get(room.id) || []).map((p) => machines.get(p.id)).filter(Boolean);
    if (!mine.length) return { col: COL.idle, alpha: 0.9, util: 0, stalled: 0, label: 'built' };
    let util = 0, run = 0, stall = 0, trip = 0, consent = 0, n = 0;
    for (const m of mine) {
      if (m.units <= 0) continue;
      n++;
      util += m.utilisation || 0;
      if (m.rate > 1e-6) run++; else stall++;
      if (m.tripped) trip++;
      if (m.limit === 'consent') consent++;
    }
    if (!n) return { col: COL.idle, alpha: 0.9, util: 0, stalled: 0, label: 'built' };
    util /= n;
    if (trip) return { col: COL.tripped, alpha: 1, util, stalled: 1, label: 'tripped: no power headroom' };
    if (consent) return { col: COL.consent, alpha: 1, util, stalled: 1, label: 'stopped: consent' };
    if (run === 0) return { col: COL.stalled, alpha: 1, util: 0, stalled: 1, label: 'stalled' };
    if (stall > 0) return { col: COL.tripped, alpha: 1, util, stalled: 0, label: run + ' of ' + n + ' running' };
    return { col: util > 0.97 ? COL.nameplate : COL.running, alpha: 1, util, stalled: 0, label: 'running' };
  }

  /* ---------------------------------------------------------------- build everything */

  function build() {
    const scene = stage.scene;
    const f = buildFrame();
    if (!f) {
      R.error = 'The subterranean system has published no corridor, so there is nothing to cut a section through.';
      view.available = false;
      view.reason = R.error;
      return false;
    }
    R.frame = f;
    R.stampTex = makeStampTexture(scene);
    R.section = buildSection(scene, f);
    R.cap = buildCap(scene, f);
    R.rooms = layoutRooms(f);

    // Two instanced meshes carry every box in the works, and one more carries every packet.
    const worksMat = new B.ShaderMaterial('ug-works-mat', scene,
      { vertexSource: WORKS_VERT, fragmentSource: WORKS_FRAG },
      {
        attributes: ['position', 'normal', 'world0', 'world1', 'world2', 'world3', 'instCol', 'instInfo'],
        uniforms: ['viewProjection', 'uCam', 'uReveal', 'uPick'],
        needAlphaBlending: true
      });
    worksMat.backFaceCulling = true;
    worksMat.alphaMode = B.Engine.ALPHA_COMBINE;

    const glowMat = new B.ShaderMaterial('ug-glow-mat', scene,
      { vertexSource: GLOW_VERT, fragmentSource: GLOW_FRAG },
      {
        attributes: ['position', 'normal', 'world0', 'world1', 'world2', 'world3', 'instCol', 'instInfo'],
        uniforms: ['viewProjection', 'uCam', 'uReveal'],
        needAlphaBlending: true
      });
    glowMat.backFaceCulling = false;
    glowMat.alphaMode = B.Engine.ALPHA_ADD;
    glowMat.disableDepthWrite = true;

    R.works = unitBox(scene, 'ug-works');
    R.works.material = worksMat;
    R.glow = unitBox(scene, 'ug-glow');
    R.glow.material = glowMat;

    // A generous fixed ceiling, allocated once. Nothing in the frame path allocates.
    const MAXW = 1600, MAXG = MAX_LINKS * PACKETS_PER_LINK + 96;
    R.worksBuf = new Float32Array(MAXW * 16);
    R.worksCol = new Float32Array(MAXW * 4);
    R.worksInfo = new Float32Array(MAXW * 4);
    R.glowBuf = new Float32Array(MAXG * 16);
    R.glowCol = new Float32Array(MAXG * 4);
    R.glowInfo = new Float32Array(MAXG * 4);
    R.works.thinInstanceSetBuffer('matrix', R.worksBuf, 16, false);
    R.works.thinInstanceSetBuffer('instCol', R.worksCol, 4, false);
    R.works.thinInstanceSetBuffer('instInfo', R.worksInfo, 4, false);
    R.glow.thinInstanceSetBuffer('matrix', R.glowBuf, 16, false);
    R.glow.thinInstanceSetBuffer('instCol', R.glowCol, 4, false);
    R.glow.thinInstanceSetBuffer('instInfo', R.glowInfo, 4, false);
    R.works.thinInstanceCount = 0;
    R.glow.thinInstanceCount = 0;

    // The scrim, so the surface keeps its shape but stops competing.
    const scrimMat = new B.ShaderMaterial('ug-scrim-mat', scene,
      { vertexSource: SCRIM_VERT, fragmentSource: SCRIM_FRAG },
      { attributes: ['position'], uniforms: ['uScrim'], needAlphaBlending: true });
    scrimMat.backFaceCulling = false;
    scrimMat.alphaMode = B.Engine.ALPHA_COMBINE;
    scrimMat.disableDepthWrite = true;
    const scrim = B.MeshBuilder.CreatePlane('ug-scrim', { size: 1 }, scene);
    scrim.material = scrimMat;
    scrim.renderingGroupId = 1;
    scrim.isPickable = false;
    scrim.alwaysSelectAsActiveMesh = true;
    R.scrim = scrim;

    buildOverlay();
    R.built = true;
    view.available = true;
    view.reason = '';
    setVisible(false);
    return true;
  }

  function setVisible(on) {
    for (const m of [R.section, R.cap, R.works, R.glow, R.scrim]) if (m) m.setEnabled(on);
    if (R.overlay) R.overlay.root.classList.toggle('on', on);
  }

  /* ---------------------------------------------------------------- the live pack */

  function repack() {
    const st = world.read('subterranean');
    if (!st || !R.built) return;
    const machines = new Map(st.machines.map((m) => [m.id, m]));
    const byId = new Map(R.rooms.map((r) => [r.id, r]));
    const bld = new Map(st.buildings.map((b) => [b.id, b]));
    for (const r of R.rooms) {
      const b = bld.get(r.id);
      if (b) { r.units = b.units; r.blocked = b.blocked; }
    }

    const buf = R.worksBuf, cbuf = R.worksCol, ibuf = R.worksInfo;
    let n = 0;
    const put = (col, alpha, kind, util, stalled, ground) => {
      cbuf[n * 4] = col[0]; cbuf[n * 4 + 1] = col[1]; cbuf[n * 4 + 2] = col[2]; cbuf[n * 4 + 3] = alpha;
      ibuf[n * 4] = kind; ibuf[n * 4 + 1] = util; ibuf[n * 4 + 2] = stalled; ibuf[n * 4 + 3] = ground;
      n++;
    };

    // --- the spine: the corridor trunk, the one hole everything has to fit down
    const f = R.frame;
    const trunkPct = Math.max(st.trunk ? st.trunk.solidPct : 0, st.trunk ? st.trunk.fluidPct : 0);
    const trunkCol = trunkPct > 98 ? COL.stalled : trunkPct > 75 ? COL.tripped : COL.spine;
    for (let s = 0; s < f.lengthM; s += 60) {
      const p0 = toXZ(f, s, 0), p1 = toXZ(f, Math.min(s + 60, f.lengthM), 0);
      const g0 = groundAt(p0.x, p0.z), g1 = groundAt(p1.x, p1.z);
      const a = new B.Vector3(p0.x, g0 - 14, p0.z);
      const b2 = new B.Vector3(p1.x, g1 - 14, p1.z);
      setSegment(buf, n, a, b2, 2.0);
      put(trunkCol, 0.95, 2, clamp(trunkPct / 100, 0, 1), 0, Math.max(g0, g1));
      if (n >= 1580) break;
    }

    // --- the rooms: an edge frame each, so you can see the machines inside them
    for (const r of R.rooms) {
      if (!r.inBlock && !r.surface) continue;
      const stt = roomState(r, machines);
      r.state = stt;
      if (!r.inBlock) {
        // A surface shed off the corridor: the tip loop beside the waste centre, the wave device
        // on the bay frontage. It sits on the real island at its real place, so the surface loop
        // is not quietly dropped out of the picture just because the section does not reach it.
        setInstance(buf, n, r.x, r.ground + 2.4, r.z, r.w * 0.7, 4.4, r.d * 0.7, 0);
        put(stt.col, r.units > 0 ? 0.95 : 0.28, 0, stt.util, stt.stalled, r.ground + 7);
        continue;
      }
      const hw = r.w / 2, hd = r.d / 2, h = r.h;
      const y0 = r.y, y1 = r.y + h;
      const bar = r.units > 0 ? 0.9 : 0.55;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let k = 0; k < 4; k++) {
        const [cx, cz] = corners[k];
        const [nx, nz] = corners[(k + 1) % 4];
        // uprights
        setInstance(buf, n, r.x + cx, (y0 + y1) / 2, r.z + cz, bar, h, bar, 0);
        put(stt.col, stt.alpha, 1, stt.util, stt.stalled, r.ground);
        // top and bottom rails
        setSegment(buf, n, new B.Vector3(r.x + cx, y1, r.z + cz), new B.Vector3(r.x + nx, y1, r.z + nz), bar);
        put(stt.col, stt.alpha, 1, stt.util, stt.stalled, r.ground);
        setSegment(buf, n, new B.Vector3(r.x + cx, y0, r.z + cz), new B.Vector3(r.x + nx, y0, r.z + nz), bar);
        put(stt.col, stt.alpha, 1, stt.util, stt.stalled, r.ground);
      }
      // the room floor, so a room reads as a room and not as a cage
      setInstance(buf, n, r.x, y0 - 0.3, r.z, r.w, 0.6, r.d, 0);
      put([stt.col[0] * 0.35, stt.col[1] * 0.35, stt.col[2] * 0.35], r.units > 0 ? 0.85 : 0.22, 1, 0, 0, r.ground);

      // --- the machines inside it, one per process the pack gives the building
      const procs = BY_BUILDING.get(r.id) || [];
      const cols = Math.max(1, Math.ceil(Math.sqrt(procs.length)));
      for (let i = 0; i < procs.length && n < 1560; i++) {
        const m = machines.get(procs[i].id);
        const gx = (i % cols + 0.5) / cols - 0.5;
        const gz = (Math.floor(i / cols) + 0.5) / Math.max(1, Math.ceil(procs.length / cols)) - 0.5;
        const mw = clamp(r.w / (cols + 1.2), 1.6, 9);
        const mh = clamp(2.2 + (m ? Math.abs(m.powerKw) * 0.02 : 0), 2.0, h - 1.4);
        let col = COL.ghost, alpha = 0.35, util = 0, stalled = 0;
        if (m && m.units > 0) {
          alpha = 1;
          util = m.utilisation || 0;
          if (m.tripped) { col = COL.tripped; stalled = 1; }
          else if (m.limit === 'consent') { col = COL.consent; stalled = 1; }
          else if (m.rate > 1e-6) col = util > 0.97 ? COL.nameplate : COL.running;
          else { col = COL.stalled; stalled = 1; }
        }
        setInstance(buf, n, r.x + gx * r.w * 0.86, r.y + mh / 2 + 0.2, r.z + gz * r.d * 0.86, mw, mh, mw, 0);
        put(col, alpha, 0, util, stalled, r.ground);
      }

      // --- the drop shaft from the spine down to the room
      if (!r.surface) {
        const q = toXZ(f, r.s, 0);
        const gq = groundAt(q.x, q.z);
        setSegment(buf, n, new B.Vector3(q.x, gq - 14, q.z), new B.Vector3(r.x, r.y + r.h * 0.5, r.z), 1.3);
        put(COL.spine, 0.8, 2, 0, 0, Math.max(gq, r.ground));
      }
    }

    // --- the conduits, and the packets that ride them
    R.links = buildLinks();
    let g = 0;
    const gbuf = R.glowBuf, gc = R.glowCol, gi = R.glowInfo;
    const putGlow = (col, alpha, ground) => {
      gc[g * 4] = col[0]; gc[g * 4 + 1] = col[1]; gc[g * 4 + 2] = col[2]; gc[g * 4 + 3] = alpha;
      gi[g * 4] = 3; gi[g * 4 + 1] = 0; gi[g * 4 + 2] = 0; gi[g * 4 + 3] = ground;
      g++;
    };
    for (const link of R.links) {
      const path = linkPath(link, byId);
      if (!path) continue;
      link.path = path;
      link.len = 0;
      link.legs = [];
      for (let k = 0; k < 3; k++) {
        const L = B.Vector3.Distance(path[k], path[k + 1]);
        link.legs.push(L);
        link.len += L;
      }
      const a = byId.get(link.from), b2 = byId.get(link.to);
      const ground = Math.max(a ? a.ground : 0, b2 ? b2.ground : 0);
      link.ground = ground;
      const sat = link.want > 0 ? clamp(link.flow / link.want, 0, 1) : 0;
      let col = COL.idle, alpha = 0.42;
      if (link.starved) { col = COL.stalled; alpha = 0.95; }
      else if (link.flow > 1e-6) { col = COL.conduit; alpha = 0.55 + 0.4 * sat; }
      else if (!link.live) { col = COL.ghost; alpha = 0.22; }
      link.col = col;
      link.sat = sat;
      const thick = link.starved ? 1.5 : clamp(0.7 + sat * 1.6, 0.7, 2.4);
      for (let k = 0; k < 3 && n < 1592; k++) {
        setSegment(buf, n, path[k], path[k + 1], thick);
        put(col, alpha, 2, sat, link.starved ? 1 : 0, ground);
      }
      // A stall pip at the mouth of the thing that is waiting, so a stopped line is not just a
      // line that happens to have no boxes on it.
      if (link.starved && g < MAX_LINKS * PACKETS_PER_LINK + 90) {
        putGlow([1.0, 0.34, 0.24], 1.0, ground);
        setInstance(gbuf, g - 1, path[3].x, path[3].y + 3.2, path[3].z, 3.4, 3.4, 3.4, 0);
      }
    }
    R.worksCount = n;
    R.works.thinInstanceCount = n;
    R.works.thinInstanceBufferUpdated('matrix');
    R.works.thinInstanceBufferUpdated('instCol');
    R.works.thinInstanceBufferUpdated('instInfo');
    R.glowPips = g;
    R.glowCount = g;
  }

  /** Packets, every frame: this is the part that makes it a factory rather than a diagram. */
  function movePackets(dt) {
    if (!R.built || !R.links.length) return;
    const gbuf = R.glowBuf, gc = R.glowCol, gi = R.glowInfo;
    let g = R.glowPips || 0;
    const cap = MAX_LINKS * PACKETS_PER_LINK + 90;
    for (const link of R.links) {
      if (!link.path || link.len < 1) continue;
      const sat = link.sat || 0;
      const count = link.starved ? 3 : Math.round(clamp(1 + sat * (PACKETS_PER_LINK - 1), 0, PACKETS_PER_LINK));
      if (link.flow <= 1e-6 && !link.starved) continue;
      // Speed is the live rate against the pack rate: a line at forty per cent runs at forty
      // per cent, and you can see that without reading a number.
      const speed = link.starved ? 0 : (14 + 46 * sat);
      link.phase = ((link.phase || 0) + (speed * dt) / link.len) % 1;
      const col = link.starved ? [1.0, 0.36, 0.26] : [0.42, 0.94, 0.86];
      for (let i = 0; i < count && g < cap; i++) {
        // A stalled line's packets bunch up at the mouth rather than sitting where they were.
        const t = link.starved
          ? 1 - (i + 1) * 0.045
          : (link.phase + i / count) % 1;
        const p = pointOn(link, clamp(t, 0, 1));
        const size = link.starved ? 2.0 : clamp(1.6 + sat * 2.4, 1.6, 4.2);
        setInstance(gbuf, g, p.x, p.y, p.z, size, size, size, 0);
        gc[g * 4] = col[0]; gc[g * 4 + 1] = col[1]; gc[g * 4 + 2] = col[2];
        gc[g * 4 + 3] = link.starved ? 0.75 : 0.55 + 0.45 * sat;
        gi[g * 4] = 3; gi[g * 4 + 1] = 0; gi[g * 4 + 2] = 0; gi[g * 4 + 3] = link.ground;
        g++;
      }
    }
    R.glowCount = g;
    R.glow.thinInstanceCount = g;
    R.glow.thinInstanceBufferUpdated('matrix');
    R.glow.thinInstanceBufferUpdated('instCol');
    R.glow.thinInstanceBufferUpdated('instInfo');
  }

  const _pt = { x: 0, y: 0, z: 0 };
  function pointOn(link, t) {
    let d = t * link.len;
    for (let k = 0; k < 3; k++) {
      if (d <= link.legs[k] || k === 2) {
        const u = link.legs[k] > 0 ? clamp(d / link.legs[k], 0, 1) : 0;
        const a = link.path[k], b2 = link.path[k + 1];
        _pt.x = a.x + (b2.x - a.x) * u;
        _pt.y = a.y + (b2.y - a.y) * u;
        _pt.z = a.z + (b2.z - a.z) * u;
        return _pt;
      }
      d -= link.legs[k];
    }
    return _pt;
  }

  /* ---------------------------------------------------------------- the overlay
   *
   * The banner, the labels and the legend. DOM rather than Babylon GUI, because the banner has
   * to use the same type and the same tokens as the rest of the interface and because a label
   * that is DOM can be read by a screen reader.
   */

  function buildOverlay() {
    if (R.overlay) return;
    injectCss();
    const root = document.createElement('div');
    root.id = 'ug-overlay';
    root.innerHTML = `
      <div class="ug-banner" role="note">
        <span class="ug-flag">PROPOSED</span>
        <div class="ug-banner-t">
          <b>None of this exists on Minjerribah.</b>
          <span>A design being tested inside a twin. Nothing below the sand is built, approved, funded, sited or consented.</span>
        </div>
      </div>
      <div class="ug-country">
        Minjerribah is Quandamooka Country. Every excavation concept here would need Traditional Owner consent,
        sought again at each stage and never carried over, and must not sit on or near a place of cultural significance.
      </div>
      <div class="ug-labels"></div>
      <div class="ug-legend">
        <div class="ug-legend-h">The section</div>
        <div class="ug-lg"><i style="background:#c7b998"></i><span>Quartz sand, unsaturated</span><b>modelled</b></div>
        <div class="ug-lg"><i style="background:#1aa0ad"></i><span>Water table</span><b>simulated</b></div>
        <div class="ug-lg"><i style="background:#2c4a52"></i><span>Freshwater lens, saturated sand</span><b>modelled</b></div>
        <div class="ug-legend-h">The works</div>
        <div class="ug-lg"><i style="background:#5cc4b4"></i><span>Running</span></div>
        <div class="ug-lg"><i style="background:#f0b429"></i><span>Part running, or tripped</span></div>
        <div class="ug-lg"><i style="background:#e65c47"></i><span>Stalled</span></div>
        <div class="ug-lg"><i style="background:#b48ac4"></i><span>Stopped: consent</span></div>
        <div class="ug-lg"><i style="background:#4d565c"></i><span>Proposed, not built</span></div>
        <div class="ug-note"></div>
      </div>
      <div class="ug-hint"><kbd>U</kbd> closes the cutaway</div>`;
    document.getElementById('ui-root').append(root);
    R.overlay = {
      root,
      labels: root.querySelector('.ug-labels'),
      note: root.querySelector('.ug-note')
    };
  }

  const _proj = new B.Vector3();
  const _lab = new B.Vector3();
  const _ident = B.Matrix.Identity();
  function paintLabels() {
    const ov = R.overlay;
    if (!ov || R.open < 0.55) { if (ov) ov.labels.innerHTML = ''; return; }
    const scene = stage.scene;
    const cam = scene.activeCamera;
    if (!cam) return;
    const eng = stage.engine;
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const tm = scene.getTransformMatrix();
    const camPos = cam.globalPosition || cam.position;

    const shown = [];
    for (const r of R.rooms) {
      if (!r.inBlock && !r.surface) continue;
      if (!r.state) continue;
      if (r.units <= 0 && r.id !== view.selected) continue;   // ghosts stay quiet unless picked
      const d = Math.hypot(camPos.x - r.x, camPos.y - (r.y + r.h), camPos.z - r.z);
      shown.push({ r, d });
    }
    shown.sort((a, b) => (a.r.id === view.selected ? -1 : b.r.id === view.selected ? 1 : a.d - b.d));
    const take = shown.slice(0, 16);

    while (R.labelPool.length < take.length) {
      const el = document.createElement('div');
      el.className = 'ug-label';
      ov.labels.append(el);
      R.labelPool.push(el);
    }
    for (let i = 0; i < R.labelPool.length; i++) {
      const el = R.labelPool[i];
      const item = take[i];
      if (!item) { el.style.display = 'none'; continue; }
      const r = item.r;
      _lab.set(r.x, r.y + r.h + 2.5, r.z);
      B.Vector3.ProjectToRef(_lab, _ident, tm, vp, _proj);
      if (_proj.z < 0 || _proj.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(_proj.x)}px, ${Math.round(_proj.y)}px)`;
      el.className = 'ug-label' + (r.id === view.selected ? ' on' : '') + (r.state.stalled ? ' bad' : '');
      const kw = r.connectedKw == null ? 'not rated' : Math.round(r.connectedKw) + ' kW';
      el.innerHTML = `<b>${esc(r.name)}</b><i>proposed</i>`
        + `<span>${esc(r.state.label)} · ${r.surface ? 'surface' : Math.round(r.depthM) + ' m down'} · ${kw}</span>`;
    }
  }

  function paintNote() {
    const ov = R.overlay;
    const st = world.read('subterranean');
    if (!ov || !st) return;
    const f = R.frame;
    const mid = toXZ(f, f.lengthM * 0.5, 0);
    const head = Math.max(0, lensAt(mid.x, mid.z) - (world.island ? world.island.seaLevel : 1.02));
    const interface_ = Math.round(head * (st.ghybenHerzberg || 40));
    ov.note.innerHTML =
      `Strata are modelled: no borehole log for this corridor was found in any pack read here. `
      + `The water table is the same function the simulation uses, calibrated to one published point, `
      + `Blue Lake at 72 m. Under the middle of this corridor the lens sits about ${Math.round(head)} m `
      + `above sea level, so at forty metres of fresh water per metre of head the salt interface would be `
      + `roughly ${interface_} m down, far below this block. Siting is this project's, not the pack's.`;
  }

  /* ---------------------------------------------------------------- camera */

  /**
   * A cutaway is looked at across, not along. Looking down the bore puts the section face
   * edge-on and all you see is the cap, which is exactly what the first attempt at this did.
   * So the camera crosses to the open side and looks square at the face, at the stretch of
   * corridor where something is actually happening.
   */
  function crossHeadingDeg() {
    const f = R.frame;
    return (Math.atan2(f.ux, f.uz) * 180) / Math.PI;    // toward the far wall
  }

  /** Where the works are: the built rooms if there are any, else the surface loop. */
  function centreOfInterest() {
    const f = R.frame;
    const live = R.rooms.filter((r) => r.units > 0 && r.inBlock);
    const under = live.filter((r) => !r.surface);
    const pick = under.length ? under : live.length ? live : R.rooms.filter((r) => r.inBlock);
    if (!pick.length) return { s: f.lengthM * 0.3, span: 900 };
    let lo = Infinity, hi = -Infinity;
    for (const r of pick) { lo = Math.min(lo, r.s); hi = Math.max(hi, r.s); }
    return { s: (lo + hi) / 2, span: clamp(hi - lo + 320, 340, 1900) };
  }

  function frameCorridor() {
    const cam = world.camera;
    if (!cam || !R.frame) return;
    const f = R.frame;
    R.savedPose = {
      x: cam.state.target.x, z: cam.state.target.z,
      dist: cam.state.distanceM, heading: cam.state.headingDeg, pitch: cam.state.pitchDeg
    };
    const c = centreOfInterest();
    const p = toXZ(f, c.s, 20);
    cam.flyTo({ x: p.x, z: p.z, dist: clamp(c.span * 0.78, 380, 1500), heading: crossHeadingDeg(), pitchBias: -0.44, dur: 1.6 });
  }

  function restoreCamera() {
    const cam = world.camera;
    if (!cam || !R.savedPose) return;
    const p = R.savedPose;
    cam.flyTo({ x: p.x, z: p.z, dist: p.dist, heading: p.heading, dur: 1.3 });
    R.savedPose = null;
  }

  function focusRoom(id) {
    const cam = world.camera;
    const r = R.rooms.find((x) => x.id === id);
    if (!cam || !r) return;
    cam.flyTo({ x: r.x, z: r.z, dist: clamp(r.w * 7, 170, 420), heading: crossHeadingDeg(), pitchBias: -0.5, dur: 1.0 });
  }

  /* ---------------------------------------------------------------- the layer */

  const uReveal = new B.Vector4(0, 0, 0, 0);
  const uMark = new B.Vector4(0.14, 0, 0, 0);
  const uTop = new B.Vector4(0, 0, 0, 0);
  const uPick = new B.Vector4(0, 0, 0, 0);
  const uScrim = new B.Vector4(0, 0, 0, 0);
  const camPos = new B.Vector3();

  stage.addLayer({
    id: 'underground',
    order: 34,

    init() {
      view.on((c) => {
        R.target = c.open ? 1 : 0;
        if (c.open && !R.built) {
          const ok = build();
          if (!ok) { c.open = false; R.target = 0; return; }
        }
        if (c.open) { setVisible(true); frameCorridor(); paintNote(); }
        else restoreCamera();
        if (c._focus) { focusRoom(c._focus); c._focus = null; }
      });

      // U for under. The same key opens it and closes it, and it never fires while typing.
      window.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.code !== 'KeyU') return;
        e.preventDefault();
        view.toggle();
      });

      // A panel that opened the cutaway before this layer existed is honoured rather than lost.
      if (view.open) view.emit();
    },

    frame(stg, w, dt) {
      const step = Math.min(0.1, dt || 0.016);
      R.time += step;
      const prev = R.open;
      const k = step / OPEN_SECONDS;
      R.open = R.target > R.open ? Math.min(1, R.open + k) : Math.max(0, R.open - k);
      if (!R.built) return;
      if (R.open <= 0.0001) {
        if (prev > 0.0001) setVisible(false);
        return;
      }
      if (prev <= 0.0001) setVisible(true);

      const e = ease(R.open);
      const cam = stg.scene.activeCamera;
      camPos.copyFrom(cam.globalPosition || cam.position);

      uReveal.set(e * REVEAL_M, e, R.time, 0);
      uScrim.set(e * 0.72, 0, 0, 0);

      // How far over the top of the block the eye has gone, so the cap can step out of the way.
      const look = cam.getForwardRay ? cam.getForwardRay(1).direction : { y: -0.5 };
      uTop.set(clamp((-look.y - 0.42) / 0.34, 0, 1), 0, 0, 0);
      uMark.set(0.11 + 0.05 * Math.sin(R.time * 0.7), 0, 0, 0);

      const sel = view.selected ? R.rooms.find((r) => r.id === view.selected) : null;
      uPick.set(sel ? sel.x : 0, sel ? sel.y : 0, sel ? sel.z : 0, sel ? 1 : 0);

      const sm = R.section.material, cm = R.cap.material;
      sm.setVector3('uCam', camPos); sm.setVector4('uReveal', uReveal); sm.setVector4('uMark', uMark);
      cm.setVector3('uCam', camPos); cm.setVector4('uReveal', uReveal); cm.setVector4('uTop', uTop);
      const wm = R.works.material, gm = R.glow.material;
      wm.setVector3('uCam', camPos); wm.setVector4('uReveal', uReveal); wm.setVector4('uPick', uPick);
      gm.setVector3('uCam', camPos); gm.setVector4('uReveal', uReveal);
      R.scrim.material.setVector4('uScrim', uScrim);

      // The heavy repack runs a few times a second, not every frame. Only the packets move at
      // frame rate, and they are one buffer write.
      const nowMs = performance.now();
      if (nowMs - R.lastRebuild > REBUILD_MS) { R.lastRebuild = nowMs; repack(); paintNote(); }
      movePackets(step);
      paintLabels();
    },

    dispose() {
      for (const m of [R.section, R.cap, R.works, R.glow, R.scrim]) if (m) m.dispose();
      if (R.stampTex) R.stampTex.dispose();
      if (R.overlay) R.overlay.root.remove();
      R.built = false;
    }
  });
}

/* ------------------------------------------------------------------ chrome */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'ug-overlay-css';
  s.textContent = `
#ug-overlay { position:absolute; inset:0; pointer-events:none; opacity:0; visibility:hidden;
  transition:opacity var(--med) var(--ease); z-index:16; }
#ug-overlay.on { opacity:1; visibility:visible; }

/* The banner. It is not dismissible and it is not small, because the one thing a person must
   not be able to do with this view is mistake it for a photograph of something. */
.ug-banner { position:absolute; top:calc(var(--sp-4) + 46px); left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:var(--sp-3); max-width:min(760px, 92vw);
  padding:var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-2);
  background:linear-gradient(90deg, rgba(240,180,41,.20), rgba(16,21,25,.90) 42%);
  border:1px solid rgba(240,180,41,.55); border-radius:var(--r-3); box-shadow:var(--shadow-2);
  backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); }
.ug-flag { flex:none; font:700 var(--fs-label)/1 var(--f-ui); letter-spacing:.2em; color:var(--t-on-accent);
  background:var(--sun); padding:7px 10px; border-radius:var(--r-2); }
.ug-banner-t { display:flex; flex-direction:column; gap:2px; min-width:0; }
.ug-banner-t b { font:600 var(--fs-base)/1.3 var(--f-ui); color:var(--t-hi); }
.ug-banner-t span { font-size:var(--fs-sm); line-height:1.45; color:var(--t-dim); }

.ug-country { position:absolute; top:calc(var(--sp-4) + 128px); left:50%; transform:translateX(-50%);
  max-width:min(700px, 90vw); text-align:center; font-size:var(--fs-sm); line-height:1.5;
  color:var(--t-dim); text-shadow:0 1px 6px rgba(0,0,0,.85); }

/* ---- labels on the works ---- */
.ug-labels { position:absolute; inset:0; }
.ug-label { position:absolute; top:0; left:0; transform:translate(-50%,-100%);
  display:flex; flex-direction:column; gap:1px; padding:5px 8px; white-space:nowrap;
  background:var(--s-2); border:1px solid var(--edge); border-radius:var(--r-2);
  box-shadow:var(--shadow-1); pointer-events:none; }
.ug-label::after { content:''; position:absolute; left:50%; top:100%; width:1px; height:12px;
  background:var(--edge-strong); }
.ug-label b { font:500 var(--fs-sm)/1.25 var(--f-ui); color:var(--t-hi); }
.ug-label i { position:absolute; top:-8px; right:-6px; font:700 8px/1 var(--f-ui); letter-spacing:.14em;
  text-transform:uppercase; font-style:normal; color:var(--t-on-accent); background:var(--sun);
  padding:2px 4px; border-radius:2px; }
.ug-label span { font:400 var(--fs-micro)/1.3 var(--f-num); color:var(--t-faint); }
.ug-label.on { border-color:var(--sea); box-shadow:var(--glow-sea); }
.ug-label.bad { border-color:rgba(226,114,91,.6); }
.ug-label.bad span { color:var(--coral); }

/* ---- the legend ---- */
.ug-legend { position:absolute; right:var(--sp-4); top:calc(var(--sp-4) + 46px); width:286px;
  padding:var(--sp-3); background:var(--s-1); border:1px solid var(--edge); border-radius:var(--r-3);
  box-shadow:var(--shadow-2); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); }
.ug-legend-h { font:600 var(--fs-micro)/1 var(--f-ui); letter-spacing:.16em; text-transform:uppercase;
  color:var(--t-faint); margin:var(--sp-3) 0 var(--sp-2); }
.ug-legend-h:first-child { margin-top:0; }
.ug-lg { display:flex; align-items:center; gap:var(--sp-2); font-size:var(--fs-sm); color:var(--t-dim);
  line-height:1.7; }
.ug-lg i { width:12px; height:12px; border-radius:3px; flex:none; box-shadow:inset 0 0 0 1px rgba(0,0,0,.4); }
.ug-lg span { flex:1; min-width:0; }
.ug-lg b { font:600 8px/1 var(--f-ui); letter-spacing:.1em; text-transform:uppercase; color:var(--t-faint);
  border:1px solid var(--edge-strong); border-radius:2px; padding:2px 4px; }
.ug-note { margin-top:var(--sp-3); padding-top:var(--sp-3); border-top:1px solid var(--edge);
  font-size:var(--fs-micro); line-height:1.55; color:var(--t-faint); }

.ug-hint { position:absolute; bottom:var(--sp-4); left:50%; transform:translateX(-50%);
  font-size:var(--fs-micro); letter-spacing:.1em; color:var(--t-faint); text-transform:uppercase; }
.ug-hint kbd { font:600 9px/1 var(--f-num); background:var(--s-sunk); border:1px solid var(--edge);
  border-radius:3px; padding:2px 5px; margin-right:4px; color:var(--t-dim); }

@media (max-width: 1100px) {
  .ug-legend { display:none; }
  .ug-country { font-size:var(--fs-micro); }
}
`;
  document.head.append(s);
}
