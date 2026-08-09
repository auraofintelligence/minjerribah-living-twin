// Shared machinery for the ingest spine: file walking, record walking, hashing, findings.
//
// Nothing in here knows what a rule is. It knows how to find every file in the repository that is
// ours rather than vendored, how to walk a data pack down to the records inside it, how to hash a
// file the same way on every machine, and how to collect a finding with enough detail that a
// person can open the offending line without asking anybody a question.
//
// House rules that apply to every file under tools/ingest: Australian English, no em dashes, and
// no network. These tools run offline against the working tree and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories no check ever descends into. Vendored engine, git internals, throwaway output. */
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'shots', 'progress', '.claude']);

/** Text-ish extensions. A check that scans for a token only scans these. */
export const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.svg', '.gltf', '.csv'
]);

export const CONFIDENCE_VALUES = ['high', 'medium', 'low'];

/** The three statuses the record envelope allows. Anything else is drift and the gate says so. */
export const ENVELOPE_STATUSES = ['committed', 'contributed', 'proposed'];

export function readText(file) {
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8');
}

export function readJSON(file) {
  return JSON.parse(readText(file));
}

export function exists(file) {
  return fs.existsSync(path.isAbsolute(file) ? file : path.join(ROOT, file));
}

/**
 * The one hash this project uses for committed data.
 *
 * Line endings are normalised to LF before hashing, deliberately. Git on Windows can hand a
 * checkout back with CRLF and the bytes on disk then differ between two machines holding the same
 * commit. A checksum that fails because of that teaches people to ignore checksums, so it hashes
 * the content rather than the encoding of its line breaks. Recorded in the registry as
 * `sha256-lf` so nobody has to guess later.
 */
export function sha256lf(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function shortHash(text, n = 12) {
  return sha256lf(text).slice(0, n);
}

/**
 * Today, in the local calendar, as an ISO date.
 *
 * `toISOString().slice(0, 10)` is UTC, which on this island is ten or eleven hours behind, so
 * anything ingested before mid-morning would be stamped with yesterday's date. An ingest date that
 * is wrong by a day is a small thing until somebody is reconciling a pack against a council
 * document's consultation window.
 */
export function today(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every file in the repository that this project wrote, relative to the root, sorted. */
export function repoFiles({ exts = null, under = '' } = {}) {
  const out = [];
  const start = path.join(ROOT, under);
  if (!fs.existsSync(start)) return out;
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (exts && !exts.has(ext)) continue;
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  })(start);
  return out;
}

/**
 * Walk a parsed JSON pack and yield every object that looks like a record, which here means an
 * object carrying an `id` and sitting in an array.
 *
 * Yields `{ record, pointer, collection, array }`:
 *   pointer     `levers[12]`, what you type into an editor's search box
 *   collection  `levers`, or `services[].schedule.variants`, with the indices collapsed. This is
 *               what the registry and the schemas name.
 *   array       `services[1].schedule.variants`, the actual array the record sits in. Ids have to
 *               be unique inside this and not inside the collapsed collection: every ferry service
 *               is entitled to a schedule variant called `base`.
 */
export function* walkRecords(node, pointer = '', arrayPointer = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (!v || typeof v !== 'object') continue;
      const p = `${pointer}[${i}]`;
      if (typeof v.id === 'string' && pointer) {
        yield { record: v, pointer: p, collection: pointer.replace(/\[\d+\]/g, '[]'), array: pointer };
      }
      yield* walkRecords(v, p, pointer);
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') yield* walkRecords(v, pointer ? `${pointer}.${k}` : k, arrayPointer);
  }
}

/** Walk every string in a parsed JSON document, with the key it sat under and a readable pointer. */
export function* walkStrings(node, pointer = '', key = '') {
  if (typeof node === 'string') {
    yield { value: node, key, pointer };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walkStrings(node[i], `${pointer}[${i}]`, key);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    yield* walkStrings(v, pointer ? `${pointer}.${k}` : k, k);
  }
}

/** Walk every object key in a parsed JSON document. The wave 7 fault arrived as keys, not values. */
export function* walkKeys(node, pointer = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (node[i] && typeof node[i] === 'object') yield* walkKeys(node[i], `${pointer}[${i}]`);
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const p = pointer ? `${pointer}.${k}` : k;
    yield { key: k, pointer: p, parentPointer: pointer, value: v };
    if (v && typeof v === 'object') yield* walkKeys(v, p);
  }
}

/**
 * Is this key a confidence rating, as opposed to a word with confidence in the name?
 * `confidence_interval` is a statistic, `confidence_scale` is documentation, `confidence_reason`
 * is prose about a rating. None of them is a rating.
 */
export function isConfidenceKey(key) {
  if (key === 'confidence') return true;
  if (/^(.*_)?confidence$/.test(key)) return true;
  return false;
}

/** The confidence rating on a record, or null. Coordinate precision is not the record's confidence. */
export function confidenceOf(record) {
  const v = record && record.confidence;
  return typeof v === 'string' && CONFIDENCE_VALUES.includes(v) ? v : null;
}

/** Does this record cite anything at all? Legacy packs use a spread of key names for it. */
export function citesSomething(record) {
  if (!record || typeof record !== 'object') return false;
  for (const [k, v] of Object.entries(record)) {
    if (!/^(source|sources|source_\d+|source_ref|source_pack|source_note|citation|reference|url|provenance|lore_ref)$/.test(k)) continue;
    if (typeof v === 'string' && v.trim()) return true;
    if (Array.isArray(v) && v.length) return true;
    if (v && typeof v === 'object' && Object.keys(v).length) return true;
  }
  return false;
}

/** Line number of a byte offset, for pointing a person at a line rather than a character. */
export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

/**
 * A finding names one thing wrong in one place. `check` is the rule that produced it, `file` and
 * `locator` are how a person finds it, `id` is the record if there is one, and `message` says what
 * is wrong in a sentence somebody who did not write the check can act on.
 *
 * Severity is one of:
 *   blocking  the gate exits non-zero
 *   accepted  a blocking-class finding that the ledger records as known debt, with a reason and a
 *             frozen count. It prints, it does not fail, and it fails the moment the count grows.
 *   advisory  worth knowing, never fails
 *   review    a rule whose check is a human question, printed so the question gets asked
 */
export class Findings {
  constructor() {
    this.items = [];
    this.checksRun = [];
  }

  add(f) {
    if (!f.check || !f.message) throw new Error('a finding needs a check and a message');
    this.items.push({
      check: f.check,
      severity: f.severity || 'blocking',
      file: f.file || '',
      locator: f.locator || '',
      id: f.id || '',
      message: f.message,
      hint: f.hint || ''
    });
    return this;
  }

  ran(check, note = '') { this.checksRun.push({ check, note }); }

  bySeverity(sev) { return this.items.filter((i) => i.severity === sev); }
  ofCheck(check) { return this.items.filter((i) => i.check === check); }
  get blocking() { return this.bySeverity('blocking'); }
}

/** A stable one-line key for a finding, used to match it against the accepted-debt ledger. */
export function findingKey(f) {
  return `${f.check}|${f.file}|${f.locator}`;
}
