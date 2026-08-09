// Water. The island is the reservoir, and most of what it holds goes somewhere else.
//
// Minjerribah is a sand mass, and sand holds water the way nothing else on this coast does. The
// townships are off the South East Queensland Water Grid entirely: bulk water is drawn from bores
// and treated at small local plants. That is data/civic.json metrics.water_security, sourced to
// council's own On Tap material, and it is one of the few high-confidence facts in this file.
//
// The number that changes how you read the island is in data/subterranean.json island_context:
//
//   "About 20 megalitres a day has been pumped from the island aquifer to the mainland since a
//    pipeline was built in 1996, reported as up to 60 per cent of the Redlands supply, though an
//    October 2024 figure puts the mainland and southern Moreton Bay islands share at 40 per cent.
//    Island community use is about 1.6 megalitres a day. Eight Olympic pools a day leave; the
//    community runs on well under one."
//
// data/ecology.json proc-groundwater carries the same figures and attaches a warning to them that
// this file repeats every time it publishes them: the numbers come from secondary reporting, one
// quoted licence figure was clearly garbled at source, the Seqwater drought response plan could not
// be text-extracted, and they are to be treated as placeholders. They are carried here with that
// label attached and they are never presented as measured.
//
// WHAT THIS FILE OWNS AND WHAT IT DOES NOT
//
// The aquifer itself belongs to src/systems/ecology/lakes.js, which models the store, the recharge,
// the window lakes and the wallum frogs, and it does that well. This file is everything above the
// bore: how much the townships actually ask for, hour by hour, whether the small plants can treat
// it, whether the reservoirs hold enough to get through a Sunday afternoon, and what happens at the
// tap when they do not. It reads the lakes system for the state of the store and never writes to it.
//
// FAILURE MODES A PLAYER CAUSES AND THEN LIVES WITH
//   1. The long weekend. Demand on the busiest day of the year runs close to three times the
//      quietest. The plants are sized for something between the two and the reservoirs are a day
//      and a half of buffer, so the third day of an Easter is when Point Lookout loses pressure.
//      Point Lookout goes first because it is the highest ground on the island and the water has to
//      be lifted to it, which is a fact about the terrain and not a choice made in this file.
//   2. Shedding the water plant. power.js lets the player set the load shedding order. Put the
//      treatment plant below the shops and the power comes back in four hours and the water does
//      not, because the reservoirs kept delivering while the plant was off and nothing refilled
//      them. Run them low enough and the network draws unchlorinated water, which is a boil-water
//      notice, which is a fortnight of bottled water arriving on the barge.
//   3. The wet peak. The Point Lookout plant is rated at 1,600 kilolitres a day, published, and it
//      was built with room. Room is not the same as room in a week when the island is full and
//      three days of rain is getting into the sewers through every cracked joint in it. When inflow
//      beats the plant, what leaves is not treated, and it leaves on the ocean side of the dune.
//   4. Septic. Parts of all three townships are on septic systems over a shallow water table beside
//      the bay. That is council's own description, in data/civic.json sewer-network-extension. It
//      is not an event. It is a slow number that the nearshore water quality metric carries whether
//      anybody looks at it or not.
//
// Determinism: world.rng.stream('water'). No Math.random, no Date.now.

import {
  clamp, levers, servedPopulation, townships, townshipShares, nudge,
  pools, hoursMinutes, Rolling, EventLog, TICK_HOURS, BASIS
} from './infra-common.js';

/* ------------------------------------------------------------------ the take

Both figures are the packs' own and both are flagged, by those packs, as placeholders. They are
carried whole rather than rounded off, so a reader can trace them back. */

const TAKE = {
  townshipMlDay: { value: 1.6, confidence: 'low', source: 'data/ecology.json proc-groundwater' },
  mainlandMlDay: { value: 20, confidence: 'low', source: 'data/subterranean.json island_context' },
  shareOfRedlandsSupply: { value: 0.6, qualifier: 'up to', confidence: 'low' },
  shareOct2024: { value: 0.4, note: 'mainland and southern Moreton Bay islands combined', confidence: 'low' },
  pipelineSince: 1996,
  warning: 'PLACEHOLDER. These figures come from secondary reporting. One quoted licence number was '
    + 'clearly garbled at source and the Seqwater North Stradbroke Island Drought Response Plan '
    + 'could not be text-extracted. data/ecology.json says in its own words to check all of them '
    + 'before any reaches a player.'
};

/**
 * The water reserves, which are a fact rather than a placeholder and which change what the argument
 * about extraction is actually about. From data/civic.json borefield-monitoring.
 */
const WATER_RESERVES = {
  totalMl: 61190,
  established: 'December 2023',
  holder: 'the Quandamooka People',
  from: 'water previously allocated to sand mining',
  split: 'even, between environmental and cultural use and economic use and rehabilitation',
  source: 'qld-water-reserves-2023',
  confidence: 'high'
};

/* ------------------------------------------------------------------ demand

Litres a person a day. Modelled. No metered consumption figure for this island is published in any
pack read here, and there is no point pretending otherwise, so these are chosen to land the island's
average on the pack's 1.6 megalitres a day at the population and visitor numbers the rest of the
simulation produces.

A visitor uses more than a resident, which surprises people. It should not: a visitor showers after
the beach, runs a load of towels, fills a holiday house that has been empty for three weeks, and has
no reason to think about it. A resident on a bore-fed island thinks about it constantly. */

