// Repository-wide checks: house style, and the integrity of the pack registry itself.
//
// The registry checks are the ones a data officer cares about. They answer: is every pack the twin
// loads accounted for, is the file on disk the file the registry says it is, does the registry's
// account of what is inside each pack still match what is actually inside it, and can the whole
// state of the data be named in one short string so a scenario report can be replayed by somebody
// who was not there.

import path from 'node:path';
import {
  readText, readJSON, exists, repoFiles, walkRecords, walkStrings, sha256lf, shortHash,
  lineOf, TEXT_EXT
} from './lib.mjs';

// Spelled by code point, not typed, for the same reason src/systems/narrative/chronicle.js does it:
// a file that has to name the character in order to refuse it must not be the one file in the
// repository that contains it. Writing this line the obvious way was the first thing the gate
// caught, in its own source, on its first run.
const EM_DASH = String.fromCharCode(0x2014);

/**
 * No em dash anywhere in the repository, code comments included. It is a house rule and it is also
 * the most reliable tell that a line of copy was written by a model and not read afterwards.
 *
 * src/systems/narrative/chronicle.js has to name the character in order to reject it, and it does
 * that by spelling it as a code point, so a repository-wide scan comes back clean. Any file that
 * genuinely needs to talk about the character does the same.
 */
export function runEmDashCheck(ctx) {
  const { findings } = ctx;
  const files = repoFiles({ exts: TEXT_EXT });
  let hits = 0;
  for (const file of files) {
    let text;
    try { text = readText(file); } catch { continue; }
    let idx = text.indexOf(EM_DASH);
    while (idx !== -1) {
      hits++;
      const line = lineOf(text, idx);
      findings.add({
        check: 'no-em-dash',
        severity: 'blocking',
        file,
        locator: `line ${line}`,
        message: `An em dash appears in ${file} at line ${line}: "${text.slice(Math.max(0, idx - 40), idx + 40).replace(/\n/g, ' ')}"`,
        hint: 'Replace it with a colon, a semicolon, a comma or a full stop. If a file must name the '
          + 'character in order to reject it, spell it as a code point the way chronicle.js does.'
      });
      idx = text.indexOf(EM_DASH, idx + 1);
    }
  }
  findings.ran('no-em-dash', `${files.length} files scanned, ${hits} occurrence(s)`);
}

// ---------------------------------------------------------------------------------------------
// Australian English
// ---------------------------------------------------------------------------------------------

/**
 * American spellings that have no legitimate technical reading in this repository. Deliberately
 * short. Words where the American form is also correct Australian usage in some sense are left out
 * rather than guessed at: program, licence as a verb, judgment, sulfur, practice, draft, tire and
 * curb all mean something in their own right and a check that flagged them would be wrong often
 * enough to get itself switched off.
 *
 * `labor` is the trap worth naming: the Australian Labor Party is spelled that way on purpose, so
 * the pattern excludes it when the party is what is being named.
 */
