// The source ladder. Where a number about the real island came from, ranked, resolved one field at
// a time, at a moment somebody names.
//
// WHY THIS IS NOT IN tools/ AND NOT IN THE WEATHER SYSTEM
//   `docs/CONNECTORS.md` sets the rule out in full under "The source ladder, and why weather must
//   not be a two-way switch". The owner said what is coming: their own weather stations, beach
//   cameras and drone reports. So `live ? openMeteo : model` is the wrong shape, because it would
//   have to be rewritten the day a mast goes up on the surf club roof. A ranked ladder resolved per
//   field means adding that mast is a data change and not a code change.
//
//   That only holds if the connector that writes a record and the system that reads it agree about
//   what the rungs are. So the ladder lives here, in a module node loads out of
//   `tools/connectors/lib.mjs` and the browser loads out of a system, exactly as
//   `src/world/freshness.js` does and for exactly the same reason. Two copies of a ladder is two
//   ladders.
//
// WHY THIS MODULE READS NO CLOCK
//   It takes the moment as an argument. The connector passes the real datetime it ran at; the twin
//   passes whatever moment its own declared clock is at. Same function, same answer, and a live
//   session still replays because the moment came off the clock's record and not off the wall.
//
// It imports one thing, `src/world/freshness.js`, which imports nothing.

import { observedAt, OBSERVATION_STALE_AFTER_MINUTES, agoText } from './freshness.js';

/**
 * The four rungs, best first. Each answers for a field, never for the whole of a subject.
 *
 * `beats_below` is the reason the order is this order, kept beside the rung rather than in a
 * document, because the next person to add a rung has to argue with it.
 */
export const SOURCE_RUNGS = [
  {
    rung: 1,
    id: 'island-instrument',
    label: 'island instrument',
    what: 'a station, a gauge or a sensor at a real place on this island',
    beats_below: 'it is the actual thing, here, now',
    measured: true
  },
  {
    rung: 2,
    id: 'official-observation',
    label: 'official observation',
    what: 'a reading from an official station, through a service its owner publishes for the purpose',
    beats_below: 'it is measured rather than computed, but it is not measured on this island',
    measured: true
  },
  {
    rung: 3,
    id: 'model',
    label: 'model',
    what: 'model output for the grid cell nearest this island',
    beats_below: 'it is real physics run over real inputs, which is more than a seeded pattern is',
    measured: false
  },
  {
    rung: 4,
    id: 'synoptic-simulation',
    label: 'simulation',
    what: 'this twin\'s own seeded synoptic model',
    beats_below: 'nothing. It is the floor, and it is the only rung that can answer for a moment '
      + 'that has not happened',
    measured: false
  }
];

const BY_ID = new Map(SOURCE_RUNGS.map((r) => [r.id, r]));
const BY_RUNG = new Map(SOURCE_RUNGS.map((r) => [r.rung, r]));

export const SIMULATION_RUNG = 4;

/** The rung entry for an id or a number, or null. Nothing here invents a fifth rung. */
export function rungOf(idOrNumber) {
  if (typeof idOrNumber === 'number') return BY_RUNG.get(idOrNumber) || null;
  return BY_ID.get(String(idOrNumber)) || null;
}

/**
 * Resolve every field one source record or another can answer for, at a given moment.
 *
 * Takes the records a feed carries. Each record declares a `rung` and a list of `readings`, and
 * each reading carries the field it answers for, its value, the moment it is for, and how long a
 * reading of that field may be believed. Returns the winner per field with the whole ladder that
 * was climbed to get there, so a panel can say not only what won but what lost and why.
 *
 * THE TWO RULES, AND THEY ARE THE WHOLE FUNCTION:
 *
 *   PER FIELD, NOT PER SOURCE. A station on the surf club roof may have wind and no swell. The
 *   wind comes off rung one and the swell off rung three, and each says so. One "source:
 *   Open-Meteo" line over a panel where half the numbers came from a mast is a lie of omission.
 *
 *   FRESHNESS DEMOTES. A stale reading does not win, whatever rung it sits on. That is not a second
 *   rule bolted on: the shelf lives in `OBSERVATION_STALE_AFTER_MINUTES` are per field, so an
 *   hour-old rung one rain reading is already past its twenty-five minutes and is out, while an
 *   hour-old rung one temperature is inside its three hours and still wins. The example in
 *   docs/CONNECTORS.md falls out of the table rather than needing code of its own.
 */
