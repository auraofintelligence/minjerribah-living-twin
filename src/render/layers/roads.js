// Roads, tracks and the two beach highways of Minjerribah.
//
// Every centreline in here is a real gazetted road from data/geography.json. Nothing is invented:
// if a street is not in the pack it is not drawn, and no road in this file carries a name that is
// not already published in the pack. The island's network is genuinely small and genuinely fragile,
// and that is the point of modelling it properly:
//
//   * East Coast Road is the whole island. Fifteen kilometres from the barge ramp at Dunwich
//     (Goompi) to Point Lookout (Mooloomba), two lanes, no parallel route. Every ferry arrival,
//     both bus routes, every ambulance and every grocery pallet is on it. Cut it anywhere and the
//     island is cut, because the only detour is sand and needs a four wheel drive.
//   * Beehive Road is the Amity turn-off and the sole sealed access to Amity Point (Pulan).
//   * Main Beach and Flinders Beach are gazetted roads. Thirty-five kilometres of Main Beach and
//     ten of Flinders are legally driveable, at 60 and 40 km/h, four wheel drive only, on a permit
//     from Minjerribah Camping, and closed for two hours either side of every high tide. That is
//     four hours of every tide cycle when a third of the island's road network is under water.
//     It is the strangest true thing about driving here and it is modelled as a road, not scenery.
//
// The beach route geometry in the pack is explicitly flagged as a derived line offset from the
// coastline, indicative only, and the pack says in as many words: do not use it as a road
// centreline. So it is not drawn as a ribbon. It is drawn as wheel tracks in the sand that vanish
// under the tide, and the graph edge carries the tide gate rather than pretending to a surveyed
// alignment.
//
// The layer publishes world.state 'roadNetwork': nodes, edges, lengths, speed limits, surfaces and
// an A* over the lot. That is the contract the movement and traffic systems path on. It is built
// with no Babylon at all, so `node tools/headless.mjs --system roads` works.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

/* ------------------------------------------------------------------ classes and defaults

Widths are the carriageway, in metres, edge to edge. Queensland rural two lane seal is about
6.2 m of pavement with a metre of gravel each side; a township street here is narrower than that
and has no line marking at all, which is true of Dickson Way, Junner Street and Ballow Street and
is the sort of thing a resident notices immediately if you get it wrong. */

const CLASSES = {
  spine:       { width: 6.6, shoulder: 1.30, marking: 'dashed', speed: 80, surface: 'asphalt', grade: 0.09, smooth: 150, maxStep: 46, sealed: true },
  sealed:      { width: 6.0, shoulder: 0.95, marking: 'edge',   speed: 60, surface: 'asphalt', grade: 0.11, smooth: 90,  maxStep: 38, sealed: true },
  street:      { width: 5.6, shoulder: 0.55, marking: 'none',   speed: 50, surface: 'asphalt', grade: 0.13, smooth: 46,  maxStep: 26, sealed: true },
  gravel:      { width: 5.0, shoulder: 0.50, marking: 'none',   speed: 40, surface: 'gravel',  grade: 0.14, smooth: 40,  maxStep: 28, sealed: false },
  sandtrack:   { width: 3.7, shoulder: 0.40, marking: 'none',   speed: 30, surface: 'sand',    grade: 0.20, smooth: 26,  maxStep: 26, sealed: false },
  beachaccess: { width: 3.4, shoulder: 0.35, marking: 'none',   speed: 20, surface: 'sand',    grade: 0.24, smooth: 18,  maxStep: 20, sealed: false },
  beachroute:  { width: 9.0, shoulder: 0.00, marking: 'none',   speed: 60, surface: 'sand',    grade: 0.30, smooth: 60,  maxStep: 44, sealed: false },
  walk:        { width: 1.15, shoulder: 0.00, marking: 'none',  speed: 5,  surface: 'track',   grade: 0.34, smooth: 12,  maxStep: 22, sealed: false }
};

/** Pack road `type` to the class above. */
function classOf(road) {
  switch (road.type) {
    case 'sealed_road': return /east coast/i.test(road.name) ? 'spine' : 'sealed';
    case 'street': return 'street';
    case 'unsealed_road': return 'gravel';
    case 'track_4wd': return 'sandtrack';
    case 'walking_track': return 'walk';
    case 'beach_access_track': return 'beachaccess';
    case 'beach_route': return 'beachroute';
    default: return 'sealed';
  }
}

/* Alfred Martin Way is one road with three surfaces: the pack's own surface field says
   "asphalt, unpaved, sand" and data/transport.json cites the two OpenStreetMap sample points
   where it changes, secondary at 153.4506 and track at 153.4965. Those two longitudes are the
   only published evidence for where the seal stops, so they are the thresholds used here rather
   than a number somebody liked the look of. */
const MIXED_SURFACE = {
  'road-alfred-martin-way': [
    { untilLon: 153.4506, cls: 'sealed' },
    { untilLon: 153.4965, cls: 'gravel' },
    { untilLon: 999, cls: 'sandtrack' }
  ],
  'road-ballow-road': [
    { untilLon: 153.4062, cls: 'street' },
    { untilLon: 999, cls: 'gravel' }
  ]
};

/** Surface colours. Chip seal on this island is a pale grey-brown that has been in the sun for
 *  years, not the black asphalt of a city arterial. Sand tracks are quartz white with the ruts
 *  darker where the sand is compacted and damp under the surface. */
const SURFACE_COLOUR = {
  // Sun bleached chip seal, not city asphalt. Fresh bitumen is nearly black, but nothing here is
  // fresh: the spray seal on this island is a pale grey-brown with the aggregate showing through,
  // and rendering it at a photometric albedo made a line of black slots through a green township.
  asphalt:  [0.300, 0.292, 0.278],
  gravel:   [0.505, 0.452, 0.352],
  sand:     [0.680, 0.628, 0.492],
  track:    [0.618, 0.566, 0.436],
  shoulder: [0.438, 0.392, 0.302],
  batter:   [0.520, 0.494, 0.372],
  rock:     [0.360, 0.344, 0.316]
};
const ROUGH = { asphalt: 0.05, gravel: 0.62, sand: 0.92, track: 0.86, shoulder: 0.7, batter: 0.85, rock: 0.4 };

/* How close two road ends have to be before they are treated as the same junction. A sealed road
   in the pack is surveyed and lands within a few metres; a sand track is a GPS trace through a
   dune field; and the two beach routes are explicitly a derived offset from the coastline rather
   than a driving line, so an access track that reaches the sand may be a hundred metres from the
   line that stands in for the beach highway. The tolerance follows the confidence of the data. */
const SNAP_BY_CLASS = {
  spine: 22, sealed: 22, street: 22, gravel: 55, sandtrack: 70, beachaccess: 70, walk: 55, beachroute: 150
};
const snapFor = (cls) => SNAP_BY_CLASS[cls] || 22;
const SNAP = 150;             // the widest tolerance, used to size the welding grid
const TIDE_CLOSED_MIN = 120;  // the permit condition: no beach driving 2 h either side of high tide
const SEMIDIURNAL_MIN = 745;  // one M2 tide cycle, 12 h 25 min

/* ------------------------------------------------------------------ small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

/** Closest point on segment ab to p, returned as {t, x, z, d2}. */
function closestOnSeg(px, pz, ax, az, bx, bz, out) {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + vx * t, z = az + vz * t;
  out.t = t; out.x = x; out.z = z; out.d2 = dist2(px, pz, x, z);
  return out;
}

/** Proper segment intersection, ignoring shared endpoints. Returns {ta, tb} or null. */
function segIntersect(a0, a1, b0, b1) {
  const rx = a1[0] - a0[0], rz = a1[1] - a0[1];
  const sx = b1[0] - b0[0], sz = b1[1] - b0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = b0[0] - a0[0], qpz = b0[1] - a0[1];
  const t = (qpx * sz - qpz * sx) / den;
  const u = (qpx * rz - qpz * rx) / den;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return { ta: t, tb: u };
}

