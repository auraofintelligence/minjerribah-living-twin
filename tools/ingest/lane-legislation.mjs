// The legislation lane. BUILT.
//
// Turns a hand-written catalogue of named Acts into measured records: what each instrument is,
// who administers it, how large it actually is, and which of its parts bear on an ordinary
// person. It is the lane behind data/legislation.json.
//
//   node tools/ingest/lane-legislation.mjs --index          refresh the two official indexes
//   node tools/ingest/lane-legislation.mjs --resolve        check every catalogue id against them
//   node tools/ingest/lane-legislation.mjs --fetch          download the current consolidations
//   node tools/ingest/lane-legislation.mjs --measure        measure pages and structure
//   node tools/ingest/lane-legislation.mjs --judgments      check every judgment against its publisher
//   node tools/ingest/lane-legislation.mjs --edges          check every edge quote against its document
//   node tools/ingest/lane-legislation.mjs --extract --batch legislation-2026-08
//   node tools/ingest/lane-legislation.mjs --report         what is verified and what is not
//
// WHY IT EXISTS. In 2013 the owner went through his filing cabinet, found every reference to an
// Act in the fine print of his own life, and read them. Somewhere between fifty-five and sixty
// instruments. The question he came out with is the one this lane serves: how much legislative
// weight is crippling and how much is uplifting, and in what measure, for an ordinary person.
// Weight has to be measured rather than felt, so this lane measures it.
//
// FOUR RULES SHAPE IT.
//
// 1. NOTHING IS RECORDED THAT WAS NOT MEASURED OR WRITTEN BY HAND WITH A CITATION. Page counts,
//    provision counts, part counts, compilation numbers and currency dates come out of the
//    published consolidation itself. The Commonwealth administering department comes out of the
//    Federal Register of Legislation's own API. The plain-English description and the bearing on
//    an ordinary person are judgements, they live in tools/ingest/legislation-catalogue.json where
//    a person wrote them, and they are marked as judgements in the record.
//
// 2. THE IDENTIFIER IS VERIFIED, NOT GUESSED. Queensland serves Acts at act-YYYY-NNN and it is
//    easy to guess a number and be wrong, so --resolve checks every catalogue entry against the
//    official in-force index and refuses any whose short title does not match exactly. The
//    Commonwealth ids are resolved the same way against the register's OData API. After fetching,
//    --measure checks the downloaded document's own cover against the short title again, because
//    a correct-looking id that serves the wrong Act is the failure that produces a confident lie.
//
// 3. NO FULL TEXT IS COMMITTED. The consolidations are enormous, they belong to their publishers,
//    and the licence position varies between the two jurisdictions. What is committed is the
//    citation, the structure, the size, the plain-English description and a stable deep link. The
//    PDFs land in ingest-inbox/legislation, which is in .gitignore, and their sha256 is recorded
//    so the measurement can be shown to have come from a specific file.
//
// 4. IT NEVER WRITES A PACK. Like the other lanes it writes candidates, and only
//    tools/ingest/promote.mjs writes data/, after the whole gate has run.
//
// ON THE NETWORK. --index and --fetch reach the two official registers and nothing else. That is
// an offline ingest step in the same sense as tools/connectors: it happens when a person runs this
// command, the result is checksummed on disk, and the running twin never touches any of it. Every
// other command in this file works on what is already downloaded, and --extract will refuse to
// invent a measurement for a document that was never fetched.
//
// WHAT IT IS NOT. It is not legal advice and no record produced by it may read as advice. Every
// record carries the pack's not_advice line, which says that this is a description of published
// law rather than advice, and that a person's actual position depends on facts this twin does not
// know. That line is a required field in the pack schema for exactly this reason: it cannot be
// dropped by a panel that forgot about it, because a record without it does not pass the gate.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, readJSON, readText, exists, today } from './lib.mjs';

export const EXTRACTOR = { id: 'lane-legislation', version: '1.0' };
export const BUILT = true;

const CATALOGUE = 'tools/ingest/legislation-catalogue.json';
const INBOX = 'ingest-inbox/legislation';
const CANDIDATES = 'tools/ingest/candidates';
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ---------------------------------------------------------------------------------------------
// The two registers
// ---------------------------------------------------------------------------------------------

/**
 * Where each jurisdiction's authorised consolidation lives, and how to ask for it.
 *
 * The Commonwealth register is a single page application, so the human-facing /latest/text URL
 * that looks like a plain text download in a browser returns the application shell to anything
 * else. Its OData API is the actual source and it is public and documented, so that is what this
 * lane reads. Queensland serves the whole Act as a PDF from a stable path and does not need an API
 * for the document, only for the index that says which number an Act is.
 */
export const REGISTERS = {
  Commonwealth: {
    id: 'frl',
    label: 'Federal Register of Legislation',
    publisher: 'Office of Parliamentary Counsel, Canberra',
    api: 'https://api.prod.legislation.gov.au/v1',
    deepLink: (titleId) => `https://www.legislation.gov.au/${titleId}/latest/text`,
    document: (titleId, volume) =>
      `https://api.prod.legislation.gov.au/v1/documents/find(titleid='${titleId}',`
      + `asatspecification='Current',type='Primary',format='Pdf',uniqueTypeNumber=0,`
      + `volumeNumber=${volume},rectificationVersionNumber=0)`,
    licence_note: 'Commonwealth legislation on the Federal Register is published by the Office of '
      + 'Parliamentary Counsel under a Creative Commons Attribution 4.0 licence for most material. '
      + 'This pack records structure and citation rather than republishing text, so the question '
      + 'does not arise for the pack itself.'
  },
  Queensland: {
    id: 'oqpc',
    label: 'Queensland Legislation, Office of the Queensland Parliamentary Counsel',
    publisher: 'Office of the Queensland Parliamentary Counsel',
    api: 'https://www.legislation.qld.gov.au/projectdata',
    deepLink: (actId) => `https://www.legislation.qld.gov.au/view/html/inforce/current/${actId}`,
    document: (actId) => `https://www.legislation.qld.gov.au/view/whole/pdf/inforce/current/${actId}`,
    licence_note: 'Queensland reprints carry a Creative Commons Attribution 4.0 notice on the '
      + 'cover page. This pack records structure and citation rather than republishing text.'
  }
};

// ---------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------

function abs(rel) { return path.join(ROOT, rel); }
function rel(full) { return path.relative(ROOT, full).split(path.sep).join('/'); }

function ensureDir(dir) { fs.mkdirSync(abs(dir), { recursive: true }); }

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Normalise a line for comparison and for quoting: collapse whitespace, fold the several kinds of
 * apostrophe and dash a typesetter uses onto the plain ones, and render an em dash as a hyphen the
 * way the document lane does. A quote is the source's wording, and this changes none of it; it
 * changes how the wording is encoded so that two spellings of the same apostrophe do not fail a
 * title check, and so that a house rule about this project's own prose does not put a character
 * into the repository that the gate then blocks.
 */
