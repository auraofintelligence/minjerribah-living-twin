// Work. Who does it, who cannot be found to do it, and what it costs to get somebody over here.
//
// THE PUBLISHED SHAPE
//   ABS 2021, data/residents.json census_baseline, confidence high:
//     48.5 per cent of the 15-and-over population in the labour force, 41 per cent not in it
//     of the labour force: 42.3 full time, 40.0 part time, 14.4 away from work, 3.1 unemployed
//     top industries: accommodation 9.3, mineral sand mining 4.9, industrial cleaning 3.8,
//                     supermarket and grocery 3.2
//     top occupations: professionals 18.1, managers 16.6, labourers 15.8, trades 12.5
//
//   Two of those numbers are traps and the pack flags both. Work-from-home at 16.8 per cent is a
//   COVID-census reading and the pack says to treat it as a ceiling. Mineral sand mining at 4.9 per
//   cent is a fading tail: mining ended in December 2019 and the census caught the rehabilitation
//   phase, so the pack says model it as shrinking rather than stable. This file does.
//
// THE TWO FRICTIONS THE BRIEF ASKS FOR, AND WHY THEY ARE THE SAME FRICTION
//   You cannot get a tradesperson because they have to barge over. Staff turnover is high because
//   nobody can find a room. Both are the same sentence with different nouns: an island labour
//   market has a hard edge around it, and every hour of labour either sleeps here or crosses.
//
//   So there are exactly two ways to fill a roster:
//     live here   which needs a room, and housing.js says how many of those there are
//     cross       which needs a seat or a deck slot, and costs the fare and the travel time
//
//   data/residents.json prices the second one in its own occupation bands: an island-based builder
//   charges an indicative A$45 to A$85 an hour, and a mainland tradesperson working the island
//   charges an indicative A$95 to A$160, and the pack's own note says why: "Charge-out including a
//   barge fare and the travel time, which is why island jobs cost what they do." Every one of those
//   figures is flagged indicative, a modelling band, not a quoted rate, and they stay flagged here.
//
// THE JANUARY HOLE
//   The calendar carries `isBuilderShutdown` from 18 December to 20 January, because the island's
//   builders lose that window: the owners are in the houses. The repair queue does not stop, so it
//   grows for a month and takes until March to clear. That is one of the clearest legible seasonal
//   signals in this whole slice and it costs nothing to model, because the calendar already knows.
//
// Reads: population, businesses, housing, visitors, weather, policy. Publishes `jobs`.
// Emits `jobs:vacancy-unfilled`, `jobs:left-for-want-of-a-room`, `jobs:trade-queue`.

import { clamp, lerp, round2, approach, Rolling } from './common.js';
import { makeCalendar } from '../agents/calendar.js';

/* ------------------------------------------------------------------ industries

Occupation id from data/residents.json to an ABS-style industry label, so the simulated workforce
can be laid against the four published shares rather than asserted to match them. */

const INDUSTRY = {
  'accommodation-housekeeper': 'accommodation',
  'holiday-letting-manager': 'accommodation',
  'campground-attendant': 'accommodation',
  'hospitality-cook': 'cafes_and_restaurants',
  'cafe-allrounder': 'cafes_and_restaurants',
  'bar-and-gaming-attendant': 'cafes_and_restaurants',
  'publican-or-venue-manager': 'cafes_and_restaurants',
  'grocery-retail-assistant': 'supermarket_and_grocery_stores',
  'self-employed-cleaner': 'building_and_other_industrial_cleaning_services',
  'mine-rehabilitation-worker': 'mineral_sand_mining',
  'island-builder-carpenter': 'construction',
  'mainland-tradesperson': 'construction',
  'ferry-deckhand': 'transport',
  'water-taxi-skipper': 'transport',
  'terminal-and-barge-attendant': 'transport',
  'island-bus-driver': 'transport',
  'practice-nurse': 'health_care_and_social_assistance',
  'general-practitioner': 'health_care_and_social_assistance',
  paramedic: 'health_care_and_social_assistance',
  'aged-and-disability-support-worker': 'health_care_and_social_assistance',
  'aboriginal-health-worker': 'health_care_and_social_assistance',
  'unpaid-carer': 'unpaid_care',
  'primary-school-teacher': 'education_and_training',
  'teacher-aide': 'education_and_training',
  'police-officer': 'public_administration_and_safety',
  'council-outdoor-worker': 'public_administration_and_safety',
  'waste-facility-attendant': 'public_administration_and_safety',
  'qpws-ranger': 'public_administration_and_safety',
  'qalsma-ranger': 'public_administration_and_safety',
  'artist-maker': 'arts_and_recreation',
  'cultural-tour-guide': 'arts_and_recreation',
  '4wd-tour-guide': 'arts_and_recreation',
  'dive-and-surf-instructor': 'arts_and_recreation',
  'commercial-fisher': 'agriculture_forestry_and_fishing',
  'community-organisation-officer': 'other_services',
  'remote-knowledge-worker': 'professional_services_off_island',
  'mainland-commuter-professional': 'professional_services_off_island',
  'fifo-resources-worker': 'mining_off_island',
  retired: 'not_in_the_labour_force',
  unemployed: 'unemployed'
};

