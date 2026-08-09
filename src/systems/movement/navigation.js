// Navigation. The routing layer everything that moves on Minjerribah stands on.
//
// This system does not move anything. It answers three questions, and it answers them fast enough
// that traffic.js, crowd.js and ferry.js can ask them thousands of times a tick:
//
//   1. Where am I on the network?            locate(x, z, mode)
//   2. How do I get from here to there?      route(fromNode, toNode, mode)
//   3. Can I go that way right now?          arcOpen(arc, mode), and the beach gate below
//
// WHY THIS ISLAND NEEDS ITS OWN ROUTER
//
//   * The sealed network is one road. East Coast Road runs 15.8 km from the barge ramp at Dunwich
//     (Goompi) to Point Lookout (Mooloomba) with no parallel route, and data/transport.json states
//     the consequence plainly: a crash, a fallen tree or a fire closure cuts the island in two and
//     the only detour is sand and needs a four wheel drive. A router that quietly finds another way
//     round would be lying about the place.
//   * More than half the road network is beach. The Main Beach 4WD route is 35.6 km and the
//     Flinders Beach 4WD route is 10.0 km, both gazetted, both 4WD only, both on a permit from
//     Minjerribah Camping, and both closed for two hours either side of every high tide. Two windows
//     a day, about four hours each, sliding roughly fifty minutes later each day. When they shut,
//     45.75 km of legal road is under water and anything on it has to get off.
//   * The published tide rule is a clock rule, not a water level, so the gate below finds the actual
//     time of high water at each beach's own tide station rather than reading a height and guessing.
//     High water at Main Beach is not high water at Dunwich.
//
// WHAT IS PUBLISHED AND WHAT IS MODELLED
//   Published: every centreline (data/geography.json via the roadNetwork read model), every speed
//   limit and surface (data/transport.json road_segments), the two hour tide rule and its issuer,
//   the 4WD and permit requirement, and the named access points for both beach routes.
//   Modelled, and labelled as modelled everywhere it appears: the access links that join a published
//   beach entrance to the network where the connecting street is not in the geometry pack, the short
//   stitches that join a mapped fragment to its neighbour across a gap in the data, the extra
//   closure a big swell adds to the tide window, and the per-mode speed factors on loose surfaces.
//
// Reads: roadNetwork (defensively: it may not exist yet), tide, weather, roads.
// Publishes: navigation. Emits: navigation:beach-open, navigation:beach-closed,
//            navigation:island-cut, navigation:island-rejoined, navigation:ready.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Modes, in the order their bit sits in the arc mask. */
export const MODES = ['foot', 'bike', 'car', 'fourwd', 'bus', 'emergency'];
const MODE_BIT = {};
for (let i = 0; i < MODES.length; i++) MODE_BIT[MODES[i]] = 1 << i;

/**
 * Which modes each road class carries.
 *
 * The exclusions are the interesting ones and all of them are published or derived from published
 * fact. A bus and an ambulance are kept off sand because data/transport.json says the beach detour
 * is "Not available to a bus, a truck, an ambulance". Two wheel drive cars are kept off the beach
 * routes and the sand tracks because the permit condition is 4WD only, in as many words. The
 * walking tracks in Naree Budjong Djara National Park carry feet and nothing else.
 */
const CLASS_MODES = {
  spine:       ['foot', 'bike', 'car', 'fourwd', 'bus', 'emergency'],
  sealed:      ['foot', 'bike', 'car', 'fourwd', 'bus', 'emergency'],
  street:      ['foot', 'bike', 'car', 'fourwd', 'bus', 'emergency'],
  gravel:      ['foot', 'bike', 'car', 'fourwd', 'emergency'],
  sandtrack:   ['foot', 'fourwd'],
  beachaccess: ['foot', 'fourwd'],
  beachroute:  ['foot', 'fourwd'],
  walk:        ['foot'],
  link:        ['foot', 'bike', 'car', 'fourwd', 'emergency'],   // a modelled stitch across a data gap
  beachlink:   ['foot', 'fourwd']                                 // a modelled published beach entrance
};

/**
 * How fast each mode really goes on each surface, as a fraction of the posted limit. A sealed limit
 * is a limit; a sand limit is an aspiration. Modelled, from the pack's own description of the
 * surfaces ("very soft and rough and badly rutted" at the George Nothling Drive entrance, "powdery
 * and difficult even for park rangers" on the causeway approach).
 */
const SURFACE_FACTOR = {
  asphalt: { car: 1.00, fourwd: 1.00, bus: 0.92, emergency: 1.10, bike: 1.00, foot: 1.00 },
  gravel:  { car: 0.72, fourwd: 0.88, bus: 0.60, emergency: 0.80, bike: 0.75, foot: 1.00 },
  sand:    { car: 0.00, fourwd: 0.78, bus: 0.00, emergency: 0.00, bike: 0.35, foot: 0.85 },
  track:   { car: 0.00, fourwd: 0.55, bus: 0.00, emergency: 0.00, bike: 0.50, foot: 1.00 }
};

/** Free walking and riding speeds, metres per second. Foot speed is the flat unloaded average. */
const MODE_FREE_MS = { foot: 1.36, bike: 4.4, car: 22.2, fourwd: 22.2, bus: 18.0, emergency: 25.0 };

/** Semi-diurnal period in minutes. Two highs and two lows a day, sliding about fifty minutes later. */
const SEMIDIURNAL_MIN = 745.24;

/**
 * The two gazetted beach highways, each tied to the published tide station that actually governs it.
 *
 * The station choice matters and is worth stating. src/systems/environment/tide.js publishes a
 * height for eight named locations, and high water at Main Beach runs close to an hour ahead of
 * high water at Dunwich. Main Beach takes the mainbeach station because that is what it is. Flinders
 * Beach has no station of its own in the tide model; it runs east from Amity Point (Pulan) along the
 * northern shore, so it takes the amity station, and that substitution is recorded in the read model
 * rather than hidden.
 */
const BEACHES = [
  {
    id: 'main-beach',
    name: 'Main Beach',
    roadName: 'Main Beach 4WD route',
    station: 'mainbeach',
    stationBasis: 'published tide station for Main Beach',
    speedKmh: 60,
    lengthKmPublished: 35.639
  },
  {
    id: 'flinders-beach',
    name: 'Flinders Beach',
    roadName: 'Flinders Beach 4WD route',
    station: 'amity',
    stationBasis: 'MODELLED SUBSTITUTION. No Flinders Beach tide station is published, so the Amity '
      + 'Point (Pulan) station is used: it sits at the western end of the same northern shore.',
    speedKmh: 40,
    lengthKmPublished: 10.003
  }
];

/** The published tide rule, and the two other published figures it beat. */
const TIDE_RULE = {
  closedMinEitherSide: 120,
  rule: 'No driving on Main Beach or Flinders Beach within 2 hours of high tide.',
  issuer: 'Minjerribah Camping, which issues and enforces the Vehicle Access Permit',
  conflict: [
    { windowMin: 120, source: 'minjerribah-camping (the permit issuer)', confidence: 'high', used: true },
    { windowMin: 75, source: 'stradbrokeisland.com/getting-around/', confidence: 'medium', used: false },
    { windowMin: 60, source: 'stradbrokeisland.com/point-lookout-beach-access/', confidence: 'medium', used: false }
  ],
  resolution: 'Two hours is used. It comes from the body that issues the permit and enforces the '
    + 'condition, and it is the most conservative of the three published windows.'
};

/** Long arcs are cut into pieces this long, so a queue can sit on part of a road rather than all of it. */
const SEGMENT_M = 1150;
/**
 * A mapped fragment closer than this to the network is stitched to it and the stitch is declared.
 * Four hundred metres is deliberately short. It is about the length of a township street, so a
 * stitch stands for a street the geometry pack is missing rather than for a road that is not there.
 * Fishermans Road sits 519 m off East Coast Road and stays disconnected on purpose: half a
 * kilometre of straight line through the wallum is not a missing street, it is an invention.
 */
