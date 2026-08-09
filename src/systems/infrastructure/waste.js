// Waste. There is no hole in the ground. There is a boat.
//
// data/events.json rhythms.waste-transfer-rhythm puts it better than a comment can:
//
//   "Everything the island throws away is handled at the North Stradbroke Island Recycling and
//    Waste Centre at Dunwich and then leaves by barge. That is the whole story of waste on this
//    island: there is no landfill capacity to grow into, only barge slots. Peak weekends and
//    holiday periods generate volume faster than the barge schedule removes it, and the shortfall
//    sits on the island until it can go."
//
// And then it gives the instruction this file is built to:
//
//   "Model waste as a stock with an outflow limited by barge slots, not as a rate that clears
//    itself. That single choice makes every event in this pack cost something real."
//
// So that is what this is. Rubbish is a stock in a yard at Dunwich. The only way out is a skip on a
// vehicle deck that visitors' cars also want, on a boat that does not run in a gale, and the yard
// is small. Every mechanic in this file falls out of those four sentences.
//
// THE HONEST PART ABOUT RECYCLING
//
// The island has no materials recovery facility and never will: a sorting line needs a catchment of
// hundreds of thousands of people and this one has about two thousand. So a comingled recycling
// load does not get recycled here. It gets put in a skip, barged across, trucked to a mainland
// facility and sorted there, and the island pays freight on every kilogram of it. That means two
// things a player finds out the hard way. A light, bulky, half-empty recycling skip costs the same
// to cross as a full one, so below a certain tonnage a run of recycling costs more than it saves.
// And a load that arrives contaminated is rejected at the gate and goes to landfill anyway, so the
// island pays the freight twice and gets nothing. Sorting bays fix the second one. Nothing fixes
// the first except volume, and volume is the one thing the island does not have.
//
// This is not a criticism of anybody. It is arithmetic, and it is why the levers in
// data/civic.json for this issue are about mulching green waste here, repairing things here and
// changing how often the barge runs, rather than about building a recycling plant.
//
// FAILURE MODES A PLAYER CAUSES AND THEN LIVES WITH
//   1. Cutting barge runs to save money. The saving is immediate and visible in the budget. The
//      cost arrives in the second week of January with three weeks of school holidays still to run
//      and a yard that is already full.
//   2. Charging commercial loads more. data/civic.json commercial-waste-charging carries its own
//      side effect: "Every dollar on a commercial load is a dollar of temptation to dump it in the
//      bush instead." Put the gate fee up and the illegal dumping index follows it.
//   3. Mulching green waste on the island. It is the right answer for tonnage and it builds a pile.
//      data/civic.json green-waste-mulched-on-island: "A green waste pile in a fire-prone landscape
//      is a fuel load with a fence around it." In a dry spring, that pile is on the fire system's books.
//   4. Shedding power to the waste centre. It closes. The bins keep filling.
//
// Tonnage constants are taken from src/systems/civic/budget.js so the island does not carry two
// different answers to how much rubbish it makes: 0.52 tonnes a resident a year and 1.4 kilograms
// a visitor a day, both modelled, both labelled as modelled there and here.
//
// Determinism: world.rng.stream('waste'). No Math.random, no Date.now.

import {
  clamp, levers, servedPopulation, nudge, aud,
  crossing, Rolling, EventLog, TICK_DAYS, BASIS
} from './infra-common.js';

/** The facility. Real, named in data/businesses.json as a council waste facility at Dunwich. */
const CENTRE = {
  id: 'nsi-recycling-and-waste-centre',
  name: 'North Stradbroke Island Recycling and Waste Centre',
  township: 'dunwich',
  free: 'Non-commercial residential use by island residents is free. Commercial users and '
    + 'non-residents pay. (data/civic.json transfer-station-upgrade)',
  hoursNote: 'Opening hours are published for the facility but were not verified in the packs, so '
    + 'no hours are stated here.',
  source: 'data/businesses.json nsi-recycling-and-waste-centre; data/events.json waste-transfer-rhythm'
};

/* ------------------------------------------------------------------ generation */

const RESIDENT_T_YEAR = 0.52;      // modelled, matching src/systems/civic/budget.js
/**
 * budget.js uses a flat 1.4 kg a visitor a day. That is the right average and the wrong shape: a
 * family in a holiday house fills a wheelie bin over a week and a day tripper leaves a coffee cup
 * and a chip packet. Split around the same mean so the two systems agree on the year and disagree
 * usefully about a Sunday.
 */
const STAYING_KG_DAY = 1.9;
const DAY_KG_DAY = 0.7;
const EVENT_KG_PERSON = 0.9;       // a day on a festival site: cups, plates, packaging

/**
 * Where a tonne of island rubbish goes when it is sorted, and how heavy a cubic metre of it is.
 * Density is the number that decides which stream fills the yard first, and it is why green waste
 * and cardboard are the problem and why a skip of concrete never is.
 */
const STREAMS = [
  { id: 'residual', label: 'General waste', share: 0.50, tPerM3: 0.20, gateA$: 0, recoverA$: 0, recyclable: false },
  { id: 'comingled', label: 'Comingled recycling', share: 0.20, tPerM3: 0.07, gateA$: 0, recoverA$: 55, recyclable: true },
  { id: 'green', label: 'Green waste', share: 0.14, tPerM3: 0.22, gateA$: 0, recoverA$: 18, recyclable: true },
  { id: 'metal', label: 'Scrap metal', share: 0.05, tPerM3: 0.55, gateA$: 0, recoverA$: 210, recyclable: true },
  { id: 'cnd', label: 'Construction and demolition', share: 0.09, tPerM3: 0.95, gateA$: 62, recoverA$: 0, recyclable: false },
  { id: 'hazardous', label: 'E-waste, oil, batteries and chemicals', share: 0.02, tPerM3: 0.35, gateA$: 0, recoverA$: 0, recyclable: true }
];

/* ------------------------------------------------------------------ the yard and the boat

Every number in this block is modelled. data/events.json says in its own notes that this is the
largest unfilled gap in the pack: "No public data on the waste removal schedule, tonnage, barge slot
allocation or the facility's capacity was found." So these are chosen to make the constraint behave
the way the pack describes, and they are labelled, and they are not a claim about the real yard. */

