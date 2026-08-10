// Connector: the Quandamooka Country Events Engine.
//
//   node tools/connectors/sync.mjs --id events-engine
//
// This source is different from the others in one way that changes how it must be treated: it is
// refreshed. Its git history carries repeated public source refreshes through June and July 2026,
// roughly weekly, so a local checkout lags the remote and a feed stamped only with the day it was
// generated would claim a currency it does not have. Every record here carries the commit it was
// read at, and the sync says plainly when the checkout is older than the cadence.
//
// It also publishes its own freshness and its own honesty flag, and this connector does not invent
// replacements for either:
//
//   project.lastPublicSearch   when a person last went looking, in the source's own words
//   project.dataStatus         the source calling itself a draft event atlas and saying to confirm
//                              dates, permissions and contacts before use
//
// Both are carried through verbatim, and the second one caps confidence. A twin that computed its
// own high confidence for a source that is telling you it is a draft would be overstating, and
// overstating is the failure mode this whole project is built against.
//
// docs/PUBLIC_BOUNDARY.md in that repository is treated here as BLOCKING, on the same footing as
// data/lore.json. It is the owner's own publication contract for this material, it is closer to the
// source than anything this project would have written, and four of its five wording rules are
// rules this repository already holds under different names. Where the two differ on this material,
// that one wins.
//
// CULTURAL LINE, and it is the reason this file is careful. Some events in the atlas are cultural
// events run by or listed through Quandamooka organisations. This project may list a publicly
// advertised event exactly as advertised: its name, its date, its place, and who listed it. It may
// not carry a programme, a description of what happens, a protocol, a meaning, or anything a member
// of an organisation would have had to tell somebody. So cultural records are carried as civic load
// only, the source's descriptive prose is not carried for them, and every one of them is flagged
// for a human to look at before it is promoted anywhere.

import {
  nowIso, daysBetween, readCheckout, sourceFile, readWindowData, envelope, screenRecord, screenWanted, quoted
} from './lib.mjs';
import { connector as declared, CONNECTOR_VERSION } from './registry.mjs';

export const ID = 'events-engine';
const PUBLIC_URL = 'https://auraofintelligence.github.io/quandamooka-country-events-engine/';

/**
 * An event whose subject is Quandamooka culture, First Nations culture, or a body of either.
 *
 * Matching on words rather than on a curated list, on purpose: a curated list goes stale the moment
 * the atlas is refreshed, and the failure mode of a stale list is a new cultural event arriving
 * through the connector with a full description attached. A word match catches too much, which
 * costs a few extra flags. That is the right side to be wrong on.
 */
const CULTURAL_MARKERS = /\b(quandamooka|naidoc|goompi|minjerribah|moorgumpin|mulgumpin|indigenous|first nations|aboriginal|torres strait|elders?|country)\b/i;

/** Statuses in the atlas, and what each means for this twin. */
const STATUS_MAP = {
  confirmed: { status: 'committed', confidence: 'medium', note: 'The listing source states this date.' },
  recurring: { status: 'committed', confidence: 'medium', note: 'A pattern the atlas records as recurring, not a dated instance.' },
  historical: { status: 'committed', confidence: 'medium', note: 'A pattern from past years, not a date for this year.' },
  past: { status: 'committed', confidence: 'medium', note: 'An event that has already happened.' },
  tbc: { status: 'proposed', confidence: 'medium', note: 'The atlas records the event and not the date. Proposed until a date is published.' }
};

