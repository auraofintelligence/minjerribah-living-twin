// Freshness. How old a fact about the real world is, said in one vocabulary, in one place.
//
// WHY THIS IS NOT IN tools/
//   `docs/CONNECTORS.md` holds freshness as a first-class property: nothing drawn from a synced
//   source appears without its sync date beside it, and a stale record says the word "stale" where
//   it is drawn. A rule like that is worth nothing if the connector layer and the interface each
//   own a copy of it, because the copies drift and only one of them is on screen. So the vocabulary
//   lives here, in a module the browser loads and `tools/connectors/lib.mjs` imports, and there is
//   exactly one implementation of `freshnessAt`.
//
// WHY THIS MODULE READS NO CLOCK
//   It takes the moment as an argument and never asks the machine what time it is. That is the
//   whole trick that lets `docs/CONTRACT.md` and a real opening hour hold at once. The connector
//   layer passes the real datetime it ran at; the running twin passes the moment its own declared
//   clock is at. Same function, same answer, and a session replays because the moment came off the
//   clock's record rather than off the wall.
//
//   `src/kernel/clock.js` has three declared modes and says which on screen. `freshnessMoment()`
//   below turns whichever one is in force into the moment an age is counted against, plus the
//   sentence a panel puts underneath so a player knows what it was counted against. In live the
//   island's clock is the real Queensland moment, so counting against it is counting against the
//   wall clock. In simulated it is a declared calendar that started from a moment on the record.
//   In scrub it is wherever the player has parked the view, and if that is before the day somebody
//   checked a fact, this says so rather than pretending the check has happened.
//
// This module imports nothing, on purpose: node loads it out of a connector and the browser loads
// it out of a panel, and neither needs the other's world.

/** The four words. Nothing anywhere may invent a fifth. */
export const FRESHNESS_STATES = ['fresh', 'ageing', 'stale', 'unknown'];

/**
 * How long a fact of a given kind may be believed before the interface says so out loud.
 *
 * These are policy, not measurement, and each carries its reason. A connector record overrides
 * whichever of these applies with its own `stale_after_days`, declared by the connector against
 * the cadence its source is actually synced on.
 */
export const STALE_AFTER_DAYS = {
  // An island business changes its hours with the season and there are four of them, so a check
  // older than one season is a check that has not seen the season the player is standing in.
  hours: 90,
  // Anything with no declared limit. Deliberately short: a fact nobody has given a shelf life to
  // is a fact nobody has thought about.
  default: 30
};

/**
 * Read `2026-08-10`, `2026-08-10T14:20`, `2026-08-10 14:20:11` or `2026-08-10T14:20:11+10:00` as
 * island wall-clock minutes.
 *
 * The trailing offset is deliberately ignored rather than honoured. Every stamp this project
 * writes is already in the island's own offset, and reading the wall-clock fields keeps a date-only
 * stamp and a datetime stamp on the same scale. Honouring the offset on one and not the other is
 * how a check made this morning ends up a day old.
 */
function islandMinutes(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(iso == null ? '' : iso).trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) / 60000;
}

/** Whole days from the first moment to the second. Negative when the second is earlier. */
export function daysBetween(isoA, isoB) {
  const a = islandMinutes(isoA);
  const b = islandMinutes(isoB);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / 1440);
}

/** Whole minutes from the first moment to the second. Negative when the second is earlier. */
export function minutesBetween(isoA, isoB) {
  const a = islandMinutes(isoA);
  const b = islandMinutes(isoB);
  if (a === null || b === null) return null;
  return Math.floor(b - a);
}

/**
 * How long one weather reading may be believed, in minutes, one field at a time.
 *
 * A day is the wrong unit for weather and a single number is the wrong shape. An hour-old
 * temperature is still worth having, because air warms and cools with the sun and it takes hours to
 * do it. An hour-old rain reading is worth nothing at all, because rain on this island arrives in
 * cells that cross a township in twenty minutes, and a reading half an hour old can be a dry road
 * under a black sky or the other way about. So the shelf life sits on the field rather than on the
 * record, and the interface says which fields it is still standing on.
 *
 * These are policy, not measurement, written where they can be argued with. The ordering is the
 * argument: the faster a thing changes on this coast, the shorter its shelf life.
 */