const RESIDENT_L_DAY = 265;
const STAYING_L_DAY = 330;       // a holiday house: four showers, a load of towels, the hose
const DAY_L_DAY = 45;            // a public toilet, a shower at the surf club, a tap
const EVENT_L_DAY = 22;          // a festival crowd on site for a day: taps, toilets, wash-down
const COMMERCIAL_KL_DAY = 200;   // the pub, the resorts, the two supermarkets, the laundries
const IRRIGATION_KL_DAY = 130;   // the two ovals, the pool, the parks, street trees
const LOSS_SHARE = 0.14;         // leakage and unaccounted water in an old reticulation network

/** Where the day's water goes. Normalised to a mean of one at load. Two hard peaks, and the
 *  evening one is showers, which is why restricting sprinklers does less than people expect. */
const HOUR_SHAPE = [
  0.30, 0.22, 0.18, 0.17, 0.20, 0.38, 0.85, 1.55, 1.80, 1.45, 1.15, 1.05,
  1.10, 1.00, 0.95, 1.00, 1.20, 1.60, 1.85, 1.70, 1.30, 0.95, 0.62, 0.40
];
(function normalise() {
  let s = 0;
  for (const v of HOUR_SHAPE) s += v;
  const mean = s / 24;
  for (let i = 0; i < 24; i++) HOUR_SHAPE[i] /= mean;
})();

/* ------------------------------------------------------------------ the works

Plants, reservoirs and bore groups. Every capacity here is modelled. The one published number in
this block is the Point Lookout wastewater plant, and it is published precisely: rebuilt for
A$13.5 million, opened 25 November 2016, rated at 1,600 kilolitres a day, replacing a plant over
thirty years old, and built for more than twice the peak Christmas flow at the time.
(data/civic.json metrics.wastewater_capacity, source rcc-plwwtp-2016, confidence high.) */

const PLANTS = [
  {
    id: 'wtp-dunwich', label: 'Dunwich water treatment', township: 'dunwich',
    capacityKlDay: 1800, energyKwhPerMl: 620, basis: BASIS.modelled
  },
  {
    // More energy a megalitre than Dunwich, and the reason is the terrain: this one lifts.
    id: 'wtp-point-lookout', label: 'Point Lookout water treatment', township: 'point-lookout',
    capacityKlDay: 1200, energyKwhPerMl: 980, basis: BASIS.modelled
  }
];

const RESERVOIRS = [
  { id: 'res-dunwich', label: 'Dunwich reservoir', township: 'dunwich', capacityKl: 1800 },
  { id: 'res-point-lookout', label: 'Point Lookout reservoir', township: 'point-lookout', capacityKl: 1600 },
  { id: 'res-amity', label: 'Amity Point reservoir', township: 'amity-point', capacityKl: 520 },
  { id: 'res-one-mile', label: 'One Mile reservoir', township: 'one-mile', capacityKl: 280 }
];

const BORES = [
  { id: 'bore-dunwich-group', label: 'Dunwich bore group', township: 'dunwich', yieldKlDay: 1650 },
  { id: 'bore-point-lookout-group', label: 'Point Lookout bore group', township: 'point-lookout', yieldKlDay: 1250 },
  { id: 'bore-amity-group', label: 'Amity Point bore group', township: 'amity-point', yieldKlDay: 520 }
];

/** The wastewater plant. The capacity is published; everything else about it is modelled. */
const WWTP = {
  id: 'wwtp-point-lookout',
  label: 'Point Lookout wastewater treatment plant',
  capacityKlDay: 1600,
  rebuiltA$: 13500000,
  opened: '25 November 2016',
  energyKwhPerMl: 900,
  source: 'rcc-plwwtp-2016',
  confidence: 'high',
  note: 'Rated 1,600 kilolitres a day, opened 25 November 2016 after a A$13.5 million rebuild, '
    + 'replacing a plant over thirty years old and built for more than twice the peak Christmas '
    + 'flow at the time. Capacity, cost and opening date are published. Everything else here is modelled.'
};

/** Share of each township on the sewer rather than on septic. Modelled, from the shape council's
 *  own program describes: a Point Lookout extension program, and a Dunwich project aimed at lifting
 *  connections above 75 per cent of properties from a base of 128 connected. */
const SEWERED_SHARE = { 'point-lookout': 0.72, dunwich: 0.58, 'amity-point': 0.30, 'one-mile': 0.35 };

/**
 * Restriction ladder. The labels are the ones Queensland uses. The trigger is the week's demand as
 * a share of what the plants can treat, not the level in the reservoirs, and that choice is the
 * whole argument of this file. A reservoir at a day and a half is not a crisis, it is a reservoir:
 * it is sized to ride a busy afternoon and it refills overnight. What is a crisis is a week where
 * the plants cannot keep ahead of the tap, and on this island that week arrives with the school
 * holidays and not with a drought. The aquifer under Minjerribah is enormous and it moves in years.
 * The pumps and the pipes move in hours, and they are what runs out.
 */
const RESTRICTIONS = [
  { level: 0, label: 'No restrictions', outdoorCut: 0, trigger: 0 },
  { level: 1, label: 'Permanent conservation measures', outdoorCut: 0.15, trigger: 0.72 },
  { level: 2, label: 'Water restrictions', outdoorCut: 0.45, trigger: 0.85 },
  { level: 3, label: 'High level restrictions', outdoorCut: 0.75, trigger: 0.95 },
  { level: 4, label: 'Emergency restrictions', outdoorCut: 0.92, trigger: 1.05 }
];

