// Emission: a wildlife rescue report draft, in the format the island's own app already reads.
//
//   node tools/connectors/emit-rescue-draft.mjs --observation <file.json>
//   node tools/connectors/emit-rescue-draft.mjs --observation tools/connectors/examples/observation-fixture.json
//   node tools/connectors/emit-rescue-draft.mjs --check <file.json>      screen it and write nothing
//
// The wildlife connector reads the rescue app. This writes back to it, and it writes in the app's
// own wire format rather than a format of ours: a readable message a volunteer can paste into the
// group chat, with a compact sync code on the end that any phone running the app can read back
// into a pin on the map. The encoding is copied field for field from that app's assets/sync.js.
//
// A person sends it. The twin does not, and cannot: it writes a .txt file into out/emit/wildlife/
// and stops. There is no send button because there is nothing behind one.
//
// THE GUARD, and it is the reason this file is worth more than the encoder inside it.
//
// This twin simulates koalas being hit by cars. Over a sim-year its ecology systems produce dozens
// of modelled deaths, each with a place, a time and a cause, in exactly the shape a rescue report
// takes. Feeding one of those into a real rescue group's chat would be a false report of an injured
// animal, and volunteers would drive to it. So:
//
//   origin: simulation   REFUSED. Always. There is no flag that turns this on, and adding one would
//                        be the single worst change anybody could make to this repository.
//   origin: fixture      Written, with DO NOT SEND stamped through the message and the filename, so
//                        the pipe can be tested end to end without anything sendable coming out.
//   origin: observation  Written, once it names a real person who saw it and carries their consent
//                        to pass it on.
//
// The refusal is a runnable check rather than a paragraph, because this project has already learnt
// once, in docs/CULTURAL-REVIEW.md D1, that a rule which is only written down gets broken.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, outFile, relative, nowIso, encodeMwr, decodeMwr, readFeed, argOf, houseStyle
} from './lib.mjs';