export const OBSERVATION_STALE_AFTER_MINUTES = {
  rainMmHr: { minutes: 25, why: 'Rain here arrives in cells. Half an hour is the difference between a wet road and a dry one.' },
  gustKt: { minutes: 45, why: 'A gust figure is the peak over the interval it was measured in, and it is the number that decides whether a barge master sails.' },
  windKt: { minutes: 90, why: 'The nor\'easter builds and drops over about two hours, so ninety minutes is roughly half a turn of it.' },
  windDirDeg: { minutes: 90, why: 'The direction turns with the sea breeze on the same clock as the speed.' },
  cloud: { minutes: 90, why: 'Cloud makes and clears in an hour on a storm day, and holds all afternoon on a ridge day.' },
  tempC: { minutes: 180, why: 'Air temperature follows the sun and takes hours to move a useful amount.' },
  apparentC: { minutes: 180, why: 'It is built from temperature, humidity and wind, so it moves no faster than the slowest of them.' },
  humidity: { minutes: 180, why: 'Humidity swings with the sea breeze and the dew point, both of which are hours-scale here.' },
  pressure: { minutes: 360, why: 'Surface pressure is a synoptic-scale number. Six hours of it is one small step on a chart.' },
  swellM: { minutes: 360, why: 'Total sea height builds and decays over hours as the local wind works on it.' },
  swellPeriodS: { minutes: 360, why: 'Period follows the same sea that produced the height.' },
  swellDirDeg: { minutes: 360, why: 'Direction follows the same sea again.' },
  groundSwellM: { minutes: 720, why: 'Ground swell is generated a long way offshore and takes the better part of a day to change character.' },
  groundSwellPeriodS: { minutes: 720, why: 'The long period is the slowest-moving number in the whole set.' },
  groundSwellDirDeg: { minutes: 720, why: 'Swell direction turns as slowly as the system that made it.' },
  /** Anything with no declared limit. Short on purpose: a reading nobody has given a shelf life to is a reading nobody has thought about. */
  default: { minutes: 60, why: 'No shelf life was declared for this field, so it gets the shortest defensible one.' }
};

/**
 * How old one reading is at a given moment, in the same four words and on the same thirds rule as
 * `freshnessAt`, but counted in minutes.
 *
 * Reads no clock, exactly as the rest of this module reads none: the connector layer passes the
 * real datetime it ran at, and the running twin passes the moment its own declared clock is at.
 */
export function observedAt(observedIso, isoNow, staleAfterMinutes) {
  const limit = Number(staleAfterMinutes) > 0
    ? Number(staleAfterMinutes)
    : OBSERVATION_STALE_AFTER_MINUTES.default.minutes;
  const age = minutesBetween(observedIso, isoNow);
  if (age === null) return { state: 'unknown', ageMin: null, limitMin: limit, note: 'no observation time on this reading' };
  if (age < 0) return { state: 'unknown', ageMin: age, limitMin: limit, note: 'observed after the moment being asked about' };
  if (age <= Math.ceil(limit / 3)) return { state: 'fresh', ageMin: age, limitMin: limit, note: '' };
  if (age <= limit) return { state: 'ageing', ageMin: age, limitMin: limit, note: '' };
  return { state: 'stale', ageMin: age, limitMin: limit, note: 'older than this reading may be believed for' };
}

