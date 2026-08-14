// Migratory shorebirds on the western sand flats.
//
// This is the best disturbance mechanic on the island, because the harm is invisible at the moment
// it happens. A dog running at a roost does not kill anything. It costs the birds fuel they have
// to make back before they can fly to the northern hemisphere, and the bird that leaves light is a
// bird that does not arrive. Nobody sees that happen. The player sees a number fall.
//
// WHAT IS ACTUALLY OUT THERE:
//   * Eastern curlew, Critically Endangered under the EPBC Act. Moreton Bay counts about 2,304,
//     which is a bay figure and not an island one. Bay numbers have been falling by around 2.4 per
//     cent a year since 1988, and recent eastern Australian declines are worse than that.
//   * Bar-tailed godwit of the western Alaskan subspecies, Endangered. About 12,134 in the bay.
//     These are the birds that make the direct trans-Pacific flight from Alaska, which is why the
//     fat they put on in March is not a detail.
//   * Great knot and curlew sandpiper in the same mixed flocks, so the roost is a community.
//   * Pied oystercatcher, beach stone-curlew and little tern, which are residents. The shorebird
//     problem is not a summer-only problem and they are here to say so.
//
// THE ISLAND SHARE IS MODELLED AND SAYS SO. The pack's counts are for Moreton Bay. The island's
// western flats are one part of the bay. Presenting a bay-wide count as an island count is the
// exact error data/ecology.json warns about, so the share is a named, published parameter.
//
// The one hard number in the pack is the drone exclusion: about 475 m around waterbird flocks
// likely to contain eastern curlews, which are exceptionally sensitive to drones at every distance
// and altitude tested.
//
// Determinism: world.rng.stream('shorebirds'). No Math.random, no Date.now.

