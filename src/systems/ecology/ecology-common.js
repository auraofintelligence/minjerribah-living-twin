// Shared substrate for the seven ecology systems. Pure functions and cached read-only fields.
//
// THIS IS NOT A SYSTEM. It exports nothing beginning with `register`, it is not in the manifest,
// it holds no simulation state and it never writes to world.state. The contract's rule is that
// systems never import one another, because a system's tick order and its published read model
// are the coupling that has to stay visible. A lookup table of month names and a cached copy of
// the island sampled at 256 m is neither of those. The alternative was seven copies of the same
// grid builder, which is seven chances to sample the island slightly differently and then spend
// a day working out why the koalas and the fire live on different islands.
//
// Everything here is derived from world.island, world.data and world.clock, so it is
// deterministic and identical between two runs of the same seed. The one piece of state it does
// hold, the lever override map, is keyed per world and only ever written from a bus intent.

/* ------------------------------------------------------------------ small maths */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Shortest signed difference between two bearings, in degrees. */
export function bearingDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}
/**
 * How squarely a wind or swell is running onto a shore. `fromDeg` is the direction it comes from,
 * which is the convention both the weather system and every forecast use; `faceDeg` is the bearing
 * the shore looks out along. A south-easterly swell from 105 degrees onto an east-facing beach at
 * 90 degrees returns 0.97, and a cold westerly off the land returns a negative number.
 */
export function onshoreComponent(fromDeg, faceDeg) {
  return Math.cos((bearingDelta(faceDeg, fromDeg) * Math.PI) / 180);
}

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Read one of the pack's twelve-month `seasonal_activity` tables as a continuous curve.
 * The packs give a value per month; an animal does not step from 0.4 to 0.9 at midnight on the
 * first, so this interpolates through the month centres with a cosine so the curve is smooth
 * where it turns. Pass the clock, get today's value.
 */
export function seasonal(table, clock) {
  if (!table) return 0;
  const m = clock.month;
  const days = MONTH_DAYS[m];
  // Position within the month, measured from its centre: -0.5 at the first, +0.5 at the last.
  const f = (clock.dayOfMonth - 1 + clock.dayFraction) / days - 0.5;
  const a = table[MONTH_KEYS[m]] ?? 0;
  const nb = f >= 0 ? (m + 1) % 12 : (m + 11) % 12;
  const b = table[MONTH_KEYS[nb]] ?? a;
  const t = Math.abs(f);
  return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t));
}

/** Days between the clock's current date and an ISO date, positive when the date is in the past. */
export function daysSinceISO(clock, iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return (clock.epochDay + clock.dayIndex) - Math.floor(d.getTime() / 86400000);
}

/** Absolute simulation day number, for anything that needs a monotonic day counter. */
export function absDay(clock) { return clock.epochDay + clock.dayIndex; }

/* ------------------------------------------------------------------ the ecology grid

A 256 m sampling of the island: 6.55 hectares a cell, about nineteen thousand cells over the whole
domain and about four and a half thousand of them on land. Every ecology system that needs to hold
a value per place holds it in a Float32Array indexed the same way, which is what lets the fire
scar, the koala range, the weed front and the fuel load all mean the same square of ground. */

export const ECO_CELL = 256;
export const ECO_CELL_HA = (ECO_CELL * ECO_CELL) / 10000;

const gridCache = new WeakMap();

