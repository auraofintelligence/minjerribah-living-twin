// The opening-hours envelope, as a runnable check.
//
// WHY THIS EXISTS
//   A critic deliberately broke `straddie-brewing-co` by deleting `typical_hours.source` and
//   `typical_hours.checked` while leaving `basis: 'published'`, ran the gate, and it passed on
//   content: the two blocking findings were checksum drift and nothing else. `tools/ingest/
//   schemas.json` validates a business record's `id`, `name`, `type`, `township`, `status`, `lat`,
//   `lon`, `confidence` and `source`, and nothing at all inside `typical_hours`. So a published
//   basis with no URL and no date passed every rule in the repository, and a registry refresh would
//   have blessed it.
//
//   Every other rule in this project is a runnable check, on the principle written into
//   `tools/ingest/gate.mjs` that a rule which is not a check is not a rule. The hours rules were the
//   exception. They are not now.
//
//   This file is not in `tools/ingest/`, and that is deliberate: that directory is another agent's
//   floor and adding a step to its gate would be editing it. `tools/gate-audit.mjs` calls this after
//   the main gate and folds the result into the same exit code, so `node tools/gate-audit.mjs`
//   still runs everything and one command is still the answer.
//
// WHAT IT ENFORCES, and each one is a sentence the pack or the interface already claims
//
//   1. basis is one of the four words.
//   2. published or listed means a source URL and a checked date. Both. This is the one the critic
//      broke.
//   3. source_kind agrees with basis: published needs an operator or a government publisher, listed
//      needs a directory or a government one, estimate and none get `none`.
//   4. none means seven unverified days. A blank is a blank; a half-blank is a guess wearing a
//      blank's clothes.
//   5. every day value parses. A typo in a weekday silently becomes 'unverified', which is the
//      quietest way to lose a real opening hour.
//   6. hours_posture is one of the four postures.
//   7. a record that is not a shopfront is never carrying an estimate. That is the fault the last
//      round was pulled up on: an invented office roster on a Traditional Owner corporation and an
//      Elders' council. There is no honest reason to guess a week for a body that does not trade.
//   8. the pack's own honesty claims match the vocabulary blocks, so the prose and the machine
//      cannot drift apart.
//   9. no em dash, in a pack whose notes are long prose.
//
// Blocking, all of it, with the exception of a `checked` date on an estimate, which is advisory:
// nobody has to have gone looking, but the pack should say whether anybody did.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILE = 'data/businesses.json';
// `not trading` is the fifth and it is only ever legal on a record whose status is `closed`: the
// island's wound-up progress association and the seafood shop that shut. Seven closed days and no
// provenance, because there is nothing left to source.
const BASIS = ['published', 'listed', 'estimate', 'none', 'not trading'];
const POSTURE = ['shopfront', 'organisation', 'on-call', 'by-timetable'];
const SOURCE_KIND = ['operator', 'directory', 'government', 'none'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_RE = /^(closed|24h|unverified|(\d{1,2}:\d{2}-(\d{1,2}:\d{2}|late))(,\d{1,2}:\d{2}-(\d{1,2}:\d{2}|late))*)$/;

/** Every hours block on a record: the week itself, the kitchen, and each variant. */
function blocksOf(rec) {
  const t = rec.typical_hours;
  if (!t) return [];
  const out = [{ where: 'typical_hours', block: t, top: true }];
  if (t.kitchen) out.push({ where: 'typical_hours.kitchen', block: t.kitchen, top: false });
  for (const v of t.variants || []) out.push({ where: `typical_hours.variants[${v.id || '?'}]`, block: v, top: false });
  return out;
}

export function runHoursEnvelope() {
  const findings = [];
  const add = (severity, id, message, hint) => findings.push({ severity, id, message, hint });

  if (!fs.existsSync(FILE)) {
    add('blocking', '(pack)', `${FILE} is missing, so there are no opening hours to check.`);
    return findings;
  }
  const raw = fs.readFileSync(FILE, 'utf8');
  // Spelt as a code point, not as the character, because the repository-wide rule forbids the
  // character and a checker that has to name it would otherwise fail the rule it enforces.
  if (raw.includes(String.fromCharCode(0x2014))) {
    add('blocking', '(pack)', 'There is an em dash in the pack.', 'The house rule is a colon, a semicolon, a comma or a full stop.');
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    add('blocking', '(pack)', `${FILE} is not valid JSON: ${e.message}`);
    return findings;
  }

  for (const rec of doc.businesses || []) {
    const id = rec.id || '(no id)';
    const posture = rec.hours_posture || 'shopfront';
    if (!POSTURE.includes(posture)) {
      add('blocking', id, `hours_posture "${posture}" is not one of ${POSTURE.join(', ')}.`);
    }
    if (!rec.typical_hours) {
      if (rec.status !== 'closed') {
        add('advisory', id, 'no typical_hours block at all, so the record is read as an empty week.');
      }
      continue;
    }

    for (const { where, block, top } of blocksOf(rec)) {
      const basis = block.basis || (top ? null : rec.typical_hours.basis);
      if (top && !BASIS.includes(basis)) {
        add('blocking', id, `${where}.basis is "${basis}", which is not one of ${BASIS.join(', ')}.`);
        continue;
      }
      if (top && basis === 'not trading') {
        if (rec.status !== 'closed') {
          add('blocking', id, `${where}.basis is "not trading" and the status is "${rec.status}".`,
            'That basis is only for a business that has closed for good.');
        }
        for (const d of DAYS) {
          if (block[d] !== 'closed') add('blocking', id, `${where}.${d} is "${block[d]}" on a business that has closed for good.`);
        }
        continue;
      }
      const published = basis === 'published' || basis === 'listed';

      // 2. the one the critic broke.
      if (published && !block.source) {
        add('blocking', id, `${where} says basis "${basis}" and carries no source.`,
          'Published hours with nowhere to check them are an estimate with better manners.');
      }
      if (published && !block.checked) {
        add('blocking', id, `${where} says basis "${basis}" and carries no checked date.`,
          'Freshness is a first-class property here: an hour is only as true as the day somebody looked.');
      }
      if (block.checked && !/^\d{4}-\d{2}-\d{2}$/.test(block.checked)) {
        add('blocking', id, `${where}.checked is "${block.checked}", which is not an ISO date.`);
      }
      if (top && basis === 'estimate' && !block.checked) {
        add('advisory', id, 'an estimate that nobody has gone looking for. That is allowed and it should be said.');
      }

      // 3. who published it has to agree with whether anybody did.
      if (top) {
        const kind = block.source_kind;
        if (kind && !SOURCE_KIND.includes(kind)) {
          add('blocking', id, `${where}.source_kind "${kind}" is not one of ${SOURCE_KIND.join(', ')}.`);
        } else if (basis === 'published' && !(kind === 'operator' || kind === 'government')) {
          add('blocking', id, `${where} says the business published its own hours but source_kind is "${kind}".`);
        } else if (basis === 'listed' && !(kind === 'directory' || kind === 'government')) {
          add('blocking', id, `${where} says somebody else published the hours but source_kind is "${kind}".`);
        } else if ((basis === 'estimate' || basis === 'none') && kind !== 'none') {
          add('blocking', id, `${where} has no publisher and source_kind is "${kind}".`);
        }
      }

      // 4 and 5. the days themselves.
      let unverified = 0;
      for (const d of DAYS) {
        const v = block[d];
        if (v === undefined || v === null) {
          if (top) add('blocking', id, `${where} has no value for ${d}.`);
          continue;
        }
        if (!DAY_RE.test(String(v).trim())) {
          add('blocking', id, `${where}.${d} is "${v}", which nothing can read.`,
            'Allowed: closed, 24h, unverified, HH:MM-HH:MM, HH:MM-late, or a comma-separated run of those.');
        }
        if (String(v).trim() === 'unverified') unverified++;
      }
      if (top && basis === 'none' && unverified !== 7) {
        add('blocking', id, `${where} says basis "none" and yet ${7 - unverified} day(s) carry hours.`,
          'A blank is seven unverified days. Anything else is a guess in a blank record.');
      }
      if (top && basis === 'estimate' && unverified === 7) {
        add('blocking', id, `${where} says basis "estimate" and every day is unverified.`,
          'Nothing is being estimated, so the honest basis is "none".');
      }
    }

    // 7. the fault this pass was sent to fix.
    if (posture !== 'shopfront' && rec.typical_hours.basis === 'estimate') {
      add('blocking', id, `is a ${posture} and carries an estimated week.`,
        'A body that is not a shopfront is never asked whether it is open, so a guessed week for it '
        + 'can only ever be the twin describing how somebody else runs. Use basis "none", or carry '
        + 'what the body itself published.');
    }
  }

  // 8. the prose and the vocabulary blocks have to agree.
  const vocab = doc.hours_basis_vocabulary || {};
  for (const b of BASIS) {
    if (!vocab[b]) add('blocking', '(pack)', `hours_basis_vocabulary has no entry for "${b}".`);
  }
  const postureVocab = doc.hours_posture_vocabulary || {};
  for (const p of POSTURE) {
    if (!postureVocab[p]) add('blocking', '(pack)', `hours_posture_vocabulary has no entry for "${p}".`);
  }
  if (!doc.hours_last_reviewed) add('blocking', '(pack)', 'hours_last_reviewed is missing.');

  return findings;
}

/** Print a run and return an exit code, in the same shape the main gate prints. */
export function reportHoursEnvelope(findings, { quiet = false } = {}) {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const advisory = findings.filter((f) => f.severity === 'advisory');
  if (blocking.length) {
    console.log(`\nHOURS ENVELOPE, BLOCKING (${blocking.length})`);
    for (const f of blocking) {
      console.log(`  [hours-envelope] ${FILE} ${f.id}`);
      console.log(`      ${f.message}`);
      if (f.hint && !quiet) console.log(`      -> ${f.hint}`);
    }
  }
  if (advisory.length && !quiet) {
    console.log(`\nHOURS ENVELOPE, ADVISORY (${advisory.length})`);
    for (const f of advisory.slice(0, 8)) console.log(`      ${f.id}: ${f.message}`);
    if (advisory.length > 8) console.log(`      and ${advisory.length - 8} more`);
  }
  if (!blocking.length) console.log(`\nHOURS ENVELOPE OK: 0 blocking, ${advisory.length} advisory.`);
  return blocking.length ? 1 : 0;
}

// Runnable on its own while you are fixing a record, which is faster than the whole gate.
// pathToFileURL rather than a template string: on Windows the hand-rolled version produces
// `file://C:/...` against an import.meta.url of `file:///C:/...`, so the block never runs and the
// checker reports nothing at all, which is the worst way for a checker to fail.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(reportHoursEnvelope(runHoursEnvelope(), { quiet: process.argv.includes('--quiet') }));
}