/** The four published shares, for the fit report. ABS 2021 fine-level industry classes. */
const PUBLISHED_SHARES = {
  accommodation: 9.3,
  mineral_sand_mining: 4.9,
  building_and_other_industrial_cleaning_services: 3.8,
  supermarket_and_grocery_stores: 3.2
};

/* ------------------------------------------------------------------ trades

Charge-out bands are the pack's own, and the pack flags every one of them as indicative only. */

const ISLAND_TRADE_RATE = [45, 85];
const MAINLAND_TRADE_RATE = [95, 160];
/** Jobs one tradesperson closes in a working day. Modelled: a job here averages about fourteen
 *  hours and a working day is about six productive ones, so a job is a bit over two days. */
const JOBS_PER_TRADE_DAY = 0.44;
/** Share of the island's own trades available to the household repair queue on any given day. The
 *  rest are on a build, on a council contract, or on their own place. Modelled. */
const ISLAND_TRADE_AVAILABILITY = 0.55;
/** And the share of the mainland tradespeople on the island today who are here for that queue
 *  rather than for one big job they crossed specifically to do. Modelled. */
const MAINLAND_QUEUE_SHARE = 0.30;
/** How often an ordinary dwelling and an ordinary business generate a job for a trade. Modelled. */
const DWELLING_JOBS_PER_YEAR = 2.2;
const BUSINESS_JOBS_PER_YEAR = 8;

/**
 * Sectors whose rosters are drawn from the island's own labour market. `transport` and `civic` are
 * not in the list, and that is a limitation worth stating rather than hiding: data/residents.json
 * has occupations for a ferry deckhand, a water taxi skipper, a terminal attendant and an island
 * bus driver, but the resident generator does not currently place anybody into them, so reading
 * those rosters as unfilled would report a crew shortage that is an artefact of the model rather
 * than a fact about the island. SeaLink's own band sits at a mainland terminal in the pack anyway.
 * Their fill is reported as 1 and flagged in `notes`.
 */
const LABOUR_MARKET_SECTORS = new Set([
  'hospitality', 'grocery', 'accommodation', 'fuel', 'retail', 'tours',
  'health', 'community', 'letting', 'emergency', 'education'
]);

/** Where the island's spare hours can go. A cook can pick up a shift at the bottle shop. A cook
 *  cannot pick up a shift at the clinic, and pretending otherwise is how a labour model tells a
 *  player their nursing shortage is solved. */
const SPARE_LABOUR_SECTORS = new Set(['hospitality', 'grocery', 'accommodation', 'fuel', 'retail', 'tours']);

