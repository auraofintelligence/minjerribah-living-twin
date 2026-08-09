// The island itself. Pure data and maths: no Babylon, no DOM, runs headless in Node.
// Everything else in this project stands on what this file returns, so it is deliberately
// conservative: it shapes itself to data/geography.json rather than to an idea of an island.
//
// What Minjerribah actually is, and what the heightfield has to get right:
//
//   * It is the second largest sand island in the world and it is sand nearly all the way down.
//     The only rock is the volcanic headland at Point Lookout (Mooloomba) in the north east,
//     roughly 30 to 60 m, with the Gorge cut into it. Everything else is dune.
//   * The eastern half is an old, high, vegetated dune field. The interior ridges run to about
//     200 to 240 m, which is the whole geological story: wind and swell built a mountain range
//     out of quartz sand over hundreds of thousands of years. data/geography.json gives eight
//     gazetted peaks, the highest being Mount Hardgrave at 228 m, and a published island
//     maximum of 239 m that is not tied to a named summit in any source found.
//   * The western side, Dunwich (Goompi) north to Amity Point (Pulan), is low and flat and
//     slides into Moreton Bay under wide intertidal sand flats that dry on a low tide.
//   * Eighteen Mile Swamp runs behind the ocean beach for most of the island's length at close
//     to sea level, backed by the high dunes. It is one of the largest coastal wallum swamps.
//   * Blue Lake (Kaboora) sits at 72 m and Brown Lake (Bummiera) at 62 m. They are lakes on top
//     of a sand mountain, and if they render at sea level the island is a lie.
//   * The southern end runs out into the shifting sand of Jumpinpin.
//
// Datum. Heights are metres above LAT (lowest astronomical tide), the same datum
// src/systems/environment/tide.js uses, because the ocean layer compares terrain height with
// tide height directly. Mean sea level sits at MEAN_SEA_LEVEL (1.02 m) on that datum, so an
// elevation published as "9 m above sea level" is stored here as about 10 m. Every published
// figure quoted in a comment is above sea level; every number in the arrays is above LAT.
//
// Determinism. All noise comes from world.rng.stream('island'). No Math.random, no Date.now.

import { makeNoise2D } from '../kernel/rng.js';

/* ------------------------------------------------------------------ projection

Local ENU metres: +x east, +z north, one unit one metre, origin near the middle of the island.
These are the same three constants src/render/camera.js and src/render/layers/ocean.js already
use, and they must stay the same, because a layer that projects differently draws a different
island. Plate carree with a fixed scale is accurate to well under a metre over 40 km. */

export const ISLAND_ORIGIN = { lon: 153.47, lat: -27.56 };
const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LON = 98683; // 111320 * cos(27.56 deg)

/** Mean sea level in metres above LAT. Matches MEAN_LEVEL in the tide system. */
export const MEAN_SEA_LEVEL = 1.02;

/* ------------------------------------------------------------------ the sampling grid

32 m nodes, covering the island plus enough sea for the ocean layer to bake its seabed and its
wave travel-time field off the same heights. That box is x -16512..12544, z -20608..21440. */

const CELL = 32;
const INV_CELL = 1 / CELL;
const GRID_X0 = -16512;
const GRID_Z0 = -20608;
const GRID_NX = 908;
const GRID_NZ = 1314;

/** Mask and horizon grids are coarser: they carry soft fields, not the surface. */
const MASK_CELL = 64;
const REGION_CELL = 128;

/** Land cover classes, in the order landCover() returns them. Index 0 is below the beach. */
export const COVERS = [
  'water',      // subtidal: seabed below about a metre under the low-water mark
  'beach',      // sand between the water and the first dune, including the wet intertidal
  'foredune',   // the sand-bound frontal dune, spinifex and goat's foot
  'heath',      // wallum heath on the older sand plains
  'forest',     // eucalypt forest and woodland on the high ridges
  'swamp',      // wallum swamp and sedgeland, Eighteen Mile Swamp above all
  'lake',       // the perched and window lakes
  'rock',       // Point Lookout: the only rock on the island
  'saltmarsh',  // above the mangroves on the bay side
  'mangrove',   // the western intertidal shore
  'cleared',    // mown, grazed or kept open ground around the townships
  'urban',      // built up
  'rehab'       // the mine path rehabilitation areas
];
const C = {};
for (let i = 0; i < COVERS.length; i++) C[COVERS[i]] = i;

/* Which shore a point is nearest, which decides its beach, its dune and its seabed.
   The index ranges come from the landmark indices published in data/geography.json:
   0 Point Lookout headland, 20 South Gorge, 39 Main Beach north end, 79 Jumpinpin,
   182 Dunwich, 192 One Mile, 205 Myora, 226 Amity Point, 261 Flinders access 3,
   263 Adder Rock, 268 Home Beach, 278 Cylinder, 290 Deadmans, 301 Frenchmans. */
const SHORE = { ROCK: 0, OCEAN: 1, PIN: 2, BAY: 3, NORTH: 4, POCKET: 5 };
const SHORE_RANGES = [
  [0, 39, SHORE.ROCK],     // the headland and the Gorge
  [39, 79, SHORE.OCEAN],   // Main Beach, thirty-two kilometres of open swell
  [79, 112, SHORE.PIN],    // Jumpinpin and the southern sand
  [112, 226, SHORE.BAY],   // the western shore, Swan Bay up to Amity Point
  [226, 258, SHORE.NORTH], // Amity round to Flinders Beach
  [258, 303, SHORE.POCKET],// Adder Rock, Home, Cylinder, Deadmans, Frenchmans
  [303, 336, SHORE.ROCK]
];
/** How much this shore reads as Moreton Bay rather than the Pacific. Drives water colour,
 *  mangrove and saltmarsh placement, and the flat, banked, tide-drying seabed. */
const SHORE_BAYNESS = [0.0, 0.0, 0.85, 1.0, 0.65, 0.0];

/* Deep channels. Real, named, published features that the bay needs or the ferries have nowhere
   to run. The centrelines are the same coarse approximations already carried in
   src/render/layers/ocean.js, so the two layers agree; they are not survey lines. */
const CHANNELS = [
  { name: 'Rous Channel', depth: 17.0, half: 900,
    pts: [[-11500, 21200], [-5200, 20000], [800, 19000], [7200, 18300]] },
  { name: 'Rainbow Channel', depth: 10.5, half: 620,
    pts: [[-10200, 3200], [-9600, 7600], [-8600, 11800], [-7200, 15600]] },
  { name: 'Canaipa Passage', depth: 7.5, half: 500,
    pts: [[-8600, -18600], [-8000, -14000], [-8200, -9000], [-9000, -4000]] }
];
for (const ch of CHANNELS) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of ch.pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  const pad = ch.half * 2.5;
  ch.bb = [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
}

/* ------------------------------------------------------------------ small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Catmull-Rom weight set, for sampling the 800 m elevation lattice without diamond artefacts. */
function cubic(p0, p1, p2, p3, t) {
  const a = 2 * p1;
  const b = p2 - p0;
  const c = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const d = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (a + b * t + c * t * t + d * t * t * t);
}

/* ------------------------------------------------------------------ the island */

export class Island {
  constructor(world) {
    const t0 = nowMs();
    this.world = world;
    this.notes = [];
    this.cellM = CELL;
    this.seaLevel = MEAN_SEA_LEVEL;
    this.datum = 'metres above LAT; mean sea level is ' + MEAN_SEA_LEVEL + ' m on this datum';
    this.origin = { lon: ISLAND_ORIGIN.lon, lat: ISLAND_ORIGIN.lat };

    const geo = (world && world.data && world.data.geography) || null;
    this.source = geo && geo.pack === 'geography' ? 'data/geography.json ' + geo.version : 'missing';

    // A named stream, never Math.random. Two noise fields: one for the dune grain, one for the
    // fine relief, so changing one does not reshuffle the other.
    const rng = (world && world.rng ? world.rng.stream('island') : { int: () => 12345 });
    this.noise = makeNoise2D(rng.int(1, 0x7ffffffe));
    this.noiseFine = makeNoise2D(rng.int(1, 0x7ffffffe));

    this.nx = GRID_NX; this.nz = GRID_NZ;
    this.x0 = GRID_X0; this.z0 = GRID_Z0;
    this._fxMax = GRID_NX - 1.0001; this._fzMax = GRID_NZ - 1.0001;
    this.x1 = GRID_X0 + (GRID_NX - 1) * CELL;
    this.z1 = GRID_Z0 + (GRID_NZ - 1) * CELL;

    const n = GRID_NX * GRID_NZ;
    this.h = new Float32Array(n);
    this.sd = new Float32Array(n);
    this.cover = new Uint8Array(n);
    this.bay = new Uint8Array(n);

    this.lakes = [];
    this.peaks = [];
    this.regionNames = ['Minjerribah'];

    if (!geo || !geo.coastline || !Array.isArray(geo.coastline.coordinates)) {
      this.ready = false;
      this.notes.push('data/geography.json is missing or has no coastline: the island is flat sea.');
      this.h.fill(-6);
      this.sd.fill(-9999);
      this.cover.fill(C.water);
      this.bay.fill(128);
      this._finishBounds();
      this.buildMs = nowMs() - t0;
      return;
    }

    this._readPacks(geo, world.data.places);
    this._buildShoreField();
    this._buildRegional();
    this._buildMasks();
    this._bakeHeights();
    this._bakeCover();
    this._bakeRegions();
    this._finishBounds();
    this.ready = true;
    this.buildMs = nowMs() - t0;
  }

