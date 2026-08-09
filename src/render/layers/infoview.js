// Info views: the island as data.
//
// One translucent sheet is draped over the land and recoloured from whatever the simulation has
// actually published. It is the same instrument Cities: Skylines II calls an info view, built
// against a deeper simulation and against a real place, so the views can be about Minjerribah
// rather than about a generic town: the Amity Point erosion strip, the tide gate on the beach
// routes, the 3.8 km of the ferry crossing with no signal, the fifty per cent of dwellings that
// nobody lives in.
//
// How the sheet works, and why it is built this way:
//
//   * The wash is a single indexed mesh at 64 m over the island and 2.5 km of its sea, drawn in
//     one draw call. Vertex heights come from the same heightfield the terrain draws, plus a
//     per-vertex bias measured once at build time: the largest amount by which the true surface
//     rises above the chord between this mesh's own vertices. That makes the sheet a guaranteed
//     upper envelope of the terrain, so it never z-fights, never pokes through, and sits flat on
//     the ground everywhere the ground is smooth. On the dune crests it floats by the height of
//     the crest it is spanning, which from any planner altitude is invisible.
//   * Colour comes from a data texture on the same 64 m lattice, one texel per mesh vertex, so
//     the texture and the mesh are aligned to the texel and a bilinear tap is exact.
//   * The texture is rebuilt in bands across several frames into a back buffer and then cross
//     faded in. Switching views is a dissolve, not a cut, and rebuilding a live view while you
//     watch it never costs a frame.
//   * The sheet is shaded by the terrain normal against the real sun, so a thematic map still
//     reads as this island's landform rather than as a flat sticker, and it still reads at night.
//   * It fades out over ground the camera is standing on, so walking the beach in an info view
//     does not put a coloured ceiling over your head. The far country stays washed.
//
// Every view resolves to published state. Nothing here invents a number, a place or a business.
// Where a field is modelled by this file rather than read from a system, the view says so in its
// own legend, in the `basis` line, in the words the system used.
//
// No Babylon import: the module is safe to load headless, where it registers the view catalogue
// and nothing else.

const B = (typeof window !== 'undefined' && window.BABYLON) || null;

/* ------------------------------------------------------------------ tuning */

const CELL = 64;            // metres: the lattice the wash and its texture share
const SEA_MARGIN = 2500;    // metres of sea kept in the sheet, for the shore, the banks and the bay
const LIFT = 0.35;          // metres above the measured envelope
const WATER_LIFT = 2.2;     // metres above mean sea level for anything under water, clear of the tide
const BAND_ROWS = 72;       // texture rows rebuilt per frame
const FADE_IN = 0.42;       // seconds
const REFRESH_TICKS = 6;    // one sim hour between live rebuilds of the same view

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/* ------------------------------------------------------------------ colour */

function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(c) {
  return '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
/**
 * Sample a list of [stop, '#rrggbb'] at t, linearly.
 *
 * The stops are decoded to numbers once and cached on the array, and the result is written into
 * one reused triple rather than a fresh one. A bake is three hundred thousand cells and the first
 * version allocated an array and parsed six hex strings for every one of them, which is most of
 * what a view cost. Callers consume the result immediately, which is the only rule this breaks.
 */
const _c3 = [0, 0, 0];
function rampAt(stops, t) {
  let dec = stops._dec;
  if (!dec) {
    dec = stops._dec = stops.map((s) => [s[0], rgb(s[1])]);
  }
  const v = clamp(t, 0, 1);
  for (let i = 1; i < dec.length; i++) {
    if (v <= dec[i][0] || i === dec.length - 1) {
      const a = dec[i - 1], b = dec[i];
      const f = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0]);
      const ca = a[1], cb = b[1];
      _c3[0] = ca[0] + (cb[0] - ca[0]) * f;
      _c3[1] = ca[1] + (cb[1] - ca[1]) * f;
      _c3[2] = ca[2] + (cb[2] - ca[2]) * f;
      return _c3;
    }
  }
  const c = dec[0][1];
  _c3[0] = c[0]; _c3[1] = c[1]; _c3[2] = c[2];
  return _c3;
}
function rampSwatches(stops, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(toHex(rampAt(stops, i / (n - 1))));
  return out;
}

// The ramps. Sequential ramps run dark to light so they survive the hillshade; the diverging one
// is used only where a real zero exists, which on this island means shoreline change.
const RAMP_ELEV = [[0, '#0d4f63'], [0.02, '#1d7d8f'], [0.05, '#ecdfc0'], [0.16, '#7fa653'],
  [0.36, '#c6b04c'], [0.58, '#c4763a'], [0.80, '#a44d38'], [1, '#efe0cf']];
const RAMP_HEAT = [[0, '#12212b'], [0.25, '#1c5f6b'], [0.5, '#8fbf5a'], [0.75, '#f0b429'], [1, '#e2725b']];
const RAMP_COOL = [[0, '#0f1c24'], [0.3, '#1c6c78'], [0.62, '#3fb6c4'], [1, '#9ddde8']];
const RAMP_GOOD = [[0, '#e2725b'], [0.35, '#c98a3a'], [0.6, '#c9c05a'], [1, '#8fbf5a']];
const RAMP_DIVERGE = [[0, '#e2725b'], [0.42, '#8a5b4a'], [0.5, '#3a4148'], [0.58, '#3e6e7a'], [1, '#3fb6c4']];
const RAMP_DENSITY = [[0, '#101820'], [0.2, '#2d4a63'], [0.5, '#3fb6c4'], [0.78, '#f0b429'], [1, '#f4d79e']];

// Per-view ramps, hoisted for the same reason: a ramp declared inside a per-cell loop is a new
// array every cell and the decode cache above never gets a chance to work.
const RAMP_SEA = [[0, '#1d6b7a'], [1, '#07202e']];
const RAMP_SWAMP = [[0, '#6b5a34'], [1, '#2f7f8c']];
const RAMP_FIRE = [[0, '#3f5a3a'], [0.4, '#a8a03a'], [0.72, '#e08a2a'], [1, '#e2725b']];
const RAMP_PRESSURE = [[0, '#2b5f5a'], [0.5, '#f0b429'], [1, '#e2725b']];
const RAMP_SEAGRASS = [[0, '#1d4d44'], [0.6, '#3f8f5a'], [1, '#8fbf5a']];
const RAMP_DEPTH = [[0, '#16414f'], [1, '#07202e']];
const RAMP_STRIKE = [[0, '#5b6470'], [0.4, '#f0b429'], [1, '#e2725b']];
const RAMP_AVAIL = [[0, '#e2725b'], [0.35, '#f0b429'], [1, '#8fbf5a']];
const RAMP_LOAD = [[0, '#20303c'], [0.35, '#1c6c78'], [0.7, '#f0b429'], [1, '#f4d79e']];
const RAMP_WASTE = [[0, '#2a2f26'], [0.4, '#7d7f4a'], [0.75, '#c98a3a'], [1, '#e2725b']];
const RAMP_SIGNAL = [[0, '#c0392b'], [0.34, '#e07a2a'], [0.64, '#e8c33a'], [1, '#5fbf62']];
const RAMP_NOISE = [[0, '#16302c'], [0.25, '#2f6b60'], [0.55, '#c9c05a'], [0.8, '#e08a2a'], [1, '#e2725b']];

// Flat colours used inside bake loops.
const C_LAKE = rgb('#2f8fa8');
const C_SPRING = rgb('#8fe0f0');
const C_FLAT = rgb('#5c7f84');
const C_NOSIGNAL = rgb('#e2725b');
const C_ROAD = [rgb('#e2725b'), rgb('#7d8a94'), rgb('#f0b429'), rgb('#c98a3a'), rgb('#b0a58c'), rgb('#8fbf5a'), rgb('#3fb6c4')];
const C_GREY = rgb('#3a4148');
const C_DECLARED = rgb('#ff5a3c');
// What a view says about country it is not about. Dim, cool, and the same everywhere, so the
// subject of a view is always the thing with colour in it.
const MUTE_LAND = [50, 57, 63];
const MUTE_SEA = [14, 30, 41];
const MUTE_LAND_A = 0.5;
const MUTE_SEA_A = 0.3;

/* ------------------------------------------------------------------ the lattice

The one grid every view paints into, and the one mesh that carries it. Built lazily, the first
time an info view is switched on, because a headless determinism run has no use for it. */

function buildLattice(world) {
  const island = world.island;
  if (!island || !island.grid) return null;
  const d = island.domain;
  const nx = Math.floor((d.maxX - d.minX) / CELL) + 1;
  const nz = Math.floor((d.maxZ - d.minZ) / CELL) + 1;
  const n = nx * nz;

  const F = {
    cell: CELL, nx, nz, n, x0: d.minX, z0: d.minZ,
    x1: d.minX + (nx - 1) * CELL, z1: d.minZ + (nz - 1) * CELL,
    seaLevel: island.seaLevel,
    height: new Float32Array(n),
    shore: new Float32Array(n),
    slopeDeg: new Float32Array(n),
    cover: new Uint8Array(n),
    bay: new Uint8Array(n),
    covers: island.grid.covers,
    land: 0,
    cellHa: (CELL * CELL) / 10000,
    xOf: (i) => d.minX + i * CELL,
    zOf: (j) => d.minZ + j * CELL,
    at(x, z) {
      const i = clamp(Math.round((x - d.minX) / CELL), 0, nx - 1);
      const j = clamp(Math.round((z - d.minZ) / CELL), 0, nz - 1);
      return j * nx + i;
    },
    inside(x, z) { return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1; }
  };

  const coverIdx = {};
  for (let i = 0; i < F.covers.length; i++) coverIdx[F.covers[i]] = i;
  F.coverIdx = coverIdx;

  for (let j = 0; j < nz; j++) {
    const z = d.minZ + j * CELL;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = d.minX + i * CELL;
      const h = island.height(x, z);
      F.height[k] = h;
      F.shore[k] = island.shoreDistance(x, z);
      F.slopeDeg[k] = (island.slope(x, z) * 180) / Math.PI;
      F.cover[k] = island.landCoverIndex(x, z);
      F.bay[k] = Math.round(island.bayness(x, z) * 255);
      if (h > island.seaLevel) F.land++;
    }
  }
  F.landHa = F.land * F.cellHa;
  return F;
}

/**
 * How far the true surface rises above the chord between this lattice's own vertices, measured
 * at every node of the island's own 32 m field. Scattered to the four vertices around each
 * sample, so lifting every vertex by its own figure guarantees the sheet clears the ground.
 */
function measureEnvelope(world, F) {
  const island = world.island;
  const g = island.grid;
  const bias = new Float32Array(F.n);
  const inv = 1 / CELL;
  for (let jj = 0; jj < g.nz; jj++) {
    const z = g.z0 + jj * g.cell;
    const fz = clamp((z - F.z0) * inv, 0, F.nz - 1.0001);
    const j = fz | 0, tz = fz - j;
    const row = jj * g.nx;
    for (let ii = 0; ii < g.nx; ii++) {
      const h = g.height[row + ii];
      const x = g.x0 + ii * g.cell;
      const fx = clamp((x - F.x0) * inv, 0, F.nx - 1.0001);
      const i = fx | 0, tx = fx - i;
      const k = j * F.nx + i;
      const a = F.height[k], b = F.height[k + 1], c = F.height[k + F.nx], dd = F.height[k + F.nx + 1];
      const top = a + (b - a) * tx;
      const e = h - (top + (c + (dd - c) * tx - top) * tz);
      if (e <= 0) continue;
      if (e > bias[k]) bias[k] = e;
      if (e > bias[k + 1]) bias[k + 1] = e;
      if (e > bias[k + F.nx]) bias[k + F.nx] = e;
      if (e > bias[k + F.nx + 1]) bias[k + F.nx + 1] = e;
    }
  }
  return bias;
}

/* ------------------------------------------------------------------ painting helpers */

/** Write one texel. Colour components are 0..255, alpha 0..1. */
function put(F, buf, k, c, a) {
  const o = k * 4;
  buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = Math.round(clamp(a, 0, 1) * 255);
}
function clearRow(F, buf, j) {
  buf.fill(0, j * F.nx * 4, (j + 1) * F.nx * 4);
}

/** Add a soft radial weight into a scratch field. Used for anything that is points, not areas. */
function splat(F, acc, x, z, radiusM, weight, stride = 1, channel = 0) {
  if (!(radiusM > 0) || !weight) return;
  const r = Math.ceil(radiusM / CELL);
  const ci = Math.round((x - F.x0) / CELL), cj = Math.round((z - F.z0) / CELL);
  const inv2 = 1 / (radiusM * radiusM);
  for (let j = Math.max(0, cj - r); j <= Math.min(F.nz - 1, cj + r); j++) {
    const dz = (F.z0 + j * CELL) - z;
    for (let i = Math.max(0, ci - r); i <= Math.min(F.nx - 1, ci + r); i++) {
      const dx = (F.x0 + i * CELL) - x;
      const d2 = (dx * dx + dz * dz) * inv2;
      if (d2 > 1) continue;
      const f = (1 - d2) * (1 - d2);
      acc[(j * F.nx + i) * stride + channel] += weight * f;
    }
  }
}

/** Even-odd scanline fill of a projected polygon into a scratch field. */
function fillPoly(F, acc, poly, value, stride = 1, channel = 0) {
  const m = poly.length;
  if (m < 3) return;
  let z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  const j0 = Math.max(0, Math.floor((z0 - F.z0) / CELL));
  const j1 = Math.min(F.nz - 1, Math.ceil((z1 - F.z0) / CELL));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zw = F.z0 + j * CELL;
    xs.length = 0;
    for (let i = 0, k = m - 1; i < m; k = i++) {
      const zi = poly[i][1], zk = poly[k][1];
      if ((zi > zw) !== (zk > zw)) xs.push(poly[i][0] + ((zw - zi) / (zk - zi)) * (poly[k][0] - poly[i][0]));
    }
    xs.sort((a, b) => a - b);
    const base = j * F.nx;
    for (let s = 0; s + 1 < xs.length; s += 2) {
      let a = Math.ceil((xs[s] - F.x0) / CELL), b = Math.floor((xs[s + 1] - F.x0) / CELL);
      if (b < 0 || a >= F.nx) continue;
      if (a < 0) a = 0;
      if (b > F.nx - 1) b = F.nx - 1;
      for (let i = a; i <= b; i++) acc[(base + i) * stride + channel] = value;
    }
  }
}

/** Stamp a corridor of a given half width along a polyline. */
function strokeLine(F, acc, pts, halfM, value, stride = 1, channel = 0, mode = 'max') {
  const r = Math.ceil(halfM / CELL) + 1;
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.6)));
    for (let t = 0; t <= steps; t++) {
      const f = t / steps;
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const ci = Math.round((x - F.x0) / CELL), cj = Math.round((z - F.z0) / CELL);
      for (let j = Math.max(0, cj - r); j <= Math.min(F.nz - 1, cj + r); j++) {
        const dz = (F.z0 + j * CELL) - z;
        for (let i = Math.max(0, ci - r); i <= Math.min(F.nx - 1, ci + r); i++) {
          const dx = (F.x0 + i * CELL) - x;
          const d2 = dx * dx + dz * dz;
          if (d2 > halfM * halfM) continue;
          const d = Math.sqrt(d2);
          const w = value * (1 - smoothstep(halfM * 0.45, halfM, d));
          const kk = (j * F.nx + i) * stride + channel;
          if (mode === 'add') acc[kk] += w;
          else if (w > acc[kk]) acc[kk] = w;
        }
      }
    }
  }
}