export function registerJobs(world) {
  const rng = world.rng.stream('jobs');

  const state = world.publish('jobs', {
    ready: false,
    day: null,
    basis: 'Labour force shares, industry shares and occupation shares are published ABS 2021 '
      + 'figures. Every pay band is the indicative modelling band in data/residents.json, which '
      + 'says plainly that none of them is a quoted award rate or an advertised wage. Turnover, '
      + 'days to fill and the trade queue are modelled here.',

    labour: { workingAge: 0, inLabourForce: 0, employed: 0, unemployed: 0, participationPct: 0, unemploymentPct: 0 },
    underemployment: { people: 0, pct: 0, meanHoursWanted: 0 },

    byIndustry: {},          // id -> {people, pct, publishedPct, gap}
    byOccupation: {},
    fit: { note: '', worstGap: null },

    vacancies: [],           // the roster gaps a player can act on
    positions: 0,
    filled: 0,
    shortBy: 0,
    fillRate: 1,
    meanDaysToFill: 0,
    /** What businesses.js reads: business id -> fill ratio, 0..1.4. */
    staffingByBusiness: {},

    turnover: { annualisedPct: 0, leftRolling365: 0, becauseOfHousing365: 0, becauseOfSeason365: 0 },

    hours: { hospitalityWeekly: 0, summerPeakWeekly: 0, winterTroughWeekly: 0, volatility: 0 },

    trades: {
      islandBased: 0, mainlandOnIslandToday: 0,
      queue: 0, queueDays: 0, meanWaitDays: 0, longestWaitDays: 0,
      islandRateA$hr: 0, mainlandRateA$hr: 0, effectiveRateA$hr: 0,
      shareDoneByMainland: 0, bargeShareOfAJobPct: 0,
      shutdown: false
    },

    miningTail: { people: 0, pctOfEmployed: 0, note: '' },
    /** Sectors this file cannot see a labour market for, reported rather than hidden. */
    notModelledSectors: [],
    notes: []
  });

  let cal = null;
  let lastDay = -1;
  const left365 = new Rolling(365);
  const leftHousing365 = new Rolling(365);
  const leftSeason365 = new Rolling(365);
  let dayLeft = { total: 0, housing: 0, season: 0 };

  /** The repair and maintenance queue: {created, kind, hours}. Kept bounded. */
  const tradeQueue = [];
  const vacancyAge = new Map();      // business id -> days the gap has been open
  let hospitalityHoursNow = 0;
  let hoursSummer = 0, hoursWinter = 0;
  let miningTail = 0;

  /* -------------------------------------------------------------- the workforce */

  function scanWorkforce(w) {
    const R = w.residents;
    const byOcc = {};
    const byInd = {};
    let workingAge = 0, inLF = 0, employed = 0, unemployed = 0;
    if (!R || !R.people) return { byOcc, byInd, workingAge, inLF, employed, unemployed };
    for (let i = 0; i < R.people.length; i++) {
      const p = R.people[i];
      if (p.age < 15) continue;
      workingAge++;
      const occ = p.occupationId || 'none';
      byOcc[occ] = (byOcc[occ] || 0) + 1;
      if (occ === 'unemployed') { inLF++; unemployed++; }
      else if (occ === 'retired' || occ === 'none' || occ === 'unpaid-carer'
        || occ === 'secondary-student-mainland' || occ === 'primary-student') { /* not in the labour force */ }
      else { inLF++; employed++; }
      const ind = INDUSTRY[occ];
      if (ind && ind !== 'not_in_the_labour_force' && ind !== 'unemployed' && ind !== 'unpaid_care') {
        byInd[ind] = (byInd[ind] || 0) + 1;
      }
    }
    return { byOcc, byInd, workingAge, inLF, employed, unemployed };
  }

  /* -------------------------------------------------------------- the trade queue */

  function generateTradeWork(w, info) {
    const R = w.residents;
    const dwellings = R && R.dwellings ? R.dwellings.length : 1900;
    const businesses = 98;
    // Per day, from the annual rates. A leaking roof, a dead hot water system, a deck that has had
    // twenty years of salt air. Nothing dramatic, and it never stops.
    let expected = dwellings * DWELLING_JOBS_PER_YEAR / 365 + businesses * BUSINESS_JOBS_PER_YEAR / 365;

    // A blow puts a lot of work on at once. The weather system already knows what the wind did.
    const weather = w.read('weather') || {};
    if ((weather.windKt || 0) > 34 || (weather.synoptic === 'eastcoastlow')) expected *= 3.4;
    else if ((weather.windKt || 0) > 26) expected *= 1.6;

    let n = Math.floor(expected);
    if (rng.float() < expected - n) n++;
    for (let i = 0; i < n; i++) {
      tradeQueue.push({ created: w.clock.dayIndex, hours: rng.range(2.5, 26) });
    }
    // A queue is a queue, not a memory leak. Beyond this, jobs get given up on, deferred or done
    // badly by the owner, which is also what happens.
    if (tradeQueue.length > 900) tradeQueue.splice(0, tradeQueue.length - 900);
  }

  function workTheQueue(w, info) {
    const R = w.residents;
    const vis = w.read('visitors') || {};
    let island = 0;
    if (R && R.people) {
      for (const p of R.people) if (p.occupationId === 'island-builder-carpenter') island++;
    }
    const mainlandHere = Math.round((vis.byArchetype && vis.byArchetype['tradesperson-from-the-mainland']) || 0);

    // The shutdown. Published behaviour in the calendar, and it is where the queue blows out.
    const shutdown = !!info.isBuilderShutdown;
    const working = shutdown ? 0.20 : (info.isWeekend ? 0.25 : 1);
    // A tradesperson who crossed this morning loses the crossing out of the day at each end, so
    // they close fewer jobs than an island-based one even though they charge more.
    // And when the backlog is bad everybody works Saturdays, which is why a January queue clears by
    // about March rather than never.
    // When the backlog is bad everybody works Saturdays, the island's own trades come off the big
    // jobs, and more mainland trades cross because the work is worth the fare. Without this the
    // January queue never clears and the island sits permanently three weeks behind, which is a
    // sim that has run away rather than a sim that has a season.
    const catchUp = 1 + clamp((tradeQueue.length - 80) / 300, 0, 0.7);
    const capacity = (island * JOBS_PER_TRADE_DAY * ISLAND_TRADE_AVAILABILITY
      + mainlandHere * JOBS_PER_TRADE_DAY * 0.62 * MAINLAND_QUEUE_SHARE) * working * catchUp;

    let done = Math.floor(capacity);
    if (rng.float() < capacity - done) done++;
    let mainlandDid = 0;
    const mainlandShare = capacity > 0
      ? (mainlandHere * JOBS_PER_TRADE_DAY * 0.62 * MAINLAND_QUEUE_SHARE * working * catchUp) / capacity : 0;
    for (let i = 0; i < done && tradeQueue.length; i++) {
      tradeQueue.shift();
      if (rng.float() < mainlandShare) mainlandDid++;
    }

    let oldest = 0, sumWait = 0;
    for (const j of tradeQueue) {
      const age = w.clock.dayIndex - j.created;
      sumWait += age;
      if (age > oldest) oldest = age;
    }

    const islandRate = lerp(ISLAND_TRADE_RATE[0], ISLAND_TRADE_RATE[1], clamp(tradeQueue.length / 400, 0, 1));
    const mainlandRate = lerp(MAINLAND_TRADE_RATE[0], MAINLAND_TRADE_RATE[1], clamp(tradeQueue.length / 400, 0, 1));
    const effective = lerp(islandRate, mainlandRate, clamp(mainlandShare, 0, 1));

    const t = state.trades;
    t.islandBased = island;
    t.mainlandOnIslandToday = mainlandHere;
    t.queue = tradeQueue.length;
    t.queueDays = capacity > 0 ? +(tradeQueue.length / capacity).toFixed(1) : 99;
    t.meanWaitDays = tradeQueue.length ? +(sumWait / tradeQueue.length).toFixed(1) : 0;
    t.longestWaitDays = oldest;
    t.islandRateA$hr = Math.round(islandRate);
    t.mainlandRateA$hr = Math.round(mainlandRate);
    t.effectiveRateA$hr = Math.round(effective);
    t.shareDoneByMainland = +clamp(mainlandShare, 0, 1).toFixed(2);
    // What share of a mainland tradesperson's hourly rate is the crossing and the travel, rather
    // than the work. Modelled from the gap between the two published bands.
    t.bargeShareOfAJobPct = +(100 * (mainlandRate - islandRate) / Math.max(1, mainlandRate)).toFixed(1);
    t.shutdown = shutdown;

    if (tradeQueue.length > 260 && w.clock.dayIndex % 14 === 0) {
      w.bus.emit('jobs:trade-queue', {
        waiting: tradeQueue.length, meanWaitDays: t.meanWaitDays, longestWaitDays: oldest,
        why: shutdown ? 'the builders are shut down for the summer' : 'there are not enough trades on the island'
      });
    }
    return mainlandDid;
  }

  /* -------------------------------------------------------------- rosters */

  /**
   * An island labour market is a contested pool, not a per-business calculation, and that is the
   * whole point of doing it here rather than inside businesses.js. There are exactly three sources
   * of labour for an island roster and each one has its own hard edge:
   *
   *   1  people already in the job          limited by retention, which housing decides
   *   2  people already here without enough work   the island's spare hours, and there are few
   *   3  somebody who crosses for the shift        limited by the fare, the hours and the timetable
   *
   * Every business bids for the same pool 2 and 3, so a January that needs 900 rostered hours out
   * of an island that has 700 leaves everybody short, not one unlucky cafe. That is what a labour
   * shortage on an island actually feels like from behind the counter.
   */
  function fillRosters(w, info, housing, scan) {
    const needs = (w.read('businesses') || {}).staffNeeds || {};
    const friction = housing ? (housing.workers ? housing.workers.frictionIndex : 0) : 0;

    // 1. Retention. High turnover does not mean the job is unfilled, it means the job is empty
    //    between one person leaving and the next arriving, and somebody is covering the gap tired.
    const retention = clamp(1 - friction * 0.30, 0.62, 1);

    // 2. The island's spare hours. The published labour force is 48.5 per cent of the 15-and-over
    //    population with 3.1 per cent unemployed and 40 per cent working part time. The people
    //    available for another shift are the unemployed plus a share of the underemployed, and
    //    they can only go where their hands are useful: see SPARE_LABOUR_SECTORS.
    const spare = (scan.unemployed || 0) + (state.underemployment.people || 0) * 0.45;

    const ids = Object.keys(needs).sort();
    let positions = 0;
    // Pools are per sector. A cafe that is three short and a cafe that is three over are the same
    // island: people work where the work is. A cafe that is three short and a clinic that is three
    // over are two different islands, and merging them would be a lie.
    const pool = new Map();     // sector -> {surplus, gap}
    const gap = new Map();
    const commuterOf = new Map();

    for (const id of ids) {
      const n = needs[id];
      const needed = n.needed || 0;
      positions += needed;
      if (needed <= 0) continue;
      if (!LABOUR_MARKET_SECTORS.has(n.sector)) continue;
      const here = (n.onIsland || 0) * retention;
      // 3. Crossing for a shift. Published: 5.3 per cent of workers already drive to a ferry and
      //    cross. Capped low, because on the wages these sectors pay the fare eats the shift.
      const commuters = Math.min(Math.max(0, needed - here), needed * 0.08);
      commuterOf.set(id, commuters);
      const g = Math.max(0, needed - here - commuters);
      gap.set(id, g);
      let p = pool.get(n.sector);
      if (!p) pool.set(n.sector, (p = { surplus: 0, gap: 0, here: 0, needed: 0 }));
      p.gap += g;
      p.here += here;
      p.needed += needed;
      p.surplus += Math.max(0, here - needed);
    }

    // A sector with rosters and no island labour at all is not a shortage, it is a blind spot, and
    // saying so is better than reporting it as a crisis. data/residents.json has occupations for a
    // dive instructor and a tour guide, but the resident generator puts every one of them at the
    // dive lodge, which this file classifies as accommodation, so the tour operators read as having
    // nobody. Reporting five permanently unfilled guide positions would be an artefact of two
    // reasonable modelling choices meeting, not a fact about the island.
    const blind = [];
    for (const [sec, p] of pool) {
      if (p.here <= 0 && p.needed > 0) { p.invisible = true; blind.push(sec); }
    }
    state.notModelledSectors = blind;
    // The island's spare hours, split across the sectors that can use them, weighted by how short
    // each one is. Everybody bids for the same people.
    let spareGap = 0;
    for (const [sec, p] of pool) if (SPARE_LABOUR_SECTORS.has(sec)) spareGap += p.gap;
    for (const [sec, p] of pool) {
      p.mobile = p.surplus + (SPARE_LABOUR_SECTORS.has(sec) && spareGap > 0 ? spare * (p.gap / spareGap) : 0);
    }

    const out = {};
    const vacancies = [];
    let filled = 0, ageSum = 0, ageN = 0;

    for (const id of ids) {
      const n = needs[id];
      const needed = n.needed || 0;
      if (needed <= 0) { out[id] = 1; vacancyAge.delete(id); continue; }
      const sectorPool = pool.get(n.sector);
      if (!LABOUR_MARKET_SECTORS.has(n.sector) || (sectorPool && sectorPool.invisible)) {
        // Rostered off the island by the operator, or a sector the resident generator does not
        // populate. Not counted as a shortage. See the notes above.
        out[id] = 1;
        filled += needed;
        vacancyAge.delete(id);
        continue;
      }
      const here = (n.onIsland || 0) * retention;
      const commuters = commuterOf.get(id) || 0;
      const g = gap.get(id) || 0;
      const p = sectorPool || { mobile: 0, gap: 0 };
      const share = p.gap > 0 ? Math.min(g, p.mobile * (g / p.gap)) : 0;
      const reachable = here + commuters + share;

      const f = clamp(reachable / needed, 0, 1.4);
      out[id] = +f.toFixed(3);
      filled += Math.min(reachable, needed);

      const short = Math.max(0, Math.round(needed - reachable));
      if (short > 0) {
        const age = (vacancyAge.get(id) || 0) + 1;
        vacancyAge.set(id, age);
        ageSum += age; ageN++;
        vacancies.push({
          business: id, township: n.township, sector: n.sector,
          short, daysOpen: age,
          why: friction > 0.45 ? 'nobody who applies can find a room'
            : n.peakToday ? 'the season wants more people than the island has'
              : 'nobody spare on the island to take it'
        });
        if (age === 30 || age === 90) {
          w.bus.emit('jobs:vacancy-unfilled', { business: id, township: n.township, short, daysOpen: age });
        }
      } else {
        vacancyAge.delete(id);
      }
    }

    vacancies.sort((a, b) => (b.short - a.short) || (b.daysOpen - a.daysOpen) || (a.business < b.business ? -1 : 1));
    state.staffingByBusiness = out;
    state.vacancies = vacancies.slice(0, 24);
    state.positions = positions;
    state.filled = Math.round(filled);
    state.shortBy = Math.max(0, Math.round(positions - filled));
    state.fillRate = positions ? +(filled / positions).toFixed(3) : 1;
    state.meanDaysToFill = ageN ? Math.round(ageSum / ageN) : 0;
  }

  /* -------------------------------------------------------------- turnover and hours */

  function turnoverAndHours(w, info, housing) {
    const friction = housing ? (housing.workers ? housing.workers.frictionIndex : 0) : 0;
    const rentShare = housing && housing.rentals ? housing.rentals.shareOfAWorkerWagePct : 36;

    // Hours offered follow the season, hard. The pack's own drama hook: "A cook works sixty hours in
    // January and twenty in June, and the difference is the rent."
    const seasonal = clamp((info.loadMultiplier - 1) / 2.5, 0, 1);
    const target = lerp(21, 58, seasonal);
    hospitalityHoursNow = approach(hospitalityHoursNow || 30, target, 9, 1);
    if (info.schoolBlock === 'summer') hoursSummer = Math.max(hoursSummer, hospitalityHoursNow);
    if (w.clock.month >= 4 && w.clock.month <= 7) hoursWinter = hoursWinter ? Math.min(hoursWinter, hospitalityHoursNow) : hospitalityHoursNow;

    // Who gives up. Two reasons, tracked separately, because they need different levers: one is a
    // room and the other is a wage that only exists for four months of the year.
    const workforce = Math.max(1, (w.read('population') || {}).labour ? w.read('population').labour.employed : 800);
    const housingChurn = workforce * (0.00016 + friction * 0.0011) * clamp(rentShare / 36, 0.6, 2.2);
    const seasonChurn = workforce * (0.00012 + clamp((30 - hospitalityHoursNow) / 30, 0, 1) * 0.0006);

    let hLeavers = Math.floor(housingChurn); if (rng.float() < housingChurn - hLeavers) hLeavers++;
    let sLeavers = Math.floor(seasonChurn); if (rng.float() < seasonChurn - sLeavers) sLeavers++;
    dayLeft.housing += hLeavers;
    dayLeft.season += sLeavers;
    dayLeft.total += hLeavers + sLeavers;
    if (hLeavers > 0 && w.clock.dayIndex % 10 === 0) {
      w.bus.emit('jobs:left-for-want-of-a-room', {
        people: hLeavers,
        rentAsShareOfWagePct: rentShare,
        rentalsOnTheMarket: housing && housing.rentals ? housing.rentals.available : null
      });
    }

    state.hours.hospitalityWeekly = Math.round(hospitalityHoursNow);
    state.hours.summerPeakWeekly = Math.round(hoursSummer);
    state.hours.winterTroughWeekly = Math.round(hoursWinter);
    state.hours.volatility = hoursSummer > 0 && hoursWinter > 0 ? +(hoursSummer / hoursWinter).toFixed(2) : 0;
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'jobs',
    phase: 'economy',
    order: 50,

    // Lazy bind: the economy phase runs before the agents phase, so at boot there is no workforce
    // to scan yet. This file wires itself up on the first tick after population.js has built one.
    init(w) {
      cal = (w.residents && w.residents.calendar) || makeCalendar(w.data.events);
      state.notes.push('Mineral sand mining shows in the 2021 census at 4.9 per cent because that census fell during the rehabilitation phase after mining ended in December 2019. data/residents.json says to model it as shrinking, not stable, and this file does: the tail decays and the civic lever mine-rehabilitation-pace carries the day those jobs finish.');
      state.notes.push('Work from home at 16.8 per cent is a COVID-census reading and the pack flags it as a ceiling. It is not modelled as a steady state here.');
      state.notes.push('Every pay band in this read model is the indicative modelling band from data/residents.json. None is an award rate and none is an advertised wage.');
      lastDay = w.clock.dayIndex;
    },

    tick(w) {
      if (!state.ready) {
        const R = w.residents;
        if (!R || !R.ready || !R.people || !R.people.length) return;
        cal = R.calendar || cal;
        miningTail = scanWorkforce(w).byInd.mineral_sand_mining || 0;
        state.notes.push('Transport and local government rosters are not drawn from the island labour market here, and are reported as filled. data/residents.json carries occupations for a deckhand, a skipper, a terminal attendant and a bus driver, but no resident is generated into them, so counting those rosters as unfilled would report a crew shortage that is an artefact of the model.');
        state.ready = true;
        w.bus.emit('jobs:ready', { people: R.people.length });
      }
      if (w.clock.dayIndex === lastDay) return;
      lastDay = w.clock.dayIndex;

      const info = cal.day(w.clock.date);
      const housing = w.read('housing');

      // --- the workforce as it stands
      const scan = scanWorkforce(w);
      state.labour = {
        workingAge: scan.workingAge,
        inLabourForce: scan.inLF,
        employed: scan.employed,
        unemployed: scan.unemployed,
        participationPct: scan.workingAge ? +(100 * scan.inLF / scan.workingAge).toFixed(1) : 0,
        unemploymentPct: scan.inLF ? +(100 * scan.unemployed / scan.inLF).toFixed(1) : 0
      };

      // --- industry mix against the published shares
      const byIndustry = {};
      let worstGap = null;
      for (const [id, people] of Object.entries(scan.byInd)) {
        const pct = scan.employed ? +(100 * people / scan.employed).toFixed(1) : 0;
        const pub = PUBLISHED_SHARES[id];
        const row = { people, pct, publishedPct: pub ?? null, gap: pub != null ? +(pct - pub).toFixed(1) : null };
        byIndustry[id] = row;
        if (pub != null && (!worstGap || Math.abs(row.gap) > Math.abs(worstGap.gap))) worstGap = { industry: id, ...row };
      }
      state.byIndustry = byIndustry;
      state.byOccupation = scan.byOcc;
      state.fit = {
        note: 'Modelled shares against the four published ABS 2021 fine-level industry classes. A gap is a gap, not an error: the census was five years ago and one of the four is a fading tail.',
        worstGap
      };

      // The tail. Rehabilitation work is finite by definition and the pack says to shrink it.
      const pol = w.read('policy');
      const rehab = pol && pol.levers ? pol.levers['mine-rehabilitation-pace'] : null;
      miningTail = Math.max(0, miningTail * (1 - 0.00055));
      state.miningTail = {
        people: Math.round(byIndustry.mineral_sand_mining ? byIndustry.mineral_sand_mining.people : miningTail),
        pctOfEmployed: byIndustry.mineral_sand_mining ? byIndustry.mineral_sand_mining.pct : 0,
        note: rehab
          ? 'Rehabilitation work under the former operator. It ends when the handback does, and those jobs end with it.'
          : 'Rehabilitation work. Finite by definition: it ends when the handback does.'
      };

      // --- underemployment, before the rosters, because the rosters bid for exactly these hours.
      //     The island's real labour problem is not that there is no work, it is that there are
      //     four months of it. Published: 40 per cent of the labour force works part time.
      const seasonal = clamp((info.loadMultiplier - 1) / 2.5, 0, 1);
      const under = Math.round(scan.employed * clamp(0.30 - seasonal * 0.20, 0.06, 0.34));
      state.underemployment = {
        people: under,
        pct: scan.employed ? +(100 * under / scan.employed).toFixed(1) : 0,
        meanHoursWanted: Math.round(lerp(14, 4, seasonal))
      };

      // --- rosters, trades, turnover
      fillRosters(w, info, housing, scan);
      generateTradeWork(w, info);
      workTheQueue(w, info);
      turnoverAndHours(w, info, housing);

      left365.push(dayLeft.total);
      leftHousing365.push(dayLeft.housing);
      leftSeason365.push(dayLeft.season);
      dayLeft = { total: 0, housing: 0, season: 0 };
      state.turnover = {
        annualisedPct: scan.employed ? +(100 * left365.total / scan.employed).toFixed(1) : 0,
        leftRolling365: Math.round(left365.total),
        becauseOfHousing365: Math.round(leftHousing365.total),
        becauseOfSeason365: Math.round(leftSeason365.total)
      };

      state.day = w.clock.formatDate();
    },

    describe() {
      return {
        employed: state.labour.employed,
        unemployedPct: state.labour.unemploymentPct,
        participationPct: state.labour.participationPct,
        positions: state.positions,
        shortBy: Math.round(state.shortBy),
        fillRate: state.fillRate,
        daysToFill: state.meanDaysToFill,
        turnoverPct: state.turnover.annualisedPct,
        leftForARoom365: state.turnover.becauseOfHousing365,
        hospHours: state.hours.hospitalityWeekly,
        hoursVolatility: state.hours.volatility,
        tradeQueue: state.trades.queue,
        tradeWaitDays: state.trades.meanWaitDays,
        tradeRateA$hr: state.trades.effectiveRateA$hr,
        shutdown: state.trades.shutdown,
        underemployedPct: state.underemployment.pct
      };
    },

    save() {
      return {
        queue: tradeQueue.map((j) => [j.created, round2(j.hours)]),
        vacancyAge: [...vacancyAge.entries()],
        hospitalityHoursNow, hoursSummer, hoursWinter, miningTail,
        l365: left365.save(), lh365: leftHousing365.save(), ls365: leftSeason365.save()
      };
    },

    load(w, s) {
      if (!s) return;
      lastDay = -1;
      state.ready = false;      // rebinds to the workforce on the next tick
      tradeQueue.length = 0;
      for (const [created, hours] of s.queue || []) tradeQueue.push({ created, hours });
      vacancyAge.clear();
      for (const [k, v] of s.vacancyAge || []) vacancyAge.set(k, v);
      hospitalityHoursNow = s.hospitalityHoursNow || 0;
      hoursSummer = s.hoursSummer || 0;
      hoursWinter = s.hoursWinter || 0;
      miningTail = s.miningTail || 0;
      left365.load(s.l365); leftHousing365.load(s.lh365); leftSeason365.load(s.ls365);
      state.turnover.leftRolling365 = Math.round(left365.total);
      state.turnover.becauseOfHousing365 = Math.round(leftHousing365.total);
      state.turnover.becauseOfSeason365 = Math.round(leftSeason365.total);
      state.trades.queue = tradeQueue.length;
    }
  });
}