  /* ---------------------------------------------------------------- projection */

  /** Longitude and latitude to local metres. */
  project(lon, lat) {
    return { x: (lon - ISLAND_ORIGIN.lon) * M_PER_DEG_LON, z: (lat - ISLAND_ORIGIN.lat) * M_PER_DEG_LAT };
  }
  /** Local metres back to longitude and latitude. */
  unproject(x, z) {
    return { lon: ISLAND_ORIGIN.lon + x / M_PER_DEG_LON, lat: ISLAND_ORIGIN.lat + z / M_PER_DEG_LAT };
  }
  // The camera rig looks for these names.
  toLocal(lon, lat) { return this.project(lon, lat); }
  toLonLat(x, z) { return this.unproject(x, z); }

  /* ---------------------------------------------------------------- sampling */

  /**
   * Ground height in metres above LAT. Bilinear, no allocation, safe anywhere, and the hottest
   * function in the project: crowds, vehicles, flora placement and the camera all call it.
   * Around 20 ns a call with coherent access, so 200k calls fit inside a frame.
   */
  height(x, z) {
    const H = this.h, nx = this.nx;
    let fx = (x - this.x0) * INV_CELL;
    let fz = (z - this.z0) * INV_CELL;
    if (!(fx >= 0)) fx = 0; else if (fx > this._fxMax) fx = this._fxMax;
    if (!(fz >= 0)) fz = 0; else if (fz > this._fzMax) fz = this._fzMax;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const k = j * nx + i;
    const a = H[k], b = H[k + 1], c = H[k + nx], d = H[k + nx + 1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * tz;
  }

  heightAt(lon, lat) {
    return this.height((lon - ISLAND_ORIGIN.lon) * M_PER_DEG_LON, (lat - ISLAND_ORIGIN.lat) * M_PER_DEG_LAT);
  }

  /** Unit surface normal. Pass `out` in a hot loop to avoid the allocation. */
  normal(x, z, out) {
    const e = CELL;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nxv = -hx, nzv = -hz, nyv = 2 * e;
    const inv = 1 / Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv);
    const o = out || { x: 0, y: 0, z: 0 };
    o.x = nxv * inv; o.y = nyv * inv; o.z = nzv * inv;
    return o;
  }

  /** Slope in radians, 0 flat. */
  slope(x, z) {
    const e = CELL;
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.atan(Math.sqrt(hx * hx + hz * hz));
  }

  /** Above mean sea level. A lake bed at 66 m is land; the yabby banks at low tide are not. */
  isLand(x, z) { return this.height(x, z) > MEAN_SEA_LEVEL; }

  /** Metres of water above the seabed at mean sea level. Zero on land. */
  waterDepth(x, z) {
    const d = MEAN_SEA_LEVEL - this.height(x, z);
    return d > 0 ? d : 0;
  }

  /** Distance to the coastline in metres, positive inland. Useful for beach and dune logic. */
  shoreDistance(x, z) { return this._sampleF32(this.sd, x, z); }

  /** 0 on the Pacific side, 1 on the Moreton Bay side. */
  bayness(x, z) { return this._sampleU8(this.bay, x, z) / 255; }

  landCover(x, z) { return COVERS[this._nearestU8(this.cover, x, z)]; }
  landCoverIndex(x, z) { return this._nearestU8(this.cover, x, z); }

  /** Named region, township or park. */
  regionAt(x, z) {
    const g = this.regionGrid;
    if (!g) return 'Minjerribah';
    let i = Math.round((x - this.rx0) / REGION_CELL);
    let j = Math.round((z - this.rz0) / REGION_CELL);
    i = clamp(i, 0, this.rnx - 1); j = clamp(j, 0, this.rnz - 1);
    return this.regionNames[g[j * this.rnx + i]] || 'Minjerribah';
  }

