// Tourism: what the visitors spend, how much of it stays, and what runs out first.
//
// WHAT THIS FILE IS NOT
//   It is not the visitor population. src/systems/agents/visitors.js owns who is here, where they
//   are sleeping and when they leave, and it does that well. This file reads that population and
//   answers three economic questions it deliberately does not:
//
//     1. where does the money land, by category and by township
//     2. how much of it stays on the island, which is a completely different number
//     3. what physically runs out before the money does
//
// THE NUMBER THIS FILE EXISTS FOR
//   375,000 visitors a year (2018, the most recent public figure found, in 2018 dollars) at a
//   published median of A$120 a day tripper and A$172 an overnight visitor is a large gross number
//   sitting on top of an island whose published median household income is A$1,147 a week against
//   Queensland's A$1,675. Both of those are real. The thing that reconciles them is capture: how
//   much of a visitor dollar stays here rather than going straight back across the bay.
//
//   A day tripper's A$120 includes a ferry fare to a company whose terminal is on the mainland.
//   A family in a holiday house brings a week of groceries from a Redlands supermarket, and
//   data/residents.json says so in the archetype's own friction list: "brings a week of groceries
//   and still needs the local shop". A holiday house booking pays an agent, a cleaner and a rates
//   notice, and the rest goes to an owner who very often does not live here.
//
//   So this file tracks two totals, always, side by side: what was spent, and what stayed. Every
//   capture rate below is modelled and labelled as modelled. No capture study exists for this island.
//
// WHAT RUNS OUT
//   Ferry seats and vehicle slots (published capacities, read from visitors.js).
//   Campsites (published site counts, read from visitors.js).
//   Parking at Point Lookout, which is the honest gap in the pack and is handled as one: the
//   transport pack says plainly "UNVERIFIED. No published bay count for any Point Lookout car park
//   or street... everyone who lives there knows the answer and nobody has published it." The bay
//   count here is therefore a modelling parameter carried on the read model with that quote
//   attached, and the search times and walk-in distances are the pack's own modelled ranges.
//   Toilets, because the day tripper's published load profile is toilets high, spend low, and the
//   gap between those two is the island's oldest argument about visitors.
//
// Reads: visitors, prices, weather, population, clock. Publishes `tourism`.
// Emits: `tourism:parking-full`, `tourism:capacity-lost`.

import { clamp, lerp, round2, hourWeight, dayShape, Rolling, TOWNSHIP_IDS } from './common.js';
import { makeCalendar } from '../agents/calendar.js';

/* ------------------------------------------------------------------ where a visitor dollar goes

Rows are the nine archetypes in data/residents.json. Columns sum to 1 and are a modelling split of
the published per-person spend bands in that pack. `capture` is the share of each category's dollar
that stays on the island: wages, margin, local supply and local rates, but not the cost of goods
that came over on the barge and not a payment to a company with a mainland address.

MODELLED. Every number in this table. The published figures are the totals, not the splits. */

const SPLIT = {
  'day-tripper': {
    travel: 0.20, hospitality: 0.46, groceries: 0.06, retail: 0.13, tours: 0.15, accommodation: 0, fuel: 0
  },
  'family-in-a-holiday-house': {
    travel: 0.14, accommodation: 0.42, hospitality: 0.16, groceries: 0.08, broughtWithThem: 0.11, retail: 0.05, tours: 0.02, fuel: 0.02
  },
  'weekend-camper': {
    travel: 0.20, accommodation: 0.19, hospitality: 0.14, groceries: 0.20, broughtWithThem: 0.15, retail: 0.05, tours: 0.02, fuel: 0.05
  },
  surfer: {
    travel: 0.26, accommodation: 0.10, hospitality: 0.40, groceries: 0.12, retail: 0.08, tours: 0, fuel: 0.04
  },
  'whale-watcher': {
    travel: 0.22, accommodation: 0.10, hospitality: 0.32, groceries: 0.05, retail: 0.13, tours: 0.18, fuel: 0
  },
  'school-group': {
    travel: 0.30, accommodation: 0.24, hospitality: 0.14, groceries: 0.14, retail: 0.04, tours: 0.14, fuel: 0
  },
  backpacker: {
    travel: 0.18, accommodation: 0.30, hospitality: 0.26, groceries: 0.14, retail: 0.04, tours: 0.08, fuel: 0
  },
  'tradesperson-from-the-mainland': {
    travel: 0.34, accommodation: 0.16, hospitality: 0.26, groceries: 0.14, retail: 0.04, tours: 0, fuel: 0.06
  },
  'grey-nomad': {
    travel: 0.16, accommodation: 0.26, hospitality: 0.18, groceries: 0.16, broughtWithThem: 0.12, retail: 0.08, tours: 0.02, fuel: 0.02
  }
};

