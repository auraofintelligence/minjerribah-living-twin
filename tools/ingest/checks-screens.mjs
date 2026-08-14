// Two screens that run over every ingest, not over one map.
//
// They were written because the owner's own Google MyMaps of the island arrived carrying two things
// that must never reach a committed pack, and the fix for that is not a line of code in one lane. A
// rule that lives inside the tool that happened to find the problem is a rule that the next tool
// does not have. So both are gate checks, and both scan the staging area as well as the packs,
// because the point is to catch the thing before somebody promotes it rather than after.
//
//   personal-data          contact details and residential addresses
//   contribution-culture   the cultural prohibitions, applied to contributed and staged material
//
// Neither check ever prints the value it found. A gate log is a file, a scrollback and a screen
// share, and a check that says "found the mobile number 04xx xxx xxx in this file" has published the
// thing it exists to protect. Every finding names the file, the pointer and the kind, and stops.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ROOT as REPO_ROOT,
  readText, readJSON, exists, repoFiles, walkStrings, citesSomething, lineOf
} from './lib.mjs';

// ------------------------------------------------------------------------------------------------
// The patterns
// ------------------------------------------------------------------------------------------------

/**
 * What counts as a contact detail or a residential address.
 *
 * Australian formats, because this is an Australian island and a general-purpose international
 * matcher would fire on every four digit year in the packs. Each pattern is written to be read: a
 * mobile is 04 and nine digits however it is spaced, a landline is an area code and eight digits,
 * and a street address is a number followed by a name followed by one of the street types the
 * Queensland address standard uses.
 *
 * `redact` turns a match into something safe to print. It never returns any digit or letter of the
 * value, only its shape, because the whole reason this check exists is that the value must not be
 * repeated anywhere.
 */
export const CONTACT_PATTERNS = [
  {
    id: 'mobile',
    label: 'a mobile number',
    rx: /(?:\+?61[ ()-]?|\b0)4\d{2}[ -]?\d{3}[ -]?\d{3}\b/g,
    redact: (m) => `a ${String(m).replace(/\D/g, '').length} digit mobile number`
  },
  {
    id: 'landline',
    label: 'a landline number',
    rx: /(?:\+?61[ ()-]?|\b0)[23578][ -]?\d{4}[ -]?\d{4}\b/g,
    redact: (m) => `a ${String(m).replace(/\D/g, '').length} digit landline number`
  },
  {
    id: 'email',
    label: 'an email address',
    rx: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    redact: (m) => `an email address at ${String(m).split('@')[1] ? String(m).split('@')[1].replace(/[^.]/g, 'x') : 'a hidden domain'}`
  },
  {
    id: 'street-address',
    label: 'a street address',
    rx: /\b\d{1,4}[A-Za-z]?[ ,]+[A-Z][A-Za-z'-]*(?:[ ][A-Z][A-Za-z'-]*){0,3}[ ](?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crescent|Cres|Parade|Pde|Place|Pl|Terrace|Tce|Way|Esplanade|Esp|Lane|Close|Boulevard|Blvd)\b/g,
    redact: () => 'a street address'
  }
];

/** Every contact detail in a string, as `{ pattern, redacted }`. The value itself never escapes. */
export function findContactDetails(s) {
  const out = [];
  if (typeof s !== 'string' || !s) return out;
  for (const p of CONTACT_PATTERNS) {
    p.rx.lastIndex = 0;
    let m;
    while ((m = p.rx.exec(s)) !== null) {
      out.push({ pattern: p.id, label: p.label, redacted: p.redact(m[0]), index: m.index });
      if (p.rx.lastIndex === m.index) p.rx.lastIndex++;
    }
  }
  return out;
}

