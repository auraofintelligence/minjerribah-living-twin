// The pack registry tool. Reads data/_provenance.json, recomputes everything about each pack that
// can be measured from the pack itself, and writes it back.
//
//   node tools/ingest/registry.mjs              report the registry against what is on disk
//   node tools/ingest/registry.mjs --refresh    recompute and write, if the gate lets it
//   node tools/ingest/registry.mjs --add <id>   add a pack that is on disk and not registered
//
// What --refresh recomputes: version, checksum, size, record count, confidence spread, collection
// list and the fingerprint. What it never touches: the lane, the source documents, the extractor,
// the ingest date, the accepted debt and the notes. Those are somebody's judgement and a tool does
// not get to overwrite a judgement.
//
// A checksum is only a promise if it is hard to refresh dishonestly, so --refresh runs the whole
// gate over the new content before it writes, ignoring only the registry checks it is there to fix,
// and refuses to write anything at all if a blocking fault is found. Refreshing is therefore not a
// way past the gate: it is a record that the content passed it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readText, readJSON, exists, repoFiles, walkRecords, sha256lf, today } from './lib.mjs';
import { runGate, report } from './gate.mjs';
import { computeFingerprint } from './checks-repo.mjs';

const REGISTRY = 'data/_provenance.json';

/** Everything about a pack that can be measured rather than decided. */
export function measurePack(file) {
  const text = readText(file);
  const doc = JSON.parse(text);
  const dist = { high: 0, medium: 0, low: 0, unrated: 0 };
  const collections = new Map();
  let records = 0;
  for (const { record, collection } of walkRecords(doc, '', '')) {
    records++;
    const c = record.confidence;
    if (c === 'high' || c === 'medium' || c === 'low') dist[c]++; else dist.unrated++;
    collections.set(collection, (collections.get(collection) || 0) + 1);
  }
  return {
    version: doc.version === undefined ? null : doc.version,
    checksum: { algorithm: 'sha256-lf', value: sha256lf(text) },
    bytes: Buffer.byteLength(text, 'utf8'),
    records,
    confidence: dist,
    collections: [...collections.entries()].sort().map(([p, n]) => ({ path: p, records: n }))
  };
}

function refresh(registry) {
  const changed = [];
  for (const entry of registry.packs || []) {
    const file = entry.file || `data/${entry.id}.json`;
    if (!exists(file)) { changed.push(`${entry.id}: file missing, left alone`); continue; }
    const m = measurePack(file);
    const before = JSON.stringify([entry.version, entry.checksum, entry.records, entry.confidence]);
    entry.version = m.version;
    entry.checksum = m.checksum;
    entry.bytes = m.bytes;
    entry.records = m.records;
    entry.confidence = m.confidence;
    entry.collections = m.collections;
    if (JSON.stringify([entry.version, entry.checksum, entry.records, entry.confidence]) !== before) {
      changed.push(`${entry.id}: version ${m.version}, ${m.records} records, checksum ${m.checksum.value.slice(0, 12)}`);
    }
  }
  registry.generated = today();
  registry.fingerprint = computeFingerprint(registry);
  return changed;
}

function write(registry) {
  fs.writeFileSync(path.join(ROOT, REGISTRY), JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

const args = process.argv.slice(2);
const RAN_DIRECTLY = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (RAN_DIRECTLY) {
  if (!exists(REGISTRY)) {
    console.error(`${REGISTRY} does not exist. This tool refreshes a registry; it does not invent one.`);
    process.exit(1);
  }
  const registry = readJSON(REGISTRY);

  if (args.includes('--add')) {
    const id = args[args.indexOf('--add') + 1];
    const file = `data/${id}.json`;
    if (!id || !exists(file)) { console.error(`No pack at ${file}.`); process.exit(1); }
    if ((registry.packs || []).some((p) => p.id === id)) { console.error(`${id} is already registered.`); process.exit(1); }
    registry.packs.push({
      id,
      file,
      lane: 'TODO',
      envelope: 'v1',
      status: 'committed',
      sources: [],
      ingested_at: today(),
      extractor: { id: 'TODO', version: 'TODO' },
      note: 'TODO: say what this pack is and how it got here.',
      accepted_debt: { missing_source: 0, missing_confidence: 0, low_in_player_collection: 0 },
      player_facing_collections: [],
      ...measurePack(file)
    });
    registry.packs.sort((a, b) => (a.id < b.id ? -1 : 1));
    registry.fingerprint = computeFingerprint(registry);
    write(registry);
    console.log(`Added ${id}. Fill in the lane, the sources and the extractor by hand: a tool does not know where a pack came from.`);
    process.exit(0);
  }

  if (!args.includes('--refresh')) {
    const changed = refresh(JSON.parse(JSON.stringify(registry)));
    if (!changed.length) console.log('The registry matches what is on disk.');
    else {
      console.log('The registry is stale. --refresh would change:');
      for (const c of changed) console.log('  ' + c);
    }
    process.exit(changed.length ? 1 : 0);
  }

  // Refresh. Run the content half of the gate first over what is actually on disk.
  console.log('Running the gate over the pack content before touching the registry.\n');
  const findings = runGate();
  const blocking = findings.blocking.filter((f) => f.check !== 'registry');
  if (blocking.length) {
    console.log('REFUSED. The gate found blocking faults in the pack content, so nothing was written.\n');
    for (const b of blocking) console.log(`  [${b.check}] ${[b.file, b.locator].filter(Boolean).join(' ')}\n      ${b.message}`);
    console.log('\nA checksum written over content that failed the gate would be a lie about the content.');
    process.exit(1);
  }
  const changed = refresh(registry);
  write(registry);
  console.log(changed.length ? 'Registry refreshed:\n  ' + changed.join('\n  ') : 'Registry refreshed, nothing changed.');
  console.log(`\nfingerprint ${registry.fingerprint}`);
  const after = runGate();
  process.exit(report(after, { quiet: true }));
}
