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
// WHAT THE 10 AUGUST 2026 PASS ADDED, AND WHY.
// Until that pass this file resolved the holidays and the school blocks and nothing else, and the
// forty-odd named events in data/events.json reached the simulation through exactly one door:
// `eventsToday()` in src/systems/infrastructure/infra-common.js, which reads each record's
// `next_known` window. Every `next_known` in the pack is a 2026 date, and eleven of the records
// have none at all, so the weekly and monthly ones had never once fired and every dated one went
// dark on 1 January 2027. Measured on the shipped build: 16 to 18 October 2026 is the island's
// biggest surfing weekend and the visitor model showed 1,027 people on the Friday, the lowest
// figure in a seventy-five day run and lower than the ordinary Thursday before it.
//
// So the occurrence resolver moved here, beside the school terms, because this is the file every
// consumer already imports. `day(date)` now carries the events running that day, resolved from
// each record's own `date_rule` in any year, and `src/systems/agents/events.js` publishes them as
// a read model the rest of the island can act on. The panel resolves nothing of its own any more:
// it imports `occurrencesOf` from here, so what a player reads and what the island does come from
// one piece of arithmetic.
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

/* ================================================================== the named events

   One resolver, used by the simulation and by the calendar board, so the date a player reads is
   the date the island runs. Everything below works in epoch day numbers rather than Date objects,
   because a calendar is integer arithmetic and Dates are where time zones get in.
*/

const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

export const edOf = (y, m0, d) => Math.floor(Date.UTC(y, m0, d) / DAY_MS);
export const dowOfDay = (e) => (((e + 4) % 7) + 7) % 7;
export const yearOfDay = (e) => new Date(e * DAY_MS).getUTCFullYear();
export const isoOfDay = (e) => iso(new Date(e * DAY_MS));
export const parseISODay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? edOf(+m[1], +m[2] - 1, +m[3]) : null;
};

/** Easter Sunday as a day number. Same computus as above, in the units the resolver uses. */
function easterDay(y) {
  const d = easterSunday(y);
  return dayNum(d);
}

/** The nth given weekday of a month, as a day number, or null when the month has no nth. */
function nthWeekdayDay(year, month1, weekdayName, nth) {
  const m0 = (month1 || 1) - 1;
  const first = edOf(year, m0, 1);
  const want = WD[weekdayName] ?? 0;
  let e = first + (((want - dowOfDay(first)) % 7) + 7) % 7;
  e += ((nth || 1) - 1) * 7;
  return new Date(e * DAY_MS).getUTCMonth() === m0 ? e : null;
}

/**
 * The window an `annual_window` record falls inside, for one year, in day numbers.
 *
 * WHY THIS KIND EXISTS. Some events happen every year and the organiser announces the dates, and
 * the published dates fit no weekday rule at all. The Quandamooka Festival is the one this was
 * written for: 30 and 31 August 2024, 13 and 14 September 2025, and two disagreeing public listings
 * for 2026. Under `irregular` it resolved for one weekend of one year and then never again, so on
 * the default 19 September 2026 start the island's largest event had already happened and the board
 * filed it under having no date at all. Under a made-up `nth_weekday` it would be a date nobody
 * announced, printed as though somebody had.
 *
 * So this returns the window and never a date inside it. `occurrencesOf` still resolves the sourced
 * date for the year a listing exists for, and nothing else. The board shows the window and says the
 * dates have not been announced, which is the true sentence.
 */
export function annualWindowOf(rec, year) {
  const rule = (rec && rec.date_rule) || {};
  if (rule.kind !== 'annual_window') return null;
  const a = rule.window_start || {};
  const b = rule.window_end || {};
  const start = edOf(year, (a.month || 1) - 1, a.day || 1);
  // A window that crosses new year ends in the following year.
  const endYear = (b.month || 12) < (a.month || 1) ? year + 1 : year;
  const end = edOf(endYear, (b.month || 12) - 1, b.day || 31);
  return { start, end, days: Math.max(1, rule.duration_days || 1) };
}

