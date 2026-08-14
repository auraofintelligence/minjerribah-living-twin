// Connector: weather and sea state, from Open-Meteo.
//
//   node tools/connectors/sync.mjs --id weather
//   node tools/connectors/sync.mjs --id weather --inbox C:/some/folder     read saved responses
//   node tools/connectors/sync.mjs --id weather --dry-run
//
// WHY THIS CONNECTOR EXISTS
// A twin of a real island, opened live, showing invented weather is a demonstration wearing a
// twin's clothes. The synoptic model in src/systems/environment/weather.js is a good model and it
// stays, because a simulated Tuesday and a scrubbed Tuesday have no observation and cannot have
// one. What it stops being is the only answer. When the clock says live, the island shows what a
// weather model has for this coast right now, with the moment it is for printed beside it.
//
// THE ONE PLACE THIS LAYER TOUCHES A NETWORK, AND WHY IT IS STILL AN OFFLINE STEP
// Every other connector here reads a local checkout of somebody's repository. There is no local
// checkout of the weather. So this one fetches, from two named hosts and nothing else, when a
// person or a scheduled job runs it, and writes a stamped feed. The running twin reads that feed
// off its own origin at boot and never touches a network. Same seed plus same packs plus same feed
// still gives the same island, because the feed is a committed file and not a live socket. That is
// the same shape tools/ingest/lane-legislation.mjs already has for the two legislation registers.
//
// Give it --inbox and it fetches nothing at all: it reads `open-meteo-forecast.json` and
// `open-meteo-marine.json` out of that folder, which is how a machine with no network, or a person
// who would rather save the two responses by hand, still syncs.
//
// WHAT THIS IS, SAID PLAINLY
// Open-Meteo serves model output for a grid cell. It is not a reading from an instrument at Point
// Lookout. The word "model" appears everywhere this surfaces and the word "observed" appears
// nowhere, and the connector measures and records how far the cell it answered for sits from the
// point that was asked about, because the response names its own coordinates and they are not the
// ones in the request. On 14 August 2026 the land cell came back about 11 km from Point Lookout and
// the marine cell about 3 km off it. A twin that hid that would be claiming a precision it has not
// got.
//
// THE SOURCE THAT WAS REFUSED
// api.weather.bom.gov.au works, Point Lookout has its own geohash on it, and every response carries
// a notice from the Bureau saying it owns the interface and that you must not use, copy or share
// it. It was considered and refused. See `checkBomWeatherApi` in tools/connectors/refusals.mjs and
// the entry in docs/CONNECTORS.md, so that nobody rediscovers it and assumes nobody looked.

import fs from 'node:fs';
import path from 'node:path';
import { nowIso, envelope, screenRecord, screenWanted, quoted } from './lib.mjs';
import { connector as declared, CONNECTOR_VERSION } from './registry.mjs';
import { OBSERVATION_STALE_AFTER_MINUTES } from '../../src/world/freshness.js';
import { rungOf } from '../../src/world/observations.js';

export const ID = 'weather';

/**
 * Rung three on the ladder in docs/CONNECTORS.md, and this connector says so on every record it
 * writes rather than leaving the twin to infer it from the provider's name.
 *
 * Open-Meteo is model output. It sits below an island instrument and below an official station
 * reading, and above this twin's own synoptic simulation, and the day a mast goes up on the surf
 * club roof its records arrive stamped rung one and win the fields they carry with no code change
 * anywhere. That is the whole reason the rung is a number in a file.
 */
const RUNG = rungOf('model');

/** The point this twin is about. Point Lookout for the air, the water off the Gorge for the sea. */
export const ASKED_FOR = {
  land: { lat: -27.43, lng: 153.54, about: 'Point Lookout' },
  marine: { lat: -27.43, lng: 153.56, about: 'the water off Point Lookout and the North Gorge' }
};

export const ENDPOINTS = {
  land: 'https://api.open-meteo.com/v1/forecast?latitude=-27.43&longitude=153.54'
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,'
    + 'wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure&timezone=Australia%2FBrisbane',
  marine: 'https://marine-api.open-meteo.com/v1/marine?latitude=-27.43&longitude=153.56'
    + '&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,'
    + 'swell_wave_direction&timezone=Australia%2FBrisbane'
};

/** The licence's own words, and the string that has to appear on screen and not only in a file. */
export const LICENCE = 'CC BY 4.0';
export const ATTRIBUTION = 'Weather data by Open-Meteo.com, CC BY 4.0';
export const PROVIDER_URL = 'https://open-meteo.com/';

