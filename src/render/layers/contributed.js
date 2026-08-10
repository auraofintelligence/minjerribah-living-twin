// The contributed map, on the ground.
//
// WHAT THIS DRAWS, AND WHY IT IS THE THING THAT WAS MISSING
//   Forty-two public features that an islander walked to and pinned himself: twenty bus stops on the
//   two routes this twin already runs buses along, three water treatment plants, the tip and its
//   metal and green waste bays, the council depot, the ambulance station, two toilet blocks, the
//   fishing jetty, the skate park, the BMX track, the courts, Myora Springs and the shark-proof
//   swimming enclosure in the bay at Amity Point.
//
//   All of it was already in a data pack, screened, reconciled and provenanced to a standard nothing
//   else in this repository reaches, and none of it was on screen. A critic flew the island, opened
//   four screenshots and found no jetty, no boat ramp, no bus stop, no swimming enclosure and no
//   toilet block, and said the correct thing: everything the slice did well was invisible and
//   everything it did not do was what a player experiences.
//
// HOW IT READS AS A MARKER RATHER THAN AS A BUILDING
//   These are not scanned objects and this project does not know what any of them look like. So they
//   are drawn as what they are: survey markers. A slender post with a canted plate on top, sized in
//   real metres up close and held to a floor of a few pixels from far away, so from orbit they read
//   as pins on the island and at head height they stand next to you at the right size. Nothing here
//   pretends to be a model of a building, because inventing the shape of a real shed on a real
//   island is exactly the kind of small lie this project does not tell.
//
//   Bus stops get their own shape, because a bus stop is the one piece of street furniture on this
//   island a person navigates by: a pole with a flag panel facing the road. The flag warms when a
//   published departure from that stop is inside ten minutes, and goes out again when the bus has
//   gone, which is a thing a player can notice without being told.
//
// NAMING THEM
//   `TWIN.shot()` captures the canvas and the canvas cannot contain text this project would trust,
//   so the names are DOM nameplates projected onto the canvas: the nearest fourteen, inside two and
//   a half kilometres, sorted so the selected one always survives. Same technique as the cutaway
//   overlay in src/render/layers/underground.js and for the same reason.
//
// WHAT IT NEVER SHOWS
//   Open, closed, running, staffed, serviced or safe. Every one of these records says in its own
//   fields that current state is the one thing the contributor could not vouch for. The marker says
//   the thing is there. The panel says who put it there and when. Nothing says how it is today.
//
// Reads: contributed, daylight, weather, selection, world.island. Draws nothing headless.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Marker tints, from src/ui/design.css. The same five words the rest of the interface uses. */
const TONE = {
  sea: [0.247, 0.714, 0.769],
  sun: [0.941, 0.706, 0.161],
  coral: [0.886, 0.447, 0.357],
  leaf: [0.561, 0.749, 0.353],
  heath: [0.706, 0.541, 0.769],
  iron: [0.549, 0.600, 0.639],
  sand: [0.910, 0.863, 0.769]
};

const POST = [0.28, 0.30, 0.32];      // galvanised post
const PLATE_BACK = [0.16, 0.17, 0.18];

const CAP = 96;                        // there are 42. The ceiling is headroom, not a target.
const LABELS = 16;
/** How many pixels across a pin head is, whatever the zoom. Sixteen is a legible dot, not a badge. */
const PIN_PX = 17;

/* ------------------------------------------------------------------ geometry

Built in metres with the pivot on the ground, so an instance scale of 1 is the real thing. Same
mesh helpers as src/render/layers/eventsite.js, kept local because a shared geometry module would
couple two layers that have no business knowing about each other. */

function mesh() { return { pos: [], nrm: [], col: [], idx: [] }; }

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

/** A flat quad from four corners, both sides given the same colour. */
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

/**
 * The survey marker: a 60 mm post to 2.4 m with a 420 mm plate canted back off the top, and a
 * small collar at the base so it reads as driven into the ground rather than resting on it. The
 * plate face carries the instance tint; its back and the post do not, so a marker reads as a marker
 * from behind and as a coloured disc from in front.
 */
