// The island calendar. NOT a system: a pure helper the five agent systems each import, so that
// population, schedule and visitors all agree on what day it is without reading each other.
// It exports no `registerXxx`, so the manifest loader will never register it.
//
// Why this exists at all: on Minjerribah the single best predictor of load is the Queensland state
// school calendar, and after that the long weekends. data/events.json says so in its own words, and
// it publishes the 2026 dates. The simulation has to run past 2026, so this module derives later
// years from the published rules rather than repeating the 2026 dates and hoping.
//
// Every derivation below is checked against the published 2026 list at init. If a derived date
// disagrees with the pack, the mismatch is reported in the read model rather than being smoothed
// over, because a wrong Easter is exactly the sort of thing this island would notice.
//
// Sources, all carried in data/events.json reference_2026:
//   public holidays  https://www.fairwork.gov.au/employment-conditions/public-holidays/2026-public-holidays
//   school terms     https://education.qld.gov.au/about-us/calendar/term-dates
//   surf patrol      https://pointlookoutslsc.com.au/about-the-club/
//   whale season     https://stradbrokeisland.com/whale-watching-on-redlands-coast/

const DAY_MS = 86400000;

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const dayNum = (d) => Math.floor(d.getTime() / DAY_MS);
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

/** Anonymous Gregorian computus. Easter Sunday is arithmetic, not an assertion about this island. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month - 1, day);
}

/** nth (1-based) given weekday of a month. Labour Day and the King's Birthday are both first Mondays. */
function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1);
  let offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/**
 * Queensland moves New Year's Day and Australia Day to the following Monday when they land on a
 * weekend. Anzac Day and Boxing Day do not move: data/events.json notes Anzac Day 2026 falls on a
 * Saturday with no substitute, and its published 2026 list carries Boxing Day on Saturday 26
 * December as itself. Christmas Day is handled separately for the same reason.
 */
function substituted(d) {
  const w = d.getUTCDay();
  if (w === 6) return addDays(d, 2);
  if (w === 0) return addDays(d, 1);
  return d;
}

function publicHolidaysFor(year) {
  const easter = easterSunday(year);
  const out = [];
  const add = (date, name) => out.push({ date, iso: iso(date), name });
  add(substituted(utc(year, 0, 1)), "New Year's Day");
  add(substituted(utc(year, 0, 26)), 'Australia Day');
  add(addDays(easter, -2), 'Good Friday');
  add(addDays(easter, -1), 'The day after Good Friday');
  add(easter, 'Easter Sunday');
  add(addDays(easter, 1), 'Easter Monday');
  add(utc(year, 3, 25), 'Anzac Day');           // Queensland adds no substitute day
  add(nthWeekday(year, 4, 1, 1), 'Labour Day');  // first Monday in May
  add(nthWeekday(year, 9, 1, 1), "King's Birthday"); // first Monday in October
  add(utc(year, 11, 25), 'Christmas Day');
  add(utc(year, 11, 26), 'Boxing Day');
  // When Christmas Day lands on a weekend Queensland adds 27 December rather than moving the day
  // itself. The pack's 2026 list keeps 25 and 26 December where they fall, so this only ever adds.
  const xmasDow = utc(year, 11, 25).getUTCDay();
  if (xmasDow === 0 || xmasDow === 6) add(utc(year, 11, 27), 'Additional Christmas holiday');
  return out;
}

/**
 * The four Queensland school holiday blocks, derived from published anchors:
 *   autumn  Good Friday through Good Friday plus 16 days   (2026: 3 to 19 April, matches the pack)
 *   winter  the last Saturday of June plus 15 days          (2026: 27 June to 12 July, matches)
 *   spring  the Saturday 16 days before the King's Birthday (2026: 19 September to 5 October, matches)
 *   summer  the second Saturday of December to 26 January   (2026: 12 December to 26 January, matches)
 * Load multipliers are the published estimates from data/events.json periods.school-holidays.
 */
function schoolHolidaysFor(year) {
  const gf = addDays(easterSunday(year), -2);
  const autumn = { start: gf, end: addDays(gf, 16), label: 'autumn', load: 2.8 };

  let lastSatJune = utc(year, 5, 30);
  while (lastSatJune.getUTCDay() !== 6) lastSatJune = addDays(lastSatJune, -1);
  const winter = { start: lastSatJune, end: addDays(lastSatJune, 15), label: 'winter', load: 2.2 };

  const kings = nthWeekday(year, 9, 1, 1);
  const spring = { start: addDays(kings, -16), end: kings, label: 'spring', load: 2.4 };

  let secondSatDec = utc(year, 11, 1);
  while (secondSatDec.getUTCDay() !== 6) secondSatDec = addDays(secondSatDec, 1);
  secondSatDec = addDays(secondSatDec, 7);
  const summer = { start: secondSatDec, end: utc(year + 1, 0, 26), label: 'summer', load: 3.5 };

  return [autumn, winter, spring, summer];
}

/** A three or four day break built off a Friday or Monday public holiday. Easter is the four day one. */
function longWeekendsFor(year) {
  const hols = publicHolidaysFor(year);
  const out = [];
  const easter = easterSunday(year);
  out.push({ start: addDays(easter, -2), end: addDays(easter, 1), anchor: 'Easter, four days', load: 3.2 });
  for (const h of hols) {
    if (/Easter|Good Friday|day after Good Friday/.test(h.name)) continue;
    // Christmas, Boxing Day and New Year sit inside the summer school block, which already carries
    // a heavier load multiplier, and the pack's published long_weekends list leaves them out.
    if (/Christmas|Boxing|New Year/.test(h.name)) continue;
    const w = h.date.getUTCDay();
    if (w === 1) out.push({ start: addDays(h.date, -2), end: h.date, anchor: h.name, load: h.name === 'Australia Day' ? 2.6 : 2.4 });
    else if (w === 5) out.push({ start: h.date, end: addDays(h.date, 2), anchor: h.name, load: 2.4 });
  }
  return out;
}