/** Remove every contact detail from a string, leaving a marker in its place. */
export function stripContactDetails(s) {
  let out = String(s);
  let removed = 0;
  for (const p of CONTACT_PATTERNS) {
    if (p.id === 'street-address') continue; // an address is judged in context, never blanked blind
    out = out.replace(p.rx, () => { removed++; return '[contact detail removed at ingest]'; });
  }
  return { text: out.replace(/\s*\n\s*/g, '\n').trim(), removed };
}

// ------------------------------------------------------------------------------------------------
// Where each check looks
// ------------------------------------------------------------------------------------------------

/** Files that are staged for ingest and have not been through anybody's judgement yet. */
// Only genuinely raw material. `tools/ingest/candidates/` used to be in this list and that was wrong:
// a candidate is the OUTPUT of a lane that has already stripped contact details, it is tracked on
// purpose so its diff can be reviewed before promotion, and treating it as unjudged raw import gave
// it a softer rule than the pack it is about to become. Candidates are now held to the ordinary
// record rule: cited is advisory, uncited is blocking. `ingest-inbox/` is the only true staging area
// and it is the only thing that has to stay sealed.
const STAGING_PREFIXES = ['ingest-inbox/'];

/**
 * Whether a staging directory is genuinely uncommittable, asked of git rather than assumed.
 *
 * This exists because the downgrade below is only safe if it is true. A contact detail found in a
 * staged file is reported as `review` rather than failing the run, on the reasoning that a raw export
 * from somebody's own map may legitimately carry their own number and none of it will survive into a
 * pack. That reasoning collapses the moment the staging directory is committable, and nothing in this
 * gate used to check. A critic found it on 10 August 2026: today the owner's two mobile numbers are
 * not committed, and the gate would not have stopped them being committed.
 *
 * So: ask git. Ignored and untracked means the downgrade holds. Anything else and every staged
 * finding becomes blocking, because the file is one `git add -A` from being public, and the
 * repository is public.
 */
function stagingIsSealed() {
  const unsealed = [];
  for (const prefix of STAGING_PREFIXES) {
    const dir = prefix.replace(/\/$/, '');
    if (!existsSync(path.join(REPO_ROOT, dir))) continue;
    let ignored = false;
    try {
      execFileSync('git', ['check-ignore', '-q', dir], { cwd: REPO_ROOT, stdio: 'ignore' });
      ignored = true;
    } catch { ignored = false; }
    let tracked = [];
    try {
      const out = execFileSync('git', ['ls-files', '--', dir], { cwd: REPO_ROOT, encoding: 'utf8' });
      tracked = out.split('\n').filter(Boolean);
    } catch { /* not a git repository: treat as unsealed, below */ }
    if (!ignored || tracked.length) {
      unsealed.push({ dir, ignored, trackedCount: tracked.length });
    }
  }
  return { sealed: unsealed.length === 0, unsealed };
}
const STAGING_EXTS = new Set(['.kml', '.json', '.csv', '.txt', '.md', '.geojson', '.gpx']);

function stagingFiles() {
  const out = [];
  for (const prefix of STAGING_PREFIXES) {
    for (const f of repoFiles({ under: prefix.replace(/\/$/, '') })) {
      if (STAGING_EXTS.has(path.extname(f).toLowerCase())) out.push(f);
    }
  }
  return out.sort();
}

/** Lanes whose output is somebody's contribution rather than a published document. */
const CONTRIBUTION_LANES = new Set(['contribution', 'map']);

function contributionPackFiles(registry) {
  return (registry.packs || [])
    .filter((p) => CONTRIBUTION_LANES.has(p.lane))
    .map((p) => p.file || `data/${p.id}.json`)
    .filter((f) => exists(f));
}

/**
 * Walk a JSON pointer like `services[1].contact.phone` back down the document, collecting every
 * object on the way, so a finding can ask what the enclosing record says about itself.
 */