const AMERICAN = [
  [/\bcolor(s|ed|ing|ful|less)?\b/gi, 'colour'],
  [/\bharbor(s|ed|ing)?\b/gi, 'harbour'],
  [/\bneighbor(s|ing|hood|hoods)?\b/gi, 'neighbour'],
  [/\bfavor(s|ed|ing|ite|ites|able)?\b/gi, 'favour'],
  [/\bbehavior(s|al)?\b/gi, 'behaviour'],
  [/\bendeavor(s|ed|ing)?\b/gi, 'endeavour'],
  [/\bcenter(s|ed|ing)?\b/gi, 'centre'],
  [/\btheater(s)?\b/gi, 'theatre'],
  [/\bliter(s)?\b/gi, 'litre'],
  [/\bkilometer(s)?\b/gi, 'kilometre'],
  [/\bfiber(s)?\b/gi, 'fibre'],
  [/\bdefense(s|less)?\b/gi, 'defence'],
  [/\boffense(s)?\b/gi, 'offence'],
  [/\borganiz(e|es|ed|ing|ation|ations|ational)\b/gi, 'organise'],
  [/\breali[z](e|es|ed|ing|ation)\b/gi, 'realise'],
  [/\brecogniz(e|es|ed|ing|ation)\b/gi, 'recognise'],
  [/\banaly[z](e|es|ed|ing)\b/gi, 'analyse'],
  [/\bprioritiz(e|es|ed|ing|ation)\b/gi, 'prioritise'],
  [/\bminimiz(e|es|ed|ing)\b/gi, 'minimise'],
  [/\bmaximiz(e|es|ed|ing)\b/gi, 'maximise'],
  [/\bsummariz(e|es|ed|ing)\b/gi, 'summarise'],
  [/\bcatalog(s|ed|ing)?\b/gi, 'catalogue'],
  [/\btravel(ed|ing|er|ers)\b/gi, 'travelled'],
  [/\bmodel(ed|ing|er|ers)\b/gi, 'modelled'],
  [/\bfuel(ed|ing)\b/gi, 'fuelled'],
  [/\blabel(ed|ing)\b/gi, 'labelled'],
  [/\bcancel(ed|ing)\b/gi, 'cancelled'],
  [/\bsignal(ed|ing)\b/gi, 'signalled'],
  [/\bplow(s|ed|ing)?\b/gi, 'plough'],
  [/\bmold(s|ed|ing|y)?\b/gi, 'mould'],
  [/\benrollment(s)?\b/gi, 'enrolment'],
  [/\bfulfill(s|ed|ing|ment)?\b/gi, 'fulfil'],
  [/\bskillful(ly)?\b/gi, 'skilful'],
  [/\binstallment(s)?\b/gi, 'instalment'],
  [/\bartifact(s)?\b/gi, 'artefact'],
  [/\baluminum\b/gi, 'aluminium'],
  [/\bgray(s|ed|ish)?\b/gi, 'grey'],
  // A metre is a distance and a meter is a device, and both words are correct here. The repository
  // has a mixer meter, an exposure meter, behind-the-meter solar and a need meter, none of which is
  // a spelling mistake, so only a number followed by the word is treated as a distance.
  [/\b\d+(\.\d+)?\s*meters?\b/gi, 'metres'],
  [/\blabor(s|ed|ing|er|ers)?\b/gi, 'labour']
];

/** Places where an American-looking string is a technical term and not a spelling mistake. */
const SPELLING_EXCUSES = [
  /\bLabor Party\b/i, /\bAustralian Labor\b/i,
  /\bgray(scale)?\b(?=[^ ]*\()/i
];

/** Split a file into the pieces of it that are prose, so code identifiers are never judged. */
function prosePieces(file, text) {
  const ext = path.extname(file).toLowerCase();
  const out = [];
  if (ext === '.md' || ext === '.txt') {
    text.split('\n').forEach((l, i) => out.push({ text: l, line: i + 1 }));
    return out;
  }
  if (ext === '.json') return out; // handled separately, value by value
  if (ext === '.html') {
    const stripped = text.replace(/<style[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, ' '));
    stripped.split('\n').forEach((l, i) => out.push({ text: l.replace(/<[^>]+>/g, ' '), line: i + 1 }));
    return out;
  }
  if (ext === '.css') return out;
  // JavaScript. Comments, and string literals that read like prose rather than like an identifier
  // or a fragment of CSS.
  const lines = text.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let piece = '';
    if (inBlock) {
      piece = line;
      if (line.includes('*/')) inBlock = false;
    } else if (/^\s*\/\*/.test(line)) {
      piece = line;
      if (!line.includes('*/')) inBlock = true;
    } else if (/^\s*(\/\/|\*)/.test(line)) {
      piece = line;
    } else {
      const strings = line.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
      piece = strings
        .filter((s) => s.includes(' ') && !/[{};]\s*$/.test(s) && !/:\s*[^ ]+;/.test(s))
        .join(' ');
    }
    if (piece.trim()) out.push({ text: piece, line: i + 1 });
  }
  return out;
}

