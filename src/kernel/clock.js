// Island time. One tick = 10 sim-minutes at 1x. Speeds are tick multipliers, not timestep changes,
// so the simulation is identical at every speed (Cities Skylines does the opposite and it shows).
//
// ============================================================================================
// THREE DECLARED MODES, AND THE SCREEN ALWAYS SAYS WHICH
// ============================================================================================
//
//   simulated   Seeded and deterministic. The clock starts at a moment written down in the record
//               and runs forward from it. This is the default and it is the only mode a headless
//               run can be in, which is why `node tools/headless.mjs --determinism` is unaffected
//               by everything below.
//
//   live        The island is at the real Queensland moment. Live is an anchor, not a feed: the
//               real datetime it started from is stamped into the record, so a save made in live
//               replays exactly. Nothing about live reaches the network, and the simulation does
//               not become non-deterministic by being in it. It becomes deterministic *from a
//               different starting point*, and that starting point is data.
//
//   scrub       You are looking at a moment the island is not at. The clock is parked, nothing
//               advances, and what you are looking at is honestly two different things at once:
//               the sun, the moon, the tide and the calendar are exact for that moment because
//               they are pure functions of it, and everything the island has to live through is
//               held at the island's present because it cannot be conjured. `makeTimeControl`
//               below is what enforces that, and `docs/KEYS.md` records the keys.
//
// The mode is part of the record. `save()` carries the mode, the anchor, the real datetime the
// anchor was taken at, and a short log of every mode change and every jump. Two people with the
// same seed, the same packs and the same clock record get the same island, in live as much as in
// simulated, because the thing that varied has been written down.
//
// ============================================================================================
// ONE MOVER, AND THE SEAL THAT PROVES IT
// ============================================================================================
//
// `makeTimeControl` at the bottom of this file is the only thing that may move the moment on
// screen. That is a rule, and rules that are only written down get broken: the photo-mode time
// slider used to write `clock.minuteOfDay` straight in, and the bar carried on saying LIVE over a
// moment thirteen hours from the real one, with nothing on the record and no way back.
//
// So it is enforced rather than asserted. Every sanctioned mover in this file calls `seal()` on
// the moment it landed on, and `world.time.status()` compares the seal against where the clock
// actually is, ten times a second. If they have parted company, `reconcile()` declares the moment
// as what it now is (a scrub away from the island's present), parks it, recomputes the two systems
// that can answer for a scrubbed moment, counts it in `offRecordMoves`, and writes it on the
// record. Whatever wrote directly, the bar tells the truth within a tenth of a second.
//
// Two honest limits on that. A tick would otherwise launder a direct write, because the tick
// re-seals at the end, so `advance()` checks the seal itself before it runs. And detection rides
// on the interface's own pass, which a browser throttles hard in a hidden tab, so in a tab nobody
// is looking at the declaration can be a minute late. The count and the record entry are exact
// either way, `describe().driftMin` shows it the instant anyone asks, and `TWIN.probe()` declares
// it before answering.
//
// ============================================================================================
// THE ONE Date.now IN THIS PROJECT
// ============================================================================================
//
// `docs/CONTRACT.md` forbids `Date.now()` in simulation logic and names the clock as the single
// exception. `realIslandMinute()` below is that exception, it is the only one, and it is reached
// from exactly three places: taking a live anchor, working out how far a live session has fallen
// behind the real clock, and telling the interface where the real moment sits on its time ribbon.
// It is unreachable while the mode is `simulated`, except from the interface, which never feeds
// the simulation. If you are adding a second one, you are doing something else wrong.

export const TICK_MINUTES = 10;
export const MINUTES_PER_DAY = 1440;
export const TICKS_PER_DAY = MINUTES_PER_DAY / TICK_MINUTES; // 144

/**
 * Island time is AEST, UTC+10, for every moment this twin can reach, and the offset never shifts.
 *
 * Stated carefully, because the easy version of this sentence is wrong and a Queenslander old
 * enough to have voted would say so. Queensland does not *currently* observe daylight saving, and
 * has not since the summer of 1991-92. It is not that the state never tried it: summer time ran
 * here in 1971-72, and again across the three summers from 1989-90, and the referendum of
 * 22 February 1992 asked whether Queenslanders were in favour of daylight saving and was defeated.
 * Nothing this twin can show falls inside any of those windows, so the arithmetic below is exact
 * for every moment it can reach, and the honest claim is the operational one rather than a
 * historical absolute.
 *
 * Anywhere this fact reaches a player it is worded the same way. See the LIVE button's tooltip in
 * src/ui/panels/hud.js, which is the only other place it is said.
 */
export const AEST_OFFSET_MIN = 600;
export const ISLAND_TZ = 'AEST';
/** The one sentence about the offset, written once so the interface cannot drift from this file. */
export const ISLAND_TZ_NOTE = 'AEST, UTC+10 all year. Queensland has observed no daylight saving '
  + 'since the summer of 1991-92, when a referendum on it was defeated.';

/** The moment a simulated island opens at when nobody has said otherwise. */
export const DEFAULT_START_ISO = '2026-09-19T05:20';