/** Chaikin-style corner cutting. OpenStreetMap ways are polylines of hard corners; a road is not. */
function smoothPolyline(pts, passes) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    if (p.length < 3) break;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Walk a polyline at a fixed spacing, so curvature and terrain can be measured evenly. */
function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [[pts[0][0], pts[0][1]]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1];
    const bx = pts[i][0], bz = pts[i][1];
    const seg = Math.hypot(bx - ax, bz - az);
    if (seg < 1e-6) continue;
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.35) out.push([last[0], last[1]]);
  return out;
}

/* ------------------------------------------------------------------ the network */

/**
 * Build the graph. No Babylon, no DOM: this is the half that has to run in Node so the traffic
 * system can be tested headless.
 */
function buildNetwork(world) {
  const island = world.island;
  const geo = (world.data && world.data.geography) || null;
  const transport = (world.data && world.data.transport) || null;
  const notes = [];
  if (!geo || !Array.isArray(geo.roads) || !island || typeof island.height !== 'function') {
    notes.push('no geography pack or no island: there is no road network to build.');
    return { nodes: [], edges: [], notes, ready: false };
  }

  // Operating attributes: speed limits, permits, tide rules. Keyed by the same road id the
  // geometry uses, so the two packs stay joined rather than duplicated.
  const opsById = new Map();
  const opsByName = new Map();
  for (const s of (transport && transport.road_segments) || []) {
    opsById.set(s.id, s);
    // Roads that arrive from OpenStreetMap in disconnected parts carry the operating attributes
    // on one part only. Junner Street part 3 is still Junner Street and is still fifty.
    if (s.name && !opsByName.has(s.name)) opsByName.set(s.name, s);
  }

  /* ---- 1. read the pack into local metres ---- */

  const raw = [];
  for (const r of geo.roads) {
    if (!Array.isArray(r.coordinates) || r.coordinates.length < 2) continue;
    const pts = [];
    for (const c of r.coordinates) {
      const p = island.project(c[0], c[1]);
      const prev = pts[pts.length - 1];
      if (prev && dist2(prev[0], prev[1], p.x, p.z) < 0.25) continue;   // OSM ways repeat vertices
      pts.push([p.x, p.z, c[0]]);                                       // carry lon for the mixed surfaces
    }
    if (pts.length < 2) continue;
    const cls = classOf(r);
    const plainName = (r.name || '').replace(/\s*\(part \d+\)\s*$/i, '');
    const ops = opsById.get(r.id) || opsByName.get(plainName) || null;
    raw.push({
      id: r.id,
      name: (r.name || 'road').replace(/\s*\(part \d+\)\s*$/i, ''),
      cls,
      pts,
      type: r.type,
      packSurface: r.surface || null,
      lengthKm: r.length_km || polylineLength(pts) / 1000,
      speed: ops && Number.isFinite(ops.speed_limit_kmh) ? ops.speed_limit_kmh : CLASSES[cls].speed,
      speedBasis: ops ? (ops.speed_limit_basis || 'published') : 'class default, not signposted',
      speedConfidence: ops ? (ops.speed_limit_confidence || 'medium') : 'low',
      fourWd: !!r.four_wd_only || cls === 'sandtrack' || cls === 'beachaccess' || cls === 'beachroute',
      permit: !!r.permit_required,
      tideDependent: !!r.tide_dependent,
      township: (ops && ops.township) || null,
      role: (ops && ops.role) || r.note || null,
      note: r.note || null,
      source: r.source || 'data/geography.json'
    });
  }
  if (!raw.length) {
    notes.push('the geography pack has no usable road geometry.');
    return { nodes: [], edges: [], notes, ready: false };
  }

  /* ---- 2. split at junctions ----
     OpenStreetMap ways meet at shared vertices, but this pack has been simplified and rejoined,
     so ends land near a line rather than on it. Two passes: a proper crossing between two lines,
     and an end that lands within SNAP of another line's interior. Both become a split point, so
     that Bingle Road actually joins East Coast Road in the graph instead of stopping beside it. */

  const splits = raw.map(() => []);           // per road: [{seg, t}]
  const welds = raw.map(() => ({}));          // per road: endpoint index -> [x, z] to move it to
  const tmp = { t: 0, x: 0, z: 0, d2: 0 };

  for (let a = 0; a < raw.length; a++) {
    // The derived beach line's own ends are arbitrary: they are the ends of an offset curve, not
    // a junction. It gets split by other roads reaching it, and never reaches for anything itself.
    if (raw[a].cls === 'beachroute') continue;
    for (let b = 0; b < raw.length; b++) {
      if (a === b) continue;
      const A = raw[a].pts, Bp = raw[b].pts;
      const tol = Math.max(snapFor(raw[a].cls), snapFor(raw[b].cls));
      // ends of A onto the interior of B. Where that happens, B gets a junction and A's end is
      // moved onto it, so a track that reaches the beach actually meets the beach highway.
      for (const endIdx of [0, A.length - 1]) {
        const px = A[endIdx][0], pz = A[endIdx][1];
        let best = null;
        for (let j = 0; j < Bp.length - 1; j++) {
          closestOnSeg(px, pz, Bp[j][0], Bp[j][1], Bp[j + 1][0], Bp[j + 1][1], tmp);
          if (tmp.d2 < tol * tol && (!best || tmp.d2 < best.d2)) best = { seg: j, t: tmp.t, d2: tmp.d2, x: tmp.x, z: tmp.z };
        }
        if (best && best.t > 0.02 && best.t < 0.98) {
          splits[b].push({ seg: best.seg, t: best.t });
          const prior = welds[a][endIdx];
          if (!prior || best.d2 < prior[2]) welds[a][endIdx] = [best.x, best.z, best.d2];
        }
      }
      // proper crossings, only tested once per pair, and never against the derived beach line
      if (b > a && raw[b].cls !== 'beachroute') {
        for (let i = 0; i < A.length - 1; i++) {
          for (let j = 0; j < Bp.length - 1; j++) {
            const hit = segIntersect(A[i], A[i + 1], Bp[j], Bp[j + 1]);
            if (hit) { splits[a].push({ seg: i, t: hit.ta }); splits[b].push({ seg: j, t: hit.tb }); }
          }
        }
      }
    }
  }

  // Move the welded ends before anything is cut, so the split point and the end coincide exactly.
  for (let a = 0; a < raw.length; a++) {
    for (const k of Object.keys(welds[a])) {
      const idx = Number(k), w = welds[a][k];
      raw[a].pts[idx] = [w[0], w[1], raw[a].pts[idx][2]];
    }
  }

  /* ---- 3. cut the roads into edges and weld the ends into nodes ---- */

  const nodes = [];
  const nodeGrid = new Map();                  // coarse hash so welding is not O(n^2)
  const GRID = SNAP * 2;
  const keyOf = (x, z) => `${Math.floor(x / GRID)}:${Math.floor(z / GRID)}`;

  function nodeAt(x, z, label, tol, exclude) {
    const gi = Math.floor(x / GRID), gj = Math.floor(z / GRID);
    let best = null, bd = (tol || 22) * (tol || 22);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const bucket = nodeGrid.get(`${gi + di}:${gj + dj}`);
        if (!bucket) continue;
        for (const n of bucket) {
          if (n === exclude) continue;
          const d = dist2(x, z, n.x, n.z);
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    if (best) {
      if (label && !best.label) best.label = label;
      return best;
    }
    const n = { id: 'n' + nodes.length, x, z, y: island.height(x, z), degree: 0, label: label || null, edges: [] };
    nodes.push(n);
    const k = keyOf(x, z);
    if (!nodeGrid.has(k)) nodeGrid.set(k, []);
    nodeGrid.get(k).push(n);
    return n;
  }

  const edges = [];

  for (let a = 0; a < raw.length; a++) {
    const road = raw[a];
    const cuts = splits[a]
      .slice()
      .sort((p, q) => (p.seg - q.seg) || (p.t - q.t))
      .filter((c, i, arr) => i === 0 || c.seg !== arr[i - 1].seg || Math.abs(c.t - arr[i - 1].t) > 0.01);

    // Walk the polyline, emitting a new edge at every cut.
    let current = [road.pts[0]];
    const pieces = [];
    let ci = 0;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const p0 = road.pts[i], p1 = road.pts[i + 1];
      while (ci < cuts.length && cuts[ci].seg === i) {
        const t = cuts[ci].t;
        const cx = p0[0] + (p1[0] - p0[0]) * t;
        const cz = p0[1] + (p1[1] - p0[1]) * t;
        const clon = p0[2] + (p1[2] - p0[2]) * t;
        current.push([cx, cz, clon]);
        if (polylineLength(current) > 6) pieces.push(current);
        current = [[cx, cz, clon]];
        ci++;
      }
      current.push(p1);
    }
    if (polylineLength(current) > 6) pieces.push(current);
    if (!pieces.length) pieces.push(road.pts);

    for (let pi = 0; pi < pieces.length; pi++) {
      const piece = pieces[pi];
      // A true road end may weld to a neighbouring road end at the class tolerance. An interior
      // split point is already exact, so it only needs enough slack to survive the arithmetic.
      const pieceLen = polylineLength(piece);
      // Never let a tolerance swallow a whole short track: Track 5 on Main Beach is forty-three
      // metres long and a seventy metre weld would collapse it to a point and delete it.
      const cap = Math.max(6, pieceLen * 0.45);
      const tol0 = Math.min(pi === 0 ? snapFor(road.cls) : 12, cap);
      const tol1 = Math.min(pi === pieces.length - 1 ? snapFor(road.cls) : 12, cap);
      const a0 = nodeAt(piece[0][0], piece[0][1], null, tol0);
      const a1 = nodeAt(piece[piece.length - 1][0], piece[piece.length - 1][1], null, tol1, a0);
      if (a0 === a1 && pieceLen < 40) continue;
      const pts = piece.map((p) => [p[0], p[1], p[2]]);
      pts[0][0] = a0.x; pts[0][1] = a0.z;
      pts[pts.length - 1][0] = a1.x; pts[pts.length - 1][1] = a1.z;
      const lengthM = polylineLength(pts);
      if (lengthM < 5) continue;

      // Mixed surface roads change class along their length, from the published sample points.
      let cls = road.cls;
      const mix = MIXED_SURFACE[road.id];
      if (mix) {
        const midLon = pts[Math.floor(pts.length / 2)][2];
        cls = (mix.find((m) => midLon < m.untilLon) || mix[mix.length - 1]).cls;
      }
      const C = CLASSES[cls];

      const e = {
        id: 'e' + edges.length,
        roadId: road.id,
        name: road.name,
        from: a0.id,
        to: a1.id,
        lengthM: +lengthM.toFixed(1),
        speedKmh: cls === road.cls ? road.speed : Math.min(road.speed, C.speed),
        speedBasis: road.speedBasis,
        speedConfidence: road.speedConfidence,
        surface: C.surface,
        cls,
        lanes: cls === 'walk' ? 0 : 2,
        widthM: C.width,
        sealed: C.sealed,
        fourWdOnly: road.fourWd,
        permitRequired: road.permit,
        tideDependent: road.tideDependent || cls === 'beachroute',
        walkOnly: cls === 'walk',
        township: road.township,
        open: true,
        note: road.role || road.note,
        source: road.source
      };
      // Geometry is carried out of the enumerable read model: a probe dumped to JSON should show
      // the graph, not forty thousand coordinates.
      Object.defineProperty(e, 'pts', { value: pts.map((p) => [p[0], p[1]]), enumerable: false });
      edges.push(e);
      a0.edges.push(e.id); a1.edges.push(e.id);
      a0.degree++; a1.degree++;
    }
  }

  /* ---- 3b. the published beach entrances ----
     data/transport.json publishes the access points for the two beach highways, and one of them,
     the George Nothling Drive entrance at Point Lookout, carries a coordinate. The street that
     reaches it is not in the geometry pack, so there is no edge to draw and none is invented. The
     entrance goes in as a node anyway, because a vehicle heading for Main Beach needs somewhere to
     be heading, and the gap is written into the notes so a later pass can close it with real
     geometry rather than with a guess. */

  const accessPoints = [];
  for (const seg of (transport && transport.road_segments) || []) {
    for (const ap of seg.access_points || []) {
      if (!Number.isFinite(ap.lat) || !Number.isFinite(ap.lon)) continue;
      const p = island.project(ap.lon, ap.lat);
      accessPoints.push({
        name: ap.name, route: seg.name, x: p.x, z: p.z, lon: ap.lon, lat: ap.lat,
        y: island.height(p.x, p.z), confidence: ap.confidence || 'medium', note: ap.note || null
      });
    }
  }
  for (const ap of accessPoints) {
    const n = nodeAt(ap.x, ap.z, ap.name, 60);
    n.label = ap.name;
    n.kind = 'beach-entrance';
    ap.nodeId = n.id;
  }
  if (accessPoints.length) {
    notes.push('published beach entrances placed as nodes: '
      + accessPoints.map((a) => a.name).join('; ')
      + '. The streets reaching them are not in data/geography.json, so no connecting edge is drawn.');
  }

  /* ---- 4. name the junctions from the roads that meet at them ---- */

  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const n of nodes) {
    const names = [];
    for (const eid of n.edges) {
      const nm = edgeById.get(eid).name;
      if (!names.includes(nm)) names.push(nm);
    }
    n.roads = names;
    if (n.kind !== 'beach-entrance') n.kind = n.degree >= 3 ? 'junction' : n.degree === 2 ? 'through' : 'end';
    if (!n.label) {
      n.label = names.length > 1 ? names.slice(0, 3).join(' at ') : (names[0] || 'road end');
    }
    n.y = island.height(n.x, n.z);
    n.region = island.regionAt(n.x, n.z);
  }

  /* ---- 5. the read model ---- */

  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.id, n.edges.slice());
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const net = {
    source: 'data/geography.json roads, operating attributes from data/transport.json',
    ready: true,
    nodes,
    edges,
    accessPoints,
    notes,
    counts: { nodes: nodes.length, edges: edges.length },
    lengthKm: {},
    openKm: 0,
    closedKm: 0,
    beachOpen: true,
    beachNextChangeMin: null,
    beachRule: 'No driving on Main Beach or Flinders Beach within 2 hours of high tide. '
      + 'Vehicle Access Permit and a four wheel drive required. Source: Minjerribah Camping.'
  };

  // Lengths by class, which is the honest way to say how much of this island's road network is
  // sand: it is more than half of it.
  for (const e of edges) {
    net.lengthKm[e.cls] = +(((net.lengthKm[e.cls] || 0) + e.lengthM / 1000)).toFixed(2);
  }
  net.driveableKm = +Object.entries(net.lengthKm)
    .filter(([k]) => k !== 'walk').reduce((s, [, v]) => s + v, 0).toFixed(2);
  net.walkingKm = net.lengthKm.walk || 0;

  // Connected components. The pack does not carry every residential street on the island, so some
  // real roads in it genuinely have no mapped connection: Cumming Parade and Meegera Place at
  // Point Lookout are both real and both reach their neighbours by streets that are not in the
  // pack. That is recorded rather than patched, because inventing the missing street would be
  // inventing a road.
  {
    const seen = new Set();
    const comps = [];
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      const stack = [n.id];
      seen.add(n.id);
      const roads = new Set();
      let km = 0, count = 0;
      while (stack.length) {
        const id = stack.pop();
        count++;
        for (const eid of nodeById.get(id).edges) {
          const e = edgeById.get(eid);
          roads.add(e.name);
          km += e.lengthM / 2000;
          const o = e.from === id ? e.to : e.from;
          if (!seen.has(o)) { seen.add(o); stack.push(o); }
        }
      }
      comps.push({ nodes: count, km: +km.toFixed(2), roads: Array.from(roads) });
    }
    comps.sort((a, b) => b.km - a.km);
    net.components = comps.length;
    net.mainNetworkKm = comps.length ? comps[0].km : 0;
    const orphans = comps.slice(1).filter((c) => c.km > 0.15);
    if (orphans.length) {
      notes.push('roads in the pack with no mapped connection to the main network: '
        + orphans.map((c) => c.roads.join('/')).join(', ')
        + '. The streets that join them are not in data/geography.json and are not invented here.');
    }
  }

  /* ---- 6. navigation ---- */

  const nonEnumerable = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: false });

  nonEnumerable(net, 'node', (id) => nodeById.get(id));
  nonEnumerable(net, 'edge', (id) => edgeById.get(id));
  nonEnumerable(net, 'geometry', (edgeOrId) => {
    const e = typeof edgeOrId === 'string' ? edgeById.get(edgeOrId) : edgeOrId;
    return e ? e.pts : null;
  });

  /** Nearest node to a point, optionally filtered (for example: a bus wants a sealed node). */
  nonEnumerable(net, 'nearestNode', (x, z, filter) => {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      if (filter && !filter(n)) continue;
      const d = dist2(x, z, n.x, n.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best ? { node: best, distanceM: Math.sqrt(bd) } : null;
  });

  /** Nearest point anywhere on the network, with the edge and the parameter along it. */
  nonEnumerable(net, 'nearestPoint', (x, z, filter) => {
    let best = null, bd = Infinity;
    const t2 = { t: 0, x: 0, z: 0, d2: 0 };
    for (const e of edges) {
      if (filter && !filter(e)) continue;
      const p = e.pts;
      for (let i = 0; i < p.length - 1; i++) {
        closestOnSeg(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], t2);
        if (t2.d2 < bd) {
          bd = t2.d2;
          best = { edge: e, x: t2.x, z: t2.z, seg: i, segT: t2.t };
        }
      }
    }
    if (!best) return null;
    best.distanceM = Math.sqrt(bd);
    return best;
  });

  /** Position and heading a fraction t along an edge, walking from `fromNode`. */
  nonEnumerable(net, 'pointAt', (edgeOrId, t, fromNode) => {
    const e = typeof edgeOrId === 'string' ? edgeById.get(edgeOrId) : edgeOrId;
    if (!e) return null;
    const p = e.pts;
    const reverse = fromNode && fromNode !== e.from;
    const u = clamp(reverse ? 1 - t : t, 0, 1);
    const target = u * e.lengthM;
    let acc = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const seg = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      if (acc + seg >= target || i === p.length - 2) {
        const f = seg > 0 ? clamp((target - acc) / seg, 0, 1) : 0;
        const x = lerp(p[i][0], p[i + 1][0], f);
        const z = lerp(p[i][1], p[i + 1][1], f);
        let hx = p[i + 1][0] - p[i][0], hz = p[i + 1][1] - p[i][1];
        if (reverse) { hx = -hx; hz = -hz; }
        const L = Math.hypot(hx, hz) || 1;
        return { x, z, y: island.height(x, z), dx: hx / L, dz: hz / L, headingDeg: (Math.atan2(hx, hz) * 180) / Math.PI };
      }
      acc += seg;
    }
    return null;
  });

  /**
   * A* between two nodes. `opts.vehicle` is 'car' | 'fourwd' | 'bus' | 'foot'; a car will not be
   * routed onto sand or onto a beach that the tide has closed, which is exactly the constraint
   * that makes this island's network interesting.
   */
  nonEnumerable(net, 'path', (fromId, toId, opts = {}) => {
    const vehicle = opts.vehicle || 'car';
    const start = nodeById.get(fromId), goal = nodeById.get(toId);
    if (!start || !goal) return null;
    const allowed = (e) => {
      if (e.walkOnly) return vehicle === 'foot';
      if (vehicle === 'foot') return true;
      if (!e.open && !opts.ignoreTide) return false;
      if (e.fourWdOnly && vehicle !== 'fourwd') return false;
      if (vehicle === 'bus' && !e.sealed) return false;
      return true;
    };
    const speedOf = (e) => (vehicle === 'foot' ? 4.5 : Math.max(8, e.speedKmh)) / 3.6;
    const best = 1 / 3.6 / 80;
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z) * best;
    const open = [{ n: start, g: 0, f: h(start) }];
    const came = new Map();
    const gScore = new Map([[start.id, 0]]);
    const closed = new Set();
    let guard = 0;
    while (open.length && guard++ < 20000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.n === goal) break;
      if (closed.has(cur.n.id)) continue;
      closed.add(cur.n.id);
      for (const eid of cur.n.edges) {
        const e = edgeById.get(eid);
        if (!allowed(e)) continue;
        const otherId = e.from === cur.n.id ? e.to : e.from;
        const other = nodeById.get(otherId);
        if (!other || closed.has(otherId)) continue;
        const cost = e.lengthM / speedOf(e);
        const g = cur.g + cost;
        if (g < (gScore.get(otherId) ?? Infinity)) {
          gScore.set(otherId, g);
          came.set(otherId, { edge: e, from: cur.n.id });
          open.push({ n: other, g, f: g + h(other) });
        }
      }
    }
    if (!came.has(goal.id) && start !== goal) return null;
    const seq = [];
    let cur = goal.id;
    while (cur !== start.id) {
      const step = came.get(cur);
      if (!step) return null;
      seq.unshift({ edgeId: step.edge.id, fromNode: step.from, toNode: cur, lengthM: step.edge.lengthM, speedKmh: step.edge.speedKmh, surface: step.edge.surface, name: step.edge.name });
      cur = step.from;
    }
    const lengthM = seq.reduce((s, k) => s + k.lengthM, 0);
    const minutes = seq.reduce((s, k) => s + (k.lengthM / 1000) / Math.max(8, k.speedKmh) * 60, 0);
    return { from: fromId, to: toId, steps: seq, lengthM: +lengthM.toFixed(0), minutes: +minutes.toFixed(1), vehicle };
  });

  return net;
}

