// Connectors that exist in order to refuse, and to keep checking that the refusal is still right.
//
// tools/ingest/lane-era.mjs set this pattern: a file whose job is to say no, with its reasons in
// its own header, so that the next agent who notices the gap finds the reasoning rather than the
// temptation. These two go one step further and re-read the source every run, because a refusal
// held in a document is a memory and a refusal that re-reads its source is a check.
//
// Each returns what it found, what rule that triggers, and whether the ground for refusing has
// changed since somebody last looked. If a source stops carrying the material that disqualified it,
// this says so and asks a human to look again. It never lifts its own refusal.

import fs from 'node:fs';
import path from 'node:path';
import { REPOS_ROOT, readCheckout, nowIso } from './lib.mjs';
import { connector as declared } from './registry.mjs';

/**
 * Straddie News. Refused, and this is the strongest refusal in the layer.
 *
 * The repository's own footer calls it an internal research document. Its main table is a
 * stakeholder map, and two of its stakeholders are QYAC and MMEIC, each carrying a characterisation
 * of the relationship and a strategy for handling it. Reading any of that into this twin would be
 * this project representing a Traditional Owner organisation's position and internal workings,
 * from a document that was not written for publication. That is the one thing this project may
 * never do, under a blocking rule, and no framing of the source changes it.
 *
 * What is checked every run: is the internal marker still there, and are those two organisations
 * still in it. If both answers stop being yes, a human still has to decide, and this will say so.
 */
export function checkStraddieNews() {
  const spec = declared('straddie-news');
  const checkout = readCheckout(spec.source.id);
  const found = {
    connector: 'straddie-news',
    checked_at: nowIso(),
    source: checkout,
    verdict: 'refused',
    evidence: [],
    still_true: true
  };
  if (!checkout.present) {
    found.evidence.push('No checkout present, so nothing could be re-read. The refusal stands on the record already written.');
    return found;
  }
  let text = '';
  try { text = fs.readFileSync(path.join(checkout.path, 'index.html'), 'utf8'); } catch {
    found.evidence.push('index.html could not be read. The refusal stands.');
    return found;
  }
  const internal = /internal research document/i.test(text);
  const namesQyac = /\bQYAC\b/.test(text) || /Quandamooka Yoolooburrabee/i.test(text);
  const namesMmeic = /\bMMEIC/i.test(text) || /Minjerribah Moorgumpin/i.test(text);
  const hasStrategyField = /strategy\s*:/i.test(text);

  if (internal) found.evidence.push('The document still describes itself as an internal research document.');
  if (namesQyac || namesMmeic) {
    found.evidence.push('It still names ' + [namesQyac ? 'QYAC' : null, namesMmeic ? 'MMEIC' : null]
      .filter(Boolean).join(' and ') + ' as entries in a stakeholder table.');
  }
  if (hasStrategyField) {
    found.evidence.push('Those entries still carry a strategy field, which is a position about an '
      + 'organisation rather than a fact published by it.');
  }
  found.still_true = internal || namesQyac || namesMmeic;
  if (!found.still_true) {
    found.evidence.push('None of the material that disqualified this source was found this run. That is not '
      + 'permission: a human has to read the repository and decide, and until then the refusal stands.');
  }
  found.rule = 'The blocking cultural rule this project holds: two real organisations may be named where they '
    + 'are publicly listed, and their publicly advertised events may be listed exactly as advertised. Their '
    + 'views, decisions, internal workings and anything a member would have had to say are not this project\'s.';
  return found;
}

/**
 * Point Lookout Fishing Club. Refused for two separate reasons, and the first one is a correction.
 *
 * The brief that asked for this connector described PLFC as a football club with fixtures and
 * results. It is a fishing club, it was formed in 2024, and neither repository holds a fixture or a
 * result. Writing that down is the whole value of this entry, because the next agent will otherwise
 * spend a wave looking for a fixture list that does not exist.
 *
 * The second reason is the one that would still stand if the fixtures appeared. What is in
 * PLFC_2026_Data is an AGM dashboard: capacity, shortcomings, remedies, grant readiness, a
 * comparison against two other island clubs. That is committee material. A member putting it on a
 * web page for a meeting is not a club resolution to publish it inside a model of the island, and
 * the noticeboard network's own publication boundary keeps internal conflict, negotiation and
 * capacity material private for exactly this reason.
 */
export function checkPlfc() {
  const spec = declared('plfc');
  const checkout = readCheckout(spec.source.id);
  const found = {
    connector: 'plfc',
    checked_at: nowIso(),
    source: checkout,
    verdict: 'refused',
    evidence: [],
    still_true: true
  };
  if (!checkout.present) {
    found.evidence.push('No checkout present. The refusal stands on the record already written.');
    return found;
  }
  let text = '';
  try { text = fs.readFileSync(path.join(checkout.path, 'index.html'), 'utf8'); } catch {
    found.evidence.push('index.html could not be read. The refusal stands.');
    return found;
  }
  const isFishing = /fishing club/i.test(text);
  const isAgm = /AGM/i.test(text);
  const hasFixtures = /\bfixture|\bround \d|\bvs\b|\bladder\b/i.test(text);
  const hasGovernance = /shortcoming|remed|capacity|grant readiness/i.test(text);

  if (isFishing) {
    found.evidence.push('The source names the club as Point Lookout Fishing Club. The brief that asked for '
      + 'this connector described a football club with fixtures and results. It is a fishing club.');
  }
  if (!hasFixtures) found.evidence.push('No fixture, round, ladder or result appears anywhere in the source.');
  if (isAgm) found.evidence.push('The page is an AGM dashboard: a working document for a committee meeting.');
  if (hasGovernance) {
    found.evidence.push('It carries capacity, shortcomings, remedies and grant readiness, which is club '
      + 'governance rather than a public feed.');
  }
  found.still_true = !hasFixtures || hasGovernance;
  found.rule = 'Nothing enters this twin that an organisation has not published as public. A page put up for '
    + 'a meeting is not a decision to publish, and the club has not been asked.';
  found.ask = 'If the club wants competition dates and public results on the island calendar, a plain list of '
    + 'dates and a yes is the whole of it, and it would make the twin\'s weekends real.';
  return found;
}

export const REFUSALS = {
  'straddie-news': checkStraddieNews,
  plfc: checkPlfc
};

export function runRefusal(id) {
  const fn = REFUSALS[id];
  if (!fn) throw new Error(`no refusal check for "${id}"`);
  return fn();
}

/** Directory listing helper: which of the declared sources are actually on this machine. */
export function sourcesPresent() {
  const out = [];
  for (const dir of fs.readdirSync(REPOS_ROOT, { withFileTypes: true })) {
    if (dir.isDirectory()) out.push(dir.name);
  }
  return out;
}