/*
`broughtWithThem` is the line that reconciles a large visitor spend with a small island economy, and
it is not a modelling convenience: data/residents.json puts it in the archetype's own friction list.
A family in a holiday house "brings a week of groceries and still needs the local shop". A camper
brings the esky and buys ice. That spend is real, it is counted in the published median, and it
happened at a Redlands supermarket on the way to the terminal. It lands on no island business and
its capture rate is zero, which is the whole point of tracking it separately rather than quietly
deleting it from the total. */

/** Share of a dollar in this category that stays on the island. Modelled. */
const CAPTURE = {
  travel: 0.20,        // crew wages and local supply; the operator's terminal is at Cleveland
  accommodation: 0.52, // agent commission, cleaner, linen, rates; the owner's return often leaves
  hospitality: 0.62,   // wages and margin stay; the food and the beer came over on the barge
  groceries: 0.34,     // most of a grocery dollar is the goods, and the goods are imported
  retail: 0.46,        // higher for the galleries and the makers, lower for imported giftware
  tours: 0.72,         // guides, fuel, vehicles: the most island-heavy dollar a visitor spends
  fuel: 0.20,          // the fuel itself came over in a tanker
  broughtWithThem: 0   // bought on the mainland before they got on the boat
};

/** Campground bookings run through Minjerribah Camping, which is on the island, so a camper's
 *  accommodation dollar stays far better than a holiday house booking does. Modelled. */
const CAPTURE_OVERRIDE = {
  'weekend-camper': { accommodation: 0.84 },
  'grey-nomad': { accommodation: 0.84 },
  'school-group': { accommodation: 0.84 },
  backpacker: { accommodation: 0.74 },
  'family-in-a-holiday-house': { accommodation: 0.45 }
};

/** Which of the six business-facing categories a spend category feeds. `travel` feeds none of
 *  them: the ferry operator is not a shop and its revenue is tracked on its own line. */
const TO_BUSINESS = { accommodation: 'accommodation', hospitality: 'hospitality', groceries: 'groceries', retail: 'retail', tours: 'tours', fuel: 'fuel' };

/* ------------------------------------------------------------------ what runs out

Parking at Point Lookout. The pack's own words are carried through to the read model, because the
honest thing to do with an unpublished number is to say which number is unpublished. */

const PARKING = {
  bays: 232,
  basis: 'MODELLED. data/transport.json parking-point-lookout-peak: "UNVERIFIED. No published bay '
    + 'count for any Point Lookout car park or street." The 232 bays here cover the Gorge Walk car '
    + 'park and kerbside on Mooloomba Road, Dickson Way and Cumming Parade, and are a parameter, '
    + 'not a measurement.',
  searchOffPeakMin: [0, 2],   // published as modelled_parameters in the pack
  searchPeakMin: [6, 20],
  walkInPeakM: [200, 900]
};

/** Share of the visitor vehicles at Point Lookout that are looking for a bay in the headland
 *  precinct at any one hour, rather than parked at the house they are staying in. Modelled. */
const PRECINCT_SHARE = 0.42;

/** Public toilet capacity at the visitor pinch points. Modelled: no published count was found. */
const TOILETS = { blocks: 9, peoplePerBlockPerDay: 420, costPerBlockPerDayA$: 145 };

