// The contribution lane. BUILT as far as intake normalisation, and no further on purpose.
//
// Takes a batch of contributions in the intake shape below and turns them into envelope records
// with attribution, consent, visibility and a coarsened location. It is the machinery behind the
// promise in docs/PARTICIPATION.md that there is one spine and no separate, lower-trust lane for
// community content: a resident's correction and a council document arrive as the same shape of
// record and pass the same gate.
//
//   node tools/ingest/lane-contribution.mjs <batch.json>
//
// What it will not do, and why:
//
//   It does not open a form, a portal or a network connection. Contributions arrive out of band,
//   on paper, in conversation, at a booth, and somebody types them in. The intake file is the
//   boundary.
//
//   It does not decide which of the ten lanes in docs/PARTICIPATION.md is open. That is the
//   owner's call and it is on the ask list in that document. This tool validates whatever it is
//   given against the rules that are already settled.
//
//   It refuses memory anchors outright. Lane 9 in that document has the strictest floor in the
//   project, pointer never payload, and the question of whether it proceeds at all is the owner's
//   and the Traditional Owners' before the first anchor ships. A tool that could write one today
//   would be answering a question nobody has asked yet.
//
//   It never records hours. src/systems/economy/chour.js has already run the experiment that
//   shows why, and docs/PARTICIPATION.md states it plainly: nothing in any contribution lane may
//   become an hour-verification protocol. A field called hours in an intake file is an error, and
//   this tool treats it as one.
//
// The intake shape:
//
// {
//   "kind": "ingest-contributions",
//   "batch": "2026-08-plfc-noticeboard",
//   "collected_by": "name of the person who typed these in",
//   "method": "spoken | paper | workshop | booth | measurement | scan",
//   "collected_on": "2026-08-09",
//   "contributions": [
//     { "id": "...", "about": "what this is a fact about, a place id or a business id",
//       "claim": "the fact, in the contributor's words or the transcriber's",
//       "contributed_by": "name, or `withheld`",
//       "role": "player | builder | developer | researcher | custodian",
//       "consent": { "given": true, "wording": "...", "recorded_by": "...", "guardian": "" },
//       "visibility": "private | island_community | public_twin",
//       "confidence": "high | medium | low",
//       "place": { "lat": -27.42, "lon": 153.54, "precision_m": 500 } }
//   ]
// }

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, today } from './lib.mjs';

export const EXTRACTOR = { id: 'lane-contribution', version: '1.0' };

const ROLES = ['player', 'builder', 'developer', 'researcher', 'custodian'];
const METHODS = ['spoken', 'paper', 'workshop', 'booth', 'measurement', 'scan'];
const VISIBILITY = ['private', 'island_community', 'public_twin'];
const FORBIDDEN_FIELDS = ['hours', 'hours_logged', 'c_hours', 'chours', 'volunteer_hours', 'time_logged'];

/**
 * Coarsen a location before it is written, not before it is displayed.
 *
 * docs/PARTICIPATION.md is specific about this: precise locations of anything vulnerable never
 * enter the repository, and fuzzing happens before commit rather than at display time, because a
 * runtime filter is one bug away from publishing the thing it was hiding. Rounding is deterministic
 * and lossy in the same way every time, which is the point: the same input always coarsens to the
 * same output, so the twin stays replayable.
 */
export function coarsen(place, minPrecisionM = 250) {
  if (!place || typeof place.lat !== 'number' || typeof place.lon !== 'number') return null;
  const precision = Math.max(minPrecisionM, Number(place.precision_m) || 0);
  // One degree of latitude is about 111,320 m here; longitude shrinks by the cosine of the latitude.
  const latStep = precision / 111320;
  const lonStep = precision / (111320 * Math.cos(place.lat * Math.PI / 180));
  return {
    lat: Math.round(place.lat / latStep) * latStep,
    lon: Math.round(place.lon / lonStep) * lonStep,
    precision_m: precision,
    coarsened: true,
    note: 'Rounded before commit, not filtered at display time.'
  };
}

