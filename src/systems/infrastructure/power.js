// Power. One cable under the bay, twenty-one thousand square metres of roof, and a hard question.
//
// WHAT IS PUBLISHED AND WHAT IS NOT, because this file is mostly the second kind and has to say so.
//
// data/civic.json metrics.energy_reliability says, in the pack's own words: "The island is fed from
// the mainland grid rather than generated on. The pack does not claim the cable route, the feeder
// arrangement or an outage frequency, because none was verified." That sentence is the licence for
// everything below and also its limit. Supply arriving from the mainland is in the pack. The number
// of circuits, their rating, the fault rate and the repair time are this project's, and every one
// of them is labelled `modelled` in the read model so a reader can see where the pack stops.
//
// Two figures are somebody's published work and are used as published:
//   * about 30,000 kWh a day of island demand, from data/subterranean.json island_context, which
//     itself labels the figure "a working estimate for about 2,200 people, labelled as such until
//     checked against real network data".
//   * about 19,000 kWh a day of rooftop solar potential off about 21,000 square metres of viable
//     roof, same pack, same standing.
// The subterranean pack also carries the footprint rule that governs this file: "Zero square metres
// of new land cleared for energy, ever. Roofs, carports, sheds, tanks, structures, shorelines and
// swell only." There is no solar farm option in here and there never will be.
//
// THE QUESTION THE BRIEF ASKS: could the island run itself?
//
// The arithmetic says something more interesting than yes or no, and it says it twice.
//
// On annual energy: the pack's nineteen thousand kilowatt-hours a day of rooftop against its thirty
// thousand of demand looks like two thirds of the way there. It is not, and finding out why is the
// first honest surprise. The pack sized the roofs against a resident island of about two thousand
// two hundred people. The island the rest of this simulation produces has holiday houses full for
// six weeks of the year and eight thousand people on it on Boxing Day, so the real annual demand is
// half again as large and every roof on the island covers a bit over forty per cent of it. There is
// no more roof, and data/subterranean.json rules out clearing land, so that number is the number.
//
// On the peak: annual energy was never the constraint anyway. The constraint is seven o'clock on a
// summer evening when the sun has been down for an hour and every kettle on the island is on at
// once. Solar does nothing for that hour. Storage does. So a player who buys panels and no
// batteries watches self-sufficiency climb, watches the daytime import go to nothing, and finds the
// cable is still sized for exactly the same peak it was sized for before, because the peak did not
// move. That is the discovery this file exists to hand over, and it is not a trick: it is the actual
// shape of the problem on every island like this one.
//
// FAILURE MODES A PLAYER CAUSES AND THEN LIVES WITH
//   1. Running the crossing above its firm rating. Two circuits are two only until one of them is
//      out. Load the island past what one circuit carries and the day a circuit trips is the day
//      the lights go out in a rolling order the player set months earlier and has forgotten.
//   2. The shedding order itself. Put the water treatment plant below the shops and the power comes
//      back in four hours and the water does not, because the reservoirs drained while the pumps
//      were off. water.js reads the shed list; it does not take this file's word for anything else.
//   3. Diesel. Standby generators at the critical sites hold the island up during a cable fault, and
//      they hold it up for exactly as long as the fuel in the tanks lasts. Fuel comes on the barge,
//      the barge does not run in a gale, and a cable fault and a gale are the same weather.
//   4. Batteries in a fire landscape. data/civic.json island-energy-resilience carries the side
//      effect in its own words: "Batteries in a fire landscape need their own separation and their
//      own fire plan." Build them and fire_hazard_load moves.
//
// Determinism: world.rng.stream('power'). No Math.random, no Date.now.

import {
  clamp, levers, servedPopulation, townships, nudge,
  kettles, hoursMinutes, crossing, Rolling, EventLog, TICK_HOURS, BASIS
} from './infra-common.js';

/* ------------------------------------------------------------------ the crossing

Modelled, all of it. Two circuits, because a supply worth having is never one, and 2,900 kW each,
which is where a distributor would land: one circuit carries a winter island with room to spare and
does not carry a Boxing Day. That gap is the whole design. It means the island is comfortable for
eleven months and one circuit away from a hard summer, which is exactly the position a small island
at the end of a cable is actually in. Change these numbers and the behaviour changes; nothing
downstream assumes they are right. */

const CABLE = {
  circuits: 2,
  ratingKw: 2900,          // per circuit, continuous
  emergencyKw: 3400,       // per circuit, for a few hours, at the cost of its life
  routeKm: 9.5,            // Cleveland side to the island, under the Rainbow Channel
  basis: BASIS.modelled,
  note: 'Two circuits at 2,900 kW each. The route, the circuit count, the rating and the fault rate '
    + 'are all modelled. data/civic.json states plainly that none of them was verified. The rating '
    + 'is chosen so that one circuit carries a winter island comfortably and does not carry a '
    + 'Boxing Day, which is how a distributor would size a feed like this and is where the tension is.'
};

/** How likely a circuit is to fail on a given day, before anything the player does. */
const FAULT = {
  perCircuitPerYear: 0.12,          // modelled: a submarine cable fault is rare and expensive
  repairDaysMin: 4,                 // modelled: the repair vessel is not on the island
  repairDaysMax: 21,
  stormMultiplier: 6,               // anchors drag in an east coast low
  overloadMultiplier: 9,            // a circuit run hot trips, and hot circuits fail young
  note: 'Fault rate, repair time and both multipliers are modelled. No outage frequency for this '
    + 'island is published in any pack read here.'
};

/* ------------------------------------------------------------------ demand

Per-person daily energy, chosen so the modelled island lands on the pack's 30,000 kWh a day at the
population and visitor numbers the rest of the simulation produces, and no tighter than that. A
visitor uses less than a resident because a visitor is in a house that already exists and is not
running a fridge for fifty-two weeks: what a visitor adds is hot water, air conditioning and the
laundry. Utilities are counted separately, because they are the ones a player can switch off. */

const RESIDENT_KWH_DAY = 10.2;
const STAYING_KWH_DAY = 5.6;    // a holiday house or a powered site: hot water, aircon, the laundry
const DAY_KWH_DAY = 0.9;        // a toilet block, a shop's air conditioning, a coffee machine
const EVENT_KWH_DAY = 2.4;      // a festival crowd on site: stage, sound, food stalls, refrigeration