const within = (d, a, b) => d >= dayNum(a) && d <= dayNum(b);

export function makeCalendar(eventsPack) {
  const cache = new Map();      // year -> derived tables
  const dayCache = new Map();   // dayNum -> info
  const mismatches = [];

  function tables(year) {
    let t = cache.get(year);
    if (!t) {
      t = {
        holidays: publicHolidaysFor(year),
        school: schoolHolidaysFor(year),
        longWeekends: longWeekendsFor(year)
      };
      cache.set(year, t);
    }
    return t;
  }

  // Check the derivations against the published 2026 lists once, and keep whatever disagrees.
  const ref = eventsPack && eventsPack.reference_2026;
  if (ref) {
    const derived = new Set(tables(2026).holidays.map((h) => h.iso));
    for (const h of ref.queensland_public_holidays || []) {
      if (!derived.has(h.date)) mismatches.push(`public holiday ${h.date} ${h.name} is published but not derived`);
    }
    const pubSchool = ref.queensland_state_school_holidays || [];
    for (const block of tables(2026).school) {
      const match = pubSchool.find((p) => p.label === block.label);
      if (!match) continue;
      if (match.start !== iso(block.start)) mismatches.push(`${block.label} break starts ${iso(block.start)} derived, ${match.start} published`);
      if (match.end !== iso(block.end)) mismatches.push(`${block.label} break ends ${iso(block.end)} derived, ${match.end} published`);
    }
  }

  /**
   * Everything the agent systems need to know about one day. Cached per day, so the eight or nine
   * systems that ask for it during a tick pay for it once.
   */
  function day(date) {
    const n = dayNum(date);
    let info = dayCache.get(n);
    if (info) return info;
    if (dayCache.size > 800) dayCache.clear();

    const y = date.getUTCFullYear();
    const t = tables(y);
    const tPrev = tables(y - 1); // December school break runs into January

    const hol = t.holidays.find((h) => dayNum(h.date) === n) || null;

    let block = null;
    for (const b of t.school.concat(tPrev.school)) if (within(n, b.start, b.end)) { block = b; break; }

    let lw = null;
    for (const w of t.longWeekends.concat(tPrev.longWeekends)) if (within(n, w.start, w.end)) { lw = w; break; }

    const month = date.getUTCMonth();
    const dom = date.getUTCDate();
    const dow = date.getUTCDay();

    // Whale season. June to November, with the published northward peak in July and the southward
    // peak with calves in October. Multipliers are the estimates in data/events.json.
    let whale = 0;
    if (month >= 5 && month <= 10) whale = 1.4;
    if (month === 6) whale = 1.8;
    if (month === 9) whale = 1.7;

    // Surf patrol season, in the club's own published words: from the first weekend of the September
    // school holidays until the first weekend in May, weekends and public holidays only.
    const springBreak = t.school.find((b) => b.label === 'spring');
    const firstMayWeekend = (() => {
      let d = utc(y, 4, 1);
      while (d.getUTCDay() !== 6) d = addDays(d, 1);
      return d;
    })();
    const inPatrolWindow = n >= dayNum(springBreak.start) || n <= dayNum(addDays(firstMayWeekend, 1));
    const patrolled = inPatrolWindow && (dow === 0 || dow === 6 || !!hol);

    // The visitor load multiplier a day carries. Blocks and long weekends do not multiply each
    // other: the bigger of the two wins, which is what the events pack means when it says a long
    // weekend inside the summer holidays "stacks on an already high base".
    let load = 1;
    if (block) load = block.load;
    if (lw && lw.load > load) load = lw.load;

    info = {
      iso: iso(date),
      dayNum: n,
      dow,
      isWeekend: dow === 0 || dow === 6,
      isPublicHoliday: !!hol,
      holidayName: hol ? hol.name : null,
      isSchoolHoliday: !!block,
      schoolBlock: block ? block.label : null,
      isTermTime: !block,
      isLongWeekend: !!lw,
      longWeekendAnchor: lw ? lw.anchor : null,
      // Where in the block this day sits, one-based. A long weekend is not a plateau: everybody
      // arrives on the Friday afternoon and leaves on the Monday, and the events pack says so.
      longWeekendDay: lw ? n - dayNum(lw.start) + 1 : 0,
      longWeekendLength: lw ? dayNum(lw.end) - dayNum(lw.start) + 1 : 0,
      whaleMultiplier: whale,
      isWhaleSeason: whale > 0,
      isPatrolDay: patrolled,
      loadMultiplier: load,
      // The Australian summer shutdown: the island's builders lose December and January because
      // the owners are in the houses. data/residents.json occupations.island-builder-carpenter.
      isBuilderShutdown: (month === 11 && dom >= 18) || (month === 0 && dom <= 20),
      basis: y === 2026 ? 'published for 2026' : 'derived from the published Queensland rules'
    };
    dayCache.set(n, info);
    return info;
  }

  return {
    day,
    mismatches,
    holidaysFor: (y) => tables(y).holidays,
    schoolHolidaysFor: (y) => tables(y).school,
    describe() {
      return { checkedAgainst: ref ? 'data/events.json reference_2026' : 'no events pack', mismatches: mismatches.length };
    }
  };
}
