// What is on, on the ground.
//
// WHY THIS LAYER EXISTS. Until this file was written, nothing in data/events.json was visible out of
// the window. The simulation knew everything: a critic flew to Point Lookout at noon on the Straddie
// Arts Trail with `events.crowdNow` at 1,471, `crowd.outdoors` at 671 and 1,236 people drawn, took
// two frames at street level and at head height, and got houses on bare ground. Identical to twenty
// past five on a nothing day. Fifteen render layers and not one of them read the events read model.
//
// So an island holding fourteen hundred people at a festival looked exactly like the same island on
// a Tuesday, which is the one thing a digital twin of a place with a calendar cannot afford.
//
// WHAT IT DRAWS, AND WHERE EVERY DECISION COMES FROM
//   `src/systems/agents/events.js` publishes `sites`: for each running event, the place ids it is
//   at today, how far up its kit is at this minute, and what that kit is. The kit itself comes from
//   `sim_defaults.site_kit` in data/events.json: how many marquees per square root of the expected
//   crowd, whether there is a stage, how many banners, whether there is a bunting run. Toilets and
//   bins are the record's own `needs.toilets_extra` and `needs.waste_extra_bins`.
//
//   This file decides none of that. It resolves place ids against data/places.json, finds ground
//   that will take a marquee, and draws. If a market looks wrong, the argument is with a number in
//   a data pack, which is the point.
//
// WHAT YOU SEE, AND WHY IT IS TRUE OF THIS ISLAND
//   A fortnightly market at Point Lookout is a row of white pop-ups on the grass beside the bowls
//   club greens, up by seven and gone by two. The Quandamooka Festival at Dunwich is thirty of them
//   with a stage, sixty wheelie bins and twenty portable toilets, because that is what the record's
//   own needs block says it takes. The Arts Trail is banners in three townships and almost nothing
//   else, because its crowd is spread over thirty-three stops and it is the cheapest large event
//   the island runs. Anzac Day puts nothing on the ground at all, and that is the correct picture.
//   Nippers on a 1.8 m swell has moved to Cylinder Beach, and the tent and the flags are on the
//   other beach, because the record's own place note says the beach is chosen on the morning.
//
// CULTURAL NOTE, AND IT IS ABSOLUTE
//   Nothing here draws or generates Aboriginal design of any kind, no signage carries readable text,
//   nothing is branded, and a record carrying `cultural_handling` gets exactly the same plain hire
//   marquees and wheelie bins as a footy carnival. The dates, the crowd, the bins and the ferries
//   are the whole of what this project holds about those events. The blocking prohibitions in
//   data/lore.json that forbid generated Aboriginal art and invented cultural practice both cover
//   this layer, and the safe reading of them is that a marquee is a marquee everywhere.
//
// HOW IT STAYS CHEAP
//   Six thin-instanced meshes, so six draw calls whatever is on, and at most a few hundred instances
//   island-wide because there are only ever a handful of events running. The instance buffers are
//   rebuilt only when the site list, the kit counts or the raise fraction actually change, and never
//   more than ten times a second. Ground anchors are searched once per event and place and cached.
//
// Reads: events, daylight, weather, world.island, world.data.places. Draws nothing headless.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hash01 = (h) => (h % 100000) / 100000;

/** Instance ceilings. The whole island's events at once have never come near these. */
const CAP = { marquee: 180, stage: 8, loo: 90, bin: 160, banner: 90, bunting: 24 };

/** Ground a marquee will stand on. Nothing goes in the water, a lake, a swamp or a mangrove. */
const NO_PITCH = { water: 1, lake: 1, swamp: 1, mangrove: 1, saltmarsh: 1 };
/**
 * Place types whose published coordinate is a building rather than a paddock. A club's point is the
 * clubhouse, so a market pitched on it stands its marquees through the roof. The kit is set out
 * beside the venue instead, at the distance you would actually walk from the door.
 */
