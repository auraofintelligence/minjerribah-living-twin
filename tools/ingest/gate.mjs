// The gate. Every lane passes through this before its output is written, and it is the same run
// that a person does by hand with `node tools/gate-audit.mjs`.
//
// Four severities, and the middle one is the reason this could be switched on at all:
//
//   blocking   the gate exits non-zero and names the file, the record and the line.
//   accepted   a blocking-class fault that tools/ingest/ledger.json records as known, with a
//              reason and a frozen count. It prints every run. It fails the moment the count
//              grows. Eleven packs were hand written before any of this existed and they carry
//              real debt; a gate that failed on all of it today would be switched off today, and a
//              gate that ignored it would be a decoration. A count that cannot grow gets paid down.
//   advisory   worth knowing, never fails.
//   review     a rule whose check is a question for a human. Printed every run so it gets asked.
//
// `--strict` promotes accepted to blocking, which is how you see the honest number.

import fs from 'node:fs';
import path from 'node:path';
import { readJSON, exists, Findings } from './lib.mjs';
import { runLoreChecks } from './checks-lore.mjs';
import { runRecordChecks, runSchemaChecks } from './checks-records.mjs';
import { runEmDashCheck, runSpellingCheck, runRegistryChecks } from './checks-repo.mjs';
import { runPersonalDataCheck, runContributionCultureCheck } from './checks-screens.mjs';
import { runCoordinateChecks } from './checks-geo.mjs';
import { runCitationChecks } from './checks-citations.mjs';
import { runOffWorldChecks } from './checks-offworld.mjs';

const LEDGER_FILE = 'tools/ingest/ledger.json';
const VOCAB_FILE = 'tools/ingest/vocabulary.json';

/**
 * The accepted-debt ledger. Every entry is a judgement somebody made once, in writing, with a
 * reason, and the gate holds them to the count they agreed to.
 */
export class Ledger {
  constructor(doc) {
    this.doc = doc || { accepted: [], pointers: [] };
    this._counts = new Map();
    for (const a of this.doc.accepted || []) this._counts.set(`${a.check}|${a.file}|${a.token || ''}`, a);
    this._pointers = new Map();
    for (const p of this.doc.pointers || []) this._pointers.set(`${p.check}|${p.file}|${p.pointer}`, p.reason);
    this._vocab = null;
  }

  static load() {
    let doc = null;
    if (exists(LEDGER_FILE)) {
      try { doc = readJSON(LEDGER_FILE); } catch (e) { console.error(`[gate] ${LEDGER_FILE} is not valid JSON: ${e.message}`); }
    }
    return new Ledger(doc);
  }

  allowance(check, file, token) {
    const hit = this._counts.get(`${check}|${file}|${token || ''}`);
    return hit ? { count: hit.count || 0, reason: hit.reason || 'no reason recorded' } : { count: 0, reason: '' };
  }

  pointerAllowed(check, file, pointer) {
    return this._pointers.get(`${check}|${file}|${pointer}`) || null;
  }

  vocabulary() {
    if (this._vocab) return this._vocab;
    this._vocab = [];
    if (exists(VOCAB_FILE)) {
      try { this._vocab = readJSON(VOCAB_FILE).words || []; } catch { this._vocab = []; }
    }
    return this._vocab;
  }
}

/**
 * Run every check. `only` narrows to one check id for a fast loop while fixing something.
 * Returns the Findings, which the caller reports and turns into an exit code.
 */
