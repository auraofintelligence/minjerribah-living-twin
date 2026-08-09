// The document lane. BUILT.
//
// Turns a named published document into candidate records, each carrying the document it came out
// of, the page it was on, and the sentence it was read from, verbatim. It is the lane for council
// and state material: the city plan, the disaster management plan, the coastal hazard strategy,
// the engagement framework.
//
//   node tools/ingest/lane-document.mjs --register "<path to pdf>" --id rcc-city-plan-v13 \
//        --title "Redland City Plan version 13" --publisher "Redland City Council" --published 2025
//   node tools/ingest/lane-document.mjs --extract rcc-city-plan-v13 --terms "Point Lookout,Dunwich,Amity"
//   node tools/ingest/lane-document.mjs --list
//
// Three rules shape it, and they are the difference between an ingest pipeline and a laundering
// machine for guesses.
//
// 1. NARROW DIET. It takes one named document for a named purpose. It has no mode that points at a
//    directory. `--terms` is required for anything over forty pages, because reading a 484 page
//    planning scheme into a pack is not extraction, it is copying.
//
// 2. IT NEVER WRITES A PACK. It writes candidates to tools/ingest/candidates/, which is a staging
//    area, not data. A person reads them, deletes what is wrong, rates what is left, and promotes
//    them with tools/ingest/promote.mjs, which runs the gate before it writes a byte. The machine
//    finds the lines; a person decides what is true.
//
// 3. THE DOCUMENT IS CHECKSUMMED. The register in data/_provenance.json holds the sha256 of the
//    PDF that was read, so a record's citation names a specific file and not a title that might
//    have been version 12. The PDFs themselves are not in this repository and are not meant to be:
//    they are public documents that belong to their publishers, and the register records where the
//    copy that was read lives.
//
// A candidate is not a fact. Every one comes out at medium confidence with a verbatim quote, and a
// person raises or drops it. A machine cannot tell the difference between a rule that applies to
// this island and a rule quoted in a paragraph explaining why it does not.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, readJSON, exists, today } from './lib.mjs';

export const EXTRACTOR = { id: 'lane-document', version: '1.0' };
const REGISTRY = 'data/_provenance.json';
const CANDIDATES = 'tools/ingest/candidates';