/** @returns the cached 256 m sampling of the island. Read only: do not write to the arrays. */
export function ecoGrid(world) {
  let g = gridCache.get(world);
  if (g) return g;

  const island = world.island;
  if (!island || typeof island.height !== 'function') {
    g = { ready: false, nx: 0, nz: 0, n: 0, land: [], note: 'no island' };
    gridCache.set(world, g);
    return g;
  }

  const d = island.domain;
  const x0 = d.minX, z0 = d.minZ;
  const nx = Math.floor((d.maxX - d.minX) / ECO_CELL) + 1;
  const nz = Math.floor((d.maxZ - d.minZ) / ECO_CELL) + 1;
  const n = nx * nz;

  const height = new Float32Array(n);
  const cover = new Uint8Array(n);
  const shore = new Float32Array(n);
  const bay = new Uint8Array(n);
  const slopeDeg = new Float32Array(n);
  const isLand = new Uint8Array(n);
  const land = [];

  const sea = island.seaLevel;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * ECO_CELL;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * ECO_CELL;
      const h = island.height(x, z);
      height[k] = h;
      cover[k] = island.landCoverIndex(x, z);
      shore[k] = island.shoreDistance(x, z);
      bay[k] = Math.round(island.bayness(x, z) * 255);
      slopeDeg[k] = (island.slope(x, z) * 180) / Math.PI;
      if (h > sea) { isLand[k] = 1; land.push(k); }
    }
  }

  const covers = island.grid ? island.grid.covers : [];
  g = {
    ready: true,
    cell: ECO_CELL, cellHa: ECO_CELL_HA,
    x0, z0, nx, nz, n,
    height, cover, shore, bay, slopeDeg, isLand,
    land: Int32Array.from(land),
    covers,
    seaLevel: sea,
    xOf: (k) => x0 + (k % nx) * ECO_CELL,
    zOf: (k) => z0 + Math.floor(k / nx) * ECO_CELL,
    /** Cell index for a world position, clamped to the domain. */
    at(x, z) {
      let i = Math.round((x - x0) / ECO_CELL), j = Math.round((z - z0) / ECO_CELL);
      if (i < 0) i = 0; else if (i > nx - 1) i = nx - 1;
      if (j < 0) j = 0; else if (j > nz - 1) j = nz - 1;
      return j * nx + i;
    },
    coverOf(k) { return covers[cover[k]] || 'water'; }
  };
  gridCache.set(world, g);
  return g;
}

/** Call `fn(cellIndex, distanceM)` for every grid cell whose centre is within `r` of (x, z). */
export function cellsWithin(g, x, z, r, fn) {
  if (!g.ready) return;
  const c = g.cell;
  const i0 = Math.max(0, Math.floor((x - r - g.x0) / c));
  const i1 = Math.min(g.nx - 1, Math.ceil((x + r - g.x0) / c));
  const j0 = Math.max(0, Math.floor((z - r - g.z0) / c));
  const j1 = Math.min(g.nz - 1, Math.ceil((z + r - g.z0) / c));
  const r2 = r * r;
  for (let j = j0; j <= j1; j++) {
    const cz = g.z0 + j * c;
    const dz = cz - z;
    for (let i = i0; i <= i1; i++) {
      const cx = g.x0 + i * c;
      const dx = cx - x;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      fn(j * g.nx + i, Math.sqrt(d2));
    }
  }
}

/**
 * Two-pass chamfer distance over the ecology grid, in metres. `seed` returns true for cells the
 * distance is measured from. Approximate to within a few per cent of Euclidean, which is far
 * inside the resolution of anything that uses it.
 */