/**
 * Every occurrence of one event record inside a window, in day numbers.
 *
 * A sourced `next_known` is kept as well as the pattern and flagged, because the pack's own
 * honesty block says island dates move and `next_known` is a snapshot rather than a rule. Where
 * the two land within three days of each other the sourced one wins, so a published 2026 date does
 * not draw the same festival twice.
 *
 * `irregular` resolves to the sourced date and nothing else, on purpose. An event whose recurrence
 * nobody publishes does not get a date invented for it.
 */
export function occurrencesOf(rec, from, to) {
  const out = [];
  const rule = (rec && rec.date_rule) || {};
  const dur = Math.max(1, rule.duration_days || 1);
  // The tolerance is against a sourced date only. A published 2026 date three days off the pattern
  // is the same festival and must not be drawn twice; a Friday and a Sunday from a `weekdays` rule
  // are two different nights at the same pub and both happen.
  const push = (start, sourced) => {
    if (start == null) return;
    const end = start + dur - 1;
    if (end < from || start > to) return;
    if (out.some((o) => (o.sourced ? Math.abs(o.start - start) <= 3 : o.start === start))) return;
    out.push({ start, end, sourced: !!sourced });
  };

  const nk = rec && rec.next_known;
  if (nk && nk.start) {
    const s = parseISODay(nk.start);
    const e = parseISODay(nk.end) ?? s;
    if (s != null && e != null && e >= from && s <= to) out.push({ start: s, end: e, sourced: true, confidence: nk.confidence });
  }

  const y0 = yearOfDay(from);
  const y1 = yearOfDay(to);

  switch (rule.kind) {
    case 'fixed':
      for (let y = y0 - 1; y <= y1 + 1; y++) push(edOf(y, (rule.month || 1) - 1, rule.day || 1));
      break;
    case 'nth_weekday':
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const e = nthWeekdayDay(y, rule.month, rule.weekday, rule.nth);
        push(e == null ? null : e + (rule.offset_days || 0));
      }
      break;
    case 'last_weekday':
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const m0 = (rule.month || 1) - 1;
        let e = edOf(y, m0 + 1, 1) - 1;
        const want = WD[rule.weekday] ?? 0;
        e -= (((dowOfDay(e) - want) % 7) + 7) % 7;
        push(e);
      }
      break;
    case 'moveable':
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const anchor = String(rule.anchor || '');
        if (/easter/i.test(anchor)) {
          const es = easterDay(y);
          if (/good friday/i.test(anchor)) push(es - 2);
          else push(es + (rule.offset_days || 0));
        } else if (/first sunday in july/i.test(anchor)) {
          push(nthWeekdayDay(y, 7, 'sunday', 1));
        } else if (/first monday in may/i.test(anchor)) {
          push(nthWeekdayDay(y, 5, 'monday', 1));
        }
      }
      break;
    case 'weekly': {
      // `weekdays` carries a venue that runs the same night twice a week, which is how the pub and
      // the clubs on this island actually publish themselves: live music Friday and Sunday, not
      // two separate events with two separate names.
      const names = Array.isArray(rule.weekdays) && rule.weekdays.length ? rule.weekdays : [rule.weekday];
      for (const name of names) {
        const want = WD[name];
        if (want == null) continue;
        let e = from + (((want - dowOfDay(from)) % 7) + 7) % 7;
        for (; e <= to; e += 7) {
          if (rule.season_months && !rule.season_months.includes(new Date(e * DAY_MS).getUTCMonth() + 1)) continue;
          push(e);
        }
      }
      break;
    }
    case 'fortnightly': {
      const want = WD[rule.weekday];
      if (want == null) break;
      // No anchor date is published, so the phase is pinned to the first matching weekday of the
      // year the window starts in. The record itself says its published date list goes stale
      // faster than anything else in the pack.
      let anchor = edOf(yearOfDay(from), 0, 1);
      anchor += (((want - dowOfDay(anchor)) % 7) + 7) % 7;
      let e = anchor + Math.ceil((from - anchor) / 14) * 14;
      for (; e <= to; e += 14) push(e);
      break;
    }
    case 'monthly': {
      if (rule.weekday == null || rule.nth == null) break;
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        for (let m = 1; m <= 12; m++) {
          if (rule.season_months && !rule.season_months.includes(m)) continue;
          push(nthWeekdayDay(y, m, rule.weekday, rule.nth));
        }
      }
      break;
    }
    case 'season':
      for (let y = y0 - 2; y <= y1 + 1; y++) {
        const s = edOf(y, (rule.start_month || 1) - 1, rule.start_day || 1);
        const endYear = (rule.end_month || 1) < (rule.start_month || 1) ? y + 1 : y;
        const e = edOf(endYear, (rule.end_month || 1) - 1, rule.end_day || 1);
        if (e >= from && s <= to && !out.some((o) => Math.abs(o.start - s) <= 3)) out.push({ start: s, end: e, sourced: false });
      }
      break;
    case 'annual_window':
      // Deliberately nothing. The window is real and `annualWindowOf` returns it; a date inside it
      // is the organiser's to announce and is not this pack's to invent. The sourced `next_known`
      // above is the only dated occurrence an annual_window record ever has.
      break;
    default:
      break;   // irregular: the sourced date, or nothing, which is the honest answer
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Which township carries a place list. An unmatched event is island-wide, never invented into a town. */
export function townshipOfPlaces(ids) {
  for (const id of ids || []) {
    if (/^(dunwich|one-mile|goompi|ron-stark|little-ship|myora|brown-lake|nsi-golf)/.test(id)) return 'dunwich';
    if (/point-lookout|cylinder|home-beach|deadmans|frenchmans|main-beach|gorge|adder|headland|mooloomba/.test(id)) return 'point-lookout';
    if (/amity|flinders/.test(id)) return 'amity-point';
  }
  return 'island-wide';
}

