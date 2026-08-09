// Ocean. Two seas that do not look alike, because on Minjerribah they are not alike.
//
// East of the island is the Coral Sea edge of the Pacific: deep, blue, long-period ground swell
// out of the south-east, a surf beach thirty-two kilometres long with a sand bar and rips in it.
// West of the island is Moreton Bay: two to five metres deep, green-brown, short wind chop with
// almost no fetch, glassy at first light, and enough intertidal sand that a spring low tide walks
// the waterline hundreds of metres out and leaves the Amity banks and the yabby banks standing dry.
//
// What is modelled here, and why it is built this way:
//
//   * Bathymetry is baked once into a texture on the local metre grid the camera rig already uses,
//     so the water, the waterline and the stand-in sand all read exactly the same seabed.
//     When a real terrain module lands and injects world.island.height(x, z), that wins and the
//     stand-in sand mesh is disposed. Nothing here hard-crashes without terrain.
//   * Wave phase comes from a baked eikonal travel-time field, not from a plane wave. Solving
//     |grad T| = 1 / c(depth) is what makes a crest bend as it feels the bottom, wrap around the
//     Point Lookout headlands and peel, and arrive all at once along the straight run of Main Beach
//     so that beach closes out. It is one bake, and then it is free every frame.
//   * Amplitude is Green's law shoaling times a baked directional shelter field, limited by the
//     McCowan breaking criterion H = 0.78 d. Foam is born at the crest and rides the same travel-time
//     field shoreward, so it advects up the beach for nothing.
//   * The tide comes straight from the tide system, per station, so high water at Amity is not
//     high water at the Gorge, and the waterline moves because the water level moves.
//
// Nothing in here is invented geography. The coastline, the channels, the banks and the rock
// platforms are coarse approximations of real, named, published features of the island, at the
// resolution of a thirty-metre grid, and they are marked as approximations. When data/geography.json
// lands with a surveyed coastline, this model is replaced by it rather than argued with.

const B = window.BABYLON;

/* ------------------------------------------------------------------ projection

Identical to the camera rig's local metre grid so every layer agrees on where things are:
origin near the middle of the island, x east, z north, one unit = one metre. */

const ORIGIN = { lat: -27.56, lon: 153.47 };
const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LON = 98683;
const px = (lon) => (lon - ORIGIN.lon) * M_PER_DEG_LON;
const pz = (lat) => (lat - ORIGIN.lat) * M_PER_DEG_LAT;

/* ------------------------------------------------------------------ the coastline

A coarse outline of Minjerribah from published place coordinates: Amity Point in the north,
east along Flinders Beach to Point Lookout, south down Main Beach to Jumpinpin, then back up
the bay shore through Dunwich and Myora. Roughly one point per kilometre of coast, so features
smaller than about three hundred metres are not in this outline. It is a stand-in for a surveyed
coastline, not a survey. */

const COAST_LONLAT = [
  [153.4400, -27.3993], // Amity Point (Pulan)
  [153.4560, -27.4085],
  [153.4700, -27.4140], // Flinders Beach
  [153.4880, -27.4175],
  [153.5060, -27.4205],
  [153.5200, -27.4228], // Adder Rock
  [153.5290, -27.4252], // Home Beach
  [153.5340, -27.4262], // Cylinder Beach
  [153.5400, -27.4270], // Point Lookout
  [153.5455, -27.4292], // North Gorge
  [153.5470, -27.4330], // South Gorge / Frenchmans
  [153.5450, -27.4380], // Deadmans, north end of Main Beach
  [153.5410, -27.4500],
  [153.5340, -27.4800], // Main Beach
  [153.5270, -27.5200],
  [153.5190, -27.5600],
  [153.5090, -27.6000],
  [153.4960, -27.6400],
  [153.4780, -27.6750],
  [153.4560, -27.7000],
  [153.4290, -27.7120], // Jumpinpin
  [153.4160, -27.7020],
  [153.4120, -27.6700],
  [153.4150, -27.6300],
  [153.4180, -27.5900],
  [153.4120, -27.5500],
  [153.4050, -27.5200],
  [153.4008, -27.4967], // Dunwich (Goompi)
  [153.4060, -27.4900], // One Mile
  [153.4090, -27.4700],
  [153.4100, -27.4620], // Myora Springs (Capembah)
  [153.4150, -27.4400],
  [153.4230, -27.4200],
  [153.4330, -27.4080]
];

/* Named water features, all real, positioned from published coordinates and given a plausible
   depth or drying height. Depths are metres relative to LAT, the same datum the tide model uses. */

// Deep tidal channels: polylines with a half width and a depth.
const CHANNELS = [
  { name: 'Rous Channel', depth: 17.0, half: 900,
    pts: [[-11500, 21200], [-5200, 20000], [800, 19000], [7200, 18300]] },
  { name: 'Rainbow Channel', depth: 10.5, half: 620,
    pts: [[-10200, 3200], [-9600, 7600], [-8600, 11800], [-7200, 15600]] },
  { name: 'Canaipa Passage', depth: 7.5, half: 500,
    pts: [[-8600, -18600], [-8000, -14000], [-8200, -9000], [-9000, -4000]] }
];

// Intertidal banks that dry: a centre, a radius and how far above LAT the crest stands.
const BANKS = [
  { name: 'Amity banks', x: -4600, z: 18700, r: 2300, top: 0.95 },
  { name: 'Amity banks north', x: -1900, z: 19400, r: 1400, top: 0.55 },
  { name: 'One Mile yabby banks', x: -6300, z: 7600, r: 1500, top: 0.70 },
  { name: 'Myora flats', x: -5500, z: 10600, r: 1500, top: 0.60 },
  { name: 'Maroom bank', x: -8900, z: 13200, r: 1200, top: 0.35 }
];

// Rock: the headlands at Point Lookout and Adder Rock, and the low shelf below the Gorge walk.
const ROCK = [
  { name: 'Point Lookout headland', x: 6769, z: 14423, r: 430, up: 22 },
  { name: 'North Gorge', x: 7401, z: 14534, r: 360, up: 26 },
  { name: 'Frenchmans headland', x: 7450, z: 14145, r: 300, up: 18 },
  { name: 'Adder Rock', x: 4835, z: 15200, r: 190, up: 12 }
];
// The Gorge low shelf: a rock platform that comes out of the water on a low tide.
const SHELF = { x: 7620, z: 14380, rx: 320, rz: 240, top: 0.30 };

const G = 9.81;

/* ------------------------------------------------------------------ the seabed model */