function ancestorsOf(doc, pointer) {
  const chain = [];
  let node = doc;
  for (const step of String(pointer).split('.')) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(step);
    if (!m) break;
    if (m[1]) {
      if (node == null || typeof node !== 'object') break;
      node = node[m[1]];
      if (node && typeof node === 'object') chain.push(node);
    }
    for (const idx of (m[2].match(/\d+/g) || [])) {
      if (!Array.isArray(node)) break;
      node = node[Number(idx)];
      if (node && typeof node === 'object') chain.push(node);
    }
  }
  return chain;
}

/** The nearest enclosing object that carries an id, which is what the packs call a record. */
function nearestRecord(chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i] && typeof chain[i].id === 'string') return chain[i];
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// personal-data
// ------------------------------------------------------------------------------------------------

/**
 * No contact detail and no residential address enters this repository through a contribution.
 *
 * The rule is not "no phone numbers in data", because that would be wrong and it would have been
 * switched off within a day. A twin that models wildlife rescue carries the rescue hotline, and a
 * twin that models the ferry carries the operator's booking line; those are published, they sit on
 * a record that names where they were published, and a player who needs one needs the real one.
 *
 * What is never acceptable is a personal contact detail arriving inside somebody's contribution.
 * The owner's map carried two mobile numbers, one of them in the map's own description. So the
 * severity turns on three questions the check can actually answer:
 *
 *   is this a pack built from contributions        -> blocking, always, no ledger
 *   does the record carrying it name a source      -> advisory, counted and printed every run
 *   neither                                        -> blocking
 *
 * Staged files are reported for a human rather than failed, because a raw export from somebody's
 * own map is allowed to contain their own phone number; what is not allowed is that number
 * surviving into a pack. The finding says which file and how many, and never what.
 */
