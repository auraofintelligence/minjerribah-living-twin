// The feed gate.
//
//   node tools/connectors/verify.mjs            check every feed on disk
//   node tools/connectors/verify.mjs --strict   also fail on advisories
//
// tools/gate-audit.mjs is the gate for data packs and it does not look at feeds, because a feed is
// not a pack: it is staging, and the underscore in its filename is what tells that gate so. This is
// the equivalent check for the staging layer, and it holds feeds to the same envelope so that a
// record promoted out of a feed into a pack passes the real gate unchanged.
//
// It re-uses rather than re-implements. The confidence, status and visibility judgements come from
// src/world/data.js, which is the module the running twin uses, for the same reason
// tools/ingest/checks-records.mjs imports it: a gate that re-implements the runtime's judgement is
// a gate that tests a copy. The cultural prohibitions come out of data/lore.json, so a rule QYAC
// adds is a rule this runs.
//
// What it checks:
//
//   checksums          the feed on disk is the feed the index recorded
//   envelope           every record carries the v1 envelope, so promotion needs no reshaping
//   confidence         three words, no fourth, and nothing above what the source claims for itself
//   citations          a record asserting something about the real world quotes it and locates it
//   contact detail     a phone number carries a published source in the same record
//   privacy            no reporter name, no personal phone, no free-text note, in any feed
//   coarsening         every coordinate in a feed carries the precision it was rounded to
//   cultural           the prohibition token lists, and no view attributed to a Traditional Owner body
//   wanted list        every entry through the same screen as a record, and any naming a Traditional
//                      Owner organisation reduced, flagged and in cultural_flags
//   vocabulary         what the feeds do to no-invented-language, counted and attributed, blocking
//                      on any new word from a feed in a cultural position
//   house style        no em dash, Australian English in the connector's own prose
//   registry           a connector that says it is built has a module, and one that does not has a reason

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, FEED_DIR, readFeedIndex, sha256lf, screenRecord, screenWanted, namesTraditionalOwnerBody,
  freshnessAt, nowIso, argOf, encodeMwr, decodeMwr, coarsen, houseStyle
} from './lib.mjs';
import { CONNECTORS } from './registry.mjs';

const runtime = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')).href);
const { confidenceOf, statusOf, labelFor, ENVELOPE_STATUSES } = runtime;

const EM_DASH = String.fromCharCode(0x2014);

/** Fields that must never appear in any feed, at any confidence, under any name. */
const FORBIDDEN_FIELDS = ['reporter', 'reporter_name', 'contact_name', 'notes', 'note_text', 'reporter_phone', 'email'];

class Report {
  constructor() { this.items = []; }
  add(severity, check, where, message, hint) {
    this.items.push({ severity, check, where, message, hint: hint || '' });
  }
  get blocking() { return this.items.filter((i) => i.severity === 'blocking'); }
  get advisory() { return this.items.filter((i) => i.severity === 'advisory'); }
  get review() { return this.items.filter((i) => i.severity === 'review'); }
}

function everyString(node, out = []) {
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const v of node) everyString(v, out); return out; }
  if (node && typeof node === 'object') { for (const v of Object.values(node)) everyString(v, out); return out; }
  return out;
}