export function tidy(s) {
  return String(s || '')
    .split(EM).join(' - ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .split(EN).join('-')
    .replace(/\s+/g, ' ')
    .trim();
}

function argVal(args, flag, dflt = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/**
 * Load the catalogue and check it is the shape the rest of this file assumes. It is hand written,
 * so the failure mode is a typo rather than a bug, and the useful thing is to name the entry.
 */
export function loadCatalogue() {
  if (!exists(CATALOGUE)) throw new Error(`${CATALOGUE} does not exist. The lane reads a catalogue; it does not invent one.`);
  const doc = readJSON(CATALOGUE);
  const seen = new Set();
  for (const e of doc.instruments || []) {
    const where = `instrument "${e.id || '(no id)'}"`;
    for (const f of ['id', 'short_title', 'jurisdiction', 'register_id', 'citation', 'plain_english', 'bearing', 'life_events']) {
      if (e[f] === undefined || e[f] === null || e[f] === '') throw new Error(`${where} is missing "${f}".`);
    }
    if (!REGISTERS[e.jurisdiction]) throw new Error(`${where} names jurisdiction "${e.jurisdiction}", which is not one of ${Object.keys(REGISTERS).join(', ')}.`);
    if (seen.has(e.id)) throw new Error(`${where} is listed twice.`);
    seen.add(e.id);
  }
  return doc;
}

// ---------------------------------------------------------------------------------------------
// The indexes
// ---------------------------------------------------------------------------------------------

/**
 * A very small CSV reader. Queensland's index download is quoted CSV with embedded commas and
 * doubled quotes, and pulling in a parser for one file would be a worse trade than twenty lines.
 */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Queensland's official list of in-force principal Acts, as at the register's own clock.
 *
 * The register's browse pages are drawn by a table widget that asks a data endpoint for rows, and
 * that endpoint will hand back the whole result set as CSV. That is the same list a person sees
 * when they browse in-force Acts by title, which is what makes it the right thing to check an
 * identifier against: not a search, the index.
 */
export async function refreshQldIndex() {
  const browse = await fetch('https://www.legislation.qld.gov.au/browse/inforce');
  const html = await browse.text();
  const stamp = (html.match(/data-server-time="(\d{14})"/) || [])[1];
  if (!stamp) throw new Error('the Queensland register did not return its server time, which the point-in-time query needs.');
  const expression = `PrintType="act.reprint" AND PitValid=@pointInTime("${stamp}") AND Repealed="N"`;
  const url = `${REGISTERS.Queensland.api}?ds=OQPC-BrowseDataSource&subset=browse`
    + `&expression=${encodeURIComponent(expression)}&download=true&format=csv`;
  const res = await fetch(url, { headers: { cookie: browse.headers.getSetCookie ? '' : '' } });
  if (!res.ok) throw new Error(`the Queensland index returned ${res.status}.`);
  const csv = await res.text();
  const rows = parseCsv(csv);
  const head = rows[0] || [];
  const cId = head.indexOf('id');
  const cTitle = head.indexOf('title');
  const cYear = head.indexOf('year');
  const cNo = head.indexOf('no');
  if (cId < 0 || cTitle < 0) throw new Error('the Queensland index came back without an id or title column.');
  // Several real Queensland short titles carry an em dash, and the repository has a blocking rule
  // against that character which scans the inbox as well as the packs. Titles are put through the
  // same normalisation the document lane uses on a quote: the em dash is rendered as a hyphen,
  // nothing else about the wording changes, and the index says so. Matching normalises both sides,
  // so this cannot make a title match that should not.
  const acts = rows.slice(1).filter((r) => r.length > cTitle && r[cId]).map((r) => ({
    id: r[cId], title: tidy(r[cTitle]), year: r[cYear], number: r[cNo]
  }));
  if (acts.length < 300) throw new Error(`the Queensland index came back with only ${acts.length} Acts, which is too few to be the whole in-force list.`);
  ensureDir(`${INBOX}/index`);
  const out = `${INBOX}/index/qld-inforce-acts.json`;
  fs.writeFileSync(abs(out), JSON.stringify({
    source: 'https://www.legislation.qld.gov.au/browse/inforce',
    query: expression,
    register_server_time: stamp,
    fetched_at: today(),
    acts
  }, null, 1) + '\n', 'utf8');
  return { file: out, count: acts.length, stamp };
}

/**
 * The Commonwealth side. One request per title rather than a bulk download, because the register
 * holds every instrument ever made and the catalogue names fewer than forty of them. The register
 * also hands back the administering department, which is the one field of the brief that would
 * otherwise have to be guessed, so it is taken here and not written by hand.
 */
export async function resolveCommonwealth(shortTitle) {
  const filter = encodeURIComponent(`name eq '${shortTitle.replace(/'/g, "''")}'`);
  const url = `${REGISTERS.Commonwealth.api}/titles?%24filter=${filter}&%24expand=administeringDepartments`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the Commonwealth register returned ${res.status} for "${shortTitle}".`);
  const body = await res.json();
  const hits = (body.value || []).filter((v) => v.isPrincipal && v.status === 'InForce');
  if (hits.length !== 1) return { found: false, count: hits.length };
  const h = hits[0];
  return {
    found: true,
    title_id: h.id,
    name: h.name,
    collection: h.collection,
    status: h.status,
    made: h.makingDate ? String(h.makingDate).slice(0, 10) : null,
    year: h.year,
    number: h.number,
    administering_departments: (h.administeringDepartments || []).map((d) => d.name).sort(),
    current_version: await currentVersion(h.id)
  };
}

/**
 * The register's own structured account of which version of a title is in force: when it started,
 * which compilation number it is, and when that entry was registered.
 *
 * This exists because a cover page is typeset and metadata is not. The Constitution's cover renders
 * its three values one row above their labels, and the first pass of this lane published the
 * registration date as the compilation date at high confidence, which said the text of the
 * Constitution was current to 2021 when it is current to 1977. `readCover` now reads the columns,
 * and this is the second opinion that proves it: two independent sources agreeing is worth more
 * than either of them, and where they disagree `extract` takes the register and says so on the
 * record rather than choosing quietly.
 */
async function currentVersion(titleId) {
  const filter = encodeURIComponent(`titleId eq '${titleId}' and isCurrent eq true`);
  const res = await fetch(`${REGISTERS.Commonwealth.api}/versions?%24filter=${filter}`);
  if (!res.ok) return null;
  const body = await res.json();
  const v = (body.value || [])[0];
  if (!v) return null;
  return {
    start: v.start ? String(v.start).slice(0, 10) : null,
    compilation_number: v.compilationNumber !== undefined && v.compilationNumber !== null ? String(v.compilationNumber) : null,
    register_id: v.registerId || null,
    registered_at: v.registeredAt ? String(v.registeredAt).slice(0, 10) : null
  };
}

/** "1977-07-29" as "29 July 1977", which is how both registers print a date on a cover. */
export function longDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function qldIndex() {
  const file = `${INBOX}/index/qld-inforce-acts.json`;
  if (!exists(file)) throw new Error(`${file} is not there. Run --index first.`);
  return readJSON(file);
}

// ---------------------------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------------------------

/**
 * Check every catalogue entry against its register. Nothing is written to the catalogue: this
 * reports, and it writes a resolution file that --extract will not run without. An entry whose
 * short title does not match the register exactly comes back unresolved and stays that way, which
 * is the point. Padding the count with an Act nobody checked is the failure this guards.
 */
export async function resolveAll() {
  const cat = loadCatalogue();
  const qld = qldIndex();
  const byTitle = new Map(qld.acts.map((a) => [tidy(a.title).toLowerCase(), a]));
  const byId = new Map(qld.acts.map((a) => [a.id, a]));
  const out = [];
  for (const e of cat.instruments) {
    if (e.jurisdiction === 'Queensland') {
      const hit = byId.get(e.register_id);
      const titleMatches = hit && tidy(hit.title).toLowerCase() === tidy(e.short_title).toLowerCase();
      const byName = byTitle.get(tidy(e.short_title).toLowerCase());
      out.push({
        id: e.id,
        jurisdiction: e.jurisdiction,
        register_id: e.register_id,
        resolved: Boolean(hit && titleMatches),
        register_title: hit ? tidy(hit.title) : null,
        register_year: hit ? hit.year : null,
        register_number: hit ? hit.number : null,
        administering_departments: null,
        current_version: null,
        note: hit && titleMatches ? '' : hit
          ? `the register says ${e.register_id} is "${tidy(hit.title)}", the catalogue says "${e.short_title}"`
          : byName
            ? `the register has no ${e.register_id}; "${e.short_title}" is ${byName.id}`
            : `neither ${e.register_id} nor the title "${e.short_title}" is in the in-force index`
      });
      continue;
    }
    const r = await resolveCommonwealth(e.short_title);
    out.push({
      id: e.id,
      jurisdiction: e.jurisdiction,
      register_id: e.register_id,
      resolved: Boolean(r.found && r.title_id === e.register_id),
      register_title: r.found ? tidy(r.name) : null,
      register_year: r.found ? r.year : null,
      register_number: r.found ? r.number : null,
      administering_departments: r.found ? r.administering_departments : null,
      current_version: r.found ? r.current_version : null,
      collection: r.found ? r.collection : null,
      note: r.found
        ? (r.title_id === e.register_id ? '' : `the register says "${e.short_title}" is ${r.title_id}, the catalogue says ${e.register_id}`)
        : `the register returned ${r.count} in-force principal titles named exactly "${e.short_title}"`
    });
  }
  ensureDir(INBOX);
  const file = `${INBOX}/resolved.json`;
  fs.writeFileSync(abs(file), JSON.stringify({
    resolved_at: today(), extractor: EXTRACTOR, instruments: out
  }, null, 1) + '\n', 'utf8');
  return { file, out };
}

export function resolution() {
  const file = `${INBOX}/resolved.json`;
  if (!exists(file)) throw new Error(`${file} is not there. Run --resolve first.`);
  return readJSON(file);
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
    return { ok: false, status: res.status, why: 'the reply was not a PDF' };
  }
  fs.writeFileSync(dest, buf);
  return { ok: true, status: res.status, bytes: buf.length };
}

/**
 * Download the current consolidation of every catalogue entry.
 *
 * Commonwealth compilations of the very large Acts are split into volumes, and the register
 * numbers them from one when it splits and serves volume zero when it does not. So the fetch asks
 * for volume zero, and if there is no volume zero it walks upward from one until two consecutive
 * volumes are missing. That is how the Income Tax Assessment Act 1997 comes back as the twelve
 * volumes it actually is rather than as a missing file, and the twelve volumes are the answer to
 * the owner's question about weight.
 */
export async function fetchAll({ only = null, force = false } = {}) {
  const cat = loadCatalogue();
  ensureDir(`${INBOX}/pdf`);
  const previous = exists(`${INBOX}/fetched.json`) ? readJSON(`${INBOX}/fetched.json`).instruments || [] : [];
  const before = new Map(previous.map((p) => [p.id, p]));
  const rows = [];
  for (const e of cat.instruments) {
    if (only && e.id !== only) { if (before.has(e.id)) rows.push(before.get(e.id)); continue; }
    const reg = REGISTERS[e.jurisdiction];
    const files = [];
    let failure = null;
    if (e.jurisdiction === 'Queensland') {
      const url = reg.document(e.register_id);
      const dest = abs(`${INBOX}/pdf/${e.id}.pdf`);
      if (!force && fs.existsSync(dest)) {
        files.push({ volume: 0, url, file: rel(dest), bytes: fs.statSync(dest).size, sha256: sha256File(dest), reused: true });
      } else {
        const r = await download(url, dest);
        if (!r.ok) failure = `${url} returned ${r.status}${r.why ? ' and ' + r.why : ''}`;
        else files.push({ volume: 0, url, file: rel(dest), bytes: r.bytes, sha256: sha256File(dest) });
      }
    } else {
      let volume = 0;
      let misses = 0;
      while (volume <= 40) {
        const url = reg.document(e.register_id, volume);
        const dest = abs(`${INBOX}/pdf/${e.id}${volume ? '-v' + volume : ''}.pdf`);
        if (!force && fs.existsSync(dest)) {
          files.push({ volume, url, file: rel(dest), bytes: fs.statSync(dest).size, sha256: sha256File(dest), reused: true });
          volume++;
          misses = 0;
          continue;
        }
        const r = await download(url, dest);
        if (r.ok) { files.push({ volume, url, file: rel(dest), bytes: r.bytes, sha256: sha256File(dest) }); misses = 0; }
        else { misses++; if (misses >= 2 && files.length) break; if (volume > 1 && !files.length) { failure = `${url} returned ${r.status}`; break; } }
        volume++;
      }
      if (!files.length && !failure) failure = `no volume of ${e.register_id} could be downloaded`;
    }
    rows.push({
      id: e.id,
      jurisdiction: e.jurisdiction,
      register_id: e.register_id,
      fetched_at: today(),
      volumes: files.length,
      files,
      failure
    });
    console.log(`  ${e.id.padEnd(38)} ${failure ? 'FAILED: ' + failure : files.length + ' volume(s), '
      + Math.round(files.reduce((a, f) => a + f.bytes, 0) / 1024) + ' KB'}`);
  }
  const file = `${INBOX}/fetched.json`;
  fs.writeFileSync(abs(file), JSON.stringify({ fetched_at: today(), extractor: EXTRACTOR, instruments: rows }, null, 1) + '\n', 'utf8');
  return { file, rows };
}

export function fetched() {
  const file = `${INBOX}/fetched.json`;
  if (!exists(file)) throw new Error(`${file} is not there. Run --fetch first.`);
  return readJSON(file);
}

// ---------------------------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------------------------

function pdfPages(file) {
  const raw = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const pages = raw.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  return pages;
}

/** A line that is an entry in a table of contents, which is to say it ends in dot leaders and a page. */
const LEADER = /(\.\s?){4,}\s*\d+\s*$/;

/**
 * A provision number at the head of a contents entry.
 *
 * It has to cover four styles that are all in this corpus: plain (`14`), lettered (`25AB`), the
 * Commonwealth's decimal chapter style (`70.2`), the Income Tax Assessment Act 1997's hyphenated
 * style (`6-5`), and the Constitution's trailing full stop (`51.`). The lookahead stops it eating
 * a page number or a date, because a real entry is followed by words.
 */
const PROVISION = /^([0-9]+(?:\.[0-9]+)?[A-Z]{0,5}(?:-[0-9]+[A-Z]{0,5})?)\.?\s+(?=[A-Za-z(])/;

/**
 * Find the contents of a consolidation and read its shape out of it.
 *
 * The contents is the honest place to count from. Both registers print one, both print it as
 * entries with dot leaders, and it lists every provision exactly once, which the body does not
 * because a running header repeats the section it is in. The region runs from the first page
 * carrying a Contents heading to the last consecutive page that still holds several leader lines,
 * which is where the contents stops and the long title begins.
 *
 * Two numbers come out and they answer different questions. `contents_entries` is how many
 * numbered things the Act's own contents lists, including schedule items where the Act numbers
 * them, and it is the closest honest answer to how many provisions a person is looking at.
 * `distinct_provision_numbers` is how many different numbers appear, which is lower wherever an
 * Act restarts its numbering, as the Constitution does between its covering clauses and its
 * sections. Neither is presented as the other.
 */
export function measureDocument(pages) {
  let start = pages.findIndex((p) => p.split('\n').some((l) => /^\s*Contents\b/.test(l)));
  if (start < 0) start = 0;
  const density = pages.map((p) => p.split('\n').filter((l) => LEADER.test(l.trim())).length);
  let end = start;
  let gap = 0;
  for (let i = start; i < pages.length; i++) {
    if (density[i] >= 3) { end = i; gap = 0; continue; }
    gap++;
    if (gap > 2 && i > start + 1) break;
  }
  const lines = pages.slice(start, end + 1).join('\n').split('\n').map((l) => tidy(l));
  const provisions = new Set();
  let entries = 0;
  let orphanNumbers = 0;
  const headings = { chapters: 0, parts: 0, divisions: 0, subdivisions: 0, schedules: 0 };
  const seenHeading = new Set();
  for (const l of lines) {
    if (ORPHAN_NUMBER.test(l)) { orphanNumbers++; continue; }
    const m = PROVISION.exec(l);
    if (m) { provisions.add(m[1]); entries++; continue; }
    const h = /^(Chapter|Part|Division|Subdivision|Schedule)\b\s*([0-9A-Za-z.]*)/.exec(l);
    if (!h) continue;
    const key = `${h[1]}|${h[2]}|${l.slice(0, 60)}`;
    if (seenHeading.has(key)) continue;
    seenHeading.add(key);
    const kind = h[1].toLowerCase() + (h[1] === 'Subdivision' ? 's' : h[1] === 'Schedule' ? 's' : 's');
    if (headings[kind] !== undefined) headings[kind]++;
  }

  // The same two column trap as the cover, one page further in. Some reprints set the provision
  // number in one column and its heading in another, and the two columns are half a row apart, so
  // every number renders against the heading of the provision below it. Reading that line by line
  // does not produce a partial answer, it produces a confident wrong one: on the Imperial Acts
  // Application Act 1984 it gives "2 Short title and citation" when section 1 is the short title
  // and section 2 binds the Crown. The signal is the orphan: a line holding a provision number and
  // nothing else. Where that happens this function publishes no provision numbers at all and says
  // why, and `extract` falls back to the headings printed in the body of the Act itself.
  const offsetContents = orphanNumbers >= 3 && orphanNumbers >= entries;

  // Schedules are counted from where they actually begin, not from the contents.
  //
  // A schedule is the last thing an Act lists and the contents entry for one often wraps onto a
  // second line, so the page it sits on can fall below the leader density that marks the end of the
  // contents and drop out of the region entirely. The Australian Human Rights Commission Act 1986
  // came back as having no schedules while carrying five, one of which is the whole text of a
  // treaty this pack cites. A schedule announces itself on the page where it starts, so that is
  // where this counts them: a short line beginning with the word and its number, taken as a set so
  // a running header repeated on ninety pages counts once.
  const scheduleIds = new Set();
  for (const p of pages) {
    for (const rawLine of p.split('\n')) {
      const l = tidy(rawLine);
      if (!l || l.length > 80) continue;
      // The number has to end the line or be followed by the dash that opens a heading. Without
      // that, "Schedule 1 to that Act" in a cross reference and a row of an endnote table both
      // count, and the Income Tax Assessment Act 1997 comes back with fourteen schedules it does
      // not have. A heading stands alone; a mention sits inside a sentence.
      const m = /^Schedules?\s+([0-9]{1,3}[A-Z]{0,2})(?:--|\s*$)/.exec(l);
      if (m) scheduleIds.add(m[1]);
    }
  }

  return {
    pages: pages.length,
    schedule_ids: [...scheduleIds],
    contents_pages: [start + 1, end + 1],
    contents_layout: offsetContents ? 'offset-columns' : 'inline',
    contents_entries: offsetContents ? null : entries,
    distinct_provision_numbers: offsetContents ? null : provisions.size,
    provision_numbers: offsetContents ? [] : [...provisions],
    orphan_numbers: orphanNumbers,
    body_headings: bodyHeadings(pages, start, end),
    structure: headings
  };
}

/** A contents line holding a provision number and nothing else, which is the two column tell. */
const ORPHAN_NUMBER = /^[0-9]{1,4}[A-Z]{0,3}$/;

/**
 * The provision headings printed in the body of the Act, as a second and stronger way to confirm a
 * section number than its table of contents.
 *
 * A contents entry is a number, dot leaders and a page. A body heading is the number and the
 * heading standing over the provision itself, which is the thing a reader lands on when they follow
 * the citation. `extract` accepts a catalogue's section number when the contents carries it, or
 * when a body heading carries it AND the heading text matches the label the catalogue wrote. The
 * second condition is what makes this safe: a date such as "1 January" would otherwise look like a
 * heading, and no label will ever match it.
 */
function bodyHeadings(pages, contentsStart, contentsEnd) {
  const out = [];
  const seen = new Set();
  for (let p = 0; p < pages.length; p++) {
    if (p >= contentsStart && p <= contentsEnd) continue;
    for (const rawLine of pages[p].split('\n')) {
      const l = tidy(rawLine);
      if (!l || LEADER.test(l)) continue;
      const m = /^([0-9]{1,4}[A-Z]{0,3})\s+([A-Z][A-Za-z][^.]{2,88})$/.exec(l);
      if (!m) continue;
      const key = `${m[1]}|${m[2].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref: m[1], heading: m[2].trim() });
    }
  }
  return out;
}