export function distanceField(g, seed) {
  const out = new Float32Array(g.n);
  const BIG = 1e7;
  const nx = g.nx, nz = g.nz;
  for (let k = 0; k < g.n; k++) out[k] = seed(k) ? 0 : BIG;
  const a = g.cell, b = g.cell * 1.41421356;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = out[k];
      if (i > 0 && out[k - 1] + a < v) v = out[k - 1] + a;
      if (j > 0) {
        if (out[k - nx] + a < v) v = out[k - nx] + a;
        if (i > 0 && out[k - nx - 1] + b < v) v = out[k - nx - 1] + b;
        if (i < nx - 1 && out[k - nx + 1] + b < v) v = out[k - nx + 1] + b;
      }
      out[k] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = out[k];
      if (i < nx - 1 && out[k + 1] + a < v) v = out[k + 1] + a;
      if (j < nz - 1) {
        if (out[k + nx] + a < v) v = out[k + nx] + a;
        if (i < nx - 1 && out[k + nx + 1] + b < v) v = out[k + nx + 1] + b;
        if (i > 0 && out[k + nx - 1] + b < v) v = out[k + nx - 1] + b;
      }
      out[k] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ places and roads */

const placeCache = new WeakMap();

/**
 * data/places.json, projected once into local metres and keyed by id. Never invent a place:
 * if the id is not in the pack this returns null and the caller writes a note saying so.
 */
export function places(world) {
  let p = placeCache.get(world);
  if (p) return p;
  p = new Map();
  const list = (world.data && world.data.places && world.data.places.places) || [];
  const island = world.island;
  for (const q of list) {
    if (!Number.isFinite(q.lon) || !Number.isFinite(q.lat) || !island) continue;
    const xz = island.project(q.lon, q.lat);
    p.set(q.id, {
      id: q.id, name: q.name, type: q.type, lon: q.lon, lat: q.lat,
      x: xz.x, z: xz.z, y: island.height(xz.x, xz.z),
      altName: (q.alt_names && q.alt_names[0] && q.alt_names[0].name) || null
    });
  }
  placeCache.set(world, p);
  return p;
}

/** Look up one place. Returns null rather than a guess when the pack does not carry it. */
export function place(world, id) { return places(world).get(id) || null; }

const roadCache = new WeakMap();

/**
 * The road network as line segments in a 256 m bin index, so "did this animal cross a road"
 * is an exact test against a handful of candidates rather than a scan of the whole island.
 * Reads the roadNetwork read model, which src/render/layers/roads.js publishes at registration
 * and which therefore exists headless. Returns a null-shaped object if roads are not loaded.
 */
export function roadIndex(world) {
  let r = roadCache.get(world);
  if (r) return r;
  const net = world.read('roadNetwork');
  const g = ecoGrid(world);
  r = { ready: false, segs: [], bins: null, note: 'no road network published' };
  if (net && Array.isArray(net.edges) && net.edges.length && g.ready) {
    const segs = [];
    for (const e of net.edges) {
      const pts = e.pts;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({
          ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1],
          name: e.name, cls: e.cls, sealed: !!e.sealed, speed: e.speedKmh || 40,
          roadId: e.roadId, tideDependent: !!e.tideDependent
        });
      }
    }
    // Bin each segment into every grid cell it passes through, plus a one-cell skirt.
    const bins = new Map();
    const put = (k, idx) => {
      let a = bins.get(k);
      if (!a) bins.set(k, (a = []));
      if (a[a.length - 1] !== idx) a.push(idx);
    };
    for (let s = 0; s < segs.length; s++) {
      const sg = segs[s];
      const len = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az);
      const steps = Math.max(1, Math.ceil(len / (ECO_CELL * 0.5)));
      for (let t = 0; t <= steps; t++) {
        const f = t / steps;
        const x = sg.ax + (sg.bx - sg.ax) * f, z = sg.az + (sg.bz - sg.az) * f;
        const i = Math.round((x - g.x0) / ECO_CELL), j = Math.round((z - g.z0) / ECO_CELL);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
            put(jj * g.nx + ii, s);
          }
        }
      }
    }
    r = {
      ready: true, segs, bins, note: segs.length + ' road segments indexed',
      /** Segments whose bin covers this point. */
      near(x, z) {
        const k = g.at(x, z);
        return bins.get(k) || EMPTY;
      },
      /**
       * Does the move from (ax, az) to (bx, bz) cross a road, and if so which one.
       * Returns the segment, or null.
       */
      crossing(ax, az, bx, bz) {
        const cand = this.near((ax + bx) * 0.5, (az + bz) * 0.5);
        for (let i = 0; i < cand.length; i++) {
          const s = segs[cand[i]];
          if (segmentsCross(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return s;
        }
        return null;
      },
      /** Nearest road segment and its distance, searching outward one ring at a time. */
      nearest(x, z, maxRings = 3) {
        const ci = Math.round((x - g.x0) / ECO_CELL), cj = Math.round((z - g.z0) / ECO_CELL);
        let best = null, bd = Infinity;
        for (let ring = 0; ring <= maxRings; ring++) {
          for (let dj = -ring; dj <= ring; dj++) {
            for (let di = -ring; di <= ring; di++) {
              if (ring > 0 && Math.abs(di) !== ring && Math.abs(dj) !== ring) continue;
              const ii = ci + di, jj = cj + dj;
              if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
              const list = bins.get(jj * g.nx + ii);
              if (!list) continue;
              for (let q = 0; q < list.length; q++) {
                const s = segs[list[q]];
                const d = pointSegDistance(x, z, s.ax, s.az, s.bx, s.bz);
                if (d < bd) { bd = d; best = s; }
              }
            }
          }
          if (best && bd < ring * ECO_CELL) break;
        }
        return best ? { seg: best, distanceM: bd } : null;
      }
    };
  }
  roadCache.set(world, r);
  return r;
}

const EMPTY = [];

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function cross(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}
export function pointSegDistance(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - ax - vx * t, dz = pz - az - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}

/* ------------------------------------------------------------------ the east coast line

Where the open ocean shore actually is, sampled off the heightfield rather than assumed. The whale
corridors, the dune reaches and the turtle beaches all want the same answer to "how far east does
the land go at this latitude", and taking it from the terrain means they agree with the island
that is drawn rather than with a line somebody typed. */

const coastCache = new WeakMap();