export function runGate({ only = null, registryPath = 'data/_provenance.json' } = {}) {
  const findings = new Findings();
  const ledger = Ledger.load();

  let registry = null;
  if (exists(registryPath)) {
    try { registry = readJSON(registryPath); } catch (e) {
      findings.add({ check: 'registry', file: registryPath, message: `${registryPath} is not valid JSON: ${e.message}` });
    }
  } else {
    findings.add({
      check: 'registry', file: registryPath,
      message: 'There is no pack registry, so nothing records where any pack came from.',
      hint: 'node tools/ingest/registry.mjs --refresh writes one from what is on disk.'
    });
  }

  const ctx = { findings, ledger, registry: registry || { packs: [], lanes: {} } };
  const steps = [
    ['lore', runLoreChecks],
    ['records', runRecordChecks],
    ['schema', runSchemaChecks],
    ['registry', runRegistryChecks],
    ['em-dash', runEmDashCheck],
    ['spelling', runSpellingCheck],
    // The two screens the map lane needed. They are here rather than inside that lane because a rule
    // that lives in the tool which happened to find the problem is a rule the next tool does not
    // have. Both also read the staging area, which nothing else does, so a contribution is looked at
    // before somebody promotes it rather than afterwards.
    ['personal-data', runPersonalDataCheck],
    ['contribution-culture', runContributionCultureCheck],
    // Positions, re-checked against the map every run rather than once at ingest. A lane's own
    // bounds check is a statement about the afternoon it ran; this is a property of the repository.
    ['coordinates', runCoordinateChecks],
    // Does the citation on a record name anything? Until this step existed the gate checked that a
    // source field was present and never that it resolved, so renaming one key in a pack's own
    // source registry left an Act cited to an id that was not there and the gate said OK. The same
    // step resolves every other pointer a pack makes, which is the same hole wearing a different
    // field name: a lever naming a decider no institution defines, a matter naming an ecology
    // record that does not exist.
    ['citations', runCitationChecks],
    // The third register. data/civic.json now carries speculative material, which is safe only
    // while five rules hold, and a rule that is not a runnable check is not a rule. The one that
    // matters most is the one-way rule: the register may name a lever, and nothing in the default
    // island state may name the register, which is the only version of "turning it on changes no
    // number" that a machine can keep.
    ['off-world', runOffWorldChecks]
  ];
  // A typo in --only that silently ran nothing would report a green gate over an empty run, which is
  // the worst failure mode a checker has.
  if (only && !steps.some(([id]) => id === only)) {
    findings.add({
      check: 'gate-itself', severity: 'blocking', file: 'tools/gate-audit.mjs',
      message: `--only "${only}" is not a check group. Groups are: ${steps.map(([id]) => id).join(', ')}.`,
      hint: 'Nothing was checked. A green run from a narrowed gate proves nothing about the groups it skipped.'
    });
    return findings;
  }
  for (const [id, fn] of steps) {
    if (only && only !== id) continue;
    try {
      fn(ctx);
    } catch (e) {
      findings.add({
        check: 'gate-itself', severity: 'blocking', file: `tools/ingest (${id})`,
        message: `The ${id} checks threw: ${e && e.message}`,
        hint: 'A gate that crashes is a gate that passes everything. Fix this before trusting a green run.'
      });
      if (process.env.GATE_DEBUG) console.error(e);
    }
  }
  return findings;
}

/** Print a run in the shape a person reads top to bottom and stops at the first thing that matters. */
export function report(findings, { strict = false, quiet = false } = {}) {
  const blocking = findings.items.filter((i) => i.severity === 'blocking' || (strict && i.severity === 'accepted'));
  const accepted = strict ? [] : findings.bySeverity('accepted');
  const advisory = findings.bySeverity('advisory');
  const review = findings.bySeverity('review');

  const line = (i) => {
    const where = [i.file, i.locator].filter(Boolean).join(' ');
    console.log(`  [${i.check}] ${where}`);
    console.log(`      ${i.message}`);
    if (i.hint && !quiet) console.log(`      -> ${i.hint}`);
  };

  if (blocking.length) {
    console.log(`\nBLOCKING (${blocking.length})`);
    for (const i of blocking) line(i);
  }
  if (review.length && !quiet) {
    console.log(`\nFOR A HUMAN TO ANSWER (${review.length}). These rules cannot be executed; they are questions.`);
    for (const i of review) {
      console.log(`  [${i.check}] ${i.message}`);
      if (i.hint) console.log(`      ${i.hint}`);
    }
  }
  if (accepted.length && !quiet) {
    console.log(`\nACCEPTED DEBT (${accepted.length}), recorded in tools/ingest/ledger.json and data/_provenance.json.`);
    console.log('Every one of these is a real fault held at a frozen count. Run with --strict to fail on them.');
    for (const i of accepted) console.log(`  [${i.check}] ${[i.file, i.locator].filter(Boolean).join(' ')}\n      ${i.message}`);
  }
  if (advisory.length && !quiet) {
    console.log(`\nADVISORY (${advisory.length})`);
    const byCheck = new Map();
    for (const i of advisory) byCheck.set(i.check, (byCheck.get(i.check) || 0) + 1);
    for (const [check, n] of byCheck) {
      console.log(`  [${check}] ${n} item(s)`);
      for (const i of advisory.filter((x) => x.check === check).slice(0, 8)) {
        console.log(`      ${i.message}`);
      }
      if (n > 8) console.log(`      and ${n - 8} more`);
    }
  }

  if (!quiet) {
    console.log('\nCHECKS RUN');
    for (const c of findings.checksRun) console.log(`  ${c.check}${c.note ? ': ' + c.note : ''}`);
  }

  console.log('');
  if (blocking.length) {
    console.log(`GATE FAILED: ${blocking.length} blocking finding(s).`);
    return 1;
  }
  console.log(`GATE OK: 0 blocking, ${accepted.length} accepted, ${advisory.length} advisory, ${review.length} for review.`);
  return 0;
}

/**
 * The one call a lane makes before it writes anything. Throws rather than exits, because a lane is
 * in the middle of doing something and needs to be able to say what it did not do.
 */
export function gateOrThrow(opts = {}) {
  const findings = runGate(opts);
  const blocking = findings.blocking;
  if (blocking.length) {
    const names = blocking.slice(0, 5).map((b) => `${b.check} ${b.file} ${b.locator}`).join('; ');
    const err = new Error(`the gate found ${blocking.length} blocking fault(s) and nothing was written: ${names}`);
    err.findings = findings;
    throw err;
  }
  return findings;
}