/** How long ago, as the words a panel puts on screen. Minutes while minutes mean something. */
export function agoText(ageMin) {
  if (ageMin === null || ageMin === undefined) return 'at an unknown time';
  if (ageMin < 0) return 'from later than the moment on screen';
  if (ageMin < 1) return 'just now';
  if (ageMin < 60) return `${ageMin} min ago`;
  const h = Math.floor(ageMin / 60);
  const m = ageMin % 60;
  if (h < 24) return m ? `${h} h ${m} min ago` : `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/**
 * How old a record is, computed by whoever is looking rather than baked in when it was written.
 *
 * A feed cannot know how stale it will be when somebody reads it, so it records `synced_at` and
 * `stale_after_days` and nothing else. Fresh to a third of the limit, ageing to the limit, stale
 * past it. Takes either a whole record or a bare freshness block.
 */
export function freshnessAt(record, isoNow) {
  const f = (record && record.freshness) || record || {};
  const age = daysBetween(f.synced_at, isoNow);
  if (age === null) return { state: 'unknown', ageDays: null, note: 'no sync stamp on this record' };
  const limit = Number(f.stale_after_days) || STALE_AFTER_DAYS.default;
  if (age < 0) return { state: 'unknown', ageDays: age, note: 'synced after the moment being asked about' };
  if (age <= Math.ceil(limit / 3)) return { state: 'fresh', ageDays: age, note: '' };
  if (age <= limit) return { state: 'ageing', ageDays: age, note: '' };
  return { state: 'stale', ageDays: age, note: 'past the cadence this source is synced on' };
}

/**
 * The moment an age is counted against, taken off the clock's declared mode rather than the
 * machine's wall clock.
 *
 * Duck-typed on two public members of `src/kernel/clock.js`, `declaredMode` and `formatISO()`, so
 * this module still imports nothing and the kernel is untouched. Called with no clock at all it
 * returns a null moment and says so, which is what a headless caller with no world gets.
 */
export function freshnessMoment(clock) {
  const declared = (clock && clock.declaredMode) || 'simulated';
  const iso = clock && typeof clock.formatISO === 'function' ? clock.formatISO() : null;
  const countedAgainst = declared === 'live'
    ? 'the real Queensland moment, which is what this clock shows while it is live'
    : declared === 'scrub'
      ? 'the moment the clock has been scrubbed to rather than the island’s present'
      : 'the island’s own clock, which is simulated and started from a moment on its record';
  return { iso, declared, countedAgainst };
}

/**
 * A checked date and a moment, turned into the words a panel puts on screen.
 *
 * Returns four things and a caller uses whichever it has room for:
 *
 *   state     one of the four words, for a chip or a tone
 *   ageDays   the number, for anything that wants to do its own arithmetic
 *   phrase    "checked 40 days ago", in the same plain vocabulary the panel used before this
 *             module existed. What changed is not the words, it is which clock they count from
 *   standing  "ageing" or "stale" and empty when fresh, because a panel that said "and fresh"
 *             on every card would be noise and the rule is only that stale says stale
 *
 * `docs/CONNECTORS.md` requires the date beside the fact and the word rather than a colour alone.
 */
export function checkedPhrase(checkedIso, moment, staleAfterDays = STALE_AFTER_DAYS.hours) {
  const bare = (phrase) => ({ state: 'unknown', ageDays: null, phrase, standing: '' });
  if (!checkedIso) return bare('nobody has checked');
  const isoNow = moment && moment.iso;
  if (!isoNow) return bare(`checked ${checkedIso}`);

  const f = freshnessAt({ freshness: { synced_at: checkedIso, stale_after_days: staleAfterDays } }, isoNow);
  if (f.state === 'unknown') {
    // The scrub case, and it is worth saying rather than hiding: the player has moved the view to
    // a moment before anybody went and looked, so on screen the check has not happened yet.
    if (f.ageDays !== null && f.ageDays < 0) {
      return { state: 'unknown', ageDays: f.ageDays, phrase: `checked on ${checkedIso}, which is later than the moment on screen`, standing: '' };
    }
    return bare(`checked ${checkedIso}`);
  }

  // Days for as long as days are the useful unit. The limits here run in months, so rounding 40
  // days up to "about a month" would round away the difference between a check inside the season
  // and one outside it, which is the only thing the number is for.
  const d = f.ageDays;
  const months = Math.round(d / 30);
  const phrase = d <= 0 ? 'checked today'
    : d === 1 ? 'checked yesterday'
      : d < 120 ? `checked ${d} days ago`
        : d < 730 ? `checked about ${months} ${months === 1 ? 'month' : 'months'} ago`
          : `checked on ${checkedIso}, years ago`;
  return { state: f.state, ageDays: d, phrase, standing: f.state === 'fresh' ? '' : f.state };
}
