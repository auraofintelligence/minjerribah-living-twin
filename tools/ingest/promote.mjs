// Promotion: the only supported way a data pack is written.
//
//   node tools/ingest/promote.mjs <candidates.json> --pack <id> --collection <name>
//
// This is where the brief's "it must be impossible to write a pack without the gate having run"
// is actually enforced, and the enforcement is a transaction rather than a promise:
//
//   1. Every candidate must have been read by a person. A candidate that still carries the `needs`
//      note the lane wrote is one nobody has looked at, and promotion refuses the whole batch.
//   2. The pack is written, and the registry entry with it: version, checksum, record count,
//      confidence spread, fingerprint.
//   3. The whole gate runs over the result.
//   4. If anything blocks, the pack and the registry are put back exactly as they were and the
//      findings are printed. Nothing half-written survives a failed promotion.
//
// So a pack on disk is a pack that passed, and its checksum in data/_provenance.json is the record
// that it did. That is the property a data officer needs: not that somebody ran a check, but that
// the file could not have got there without one.
//
// Nothing here reaches the network, and nothing here decides anything. The lane found the lines,
// a person decided what they mean, and this writes down the result and proves it holds.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, exists, sha256lf, today } from './lib.mjs';
import { runGate, report } from './gate.mjs';
import { measurePack } from './registry.mjs';
import { computeFingerprint } from './checks-repo.mjs';

const REGISTRY = 'data/_provenance.json';

function backup(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function restore(file, content) {
  const full = path.join(ROOT, file);
  if (content === null) { if (fs.existsSync(full)) fs.unlinkSync(full); return; }
  fs.writeFileSync(full, content, 'utf8');
}

/** A candidate nobody has read still says so. */
function unread(candidates) {
  return candidates.filter((c) => c.needs || c.review === 'pending');
}

export function promote({ candidatesFile, packId, collection, lane, file }) {
  const batch = readJSON(candidatesFile);
  if (batch.kind !== 'ingest-candidates') throw new Error(`${candidatesFile} is not a candidates file.`);
  const candidates = batch.candidates || [];
  if (!candidates.length) throw new Error('there are no candidates in that file.');

  const notRead = unread(candidates);
  if (notRead.length) {
    throw new Error(`${notRead.length} of ${candidates.length} candidates still carry the note the lane `
      + 'wrote for a person to act on, so nobody has read them. Delete what is wrong, rate what is '
      + 'left, remove the `needs` field from each record you are keeping, and run this again. '
      + `First: ${notRead[0].id}`);
  }

  // Most packs sit at data/<id>.json. A contribution pack goes to data/contributions/, because
  // checks-lore.mjs widens the sacred-sites prohibition to cover that directory: a pack of pins
  // somebody else drew is exactly the material that rule was widened for. --file names the path.
  const packFile = file || `data/${packId}.json`;
  fs.mkdirSync(path.dirname(path.join(ROOT, packFile)), { recursive: true });
  const packBefore = backup(packFile);
  const registryBefore = backup(REGISTRY);

  try {
    const pack = packBefore ? JSON.parse(packBefore) : {
      pack: packId,
      version: '0.1.0',
      generated: today(),
      about: `Promoted from ${path.basename(candidatesFile)} through the ${lane} lane.`,
      confidence_scale: {
        high: 'The document states this directly on the page cited.',
        medium: 'The document supports it but the reading involves a judgement, or the figure may have moved.',
        low: 'Plausible and useful for the simulation, but not verified. Do not show it to a player as fact.'
      },
      // A lane may declare the top-level fields its own pack has to carry. This skeleton is generic
      // and a schema is per pack, so without this a pack from a new lane fails its own schema on the
      // first promotion and there is nowhere honest to put the fix. The pack id and the collection
      // are set after it, so a header cannot rename either.
      ...(batch.pack_header || {}),
      [collection]: []
    };
    pack.pack = packId;
    pack[collection] = pack[collection] || [];
    const existing = new Set(pack[collection].map((r) => r.id));
    let added = 0;
    let replaced = 0;
    for (const c of candidates) {
      const clean = { ...c };
      delete clean.needs;
      delete clean.matched_term;
      if (existing.has(c.id)) {
        pack[collection] = pack[collection].map((r) => (r.id === c.id ? clean : r));
        replaced++;
      } else {
        pack[collection].push(clean);
        added++;
      }
    }
    pack.generated = today();
    fs.writeFileSync(path.join(ROOT, packFile), JSON.stringify(pack, null, 2) + '\n', 'utf8');

    const registry = readJSON(REGISTRY);
    let entry = (registry.packs || []).find((p) => p.id === packId);
    if (!entry) {
      entry = {
        id: packId,
        file: packFile,
        lane,
        envelope: 'v1',
        pack_status: 'committed',
        sources: [batch.document ? batch.document.id : batch.batch].filter(Boolean),
        ingested_at: today(),
        extractor: batch.extractor || { id: lane, version: '1.0' },
        player_facing_collections: [],
        accepted_debt: { missing_source: 0, missing_confidence: 0, low_in_player_collection: 0 },
        note: `Promoted from ${path.basename(candidatesFile)}.`
      };
      registry.packs.push(entry);
      registry.packs.sort((a, b) => (a.id < b.id ? -1 : 1));
    }
    Object.assign(entry, measurePack(packFile));
    entry.ingested_at = today();
    registry.fingerprint = computeFingerprint(registry);
    registry.generated = today();
    fs.writeFileSync(path.join(ROOT, REGISTRY), JSON.stringify(registry, null, 2) + '\n', 'utf8');

    const findings = runGate();
    if (findings.blocking.length) {
      restore(packFile, packBefore);
      restore(REGISTRY, registryBefore);
      report(findings, { quiet: true });
      throw new Error(`the gate found ${findings.blocking.length} blocking fault(s), so ${packFile} and `
        + 'the registry were put back exactly as they were. Nothing was written.');
    }
    return { packFile, added, replaced, fingerprint: registry.fingerprint, findings };
  } catch (e) {
    restore(packFile, packBefore);
    restore(REGISTRY, registryBefore);
    throw e;
  }
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/promote.mjs');
if (RAN_DIRECTLY) {
  const args = process.argv.slice(2);
  const val = (f, d = null) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
  const candidatesArg = args.find((a) => !a.startsWith('--') && a !== val('--pack') && a !== val('--collection') && a !== val('--lane') && a !== val('--file'));
  if (!candidatesArg) {
    console.log('usage: node tools/ingest/promote.mjs <candidates.json> --pack <id> --collection <name> [--lane document] [--file data/contributions/<id>.json]');
    process.exit(1);
  }
  try {
    const r = promote({
      candidatesFile: candidatesArg,
      packId: val('--pack'),
      collection: val('--collection', 'records'),
      file: val('--file'),
      lane: val('--lane', JSON.parse(fs.readFileSync(candidatesArg, 'utf8')).lane || 'document')
    });
    console.log(`Promoted into ${r.packFile}: ${r.added} added, ${r.replaced} replaced.`);
    console.log(`The gate passed over the result. Registry fingerprint is now ${r.fingerprint}.`);
  } catch (e) {
    console.error('\nREFUSED: ' + e.message);
    process.exit(1);
  }
}