  /**
   * March a ray against the heightfield. `origin` and `dir` are anything with x, y, z, so a
   * Babylon Vector3 works. Returns null for a miss, otherwise a hit record. Used for camera
   * collision, for picking, and by anything that needs to know what is under a point on screen.
   */
  raycast(origin, dir, maxDistance = 60000, out) {
    const ox = origin.x, oy = origin.y, oz = origin.z;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 0)) return null;
    dx /= dl; dy /= dl; dz /= dl;

    let t = 0;
    let prevT = 0;
    let prevGap = oy - this.height(ox, oz);
    if (prevGap < 0) {
      // Started underground: report the surface directly above, which is what a camera wants.
      const r = out || {};
      r.hit = true; r.x = ox; r.y = this.height(ox, oz); r.z = oz;
      r.distance = 0; r.inside = true;
      r.normal = this.normal(ox, oz);
      r.cover = this.landCover(ox, oz);
      return r;
    }
    const maxY = this.maxY + 10;
    while (t < maxDistance) {
      // Step longer when far from the surface and when high above the highest ground.
      const y = oy + dy * t;
      if (dy > 0 && y > maxY) return null;
      const step = clamp(Math.max(prevGap * 0.7, CELL * 0.5), CELL * 0.5, 260);
      t += step;
      const x = ox + dx * t, zz = oz + dz * t;
      const gap = oy + dy * t - this.height(x, zz);
      if (gap <= 0) {
        // Bisect between the last two samples for a clean intersection.
        let lo = prevT, hi = t;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) * 0.5;
          const g = oy + dy * mid - this.height(ox + dx * mid, oz + dz * mid);
          if (g > 0) lo = mid; else hi = mid;
        }
        const hx = ox + dx * hi, hz = oz + dz * hi;
        const r = out || {};
        r.hit = true; r.x = hx; r.y = this.height(hx, hz); r.z = hz;
        r.distance = hi; r.inside = false;
        r.normal = this.normal(hx, hz);
        r.cover = this.landCover(hx, hz);
        return r;
      }
      prevT = t; prevGap = gap;
    }
    return null;
  }

  /**
   * A downsampled view for minimaps, info views and anything that wants the whole island at once.
   * `res` is the number of samples across the x axis. Arrays are new, so the caller owns them.
   */
  sampleGrid(res = 192) {
    const nx = Math.max(8, Math.min(1024, Math.round(res)));
    const w = this.x1 - this.x0, d = this.z1 - this.z0;
    const nz = Math.max(8, Math.round(nx * (d / w)));
    const cx = w / (nx - 1), cz = d / (nz - 1);
    const height = new Float32Array(nx * nz);
    const cover = new Uint8Array(nx * nz);
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < nz; j++) {
      const z = this.z0 + j * cz;
      for (let i = 0; i < nx; i++) {
        const x = this.x0 + i * cx;
        const h = this.height(x, z);
        height[j * nx + i] = h;
        cover[j * nx + i] = this._nearestU8(this.cover, x, z);
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    return {
      nx, nz, x0: this.x0, z0: this.z0, cellX: cx, cellZ: cz,
      seaLevel: MEAN_SEA_LEVEL, minY, maxY, height, cover, covers: COVERS
    };
  }

  /* ---------------------------------------------------------------- internals */

  _sampleF32(A, x, z) {
    const nx = this.nx;
    let fx = (x - this.x0) * INV_CELL, fz = (z - this.z0) * INV_CELL;
    if (!(fx >= 0)) fx = 0; else if (fx > nx - 1.0001) fx = nx - 1.0001;
    if (!(fz >= 0)) fz = 0; else if (fz > this.nz - 1.0001) fz = this.nz - 1.0001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * nx + i;
    const a = A[k], b = A[k + 1], c = A[k + nx], d = A[k + nx + 1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * tz;
  }
  _sampleU8(A, x, z) { return this._sampleF32(A, x, z); }
  _nearestU8(A, x, z) {
    let i = Math.round((x - this.x0) * INV_CELL), j = Math.round((z - this.z0) * INV_CELL);
    i = clamp(i, 0, this.nx - 1); j = clamp(j, 0, this.nz - 1);
    return A[j * this.nx + i];
  }
  _index(x, z) {
    let i = Math.round((x - this.x0) * INV_CELL), j = Math.round((z - this.z0) * INV_CELL);
    i = clamp(i, 0, this.nx - 1); j = clamp(j, 0, this.nz - 1);
    return j * this.nx + i;
  }

  /* ---- 1. read the packs into local metres ---- */

  _readPacks(geo, places) {
    const P = (c) => [(c[0] - ISLAND_ORIGIN.lon) * M_PER_DEG_LON, (c[1] - ISLAND_ORIGIN.lat) * M_PER_DEG_LAT];
    const ring = (coords) => coords.map(P);

    this.coast = ring(geo.coastline.coordinates);
    this.coastLandmarks = (geo.coastline.landmarks || []).map((l) => ({
      name: l.name, i: l.coastline_index,
      x: this.coast[l.coastline_index] ? this.coast[l.coastline_index][0] : 0,
      z: this.coast[l.coastline_index] ? this.coast[l.coastline_index][1] : 0
    }));

    // Elevation control. Peaks are gazetted summits; the control points are shore and lake
    // levels. One of them, the Eighteen Mile Swamp floor at 45 m, is explicitly flagged in the
    // pack as canopy rather than ground, so it is read as a note and not as a height.
    this.control = [];
    for (const p of geo.elevation_points || []) {
      const xy = P(p.coordinates);
      if (/swamp/.test(p.id)) { this.notes.push('skipped ' + p.id + ': the pack flags it as canopy, not ground.'); continue; }
      const isPeak = p.type === 'peak';
      this.control.push({
        id: p.id, name: p.name, x: xy[0], z: xy[1],
        elev: p.elevation_m + MEAN_SEA_LEVEL,
        peak: isPeak,
        radius: isPeak ? 760 : 460
      });
      if (isPeak) this.peaks.push({ id: p.id, name: p.name, x: xy[0], z: xy[1], elevationM: p.elevation_m });
    }

    // The ASTER lattice: 0.008 degrees, roughly 800 m, clipped to the coastline.
    const eg = geo.elevation_grid;
    this.aster = null;
    if (eg && Array.isArray(eg.points) && eg.points.length) {
      let lon0 = Infinity, lat0 = Infinity, lon1 = -Infinity, lat1 = -Infinity;
      for (const q of eg.points) {
        if (q[0] < lon0) lon0 = q[0]; if (q[0] > lon1) lon1 = q[0];
        if (q[1] < lat0) lat0 = q[1]; if (q[1] > lat1) lat1 = q[1];
      }
      const step = eg.spacing_deg || 0.008;
      const alon = Math.round((lon1 - lon0) / step) + 1;
      const alat = Math.round((lat1 - lat0) / step) + 1;
      const grid = new Float32Array(alon * alat).fill(NaN);
      for (const q of eg.points) {
        const i = Math.round((q[0] - lon0) / step);
        const j = Math.round((q[1] - lat0) / step);
        if (i >= 0 && i < alon && j >= 0 && j < alat) grid[j * alon + i] = q[2];
      }
      this.aster = { grid, alon, alat, lon0, lat0, step };
    } else {
      this.notes.push('no elevation grid in the pack: the interior is built from the named peaks alone.');
    }

    // Water bodies. Lake surfaces are published in metres above sea level.
    this.waterPolys = { swamp: null, flats: null, lakes: [] };
    for (const w of geo.water_bodies || []) {
      const coords = Array.isArray(w.coordinates) && Array.isArray(w.coordinates[0]) ? w.coordinates : null;
      if (!coords || coords.length < 3) continue;
      const poly = ring(coords);
      if (w.type === 'wallum_swamp') this.waterPolys.swamp = poly;
      else if (w.type === 'intertidal_flat') this.waterPolys.flats = poly;
      else {
        this.waterPolys.lakes.push({
          id: w.id, name: w.name, nameQ: w.name_quandamooka || null, type: w.type, poly,
          surface: w.surface_elevation_m != null ? w.surface_elevation_m + MEAN_SEA_LEVEL : null,
          depth: w.max_depth_m || null
        });
      }
    }

    // Rehabilitation areas and parks.
    this.rehabPolys = (geo.rehabilitation_areas || [])
      .filter((r) => Array.isArray(r.coordinates) && Array.isArray(r.coordinates[0]))
      .map((r) => ring(r.coordinates));
    this.parks = (geo.protected_areas || []).map((p) => ({
      name: p.name,
      parts: (p.geometry === 'multipolygon' ? p.coordinates : [p.coordinates])
        .filter((part) => Array.isArray(part) && part.length >= 3 && Array.isArray(part[0]))
        .map(ring)
    }));

    // Roads, for the built-up mask. Streets and sealed roads only: a beach 4WD route is not town.
    this.streets = (geo.roads || [])
      .filter((r) => r.type === 'street' || r.type === 'sealed_road' || r.type === 'unsealed_road')
      .map((r) => ring(r.coordinates));

    // Townships, from data/places.json where it exists.
    const TOWN_RADIUS = { 'point-lookout': 1500, dunwich: 1500, 'amity-point': 1100 };
    this.towns = [];
    const list = (places && Array.isArray(places.places)) ? places.places : [];
    for (const p of list) {
      if (p.type !== 'township' || !Number.isFinite(p.lon)) continue;
      const xy = P([p.lon, p.lat]);
      const alt = (p.alt_names && p.alt_names[0] && p.alt_names[0].name) || null;
      this.towns.push({ id: p.id, name: alt ? `${p.name} (${alt})` : p.name, x: xy[0], z: xy[1], r: TOWN_RADIUS[p.id] || 1000 });
    }
    const oneMile = list.find((p) => p.id === 'one-mile-jetty');
    if (oneMile && Number.isFinite(oneMile.lon)) {
      const xy = P([oneMile.lon, oneMile.lat]);
      this.towns.push({ id: 'one-mile', name: 'One Mile', x: xy[0], z: xy[1], r: 800 });
    }
    if (!this.towns.length) this.notes.push('data/places.json has no townships: nothing is marked urban.');
  }

  /* ---- 2. the signed distance field and which shore is nearest ---- */

  _buildShoreField() {
    const nx = this.nx, nz = this.nz, n = nx * nz;
    const coast = this.coast, m = coast.length;

    // Class per coastline vertex, from the published landmark indices.
    const vcls = new Uint8Array(m);
    for (const [a, b, cls] of SHORE_RANGES) {
      for (let i = a; i < Math.min(b, m); i++) vcls[i] = cls;
    }

    // Inside/outside by even-odd scanline. Exact, and it costs nothing.
    const inside = new Uint8Array(n);
    const xs = new Float64Array(m);
    for (let j = 0; j < nz; j++) {
      const zw = this.z0 + j * CELL;
      let count = 0;
      for (let i = 0, k = m - 1; i < m; k = i++) {
        const zi = coast[i][1], zk = coast[k][1];
        if ((zi > zw) !== (zk > zw)) {
          xs[count++] = coast[i][0] + ((zw - zi) / (zk - zi)) * (coast[k][0] - coast[i][0]);
        }
      }
      const row = xs.subarray(0, count);
      row.sort();
      const base = j * nx;
      for (let s = 0; s + 1 < count; s += 2) {
        let i0 = Math.ceil((row[s] - this.x0) * INV_CELL);
        let i1 = Math.floor((row[s + 1] - this.x0) * INV_CELL);
        if (i1 < 0 || i0 >= nx) continue;
        if (i0 < 0) i0 = 0;
        if (i1 > nx - 1) i1 = nx - 1;
        for (let i = i0; i <= i1; i++) inside[base + i] = 1;
      }
    }

    // Exact distance in a band along the coast, seeded segment by segment.
    const dist = new Float32Array(n).fill(1e9);
    const npx = new Float32Array(n);
    const npz = new Float32Array(n);
    const ncl = new Uint8Array(n);
    const BAND = CELL * 3;
    for (let s = 0; s < m; s++) {
      const a = coast[s], b = coast[(s + 1) % m];
      const cls = vcls[s];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const L2 = vx * vx + vz * vz;
      const i0 = clamp(Math.floor((Math.min(a[0], b[0]) - BAND - this.x0) * INV_CELL), 0, nx - 1);
      const i1 = clamp(Math.ceil((Math.max(a[0], b[0]) + BAND - this.x0) * INV_CELL), 0, nx - 1);
      const j0 = clamp(Math.floor((Math.min(a[1], b[1]) - BAND - this.z0) * INV_CELL), 0, nz - 1);
      const j1 = clamp(Math.ceil((Math.max(a[1], b[1]) + BAND - this.z0) * INV_CELL), 0, nz - 1);
      for (let j = j0; j <= j1; j++) {
        const z = this.z0 + j * CELL;
        for (let i = i0; i <= i1; i++) {
          const x = this.x0 + i * CELL;
          let t = L2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a[0] + vx * t, pz = a[1] + vz * t;
          const dx = x - px, dz = z - pz;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > BAND) continue;
          const k = j * nx + i;
          if (d < dist[k]) { dist[k] = d; npx[k] = px; npz[k] = pz; ncl[k] = cls; }
        }
      }
    }

    // Dead reckoning outward, carrying the nearest coast point and its class. Distances are
    // kept squared through the sweep: one sqrt at the end instead of ten million in the middle.
    for (let k = 0; k < n; k++) if (dist[k] < 1e9) dist[k] = dist[k] * dist[k];
    const FWD = [-nx - 1, -nx, -nx + 1, -1];
    const BACK = [nx + 1, nx, nx - 1, 1];
    const gx0 = this.x0, gz0 = this.z0;
    const sweep = (offs, jFrom, jTo, jStep, iFrom, iTo, iStep) => {
      for (let j = jFrom; j !== jTo; j += jStep) {
        const z = gz0 + j * CELL;
        const base = j * nx;
        for (let i = iFrom; i !== iTo; i += iStep) {
          const k = base + i;
          const x = gx0 + i * CELL;
          let bd = dist[k], bx = npx[k], bz = npz[k], bc = ncl[k];
          for (let o = 0; o < 4; o++) {
            const s = k + offs[o];
            if (s < 0 || s >= n || dist[s] >= 1e9) continue;
            const dx = x - npx[s], dz = z - npz[s];
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; bx = npx[s]; bz = npz[s]; bc = ncl[s]; }
          }
          dist[k] = bd; npx[k] = bx; npz[k] = bz; ncl[k] = bc;
        }
      }
    };
    sweep(FWD, 1, nz, 1, 1, nx - 1, 1);
    sweep(BACK, nz - 2, -1, -1, nx - 2, 0, -1);

    for (let k = 0; k < n; k++) {
      const d = dist[k] >= 1e9 ? 40000 : Math.sqrt(dist[k]);
      this.sd[k] = inside[k] ? d : -d;
      this.bay[k] = Math.round(SHORE_BAYNESS[ncl[k]] * 255);
    }
    this._cls = ncl;
    this._inside = inside;

    // Smooth the bayness so the water colour does not step where the nearest shore changes.
    boxBlurU8(this.bay, nx, nz, 3);
  }

  /* ---- 3. the regional surface, from the 800 m lattice and the named heights ---- */

  _buildRegional() {
    const rc = 128;
    const rnx = Math.ceil((this.x1 - this.x0) / rc) + 1;
    const rnz = Math.ceil((this.z1 - this.z0) / rc) + 1;
    const reg = new Float32Array(rnx * rnz);
    this.reg = { a: reg, nx: rnx, nz: rnz, cell: rc };

    const A = this.aster;
    let lattice = null;
    if (A) {
      // Fill the holes, so a sample near the coast does not fall off the clipped edge. Cells
      // outside the coastline relax toward zero; cells inside relax toward their neighbours.
      lattice = Float32Array.from(A.grid);
      const known = new Uint8Array(lattice.length);
      for (let i = 0; i < lattice.length; i++) known[i] = Number.isNaN(lattice[i]) ? 0 : 1;
      for (let i = 0; i < lattice.length; i++) if (!known[i]) lattice[i] = 0;
      for (let pass = 0; pass < 24; pass++) {
        const next = Float32Array.from(lattice);
        for (let j = 0; j < A.alat; j++) {
          for (let i = 0; i < A.alon; i++) {
            const k = j * A.alon + i;
            if (known[k]) continue;
            let s = 0, c = 0;
            if (i > 0) { s += lattice[k - 1]; c++; }
            if (i < A.alon - 1) { s += lattice[k + 1]; c++; }
            if (j > 0) { s += lattice[k - A.alon]; c++; }
            if (j < A.alat - 1) { s += lattice[k + A.alon]; c++; }
            next[k] = c ? (s / c) * 0.72 : 0;   // decay outward: off the island there is no dune
          }
        }
        lattice.set(next);
      }
    }

    const sampleAster = (x, z) => {
      if (!A) return 0;
      const ll = this.unproject(x, z);
      const fi = (ll.lon - A.lon0) / A.step;
      const fj = (ll.lat - A.lat0) / A.step;
      const i = Math.floor(fi), j = Math.floor(fj);
      const tx = fi - i, tz = fj - j;
      const at = (ii, jj) => lattice[clamp(jj, 0, A.alat - 1) * A.alon + clamp(ii, 0, A.alon - 1)];
      const r = [];
      for (let d = -1; d <= 2; d++) {
        r.push(cubic(at(i - 1, j + d), at(i, j + d), at(i + 1, j + d), at(i + 2, j + d), tx));
      }
      return cubic(r[0], r[1], r[2], r[3], tz);
    };

    for (let j = 0; j < rnz; j++) {
      const z = this.z0 + j * rc;
      for (let i = 0; i < rnx; i++) {
        const x = this.x0 + i * rc;
        let h = sampleAster(x, z);
        // ASTER is a surface model: over eucalypt ridges and paperbark it reads the canopy, so
        // the pack's own note says it sits high by roughly the height of the trees. Take that
        // off, then put the gazetted summits back where they belong.
        h -= 13 * smoothstep(6, 34, h);
        if (h < 0) h = 0;
        reg[j * rnx + i] = h + MEAN_SEA_LEVEL;
      }
    }

    // Named heights. A peak lifts its surroundings to its gazetted elevation; a shore or lake
    // control point pulls the surface to the published level. Both fall off smoothly.
    for (const c of this.control) {
      const R = c.radius;
      const i0 = clamp(Math.floor((c.x - R * 2.6 - this.x0) / rc), 0, rnx - 1);
      const i1 = clamp(Math.ceil((c.x + R * 2.6 - this.x0) / rc), 0, rnx - 1);
      const j0 = clamp(Math.floor((c.z - R * 2.6 - this.z0) / rc), 0, rnz - 1);
      const j1 = clamp(Math.ceil((c.z + R * 2.6 - this.z0) / rc), 0, rnz - 1);
      const k0 = this._regSample(c.x, c.z);
      const delta = c.elev - k0;
      for (let j = j0; j <= j1; j++) {
        const z = this.z0 + j * rc;
        for (let i = i0; i <= i1; i++) {
          const x = this.x0 + i * rc;
          const dx = (x - c.x) / R, dz = (z - c.z) / R;
          const g = Math.exp(-(dx * dx + dz * dz));
          if (g < 0.004) continue;
          const k = j * rnx + i;
          // The 1.06 makes up what the two smoothing passes below take back off a summit, so a
          // gazetted peak still measures its gazetted height when it is sampled.
          if (c.peak) reg[k] += delta * g * 1.06;          // lift the summit, keep the ridge
          else reg[k] = lerp(reg[k], reg[k] + delta, g);   // pull the shore to its level
        }
      }
    }

    // One smoothing pass, so the corrections do not leave a rim.
    const tmp = Float32Array.from(reg);
    for (let j = 1; j < rnz - 1; j++) {
      for (let i = 1; i < rnx - 1; i++) {
        const k = j * rnx + i;
        reg[k] = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - rnx] + tmp[k + rnx]) / 8;
      }
    }
  }

  _regSample(x, z) {
    const R = this.reg;
    let fx = (x - this.x0) / R.cell, fz = (z - this.z0) / R.cell;
    fx = clamp(fx, 0, R.nx - 1.0001); fz = clamp(fz, 0, R.nz - 1.0001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * R.nx + i;
    const a = R.a[k], b = R.a[k + 1], c = R.a[k + R.nx], d = R.a[k + R.nx + 1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * tz;
  }

  /* ---- 4. soft masks: swamp, lakes, tidal flats, rehabilitation, streets ---- */

  _buildMasks() {
    const mc = MASK_CELL;
    const mnx = Math.ceil((this.x1 - this.x0) / mc) + 1;
    const mnz = Math.ceil((this.z1 - this.z0) / mc) + 1;
    const mk = { nx: mnx, nz: mnz, cell: mc, x0: this.x0, z0: this.z0 };
    this.mask = mk;

    const make = () => new Uint8Array(mnx * mnz);
    mk.swamp = make(); mk.flats = make(); mk.rehab = make(); mk.street = make();
    mk.lakeId = make(); mk.lakeSoft = make(); mk.rock = make(); mk.town = make();

    // The rock at Point Lookout and the built-up radius of the townships, both baked once so
    // the per-cell loops below are two texture-style lookups rather than a search.
    for (let j = 0; j < mnz; j++) {
      const z = this.z0 + j * mc;
      for (let i = 0; i < mnx; i++) {
        const x = this.x0 + i * mc;
        mk.rock[j * mnx + i] = Math.round(255 * this._rockAmount(x, z));
        let t = 0;
        for (const tw of this.towns) {
          const dx = x - tw.x, dz = z - tw.z;
          const f = 1 - smoothstep(tw.r * 0.55, tw.r, Math.sqrt(dx * dx + dz * dz));
          if (f > t) t = f;
        }
        mk.town[j * mnx + i] = Math.round(255 * t);
      }
    }

    if (this.waterPolys.swamp) rasterPoly(mk.swamp, mk, this.waterPolys.swamp, 255);
    if (this.waterPolys.flats) rasterPoly(mk.flats, mk, this.waterPolys.flats, 255);
    for (const poly of this.rehabPolys) rasterPoly(mk.rehab, mk, poly, 255);

    this.lakes = [];
    for (let i = 0; i < this.waterPolys.lakes.length; i++) {
      const lk = this.waterPolys.lakes[i];
      rasterPoly(mk.lakeId, mk, lk.poly, i + 1);
      rasterPoly(mk.lakeSoft, mk, lk.poly, 255);
      let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of lk.poly) {
        cx += p[0]; cz += p[1];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
      }
      const lx = cx / lk.poly.length, lz = cz / lk.poly.length;
      // Water goes on a lake only where the pack publishes its level. Deriving one from the
      // elevation surface was tried and thrown out: the pack's Swallow Lagoon outline lands
      // beside Mount Hardgrave, so the derived surface came out at 223 m and put a lake on the
      // side of the island's highest hill. A wrong number that looks like a lake is worse than a
      // dry outline and a note saying what is missing, which is the same rule the rest of this
      // pack works to.
      const surfaceM = lk.surface != null ? lk.surface : null;
      const surfaceSource = surfaceM != null ? 'published' : 'no published water level in the pack';
      if (surfaceM == null) {
        this.notes.push(lk.name + ': no published water level, so no water surface is drawn. '
          + 'The outline is in the pack and the level is not.');
      }
      this.lakes.push({
        id: lk.id, name: lk.name, nameQuandamooka: lk.nameQ, type: lk.type,
        x: lx, z: lz,
        minX, maxX, minZ, maxZ,
        surfaceM, surfaceSource,
        maxDepthM: lk.depth, poly: lk.poly
      });
    }

    // Streets, drawn as a corridor so the built-up mask follows the road rather than a circle.
    for (const line of this.streets) {
      for (let i = 0; i < line.length - 1; i++) rasterLine(mk.street, mk, line[i], line[i + 1], 255, 2);
    }

    boxBlurU8(mk.swamp, mnx, mnz, 2);
    boxBlurU8(mk.flats, mnx, mnz, 2);
    boxBlurU8(mk.rehab, mnx, mnz, 1);
    boxBlurU8(mk.lakeSoft, mnx, mnz, 2);
    boxBlurU8(mk.street, mnx, mnz, 2);
    boxBlurU8(mk.rock, mnx, mnz, 1);

    // Bounding boxes, padded for the blur and the bilinear tap. The bake loops test these
    // before they sample anything, which is what keeps a million cells inside the budget.
    const bbOf = (polys) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const poly of polys) {
        for (const p of poly) {
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
          if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
        }
      }
      const pad = 340;
      return Number.isFinite(x0) ? [x0 - pad, x1 + pad, z0 - pad, z1 + pad] : [1, -1, 1, -1];
    };
    this.bb = {
      swamp: bbOf(this.waterPolys.swamp ? [this.waterPolys.swamp] : []),
      flats: bbOf(this.waterPolys.flats ? [this.waterPolys.flats] : []),
      rehab: bbOf(this.rehabPolys),
      lakes: bbOf(this.waterPolys.lakes.map((l) => l.poly)),
      rock: [
        Math.min(...ROCK_FEATURES.map((f) => f.x - f.r * 2.6)) - 200,
        Math.max(...ROCK_FEATURES.map((f) => f.x + f.r * 2.6)) + 200,
        Math.min(...ROCK_FEATURES.map((f) => f.z - f.r * 2.6)) - 200,
        Math.max(...ROCK_FEATURES.map((f) => f.z + f.r * 2.6)) + 200
      ],
      town: bbOf([this.towns.map((t) => [t.x - t.r, t.z - t.r]).concat(this.towns.map((t) => [t.x + t.r, t.z + t.r]))])
    };
  }

  _inBB(bb, x, z) { return x >= bb[0] && x <= bb[1] && z >= bb[2] && z <= bb[3]; }

  _mask(A, x, z) {
    const mk = this.mask;
    let fx = (x - mk.x0) / mk.cell, fz = (z - mk.z0) / mk.cell;
    fx = clamp(fx, 0, mk.nx - 1.0001); fz = clamp(fz, 0, mk.nz - 1.0001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * mk.nx + i;
    const a = A[k], b = A[k + 1], c = A[k + mk.nx], d = A[k + mk.nx + 1];
    const top = a + (b - a) * tx;
    return (top + (c + (d - c) * tx - top) * tz) / 255;
  }
  _maskId(A, x, z) {
    const mk = this.mask;
    let i = Math.round((x - mk.x0) / mk.cell), j = Math.round((z - mk.z0) / mk.cell);
    i = clamp(i, 0, mk.nx - 1); j = clamp(j, 0, mk.nz - 1);
    return A[j * mk.nx + i];
  }

  /* ---- 5. the heights ---- */

  _bakeHeights() {
    const nx = this.nx, nz = this.nz;
    const H = this.h, SD = this.sd, CLS = this._cls, mk = this.mask, bb = this.bb;
    const noise = this.noise, fine = this.noiseFine;
    const peaks = this.peaks;

    // The old dunes run roughly north-west, the way the sand travelled inland off the
    // south-easterly wind and swell, so the grain is stretched along that axis.
    const DUNE_A = -0.62;
    const dc = Math.cos(DUNE_A), ds = Math.sin(DUNE_A);

    const gx0 = this.x0, gz0 = this.z0;
    for (let j = 0; j < nz; j++) {
      const z = gz0 + j * CELL;
      const base = j * nx;
      for (let i = 0; i < nx; i++) {
        const k = base + i;
        const x = gx0 + i * CELL;
        const sd = SD[k];
        const cls = CLS[k];
        let h;

        if (sd > 0) {
          /* ---------------- land ---------------- */
          // The regional surface is the island; the shore profile is the beach and the dune in
          // front of it. Take whichever is higher, softened over a few metres so the join is a
          // slope and not a crease. A straight distance blend cannot work here: the southern
          // peaks stand 130 m up less than 500 m in from the bay, and a blend would flatten them.
          const reg = this._regSample(x, z) * smoothstep(0, 210, sd);
          const prof = landProfile(sd, cls);
          h = lerp(prof, reg, smoothstep(-6, 6, reg - prof));

          // Dune grain. Long ridges running north-west, the way the sand travelled, plus a
          // finer relief. Gated away from the shore and eased off at the gazetted summits so a
          // peak still measures its published height.
          // How much this is dune field rather than coastal plain. It eases off again above
          // about 150 m so the grain roughens the flanks without building a new summit higher
          // than the gazetted one: the island's high point is Mount Hardgrave at 228 m.
          const duneness = clamp((reg - 18) / 110, 0, 1) * (1 - 0.62 * smoothstep(145, 215, reg));
          // The grain is held off the coast and off the lake bowls. Held further off the coast
          // than it used to be: the published readings at Amity Point and Dunwich are single
          // figures and a hummocky dune grain running to the waterline was adding metres to them.
          let gate = smoothstep(140, 560, sd);
          if (this._inBB(bb.lakes, x, z)) {
            gate *= 1 - this._mask(mk.lakeSoft, x, z);
            // A perched lake sits in a smooth sand bowl, so ease the grain out around the rim
            // as well as inside the outline.
            for (let li = 0; li < this.lakes.length; li++) {
              const L = this.lakes[li];
              const dx = x - L.x, dz = z - L.z;
              if (dx > 700 || dx < -700 || dz > 700 || dz < -700) continue;
              gate *= 1 - 0.72 * Math.exp(-(dx * dx + dz * dz) / (300 * 300));
            }
          }
          for (let p = 0; p < peaks.length; p++) {
            const dx = x - peaks[p].x, dz = z - peaks[p].z;
            if (dx > 900 || dx < -900 || dz > 900 || dz < -900) continue;
            gate *= 1 - Math.exp(-(dx * dx + dz * dz) / (330 * 330));
          }
          // Four terms, because a Pleistocene dune field has four scales, and because slope is
          // amplitude over wavelength: the earlier version carried nearly all of its relief on
          // long wavelengths, which measured a mean land slope of 4.7 degrees. A dune field of
          // 4.7 degrees cannot cast a shadow, cannot shade a face, and reads as painted mottle
          // from every camera. The same relief budget spread onto shorter wavelengths measures
          // in the low teens, which is what a vegetated old dune field actually is.
          //
          //   ridgeLong  the parabolic ridges and the hollows between them, 620 m by 230 m
          //   crest      ridged noise: sharp crests, rounded swales, the shape of a dune
          //   hummock    the 190 m hummocky relief that gives the flanks their working slope
          //   micro      86 m, the shortest wavelength a 32 m grid can carry without aliasing
          //
          // Everything is stretched along the transport axis, and every octave stays above 64 m
          // so the grid samples it rather than aliases it.
          let ridge = 0;
          if (gate > 0.004) {
            const u = (x * dc - z * ds), v = (x * ds + z * dc);
            const ridgeLong = noise.fbm(u / 620, v / 230, 2, 2.0, 0.5);
            const crest = noise.ridged(u / 330, v / 132, 2) * 2 - 1;
            const hummock = fine.fbm(x / 190, z / 190, 2, 2.21, 0.55);
            h += ridgeLong * (7.5 + 18.0 * duneness) * gate;
            h += crest * (8.0 + 19.0 * duneness) * gate;
            h += hummock * (9.5 + 21.0 * duneness) * gate;
            ridge = ridgeLong;   // the rehabilitated paths below re-use the long term only
          }

          // Eighteen Mile Swamp: the long wet corridor behind the ocean beach, close to sea
          // level, backed by the high dunes. The pack's outline is derived and indicative, so
          // it is applied softly and never allowed to eat the foredune.
          if (this._inBB(bb.swamp, x, z)) {
            const sw = this._mask(mk.swamp, x, z) * smoothstep(190, 520, sd);
            if (sw > 0.002) {
              const floor = MEAN_SEA_LEVEL + 1.5 + 0.9 * smoothstep(-15000, 6000, z)
                + fine.fbm(x / 210, z / 210, 2) * 0.55;
              h = lerp(h, Math.min(h, floor), sw);
            }
          }

          // The rehabilitated mine paths were re-contoured, so they read smoother than the
          // dunes either side of them.
          if (this._inBB(bb.rehab, x, z)) {
            const rh = this._mask(mk.rehab, x, z);
            if (rh > 0.002) h = lerp(h, reg + ridge * 2.2 * duneness, rh * 0.8);
          }

          // Point Lookout: rock, and the only rock. A cliff at the Gorge, then the headland
          // levels out under the village. The rock profile is deliberately abrupt: the rise
          // lands inside the first twenty-five metres from the waterline so that at a 32 m grid
          // the seaward face is one steep cell rather than a sand ramp. The critic's transect
          // across this headland found a sandbar where the island's one cliff line is.
          if (this._inBB(bb.rock, x, z)) {
            // Sharpened: the raw mask is a sum of gaussians and sits near a half over most of the
            // headland, which blended the cliff halfway back into a sand ramp. The core of the
            // headland is rock or it is not.
            const rock = smoothstep(0.10, 0.42, this._mask(mk.rock, x, z));
            if (rock > 0.004) {
              const rp = MEAN_SEA_LEVEL + 1.6 + 23.5 * (1 - Math.exp(-sd / 10.5))
                + 13 * (1 - Math.exp(-sd / 760))
                + noise.fbm(x / 90, z / 90, 3) * 2.6 + noise.ridged(x / 210, z / 210, 2) * 3.4;
              h = Math.max(h, lerp(h, rp, rock));
            }
            // North Gorge and South Gorge, the two named slots cut into the headland. The
            // published coordinate is the gorge; the width and the reach inland are indicative
            // and are recorded as such in the notes.
            for (let gi = 0; gi < GORGE_FEATURES.length; gi++) {
              const G = GORGE_FEATURES[gi];
              const gdx = x - G.x, gdz = z - G.z;
              if (gdx > 260 || gdx < -260 || gdz > 260 || gdz < -260) continue;
              const cut = Math.exp(-(gdx * gdx + gdz * gdz) / (G.r * G.r))
                * (1 - smoothstep(150, 330, sd));
              if (cut > 0.01) h = lerp(h, MEAN_SEA_LEVEL + 1.2 + sd * 0.02, cut * 0.92);
            }
          }

          // The lakes. A perched lake is a bowl of water sitting well above the sea, so the
          // stored surface is the bed and the published level is carried in island.lakes.
          if (this._inBB(bb.lakes, x, z)) {
            const lid = this._maskId(mk.lakeId, x, z);
            const soft = this._mask(mk.lakeSoft, x, z);
            if (lid > 0) {
              const lake = this.lakes[lid - 1];
              const surf = lake.surfaceM != null ? lake.surfaceM : this._regSample(lake.x, lake.z) - 1.2;
              const depth = lake.maxDepthM != null ? lake.maxDepthM : 2.2;
              const bed = surf - depth * smoothstep(0.35, 0.95, soft);
              h = lerp(h, bed, smoothstep(0.18, 0.8, soft));
            } else if (soft > 0.02) {
              // The rim: bring the ground down to the lake edge rather than cliffing into it.
              const near = this._nearestLake(x, z);
              if (near) {
                const surf = near.surfaceM != null ? near.surfaceM : this._regSample(near.x, near.z) - 1.2;
                h = lerp(h, Math.max(surf, Math.min(h, surf + 3.5)), smoothstep(0.05, 0.55, soft));
              }
            }
          }
        } else {
          /* ---------------- sea ---------------- */
          const s = -sd;
          h = seaProfile(s, cls, x, z, noise);

          // The western flats: sand and mud that dries on a low tide between Dunwich and Amity.
          if (this._inBB(bb.flats, x, z)) {
            const fl = this._mask(mk.flats, x, z);
            if (fl > 0.003) {
              const top = 0.30 + 0.42 * (0.5 + 0.5 * noise.fbm(x / 620, z / 620, 3));
              h = lerp(h, Math.max(h, top), fl);
            }
          }

          // Channels cut through everything.
          for (let ci = 0; ci < CHANNELS.length; ci++) {
            const ch = CHANNELS[ci];
            const cb = ch.bb;
            if (x < cb[0] || x > cb[1] || z < cb[2] || z > cb[3]) continue;
            const d = distToPolyline(x, z, ch.pts, ch.half * 2.4);
            if (d < ch.half * 2.4) {
              const g = Math.exp(-(d / ch.half) * (d / ch.half));
              h = Math.min(h, h * (1 - g) - ch.depth * g);
            }
          }

          // The Point Lookout rock platform comes out of the water at the base of the cliffs.
          const rock = this._inBB(bb.rock, x, z) ? this._mask(mk.rock, x, z) : 0;
          if (rock > 0.004) {
            const rp = MEAN_SEA_LEVEL - 3.0 * (1 - Math.exp(-s / 70)) - 14 * (1 - Math.exp(-s / 900))
              + noise.fbm(x / 120, z / 120, 3) * 1.2;
            h = lerp(h, Math.max(h, rp), rock);
          }
        }

        H[k] = h;
      }
    }

    // One light smoothing pass over the land only. It takes the facet edges out of the coarse
    // lattice sample without rounding off the beach, the dune crests or the summits. Three
    // rolling rows rather than a copy of the whole field: this runs at boot, on a phone too.
    //
    // The centre weight is 26 rather than 12. At 12 this kernel passed only half of a two-cell
    // wavelength, which quietly removed most of the short relief that gives a dune field its
    // working slope, and an island of five degree slopes cannot shade or cast a shadow. At 26
    // it still takes the lattice facets out and passes about six sevenths of the dune grain.
    const rowA = new Float32Array(nx), rowB = new Float32Array(nx);
    rowA.set(H.subarray(0, nx));
    for (let j = 1; j < nz - 1; j++) {
      const base = j * nx;
      rowB.set(H.subarray(base, base + nx));
      for (let i = 1; i < nx - 1; i++) {
        const k = base + i;
        if (SD[k] < 40) continue;
        H[k] = (rowB[i] * 26 + rowB[i - 1] + rowB[i + 1] + rowA[i] + H[k + nx]) * (1 / 30);
      }
      rowA.set(rowB);
    }
  }

  _nearestLake(x, z) {
    let best = null, bd = 1e18;
    for (const l of this.lakes) {
      const dx = x - l.x, dz = z - l.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = l; }
    }
    return bd < 2200 * 2200 ? best : null;
  }

  /** How rocky Point Lookout is at this point. The named rock features are the real ones. */
  _rockAmount(x, z) {
    const F = ROCK_FEATURES;
    let r = 0;
    for (let i = 0; i < F.length; i++) {
      const dx = x - F[i].x, dz = z - F[i].z, R = F[i].r;
      if (dx > R * 2.4 || dx < -R * 2.4 || dz > R * 2.4 || dz < -R * 2.4) continue;
      const g = Math.exp(-(dx * dx + dz * dz) / (R * R));
      if (g > r) r = g;
    }
    return r > 1 ? 1 : r;
  }

  /* ---- 6. land cover ---- */

  _bakeCover() {
    const nx = this.nx, nz = this.nz, H = this.h, SD = this.sd, CLS = this._cls, mk = this.mask;
    const cov = this.cover;
    const sea = MEAN_SEA_LEVEL;
    const gx0 = this.x0, gz0 = this.z0;
    for (let j = 0; j < nz; j++) {
      const z = gz0 + j * CELL;
      const base = j * nx;
      for (let i = 0; i < nx; i++) {
        const k = base + i;
        const x = gx0 + i * CELL;
        const h = H[k], sd = SD[k], cls = CLS[k];
        const bayish = this.bay[k] / 255;

        const inRock = this._inBB(this.bb.rock, x, z);
        if (h < sea - 1.2) {
          // Below the low-water mark: seabed. Rock at the Point Lookout platform, sand elsewhere.
          cov[k] = inRock && h > sea - 12 && this._mask(mk.rock, x, z) > 0.45 ? C.rock : C.water;
          continue;
        }

        if (this._inBB(this.bb.lakes, x, z) && this._maskId(mk.lakeId, x, z) > 0) { cov[k] = C.lake; continue; }

        if (sd > 0) {
          // The cliff line comes before everything. Point Lookout village sits on top of the
          // headland, and the earlier order let the township mask run its streets all the way
          // down to the waterline, which is how a critic's transect across the island's one rock
          // headland returned urban, cleared, urban and never once returned rock. Nobody puts a
          // street on the seaward face of the Gorge.
          const rockAmt = inRock ? this._mask(mk.rock, x, z) : 0;
          if (rockAmt > 0.18 && sd < 130) { cov[k] = C.rock; continue; }

          // A town on a headland is still a town, so behind the cliff the built-up test wins.
          const inTown = this._inBB(this.bb.town, x, z) ? this._mask(mk.town, x, z) : 0;
          if (inTown > 0.25) {
            const street = this._mask(mk.street, x, z);
            if (street > 0.30) { cov[k] = C.urban; continue; }
            if (street > 0.08) { cov[k] = C.cleared; continue; }
          }
          // Rock is the cliff, the platform and the headland fringe, not everything within a
          // radius of it: the village behind the cliff top is sand with houses on it.
          if (rockAmt > 0.42 && sd < 340) { cov[k] = C.rock; continue; }

          if (this._inBB(this.bb.rehab, x, z) && this._mask(mk.rehab, x, z) > 0.5) { cov[k] = C.rehab; continue; }

          if (this._inBB(this.bb.swamp, x, z) && this._mask(mk.swamp, x, z) > 0.45 && h < sea + 8) { cov[k] = C.swamp; continue; }

          // The bay side, between the mangroves and the dry land.
          if (bayish > 0.5 && h < sea + 0.9) { cov[k] = C.mangrove; continue; }
          if (bayish > 0.5 && h < sea + 2.1 && sd < 260) { cov[k] = C.saltmarsh; continue; }

          if (h < sea + 2.6 || (sd < 40 && h < sea + 5)) { cov[k] = C.beach; continue; }
          if (sd < 230 && h < sea + 26 && (cls === SHORE.OCEAN || cls === SHORE.NORTH || cls === SHORE.POCKET || cls === SHORE.PIN)) {
            cov[k] = C.foredune; continue;
          }
          // Eucalypt forest holds the high old ridges; wallum heath holds the sand plains
          // and the lower slopes. The bands come from the vegetation rules in the pack.
          cov[k] = h > sea + 42 ? C.forest : C.heath;
        } else {
          // Intertidal: still beach, still walked on at low water, except on the rock platform
          // at the foot of the cliffs, which is where people fish and watch for whales.
          if (inRock && this._mask(mk.rock, x, z) > 0.22) { cov[k] = C.rock; continue; }
          cov[k] = bayish > 0.5 && h > sea - 0.6 ? C.mangrove : C.beach;
        }
      }
    }
  }

  /* ---- 7. named regions ---- */

  _bakeRegions() {
    const rc = REGION_CELL;
    const rnx = Math.ceil((this.x1 - this.x0) / rc) + 1;
    const rnz = Math.ceil((this.z1 - this.z0) / rc) + 1;
    this.rnx = rnx; this.rnz = rnz; this.rx0 = this.x0; this.rz0 = this.z0;
    const grid = new Uint8Array(rnx * rnz);
    const names = ['Minjerribah'];
    const idOf = (name) => {
      let i = names.indexOf(name);
      if (i < 0) { names.push(name); i = names.length - 1; }
      return i;
    };
    const bayId = idOf('Moreton Bay');
    const seaId = idOf('the Pacific');
    const swampId = idOf('Eighteen Mile Swamp');

    // Parks first, then townships over the top of them, then the water.
    const parkMask = new Uint8Array(rnx * rnz);
    const pmk = { nx: rnx, nz: rnz, cell: rc, x0: this.x0, z0: this.z0 };
    for (let p = 0; p < this.parks.length; p++) {
      const park = this.parks[p];
      const id = idOf(park.name);
      for (const part of park.parts) rasterPoly(parkMask, pmk, part, id);
    }

    for (let j = 0; j < rnz; j++) {
      const z = this.z0 + j * rc;
      for (let i = 0; i < rnx; i++) {
        const k = j * rnx + i;
        const x = this.x0 + i * rc;
        const h = this.height(x, z);
        const sd = this._sampleF32(this.sd, x, z);
        if (sd < 0 && h < MEAN_SEA_LEVEL) {
          grid[k] = this.bay[this._index(x, z)] > 128 ? bayId : seaId;
          continue;
        }
        const lid = this._maskId(this.mask.lakeId, x, z);
        if (lid > 0) {
          const l = this.lakes[lid - 1];
          grid[k] = idOf(l.nameQuandamooka ? `${l.name} (${l.nameQuandamooka})` : l.name);
          continue;
        }
        let town = null, best = 1e18;
        for (const t of this.towns) {
          const dx = x - t.x, dz = z - t.z;
          const d = dx * dx + dz * dz;
          if (d < t.r * t.r && d < best) { best = d; town = t; }
        }
        if (town) { grid[k] = idOf(town.name); continue; }
        if (this._mask(this.mask.swamp, x, z) > 0.5) { grid[k] = swampId; continue; }
        if (parkMask[k]) { grid[k] = parkMask[k]; continue; }
        // Beaches and headlands take the name of the nearest published coastal landmark.
        const cvr = this._nearestU8(this.cover, x, z);
        if ((cvr === C.beach || cvr === C.foredune || cvr === C.rock) && this.coastLandmarks.length) {
          let bn = null, bd = 1e18;
          for (const lm of this.coastLandmarks) {
            const dx = x - lm.x, dz = z - lm.z;
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; bn = lm; }
          }
          if (bn && bd < 2600 * 2600) { grid[k] = idOf(bn.name); continue; }
        }
        grid[k] = 0;
      }
    }
    this.regionGrid = grid;
    this.regionNames = names;
  }

  /* ---- 8. bounds and the summary ---- */

  _finishBounds() {
    let minY = Infinity, maxY = -Infinity, maxK = 0;
    const H = this.h;
    for (let k = 0; k < H.length; k++) {
      if (H[k] < minY) minY = H[k];
      if (H[k] > maxY) { maxY = H[k]; maxK = k; }
    }
    this.minY = minY; this.maxY = maxY;
    this.highPoint = {
      x: this.x0 + (maxK % this.nx) * CELL,
      z: this.z0 + Math.floor(maxK / this.nx) * CELL,
      elevationM: maxY - MEAN_SEA_LEVEL
    };

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (this.coast) {
      for (const p of this.coast) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
      }
    } else { minX = this.x0; maxX = this.x1; minZ = this.z0; maxZ = this.z1; }

    /** The island's own extent, not the sampled area. `domain` is where height() has data. */
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
    this.domain = { minX: this.x0, maxX: this.x1, minZ: this.z0, maxZ: this.z1, cell: CELL, nx: this.nx, nz: this.nz };

    // Land area from the grid, as a check against the published 275.2 km2.
    let land = 0;
    for (let k = 0; k < H.length; k++) if (this.sd[k] > 0) land++;
    this.landAreaKm2 = (land * CELL * CELL) / 1e6;

    /** A read-only view of the baked fields, so a render layer can build textures without
     *  resampling the whole island one call at a time. Do not write to these. */
    this.grid = {
      nx: this.nx, nz: this.nz, cell: CELL, x0: this.x0, z0: this.z0,
      height: this.h, shoreDistance: this.sd, cover: this.cover, bayness: this.bay, covers: COVERS
    };
  }

  /** Six named places whose elevation is published, so the numbers can be checked from outside. */
  checkpoints() {
    const pts = [
      { id: 'point-lookout-headland', label: 'Point Lookout headland (Mooloomba)', lon: 153.5375, lat: -27.4306, publishedM: null, expect: '30 to 60 m of rock' },
      { id: 'dunwich', label: 'Dunwich (Goompi) foreshore', lon: 153.4008, lat: -27.4975, publishedM: 9, expect: 'low, on the bay' },
      { id: 'mount-hardgrave', label: 'Mount Hardgrave', lon: 153.453056, lat: -27.499722, publishedM: 228, expect: 'the highest gazetted peak' },
      { id: 'blue-lake', label: 'Blue Lake (Kaboora) shore', lon: 153.474, lat: -27.531, publishedM: 72, expect: 'a lake well above the sea' },
      { id: 'brown-lake', label: 'Brown Lake (Bummiera) shore', lon: 153.4324, lat: -27.4896, publishedM: 62, expect: 'a perched lake' },
      { id: 'eighteen-mile-swamp', label: 'Eighteen Mile Swamp', lon: 153.4704, lat: -27.6018, publishedM: null, expect: 'close to sea level' },
      { id: 'amity-point', label: 'Amity Point (Pulan)', lon: 153.441129, lat: -27.401394, publishedM: 9, expect: 'low and flat' },
      { id: 'mount-vane', label: 'Mount Vane', lon: 153.457447, lat: -27.524914, publishedM: 199, expect: 'interior dune ridge' }
    ];
    return pts.map((p) => {
      const xz = this.project(p.lon, p.lat);
      const h = this.height(xz.x, xz.z);
      return {
        id: p.id, label: p.label,
        lon: p.lon, lat: p.lat,
        x: Math.round(xz.x), z: Math.round(xz.z),
        elevationM: +(h - MEAN_SEA_LEVEL).toFixed(1),
        publishedM: p.publishedM,
        cover: this.landCover(xz.x, xz.z),
        region: this.regionAt(xz.x, xz.z),
        expect: p.expect
      };
    });
  }

  summary() {
    return {
      source: this.source,
      ready: this.ready !== false,
      datum: this.datum,
      origin: this.origin,
      buildMs: +this.buildMs.toFixed(0),
      extentKm: {
        northSouth: +((this.bounds.maxZ - this.bounds.minZ) / 1000).toFixed(2),
        eastWest: +((this.bounds.maxX - this.bounds.minX) / 1000).toFixed(2)
      },
      landAreaKm2: +this.landAreaKm2.toFixed(1),
      maxElevationM: +(this.maxY - MEAN_SEA_LEVEL).toFixed(1),
      maxElevationAt: this.highPoint ? { x: this.highPoint.x, z: this.highPoint.z } : null,
      lowestSeabedM: +(this.minY - MEAN_SEA_LEVEL).toFixed(1),
      grid: { cellM: CELL, nx: this.nx, nz: this.nz, cells: this.nx * this.nz },
      lakes: this.lakes.map((l) => ({ name: l.name, surfaceM: l.surfaceM != null ? +(l.surfaceM - MEAN_SEA_LEVEL).toFixed(1) : null })),
      checkpoints: this.checkpoints(),
      notes: this.notes
    };
  }
}