export function eastCoast(world) {
  let c = coastCache.get(world);
  if (c) return c;
  const g = ecoGrid(world);
  const island = world.island;
  const out = { ready: false, z0: 0, dz: 0, n: 0, x: null };
  if (g.ready && island) {
    const dz = 512;
    const zStart = island.bounds.minZ - 1000;
    const zEnd = island.bounds.maxZ + 1000;
    const n = Math.floor((zEnd - zStart) / dz) + 1;
    const x = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const z = zStart + j * dz;
      let found = island.bounds.maxX;
      // Walk in from well offshore until the ground comes up out of the water.
      for (let xx = island.bounds.maxX + 3000; xx > island.bounds.minX; xx -= 64) {
        if (island.height(xx, z) > island.seaLevel) { found = xx; break; }
      }
      x[j] = found;
    }
    out.ready = true; out.z0 = zStart; out.dz = dz; out.n = n; out.x = x;
    out.at = (z) => {
      let f = (z - zStart) / dz;
      if (f < 0) f = 0; else if (f > n - 1.001) f = n - 1.001;
      const i = f | 0, t = f - i;
      return x[i] + (x[i + 1] - x[i]) * t;
    };
  } else {
    out.at = () => 0;
  }
  coastCache.set(world, out);
  return out;
}

/* ------------------------------------------------------------------ civic levers

The ecology systems respond to policy. data/civic.json carries sixty-two levers with a `status`,
and the honest default is the island as it is now: a lever marked `in_place` is running, a lever
marked `funded` is half delivered, everything else is off. When src/systems/civic/policy.js lands
and publishes a read model, that wins. Until then this reads the pack, so the ecology behaves like
the real island rather than like an island with no management at all.

A player or a UI panel moves a lever by emitting `ui:intent` with
`{ kind: 'policy:set', lever: '<id>', level: 0..1 }`. */

const leverCache = new WeakMap();

export function levers(world) {
  let L = leverCache.get(world);
  if (L) return L;

  const defaults = new Map();
  const meta = new Map();
  const packLevers = (world.data && world.data.civic && world.data.civic.levers) || [];
  for (const l of packLevers) {
    const base = l.status === 'in_place' ? 1 : l.status === 'funded' ? 0.5 : 0;
    defaults.set(l.id, base);
    meta.set(l.id, { id: l.id, name: l.name, issue: l.issue, status: l.status });
  }
  const overrides = new Map();

  /**
   * The civic policy system, when it is loaded, publishes each lever with a `level` that is a
   * change from the status quo (-1 ceased, 0 as it is now, +1 the pack's described change) and a
   * `progress` that is how much of that change has been delivered. Ecology wants a plain 0 to 1
   * "how hard is this running", so the two are reconciled here rather than in seven places.
   */
  function fromPolicy(id, base) {
    const p = world.read('policy');
    if (!p) return null;
    if (typeof p.level === 'function') { const v = p.level(id); if (Number.isFinite(v)) return clamp(v, 0, 1); }
    if (p.levels && Number.isFinite(p.levels[id])) return clamp(p.levels[id], 0, 1);
    const rt = p.levers && p.levers[id];
    if (!rt) return Array.isArray(p.active) ? (p.active.includes(id) ? 1 : base) : null;
    const progress = Number.isFinite(rt.progress) ? clamp(rt.progress, 0, 1) : 1;
    if (rt.status === 'lapsed') return clamp(base * (1 - progress * 0.85), 0, 1);
    if (rt.level > 0) return clamp(base + (1 - base) * progress, 0, 1);
    if (rt.level < 0) return clamp(base * (1 - progress), 0, 1);
    return base;
  }

  L = {
    source: packLevers.length
      ? 'data/civic.json levers, status in_place treated as running; the policy system overrides it when loaded'
      : 'no civic pack: every lever reads as off',
    count: packLevers.length,
    /** 0 is off, 1 is fully running. Unknown ids return `fallback`. */
    level(id, fallback = 0) {
      if (overrides.has(id)) return overrides.get(id);
      const base = defaults.has(id) ? defaults.get(id) : fallback;
      const v = fromPolicy(id, base);
      return v === null ? base : v;
    },
    /**
     * For a lever whose pack status is `in_place`, the pack is saying the programme exists, not
     * how hard it is being run. `dial` reads the same chain but substitutes a stated running level
     * for that case, so a system can say "the burn programme exists and this is the extent I am
     * modelling it at" without pretending the pack published an extent.
     */
    dial(id, inPlaceValue) {
      if (overrides.has(id)) return overrides.get(id);
      const m = meta.get(id);
      const base = m && m.status === 'in_place' ? clamp(inPlaceValue, 0, 1)
        : (defaults.has(id) ? defaults.get(id) : 0);
      const v = fromPolicy(id, base);
      return v === null ? base : v;
    },
    set(id, v) { overrides.set(id, clamp(v, 0, 1)); },
    meta(id) { return meta.get(id) || null; },
    /** Everything the ecology currently cares about, for a panel or a probe. */
    snapshot(ids) {
      const out = {};
      for (const id of ids) out[id] = +this.level(id).toFixed(2);
      return out;
    }
  };

  world.bus.on('ui:intent', (p) => {
    if (!p || p.kind !== 'policy:set' || !p.lever) return;
    L.set(p.lever, Number.isFinite(p.level) ? p.level : (p.on ? 1 : 0));
    world.bus.emit('policy:changed', { lever: p.lever, level: L.level(p.lever), by: 'ui' });
  });

  leverCache.set(world, L);
  return L;
}

