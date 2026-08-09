// Record-level checks: the envelope, the confidence scale, what may reach a player, and whether
// anything proposed is still marked proposed by the time the interface gets hold of it.
//
// The judgements here are not re-implemented. They are imported from src/world/data.js, which is
// the same module the running twin uses, so the gate cannot pass a record the interface would
// treat differently. That is the whole reason those functions are plain and dependency-free.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  ROOT, readJSON, exists, walkRecords, walkKeys, isConfidenceKey, citesSomething, CONFIDENCE_VALUES
} from './lib.mjs';

const runtime = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')).href);
const { confidenceOf, statusOf, labelFor, mayShow, ENVELOPE_STATUSES } = runtime;

/** Keys that read like a confidence rating but are not one. */
const NOT_A_RATING = /^(confidence_scale|confidence_interval|confidence_reason|confidence_note|by_confidence)$/;

export function runRecordChecks(ctx) {
  const { findings, registry, ledger } = ctx;
  const packs = (registry && registry.packs) || [];
  if (!packs.length) {
    findings.add({
      check: 'record-envelope',
      file: 'data/_provenance.json',
      message: 'The pack registry lists no packs, so no record can be checked.'
    });
    return;
  }

  let totalRecords = 0;
  let totalLow = 0;

  for (const entry of packs) {
    const file = entry.file || `data/${entry.id}.json`;
    if (!exists(file)) continue;
    let doc;
    try { doc = readJSON(file); } catch (e) {
      findings.add({ check: 'pack-parses', file, message: `${file} is not valid JSON: ${e.message}` });
      continue;
    }

    const envelope = entry.envelope || 'legacy';
    const debt = entry.accepted_debt || {};
    const playerFacing = new Set(entry.player_facing_collections || []);
    const seen = new Map();      // collection -> Set(id), for duplicate ids
    const noSource = [];
    const noConfidence = [];
    const lowVisible = [];

    for (const { record, pointer, collection, array } of walkRecords(doc, '', '')) {
      totalRecords++;

      // Duplicate ids inside one array. Two records with the same id means one of them is
      // unreachable by anything that looks a record up by id, and nothing says which.
      if (!seen.has(array)) seen.set(array, new Set());
      const ids = seen.get(array);
      if (ids.has(record.id)) {
        findings.add({
          check: 'record-ids-unique',
          severity: 'blocking',
          file,
          locator: pointer,
          id: record.id,
          message: `Duplicate id "${record.id}" inside ${array} in ${file}.`
        });
      }
      ids.add(record.id);

      if (!citesSomething(record)) noSource.push({ pointer, id: record.id, collection });
      if (!confidenceOf(record)) noConfidence.push({ pointer, id: record.id, collection });
      if (record.confidence === 'low') {
        totalLow++;
        const inPlayerCollection = [...playerFacing].some((c) => collection === c || collection.startsWith(c + '.'));
        if (record.player_facing === true) {
          findings.add({
            check: 'no-low-confidence-to-player',
            severity: 'blocking',
            file,
            locator: pointer,
            id: record.id,
            message: `${file} ${pointer} is marked player_facing with confidence low.`,
            hint: 'Low confidence means an agent could not verify it. That is not something to show a local reader.'
          });
        } else if (inPlayerCollection) {
          lowVisible.push({ pointer, id: record.id, collection });
        }
      }

      // The envelope, in full, for anything a lane produced.
      if (envelope === 'v1') checkEnvelopeV1(record, pointer, file, findings);

      // Proposed stays proposed. If the runtime's own classifier cannot place this record's status,
      // the interface renders it with no marker, and a proposal quietly becomes a fact.
      if (typeof record.status === 'string' && record.status.trim()) {
        const kind = statusOf(record);
        if (!kind) {
          const allowed = ledger.pointerAllowed('status-vocabulary', file, pointer);
          findings.add({
            check: 'status-vocabulary',
            severity: allowed ? 'accepted' : 'blocking',
            file,
            locator: pointer,
            id: record.id,
            message: `status "${String(record.status).slice(0, 80)}" at ${pointer} is not a value `
              + `src/world/data.js can classify${allowed ? ', accepted: ' + allowed : '.'}`,
            hint: 'Add the value to STATUS_VOCABULARY in src/world/data.js under the envelope status it '
              + 'means, or change the record. A status the runtime cannot classify renders with no marker.'
          });
        } else if (kind === 'proposed' && !labelFor(record)) {
          findings.add({
            check: 'proposed-stays-proposed',
            severity: 'blocking',
            file,
            locator: pointer,
            id: record.id,
            message: `${pointer} is proposed and labelFor() gives it no marker.`
          });
        }
      }
    }

    // Confidence values across the whole pack, not only on records: a rating that is not one of the
    // three words means somebody started a second scale.
    for (const { key, pointer, value, parentPointer } of walkKeys(doc)) {
      if (!isConfidenceKey(key) || NOT_A_RATING.test(key)) continue;
      if (typeof value === 'string' && CONFIDENCE_VALUES.includes(value)) continue;
      // A field guide or conventions block explains the scale in prose. Those are documentation.
      if (/^(field_guide|conventions|about|honesty|counts)\b/.test(pointer)) continue;
      // Null is not a rating, but leaving something unrated on purpose and saying why is honest,
      // and is how data/transport.json handles a terminal whose coordinate was left null rather
      // than guessed. Unrated with a reason beside it is advisory; unrated in silence is not.
      if (value === null) {
        const parent = parentPointer
          ? parentPointer.split(/[.[]/).filter(Boolean).reduce((o, k) => (o == null ? o : o[k.replace(/\]$/, '')]), doc)
          : doc;
        const explained = parent && typeof parent === 'object' && (parent.note || parent.reason || parent.why);
        findings.add({
          check: 'confidence-scale',
          severity: explained ? 'advisory' : 'blocking',
          file,
          locator: pointer,
          message: explained
            ? `${key} at ${pointer} is null, unrated on purpose with a note beside it.`
            : `${key} at ${pointer} is null and nothing says why.`,
          hint: explained ? '' : 'Null is not a rating. Rate it, leave the field out, or put a note '
            + 'beside it saying what could not be established.'
        });
        continue;
      }
      const allowed = ledger.pointerAllowed('confidence-scale', file, pointer);
      findings.add({
        check: 'confidence-scale',
        severity: allowed ? 'accepted' : 'blocking',
        file,
        locator: pointer,
        message: `${key} at ${pointer} is ${JSON.stringify(value)}, not one of high, medium, low`
          + (allowed ? `, accepted: ${allowed}` : '.'),
        hint: 'Every pack defines the same three words in its own terms. Nothing may add a fourth.'
      });
    }

    reportDebt(findings, ledger, file, entry, 'missing_source', noSource, debt.missing_source || 0,
      'cites nothing: no source, url, citation or reference field');
    reportDebt(findings, ledger, file, entry, 'missing_confidence', noConfidence, debt.missing_confidence || 0,
      'carries no confidence rating');
    reportDebt(findings, ledger, file, entry, 'low_in_player_collection', lowVisible, debt.low_in_player_collection || 0,
      'is confidence low inside a collection the registry marks player-facing');
  }

  findings.ran('record-envelope', `${totalRecords} records across ${packs.length} packs, ${totalLow} at low confidence`);
}

