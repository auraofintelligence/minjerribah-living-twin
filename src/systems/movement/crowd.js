// Crowd. Where everybody is standing, and how they got there on their feet.
//
// WHAT THIS FIXES
//   needs.js decides that Bev is walking the dog on the foreshore and schedule.js decides that
//   Dave is on shift at the bakery. Both of them then had a single coordinate: the published point
//   of the place. Two hundred people at Cylinder Beach were two hundred people standing inside one
//   another, and a walk from a house to the shop was a straight line through three back yards and
//   a dune. This file gives every person a spot of their own and a way of getting to it.
//
// THE THREE THINGS A CROWD HAS TO DO
//   FLOW.   People on foot follow the walking tracks and the streets that are actually mapped in
//           data/geography.json, at a real walking speed of 1.36 m/s, slowed by whoever is in
//           front of them.
//   BUNCH.  A place holds people in a shape that belongs to it. The North Gorge Walk is a published
//           1.375 km track and the people on it are strung out along it, not piled at its
//           trailhead. A beach spreads along the sand and nobody stands in the water. A house holds
//           four people in a yard. A shopfront holds a knot at the door.
//   JAM.    A queue is a line, it has a length, it has a wait, and it drains. The ferry terminal at
//           Junner Street and the two bakery counters are the queues this island actually has, and
//           every one of them is a real premises out of the packs.
//
// WHAT IS PUBLISHED
//   The North Gorge Walk and every other walking track, from data/geography.json via the roads
//   layer. Every premises coordinate, from data/places.json and data/businesses.json. The ferry
//   terminals. Free walking speed is the flat unloaded average navigation.js routes on.
//
// WHAT IS MODELLED, AND SAYS SO
//   Personal spacing, the shape a place holds a crowd in, how much a dense footpath slows somebody
//   down, the counter service rate behind a queue length, and the share of people at an indoor
//   premises who are out the front of it rather than inside. None of these is measured anywhere,
//   all of them are in the read model under `basis`, and no pedestrian count for this island was
//   found in any pack.
//
// HOW IT STAYS INSIDE THE BUDGET
//   Two thousand people times a hundred and forty four ticks a day is three hundred thousand
//   placements a sim-day, and the tick budget for the whole island is four milliseconds. So almost
//   nothing here runs for somebody who has not moved. A person's spot, their pose, whether they
//   are out of doors and which shape their place holds them in are all worked out once, when their
//   action changes, and then remembered. The density grid is kept up to date by the people who
//   move rather than rebuilt from everybody. On a normal tick about two hundred people out of two
//   thousand do any work at all.
//
// Reads: navigation, roadNetwork, traffic, schedule, weather, daylight, visitors.
// Publishes: crowd. Emits: crowd:ready crowd:crush crowd:queue-long crowd:queue-cleared

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const hash01 = (a, b) => hash32(a, b) / 4294967296;

/** Free walking speed, metres per second. The same figure navigation.js routes on. */
const FOOT_MS = 1.36;
/** How close a walker has to be before they have arrived at their spot. */
const ARRIVED_M = 3.5;
/** Under this, a walk is a straight line across a yard or a street rather than a routed trip. */
const SHORT_WALK_M = 240;
/** Metres of elbow room one standing person takes. MODELLED. */
const SPACING_M = 1.5;
/** The grid the density read is taken on. */
const CELL_M = 40;
/** Seconds in one tick. */
const TICK_S = 600;

/** How a place holds the people who are at it. All MODELLED, all in the read model. */
const SHAPES = {
  home: { radius: 9, spread: 'yard' },
  beach: { radius: 46, spread: 'shore' },
  track: { radius: 12, spread: 'track' },
  queue: { radius: 8, spread: 'line' },
  premises: { radius: 11, spread: 'door' },
  lookout: { radius: 18, spread: 'rail' },
  park: { radius: 30, spread: 'yard' },
  water: { radius: 26, spread: 'shore' }
};

/** Actions that happen at home but out of doors, so the person is drawn. */
const OUTDOOR_AT_HOME = new Set(['the-yard', 'bins-out', 'jobs-around-the-house', 'having-people-over']);
/** Actions that are plainly outdoors wherever they are. */
const OUTDOOR_ACTIONS = new Set([
  'a-swim', 'surf', 'the-surf-check', 'fishing-off-the-rocks', 'out-in-the-tinny', 'the-gorge-walk',
  'whale-watching', 'a-walk-on-the-beach', 'walking-the-dog', 'the-lake', 'beach-driving',
  'sitting-and-looking', 'a-ride', 'the-markets', 'a-working-bee', 'training-or-nippers',
  'waiting-for-the-boat', 'on-patrol', 'the-school-run'
]);
/** The share of people at an indoor premises who are out the front of it. MODELLED. */
const AT_THE_DOOR = 0.42;

/**
 * Poses. Small integers, because this is one more field on two thousand objects and the render
 * layer switches on it every frame. The same list is repeated at the top of
 * src/render/layers/people.js rather than imported, so a render layer never imports a system.
 */
export const POSE = {
  STAND: 0, WALK: 1, SIT: 2, WADE: 3, RIDE: 4, BOARD: 5, DOG: 6, WORK: 7, QUEUE: 8, DRIVE: 9
};