/** Projected polylines for one road record, in local metres. */
export function roadLines(world) {
  const cache = world._ivRoads;
  if (cache) return cache;
  const island = world.island;
  const roads = (world.data && world.data.geography && world.data.geography.roads) || [];
  const out = roads.map((r) => ({
    id: r.id, name: r.name, type: r.type,
    pts: (r.coordinates || []).map((c) => { const p = island.project(c[0], c[1]); return [p.x, p.z]; })
  })).filter((r) => r.pts.length > 1);
  world._ivRoads = out;
  return out;
}

/** Every place in data/places.json, projected, by id. */
export function placeMap(world) {
  if (world._ivPlaces) return world._ivPlaces;
  const island = world.island;
  const m = new Map();
  for (const p of (world.data && world.data.places && world.data.places.places) || []) {
    if (!Number.isFinite(p.lon)) continue;
    const xz = island.project(p.lon, p.lat);
    m.set(p.id, { id: p.id, name: p.name, type: p.type, x: xz.x, z: xz.z });
  }
  world._ivPlaces = m;
  return m;
}

/** A point for a named thing, whether it is in the places pack or only in the business pack. */
export function siteOf(world, id) {
  const p = placeMap(world).get(id);
  if (p) return p;
  const R = world.residents;
  const b = R && R.businesses && R.businesses.get(id);
  return b ? { id, name: b.label, x: b.x, z: b.z } : null;
}

export function terminals(world) {
  if (world._ivTerminals) return world._ivTerminals;
  const island = world.island;
  const out = [];
  for (const t of (world.data && world.data.transport && world.data.transport.terminals) || []) {
    if (!Number.isFinite(t.lon)) continue;
    const xz = island.project(t.lon, t.lat);
    out.push({ id: t.id, name: t.name, x: xz.x, z: xz.z });
  }
  world._ivTerminals = out;
  return out;
}

const fmt = {
  n(v, d = 0) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '?';
    return v.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  pct(v, d = 0) { return Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '?'; },
  money(v) { return Number.isFinite(v) ? 'A$' + Math.round(v).toLocaleString('en-AU') : 'A$?'; },
  m(v, d = 0) { return Number.isFinite(v) ? `${v.toFixed(d)} m` : '?'; },
  km(v, d = 1) { return Number.isFinite(v) ? `${v.toFixed(d)} km` : '?'; }
};

/* ------------------------------------------------------------------ the views

Each view is:
  id, group, label, short   what it is called
  key                       one letter, live while the switcher is open
  needs                     published state it cannot run without
  explain                   one sentence: what it shows and why it matters on this island
  basis                     where the field comes from, in the words of the system that owns it
  begin(w, F)               optional heavy preparation, returns a scratch object
  row(w, F, st, j)          paint one texture row
  legend(w)                 swatches, units, headline numbers
  markers(w)                up to a few dozen world-anchored labels
*/

// Info view colours, not terrain colours. These have to be told apart at a glance from eight
// kilometres up, so they are further apart in hue than the real thing is.
const COVER_LOOK = {
  water: ['#14415c', 'Subtidal seabed'],
  beach: ['#f7e7bc', 'Beach and wet sand'],
  foredune: ['#e6bf62', 'Foredune'],
  heath: ['#aec95c', 'Wallum heath'],
  forest: ['#2f8340', 'Eucalypt forest'],
  swamp: ['#8a6630', 'Wallum swamp'],
  lake: ['#34bcd6', 'Lake'],
  rock: ['#b6a08a', 'Rock'],
  saltmarsh: ['#d2cc6a', 'Saltmarsh'],
  mangrove: ['#1c6f57', 'Mangrove'],
  cleared: ['#d6c286', 'Cleared'],
  urban: ['#e8613e', 'Built up'],
  rehab: ['#6ecb95', 'Mine path rehabilitation']
};

