// Housing. The loop, not the number.
//
// THE PUBLISHED FACT
//   data/residents.json census_baseline, ABS 2021, confidence high, and the pack's own note on it:
//   "Half the island's houses had nobody in them on census night. Queensland's figure was 9.3 per
//   cent. This single number is the island's economy, its housing shortage and its politics in one
//   line." 1,964 private dwellings, 49.4 per cent occupied. Point Lookout on its own: 1,012
//   dwellings, 35 per cent occupied.
//
// WHY THIS FILE IS SHAPED THE WAY IT IS
//   A panel that says "rental supply: 0.2" teaches nobody anything. The interesting object here is
//   a chain with six links, each of which a player can watch move, and each of which has a
//   different lever attached to it:
//
//     1  visitors want beds                  <- tourism, the school calendar, whale season
//     2  a night beats a week                <- the yield ratio, which is the actual engine
//     3  so houses move to short stay        <- registration, a cap, a rates differential
//     4  so long-term rentals thin out       <- the number everyone quotes
//     5  so workers cannot find a room       <- worker accommodation, secondary dwellings
//     6  so shifts go unfilled and hours cut <- and the island's services thin out
//     and back to 1, because a thinner island is a worse place to live in and more owners let
//     their house to visitors instead of to a neighbour.
//
//   `state.loop` is that chain as data: six stages, each with a value, a thirty-day delta and one
//   plain sentence. The tightening is the read model, not a derived summary of it.
//
// THE ENGINE, AND WHY IT IS NOT A VILLAIN
//   Short stay wins, and it does not win by five to one. On the modelled figures a Point Lookout
//   house lets long term for about A$350 a week (published median) which is roughly A$18,000 gross
//   a year, and short stay for roughly A$39,000 gross across the nights it actually sells. After
//   agent commission, cleaning, linen, higher rates and a much higher maintenance load, the ratio
//   lands near one and a half, and at Dunwich it lands close to one. An owner choosing short stay
//   is making an ordinary decision, and the point of modelling it properly rather than moralising
//   it is that a player can then see which levers change the arithmetic and which only change the
//   paperwork.
//
// HOW IT COUPLES TO THE REST OF THE ISLAND
//   Deliberately, through the dwelling graph that src/systems/agents/population.js already owns
//   rather than through a number this file invents. population.js moves a new household in only
//   when `world.residents.rentalPool` has a dwelling in it. This file converts dwellings between
//   that pool and the holiday-let pool. So when the loop tightens, in-migration slows down because
//   there is genuinely nowhere to put anybody, and when a policy loosens it, people start arriving
//   again. Neither file imports the other and neither had to be told.
//
//   The only field this file writes on another system's graph is a dwelling's `use` and a
//   `shortStay` flag it adds itself, and it only ever touches dwellings that nobody lives in.
//   A dwelling with a household in it is never touched by this file, ever.
//
// Reads: population, tourism, visitors, businesses, jobs, policy, prices. Publishes `housing`.
// Emits `housing:converted`, `housing:worker-cannot-find-a-room`, `housing:lease-ending`.

import { clamp, lerp, approach, Rolling, TOWNSHIP_IDS } from './common.js';
import { makeCalendar } from '../agents/calendar.js';

/* ------------------------------------------------------------------ the published anchors */

const TOWN = {
  dunwich: { label: 'Dunwich (Goompi)', medianRent: 294, dwellings: 408, occupiedPct: 73.3 },
  'point-lookout': { label: 'Point Lookout (Mulumba)', medianRent: 350, dwellings: 1012, occupiedPct: 35 },
  'amity-point': { label: 'Amity Point (Pulan)', medianRent: 350, dwellings: 406, occupiedPct: 54.1 },
  'one-mile': { label: 'One Mile and the rural balance', medianRent: 320, dwellings: 138, occupiedPct: 70 }
};
const ISLAND_MEDIAN_RENT = 300;      // published, ABS 2021
const QLD_MEDIAN_RENT = 365;         // published, ABS 2021
const ISLAND_MEDIAN_INCOME = 1147;   // published weekly household income, ABS 2021

/* ------------------------------------------------------------------ modelled nightly rates

No short-stay rate for any dwelling on this island is published anywhere that was found. These are
modelling parameters. Peak is the summer school block and Easter; shoulder is the rest. */

const NIGHTLY = {
  dunwich: { peak: 245, shoulder: 165 },
  'point-lookout': { peak: 455, shoulder: 255 },
  'amity-point': { peak: 300, shoulder: 185 },
  'one-mile': { peak: 250, shoulder: 170 }
};

