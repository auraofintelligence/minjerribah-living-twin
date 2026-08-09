// Prices, freight and the island premium.
//
// THE ONE FACT THIS FILE EXISTS FOR
//   data/transport.json structural_facts.no-bridge: "There is no bridge to Minjerribah. Every
//   vehicle, every person and all freight crosses by boat." Everything a shop sells arrives on a
//   deck with a published capacity, on a timetable, in weather that sometimes says no.
//
// WHY THIS IS NOT A MULTIPLIER
//   The easy version of an island economy is `price = mainland * 1.25`. That is wrong in a way a
//   player can never learn anything from, because it cannot be attacked. Here the premium is built
//   out of five separate components, each with its own cause and its own lever:
//
//     1. freight            the crossing itself: barge frequency, deck space won, diesel
//     2. buying power       two small supermarkets do not buy at chain scale
//     3. island operating   wages where there is no labour pool, power, rent, waste haulage
//     4. spoilage           a four-day fresh cycle throws away what a daily cycle would sell
//     5. thin competition   one island, two supermarkets, no third bidder
//
//   Only the first responds to a freight subsidy. data/civic.json carries a lever called
//   `freight-and-cost-of-living` costed at A$1.2 m a year, and a player who pulls it and watches
//   the shelf price barely move has learned something true about this island. That is the point of
//   splitting the premium rather than asserting it.
//
// AND WHY A CANCELLED CROSSING IS A DIFFERENT FAILURE
//   Three cancelled days do not raise the price. They empty the shelf. Price and availability are
//   separate outputs here because on this island they fail separately, and the freight backlog this
//   file carries is what businesses.js turns into a pub with no beer on the Saturday of a long
//   weekend.
//
// WHAT IS PUBLISHED AND WHAT IS MODELLED
//   Published (data/transport.json, confidence high):
//     the vehicle ferry timetable, the two-vessel alternating rotation, vessel car capacities
//     (Minjerribah 52, Sea Breeze 60, Quandamooka 52), the derived daily ceiling of 560 car slots
//     each way, the walk-on freight rule, the list of items never carried as walk-on freight, and
//     that emergency vehicles displace booked cars.
//   Published with the pack's own low-confidence flag:
//     the commercial vehicle rate of about A$26 per metre. The pack says treat it as an order of
//     magnitude, not a price. This file does, and says so in the read model.
//   Modelled here, and labelled as modelled everywhere it surfaces:
//     diesel and petrol prices, the carriers' run frequency and load, the mainland basket, and
//     every one of the five premium components. No fuel price, freight rate or grocery price for
//     this island is published anywhere that was found.
//
// Reads: weather (crossingCondition), visitors (deck slots already sold), schedule (boats running),
//        clock. Publishes `prices`. Listens for `freight:order`, emits `freight:delivered`,
//        `freight:bumped`, `freight:crossing-lost`.

import { clamp, round2, Rolling, STOCK_LINES } from './common.js';

/* ------------------------------------------------------------------ modelling constants

Every number in this block is a modelling estimate. None of it is a quoted price. */

const CAR_LANE_M = 5.4;            // the vehicle length limit published for the long term car park
const TRUCK_LANE_M = 19;           // "a semi-trailer combination at about 19 m", data/transport.json
const TRUCK_PAYLOAD_KG = 21000;    // modelled
const RATE_PER_LANE_M = 26;        // data/transport.json, flagged low confidence by the pack itself
const MAINLAND_HAUL_PER_RUN = 420; // modelled: pickup, driver hours, double handling
const DIESEL_L_PER_RUN = 42;       // modelled: the mainland leg plus the island delivery round

/** Carrier runs booked island-bound per weekday. Modelled. Sunday is the island's thin day and
 *  that is why a long weekend hurts: the Monday public holiday takes the next one out too. */
const CARRIER_RUNS = [0, 3, 3, 3, 3, 2, 1];   // sun .. sat

/** Litres of fuel a tanker brings, and how often one is booked. Modelled. */
const TANKER_LITRES = 26000;
const TANKER_DAYS = [2, 5];                    // Tuesday and Friday, modelled

/** Where the mainland shelf price sits before the island touches it. Modelled reference basket. */
const MAINLAND_BASKET = 148;                   // A$ for a modelled thirty-item weekly basket
const MAINLAND_FUEL = 1.92;                    // A$ per litre, modelled base

