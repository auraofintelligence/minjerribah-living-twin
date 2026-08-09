// The people. Roughly 2,156 permanent residents in about 970 occupied households, plus the 988
// dwellings that had nobody in them on census night, which is the single biggest fact about this
// island and the thing every other slice ends up arguing with.
//
// WHAT THIS FILE OWNS
//   * dwellings: where they are on the real heightfield, who owns them, who lives in them
//   * households: who lives with whom, which is where the stories come from
//   * people: age, name, work, traits, and the slot every other agent system indexes them by
//   * demography over time: ageing, births, deaths, people leaving, people arriving
//
// WHAT IT DOES NOT OWN
//   needs.js decides what a person wants. schedule.js decides what the day asks of them.
//   social.js decides who they know. visitors.js runs the swing population. None of them import
//   this file; they read `world.residents` and `world.read('population')`.
//
// TWO READ MODELS, ON PURPOSE
//   `world.residents`  the live object graph, with real references between a person, their
//                      household and their dwelling. It has cycles, so it must never go into
//                      world.state, which the probe serialises. The island does the same thing
//                      with world.island, and for the same reason.
//   `world.state.population`  a flat, cycle-free read model for the UI, the critic tooling and
//                      any other system. Counts, distributions, a searchable roster, and card(id)
//                      for one legible person.
//
// EVERY NUMBER'S PROVENANCE
//   Published (ABS 2021 Census, data/residents.json census_baseline, confidence high):
//     island population 2,156; median age 52; 1,964 private dwellings, 49.4 per cent occupied;
//     tenure 45.4 owned outright / 22.1 mortgage / 26.4 rented; household composition
//     63.4 family / 32.9 lone person / 3.7 group; the eighteen five-year age bands; and the same
//     tables again for each of the three gazetted localities.
//   Modelled (data/residents.json household_archetypes, confidence medium, and this file):
//     which archetype a household is, exactly where its dwelling sits, names, traits, who works
//     where, and every rate in the demography block below. None of it is measured and none of it
//     is presented to a player as measured.
//
// CULTURAL NOTE, READ BEFORE EDITING THE ARCHETYPE HANDLING.
//   data/lore.json prohibitions carries a blocking rule, no-aboriginal-characters-with-invented-
//   culture: no simulated resident may be assigned Aboriginality, a clan, a family group, cultural
//   knowledge, cultural obligations or a cultural role. Two of the thirty archetypes in
//   data/residents.json are named as Quandamooka households. They are sampled, because leaving them
//   out would falsify Dunwich, where 30.5 per cent of residents are Aboriginal and Torres Strait
//   Islander at the published census. What this file does NOT do is put that on an agent: no person
//   and no household carries an Aboriginality field, and the archetype id never reaches the
//   published read model or any player-facing label. Households are labelled by surname and
//   composition. The occupations at QYAC and Yulu-Burri-Ba are public job types at real
//   organisations and nothing more. See docs/CULTURAL-REVIEW.md item R1.

import { makeCalendar } from './calendar.js';

/* ------------------------------------------------------------------ the three townships and One Mile

Township ids are the spine of this whole slice. data/residents.json, data/businesses.json,
data/places.json and the island's own region grid each spell the names slightly differently
(Mulumba against Mooloomba, and so on), so everything below keys on the id and resolves names once. */

// `population` is the count living in occupied private dwellings: the township's published
// occupied-dwelling count times its published average household size. It is deliberately not the
// township's published resident count, because the two do not reconcile. Dunwich publishes 737
// residents, 299 occupied dwellings and 2.3 people per household, and 299 times 2.3 is 688, not 737.
// The gap is people who were not in an occupied private dwelling on census night, which on this
// island includes the aged care residents at One Mile. Those people are real and they are counted
// in the 2,156, but this file will not invent a bed for them, so the residual is carried in the fit
// report under peopleNotInPrivateDwellings rather than being pushed into somebody's spare room.
const TOWNSHIPS = [
  {
    id: 'dunwich', name: 'Dunwich', placeId: 'dunwich', radius: 1500,
    occupied: 299, unoccupied: 105, avgHousehold: 2.3, censusPopulation: 737, medianAge: 47,
    lonePersonPct: 32.3, familyPct: 64.5, groupPct: 3.2,
    tenure: { owned_outright: 39.4, mortgage: 24.5, rented: 30.7 },
    medianIncome: 1111, medianRent: 294
  },
  {
    id: 'point-lookout', name: 'Point Lookout', placeId: 'point-lookout', radius: 1500,
    occupied: 354, unoccupied: 658, avgHousehold: 2.1, censusPopulation: 785, medianAge: 55,
    lonePersonPct: 30.7, familyPct: 64.7, groupPct: 4.6,
    tenure: { owned_outright: 47, mortgage: 24, rented: 24 },
    medianIncome: 1368, medianRent: 350
  },
  {
    id: 'amity-point', name: 'Amity Point', placeId: 'amity-point', radius: 1100,
    occupied: 220, unoccupied: 184, avgHousehold: 2.0, censusPopulation: 453, medianAge: 58,
    lonePersonPct: 32.1, familyPct: 62.2, groupPct: 5.7,
    tenure: { owned_outright: 51.3, mortgage: 21.5, rented: 23.6 },
    medianIncome: 931, medianRent: 350
  },
  {
    // The residual the pack carries openly: One Mile and the scattered rural addresses that sit
    // outside the three gazetted localities. 970 minus 873 is 97 households.
    id: 'one-mile', name: 'One Mile and the rural balance', placeId: 'one-mile-jetty', radius: 900,
    occupied: 97, unoccupied: 41, avgHousehold: 2.0, censusPopulation: 181, medianAge: 52,
    lonePersonPct: 34, familyPct: 61, groupPct: 5,
    tenure: { owned_outright: 45, mortgage: 22, rented: 27 },
    medianIncome: 1050, medianRent: 320
  }
];

for (const t of TOWNSHIPS) t.population = Math.round(t.occupied * t.avgHousehold);

/** Which townships an archetype's `township` string maps onto. */
function townshipIdFor(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('dunwich') || s.includes('goompi')) return 'dunwich';
  if (s.includes('point lookout') || s.includes('mulumba') || s.includes('mooloomba')) return 'point-lookout';
  if (s.includes('amity')) return 'amity-point';
  if (s.includes('one mile')) return 'one-mile';
  if (s.includes('island-wide') || s.includes('island wide')) return 'one-mile';
  return 'dunwich';
}

/* ------------------------------------------------------------------ age bands

The eighteen published five-year bands. The 60 to 74 group alone is 29.5 per cent of this island and
the 20 to 34 group is 11.4 per cent. The pack's own note is blunt about it: an agent population that
looks like a normal Australian town is wrong for this place. So ages are fitted to these quotas
rather than drawn from a curve. */

const BAND_LO = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
const BAND_HI = [4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 69, 74, 79, 84, 99];
const bandOf = (age) => (age >= 85 ? 17 : Math.min(17, Math.floor(age / 5)));

/**
 * "60s", "late 20s", "early 30s", "teens", "9", "70". Returns [lo, hi] inclusive.
 *
 * A bare number in an archetype is read as a band, not as a literal age. Taken literally, the
 * Point Lookout lone-owner archetype's "78" would put 109 people on this island all aged exactly
 * 78, which is an artefact of how the pack was written rather than anything it means. An adult
 * number gets seven years either side; a child's number gets one, because a child's age decides
 * which school they are at and that has to stay right.
 */
function parseAgeBand(token) {
  const s = String(token).trim().toLowerCase();
  const exact = Number(s);
  if (Number.isFinite(exact)) {
    return exact >= 18 ? [exact - 7, exact + 7] : [Math.max(0, exact - 1), exact + 1];
  }
  if (s === 'teens') return [13, 18];
  const decade = s.match(/(\d0)s/);
  if (decade) {
    const d = Number(decade[1]);
    if (s.startsWith('late')) return [d + 7, d + 9];
    if (s.startsWith('early')) return [d, d + 3];
    if (s.startsWith('mid')) return [d + 4, d + 6];
    return [d, d + 9];
  }
  return [35, 55];
}

/* ------------------------------------------------------------------ demography rates

All modelled, all annual, all applied per sim-day at rate/365. The targets they are tuned to:
about 13 births and about 19 deaths a year on this age structure, which is a natural decrease, made
up by in-migration into dwellings that fall vacant. That is the real shape of an ageing island and
the reason the population is close to flat rather than growing. */

const DEATH_HAZARD = [
  // annual probability by decade of age, 0s through 90s. Rough Australian life-table shape.
  0.0008, 0.0003, 0.0007, 0.0011, 0.0017, 0.0040, 0.0093, 0.0215, 0.0620, 0.1600
];
const BIRTHS_PER_1000_WOMEN_20_44 = 60;
const OUT_MIGRATION_BY_TENURE = {
  owned_outright: 0.015,
  mortgage: 0.040,
  rented_private: 0.120,
  rented_community: 0.045,
  rented_employer: 0.380,
  not_a_residence: 0
};
/** A house sold out of resident ownership sometimes never comes back. Slow on purpose. */
const SALE_TO_HOLIDAY_HOME_SHARE = 0.14;
const HOLIDAY_HOME_TO_RENTAL_SHARE = 0.06;

/* ------------------------------------------------------------------ small helpers */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The neutral household descriptors. Never an archetype id, never a cultural label. */
function householdShape(adults, children, ages) {
  if (adults === 1 && children === 0) return ages[0] >= 70 ? 'on their own, later years' : 'on their own';
  if (adults >= 3 && children === 0) return 'a share house';
  if (adults >= 3 && children > 0) return 'three generations';
  if (adults === 2 && children === 0) return 'a couple';
  if (adults === 2 && children === 1) return 'a couple and one child';
  if (adults === 2) return `a couple and ${children} kids`;
  if (adults === 1 && children > 0) return children === 1 ? 'one parent, one child' : `one parent, ${children} kids`;
  return 'a household';
}