export function runSpellingCheck(ctx) {
  const { findings, ledger } = ctx;
  const counts = new Map();  // file -> count
  const detail = new Map();  // file -> [messages]

  const record = (file, line, word, want, context) => {
    if (SPELLING_EXCUSES.some((rx) => rx.test(context))) return;
    counts.set(file, (counts.get(file) || 0) + 1);
    if (!detail.has(file)) detail.set(file, []);
    detail.get(file).push(`line ${line}: "${word}" (Australian English uses ${want})`);
  };

  for (const file of repoFiles({ exts: TEXT_EXT })) {
    if (file.startsWith('tools/ingest/')) continue; // this file has to name the words to reject them
    let text;
    try { text = readText(file); } catch { continue; }
    if (path.extname(file) === '.json') {
      let doc;
      try { doc = JSON.parse(text); } catch { continue; }
      for (const { value, key } of walkStrings(doc)) {
        if (/^(id|url|source|href|file|path|checksum|slug)$/.test(key)) continue;
        // A verbatim quote is the source's prose, not this project's. Correcting a council's
        // spelling inside quotation marks would be worse than carrying it.
        //
        // `heading` is on this list for the same reason and it earned its place: the legislation
        // lane records the heading printed over a provision, character for character, so that a
        // section number can be confirmed against the words above it. The Australian Human Rights
        // Commission Act 1986 schedules the text of a United Nations covenant, whose headings are
        // spelled the way that body spells them, and a check that fails on that is asking this
        // project to correct the spelling of a treaty inside a Commonwealth Act.
        if (/^(quote|excerpt|verbatim|context|heading)$/.test(key)) continue;
        if (!/\s/.test(value)) continue;
        for (const [rx, want] of AMERICAN) {
          rx.lastIndex = 0;
          const m = rx.exec(value);
          if (m) record(file, 0, m[0], want, value);
        }
      }
      continue;
    }
    for (const { text: piece, line } of prosePieces(file, text)) {
      for (const [rx, want] of AMERICAN) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(piece)) !== null) record(file, line, m[0], want, piece);
      }
    }
  }

  for (const [file, n] of [...counts.entries()].sort()) {
    const allowed = ledger.allowance('australian-english', file, 'spelling');
    const lines = detail.get(file) || [];
    if (n <= allowed.count) {
      findings.add({
        check: 'australian-english', severity: 'accepted', file,
        locator: lines.slice(0, 4).join('; '),
        message: `${n} American spelling(s) in ${file}, accepted: ${allowed.reason}`
      });
      continue;
    }
    findings.add({
      check: 'australian-english', severity: 'blocking', file,
      locator: lines.slice(0, 10).join('; '),
      message: `${n} American spelling(s) in ${file}; the ledger accepts ${allowed.count}.`,
      hint: 'Australian English: harbour, realise, centre, metre, colour, licence as a noun. Prices in A$.'
    });
  }
  findings.ran('australian-english', `${AMERICAN.length} patterns, ${counts.size} file(s) with a hit`);
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/** The fingerprint that goes on a scenario report beside the seed. Pack ids, versions, checksums. */
export function computeFingerprint(registry) {
  const parts = (registry.packs || [])
    .map((p) => `${p.id}@${p.version}:${(p.checksum && p.checksum.value) || ''}`)
    .sort();
  return shortHash(parts.join('\n'), 12);
}