export function registerPrices(world) {
  const rng = world.rng.stream('prices');

  const state = world.publish('prices', {
    ready: false,
    day: null,
    basis: 'Every price in this read model is modelled. No grocery price, fuel price or freight rate '
      + 'is published for this island. The timetable, the vessel capacities and the freight rules '
      + 'behind them are published: see data/transport.json.',

    /** The one number other systems already read. 1.0 is a normal week. */
    freightIndex: 1,

    crossings: {
      scheduledToday: 0, ranToday: 0, lostToday: 0,
      condition: 'good', consecutiveLostDays: 0, lastLostDay: null,
      laneMetresToday: 0, laneMetresSold: 0, utilisation: 0,
      carSlotsPerDay: 0, basis: ''
    },

    freight: {
      runsScheduledToday: 0, runsRanToday: 0, runsBumpedToday: 0,
      ordersWaiting: 0, kgWaiting: 0, oldestOrderDays: 0,
      backlogDays: 0, deliveredToday: 0, kgDeliveredToday: 0,
      walkOnItemsToday: 0,
      costPerKgA$: 0, costPerRunA$: 0
    },

    fuel: {
      mainlandA$L: MAINLAND_FUEL, islandA$L: 0, premiumA$L: 0, premiumPct: 0,
      tankerDueInDays: 0, basis: 'modelled'
    },

    basket: {
      mainlandA$: MAINLAND_BASKET, islandA$: 0, premiumPct: 0,
      shareOfMedianIncomePct: 0,
      components: []
    },

    /** The five premium components, in percentage points on the mainland basket. */
    premium: { freight: 0, buyingPower: 0, islandOperating: 0, spoilage: 0, competition: 0, total: 0 },

    costOfLivingIndex: 1,
    outages: [],
    notes: []
  });

  /* -------------------------------------------------------------- the timetable */

  const timetable = { byDow: [0, 0, 0, 0, 0, 0, 0], carsByDow: [0, 0, 0, 0, 0, 0, 0], basis: '', published560: false };

  function readTimetable(w) {
    const pack = w.data.transport;
    const svc = pack && pack.services && pack.services.find((s) => s.type === 'vehicle-ferry');
    if (!svc) {
      state.notes.push('data/transport.json has no vehicle ferry: the freight model is running on modelled sailings.');
      for (let d = 0; d < 7; d++) { timetable.byDow[d] = 10; timetable.carsByDow[d] = 560; }
      timetable.basis = 'modelled: the pack was missing';
      return;
    }
    const vessels = new Map();
    for (const v of (svc.capacity && svc.capacity.vessels) || []) vessels.set(v.id, v.cars || 52);
    const base = (svc.schedule && svc.schedule.variants || []).find((v) => v.id === 'base');
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (const sail of (base && base.cleveland_to_dunwich) || []) {
      const cars = vessels.get(sail.vessel) || 52;
      for (let d = 0; d < 7; d++) {
        if (!sail.days || sail.days.includes(keys[d])) { timetable.byDow[d]++; timetable.carsByDow[d] += cars; }
      }
    }
    const pub = base && base.daily_capacity_each_way_cars;
    timetable.published560 = !!(pub && pub.mon_to_sat);
    timetable.basis = 'derived from the published base timetable and the published vessel capacities in data/transport.json';
    if (pub && pub.mon_to_sat && Math.abs(timetable.carsByDow[1] - pub.mon_to_sat) > 2) {
      state.notes.push(`derived Monday car capacity ${timetable.carsByDow[1]} against the pack's published ${pub.mon_to_sat}: check the timetable read.`);
    }
  }

  /* -------------------------------------------------------------- the freight queue

  businesses.js emits `freight:order` and never learns how the crossing works. This file holds the
  queue, wins or loses deck space, and emits `freight:delivered` with the same order id. The bus is
  the whole interface, which is why neither file imports the other. */

  const queue = [];         // orders waiting for a crossing
  let orderSeq = 0;
  const kgLanded = new Rolling(14);
  let lostRunBacklog = 0;   // carrier runs owed from cancelled or bumped days

  world.bus.on('freight:order', (o) => {
    if (!o || !o.businessId) return;
    const line = STOCK_LINES[o.line] || STOCK_LINES.dry;
    const kg = Math.max(1, (o.units || 0) * (line.kgPerUnit || 1));
    queue.push({
      id: ++orderSeq,
      businessId: o.businessId,
      line: o.line,
      units: o.units || 0,
      kg,
      freightClass: line.freightClass,
      orderedDay: world.clock.dayIndex,
      urgent: !!o.urgent
    });
    // A queue that can grow without bound is a bug waiting for a long simulation. Beyond this the
    // oldest non-urgent orders are written off as cancelled by the business, which is what a real
    // shopkeeper does when a delivery is three weeks late: they stop waiting and reorder.
    if (queue.length > 2400) {
      const drop = queue.splice(0, 400);
      world.bus.emit('freight:abandoned', { orders: drop.length });
    }
  });

  /* -------------------------------------------------------------- fuel */

  let mainlandFuel = MAINLAND_FUEL;
  let fuelPhase = rng.range(0, Math.PI * 2);

  function stepFuel(dayIndex) {
    // A slow seasonal swing plus a bounded random walk. Modelled, and bounded so a long run cannot
    // drift to nonsense: 40,000 ticks of an unbounded walk is how a sim-year ends up with A$9 petrol.
    fuelPhase += 0.0172;
    const seasonal = Math.sin(fuelPhase) * 0.09;
    mainlandFuel = clamp(mainlandFuel + rng.range(-0.012, 0.012), MAINLAND_FUEL - 0.22, MAINLAND_FUEL + 0.34);
    return round2(clamp(mainlandFuel + seasonal, 1.62, 2.42));
  }

  /* -------------------------------------------------------------- daily settlement */

  let lastDay = -1;
  let tankerDue = 0;
  const backlogHistory = new Rolling(7);
  let freightIndexNow = 1;

  function settleDay(w) {
    const dow = w.clock.dayOfWeek;
    const weather = w.read('weather') || {};
    const sched = w.read('schedule');
    const vis = w.read('visitors') || {};

    const condition = weather.crossingCondition || 'good';
    const boatsRunning = sched ? sched.boatsRunning !== false : condition !== 'cancelled';

    // --- how much deck there is, and how much of it is already sold to cars
    const scheduled = timetable.byDow[dow] || 10;
    const carSlots = timetable.carsByDow[dow] || 560;
    let ran = scheduled;
    let lost = 0;
    if (!boatsRunning || condition === 'cancelled') { ran = 0; lost = scheduled; }
    else if (condition === 'rough') {
      // The pack's own note: above a modelled 25 knot sustained wind the crossing slows and loading
      // of high-sided vehicles can be suspended. A high-sided vehicle is exactly what a freight
      // truck is, so a rough day is a bad freight day before it is a bad passenger day.
      lost = Math.min(scheduled, 1 + (rng.float() < 0.35 ? 1 : 0));
      ran = scheduled - lost;
    }

    const laneMetres = ran * (carSlots / Math.max(1, scheduled)) * CAR_LANE_M;

    // Visitor vehicles that took deck space. visitors.js publishes what is left of the day's slots.
    const capSlots = (vis.capacity && vis.capacity.vehicleSlotsPerDay) || carSlots;
    const left = vis.manifest && Number.isFinite(vis.manifest.vehicleSlotsLeft) ? vis.manifest.vehicleSlotsLeft : capSlots;
    const visitorVehicles = clamp(capSlots - left, 0, capSlots);
    // Residents, tradespeople, deliveries of the kind that ride in a ute, and the council's own
    // plant. Modelled from the published travel-to-work shares: about one worker in twenty drives
    // to a ferry, and the island's own traffic crosses for appointments, shopping and school sport.
    const residentVehicles = 105 + (dow === 0 || dow === 6 ? 35 : 0);

    const soldMetres = (visitorVehicles + residentVehicles) * CAR_LANE_M;
    const freeMetres = Math.max(0, laneMetres - soldMetres);
    const utilisation = laneMetres > 0 ? clamp(soldMetres / laneMetres, 0, 1.4) : 1;

    // --- the carriers' runs. A carrier books today's own runs plus whatever it is owed from a day
    //     it lost, capped: nobody catches up nine runs in one Tuesday.
    const runsScheduled = CARRIER_RUNS[dow] + Math.min(3, lostRunBacklog);
    let runsRan = 0;
    if (ran > 0) {
      // A truck needs its 19 m and it needs it on a sailing that is not sold out. On a peak Friday
      // the deck goes to booked cars and the carrier's run rolls to the next working day, which is
      // exactly the published behaviour: "A busy long weekend pushes deliveries to Tuesday, which
      // is why the shops run thin by Sunday night."
      runsRan = Math.max(0, Math.min(runsScheduled, Math.floor(freeMetres / TRUCK_LANE_M)));
    }
    const runsBumped = runsScheduled - runsRan;
    lostRunBacklog = clamp(lostRunBacklog + CARRIER_RUNS[dow] - runsRan, 0, 9);
    if (ran === 0 && CARRIER_RUNS[dow] > 0) {
      w.bus.emit('freight:crossing-lost', {
        day: w.clock.formatDate(), runs: CARRIER_RUNS[dow],
        why: condition === 'cancelled' ? 'the crossing was cancelled' : 'no sailings ran'
      });
    } else if (runsBumped > 0) {
      w.bus.emit('freight:bumped', { runs: runsBumped, why: 'the vehicle deck was sold out', utilisation: +utilisation.toFixed(2) });
    }

    if (lost > 0) {
      state.crossings.consecutiveLostDays = ran === 0 ? state.crossings.consecutiveLostDays + 1 : 0;
      if (ran === 0) state.crossings.lastLostDay = w.clock.formatDate();
    } else {
      state.crossings.consecutiveLostDays = 0;
    }

    // --- land what fits
    let capacityKg = runsRan * TRUCK_PAYLOAD_KG;
    // The walk-on path. Published rule: on this route walk-on freight rides the passenger ferry,
    // may travel unaccompanied, and is charged per item. A pharmacy order goes that way and a keg
    // never does, which is why the chemist rarely runs out and the pub does.
    const walkOnKg = boatsRunning ? 900 : 0;
    let walkOnLeft = walkOnKg;
    let walkOnItems = 0;

    let landedKg = 0, landed = 0;
    // Urgent first, then oldest first. Deterministic: a stable sort over an insertion-ordered array.
    queue.sort((a, b) => (b.urgent - a.urgent) || (a.orderedDay - b.orderedDay) || (a.id - b.id));
    for (let i = 0; i < queue.length; i++) {
      const o = queue[i];
      if (o.freightClass === 'walk-on') {
        if (o.kg > walkOnLeft) continue;
        walkOnLeft -= o.kg; walkOnItems++;
      } else if (o.freightClass === 'tanker') {
        if (!tankerDue || !TANKER_DAYS.includes(dow) || ran === 0) continue;
      } else {
        if (o.kg > capacityKg) continue;
        capacityKg -= o.kg;
      }
      o.landed = true;
      landedKg += o.kg; landed++;
      w.bus.emit('freight:delivered', {
        id: o.id, businessId: o.businessId, line: o.line, units: o.units,
        waitedDays: w.clock.dayIndex - o.orderedDay
      });
    }
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].landed) queue.splice(i, 1);

    if (TANKER_DAYS.includes(dow) && ran > 0) tankerDue = 0; else tankerDue++;

    // --- the numbers the rest of the island reads
    let oldest = 0, waitingKg = 0;
    for (const o of queue) {
      const age = w.clock.dayIndex - o.orderedDay;
      if (age > oldest) oldest = age;
      waitingKg += o.kg;
    }
    kgLanded.push(landedKg);
    const dailyThroughput = Math.max(1, kgLanded.mean);
    const backlogDays = clamp(waitingKg / dailyThroughput, 0, 21);
    backlogHistory.push(backlogDays);
    // The index reads the smoothed backlog, not today's. There is no carrier run on a Sunday, so a
    // Sunday morning always has a day's orders sitting in the queue, and reading that raw put the
    // whole island's household freight pressure up every weekend for no reason anybody could see.

    state.crossings.scheduledToday = scheduled;
    state.crossings.ranToday = ran;
    state.crossings.lostToday = lost;
    state.crossings.condition = condition;
    state.crossings.laneMetresToday = Math.round(laneMetres);
    state.crossings.laneMetresSold = Math.round(soldMetres);
    state.crossings.utilisation = +utilisation.toFixed(2);
    state.crossings.carSlotsPerDay = carSlots;
    state.crossings.basis = timetable.basis;

    state.freight.runsScheduledToday = runsScheduled;
    state.freight.runsRanToday = runsRan;
    state.freight.runsBumpedToday = runsBumped;
    state.freight.ordersWaiting = queue.length;
    state.freight.kgWaiting = Math.round(waitingKg);
    state.freight.oldestOrderDays = oldest;
    state.freight.backlogDays = +backlogDays.toFixed(2);
    state.freight.deliveredToday = landed;
    state.freight.kgDeliveredToday = Math.round(landedKg);
    state.freight.walkOnItemsToday = walkOnItems;

    // --- what the crossing costs per kilogram, which is the whole freight component of the premium
    const diesel = stepFuel(w.clock.dayIndex);
    state.fuel.mainlandA$L = diesel;
    const runCost = TRUCK_LANE_M * RATE_PER_LANE_M * 2 + MAINLAND_HAUL_PER_RUN + DIESEL_L_PER_RUN * diesel;
    // A bumped run still costs the carrier its driver and most of its day, and that goes on the
    // invoice. Loading half a truck costs nearly what loading a full one does.
    //
    // The floor of 0.72 is doing real work and should not be read as a fudge. A carrier consolidates
    // the whole island onto one deck: building materials, council plant, private orders, the tip's
    // outbound load, and the retail stock this simulation models. Only that last slice is in
    // `landedKg`, so measuring load utilisation against it alone would say the trucks run near empty
    // and would put the freight component of the shelf premium at three times what it is.
    const effectiveRuns = Math.max(0.5, runsRan);
    const utilisationOfLoad = clamp(landedKg / (effectiveRuns * TRUCK_PAYLOAD_KG), 0.72, 1);
    const costPerKg = runCost / (TRUCK_PAYLOAD_KG * utilisationOfLoad);
    state.freight.costPerRunA$ = Math.round(runCost);
    state.freight.costPerKgA$ = round2(costPerKg * 100) / 100;

    // --- island fuel at the pump
    const tankerAdder = (TRUCK_LANE_M * RATE_PER_LANE_M * 2 + MAINLAND_HAUL_PER_RUN) / TANKER_LITRES;
    const smallSiteMargin = 0.21;   // modelled: three sites, low throughput, no chain rebate
    const island = diesel + tankerAdder + smallSiteMargin + clamp(backlogDays, 0, 6) * 0.012;
    state.fuel.islandA$L = round2(island);
    state.fuel.premiumA$L = round2(island - diesel);
    state.fuel.premiumPct = Math.round(((island / diesel) - 1) * 1000) / 10;
    state.fuel.tankerDueInDays = tankerDue;

    // --- the five components of the shelf premium, in percentage points on the mainland basket
    const freightPts = clamp(costPerKg * 42, 2.2, 14);              // 42 modelled kg in the basket
    const buyingPowerPts = 7.4;                                     // modelled: no chain scale
    const operatingPts = 5.8 + clamp((backlogDays - 1) * 0.35, 0, 2.5);
    const spoilagePts = 1.6 + clamp(backlogDays * 0.55, 0, 4.5);    // a long gap throws fresh away
    const competitionPts = 4.2;
    const totalPts = freightPts + buyingPowerPts + operatingPts + spoilagePts + competitionPts;

    state.premium.freight = +freightPts.toFixed(1);
    state.premium.buyingPower = buyingPowerPts;
    state.premium.islandOperating = +operatingPts.toFixed(1);
    state.premium.spoilage = +spoilagePts.toFixed(1);
    state.premium.competition = competitionPts;
    state.premium.total = +totalPts.toFixed(1);

    const basket = MAINLAND_BASKET * (1 + totalPts / 100);
    state.basket.islandA$ = round2(basket);
    state.basket.premiumPct = +totalPts.toFixed(1);
    // Published: island median weekly household income A$1,147 against Queensland's A$1,675.
    // A basket that costs a quarter more on half the income is the cost of living argument entire.
    state.basket.shareOfMedianIncomePct = +((basket / 1147) * 100).toFixed(1);
    state.basket.components = [
      { id: 'freight', label: 'Getting it across the bay', pts: +freightPts.toFixed(1), a$: round2(MAINLAND_BASKET * freightPts / 100), lever: 'a freight subsidy or a consolidated run moves this one' },
      { id: 'buyingPower', label: 'Buying in small quantities', pts: buyingPowerPts, a$: round2(MAINLAND_BASKET * buyingPowerPts / 100), lever: 'only a buying group or a bigger store moves this one' },
      { id: 'islandOperating', label: 'Running a shop out here', pts: +operatingPts.toFixed(1), a$: round2(MAINLAND_BASKET * operatingPts / 100), lever: 'worker housing and cheaper power move this one' },
      { id: 'spoilage', label: 'What gets thrown out', pts: +spoilagePts.toFixed(1), a$: round2(MAINLAND_BASKET * spoilagePts / 100), lever: 'more frequent deliveries move this one' },
      { id: 'competition', label: 'One island, two supermarkets', pts: competitionPts, a$: round2(MAINLAND_BASKET * competitionPts / 100), lever: 'nothing on the council list moves this one' }
    ];

    // --- the index everything else reads. 1.0 is a normal week; needs.js turns anything above
    //     that into household pressure, so it is bounded on purpose.
    const smoothedBacklog = backlogHistory.mean;
    const idx = 1
      + clamp(smoothedBacklog, 0, 8) * 0.055
      + clamp(state.crossings.consecutiveLostDays, 0, 4) * 0.075
      + clamp((diesel - MAINLAND_FUEL) / MAINLAND_FUEL, -0.2, 0.3) * 0.35
      + clamp(utilisation - 0.75, 0, 0.5) * 0.18;
    // Eased rather than stepped: a household does not feel a freight backlog the morning it starts.
    freightIndexNow = freightIndexNow + (clamp(idx, 0.92, 1.95) - freightIndexNow) * 0.35;
    state.freightIndex = round2(freightIndexNow);
    state.freight.backlogDaysSmoothed = +smoothedBacklog.toFixed(2);
    state.costOfLivingIndex = round2(clamp((basket / MAINLAND_BASKET) * (1 + (state.freightIndex - 1) * 0.25), 1, 1.9));

    // --- outages a player can read. Kept short and kept honest.
    state.outages = [];
    if (state.crossings.consecutiveLostDays >= 1) {
      state.outages.push({
        kind: 'crossing', days: state.crossings.consecutiveLostDays,
        text: state.crossings.consecutiveLostDays === 1
          ? 'No barge today. The wind stopped the crossing.'
          : `No barge for ${state.crossings.consecutiveLostDays} days. Nothing is coming across.`
      });
    }
    if (runsBumped > 0 && ran > 0) {
      state.outages.push({ kind: 'deck', runs: runsBumped, text: `${runsBumped} freight run${runsBumped > 1 ? 's' : ''} bumped: the deck was full of cars.` });
    }
    if (backlogDays > 2.5) {
      state.outages.push({ kind: 'backlog', days: +backlogDays.toFixed(1), text: `Deliveries are running about ${backlogDays.toFixed(1)} days behind.` });
    }

    state.day = w.clock.formatDate();
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'prices',
    phase: 'economy',
    order: 10,

    init(w) {
      readTimetable(w);
      state.notes.push('Every price here is modelled. The timetable, the vessel capacities and the walk-on freight rule behind them are published in data/transport.json.');
      state.notes.push('The commercial vehicle rate of about A$26 per lane metre is carried in data/transport.json at low confidence, and the pack says to treat it as an order of magnitude rather than a price.');
      settleDay(w);
      lastDay = w.clock.dayIndex;
      state.ready = true;
      w.bus.emit('prices:ready', { carSlotsPerDay: state.crossings.carSlotsPerDay });
    },

    tick(w) {
      if (w.clock.dayIndex === lastDay) return;
      lastDay = w.clock.dayIndex;
      settleDay(w);
    },

    describe() {
      return {
        freightIndex: state.freightIndex,
        basketA$: state.basket.islandA$,
        premiumPct: state.basket.premiumPct,
        fuelA$L: state.fuel.islandA$L,
        crossings: `${state.crossings.ranToday}/${state.crossings.scheduledToday}`,
        deckUse: state.crossings.utilisation,
        runsBumped: state.freight.runsBumpedToday,
        backlogDays: state.freight.backlogDays,
        ordersWaiting: state.freight.ordersWaiting,
        lostDays: state.crossings.consecutiveLostDays
      };
    },

    save() {
      return {
        mainlandFuel, fuelPhase, tankerDue, lostRunBacklog, orderSeq, freightIndexNow,
        queue: queue.map((o) => [o.id, o.businessId, o.line, o.units, o.kg, o.freightClass, o.orderedDay, o.urgent ? 1 : 0]),
        kgLanded: kgLanded.save()
      };
    },

    load(w, s) {
      if (!s) return;
      // Force a settle on the next tick rather than waiting for the next sim-day boundary.
      lastDay = -1;
      mainlandFuel = s.mainlandFuel ?? mainlandFuel;
      freightIndexNow = s.freightIndexNow ?? freightIndexNow;
      state.freightIndex = round2(freightIndexNow);
      fuelPhase = s.fuelPhase ?? fuelPhase;
      tankerDue = s.tankerDue | 0;
      lostRunBacklog = s.lostRunBacklog | 0;
      orderSeq = s.orderSeq | 0;
      queue.length = 0;
      for (const r of s.queue || []) {
        queue.push({ id: r[0], businessId: r[1], line: r[2], units: r[3], kg: r[4], freightClass: r[5], orderedDay: r[6], urgent: !!r[7] });
      }
      kgLanded.load(s.kgLanded);
    }
  });
}