function checkRecord(report, feedId, rec, i) {
  const where = `data/feeds/_${feedId}.json records[${i}] ${rec.id || 'no id'}`;

  for (const field of ['id', 'source', 'locator', 'confidence', 'extracted_at', 'extractor', 'status']) {
    if (rec[field] === undefined || rec[field] === null || rec[field] === '') {
      report.add('blocking', 'record-envelope', where,
        `Envelope field "${field}" is missing. A record that cannot cite is not a record.`,
        'See the record envelope in docs/INGEST.md. Feeds hold to it so promotion needs no reshaping.');
    }
  }
  if (rec.confidence && !confidenceOf(rec)) {
    report.add('blocking', 'confidence-scale', where,
      `confidence "${rec.confidence}" is not one of high, medium, low.`);
  }
  if (rec.status && !ENVELOPE_STATUSES.includes(String(rec.status).trim().toLowerCase())) {
    report.add('blocking', 'record-envelope', where,
      `status "${rec.status}" is not one of ${ENVELOPE_STATUSES.join(', ')}.`);
  }
  if (rec.status && statusOf(rec) === 'proposed' && !labelFor(rec)) {
    report.add('blocking', 'proposed-stays-proposed', where,
      'This record is proposed and the runtime classifier gives it no marker, so the interface would '
      + 'draw it as a fact.');
  }
  if (rec.asserts === 'real_world') {
    if (!rec.quote || String(rec.quote).trim().length < 8) {
      report.add('blocking', 'record-envelope', where,
        'Asserts something about the real world and carries no verbatim quote.');
    }
    if (!rec.locator) {
      report.add('blocking', 'record-envelope', where, 'Asserts something about the real world and names no locator.');
    }
  }

  for (const field of FORBIDDEN_FIELDS) {
    if (rec[field] !== undefined && rec[field] !== null && rec[field] !== '') {
      report.add('blocking', 'privacy-floor', where,
        `Carries a "${field}" field. Reporter names, personal phone numbers, email addresses and `
        + 'free-text notes are dropped at intake and never enter this repository.',
        'docs/PARTICIPATION.md: coarsening and stripping happen before commit, never at display time.');
    }
  }
  if (typeof rec.lat === 'number' && rec.location_precision_m === undefined) {
    report.add('blocking', 'coarsening', where,
      'Carries a coordinate and does not say what precision it was rounded to.',
      'A coordinate with no declared precision reads as exact.');
  }
  if (typeof rec.lat === 'number' && rec.location_precision_m !== null && rec.location_precision_m < 100) {
    report.add('blocking', 'coarsening', where,
      `Coordinate precision is ${rec.location_precision_m} m, finer than the 110 m floor this layer holds.`);
  }
  if (!rec.freshness || !rec.freshness.synced_at) {
    report.add('blocking', 'freshness', where,
      'Carries no sync stamp, so nothing can say how old it is when a player reads it.');
  }

  const screen = screenRecord(rec);
  if (!screen.ok) {
    for (const reason of screen.reasons) {
      report.add('blocking', 'screen', where, `This record should have been held, and was written instead: ${reason}`);
    }
  }
  for (const s of everyString(rec)) {
    if (s.includes(EM_DASH)) {
      report.add('blocking', 'no-em-dash', where, 'Carried text still contains an em dash.');
      break;
    }
  }
}