export function buildViews(world) {
  const island = world.island;
  const V = [];

  /* ============================================================ LAND ============ */

  V.push({
    id: 'landcover', group: 'land', label: 'Land cover', short: 'Cover', key: 'C',
    explain: 'Minjerribah is sand nearly all the way down: the only rock is the headland at Point Lookout, '
      + 'and everything else you can see is dune, heath, forest or swamp built out of quartz.',
    find: 'sand dune beach heath forest swamp mangrove rock cover habitat ground',
    basis: 'the island heightfield, baked from data/geography.json coastline, elevation and water bodies',
    begin(w, F) {
      const cols = {};
      for (const [id, look] of Object.entries(COVER_LOOK)) cols[F.coverIdx[id]] = rgb(look[0]);
      const areas = new Array(F.covers.length).fill(0);
      for (let k = 0; k < F.n; k++) if (F.height[k] > F.seaLevel) areas[F.cover[k]] += F.cellHa;
      return { cols, areas };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const c = st.cols[F.cover[k]] || MUTE_LAND;
        // A hairline where the class changes, so 13 classes read as a map and not as a smear.
        const edge = (i > 0 && F.cover[k - 1] !== F.cover[k]) || (j > 0 && F.cover[k - F.nx] !== F.cover[k]);
        put(F, buf, k, edge ? [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55] : c,
          F.height[k] > F.seaLevel ? 0.94 : 0.62);
      }
    },
    legend(w, F) {
      const st = this._st;
      const items = [];
      for (const [id, look] of Object.entries(COVER_LOOK)) {
        const ha = st ? st.areas[F.coverIdx[id]] : 0;
        if (id === 'water') continue;
        items.push({ colour: look[0], label: look[1], value: ha > 0.5 ? fmt.n(ha) + ' ha' : '' });
      }
      const isl = w.read('island') || {};
      return {
        kind: 'classes', unit: 'hectares above mean sea level', items,
        stats: [
          { k: 'Land', v: fmt.n(isl.landAreaKm2 || 0, 0) + ' km2' },
          { k: 'High point', v: fmt.m(isl.maxElevationM || 0, 0) },
          { k: 'North to south', v: fmt.km((isl.extentKm && isl.extentKm.northSouth) || 0) }
        ]
      };
    },
    markers(w) {
      const p = placeMap(w);
      const out = [];
      for (const id of ['point-lookout', 'dunwich', 'amity-point']) {
        const q = p.get(id);
        if (q) out.push({ x: q.x, z: q.z, label: q.name, tone: 'sand', rank: 3 });
      }
      return out;
    }
  });

  V.push({
    id: 'elevation', group: 'land', label: 'Elevation and contours', short: 'Elevation', key: 'E',
    explain: 'A mountain range made of wind-blown sand: the interior ridges run past 200 m, and Blue Lake '
      + '(Kaboora) and Brown Lake (Bummiera) are lakes sitting on top of it.',
    find: 'height contour topography hill peak mountain metres relief altitude',
    basis: 'the island heightfield. Heights are metres above mean sea level',
    begin(w, F) {
      // Hypsometric bands rather than contour lines. A 64 m lattice on a dune field that climbs
      // thirteen degrees moves ten or fifteen metres between one cell and the next, so a one metre
      // wide contour line falls between the samples and never draws. Stepping the colour every
      // twenty metres and darkening the step edge puts a readable line on the same information.
      const STEP = 20;
      const band = new Uint8Array(F.n);
      for (let k = 0; k < F.n; k++) {
        const e = F.height[k] - F.seaLevel;
        band[k] = e <= 0 ? 0 : Math.min(255, 1 + Math.floor(e / STEP));
      }
      return { max: Math.max(60, (w.read('island') || {}).maxElevationM || 233), band, STEP };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const e = F.height[k] - F.seaLevel;
        if (e <= 0) {
          put(F, buf, k, rampAt(RAMP_SEA, clamp(-e / 40, 0, 1)), 0.58);
          continue;
        }
        const mid = (st.band[k] - 0.5) * st.STEP;      // the middle of this twenty metre band
        const c = rampAt(RAMP_ELEV, 0.06 + 0.94 * clamp(mid / st.max, 0, 1));
        const edge = (i > 0 && st.band[k - 1] !== st.band[k])
          || (j > 0 && st.band[k - F.nx] !== st.band[k]);
        // Every hundred metres gets a heavier line, the way an index contour does.
        const heavy = edge && st.band[k] % 5 === 1;
        const dim = edge ? (heavy ? 0.45 : 0.74) : 1;
        put(F, buf, k, [c[0] * dim, c[1] * dim, c[2] * dim], 0.93);
      }
    },
    legend(w) {
      const isl = w.read('island') || {};
      const max = Math.max(60, isl.maxElevationM || 233);
      const items = rampSwatches(RAMP_ELEV, 6).map((colour, i) => ({
        colour, label: `${Math.round((i / 5) * max)} m`
      }));
      return {
        kind: 'ramp', unit: 'metres above mean sea level, banded every 20 m', items,
        stats: [
          { k: 'High point', v: fmt.m(isl.maxElevationM || 0, 0) },
          { k: 'Mount Hardgrave', v: '228 m, gazetted' },
          { k: 'Blue Lake surface', v: '72 m' }
        ]
      };
    },
    markers(w) {
      const out = [];
      for (const p of (w.island.peaks || [])) {
        out.push({ x: p.x, z: p.z, label: p.name, value: `${Math.round(p.elevationM)} m`, tone: 'sand', rank: 2 });
      }
      for (const l of (w.island.lakes || [])) {
        if (l.surfaceM == null) continue;
        out.push({ x: l.x, z: l.z, label: l.name, value: `${Math.round(l.surfaceM - island.seaLevel)} m`, tone: 'sea', rank: 3 });
      }
      return out;
    }
  });

  V.push({
    id: 'slope', group: 'land', label: 'Slope', short: 'Slope', key: 'S',
    explain: 'Dry sand will not stand much past its angle of repose, so the steep faces on this island '
      + 'are the ones that are still moving: blowout walls, the dune fronts, and the cut at Amity Point.',
    find: 'steep gradient angle repose blowout cliff',
    basis: 'the gradient of the island heightfield, sampled at 32 m',
    begin(w, F) {
      let sum = 0, count = 0, steep = 0;
      for (let k = 0; k < F.n; k++) {
        if (F.height[k] <= F.seaLevel) continue;
        sum += F.slopeDeg[k]; count++;
        if (F.slopeDeg[k] > 20) steep++;
      }
      return { mean: count ? sum / count : 0, steepShare: count ? steep / count : 0 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] <= F.seaLevel) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        const s = F.slopeDeg[k];
        put(F, buf, k, rampAt(RAMP_HEAT, clamp(s / 34, 0, 1)), 0.84);
      }
    },
    legend(w, F) {
      const st = this._st || { mean: 0, steepShare: 0 };
      return {
        kind: 'ramp', unit: 'degrees',
        items: [0, 8.5, 17, 25.5, 34].map((d, i) => ({ colour: rampSwatches(RAMP_HEAT, 5)[i], label: `${d.toFixed(0)}°` })),
        stats: [
          { k: 'Mean land slope', v: `${st.mean.toFixed(1)}°` },
          { k: 'Steeper than 20°', v: fmt.pct(st.steepShare, 1) },
          { k: 'Dry sand stands to', v: 'about 33°' }
        ]
      };
    },
    markers() { return []; }
  });

  V.push({
    id: 'tenure', group: 'land', label: 'Land tenure', short: 'Tenure', key: 'T',
    explain: 'More than half the island is Naree Budjong Djara National Park, jointly managed with the '
      + 'Quandamooka People, and the old mine paths beside it are being rehabilitated after mining ended by law.',
    find: 'national park conservation qyac mining rehabilitation freehold ownership boundary naree budjong djara',
    basis: 'data/geography.json protected_areas and rehabilitation_areas, and the island cover bake for the townships',
    begin(w, F) {
      const cls = new Uint8Array(F.n);       // 0 none 1 NP 2 CP 3 rehab 4 township 5 beach and foreshore
      const parks = (w.data.geography && w.data.geography.protected_areas) || [];
      const proj = (ring) => ring.map((c) => { const p = island.project(c[0], c[1]); return [p.x, p.z]; });
      let npHa = 0, cpHa = 0;
      for (const p of parks) {
        const val = p.type === 'national_park' ? 1 : 2;
        const parts = p.geometry === 'multipolygon' ? p.coordinates : [p.coordinates];
        for (const part of parts) {
          if (!Array.isArray(part) || part.length < 3 || !Array.isArray(part[0])) continue;
          fillPoly(F, cls, proj(part), val);
        }
      }
      for (const r of (w.data.geography && w.data.geography.rehabilitation_areas) || []) {
        if (!Array.isArray(r.coordinates) || !Array.isArray(r.coordinates[0])) continue;
        fillPoly(F, cls, proj(r.coordinates), 3);
      }
      const urban = F.coverIdx.urban, cleared = F.coverIdx.cleared, beach = F.coverIdx.beach, fd = F.coverIdx.foredune;
      let townHa = 0, rehabHa = 0, otherHa = 0;
      for (let k = 0; k < F.n; k++) {
        if (F.height[k] <= F.seaLevel) { cls[k] = 0; continue; }
        if (F.cover[k] === urban || F.cover[k] === cleared) cls[k] = 4;
        else if (!cls[k] && (F.cover[k] === beach || F.cover[k] === fd)) cls[k] = 5;
        if (cls[k] === 1) npHa += F.cellHa;
        else if (cls[k] === 2) cpHa += F.cellHa;
        else if (cls[k] === 3) rehabHa += F.cellHa;
        else if (cls[k] === 4) townHa += F.cellHa;
        else if (cls[k] === 0) otherHa += F.cellHa;
      }
      return {
        cls, npHa, cpHa, rehabHa, townHa, otherHa,
        cols: [rgb('#3a4148'), rgb('#2f6b45'), rgb('#4f8f6a'), rgb('#b08a3a'), rgb('#b0553f'), rgb('#d8c9a4')]
      };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] <= F.seaLevel) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        const c = st.cols[st.cls[k]];
        const edge = (i > 0 && st.cls[k - 1] !== st.cls[k]) || (j > 0 && st.cls[k - F.nx] !== st.cls[k]);
        put(F, buf, k, edge ? [c[0] * 1.45 + 30, c[1] * 1.45 + 30, c[2] * 1.45 + 30] : c, st.cls[k] ? 0.84 : 0.5);
      }
    },
    legend(w) {
      const st = this._st || {};
      const parks = (w.data.geography && w.data.geography.protected_areas) || [];
      const np = parks.find((p) => p.type === 'national_park');
      return {
        kind: 'classes', unit: 'hectares, measured off this twin\'s own 64 m lattice',
        items: [
          { colour: '#2f6b45', label: 'National park', value: fmt.n(st.npHa || 0) + ' ha' },
          { colour: '#4f8f6a', label: 'Conservation park', value: fmt.n(st.cpHa || 0) + ' ha' },
          { colour: '#b08a3a', label: 'Mine path rehabilitation', value: fmt.n(st.rehabHa || 0) + ' ha' },
          { colour: '#b0553f', label: 'Township and cleared', value: fmt.n(st.townHa || 0) + ' ha' },
          { colour: '#d8c9a4', label: 'Beach and foredune', value: '' },
          { colour: '#3a4148', label: 'Everything else', value: fmt.n(st.otherHa || 0) + ' ha' }
        ],
        stats: [
          { k: np ? np.name : 'National park', v: np ? fmt.n(np.area_ha) + ' ha declared' : '' },
          { k: 'Mining', v: 'ended by law, operations ceased 2019' },
          { k: 'Boundary confidence', v: np ? np.confidence : 'medium' }
        ],
        note: 'The mapped boundaries come from OpenStreetMap under ODbL and the declared area from the '
          + 'park listing. The pack says both may be out of date, so the measured and declared figures differ.'
      };
    },
    markers(w) {
      const out = [];
      const p = placeMap(w);
      const np = p.get('naree-budjong-djara-national-park');
      if (np) out.push({ x: np.x, z: np.z, label: np.name, tone: 'leaf', rank: 1 });
      return out;
    }
  });

  V.push({
    id: 'vegetation', group: 'land', label: 'Vegetation communities', short: 'Vegetation', key: 'V',
    needs: 'vegetation',
    explain: 'Ten communities, and which one you are standing in decides almost everything else: what burns, '
      + 'what a koala can eat, where a glossy black cockatoo can feed and which weeds get in.',
    find: 'plants bush wallum banksia eucalypt community weed cockatoo condition',
    basis: 'the vegetation system\'s own land cover mapping, with each community\'s published area and condition',
    begin(w, F) {
      const veg = w.read('vegetation');
      const byId = new Map((veg && veg.communities || []).map((c) => [c.id, c]));
      // The same rule the vegetation system uses, over the same cover bake, so the two agree.
      const myora = island.project(153.4166, -27.4777);
      const cls = new Uint8Array(F.n);
      const order = ['wallum', 'forest', 'swamp', 'acid-wetland', 'foredune', 'littoral', 'rehab', 'headland', 'mangrove', 'township'];
      const idx = {}; order.forEach((id, i) => { idx[id] = i + 1; });
      const MAP = {
        heath: 'wallum', forest: 'forest', swamp: 'swamp', foredune: 'foredune', rehab: 'rehab',
        rock: 'headland', mangrove: 'mangrove', saltmarsh: 'mangrove', cleared: 'township', urban: 'township'
      };
      for (let k = 0; k < F.n; k++) {
        if (F.height[k] <= F.seaLevel) continue;
        let cid = MAP[F.covers[F.cover[k]]];
        if (!cid) continue;
        const x = F.x0 + (k % F.nx) * CELL, z = F.z0 + Math.floor(k / F.nx) * CELL;
        if ((cid === 'wallum' || cid === 'forest') && Math.hypot(x - myora.x, z - myora.z) < 750) cid = 'littoral';
        if (cid === 'wallum' && F.height[k] < F.seaLevel + 26 && F.slopeDeg[k] < 3.0 && F.shore[k] > 700) cid = 'acid-wetland';
        cls[k] = idx[cid] || 0;
      }
      const cols = [rgb('#2a3138'), rgb('#8a9a4e'), rgb('#2f5a2a'), rgb('#5b5330'), rgb('#6d7f7a'),
        rgb('#d9c58c'), rgb('#1f6b4a'), rgb('#9d8f4a'), rgb('#8a7f74'), rgb('#2f5140'), rgb('#a8583f')];
      return { cls, cols, order, byId };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (!st.cls[k]) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        const c = st.cols[st.cls[k]];
        const com = st.byId.get(st.order[st.cls[k] - 1]);
        const cond = com ? clamp(com.condition, 0, 1) : 0.8;
        // Condition is carried as brightness, so a community in poor shape reads as worn out.
        const g = 0.52 + 0.62 * cond;
        const edge = (i > 0 && st.cls[k - 1] !== st.cls[k]) || (j > 0 && st.cls[k - F.nx] !== st.cls[k]);
        put(F, buf, k, edge ? [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5] : [c[0] * g, c[1] * g, c[2] * g], 0.86);
      }
    },
    legend(w) {
      const st = this._st;
      const veg = w.read('vegetation') || {};
      const items = [];
      if (st) {
        st.order.forEach((id, i) => {
          const c = st.byId.get(id);
          if (!c) return;
          items.push({ colour: toHex(st.cols[i + 1]), label: c.label, value: `${fmt.n(c.areaHa)} ha · ${fmt.pct(c.condition)}` });
        });
      }
      return {
        kind: 'classes', unit: 'area and condition, published by the vegetation system', items,
        stats: [
          { k: 'Vegetated', v: fmt.n(veg.vegetatedHa || 0) + ' ha' },
          { k: 'Bushland', v: fmt.n(veg.bushlandHa || 0) + ' ha' },
          { k: 'Weed load', v: fmt.pct(veg.weedLoad || 0, 1) }
        ],
        note: 'Brightness is condition. The community map is built from the island cover bake by the same '
          + 'rule the vegetation system uses, so the picture and the numbers are the same island.'
      };
    },
    markers(w) {
      const veg = w.read('vegetation');
      if (!veg) return [];
      const out = [];
      const p = placeMap(w);
      const myora = p.get('myora-springs');
      if (myora) out.push({ x: myora.x, z: myora.z, label: 'Littoral rainforest', value: 'the island\'s largest patch', tone: 'leaf', rank: 2 });
      for (const wd of (veg.weedFront || []).slice(0, 3)) {
        // Weeds get in at the township edge, which is where the pack says they arrive.
        const t = p.get('point-lookout');
        if (t) out.push({ x: t.x, z: t.z, label: wd.name, value: fmt.pct(wd.load), tone: 'coral', rank: 4 });
        break;
      }
      return out;
    }
  });

  V.push({
    id: 'fire', group: 'land', label: 'Fire: what carries it', short: 'Fire', key: 'F',
    needs: 'vegetation',
    explain: 'Seventy per cent of this island\'s bushland burnt in one run of fire from a lightning strike in '
      + 'December 2013, and the wallum it grew back as is built to burn again every 7 to 15 years.',
    find: 'burn bushfire fuel hazard smoke curing lightning burning ignition',
    basis: 'the vegetation system\'s fuel and burn programme, and today\'s fire danger from the weather system',
    begin(w, F) {
      const veg = w.read('vegetation') || {};
      const MAP = { heath: 3, forest: 4, swamp: 2, foredune: 0, rehab: 3, rock: 1, mangrove: 0, saltmarsh: 1, cleared: 1, urban: 0 };
      const carries = new Uint8Array(F.n);
      // Distance to the nearest built-up cell, so the interface where a fire meets a house reads.
      const town = new Float32Array(F.n).fill(1e9);
      const seeds = [];
      for (let k = 0; k < F.n; k++) {
        if (F.height[k] <= F.seaLevel) continue;
        const cov = F.covers[F.cover[k]];
        carries[k] = MAP[cov] === undefined ? 1 : MAP[cov];
        if (cov === 'urban' || cov === 'cleared') seeds.push(k);
      }
      const r = Math.ceil(360 / CELL);
      for (const s of seeds) {
        const si = s % F.nx, sj = Math.floor(s / F.nx);
        for (let j = Math.max(0, sj - r); j <= Math.min(F.nz - 1, sj + r); j++) {
          for (let i = Math.max(0, si - r); i <= Math.min(F.nx - 1, si + r); i++) {
            const d = Math.hypot(i - si, j - sj) * CELL;
            const kk = j * F.nx + i;
            if (d < town[kk]) town[kk] = d;
          }
        }
      }
      return { carries, town, curing: clamp(veg.curing || 0, 0, 1) };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] <= F.seaLevel) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        const lvl = st.carries[k];
        if (!lvl) { put(F, buf, k, MUTE_LAND, MUTE_LAND_A); continue; }
        // The colour is how hard this country carries fire; the cure dial pushes the whole map
        // toward the hot end, so a dry spring is something you watch happen.
        const t = clamp((lvl - 1) / 3 * (0.45 + 0.55 * st.curing), 0, 1);
        const c = rampAt(RAMP_FIRE, t);
        const meet = st.town[k] < 300 ? 0.35 : 0;   // where the bush and the houses touch
        put(F, buf, k, [lerp(c[0], 250, meet), lerp(c[1], 240, meet), lerp(c[2], 220, meet)], 0.85);
      }
    },
    legend(w) {
      const veg = w.read('vegetation') || {};
      const wx = w.read('weather') || {};
      const bp = veg.burnProgramme || {};
      const band = bp.wallumTargetIntervalY || [7, 15];
      return {
        kind: 'classes', unit: 'how readily this country carries fire',
        items: [
          { colour: '#3a4148', label: 'Does not carry fire', value: 'mangrove, beach, rock' },
          { colour: '#3f5a3a', label: 'Rarely', value: 'saltmarsh, cleared ground' },
          { colour: '#a8a03a', label: 'On peat', value: 'Eighteen Mile Swamp' },
          { colour: '#e08a2a', label: 'Fire dependent', value: `wallum, ${band[0]} to ${band[1]} years` },
          { colour: '#e2725b', label: 'Heaviest fuel', value: 'high dune eucalypt forest' },
          { colour: '#fbf0dc', label: 'House and bush meet', value: 'within 300 m of a township' }
        ],
        stats: [
          { k: 'Fuel load', v: `${(veg.fuelMeanTHa || 0).toFixed(1)} t/ha` },
          { k: 'Cured', v: fmt.pct(veg.curing || 0) },
          { k: 'Since last fire', v: `${(veg.meanTimeSinceFireY || 0).toFixed(1)} years` },
          { k: 'Burn rotation', v: `${(bp.rotationYears || 0).toFixed(1)} years` },
          { k: 'Fire danger today', v: wx.fireDangerLabel || 'unknown' },
          { k: 'Unburnt refuge', v: fmt.pct(veg.unburntRefugeShare || 0) }
        ],
        note: bp.verdict || ''
      };
    },
    markers(w) {
      const p = placeMap(w);
      const out = [];
      const veg = w.read('vegetation') || {};
      for (const id of ['point-lookout', 'dunwich', 'amity-point']) {
        const q = p.get(id);
        if (q) out.push({ x: q.x, z: q.z, label: q.name, value: `${(veg.fuelNearTownshipTHa || 0).toFixed(1)} t/ha nearby`, tone: 'sun', rank: 3 });
      }
      return out;
    }
  });

  /* ==================================================== COAST AND WATER ============ */

  V.push({
    id: 'dunes', group: 'water', label: 'Dune erosion and accretion', short: 'Dunes', key: 'D',
    needs: 'dunes',
    explain: 'Nineteen beach reaches, each with its own sand budget: the ocean side is holding, and the '
      + 'bay side at Amity Point is a declared erosion-prone area with a channel moving toward the houses.',
    find: 'erosion accretion sand beach amity shoreline coastal seawall nourishment retreat',
    basis: 'the dunes system: 19 reaches placed from data/places.json and the heightfield',
    begin(w, F) {
      const d = w.read('dunes');
      const reaches = (d && d.reaches) || [];
      const val = new Float32Array(F.n).fill(-1);
      const declared = new Uint8Array(F.n);
      // A band along the coast, every cell taken by its nearest reach. The reaches are the units
      // the dunes system actually models in, so the map is drawn in the same units rather than
      // interpolated into a smooth field the simulation does not have.
      for (let k = 0; k < F.n; k++) {
        const s = F.shore[k];
        if (s > 620 || s < -420) continue;
        const x = F.x0 + (k % F.nx) * CELL, z = F.z0 + Math.floor(k / F.nx) * CELL;
        let best = null, bd = Infinity;
        for (const r of reaches) {
          const dist = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z);
          if (dist < bd) { bd = dist; best = r; }
        }
        if (!best) continue;
        // Stretched over the range condition actually moves in, or nineteen reaches between
        // 0.74 and 0.94 come out as one colour and the map says nothing.
        val[k] = clamp((best.condition - 0.6) / 0.4, 0, 1);
        if (best.amityReach) declared[k] = 1;
      }
      return { val, declared, reaches };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (st.val[k] < 0) {
          put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A);
          continue;
        }
        // Hatched where the coast is a declared erosion-prone area. That is a legal designation,
        // not a measurement, so it is drawn as hatching over the measurement rather than mixed
        // into it.
        if (st.declared[k] && ((i + j) % 3 === 0)) { put(F, buf, k, C_DECLARED, 0.95); continue; }
        put(F, buf, k, rampAt(RAMP_GOOD, st.val[k]), 0.92);
      }
    },
    legend(w) {
      const d = w.read('dunes') || {};
      const a = d.amity || {};
      return {
        kind: 'ramp', unit: 'dune condition, stretched over 0.6 to 1.0',
        items: rampSwatches(RAMP_GOOD, 5).map((colour, i) => ({ colour, label: ['Failing', 'Poor', 'Fair', 'Good', 'Intact'][i] })),
        extra: [{ colour: '#ff5a3c', label: 'Declared erosion-prone area', value: 'hatched' }],
        stats: [
          { k: 'Island condition', v: fmt.pct(d.islandCondition || 0) },
          { k: 'Ocean side', v: fmt.pct(d.oceanCondition || 0) },
          { k: 'Bay side', v: fmt.pct(d.bayCondition || 0) },
          { k: 'Sand budget', v: `${fmt.n(d.sandBudgetM3PerM)} m3 per metre` },
          { k: 'Amity risk', v: fmt.pct(a.riskIndex || 0) },
          { k: 'Channel offshore', v: fmt.m(a.channelDistanceM, 0) }
        ],
        note: a.status || ''
      };
    },
    markers(w) {
      const d = w.read('dunes');
      if (!d) return [];
      const out = [];
      const worst = (d.reaches || []).slice().sort((p, q) => p.condition - q.condition);
      for (const r of worst.slice(0, 10)) {
        out.push({
          x: r.x, z: r.z, label: r.label,
          value: `${fmt.pct(r.condition)}${r.shorelineM ? `, ${r.shorelineM > 0 ? '+' : ''}${r.shorelineM.toFixed(1)} m` : ''}`,
          tone: r.condition < 0.72 ? 'coral' : r.condition < 0.85 ? 'sun' : 'leaf',
          rank: r.amityReach ? 1 : 2
        });
      }
      return out;
    }
  });

  V.push({
    id: 'groundwater', group: 'water', label: 'Groundwater and the lakes', short: 'Water table', key: 'G',
    needs: 'lakes',
    explain: 'The lakes are not fed by rivers: Blue Lake (Kaboora) is a window straight into the freshwater '
      + 'sitting inside the sand, and Eighteen Mile Swamp is the first thing to shrink when that water drops.',
    find: 'water table aquifer lens bore lake blue brown swamp spring rain drought recharge',
    basis: 'the lakes system: the water table index, the published lake levels and the wet share of the swamp',
    begin(w, F) {
      const lk = w.read('lakes') || {};
      const mark = new Uint8Array(F.n);      // 1 lake 2 swamp 3 acid wetland 4 spring
      if (island.waterPolys && island.waterPolys.swamp) fillPoly(F, mark, island.waterPolys.swamp, 2);
      for (const l of (island.lakes || [])) if (l.poly) fillPoly(F, mark, l.poly, 1);
      for (const s of (lk.springs || [])) mark[F.at(s.x, s.z)] = 4;
      return { mark, table: clamp(lk.waterTableIndex || 0.5, 0, 1), wet: clamp((lk.swamp && lk.swamp.wetShareOfArea) || 0, 0, 1) };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] <= F.seaLevel) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        const m = st.mark[k];
        if (m === 1) { put(F, buf, k, C_LAKE, 0.95); continue; }
        if (m === 2) {
          const c = rampAt(RAMP_SWAMP, st.wet);
          put(F, buf, k, c, 0.9); continue;
        }
        if (m === 4) { put(F, buf, k, C_SPRING, 0.95); continue; }
        // Everything else: how much fresh water is stacked under this point. The lens floats on
        // salt water, so it is deepest under the high dunes and thinnest at the shore.
        const head = clamp((F.height[k] - F.seaLevel) / 120, 0, 1);
        const near = smoothstep(0, 900, F.shore[k]);
        put(F, buf, k, rampAt(RAMP_COOL, 0.05 + 0.9 * head * near * (0.55 + 0.45 * st.table)), 0.72);
      }
    },
    legend(w) {
      const lk = w.read('lakes') || {};
      const wt = w.read('water') || {};
      const items = rampSwatches(RAMP_COOL, 5).map((colour, i) => ({ colour, label: ['Thin', '', 'Moderate', '', 'Deep'][i] }));
      items.push({ colour: '#2f8fa8', label: 'Lake', value: `${(lk.bodies || []).length} mapped` });
      items.push({ colour: '#2f7f8c', label: 'Eighteen Mile Swamp', value: fmt.pct(lk.swamp ? lk.swamp.wetShareOfArea : 0) + ' wet' });
      return {
        kind: 'ramp', unit: 'freshwater stacked beneath you, from the height of the land above the sea',
        items,
        stats: [
          { k: 'Water table', v: fmt.pct(lk.waterTableIndex || 0) },
          { k: 'Store', v: `${fmt.n(lk.storageGl)} GL` },
          { k: 'Recharge', v: `${fmt.n(lk.rechargeMlDay, 1)} ML/day` },
          { k: 'Taken out', v: `${fmt.n(lk.extractionMlDay, 1)} ML/day` },
          { k: 'Aquifer stress', v: fmt.pct(lk.aquiferStress || 0, 1) },
          { k: 'Rain, last year', v: `${fmt.n(lk.rainMm365)} mm` }
        ],
        note: (wt.take && wt.take.sentence) || ''
      };
    },
    markers(w) {
      const lk = w.read('lakes');
      if (!lk) return [];
      const out = [];
      for (const b of (lk.bodies || [])) {
        const geo = (island.lakes || []).find((l) => l.id === b.id);
        if (!geo) continue;
        out.push({
          x: geo.x, z: geo.z, label: b.name,
          value: b.surfaceM != null ? `${b.typeLabel}, ${Math.round(b.surfaceM - island.seaLevel)} m` : b.typeLabel,
          tone: 'sea', rank: 1
        });
      }
      for (const s of (lk.springs || [])) {
        out.push({ x: s.x, z: s.z, label: s.name, value: `${s.flowMlDay.toFixed(2)} ML/day`, tone: 'sea', rank: 2 });
      }
      return out;
    }
  });

  /* ============================================================ LIFE ============ */

  V.push({
    id: 'koala', group: 'life', label: 'Koala country and road strikes', short: 'Koalas', key: 'K',
    needs: 'koala',
    explain: 'The island koalas are endangered and disease is already through a third of them, so where they '
      + 'cross a road at night is not a detail: vehicle strike is the biggest recorded killer here.',
    find: 'wildlife animal chlamydia disease roadkill strike blackspot dog tree',
    basis: 'the koala system: every animal\'s live position, plus the recorded strike history by road',
    begin(w, F) {
      const acc = new Float32Array(F.n);
      const positions = w.store.all('position');
      const koalas = w.store.all('koala');
      let n = 0;
      for (const [id, pos] of positions) {
        if (!koalas.has(id)) continue;
        splat(F, acc, pos.x, pos.z, 900, 1);
        n++;
      }
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];

      // The roads a koala has to cross, laid over the density, so a hotspot sits on the tarmac and
      // not in the bush beside it. Recorded strikes widen and redden the corridor.
      const road = new Float32Array(F.n);
      const ko = w.read('koala') || {};
      const spots = new Map((ko.blackspots || []).map((s) => [String(s.road).split(' (')[0], s.strikes]));
      let worst = 1;
      for (const v of spots.values()) if (v > worst) worst = v;
      for (const r of roadLines(w)) {
        if (r.type !== 'sealed_road' && r.type !== 'street' && r.type !== 'unsealed_road') continue;
        const hit = spots.get(String(r.name).split(' (')[0]) || 0;
        strokeLine(F, road, r.pts, 90 + 60 * (hit / worst), 0.3 + 0.7 * (hit / worst));
      }
      return { acc, max: max || 1, n, road };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] <= F.seaLevel) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        const rd = st.road[k];
        if (rd > 0.05) {
          put(F, buf, k, rampAt(RAMP_STRIKE, clamp((rd - 0.3) / 0.7, 0, 1)), 0.92);
          continue;
        }
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t < 0.02) { put(F, buf, k, MUTE_LAND, MUTE_LAND_A); continue; }
        put(F, buf, k, rampAt(RAMP_DENSITY, Math.pow(t, 0.55)), 0.5 + 0.42 * t);
      }
    },
    legend(w) {
      const ko = w.read('koala') || {};
      const dis = ko.disease || {};
      const pub = (ko.calibration && ko.calibration.published) || {};
      return {
        kind: 'ramp', unit: 'koalas per square kilometre, from where the animals actually are',
        items: rampSwatches(RAMP_DENSITY, 5).map((colour, i) => ({ colour, label: ['None', 'Sparse', '', 'Dense', 'Densest'][i] })),
        extra: [{ colour: '#e2725b', label: 'Road with recorded strikes', value: fmt.n((ko.blackspots || []).length) + ' roads' }],
        stats: [
          { k: 'Population', v: fmt.n(ko.population) },
          { k: 'Carrying capacity', v: fmt.n(ko.carryingCapacity) },
          { k: 'Chlamydia', v: fmt.pct(dis.prevalence || 0) + ' carrying' },
          { k: 'Showing signs', v: fmt.n(dis.clinical) },
          { k: 'Road crossings a year', v: fmt.n(ko.roadCrossings365) },
          { k: 'Strikes 1997 to 2010', v: fmt.n(pub.vehicle) }
        ],
        note: (ko.rescue && `${ko.rescue.service}: ${ko.rescue.number}. ${ko.rescue.publicRule}`) || ''
      };
    },
    markers(w) {
      const ko = w.read('koala');
      if (!ko) return [];
      const out = [];
      const lines = roadLines(w);
      for (const s of (ko.blackspots || []).slice(0, 6)) {
        const r = lines.find((l) => l.name && l.name.split(' (')[0] === String(s.road).split(' (')[0]);
        if (!r) continue;
        const mid = r.pts[Math.floor(r.pts.length / 2)];
        out.push({ x: mid[0], z: mid[1], label: s.road, value: `${s.strikes} strikes`, tone: 'coral', rank: 1 });
      }
      if (!out.length) {
        const spine = lines.find((l) => l.id === 'road-east-coast-a');
        if (spine) {
          const mid = spine.pts[Math.floor(spine.pts.length / 2)];
          out.push({ x: mid[0], z: mid[1], label: 'East Coast Road', value: 'no strike recorded yet', tone: 'iron', rank: 3 });
        }
      }
      return out;
    }
  });

  V.push({
    id: 'shorebirds', group: 'life', label: 'Shorebird roosts and disturbance', short: 'Shorebirds', key: 'B',
    needs: 'shorebirds',
    explain: 'Eastern curlews fly eleven thousand kilometres to get here and they are critically endangered: '
      + 'every time a dog puts a flock up, the bird burns fuel it needed for the trip home.',
    find: 'birds curlew godwit migration roost dog drone disturbance flats waders',
    basis: 'the shorebirds system: eight roosts placed from data/places.json over the mapped intertidal flat',
    begin(w, F) {
      const sb = w.read('shorebirds') || {};
      const acc = new Float32Array(F.n);
      const flats = new Uint8Array(F.n);
      if (island.waterPolys && island.waterPolys.flats) fillPoly(F, flats, island.waterPolys.flats, 1);
      let maxBirds = 1;
      for (const r of (sb.roosts || [])) if (r.birds > maxBirds) maxBirds = r.birds;
      for (const r of (sb.roosts || [])) {
        // The halo is the disturbance footprint, widened by how open the roost is and how often
        // something has put the flock up in the last year.
        const press = clamp((r.flushes365 || 0) / 220, 0, 1);
        splat(F, acc, r.x, r.z, 500 + 900 * clamp(r.openness || 0.5, 0, 1), 0.35 + 0.65 * press);
      }
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1, flats, maxBirds };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t > 0.02) { put(F, buf, k, rampAt(RAMP_PRESSURE, t), 0.42 + 0.5 * t); continue; }
        if (st.flats[k]) { put(F, buf, k, C_FLAT, 0.6); continue; }
        put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA,
            F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A);
      }
    },
    legend(w) {
      const sb = w.read('shorebirds') || {};
      const curlew = (sb.bySpecies || []).find((s) => s.id === 'sp-eastern-curlew');
      return {
        kind: 'ramp', unit: 'disturbance pressure around each roost',
        items: [
          { colour: '#5c7f84', label: 'Intertidal feeding flat', value: `${fmt.n(sb.flatsTotalHa)} ha` },
          { colour: '#2b5f5a', label: 'Quiet roost', value: '' },
          { colour: '#f0b429', label: 'Under pressure', value: '' },
          { colour: '#e2725b', label: 'Flushed often', value: '' }
        ],
        stats: [
          { k: 'Birds on the island', v: fmt.n(sb.onIslandNow) },
          { k: 'Eastern curlew', v: curlew ? `${fmt.n(curlew.count)}, ${curlew.status}` : '' },
          { k: 'Flushes, last year', v: fmt.n(sb.disturbance365) },
          { k: 'Fuel lost', v: `${fmt.n(sb.fuelLostToDisturbanceDays, 0)} bird days` },
          { k: 'Drone exclusion', v: fmt.m(sb.droneExclusionM, 0) },
          { k: 'Flats exposed now', v: `${fmt.n(sb.flatsExposedHa)} ha` }
        ],
        note: sb.tidePhase ? `Right now: ${sb.tidePhase}. ${sb.season}.` : ''
      };
    },
    markers(w) {
      const sb = w.read('shorebirds');
      if (!sb) return [];
      return (sb.roosts || []).map((r) => ({
        x: r.x, z: r.z, label: r.label,
        value: `${fmt.n(r.birds)} birds · worst: ${r.worstSource || 'nothing'}`,
        tone: (r.flushes365 || 0) > 140 ? 'coral' : (r.flushes365 || 0) > 60 ? 'sun' : 'leaf',
        rank: 1
      }));
    }
  });

  V.push({
    id: 'whales', group: 'life', label: 'Whales on migration', short: 'Whales', key: 'W',
    needs: 'whales',
    explain: 'The humpback highway runs straight past the headland, and Point Lookout is one of the few places '
      + 'in the country where you can watch it happen from dry land without a boat anywhere near the animals.',
    find: 'humpback migration calf gorge watching sightings breach marine',
    basis: 'the whales system: live pods on the migration corridor, and the published season shape',
    begin(w, F) {
      const wh = w.read('whales') || {};
      const acc = new Float32Array(F.n);
      for (const p of (wh.pods || [])) splat(F, acc, p.x, p.z, 1400, (p.size || 1) + (p.calf ? 1.4 : 0));
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const land = F.height[k] > F.seaLevel;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (!land && t > 0.02) { put(F, buf, k, rampAt(RAMP_COOL, 0.25 + 0.75 * Math.pow(t, 0.6)), 0.35 + 0.55 * t); continue; }
        put(F, buf, k, land ? MUTE_LAND : MUTE_SEA, land ? MUTE_LAND_A : MUTE_SEA_A);
      }
    },
    legend(w) {
      const wh = w.read('whales') || {};
      const pop = wh.population || {};
      return {
        kind: 'ramp', unit: 'whales on the corridor right now',
        items: rampSwatches(RAMP_COOL, 4).map((colour, i) => ({ colour, label: ['Empty water', '', 'Pods about', 'Thick with them'][i] })),
        stats: [
          { k: 'Season', v: wh.season || '' },
          { k: 'Pods offshore', v: fmt.n(wh.podsOnStage) },
          { k: 'Whales offshore', v: fmt.n(wh.whalesOnStage) },
          { k: 'Calves this season', v: fmt.n(wh.calvesThisSeason) },
          { k: 'East coast total', v: `${fmt.n(pop.low)} to ${fmt.n(pop.high)}` },
          { k: 'Watching from land', v: fmt.n(wh.watchingFromLand) }
        ],
        note: wh.lastSighting
          ? `Last sighting: ${wh.lastSighting.what}, ${wh.lastSighting.distanceKm} km off ${wh.lastSighting.from}, ${wh.lastSighting.time} ${wh.lastSighting.day}.`
          : ''
      };
    },
    markers(w) {
      const wh = w.read('whales');
      if (!wh) return [];
      const p = placeMap(w);
      const out = [];
      for (const v of (wh.viewpoints || [])) {
        const q = p.get(v.id);
        if (!q) continue;
        out.push({
          x: q.x, z: q.z, label: v.label,
          value: v.inSightNow ? `${v.inSightNow} in sight` : `${v.elevationM} m up`,
          tone: v.inSightNow ? 'sea' : 'iron', rank: v.inSightNow ? 1 : 3
        });
      }
      const pods = (wh.pods || []).filter((q) => q.visible).slice(0, 8);
      for (const q of pods) {
        out.push({
          x: q.x, z: q.z, label: q.calf ? 'Cow and calf' : `Pod of ${q.size}`,
          value: `${q.behaviour}, ${q.distanceKm.toFixed(1)} km off`, tone: 'sea', rank: 2
        });
      }
      return out;
    }
  });

  V.push({
    id: 'marine', group: 'life', label: 'Sea Country: banks and reefs', short: 'Marine', key: 'M',
    needs: 'marine',
    explain: 'The Eastern Banks off the bay side carry the seagrass that holds this end of Moreton Bay\'s '
      + 'dugong herd, and Flat Rock offshore is a green zone where the grey nurse sharks gather.',
    find: 'seagrass dugong turtle dolphin reef shark yabby banks fishing sea country pipi',
    basis: 'the marine system: seagrass on bay-side seabed between 0.4 and 6 m, plus the named reefs and banks',
    begin(w, F) {
      const grass = new Float32Array(F.n);
      for (let k = 0; k < F.n; k++) {
        const depth = F.seaLevel - F.height[k];
        if (depth <= 0.4 || depth > 6) continue;
        const bay = F.bay[k] / 255;
        if (bay < 0.4) continue;
        grass[k] = bay * (1 - smoothstep(4, 6, depth));
      }
      return { grass };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (F.height[k] > F.seaLevel) { put(F, buf, k, MUTE_LAND, MUTE_LAND_A); continue; }
        const g = st.grass[k];
        if (g > 0.02) { put(F, buf, k, rampAt(RAMP_SEAGRASS, g), 0.42 + 0.48 * g); continue; }
        const depth = F.seaLevel - F.height[k];
        put(F, buf, k, rampAt(RAMP_DEPTH, clamp(depth / 40, 0, 1)), 0.42);
      }
    },
    legend(w) {
      const m = w.read('marine') || {};
      const sg = m.seagrass || {}, du = m.dugong || {};
      return {
        kind: 'classes', unit: 'seagrass on the bay-side banks',
        items: [
          { colour: '#8fbf5a', label: 'Shallow seagrass', value: '0.4 to 2 m' },
          { colour: '#3f8f5a', label: 'Deeper seagrass', value: 'to 6 m' },
          { colour: '#16414f', label: 'Bare seabed', value: '' },
          { colour: '#07202e', label: 'Channel', value: 'Rous, Rainbow, Canaipa' }
        ],
        stats: [
          { k: 'Seagrass', v: `${fmt.n(sg.areaHa)} ha, ${fmt.n(sg.patches)} patches` },
          { k: 'Shoot density', v: fmt.pct(sg.meanShootDensity || 0) },
          { k: 'Dugong, Eastern Banks', v: fmt.n(du.onEasternBanks) },
          { k: 'Green turtles', v: fmt.n(m.turtles && m.turtles.green && m.turtles.green.feedingPopulation) },
          { k: 'Strandings, last year', v: fmt.n(m.strandings365) },
          { k: 'Gear calls', v: fmt.n(m.gearCalls365) }
        ],
        note: du.note || ''
      };
    },
    markers(w) {
      const m = w.read('marine');
      if (!m) return [];
      const out = [];
      for (const r of (m.reefs || [])) {
        out.push({ x: r.x, z: r.z, label: r.name, value: `${r.species}${r.greenZone ? ' · green zone' : ''}`, tone: 'sea', rank: 1 });
      }
      for (const b of (m.yabbyBanks || [])) {
        out.push({ x: b.x, z: b.z, label: b.label, value: `${b.state}${b.exposedNow ? ', exposed now' : ''}`, tone: b.state === 'worked' ? 'sun' : 'leaf', rank: 3 });
      }
      for (const p of (m.dolphins && m.dolphins.pods || []).slice(0, 6)) {
        out.push({ x: p.x, z: p.z, label: p.species, value: `${p.size}${p.rare ? ', rare' : ''}`, tone: 'sea', rank: 4 });
      }
      return out;
    }
  });

  /* ================================================ PEOPLE AND HOMES ============ */

  const DWELL_USE = [
    ['#3fb6c4', 'Someone lives here'],
    ['#b48ac4', 'Short-stay let'],
    ['#f0b429', 'Holiday house or weekender'],
    ['#8c99a3', 'Empty, on no market'],
    ['#8fbf5a', 'Advertised to rent']
  ];

  const DWELL_USE_RGB = DWELL_USE.map((d) => rgb(d[0]));

  function dwellingChannels(w, F) {
    const R = w.residents;
    const acc = new Float32Array(F.n * 5);
    if (!R || !R.dwellings) return { acc, total: 0 };
    let total = 0;
    for (const d of R.dwellings) {
      if (!Number.isFinite(d.x)) continue;
      let ch;
      if (d.use === 'resident') ch = 0;
      else if (d.shortStay) ch = 1;
      else if (d.market === 'long-term') ch = 4;         // advertised for a tenancy
      else if (d.use === 'holiday-home' || d.use === 'weekender') ch = 2;
      else ch = 3;
      splat(F, acc, d.x, d.z, 140, 1, 5, ch);
      total++;
    }
    return { acc, total };
  }

  V.push({
    id: 'occupancy', group: 'people', label: 'Who is home tonight', short: 'Occupancy', key: 'O',
    needs: 'housing',
    explain: 'Half the dwellings on this island have nobody living in them, and at Point Lookout it is closer '
      + 'to two thirds: this is the map behind every argument about housing here.',
    find: 'housing home dwelling empty holiday airbnb short stay let vacant census',
    basis: 'every modelled dwelling at its own position, with the use the housing system has it in tonight',
    begin(w, F) { return dwellingChannels(w, F); },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const o = k * 5;
        let sum = 0, top = 0, topV = 0;
        for (let c = 0; c < 5; c++) { const v = st.acc[o + c]; sum += v; if (v > topV) { topV = v; top = c; } }
        if (sum < 0.03) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        const col = DWELL_USE_RGB[top];
        const mix = clamp(topV / sum, 0, 1);
        const grey = [70, 76, 82];
        const c = [lerp(grey[0], col[0], mix), lerp(grey[1], col[1], mix), lerp(grey[2], col[2], mix)];
        put(F, buf, k, c, 0.45 + 0.5 * clamp(sum / 2.2, 0, 1));
      }
    },
    legend(w) {
      const h = w.read('housing') || {};
      const s = h.stock || {};
      const t = s.byTownship || {};
      const pl = t['point-lookout'] || {};
      return {
        kind: 'classes', unit: 'dwellings, coloured by what they are used for tonight',
        items: DWELL_USE.map(([colour, label], i) => ({
          colour, label,
          value: [fmt.n(s.lived_in), fmt.n(s.shortStayLet), fmt.n(s.holidayHome), fmt.n(s.onTheMarket), fmt.n(s.advertisedForRent)][i]
        })),
        stats: [
          { k: 'Dwellings', v: fmt.n(s.total) },
          { k: 'Unoccupied', v: `${(s.unoccupiedPct || 0).toFixed(1)}%` },
          { k: 'Point Lookout empty', v: pl.total ? `${Math.round((1 - pl.lived_in / pl.total) * 100)}%` : '' },
          { k: 'Census says', v: h.fit ? `${h.fit.publishedPointLookoutUnoccupiedPct}% at Point Lookout` : '' }
        ],
        note: (h.notes && h.notes[0]) || ''
      };
    },
    markers(w) {
      const h = w.read('housing');
      if (!h || !h.stock || !h.stock.byTownship) return [];
      const p = placeMap(w);
      const out = [];
      for (const [id, t] of Object.entries(h.stock.byTownship)) {
        const q = p.get(id === 'one-mile' ? 'one-mile-jetty' : id);
        if (!q) continue;
        out.push({
          x: q.x, z: q.z, label: t.label || q.name,
          value: `${fmt.n(t.lived_in)} of ${fmt.n(t.total)} lived in`,
          tone: t.total && t.lived_in / t.total < 0.4 ? 'coral' : 'sea', rank: 1
        });
      }
      return out;
    }
  });

  V.push({
    id: 'rentals', group: 'people', label: 'Rental availability', short: 'Rentals', key: 'R',
    needs: 'housing',
    explain: 'There are more empty houses here than there are people looking for one, and almost none of them '
      + 'are for rent: the shortage is not a shortage of buildings.',
    find: 'rent tenancy affordability lease landlord tenant worker accommodation housing crisis',
    basis: 'the housing system\'s market state for every dwelling, against the published median rent',
    begin(w, F) { return dwellingChannels(w, F); },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const o = k * 5;
        const avail = st.acc[o + 4];
        const empty = st.acc[o + 3] + st.acc[o + 2] + st.acc[o + 1];
        const lived = st.acc[o];
        const sum = avail + empty + lived;
        if (sum < 0.03) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        // Green where a roof is actually available to a resident, red where it is empty and is not.
        const t = clamp(avail / Math.max(0.001, avail + empty), 0, 1);
        const hasEmpty = clamp(empty / Math.max(0.001, sum), 0, 1);
        const c = hasEmpty < 0.15 ? C_GREY : rampAt(RAMP_AVAIL, t);
        put(F, buf, k, c, 0.4 + 0.5 * clamp(sum / 2.2, 0, 1));
      }
    },
    legend(w) {
      const h = w.read('housing') || {};
      const r = h.rentals || {}, s = h.stock || {};
      return {
        kind: 'classes', unit: 'a dwelling a resident could actually move into',
        items: [
          { colour: '#8fbf5a', label: 'Advertised to rent', value: fmt.n(r.available) },
          { colour: '#f0b429', label: 'Some empty, some let', value: '' },
          { colour: '#e2725b', label: 'Empty and not available', value: fmt.n(r.emptyButNotAvailable) },
          { colour: '#3a4148', label: 'Lived in', value: fmt.n(s.lived_in) }
        ],
        stats: [
          { k: 'Median rent', v: `${fmt.money(r.medianWeeklyA$)} a week` },
          { k: 'Queensland median', v: fmt.money(r.queenslandMedianA$) },
          { k: 'Share of a worker\'s wage', v: `${(r.shareOfAWorkerWagePct || 0).toFixed(0)}%` },
          { k: 'People looking', v: fmt.n(r.seekers) },
          { k: 'New listings', v: `${(r.newListingsPerMonth || 0).toFixed(1)} a month` },
          { k: 'Worker beds', v: h.workers ? `${fmt.n(h.workers.bedsFilled)} of ${fmt.n(h.workers.beds)} full` : '' }
        ]
      };
    },
    markers(w) {
      const h = w.read('housing');
      if (!h || !h.stock || !h.stock.byTownship) return [];
      const p = placeMap(w);
      const out = [];
      for (const [id, t] of Object.entries(h.stock.byTownship)) {
        const q = p.get(id === 'one-mile' ? 'one-mile-jetty' : id);
        if (!q) continue;
        out.push({
          x: q.x, z: q.z, label: t.label || q.name,
          value: `${fmt.n(t.advertisedForRent)} to rent, ${fmt.n(t.shortStay)} let by the night`,
          tone: t.advertisedForRent > 8 ? 'leaf' : 'coral', rank: 1
        });
      }
      return out;
    }
  });

  V.push({
    id: 'visitors', group: 'people', label: 'Visitor density', short: 'Visitors', key: 'P',
    needs: 'visitors',
    explain: 'On a long weekend more visitors are on this island than residents, they all arrive through one '
      + 'ferry terminal, and almost all of them go to the same four beaches.',
    find: 'tourists crowds people day trippers parking camping ferry pressure busy',
    basis: 'every visitor party at its live position, from the visitors system',
    begin(w, F) {
      const acc = new Float32Array(F.n);
      const parties = w.store.all('visitor');
      let people = 0;
      for (const [, v] of parties) {
        if (!Number.isFinite(v.x) || (v.x === 0 && v.z === 0)) continue;
        splat(F, acc, v.x, v.z, 420, v.size || 1);
        people += v.size || 1;
      }
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1, people };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t < 0.015) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        put(F, buf, k, rampAt(RAMP_DENSITY, Math.pow(t, 0.5)), 0.42 + 0.5 * t);
      }
    },
    legend(w) {
      const v = w.read('visitors') || {};
      const t = w.read('tourism') || {};
      const cap = t.capacity || {};
      return {
        kind: 'ramp', unit: 'visitors per square kilometre',
        items: rampSwatches(RAMP_DENSITY, 5).map((colour, i) => ({ colour, label: ['Nobody', 'A few', '', 'Busy', 'Packed'][i] })),
        stats: [
          { k: 'On the island', v: fmt.n(v.onIsland) },
          { k: 'Residents', v: fmt.n((w.read('population') || {}).residents) },
          { k: 'Peak this year', v: `${fmt.n(v.peakThisYear)} on ${v.peakDay || ''}` },
          { k: 'Point Lookout parking', v: cap.parking ? `${fmt.n(cap.parking.parked)} of ${fmt.n(cap.parking.bays)} bays` : '' },
          { k: 'Campsites', v: cap.campsites ? `${fmt.n(cap.campsites.used)} of ${fmt.n(cap.campsites.sites)}` : '' },
          { k: 'Public cost today', v: t.publicCost ? fmt.money(t.publicCost.totalTodayA$) : '' }
        ]
      };
    },
    markers(w) {
      const v = w.read('visitors');
      if (!v) return [];
      const p = placeMap(w);
      const out = [];
      for (const [id, n] of Object.entries(v.byTownship || {})) {
        const q = p.get(id === 'one-mile' ? 'one-mile-jetty' : id);
        if (!q) continue;
        out.push({ x: q.x, z: q.z, label: q.name, value: `${fmt.n(n)} visitors`, tone: n > 900 ? 'coral' : 'sun', rank: 1 });
      }
      return out;
    }
  });

  V.push({
    id: 'business', group: 'people', label: 'Business viability', short: 'Business', key: 'U',
    needs: 'businesses',
    explain: 'Sixty-five businesses trade here and most of a visitor dollar leaves again on the ferry: the ones '
      + 'that survive winter are the ones the island itself keeps using.',
    find: 'shops cafe pub trade takings jobs economy leakage viability winter',
    basis: 'the businesses system, joined to the coordinates in data/businesses.json',
    begin(w, F) {
      const biz = w.read('businesses') || {};
      const R = w.residents;
      const acc = new Float32Array(F.n * 3);   // 0 well 1 thin 2 struggling
      const board = biz.board || [];
      let placed = 0;
      for (const b of board) {
        const rec = R && R.businesses && R.businesses.get(b.id);
        if (!rec) continue;
        const ch = /well|steady/.test(b.viability || '') ? 0 : /thin|quiet/.test(b.viability || '') ? 1 : 2;
        splat(F, acc, rec.x, rec.z, rec.precise === false ? 340 : 190, 1, 3, ch);
        placed++;
      }
      return { acc, placed };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const o = k * 3;
        const a = st.acc[o], b = st.acc[o + 1], c = st.acc[o + 2];
        const sum = a + b + c;
        if (sum < 0.03) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        const score = (a * 1 + b * 0.5) / sum;
        put(F, buf, k, rampAt(RAMP_GOOD, score), 0.42 + 0.5 * clamp(sum / 3, 0, 1));
      }
    },
    legend(w) {
      const b = w.read('businesses') || {};
      const c = b.counts || {};
      return {
        kind: 'ramp', unit: 'how a business is travelling',
        items: rampSwatches(RAMP_GOOD, 4).map((colour, i) => ({ colour, label: ['Struggling', 'Thin', 'Steady', 'Trading well'][i] })),
        stats: [
          { k: 'Trading', v: fmt.n(c.trading_now) },
          { k: 'Not yet confirmed', v: fmt.n(c.unconfirmed) },
          { k: 'Open right now', v: fmt.n(b.openNow) },
          { k: 'Margin, last year', v: `${(b.marginPctRolling365 || 0).toFixed(1)}%` },
          { k: 'Spend leaving', v: `${(b.leakageToMainlandPct || 0).toFixed(1)}%` },
          { k: 'Demand lost today', v: fmt.money(b.demandLostTodayA$) }
        ],
        note: (b.notes && b.notes[0]) || ''
      };
    },
    markers(w) {
      const b = w.read('businesses');
      const R = w.residents;
      if (!b || !R) return [];
      const out = [];
      const board = (b.board || []).slice().sort((p, q) => (q.takingsA$ || 0) - (p.takingsA$ || 0));
      for (const rec of board.slice(0, 14)) {
        const place = R.businesses && R.businesses.get(rec.id);
        if (!place || place.precise === false) continue;
        out.push({
          x: place.x, z: place.z, label: rec.name,
          value: `${rec.viability}${rec.open ? ' · open' : ''}`,
          tone: /well/.test(rec.viability || '') ? 'leaf' : /thin/.test(rec.viability || '') ? 'sun' : 'coral',
          rank: 2
        });
      }
      return out;
    }
  });

  /* ========================================================= NETWORKS ============ */

  V.push({
    id: 'roads', group: 'networks', label: 'Roads, access and the tide', short: 'Roads', key: 'A',
    needs: 'roadNetwork',
    explain: 'Sixteen kilometres of sealed road and forty-six of beach: the beach routes are legal road and '
      + 'they close within two hours either side of high tide, which is a gate no other road here has.',
    find: 'traffic driving access 4wd beach permit tide closure congestion track speed',
    basis: 'the roads system, with the geometry from data/geography.json roads',
    begin(w, F) {
      const rn = w.read('roadNetwork') || {};
      const byRoad = new Map();
      for (const e of (rn.edges || [])) if (!byRoad.has(e.roadId)) byRoad.set(e.roadId, e);
      const cls = new Float32Array(F.n);
      const lines = roadLines(w);
      const rank = { sealed_road: 5, street: 4, unsealed_road: 3, track_4wd: 2, beach_route: 1, beach_access_track: 1.5, walking_track: 0.6 };
      for (const r of lines) {
        const e = byRoad.get(r.id);
        let v = rank[r.type] || 1;
        if (e && e.open === false) v = 0.25;
        const half = r.type === 'beach_route' ? 130 : r.type === 'sealed_road' ? 110 : 80;
        strokeLine(F, cls, r.pts, half, v);
      }
      return { cls, beachOpen: rn.beachOpen !== false };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const v = st.cls[k];
        if (v < 0.1) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        // 0 closed now, 1 walking track, 2 beach route, 3 four wheel drive, 4 unsealed, 5 street, 6 spine
        const c = C_ROAD[v <= 0.35 ? 0 : v <= 0.8 ? 1 : v <= 1.6 ? 2 : v <= 2.4 ? 3 : v <= 3.4 ? 4 : v <= 4.4 ? 5 : 6];
        put(F, buf, k, c, 0.5 + 0.42 * clamp(v / 5, 0, 1));
      }
    },
    legend(w) {
      const rn = w.read('roadNetwork') || {};
      const km = rn.lengthKm || {};
      return {
        kind: 'classes', unit: 'kilometres',
        items: [
          { colour: '#3fb6c4', label: 'Sealed road', value: fmt.km(km.sealed) },
          { colour: '#8fbf5a', label: 'Township street', value: fmt.km(km.street) },
          { colour: '#b0a58c', label: 'Unsealed road', value: fmt.km(km.gravel) },
          { colour: '#c98a3a', label: 'Four wheel drive track', value: fmt.km(km.sandtrack) },
          { colour: '#f0b429', label: 'Beach route', value: fmt.km(km.beachroute) },
          { colour: '#7d8a94', label: 'Walking track', value: fmt.km(km.walk) },
          { colour: '#e2725b', label: 'Closed right now', value: rn.beachOpen === false ? 'the beaches' : 'nothing' }
        ],
        stats: [
          { k: 'Driveable', v: fmt.km(rn.driveableKm) },
          { k: 'Open now', v: fmt.km(rn.openKm) },
          { k: 'Beach', v: rn.beachOpen ? 'open' : 'closed' },
          { k: 'Changes in', v: `${fmt.n(rn.beachNextChangeMin)} minutes` }
        ],
        note: rn.beachRule || ''
      };
    },
    markers(w) {
      const rn = w.read('roadNetwork');
      if (!rn) return [];
      const out = [];
      for (const a of (rn.accessPoints || [])) {
        out.push({
          x: a.x, z: a.z, label: a.name,
          value: rn.beachOpen ? 'beach open' : `closed, ${fmt.n(rn.beachNextChangeMin)} min`,
          tone: rn.beachOpen ? 'leaf' : 'coral', rank: 1
        });
      }
      return out;
    }
  });

  V.push({
    id: 'power', group: 'networks', label: 'Power', short: 'Power', key: 'X',
    needs: 'power',
    explain: 'Every kilowatt on this island arrives through two submarine circuits from the mainland, and the '
      + 'peak lands after dark, which is exactly when the rooftop solar has stopped.',
    find: 'electricity kilowatt cable solar battery diesel outage blackout grid demand',
    basis: 'the power system, with demand laid over the dwellings and premises that draw it',
    begin(w, F) {
      const pw = w.read('power') || {};
      const R = w.residents;
      const acc = new Float32Array(F.n);
      const dem = pw.demandByCategory || {};
      const perHome = (dem.households || 0) / Math.max(1, (R && R.dwellings ? R.dwellings.length : 1));
      if (R && R.dwellings) {
        for (const d of R.dwellings) {
          if (!Number.isFinite(d.x)) continue;
          splat(F, acc, d.x, d.z, 150, d.use === 'resident' ? perHome * 1.35 : perHome * 0.55);
        }
      }
      if (R && R.businesses) {
        const perBiz = (dem.commercial || 0) / Math.max(1, R.businesses.size);
        for (const [, b] of R.businesses) splat(F, acc, b.x, b.z, 200, perBiz);
      }
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t < 0.015) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        put(F, buf, k, rampAt(RAMP_LOAD, Math.pow(t, 0.5)), 0.42 + 0.5 * t);
      }
    },
    legend(w) {
      const p = w.read('power') || {};
      const c = p.cable || {}, s = p.solar || {}, b = p.battery || {};
      return {
        kind: 'ramp', unit: 'kilowatts being drawn right now',
        items: [
          { colour: '#20303c', label: 'Nothing drawing', value: '' },
          { colour: '#1c6c78', label: 'Houses', value: `${fmt.n(p.demandByCategory && p.demandByCategory.households)} kW` },
          { colour: '#f0b429', label: 'Township centre', value: '' },
          { colour: '#f7e6c0', label: 'Heaviest draw', value: '' }
        ],
        stats: [
          { k: 'Island demand', v: `${fmt.n(p.demandKw)} kW` },
          { k: 'Peak yesterday', v: `${fmt.n(p.peakYesterdayKw)} kW` },
          { k: 'Cable firm', v: `${fmt.n(c.firmKw)} kW, ${fmt.pct(c.firmUtilisation || 0)} used` },
          { k: 'Rooftop solar', v: `${fmt.n(s.installedKw)} kW on ${fmt.pct(s.share || 0)} of roofs` },
          { k: 'Battery', v: `${fmt.n(b.capacityKwh)} kWh, ${fmt.n(b.statePct)}% charged` },
          { k: 'Made here today', v: `${(p.selfSufficiency || {}).todayPct || 0}%` }
        ],
        note: p.couldItRunItself ? p.couldItRunItself.answer : ''
      };
    },
    markers(w) {
      const p = w.read('power');
      if (!p) return [];
      const pl = placeMap(w);
      const out = [];
      const d = pl.get('dunwich');
      if (d) {
        out.push({
          x: d.x, z: d.z, label: 'Submarine cable, mainland feed',
          value: `${fmt.n(p.cable && p.cable.importKw)} kW arriving`,
          tone: (p.cable && p.cable.up) === 2 ? 'sea' : 'coral', rank: 1
        });
      }
      if (p.inKettles) {
        const pt = pl.get('point-lookout');
        if (pt) out.push({ x: pt.x, z: pt.z, label: 'Peak today', value: `${fmt.n(p.inKettles.peakToday)} kettles at once`, tone: 'sun', rank: 2 });
      }
      return out;
    }
  });

  V.push({
    id: 'water', group: 'networks', label: 'Water and wastewater', short: 'Water', key: 'H',
    needs: 'water',
    explain: 'The townships drink island groundwater from bores, and about eight Olympic pools a day of the same '
      + 'water is piped under the bay to the mainland.',
    find: 'supply reservoir treatment pressure sewer septic wastewater restrictions bore pipeline',
    basis: 'the water system: township demand, treatment, storage and the pressure at each town',
    begin(w, F) {
      const wt = w.read('water') || {};
      const dem = (wt.demand && wt.demand.byTownship) || {};
      const R = w.residents;
      const acc = new Float32Array(F.n);
      const pl = placeMap(w);
      let max = 0;
      for (const [id, kl] of Object.entries(dem)) {
        const q = pl.get(id === 'one-mile' ? 'one-mile-jetty' : id);
        if (!q) continue;
        splat(F, acc, q.x, q.z, 1400, kl);
      }
      if (R && R.dwellings) {
        for (const d of R.dwellings) if (Number.isFinite(d.x)) splat(F, acc, d.x, d.z, 140, 6);
      }
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t < 0.015) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        put(F, buf, k, rampAt(RAMP_COOL, 0.15 + 0.85 * Math.pow(t, 0.5)), 0.42 + 0.5 * t);
      }
    },
    legend(w) {
      const wt = w.read('water') || {};
      const take = wt.take || {}, st = wt.storage || {}, ww = wt.wastewater || {}, r = wt.restrictions || {};
      return {
        kind: 'ramp', unit: 'kilolitres a day drawn here',
        items: rampSwatches(RAMP_COOL, 4).map((colour, i) => ({ colour, label: ['None', 'Households', 'Township', 'Heaviest'][i] })),
        stats: [
          { k: 'Township take', v: `${(take.townshipMlDay || 0).toFixed(2)} ML/day` },
          { k: 'To the mainland', v: `${fmt.n(take.mainlandMlDay)} ML/day` },
          { k: 'Storage', v: st.hoursLabel ? `${st.hoursLabel} of supply` : '' },
          { k: 'Restrictions', v: r.label || '' },
          { k: 'On sewer', v: fmt.pct(ww.sewerShare || 0) },
          { k: 'On septic', v: `${fmt.n(ww.septicDwellings)} dwellings` }
        ],
        note: take.sentence || ''
      };
    },
    markers(w) {
      const wt = w.read('water');
      if (!wt) return [];
      const pl = placeMap(w);
      const out = [];
      const byT = (wt.pressure && wt.pressure.byTownship) || {};
      for (const [id, p] of Object.entries(byT)) {
        const q = pl.get(id === 'one-mile' ? 'one-mile-jetty' : id);
        if (!q) continue;
        out.push({
          x: q.x, z: q.z, label: q.name,
          value: `${p.state}${Number.isFinite(p.headM) ? `, ${p.headM.toFixed(0)} m head` : ''}`,
          tone: /low|poor/.test(p.state || '') ? 'coral' : 'sea', rank: 1
        });
      }
      return out;
    }
  });

  V.push({
    id: 'waste', group: 'networks', label: 'Waste', short: 'Waste', key: 'Y',
    needs: 'waste',
    explain: 'There is one tip, at Dunwich, and everything that leaves this island leaves on the same barge deck '
      + 'that visitors arrive on, so a busy weekend and a waste backlog are the same problem.',
    find: 'rubbish bins tip landfill recycling barge dumping litter kerbside',
    basis: 'the waste system and the named recycling and waste centre in data/businesses.json',
    begin(w, F) {
      const R = w.residents;
      const acc = new Float32Array(F.n);
      if (R && R.dwellings) for (const d of R.dwellings) if (Number.isFinite(d.x)) splat(F, acc, d.x, d.z, 170, d.use === 'resident' ? 1.4 : 0.7);
      const tip = siteOf(w, 'nsi-recycling-and-waste-centre') || placeMap(w).get('dunwich');
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1, tip };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (t < 0.02) { put(F, buf, k, F.height[k] > F.seaLevel ? MUTE_LAND : MUTE_SEA, F.height[k] > F.seaLevel ? MUTE_LAND_A : MUTE_SEA_A); continue; }
        put(F, buf, k, rampAt(RAMP_WASTE, Math.pow(t, 0.55)), 0.42 + 0.5 * t);
      }
    },
    legend(w) {
      const ws = w.read('waste') || {};
      const rec = ws.recycling || {}, yard = ws.yard || {}, barge = ws.barge || {}, cost = ws.cost || {};
      return {
        kind: 'ramp', unit: 'waste generated here',
        items: [
          { colour: '#2a2f26', label: 'Nothing', value: '' },
          { colour: '#7d7f4a', label: 'Holiday houses', value: '' },
          { colour: '#c98a3a', label: 'Lived-in streets', value: '' },
          { colour: '#e2725b', label: 'Heaviest', value: '' }
        ],
        stats: [
          { k: 'Generated', v: `${fmt.n(ws.tonnesPerYear)} t a year` },
          { k: 'Diverted', v: fmt.pct(rec.diversionPct || 0, 1) },
          { k: 'Contamination', v: fmt.pct(rec.contamination || 0, 1) },
          { k: 'On the ground', v: `${fmt.n(yard.storedT, 1)} t` },
          { k: 'Barge backlog', v: `${(barge.backlogDays || 0).toFixed(1)} days` },
          { k: 'Cost a tonne', v: fmt.money(cost.perTonneA$) }
        ],
        note: rec.why || ''
      };
    },
    markers(w) {
      const ws = w.read('waste');
      if (!ws) return [];
      const out = [];
      const tip = siteOf(w, 'nsi-recycling-and-waste-centre') || placeMap(w).get('dunwich');
      if (tip) {
        out.push({
          x: tip.x, z: tip.z, label: (ws.facility && ws.facility.name) || 'Recycling and waste centre',
          value: `${fmt.n(ws.yard && ws.yard.storedT, 1)} t on the ground`,
          tone: (ws.yard && ws.yard.pctFullByVolume) > 0.75 ? 'coral' : 'sun', rank: 1
        });
      }
      for (const t of terminals(w)) {
        if (!/Junner/.test(t.name)) continue;
        out.push({ x: t.x, z: t.z, label: 'Barge ramp', value: `${fmt.n(ws.barge && ws.barge.runsPerWeek)} runs a week`, tone: 'iron', rank: 2 });
      }
      return out;
    }
  });

  V.push({
    id: 'mobile', group: 'networks', label: 'Mobile coverage and the ridge', short: 'Mobile', key: 'N',
    needs: 'telecoms',
    explain: 'Coverage here is a terrain problem, not a carrier problem: the old dune ridge runs to 228 m '
      + 'between the towns and the lakes, and a phone at Blue Lake has that whole ridge in the way.',
    find: 'signal phone reception coverage tower nbn internet dead spot triple zero telecoms',
    basis: 'the wash is measured by this layer: how much dune stands between a point and the nearest '
      + 'township site, marched over the heightfield. The dBm readings on the markers and the percentages '
      + 'below are the telecoms system, which runs its own coverage model',
    begin(w, F) {
      const pl = placeMap(w);
      const sites = [];
      for (const id of ['dunwich', 'point-lookout', 'amity-point']) {
        const q = pl.get(id);
        if (q) sites.push({ id, label: q.name, x: q.x, z: q.z, y: island.height(q.x, q.z) + 30 });
      }
      // How much country is in the way. For every land cell, walk the straight line to the nearest
      // site and keep the greatest height the ground reaches above that line. Zero is a clear view
      // of a mast; forty metres is forty metres of dune standing in front of it. This is a terrain
      // measurement, not a signal model: the signal model belongs to the telecoms system and its
      // numbers are on the markers and in the legend beside this.
      const block = new Float32Array(F.n).fill(-1);
      const dist = new Float32Array(F.n);
      const STEPS = 26;
      let clear = 0, land = 0;
      for (let k = 0; k < F.n; k++) {
        if (F.height[k] <= F.seaLevel || !sites.length) continue;
        land++;
        const x = F.x0 + (k % F.nx) * CELL, z = F.z0 + Math.floor(k / F.nx) * CELL;
        let best = sites[0], bd = Infinity;
        for (const st2 of sites) {
          const d2 = (st2.x - x) * (st2.x - x) + (st2.z - z) * (st2.z - z);
          if (d2 < bd) { bd = d2; best = st2; }
        }
        const d = Math.sqrt(bd);
        dist[k] = d;
        const eye = F.height[k] + 1.6;              // a phone at head height
        let worst = 0;
        for (let t = 1; t < STEPS; t++) {
          const f = t / STEPS;
          const h = F.height[F.at(best.x + (x - best.x) * f, best.z + (z - best.z) * f)];
          const line = best.y + (eye - best.y) * f;
          const over = h - line;
          if (over > worst) worst = over;
        }
        block[k] = worst;
        if (worst < 1) clear++;
      }
      return { block, dist, sites, clearShare: land ? clear / land : 0 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        if (st.block[k] < 0) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        // Green where nothing is in the way and a mast is close; red where a ridge is.
        const shade = clamp(st.block[k] / 45, 0, 1);
        const far = clamp(st.dist[k] / 11000, 0, 1);
        put(F, buf, k, rampAt(RAMP_SIGNAL, clamp(1 - Math.max(shade, far * 0.75), 0, 1)), 0.92);
      }
    },
    legend(w) {
      const t = w.read('telecoms') || {};
      const cov = t.coverage || {}, cr = t.crossing || {};
      const st = this._st || {};
      const bands = cov.byBand || {};
      return {
        kind: 'ramp', unit: 'metres of dune between you and the nearest township site',
        items: rampSwatches(RAMP_SIGNAL, 4).reverse().map((colour, i) => ({
          colour, label: ['Clear view of a mast', 'A rise in the way', 'A ridge in the way', 'Deep in the dune field'][i]
        })),
        stats: [
          { k: 'Clear line to a mast', v: fmt.pct(st.clearShare || 0) },
          { k: 'Usable signal', v: `${cov.landUsablePct || 0}%` },
          { k: 'Good signal', v: fmt.pct(bands.good || 0) },
          { k: 'No signal', v: fmt.pct(bands.none || 0) },
          { k: 'Sites up', v: `${fmt.n(t.sitesUp)} of ${(t.sites || []).length}` },
          { k: 'Crossing, no data', v: fmt.km(cr.gapKm) }
        ],
        note: cr.sentence || cov.note || ''
      };
    },
    markers(w) {
      const t = w.read('telecoms');
      if (!t) return [];
      const pl = placeMap(w);
      const out = [];
      for (const [id, row] of Object.entries((t.coverage && t.coverage.byPlace) || {})) {
        const q = pl.get(id);
        if (!q) continue;
        out.push({
          x: q.x, z: q.z, label: row.name, value: `${row.dbm} dBm · ${row.band}`,
          tone: row.band === 'none' ? 'coral' : row.band === 'marginal' ? 'sun' : row.band === 'good' ? 'leaf' : 'iron',
          rank: row.band === 'none' ? 1 : row.band === 'marginal' ? 2 : 4
        });
      }
      return out;
    }
  });

  V.push({
    id: 'noise', group: 'networks', label: 'Noise', short: 'Noise', key: 'Q',
    needs: null,
    explain: 'Most of this island is quiet enough to hear the surf from the middle of it: the noise is the '
      + 'spine road, the barge ramp, the tip and one pub, and it is all in the same few streets.',
    find: 'quiet sound loud venue pub ferry traffic amenity sleep',
    basis: 'MODELLED by this layer from published sources: the road network by class and speed, the venues '
      + 'that are open right now, the ferry terminals and the waste centre. No noise system is loaded and '
      + 'no measured noise data for this island was found.',
    begin(w, F) {
      const rn = w.read('roadNetwork') || {};
      const biz = w.read('businesses') || {};
      const R = w.residents;
      const acc = new Float32Array(F.n);
      const byRoad = new Map();
      for (const e of (rn.edges || [])) if (!byRoad.has(e.roadId)) byRoad.set(e.roadId, e);
      for (const r of roadLines(w)) {
        const e = byRoad.get(r.id);
        const speed = e ? e.speedKmh || 40 : 40;
        const w0 = r.type === 'sealed_road' ? 1.0 : r.type === 'street' ? 0.42 : r.type === 'beach_route' ? 0.5 : 0.2;
        if (e && e.open === false) continue;
        strokeLine(F, acc, r.pts, 260 + speed * 6, w0 * (0.5 + speed / 110), 1, 0, 'add');
      }
      if (R && R.businesses) {
        for (const b of (biz.board || [])) {
          if (!b.open) continue;
          const rec = R.businesses.get(b.id);
          if (!rec || rec.precise === false) continue;
          const loud = /hospitality|fuel/.test(b.sector || '') ? 0.9 : 0.35;
          splat(F, acc, rec.x, rec.z, 420, loud);
        }
      }
      for (const t of terminals(w)) {
        if (!/Junner|One Mile|Airfield/.test(t.name)) continue;
        splat(F, acc, t.x, t.z, 900, /Airfield/.test(t.name) ? 0.5 : 1.1);
      }
      const tip = siteOf(w, 'nsi-recycling-and-waste-centre');
      if (tip) splat(F, acc, tip.x, tip.z, 600, 0.8);
      let max = 0;
      for (let k = 0; k < F.n; k++) if (acc[k] > max) max = acc[k];
      return { acc, max: max || 1 };
    },
    row(w, F, st, j) {
      const buf = F.buf, base = j * F.nx;
      for (let i = 0; i < F.nx; i++) {
        const k = base + i;
        const t = clamp(st.acc[k] / st.max, 0, 1);
        if (F.height[k] <= F.seaLevel && t < 0.02) { put(F, buf, k, MUTE_SEA, MUTE_SEA_A); continue; }
        put(F, buf, k, rampAt(RAMP_NOISE, Math.pow(t, 0.6)), 0.42 + 0.44 * t);
      }
    },
    legend(w) {
      const rn = w.read('roadNetwork') || {};
      const b = w.read('businesses') || {};
      const f = w.read('ferry') || {};
      return {
        kind: 'ramp', unit: 'modelled noise exposure, relative',
        items: [
          { colour: '#16302c', label: 'Surf and wind only', value: '' },
          { colour: '#2f6b60', label: 'A car goes past', value: '' },
          { colour: '#c9c05a', label: 'Township street', value: '' },
          { colour: '#e08a2a', label: 'Spine road, venues', value: '' },
          { colour: '#e2725b', label: 'Barge ramp and the tip', value: '' }
        ],
        stats: [
          { k: 'Venues open now', v: fmt.n(b.openNow) },
          { k: 'Sailings today', v: fmt.n((f.sailings || []).length) },
          { k: 'Spine road', v: fmt.km(rn.lengthKm && rn.lengthKm.spine) },
          { k: 'Beach routes', v: rn.beachOpen ? 'open to vehicles' : 'closed' }
        ],
        note: 'Modelled here, not measured. It combines road class and speed, the venues the businesses '
          + 'system has open right now, the ferry terminals and the waste centre. Treat it as a shape, not a decibel.'
      };
    },
    markers(w) {
      const out = [];
      for (const t of terminals(w)) {
        if (!/Junner/.test(t.name)) continue;
        out.push({ x: t.x, z: t.z, label: 'Junner Street ferry terminal', value: 'the loudest thing on the island', tone: 'coral', rank: 1 });
      }
      return out;
    }
  });

  return V;
}