const YARD = {
  bays: 14,                 // skip bays on the hardstand
  skipM3: 30,               // a hook-lift bin
  basis: BASIS.modelled
};

const BARGE = {
  runsPerWeekBase: 6,       // modelled
  skipsPerRun: 2,           // a prime mover and a dog trailer takes two
  laneMetresPerRun: 19,     // a semi-trailer combination, from data/transport.json services note
  costPerRunA$: 1450,       // modelled: the commercial vehicle crossing plus mainland haulage
  basis: BASIS.modelled
};

/** Modelled, matching budget.js: the variable cost of getting a tonne to a mainland landfill. */
const COST_PER_TONNE_A$ = 221;

/**
 * How far past its bay capacity the yard can be stacked before the gate physically cannot take
 * another load. Modelled. Past this the collection truck has nowhere to tip and the bins stay on
 * the kerb, which is the consequence a resident notices and the one worth modelling.
 */
const OVERSTACK_LIMIT = 1.8;

/** Weight of one household bin at a weekly collection. Modelled, and only used to turn a tonnage
 *  nobody can picture into a number of bins that were not emptied, which anybody can. */
const BIN_KG = 14;

/** Above this contamination, a mainland facility rejects the load and it goes to landfill.
 *  A quarter is the rule of thumb a materials recovery facility works to. Modelled. */
const CONTAMINATION_REJECT = 0.25;

/**
 * Whether a skip of recycling is worth putting on the boat, worked out rather than asserted.
 *
 * A skip costs the same to cross whether it is full of steel or full of milk bottles, and comingled
 * recycling loose in a bin runs about seventy kilograms a cubic metre. So a thirty cubic metre skip
 * of it weighs about two tonnes, and two tonnes of mixed plastic and paper is worth a hundred-odd
 * dollars at a mainland gate plus whatever landfill charge it avoids. Against half the cost of a
 * barge run, it does not quite pay. That is the whole argument, and it is the reason the levers in
 * data/civic.json for this issue are about mulching here and repairing here rather than about
 * building a recycling plant that would need a catchment a hundred times this island's.
 *
 * The transfer station upgrade changes the arithmetic, because the pack's own description of that
 * lever is "better sorting bays and a proper hardstand at the island recycling and waste centre, so
 * a load gets separated instead of all going in the one bin". A hardstand takes a compactor, a
 * compactor raises the density, and density is the only variable in this sum the island controls.
 */
function recyclingEconomics(stream, tonnes, contaminated) {
  const freightA$ = BARGE.costPerRunA$ / BARGE.skipsPerRun;
  const gateValueA$ = contaminated ? 0 : tonnes * stream.recoverA$;
  const landfillAvoidedA$ = contaminated ? 0 : tonnes * COST_PER_TONNE_A$;
  const disposalIfRejectedA$ = contaminated ? tonnes * COST_PER_TONNE_A$ : 0;
  const net = gateValueA$ + landfillAvoidedA$ - freightA$ - disposalIfRejectedA$;
  return { freightA$, gateValueA$, landfillAvoidedA$, disposalIfRejectedA$, netA$: net, worthIt: net > 0 };
}