/* ------------------------------------------------------------------ shore profiles

Distances are metres from the waterline; the return is metres above LAT. These are the shapes
that read as this island from a metre away: a steep quartz beach face and a bound foredune on
the ocean side, a low ramp and a wide drying flat on the bay side, and a cliff at the Gorge. */

function landProfile(sd, cls) {
  const S = MEAN_SEA_LEVEL;
  switch (cls) {
    case SHORE.OCEAN:
      return S + 2.4 * (1 - Math.exp(-sd / 14))
        + 13.5 * smoothstep(20, 150, sd)
        - 4.0 * smoothstep(150, 330, sd);
    case SHORE.POCKET:
      return S + 2.2 * (1 - Math.exp(-sd / 12))
        + 10.5 * smoothstep(15, 110, sd)
        + 6.0 * smoothstep(110, 400, sd);
    case SHORE.NORTH:
      return S + 2.0 * (1 - Math.exp(-sd / 15))
        + 8.0 * smoothstep(18, 130, sd)
        - 2.2 * smoothstep(130, 320, sd);
    case SHORE.BAY:
      return S + 0.6 * (1 - Math.exp(-sd / 22)) + 4.6 * (1 - Math.exp(-sd / 230));
    case SHORE.PIN:
      return S + 0.4 * (1 - Math.exp(-sd / 26)) + 3.0 * (1 - Math.exp(-sd / 520));
    default:
      // Rock. This is the only rock on the island and it is a cliff, not a beach: the walls at
      // the Gorge stand out of the water and the published shore reading at the Gorge is 24 m.
      // Nine tenths of that rise lands inside the first twenty-five metres, so at the 32 m grid
      // the face is a face. The headland behind it levels off and the regional surface, which
      // carries the 56 m at the village, takes over from there.
      return S + 1.6 + 22.5 * (1 - Math.exp(-sd / 11)) + 13 * (1 - Math.exp(-sd / 760));
  }
}