/* ------------------------------------------------------------------ the vertical alignment

A road is not draped over the ground: it is graded. The three passes below are what makes a road
read as engineered rather than as a decal, and they matter more on this island than on most,
because a formed pavement across a dune swale is visibly a causeway and a wallum crossing is
visibly a culvert. There is no cutting, deliberately: this layer may not edit the heightfield, so
where the smooth line would go below the ground the road climbs back onto the ground instead. */

function gradeProfile(island, pts, cls) {
  const C = CLASSES[cls];
  const n = pts.length;
  const ground = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ground[i] = island.height(pts[i][0], pts[i][1]);
    s[i] = i === 0 ? 0 : s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const step = n > 1 ? s[n - 1] / (n - 1) : 1;
  const win = Math.max(1, Math.round(C.smooth / Math.max(1, step)));

  // 1. a running mean over the design smoothing length
  const y = new Float64Array(n);
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(n - 1, i + win);
    sum = 0; count = 0;
    for (let k = lo; k <= hi; k++) { sum += ground[k]; count++; }
    y[i] = sum / count;
  }
  // 2. never below the ground plus the pavement itself, and never a silly embankment either
  for (let i = 0; i < n; i++) y[i] = clamp(y[i], ground[i] + 0.12, ground[i] + 3.4);
  // 3. relax the longitudinal grade, then re-apply the ground constraint. A few passes converge.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < n; i++) {
      const d = Math.max(0.5, s[i] - s[i - 1]);
      const maxRise = C.grade * d;
      if (y[i] - y[i - 1] > maxRise) y[i] = y[i - 1] + maxRise;
    }
    for (let i = n - 2; i >= 0; i--) {
      const d = Math.max(0.5, s[i + 1] - s[i]);
      const maxRise = C.grade * d;
      if (y[i] - y[i + 1] > maxRise) y[i] = y[i + 1] + maxRise;
    }
    for (let i = 0; i < n; i++) y[i] = Math.max(y[i], ground[i] + 0.12);
  }
  return { y, ground, s };
}

