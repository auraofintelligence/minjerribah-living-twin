// Fire on a sand island covered in wallum.
//
// This file owns ignition, spread, suppression, smoke and the consequences. It does not own fuel and
// it does not own what fire does to the vegetation: `src/systems/ecology/vegetation.js` already
// grows the fuel on a 256 m grid, already tracks time since fire, already runs the planned burn
// programme, and already reads a fire system's `scars` and applies them to the plants. So this
// system reads fuel and moisture from there, publishes the scars it makes, and lets vegetation do
// what it was built to do. Nothing about fuel load, seed stores, she-oak crops or the burn programme
// is duplicated here.
//
// WHAT THE ISLAND ACTUALLY DOES, and what this file has to get right:
//
//   * The wallum needs fire and is damaged by too much of it. That argument lives in vegetation.js.
//     What lives here is the argument the island actually has out loud, which is hazard reduction
//     against smoke complaints against habitat: the same burn that takes the fuel off the back of
//     Point Lookout is the burn the township smells for two days and the burn that takes the she-oak
//     cones the glossy black-cockatoos eat.
//   * The 2013 to 2014 fires burnt 16,800 hectares, about seventy per cent of the island's bushland,
//     from a single lightning strike starting 29 December 2013, and residents plus more than nine
//     hundred campers and their vehicles were evacuated. That is the reference event, it is in
//     data/ecology.json proc-fire-regime, and it is what "a bad one here" means.
//   * There is one sealed road between Point Lookout and Dunwich. A fire across East Coast Road
//     does not merely inconvenience Point Lookout; it closes the only way out by land for everybody
//     in it, which on a school holiday is a few thousand people.
//   * Suppression is volunteers. data/businesses.json carries the North Stradbroke Island Rural Fire
//     Brigade with the note that "volunteer availability drops exactly when visitor numbers peak",
//     and that there is also a Queensland Fire Department station at Dunwich. Anything heavier comes
//     from the mainland, and the mainland is across water: data/transport.json's `no-bridge` fact and
//     its `emergency-vehicles-jump-the-queue` fact are both load bearing here, and a barge that is
//     cancelled for weather is a barge that is cancelled for a fire crew too.
//   * Fire in the peat of Eighteen Mile Swamp on a low water table takes the seed bank with it.
//     vegetation.js models that consequence; this system only has to be capable of putting fire there.
//
// CULTURAL HANDLING. data/ecology.json proc-fire-regime carries the rule and it is followed here:
// "Fire practice is Quandamooka knowledge. Model the ecological effect; do not depict, name or
// invent the practice." This file models ignition, spread, area, intensity and suppression, and
// nothing else. It does not name, describe, schedule, attribute or depict anybody's fire practice.
//
// WHAT IS MODELLED RATHER THAN MEASURED. No island fire plan, brigade roster, appliance count,
// ignition rate or suppression productivity is in any pack in this repository. Every one of those
// numbers here is a modelling choice, carries its basis in the read model, and is labelled where a
// player can see it. The spread relation is the standard McArthur form, rate of spread in kilometres
// an hour as 0.0012 times the fire danger index times the fuel load in tonnes a hectare, with the
// usual exponential slope factor. It is a published relation, not a figure for this island.
//
// Determinism: world.rng.stream('fire'). No Math.random, no Date.now.

// ecology-common.js is a helper module, not a system: it exports no register function, holds no
// simulation state and is not in the manifest. Importing it from the environment phase is the same
// thing the seven ecology systems do, and it is what keeps the fire and the fuel on one grid.
import {
  clamp, smoothstep, absDay, bearingDelta,
  ecoGrid, distanceField, roadIndex, levers, humanLoad, metric, place,
  DailyRing, EventLog
} from '../ecology/ecology-common.js';

const YEAR = 365.25;

/* ------------------------------------------------------------------ the townships

Everything that matters about a fire on this island is measured against three villages and one
road. Coordinates come from data/places.json. */

const TOWNSHIPS = [
  { id: 'point-lookout', placeId: 'point-lookout', label: 'Point Lookout', oneRoadOut: true },
  { id: 'amity-point', placeId: 'amity-point', label: 'Amity Point', oneRoadOut: false },
  { id: 'dunwich', placeId: 'dunwich', label: 'Dunwich', oneRoadOut: false }
];

/* Where a fire can start, and what each source is driven by. No island ignition statistics are
   published anywhere this project can reach, so every rate below is a modelling choice fitted so
   that a lightning ignition is a roughly annual event and the island sees a handful of starts a
   year, which is the order of magnitude the 2013 event and the pack's framing imply. */

const CAUSES = [
  {
    id: 'lightning', label: 'Lightning',
    note: 'The 2013 to 2014 fires started from a single lightning strike on 29 December 2013.',
    // Dry lightning: a storm cell with little rain under it. Wet storms put their own fires out.
    rate(w, ctx) {
      if (ctx.synoptic !== 'storm' && ctx.synoptic !== 'trough') return 0;
      const dry = clamp(1 - ctx.rainToday / 6, 0, 1);
      return 0.030 * dry * dry * clamp(ctx.curing, 0.2, 1);
    }
  },
  {
    id: 'campfire', label: 'A campfire',
    note: 'Beach camping and the campgrounds. data/businesses.json records that the beach camping '
      + 'areas are the first thing to close in fire weather.',
    rate(w, ctx) {
      return 0.0016 * ctx.campers * (0.3 + 0.7 * ctx.curing) * (1 - 0.85 * ctx.closedCamping);
    }
  },
  {
    id: 'vehicle', label: 'A vehicle',
    note: 'Exhausts and catalytic converters in long dry grass, and vehicles on the sand tracks.',
    rate(w, ctx) { return 0.00022 * ctx.vehiclesOnBeach * ctx.curing; }
  },
  {
    id: 'powerline', label: 'The power line',
    note: 'Wind on the overhead line. Rare, and it happens on the worst days.',
    rate(w, ctx) { return 0.0016 * clamp((ctx.windKt - 22) / 20, 0, 1) * ctx.curing; }
  },
  {
    id: 'escape', label: 'A planned burn that got away',
    note: 'A burn lit inside its window that found a wind change. The programme itself is run by '
      + 'vegetation.js; this is the tail of it.',
    rate(w, ctx) { return ctx.burnToday ? 0.055 * clamp(ctx.ffdi / 40, 0, 1.4) : 0; }
  },
  {
    id: 'deliberate', label: 'Deliberately lit',
    note: 'It happens here. data/businesses.json cites a report of a Dunwich fire that police '
      + 'believed was deliberately lit.',
    rate(w, ctx) { return 0.0035 * (0.4 + 0.6 * ctx.curing); }
  },
  {
    id: 'unknown', label: 'Cause not determined',
    note: 'Most small fires are never attributed to anything. Saying so is more honest than '
      + 'attributing them.',
    rate(w, ctx) { return 0.0045 * ctx.curing; }
  }
];