function seaProfile(s, cls, x, z, noise) {
  const S = MEAN_SEA_LEVEL;
  // Detail is only worth computing where it can be seen or waded on. Past five kilometres the
  // seabed is a smooth analytic slope, which is most of what keeps the bake inside its budget.
  const near = s < 5200 ? 1 - smoothstep(4200, 5200, s) : 0;
  switch (cls) {
    case SHORE.OCEAN:
    case SHORE.POCKET: {
      let e = S - 2.6 * (1 - Math.exp(-s / 130))
        - 26 * (1 - Math.exp(-s / 2400))
        - 44 * (1 - Math.exp(-s / 15000));
      if (s < 1400) {
        // The longshore bar, with gaps in it. A gap is a rip, and it is where people drown.
        const wobble = noise.fbm(x / 1100, z / 1100, 2);
        const rip = noise.fbm(x / 700 + 31, z / 700 - 17, 2);
        const barPos = 172 + 90 * wobble;
        const barAmp = 1.3 * Math.max(0, 1 - Math.abs(rip) * 1.9);
        const u = (s - barPos) / 72;
        e += barAmp * Math.exp(-u * u);
        const v = (s - 44) / 30;
        e += 0.40 * Math.exp(-v * v);
      }
      return e;
    }
    case SHORE.NORTH:
      return S - 1.6 * (1 - Math.exp(-s / 200))
        - 6.0 * (1 - Math.exp(-s / 2200))
        - 12 * (1 - Math.exp(-s / 12000))
        + (near > 0 ? noise.fbm(x / 900, z / 900, 2) * 0.5 * near : 0);
    case SHORE.BAY:
      return S - 0.9 * (1 - Math.exp(-s / 300))
        - 2.6 * (1 - Math.exp(-s / 2600))
        - 3.2 * (1 - Math.exp(-s / 14000))
        + (near > 0 ? (noise.fbm(x / 800, z / 800, 3) * 0.55 + noise.fbm(x / 240, z / 240, 2) * 0.16) * near : 0);
    case SHORE.PIN:
      return S - 0.7 * (1 - Math.exp(-s / 250))
        - 2.0 * (1 - Math.exp(-s / 2200))
        - 2.2 * (1 - Math.exp(-s / 12000))
        + (near > 0 ? noise.fbm(x / 620, z / 620, 3) * 0.75 * near : 0);
    default: // rock
      return S - 3.5 * (1 - Math.exp(-s / 60))
        - 12 * (1 - Math.exp(-s / 900))
        - 30 * (1 - Math.exp(-s / 9000));
  }
}