function markerMesh() {
  const m = mesh();
  const h = 2.4;
  box(m, 0, h / 2, 0, 0.06, h, 0.06, POST);
  box(m, 0, 0.10, 0, 0.30, 0.20, 0.30, PLATE_BACK);
  // The plate: two quads back to back, canted 14 degrees so it catches the sun from above.
  const y0 = h - 0.02, w = 0.21, tilt = 0.052;
  quad(m,
    [-w, y0 - w + tilt, -0.035], [w, y0 - w + tilt, -0.035],
    [w, y0 + w - tilt, 0.035], [-w, y0 + w - tilt, 0.035],
    [0, 0.26, -0.97], [1, 1, 1]);
  quad(m,
    [w, y0 - w + tilt, -0.045], [-w, y0 - w + tilt, -0.045],
    [-w, y0 + w - tilt, 0.025], [w, y0 + w - tilt, 0.025],
    [0, -0.26, 0.97], PLATE_BACK);
  return finish(m);
}

/**
 * A bus stop: a 2.9 m pole with a 300 by 460 flag panel at the top, the plate that carries the route
 * number on a real one. The panel takes the tint and the lamp, so a stop with a bus due lights its
 * flag. There is no seat and no shelter: most stops on this island have neither, and drawing one
 * would be inventing street furniture.
 */
function busStopMesh() {
  const m = mesh();
  const h = 2.9;
  box(m, 0, h / 2, 0, 0.07, h, 0.07, POST);
  box(m, 0, 0.09, 0, 0.34, 0.18, 0.34, PLATE_BACK);
  const top = h - 0.06, w = 0.15, hh = 0.23;
  quad(m, [-w, top - hh * 2, 0.045], [w, top - hh * 2, 0.045], [w, top, 0.045], [-w, top, 0.045], [0, 0, 1], [1, 1, 1]);
  quad(m, [w, top - hh * 2, -0.045], [-w, top - hh * 2, -0.045], [-w, top, -0.045], [w, top, -0.045], [0, 0, -1], [1, 1, 1]);
  // A thin white band across the panel, so the flag reads as a sign and not as a lolly.
  quad(m, [-w, top - hh - 0.03, 0.05], [w, top - hh - 0.03, 0.05], [w, top - hh + 0.03, 0.05], [-w, top - hh + 0.03, 0.05], [0, 0, 1], [0.96, 0.96, 0.94]);
  return finish(m);
}

/**
 * The pin head: a unit quad, turned to face the camera in the vertex shader and sized in pixels
 * rather than in metres.
 *
 * This exists because a post cannot win an argument with a 39 km island. The planner camera opens
 * sixteen kilometres up, where a metre is a fifteenth of a pixel, and a 2.4 m marker post scaled up
 * enough to be eight pixels tall is still a fifth of a pixel wide, which is nothing at all. So from
 * a distance the marker is a map pin: a coloured disc of a fixed size on screen, exactly the way an
 * atlas marks a town, and it fades out as you come down so that what you are standing next to at
 * head height is a real post at its real size and not a floating badge.
 */
function pinMesh() {
  const m = mesh();
  quad(m, [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1], [1, 1, 1]);
  return finish(m);
}

/* ------------------------------------------------------------------ shaders

The same light model the marquees, the houses and the people use, so a marker standing beside a
house is lit by the same sun and sits in the same haze. */

const COMMON_LIGHT = `
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;
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

const MARK_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec4 iPos;    // x, y, z, yaw
attribute vec4 iSize;   // x uniform scale, y selected 0..1, z hover 0..1, w unused
attribute vec4 iTint;   // rgb plate tint, a lamp 0..1
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vLamp;
varying float vMark;

void main(void) {
  vec3 p = position * iSize.x;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 pr = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 n = normal;
  vec3 nr = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vPos = pr + iPos.xyz;
  vNrm = normalize(nr);
  // The plate is the only white-vertex part of either mesh, so the tint lands on the plate and
  // nowhere else. One mesh, two materials' worth of look, no second draw call.
  float isPlate = step(0.995, min(min(colour.r, colour.g), colour.b));
  vCol = mix(colour, iTint.rgb, isPlate);
  vLamp = iTint.a * isPlate;
  vMark = max(iSize.y, iSize.z * 0.55);
  gl_Position = viewProjection * vec4(vPos, 1.0);
}
`;

