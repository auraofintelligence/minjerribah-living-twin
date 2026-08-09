// Every real business on the island, as a thing that opens, sells, runs out and gets tired.
//
// WHAT IS IN HERE
//   All 101 records in data/businesses.json. 67 trading, 31 trading-unconfirmed, 1 proposed, 2
//   closed. The proposed one and the two closed ones are carried but never trade, because a
//   simulation that quietly opens a business the pack says has closed is lying about a real street.
//
// THE ONE BEHAVIOUR THIS FILE EXISTS FOR
//   The pub can run out of beer on the Saturday of a long weekend, and the reason is arithmetic
//   rather than drama:
//
//     the pub's published peak multiplier is 3 (data/businesses.json)
//     the drink line carries about 12 days of cover at ordinary trade
//     at three times ordinary trade that is four days
//     the reorder goes in on the Thursday
//     the Friday vehicle deck is sold out to visitor cars, so the carrier's run is bumped
//     Monday is a public holiday
//     the delivery lands on the Tuesday
//     the taps run dry some time on Saturday night
//
//   Not one link in that chain is invented. The peak multiplier is in the businesses pack, the deck
//   capacity and the bumping behaviour are in the transport pack, and the Monday collection and the
//   long weekend shape are in the events pack. This file is where they meet.
//
// WHAT THIS FILE WILL NOT DO
//   It will not put a real, named, currently trading business out of business. Every record here is
//   a real family or a real committee on a real street, and a simulation is not entitled to publish
//   a finding that their shop failed. So the viability ladder bottoms out at behaviours a business
//   on this island actually uses when trade is thin: cut the roster, cut the hours, close midweek,
//   close for the winter. `closed` is a state only the data pack can set, never the simulation.
//   That is a deliberate limit and it is written here so the next person does not read it as a gap.
//
// WHAT IS PUBLISHED AND WHAT IS MODELLED
//   Published: the business list, its types, townships, statuses, price bands, the staffing bands,
//   the peak multipliers, and the trading hours. The pack flags the staffing bands, peak multipliers
//   and most trading hours as estimates and says plainly they must not be shown to a player as fact,
//   so `hoursBasis` and `confidence` travel all the way to the read model.
//   Modelled here: every dollar. Turnover, margins, wages, stock cover, cash. No trading figure for
//   any business on this island is published anywhere.
//
// Reads: prices, tourism, population, schedule, weather, world.residents. Publishes `businesses`.
// Emits `freight:order`; listens for `freight:delivered`. Emits `business:stockout`,
// `business:reduced-hours`, `business:recovered`.

import {
  clamp, lerp, Rolling, sectorOf, TRADING_SECTORS, CATEGORY_SECTORS, CATEGORIES,
  BAND_TICKET, COST_OF_SALES, OVERHEAD_MULTIPLIER, parseHours, openAt, hourWeight, townshipIdFor,
  TOWNSHIP_IDS, STOCK_LINES, stockLinesFor
} from './common.js';
import { makeCalendar } from '../agents/calendar.js';

/* ------------------------------------------------------------------ resident demand

A$ per resident per day that lands on the island, by category. Modelled. Cross-checked against the
published island median household income of A$1,147 a week over an average household of 2.1 people:
these five lines come to about A$27 a person a day, which is A$189 a week, or about a third of the
published per-person income. The rest is rent, mortgage, power, insurance, mainland spending and
whatever is left, and none of that is this file's business. */

const RESIDENT_DAILY = {
  groceries: 16.2,
  hospitality: 6.4,
  fuel: 5.0,
  retail: 3.0,
  tours: 0.12,
  accommodation: 0
};

/** Share of the island's grocery spend that is done on the mainland instead. Modelled, and it
 *  moves: the dearer the island shelf, the more of the weekly shop comes back in the boot of a car
 *  off the barge. Published context: 5.3 per cent of workers already drive to a ferry and cross. */
const BASE_MAINLAND_LEAK = 0.26;

/** Modelled hourly cost of an hour of staff time by sector, loaded for casual rates and penalties.
 *  Bands come from data/residents.json occupations, which flags every one as indicative only. */
const WAGE_PER_HOUR = {
  hospitality: 38, grocery: 34, accommodation: 35, fuel: 34, retail: 33, tours: 42,
  letting: 40, transport: 40, health: 52, education: 48, emergency: 45, civic: 42, community: 40, services: 36
};

/**
 * How much of a business's published staffing band is actually a job held by somebody who lives on
 * this island. Modelled, and it matters: data/businesses.json gives SeaLink a band of 40 to 120,
 * and most of that is Cleveland terminal staff and crew who live on the mainland, while Redland
 * City Council's 10 to 60 is mostly at Cleveland too. Counting those bands as island rosters would
 * put the island permanently 300 people short of its own economy and make the housing loop look
 * like an emergency when it is only arithmetic.
 */
const ISLAND_STAFF_SHARE = { 'Mainland terminal': 0.22, 'Island-wide': 0.6 };

/** Modelled fixed cost per staff-equivalent per day: rent, power, insurance, waste, compliance.
 *  Higher out here than a mainland equivalent, which is one of the five premium components in
 *  prices.js and the reason a small island cafe closes on a Tuesday in June. */
const OVERHEAD_PER_SCALE_DAY = 38;

/**
 * A head count is not a roster, and getting that wrong is the difference between an island economy
 * and an island losing sixty million dollars a year.
 *
 * data/businesses.json gives the pub a staffing band of 25 to 60 and describes it as a "rough
 * headcount range in normal trade". That is everybody on the books. Paying all of them for every
 * hour the doors are open put the pub's wage bill above its takings on a wet Tuesday in November
 * and made the whole island trade at a loss. What is actually on shift at any one hour is the
 * week's labour hours spread across the week's trading hours, which for a pub open eleven hours a
 * day comes out around seven or eight people, and that is what a bar on a Tuesday looks like.
 *
 * AVG_WEEKLY_HOURS is per person on the books, blending the published split of 42.3 per cent full
 * time, 40.0 per cent part time and 14.4 per cent away from work. Modelled.
 */
const AVG_WEEKLY_HOURS = 25;

