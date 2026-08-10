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
    administering_departments: (h.administeringDepartments || []).map((d) => d.name).sort()
  };
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
  const headings = { chapters: 0, parts: 0, divisions: 0, subdivisions: 0, schedules: 0 };
  const seenHeading = new Set();
  for (const l of lines) {
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
  return {
    pages: pages.length,
    contents_pages: [start + 1, end + 1],
    contents_entries: entries,
    distinct_provision_numbers: provisions.size,
    provision_numbers: [...provisions],
    structure: headings
  };
}

/** The cover page facts: the title as printed, and the line that says how current the print is. */
export function readCover(page) {
  const lines = page.split('\n').map((l) => tidy(l)).filter(Boolean);
  const joined = lines.join(' ');
  const currency = lines.find((l) => /^Current as at /.test(l))
    || lines.find((l) => /^Compilation date:/.test(l))
    || lines.find((l) => /^Reprinted as in force/.test(l))
    || null;
  const compilation = lines.find((l) => /^Compilation No\./.test(l)) || null;
  const includes = lines.find((l) => /^Includes amendments/.test(l)) || null;
  return { lines, joined, currency, compilation, includes };
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
    const allProvisions = new Set();
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
      entries += m.contents_entries;
      for (const n of m.provision_numbers) allProvisions.add(n);
      for (const k of Object.keys(structure)) structure[k] += m.structure[k];
      per.push({ volume: file.volume, pages: m.pages, contents_entries: m.contents_entries, contents_pages: m.contents_pages });
    }
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
    if (entries < 5) {
      rows.push({
        id: e.id, measured: false,
        why: `only ${entries} contents entries were found, which means the contents was not located `
          + 'in this document and any count taken from it would be wrong.'
      });
      continue;
    }
    rows.push({
      id: e.id,
      measured: true,
      volumes: f.files.length,
      pages,
      contents_entries: entries,
      distinct_provision_numbers: distinct,
      structure,
      currency_line: cover.currency,
      compilation_line: cover.compilation,
      includes_line: cover.includes,
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
    const quote = m.currency_line || m.compilation_line;
    const administered = e.jurisdiction === 'Commonwealth'
      ? r.administering_departments
      : null;

    // Never fabricate a section. Every provision the catalogue names by number is checked against
    // the set this lane read out of the Act's own contents, and one that is not there is dropped
    // and printed rather than published. A wrong section number in a civic explainer is worse than
    // no section number, because the reader has no way to tell.
    const known = new Set(m.provision_numbers || []);
    const keyProvisions = [];
    for (const kp of e.key_provisions || []) {
      if (known.has(String(kp.ref))) keyProvisions.push({ ref: kp.ref, label: kp.label, kind: kp.kind || 'section' });
      else dropped.push({
        instrument: e.id, ref: kp.ref, label: kp.label,
        why: "the lane could not find this number in the Act's own contents, so it was not published. "
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
      currency: quote,
      compilation: m.compilation_line || null,
      includes_amendments: m.includes_line || null,
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
        method: 'Pages counted from the published consolidation and exact. Entries and headings counted '
          + "from the consolidation's own table of contents, which lists each provision once, and close "
          + 'rather than exact. See method.accuracy_note at the top of this pack.'
      },
      what_it_does: e.plain_english,
      parts_that_bear_on_a_person: e.touches || [],
      key_provisions: keyProvisions,
      key_provisions_note: keyProvisions.length
        ? "Every provision number here was found in the Act's own table of contents in the "
          + 'consolidation this record was measured from. Any the lane could not find there was dropped '
          + 'rather than published, and the dropped ones are listed in the pack under provisions_not_confirmed.'
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
      confidence: e.confidence || 'high',
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
    pack_header: packHeader(cat, refused, candidates, dropped),
    candidates
  }, null, 1) + '\n', 'utf8');
  return { file: out, candidates, refused, dropped };
}

/** The top-level fields data/legislation.json has to carry, which promotion copies in on creation. */
function packHeader(cat, refused, candidates, dropped) {
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
    read_in_2012: cat.stack_2012
      ? {
        what_it_is: cat.stack_2012.what_it_is,
        how_this_pack_relates: cat.stack_2012.how_this_pack_relates,
        files: (cat.stack_2012.entries || []).length,
        instruments_from_it_in_this_pack: [...new Set((cat.stack_2012.entries || [])
          .filter((e) => e.instrument).map((e) => e.instrument))].sort(),
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