const MARK_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying float vLamp;
varying float vMark;
${COMMON_LIGHT}
void main(void) {
  vec3 col = litColour(vCol, normalize(vNrm), vPos);
  // After dark a lit plate is the only thing you can see of a marker, and a bus stop with a bus due
  // lifts further. Off in daylight: at noon a marker is lit by the sun like everything else.
  col += vCol * vec3(1.0, 0.92, 0.72) * vLamp * (1.0 - uSun.w) * 1.1;
  // Selected or hovered: a cool rim, the same --sea the selection band uses.
  col += vec3(0.247, 0.714, 0.769) * vMark * 0.55;
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

const PIN_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec4 iPos;    // x, y, z, unused
attribute vec4 iSize;   // x size in metres, y selected, z hover, w alpha
attribute vec4 iTint;   // rgb, a square 0 round 1 square
uniform mat4 viewProjection;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying vec3 vCol;
varying float vMark;
varying float vAlpha;
varying float vSquare;
void main(void) {
  vUv = position.xy * 2.0;
  vCol = iTint.rgb;
  vMark = max(iSize.y, iSize.z * 0.6);
  vAlpha = iSize.w;
  vSquare = iTint.a;
  vec3 p = iPos.xyz + (uRight * position.x + uUp * position.y) * iSize.x;
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

const PIN_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vCol;
varying float vMark;
varying float vAlpha;
varying float vSquare;
void main(void) {
  // Round for a place, square for a bus stop. One bit of shape is enough to tell twenty stops from
  // twenty-two other things at a glance, and it costs nothing.
  float dRound = length(vUv);
  float dSquare = max(abs(vUv.x), abs(vUv.y));
  float d = mix(dRound, dSquare, vSquare);
  float body = 1.0 - smoothstep(0.66, 0.80, d);
  float ring = smoothstep(0.80, 0.88, d) * (1.0 - smoothstep(0.94, 1.0, d));
  float a = (body + ring) * vAlpha;
  if (a < 0.02) discard;
  vec3 col = mix(vCol, vec3(0.04, 0.07, 0.09), ring * 0.86);
  col = mix(col, vec3(0.247, 0.714, 0.769), vMark * 0.7);
  col += vec3(1.0) * vMark * 0.25;
  gl_FragColor = vec4(col, a);
}
`;

/* ================================================================== the layer */

export function registerContributedLayer(world) {
  const state = world.publish('contributedlayer', {
    rendered: false,
    markers: 0,
    busStops: 0,
    lit: 0,
    labels: 0,
    drawCalls: 0,
    scale: 1,
    camAltM: 0,
    notes: []
  });

  world.register({
    id: 'contributedlayer',
    phase: 'presentation',
    order: 42,
    describe() {
      return {
        rendered: state.rendered,
        markers: state.markers,
        busStops: state.busStops,
        lit: state.lit,
        labels: state.labels,
        camAltM: state.camAltM,
        drawCalls: state.drawCalls
      };
    }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;

  const blank = () => ({
    pos: new Float32Array(CAP * 4), size: new Float32Array(CAP * 4),
    tint: new Float32Array(CAP * 4), mat: new Float32Array(CAP * 16), n: 0
  });
  const buf = { marker: blank(), stop: blank(), pin: blank() };
  for (const k of Object.keys(buf)) {
    for (let i = 0; i < CAP; i++) {
      const o = i * 16;
      buf[k].mat[o] = 1; buf[k].mat[o + 5] = 1; buf[k].mat[o + 10] = 1; buf[k].mat[o + 15] = 1;
    }
  }

  const meshes = {};
  const mats = {};
  let ready = false;
  let overlay = null;
  const labelPool = [];

  const vCam = new B.Vector3();
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.3, 0.5, 0.8, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.8, 0.4);
  const vTune = new B.Vector4(1e-5, 0, 0, 0);
  const vRight = new B.Vector3(1, 0, 0);
  const vUp = new B.Vector3(0, 1, 0);

  const ATTRS = ['position', 'normal', 'colour', 'world0', 'world1', 'world2', 'world3', 'iPos', 'iSize', 'iTint'];

  function material(name) {
    return new B.ShaderMaterial(name, stage.scene,
      { vertexSource: MARK_VERT, fragmentSource: MARK_FRAG },
      {
        attributes: ATTRS,
        uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune']
      });
  }

  function pinMaterial(name) {
    const m = new B.ShaderMaterial(name, stage.scene,
      { vertexSource: PIN_VERT, fragmentSource: PIN_FRAG },
      { attributes: ATTRS, uniforms: ['viewProjection', 'uRight', 'uUp'] });
    m.backFaceCulling = false;
    m.needAlphaBlending = () => true;
    // Drawn last and writing no depth, so a pin never punches a hole in the sea behind it, and
    // still tested against depth, so a pin behind a ridge is behind the ridge.
    m.disableDepthWrite = true;
    return m;
  }

  function realise(name, data, material_) {
    const m = new B.Mesh(name, stage.scene);
    const vd = new B.VertexData();
    vd.positions = data.pos;
    vd.normals = data.nrm;
    vd.indices = data.idx;
    vd.applyToMesh(m, false);
    m.setVerticesData('colour', data.col, false, 3);
    m.material = material_;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    return m;
  }

  /**
   * Which way a marker faces.
   *
   * A bus stop faces the road, because that is where a person reads it from and because a flag panel
   * seen edge on is a stick. The road is the nearest point on the navigation graph if there is one,
   * and the fall-back is the downhill direction, which on this island points at the water and is
   * where somebody standing at a jetty or an enclosure would be. Deterministic either way: no
   * hashing, no randomness, the same yaw in every replay.
   */
  function yawFor(f) {
    const net = world.read('roadNetwork');
    if (net && typeof net.nearestPoint === 'function') {
      const near = net.nearestPoint(f.x, f.z);
      if (near && near.distanceM < 90) {
        const dx = near.x - f.x, dz = near.z - f.z;
        if (dx || dz) return Math.atan2(dx, dz);
      }
    }
    if (!island) return 0;
    const e = 12;
    const gx = island.height(f.x + e, f.z) - island.height(f.x - e, f.z);
    const gz = island.height(f.x, f.z + e) - island.height(f.x, f.z - e);
    return (gx || gz) ? Math.atan2(-gx, -gz) : 0;
  }

  const items = [];

  function build() {
    const c = world.read('contributed');
    if (!c || !c.ready) return false;
    if (!c.features.length) {
      state.notes.push('The contributed pack is loaded and holds nothing this build may draw.');
      return false;
    }
    for (const f of c.features) {
      if (items.length >= CAP * 2) break;
      const isStop = f.kind === 'bus_stop';
      items.push({
        f,
        bucket: isStop ? 'stop' : 'marker',
        yaw: yawFor(f),
        // Ground it against the heightfield rather than the record's own y: the pack carries a
        // latitude and a longitude and nothing about elevation, and the terrain is what a player
        // sees a post standing on.
        y: island ? island.height(f.x, f.z) - 0.06 : 0,
        tint: TONE[f.tone] || TONE.sand
      });
    }
    items.sort((a, b) => (a.f.id < b.f.id ? -1 : 1));
    state.markers = items.filter((i) => i.bucket === 'marker').length;
    state.busStops = items.filter((i) => i.bucket === 'stop').length;
    return true;
  }

  /* ---------------------------------------------------------------- the overlay */

  function buildOverlay() {
    if (overlay) return;
    injectCss();
    const root = document.createElement('div');
    root.id = 'cm-labels';
    root.setAttribute('aria-hidden', 'true');
    const host = document.getElementById('ui-root') || document.body;
    host.append(root);
    overlay = root;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const _proj = new B.Vector3();
  const _lab = new B.Vector3();
  const _ident = B.Matrix.Identity();
  const _shown = [];

  /**
   * How far out a nameplate is worth putting up.
   *
   * Not a constant. The planner camera opens sixteen kilometres above the island, so a fixed range
   * of two and a half kilometres named nothing at all in the view a player actually opens on, which
   * is the view a critic screenshots. It scales with how far the camera is from what it is looking
   * at: close in you get the things around you, from orbit you get the sixteen nearest to the eye,
   * which is what a map does.
   */
  function labelRange(camAlt) {
    return clamp(camAlt * 3.2 + 700, 1400, 46000);
  }

  function paintLabels(perMetre, camAlt) {
    if (!overlay) return;
    const scene = stage.scene;
    const cam = scene.activeCamera;
    if (!cam) return;
    const eng = stage.engine;
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const tm = scene.getTransformMatrix();
    const camPos = cam.globalPosition || cam.position;
    const sel = world.read('selection');
    const contributed = world.read('contributed');
    const range = labelRange(camAlt);
    const near = range * 0.16;

    _shown.length = 0;
    for (const it of items) {
      const d = Math.hypot(camPos.x - it.f.x, camPos.y - it.y, camPos.z - it.f.z);
      if (d > range) continue;
      _shown.push({ it, d, near: d < near, sel: sel && sel.kind === 'facility' && sel.id === it.f.id });
    }
    _shown.sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || a.d - b.d);
    const take = _shown.slice(0, LABELS);
    state.labels = take.length;

    while (labelPool.length < LABELS) {
      const el = document.createElement('div');
      el.className = 'cm-label';
      overlay.append(el);
      labelPool.push(el);
    }
    for (let i = 0; i < labelPool.length; i++) {
      const el = labelPool[i];
      const row = take[i];
      if (!row) { el.style.display = 'none'; continue; }
      const it = row.it;
      // Anchored to the pin head, which is where the eye already is.
      const scale = clamp(perMetre * row.d * 3.4, 1, 8);
      _lab.set(it.f.x, it.y + Math.max(3.4, 2.9 * scale) + perMetre * row.d * (PIN_PX * 0.6), it.f.z);
      B.Vector3.ProjectToRef(_lab, _ident, tm, vp, _proj);
      if (_proj.z < 0 || _proj.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(_proj.x)}px, ${Math.round(_proj.y)}px)`;
      el.className = 'cm-label' + (row.sel ? ' on' : '') + (row.near || row.sel ? '' : ' far');
      // A departure, when there is a published one for this stop. Nothing else is live, because
      // nothing else about these records is known to be current.
      let sub = it.f.kindLabel;
      if (it.bucket === 'stop' && contributed && typeof contributed.departuresAt === 'function') {
        const next = contributed.departuresAt(it.f.id, 1)[0];
        if (next) sub = `${next.routeLabel} ${next.at_text} towards ${next.towards}`;
      }
      el.innerHTML = `<b>${esc(it.f.name)}</b><span>${esc(sub)}</span>`;
    }
  }

  /* ---------------------------------------------------------------- the layer */

  stage.addLayer({
    id: 'contributed',
    order: 44,

    /**
     * Nothing is built here.
     *
     * `stage.addLayer` runs a layer's init the moment it is added, which is while the manifest is
     * still being walked and long before `world.boot()` has run a single system's init. So a layer
     * that reads a read model in its own init reads an empty one, and the first version of this file
     * did exactly that and drew nothing while reporting itself rendered. The meshes are built on the
     * first frame after the system publishes, which is one branch and no ordering assumption.
     */
    init() {
      buildOverlay();
    },

    frame(st, w, dt) {
      if (!ready) {
        const c = w.read('contributed');
        if (!c || !c.ready || !c.features.length) return;
        if (!build()) return;
        mats.mark = material('contributed-mark');
        mats.pin = pinMaterial('contributed-pin');
        meshes.marker = realise('contributed-markers', markerMesh(), mats.mark);
        meshes.stop = realise('contributed-busstops', busStopMesh(), mats.mark);
        meshes.pin = realise('contributed-pins', pinMesh(), mats.pin);
        meshes.pin.alphaIndex = 20;
        for (const k of Object.keys(meshes)) {
          meshes[k].thinInstanceSetBuffer('matrix', buf[k].mat, 16, false);
          meshes[k].thinInstanceSetBuffer('iPos', buf[k].pos, 4, false);
          meshes[k].thinInstanceSetBuffer('iSize', buf[k].size, 4, false);
          meshes[k].thinInstanceSetBuffer('iTint', buf[k].tint, 4, false);
          meshes[k].thinInstanceCount = 0;
        }
        ready = true;
        state.rendered = true;
        state.drawCalls = 3;
        console.info(`[contributed] ${state.markers} markers and ${state.busStops} bus stops: three draw calls.`);
      }

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
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), 0, 0, island ? island.seaLevel : 0);
      mats.mark.setVector3('uCam', vCam);
      mats.mark.setVector4('uSun', vSun);
      mats.mark.setVector4('uSunCol', vSunCol);
      mats.mark.setVector4('uSky', vSky);
      mats.mark.setVector4('uSkyHz', vSkyHz);
      mats.mark.setVector4('uTune', vTune);

      /* --- how big a marker is on screen ---

      Real metres up close, and a screen-size floor from far away, because a 2.4 m post seen from the
      sixteen kilometres the planner camera opens at is a tenth of a pixel and the island would show
      none of its public things in the one view everybody looks at first. Walk in and it shrinks back
      to a real 2.4 m post standing on real ground beside you.

      Per marker, from that marker's own distance to the eye, not once for the whole layer from the
      camera's distance to the world origin. The first version did the latter, and flying to Amity
      Point left every marker there sized for a camera seventeen kilometres away, because the origin
      of the projection is off the west coast and the camera had not moved relative to it. */
      const h = st.engine.getRenderHeight() || 900;
      const perMetre = (2 * Math.tan((cam.fov || 0.8) * 0.5)) / h;   // metres per pixel, per metre of range
      const camAlt = Math.max(20, vCam.y - (island ? island.height(vCam.x, vCam.z) : 0));
      let nearestScale = 1;
      let nearestD = Infinity;

      // The billboard basis for the pin heads: the camera's own X and Y axes in world space, out of
      // its world matrix. Not the view matrix, which the scene does not always have to hand.
      const wm = cam.getWorldMatrix().m;
      vRight.set(wm[0], wm[1], wm[2]);
      vUp.set(wm[4], wm[5], wm[6]);
      mats.pin.setVector3('uRight', vRight);
      mats.pin.setVector3('uUp', vUp);

      const sel = w.read('selection');
      const contributed = w.read('contributed');
      const dark = 1 - dayF;
      let lit = 0;

      for (const k of Object.keys(buf)) buf[k].n = 0;
      for (const it of items) {
        const b = buf[it.bucket];
        if (b.n >= CAP) continue;
        const d = Math.max(20, Math.hypot(vCam.x - it.f.x, vCam.y - (it.y + 2.4), vCam.z - it.f.z));
        const mpp = perMetre * d;
        // Capped low on purpose. Beyond a few hundred metres the pin head takes over the job of
        // being seen, and a post that kept growing would stand a hundred metres over the township
        // like a mast, which is a different and much worse picture than a marker.
        const scale = clamp(mpp * 3.4, 1, 8);
        if (d < nearestD) { nearestD = d; nearestScale = scale; }
        const o = b.n * 4;
        b.pos[o] = it.f.x; b.pos[o + 1] = it.y; b.pos[o + 2] = it.f.z; b.pos[o + 3] = it.yaw;
        const selected = sel && sel.kind === 'facility' && sel.id === it.f.id ? 1 : 0;
        const hovered = sel && sel.hover && sel.hover.kind === 'facility' && sel.hover.id === it.f.id ? 1 : 0;
        b.size[o] = scale; b.size[o + 1] = selected; b.size[o + 2] = hovered; b.size[o + 3] = 0;
        // A stop with a published departure inside ten minutes warms its flag. Everything else gets
        // the ordinary night lamp, which is what makes a marker findable after dark.
        let lamp = dark * 0.35;
        if (it.bucket === 'stop' && contributed && typeof contributed.departuresAt === 'function') {
          const next = contributed.departuresAt(it.f.id, 1)[0];
          if (next && next.inMinutes <= 10) { lamp = Math.max(lamp, 0.85); lit++; }
        }
        b.tint[o] = it.tint[0]; b.tint[o + 1] = it.tint[1]; b.tint[o + 2] = it.tint[2]; b.tint[o + 3] = lamp;
        b.n++;

        // The pin head, per marker, sized in pixels and faded out as you walk up to the thing.
        const p = buf.pin;
        if (p.n >= CAP) continue;
        const q = p.n * 4;
        // Fades in from about fifty metres out. Closer than that a 2.9 m post beside a road is the
        // right size and the honest picture; further out a bus stop is four pixels of galvanised
        // pipe and the pin is the only thing that can be seen at all.
        const alpha = clamp((d - 55) / 130, 0, 1) * (selected || hovered ? 1 : 0.92);
        p.pos[q] = it.f.x; p.pos[q + 1] = it.y + Math.max(3.4, 2.9 * scale); p.pos[q + 2] = it.f.z; p.pos[q + 3] = 0;
        p.size[q] = Math.max(0.6, mpp * PIN_PX); p.size[q + 1] = selected; p.size[q + 2] = hovered; p.size[q + 3] = alpha;
        p.tint[q] = it.tint[0]; p.tint[q + 1] = it.tint[1]; p.tint[q + 2] = it.tint[2];
        p.tint[q + 3] = it.bucket === 'stop' ? 1 : 0;
        p.n++;
      }
      state.lit = lit;
      state.scale = Math.round(nearestScale * 100) / 100;
      state.camAltM = Math.round(camAlt);

      for (const k of Object.keys(meshes)) {
        meshes[k].thinInstanceBufferUpdated('iPos');
        meshes[k].thinInstanceBufferUpdated('iSize');
        meshes[k].thinInstanceBufferUpdated('iTint');
        meshes[k].thinInstanceCount = buf[k].n;
      }

      paintLabels(perMetre, camAlt);
    },

    dispose() {
      for (const k of Object.keys(meshes)) meshes[k].dispose();
      for (const k of Object.keys(mats)) mats[k].dispose();
      if (overlay) { overlay.remove(); overlay = null; labelPool.length = 0; }
      ready = false;
    }
  });
}