function makeIslandModel(noise) {
  const coast = COAST_LONLAT.map(([lon, lat]) => [px(lon), pz(lat)]);
  const n = coast.length;

  // Distance from a point to the coast polyline, and whether it is inside.
  function distToCoast(x, z) {
    let best = 1e18;
    for (let i = 0; i < n; i++) {
      const a = coast[i], b = coast[(i + 1) % n];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const wx = x - a[0], wz = z - a[1];
      const L2 = vx * vx + vz * vz;
      let t = L2 > 0 ? (wx * vx + wz * vz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - vx * t, dz = wz - vz * t;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  function inside(x, z) {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = coast[i][0], zi = coast[i][1], xj = coast[j][0], zj = coast[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  // Bounding boxes so the per-cell bake can reject a feature before it does any real work.
  for (const ch of CHANNELS) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of ch.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const pad = ch.half * 2.6;
    ch.bb = [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
  }

  function distToPolyline(x, z, pts) {
    let best = 1e18;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const wx = x - a[0], wz = z - a[1];
      const L2 = vx * vx + vz * vz;
      let t = L2 > 0 ? (wx * vx + wz * vz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - vx * t, dz = wz - vz * t;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  /** Elevation in metres above LAT. sd is signed distance to the coast, positive on land. */
  function elevation(x, z, sd, bayness) {
    const nd = noise.fbm(x / 2600, z / 2600, 3);
    let e;
    if (sd > 0) {
      // Land: foredune, then the big parabolic dunes, then the inner ridges.
      e = 1.7 + 13.0 * (1 - Math.exp(-sd / 150))
        + 62.0 * (1 - Math.exp(-sd / 2700))
        + 118.0 * (1 - Math.exp(-sd / 9500));
      e *= 1 + nd * 0.28;
      e += noise.fbm(x / 520, z / 520, 3) * Math.min(9, sd / 45);
      // Eighteen Mile Swamp: the long wet corridor behind the Main Beach dunes.
      if (x > 0 && z < 7000 && z > -17000 && sd > 500 && sd < 2400) {
        const band = Math.exp(-Math.pow((sd - 1350) / 620, 2));
        e = e * (1 - 0.86 * band) + band * (2.2 + nd * 1.4);
      }
    } else {
      const s = -sd;
      if (bayness > 0.5) {
        e = 0.95
          - 1.15 * (1 - Math.exp(-s / 400))
          - 2.70 * (1 - Math.exp(-s / 3200))
          - 3.10 * (1 - Math.exp(-s / 16000));
        // Bay bed is banked and gutted rather than smooth.
        e += noise.fbm(x / 900, z / 900, 3) * 0.55 + noise.fbm(x / 260, z / 260, 2) * 0.18;
      } else {
        e = 1.75
          - 2.60 * (1 - Math.exp(-s / 130))
          - 28.0 * (1 - Math.exp(-s / 2200))
          - 46.0 * (1 - Math.exp(-s / 14000));
        if (s < 1400) {
          // The longshore bar, with gaps in it. A gap is a rip, and waves do not break in it.
          const wobble = noise.fbm(x / 1100, z / 1100, 2);
          const rip = noise.fbm(x / 700 + 31, z / 700 - 17, 2);
          const barPos = 168 + 92 * wobble;
          const barAmp = 1.35 * Math.max(0, 1 - Math.abs(rip) * 1.9);
          const u = (s - barPos) / 72;
          e += barAmp * Math.exp(-u * u);
          // An inner bank close in, so there is a shorebreak as well as an outer break.
          const v = (s - 42) / 30;
          e += 0.42 * Math.exp(-v * v);
          e += noise.fbm(x / 420, z / 420, 2) * Math.min(1.6, s / 300);
        }
      }
      // Drying banks.
      for (let bi = 0; bi < BANKS.length; bi++) {
        const bk = BANKS[bi];
        const dx = x - bk.x, dz = z - bk.z;
        const lim = bk.r * 1.9;
        if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r < lim) {
          const u = r / (bk.r * 0.62);
          const g = Math.exp(-u * u);
          const crest = bk.top + noise.fbm(x / 380, z / 380, 2) * 0.35;
          e = e * (1 - g) + Math.max(e, crest) * g;
        }
      }
      // Channels cut through everything.
      for (let ci = 0; ci < CHANNELS.length; ci++) {
        const ch = CHANNELS[ci];
        const bb = ch.bb;
        if (x < bb[0] || x > bb[1] || z < bb[2] || z > bb[3]) continue;
        const d = distToPolyline(x, z, ch.pts);
        if (d < ch.half * 2.4) {
          const u = d / ch.half;
          const g = Math.exp(-u * u);
          e = Math.min(e, e * (1 - g) - ch.depth * g);
        }
      }
    }
    // Rock headlands push up on both sides of the waterline.
    for (let ri = 0; ri < ROCK.length; ri++) {
      const rk = ROCK[ri];
      const dx = x - rk.x, dz = z - rk.z;
      const lim = rk.r * 2.6;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      const u = Math.sqrt(dx * dx + dz * dz) / rk.r;
      e += rk.up * Math.exp(-u * u);
    }
    // The Gorge low shelf: flat rock that appears out of the water at low tide.
    {
      const dx = (x - SHELF.x) / SHELF.rx, dz = (z - SHELF.z) / SHELF.rz;
      const r2 = dx * dx + dz * dz;
      if (r2 < 2.6) {
        const g = Math.exp(-r2 * 1.4);
        e = e * (1 - g) + (SHELF.top + noise.fbm(x / 90, z / 90, 2) * 0.22) * g;
      }
    }
    return e;
  }

  /** 0 = open sand coast, 1 = rock platform. Used for colour and for how foam sits on it. */
  function rockiness(x, z) {
    let r = 0;
    for (let i = 0; i < ROCK.length; i++) {
      const rk = ROCK[i];
      const dx = x - rk.x, dz = z - rk.z;
      const lim = rk.r * 4;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      const q = rk.r * 1.5;
      r = Math.max(r, Math.exp(-(dx * dx + dz * dz) / (q * q)));
    }
    const dx = (x - SHELF.x) / (SHELF.rx * 1.5), dz = (z - SHELF.z) / (SHELF.rz * 1.5);
    r = Math.max(r, Math.exp(-(dx * dx + dz * dz)));
    return Math.min(1, r);
  }

  return { coast, distToCoast, inside, elevation, rockiness };
}

/* ------------------------------------------------------------------ the bake grid

One grid, shared by the seabed texture and the wave travel-time texture, so a sample of one
lines up with a sample of the other. Roughly twenty-seven metres a cell, which is about the
resolution the coastline outline above deserves. */

const BOX = { x0: -16000, z0: -20000, w: 28000, h: 41000 };
const NX = 896;
const NZ = 1312;
const HX = BOX.w / NX;   // 31.25 m
const HZ = BOX.h / NZ;   // 31.25 m
const CELL = (HX + HZ) / 2;

const cellX = (i) => BOX.x0 + (i + 0.5) * HX;
const cellZ = (j) => BOX.z0 + (j + 0.5) * HZ;

/* Float to half-float bits. RGBA16F is filterable in WebGL2 without an extension, which is why
   the fields are stored as halves rather than as packed bytes: a packed byte pair cannot be
   bilinearly filtered without tearing exactly where the waterline sits. */
const _f32 = new Float32Array(1);
const _i32 = new Int32Array(_f32.buffer);
function toHalf(v) {
  _f32[0] = v;
  const x = _i32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) return bits | 0x7c00;
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

/** Seabed field: elevation above LAT, bay mix, rockiness, and signed distance to the coast. */
function bakeSeabed(model, heightFn) {
  const N = NX * NZ;
  const elev = new Float32Array(N);
  const bay = new Float32Array(N);
  const rock = new Float32Array(N);
  const sdist = new Float32Array(N);
  const insideMask = new Uint8Array(N);

  // 1. Inside/outside by scanline fill, which is exact and costs nothing.
  const coast = model.coast;
  const nseg = coast.length;
  const xs = new Float64Array(nseg);
  for (let j = 0; j < NZ; j++) {
    const zw = cellZ(j);
    let count = 0;
    for (let i = 0, k = nseg - 1; i < nseg; k = i++) {
      const zi = coast[i][1], zk = coast[k][1];
      if ((zi > zw) !== (zk > zw)) {
        xs[count++] = coast[i][0] + ((zw - zi) / (zk - zi)) * (coast[k][0] - coast[i][0]);
      }
    }
    const row = xs.subarray(0, count);
    row.sort();
    const base = j * NX;
    for (let s = 0; s + 1 < count; s += 2) {
      let i0 = Math.ceil((row[s] - BOX.x0) / HX - 0.5);
      let i1 = Math.floor((row[s + 1] - BOX.x0) / HX - 0.5);
      if (i1 < 0 || i0 >= NX) continue;
      if (i0 < 0) i0 = 0;
      if (i1 > NX - 1) i1 = NX - 1;
      for (let i = i0; i <= i1; i++) insideMask[base + i] = 1;
    }
  }

  // 2. Unsigned distance by a nearest-point sweep (dead reckoning), then made signed.
  const npX = new Float32Array(N);
  const npZ = new Float32Array(N);
  const dist = new Float32Array(N).fill(1e9);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const v = insideMask[k];
      const edge = (i > 0 && insideMask[k - 1] !== v) || (i < NX - 1 && insideMask[k + 1] !== v)
        || (j > 0 && insideMask[k - NX] !== v) || (j < NZ - 1 && insideMask[k + NX] !== v);
      if (edge) { dist[k] = 0; npX[k] = cellX(i); npZ[k] = cellZ(j); }
    }
  }
  const OFFS_FWD = [-NX - 1, -NX, -NX + 1, -1];
  const OFFS_BACK = [NX + 1, NX, NX - 1, 1];
  function sweep(offs, jFrom, jTo, jStep, iFrom, iTo, iStep) {
    for (let j = jFrom; j !== jTo; j += jStep) {
      const z = cellZ(j);
      const base = j * NX;
      for (let i = iFrom; i !== iTo; i += iStep) {
        const k = base + i;
        const x = cellX(i);
        let bd = dist[k], bx = npX[k], bz = npZ[k];
        for (let o = 0; o < 4; o++) {
          const s = k + offs[o];
          if (s < 0 || s >= N) continue;
          if (dist[s] >= 1e9) continue;
          const dx = x - npX[s], dz = z - npZ[s];
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < bd) { bd = d; bx = npX[s]; bz = npZ[s]; }
        }
        dist[k] = bd; npX[k] = bx; npZ[k] = bz;
      }
    }
  }
  sweep(OFFS_FWD, 1, NZ, 1, 1, NX - 1, 1);
  sweep(OFFS_BACK, NZ - 2, -1, -1, NX - 2, 0, -1);

  // 3. Exact distance in the band that matters, so the waterline is not a staircase.
  const bandCells = 5;
  for (let k = 0; k < N; k++) {
    if (dist[k] < bandCells * CELL) {
      dist[k] = model.distToCoast(cellX(k % NX), cellZ((k / NX) | 0));
    }
  }

  // 4. Bay or ocean. West of the westernmost land in a row is Moreton Bay; east of the
  //    easternmost land is the Pacific. Rows with no land inherit from the nearest row that has it.
  const westX = new Float32Array(NZ).fill(NaN);
  const eastX = new Float32Array(NZ).fill(NaN);
  for (let j = 0; j < NZ; j++) {
    const base = j * NX;
    for (let i = 0; i < NX; i++) if (insideMask[base + i]) { westX[j] = cellX(i); break; }
    for (let i = NX - 1; i >= 0; i--) if (insideMask[base + i]) { eastX[j] = cellX(i); break; }
  }
  for (let j = 0; j < NZ; j++) if (isNaN(westX[j])) {
    let a = j, b = j;
    while (a >= 0 && isNaN(westX[a])) a--;
    while (b < NZ && isNaN(westX[b])) b++;
    const src = (a >= 0 && (b >= NZ || j - a <= b - j)) ? a : (b < NZ ? b : -1);
    if (src >= 0) { westX[j] = westX[src]; eastX[j] = eastX[src]; }
    else { westX[j] = -6000; eastX[j] = 6000; }
  }
  const smooth = (arr) => {
    const out = new Float32Array(arr.length);
    for (let j = 0; j < arr.length; j++) {
      let s = 0, c = 0;
      for (let d = -18; d <= 18; d++) { const q = j + d; if (q >= 0 && q < arr.length) { s += arr[q]; c++; } }
      out[j] = s / c;
    }
    return out;
  };
  const westS = smooth(westX);

  // 5. Elevation. Uses an injected terrain height when one exists, otherwise the model above.
  for (let j = 0; j < NZ; j++) {
    const z = cellZ(j);
    const wx = westS[j];
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const x = cellX(i);
      const sd = insideMask[k] ? dist[k] : -dist[k];
      sdist[k] = sd;
      const bm = Math.max(0, Math.min(1, (wx + 700 - x) / 1400));
      bay[k] = bm;
      let e;
      if (heightFn) {
        const h = heightFn(x, z);
        e = Number.isFinite(h) ? h : 0;
      } else {
        e = model.elevation(x, z, sd, bm);
      }
      elev[k] = e;
      rock[k] = model.rockiness(x, z);
    }
  }

  return { elev, bay, rock, sdist };
}

/** Wave travel time and shelter for one swell direction. Eikonal by fast sweeping. */
function bakeWaveField(elev, dirDeg, refLevel, periodRef) {
  const N = NX * NZ;
  // Direction of propagation, from a compass bearing the swell is coming FROM.
  const th = ((dirDeg + 180) * Math.PI) / 180;
  const dx = Math.sin(th), dz = Math.cos(th);
  const c0 = (G * periodRef) / (2 * Math.PI);
  const OFFSET = 60000;

  // Local celerity. Deep water is period-limited, shallow water is depth-limited, and land is
  // slow enough that a crest goes around the island rather than through it.
  const slow = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const d = refLevel - elev[k];
    let c;
    if (d <= 0.25) c = d > -1.5 ? 1.2 : 0.30;
    else c = Math.min(c0, Math.sqrt(G * d));
    slow[k] = 1 / c;
  }

  const T = new Float32Array(N).fill(1e9);
  const fixed = new Uint8Array(N);
  for (let j = 0; j < NZ; j++) {
    const z = cellZ(j);
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (refLevel - elev[k] > 32) {
        T[k] = (dx * cellX(i) + dz * z + OFFSET) / c0;
        fixed[k] = 1;
      }
    }
  }

  const solve = (k) => {
    if (fixed[k]) return;
    const i = k % NX, j = (k / NX) | 0;
    const a = Math.min(i > 0 ? T[k - 1] : 1e9, i < NX - 1 ? T[k + 1] : 1e9);
    const b = Math.min(j > 0 ? T[k - NX] : 1e9, j < NZ - 1 ? T[k + NX] : 1e9);
    const f = slow[k];
    let t;
    if (a >= 1e9 && b >= 1e9) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    t = lo + f * CELL;
    if (t > hi) {
      const s = a < b ? HX : HZ, s2 = a < b ? HZ : HX;
      const A = 1 / (s * s) + 1 / (s2 * s2);
      const Bq = -2 * (lo / (s * s) + hi / (s2 * s2));
      const C = lo * lo / (s * s) + hi * hi / (s2 * s2) - f * f;
      const disc = Bq * Bq - 4 * A * C;
      if (disc >= 0) t = (-Bq + Math.sqrt(disc)) / (2 * A);
    }
    if (t < T[k]) T[k] = t;
  };

  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) solve(j * NX + i);
    for (let j = 0; j < NZ; j++) for (let i = NX - 1; i >= 0; i--) solve(j * NX + i);
    for (let j = NZ - 1; j >= 0; j--) for (let i = 0; i < NX; i++) solve(j * NX + i);
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) solve(j * NX + i);
  }

  // Shelter: march downwind, carrying a decaying shadow from any land the ray crossed. This is
  // what puts Cylinder Beach and Home Beach in the lee on a south swell while Main Beach copes
  // with the whole thing.
  const shelter = new Float32Array(N);
  const stepI = dx >= 0 ? 1 : -1;
  const stepJ = dz >= 0 ? 1 : -1;
  const wI = Math.abs(dx) / (Math.abs(dx) + Math.abs(dz) + 1e-6);
  const wJ = 1 - wI;
  const decay = Math.exp(-CELL / 2600);
  const i0 = dx >= 0 ? 0 : NX - 1, i1 = dx >= 0 ? NX : -1;
  const j0 = dz >= 0 ? 0 : NZ - 1, j1 = dz >= 0 ? NZ : -1;
  for (let j = j0; j !== j1; j += stepJ) {
    for (let i = i0; i !== i1; i += stepI) {
      const k = j * NX + i;
      const land = elev[k] > refLevel - 0.2 ? 1 : 0;
      let up = 0;
      const pi = i - stepI, pj = j - stepJ;
      if (pi >= 0 && pi < NX) up += wI * shelter[j * NX + pi];
      if (pj >= 0 && pj < NZ) up += wJ * shelter[pj * NX + i];
      shelter[k] = Math.max(land, up * decay);
    }
  }

  // Pack: R = delay against the unrefracted arrival, G = exposure, BA = local crest direction.
  const data = new Uint16Array(N * 4);
  const exposure = new Float32Array(N);
  const dirXa = new Float32Array(N);
  const dirZa = new Float32Array(N);
  for (let j = 0; j < NZ; j++) {
    const z = cellZ(j);
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      const t = T[k] >= 1e9 ? 0 : T[k];
      const t0 = (dx * cellX(i) + dz * z + OFFSET) / c0;
      const gx = ((i < NX - 1 ? Math.min(T[k + 1], 1e6) : t) - (i > 0 ? Math.min(T[k - 1], 1e6) : t)) / (2 * HX);
      const gz = ((j < NZ - 1 ? Math.min(T[k + NX], 1e6) : t) - (j > 0 ? Math.min(T[k - NX], 1e6) : t)) / (2 * HZ);
      let ux = gx, uz = gz;
      const len = Math.hypot(ux, uz);
      if (len < 1e-6) { ux = dx; uz = dz; } else { ux /= len; uz /= len; }
      const o = k * 4;
      const ex = 1 - Math.min(1, shelter[k]);
      data[o] = toHalf(Math.max(-400, Math.min(2400, t - t0)));
      data[o + 1] = toHalf(ex);
      data[o + 2] = toHalf(ux * 0.5 + 0.5);
      data[o + 3] = toHalf(uz * 0.5 + 0.5);
      exposure[k] = ex;
      dirXa[k] = ux;
      dirZa[k] = uz;
    }
  }
  return { data, exposure, dirX: dirXa, dirZ: dirZa };
}

