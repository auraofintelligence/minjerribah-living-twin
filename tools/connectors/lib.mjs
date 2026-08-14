// Shared machinery for the connector layer.
//
// A connector reads a real source that belongs to a real island organisation and writes a
// committed, stamped feed. It runs when a person runs it. It is never part of the running twin.
//
// Three rules hold this whole directory together, and every file here obeys them:
//
//   1. A SYNC IS AN OFFLINE STEP, WHICH IS NOT THE SAME AS NEVER OPENING A SOCKET, AND THIS FILE
//      USED TO SAY IT WAS. The rule that matters is about the running twin: it loads committed
//      files off its own origin at boot and touches nothing else, ever, and any fetch in a render
//      or simulation loop is a fail. A sync is the other side of that line. It happens when a
//      person or a scheduled job runs it, and it ends in a committed, stamped file.
//
//      Three connectors read files on this machine: a checkout of the owner's own repository, or a
//      folder somebody dropped an export into. The one thing there that could look like a network
//      call, reading the git commit of a source checkout, is a local read of .git through git
//      itself. Pulling that checkout is a person's job and the connector says so when it is old.
//
//      ONE CONNECTOR FETCHES, and it is declared here rather than left for somebody to discover.
//      `tools/connectors/weather.mjs` calls two named Open-Meteo hosts, because nobody keeps the
//      weather in a git repository and there is no local checkout of it to read. It is the same
//      shape `tools/ingest/lane-legislation.mjs --fetch` already has for the two legislation
//      registers: a person runs it, it writes a file, and everything downstream works on the file.
//      Give it `--inbox` and it fetches nothing at all. `fetch` appears in exactly one file in this
//      directory, with the reasoning on it, so a grep for it lands somewhere useful.
//
//   2. FRESHNESS IS A FIELD, NOT A FEELING. Every record carries when it was synced, from what, at
//      what commit, and what the source itself said about its own currency. A twin that says the
//      bakery is open is only ever repeating what it was told, and the record has to carry enough
//      for a panel to say so on screen.
//
//   3. THE WALL CLOCK IS READ IN EXACTLY ONE PLACE. `nowIso()` below. Simulation code may never
//      call it. It is the connector layer's equivalent of the clock system's declared exception,
//      and it is declared here so a grep for `new Date` in this directory finds one function.
//
// House rules, same as everywhere: Australian English, no em dash, prices in A$, nothing
// fabricated, low confidence is never shown to a player, proposed stays proposed.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The freshness vocabulary is not defined here. It is defined in src/world/freshness.js, which the
// browser loads out of src/ui/panels/inspector.js and node loads out of this file, so there is one
// implementation of `freshnessAt` and one set of four words. A connector layer that owned a private
// copy would be enforcing a rule the interface had never heard of, which is exactly what the first
// round of this slice did: docs/CONNECTORS.md claimed the twin called this function and nothing
// under src/ had ever imported it.
export { freshnessAt, daysBetween, minutesBetween, observedAt, agoText, FRESHNESS_STATES, STALE_AFTER_DAYS, OBSERVATION_STALE_AFTER_MINUTES } from '../../src/world/freshness.js';

// The source ladder crosses the same line for the same reason. A connector stamps a rung onto every
// record it writes and the twin ranks records by it, so the two have to be reading one table. See
// docs/CONNECTORS.md, "The source ladder, and why weather must not be a two-way switch".
export { SOURCE_RUNGS, rungOf, resolveObservations, SIMULATION_RUNG } from '../../src/world/observations.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FEED_DIR = path.join(ROOT, 'data', 'feeds');
export const OUT_DIR = path.join(ROOT, 'out', 'emit');

/** Where the owner's own repositories sit. One declaration, overridable for another machine. */
export const REPOS_ROOT = process.env.MLT_REPOS_ROOT || path.resolve(ROOT, '..');

// ---------------------------------------------------------------------------------------------
// Time. The one wall-clock read in the whole layer.
// ---------------------------------------------------------------------------------------------

/**
 * The real datetime, in the island's own offset, as an ISO string.
 *
 * `toISOString()` is UTC, which on this island is ten hours behind, so a sync run before
 * mid-morning would be stamped with yesterday. A sync date that is wrong by a day is small until
 * somebody is reconciling a feed against a council consultation window, which is the same
 * reasoning tools/ingest/lib.mjs gives for its own `today()`.
 */
export function nowIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