/* ------------------------------------------------------------------ css */

function injectCss() {
  if (document.getElementById('cm-css')) return;
  const s = document.createElement('style');
  s.id = 'cm-css';
  s.textContent = `
#cm-labels { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.cm-label {
  position: absolute; transform-origin: 0 0; will-change: transform;
  margin: -34px 0 0 10px; padding: 3px 7px 4px;
  background: rgba(6, 14, 18, .72); border: 1px solid rgba(232, 220, 196, .18);
  border-left: 2px solid var(--sand, #e8dcc4); border-radius: 3px;
  font: 500 11px/1.25 var(--font, system-ui, sans-serif); color: #e8dcc4;
  white-space: nowrap; letter-spacing: .01em;
  text-shadow: 0 1px 2px rgba(0,0,0,.8);
}
.cm-label b { display: block; font-weight: 650; }
.cm-label span { display: block; color: #9aa3a8; font-size: 10px; }
.cm-label.far { opacity: .55; }
.cm-label.far span { display: none; }
.cm-label.on { border-left-color: var(--sea, #3fb6c4); background: rgba(10, 30, 36, .88); color: #fff; }
.cm-label.on span { color: #cfe9ee; }
@media (prefers-reduced-motion: no-preference) { .cm-label { transition: opacity .18s linear; } }
`;
  document.head.append(s);
}