/**
 * The cover page facts: the title as printed, and the line that says how current the print is.
 *
 * THE TWO COLUMN TRAP, WHICH THIS FUNCTION EXISTS TO SURVIVE. A Federal Register cover sets the
 * labels in one column and their values in another, and on the older covers the value column sits
 * half a line higher than the labels, so every value renders on the row of the label above it. The
 * Constitution's cover comes out of pdftotext like this, and reading it line by line gives
 * "Compilation date: 18 November 2021" when the register's own metadata says the current version
 * started on 29 July 1977 and 18 November 2021 is when the entry was registered. The first pass of
 * this lane published that mis-read as a quote at high confidence, which overstated how current the
 * text of the Constitution is by forty-four years.
 *
 * So a label that renders with nothing after it is the signal, not a fact. When every label on the
 * cover is empty, the values are collected out of the value column in the order they appear and
 * paired with the labels in the order they appear. The result is checked a second time against the
 * register's own version metadata in `extract`, and where the two disagree the register wins and
 * the record says so.
 */
export function readCover(page) {
  // A carriage return is a line terminator to a JavaScript regular expression, so an end anchor
  // never matches on a CRLF file and a column read silently finds nothing. Strip it once, here.
  const raw = page.split('\n').map((l) => l.replace(/\r+$/, ''));
  const lines = raw.map((l) => tidy(l)).filter(Boolean);
  const joined = lines.join(' ');

  const LABEL = /^(Compilation date|Includes amendments up to|Includes amendments|Registered|Prepared by|Current as at|Reprinted as in force)\b\s*:?\s*(.*)$/;
  const labelled = [];
  for (const l of lines) {
    const m = LABEL.exec(l);
    if (m) labelled.push({ label: m[1], value: m[2].trim(), line: l });
  }
  // A cover in one column never leaves a label standing empty. Two or more of these labels with at
  // least one of them empty is the two column layout, and nothing on it may be read line by line.
  const pairing = labelled.filter((x) => /^(Compilation date|Includes amendments up to|Registered)$/.test(x.label));
  const offset = pairing.length >= 2 && pairing.some((x) => !x.value);

  let currency = lines.find((l) => /^Current as at /.test(l))
    || lines.find((l) => /^Compilation date:/.test(l))
    || lines.find((l) => /^Reprinted as in force/.test(l))
    || null;
  let compilation = lines.find((l) => /^Compilation No\./.test(l)) || null;
  let includes = lines.find((l) => /^Includes amendments/.test(l)) || null;
  let registered = lines.find((l) => /^Registered:/.test(l)) || null;

  if (offset) {
    // The value column starts where the compilation number line carries trailing text. Everything
    // in that column, from that row down to the end of the block, is a value in document order.
    const start = raw.findIndex((l) => /^\s*Compilation No\./.test(l));
    const values = [];
    let col = -1;
    if (start >= 0) {
      const head = /^(\s*Compilation No\.\s+\S+\s{2,})(\S.*)$/.exec(raw[start]);
      if (head) { col = head[1].length; values.push(tidy(head[2])); compilation = tidy(raw[start].slice(0, head[1].length)); }
    }
    if (col > 0) {
      for (let i = start + 1; i < raw.length; i++) {
        const l = raw[i].replace(/\s+$/, '');
        if (/^\s*Prepared by\b/.test(l)) break;
        if (l.length <= col) continue;
        const tail = tidy(l.slice(col));
        if (tail) values.push(tail);
      }
      const labels = pairing.map((x) => x.label);
      // Fewer values than labels means the column was not read cleanly, and a partial pairing is
      // how the first mis-read happened. Leave the line by line reading alone and say so instead.
      if (values.length >= labels.length) {
        const paired = new Map();
        for (let i = 0; i < labels.length; i++) paired.set(labels[i], values[i]);
        if (paired.has('Compilation date')) currency = `Compilation date: ${paired.get('Compilation date')}`;
        if (paired.has('Includes amendments up to')) includes = `Includes amendments up to: ${paired.get('Includes amendments up to')}`;
        if (paired.has('Registered')) registered = `Registered: ${paired.get('Registered')}`;
        return { lines, joined, currency, compilation, includes, registered, layout: 'offset-columns' };
      }
      return { lines, joined, currency, compilation, includes, registered, layout: 'offset-columns-unread' };
    }
    return { lines, joined, currency, compilation, includes, registered, layout: 'offset-columns-unread' };
  }

  return { lines, joined, currency, compilation, includes, registered, layout: 'inline' };
}

