// Connector: Wildlife Rescue Minjerribah.
//
//   node tools/connectors/sync.mjs --id wildlife-rescue [--inbox <folder>]
//
// This is the most valuable connector in the layer and the reason is not technical. Every other
// source here is a research pass or a listing. This one is a working stream: a free offline app on
// volunteers' phones, with a triage tree, an island map and a sync-by-text format that already
// carries real reports between real people through a group chat. Nothing had to be built for the
// island to start producing this data, because the island is already producing it.
//
// So this connector reads the format the volunteers already use, rather than asking a volunteer
// group to build an export for a simulation. Four inputs, all local files, no network:
//
//   assets/contacts.js   the numbers the app tells the public to ring. Published, real, citable.
//   assets/db.js         the vocabulary: animal groups, conditions, causes, mobility, the island box.
//   lookouts.json        the keep-an-eye-out board the coordinator publishes by editing a file.
//   --inbox <folder>     whatever a coordinator dropped in: an app export (JSON or CSV), or a text
//                        file of copied group-chat messages carrying MWR sync codes.
//
// WHAT THIS CONNECTOR DELIBERATELY THROWS AWAY, before anything is written to disk:
//
//   reporter name        never enters this repository, in any file, at any confidence
//   reporter phone       the same
//   free-text notes      the same, because a note is where a private address or a person's name
//                        ends up, and no amount of screening makes free text safe
//   exact coordinates    rounded to three decimal places, about 110 m, before commit. Not filtered
//                        at display time: docs/PARTICIPATION.md is explicit that a runtime filter is
//                        one bug away from publishing the thing it was hiding
//   exact minute         rounded down to the hour
//   free-text place      carried only if it resolves to a place already in data/places.json
//
// That list is the connector. The parsing is the easy half.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, nowIso, today, readCheckout, sourceFile, readIifeModule, envelope, screenRecord, screenWanted,
  coarsen, coarsenTime, decodeMwr, extractMwrCodes, quoted
} from './lib.mjs';
import { connector as declared, CONNECTOR_VERSION } from './registry.mjs';

export const ID = 'wildlife-rescue';
const PUBLIC_URL = 'https://auraofintelligence.github.io/minjerribah-wildlife-rescue/';

/**
 * Animal group to the twin's own species records.
 *
 * A rescue report says koala; the twin's ecology pack says sp-koala. Without this crosswalk the
 * feed is a list nothing can act on. With it, a report lands on the system that already models the
 * animal, and the twin's own modelled road strikes can be compared against reports of real ones,
 * which is the single most useful thing this feed can do.
 *
 * Where a group covers several species the crosswalk lists them all and says so, because guessing
 * which wallaby somebody saw is exactly the kind of confident wrongness this project refuses.
 */
const GROUP_TO_SPECIES = {
  koala: ['sp-koala'],
  kangaroo: ['sp-eastern-grey-kangaroo'],
  wallaby: ['sp-swamp-wallaby', 'sp-agile-wallaby'],
  snake: ['sp-eastern-brown-snake', 'sp-carpet-python'],
  goanna: ['sp-lace-monitor'],
  bluetongue: ['sp-eastern-blue-tongue'],
  echidna: ['sp-short-beaked-echidna'],
  possum: ['sp-brushtail-possum', 'sp-ringtail-possum', 'sp-squirrel-glider'],
  seaturtle: ['sp-green-turtle', 'sp-loggerhead-turtle'],
  marine: ['sp-humpback-whale', 'sp-indo-pacific-bottlenose-dolphin', 'sp-australian-humpback-dolphin', 'sp-dugong'],
  shark: ['sp-grey-nurse-shark', 'sp-bull-shark', 'sp-reef-manta-ray'],
  pelican: [],
  shorebird: ['sp-eastern-curlew', 'sp-bar-tailed-godwit', 'sp-curlew-sandpiper', 'sp-great-knot',
    'sp-beach-stone-curlew', 'sp-pied-oystercatcher', 'sp-little-tern'],
  landbird: ['sp-glossy-black-cockatoo', 'sp-rainbow-bee-eater'],
  raptor: ['sp-white-bellied-sea-eagle', 'sp-eastern-osprey', 'sp-brahminy-kite'],
  bat: ['sp-grey-headed-flying-fox'],
  other: []
};