/**
 * How much of an event's on-site crowd would not have been on the island that day.
 *
 * A MODELLING ASSUMPTION, and it is in the pack rather than in this code so it can be argued with.
 * A day tripper at the Point Lookout markets on a school-holiday Sunday was probably coming
 * anyway; a boardrider from Lennox Head at the October teams event was not. The table lives at
 * `sim_defaults.event_visitor_increment.by_archetype` in data/events.json and the default here is
 * only what happens when a record names an archetype the table does not cover.
 */
export function incrementShare(rec, table, dayOfEvent = 1) {
  // A category override wins outright, and one category uses it: `seasonal-peak`. Christmas, Easter
  // and New Year are already the school holiday and long weekend load multipliers that the visitor
  // model has applied since it was written. Counting them a second time as events would put
  // several thousand phantom people on the island every day from 12 December to 26 January.
  const byCat = (table && table.by_category) || {};
  const cat = rec && rec.category;
  if (cat && byCat[cat] != null) return byCat[cat];

  const mix = (rec && rec.archetype_mix) || null;
  const fallback = (table && table.default_when_no_mix != null) ? table.default_when_no_mix : 0.5;
  if (!mix) return fallback;
  const by = (table && table.by_archetype) || {};
  // Somebody who sleeps here for a three-day festival is one arrival and three days of crowd. On
  // the second and third days they are already on the island, so counting them again would triple
  // the boat load of every multi-day event in the pack. Day visitors are a fresh crossing each day
  // and are counted each day. The list of who sleeps over is in the pack, not here.
  const stays = (table && table.stays_overnight) || [];
  let sum = 0;
  for (const k of Object.keys(mix)) {
    if (dayOfEvent > 1 && stays.includes(k)) continue;
    sum += (mix[k] || 0) * (by[k] != null ? by[k] : fallback);
  }
  return sum;
}