/**
 * The money that leaves a business and lands in a household: the owner's income, the loan, the tax
 * and whatever goes back into the place. Without a line for it, every business on this island
 * accumulates cash forever and reports a margin that reads like a mistake, because a small business
 * is not a company that retains earnings, it is somebody's living. Modelled as a share of turnover.
 * It is also the pool chour.js draws its business contributions from, which is why an island where
 * trade is thin is also an island where the hall does not get painted.
 */
const DRAWINGS_AND_FINANCE = 0.09;

/**
 * How much trade one staff-equivalent can put through in a day, in tickets. Together with the price
 * band this sets the ceiling on how fast a business can take money, which is what a queue is.
 * Modelled, and deliberately generous: this is meant to bind at Christmas and on a long weekend,
 * not on an ordinary Thursday. The demand pool is the real constraint the rest of the time.
 */
const CAPACITY_FACTOR = {
  hospitality: 34, grocery: 70, fuel: 75, retail: 22, accommodation: 22,
  tours: 9, health: 16, community: 18, services: 20
};

/** How much more than an ordinary cycle a premises can hold: the extra shelf, the second cold room,
 *  the pallet in the corridor. Modelled, and it is what makes a long weekend bite. */
const STORAGE_SLACK = 1.35;

/** How the pack's peak vocabulary maps onto a calendar day. */
function inPeakPeriod(tag, info) {
  switch (tag) {
    case 'summer-school-holidays': return info.schoolBlock === 'summer';
    case 'winter-school-holidays': return info.schoolBlock === 'winter';
    case 'spring-school-holidays': return info.schoolBlock === 'spring';
    case 'easter': return /Easter/.test(info.longWeekendAnchor || '') || info.schoolBlock === 'autumn';
    case 'long-weekends': return info.isLongWeekend;
    case 'whale-season-jun-nov': return info.isWhaleSeason;
    case 'weekends': return info.isWeekend;
    default: return false;
  }
}