/**
 * Cause to the event the twin already emits, so a real report and a modelled one can be counted in
 * the same column. `wildlife:call` is the event docs/STATE-OF-PLAY.md records the sentiment system
 * listening for, with a predicate deciding whether it reads as a road strike or a dog attack.
 */
const CAUSE_TO_EVENT = {
  vehicle: 'wildlife:call, cause vehicle. The twin models road strikes in its koala system.',
  dog: 'wildlife:call, cause dog. The twin models dog attacks in its koala system.',
  entangled: 'wildlife:call, cause entangled. The twin models fishing line and net interaction in its marine system.',
  weather: 'wildlife:call, cause weather. The twin models heat and storm stress in its ecology systems.',
  orphaned: 'wildlife:call, cause orphaned.',
  healthy: 'not an incident. A healthy sighting, useful as presence and nothing else.'
};

function readPlaces() {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'places.json'), 'utf8'));
  const byName = new Map();
  for (const p of doc.places || []) {
    byName.set(String(p.name).toLowerCase(), p.id);
    for (const alt of p.also_known_as || []) byName.set(String(alt).toLowerCase(), p.id);
  }
  return byName;
}

/** A free-text place is carried only when it is already a place this twin knows. */
function resolvePlace(text, byName) {
  const key = String(text || '').trim().toLowerCase();
  if (!key) return null;
  if (byName.has(key)) return byName.get(key);
  for (const [name, id] of byName) {
    if (key === name || key.startsWith(name + ',') || key.endsWith(' ' + name)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inbox readers
// ---------------------------------------------------------------------------------------------

function fromExportJson(text) {
  const doc = JSON.parse(text);
  if (!doc || !Array.isArray(doc.records)) return null;
  return { records: doc.records, note: `app export, format ${doc.format}, exported ${doc.exported || 'undated'}` };
}

function fromCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const head = splitCsvLine(lines[0]);
  if (!head.includes('animal_group')) return null;
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i]; });
    out.push({
      id: row.id,
      caseId: row.case_id || row.id,
      kind: row.kind || 'report',
      when: `${row.date || ''}T${row.time || '00:00'}`,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      place: row.place,
      groupLabel: row.animal_group,
      species: row.species,
      count: Number(row.count) || 1,
      statusLabel: row.condition,
      mobility: row.mobility,
      causeLabel: row.cause,
      updated: row.updated
    });
  }
  return { records: out, note: 'app CSV export', labelled: true };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoting = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoting) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quoting = false; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"') { quoting = true; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => (c.startsWith("'") ? c.slice(1) : c));
}

function fromChatPaste(text) {
  const { codes, truncated } = extractMwrCodes(text);
  if (!codes.length) return null;
  const records = [];
  let bad = 0;
  for (const code of codes) {
    const res = decodeMwr(code);
    if (res.record) records.push(res.record);
    else bad++;
  }
  return {
    records,
    note: `pasted group-chat messages: ${codes.length} sync code(s) read`,
    problems: { truncated, unreadable: bad }
  };
}