export function resolveObservations(records, isoNow) {
  const byField = {};
  const considered = {};
  const providers = [];
  const seenProvider = new Set();

  for (const rec of records || []) {
    if (!rec || !Array.isArray(rec.readings)) continue;
    const entry = rungOf(rec.rung) || rungOf(rec.rung_id);
    if (!entry || entry.rung >= SIMULATION_RUNG) continue;   // rung four is not a record, it is the floor
    const observedIso = (rec.freshness && rec.freshness.observed_at) || rec.modelled_for || null;

    for (const reading of rec.readings) {
      if (!reading || typeof reading.value !== 'number' || !isFinite(reading.value)) continue;
      const field = reading.field;
      if (!field) continue;
      const shelf = OBSERVATION_STALE_AFTER_MINUTES[field] || OBSERVATION_STALE_AFTER_MINUTES.default;
      const limit = Number(reading.stale_after_minutes) > 0 ? Number(reading.stale_after_minutes) : shelf.minutes;
      const at = reading.observed_at || observedIso;
      const age = observedAt(at, isoNow, limit);

      const candidate = {
        field,
        value: reading.value,
        unit: reading.unit || null,
        rung: entry.rung,
        rungId: entry.id,
        rungLabel: entry.label,
        measured: entry.measured,
        provider: rec.provider || null,
        recordId: rec.id || null,
        observedAt: at,
        ageMin: age.ageMin,
        limitMin: age.limitMin,
        freshness: age.state,
        ago: agoText(age.ageMin),
        why: reading.stale_after_reason || shelf.why
      };
      (considered[field] || (considered[field] = [])).push(candidate);

      // Stale and unknown never win. A reading past its own shelf life is not a demotion, it is an
      // absence, and the rung below gets its turn.
      if (age.state === 'stale' || age.state === 'unknown') continue;

      const held = byField[field];
      const better = !held
        || candidate.rung < held.rung
        || (candidate.rung === held.rung && (candidate.ageMin ?? 1e9) < (held.ageMin ?? 1e9));
      if (better) byField[field] = candidate;
    }

    if (rec.provider && rec.attribution && !seenProvider.has(rec.provider)) {
      seenProvider.add(rec.provider);
      providers.push({
        provider: rec.provider,
        licence: rec.licence || null,
        attribution: rec.attribution,
        url: rec.provider_url || null,
        rung: entry.rung,
        rungLabel: entry.label,
        basis: rec.basis || null
      });
    }
  }

  // Attribution is only owed to a source whose figure is actually on screen. A provider whose every
  // reading went stale is not being used, and thanking it for numbers nobody is looking at would be
  // as misleading as not thanking it for numbers they are.
  const inUse = new Set(Object.values(byField).map((c) => c.provider).filter(Boolean));
  for (const p of providers) p.in_use = inUse.has(p.provider);

  return { byField, considered, providers };
}

/**
 * The one sentence a panel puts under a set of numbers, built from what actually won.
 *
 * Named rather than assembled at each call site so that every surface says it the same way, and so
 * that the sentence changes in one place when a rung is added.
 */
export function ladderSentence(byField, { declaredMode = 'simulated' } = {}) {
  const fields = Object.keys(byField || {});
  if (!fields.length) {
    return declaredMode === 'live'
      ? 'No real reading is current, so nothing here is a statement about the island right now.'
      : 'The island is running its own weather, because a moment that has not happened cannot be observed.';
  }
  const counts = new Map();
  for (const f of fields) {
    const c = byField[f];
    counts.set(c.rungLabel, (counts.get(c.rungLabel) || 0) + 1);
  }
  const parts = [...counts.entries()].map(([label, n]) => `${n} from ${label}`);
  return parts.join(', ') + '. Every number says which.';
}