import {
  clamp, smoothstep, seasonal, absDay,
  ecoGrid, levers, humanLoad, dogPressure, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;

/* ------------------------------------------------------------------ the birds */

const SPECIES = [
  {
    id: 'sp-eastern-curlew', name: 'Eastern curlew', short: 'curlew',
    status: 'Critically Endangered', migrant: true,
    bayCount: 2304, islandShare: 0.09,
    flightKm: 11000, departFatNeeded: 0.86,
    wariness: 1.0,                       // how far away it flushes: the wariest bird on the flats
    seasonal: { jan: 1, feb: 1, mar: 0.9, apr: 0.4, may: 0.1, jun: 0.05, jul: 0.05, aug: 0.2, sep: 0.7, oct: 0.95, nov: 1, dec: 1 },
    note: 'Departs by about March and April. A small number of immature birds over-winter.'
  },
  {
    id: 'sp-bar-tailed-godwit', name: 'Bar-tailed godwit (western Alaskan subspecies)', short: 'godwit',
    status: 'Endangered', migrant: true,
    bayCount: 12134, islandShare: 0.08,
    flightKm: 11500, departFatNeeded: 0.90,
    wariness: 0.72,
    seasonal: { jan: 1, feb: 1, mar: 0.85, apr: 0.35, may: 0.1, jun: 0.05, jul: 0.05, aug: 0.25, sep: 0.8, oct: 1, nov: 1, dec: 1 },
    note: 'The direct trans-Pacific flight from Alaska is why the pre-departure fat gain in March matters.'
  },
  {
    id: 'sp-great-knot', name: 'Great knot', short: 'knot',
    status: 'Vulnerable', migrant: true,
    bayCount: null, islandCount: 240, islandShare: null,
    flightKm: 9000, departFatNeeded: 0.84,
    wariness: 0.6,
    seasonal: { jan: 1, feb: 1, mar: 0.8, apr: 0.3, may: 0.05, jun: 0.02, jul: 0.02, aug: 0.2, sep: 0.7, oct: 0.95, nov: 1, dec: 1 },
    note: 'Yellow Sea staging habitat loss is the pressure nobody on this island can touch.'
  },
  {
    id: 'sp-curlew-sandpiper', name: 'Curlew sandpiper', short: 'sandpiper',
    status: 'Critically Endangered', migrant: true,
    bayCount: null, islandCount: 150, islandShare: null,
    flightKm: 10000, departFatNeeded: 0.85,
    wariness: 0.5,
    seasonal: { jan: 1, feb: 1, mar: 0.8, apr: 0.3, may: 0.05, jun: 0.02, jul: 0.02, aug: 0.2, sep: 0.7, oct: 0.95, nov: 1, dec: 1 },
    note: 'Small-bodied member of the mixed roost flock.'
  },
  {
    id: 'sp-pied-oystercatcher', name: 'Australian pied oystercatcher', short: 'oystercatcher',
    status: 'Not listed', migrant: false, resident: true, nests: true,
    islandCount: 74, nestMonths: [7, 8, 9, 10, 11],
    wariness: 0.55,
    note: 'Territorial pairs that hold the same stretch of flat for years, so a player can watch one pair.'
  },
  {
    id: 'sp-beach-stone-curlew', name: 'Beach stone-curlew', short: 'stone-curlew',
    status: 'Not listed', migrant: false, resident: true, nests: true,
    islandCount: 14, nestMonths: [8, 9, 10, 11, 0],
    wariness: 0.9,
    note: 'Resident and scarce. Nests on open beach in the warm months, which puts eggs in the path of dogs and vehicles.'
  },
  {
    id: 'sp-little-tern', name: 'Little tern', short: 'tern',
    status: 'Vulnerable', migrant: false, resident: true, nests: true, colonial: true,
    islandCount: 46, nestMonths: [9, 10, 11, 0, 1],
    wariness: 0.8,
    note: 'Nests on open sand in the warm months, which is exactly when the beaches are busiest.'
  }
];

/* The roosts and feeding flats, every one of them a place in data/places.json. `openness` is how
   easily somebody walks or drives straight into the birds, which is what actually decides how many
   times a day a roost gets flushed. */
const ROOSTS = [
  { id: 'amity-point', placeId: 'amity-point', label: 'Amity Point (Pulan) banks', share: 0.30, openness: 0.85, township: 'amity-point', vehicles: false },
  { id: 'flinders-beach', placeId: 'flinders-beach', label: 'Flinders Beach', share: 0.14, openness: 0.95, township: 'amity-point', vehicles: true },
  { id: 'myora', placeId: 'myora-springs', label: 'Myora', share: 0.16, openness: 0.35, township: 'dunwich', vehicles: false },
  { id: 'one-mile', placeId: 'one-mile-jetty', label: 'One Mile', share: 0.12, openness: 0.7, township: 'dunwich', vehicles: false },
  { id: 'polka-point', placeId: 'polka-point', label: 'Polka Point', share: 0.09, openness: 0.5, township: 'dunwich', vehicles: false },
  { id: 'adams-beach', placeId: 'adams-beach', label: 'Adams Beach', share: 0.07, openness: 0.6, township: 'dunwich', vehicles: false },
  { id: 'bradburys-beach', placeId: 'bradburys-beach', label: "Bradbury's Beach", share: 0.06, openness: 0.75, township: 'dunwich', vehicles: false },
  { id: 'dunwich-foreshore', placeId: 'dunwich-foreshore', label: 'Dunwich Foreshore', share: 0.06, openness: 0.9, township: 'dunwich', vehicles: false }
];

/* How much of a departure fuel load a bird is carrying at each month of the season. Birds top up
   in the weeks before they leave, which is what makes March the month that decides the flight. */
const FATTENING = {
  jan: 0.55, feb: 0.85, mar: 1.0, apr: 1.0, may: 0.2, jun: 0.1,
  jul: 0.1, aug: 0.12, sep: 0.15, oct: 0.2, nov: 0.3, dec: 0.4
};

/** Recommended drone exclusion around a waterbird flock, from the pack. */
const DRONE_EXCLUSION_M = 475;

/* THE INDICATOR THE TREATY LAYER WATCHES, and what it is not.
 *
 * data/civic.json treaty_layer carries Australia's obligation under Article 3.2 of the Ramsar
 * Convention: to be informed at the earliest possible time if the ecological character of a listed
 * wetland is changing through human interference, and to notify. Moreton Bay is that wetland, this
 * island is inside it, and the mechanic in this file is human interference in exactly the sense the
 * Article uses: dogs, drones, vehicles and people.
 *
 * So this system publishes `characterIndex`, and the civic layer decides what to do about it. Two
 * things must stay true of it or it becomes a lie:
 *
 *   1. IT IS NOT AN ECOLOGICAL CHARACTER ASSESSMENT. A real one is made against the site's own
 *      ecological character description, on evidence, by Australian governments together. Nobody
 *      here has read that description. This is the twin's own number about the twin's own island,
 *      and every screen that shows it says so.
 *   2. IT IS SEASON-PROOF. The migrants leave in March and the flats are empty by May, and an
 *      indicator that fell every winter would fire the obligation every year for a reason that is
 *      not human interference at all. So it is built from two things that do not swing with the
 *      season: the highest count seen in the last 365 days, and the weight the birds actually left
 *      at, which is the whole point of the disturbance mechanic anyway.
 *
 * Until a first departure season has finished there is no weight to read, so the index runs on
 * abundance alone and `characterBasis` says which of the two it is standing on.
 */
const CHARACTER = {
  abundanceWeight: 0.45,
  conditionWeight: 0.55,
  note: 'This simulation\'s own indicator, not an ecological character assessment. Half of it is the '
    + 'highest count on the island in the last 365 days against the count the run started from, and '
    + 'half is the weight the migrants left at as a share of the weight they needed. Both are things '
    + 'roost disturbance moves and neither swings with the season.'
};

/** External flyway decline, which no lever on this island can touch. */
const FLYWAY = {
  annualDecline: 0.035,
  basis: 'Moreton Bay eastern curlew declined about 2.4 per cent a year from 1988 to 2008, and '
    + 'recent eastern Australian declines are given as 5.2 to 6.7 per cent a year. This sits between '
    + 'them. The driver is habitat loss along the East Asian-Australasian Flyway, above all the '
    + 'Yellow Sea staging grounds, and it is outside any island lever.',
  source: 'data/ecology.json sp-eastern-curlew trend'
};

export function registerShorebirds(world) {
  const rng = world.rng.stream('shorebirds');
  const L = levers(world);

  const state = world.publish('shorebirds', {
    ready: false,
    source: 'data/ecology.json sp-eastern-curlew, sp-bar-tailed-godwit and proc-shorebird-disturbance',
    islandShareBasis: '',
    onIslandNow: 0,
    bySpecies: [],
    roosts: [],
    tidePhase: 'feeding',
    flatsExposedHa: 0, flatsTotalHa: 0,
    feedingNow: 0, roostingNow: 0,
    disturbanceToday: 0, disturbance365: 0,
    fuelLostToDisturbanceDays: 0,
    meanFat: 0,
    season: '',
    departures: [],
    arrivals: [],
    lastSurvey: null,
    nests: { active: 0, hatched365: 0, lost365: 0, lostTo: {} },
    droneExclusionM: DRONE_EXCLUSION_M,
    droneRule: 0,
    flyway: FLYWAY,
    // What the birds on these flats are listed under, read out of data/ecology.json at init so the
    // words stay in the pack. The civic layer reads this too rather than restating it.
    protection: null,
    // The Article 3.2 indicator. 1.0 is the island the run started on. See CHARACTER above.
    characterIndex: 1,
    characterBasis: '',
    characterParts: { abundance: 1, condition: null, peak365: 0, baselinePeak: 0, lastSeasonReadiness: null },
    flushSources365: { 'somebody walking through': 0, 'a dog off the lead': 0, 'a vehicle on the sand': 0, 'a drone': 0 },
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(30);
  const disturbRing = new DailyRing(365);      // flock-level: one roost flush lifts several flocks
  const roostFlushRing = new DailyRing(365);   // roost-level: how many times the flat went up
  const fuelLostRing = new DailyRing(365);
  const hatchRing = new DailyRing(365);
  const nestLostRing = new DailyRing(365);

  let g = null;
  let roosts = [];
  let flocks = [];              // one per roost per species
  let lastDay = -1;
  let flatHist = null;          // hypsometry of the bay flats: area above a given height
  let flatsTotalHa = 0;
  let droneRule = 0;
  let nests = [];
  const lostTo = { dog: 0, vehicle: 0, fox: 0, tide: 0, people: 0 };
  const departLog = [];
  const arriveLog = [];

  /* The Article 3.2 indicator's working state. A ring of daily migrant counts, because the number
     that matters is the highest one in a year rather than today's; a baseline taken once at init;
     and the readiness of the last completed departure season, banked when the season closes so a
     part-finished March does not read as a collapse. */
  const peakRing = new Float64Array(365);
  let peakCursor = 0, peakFilled = 0;
  let baselinePeak = 0;
  let seasonReadySum = 0, seasonReadyN = 0;
  let lastSeasonReadiness = null;
  let lastSeasonBankedDay = -1;
  const FLUSH_SOURCES = ['somebody walking through', 'a dog off the lead', 'a vehicle on the sand', 'a drone'];
  const flushSourceRings = new Map(FLUSH_SOURCES.map((k) => [k, new DailyRing(365)]));

  world.bus.on('ui:intent', (p) => {
    if (p && p.kind === 'shorebirds:drone-rule') droneRule = clamp(Number(p.level) || 0, 0, 1);
  });

  /* ---------------------------------------------------------------- build */

  /**
   * How much intertidal flat is out of the water at a given tide height. Taken from the island's
   * own heightfield rather than from a number: every seabed cell on the bay side between the low
   * water mark and the high, binned by height once at boot. The birds then feed on exactly the
   * ground the tide system uncovers, which is why a spring low is a feeding day and a neap is not.
   */
  function buildFlats(w) {
    const island = w.island;
    if (!island || !island.grid) return false;
    const gr = island.grid;
    const cellHa = (gr.cell * gr.cell) / 10000;
    const sea = island.seaLevel;
    const lo = sea - 2.6, hi = sea + 1.0;
    const BINS = 90;
    const hist = new Float64Array(BINS + 1);
    for (let k = 0; k < gr.height.length; k++) {
      if (gr.bayness[k] < 128) continue;
      const h = gr.height[k];
      if (h < lo || h > hi) continue;
      let b = Math.floor(((h - lo) / (hi - lo)) * BINS);
      if (b < 0) b = 0; else if (b > BINS) b = BINS;
      hist[b] += cellHa;
    }
    // Cumulative from the top down: area above each bin.
    const above = new Float64Array(BINS + 1);
    let run = 0;
    for (let b = BINS; b >= 0; b--) { run += hist[b]; above[b] = run; }
    flatHist = { lo, hi, bins: BINS, above };
    // The working number is the ground that dries on a good low tide, not everything down to
    // three metres of water. A bird feeds on what is out, so the denominator is what can be out.
    flatsTotalHa = areaAbove(flatHist, sea - 0.75);
    return flatsTotalHa > 10;
  }

  function areaAbove(H, h) {
    const f = (h - H.lo) / (H.hi - H.lo);
    let b = Math.round(f * H.bins);
    if (b < 0) b = 0; else if (b > H.bins) b = H.bins;
    return H.above[b];
  }
  function exposedHa(tideHeight) {
    return flatHist ? areaAbove(flatHist, tideHeight) : 0;
  }

  function build(w) {
    g = ecoGrid(w);
    if (!buildFlats(w)) { notes.push('no intertidal flats found on the bay side: no shorebird system.'); return false; }

    for (const r of ROOSTS) {
      const p = place(w, r.placeId);
      if (!p) { notes.push(`${r.label}: not in data/places.json, so the roost is not placed.`); continue; }
      roosts.push({ ...r, x: p.x, z: p.z, flushesToday: 0, flushes365: 0, lastFlush: null });
    }
    if (!roosts.length) return false;

    // Normalise the roost shares over the roosts that actually got placed.
    const tot = roosts.reduce((s, r) => s + r.share, 0);
    for (const r of roosts) r.share /= tot;

    for (const sp of SPECIES) {
      const islandTotal = sp.islandCount != null
        ? sp.islandCount
        : Math.round(sp.bayCount * sp.islandShare);
      sp.peak = islandTotal;
      for (const r of roosts) {
        flocks.push({
          sp, roost: r,
          count: sp.migrant ? 0 : Math.round(islandTotal * r.share),
          pool: Math.round(islandTotal * r.share),   // birds that will arrive this season
          fat: sp.migrant ? 0.3 : 0.5,
          intakeToday: 0, needToday: 0, lostToDisturbance: 0,
          departed: false, departFat: 0
        });
      }
    }
    state.islandShareBasis = 'Moreton Bay counts from the pack, multiplied by a modelled island '
      + 'share: 9 per cent of the bay eastern curlew and 8 per cent of the bay bar-tailed godwit '
      + 'use the island western flats. That share is a modelling choice, not a count, and it is the '
      + 'number to correct first if somebody has the real survey.';
    return true;
  }

  /* ---------------------------------------------------------------- pressure */

  /**
   * How many times an hour this roost is being disturbed, and by what. Disturbance is a property
   * of the roost, not of one species: somebody walks along the sand and the whole flat goes up.
   * Which birds go up first is a property of the bird, and the eastern curlew always goes first.
   */
  function pressureAt(w, r, daylight) {
    const h = humanLoad(w);
    const dogs = dogPressure(w, 1);
    const offLead = L.level('off-lead-area-review');
    const beachClose = L.level('beach-driving-seasonal-closures');
    const camping = L.level('beach-camping-permit-numbers');
    const wardens = L.level('feral-and-weed-control') * 0.3 + L.level('ranger-program-funding') * 0.7;
    const day = daylight && daylight.isDay ? 1 : 0.05;
    const byTown = h.byTownship || {};
    const near = (byTown[r.township] || 0) + h.residents * (r.township === 'dunwich' ? 0.28 : 0.09);
    const holiday = h.holiday ? 1.45 : 1;

    // People walking through. Signage and volunteer wardens over the summer move this, and how
    // open the roost is decides whether there is room to walk around a flock or only through it.
    const people = (near / 13000) * r.openness * holiday * day * (1 - 0.42 * wardens);
    // Dogs. The worst per-event flusher by a long way, because a dog runs at a flock and a person
    // walks past it. Only a small share of the island's loose dogs are on any one roost beach.
    const dog = dogs.roaming * r.share * 0.022 * r.openness * holiday * day * (1 - 0.38 * offLead);
    // Vehicles on the sand.
    const vehicle = r.vehicles ? (near / 22000) * holiday * day * (1 - 0.6 * beachClose) * (1 - 0.2 * camping) : 0;
    // Drones. Rare, and worth far more than the rest when it happens: an eastern curlew flushes
    // from a drone at every distance and altitude that has been tested.
    const drone = (near / 90000) * day * (1 - 0.85 * droneRule);
    return {
      people, dog, vehicle, drone,
      // Events an hour at this roost.
      rate: people + dog * 2.4 + vehicle * 1.4 + drone * 5.0,
      total: people + dog + vehicle + drone,
      wardens
    };
  }

  /* ---------------------------------------------------------------- the tick */

  function tickBirds(w) {
    const tide = w.read('tide');
    const daylight = w.read('daylight');
    if (!tide) return;
    const dtH = 10 / 60;
    const exposed = exposedHa(tide.height);
    const availability = clamp(exposed / Math.max(1, flatsTotalHa), 0, 1);
    const feeding = availability > 0.18;
    state.flatsExposedHa = Math.round(exposed);
    state.tidePhase = feeding ? 'feeding on the flats' : 'roosting above the tide line';

    for (const r of roosts) {
      const P = pressureAt(w, r, daylight);
      r.pressureNow = P;
      // One draw a roost a tick. At these rates that is the same as counting events.
      r.flushNow = rng.float() < Math.min(0.85, P.rate * dtH);
      if (r.flushNow) {
        r.flushesToday++;
        roostFlushRing.add(1);
        r.flushSource = P.drone > 0.01 && rng.float() < 0.25 ? 'a drone'
          : P.dog * 2.4 > P.people ? 'a dog off the lead'
            : P.vehicle * 1.4 > P.people ? 'a vehicle on the sand' : 'somebody walking through';
        // Every one of these four is a person. Article 3.2 notification is only for human-induced
        // change, so the split matters to the civic layer and not only to the ecology one.
        const ring = flushSourceRings.get(r.flushSource);
        if (ring) ring.add(1);
        // The roost going up is the only visible sign of what disturbance costs, and the read
        // model is only republished once a day, so the lift goes on the bus as it happens. About
        // four of these a day across the island: cheap to emit, and the renderer needs it to put
        // the flock in the air at the moment the flat is flushed.
        w.bus.emit('shorebirds:flush', {
          roost: r.id, label: r.label, x: r.x, z: r.z, source: r.flushSource,
          birds: Math.round(flocks.reduce((s, f) => s + (f.roost === r ? f.count : 0), 0))
        });
      }
    }

    for (const f of flocks) {
      if (f.count <= 0) continue;
      const r = f.roost;

      if (feeding) {
        // Intake. Birds only accrue while the flat is out of the water, which is the whole reason
        // the tide system and this one have to agree about where the water is.
        const prey = preyIndex(w, r);
        let hours = dtH;
        if (r.flushNow) hours = Math.max(0, hours - 0.25);   // a flush costs feeding time as well
        f.intakeToday += 0.20 * availability * prey * hours;
      }

      // Whether this species went up. The wariest bird on the flat goes first and comes back last.
      if (r.flushNow && rng.float() < f.sp.wariness) {
        // Flying costs fuel whether the bird is feeding or roosting, and it costs more at the
        // roost, because at high tide the bird is trying to sit still and hold on to it.
        const cost = feeding ? 0.006 : 0.016;
        f.fat = Math.max(0, f.fat - cost);
        f.lostToDisturbance += cost;
        state.disturbanceToday++;
        disturbRing.add(1);
        fuelLostRing.add(cost * f.count);
        if (r.flushSource === 'a drone' && f.sp.short === 'curlew' && rng.float() < 0.2) {
          log.push({ day: w.clock.formatDate(), what: 'a drone put the whole roost up', where: r.label });
          w.bus.emit('ecology:alert', {
            id: 'drone-roost',
            text: `A drone put the roost up at ${r.label}. The recommended exclusion around a `
              + `flock that might hold eastern curlews is ${DRONE_EXCLUSION_M} m.`
          });
        }
      }
      f.needToday += 0.042 * dtH;    // maintenance, in the same units as intake
    }
  }

  /** Food on this flat: yabbies, worms and small bivalves. Reads marine.js when it is loaded. */
  function preyIndex(w, r) {
    const m = w.read('marine');
    if (m && typeof m.yabbyDensityAt === 'function') {
      return clamp(0.55 + m.yabbyDensityAt(r.x, r.z) * 0.6, 0.3, 1.25);
    }
    return 1;
  }

  /* ---------------------------------------------------------------- the day */

  function dailyPass(w) {
    const month = w.clock.month;
    let onIsland = 0, fatSum = 0, fatN = 0;

    for (const f of flocks) {
      // Fat. Surplus over maintenance is banked; a deficit is drawn down. The units are a share of
      // the fuel load the bird needs to leave with, so 1.0 is a bird ready to go.
      //
      // A shorebird does not carry a departure fuel load all summer: it carries what it needs and
      // puts the rest on in the weeks before it goes. The ceiling below rises through the season
      // for exactly that reason, and it is also why a January of dogs is still on the books in
      // March. The bird cannot make it up in the last fortnight, and that is the whole mechanic.
      const ceiling = f.sp.migrant ? 0.30 + 0.98 * seasonal(FATTENING, w.clock) : 0.7;
      const net = f.intakeToday - f.needToday;
      f.fat = clamp(f.fat + net * 0.55, 0, ceiling);
      f.intakeToday = 0; f.needToday = 0;

      if (f.sp.migrant) {
        stepMigrant(w, f, month);
      } else {
        // Residents. Slow demography driven by nest success rather than by fat.
        f.fat = clamp(f.fat + (0.55 - f.fat) * 0.02, 0, 1.2);
      }
      onIsland += f.count;
      if (f.count > 0) { fatSum += f.fat * f.count; fatN += f.count; }
    }

    stepNests(w, month);
    // The resident birds' year turns over at the end of the nesting season.
    if (month === 2 && w.clock.dayOfMonth === 1) stepResidents(w);

    for (const r of roosts) { r.flushes365 += r.flushesToday; r.flushesToday = 0; }

    state.onIslandNow = Math.round(onIsland);
    state.meanFat = fatN ? +(fatSum / fatN).toFixed(3) : 0;
    state.disturbance365 = Math.round(disturbRing.total);
    state.roostFlushes365 = Math.round(roostFlushRing.total);
    state.fuelLostToDisturbanceDays = +(fuelLostRing.total / 0.042 / 24).toFixed(1);
    state.flatsTotalHa = Math.round(flatsTotalHa);
    state.droneRule = +droneRule.toFixed(2);
    state.season = month >= 8 || month <= 1 ? 'the flocks are here'
      : month === 2 || month === 3 ? 'fattening and leaving' : 'gone north, a few immatures over-wintering';

    stepCharacter(w, month);

    // The monthly count. Real shorebird numbers come from volunteer counts on a spring high tide,
    // not from a live readout, so the published survey lags the truth. Both are carried, because
    // the gap between them is a true thing about how anybody knows any of this.
    if (w.clock.dayOfMonth === 1) {
      state.lastSurvey = {
        day: w.clock.formatDate(),
        counts: SPECIES.map((sp) => ({
          name: sp.name,
          counted: Math.round(flocks.filter((f) => f.sp === sp).reduce((s, f) => s + f.count, 0)
            * rng.range(0.86, 1.06))
        })),
        method: 'modelled volunteer count on a high tide roost, which is how the real numbers are got'
      };
    }
  }

  /**
   * The Article 3.2 indicator, once a day. Cheap: one ring write, one pass over 365 floats.
   *
   * The departure season closes in May, which is after the late-departure cutoff in `stepMigrant`,
   * so every flock that was going to leave has left. That is when the season's mean readiness is
   * banked and the accumulator resets. Banking it earlier would read a March half through as a
   * catastrophe every single year. The guard is a day count rather than a calendar year so nothing
   * here has to touch a Date.
   */
  function stepCharacter(w, month) {
    let migrants = 0;
    for (const f of flocks) if (f.sp.migrant) migrants += f.count;
    peakRing[peakCursor] = migrants;
    peakCursor = (peakCursor + 1) % 365;
    if (peakFilled < 365) peakFilled++;

    let peak = 0;
    for (let i = 0; i < peakFilled; i++) if (peakRing[i] > peak) peak = peakRing[i];
    if (!baselinePeak && peak > 0) baselinePeak = peak;

    const today = absDay(w.clock);
    if (month === 4 && seasonReadyN > 0 && today - lastSeasonBankedDay > 300) {
      lastSeasonBankedDay = today;
      lastSeasonReadiness = clamp(seasonReadySum / seasonReadyN, 0, 1);
      seasonReadySum = 0; seasonReadyN = 0;
    }
    publishCharacter(peak);
  }

  /** The read model half, split out because a load must rebuild it without advancing the ring. */
  function publishCharacter(peakIn) {
    let peak = peakIn;
    if (peak == null) {
      peak = 0;
      for (let i = 0; i < peakFilled; i++) if (peakRing[i] > peak) peak = peakRing[i];
    }
    const abundance = baselinePeak > 0 ? clamp(peak / baselinePeak, 0, 1) : 1;
    const condition = lastSeasonReadiness;
    const index = condition == null
      ? abundance
      : CHARACTER.abundanceWeight * abundance + CHARACTER.conditionWeight * condition;

    state.characterIndex = +clamp(index, 0, 1).toFixed(3);
    state.characterParts = {
      abundance: +abundance.toFixed(3),
      condition: condition == null ? null : +condition.toFixed(3),
      peak365: Math.round(peak),
      baselinePeak: Math.round(baselinePeak),
      lastSeasonReadiness: condition == null ? null : +condition.toFixed(3)
    };
    state.characterBasis = condition == null
      ? 'Abundance only. No departure season has finished yet, so there is no weight to read and the '
        + 'index is the highest count in the last ' + peakFilled + ' days against the count this run started from.'
      : 'The highest count in the last 365 days against the count this run started from, at '
        + Math.round(CHARACTER.abundanceWeight * 100) + ' per cent, and the weight the migrants left '
        + 'at last season as a share of the weight they needed, at ' + Math.round(CHARACTER.conditionWeight * 100) + ' per cent.';
    const sources = {};
    for (const [k, ring] of flushSourceRings) sources[k] = Math.round(ring.total);
    state.flushSources365 = sources;
  }

  function stepMigrant(w, f, month) {
    const sp = f.sp;
    // Departure. From about March the birds leave, and they leave when they are ready rather than
    // on a date. A bird that cannot get to weight goes anyway, later and lighter.
    if (!f.departed && f.count > 0 && (month === 2 || month === 3)) {
      const ready = f.fat >= sp.departFatNeeded;
      const late = month === 3 && w.clock.dayOfMonth > 12;
      if (ready || late) {
        f.departed = true;
        f.departFat = f.fat;
        const r = clamp(f.fat / sp.departFatNeeded, 0, 1);
        // Bank the weight this flock left at. The season's mean is the condition half of the
        // Article 3.2 indicator, and it is the only honest read of what a summer of dogs cost.
        seasonReadySum += r * Math.max(1, f.count);
        seasonReadyN += Math.max(1, f.count);
        // Two things follow from the weight a bird leaves at: whether it survives the flight and
        // the staging grounds, and whether it breeds when it gets there. The island can move both.
        // What it cannot move is the flyway itself, and that decline sits under both of them.
        const adultSurvival = 0.70 + 0.18 * r;
        const recruitment = 0.05 + 0.11 * r;
        const multiplier = (adultSurvival + recruitment) * (1 - FLYWAY.annualDecline);
        f.pool = Math.max(0, Math.round(f.count * multiplier));
        departLog.push({
          day: w.clock.formatDate(), species: sp.short, roost: f.roost.id,
          left: f.count, fat: +f.fat.toFixed(2),
          readyPct: Math.round(r * 100),
          survival: +adultSurvival.toFixed(2),
          returning: f.pool
        });
        if (departLog.length > 60) departLog.shift();
        if (r < 0.9 && f.count > 20) {
          log.push({
            day: w.clock.formatDate(),
            what: `${sp.short} left ${f.roost.label} light`,
            note: `${Math.round((1 - r) * 100)} per cent short of departure weight`
          });
          w.bus.emit('shorebirds:departed-light', {
            species: sp.name, where: f.roost.label,
            shortPct: Math.round((1 - r) * 100), birds: f.count,
            text: `${f.count} ${sp.short} left ${f.roost.label} ${Math.round((1 - r) * 100)} per cent `
              + 'short of the weight they need for the flight. Nobody will see what that costs.'
          });
        }
        f.count = Math.round(f.count * 0.04);       // a few immatures over-winter
        f.fat = 0.35;
      }
    }
    // Arrival, from about August. The birds that come back are the ones that survived the round
    // trip, so this year's flock is last year's departure condition arriving twelve months late.
    if (f.departed && (month >= 7 && month <= 10)) {
      // The curve says when the birds start turning up; the pool says how many there are. Scaling
      // the flock by the curve as well would quietly shave a slice off the population every year,
      // which is a decline nobody decided on.
      const curve = seasonal(sp.seasonal, w.clock);
      const target = curve > 0.14 ? f.pool : 0;
      if (target > f.count) {
        const came = Math.min(target - f.count, Math.max(1, Math.round(f.pool * 0.05)));
        f.count += came;
        if (f.count >= f.pool) {
          f.count = f.pool;
          f.departed = false;
          arriveLog.push({ day: w.clock.formatDate(), species: sp.short, roost: f.roost.id, arrived: f.count });
          if (arriveLog.length > 60) arriveLog.shift();
        }
      }
    }
  }

  /** Resident demography, once a year: chicks off the nest against adult losses. */
  function stepResidents(w) {
    for (const sp of SPECIES) {
      if (!sp.resident) continue;
      const mine = flocks.filter((f) => f.sp === sp);
      const total = mine.reduce((s2, f) => s2 + f.count, 0);
      if (!total) continue;
      const success = hatchRing.total / Math.max(1, hatchRing.total + nestLostRing.total);
      // Adult survival is high for these birds; the population moves on whether the chicks got off
      // the beach, which is the number the dog rules and the beach closures actually change.
      // Territorial birds are limited by beach, not by chicks: there are only so many stretches of
      // open sand on this island and a pair holds one. Without the ceiling a good run of nesting
      // seasons breeds an island of oystercatchers.
      const ceiling = sp.islandCount * 1.6;
      const growth = 0.86 + 0.26 * success * clamp(1 - total / ceiling, 0, 1);
      const next = clamp(Math.round(total * growth), 2, Math.round(ceiling));
      const scale = next / total;
      for (const f of mine) f.count = Math.max(0, Math.round(f.count * scale));
    }
  }

  /* ---------------------------------------------------------------- nests */

  function stepNests(w, month) {
    const dogs = dogPressure(w, 1);
    const foxControl = L.level('feral-and-weed-control');
    const beachClose = L.level('beach-driving-seasonal-closures');
    const wardens = L.level('ranger-program-funding');
    const tide = w.read('tide');
    const wx = w.read('weather');

    // New nests, in the months the pack gives for each species.
    for (const sp of SPECIES) {
      if (!sp.nests || !sp.nestMonths.includes(month)) continue;
      const pairs = Math.max(1, Math.round(sp.islandCount / (sp.colonial ? 6 : 2)));
      if (rng.float() < pairs * 0.004) {
        const r = roosts[(rng.float() * roosts.length) | 0];
        nests.push({
          sp: sp.id, name: sp.name, roost: r.id, where: r.label,
          laid: absDay(w.clock), eggs: sp.colonial ? 2 : sp.short === 'oystercatcher' ? 2 : 1,
          openness: r.openness, vehicles: r.vehicles
        });
      }
    }

    for (let i = nests.length - 1; i >= 0; i--) {
      const n = nests[i];
      const age = absDay(w.clock) - n.laid;
      let lost = null;
      // Dogs and people on the beach. A nest on open sand is a scrape: nobody sees it until it is
      // stepped on, and a fenced nest area is one of the cheapest things on this island to do.
      const fenced = clamp(0.2 + 0.6 * wardens, 0, 0.9);
      if (rng.float() < 0.0032 * dogs.roaming * n.openness * (1 - fenced) / 40) lost = 'dog';
      else if (n.vehicles && rng.float() < 0.010 * (1 - 0.7 * beachClose)) lost = 'vehicle';
      else if (rng.float() < 0.006 * (1 - 0.88 * foxControl)) lost = 'fox';
      else if (tide && wx && tide.height > 2.0 && wx.swellM > 2.4 && rng.float() < 0.18) lost = 'tide';
      else if (rng.float() < 0.0035 * n.openness * (1 - fenced)) lost = 'people';

      if (lost) {
        lostTo[lost]++;
        nestLostRing.add(1);
        nests.splice(i, 1);
        log.push({ day: w.clock.formatDate(), what: `${n.name} nest lost to ${lost === 'people' ? 'a person walking through' : 'a ' + lost}`, where: n.where });
        continue;
      }
      if (age > 30) {
        hatchRing.add(n.eggs);
        nests.splice(i, 1);
        log.push({ day: w.clock.formatDate(), what: `${n.name} chicks off the nest`, where: n.where });
      }
    }
    state.nests = {
      active: nests.length,
      hatched365: Math.round(hatchRing.total),
      lost365: Math.round(nestLostRing.total),
      lostTo: { ...lostTo }
    };
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'shorebirds',
    phase: 'ecology',
    order: 50,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      // The instruments these birds are listed under live in data/ecology.json, on the process
      // record, so the words stay in the pack. Read defensively: an older pack has no such block
      // and the system runs exactly as it did before.
      const proc = ((w.data && w.data.ecology && w.data.ecology.processes) || [])
        .find((p) => p && p.id === 'proc-shorebird-disturbance');
      state.protection = (proc && proc.the_instruments_over_it) || null;
      if (!state.protection) {
        notes.push('data/ecology.json proc-shorebird-disturbance carries no the_instruments_over_it block, '
          + 'so this system publishes no protection record and the civic treaty layer will say so.');
      }
      // The player arrives in September, when the birds are coming back. Set the flocks to what
      // the season says rather than to zero, so the first day is the island as it would be.
      for (const f of flocks) {
        if (!f.sp.migrant) continue;
        f.count = Math.round(f.pool * seasonal(f.sp.seasonal, w.clock));
        f.departed = f.count < f.pool * 0.9;
        f.fat = 0.32;
      }
      lastDay = absDay(w.clock);
      dailyPass(w);
      publish(w);
      notes.push(`${roosts.length} roosts placed from data/places.json over ${Math.round(flatsTotalHa)} ha `
        + 'of intertidal flat, measured off the island heightfield on the bay side.');
      notes.push(state.islandShareBasis);
      notes.push('The per-flush energy cost is a modelling choice. The pack says the mechanism is well '
        + 'established and that a per-flush figure was not located, and to calibrate it against the '
        + 'departure weight requirement, which is what is done here.');
      notes.push(FLYWAY.basis);
      notes.push(CHARACTER.note);
      w.bus.emit('shorebirds:ready', { roosts: roosts.length, flocks: flocks.length });
    },

    tick(w) {
      if (!state.ready) return;
      tickBirds(w);
      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      state.disturbanceToday = 0;
      disturbRing.roll(); roostFlushRing.roll(); fuelLostRing.roll(); hatchRing.roll(); nestLostRing.roll();
      for (const ring of flushSourceRings.values()) ring.roll();
      dailyPass(w);
      publish(w);
    },

    describe(w) {
      const by = {};
      for (const sp of SPECIES) {
        by[sp.short] = Math.round(flocks.filter((f) => f.sp === sp).reduce((s, f) => s + f.count, 0));
      }
      return {
        onIsland: state.onIslandNow,
        by,
        fat: state.meanFat,
        phase: state.tidePhase,
        flatsHa: state.flatsExposedHa,
        roostFlushes365: state.roostFlushes365,
        birdFlushes365: state.disturbance365,
        fuelDays: state.fuelLostToDisturbanceDays,
        nests: state.nests.active,
        hatched365: state.nests.hatched365,
        nestsLost365: state.nests.lost365,
        lastDeparture: departLog.length ? departLog[departLog.length - 1] : null,
        // The Article 3.2 indicator, so a headless run can be read for it without a browser.
        character: state.characterIndex,
        characterAbundance: state.characterParts.abundance,
        characterCondition: state.characterParts.condition
      };
    },

    save() {
      return {
        droneRule,
        flocks: flocks.map((f) => ({ sp: f.sp.id, roost: f.roost.id, count: f.count, pool: f.pool, fat: f.fat, departed: f.departed, departFat: f.departFat })),
        nests: nests.slice(),
        lostTo: { ...lostTo },
        roosts: roosts.map((r) => ({ id: r.id, flushes365: r.flushes365 })),
        disturb: disturbRing.save(), roostFlush: roostFlushRing.save(), fuel: fuelLostRing.save(),
        hatch: hatchRing.save(), nestLost: nestLostRing.save(),
        log: log.save(), departLog: departLog.slice(-20), arriveLog: arriveLog.slice(-20),
        // The character indicator's working state. Without the baseline a loaded game would take
        // its own degraded peak as the island it started from, and the indicator would read 1.0
        // over a collapse, which is the exact failure this whole layer exists to catch.
        character: {
          peak: Array.from(peakRing), peakCursor, peakFilled, baselinePeak,
          seasonReadySum, seasonReadyN, lastSeasonReadiness, lastSeasonBankedDay,
          sources: FLUSH_SOURCES.map((k) => [k, flushSourceRings.get(k).save()])
        }
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      droneRule = s.droneRule || 0;
      for (const r0 of s.flocks || []) {
        const f = flocks.find((x) => x.sp.id === r0.sp && x.roost.id === r0.roost);
        if (f) Object.assign(f, { count: r0.count, pool: r0.pool, fat: r0.fat, departed: r0.departed, departFat: r0.departFat });
      }
      nests = (s.nests || []).slice();
      Object.assign(lostTo, s.lostTo || {});
      for (const r0 of s.roosts || []) {
        const r = roosts.find((x) => x.id === r0.id);
        if (r) r.flushes365 = r0.flushes365;
      }
      disturbRing.load(s.disturb); roostFlushRing.load(s.roostFlush); fuelLostRing.load(s.fuel);
      hatchRing.load(s.hatch); nestLostRing.load(s.nestLost);
      log.load(s.log);
      const c = s.character;
      if (c) {
        if (Array.isArray(c.peak)) peakRing.set(c.peak.slice(0, 365));
        peakCursor = c.peakCursor || 0;
        peakFilled = c.peakFilled || 0;
        baselinePeak = c.baselinePeak || 0;
        seasonReadySum = c.seasonReadySum || 0;
        seasonReadyN = c.seasonReadyN || 0;
        lastSeasonReadiness = c.lastSeasonReadiness != null ? c.lastSeasonReadiness : null;
        lastSeasonBankedDay = c.lastSeasonBankedDay != null ? c.lastSeasonBankedDay : -1;
        for (const [k, saved] of c.sources || []) {
          const ring = flushSourceRings.get(k);
          if (ring) ring.load(saved);
        }
      }
      publishCharacter(null);
      publish(w);
    }
  });

  function publish(w) {
    state.bySpecies = SPECIES.map((sp) => {
      const mine = flocks.filter((f) => f.sp === sp);
      const count = mine.reduce((s, f) => s + f.count, 0);
      const fat = count ? mine.reduce((s, f) => s + f.fat * f.count, 0) / count : 0;
      return {
        id: sp.id, name: sp.name, status: sp.status,
        migrant: !!sp.migrant,
        count: Math.round(count),
        peakSeason: sp.peak,
        fat: +fat.toFixed(3),
        readyToLeave: sp.migrant ? +clamp(fat / sp.departFatNeeded, 0, 1.2).toFixed(2) : null,
        bayCount: sp.bayCount,
        islandShare: sp.islandShare,
        flightKm: sp.flightKm || null,
        note: sp.note
      };
    });
    state.roosts = roosts.map((r) => {
      const here = flocks.filter((f) => f.roost === r);
      const count = here.reduce((s, f) => s + f.count, 0);
      const P = r.pressureNow || { people: 0, dog: 0, vehicle: 0, drone: 0, total: 0 };
      return {
        id: r.id, label: r.label,
        x: Math.round(r.x), z: Math.round(r.z),
        birds: Math.round(count),
        openness: r.openness,
        flushes365: Math.round(r.flushes365),
        pressureNow: {
          people: +P.people.toFixed(3), dogs: +P.dog.toFixed(3),
          vehicles: +P.vehicle.toFixed(3), drones: +P.drone.toFixed(4)
        },
        worstSource: P.dog > P.people && P.dog > P.vehicle ? 'dogs'
          : P.vehicle > P.people ? 'vehicles' : 'people on foot'
      };
    });
    state.departures = departLog.slice(-6).reverse();
    state.arrivals = arriveLog.slice(-6).reverse();
    state.events = log.recent(6);
    state.levers = L.snapshot(['off-lead-area-review', 'dog-control-enforcement',
      'beach-driving-seasonal-closures', 'beach-camping-permit-numbers', 'ranger-program-funding',
      'feral-and-weed-control']);
    const migrants = state.bySpecies.filter((s) => s.migrant);
    const readiness = migrants.length
      ? migrants.reduce((s, x) => s + (x.readyToLeave || 0), 0) / migrants.length : 0;
    state.civicMetrics = {
      // Higher is worse for this one, which is how data/civic.json defines it.
      shorebird_disturbance: metric(clamp(roostFlushRing.total / 3600, 0, 1)),
      shorebird_condition: metric(clamp(readiness, 0, 1)),
      shorebird_nest_success: metric(hatchRing.total / Math.max(1, hatchRing.total + nestLostRing.total))
    };
  }
}