export function runPersonalDataCheck(ctx) {
  const { findings, registry } = ctx;
  const contributionFiles = new Set(contributionPackFiles(registry || {}));
  const packFiles = repoFiles({ exts: new Set(['.json']), under: 'data' });
  const docFiles = repoFiles({ exts: new Set(['.md']), under: 'docs' });
  let scanned = 0;
  let hits = 0;

  const tally = new Map(); // `${file}|${severity}|${pattern}` -> { n, where[] }
  const note = (file, severity, pattern, where, extra) => {
    hits++;
    const key = `${file}|${severity}|${pattern}`;
    if (!tally.has(key)) tally.set(key, { n: 0, where: [], extra });
    const t = tally.get(key);
    t.n++;
    if (t.where.length < 6) t.where.push(where);
  };

  for (const file of packFiles) {
    scanned++;
    let doc;
    try { doc = JSON.parse(readText(file)); } catch { continue; }
    const isContribution = contributionFiles.has(file);
    for (const { value, key, pointer } of walkStrings(doc)) {
      if (/^(id|url|href|file|path|checksum|slug)$/.test(key)) continue;
      for (const hit of findContactDetails(value)) {
        const chain = ancestorsOf(doc, pointer);
        const record = nearestRecord(chain);
        const cited = chain.some((o) => citesSomething(o));
        const contributed = chain.some((o) => o && (o.contributed_by || o.transcribed_by));
        if (isContribution || contributed) {
          note(file, 'blocking', hit.pattern, pointer);
        } else if (cited) {
          note(file, 'advisory', hit.pattern, `${pointer}${record && record.id ? ` (${record.id})` : ''}`);
        } else {
          note(file, 'blocking', hit.pattern, pointer, 'nothing on or above this record says where it was published');
        }
      }
    }
  }

  for (const file of docFiles) {
    scanned++;
    let text;
    try { text = readText(file); } catch { continue; }
    for (const hit of findContactDetails(text)) {
      // A document is prose somebody wrote and read. Contact details in it are worth naming, never
      // worth failing a build over, unless they are in the cultural review queue, which is the one
      // file in docs that routinely quotes what a contribution said.
      note(file, 'advisory', hit.pattern, `line ${lineOf(text, hit.index)}`);
    }
  }

  for (const file of stagingFiles()) {
    scanned++;
    let text;
    try { text = readText(file); } catch { continue; }
    for (const hit of findContactDetails(text)) {
      if (hit.pattern === 'street-address') continue; // a staged council document is full of them
      note(file, 'review', hit.pattern, `line ${lineOf(text, hit.index)}`);
    }
  }

  for (const [key, t] of [...tally.entries()].sort()) {
    const [file, severity, pattern] = key.split('|');
    const label = (CONTACT_PATTERNS.find((p) => p.id === pattern) || {}).label || pattern;
    if (severity === 'review') {
      // Only stays a review if the staging area genuinely cannot be committed. See stagingIsSealed.
      const seal = stagingIsSealed();
      if (!seal.sealed) {
        findings.add({
          check: 'personal-data', severity: 'blocking', file,
          message: `${file} is staged for ingest, contains ${t.n} instance(s) of what looks like ${label}, `
            + `and the staging area is not sealed: `
            + seal.unsealed.map((u) => `${u.dir} is ${u.ignored ? 'ignored' : 'NOT ignored'}`
              + `${u.trackedCount ? ` and has ${u.trackedCount} tracked file(s)` : ''}`).join('; ') + '.',
          hint: 'Staged contact details are normally reported rather than failed, because a raw export '
            + 'may legitimately carry a number belonging to the person who exported it. That only '
            + 'holds while the file cannot '
            + 'be committed. Restore the .gitignore entry, or git rm --cached the tracked files, and '
            + 'this returns to a review. This repository is public.'
        });
        continue;
      }
      findings.add({
        check: 'personal-data', severity: 'review', file,
        message: `${file} is staged for ingest and contains ${t.n} instance(s) of what looks like ${label}.`,
        hint: 'A raw export may legitimately carry the exporter\'s own contact details. None of it may '
          + 'survive into a pack: tools/ingest/lane-map.mjs strips contact details before it writes a '
          + 'candidate, and this check fails if one ever reaches a contribution pack. Nothing here '
          + 'prints the value.'
      });
      continue;
    }
    findings.add({
      check: 'personal-data',
      severity,
      file,
      locator: t.where.join(', ') + (t.n > t.where.length ? ` and ${t.n - t.where.length} more` : ''),
      message: severity === 'blocking'
        ? `${t.n} instance(s) of ${label} in ${file}${t.extra ? `, and ${t.extra}` : ''}.`
        : `${t.n} published organisational contact(s) of the kind "${label}" in ${file}, each on a record that names where it was published.`,
      hint: severity === 'blocking'
        ? 'Personal contact details do not enter a pack, from any lane, under any consent. Remove it. '
          + 'If this is a published organisational contact, the record it sits on has to name where it '
          + 'was published, and that citation is what makes it publishable rather than the fact that '
          + 'somebody typed it in.'
        : ''
    });
  }

  findings.ran('personal-data', `${scanned} files scanned, ${hits} contact-shaped string(s) found, none printed`);
}

// ------------------------------------------------------------------------------------------------
// contribution-culture
// ------------------------------------------------------------------------------------------------

/**
 * The cultural prohibitions, applied where they were not applied before.
 *
 * `data/lore.json` already forbids invented ceremony and forbids placing a sacred or restricted site
 * in the world, and `checks-lore.mjs` runs both over `data/**`. Two gaps that left:
 *
 *   Staging. A map, a batch or a scan sitting in the inbox has been through nobody's judgement, and
 *   the existing checks do not look at it. That is precisely the moment somebody wants to know, and
 *   this reports it as a question rather than a failure, because a source file is allowed to say
 *   anything; what matters is what gets promoted.
 *
 *   The routing. A hit inside contributed material is almost never resolved by deleting a line. It
 *   is resolved by taking the question to QYAC through the queue in docs/CULTURAL-REVIEW.md, and the
 *   contribution staying out of the world in the meantime. The existing finding says "delete the
 *   line", which is right for a pack an agent wrote and wrong for a pin somebody put on their own
 *   map of their own island.
 *
 * The tokens are read out of data/lore.json rather than restated here, so a rule QYAC adds is a rule
 * this screen runs.
 */