const STITCH_MAX_M = 400;

/**
 * Posted limits on this island are not all signposted. data/transport.json marks East Coast Road's
 * 80 as "island maximum, not a signposted per-segment value", so the free-flow model treats that
 * figure as a ceiling rather than a cruising speed. Modelled, and only applied where the pack
 * itself says the number is an island maximum.
 */
const ISLAND_MAX_FACTOR = 0.80;

/* ------------------------------------------------------------------ small geometry */

function segClosest(px, pz, ax, az, bx, bz, out) {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + vx * t, z = az + vz * t;
  const dx = px - x, dz = pz - z;
  out.t = t; out.x = x; out.z = z; out.d2 = dx * dx + dz * dz;
  return out;
}

/** A tiny binary heap keyed on a float. Reused between queries: no allocation in the hot path. */
class Heap {
  constructor(n) { this.id = new Int32Array(n); this.key = new Float64Array(n); this.n = 0; }
  clear() { this.n = 0; }
  push(id, key) {
    if (this.n >= this.id.length) {
      const bi = new Int32Array(this.id.length * 2); bi.set(this.id); this.id = bi;
      const bk = new Float64Array(this.key.length * 2); bk.set(this.key); this.key = bk;
    }
    let i = this.n++;
    this.id[i] = id; this.key[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      const ti = this.id[p], tk = this.key[p];
      this.id[p] = this.id[i]; this.key[p] = this.key[i];
      this.id[i] = ti; this.key[i] = tk;
      i = p;
    }
  }
  pop() {
    if (this.n === 0) return -1;
    const top = this.id[0];
    this.n--;
    if (this.n > 0) {
      this.id[0] = this.id[this.n]; this.key[0] = this.key[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.n && this.key[l] < this.key[s]) s = l;
        if (r < this.n && this.key[r] < this.key[s]) s = r;
        if (s === i) break;
        const ti = this.id[s], tk = this.key[s];
        this.id[s] = this.id[i]; this.key[s] = this.key[i];
        this.id[i] = ti; this.key[i] = tk;
        i = s;
      }
    }
    return top;
  }
}

/* ================================================================== the system */