/* The named rock at Point Lookout, from data/places.json coordinates, projected once at load.
   Nothing else on the island is rock, so nothing else is in this list. */
const ROCK_LONLAT = [
  ['Point Lookout headland', 153.5376, -27.4306, 520],
  ['North Gorge', 153.5450, -27.4347, 330],
  ['Whale Rock', 153.5455, -27.4340, 200],
  ['South Gorge', 153.5433, -27.4363, 260],
  ['Point Lookout lighthouse', 153.5406, -27.4322, 300],
  ['Cylinder headland', 153.5357, -27.4254, 240],
  ['Adder Rock', 153.5149, -27.4210, 190]
];
const ROCK_FEATURES = ROCK_LONLAT.map(([name, lon, lat, r]) => ({
  name, r,
  x: (lon - ISLAND_ORIGIN.lon) * M_PER_DEG_LON,
  z: (lat - ISLAND_ORIGIN.lat) * M_PER_DEG_LAT
}));

/* The two gorges cut into the Point Lookout headland. Both are real, named and published; the
   coordinate is the gorge, the width below is indicative and says so in the pack notes. */
const GORGE_LONLAT = [
  ['North Gorge', 153.5450, -27.4347, 105],
  ['South Gorge', 153.5433, -27.4363, 85]
];
const GORGE_FEATURES = GORGE_LONLAT.map(([name, lon, lat, r]) => ({
  name, r,
  x: (lon - ISLAND_ORIGIN.lon) * M_PER_DEG_LON,
  z: (lat - ISLAND_ORIGIN.lat) * M_PER_DEG_LAT
}));