/**
 * How each field the source returns becomes a field this twin already publishes.
 *
 * The conversion happens here, at ingest, for the same reason coarsening does: a transform at
 * display time is a place for non-determinism to hide, and the twin should read a number in the
 * unit it thinks in. The source's own value and unit are carried beside the converted one so
 * nothing is thrown away and anybody can check the arithmetic.
 *
 * `wave_*` becomes this twin's `swell*`, and that is a judgement worth stating. Open-Meteo splits
 * the sea into a total (`wave_height`) and a long-period swell partition (`swell_wave_height`).
 * What `swellM` has always meant in this build is the height of the sea on the ocean beaches: it is
 * what shuts the beach, shortens the drivable window and decides whether the Gorge is worth the
 * walk. That is the total, so the total feeds it, and the swell partition is carried separately as
 * `groundSwell*` rather than folded in and lost.
 */
const FIELD_MAP = {
  land: [
    { from: 'temperature_2m', field: 'tempC', unit: '\u00b0C' },
    { from: 'apparent_temperature', field: 'apparentC', unit: '\u00b0C' },
    { from: 'relative_humidity_2m', field: 'humidity', unit: 'fraction 0 to 1', convert: (v) => v / 100 },
    { from: 'precipitation', field: 'rainMmHr', unit: 'mm/h' },
    { from: 'wind_speed_10m', field: 'windKt', unit: 'kt', convert: (v) => v / 1.852 },
    { from: 'wind_direction_10m', field: 'windDirDeg', unit: '\u00b0' },
    { from: 'wind_gusts_10m', field: 'gustKt', unit: 'kt', convert: (v) => v / 1.852 },
    { from: 'cloud_cover', field: 'cloud', unit: 'fraction 0 to 1', convert: (v) => v / 100 },
    { from: 'surface_pressure', field: 'pressure', unit: 'hPa' }
  ],
  marine: [
    { from: 'wave_height', field: 'swellM', unit: 'm' },
    { from: 'wave_period', field: 'swellPeriodS', unit: 's' },
    { from: 'wave_direction', field: 'swellDirDeg', unit: '\u00b0' },
    { from: 'swell_wave_height', field: 'groundSwellM', unit: 'm' },
    { from: 'swell_wave_period', field: 'groundSwellPeriodS', unit: 's' },
    { from: 'swell_wave_direction', field: 'groundSwellDirDeg', unit: '\u00b0' }
  ]
};

/** Great-circle metres. Used for one thing: how far the grid cell is from the place asked about. */
function metresBetween(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/**
 * Fetch one endpoint. The only outward call in tools/connectors, and it is here rather than in
 * lib.mjs so that a grep for `fetch` in this directory lands in one file with this comment on it.
 */
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) throw new Error(`${url} answered ${res ? res.status : 'nothing'}`);
  return res.json();
}