export const SPEEDS = [
  { label: 'Paused', ticksPerSecond: 0, key: '0' },
  { label: '1x', ticksPerSecond: 2, key: '1' },
  { label: '3x', ticksPerSecond: 6, key: '2' },
  { label: '12x', ticksPerSecond: 24, key: '3' },
  { label: '60x', ticksPerSecond: 120, key: '4' }
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Island seasons. Six bands keyed to what the Country is doing, not to a meteorological grid.
// Boundaries are month spans; the seasons are read from the world, so in practice they overlap.
//
// CULTURAL NOTE, read before touching this block.
// An earlier version of this file carried six season names presented as a Quandamooka calendar,
// written from memory. They could not be sourced. No published Quandamooka seasonal calendar was
// found: not in QYAC's own publications, not in Queensland Government material, not in the Bureau
// of Meteorology's Indigenous Weather Knowledge calendars, not in the North Stradbroke Island
// Museum's language material. At least one of the words was demonstrably wrong in the way it was
// used: yalingbila is published as meaning whale, in the QYAC and University of Queensland project
// Yalingbila Bibula at Mooloomba, and it was being used here as the name of a hot wet season.
// The names have been removed. See data/lore.json language.seasonal_calendar and
// language.banned_tokens, and docs/CULTURAL-REVIEW.md.
//
// What is here now is plain descriptive English, and each band is two separable kinds of claim so
// that neither can borrow the other's authority. An earlier version of this file ran them together
// in one string and said in this comment that all of it came from the ecology pack. Four of the
// phrases did not, and a critic caught it, so they are now on their own field:
//
//   markers   ecological claims about this island, drawn verbatim or near-verbatim from
//             data/ecology.json seasonal_calendar. The six bands nest inside that pack's four
//             seasons: high summer and late summer sit in its Summer, cooling in Autumn, cold and
//             clear in Winter, warming and building storms in Spring. Every line below can be
//             checked against a sourced ecology record rather than against somebody's memory.
//   weather   ordinary south-east Queensland climate description, and not an ecological claim. It
//             is not from the ecology pack. It is the synoptic pattern this twin's own weather
//             model is weighted toward in that season: see the SEASON table in
//             src/systems/environment/weather.js, where winter runs westerly 2.6 against storm
//             0.15, and summer runs storm 2.4 against westerly 0.15.
//
// One phrase from the old list is simply gone. "Lakes full" was neither: the lakes on this island
// are a mix of perched and window lakes that answer to different things (data/ecology.json
// hab-freshwater-lakes), so a flat seasonal claim about their level had no source and was not
// climate description either.
const SEASON_BANDS = [
  { id: 'high-summer', name: 'High summer', months: [11, 0],
    weather: 'Afternoon storms',
    markers: ['Loggerhead turtles nesting on the ocean beaches', 'Manta rays on the bommie',
      'Migratory shorebirds at peak numbers on the western flats', 'Peak visitor pressure on every one of them'] },
  { id: 'late-summer', name: 'Late summer', months: [1],
    weather: 'Heat and storm rain',
    markers: ['Acid frogs calling after storm rain', 'Turtle hatchlings on the ocean beaches',
      'Goannas around the campgrounds'] },
  { id: 'cooling', name: 'Cooling', months: [2, 3, 4],
    weather: 'Southerlies, and the east coast lows',
    markers: ['Shorebirds fatten and depart by about April', 'Midyim fruiting ends',
      'Mullet start moving', 'Planned burn season opens'] },
  { id: 'cold-and-clear', name: 'Cold and clear', months: [5, 6, 7],
    weather: 'Cold westerlies off the land',
    markers: ['Humpbacks passing north, peaking about July', 'The mullet run, May to August',
      'Tailor in the gutters, strong in August', 'Grey nurse sharks at Flat Rock, June to October'] },
  { id: 'warming', name: 'Warming', months: [8, 9],
    weather: 'Sea breezes returning',
    markers: ['Humpbacks passing south with calves, close inshore, peaking about October',
      'Snakes and blue-tongues at their most active and most reported',
      'Koala breeding and dispersal, with a road strike and dog attack peak', 'Shorebirds returning from about September'] },
  { id: 'building-storms', name: 'Building storms', months: [10],
    weather: 'The first storms of the season',
    markers: ['Bushfire risk rising', 'Loggerhead mating from late October',
      'Rainbow bee-eaters back and digging nest burrows in sandy banks'] }
];

// `marker` is the whole band as one sentence, kept because it is what everything outside this file
// reads. The two fields are the truth; this is the convenience.
export const ISLAND_SEASONS = SEASON_BANDS.map((b) => ({
  ...b, marker: [b.weather].concat(b.markers).join('. ') + '.'
}));

/* ------------------------------------------- the Queensland school calendar

   Load on this island follows the state school calendar harder than it follows the weather, so the
   clock has to be able to answer "is it school holidays" for any moment it can be scrubbed to.

   What was here before was five fixed day-of-year windows with no source. Four of their five
   boundaries were out by two to four days against the published Queensland dates for 2026, and a
   fixed day-of-year window drifts every year anyway, because every real boundary hangs off a
   weekday or off Easter. Replaced with the published anchors:

     autumn   Good Friday, through Good Friday plus 16 days
     winter   the last Saturday of June, plus 15 days
     spring   the Saturday 16 days before the King's Birthday, through the King's Birthday
     summer   the second Saturday of December, through 26 January

   Checked against the published 2026 dates, which are committed in data/events.json at
   reference_2026.queensland_state_school_holidays and cited there to
   education.qld.gov.au/about-us/calendar/term-dates. All four match to the day: 3 to 19 April,
   27 June to 12 July, 19 September to 5 October, and 12 December to 26 January.

   src/systems/agents/calendar.js derives the same four blocks from the same anchors for the agent
   systems, and checks itself against that pack at init. They now agree by construction. They did
   not before: the clock was telling the budget, the water demand and the buildings layer one thing
   while the residents were being scheduled against another.

   2026 is the only year whose published dates are on file, so `schoolCalendarBasis` reads
   `published` for a day inside a 2026-anchored block and `derived` everywhere else, and the
   interface says which rather than calling an approximation exact. Add a year to the pack and add
   it to this list in the same commit. */
export const PUBLISHED_SCHOOL_YEARS = [2026];

const DAY_MS = 86400000;
const dayNumOf = (y, m, d) => Math.floor(Date.UTC(y, m, d) / DAY_MS);
/** 0 is Sunday. Day number 0 is 1 January 1970, which was a Thursday. */
const weekdayOfDayNum = (n) => (((n + 4) % 7) + 7) % 7;

/** Anonymous Gregorian computus. Easter Sunday is arithmetic, not an assertion about this island. */
function easterSundayDayNum(year) {
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
  return dayNumOf(year, month - 1, day);
}

/** The nth given weekday of a month, one-based. The King's Birthday here is the first Monday in October. */
function nthWeekdayDayNum(year, month, weekday, n) {
  const first = dayNumOf(year, month, 1);
  return first + ((weekday - weekdayOfDayNum(first) + 7) % 7) + (n - 1) * 7;
}

/** The four Queensland school holiday blocks of one year, as inclusive day-number spans. */
export function qldSchoolHolidayBlocks(year) {
  const gf = easterSundayDayNum(year) - 2;
  let lastSatJune = dayNumOf(year, 5, 30);
  while (weekdayOfDayNum(lastSatJune) !== 6) lastSatJune--;
  const kings = nthWeekdayDayNum(year, 9, 1, 1);
  let secondSatDec = dayNumOf(year, 11, 1);
  while (weekdayOfDayNum(secondSatDec) !== 6) secondSatDec++;
  secondSatDec += 7;
  return [
    { label: 'autumn', year, from: gf, to: gf + 16 },
    { label: 'winter', year, from: lastSatJune, to: lastSatJune + 15 },
    { label: 'spring', year, from: kings - 16, to: kings },
    { label: 'summer', year, from: secondSatDec, to: dayNumOf(year + 1, 0, 26) }
  ];
}

const schoolCache = new Map();
function schoolBlocksFor(year) {
  let b = schoolCache.get(year);
  if (!b) {
    if (schoolCache.size > 64) schoolCache.clear();
    b = qldSchoolHolidayBlocks(year);
    schoolCache.set(year, b);
  }
  return b;
}

/**
 * The school holiday block a day number falls in, or null. The previous year is checked too,
 * because the summer break opens in December and closes on 26 January.
 */
export function qldSchoolHolidayOn(dayNum) {
  const y = new Date(dayNum * DAY_MS).getUTCFullYear();
  for (const b of schoolBlocksFor(y)) if (dayNum >= b.from && dayNum <= b.to) return b;
  for (const b of schoolBlocksFor(y - 1)) if (dayNum >= b.from && dayNum <= b.to) return b;
  return null;
}

/* ------------------------------------------------------------------ the exception */

/**
 * Absolute minutes since the Unix epoch, in island time. See the header: this is the one place
 * this project asks the machine what time it is, and it exists so that "live" can mean the real
 * Queensland moment rather than a moment somebody typed in.
 *
 * Queensland is UTC+10 and never shifts, so island wall time is the machine's UTC plus ten hours,
 * whatever timezone the machine itself thinks it is in. That is why this adds an offset rather
 * than reading a local hour: a build opened in London must show the island at Queensland time.
 */
export function realIslandMinute() {
  return Math.floor((Date.now() + AEST_OFFSET_MIN * 60000) / 60000);
}

/** Tolerant of `2026-09-19`, `2026-09-19T05:20` and `2026-09-19 05:20:00`. Always read as island time. */
export function parseIslandISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(iso || '').trim());
  if (!m) return parseIslandISO(DEFAULT_START_ISO);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0));
}