function checkFeed(report, feedId, indexEntry) {
  const file = path.join(FEED_DIR, `_${feedId}.json`);
  const where = `data/feeds/_${feedId}.json`;
  if (!fs.existsSync(file)) {
    report.add('blocking', 'feed-index', where, `The feed index lists "${feedId}" and there is no such file.`);
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  let feed;
  try { feed = JSON.parse(text); } catch (e) {
    report.add('blocking', 'feed-parses', where, `Not valid JSON: ${e.message}`);
    return;
  }
  if (indexEntry) {
    const actual = sha256lf(text);
    if (indexEntry.checksum && indexEntry.checksum.value !== actual) {
      report.add('blocking', 'feed-checksum', where,
        `Changed since it was synced. Recorded ${indexEntry.checksum.value.slice(0, 12)}, on disk ${actual.slice(0, 12)}.`,
        'This is the check doing its job. Re-run the connector rather than editing a feed by hand: a feed '
        + 'is what a source said, and a hand edit makes it what somebody wishes it had said.');
    }
  }

  for (const field of ['feed', 'schema', 'version', 'title', 'organisation', 'about', 'sync', 'confidence_scale', 'records', 'held', 'wanted']) {
    if (feed[field] === undefined) {
      report.add('blocking', 'feed-shape', where, `Missing required top-level field "${field}".`);
    }
  }
  if (!feed.sync || !feed.sync.synced_at || !feed.sync.source || !feed.sync.cadence) {
    report.add('blocking', 'feed-shape', where, 'The sync block must carry synced_at, source and cadence.');
    return;
  }
  if (feed.sync.source.kind === 'repository' && !feed.sync.source.commit) {
    report.add('advisory', 'freshness', where,
      'The source checkout had no readable commit, so this feed can name the day it ran but not the '
      + 'state of the source it read.');
  }
  if (feed.sync.source.working_tree === 'modified') {
    report.add('review', 'freshness', where,
      'The source checkout had uncommitted changes when this ran, so the commit recorded here is not '
      + 'exactly what was read. Somebody should say whether that matters for this feed.');
  }

  const fresh = freshnessAt({ freshness: { synced_at: feed.sync.synced_at, stale_after_days: feed.sync.stale_after_days } }, nowIso());
  if (fresh.state === 'stale') {
    report.add('advisory', 'freshness', where,
      `This feed is ${fresh.ageDays} day(s) old against a ${feed.sync.stale_after_days} day limit. `
      + 'Anything drawn from it has to say so on screen.');
  }

  for (let i = 0; i < (feed.records || []).length; i++) checkRecord(report, feedId, feed.records[i], i);

  for (const h of feed.held || []) {
    if (!h.reasons || !h.reasons.length) {
      report.add('blocking', 'held-records', where, `Held record ${h.id} carries no reason.`);
    }
  }
  // The wanted list goes through the same screen as a record, and the reason is a hole this gate
  // used to have. A wanted entry is not a record and it is written into the same committed file, so
  // for a while `data/feeds/_noticeboard.json` carried a QYAC entry and an MMEIC entry that nothing
  // had screened and no flag had been raised on. Checking only `who_would_have_to_agree` was
  // checking that a gap had an owner, not that it was safe to publish.
  const flaggedIds = new Set((feed.cultural_flags || []).map((f) => f.id));
  for (const w of feed.wanted || []) {
    const wWhere = `${where} wanted ${w.id || 'no id'}`;
    if (!w.id) {
      report.add('blocking', 'wanted-list', wWhere, 'A wanted entry carries no id, so nothing can flag it or answer it.');
    }
    if (!w.who_would_have_to_agree) {
      report.add('advisory', 'wanted-list', where,
        `Wanted entry ${w.id} does not name who would have to agree, which is the field that turns a gap into an ask.`);
    }
    const screen = screenRecord(w);
    if (!screen.ok) {
      for (const reason of screen.reasons) {
        report.add('blocking', 'screen', wWhere,
          `This wanted entry should have been held, and was written instead: ${reason}`);
      }
    }
    if (namesTraditionalOwnerBody(w)) {
      if (!flaggedIds.has(w.id)) {
        report.add('blocking', 'cultural', wWhere,
          'Names a Traditional Owner organisation and is in no cultural_flags entry, so it would reach a '
          + 'promotion queue with nothing telling a person to read it first.',
          'tools/connectors/lib.mjs screenWanted() does this. Run the wanted list through it rather than '
          + 'pushing straight onto the array.');
      }
      // The reduction screenWanted() performs, checked on the file rather than trusted in the code.
      const reduced = screenWanted(w).entry;
      if (w.what_the_source_thinks_it_might_share) {
        report.add('blocking', 'cultural', wWhere,
          'Names a Traditional Owner organisation and still carries the source repository\'s guess about '
          + 'what that organisation might share. A guess about what a body would supply reads as that '
          + 'body\'s intention, and this project does not write one.');
      }
      if (!w.cultural_handling && reduced.cultural_handling) {
        report.add('blocking', 'cultural', wWhere,
          'Names a Traditional Owner organisation and carries no cultural handling note saying what may '
          + 'and may not be added to it.');
      }
    }
  }
  if (feed.cultural_flags === undefined) {
    report.add('blocking', 'feed-shape', where,
      'Carries no cultural_flags block. Every feed declares one, empty when nothing was flagged, because '
      + 'an absent block and an empty one read the same on a screen and mean opposite things.');
  }
  if (feed.cultural_flags && feed.cultural_flags.length) {
    const asks = feed.cultural_flags.filter((f) => f.kind === 'wanted-list-entry').length;
    const recs = feed.cultural_flags.length - asks;
    const parts = [];
    if (recs) parts.push(`${recs} record(s), carried as date, place and listing source only`);
    if (asks) parts.push(`${asks} wanted-list entry or entries, carried as a name and an unanswered ask only`);
    report.add('review', 'cultural', where,
      `${parts.join(' and ')}, name a cultural event, a Traditional Owner organisation or Country. A human `
      + 'reads them before anything is promoted or sent. The queue is docs/CULTURAL-REVIEW.md.');
  }
}

/**
 * What the feeds do to the gate's own language check, counted and owned rather than left lying.
 *
 * `no-invented-language` in tools/ingest/checks-lore.mjs watches for a name-shaped word this
 * repository has not carried before, anywhere under `data/`. It is the check that guards against a
 * fabricated Aboriginal language word, and it is the most valuable check in the repository. Feeds
 * live under `data/` and are full of new words, so they raise advisories on it: some are the
 * connector layer's own field names, which are English structure and not vocabulary at all, and
 * some are real content, an event title or an organisation's trading name, which is the check doing
 * exactly what it exists to do.
 *
 * Two things follow, and this function is both of them.
 *
 * The dangerous case is blocked here, at sync time, rather than waited for at gate time: a new word
 * from a feed in a cultural position fails this gate outright. Nothing has ever reached that state
 * and this is what keeps it that way.
 *
 * The rest is counted, attributed and handed to a person with the command that clears it. This
 * layer does not write `tools/ingest/vocabulary.json` itself: it is another wave's floor, and its
 * own tool exists so a human reads every word before any of them is accepted. An advisory that
 * names its own number and its own remedy is a debt with a receipt; the same advisory scattered
 * over 166 lines with nothing owning it is noise, and noise is how a real finding gets missed.
 */
async function checkFeedVocabulary(report) {
  const where = 'data/feeds';
  let nameShapedTokens, allowlistWords, Ledger;
  try {
    ({ nameShapedTokens, allowlistWords } = await import(pathToFileURL(path.join(ROOT, 'tools/ingest/checks-lore.mjs')).href));
    ({ Ledger } = await import(pathToFileURL(path.join(ROOT, 'tools/ingest/gate.mjs')).href));
  } catch (e) {
    report.add('advisory', 'feed-vocabulary', where,
      `Could not read the gate's language check to reconcile against it: ${e.message}. Run `
      + 'node tools/gate-audit.mjs and read the no-invented-language findings by hand.');
    return;
  }

  let lore, allow, known, tokens;
  try {
    lore = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lore.json'), 'utf8'));
    allow = allowlistWords(lore);
    known = new Set(Ledger.load().vocabulary());
    tokens = nameShapedTokens();
  } catch (e) {
    report.add('advisory', 'feed-vocabulary', where, `The language reconciliation did not run: ${e.message}`);
    return;
  }

  const fromFeeds = [];
  const cultural = [];
  let sharedWithPacks = 0;
  for (const [token, sites] of tokens) {
    if (allow.has(token) || known.has(token)) continue;
    const inFeeds = sites.filter((s) => s.file.startsWith('data/feeds'));
    if (!inFeeds.length) continue;
    if (inFeeds.length < sites.length) { sharedWithPacks++; continue; }
    fromFeeds.push(token);
    if (inFeeds.some((s) => s.cultural)) cultural.push({ token, site: inFeeds.find((s) => s.cultural) });
  }

  for (const { token, site } of cultural) {
    report.add('blocking', 'feed-vocabulary', `${site.file} ${site.pointer}`,
      'A word this repository has never carried before has been written into a feed in a cultural '
      + 'position. The word is not quoted here, for the same reason a held record does not quote what '
      + 'held it.',
      'This is the fault wave 7 had, arriving through object keys. A connector must never put a '
      + 'source\'s wording into a field the gate reads as a seasonal calendar, a language block or a '
      + 'gloss. The events connector renames the atlas field `season` to `listing_period` for exactly '
      + 'this reason.');
  }

  if (fromFeeds.length) {
    report.add('advisory', 'feed-vocabulary', where,
      `${fromFeeds.length} name-shaped word(s) appear only in feeds and are new to this repository, `
      + `${cultural.length} of them in a cultural position. They are the same words `
      + 'tools/gate-audit.mjs reports as no-invented-language advisories, counted here so the number '
      + 'has an owner. Two kinds are mixed together: this layer\'s own envelope field names, which are '
      + 'English structure, and real content from a source, an event title or a trading name.',
      'Nothing here writes tools/ingest/vocabulary.json. Run node tools/ingest/vocabulary-accept.mjs, '
      + 'which prints every new word for a person to read before it writes any of them.');
  }
  if (sharedWithPacks) {
    report.add('advisory', 'feed-vocabulary', where,
      `${sharedWithPacks} further new word(s) appear in a feed and in a data pack. Those belong to `
      + 'whoever wrote the pack, not to this layer.');
  }
}

function checkRegistry(report) {
  for (const c of CONNECTORS) {
    const where = `tools/connectors/registry.mjs ${c.id}`;
    if (c.built === true && (!c.module || !fs.existsSync(path.join(ROOT, c.module)))) {
      report.add('blocking', 'connector-registry', where,
        `Declares itself built and ${c.module || 'no module'} does not exist.`);
    }
    if (c.built === false && !c.reason) {
      report.add('blocking', 'connector-registry', where,
        'Is not built and gives no reason. An honest gap is a gap with a reason beside it.');
    }
    if (!c.cadence || !c.cadence.every || !c.cadence.run_by) {
      report.add('blocking', 'connector-registry', where, 'Declares no cadence and no person to run it.');
    }
    if (!(c.promises || []).length) {
      report.add('blocking', 'connector-registry', where,
        'Promises nothing. Every connector states what the source organisation is being promised, because '
        + 'one of them will eventually read it.');
    }
    if (c.built === false && !(c.asks || []).length) {
      report.add('advisory', 'connector-registry', where, 'Not built and asks nobody for anything.');
    }
  }
}

/**
 * The layer's own guarantees, run rather than asserted in a document.
 *
 * Four of them, and each one is a promise made in docs/CONNECTORS.md to a real organisation:
 * that a draft is readable by the app it is aimed at, that coordinates are coarsened before they
 * are written, that the coarsening is deterministic so the twin still replays, and that the screen
 * actually holds what it says it holds. This project has already learnt once, in
 * docs/CULTURAL-REVIEW.md D1, that a rule which is only written down gets broken.
 */
function selfTest(report) {
  const where = 'tools/connectors/lib.mjs';

  const sample = {
    id: 'r_selftest', when: '2026-08-10T07:20', lat: -27.427, lng: 153.53, place: 'Main Beach',
    group: 'koala', species: '', count: 1, status: 'help', cause: 'vehicle', notes: '',
    reporter: '', phone: '', source: 'selftest', caseId: 'r_selftest', kind: 'report',
    mobility: 'stationary', danger: '', urgency: 'now', created: '2026-08-10T07:21', updated: '2026-08-10T07:21'
  };
  for (const compress of [true, false]) {
    const back = decodeMwr(encodeMwr(sample, { compress }));
    if (!back.record || back.record.id !== sample.id || back.record.group !== sample.group) {
      report.add('blocking', 'self-test', where,
        `The wildlife sync codec does not round trip with compress=${compress}, so any draft this layer `
        + 'writes would land in a volunteer\'s app as nothing.');
    }
  }
  if (decodeMwr('MWR1.notarealcode.zzzz').error !== 'cut') {
    report.add('blocking', 'self-test', where,
      'A corrupt sync code was not rejected. A truncated code has to fail loudly, not silently decode wrong.');
  }

  const a = coarsen(-27.4271234, 153.5296789);
  const b = coarsen(-27.4271234, 153.5296789);
  if (a.lat !== b.lat || a.lng !== b.lng) {
    report.add('blocking', 'self-test', where, 'Coarsening is not deterministic, so the twin would not replay.');
  }
  if (a.lat === -27.4271234 || a.precision_m < 100) {
    report.add('blocking', 'self-test', where,
      'Coarsening did not coarsen. Precise locations must never reach a file in this repository.');
  }

  const forbidden = { id: 'x', kind: 'test', confidence: 'high', title: 'a corroboree at the hall' };
  if (screenRecord(forbidden).ok) {
    report.add('blocking', 'self-test', where,
      'The screen passed a record carrying a word the cultural prohibitions forbid. It is not screening.');
  }
  const positioned = { id: 'y', kind: 'test', confidence: 'high', title: 'QYAC supports the new terminal' };
  if (screenRecord(positioned).ok) {
    report.add('blocking', 'self-test', where,
      'The screen passed a record attributing a position to a Traditional Owner organisation.');
  }
  const clean = {
    id: 'z', kind: 'test', confidence: 'high',
    title: 'QYAC manages the national park under joint management',
    handling: 'The source itself says to confirm this before use.'
  };
  if (!screenRecord(clean).ok) {
    report.add('blocking', 'self-test', where,
      'The screen held a record that names a body as a civic actor and carries only this repository\'s '
      + `own handling prose: ${screenRecord(clean).reasons.join('; ')}`);
  }

  // The wanted-list screen, which is the one that was missing. A wanted entry naming a Traditional
  // Owner organisation must come back flagged, reduced and still on the list: dropping it would hide
  // a real gap, and carrying it whole would publish a guess about what that organisation would give.
  const wantedAsk = {
    id: 'nb-want-selftest',
    organisation: 'Quandamooka Yoolooburrabee Aboriginal Corporation',
    what: 'This organisation is named in the source and nobody has asked it anything.',
    what_the_source_thinks_it_might_share: 'public cultural notices and approved event pathways',
    who_would_have_to_agree: 'Quandamooka Yoolooburrabee Aboriginal Corporation'
  };
  const screened = screenWanted(wantedAsk);
  if (!screened.ok) {
    report.add('blocking', 'self-test', where,
      'The wanted-list screen dropped an entry that names a Traditional Owner organisation. It is meant to '
      + 'reduce it and keep it: an organisation nobody has asked is a real gap and hiding the gap is worse '
      + `than naming it. Reasons given: ${screened.reasons.join('; ')}`);
  }
  if (screened.entry.what_the_source_thinks_it_might_share || !screened.entry.cultural_handling) {
    report.add('blocking', 'self-test', where,
      'The wanted-list screen did not reduce an entry naming a Traditional Owner organisation. The source '
      + 'repository\'s guess about what that organisation might share has to come off, and a handling note '
      + 'has to go on.');
  }
  if (!screened.culturalFlag || screened.culturalFlag.id !== wantedAsk.id) {
    report.add('blocking', 'self-test', where,
      'The wanted-list screen raised no cultural flag for an entry naming a Traditional Owner organisation, '
      + 'so it would reach a committed feed with nothing telling a person to read it.');
  }
  const ordinaryAsk = { id: 'nb-want-plain', organisation: 'Point Lookout Bowls Club', who_would_have_to_agree: 'the club' };
  if (screenWanted(ordinaryAsk).culturalFlag) {
    report.add('blocking', 'self-test', where,
      'The wanted-list screen flagged an ordinary island club as cultural. A flag that fires on everything '
      + 'is a flag nobody reads.');
  }
  // The narrowing that let the entry above through must not have widened the rule it narrowed.
  // A position stated in a sentence is still held, and a position hidden in an id still is too.
  const positionInProse = { id: 'nb-want-x', organisation: 'QYAC', summary: 'QYAC has approved the ferry proposal.' };
  if (screenRecord(positionInProse).ok) {
    report.add('blocking', 'self-test', where,
      'Skipping identifier fields in the position-verb scan has widened the rule: a position stated in a '
      + 'record\'s own prose is no longer held.');
  }
  const bannedInId = { id: 'a-corroboree-at-the-hall', kind: 'test', confidence: 'high' };
  if (screenRecord(bannedInId).ok) {
    report.add('blocking', 'self-test', where,
      'A prohibited word in an id was not caught. Only the position-verb scan narrows to sentences; the '
      + 'prohibition token lists read every string, ids included.');
  }

  const dashed = houseStyle('a sentence' + String.fromCharCode(0x2014) + 'with one in it');
  if (!dashed.changed || dashed.text.includes(String.fromCharCode(0x2014))) {
    report.add('blocking', 'self-test', where, 'houseStyle() did not substitute an em dash in carried text.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = !!argOf(args, 'strict');
  const report = new Report();

  selfTest(report);
  checkRegistry(report);
  await checkFeedVocabulary(report);

  const index = readFeedIndex();
  if (!index) {
    report.add('advisory', 'feed-index', 'data/feeds/_feeds.json',
      'No feed index. Nothing has been synced on this machine yet.');
  } else {
    for (const entry of index.feeds || []) checkFeed(report, entry.id, entry);
    const onDisk = fs.existsSync(FEED_DIR)
      ? fs.readdirSync(FEED_DIR).filter((f) => f.endsWith('.json') && f !== '_feeds.json')
      : [];
    for (const file of onDisk) {
      const id = file.replace(/^_/, '').replace(/\.json$/, '');
      if (!(index.feeds || []).some((f) => f.id === id)) {
        report.add('blocking', 'feed-index', `data/feeds/${file}`,
          'Sits in data/feeds and is in no index entry, so nothing records where it came from or when.');
      }
      if (!file.startsWith('_')) {
        report.add('blocking', 'feed-index', `data/feeds/${file}`,
          'A feed filename must start with an underscore. tools/gate-audit.mjs treats every other .json '
          + 'under data/ as a pack the twin loads, and a feed is not a pack.');
      }
    }
  }

  const groups = [['BLOCKING', report.blocking], ['FOR A HUMAN', report.review], ['ADVISORY', report.advisory]];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    console.log(`\n${label} (${items.length})`);
    for (const i of items) {
      console.log(`  [${i.check}] ${i.where}`);
      console.log(`      ${i.message}`);
      if (i.hint) console.log(`      -> ${i.hint}`);
    }
  }

  const fail = report.blocking.length + (strict ? report.advisory.length : 0);
  console.log('');
  if (fail) {
    console.log(`FEED GATE FAILED: ${report.blocking.length} blocking, ${report.advisory.length} advisory.`);
    process.exitCode = 1;
    return;
  }
  console.log(`FEED GATE OK: 0 blocking, ${report.advisory.length} advisory, ${report.review.length} for a human.`);
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/connectors/verify.mjs');
if (RAN_DIRECTLY) await main();
