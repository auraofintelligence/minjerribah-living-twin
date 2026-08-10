// When a place is actually open, and how much of that anybody published.
//
// WHY THIS IS ITS OWN FILE
//   `data/businesses.json` used to carry one flat week per business with a `basis` of `estimate` on
//   ninety-two of a hundred and one records, and the simulation reported "34 open now" as though it
//   were a fact. On this island the exceptions are the rule: the pub's kitchen shuts two hours
//   before its bar, the brewery is dark on a Tuesday and a Wednesday, the surf club opens Friday to
//   Sunday and then every day of the school holidays, the bowls club closes Mondays and the pharmacy
//   publishes its own Easter hours. A single 'HH:MM-HH:MM' per weekday cannot hold any of that, so
//   this module holds the shape and `data/businesses.json` holds the facts.
//
// THE FOUR THINGS A DAY'S HOURS CAN BE, AND THE WORD FOR EACH
//   published   the business itself published them: its own site, its own page. Traceable to an
//               operator URL and a date somebody checked it.
//   listed      somebody else published them: a council listing, a tourism body, an island
//               directory. Real, citable, and one step further from the kitchen. It goes stale
//               without anybody telling it: the directory this pack draws on still lists a seafood
//               shop that closed and a tavern under its previous name.
//   estimate    nobody published them. A plausible island pattern for the simulation to run on and
//               never a claim about a real street. `data/businesses.json` has said so in its own
//               `honesty` block since the pack was written, and the interface must keep saying it.
//   none        nobody published them and the pack carries no guess either. Seven unverified days
//               and no week at all. This is not a fourth confidence rating, it is the difference
//               between a guess and a blank, and the blank is the honest answer for a body that
//               was never going to have trading hours.
//
//   Every hours block carries its basis, the URL it came from, the date it was checked and its own
//   confidence, and all four travel to the read model and out to the inspector. "The bakery is
//   open" is only ever as true as the last time somebody looked.
//
// WHAT IS PUBLISHED HERE AND WHAT IS MODELLED
//   Published or listed: the weekly pattern, the kitchen's own hours where they differ, the
//   school-holiday and Easter variants where a business publishes one, and the public holiday rule
//   where a business states one.
//   Modelled, and labelled modelled everywhere it surfaces: what happens when the swell is up, when
//   the wind is on the vans at Cylinder, when the beach is shut to vehicles, and when the barge did
//   not run and the cold room is empty. No source on this island publishes any of that, so it is
//   arithmetic over things the twin already knows and never a quoted fact.
//
// No Babylon, no clock, no randomness. Pure functions over a compiled record.

/* ------------------------------------------------------------------ vocabulary */

/** The four words a basis may hold. A fifth would be a second confidence scale by another name. */
export const HOURS_BASIS = ['published', 'listed', 'estimate', 'none'];

/** Who published it. `none` is the honest answer for an estimate. */
export const HOURS_SOURCE_KIND = ['operator', 'directory', 'government', 'none'];

/**
 * WHAT KIND OF THING THIS IS, WHICH DECIDES WHETHER "OPEN OR SHUT" IS EVEN A QUESTION.
 *
 * A critic put it plainly: a card reading SHUT over the Minjerribah Moorgumpin Elders-in-Council is
 * the twin describing how that organisation runs, and describing how it runs is exactly the thing
 * this project is not allowed to do. The fault was not the roster underneath it. The fault was
 * asking the question at all. A Traditional Owner corporation, an Elders' council, an ambulance
 * station, a hall and a ferry line are not shops, and the honest answer to "is it open" for each of
 * them is that it is the wrong question.
 *
 *   shopfront      a counter the public is served at on hours. The twin answers open or shut.
 *   organisation   a workplace or a body rather than a counter. The twin never answers open or
 *                  shut, whether or not the body publishes office hours. Where it does publish
 *                  them they are carried exactly as published and shown as office hours, which is
 *                  what they are, and nothing is computed from them.
 *   on-call        staffed or answering a callout rather than open: the ambulance stations, the
 *                  rural fire brigade, marine rescue, wildlife rescue, the mobile vet. An
 *                  ambulance station that reads SHUT at two in the morning is a lie with
 *                  consequences.
 *   by-timetable   it runs rather than opens: the ferries, the water taxi, the buses, the cabs.
 *                  The twin already holds the timetables in ferry.js and transport.js, so a second
 *                  and worse answer here would only be the twin arguing with itself.
 *
 * A record with no posture is a shopfront. That is the common case and the pack should not have to
 * say so ninety-odd times.
 */
