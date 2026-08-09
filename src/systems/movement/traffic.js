// Traffic. Everything with an engine, on the one road this island has.
//
// WHY THIS ISLAND'S TRAFFIC IS NOT A CITY'S TRAFFIC
//
//   A city builder's traffic model is about a mesh: close one street and the flow finds another.
//   Minjerribah has no mesh. data/transport.json says it in as many words about East Coast Road:
//   there is no parallel route, and the only detour is sand, and the sand is not open to a bus, a
//   truck or an ambulance. So the interesting question here is never "which way round", it is
//   "is there a way at all, and for how long". Three things follow, and they are the whole file:
//
//   1. RE-ROUTING IS HONEST ABOUT FAILING. A vehicle that cannot get through asks navigation for
//      another way. Usually there is not one. It does not despawn and it does not teleport: it
//      turns around, goes back where it came from, and the read model counts it, so a player who
//      closes a road sees the consequence rather than a number quietly going down.
//
//   2. THE TIDE IS A TRAFFIC LIGHT. Main Beach (35.6 km) and Flinders Beach (10.0 km) are gazetted
//      roads, 4WD only, on a Vehicle Access Permit from Minjerribah Camping, shut for two hours
//      either side of every high tide. navigation.js measures the actual high water at each beach's
//      own tide station and publishes the gate. This file drives on it: a vehicle already out
//      there when the window closes has to get off, some of them do not make it, and that is the
//      thing that actually happens on this island most weekends.
//
//   3. THE JAMS ARE WHERE THE ISLAND'S JAMS ARE. Not at traffic lights, because there are none.
//      At the barge ramp when fifty two cars come off one boat through one gate; at a soft sand
//      beach entrance where vehicles go through one at a time; and at Point Lookout when the car
//      parks are full and tourism.js says people are circling. Queues build at the entrance to an
//      arc, spill back along the arc behind, and take minutes to clear, and the delay is written
//      back into navigation so the next vehicle to plan a route knows about it.
//
// WHAT IS PUBLISHED AND USED LITERALLY
//   Both bus timetables, route 880 and route 881, departure by departure, with the published
//   timing points and the published end to end times (43 minutes out, 39 back on the 880; 29 each
//   way on the 881). The vehicle ferry crossing time of 45 minutes and the walk-on crossing time
//   of 25. Vessel car capacities. The beach speed limits, 60 on Main Beach and 40 on Flinders.
//   The 4WD and permit condition. The two hour tide rule and its issuer.
//
// WHAT IS MODELLED, AND SAYS SO
//   Arc capacity and the jam density behind it. The barge ramp gate discharge rate. The share of
//   drivers who chance a closing tide window. The waste collection round. Nothing here claims to
//   be a traffic count, because no traffic count for this island was found in any pack.
//
// Reads: navigation, roadNetwork, ferry, schedule, tourism, waste, weather, daylight, visitors.
// Publishes: traffic. Emits: traffic:ready traffic:jam traffic:jam-cleared traffic:turned-back
//            traffic:no-way-round traffic:beach-closing traffic:caught-by-the-tide
//            traffic:barge-pulse traffic:bus-full

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A small integer hash, so a per-vehicle choice is stable rather than sequence dependent. */
function hash32(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const hash01 = (a, b) => hash32(a, b) / 4294967296;

/**
 * How many vehicles an arc will take in one ten minute tick, and how many fit on it nose to tail
 * before it is a car park. MODELLED. No traffic count, saturation flow or lane capacity figure for
 * any road on this island was found in any pack, so both numbers are on show in the read model and
 * neither is presented as measured. The shape is what matters: sealed road is generous, a soft
 * sand beach entrance is not, and that is the published difference between them.
 */
const CLASS_CAP = {
  spine: 150, sealed: 150, street: 90, gravel: 55,
  sandtrack: 16, beachaccess: 14, beachlink: 14, beachroute: 70, link: 90, walk: 0
};
/** Metres of road one stopped vehicle takes up, and how many abreast the class carries. */
const JAM_M = 7.2;
const CLASS_LANES = { spine: 2, sealed: 2, street: 1, gravel: 1, sandtrack: 1, beachaccess: 1, beachlink: 1, beachroute: 2, link: 1, walk: 0 };

/**
 * The barge ramp. Fifty two cars come off one vessel through one gate onto Junner Street, and the
 * street is one lane each way. MODELLED at five and a half vehicles a minute, which clears a full
 * Minjerribah deck in about ten minutes. SeaLink publishes no discharge rate.
 */
const RAMP_GATE_PER_TICK = 55;

/** Seconds in one tick. */
const TICK_S = 600;

/** How long a parked or arrived vehicle stays in the world before it is put away. */
const LINGER_TICKS = 2;

const MAX_VEHICLES = 520;

/* ------------------------------------------------------------------ published timetables */

const mins = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(Math.round(((m % 60) + 60) % 60)).padStart(2, '0')}`;

/**
 * The two bus routes, keyed to the node labels navigation actually carries. Every name here is a
 * published timing point out of data/transport.json services[svc-bus-880 / svc-bus-881].
 */
const BUS_ROUTES = [
  {
    id: 'svc-bus-880', label: 'Route 880',
    name: 'Route 880, Dunwich to Point Lookout',
    outKey: 'dunwich_to_point_lookout', backKey: 'point_lookout_to_dunwich',
    outFrom: 'dep_junner', outTo: 'gorge',
    ends: [['junner street'], ['mooloomba road']],
    minutes: { out: 43, back: 39 }
  },
  {
    id: 'svc-bus-881', label: 'Route 881',
    name: 'Route 881, Dunwich to Amity Point',
    outKey: 'dunwich_to_amity_point', backKey: 'amity_point_to_dunwich',
    outFrom: 'junner', outTo: 'amity_point',
    ends: [['junner street'], ['ballow street', 'claytons road']],
    minutes: { out: 29, back: 29 }
  }
];

/* ================================================================== the system */

export function registerTraffic(world) {
  const rng = world.rng.stream('traffic');

  const state = world.publish('traffic', {
    ready: false,
    source: 'navigation graph, with the published bus timetables and ferry crossing times from data/transport.json',
    /** The list src/render/layers/selection.js and src/ui/panels/inspector.js read. */
    vehicles: [],
    counts: { onRoad: 0, onSand: 0, afloat: 0, buses: 0, service: 0, spawnedToday: 0, arrivedToday: 0 },
    byKind: {},
    congestion: {
      worstRoad: null, worstQueue: 0, queued: 0, jams: 0, meanDelayPct: 0,
      basis: 'MODELLED. Arc capacity is ' + CLASS_CAP.sealed + ' vehicles a tick on sealed road and '
        + CLASS_CAP.beachaccess + ' at a soft sand beach entrance, and a jammed vehicle takes '
        + JAM_M + ' m. No traffic count for this island was found in any pack.'
    },
    jams: [],
    beach: { mainBeach: null, flinders: null, onSand: 0, chancers: 0, caught365: 0, warned: 0 },
    routing: {
      replans: 0, noAlternative: 0, turnedBack: 0, failed: 0, failedBy: {},
      failedNote: 'A trip that cannot be routed is a trip on a street data/geography.json does not '
        + 'carry. It is counted here rather than drawn on a road that is not there.'
    },
    services: { nextBus: null, busesRunning: 0, bargeAfloat: 0, wasteTruck: null },
    notes: []
  });

  /* ---------------------------------------------------------------- graph-side arrays */

  let nav = null;
  let N = 0, E = 0, A = 0;
  let capTick = null;      // per edge, vehicles a tick
  let jamCount = null;     // per edge, vehicles nose to tail
  let occ = null;          // per arc, vehicles on it right now
  let arcQ = null;         // per arc, vehicles waiting to get on to it
  let admitted = null;     // per arc, vehicles let on this tick
  let arcDelayPct = null;  // per arc, how much slower than free flow, for the read model
  let rampArc = -1;        // the arc off the barge ramp
  const jamOpen = new Map();

  /* ---------------------------------------------------------------- the fleet */

  /** Internals. Never published: the inspector prints every scalar on a published record. */
  const veh = [];
  /** Published cards, index aligned with `veh`. Scalars only, in the order a person reads them. */
  const cards = [];
  const byId = new Map();
  let seq = 0;

  const _pt = { x: 0, z: 0, y: 0, dx: 0, dz: 0, headingDeg: 0 };
  const _n0 = { x: 0, y: 0, z: 0 };

  /* ---------------------------------------------------------------- vehicle kinds
     Every one of these is a vehicle a person would actually see on this island in a day. */

  const KINDS = {
    car: { label: 'Car', mode: 'car', lengthM: 4.4, topKmh: 80 },
    ute: { label: 'Ute', mode: 'car', lengthM: 5.3, topKmh: 80 },
    'ute-and-boat': { label: 'Ute and boat trailer', mode: 'car', lengthM: 9.6, topKmh: 70 },
    fourwd: { label: 'Four wheel drive', mode: 'fourwd', lengthM: 4.9, topKmh: 80 },
    'fourwd-and-camper': { label: 'Four wheel drive and camper trailer', mode: 'fourwd', lengthM: 9.8, topKmh: 70 },
    bus: { label: 'Island bus', mode: 'bus', lengthM: 12.5, topKmh: 65 },
    'waste-truck': { label: 'Kerbside collection truck', mode: 'car', lengthM: 9.4, topKmh: 60 },
    ambulance: { label: 'Ambulance', mode: 'emergency', lengthM: 6.2, topKmh: 90 },
    barge: { label: 'Vehicle ferry', mode: 'water', lengthM: 55, topKmh: 26 },
    'water-taxi': { label: 'Passenger ferry', mode: 'water', lengthM: 24, topKmh: 46 }
  };

  /* ---------------------------------------------------------------- build */

  const anchors = { junner: -1, oneMile: -1, amity: -1, lookout: -1, dunwich: -1, waste: -1 };
  const terminals = { toondah: null, junner: null, oneMileMainland: null, oneMile: null };
  let R = null;

  function build(w) {
    nav = w.read('navigation');
    // navigation publishes `ready` as a flag and the rest of its interface as non-enumerable
    // functions on the same object, so this asks the flag and then checks the interface is there.
    if (!nav || nav.ready !== true || typeof nav.size !== 'function') return false;
    const size = nav.size();
    N = size.nodes; E = size.edges; A = size.arcs;
    if (!N || !E) return false;

    capTick = new Float32Array(E);
    jamCount = new Float32Array(E);
    for (let i = 0; i < E; i++) {
      const cls = nav.edgeClass(i) || 'sealed';
      capTick[i] = CLASS_CAP[cls] ?? 90;
      const lanes = CLASS_LANES[cls] ?? 1;
      jamCount[i] = Math.max(3, (nav.edgeLength(i) / JAM_M) * lanes);
    }
    occ = new Float32Array(A);
    arcQ = new Float32Array(A);
    admitted = new Float32Array(A);
    arcDelayPct = new Float32Array(A);

    anchors.junner = firstNode('junner street');
    anchors.oneMile = firstNode('yabby street') >= 0 ? firstNode('yabby street') : firstNode('one mile');
    anchors.lookout = firstNode('mooloomba road');
    anchors.amity = firstNode('ballow street') >= 0 ? firstNode('ballow street') : firstNode('claytons road');
    anchors.dunwich = firstNode('bingle road') >= 0 ? firstNode('bingle road') : anchors.junner;
    anchors.waste = firstNode('east coast road');

    // The gate off the barge. The first arc leaving the Junner Street node, which is the street
    // every vehicle off the vessel ferry drives up.
    if (anchors.junner >= 0) {
      const out = nav.arcsOf(anchors.junner);
      rampArc = out && out.length ? out[0] : -1;
    }

    // Mainland and island terminal coordinates, so the barge crosses the bay where it crosses it.
    const pack = w.data && w.data.transport;
    const isl = w.island;
    if (pack && isl) {
      for (const t of pack.terminals || []) {
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
        const p = isl.project(t.lon, t.lat);
        const rec = { id: t.id, name: t.name, x: p.x, z: p.z };
        if (t.id === 'terminal-toondah-vehicle') terminals.toondah = rec;
        else if (t.id === 'terminal-junner-street') terminals.junner = rec;
        else if (/one-mile/.test(t.id) && t.side === 'island') terminals.oneMile = rec;
        else if (/flyer|toondah-passenger/.test(t.id) && t.side === 'mainland') terminals.oneMileMainland = rec;
      }
    }
    if (!terminals.toondah && isl) {
      const p = isl.project(153.2846542, -27.5274951);
      terminals.toondah = { id: 'terminal-toondah-vehicle', name: 'Cleveland (Toondah Harbour)', x: p.x, z: p.z };
    }
    if (!terminals.junner && anchors.junner >= 0) {
      nav.nodeXZ(anchors.junner, _n0);
      terminals.junner = { id: 'terminal-junner-street', name: 'Junner Street, Dunwich (Goompi)', x: _n0.x, z: _n0.z };
    }
    if (!terminals.oneMileMainland) terminals.oneMileMainland = terminals.toondah;
    if (!terminals.oneMile) terminals.oneMile = terminals.junner;

    readBusTimetables(w);

    R = w.residents || null;
    // The one array src/render/layers/selection.js and src/ui/panels/inspector.js look for. It is
    // the live list, mutated in place, so a picked vehicle keeps its identity between ticks.
    state.vehicles = cards;
    state.ready = true;
    state.notes.push('Arc capacity and jam density are modelled. Bus times, the 45 minute vehicle '
      + 'crossing and the 25 minute walk-on crossing are published in data/transport.json.');
    w.bus.emit('traffic:ready', { nodes: N, edges: E, buses: busRuns.length });
    return true;
  }

  function firstNode(text) {
    const list = nav.findNodes(text);
    return list && list.length ? list[0] : -1;
  }

  /* ---------------------------------------------------------------- the buses
     Read straight out of the pack. Every departure below is a printed Translink time. */

  const busRuns = [];

  function readBusTimetables(w) {
    const pack = w.data && w.data.transport;
    if (!pack) return;
    for (const spec of BUS_ROUTES) {
      const svc = (pack.services || []).find((s) => s.id === spec.id);
      if (!svc || !svc.schedule) continue;
      const from = resolveEnd(spec.ends[0]);
      const to = resolveEnd(spec.ends[1]);
      if (from < 0 || to < 0) {
        state.notes.push(`${spec.label}: the timing points are published but the mapped network has no `
          + 'node for one end of the route, so no bus is put on the road for it.');
        continue;
      }
      const out = svc.schedule[spec.outKey] || [];
      const back = svc.schedule[spec.backKey] || [];
      for (const row of out) {
        const dep = mins(row[spec.outFrom]) ?? mins(row.one_mile) ?? mins(row.junner);
        if (dep == null) continue;
        busRuns.push({
          route: spec.id, label: spec.label, name: svc.name, dir: 'out',
          depMin: dep, from, to, tripMin: spec.minutes.out,
          arriveText: row[spec.outTo] || null,
          flag: row.flag || null
        });
      }
      for (const row of back) {
        const dep = mins(row[spec.outTo]) ?? mins(row.amity_point) ?? mins(row.gorge);
        if (dep == null) continue;
        busRuns.push({
          route: spec.id, label: spec.label, name: svc.name, dir: 'back',
          depMin: dep, from: to, to: from, tripMin: spec.minutes.back,
          arriveText: row[spec.outFrom] || row.junner || null,
          flag: row.flag || null
        });
      }
    }
    busRuns.sort((a, b) => a.depMin - b.depMin || (a.route < b.route ? -1 : 1));
  }

  function resolveEnd(names) {
    for (const n of names) {
      const i = firstNode(n);
      if (i >= 0) return i;
    }
    return -1;
  }

  /* ---------------------------------------------------------------- spawning */

  function nodeNear(x, z, mode) {
    const loc = nav.locate(x, z, mode);
    if (loc) return loc.nodeAt;
    return nav.nearestNode(x, z, mode);
  }

  function fail(why) {
    state.routing.failed++;
    state.routing.failedBy[why] = (state.routing.failedBy[why] || 0) + 1;
  }

  /**
   * Plan a trip. Which of navigation's two tiers to use is a real decision, not a preference.
   *
   * The exact all-pairs table is free once it is built and is the right answer for a car or a bus,
   * because the sealed network only changes when a road is closed, which is rare. It is the wrong
   * answer for four wheel drive, because the beach gate flips that mode's availability eight times
   * a sim-day and every flip throws the table away and rebuilds a hundred and forty four shortest
   * path trees. That rebuild was a ten millisecond tick, eight times a day, on a four millisecond
   * budget. A single congestion-aware search costs microseconds and is better routing anyway.
   */
  function plan(from, to, mode) {
    return mode === 'fourwd' ? nav.replan(from, to, mode, null) : nav.route(from, to, mode);
  }

  /**
   * Put a vehicle on the road. Returns the internal record or null when there is no route, which
   * is a real answer on this island and is counted rather than hidden.
   */
  function spawn(w, opts) {
    if (veh.length >= MAX_VEHICLES) return null;
    const kindSpec = KINDS[opts.kind] || KINDS.car;
    const mode = kindSpec.mode;
    if (mode === 'water') return spawnVessel(w, opts, kindSpec);

    let use = mode;
    let from = opts.fromNode >= 0 ? opts.fromNode : nodeNear(opts.fromX, opts.fromZ, mode);
    let to = opts.toNode >= 0 ? opts.toNode : nodeNear(opts.toX, opts.toZ, mode);
    if (from < 0 || to < 0) { fail('no road within reach'); return null; }
    if (from === to) return null;
    let route = plan(from, to, mode);
    if (!route && mode === 'car' && opts.fromNode < 0 && opts.toNode < 0) {
      // The sealed network in data/geography.json is 45 km of one road and a handful of streets,
      // and it is not one piece: a car parked in a mapped fragment has nowhere to drive to. The
      // four wheel drive network is 105 km and joins most of those fragments up over sand, which
      // on this island is a real answer rather than a fudge, so it is tried before giving up.
      const f2 = nodeNear(opts.fromX, opts.fromZ, 'fourwd');
      const t2 = nodeNear(opts.toX, opts.toZ, 'fourwd');
      if (f2 >= 0 && t2 >= 0 && f2 !== t2) {
        const alt = plan(f2, t2, 'fourwd');
        if (alt && alt.arcs.length) { route = alt; from = f2; to = t2; use = 'fourwd'; }
      }
      if (!route) { fail('no route on the mapped network'); return null; }
    }
    if (!route || !route.arcs.length) { fail('no route on the mapped network'); return null; }
    const modeUsed = use;

    const id = 'veh:' + (++seq);
    const v = {
      id, kind: opts.kind, mode: modeUsed, spec: kindSpec,
      arcs: route.arcs, ai: 0, along: 0,
      originNode: from, destNode: to,
      x: 0, z: 0, y: 0, hdg: 0, speedMs: 0,
      personId: opts.personId || null,
      partyId: opts.partyId || null,
      service: opts.service || null,
      run: opts.run || null,
      bornTick: w.clock.tick,
      dieTick: 0, arrived: false, linger: 0,
      waitTicks: 0, replans: 0, turnedBack: false,
      onBeach: null, warned: false, chancer: !!opts.chancer,
      salt: hash32(seq, w.clock.tick) >>> 8,
      lastArc: -1, distanceM: 0, plannedM: route.lengthM,
      trailer: !!opts.trailer, dust: 0, circling: false,
      actionId: null,
      // A bus that ran at the free flow speed would do Dunwich to Point Lookout in fifteen minutes.
      // Translink publishes forty three, because a bus stops. So a scheduled service is paced to
      // its own published end to end time rather than to the speed limit.
      paceScale: opts.tripMin ? clamp(route.seconds / (opts.tripMin * 60), 0.12, 1) : (opts.paceScale || 1)
    };
    const card = {
      id,
      kind: opts.kind,
      label: opts.label || kindSpec.label,
      doing: opts.doing || 'on the road',
      // A resident's own name where there is one, the published operator for a scheduled service,
      // and an honest blank for a car off the barge that nobody in this world has met.
      driver: opts.driver || opts.operator || 'not recorded',
      occupants: opts.occupants || 1,
      road: nav.edgeName(route.arcs[0] >> 1) || 'the island road',
      surface: null,
      from: nav.nodeLabel(from) || 'the island',
      to: nav.nodeLabel(to) || 'the island',
      route: `${(route.lengthM / 1000).toFixed(1)} km, about ${Math.max(1, Math.round(route.seconds / 60))} minutes`,
      speedKmh: 0,
      delayMin: 0,
      permit: opts.permit || null,
      x: 0, y: 0, z: 0, headingDeg: 0
    };
    v.card = card;
    place(v);
    veh.push(v);
    cards.push(card);
    byId.set(id, v);
    state.counts.spawnedToday++;
    if (v.personId != null && R) {
      const p = R.peopleById.get(v.personId);
      if (p) { p._vehId = id; p.x = v.x; p.z = v.z; }
    }
    return v;
  }

  /** A boat. It does not use the road graph at all: it crosses the bay between two real terminals. */
  function spawnVessel(w, opts, kindSpec) {
    const id = 'veh:' + (++seq);
    const v = {
      id, kind: opts.kind, mode: 'water', spec: kindSpec,
      arcs: null, ai: 0, along: 0,
      water: { ax: opts.ax, az: opts.az, bx: opts.bx, bz: opts.bz, t: 0, minutes: opts.minutes || 45 },
      x: opts.ax, z: opts.az, y: w.island ? w.island.seaLevel : 0, hdg: 0, speedMs: 0,
      personId: null, partyId: null, service: opts.service || null,
      bornTick: w.clock.tick, dieTick: 0, arrived: false, linger: 0,
      waitTicks: 0, replans: 0, turnedBack: false, onBeach: null, warned: false,
      salt: hash32(seq, w.clock.tick) >>> 8, lastArc: -1, distanceM: 0, plannedM: 0, trailer: false, dust: 0
    };
    const card = {
      id, kind: opts.kind, label: opts.label || kindSpec.label,
      doing: opts.doing || 'crossing the bay',
      driver: null,
      occupants: opts.occupants || 0,
      road: 'Quandamooka (Moreton Bay)',
      surface: 'water',
      from: opts.fromName || 'the mainland',
      to: opts.toName || 'the island',
      route: `${opts.minutes || 45} minute crossing, published`,
      speedKmh: 0, delayMin: 0, permit: null,
      x: v.x, y: v.y, z: v.z, headingDeg: 0
    };
    v.card = card;
    veh.push(v);
    cards.push(card);
    byId.set(id, v);
    return v;
  }

  function despawn(i) {
    const v = veh[i];
    byId.delete(v.id);
    if (v.personId != null && R) {
      const p = R.peopleById.get(v.personId);
      if (p && p._vehId === v.id) p._vehId = null;
    }
    // Release whatever it was holding on the network.
    if (v.arcs && v.ai < v.arcs.length) occ[v.arcs[v.ai]] = Math.max(0, occ[v.arcs[v.ai]] - 1);
    const last = veh.length - 1;
    veh[i] = veh[last]; cards[i] = cards[last];
    veh.length = last; cards.length = last;
  }

  /* ---------------------------------------------------------------- position */

  function place(v) {
    if (v.mode === 'water') {
      const wr = v.water;
      const t = clamp(wr.t, 0, 1);
      v.x = wr.ax + (wr.bx - wr.ax) * t;
      v.z = wr.az + (wr.bz - wr.az) * t;
      const dx = wr.bx - wr.ax, dz = wr.bz - wr.az;
      v.hdg = (Math.atan2(dx, dz) * 180) / Math.PI;
      v.y = world.island ? world.island.seaLevel : 0;
    } else {
      const arc = v.arcs[Math.min(v.ai, v.arcs.length - 1)];
      const p = nav.pointOnArc(arc, v.along, _pt);
      if (!p) return;
      v.x = p.x; v.z = p.z; v.y = p.y; v.hdg = p.headingDeg;
    }
    const c = v.card;
    c.x = Math.round(v.x); c.z = Math.round(v.z); c.y = Math.round(v.y * 10) / 10;
    c.headingDeg = Math.round(v.hdg);
  }

  /* ---------------------------------------------------------------- one tick of driving */

  function stepVehicle(w, v, t) {
    if (v.mode === 'water') {
      const wr = v.water;
      wr.t = clamp(wr.t + 10 / Math.max(1, wr.minutes), 0, 1);
      place(v);
      v.card.speedKmh = Math.round((Math.hypot(wr.bx - wr.ax, wr.bz - wr.az) / (wr.minutes * 60)) * 3.6);
      if (wr.t >= 1) { v.arrived = true; v.linger++; }
      return;
    }

    let budget = TICK_S;
    const arcs = v.arcs;
    let guard = 0;
    while (budget > 0 && v.ai < arcs.length && guard++ < 40) {
      const arc = arcs[v.ai];
      const ei = arc >> 1;
      const len = nav.edgeLength(ei);

      // Is the road still there? Tide, closure, or a mode that was never allowed.
      if (!nav.open(ei, v.mode)) {
        if (!handleBlocked(w, v, arc, t)) return;
        continue;
      }

      // Entering a new arc costs a place in that arc's queue. This is the whole congestion model:
      // a gate that lets a fixed number through per tick, and a queue behind it that occupies the
      // road it is standing on.
      if (v.along === 0) {
        const cap = arc === rampArc ? RAMP_GATE_PER_TICK : capTick[ei];
        const room = jamCount[ei] - occ[arc];
        if (admitted[arc] >= cap || room <= 0) {
          arcQ[arc]++;
          v.waitTicks++;
          v.card.delayMin = v.waitTicks * 10;
          v.card.doing = queueWord(v, ei);
          return;
        }
        admitted[arc]++;
        occ[arc]++;
        v.lastArc = arc;
        v.card.road = nav.edgeName(ei) || v.card.road;
        v.card.surface = nav.edge(ei) ? nav.edge(ei).surface : null;
        const beach = nav.edgeBeach(ei);
        v.onBeach = beach || null;
      }

      // Speed. Free flow from navigation, then whatever is actually on the road in front.
      const base = nav.baseSeconds(ei, v.mode);
      if (!Number.isFinite(base) || base <= 0) { if (!handleBlocked(w, v, arc, t)) return; continue; }
      const density = clamp(occ[arc] / jamCount[ei], 0, 0.96);
      // Greenshields: speed falls linearly with density and never quite reaches zero, so a queue
      // creeps rather than freezing, which is what a line of cars off a barge actually does.
      const flow = 1 - density * 0.92;
      const secs = base / Math.max(0.08, flow);
      const speed = (len / secs) * v.paceScale;
      v.speedMs = speed;
      const remain = len - v.along;
      const need = remain / speed;
      if (need <= budget) {
        budget -= need;
        v.distanceM += remain;
        occ[arc] = Math.max(0, occ[arc] - 1);
        v.ai++;
        v.along = 0;
        if (v.ai >= arcs.length) { v.arrived = true; break; }
      } else {
        v.along += speed * budget;
        v.distanceM += speed * budget;
        budget = 0;
      }
    }

    place(v);
    v.card.speedKmh = Math.round(v.speedMs * 3.6);
    v.card.delayMin = v.waitTicks * 10;
    if (v.onBeach) v.card.permit = 'Vehicle Access Permit, 4WD only, issued by Minjerribah Camping';
    v.dust = v.mode === 'fourwd' && v.speedMs > 6 && isLoose(v) ? clamp(v.dust + 0.5, 0, 1) : Math.max(0, v.dust - 0.25);
  }

  function isLoose(v) {
    if (!v.arcs || v.ai >= v.arcs.length) return false;
    const e = nav.edge(v.arcs[v.ai] >> 1);
    return !!e && (e.surface === 'sand' || e.surface === 'track' || e.surface === 'gravel');
  }

  function queueWord(v, ei) {
    const name = nav.edgeName(ei) || 'the road ahead';
    if (v.arcs[v.ai] === rampArc) return `queued at the barge ramp gate, ${v.waitTicks * 10} minutes`;
    const cls = nav.edgeClass(ei);
    if (cls === 'beachlink' || cls === 'beachaccess') return `queued at the beach entrance, ${v.waitTicks * 10} minutes`;
    return `held up on ${name}, ${v.waitTicks * 10} minutes`;
  }

  /**
   * The road ahead is shut. Ask navigation for another way with the closed edge taken out. This is
   * the honest bit: on this island the answer is usually no, and the vehicle turns around rather
   * than vanishing.
   */
  function handleBlocked(w, v, arc, t) {
    const ei = arc >> 1;
    v.replans++;
    state.routing.replans++;
    const here = nav.arcFrom(arc);
    const alt = v.replans <= 3 ? nav.replan(here, v.destNode, v.mode, { avoidEdge: ei }) : null;
    if (alt && alt.arcs.length) {
      if (v.ai < v.arcs.length) occ[v.arcs[v.ai]] = Math.max(0, occ[v.arcs[v.ai]] - 1);
      v.arcs = alt.arcs; v.ai = 0; v.along = 0;
      v.card.route = `re-routed: ${(alt.lengthM / 1000).toFixed(1)} km, about ${Math.max(1, Math.round(alt.seconds / 60))} minutes`;
      v.card.doing = `re-routed round ${nav.edgeName(ei) || 'a closed road'}`;
      return true;
    }
    state.routing.noAlternative++;
    if (v.turnedBack) {
      // It has already turned round once and is still stuck. Park it where it is and let go.
      v.arrived = true;
      v.card.doing = `stopped: no way through and no way back past ${nav.edgeName(ei) || 'the closure'}`;
      return false;
    }
    const home = nav.replan(here, v.originNode, v.mode, { avoidEdge: ei });
    if (home && home.arcs.length) {
      if (v.ai < v.arcs.length) occ[v.arcs[v.ai]] = Math.max(0, occ[v.arcs[v.ai]] - 1);
      v.arcs = home.arcs; v.ai = 0; v.along = 0;
      v.destNode = v.originNode;
      v.turnedBack = true;
      state.routing.turnedBack++;
      v.card.doing = `turned back: ${nav.edgeName(ei) || 'the road'} is shut and there is no way round`;
      v.card.to = nav.nodeLabel(v.originNode) || 'back where it started';
      if (w.clock.tick - lastTurnedTick > 12) {
        lastTurnedTick = w.clock.tick;
        w.bus.emit('traffic:turned-back', {
          vehicle: v.card.label, road: nav.edgeName(ei), at: nav.nodeRegion(here) || 'the island',
          text: `${v.card.label} turned back at ${nav.nodeLabel(here) || 'the closure'}: `
            + `${nav.edgeName(ei) || 'the road'} is shut and this island has no parallel route.`
        });
      }
      return true;
    }
    v.arrived = true;
    const beach = nav.edgeBeach(ei);
    if (beach) {
      // Not a closure: the tide. That story is told properly by traffic:caught-by-the-tide, and
      // saying "there is no way round" about a beach that reopens in two hours would be wrong.
      v.card.doing = `stopped: ${nav.edgeName(ei) || 'the beach'} shut behind them`;
      return false;
    }
    v.card.doing = 'stopped: the road is shut and there is nowhere to go';
    // Once every three sim-hours at most. It is a true and important thing about this island and
    // it stops being either if it is said sixty five times a day.
    if (w.clock.tick - lastNoWayTick > 18) {
      lastNoWayTick = w.clock.tick;
      w.bus.emit('traffic:no-way-round', {
        road: nav.edgeName(ei), vehicle: v.card.label,
        text: `${nav.edgeName(ei) || 'A road'} is shut and there is no way round it for a ${String(v.card.label).toLowerCase()}. `
          + 'East Coast Road has no parallel route and the beach is not open to everything.'
      });
    }
    return false;
  }

  let lastNoWayTick = -999;
  let lastTurnedTick = -999;

  /* ---------------------------------------------------------------- the tide gate */

  let beachWarnTick = -999;

  function tideWatch(w, t) {
    const beaches = typeof nav.beaches === 'function' ? nav.beaches() : nav.beaches;
    if (!beaches) return;
    const mb = beaches['main-beach'], fb = beaches['flinders-beach'];
    state.beach.mainBeach = mb ? { open: mb.open, minutesToChange: mb.minutesToChange, swellExtraMin: mb.swellExtraMin, cutOffRisk: +mb.cutOffRisk.toFixed(2) } : null;
    state.beach.flinders = fb ? { open: fb.open, minutesToChange: fb.minutesToChange, swellExtraMin: fb.swellExtraMin, cutOffRisk: +fb.cutOffRisk.toFixed(2) } : null;

    let onSand = 0, caught = 0, warned = 0;
    for (const v of veh) {
      if (!v.onBeach || v.arrived) continue;
      onSand++;
      const B = beaches[v.onBeach];
      if (!B) continue;
      if (!B.open) {
        // The window has shut and this vehicle is still out on the sand. It has to get off, and
        // the way off is the entrance it came in by, which may be a long way behind it.
        caught++;
        if (!v.warned) {
          v.warned = true;
          v.card.doing = `caught by the tide on ${B.name}: the beach shut while it was out there`;
          w.bus.emit('traffic:caught-by-the-tide', {
            beach: B.name, vehicle: v.card.label, driver: v.card.driver,
            swellM: B.swellM, extraMinutesFromSwell: B.swellExtraMin,
            text: `A ${String(v.card.label).toLowerCase()} was still on ${B.name} when the tide window shut. `
              + 'The rule is two hours either side of high water and it is not a suggestion: the water '
              + 'comes up to the dune and there is nowhere to go round.',
            rule: 'No driving on Main Beach or Flinders Beach within 2 hours of high tide, Minjerribah Camping'
          });
        }
      } else if (B.minutesToChange != null && B.minutesToChange < 40 && !v.warned) {
        warned++;
        v.warned = true;
        v.card.doing = `on ${B.name}, ${B.minutesToChange} minutes before it shuts`;
        if (w.clock.tick - beachWarnTick > 12) {
          beachWarnTick = w.clock.tick;
          w.bus.emit('traffic:beach-closing', {
            beach: B.name, minutes: B.minutesToChange, vehicles: onSand,
            text: `${B.name} closes to vehicles in ${B.minutesToChange} minutes. `
              + `${onSand} ${onSand === 1 ? 'vehicle is' : 'vehicles are'} still out on the sand.`
          });
        }
      }
    }
    state.beach.onSand = onSand;
    state.beach.warned = warned;
    if (caught) state.beach.caught365 += caught;
  }

  /* ---------------------------------------------------------------- congestion bookkeeping */

  function settleCongestion(w) {
    let queued = 0, worst = 0, worstArc = -1, delaySum = 0, delayN = 0;
    for (let a = 0; a < A; a++) {
      const ei = a >> 1;
      const cap = a === rampArc ? RAMP_GATE_PER_TICK : capTick[ei];
      const q = arcQ[a];
      if (q > 0) queued += q;
      if (q > worst) { worst = q; worstArc = a; }
      const density = jamCount[ei] > 0 ? occ[a] / jamCount[ei] : 0;
      // What navigation charges a route for using this arc next time somebody plans one.
      const factor = 1 + density * 5 + (cap > 0 ? q / cap : 0) * 4;
      if (factor > 1.02) {
        nav.setArcDelay(a, factor);
        delaySum += (factor - 1) * 100;
        delayN++;
        arcDelayPct[a] = (factor - 1) * 100;
      } else {
        arcDelayPct[a] = 0;
      }
      arcQ[a] = 0;
      admitted[a] = 0;
    }
    state.congestion.queued = Math.round(queued);
    state.congestion.worstQueue = Math.round(worst);
    state.congestion.worstRoad = worstArc >= 0 ? (nav.edgeName(worstArc >> 1) || 'an unnamed road') : null;
    state.congestion.meanDelayPct = delayN ? Math.round(delaySum / delayN) : 0;

    // The jam list: somewhere a player can see a queue and its cause, and it clears on its own.
    const jams = [];
    for (let a = 0; a < A; a++) {
      const ei = a >> 1;
      const density = jamCount[ei] > 0 ? occ[a] / jamCount[ei] : 0;
      if (density < 0.34 && arcDelayPct[a] < 120) continue;
      jams.push({
        road: nav.edgeName(ei) || 'an unnamed road',
        where: nav.nodeRegion(nav.arcTo(a)) || 'the island',
        vehicles: Math.round(occ[a]),
        slowerPct: Math.round(arcDelayPct[a]),
        cause: a === rampArc ? 'the barge ramp gate'
          : (nav.edgeClass(ei) === 'beachlink' || nav.edgeClass(ei) === 'beachaccess') ? 'a soft sand beach entrance'
            : 'more vehicles than the road is taking'
      });
    }
    jams.sort((a, b) => b.vehicles - a.vehicles);
    state.jams = jams.slice(0, 6);
    state.congestion.jams = jams.length;

    const key = jams.length ? jams[0].road + '|' + jams[0].cause : null;
    if (key && !jamOpen.has(key)) {
      jamOpen.set(key, w.clock.tick);
      w.bus.emit('traffic:jam', {
        road: jams[0].road, where: jams[0].where, vehicles: jams[0].vehicles, cause: jams[0].cause,
        text: `${jams[0].vehicles} vehicles banked up on ${jams[0].road} at ${jams[0].where}: ${jams[0].cause}.`
      });
    }
    for (const [k, since] of Array.from(jamOpen)) {
      if (jams.some((j) => j.road + '|' + j.cause === k)) continue;
      jamOpen.delete(k);
      w.bus.emit('traffic:jam-cleared', {
        road: k.split('|')[0], minutes: (w.clock.tick - since) * 10,
        text: `${k.split('|')[0]} is moving again after ${(w.clock.tick - since) * 10} minutes.`
      });
    }
  }

  /* ---------------------------------------------------------------- who is driving

  A vehicle appears when somebody actually goes somewhere. needs.js has already decided that a
  person is driving and where to; schedule.js has already decided who is on shift. This only turns
  those decisions into a thing on the road. */

  function driverSpawns(w, t) {
    if (!R || !R.ready) return;
    const people = R.people;
    const beaches = typeof nav.beaches === 'function' ? nav.beaches() : nav.beaches;
    let started = 0;
    const tick = w.clock.tick;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (p.mode !== 'drive') continue;           // the cheapest possible early out, first
      if (!p.onIsland || p._vehId || p.sleeping) continue;
      if (p._vehTry > tick) continue;             // a trip that could not be routed, not retried every tick
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 160 * 160) continue;               // a short hop is a walk to the car and back
      if (veh.length >= MAX_VEHICLES - 40) break;
      if (started > 60) break;

      const beachTrip = p.actionId === 'beach-driving' || (p.has4WD && p.locationId === 'main-beach');
      let kind = 'car';
      if (beachTrip || (p.has4WD && p.actionId === 'out-in-the-tinny')) kind = 'fourwd';
      else if (p.hasBoat && (p.actionId === 'out-in-the-tinny' || p.locationId === 'amity-boat-ramp')) kind = 'ute-and-boat';
      else if (p.occupationId && /trade|build|construct|maintenance|plumb|electric/i.test(p.occupationId)) kind = 'ute';
      else if (p.has4WD) kind = hash01(p.id, 3) < 0.55 ? 'fourwd' : 'ute';

      // Chancing the tide. A share of drivers set out for the beach inside the last hour of the
      // window, which is exactly how people get caught. MODELLED share, on show in the read model.
      let chancer = false;
      if (beachTrip && beaches) {
        const B = beaches['main-beach'];
        if (B && !B.open) continue;
        if (B && B.minutesToChange != null && B.minutesToChange < 55) {
          if (hash01(p.id, w.clock.dayIndex) > 0.28) continue;
          chancer = true;
          state.beach.chancers++;
        }
      }

      const v = spawn(w, {
        kind,
        fromX: p.x, fromZ: p.z, toX: p.tx, toZ: p.tz, fromNode: -1, toNode: -1,
        personId: p.id,
        driver: p.displayName,
        occupants: 1 + (p.householdSize > 2 && hash01(p.id, 11) < 0.3 ? 1 : 0),
        doing: p.actionLabel || 'on the road',
        chancer,
        trailer: kind === 'ute-and-boat'
      });
      if (v) { started++; v.actionId = p.actionId; } else p._vehTry = tick + 9;
    }
  }

  /* ---------------------------------------------------------------- visiting parties

  visitors.js keeps its own party objects private and publishes only a position component, which
  it steps in a straight line at twelve metres a second: over a ten minute tick that is seven
  kilometres, so a party effectively appears at its destination. The published position is the
  authority and is not argued with. What happens here is that the jump is read as a destination
  and the party is driven there on the actual road, arriving a tick or two later. The sim's
  bookkeeping is unchanged; what a player watches is a car on East Coast Road rather than a
  holiday family teleporting across the island.

  Parties on foot, and the spacing of the people in them, belong to crowd.js. A party claimed here
  is left alone there, which is what `partyClaimed` is for. */

  const partyLag = new Map();     // party id -> {x, z, vehId}

  function visitorSpawns(w) {
    const seen = w.store.all('visitor');
    let started = 0;
    for (const [id, c] of seen) {
      if (!Number.isFinite(c.x) || (c.x === 0 && c.z === 0)) continue;
      let lag = partyLag.get(id);
      if (!lag) { partyLag.set(id, { x: c.x, z: c.z, vehId: null, destX: c.x, destZ: c.z }); continue; }
      if (lag.vehId) {
        if (byId.has(lag.vehId)) {
          // On the road. The published position rides with the car, so the party, the car and the
          // inspector all agree about where this family is.
          const v = byId.get(lag.vehId);
          lag.x = v.x; lag.z = v.z;
          c.x = v.x; c.z = v.z;
          continue;
        }
        // The car has finished. Put the party back on the destination the simulation gave them
        // rather than leaving them standing at the road node the car happened to park on.
        lag.vehId = null;
        c.x = lag.destX; c.z = lag.destZ;
        lag.x = c.x; lag.z = c.z;
        continue;
      }
      const dx = c.x - lag.x, dz = c.z - lag.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 500 * 500) { lag.x = c.x; lag.z = c.z; continue; }
      // A coach load does not fit in a car. School groups on this island arrive by boat and move
      // by bus, so a party bigger than a car holds is left to walk and is never given one.
      if ((c.size || 1) > 8) { lag.x = c.x; lag.z = c.z; continue; }
      if (veh.length >= MAX_VEHICLES - 60 || started > 20) { lag.x = c.x; lag.z = c.z; continue; }
      const arch = c.archetype || '';
      const kind = arch === 'weekend-camper' ? 'fourwd-and-camper'
        : arch === 'tradesperson-from-the-mainland' ? 'ute'
          : arch === 'surfer' ? 'fourwd' : 'car';
      const v = spawn(w, {
        kind,
        fromX: lag.x, fromZ: lag.z, toX: c.x, toZ: c.z, fromNode: -1, toNode: -1,
        partyId: id,
        occupants: c.size || 1,
        label: KINDS[kind].label,
        doing: `${archetypeWord(arch)}, out for the day`,
        trailer: kind === 'fourwd-and-camper'
      });
      if (v) {
        lag.vehId = v.id;
        lag.destX = c.x; lag.destZ = c.z;    // where the simulation says they are going
        c.x = v.x; c.z = v.z;
        started++;
      } else {
        lag.x = c.x; lag.z = c.z;
      }
    }
    // Parties that have left the island.
    if (partyLag.size > seen.size + 200) {
      for (const id of Array.from(partyLag.keys())) if (!seen.has(id)) partyLag.delete(id);
    }
  }

  const archetypeWord = (a) => String(a || 'visitors').replace(/-/g, ' ');

  /** crowd.js asks before it starts walking somebody this system already has in a car. */
  function partyClaimed(id) {
    const lag = partyLag.get(id);
    return !!(lag && lag.vehId && byId.has(lag.vehId));
  }

  /** A driver whose destination changed under them. Re-plan from where the car actually is. */
  function retarget(w) {
    if (!R || !R.ready) return;
    for (const v of veh) {
      if (v.personId == null || v.arrived || v.mode === 'water') continue;
      const p = R.peopleById.get(v.personId);
      if (!p) { v.arrived = true; continue; }
      if (!p.onIsland) { v.arrived = true; v.card.doing = 'left at the terminal'; continue; }
      if (p.mode !== 'drive' && p.mode !== 'commute') {
        // They are not driving any more: the trip is over wherever the car has got to.
        v.arrived = true;
        v.card.doing = 'parked';
        continue;
      }
      if (v.actionId === p.actionId) continue;    // same trip, same destination, nothing to do
      v.actionId = p.actionId;
      nav.nodeXZ(v.destNode, _n0);
      const dx = p.tx - _n0.x, dz = p.tz - _n0.z;
      if (dx * dx + dz * dz < 420 * 420) continue;
      const here = v.ai < v.arcs.length ? nav.arcFrom(v.arcs[v.ai]) : v.destNode;
      const to = nodeNear(p.tx, p.tz, v.mode);
      if (to < 0 || to === here) continue;
      const r = nav.replan(here, to, v.mode, null);
      if (!r || !r.arcs.length) continue;
      if (v.ai < v.arcs.length) occ[v.arcs[v.ai]] = Math.max(0, occ[v.arcs[v.ai]] - 1);
      v.arcs = r.arcs; v.ai = 0; v.along = 0; v.destNode = to;
      v.card.to = nav.nodeLabel(to) || 'the island';
      v.card.doing = p.actionLabel || v.card.doing;
      v.card.route = `${(r.lengthM / 1000).toFixed(1)} km, about ${Math.max(1, Math.round(r.seconds / 60))} minutes`;
      state.routing.replans++;
    }
  }

  /* ---------------------------------------------------------------- the barge pulse

  Fifty two cars come off one boat, through one gate, onto one street. That is the island's
  signature traffic event and it happens ten times a day. */

  const pendingLandings = [];

  const VEHICLE_SERVICE = 'svc-vehicle-ferry';

  world.bus.on('ferry:arrived', (p) => {
    if (!p || p.service !== VEHICLE_SERVICE || p.dir !== 'to-island') return;
    const cars = Math.max(0, Math.round(p.cars || 0));
    if (cars > 0) pendingLandings.push({ cars: Math.min(cars, 52), vessel: p.vessel || 'the barge' });
  });

  world.bus.on('ferry:departed', (p) => {
    if (!p || !state.ready) return;
    const isBarge = p.service === VEHICLE_SERVICE;
    const flyer = p.service === 'svc-stradbroke-flyer';
    const from = isBarge
      ? (p.dir === 'to-island' ? terminals.toondah : terminals.junner)
      : (p.dir === 'to-island' ? terminals.oneMileMainland : (flyer ? terminals.oneMile : terminals.junner));
    const to = isBarge
      ? (p.dir === 'to-island' ? terminals.junner : terminals.toondah)
      : (p.dir === 'to-island' ? (flyer ? terminals.oneMile : terminals.junner) : terminals.oneMileMainland);
    if (!from || !to) return;
    // One boat afloat per service each way is enough: the crossing is 45 minutes and the sailings
    // are an hour apart, so a second hull would be two of the same vessel on the water at once.
    for (const v of veh) {
      if (v.mode === 'water' && v.service === p.service && !v.arrived
        && Math.hypot(v.water.bx - to.x, v.water.bz - to.z) < 1) return;
    }
    spawnVessel(world, {
      kind: isBarge ? 'barge' : 'water-taxi',
      ax: from.x, az: from.z, bx: to.x, bz: to.z,
      minutes: isBarge ? 45 : 25,
      label: p.vessel ? `${p.vessel}` : (isBarge ? 'Vehicle ferry' : 'Passenger ferry'),
      doing: `the ${p.sailing || ''} ${p.dir === 'to-island' ? 'crossing to the island' : 'crossing to Cleveland'}`.trim()
        + `, ${isBarge ? 45 : 25} minutes published`,
      occupants: Math.round(p.people || 0),
      fromName: from.name, toName: to.name, service: p.service
    }, isBarge ? KINDS.barge : KINDS['water-taxi']);
  });

  function releaseLandings(w) {
    if (!pendingLandings.length || anchors.junner < 0) return;
    const job = pendingLandings[0];
    const gate = Math.min(job.cars, 18);
    const dests = [];
    if (anchors.lookout >= 0) dests.push({ node: anchors.lookout, weight: 0.58 });
    if (anchors.amity >= 0) dests.push({ node: anchors.amity, weight: 0.18 });
    if (anchors.dunwich >= 0) dests.push({ node: anchors.dunwich, weight: 0.24 });
    if (!dests.length) { pendingLandings.shift(); return; }
    for (let i = 0; i < gate && job.cars > 0; i++) {
      job.cars--;
      const r = hash01(w.clock.tick, i * 977 + seq);
      let acc = 0, pick = dests[0];
      for (const d of dests) { acc += d.weight; if (r <= acc) { pick = d; break; } }
      spawn(w, {
        kind: hash01(w.clock.tick, i * 31) < 0.34 ? 'fourwd' : 'car',
        fromNode: anchors.junner, toNode: pick.node, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
        occupants: 1 + Math.floor(hash01(w.clock.tick, i * 13) * 3),
        doing: 'just off the barge',
        label: 'Car off the barge'
      });
    }
    if (job.cars <= 0) {
      pendingLandings.shift();
      w.bus.emit('traffic:barge-pulse', {
        vessel: job.vessel,
        text: `A deck of cars is off the ${job.vessel} and heading up East Coast Road.`
      });
    }
  }

  /* ---------------------------------------------------------------- the scheduled services */

  let lastBusMinute = -1;

  function runBuses(w) {
    const minute = w.clock.minuteOfDay;
    const sch = w.read('schedule');
    const running = sch ? sch.busRunning !== false : true;
    let count = 0;
    for (const v of veh) if (v.kind === 'bus') count++;
    state.services.busesRunning = count;

    let next = null;
    for (const r of busRuns) {
      if (r.depMin >= minute && (!next || r.depMin < next.depMin)) next = r;
    }
    state.services.nextBus = next
      ? `${next.label} ${next.dir === 'out' ? 'to Point Lookout' : 'to Dunwich'} at ${hhmm(next.depMin)}`
      : 'no more buses today';

    if (!running) { lastBusMinute = minute; return; }
    for (const r of busRuns) {
      if (r.depMin <= lastBusMinute || r.depMin > minute) continue;
      // Flag A runs are weekend, public holiday and school holiday only, which is published.
      if (r.flag === 'A') {
        const today = sch && sch.day ? sch.day : null;
        const dow = w.clock.dayOfWeek;
        const weekendish = dow === 0 || dow === 6;
        const holidayish = !!(sch && /holiday/i.test(String(sch.term || (w.read('population') || {}).term || '')));
        if (!weekendish && !holidayish && today) continue;
      }
      const bus = spawn(w, {
        kind: 'bus', fromNode: r.from, toNode: r.to, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
        label: `${r.label} bus`,
        doing: `${r.label}, the ${hhmm(r.depMin)} ${r.dir === 'out' ? 'to Point Lookout' : 'to Dunwich'}: ${r.tripMin} minutes published`,
        occupants: 0,
        service: r.route,
        run: r,
        tripMin: r.tripMin
      });
      if (!bus) state.notes.push(`${r.label}: no bus route through the mapped network for the ${hhmm(r.depMin)} departure.`);
    }
    lastBusMinute = minute;
  }

  let binNightWas = false;
  let truckDueDay = -1;

  function runWasteTruck(w) {
    const sch = w.read('schedule');
    if (!sch) return;
    if (sch.binNight && !binNightWas) truckDueDay = w.clock.dayIndex + 1;
    binNightWas = !!sch.binNight;
    const onRun = veh.some((v) => v.kind === 'waste-truck');
    state.services.wasteTruck = onRun ? 'out on the kerbside round'
      : truckDueDay === w.clock.dayIndex ? 'due out this morning' : 'in the yard';
    if (onRun || truckDueDay !== w.clock.dayIndex) return;
    if (w.clock.minuteOfDay < 330 || w.clock.minuteOfDay > 600) return;
    const from = anchors.dunwich >= 0 ? anchors.dunwich : anchors.junner;
    const to = anchors.lookout >= 0 ? anchors.lookout : anchors.amity;
    if (from < 0 || to < 0) return;
    // A collection truck stops at every bin, so it crawls. MODELLED at a quarter of free flow.
    const truck = spawn(w, {
      kind: 'waste-truck', fromNode: from, toNode: to, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
      label: 'Kerbside collection truck',
      doing: 'on the kerbside round, the morning after bin night',
      occupants: 2, paceScale: 0.22
    });
    if (truck) truckDueDay = -1;
  }

  /** Cars circling for a park at Point Lookout, straight out of what tourism.js already measures. */
  function runCircling(w) {
    const tour = w.read('tourism');
    const want = tour && Number.isFinite(tour.circling) ? Math.min(Math.round(tour.circling), 24) : 0;
    let have = 0;
    for (const v of veh) if (v.circling) have++;
    if (want <= have || anchors.lookout < 0) return;
    for (let i = have; i < want; i++) {
      const other = anchors.amity >= 0 && hash01(w.clock.tick, i) < 0.4 ? anchors.amity : anchors.dunwich;
      if (other < 0) break;
      const v = spawn(w, {
        kind: 'car', fromNode: anchors.lookout, toNode: other, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
        label: 'Car', doing: 'circling for a park at Point Lookout', occupants: 2, paceScale: 0.55
      });
      if (!v) break;
      v.circling = true;
    }
  }

  /* ---------------------------------------------------------------- the beach highway

  Main Beach is 35.6 km of gazetted road and on a fine weekend it carries more traffic than most
  of the sealed network. Driving it is what a lot of people come here to do. The number of runs is
  MODELLED, because no count of beach traffic for this island was found in any pack; what is
  published is the route itself, the 60 km/h limit, the 4WD and permit condition, and the tide
  window that shuts it. The point of putting them on the sand is that the window is real: some of
  these vehicles will still be out there when it closes. */

  let beachRunTick = -999;

  function runBeach(w) {
    const beaches = typeof nav.beaches === 'function' ? nav.beaches() : nav.beaches;
    if (!beaches) return;
    const day = w.read('daylight');
    if (day && day.isDay === false) return;
    if (w.clock.tick - beachRunTick < 2) return;
    const weather = w.read('weather') || {};
    const vis = w.read('visitors') || {};
    const dow = w.clock.dayOfWeek;
    const weekend = dow === 0 || dow === 6;
    // More on a fine weekend, more when the island is full, none in heavy rain.
    let want = weekend ? 3 : 1;
    if ((vis.pressure || 0) > 1.2) want += 1;
    if ((weather.rainMmHr || 0) > 2) want = 0;
    if (!want) return;

    for (const id of ['main-beach', 'flinders-beach']) {
      const B = beaches[id];
      if (!B || !B.open || !B.edges || !B.edges.length) continue;
      // Two ends of the beach route, so the run is the length of it rather than a hop.
      const first = B.edges[0], last = B.edges[B.edges.length - 1];
      const a = nav.edge(first), b = nav.edge(last);
      if (!a || !b) continue;
      const already = veh.filter((v) => v.onBeach === id && !v.arrived).length;
      const cap = id === 'main-beach' ? 22 : 10;
      if (already >= cap) continue;
      const n = Math.min(want, cap - already);
      for (let i = 0; i < n; i++) {
        const outbound = hash01(w.clock.tick, i * 17 + 5) < 0.5;
        const from = outbound ? a.from : b.to;
        const to = outbound ? b.to : a.from;
        // Nobody sets out with less than the run in front of them, unless they are chancing it.
        const runMin = ((B.lengthKm * 1000) / (B.speedKmh / 3.6)) / 60;
        let chancer = false;
        if (B.minutesToChange != null && B.minutesToChange < runMin * 1.2) {
          if (hash01(w.clock.tick, i * 91) > 0.3) continue;
          chancer = true;
          state.beach.chancers++;
        }
        const v = spawn(w, {
          kind: hash01(w.clock.tick, i * 7) < 0.28 ? 'fourwd-and-camper' : 'fourwd',
          fromNode: from, toNode: to, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
          label: 'Four wheel drive on the beach',
          doing: chancer
            ? `on ${B.name} with ${B.minutesToChange} minutes of the window left`
            : `driving ${B.name}, ${B.speedKmh} km/h limit`,
          occupants: 2 + Math.floor(hash01(w.clock.tick, i * 3) * 3),
          permit: 'Vehicle Access Permit, 4WD only, issued by Minjerribah Camping',
          chancer,
          trailer: false
        });
        if (!v) break;
      }
      beachRunTick = w.clock.tick;
    }
  }

  /* ---------------------------------------------------------------- the read model */

  function publishCounts(w) {
    let onRoad = 0, onSand = 0, afloat = 0, buses = 0, service = 0;
    const byKind = {};
    for (const v of veh) {
      byKind[v.kind] = (byKind[v.kind] || 0) + 1;
      if (v.mode === 'water') afloat++;
      else if (v.onBeach) { onSand++; onRoad++; } else onRoad++;
      if (v.kind === 'bus') buses++;
      if (v.kind === 'waste-truck' || v.kind === 'ambulance') service++;
    }
    state.counts.onRoad = onRoad;
    state.counts.onSand = onSand;
    state.counts.afloat = afloat;
    state.counts.buses = buses;
    state.counts.service = service;
    state.byKind = byKind;
    state.services.bargeAfloat = afloat;
  }

  /* ---------------------------------------------------------------- frame smoothing

  A tick is ten sim-minutes and at 1x that is half a second of real time, so a vehicle that only
  moved on ticks would jump. This walks the same route between ticks at the same speed the tick
  used. It writes only positions, never simulation state, and it never runs headless. */

  function smooth(w, dt) {
    if (!state.ready || !nav) return;
    const scale = w.clock.paused ? 0 : w.clock.speed.ticksPerSecond * TICK_S;
    if (scale <= 0) return;
    for (let i = 0; i < veh.length; i++) {
      const v = veh[i];
      if (v.arrived) continue;
      if (v.mode === 'water') {
        v.water.t = clamp(v.water.t + (dt * scale) / (v.water.minutes * 60), 0, 1);
        place(v);
        continue;
      }
      if (v.waitTicks > 0 && v.speedMs < 0.2) continue;
      if (!v.arcs || v.ai >= v.arcs.length) continue;
      const len = nav.edgeLength(v.arcs[v.ai] >> 1);
      v.along += v.speedMs * dt * scale;
      while (v.along > len && v.ai < v.arcs.length - 1) {
        v.along -= len;
        v.ai++;
      }
      if (v.along > len) v.along = len;
      place(v);
      if (v.personId != null && R) {
        const p = R.peopleById.get(v.personId);
        if (p) { p.x = v.x; p.z = v.z; }
      }
    }
  }

  /* ---------------------------------------------------------------- the interface

  Non-enumerable, so TWIN.probe() dumps the state of the roads rather than a list of function
  names, and so the inspector's "print every scalar on the record" loop never sees them. */

  const api = {
    partyClaimed,
    byId: (id) => byId.get(id) || null,
    /** Live internals for the render layer: heading, dust, trailer, queueing. Read only. */
    all: () => veh,
    kindSpec: (k) => KINDS[k] || null,
    arcOccupancy: (arc) => (occ && arc >= 0 && arc < A ? occ[arc] : 0)
  };
  for (const k of Object.keys(api)) {
    Object.defineProperty(state, k, { value: api[k], enumerable: false, configurable: true });
  }

  /* ---------------------------------------------------------------- system */

  let lastDay = -1;

  return world.register({
    id: 'traffic',
    phase: 'movement',
    order: 20,

    init(w) {
      build(w);
      // One field, added to everybody at once, so two thousand person objects keep one hidden
      // class. population.js declares its whole shape up front for the same reason.
      if (w.residents && w.residents.ready) {
        for (const p of w.residents.people) { p._vehId = null; p._vehTry = 0; }
      }
    },

    tick(w) {
      if (!state.ready && !build(w)) return;
      R = w.residents || R;
      const t = w.clock.dayIndex * 1440 + w.clock.minuteOfDay;

      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        state.counts.spawnedToday = 0;
        state.counts.arrivedToday = 0;
        state.beach.chancers = 0;
      }

      // 1. Who is setting out.
      releaseLandings(w);
      runBuses(w);
      runWasteTruck(w);
      runCircling(w);
      runBeach(w);
      driverSpawns(w, t);
      visitorSpawns(w);

      // 2. A driver can change their mind halfway up East Coast Road. needs.js picks a new action
      //    and a new place; the car has to hear about it rather than finishing yesterday's trip.
      retarget(w);

      // 3. Everybody moves.
      for (let i = 0; i < veh.length; i++) stepVehicle(w, veh[i], t);

      // 3. The tide, then the queues, then the tidy-up.
      tideWatch(w, t);
      settleCongestion(w);

      for (let i = veh.length - 1; i >= 0; i--) {
        const v = veh[i];
        if (!v.arrived) continue;
        v.linger++;
        if (v.linger === 1) {
          state.counts.arrivedToday++;
          v.card.doing = v.turnedBack ? v.card.doing
            : v.mode === 'water' ? 'alongside' : 'parked at ' + (v.card.to || 'the other end');
          v.card.speedKmh = 0;
        }
        if (v.linger > LINGER_TICKS) despawn(i);
      }

      // People riding in a vehicle stand where the vehicle is, so a click on the car and a click
      // on the driver agree about where they are.
      if (R && R.ready) {
        for (const v of veh) {
          if (v.personId == null) continue;
          const p = R.peopleById.get(v.personId);
          if (p) { p.x = v.x; p.z = v.z; }
        }
      }

      publishCounts(w);
    },

    frame(w, dt) { smooth(w, dt); },

    describe(w) {
      return {
        ready: state.ready,
        vehicles: veh.length,
        onRoad: state.counts.onRoad,
        onSand: state.counts.onSand,
        afloat: state.counts.afloat,
        buses: state.counts.buses,
        spawnedToday: state.counts.spawnedToday,
        queued: state.congestion.queued,
        worstQueue: state.congestion.worstQueue,
        worstRoad: state.congestion.worstRoad,
        jams: state.congestion.jams,
        meanDelayPct: state.congestion.meanDelayPct,
        replans: state.routing.replans,
        noAlternative: state.routing.noAlternative,
        turnedBack: state.routing.turnedBack,
        failed: state.routing.failed,
        beachChancers: state.beach.chancers,
        caught365: state.beach.caught365,
        nextBus: state.services.nextBus
      };
    },

    save() {
      return { seq, caught: state.beach.caught365, truckDueDay, binNightWas };
    },
    load(w, s) {
      if (!s) return;
      seq = s.seq || 0;
      state.beach.caught365 = s.caught || 0;
      truckDueDay = s.truckDueDay ?? -1;
      binNightWas = !!s.binNightWas;
    }
  });
}