function readInbox(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    throw new Error(`--inbox was given and ${file} is not there. Save the two responses as `
      + 'open-meteo-forecast.json and open-meteo-marine.json, or drop --inbox and let this fetch them.');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Turn one endpoint's response into the readings this twin can use, with their shelf lives. */
function readingsFrom(which, payload) {
  const current = (payload && payload.current) || {};
  const units = (payload && payload.current_units) || {};
  const out = [];
  for (const spec of FIELD_MAP[which]) {
    const raw = current[spec.from];
    if (typeof raw !== 'number' || !isFinite(raw)) continue;
    const shelf = OBSERVATION_STALE_AFTER_MINUTES[spec.field] || OBSERVATION_STALE_AFTER_MINUTES.default;
    const value = spec.convert ? spec.convert(raw) : raw;
    out.push({
      field: spec.field,
      from: spec.from,
      value: Math.round(value * 1000) / 1000,
      unit: spec.unit,
      source_value: raw,
      source_unit: units[spec.from] || null,
      stale_after_minutes: shelf.minutes,
      stale_after_reason: shelf.why
    });
  }
  return out;
}

export async function sync({ inbox = null } = {}) {
  const spec = declared(ID);
  const syncId = nowIso();
  const usedInbox = typeof inbox === 'string' && inbox.length > 0;

  const payloads = {};
  for (const which of ['land', 'marine']) {
    payloads[which] = usedInbox
      ? readInbox(inbox, which === 'land' ? 'open-meteo-forecast.json' : 'open-meteo-marine.json')
      : await getJson(ENDPOINTS[which]);
  }

  const records = [];
  const held = [];
  const wanted = [];
  const counts = { readings: 0, kept: 0, held: 0, endpoints: 2 };

  const add = (rec) => {
    const screen = screenRecord(rec);
    if (screen.ok) { records.push(rec); return true; }
    held.push({ id: rec.id, kind: rec.kind, reasons: screen.reasons });
    return false;
  };
  const addWanted = (entry) => {
    const screen = screenWanted(entry);
    if (!screen.ok) { held.push({ id: entry.id, kind: 'wanted-list-entry', reasons: screen.reasons }); return false; }
    wanted.push(screen.entry);
    return true;
  };

  for (const which of ['land', 'marine']) {
    const payload = payloads[which];
    const current = (payload && payload.current) || {};
    const served = { lat: payload.latitude, lng: payload.longitude };
    const asked = ASKED_FOR[which];
    const offsetM = (typeof served.lat === 'number' && typeof served.lng === 'number')
      ? metresBetween(asked, served) : null;
    const readings = readingsFrom(which, payload);
    counts.readings += readings.length;

    const rec = envelope({
      id: `openmeteo-${which}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `${which === 'land' ? 'api' : 'marine-api'}.open-meteo.com current, modelled for `
        + `${current.time || 'an unstamped moment'} ${payload.timezone_abbreviation || ''}`.trim(),
      // The verbatim thing this record rests on is the response's own current block. It is short,
      // it is machine-checkable, and it is the sentence a person would quote if asked where the
      // number came from.
      quote: JSON.stringify(current),
      confidence: 'medium',
      status: 'committed',
      asserts: 'real_world',
      freshness: {
        synced_at: syncId,
        stale_after_days: spec.stale_after_days,
        source_commit: null,
        observed_at: current.time || null,
        interval_seconds: typeof current.interval === 'number' ? current.interval : null
      },
      extra: {
        kind: which === 'land' ? 'weather-model-output' : 'marine-model-output',
        name: which === 'land'
          ? 'Open-Meteo land model output near Point Lookout'
          : 'Open-Meteo marine model output off Point Lookout',
        // The rung, on the record, so the twin ranks rather than guesses. See the ladder in
        // docs/CONNECTORS.md and src/world/observations.js.
        rung: RUNG.rung,
        rung_id: RUNG.id,
        rung_label: RUNG.label,
        rung_note: `Rung ${RUNG.rung} of 4: ${RUNG.what}. It beats the rung below because `
          + `${RUNG.beats_below}, and it loses to an island instrument or an official station reading `
          + 'the moment either of those exists for this field.',
        basis: 'model',
        provider: 'Open-Meteo',
        licence: LICENCE,
        attribution: ATTRIBUTION,
        provider_url: PROVIDER_URL,
        endpoint: ENDPOINTS[which],
        retrieved_by: usedInbox ? 'read from a saved response on disk' : 'fetched from the endpoint above',
        modelled_for: current.time || null,
        modelled_for_timezone: payload.timezone || null,
        interval_seconds: typeof current.interval === 'number' ? current.interval : null,
        // The coordinate is the grid cell the source answered for, not the place that was asked
        // about. `location_precision_m` says how far apart they are, because that is the honest
        // answer to how precisely this record locates its own weather.
        lat: typeof served.lat === 'number' ? Math.round(served.lat * 10000) / 10000 : null,
        lng: typeof served.lng === 'number' ? Math.round(served.lng * 10000) / 10000 : null,
        location_precision_m: offsetM,
        asked_for: { lat: asked.lat, lng: asked.lng, about: asked.about },
        elevation_m: typeof payload.elevation === 'number' ? payload.elevation : null,
        place_note: offsetM === null
          ? 'The response named no coordinates, so how far its cell sits from the place asked about is unknown.'
          : `The source answered for a grid cell about ${(offsetM / 1000).toFixed(1)} km from `
            + `${asked.about}. That is the resolution of the model, not a mistake, and it is why this `
            + 'record says model rather than observed.',
        readings,
        handling: 'Model output for a grid cell, not a reading from an instrument on this island. It may '
          + 'be shown with the moment it was modelled for beside it and the word model on it. It may not '
          + 'be called an observation, and it may not be shown for any moment the island has not lived '
          + 'through. Each reading carries its own shelf life in minutes: a rain figure is worth nothing '
          + 'at an hour old and a pressure figure is still worth having at six.',
        upstream_sources: [PROVIDER_URL, ENDPOINTS[which]]
      }
    });
    if (add(rec)) counts.kept++;
  }
  counts.held = held.length;

  addWanted({
    id: 'wx-want-station-observations',
    what: 'Actual station observations for this island, rather than model output for a grid cell.',
    why_it_matters: 'Everything in this feed is a model\'s answer for a cell some kilometres from the '
      + 'place it is being shown for. It is honest and it is the right thing to run on today, and it is '
      + 'not the same as a reading from an instrument. The Bureau of Meteorology\'s registered data '
      + 'services are the sanctioned route to real observations.',
    who_would_have_to_agree: 'The Bureau of Meteorology, through registration, which is a decision for '
      + 'the owner of this project rather than for an agent.',
    how_small_it_could_start: 'One station, one hourly observation, one field: wind. That alone would let '
      + 'the crossing read a measured number instead of a modelled one.'
  });
  addWanted({
    id: 'wx-want-local-sea-state',
    what: 'A sea-state number for the ocean beaches that somebody on the island vouches for.',
    why_it_matters: 'The marine cell sits a few kilometres off the Gorge and answers for open water. '
      + 'What the beach is doing at Main Beach and Cylinder is a local matter and the twin currently '
      + 'infers it from one offshore number.',
    who_would_have_to_agree: 'Whoever holds a public sea-state or beach-condition source for this coast. '
      + 'Nobody has been asked.',
    how_small_it_could_start: 'A daily line from anybody who looks at the water every morning would beat '
      + 'a model cell three kilometres offshore.'
  });

  const landTime = ((payloads.land || {}).current || {}).time || null;
  const marineTime = ((payloads.marine || {}).current || {}).time || null;

  return {
    feed: ID,
    schema: 'minjerribah-connector-feed/1',
    version: '1.0.0',
    title: spec.title,
    organisation: spec.organisation,
    // THE ONE FEED THE RUNNING TWIN READS DIRECTLY, and the flag rather than a list in the loader
    // is deliberate: `src/world/data.js` reads the feed index and loads whatever declares this, so
    // a station on the surf club roof arrives by writing a feed with this flag on it, which is the
    // data change rather than code change docs/CONNECTORS.md asks for.
    //
    // Why an observation may skip the promotion queue when nothing else does: promotion exists
    // because a machine finds lines and a person decides what is true, and it is the right gate for
    // a claim that will sit in a pack for years. An observation is not that kind of claim. It is a
    // measurement of a moment with a shelf life of minutes, and by the time a person had read it,
    // it would be stale. So it is never promoted into a pack, it never becomes a durable fact about
    // the island, and it is drawn only with its own moment and its own rung beside it.
    runtime_read: true,
    runtime_note: 'Read by the running twin off its own origin at boot, never fetched at runtime, and '
      + 'never promoted into a data pack. A pack is a durable claim; this is a moment with a shelf life.',
    about: 'What a weather model has for the grid cells nearest this island, fetched as an offline step '
      + 'and committed as a file. It is model output and never an observation, it carries the moment it '
      + 'was modelled for as well as the moment it was fetched, and each reading carries its own shelf '
      + 'life in minutes because an hour-old temperature is fine and an hour-old rain figure is not. The '
      + 'running twin reads this only while its clock is live.',
    sync: {
      synced_at: syncId,
      connector: { id: ID, version: CONNECTOR_VERSION },
      source: {
        kind: 'http-endpoint',
        id: 'open-meteo',
        path: PROVIDER_URL,
        present: true,
        commit: null,
        commit_date: null,
        working_tree: 'not applicable to an endpoint',
        files: [ENDPOINTS.land, ENDPOINTS.marine]
      },
      source_statement: quoted(
        'Weather data by Open-Meteo.com',
        'the attribution Open-Meteo asks for under CC BY 4.0'),
      retrieval: usedInbox ? 'read from saved responses on disk' : 'fetched from the two endpoints above',
      licence: LICENCE,
      attribution: ATTRIBUTION,
      modelled_for: { land: landTime, marine: marineTime },
      basis: 'model',
      basis_note: 'Model output for a grid cell. Not a reading from an instrument at Point Lookout. '
        + 'The word observed is not used anywhere in this feed and must not be used anywhere it surfaces.',
      refused_alternative: 'api.weather.bom.gov.au was considered and refused: it is an undocumented '
        + 'internal interface and every response states that the Bureau owns it and that you must not use, '
        + 'copy or share it. See tools/connectors/refusals.mjs and docs/CONNECTORS.md.',
      cadence: spec.cadence,
      stale_after_days: spec.stale_after_days,
      per_field_freshness: 'The day is the wrong unit here. The limits that matter are in minutes and '
        + 'they sit on the field: src/world/freshness.js OBSERVATION_STALE_AFTER_MINUTES, which the twin '
        + 'and this connector both read, so there is one table and not two.',
      counts
    },
    confidence_scale: {
      high: 'Not reachable from this source. High would mean a measured reading from an instrument on '
        + 'this island, and nothing here is one.',
      medium: 'A named weather model returned this figure for a named grid cell at a stamped moment, and '
        + 'the record quotes the response.',
      low: 'Not used. A figure that cannot name its model, its cell and its moment is not carried.'
    },
    freshness_rule: 'Two clocks and they are not the same clock. `modelled_for` is the moment the figure '
      + 'is about; `synced_at` is the moment somebody fetched it. A reading is used only while it is '
      + 'inside its own shelf life, counted from the first of those against whatever moment the island\'s '
      + 'clock is declaring, and a reading past its limit stops being used and says so in words.',
    cultural_flags: [],
    records,
    held,
    wanted
  };
}