function readInbox(dir) {
  const found = { records: [], notes: [], problems: { truncated: 0, unreadable: 0 }, files: [] };
  if (!dir || !fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, 'utf8');
    let parsed = null;
    try {
      if (/\.json$/i.test(name)) parsed = fromExportJson(text);
      else if (/\.csv$/i.test(name)) parsed = fromCsv(text);
      else parsed = fromChatPaste(text);
    } catch (e) {
      found.notes.push(`${name}: could not be read (${e.message})`);
      continue;
    }
    if (!parsed) { found.notes.push(`${name}: nothing in it looked like a wildlife record`); continue; }
    found.files.push(name);
    found.notes.push(`${name}: ${parsed.note}, ${parsed.records.length} record(s)`);
    if (parsed.problems) {
      found.problems.truncated += parsed.problems.truncated || 0;
      found.problems.unreadable += parsed.problems.unreadable || 0;
    }
    for (const r of parsed.records) found.records.push({ ...r, _from: name, _labelled: !!parsed.labelled });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------------------------

export function sync({ inbox = null } = {}) {
  const spec = declared(ID);
  const syncId = nowIso();
  const checkout = readCheckout(spec.source.id);
  if (!checkout.present) {
    throw new Error(`no checkout of ${spec.source.id} at ${checkout.path}. `
      + 'This connector reads a local checkout and never the network, so somebody has to clone or pull it first.');
  }

  const contactsSrc = sourceFile(checkout, 'assets/contacts.js');
  const dbSrc = sourceFile(checkout, 'assets/db.js');
  const lookoutsSrc = sourceFile(checkout, 'lookouts.json');

  const MWRC = readIifeModule(contactsSrc, 'MWRC');
  const MWR = readIifeModule(dbSrc, 'MWR');
  const lookoutDoc = JSON.parse(lookoutsSrc);

  const placesByName = readPlaces();
  const records = [];
  const held = [];
  const wanted = [];
  const flagged = [];
  const freshness = { synced_at: syncId, stale_after_days: spec.stale_after_days, source_commit: checkout.commit };

  const add = (rec) => {
    const screen = screenRecord(rec);
    if (screen.ok) { records.push(rec); return true; }
    held.push({ id: rec.id, kind: rec.kind, reasons: screen.reasons });
    return false;
  };

  // A wanted entry is written into the same committed file as a record, so it goes through the same
  // screen. Anything naming a Traditional Owner organisation loses the source's guess about what it
  // might share and is flagged for the cultural review queue.
  const addWanted = (entry) => {
    const screen = screenWanted(entry);
    if (!screen.ok) {
      held.push({ id: entry.id, kind: 'wanted-list-entry', reasons: screen.reasons });
      return false;
    }
    wanted.push(screen.entry);
    if (screen.culturalFlag) flagged.push(screen.culturalFlag);
    return true;
  };

  // ---- who to ring -------------------------------------------------------------------------
  // The app publishes these for the public to ring. That is what makes them citable: not that
  // somebody told us, but that the island's own rescue app puts them on a screen in front of a
  // person holding a phone.
  for (const [key, c] of Object.entries(MWRC.list)) {
    add(envelope({
      id: `wr-contact-${key}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `minjerribah-wildlife-rescue/assets/contacts.js MWRC.list.${key}, commit ${checkout.commit ? checkout.commit.slice(0, 9) : 'unknown'}`,
      quote: c.note,
      confidence: 'high',
      status: 'committed',
      asserts: 'real_world',
      freshness,
      extra: {
        kind: 'rescue-contact',
        contact_key: key,
        name: c.name,
        phone: c.display,
        dial: c.tel,
        is_primary: key === MWRC.primary,
        upstream_sources: [PUBLIC_URL],
        handling: 'A published emergency contact. Show it whole or not at all, and never behind a paywall, '
          + 'a login or a low-confidence marker.'
      }
    }));
  }

  // ---- the shared vocabulary ---------------------------------------------------------------
  // Modelling parameters rather than claims about the world, so the envelope does not ask them for
  // a quote. Their value is that the twin and the rescue app end up counting the same things: a
  // report of a koala hit by a vehicle and the twin's own modelled strike are the same two words.
  const vocab = [
    ['animal-group', MWR.GROUPS, (g) => ({ key: g.key, label: g.label, code: g.code, twin_species: GROUP_TO_SPECIES[g.key] || [] })],
    ['condition', MWR.STATUSES, (s) => ({ key: s.key, label: s.label, short: s.short })],
    ['cause', MWR.CAUSES, (c) => ({ key: c.key, label: c.label, twin_event: CAUSE_TO_EVENT[c.key] || null })],
    ['mobility', MWR.MOBILITY, (m) => ({ key: m.key, label: m.label })]
  ];
  for (const [kind, list, shape] of vocab) {
    for (const item of list) {
      add(envelope({
        id: `wr-vocab-${kind}-${item.key}`,
        connector: ID,
        connectorVersion: CONNECTOR_VERSION,
        syncId,
        locator: `minjerribah-wildlife-rescue/assets/db.js, commit ${checkout.commit ? checkout.commit.slice(0, 9) : 'unknown'}`,
        confidence: 'high',
        status: 'committed',
        freshness,
        extra: Object.assign({ kind: `rescue-vocabulary-${kind}` }, shape(item))
      }));
    }
  }

  // ---- the lookout board -------------------------------------------------------------------
  // The coordinator publishes current keep-an-eye-out cases by editing one committed file. It is
  // empty today, and an empty board is a real answer: nothing is currently being watched for.
  const lookouts = Array.isArray(lookoutDoc.lookouts) ? lookoutDoc.lookouts : [];
  for (const l of lookouts) {
    const at = coarsen(Number(l.lat), Number(l.lng));
    add(envelope({
      id: `wr-lookout-${String(l.id || l.caseId || records.length).replace(/[^a-z0-9-]/gi, '')}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `minjerribah-wildlife-rescue/lookouts.json, updated ${lookoutDoc.updated || 'undated'}`,
      quote: l.text || l.title || '',
      confidence: 'medium',
      status: 'committed',
      asserts: l.text ? 'real_world' : null,
      freshness,
      extra: {
        kind: 'rescue-lookout',
        group: l.group || null,
        twin_species: GROUP_TO_SPECIES[l.group] || [],
        lat: at.lat,
        lng: at.lng,
        location_precision_m: at.precision_m,
        board_updated: lookoutDoc.updated || null,
        upstream_sources: [PUBLIC_URL]
      }
    }));
  }

  // ---- the case stream ---------------------------------------------------------------------
  const inboxDir = inbox ? path.resolve(inbox) : null;
  const found = readInbox(inboxDir);
  const groupByLabel = new Map(MWR.GROUPS.map((g) => [g.label.toLowerCase(), g.key]));
  const statusByLabel = new Map(MWR.STATUSES.map((s) => [s.label.toLowerCase(), s.key]));
  const causeByLabel = new Map(MWR.CAUSES.map((c) => [c.label.toLowerCase(), c.key]));
  let carriedFields = 0;
  let droppedFields = 0;

  for (const raw of found.records) {
    const group = raw.group || groupByLabel.get(String(raw.groupLabel || '').toLowerCase()) || null;
    const status = raw.status || statusByLabel.get(String(raw.statusLabel || '').toLowerCase()) || null;
    const cause = raw.cause || causeByLabel.get(String(raw.causeLabel || '').toLowerCase()) || null;
    const at = coarsen(Number(raw.lat), Number(raw.lng));
    const placeId = resolvePlace(raw.place, placesByName);
    for (const f of ['reporter', 'phone', 'notes']) if (raw[f]) droppedFields++;
    if (placeId) carriedFields++;

    add(envelope({
      id: `wr-case-${String(raw.id || '').replace(/[^a-z0-9_-]/gi, '').slice(-24) || String(records.length)}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `inbox file ${raw._from}, record ${raw.id}`,
      confidence: 'medium',
      status: 'contributed',
      freshness,
      extra: {
        kind: 'rescue-case',
        case_ref: String(raw.caseId || raw.id || '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase(),
        record_kind: raw.kind || 'report',
        observed_at: coarsenTime(raw.when),
        group,
        twin_species: GROUP_TO_SPECIES[group] || [],
        count: Number(raw.count) || 1,
        condition: status,
        cause,
        mobility: raw.mobility || 'unknown',
        lat: at.lat,
        lng: at.lng,
        location_precision_m: at.precision_m,
        place_id: placeId,
        place_note: placeId ? null : 'A free-text place name was supplied and did not resolve to a place '
          + 'already in data/places.json, so it was not carried. Nothing in this repository invents a place.',
        privacy: 'Reporter name, reporter phone and free-text notes were dropped at intake and are not '
          + 'in this repository. Coordinates were rounded before commit.',
        upstream_sources: [PUBLIC_URL]
      }
    }));
  }

  // ---- what is missing, named -------------------------------------------------------------
  if (!found.records.length) {
    addWanted({
      id: 'wr-want-case-stream',
      what: 'The case stream itself. This connector reads app exports, CSV exports and pasted group-chat '
        + 'sync codes, and none has been handed over, so the twin currently models wildlife entirely from '
        + 'its own ecology pack and knows nothing about a single real rescue.',
      why_it_matters: 'The twin already models koala road strikes and dog attacks. It has never once been '
        + 'checked against a real one. Two dozen real reports would tell us whether the modelled hotspots '
        + 'are the real hotspots, which is the difference between a simulation and evidence.',
      who_would_have_to_agree: 'Wildlife Rescue Minjerribah, whose data it is.',
      how_small_it_could_start: 'One export, once, covering a single season, with names already stripped '
        + 'by this connector before anything is written.'
    });
  }
  if (!lookouts.length) {
    addWanted({
      id: 'wr-want-lookouts',
      what: 'Nothing is currently on the lookout board in the source repository, which is a real answer '
        + 'rather than a gap: no case is presently being watched for.',
      why_it_matters: 'When the board is not empty it is the freshest thing on this island: an animal '
        + 'somebody is actively looking for, with a trail behind it.',
      who_would_have_to_agree: 'Nobody. The coordinator already publishes it by editing one committed file.',
      how_small_it_could_start: 'It is already running. This connector will pick it up the next time it is not empty.'
    });
  }
  addWanted({
    id: 'wr-want-coarsening-review',
    what: 'A ruling on the coarsening. Coordinates are rounded to about 110 m and times to the hour.',
    why_it_matters: 'Somebody who knows this island needs to say whether 110 m is coarse enough for a '
      + 'shorebird roost or a turtle nest, and whether some species should not carry a pin at all.',
    who_would_have_to_agree: 'Wildlife Rescue Minjerribah, and for anything on Country, the answer to '
      + 'question A1 in docs/CULTURAL-REVIEW.md first.',
    how_small_it_could_start: 'A list of which animal groups get a pin and which get a township.'
  });

  return {
    feed: ID,
    schema: 'minjerribah-connector-feed/1',
    version: '1.0.0',
    title: spec.title,
    organisation: spec.organisation,
    about: 'What the island\'s own wildlife rescue app publishes, read from a local checkout of it. '
      + 'The numbers to ring, the vocabulary the island already uses for animals and what happened to '
      + 'them, the current lookout board, and any case records a coordinator has handed over. Reporter '
      + 'names and phone numbers never enter this repository and coordinates are coarsened before commit.',
    sync: {
      synced_at: syncId,
      connector: { id: ID, version: CONNECTOR_VERSION },
      source: checkout,
      source_statement: quoted(
        'No server. No accounts. No cost. Records live on each phone; the group chat carries them between phones as plain text.',
        'minjerribah-wildlife-rescue/README.md'
      ),
      cadence: spec.cadence,
      stale_after_days: spec.stale_after_days,
      inbox: inboxDir ? { path: inboxDir.split(path.sep).join('/'), files: found.files, notes: found.notes, problems: found.problems } : null,
      counts: {
        contacts: Object.keys(MWRC.list).length,
        vocabulary: vocab.reduce((n, [, list]) => n + list.length, 0),
        lookouts: lookouts.length,
        cases: found.records.length,
        kept: records.length,
        held: held.length,
        wanted: wanted.length,
        wanted_flagged_cultural: flagged.length,
        fields_dropped_for_privacy: droppedFields,
        places_resolved: carriedFields
      }
    },
    confidence_scale: {
      high: 'The app publishes this directly: a number it tells the public to ring, or a vocabulary term it uses on screen.',
      medium: 'A record of something a person reported at a moment. True when it was made, and not a statement about now.',
      low: 'Not used by this connector. A wildlife record that cannot be believed is held, not carried.'
    },
    freshness_rule: 'A rescue record describes a moment, never a state. A twin that draws a pin from this '
      + 'feed must show how long ago it was synced beside it, and after ' + spec.stale_after_days
      + ' days it must say the record is old rather than let a player read it as current.',
    cultural_flags: flagged,
    records,
    held,
    wanted
  };
}