/**
 * Measure everything that was fetched, and refuse to measure anything that was not.
 *
 * The title check is the important part. A register identifier is four digits and a number and it
 * is easy to be one out, and being one out serves a real Act with a real cover and a real page
 * count, so every measurement here is thrown away unless the document's own first page names the
 * Act the catalogue asked for.
 */
export function measureAll() {
  const cat = loadCatalogue();
  const got = new Map((fetched().instruments || []).map((r) => [r.id, r]));
  const rows = [];
  for (const e of cat.instruments) {
    const f = got.get(e.id);
    if (!f || !f.files || !f.files.length) {
      rows.push({ id: e.id, measured: false, why: f && f.failure ? f.failure : 'nothing was fetched for it' });
      continue;
    }
    let pages = 0;
    let entries = 0;
    let countable = true;
    let contentsLayout = 'inline';
    const allProvisions = new Set();
    const allSchedules = new Set();
    const bodyHeads = [];
    const structure = { chapters: 0, parts: 0, divisions: 0, subdivisions: 0, schedules: 0 };
    let cover = null;
    let titleOk = false;
    const per = [];
    for (const file of f.files) {
      const full = abs(file.file);
      if (!fs.existsSync(full)) { rows.push({ id: e.id, measured: false, why: `${file.file} is not on disk` }); per.length = 0; break; }
      const p = pdfPages(full);
      const m = measureDocument(p);
      const c = readCover(p[0] || '');
      if (!cover) cover = c;
      if (tidy(c.joined).toLowerCase().includes(tidy(e.short_title).toLowerCase())) titleOk = true;
      pages += m.pages;
      if (m.contents_layout !== 'inline') { countable = false; contentsLayout = m.contents_layout; }
      else entries += m.contents_entries;
      for (const n of m.provision_numbers) allProvisions.add(n);
      for (const h of m.body_headings) bodyHeads.push(h);
      for (const k of Object.keys(structure)) structure[k] += m.structure[k];
      for (const s of m.schedule_ids || []) allSchedules.add(s);
      per.push({ volume: file.volume, pages: m.pages, contents_entries: m.contents_entries, contents_pages: m.contents_pages });
    }
    // Schedules are the one part of the structure that is counted as a set rather than a sum,
    // because a compilation split into twelve volumes prints "Schedule 1" in every volume that
    // touches it, and adding those up says an Act has twenty-seven schedules when it has one.
    // Where an Act numbers its schedules the set answers it; where it has a single unnumbered
    // Schedule, as the Sex Discrimination Act 1984 does, the set is empty and the contents count
    // stands.
    if (allSchedules.size) structure.schedules = allSchedules.size;
    const distinct = allProvisions.size;
    if (!per.length) continue;
    if (!titleOk) {
      rows.push({
        id: e.id, measured: false,
        why: `the downloaded document does not name "${e.short_title}" on its cover, so the identifier `
          + `${e.register_id} may be serving a different Act. Nothing was recorded.`
      });
      continue;
    }
    // A contents nobody could count is a different thing from a contents nobody could find. The
    // first is a layout this lane refuses to guess at and says so on the record; the second means
    // the document is not what it was taken for, and nothing is recorded from it.
    if (countable && entries < 5) {
      rows.push({
        id: e.id, measured: false,
        why: `only ${entries} contents entries were found, which means the contents was not located `
          + 'in this document and any count taken from it would be wrong.'
      });
      continue;
    }
    if (!countable && !bodyHeads.length) {
      rows.push({
        id: e.id, measured: false,
        why: 'the contents of this reprint is set in two columns that cannot be paired, and no '
          + 'provision heading was found in the body either, so there is nothing here to count.'
      });
      continue;
    }
    rows.push({
      id: e.id,
      measured: true,
      volumes: f.files.length,
      pages,
      contents_layout: contentsLayout,
      contents_entries: countable ? entries : null,
      distinct_provision_numbers: countable ? distinct : null,
      not_counted_why: countable ? null
        : "the contents of this reprint sets the provision number and its heading in two columns "
          + 'half a row apart, so a line by line read pairs every number with the wrong heading. '
          + 'Rather than publish a count taken from that, this record publishes pages only and the '
          + "section numbers it names were confirmed against the headings printed in the Act's body.",
      body_headings: bodyHeads,
      structure,
      cover_layout: cover.layout,
      currency_line: cover.currency,
      compilation_line: cover.compilation,
      includes_line: cover.includes,
      registered_line: cover.registered || null,
      bytes: f.files.reduce((a, x) => a + x.bytes, 0),
      sha256: f.files.map((x) => ({ volume: x.volume, sha256: x.sha256 })),
      per_volume: per,
      provision_numbers: [...allProvisions].sort()
    });
  }
  const file = `${INBOX}/measured.json`;
  fs.writeFileSync(abs(file), JSON.stringify({ measured_at: today(), extractor: EXTRACTOR, instruments: rows }, null, 1) + '\n', 'utf8');
  return { file, rows };
}

export function measured() {
  const file = `${INBOX}/measured.json`;
  if (!exists(file)) throw new Error(`${file} is not there. Run --measure first.`);
  return readJSON(file);
}

// ---------------------------------------------------------------------------------------------
// Judgments
// ---------------------------------------------------------------------------------------------