/** Read the app's own labels out of the feed, so the two never drift into different words. */
function vocabulary() {
  const feed = readFeed('wildlife-rescue');
  const out = { groups: new Map(), conditions: new Map(), causes: new Map(), contacts: [] };
  if (!feed) return out;
  for (const r of feed.records || []) {
    if (r.kind === 'rescue-vocabulary-animal-group') out.groups.set(r.key, r.label);
    if (r.kind === 'rescue-vocabulary-condition') out.conditions.set(r.key, r.label);
    if (r.kind === 'rescue-vocabulary-cause') out.causes.set(r.key, r.label);
    if (r.kind === 'rescue-contact') out.contacts.push(r);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The separator the app puts in its own message header. Copied so the two look identical in a chat. */
const DOT = String.fromCharCode(0x00b7);

/** The app's own date wording, character for character, from its assets/db.js fmtWhen. */
function fmtWhen(v) {
  const d = new Date(v);
  if (isNaN(d)) return String(v || 'time unknown');
  const h = d.getHours();
  const h12 = h % 12 || 12;
  const ap = h >= 12 ? 'pm' : 'am';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h12}:${String(d.getMinutes()).padStart(2, '0')}${ap}`;
}

/**
 * Decode a draft with the wildlife app's own sync.js, unmodified, out of its checkout.
 *
 * This is the interop test worth having, and it is the only one that proves anything: the encoder
 * in lib.mjs was written from that file, so a round trip through our own decoder proves only that
 * we are consistent with ourselves. Running the app's code over our output proves the volunteer's
 * phone can read it. It needs the checkout, so it is optional and says so when it cannot run.
 */
export async function decodeWithTheApp(text) {
  const { readCheckout } = await import('./lib.mjs');
  const checkout = readCheckout('minjerribah-wildlife-rescue');
  if (!checkout.present) return { ran: false, why: 'no checkout of the wildlife app on this machine' };
  const vm = await import('node:vm');
  const dir = checkout.path + '/assets/';
  const src = ['db.js', 'contacts.js', 'sync.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
  const sandbox = {
    window: {}, navigator: { userAgent: 'node' }, console: { log() {}, warn() {}, error() {} },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Response, Blob, DecompressionStream, CompressionStream, TextDecoder, TextEncoder
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;globalThis.__S = MWRS;', sandbox, { timeout: 5000 });
  const res = await sandbox.__S.decodeText(text);
  return { ran: true, commit: checkout.commit, ...res };
}

function caseRef(id) {
  return String(id || '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'NEW';
}

/**
 * Screen an observation before anything is built from it. Returns the reasons it cannot be sent,
 * which is a list a person can act on rather than one error at a time.
 */
export function screenObservation(obs) {
  const stop = [];
  const warn = [];
  if (!obs || typeof obs !== 'object') return { stop: ['that file is not an observation record'], warn };

  const origin = String(obs.origin || '').toLowerCase();
  if (!origin) stop.push('no origin. An observation has to say where it came from: observation, fixture or simulation.');
  if (origin === 'simulation') {
    stop.push('origin is "simulation". This twin models animals being hit by cars, and a modelled '
      + 'animal is not an animal. Sending one to a rescue group would put volunteers in a car looking '
      + 'for something that does not exist. There is no flag that turns this on.');
  }
  if (!['observation', 'fixture', 'simulation'].includes(origin) && origin) {
    stop.push(`origin "${obs.origin}" is not one of observation, fixture or simulation.`);
  }
  if (origin === 'observation') {
    if (!obs.observed_by) stop.push('no observed_by. A report a rescue group can act on names the person who saw it.');
    if (!obs.consent || obs.consent.given !== true) {
      stop.push('no consent. The person who saw it has to have said this may be passed on, and the '
        + 'record has to carry that. Consent is per record and it is not assumed.');
    }
    if (obs.consent && obs.consent.given === true && !obs.consent.share_with) {
      stop.push('consent is recorded with nobody to share with. Consent is purpose-bound: it says who.');
    }
  }
  if (!obs.group) stop.push('no animal group. The app needs one to route the call.');
  if (!obs.observed_at) stop.push('no observed_at. When matters more than almost anything else on a rescue report.');
  if (typeof obs.lat !== 'number' || typeof obs.lng !== 'number') {
    warn.push('no coordinates, so the message will carry a place name only and the app will not drop a pin.');
  }
  if (obs.notes) {
    warn.push('free-text notes are carried into the outgoing message because a rescuer needs them, '
      + 'and they are never written into any feed in this repository. Read them before you send.');
  }
  return { stop, warn };
}

/**
 * Build the app's own record shape, then the readable message, then the code.
 *
 * The outgoing message is the one thing in this layer that carries more detail than the feed does,
 * and that asymmetry is deliberate: a rescuer driving to an animal needs the exact spot and a phone
 * number, and the repository needs neither. What goes out to a person is not what goes into a file.
 */
export function buildDraft(obs, vocab) {
  const isFixture = String(obs.origin).toLowerCase() === 'fixture';
  const id = obs.id || `r_twin_${String(obs.observed_at).replace(/[^0-9]/g, '').slice(0, 12)}`;
  const record = {
    id,
    when: String(obs.observed_at).slice(0, 16),
    lat: typeof obs.lat === 'number' ? obs.lat : null,
    lng: typeof obs.lng === 'number' ? obs.lng : null,
    place: obs.place || '',
    group: obs.group,
    species: obs.species || '',
    count: Number(obs.count) || 1,
    status: obs.status || 'help',
    cause: obs.cause || 'unknown',
    notes: obs.notes || '',
    reporter: obs.observed_by || '',
    phone: obs.contact_phone || '',
    source: isFixture ? 'twin-fixture' : 'twin-draft',
    caseId: obs.case_id || id,
    kind: 'report',
    mobility: obs.mobility || 'unknown',
    danger: obs.danger || '',
    urgency: obs.urgency || '',
    created: nowIso(),
    updated: nowIso()
  };

  const primary = vocab.contacts.find((c) => c.is_primary) || vocab.contacts[0] || null;
  const groupLabel = vocab.groups.get(record.group) || record.group;
  const conditionLabel = (vocab.conditions.get(record.status) || record.status || '').toLowerCase();
  const causeLabel = record.cause && record.cause !== 'unknown' && record.cause !== 'healthy'
    ? (vocab.causes.get(record.cause) || record.cause).toLowerCase()
    : null;

  const lines = [];
  if (isFixture) {
    lines.push('DO NOT SEND. This is a test fixture written by the Minjerribah Living Twin to check that');
    lines.push('the connector produces a message the wildlife app can read. No animal, no person, no place.');
    lines.push('');
  }
  lines.push(`WILDLIFE REPORT ${DOT} Minjerribah ${DOT} Case ${caseRef(record.caseId)}`);
  lines.push([groupLabel + (record.species ? ` (${record.species})` : ''), conditionLabel, causeLabel]
    .filter(Boolean).join(', ') + '.');
  if (record.place) lines.push(record.place + '.');
  lines.push('Seen ' + fmtWhen(record.when) + '.');
  if (typeof record.lat === 'number') lines.push(`Map: ${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}`);
  if (record.mobility === 'mobile') lines.push('Still on the move: keep an eye out.');
  if (record.notes) lines.push(record.notes);
  if (primary) lines.push(`Call ${primary.name} ${primary.phone}.`);
  lines.push('');
  lines.push('Copy this whole message, open the Wildlife Map app, tap Paste report.');
  lines.push(encodeMwr(record));
  lines.push('');
  lines.push('--');
  lines.push(isFixture
    ? 'Drafted as a test fixture by the Minjerribah Living Twin. Nothing above describes anything real.'
    : `Drafted by the Minjerribah Living Twin from an observation ${record.reporter} recorded. `
      + 'It has not been verified by anybody. A person read it and chose to send it, or did not: '
      + 'the twin sends nothing.');
  return { record, text: houseStyle(lines.join('\n')).text, isFixture };
}

export async function emit({ file, check = false }) {
  const obs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { stop, warn } = screenObservation(obs);
  if (stop.length) {
    const err = new Error('this observation was refused and nothing was written:\n  '
      + stop.map((s) => '- ' + s).join('\n  '));
    err.stop = stop;
    throw err;
  }
  const vocab = vocabulary();
  if (!vocab.contacts.length) {
    throw new Error('no wildlife feed on disk, so this draft would carry no number to ring. '
      + 'Run node tools/connectors/sync.mjs --id wildlife-rescue first.');
  }
  const draft = buildDraft(obs, vocab);

  // Read our own message back through the decoder before writing it, because a code the app cannot
  // read is worse than no code: it looks like a report and lands as nothing.
  const back = decodeMwr(draft.text.split('\n').find((l) => /^MWR[01]\./.test(l)) || '');
  if (!back.record || back.record.id !== draft.record.id) {
    throw new Error('the sync code this produced does not decode back to the same record, so it was '
      + 'not written. That is a bug in the encoder, not in the observation.');
  }

  // And then read it with the app's own code, which is the only check that proves a volunteer's
  // phone can read what came out of here.
  const app = await decodeWithTheApp(draft.text);
  if (app.ran && (!app.records || app.records.length !== 1 || app.records[0].id !== draft.record.id)) {
    throw new Error('the wildlife app\'s own decoder could not read this draft, so it was not written. '
      + `It reported ${app.records ? app.records.length : 0} record(s), ${app.cut || 0} cut, ${app.bad || 0} unreadable. `
      + 'The app\'s sync format has probably moved. Read its assets/sync.js against tools/connectors/lib.mjs.');
  }

  if (check) return { draft, warn, wrote: null, roundTrip: back.record, app };

  const name = `${draft.isFixture ? 'DO-NOT-SEND-fixture-' : ''}case-${caseRef(draft.record.caseId)}.txt`;
  const out = outFile('wildlife', name);
  fs.writeFileSync(out, draft.text + '\n', 'utf8');
  return { draft, warn, wrote: out, roundTrip: back.record, app };
}

async function main() {
  const args = process.argv.slice(2);
  const file = argOf(args, 'observation') || argOf(args, 'check');
  const check = !!argOf(args, 'check');
  if (!file || typeof file !== 'string') {
    console.log('usage: node tools/connectors/emit-rescue-draft.mjs --observation <file.json>');
    console.log('       node tools/connectors/emit-rescue-draft.mjs --check <file.json>');
    console.log('\nThe observation shape is in tools/connectors/examples/. origin must be one of');
    console.log('observation, fixture or simulation, and simulation is always refused.');
    process.exitCode = 1;
    return;
  }
  try {
    const res = await emit({ file: path.resolve(ROOT, file), check });
    console.log(`\nCase ${caseRef(res.draft.record.caseId)}: ${res.draft.record.group}, ${res.draft.record.status}.`);
    console.log(res.app.ran
      ? `  read back with the wildlife app's own sync.js at commit ${String(res.app.commit).slice(0, 9)}: `
        + `${res.app.records.length} record, ${res.app.cut} cut, ${res.app.bad} unreadable.`
      : `  our own decoder round trips, but the app's could not be run: ${res.app.why}.`);
    for (const w of res.warn) console.log(`  note: ${w}`);
    if (res.wrote) {
      console.log(`  wrote ${relative(res.wrote)}`);
      console.log(res.draft.isFixture
        ? '\nThis is a fixture and it says DO NOT SEND on the first line. Nothing about it is real.'
        : '\nThis is a draft. Read it, check it is still true, and send it yourself. The twin has not '
          + 'sent it and cannot.');
    } else {
      console.log('  checked only, nothing written.');
    }
  } catch (e) {
    console.error('\nREFUSED: ' + e.message);
    process.exitCode = 1;
  }
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/connectors/emit-rescue-draft.mjs');
if (RAN_DIRECTLY) main().catch((e) => { console.error("[emit-rescue-draft] " + e.message); process.exit(1); });