export function today(d = new Date()) {
  return nowIso(d).slice(0, 10);
}

// `daysBetween` and `freshnessAt` were here. They are re-exported from src/world/freshness.js at
// the top of this file so that every caller, in node and in the browser, gets the same arithmetic.

// ---------------------------------------------------------------------------------------------
// Reading a source checkout
// ---------------------------------------------------------------------------------------------

/**
 * What a connector knows about the checkout it just read.
 *
 * The commit matters more than the run date. The events engine repository is refreshed roughly
 * weekly, so a local checkout lags the remote, and a feed stamped only with the day it was
 * generated would claim a currency it does not have. A feed stamped with the commit it read can be
 * checked by anybody with the same repository.
 */
export function readCheckout(repoId, { root = REPOS_ROOT } = {}) {
  const dir = path.join(root, repoId);
  const out = {
    kind: 'repository',
    id: repoId,
    path: dir.split(path.sep).join('/'),
    present: fs.existsSync(dir),
    commit: null,
    commit_date: null,
    working_tree: 'unknown',
    files: []
  };
  if (!out.present) return out;
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return ''; }
  };
  const log = git(['log', '-1', '--format=%H%n%cI']);
  if (log) {
    const [hash, iso] = log.split('\n');
    out.commit = hash || null;
    out.commit_date = (iso || '').slice(0, 10) || null;
  }
  const porcelain = git(['status', '--porcelain']);
  out.working_tree = porcelain === '' ? 'clean' : 'modified';
  return out;
}

export function sourceFile(checkout, rel) {
  const full = path.join(checkout.path, rel);
  const text = fs.readFileSync(full, 'utf8');
  if (!checkout.files.includes(rel)) checkout.files.push(rel);
  return text;
}

/**
 * Evaluate a plain `window.X = {...}` data file and hand back the object.
 *
 * The owner's static sites carry their data as one assignment onto `window`, with no imports and
 * no side effects, which is exactly why they are readable offline. A sandboxed context with a bare
 * `window` runs them without giving them a filesystem, a network or a process.
 */
export function readWindowData(text, globalName) {
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox, { timeout: 5000 });
  const value = sandbox.window[globalName];
  if (!value) throw new Error(`that file did not set window.${globalName}`);
  return value;
}