export function registerTourism(world) {

  const state = world.publish('tourism', {
    ready: false,
    day: null,
    basis: 'Visitor totals and the two median spend figures are published (2018, in 2018 dollars). '
      + 'Every split, every capture rate and the Point Lookout bay count are modelled.',

    onIsland: 0,
    spendTodayA$: 0,
    capturedTodayA$: 0,
    leakedTodayA$: 0,
    captureRate: 0,
    spendRolling365A$: 0,
    capturedRolling365A$: 0,
    visitorDaysRolling365: 0,
    perVisitorDayA$: 0,

    byArchetype: {},          // id -> {people, spendA$, capturedA$, captureRate}
    byCategory: {},           // travel/accommodation/hospitality/groceries/retail/tours/fuel
    byTownship: {},

    /** What businesses.js reads: A$ of visitor demand this tick, by category and township. */
    demand: { total: 0, byCategory: {}, byTownshipCategory: {} },

    season: { label: '', loadMultiplier: 1, whaleMultiplier: 0, schoolBlock: null, longWeekend: null },

    capacity: {
      parking: {
        bays: PARKING.bays, wanted: 0, parked: 0, circling: 0,
        arrivalsToday: 0, servedToday: 0, turnedAwayToday: 0,
        searchMinutes: 0, walkInM: 0, basis: PARKING.basis
      },
      campsites: { sites: 0, used: 0, pct: 0 },
      ferrySeats: { perDay: 0, left: 0 },
      ferryVehicles: { perDay: 0, left: 0 },
      toilets: { blocks: TOILETS.blocks, load: 0, pct: 0, costTodayA$: 0, basis: 'modelled: no published count of public toilet blocks was found' }
    },

    /** What the island spends on visitors it does not charge for. The day tripper argument. */
    publicCost: { toiletsA$: 0, wasteA$: 0, patrolA$: 0, roadsA$: 0, totalTodayA$: 0, perDayVisitorA$: 0 },

    satisfaction: 0.7,
    congestion: 0,
    /** Published for whoever wires it into arrivals. Not applied to arrivals here: visitors.js owns
     *  who comes, and a system that quietly rewrote another system's arrivals would be a trap. */
    arrivalsModifier: 1,
    turnedAway: { peopleRolling30: 0, spendRolling30A$: 0 },
    fit: {},
    notes: []
  });

  let cal = null;
  const archetypes = new Map();   // id -> {spendLow, spendHigh, meanSize, vehicle, share}
  const spend365 = new Rolling(365);
  const captured365 = new Rolling(365);
  const visitorDays365 = new Rolling(365);
  const turnedAwaySpend30 = new Rolling(30);
  const turnedAwayPeople30 = new Rolling(30);
  let dayAccum = { spend: 0, captured: 0, turnedAwaySpend: 0, turnedAwayPeople: 0, visitorTicks: 0 };
  let lastDay = -1;
  let peakWantedToday = 0;

  /* -------------------------------------------------------------- reading the packs */

  function readArchetypes(w) {
    const list = (w.data.residents && w.data.residents.visitor_archetypes) || [];
    for (const a of list) {
      const size = (a.party && a.party.size) || [2, 4];
      const band = (a.spend && (a.spend.per_person_per_day_a$ || a.spend.per_person_a$)) || [80, 140];
      archetypes.set(a.id, {
        id: a.id,
        label: a.label,
        mean: (band[0] + band[1]) / 2,
        meanSize: (size[0] + size[1]) / 2,
        vehicle: /with a vehicle|with a 4WD|caravan|ute or truck|wagon/.test((a.arrival && a.arrival.mode) || ''),
        share: (a.arrival && a.arrival.share_of_visitors_estimate) || 0,
        split: SPLIT[a.id] || SPLIT['day-tripper'],
        capture: { ...CAPTURE, ...(CAPTURE_OVERRIDE[a.id] || {}) }
      });
    }
    if (!archetypes.size) state.notes.push('data/residents.json has no visitor archetypes: no visitor spend is modelled.');
    const base = w.data.residents && w.data.residents.visitor_baseline && w.data.residents.visitor_baseline.measured_baseline;
    if (base) {
      state.fit.publishedAnnualVisitors = base.visitors_2018;
      state.fit.publishedDaySpendA$ = base.median_spend_day_tripper_a$;
      state.fit.publishedOvernightSpendA$ = base.median_spend_overnight_a$;
      state.fit.publishedYear = 2018;
    }
  }

  /* -------------------------------------------------------------- the day */

  function newDay(w) {
    if (state.ready) settleParking(w);
    const info = cal.day(w.clock.date);
    state.season = {
      label: w.clock.season.name,
      loadMultiplier: info.loadMultiplier,
      whaleMultiplier: info.whaleMultiplier,
      schoolBlock: info.schoolBlock,
      longWeekend: info.longWeekendAnchor,
      patrolled: info.isPatrolDay
    };
    spend365.push(dayAccum.spend);
    captured365.push(dayAccum.captured);
    visitorDays365.push(dayAccum.visitorTicks / 144);
    turnedAwaySpend30.push(dayAccum.turnedAwaySpend);
    turnedAwayPeople30.push(dayAccum.turnedAwayPeople);
    state.spendRolling365A$ = Math.round(spend365.total);
    state.capturedRolling365A$ = Math.round(captured365.total);
    state.visitorDaysRolling365 = Math.round(visitorDays365.total);
    // Spend per visitor-day over the window, which is the figure that can be laid against the
    // published medians of A$120 and A$172. A single tick's rate cannot be.
    state.perVisitorDayA$ = visitorDays365.total > 1
      ? Math.round(spend365.total / visitorDays365.total)
      : state.perVisitorDayA$;
    dayAccum = { spend: 0, captured: 0, turnedAwaySpend: 0, turnedAwayPeople: 0, visitorTicks: 0 };
    state.day = w.clock.formatDate();
  }

  /* -------------------------------------------------------------- capacity */

  function updateParking(w, byArch, byTown, minute) {
    // Only the archetypes that brought a vehicle compete for a bay, which is why a day tripper is
    // hard on toilets and easy on parking: they came on a boat and left on a bus.
    //
    // And a bay is a stock, not a flow: what matters is how many cars are standing in the precinct
    // at this hour. At six in the morning it is a handful of surfers, at eleven it is the gorge
    // walk, the beach and the coffee run at once. The shape comes from the published hour_by_hour
    // blocks in data/residents.json.
    const shape = dayShape('parking', minute);
    let wanted = 0;
    const atPoint = byTown['point-lookout'] || 0;
    const total = state.onIsland || 1;
    for (const [id, people] of Object.entries(byArch)) {
      const a = archetypes.get(id);
      if (!a || !a.vehicle) continue;
      // Share of this archetype that is at Point Lookout right now, proportional to the township
      // split of the whole visitor population. Coarse, and cheap: this runs every tick.
      wanted += (people * (atPoint / total)) / Math.max(1.5, a.meanSize);
    }
    // Not everybody with a car at Point Lookout is looking for a bay at the headland. A family in a
    // house on Cumming Parade walks to Cylinder, and the car stays in the driveway all week. The
    // vehicles competing for the kerb are the ones that drove to the gorge walk, the surf club or
    // the shops, and that is a minority of them at any one hour. Modelled: this share and the bay
    // count are the two numbers that decide whether Point Lookout overflows, and neither is published.
    wanted *= PRECINCT_SHARE;
    // Day trippers and whale watchers come on a boat and a bus, but some hire, some get dropped,
    // and the coaches take kerb space too. Modelled small.
    wanted += ((byArch['day-tripper'] || 0) + (byArch['whale-watcher'] || 0)) * 0.035;
    wanted *= shape;
    // Residents, the surf club, the walkers and the tradespeople's utes. Modelled, and it has its
    // own weaker shape: the locals are there early and late as well.
    wanted += 34 * (0.35 + 0.65 * shape);

    const bays = PARKING.bays;
    const parked = Math.min(bays, wanted);
    const circling = Math.max(0, wanted - bays);
    const pressure = clamp(wanted / bays, 0, 2.2);
    const search = pressure <= 1
      ? lerp(PARKING.searchOffPeakMin[0], PARKING.searchOffPeakMin[1], pressure)
      : lerp(PARKING.searchPeakMin[0], PARKING.searchPeakMin[1], clamp((pressure - 1) / 0.6, 0, 1));
    const walkIn = pressure <= 1 ? 40 + pressure * 160
      : lerp(PARKING.walkInPeakM[0], PARKING.walkInPeakM[1], clamp((pressure - 1) / 0.6, 0, 1));

    const p = state.capacity.parking;
    const wasFull = p.circling > 0;
    p.wanted = Math.round(wanted);
    p.parked = Math.round(parked);
    p.circling = Math.round(circling);
    p.searchMinutes = +search.toFixed(1);
    p.walkInM = Math.round(walkIn);
    if (wanted > peakWantedToday) peakWantedToday = wanted;

    if (circling > 0 && !wasFull) {
      w.bus.emit('tourism:parking-full', { where: 'Point Lookout', wanted: p.wanted, bays, searchMinutes: p.searchMinutes });
    }
  }

  /**
   * How many carloads actually failed to park today, settled once at the end of the day.
   *
   * Doing this per tick was wrong and worth recording why. Cars in bays are a stock and cars giving
   * up are a flow, and multiplying the standing excess by a per-tick rate turned 640 circling cars
   * into thirty thousand people turned away in a day. A bay is not occupied all day: it turns over
   * several times, so the day's capacity is bays times that turnover, and the day's demand is the
   * vehicles that came looking. The difference between those two is the number, and it lands in
   * the low hundreds on a Christmas Sunday, which is what the headland is actually like.
   */
  function settleParking(w) {
    const bays = PARKING.bays;
    const TURNOVER = 3.2;              // modelled bay turnovers in a day
    const ARRIVAL_SPREAD = 1.9;        // modelled: unique carloads across a day per peak standing car
    const arrivals = peakWantedToday * ARRIVAL_SPREAD;
    const capacity = bays * TURNOVER;
    const missed = Math.max(0, arrivals - capacity);
    const people = Math.round(missed * 2.6);
    state.capacity.parking.turnedAwayToday = people;
    state.capacity.parking.arrivalsToday = Math.round(arrivals);
    state.capacity.parking.servedToday = Math.round(Math.min(arrivals, capacity));
    if (people > 0) {
      dayAccum.turnedAwayPeople += people;
      // What that carload would have spent in the afternoon it did not have. Modelled.
      dayAccum.turnedAwaySpend += people * 46;
      w.bus.emit('tourism:capacity-lost', {
        where: 'Point Lookout parking', people, carloads: Math.round(missed),
        bays, basis: 'the bay count is modelled: no count is published'
      });
    }
    peakWantedToday = 0;
  }

  function updateCapacityReads(w) {
    const vis = w.read('visitors') || {};
    const cap = vis.capacity || {};
    const man = vis.manifest || {};
    const beds = vis.beds || {};
    state.capacity.campsites.sites = beds.campsites || 0;
    state.capacity.campsites.used = beds.occupied || 0;
    state.capacity.campsites.pct = beds.campsites ? Math.round(100 * (beds.occupied || 0) / beds.campsites) : 0;
    state.capacity.ferrySeats.perDay = cap.walkOnSeatsPerDay || 0;
    state.capacity.ferrySeats.left = Number.isFinite(man.walkOnSeatsLeft) ? man.walkOnSeatsLeft : (cap.walkOnSeatsPerDay || 0);
    state.capacity.ferryVehicles.perDay = cap.vehicleSlotsPerDay || 0;
    state.capacity.ferryVehicles.left = Number.isFinite(man.vehicleSlotsLeft) ? man.vehicleSlotsLeft : (cap.vehicleSlotsPerDay || 0);
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'tourism',
    phase: 'economy',
    order: 20,

    init(w) {
      cal = (w.residents && w.residents.calendar) || makeCalendar(w.data.events);
      readArchetypes(w);
      for (const t of TOWNSHIP_IDS) state.byTownship[t] = { people: 0, spendA$: 0, capturedA$: 0 };
      state.notes.push('Capture rates are modelled. No study of visitor spend retention on this island was found.');
      state.notes.push(PARKING.basis);
      newDay(w);
      lastDay = w.clock.dayIndex;
      state.ready = true;
      w.bus.emit('tourism:ready', { archetypes: archetypes.size });
    },

    tick(w) {
      if (w.clock.dayIndex !== lastDay) { lastDay = w.clock.dayIndex; newDay(w); }
      const vis = w.read('visitors');
      if (!vis || !vis.ready) return;

      const byArch = vis.byArchetype || {};
      const byTown = vis.byTownship || {};
      state.onIsland = vis.onIsland || 0;

      const weather = w.read('weather') || {};
      const prices = w.read('prices') || {};
      const minute = w.clock.minuteOfDay;

      // Weather moves spend, and it moves it in two directions. A wet day empties the beach and
      // fills the pub and the museum; a perfect day does the reverse. Net it is slightly down,
      // because a day tripper who gets rained on goes home on an earlier boat.
      const wet = clamp((weather.rainMmHr || 0) / 6, 0, 1);
      const weatherFactor = 1 - wet * 0.16;

      // A shelf with nothing on it cannot take money, and a queue for a park is a tax on the
      // afternoon. Both are already modelled elsewhere; here they only move spend.
      const freight = clamp((prices.freightIndex || 1) - 1, 0, 1);
      const congestion = clamp(
        (state.capacity.parking.circling / Math.max(1, PARKING.bays)) * 0.9
        + clamp(state.capacity.campsites.pct / 100 - 0.85, 0, 0.15) * 2
        + clamp(1 - state.capacity.ferrySeats.left / Math.max(1, state.capacity.ferrySeats.perDay) - 0.8, 0, 0.2) * 1.5,
        0, 1);
      state.congestion = +congestion.toFixed(3);

      updateParking(w, byArch, byTown, minute);
      if (w.clock.tick % 6 === 0) updateCapacityReads(w);

      // --- the money, this tick
      const byCat = {};
      const byTownCat = {};
      const archOut = {};
      let spend = 0, captured = 0;

      for (const [id, people] of Object.entries(byArch)) {
        const a = archetypes.get(id);
        if (!a || !people) continue;
        // A day's spend, sliced by the tick. The band is per person per day; a tick is 1/144 of one.
        const perDay = a.mean * weatherFactor * (1 - congestion * 0.22) * (1 + freight * 0.06);
        const tickSpend = (people * perDay) / 144;
        let archSpend = 0, archCaptured = 0;
        for (const [cat, share] of Object.entries(a.split)) {
          if (!share) continue;
          // Each category has its own shape through the day. A grocery run is not a dinner.
          const shaped = tickSpend * share * (hourWeight(cat === 'travel' ? 'tours' : cat, minute) * 144);
          if (!(shaped > 0)) continue;
          archSpend += shaped;
          archCaptured += shaped * (a.capture[cat] ?? 0.5);
          byCat[cat] = (byCat[cat] || 0) + shaped;
          const bcat = TO_BUSINESS[cat];
          if (bcat) {
            for (const t of TOWNSHIP_IDS) {
              const share2 = (byTown[t] || 0) / Math.max(1, state.onIsland);
              if (share2 <= 0) continue;
              const key = t + '|' + bcat;
              byTownCat[key] = (byTownCat[key] || 0) + shaped * share2;
            }
          }
        }
        archOut[id] = {
          label: a.label, people,
          spendA$: round2(archSpend), capturedA$: round2(archCaptured),
          captureRate: archSpend > 0 ? +(archCaptured / archSpend).toFixed(3) : 0,
          perPersonPerDayA$: Math.round(perDay)
        };
        spend += archSpend;
        captured += archCaptured;
      }

      dayAccum.spend += spend;
      dayAccum.captured += captured;
      dayAccum.visitorTicks += state.onIsland;

      state.byArchetype = archOut;
      state.byCategory = byCat;
      state.spendTodayA$ = Math.round(dayAccum.spend);
      state.capturedTodayA$ = Math.round(dayAccum.captured);
      state.leakedTodayA$ = Math.round(dayAccum.spend - dayAccum.captured);
      state.captureRate = dayAccum.spend > 0 ? +(dayAccum.captured / dayAccum.spend).toFixed(3) : 0;

      for (const t of TOWNSHIP_IDS) {
        const people = byTown[t] || 0;
        const share = people / Math.max(1, state.onIsland);
        state.byTownship[t] = { people, spendA$: Math.round(dayAccum.spend * share), capturedA$: Math.round(dayAccum.captured * share) };
      }

      state.demand.total = round2(spend);
      state.demand.byCategory = byCat;
      state.demand.byTownshipCategory = byTownCat;

      // --- what the island pays for visitors it does not charge. Toilets, bins, patrol, roads.
      const day = (byArch['day-tripper'] || 0) + (byArch['whale-watcher'] || 0) + (byArch['school-group'] || 0);
      const toiletLoad = (state.onIsland * 0.55 + day * 0.9) / Math.max(1, TOILETS.blocks * TOILETS.peoplePerBlockPerDay);
      state.capacity.toilets.load = Math.round(state.onIsland * 0.55 + day * 0.9);
      state.capacity.toilets.pct = Math.round(toiletLoad * 100);
      const toiletsA$ = TOILETS.blocks * TOILETS.costPerBlockPerDayA$ * (1 + clamp(toiletLoad - 1, 0, 1.2));
      const wasteA$ = state.onIsland * 0.62;      // modelled: bins, haulage, the tip gate fee
      const patrolA$ = (state.season.patrolled ? 1 : 0) * 480 + state.onIsland * 0.05;
      const roadsA$ = state.onIsland * 0.18;
      state.capacity.toilets.costTodayA$ = Math.round(toiletsA$);
      state.publicCost.toiletsA$ = Math.round(toiletsA$);
      state.publicCost.wasteA$ = Math.round(wasteA$);
      state.publicCost.patrolA$ = Math.round(patrolA$);
      state.publicCost.roadsA$ = Math.round(roadsA$);
      state.publicCost.totalTodayA$ = Math.round(toiletsA$ + wasteA$ + patrolA$ + roadsA$);
      state.publicCost.perDayVisitorA$ = day > 0 ? round2((toiletsA$ + wasteA$ + patrolA$ + roadsA$) / day) : 0;

      // --- how the visit felt, which is next season's booking
      const target = clamp(0.86 - congestion * 0.42 - wet * 0.18 + (state.season.whaleMultiplier > 1.5 ? 0.05 : 0), 0.15, 0.95);
      state.satisfaction = +(state.satisfaction + (target - state.satisfaction) * 0.004).toFixed(3);
      state.arrivalsModifier = +clamp(0.82 + state.satisfaction * 0.34, 0.8, 1.15).toFixed(3);

    },

    describe() {
      return {
        onIsland: state.onIsland,
        spendTodayA$: state.spendTodayA$,
        capturedA$: state.capturedTodayA$,
        capture: state.captureRate,
        perVisitorDayA$: state.perVisitorDayA$,
        parking: `${state.capacity.parking.parked}/${state.capacity.parking.bays}`,
        circling: state.capacity.parking.circling,
        parkTurnedAway: state.capacity.parking.turnedAwayToday,
        searchMin: state.capacity.parking.searchMinutes,
        congestion: state.congestion,
        satisfaction: state.satisfaction,
        publicCostA$: state.publicCost.totalTodayA$,
        year365A$: state.spendRolling365A$
      };
    },

    save() {
      return {
        satisfaction: state.satisfaction,
        dayAccum,
        spend365: spend365.save(), captured365: captured365.save(), vd365: visitorDays365.save(),
        ta30s: turnedAwaySpend30.save(), ta30p: turnedAwayPeople30.save()
      };
    },

    load(w, s) {
      if (!s) return;
      lastDay = -1;
      state.satisfaction = s.satisfaction ?? state.satisfaction;
      dayAccum = s.dayAccum || dayAccum;
      spend365.load(s.spend365); captured365.load(s.captured365); visitorDays365.load(s.vd365);
      state.spendRolling365A$ = Math.round(spend365.total);
      state.capturedRolling365A$ = Math.round(captured365.total);
      state.visitorDaysRolling365 = Math.round(visitorDays365.total);
      state.perVisitorDayA$ = visitorDays365.total > 1 ? Math.round(spend365.total / visitorDays365.total) : 0;
      turnedAwaySpend30.load(s.ta30s); turnedAwayPeople30.load(s.ta30p);
    }
  });
}
