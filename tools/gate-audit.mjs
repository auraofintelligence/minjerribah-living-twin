// The gate. One command, and nothing writes a data pack without it having run.
//
//   node tools/gate-audit.mjs                every rule over every pack and every file
//   node tools/gate-audit.mjs --strict       accepted debt counts as blocking: the honest number
//   node tools/gate-audit.mjs --only lore    one group while you fix something
//   node tools/gate-audit.mjs --quiet        blocking findings only
//   node tools/gate-audit.mjs --json         machine-readable, for another tool
//   node tools/gate-audit.mjs --needs        also run the slow needs residual audit
//   node tools/gate-audit.mjs --needs-only --ticks 4320    just that audit, one sim-month
//
// Exit code is non-zero on any blocking finding, and every finding names the file, the record and
// the line. Groups: lore, records, schema, registry, em-dash, spelling.
//
// What it enforces, in one place, because a rule that is not a runnable check is not a rule:
//
//   the thirteen prohibitions in data/lore.json, over data/**, src/**, docs/** and assets/**
//   no record without a source and a confidence, ratcheted against a frozen count per pack
//   nothing at low confidence reachable by player-facing code
//   one confidence scale, three words, no second scale and no null rating
//   a schema per pack, and every pack accounted for in data/_provenance.json with a live checksum
//   no em dash anywhere in the repository, code comments included
//   Australian English in player-facing strings
//   anything proposed still marked proposed by the time src/world/data.js labels it
//
// This file used to hold the needs residual audit. That audit still exists and still passes; it
// moved to tools/ingest/needs-residual.mjs and runs from here with --needs, because it takes
// minutes and the data gate takes about a second, and a gate nobody can afford to run is a gate
// nobody runs. docs/INGEST.md explains the whole spine.

import { runGate, report } from './ingest/gate.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);

let code = 0;

if (!has('--needs-only')) {
  const findings = runGate({ only: val('--only', null) });
  if (has('--json')) {
    console.log(JSON.stringify({
      blocking: findings.blocking.length,
      accepted: findings.bySeverity('accepted').length,
      advisory: findings.bySeverity('advisory').length,
      review: findings.bySeverity('review').length,
      checksRun: findings.checksRun,
      items: findings.items
    }, null, 2));
    code = findings.blocking.length ? 1 : 0;
  } else {
    code = report(findings, { strict: has('--strict'), quiet: has('--quiet') });
  }
}

if (has('--needs') || has('--needs-only')) {
  console.log('\n' + '-'.repeat(90) + '\nNEEDS RESIDUAL AUDIT\n');
  const { runNeedsResidualAudit } = await import('./ingest/needs-residual.mjs');
  const ticks = Number(val('--ticks', 1008));
  const needsCode = await runNeedsResidualAudit(ticks);
  code = code || needsCode;
}

process.exit(code);