/* ------------------------------------------------------------------ raster helpers */

/** Even-odd scanline fill of a polygon into a coarse mask grid. */
function rasterPoly(mask, mk, poly, value) {
  const m = poly.length;
  if (m < 3) return;
  let z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  const j0 = Math.max(0, Math.floor((z0 - mk.z0) / mk.cell));
  const j1 = Math.min(mk.nz - 1, Math.ceil((z1 - mk.z0) / mk.cell));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zw = mk.z0 + j * mk.cell;
    xs.length = 0;
    for (let i = 0, k = m - 1; i < m; k = i++) {
      const zi = poly[i][1], zk = poly[k][1];
      if ((zi > zw) !== (zk > zw)) {
        xs.push(poly[i][0] + ((zw - zi) / (zk - zi)) * (poly[k][0] - poly[i][0]));
      }
    }
    xs.sort((a, b) => a - b);
    const base = j * mk.nx;
    for (let s = 0; s + 1 < xs.length; s += 2) {
      let i0 = Math.ceil((xs[s] - mk.x0) / mk.cell);
      let i1 = Math.floor((xs[s + 1] - mk.x0) / mk.cell);
      if (i1 < 0 || i0 >= mk.nx) continue;
      if (i0 < 0) i0 = 0;
      if (i1 > mk.nx - 1) i1 = mk.nx - 1;
      for (let i = i0; i <= i1; i++) mask[base + i] = value;
    }
  }
}