/* ------------------------------------------------------------------ shared pressure reads

Three numbers nearly every ecology system needs, computed the same way in all of them so a
player who learns what "visitor pressure" means in the shorebird panel is not learning a
different quantity in the dune panel. */

/** People on the island right now, resident plus visiting, and how far past normal that is. */
export function humanLoad(world) {
  const vis = world.read('visitors');
  const pop = world.read('population');
  const residents = (pop && pop.residents) || 2065;
  const onIsland = (vis && vis.onIsland) || 0;
  return {
    residents,
    visitors: onIsland,
    total: residents + onIsland,
    pressure: onIsland / Math.max(1, residents),
    byTownship: (vis && vis.byTownship) || {},
    holiday: !!(world.clock.isQldSchoolHoliday || world.clock.isWeekend)
  };
}

/**
 * Dogs likely to be loose at a given place, per day. There is no published island dog register in
 * the packs, so this is a modelled rate and says so: a share of households with a dog, a share of
 * visiting parties with a dog, and a compliance rate the dog control lever moves.
 */
export function dogPressure(world, townshipShare = 1) {
  const L = levers(world);
  const h = humanLoad(world);
  const households = Math.max(1, Math.round(h.residents / 2.1));
  const residentDogs = households * 0.38 * townshipShare;
  const visitorDogs = (h.visitors / 3.2) * 0.14 * townshipShare;
  // Enforcement moves compliance, it does not create it. Baseline compliance is modelled.
  const enforcement = L.level('dog-control-enforcement');
  const compliance = clamp(0.55 + 0.32 * enforcement, 0, 0.97);
  return {
    dogs: residentDogs + visitorDogs,
    compliance,
    roaming: (residentDogs + visitorDogs) * (1 - compliance),
    basis: 'modelled: no island dog register is in the packs. 0.38 dogs a household, '
      + '0.14 a visiting party, compliance moved by the dog-control-enforcement lever.'
  };
}

/** A 0..1 metric formatted the way data/civic.json metrics expect. */
export function metric(v) { return +clamp(v, 0, 1).toFixed(3); }

/* ------------------------------------------------------------------ rolling counters */

/** A ring of daily counts, for "this year" numbers that do not need a year of history in memory. */
export class DailyRing {
  constructor(days = 365) {
    this.days = days;
    this.buf = new Float64Array(days);
    this.i = 0;
    this.sum = 0;
    this.filled = 0;
  }
  add(v) { this.buf[this.i] += v; this.sum += v; }
  roll() {
    this.i = (this.i + 1) % this.days;
    this.sum -= this.buf[this.i];
    this.buf[this.i] = 0;
    if (this.filled < this.days) this.filled++;
  }
  get total() { return this.sum; }
  get today() { return this.buf[this.i]; }
  save() { return { i: this.i, sum: this.sum, filled: this.filled, buf: Array.from(this.buf) }; }
  load(s) {
    if (!s) return;
    this.i = s.i; this.sum = s.sum; this.filled = s.filled;
    this.buf = Float64Array.from(s.buf || []);
    if (this.buf.length !== this.days) { const b = new Float64Array(this.days); b.set(this.buf.subarray(0, this.days)); this.buf = b; }
  }
}

/** Fixed-length list of recent notable events, newest first. Used by every ecology panel. */
export class EventLog {
  constructor(max = 40) { this.max = max; this.items = []; }
  push(item) {
    this.items.unshift(item);
    if (this.items.length > this.max) this.items.length = this.max;
  }
  recent(n = 8) { return this.items.slice(0, n); }
  save() { return this.items.slice(0, this.max); }
  load(s) { this.items = Array.isArray(s) ? s.slice(0, this.max) : []; }
}
