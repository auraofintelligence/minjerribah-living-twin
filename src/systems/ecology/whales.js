// Humpback whales. The biggest wildlife event on this island, and the one you can stand on a
// headland and watch for free.
//
// Deep water sits unusually close to the Point Lookout headland, which is why the whole migration
// can be watched from land here and why the North Gorge walk is what it is. Northbound roughly
// June to August, peaking about July. Southbound roughly September to November, peaking about
// October, and that is the leg that brings cows with calves close inshore. The east Australian
// population is somewhere between 40,000 and 50,000 animals and has been growing at about 10 to
// 11 per cent a year for a decade. It came off the threatened list in 2022 and is still protected
// as a listed migratory species and as a cetacean under the EPBC Act.
//
// This file models individual pods on two corridors, and the corridors are taken off the island's
// own heightfield rather than drawn: for any latitude it asks where the east coast actually is and
// puts the whales offshore of that. The southbound corridor runs closer in than the northbound one
// because the southbound animals are mothers with calves and they hug the coast, and both corridors
// squeeze in toward the headland at Point Lookout because that is where the deep water comes to
// the cliff.
//
// It is not scenery. Whale season fills the ferry, the accommodation and the headland car park,
// and that then lands on the shorebird roosts, the parking and the waste. What a player does about
// close vessel approach shows up in what can be seen from the walking track, which is the trade
// worth understanding: boats that crowd the animals push them offshore and make the free thing
// worse.
//
// Determinism: world.rng.stream('whales'). No Math.random, no Date.now.