/** Read a PDF to text, one entry per page, using pdftotext. Nothing is fetched; the file is local. */
export function pdfPages(file, { first = 1, last = 0 } = {}) {
  const args = ['-layout', '-nopgbrk', '-f', String(first)];
  if (last) args.push('-l', String(last));
  args.push(file, '-');
  let text;
  try {
    text = execFileSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`pdftotext failed on ${file}: ${e.message}. It must be on PATH for this lane to run.`);
  }
  // -nopgbrk strips the form feeds, so ask again with them in to get the page boundaries.
  const withBreaks = execFileSync('pdftotext', ['-layout', '-f', String(first), ...(last ? ['-l', String(last)] : []), file, '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const pages = withBreaks.split('\f');
  if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
  return pages.map((body, i) => ({ page: first + i, body }));
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadRegistry() {
  if (!exists(REGISTRY)) throw new Error('data/_provenance.json does not exist; the document register lives in it.');
  return readJSON(REGISTRY);
}

function saveRegistry(reg) {
  fs.writeFileSync(path.join(ROOT, REGISTRY), JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

/** Put a document on the record: what it is, who published it, where the copy read lives, its hash. */
export function registerDocument({ file, id, title, publisher, published, note }) {
  if (!fs.existsSync(file)) throw new Error(`no such document: ${file}`);
  const reg = loadRegistry();
  reg.documents = reg.documents || {};
  const pages = pdfPages(file).length;
  reg.documents[id] = {
    id,
    title,
    publisher,
    published: published || '',
    kind: 'pdf',
    local_path: file,
    in_repo: false,
    pages,
    sha256: sha256File(file),
    read_on: today(),
    licence_note: note || 'A public document held by its publisher. This repository records where the '
      + 'copy that was read lives and what it says, and does not republish it.'
  };
  saveRegistry(reg);
  return reg.documents[id];
}

/**
 * Pull every line of a registered document that mentions one of the terms, with its page number.
 *
 * The output is candidates, not records: a line that mentions Point Lookout may be a rule, a map
 * legend, a table header or a sentence saying the rule does not apply there. Deciding which is the
 * job this lane deliberately does not do.
 */
export function extract(docId, { terms = [], first = 1, last = 0, context = 0 } = {}) {
  const reg = loadRegistry();
  const doc = (reg.documents || {})[docId];
  if (!doc) throw new Error(`document "${docId}" is not registered. Run --register first.`);
  if (!fs.existsSync(doc.local_path)) throw new Error(`the registered copy of "${docId}" is not at ${doc.local_path}`);
  const now = sha256File(doc.local_path);
  if (now !== doc.sha256) {
    throw new Error(`the file at ${doc.local_path} is not the one that was registered `
      + `(registered ${doc.sha256.slice(0, 12)}, on disk ${now.slice(0, 12)}). Re-register it and say why it changed.`);
  }
  if (!terms.length && doc.pages > 40) {
    throw new Error(`"${docId}" is ${doc.pages} pages. Give --terms: reading a document this size `
      + 'into a pack whole is copying, not extraction.');
  }

  const hits = [];
  const rxs = terms.map((t) => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'));
  const EM = String.fromCharCode(0x2014);
  let normalised = 0;
  // A quote is verbatim, and the house rule against em dashes is about this project's own prose,
  // not about what a council wrote. The two are reconciled the only honest way available: the
  // character is replaced with a hyphen, nothing else about the wording changes, and the record
  // says out loud that it happened.
  const clean = (s) => {
    if (s.indexOf(EM) === -1) return s;
    normalised++;
    return s.split(EM).join(' - ');
  };
  for (const { page, body } of pdfPages(doc.local_path, { first, last })) {
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+/g, ' ').trim();
      if (line.length < 8) continue;
      const term = terms.find((t, k) => rxs[k].test(line));
      if (terms.length && !term) continue;
      const before = context ? lines.slice(Math.max(0, i - context), i).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
      const after = context ? lines.slice(i + 1, i + 1 + context).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
      const quote = clean(line);
      hits.push({
        id: `${docId}-p${page}-l${i + 1}`,
        source: docId,
        locator: `p. ${page}, line ${i + 1}`,
        quote,
        quote_note: quote === line ? '' : 'An em dash in the source was rendered as a hyphen. The wording is unchanged.',
        context: [...before, ...after].map(clean),
        matched_term: term || '',
        confidence: 'medium',
        status: 'committed',
        asserts: 'real_world',
        extracted_at: today(),
        extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
        needs: 'A person decides what this line means, whether it applies to this island, and what '
          + 'record it becomes. Delete it if it is a header, a legend, or a sentence about somewhere else.'
      });
    }
  }
  return { doc, hits, normalised };
}

function writeCandidates(docId, slug, doc, hits) {
  const dir = path.join(ROOT, CANDIDATES);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${docId}-${slug}.json`);
  fs.writeFileSync(out, JSON.stringify({
    kind: 'ingest-candidates',
    lane: 'document',
    schema: 'minjerribah-candidates/1',
    document: { id: doc.id, title: doc.title, publisher: doc.publisher, sha256: doc.sha256, pages: doc.pages },
    extractor: EXTRACTOR,
    extracted_at: today(),
    note: 'Candidates, not records. Nothing here has been read by a person. Delete what is wrong, '
      + 'rate what is left, then promote with tools/ingest/promote.mjs, which runs the gate first.',
    candidates: hits
  }, null, 2) + '\n', 'utf8');
  return path.relative(ROOT, out).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------------------------

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-document.mjs');
if (RAN_DIRECTLY) {
  const args = process.argv.slice(2);
  const val = (f, d = null) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);

  if (args.includes('--list')) {
    const reg = loadRegistry();
    const docs = Object.values(reg.documents || {});
    if (!docs.length) console.log('No documents registered.');
    for (const d of docs) {
      console.log(`${d.id}\n  ${d.title}\n  ${d.publisher}${d.published ? ', ' + d.published : ''}, ${d.pages} pages`);
      console.log(`  ${d.local_path}\n  sha256 ${d.sha256.slice(0, 16)} read ${d.read_on}`);
    }
    process.exit(0);
  }

  if (args.includes('--register')) {
    const file = val('--register');
    const id = val('--id');
    if (!file || !id) { console.error('--register <path> needs --id, and should have --title and --publisher.'); process.exit(1); }
    const d = registerDocument({
      file, id, title: val('--title', id), publisher: val('--publisher', ''),
      published: val('--published', ''), note: val('--note', '')
    });
    console.log(`Registered ${id}: ${d.pages} pages, sha256 ${d.sha256.slice(0, 16)}`);
    console.log('The document itself stays where it is. data/_provenance.json records where it lives and what it hashes to.');
    process.exit(0);
  }

  if (args.includes('--extract')) {
    const docId = val('--extract');
    const terms = (val('--terms', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const { doc, hits, normalised } = extract(docId, {
        terms,
        first: Number(val('--first', 1)),
        last: Number(val('--last', 0)),
        context: Number(val('--context', 0))
      });
      const slug = terms.length ? terms.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) : 'all';
      const out = writeCandidates(docId, slug, doc, hits);
      console.log(`${hits.length} candidate line(s) from ${doc.title} (${doc.pages} pages).`);
      console.log(`Written to ${out}. Nothing has been added to data/.`);
      if (normalised) console.log(`${normalised} quote(s) had an em dash rendered as a hyphen; each says so in quote_note.`);
      for (const h of hits.slice(0, 8)) console.log(`  ${h.locator}: ${h.quote.slice(0, 110)}`);
      if (hits.length > 8) console.log(`  and ${hits.length - 8} more`);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 36).join('\n'));
}