export function registerCrowd(world) {
  const state = world.publish('crowd', {
    ready: false,
    source: 'walking tracks and streets from data/geography.json, premises from data/places.json and data/businesses.json',
    onIsland: 0,
    outdoors: 0,
    walking: 0,
    standing: 0,
    indoors: 0,
    riding: 0,
    driving: 0,
    unmappedStreet: 0,
    visitorsOutdoors: 0,
    meanWalkMs: 0,
    slowedBy: 0,
    density: { cellM: CELL_M, busiestPeople: 0, busiestWhere: null, cellsWithPeople: 0, perHectarePeak: 0 },
    busiest: [],
    queues: [],
    gorge: { people: 0, lengthKm: 1.375, basis: 'published track length, data/geography.json North Gorge Walk' },
    crush: null,
    basis: {
      spacingM: SPACING_M,
      atTheDoorShare: AT_THE_DOOR,
      counterPerMin: 0.67,
      gatePerMin: 7.5,
      note: 'Personal spacing, the shape of a crowd at a place, the counter and gate service rates '
        + 'behind a queue length, and the share of people at an indoor premises who are outside it '
        + 'are all modelled. No pedestrian count for this island was found in any pack.'
    },
    notes: []
  });

  let nav = null;
  let R = null;
  let island = null;

  /* ---------------------------------------------------------------- named ground */

  /** The North Gorge Walk as one polyline with cumulative length, so people string out along it. */
  const gorgeTrack = { pts: [], cum: [], lengthM: 0 };
  const tracks = new Map();
  /** Queue anchors: a point, and the direction the line runs back in. */
  const queuePoints = new Map();

  function buildGround(w) {
    nav = w.read('navigation');
    island = w.island;
    if (!nav || nav.ready !== true || typeof nav.size !== 'function') return false;
    const size = nav.size();
    if (!size.edges) return false;
    R = w.residents;
    if (!R || !R.ready) return false;

    for (let i = 0; i < size.edges; i++) {
      if (nav.edgeClass(i) !== 'walk') continue;
      const e = nav.edge(i);
      if (!e || !e.name) continue;
      const key = String(e.name).toLowerCase();
      let t = tracks.get(key);
      if (!t) tracks.set(key, (t = { name: e.name, edges: [], lengthM: 0 }));
      t.edges.push(i);
      t.lengthM += e.lengthM;
    }
    const g = tracks.get('north gorge walk');
    if (g) {
      let cum = 0;
      const tmp = {};
      for (const ei of g.edges) {
        const e = nav.edge(ei);
        const steps = Math.max(2, Math.round(e.lengthM / 24));
        for (let s = 0; s <= steps; s++) {
          const p = nav.pointOnArc(ei * 2, (e.lengthM * s) / steps, tmp);
          if (!p) continue;
          const last = gorgeTrack.pts[gorgeTrack.pts.length - 1];
          if (last) cum += Math.hypot(p.x - last[0], p.z - last[1]);
          gorgeTrack.pts.push([p.x, p.z]);
          gorgeTrack.cum.push(cum);
        }
      }
      gorgeTrack.lengthM = cum;
      state.gorge.lengthKm = +(cum / 1000).toFixed(3);
    } else {
      state.notes.push('The North Gorge Walk is not in the mapped network, so people walking it are '
        + 'held at its published point rather than strung along the track.');
    }

    // The queues this island forms. Two ferry landings and three counters, all real premises.
    addQueue('dunwich-ferry-terminal', 'the Junner Street pontoon', 'ferry');
    addQueue('one-mile-jetty', 'One Mile Jetty', 'ferry');
    addQueue('biz:loaves-bakery-point-lookout', 'Loaves Bakery', 'counter');
    addQueue('biz:dunwich-bakery', 'Dunwich Bakery', 'counter');
    addQueue('biz:point-lookout-roadhouse', 'Point Lookout Roadhouse', 'counter');

    state.ready = true;
    w.bus.emit('crowd:ready', {
      tracks: tracks.size, queues: queuePoints.size, gorgeM: Math.round(gorgeTrack.lengthM)
    });
    return true;
  }

  function addQueue(placeId, label, kind) {
    const pl = R.places.get(placeId);
    if (!pl) return;
    // The line runs back toward the nearest road, which is where a queue actually goes.
    const loc = nav.locate(pl.x, pl.z, 'foot');
    let dx = 1, dz = 0;
    if (loc) {
      const l = Math.hypot(loc.x - pl.x, loc.z - pl.z) || 1;
      dx = (loc.x - pl.x) / l; dz = (loc.z - pl.z) / l;
    }
    queuePoints.set(placeId, {
      id: placeId, label, kind, x: pl.x, z: pl.z, dx, dz,
      people: 0, waitMin: 0, wasLong: false
    });
  }

  /* ---------------------------------------------------------------- the density grid

  Kept, not rebuilt. A person who has not moved is already in the right cell, and on a normal tick
  that is nine people in ten. Only somebody who crosses a cell boundary costs anything. */

  const dens = new Map();
  const cellX = new Map();
  const cellZ = new Map();
  const cellKey = (x, z) => (Math.floor(x / CELL_M) * 46337 + Math.floor(z / CELL_M)) | 0;
  const densityAt = (x, z) => dens.get(cellKey(x, z)) || 0;

  function enterCell(k, x, z, n) {
    const had = dens.get(k);
    if (had === undefined) { cellX.set(k, x); cellZ.set(k, z); dens.set(k, n); return; }
    dens.set(k, had + n);
  }
  function leaveCell(k, n) {
    const had = dens.get(k);
    if (had === undefined) return;
    const left = had - n;
    if (left <= 0) dens.delete(k); else dens.set(k, left);
  }
  /** Move a body from wherever the grid thinks it is to (x, z). Returns the new cell key. */
  function reCell(oldKey, x, z, n) {
    const k = cellKey(x, z);
    if (k === oldKey) return k;
    if (oldKey !== 0x7fffffff) leaveCell(oldKey, n);
    enterCell(k, x, z, n);
    return k;
  }
  const NO_CELL = 0x7fffffff;

  /* ---------------------------------------------------------------- spots

  Where exactly one person stands at a place that holds many. Derived from their own id, so it
  never changes under them and never shuffles when somebody else arrives or leaves. */

  const _spot = { x: 0, z: 0, pose: POSE.STAND };

  function shapeFor(placeId, actionId) {
    if (queuePoints.has(placeId)) return SHAPES.queue;
    if (placeId === 'north-gorge-walk' || actionId === 'the-gorge-walk') return SHAPES.track;
    if (actionId === 'a-swim' || actionId === 'surf' || actionId === 'a-walk-on-the-beach'
      || actionId === 'the-surf-check' || actionId === 'walking-the-dog') return SHAPES.beach;
    if (placeId === 'home') return SHAPES.home;
    if (actionId === 'sitting-and-looking' || actionId === 'whale-watching') return SHAPES.lookout;
    if (actionId === 'training-or-nippers' || actionId === 'a-working-bee' || actionId === 'the-markets') return SHAPES.park;
    if (actionId === 'out-in-the-tinny' || actionId === 'fishing-off-the-rocks') return SHAPES.water;
    return SHAPES.premises;
  }

  /**
   * @param id    the person's or party's own id, so the spot is theirs and stays theirs
   * @param cx,cz the published point of the place
   * @param n     how many are already on this ground, which is what makes a crowd spread
   * @param rank  position in a queue or along a track, or -1
   * @param q     the queue anchor when there is one
   */
  function spotAt(id, cx, cz, shape, n, rank, q) {
    // The size of the crowd is bucketed to the next power of two before it widens the ring. A spot
    // that moved every time somebody else arrived would have the whole beach shuffling every ten
    // minutes, and every person on it setting off walking to their new spot.
    const bucket = 1 << (31 - Math.clz32(Math.max(1, n | 0)));
    const grow = Math.sqrt(bucket) * SPACING_M;
    const r = Math.min(shape.radius + grow, shape.radius * 3.2 + 8);

    if (shape.spread === 'line' && rank >= 0 && q) {
      // A queue: one behind the other, doubling back into a second file past twenty deep, which is
      // what a footpath queue does when it runs out of footpath.
      const file = rank >= 20 ? 1 : 0;
      const place = rank >= 20 ? rank - 20 : rank;
      _spot.x = cx + q.dx * (place * 0.85) + (-q.dz) * (file * 1.1);
      _spot.z = cz + q.dz * (place * 0.85) + (q.dx) * (file * 1.1);
      _spot.pose = POSE.QUEUE;
      return _spot;
    }

    if (shape.spread === 'track' && gorgeTrack.pts.length > 1) {
      const t = trackPoint(hash01(id, 41), hash01(id, 7));
      _spot.x = t.x; _spot.z = t.z;
      _spot.pose = POSE.WALK;
      return _spot;
    }

    // A disc, from the person's own id. Square root on the radius so people spread evenly over the
    // area rather than crowding the middle of it.
    const a = hash01(id, 13) * Math.PI * 2;
    const rad = Math.sqrt(hash01(id, 29)) * r;
    const ox = Math.cos(a) * rad;
    const oz = Math.sin(a) * rad;

    if (shape.spread === 'shore' && island) {
      // A beach is long and narrow, so a crowd on one is long and narrow. Spreading people in a
      // circle round the published point of Cylinder Beach put half of them up the back of the
      // dune and the other half in the water. This lays them along the shore instead: wide in the
      // direction the sand runs, tight across it, which is what a beach crowd actually looks like
      // from the headland.
      const sh = shoreFrame(cx, cz);
      let x = cx + (sh.tx * ox - sh.tz * oz * 0.30) * 2.1;
      let z = cz + (sh.tz * ox + sh.tx * oz * 0.30) * 2.1;
      let h = island.height(x, z);
      for (let k = 0; k < 4 && h < island.seaLevel + 0.25; k++) {
        x = cx + (x - cx) * 0.5;
        z = cz + (z - cz) * 0.5;
        h = island.height(x, z);
      }
      if (h < island.seaLevel + 0.25) {
        const d = dryNear(cx, cz);
        x = d.x + ox * 0.35; z = d.z + oz * 0.35;
        h = island.height(x, z);
        if (h < island.seaLevel + 0.25) { x = d.x; z = d.z; h = island.height(x, z); }
      }
      _spot.x = x; _spot.z = z;
      // Ankle deep counts as being in the water, which is where a lot of this island stands.
      _spot.pose = h < island.seaLevel + 0.9 ? POSE.WADE : POSE.STAND;
      return _spot;
    }

    let x = cx + ox, z = cz + oz;
    if (island && island.height(x, z) < island.seaLevel + 0.2) {
      const d = dryNear(cx, cz);
      x = d.x; z = d.z;
    }
    _spot.x = x;
    _spot.z = z;
    _spot.pose = shape.spread === 'rail' ? POSE.SIT : POSE.STAND;
    return _spot;
  }

  /**
   * Which way the shore runs at a point. island.shoreDistance is a field, so its gradient points
   * straight inland and the direction at right angles to it is the line of the beach. Cached: the
   * beaches do not move between ticks and this is three grid samples.
   */
  const shoreCache = new Map();
  const _sf = { tx: 1, tz: 0 };
  function shoreFrame(cx, cz) {
    const key = (Math.round(cx / 40) * 46337 + Math.round(cz / 40)) | 0;
    const hit = shoreCache.get(key);
    if (hit) { _sf.tx = hit[0]; _sf.tz = hit[1]; return _sf; }
    let tx = 1, tz = 0;
    if (island && typeof island.shoreDistance === 'function') {
      const d = 30;
      const gx = island.shoreDistance(cx + d, cz) - island.shoreDistance(cx - d, cz);
      const gz = island.shoreDistance(cx, cz + d) - island.shoreDistance(cx, cz - d);
      const L = Math.hypot(gx, gz);
      if (L > 1e-4) { tx = -gz / L; tz = gx / L; }     // at right angles to the inland gradient
    }
    shoreCache.set(key, [tx, tz]);
    _sf.tx = tx; _sf.tz = tz;
    return _sf;
  }

  /** A point a fraction of the way along the North Gorge Walk, offset to one side of the track. */
  const _tp = { x: 0, z: 0 };
  function trackPoint(f, side01) {
    const want = clamp(f, 0, 1) * gorgeTrack.lengthM;
    let i = 1;
    while (i < gorgeTrack.cum.length - 1 && gorgeTrack.cum[i] < want) i++;
    const c0 = gorgeTrack.cum[i - 1], c1 = gorgeTrack.cum[i];
    const t = c1 > c0 ? (want - c0) / (c1 - c0) : 0;
    const a = gorgeTrack.pts[i - 1], b = gorgeTrack.pts[i];
    const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1;
    const side = (side01 - 0.5) * 2.2;
    _tp.x = px + (-tz / L) * side;
    _tp.z = pz + (tx / L) * side;
    return _tp;
  }

  /**
   * The nearest dry ground to a point. Several published coordinates sit on the water line and a
   * few sit just off it, so a crowd hung straight off them would be standing in the sea. Cached by
   * rounded coordinate: there are a few dozen places on this island and they do not move.
   */
  const dryCache = new Map();
  const _dry = { x: 0, z: 0 };
  function dryNear(cx, cz) {
    if (!island) { _dry.x = cx; _dry.z = cz; return _dry; }
    const key = (Math.round(cx / 8) * 46337 + Math.round(cz / 8)) | 0;
    const hit = dryCache.get(key);
    if (hit) { _dry.x = hit[0]; _dry.z = hit[1]; return _dry; }
    let bx = cx, bz = cz, best = island.height(cx, cz);
    if (best < island.seaLevel + 0.4) {
      outer:
      for (const rr of [30, 60, 120, 240, 480]) {
        for (let a = 0; a < 16; a++) {
          const th = (a / 16) * Math.PI * 2;
          const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
          const h = island.height(x, z);
          if (h > best) { best = h; bx = x; bz = z; }
          if (h > island.seaLevel + 0.9) break outer;
        }
      }
    }
    dryCache.set(key, [bx, bz]);
    _dry.x = bx; _dry.z = bz;
    return _dry;
  }

  /* ---------------------------------------------------------------- walking

  Three legs: off the network to its nearest point, along the network, and off the far end to the
  spot itself. A person walking to the shop follows the street rather than cutting through the
  neighbours' yards. */

  const _pt = { x: 0, z: 0, y: 0, dx: 0, dz: 0, headingDeg: 0 };

  function startWalk(mv, p, tx, tz) {
    mv.tx = tx; mv.tz = tz;
    mv.arcs = null; mv.ai = 0; mv.along = 0; mv.leg = 2;
    const dx = tx - p.x, dz = tz - p.z;
    if (dx * dx + dz * dz < SHORT_WALK_M * SHORT_WALK_M) return;   // straight there
    const from = footNode(p.x, p.z);
    const to = footNode(tx, tz);
    if (from < 0 || to < 0 || from === to) return;
    // A single search rather than navigation's all-pairs table. The table is exact and free once
    // built, but it is rebuilt from scratch whenever the beach gate changes a mode's availability,
    // four times a sim-day, and on the foot network that rebuild is a fourteen millisecond tick.
    // A hitch four times a day is worse than a few microseconds thirty times a tick.
    const arcs = footRoute(from, to);
    if (!arcs) return;
    mv.arcs = arcs; mv.ai = 0; mv.along = 0; mv.leg = 0;
    const nd = nav.node(from);
    mv.joinX = nd.x; mv.joinZ = nd.z;
  }

  /**
   * A walking route, remembered. This island has a hundred and forty four nodes and a few dozen
   * doorways, so thirty walks a tick are thirty repeats of about forty distinct journeys. The cache
   * is thrown away whenever the walkable network changes, which is when a beach gate opens or
   * shuts or a road is closed, and those are the only two things that change it.
   */
  const routeCache = new Map();
  let routeGen = '';
  function footRoute(from, to) {
    const b = nav.beaches;
    const gen = `${b ? (b['main-beach'].open ? 1 : 0) : 0}${b ? (b['flinders-beach'].open ? 1 : 0) : 0}`
      + (nav.closures ? nav.closures.length : 0);
    if (gen !== routeGen) { routeGen = gen; routeCache.clear(); }
    const key = from * 4096 + to;
    const hit = routeCache.get(key);
    if (hit !== undefined) return hit;
    const r = nav.replan(from, to, 'foot', null);
    const arcs = r && r.arcs.length ? r.arcs : null;
    routeCache.set(key, arcs);
    return arcs;
  }

  /**
   * The nearest walkable node to a point, remembered. People walk between the same few dozen
   * doorways all day, and navigation's locate() sweeps a grid of every centreline segment on the
   * island to answer, which is not something to pay for thirty times a tick forever.
   */
  const footCache = new Map();
  function footNode(x, z) {
    const key = (Math.round(x / 12) * 46337 + Math.round(z / 12)) | 0;
    const hit = footCache.get(key);
    if (hit !== undefined) return hit;
    const loc = nav.locate(x, z, 'foot');
    const n = loc ? loc.nodeAt : nav.nearestNode(x, z, 'foot');
    if (footCache.size > 12000) footCache.clear();
    footCache.set(key, n);
    return n;
  }

  /** Advance a walker by `secs` seconds. Returns true when they are standing on their spot. */
  function walk(mv, p, secs) {
    let budget = secs;
    // Whoever is already on this ground slows you down. That is the whole of crowd flow: the
    // Gorge walk on a Sunday and the pontoon before a sailing move at half pace.
    const speed = mv.base * mv.pace * (1 / (1 + densityAt(p.x, p.z) / 9));
    mv.speed = speed;
    let guard = 0;
    while (budget > 0 && guard++ < 30) {
      if (mv.leg === 0) {
        const dx = mv.joinX - p.x, dz = mv.joinZ - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.5) { mv.leg = 1; continue; }
        const step = speed * budget;
        if (step >= d) { p.x = mv.joinX; p.z = mv.joinZ; budget -= d / speed; mv.leg = 1; continue; }
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        mv.facing = (Math.atan2(dx, dz) * 180) / Math.PI;
        return false;
      }
      if (mv.leg === 1) {
        if (!mv.arcs || mv.ai >= mv.arcs.length) { mv.leg = 2; continue; }
        const arc = mv.arcs[mv.ai];
        const ei = arc >> 1;
        const len = nav.edgeLength(ei);
        const remain = len - mv.along;
        const need = remain / speed;
        if (need <= budget) {
          budget -= need;
          const pt = nav.pointOnArc(arc, len, _pt);
          if (pt) { p.x = pt.x; p.z = pt.z; mv.facing = pt.headingDeg; }
          mv.ai++; mv.along = 0;
          if (mv.ai >= mv.arcs.length) mv.leg = 2;
          continue;
        }
        mv.along += speed * budget;
        const pt = nav.pointOnArc(arc, mv.along, _pt);
        if (pt) { p.x = pt.x; p.z = pt.z; mv.facing = pt.headingDeg; }
        return false;
      }
      const dx = mv.tx - p.x, dz = mv.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < ARRIVED_M) { p.x = mv.tx; p.z = mv.tz; return true; }
      const step = speed * budget;
      if (step >= d) { p.x = mv.tx; p.z = mv.tz; return true; }
      p.x += (dx / d) * step; p.z += (dz / d) * step;
      mv.facing = (Math.atan2(dx, dz) * 180) / Math.PI;
      return false;
    }
    return false;
  }

  /* ---------------------------------------------------------------- per person */

  function mvOf(p) {
    let mv = p._mv;
    if (!mv) {
      mv = p._mv = {
        tx: p.x, tz: p.z, arcs: null, ai: 0, along: 0, leg: 2,
        joinX: 0, joinZ: 0, facing: hash01(p.id, 3) * 360, speed: 0, base: FOOT_MS,
        pace: 0.82 + hash01(p.id, 5) * 0.34,
        cell: NO_CELL, walking: false, hidden: false,
        // The classification cache, and the whole reason this file fits in the budget. The shape a
        // place holds a crowd in, whether this person is out of doors and what they are doing with
        // their hands all depend only on the action and the place. needs.js changes about a
        // hundred actions a tick out of two thousand people; everybody else is a pair of compares.
        clsAction: '', clsKey: '', clsShape: SHAPES.home, clsOutdoor: 0, clsPose: -1,
        wetGen: -1, pinX: NaN, pinZ: NaN, rank: -1, rankKey: '', onTrack: false, trackAt: 0,
        sx: p.x, sz: p.z, spose: POSE.STAND
      };
      p.pose = POSE.STAND;
      p.gait = 0;
      p.facing = mv.facing;
      p.outdoors = false;
    }
    return mv;
  }

  /**
   * Places that hold people in an order rather than in a scatter: a queue, and the gorge track.
   * A rank has to be stable, because a queue whose members renumbered every ten minutes would have
   * everybody in it walking sideways. So a rank is a slot, taken when somebody joins and given
   * back when they leave, and the free list is LIFO so two identical runs hand out the same slots.
   */
  class RankPool {
    constructor() { this.next = 0; this.free = []; this.count = 0; }
    take() { this.count++; return this.free.length ? this.free.pop() : this.next++; }
    give(i) {
      this.count--;
      if (this.count <= 0) { this.count = 0; this.next = 0; this.free.length = 0; return; }
      this.free.push(i);
    }
  }
  const pools = new Map();
  const poolFor = (key) => {
    let p = pools.get(key);
    if (!p) pools.set(key, (p = new RankPool()));
    return p;
  };
  function releaseRank(mv) {
    if (mv.rankKey === '') return;
    const p = pools.get(mv.rankKey);
    if (p) p.give(mv.rank);
    mv.rankKey = ''; mv.rank = -1;
  }

  function poseFor(p) {
    if (p.actionId === 'surf' || p.actionId === 'the-surf-check') return POSE.BOARD;
    if (p.actionId === 'walking-the-dog') return POSE.DOG;
    if (p.actionId === 'work-shift' && p.employed
      && /trade|build|construct|maintenance|ranger|waste|labour|clean/i.test(p.occupationId || '')) return POSE.WORK;
    if (p.actionId === 'sitting-and-looking' || p.actionId === 'fishing-off-the-rocks') return POSE.SIT;
    return -1;
  }

  /* ---------------------------------------------------------------- the tick */

  let lastQueueEmit = -999;
  let wetGen = 0;
  let wasWet = false;

  function run(w) {
    R = w.residents;
    if (!R || !R.ready) return;
    const people = R.people;
    const traffic = w.read('traffic');
    const weather = w.read('weather') || {};
    const day = w.read('daylight') || {};
    const wet = (weather.rainMmHr || 0) > 1.2;
    if (wet !== wasWet) { wasWet = wet; wetGen++; }
    const dayIndex = w.clock.dayIndex;

    let outdoors = 0, walking = 0, standing = 0, indoors = 0, driving = 0, riding = 0, unmapped = 0;
    let onTrackN = 0;
    let speedSum = 0, speedN = 0, slowed = 0;

    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const mv = p._mv || mvOf(p);

      /* --- the people who are not on the island, in a car, or awake ------------------ */

      if (!p.onIsland) {
        if (mv.cell !== NO_CELL) { leaveCell(mv.cell, 1); mv.cell = NO_CELL; }
        if (mv.rankKey !== '') releaseRank(mv);
        if (p.outdoors) p.outdoors = false;
        mv.walking = false;
        continue;
      }
      if (p._vehId) {
        // traffic.js owns the position. The person is in the car, so the vehicles layer draws them
        // and the people layer does not draw them standing on the bitumen.
        if (mv.cell !== NO_CELL) { leaveCell(mv.cell, 1); mv.cell = NO_CELL; }
        if (mv.rankKey !== '') releaseRank(mv);
        p.pose = POSE.DRIVE; p.gait = 0; p.outdoors = false;
        mv.walking = false;
        driving++;
        continue;
      }
      if (p.sleeping) {
        if (mv.cell !== NO_CELL) { leaveCell(mv.cell, 1); mv.cell = NO_CELL; }
        if (mv.rankKey !== '') releaseRank(mv);
        if (p.pose !== POSE.STAND || p.outdoors) { p.pose = POSE.STAND; p.gait = 0; p.outdoors = false; }
        p.x = p.tx = p.homeX; p.z = p.tz = p.homeZ;
        mv.walking = false;
        mv.pinX = NaN;
        indoors++;
        continue;
      }

      /* --- has anything changed? ----------------------------------------------------

      Two things matter here and they are both about who owns a position.

      population.js moves everybody toward p.tx at a plain speed every tick, and says in its own
      comment that the movement slice takes that over the moment it exists. It has to, and not
      only for the cost: a person given a spot on a beach was being dragged back onto the beach's
      published pin ten minutes later, and every crowd in the world collapsed to a point again. So
      when this file has finished placing somebody, it writes their reached position back into
      p.tx as well, which leaves population.js with nothing to do for them (its own d2 < 4 branch)
      and leaves the real destination in this system's own record.

      That means p.tx can no longer be compared against to notice a new destination, so the value
      needs.js last wrote is remembered separately. */

      const changed = p.tx !== mv.pinX || p.tz !== mv.pinZ
        || mv.clsAction !== p.actionId || mv.wetGen !== wetGen;

      if (!changed && !mv.walking && !mv.onTrack) {
        // Standing exactly where they were ten minutes ago. Nothing to work out.
        if (p.outdoors) { standing++; outdoors++; } else indoors++;
        continue;
      }

      /* --- the full path ------------------------------------------------------------ */

      const key = p.locationId || 'home';
      const q = queuePoints.get(key);

      if (changed) {
        mv.pinX = p.tx; mv.pinZ = p.tz;
        if (mv.clsAction !== p.actionId || mv.clsKey !== key || mv.wetGen !== wetGen) {
          mv.clsAction = p.actionId; mv.clsKey = key; mv.wetGen = wetGen;
          const atHome = key === 'home' || key === 'island';
          // 0 never outdoors, 1 always outdoors, 2 outdoors only when this person happens to be
          // one of the ones standing out the front rather than inside.
          mv.clsOutdoor = OUTDOOR_ACTIONS.has(p.actionId) ? 1
            : atHome ? (OUTDOOR_AT_HOME.has(p.actionId) ? 1 : 0) : 2;
          mv.clsShape = shapeFor(key, p.actionId);
          mv.clsPose = poseFor(p);
          mv.base = p.mode === 'bike' ? 4.4 : p.mode === 'boat' ? 9 : p.mode === 'drive' ? 13 : FOOT_MS;
          // Joining or leaving a queue. The gorge track is not ranked: people walk along it.
          const wantRank = mv.clsShape.spread === 'line' ? key : '';
          if (mv.rankKey !== wantRank) {
            releaseRank(mv);
            if (wantRank) { mv.rankKey = wantRank; mv.rank = poolFor(wantRank).take(); }
          }
          mv.onTrack = mv.clsShape.spread === 'track' && gorgeTrack.pts.length > 1;
          if (mv.onTrack) mv.trackAt = hash01(p.id, 41);
        }

        const shape = mv.clsShape;
        const here = Math.max(densityAt(p.tx, p.tz), 1);
        const s = spotAt(p.id, p.tx, p.tz, shape, here, mv.rank, q);
        mv.sx = s.x; mv.sz = s.z; mv.spose = s.pose;

        const outside = mv.clsOutdoor === 1 ? true
          : mv.clsOutdoor === 0 ? false
            : hash01(p.id, dayIndex * 7 + 3) < (wet ? AT_THE_DOOR * 0.4 : AT_THE_DOOR);
        mv.hidden = !outside;

        if (!outside) {
          // Inside. Held at the door so a click still finds them here, and not drawn.
          p.x = p.tx = mv.sx; p.z = p.tz = mv.sz;
          if (mv.cell !== NO_CELL) { leaveCell(mv.cell, 1); mv.cell = NO_CELL; }
          p.pose = POSE.STAND; p.gait = 0; p.outdoors = false;
          mv.walking = false;
          indoors++;
          continue;
        }
        const dx = mv.sx - p.x, dz = mv.sz - p.z;
        if (dx * dx + dz * dz > ARRIVED_M * ARRIVED_M) {
          startWalk(mv, p, mv.sx, mv.sz);
          mv.walking = true;
        } else {
          p.x = mv.sx; p.z = mv.sz;
          mv.walking = false;
        }
      }

      // The North Gorge Walk is 1.375 km of published track and people on it are walking it, not
      // standing at its trailhead. Each person carries their own place along it and moves on: the
      // whole circuit at an unhurried pace is about twenty minutes, which is what it takes.
      if (mv.onTrack && !mv.hidden) {
        onTrackN++;
        mv.trackAt += TICK_S / (20 * 60);
        if (mv.trackAt > 1) mv.trackAt -= 1;
        const t = trackPoint(mv.trackAt, hash01(p.id, 7));
        mv.sx = t.x; mv.sz = t.z;
        if (!mv.walking) { startWalk(mv, p, mv.sx, mv.sz); mv.walking = true; }
        else { mv.tx = mv.sx; mv.tz = mv.sz; }
      }

      if (mv.hidden) { indoors++; continue; }

      if (mv.walking) {
        const done = walk(mv, p, TICK_S);
        mv.walking = !done;
        if (!done) {
          // Somebody whose action says they are driving but for whom traffic.js could not put a
          // car on the road is on a street data/geography.json does not have. They still get where
          // they are going, at driving speed, and they are not drawn walking there at fifty
          // kilometres an hour. An honest gap, left as a gap and counted.
          p.tx = p.x; p.tz = p.z; mv.pinX = p.x; mv.pinZ = p.z;
          if (p.mode === 'drive') {
            if (mv.cell !== NO_CELL) { leaveCell(mv.cell, 1); mv.cell = NO_CELL; }
            p.outdoors = false;
            p.pose = POSE.DRIVE;
            unmapped++;
            walking++;
            continue;
          }
          walking++; outdoors++;
          p.pose = p.mode === 'bike' ? POSE.RIDE : (mv.clsPose >= 0 ? mv.clsPose : POSE.WALK);
          p.gait = mv.speed;
          p.facing = mv.facing;
          p.outdoors = true;
          mv.cell = reCell(mv.cell, p.x, p.z, 1);
          speedSum += mv.speed; speedN++;
          if (mv.speed < FOOT_MS * 0.7) slowed++;
          if (p.mode === 'bike') riding++;
          continue;
        }
      }

      standing++; outdoors++;
      p.pose = mv.clsPose >= 0 ? mv.clsPose : mv.spose;
      p.gait = 0;
      p.facing = mv.spose === POSE.QUEUE && q ? (Math.atan2(-q.dx, -q.dz) * 180) / Math.PI : mv.facing;
      p.outdoors = true;
      p.tx = p.x; p.tz = p.z; mv.pinX = p.x; mv.pinZ = p.z;
      mv.cell = reCell(mv.cell, p.x, p.z, 1);
    }

    for (const [key, q] of queuePoints) q.people = (pools.get(key) || { count: 0 }).count;

    /* --- visiting parties ----------------------------------------------------------- */

    let visOut = 0;
    const claimed = traffic && typeof traffic.partyClaimed === 'function' ? traffic.partyClaimed : null;
    const isDay = day.isDay !== false;
    for (const [id, c] of w.store.all('visitor')) {
      if (!Number.isFinite(c.x) || (c.x === 0 && c.z === 0)) continue;
      let rec = partySpot.get(id);
      if (!rec) partySpot.set(id, (rec = { sx: c.x, sz: c.z, cell: NO_CELL, size: c.size || 1 }));
      if (claimed && claimed(id)) {
        if (rec.cell !== NO_CELL) { leaveCell(rec.cell, rec.size); rec.cell = NO_CELL; }
        c.pose = POSE.DRIVE;
        c.outdoors = false;
        // NaN, so that the tick after the car is put away this party is given a fresh spot rather
        // than being left standing on the road node the car parked at.
        rec.sx = NaN; rec.sz = NaN;
        continue;
      }
      if (c.x !== rec.sx || c.z !== rec.sz) {
        // visitors.js has moved the party. Its point is the anchor; the spot hangs off it, so a
        // campground with sixty parties in it is not sixty families on one square metre.
        rec.size = c.size || 1;
        // A party spreads over ground that fits it. Two adults and two children take a corner of a
        // beach; a school group of sixty takes a good deal more, and pretending otherwise puts
        // sixty people inside one another.
        const shape = rec.size > 12 ? SHAPES.park : SHAPES.beach;
        const s = spotAt(hash32(id, 91) >>> 4, c.x, c.z, shape, Math.max(densityAt(c.x, c.z), rec.size), -1, null);
        rec.sx = s.x; rec.sz = s.z;
        c.pose = s.pose;
        c.facing = hash01(hash32(id, 0), 17) * 360;
        c.spread = Math.max(1.6, Math.sqrt(rec.size) * SPACING_M);
        c.x = rec.sx; c.z = rec.sz;
        rec.cell = reCell(rec.cell, c.x, c.z, rec.size);
      } else if (rec.cell === NO_CELL) {
        rec.cell = reCell(rec.cell, c.x, c.z, rec.size);
      }
      c.outdoors = isDay;
      visOut += rec.size;
    }
    if (partySpot.size > 1400) {
      for (const [k, rec] of Array.from(partySpot)) {
        if (w.store.has(k, 'visitor')) continue;
        if (rec.cell !== NO_CELL) leaveCell(rec.cell, rec.size);
        partySpot.delete(k);
      }
    }

    state.onIsland = people.length;
    state.outdoors = outdoors;
    state.walking = walking;
    state.standing = standing;
    state.indoors = indoors;
    state.driving = driving;
    state.riding = riding;
    state.unmappedStreet = unmapped;
    state.visitorsOutdoors = visOut;
    state.meanWalkMs = speedN ? +(speedSum / speedN).toFixed(2) : 0;
    state.slowedBy = slowed;
    state.gorge.people = onTrackN;

    settleDensity(w);
    settleQueues(w);
  }

  const partySpot = new Map();

  /* ---------------------------------------------------------------- the read model */

  /* The five busiest cells, kept without allocating: this runs a hundred and forty four times a
     sim-day forever and a pile of short lived objects is a garbage collection pause with a date. */
  const topK = new Int32Array(5);
  const topN = new Int32Array(5);

  function settleDensity(w) {
    topK.fill(0); topN.fill(0);
    let peak = 0;
    for (const [k, n] of dens) {
      if (n > peak) peak = n;
      if (n <= topN[4]) continue;
      let i = 4;
      while (i > 0 && n > topN[i - 1]) { topK[i] = topK[i - 1]; topN[i] = topN[i - 1]; i--; }
      topK[i] = k; topN[i] = n;
    }
    const top = [];
    const perHa = (CELL_M * CELL_M) / 10000;
    for (let i = 0; i < 5; i++) {
      if (topN[i] < 8) break;
      top.push({
        where: island ? island.regionAt(cellX.get(topK[i]), cellZ.get(topK[i])) : 'the island',
        people: topN[i],
        perHectare: Math.round(topN[i] / perHa)
      });
    }
    state.density.busiestPeople = peak;
    state.density.busiestWhere = top.length ? top[0].where : null;
    state.density.cellsWithPeople = dens.size;
    state.density.perHectarePeak = Math.round(peak / perHa);
    state.busiest = top;

    // A crush, not a busy afternoon. One person to eight square metres is a packed footpath; a
    // good day on Cylinder Beach is nearer one to twenty and is not worth telling anybody about.
    const peakPerHa = state.density.perHectarePeak;
    if (peakPerHa >= 1500 && state.crush !== 'yes') {
      state.crush = 'yes';
      w.bus.emit('crowd:crush', {
        people: peak, perHectare: peakPerHa, where: state.density.busiestWhere,
        text: `${peak} people inside a ${CELL_M} metre square at ${state.density.busiestWhere}. `
          + `That is about ${peakPerHa} to the hectare, roughly one person to every `
          + `${Math.round(10000 / Math.max(1, peakPerHa))} square metres, and it is the busiest `
          + 'ground on the island right now.'
      });
    } else if (peakPerHa < 900) {
      state.crush = null;
    }
  }

  function settleQueues(w) {
    const out = [];
    for (const q of queuePoints.values()) {
      const n = q.people;
      if (n <= 0) {
        if (q.wasLong) {
          q.wasLong = false;
          w.bus.emit('crowd:queue-cleared', { where: q.label, text: `The queue at ${q.label} has gone.` });
        }
        q.waitMin = 0;
        continue;
      }
      // MODELLED service rates: a counter serves about one person every ninety seconds, a terminal
      // gate about one every eight. Both are in the read model under `basis`, neither is measured.
      const perMin = q.kind === 'ferry' ? 7.5 : 0.67;
      q.waitMin = Math.round(n / perMin);
      out.push({ id: q.id, where: q.label, people: n, waitMin: q.waitMin, kind: q.kind });
      const long = q.kind === 'ferry' ? n >= 40 : n >= 10;
      if (long && !q.wasLong && w.clock.tick - lastQueueEmit > 6) {
        q.wasLong = true;
        lastQueueEmit = w.clock.tick;
        w.bus.emit('crowd:queue-long', {
          where: q.label, people: n, waitMin: q.waitMin,
          text: `${n} people in the queue at ${q.label}: about ${q.waitMin} minutes.`
        });
      } else if (!long) {
        q.wasLong = false;
      }
    }
    out.sort((a, b) => b.people - a.people);
    state.queues = out;
  }

  /* ---------------------------------------------------------------- frame smoothing

  A tick is ten sim-minutes and at 1x that is half a second of real time, so a walker who only
  moved on ticks would jump forward eight hundred metres at a time. This carries them along the
  same path at the same speed between ticks. Positions only, never simulation state, and it never
  runs headless: `--determinism` is unaffected because nothing in the agents phase reads p.x. */

  function smooth(w, dt) {
    if (!state.ready || !R || !R.ready || !nav) return;
    if (w.clock.paused) return;
    const step = dt * w.clock.speed.ticksPerSecond * TICK_S;
    if (step <= 0) return;
    const people = R.people;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const mv = p._mv;
      if (!mv || !mv.walking || !p.outdoors || p._vehId) continue;
      walk(mv, p, step);
    }
  }

  /* ---------------------------------------------------------------- the interface */

  const api = {
    densityAt,
    queueAt: (id) => queuePoints.get(id) || null,
    queuePoints: () => queuePoints,
    track: () => gorgeTrack,
    dryNear
  };
  for (const k of Object.keys(api)) {
    Object.defineProperty(state, k, { value: api[k], enumerable: false, configurable: true });
  }

  /* ---------------------------------------------------------------- system */

  return world.register({
    id: 'crowd',
    phase: 'movement',
    order: 30,

    init(w) {
      if (!buildGround(w)) return;
      // Give everybody the movement field up front, so two thousand people keep one hidden class.
      for (const p of w.residents.people) mvOf(p);
    },

    tick(w) {
      if (!state.ready && !buildGround(w)) return;
      run(w);
    },

    frame(w, dt) { smooth(w, dt); },

    describe() {
      return {
        ready: state.ready,
        outdoors: state.outdoors,
        walking: state.walking,
        standing: state.standing,
        indoors: state.indoors,
        driving: state.driving,
        unmappedStreet: state.unmappedStreet,
        visitorsOutdoors: state.visitorsOutdoors,
        meanWalkMs: state.meanWalkMs,
        slowedBy: state.slowedBy,
        busiestCell: state.density.busiestPeople,
        busiestWhere: state.density.busiestWhere,
        perHectarePeak: state.density.perHectarePeak,
        cellsWithPeople: state.density.cellsWithPeople,
        gorge: state.gorge.people,
        queues: state.queues.length,
        longestQueue: state.queues.length ? `${state.queues[0].where}:${state.queues[0].people}` : null
      };
    },

    save() { return { crush: state.crush }; },
    load(w, s) { if (s) state.crush = s.crush || null; }
  });
}