/**
 * The edges of the corpus need judgments, and a judgment is the easiest thing in this pack to get
 * wrong from memory.
 *
 * A person arriving at this twin holding a form they were told makes a difference has usually been
 * given a case name as well, and half of those case names are misremembered, misattributed or from
 * another country. So this lane will not carry a judgment on the strength of anybody's recall,
 * including its own. Every judgment in the catalogue names a published source, and this step
 * fetches it and refuses the record unless three separate things hold.
 *
 * TWO DOCUMENTS, BECAUSE THEY CARRY DIFFERENT FACTS. The case page carries the name and the medium
 * neutral citation, which is what a reader needs to find the case again, and it does not carry the
 * reasons. The authorised PDF carries the reasons, which is where a quote has to come from, and an
 * older one carries neither the name in the form a reporter would write it nor the medium neutral
 * citation, because those were assigned to a transcript that prints its file number instead. So the
 * name and the citation are checked against the page, the quote is checked against the PDF, and the
 * PDF is checked to be the right document by requiring every party name in the case name to appear
 * in it. Checking the quote against the page would pass every judgment in this pack, because the
 * page does not contain the reasons at all, and a check that cannot fail is not a check.
 *
 * WHERE THE TEXT COMES FROM AND WHY. Queensland judgments are read from Queensland Judgments,
 * which is published by the Incorporated Council of Law Reporting for the State of Queensland with
 * the Supreme Court of Queensland Library Committee. The obvious alternative refuses automated
 * readers in terms, and being refused is an answer: this lane goes elsewhere rather than around.
 * Nothing is republished. The cached text lands in ingest-inbox, which is not committed, and its
 * sha256 is recorded so a quote can be shown to have come from a specific retrieval.
 */
export async function verifyJudgments({ force = false } = {}) {
  const cat = loadCatalogue();
  const list = cat.judgments || [];
  ensureDir(`${INBOX}/judgments`);
  const rows = [];
  for (const j of list) {
    const pageFile = `${INBOX}/judgments/${j.id}.page`;
    const pdfFile = `${INBOX}/judgments/${j.id}.pdf`;
    const textFile = `${INBOX}/judgments/${j.id}.judgment`;
    const fail = (why) => rows.push({ id: j.id, verified: false, why });

    // The case page: the name and the citation.
    let page = '';
    let fetchedNow = false;
    if (!force && exists(pageFile)) {
      page = readText(pageFile);
    } else {
      try {
        const res = await fetch(j.source_url, { redirect: 'follow', headers: { 'user-agent': UA } });
        if (!res.ok) { fail(`the case page returned ${res.status}`); continue; }
        page = plainText(await res.text());
        fs.writeFileSync(abs(pageFile), page, 'utf8');
        fetchedNow = true;
      } catch (err) { fail(`the case page could not be reached: ${err.message}`); continue; }
    }

    // The judgment itself, as the publisher serves it, and then as words.
    const docUrl = j.document_url || `${String(j.source_url).replace(/\/$/, '')}/pdf`;
    let text = '';
    if (!force && exists(textFile)) {
      text = readText(textFile);
    } else {
      try {
        const res = await fetch(docUrl, { redirect: 'follow', headers: { 'user-agent': UA } });
        if (!res.ok) { fail(`the judgment returned ${res.status}`); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 4).toString('latin1') !== '%PDF') { fail('the judgment did not come back as a PDF'); continue; }
        fs.writeFileSync(abs(pdfFile), buf);
        text = pdfPages(abs(pdfFile)).join('\n');
        fs.writeFileSync(abs(textFile), text, 'utf8');
        fetchedNow = true;
      } catch (err) { fail(`the judgment could not be read: ${err.message}`); continue; }
    }

    const onPage = tidy(page);
    const inJudgment = tidy(text);
    const nameOk = onPage.includes(tidy(j.case_name)) || onPage.includes(tidy(j.reported_as || '~none~'));
    const citeOk = onPage.includes(tidy(j.citation));
    // Is this PDF the case the page is about? Every party name of four letters or more has to be in
    // it. That is what stops a correct-looking path serving a real judgment in some other matter.
    const parties = String(j.case_name).split(/\bv\b/).map((s) => s.trim().split(/\s+/).pop() || '')
      .filter((w) => w.length >= 4);
    const missing = parties.filter((w) => !new RegExp(w.replace(/[^A-Za-z]/g, ''), 'i').test(inJudgment));
    const quoteAt = inJudgment.indexOf(tidy(j.quote));
    const ok = Boolean(nameOk && citeOk && !missing.length && quoteAt >= 0);
    rows.push({
      id: j.id,
      verified: ok,
      case_name_found: nameOk,
      citation_found: citeOk,
      parties_in_judgment: !missing.length,
      quote_found: quoteAt >= 0,
      quote_at: quoteAt >= 0 ? quoteAt : null,
      characters: text.length,
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      page_sha256: crypto.createHash('sha256').update(page).digest('hex'),
      page_file: pageFile,
      file: textFile,
      document_url: docUrl,
      fetched: fetchedNow,
      why: ok ? '' : [
        nameOk ? null : `the case page does not carry the case name "${j.case_name}"`,
        citeOk ? null : `the case page does not carry the citation "${j.citation}"`,
        missing.length ? `the judgment does not name ${missing.join(' or ')}, so it may not be this case` : null,
        quoteAt >= 0 ? null : 'the judgment does not carry the quote character for character'
      ].filter(Boolean).join('; ')
    });
  }
  const file = `${INBOX}/judgments.json`;
  fs.writeFileSync(abs(file), JSON.stringify({ verified_at: today(), extractor: EXTRACTOR, judgments: rows }, null, 1) + '\n', 'utf8');
  return { file, rows };
}

/**
 * The same rule, applied to the edges themselves.
 *
 * An edge record carries a quote like every other record in this pack, and the quote is the reason
 * a reader should believe the sentence next to it. Three of these quotes come out of an Act and two
 * out of a judgment, and both kinds are already on disk: the consolidations from --fetch, the
 * judgments from --judgments. So there is no excuse for an unchecked one, and `extract` refuses an
 * edge whose quote it cannot find rather than publishing the edge without it.
 */
export function verifyEdgeQuotes() {
  const cat = loadCatalogue();
  const byRegister = new Map(cat.instruments.map((e) => [e.register_id, e]));
  const got = new Map((exists(`${INBOX}/fetched.json`) ? fetched().instruments || [] : []).map((r) => [r.id, r]));
  const judgments = new Map((cat.judgments || []).map((j) => [j.source, j]));
  const cache = new Map();

  /** The words of a document, whichever kind it is, read once per run. */
  const wordsOf = (source) => {
    if (cache.has(source)) return cache.get(source);
    let out = null;
    const [kind, ref] = String(source).split(/:(.*)/);
    if (kind === 'oqpc' || kind === 'frl') {
      const inst = byRegister.get(ref);
      const f = inst ? got.get(inst.id) : null;
      if (f && !f.failure) {
        let all = '';
        for (const vol of f.files || []) {
          if (!exists(vol.file)) continue;
          all += pdfPages(abs(vol.file)).join('\n') + '\n';
        }
        out = all ? { text: tidy(all), where: `the consolidation of ${ref} as downloaded` } : null;
      }
    } else if (kind === 'qj') {
      const j = judgments.get(source);
      const file = j ? `${INBOX}/judgments/${j.id}.judgment` : null;
      if (file && exists(file)) out = { text: tidy(readText(file)), where: `the judgment at ${j.source_url}` };
    }
    cache.set(source, out);
    return out;
  };

  const rows = [];
  for (const e of cat.edges || []) {
    const doc = wordsOf(e.source);
    if (!doc) {
      rows.push({ id: e.id, verified: false, why: `nothing on this machine answers to the source "${e.source}". `
        + 'Run --fetch and --judgments first.' });
      continue;
    }
    const found = doc.text.includes(tidy(e.quote));
    rows.push({
      id: e.id,
      verified: found,
      source: e.source,
      checked_against: doc.where,
      why: found ? '' : 'the document does not carry the quote character for character'
    });
  }
  const file = `${INBOX}/edges.json`;
  fs.writeFileSync(abs(file), JSON.stringify({ verified_at: today(), extractor: EXTRACTOR, edges: rows }, null, 1) + '\n', 'utf8');
  return { file, rows };
}

export function edgeChecks() {
  const file = `${INBOX}/edges.json`;
  if (!exists(file)) return null;
  return readJSON(file);
}

export function judgmentChecks() {
  const file = `${INBOX}/judgments.json`;
  if (!exists(file)) return null;
  return readJSON(file);
}

const UA = 'minjerribah-living-twin ingest (one page per judgment, offline afterwards)';

/** A served page as the words on it, with the markup and the scripts taken out. */
function plainText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;|&lsquo;|&#146;|&#145;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#147;|&#148;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

/**
 * Join the hand-written catalogue to the measurements and write candidates.
 *
 * A candidate keeps its `needs` note, which promotion refuses to accept, unless the catalogue
 * entry carries a `reviewed` block. That block is written by hand, per instrument, in a committed
 * file, and nothing in this lane can add one. So the reviewed state is a record of somebody
 * reading the Act's contents and writing what it does, and it is auditable line by line in git.
 */
/**
 * How current the consolidation is, read twice: off the cover, and out of the register's metadata.
 *
 * Both are recorded. Where they agree the record says so, which is worth more than either on its
 * own. Where they disagree the register is taken, the cover reading is kept beside it, and the
 * confidence on that record drops to medium, because a reader who follows the citation will see the
 * cover and has to be told which of the two this pack believes and why.
 */