/** Evaluate a plain `const X = (() => {...})()` module and hand back the named binding. */
export function readIifeModule(text, bindingName, extras = {}) {
  const sandbox = Object.assign({ window: {}, navigator: { userAgent: 'node' }, console: { log() {}, warn() {}, error() {} } }, extras);
  vm.createContext(sandbox);
  vm.runInContext(text + `\n;globalThis.__out = typeof ${bindingName} !== 'undefined' ? ${bindingName} : null;`, sandbox, { timeout: 5000 });
  const value = sandbox.__out;
  if (!value) throw new Error(`that file did not define ${bindingName}`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// House style, applied to text that came from somewhere else
// ---------------------------------------------------------------------------------------------

const EM_DASH = String.fromCharCode(0x2014);

/**
 * One substitution happens to carried text and it is declared, exactly as the document lane
 * declares its own: an em dash inside a source's own wording becomes a hyphen and the record says
 * so. The house rule against em dashes is about this project's prose, not about what somebody else
 * wrote, and this is the only way to hold both.
 */
export function houseStyle(text) {
  const raw = String(text == null ? '' : text);
  const cleaned = raw.split(EM_DASH).join('-');
  return { text: cleaned, changed: cleaned !== raw };
}

/** Verbatim carried text lives under a key the gate treats as a quotation, and is never edited. */
export function quoted(text, note) {
  const { text: value, changed } = houseStyle(text);
  const out = { quote: value.trim() };
  if (changed) out.quote_note = 'An em dash in the source wording is rendered here as a hyphen. Nothing else about the wording is changed.';
  if (note) out.locator = note;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The screen. Every record passes it or is held, and a held record says why.
// ---------------------------------------------------------------------------------------------

let loreCache = null;
function lore() {
  if (!loreCache) loreCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lore.json'), 'utf8'));
  return loreCache;
}

/** The prohibition token lists, read out of the pack rather than restated here. */
function prohibitionTokens() {
  const rules = (lore().prohibitions && lore().prohibitions.rules) || [];
  const out = [];
  for (const rule of rules) {
    const tokens = (rule.check && rule.check.tokens) || [];
    for (const t of tokens) out.push({ rule: rule.id, token: String(t).toLowerCase() });
  }
  const banned = ((lore().language && lore().language.banned_tokens && lore().language.banned_tokens.tokens) || [])
    .map((t) => ({ rule: 'no-banned-tokens', token: String(t.token || t).toLowerCase() }));
  return out.concat(banned);
}

let tokenCache = null;
function tokens() {
  if (!tokenCache) tokenCache = prohibitionTokens();
  return tokenCache;
}

function hasWord(haystack, needle) {
  const rx = new RegExp('(^|[^A-Za-z0-9_])(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z0-9_])', 'i');
  return rx.test(haystack);
}

/** The two organisations whose views this project may never represent. */
const TO_BODIES = [
  'QYAC', 'Quandamooka Yoolooburrabee', 'MMEIC', 'Minjerribah Moorgumpin', 'Elders-in-Council', 'Elders in Council'
];

/**
 * Does anything in this object name a Traditional Owner organisation?
 *
 * Exported because three things need the same answer and must not each keep their own list: the
 * screen below, the wanted-list screen, and the feed gate in verify.mjs. Takes a whole object
 * rather than a string so a caller cannot accidentally check one field and miss another.
 */
export function namesTraditionalOwnerBody(node) {
  const blob = everyString(node).join('   ').toLowerCase();
  return TO_BODIES.some((b) => blob.includes(b.toLowerCase()));
}

/**
 * Verbs that turn naming a body into speaking for it. Naming QYAC as the body that manages the
 * national park is a published civic fact. Saying QYAC wants, backs, opposes or has decided
 * anything is a position, and a position needs a citation in `lore.qyac_public_positions` or it
 * does not exist in this repository.
 */
const POSITION_VERBS = [
  'wants', 'want', 'believes', 'believe', 'thinks', 'think', 'opposes', 'oppose', 'supports',
  'support', 'backs', 'back', 'rejects', 'reject', 'approved', 'approves', 'refused', 'refuses',
  'decided', 'decides', 'agreed', 'agrees', 'concerned', 'concerns about', 'position on',
  'view on', 'views on', 'says', 'said', 'told', 'plans to', 'intends', 'welcomes', 'warns'
];

/**
 * Fields a connector writes itself, rather than carries from a source.
 *
 * The screen has to know the difference. Its whole job is to judge what came out of somebody
 * else's file, and a connector's own handling note routinely contains the words the screen is
 * looking for: an explanation that a listing source "says to confirm dates" is this repository
 * being careful, not this repository putting words in an organisation's mouth. Screening its own
 * prose alongside the payload was the first thing this check got wrong, and it held a record that
 * was correct.
 *
 * Em dashes are still checked everywhere, because that rule is about this repository's own writing.
 */
export const PROSE_KEYS = new Set([
  'handling', 'cultural_handling', 'privacy', 'place_note', 'atlas_status_meaning', 'quote_note',
  'note', 'why_it_matters', 'how_small_it_could_start', 'what', 'freshness_rule', 'source_boundary'
]);

/**
 * Keys whose values are identifiers rather than sentences.
 *
 * The position-verb rule asks whether a Traditional Owner organisation has been named next to a
 * word that would read as its view. An id is not a reading of anything: it is a slug, and a slug is
 * built by lower-casing a name and joining it with hyphens. That distinction is not academic. The
 * noticeboard connector names a gap `nb-want-<organisation>`, and `want` is a position verb, so the
 * QYAC and the MMEIC wanted entries tripped the cultural rule on the word "want" in their own ids
 * and were held. Held is the safe direction to fail in and it was still wrong: it quietly took two
 * real organisations off the list of organisations nobody has asked, which is the one list where
 * hiding a gap does damage.
 *
 * Only the position-verb scan narrows. The prohibition token lists from `data/lore.json` and the em
 * dash rule still read every string in the record, ids included.
 */
const IDENTIFIER_KEYS = /^(id|kind|queue|status|schema|feed|extractor|connector|locator|source|caseId)$|_id$/;

function everyString(node, out = [], key = '', opts = {}) {
  const { skipProse = false, skipIdentifiers = false } = opts;
  if (typeof node === 'string') {
    const drop = (skipProse && PROSE_KEYS.has(key)) || (skipIdentifiers && IDENTIFIER_KEYS.test(key));
    if (!drop) out.push(node);
    return out;
  }
  if (Array.isArray(node)) { for (const v of node) everyString(v, out, key, opts); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) everyString(v, out, k, opts);
    return out;
  }
  return out;
}

/**
 * Screen one record before it is written. Returns `{ ok, reasons }`.
 *
 * A held record is not a failure of the connector, it is the connector working. The reason names
 * the rule and never quotes the token, because a feed that quoted the words it exists to refuse
 * would be the one file in the repository that fails the rule it administers, which is the same
 * reasoning tools/ingest gives for keeping its ledger clean.
 */
export function screenRecord(record) {
  const reasons = [];
  const strings = everyString(record, [], '', { skipProse: true });
  const blob = strings.join('   ');

  for (const { rule, token } of tokens()) {
    if (hasWord(blob, token)) {
      reasons.push(`held under the blocking prohibition ${rule}: this record carries a word that rule forbids in this repository`);
      break;
    }
  }

  const namesBody = TO_BODIES.some((b) => blob.toLowerCase().includes(b.toLowerCase()));
  if (namesBody) {
    // Sentences only. See IDENTIFIER_KEYS: a slug is not a reading of anybody's position.
    const sentences = everyString(record, [], '', { skipProse: true, skipIdentifiers: true }).join('   ');
    for (const verb of POSITION_VERBS) {
      if (hasWord(sentences, verb)) {
        reasons.push('held under the blocking cultural rule: this record names a Traditional Owner '
          + 'organisation next to a word that would read as its view, decision or intention. This project '
          + 'may list what those organisations publicly advertise and may not represent what they hold.');
        break;
      }
    }
  }

  const contact = [record.phone, record.mobile, record.email].filter(Boolean);
  if (contact.length) {
    const cites = (record.upstream_sources && record.upstream_sources.length) || record.website;
    if (!cites) {
      reasons.push('held because it carries a contact detail and names no published source for it. '
        + 'A contact detail with no source is a guess, and a guess is not consent to publish.');
    }
  }

  if (String(record.confidence) === 'low' && record.player_facing === true) {
    reasons.push('held under no-low-confidence-to-player: low confidence never reaches a player.');
  }

  const emDashIn = everyString(record).find((s) => s.includes(EM_DASH));
  if (emDashIn) {
    reasons.push('held because carried text still contains an em dash. Route source wording through '
      + 'quoted() so the substitution is declared.');
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Screen one wanted-list entry, which is not a record and still goes into a committed file.
 *
 * This was the hole. The screen ran over records and the wanted list went in unscreened, so
 * `data/feeds/_noticeboard.json` carried a QYAC entry and an MMEIC entry with no review flag on
 * either, and the feed gate had nothing to raise. A wanted entry is a shorter thing than a record
 * but it is written into the same public file, so it passes the same screen.
 *
 * Two outcomes and a reduction between them:
 *
 *   an entry naming a Traditional Owner organisation loses the source's guess about what that
 *   organisation might share, because a guess about what a body would provide reads as that body's
 *   intention, and it is flagged for the cultural review queue. The name stays: an organisation
 *   nobody has asked is a real gap and hiding the gap would be worse than naming it.
 *
 *   an entry that still does not pass is held with its reasons, exactly as a record would be.
 *
 * Returns `{ ok, entry, reasons, culturalFlag }`. The entry handed back is the one to write.
 */
export function screenWanted(entry) {
  let out = entry;
  let flag = null;

  if (namesTraditionalOwnerBody(entry)) {
    out = Object.assign({}, entry);
    if ('what_the_source_thinks_it_might_share' in out) out.what_the_source_thinks_it_might_share = null;
    out.cultural_handling = 'This entry names a Traditional Owner organisation. It carries the name and the '
      + 'fact that nobody has asked, and nothing else. Whatever the source repository guessed this '
      + 'organisation might provide is dropped here, because a guess about what a body would supply reads '
      + 'as that body\'s intention. Nothing may be added to this entry without a person going and asking. '
      + 'The queue is docs/CULTURAL-REVIEW.md.';
    flag = {
      id: entry.id,
      name: entry.organisation || entry.who_would_have_to_agree || entry.id,
      kind: 'wanted-list-entry',
      why: 'A wanted-list entry naming a Traditional Owner organisation. Carried as a name and an '
        + 'unanswered ask only. A human reads this before anything is promoted or sent.',
      queue: 'docs/CULTURAL-REVIEW.md'
    };
  }

  const screen = screenRecord(out);
  return { ok: screen.ok, entry: out, reasons: screen.reasons, culturalFlag: screen.ok ? flag : null };
}

// ---------------------------------------------------------------------------------------------
// The record envelope
// ---------------------------------------------------------------------------------------------

/**
 * Build one envelope v1 record, so a feed record can be promoted into a data pack through
 * tools/ingest/promote.mjs without being reshaped. The fields are the ones docs/INGEST.md sets
 * out; everything a connector adds beyond them sits alongside.
 */
export function envelope({
  id, connector, connectorVersion, syncId, locator, quote, quoteNote, confidence,
  status = 'committed', asserts = null, freshness = null, extra = {}
}) {
  const rec = {
    id,
    source: `feed:${connector}@${syncId}`,
    locator,
    confidence,
    extracted_at: syncId.slice(0, 10),
    extractor: `connector-${connector}/${connectorVersion}`,
    status
  };
  if (quote) {
    const q = houseStyle(quote);
    rec.quote = q.text;
    if (q.changed || quoteNote) {
      rec.quote_note = quoteNote
        || 'An em dash in the source wording is rendered here as a hyphen. Nothing else about the wording is changed.';
    }
  }
  if (asserts) rec.asserts = asserts;
  Object.assign(rec, extra);
  if (freshness) rec.freshness = freshness;
  return rec;
}

// ---------------------------------------------------------------------------------------------
// Coarsening. Done at ingest, before commit, never at display time.
// ---------------------------------------------------------------------------------------------

/**
 * Round a coordinate to a declared precision, deterministically.
 *
 * docs/PARTICIPATION.md is explicit that precise locations of anything vulnerable never enter the
 * repository and that fuzzing happens before commit, because a runtime filter is one bug away from
 * publishing the thing it was hiding. Three decimal places is about 110 m, which puts a pin on the
 * right stretch of road without putting it on a nest or a driveway.
 */
export function coarsen(lat, lng, decimals = 3) {
  const f = Math.pow(10, decimals);
  const ok = (v) => typeof v === 'number' && isFinite(v);
  if (!ok(lat) || !ok(lng)) return { lat: null, lng: null, precision_m: null };
  return {
    lat: Math.round(lat * f) / f,
    lng: Math.round(lng * f) / f,
    precision_m: Math.round(111000 / f)
  };
}

/** Round a timestamp down to the hour. When an animal was seen, not who was awake at 3:07am. */
export function coarsenTime(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/);
  return m ? `${m[1]}T${m[2]}:00` : (s.slice(0, 10) || null);
}

// ---------------------------------------------------------------------------------------------
// The wildlife app's own wire format
// ---------------------------------------------------------------------------------------------

/**
 * Minjerribah Wildlife Map sync codes, read and written exactly as `assets/sync.js` in that
 * repository does them. This is the only place in this project that speaks another application's
 * wire format, and it is worth it: that format is already carrying real reports between real
 * phones through a group chat, so a twin that can read it is reading a working stream rather than
 * asking a volunteer group to build an export for it.
 *
 * Field order, prefixes and checksum are copied field for field from that file. If it changes
 * there, this breaks loudly on the checksum rather than quietly on the meaning, which is the
 * behaviour that file was designed for.
 */
export const MWR_ORDER = ['id', 'when', 'lat', 'lng', 'place', 'group', 'species', 'count',
  'status', 'cause', 'notes', 'reporter', 'phone', 'source', 'caseId', 'kind',
  'mobility', 'danger', 'urgency', 'created', 'updated'];

function mwrChecksum(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, '0').slice(0, 4);
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '==='.slice((b64.length + 3) % 4), 'base64');
}

export function encodeMwr(record, { compress = true } = {}) {
  const arr = MWR_ORDER.map((k) => (record[k] === undefined ? '' : record[k]));
  const json = Buffer.from(JSON.stringify(arr), 'utf8');
  if (!compress) {
    const body = b64url(json);
    return `MWR0.${body}.${mwrChecksum('MWR0' + body)}`;
  }
  const body = b64url(zlib.deflateRawSync(json));
  return `MWR1.${body}.${mwrChecksum('MWR1' + body)}`;
}

export function decodeMwr(code) {
  const m = String(code).match(/^(MWR[01])\.([A-Za-z0-9_-]+)\.([a-z0-9]{4})$/);
  if (!m) return { error: 'cut' };
  const [, prefix, body, sum] = m;
  if (mwrChecksum(prefix + body) !== sum) return { error: 'cut' };
  try {
    let bytes = unb64url(body);
    if (prefix === 'MWR1') bytes = zlib.inflateRawSync(bytes);
    const arr = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(arr)) return { error: 'bad' };
    const rec = {};
    MWR_ORDER.forEach((k, i) => { rec[k] = arr[i]; });
    if (!rec.id) return { error: 'bad' };
    if (!rec.caseId) rec.caseId = rec.id;
    return { record: rec };
  } catch {
    return { error: 'bad' };
  }
}