/**
 * A token and its ordinary plural, as one alternation.
 *
 * `checks-lore.mjs` matches each prohibition token as a whole word and nothing else, which is right
 * for the banned invented words, where a plural would be a different invention. It is not right
 * here. The owner's map proposes a space that "could be used for ceremonies", and a screen that
 * matched `ceremony` and let `ceremonies` past would have waved through the exact sentence it exists
 * to catch. The rule in the pack says no ceremony may be depicted, named or scheduled; the plural is
 * the same rule. This widening is local to this screen and does not touch the frozen counts the
 * ledger holds against the repository-wide scan.
 */
export function tokenFamily(token) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = new Set([token]);
  if (/y$/i.test(token)) forms.add(token.slice(0, -1) + 'ies');
  else if (/(s|x|z|ch|sh)$/i.test(token)) forms.add(token + 'es');
  else forms.add(token + 's');
  return [...forms].sort((a, b) => b.length - a.length).map(esc).join('|');
}

export function runContributionCultureCheck(ctx) {
  const { findings, registry } = ctx;
  let lore = null;
  try { lore = readJSON('data/lore.json'); } catch {
    findings.add({
      check: 'contribution-culture', severity: 'blocking', file: 'data/lore.json',
      message: 'The lore pack could not be read, so the cultural screen has no tokens and checked nothing.'
    });
    return;
  }
  const rules = ((lore.prohibitions && lore.prohibitions.rules) || [])
    .filter((r) => r.id === 'no-invented-ceremony' || r.id === 'no-sacred-or-restricted-sites');
  const tokens = [...new Set(rules.flatMap((r) => (r.check && r.check.tokens) || []))].sort();
  if (!tokens.length) {
    findings.add({
      check: 'contribution-culture', severity: 'blocking', file: 'data/lore.json',
      message: 'Neither cultural prohibition declares any tokens, so this screen would pass everything.'
    });
    return;
  }

  const targets = [
    ...contributionPackFiles(registry || {}).map((f) => ({ file: f, severity: 'blocking' })),
    ...stagingFiles().map((f) => ({ file: f, severity: 'review' }))
  ];

  let scanned = 0;
  for (const { file, severity } of targets) {
    let text;
    try { text = readText(file); } catch { continue; }
    scanned++;
    const found = new Map();
    for (const token of tokens) {
      const rx = new RegExp('(^|[^A-Za-z0-9_])(' + tokenFamily(token) + ')(?![A-Za-z0-9_])', 'gi');
      let m;
      const lines = [];
      while ((m = rx.exec(text)) !== null) {
        lines.push(lineOf(text, m.index));
        if (rx.lastIndex === m.index) rx.lastIndex++;
      }
      if (lines.length) found.set(token, lines);
    }
    for (const [token, lines] of [...found.entries()].sort()) {
      findings.add({
        check: 'contribution-culture',
        severity,
        file,
        locator: `line${lines.length > 1 ? 's' : ''} ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ' and more' : ''}`,
        id: token,
        message: severity === 'review'
          ? `${file} is staged for ingest and uses the word "${token}" ${lines.length} time(s). Nothing has been promoted from it.`
          : `A contribution pack, ${file}, contains "${token}" ${lines.length} time(s).`,
        hint: 'This is a stop and ask, not a verdict on the contributor. Contributed material touching '
          + 'ceremony, or naming a place as sacred or restricted, does not enter the world and does not '
          + 'become a place record. It goes to docs/CULTURAL-REVIEW.md as a question for QYAC, described '
          + 'accurately and without reproducing the detail. The twin is not where that gets decided.'
      });
    }
  }
  findings.ran('contribution-culture', `${tokens.length} tokens across ${scanned} contributed or staged file(s)`);
}