export function registerBusinesses(world) {

  const state = world.publish('businesses', {
    ready: false,
    day: null,
    basis: 'The list, the types, the townships, the price bands, the staffing bands, the peak '
      + 'multipliers and the trading hours are from data/businesses.json, which flags the staffing, '
      + 'the multipliers and most hours as estimates. Every dollar figure here is modelled.',
    counts: { total: 0, trading: 0, unconfirmed: 0, closed: 0, proposed: 0, trading_now: 0 },
    openNow: 0,
    bySector: {},
    byTownship: {},
    revenueTodayA$: 0,
    revenueRolling365A$: 0,
    costRolling365A$: 0,
    wagesTodayA$: 0,
    /** What the owners took out: their income, the loan, the tax, the reinvestment. Modelled. */
    drawingsTodayA$: 0,
    marginPct: 0,
    /** The margin that means anything on an island with a four-month season. A single day's figure
     *  swings from deeply negative on a wet Tuesday to comfortable at Christmas, and neither of
     *  those is the answer to "can these businesses keep trading". */
    marginPctRolling365: 0,
    demandLostTodayA$: 0,
    stockouts: { openNow: 0, startedToday: 0, rolling30: 0, live: [] },
    deliveries: { orderedToday: 0, landedToday: 0, waiting: 0 },
    strain: { mean: 0, thin: 0, underStrain: 0, reducedHours: 0, winterClosed: 0 },
    staffing: { positions: 0, filled: 0, fillRate: 0, shortBy: 0 },
    /** Per-business roster demand, for jobs.js. Machine-readable on purpose: the board's
     *  "12/18" string is for a panel, this is for a system. */
    staffNeeds: {},
    leakageToMainlandPct: 0,
    board: [],          // one line per trading business, for a panel
    watchlist: [],      // the ones a player should look at
    notes: [],
    card: () => null
  });

  const B = [];                 // runtime records, insertion order = pack order, so deterministic
  const byId = new Map();
  const buckets = new Map();    // 'township|category' -> [record]
  const allByCategory = new Map();
  let cal = null;
  let lastDay = -1;
  const revenue365 = new Rolling(365);
  const cost365 = new Rolling(365);
  const stockout30 = new Rolling(30);
  let dayRevenue = 0, dayWages = 0, dayCost = 0, dayLost = 0, dayStockouts = 0, dayDrawings = 0;
  let residentsByTownship = {};
  /** Sim-days left before the stock model trusts its own read of a business's daily trade. */
  let warmupDays = 14;

  /* -------------------------------------------------------------- building the register */

  function build(w) {
    const pack = w.data.businesses;
    const list = (pack && pack.businesses) || [];
    if (!list.length) { state.notes.push('data/businesses.json is missing: the island has no shops.'); return; }

    for (const b of list) {
      const sector = sectorOf(b.type);
      const employs = b.employs || { min: 0, max: 0 };
      const scale = Math.max(0.4, (employs.min + employs.max) / 2);
      const band = b.price_band || 'n/a';
      const trades = TRADING_SECTORS.has(sector) && b.status !== 'closed' && b.status !== 'proposed' && BAND_TICKET[band] > 0;
      // Some businesses are not their township's. Minjerribah Camping is listed at Dunwich and runs
      // the campgrounds at Adder Rock, Cylinder, Home Beach, Amity Point, Flinders and Main Beach;
      // a 4WD tour picks up wherever the boat lands. Bucketing those by their office address gave
      // the island's biggest camping operator a slice of Dunwich's visitors and none of Point
      // Lookout's, and put it in permanent strain for no reason a local would recognise.
      const servesIslandWide = /camping-operator|tour-operator|surf-school|walking-tour|vehicle-hire|veterinary|^market$/.test(b.type)
        || b.township === 'Island-wide';
      const hours = parseHours(b.typical_hours);
      let weeklyOpenHours = 0;
      for (const d of hours.days) if (d.open != null) weeklyOpenHours += (d.close - d.open) / 60;
      const lines = trades ? stockLinesFor(sector, b.type) : null;

      const rec = {
        id: b.id,
        name: b.name,
        alsoKnownAs: b.also_known_as || null,
        type: b.type,
        sector,
        township: townshipIdFor(b.township),
        townshipLabel: b.township,
        servesIslandWide,
        status: b.status,
        confidence: b.confidence || 'medium',
        priceBand: band,
        ticket: BAND_TICKET[band] || 0,
        role: b.role_in_sim || '',
        source: b.source || null,
        note: b.note || null,
        hours,
        hoursBasis: hours.basis,
        weeklyOpenHours: Math.max(6, weeklyOpenHours),
        employs,
        scale,
        islandStaffShare: ISLAND_STAFF_SHARE[b.township] ?? 1,
        peakMultiplier: (b.seasonality && b.seasonality.peak_multiplier_estimate) || 1,
        peakPeriods: (b.seasonality && b.seasonality.peak_periods) || [],
        trades,

        // runtime
        open: false,
        stockArr: null,
        sfHosp: 1, sfGroc: 1, sfFuel: 1, sfOther: 1,
        hoursCutPct: 0,
        winterClosed: false,
        staffNeeded: employs.min || 0,
        staffed: 0,
        fillRate: 1,
        serviceLevel: 1,
        stock: null,
        dailyRateA$: 0,          // rolling estimate of a normal day's takings, for stock cover
        salesTodayA$: 0,
        costTodayA$: 0,
        cashA$: 0,
        marginPct: 0,
        turnedAwayTodayA$: 0,
        strain: 0,
        viability: 'steady',
        stockoutDays: 0,
        outOf: [],
        revenue365: new Rolling(365),
        recent14: new Rolling(14),
        openHoursToday: 0
      };

      if (lines) {
        // Two views of the same objects: an array for the per-tick loops, which must not allocate,
        // and a map for the delivery handler, which arrives by line name. The entries are shared,
        // so writing through either one is writing through both.
        rec.stockArr = [];
        rec.stock = {};
        for (const [line, perA$] of Object.entries(lines)) {
          const def = STOCK_LINES[line];
          const entry = {
            line, def, perA$, units: 0, coverDays: def.coverDays, capacity: Infinity,
            onOrder: 0, lastOrderDay: -99, out: false,
            // How much of a category's trade this line carries. A pub with no beer still sells
            // meals; a supermarket with no fresh food still sells tins. Precomputed, because it is
            // read inside the allocation loop and the allocation loop is the hot one.
            weightHosp: line === 'drink' ? 0.55 : line === 'perishable' ? 0.5 : line === 'fuel' ? 0.1 : line === 'dispensary' ? 0.8 : 0.2,
            weightGroc: line === 'drink' ? 0.35 : line === 'perishable' ? 0.42 : line === 'fuel' ? 0.1 : line === 'dispensary' ? 0.8 : 0.2,
            weightFuel: line === 'fuel' ? 0.95 : line === 'perishable' ? 0.2 : 0.15
          };
          rec.stockArr.push(entry);
          rec.stock[line] = entry;
        }
      }

      // A modelled opening bank. Enough that an ordinary quiet fortnight does not read as a crisis,
      // and small enough that a bad season is visible.
      rec.cashA$ = trades ? Math.round(scale * 1800 + 6000) : 0;
      B.push(rec);
      byId.set(rec.id, rec);
    }

    // Bucket the trading ones by township and category, once, so the per-tick allocation is two
    // array walks rather than a search across a hundred records.
    for (const cat of CATEGORIES) {
      const sectors = CATEGORY_SECTORS[cat] || [];
      const all = [];
      for (const t of TOWNSHIP_IDS.concat(['island-wide'])) {
        const arr = B.filter((r) => r.trades && sectors.includes(r.sector)
          && (r.township === t || (r.servesIslandWide && t !== 'island-wide')));
        buckets.set(t + '|' + cat, arr);
        for (const r of arr) all.push(r);
      }
      allByCategory.set(cat, all);
    }

    state.counts.total = list.length;
    for (const r of B) {
      if (r.status === 'trading') state.counts.trading++;
      else if (r.status === 'trading-unconfirmed') state.counts.unconfirmed++;
      else if (r.status === 'closed') state.counts.closed++;
      else if (r.status === 'proposed') state.counts.proposed++;
    }
    state.counts.trading_now = B.filter((r) => r.trades).length;
    state.notes.push(`${state.counts.unconfirmed} of the ${state.counts.total} records carry status trading-unconfirmed in the pack. They trade in this simulation and they are marked unconfirmed everywhere they surface.`);
    const est = B.filter((r) => r.hoursBasis === 'estimate').length;
    state.notes.push(`${est} businesses have modelled trading hours. data/businesses.json says these must not be shown to a player as published hours.`);
  }

  /* -------------------------------------------------------------- seeding stock */

  /**
   * Opening stock, and why it gets its own careful estimate.
   *
   * A shop's reorder logic works off what it has been taking lately, and on day one it has taken
   * nothing. An earlier version guessed a normal day's trade from the size of the place and got it
   * low, so every fridge on the island was seeded a third full and about thirty businesses ran out
   * of fresh food on the second morning of a new game. That is not an island running out of milk,
   * that is a simulation with an empty pantry, and a critic starting a fresh save would have seen
   * it before anything else.
   *
   * So the opening estimate is a share of the same daily capacity the allocator uses, which is at
   * least the right shape, and it is deliberately on the high side: a shop that opens over-stocked
   * corrects in a fortnight, a shop that opens under-stocked fails loudly on day two.
   */
  function seedStock(rec) {
    if (!rec.stockArr) return;
    const guess = rec.scale * rec.ticket * (CAPACITY_FACTOR[rec.sector] || 24) * 0.35;
    rec.dailyRateA$ = guess;
    for (const s of rec.stockArr) s.units = guess * s.perA$ * s.def.coverDays * STORAGE_SLACK;
  }

  /* -------------------------------------------------------------- deliveries */

  world.bus.on('freight:delivered', (o) => {
    const rec = byId.get(o && o.businessId);
    if (!rec || !rec.stock) return;
    const s = rec.stock[o.line];
    if (!s) return;
    s.units += o.units;
    s.onOrder = Math.max(0, s.onOrder - o.units);
    if (s.out) {
      s.out = false;
      world.bus.emit('business:recovered', { id: rec.id, name: rec.name, line: o.line, waitedDays: o.waitedDays });
    }
    state.deliveries.landedToday++;
  });

  /* -------------------------------------------------------------- one day's housekeeping */

  function newDay(w) {
    const info = cal.day(w.clock.date);
    const dow = w.clock.dayOfWeek;
    const pop = w.read('population') || {};
    residentsByTownship = {};
    for (const t of TOWNSHIP_IDS) {
      const b = pop.byTownship && pop.byTownship[t];
      residentsByTownship[t] = b ? b.residents : 0;
    }

    revenue365.push(dayRevenue);
    cost365.push(dayCost);
    stockout30.push(dayStockouts);
    state.revenueRolling365A$ = Math.round(revenue365.total);
    state.costRolling365A$ = Math.round(cost365.total);
    state.marginPctRolling365 = revenue365.total > 0
      ? +(100 * (revenue365.total - cost365.total) / revenue365.total).toFixed(1) : 0;
    state.stockouts.rolling30 = Math.round(stockout30.total);
    state.revenueTodayA$ = 0;
    state.wagesTodayA$ = 0;
    state.demandLostTodayA$ = 0;
    state.stockouts.startedToday = 0;
    state.deliveries.orderedToday = 0;
    state.deliveries.landedToday = 0;
    dayRevenue = 0; dayWages = 0; dayCost = 0; dayLost = 0; dayStockouts = 0; dayDrawings = 0;

    if (warmupDays > 0) warmupDays--;
    const jobs = w.read('jobs');
    const R = w.residents;

    for (const rec of B) {
      rec.revenue365.push(rec.salesTodayA$);
      if (rec.salesTodayA$ > 0 || rec.recent14.filled > 0) rec.recent14.push(rec.salesTodayA$);
      rec.salesTodayA$ = 0;
      // Reset with it, or the first settle of the new day computes this hour's sales as
      // (0 minus yesterday's total), books a large negative cost of goods, and hands every
      // business on the island a phantom profit. That bug put the island's trading margin at
      // eighty-six per cent, which is what finally gave it away.
      rec._lastSales = 0;
      rec.costTodayA$ = 0;
      rec.turnedAwayTodayA$ = 0;
      rec.openHoursToday = 0;

      // --- how busy this place expects to be, which sets the roster
      let surge = clamp((info.loadMultiplier - 1) / 2.5, 0, 1);
      if (info.isWhaleSeason) surge = Math.max(surge, clamp((info.whaleMultiplier - 1) / 1.2, 0, 1) * 0.6);
      let peakHit = false;
      for (const tag of rec.peakPeriods) if (inPeakPeriod(tag, info)) { peakHit = true; break; }
      rec.surge = peakHit ? surge : surge * 0.35;
      rec.peakToday = peakHit;

      const span = Math.max(0, (rec.employs.max || 0) - (rec.employs.min || 0));
      // The roster this place wants today, counted in jobs held by people who live here. See
      // ISLAND_STAFF_SHARE above for why the ferry operator's band is not an island roster.
      rec.staffNeeded = Math.round(((rec.employs.min || 0) + span * rec.surge) * rec.islandStaffShare);

      // --- who is actually available. population.js has already put residents into jobs; jobs.js
      //     adds the frictions on top. Both are read defensively so this file runs alone.
      const seat = R && R.businesses ? R.businesses.get(rec.id) : null;
      rec.staffed = seat ? seat.staffed : rec.staffNeeded;
      const fromJobs = jobs && jobs.staffingByBusiness ? jobs.staffingByBusiness[rec.id] : null;
      rec.fillRate = Number.isFinite(fromJobs) ? fromJobs
        : rec.staffNeeded > 0 ? clamp(rec.staffed / rec.staffNeeded, 0, 1.4) : 1;

      // Short-staffed is not closed. It is slower service, fewer tables, a shorter menu, and it
      // shows up as a soft ceiling on how much of the day's demand this place can actually take.
      rec.serviceLevel = clamp(0.42 + 0.58 * clamp(rec.fillRate, 0, 1.2), 0.42, 1);

      state.staffNeeds[rec.id] = {
        needed: rec.staffNeeded, onIsland: rec.staffed, sector: rec.sector,
        township: rec.township, band: [rec.employs.min || 0, rec.employs.max || 0],
        peakToday: rec.peakToday
      };

      // --- winter and midweek closures. Real behaviour on this island, and it is where a thin
      //     shoulder season shows up in a player's day: the cafe is shut on a Tuesday in June.
      const winter = info.schoolBlock !== 'summer' && (w.clock.month >= 4 && w.clock.month <= 7);
      const quiet = info.loadMultiplier < 1.2 && !info.isWeekend && !info.isPublicHoliday;
      // Closing on a Tuesday in June is a seasonal decision, not a distress signal, and gating it
      // on strain meant it never happened: the businesses that do it are not in trouble, they are
      // just not going to pay somebody to stand in an empty shop. The test is whether the last
      // fortnight has been well under the year, which is exactly what a small operator looks at.
      const thinFortnight = rec.recent14.filled >= 10 && rec.revenue365.filled >= 45
        && rec.recent14.mean < rec.revenue365.mean * 0.62;
      rec.winterClosed = rec.trades && winter && quiet && rec.scale < 9 && (dow === 1 || dow === 2)
        && (thinFortnight || rec.strain > 0.45);

      // --- restock. One order per line per day at most, and only when cover has fallen through.
      if (rec.stock) {
        // A rolling read of what a day is worth here, so cover means days rather than dollars.
        // Fourteen days, not a year: a shopkeeper orders against the last fortnight, and a
        // year-long mean run at the start of a simulation is mostly zeroes, which is how a shop
        // ends up ordering for a quiet Tuesday on the Thursday before Easter.
        const recent = rec.recent14.filled >= 3 ? rec.recent14.mean : rec.dailyRateA$;
        rec.dailyRateA$ = lerp(rec.dailyRateA$, Math.max(recent, rec.dailyRateA$ * 0.5), 0.4);
        // The ordinary rate, not the coming one. A cold room, a keg store and a back shed are the
        // size they are all year, so this is what sets how far ahead a business can physically buy.
        const baseRate = rec.revenue365.filled >= 30
          ? Math.max(rec.revenue365.mean, rec.dailyRateA$ * 0.35) : rec.dailyRateA$;
        // Order against the trade that is coming, not the trade that just happened, and look far
        // enough ahead to cover the gap in the deliveries rather than the gap in the calendar.
        // There is no carrier run on a Sunday and one on a Saturday, so a Thursday order is the
        // last one that reliably lands before the weekend, and a shop that orders for an average
        // Thursday is out of milk by Sunday lunchtime. Three days is that window.
        let ahead = 1;
        for (let n = 0; n <= 3; n++) {
          const f = n === 0 ? info : cal.day(new Date(w.clock.date.getTime() + n * 86400000));
          const s2 = clamp((f.loadMultiplier - 1) / 2.5, 0, 1);
          let hit = false;
          for (const tag of rec.peakPeriods) if (inPeakPeriod(tag, f)) { hit = true; break; }
          const dayF = (f.dow === 0 || f.dow === 6 ? 1.18 : 0.97)
            * (1 + (hit ? (rec.peakMultiplier - 1) * s2 : s2 * 0.4));
          if (dayF > ahead) ahead = dayF;
        }
        const expected = rec.dailyRateA$ * ahead;

        for (let k = 0; k < rec.stockArr.length; k++) {
          const s = rec.stockArr[k];
          const def = s.def;
          const perDay = Math.max(0.001, expected * s.perA$);
          if (def.spoilPerDay > 0) s.units = Math.max(0, s.units * (1 - def.spoilPerDay));
          s.coverDays = (s.units + s.onOrder) / perDay;
          // How much of this line the premises can actually hold. This is the constraint that makes
          // a long weekend bite: a publican who knows Easter is coming still cannot fit four Easters
          // of kegs in the store, and a shop with one cold room cannot carry five days of triple
          // trade in fresh food. Without it every business orders its way out of every peak and the
          // island never runs out of anything, which is not this island.
          // The storage cap is held off for the first fortnight, while `dailyRateA$` is still
          // learning what this place actually takes. Capping a business against an estimate that is
          // still wrong is how a fortnight of phantom shortages happens.
          s.capacity = warmupDays > 0 ? Infinity
            : Math.max(perDay * 1.2, baseRate * s.perA$ * def.coverDays * STORAGE_SLACK);
          if (s.coverDays < def.reorderAt && w.clock.dayIndex - s.lastOrderDay >= 1) {
            const room = Math.max(0, s.capacity - s.units - s.onOrder);
            const want = Math.min(room, Math.max(0, (def.coverDays - s.coverDays) * perDay));
            if (want > perDay * 0.35) {
              s.onOrder += want;
              s.lastOrderDay = w.clock.dayIndex;
              state.deliveries.orderedToday++;
              w.bus.emit('freight:order', {
                businessId: rec.id, line: s.line, units: want,
                urgent: s.units <= 0 || s.coverDays < def.reorderAt * 0.4
              });
            }
          }
        }
      }
    }
    state.day = w.clock.formatDate();
  }

  /* -------------------------------------------------------------- demand and allocation */

  /**
   * How much of each category a business can still serve, 0..1, given what it has run out of.
   * Recomputed once a tick per business rather than once per business per category per township.
   */
  function refreshStockFactors(rec) {
    if (!rec.stockArr) return;
    let h = 1, g = 1, f = 1, o = 1;
    for (let k = 0; k < rec.stockArr.length; k++) {
      const s = rec.stockArr[k];
      if (s.units > 0) continue;
      if (1 - s.weightHosp < h) h = 1 - s.weightHosp;
      if (1 - s.weightGroc < g) g = 1 - s.weightGroc;
      if (1 - s.weightFuel < f) f = 1 - s.weightFuel;
      if (o > 0.8) o = 0.8;
    }
    rec.sfHosp = h; rec.sfGroc = g; rec.sfFuel = f; rec.sfOther = o;
  }

  function stockFactor(rec, cat) {
    if (!rec.stockArr) return 1;
    return cat === 'hospitality' ? rec.sfHosp : cat === 'groceries' ? rec.sfGroc : cat === 'fuel' ? rec.sfFuel : rec.sfOther;
  }

  function allocate(w, cat, pool, list, minute) {
    if (!(pool > 0) || !list.length) return pool;
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec.open) { rec._w = 0; continue; }
      const sf = stockFactor(rec, cat);
      // Bigger places take more, but not linearly: a coffee van beside a supermarket still sells
      // coffee. The peak multiplier decides where a surge lands, which is what the pack's own
      // seasonality field is for.
      let weight = Math.pow(rec.scale, 0.72) * rec.serviceLevel * sf;
      if (rec.peakToday) weight *= 1 + (rec.peakMultiplier - 1) * (rec.surge || 0) * 0.8;
      rec._w = weight;
      total += weight;
    }
    if (total <= 0) return pool;
    let served = 0;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec._w) continue;
      const share = pool * (rec._w / total);
      // A venue cannot take unlimited money in ten minutes. Its daily capacity is its size, its
      // ticket and how many of those tickets one staff-day can put through, and the ceiling for this
      // tick is that day's capacity shaped by the hour. Hitting it is what a queue looks like here.
      //
      // The factor is per sector because a campground and a coffee van are not the same shape: one
      // sells two hundred nights at once with three people on, the other sells one flat white at a
      // time. An earlier flat factor capped Minjerribah Camping at about A$2,000 a day and quietly
      // put the island's biggest camping operator into permanent strain, which is a modelling
      // artefact and would have read to a local as an accusation.
      const ceiling = rec.scale * rec.ticket * (CAPACITY_FACTOR[rec.sector] || 24)
        * rec.serviceLevel * hourWeight(cat, minute);
      const take = Math.min(share, Math.max(0, ceiling));
      if (take <= 0) continue;
      rec.salesTodayA$ += take;
      served += take;
      const arr = rec.stockArr;
      if (arr) {
        for (let k = 0; k < arr.length; k++) {
          const s = arr[k];
          const used = take * s.perA$;
          s.units = s.units > used ? s.units - used : 0;
        }
      }
    }
    return Math.max(0, pool - served);
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'businesses',
    phase: 'economy',
    order: 30,

    init(w) {
      cal = (w.residents && w.residents.calendar) || makeCalendar(w.data.events);
      build(w);
      for (const rec of B) seedStock(rec);
      newDay(w);
      lastDay = w.clock.dayIndex;
      state.ready = B.length > 0;
      state.card = (id) => {
        const rec = byId.get(id);
        if (!rec) return null;
        return {
          id: rec.id, name: rec.name, alsoKnownAs: rec.alsoKnownAs, type: rec.type, sector: rec.sector,
          township: rec.townshipLabel, status: rec.status, confidence: rec.confidence,
          priceBand: rec.priceBand, role: rec.role, source: rec.source, note: rec.note,
          hoursBasis: rec.hoursBasis === 'estimate' ? 'modelled, not published trading hours' : rec.hoursBasis,
          openNow: rec.open, hoursCutPct: rec.hoursCutPct, winterClosed: rec.winterClosed,
          staff: {
          needed: rec.staffNeeded, filled: rec.staffed, fillRate: +rec.fillRate.toFixed(2),
          band: rec.employs, onShiftNow: Math.round((rec.onShift || 0) * 10) / 10,
          basis: 'The band is the published estimate of the head count on the books. On shift now is '
            + 'the modelled roster at this hour, which is a much smaller number and the one that '
            + 'costs money.'
        },
          serviceLevel: +rec.serviceLevel.toFixed(2),
          takingsTodayA$: Math.round(rec.salesTodayA$),
          takingsYearA$: Math.round(rec.revenue365.total),
          marginPct: +rec.marginPct.toFixed(1),
          cashA$: Math.round(rec.cashA$),
          viability: rec.viability,
          strain: +rec.strain.toFixed(2),
          outOf: rec.outOf.slice(),
          stock: rec.stockArr ? Object.fromEntries(rec.stockArr.map((s) => [s.line, {
            label: s.def.label,
            coverDays: +s.coverDays.toFixed(1),
            onOrder: Math.round(s.onOrder * 100) / 100,
            // How full the cold room, the keg store or the back shed is. A hundred means they
            // cannot buy any more of it ahead of the weekend, whatever the weekend is going to be.
            heldAgainstCapacityPct: Number.isFinite(s.capacity) && s.capacity > 0
              ? Math.round(100 * s.units / s.capacity) : null
          }])) : null,
          modelled: 'Every dollar on this card is modelled. No trading figure is published for any business on this island.'
        };
      };
      w.bus.emit('businesses:ready', { count: B.length, trading: state.counts.trading_now });
    },

    tick(w) {
      if (!state.ready) return;
      if (w.clock.dayIndex !== lastDay) { lastDay = w.clock.dayIndex; newDay(w); }

      const minute = w.clock.minuteOfDay;
      const dow = w.clock.dayOfWeek;
      const prices = w.read('prices') || {};
      const tour = w.read('tourism') || {};
      const freightIdx = prices.freightIndex || 1;
      const premium = (prices.premium && prices.premium.total) || 20;

      // --- who is open
      let openNow = 0;
      for (let i = 0; i < B.length; i++) {
        const rec = B[i];
        if (!rec.trades) { rec.open = false; continue; }
        if (rec.winterClosed) { rec.open = false; continue; }
        let open = openAt(rec.hours, dow, minute);
        if (open && rec.hoursCutPct > 0) {
          // A place cutting hours takes them off the late end, which is where the wage cost is.
          const d = rec.hours.days[dow];
          if (d && d.open != null) {
            const span = d.close - d.open;
            if (minute >= d.close - span * (rec.hoursCutPct / 100)) open = false;
          }
        }
        rec.open = open;
        if (open) { openNow++; rec.openHoursToday += 1 / 6; refreshStockFactors(rec); }
      }
      state.openNow = openNow;

      // --- the money looking for somewhere to go, this tick
      //     Residents first. A dearer island shelf pushes more of the weekly shop across the bay,
      //     which is a real behaviour and a real second-order cost: the more the island charges,
      //     the less volume the island's shops have to spread their fixed costs over.
      const leak = clamp(BASE_MAINLAND_LEAK + (premium - 20) * 0.006 + (freightIdx - 1) * 0.10, 0.14, 0.46);
      state.leakageToMainlandPct = Math.round(leak * 1000) / 10;
      const weekendLift = (dow === 0 || dow === 6) ? 1.18 : 0.97;

      let lost = 0;
      for (const cat of CATEGORIES) {
        const catLeak = cat === 'groceries' ? leak : cat === 'retail' ? leak * 0.8 : 0;
        for (const t of TOWNSHIP_IDS) {
          const residents = residentsByTownship[t] || 0;
          const resPool = residents * (RESIDENT_DAILY[cat] || 0) * (1 - catLeak) * weekendLift * hourWeight(cat, minute);
          const visPool = (tour.demand && tour.demand.byTownshipCategory && tour.demand.byTownshipCategory[t + '|' + cat]) || 0;
          let pool = resPool + visPool;
          if (!(pool > 0)) continue;
          pool = allocate(w, cat, pool, buckets.get(t + '|' + cat) || [], minute);
          // Whatever the township could not serve: people on this island drive. About a third of
          // unmet demand finds a shop in another township, the rest is simply a wasted trip.
          if (pool > 0.01) {
            const spill = allocate(w, cat, pool * 0.34, allByCategory.get(cat) || [], minute);
            lost += pool * 0.66 + spill;
          }
        }
      }
      dayLost += lost;
      state.demandLostTodayA$ = Math.round(dayLost);

      // --- settle the books, once a sim-hour: costs, cash, strain and stockouts. Doing this every
      //     tick would be six times the work for a number nobody can see move in ten minutes.
      if (minute % 60 !== 0) {
        let rev = 0;
        for (let i = 0; i < B.length; i++) rev += B[i].salesTodayA$;
        state.revenueTodayA$ = Math.round(rev);
        return;
      }

      let rev = 0, wages = 0, cost = 0, drawings = 0, strainSum = 0, strainN = 0;
      let thin = 0, underStrain = 0, reduced = 0, winterClosed = 0, outNow = 0;
      const live = [];
      const bySector = {};
      const byTownship = {};
      let positions = 0, filled = 0;

      for (let i = 0; i < B.length; i++) {
        const rec = B[i];
        positions += rec.staffNeeded;
        // The filled figure comes off the fill rate, not off the raw head count population.js put
        // in the door, because jobs.js is the authority on who can actually be got. Otherwise the
        // two systems publish two different staffing crises for the same island.
        filled += Math.min(rec.staffNeeded, rec.staffNeeded * rec.fillRate);
        if (!rec.trades) {
          if (rec.winterClosed) winterClosed++;
          continue;
        }

        // Wages accrue while the doors are open, and only for the people actually on shift at this
        // hour: the week's labour hours spread across the week's trading hours, weighted by how busy
        // this hour of the day is for this kind of business. See AVG_WEEKLY_HOURS above.
        const onBooks = Math.min(rec.staffed, rec.staffNeeded);
        const shiftShape = 0.55 + 0.45 * (hourWeight(rec.sector === 'grocery' ? 'groceries' : rec.sector === 'accommodation' ? 'accommodation' : 'hospitality', minute) * 144 / 6);
        const onShift = rec.open ? (onBooks * AVG_WEEKLY_HOURS / rec.weeklyOpenHours) * shiftShape : 0;
        rec.onShift = onShift;
        const hourWages = onShift * (WAGE_PER_HOUR[rec.sector] || 35);
        // Cost of what was sold, marked up by the freight component of the island premium. Only the
        // freight component: the other four are margin and overhead, not the cost of the goods.
        const cogsRate = (COST_OF_SALES[rec.sector] || 0.4) * (1 + ((prices.premium && prices.premium.freight) || 4) / 100);
        const hourSales = rec.salesTodayA$ - (rec._lastSales || 0);
        rec._lastSales = rec.salesTodayA$;
        const hourCogs = hourSales * cogsRate;
        const hourOverhead = rec.scale * OVERHEAD_PER_SCALE_DAY * (OVERHEAD_MULTIPLIER[rec.sector] || 1) / 24;
        const hourDrawings = Math.max(0, hourSales) * DRAWINGS_AND_FINANCE;
        const hourCost = hourWages + hourCogs + hourOverhead + hourDrawings;

        rec.costTodayA$ += hourCost;
        rec.cashA$ = clamp(rec.cashA$ + hourSales - hourCost, -60000, rec.scale * 90000 + 200000);
        rec.marginPct = rec.salesTodayA$ > 0 ? 100 * (rec.salesTodayA$ - rec.costTodayA$) / rec.salesTodayA$ : 0;

        // --- stockouts
        rec.outOf.length = 0;
        if (rec.stockArr) {
          for (let k = 0; k < rec.stockArr.length; k++) {
            const s = rec.stockArr[k];
            const perDay = Math.max(0.001, rec.dailyRateA$ * s.perA$);
            s.coverDays = (s.units + s.onOrder) / perDay;
            if (s.units <= 0) {
              rec.outOf.push(s.def.label);
              outNow++;
              if (!s.out) {
                s.out = true;
                dayStockouts++;
                state.stockouts.startedToday++;
                w.bus.emit('business:stockout', {
                  id: rec.id, name: rec.name, township: rec.townshipLabel,
                  line: s.line, label: s.def.label, onOrder: Math.round(s.onOrder),
                  why: 'the delivery has not landed'
                });
              }
              if (live.length < 12) live.push({ id: rec.id, name: rec.name, line: s.def.label, township: rec.townshipLabel });
            }
          }
          if (rec.outOf.length) rec.stockoutDays += 1 / 24;
        }

        // --- strain and the viability ladder. It bottoms out at behaviours, never at a closure.
        const runwayDays = rec.cashA$ / Math.max(1, rec.scale * OVERHEAD_PER_SCALE_DAY * (OVERHEAD_MULTIPLIER[rec.sector] || 1)
          + rec.staffNeeded * AVG_WEEKLY_HOURS / 7 * (WAGE_PER_HOUR[rec.sector] || 35));
        const marginStrain = clamp((6 - rec.marginPct) / 26, 0, 1);
        const cashStrain = clamp((30 - runwayDays) / 40, 0, 1);
        const staffStrain = clamp(1 - rec.fillRate, 0, 1);
        const stockStrain = clamp(rec.outOf.length * 0.35, 0, 1);
        // Seasonality is a strain in its own right and it is the one this island actually runs on.
        // A venue the pack gives a peak multiplier of three to is a venue that makes its year in
        // four months and spends the other eight paying rent out of what is left. Without this
        // term every business here reads "trading well" through a June that a real operator spends
        // deciding whether to open on Tuesdays.
        const seasonStrain = clamp((rec.peakMultiplier - 1.5) / 1.8, 0, 1) * (1 - clamp(rec.surge || 0, 0, 1));
        const target = clamp(marginStrain * 0.26 + cashStrain * 0.22 + staffStrain * 0.18
          + stockStrain * 0.12 + seasonStrain * 0.22, 0, 1);
        rec.strain += (target - rec.strain) * 0.04;

        const before = rec.viability;
        if (rec.strain > 0.62) rec.viability = 'under strain';
        else if (rec.strain > 0.45) rec.viability = 'thin';
        else if (rec.strain > 0.26) rec.viability = 'steady';
        else rec.viability = 'trading well';

        // Cutting hours is the lever a small island business actually pulls, and it is reversible.
        const wantCut = clamp((rec.strain - 0.5) * 110, 0, 34);
        if (wantCut > rec.hoursCutPct + 6) {
          rec.hoursCutPct = Math.round(wantCut);
          w.bus.emit('business:reduced-hours', { id: rec.id, name: rec.name, cutPct: rec.hoursCutPct, why: 'trade is thin and the wage bill is not' });
        } else if (wantCut < rec.hoursCutPct - 8) {
          rec.hoursCutPct = Math.max(0, Math.round(wantCut));
        }
        if (rec.hoursCutPct > 0) reduced++;
        if (rec.winterClosed) winterClosed++;
        if (rec.viability === 'thin') thin++;
        if (rec.viability === 'under strain') underStrain++;
        if (before !== rec.viability && rec.viability === 'under strain') {
          w.bus.emit('business:strained', { id: rec.id, name: rec.name, township: rec.townshipLabel, strain: +rec.strain.toFixed(2) });
        }

        rev += rec.salesTodayA$;
        wages += hourWages;
        drawings += hourDrawings;
        cost += hourCost;
        strainSum += rec.strain; strainN++;

        const s = bySector[rec.sector] || (bySector[rec.sector] = { count: 0, open: 0, takingsA$: 0, strain: 0 });
        s.count++; if (rec.open) s.open++; s.takingsA$ += rec.salesTodayA$; s.strain += rec.strain;
        const tw = byTownship[rec.township] || (byTownship[rec.township] = { count: 0, open: 0, takingsA$: 0, outOf: 0 });
        tw.count++; if (rec.open) tw.open++; tw.takingsA$ += rec.salesTodayA$; tw.outOf += rec.outOf.length;
      }

      dayRevenue = rev; dayWages += wages; dayCost += cost; dayDrawings += drawings;
      state.revenueTodayA$ = Math.round(rev);
      state.wagesTodayA$ = Math.round(dayWages);
      state.drawingsTodayA$ = Math.round(dayDrawings);
      state.marginPct = rev > 0 ? +clamp(100 * (rev - dayCost) / rev, -300, 100).toFixed(1) : 0;
      state.strain = {
        mean: strainN ? +(strainSum / strainN).toFixed(3) : 0,
        thin, underStrain, reducedHours: reduced, winterClosed
      };
      state.stockouts.openNow = outNow;
      state.stockouts.live = live;
      state.staffing = {
        positions, filled: Math.round(filled),
        fillRate: positions ? +(filled / positions).toFixed(3) : 1,
        shortBy: Math.max(0, Math.round(positions - filled))
      };
      state.deliveries.waiting = (prices.freight && prices.freight.ordersWaiting) || 0;
      for (const k of Object.keys(bySector)) {
        bySector[k].takingsA$ = Math.round(bySector[k].takingsA$);
        bySector[k].strain = +(bySector[k].strain / Math.max(1, bySector[k].count)).toFixed(2);
      }
      for (const k of Object.keys(byTownship)) byTownship[k].takingsA$ = Math.round(byTownship[k].takingsA$);
      state.bySector = bySector;
      state.byTownship = byTownship;

      // --- the two lists a panel wants
      if (minute % 240 === 0) {
        state.board = B.filter((r) => r.trades).map((r) => ({
          id: r.id, name: r.name, township: r.townshipLabel, sector: r.sector,
          open: r.open, takingsA$: Math.round(r.salesTodayA$),
          staff: `${r.staffed}/${r.staffNeeded}`, viability: r.viability,
          outOf: r.outOf.length ? r.outOf.join(', ') : null,
          unconfirmed: r.status === 'trading-unconfirmed'
        })).sort((a, b) => b.takingsA$ - a.takingsA$);
        state.watchlist = B.filter((r) => r.trades && (r.strain > 0.55 || r.outOf.length))
          .sort((a, b) => b.strain - a.strain).slice(0, 10)
          .map((r) => ({
            id: r.id, name: r.name, township: r.townshipLabel, viability: r.viability,
            why: r.outOf.length ? `out of ${r.outOf.join(' and ')}`
              : r.fillRate < 0.75 ? `${r.staffNeeded - r.staffed} short on the roster`
                : r.marginPct < 2 ? 'takings are not covering the week' : 'trade is thin'
          }));
      }
    },

    describe() {
      return {
        trading: state.counts.trading_now,
        openNow: state.openNow,
        takingsTodayA$: state.revenueTodayA$,
        year365A$: state.revenueRolling365A$,
        marginPct: state.marginPct,
        marginYearPct: state.marginPctRolling365,
        fillRate: state.staffing.fillRate,
        shortBy: state.staffing.shortBy,
        outOfSomething: state.stockouts.openNow,
        stockouts30: state.stockouts.rolling30,
        strain: state.strain.mean,
        thin: state.strain.thin,
        underStrain: state.strain.underStrain,
        reducedHours: state.strain.reducedHours,
        lostA$: state.demandLostTodayA$,
        mainlandLeakPct: state.leakageToMainlandPct
      };
    },

    save() {
      return {
        warmupDays,
        rev365: revenue365.save(), cost365: cost365.save(), so30: stockout30.save(),
        rows: B.map((r) => [
          r.id, Math.round(r.cashA$), +r.strain.toFixed(3), r.hoursCutPct, Math.round(r.dailyRateA$),
          r.stockArr ? r.stockArr.map((s) => [s.line, Math.round(s.units), Math.round(s.onOrder), s.lastOrderDay, s.out ? 1 : 0]) : null
        ])
      };
    },

    load(w, s) {
      if (!s) return;
      lastDay = -1;
      warmupDays = s.warmupDays ?? 0;
      revenue365.load(s.rev365); cost365.load(s.cost365); stockout30.load(s.so30);
      state.revenueRolling365A$ = Math.round(revenue365.total);
      state.costRolling365A$ = Math.round(cost365.total);
      state.marginPctRolling365 = revenue365.total > 0
        ? +(100 * (revenue365.total - cost365.total) / revenue365.total).toFixed(1) : 0;
      state.stockouts.rolling30 = Math.round(stockout30.total);
      // Neutral rather than zero until the next hourly settle recomputes it. A fill rate of zero on
      // a freshly loaded save reads as "nobody turned up on this island", which is not what a load is.
      state.staffing.fillRate = 1;
      for (const row of s.rows || []) {
        const rec = byId.get(row[0]);
        if (!rec) continue;
        rec.cashA$ = row[1]; rec.strain = row[2]; rec.hoursCutPct = row[3]; rec.dailyRateA$ = row[4];
        rec._lastSales = 0;
        rec.viability = rec.strain > 0.62 ? 'under strain' : rec.strain > 0.45 ? 'thin'
          : rec.strain > 0.26 ? 'steady' : 'trading well';
        if (rec.stock && row[5]) {
          for (const [line, units, onOrder, lastOrderDay, out] of row[5]) {
            const st = rec.stock[line];
            if (st) { st.units = units; st.onOrder = onOrder; st.lastOrderDay = lastOrderDay; st.out = !!out; }
          }
        }
      }
    }
  });
}