/** Pull every complete code out of a pasted message or a whole copied chat thread. */
export function extractMwrCodes(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  const found = compact.match(/MWR[01]\.[A-Za-z0-9_-]+\.[a-z0-9]{4}/g) || [];
  const markers = (compact.match(/MWR[01]\./g) || []).length;
  return { codes: found, truncated: Math.max(0, markers - found.length) };
}

// ---------------------------------------------------------------------------------------------
// Writing a feed
// ---------------------------------------------------------------------------------------------

export function sha256lf(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export const FEED_SCHEMA = 'minjerribah-connector-feed/1';
const FEED_INDEX = path.join(FEED_DIR, '_feeds.json');

/**
 * Write one feed and record it in the feed index.
 *
 * Feed files carry a leading underscore because `tools/gate-audit.mjs` treats every .json under
 * data/ as a pack the twin loads unless it does, and says so in its own hint. A feed is not a pack:
 * it is what a connector read, staged for a person to promote. The underscore is the convention
 * data/_provenance.json already uses for the same reason.
 */
export function writeFeed(feed) {
  fs.mkdirSync(FEED_DIR, { recursive: true });
  const file = path.join(FEED_DIR, `_${feed.feed}.json`);
  const text = stableJson(feed);
  fs.writeFileSync(file, text, 'utf8');

  let index = { pack: '_feeds', schema: 'minjerribah-connector-feed-index/1', generated: today(), about: '', feeds: [] };
  if (fs.existsSync(FEED_INDEX)) {
    try { index = JSON.parse(fs.readFileSync(FEED_INDEX, 'utf8')); } catch { /* rewrite it */ }
  }
  index.about = 'One entry per feed a connector has written. The checksum is over the feed file as '
    + 'it stands, so a hand edit shows up as a mismatch when tools/connectors/verify.mjs runs. Feeds '
    + 'are not data packs: data/_provenance.json is the registry for those.';
  index.generated = today();
  index.feeds = (index.feeds || []).filter((f) => f.id !== feed.feed);
  index.feeds.push({
    id: feed.feed,
    file: `data/feeds/_${feed.feed}.json`,
    title: feed.title,
    organisation: feed.organisation,
    // Carried up from the feed so the index alone answers the question the browser's loader asks at
    // boot: which of these does the running twin read. Absent means no, which is the right default
    // and is what every feed written before this said.
    runtime_read: feed.runtime_read === true,
    synced_at: feed.sync.synced_at,
    source: {
      kind: feed.sync.source.kind,
      id: feed.sync.source.id,
      commit: feed.sync.source.commit,
      commit_date: feed.sync.source.commit_date
    },
    cadence: feed.sync.cadence,
    stale_after_days: feed.sync.stale_after_days,
    counts: feed.sync.counts,
    checksum: { algorithm: 'sha256-lf', value: sha256lf(text) },
    bytes: Buffer.byteLength(text, 'utf8')
  });
  index.feeds.sort((a, b) => (a.id < b.id ? -1 : 1));
  fs.writeFileSync(FEED_INDEX, stableJson(index), 'utf8');
  return { file: `data/feeds/_${feed.feed}.json`, bytes: Buffer.byteLength(text, 'utf8') };
}

export function readFeed(id) {
  const file = path.join(FEED_DIR, `_${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function readFeedIndex() {
  if (!fs.existsSync(FEED_INDEX)) return null;
  return JSON.parse(fs.readFileSync(FEED_INDEX, 'utf8'));
}

/** Somewhere for an emission to land. Emissions are files a person reviews and sends. */
export function outFile(kind, name) {
  const dir = path.join(OUT_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

export function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** The twin's own pack fingerprint, so anything emitted can name the island it came from. */
export function packFingerprint() {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', '_provenance.json'), 'utf8'));
  return reg.fingerprint;
}

export function argOf(args, name, fallback = null) {
  const i = args.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