/** Draw a line into a mask with a half width in cells. */
function rasterLine(mask, mk, a, b, value, wCells) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / (mk.cell * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const ci = Math.round((x - mk.x0) / mk.cell), cj = Math.round((z - mk.z0) / mk.cell);
    for (let j = cj - wCells; j <= cj + wCells; j++) {
      if (j < 0 || j >= mk.nz) continue;
      for (let i = ci - wCells; i <= ci + wCells; i++) {
        if (i < 0 || i >= mk.nx) continue;
        mask[j * mk.nx + i] = value;
      }
    }
  }
}

/** Separable box blur over a Uint8 field, in place. Two passes give a soft, cheap falloff. */
function boxBlurU8(A, nx, nz, r) {
  if (r < 1) return;
  const tmp = new Float32Array(A.length);
  const w = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) {
      const base = j * nx;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += A[base + clamp(i, 0, nx - 1)];
      for (let i = 0; i < nx; i++) {
        tmp[base + i] = sum / w;
        sum += A[base + clamp(i + r + 1, 0, nx - 1)] - A[base + clamp(i - r, 0, nx - 1)];
      }
    }
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += tmp[clamp(j, 0, nz - 1) * nx + i];
      for (let j = 0; j < nz; j++) {
        A[j * nx + i] = Math.round(sum / w);
        sum += tmp[clamp(j + r + 1, 0, nz - 1) * nx + i] - tmp[clamp(j - r, 0, nz - 1) * nx + i];
      }
    }
  }
}

function distToPolyline(x, z, pts, cutoff) {
  let best = 1e18;
  const c2 = cutoff * cutoff;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const L2 = vx * vx + vz * vz;
    let t = L2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - a[0] - vx * t, dz = z - a[1] - vz * t;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1) break;
  }
  return best > c2 ? cutoff : Math.sqrt(best);
}

/* ------------------------------------------------------------------ registration */

/**
 * Build the island and hang it off the world. This runs at registration rather than in init,
 * because render layers are attached to a ready stage the moment their module registers, and
 * they all want world.island.height to exist before they build a single mesh.
 */
export function registerIsland(world) {
  if (world.island instanceof Island) return world.system('island');

  const island = new Island(world);
  world.island = island;

  const state = world.publish('island', island.summary());

  if (typeof console !== 'undefined') {
    console.info(`[island] ${island.landAreaKm2.toFixed(0)} km2 of land, high point `
      + `${(island.maxY - MEAN_SEA_LEVEL).toFixed(0)} m, ${island.nx}x${island.nz} at ${CELL} m, `
      + `built in ${island.buildMs.toFixed(0)} ms`);
  }

  return world.register({
    id: 'island',
    phase: 'environment',
    order: 0,

    init(w) {
      // The heightfield does not change with time, so init only re-publishes the read model
      // once every pack is loaded and confirms the thing other systems are about to lean on.
      if (!w.island) w.island = island;
      Object.assign(state, island.summary());
    },

    // No wall-clock numbers in here: describe() is what the determinism fingerprint hashes, and
    // a build time would make two identical islands look different. buildMs lives in the
    // published read model, which the probe carries anyway.
    describe() {
      const c = state.checkpoints || [];
      return {
        source: state.source,
        landAreaKm2: state.landAreaKm2,
        maxElevationM: state.maxElevationM,
        extentKm: state.extentKm,
        checkpoints: c.map((p) => `${p.label}: ${p.elevationM} m (${p.cover})`)
      };
    },

    save() { return null; },
    load() {}
  });
}