const pad2 = (n) => String(n).padStart(2, '0');

/** An absolute island minute back to `2026-09-19T05:20`. The inverse of parseIslandISO. */
export function islandISO(absoluteMinute) {
  const d = new Date(absoluteMinute * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    + `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** An absolute island minute as `Sat 6 Feb 2027`. Works for any moment, not just the clock's. */
export function islandDateText(absoluteMinute) {
  const d = new Date(Math.floor(absoluteMinute / MINUTES_PER_DAY) * 86400000);
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** An absolute island minute as `3:10pm`. */
export function islandTimeText(absoluteMinute) {
  const m = ((Math.round(absoluteMinute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** The real Queensland moment right now, in the same shape as the `?start=` parameter. */
export function realIslandISO() {
  return islandISO(realIslandMinute());
}

/**
 * The same moment snapped back to the last ten-minute mark, because island time moves in
 * ten-minute steps and a live island has to sit on one of them. So live is never ahead of the
 * real island and is at most one tick behind it, which is the honest direction to be wrong in.
 */
export function liveStartISO() {
  return islandISO(Math.floor(realIslandMinute() / TICK_MINUTES) * TICK_MINUTES);
}

/** A gap in minutes as plain English: "6 days 4 hours", "40 min", "in step". */
export function spanText(minutes, { zero = 'in step' } = {}) {
  const m = Math.abs(Math.round(minutes));
  if (m < 1) return zero;
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return h + ' h' + (rm ? ' ' + rm + ' min' : '');
  const d = Math.floor(h / 24), rh = h % 24;
  if (d < 14) return d + (d === 1 ? ' day' : ' days') + (rh ? ' ' + rh + ' h' : '');
  return d + ' days';
}

/* ================================================================== the clock */

export class Clock {
  /** @param startISO e.g. '2026-09-19T06:00' */
  constructor(startISO = DEFAULT_START_ISO) {
    // Parsed as UTC and read back as UTC throughout, so the island calendar does not
    // shift with whatever machine the build happens to run on. Island time is AEST by definition.
    const d = parseIslandISO(startISO);
    this.epochDay = Math.floor(d.getTime() / 86400000);
    this.tick = 0;
    this.minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
    this.startMinuteOfDay = this.minuteOfDay;
    this.dayIndex = 0;
    this.speedIndex = 1;
    this.accumulator = 0;
    this._date = d;

    // --- what kind of time this is. Recorded, saved, and stated on screen at all times.
    this.mode = 'simulated';              // 'simulated' | 'live'
    this.startISO = islandISO(this.absoluteMinute);
    this.anchorISO = this.startISO;       // the island moment the current mode began at
    this.anchorTick = 0;
    this.anchorRealMs = null;             // the real UTC millisecond a live anchor was taken at
    this.record = [{ tick: 0, mode: 'simulated', at: this.startISO, realMs: null, note: 'opened' }];

    // --- the island's present: the furthest the simulation has actually lived to. Scrubbing moves
    // what you are looking at and never moves this. Only a tick moves this.
    this.livedTick = 0;
    this.livedDayIndex = 0;
    this.livedMinuteOfDay = this.minuteOfDay;
    // The stretches of calendar the island has actually run through. One to begin with. Going
    // live, or ticking on from a moment the clock was parked at, closes the current stretch and
    // opens another, because those two moments are not joined by anything the island did. The
    // time ribbon draws these, so it can never claim the island lived through a gap it jumped.
    this.segments = [{ from: this.absoluteMinute, to: this.absoluteMinute }];

    // --- scrubbing. Viewed = lived + viewOffsetMin. Zero means you are looking at the present.
    this.viewOffsetMin = 0;
    this.speedBeforeScrub = 1;
    this.jumps = 0;                       // times a tick has been run from a parked clock

    // Tooling holds the clock still without changing what kind of time this is. `TWIN.shot()` has
    // to stop the world for as long as it takes to encode a PNG, and doing that through setSpeed
    // would drop a live session out of live to take a photograph of it.
    this._frozen = false;

    // Which day the school answer was last worked out for, so eight systems asking on one tick
    // pay for it once.
    this._schoolDay = null;
    this._schoolBlock = null;

    // --- the seal. The last moment this clock was moved to through a sanctioned path: a tick, a
    // scrub, a live anchor, or a load. `world.time` compares it against where the clock actually
    // is, ten times a second, and if they have parted company then something moved the moment
    // without going through the time control. That is not smoothed over: it is turned into a
    // declared scrub so the bar says what you are looking at, and it goes on the record and is
    // counted. See `reconcile()` in makeTimeControl.
    this._sealedMinute = this.absoluteMinute;
    this.offRecordMoves = 0;
  }

  /* ---- reading the moment ---------------------------------------------- */

  get speed() { return SPEEDS[this.speedIndex]; }
  get paused() { return this.speedIndex === 0; }
  /** True when the moment on screen is not the moment the island has lived to. */
  get scrubbing() { return this.viewOffsetMin !== 0; }
  /** One of the three modes in the header. This is the word the interface must show. */
  get declaredMode() { return this.scrubbing ? 'scrub' : this.mode; }
  /** Minutes since the Unix epoch, in island time. The one number every other one is derived from. */
  get absoluteMinute() { return (this.epochDay + this.dayIndex) * MINUTES_PER_DAY + this.minuteOfDay; }
  /** The same, for the island's present rather than for what is on screen. */
  get livedAbsoluteMinute() { return (this.epochDay + this.livedDayIndex) * MINUTES_PER_DAY + this.livedMinuteOfDay; }

  setSpeed(i) {
    const next = Math.max(0, Math.min(SPEEDS.length - 1, i));
    // Live means keeping pace with the real clock, so choosing a speed is choosing to stop being
    // live. That is a mode change and it goes on the record rather than leaving the word LIVE on
    // screen above an island running at sixty times real time.
    if (this.mode === 'live') this.leaveLive('a speed was chosen');
    this.speedIndex = next;
  }
  togglePause() { this.setSpeed(this.speedIndex === 0 ? 1 : 0); }

  /** Hold the world still for tooling, without touching the mode. Always paired with `thaw()`. */
  freeze() { this._frozen = true; }
  thaw() { this._frozen = false; this.accumulator = 0; }

  /** Advance wall-clock; returns how many sim ticks to run. Capped so a stalled tab does not spiral. */
  pump(dtSeconds) {
    if (this._frozen) return 0;
    // A parked clock does not move on its own. Coming back to the present is a deliberate act.
    if (this.scrubbing) return 0;
    if (this.mode === 'live') {
      // Live keeps pace with the real Queensland clock: one tick every ten real minutes, worked
      // out from the gap rather than accumulated, so a backgrounded tab that misses an hour of
      // frames comes back to the right moment instead of an hour behind it.
      const behind = realIslandMinute() - this.absoluteMinute;
      if (behind < TICK_MINUTES) return 0;
      return Math.min(Math.floor(behind / TICK_MINUTES), 240);
    }
    if (this.paused) return 0;
    this.accumulator += dtSeconds * this.speed.ticksPerSecond;
    const n = Math.floor(this.accumulator);
    this.accumulator -= n;
    return Math.min(n, 240);
  }

  advance() {
    // A tick is what makes a moment real. If the clock was parked somewhere the island had not
    // lived through and something ticked it anyway, that is a jump: the island did not live the
    // gap, it arrived on the other side of it. Counted and recorded rather than smoothed over.
    if (this.viewOffsetMin !== 0) {
      this.jumps++;
      this.note('jumped ' + spanText(this.viewOffsetMin, { zero: 'nowhere' })
        + (this.viewOffsetMin > 0 ? ' forward' : ' back') + ' without living through it');
      this.viewOffsetMin = 0;
      this.openSegment();
    } else {
      // The other way a moment gets moved without saying so, and the one the photo-mode slider
      // used: write the minute in, then tick. Without this the tick would launder it, because the
      // tick re-seals at the end and world.time would never see that anything had happened. One
      // subtraction, checked here so the window cannot be closed by being quick.
      const drift = this.driftMinutes();
      if (drift !== 0) {
        this.offRecordMoves++;
        this.note('the moment moved ' + spanText(drift, { zero: 'nowhere' })
          + (drift > 0 ? ' forward' : ' back') + ' outside the time control, and was ticked from there');
        this.openSegment();
      }
    }
    this.tick++;
    this.minuteOfDay += TICK_MINUTES;
    while (this.minuteOfDay >= MINUTES_PER_DAY) {
      this.minuteOfDay -= MINUTES_PER_DAY;
      this.dayIndex++;
    }
    this.livedTick = this.tick;
    this.livedDayIndex = this.dayIndex;
    this.livedMinuteOfDay = this.minuteOfDay;
    const seg = this.segments[this.segments.length - 1];
    if (seg) seg.to = this.livedAbsoluteMinute;
    this._sealedMinute = this.absoluteMinute;
  }

  /**
   * Record that the moment on this clock is where a sanctioned mover put it. Called by everything
   * in this file that is allowed to move it. Anything that moves `minuteOfDay` or `dayIndex`
   * without coming through here is detected: see `driftMinutes()`.
   */
  seal() { this._sealedMinute = this.absoluteMinute; return this._sealedMinute; }
  /** How far the moment has moved since it was last sealed. Nought unless something wrote directly. */
  driftMinutes() { return this.absoluteMinute - this._sealedMinute; }

  /** Start a new stretch of lived calendar here. Called on a jump and on a live re-anchor. */
  openSegment() {
    this.segments.push({ from: this.absoluteMinute, to: this.absoluteMinute });
    while (this.segments.length > 40) this.segments.shift();
  }

  get date() {
    const d = new Date((this.epochDay + this.dayIndex) * 86400000);
    return d;
  }
  get hour() { return Math.floor(this.minuteOfDay / 60); }
  get minute() { return this.minuteOfDay % 60; }
  /** 0..1 through the day. */
  get dayFraction() { return this.minuteOfDay / MINUTES_PER_DAY; }
  get month() { return this.date.getUTCMonth(); }
  get dayOfMonth() { return this.date.getUTCDate(); }
  get dayOfWeek() { return this.date.getUTCDay(); }
  get isWeekend() { const d = this.dayOfWeek; return d === 0 || d === 6; }
  get dayOfYear() {
    const d = this.date;
    return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  }

  get season() {
    const m = this.month;
    return ISLAND_SEASONS.find((s) => s.months.includes(m)) || ISLAND_SEASONS[0];
  }
  /** The season at the island's present, for anything stamping a record of what the island did. */
  get livedSeason() {
    const d = new Date(Math.floor(this.livedAbsoluteMinute / MINUTES_PER_DAY) * 86400000);
    const m = d.getUTCMonth();
    return ISLAND_SEASONS.find((s) => s.months.includes(m)) || ISLAND_SEASONS[0];
  }
  /** Southern-hemisphere meteorological season, for anything that needs the familiar name. */
  get southernSeason() {
    const m = this.month;
    if (m === 11 || m <= 1) return 'summer';
    if (m <= 4) return 'autumn';
    if (m <= 7) return 'winter';
    return 'spring';
  }

  /**
   * School holidays drive the visitor curve harder than anything else here. Worked out once a day
   * from the published anchors above, memoised because eight or nine systems ask on the same tick.
   */
  get schoolHolidayBlock() {
    const dn = this.epochDay + this.dayIndex;
    if (dn !== this._schoolDay) {
      this._schoolDay = dn;
      this._schoolBlock = qldSchoolHolidayOn(dn);
    }
    return this._schoolBlock;
  }
  get isQldSchoolHoliday() { return this.schoolHolidayBlock !== null; }
  /** `autumn`, `winter`, `spring`, `summer`, or null in term time. */
  get schoolHolidayLabel() { const b = this.schoolHolidayBlock; return b ? b.label : null; }
  /**
   * Whether this day's school answer rests on a published Queensland calendar or on the anchors it
   * is derived from. The interface must say which; only a published one may be called exact.
   */
  get schoolCalendarBasis() {
    const b = this.schoolHolidayBlock;
    const y = b ? b.year : this.date.getUTCFullYear();
    return PUBLISHED_SCHOOL_YEARS.includes(y) ? 'published' : 'derived';
  }

  format() { return islandTimeText(this.absoluteMinute); }
  formatDate() { return islandDateText(this.absoluteMinute); }
  /** The whole moment in one line, timezone included, for anywhere it has to be unambiguous. */
  formatMoment() { return `${this.formatDate()}, ${this.format()} ${ISLAND_TZ}`; }
  formatISO() { return islandISO(this.absoluteMinute); }

  /* The same three, for the island's present rather than for the moment on screen. A record of what
     the island did is stamped with these, never with where somebody parked the clock to look. */
  formatLivedDate() { return islandDateText(this.livedAbsoluteMinute); }
  formatLived() { return islandTimeText(this.livedAbsoluteMinute); }
  formatLivedMoment() { return `${this.formatLivedDate()}, ${this.formatLived()} ${ISLAND_TZ}`; }

  /* ---- moving between modes -------------------------------------------- */

  /** Append to the clock's own record. Bounded: the last forty entries, which is plenty to read. */
  note(text, realMs = null) {
    this.record.push({ tick: this.tick, mode: this.mode, at: this.formatISO(), realMs, note: text });
    while (this.record.length > 40) this.record.shift();
    return this.record[this.record.length - 1];
  }

  /** Put the island's moment somewhere, without living through the gap. Used by live and by scrub. */
  setAbsoluteMinute(absMinute) {
    const abs = Math.round(absMinute);
    const day = Math.floor(abs / MINUTES_PER_DAY);
    this.dayIndex = day - this.epochDay;
    this.minuteOfDay = abs - day * MINUTES_PER_DAY;
    this._sealedMinute = abs;
  }

  /**
   * Enter live. The island's clock moves to the real Queensland moment, snapped back to the last
   * ten-minute mark because island time moves in ten-minute steps, and the real datetime that
   * happened at is stamped into the record. Returns what moved, so the interface can say it.
   *
   * Moving the clock does not move the island: whatever the simulation had already done, it has
   * done. When the real moment is behind the island's clock this is a backwards move, and that is
   * exactly the sentence the interface has to put on screen rather than quietly performing it.
   */
  goLive() {
    const from = this.absoluteMinute;
    const realMin = realIslandMinute();
    const to = Math.floor(realMin / TICK_MINUTES) * TICK_MINUTES;
    this.viewOffsetMin = 0;
    this.setAbsoluteMinute(to);
    this.livedDayIndex = this.dayIndex;
    this.livedMinuteOfDay = this.minuteOfDay;
    this.livedTick = this.tick;
    this.mode = 'live';
    this.speedIndex = 1;
    this.accumulator = 0;
    if (to !== from) this.openSegment();
    this.anchorRealMs = Date.now();
    this.anchorISO = this.formatISO();
    this.anchorTick = this.tick;
    this.note('live from the real ' + this.anchorISO + ' ' + ISLAND_TZ, this.anchorRealMs);
    return { fromMinute: from, toMinute: to, movedMinutes: to - from };
  }

  /** Leave live for a simulated run forward from wherever the island is now. */
  leaveLive(reason = 'left live') {
    if (this.mode !== 'live') return null;
    this.mode = 'simulated';
    this.anchorISO = this.formatISO();
    this.anchorTick = this.tick;
    this.accumulator = 0;
    return this.note('simulated from ' + this.anchorISO + ': ' + reason);
  }

  /** How far ahead of the real Queensland moment the island's clock is, in minutes. */
  minutesAheadOfReal() { return this.absoluteMinute - realIslandMinute(); }

  /* ---- the record ------------------------------------------------------- */

  /**
   * Everything a critic, a save file or a scenario report needs to know about what kind of time
   * this is. Cheap: no allocation beyond the object itself.
   */
  describe() {
    return {
      mode: this.mode,
      declared: this.declaredMode,
      moment: this.formatMoment(),
      iso: this.formatISO(),
      tz: ISLAND_TZ,
      tick: this.tick,
      speed: this.speed.label,
      startISO: this.startISO,
      anchorISO: this.anchorISO,
      anchorRealMs: this.anchorRealMs,
      anchorRealISO: this.anchorRealMs === null ? null : islandISO(Math.floor((this.anchorRealMs + AEST_OFFSET_MIN * 60000) / 60000)),
      livedISO: islandISO(this.livedAbsoluteMinute),
      scrubMinutes: this.viewOffsetMin,
      jumps: this.jumps,
      // Times the moment moved without going through world.time. Nought is the only healthy value,
      // and any other number is a defect in whatever wrote to the clock, not in the clock.
      offRecordMoves: this.offRecordMoves,
      // Nought unless the moment has moved since it was last sealed and nobody has looked yet.
      // A probe carries it so a direct write is visible the instant anyone asks, rather than
      // waiting for the interface's next pass. `world.time.reconcile()` clears it and declares it.
      driftMin: this.driftMinutes(),
      schoolHoliday: this.schoolHolidayLabel,
      schoolCalendarBasis: this.schoolCalendarBasis
    };
  }

  save() {
    return {
      epochDay: this.epochDay,
      tick: this.tick,
      minuteOfDay: this.minuteOfDay,
      dayIndex: this.dayIndex,
      mode: this.mode,
      startISO: this.startISO,
      anchorISO: this.anchorISO,
      anchorTick: this.anchorTick,
      anchorRealMs: this.anchorRealMs,
      livedTick: this.livedTick,
      livedDayIndex: this.livedDayIndex,
      livedMinuteOfDay: this.livedMinuteOfDay,
      viewOffsetMin: this.viewOffsetMin,
      jumps: this.jumps,
      offRecordMoves: this.offRecordMoves,
      segments: this.segments.map((s) => ({ from: s.from, to: s.to })),
      record: this.record.slice()
    };
  }

  /**
   * A save written before the clock had modes carries only the four original fields. It loads: the
   * mode fields keep the values a fresh clock has, and the island's present is taken from where the
   * save says the clock was, which for a save with no scrub in it is the same thing.
   */
  restore(s) {
    if (!s) return;
    this.epochDay = s.epochDay;
    this.tick = s.tick;
    this.minuteOfDay = s.minuteOfDay;
    this.dayIndex = s.dayIndex;
    this.mode = s.mode === 'live' ? 'live' : 'simulated';
    this.startISO = s.startISO || islandISO(this.absoluteMinute);
    this.anchorISO = s.anchorISO || this.startISO;
    this.anchorTick = s.anchorTick || 0;
    this.anchorRealMs = s.anchorRealMs === undefined ? null : s.anchorRealMs;
    this.livedTick = s.livedTick === undefined ? this.tick : s.livedTick;
    this.livedDayIndex = s.livedDayIndex === undefined ? this.dayIndex : s.livedDayIndex;
    this.livedMinuteOfDay = s.livedMinuteOfDay === undefined ? this.minuteOfDay : s.livedMinuteOfDay;
    this.viewOffsetMin = s.viewOffsetMin || 0;
    this.jumps = s.jumps || 0;
    this.segments = Array.isArray(s.segments) && s.segments.length
      ? s.segments.map((x) => ({ from: x.from, to: x.to }))
      : [{ from: (this.epochDay + this.livedDayIndex) * MINUTES_PER_DAY + this.livedMinuteOfDay - this.tick * TICK_MINUTES, to: this.livedAbsoluteMinute }];
    this.record = Array.isArray(s.record) ? s.record.slice() : this.record;
    this.accumulator = 0;
    this._schoolDay = null;
    this._schoolBlock = null;
    this.offRecordMoves = s.offRecordMoves || 0;
    this.seal();
  }
}

/* ================================================================== the time control

   Scrubbing, catching up, and the honest split between what a moment can be recomputed from and
   what has to be lived through. This lives beside the clock rather than in a panel, because a
   panel must not decide what a system is allowed to recompute.

   `main.js` attaches one of these as `world.time`, the same way settings.js attaches
   `world.settings`. Nothing under src/systems/ reads it and nothing needs to. */

/**
 * A system is clock-derived when its published read model is a pure function of the moment: hand
 * it a different clock and it produces that moment's answer with no memory of how it got there.
 *
 * Two qualify today and both say so in their own files. `tide.js` is a harmonic sum evaluated at
 * an hour, so the height, the rate, the phase and every station follow a scrub exactly. `daylight.js`
 * is sun and moon geometry evaluated at a day and a minute, so sunrise, sunset, elevation and the
 * moon follow it exactly too. The calendar is not on this list because it is not a system at all:
 * `src/systems/agents/calendar.js` is a pure helper and the school terms, the long weekends and the
 * public holidays are worked out from the clock wherever they are read.
 *
 * What is deliberately NOT here, and the honest reason:
 *   weather      seeded and stateful. A scrubbed Tuesday has no weather of its own; it would have
 *                to be invented, and an invented forecast presented beside a real tide is the kind
 *                of thing this project exists not to do.
 *   ferry        the timetable is published data and could be evaluated at any minute, but the
 *                sailings the system publishes carry a mechanical failure roll, a roster and a
 *                queue that no amount of arithmetic recreates. A timetable answer beside a stale
 *                queue reads as knowledge the twin does not have.
 *   businesses   the same again. Trading hours are in the pack and are evaluated per minute, but
 *                what the read model publishes is which premises are open *after* a month of
 *                trading decided which of them cut their hours.
 *
 * A system written after this may declare `clockDerived: true` on its registration and it will be
 * picked up without editing this list.
 */
export const CLOCK_DERIVED = ['daylight', 'tide'];

const structuredCopy = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

export function makeTimeControl(world) {
  const clock = world.clock;
  /** Published state of the derived systems as it stood at the island's present, while parked. */
  let held = null;
  let catchup = null;
  const MAX_SCRUB_MIN = 3650 * MINUTES_PER_DAY;   // ten years either way is not a constraint anyone meets

  function derivedIds() {
    const out = [];
    for (const sys of world.systems) {
      if (!sys || !sys.tick) continue;
      if (sys.clockDerived === true || CLOCK_DERIVED.includes(sys.id)) out.push(sys.id);
    }
    return out;
  }

  /** Run the derived systems at whatever moment the clock is now showing. Never the whole world. */
  function recomputeDerived() {
    for (const id of derivedIds()) {
      const sys = world.system(id);
      if (!sys || !sys.tick) continue;
      try { sys.tick(world); } catch (e) {
        world.errors.push({ system: id, phase: 'scrub', message: String(e && e.message || e) });
      }
    }
  }

  /**
   * Take a copy of the derived systems' published state before the first scrub of a parking, so
   * that coming back to the present restores it exactly. Without this, a scrub would leave residue:
   * `tide.js` recomputes its turn list on a change of day, and a scrub across a day boundary would
   * hand the island back a turn list computed at the wrong minute. A scrub is a way of looking, and
   * looking must not change anything.
   */
  function park() {
    if (held) return;
    held = {};
    for (const id of derivedIds()) {
      const st = world.read(id);
      if (st && typeof st === 'object') held[id] = structuredCopy(st);
    }
    clock.speedBeforeScrub = clock.speedIndex;
    clock.speedIndex = 0;
  }

  function unpark() {
    clock.viewOffsetMin = 0;
    clock.dayIndex = clock.livedDayIndex;
    clock.minuteOfDay = clock.livedMinuteOfDay;
    clock.tick = clock.livedTick;
    clock.seal();
    // One recompute at the island's own present first, so anything a system counts internally
    // (tide.js remembers which day it last worked its turns out for) lands back on the value an
    // unscrubbed run would have. Then the published state goes back verbatim over the top.
    recomputeDerived();
    if (held) {
      for (const [id, snap] of Object.entries(held)) {
        const st = world.read(id);
        if (st && typeof st === 'object') Object.assign(st, snap);
      }
      held = null;
    }
    clock.accumulator = 0;
    // The derived state has just been put back exactly as it was before the clock was parked.
    // Anything holding a moment that state is MEASURED FROM has to put its own copy back too.
    // `tide.next` is the case in the build: its hours are counted from whenever tide.js last
    // worked its turns out, the bar tracks that moment, and a scrub across a midnight moves it. A
    // restored turn list read against a scrubbed anchor had the bar reporting the next high water
    // forty minutes out at the island's own present, in the one cell with no HELD tag on it.
    world.bus.emit('clock:restored', { iso: clock.formatISO() });
  }

  /**
   * The moment is this control's to move, and this is what enforces it.
   *
   * Every sanctioned mover in clock.js seals the moment it landed on. If the clock is somewhere
   * else by the time anybody asks, then something wrote `minuteOfDay` or `dayIndex` straight into
   * the clock, and the bar would otherwise carry on saying LIVE over a moment nobody chose. That
   * is precisely what the photo-mode time slider used to do: two clicks and the chip still read
   * LIVE at a time thirteen hours ahead of the real one, with nothing on the record.
   *
   * The answer is not to throw, because a screenshot tool is not a fault. It is to make the moment
   * honest again: the clock is where it is, so declare it as what it is, a scrub away from the
   * island's present, park it, recompute the two systems that can answer for a scrubbed moment,
   * count it and write it on the record. The bar then says PROJECTION or LOOKING BACK, "Back to
   * now" appears, and `toPresent()` works, none of which was true before.
   *
   * One thing cannot be undone and the note says so: the derived state as it stood before the
   * direct write was never snapshotted, because nothing knew a scrub was starting. Coming back to
   * the present recomputes it rather than restoring it. For `daylight` and `tide` that lands on
   * the same numbers, both being pure functions of the moment.
   *
   * Called from `status()` at 10 Hz, which is one subtraction when nothing is wrong.
   */
  function reconcile() {
    // A snapshot taken for a parking that the island then ticked out of is void. `advance()` zeroes
    // the offset itself when something ticks a parked clock, so the clock is at its own present
    // again and the held copy describes a moment that has been overtaken. Restoring it later would
    // put stale numbers over state the island actually lived through.
    if (held && !clock.scrubbing) held = null;
    const drift = clock.driftMinutes();
    if (drift === 0) return 0;
    clock.seal();
    clock.offRecordMoves++;
    clock.viewOffsetMin = clock.absoluteMinute - clock.livedAbsoluteMinute;
    if (clock.viewOffsetMin !== 0 && !held) {
      clock.speedBeforeScrub = clock.speedIndex;
      clock.speedIndex = 0;
      // Marks the clock as parked. There is nothing in it to restore, and that is the point.
      held = {};
    }
    recomputeDerived();
    clock.note('the moment moved ' + spanText(drift, { zero: 'nowhere' })
      + (drift > 0 ? ' forward' : ' back') + ' outside the time control, and is now declared a scrub');
    world.bus.emit('clock:offrecord', { minutes: drift, iso: clock.formatISO(), total: clock.offRecordMoves });
    return drift;
  }

  /** What the interface needs, in one cheap object. Called at 10 Hz, so it allocates one object. */
  function status() {
    reconcile();
    const viewed = clock.absoluteMinute;
    const lived = clock.livedAbsoluteMinute;
    const real = realIslandMinute();
    return {
      mode: clock.mode,
      declared: clock.declaredMode,
      scrubbing: clock.scrubbing,
      offsetMin: clock.viewOffsetMin,
      viewedMinute: viewed,
      livedMinute: lived,
      segments: clock.segments,
      realMinute: real,
      aheadOfRealMin: viewed - real,
      catchup: catchup ? { done: catchup.done, total: catchup.total, msPerTick: catchup.msPerTick } : null,
      derived: derivedIds(),
      offRecordMoves: clock.offRecordMoves
    };
  }

  const api = {
    status,
    derivedIds,
    recomputeDerived,
    reconcile,

    /**
     * Put the moment on screen at a given minute of the day, on whatever day is on screen. The
     * photo-mode time slider is the one caller: it moves a moment and so it comes through here.
     */
    scrubToMinuteOfDay(minuteOfDay) {
      reconcile();
      const want = Math.round(minuteOfDay / TICK_MINUTES) * TICK_MINUTES;
      const target = Math.max(0, Math.min(MINUTES_PER_DAY - TICK_MINUTES, want));
      const dayStart = clock.absoluteMinute - clock.minuteOfDay;
      return api.scrubTo(dayStart + target - clock.livedAbsoluteMinute);
    },

    /** Park the clock `offsetMin` away from the island's present and let the derived world follow. */
    scrubTo(offsetMin) {
      if (catchup) return status();
      reconcile();
      const snapped = Math.round(offsetMin / TICK_MINUTES) * TICK_MINUTES;
      const want = Math.max(-MAX_SCRUB_MIN, Math.min(MAX_SCRUB_MIN, snapped));
      if (want === 0) return api.toPresent();
      park();
      clock.viewOffsetMin = want;
      clock.setAbsoluteMinute(clock.livedAbsoluteMinute + want);
      recomputeDerived();
      world.bus.emit('clock:scrub', { offsetMin: want, iso: clock.formatISO() });
      return status();
    },

    scrubBy(minutes) { return api.scrubTo(clock.viewOffsetMin + minutes); },

    /** Back to the moment the island has actually lived to, with no residue. */
    toPresent() {
      reconcile();
      if (!clock.scrubbing && !held) return status();
      unpark();
      clock.speedIndex = clock.speedBeforeScrub || 0;
      recomputeDerived();
      world.bus.emit('clock:present', { iso: clock.formatISO() });
      return status();
    },

    /** Enter live. Returns what moved, so the caller can put it on screen. */
    goLive() {
      if (catchup) api.cancelCatchup();
      reconcile();
      if (clock.scrubbing || held) unpark();
      const moved = clock.goLive();
      recomputeDerived();
      world.bus.emit('clock:mode', { mode: 'live', moved, iso: clock.formatISO() });
      return moved;
    },

    /** Leave live and run forward from here as a simulation. */
    goSimulated(reason = 'simulated time was chosen') {
      reconcile();
      if (clock.mode !== 'live') return null;
      const n = clock.leaveLive(reason);
      world.bus.emit('clock:mode', { mode: 'simulated', iso: clock.formatISO() });
      return n;
    },

    /**
     * Turn a projection into lived time: run the ticks the island skipped, in slices small enough
     * that the page keeps drawing. This is the expensive option and the interface says how many
     * ticks it is about to run before it starts. A slice is capped by time rather than by tick
     * count, so a heavy island takes fewer ticks a frame rather than dropping frames.
     *
     * Driven by the frame, not by a timer. A browser stops drawing a tab nobody is looking at, and
     * the island should stop living through time at exactly the moment it stops being drawn: a
     * timer would keep grinding in a background tab, and a clamped timer would stall while the
     * progress readout claimed to be working.
     */
    catchUp(opts = {}) {
      if (catchup) return catchup;
      reconcile();
      const gap = clock.viewOffsetMin;
      if (gap <= 0) return null;
      const total = Math.round(gap / TICK_MINUTES);
      // The speed to come back to is the one from before the clock was parked, not the zero that
      // parking put there, or every catch-up would hand the island back paused.
      const heldSpeed = (clock.scrubbing || held) ? (clock.speedBeforeScrub || 0) : clock.speedIndex;
      unpark();
      catchup = { total, done: 0, msPerTick: null, cancelled: false, sliceMs: opts.sliceMs || 12, heldSpeed };
      clock.speedIndex = 0;
      const schedule = (fn) => (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => fn())
        : setTimeout(fn, 0));
      const step = () => {
        if (!catchup || catchup.cancelled) return;
        const t0 = performance.now();
        let ran = 0;
        while (catchup.done < catchup.total && performance.now() - t0 < catchup.sliceMs) {
          world.step();
          catchup.done++;
          ran++;
        }
        const dt = performance.now() - t0;
        if (ran) catchup.msPerTick = +(dt / ran).toFixed(2);
        world.bus.emit('clock:catchup', { done: catchup.done, total: catchup.total, msPerTick: catchup.msPerTick });
        if (catchup.done >= catchup.total) {
          const summary = { total: catchup.total, msPerTick: catchup.msPerTick };
          clock.speedIndex = catchup.heldSpeed;
          catchup = null;
          clock.note('lived through ' + summary.total + ' ticks that had been a projection');
          world.bus.emit('clock:caughtup', summary);
          if (typeof opts.onDone === 'function') opts.onDone(summary);
          return;
        }
        schedule(step);
      };
      schedule(step);
      return catchup;
    },

    /** Stop part way. The ticks already run are lived through and stay; nothing is unwound. */
    cancelCatchup() {
      if (!catchup) return null;
      catchup.cancelled = true;
      const summary = { total: catchup.total, done: catchup.done, msPerTick: catchup.msPerTick };
      clock.speedIndex = catchup.heldSpeed;
      catchup = null;
      clock.note('stopped after living through ' + summary.done + ' of ' + summary.total + ' ticks');
      world.bus.emit('clock:catchup-cancelled', summary);
      return summary;
    },

    /**
     * A check a critic can run: park, look somewhere else, come back, and prove the derived state
     * is bit-for-bit what it was. If this ever returns false, scrubbing has become a way of
     * changing the island rather than a way of looking at it.
     */
    scrubResidue(offsetMin = 6 * MINUTES_PER_DAY) {
      // From the present, and back to the present. Called while the clock was already parked, the
      // comparison would be a scrubbed state against a present one and would always report a
      // change, which is the sort of check that teaches people to ignore checks.
      api.toPresent();
      const before = {};
      for (const id of derivedIds()) before[id] = JSON.stringify(world.read(id));
      api.scrubTo(offsetMin);
      api.toPresent();
      const out = { clean: true, systems: {} };
      for (const id of derivedIds()) {
        const same = JSON.stringify(world.read(id)) === before[id];
        out.systems[id] = same ? 'unchanged' : 'CHANGED';
        if (!same) out.clean = false;
      }
      return out;
    }
  };

  return api;
}