export function registerWater(world) {
  const rng = world.rng.stream('water');
  const L = levers(world);
  const log = new EventLog(30);

  const state = world.publish('water', {
    ready: false,
    basis: 'The townships being off the water grid and drawing from bores treated at small local '
      + 'plants is published (data/civic.json). The Point Lookout wastewater plant capacity, cost '
      + 'and opening date are published. Every extraction figure is a placeholder the source pack '
      + 'says to check. Plant capacities, reservoir volumes, per-person use and leakage are modelled.',

    take: {
      townshipMlDay: 0,
      mainlandMlDay: 0,
      totalMlDay: 0,
      townshipPools: 0, mainlandPools: 0,
      published: TAKE,
      reserves: WATER_RESERVES,
      sentence: ''
    },

    demand: {
      totalKlDay: 0, nowKlDay: 0,
      residentsKl: 0, visitorsKl: 0, eventKl: 0, commercialKl: 0, irrigationKl: 0, lossKl: 0,
      perPersonL: 0, peakDayKlDay: 0, quietDayKlDay: 0, peakToQuietRatio: 0,
      byTownship: {}
    },

    treatment: {
      plants: [], capacityKlDay: 0, producedKlDay: 0, running: true,
      poweredShare: 1, bypassing: false, outageMinutes: 0
    },

    storage: {
      reservoirs: [], totalKl: 0, capacityKl: 0, pct: 0,
      hoursOfSupply: 0, hoursLabel: '', fallingFor: 0
    },

    pressure: { byTownship: {}, lowest: null, anyLow: false, outages: [] },

    restrictions: { level: 0, label: 'No restrictions', outdoorCut: 0, sinceDay: null, daysThisYear: 0,
      pressure: 0, pressureNote: 'the week\'s demand as a share of what the plants can treat' },

    boilWater: { on: false, sinceDay: null, reason: null, daysThisYear: 0, townships: [] },

    wastewater: {
      plant: WWTP.label, capacityKlDay: WWTP.capacityKlDay, inflowKlDay: 0, headroomPct: 0,
      infiltrationKlDay: 0, sewerShare: 0, septicDwellings: 0,
      overflowing: false, overflowKlToday: 0, overflowEvents365: 0,
      septicLoadIndex: 0, nearshoreIndex: 0, source: WWTP.source, note: WWTP.note
    },

    powerKw: 0,
    aquifer: { waterTableIndex: 0.5, stress: 0, drought: false, connected: false, note: '' },
    events: [],
    notes: []
  });

  /* -------------------------------------------------------------- runtime */

  const notes = state.notes;
  const plants = PLANTS.map((p) => ({ ...p, running: true, producedKlDay: 0, powered: true }));
  const reservoirs = RESERVOIRS.map((r) => ({ ...r, kl: r.capacityKl * 0.86, fallingTicks: 0 }));
  const resByTownship = new Map(reservoirs.map((r) => [r.township, r]));
  const bores = BORES.map((b) => ({ ...b, online: true, offlineDaysLeft: 0, reason: null }));

  let lastDay = -1;
  let restrictionLevel = 0;
  let restrictionSinceDay = null;
  let restrictionDaysYear = 0;
  let boilWaterOn = false, boilWaterSince = null, boilWaterReason = null, boilWaterDaysYear = 0;
  let boilWaterTownships = [];
  let treatmentOutageMinutes = 0;
  let overflowKlToday = 0;
  let overflowEvents = new Rolling(365);
  let dayOverflowEvent = 0;
  let peakDay = 0, quietDay = 1e9;
  let dayDemandKl = 0;
  const demand365 = new Rolling(365);
  const demand7 = new Rolling(7);
  const lowPressureMinutes = new Rolling(365);
  let dayLowPressureMinutes = 0;
  let septicLoad = 0.5;
  let exportOverride = null;
  let pressureOutage = null;

  world.bus.on('ui:intent', (p) => {
    if (!p || typeof p.kind !== 'string') return;
    if (p.kind === 'water:restrict' && Number.isFinite(p.level)) {
      setRestriction(world, clamp(Math.round(p.level), 0, 4), 'set by the player');
    } else if (p.kind === 'water:export' && Number.isFinite(p.share)) {
      // lakes.js owns the aquifer response to this. Held here too so the read model agrees with
      // what the player set, rather than reporting the published placeholder back at them.
      exportOverride = clamp(p.share, 0, 2.5);
    }
  });

  /* -------------------------------------------------------------- demand */

  function computeDemand(w) {
    const pop = servedPopulation(w);
    const shares = townshipShares(w);
    const wx = w.read('weather');
    const rule = RESTRICTIONS[restrictionLevel];

    // Hot dry weather lifts everything: gardens, showers, and the outdoor tap nobody turns off.
    const temp = wx ? wx.tempC : 22;
    const dryDays = wx ? clamp(1 - wx.rainWeek / 30, 0, 1) : 0.5;
    const heat = 1 + clamp((temp - 24) / 14, 0, 0.55) * (0.4 + 0.6 * dryDays);

    // Recycled water takes the ovals and the dust suppression off the drinking supply entirely.
    // It looks like the big win and it is not, and that is the lesson: the peak is showers.
    const recycled = L.level('recycled-water-scheme');
    const irrigation = IRRIGATION_KL_DAY * heat * (1 - 0.85 * recycled) * (1 - rule.outdoorCut);

    // Restrictions bind on gardens and on residents. They do not bind on a holiday house full of
    // people who arrived yesterday, and data/civic.json says so in its own side effect: they are
    // "read as exactly what they are".
    const residentsKl = (pop.residents * RESIDENT_L_DAY / 1000) * (1 - rule.outdoorCut * 0.28) * heat;
    const visitorsKl = ((pop.staying * STAYING_L_DAY + pop.day * DAY_L_DAY) / 1000)
      * (1 - rule.outdoorCut * 0.06) * heat;
    const eventKl = pop.event * EVENT_L_DAY / 1000;
    const commercialKl = COMMERCIAL_KL_DAY * (0.75 + 0.35 * clamp(pop.pressure, 0, 2));

    const beforeLoss = residentsKl + visitorsKl + eventKl + commercialKl + irrigation;
    // Leakage is a share of what is put into the network, and it does not fall when demand does.
    // The sewer extension program digs up the same streets, so it finds and fixes mains as it goes.
    const lossShare = LOSS_SHARE * (1 - 0.25 * L.level('sewer-network-extension'));
    const lossKl = beforeLoss * lossShare / (1 - lossShare);
    const totalKl = beforeLoss + lossKl;

    const byTownship = {};
    for (const t of townships(w)) {
      const p = pop.byTownship[t.id] || { residents: 0, visitors: 0, event: 0, total: 0 };
      const share = pop.total > 0 ? p.total / pop.total : shares[t.id];
      byTownship[t.id] = +(totalKl * share).toFixed(1);
    }

    return {
      totalKl, residentsKl, visitorsKl, eventKl, commercialKl, irrigation, lossKl, byTownship, pop,
      nowKlDay: totalKl * HOUR_SHAPE[w.clock.hour]
    };
  }

  /* -------------------------------------------------------------- treatment and storage */

  function stepStorage(w, d) {
    // Which plants have power. power.js publishes the blocks it has shed; the water plant is on
    // that list and the player set the order.
    const pw = w.read('power');
    const shedIds = new Set();
    if (pw && pw.shedding && pw.shedding.on) {
      for (const b of pw.shedding.blocks || []) shedIds.add(b.id);
    }
    const waterShed = shedIds.has('water-treatment-dunwich');
    let poweredPlants = 0;
    for (const p of plants) {
      p.powered = !waterShed;
      if (p.powered) poweredPlants++;
    }
    state.treatment.poweredShare = plants.length ? poweredPlants / plants.length : 1;
    if (!poweredPlants) treatmentOutageMinutes += 10;
    else treatmentOutageMinutes = 0;

    // How much the bores can lift. The store is huge and slow, so this is nearly always one; it
    // moves when the lakes system says the water table is low, which takes years, not weeks.
    const lakes = w.read('lakes');
    const wt = lakes && Number.isFinite(lakes.waterTableIndex) ? lakes.waterTableIndex : 0.5;
    const boreFactor = clamp(0.6 + 0.8 * wt, 0.5, 1.05);

    let boreYield = 0;
    for (const b of bores) {
      if (!b.online) continue;
      boreYield += b.yieldKlDay * boreFactor;
    }

    // Production is limited by the bores, by the plants, and by how much room there is in the
    // reservoirs. A plant does not make water it cannot put anywhere.
    let capacity = 0;
    for (const p of plants) if (p.powered) capacity += p.capacityKlDay;
    let room = 0;
    for (const r of reservoirs) room += Math.max(0, r.capacityKl - r.kl);
    const wantKl = Math.min(boreYield, capacity, (room / TICK_HOURS) * 1.2 + d.nowKlDay);
    const producedKlDay = Math.max(0, wantKl);

    // Fill the reservoirs in proportion to how empty they are, which is what a control system that
    // is trying to keep everything above a trigger level actually does.
    const producedKl = producedKlDay * (TICK_HOURS / 24);
    let deficitTotal = 0;
    for (const r of reservoirs) deficitTotal += Math.max(0, r.capacityKl - r.kl);
    if (deficitTotal > 0) {
      for (const r of reservoirs) {
        const d0 = Math.max(0, r.capacityKl - r.kl);
        r.kl = Math.min(r.capacityKl, r.kl + producedKl * (d0 / deficitTotal));
      }
    }

    // Draw. Each township draws from its own reservoir; One Mile and Amity Point are fed through
    // Dunwich when their own is empty, because they are on the same low ground.
    const drawKl = d.nowKlDay * (TICK_HOURS / 24);
    let unmet = 0;
    for (const t of townships(w)) {
      const r = resByTownship.get(t.id);
      const share = d.totalKl > 0 ? (d.byTownship[t.id] || 0) / d.totalKl : 0.25;
      let want = drawKl * share;
      if (!r) { unmet += want; continue; }
      const take = Math.min(r.kl, want);
      r.kl -= take;
      want -= take;
      if (want > 0 && (t.id === 'one-mile' || t.id === 'amity-point')) {
        const dun = resByTownship.get('dunwich');
        if (dun) {
          const spill = Math.min(dun.kl, want);
          dun.kl -= spill;
          want -= spill;
        }
      }
      unmet += want;
    }

    return { producedKlDay, boreYield, capacity, unmet, drawKl, waterShed };
  }

  /* -------------------------------------------------------------- pressure

  Head, not volume. A reservoir at a quarter still has water in it; whether that water reaches a tap
  in a house on the headland depends on how far it has to be lifted. Point Lookout sits on the
  island's only rock and it is the highest township on it, so it is the first place a low reservoir
  is felt and the last place it comes back. This is read straight off world.island. */

  function computePressure(w, s) {
    const out = {};
    let lowest = null;
    let anyLow = false;
    for (const t of townships(w)) {
      const r = resByTownship.get(t.id) || resByTownship.get('dunwich');
      const fill = r ? r.kl / r.capacityKl : 0;
      // Ground height above mean sea level at the township, in metres. The reservoir has to beat it.
      const liftM = Math.max(0, t.groundM - w.island.seaLevel);
      // A modelled service head: full reservoir gives 55 m of head at the low ground, less the lift.
      const headM = 55 * clamp(fill * 1.25, 0, 1) - liftM * 0.55;
      const ok = headM > 18;
      const low = headM > 6 && headM <= 18;
      out[t.id] = {
        headM: +headM.toFixed(1), liftM: +liftM.toFixed(1), fillPct: +(fill * 100).toFixed(0),
        state: ok ? 'normal' : low ? 'low' : 'out',
        note: ok ? '' : `The water has to be lifted ${liftM.toFixed(0)} m to get here.`
      };
      if (!ok) anyLow = true;
      if (!lowest || headM < out[lowest].headM) lowest = t.id;
    }
    if (s.unmet > 0.01) anyLow = true;
    return { byTownship: out, lowest, anyLow };
  }

  /* -------------------------------------------------------------- wastewater */

  function stepWastewater(w, d) {
    const wx = w.read('weather');
    const shares = townshipShares(w);
    const sewerLever = L.level('sewer-network-extension');

    // Indoor water comes back as sewage. Gardens do not.
    const indoorKl = d.residentsKl * 0.82 + d.visitorsKl * 0.80 + d.commercialKl * 0.7 + d.eventKl * 0.6;
    let sewered = 0;
    for (const t of townships(w)) {
      const base = SEWERED_SHARE[t.id] ?? 0.4;
      const share = clamp(base + (1 - base) * sewerLever * 0.6, 0, 0.98);
      sewered += share * (shares[t.id] || 0);
    }
    // The Point Lookout plant only takes Point Lookout's flow. Dunwich and Amity have their own
    // arrangements that this file does not claim to know, so what is modelled here is the plant
    // that is published, and the rest is carried as a septic and on-site load.
    const plShare = shares['point-lookout'] || 0.4;
    const plSewered = clamp((SEWERED_SHARE['point-lookout'] + (1 - SEWERED_SHARE['point-lookout']) * sewerLever * 0.6), 0, 0.98);
    const dryFlowKl = indoorKl * plShare * plSewered;

    // Infiltration. Every old gravity sewer takes groundwater and stormwater in through its joints,
    // and on a sand island with a shallow water table it takes a lot. This is what turns a wet week
    // in a full January into an overflow, and it is why the published capacity headroom is not the
    // headroom you have.
    const rainMmHr = wx ? wx.rainMmHr : 0;
    const lakes = w.read('lakes');
    const wt = lakes && Number.isFinite(lakes.waterTableIndex) ? lakes.waterTableIndex : 0.5;
    const infiltration = (rainMmHr * 75 + wt * 200) * (1 - 0.35 * sewerLever);
    const inflowKlDay = dryFlowKl + infiltration;

    const pw = w.read('power');
    const shedIds = new Set();
    if (pw && pw.shedding && pw.shedding.on) for (const b of pw.shedding.blocks || []) shedIds.add(b.id);
    const plantPowered = !shedIds.has('wwtp-point-lookout');
    const capacity = plantPowered ? WWTP.capacityKlDay : 0;

    let overflow = 0;
    if (inflowKlDay > capacity) {
      overflow = (inflowKlDay - capacity) * (TICK_HOURS / 24);
      overflowKlToday += overflow;
    }

    // Septic. A slow load that rises when the water table is high, because a trench in wet sand
    // does not absorb. It is the part of this problem nobody sees and it never has an event.
    const septicShare = 1 - sewered;
    const targetSeptic = clamp(septicShare * (0.6 + 0.8 * wt), 0, 1);
    septicLoad += (targetSeptic - septicLoad) * 0.004;

    return { inflowKlDay, capacity, overflow, sewered, septicShare, infiltration, plantPowered };
  }

  /* -------------------------------------------------------------- restrictions and notices */

  function setRestriction(w, level, reason) {
    if (level === restrictionLevel) return;
    const up = level > restrictionLevel;
    restrictionLevel = level;
    restrictionSinceDay = w.clock.dayIndex;
    const rule = RESTRICTIONS[level];
    log.push({
      day: w.clock.dayIndex, kind: 'restrictions',
      text: `${rule.label}${level > 0 ? '' : ' lifted'}: ${reason}.`
    });
    w.bus.emit('water:restrictions', { level, label: rule.label, reason });
    if (up && level >= 2) {
      // The pack's own side effect, in its own words: restrictions that bind on residents and not
      // on visitor accommodation are read as exactly what they are.
      nudge(w, 'consultation_trust', -0.06,
        'restrictions that bind on gardens and not on holiday houses', 'infrastructure/water.js', 220);
      nudge(w, 'resident_amenity', -0.05, rule.label, 'infrastructure/water.js', 150);
    }
  }

  function setBoilWater(w, on, reason, towns) {
    if (on === boilWaterOn) return;
    boilWaterOn = on;
    boilWaterSince = on ? w.clock.dayIndex : null;
    boilWaterReason = on ? reason : null;
    boilWaterTownships = on ? towns.slice() : [];
    log.push({
      day: w.clock.dayIndex, kind: on ? 'boil-water' : 'boil-water-lifted',
      text: on
        ? `Boil water notice for ${towns.join(', ')}: ${reason}. Every kettle on the island and a `
          + 'pallet of bottled water on the next barge.'
        : 'The boil water notice has been lifted.'
    });
    w.bus.emit(on ? 'water:boil-notice' : 'water:boil-notice-lifted', { reason, townships: towns.slice() });
    if (on) {
      nudge(w, 'water_security', -0.18, 'boil water notice: ' + reason, 'infrastructure/water.js', 260);
      nudge(w, 'resident_amenity', -0.10, 'boil water notice', 'infrastructure/water.js', 180);
    }
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'water',
    phase: 'infrastructure',
    order: 20,

    init(w) {
      const t = townships(w);
      const pl = t.find((x) => x.id === 'point-lookout');
      if (pl && pl.found) {
        notes.push(`Point Lookout sits ${Math.max(0, pl.groundM - w.island.seaLevel).toFixed(0)} m above sea level `
          + 'on the island\'s only rock, so the water has to be lifted to it and it loses pressure first. '
          + 'That height is measured off the heightfield, not asserted.');
      }
      notes.push(TAKE.warning);
      notes.push('The aquifer itself is modelled in src/systems/ecology/lakes.js. This file is '
        + 'everything above the bore and reads that system rather than running a second aquifer.');
      if (!w.read('lakes')) {
        notes.push('The lakes system is not loaded, so bore yield is running at its modelled '
          + 'baseline and does not respond to the state of the store.');
      }
      state.take.published = TAKE;
      state.ready = true;
    },

    tick(w) {
      const day = w.clock.dayIndex;
      if (day !== lastDay) {
        if (lastDay >= 0) {
          demand365.push(dayDemandKl);
          demand7.push(dayDemandKl);
          overflowEvents.push(dayOverflowEvent);
          lowPressureMinutes.push(dayLowPressureMinutes);
          if (dayDemandKl > peakDay) peakDay = dayDemandKl;
          if (dayDemandKl < quietDay && dayDemandKl > 0) quietDay = dayDemandKl;
          if (restrictionLevel > 0) restrictionDaysYear++;
          if (boilWaterOn) boilWaterDaysYear++;
          if (overflowKlToday > 5) {
            // A discharge is not a number in a report. It is on the ocean side of the dune, and the
            // beach in front of it is the one everybody swims at.
            nudge(w, 'water_quality_nearshore', -clamp(overflowKlToday / 4000, 0.02, 0.16),
              `${Math.round(overflowKlToday)} kL of untreated flow left the plant`, 'infrastructure/water.js', 200);
            w.bus.emit('water:overflow', { kl: Math.round(overflowKlToday), plant: WWTP.label });
            log.push({
              day, kind: 'overflow',
              text: `${Math.round(overflowKlToday)} kL past the plant at Point Lookout. It went out on `
                + 'the ocean side, which is the side people swim on.'
            });
          }
        }
        overflowKlToday = 0; dayOverflowEvent = 0; dayDemandKl = 0; dayLowPressureMinutes = 0;
        lastDay = day;
        dailyWorks(w);
      }

      const d = computeDemand(w);
      const s = stepStorage(w, d);
      const p = computePressure(w, s);
      const ww = stepWastewater(w, d);

      dayDemandKl += d.nowKlDay * (TICK_HOURS / 24);
      if (ww.overflow > 0) dayOverflowEvent = 1;
      if (p.anyLow) dayLowPressureMinutes += 10;

      // A network that has been running on an empty reservoir is a network drawing whatever the
      // bores put in without it passing a plant properly. That is a boil water notice.
      const emptiest = reservoirs.reduce((a, b) => (b.kl / b.capacityKl < a.kl / a.capacityKl ? b : a));
      const criticallyLow = emptiest.kl / emptiest.capacityKl < 0.06;
      if (!boilWaterOn && (treatmentOutageMinutes > 360 || (criticallyLow && s.unmet > 0.5))) {
        setBoilWater(w, true,
          treatmentOutageMinutes > 360 ? 'the treatment plant was without power for six hours'
            : 'the reservoirs ran to the bottom and the network drew untreated water',
          [emptiest.township]);
      }
      if (boilWaterOn && treatmentOutageMinutes === 0 && !criticallyLow
        && w.clock.dayIndex - (boilWaterSince ?? 0) >= 3) {
        setBoilWater(w, false, null, []);
      }

      publish(w, d, s, p, ww);
    },

    describe(w) {
      return {
        demandKlDay: Math.round(state.demand.totalKlDay),
        takeMlDay: +state.take.totalMlDay.toFixed(1),
        producedKlDay: Math.round(state.treatment.producedKlDay),
        storagePct: Math.round(state.storage.pct),
        hoursOfSupply: +state.storage.hoursOfSupply.toFixed(1),
        lowest: state.pressure.lowest,
        pressure: state.pressure.lowest ? state.pressure.byTownship[state.pressure.lowest].state : 'normal',
        restrictions: state.restrictions.level,
        boilWater: state.boilWater.on,
        wwInflowKlDay: Math.round(state.wastewater.inflowKlDay),
        wwHeadroomPct: Math.round(state.wastewater.headroomPct),
        overflow365: Math.round(state.wastewater.overflowEvents365),
        powerKw: Math.round(state.powerKw)
      };
    },

    save() {
      return {
        reservoirs: reservoirs.map((r) => ({ id: r.id, kl: r.kl })),
        bores: bores.map((b) => ({ id: b.id, online: b.online, offlineDaysLeft: b.offlineDaysLeft, reason: b.reason })),
        restrictionLevel, restrictionSinceDay, restrictionDaysYear,
        boilWaterOn, boilWaterSince, boilWaterReason, boilWaterDaysYear, boilWaterTownships: boilWaterTownships.slice(),
        treatmentOutageMinutes, overflowKlToday, septicLoad, exportOverride,
        peakDay, quietDay, lastDay, dayDemandKl,
        rings: {
          demand365: demand365.save(), demand7: demand7.save(), overflowEvents: overflowEvents.save(),
          lowPressureMinutes: lowPressureMinutes.save()
        }
      };
    },

    load(w, s) {
      if (!s) return;
      for (const row of s.reservoirs || []) {
        const r = reservoirs.find((x) => x.id === row.id);
        if (r) r.kl = row.kl;
      }
      for (const row of s.bores || []) {
        const b = bores.find((x) => x.id === row.id);
        if (b) Object.assign(b, row);
      }
      restrictionLevel = s.restrictionLevel ?? 0;
      restrictionSinceDay = s.restrictionSinceDay ?? null;
      restrictionDaysYear = s.restrictionDaysYear ?? 0;
      boilWaterOn = !!s.boilWaterOn;
      boilWaterSince = s.boilWaterSince ?? null;
      boilWaterReason = s.boilWaterReason ?? null;
      boilWaterDaysYear = s.boilWaterDaysYear ?? 0;
      boilWaterTownships = Array.isArray(s.boilWaterTownships) ? s.boilWaterTownships.slice() : [];
      treatmentOutageMinutes = s.treatmentOutageMinutes ?? 0;
      overflowKlToday = s.overflowKlToday ?? 0;
      septicLoad = s.septicLoad ?? septicLoad;
      exportOverride = s.exportOverride ?? null;
      peakDay = s.peakDay ?? 0;
      quietDay = s.quietDay ?? 1e9;
      lastDay = s.lastDay ?? -1;
      dayDemandKl = s.dayDemandKl ?? 0;
      const r = s.rings || {};
      demand365.load(r.demand365); demand7.load(r.demand7);
      overflowEvents.load(r.overflowEvents); lowPressureMinutes.load(r.lowPressureMinutes);
    }
  });

  /* -------------------------------------------------------------- daily works */

  function dailyWorks(w) {
    // Where the restriction ladder sits: the week's demand against what the plants can treat. A
    // player who does nothing gets restrictions when the island is full, not when the aquifer is
    // low, which is the honest answer. This island's water problem is a peak problem.
    let capacity = 0;
    for (const p of plants) capacity += p.capacityKlDay;
    const weekMean = demand7.filled > 1 ? demand7.mean : (demand365.filled > 1 ? demand365.mean : 1400);
    const pressure = weekMean / Math.max(1, capacity);
    let want = 0;
    for (let i = RESTRICTIONS.length - 1; i >= 1; i--) {
      if (pressure >= RESTRICTIONS[i].trigger) { want = i; break; }
    }
    // Hysteresis, so the island is not putting restrictions on and taking them off every Tuesday.
    // Restrictions go on the day the number says and come off a fortnight after it stops saying it.
    if (want < restrictionLevel && w.clock.dayIndex - (restrictionSinceDay ?? -99) < 14) want = restrictionLevel;

    // The civic lever, if the player has pulled it, sets a floor under the restriction level
    // through the peak weeks and nothing else.
    const peakLever = L.level('peak-water-restrictions');
    const peakish = w.clock.isQldSchoolHoliday || w.clock.isWeekend;
    if (peakLever > 0.5 && peakish) want = Math.max(want, 1);
    if (want !== restrictionLevel) {
      setRestriction(w, want, want > restrictionLevel
        ? `the week is running at ${Math.round(pressure * 100)} per cent of what the plants can treat`
        : `the week is back to ${Math.round(pressure * 100)} per cent of treatment capacity`);
    }
    state.restrictions.pressure = +pressure.toFixed(3);

    // A bore that is offline comes back when the work is done. Bores go offline for one of two
    // reasons on this island: a septic field too close to a headworks, and the tip.
    for (const b of bores) {
      if (b.online) continue;
      b.offlineDaysLeft -= 1;
      if (b.offlineDaysLeft <= 0) {
        b.online = true; b.reason = null;
        log.push({ day: w.clock.dayIndex, kind: 'bore-back', text: `${b.label} is back in service.` });
      }
    }
    // Contamination risk rises with the septic load and with how wet the ground is. Monitoring does
    // not stop it: it finds it earlier, which is the whole argument in the borefield-monitoring
    // lever and is exactly what that lever's effects say.
    const monitoring = L.level('borefield-monitoring');
    const risk = clamp(septicLoad * 0.0016 * (1 - 0.4 * monitoring), 0, 0.01);
    for (const b of bores) {
      if (!b.online) continue;
      if (rng.float() < risk) {
        b.online = false;
        b.offlineDaysLeft = rng.range(9, 40);
        b.reason = 'a sample came back with coliforms and the bore is off until it clears';
        log.push({
          day: w.clock.dayIndex, kind: 'bore-off',
          text: `${b.label} is off: ${b.reason}. ${monitoring > 0.5 ? 'The monitoring found it early.' : 'Nobody was watching for it.'}`
        });
        w.bus.emit('water:bore-offline', { bore: b.id, label: b.label, days: Math.round(b.offlineDaysLeft) });
        nudge(w, 'water_security', -0.08, `${b.label} offline`, 'infrastructure/water.js', 150);
      }
    }

    if (w.clock.dayOfYear === 1) { restrictionDaysYear = 0; boilWaterDaysYear = 0; }
  }

  /* -------------------------------------------------------------- read model */

  function publish(w, d, s, p, ww) {
    const lakes = w.read('lakes');
    const exportShare = exportOverride ?? 1;
    const townshipMl = d.totalKl / 1000;
    const mainlandMl = TAKE.mainlandMlDay.value * exportShare;

    state.take.townshipMlDay = +townshipMl.toFixed(2);
    state.take.mainlandMlDay = +mainlandMl.toFixed(1);
    state.take.totalMlDay = +(townshipMl + mainlandMl).toFixed(1);
    state.take.townshipPools = pools(townshipMl);
    state.take.mainlandPools = pools(mainlandMl);
    state.take.sentence = `${pools(mainlandMl)} Olympic pools a day leave the island for the mainland. `
      + `The three townships run on ${pools(townshipMl)} of one. The mainland figure is a placeholder `
      + 'and the pack that carries it says so.';

    state.demand.totalKlDay = d.totalKl;
    state.demand.nowKlDay = d.nowKlDay;
    state.demand.residentsKl = +d.residentsKl.toFixed(1);
    state.demand.visitorsKl = +d.visitorsKl.toFixed(1);
    state.demand.eventKl = +d.eventKl.toFixed(1);
    state.demand.commercialKl = +d.commercialKl.toFixed(1);
    state.demand.irrigationKl = +d.irrigation.toFixed(1);
    state.demand.lossKl = +d.lossKl.toFixed(1);
    state.demand.perPersonL = d.pop.total > 0 ? +(d.totalKl * 1000 / d.pop.total).toFixed(0) : 0;
    state.demand.byTownship = d.byTownship;
    state.demand.peakDayKlDay = Math.round(peakDay);
    state.demand.quietDayKlDay = quietDay < 1e9 ? Math.round(quietDay) : 0;
    state.demand.peakToQuietRatio = quietDay < 1e9 && quietDay > 0 ? +(peakDay / quietDay).toFixed(2) : 0;

    state.treatment.plants = plants.map((x) => ({
      id: x.id, label: x.label, capacityKlDay: x.capacityKlDay, powered: x.powered, basis: x.basis
    }));
    state.treatment.capacityKlDay = s.capacity;
    state.treatment.producedKlDay = s.producedKlDay;
    state.treatment.running = s.capacity > 0;
    state.treatment.bypassing = boilWaterOn;
    state.treatment.outageMinutes = treatmentOutageMinutes;

    let stored = 0, cap = 0;
    state.storage.reservoirs = reservoirs.map((r) => {
      stored += r.kl; cap += r.capacityKl;
      return { id: r.id, label: r.label, kl: Math.round(r.kl), capacityKl: r.capacityKl, pct: +(r.kl / r.capacityKl * 100).toFixed(0) };
    });
    state.storage.totalKl = Math.round(stored);
    state.storage.capacityKl = cap;
    state.storage.pct = cap > 0 ? (stored / cap) * 100 : 0;
    // Hours of supply is measured against today's whole-day rate, not against the draw at this
    // instant. Measured at four in the morning the instantaneous rate says four days of water,
    // and by ten o'clock the same reservoir says twelve hours. The daily rate is the honest one.
    const usePerDay = Math.max(1, d.totalKl);
    state.storage.hoursOfSupply = (stored / usePerDay) * 24;
    state.storage.hoursLabel = hoursMinutes(state.storage.hoursOfSupply);

    state.pressure.byTownship = p.byTownship;
    state.pressure.lowest = p.lowest;
    state.pressure.anyLow = p.anyLow;

    const rule = RESTRICTIONS[restrictionLevel];
    state.restrictions.level = restrictionLevel;
    state.restrictions.label = rule.label;
    state.restrictions.outdoorCut = rule.outdoorCut;
    state.restrictions.sinceDay = restrictionSinceDay;
    state.restrictions.daysThisYear = restrictionDaysYear;

    state.boilWater.on = boilWaterOn;
    state.boilWater.sinceDay = boilWaterSince;
    state.boilWater.reason = boilWaterReason;
    state.boilWater.daysThisYear = boilWaterDaysYear;
    state.boilWater.townships = boilWaterTownships;

    state.wastewater.inflowKlDay = ww.inflowKlDay;
    state.wastewater.capacityKlDay = ww.capacity;
    state.wastewater.headroomPct = WWTP.capacityKlDay > 0
      ? clamp((1 - ww.inflowKlDay / WWTP.capacityKlDay) * 100, -200, 100) : 0;
    state.wastewater.infiltrationKlDay = +ww.infiltration.toFixed(0);
    state.wastewater.sewerShare = +ww.sewered.toFixed(3);
    state.wastewater.septicDwellings = Math.round(((w.read('population')?.dwellings?.total) || 1900) * ww.septicShare);
    state.wastewater.overflowing = ww.overflow > 0;
    state.wastewater.overflowKlToday = Math.round(overflowKlToday);
    state.wastewater.overflowEvents365 = overflowEvents.total;
    state.wastewater.septicLoadIndex = +septicLoad.toFixed(3);
    state.wastewater.nearshoreIndex = +clamp(1 - septicLoad * 0.5 - clamp(overflowEvents.total / 30, 0, 0.4), 0, 1).toFixed(3);

    // What the works draw, in kilowatts. power.js reads this one tick behind, and it is the number
    // that decides whether the water plant is worth keeping on when the island is short. Energy
    // intensity is in kilowatt-hours a megalitre, so a megalitre a day is that many kWh over 24 h.
    let kw = 0;
    for (const x of plants) {
      if (x.powered) kw += ((s.producedKlDay / plants.length) / 1000) * x.energyKwhPerMl / 24;
    }
    kw += ww.plantPowered ? (ww.inflowKlDay / 1000) * WWTP.energyKwhPerMl / 24 : 0;
    kw += 26;  // sewer pump stations and the reticulation boosters, modelled
    state.powerKw = kw;

    state.aquifer.connected = !!lakes;
    state.aquifer.waterTableIndex = lakes && Number.isFinite(lakes.waterTableIndex) ? lakes.waterTableIndex : 0.5;
    state.aquifer.stress = lakes && Number.isFinite(lakes.aquiferStress) ? lakes.aquiferStress : 0;
    state.aquifer.drought = !!(lakes && lakes.drought);
    state.aquifer.note = lakes
      ? 'The store is modelled in the lakes system. It moves in years, not weeks, which is why the '
        + 'island\'s water problem shows up as a busy Sunday and not as a drought.'
      : 'The lakes system is not loaded, so nothing here responds to the state of the store.';

    state.events = log.recent(8);
  }
}