/** Decimate a dense sampling down to the sections that actually carry information. */
function keyIndices(pts, y, s, cls) {
  const C = CLASSES[cls];
  const keep = [0];
  let lastKept = 0;
  let heading = null;
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i - 1][0], dz = pts[i + 1][1] - pts[i - 1][1];
    const h = Math.atan2(dx, dz);
    let turn = 0;
    if (heading !== null) {
      turn = Math.abs(((h - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    }
    const run = s[i] - s[lastKept];
    // straight-line error of the vertical alignment if this sample is dropped
    const t = (s[i] - s[lastKept]) / Math.max(1e-6, s[i + 1] - s[lastKept]);
    const vErr = Math.abs(y[i] - lerp(y[lastKept], y[i + 1], t));
    if (turn > 0.035 || run > C.maxStep || vErr > 0.22) {
      keep.push(i);
      lastKept = i;
      heading = h;
    } else if (heading === null) {
      heading = h;
    }
  }
  keep.push(pts.length - 1);
  return keep;
}

/* ------------------------------------------------------------------ shaders */

const ROAD_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
void main(void){
  vPos = position;
  vNrm = normal;
  vCol = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}
`;

const ROAD_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
uniform vec3 uCam;
uniform vec4 uSun;      // xyz to the sun, w day factor
uniform vec4 uSunCol;   // rgb, a intensity
uniform vec4 uSky;      // rgb zenith, a cloud
uniform vec4 uSkyHz;    // rgb horizon, a haze
uniform vec4 uTune;     // x fog density, y wetness 0..1, z time, w waterline height
uniform vec4 uMark;     // x marking brightness, y beach fade, z 0, w 0

// Only ever used for the haze a road fades into, so the sun disc terms the sky layer needs are
// left out: nothing on a road is ever going to show a four hundredth power specular from the sky.
vec3 skyColour(vec3 d){
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, sqrt(up));
  float s = max(dot(d, uSun.xyz), 0.0);
  return c + uSunCol.rgb * uSunCol.a * (s * s * s * 0.05);
}

// Cheap value noise, so a sealed surface has chip in it and a sand track has grain. The hash is
// integer arithmetic rather than sin: four transcendentals a tap, at two taps a pixel, over a
// road surface that fills the lower half of a street level frame, is a measurable slice of a
// frame on integrated graphics and it buys nothing a fract cannot.
float hash(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main(void){
  vec3 V = vPos - uCam;
  float dist = length(V);
  V /= max(dist, 0.001);
  vec3 N = normalize(vNrm);
  // Every road surface here is double sided, because a ribbon, a batter, a guard rail web and a
  // culvert headwall are all built as strips and a strip's winding depends on which way the road
  // happens to be running. Turning the normal to face the camera is one line and it means a road
  // is never lit as though the sun were under it, which is what a black stripe through a green
  // township actually was.
  if (dot(N, V) > 0.0) N = -N;
  float rough = vCol.a;

  vec3 base = vCol.rgb;
  // Surface grain. Two octaves is enough at the distance anyone ever sees a road from.
  float near = clamp(1.0 - dist / 260.0, 0.0, 1.0);
  float g = vnoise(vPos.xz * 1.7);
  if (near > 0.0) g = g * 0.55 + vnoise(vPos.xz * 7.3) * 0.45 * near;
  // Chip seal has visible aggregate; a sand track that a hundred cars have driven down is smooth
  // and pale, so the grain is held back on the loose surfaces rather than turned up on them.
  base *= 0.92 + 0.16 * g * (0.9 - rough * 0.55);

  float ndl = max(dot(N, uSun.xyz), 0.0);
  vec3 sun = uSunCol.rgb * uSunCol.a * ndl;
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.5) * (0.30 + 0.34 * clamp(N.y, 0.0, 1.0));
  vec3 col = base * (sun + sky);

  // Sealed road goes glassy when it is wet, and holds a low sun down its length. Sand does not.
  float wet = uTune.y * (1.0 - rough);
  vec3 H = normalize(uSun.xyz - V);
  float spec = pow(max(dot(N, H), 0.0), mix(24.0, 220.0, wet));
  col += uSunCol.rgb * uSunCol.a * spec * (0.03 + 0.55 * wet) * (1.0 - rough * 0.9);
  col *= 1.0 - wet * 0.22;

  // Line marking rides in on the vertex colour alpha being negative, which keeps it in the same
  // mesh and the same draw call as the pavement under it.
  if (uMark.x > 0.0) col *= uMark.x;

  // The beach highways go under the water twice a day. Anything below the waterline is gone.
  if (uMark.y > 0.5) {
    float sub = uTune.w - vPos.y;
    if (sub > 0.02) discard;
    col = mix(col, col * vec3(0.72, 0.80, 0.86), clamp((0.55 + sub) * 1.4, 0.0, 1.0) * 0.55);
  }

  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = skyColour(normalize(vec3(-V.x, max(0.02, -V.y * 0.2 + 0.05), -V.z)));
  hz = mix(vec3(dot(hz, vec3(0.30, 0.59, 0.11))), hz, 0.72) * 0.94;
  col = mix(col, hz, fog * 0.86);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------------ mesh building */

/** A growable triangle soup with position, normal and colour. One of these becomes one draw call. */
function makeSoup() {
  return {
    pos: [], nrm: [], col: [], idx: [],
    vert(x, y, z, r, g, b, a) {
      this.pos.push(x, y, z);
      this.nrm.push(0, 1, 0);
      this.col.push(r, g, b, a);
      return this.pos.length / 3 - 1;
    },
    tri(a, b, c) { this.idx.push(a, b, c); },
    quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); },
    get count() { return this.pos.length / 3; },
    /** Face normals accumulated onto the vertices. Build-time only. */
    finish() {
      const P = this.pos, I = this.idx, N = new Float32Array(P.length);
      for (let i = 0; i < I.length; i += 3) {
        const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
        N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
        N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
      }
      for (let i = 0; i < N.length; i += 3) {
        const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
        N[i] /= L; N[i + 1] /= L; N[i + 2] /= L;
      }
      this.nrm = N;
      return this;
    },
    toMesh(scene, name, mat) {
      if (!this.idx.length) return null;
      const mesh = new B.Mesh(name, scene);
      const vd = new B.VertexData();
      vd.positions = new Float32Array(this.pos);
      vd.normals = this.nrm instanceof Float32Array ? this.nrm : new Float32Array(this.nrm);
      vd.colors = new Float32Array(this.col);
      vd.indices = this.pos.length / 3 > 65000 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
      vd.applyToMesh(mesh, false);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
      return mesh;
    }
  };
}

export function registerRoads(world) {
  const island = world.island;
  const rng = world.rng.stream('roads');

  const net = buildNetwork(world);
  world.publish('roadNetwork', net);

  const R = {
    ready: false, meshes: [], mat: null, beachMat: null, markMat: null,
    culverts: 0, causeways: 0, railM: 0, junctions: 0, sections: 0, tris: 0, buildMs: 0,
    lastHighMin: null, highs: [], beachOpen: true, minsToChange: null
  };

  /* ---- the tide gate on the beach highways -------------------------------
     The permit condition is two hours either side of high water. The tide system publishes its
     turns once a sim-day on the bus, so the absolute times are recorded when that event lands and
     kept fresh by watching the rate change sign in between. Everything reads world.clock. */

  const nowMin = (w) => w.clock.dayIndex * 1440 + w.clock.minuteOfDay;

  function recordTurns(w, turns) {
    const base = nowMin(w);
    for (const t of turns || []) {
      if (t.kind !== 'high') continue;
      const at = base + t.inHours * 60;
      if (!R.highs.some((h) => Math.abs(h - at) < 30)) R.highs.push(at);
    }
    R.highs.sort((a, b) => a - b);
    while (R.highs.length && R.highs[0] < base - SEMIDIURNAL_MIN * 2) R.highs.shift();
  }

  world.bus.on('tide:day', (p) => recordTurns(world, p && p.turns));

  let prevRate = null;
  function updateTideGate(w) {
    const tide = w.read('tide');
    const t = nowMin(w);
    if (tide) {
      if (prevRate !== null && prevRate > 0 && tide.rate <= 0) {
        if (!R.highs.some((h) => Math.abs(h - t) < 60)) { R.highs.push(t); R.highs.sort((a, b) => a - b); }
      }
      prevRate = tide.rate;
    }
    // Extrapolate one cycle forward and back so there is always a window either side of now.
    let nearest = Infinity, signed = Infinity;
    for (const h of R.highs) {
      for (let k = -2; k <= 2; k++) {
        const at = h + k * SEMIDIURNAL_MIN;
        const d = at - t;
        if (Math.abs(d) < Math.abs(nearest)) { nearest = d; signed = d; }
      }
    }
    if (!Number.isFinite(nearest)) { R.beachOpen = true; R.minsToChange = null; return; }
    // signed is minutes to the nearest high water: positive means it is still ahead.
    const closed = Math.abs(signed) < TIDE_CLOSED_MIN;
    R.beachOpen = !closed;
    if (closed) {
      // it reopens two hours after that high water
      R.minsToChange = Math.round(signed + TIDE_CLOSED_MIN);
    } else {
      // it closes two hours before the next high water, which may be the one after this
      const nextHighIn = signed > 0 ? signed : signed + SEMIDIURNAL_MIN;
      R.minsToChange = Math.round(Math.max(0, nextHighIn - TIDE_CLOSED_MIN));
    }
    net.beachOpen = R.beachOpen;
    net.beachNextChangeMin = R.minsToChange;
    let openKm = 0, closedKm = 0;
    for (const e of net.edges) {
      if (e.tideDependent) e.open = R.beachOpen;
      if (e.open) openKm += e.lengthM / 1000; else closedKm += e.lengthM / 1000;
    }
    net.openKm = +openKm.toFixed(2);
    net.closedKm = +closedKm.toFixed(2);
  }

  /* ---- the simulation half ------------------------------------------------ */

  world.register({
    id: 'roads',
    phase: 'infrastructure',
    order: 20,

    init(w) {
      // The tide system runs in the environment phase, so by the time this init is called its
      // read model already holds turns measured from now. Seed the high-water list from it.
      const tide = w.read('tide');
      if (tide && tide.next && tide.next.length) recordTurns(w, tide.next);
      updateTideGate(w);
    },

    tick(w) { updateTideGate(w); },

    describe(w) {
      return {
        nodes: net.counts.nodes,
        edges: net.counts.edges,
        sealedKm: +(((net.lengthKm.spine || 0) + (net.lengthKm.sealed || 0) + (net.lengthKm.street || 0))).toFixed(1),
        sandKm: +(((net.lengthKm.sandtrack || 0) + (net.lengthKm.beachaccess || 0) + (net.lengthKm.beachroute || 0))).toFixed(1),
        beachHighwayOpen: net.beachOpen,
        minutesToChange: net.beachNextChangeMin,
        openKm: net.openKm,
        closedKm: net.closedKm,
        culverts: R.culverts,
        causeways: R.causeways
      };
    },

    save() { return { highs: R.highs.slice(-6) }; },
    load(w, s) { if (s && Array.isArray(s.highs)) R.highs = s.highs.slice(); }
  });

  if (!B || !world.stage || !net.ready) return;

  /* ---- the render layer --------------------------------------------------- */

  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 0.9, 0.8, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.85, 0.4);
  const vTune = new B.Vector4(0.000045, 0, 0, island.seaLevel);
  const camPos = new B.Vector3();
  let wetness = 0;

  world.stage.addLayer({
    id: 'roads',
    order: 24,

    init(stage) {
      const scene = stage.scene;
      const t0 = performance.now();

      const mkMat = (name, beach) => {
        const m = new B.ShaderMaterial(name, scene,
          { vertexSource: ROAD_VERT, fragmentSource: ROAD_FRAG },
          {
            attributes: ['position', 'normal', 'color'],
            uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uMark'],
            needAlphaBlending: false, needAlphaTesting: false
          });
        m.backFaceCulling = false;
        m.setVector4('uMark', new B.Vector4(0, beach ? 1 : 0, 0, 0));
        return m;
      };
      R.mat = mkMat('roadMat', false);
      R.beachMat = mkMat('roadBeachMat', true);
      R.markMat = mkMat('roadMarkMat', false);
      R.markMat.setVector4('uMark', new B.Vector4(3.4, 0, 0, 0));
      R.markMat.zOffset = -6;

      const surface = makeSoup();     // pavement, shoulders, batters, junctions
      const marking = makeSoup();     // painted lines
      const beach = makeSoup();       // the two beach highways and their wheel tracks
      const furniture = makeSoup();   // guard rails, culvert headwalls, guide posts

      /* ---- one edge at a time ---- */
      for (const e of net.edges) {
        const C = CLASSES[e.cls];
        const dense = resample(smoothPolyline(e.pts, e.cls === 'street' || e.cls === 'walk' ? 1 : 2), 4);
        if (dense.length < 2) continue;
        if (e.cls === 'beachroute') { buildBeachRoute(beach, dense); R.sections += dense.length / 3; continue; }
        const prof = gradeProfile(island, dense, e.cls);
        const keep = keyIndices(dense, prof.y, prof.s, e.cls);
        R.sections += keep.length;
        buildRibbon(surface, furniture, dense, prof, keep, e, C);
        // Paint follows the speed limit, not the class. Every marked road on this island is one
        // of the two that carry sixty or more; Dickson Way, Junner Street, Ballow Street and
        // Cumming Parade have no line down the middle and no edge line either, and painting one
        // on them is the first thing a resident would pick.
        const markStyle = (!e.sealed || e.township) ? 'none'
          : e.speedKmh >= 80 ? 'dashed' : e.speedKmh >= 60 ? 'edge' : 'none';
        if (markStyle !== 'none') buildMarking(marking, dense, prof, keep, C, markStyle);
      }

      /* ---- junction pads ---- */
      for (const n of net.nodes) {
        if (n.degree < 3) continue;
        const inc = n.edges.map((id) => net.edge(id)).filter(Boolean);
        if (inc.some((e) => e.cls === 'beachroute')) continue;
        const rad = Math.max(...inc.map((e) => CLASSES[e.cls].width * 0.5 + CLASSES[e.cls].shoulder)) + 1.4;
        const surf = inc.some((e) => e.sealed) ? 'asphalt' : 'sand';
        const col = SURFACE_COLOUR[surf];
        const y = Math.max(island.height(n.x, n.z) + 0.14, ...inc.map(() => island.height(n.x, n.z) + 0.14));
        const c0 = surface.vert(n.x, y + 0.02, n.z, col[0] * 1.02, col[1] * 1.02, col[2] * 1.02, ROUGH[surf]);
        const seg = 12;
        const ring = [];
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const px = n.x + Math.cos(a) * rad, pz = n.z + Math.sin(a) * rad;
          const py = Math.max(y - 0.06, island.height(px, pz) + 0.10);
          ring.push(surface.vert(px, py, pz, col[0], col[1], col[2], ROUGH[surf]));
        }
        for (let i = 0; i < seg; i++) surface.tri(c0, ring[(i + 1) % seg], ring[i]);
        R.junctions++;
      }

      const mk = (soup, name, mat) => {
        const m = soup.finish().toMesh(scene, name, mat);
        if (m) { R.meshes.push(m); R.tris += soup.idx.length / 3; }
        return m;
      };
      mk(surface, 'roads-surface', R.mat);
      mk(marking, 'roads-marking', R.markMat);
      mk(furniture, 'roads-furniture', R.mat);
      const beachMesh = mk(beach, 'roads-beach', R.beachMat);
      if (beachMesh) beachMesh.alphaIndex = 3;

      R.ready = true;
      R.buildMs = performance.now() - t0;
      console.info(`[roads] ${net.counts.edges} edges, ${net.counts.nodes} nodes, `
        + `${Math.round(R.sections)} sections, ${Math.round(R.tris)} triangles in ${R.meshes.length} draw calls, `
        + `${R.junctions} junction pads, ${R.culverts} culverts, ${R.causeways} causeways, `
        + `${Math.round(R.railM)} m of guard rail, built in ${R.buildMs.toFixed(0)} ms`);
    },

    frame(stage, w, dt) {
      if (!R.ready) return;
      const cam = stage.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      const dl = w.read('daylight');
      const wx = w.read('weather');
      const tide = w.read('tide');

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

      // Wet seal after rain, drying back over about twenty minutes of real weather.
      const rain = wx ? clamp(wx.rainMmHr / 4, 0, 1) : 0;
      wetness += (rain - wetness) * Math.min(1, (dt || 0.016) * (rain > wetness ? 0.9 : 0.06));
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      const waterline = (tide ? tide.height : island.seaLevel) + (wx ? Math.min(1.4, wx.swellM * 0.34) : 0.3);
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), wetness, 0, waterline);

      for (const m of [R.mat, R.beachMat, R.markMat]) {
        m.setVector3('uCam', camPos);
        m.setVector4('uSun', vSun);
        m.setVector4('uSunCol', vSunCol);
        m.setVector4('uSky', vSky);
        m.setVector4('uSkyHz', vSkyHz);
        m.setVector4('uTune', vTune);
      }
    },

    dispose() {
      for (const m of R.meshes) m.dispose();
      for (const m of [R.mat, R.beachMat, R.markMat]) if (m) m.dispose();
      R.meshes.length = 0;
      R.ready = false;
    }
  });

  /* ---------------------------------------------------------------- ribbon geometry */

  /**
   * The cross-section, left to right: batter, shoulder, pavement edge, crown, pavement edge,
   * shoulder, batter. Camber sheds water off the crown; superelevation banks the whole section
   * into a curve, capped at six per cent, which is the Austroads figure for this sort of road.
   */
  function buildRibbon(surface, furniture, dense, prof, keep, e, C) {
    const half = C.width * 0.5;
    const sh = C.shoulder;
    const camber = C.sealed ? 0.03 : 0.045;
    const surf = C.surface;
    const pav = SURFACE_COLOUR[surf];
    const shoulderCol = C.sealed ? SURFACE_COLOUR.shoulder : SURFACE_COLOUR[surf];
    const rough = ROUGH[surf];
    const shoulderRough = C.sealed ? ROUGH.shoulder : rough;

    // one wet-ground run at a time, so a causeway is a causeway and not a line of culverts
    let wetRun = null;
    const wetRuns = [];

    let prevRow = null;
    let railLeft = null, railRight = null;

    for (let ki = 0; ki < keep.length; ki++) {
      const i = keep[ki];
      const p = dense[i];
      const y = prof.y[i];
      const ground = prof.ground[i];

      // tangent from the neighbours in the dense sampling, which is smoother than from the keeps
      const a = dense[Math.max(0, i - 2)], b = dense[Math.min(dense.length - 1, i + 2)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const rx = tz, rz = -tx;                        // right hand normal in xz

      // curvature, for the bank. Positive turns one way, negative the other.
      let bank = 0;
      if (i > 3 && i < dense.length - 4) {
        const p0 = dense[i - 3], p1 = dense[i + 3];
        const h0 = Math.atan2(p[0] - p0[0], p[1] - p0[1]);
        const h1 = Math.atan2(p1[0] - p[0], p1[1] - p[1]);
        let dh = h1 - h0;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        const runM = Math.max(6, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
        const curvature = dh / runM;                   // rad per metre
        const v = e.speedKmh / 3.6;
        bank = clamp(-curvature * v * v / 9.81 * 0.55, -0.06, 0.06);
      }

      const yAt = (off) => y + bank * off - camber * Math.abs(off);
      const px = (off) => p[0] + rx * off;
      const pz = (off) => p[1] + rz * off;

      // The batter runs out from the shoulder until it meets the ground, downhill or up. Reaching
      // only downward is what put the road in a trench on every side slope: the ground on the high
      // side stayed where it was and the shoulder cut a wall into it.
      const buildSide = (sign) => {
        const edgeOff = sign * (half + sh);
        const edgeY = yAt(edgeOff) - 0.08;
        let wOut = 1.0, oy = edgeY;
        for (let k = 0; k < 4; k++) {
          const trial = [1.0, 2.0, 3.4, 5.0][k];
          const gh = island.height(px(edgeOff + sign * trial), pz(edgeOff + sign * trial));
          wOut = trial; oy = gh;
          if (Math.abs(gh - edgeY) < trial * 0.62) break;   // no steeper than about one in one point six
        }
        return { off: edgeOff + sign * wOut, y: Math.min(oy + 0.02, edgeY + 1.10), drop: edgeY - oy };
      };
      const L = buildSide(-1), Rr = buildSide(1);

      const row = [];
      const push = (off, yy, c, rgh) => row.push(surface.vert(px(off), yy, pz(off), c[0], c[1], c[2], rgh));
      push(L.off, L.y, SURFACE_COLOUR.batter, ROUGH.batter);
      push(-(half + sh), yAt(-(half + sh)) - 0.08, shoulderCol, shoulderRough);
      push(-half, yAt(-half), pav, rough);
      push(0, yAt(0), [pav[0] * 1.06, pav[1] * 1.06, pav[2] * 1.06], rough);
      push(half, yAt(half), pav, rough);
      push(half + sh, yAt(half + sh) - 0.08, shoulderCol, shoulderRough);
      push(Rr.off, Rr.y, SURFACE_COLOUR.batter, ROUGH.batter);

      if (prevRow) {
        for (let k = 0; k < 6; k++) surface.quad(row[k], row[k + 1], prevRow[k + 1], prevRow[k]);
      }
      prevRow = row;

      /* --- guard rail where there is a real drop off the shoulder --- */
      for (const side of [-1, 1]) {
        const off = side * (half + sh + 0.65);
        const gx = px(off), gz = pz(off);
        const outer = island.height(px(side * (half + sh + 4.5)), pz(side * (half + sh + 4.5)));
        const needs = C.sealed && (yAt(off) - outer) > 2.2;
        const store = side < 0 ? railLeft : railRight;
        if (needs) {
          const top = yAt(off) + 0.78;
          const a0 = furniture.vert(gx, top, gz, 0.62, 0.62, 0.60, 0.2);
          const a1 = furniture.vert(gx, top - 0.32, gz, 0.50, 0.50, 0.49, 0.2);
          if (store) { furniture.quad(store[0], store[1], a1, a0); R.railM += 8; }
          // one post per kept section, which lands about every four to twelve metres
          const ph = island.height(gx, gz);
          const b0 = furniture.vert(gx - 0.06, top - 0.28, gz, 0.45, 0.45, 0.44, 0.2);
          const b1 = furniture.vert(gx + 0.06, top - 0.28, gz, 0.45, 0.45, 0.44, 0.2);
          const b2 = furniture.vert(gx + 0.06, ph, gz, 0.38, 0.37, 0.35, 0.2);
          const b3 = furniture.vert(gx - 0.06, ph, gz, 0.38, 0.37, 0.35, 0.2);
          furniture.quad(b0, b1, b2, b3);
          if (side < 0) railLeft = [a0, a1]; else railRight = [a0, a1];
        } else if (side < 0) railLeft = null; else railRight = null;
      }

      /* --- wet ground: culvert or causeway --- */
      const cover = island.landCover(p[0], p[1]);
      const wetGround = ground < island.seaLevel + 2.6
        || cover === 'swamp' || cover === 'saltmarsh' || cover === 'mangrove';
      const fill = y - ground;
      if (wetGround && fill > 0.55) {
        if (!wetRun) wetRun = { from: i, to: i, lowest: i, lowY: ground };
        wetRun.to = i;
        if (ground < wetRun.lowY) { wetRun.lowY = ground; wetRun.lowest = i; }
      } else if (wetRun) { wetRuns.push(wetRun); wetRun = null; }
    }
    if (wetRun) wetRuns.push(wetRun);

    for (const run of wetRuns) {
      const lenM = prof.s[run.to] - prof.s[run.from];
      const i = run.lowest;
      const p = dense[i];
      const a = dense[Math.max(0, i - 2)], b = dense[Math.min(dense.length - 1, i + 2)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const rx = tz, rz = -tx;
      const y = prof.y[i], g = prof.ground[i];
      const half = C.width * 0.5 + C.shoulder + 1.2;
      // headwalls: a concrete box either side of the embankment at the invert
      for (const side of [-1, 1]) {
        const cx = p[0] + rx * side * half, cz = p[1] + rz * side * half;
        boxInto(furniture, cx, g + 0.05, cz, tx, tz, 2.4, Math.max(0.6, (y - g) * 0.62), 0.4, [0.60, 0.58, 0.54], 0.35);
      }
      // the pipe, a low octagon through the fill so the shape reads from the road side
      pipeInto(furniture, p[0], g + 0.55, p[1], rx, rz, half * 2.1, 0.52, [0.30, 0.29, 0.27]);
      if (lenM > 45) R.causeways++; else R.culverts++;
    }
  }

  /**
   * Line marking. The island runs one style of marked road: a broken white centre line and a
   * continuous edge line either side, on the two roads that carry the 60 and 80 km/h limits.
   * The township streets carry no paint at all, which is what Dickson Way, Junner Street and
   * Ballow Street actually look like, and getting that wrong is the first thing a resident sees.
   */
  function buildMarking(marking, dense, prof, keep, C, style) {
    const half = C.width * 0.5;
    const camber = 0.03;
    const LIFT = 0.02;

    // A frame anywhere along the dense sampling, by chainage rather than by index, so a dash can
    // start and stop at an exact three metres regardless of where the vertices fell.
    const s = prof.s;
    function frameAt(d) {
      let i = 1;
      while (i < s.length - 1 && s[i] < d) i++;
      const f = (d - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]);
      const x = lerp(dense[i - 1][0], dense[i][0], f);
      const z = lerp(dense[i - 1][1], dense[i][1], f);
      const y = lerp(prof.y[i - 1], prof.y[i], f);
      let tx = dense[i][0] - dense[i - 1][0], tz = dense[i][1] - dense[i - 1][1];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      return { x, z, y, rx: tz, rz: -tx };
    }
    const strip = (fr, off, w, out) => {
      const y = fr.y - camber * Math.abs(off) + LIFT;
      out.push(marking.vert(fr.x + fr.rx * (off - w), y, fr.z + fr.rz * (off - w), 0.88, 0.87, 0.82, 0.05));
      out.push(marking.vert(fr.x + fr.rx * (off + w), y, fr.z + fr.rz * (off + w), 0.88, 0.87, 0.82, 0.05));
      return out;
    };

    // continuous edge lines, on the same rows the pavement uses
    let prevL = null, prevR = null;
    for (const i of keep) {
      const fr = { x: dense[i][0], z: dense[i][1], y: prof.y[i], rx: 0, rz: 0 };
      const a = dense[Math.max(0, i - 2)], b = dense[Math.min(dense.length - 1, i + 2)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      fr.rx = tz; fr.rz = -tx;
      const rowL = strip(fr, -(half - 0.32), 0.06, []);
      const rowR = strip(fr, half - 0.32, 0.06, []);
      if (prevL) { marking.quad(rowL[0], rowL[1], prevL[1], prevL[0]); marking.quad(rowR[0], rowR[1], prevR[1], prevR[0]); }
      prevL = rowL; prevR = rowR;
    }

    // broken centre line: three metres of paint, nine of nothing, only where the pack's own
    // operating attributes give this road a speed limit of sixty or more
    if (style !== 'dashed') return;
    const total = s[s.length - 1];
    for (let d = 2; d + 3 < total; d += 12) {
      const a = frameAt(d), b = frameAt(d + 3);
      const ra = strip(a, 0, 0.075, []);
      const rb = strip(b, 0, 0.075, []);
      marking.quad(rb[0], rb[1], ra[1], ra[0]);
    }
  }

  /** An axis-aligned-ish box oriented along a tangent. Used for headwalls, posts and guide posts. */
  function boxInto(soup, cx, cy, cz, tx, tz, lengthM, heightM, widthM, col, rough) {
    const rx = tz, rz = -tx;
    const hx = tx * lengthM * 0.5, hz = tz * lengthM * 0.5;
    const wx = rx * widthM * 0.5, wz = rz * widthM * 0.5;
    const corners = [
      [cx - hx - wx, cz - hz - wz], [cx + hx - wx, cz + hz - wz],
      [cx + hx + wx, cz + hz + wz], [cx - hx + wx, cz - hz + wz]
    ];
    const bot = corners.map((c) => soup.vert(c[0], cy, c[1], col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, rough));
    const top = corners.map((c) => soup.vert(c[0], cy + heightM, c[1], col[0], col[1], col[2], rough));
    soup.quad(top[0], top[1], top[2], top[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      soup.quad(bot[i], bot[j], top[j], top[i]);
    }
  }

  /** A short octagonal pipe lying across the road, for a culvert. */
  function pipeInto(soup, cx, cy, cz, rx, rz, lengthM, radius, col) {
    const seg = 8;
    const a = [], bnd = [];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const dy = Math.sin(th) * radius;
      const dperp = Math.cos(th) * radius;
      // the pipe axis is the road's right vector; the section spreads in y and along the tangent
      const tx = -rz, tz = rx;
      a.push(soup.vert(cx - rx * lengthM * 0.5 + tx * dperp, cy + dy, cz - rz * lengthM * 0.5 + tz * dperp, col[0], col[1], col[2], 0.4));
      bnd.push(soup.vert(cx + rx * lengthM * 0.5 + tx * dperp, cy + dy, cz + rz * lengthM * 0.5 + tz * dperp, col[0], col[1], col[2], 0.4));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      soup.quad(a[i], a[j], bnd[j], bnd[i]);
    }
  }

  /**
   * The beach highways. The pack says its geometry is an offset from the coastline and must not be
   * used as a centreline, so this draws what is actually there: a band of sand that vehicles have
   * compacted, with two darker wheel tracks in it, laid on the real beach surface and clipped by
   * the waterline in the shader. At high tide the road is under the sea, which is the whole point.
   */
  function buildBeachRoute(soup, dense) {
    const step = 3;
    let prev = null;
    for (let i = 0; i < dense.length; i += step) {
      const p = dense[i];
      const a = dense[Math.max(0, i - step)], b = dense[Math.min(dense.length - 1, i + step)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const rx = tz, rz = -tx;
      // The band is pushed a little landward of the derived line and follows the sand exactly.
      const row = [];
      const offs = [-5.2, -2.6, -1.9, -0.4, 0.4, 1.9, 2.6, 5.2];
      for (let k = 0; k < offs.length; k++) {
        const o = offs[k];
        const x = p[0] + rx * o, z = p[1] + rz * o;
        const gy = island.height(x, z) + 0.075;
        // ruts are the pairs at 1.9..2.6 and -1.9..-2.6
        const rut = Math.abs(o) > 1.8 && Math.abs(o) < 3.0;
        const c = rut ? [0.572, 0.522, 0.406] : [0.664, 0.612, 0.478];
        const dip = rut ? 0.025 : 0;
        row.push(soup.vert(x, gy - dip, z, c[0], c[1], c[2], ROUGH.sand));
      }
      if (prev) for (let k = 0; k < offs.length - 1; k++) soup.quad(row[k], row[k + 1], prev[k + 1], prev[k]);
      prev = row;
    }
  }
}
