// The scenario lane. PARTLY BUILT: the stamping half, which is registry work and belongs here.
// Running a scenario and writing its report belongs to the scenario system and is not this file.
//
//   node tools/ingest/lane-scenario.mjs --stamp <scenario.json>
//   node tools/ingest/lane-scenario.mjs --verify <scenario.json>
//
// What a stamp is for. docs/DIRECTION.md calls replay peer review: because the same seed and the
// same packs produce the same island, any claim the twin makes can be checked by anybody, and a
// claim backed by a replayable run outranks one that is not. That only works if a scenario carries
// enough to reconstruct the exact world it ran in. A seed alone is not enough, because the packs
// move. So a stamp is the seed, the registry fingerprint, and every pack id, version and checksum
// as they stood, plus the fact that the gate passed over that content at that moment.
//
// A scenario that will not stamp is a scenario whose findings cannot be checked by anyone else,
// and this lane says so rather than stamping it anyway.
//
// A scenario definition:
//
// {
//   "id": "visitor-cap-summer",
//   "question": "the one thing this run is meant to answer, in a sentence",
//   "seed": 19770614,
//   "start": "2026-12-20T05:20",
//   "ticks": 4320,
//   "inputs": [ { "lever": "camping-capacity", "pack": "civic", "set": 0.8,
//                 "basis": "civic.levers.camping-capacity" } ],
//   "wishes": [],
//   "labels": ["proposed, not offered"]
// }
//
// Every input names the pack record it rests on, because docs/DIRECTION.md requires every line of a
// scenario report to cite the pack record or rule it rests on, and a report cannot do that if the
// scenario did not.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, exists, walkRecords, today } from './lib.mjs';
import { runGate } from './gate.mjs';

export const EXTRACTOR = { id: 'lane-scenario', version: '1.0' };
const REGISTRY = 'data/_provenance.json';

/** Does this input's `basis` resolve to a record that actually exists? */
function resolves(basis) {
  const m = String(basis || '').match(/^([a-z_]+)\.([A-Za-z0-9_.[\]]+)\.([a-z0-9-]+)$/);
  if (!m) return false;
  const [, pack, collection, id] = m;
  const file = `data/${pack}.json`;
  if (!exists(file)) return false;
  let doc;
  try { doc = readJSON(file); } catch { return false; }
  for (const { record, collection: c } of walkRecords(doc, '', '')) {
    if (record.id === id && (c === collection || c.replace(/\[\]/g, '') === collection)) return true;
  }
  return false;
}

export function validate(scenario) {
  const problems = [];
  const fail = (where, message) => problems.push({ where, message });
  if (!scenario.id) fail('id', 'no id');
  if (!scenario.question || String(scenario.question).length < 12) {
    fail('question', 'a scenario states the one thing it is meant to answer. A run with no question '
      + 'produces a report nobody can judge.');
  }
  if (!Number.isInteger(scenario.seed)) fail('seed', 'seed must be an integer. Same seed plus same packs is the whole of replayability.');
  if (!Number.isInteger(scenario.ticks) || scenario.ticks < 1) fail('ticks', 'ticks must be a positive integer');
  if (!Array.isArray(scenario.inputs) || !scenario.inputs.length) fail('inputs', 'a scenario with no inputs is a plain run, not a scenario');
  for (const [i, input] of (scenario.inputs || []).entries()) {
    if (!input.basis) {
      fail(`inputs[${i}]`, 'no basis. Every input names the pack record it rests on, because every '
        + 'line of the report has to cite the record or rule it rests on.');
      continue;
    }
    if (!resolves(input.basis)) fail(`inputs[${i}]`, `basis "${input.basis}" does not resolve to a record in the packs`);
  }
  return problems;
}

/** Stamp a validated scenario with everything needed to run it again exactly. */
export function stamp(scenario) {
  const problems = validate(scenario);
  if (problems.length) {
    const err = new Error(`the scenario does not validate: ${problems.map((p) => p.where + ' ' + p.message).join('; ')}`);
    err.problems = problems;
    throw err;
  }
  const findings = runGate();
  if (findings.blocking.length) {
    throw new Error(`the gate found ${findings.blocking.length} blocking fault(s) in the packs, so this `
      + 'scenario was not stamped. A stamp says the content passed the gate; it cannot say that if it did not.');
  }
  const registry = readJSON(REGISTRY);
  return {
    ...scenario,
    replay: {
      seed: scenario.seed,
      start: scenario.start || null,
      ticks: scenario.ticks,
      fingerprint: registry.fingerprint,
      packs: (registry.packs || []).map((p) => ({ id: p.id, version: p.version, checksum: p.checksum.value })),
      gate: 'passed',
      stamped_at: today(),
      stamped_by: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
      how_to_replay: 'node tools/headless.mjs --ticks ' + scenario.ticks + ' with this seed, against a '
        + 'checkout whose data/_provenance.json fingerprint matches. If the fingerprint differs the '
        + 'packs have moved and the findings are about a different island.'
    },
    labels: [...new Set([...(scenario.labels || []), 'proposed, not offered',
      'a scenario report is evidence for humans to decide with, never a decision'])]
  };
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-scenario.mjs');
if (RAN_DIRECTLY) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 34).join('\n'));
    process.exit(0);
  }
  const scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args.includes('--verify')) {
    const problems = validate(scenario);
    if (!problems.length) console.log('The scenario validates.');
    else for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
    process.exit(problems.length ? 1 : 0);
  }
  try {
    const stamped = stamp(scenario);
    fs.writeFileSync(file, JSON.stringify(stamped, null, 2) + '\n', 'utf8');
    console.log(`Stamped ${scenario.id}: seed ${stamped.replay.seed}, fingerprint ${stamped.replay.fingerprint}, `
      + `${stamped.replay.packs.length} packs.`);
  } catch (e) {
    console.error('REFUSED: ' + e.message);
    process.exit(1);
  }
}