/* ------------------------------------------------------------------ shaders */

const COMMON = `
precision highp float;
uniform vec3 uCam;
uniform vec4 uSun;     // xyz direction to the sun, w how far above the horizon 0..1
uniform vec4 uSunCol;  // rgb colour, a intensity
uniform vec4 uSky;     // rgb zenith, a cloud 0..1
uniform vec4 uSkyHz;   // rgb horizon, a haze
uniform vec4 uEnv;     // x wind kt, y cloud, z wind dir x, w wind dir z
uniform sampler2D noiseTex;

vec3 skyColour(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, pow(up, 0.42));
  float s = max(dot(normalize(d), uSun.xyz), 0.0);
  c += uSunCol.rgb * uSunCol.a * (pow(s, 400.0) * 9.0 + pow(s, 14.0) * 0.30 + pow(s, 3.0) * 0.05);
  // A soft band of cloud near the horizon rather than a flat gradient.
  float band = exp(-abs(d.y) * 7.0) * uSky.a;
  c = mix(c, mix(uSkyHz.rgb, vec3(0.75, 0.76, 0.78) * (0.25 + uSunCol.a * 0.55), 0.45), band * 0.5);
  return c;
}

vec3 seabedColour(vec2 p, float bayMix, float rockAmt) {
  vec3 na = texture2D(noiseTex, p * 0.0023).rgb;
  vec3 nb = texture2D(noiseTex, p * 0.0165).rgb;
  float rip = sin(p.x * 0.145 + p.y * 0.085 + na.r * 8.0) * 0.5 + 0.5;
  vec3 sand = mix(vec3(0.90, 0.86, 0.75), vec3(0.66, 0.60, 0.44), bayMix);
  sand *= 0.84 + 0.22 * nb.g + 0.12 * rip;
  vec3 rock = vec3(0.27, 0.25, 0.23) * (0.65 + 0.7 * nb.b);
  float weed = bayMix * smoothstep(0.42, 0.80, na.b) * 0.6;
  return mix(mix(sand, vec3(0.13, 0.19, 0.10), weed), rock, rockAmt);
}
`;