/** The event's own share of its peak that is on site at a given hour, from its published curve. */
export function curveAt(curve, minuteOfDay) {
  if (!curve || !curve.length) return 0;
  const h = Math.max(0, Math.min(1439, minuteOfDay)) / 60;
  const i = Math.floor(h);
  const a = curve[i % 24] || 0;
  const b = curve[(i + 1) % 24] || 0;
  const t = h - i;
  return a + (b - a) * t;
}

export function makeCalendar(eventsPack) {
  const cache = new Map();      // year -> derived tables
  const dayCache = new Map();   // dayNum -> info
  const eventYears = new Map(); // year -> Map(dayNum -> entry[])
  const mismatches = [];

  /* ---------------------------------------------------------------- events */

  const packEvents = (eventsPack && Array.isArray(eventsPack.events)) ? eventsPack.events : [];
  const incrementTable = (eventsPack && eventsPack.sim_defaults && eventsPack.sim_defaults.event_visitor_increment) || null;

  /**
   * Which records drive the island. `ended` is excluded because it no longer happens here, and
   * anything at low confidence is excluded because `no-low-confidence-to-player` in data/lore.json
   * is blocking and a crowd on a beach is about as player-facing as this project gets. Both are
   * counted rather than silently dropped, so the board can say how many records are being held.
   */
  const live = [];
  let heldEnded = 0, heldLowConfidence = 0;
  for (const rec of packEvents) {
    if (!rec || !rec.id) continue;
    if (rec.status === 'ended') { heldEnded++; continue; }
    if (rec.confidence === 'low') { heldLowConfidence++; continue; }
    live.push(rec);
  }
  live.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  function buildEventYear(year) {
    const map = new Map();
    const from = edOf(year, 0, 1);
    const to = edOf(year, 11, 31);
    for (const rec of live) {
      const occ = occurrencesOf(rec, from - 40, to + 40);
      const peak = (rec.attendance && (rec.attendance.typical || rec.attendance.low)) || 0;
      const township = townshipOfPlaces(rec.place_ids);
      const curve = (rec.crowd_curve && rec.crowd_curve.hours) || null;
      for (const o of occ) {
        const days = o.end - o.start + 1;
        for (let d = o.start; d <= o.end; d++) {
          if (d < from || d > to) continue;
          let list = map.get(d);
          if (!list) { list = []; map.set(d, list); }
          list.push({
            rec,
            id: rec.id,
            name: rec.name,
            category: rec.category || 'event',
            status: rec.status || 'current',
            confidence: rec.confidence || null,
            township,
            placeIds: rec.place_ids || [],
            peak,
            incrementShare: incrementShare(rec, incrementTable, d - o.start + 1),
            curve,
            start: o.start,
            end: o.end,
            days,
            dayOfEvent: d - o.start + 1,
            sourcedDate: !!o.sourced,
            culturalLoadOnly: !!rec.cultural_handling
          });
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => (b.peak - a.peak) || (a.id < b.id ? -1 : 1));
    eventYears.set(year, map);
    return map;
  }

  function eventsOnDayNum(n) {
    const y = yearOfDay(n);
    let map = eventYears.get(y);
    if (!map) map = buildEventYear(y);
    if (eventYears.size > 6) {
      // Keep the working set small on a long run without ever dropping the year being asked for.
      for (const k of eventYears.keys()) { if (k !== y) { eventYears.delete(k); break; } }
    }
    return map.get(n) || [];
  }

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

    const events = eventsOnDayNum(n);
    let eventPeak = 0, eventIncrement = 0;
    for (const e of events) {
      eventPeak += e.peak;
      eventIncrement += e.peak * e.incrementShare;
    }

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
      // What is on. `events` is the live list for this day; `eventPeak` is the pack's own estimate
      // of people on site at the busiest moment, summed, before weather; `eventIncrement` is how
      // many of those would not otherwise have been on the island, which is the number the visitor
      // model needs and the only one of the three that must not be double counted.
      events,
      eventPeak,
      eventIncrement,
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

    /* --- events ------------------------------------------------------- */
    /** Live records only: the board asks the pack directly when it wants the ended ones too. */
    liveEvents: () => live,
    held: { ended: heldEnded, lowConfidence: heldLowConfidence },
    incrementTable,
    eventsOnDay: eventsOnDayNum,
    /** Every occurrence of every live record between two day numbers, soonest first. */
    eventsAhead(fromDay, days) {
      const out = [];
      for (const rec of live) {
        for (const o of occurrencesOf(rec, fromDay, fromDay + days)) {
          if (o.end < fromDay) continue;
          out.push({ rec, id: rec.id, name: rec.name, category: rec.category, start: o.start, end: o.end,
            sourced: !!o.sourced, in: o.start - fromDay,
            peak: (rec.attendance && rec.attendance.typical) || 0 });
        }
      }
      out.sort((a, b) => (a.start - b.start) || (b.peak - a.peak) || (a.id < b.id ? -1 : 1));
      return out;
    },
    /**
     * Annual events whose dates the organiser announces, for the years a listing does not cover.
     *
     * Returns one entry per year the window touches, and skips a year that already has a sourced
     * date, so the board never shows "somewhere in this window" beside a published weekend for the
     * same year. The `lastPublished` field carries the most recent dated occurrence, because "it was
     * on this weekend last year" is the most useful true thing that can be said about a date nobody
     * has announced yet.
     */
    annualWindowsAhead(fromDay, days) {
      const out = [];
      const to = fromDay + days;
      for (const rec of live) {
        if (!rec.date_rule || rec.date_rule.kind !== 'annual_window') continue;
        const dated = occurrencesOf(rec, fromDay - 400, to + 400);
        for (let y = yearOfDay(fromDay); y <= yearOfDay(to); y++) {
          const w = annualWindowOf(rec, y);
          if (!w || w.end < fromDay || w.start > to) continue;
          if (dated.some((o) => o.sourced && o.start >= w.start - 10 && o.start <= w.end + 10)) continue;
          const past = dated.filter((o) => o.sourced && o.end < fromDay).sort((a, b) => b.start - a.start)[0] || null;
          out.push({
            rec, id: rec.id, name: rec.name, year: y,
            start: w.start, end: w.end, days: w.days,
            in: w.start - fromDay,
            lastPublished: past ? { start: past.start, end: past.end } : null,
            peak: (rec.attendance && rec.attendance.typical) || 0
          });
        }
      }
      out.sort((a, b) => (a.start - b.start) || (a.id < b.id ? -1 : 1));
      return out;
    },
    /**
     * What has just been on. An islander's calendar sense is not only forward: on a small island the
     * thing everybody is still talking about matters as much as the thing coming up, and the default
     * playthrough opens six days after the largest event of the year.
     */
    eventsJustGone(beforeDay, days) {
      const out = [];
      for (const rec of live) {
        for (const o of occurrencesOf(rec, beforeDay - days, beforeDay - 1)) {
          if (o.end >= beforeDay || o.end < beforeDay - days) continue;
          out.push({ rec, id: rec.id, name: rec.name, category: rec.category,
            start: o.start, end: o.end, sourced: !!o.sourced, ago: beforeDay - o.end,
            peak: (rec.attendance && rec.attendance.typical) || 0 });
        }
      }
      out.sort((a, b) => (a.ago - b.ago) || (b.peak - a.peak) || (a.id < b.id ? -1 : 1));
      return out;
    },
    /** The pack's own modelled draw over a year, used to keep the annual visitor total honest. */
    eventIncrementOverYear(fromDay) {
      let sum = 0;
      for (let d = 0; d < 365; d++) {
        for (const e of eventsOnDayNum(fromDay + d)) sum += e.peak * e.incrementShare;
      }
      return sum;
    },

    describe() {
      return {
        checkedAgainst: ref ? 'data/events.json reference_2026' : 'no events pack',
        mismatches: mismatches.length,
        liveRecords: live.length,
        heldEnded,
        heldLowConfidence
      };
    }
  };
}