const BUILT = { club: 40, hall: 34, museum: 30, school: 46, surf_club: 38, jetty: 34, terminal: 40, shop: 30 };
/** Above mean sea level plus a margin, so a beach event sits on the dry backshore, not the wet sand. */
const MIN_GROUND_M = 1.9;
const MAX_SLOPE = 0.20;

/* ------------------------------------------------------------------ geometry

Everything here is ordinary hire gear, modelled at its real size in metres with its pivot on the
ground so an instance scale of 1 is the real thing. Vertex colours are baked in and the shader
tints them, which is how six meshes cover every event on the island. */

function mesh() {
  return { pos: [], nrm: [], col: [], idx: [] };
}

/** An axis-aligned box, centre and full sizes, one colour. */
function box(m, cx, cy, cz, w, h, d, col) {
  const faces = [
    { o: [0, 0, -0.5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
    { o: [0, 0, 0.5], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    { o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
    { o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
    { o: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    { o: [0, -0.5, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] }
  ];
  for (const f of faces) {
    const base = m.pos.length / 3;
    for (const [su, sv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      m.pos.push(
        cx + f.o[0] * w + f.u[0] * su * w + f.v[0] * sv * w,
        cy + f.o[1] * h + f.u[1] * su * h + f.v[1] * sv * h,
        cz + f.o[2] * d + f.u[2] * su * d + f.v[2] * sv * d
      );
      m.nrm.push(f.n[0], f.n[1], f.n[2]);
      m.col.push(col[0], col[1], col[2]);
    }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** A flat quad from four corners. Two-sided meshes get drawn with culling off. */
function quad(m, p0, p1, p2, p3, n, col) {
  const base = m.pos.length / 3;
  for (const p of [p0, p1, p2, p3]) { m.pos.push(p[0], p[1], p[2]); m.nrm.push(n[0], n[1], n[2]); m.col.push(col[0], col[1], col[2]); }
  m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function finish(m) {
  return {
    pos: new Float32Array(m.pos), nrm: new Float32Array(m.nrm),
    col: new Float32Array(m.col), idx: new Uint16Array(m.idx)
  };
}

const CANVAS = [0.94, 0.93, 0.90];   // marquee canvas, off white
const FRAME = [0.34, 0.35, 0.37];    // aluminium leg
const DARK = [0.13, 0.13, 0.14];     // stage deck and scrim
const LOO_BODY = [0.80, 0.82, 0.83];
const LOO_DOOR = [0.55, 0.62, 0.66];
const BIN_BODY = [0.16, 0.24, 0.18];
const BIN_LID = [0.86, 0.72, 0.16];
const POLE = [0.42, 0.43, 0.44];

/**
 * A three by three pop-up marquee: four legs, a pyramid roof with an overhang. Three metres square
 * is the one piece of event gear every club, market and school on this coast owns.
 */
function marqueeMesh() {
  const m = mesh();
  const half = 1.5, legH = 2.15, top = 2.15, apex = 2.95, over = 1.66;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(m, sx * (half - 0.06), legH / 2, sz * (half - 0.06), 0.07, legH, 0.07, FRAME);
  }
  // The roof: four triangles from the rim to the apex, drawn as quads collapsed at the top so the
  // whole thing stays one index buffer.
  const rim = [[-over, top, -over], [over, top, -over], [over, top, over], [-over, top, over]];
  for (let i = 0; i < 4; i++) {
    const a = rim[i], b = rim[(i + 1) % 4];
    const mx = (a[0] + b[0]) * 0.5, mz = (a[2] + b[2]) * 0.5;
    const n = [mx * 0.4, 0.72, mz * 0.4];
    quad(m, a, b, [0, apex, 0], [0, apex, 0], n, CANVAS);
  }
  // A valance under the rim, which is the part you actually see from head height.
  for (let i = 0; i < 4; i++) {
    const a = rim[i], b = rim[(i + 1) % 4];
    quad(m, [a[0], top - 0.26, a[2]], [b[0], top - 0.26, b[2]], [b[0], top, b[2]], [a[0], top, a[2]],
      [a[0] * 0.5, 0, a[2] * 0.5], CANVAS);
  }
  return finish(m);
}

/** A stage: a deck, a back scrim and two wing poles. Eight metres by five, which is a truck back. */
function stageMesh() {
  const m = mesh();
  box(m, 0, 0.55, 0, 8.4, 1.1, 5.2, DARK);
  box(m, 0, 3.2, -2.5, 8.4, 4.2, 0.2, DARK);
  box(m, -4.1, 2.6, 2.4, 0.18, 5.2, 0.18, POLE);
  box(m, 4.1, 2.6, 2.4, 0.18, 5.2, 0.18, POLE);
  box(m, 0, 5.1, 0, 8.4, 0.2, 5.0, DARK);
  return finish(m);
}

/** A portable toilet. One point one metres square, two point three tall, and everybody knows it. */
function looMesh() {
  const m = mesh();
  box(m, 0, 1.15, 0, 1.12, 2.30, 1.12, LOO_BODY);
  box(m, 0, 1.10, 0.58, 0.72, 1.94, 0.06, LOO_DOOR);
  box(m, 0, 2.34, 0, 1.18, 0.10, 1.18, LOO_DOOR);
  return finish(m);
}

/** A 240 litre wheelie bin, lid up because it is an event. */
function binMesh() {
  const m = mesh();
  box(m, 0, 0.50, 0, 0.58, 1.00, 0.72, BIN_BODY);
  box(m, 0, 1.06, -0.10, 0.60, 0.10, 0.60, BIN_LID);
  return finish(m);
}

/**
 * A feather banner: a pole and a plain blade. No text, no mark, no design of any kind, which is
 * both the cultural rule and the honest one, because this project does not know what any real
 * organiser's signage looks like.
 */
function bannerMesh() {
  const m = mesh();
  box(m, 0, 1.7, 0, 0.06, 3.4, 0.06, POLE);
  const blade = [[0.03, 1.05, 0], [0.62, 1.32, 0], [0.62, 3.34, 0], [0.03, 3.42, 0]];
  quad(m, blade[0], blade[1], blade[2], blade[3], [0, 0, 1], [1, 1, 1]);
  quad(m, blade[3], blade[2], blade[1], blade[0], [0, 0, -1], [1, 1, 1]);
  return finish(m);
}

/** A twelve metre bunting run between two poles, sixteen plain flags on a sag. */
function buntingMesh() {
  const m = mesh();
  const span = 12, sag = 0.9, h = 2.7;
  box(m, -span / 2, h / 2, 0, 0.06, h, 0.06, POLE);
  box(m, span / 2, h / 2, 0, 0.06, h, 0.06, POLE);
  const yAt = (t) => h - sag * Math.sin(t * Math.PI);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = -span / 2 + span * t;
    const y = yAt(t);
    const w = 0.22, d = 0.36;
    const tri = [[x - w, y, 0], [x + w, y, 0], [x, y - d, 0]];
    const base = m.pos.length / 3;
    for (const p of tri) { m.pos.push(p[0], p[1], p[2]); m.nrm.push(0, 0, 1); m.col.push(1, 1, 1); }
    m.idx.push(base, base + 1, base + 2);
    const base2 = m.pos.length / 3;
    for (const p of [tri[2], tri[1], tri[0]]) { m.pos.push(p[0], p[1], p[2]); m.nrm.push(0, 0, -1); m.col.push(1, 1, 1); }
    m.idx.push(base2, base2 + 1, base2 + 2);
  }
  // The line itself, a thin dark ribbon so the run reads from further away than the flags do.
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x0 = -span / 2 + span * t0, x1 = -span / 2 + span * t1;
    quad(m, [x0, yAt(t0), -0.01], [x1, yAt(t1), -0.01], [x1, yAt(t1) + 0.03, -0.01], [x0, yAt(t0) + 0.03, -0.01],
      [0, 0, 1], [0.22, 0.22, 0.22]);
  }
  return finish(m);
}

/* ------------------------------------------------------------------ shaders

The lighting is the same model the people and buildings layers use, so a marquee standing behind a
house is lit by the same sun, sits in the same haze and goes the same colour at dusk. */

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
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.30) * (0.42 + 0.34 * clamp(N.y, 0.0, 1.0));
  float sideways = clamp(1.0 - abs(N.y), 0.0, 1.0);
  vec3 bounce = vec3(0.88, 0.82, 0.70) * uSunCol.rgb * uSunCol.a
    * (0.09 + 0.24 * sideways + 0.20 * clamp(-N.y, 0.0, 1.0));
  return base * (sun + sky + bounce);
}
vec3 hazed(vec3 col, vec3 P) {
  float dist = length(P - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = mix(uSkyHz.rgb, uSky.rgb, 0.3);
  return mix(col, hz, fog * 0.86);
}
`;

const KIT_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec4 iPos;    // x, y, z, yaw in radians
attribute vec4 iSize;   // x scale, y scale, z scale, w raise 0..1
attribute vec4 iTint;   // rgb tint, a lamp 0..1
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vLamp;

void main(void) {
  // Raise. A marquee goes up: it grows out of the ground over its own raise fraction, which is why
  // arriving at a market at half past six looks like a bump-in rather than a finished picture.
  float up = clamp(iSize.w, 0.0, 1.0);
  vec3 p = position * vec3(iSize.x, iSize.y * up, iSize.z);
  vec3 n = normal;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 pr = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 nr = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vPos = pr + iPos.xyz;
  vNrm = normalize(nr);
  vCol = colour * iTint.rgb;
  vLamp = iTint.a;
  gl_Position = viewProjection * vec4(vPos, 1.0);
}
`;

const KIT_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vLamp;
${COMMON_LIGHT}
void main(void) {
  vec3 col = litColour(vCol, normalize(vNrm), vPos);
  // After dark an event that is still running has lights in it. This is the only emissive term in
  // the layer and it is off in daylight, so a marquee at noon is lit by the sun like everything else.
  col += vCol * vec3(1.0, 0.88, 0.62) * vLamp * (1.0 - uSun.w) * 0.9;
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

/* ================================================================== the layer */

export function registerEventSites(world) {
  const state = world.publish('eventsite', {
    rendered: false,
    sites: 0,
    marquees: 0,
    stages: 0,
    toilets: 0,
    bins: 0,
    banners: 0,
    bunting: 0,
    instances: 0,
    anchorsFound: 0,
    anchorsFailed: 0,
    rebuilds: 0,
    buildMs: 0,
    notes: []
  });

  world.register({
    id: 'eventsite',
    phase: 'presentation',
    order: 41,
    describe() {
      return {
        rendered: state.rendered,
        sites: state.sites,
        marquees: state.marquees,
        stages: state.stages,
        toilets: state.toilets,
        bins: state.bins,
        banners: state.banners,
        instances: state.instances,
        anchorsFailed: state.anchorsFailed
      };
    }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;

  /* ---------------------------------------------------------------- places */

  const placeXZ = new Map();
  {
    const list = (world.data && world.data.places && world.data.places.places) || [];
    for (const p of list) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !island) continue;
      const xz = island.project(p.lon, p.lat);
      placeXZ.set(p.id, { x: xz.x, z: xz.z, type: p.type || 'place', name: p.name });
    }
    if (!placeXZ.size) state.notes.push('data/places.json gave no coordinates, so nothing can be put on the ground.');
  }

  /** Will this square metre take a marquee? */
  function pitchable(x, z) {
    if (!island) return false;
    if (NO_PITCH[island.landCover(x, z)]) return false;
    if (island.height(x, z) < MIN_GROUND_M) return false;
    return island.slope(x, z) < MAX_SLOPE;
  }

  /**
   * Where an event's kit actually stands at a place.
   *
   * A published place coordinate is a point somebody dropped on a map, and for a beach it is
   * usually on the sand at the waterline. So this walks out from that point in a fixed spiral until
   * it finds ground that will take a marquee, which puts a surf contest's tents on the dry backshore
   * and a foreshore clean-up's sign-on table on the grass rather than in Moreton Bay. The search is
   * a pure function of the ids, so the same event lands in the same spot in every replay of the
   * same world, and it is cached because it is the same answer every tick.
   */
  const anchors = new Map();
  function anchorFor(evId, placeId) {
    const key = evId + '|' + placeId;
    let a = anchors.get(key);
    if (a !== undefined) return a;
    const p = placeXZ.get(placeId);
    if (!p) { anchors.set(key, null); state.anchorsFailed++; return null; }
    a = null;
    const seed = hashStr(key);
    const turn = hash01(hash32(seed, 5)) * Math.PI * 2;
    const standOff = BUILT[p.type] || 0;
    // A venue with a building on its point gets its kit set out beside the building, at a hashed
    // bearing, so a market at the bowls club is on the grass rather than through the clubhouse roof.
    let ox = p.x, oz = p.z;
    if (standOff) { ox = p.x + Math.cos(turn) * standOff; oz = p.z + Math.sin(turn) * standOff; }
    if (pitchable(ox, oz)) {
      a = { x: ox, z: oz, yaw: hash01(hash32(seed, 3)) * Math.PI * 2, place: placeId, type: p.type };
    } else {
      outer:
      for (let ring = 1; ring <= 9; ring++) {
        const r = standOff + ring * 16;
        for (let k = 0; k < 12; k++) {
          const th = turn + (k / 12) * Math.PI * 2;
          const x = p.x + Math.cos(th) * r, z = p.z + Math.sin(th) * r;
          if (!pitchable(x, z)) continue;
          a = { x, z, yaw: th + Math.PI, place: placeId, type: p.type };
          break outer;
        }
      }
    }
    if (a) state.anchorsFound++; else state.anchorsFailed++;
    anchors.set(key, a);
    return a;
  }

  /* ---------------------------------------------------------------- instance buffers */

  const buf = {};
  for (const k of Object.keys(CAP)) {
    buf[k] = {
      pos: new Float32Array(CAP[k] * 4),
      size: new Float32Array(CAP[k] * 4),
      tint: new Float32Array(CAP[k] * 4),
      mat: new Float32Array(CAP[k] * 16),
      n: 0
    };
    // Thin instances need a matrix buffer to be counted, even though the shader builds the whole
    // transform itself. Every matrix here is the identity, written once, never touched again.
    for (let i = 0; i < CAP[k]; i++) {
      const o = i * 16;
      buf[k].mat[o] = 1; buf[k].mat[o + 5] = 1; buf[k].mat[o + 10] = 1; buf[k].mat[o + 15] = 1;
    }
  }

  const meshes = {};
  const mats = {};
  let ready = false;
  let sig = '';
  let lastBuild = -1e9;

  const vCam = new B.Vector3();
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.3, 0.5, 0.8, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.8, 0.4);
  const vTune = new B.Vector4(1e-5, 0, 0, 0);

  function shader(name, twoSided) {
    const m = new B.ShaderMaterial(name, stage.scene,
      { vertexSource: KIT_VERT, fragmentSource: KIT_FRAG },
      {
        attributes: ['position', 'normal', 'colour', 'world0', 'world1', 'world2', 'world3', 'iPos', 'iSize', 'iTint'],
        uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune']
      });
    m.backFaceCulling = !twoSided;
    return m;
  }

  function realise(name, data, material) {
    const m = new B.Mesh(name, stage.scene);
    const vd = new B.VertexData();
    vd.positions = data.pos;
    vd.normals = data.nrm;
    vd.indices = data.idx;
    vd.applyToMesh(m, false);
    m.setVerticesData('colour', data.col, false, 3);
    m.material = material;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    return m;
  }

  function put(kind, x, y, z, yaw, sx, sy, sz, up, tr, tg, tb, lamp) {
    const b = buf[kind];
    if (b.n >= CAP[kind]) return;
    const o = b.n * 4;
    b.pos[o] = x; b.pos[o + 1] = y; b.pos[o + 2] = z; b.pos[o + 3] = yaw;
    b.size[o] = sx; b.size[o + 1] = sy; b.size[o + 2] = sz; b.size[o + 3] = up;
    b.tint[o] = tr; b.tint[o + 1] = tg; b.tint[o + 2] = tb; b.tint[o + 3] = lamp;
    b.n++;
  }

  /* ---------------------------------------------------------------- laying out a site

  Marquees go in rows, because that is how a market or a festival is actually set out and because a
  scatter of tents at random bearings reads as debris from the air. The row bearing is a hash of the
  event and the place, so it is the same every replay, and each position is ground-tested before it
  is used: anything that lands in water, on a lake, in a swamp or on a slope is dropped rather than
  drawn floating. */

  const SPACING_DEFAULT = 6.0;

  function layOutMarquees(a, count, spacing, seed, up, lamp, stagger) {
    if (count <= 0) return;
    const perRow = Math.max(2, Math.ceil(Math.sqrt(count * 1.6)));
    const rows = Math.ceil(count / perRow);
    const yaw = a.yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let placed = 0;
    for (let r = 0; r < rows && placed < count; r++) {
      const rowZ = (r - (rows - 1) / 2) * (spacing + 3.4);
      for (let i = 0; i < perRow && placed < count; i++) {
        const rowX = (i - (perRow - 1) / 2) * spacing;
        // A hand-laid row is not a ruled line. A little jitter, deterministic per position.
        const h = hash32(seed, r * 97 + i);
        const jx = (hash01(h) - 0.5) * 1.1;
        const jz = (hash01(h >>> 7) - 0.5) * 1.1;
        const x = a.x + (rowX + jx) * c + (rowZ + jz) * s;
        const z = a.z - (rowX + jx) * s + (rowZ + jz) * c;
        if (!pitchable(x, z)) continue;
        // Staggered raise, so a bump-in is one marquee at a time rather than a field of them
        // inflating together.
        const own = stagger ? clamp((up - placed / Math.max(1, count) * 0.45) / 0.55, 0, 1) : up;
        if (own > 0.02) {
          put('marquee', x, island.height(x, z) - 0.05, z, yaw + (hash01(h >>> 13) - 0.5) * 0.10,
            1, 1, 1, own, 1, 1, 1, lamp * 0.55);
        }
        placed++;
      }
    }
  }

  /** A service line: bins and portable toilets, in a row off to one side, which is where they go. */
  function layOutLine(kind, a, count, spacing, seed, up, offset, sizeY) {
    if (count <= 0) return;
    const yaw = a.yaw + Math.PI / 2;
    const c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * spacing;
      const h = hash32(seed, i * 31 + 11);
      const x = a.x + along * c + offset * s;
      const z = a.z - along * s + offset * c;
      if (!pitchable(x, z)) continue;
      put(kind, x, island.height(x, z) - 0.03, z, yaw + (hash01(h) - 0.5) * 0.2,
        1, sizeY, 1, up, 1, 1, 1, 0);
    }
  }

  /** Plain banner blades. Three muted colours, chosen by a hash of the event id and nothing else. */
  const BANNER_TINT = [[0.24, 0.62, 0.66], [0.86, 0.68, 0.20], [0.80, 0.44, 0.36], [0.46, 0.52, 0.64]];

  function layOutBanners(a, count, seed, up, lamp) {
    if (count <= 0) return;
    const tint = BANNER_TINT[hash32(seed, 17) % BANNER_TINT.length];
    for (let i = 0; i < count; i++) {
      const th = (i / Math.max(1, count)) * Math.PI * 2 + hash01(hash32(seed, i * 13 + 3)) * 0.7;
      const r = 16 + hash01(hash32(seed, i * 29 + 5)) * 12;
      const x = a.x + Math.cos(th) * r, z = a.z + Math.sin(th) * r;
      if (!pitchable(x, z)) continue;
      put('banner', x, island.height(x, z), z, th + Math.PI / 2, 1, 1, 1, up, tint[0], tint[1], tint[2], lamp * 0.3);
    }
  }

  /* ---------------------------------------------------------------- the build */

  function rebuild(w) {
    const t0 = performance.now();
    for (const k of Object.keys(buf)) buf[k].n = 0;
    const ev = w.read('events');
    const dl = w.read('daylight');
    const dark = dl ? clamp(1 - (dl.daylight != null ? dl.daylight : (dl.altitude > 0 ? 1 : 0)), 0, 1) : 0;
    let marquees = 0, stages = 0, toilets = 0, bins = 0, banners = 0, buntings = 0, sites = 0;

    for (const site of (ev && ev.sites) || []) {
      const kit = site.kit;
      if (!kit) continue;
      const up = clamp(site.up || 0, 0, 1);
      if (up <= 0.01) continue;
      // Lights only while there are people there and only after dark. A packed-down site is dark.
      const lamp = site.onSiteNow > 0 ? dark : 0;

      // Which places get gear. A single-site event puts everything at its first resolvable place.
      // A distributed one, and the arts trail is the only one in the pack, splits it across the
      // townships it names, because its own record says the crowd never gathers in one spot.
      const ids = site.placeIds || [];
      let placesUsed = [];
      if (site.spread === 'distributed') {
        for (const id of ids) { const a = anchorFor(site.id, id); if (a) placesUsed.push(a); }
      } else {
        for (const id of ids) { const a = anchorFor(site.id, id); if (a) { placesUsed.push(a); break; } }
      }
      if (!placesUsed.length) continue;
      sites++;

      const share = 1 / placesUsed.length;
      for (let pi = 0; pi < placesUsed.length; pi++) {
        const a = placesUsed[pi];
        const seed = hashStr(site.id + '|' + a.place);
        const n = Math.round(kit.marquees * share);
        layOutMarquees(a, n, SPACING_DEFAULT, seed, up, lamp, true);
        marquees += n;

        if (kit.stage && pi === 0) {
          const c = Math.cos(a.yaw), s = Math.sin(a.yaw);
          const sx = a.x + 0 * c + -26 * s, sz = a.z - 0 * s + -26 * c;
          if (pitchable(sx, sz)) {
            put('stage', sx, island.height(sx, sz) - 0.05, sz, a.yaw, 1, 1, 1, up, 1, 1, 1, lamp);
            stages++;
          }
        }

        const nLoo = Math.round(kit.toilets * share);
        layOutLine('loo', a, nLoo, 1.6, seed ^ 0x51, up, 24, 1);
        toilets += nLoo;

        const nBin = Math.round(kit.bins * share);
        layOutLine('bin', a, nBin, 1.1, seed ^ 0x77, up, -19, 1);
        bins += nBin;

        const nBan = Math.max(kit.banners ? 1 : 0, Math.round(kit.banners * share));
        layOutBanners(a, nBan, seed, up, lamp);
        banners += nBan;

        if (kit.bunting && pi === 0) {
          const c = Math.cos(a.yaw), s = Math.sin(a.yaw);
          const bx = a.x + 0 * c + 13 * s, bz = a.z - 0 * s + 13 * c;
          if (pitchable(bx, bz)) {
            put('bunting', bx, island.height(bx, bz), bz, a.yaw, 1, 1, 1, up, 0.92, 0.90, 0.86, lamp * 0.5);
            buntings++;
          }
        }
      }
    }

    let total = 0;
    for (const k of Object.keys(buf)) {
      const b = buf[k];
      meshes[k].thinInstanceCount = b.n;
      if (b.n) {
        meshes[k].thinInstanceBufferUpdated('iPos');
        meshes[k].thinInstanceBufferUpdated('iSize');
        meshes[k].thinInstanceBufferUpdated('iTint');
      }
      total += b.n;
    }
    state.sites = sites;
    state.marquees = marquees;
    state.stages = stages;
    state.toilets = toilets;
    state.bins = bins;
    state.banners = banners;
    state.bunting = buntings;
    state.instances = total;
    state.rebuilds++;
    state.buildMs = +(performance.now() - t0).toFixed(2);
  }

  /** What would change the picture. Quantised, so a rebuild happens on a real change and not a drift. */
  function signatureOf(ev, dark) {
    if (!ev || !ev.sites || !ev.sites.length) return 'none|' + (dark > 0.5 ? 1 : 0);
    let s = '';
    for (const x of ev.sites) {
      const k = x.kit || {};
      s += x.id + ':' + (x.placeIds || []).join('.') + ':' + Math.round((x.up || 0) * 50) + ':'
        + k.marquees + ',' + (k.stage ? 1 : 0) + ',' + k.toilets + ',' + k.bins + ',' + k.banners + ',' + (k.bunting ? 1 : 0)
        + ':' + (x.onSiteNow > 0 ? 1 : 0) + ';';
    }
    return s + '|' + Math.round(dark * 8);
  }

  stage.addLayer({
    id: 'eventsite',
    order: 26,

    init() {
      const t0 = performance.now();
      mats.solid = shader('eventKit', false);
      mats.flat = shader('eventKitFlat', true);

      meshes.marquee = realise('event-marquee', marqueeMesh(), mats.solid);
      meshes.stage = realise('event-stage', stageMesh(), mats.solid);
      meshes.loo = realise('event-loo', looMesh(), mats.solid);
      meshes.bin = realise('event-bin', binMesh(), mats.solid);
      meshes.banner = realise('event-banner', bannerMesh(), mats.flat);
      meshes.bunting = realise('event-bunting', buntingMesh(), mats.flat);

      for (const k of Object.keys(meshes)) {
        meshes[k].thinInstanceSetBuffer('matrix', buf[k].mat, 16, true);
        meshes[k].thinInstanceSetBuffer('iPos', buf[k].pos, 4, false);
        meshes[k].thinInstanceSetBuffer('iSize', buf[k].size, 4, false);
        meshes[k].thinInstanceSetBuffer('iTint', buf[k].tint, 4, false);
        meshes[k].thinInstanceCount = 0;
        meshes[k].alphaIndex = 5;
      }
      ready = true;
      state.rendered = true;
      state.buildMs = +(performance.now() - t0).toFixed(1);
      console.info(`[eventsite] marquees, stage, toilets, bins, banners and bunting: six draw calls, built in ${state.buildMs} ms`);
    },

    frame(st, w) {
      if (!ready) return;

      /* --- lighting, matched to people and buildings so a tent and a house agree --- */
      const cam = st.scene.activeCamera;
      vCam.copyFrom(cam.globalPosition || cam.position);
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

      for (const m of [mats.solid, mats.flat]) {
        m.setVector3('uCam', vCam);
        m.setVector4('uSun', vSun);
        m.setVector4('uSunCol', vSunCol);
        m.setVector4('uSky', vSky);
        m.setVector4('uSkyHz', vSkyHz);
        m.setVector4('uTune', vTune);
      }

      const ev = w.read('events');
      const dark = 1 - dayF;
      const s = signatureOf(ev, dark);
      const now = performance.now();
      if (s !== sig && now - lastBuild > 100) {
        sig = s;
        lastBuild = now;
        rebuild(w);
      }
    },

    dispose() {
      for (const k of Object.keys(meshes)) { meshes[k].dispose(); }
      for (const k of Object.keys(mats)) { mats[k].dispose(); }
      ready = false;
    }
  });
}