export function registerWaste(world) {
  const rng = world.rng.stream('waste');
  const L = levers(world);
  const log = new EventLog(30);

  const state = world.publish('waste', {
    ready: false,
    facility: CENTRE,
    basis: 'The facility is real and named in data/businesses.json. The generation rates match '
      + 'src/systems/civic/budget.js and are modelled there and here. The yard capacity, the barge '
      + 'schedule, the skip counts and every cost are modelled: data/events.json records that no '
      + 'public data on any of them was found, and calls it the largest unfilled gap in the pack.',

    /** The number src/systems/civic/policy.js reads for its waste-flow coupling. */
    tonnesPerYear: 0,

    generatedTodayT: 0,
    generatedRolling365T: 0,
    byStream: {},
    perPersonKgDay: 0,

    yard: {
      bays: YARD.bays, skipsOnGround: 0, storedT: 0, storedM3: 0,
      pctFullByVolume: 0, closedToPublic: false, closedSinceDay: null, closedDaysThisYear: 0,
      overstackLimit: OVERSTACK_LIMIT, atPhysicalLimit: false
    },

    /** What the yard could not take. This is the number that is on the street. */
    kerbside: {
      tonnes: 0, binsNotEmptied: 0, binsNotEmptiedThisWeek: 0, weeksBehind: 0, since: null,
      note: 'When the yard is stacked to its limit the collection truck has nowhere to tip, so the '
        + 'bins are not emptied. Nothing about this is a modelling flourish: it is what a full '
        + 'transfer station on an island with no landfill actually produces.'
    },

    barge: {
      runsPerWeek: BARGE.runsPerWeekBase, runsThisWeek: 0, runsLostThisWeek: 0,
      skipsShippedToday: 0, tonnesShippedToday: 0, tonnesShippedRolling365: 0,
      backlogT: 0, backlogDays: 0, laneMetresToday: 0, surgeRuns: 0, surgeNote: '',
      note: 'Waste going out competes for deck space with visitors coming in, on the same sailings. '
        + '(data/events.json waste-transfer-rhythm)'
    },

    recycling: {
      divertedTodayT: 0, divertedRolling365T: 0, diversionPct: 0,
      contamination: 0, viable: true, rejectedLoads365: 0, rejectedRolling365T: 0,
      uneconomicRolling365T: 0, recoveredRolling365A$: 0,
      skipTonnes: 0, economics: null,
      why: '',
      note: 'There is no materials recovery facility on this island and no catchment for one. '
        + 'Recycling here means putting it on a boat and sorting it on the mainland, so the island '
        + 'pays freight on every kilogram of it whether it is recycled at the other end or not.'
    },

    green: {
      stockpileT: 0, mulchedRolling365T: 0, mulchingOnIsland: false,
      fuelLoadIndex: 0, note: ''
    },

    illegalDumping: { index: 0, reportsRolling30: 0, driver: '' },
    litterIndex: 0,

    cost: { todayA$: 0, rolling365A$: 0, perTonneA$: COST_PER_TONNE_A$, perDwellingYearA$: 0, recoveredA$: 0,
      note: 'Redland households were reported paying over A$600 a year for waste alone, across nine '
        + 'contractors, eight waste centres and island barge logistics. (data/civic.json, rbn-waste-bill). '
        + 'The council budget system books the island\'s waste accrual off its own model; the figures '
        + 'here are this system\'s view of the same thing and are not booked twice.' },

    powerKw: 0,
    events: [],
    notes: []
  });

  /* -------------------------------------------------------------- runtime */

  const notes = state.notes;
  /** One store per stream, in tonnes and cubic metres, sitting in the yard at Dunwich. */
  const store = new Map();
  for (const s of STREAMS) store.set(s.id, { ...s, t: s.share * 6, m3: 0, oldestDay: 0 });
  for (const s of store.values()) s.m3 = s.t / s.tPerM3;

  let lastDay = -1;
  let lastWeek = -1;
  let runsThisWeek = 0, runsLostThisWeek = 0;
  let closedToPublic = false, closedSinceDay = null, closedDaysYear = 0;
  let greenStockpileT = 0;
  /** Rubbish the yard could not take. It is on the kerb, in bins, outside somebody's house. */
  let kerbsideT = 0;
  let kerbsideAnnounced = false;
  let contamination = 0.14;
  let illegalDumping = 0.2;
  let litter = 0.3;
  let dayGeneratedT = 0, dayShippedT = 0, daySkips = 0, dayCostA$ = 0, dayRecoveredA$ = 0, dayLaneM = 0;
  let dayDiverted = 0;
  const generated365 = new Rolling(365);
  const shipped365 = new Rolling(365);
  const diverted365 = new Rolling(365);
  const cost365 = new Rolling(365);
  const recovered365 = new Rolling(365);
  const mulched365 = new Rolling(365);
  const rejected365 = new Rolling(365);
  const rejectedT365 = new Rolling(365);
  const uneconomic365 = new Rolling(365);
  const dumping30 = new Rolling(30);
  let dayRejected = 0, dayDumping = 0, dayMulchedT = 0, dayRejectedT = 0, dayUneconomicT = 0;
  let dayRefusedT = 0;
  const refused7 = new Rolling(7);
  let gateFeeMultiplier = 1;
  let backlogAnnounced = false;
  let pendingExtraRuns = 0;
  let runAccumulator = 0;
  let shippedOnDay = -1;
  let lastRejectLogDay = -99;
  /** True once the player has set the barge frequency by hand, after which the lever stops moving it. */
  let runsSetByPlayer = false;

  world.bus.on('ui:intent', (p) => {
    if (!p || typeof p.kind !== 'string' || !p.kind.startsWith('waste:')) return;
    if (p.kind === 'waste:barge-runs' && Number.isFinite(p.perWeek)) {
      state.barge.runsPerWeek = clamp(Math.round(p.perWeek), 0, 14);
      runsSetByPlayer = true;
    } else if (p.kind === 'waste:gate-fee' && Number.isFinite(p.multiplier)) {
      gateFeeMultiplier = clamp(p.multiplier, 0, 4);
    } else if (p.kind === 'waste:extra-run') {
      // An emergency run. It still needs a boat and a deck slot, so it is a request, not a result.
      pendingExtraRuns += 1;
    }
  });

  /* -------------------------------------------------------------- generation */

  function generate(w, dtDays) {
    const pop = servedPopulation(w);
    const cross = crossing(w);

    const residentT = pop.residents * RESIDENT_T_YEAR / 365 * dtDays;
    const visitorT = (pop.staying * STAYING_KG_DAY + pop.day * DAY_KG_DAY) / 1000 * dtDays;
    const eventT = pop.event * EVENT_KG_PERSON / 1000 * dtDays;
    // Building work. The island's builders lose December and January to the owners being in the
    // houses, which data/residents.json records, so construction waste has a hole in it exactly
    // where the household waste peaks. The two do not stack.
    const month = w.clock.month;
    const builderShutdown = (month === 11 && w.clock.dayOfMonth >= 18) || (month === 0 && w.clock.dayOfMonth <= 20);
    // The reuse and repair lever: things that would have been thrown out are not.
    const reuse = L.level('island-reuse-and-repair');
    const cndShare = STREAMS.find((s) => s.id === 'cnd').share;
    const constructionT = (builderShutdown ? 0.15 : 1) * 1.05 * dtDays * (1 - 0.09 * reuse);
    const householdT = (residentT + visitorT + eventT) * (1 - 0.09 * reuse);
    const total = householdT + constructionT;

    // Sorting. Construction waste is its own stream; everything else follows the shares.
    const byStream = {};
    for (const s of STREAMS) {
      byStream[s.id] = s.id === 'cnd' ? constructionT : householdT * (s.share / (1 - cndShare));
    }

    // Contamination in the recycling. It rises with the share of people on the island who have
    // never seen the island's bins before, and it falls with sorting bays at the transfer station.
    const upgrade = L.level('transfer-station-upgrade');
    const visitorShare = pop.total > 0 ? (pop.visitors + pop.event) / pop.total : 0;
    const target = clamp(0.085 + 0.24 * visitorShare - 0.075 * upgrade, 0.03, 0.42);
    contamination += (target - contamination) * 0.01;

    return { byStream, total, pop, cross };
  }

  /* -------------------------------------------------------------- the yard */

  function intoYard(w, g, dtDays) {
    // The waste centre closes when it has no power, and a closed centre does not stop the rubbish.
    const pw = w.read('power');
    let powered = true;
    if (pw && pw.shedding && pw.shedding.on) {
      for (const b of pw.shedding.blocks || []) if (b.id === 'waste-centre') powered = false;
    }

    // The physical ceiling. A yard can be over-stacked, and on a bad January it will be: skips
    // double-handled, bins on the hardstand, a bay of loose green waste where a bay of loose green
    // waste should not be. It cannot be over-stacked without limit, and what happens past the limit
    // is not a bigger number in a read model, it is the collection truck arriving at the gate with
    // nowhere to tip and driving away. The bins stay on the kerb. That is the endgame, and it is
    // the one a resident actually experiences, so it is modelled as bins rather than as tonnes.
    const capacityM3 = YARD.bays * YARD.skipM3;
    const hardCeilingM3 = capacityM3 * OVERSTACK_LIMIT;
    let inYardM3 = 0;
    for (const s of store.values()) inYardM3 += s.m3;
    const roomM3 = Math.max(0, hardCeilingM3 - inYardM3);

    const mulching = L.level('green-waste-mulched-on-island') > 0.4;
    let offeredM3 = 0;
    for (const s of STREAMS) offeredM3 += (g.byStream[s.id] || 0) / s.tPerM3;
    const acceptShare = offeredM3 > 0 ? clamp(roomM3 / offeredM3, 0, 1) : 1;

    for (const s of STREAMS) {
      const rec = store.get(s.id);
      let t = (g.byStream[s.id] || 0);
      const refused = t * (1 - acceptShare);
      if (refused > 0) { kerbsideT += refused; dayRefusedT += refused; }
      t *= acceptShare;
      if (s.id === 'green' && mulching) {
        // Chipped and composted here rather than barged. It comes off the export tonnage and it
        // goes onto a pile, and a pile in a fire landscape is a fuel load with a fence around it.
        const toPile = t * 0.85;
        greenStockpileT += toPile;
        dayMulchedT += toPile;
        t -= toPile;
      }
      rec.t += t;
      rec.m3 = rec.t / rec.tPerM3;
    }
    dayGeneratedT += g.total;

    // The mulch goes out to dune work, parks and gardens, slowly, and the pile draws down with it.
    if (greenStockpileT > 0) {
      const out = Math.min(greenStockpileT, 0.9 * dtDays);
      greenStockpileT -= out;
    }

    let storedT = 0, storedM3 = 0;
    for (const s of store.values()) { storedT += s.t; storedM3 += s.m3; }
    const full = storedM3 / capacityM3;

    // A yard that is full stops taking loads over the weighbridge. Household kerbside collection
    // keeps running because it has nowhere else to go, so the yard keeps filling and the public
    // gate is what closes. That is the order it happens in and it is the order that annoys people.
    if (!powered || full > 0.97) {
      if (!closedToPublic) {
        closedToPublic = true;
        closedSinceDay = w.clock.dayIndex;
        const why = !powered ? 'the centre has no power' : 'the yard is full and nothing has left for days';
        log.push({
          day: w.clock.dayIndex, kind: 'centre-closed',
          text: `${CENTRE.name} is closed to the public: ${why}.`
        });
        w.bus.emit('waste:centre-closed', { reason: why });
        nudge(w, 'resident_amenity', -0.05, 'the tip is shut and the trailer is still loaded',
          'infrastructure/waste.js', 90);
      }
    } else if (closedToPublic && full < 0.82 && powered) {
      closedToPublic = false;
      log.push({ day: w.clock.dayIndex, kind: 'centre-open', text: `${CENTRE.name} is open again.` });
      w.bus.emit('waste:centre-open', {});
      closedSinceDay = null;
    }

    return { storedT, storedM3, capacityM3, full, powered, kerbsideT };
  }

  /* -------------------------------------------------------------- the boat */

  function shipDaily(w) {
    const cross = crossing(w);
    const lever = L.level('waste-barge-frequency');
    // The pack has this lever in_place. In place means the current schedule, so the lever moves it
    // up from there rather than creating it. The player's own setting wins over both.
    const scheduled = state.barge.runsPerWeek;
    const perDay = scheduled / 7;
    // Whole runs, deterministically, by accumulating the fraction rather than rolling dice for it.
    runAccumulator += perDay + pendingExtraRuns;
    pendingExtraRuns = 0;
    let runs = Math.floor(runAccumulator);
    runAccumulator -= runs;

    if (!cross.running) {
      runsLostThisWeek += runs;
      if (runs > 0) {
        log.push({
          day: w.clock.dayIndex, kind: 'run-lost',
          text: `${runs} waste run${runs > 1 ? 's' : ''} lost: the crossing is ${cross.condition}. It stays here.`
        });
      }
      return { runs: 0, skips: 0, tonnes: 0, laneM: 0, costA$: 0, recoveredA$: 0, rejected: 0 };
    }

    let skips = 0, tonnes = 0, recoveredA$ = 0, rejected = 0;
    for (let r = 0; r < runs; r++) {
      // Fill the skips from the fullest streams first, which is what a yard operator does.
      const order = [...store.values()].sort((a, b) => (b.m3 - a.m3) || (a.id < b.id ? -1 : 1));
      for (let k = 0; k < BARGE.skipsPerRun; k++) {
        const s = order.find((x) => x.m3 > 1);
        if (!s) break;
        const takeM3 = Math.min(s.m3, YARD.skipM3);
        const takeT = takeM3 * s.tPerM3;
        s.m3 -= takeM3;
        s.t = Math.max(0, s.t - takeT);
        skips++;
        tonnes += takeT;

        if (s.recyclable) {
          const contaminated = s.id === 'comingled' && contamination > CONTAMINATION_REJECT;
          const econ = recyclingEconomics(s, takeT, contaminated);
          if (contaminated) {
            // Rejected at the mainland gate. It is buried there, and the island has paid the
            // freight to send it and pays the disposal to bury it. Nothing was recycled.
            rejected++;
            dayRejectedT += takeT;
          } else {
            // Diverted, whether or not the money worked out. Both are reported, because a diversion
            // rate that costs money is a real thing councils do and a player should see it as it is.
            dayDiverted += takeT;
            recoveredA$ += econ.gateValueA$;
            if (!econ.worthIt) dayUneconomicT += takeT;
          }
        }
      }
    }
    const laneM = runs * BARGE.laneMetresPerRun;
    const costA$ = runs * BARGE.costPerRunA$ + tonnes * COST_PER_TONNE_A$;
    return { runs, skips, tonnes, laneM, costA$, recoveredA$, rejected };
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'waste',
    phase: 'infrastructure',
    order: 30,

    init(w) {
      const b = (w.data.businesses && w.data.businesses.businesses || []).find((x) => x.id === CENTRE.id);
      if (!b) {
        notes.push('data/businesses.json has no record for the island recycling and waste centre, '
          + 'so the facility here is named from this file rather than from the pack.');
      }
      notes.push(CENTRE.free);
      notes.push('No public data on the waste removal schedule, tonnage, barge slot allocation or '
        + 'the facility\'s capacity was found for this island. data/events.json records that as the '
        + 'largest unfilled gap in the pack. Everything about the yard and the boat below is modelled.');
      notes.push('There is no materials recovery facility on this island and there is no catchment '
        + 'for one. Recycling here means putting it on a boat.');
      state.barge.runsPerWeek = BARGE.runsPerWeekBase;
      state.ready = true;
    },

    tick(w) {
      const day = w.clock.dayIndex;

      if (day !== lastDay) {
        if (lastDay >= 0) {
          generated365.push(dayGeneratedT);
          shipped365.push(dayShippedT);
          diverted365.push(dayDiverted);
          cost365.push(dayCostA$);
          recovered365.push(dayRecoveredA$);
          mulched365.push(dayMulchedT);
          rejected365.push(dayRejected);
          rejectedT365.push(dayRejectedT);
          uneconomic365.push(dayUneconomicT);
          refused7.push(dayRefusedT);
          dumping30.push(dayDumping);
          if (closedToPublic) closedDaysYear++;
        }
        dayGeneratedT = 0; dayShippedT = 0; daySkips = 0; dayCostA$ = 0; dayRecoveredA$ = 0;
        dayLaneM = 0; dayDiverted = 0; dayRejected = 0; dayDumping = 0; dayMulchedT = 0;
        dayRejectedT = 0; dayUneconomicT = 0; dayRefusedT = 0;
        lastDay = day;

        const week = Math.floor(day / 7);
        if (week !== lastWeek) { lastWeek = week; runsThisWeek = 0; runsLostThisWeek = 0; }

        dailyWorks(w);
      }

      // The skips go out mid-morning, not at midnight. That is not decoration: the crossing state
      // this reads is a running count of the day's sailings, and at one minute past midnight no
      // boat has run yet, so a midnight check reads every day as a day the barge did not go.
      if (w.clock.hour === 9 && w.clock.minuteOfDay % 60 === 0 && shippedOnDay !== day) {
        shippedOnDay = day;
        const ship = shipDaily(w);
        runsThisWeek += ship.runs;
        dayShippedT = ship.tonnes;
        daySkips = ship.skips;
        dayLaneM = ship.laneM;
        dayCostA$ = ship.costA$;
        dayRecoveredA$ = ship.recoveredA$;
        dayRejected = ship.rejected;
        if (ship.rejected > 0) {
          // Once a week while it keeps happening, rather than every morning. A player who has been
          // told six times has been told; a log that repeats itself is a log nobody reads.
          const quiet = day - lastRejectLogDay < 7;
          if (!quiet) {
            lastRejectLogDay = day;
            log.push({
              day, kind: 'load-rejected',
              text: `Recycling loads are being rejected at the mainland gate: `
                + `${Math.round(contamination * 100)} per cent contamination. They are barged across and buried. `
                + 'The island pays the freight and the disposal and recycles nothing.'
            });
            w.bus.emit('waste:load-rejected', { loads: ship.rejected, contamination: +contamination.toFixed(2) });
          }
        }
      }

      const g = generate(w, TICK_DAYS);
      const yard = intoYard(w, g, TICK_DAYS);
      publish(w, g, yard);
    },

    describe(w) {
      return {
        tonnesPerYear: Math.round(state.tonnesPerYear),
        generatedTodayT: +state.generatedTodayT.toFixed(2),
        yardPct: Math.round(state.yard.pctFullByVolume * 100),
        skipsOnGround: state.yard.skipsOnGround,
        closed: state.yard.closedToPublic,
        binsNotEmptied: state.kerbside.binsNotEmptied,
        runsPerWeek: state.barge.runsPerWeek,
        backlogDays: +state.barge.backlogDays.toFixed(1),
        diversionPct: Math.round(state.recycling.diversionPct * 100),
        contamination: +state.recycling.contamination.toFixed(2),
        viable: state.recycling.viable,
        rejected365: Math.round(state.recycling.rejectedLoads365),
        greenPileT: Math.round(state.green.stockpileT),
        dumping: +state.illegalDumping.index.toFixed(2),
        costYearA$: Math.round(state.cost.rolling365A$)
      };
    },

    save() {
      return {
        store: [...store.values()].map((s) => ({ id: s.id, t: s.t, m3: s.m3 })),
        runsPerWeek: state.barge.runsPerWeek, runsSetByPlayer, runAccumulator, runsThisWeek, runsLostThisWeek,
        shippedOnDay, lastRejectLogDay,
        closedToPublic, closedSinceDay, closedDaysYear,
        greenStockpileT, kerbsideT, kerbsideAnnounced, dayRefusedT, refused7: refused7.save(),
        contamination, illegalDumping, litter, gateFeeMultiplier,
        lastDay, lastWeek, pendingExtraRuns, backlogAnnounced,
        comingledDensity: (store.get('comingled') || {}).tPerM3,
        day: { dayGeneratedT, dayShippedT, daySkips, dayCostA$, dayRecoveredA$, dayLaneM, dayDiverted, dayRejected, dayDumping, dayMulchedT, dayRejectedT, dayUneconomicT },
        rings: {
          generated365: generated365.save(), shipped365: shipped365.save(), diverted365: diverted365.save(),
          cost365: cost365.save(), recovered365: recovered365.save(), mulched365: mulched365.save(),
          rejected365: rejected365.save(), rejectedT365: rejectedT365.save(),
          uneconomic365: uneconomic365.save(), dumping30: dumping30.save()
        }
      };
    },

    load(w, s) {
      if (!s) return;
      for (const row of s.store || []) {
        const rec = store.get(row.id);
        if (rec) { rec.t = row.t; rec.m3 = row.m3; }
      }
      state.barge.runsPerWeek = s.runsPerWeek ?? BARGE.runsPerWeekBase;
      runsSetByPlayer = !!s.runsSetByPlayer;
      runAccumulator = s.runAccumulator ?? 0;
      shippedOnDay = s.shippedOnDay ?? -1;
      lastRejectLogDay = s.lastRejectLogDay ?? -99;
      runsThisWeek = s.runsThisWeek ?? 0;
      runsLostThisWeek = s.runsLostThisWeek ?? 0;
      closedToPublic = !!s.closedToPublic;
      closedSinceDay = s.closedSinceDay ?? null;
      closedDaysYear = s.closedDaysYear ?? 0;
      greenStockpileT = s.greenStockpileT ?? 0;
      kerbsideT = s.kerbsideT ?? 0;
      kerbsideAnnounced = !!s.kerbsideAnnounced;
      dayRefusedT = s.dayRefusedT ?? 0;
      refused7.load(s.refused7);
      contamination = s.contamination ?? contamination;
      illegalDumping = s.illegalDumping ?? illegalDumping;
      litter = s.litter ?? litter;
      gateFeeMultiplier = s.gateFeeMultiplier ?? 1;
      lastDay = s.lastDay ?? -1;
      lastWeek = s.lastWeek ?? -1;
      pendingExtraRuns = s.pendingExtraRuns ?? 0;
      backlogAnnounced = !!s.backlogAnnounced;
      const dd = s.day || {};
      dayGeneratedT = dd.dayGeneratedT ?? 0; dayShippedT = dd.dayShippedT ?? 0;
      daySkips = dd.daySkips ?? 0; dayCostA$ = dd.dayCostA$ ?? 0;
      dayRecoveredA$ = dd.dayRecoveredA$ ?? 0; dayLaneM = dd.dayLaneM ?? 0;
      dayDiverted = dd.dayDiverted ?? 0; dayRejected = dd.dayRejected ?? 0;
      dayDumping = dd.dayDumping ?? 0; dayMulchedT = dd.dayMulchedT ?? 0;
      dayRejectedT = dd.dayRejectedT ?? 0; dayUneconomicT = dd.dayUneconomicT ?? 0;
      const com = store.get('comingled');
      if (com && Number.isFinite(s.comingledDensity)) com.tPerM3 = s.comingledDensity;
      const r = s.rings || {};
      generated365.load(r.generated365); shipped365.load(r.shipped365); diverted365.load(r.diverted365);
      cost365.load(r.cost365); recovered365.load(r.recovered365); mulched365.load(r.mulched365);
      rejected365.load(r.rejected365); rejectedT365.load(r.rejectedT365);
      uneconomic365.load(r.uneconomic365); dumping30.load(r.dumping30);
    }
  });

  /* -------------------------------------------------------------- daily works */

  function dailyWorks(w) {
    const day = w.clock.dayIndex;

    // Density of the comingled stream. Loose in a bin it runs about seventy kilograms a cubic
    // metre, which is why a skip of it weighs two tonnes and costs the same to cross as a skip of
    // steel. A proper hardstand takes a compactor, and a compactor is the only lever the island has
    // on that number: data/civic.json transfer-station-upgrade asks for exactly that hardstand.
    const upgrade = L.level('transfer-station-upgrade');
    const com = store.get('comingled');
    if (com) com.tPerM3 = 0.07 + 0.055 * upgrade;

    // A summary of what is on the ground right now, computed here rather than passed in, so this
    // pass reads the yard after the morning's barge run and not before it.
    let storedT = 0, storedM3 = 0;
    for (const s of store.values()) { storedT += s.t; storedM3 += s.m3; }
    const yard = { storedT, storedM3, full: storedM3 / (YARD.bays * YARD.skipM3) };

    // How often the boat goes.
    //
    // The pack has waste-barge-frequency in_place, which means the current schedule exists rather
    // than that it is switched on, so the lever moves it up from the base rather than creating it.
    //
    // On top of that there is an operational response, because a council watching a yard fill in
    // January does not sit on its hands until the next budget: it books extra movements and pays
    // for them. That response is modelled here so the island a player has not touched works, which
    // matters, because an island that has a rubbish crisis every Christmas no matter what anybody
    // does teaches nothing. The moment a player sets the schedule by hand the response stops and
    // their number stands. That is the point. The cost of capping the runs is the yard, and it
    // should be the player's yard rather than the simulation's.
    if (!runsSetByPlayer) {
      const base = BARGE.runsPerWeekBase * (1 + 0.5 * (L.level('waste-barge-frequency') - 1));
      const surge = Math.ceil(clamp((yard.full - 0.45) * 14, 0, 8));
      state.barge.runsPerWeek = clamp(Math.round(base + surge), 0, 16);
      state.barge.surgeRuns = surge;
      state.barge.surgeNote = surge > 0
        ? `${surge} extra movements a week booked because the yard is at ${Math.round(yard.full * 100)} `
          + `per cent. About ${aud(surge * BARGE.costPerRunA$)} a week, and every one of them takes `
          + `${BARGE.laneMetresPerRun} m of deck off the cars coming the other way.`
        : '';
    } else {
      state.barge.surgeRuns = 0;
      state.barge.surgeNote = 'The schedule is set by hand, so nobody is booking extra movements. '
        + 'What lands in the yard stays in the yard.';
    }

    // Bins that were not emptied. Once there is room in the yard again the trucks catch up, but
    // catching up is slower than falling behind, because the same trucks still have today's round
    // to do. Half a day's catch-up a day is the modelled rate.
    if (kerbsideT > 0) {
      const roomM3 = Math.max(0, YARD.bays * YARD.skipM3 * OVERSTACK_LIMIT - yard.storedM3);
      // Missed kerbside is mostly general waste, so it goes back in at the residual density.
      const canTakeT = roomM3 * 0.20 * 0.5;
      const back = Math.min(kerbsideT, canTakeT);
      if (back > 0) {
        const res = store.get('residual');
        res.t += back;
        res.m3 = res.t / res.tPerM3;
        kerbsideT -= back;
        yard.storedT += back;
        yard.storedM3 = res.m3;
      }
      if (!kerbsideAnnounced && kerbsideT > 3) {
        kerbsideAnnounced = true;
        const bins = Math.round((refused7.total + dayRefusedT) * 1000 / BIN_KG);
        log.push({
          day, kind: 'kerbside',
          text: `About ${bins.toLocaleString('en-AU')} bins were not emptied. The yard at Dunwich is `
            + 'stacked to its limit, so the truck had nowhere to tip and went back to the depot. '
            + 'The bins are still on the kerb and it is going to be thirty degrees tomorrow.'
        });
        w.bus.emit('waste:kerbside-missed', { tonnes: +kerbsideT.toFixed(1), bins });
        nudge(w, 'resident_amenity', -0.16, `${bins} bins not emptied`, 'infrastructure/waste.js', 200);
        nudge(w, 'litter', 0.22, 'bins left on the kerb through a hot week', 'infrastructure/waste.js', 160);
        nudge(w, 'visitor_satisfaction', -0.10, 'overflowing bins in the townships', 'infrastructure/waste.js', 150);
      }
      if (kerbsideT <= 0.2) { kerbsideT = 0; kerbsideAnnounced = false; state.kerbside.since = null; }
    }

    // Illegal dumping. Three drivers, and the pack names two of them. A gate fee is a reason to
    // dump in the bush; a closed tip is a better one; and a full island produces more of everything.
    const chargingLever = L.level('commercial-waste-charging');
    const fee = gateFeeMultiplier * (0.7 + 0.6 * chargingLever);
    const closed = closedToPublic ? 0.30 : 0;
    const pop = servedPopulation(w);
    const target = clamp(0.10 + 0.22 * (fee - 1) + closed + 0.10 * clamp(pop.pressure - 0.6, 0, 1.4), 0, 1);
    illegalDumping += (target - illegalDumping) * 0.05;
    dayDumping = illegalDumping * 3;

    // Litter follows the overflow: bins that were full on Sunday afternoon and are still full on
    // Tuesday. It is the visible half of a backlog.
    const backlogPressure = clamp(yard.full - 0.6, 0, 0.5) * 2;
    const litterTarget = clamp(0.18 + 0.35 * backlogPressure + 0.22 * clamp(pop.pressure - 0.8, 0, 1.5), 0, 1);
    litter += (litterTarget - litter) * 0.08;

    // A backlog that has been building for a week is worth telling somebody about, once.
    const backlogDays = shipped365.mean > 0 ? yard.storedT / Math.max(0.5, shipped365.mean) : 0;
    if (backlogDays > 6 && !backlogAnnounced) {
      backlogAnnounced = true;
      log.push({
        day, kind: 'backlog',
        text: `There is ${Math.round(yard.storedT)} tonnes on the ground at Dunwich and ${backlogDays.toFixed(1)} `
          + `days of barge runs to shift it. The yard is ${Math.round(yard.full * 100)} per cent full by volume.`
      });
      w.bus.emit('waste:backlog', { tonnes: Math.round(yard.storedT), days: +backlogDays.toFixed(1) });
      nudge(w, 'litter', 0.10, 'a week of rubbish on the ground at Dunwich', 'infrastructure/waste.js', 120);
    } else if (backlogDays < 3) {
      backlogAnnounced = false;
    }

    // The green waste pile. The lever's own side effect, applied when the pile is real and the
    // landscape is dry, and not as a constant tax on doing the right thing.
    if (greenStockpileT > 200) {
      const wx = w.read('weather');
      const dry = wx ? clamp(1 - wx.rainWeek / 25, 0, 1) : 0.5;
      if (dry > 0.8 && day % 30 === 0) {
        nudge(w, 'fire_hazard_load', clamp(greenStockpileT / 4000, 0.02, 0.12),
          `${Math.round(greenStockpileT)} tonnes of green waste stockpiled in a dry spell`,
          'infrastructure/waste.js', 120);
      }
    }

    // A festival weekend, with the pack's own extra bin count.
    const ev = pop.events;
    if (ev.running.length && ev.extraBins > 0) {
      log.push({
        day, kind: 'event-load',
        text: `${ev.running.map((e) => e.name).join(', ')}: ${ev.extraBins} extra bins asked for, `
          + `about ${ev.crowd.toLocaleString('en-AU')} people on site. The attendance figure is the pack's estimate.`
      });
    }

    if (w.clock.dayOfYear === 1) closedDaysYear = 0;
  }

  /* -------------------------------------------------------------- read model */

  function publish(w, g, yard) {
    // Annualised from whatever window exists, including a first partial day, because a system that
    // reports thirty tonnes a year for its first three weeks is a system that quietly lies to
    // src/systems/civic/policy.js, which reads this number for its waste-flow coupling.
    const days = Math.max(1, generated365.filled) + (dayGeneratedT > 0 ? 1 : 0);
    const seen = generated365.total + dayGeneratedT;
    const year = generated365.filled >= 2 || dayGeneratedT > 0
      ? (seen / days) * 365
      : (g.pop.residents * RESIDENT_T_YEAR
        + (g.pop.staying * STAYING_KG_DAY + g.pop.day * DAY_KG_DAY) * 0.365 + 383);
    state.tonnesPerYear = year;
    state.generatedTodayT = dayGeneratedT;
    state.generatedRolling365T = generated365.total;
    state.perPersonKgDay = g.pop.total > 0 ? +(dayGeneratedT * 1000 / g.pop.total).toFixed(2) : 0;

    const by = {};
    let skips = 0;
    for (const s of store.values()) {
      by[s.id] = { label: s.label, tonnes: +s.t.toFixed(2), m3: +s.m3.toFixed(1), recyclable: s.recyclable };
      skips += Math.ceil(s.m3 / YARD.skipM3);
    }
    state.byStream = by;

    state.yard.skipsOnGround = skips;
    state.yard.storedT = +yard.storedT.toFixed(1);
    state.yard.storedM3 = Math.round(yard.storedM3);
    state.yard.pctFullByVolume = +yard.full.toFixed(3);
    state.yard.closedToPublic = closedToPublic;
    state.yard.atPhysicalLimit = yard.full >= OVERSTACK_LIMIT - 0.01;
    // Bins missed this week, not bins missed ever. The same bin is at the same kerb every Monday,
    // so a running total of individual bins is a number that means nothing by February.
    state.kerbside.tonnes = +kerbsideT.toFixed(1);
    state.kerbside.binsNotEmptiedThisWeek = Math.round((refused7.total + dayRefusedT) * 1000 / BIN_KG);
    state.kerbside.binsNotEmptied = state.kerbside.binsNotEmptiedThisWeek;
    const weekly = Math.max(0.1, generated365.mean * 7);
    state.kerbside.weeksBehind = +(kerbsideT / weekly).toFixed(1);
    state.kerbside.since = kerbsideT > 0 ? (state.kerbside.since ?? w.clock.dayIndex) : null;
    state.yard.closedSinceDay = closedSinceDay;
    state.yard.closedDaysThisYear = closedDaysYear;

    state.barge.runsThisWeek = runsThisWeek;
    state.barge.runsLostThisWeek = runsLostThisWeek;
    state.barge.skipsShippedToday = daySkips;
    state.barge.tonnesShippedToday = +dayShippedT.toFixed(2);
    state.barge.tonnesShippedRolling365 = +shipped365.total.toFixed(0);
    state.barge.backlogT = +yard.storedT.toFixed(1);
    state.barge.backlogDays = shipped365.mean > 0 ? +(yard.storedT / Math.max(0.5, shipped365.mean)).toFixed(2) : 0;
    state.barge.laneMetresToday = dayLaneM;

    state.recycling.divertedTodayT = +dayDiverted.toFixed(2);
    state.recycling.divertedRolling365T = +diverted365.total.toFixed(0);
    state.recycling.diversionPct = generated365.total > 0 ? diverted365.total / generated365.total : 0;
    state.recycling.contamination = contamination;
    state.recycling.rejectedLoads365 = rejected365.total;
    state.recycling.recoveredRolling365A$ = Math.round(recovered365.total);
    state.recycling.rejectedRolling365T = +rejectedT365.total.toFixed(1);
    state.recycling.uneconomicRolling365T = +uneconomic365.total.toFixed(1);

    // The arithmetic on one full skip, published as arithmetic so a player can read it and argue
    // with it rather than being told a verdict.
    const comingled = store.get('comingled');
    const perSkipT = comingled ? YARD.skipM3 * comingled.tPerM3 : 0;
    const contaminated = contamination > CONTAMINATION_REJECT;
    const econ = comingled ? recyclingEconomics(comingled, perSkipT, contaminated) : null;
    state.recycling.viable = !!(econ && econ.worthIt);
    state.recycling.skipTonnes = +perSkipT.toFixed(2);
    state.recycling.economics = econ ? {
      tonnesPerSkip: +perSkipT.toFixed(2),
      freightA$: Math.round(econ.freightA$),
      materialValueA$: Math.round(econ.gateValueA$),
      landfillAvoidedA$: Math.round(econ.landfillAvoidedA$),
      disposalIfRejectedA$: Math.round(econ.disposalIfRejectedA$),
      netA$: Math.round(econ.netA$)
    } : null;
    state.recycling.why = contaminated
      ? `Contamination is ${Math.round(contamination * 100)} per cent. Above `
        + `${Math.round(CONTAMINATION_REJECT * 100)} the mainland facility rejects the load and buries it, `
        + 'after the island has paid the freight to send it and pays again to have it buried.'
      : econ && econ.worthIt
        ? `A full skip goes across at ${perSkipT.toFixed(1)} tonnes and comes out `
          + `${Math.round(econ.netA$)} dollars ahead of what the crossing cost. That is the compactor doing it.`
        : `A full skip of comingled recycling weighs about ${perSkipT.toFixed(1)} tonnes. The material is `
          + `worth about ${Math.round(econ ? econ.gateValueA$ : 0)} dollars and it avoids about `
          + `${Math.round(econ ? econ.landfillAvoidedA$ : 0)} dollars of landfill charge, against about `
          + `${Math.round(econ ? econ.freightA$ : 0)} dollars to put it on the boat. It does not quite pay, `
          + 'and it does not pay because a skip costs the same to cross whether it is full of steel or milk bottles.';

    state.green.stockpileT = +greenStockpileT.toFixed(1);
    state.green.mulchedRolling365T = +mulched365.total.toFixed(0);
    state.green.mulchingOnIsland = L.level('green-waste-mulched-on-island') > 0.4;
    state.green.fuelLoadIndex = +clamp(greenStockpileT / 3000, 0, 1).toFixed(3);
    state.green.note = state.green.mulchingOnIsland
      ? 'Green waste is chipped here instead of barged. It comes off the export tonnage and it goes '
        + 'onto a pile, and a pile in a fire-prone landscape is a fuel load with a fence around it.'
      : 'Green waste crosses on the barge with everything else. It is light and bulky, so it fills '
        + 'skips faster than it fills the weighbridge.';

    state.illegalDumping.index = illegalDumping;
    state.illegalDumping.reportsRolling30 = Math.round(dumping30.total);
    state.illegalDumping.driver = closedToPublic ? 'the tip is shut'
      : gateFeeMultiplier > 1.2 ? 'the gate fee on a commercial load'
        : 'a busy island and a trailer that has been loaded since Saturday';
    state.litterIndex = +litter.toFixed(3);

    state.cost.todayA$ = Math.round(dayCostA$);
    state.cost.rolling365A$ = Math.round(cost365.total);
    state.cost.recoveredA$ = Math.round(recovered365.total);
    const dwellings = (w.read('population')?.dwellings?.total) || 1900;
    state.cost.perDwellingYearA$ = Math.round(cost365.total / Math.max(1, dwellings));

    // The centre's own load, for power.js. Modelled: a weighbridge, a compactor, lighting and a shed.
    state.powerKw = closedToPublic ? 6 : 34;

    state.events = log.recent(8);
  }
}