export function readCurrency(m, r) {
  const cover = m.currency_line || m.compilation_line || null;
  const coverDate = cover ? (/(\d{1,2} [A-Z][a-z]+ \d{4})/.exec(cover) || [])[1] || null : null;
  const version = r && r.current_version ? r.current_version : null;
  const registerDate = version ? longDate(version.start) : null;
  if (!registerDate) {
    return { quote: cover, line: cover, from: 'the cover page of the consolidation', agreed: null, note: '', confidence: null };
  }
  const agreed = Boolean(coverDate && coverDate === registerDate);
  if (agreed) {
    return {
      quote: cover,
      line: cover,
      from: "the cover page of the consolidation, and the register's own version metadata agrees",
      agreed: true,
      note: `The Federal Register gives the current version of this title as compilation `
        + `${version.compilation_number} starting ${registerDate}, which is what the cover says.`,
      confidence: null
    };
  }
  return {
    quote: cover,
    line: `Compilation date: ${registerDate}`,
    from: "the register's own version metadata, because the cover page disagrees with it",
    agreed: false,
    note: `The cover of this consolidation reads "${cover}". The Federal Register's metadata for the `
      + `same title gives the current version as compilation ${version.compilation_number} starting `
      + `${registerDate}${version.registered_at ? `, registered ${longDate(version.registered_at)}` : ''}. `
      + 'This record takes the register and keeps the cover reading here, because the two do not agree '
      + 'and a reader who opens the document will see the cover.',
    confidence: 'medium'
  };
}

/** Does a heading printed in the Act say the same thing as the label the catalogue wrote? */
function headingMatches(heading, label) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(heading);
  const b = norm(label);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 8 && longer.startsWith(shorter);
}