/** Validate and normalise one batch. Returns { records, problems }; problems are fatal, all of them. */
export function normalise(batch) {
  const problems = [];
  const records = [];
  const fail = (where, message) => problems.push({ where, message });

  if (batch.kind !== 'ingest-contributions') fail('kind', 'The batch does not declare kind "ingest-contributions".');
  if (!batch.collected_by) fail('collected_by', 'No one is named as having collected this batch. Provenance travels with the file and is filled at collection time, never reconstructed.');
  if (!METHODS.includes(batch.method)) fail('method', `method must be one of ${METHODS.join(', ')}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(batch.collected_on || ''))) fail('collected_on', 'collected_on must be an ISO date.');

  for (const [i, c] of (batch.contributions || []).entries()) {
    const at = `contributions[${i}]`;
    if (!c.id) fail(at, 'no id');
    if (!c.claim || String(c.claim).trim().length < 4) fail(at, 'no claim: there is nothing here to record');
    if (!c.about) fail(at, 'no `about`: a contribution has to be about something the packs already name');
    if (!ROLES.includes(c.role)) fail(at, `role must be one of ${ROLES.join(', ')}`);
    if (!['high', 'medium', 'low'].includes(c.confidence)) fail(at, 'confidence must be high, medium or low, on the scale the packs already use');
    if (!VISIBILITY.includes(c.visibility)) fail(at, `visibility must be one of ${VISIBILITY.join(', ')}`);
    if (!c.consent || c.consent.given !== true) fail(at, 'consent is explicit, purpose-bound and per record. Without it the record is held, and held is a normal state.');
    if (c.consent && c.consent.minor === true && !c.consent.guardian) fail(at, 'a contribution from a minor needs a guardian named in the consent block');
    for (const f of FORBIDDEN_FIELDS) {
      if (c[f] !== undefined) fail(at, `field "${f}" is not accepted. Nothing in any contribution lane may become an hour-verification protocol; read the header of src/systems/economy/chour.js.`);
    }
    if (c.kind === 'memory_anchor' || c.memory !== undefined) {
      fail(at, 'memory anchors are not accepted by this tool. Whether that lane proceeds at all, and '
        + 'under what governance, is the owner\'s and the Traditional Owners\' call before the first anchor ships.');
    }
    if (problems.length) continue;

    const credit = c.contributed_by === 'withheld' || (c.consent && c.consent.minor === true && !c.consent.credit_named)
      ? 'withheld'
      : c.contributed_by;

    records.push({
      id: c.id,
      about: c.about,
      claim: String(c.claim).trim(),
      quote: String(c.claim).trim(),
      source: `contribution:${batch.batch}`,
      locator: `${batch.method}, ${batch.collected_on}`,
      confidence: c.confidence,
      status: 'contributed',
      asserts: 'real_world',
      extracted_at: today(),
      extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
      contributed_by: credit,
      transcribed_by: batch.collected_by,
      role: c.role,
      method: batch.method,
      visibility: c.visibility,
      consent: { given: true, wording: (c.consent && c.consent.wording) || '', recorded_by: (c.consent && c.consent.recorded_by) || batch.collected_by },
      place: coarsen(c.place),
      verified_by: c.verified_by || null,
      note: 'Contributed and not yet verified by a second source. It carries the Contributed marker '
        + 'wherever it is rendered, and src/world/data.js decides whether it may be shown at all.'
    });
  }
  return { records, problems };
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-contribution.mjs');
if (RAN_DIRECTLY) {
  const file = process.argv[2];
  if (!file) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 50).join('\n'));
    process.exit(0);
  }
  const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { records, problems } = normalise(batch);
  if (problems.length) {
    console.error(`REFUSED: ${problems.length} problem(s) in ${file}. Nothing was written.\n`);
    for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
    process.exit(1);
  }
  const dir = path.join(ROOT, 'tools/ingest/candidates');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `contribution-${batch.batch}.json`);
  fs.writeFileSync(out, JSON.stringify({
    kind: 'ingest-candidates',
    lane: 'contribution',
    schema: 'minjerribah-candidates/1',
    batch: batch.batch,
    collected_by: batch.collected_by,
    extractor: EXTRACTOR,
    note: 'Normalised, not promoted. A person reviews these, and tools/ingest/promote.mjs runs the '
      + 'gate before anything reaches data/.',
    candidates: records
  }, null, 2) + '\n', 'utf8');
  console.log(`${records.length} contribution(s) normalised to ${path.relative(ROOT, out).split(path.sep).join('/')}.`);
  console.log('Nothing has been added to data/.');
}