export const HOURS_POSTURE = ['shopfront', 'organisation', 'on-call', 'by-timetable'];

/** The postures that are never asked the open-or-shut question. */
const NOT_A_SHOPFRONT = new Set(['organisation', 'on-call', 'by-timetable']);

/** One plain sentence for each, said on the card in place of an open or shut sign. */
const POSTURE_LINE = {
  organisation: 'This is an organisation with a workplace, not a shop with a counter, so the twin does '
    + 'not put an open or shut sign on it.',
  'on-call': 'This one is staffed or on call rather than open, so the twin does not put an open or shut '
    + 'sign on it.',
  'by-timetable': 'This one runs to a timetable rather than to opening hours, and the timetable is held '
    + 'elsewhere in the twin rather than guessed at here.'
};

export const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "10am until late" is what the public bar publishes, and "Open from 11am, lunch and dinner" is
 * what the surf club publishes. Both are real published wordings with no closing time in them.
 * The word is carried through to the player as the word; this is only what the simulation has to
 * do with it, and it is declared rather than buried: a licensed venue trading "late" is modelled as
 * trading to midnight, which is ordinary Queensland licensed hours and is also what the earlier
 * researched estimate for the pub already assumed.
 */
export const LATE_CLOSE_MIN = 24 * 60;

/** Which variant wins when a day answers to more than one. Most specific first. */
const VARIANT_PRIORITY = [
  'easter',
  'public-holiday',
  'summer-school-holidays',
  'school-holidays',
  'long-weekend',
  'weekends',
  'winter'
];

/* ------------------------------------------------------------------ parsing */