export function sync() {
  const spec = declared(ID);
  const syncId = nowIso();
  const checkout = readCheckout(spec.source.id);
  if (!checkout.present) {
    throw new Error(`no checkout of ${spec.source.id} at ${checkout.path}. `
      + 'This connector reads a local checkout and never the network. Pull that repository first: its own '
      + 'history says it is refreshed roughly weekly.');
  }
  const data = readWindowData(sourceFile(checkout, 'assets/site-data.js'), 'QCEE_DATA');
  const project = data.project || {};
  const automation = data.eventAutomation || {};

  const records = [];
  const held = [];
  const wanted = [];
  const flagged = [];
  const freshness = { synced_at: syncId, stale_after_days: spec.stale_after_days, source_commit: checkout.commit };
  const shortCommit = checkout.commit ? checkout.commit.slice(0, 9) : 'unknown';

  // The source calls itself a draft. Nothing from this sync goes above medium while it does.
  const sourceCallsItselfDraft = /draft/i.test(String(project.dataStatus || ''));

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

  const events = data.events || [];
  let cultural = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const map = STATUS_MAP[e.status] || { status: 'proposed', confidence: 'medium', note: 'Status not recognised by this connector.' };
    const isCultural = CULTURAL_MARKERS.test(`${e.name} ${e.sector || ''} ${e.place || ''} ${e.source || ''}`);
    if (isCultural) cultural++;

    const rec = envelope({
      id: `qcee-${e.id}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `quandamooka-country-events-engine/assets/site-data.js events[${i}], commit ${shortCommit}`,
      // The verbatim thing this record rests on is the atlas line itself: the event, listed, with
      // a date and a source. For a cultural event that is all that is carried.
      quote: `${e.name}, ${e.dateLabel}, ${e.place}. Listed by ${e.source}.`,
      confidence: sourceCallsItselfDraft ? 'medium' : map.confidence,
      status: map.status,
      asserts: 'real_world',
      freshness,
      extra: {
        kind: 'public-event-listing',
        name: e.name,
        date_label: e.dateLabel,
        starts: e.dateSort || null,
        ends: e.dateEndSort || null,
        atlas_status: e.status,
        atlas_status_meaning: map.note,
        // The atlas calls this field a season and means a listing grouping: winter school holidays,
        // a festival series, a whale-watching window. It is renamed here, and the rename is not
        // cosmetic. `season` is one of the keys the gate treats as a cultural position, because the
        // wave 7 fault arrived through exactly such a key, and a connector that wrote a listing
        // grouping into a field named season would be putting words where a seasonal calendar goes.
        listing_period: e.season || null,
        place: e.place || null,
        village: e.village || null,
        sector: e.sector || null,
        scale: e.scale || null,
        listed_by: e.source || null,
        upstream_sources: [e.sourceUrl, PUBLIC_URL].filter(Boolean),
        cultural_event: isCultural,
        // The atlas carries a plain-English summary and a simulation brief for every event. For an
        // ordinary event both are useful. For a cultural event neither is carried, because a
        // description of what happens at a cultural event is not this project's to hold.
        summary: isCultural ? null : (e.concise || null),
        load_tags: isCultural ? null : (e.loadTags || null),
        movement_note: isCultural ? null : ((e.simulation && e.simulation.movement) || null),
        cultural_handling: isCultural
          ? 'Carried as civic load only: the date, the place, and who listed it, exactly as advertised. '
            + 'No programme, no description, no protocol, no meaning. This record is flagged for a human '
            + 'to read before it is promoted into any pack, and nothing about it may be inferred.'
          : null,
        handling: 'A listing, not a confirmation. The source itself says to confirm dates, permissions and '
          + 'contacts with the responsible body before use, and that sentence is on this feed.'
      }
    });
    if (add(rec) && isCultural) {
      flagged.push({
        id: rec.id,
        name: e.name,
        why: 'Names a cultural event, a Quandamooka organisation, or Country. Carried as date, place and '
          + 'listing source only. A human reads this before it goes anywhere.',
        queue: 'docs/CULTURAL-REVIEW.md'
      });
    }
  }

  // Places the atlas knows about, which is how an event date becomes a place in the twin.
  for (let i = 0; i < (data.places || []).length; i++) {
    const p = data.places[i];
    add(envelope({
      id: `qcee-place-${p.id || String(i)}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `quandamooka-country-events-engine/assets/site-data.js places[${i}], commit ${shortCommit}`,
      confidence: 'medium',
      status: 'committed',
      freshness,
      extra: {
        kind: 'event-place',
        name: p.name || p.label || null,
        village: p.village || null,
        role: p.role || p.kind || null,
        upstream_sources: [PUBLIC_URL]
      }
    }));
  }

  const searchAge = automation.sortAnchorDate ? daysBetween(automation.sortAnchorDate, syncId) : null;
  const checkoutAge = checkout.commit_date ? daysBetween(checkout.commit_date, syncId) : null;

  addWanted({
    id: 'qcee-want-pull',
    what: 'A pull of the source repository before every sync.',
    why_it_matters: checkoutAge === null
      ? 'The checkout has no readable commit date, so nothing can say how far behind it is.'
      : `The checkout read here is ${checkoutAge} day(s) old. That repository refreshes its public event `
        + 'sources roughly weekly, so a stale checkout produces a stale calendar that looks current.',
    who_would_have_to_agree: 'Nobody. It is one git pull, and this connector reports the age every run.',
    how_small_it_could_start: 'It already does. This entry exists so the number is on the feed and not only in a terminal.'
  });
  addWanted({
    id: 'qcee-want-confirmations',
    what: 'Confirmation of dates from the organisers themselves, rather than from listing sites.',
    why_it_matters: 'Every record here rests on a public listing. The source says so about itself. The twin '
      + 'can carry that honestly, but a calendar the island relies on needs one more hop.',
    who_would_have_to_agree: 'Each organiser.',
    how_small_it_could_start: 'The two events the atlas marks as a date to confirm are the whole of the first ask.'
  });

  return {
    feed: ID,
    schema: 'minjerribah-connector-feed/1',
    version: '1.0.0',
    title: spec.title,
    organisation: spec.organisation,
    about: 'Publicly listed island events, read from a local checkout of the events engine. The source '
      + 'publishes its own last search date and its own draft flag, and both are carried through rather '
      + 'than replaced with a judgement of ours. Cultural events are carried as date, place and listing '
      + 'source only, and are flagged for a human.',
    sync: {
      synced_at: syncId,
      connector: { id: ID, version: CONNECTOR_VERSION },
      source: checkout,
      source_statement: quoted(project.dataStatus || '', 'quandamooka-country-events-engine/assets/site-data.js project.dataStatus'),
      source_boundary: quoted(project.boundary || '', 'quandamooka-country-events-engine/assets/site-data.js project.boundary'),
      source_last_public_search: project.lastPublicSearch || null,
      source_search_anchor: automation.sortAnchorDate || null,
      source_search_age_days: searchAge,
      checkout_age_days: checkoutAge,
      checkout_is_behind_cadence: checkoutAge !== null && checkoutAge > 7,
      publication_boundary: 'quandamooka-country-events-engine/docs/PUBLIC_BOUNDARY.md is treated as blocking '
        + 'by this connector. Its keep-private list includes sensitive cultural material, protected places, '
        + 'unapproved images or names, and incident details that identify people. None of that enters through '
        + 'here, whatever the data file happens to contain.',
      cadence: spec.cadence,
      stale_after_days: spec.stale_after_days,
      counts: {
        events_read: events.length,
        places_read: (data.places || []).length,
        cultural_flagged: cultural,
        kept: records.length,
        held: held.length,
        wanted: wanted.length
      }
    },
    confidence_scale: {
      high: 'Not reachable while the source calls itself a draft, and it does. Nothing in this feed is high.',
      medium: 'A listing source states this event, this date and this place, and the record quotes the atlas line.',
      low: 'Not used. An event that cannot be cited is not carried.'
    },
    freshness_rule: 'An event listing is only as true as the last public search behind it. The source names '
      + 'that date and this feed carries it, so a panel showing an event can show when somebody last looked '
      + 'rather than implying it knows what is on tonight.',
    cultural_flags: flagged,
    records,
    held,
    wanted
  };
}