export const INFO_GROUPS = [
  { id: 'land', label: 'Land', tone: '#8fbf5a' },
  { id: 'water', label: 'Coast and water', tone: '#3fb6c4' },
  { id: 'life', label: 'Living island', tone: '#b48ac4' },
  { id: 'people', label: 'People and homes', tone: '#f0b429' },
  { id: 'networks', label: 'Networks', tone: '#8c99a3' }
];

/* ------------------------------------------------------------------ the controller

One object, hung off the world, that both panels and the render layer drive. It owns which view
is active, the lattice, the two texture buffers and the band-by-band rebuild. It works with no
renderer at all, so the minimap and the switcher keep working under ?headless=1. */

export function infoView(world) {
  if (world.infoView) return world.infoView;

  const views = buildViews(world);
  const byId = new Map(views.map((v) => [v.id, v]));
  const listeners = [];
  let F = null;
  let activeId = null;
  let previousId = null;

  // Two buffers: one on screen, one being written. `cross` runs 0 to 1 as the new one comes in.
  const bake = { view: null, row: 0, st: null, running: false, done: false };
  let mixIn = 0;              // overall fade of the whole sheet
  let cross = 1;              // 0 shows buffer A, 1 shows buffer B
  let liveIsB = false;
  let lastBakeTick = -1e9;

  function ensureLattice() {
    if (F) return F;
    F = buildLattice(world);
    if (!F) return null;
    F.bufA = new Uint8Array(F.n * 4);
    F.bufB = new Uint8Array(F.n * 4);
    F.buf = F.bufA;
    return F;
  }

  function startBake(view) {
    if (!ensureLattice() || !view) return;
    F.buf = liveIsB ? F.bufA : F.bufB;   // write into whichever is not on screen
    bake.view = view;
    bake.row = 0;
    bake.running = true;
    bake.done = false;
    try { bake.st = view.begin ? view.begin(world, F) : null; } catch (e) { bake.st = null; note(e); }
    view._st = bake.st;
  }

  function stepBake(rows) {
    if (!bake.running) return false;
    const view = bake.view;
    const end = Math.min(F.nz, bake.row + rows);
    for (let j = bake.row; j < end; j++) {
      try { view.row(world, F, bake.st, j); } catch (e) { clearRow(F, F.buf, j); note(e); }
    }
    bake.row = end;
    if (bake.row >= F.nz) {
      bake.running = false;
      bake.done = true;
      liveIsB = !liveIsB;
      cross = 0;                 // the shader eases from the old buffer to the new one
      lastBakeTick = world.clock.tick;
      emit();
      return true;
    }
    return false;
  }

  const errors = [];
  function note(e) {
    const msg = String((e && e.message) || e);
    if (errors.length < 12 && !errors.includes(msg)) errors.push(msg);
  }

  function emit() {
    for (const fn of listeners) { try { fn(activeId, byId.get(activeId) || null); } catch (e) { note(e); } }
  }

  const api = {
    groups: INFO_GROUPS,
    list() { return views.map((v) => ({ id: v.id, group: v.group, label: v.label, short: v.short, key: v.key })); },
    all() { return views; },
    get(id) { return byId.get(id) || null; },
    activeId() { return activeId; },
    active() { return byId.get(activeId) || null; },
    previousId() { return previousId; },
    available(v) { return !v.needs || !!world.read(v.needs); },

    set(id) {
      const v = id ? byId.get(id) : null;
      if (id && !v) return null;
      if (activeId === id) return v;
      previousId = activeId;
      activeId = id || null;
      if (activeId) startBake(v);
      world.bus.emit('infoview:set', { id: activeId, label: v ? v.label : null });
      emit();
      return v;
    },
    clear() { return api.set(null); },
    toggle(id) { return api.set(activeId === id ? null : id); },
    step(dir) {
      const usable = views.filter((v) => api.available(v));
      if (!usable.length) return null;
      const i = usable.findIndex((v) => v.id === activeId);
      const n = usable.length;
      return api.set(usable[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + n * 2) % n].id);
    },
    /** Rebuild the active view against whatever the simulation says right now. */
    refresh() { if (activeId && !bake.running) startBake(byId.get(activeId)); },

    legend() {
      const v = api.active();
      if (!v) return null;
      let L = null;
      try { L = v.legend(world, F); } catch (e) { note(e); }
      if (!L) L = { kind: 'classes', items: [], stats: [] };
      L.id = v.id; L.label = v.label; L.explain = v.explain; L.basis = v.basis; L.group = v.group;
      return L;
    },
    markers() {
      const v = api.active();
      if (!v) return [];
      try { return v.markers(world) || []; } catch (e) { note(e); return []; }
    },
    /** The live texture, for the minimap. */
    field() {
      if (!F) return null;
      return {
        nx: F.nx, nz: F.nz, cell: F.cell, x0: F.x0, z0: F.z0,
        rgba: liveIsB ? F.bufB : F.bufA, ready: bake.done || !bake.running
      };
    },
    lattice() { return F; },
    /** What the active view has at this point, for the inspector and the map tooltip. */
    sample(x, z) {
      if (!F || !activeId) return null;
      const k = F.at(x, z);
      const buf = liveIsB ? F.bufB : F.bufA;
      const o = k * 4;
      return {
        colour: toHex([buf[o], buf[o + 1], buf[o + 2]]),
        alpha: buf[o + 3] / 255,
        heightM: +(F.height[k] - F.seaLevel).toFixed(1),
        slopeDeg: +F.slopeDeg[k].toFixed(1),
        cover: F.covers[F.cover[k]],
        shoreM: Math.round(F.shore[k])
      };
    },

    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },

    // The render layer drives these. They are on the controller rather than in the layer so the
    // bake keeps running, and the minimap keeps updating, when there is no renderer.
    _pump(dt) {
      if (bake.running) stepBake(BAND_ROWS);
      else if (activeId && world.clock.tick - lastBakeTick >= REFRESH_TICKS) startBake(byId.get(activeId));
      const target = activeId ? 1 : 0;
      const rate = dt / FADE_IN;
      mixIn = target > mixIn ? Math.min(target, mixIn + rate) : Math.max(target, mixIn - rate);
      cross = Math.min(1, cross + rate);
      return { mixIn, cross, liveIsB };
    },
    _state() { return { mixIn, cross, liveIsB, baking: bake.running, row: bake.row, errors }; }
  };

  world.infoView = api;
  return api;
}