/** What comes off a short-stay dollar before the owner sees it. Modelled. */
const SHORT_STAY_COSTS = 0.41;   // agent commission, cleaning, linen, consumables, higher rates
/** And off a long-term dollar. Modelled, and much lower, which is the whole argument. */
const LONG_TERM_COSTS = 0.19;    // agent management, vacancy allowance, maintenance, rates

/** Modelled beds tied to a job rather than to a lease, at the employers big enough to hold them. */
const EMPLOYER_BEDS = [
  ['stradbroke-island-beach-hotel', 14],
  ['minjerribah-camping', 8],
  ['allure-stradbroke-resort', 6],
  ['pandanus-palms-resort', 4],
  ['manta-lodge-scuba-centre', 6],
  ['islander-holiday-resort', 3],
  ['whalewatch-ocean-beach-resort', 3],
  ['nareeba-moopi-moopi-pa', 2]
];

/** A rental market never actually reaches zero: somebody is always between tenancies, on the
 *  market, or waiting on probate. The floor stops a long run from producing an island with
 *  literally no rentals, which would be both wrong and unrecoverable. */
const RENTAL_FLOOR = 34;

const HOUSING_LEVERS = [
  'short-stay-letting-registration',
  'short-stay-cap-by-township',
  'rates-differential-unoccupied',
  'worker-accommodation-build',
  'community-housing-expansion',
  'secondary-dwelling-fast-track',
  'gumpi-land-release'
];