export function runRegistryChecks(ctx) {
  const { findings, registry } = ctx;
  const lanes = new Set(Object.keys(registry.lanes || {}));
  const onDisk = repoFiles({ exts: new Set(['.json']), under: 'data' })
    .filter((f) => !path.basename(f).startsWith('_'));
  const listed = new Set();

  for (const entry of registry.packs || []) {
    const file = entry.file || `data/${entry.id}.json`;
    listed.add(file);
    if (!exists(file)) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id,
        message: `The registry lists pack "${entry.id}" at ${file} and there is no such file.`
      });
      continue;
    }
    const text = readText(file);
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) {
      findings.add({ check: 'registry', severity: 'blocking', file, id: entry.id, message: `${file} is not valid JSON: ${e.message}` });
      continue;
    }

    if (!entry.lane || !lanes.has(entry.lane)) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'lane',
        message: `Pack "${entry.id}" declares lane "${entry.lane || ''}", which is not one of ${[...lanes].join(', ')}.`
      });
    }
    if (!entry.extractor || !entry.extractor.id || !entry.extractor.version) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'extractor',
        message: `Pack "${entry.id}" records no extractor and version.`,
        hint: 'Even a hand-written pack has an extractor: the agent or person who wrote it, and the wave.'
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(entry.ingested_at || ''))) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'ingested_at',
        message: `Pack "${entry.id}" records no ingest date in ISO form.`
      });
    }
    if (doc.version !== undefined && entry.version !== undefined && String(doc.version) !== String(entry.version)) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'version',
        message: `${file} says version ${JSON.stringify(doc.version)}, the registry says ${JSON.stringify(entry.version)}.`,
        hint: 'Run node tools/ingest/registry.mjs --refresh, which re-runs the gate before it rewrites anything.'
      });
    }

    const actual = sha256lf(text);
    const claimed = entry.checksum && entry.checksum.value;
    if (!claimed) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'checksum',
        message: `Pack "${entry.id}" carries no checksum.`
      });
    } else if (claimed !== actual) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'checksum',
        message: `${file} has changed since it was registered. Registered ${claimed.slice(0, 12)}, on disk ${actual.slice(0, 12)}.`,
        hint: 'This is the check doing its job, not a nuisance. If the change is intended, run '
          + 'node tools/ingest/registry.mjs --refresh: it runs the whole gate over the new content '
          + 'first and refuses to write a new checksum if anything fails, so refreshing is not a way past.'
      });
    }

    // Does the registry's account of what is inside the pack still match the pack?
    const dist = { high: 0, medium: 0, low: 0, unrated: 0 };
    let records = 0;
    for (const { record } of walkRecords(doc, '', '')) {
      records++;
      const c = record.confidence;
      if (c === 'high' || c === 'medium' || c === 'low') dist[c]++;
      else dist.unrated++;
    }
    const claimedDist = entry.confidence || {};
    const same = ['high', 'medium', 'low', 'unrated'].every((k) => (claimedDist[k] || 0) === dist[k])
      && (entry.records === undefined || entry.records === records);
    if (!same) {
      findings.add({
        check: 'registry', severity: 'blocking', file, id: entry.id, locator: 'confidence',
        message: `The registry's account of ${entry.id} is stale. It says ${entry.records} records `
          + `${JSON.stringify(claimedDist)}; the pack holds ${records} records ${JSON.stringify(dist)}.`,
        hint: 'node tools/ingest/registry.mjs --refresh'
      });
    }
  }

  for (const file of onDisk) {
    if (listed.has(file)) continue;
    findings.add({
      check: 'registry', severity: 'blocking', file,
      message: `${file} sits in data/ and is in no registry entry, so nothing records where it came from.`,
      hint: 'Every pack the twin can load is in data/_provenance.json. If this file is not a pack, '
        + 'move it out of data/ or give it a leading underscore.'
    });
  }

  const want = computeFingerprint(registry);
  if (registry.fingerprint !== want) {
    findings.add({
      check: 'registry', severity: 'blocking', file: 'data/_provenance.json', locator: 'fingerprint',
      message: `The registry fingerprint is ${registry.fingerprint}; the packs it lists compute to ${want}.`,
      hint: 'The fingerprint is what a scenario report publishes beside the seed so somebody else can '
        + 'replay the run. A stale one makes every report unreproducible.'
    });
  }

  // Lanes declare themselves built or not, and the file that implements them either exists or does not.
  for (const [id, lane] of Object.entries(registry.lanes || {})) {
    if (!lane.tool) continue;
    const there = exists(lane.tool);
    if (lane.built && !there) {
      findings.add({
        check: 'registry', severity: 'blocking', file: 'data/_provenance.json', locator: `lanes.${id}`,
        message: `Lane "${id}" says it is built and ${lane.tool} does not exist.`
      });
    }
    if (!lane.built && !lane.reason) {
      findings.add({
        check: 'registry', severity: 'blocking', file: 'data/_provenance.json', locator: `lanes.${id}`,
        message: `Lane "${id}" is not built and gives no reason.`,
        hint: 'An honest gap is a gap with a reason beside it. See the era lane.'
      });
    }
  }

  findings.ran('registry', `${(registry.packs || []).length} packs, ${lanes.size} lanes, fingerprint ${registry.fingerprint}`);
}