/* ------------------------------------------------------------------ the sheet */

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform vec3 uCam;
varying vec2 vUV;
varying vec3 vN;
varying float vDist;
void main(void) {
  vUV = uv;
  vN = normal;
  vDist = distance(uCam, position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUV;
varying vec3 vN;
varying float vDist;
uniform sampler2D texA;
uniform sampler2D texB;
uniform vec4 uMix;    // x cross, y overall, z how much light is on the island, w 0
uniform vec4 uSun;    // xyz direction to the sun, w how far above the horizon
uniform vec4 uHaze;   // rgb the colour of the air, a extinction per metre
void main(void) {
  vec4 a = texture2D(texA, vUV);
  vec4 b = texture2D(texB, vUV);
  vec4 c = mix(a, b, uMix.x);
  if (c.a < 0.004) discard;

  // Shaded by the island's own landform against the real sun, with a floor under it, so a
  // thematic map still reads as this place and still reads at three in the morning. The range is
  // deliberately narrow: the hillshade is here to give the data a landform, not to relight it.
  float lam = clamp(dot(normalize(vN), uSun.xyz), 0.0, 1.0);
  float shade = 0.74 + 0.30 * mix(0.55, lam, uSun.w);

  // Two corrections, both because of what happens downstream. Everything after this layer meters
  // the frame, tone maps it with ACES and grades it.
  //
  //   * A data colour authored at a leaf's reflectance comes out of that chain as the same muted
  //     green as the leaf, so the wash is authored well above the albedo the terrain works in.
  //   * The meter adapts. A wash at a fixed brightness is correct at noon and a sheet of blown
  //     white at ten at night, when the exposure has opened up two stops to find the moon. So the
  //     wash rides the same light the island is under, with a floor so a legend is still legible
  //     in the dark rather than fading out with the country.
  vec3 col = c.rgb * shade * 1.16 * uMix.z;

  // A trace of the same air the terrain looks through, so the far end of a thirty-nine kilometre
  // island still recedes. Only a trace: a diagram that fades out at range is a bad diagram.
  float fog = 1.0 - exp(-uHaze.a * vDist);
  col = mix(col, uHaze.rgb, min(fog, 0.20));

  // No coloured ceiling over your head: the wash lifts off the ground within a few dozen metres
  // and stays on the country in front of you. Faded on distance rather than on height above the
  // ground, because height varies from vertex to vertex by the amount the sheet is floating over a
  // dune crest, and fading on that turned the near field into a mosaic of hovering glass panels.
  float lift = smoothstep(45.0, 380.0, vDist);
  gl_FragColor = vec4(col, c.a * uMix.y * lift);
}
`;

export function registerInfoView(world) {
  const api = infoView(world);

  // The system half: it exists so the catalogue turns up in TWIN.probe() and so a critic can
  // drive the views from the console without a UI. It never ticks.
  world.register({
    id: 'infoview',
    phase: 'presentation',
    order: 95,
    describe(w) {
      const s = api._state();
      return {
        views: api.list().length,
        groups: INFO_GROUPS.map((g) => g.id),
        active: api.activeId(),
        unavailable: api.all().filter((v) => !api.available(v)).map((v) => v.id),
        errors: s.errors
      };
    },
    save() { return { active: api.activeId() }; },
    load(w, s) { if (s && s.active) api.set(s.active); }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;
  const scene = stage.scene;

  let mesh = null, mat = null, texA = null, texB = null;
  let marks = null;                  // the DOM marker container
  const pool = [];
  const vSun = new B.Vector4(0.3, 0.8, 0.4, 1);
  const vHaze = new B.Vector4(0.5, 0.6, 0.7, 0.00004);
  const vMix = new B.Vector4(1, 0, 0, 0);
  const vCam = new B.Vector3(0, 0, 0);
  const proj = new B.Vector3(0, 0, 0);
  let built = false;
  let lastMarkerView = null;
  let markerData = [];
  let markerTick = -1e9;

  function build() {
    const F = api.lattice();
    if (!F) return false;
    const bias = measureEnvelope(world, F);

    // Which quads are worth carrying: the island and enough of its sea for the banks, the roosts
    // and the whale corridor. Everything past that is deep water with nothing on it.
    const keep = new Uint8Array(F.n);
    for (let j = 0; j < F.nz - 1; j++) {
      for (let i = 0; i < F.nx - 1; i++) {
        const k = j * F.nx + i;
        if (F.shore[k] > -SEA_MARGIN || F.shore[k + 1] > -SEA_MARGIN
          || F.shore[k + F.nx] > -SEA_MARGIN || F.shore[k + F.nx + 1] > -SEA_MARGIN) {
          keep[k] = 1; keep[k + 1] = 1; keep[k + F.nx] = 1; keep[k + F.nx + 1] = 1;
        }
      }
    }

    const remap = new Int32Array(F.n).fill(-1);
    const pos = [], nrm = [], uvs = [];
    let nv = 0;
    for (let j = 0; j < F.nz; j++) {
      for (let i = 0; i < F.nx; i++) {
        const k = j * F.nx + i;
        if (!keep[k]) continue;
        remap[k] = nv++;
        const y = Math.max(F.height[k] + bias[k] + LIFT, F.seaLevel + WATER_LIFT);
        pos.push(F.x0 + i * CELL, y, F.z0 + j * CELL);
        const hx = F.height[k + (i < F.nx - 1 ? 1 : 0)] - F.height[k - (i > 0 ? 1 : 0)];
        const hz = F.height[k + (j < F.nz - 1 ? F.nx : 0)] - F.height[k - (j > 0 ? F.nx : 0)];
        const sx = (i > 0 && i < F.nx - 1 ? 2 : 1) * CELL;
        const sz = (j > 0 && j < F.nz - 1 ? 2 : 1) * CELL;
        const nxv = -hx / sx, nzv = -hz / sz;
        const inv = 1 / Math.sqrt(nxv * nxv + nzv * nzv + 1);
        nrm.push(nxv * inv, inv, nzv * inv);
        uvs.push((i + 0.5) / F.nx, (j + 0.5) / F.nz);
      }
    }
    const idx = [];
    for (let j = 0; j < F.nz - 1; j++) {
      for (let i = 0; i < F.nx - 1; i++) {
        const k = j * F.nx + i;
        const a = remap[k], b = remap[k + 1], c = remap[k + F.nx], d = remap[k + F.nx + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        // Wound so the up-facing side is the front face in Babylon's left handed scene. Wound the
        // other way the sheet is culled from above, which looks exactly like a sheet that is not
        // being drawn at all, and costs an afternoon.
        idx.push(a, b, c, b, d, c);
      }
    }

    mesh = new B.Mesh('infoview', scene);
    const vd = new B.VertexData();
    vd.positions = pos; vd.normals = nrm; vd.uvs = uvs; vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.alphaIndex = 40;
    mesh.receiveShadows = false;

    texA = new B.RawTexture(F.bufA, F.nx, F.nz, B.Engine.TEXTUREFORMAT_RGBA, scene, false, false,
      B.Texture.BILINEAR_SAMPLINGMODE);
    texB = new B.RawTexture(F.bufB, F.nx, F.nz, B.Engine.TEXTUREFORMAT_RGBA, scene, false, false,
      B.Texture.BILINEAR_SAMPLINGMODE);
    for (const t of [texA, texB]) { t.wrapU = B.Texture.CLAMP_ADDRESSMODE; t.wrapV = B.Texture.CLAMP_ADDRESSMODE; }

    mat = new B.ShaderMaterial('infoviewMat', scene,
      { vertexSource: VERT, fragmentSource: FRAG },
      {
        attributes: ['position', 'normal', 'uv'],
        uniforms: ['worldViewProjection', 'uCam', 'uMix', 'uSun', 'uHaze'],
        samplers: ['texA', 'texB'],
        needAlphaBlending: true
      });
    mat.backFaceCulling = true;
    mat.alpha = 0.999;
    mat.alphaMode = B.Engine.ALPHA_COMBINE;
    mat.disableDepthWrite = true;
    mat.setTexture('texA', texA);
    mat.setTexture('texB', texB);
    mesh.material = mat;
    mesh.setEnabled(false);

    const root = document.getElementById('ui-root');
    if (root) {
      marks = document.createElement('div');
      marks.className = 'iv-marks';
      marks.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
      root.appendChild(marks);
      injectMarkerCss();
    }

    built = true;
    console.info(`[infoview] ${api.list().length} views, sheet ${nv} vertices, ${idx.length / 3} triangles at ${CELL} m`);
    return true;
  }

  function markerEl(i) {
    if (pool[i]) return pool[i];
    const el = document.createElement('div');
    el.className = 'iv-mark';
    el.innerHTML = '<i class="iv-dot"></i><span class="iv-pill"><b></b><em></em></span>';
    marks.appendChild(el);
    pool[i] = el;
    return el;
  }

  const _mv = B ? new B.Vector3(0, 0, 0) : null;
  const _ident = B ? B.Matrix.Identity() : null;
  const boxes = [];

  function updateMarkers() {
    if (!marks) return;
    const v = api.active();
    if (!v) {
      for (const el of pool) el.style.display = 'none';
      lastMarkerView = null;
      return;
    }
    if (v.id !== lastMarkerView || world.clock.tick - markerTick >= REFRESH_TICKS) {
      markerData = api.markers().slice(0, 40).sort((a, b) => (a.rank || 5) - (b.rank || 5));
      for (const m of markerData) m._y = Math.max(island ? island.height(m.x, m.z) : 0, 0) + 14;
      lastMarkerView = v.id;
      markerTick = world.clock.tick;
    }
    const cam = scene.activeCamera;
    if (!cam) return;
    const eng = stage.engine;
    const rw = eng.getRenderWidth(), rh = eng.getRenderHeight();
    const vp = cam.viewport.toGlobal(rw, rh);
    const tm = scene.getTransformMatrix();
    // Projection lands in drawing-buffer pixels; the markers live in CSS pixels.
    const scale = (stage.canvas.clientWidth || rw) / rw;
    const tm2 = tm;
    boxes.length = 0;
    let used = 0;
    for (let i = 0; i < markerData.length && used < 26; i++) {
      const m = markerData[i];
      _mv.set(m.x, m._y, m.z);
      B.Vector3.ProjectToRef(_mv, _ident, tm2, vp, proj);
      if (proj.z < 0 || proj.z > 1) continue;
      const sx = proj.x * scale, sy = proj.y * scale;
      const w0 = stage.canvas.clientWidth || rw, h0 = stage.canvas.clientHeight || rh;
      if (sx < -60 || sy < -30 || sx > w0 + 60 || sy > h0 + 30) continue;
      // Cheap declutter: a marker that would sit on top of a more important one is dropped.
      let clash = false;
      for (let b = 0; b < boxes.length; b += 2) {
        if (Math.abs(boxes[b] - sx) < 152 && Math.abs(boxes[b + 1] - sy) < 26) { clash = true; break; }
      }
      if (clash) continue;
      boxes.push(sx, sy);
      const el = markerEl(used++);
      el.style.display = '';
      el.style.transform = `translate3d(${Math.round(sx)}px, ${Math.round(sy - 5)}px, 0)`;
      if (el.dataset.tone !== (m.tone || 'sea')) el.dataset.tone = m.tone || 'sea';
      const b = el.querySelector('b'), em = el.querySelector('em');
      if (b.textContent !== m.label) b.textContent = m.label;
      const val = m.value || '';
      if (em.textContent !== val) em.textContent = val;
      em.style.display = val ? '' : 'none';
    }
    for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
  }

  stage.addLayer({
    id: 'infoview',
    order: 62,
    init() {
      // The lattice and the sheet are the expensive part, and most sessions open the island long
      // before they open an info view, so both are built the first time one is switched on.
    },
    frame(st, w, dt) {
      const wantSheet = !!api.activeId();
      if (wantSheet && !built && api.lattice()) build();
      const m = api._pump(Math.max(0.001, Math.min(0.1, dt)));
      if (!built) return;

      if (m.mixIn <= 0.001 && !wantSheet) { mesh.setEnabled(false); if (marks) marks.style.display = 'none'; return; }
      mesh.setEnabled(true);
      if (marks) marks.style.display = '';

      const F = api.lattice();
      // Only the buffer being written is re-uploaded, and only while a bake is running.
      const s = api._state();
      if (s.baking || s.row > 0) {
        if (F.buf === F.bufA) texA.update(F.bufA); else texB.update(F.bufB);
      }
      const view = api.active();
      // A class map must not blend one class into the next; a ramp must.
      const wantNearest = !!view && /landcover|vegetation/.test(view.id);
      const mode = wantNearest ? B.Texture.NEAREST_SAMPLINGMODE : B.Texture.BILINEAR_SAMPLINGMODE;
      if (texA._ivMode !== mode) { texA.updateSamplingMode(mode); texA._ivMode = mode; }
      if (texB._ivMode !== mode) { texB.updateSamplingMode(mode); texB._ivMode = mode; }

      // A shows the older buffer, B the newer, whichever way round they physically are.
      mat.setTexture('texA', m.liveIsB ? texA : texB);
      mat.setTexture('texB', m.liveIsB ? texB : texA);
      const day = w.read('daylight') || { altitude: 0.6, azimuth: 1.2 };
      const cy = Math.cos(day.altitude), sy = Math.sin(day.altitude);
      vSun.set(cy * Math.sin(day.azimuth), Math.max(sy, -0.2), cy * Math.cos(day.azimuth),
        clamp((sy + 0.08) / 0.28, 0, 1));
      mat.setVector4('uSun', vSun);

      const wx = w.read('weather') || {};
      const dayF = clamp((sy + 0.08) / 0.3, 0, 1);
      // The same expression the terrain and the ocean use for the strength of the sun, floored so
      // the island can go dark and the data on it cannot.
      const light = Math.max(0.34, (0.06 + 1.14 * dayF) * (1 - (wx.cloud || 0) * 0.55));
      vMix.set(m.cross, m.mixIn, light, 0);
      mat.setVector4('uMix', vMix);

      const warm = 1 - clamp(sy * 4, 0, 1);
      const vis = Math.max(3, wx.visibilityKm || 20);
      vHaze.set(
        (0.10 + 0.62 * dayF) * (1 + 0.5 * warm),
        0.13 + 0.60 * dayF,
        0.20 + 0.66 * dayF * (1 - 0.35 * warm),
        3.912 / (vis * 1000) * 0.55
      );
      mat.setVector4('uHaze', vHaze);

      const cam = st.scene.activeCamera;
      if (cam) { vCam.copyFrom(cam.globalPosition); mat.setVector3('uCam', vCam); }

      updateMarkers();
    },
    dispose() {
      if (mesh) mesh.dispose();
      if (mat) mat.dispose();
      if (texA) texA.dispose();
      if (texB) texB.dispose();
      if (marks) marks.remove();
    }
  });
}

/* ------------------------------------------------------------------ marker styling */

let cssDone = false;
function injectMarkerCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'iv-marker-css';
  s.textContent = `
.iv-mark { position:absolute; top:0; left:0; will-change:transform; pointer-events:none;
  display:flex; align-items:center; gap:6px; transform-origin:0 50%; animation:iv-pop .22s var(--ease-out, ease) both; }
.iv-dot { width:9px; height:9px; border-radius:50%; flex:none; margin-left:-4px;
  background:var(--iv-tone); box-shadow:0 0 0 2px rgba(6,9,11,.72), 0 0 10px var(--iv-tone); }
.iv-pill { display:flex; flex-direction:column; line-height:1.18; padding:3px 7px; border-radius:5px;
  background:rgba(10,14,17,.80); border:1px solid rgba(232,220,196,.16); backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px); white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,.45); }
.iv-pill b { font:600 11px/1.2 var(--f-ui, system-ui); color:#f2ebdc; letter-spacing:.01em; }
.iv-pill em { font:400 10px/1.2 var(--f-num, ui-monospace); color:var(--iv-tone); font-style:normal; }
.iv-mark[data-tone="sea"]   { --iv-tone:#3fb6c4; }
.iv-mark[data-tone="sun"]   { --iv-tone:#f0b429; }
.iv-mark[data-tone="coral"] { --iv-tone:#e2725b; }
.iv-mark[data-tone="leaf"]  { --iv-tone:#8fbf5a; }
.iv-mark[data-tone="heath"] { --iv-tone:#b48ac4; }
.iv-mark[data-tone="iron"]  { --iv-tone:#8c99a3; }
.iv-mark[data-tone="sand"]  { --iv-tone:#e8dcc4; }
@keyframes iv-pop { from { opacity:0; } to { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .iv-mark { animation:none; } }
`;
  document.head.appendChild(s);
}