export function extract({ batch }) {
  const cat = loadCatalogue();
  const res = new Map((resolution().instruments || []).map((r) => [r.id, r]));
  const meas = new Map((measured().instruments || []).map((r) => [r.id, r]));
  const stamp = today();
  const candidates = [];
  const refused = [];
  const dropped = [];

  for (const e of cat.instruments) {
    const r = res.get(e.id);
    const m = meas.get(e.id);
    const reg = REGISTERS[e.jurisdiction];
    // These carry `instrument` rather than `id` on purpose. Anything with an id sitting in an array
    // inside a pack is a record to the gate, and a note about something that is not in the pack is
    // not a record and must not be held to the record envelope.
    if (!r || !r.resolved) {
      refused.push({ instrument: e.id, short_title: e.short_title, why: r ? r.note : 'it was never resolved against a register' });
      continue;
    }
    if (!m || !m.measured) {
      refused.push({ instrument: e.id, short_title: e.short_title, why: m ? m.why : 'it was never measured' });
      continue;
    }
    // How current the print is, from the cover and from the register, and what to do when the two
    // do not agree. The register wins, because it is structured data rather than a typeset page,
    // and the disagreement goes on the record instead of being resolved out of sight.
    const currency = readCurrency(m, r);
    const quote = currency.quote;
    const administered = e.jurisdiction === 'Commonwealth'
      ? r.administering_departments
      : null;

    // Never fabricate a section. Every provision the catalogue names by number is checked against
    // the set this lane read out of the Act's own contents, and one that is not there is dropped
    // and printed rather than published. A wrong section number in a civic explainer is worse than
    // no section number, because the reader has no way to tell.
    //
    // There is a second channel and it is narrower on purpose. Where a reprint sets its contents in
    // two columns this lane will not read it at all, so a number can still be confirmed against the
    // heading printed over the provision in the body, but only when the heading text also matches
    // the label the catalogue wrote. A number alone would let a date in the body stand in for a
    // section; a number and its own words together will not.
    const known = new Set(m.provision_numbers || []);
    const heads = m.body_headings || [];
    const keyProvisions = [];
    for (const kp of e.key_provisions || []) {
      const ref = String(kp.ref);
      if (known.has(ref)) {
        keyProvisions.push({ ref: kp.ref, label: kp.label, kind: kp.kind || 'section', confirmed_from: "the Act's own table of contents" });
        continue;
      }
      const head = heads.find((h) => h.ref === ref && headingMatches(h.heading, kp.label));
      if (head) {
        keyProvisions.push({
          ref: kp.ref, label: kp.label, kind: kp.kind || 'section',
          confirmed_from: `the heading printed over the provision in the Act itself, which reads "${head.ref} ${head.heading}"`
        });
        continue;
      }
      dropped.push({
        instrument: e.id, ref: kp.ref, label: kp.label,
        why: "the lane could not find this number in the Act's own contents, and no heading in the "
          + 'body of the Act carries that number with a matching label either, so it was not published. '
          + 'That means unconfirmed rather than wrong: a contents entry whose title wraps can be missed. '
          + 'The check is deliberately conservative, because a section number a reader cannot check is '
          + 'worse than no section number.'
      });
    }

    const record = {
      id: e.id,
      short_title: e.short_title,
      citation: e.citation,
      jurisdiction: e.jurisdiction,
      year: e.year !== undefined ? e.year : (r.register_year ? Number(r.register_year) : null),
      act_number: r.register_number !== undefined && r.register_number !== null ? String(r.register_number) : null,
      register: {
        site: reg.label,
        publisher: reg.publisher,
        id: e.register_id,
        title_as_registered: r.register_title,
        deep_link: reg.deepLink(e.register_id)
      },
      in_force: true,
      currency: currency.line,
      currency_from: currency.from,
      currency_note: currency.note,
      compilation: m.compilation_line || null,
      includes_amendments: m.includes_line || null,
      registered: m.registered_line || null,
      cover_layout: m.cover_layout || 'inline',
      cover_layout_note: m.cover_layout === 'offset-columns'
        ? 'The cover of this consolidation sets its labels in one column and their values in another, '
          + 'and the value column sits one row higher than the labels, so a line by line read pairs '
          + 'every value with the wrong label. The columns were read as columns to produce this record.'
        : '',
      administered_by: administered,
      administered_by_note: administered
        ? 'Taken from the Federal Register of Legislation, which publishes the administering department for every title.'
        : 'Queensland does not publish an administering department on its legislation register, and the current '
          + 'Administrative Arrangements Order is a Premier and Cabinet publication that was not obtained for this pack. '
          + 'Rather than guess a department, this record names none.',
      size: {
        pages: m.pages,
        volumes: m.volumes,
        contents_entries: m.contents_entries,
        distinct_provision_numbers: m.distinct_provision_numbers,
        chapters: m.structure.chapters,
        parts: m.structure.parts,
        divisions: m.structure.divisions,
        schedules: m.structure.schedules,
        measured_from: m.sha256.map((s) => (s.volume ? `volume ${s.volume} ` : '') + `sha256 ${s.sha256.slice(0, 16)}`),
        contents_layout: m.contents_layout || 'inline',
        not_counted_why: m.not_counted_why || null,
        method: m.contents_entries === null
          ? 'Pages counted from the published consolidation and exact. Nothing else was counted: see '
            + 'not_counted_why on this record.'
          : 'Pages counted from the published consolidation and exact. Entries and headings counted '
            + "from the consolidation's own table of contents, which lists each provision once, and close "
            + 'rather than exact. See method.accuracy_note at the top of this pack.'
      },
      what_it_does: e.plain_english,
      parts_that_bear_on_a_person: e.touches || [],
      key_provisions: keyProvisions,
      key_provisions_note: keyProvisions.length
        ? "Every provision number here was found in the consolidation this record was measured from, "
          + "either in the Act's own table of contents or in the heading printed over the provision "
          + 'itself, and each one says which. Any the lane could not find was dropped rather than '
          + 'published, and the dropped ones are listed in the pack under provisions_not_confirmed.'
        : 'None recorded. This record describes the Act by topic rather than by section number.',
      bearing: e.bearing,
      bearing_reason: e.bearing_reason || '',
      life_events: e.life_events,
      why_listed: e.why_listed || '',
      island_link: e.island_link || '',
      not_advice: 'This is a description of published law, not advice. A person\'s actual position '
        + 'depends on facts this twin does not know.',
      source: `${reg.id}:${e.register_id}`,
      locator: `cover page of the current consolidation, ${e.register_id}`,
      quote,
      confidence: currency.confidence || e.confidence || 'high',
      status: 'committed',
      asserts: 'real_world',
      extracted_at: stamp,
      extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`
    };
    if (!e.reviewed) {
      record.needs = 'A person reads the Act\'s contents, writes what it does in plain English, says which '
        + 'of its parts bear on an ordinary person, and records that in the catalogue as a reviewed block. '
        + 'Until then this is a measurement with no meaning attached.';
    } else {
      record.reviewed_by = e.reviewed.by;
      record.reviewed_on = e.reviewed.on;
      record.reviewed_note = e.reviewed.note || '';
    }
    candidates.push(record);
  }

  const edgeWork = buildEdges(cat, stamp, new Set(candidates.map((c) => c.id)));

  ensureDir(CANDIDATES);
  const out = `${CANDIDATES}/legislation-${batch}.json`;
  fs.writeFileSync(abs(out), JSON.stringify({
    kind: 'ingest-candidates',
    lane: 'legislation',
    schema: 'minjerribah-candidates/1',
    batch,
    extractor: EXTRACTOR,
    extracted_at: stamp,
    note: 'Structure and size measured from the published consolidations. Descriptions written by hand '
      + 'against the same documents. Nothing here is legal advice.',
    pack_header: packHeader(cat, refused, candidates, dropped, edgeWork),
    candidates
  }, null, 1) + '\n', 'utf8');
  return {
    file: out, candidates, refused, dropped,
    edges: edgeWork.edges,
    edgesRefused: edgeWork.edgesRefused,
    judgments: edgeWork.judgments,
    judgmentsRefused: edgeWork.refused
  };
}

/**
 * The edges of the corpus: the four situations where a thing looks like law here and is not, or is
 * law here but not in the way it is usually described.
 *
 * These are the records this pack exists for as much as the Acts are. A person who arrives holding
 * a copy of Magna Carta and a United States financing statement is not helped by a list of
 * sixty-six Queensland and Commonwealth Acts that says nothing about either. Four types, and the
 * type is the work:
 *
 *   partially_in_force     Old imperial law that a Queensland Act keeps alive, named chapter by
 *                          chapter, with the Act and the schedule that does it.
 *   foreign_domestic       An instrument of another country's law, with the Australian instrument
 *                          that does the same job named beside it.
 *   treaty_unincorporated  A treaty Australia has ratified that is not part of domestic law until
 *                          a parliament passes something.
 *   asserted_rejected      A chain of reasoning a person may have been given, and what an
 *                          Australian court actually held about it, stated flatly and with the
 *                          judgment cited so the reader can go and read it.
 *
 * Every judgment named here has been fetched from its publisher and checked: the page must carry
 * the case name, the citation and the quote, character for character, or the judgment does not go
 * in and the edge that leaned on it says which support it lost.
 */
function buildEdges(cat, stamp, instrumentIds) {
  const checks = new Map(((judgmentChecks() || {}).judgments || []).map((j) => [j.id, j]));
  const judgments = [];
  const refused = [];
  const edgesRefused = [];
  for (const j of cat.judgments || []) {
    const c = checks.get(j.id);
    if (!c || !c.verified) {
      refused.push({
        judgment: j.id,
        case_name: j.case_name,
        citation: j.citation,
        why: c ? c.why : 'it was never checked against its published source. Run --judgments.'
      });
      continue;
    }
    judgments.push({
      id: j.id,
      case_name: j.case_name,
      citation: j.citation,
      court: j.court,
      decided: j.decided,
      bench: j.bench,
      what_was_argued: j.what_was_argued,
      what_was_held: j.what_was_held,
      why_it_is_here: j.why_it_is_here || '',
      island_link: j.island_link || '',
      not_advice: NOT_ADVICE_LINE,
      neutral_note: 'This record states what a court decided. It does not describe the person who ran '
        + 'the argument, and nothing here is a view about them.',
      source: j.source,
      source_url: j.source_url,
      locator: j.locator,
      quote: j.quote,
      verified_against: `sha256 ${String(c.sha256).slice(0, 16)} of the judgment as retrieved, with the case `
        + `name and the citation read off the case page at sha256 ${String(c.page_sha256 || '').slice(0, 16)}`,
      confidence: 'high',
      status: 'committed',
      asserts: 'real_world',
      extracted_at: stamp,
      extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
      reviewed_by: j.reviewed ? j.reviewed.by : '',
      reviewed_on: j.reviewed ? j.reviewed.on : ''
    });
  }
  const have = new Set(judgments.map((j) => j.id));
  const quoteChecks = new Map(((edgeChecks() || {}).edges || []).map((r) => [r.id, r]));
  const edges = [];
  for (const e of cat.edges || []) {
    const q = quoteChecks.get(e.id);
    if (!q || !q.verified) {
      edgesRefused.push({
        edge: e.id,
        title: e.title,
        why: q ? q.why : 'its quote was never checked against the document it came from. Run --edges.'
      });
      continue;
    }
    const kept = (e.judgments || []).filter((id) => have.has(id));
    const lost = (e.judgments || []).filter((id) => !have.has(id));
    edges.push({
      id: e.id,
      type: e.type,
      title: e.title,
      citation: e.citation || '',
      jurisdiction: e.jurisdiction || '',
      what_it_is: e.what_it_is,
      how_it_stands_here: e.how_it_stands_here,
      what_people_are_told: e.what_people_are_told || '',
      what_a_court_held: e.what_a_court_held || '',
      mechanism: e.mechanism || '',
      instruments: (e.instruments || []).filter((id) => instrumentIds.has(id)),
      instruments_not_in_pack: (e.instruments || []).filter((id) => !instrumentIds.has(id)),
      judgments: kept,
      judgments_not_verified: lost,
      what_to_do_with_it: e.what_to_do_with_it || '',
      not_advice: NOT_ADVICE_LINE,
      source: e.source,
      locator: e.locator,
      quote: e.quote,
      confidence: e.confidence || 'high',
      status: 'committed',
      asserts: 'real_world',
      extracted_at: stamp,
      extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
      reviewed_by: e.reviewed ? e.reviewed.by : '',
      reviewed_on: e.reviewed ? e.reviewed.on : ''
    });
  }
  return { edges, judgments, refused, edgesRefused };
}

const NOT_ADVICE_LINE = 'This is a description of published law, not advice. A person\'s actual '
  + 'position depends on facts this twin does not know.';

/** The top-level fields data/legislation.json has to carry, which promotion copies in on creation. */
function packHeader(cat, refused, candidates, dropped, edgeWork) {
  return {
    version: '1.0.0',
    island: 'Minjerribah / North Stradbroke Island, Quandamooka Country, Queensland',
    about: cat.about,
    not_advice: {
      line: 'This is a description of published law, not advice. A person\'s actual position depends on '
        + 'facts this twin does not know.',
      where_it_must_show: 'On every screen that names an instrument, beside the citation, not behind a '
        + 'menu and not in a footer a reader can scroll past.',
      why: 'A twin that lists Acts and says what they do is one small step from a reader treating it as '
        + 'a view about their own situation. It is civic education built from primary sources and it is '
        + 'nothing else.'
    },
    method: {
      what_is_measured: 'Pages, volumes, contents entries, distinct provision numbers, chapters, parts, '
        + 'divisions and schedules, all taken from the published consolidation itself.',
      what_is_written: 'The plain-English description, the parts that bear on an ordinary person, the '
        + 'bearing and the life events. These are judgements written against the same documents and they '
        + 'are marked as judgements.',
      what_is_not_here: 'The text of any Act. The consolidations run to tens of thousands of pages, they '
        + 'belong to their publishers, and the licence position differs between the two registers. This '
        + 'pack records the citation, the structure, the size, the description and a deep link.',
      counting_note: 'Contents entries and distinct provision numbers answer different questions. An Act '
        + 'that restarts its numbering, as the Constitution does between its covering clauses and its '
        + 'sections, has more entries than distinct numbers. Neither is presented as the other.',
      accuracy_note: 'The page counts are exact. The provision counts are close rather than exact: a '
        + 'contents entry whose title wraps onto a second line can be missed, and an Act that numbers '
        + 'items inside a schedule has those counted too. On the Constitution the method finds 132 of '
        + 'the 137 provisions it lists, which is the size of the error to expect. Nothing here should '
        + 'be quoted as the number of sections in an Act; it is a measure of how much there is to read.',
      registers: Object.fromEntries(Object.entries(REGISTERS).map(([k, v]) => [k, {
        label: v.label, publisher: v.publisher, licence_note: v.licence_note
      }]))
    },
    confidence_scale: {
      high: 'The register serves this instrument under this identifier, the downloaded consolidation '
        + 'names it on its cover, and the size was counted from that file.',
      medium: 'The instrument is verified but something recorded about it involves a judgement that a '
        + 'reader might reasonably make differently.',
      low: 'Not verified. Nothing in this pack sits here; an instrument that could not be verified is in '
        + 'not_verified rather than in the list.'
    },
    bearing_scale: cat.bearing_scale,
    life_events: cat.life_events,
    coverage: {
      catalogued: cat.instruments.length,
      recorded: candidates.length,
      not_verified: refused.length,
      note: 'The 2013 read that this pack answers reached somewhere between fifty-five and sixty '
        + 'instruments. The count here is what could be verified against a register and measured from a '
        + 'consolidation, and nothing was added to reach a number.'
    },
    not_verified: refused,
    provisions_not_confirmed: dropped || [],
    left_out: cat.left_out || [],
    edge_types: cat.edge_types || [],
    edges: (edgeWork && edgeWork.edges) || [],
    edges_not_verified: (edgeWork && edgeWork.edgesRefused) || [],
    judgments: (edgeWork && edgeWork.judgments) || [],
    judgments_not_verified: (edgeWork && edgeWork.refused) || [],
    judgments_method: {
      what_is_checked: 'Every judgment named in this pack was fetched from its publisher and the page '
        + 'had to carry the case name, the medium neutral citation and the quote, character for '
        + 'character, before the record was written. One that failed any of those is in '
        + 'judgments_not_verified with the reason and is not cited anywhere.',
      where_from: 'Queensland judgments are read from Queensland Judgments, published by the '
        + 'Incorporated Council of Law Reporting for the State of Queensland with the Supreme Court of '
        + 'Queensland Library Committee. The larger free database refuses automated readers in terms, '
        + 'so this lane does not read it.',
      how_holdings_are_written: 'What was held is written in this pack\'s own words and kept to what '
        + 'the court decided. Judgments on these arguments sometimes carry sharp words about the person '
        + 'who ran them; this pack quotes the legal conclusion and not the rebuke, because a reader who '
        + 'arrives holding one of these arguments is here to find out where they stand, not to be told '
        + 'what somebody thought of a stranger.',
      what_is_not_here: 'No judgment text beyond the quoted sentence, and no view about how any of '
        + 'this applies to a particular person. That is the not_advice line, and it holds here hardest.'
    },
    read_in_2012: cat.stack_2012
      ? {
        what_it_is: cat.stack_2012.what_it_is,
        how_this_pack_relates: cat.stack_2012.how_this_pack_relates,
        files: (cat.stack_2012.entries || []).length,
        instruments_from_it_in_this_pack: [...new Set((cat.stack_2012.entries || [])
          .filter((e) => e.instrument).map((e) => e.instrument))].sort(),
        status_words: cat.stack_2012.status_words || {},
        by_status: Object.fromEntries([...(cat.stack_2012.entries || [])
          .reduce((m, e) => m.set(e.status, (m.get(e.status) || 0) + 1), new Map())].sort()),
        entries: cat.stack_2012.entries || []
      }
      : null
  };
}

// ---------------------------------------------------------------------------------------------
// The 2012 stack
// ---------------------------------------------------------------------------------------------

/**
 * Hold the catalogue's account of the owner's own 2012 reading honest against the folder itself.
 *
 * docs/SOURCES.md is explicit that the stack in ingest-inbox/law-2012 is primary material and
 * outranks anything an agent researches from scratch. A catalogue written past it would be a
 * researched list wearing his question as a hat. So the catalogue carries an entry for every file
 * in that folder saying whether the instrument is in this pack and, when it is not, why, and this
 * check fails the moment the folder and the account disagree in either direction. Four instruments
 * were added to the catalogue because of what this comparison found.
 *
 * The folder is gitignored, so this is advisory when the folder is not on the machine: a person
 * checking out the repository somewhere else has not lost anything, they simply do not hold the
 * owner's filing cabinet.
 */
export function reconcile2012() {
  const cat = loadCatalogue();
  const block = cat.stack_2012;
  if (!block) return { present: false, why: 'the catalogue has no stack_2012 block' };
  const folder = block.folder;
  if (!exists(folder)) return { present: false, why: `${folder} is not on this machine, so nothing was compared` };
  const onDisk = fs.readdirSync(abs(folder)).filter((f) => !f.startsWith('.')).sort();
  const accounted = new Map();
  for (const e of block.entries || []) accounted.set(e.file, e);
  const unaccounted = onDisk.filter((f) => !accounted.has(f));
  const phantom = [...accounted.keys()].filter((f) => !onDisk.includes(f));
  const byStatus = new Map();
  for (const e of block.entries || []) byStatus.set(e.status, (byStatus.get(e.status) || 0) + 1);
  const inPack = new Set((block.entries || []).filter((e) => e.instrument).map((e) => e.instrument));
  return { present: true, folder, files: onDisk.length, unaccounted, phantom, byStatus, inPack: [...inPack].sort() };
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

export function report() {
  const cat = loadCatalogue();
  const res = exists(`${INBOX}/resolved.json`) ? new Map(resolution().instruments.map((r) => [r.id, r])) : new Map();
  const meas = exists(`${INBOX}/measured.json`) ? new Map(measured().instruments.map((r) => [r.id, r])) : new Map();
  let ok = 0;
  const problems = [];
  console.log(`\n${cat.instruments.length} instruments in ${CATALOGUE}\n`);
  console.log('  ' + 'instrument'.padEnd(46) + 'pages  entries  status');
  for (const e of cat.instruments) {
    const r = res.get(e.id);
    const m = meas.get(e.id);
    const good = r && r.resolved && m && m.measured;
    if (good) ok++;
    else problems.push(`${e.short_title}: ${(m && m.why) || (r && r.note) || 'not resolved and not measured'}`);
    console.log('  ' + e.short_title.slice(0, 44).padEnd(46)
      + String(m && m.measured ? m.pages : '-').padStart(5)
      + String(m && m.measured ? m.contents_entries : '-').padStart(9)
      + '  ' + (good ? 'verified and measured' : 'NOT VERIFIED'));
  }
  console.log(`\n${ok} verified and measured, ${cat.instruments.length - ok} not.`);
  for (const p of problems) console.log(`  ${p}`);
  const totalPages = [...meas.values()].filter((m) => m.measured).reduce((a, m) => a + m.pages, 0);
  const totalEntries = [...meas.values()].filter((m) => m.measured).reduce((a, m) => a + m.contents_entries, 0);
  console.log(`\nMeasured weight of what is verified: ${totalPages.toLocaleString('en-AU')} pages, `
    + `${totalEntries.toLocaleString('en-AU')} numbered provisions.`);
  return { ok, total: cat.instruments.length };
}

// ---------------------------------------------------------------------------------------------

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-legislation.mjs');
if (RAN_DIRECTLY) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--index')) {
      const r = await refreshQldIndex();
      console.log(`Queensland in-force Acts: ${r.count}, as at register clock ${r.stamp}. Written to ${r.file}.`);
      console.log('The Commonwealth side is resolved one title at a time in --resolve, because the catalogue '
        + 'names fewer than forty of the register\'s hundreds of thousands of instruments.');
    } else if (args.includes('--resolve')) {
      const { file, out } = await resolveAll();
      const bad = out.filter((o) => !o.resolved);
      console.log(`${out.length - bad.length} of ${out.length} resolved. Written to ${file}.`);
      for (const b of bad) console.log(`  UNRESOLVED ${b.id}: ${b.note}`);
    } else if (args.includes('--fetch')) {
      console.log('Downloading current consolidations into ingest-inbox/legislation/pdf. Nothing here is committed.\n');
      const { file, rows } = await fetchAll({ only: argVal(args, '--only'), force: args.includes('--force') });
      const bad = rows.filter((r) => r.failure);
      console.log(`\n${rows.length - bad.length} of ${rows.length} fetched. Written to ${file}.`);
    } else if (args.includes('--measure')) {
      const { file, rows } = measureAll();
      const bad = rows.filter((r) => !r.measured);
      console.log(`${rows.length - bad.length} of ${rows.length} measured. Written to ${file}.`);
      for (const b of bad) console.log(`  NOT MEASURED ${b.id}: ${b.why}`);
    } else if (args.includes('--judgments')) {
      const { file, rows } = await verifyJudgments({ force: args.includes('--force') });
      const bad = rows.filter((r) => !r.verified);
      console.log(`${rows.length - bad.length} of ${rows.length} judgments verified against their published source. Written to ${file}.`);
      for (const b of bad) console.log(`  NOT VERIFIED ${b.id}: ${b.why}`);
    } else if (args.includes('--edges')) {
      const { file, rows } = verifyEdgeQuotes();
      const bad = rows.filter((r) => !r.verified);
      console.log(`${rows.length - bad.length} of ${rows.length} edge quote(s) found in the document they cite. Written to ${file}.`);
      for (const b of bad) console.log(`  NOT VERIFIED ${b.id}: ${b.why}`);
    } else if (args.includes('--extract')) {
      const batch = argVal(args, '--batch', today());
      const r = extract({ batch });
      console.log(`${r.candidates.length} candidate record(s) written to ${r.file}.`);
      if (r.refused.length) {
        console.log(`${r.refused.length} instrument(s) are not in the batch because they could not be verified:`);
        for (const x of r.refused) console.log(`  ${x.short_title}: ${x.why}`);
      }
      if (r.dropped.length) {
        console.log(`\n${r.dropped.length} named provision(s) were dropped because they are not in the Act's own contents:`);
        for (const x of r.dropped) console.log(`  ${x.instrument} ${x.ref} (${x.label})`);
      }
      console.log(`\n${r.edges.length} edge record(s) and ${r.judgments.length} judgment(s) go with them.`);
      if (r.edgesRefused.length) {
        console.log(`${r.edgesRefused.length} edge(s) were refused because their quote could not be found:`);
        for (const x of r.edgesRefused) console.log(`  ${x.edge}: ${x.why}`);
      }
      if (r.judgmentsRefused.length) {
        console.log(`${r.judgmentsRefused.length} judgment(s) were refused and are cited nowhere:`);
        for (const x of r.judgmentsRefused) console.log(`  ${x.citation}: ${x.why}`);
      }
      const unread = r.candidates.filter((c) => c.needs);
      if (unread.length) console.log(`\n${unread.length} candidate(s) still carry the note a person has to clear. `
        + 'Promotion will refuse the batch until the catalogue records a reviewed block for each.');
      console.log('\nNothing has been added to data/. Promote with:\n'
        + `  node tools/ingest/promote.mjs ${r.file} --pack legislation --collection instruments --lane legislation`);
    } else if (args.includes('--reconcile')) {
      const r = reconcile2012();
      if (!r.present) { console.log(r.why); process.exit(0); }
      console.log(`${r.folder}: ${r.files} file(s). The catalogue accounts for ${r.files - r.unaccounted.length}.`);
      for (const [s, n] of [...r.byStatus.entries()].sort()) console.log(`  ${String(n).padStart(3)}  ${s}`);
      console.log(`\n${r.inPack.length} instrument(s) in this pack came out of that folder:`);
      for (const i of r.inPack) console.log(`  ${i}`);
      if (r.unaccounted.length) {
        console.log(`\nUNACCOUNTED (${r.unaccounted.length}). The folder holds these and the catalogue does not mention them:`);
        for (const f of r.unaccounted) console.log(`  ${f}`);
      }
      if (r.phantom.length) {
        console.log(`\nPHANTOM (${r.phantom.length}). The catalogue names these and the folder does not hold them:`);
        for (const f of r.phantom) console.log(`  ${f}`);
      }
      if (r.unaccounted.length || r.phantom.length) process.exit(1);
      console.log('\nEvery file in the owner\'s 2012 stack is accounted for.');
    } else if (args.includes('--report')) {
      report();
    } else {
      console.log(readText('tools/ingest/lane-legislation.mjs').split('\n').slice(0, 12).join('\n'));
    }
  } catch (e) {
    console.error('\n' + e.message);
    process.exit(1);
  }
}