import {
  clamp, smoothstep, seasonal, absDay,
  eastCoast, levers, humanLoad, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;

/** East Australian population, from the pack. A range, not a number. */
const POPULATION = {
  low: 40000, high: 50000,
  growthLow: 0.10, growthHigh: 0.115,
  basis: 'A 2022 figure of as many as 40,000 and a preliminary 2024 report of more than 50,000, '
    + 'growing about 10 to 11 per cent a year over the past decade. Use the range, not a number.',
  // Ten and a half per cent a year is a decade average of a population coming back off whaling,
  // and it cannot run forever: compounded for twenty sim-years it puts a third of a million
  // humpbacks past this headland. The ceiling below is a modelling choice, not a published figure.
  // It is shaped so growth stays near the observed rate now and eases off as the population fills
  // the coast, which is what a recovering population does.
  ceilingModelled: 62000,
  ceilingBasis: 'A modelling choice so the population saturates instead of compounding. No carrying '
    + 'capacity for the east Australian humpback population is in any pack.',
  source: 'data/ecology.json sp-humpback-whale'
};

/** Monthly passage, from the pack's observed seasonal curve. */
const SEASON = {
  jan: 0, feb: 0, mar: 0, apr: 0.05, may: 0.3, jun: 0.85, jul: 1,
  aug: 0.9, sep: 0.7, oct: 0.85, nov: 0.6, dec: 0.15
};
/** How much of each month's passage is heading north rather than south. */
const NORTHBOUND_SHARE = {
  jan: 0, feb: 0, mar: 0, apr: 1, may: 1, jun: 0.97, jul: 0.9,
  aug: 0.62, sep: 0.2, oct: 0.03, nov: 0, dec: 0
};

/** Where you watch from. Every one of these is a place in data/places.json. */
const VIEWPOINTS = [
  { placeId: 'north-gorge-walk', label: 'North Gorge Walk', weight: 1.0, elevationM: 24 },
  { placeId: 'point-lookout-headland', label: 'Point Lookout headland (Mooloomba)', weight: 0.9, elevationM: 30 },
  { placeId: 'whale-rock', label: 'Whale Rock', weight: 0.6, elevationM: 12 },
  { placeId: 'point-lookout-lighthouse', label: 'Point Lookout Lighthouse', weight: 0.5, elevationM: 28 },
  { placeId: 'cylinder-headland', label: 'Cylinder Headland lookout', weight: 0.35, elevationM: 18 }
];

export function registerWhales(world) {
  const rng = world.rng.stream('whales');
  const L = levers(world);

  const state = world.publish('whales', {
    ready: false,
    source: 'data/ecology.json sp-humpback-whale and proc-whale-season',
    status: 'Not listed as threatened; removed from the threatened list in 2022. Still protected as '
      + 'a listed migratory species and a cetacean under the EPBC Act.',
    population: POPULATION,
    populationNow: 0, growthRateNow: 0,
    season: 'none', seasonIndex: 0, leg: null,
    peakNorth: 'July', peakSouth: 'October',
    podsOnStage: 0, whalesOnStage: 0,
    visibleFromHeadland: 0,
    sightingsPerHour: 0,
    sightingRangeKm: 0,
    bestViewpoint: null,
    viewpoints: [],
    pods: [],
    passedNorthThisSeason: 0, passedSouthThisSeason: 0,
    calvesThisSeason: 0,
    surfaceActiveNow: 0,
    boatsOnWater: 0, approachCompliance: 0,
    disturbedPods: 0,
    entanglements365: 0,
    lastSighting: null,
    watchingFromLand: 0,
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(30);
  const entangleRing = new DailyRing(365);
  const sightingRing = new DailyRing(365);

  let coast = null;
  let pods = [];
  let nextId = 1;
  let headland = { x: 6673, z: 14367 };
  let viewpoints = [];
  let lastDay = -1;
  let popNow = POPULATION.low;
  let approachDial = 0.82;      // modelled compliance with the approach distances
  let northThisSeason = 0, southThisSeason = 0, calvesThisSeason = 0;
  let seasonYear = -1;
  let sightingsToday = 0;

  world.bus.on('ui:intent', (p) => {
    if (p && p.kind === 'whales:approach-compliance') approachDial = clamp(Number(p.level) || 0, 0, 1);
  });

  /* ---------------------------------------------------------------- the corridors */

  /**
   * How far offshore the corridor runs at this latitude, in metres. Northbound animals are
   * further out; southbound cows with calves come in close. Both draw in toward the headland,
   * where the deep water is close to the cliff, which is the reason land-based watching works here.
   */
  function offshoreAt(z, dir) {
    const base = dir > 0 ? 5200 : 1500;
    const spread = dir > 0 ? 3200 : 1100;
    const dz = Math.abs(z - headland.z);
    const squeeze = 1 - 0.45 * (1 - smoothstep(0, 6500, dz));
    return { base: base * squeeze, spread: spread * squeeze };
  }

  function podX(pod) {
    return coast.at(pod.z) + pod.offshore;
  }

  /* ---------------------------------------------------------------- passage */

  /** Whales passing the island today, from the population and the pack's seasonal curve. */
  function passageToday(w) {
    // The curve integrates to about 164 day-equivalents over a year. Two passes of the whole
    // population have to fit inside that, which is what sets the peak day rate.
    const curve = seasonal(SEASON, w.clock);
    const perCurveUnit = (popNow * 2) / 164;
    return curve * perCurveUnit;
  }

  function spawnPods(w, dtTicks) {
    const perDay = passageToday(w);
    if (perDay < 0.5) return;
    const north = seasonal(NORTHBOUND_SHARE, w.clock);
    const meanPod = 2.2;
    const expected = (perDay / meanPod) * (dtTicks / 144);
    let n = Math.floor(expected);
    if (rng.float() < expected - n) n++;
    for (let i = 0; i < n && pods.length < 140; i++) {
      const dir = rng.float() < north ? 1 : -1;
      const startZ = dir > 0 ? headland.z - 21000 : headland.z + 21000;
      const off = offshoreAt(startZ, dir);
      // Southbound pods with a calf are the ones that make October worth standing out there for.
      const calfChance = dir < 0 ? 0.34 : 0.02;
      const hasCalf = rng.float() < calfChance;
      const escorts = hasCalf ? (rng.float() < 0.55 ? 1 : 0) : (rng.float() < 0.25 ? rng.int(1, 4) : 0);
      const size = 1 + (hasCalf ? 1 : 0) + escorts;
      pods.push({
        id: nextId++,
        dir, z: startZ,
        offshore: off.base + rng.range(-off.spread * 0.5, off.spread),
        size, calf: hasCalf, escorts,
        speed: (hasCalf ? rng.range(3.2, 4.8) : rng.range(4.6, 7.4)),   // km/h
        behaviour: 'travelling',
        behaviourTicks: 0,
        blowPhase: rng.range(0, 12),
        disturbed: 0,
        entangled: false,
        seen: false
      });
      if (dir > 0) northThisSeason += size; else southThisSeason += size;
      if (hasCalf) calvesThisSeason++;
    }
  }

  /* ---------------------------------------------------------------- viewing */

  /** How far a blow can be picked up from the headland today. */
  function sightRangeKm(w) {
    const wx = w.read('weather');
    const dl = w.read('daylight');
    if (!dl || !dl.isDay) return 0;
    // A blow from a thirty metre headland on a clear calm day carries a long way. This is the
    // number that decides whether the walk is worth doing today, so it is weather-driven and it
    // is published next to the count.
    let r = 11.5;
    if (wx) {
      r -= clamp(wx.swellM - 1.4, 0, 4) * 0.95;         // whitecaps hide a blow
      r -= clamp(wx.windKt - 14, 0, 30) * 0.11;
      r -= wx.rainMmHr > 2.5 ? 4 : wx.rainMmHr > 0.6 ? 1.5 : 0;
      r *= clamp(wx.visibilityKm / 30, 0.55, 1);
    }
    // Low sun behind the animals is the best light there is for spotting a blow.
    if (dl.elevationDeg > 2 && dl.elevationDeg < 25) r *= 1.12;
    return clamp(r, 0, 12);
  }

  /* ---------------------------------------------------------------- the tick */

  function tickPods(w) {
    const dtH = 10 / 60;
    const wx = w.read('weather');
    const dl = w.read('daylight');
    const rangeKm = sightRangeKm(w);
    state.sightingRangeKm = +rangeKm.toFixed(1);
    const rangeM = rangeKm * 1000;

    const boats = boatsOnWater(w);
    state.boatsOnWater = Math.round(boats);
    state.approachCompliance = +approachDial.toFixed(2);

    let visible = 0, onStage = 0, whales = 0, active = 0, disturbed = 0;

    for (let i = pods.length - 1; i >= 0; i--) {
      const p = pods[i];
      p.z += p.dir * p.speed * dtH * 1000;
      p.blowPhase += 1;

      // Off the stage: the pod has passed the island and is somebody else's now.
      if ((p.dir > 0 && p.z > headland.z + 21500) || (p.dir < 0 && p.z < headland.z - 21500)) {
        pods.splice(i, 1);
        continue;
      }
      onStage++;
      whales += p.size;

      // Behaviour. A pod travels most of the time, rests some of it, and now and then a competitive
      // group turns itself inside out on the surface for twenty minutes.
      p.behaviourTicks--;
      if (p.behaviourTicks <= 0) {
        const r = rng.float();
        if (p.calf && r < 0.34) { p.behaviour = 'resting'; p.behaviourTicks = rng.int(6, 24); }
        else if (!p.calf && p.escorts >= 2 && r < 0.28) { p.behaviour = 'surface active'; p.behaviourTicks = rng.int(4, 14); }
        else if (r < 0.10) { p.behaviour = 'surface active'; p.behaviourTicks = rng.int(2, 8); }
        else { p.behaviour = 'travelling'; p.behaviourTicks = rng.int(12, 60); }
      }
      if (p.behaviour === 'surface active') active++;
      if (p.behaviour === 'resting') p.speed = p.calf ? 2.2 : 3.0;
      else p.speed = clamp(p.speed, 2.5, 8);

      // Surfacing. A travelling humpback blows every eight to fifteen minutes and stays up for a
      // few of them, so at ten minute ticks a pod is up rather less than half the time.
      const interval = p.behaviour === 'resting' ? 5 : p.behaviour === 'surface active' ? 1.2 : 1.25;
      p.surfacing = p.behaviour === 'surface active' || (p.blowPhase % Math.max(1, Math.round(interval * 6)) < 2);

      // Vessels. A boat inside the legal approach distance changes what the animal does: the pod
      // stops surfacing, moves out, and the people standing on the Gorge walk see less of it.
      if (boats > 0) {
        const near = Math.exp(-Math.abs(p.z - headland.z) / 9000) * clamp(boats / 8, 0, 1.2);
        if (rng.float() < near * (1 - approachDial) * 0.05) {
          p.disturbed = 24;
          p.offshore += rng.range(300, 900);
          disturbed++;
        }
      }
      if (p.disturbed > 0) { p.disturbed--; p.surfacing = false; }

      // Entanglement in fishing and shark control gear. Rare, and the one wildlife call on this
      // island that goes to the state marine stranding hotline rather than to the local service.
      if (!p.entangled && rng.float() < 3.2e-7 * p.size) {
        p.entangled = true;
        entangleRing.add(1);
        log.push({ day: w.clock.formatDate(), what: 'whale entangled in gear', where: 'off Point Lookout' });
        w.bus.emit('wildlife:call', {
          species: 'Humpback whale',
          situation: 'whale entangled in fishing or shark control gear',
          where: 'off Point Lookout',
          x: podX(p), z: p.z,
          contact: 'Queensland marine stranding hotline 1300 130 372 (option 1)',
          publicRule: 'Watch, keep back, call. Nobody in the water, nobody cutting gear.'
        });
      }

      // Can it be seen from the headland right now.
      const dx = podX(p) - headland.x, dz = p.z - headland.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      p.distanceM = d;
      p.visible = rangeM > 0 && d < rangeM && p.surfacing;
      if (p.visible) {
        visible++;
        if (!p.seen) { p.seen = true; sightingsToday++; sightingRing.add(1); }
        // Something worth the walk. A breach off the Gorge is the moment people come back for.
        if (p.behaviour === 'surface active' && rng.float() < 0.05) {
          const what = p.calf ? 'a calf breaching beside its mother'
            : p.escorts >= 2 ? 'a competitive group, pec slaps and full breaches'
              : rng.float() < 0.5 ? 'a full breach' : 'tail slapping';
          state.lastSighting = {
            day: w.clock.formatDate(), time: w.clock.format(),
            what, distanceKm: +(d / 1000).toFixed(1),
            from: bestViewpointLabel()
          };
          w.bus.emit('whales:sighting', {
            what, distanceKm: +(d / 1000).toFixed(1),
            from: bestViewpointLabel(), podSize: p.size, calf: p.calf,
            x: podX(p), z: p.z
          });
        }
      }
    }

    // The live numbers are republished every hour rather than once a day, because a viewpoint
    // list that only refreshes at midnight is a list of how many whales you could see in the dark.
    if (w.clock.tick % 6 === 0) publishLive(w);

    state.podsOnStage = onStage;
    state.whalesOnStage = whales;
    state.visibleFromHeadland = visible;
    state.surfaceActiveNow = active;
    state.disturbedPods = disturbed;
    // What a person standing on the walk would actually count in an hour.
    state.sightingsPerHour = +(visible * 6 * 0.28).toFixed(1);
  }

  /** Whale watching and recreational boats out today. */
  function boatsOnWater(w) {
    const wx = w.read('weather');
    if (wx && (wx.swellM > 3 || wx.windKt > 26)) return 0;      // nobody is going out in that
    const h = humanLoad(w);
    const season = seasonal(SEASON, w.clock);
    const dl = w.read('daylight');
    if (!dl || !dl.isDay) return 0;
    // A handful of charter boats plus whatever else is out there on a good day in season.
    return season * (2.2 + h.visitors / 900) * (wx ? clamp(1.4 - wx.swellM * 0.28, 0.2, 1.2) : 1);
  }

  function bestViewpointLabel() {
    return viewpoints.length ? viewpoints[0].label : 'the Point Lookout headland';
  }

  /* ---------------------------------------------------------------- the day */

  function dailyPass(w) {
    const month = w.clock.month;
    const curve = seasonal(SEASON, w.clock);
    state.seasonIndex = +curve.toFixed(3);
    const north = seasonal(NORTHBOUND_SHARE, w.clock);
    state.leg = curve < 0.05 ? null : north > 0.6 ? 'north' : north < 0.25 ? 'south' : 'both legs overlapping';
    state.season = curve < 0.05 ? 'no whales'
      : curve < 0.35 ? 'the first of them'
        : north > 0.6 ? 'northbound, peaking about July'
          : 'southbound with calves, close inshore, peaking about October';

    // The population grows. Ten to eleven per cent a year is what the pack gives, and over a few
    // sim-years it is enough to change how busy the water looks.
    const r = (POPULATION.growthLow + POPULATION.growthHigh) / 2;
    const fill = clamp(popNow / POPULATION.ceilingModelled, 0, 1);
    const brake = 1 - fill * fill * fill;      // near the observed rate now, easing off near the ceiling
    popNow = clamp(popNow * (1 + (r * brake) / YEAR), 1000, POPULATION.ceilingModelled);
    state.populationNow = Math.round(popNow);
    state.growthRateNow = +(r * brake).toFixed(4);

    // The season ledger resets in autumn, between the two legs and the next year's.
    const y = w.clock.date.getUTCFullYear();
    if (month === 2 && seasonYear !== y) {
      seasonYear = y;
      northThisSeason = 0; southThisSeason = 0; calvesThisSeason = 0;
    }
    state.passedNorthThisSeason = Math.round(northThisSeason);
    state.passedSouthThisSeason = Math.round(southThisSeason);
    state.calvesThisSeason = calvesThisSeason;
    state.entanglements365 = Math.round(entangleRing.total);

    // How many people are on the headland for it. This is the number the ferry, the car park and
    // the shorebird roosts all feel, and it is why whale season is not scenery.
    const h = humanLoad(w);
    state.watchingFromLand = Math.round(curve * (h.visitors * 0.22 + h.residents * 0.03));
    if (curve > 0.5 && w.clock.dayOfMonth === 1) {
      w.bus.emit('whales:season', {
        leg: state.leg, index: +curve.toFixed(2),
        watching: state.watchingFromLand,
        text: `Whale season. ${state.season}. About ${state.watchingFromLand} people a day on the headland.`
      });
    }
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'whales',
    phase: 'ecology',
    order: 70,

    init(w) {
      coast = eastCoast(w);
      if (!coast || !coast.ready) { notes.push('no coastline: the whale corridors cannot be placed.'); return; }
      const hp = place(w, 'point-lookout-headland');
      if (hp) headland = { x: hp.x, z: hp.z };
      else notes.push('point-lookout-headland is not in data/places.json: the viewing geometry falls back to a computed position.');
      for (const v of VIEWPOINTS) {
        const p = place(w, v.placeId);
        if (p) viewpoints.push({ ...v, x: p.x, z: p.z, name: p.name });
      }
      popNow = POPULATION.low;
      state.ready = true;
      // Seed the stage so the first day of a season is not empty water.
      spawnPods(w, 144 * 0.4);
      tickPods(w);
      dailyPass(w);
      publish(w);
      lastDay = absDay(w.clock);
      notes.push('The corridors are offset from the east coast as the heightfield has it, so they '
        + 'follow the island rather than a drawn line. Northbound runs about five kilometres out, '
        + 'southbound about one and a half, and both draw in at the headland where the deep water '
        + 'comes close. Those offsets are modelling choices; the timing and the peaks are from the pack.');
      notes.push('Passage rates come from the published population range and the pack seasonal curve. '
        + 'The population is a range and it is carried as one.');
      w.bus.emit('whales:ready', { viewpoints: viewpoints.length });
    },

    tick(w) {
      if (!state.ready) return;
      spawnPods(w, 1);
      tickPods(w);
      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      entangleRing.roll();
      sightingRing.roll();
      sightingsToday = 0;
      for (const p of pods) p.seen = false;
      dailyPass(w);
      publish(w);
    },

    describe(w) {
      return {
        season: state.season,
        index: state.seasonIndex,
        population: state.populationNow,
        growth: state.growthRateNow,
        pods: state.podsOnStage,
        whales: state.whalesOnStage,
        visible: state.visibleFromHeadland,
        perHour: state.sightingsPerHour,
        rangeKm: state.sightingRangeKm,
        north: state.passedNorthThisSeason,
        south: state.passedSouthThisSeason,
        calves: state.calvesThisSeason,
        boats: state.boatsOnWater,
        disturbed: state.disturbedPods,
        entangled365: state.entanglements365,
        watching: state.watchingFromLand
      };
    },

    save() {
      return {
        popNow, approachDial, northThisSeason, southThisSeason, calvesThisSeason, seasonYear,
        pods: pods.map((p) => ({ ...p })),
        entangle: entangleRing.save(), sightings: sightingRing.save(), log: log.save(), nextId
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      popNow = s.popNow; approachDial = s.approachDial ?? 0.82;
      northThisSeason = s.northThisSeason || 0;
      southThisSeason = s.southThisSeason || 0;
      calvesThisSeason = s.calvesThisSeason || 0;
      seasonYear = s.seasonYear ?? -1;
      nextId = s.nextId || 1;
      pods = (s.pods || []).map((p) => ({ ...p }));
      entangleRing.load(s.entangle); sightingRing.load(s.sightings); log.load(s.log);
      publish(w);
    }
  });

  function publish(w) {
    publishLive(w);
    state.events = log.recent(6);
    state.levers = L.snapshot(['gorge-walk-visitor-flow', 'point-lookout-parking-management',
      'wildlife-rescue-support']);
    state.civicMetrics = {
      whale_season: metric(state.seasonIndex),
      // What a person on the headland actually gets, which is what close boat approach costs.
      land_based_viewing: metric(clamp(state.sightingsPerHour / 4, 0, 1))
    };
  }

  function publishLive(w) {
    // Only the pods worth drawing or listing: the ones near the headland, nearest first.
    const near = pods
      .map((p) => ({ p, d: p.distanceM ?? 1e9 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
    state.pods = near.map(({ p, d }) => ({
      id: p.id,
      x: Math.round(podX(p)), z: Math.round(p.z),
      heading: p.dir > 0 ? 'north' : 'south',
      size: p.size, calf: p.calf, escorts: p.escorts,
      behaviour: p.behaviour,
      surfacing: !!p.surfacing,
      visible: !!p.visible,
      distanceKm: +(d / 1000).toFixed(2),
      offshoreKm: +(p.offshore / 1000).toFixed(2),
      speedKmh: +p.speed.toFixed(1),
      entangled: p.entangled,
      pushedOffshore: p.disturbed > 0
    }));
    state.viewpoints = viewpoints.map((v) => {
      let n = 0;
      for (const p of pods) {
        if (!p.surfacing) continue;
        const dx = podX(p) - v.x, dz = p.z - v.z;
        if (Math.sqrt(dx * dx + dz * dz) < state.sightingRangeKm * 1000) n++;
      }
      return { id: v.placeId, label: v.label, elevationM: v.elevationM, inSightNow: n };
    });
    state.viewpoints.sort((a, b) => b.inSightNow - a.inSightNow);
    state.bestViewpoint = state.viewpoints.length ? state.viewpoints[0].label : null;
  }
}
