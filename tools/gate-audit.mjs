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
//   node tools/hours-envelope.mjs           just the opening-hours envelope, while fixing a record
//
// Exit code is non-zero on any blocking finding, and every finding names the file, the record and
// the line. Groups: lore, records, schema, registry, em-dash, spelling, hours.
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
import { runHoursEnvelope, reportHoursEnvelope } from './hours-envelope.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);

let code = 0;

if (!has('--needs-only')) {
  // The opening-hours envelope. It lives outside tools/ingest/ because that directory is another
  // agent's floor, and it runs from here so that one command is still the whole answer. It checks
  // the thing the schema does not: that a published trading hour carries a URL and a date, that a
  // blank record is actually blank, and that nothing which is not a shopfront is carrying a guessed
  // week. See the header of tools/hours-envelope.mjs for why each rule is there.
  //
  // `--only hours` runs it alone, so `runGate` is skipped rather than handed a group name it does
  // not know: it would answer that with a blocking finding about the flag, which is a checker
  // failing over the way you asked to run it.
  const only = val('--only', null);
  const hoursOnly = only === 'hours';
  const findings = hoursOnly ? null : runGate({ only });
  // Skipped when the run is narrowed to another group, and it says nothing at all rather than
  // printing OK. A green line from a check that did not run is the one thing worse than a red one.
  const hoursRan = !only || hoursOnly;
  const hours = hoursRan ? runHoursEnvelope() : [];
  const hoursBlocking = hours.filter((f) => f.severity === 'blocking').length;
  if (has('--json')) {
    console.log(JSON.stringify({
      blocking: (findings ? findings.blocking.length : 0) + hoursBlocking,
      accepted: findings ? findings.bySeverity('accepted').length : 0,
      advisory: (findings ? findings.bySeverity('advisory').length : 0) + hours.filter((f) => f.severity === 'advisory').length,
      review: findings ? findings.bySeverity('review').length : 0,
      checksRun: (findings ? findings.checksRun : []).concat([{ check: 'hours-envelope', note: `${hours.length} finding(s)` }]),
      items: (findings ? findings.items : []).concat(hours.map((f) => ({ check: 'hours-envelope', file: 'data/businesses.json', locator: f.id, severity: f.severity, message: f.message, hint: f.hint })))
    }, null, 2));
    code = (findings && findings.blocking.length) || hoursBlocking ? 1 : 0;
  } else {
    if (findings) code = report(findings, { strict: has('--strict'), quiet: has('--quiet') });
    if (hoursRan) code = reportHoursEnvelope(hours, { quiet: has('--quiet') }) || code;
    else console.log('\nHOURS ENVELOPE: not run, because --only narrowed this to ' + only + '.');
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