/**
 * The debt ratchet.
 *
 * Every one of these findings is a real fault. Eleven packs were hand written before any of this
 * existed and they carry hundreds of them, so a gate that failed on all of them today would be
 * switched off today. Instead the count is frozen in the registry, printed every run so nobody
 * forgets it is there, and the moment it grows by one the gate fails and names the new record.
 * Debt that cannot grow is debt that gets paid.
 */
function reportDebt(findings, ledger, file, entry, kind, items, accepted, phrase) {
  if (!items.length && !accepted) return;
  if (items.length > accepted) {
    const shown = items.slice(0, 12);
    findings.add({
      check: 'record-envelope',
      severity: 'blocking',
      file,
      locator: shown.map((i) => i.pointer).join(', ') + (items.length > shown.length ? ` and ${items.length - shown.length} more` : ''),
      id: kind,
      message: `${items.length} record(s) in ${file} ${phrase}; the registry accepts ${accepted}.`,
      hint: `Give the new record(s) what they are missing, or if this is deliberate raise `
        + `packs[${entry.id}].accepted_debt.${kind} in data/_provenance.json and say why in its note. `
        + `New: ${shown.map((i) => i.id || i.pointer).join(', ')}`
    });
    return;
  }
  findings.add({
    check: 'record-envelope',
    severity: 'accepted',
    file,
    id: kind,
    locator: items.slice(0, 6).map((i) => i.id || i.pointer).join(', '),
    message: `${items.length} of ${accepted} accepted record(s) in ${file} ${phrase}.`
      + (items.length < accepted ? ' Fewer than accepted: lower the number in data/_provenance.json.' : '')
  });
}

/**
 * The record envelope, version 1. Every record a lane produces carries all of this, and a record
 * that cannot cite is not a record. docs/INGEST.md is the written form of the same contract.
 */