/** The four danger ratings the weather system already uses, so the island speaks one language. */
function ratingOf(index) {
  return index < 12 ? 'Moderate' : index < 24 ? 'High' : index < 50 ? 'Extreme' : 'Catastrophic';
}

export function registerFire(world) {
  const rng = world.rng.stream('fire');
  const L = levers(world);

  const state = world.publish('fire', {
    ready: false,
    source: 'data/ecology.json proc-fire-regime; fuel and moisture from the vegetation system; '
      + 'the brigade from data/businesses.json nsi-rural-fire-brigade',
    danger: {
      index: 0, rating: 'Moderate', weatherIndex: 0, curing: 0, fuelNearTownshipTHa: 0,
      basis: '', trend: 0
    },
    ban: { on: false, reason: '' },
    closures: {
      policy: 0, policyLabel: '', tracksClosed: false, beachCampingClosed: false,
      beachDrivingClosed: false, closedSince: null, daysClosedThisYear: 0, note: ''
    },
    active: [],
    scars: [],
    burning: false,
    haBurningNow: 0,
    ignitions365: {}, fires365: 0, haBurnt365: 0, biggestFire365: null,
    lastFire: null,
    smoke: { byTownship: {}, worst: null, peopleExposed: 0, plannedBurnShare: 0, note: '' },
    response: {
      brigade: 'North Stradbroke Island Rural Fire Brigade',
      brigadeSource: 'data/businesses.json nsi-rural-fire-brigade',
      crewsOnIsland: 0, crewsCommitted: 0, crewsBasis: '',
      volunteerAvailability: 1, availabilityNote: '',
      mainlandRequested: false, mainlandEtaHours: null, mainlandBasis: '',
      aircraft: 0, aircraftNote: '',
      holdingCapacityKmPerHour: 0, holdingNote: ''
    },
    road: {
      id: 'road-east-coast-a', name: 'East Coast Road',
      open: true, cutAt: null, cutSince: null,
      peopleBeyond: 0,
      note: 'One sealed road links Point Lookout to Dunwich and the barge. If fire crosses it, '
        + 'the only way out of Point Lookout by land is closed.'
    },
    emergency: { level: 'none', where: null, people: 0, text: '', since: null },
    referenceEvent: null,
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(40);
  const haRing = new DailyRing(365);
  const ignitionRing = {};
  for (const c of CAUSES) ignitionRing[c.id] = new DailyRing(365);

  let g = null;
  let burnt = null;              // Uint8Array over the eco grid: 1 while a live fire holds the cell
  let carries = null;            // Uint8Array: does this cell carry fire at all
  let roadDist = null;           // metres to the nearest road, per cell
  let eastCoastDist = null;      // metres to East Coast Road specifically
  let lastDay = -1;
  let lastHourStep = -1;
  let fires = [];
  let nextFireId = 1;
  let scars = [];
  let closureDays = 0;
  let closedSinceDay = -1;
  let roadCutSinceDay = -1;
  let mainlandEtaTick = -1;
  let mainlandRequested = false;
  let closurePolicy = 0.5;       // 0 close only at Catastrophic, 1 close from High
  const smokeByTownship = {};
  let dangerYesterday = 0;

  world.bus.on('ui:intent', (p) => {
    if (!p) return;
    if (p.kind === 'fire:closure-policy') closurePolicy = clamp(Number(p.level) || 0, 0, 1);
  });

  /* ---------------------------------------------------------------- build */

  function build(w) {
    g = ecoGrid(w);
    if (!g.ready) { notes.push('no island: no fire.'); return false; }

    burnt = new Uint8Array(g.n);
    carries = new Uint8Array(g.n);
    const veg = w.read('vegetation');
    for (let q = 0; q < g.land.length; q++) {
      const k = g.land[q];
      const cover = g.coverOf(k);
      // Which ground carries a fire at all. Taken from the vegetation system's own community
      // classification when it is loaded, so the fire and the plants agree about the island;
      // otherwise from land cover, so the fire still runs while vegetation is being built.
      let ok;
      if (veg && veg.communityAt) {
        const cid = veg.communityAt(g.xOf(k), g.zOf(k));
        ok = cid && cid !== 'mangrove' && cid !== 'littoral' && cid !== 'foredune';
      } else {
        ok = cover === 'heath' || cover === 'forest' || cover === 'swamp' || cover === 'rehab'
          || cover === 'rock' || cover === 'cleared';
      }
      carries[k] = ok ? 1 : 0;
    }

    // Roads as partial breaks. A sealed road is not a fire break, but it is a place a crew can
    // stand, so a fire crosses it less often than it crosses open heath. Built once.
    const ri = roadIndex(w);
    if (ri.ready) {
      const hasRoad = new Uint8Array(g.n);
      const hasEast = new Uint8Array(g.n);
      for (let s = 0; s < ri.segs.length; s++) {
        const sg = ri.segs[s];
        const steps = Math.max(1, Math.ceil(Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) / (g.cell * 0.5)));
        for (let t = 0; t <= steps; t++) {
          const f = t / steps;
          const k = g.at(sg.ax + (sg.bx - sg.ax) * f, sg.az + (sg.bz - sg.az) * f);
          if (sg.sealed) hasRoad[k] = 1;
          if (sg.name === 'East Coast Road') hasEast[k] = 1;
        }
      }
      roadDist = distanceField(g, (k) => hasRoad[k] === 1);
      let anyEast = false;
      for (let k = 0; k < g.n; k++) if (hasEast[k]) { anyEast = true; break; }
      eastCoastDist = anyEast ? distanceField(g, (k) => hasEast[k] === 1) : null;
      if (!anyEast) {
        notes.push('East Coast Road was not found in the published road network, so the one road '
          + 'out of Point Lookout is not modelled as cuttable. Nothing is invented in its place.');
      }
    } else {
      notes.push('no road network published: roads are not modelled as breaks and the road out of '
        + 'Point Lookout cannot be cut.');
    }

    for (const t of TOWNSHIPS) {
      const p = place(w, t.placeId);
      if (p) { t.x = p.x; t.z = p.z; } else {
        notes.push(`${t.label}: not in data/places.json, so smoke over it is not modelled.`);
      }
      smokeByTownship[t.id] = 0;
    }

    const ref = referenceEvent(w);
    state.referenceEvent = ref;
    return true;
  }

  /** The pack's own reference event, carried beside everything this file models. */
  function referenceEvent(w) {
    const eco = w.data && w.data.ecology;
    const proc = eco && Array.isArray(eco.processes)
      ? eco.processes.find((p) => p.id === 'proc-fire-regime') : null;
    const r = proc && proc.reference_event;
    if (!r) return null;
    return {
      name: r.name, start: r.start, duration: r.duration,
      areaBurntHa: r.area_burnt_ha, shareOfBushland: r.share_of_island_bushland,
      cause: r.cause, evacuations: r.evacuations,
      confidence: r.confidence, source: r.source
    };
  }

  /* ---------------------------------------------------------------- the daily context */

  /** Everything the ignition rates and the danger rating read, gathered once a day. */
  function context(w) {
    const wx = w.read('weather');
    const veg = w.read('vegetation');
    const vis = w.read('visitors');
    const h = humanLoad(w);
    const curing = veg && Number.isFinite(veg.curing) ? veg.curing : 0.5;
    const byTown = (vis && vis.byTownship) || {};
    const campers = (byTown['point-lookout'] || 0) * 0.22 + (byTown['amity-point'] || 0) * 0.3
      + (byTown.dunwich || 0) * 0.1;
    const burnToday = !!(veg && veg.burnProgramme && veg.burnProgramme.lastBurn
      && veg.burnProgramme.lastBurn.day === w.clock.formatDate());
    return {
      wx,
      synoptic: wx ? wx.synoptic : 'ridge',
      ffdi: wx ? wx.fireDangerIndex : 8,
      windKt: wx ? wx.windKt : 10,
      windDirDeg: wx ? wx.windDirDeg : 110,
      rainToday: wx ? wx.rainToday : 0,
      rainWeek: wx ? wx.rainWeek : 12,
      humidity: wx ? wx.humidity : 0.65,
      curing,
      fuelNearTown: veg ? veg.fuelNearTownshipTHa : 0,
      campers,
      vehiclesOnBeach: Math.max(0, (byTown['point-lookout'] || 0) * 0.05 + (byTown['amity-point'] || 0) * 0.04),
      closedCamping: state.closures.beachCampingClosed ? 1 : 0,
      burnToday,
      holiday: h.holiday,
      people: h
    };
  }

  /**
   * The island's fire danger, which is not the same number as the weather's.
   *
   * The weather system computes an FFDI from temperature, humidity, wind and a drought factor, and
   * that is the right input. What it cannot know is how much fuel is standing and how cured it is,
   * and a Catastrophic FFDI over green heath is not a Catastrophic day. So the rating published
   * here folds the vegetation system's own curing and its fuel load next to the townships into the
   * weather's index, and says in the read model that it has done so.
   */
  function dangerIndex(ctx) {
    const fuelFactor = clamp(0.55 + ctx.fuelNearTown / 22, 0.55, 1.5);
    const cureFactor = clamp(0.25 + 0.85 * ctx.curing, 0.25, 1.1);
    return clamp(ctx.ffdi * fuelFactor * cureFactor, 0, 140);
  }

  /* ---------------------------------------------------------------- ignition */

  function tryIgnite(w, ctx) {
    if (fires.length >= 4) return;                    // the island cannot fight more than this
    for (const c of CAUSES) {
      let r = 0;
      try { r = c.rate(w, ctx) || 0; } catch (e) { r = 0; }
      if (r <= 0) continue;
      if (rng.float() >= Math.min(0.5, r)) continue;
      const k = pickIgnitionCell(w, ctx, c);
      if (k < 0) continue;
      startFire(w, ctx, c, k);
      ignitionRing[c.id].add(1);
      return;                                          // one start a day is plenty
    }
  }

  /**
   * Where a fire starts. Lightning goes anywhere that carries; everything else starts near where
   * people are, which is why the fires that threaten houses are the ones people light.
   */
  function pickIgnitionCell(w, ctx, cause) {
    const nearPeople = cause.id !== 'lightning';
    let best = -1, bestScore = -1;
    for (let t = 0; t < 40; t++) {
      const k = g.land[(rng.float() * g.land.length) | 0];
      if (!carries[k] || burnt[k]) continue;
      let score = rng.float();
      if (nearPeople) {
        let d = 1e7;
        for (const tw of TOWNSHIPS) {
          if (tw.x == null) continue;
          d = Math.min(d, Math.hypot(g.xOf(k) - tw.x, g.zOf(k) - tw.z));
        }
        if (roadDist) d = Math.min(d, roadDist[k] * 2.5);
        score *= clamp(1.4 - d / 5000, 0.02, 1.4);
      }
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return best;
  }

  function startFire(w, ctx, cause, k) {
    const x = g.xOf(k), z = g.zOf(k);
    const where = w.island ? w.island.regionAt(x, z) : 'Minjerribah';
    const f = {
      id: 'fire-' + (nextFireId++),
      cause: cause.id, causeLabel: cause.label, causeNote: cause.note,
      startedDay: absDay(w.clock), startedISO: w.clock.formatDate(),
      startedTick: w.clock.tick,
      x0: x, z0: z, where,
      cells: [k], front: [k], newSinceScar: [k],
      haBurnt: g.cellHa, contained: 0, status: 'running',
      rosMPerHour: 0, headingDeg: ctx.windDirDeg,
      intensity: 0.6, peakIntensity: 0.6,
      crews: 0, aircraftOn: 0,
      outDay: -1, quietSteps: 0,
      threatenedTownship: null
    };
    burnt[k] = 1;
    fires.push(f);
    state.lastFire = { id: f.id, day: f.startedISO, cause: cause.label, where };
    log.push({ day: f.startedISO, what: `${cause.label.toLowerCase()} started a fire`, where });
    w.bus.emit('fire:ignition', {
      id: f.id, cause: cause.id, causeLabel: cause.label, where, x, z,
      ffdi: +ctx.ffdi.toFixed(0), rating: ratingOf(dangerIndex(ctx))
    });
    w.bus.emit('ecology:alert', {
      id: 'fire-started',
      text: `Fire at ${where}. ${cause.label}. Fire danger is ${ratingOf(dangerIndex(ctx))}.`
    });
  }

  /* ---------------------------------------------------------------- spread */

  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  /**
   * One hour of fire behaviour, for every live fire.
   *
   * Rate of spread comes from the McArthur form used across Australian fire modelling: kilometres
   * an hour equals 0.0012 times the fire danger index times the fuel load in tonnes a hectare. The
   * slope factor is the usual exponential, doubling for roughly every ten degrees upslope. Neither
   * is a figure for this island; both are published relations and are labelled as such.
   *
   * Direction is handled at the cell rather than as an ellipse, because on this island what stops a
   * fire is nearly always what is next to it: the ocean, a lake, the mangrove fringe, the swamp when
   * it is wet, and East Coast Road with a crew standing on it.
   */
  function spread(w, hours) {
    const wx = w.read('weather');
    const veg = w.read('vegetation');
    if (!wx) return;
    const index = state.danger.index;
    const windTo = (wx.windDirDeg + 180) % 360;        // the wind blows from windDirDeg
    const wet = wx.rainMmHr > 1.2;

    for (const f of fires) {
      if (f.status === 'out') continue;

      // Rain over the fire does what no crew can do on a bad day.
      if (wet) {
        f.contained = clamp(f.contained + 0.22 * hours, 0, 1);
      }

      const held = f.contained >= 1;
      if (held) {
        f.status = f.status === 'running' ? 'held' : f.status;
        f.quietSteps += hours;
        if (f.quietSteps > 18) closeFire(w, f);
        continue;
      }

      const before = f.cells.length;
      const next = [];
      const seen = new Set();
      // The whole front is walked, but only the cells that are still on the edge stay on it.
      for (let i = 0; i < f.front.length; i++) {
        const k = f.front[i];
        const kx = k % g.nx, kz = (k / g.nx) | 0;
        let stillEdge = false;
        for (let d = 0; d < DIRS.length; d++) {
          const ii = kx + DIRS[d][0], jj = kz + DIRS[d][1];
          if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
          const nk = jj * g.nx + ii;
          if (burnt[nk]) continue;
          if (!carries[nk]) continue;
          stillEdge = true;
          const x = g.xOf(nk), z = g.zOf(nk);
          const fuel = veg && veg.fuelAt ? veg.fuelAt(x, z) : 9;
          if (fuel < 1.5) continue;                     // nothing to carry it
          const moist = veg && veg.moistureAt ? veg.moistureAt(x, z) : 0.5;

          // Head, flank and back. A backing fire runs at roughly a tenth of the head.
          const bearing = (Math.atan2(DIRS[d][0], DIRS[d][1]) * 180) / Math.PI;
          const align = Math.cos((bearingDelta(bearing, windTo) * Math.PI) / 180);
          const dirFactor = 0.10 + 0.90 * Math.pow(clamp((align + 1) / 2, 0, 1), 2.2);

          // Slope. Fire runs uphill. On this island the high dunes behind Point Lookout are the
          // only ground where that matters, and it matters there a great deal.
          const rise = g.height[nk] - g.height[k];
          const slopeDeg = (Math.atan2(rise, g.cell) * 180) / Math.PI;
          const slopeF = Math.exp(0.069 * clamp(slopeDeg, -12, 20));

          const rosKmH = 0.0012 * index * clamp(fuel, 0, 32);
          const rosM = rosKmH * 1000 * dirFactor * slopeF * (1 - 0.80 * moist) * hours;
          let p = clamp(rosM / g.cell, 0, 1);
          // A sealed road is somewhere to stand, not a fire break. Embers cross it.
          if (roadDist && roadDist[nk] < g.cell) p *= 0.35;
          p *= (1 - 0.85 * f.contained);
          if (p <= 0 || rng.float() >= p) continue;

          burnt[nk] = 1;
          f.cells.push(nk);
          f.newSinceScar.push(nk);
          if (!seen.has(nk)) { seen.add(nk); next.push(nk); }
        }
        if (stillEdge && !seen.has(k)) { seen.add(k); next.push(k); }
      }
      f.front = next;
      f.haBurnt = f.cells.length * g.cellHa;
      f.rosMPerHour = Math.round(0.0012 * index * 14 * 1000);
      f.headingDeg = Math.round(windTo);
      f.intensity = clamp(0.25 + index / 70, 0.2, 1.2);
      if (f.intensity > f.peakIntensity) f.peakIntensity = f.intensity;
      haRing.add((f.cells.length - before) * g.cellHa);

      // A fire that has stopped growing and has nowhere to go has gone out on its own.
      if (f.cells.length === before) {
        f.quietSteps += hours;
        if (f.quietSteps > 10) { f.contained = 1; f.status = 'held'; }
      } else {
        f.quietSteps = 0;
      }
      if (!f.front.length) { f.contained = 1; f.status = 'held'; }
    }
  }

  /* ---------------------------------------------------------------- suppression */

  /**
   * Who is available to fight it, and what that buys.
   *
   * The brigade is volunteers, and data/businesses.json says plainly that volunteer availability
   * drops exactly when visitor numbers peak. So the worst days for ignition are also the days with
   * the fewest people to send, which is the coupling that makes a holiday weekend fire different
   * from the same fire in June. No roster, appliance count or crew productivity is published
   * anywhere this project can reach; the figures below are modelling choices and say so.
   */
  function suppression(w, ctx, hours) {
    const R = state.response;
    const daylight = w.read('daylight');
    const isDay = daylight ? !!daylight.isDay : true;
    const funding = L.level('ranger-program-funding');
    const readiness = L.level('storm-tide-readiness');   // the island's emergency readiness lever

    // Volunteers. Twenty-eight on the books is a modelling choice; the shape of the curve is not.
    const onBooks = 28;
    const holidayDrain = ctx.holiday ? 0.62 : 1;
    const nightDrain = isDay ? 1 : 0.7;
    const availability = clamp(holidayDrain * nightDrain * (0.8 + 0.2 * readiness), 0.2, 1);
    const crews = Math.max(1, Math.round((onBooks * availability) / 5));   // five to a crew
    R.crewsOnIsland = crews;
    R.volunteerAvailability = +availability.toFixed(2);
    R.availabilityNote = ctx.holiday
      ? 'School holidays or a weekend. Volunteer availability drops exactly when visitor numbers peak.'
      : 'Ordinary week. The brigade is at its usual strength.';
    R.crewsBasis = 'Modelled: 28 volunteers on the books, five to a crew, availability moved by the '
      + 'calendar and by the hour. No roster or appliance count is published in any pack here.';

    const live = fires.filter((f) => f.status === 'running' || f.status === 'held');
    if (!live.length) {
      R.crewsCommitted = 0;
      R.mainlandRequested = false; R.mainlandEtaHours = null;
      mainlandRequested = false; mainlandEtaTick = -1;
      R.aircraft = 0;
      R.holdingCapacityKmPerHour = 0;
      R.holdingNote = 'Nothing burning.';
      return;
    }

    // Mainland reinforcement. It comes across the water, and the water is the point: the vehicle
    // barge is the only way heavy plant gets here, emergency vehicles displace booked cars, and a
    // crossing cancelled for wind is cancelled for a fire crew too.
    const totalHa = live.reduce((s, f) => s + f.haBurnt, 0);
    const threatened = live.some((f) => f.threatenedTownship);
    if (!mainlandRequested && (totalHa > 120 || threatened || state.danger.index > 45)) {
      mainlandRequested = true;
      const wx = ctx.wx;
      const crossing = wx ? wx.crossingCondition : 'good';
      const delayH = crossing === 'cancelled' ? 14 : crossing === 'rough' ? 6 : 3.5;
      mainlandEtaTick = w.clock.tick + Math.round(delayH * 6);
      R.mainlandBasis = crossing === 'cancelled'
        ? 'The crossing is cancelled. Nothing heavy comes over until it reopens, and the day the '
          + 'wind is bad enough to stop the barge is the day the fire runs.'
        : `Requested from the mainland. Emergency vehicles displace booked cars on the barge, so the `
          + `wait is the next sailing rather than the queue: about ${delayH} hours.`;
      log.push({ day: w.clock.formatDate(), what: 'mainland crews requested', where: live[0].where });
      w.bus.emit('fire:mainland-requested', { etaHours: delayH, crossing });
    }
    const arrived = mainlandRequested && mainlandEtaTick >= 0 && w.clock.tick >= mainlandEtaTick;
    R.mainlandRequested = mainlandRequested;
    R.mainlandEtaHours = mainlandRequested && !arrived
      ? +Math.max(0, (mainlandEtaTick - w.clock.tick) / 6).toFixed(1) : (arrived ? 0 : null);

    // Aircraft. Daylight only, and not in a strong wind. From the mainland, so they are not here
    // at first light of the first day.
    const canFly = isDay && ctx.windKt < 32 && mainlandRequested && arrived;
    R.aircraft = canFly ? 2 : 0;
    R.aircraftNote = !mainlandRequested ? 'Not requested.'
      : !arrived ? 'On the way.'
        : !isDay ? 'Aircraft do not fly on this at night.'
          : ctx.windKt >= 32 ? 'Too much wind for aircraft.'
            : 'Two aircraft working, from the mainland.';

    const mainlandCrews = arrived ? 6 : 0;
    const totalCrews = crews + mainlandCrews + Math.round(funding * 2);
    R.crewsCommitted = totalCrews;

    // What a crew can actually hold. This is the number that decides everything, and it collapses
    // as the fire danger rises: above about fifty on the index a fire is not held by people, it is
    // held by a wind change or by rain. Modelled, and the collapse is the point.
    const perCrewKmH = 0.55 * clamp(1 - Math.pow(clamp(state.danger.index / 55, 0, 1.4), 2), 0.02, 1);
    const airKmH = R.aircraft * 0.45 * clamp(1 - state.danger.index / 90, 0.05, 1);
    const holdKmH = totalCrews * perCrewKmH + airKmH;
    R.holdingCapacityKmPerHour = +holdKmH.toFixed(2);
    R.holdingNote = state.danger.index > 55
      ? 'Above about fifty on the index a fire is not held by people. It is held by a wind change '
        + 'or by rain, and everything a crew does is protecting houses while it waits for one.'
      : 'Crews are holding line. What they can hold falls away as the index rises.';

    // Share it out. The fire nearest a township gets the crews, which is what actually happens and
    // is also why the fire in the middle of the island keeps running.
    live.sort((a, b) => (b.threatenedTownship ? 1 : 0) - (a.threatenedTownship ? 1 : 0)
      || b.haBurnt - a.haBurnt);
    let left = holdKmH;
    for (const f of live) {
      const perimeterKm = Math.max(0.4, Math.sqrt(f.haBurnt * 10000 / Math.PI) * 2 * Math.PI / 1000);
      const take = Math.min(left, perimeterKm * 0.8);
      left -= take;
      f.crews = +(take / Math.max(0.01, perCrewKmH)).toFixed(1);
      f.aircraftOn = f === live[0] ? R.aircraft : 0;
      const gain = (take / perimeterKm) * 0.16 * hours;
      f.contained = clamp(f.contained + gain, 0, 1);
      if (f.contained >= 1 && f.status === 'running') {
        f.status = 'held';
        log.push({ day: w.clock.formatDate(), what: `fire held at ${Math.round(f.haBurnt)} ha`, where: f.where });
        w.bus.emit('fire:contained', {
          id: f.id, where: f.where, ha: Math.round(f.haBurnt),
          days: absDay(w.clock) - f.startedDay
        });
      }
    }
  }

  function closeFire(w, f) {
    f.status = 'out';
    f.outDay = absDay(w.clock);
    log.push({ day: w.clock.formatDate(), what: `fire out, ${Math.round(f.haBurnt)} ha burnt`, where: f.where });
    w.bus.emit('fire:out', { id: f.id, where: f.where, ha: Math.round(f.haBurnt) });
    // The cells go back to being burnable ground. What happened to the plants in them is the
    // vegetation system's business and it already has the scar.
    for (let i = 0; i < f.cells.length; i++) burnt[f.cells[i]] = 0;
  }

  /* ---------------------------------------------------------------- scars, for vegetation.js

  vegetation.js reads `fire.scars` and applies each one it has not seen to its own fuel, seed store,
  she-oak crop, food trees, hollows and peat, and emits `ecology:burn` when it does. So a scar is
  published once per fire per day, covering the ground that fire took today, as an equal-area circle
  at the centroid of the new ground. Publishing one growing circle instead would burn the middle of
  every fire over and over. */

  function shedScars(w) {
    for (const f of fires) {
      if (!f.newSinceScar.length) continue;
      let sx = 0, sz = 0;
      for (let i = 0; i < f.newSinceScar.length; i++) {
        sx += g.xOf(f.newSinceScar[i]); sz += g.zOf(f.newSinceScar[i]);
      }
      const n = f.newSinceScar.length;
      const ha = n * g.cellHa;
      scars.push({
        id: `${f.id}-d${absDay(w.clock)}`,
        x: Math.round(sx / n), z: Math.round(sz / n),
        radiusM: Math.round(Math.sqrt((ha * 10000) / Math.PI)),
        intensity: +f.intensity.toFixed(2),
        haBurnt: Math.round(ha),
        ageDays: 0,
        cause: f.cause,
        fireId: f.id
      });
      f.newSinceScar.length = 0;
    }
    if (scars.length > 60) scars = scars.slice(-60);
    state.scars = scars;
  }

  /* ---------------------------------------------------------------- smoke */

  /**
   * Smoke over the townships.
   *
   * This is the half of the fire argument nobody puts in a simulation, and on this island it is the
   * half people actually turn up to meetings about. A plume is treated as a widening wedge downwind:
   * a township square in it gets everything, a township off to the side gets the edge of it, and a
   * township upwind gets nothing no matter how big the fire is. Planned burn smoke is folded in from
   * the vegetation system rather than recomputed, so the number a player reads is all the smoke over
   * that village and not this system's share of it.
   */
  function stepSmoke(w, ctx, hours) {
    const veg = w.read('vegetation');
    const windTo = (ctx.windDirDeg + 180) % 360;
    const decay = clamp(1 - (0.05 + ctx.windKt * 0.010) * hours, 0.5, 0.995);

    for (const t of TOWNSHIPS) {
      let add = 0;
      if (t.x != null) {
        for (const f of fires) {
          if (f.status === 'out') continue;
          // Where the smoke is coming from, and how much of it there is.
          let cx = 0, cz = 0;
          const n = Math.min(f.cells.length, 64);
          const stride = Math.max(1, Math.floor(f.cells.length / n));
          let c = 0;
          for (let i = 0; i < f.cells.length; i += stride) { cx += g.xOf(f.cells[i]); cz += g.zOf(f.cells[i]); c++; }
          if (!c) continue;
          cx /= c; cz /= c;
          const dx = t.x - cx, dz = t.z - cz;
          const dist = Math.hypot(dx, dz);
          if (dist < 1) continue;
          const bearing = (Math.atan2(dx, dz) * 180) / Math.PI;
          const off = Math.abs(bearingDelta(bearing, windTo));
          if (off > 70) continue;                              // upwind or across: nothing arrives
          const inPlume = Math.cos((off * Math.PI) / 180);
          const strength = clamp(f.haBurnt / 400, 0.05, 2.2) * f.intensity;
          add += strength * inPlume * inPlume * clamp(1 - dist / 12000, 0, 1) * hours * 0.14;
        }
      }
      smokeByTownship[t.id] = clamp(smokeByTownship[t.id] * decay + add, 0, 1);
    }

    // The planned burn programme's own smoke, from the system that runs it.
    const planned = veg && Number.isFinite(veg.smokeOverTownship) ? veg.smokeOverTownship : 0;
    const out = {};
    let worst = null, worstV = 0;
    let exposed = 0;
    const pop = w.read('population');
    const vis = w.read('visitors');
    for (const t of TOWNSHIPS) {
      const v = clamp(smokeByTownship[t.id] + planned * 0.75, 0, 1);
      out[t.id] = +v.toFixed(3);
      if (v > worstV) { worstV = v; worst = t.label; }
      if (v > 0.2) {
        const res = pop && pop.byTownship && pop.byTownship[t.id] ? pop.byTownship[t.id].residents : 0;
        const visi = vis && vis.byTownship ? (vis.byTownship[t.id] || 0) : 0;
        exposed += res + visi;
      }
    }
    state.smoke = {
      byTownship: out,
      worst: worstV > 0.05 ? { township: worst, level: +worstV.toFixed(2) } : null,
      peopleExposed: Math.round(exposed),
      plannedBurnShare: +planned.toFixed(3),
      note: 'Everybody on this island lives in one of three villages, so where the wind is from '
        + 'decides who wears the smoke. Planned burn smoke is included, from the vegetation system '
        + 'that runs the programme.'
    };
  }

  /* ---------------------------------------------------------------- closures and the road */

  /**
   * The closure policy, which is itself the thing under test.
   *
   * Closing tracks, beach camping and beach driving on a bad day is cheap, unpopular and effective,
   * and where the trigger sits is a real argument. The dial runs from closing only on a
   * Catastrophic day to closing from High, and the read model publishes how many days a year it
   * cost so the argument can be had with a number in it.
   */
  function stepClosures(w, ctx) {
    const idx = state.danger.index;
    const trigger = 62 - 40 * closurePolicy;             // 62 at the loose end, 22 at the tight end
    const shouldClose = idx >= trigger || fires.some((f) => f.status !== 'out' && f.haBurnt > 60);
    const wasClosed = state.closures.tracksClosed;
    if (shouldClose && !wasClosed) {
      closedSinceDay = absDay(w.clock);
      log.push({ day: w.clock.formatDate(), what: 'tracks and beach camping closed', where: 'Minjerribah' });
      w.bus.emit('fire:closure', { closed: true, rating: state.danger.rating, index: Math.round(idx) });
      w.bus.emit('ecology:alert', {
        id: 'fire-closure',
        text: `Fire danger is ${state.danger.rating}. The walking tracks and the beach camping areas `
          + 'are closed. Beach camping is the first thing to close in fire weather here.'
      });
    }
    if (!shouldClose && wasClosed) {
      w.bus.emit('fire:closure', { closed: false, rating: state.danger.rating });
      closedSinceDay = -1;
    }
    if (shouldClose) closureDays++;
    state.closures = {
      policy: +closurePolicy.toFixed(2),
      policyLabel: closurePolicy > 0.75 ? 'Close from High'
        : closurePolicy > 0.45 ? 'Close from Extreme' : 'Close only on Catastrophic',
      triggerIndex: Math.round(trigger),
      tracksClosed: shouldClose,
      beachCampingClosed: shouldClose,
      beachDrivingClosed: shouldClose && idx >= trigger + 12,
      closedSince: closedSinceDay >= 0 ? closedSinceDay : null,
      daysClosedThisYear: closureDays,
      note: 'Where the trigger sits is a policy, not a fact, and this dial is what a scenario moves. '
        + 'Closing early costs visitor days and campground revenue; closing late costs the thing '
        + 'nobody wants to be the one who did not close for.'
    };
  }

  /**
   * Point Lookout, and the one road out.
   *
   * A fire across East Coast Road between Point Lookout and the barge does not slow anybody down.
   * It closes the only way out by land for every resident and every visitor in the village, and in
   * 2013 that meant residents plus more than nine hundred campers and their vehicles moving at once.
   */
  function stepRoad(w) {
    const pop = w.read('population');
    const vis = w.read('visitors');
    const beyond = ((pop && pop.byTownship && pop.byTownship['point-lookout']
      && pop.byTownship['point-lookout'].residents) || 0)
      + ((vis && vis.byTownship && vis.byTownship['point-lookout']) || 0);
    state.road.peopleBeyond = Math.round(beyond);

    if (!eastCoastDist) { state.road.open = true; return; }
    let cut = false, cutAt = null;
    for (const f of fires) {
      if (f.status === 'out') continue;
      for (let i = 0; i < f.cells.length; i++) {
        const k = f.cells[i];
        if (eastCoastDist[k] < 260) {
          cut = true;
          cutAt = w.island ? w.island.regionAt(g.xOf(k), g.zOf(k)) : 'East Coast Road';
          break;
        }
      }
      if (cut) { f.threatenedTownship = f.threatenedTownship || 'point-lookout'; break; }
    }
    const wasOpen = state.road.open;
    state.road.open = !cut;
    state.road.cutAt = cut ? cutAt : null;
    if (cut && wasOpen) {
      roadCutSinceDay = absDay(w.clock);
      state.road.cutSince = w.clock.formatDate();
      log.push({ day: w.clock.formatDate(), what: 'East Coast Road cut by fire', where: cutAt });
      w.bus.emit('fire:road-cut', { road: 'East Coast Road', where: cutAt, peopleBeyond: Math.round(beyond) });
      w.bus.emit('ecology:alert', {
        id: 'road-cut-by-fire',
        text: `Fire is across East Coast Road at ${cutAt}. There is one road out of Point Lookout and `
          + `it is closed, with about ${Math.round(beyond)} people beyond it.`
      });
    }
    if (!cut && !wasOpen) {
      state.road.cutSince = null;
      roadCutSinceDay = -1;
      log.push({ day: w.clock.formatDate(), what: 'East Coast Road reopened' });
    }
  }

  /** How close a fire is to a village, and what that means for the people in it. */
  function stepEmergency(w) {
    let worst = null, worstD = 1e9;
    for (const f of fires) {
      if (f.status === 'out') continue;
      for (const t of TOWNSHIPS) {
        if (t.x == null) continue;
        for (let i = 0; i < f.cells.length; i += 3) {
          const d = Math.hypot(g.xOf(f.cells[i]) - t.x, g.zOf(f.cells[i]) - t.z);
          if (d < worstD) { worstD = d; worst = { fire: f, town: t }; }
        }
      }
    }
    const prev = state.emergency.level;
    if (!worst || worstD > 4000) {
      state.emergency = { level: 'none', where: null, people: 0, text: '', since: null };
    } else {
      const pop = w.read('population');
      const vis = w.read('visitors');
      const t = worst.town;
      const people = Math.round(((pop && pop.byTownship && pop.byTownship[t.id]
        && pop.byTownship[t.id].residents) || 0)
        + ((vis && vis.byTownship && vis.byTownship[t.id]) || 0));
      worst.fire.threatenedTownship = t.id;
      const level = worstD < 1200 ? 'evacuate' : worstD < 2500 ? 'leave-now' : 'watch';
      state.emergency = {
        level,
        where: t.label,
        distanceM: Math.round(worstD),
        people,
        since: state.emergency.since || w.clock.formatDate(),
        text: level === 'evacuate'
          ? `Fire is ${Math.round(worstD)} m from ${t.label}. About ${people} people are in it`
            + (t.oneRoadOut && !state.road.open ? ' and the road out is cut.' : '.')
          : level === 'leave-now'
            ? `Fire ${(worstD / 1000).toFixed(1)} km from ${t.label}. Anybody leaving should leave now.`
            : `Fire ${(worstD / 1000).toFixed(1)} km from ${t.label}. Watch and act.`
      };
      if (level !== prev && (level === 'evacuate' || level === 'leave-now')) {
        w.bus.emit('fire:emergency', { level, township: t.id, where: t.label, people, distanceM: Math.round(worstD) });
        w.bus.emit('ecology:alert', { id: 'fire-emergency', text: state.emergency.text });
      }
    }
  }

  /* ---------------------------------------------------------------- publish */

  function publish(w, ctx) {
    state.active = fires.filter((f) => f.status !== 'out').map((f) => ({
      id: f.id, cause: f.cause, causeLabel: f.causeLabel,
      where: f.where, x: Math.round(f.x0), z: Math.round(f.z0),
      started: f.startedISO, daysBurning: absDay(w.clock) - f.startedDay,
      haBurnt: Math.round(f.haBurnt),
      perimeterKm: +(Math.sqrt(f.haBurnt * 10000 / Math.PI) * 2 * Math.PI / 1000).toFixed(2),
      contained: +f.contained.toFixed(2),
      status: f.status,
      rosMPerHour: Math.round(f.rosMPerHour),
      headingDeg: f.headingDeg,
      intensity: +f.intensity.toFixed(2),
      crews: f.crews, aircraft: f.aircraftOn,
      threatens: f.threatenedTownship
    }));
    state.burning = state.active.length > 0;
    state.haBurningNow = Math.round(state.active.reduce((s, f) => s + f.haBurnt, 0));

    const ign = {};
    let total = 0;
    for (const c of CAUSES) {
      const v = Math.round(ignitionRing[c.id].total);
      ign[c.id] = { label: c.label, count: v, note: c.note };
      total += v;
    }
    state.ignitions365 = ign;
    state.fires365 = total;
    state.haBurnt365 = Math.round(haRing.total);
    state.events = log.recent(8);
    state.levers = L.snapshot(['planned-burn-extent', 'burn-notification-and-timing',
      'ranger-program-funding', 'storm-tide-readiness', 'beach-camping-permit-numbers',
      'campground-site-cap']);
    state.civicMetrics = {
      // Higher is worse for both of these, which is how data/civic.json defines them.
      smoke_exposure: metric(state.smoke.worst ? state.smoke.worst.level : 0),
      emergency_readiness: metric(clamp(
        0.25 + 0.35 * state.response.volunteerAvailability
        + 0.2 * L.level('storm-tide-readiness') + 0.2 * (state.closures.tracksClosed ? 1 : 0)
        - (state.road.open ? 0 : 0.3), 0, 1))
    };
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'fire',
    phase: 'environment',
    order: 40,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      const ctx = context(w);
      const idx = dangerIndex(ctx);
      state.danger = {
        index: +idx.toFixed(1), rating: ratingOf(idx),
        weatherIndex: +ctx.ffdi.toFixed(1), curing: +ctx.curing.toFixed(2),
        fuelNearTownshipTHa: +ctx.fuelNearTown.toFixed(1), trend: 0,
        basis: 'The weather system\'s fire danger index, scaled by how much fuel is standing near '
          + 'the townships and how cured it is. A Catastrophic index over green heath is not a '
          + 'Catastrophic day.'
      };
      suppression(w, ctx, 0);
      stepClosures(w, ctx);
      stepSmoke(w, ctx, 0);
      stepRoad(w);
      publish(w, ctx);
      lastDay = absDay(w.clock);
      lastHourStep = w.clock.tick;
      notes.push('Ignition rates, crew numbers, appliance counts and suppression productivity are '
        + 'all modelling choices. No island fire plan, brigade roster or ignition statistic is in '
        + 'any pack in this repository.');
      notes.push('Rate of spread uses the McArthur form: kilometres an hour equals 0.0012 times the '
        + 'fire danger index times the fuel load in tonnes a hectare, with the usual exponential '
        + 'slope factor. It is a published relation, not a figure for this island.');
      notes.push('Fuel, moisture and what fire does to the plants all belong to the vegetation '
        + 'system. This system reads them and publishes scars back; it does not keep its own copy.');
      if (state.referenceEvent) {
        notes.push(`Reference event: ${state.referenceEvent.name}, ${state.referenceEvent.areaBurntHa} ha `
          + `from ${state.referenceEvent.cause}, ${state.referenceEvent.duration}.`);
      }
      w.bus.emit('fire:ready', { carries: carries.reduce((s, v) => s + v, 0) });
    },

    tick(w) {
      if (!state.ready) return;
      const tick = w.clock.tick;
      const day = absDay(w.clock);

      // Fire behaviour runs on the hour, not on the tick, and only while something is burning.
      // A fire that is out costs this system nothing at all, which is why it can afford to be
      // this detailed on the six days a year that matter.
      const live = fires.some((f) => f.status !== 'out');
      if (live && tick - lastHourStep >= 6) {
        const hours = (tick - lastHourStep) / 6;
        lastHourStep = tick;
        const ctx = context(w);
        spread(w, hours);
        suppression(w, ctx, hours);
        stepSmoke(w, ctx, hours);
        stepRoad(w);
        stepEmergency(w);
        publish(w, ctx);
      } else if (!live) {
        lastHourStep = tick;
      }

      if (day === lastDay) return;

      // --- once a sim-day from here down
      lastDay = day;
      haRing.roll();
      for (const c of CAUSES) ignitionRing[c.id].roll();

      const ctx = context(w);
      const idx = dangerIndex(ctx);
      state.danger = {
        index: +idx.toFixed(1),
        rating: ratingOf(idx),
        weatherIndex: +ctx.ffdi.toFixed(1),
        curing: +ctx.curing.toFixed(2),
        fuelNearTownshipTHa: +ctx.fuelNearTown.toFixed(1),
        trend: +(idx - dangerYesterday).toFixed(1),
        basis: state.danger.basis
      };
      dangerYesterday = idx;
      state.ban = {
        on: idx >= 50,
        reason: idx >= 50 ? 'Fire danger is Catastrophic. No fire may be lit in the open.'
          : idx >= 24 ? 'Fire danger is Extreme. Permits are refused.' : ''
      };

      tryIgnite(w, ctx);
      shedScars(w);
      for (const s of scars) s.ageDays++;
      // A fire that has been out for a fortnight stops being news.
      fires = fires.filter((f) => f.status !== 'out' || day - f.outDay < 14);
      stepClosures(w, ctx);
      stepEmergency(w);
      publish(w, ctx);

      // The biggest fire of the year, kept so a player can look back at it.
      for (const f of fires) {
        if (!state.biggestFire365 || f.haBurnt > state.biggestFire365.haBurnt) {
          state.biggestFire365 = {
            id: f.id, where: f.where, cause: f.causeLabel,
            haBurnt: Math.round(f.haBurnt), started: f.startedISO,
            shareOfBushland: null
          };
          const veg = w.read('vegetation');
          if (veg && veg.bushlandHa) {
            state.biggestFire365.shareOfBushland = +(f.haBurnt / veg.bushlandHa).toFixed(3);
          }
        }
      }
    },

    describe(w) {
      return {
        danger: state.danger.index,
        rating: state.danger.rating,
        weatherFfdi: state.danger.weatherIndex,
        curing: state.danger.curing,
        active: state.active.length,
        haNow: state.haBurningNow,
        fires365: state.fires365,
        ha365: state.haBurnt365,
        contained: state.active.length ? +(state.active.reduce((s, f) => s + f.contained, 0) / state.active.length).toFixed(2) : 1,
        crews: state.response.crewsCommitted,
        availability: state.response.volunteerAvailability,
        holdKmH: state.response.holdingCapacityKmPerHour,
        smokeWorst: state.smoke.worst ? state.smoke.worst.level : 0,
        smokePeople: state.smoke.peopleExposed,
        roadOpen: state.road.open,
        emergency: state.emergency.level,
        closed: state.closures.tracksClosed,
        closedDays: state.closures.daysClosedThisYear,
        scars: scars.length
      };
    },

    save(w) {
      return {
        fires: fires.map((f) => ({
          id: f.id, cause: f.cause, causeLabel: f.causeLabel, causeNote: f.causeNote,
          startedDay: f.startedDay, startedISO: f.startedISO, startedTick: f.startedTick,
          x0: f.x0, z0: f.z0, where: f.where,
          cells: Array.from(f.cells), front: Array.from(f.front),
          newSinceScar: Array.from(f.newSinceScar),
          haBurnt: f.haBurnt, contained: f.contained, status: f.status,
          rosMPerHour: f.rosMPerHour, headingDeg: f.headingDeg,
          intensity: f.intensity, peakIntensity: f.peakIntensity,
          crews: f.crews, aircraftOn: f.aircraftOn, outDay: f.outDay,
          quietSteps: f.quietSteps, threatenedTownship: f.threatenedTownship
        })),
        nextFireId, scars: scars.slice(), closureDays, closedSinceDay, roadCutSinceDay,
        mainlandEtaTick, mainlandRequested, closurePolicy, dangerYesterday,
        smoke: { ...smokeByTownship },
        ha: haRing.save(),
        ign: Object.fromEntries(CAUSES.map((c) => [c.id, ignitionRing[c.id].save()])),
        log: log.save()
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      burnt.fill(0);
      fires = (s.fires || []).map((f) => ({ ...f, cells: f.cells.slice(), front: f.front.slice(), newSinceScar: (f.newSinceScar || []).slice() }));
      for (const f of fires) {
        if (f.status === 'out') continue;
        for (let i = 0; i < f.cells.length; i++) burnt[f.cells[i]] = 1;
      }
      nextFireId = s.nextFireId || 1;
      scars = (s.scars || []).slice();
      state.scars = scars;
      closureDays = s.closureDays || 0;
      closedSinceDay = s.closedSinceDay ?? -1;
      roadCutSinceDay = s.roadCutSinceDay ?? -1;
      mainlandEtaTick = s.mainlandEtaTick ?? -1;
      mainlandRequested = !!s.mainlandRequested;
      closurePolicy = s.closurePolicy ?? 0.5;
      dangerYesterday = s.dangerYesterday || 0;
      Object.assign(smokeByTownship, s.smoke || {});
      haRing.load(s.ha);
      for (const c of CAUSES) ignitionRing[c.id].load((s.ign || {})[c.id]);
      log.load(s.log);
      const ctx = context(w);
      publish(w, ctx);
    }
  });
}