export function registerNavigation(world) {
  const rng = world.rng.stream('navigation');

  const state = world.publish('navigation', {
    ready: false,
    source: 'roadNetwork (data/geography.json roads) with operating attributes from data/transport.json',
    counts: { nodes: 0, edges: 0, arcs: 0, segmented: 0, accessLinks: 0, stitches: 0, orphanNodes: 0 },
    kmByMode: {},
    beaches: {},
    beachRule: TIDE_RULE,
    closures: [],
    islandCut: false,
    islandCutReason: null,
    reachability: { carComponents: 0, largestCarKm: 0, fourwdComponents: 0 },
    routing: { requests: 0, tableHits: 0, searches: 0, failures: 0, replans: 0 },
    notes: []
  });

  /* ---------------------------------------------------------------- the graph

  Built once, the first tick the roads layer has published a network. Everything below is typed
  arrays and integer indices, because traffic.js asks for a position on an arc for every vehicle on
  the island five times a tick and an object graph would show up in the frame budget. */

  const G = {
    built: false,
    N: 0, E: 0, A: 0,
    // nodes
    nx: null, nz: null, ny: null, nodeLabel: [], nodeKind: [], nodeRegion: [], nodeRoad: [],
    nodeIdOf: new Map(),     // roadNetwork node id -> graph node index (build time only)
    // edges (undirected)
    eFrom: null, eTo: null, eLen: null, eSpeed: null, eMask: null, eSurface: [], eClass: [],
    eName: [], eBasis: [], eTide: null, eBeach: null, ePts: [], eCum: [],
    eClosedUntil: null, eClosedWhy: [],
    // arcs (directed): arc a is edge a>>1, direction a&1 (0 = from->to)
    // CSR adjacency by node
    adjStart: null, adjArc: null,
    // per-arc live cost multiplier written by traffic.js
    arcDelay: null,
    epochByMode: null,
    tableDist: [], tableNext: [],
    heap: new Heap(512),
    dist: null, prevArc: null, mark: null, markStamp: 0
  };

  const beachState = {};
  for (const b of BEACHES) {
    beachState[b.id] = {
      id: b.id, name: b.name, station: b.station, stationBasis: b.stationBasis,
      open: true, closedBySwell: false, minutesToChange: null, minutesFromHighWater: null,
      windowMin: TIDE_RULE.closedMinEitherSide, swellExtraMin: 0, swellM: 0,
      cutOffRisk: 0, lengthKm: b.lengthKmPublished, speedKmh: b.speedKmh,
      arcs: 0, edges: [], entrances: [],
      basis: 'seeding: waiting for the first high water at this station',
      lastHighAt: null, highs: []
    };
  }

  const nowMin = (w) => w.clock.dayIndex * 1440 + w.clock.minuteOfDay;

  /* ---------------------------------------------------------------- build */

  function build(w) {
    const net = w.read('roadNetwork');
    if (!net || !net.ready || !Array.isArray(net.nodes) || !net.nodes.length) return false;
    const island = w.island;
    const notes = [];

    /* 1. nodes, straight out of the roads layer. */
    const nodes = net.nodes;
    const nodeRec = nodes.map((n, i) => {
      G.nodeIdOf.set(n.id, i);
      return { x: n.x, z: n.z, label: n.label || 'road', kind: n.kind || 'through', region: n.region || 'Minjerribah', road: (n.roads && n.roads[0]) || null };
    });

    /* 2. edges. Long ones are cut into pieces so the queueing model in traffic.js has somewhere to
          put a queue: a nine kilometre link that is either free or jammed is not a road, it is a
          switch. Cutting adds through nodes and no geometry: every piece is a slice of the same
          published centreline. */
    const edges = [];
    let segmented = 0;

    const addPiece = (src, pts, fromIdx, toIdx, basis) => {
      let len = 0;
      const cum = new Float64Array(pts.length);
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        cum[i] = len;
      }
      if (!(len > 0.5)) return null;
      const e = {
        from: fromIdx, to: toIdx, len,
        speed: src.islandMax ? src.speedKmh * ISLAND_MAX_FACTOR : src.speedKmh,
        posted: src.speedKmh,
        speedBasis: src.speedBasis || null,
        mask: maskFor(src.cls),
        surface: src.surface, cls: src.cls, name: src.name,
        basis: basis || 'published centreline',
        tide: !!src.tideDependent, beach: src.beachId || null,
        pts, cum
      };
      edges.push(e);
      return e;
    };

    for (const e of net.edges) {
      const a = G.nodeIdOf.get(e.from), b = G.nodeIdOf.get(e.to);
      if (a === undefined || b === undefined) continue;
      const pts = net.geometry(e) || [[nodeRec[a].x, nodeRec[a].z], [nodeRec[b].x, nodeRec[b].z]];
      const src = {
        cls: e.cls, speedKmh: e.speedKmh, surface: e.surface, name: e.name,
        tideDependent: e.tideDependent,
        speedBasis: e.speedBasis || null,
        islandMax: /island maximum/i.test(String(e.speedBasis || '')),
        beachId: e.cls === 'beachroute' ? (/flinders/i.test(e.name) ? 'flinders-beach' : 'main-beach') : null
      };
      if (e.lengthM <= SEGMENT_M * 1.6) {
        addPiece(src, pts, a, b);
        continue;
      }
      // Cut on cumulative length. Interpolated cut points become through nodes named for the road.
      const pieces = Math.max(2, Math.round(e.lengthM / SEGMENT_M));
      let cum = 0;
      const cums = [0];
      for (let i = 1; i < pts.length; i++) { cum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cums.push(cum); }
      const total = cum;
      let prevNode = a;
      let cursor = 0;
      let run = [pts[0]];
      for (let p = 1; p <= pieces; p++) {
        const target = (total * p) / pieces;
        while (cursor < pts.length - 1 && cums[cursor + 1] < target) {
          cursor++;
          run.push(pts[cursor]);
        }
        let endNode;
        let endPt;
        if (p === pieces) {
          endNode = b;
          endPt = pts[pts.length - 1];
          for (let i = cursor + 1; i < pts.length - 1; i++) run.push(pts[i]);
        } else {
          const c0 = cums[cursor], c1 = cums[cursor + 1];
          const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
          const x = pts[cursor][0] + (pts[cursor + 1][0] - pts[cursor][0]) * t;
          const z = pts[cursor][1] + (pts[cursor + 1][1] - pts[cursor][1]) * t;
          endPt = [x, z];
          endNode = nodeRec.length;
          nodeRec.push({ x, z, label: e.name, kind: 'segment', region: island ? island.regionAt(x, z) : 'Minjerribah', road: e.name });
          segmented++;
        }
        run.push(endPt);
        addPiece(src, run, prevNode, endNode);
        prevNode = endNode;
        run = [endPt];
      }
    }

    /* 3. the gaps.

       data/geography.json does not carry every street on this island, and the roads layer says so in
       its own notes rather than inventing the missing ones. A router cannot leave it there: a car
       parked on Cumming Parade has to be able to leave Cumming Parade. So two kinds of modelled link
       go in here, both named as modelled, both counted, both listed in the read model, and neither
       given a road name it has not earned.

         accessLink   a published beach entrance joined to the network. data/transport.json names
                      the access points for both beach routes; the streets that reach them are not
                      in the geometry pack. The entrance is published; the link is modelled.
         stitch       a mapped fragment joined to its nearest neighbour across a gap of less than
                      STITCH_MAX_M. The fragment is real and the gap is a hole in the data. */

    const accessLinks = [];
    const stitches = [];

    const linkSrc = (cls, speed, surface, name) => ({ cls, speedKmh: speed, surface, name, tideDependent: false, beachId: null, speedBasis: 'modelled link', islandMax: false });

    // Components over the drivable-or-walkable graph, so a stitch is only made where one is needed.
    let comps = componentsOf(nodeRec.length, edges);

    /* The roads layer leaves a handful of coincident zero degree nodes behind where a polyline ends
       on top of a junction. They carry no road, so they are never stitched to anything: a one metre
       straight line joining a road end to the road it ends on would be a stitch that says nothing. */
    const hasEdge = new Uint8Array(nodeRec.length);
    const markEdges = () => { hasEdge.fill(0); for (const e of edges) { hasEdge[e.from] = 1; hasEdge[e.to] = 1; } };
    markEdges();
    let degenerate = 0;
    for (let i = 0; i < nodeRec.length; i++) if (!hasEdge[i]) degenerate++;

    // 3a. published beach entrances.
    const beachEdgeIdx = [];
    for (let i = 0; i < edges.length; i++) if (edges[i].cls === 'beachroute') beachEdgeIdx.push(i);

    const transport = (w.data && w.data.transport) || null;
    for (const seg of (transport && transport.road_segments) || []) {
      if (seg.id !== 'route-main-beach-4wd' && seg.id !== 'route-flinders-beach-4wd') continue;
      const beachId = seg.id === 'route-main-beach-4wd' ? 'main-beach' : 'flinders-beach';
      for (const ap of seg.access_points || []) {
        // Find the beach node nearest either the published coordinate or the named place.
        let anchor = null;
        if (Number.isFinite(ap.lat) && Number.isFinite(ap.lon) && island) {
          const p = island.project(ap.lon, ap.lat);
          anchor = { x: p.x, z: p.z };
        } else {
          anchor = anchorFromName(ap.name, nodeRec, net);
        }
        if (!anchor) {
          notes.push(`beach entrance "${ap.name}" is published for ${seg.name} with no coordinate and no `
            + 'matching mapped place, so no access link is made for it.');
          continue;
        }
        const onBeach = nearestNodeOnEdges(anchor.x, anchor.z, nodeRec, edges, beachEdgeIdx);
        const onRoad = nearestNodeWhere(anchor.x, anchor.z, nodeRec, edges, (ei) => {
          const c = edges[ei].cls;
          return c !== 'beachroute' && c !== 'walk';
        });
        if (!onBeach || !onRoad) continue;
        const gapM = Math.hypot(nodeRec[onRoad].x - nodeRec[onBeach].x, nodeRec[onRoad].z - nodeRec[onBeach].z);
        if (gapM > 3000) {
          notes.push(`beach entrance "${ap.name}": the nearest mapped road is ${Math.round(gapM)} m away, `
            + 'which is too far to model as an entrance, so it is left unconnected.');
          continue;
        }
        if (comps[onRoad] === comps[onBeach]) continue;   // already joined by real geometry
        const e = addPiece(linkSrc('beachlink', 20, 'sand', ap.name),
          [[nodeRec[onRoad].x, nodeRec[onRoad].z], [nodeRec[onBeach].x, nodeRec[onBeach].z]],
          onRoad, onBeach,
          `MODELLED ACCESS LINK. The entrance is published in data/transport.json (${ap.confidence || 'medium'} confidence). `
          + 'The street that reaches it is not in data/geography.json, so this link is a straight line and not a road.');
        if (!e) continue;
        e.beach = beachId;
        e.tide = true;
        accessLinks.push({ name: ap.name, beach: beachId, metres: Math.round(gapM), confidence: ap.confidence || 'medium', note: ap.note || null });
        mergeComponents(comps, onRoad, onBeach);
        beachState[beachId].entrances.push(ap.name);
      }
    }

    // 3b. short stitches across holes in the geometry pack. One stitch per fragment per pass, with
    //     the components recomputed each pass so a fragment joined on the last pass is not
    //     stitched again from its other end.
    for (let pass = 0; pass < 6; pass++) {
      markEdges();
      comps = componentsOf(nodeRec.length, edges);
      const sizes = componentSizes(comps);
      // Largest component first, so a fragment is always stitched toward the main network.
      const order = Object.keys(sizes).map(Number).sort((a, b) => sizes[b] - sizes[a] || a - b);
      const main = order[0];
      let joined = 0;
      for (const cid of order) {
        if (cid === main) continue;
        let best = null;
        for (let i = 0; i < nodeRec.length; i++) {
          if (comps[i] !== cid || !hasEdge[i]) continue;
          for (let j = 0; j < nodeRec.length; j++) {
            if (comps[j] === cid || !hasEdge[j]) continue;
            const d = Math.hypot(nodeRec[i].x - nodeRec[j].x, nodeRec[i].z - nodeRec[j].z);
            if (d < STITCH_MAX_M && (!best || d < best.d)) best = { i, j, d };
          }
        }
        if (!best) continue;
        const a = nodeRec[best.i], b = nodeRec[best.j];
        const e = addPiece(linkSrc('link', 40, 'asphalt', null),
          [[a.x, a.z], [b.x, b.z]], best.i, best.j,
          `MODELLED STITCH. ${Math.round(best.d)} m between ${a.label} and ${b.label}. `
          + 'The street that joins them is not in data/geography.json and is not invented here: this is a '
          + 'straight line so the router can leave the fragment, and it is counted as modelled.');
        if (!e) continue;
        stitches.push({ metres: Math.round(best.d), between: [a.label, b.label], region: a.region });
        joined++;
      }
      if (!joined) break;
    }
    comps = componentsOf(nodeRec.length, edges);

    /* 4. flatten into typed arrays. */
    const N = nodeRec.length, E = edges.length;
    G.N = N; G.E = E; G.A = E * 2;
    G.nx = new Float64Array(N); G.nz = new Float64Array(N); G.ny = new Float32Array(N);
    G.nodeLabel = new Array(N); G.nodeKind = new Array(N); G.nodeRegion = new Array(N); G.nodeRoad = new Array(N);
    for (let i = 0; i < N; i++) {
      const n = nodeRec[i];
      G.nx[i] = n.x; G.nz[i] = n.z;
      G.ny[i] = island ? island.height(n.x, n.z) : 0;
      G.nodeLabel[i] = n.label; G.nodeKind[i] = n.kind; G.nodeRegion[i] = n.region; G.nodeRoad[i] = n.road;
    }
    G.eFrom = new Int32Array(E); G.eTo = new Int32Array(E);
    G.eLen = new Float64Array(E); G.eSpeed = new Float32Array(E); G.eMask = new Int32Array(E);
    G.eTide = new Uint8Array(E); G.eBeach = new Array(E);
    G.eSurface = new Array(E); G.eClass = new Array(E); G.eName = new Array(E); G.eBasis = new Array(E);
    G.ePts = new Array(E); G.eCum = new Array(E);
    G.eClosedUntil = new Float64Array(E); G.eClosedWhy = new Array(E);
    for (let i = 0; i < E; i++) {
      const e = edges[i];
      G.eFrom[i] = e.from; G.eTo[i] = e.to; G.eLen[i] = e.len; G.eSpeed[i] = e.speed;
      G.eMask[i] = e.mask; G.eTide[i] = e.tide ? 1 : 0; G.eBeach[i] = e.beach;
      G.eSurface[i] = e.surface; G.eClass[i] = e.cls; G.eName[i] = e.name; G.eBasis[i] = e.basis;
      G.ePts[i] = e.pts; G.eCum[i] = e.cum;
      G.eClosedWhy[i] = null;
      if (e.beach) { beachState[e.beach].edges.push(i); beachState[e.beach].arcs += 2; }
    }

    // CSR adjacency: for each node, the arcs leaving it.
    const deg = new Int32Array(N);
    for (let i = 0; i < E; i++) { deg[G.eFrom[i]]++; deg[G.eTo[i]]++; }
    G.adjStart = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) G.adjStart[i + 1] = G.adjStart[i] + deg[i];
    G.adjArc = new Int32Array(G.adjStart[N]);
    const cursor = Int32Array.from(G.adjStart);
    for (let i = 0; i < E; i++) {
      G.adjArc[cursor[G.eFrom[i]]++] = i * 2;        // from -> to
      G.adjArc[cursor[G.eTo[i]]++] = i * 2 + 1;      // to -> from
    }

    // Which modes can leave each node at all. Saves walking the adjacency on every nearestNode call.
    G.nodeMask = new Int32Array(N);
    for (let i = 0; i < E; i++) { G.nodeMask[G.eFrom[i]] |= G.eMask[i]; G.nodeMask[G.eTo[i]] |= G.eMask[i]; }

    /* A coarse index over every segment of every centreline, so locate() tests a handful of
       segments rather than all of them. The Main Beach route alone carries several hundred
       vertices and locate() is called for every trip that starts, so this is the difference
       between a movement phase inside the budget and one that is not. */
    buildSegmentGrid();

    G.arcDelay = new Float32Array(G.A).fill(1);
    G.dist = new Float64Array(N);
    G.prevArc = new Int32Array(N);
    G.firstArc = new Int32Array(N);
    G.mark = new Int32Array(N);
    G.doneStamp = new Int32Array(N);
    G.epochByMode = new Int32Array(MODES.length).fill(1);
    G.tableDist = new Array(MODES.length).fill(null);
    G.tableNext = new Array(MODES.length).fill(null);
    G.tableEpoch = new Int32Array(MODES.length);
    G.heap = new Heap(Math.max(512, N * 2));

    G.built = true;

    /* 5. the read model. */
    const km = {};
    for (const m of MODES) {
      let sum = 0;
      for (let i = 0; i < E; i++) if (G.eMask[i] & MODE_BIT[m]) sum += G.eLen[i];
      km[m] = +(sum / 1000).toFixed(2);
    }
    state.kmByMode = km;
    state.counts = {
      nodes: N, edges: E, arcs: G.A, segmented,
      accessLinks: accessLinks.length, stitches: stitches.length,
      orphanNodes: countOrphans(comps, hasEdge),
      degenerateNodes: degenerate
    };
    state.accessLinks = accessLinks;
    state.stitches = stitches;
    for (const n of net.notes || []) notes.push('roads layer: ' + n);
    if (stitches.length) {
      notes.push(`${stitches.length} modelled stitches join mapped fragments across gaps in `
        + 'data/geography.json. Each is a straight line, none carries a road name, and every one is '
        + 'listed in navigation.stitches so a later pass can replace it with real geometry.');
    }
    for (const b of BEACHES) {
      const s = beachState[b.id];
      if (!s.edges.length) notes.push(`${b.name}: no beach route geometry in the network, so no tide gate is applied.`);
    }
    state.notes = notes;
    state.ready = true;
    w.bus.emit('navigation:ready', { nodes: N, edges: E, stitches: stitches.length, accessLinks: accessLinks.length });
    return true;
  }

  function maskFor(cls) {
    const list = CLASS_MODES[cls] || CLASS_MODES.sealed;
    let m = 0;
    for (const k of list) m |= MODE_BIT[k];
    return m;
  }

  /** Union-find style component labelling, done plainly because the graph is small. */
  function componentsOf(n, edges) {
    const comp = new Int32Array(n).fill(-1);
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    for (const e of edges) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
    let c = 0;
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      comp[i] = c; stack.length = 0; stack.push(i);
      while (stack.length) {
        const k = stack.pop();
        for (const o of adj[k]) if (comp[o] < 0) { comp[o] = c; stack.push(o); }
      }
      c++;
    }
    return comp;
  }
  function componentSizes(comp) {
    const out = {};
    for (let i = 0; i < comp.length; i++) out[comp[i]] = (out[comp[i]] || 0) + 1;
    return out;
  }
  /** Absorb the component holding `absorb` into the one holding `keep`. */
  function mergeComponents(comp, keep, absorb) {
    const from = comp[absorb], to = comp[keep];
    if (from === to) return;
    for (let i = 0; i < comp.length; i++) if (comp[i] === from) comp[i] = to;
  }
  function countOrphans(comp, hasEdge) {
    const sizes = {};
    for (let i = 0; i < comp.length; i++) if (!hasEdge || hasEdge[i]) sizes[comp[i]] = (sizes[comp[i]] || 0) + 1;
    const keys = Object.keys(sizes).map(Number);
    if (!keys.length) return 0;
    let main = keys[0];
    for (const k of keys) if (sizes[k] > sizes[main]) main = k;
    let n = 0;
    for (let i = 0; i < comp.length; i++) if ((!hasEdge || hasEdge[i]) && comp[i] !== main) n++;
    return n;
  }
  function nearestNodeOnEdges(x, z, nodeRec, edges, idxList) {
    let best = -1, bd = Infinity;
    for (const ei of idxList) {
      for (const nd of [edges[ei].from, edges[ei].to]) {
        const d = Math.hypot(nodeRec[nd].x - x, nodeRec[nd].z - z);
        if (d < bd) { bd = d; best = nd; }
      }
    }
    return best >= 0 ? best : null;
  }
  function nearestNodeWhere(x, z, nodeRec, edges, edgeOk) {
    let best = -1, bd = Infinity;
    for (let ei = 0; ei < edges.length; ei++) {
      if (!edgeOk(ei)) continue;
      for (const nd of [edges[ei].from, edges[ei].to]) {
        const d = Math.hypot(nodeRec[nd].x - x, nodeRec[nd].z - z);
        if (d < bd) { bd = d; best = nd; }
      }
    }
    return best >= 0 ? best : null;
  }
  /** Match a published access point name to a mapped node label. Never a fuzzy guess: exact words. */
  function anchorFromName(name, nodeRec) {
    const n = String(name || '').toLowerCase();
    const wants = [];
    if (n.includes('sovereign')) wants.push('sovereign road');
    if (n.includes('flinders beach road')) wants.push('flinders beach road');
    if (n.includes('adder rock')) wants.push('adder rock');
    if (n.includes('alfred martin')) wants.push('alfred martin way');
    if (!wants.length) return null;
    let best = null;
    for (let i = 0; i < nodeRec.length; i++) {
      const label = String(nodeRec[i].label || '').toLowerCase();
      const region = String(nodeRec[i].region || '').toLowerCase();
      for (const wnt of wants) {
        if (label.includes(wnt) || region.includes(wnt)) {
          // an end of the road, not its middle: that is where an entrance is
          const score = nodeRec[i].kind === 'end' ? 0 : nodeRec[i].kind === 'segment' ? 2 : 1;
          if (!best || score < best.score) best = { x: nodeRec[i].x, z: nodeRec[i].z, score };
        }
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- the beach tide gate

  The published condition is a clock rule: no driving within two hours of high tide. So this needs
  the time of high water at each beach, not the height of the water at it. The tide system publishes
  a height per station every tick, so a high water is a maximum in that series, found by fitting a
  parabola through the last three samples. That is exact to about a minute at a ten minute tick and
  it needs no constant from inside the tide model.

  Until the first high water has been seen at a station, the gate falls back to the roads layer's
  own Dunwich-based gate and says so in `basis`, rather than reporting a window it has not measured. */

  const trace = {};
  for (const b of BEACHES) trace[b.id] = { h: [null, null, null], t: [0, 0, 0] };

  function updateBeaches(w) {
    const tide = w.read('tide');
    const weather = w.read('weather');
    const net = w.read('roadNetwork');
    const t = nowMin(w);
    const swellM = (weather && weather.swellM) || 0;

    for (const b of BEACHES) {
      const S = beachState[b.id];
      const h = tide && tide.stations ? tide.stations[b.station] : null;
      const tr = trace[b.id];

      if (h != null) {
        tr.h[0] = tr.h[1]; tr.h[1] = tr.h[2]; tr.h[2] = h;
        tr.t[0] = tr.t[1]; tr.t[1] = tr.t[2]; tr.t[2] = t;
        // A maximum sits between the first and last sample when the middle one is the highest.
        if (tr.h[0] != null && tr.h[1] > tr.h[0] && tr.h[1] >= tr.h[2]) {
          const y0 = tr.h[0], y1 = tr.h[1], y2 = tr.h[2];
          const denom = y0 - 2 * y1 + y2;
          const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
          const step = tr.t[1] - tr.t[0];
          const at = tr.t[1] + clamp(shift, -1, 1) * step;
          if (!S.highs.length || Math.abs(S.highs[S.highs.length - 1] - at) > 120) {
            S.highs.push(at);
            S.lastHighAt = at;
            while (S.highs.length > 6) S.highs.shift();
          }
        }
      }

      // A big swell runs the water further up the beach and shortens the drivable window at both
      // ends. Modelled, and labelled: no published figure ties a swell height to a beach closure
      // here, and the honest thing is a small effect with its arithmetic on show.
      S.swellM = +swellM.toFixed(2);
      S.swellExtraMin = Math.round(clamp((swellM - 1.5) * 40, 0, 100));
      S.windowMin = TIDE_RULE.closedMinEitherSide + S.swellExtraMin;

      if (!S.highs.length) {
        // Not measured yet. Borrow the roads layer's gate and say so.
        S.open = net ? net.beachOpen !== false : true;
        S.minutesToChange = net ? net.beachNextChangeMin : null;
        S.minutesFromHighWater = null;
        S.basis = 'seeded from the roads layer gate at Dunwich until the first high water is measured '
          + `at the ${S.station} station`;
        S.cutOffRisk = 0;
        continue;
      }

      // Nearest high water, extrapolated a couple of cycles either way.
      let signed = Infinity;
      for (const hi of S.highs) {
        for (let k = -3; k <= 3; k++) {
          const at = hi + k * SEMIDIURNAL_MIN;
          const d = at - t;
          if (Math.abs(d) < Math.abs(signed)) signed = d;
        }
      }
      S.minutesFromHighWater = Math.round(signed);
      const closed = Math.abs(signed) < S.windowMin;
      const was = S.open;
      S.open = !closed;
      S.closedBySwell = closed && Math.abs(signed) >= TIDE_RULE.closedMinEitherSide;
      S.basis = `measured at the ${S.station} tide station: high water ${signed >= 0 ? 'in ' + Math.round(signed) : Math.round(-signed) + ' minutes ago'}`
        + `, closed window ${S.windowMin} minutes either side`;
      if (closed) {
        S.minutesToChange = Math.round(signed + S.windowMin);
      } else {
        const nextHighIn = signed > 0 ? signed : signed + SEMIDIURNAL_MIN;
        S.minutesToChange = Math.round(Math.max(0, nextHighIn - S.windowMin));
      }
      // How exposed a vehicle still out there is. Zero when the window is hours away, one when the
      // water is already inside the rule.
      S.cutOffRisk = closed ? 1 : clamp(1 - S.minutesToChange / 75, 0, 1);

      if (was !== S.open) {
        bumpMode('fourwd');
        bumpMode('foot');
        w.bus.emit(S.open ? 'navigation:beach-open' : 'navigation:beach-closed', {
          beach: S.name,
          minutesToChange: S.minutesToChange,
          swellM: S.swellM,
          extraMinutesFromSwell: S.swellExtraMin,
          rule: TIDE_RULE.rule,
          text: S.open
            ? `${S.name} is drivable again. It closes in ${fmtMins(S.minutesToChange)}.`
            : `${S.name} is closed to vehicles for ${fmtMins(S.minutesToChange)}: high tide, `
              + (S.swellExtraMin > 0 ? `${S.swellM} m of swell, ` : '')
              + 'two hours either side.'
        });
      }
    }
    state.beaches = beachState;
  }

  const fmtMins = (m) => {
    if (m == null) return 'a while';
    const a = Math.max(0, Math.round(m));
    if (a < 60) return `${a} minutes`;
    const h = Math.floor(a / 60), mm = a % 60;
    return mm ? `${h} h ${mm} min` : `${h} hours`;
  };

  /* ---------------------------------------------------------------- availability */

  /** Is this edge usable by this mode right now? Tide, closures and the mode mask, in that order. */
  function edgeOpen(i, modeBit, t) {
    if (!(G.eMask[i] & modeBit)) return false;
    if (G.eClosedUntil[i] > t) return false;
    if (G.eTide[i] && modeBit !== MODE_BIT.foot) {
      const b = G.eBeach[i];
      if (b && !beachState[b].open) return false;
    }
    return true;
  }

  /** Free-flow seconds to traverse this edge in this mode, before any congestion. */
  function baseSeconds(i, mode) {
    const sf = (SURFACE_FACTOR[G.eSurface[i]] || SURFACE_FACTOR.asphalt)[mode] ?? 1;
    if (sf <= 0) return Infinity;
    if (mode === 'foot' || mode === 'bike') {
      return G.eLen[i] / (MODE_FREE_MS[mode] * sf);
    }
    const kmh = Math.max(6, G.eSpeed[i] * sf);
    const cap = MODE_FREE_MS[mode] * 3.6;
    return G.eLen[i] / (Math.min(kmh, cap) / 3.6);
  }

  /** Seconds including whatever traffic.js has measured on this arc. */
  function arcSeconds(arc, mode) {
    const i = arc >> 1;
    const s = baseSeconds(i, mode);
    if (!Number.isFinite(s)) return Infinity;
    return mode === 'foot' ? s : s * G.arcDelay[arc];
  }

  /* ---------------------------------------------------------------- routing

  Two tiers, because the two callers want different things.

    Tier 1  an all-pairs next-hop table per mode over free-flow time. The network is small enough
            that this is cheap and exact, and it is what pedestrians, buses and anything planning a
            whole day should use. Rebuilt only when that mode's availability changes, which for the
            4WD modes is four times a sim-day when the beaches open and shut, and for everything
            else only when a road is closed.

    Tier 2  an A* over current congested costs, for a vehicle deciding whether to sit in the queue
            or turn around. traffic.js calls this and it is a few microseconds on a graph this size. */

  function bumpMode(mode) {
    const mi = MODES.indexOf(mode);
    if (mi >= 0) G.epochByMode[mi]++;
  }
  function bumpAllVehicleModes() {
    for (const m of ['bike', 'car', 'fourwd', 'bus', 'emergency']) bumpMode(m);
  }

  function ensureTable(mi, t) {
    if (G.tableEpoch[mi] === G.epochByMode[mi] && G.tableDist[mi]) return;
    const mode = MODES[mi];
    const bit = MODE_BIT[mode];
    const N = G.N;
    const dist = G.tableDist[mi] && G.tableDist[mi].length === N * N ? G.tableDist[mi] : new Float32Array(N * N);
    const next = G.tableNext[mi] && G.tableNext[mi].length === N * N ? G.tableNext[mi] : new Int32Array(N * N);
    dist.fill(Infinity);
    next.fill(-1);
    // Edge times are the same for every source, so pay for them once per rebuild.
    const cost = new Float64Array(G.E);
    for (let i = 0; i < G.E; i++) {
      cost[i] = edgeOpen(i, bit, t) ? baseSeconds(i, mode) : Infinity;
    }
    const heap = G.heap;
    const d = G.dist, first = G.firstArc, done = G.doneStamp, mark = G.mark;
    for (let s = 0; s < N; s++) {
      G.markStamp++;
      const stamp = G.markStamp;
      heap.clear();
      mark[s] = stamp; d[s] = 0; first[s] = -1;
      heap.push(s, 0);
      const row = s * N;
      while (heap.n) {
        const u = heap.pop();
        if (done[u] === stamp) continue;
        done[u] = stamp;
        dist[row + u] = d[u];
        // `first` is the first arc out of s on the shortest path to u. Subpaths of shortest paths
        // are shortest paths, so one number per node is the whole next-hop table.
        next[row + u] = first[u];
        const du = d[u];
        for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
          const arc = G.adjArc[k];
          const ei = arc >> 1;
          const w2 = cost[ei];
          if (!(w2 < Infinity)) continue;
          const v = (arc & 1) === 0 ? G.eTo[ei] : G.eFrom[ei];
          if (done[v] === stamp) continue;
          const nd = du + w2;
          if (mark[v] !== stamp || nd < d[v]) {
            mark[v] = stamp;
            d[v] = nd;
            first[v] = u === s ? arc : first[u];
            heap.push(v, nd);
          }
        }
      }
    }
    G.tableDist[mi] = dist;
    G.tableNext[mi] = next;
    G.tableEpoch[mi] = G.epochByMode[mi];
  }

  /** Route by the table: exact free-flow shortest path, no search. */
  function tableRoute(from, to, mode, t) {
    const mi = MODES.indexOf(mode);
    if (mi < 0) return null;
    ensureTable(mi, t);
    const N = G.N;
    const dist = G.tableDist[mi], next = G.tableNext[mi];
    if (from === to) return { nodes: [from], arcs: [], lengthM: 0, seconds: 0, mode, closedBy: null };
    if (!Number.isFinite(dist[from * N + to])) return null;
    const arcs = [], nodes = [from];
    let cur = from, guard = 0;
    while (cur !== to && guard++ < N * 2) {
      const arc = next[cur * N + to];
      if (arc < 0) return null;
      arcs.push(arc);
      cur = (arc & 1) === 0 ? G.eTo[arc >> 1] : G.eFrom[arc >> 1];
      nodes.push(cur);
    }
    if (cur !== to) return null;
    let lengthM = 0;
    for (const a of arcs) lengthM += G.eLen[a >> 1];
    return { nodes, arcs, lengthM, seconds: dist[from * N + to], mode, closedBy: null };
  }

  /** A* over live costs. Used when a vehicle has to decide something now. */
  function search(from, to, mode, t, opts) {
    const bit = MODE_BIT[mode];
    if (!bit) return null;
    const N = G.N;
    const avoidArc = opts && opts.avoidArc != null ? opts.avoidArc : -1;
    const avoidEdge = opts && opts.avoidEdge != null ? opts.avoidEdge : -1;
    const bestMs = MODE_FREE_MS[mode];
    const gx = G.nx[to], gz = G.nz[to];
    const heap = G.heap;
    const d = G.dist, mark = G.mark, prev = G.prevArc, done = G.doneStamp;
    G.markStamp++;
    const stamp = G.markStamp;
    heap.clear();
    d[from] = 0; mark[from] = stamp; prev[from] = -1;
    heap.push(from, 0);
    let found = false;
    let guard = 0;
    while (heap.n && guard++ < N * 8) {
      const u = heap.pop();
      if (done[u] === stamp) continue;
      done[u] = stamp;
      if (u === to) { found = true; break; }
      for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
        const arc = G.adjArc[k];
        const ei = arc >> 1;
        if (arc === avoidArc || ei === avoidEdge) continue;
        if (!edgeOpen(ei, bit, t)) continue;
        const v = (arc & 1) === 0 ? G.eTo[ei] : G.eFrom[ei];
        if (done[v] === stamp) continue;
        const w2 = arcSeconds(arc, mode);
        if (!Number.isFinite(w2)) continue;
        const nd = d[u] + w2;
        if (mark[v] !== stamp || nd < d[v]) {
          mark[v] = stamp; d[v] = nd; prev[v] = arc;
          heap.push(v, nd + Math.hypot(G.nx[v] - gx, G.nz[v] - gz) / bestMs);
        }
      }
    }
    if (!found) return null;
    const arcs = [];
    let cur = to, g2 = 0;
    while (cur !== from && g2++ < N * 2) {
      const arc = prev[cur];
      if (arc < 0) return null;
      arcs.unshift(arc);
      cur = (arc & 1) === 0 ? G.eFrom[arc >> 1] : G.eTo[arc >> 1];
    }
    const nodes = [from];
    let lengthM = 0;
    for (const a of arcs) {
      lengthM += G.eLen[a >> 1];
      nodes.push((a & 1) === 0 ? G.eTo[a >> 1] : G.eFrom[a >> 1]);
    }
    return { nodes, arcs, lengthM, seconds: d[to], mode, closedBy: null };
  }

  /* ---------------------------------------------------------------- geometry helpers */

  const tmp = { t: 0, x: 0, z: 0, d2: 0 };

  /* A uniform grid over every segment of every centreline. Cell size is a compromise: big enough
     that the buckets are few, small enough that a query near a township touches a handful of
     segments rather than the whole of Main Beach. */
  const GRID_M = 450;
  const grid = { cell: GRID_M, x0: 0, z0: 0, nx: 0, nz: 0, bucket: null };

  function buildSegmentGrid() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < G.E; i++) {
      for (const p of G.ePts[i]) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
      }
    }
    grid.x0 = x0 - GRID_M; grid.z0 = z0 - GRID_M;
    grid.nx = Math.max(1, Math.ceil((x1 - x0) / GRID_M) + 3);
    grid.nz = Math.max(1, Math.ceil((z1 - z0) / GRID_M) + 3);
    grid.bucket = new Array(grid.nx * grid.nz);
    for (let i = 0; i < G.E; i++) {
      const p = G.ePts[i];
      for (let s = 0; s < p.length - 1; s++) {
        // Stamp the segment into every cell its bounding box touches. Segments are short relative
        // to the cell, so this is one or two cells each.
        const ax = Math.min(p[s][0], p[s + 1][0]), bx2 = Math.max(p[s][0], p[s + 1][0]);
        const az = Math.min(p[s][1], p[s + 1][1]), bz2 = Math.max(p[s][1], p[s + 1][1]);
        const i0 = Math.floor((ax - grid.x0) / GRID_M), i1 = Math.floor((bx2 - grid.x0) / GRID_M);
        const j0 = Math.floor((az - grid.z0) / GRID_M), j1 = Math.floor((bz2 - grid.z0) / GRID_M);
        for (let j = j0; j <= j1; j++) {
          for (let ii = i0; ii <= i1; ii++) {
            if (ii < 0 || ii >= grid.nx || j < 0 || j >= grid.nz) continue;
            const k = j * grid.nx + ii;
            (grid.bucket[k] || (grid.bucket[k] = [])).push(i, s);
          }
        }
      }
    }
  }

  /** Nearest usable point on the network for this mode. Returns an edge and metres along it. */
  function locate(x, z, mode) {
    if (!G.built || !grid.bucket) return null;
    const bit = MODE_BIT[mode || 'car'] || MODE_BIT.car;
    let bestE = -1, bestD = Infinity, bestAlong = 0, bx = 0, bz = 0;
    const ci = Math.floor((x - grid.x0) / GRID_M), cj = Math.floor((z - grid.z0) / GRID_M);
    for (let ring = 0; ring <= 24; ring++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= grid.nz) continue;
        for (let i = ci - ring; i <= ci + ring; i++) {
          // Only the new ring, not the filled square: the interior was tested on the last pass.
          if (ring > 0 && Math.abs(j - cj) !== ring && Math.abs(i - ci) !== ring) continue;
          if (i < 0 || i >= grid.nx) continue;
          const b = grid.bucket[j * grid.nx + i];
          if (!b) continue;
          for (let q = 0; q < b.length; q += 2) {
            const ei = b[q];
            if (!(G.eMask[ei] & bit)) continue;
            const s = b[q + 1];
            const p = G.ePts[ei], cum = G.eCum[ei];
            segClosest(x, z, p[s][0], p[s][1], p[s + 1][0], p[s + 1][1], tmp);
            if (tmp.d2 < bestD) {
              bestD = tmp.d2; bestE = ei;
              bestAlong = cum[s] + tmp.t * (cum[s + 1] - cum[s]);
              bx = tmp.x; bz = tmp.z;
            }
          }
        }
      }
      // One more ring than the hit needs, because a nearer segment can sit diagonally out.
      if (bestE >= 0 && Math.sqrt(bestD) <= ring * GRID_M) break;
    }
    if (bestE < 0) return null;
    const len = G.eLen[bestE];
    return {
      edge: bestE,
      alongM: bestAlong,
      x: bx, z: bz,
      distanceM: Math.sqrt(bestD),
      nodeAt: bestAlong < len * 0.5 ? G.eFrom[bestE] : G.eTo[bestE],
      fromNode: G.eFrom[bestE], toNode: G.eTo[bestE],
      name: G.eName[bestE], surface: G.eSurface[bestE], cls: G.eClass[bestE]
    };
  }

  /** Nearest graph node usable by this mode. Cheap: used constantly. */
  function nearestNode(x, z, mode) {
    if (!G.built) return -1;
    const bit = MODE_BIT[mode || 'car'] || MODE_BIT.car;
    let best = -1, bd = Infinity;
    for (let i = 0; i < G.N; i++) {
      if (!(G.nodeMask[i] & bit)) continue;
      const dx = G.nx[i] - x, dz = G.nz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Position and heading metres along an arc. No allocation when `out` is supplied. */
  function pointOnArc(arc, metres, out) {
    const i = arc >> 1;
    if (i < 0 || i >= G.E) return null;
    const rev = (arc & 1) === 1;
    const len = G.eLen[i];
    const along = clamp(rev ? len - metres : metres, 0, len);
    const p = G.ePts[i], cum = G.eCum[i];
    let s = 0;
    while (s < p.length - 2 && cum[s + 1] < along) s++;
    const seg = cum[s + 1] - cum[s];
    const f = seg > 0 ? (along - cum[s]) / seg : 0;
    const x = p[s][0] + (p[s + 1][0] - p[s][0]) * f;
    const z = p[s][1] + (p[s + 1][1] - p[s][1]) * f;
    let dx = p[s + 1][0] - p[s][0], dz = p[s + 1][1] - p[s][1];
    if (rev) { dx = -dx; dz = -dz; }
    const L = Math.hypot(dx, dz) || 1;
    const o = out || {};
    o.x = x; o.z = z;
    o.y = world.island ? world.island.height(x, z) : 0;
    o.dx = dx / L; o.dz = dz / L;
    o.headingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
    return o;
  }

  /* ---------------------------------------------------------------- closures */

  const closures = [];

  function close(edgeIdx, untilMin, why) {
    if (edgeIdx < 0 || edgeIdx >= G.E) return false;
    G.eClosedUntil[edgeIdx] = untilMin;
    G.eClosedWhy[edgeIdx] = why;
    closures.push({ edge: edgeIdx, road: G.eName[edgeIdx], until: untilMin, why });
    bumpAllVehicleModes();
    return true;
  }

  function expireClosures(w) {
    const t = nowMin(w);
    let changed = false;
    for (let i = closures.length - 1; i >= 0; i--) {
      if (closures[i].until <= t) {
        G.eClosedUntil[closures[i].edge] = 0;
        G.eClosedWhy[closures[i].edge] = null;
        closures.splice(i, 1);
        changed = true;
      }
    }
    if (changed) bumpAllVehicleModes();
    state.closures = closures.map((c) => ({
      road: c.road, why: c.why, minutesLeft: Math.max(0, Math.round(c.until - t))
    }));
  }

  /* ---------------------------------------------------------------- is the island cut?

  The one question this network exists to answer. East Coast Road has no parallel route, and
  data/transport.json says the only alternative is 4WD on sand, which is not open to a bus, a truck
  or an ambulance, and which the tide shuts twice a day. So "cut" is tested for the ordinary car:
  can you still drive from the Junner Street ferry terminal to Point Lookout. */

  let cutRefs = null;
  function findCutRefs() {
    if (cutRefs) return cutRefs;
    if (!G.built) return null;
    // Junner Street is the barge terminal end; the Gorge Walk end of Mooloomba Road is the far end.
    let dunwich = -1, lookout = -1;
    for (let i = 0; i < G.N; i++) {
      const l = String(G.nodeLabel[i] || '').toLowerCase();
      if (dunwich < 0 && l.includes('junner street')) dunwich = i;
      if (lookout < 0 && l.includes('mooloomba road')) lookout = i;
    }
    if (dunwich < 0 || lookout < 0) return null;
    cutRefs = { dunwich, lookout };
    return cutRefs;
  }

  function checkCut(w) {
    const refs = findCutRefs();
    if (!refs) return;
    const t = nowMin(w);
    const r = tableRoute(refs.dunwich, refs.lookout, 'car', t);
    const cut = !r;
    if (cut !== state.islandCut) {
      state.islandCut = cut;
      if (cut) {
        const why = closures.length ? closures.map((c) => `${c.road}: ${c.why}`).join('; ') : 'the sealed network is broken';
        state.islandCutReason = why;
        w.bus.emit('navigation:island-cut', {
          why,
          text: 'Dunwich (Goompi) and Point Lookout (Mooloomba) are no longer connected by sealed road. '
            + 'There is no parallel route. The only way across is four wheel drive on the beach, and that '
            + 'is not open to a bus, a truck or an ambulance.',
          beachOpen: beachState['main-beach'].open,
          source: 'data/transport.json road-east-coast-a capacity_constraint'
        });
      } else {
        state.islandCutReason = null;
        w.bus.emit('navigation:island-rejoined', { text: 'East Coast Road is open again.' });
      }
    }
  }

  /* ---------------------------------------------------------------- the public interface

  Non-enumerable, so a probe dumped to JSON shows the state of the network rather than a hundred
  function names, and so TWIN.probe() stays cheap. */

  const api = {
    /** Graph size. */
    size: () => ({ nodes: G.N, edges: G.E, arcs: G.A }),
    node: (i) => (i >= 0 && i < G.N ? { i, x: G.nx[i], y: G.ny[i], z: G.nz[i], label: G.nodeLabel[i], kind: G.nodeKind[i], region: G.nodeRegion[i] } : null),
    edge: (i) => (i >= 0 && i < G.E ? {
      i, from: G.eFrom[i], to: G.eTo[i], lengthM: G.eLen[i], speedKmh: G.eSpeed[i],
      surface: G.eSurface[i], cls: G.eClass[i], name: G.eName[i], basis: G.eBasis[i],
      beach: G.eBeach[i], tideDependent: !!G.eTide[i],
      closedFor: G.eClosedWhy[i]
    } : null),
    edgeName: (i) => (i >= 0 && i < G.E ? G.eName[i] : null),
    edgeLength: (i) => (i >= 0 && i < G.E ? G.eLen[i] : 0),
    edgeClass: (i) => (i >= 0 && i < G.E ? G.eClass[i] : null),
    edgeSpeedKmh: (i) => (i >= 0 && i < G.E ? G.eSpeed[i] : 0),
    edgeBeach: (i) => (i >= 0 && i < G.E ? G.eBeach[i] : null),
    arcFrom: (arc) => ((arc & 1) === 0 ? G.eFrom[arc >> 1] : G.eTo[arc >> 1]),
    arcTo: (arc) => ((arc & 1) === 0 ? G.eTo[arc >> 1] : G.eFrom[arc >> 1]),
    arcsOf: (nodeIdx) => G.adjArc.subarray(G.adjStart[nodeIdx], G.adjStart[nodeIdx + 1]),
    nodeLabel: (i) => G.nodeLabel[i] || null,
    nodeRegion: (i) => G.nodeRegion[i] || null,
    nodeXZ: (i, out) => { const o = out || {}; o.x = G.nx[i]; o.y = G.ny[i]; o.z = G.nz[i]; return o; },

    locate,
    nearestNode,
    pointOnArc,

    /** Free-flow strategic route. Exact, table driven, no search. */
    route: (from, to, mode) => {
      state.routing.requests++;
      if (!G.built || from < 0 || to < 0) return null;
      const r = tableRoute(from, to, mode || 'car', nowMin(world));
      if (r) state.routing.tableHits++; else state.routing.failures++;
      return r;
    },
    /** Congestion aware route, for a vehicle deciding now. */
    replan: (from, to, mode, opts) => {
      state.routing.requests++;
      state.routing.searches++;
      state.routing.replans++;
      if (!G.built || from < 0 || to < 0) return null;
      const r = search(from, to, mode || 'car', nowMin(world), opts);
      if (!r) state.routing.failures++;
      return r;
    },
    /** Straight time cost of an arc as it stands, in seconds. */
    arcSeconds,
    baseSeconds: (edgeIdx, mode) => baseSeconds(edgeIdx, mode),
    /** traffic.js writes back what it measured, so the next replan knows about the queue. */
    setArcDelay: (arc, factor) => { if (arc >= 0 && arc < G.A) G.arcDelay[arc] = clamp(factor, 1, 24); },
    arcDelay: (arc) => (arc >= 0 && arc < G.A ? G.arcDelay[arc] : 1),
    resetArcDelays: () => { if (G.arcDelay) G.arcDelay.fill(1); },

    open: (edgeIdx, mode) => edgeOpen(edgeIdx, MODE_BIT[mode || 'car'] || MODE_BIT.car, nowMin(world)),
    close,
    reopen: (edgeIdx) => {
      for (let i = closures.length - 1; i >= 0; i--) if (closures[i].edge === edgeIdx) closures.splice(i, 1);
      G.eClosedUntil[edgeIdx] = 0; G.eClosedWhy[edgeIdx] = null;
      bumpAllVehicleModes();
    },

    beach: (id) => beachState[id] || null,
    beaches: () => beachState,
    /** Is this edge one of the two gazetted beach highways, and is it drivable this minute? */
    beachOpenFor: (edgeIdx) => {
      const b = G.eBeach[edgeIdx];
      return b ? beachState[b].open : true;
    },

    /** Every edge index carrying this road name. Used by traffic.js for incidents and by the UI. */
    edgesNamed: (name) => {
      const out = [];
      const n = String(name || '').toLowerCase();
      for (let i = 0; i < G.E; i++) if (String(G.eName[i] || '').toLowerCase() === n) out.push(i);
      return out;
    },
    /** Nodes whose label contains this text. The terminals, the junctions, the beach entrances. */
    findNodes: (text) => {
      const out = [];
      const n = String(text || '').toLowerCase();
      for (let i = 0; i < G.N; i++) if (String(G.nodeLabel[i] || '').toLowerCase().includes(n)) out.push(i);
      return out;
    },
    ready: () => G.built
  };

  for (const k of Object.keys(api)) {
    Object.defineProperty(state, k, { value: api[k], enumerable: false, configurable: true });
  }

  /* ---------------------------------------------------------------- system */

  return world.register({
    id: 'navigation',
    phase: 'movement',
    order: 10,

    init(w) {
      build(w);
      updateBeaches(w);
      if (G.built) checkCut(w);
    },

    tick(w) {
      if (!G.built) {
        // The roads layer builds its network at registration, so this only ever runs when the
        // manifest order changes under us. Retry quietly rather than dying.
        if (!build(w)) return;
      }
      expireClosures(w);
      updateBeaches(w);
      checkCut(w);
      // Arc delays decay back toward free flow, so a queue that cleared stops steering routes.
      const A = G.arcDelay;
      for (let i = 0; i < A.length; i++) if (A[i] > 1) A[i] = 1 + (A[i] - 1) * 0.72;
    },

    describe() {
      const mb = beachState['main-beach'], fb = beachState['flinders-beach'];
      return {
        ready: state.ready,
        nodes: state.counts.nodes,
        edges: state.counts.edges,
        stitches: state.counts.stitches,
        accessLinks: state.counts.accessLinks,
        carKm: state.kmByMode.car || 0,
        fourwdKm: state.kmByMode.fourwd || 0,
        mainBeachOpen: mb.open,
        mainBeachChangeMin: mb.minutesToChange,
        mainBeachSwellExtra: mb.swellExtraMin,
        flindersOpen: fb.open,
        flindersChangeMin: fb.minutesToChange,
        closures: state.closures.length,
        islandCut: state.islandCut,
        routeRequests: state.routing.requests,
        routeFailures: state.routing.failures
      };
    },

    save() {
      return {
        highs: Object.fromEntries(BEACHES.map((b) => [b.id, beachState[b.id].highs.slice(-4)])),
        closures: closures.map((c) => ({ edge: c.edge, until: c.until, why: c.why }))
      };
    },
    load(w, s) {
      if (!s) return;
      for (const b of BEACHES) {
        const arr = s.highs && s.highs[b.id];
        if (Array.isArray(arr)) beachState[b.id].highs = arr.slice();
      }
      closures.length = 0;
      for (const c of s.closures || []) {
        if (c.edge >= 0 && c.edge < G.E) { closures.push({ edge: c.edge, road: G.eName[c.edge], until: c.until, why: c.why }); G.eClosedUntil[c.edge] = c.until; G.eClosedWhy[c.edge] = c.why; }
      }
      bumpAllVehicleModes();
    }
  });
}