/**
 * Where the day's energy goes, hour by hour. Normalised to a mean of one at load, so changing the
 * shape does not change the annual total. The island shape is a small residential feeder with a
 * flat commercial base: a modest breakfast peak, a long flat middle, and a hard evening peak from
 * five that does not let go until nine.
 */
const HOUR_SHAPE = [
  0.62, 0.55, 0.52, 0.51, 0.53, 0.60, 0.78, 1.00, 1.10, 1.02, 0.95, 0.93,
  0.95, 0.96, 0.98, 1.05, 1.20, 1.45, 1.62, 1.60, 1.42, 1.15, 0.88, 0.72
];
(function normalise() {
  let s = 0;
  for (const v of HOUR_SHAPE) s += v;
  const mean = s / 24;
  for (let i = 0; i < 24; i++) HOUR_SHAPE[i] /= mean;
})();

/* ------------------------------------------------------------------ rooftop

data/subterranean.json island_context: about 21,000 square metres of viable roof, about 19,000 kWh a
day of potential. At about 0.20 kW of module for a square metre of roof that is roughly 4,200 kW
installed, which at this latitude yields close to the pack's number, so the two agree and neither
was bent to fit. Installed share starts where a coastal Queensland township with cheap sun and
expensive power actually sits: high, and already higher than most people assume. */

const ROOF = {
  viableM2: 21000,
  kwPerM2: 0.20,
  potentialKwhDay: 19000,
  startingShare: 0.34,
  basis: 'roof area and daily potential published in data/subterranean.json island_context. '
    + 'The installed share and the panel density are modelled.'
};

/* ------------------------------------------------------------------ storage and standby

The critical sites are the ones data/civic.json island-energy-resilience names in its own
description: "the water plants, the sewage plant, the halls used as shelters, the clinic". The
capital figure in the pack is A$7.5 million for behind-the-meter solar and battery at those sites,
with a 30 month lead time, and it is a modelling estimate with low confidence in the pack's own
words. */

const CRITICAL_SITES = [
  { id: 'water-treatment-dunwich', label: 'The water treatment plants', kw: 45, dieselKw: 80, tank: 2500 },
  { id: 'wwtp-point-lookout', label: 'Point Lookout wastewater plant', kw: 25, dieselKw: 60, tank: 2200 },
  { id: 'sewer-pump-stations', label: 'Sewer pump stations', kw: 26, dieselKw: 45, tank: 700 },
  { id: 'clinic-dunwich', label: 'The clinic at Dunwich', kw: 22, dieselKw: 35, tank: 500 },
  { id: 'telecoms-sites', label: 'Mobile and network sites', kw: 37, dieselKw: 0, tank: 0 },
  { id: 'shelter-halls', label: 'The three halls used as shelters', kw: 30, dieselKw: 60, tank: 700 },
  { id: 'waste-centre', label: 'The recycling and waste centre', kw: 34, dieselKw: 0, tank: 0 }
];

/** Litres of diesel per kilowatt-hour generated. Modelled from typical standby set consumption. */
const DIESEL_L_PER_KWH = 0.29;
const DIESEL_A$_PER_L = 2.45;   // island price, modelled: prices.js publishes the island fuel premium

/**
 * The shedding order. When there is less power than load, this is who loses it and in what order.
 * The player can rewrite it and the consequences of rewriting it are the point. Lower goes off
 * last. This default is the one a distributor would use and it is not the one that keeps the most
 * people happy.
 */
const DEFAULT_PRIORITY = [
  'streetlighting',        // first off, nobody notices until they do
  'irrigation-and-pools',
  'commercial',
  'households-rotating',   // rolling blocks, an hour at a time
  'waste-centre',
  'shelter-halls',
  'telecoms-sites',
  'clinic-dunwich',
  'sewer-pump-stations',
  'wwtp-point-lookout',
  'water-treatment-dunwich' // last off, because the day after is worse than the day
];