const WATER_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 uCentre;   // xy disc centre in world metres, z disc scale
uniform vec4 uBox;      // x0, z0, width, height of the bake box
uniform vec4 uTide;     // water level at SW, SE, NW, NE
uniform float uTime;
uniform vec4 uSwell0;
uniform vec4 uSwell1;
uniform vec4 uSwell2;
uniform vec4 uChop0;
uniform vec4 uChop1;
uniform vec4 uChop2;
uniform vec4 uSwellDir; // x,y deep water direction, z reference celerity, w pitch gain
uniform vec4 uSurf;     // x swell gain, y chop gain, z runup gain, w break sharpness
uniform sampler2D bathyTex;
uniform sampler2D waveTex;

varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vA;   // depth, break, exposure, jacobian
varying vec4 vB;   // main phase, curvature, water level, wave amplitude

void addSwell(vec4 S, vec2 p, vec2 dir, vec2 dDeep, vec2 perp, float delay, float dsafe, float skew,
              inout vec3 dP, inout vec3 Tx, inout vec3 Tz, inout float curv, inout float amps) {
  float w = S.x;
  float c0 = 9.81 / w;
  float c = min(c0, sqrt(9.81 * dsafe));
  float k = w / c;
  float k0 = w * w / 9.81;
  float L0 = 6.2831853 / k0;
  float shallow = 1.0 - smoothstep(0.06, 0.5, dsafe / L0);
  float cg = c * (0.5 + 0.5 * shallow);
  float Ks = sqrt((c0 * 0.5) / max(cg, 0.4));
  float A = S.y * Ks;
  if (A < 0.002) return;
  float theta = w * (delay + (dot(dDeep, p) + 60000.0) / c0 - uTime) + S.z * dot(perp, p) + S.w;
  vec2 gr = k * dir + S.z * perp;
  float ct = cos(theta), st = sin(theta);
  float sk = 1.0 + skew * ct;
  vec2 grs = gr * sk;
  float ths = theta + skew * st;
  float cs = cos(ths), ss = sin(ths);
  float H = min(A / (k * dsafe), 0.85 / k);
  dP.y += A * cs;
  dP.xz -= dir * (H * ss);
  Tx += vec3(-dir.x * H * cs * grs.x, -A * ss * grs.x, -dir.y * H * cs * grs.x);
  Tz += vec3(-dir.x * H * cs * grs.y, -A * ss * grs.y, -dir.y * H * cs * grs.y);
  curv += -A * cs * dot(grs, grs);
  amps += A;
}

void addChop(vec4 C, vec2 p, inout vec3 dP, inout vec3 Tx, inout vec3 Tz, inout float amps) {
  vec2 kv = C.xy;
  float k = length(kv);
  if (k < 1e-5 || C.z < 0.0008) return;
  vec2 dir = kv / k;
  float theta = dot(kv, p) - C.w * uTime;
  float A = C.z;
  float ct = cos(theta), st = sin(theta);
  dP.y += A * ct;
  dP.xz -= dir * (A * st);
  vec2 gr = kv;
  Tx += vec3(-dir.x * A * ct * gr.x, -A * st * gr.x, -dir.y * A * ct * gr.x);
  Tz += vec3(-dir.x * A * ct * gr.y, -A * st * gr.y, -dir.y * A * ct * gr.y);
  amps += A;
}

void main(void) {
  vec2 p = uCentre.xy + position.xz * uCentre.z;
  vec2 uv = (p - uBox.xy) / uBox.zw;
  vec2 uvc = clamp(uv, 0.0018, 0.9982);
  vec4 bed = texture2D(bathyTex, uvc);
  vec4 wf = texture2D(waveTex, uvc);

  float level = mix(mix(uTide.x, uTide.y, uvc.x), mix(uTide.z, uTide.w, uvc.x), uvc.y);
  float elev = bed.x;
  float bayMix = bed.y;
  float depth0 = level - elev;
  float dsafe = max(depth0, 0.30);
  float expo = clamp(wf.y, 0.0, 1.0);

  vec2 dir = normalize(wf.zw * 2.0 - 1.0 + vec2(1e-5));
  vec2 perp = vec2(-dir.y, dir.x);
  float delay = wf.x;

  // Shoal the ground swell first, so the breaking test sees the shoaled height.
  float w0 = uSwell0.x;
  float c00 = 9.81 / w0;
  float cc = min(c00, sqrt(9.81 * dsafe));
  float L00 = 6.2831853 * 9.81 / (w0 * w0);
  float sh = 1.0 - smoothstep(0.06, 0.5, dsafe / L00);
  float Ks0 = sqrt((c00 * 0.5) / max(cc * (0.5 + 0.5 * sh), 0.4));
  float bayCut = 1.0 - bayMix * 0.88;
  float A0 = (uSwell0.y + uSwell1.y + uSwell2.y) * Ks0 * expo * bayCut * uSurf.x;
  float Hb = 2.0 * A0;
  float gamma = Hb / max(dsafe, 0.20);
  float brk = smoothstep(0.55, 1.05, gamma);
  float limiter = min(1.0, 0.78 * dsafe / max(Hb, 0.01));
  float gain = expo * bayCut * uSurf.x * mix(1.0, limiter, 0.92);
  float skew = uSwellDir.w * brk;

  vec3 dP = vec3(0.0);
  vec3 Tx = vec3(1.0, 0.0, 0.0);
  vec3 Tz = vec3(0.0, 0.0, 1.0);
  float curv = 0.0;
  float amps = 0.0;
  vec2 dDeep = uSwellDir.xy;
  addSwell(vec4(uSwell0.x, uSwell0.y * gain, uSwell0.z, uSwell0.w), p, dir, dDeep, perp, delay, dsafe, skew, dP, Tx, Tz, curv, amps);
  addSwell(vec4(uSwell1.x, uSwell1.y * gain, uSwell1.z, uSwell1.w), p, dir, dDeep, perp, delay, dsafe, skew * 0.6, dP, Tx, Tz, curv, amps);
  addSwell(vec4(uSwell2.x, uSwell2.y * gain, uSwell2.z, uSwell2.w), p, dir, dDeep, perp, delay, dsafe, skew * 0.4, dP, Tx, Tz, curv, amps);

  // Wind chop dies in the shallows too, and it dies fastest where the swell is already breaking.
  float chopFade = smoothstep(0.15, 1.4, depth0) * (1.0 - 0.55 * brk) * uSurf.y
                 * mix(1.0, uSurf.w, bayMix);
  addChop(vec4(uChop0.xy, uChop0.z * chopFade, uChop0.w), p, dP, Tx, Tz, amps);
  addChop(vec4(uChop1.xy, uChop1.z * chopFade, uChop1.w), p, dP, Tx, Tz, amps);
  addChop(vec4(uChop2.xy, uChop2.z * chopFade, uChop2.w), p, dP, Tx, Tz, amps);

  // Swash. The same travel-time field carries the bore up the beach and lets it drain back.
  float theta0 = w0 * (delay + (dot(dDeep, p) + 60000.0) / c00 - uTime) + uSwell0.w;
  float runupAmp = uSurf.z * min(1.35, 0.42 * Hb + 0.10);
  float above = elev - level;
  float nearShore = 1.0 - smoothstep(0.0, 2.6, -above);
  float notFarUp = 1.0 - smoothstep(runupAmp * 0.15, runupAmp * 1.05, above);
  float u = 0.5 + 0.5 * cos(theta0 - 0.9);
  float runup = runupAmp * nearShore * notFarUp * (u * u * (3.0 - 2.0 * u));

  float jac = Tx.x * Tz.z - Tx.z * Tz.x;
  vec3 nrm = normalize(cross(Tz, Tx));

  vec3 world = vec3(p.x + dP.x, level + runup + dP.y, p.y + dP.z);
  vPos = world;
  vNrm = nrm;
  vA = vec4(depth0, brk, expo, jac);
  vB = vec4(theta0, curv, level + runup, max(amps, 0.02));
  gl_Position = viewProjection * vec4(world, 1.0);
}
`;

const WATER_FRAG = COMMON + `
uniform vec4 uBox;
uniform float uTime;
uniform vec4 uWater;  // x caustic gain, y micro gain, z fog density, w glass 0..1
uniform vec4 uFoamP;  // x foam decay, y soup gain, z whitecap threshold, w foam scale
uniform sampler2D bathyTex;

varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vA;
varying vec4 vB;