/** 'HH:MM' to minutes past midnight. Null on anything that is not a time. */
export function mins(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const fmt = (m) => {
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * One weekday's entry into a list of trading windows.
 *
 * Accepts 'closed', '24h', 'unverified', 'HH:MM-HH:MM', 'HH:MM-late', and any comma-separated
 * run of those, which is how a split day is written: the pub's kitchen does
 * '11:30-14:30,17:00-20:30' on a Monday and one window cannot say that. A close at or before the
 * open is read as running past midnight, so '11:00-00:00' is thirteen hours and not zero.
 */
export function parseDay(entry) {
  const raw = String(entry == null ? '' : entry).trim().toLowerCase();
  if (!raw || raw === 'closed') return { kind: 'closed', windows: [], late: false };
  if (raw === '24h') return { kind: '24h', windows: [{ open: 0, close: 1440 }], late: false };
  if (raw === 'unverified') return { kind: 'unverified', windows: [], late: false };

  const windows = [];
  let late = false;
  for (const part of raw.split(',')) {
    const bits = part.trim().split('-');
    if (bits.length !== 2) continue;
    const open = mins(bits[0]);
    if (open == null) continue;
    let close;
    if (bits[1].trim() === 'late') { close = LATE_CLOSE_MIN; late = true; } else close = mins(bits[1]);
    if (close == null) continue;
    windows.push({ open, close: close <= open ? close + 1440 : close });
  }
  if (!windows.length) return { kind: 'unverified', windows: [], late: false };
  windows.sort((a, b) => a.open - b.open);
  return { kind: 'open', windows, late };
}

/** Seven parsed days out of an object carrying mon..sun. */
function parseWeek(obj) {
  const days = [];
  for (let d = 0; d < 7; d++) days.push(parseDay(obj ? obj[DOW_KEYS[d]] : null));
  return days;
}

/** Hours a week, for the wage bill and for the roster. Counts every window on every day. */
export function weeklyHours(days) {
  let total = 0;
  for (const d of days) for (const w of d.windows) total += (w.close - w.open) / 60;
  return total;
}

function parseSub(block, fallbackBasis) {
  if (!block) return null;
  return {
    basis: block.basis || fallbackBasis,
    sourceKind: block.source_kind || null,
    source: block.source || null,
    checked: block.checked || null,
    note: block.note || null,
    days: parseWeek(block)
  };
}

/**
 * Compile a pack record's `typical_hours` once, at build time. Everything downstream reads the
 * compiled form, so nothing in a tick parses a string.
 *
 * `posture` is the record's `hours_posture`, defaulting to `shopfront`. It decides one thing and it
 * is the important one: whether anything downstream is allowed to answer open or shut.
 */
export function compileHours(typical, posture) {
  const t = typical || {};
  const days = parseWeek(t);
  const variants = [];
  for (const v of t.variants || []) {
    variants.push({
      id: v.id || 'variant',
      applies: Array.isArray(v.applies) ? v.applies.slice() : [],
      basis: v.basis || t.basis || 'estimate',
      source: v.source || t.source || null,
      sourceKind: v.source_kind || t.source_kind || null,
      checked: v.checked || t.checked || null,
      note: v.note || null,
      days: parseWeek(v),
      kitchen: v.kitchen ? parseWeek(v.kitchen) : null
    });
  }
  // Most specific first, so the first match wins and the search is a short walk.
  variants.sort((a, b) => {
    const ra = Math.min(...a.applies.map((x) => {
      const i = VARIANT_PRIORITY.indexOf(x);
      return i < 0 ? 99 : i;
    }).concat([99]));
    const rb = Math.min(...b.applies.map((x) => {
      const i = VARIANT_PRIORITY.indexOf(x);
      return i < 0 ? 99 : i;
    }).concat([99]));
    return ra - rb;
  });

  const ph = t.public_holidays || null;
  const publicHolidays = ph ? {
    rule: ph.rule || 'unverified',
    basis: ph.basis || t.basis || 'estimate',
    source: ph.source || t.source || null,
    checked: ph.checked || t.checked || null,
    note: ph.note || null,
    // A named-holiday override, keyed by the holiday's name in lower case with spaces kept.
    named: ph.days ? Object.fromEntries(Object.entries(ph.days)
      .map(([k, v]) => [k.toLowerCase(), parseDay(v)])) : null
  } : { rule: 'unverified', basis: t.basis || 'estimate', source: t.source || null, checked: t.checked || null, note: null, named: null };

  let closedDays = 0, unverifiedDays = 0, lateDays = 0;
  for (const d of days) {
    if (d.kind === 'closed') closedDays++;
    else if (d.kind === 'unverified') unverifiedDays++;
    if (d.late) lateDays++;
  }

  const basis = t.basis || 'estimate';
  const stance = NOT_A_SHOPFRONT.has(posture) ? posture : 'shopfront';
  // A blank week is a blank week however it got that way: `basis: none` says it outright, and seven
  // unverified days say the same thing one day at a time. Both mean the pack is holding nothing, so
  // both must stop the simulation short of asserting a shut door.
  const noWeek = basis === 'none' || unverifiedDays === 7;

  return {
    basis,
    posture: stance,
    sourceKind: t.source_kind || (basis === 'estimate' || basis === 'none' ? 'none' : null),
    source: t.source || null,
    checked: t.checked || null,
    confidence: t.confidence || null,
    note: t.note || null,
    days,
    kitchen: parseSub(t.kitchen, basis),
    variants,
    publicHolidays,
    closedDays,
    unverifiedDays,
    lateDays,
    weeklyOpenHours: weeklyHours(days),
    // True when the pack has told us nothing anybody published. The interface must never render
    // one of these as a trading hour without saying what it is.
    isEstimate: basis === 'estimate',
    noWeek,
    /**
     * The one gate. Nothing anywhere is allowed to say a place is open or shut unless this is true,
     * and it is only true for a shopfront that has a week from somebody. Everything else gets a
     * null, which every layer above must carry as a null rather than quietly reading it as a false:
     * "we do not know" and "it is shut" are different sentences and only one of them is honest.
     */
    answersOpenShut: stance === 'shopfront' && !noWeek,
    /** Said on the card in place of an open or shut sign. */
    postureLine: POSTURE_LINE[stance] || null
  };
}

/**
 * Seven days folded into the shortest true sentence: 'Monday to Thursday 08:30 to 17:00, Friday
 * 08:30 to 18:00, Saturday and Sunday closed'.
 *
 * This exists so an unpublished pattern can be stated in one line instead of drawn as a seven-row
 * table under a heading reading THE WEEK. The rows and the line carry the same facts; the line
 * cannot be mistaken for a roster somebody published, and the table can.
 */
export function weekSummary(days) {
  if (!days || !days.length) return '';
  const parts = [];
  let runFrom = 1;                                   // start on Monday: nobody reads a week Sunday first
  const at = (i) => days[i % 7];
  const textAt = (i) => dayText(at(i));
  for (let i = 1; i <= 7; i++) {
    const next = i < 7 ? textAt(i + 1) : null;
    if (next === textAt(i)) continue;
    const from = DOW_LABEL[runFrom % 7];
    const to = DOW_LABEL[i % 7];
    const span = i === runFrom ? from
      : i === runFrom + 1 ? `${from} and ${to}`
        : `${from} to ${to}`;
    parts.push(`${span} ${textAt(i)}`);
    runFrom = i + 1;
  }
  return parts.join(', ');
}

/* ------------------------------------------------------------------ which week applies today

`info` is one day out of src/systems/agents/calendar.js, unchanged. This module does not derive a
calendar and must not: there is one calendar on this island and five systems already share it. */

function variantApplies(tag, info) {
  if (!info) return false;
  switch (tag) {
    case 'school-holidays': return !!info.isSchoolHoliday;
    case 'summer-school-holidays': return info.schoolBlock === 'summer';
    case 'winter-school-holidays': return info.schoolBlock === 'winter';
    case 'spring-school-holidays': return info.schoolBlock === 'spring';
    case 'easter': return /Easter|Good Friday/.test(info.holidayName || '') || info.longWeekendAnchor === 'Easter, four days';
    case 'public-holiday': return !!info.isPublicHoliday;
    case 'long-weekend': case 'long-weekends': return !!info.isLongWeekend;
    case 'weekends': return !!info.isWeekend;
    // June and July: the two months this island's own occupations pack calls the winter cut.
    case 'winter': return info.month === 5 || info.month === 6;
    default: return false;
  }
}

/**
 * The week that applies today, and why. Returns the base week when nothing more specific does, and
 * always says which it used so a player can be told "school holiday hours" rather than a number
 * that quietly changed under them.
 */
export function weekFor(h, info, month) {
  const ctx = info ? (info.month === undefined ? Object.assign({ month }, info) : info) : { month };
  // A named public holiday the business itself published beats everything.
  if (info && info.isPublicHoliday && h.publicHolidays.named) {
    const named = h.publicHolidays.named[String(info.holidayName || '').toLowerCase()];
    if (named) return { days: null, oneDay: named, variantId: 'public-holiday-named', label: info.holidayName, basis: h.publicHolidays.basis };
  }
  for (const v of h.variants) {
    for (const tag of v.applies) {
      if (variantApplies(tag, ctx)) {
        return { days: v.days, kitchen: v.kitchen, oneDay: null, variantId: v.id, label: v.id, basis: v.basis, note: v.note, source: v.source };
      }
    }
  }
  if (info && info.isPublicHoliday) {
    if (h.publicHolidays.rule === 'closed') {
      return { days: null, oneDay: { kind: 'closed', windows: [], late: false }, variantId: 'public-holiday', label: 'public holiday', basis: h.publicHolidays.basis };
    }
    // 'open-as-normal' and 'unverified' both fall through to the ordinary week. The difference is
    // what the interface is allowed to say about it, which is why the rule travels out in the card.
  }
  return { days: h.days, oneDay: null, variantId: 'base', label: 'ordinary week', basis: h.basis };
}

/** The parsed day that applies, given a chosen week and a weekday. */
export function dayFor(week, dow) {
  if (week.oneDay) return week.oneDay;
  return week.days[dow];
}

/** Is `minute` inside one of this day's windows? Handles a window that runs past midnight. */
export function withinDay(day, minute) {
  if (!day || !day.windows.length) return false;
  for (const w of day.windows) if (minute >= w.open && minute < w.close) return true;
  return false;
}

/**
 * Open now, counting a window that started yesterday and has not closed yet.
 *
 * Returns **null**, not false, for anything the twin does not get to have an opinion about. Every
 * caller must carry that null. A `!openAt(...)` that reads a null as a shut door is the whole bug
 * this gate exists to stop.
 */
export function openAt(h, week, dow, minute) {
  if (!h.answersOpenShut) return null;
  if (withinDay(dayFor(week, dow), minute)) return true;
  const yest = dayFor(week, (dow + 6) % 7);
  if (yest) for (const w of yest.windows) if (w.close > 1440 && minute < w.close - 1440) return true;
  return false;
}

/** The kitchen, which is a different question and the one that disappoints people. */
export function kitchenOpenAt(h, week, dow, minute) {
  if (!h.answersOpenShut) return null;
  const days = (week && week.kitchen) || (h.kitchen && h.kitchen.days) || null;
  if (!days) return null;                       // no separate kitchen published: not a claim either way
  if (withinDay(days[dow], minute)) return true;
  const yest = days[(dow + 6) % 7];
  if (yest) for (const w of yest.windows) if (w.close > 1440 && minute < w.close - 1440) return true;
  return false;
}

/**
 * When it next opens, from a given moment, looking up to a week ahead. Returned as a weekday and a
 * minute so the caller can phrase it: "Opens again Wednesday at 11am" beats "closed".
 */
export function nextOpening(h, weekOf, dow, minute) {
  if (!h.answersOpenShut) return null;
  for (let step = 0; step < 8; step++) {
    const d = (dow + step) % 7;
    const week = weekOf(step);
    const day = dayFor(week, d);
    if (!day || !day.windows.length) continue;
    for (const w of day.windows) {
      if (step === 0 && w.open <= minute) continue;
      return { inDays: step, dow: d, minute: w.open % 1440, label: DOW_LABEL[d], time: fmt(w.open), variantId: week.variantId };
    }
  }
  return null;
}

/** When the current window shuts. Null when it is not open. */
export function closesAt(week, dow, minute) {
  const day = dayFor(week, dow);
  if (day) for (const w of day.windows) if (minute >= w.open && minute < w.close) return { minute: w.close, time: fmt(w.close), late: day.late };
  const yest = dayFor(week, (dow + 6) % 7);
  if (yest) for (const w of yest.windows) if (w.close > 1440 && minute < w.close - 1440) return { minute: w.close - 1440, time: fmt(w.close), late: yest.late };
  return null;
}

/** One weekday rendered the way it is published: '11:00 to 14:30 and 17:00 to 20:30'. */
export function dayText(day) {
  if (!day) return 'not recorded';
  if (day.kind === 'closed') return 'closed';
  if (day.kind === '24h') return 'always open';
  if (day.kind === 'unverified') return 'not published';
  const parts = day.windows.map((w) => `${fmt(w.open)} to ${day.late && w.close === LATE_CLOSE_MIN ? 'late' : fmt(w.close)}`);
  if (parts.length <= 1) return parts[0] || 'not recorded';
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/* ------------------------------------------------------------------ the modelled layer

Nothing below here is published anywhere and all of it is labelled modelled wherever it surfaces.
It is arithmetic over things the twin already measures: the wind and the swell out of weather.js,
whether the beach is drivable out of schedule.js, and whether this business is out of a stock line,
which businesses.js already tracks because the barge is why it happens. */

/** What kind of trading a weather closure is even a question for. Keyed on the pack's own types. */
export const EXPOSURE = {
  'coffee-van': 'open-air',
  'juice-van': 'open-air',
  'food-van': 'open-air',
  market: 'open-air',
  'hostel-and-dive-operator': 'on-the-water',
  'surf-school': 'on-the-water',
  'seafood-retail-and-charter': 'on-the-water',
  'tour-operator-4wd': 'on-the-beach',
  'tour-operator-cultural': 'on-the-beach',
  'cultural-walking-tour': 'outdoors',
  'golf-club': 'outdoors'
};
// A bowls club has a clubhouse and a pub has a roof, so neither is here. Only trading that has
// nowhere to go when the weather turns gets an exposure, and only an exposure with a rule below
// gets one at all, so the interface never warns about a closure that cannot happen.

/**
 * Whether the weather has taken today off this business, and in one plain sentence, why.
 *
 * Thresholds are modelling choices, chosen against what the rest of this island already refuses to
 * do at the same numbers: `needs.js` stops people going out in the tinny over eighteen knots and
 * stops them fishing off the rocks over 2.4 m of swell, and `schedule.js` shuts beach driving when
 * Main Beach is over 0.95 m of tide. Using the same numbers means a player who has learnt one of
 * them has learnt all of them.
 */
export function weatherClosure(exposure, env) {
  if (!exposure || !env) return null;
  const wind = env.windKt || 0;
  const swell = env.swellM || 0;
  const rain = env.rainMmHr || 0;
  switch (exposure) {
    case 'open-air':
      if (rain > 2.5) return 'the rain has it shut';
      if (wind > 30) return 'too much wind to trade in the open';
      return null;
    case 'on-the-water':
      if (swell > 2.4 || wind > 25) return 'the water is out of the question today';
      return null;
    case 'on-the-beach':
      if (env.beachDrivingOpen === false) return 'the beach is shut to vehicles on this tide';
      if (wind > 32) return 'too much wind on the beach';
      return null;
    case 'outdoors':
      if (rain > 6) return 'washed out';
      return null;
    default:
      return null;
  }
}

/**
 * The barge. When a run is missed the shelf is what shows it, and the first thing to go on this
 * island is fresh food, so a kitchen that has run out of perishables serves what it can and shuts
 * early rather than the whole business closing. This reads `outOf`, which businesses.js already
 * fills from the freight chain, so it is a join between two things that exist rather than a new
 * claim about anybody's trading.
 */
export function kitchenShortened(outOf) {
  if (!outOf || !outOf.length) return null;
  if (outOf.includes('perishable')) return 'the fresh delivery did not land: short menu and an early close in the kitchen';
  if (outOf.includes('drink')) return null;
  return null;
}

/* ------------------------------------------------------------------ the card

One object with everything a panel needs, built on a click and never in a tick.

Three things travel out of here that a panel is not allowed to work around:

  `open` is null, not false, for anything with no published week and for anything that is not a
  shopfront. A panel that renders a null as "shut" has invented a fact.
  `weekIsPublished` is false for a modelled pattern, and a modelled pattern is not drawn as a week.
  `postureLine` is the sentence that replaces an open or shut sign when there is not one to give. */

export function hoursCard(h, weekOf, dow, minute, extra) {
  const week = weekOf(0);
  const open = openAt(h, week, dow, minute);
  const kitchen = kitchenOpenAt(h, week, dow, minute);
  const shuts = open ? closesAt(week, dow, minute) : null;
  const next = open === false ? nextOpening(h, weekOf, dow, minute) : null;
  // The week table shows the week, not seven copies of today. A named public holiday replaces one
  // day and must not be drawn as though the business had shut for a fortnight.
  const tableDays = week.days || h.days;
  const rows = [];
  for (let d = 0; d < 7; d++) {
    rows.push({
      key: DOW_KEYS[d], label: DOW_LABEL[d], today: d === dow,
      text: dayText(week.oneDay && d === dow ? week.oneDay : tableDays[d]),
      kitchen: week.kitchen ? dayText(week.kitchen[d]) : (h.kitchen ? dayText(h.kitchen.days[d]) : null)
    });
  }
  // Whether the seven rows above are a thing somebody published or a thing this simulation made up
  // to have something to run on. Only the first kind is drawn as a week.
  const weekIsPublished = (week.basis || h.basis) === 'published' || (week.basis || h.basis) === 'listed';
  return {
    open,
    posture: h.posture,
    postureLine: h.postureLine,
    answersOpenShut: h.answersOpenShut,
    noWeek: h.noWeek,
    weekIsPublished,
    /** The modelled pattern in one line, for the places where drawing it as a week would lie.
     *  Null when there is no pattern either: seven days of "not published" is not a sentence. */
    patternLine: weekIsPublished || h.noWeek ? null : weekSummary(tableDays),
    kitchenOpen: kitchen,
    basis: h.basis,
    basisWord: h.basis === 'published' ? 'published by the business'
      : h.basis === 'listed' ? 'published in a listing, not by the business'
        : h.basis === 'none' ? 'nobody has published any, and the pack carries no guess at them'
          : 'an estimate, not published trading hours',
    source: h.source,
    sourceKind: h.sourceKind,
    checked: h.checked,
    confidence: h.confidence,
    note: h.note,
    week: week.label,
    weekBasis: week.basis,
    weekNote: week.note || null,
    publicHolidayRule: h.publicHolidays.rule,
    publicHolidayNote: h.publicHolidays.note,
    closesAt: shuts ? shuts.time : null,
    closeUnpublished: !!(shuts && shuts.late),
    nextOpen: next ? `${next.inDays === 0 ? 'later today' : next.inDays === 1 ? 'tomorrow' : next.label} at ${next.time}` : null,
    kitchenHours: h.kitchen ? { basis: h.kitchen.basis, source: h.kitchen.source, checked: h.kitchen.checked, note: h.kitchen.note } : null,
    rows,
    variants: h.variants.map((v) => ({ id: v.id, applies: v.applies.slice(), basis: v.basis, note: v.note })),
    modelled: extra || null
  };
}