export function registerPopulation(world) {
  // A per-world copy of the township table. TOWNSHIPS is module scope and this function writes
  // working state onto it (site cursors, surname order, age quotas), so sharing it across two
  // World instances in one process makes the second island a different island. The headless
  // determinism check builds exactly two worlds in one process, and it caught this.
  const TOWNS = TOWNSHIPS.map((t) => ({ ...t }));
  const rng = world.rng.stream('population');
  const dRng = world.rng.stream('demography');

  const state = world.publish('population', {
    ready: false,
    source: 'data/residents.json census_baseline (ABS 2021 Census) plus modelled household archetypes',
    residents: 0,
    households: 0,
    dwellings: { total: 0, occupied: 0, unoccupied: 0, holidayHomes: 0, weekenders: 0, vacant: 0 },
    byTownship: {},
    medianAge: 0,
    ageBands: [],
    composition: { family: 0, lonePerson: 0, group: 0 },
    tenure: {},
    labour: { inLabourForce: 0, employed: 0, unemployed: 0, notInLabourForce: 0, byOccupation: {} },
    vacancies: [],
    schoolEnrolments: 0,
    studentsCrossing: 0,
    births: { today: 0, rolling365: 0 },
    deaths: { today: 0, rolling365: 0 },
    leavers: { today: 0, rolling365: 0 },
    returners: { today: 0, rolling365: 0 },
    roster: [],
    today: null,
    fit: {},
    notes: [],
    card: () => null
  });

  /* -------------------------------------------------------------- live graph */

  const R = {
    ready: false,
    people: [],
    peopleById: new Map(),
    households: [],
    householdsById: new Map(),
    dwellings: [],
    dwellingsById: new Map(),
    holidayHomes: [],     // unoccupied dwellings a visitor party can occupy
    rentalPool: [],       // dwellings available to a would-be resident household
    byTownship: {},
    places: new Map(),    // id -> {id, label, x, z, kind, township}
    placesByKind: new Map(),
    businesses: new Map(),
    occupations: new Map(),
    archetypes: new Map(),
    interestGroups: [],
    slotOf: [],           // slot -> person, so needs.js can index a flat array
    freeSlots: [],
    slotCapacity: 0,
    calendar: null,
    today: null,
    nameSeq: 0
  };
  world.residents = R;

  /* -------------------------------------------------------------- ring history */

  function remember(p, text, tick, weight = 1) {
    if (!p.history) p.history = [];
    p.history.push({ tick, day: R.today ? R.today.iso : null, text, weight });
    if (p.history.length > 14) p.history.shift();
  }

  /* -------------------------------------------------------------- places and businesses */

  function buildPlaces(w) {
    const isl = w.island;
    const places = w.data.places && w.data.places.places ? w.data.places.places : [];
    const biz = w.data.businesses && w.data.businesses.businesses ? w.data.businesses.businesses : [];

    const add = (id, label, lon, lat, kind, township) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const xz = isl.project(lon, lat);
      const rec = { id, label, x: xz.x, z: xz.z, kind, township, lon, lat };
      R.places.set(id, rec);
      let list = R.placesByKind.get(kind);
      if (!list) R.placesByKind.set(kind, (list = []));
      list.push(rec);
      return rec;
    };

    for (const p of places) add(p.id, p.name, p.lon, p.lat, p.type, townshipIdFor(p.township));

    // Businesses. Several real entries have no coordinate in the pack, so they fall back to their
    // township centre. That is honest: the business exists, the point does not, and pretending to a
    // street address we cannot source would be worse than a pin on the town.
    let coordless = 0;
    for (const b of biz) {
      if (b.status === 'closed' || b.status === 'proposed') continue;
      const tid = townshipIdFor(b.township);
      let lon = b.lon, lat = b.lat, precise = true;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        const seat = places.find((p) => p.id === b.id);
        if (seat && Number.isFinite(seat.lon)) { lon = seat.lon; lat = seat.lat; }
        else {
          const t = TOWNS.find((t2) => t2.id === tid) || TOWNS[0];
          const tp = places.find((p) => p.id === t.placeId);
          if (!tp) continue;
          lon = tp.lon; lat = tp.lat; precise = false; coordless++;
        }
      }
      const rec = add('biz:' + b.id, b.name, lon, lat, 'business', tid);
      if (!rec) continue;
      rec.precise = precise;
      rec.bizType = b.type;
      rec.status = b.status;
      rec.hours = b.typical_hours || null;
      rec.employs = b.employs || { min: 0, max: 0 };
      rec.peakMultiplier = (b.seasonality && b.seasonality.peak_multiplier_estimate) || 1;
      rec.staffed = 0;
      R.businesses.set(b.id, rec);
    }
    if (coordless) {
      state.notes.push(`${coordless} trading businesses have no coordinate in data/businesses.json and sit at their township centre.`);
    }

    // Township seats, and a pseudo-place for anything on the other side of the bay.
    for (const t of TOWNS) {
      const p = R.places.get(t.placeId);
      if (p) { t.x = p.x; t.z = p.z; t.lon = p.lon; t.lat = p.lat; }
    }
    R.places.set('mainland', { id: 'mainland', label: 'the mainland', x: -30000, z: 4000, kind: 'offisland', township: null });
  }

  /* -------------------------------------------------------------- dwelling sites

  A dwelling goes where a dwelling could go: inside the township, on ground the island's own cover
  bake calls urban or cleared, which is to say along a street, and off anything steeper than about
  sixteen degrees. Point Lookout is the tight one: 1,012 dwellings against roughly 1,140 candidate
  cells at 32 m, so cells there can carry two, which is close to the real built density. */

  function buildSites(w) {
    const isl = w.island;
    const cell = isl.grid.cell;
    for (const t of TOWNS) {
      const cands = [];
      if (t.x === undefined) { t.sites = []; continue; }
      const i0 = Math.floor((t.x - t.radius - isl.x0) / cell);
      const i1 = Math.ceil((t.x + t.radius - isl.x0) / cell);
      const j0 = Math.floor((t.z - t.radius - isl.z0) / cell);
      const j1 = Math.ceil((t.z + t.radius - isl.z0) / cell);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = isl.x0 + i * cell, z = isl.z0 + j * cell;
          const dx = x - t.x, dz = z - t.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > t.radius * t.radius) continue;
          const cover = isl.landCover(x, z);
          if (cover !== 'urban' && cover !== 'cleared') continue;
          if (isl.slope(x, z) > 0.28) continue;
          cands.push({ x, z, d2, urban: cover === 'urban' });
        }
      }
      // Closest to the centre first, urban before cleared: houses cluster on the street grid and
      // thin out toward the bush edge, which is what all three of these townships actually do.
      cands.sort((a, b) => (a.urban === b.urban ? a.d2 - b.d2 : (a.urban ? -1 : 1)));
      t.sites = cands;
    }

    // Bush blocks: heath or forest, off the township, within 300 m of a mapped street corridor so a
    // block still has a way in. Sampled coarsely because there is a lot of island to walk.
    const bush = [];
    const step = cell * 4;
    for (let z = isl.z0; z < isl.z1; z += step) {
      for (let x = isl.x0; x < isl.x1; x += step) {
        const cover = isl.landCover(x, z);
        if (cover !== 'heath' && cover !== 'cleared') continue;
        if (isl.slope(x, z) > 0.22) continue;
        let nearTown = false;
        for (const t of TOWNS) {
          if (t.x === undefined) continue;
          const dx = x - t.x, dz = z - t.z;
          if (dx * dx + dz * dz < (t.radius + 300) * (t.radius + 300)) { nearTown = true; break; }
        }
        if (nearTown) continue;
        // Only where the cover bake found a road corridor nearby: cleared ground beside a street.
        let onRoad = false;
        for (let k = 0; k < 8 && !onRoad; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (isl.landCover(x + Math.cos(a) * 96, z + Math.sin(a) * 96) === 'cleared') onRoad = true;
        }
        if (!onRoad) continue;
        bush.push({ x, z, d2: 0, urban: false });
      }
    }
    R.bushSites = bush;
    if (bush.length < 40) state.notes.push('few bush block sites found: rural households fall back to the township edge.');
  }

  /* -------------------------------------------------------------- archetypes */

  function readArchetypes(w) {
    const pack = w.data.residents || {};
    const list = pack.household_archetypes || [];
    for (const a of list) {
      const adults = (a.composition && a.composition.adults) || 0;
      const children = (a.composition && a.composition.children) || 0;
      const ages = (a.composition && a.composition.ages) || [];
      R.archetypes.set(a.id, {
        id: a.id,
        townshipId: townshipIdFor(a.township),
        share: a.share_of_households_estimate || 0,
        unoccupiedShare: a.share_of_unoccupied_dwellings_estimate || 0,
        residence: a.tenure !== 'not_a_residence',
        tenure: a.tenure,
        adults, children,
        size: adults + children,
        ages: ages.map(parseAgeBand),
        bedrooms: (a.dwelling && a.dwelling.bedrooms) || 3,
        condition: (a.dwelling && a.dwelling.condition) || 'sound',
        income: (a.income && a.income.weekly_household_a$) || [900, 1400],
        incomeBand: (a.income && a.income.band) || 'unknown',
        vehicles: (a.vehicles && a.vehicles.count) || 0,
        work: a.work || [],
        cares: a.cares_about || {},
        rhythm: a.rhythm || {},
        pressures: a.pressure_points || [],
        seasonal: a.seasonal_behaviour || '',
        // Composition class, for fitting to the published family / lone person / group split.
        cls: adults === 1 && children === 0 ? 'lonePerson' : (adults >= 3 && children === 0 ? 'group' : 'family'),
        rural: a.id === 'rural-bush-block-household'
      });
    }
    for (const o of pack.occupations || []) R.occupations.set(o.id, o);
    R.interestGroups = (pack.interest_groups || []).map((g) => g.id);
    R.namePools = pack.name_pools || null;
  }

  /* -------------------------------------------------------------- names */

  const NICK_SUFFIX = ['o', 'y', 'za'];

  function eraKey(birthYear) {
    if (birthYear < 1960) return 'born_before_1960';
    if (birthYear <= 1985) return 'born_1960_1985';
    if (birthYear <= 2005) return 'born_1986_2005';
    return 'born_after_2005';
  }

  function givenName(age, sex, year) {
    const pools = R.namePools && R.namePools.given_names;
    if (!pools) return 'Resident';
    const key = eraKey(year - age);
    const era = pools[key] || pools.born_1960_1985;
    // About one name in eight comes from the era-neutral pool, so a street is not two lists.
    if (rng.float() < 0.12 && pools.neutral_any_era) return rng.pick(pools.neutral_any_era);
    const arr = (sex === 'female' ? era.female : era.male) || era.male || pools.neutral_any_era;
    return rng.pick(arr);
  }

  /** Australian usage, applied to a pool name only, so it can never land on a real local.
   *  Returns null when the shortening is the name it started with, which is most short names. */
  function nickname(given) {
    const stem = given.replace(/[aeiouy]+$/i, '');
    const suffixed = stem.slice(0, Math.max(3, Math.min(5, stem.length))) + rng.pick(NICK_SUFFIX);
    if (rng.float() < 0.55) return suffixed !== given ? suffixed : null;
    const m = given.match(/^[A-Z][a-z]{2,4}/);
    const short = m ? m[0] : given;
    return short !== given ? short : (suffixed !== given ? suffixed : null);
  }

  /* -------------------------------------------------------------- household sampling

  Two published constraints per township that the archetype shares do not satisfy on their own:
  the household count and the resident count. The pack's mean archetype size is 2.585 people and
  the island's published figure is 2.22, because the archetype list under-weights lone person
  households against the census 32.9 per cent. So the shares are rescaled by composition class to
  the published split, then each draw is nudged toward whatever mean size the township still needs.
  Both published totals then land exactly, and the archetype mix inside each class is untouched. */

  /**
   * The published island age profile, spread to single years so it can be shifted.
   * Each township publishes its own median age (Dunwich 47, Point Lookout 55, Amity Point 58) and
   * the island publishes 52, so each township's quota is the island shape slid along the age axis
   * until its median lands where the census says it does. Weighted back together by township
   * population the shifts recover 52.6, which is the island figure to within a year, so the three
   * local anchors and the island anchor agree rather than fighting.
   */
  function perYearProfile(dist) {
    const w = new Float64Array(100);
    if (dist.length !== 18) { w.fill(1); return w; }
    for (let i = 0; i < 18; i++) {
      const lo = BAND_LO[i], hi = Math.min(99, BAND_HI[i]);
      const per = (dist[i].pct || 0) / (hi - lo + 1);
      for (let a = lo; a <= hi; a++) w[a] = per;
    }
    return w;
  }

  /** Band quota for one township: the island profile shifted to that township's published median. */
  function townshipQuota(profile, deltaYears, total) {
    const shifted = new Float64Array(100);
    for (let a = 0; a < 100; a++) {
      const src = a - deltaYears;
      const i0 = Math.floor(src), f = src - i0;
      const v0 = i0 >= 0 && i0 < 100 ? profile[i0] : 0;
      const v1 = i0 + 1 >= 0 && i0 + 1 < 100 ? profile[i0 + 1] : 0;
      shifted[a] = v0 * (1 - f) + v1 * f;
    }
    const bands = new Float64Array(18);
    let sum = 0;
    for (let a = 0; a < 100; a++) { bands[bandOf(a)] += shifted[a]; sum += shifted[a]; }
    const out = new Float64Array(18);
    for (let i = 0; i < 18; i++) out[i] = sum > 0 ? (bands[i] / sum) * total : total / 18;
    return out;
  }

  /**
   * How much room the published age quota still has for the people this archetype would add.
   * Once the island has as many nine-year-olds as the census says it has, a household archetype
   * with two primary schoolers in it stops being drawn, which is the mechanism that keeps
   * Minjerribah from filling up with the young families of a mainland suburb. The archetype shares
   * are the pack's own medium-confidence estimates and the age distribution is high-confidence
   * census, so where the two disagree the census wins, and this is where it wins.
   */
  /**
   * Households as drawn, plus the two variations this island actually runs on.
   *
   * A couple's household is not always two people. An adult child who cannot find anything to rent
   * stays in their old room, and a parent who can no longer manage on the mainland moves into the
   * back room. Both are ordinary here and both are the direct consequence of the housing facts in
   * this pack, and without them the archetype list can only make households of two, four and five,
   * which forces far more children onto the island than the census counts. The variants are drawn
   * only when the published age quota has room for the person they would add, so they self-limit.
   */
  function variantsOf(a) {
    const base = { a, extra: null, ages: a.ages, size: a.size, label: null };
    if (a.cls !== 'family' || a.adults < 2 || a.adults > 2 || a.children > 2) return [base];
    return [
      base,
      { a, extra: 'grown-child', ages: a.ages.concat([[19, 34]]), size: a.size + 1, label: 'an adult child still at home' },
      { a, extra: 'parent-moved-in', ages: a.ages.concat([[70, 92]]), size: a.size + 1, label: 'a parent moved in' }
    ];
  }

  function meanRoom(quota, initial) {
    let s = 0, n = 0;
    for (let b = 0; b < 18; b++) {
      if (initial[b] <= 0) continue;
      s += quota[b] / initial[b];
      n++;
    }
    return n ? s / n : 1;
  }

  function quotaScore(a, quota, initial, mean) {
    if (!a.ages.length) return 1;
    let total = 0;
    for (const [lo, hi] of a.ages) {
      let best = -1e9;
      for (let age = lo; age <= hi; age++) {
        const b = bandOf(age);
        const room = initial[b] > 0 ? quota[b] / initial[b] : -1;
        if (room > best) best = room;
      }
      // Relative to the average band, so a slot whose band is running dry repels and a slot whose
      // band is still empty attracts. An absolute measure saturates at one and does neither.
      total += Math.max(0, best) / Math.max(0.05, mean);
    }
    return total / a.ages.length;
  }

  /** Consume the quota an archetype's slots would use, each in the band with the most room left. */
  function consumeQuota(a, quota, initial) {
    for (const [lo, hi] of a.ages) {
      let bestBand = bandOf(lo), bestRoom = -1;
      for (let age = lo; age <= hi; age++) {
        const b = bandOf(age);
        const room = initial[b] > 0 ? quota[b] / initial[b] : 0;
        if (room > bestRoom) { bestRoom = room; bestBand = b; }
      }
      quota[bestBand]--;
    }
  }

  function sampleHouseholds() {
    const pack = world.data.residents;
    const dist = (pack && pack.census_baseline && pack.census_baseline.island && pack.census_baseline.island.age_distribution) || [];
    const islandMedian = (pack && pack.census_baseline && pack.census_baseline.island && pack.census_baseline.island.median_age) || 52;
    const profile = perYearProfile(dist);

    const out = [];
    for (const t of TOWNS) {
      const pool = [];
      for (const a of R.archetypes.values()) {
        if (!a.residence || a.townshipId !== t.id || a.share <= 0) continue;
        pool.push(a);
      }
      if (!pool.length) continue;

      // 1. exact household counts per composition class, from the township's published split.
      //    Classes with no archetype in this township (Amity has no group household in the pack)
      //    drop out and the rest renormalise, rather than the target being quietly lost.
      const classTotals = { family: 0, lonePerson: 0, group: 0 };
      for (const a of pool) classTotals[a.cls] += a.share;
      const targetPct = { family: t.familyPct, lonePerson: t.lonePersonPct, group: t.groupPct };
      let liveSum = 0;
      for (const c of ['family', 'lonePerson', 'group']) if (classTotals[c] > 0) liveSum += targetPct[c];
      const counts = { family: 0, lonePerson: 0, group: 0 };
      let assigned = 0;
      const order = ['lonePerson', 'group', 'family'];
      for (const c of order) {
        if (classTotals[c] <= 0 || liveSum <= 0) continue;
        counts[c] = c === 'family' ? t.occupied - assigned : Math.round(t.occupied * targetPct[c] / liveSum);
        assigned += counts[c];
      }
      if (counts.family < 0) { counts.family = 0; }
      t.classCounts = { ...counts };

      // 2. draw within each class. Weighted by the pack's share, by how well the archetype's size
      //    serves the people this township still has to house, and by how much of the published
      //    age quota is still open for the kind of people it would add.
      const quota = townshipQuota(profile, t.medianAge - islandMedian, t.population);
      const initial = Float64Array.from(quota);
      t.ageQuota = Array.from(quota, (v) => Math.round(v));
      let peopleLeft = t.population;
      let hhLeft = t.occupied;
      const drawn = [];
      const taken = new Map();
      const floorOf = new Map();
      const capOf = new Map();
      for (const a of pool) taken.set(a.id, 0);
      for (const c of order) {
        const cArch = pool.filter((a) => a.cls === c);
        if (!cArch.length || counts[c] <= 0) continue;

        // Floor and ceiling on each archetype, from its own share. The published age structure and
        // the published household count both pull against the pack's archetype mix, and left free
        // to do it the fit will empty whole archetypes out: an early run put ninety-five artist
        // households at Point Lookout against a two per cent share and left the three-generation
        // Dunwich household at zero against a five per cent share, which is not this island. So an
        // archetype keeps at least a third of its share and takes at most a bit over twice it, and
        // the fit works inside that.
        const shareSum = cArch.reduce((s, a) => s + a.share, 0) || 1;
        const targetOf = new Map(cArch.map((a) => [a.id, (a.share / shareSum) * counts[c]]));
        for (const a of cArch) {
          floorOf.set(a.id, Math.floor(targetOf.get(a.id) * 0.45));
          capOf.set(a.id, Math.ceil(targetOf.get(a.id) * 2.0) + 1);
        }

        const place = (v) => {
          taken.set(v.a.id, taken.get(v.a.id) + 1);
          consumeQuota(v, quota, initial);
          drawn.push({ archetype: v.a, extra: v.extra, extraLabel: v.label, ageRanges: v.ages, size: v.size, townshipId: t.id });
          peopleLeft -= v.size;
          hhLeft--;
        };

        // The floors go down first, in a fixed order, so no archetype can be squeezed out by the
        // fitting that follows.
        let placed = 0;
        for (const a of cArch) {
          const f = Math.min(floorOf.get(a.id), counts[c] - placed);
          for (let i = 0; i < f; i++) { place({ a, extra: null, ages: a.ages, size: a.size, label: null }); placed++; }
        }

        const cPool = [];
        for (const a of cArch) for (const v of variantsOf(a)) cPool.push(v);

        for (let n = placed; n < counts[c]; n++) {
          const need = hhLeft > 0 ? peopleLeft / hhLeft : 2;
          const mean = meanRoom(quota, initial);
          const items = [];
          for (const v of cPool) {
            if (taken.get(v.a.id) >= capOf.get(v.a.id)) continue;
            const gap = v.size - need;
            const room = quotaScore(v, quota, initial, mean);
            const rarity = v.extra ? 0.22 : 1;   // most couples are two people
            items.push({ v, w: v.a.share * rarity * Math.exp(-(gap * gap) * 0.5) * Math.pow(Math.max(0.001, room), 1.1) });
          }
          if (!items.length) break;
          place(rng.weighted(items, (i) => i.w).v);
        }
      }

      // 3. repair, inside the family class only, so the published composition split never moves,
      //    and inside the same floors and caps, so the repair cannot undo them. An early version
      //    had no floor here and closed the whole gap by deleting the largest households, which
      //    took the three-generation Dunwich household from a five per cent share down to two
      //    houses. A swap rather than an add, so the household count never moves either.
      let pop = drawn.reduce((s, h) => s + h.size, 0);
      const famPool = [];
      for (const a of pool) if (a.cls === 'family') for (const v of variantsOf(a)) famPool.push(v);
      const famIdx = drawn.map((h, i) => (h.archetype.cls === 'family' ? i : -1)).filter((i) => i >= 0);
      for (let guard = 0; guard < 8000 && pop !== t.population && famPool.length > 1; guard++) {
        const gap = t.population - pop;
        const wantBigger = gap > 0;
        let best = null, bestScore = -1;
        for (const i of famIdx) {
          const cur = drawn[i];
          if (taken.get(cur.archetype.id) <= (floorOf.get(cur.archetype.id) || 0)) continue;
          for (const v of famPool) {
            if (v.a.id === cur.archetype.id && v.extra === cur.extra) continue;
            if (taken.get(v.a.id) >= (capOf.get(v.a.id) || 1e9) && v.a.id !== cur.archetype.id) continue;
            const delta = v.size - cur.size;
            if (wantBigger ? delta <= 0 : delta >= 0) continue;
            if (Math.abs(delta) > Math.abs(gap)) continue;
            // One person at a time is preferred, so the residual spreads across many households
            // instead of being taken out of a handful of the biggest ones.
            const w = v.a.share * (v.extra ? 0.5 : 1) / Math.abs(delta) * (1 + rng.float() * 0.002);
            if (w > bestScore) { bestScore = w; best = { i, v }; }
          }
        }
        if (!best) break;
        const d = drawn[best.i];
        taken.set(d.archetype.id, taken.get(d.archetype.id) - 1);
        taken.set(best.v.a.id, (taken.get(best.v.a.id) || 0) + 1);
        pop += best.v.size - d.size;
        d.archetype = best.v.a; d.extra = best.v.extra; d.extraLabel = best.v.label;
        d.ageRanges = best.v.ages; d.size = best.v.size;
      }
      t.actualPopulation = pop;
      for (const h of drawn) out.push(h);
    }
    return out;
  }

  /* -------------------------------------------------------------- age fitting

  Quota assignment against the eighteen published bands. Each person's archetype gives an age range;
  within that range the age with the most published quota left wins, with a deterministic jitter so
  a whole township of "40s" does not all land on the same year. */

  /**
   * Ages, household by household, against the published band quota.
   *
   * The archetype's age band is a medium-confidence modelling estimate and the census band counts
   * are high-confidence published data, so an adult may sit up to fifteen years outside the band
   * the pack wrote, at a cost, when the census needs somebody there. Children may not: a child's
   * age decides which school they are at and how many are at the Dunwich gate, and there are few
   * enough of them that moving one is visible.
   *
   * Household coherence is enforced while the ages are chosen rather than repaired afterwards:
   * a parent is at least eighteen and at most fifty-two years older than the youngest child in the
   * house, a couple stays inside sixteen years of each other, and only a third adult in a house
   * with children may be old enough to be the grandparent, which is exactly the arrangement the
   * three-generation archetype describes.
   */
  const ADULT_STRETCH = 15;

  function fitAges(households) {
    const residuals = {};
    for (const t of TOWNS) {
      const initial = Float64Array.from(t.ageQuota || new Array(18).fill(1));
      const quota = Float64Array.from(initial);

      const pick = (lo, hi, band, stretch) => {
        let best = lo, bestScore = -Infinity;
        const l = Math.max(0, Math.min(lo, band[0] - stretch));
        const h = Math.max(hi, band[1] + stretch);
        for (let a = Math.max(lo, l); a <= Math.min(hi, h); a++) {
          const b = bandOf(a);
          const outside = a < band[0] ? band[0] - a : a > band[1] ? a - band[1] : 0;
          const room = initial[b] > 0 ? quota[b] / initial[b] : -1;
          const score = room * 100 - outside * 1.3 + rng.range(-0.6, 0.6);
          if (score > bestScore) { bestScore = score; best = a; }
        }
        quota[bandOf(best)]--;
        return best;
      };

      const mine = households.filter((h) => h.townshipId === t.id);
      for (const idx of rng.shuffle(mine.map((_, i) => i))) {
        const hh = mine[idx];
        const ranges = hh.ageRanges || hh.archetype.ages;
        const childSlots = [], adultSlots = [];
        for (let i = 0; i < ranges.length; i++) {
          (ranges[i][1] < 18 ? childSlots : adultSlots).push({ i, band: ranges[i] });
        }
        hh.ages = new Array(ranges.length);

        let youngestChild = Infinity;
        for (const s of childSlots) {
          const a = pick(s.band[0], s.band[1], s.band, 0);
          hh.ages[s.i] = a;
          if (a < youngestChild) youngestChild = a;
        }

        // Oldest intent first, so the grandparent slot is resolved before the parents.
        adultSlots.sort((a, b) => (b.band[0] + b.band[1]) - (a.band[0] + a.band[1]));
        const hasKids = childSlots.length > 0;
        const threePlus = adultSlots.length >= 3;
        let firstAdult = null;
        for (let k = 0; k < adultSlots.length; k++) {
          const s = adultSlots[k];
          let lo = 18, hi = 99;
          if (hasKids) {
            lo = Math.max(lo, youngestChild + 18);
            hi = Math.min(hi, youngestChild + (k === 0 && threePlus ? 78 : 52));
          }
          if (k === 1 && firstAdult !== null) {
            // Second adult: the partner if the pack put them in a similar band, otherwise a
            // different generation under the same roof.
            const mid = (s.band[0] + s.band[1]) / 2;
            if (Math.abs(mid - firstAdult) <= 14) { lo = Math.max(lo, firstAdult - 16); hi = Math.min(hi, firstAdult + 16); }
            else hi = Math.min(hi, firstAdult);
          } else if (k >= 2 && firstAdult !== null) {
            hi = Math.min(hi, firstAdult);
          }
          if (lo > hi) { lo = Math.max(18, Math.min(lo, hi)); hi = Math.max(lo, hi); }
          const a = pick(lo, hi, s.band, ADULT_STRETCH);
          hh.ages[s.i] = a;
          if (k === 0) firstAdult = a;
        }
      }

      let worst = 0;
      for (let i = 0; i < 18; i++) worst = Math.max(worst, Math.abs(quota[i]));
      residuals[t.id] = Math.round(worst);
    }
    return residuals;
  }

  /* -------------------------------------------------------------- occupations and employers */

  function assignWork(p, hh, workEntry) {
    const occId = workEntry ? workEntry.occupation : null;
    const occ = occId ? R.occupations.get(occId) : null;
    p.occupationId = occId || 'none';
    p.occupationLabel = occ ? occ.label : 'not in the labour force';
    p.workPattern = workEntry ? workEntry.pattern : '';
    p.stress = occ ? (occ.stress || 0.4) : 0.2;
    p.physical = occ ? (occ.physical || 0.3) : 0.25;
    p.shifts = occ && occ.shifts ? occ.shifts : [];
    p.seasonality = occ ? occ.seasonality || null : null;
    p.employerId = null;
    p.employerLabel = null;
    p.employerPlace = null;

    if (!occ) return;
    if (occId === 'retired' || occId === 'unpaid-carer' || occId === 'unemployed') return;
    const candidates = (occ.employers || [])
      .map((id) => R.businesses.get(id))
      .filter((b) => b && b.status !== 'closed' && b.status !== 'proposed');
    if (!candidates.length) {
      // Sole traders, remote workers, mainland commuters and volunteers with no employer entry.
      p.employerLabel = occ.employers && occ.employers.length ? 'no trading employer listed' : 'self-employed or no fixed employer';
      return;
    }
    // Nearest employer with room, so a Dunwich cook does not commute to Point Lookout for no reason.
    const withRoom = candidates.filter((b) => b.staffed < (b.employs.max || 8));
    const pick = (withRoom.length ? withRoom : candidates)
      .map((b) => ({ b, d: (b.x - hh.x) * (b.x - hh.x) + (b.z - hh.z) * (b.z - hh.z) }))
      .sort((a, b) => a.d - b.d)[0].b;
    pick.staffed++;
    p.employerId = pick.id.replace(/^biz:/, '');
    p.employerLabel = pick.label;
    p.employerPlace = pick;
  }

  /* -------------------------------------------------------------- traits

  Five numbers, drawn per person, tilted by age and occupation, and this is where the surprises come
  from. Two neighbours in identical households with identical needs will do different things on the
  same afternoon because one of them is a water person and the other one is not. */

  function makeTraits(p, arch) {
    const n = () => clamp(rng.normal(0.5, 0.22), 0.02, 0.98);
    const t = {
      outdoors: n(),
      sociable: n(),
      homebody: n(),
      earlyRiser: n(),
      water: n(),          // surf, boat, fish, swim: the thing that decides a lot of this island
      civic: n(),          // turns out for the working bee, the meeting, the callout
      patience: n()        // how slowly island fatigue accumulates
    };
    if (p.age >= 68) { t.earlyRiser = clamp(t.earlyRiser + 0.18, 0, 1); t.outdoors = clamp(t.outdoors - 0.06, 0, 1); }
    if (p.age <= 17) { t.sociable = clamp(t.sociable + 0.15, 0, 1); t.earlyRiser = clamp(t.earlyRiser - 0.2, 0, 1); }
    if (/surf|dive/.test(p.occupationId)) t.water = clamp(t.water + 0.35, 0, 1);
    if (/fisher|skipper|deckhand|marine/.test(p.occupationId)) t.water = clamp(t.water + 0.3, 0, 1);
    if (/ranger|rehabilitation|council-outdoor/.test(p.occupationId)) t.outdoors = clamp(t.outdoors + 0.25, 0, 1);
    if (/volunteer|paramedic|police|health|nurse|teacher|community/.test(p.occupationId)) t.civic = clamp(t.civic + 0.25, 0, 1);
    if (/remote-knowledge|fifo|commuter/.test(p.occupationId)) t.homebody = clamp(t.homebody + 0.12, 0, 1);
    if (arch && arch.cls === 'lonePerson') t.homebody = clamp(t.homebody + 0.08, 0, 1);
    p.traits = t;
  }

  /* -------------------------------------------------------------- slots */

  function takeSlot(p) {
    const s = R.freeSlots.length ? R.freeSlots.pop() : R.slotCapacity++;
    R.slotOf[s] = p;
    p.slot = s;
    return s;
  }
  function releaseSlot(p) {
    if (p.slot === undefined || p.slot < 0) return;
    R.slotOf[p.slot] = null;
    R.freeSlots.push(p.slot);
    p.slot = -1;
  }

  /* -------------------------------------------------------------- building people */

  let dwellingSeq = 0;

  function siteFor(t, arch) {
    if (arch && arch.rural && R.bushSites && R.bushSites.length) {
      const s = R.bushSites[(dwellingSeq * 37) % R.bushSites.length];
      return { x: s.x + rng.range(-40, 40), z: s.z + rng.range(-40, 40) };
    }
    const sites = t.sites || [];
    if (!sites.length) return { x: t.x || 0, z: t.z || 0 };
    // Two passes over the candidate list before a third dwelling ever shares a cell.
    const i = t._siteCursor === undefined ? (t._siteCursor = 0) : ++t._siteCursor;
    const s = sites[i % sites.length];
    const ring = Math.floor(i / sites.length);
    const jitter = 8 + ring * 9;
    return { x: s.x + rng.range(-jitter, jitter), z: s.z + rng.range(-jitter, jitter) };
  }

  function makeDwelling(t, arch, use) {
    const site = siteFor(t, arch);
    const id = world.store.create('dwelling', null);
    const d = {
      id,
      townshipId: t.id,
      x: site.x, z: site.z,
      bedrooms: arch ? arch.bedrooms : 3,
      condition: arch ? arch.condition : 'sound',
      use,                        // 'resident' | 'holiday-home' | 'weekender' | 'vacant'
      vacantReason: null,
      householdId: null,
      occupiedByPartyId: null,
      region: null
    };
    world.store.set(id, 'dwelling', { townshipId: t.id, x: site.x, z: site.z, use });
    R.dwellings.push(d);
    R.dwellingsById.set(id, d);
    dwellingSeq++;
    return d;
  }

  function surnameFor(t) {
    const pool = (R.namePools && R.namePools.surnames) || ['Fenwick'];
    if (!t._surnames || !t._surnames.length) {
      // Shuffled once per township, then cycled, so no two neighbours share a name until the pool
      // has been round once. Fifty-six surnames against 970 households means repeats are certain;
      // a repeat inside a township is later read by social.js as a possible extended family, which
      // on this island is truer than pretending every house has its own name.
      t._surnames = rng.shuffle(pool);
      t._surnameCursor = 0;
    }
    const s = t._surnames[t._surnameCursor % t._surnames.length];
    t._surnameCursor++;
    return s;
  }

  function makeHousehold(spec, tick) {
    const t = TOWNS.find((x) => x.id === spec.townshipId);
    const arch = spec.archetype;
    const dwelling = makeDwelling(t, arch, 'resident');
    const id = world.store.create('household', null);
    const surname = surnameFor(t);

    const hh = {
      id,
      archetypeId: arch.id,        // live graph only, never published: see the cultural note above
      civicProfile: arch.cares,
      townshipId: t.id,
      townshipName: t.name,
      surname,
      dwellingId: dwelling.id,
      x: dwelling.x, z: dwelling.z,
      tenure: arch.tenure,
      // The ABS class, kept from the draw. A couple with an adult child still at home is a family
      // household, not a group household: a group household is unrelated adults sharing, which on
      // this island means the seasonal worker share house and very little else.
      compositionClass: arch.cls,
      bedrooms: arch.bedrooms,
      condition: arch.condition,
      incomeWeekly: Math.round(rng.range(arch.income[0], arch.income[1])),
      incomeBand: arch.incomeBand,
      vehicles: arch.vehicles,
      pressures: arch.pressures,
      seasonalNote: arch.seasonal,
      rhythm: arch.rhythm,
      members: [],
      yearsOnIsland: 0,
      formedTick: tick,
      shape: '',
      label: '',
      crowding: 0
    };
    dwelling.householdId = id;
    world.store.set(id, 'household', { townshipId: t.id, x: hh.x, z: hh.z, tenure: hh.tenure });
    R.households.push(hh);
    R.householdsById.set(id, hh);
    return hh;
  }

  function makePerson(hh, age, arch, workEntry, tick) {
    const year = world.clock.date.getUTCFullYear();
    const id = world.store.create('resident', null);
    const sexRoll = rng.float();
    const p = {
      id,
      kind: 'resident',
      slot: -1,
      householdId: hh.id,
      townshipId: hh.townshipId,
      age,
      sex: sexRoll < 0.521 ? 'male' : 'female',
      surname: hh.surname,
      given: '',
      name: '',
      nickname: null,
      x: hh.x, z: hh.z, tx: hh.x, tz: hh.z,
      homeX: hh.x, homeZ: hh.z,
      mode: 'idle',
      actionId: 'at-home',
      actionLabel: 'at home',
      reason: 'the day has not started',
      locationId: 'home',
      locationLabel: 'home',
      untilTick: 0,
      lastActionIds: [],
      mood: 0.6,
      moodLabel: 'settled',
      history: [],
      ties: new Map(),
      bubbles: [],
      stats: { shiftsWorked: 0, boatsMissed: 0, mealsSkipped: 0, nightsAway: 0, calloutsAnswered: 0, surfs: 0 },
      alive: true,
      onIsland: true,

      // Every field the other four agent systems will write, declared here with a default so the
      // object keeps one hidden class for its whole life. Two thousand people read forty times a
      // tick is enough that a person object slipping into dictionary mode is measurable, and it
      // did: adding these took the needs pass from three milliseconds to well under one.
      role: 'adult', traits: null, newcomer: false, schoolsOnIsland: true,
      occupationId: 'none', occupationLabel: '', workPattern: '', employerId: null,
      employerLabel: null, employerPlace: null, shifts: null, seasonality: null,
      stress: 0.4, physical: 0.3, employed: false, workLoad: 'part-time', lastOccupationLabel: null,
      yearsOnIsland: 0, _lastWholeAge: -1,
      // needs.js
      n: null, _decay: null, _grindMult: 1, _homePlace: null, _islandPlace: null, _places: null,
      currentGains: null, resumeAction: null, resumeUntil: 0, householdCrowding: 0, canDo: null,
      sleeping: false, householdSize: 1, hasVehicle: false,
      has4WD: false, hasBoat: false, hasDog: false, tieCount: 0, visitTarget: null,
      // schedule.js
      duty: null, plan: null, _workDays: null, worksMorning: false, hasSchoolKid: false,
      volunteer: null, volunteerLabel: null, _toldCancelled: false, _toldStranded: false,
      // social.js
      bubbleKeys: null, _tieDecayCursor: 0
    };
    p.given = givenName(age, p.sex, year);
    p.name = `${p.given} ${p.surname}`;
    if (age >= 18 && rng.float() < 0.33) p.nickname = nickname(p.given);
    p.displayName = p.nickname ? `${p.given} "${p.nickname}" ${p.surname}` : p.name;

    // Role. Dunwich State School is the island's only school and it is primary, so a child of
    // twelve or more is on a boat to the mainland every school morning.
    p.role = age < 5 ? 'preschool' : age < 12 ? 'primary' : age < 18 ? 'secondary' : age >= 68 ? 'elder' : 'adult';

    assignWork(p, hh, age >= 18 ? workEntry : null);
    if (age >= 5 && age < 12) {
      // Dunwich State School is the island's only school. Most island primary children are at it;
      // some families send theirs across with the older ones. The share is modelled: no enrolment
      // figure for the school was found in any pack, so this is not presented as measured.
      p.schoolsOnIsland = rng.float() < 0.85;
      p.occupationId = 'primary-student';
      p.occupationLabel = p.schoolsOnIsland ? 'at the island school' : 'at a mainland primary school';
      if (!p.schoolsOnIsland) p.shifts = (R.occupations.get('secondary-student-mainland') || {}).shifts || [];
    }
    if (age >= 12 && age < 18) {
      p.occupationId = 'secondary-student-mainland';
      const occ = R.occupations.get('secondary-student-mainland');
      p.occupationLabel = occ ? occ.label : 'secondary student, mainland school';
      p.shifts = occ && occ.shifts ? occ.shifts : [];
    }
    makeTraits(p, arch);

    // How long they have been here. It sets ambient familiarity in social.js and it is the whole
    // insider and outsider axis in data/narrative.json relationship_model.
    const maxYears = Math.max(0, age - 4);
    let years;
    if (arch.tenure === 'owned_outright') years = clamp(rng.range(8, 42), 0, maxYears);
    else if (arch.tenure === 'mortgage') years = clamp(rng.range(3, 22), 0, maxYears);
    else if (arch.tenure === 'rented_employer') years = clamp(rng.range(0.2, 3), 0, maxYears);
    else if (arch.tenure === 'rented_community') years = clamp(rng.range(6, 34), 0, maxYears);
    else years = clamp(rng.range(0.5, 14), 0, maxYears);
    if (age < 18) years = Math.min(years, age);
    p.yearsOnIsland = +years.toFixed(1);
    p.newcomer = p.yearsOnIsland < 3;

    takeSlot(p);
    world.store.set(id, 'agent', { slot: p.slot, kind: 'resident', townshipId: p.townshipId });
    hh.members.push(p.id);
    R.people.push(p);
    R.peopleById.set(id, p);
    return p;
  }

  /* -------------------------------------------------------------- filling a household

  The archetype's work list and its age list are not positional: the multigenerational household
  lists a ranger, a health worker and a retired grandparent against ages in their sixties, thirties,
  thirties, nine and fourteen, and the pack's own note says the grandparent does the school runs.
  So retired entries go to the oldest adults and everything else goes to the working-age ones. */

  const ENTRY_LEVEL = [
    'cafe-allrounder', 'grocery-retail-assistant', 'bar-and-gaming-attendant',
    'accommodation-housekeeper', 'campground-attendant', 'self-employed-cleaner',
    'island-builder-carpenter', 'dive-and-surf-instructor', 'teacher-aide'
  ];

  function buildMembers(hh, spec, tick) {
    const arch = spec.archetype;
    const ages = spec.ages || (spec.ageRanges || arch.ages).map(([lo, hi]) => Math.round((lo + hi) / 2));
    const adults = ages.filter((a) => a >= 18).sort((a, b) => a - b);
    const kids = ages.filter((a) => a < 18).sort((a, b) => a - b);

    const retiredEntries = arch.work.filter((wk) => wk.occupation === 'retired');
    const otherEntries = arch.work.filter((wk) => wk.occupation !== 'retired' && wk.occupation !== 'secondary-student-mainland');
    const assignment = new Array(adults.length).fill(null);

    // Oldest adults take the retired entries.
    for (let i = 0; i < retiredEntries.length && i < adults.length; i++) {
      assignment[adults.length - 1 - i] = retiredEntries[i];
    }
    // Working-age adults take the rest, youngest first.
    let oi = 0;
    for (let i = 0; i < adults.length && oi < otherEntries.length; i++) {
      if (assignment[i]) continue;
      assignment[i] = otherEntries[oi++];
    }
    // Anyone left over. An adult child at home gets an entry-level island job or none; anybody
    // past pension age is retired; a parent of a preschooler with nothing listed is carrying the
    // unpaid care, which the pack is explicit should be treated as work rather than as leisure.
    for (let i = 0; i < adults.length; i++) {
      if (assignment[i]) continue;
      const age = adults[i];
      if (age >= 67) assignment[i] = { occupation: 'retired', pattern: 'not in the labour force' };
      else if (kids.length && kids[0] < 5 && rng.float() < 0.45) assignment[i] = { occupation: 'unpaid-carer', pattern: 'at home with a small child' };
      else if (age < 35) assignment[i] = { occupation: rng.pick(ENTRY_LEVEL), pattern: 'whatever hours the season gives' };
      else assignment[i] = otherEntries.length ? otherEntries[otherEntries.length - 1] : { occupation: 'retired', pattern: 'not in the labour force' };
    }

    for (let i = 0; i < adults.length; i++) makePerson(hh, adults[i], arch, assignment[i], tick);
    for (const k of kids) makePerson(hh, k, arch, null, tick);
  }

  function finishHousehold(hh) {
    const members = hh.members.map((m) => R.peopleById.get(m)).filter(Boolean);
    const adults = members.filter((p) => p.age >= 18).length;
    hh.shape = householdShape(adults, members.length - adults, members.map((p) => p.age));
    if (hh.extraNote) hh.shape += `, with ${hh.extraNote}`;
    hh.label = `the ${hh.surname} house, ${hh.shape}, ${hh.townshipName}`;
    hh.yearsOnIsland = members.length ? Math.max(...members.map((p) => p.yearsOnIsland)) : 0;
    hh.crowding = Math.max(0, members.length - hh.bedrooms) / Math.max(1, hh.bedrooms);
    const comp = world.store.get(hh.id, 'household');
    if (comp) comp.label = hh.label;
  }

  /* -------------------------------------------------------------- labour force fit

  The census publishes 48.5 per cent of the 15-plus population in the labour force and 41 per cent
  out of it, with the balance not stated, and then splits the labour force 42.3 full time, 40 part
  time, 14.4 away from work and 3.1 unemployed. Assigning every working-age adult an occupation from
  their archetype puts participation well above the published figure, because on an island where the
  median age is 52 a great many working-age adults are simply not working. So a second pass moves
  people out of the labour force until the published share is met, taking the oldest first, then
  people carrying an unpaid caring load, then second earners in single-income households. */

  function fitLabourForce() {
    const adults = R.people.filter((p) => p.age >= 15);
    const NOT_IN = new Set(['retired', 'unpaid-carer', 'none', 'secondary-student-mainland', 'primary-student']);
    const inForce = adults.filter((p) => !NOT_IN.has(p.occupationId));
    const stated = adults.length;
    const target = Math.round(stated * 0.485 / (0.485 + 0.41));
    let surplus = inForce.length - target;

    if (surplus > 0) {
      const ranked = inForce.slice().sort((a, b) => {
        const score = (p) => {
          let s = p.age;
          if (p.age >= 60) s += 40;
          if (p.age >= 67) s += 60;
          const hh = R.householdsById.get(p.householdId);
          if (hh && hh.members.length > 2) s += 6;
          return s;
        };
        return score(b) - score(a);
      });
      for (let i = 0; i < ranked.length && surplus > 0; i++) {
        const p = ranked[i];
        if (p.age < 25) continue;
        const hh = R.householdsById.get(p.householdId);
        const others = hh ? hh.members.filter((m) => m !== p.id).map((m) => R.peopleById.get(m)).filter((o) => o && !NOT_IN.has(o.occupationId)) : [];
        // Never leave a household with children and no income at all.
        const kids = hh ? hh.members.filter((m) => { const o = R.peopleById.get(m); return o && o.age < 18; }).length : 0;
        if (kids > 0 && others.length === 0) continue;
        const carer = kids > 0 && p.age < 60 && rng.float() < 0.4;
        assignWork(p, hh || { x: p.x, z: p.z }, { occupation: carer ? 'unpaid-carer' : 'retired', pattern: carer ? 'unpaid care at home' : 'not in the labour force' });
        surplus--;
      }
    }

    // Unemployment, at the published 3.1 per cent of the labour force, and a full time, part time
    // and away-from-work split at the published shares. Part time hours are the island's normal.
    const force = adults.filter((p) => !NOT_IN.has(p.occupationId));
    const shuffled = rng.shuffle(force);
    const nUnemployed = Math.round(shuffled.length * 0.031);
    for (let i = 0; i < shuffled.length; i++) {
      const p = shuffled[i];
      if (i < nUnemployed) {
        p.employed = false;
        p.workLoad = 'looking for work';
        p.lastOccupationLabel = p.occupationLabel;
        p.occupationId = 'unemployed';
        p.occupationLabel = `out of work, last worked as a ${String(p.lastOccupationLabel || 'casual').toLowerCase()}`;
        if (p.employerPlace) { p.employerPlace.staffed = Math.max(0, p.employerPlace.staffed - 1); p.employerPlace = null; }
        p.employerId = null; p.employerLabel = null; p.shifts = [];
        continue;
      }
      p.employed = true;
      const r = (i - nUnemployed) / Math.max(1, shuffled.length - nUnemployed);
      p.workLoad = r < 0.423 ? 'full-time' : r < 0.823 ? 'part-time' : 'away from work this week';
    }
  }

  /* -------------------------------------------------------------- the unoccupied half */

  function buildUnoccupied() {
    const holiday = R.archetypes.get('holiday-home-owner-point-lookout');
    const weekend = R.archetypes.get('weekender-owner-amity');
    const targets = { dunwich: 105, 'point-lookout': 658, 'amity-point': 184, 'one-mile': 41 };
    // The pack's two dwelling archetypes cover about 81 per cent of the unoccupied stock and are
    // concentrated at Point Lookout and Amity Point. The rest are ordinary empties: between
    // tenancies, on the market, being repaired, or the occupant was away on census night. The pack
    // is explicit that there is no holiday home archetype for Dunwich, because that is not what
    // Dunwich's empty houses are.
    const VACANT_REASONS = ['between tenancies', 'on the market', 'being repaired', 'owner away'];
    for (const t of TOWNS) {
      const n = targets[t.id] || 0;
      for (let i = 0; i < n; i++) {
        let use = 'vacant', arch = null;
        if (t.id === 'point-lookout') { use = i < Math.round(n * 0.93) ? 'holiday-home' : 'vacant'; arch = holiday; }
        else if (t.id === 'amity-point') { use = i < Math.round(n * 0.90) ? 'weekender' : 'vacant'; arch = weekend; }
        else if (t.id === 'one-mile') { use = i < Math.round(n * 0.45) ? 'holiday-home' : 'vacant'; arch = holiday; }
        const d = makeDwelling(t, arch || { bedrooms: 3, condition: 'sound' }, use);
        if (use === 'vacant') d.vacantReason = VACANT_REASONS[i % VACANT_REASONS.length];
        else d.ownerLabel = use === 'holiday-home' ? 'owned off the island' : 'a weekender';
      }
    }
    R.holidayHomes = R.dwellings.filter((d) => d.use === 'holiday-home' || d.use === 'weekender');
    R.rentalPool = R.dwellings.filter((d) => d.use === 'vacant');
  }

  /* -------------------------------------------------------------- read model */

  /** Mutated in place rather than rebuilt: 2,000 fresh object literals several times a sim-hour
   *  is a real cost for a list that mostly does not change. */
  function rebuildRoster() {
    const roster = state.roster;
    const n = R.people.length;
    for (let i = 0; i < n; i++) {
      const p = R.people[i];
      let r = roster[i];
      if (!r) r = roster[i] = { id: 0, name: '', age: 0, township: '', household: 0, occupation: '', action: '', reason: '', mood: '', x: 0, z: 0, onIsland: true };
      r.id = p.id; r.name = p.displayName; r.age = Math.floor(p.age); r.township = p.townshipId;
      r.household = p.householdId; r.occupation = p.occupationLabel;
      r.action = p.actionLabel; r.reason = p.reason; r.mood = p.moodLabel;
      r.x = Math.round(p.x); r.z = Math.round(p.z); r.onIsland = p.onIsland;
    }
    if (roster.length > n) roster.length = n;
  }

  /** One legible person, flattened. This is what an inspector panel renders when you click someone. */
  function card(id) {
    const p = R.peopleById.get(id);
    if (!p) return null;
    const hh = R.householdsById.get(p.householdId);
    const needsState = world.read('needs');
    const mine = needsState && needsState[p.id] ? needsState[p.id] : null;
    const socialState = world.read('social');
    const round2 = (o) => { const r = {}; for (const k of Object.keys(o || {})) r[k] = Math.round(o[k] * 100) / 100; return r; };
    return {
      id: p.id,
      name: p.displayName,
      age: Math.floor(p.age),
      role: p.role,
      township: hh ? hh.townshipName : p.townshipId,
      household: hh ? { id: hh.id, label: hh.label, shape: hh.shape, members: hh.members.length, tenure: hh.tenure, bedrooms: hh.bedrooms } : null,
      livesWith: hh ? hh.members.filter((m) => m !== p.id).map((m) => {
        const o = R.peopleById.get(m);
        return o ? { id: o.id, name: o.displayName, age: o.age } : null;
      }).filter(Boolean) : [],
      job: { occupation: p.occupationLabel, employer: p.employerLabel, pattern: p.workPattern },
      yearsOnIsland: Math.round(p.yearsOnIsland * 10) / 10,
      doing: p.actionLabel,
      because: p.reason,
      at: p.locationLabel,
      onIsland: p.onIsland,
      duty: p.duty ? { kind: p.duty.kind, reason: p.duty.reason } : null,
      volunteer: p.volunteerLabel || null,
      mood: p.moodLabel,
      needs: needsState && needsState.levelsOf ? needsState.levelsOf(p.id) : null,
      unmet: mine ? mine.unmet.slice() : [],
      traits: round2(p.traits),
      relationships: socialState && socialState.forAgent ? socialState.forAgent(p.id, 6) : [],
      history: p.history.slice().reverse(),
      stats: p.stats
    };
  }

  function refreshAggregates() {
    const people = R.people;
    const n = people.length;
    const bands = new Array(18).fill(0);
    const byT = {};
    for (const t of TOWNS) byT[t.id] = { name: t.name, residents: 0, households: 0, dwellings: 0, unoccupied: 0, medianAge: 0, ages: [] };
    const ages = new Array(n);
    let inLF = 0, employed = 0, unemployed = 0, notInLF = 0;
    const byOcc = {};
    let primary = 0, secondary = 0;
    for (let i = 0; i < n; i++) {
      const p = people[i];
      ages[i] = p.age;
      bands[bandOf(p.age)]++;
      const b = byT[p.townshipId];
      if (b) { b.residents++; b.ages.push(p.age); }
      if (p.age >= 15) {
        if (p.occupationId === 'unemployed') { inLF++; unemployed++; }
        else if (p.occupationId === 'retired' || p.occupationId === 'none' || p.occupationId === 'unpaid-carer'
          || p.occupationId === 'secondary-student-mainland' || p.occupationId === 'primary-student') notInLF++;
        else { inLF++; employed++; }
      }
      byOcc[p.occupationId] = (byOcc[p.occupationId] || 0) + 1;
      if (p.role === 'primary' && p.schoolsOnIsland !== false) primary++;
      if (p.role === 'secondary' || (p.role === 'primary' && p.schoolsOnIsland === false)) secondary++;
    }
    ages.sort((a, b) => a - b);
    const medianAge = ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : 0;
    const comp = { family: 0, lonePerson: 0, group: 0 };
    const tenure = {};
    for (const hh of R.households) {
      const b = byT[hh.townshipId];
      if (b) b.households++;
      if (hh.members.length === 1) comp.lonePerson++;
      else comp[hh.compositionClass === 'group' ? 'group' : 'family']++;
      tenure[hh.tenure] = (tenure[hh.tenure] || 0) + 1;
    }
    let holidayHomes = 0, weekenders = 0, vacant = 0, occupied = 0;
    for (const d of R.dwellings) {
      const b = byT[d.townshipId];
      if (b) { b.dwellings++; if (d.use !== 'resident') b.unoccupied++; }
      if (d.use === 'holiday-home') holidayHomes++;
      else if (d.use === 'weekender') weekenders++;
      else if (d.use === 'vacant') vacant++;
      else occupied++;
    }
    for (const t of TOWNS) {
      const b = byT[t.id];
      b.ages.sort((x, y) => x - y);
      b.medianAge = b.ages.length ? Math.round(b.ages[Math.floor(b.ages.length / 2)]) : 0;
      b.ages = undefined;
    }

    state.residents = n;
    state.households = R.households.length;
    state.dwellings = { total: R.dwellings.length, occupied, unoccupied: R.dwellings.length - occupied, holidayHomes, weekenders, vacant };
    state.byTownship = byT;
    state.medianAge = medianAge;
    state.ageBands = bands.map((c, i) => ({ band: i === 17 ? '85+' : `${BAND_LO[i]}-${BAND_HI[i]}`, count: c, pct: +(100 * c / Math.max(1, n)).toFixed(1) }));
    state.composition = {
      family: +(100 * comp.family / Math.max(1, R.households.length)).toFixed(1),
      lonePerson: +(100 * comp.lonePerson / Math.max(1, R.households.length)).toFixed(1),
      group: +(100 * comp.group / Math.max(1, R.households.length)).toFixed(1)
    };
    state.tenure = tenure;
    state.labour = {
      inLabourForce: inLF, employed, unemployed, notInLabourForce: notInLF,
      participationPct: +(100 * inLF / Math.max(1, inLF + notInLF)).toFixed(1),
      byOccupation: byOcc
    };
    state.schoolEnrolments = primary;
    state.studentsCrossing = secondary;

    // Vacancies. A business whose published minimum staffing is not met by anybody living here.
    const vac = [];
    for (const b of R.businesses.values()) {
      const min = b.employs && b.employs.min ? b.employs.min : 0;
      if (min > 0 && b.staffed < min) vac.push({ business: b.id.replace(/^biz:/, ''), label: b.label, short: min - b.staffed, township: b.township });
    }
    vac.sort((a, b) => b.short - a.short);
    state.vacancies = vac.slice(0, 24);
    state.vacancyTotal = vac.reduce((s, v) => s + v.short, 0);
  }

  /* -------------------------------------------------------------- demography

  Amortised: one one-hundred-and-forty-fourth of the roster is examined each tick, so a whole
  sim-year of ageing, births, deaths and moves costs nothing on any single frame. Rates are annual
  and every draw comes from the 'demography' stream. */

  let cursor = 0;
  const dayLog = { births: [], deaths: [], leavers: [], returners: [] };
  let todayCounts = { births: 0, deaths: 0, leavers: 0, returners: 0 };
  /** Households that emptied today, whatever emptied them. In-migration is matched to this and to
   *  nothing else, because a household can only move in where a dwelling has actually come free. */
  let householdsFreedToday = 0;

  function rollingSum(arr) { let s = 0; for (const v of arr) s += v; return s; }

  function personDies(p, tick) {
    p.alive = false;
    const hh = R.householdsById.get(p.householdId);
    remember(p, 'died', tick, 3);
    if (hh) {
      hh.members = hh.members.filter((m) => m !== p.id);
      for (const m of hh.members) {
        const o = R.peopleById.get(m);
        if (o) remember(o, `lost ${p.given}`, tick, 3);
      }
      if (!hh.members.length) dissolveHousehold(hh, tick, 'the last person in the house died');
    }
    world.bus.emit('person:died', { id: p.id, name: p.displayName, age: p.age, township: p.townshipId });
    removePerson(p);
    todayCounts.deaths++;
  }

  function removePerson(p) {
    releaseSlot(p);
    R.peopleById.delete(p.id);
    const i = R.people.indexOf(p);
    if (i >= 0) R.people.splice(i, 1);
    if (p.employerPlace) p.employerPlace.staffed = Math.max(0, p.employerPlace.staffed - 1);
    world.store.destroy(p.id);
  }

  function dissolveHousehold(hh, tick, why) {
    const d = R.dwellingsById.get(hh.dwellingId);
    if (d) {
      d.householdId = null;
      // An owner-occupied house that empties goes on the market, and a share of those never come
      // back to residents. That ratchet is the island's housing argument in one line, so it is slow
      // and it is visible rather than assumed.
      if (hh.tenure === 'owned_outright' || hh.tenure === 'mortgage') {
        if (dRng.float() < SALE_TO_HOLIDAY_HOME_SHARE) {
          d.use = d.townshipId === 'amity-point' ? 'weekender' : 'holiday-home';
          d.ownerLabel = 'sold off the island';
          R.holidayHomes.push(d);
          world.bus.emit('housing:lost-to-holiday-let', { dwellingId: d.id, township: d.townshipId });
        } else { d.use = 'vacant'; d.vacantReason = 'on the market'; R.rentalPool.push(d); }
      } else { d.use = 'vacant'; d.vacantReason = 'between tenancies'; R.rentalPool.push(d); }
      const comp = world.store.get(d.id, 'dwelling');
      if (comp) comp.use = d.use;
    }
    const i = R.households.indexOf(hh);
    if (i >= 0) R.households.splice(i, 1);
    R.householdsById.delete(hh.id);
    world.store.destroy(hh.id);
    householdsFreedToday++;
    world.bus.emit('household:dissolved', { id: hh.id, township: hh.townshipId, why });
  }

  function householdLeaves(hh, tick, why) {
    const names = [];
    for (const m of hh.members.slice()) {
      const p = R.peopleById.get(m);
      if (!p) continue;
      names.push(p.displayName);
      removePerson(p);
      todayCounts.leavers++;
    }
    dissolveHousehold(hh, tick, why);
    world.bus.emit('household:left-the-island', { township: hh.townshipId, people: names.length, why });
  }

  /**
   * Somebody moves in. Only ever into a dwelling that is actually free, which is the whole point:
   * when the rental pool is empty the job stays vacant and the island keeps shrinking. That is the
   * mechanism behind the pack's own drama hook about a support worker who cannot find a rental.
   */
  function tryMoveIn(tick) {
    if (!R.rentalPool.length) return false;
    // Prefer to fill the job the island is shortest of, so in-migration answers demand.
    const vac = state.vacancies && state.vacancies.length ? state.vacancies[0] : null;
    const dIndex = dRng.int(0, R.rentalPool.length);
    const d = R.rentalPool[dIndex];
    if (!d || d.use !== 'vacant') { R.rentalPool.splice(dIndex, 1); return false; }
    const t = TOWNS.find((x) => x.id === d.townshipId) || TOWNS[0];

    // Choose an archetype that fits the township and the bedroom count.
    const pool = [];
    for (const a of R.archetypes.values()) {
      if (!a.residence || a.share <= 0) continue;
      if (a.townshipId !== t.id && a.townshipId !== 'one-mile') continue;
      if (a.size > d.bedrooms + 2) continue;
      let w = a.share;
      if (vac) {
        for (const wk of a.work) {
          const occ = R.occupations.get(wk.occupation);
          if (occ && (occ.employers || []).includes(vac.business)) { w *= 6; break; }
        }
      }
      // Renters move in far more often than owners do: the churn is in the rental market.
      if (a.tenure === 'rented_private' || a.tenure === 'rented_employer') w *= 2.4;
      pool.push({ a, w });
    }
    if (!pool.length) return false;
    const arch = dRng.weighted(pool, (i) => i.w).a;

    R.rentalPool.splice(dIndex, 1);
    const hh = makeHousehold({ archetype: arch, townshipId: t.id }, tick);
    // Reuse the dwelling that was actually free rather than the one makeHousehold just built.
    const spare = R.dwellingsById.get(hh.dwellingId);
    if (spare) {
      R.dwellings.splice(R.dwellings.indexOf(spare), 1);
      R.dwellingsById.delete(spare.id);
      world.store.destroy(spare.id);
    }
    hh.dwellingId = d.id;
    hh.x = d.x; hh.z = d.z;
    d.use = 'resident'; d.householdId = hh.id; d.vacantReason = null;
    const comp = world.store.get(d.id, 'dwelling');
    if (comp) { comp.use = 'resident'; }
    const hcomp = world.store.get(hh.id, 'household');
    if (hcomp) { hcomp.x = hh.x; hcomp.z = hh.z; }

    const ages = arch.ages.map(([lo, hi]) => Math.round(dRng.range(lo, hi + 0.999)));
    buildMembers(hh, { archetype: arch, ages }, tick);
    for (const m of hh.members) {
      const p = R.peopleById.get(m);
      if (!p) continue;
      p.yearsOnIsland = 0;
      p.newcomer = true;
      p.employed = p.occupationId !== 'unemployed' && p.occupationId !== 'retired';
      p.workLoad = p.workLoad || 'part-time';
      p.x = p.homeX = hh.x; p.z = p.homeZ = hh.z; p.tx = hh.x; p.tz = hh.z;
      remember(p, 'moved to the island', tick, 2);
      todayCounts.returners++;
    }
    finishHousehold(hh);
    world.bus.emit('household:moved-in', { id: hh.id, township: hh.townshipId, people: hh.members.length });
    return true;
  }

  function birth(mother, tick) {
    const hh = R.householdsById.get(mother.householdId);
    if (!hh || hh.members.length >= hh.bedrooms + 3) return;
    const arch = R.archetypes.get(hh.archetypeId);
    const p = makePerson(hh, 0, arch || { tenure: hh.tenure, cls: 'family' }, null, tick);
    p.yearsOnIsland = 0;
    p.role = 'preschool';
    p.surname = hh.surname;
    p.name = `${p.given} ${p.surname}`;
    p.displayName = p.name;
    remember(mother, `had a baby, ${p.given}`, tick, 3);
    remember(p, 'born on the island', tick, 3);
    todayCounts.births++;
    world.bus.emit('person:born', { id: p.id, name: p.name, township: hh.townshipId, householdId: hh.id });
  }

  function demographyStep(w, tick) {
    const people = R.people;
    if (!people.length) return;
    const perTick = Math.max(1, Math.ceil(people.length / 144));
    for (let k = 0; k < perTick; k++) {
      if (cursor >= people.length) cursor = 0;
      const p = people[cursor++];
      if (!p || !p.alive) continue;

      p.age += 1 / 365;
      p.yearsOnIsland += 1 / 365;
      const wholeAge = Math.floor(p.age);
      if (wholeAge !== p._lastWholeAge) {
        p._lastWholeAge = wholeAge;
        p.role = wholeAge < 5 ? 'preschool' : wholeAge < 12 ? 'primary' : wholeAge < 18 ? 'secondary' : wholeAge >= 68 ? 'elder' : 'adult';
        if (wholeAge === 12) {
          p.occupationId = 'secondary-student-mainland';
          const occ = R.occupations.get('secondary-student-mainland');
          p.occupationLabel = occ ? occ.label : 'secondary student, mainland school';
          p.shifts = occ && occ.shifts ? occ.shifts : [];
          remember(p, 'started high school on the mainland: the boat is now the family timetable', tick, 2);
        }
        if (wholeAge === 5) {
          p.occupationId = 'primary-student';
          p.occupationLabel = 'at the island school';
          remember(p, 'started at the island school', tick, 2);
        }
      }
      if (p.newcomer && p.yearsOnIsland >= 3) p.newcomer = false;

      // Death
      const hz = DEATH_HAZARD[Math.min(9, Math.floor(p.age / 10))] / 365;
      if (dRng.float() < hz) { personDies(p, tick); cursor--; continue; }

      // Birth
      if (p.sex === 'female' && p.age >= 20 && p.age < 45) {
        const hh = R.householdsById.get(p.householdId);
        const partnered = hh && hh.members.filter((m) => { const o = R.peopleById.get(m); return o && o.age >= 18; }).length >= 2;
        const rate = (BIRTHS_PER_1000_WOMEN_20_44 / 1000) * (partnered ? 1.25 : 0.35) / 365;
        if (dRng.float() < rate) birth(p, tick);
      }
    }

    // Household moves, once a sim-day. Deliberately not on the midnight tick: that tick already
    // carries the calendar rollover and the aggregate rebuild, and stacking all three made one
    // tick a day cost twenty milliseconds, which is a dropped frame however cheap the average is.
    if (w.clock.minuteOfDay === 180) {
      // Anything that emptied a household without going through here: social.js moves a new couple
      // in together and can leave a share house with nobody in it. The dwelling has to come back to
      // the pool or the island quietly loses a house.
      for (const hh of R.households.slice()) {
        if (!hh.members.length) dissolveHousehold(hh, tick, 'the last person in the house moved out');
      }
      for (const hh of R.households.slice()) {
        const rate = (OUT_MIGRATION_BY_TENURE[hh.tenure] ?? 0.05) / 365;
        // Pressure: a household with nobody working and no pension-age member is under real strain,
        // and a rental household in a township where most of the houses sit empty feels it hardest.
        let mult = 1;
        const t = TOWNS.find((x) => x.id === hh.townshipId);
        if (t && (hh.tenure === 'rented_private' || hh.tenure === 'rented_employer')) {
          mult *= 1 + (t.unoccupied / Math.max(1, t.occupied + t.unoccupied)) * 0.8;
        }
        if (dRng.float() < rate * mult) {
          const why = hh.tenure.startsWith('rented') ? 'the lease ended and there was nothing else to rent' : 'sold up and moved off the island';
          householdLeaves(hh, tick, why);
        }
      }
      // In-migration answers the vacancies, and it is matched one for one to the households that
      // actually emptied today. An earlier version added a household every third day on top of
      // that, and over a sim-year it grew the island by fourteen per cent and ate a hundred and
      // twenty of the vacant dwellings the census says are there. The island's occupied household
      // count is close to flat; what moves is who is in them.
      const want = Math.min(R.rentalPool.length, householdsFreedToday);
      for (let i = 0; i < want; i++) tryMoveIn(tick);
      householdsFreedToday = 0;
    }
  }

  /* -------------------------------------------------------------- movement smoothing

  Not pathfinding: src/systems/movement is that slice's job and it can take over the moment it
  exists by writing p.x and p.z itself. Until then a person still has to be somewhere believable, so
  they walk or drive toward their target at a plain speed and the render layer has something to draw. */

  function moveStep(w) {
    const dt = 600; // seconds in one tick
    const people = R.people;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p.onIsland) continue;
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 4) { p.x = p.tx; p.z = p.tz; continue; }
      const speed = p.mode === 'drive' ? 13 : p.mode === 'bike' ? 4.2 : p.mode === 'boat' ? 9 : 1.35;
      const step = speed * dt;
      const d = Math.sqrt(d2);
      if (step >= d) { p.x = p.tx; p.z = p.tz; }
      else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
    }
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'population',
    phase: 'agents',
    order: 10,

    init(w) {
      if (!w.island || w.island.ready === false) {
        state.notes.push('the island is not ready, so nobody was placed.');
        return;
      }
      const pack = w.data.residents;
      if (!pack || pack.__missing) {
        state.notes.push('data/residents.json is missing: no population was built.');
        return;
      }

      R.calendar = makeCalendar(w.data.events);
      if (R.calendar.mismatches.length) state.notes.push(...R.calendar.mismatches);

      buildPlaces(w);
      buildSites(w);
      readArchetypes(w);

      const specs = sampleHouseholds();
      const ageResiduals = fitAges(specs);

      for (const spec of specs) {
        const hh = makeHousehold(spec, 0);
        buildMembers(hh, spec, 0);
        if (spec.extraLabel) hh.extraNote = spec.extraLabel;
        finishHousehold(hh);
      }
      fitLabourForce();

      // A person with an empty history reads as a placeholder rather than as somebody who lives
      // here, so everybody starts with the one true thing about them that is already known.
      for (const p of R.people) {
        if (p.yearsOnIsland < 1.5) remember(p, 'moved to the island', 0, 1);
        else if (p.age <= p.yearsOnIsland + 1) remember(p, 'born here', 0, 1);
        else remember(p, `has been on the island ${Math.round(p.yearsOnIsland)} years`, 0, 1);
      }

      buildUnoccupied();

      // Extended family across houses. Fifty-six surnames over 970 households guarantees repeats,
      // so a repeat in the same township is read as a real family link about a third of the time
      // rather than as a coincidence. social.js picks these up as family ties.
      const bySurname = new Map();
      for (const hh of R.households) {
        const key = hh.townshipId + '|' + hh.surname;
        let list = bySurname.get(key);
        if (!list) bySurname.set(key, (list = []));
        list.push(hh);
      }
      R.extendedFamily = [];
      for (const list of bySurname.values()) {
        for (let i = 1; i < list.length; i++) {
          if (rng.float() < 0.34) {
            list[i].relatedTo = list[i - 1].id;
            list[i - 1].relatedFrom = list[i].id;
            R.extendedFamily.push([list[i - 1].id, list[i].id]);
          }
        }
      }

      R.ready = true;
      state.ready = true;
      state.card = card;
      refreshAggregates();
      rebuildRoster();

      // The fit report. Every one of these is a published figure the build has to answer for, and
      // the residual is printed rather than hidden, because the pack's own counts do not reconcile
      // exactly and pretending otherwise would be the dishonest option.
      const pub = pack.census_baseline.island;
      const notInPrivate = pub.population - state.residents;
      if (notInPrivate > 0) {
        state.notes.push(`${notInPrivate} of the published 2,156 residents are not placed in a dwelling. `
          + 'They are the gap between the published occupied dwelling counts times the published average household '
          + 'size and the published population, which is people who were not in an occupied private dwelling on '
          + 'census night. This build will not invent beds for them.');
      }
      const groupGap = Math.abs(state.composition.group - pub.household_composition_pct.group);
      if (groupGap > 1) {
        state.notes.push('Group households land under the published 3.7 per cent because only Point Lookout has a '
          + 'share-house archetype in data/residents.json. Amity Point and the rural balance publish a group share '
          + 'and the pack has no household to put in it.');
      }
      state.fit = {
        residents: { modelled: state.residents, published: pub.population, note: 'modelled figure counts people in occupied private dwellings only' },
        peopleNotInPrivateDwellings: notInPrivate,
        households: { modelled: state.households, published: pub.dwellings.occupied_derived },
        dwellings: { modelled: state.dwellings.total, published: pub.dwellings.all_private_dwellings },
        unoccupiedPct: {
          modelled: +(100 * state.dwellings.unoccupied / Math.max(1, state.dwellings.total)).toFixed(1),
          published: pub.dwellings.unoccupied_pct
        },
        medianAge: { modelled: state.medianAge, published: pub.median_age },
        lonePersonPct: { modelled: state.composition.lonePerson, published: pub.household_composition_pct.lone_person },
        familyPct: { modelled: state.composition.family, published: pub.household_composition_pct.family },
        avgPeoplePerHousehold: {
          modelled: +(state.residents / Math.max(1, state.households)).toFixed(2),
          published: pub.dwellings.avg_people_per_household
        },
        townshipMedianAge: TOWNS.map((t) => ({
          id: t.id, modelled: state.byTownship[t.id] ? state.byTownship[t.id].medianAge : 0, published: t.medianAge
        })),
        worstAgeBandResidual: ageResiduals
      };

      w.bus.emit('population:ready', {
        residents: state.residents, households: state.households, dwellings: state.dwellings.total
      });
    },

    tick(w) {
      if (!R.ready) return;
      const tick = w.clock.tick;

      // The day rolls over: refresh the calendar read and the daily counters.
      if (w.clock.minuteOfDay === 0 || !R.today) {
        R.today = R.calendar.day(w.clock.date);
        state.today = R.today;
        dayLog.births.push(todayCounts.births);
        dayLog.deaths.push(todayCounts.deaths);
        dayLog.leavers.push(todayCounts.leavers);
        dayLog.returners.push(todayCounts.returners);
        for (const k of ['births', 'deaths', 'leavers', 'returners']) {
          if (dayLog[k].length > 365) dayLog[k].shift();
        }
        state.births = { today: todayCounts.births, rolling365: rollingSum(dayLog.births) };
        state.deaths = { today: todayCounts.deaths, rolling365: rollingSum(dayLog.deaths) };
        state.leavers = { today: todayCounts.leavers, rolling365: rollingSum(dayLog.leavers) };
        state.returners = { today: todayCounts.returners, rolling365: rollingSum(dayLog.returners) };
        todayCounts = { births: 0, deaths: 0, leavers: 0, returners: 0 };
      }
      // The aggregate rebuild walks every person, household and dwelling. It runs once a sim-day at
      // ten past midnight rather than on the rollover tick, which already carries the calendar and
      // the counters, because three passes over the island on one tick is a visible hitch.
      if (w.clock.minuteOfDay === 10) refreshAggregates();

      demographyStep(w, tick);
      moveStep(w);

      // The roster is what the UI lists and searches. It refreshes twice a sim-hour, and never on
      // the tick that already carries the daily aggregate rebuild.
      if (tick % 3 === 0 && w.clock.minuteOfDay !== 0) rebuildRoster();
    },

    describe(w) {
      const f = state.fit;
      return {
        residents: state.residents,
        households: state.households,
        dwellings: state.dwellings.total,
        unoccupiedPct: state.dwellings.total ? +(100 * state.dwellings.unoccupied / state.dwellings.total).toFixed(1) : 0,
        holidayHomes: state.dwellings.holidayHomes + state.dwellings.weekenders,
        rentalsFree: R.rentalPool.length,
        medianAge: state.medianAge,
        lonePersonPct: state.composition.lonePerson,
        schoolEnrolments: state.schoolEnrolments,
        studentsCrossing: state.studentsCrossing,
        vacancies: state.vacancyTotal || 0,
        births365: state.births.rolling365,
        deaths365: state.deaths.rolling365,
        leavers365: state.leavers.rolling365,
        returners365: state.returners.rolling365,
        fitResidents: f.residents ? `${f.residents.modelled}/${f.residents.published}` : 'n/a',
        day: state.today ? state.today.iso : null
      };
    },

    save() {
      if (!R.ready) return null;
      return {
        v: 1,
        cursor,
        dayLog,
        people: R.people.map((p) => [p.id, +p.age.toFixed(4), +p.yearsOnIsland.toFixed(3), Math.round(p.x), Math.round(p.z), p.actionId, p.onIsland ? 1 : 0]),
        dwellings: R.dwellings.map((d) => [d.id, d.use, d.householdId || 0])
      };
    },
    load(w, s) {
      if (!s || !R.ready) return;
      cursor = s.cursor || 0;
      for (const [id, age, years, x, z, actionId, on] of s.people || []) {
        const p = R.peopleById.get(id);
        if (!p) continue;
        p.age = age; p.yearsOnIsland = years; p.x = p.tx = x; p.z = p.tz = z;
        p.actionId = actionId; p.onIsland = !!on;
      }
      for (const [id, use, hid] of s.dwellings || []) {
        const d = R.dwellingsById.get(id);
        if (d) { d.use = use; d.householdId = hid || null; }
      }
      R.rentalPool = R.dwellings.filter((d) => d.use === 'vacant');
      R.holidayHomes = R.dwellings.filter((d) => d.use === 'holiday-home' || d.use === 'weekender');
      refreshAggregates();
      rebuildRoster();
    }
  });
}