void main(void) {
  vec2 uv = clamp((vPos.xz - uBox.xy) / uBox.zw, 0.0018, 0.9982);
  vec4 bed = texture2D(bathyTex, uv);
  float depth = vB.z - bed.x;
  if (depth <= 0.004) discard;
  float bayMix = bed.y;
  float rockAmt = bed.z;

  vec3 V = uCam - vPos;
  float dist = length(V);
  V /= dist;
  vec3 L = uSun.xyz;
  vec3 N = normalize(vNrm);

  // Micro detail: two scrolling octaves, faded out with distance so it never aliases.
  vec2 wd = uEnv.zw;
  float detail = 1.0 - smoothstep(180.0, 1500.0, dist);
  if (detail > 0.001) {
    vec3 n1 = texture2D(noiseTex, vPos.xz * 0.085 + wd * uTime * 0.055).rgb;
    vec3 n2 = texture2D(noiseTex, vPos.xz * 0.29 - wd * uTime * 0.14).rgb;
    float mg = uWater.y * detail * (0.35 + 0.65 * smoothstep(0.2, 3.0, depth));
    N = normalize(N + vec3((n1.r - 0.5) * 1.1 + (n2.r - 0.5) * 0.7, 0.0,
                           (n1.g - 0.5) * 1.1 + (n2.g - 0.5) * 0.7) * mg);
  }
  if (dot(N, V) < 0.0) N = reflect(N, V);

  float ndv = max(dot(N, V), 0.02);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Reflection: an analytic sky, which costs one gradient and tracks the real sun azimuth.
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.006);
  vec3 refl = skyColour(R);

  // Sun glitter. Roughness opens up with wind, so a still bay morning gives a hard mirror
  // and a twenty knot nor'easter gives a broad sparkling path.
  float rough = clamp(0.06 + uEnv.x * 0.020, 0.05, 0.55) * (1.0 - uWater.w * 0.7);
  vec3 Hv = normalize(L + V);
  float shin = mix(2600.0, 60.0, rough);
  float spec = pow(max(dot(N, Hv), 0.0), shin) * (shin + 8.0) * 0.006;
  spec *= uSun.w;

  // Water body colour by depth, with a different extinction on each side of the island.
  vec3 extOcean = vec3(0.30, 0.075, 0.045);
  vec3 extBay = vec3(0.62, 0.30, 0.95);
  vec3 ext = mix(extOcean, extBay, bayMix);
  float pathLen = depth * 1.65;
  vec3 trans = exp(-ext * pathLen);

  // Seabed, refracted. The offset is the horizontal shift a ray picks up crossing the surface.
  vec2 refr = vPos.xz - N.xz * min(depth, 9.0) * 0.42;
  vec3 bedCol = seabedColour(refr, bayMix, rockAmt);

  // Caustics from the actual curvature of the surface above: crests focus, troughs spread.
  float caust = clamp(1.0 + vB.y * min(depth, 7.0) * uWater.x, 0.0, 3.2);
  caust = pow(caust, 1.7) * exp(-depth * 0.16) * uSun.w;
  bedCol *= 1.0 + caust * 0.85;

  float sunLambert = clamp(uSun.y, 0.0, 1.0);
  bedCol *= uSunCol.rgb * uSunCol.a * (0.35 + 0.75 * sunLambert) + uSkyHz.rgb * 0.55;

  vec3 deepCol = mix(vec3(0.010, 0.055, 0.115), vec3(0.020, 0.055, 0.045), bayMix);
  vec3 body = mix(deepCol, bedCol, trans);
  // Scattering in the water column: turquoise over sand, olive over the bay bed.
  vec3 scatter = mix(vec3(0.045, 0.30, 0.33), vec3(0.12, 0.20, 0.10), bayMix);
  body += scatter * (1.0 - exp(-depth * 0.55)) * (0.30 + 0.70 * sunLambert) * uSunCol.a;

  // Subsurface scattering: a backlit face glows because light travels through the wave.
  float faceUp = clamp((vPos.y - vB.z) / max(0.30, vB.w), 0.0, 1.4);
  float steepF = clamp(1.0 - vA.w, 0.0, 1.2);
  float backlit = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 3.5);
  float sss = backlit * faceUp * (0.30 + 1.1 * steepF + 0.9 * vA.y) * uSun.w;
  vec3 sssCol = mix(vec3(0.08, 0.62, 0.50), vec3(0.32, 0.46, 0.16), bayMix);
  body += sssCol * sss * 0.55 * uSunCol.a;

  vec3 col = mix(body, refl, fres * (0.55 + 0.45 * smoothstep(0.0, 2.0, depth)));
  col += uSunCol.rgb * uSunCol.a * spec * (1.0 - 0.5 * bayMix);

  // Foam. Born at the crest where the wave breaks, then carried shoreward on the same phase.
  float ph = fract(-vB.x / 6.2831853);
  vec3 fa = texture2D(noiseTex, vPos.xz * uFoamP.w + vec2(0.0, -uTime * 0.02)).rgb;
  vec3 fb = texture2D(noiseTex, vPos.xz * uFoamP.w * 3.7 - vec2(uTime * 0.03, 0.0)).rgb;
  float ftex = clamp(fa.r * 0.75 + fb.g * 0.55, 0.0, 1.0);

  float breaker = vA.y * exp(-ph * uFoamP.x) * smoothstep(0.25, 0.55, ftex + vA.y * 0.5);
  float soup = vA.y * uFoamP.y * smoothstep(0.35, 0.85, ftex);
  float windFoam = smoothstep(11.0, 26.0, uEnv.x) * (1.0 - bayMix * 0.55);
  float whitecap = (1.0 - smoothstep(uFoamP.z - 0.30, uFoamP.z, vA.w)) * windFoam * smoothstep(0.30, 0.75, ftex);
  float swash = smoothstep(0.55, 0.03, depth) * (0.45 + 0.55 * vA.y) * smoothstep(0.20, 0.60, ftex);
  float edge = 1.0 - smoothstep(0.0, 0.16, depth);
  float foam = clamp(max(max(breaker, soup), max(whitecap, max(swash, edge * 0.9))), 0.0, 1.0);
  foam *= 1.0 - rockAmt * 0.15;

  vec3 foamCol = (vec3(0.94, 0.96, 0.97) * (0.42 + 0.60 * sunLambert)) * uSunCol.a
               + uSkyHz.rgb * 0.30;
  col = mix(col, foamCol, foam);

  // Distance haze so the far water meets the sky instead of ending.
  float fog = 1.0 - exp(-dist * uWater.z);
  col = mix(col, skyColour(normalize(vec3(-V.x, max(0.02, -V.y * 0.15 + 0.03), -V.z))), fog * 0.9);

  float alpha = clamp(smoothstep(0.0, 0.055, depth) + foam * 0.85, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/* The stand-in sand. Replaced the moment a real terrain layer or world.island appears; it exists
   so the sea has a beach to break on while the terrain slice is still being built. */

const SAND_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 uCentre;
uniform vec4 uBox;
uniform sampler2D bathyTex;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vBed;
void main(void) {
  vec2 p = uCentre.xy + position.xz * uCentre.z;
  vec2 uv = clamp((p - uBox.xy) / uBox.zw, 0.0018, 0.9982);
  vec4 bed = texture2D(bathyTex, uv);
  vec2 e = vec2(1.6 / ` + NX.toFixed(1) + `, 1.6 / ` + NZ.toFixed(1) + `);
  float hx = texture2D(bathyTex, clamp(uv + vec2(e.x, 0.0), 0.0018, 0.9982)).x
           - texture2D(bathyTex, clamp(uv - vec2(e.x, 0.0), 0.0018, 0.9982)).x;
  float hz = texture2D(bathyTex, clamp(uv + vec2(0.0, e.y), 0.0018, 0.9982)).x
           - texture2D(bathyTex, clamp(uv - vec2(0.0, e.y), 0.0018, 0.9982)).x;
  vNrm = normalize(vec3(-hx / (2.0 * e.x * uBox.z), 1.0, -hz / (2.0 * e.y * uBox.w)));
  vPos = vec3(p.x, bed.x, p.y);
  vBed = bed;
  gl_Position = viewProjection * vec4(vPos, 1.0);
}
`;

const SAND_FRAG = COMMON + `
uniform vec4 uBox;
uniform vec4 uTide;
uniform vec4 uWet;   // x recent high water level, y dry rate, z spring/neap, w time
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vBed;

void main(void) {
  vec2 uv = clamp((vPos.xz - uBox.xy) / uBox.zw, 0.0018, 0.9982);
  float level = mix(mix(uTide.x, uTide.y, uv.x), mix(uTide.z, uTide.w, uv.x), uv.y);
  float elev = vBed.x;
  float bayMix = vBed.y;
  float rockAmt = vBed.z;
  float sd = vBed.w;

  vec3 N = normalize(vNrm);
  vec3 na = texture2D(noiseTex, vPos.xz * 0.0031).rgb;
  vec3 nb = texture2D(noiseTex, vPos.xz * 0.021).rgb;

  vec3 col;
  if (elev < level) {
    col = seabedColour(vPos.xz, bayMix, rockAmt);
  } else {
    // Straddie sand is white silica. Wet sand is the same grain with the pores full of water,
    // so it goes dark and slightly warm rather than grey.
    vec3 dry = mix(vec3(0.905, 0.875, 0.795), vec3(0.80, 0.76, 0.66), bayMix);
    dry *= 0.90 + 0.18 * nb.r;
    float wet = 1.0 - smoothstep(0.0, 0.32, elev - uWet.x);
    vec3 wetSand = dry * vec3(0.50, 0.47, 0.46);
    vec3 sand = mix(dry, wetSand, wet);
    vec3 rock = vec3(0.29, 0.26, 0.235) * (0.6 + 0.8 * nb.b);
    // Vegetation: heath and banksia on the dunes, wet heath in the swamp corridor.
    float veg = smoothstep(2.0, 9.0, elev) * smoothstep(30.0, 130.0, sd);
    vec3 heath = mix(vec3(0.235, 0.275, 0.155), vec3(0.135, 0.195, 0.105), smoothstep(0.3, 0.8, na.g));
    heath *= 0.82 + 0.35 * nb.g;
    col = mix(mix(sand, heath, veg), rock, rockAmt);
  }

  float lam = clamp(dot(N, uSun.xyz), 0.0, 1.0);
  vec3 lit = col * (uSunCol.rgb * uSunCol.a * (0.10 + 1.05 * lam) + uSkyHz.rgb * 0.42 + uSky.rgb * 0.20);
  // A wet beach is also glossy, which is most of why a receding tide reads as wet.
  if (elev >= level) {
    float wet = 1.0 - smoothstep(0.0, 0.32, elev - uWet.x);
    vec3 V = normalize(uCam - vPos);
    vec3 Hv = normalize(uSun.xyz + V);
    float g = pow(max(dot(N, Hv), 0.0), 90.0) * wet * uSun.w * (1.0 - rockAmt * 0.6);
    lit += uSunCol.rgb * uSunCol.a * g * 1.4;
  }

  float dist = length(uCam - vPos);
  float fog = 1.0 - exp(-dist * 0.000045);
  lit = mix(lit, uSkyHz.rgb * 0.9, fog * 0.85);
  gl_FragColor = vec4(lit, 1.0);
}
`;

/* ------------------------------------------------------------------ geometry */

/** A disc of normalised radius with rings packed exponentially toward the centre, so whatever
 *  the camera is near gets the vertices and the horizon still gets covered by one mesh. */
function buildDisc(scene, name, rings, segs, k) {
  const denom = Math.exp(k) - 1;
  const pos = [0, 0, 0];
  for (let j = 1; j <= rings; j++) {
    const r = (Math.exp((k * j) / rings) - 1) / denom;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(r * Math.cos(a), 0, r * Math.sin(a));
    }
  }
  const idx = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let j = 1; j < rings; j++) {
    const b0 = 1 + (j - 1) * segs, b1 = 1 + j * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(b0 + s, b1 + s, b0 + s1);
      idx.push(b0 + s1, b1 + s, b1 + s1);
    }
  }
  const mesh = new B.Mesh(name, scene);
  const vd = new B.VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.applyToMesh(mesh, false);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  return mesh;
}

/* ------------------------------------------------------------------ the layer */

export function registerOcean(world) {
  const rng = world.rng.stream('ocean');
  const noise = makeIslandNoise(rng.seed);
  const model = makeIslandModel(noise);

  // Sample points a few hundred metres off each named break, resolved once the seabed is baked.
  const BREAKS = [
    { id: 'cylinder', label: 'Cylinder Beach', x: 6029, z: 14801 },
    { id: 'home', label: 'Home Beach', x: 5328, z: 15023 },
    { id: 'deadmans', label: 'Deadmans Beach', x: 7007, z: 14423 },
    { id: 'southgorge', label: 'South Gorge', x: 7499, z: 14311 },
    { id: 'frenchmans', label: 'Frenchmans Beach', x: 7450, z: 14145 },
    { id: 'mainbeach', label: 'Main Beach', x: 6127, z: 8878 },
    { id: 'flinders', label: 'Flinders Beach', x: 1974, z: 15757 },
    { id: 'amity', label: 'Amity Point', x: -2960, z: 17833 }
  ];

  const surf = world.publish('surf', { swellM: 0, periodS: 0, dirDeg: 0, breaks: [], note: '' });

  let bed = null;              // baked seabed arrays
  let wave = null;             // { data, shelter, delay } for the current swell direction
  let waveBucket = null;
  const waveCache = new Map();

  function idxAt(x, z) {
    let i = Math.round((x - BOX.x0) / HX - 0.5);
    let j = Math.round((z - BOX.z0) / HZ - 0.5);
    i = i < 0 ? 0 : i > NX - 1 ? NX - 1 : i;
    j = j < 0 ? 0 : j > NZ - 1 ? NZ - 1 : j;
    return j * NX + i;
  }

  function ensureBed() {
    if (bed) return bed;
    const t0 = performance.now();
    const hf = world.island && typeof world.island.height === 'function'
      ? (x, z) => world.island.height(x, z) : null;
    bed = bakeSeabed(model, hf);
    bed.fromTerrain = !!hf;
    console.info('[ocean] seabed baked in ' + Math.round(performance.now() - t0) + ' ms'
      + (hf ? ' from world.island.height' : ' from the stand-in island model'));
    // Resolve each break to a point in about three metres of water, straight offshore.
    for (const brk of BREAKS) {
      let bx = brk.x, bz = brk.z, found = false;
      for (let step = 40; step <= 900; step += 40) {
        // Walk down the local gradient of the seabed until it is deep enough to shoal on.
        const k0 = idxAt(bx, bz);
        const gx = bed.elev[Math.min(NX * NZ - 1, k0 + 1)] - bed.elev[Math.max(0, k0 - 1)];
        const gz = bed.elev[Math.min(NX * NZ - 1, k0 + NX)] - bed.elev[Math.max(0, k0 - NX)];
        const L = Math.hypot(gx, gz) || 1;
        bx -= (gx / L) * 40; bz -= (gz / L) * 40;
        if (bed.elev[idxAt(bx, bz)] < -3.0) { found = true; break; }
      }
      brk.sx = bx; brk.sz = bz; brk.resolved = found;
    }
    return bed;
  }

  function ensureWave(dirDeg, periodS) {
    ensureBed();
    const bucket = Math.round(dirDeg / 22.5) * 22.5;
    if (waveBucket === bucket && wave) return wave;
    let entry = waveCache.get(bucket);
    if (!entry) {
      const t0 = performance.now();
      entry = bakeWaveField(bed.elev, bucket, 1.02, 10);
      console.info('[ocean] wave field for ' + bucket + ' deg baked in '
        + Math.round(performance.now() - t0) + ' ms');
      if (waveCache.size > 5) waveCache.clear();
      waveCache.set(bucket, entry);
    }
    wave = entry;
    waveBucket = bucket;
    return wave;
  }

  /* --------------------------------------------------------------- surf read model */

  world.register({
    id: 'surf',
    phase: 'presentation',
    order: 20,
    init(w) { ensureBed(); ensureWave(105, 10); },
    tick(w) {
      const wx = w.read('weather');
      const td = w.read('tide');
      if (!wx || !bed) return;
      ensureWave(wx.swellDirDeg || 105, wx.swellPeriodS || 10);
      surf.swellM = +(wx.swellM || 0).toFixed(2);
      surf.periodS = +(wx.swellPeriodS || 0).toFixed(1);
      surf.dirDeg = Math.round(wx.swellDirDeg || 0);
      const level = td ? td.height : 1.02;
      const out = [];
      for (const brk of BREAKS) {
        const k = idxAt(brk.sx ?? brk.x, brk.sz ?? brk.z);
        const elev = bed.elev[k];
        const bayMix = bed.bay[k];
        const expo = wave ? wave.exposure[k] : 1;
        const depth = Math.max(0.25, level - elev);
        const c0 = (G * (wx.swellPeriodS || 10)) / (2 * Math.PI);
        const c = Math.min(c0, Math.sqrt(G * depth));
        const Ks = Math.sqrt(c0 * 0.5 / Math.max(c * 0.75, 0.4));
        const H = (wx.swellM || 0) * Ks * expo * (1 - bayMix * 0.88);
        // Peel: the angle between the crest and the shore. Parallel closes out, oblique peels.
        const wdx = wave ? wave.dirX[k] : 1, wdz = wave ? wave.dirZ[k] : 0;
        const gx = bed.elev[Math.min(NX * NZ - 1, k + 2)] - bed.elev[Math.max(0, k - 2)];
        const gz = bed.elev[Math.min(NX * NZ - 1, k + NX * 2)] - bed.elev[Math.max(0, k - NX * 2)];
        const gl = Math.hypot(gx, gz) || 1;
        const cosA = Math.abs(wdx * (gx / gl) + wdz * (gz / gl));
        const peelDeg = Math.round(Math.acos(Math.max(0, Math.min(1, cosA))) * 180 / Math.PI);
        const breaking = H > 0.78 * depth * 0.55 && H > 0.25;
        out.push({
          id: brk.id, label: brk.label,
          faceM: +H.toFixed(2),
          exposure: +expo.toFixed(2),
          depthM: +depth.toFixed(2),
          peelDeg,
          shape: !breaking ? 'flat' : peelDeg > 26 ? 'peeling' : peelDeg > 12 ? 'running' : 'closing out',
          size: H < 0.3 ? 'flat' : H < 0.8 ? 'small' : H < 1.6 ? 'fun' : H < 2.6 ? 'solid' : 'big'
        });
      }
      out.sort((a, b) => b.faceM - a.faceM);
      surf.breaks = out;
      const best = out[0];
      surf.note = best
        ? `${best.label}: ${best.size}, ${best.shape}, ${best.faceM} m face`
        : '';
    },
    describe() {
      return {
        swellM: surf.swellM, periodS: surf.periodS, dirDeg: surf.dirDeg,
        best: surf.breaks[0] ? surf.breaks[0].label : null,
        biggestFaceM: surf.breaks[0] ? surf.breaks[0].faceM : 0,
        sheltered: surf.breaks.filter((b) => b.exposure < 0.6).map((b) => b.id),
        note: surf.note
      };
    },
    save() { return null; },
    load() {}
  });

  if (!world.stage) return;

  /* --------------------------------------------------------------- render layer */

  let waterMat = null, sandMat = null, waterMesh = null, sandMesh = null;
  let bathyTex = null, waveTex = null, noiseTex = null;
  let standIn = true;
  let t = 0;
  let wetLevel = 1.0;
  let lastSimMin = null;
  let uploadedBucket = null;
  let checkedTerrain = 0;

  const tmpTide = new B.Vector4(1, 1, 1, 1);
  const vCentre = new B.Vector3(0, 0, 12000);
  const vBox = new B.Vector4(BOX.x0, BOX.z0, BOX.w, BOX.h);
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.2, 0.42, 0.78, 0.2);
  const vSkyHz = new B.Vector4(0.62, 0.75, 0.88, 0.4);
  const vEnv = new B.Vector4(10, 0.2, 0, 1);
  const vWater = new B.Vector4(0.9, 0.55, 0.00013, 0);
  const vFoam = new B.Vector4(3.0, 0.30, 0.42, 0.011);
  const vSurfP = new B.Vector4(1, 1, 1, 0.42);
  const vSwellDir = new B.Vector4(0, 1, 15.6, 0.9);
  const vWet = new B.Vector4(1.0, 0.02, 0, 0);
  const sw = [new B.Vector4(0.6, 0.3, 0, 0), new B.Vector4(0.7, 0.16, 0, 1.7), new B.Vector4(0.53, 0.1, 0, 3.1)];
  const ch = [new B.Vector4(1, 0, 0.05, 1), new B.Vector4(1, 0, 0.03, 1), new B.Vector4(1, 0, 0.02, 1)];

  const COMMON_UNIFORMS = ['viewProjection', 'uCentre', 'uBox', 'uTime', 'uTide', 'uCam',
    'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uEnv'];

  world.stage.addLayer({
    id: 'ocean',
    order: 20,

    init(stage, w) {
      const scene = stage.scene;
      ensureBed();
      ensureWave(105, 10);

      bathyTex = new B.RawTexture(packSeabed(bed), NX, NZ, B.Engine.TEXTUREFORMAT_RGBA, scene,
        false, false, B.Texture.BILINEAR_SAMPLINGMODE, B.Engine.TEXTURETYPE_HALF_FLOAT);
      waveTex = new B.RawTexture(wave.data, NX, NZ, B.Engine.TEXTUREFORMAT_RGBA, scene,
        false, false, B.Texture.BILINEAR_SAMPLINGMODE, B.Engine.TEXTURETYPE_HALF_FLOAT);
      for (const tx of [bathyTex, waveTex]) {
        tx.wrapU = B.Texture.CLAMP_ADDRESSMODE;
        tx.wrapV = B.Texture.CLAMP_ADDRESSMODE;
      }
      uploadedBucket = waveBucket;
      noiseTex = new B.RawTexture(makeNoiseBytes(rng), 256, 256, B.Engine.TEXTUREFORMAT_RGBA, scene,
        true, false, B.Texture.TRILINEAR_SAMPLINGMODE, B.Engine.TEXTURETYPE_UNSIGNED_INT);
      noiseTex.wrapU = B.Texture.WRAP_ADDRESSMODE;
      noiseTex.wrapV = B.Texture.WRAP_ADDRESSMODE;

      B.Effect.ShadersStore['minjWaterVertexShader'] = WATER_VERT;
      B.Effect.ShadersStore['minjWaterFragmentShader'] = WATER_FRAG;
      B.Effect.ShadersStore['minjSandVertexShader'] = SAND_VERT;
      B.Effect.ShadersStore['minjSandFragmentShader'] = SAND_FRAG;

      waterMat = new B.ShaderMaterial('minjWater', scene,
        { vertex: 'minjWater', fragment: 'minjWater' }, {
          attributes: ['position'],
          uniforms: COMMON_UNIFORMS.concat(['uSwell0', 'uSwell1', 'uSwell2',
            'uChop0', 'uChop1', 'uChop2', 'uSwellDir', 'uSurf', 'uWater', 'uFoamP']),
          samplers: ['bathyTex', 'waveTex', 'noiseTex'],
          needAlphaBlending: true
        });
      waterMat.backFaceCulling = false;
      waterMat.forceDepthWrite = true;
      waterMat.setTexture('bathyTex', bathyTex);
      waterMat.setTexture('waveTex', waveTex);
      waterMat.setTexture('noiseTex', noiseTex);

      sandMat = new B.ShaderMaterial('minjSand', scene,
        { vertex: 'minjSand', fragment: 'minjSand' }, {
          attributes: ['position'],
          uniforms: COMMON_UNIFORMS.concat(['uWet']),
          samplers: ['bathyTex', 'noiseTex']
        });
      sandMat.backFaceCulling = false;
      sandMat.setTexture('bathyTex', bathyTex);
      sandMat.setTexture('noiseTex', noiseTex);

      waterMesh = buildDisc(scene, 'minjWaterDisc', 104, 132, 7.2);
      waterMesh.material = waterMat;
      sandMesh = buildDisc(scene, 'minjSandDisc', 104, 132, 7.2);
      sandMesh.material = sandMat;

      standIn = !(w.island || stage.layer('terrain'));
      sandMesh.setEnabled(standIn);

      // Nothing else owns the camera in an isolated ?only=ocean run, so park it on the surf.
      if (!w.system('camera') && stage.camera && stage.camera.setTarget) {
        stage.camera.setTarget(new B.Vector3(7000, 0, 12600));
        stage.camera.alpha = 0.35;
        stage.camera.beta = 1.14;
        stage.camera.radius = 1500;
      }
    },

    frame(stage, w, dt) {
      if (!waterMat) return;
      t += Math.min(0.1, dt || 0.016);

      const tide = w.read('tide');
      const wx = w.read('weather');
      const dl = w.read('daylight');

      // Tide, per station, blended across the box so high water at Amity is not high water
      // at the Gorge. Corners are south-west, south-east, north-west, north-east.
      const st = tide && tide.stations ? tide.stations : null;
      const base = tide ? tide.height : 1.02;
      tmpTide.set(
        st && st.dunwich != null ? st.dunwich : base,
        st && st.mainbeach != null ? st.mainbeach : base,
        st && st.amity != null ? st.amity : base,
        st && st.gorge != null ? st.gorge : base
      );

      // Wet sand memory: the band the water has covered recently, drying as the tide drops.
      const simMin = w.clock.dayIndex * 1440 + w.clock.minuteOfDay;
      const dMin = lastSimMin === null ? 0 : Math.max(0, Math.min(720, simMin - lastSimMin));
      lastSimMin = simMin;
      const swellM = wx ? wx.swellM : 1.0;
      const instantWet = base + Math.min(1.3, 0.42 * swellM + 0.12);
      if (instantWet > wetLevel) wetLevel = instantWet;
      else wetLevel += (instantWet - wetLevel) * (1 - Math.exp(-dMin / 38));
      vWet.set(wetLevel, 0.02, tide ? tide.springNeap : 0.5, t);

      // Sun. Direction to the sun in world axes: x east, z north.
      const alt = dl ? dl.altitude : 0.6;
      const az = dl ? dl.azimuth : 0.9;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), Math.max(0, Math.min(1, (sy + 0.06) / 0.22)));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = Math.max(0, Math.min(1, (sy - 0.02) / 0.30));
      const dayF = vSun.w;
      vSunCol.set(
        1.0,
        0.40 + 0.56 * warm,
        0.16 + 0.74 * warm,
        (0.06 + 1.14 * dayF) * (1 - cloud * 0.55)
      );
      vSky.set(
        0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF,
        cloud
      );
      vSkyHz.set(
        0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF,
        0.4
      );

      // Swell and wind.
      const swellDir = wx ? wx.swellDirDeg : 105;
      const period = Math.max(4, wx ? wx.swellPeriodS : 9);
      const windKt = wx ? wx.windKt : 10;
      const windDir = wx ? wx.windDirDeg : 110;
      ensureWave(swellDir, period);
      if (waveBucket !== uploadedBucket && wave) {
        waveTex.update(wave.data);
        uploadedBucket = waveBucket;
      }
      const sdTh = ((waveBucket + 180) * Math.PI) / 180;
      const sdx = Math.sin(sdTh), sdz = Math.cos(sdTh);
      const c0ref = (G * 10) / (2 * Math.PI);
      vSwellDir.set(sdx, sdz, c0ref, 0.95);

      const halfH = Math.max(0.02, swellM * 0.5);
      const pieces = [0.56, 0.28, 0.16];
      const perT = [1.0, 0.86, 1.19];
      const spread = [0.0, 0.16, -0.21];
      for (let i = 0; i < 3; i++) {
        const om = (2 * Math.PI) / (period * perT[i]);
        const k0 = (om * om) / G;
        sw[i].set(om, halfH * pieces[i], k0 * spread[i], [0, 1.7, 3.1][i]);
      }

      // Wind chop. Short, steep, and it only exists where the wind has been blowing.
      const U = windKt * 0.5144;
      const wTh = ((windDir + 180) * Math.PI) / 180;
      const wdx = Math.sin(wTh), wdz = Math.cos(wTh);
      vEnv.set(windKt, cloud, wdx, wdz);
      const chopH = Math.min(1.1, 0.0105 * U * U);
      const lens = [2.4, 5.6, 11.5];
      const amps = [0.34, 0.40, 0.26];
      const angles = [0, 0.42, -0.36];
      for (let i = 0; i < 3; i++) {
        const kk = (2 * Math.PI) / lens[i];
        const a = Math.atan2(wdx, wdz) + angles[i];
        ch[i].set(kk * Math.sin(a), kk * Math.cos(a), chopH * 0.5 * amps[i], Math.sqrt(G * kk));
      }

      // Glassy: light wind, and the first hours after sunrise before the sea breeze fills in.
      const minsAfterSunrise = dl ? (w.clock.minuteOfDay - dl.sunriseMin) : 300;
      const morning = minsAfterSunrise > -30 && minsAfterSunrise < 210 ? 1 : 0;
      const glass = Math.max(0, Math.min(1, (9 - windKt) / 7)) * (0.45 + 0.55 * morning);
      vSurfP.set(1.0, Math.max(0.08, 1 - glass * 0.85), 1.0, 0.34);
      vWater.set(0.85, 0.30 + Math.min(0.9, windKt * 0.035), 0.000085, glass);
      vFoam.set(3.1, 0.30, 0.45, 0.010);

      // Where to put the disc: the point the camera is looking at on the water, so the
      // vertices land where the player is actually looking rather than under their feet.
      const cam = stage.scene.activeCamera || stage.camera;
      const cp = cam.globalPosition || cam.position;
      let fwd;
      if (cam.getForwardRay) fwd = cam.getForwardRay(1).direction;
      else fwd = new B.Vector3(0, -1, 0);
      const camH = Math.max(1.2, cp.y - base);
      let cx = cp.x, cz = cp.z;
      if (fwd.y < -0.02) {
        const tt = Math.min(camH / -fwd.y, 9000);
        cx = cp.x + fwd.x * tt; cz = cp.z + fwd.z * tt;
      } else {
        cx = cp.x + fwd.x * 2500; cz = cp.z + fwd.z * 2500;
      }
      const reach = Math.hypot(cx - cp.x, cz - cp.z);
      const scale = Math.max(2600, Math.min(46000, camH * 12 + reach * 1.35 + 900));
      vCentre.set(cx, cz, scale);

      const mats = standIn ? [waterMat, sandMat] : [waterMat];
      for (const m of mats) {
        m.setVector3('uCentre', vCentre);
        m.setVector4('uBox', vBox);
        m.setFloat('uTime', t);
        m.setVector4('uTide', tmpTide);
        m.setVector3('uCam', cp);
        m.setVector4('uSun', vSun);
        m.setVector4('uSunCol', vSunCol);
        m.setVector4('uSky', vSky);
        m.setVector4('uSkyHz', vSkyHz);
        m.setVector4('uEnv', vEnv);
      }
      waterMat.setVector4('uSwell0', sw[0]);
      waterMat.setVector4('uSwell1', sw[1]);
      waterMat.setVector4('uSwell2', sw[2]);
      waterMat.setVector4('uChop0', ch[0]);
      waterMat.setVector4('uChop1', ch[1]);
      waterMat.setVector4('uChop2', ch[2]);
      waterMat.setVector4('uSwellDir', vSwellDir);
      waterMat.setVector4('uSurf', vSurfP);
      waterMat.setVector4('uWater', vWater);
      waterMat.setVector4('uFoamP', vFoam);
      if (standIn) sandMat.setVector4('uWet', vWet);

      // Stand down the stand-in sand the moment a real terrain turns up, and rebake the seabed
      // from its heights so the waterline sits on the real beach rather than on this stub.
      if (standIn && ++checkedTerrain % 90 === 0 && (w.island || stage.layer('terrain'))) {
        standIn = false;
        sandMesh.setEnabled(false);
        if (w.island && typeof w.island.height === 'function' && !bed.fromTerrain) {
          const p0 = performance.now();
          for (let i = 0; i < 4000; i++) w.island.height(i * 3 - 6000, i * 7 - 12000);
          const per = (performance.now() - p0) / 4000;
          if (per * NX * NZ < 2500) {
            bed = null; wave = null; waveBucket = null; waveCache.clear();
            ensureBed(); ensureWave(swellDir, period);
            bathyTex.update(packSeabed(bed));
            waveTex.update(wave.data);
            uploadedBucket = waveBucket;
          } else {
            console.info('[ocean] world.island.height too slow to bake ('
              + per.toFixed(3) + ' ms a sample), keeping the modelled seabed');
          }
        }
      }
    },

    dispose() {
      for (const o of [waterMesh, sandMesh, waterMat, sandMat, bathyTex, waveTex, noiseTex]) {
        if (o && o.dispose) o.dispose();
      }
      waterMat = sandMat = null;
    }
  });

  /* --------------------------------------------------------------- packing helpers */

  function packSeabed(b) {
    const N = NX * NZ;
    const out = new Uint16Array(N * 4);
    for (let k = 0; k < N; k++) {
      const o = k * 4;
      out[o] = toHalf(b.elev[k]);
      out[o + 1] = toHalf(b.bay[k]);
      out[o + 2] = toHalf(b.rock[k]);
      out[o + 3] = toHalf(Math.max(-4000, Math.min(4000, b.sdist[k])));
    }
    return out;
  }
}

/* Seamless value noise for the detail texture and the seabed model. Tiles on a lattice that
   divides the texture size, so the water never shows a repeat seam. */
function makeIslandNoise(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x9e3779b9) | 0;
    let x = s ^ (s >>> 16);
    x = Math.imul(x, 0x21f0aaad);
    x = x ^ (x >>> 15);
    x = Math.imul(x, 0x735a2d97);
    return ((x = x ^ (x >>> 15)) >>> 0) / 4294967296;
  };
  const P = 256;
  const grid = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) grid[i] = rand();
  const fade = (a) => a * a * a * (a * (a * 6 - 15) + 10);
  function value(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
    const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = grid[y0 * P + x0], b = grid[y0 * P + x1];
    const c = grid[y1 * P + x0], d = grid[y1 * P + x1];
    const top = a + (b - a) * xf, bot = c + (d - c) * xf;
    return (top + (bot - top) * yf) * 2 - 1;
  }
  const noise = (x, y) => value(x, y);
  noise.fbm = function (x, y, oct = 3) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * value(x * f, y * f);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  };
  noise.rand = rand;
  return noise;
}

/** 256x256 RGBA detail texture, tiling, generated from the ocean stream so it is deterministic. */
function makeNoiseBytes(rng) {
  const S = 256;
  const out = new Uint8Array(S * S * 4);
  const lattices = [];
  for (const p of [8, 16, 32, 64]) {
    const g = new Float32Array(p * p);
    for (let i = 0; i < p * p; i++) g[i] = rng.float();
    lattices.push({ p, g });
  }
  const fade = (a) => a * a * a * (a * (a * 6 - 15) + 10);
  const samp = (L, u, v) => {
    const x = u * L.p, y = v * L.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const x0 = ((xi % L.p) + L.p) % L.p, y0 = ((yi % L.p) + L.p) % L.p;
    const x1 = (x0 + 1) % L.p, y1 = (y0 + 1) % L.p;
    const a = L.g[y0 * L.p + x0], b = L.g[y0 * L.p + x1];
    const c = L.g[y1 * L.p + x0], d = L.g[y1 * L.p + x1];
    const t1 = a + (b - a) * xf, t2 = c + (d - c) * xf;
    return t1 + (t2 - t1) * yf;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S, v = j / S;
      const f1 = samp(lattices[0], u, v) * 0.55 + samp(lattices[1], u, v) * 0.30 + samp(lattices[2], u, v) * 0.15;
      const f2 = samp(lattices[1], u + 0.31, v - 0.17) * 0.6 + samp(lattices[3], u, v) * 0.4;
      const f3 = samp(lattices[2], u - 0.44, v + 0.23) * 0.7 + samp(lattices[0], u * 2, v * 2) * 0.3;
      const f4 = samp(lattices[3], u + 0.11, v + 0.61);
      const o = (j * S + i) * 4;
      out[o] = Math.max(0, Math.min(255, Math.round(f1 * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(f2 * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(f3 * 255)));
      out[o + 3] = Math.max(0, Math.min(255, Math.round(f4 * 255)));
    }
  }
  return out;
}