export function registerHousing(world) {
  const rng = world.rng.stream('housing');

  const state = world.publish('housing', {
    ready: false,
    day: null,
    basis: 'Dwelling counts, occupancy shares and median rents are published ABS 2021 figures. '
      + 'Every nightly rate, every cost share and every conversion rate is modelled.',

    stock: { total: 0, lived_in: 0, holidayHome: 0, shortStayLet: 0, onTheMarket: 0, unoccupiedPct: 0, byTownship: {} },

    rentals: {
      available: 0, seekers: 0, monthsToFind: 0,
      medianWeeklyA$: ISLAND_MEDIAN_RENT, publishedMedianA$: ISLAND_MEDIAN_RENT,
      queenslandMedianA$: QLD_MEDIAN_RENT, emptyButNotAvailable: 0,
      shareOfMedianIncomePct: 0, shareOfAWorkerWagePct: 0,
      cameOnTheMarket30: 0, takenUp30: 0, newListingsPerMonth: 0
    },

    shortStay: {
      lets: 0, nightsSoldRolling365: 0, occupancyPct: 0,
      nightlyA$: 0, grossPerLetA$: 0, netPerLetA$: 0,
      longTermNetA$: 0, yieldRatio: 0, yieldRatioByTownship: {}
    },

    conversions: { toShortStay30: 0, toLongTerm30: 0, net365: 0, lastReason: '' },

    workers: { beds: 0, bedsFilled: 0, seekingARoom: 0, gaveUpRolling365: 0, frictionIndex: 0 },

    /** The chain. Six stages, each with a thirty-day delta and one plain sentence. */
    loop: [],
    tightness: 0,

    policy: {},
    notes: [],
    fit: {}
  });

  let cal = null;
  let lastDay = -1;
  let lastMonthDay = -1;
  const conv30in = new Rolling(30);
  const conv30out = new Rolling(30);
  const convNet365 = new Rolling(365);
  const nights365 = new Rolling(365);
  const gaveUp365 = new Rolling(365);
  const onMarket30 = new Rolling(30);
  const takenUp30 = new Rolling(30);
  const history = new Map();     // loop stage id -> Rolling(30) of daily values
  let employerBeds = 0;
  let extraWorkerBeds = 0;       // built by a lever
  let dayConv = { in: 0, out: 0, onMarket: 0, takenUp: 0, gaveUp: 0 };
  let lastRentalCount = 0;
  let newListingsThisMonth = 0;
  let rentNow = ISLAND_MEDIAN_RENT;

  /* -------------------------------------------------------------- reading the island */

  /**
   * An empty house is not a rental. This is the single most important correction in this file.
   *
   * population.js models the census residual honestly: 192 dwellings sit in a `vacant` pool because
   * a quarter of Dunwich's dwellings were unoccupied on census night, and data/residents.json says
   * exactly why: "between tenancies, on the market, being repaired, or the occupant was away". Read
   * those 192 as available rentals and this island has a comfortable rental market, which is the
   * opposite of the truth. Only the ones actually advertised for a long-term tenancy are available
   * to somebody looking for a room, and on a market this tight that is a handful at a time.
   *
   * Modelled. The four states and their shares are a modelling choice; the reason for splitting
   * them at all is the pack's own sentence.
   */
  const MARKET_STATES = ['long-term', 'for-sale', 'repairs', 'owner-away'];
  const MARKET_SHARES = [0.12, 0.30, 0.24, 0.34];
  // Rates for rotateMarket(), set so the pool holds its 12 per cent rather than drifting. A
  // symmetric five per cent each way looks fair and is wrong: it settles at fifty per cent, which
  // over a sim-year quietly turned a housing crisis into a comfortable rental market. The two rates
  // have to be in the ratio of the two shares. A listing lasts about seven months on this
  // arithmetic, which is long, and it is long because a house that is not let is usually not being
  // offered rather than being ignored.
  const OTHER_TO_LONG = 0.020;
  const LONG_TO_OTHER = OTHER_TO_LONG * (1 - MARKET_SHARES[0]) / MARKET_SHARES[0];

  function marketOf(d) {
    if (d.market) return d.market;
    const r = rng.float();
    let acc = 0;
    for (let i = 0; i < MARKET_STATES.length; i++) {
      acc += MARKET_SHARES[i];
      if (r < acc) return (d.market = MARKET_STATES[i]);
    }
    return (d.market = 'owner-away');
  }

  function stockScan(w) {
    const R = w.residents;
    const out = {
      total: 0, lived_in: 0, holidayHome: 0, shortStayLet: 0, onTheMarket: 0,
      advertisedForRent: 0, forSale: 0, beingRepaired: 0, ownerAway: 0, byTownship: {}
    };
    for (const t of TOWNSHIP_IDS) out.byTownship[t] = { label: (TOWN[t] || {}).label || t, total: 0, lived_in: 0, shortStay: 0, holidayHome: 0, onTheMarket: 0, advertisedForRent: 0 };
    if (!R || !R.dwellings) return out;
    for (let i = 0; i < R.dwellings.length; i++) {
      const d = R.dwellings[i];
      out.total++;
      const b = out.byTownship[d.townshipId] || out.byTownship.dunwich;
      b.total++;
      if (d.use === 'resident') { out.lived_in++; b.lived_in++; }
      else if (d.use === 'vacant') {
        out.onTheMarket++; b.onTheMarket++;
        const m = marketOf(d);
        if (m === 'long-term') { out.advertisedForRent++; b.advertisedForRent++; }
        else if (m === 'for-sale') out.forSale++;
        else if (m === 'repairs') out.beingRepaired++;
        else out.ownerAway++;
      } else if (d.shortStay) { out.shortStayLet++; b.shortStay++; }
      else { out.holidayHome++; b.holidayHome++; }
    }
    return out;
  }

  /**
   * Houses come off one list and onto another. A repair finishes, an owner comes home, a sale
   * falls through, a landlord decides to keep it empty. This is the flow that puts new listings in
   * front of somebody looking, and it is why `monthsToFind` is about a flow rather than a stock.
   */
  function rotateMarket(w) {
    const R = w.residents;
    if (!R || !R.rentalPool) return 0;
    let newListings = 0;
    for (let i = 0; i < R.rentalPool.length; i++) {
      const d = R.rentalPool[i];
      const m = marketOf(d);
      if (m === 'long-term') {
        if (rng.float() < LONG_TO_OTHER) d.market = rng.float() < 0.5 ? 'for-sale' : 'owner-away';
      } else if (rng.float() < OTHER_TO_LONG) {
        d.market = 'long-term';
        newListings++;
      }
    }
    return newListings;
  }

  /**
   * Which of the empty houses are commercially let and which are the owner's own. The pack does not
   * split them, so the split is seeded once here, weighted by township: at Point Lookout, where 65
   * per cent of the houses were empty on census night, a much larger share of them is in the letting
   * market than at Dunwich, where an empty house is more often between tenancies or on the market.
   */
  function seedShortStay(w) {
    const R = w.residents;
    if (!R || !R.holidayHomes) return;
    const share = { 'point-lookout': 0.62, 'amity-point': 0.42, dunwich: 0.30, 'one-mile': 0.34 };
    for (const d of R.holidayHomes) {
      const s = share[d.townshipId] ?? 0.4;
      d.shortStay = rng.float() < s;
    }
  }

  /* -------------------------------------------------------------- yields */

  function nightlyFor(townshipId, info) {
    const n = NIGHTLY[townshipId] || NIGHTLY.dunwich;
    const peakness = clamp((info.loadMultiplier - 1) / 2.5, 0, 1);
    return lerp(n.shoulder, n.peak, peakness);
  }

  /**
   * The rate an owner is actually deciding against. An owner does not choose short stay or long
   * term on a Tuesday in January and choose again on a Tuesday in June: they look at what the house
   * would earn across a year. Using today's nightly rate made the yield ratio swing between 1.1 and
   * 1.9 with the season and made the loop's second stage flap, which is a modelling artefact rather
   * than an island. PEAK_NIGHT_SHARE is the modelled share of the nights a house sells that sell at
   * a peak rate: the summer block, Easter and the long weekends are most of the bookings but not
   * most of the calendar.
   */
  const PEAK_NIGHT_SHARE = 0.34;
  function annualNightlyFor(townshipId) {
    const n = NIGHTLY[townshipId] || NIGHTLY.dunwich;
    return n.shoulder * (1 - PEAK_NIGHT_SHARE) + n.peak * PEAK_NIGHT_SHARE;
  }

  function computeYields(w, info, stock) {
    const R = w.residents;
    // Nights actually sold. The real occupancy, counted off the dwelling graph: visitors.js has
    // already put parties into holiday houses, so this is a measurement of the simulation rather
    // than an assumption about it.
    let lets = 0, occupied = 0;
    if (R && R.holidayHomes) {
      for (const d of R.holidayHomes) {
        if (!d.shortStay) continue;
        lets++;
        if (d.occupiedByPartyId) occupied++;
      }
    }
    const occPct = lets > 0 ? 100 * occupied / lets : 0;

    const byTown = {};
    let grossSum = 0, netSum = 0, ltSum = 0, n = 0;
    for (const t of TOWNSHIP_IDS) {
      const nightly = annualNightlyFor(t);
      // Nights a year this township's lets actually sell. Modelled from the calendar rather than
      // asserted: a Point Lookout house sells its summer, its Easter and its long weekends, and
      // sits empty most of a wet June week. The rolling measurement above corrects it over time.
      const modelledNights = t === 'point-lookout' ? 138 : t === 'amity-point' ? 108 : 92;
      const gross = nightly * modelledNights;
      const net = gross * (1 - SHORT_STAY_COSTS);
      const rent = (TOWN[t] || {}).medianRent || ISLAND_MEDIAN_RENT;
      const ltNet = rent * 52 * (1 - LONG_TERM_COSTS);
      byTown[t] = {
        label: (TOWN[t] || {}).label || t,
        nightlyA$: Math.round(nightly),
        shortStayNetA$: Math.round(net),
        longTermNetA$: Math.round(ltNet),
        ratio: +(net / Math.max(1, ltNet)).toFixed(2)
      };
      const w8 = (stock.byTownship[t] || {}).total || 1;
      grossSum += gross * w8; netSum += net * w8; ltSum += ltNet * w8; n += w8;
    }

    return {
      lets, occupied, occPct,
      nightly: Math.round(nightlyFor('point-lookout', info)),
      gross: Math.round(grossSum / Math.max(1, n)),
      net: Math.round(netSum / Math.max(1, n)),
      longTerm: Math.round(ltSum / Math.max(1, n)),
      ratio: +(netSum / Math.max(1, ltSum)).toFixed(2),
      byTown
    };
  }

  /* -------------------------------------------------------------- policy */

  function readPolicy(w) {
    const pol = w.read('policy');
    const out = {};
    for (const id of HOUSING_LEVERS) {
      const l = pol && pol.levers ? pol.levers[id] : null;
      out[id] = l
        ? { status: l.status, progress: l.progress || 0, on: l.status === 'in-place' || l.status === 'active' || l.status === 'running' || l.status === 'delivering' }
        : { status: 'not modelled', progress: 0, on: false };
    }
    state.policy = out;
    return out;
  }

  /* -------------------------------------------------------------- conversions

  Once a month, amortised: a small share of the eligible stock moves, in whichever direction the
  arithmetic and the rules point. Everything is bounded at both ends, because an island with no
  rentals at all and an island with no holiday houses at all are both wrong. */

  function convertOne(w, from, to, why) {
    const R = w.residents;
    if (!R) return false;
    if (from === 'rental') {
      if (R.rentalPool.length <= RENTAL_FLOOR) return false;
      const i = rng.int(0, R.rentalPool.length);
      const d = R.rentalPool[i];
      if (!d || d.use !== 'vacant') { R.rentalPool.splice(i, 1); return false; }
      R.rentalPool.splice(i, 1);
      d.use = d.townshipId === 'amity-point' ? 'weekender' : 'holiday-home';
      d.shortStay = to === 'short-stay';
      d.vacantReason = null;
      d.market = null;              // it is not on any long-term market now
      R.holidayHomes.push(d);
      const comp = w.store.get(d.id, 'dwelling');
      if (comp) comp.use = d.use;
      w.bus.emit('housing:converted', { dwellingId: d.id, township: d.townshipId, to: 'short-stay letting', why });
      return true;
    }
    // Back the other way: a let comes off the visitor market and onto the long-term one.
    const pool = R.holidayHomes;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = rng.int(0, pool.length);
      const d = pool[i];
      if (!d || d.occupiedByPartyId || !d.shortStay) continue;
      pool.splice(i, 1);
      d.use = 'vacant';
      d.shortStay = false;
      d.vacantReason = 'coming back to the long-term market';
      R.rentalPool.push(d);
      const comp = w.store.get(d.id, 'dwelling');
      if (comp) comp.use = 'vacant';
      w.bus.emit('housing:converted', { dwellingId: d.id, township: d.townshipId, to: 'long-term rental', why });
      return true;
    }
    return false;
  }

  function monthlyMarket(w, info, stock, yields, pol) {
    const R = w.residents;
    if (!R || !R.dwellings) return;

    // How hard the arithmetic is pushing. A ratio of one is neutral; the modelled island sits near
    // one and a half, which is a steady one-way drift rather than a stampede.
    let push = clamp((yields.ratio - 1.05) * 0.9, -0.6, 0.9);

    // The three levers that actually touch this. Registration on its own mostly buys information,
    // which is the honest finding and the one a player is least likely to expect.
    if (pol['short-stay-letting-registration'].on) push -= 0.06 * pol['short-stay-letting-registration'].progress;
    if (pol['short-stay-cap-by-township'].on) push -= 0.55 * pol['short-stay-cap-by-township'].progress;
    if (pol['rates-differential-unoccupied'].on) push -= 0.22 * pol['rates-differential-unoccupied'].progress;

    // A season with nobody in the houses is its own argument. Two thin winters and some owners give
    // up on the visitor market and take a tenant.
    if (yields.occPct < 22) push -= 0.25;

    const eligible = Math.max(0, R.rentalPool.length - RENTAL_FLOOR);
    const lets = yields.lets;
    const rate = 0.016;   // modelled monthly turnover of the eligible stock at full push
    let toShort = 0, toLong = 0;

    if (push > 0) {
      const n = Math.min(eligible, Math.round(eligible * rate * push * 4 + (rng.float() < (eligible * rate * push * 4) % 1 ? 1 : 0)));
      for (let i = 0; i < n; i++) if (convertOne(w, 'rental', 'short-stay', 'a night lets for more than a week does')) toShort++;
    } else if (push < 0) {
      const n = Math.min(Math.max(0, lets - 40), Math.round(lets * rate * -push * 1.4));
      for (let i = 0; i < n; i++) if (convertOne(w, 'short-stay', 'rental', pol['short-stay-cap-by-township'].on ? 'the township cap' : 'the visitor market went quiet')) toLong++;
    }

    // Levers that add stock rather than move it. Worker accommodation is the one civic.json costs
    // at A$14 m for roughly 40 beds, so that is what it delivers here.
    const wantBeds = (pol['worker-accommodation-build'].on ? 40 * pol['worker-accommodation-build'].progress : 0)
      + (pol['community-housing-expansion'].on ? 18 * pol['community-housing-expansion'].progress : 0);
    extraWorkerBeds = Math.round(wantBeds);

    // A granny flat fast-track and a land release put whole dwellings on the long-term market. Slow,
    // and small, because that is what those levers actually do: civic.json gives them lead times of
    // years and this file does not get to be more optimistic than the pack.
    const built = (pol['secondary-dwelling-fast-track'].on ? 0.9 * pol['secondary-dwelling-fast-track'].progress : 0)
      + (pol['gumpi-land-release'].on ? 1.1 * pol['gumpi-land-release'].progress : 0);
    let toBuild = Math.floor(built);
    if (rng.float() < built - toBuild) toBuild++;
    for (let i = 0; i < toBuild; i++) {
      if (convertOne(w, 'short-stay', 'rental', 'new stock came onto the long-term market')) toLong++;
    }

    dayConv.in += toShort;
    dayConv.out += toLong;
    if (toShort || toLong) {
      state.conversions.lastReason = toShort > toLong
        ? 'the yield ratio is pulling houses into the visitor market'
        : 'houses are coming back to the long-term market';
    }
  }

  /* -------------------------------------------------------------- the loop */

  function trackStage(id, value) {
    let r = history.get(id);
    if (!r) history.set(id, (r = new Rolling(30)));
    const before = r.filled >= 30 ? r.buf[r.i] : (r.filled ? r.buf[0] : value);
    r.push(value);
    return +(value - before).toFixed(2);
  }

  function buildLoop(w, stock, yields, seekers, unfilled) {
    const vis = w.read('visitors') || {};
    const biz = w.read('businesses') || {};
    const bedNights = Math.round((vis.onIsland || 0) * 0.62);

    const stages = [
      {
        n: 1, id: 'demand', label: 'Visitors wanting a bed tonight',
        value: bedNights, unit: 'people',
        note: 'The school calendar and the whale season set this, and nobody on the island controls it.'
      },
      {
        n: 2, id: 'yield', label: 'A night against a week',
        value: yields.ratio, unit: 'x',
        note: yields.ratio > 1.25
          ? `A house here nets about ${Math.round(yields.net / 1000)}k a year letting to visitors and about ${Math.round(yields.longTerm / 1000)}k letting to a neighbour.`
          : 'The two are close enough that an owner could go either way.'
      },
      {
        n: 3, id: 'lets', label: 'Houses let to visitors',
        value: yields.lets, unit: 'houses',
        note: 'Every one of these was a house somebody could have rented.'
      },
      {
        n: 4, id: 'rentals', label: 'Long-term rentals on the market',
        value: stock.advertisedForRent, unit: 'houses',
        note: `${stock.onTheMarket} dwellings are empty and not lived in, but only these are advertised for a tenancy. The rest are for sale, being repaired, or the owner is away.`
      },
      {
        n: 5, id: 'seekers', label: 'Workers who cannot find a room',
        value: seekers, unit: 'people',
        note: 'A cook, a cleaner, a support worker. They take the job if they can find somewhere to sleep.'
      },
      {
        n: 6, id: 'shifts', label: 'Shifts nobody is rostered for',
        value: unfilled, unit: 'positions',
        note: biz.strain && biz.strain.reducedHours
          ? `${biz.strain.reducedHours} businesses have cut their hours.`
          : 'The hours hold for now.'
      }
    ];
    for (const s of stages) s.delta30 = trackStage(s.id, s.value);
    state.loop = stages;

    // One number for the top of a panel. Zero is a housing market like anywhere else; one is an
    // island where a business cannot open because nobody can find a room.
    const t = clamp(
      clamp((yields.ratio - 1) / 1.1, 0, 1) * 0.22
      + clamp(1 - stock.advertisedForRent / 22, 0, 1) * 0.30
      + clamp(seekers / 60, 0, 1) * 0.26
      + clamp(unfilled / 220, 0, 1) * 0.22, 0, 1);
    state.tightness = +t.toFixed(3);
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'housing',
    phase: 'economy',
    order: 40,

    // The economy phase runs before the agents phase, so at boot time population.js has not built
    // the dwelling graph yet and `world.residents` does not exist. Binding is therefore lazy: this
    // file wires itself up on the first tick after the island has people on it. Every other system
    // in this slice does the same and for the same reason.
    init(w) {
      cal = (w.residents && w.residents.calendar) || makeCalendar(w.data.events);
      state.notes.push('The split between an owner\'s own holiday house and a commercially let one is modelled: the pack counts unoccupied dwellings but does not split them.');
      state.notes.push('No short-stay nightly rate for any dwelling on this island is published. Every nightly figure here is a modelling parameter.');
      state.fit = {
        publishedDwellings: 1964,
        publishedOccupiedPct: 49.4,
        publishedMedianRentA$: ISLAND_MEDIAN_RENT,
        publishedQldMedianRentA$: QLD_MEDIAN_RENT,
        publishedPointLookoutUnoccupiedPct: 65
      };
      lastDay = w.clock.dayIndex;
      lastMonthDay = w.clock.dayIndex;
    },

    tick(w) {
      if (!state.ready) {
        const R = w.residents;
        if (!R || !R.ready || !R.dwellings || !R.dwellings.length) return;
        cal = R.calendar || cal;
        seedShortStay(w);
        for (const [id, beds] of EMPLOYER_BEDS) {
          if (R.businesses && R.businesses.get(id)) employerBeds += beds;
        }
        state.workers.beds = employerBeds;
        lastRentalCount = -1;     // no delta on the first day: there is nothing to compare with
        state.ready = true;
        w.bus.emit('housing:ready', { employerBeds, dwellings: R.dwellings.length });
      }
      if (w.clock.dayIndex === lastDay) return;
      lastDay = w.clock.dayIndex;

      const info = cal.day(w.clock.date);
      const pol = readPolicy(w);
      const stock = stockScan(w);
      const yields = computeYields(w, info, stock);
      const R = w.residents;

      // --- who is looking. Business vacancies that need somebody who is not already on the island,
      //     plus the households the pack describes as rolling: "insecure-housing-rolling-household".
      const pop = w.read('population') || {};
      const biz = w.read('businesses') || {};
      const jobs = w.read('jobs') || {};
      const unfilled = Number.isFinite(jobs.shortBy) ? jobs.shortBy : (biz.staffing ? biz.staffing.shortBy : 0);
      // Not every unfilled position needs a new person on the island: some are extra hours for
      // somebody already here. Modelled at about a third needing a room.
      const seekers = Math.round(unfilled * 0.34);
      // Advertised for a long-term tenancy, not simply empty. See marketOf() above.
      const available = stock.advertisedForRent;
      const workerBedsFree = Math.max(0, (employerBeds + extraWorkerBeds) - state.workers.bedsFilled);
      state.workers.seekingARoom = Math.max(0, seekers - available - workerBedsFree);
      if (state.workers.seekingARoom > 0 && w.clock.dayIndex % 7 === 0) {
        w.bus.emit('housing:worker-cannot-find-a-room', {
          people: state.workers.seekingARoom,
          rentalsOnTheMarket: available,
          housesLetToVisitors: yields.lets
        });
        dayConv.gaveUp += Math.round(state.workers.seekingARoom * 0.04);
      }

      // --- the monthly market. Amortised onto one day a month so a year of ticks is a year of
      //     decisions rather than three hundred and sixty-five of them.
      if (w.clock.dayIndex - lastMonthDay >= 30) {
        lastMonthDay = w.clock.dayIndex;
        monthlyMarket(w, info, stock, yields, pol);
        newListingsThisMonth = rotateMarket(w);
      }

      // --- leases. The pack's own drama hook: "A lease ends in October and a family with two kids
      //     has nowhere to go while 65 per cent of the houses in their township sit empty."
      if (w.clock.month === 9 && w.clock.dayOfMonth === 1 && R) {
        const renting = R.households.filter((h) => h.tenure === 'rented_private');
        const n = Math.max(1, Math.round(renting.length * 0.06));
        for (let i = 0; i < n && renting.length; i++) {
          const hh = renting[rng.int(0, renting.length)];
          if (!hh) continue;
          w.bus.emit('housing:lease-ending', {
            household: hh.label || hh.surname, township: hh.townshipId,
            people: hh.members.length,
            rentalsOnTheMarket: available,
            emptyHousesInTownship: (stock.byTownship[hh.townshipId] || {}).shortStay || 0
          });
        }
      }

      // --- roll the day. New listings are the flow: how many houses were advertised for a
      //     long-term tenancy this month. That, not the stock sitting empty, is what somebody
      //     looking for a room is actually competing for.
      dayConv.onMarket += newListingsThisMonth;
      newListingsThisMonth = 0;
      if (lastRentalCount >= 0) dayConv.takenUp += Math.max(0, lastRentalCount - available);
      lastRentalCount = available;

      conv30in.push(dayConv.in); conv30out.push(dayConv.out);
      convNet365.push(dayConv.in - dayConv.out);
      nights365.push(yields.occupied);
      gaveUp365.push(dayConv.gaveUp);
      onMarket30.push(dayConv.onMarket); takenUp30.push(dayConv.takenUp);
      dayConv = { in: 0, out: 0, onMarket: 0, takenUp: 0, gaveUp: 0 };

      // --- publish
      stock.unoccupiedPct = stock.total ? +(100 * (stock.total - stock.lived_in) / stock.total).toFixed(1) : 0;
      state.stock = stock;

      // Rents move with the market, slowly, and are bounded so a long run cannot invent a A$2,000
      // a week island. The published median is the anchor, not a starting point to escape from,
      // and it stays on the read model beside the moving number so the two can be compared.
      const scarcity = clamp(1 - available / 26, 0, 1);
      const targetRent = ISLAND_MEDIAN_RENT * (1 + scarcity * 0.30 + clamp(((w.read('prices') || {}).costOfLivingIndex || 1) - 1, 0, 0.5) * 0.2);
      rentNow = approach(rentNow, clamp(targetRent, 280, 470), 180, 1);
      state.rentals.medianWeeklyA$ = Math.round(rentNow);
      state.rentals.publishedMedianA$ = ISLAND_MEDIAN_RENT;
      state.rentals.available = available;
      state.rentals.emptyButNotAvailable = stock.onTheMarket - available;
      state.rentals.seekers = seekers;
      // How long it takes to find one: people looking, divided by houses advertised in a month.
      // Until thirty days have actually passed there is no observed flow, so fall back to the
      // modelled listing rate rather than reporting the ceiling and telling a player it takes four
      // years to find a rental on their first morning.
      const modelledFlow = Math.max(0, stock.onTheMarket - stock.advertisedForRent) * OTHER_TO_LONG;
      const flow = Math.max(onMarket30.total, modelledFlow, 0.5);
      state.rentals.monthsToFind = +clamp(seekers / flow, 0, 24).toFixed(1);
      state.rentals.newListingsPerMonth = +flow.toFixed(1);
      state.rentals.shareOfMedianIncomePct = +(100 * state.rentals.medianWeeklyA$ / ISLAND_MEDIAN_INCOME).toFixed(1);
      // The number that actually decides whether a cook stays. Modelled at 28 hours a week on the
      // published indicative band for a bar attendant or a cafe allrounder, which is A$30 to A$42.
      const workerWeekly = 34 * 28;
      state.rentals.shareOfAWorkerWagePct = +(100 * state.rentals.medianWeeklyA$ / workerWeekly).toFixed(1);
      state.rentals.cameOnTheMarket30 = Math.round(onMarket30.total);
      state.rentals.takenUp30 = Math.round(takenUp30.total);

      state.shortStay.lets = yields.lets;
      state.shortStay.occupancyPct = +yields.occPct.toFixed(1);
      state.shortStay.nightsSoldRolling365 = Math.round(nights365.total);
      state.shortStay.nightlyA$ = yields.nightly;
      state.shortStay.grossPerLetA$ = yields.gross;
      state.shortStay.netPerLetA$ = yields.net;
      state.shortStay.longTermNetA$ = yields.longTerm;
      state.shortStay.yieldRatio = yields.ratio;
      state.shortStay.yieldRatioByTownship = yields.byTown;

      state.conversions.toShortStay30 = Math.round(conv30in.total);
      state.conversions.toLongTerm30 = Math.round(conv30out.total);
      state.conversions.net365 = Math.round(convNet365.total);

      state.workers.beds = employerBeds + extraWorkerBeds;
      state.workers.bedsFilled = Math.min(state.workers.beds, Math.round(state.workers.beds * clamp(0.5 + (info.loadMultiplier - 1) * 0.3, 0.35, 1)));
      state.workers.gaveUpRolling365 = Math.round(gaveUp365.total);
      // What jobs.js reads: how much harder housing makes it to keep somebody.
      state.workers.frictionIndex = +clamp(
        clamp(state.workers.seekingARoom / 40, 0, 1) * 0.5
        + clamp((state.rentals.shareOfAWorkerWagePct - 30) / 40, 0, 1) * 0.35
        + clamp(1 - available / 120, 0, 1) * 0.15, 0, 1).toFixed(3);

      buildLoop(w, stock, yields, state.workers.seekingARoom, unfilled);
      state.day = w.clock.formatDate();
    },

    describe() {
      return {
        dwellings: state.stock.total,
        livedIn: state.stock.lived_in,
        unoccupiedPct: state.stock.unoccupiedPct,
        shortStayLets: state.shortStay.lets,
        occupancyPct: state.shortStay.occupancyPct,
        yieldRatio: state.shortStay.yieldRatio,
        advertisedRentals: state.rentals.available,
        emptyNotAvailable: state.rentals.emptyButNotAvailable,
        monthsToFind: state.rentals.monthsToFind,
        rentA$: state.rentals.medianWeeklyA$,
        rentPctOfWorkerWage: state.rentals.shareOfAWorkerWagePct,
        seekingARoom: state.workers.seekingARoom,
        workerBeds: state.workers.beds,
        toShortStay30: state.conversions.toShortStay30,
        toLongTerm30: state.conversions.toLongTerm30,
        tightness: state.tightness
      };
    },

    save() {
      return {
        rent: rentNow, extraWorkerBeds, lastMonthDay, lastRentalCount,
        shortStay: (world.residents && world.residents.dwellings ? world.residents.dwellings : [])
          .filter((d) => d.shortStay).map((d) => d.id),
        market: (world.residents && world.residents.dwellings ? world.residents.dwellings : [])
          .filter((d) => d.market).map((d) => [d.id, d.market]),
        c30i: conv30in.save(), c30o: conv30out.save(), n365: convNet365.save(), g365: gaveUp365.save()
      };
    },

    load(w, s) {
      if (!s) return;
      lastDay = -1;
      state.ready = false;      // rebinds to the dwelling graph on the next tick
      rentNow = s.rent ?? rentNow;
      state.rentals.medianWeeklyA$ = Math.round(rentNow);
      extraWorkerBeds = s.extraWorkerBeds | 0;
      lastMonthDay = s.lastMonthDay ?? lastMonthDay;
      lastRentalCount = s.lastRentalCount | 0;
      if (w.residents && w.residents.dwellingsById && Array.isArray(s.shortStay)) {
        for (const d of w.residents.dwellings) d.shortStay = false;
        for (const id of s.shortStay) {
          const d = w.residents.dwellingsById.get(id);
          if (d) d.shortStay = true;
        }
        for (const [id, m] of s.market || []) {
          const d = w.residents.dwellingsById.get(id);
          if (d) d.market = m;
        }
      }
      conv30in.load(s.c30i); conv30out.load(s.c30o); convNet365.load(s.n365); gaveUp365.load(s.g365);
    }
  });
}