export function registerPower(world) {
  const rng = world.rng.stream('power');
  const L = levers(world);
  const log = new EventLog(30);

  const state = world.publish('power', {
    ready: false,
    basis: 'The island being fed from the mainland is in data/civic.json. The cable, its circuits, '
      + 'its rating, its fault rate and its repair time are modelled by this file and are not '
      + 'published anywhere. Island daily demand and rooftop potential are from '
      + 'data/subterranean.json island_context, which labels both as working estimates.',

    demandKw: 0,
    demandByCategory: {},
    peakTodayKw: 0,
    peakYesterdayKw: 0,

    cable: {
      circuits: CABLE.circuits, up: CABLE.circuits, ratingKw: CABLE.ratingKw,
      totalKw: CABLE.circuits * CABLE.ratingKw,
      firmKw: (CABLE.circuits - 1) * CABLE.ratingKw,
      importKw: 0, utilisation: 0, firmUtilisation: 0,
      faulted: [], repairDaysLeft: 0, routeKm: CABLE.routeKm,
      basis: CABLE.basis, note: CABLE.note
    },

    solar: {
      installedKw: 0, share: ROOF.startingShare, generatingKw: 0,
      potentialKwhDay: ROOF.potentialKwhDay, generatedTodayKwh: 0,
      curtailedTodayKwh: 0, shareOfDemandNow: 0, basis: ROOF.basis
    },

    battery: {
      capacityKwh: 0, chargeKwh: 0, statePct: 0, flowKw: 0,
      householdKwh: 0, criticalKwh: 0,
      hoursOfEveningPeak: 0, cyclesRolling365: 0
    },

    diesel: {
      sites: 0, running: false, runningKw: 0, litres: 0, capacityLitres: 0,
      burnLPerHour: 0, hoursLeft: 0, hoursLabel: '', litresBurnedRolling365: 0,
      costRolling365A$: 0, refuelOrdered: false, refuelDueInDays: 0
    },

    shedding: { on: false, kwShort: 0, blocks: [], sinceMinutes: 0, priority: DEFAULT_PRIORITY.slice() },
    outage: { on: false, cause: null, minutes: 0, peopleAffected: 0, sitesDown: [] },

    reliability: {
      minutesOffPerConnection365: 0, interruptions365: 0,
      worstEventMinutes: 0, label: 'no interruptions recorded yet'
    },

    today: { demandKwh: 0, solarKwh: 0, importedKwh: 0, dieselKwh: 0, shedKwh: 0, batteryKwh: 0 },
    selfSufficiency: { todayPct: 0, rolling365Pct: 0, note: '' },
    /** Peak demand said in something a reader has a feel for. A kettle is about 2.2 kW. */
    inKettles: { peakToday: 0, rooftopNow: 0 },

    couldItRunItself: null,   // set at init: the honest arithmetic, in one object
    events: [],
    notes: []
  });

  /* -------------------------------------------------------------- runtime */

  const notes = state.notes;
  const sites = CRITICAL_SITES.map((s) => ({ ...s, litres: s.tank * 0.8, on: true, generating: 0 }));
  const siteById = new Map(sites.map((s) => [s.id, s]));
  let priority = DEFAULT_PRIORITY.slice();
  /** blockId -> the tick it may come back on. Half an hour minimum, set in shed(). */
  const shedHold = new Map();

  let installedShare = ROOF.startingShare;
  let installedKw = 0;
  let householdKwh = 0;         // household batteries, tied to the solar build
  let criticalKwh = 0;          // the civic lever's batteries at the critical sites
  let charge = 0;
  let batteryCycles = new Rolling(365);
  let dayCycleKwh = 0;

  const circuits = [];
  for (let i = 0; i < CABLE.circuits; i++) circuits.push({ id: i + 1, up: true, repairDaysLeft: 0, faultsTotal: 0, hotHours: 0 });

  let lastDay = -1;
  let peakToday = 0;
  let dayDemand = 0, daySolar = 0, dayImport = 0, dayDiesel = 0, dayShed = 0, dayCurtailed = 0;
  const demand365 = new Rolling(365);
  const solar365 = new Rolling(365);
  const dieselL365 = new Rolling(365);
  /** Minutes a typical connection was off, per day, so the reliability figure is a real rolling
   *  year and not a counter that only ever goes up. */
  const offMinutes365 = new Rolling(365);
  const interruptions365 = new Rolling(365);
  let dayDieselL = 0;
  let dayOffMinutes = 0;
  let dayInterruptions = 0;
  let outageMinutes = 0;
  let outageCause = null;
  let worstEventMinutes = 0;
  let shedSinceMinutes = 0;
  let refuelOrderedDay = -1;
  let refuelLitres = 0;
  let batteryBuiltAnnounced = false;

  /* -------------------------------------------------------------- intents */

  world.bus.on('ui:intent', (p) => {
    if (!p || typeof p.kind !== 'string' || !p.kind.startsWith('power:')) return;
    if (p.kind === 'power:solar' && Number.isFinite(p.share)) {
      installedShare = clamp(p.share, 0, 1);
      rebuildSolar();
    } else if (p.kind === 'power:battery' && Number.isFinite(p.kwh)) {
      criticalKwh = Math.max(0, p.kwh);
    } else if (p.kind === 'power:priority' && Array.isArray(p.order)) {
      // Only ids that already exist may be reordered. An unknown id would silently create a block
      // that never sheds, which is the worst kind of bug: one that looks like a working setting.
      const known = new Set(DEFAULT_PRIORITY);
      const next = p.order.filter((id) => known.has(id));
      for (const id of DEFAULT_PRIORITY) if (!next.includes(id)) next.push(id);
      priority = next;
      state.shedding.priority = priority.slice();
    } else if (p.kind === 'power:order-diesel' && Number.isFinite(p.litres)) {
      refuelLitres += Math.max(0, p.litres);
      refuelOrderedDay = world.clock.dayIndex;
    } else if (p.kind === 'power:cable-fault') {
      const live = circuits.filter((c) => c.up);
      if (live.length) breakCircuit(world, live[0], 'requested for a scenario');
    }
  });

  function rebuildSolar() {
    installedKw = ROOF.viableM2 * ROOF.kwPerM2 * installedShare;
    // Household batteries follow the panels, because on this island they are bought together and
    // because a battery without a panel has nothing to fill it. Modelled at 2.6 kWh of usable
    // storage per kilowatt of installed rooftop, which is roughly one common home battery per
    // typical rooftop system.
    householdKwh = installedKw * 2.6;
  }

  /* -------------------------------------------------------------- demand */

  function computeDemand(w) {
    const pop = servedPopulation(w);
    const wx = w.read('weather');
    const dl = w.read('daylight');
    const hour = w.clock.hour;
    const shape = HOUR_SHAPE[hour];

    // Base: people, spread over the day by the island's load shape. A visitor asleep in a holiday
    // house is a household. A visitor who came over on the nine o'clock boat is a coffee machine.
    const baseKwhDay = pop.residents * RESIDENT_KWH_DAY + pop.staying * STAYING_KWH_DAY
      + pop.day * DAY_KWH_DAY + pop.event * EVENT_KWH_DAY;
    const households = (baseKwhDay / 24) * shape;

    // Air conditioning and heating. Both are a temperature-driven addition on top of the shape,
    // and both are why the peak is an evening in January and an evening in July and nothing in
    // between. The apparent temperature is the right driver: humidity is why a 29 degree evening
    // here runs harder than a 33 degree evening inland.
    const apparent = wx ? wx.apparentC : 22;
    const temp = wx ? wx.tempC : 22;
    // Only people under a roof run an air conditioner, and a day tripper on the beach is not one.
    const occupied = pop.residents + pop.staying;
    const coolingKw = Math.pow(Math.max(0, apparent - 23.0), 1.25) * occupied * 0.013;
    const heatingKw = Math.pow(Math.max(0, 14.5 - temp), 1.15) * occupied * 0.011;
    const climate = coolingKw + heatingKw;

    // Streetlighting: on between dusk and dawn, small, and the first thing shed.
    const dark = dl ? (dl.elevationDeg < -3 ? 1 : 0) : (hour < 6 || hour > 18 ? 1 : 0);
    const street = 48 * dark;

    // Irrigation and the pool. The Dunwich pool and the two ovals, and they run at night.
    const irrigation = (hour >= 20 || hour < 5) ? 55 : 12;

    // The utilities. Read from the systems that own them, last tick's value, because water and
    // telecoms tick after power inside the infrastructure phase. A tick is ten minutes and a pump
    // does not change its mind in ten minutes, so reading one tick behind costs nothing and is
    // honest about the ordering rather than pretending to a simultaneity that does not exist.
    const water = w.read('water');
    const tele = w.read('telecoms');
    const sub = w.read('subterranean');
    const waterKw = water && Number.isFinite(water.powerKw) ? water.powerKw
      : siteById.get('water-treatment-dunwich').kw + siteById.get('wwtp-point-lookout').kw + siteById.get('sewer-pump-stations').kw;
    const teleKw = tele && Number.isFinite(tele.powerKw) ? tele.powerKw : siteById.get('telecoms-sites').kw;
    // The subterranean works are the one thing on this island that can double its load. The pack's
    // own power_reality_check says a player who rushes the carbon furnace hall should black out the
    // island and that it "should be enforced, not softened". This is where that is enforced.
    const subKw = sub && Number.isFinite(sub.connectedLoadKw)
      ? sub.connectedLoadKw * clamp(sub.utilisation ?? 0.4, 0, 1) : 0;

    const commercial = 175 + 55 * clamp(pop.pressure, 0, 2);

    const byCategory = {
      households: households,
      commercial,
      climate,
      water: waterKw,
      telecoms: teleKw,
      streetlighting: street,
      'irrigation-and-pools': irrigation,
      subterranean: subKw
    };
    let total = 0;
    for (const k in byCategory) total += byCategory[k];
    return { total, byCategory, pop };
  }

  /* -------------------------------------------------------------- solar */

  function solarKw(w) {
    const dl = w.read('daylight');
    const wx = w.read('weather');
    if (!dl || dl.elevationDeg <= 0.5) return 0;
    // Clear-sky output against elevation, with an air-mass term so an eight o'clock sun does not
    // pretend to be a noon sun. Panels on a house roof are not tracking, so the cosine loss on a
    // low sun is real and large.
    const elev = dl.elevationDeg * Math.PI / 180;
    const airMass = 1 / Math.max(0.08, Math.sin(elev) + 0.15);
    const clear = Math.sin(elev) * Math.pow(0.72, Math.pow(airMass, 0.678));
    const cloud = wx ? wx.cloud : 0.2;
    // Cloud does not take everything: a bright overcast on this coast still runs panels at a fifth.
    const cloudFactor = 1 - 0.78 * cloud * cloud;
    // Panels lose output when they are hot, which is exactly when the island wants them most.
    const cellC = (wx ? wx.tempC : 24) + 28 * clear;
    const heatDerate = 1 - 0.0037 * Math.max(0, cellC - 25);
    // Salt haze and the fact that nobody washes a roof on this island.
    const soiling = 0.955;
    return Math.max(0, installedKw * clear * cloudFactor * heatDerate * soiling);
  }

  /* -------------------------------------------------------------- faults */

  function breakCircuit(w, c, cause) {
    if (!c.up) return;
    c.up = false;
    c.faultsTotal++;
    c.repairDaysLeft = rng.range(FAULT.repairDaysMin, FAULT.repairDaysMax);
    const live = circuits.filter((x) => x.up).length;
    log.push({
      day: w.clock.dayIndex, kind: 'cable-fault',
      text: `Circuit ${c.id} under the bay is out: ${cause}. Repair is quoted at about `
        + `${Math.round(c.repairDaysLeft)} days, because the vessel that does it is not here. `
        + (live ? `The island is on one circuit, ${CABLE.ratingKw} kW.` : 'Both circuits are out.')
    });
    w.bus.emit('power:cable-fault', {
      circuit: c.id, cause, repairDays: Math.round(c.repairDaysLeft), circuitsUp: live
    });
    nudge(w, 'energy_reliability', live ? -0.10 : -0.30,
      `cable circuit ${c.id} out for about ${Math.round(c.repairDaysLeft)} days`, 'infrastructure/power.js', 220);
  }

  function faultCheck(w) {
    const wx = w.read('weather');
    const storm = wx && (wx.synoptic === 'eastcoastlow' || wx.swellM > 3.2) ? FAULT.stormMultiplier : 1;
    for (const c of circuits) {
      if (!c.up) {
        c.repairDaysLeft -= 1;
        if (c.repairDaysLeft <= 0) {
          c.up = true; c.repairDaysLeft = 0; c.hotHours = 0;
          log.push({ day: w.clock.dayIndex, kind: 'cable-repaired', text: `Circuit ${c.id} is back in service.` });
          w.bus.emit('power:cable-repaired', { circuit: c.id });
        }
        continue;
      }
      // A circuit run above its rating does not trip today. It ages. Hours over rating accumulate
      // and they multiply the daily hazard, which is why the island that quietly grew past its firm
      // capacity is the island that loses a circuit in the middle of the January long weekend.
      const overloaded = clamp(c.hotHours / 40, 0, 1);
      const hazard = (FAULT.perCircuitPerYear / 365) * storm * (1 + overloaded * (FAULT.overloadMultiplier - 1));
      if (rng.float() < hazard) {
        breakCircuit(w, c, overloaded > 0.35 ? 'run above its rating for weeks, then a hot day'
          : storm > 1 ? 'an anchor dragged in the low' : 'a fault on the crossing');
      }
      c.hotHours *= 0.985;   // the record of overload fades, slowly
    }
  }

  /* -------------------------------------------------------------- the balance

  One tick of ten sim-minutes, resolved in the order a real system resolves it: generation first,
  then storage, then import, then standby generation, then, only if all of that is not enough,
  shedding. Nothing here can create energy. If the numbers do not close, the island goes dark, and
  that is the correct answer rather than a bug to smooth over. */

  function balance(w, demandKw) {
    // Zero the generators every tick. A set that ran an hour ago and is not running now must not
    // still be reporting output, and a stale field here would have the read model showing 250 kW of
    // diesel on a day nothing was wrong.
    for (const s of sites) s.generating = 0;
    const solar = solarKw(w);
    const surplusFromSolar = solar - demandKw;
    let importKw = 0, dieselKw = 0, batteryKw = 0, curtailKw = 0, shedKw = 0;

    const liveCircuits = circuits.filter((c) => c.up);
    const importCapKw = liveCircuits.length * CABLE.ratingKw;
    const capacityKwh = householdKwh + criticalKwh;
    if (charge > capacityKwh) charge = capacityKwh;

    if (surplusFromSolar >= 0) {
      // More sun than load. Fill the batteries, then export what is left back across the cable,
      // and if the cable is out there is nowhere for it to go and the inverters back off.
      const room = (capacityKwh - charge) / TICK_HOURS;
      batteryKw = -Math.min(room * 0.95, surplusFromSolar);   // negative: charging
      charge += -batteryKw * TICK_HOURS * 0.94;               // round trip loss on the way in
      const left = surplusFromSolar + batteryKw;
      if (left > 0) {
        // Export back to the mainland, up to a modelled third of a circuit. A distribution feeder
        // fed from one end does not take unlimited reverse flow, and this is the number that makes
        // a very high rooftop share start to waste itself in the middle of a clear October day.
        const exportCap = liveCircuits.length * CABLE.ratingKw * 0.33;
        importKw = -Math.min(exportCap, left);
        curtailKw = Math.max(0, left - exportCap);
      }
    } else {
      let short = -surplusFromSolar;
      // Batteries first, but only down to a reserve that is held for the evening. A battery that
      // empties itself at three in the afternoon is a battery that is not there at seven.
      const reserveKwh = capacityKwh * (w.clock.hour < 16 ? 0.45 : 0.08);
      const available = Math.max(0, charge - reserveKwh) / TICK_HOURS;
      batteryKw = Math.min(available * 0.92, short);
      charge -= (batteryKw / 0.92) * TICK_HOURS;
      short -= batteryKw;

      importKw = Math.min(importCapKw, short);
      short -= importKw;

      if (short > 0.5) {
        // Standby generation at the critical sites. It exists to hold those sites up, not to run
        // the island, so it can only cover load at least as important as the sites themselves.
        dieselKw = runDiesel(w, short);
        short -= dieselKw;
      }
      shedKw = Math.max(0, short);
    }

    // Record how hard the live circuits are working. Over the rating is what ages them.
    if (importKw > 0 && liveCircuits.length) {
      const perCircuit = importKw / liveCircuits.length;
      if (perCircuit > CABLE.ratingKw * 0.97) {
        for (const c of liveCircuits) c.hotHours += TICK_HOURS;
      }
    }

    return { solar, importKw, dieselKw, batteryKw, curtailKw, shedKw, capacityKwh, importCapKw };
  }

  function runDiesel(w, needKw) {
    let made = 0;
    for (const s of sites) {
      if (s.dieselKw <= 0 || s.litres <= 0) { s.generating = 0; continue; }
      const want = Math.min(s.dieselKw, needKw - made);
      if (want <= 0.1) { s.generating = 0; continue; }
      const litresNeeded = want * TICK_HOURS * DIESEL_L_PER_KWH;
      const litres = Math.min(s.litres, litresNeeded);
      const kw = litresNeeded > 0 ? want * (litres / litresNeeded) : 0;
      s.litres -= litres;
      s.generating = kw;
      dayDieselL += litres;
      made += kw;
      if (s.litres <= 0.5 && s.tank > 0) {
        s.litres = 0;
        log.push({
          day: w.clock.dayIndex, kind: 'diesel-out',
          text: `${s.label} has run its tank dry. It is on whatever the network is giving it, which is nothing.`
        });
        w.bus.emit('power:diesel-out', { site: s.id, label: s.label });
      }
      if (made >= needKw) break;
    }
    return made;
  }

  /* -------------------------------------------------------------- shedding

  Who loses power, in the order the player set. Blocks are shed whole, because a distributor sheds
  feeders and not households, and because a half-shed block is not a thing that exists. */

  /**
   * Who loses power and for how long.
   *
   * A block that is shed stays shed for at least half an hour, because that is how a distributor
   * does it and because the alternative is what the first version of this file did: a shortfall
   * hovering around zero switched a feeder on and off every ten minutes, which is worse for the
   * equipment, worse for the people on the feeder, and unreadable in a log.
   */
  const SHED_HOLD_TICKS = 3;

  function shed(w, kwShort, byCategory) {
    const blocks = [];
    // Anything still inside its half hour stays off even if the shortfall has gone.
    let held = 0;
    for (const [id, until] of shedHold) {
      if (w.clock.tick >= until) { shedHold.delete(id); continue; }
      let kw = blockKw(id, byCategory);
      blocks.push({ id, kwShed: +kw.toFixed(1), whole: true, held: true });
      const s = siteById.get(id);
      if (s) s.on = false;
      held += kw;
    }
    if (kwShort <= 0.5) return blocks;
    let left = kwShort;
    for (const id of priority) {
      if (left <= 0.5) break;
      if (shedHold.has(id)) continue;
      const kw = blockKw(id, byCategory);
      if (kw <= 0.5) continue;
      const take = Math.min(kw, left);
      blocks.push({ id, kwShed: +take.toFixed(1), whole: take >= kw - 0.5, held: false });
      left -= take;
      shedHold.set(id, w.clock.tick + SHED_HOLD_TICKS);
      const s = siteById.get(id);
      if (s) s.on = false;
    }
    return blocks;
  }

  function blockKw(id, byCategory) {
    if (byCategory[id] != null) return byCategory[id];
    if (id === 'households-rotating') return byCategory.households + byCategory.climate;
    if (siteById.has(id)) return siteById.get(id).kw;
    return 0;
  }

  /* -------------------------------------------------------------- the honest arithmetic */

  function couldItRunItself(w) {
    const annualDemandKwh = demand365.filled > 30 ? demand365.total * (365 / demand365.filled) : 30000 * 365;
    const roofPotentialKwh = ROOF.potentialKwhDay * 365;
    const peakEveningKw = state.peakYesterdayKw || state.peakTodayKw || 2400;
    // How much storage it takes to carry the evening peak with no sun and no cable. Five hours of
    // the peak is the honest number: the sun is down from about six and the load does not fall
    // back to its overnight base until eleven.
    const storageForEveningKwh = peakEveningKw * 5;
    const builtKwh = householdKwh + criticalKwh;
    const energyPct = Math.round((roofPotentialKwh / Math.max(1, annualDemandKwh)) * 100);
    const storagePct = Math.round((builtKwh / Math.max(1, storageForEveningKwh)) * 100);
    return {
      annualDemandKwh: Math.round(annualDemandKwh),
      rooftopPotentialKwhYear: Math.round(roofPotentialKwh),
      energyCoveragePct: energyPct,
      eveningPeakKw: Math.round(peakEveningKw),
      storageNeededForOneEveningKwh: Math.round(storageForEveningKwh),
      storageBuiltKwh: Math.round(builtKwh),
      storageCoveragePct: storagePct,
      answer: `Every viable roof on the island would cover about ${energyPct} per cent of a year's `
        + 'energy, and the footprint rule in data/subterranean.json rules out clearing land for the '
        + `rest. That figure is lower than the pack's own estimate suggests, and the reason is `
        + 'visitors: the pack sized the roofs against a resident island and the island the rest of '
        + 'this simulation produces has holiday houses full for six weeks of the year.\n'
        + `On the evening peak, which is the hour the cable is sized for, the built storage covers `
        + `about ${storagePct} per cent of one evening. Panels do not move that number. Batteries do. `
        + 'A player who buys only panels watches self-sufficiency climb and watches the peak stay '
        + 'exactly where it was.',
      footprintRule: 'Zero square metres of new land cleared for energy, ever. Roofs, carports, '
        + 'sheds, tanks, structures, shorelines and swell only. (data/subterranean.json)',
      basis: 'Demand is this simulation\'s own rolling year. Rooftop potential is the pack\'s '
        + 'published estimate. The five-hour evening storage rule is modelled.'
    };
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'power',
    phase: 'infrastructure',
    order: 10,

    init(w) {
      rebuildSolar();
      // Where the batteries start. Household storage comes with the panels. The critical-site
      // batteries only exist if the civic lever is running, and the pack has that lever as a
      // modelled option with a 30 month lead, so on day one there are none.
      criticalKwh = 900 * L.level('island-energy-resilience');
      charge = (householdKwh + criticalKwh) * 0.6;

      const t = townships(w);
      if (!t.every((x) => x.found)) {
        notes.push('Some townships are missing coordinates in data/places.json, so the load is '
          + 'shared by the modelled split rather than by where the houses are.');
      }
      notes.push('The submarine cable in this file is modelled. data/civic.json says the island is '
        + 'fed from the mainland and states that the route, the feeder arrangement and the outage '
        + 'frequency were not verified. Nothing here should be read as a claim about the real network.');
      notes.push('No land is cleared for generation anywhere in this file. That is not a design '
        + 'preference, it is data/subterranean.json island_context.footprint_rule.');
      state.couldItRunItself = couldItRunItself(w);
      state.ready = true;
    },

    tick(w) {
      const day = w.clock.dayIndex;

      if (day !== lastDay) {
        // -------- the daily pass
        if (lastDay >= 0) {
          demand365.push(dayDemand);
          solar365.push(daySolar);
          dieselL365.push(dayDieselL);
          batteryCycles.push(dayCycleKwh / Math.max(1, householdKwh + criticalKwh));
          interruptions365.push(dayInterruptions);
          offMinutes365.push(dayOffMinutes);
          state.peakYesterdayKw = peakToday;
          state.today = {
            demandKwh: Math.round(dayDemand), solarKwh: Math.round(daySolar),
            importedKwh: Math.round(dayImport), dieselKwh: Math.round(dayDiesel),
            shedKwh: Math.round(dayShed), batteryKwh: Math.round(dayCycleKwh)
          };
          state.selfSufficiency.todayPct = +((daySolar - dayCurtailed) / Math.max(1, dayDemand) * 100).toFixed(1);
          state.selfSufficiency.rolling365Pct = +(solar365.total / Math.max(1, demand365.total) * 100).toFixed(1);
        }
        dayDemand = 0; daySolar = 0; dayImport = 0; dayDiesel = 0; dayShed = 0;
        dayCurtailed = 0; dayDieselL = 0; dayCycleKwh = 0; dayInterruptions = 0;
        dayOffMinutes = 0; peakToday = 0;
        lastDay = day;

        faultCheck(w);
        dailyWorks(w);
      }

      // -------- the ten-minute balance
      const d = computeDemand(w);
      const b = balance(w, d.total);

      if (d.total > peakToday) peakToday = d.total;
      dayDemand += d.total * TICK_HOURS;
      daySolar += b.solar * TICK_HOURS;
      dayCurtailed += b.curtailKw * TICK_HOURS;
      dayImport += Math.max(0, b.importKw) * TICK_HOURS;
      dayDiesel += b.dieselKw * TICK_HOURS;
      dayShed += b.shedKw * TICK_HOURS;
      if (b.batteryKw > 0) dayCycleKwh += b.batteryKw * TICK_HOURS;

      // Shedding, and the outage record that follows from it.
      for (const s of sites) s.on = true;
      const blocks = shed(w, b.shedKw, d.byCategory);
      const shedding = blocks.length > 0;
      if (shedding) {
        shedSinceMinutes += 10;
        outageMinutes += 10;
        if (!state.shedding.on) {
          dayInterruptions++;
          outageCause = circuits.some((c) => !c.up) ? 'a cable fault' : 'more load than the island can take';
          log.push({
            day, kind: 'shedding',
            text: `Load shedding started: ${Math.round(b.shedKw)} kW short, ${outageCause}. `
              + `${blocks.map((x) => x.id).join(', ')} are off.`
          });
          w.bus.emit('power:shedding', { kwShort: Math.round(b.shedKw), blocks: blocks.map((x) => x.id), cause: outageCause });
        }
      } else if (state.shedding.on) {
        if (outageMinutes > worstEventMinutes) worstEventMinutes = outageMinutes;
        log.push({ day, kind: 'restored', text: `Power restored after ${hoursMinutes(outageMinutes / 60)}.` });
        w.bus.emit('power:restored', { minutes: outageMinutes });
        if (outageMinutes > 240) {
          nudge(w, 'resident_amenity', -clamp(outageMinutes / 6000, 0.02, 0.12),
            `${hoursMinutes(outageMinutes / 60)} without power`, 'infrastructure/power.js', 150);
        }
        outageMinutes = 0; shedSinceMinutes = 0;
      }

      publish(w, d, b, blocks, shedding);
    },

    describe(w) {
      return {
        demandKw: Math.round(state.demandKw),
        peakKw: Math.round(state.peakTodayKw),
        circuitsUp: state.cable.up,
        importKw: Math.round(state.cable.importKw),
        firmUse: +state.cable.firmUtilisation.toFixed(2),
        solarKw: Math.round(state.solar.generatingKw),
        solarShare: +state.solar.share.toFixed(2),
        batteryPct: Math.round(state.battery.statePct),
        dieselKw: Math.round(state.diesel.runningKw),
        dieselHours: +state.diesel.hoursLeft.toFixed(1),
        shedKw: Math.round(state.shedding.kwShort),
        selfSuff365: state.selfSufficiency.rolling365Pct,
        minutesOff365: Math.round(state.reliability.minutesOffPerConnection365)
      };
    },

    save() {
      return {
        installedShare, criticalKwh, charge, priority: priority.slice(),
        circuits: circuits.map((c) => ({ up: c.up, repairDaysLeft: c.repairDaysLeft, faultsTotal: c.faultsTotal, hotHours: c.hotHours })),
        sites: sites.map((s) => ({ id: s.id, litres: s.litres })),
        peakToday, lastDay, worstEventMinutes, outageMinutes, shedHold: [...shedHold],
        dayOffMinutes, dayInterruptions, refuelLitres, refuelOrderedDay, batteryBuiltAnnounced,
        rings: {
          demand365: demand365.save(), solar365: solar365.save(), dieselL365: dieselL365.save(),
          offMinutes365: offMinutes365.save(), interruptions365: interruptions365.save(),
          batteryCycles: batteryCycles.save()
        }
      };
    },

    load(w, s) {
      if (!s) return;
      installedShare = s.installedShare ?? installedShare;
      rebuildSolar();
      criticalKwh = s.criticalKwh ?? criticalKwh;
      charge = s.charge ?? charge;
      priority = Array.isArray(s.priority) && s.priority.length ? s.priority.slice() : priority;
      state.shedding.priority = priority.slice();
      if (Array.isArray(s.circuits)) {
        for (let i = 0; i < circuits.length && i < s.circuits.length; i++) Object.assign(circuits[i], s.circuits[i]);
      }
      for (const row of s.sites || []) {
        const site = siteById.get(row.id);
        if (site) site.litres = row.litres;
      }
      peakToday = s.peakToday ?? 0;
      lastDay = s.lastDay ?? -1;
      worstEventMinutes = s.worstEventMinutes ?? 0;
      outageMinutes = s.outageMinutes ?? 0;
      dayOffMinutes = s.dayOffMinutes ?? 0;
      dayInterruptions = s.dayInterruptions ?? 0;
      refuelLitres = s.refuelLitres ?? 0;
      refuelOrderedDay = s.refuelOrderedDay ?? -1;
      batteryBuiltAnnounced = !!s.batteryBuiltAnnounced;
      shedHold.clear();
      for (const [k, v] of s.shedHold || []) shedHold.set(k, v);
      const r = s.rings || {};
      demand365.load(r.demand365); solar365.load(r.solar365); dieselL365.load(r.dieselL365);
      offMinutes365.load(r.offMinutes365); interruptions365.load(r.interruptions365);
      batteryCycles.load(r.batteryCycles);
    }
  });

  /* -------------------------------------------------------------- daily works */

  function dailyWorks(w) {
    // The civic lever delivers batteries and behind-the-meter solar at the critical sites over its
    // published 30 month lead. policy.js owns the delivery ramp; this reads the level it publishes.
    const lever = L.level('island-energy-resilience');
    const targetCriticalKwh = 900 * lever;
    criticalKwh += (targetCriticalKwh - criticalKwh) * 0.02;
    if (!batteryBuiltAnnounced && criticalKwh > 400) {
      batteryBuiltAnnounced = true;
      log.push({
        day: w.clock.dayIndex, kind: 'battery-built',
        text: 'Batteries are in at the water plants, the sewage plant, the clinic and the halls. '
          + 'They also need their own separation and their own fire plan, which is the part nobody photographs.'
      });
      // The pack's own side effect, in the pack's own words.
      nudge(w, 'fire_hazard_load', 0.05, 'batteries at the critical sites need their own fire plan',
        'infrastructure/power.js', 900);
      nudge(w, 'emergency_readiness', 0.20, 'critical sites can now ride through a cable fault',
        'infrastructure/power.js', 900);
    }

    // Diesel. Tanks are topped up when a delivery lands, and a delivery is a truck on the barge.
    const cross = crossing(w);
    const wantLitres = sites.reduce((a, s) => a + Math.max(0, s.tank - s.litres), 0);
    if (wantLitres > 900 && refuelLitres <= 0 && refuelOrderedDay < 0) {
      refuelLitres = wantLitres;
      refuelOrderedDay = w.clock.dayIndex;
      w.bus.emit('power:diesel-ordered', { litres: Math.round(wantLitres), costA$: Math.round(wantLitres * DIESEL_A$_PER_L) });
    }
    if (refuelLitres > 0 && refuelOrderedDay >= 0) {
      const waited = w.clock.dayIndex - refuelOrderedDay;
      // Two days for the order and the tanker slot, and it does not come at all on a day the
      // crossing is lost. This is the coupling that makes a gale and a cable fault the same event.
      if (waited >= 2 && cross.running) {
        let left = refuelLitres;
        for (const s of sites) {
          const room = Math.max(0, s.tank - s.litres);
          const take = Math.min(room, left);
          s.litres += take;
          left -= take;
        }
        w.bus.emit('civic:spend', {
          fund: 'council-island', amount: Math.round((refuelLitres - left) * DIESEL_A$_PER_L),
          label: 'standby generator fuel', kind: 'operating'
        });
        refuelLitres = 0;
        refuelOrderedDay = -1;
      } else if (waited > 9) {
        log.push({
          day: w.clock.dayIndex, kind: 'diesel-late',
          text: `The fuel for the standby generators has been waiting ${waited} days for a deck slot.`
        });
      }
    }

    state.couldItRunItself = couldItRunItself(w);
  }

  /* -------------------------------------------------------------- read model */

  function publish(w, d, b, blocks, shedding) {
    state.demandKw = d.total;
    state.demandByCategory = d.byCategory;
    state.peakTodayKw = peakToday;

    const up = circuits.filter((c) => c.up).length;
    state.cable.up = up;
    state.cable.totalKw = up * CABLE.ratingKw;
    state.cable.firmKw = Math.max(0, up - 1) * CABLE.ratingKw;
    state.cable.importKw = b.importKw;
    state.cable.utilisation = up ? b.importKw / (up * CABLE.ratingKw) : 0;
    // The number that matters and that nobody looks at: load against what the island would have if
    // one circuit went out right now. Above one, the next fault is an outage rather than an event.
    state.cable.firmUtilisation = CABLE.ratingKw > 0 ? d.total / ((CABLE.circuits - 1) * CABLE.ratingKw) : 0;
    state.cable.faulted = circuits.filter((c) => !c.up).map((c) => ({ circuit: c.id, repairDaysLeft: +c.repairDaysLeft.toFixed(1) }));
    state.cable.repairDaysLeft = state.cable.faulted.length ? state.cable.faulted[0].repairDaysLeft : 0;

    state.solar.installedKw = Math.round(installedKw);
    state.solar.share = installedShare;
    state.solar.generatingKw = b.solar;
    state.solar.generatedTodayKwh = Math.round(daySolar);
    state.solar.curtailedTodayKwh = Math.round(dayCurtailed);
    state.solar.shareOfDemandNow = d.total > 0 ? clamp(b.solar / d.total, 0, 2) : 0;

    const cap = householdKwh + criticalKwh;
    state.battery.capacityKwh = Math.round(cap);
    state.battery.chargeKwh = Math.round(charge);
    state.battery.statePct = cap > 0 ? (charge / cap) * 100 : 0;
    state.battery.flowKw = b.batteryKw;
    state.battery.householdKwh = Math.round(householdKwh);
    state.battery.criticalKwh = Math.round(criticalKwh);
    state.battery.hoursOfEveningPeak = state.peakYesterdayKw > 0 ? +(charge / state.peakYesterdayKw).toFixed(2) : 0;
    state.battery.cyclesRolling365 = +batteryCycles.total.toFixed(1);

    let litres = 0, capacityLitres = 0, runningKw = 0, dieselSites = 0;
    for (const s of sites) {
      litres += s.litres; capacityLitres += s.tank;
      runningKw += s.generating;
      if (s.dieselKw > 0) dieselSites++;
    }
    state.diesel.sites = dieselSites;
    state.diesel.runningKw = runningKw;
    state.diesel.litres = Math.round(litres);
    state.diesel.capacityLitres = capacityLitres;
    state.diesel.burnLPerHour = runningKw * DIESEL_L_PER_KWH;
    // Hours left is the question a player asks before the generators are running, not after, so it
    // is answered at the rate the sets would burn if they all started now rather than at zero.
    const standbyBurn = sites.reduce((a, x) => a + x.dieselKw, 0) * DIESEL_L_PER_KWH;
    const burn = state.diesel.burnLPerHour > 0.01 ? state.diesel.burnLPerHour : standbyBurn;
    state.diesel.hoursLeft = burn > 0.01 ? litres / burn : 0;
    state.diesel.hoursLabel = hoursMinutes(state.diesel.hoursLeft);
    state.diesel.running = runningKw > 0.5;
    state.diesel.litresBurnedRolling365 = Math.round(dieselL365.total);
    state.diesel.costRolling365A$ = Math.round(dieselL365.total * DIESEL_A$_PER_L);
    state.diesel.refuelOrdered = refuelLitres > 0;
    state.diesel.refuelDueInDays = refuelLitres > 0 ? Math.max(0, 2 - (w.clock.dayIndex - refuelOrderedDay)) : 0;

    state.shedding.on = shedding;
    state.shedding.kwShort = b.shedKw;
    state.shedding.blocks = blocks;
    state.shedding.sinceMinutes = shedSinceMinutes;

    state.outage.on = shedding;
    state.outage.cause = shedding ? outageCause : null;
    state.outage.minutes = outageMinutes;
    state.outage.sitesDown = sites.filter((s) => !s.on).map((s) => s.id);
    const pop = d.pop;
    state.outage.peopleAffected = shedding
      ? Math.round(pop.total * clamp(b.shedKw / Math.max(1, d.byCategory.households + d.byCategory.climate), 0, 1))
      : 0;

    // Reliability. Minutes off per connection over the rolling year, which is the number a
    // Queensland distributor publishes for every feeder and the one an islander can hold up against
    // a mainland suburb. A partial shed counts partially: if a third of the household load is off,
    // ten minutes of shedding is three and a third minutes off for a typical connection.
    const householdKw = Math.max(1, d.byCategory.households + d.byCategory.climate);
    const shareOff = clamp(b.shedKw / householdKw, 0, 1);
    if (shedding) dayOffMinutes += 10 * shareOff;
    state.reliability.minutesOffPerConnection365 = offMinutes365.total + dayOffMinutes;
    state.reliability.interruptions365 = interruptions365.total + dayInterruptions;
    state.reliability.worstEventMinutes = Math.max(worstEventMinutes, outageMinutes);
    const m = state.reliability.minutesOffPerConnection365;
    state.reliability.label = m < 60 ? 'better than most of the mainland'
      : m < 200 ? 'about what a rural feeder gets'
        : m < 600 ? 'poor: this is being noticed' : 'the island is talking about nothing else';

    state.inKettles.peakToday = kettles(peakToday);
    state.inKettles.rooftopNow = kettles(b.solar);

    state.selfSufficiency.note = installedShare > 0.6 && cap < state.peakYesterdayKw * 2
      ? 'Rooftop is high and storage is not. The daytime import is near nothing and the evening '
        + 'peak has not moved, so the cable is still sized for the same hour it always was.'
      : cap > state.peakYesterdayKw * 3
        ? 'There is enough storage here to carry an evening. That is the thing that shrinks the cable.'
        : 'Rooftop covers the middle of the day. The peak is after dark and the cable carries it.';

    state.events = log.recent(8);
  }
}