function checkEnvelopeV1(record, pointer, file, findings) {
  const required = ['source', 'confidence', 'extracted_at', 'extractor', 'status'];
  for (const field of required) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      findings.add({
        check: 'record-envelope',
        severity: 'blocking',
        file,
        locator: pointer,
        id: record.id,
        message: `Envelope field "${field}" is missing on ${pointer} in ${file}.`,
        hint: 'See the record envelope in docs/INGEST.md. A record that cannot cite is not a record.'
      });
    }
  }
  if (record.confidence && !CONFIDENCE_VALUES.includes(record.confidence)) {
    findings.add({
      check: 'record-envelope', severity: 'blocking', file, locator: pointer, id: record.id,
      message: `confidence "${record.confidence}" is not one of high, medium, low.`
    });
  }
  // A lane-produced record carries one of the three envelope statuses exactly. The extra kinds in
  // STATUS_VOCABULARY exist to classify what the legacy packs already say and are not for new work.
  if (record.status && !ENVELOPE_STATUSES.includes(String(record.status).trim().toLowerCase())) {
    findings.add({
      check: 'record-envelope', severity: 'blocking', file, locator: pointer, id: record.id,
      message: `status "${record.status}" is not one of ${ENVELOPE_STATUSES.join(', ')}.`,
      hint: 'The envelope has three statuses. The other kinds in STATUS_VOCABULARY exist to classify '
        + 'what the legacy packs already say, not to widen the envelope.'
    });
  }
  // An assertion about the real world quotes the thing it read. A modelling parameter does not have
  // to, and saying it does would put invented quotes into the packs, which is worse than no quote.
  if (record.asserts === 'real_world' || record.claim_kind === 'fact') {
    if (!record.quote || String(record.quote).trim().length < 8) {
      findings.add({
        check: 'record-envelope', severity: 'blocking', file, locator: pointer, id: record.id,
        message: `${pointer} asserts something about the real world and carries no verbatim quote.`,
        hint: 'Quote the source. If the source cannot be quoted, the record is an inference and should say so.'
      });
    }
    if (!record.locator) {
      findings.add({
        check: 'record-envelope', severity: 'blocking', file, locator: pointer, id: record.id,
        message: `${pointer} asserts something about the real world and names no page or locator.`
      });
    }
  }
}

/**
 * Schema validation per pack. The schemas in tools/ingest/schemas.json are deliberately small: the
 * top-level fields a pack must carry, the collections it must contain and what shape they are, and
 * the fields every record in a collection must have. They were written from what the eleven packs
 * already are, so they lock the shape rather than inventing one, and a lane that produces a pack
 * missing a collection something reads is stopped before the pack is written.
 */
export function runSchemaChecks(ctx) {
  const { findings, registry } = ctx;
  let schemas = {};
  try { schemas = readJSON('tools/ingest/schemas.json').packs || {}; } catch {
    findings.add({ check: 'schema', file: 'tools/ingest/schemas.json', message: 'No pack schemas found.' });
    return;
  }
  let checked = 0;
  for (const entry of (registry.packs || [])) {
    const file = entry.file || `data/${entry.id}.json`;
    const schema = schemas[entry.id];
    if (!schema) {
      findings.add({
        check: 'schema', severity: 'blocking', file, id: entry.id,
        message: `Pack "${entry.id}" is in the registry with no schema in tools/ingest/schemas.json.`,
        hint: 'Every pack the twin loads has a schema. Add one describing what the pack must carry.'
      });
      continue;
    }
    if (!exists(file)) continue;
    let doc;
    try { doc = readJSON(file); } catch { continue; }
    checked++;

    for (const field of schema.required || []) {
      if (doc[field] === undefined) {
        findings.add({
          check: 'schema', severity: 'blocking', file, locator: field, id: entry.id,
          message: `${file} is missing required top-level field "${field}".`
        });
      }
    }
    if (doc.pack !== undefined && schema.pack && doc.pack !== schema.pack) {
      findings.add({
        check: 'schema', severity: 'blocking', file, locator: 'pack', id: entry.id,
        message: `${file} says pack "${doc.pack}", the schema says "${schema.pack}".`
      });
    }
    for (const [collPath, spec] of Object.entries(schema.collections || {})) {
      const arr = collPath.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
      if (!Array.isArray(arr)) {
        findings.add({
          check: 'schema', severity: 'blocking', file, locator: collPath, id: entry.id,
          message: `${file} collection "${collPath}" is ${arr === undefined ? 'missing' : 'not an array'}.`
        });
        continue;
      }
      if (spec.min_records && arr.length < spec.min_records) {
        findings.add({
          check: 'schema', severity: 'blocking', file, locator: collPath, id: entry.id,
          message: `${file} collection "${collPath}" has ${arr.length} records, the schema requires at least ${spec.min_records}.`,
          hint: 'A collection that empties is how a pack silently stops feeding a system.'
        });
      }
      const missing = [];
      for (let i = 0; i < arr.length; i++) {
        for (const f of spec.record_required || []) {
          if (arr[i] == null || arr[i][f] === undefined) missing.push(`${collPath}[${i}].${f}`);
        }
      }
      if (missing.length) {
        findings.add({
          check: 'schema', severity: 'blocking', file, locator: missing.slice(0, 10).join(', '), id: entry.id,
          message: `${missing.length} required record field(s) missing in ${file} ${collPath}.`
        });
      }
    }
  }
  findings.ran('schema', `${checked} packs validated`);
}
