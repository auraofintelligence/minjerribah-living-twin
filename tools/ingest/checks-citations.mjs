// Citations, and every other pointer a pack makes into itself or into another pack.
//
// WHY THIS FILE EXISTS. A critic renamed one key in data/civic.json's `source_registry`, which left
// the EPBC Act's only citation pointing at an id that no longer existed, and then ran
// `node tools/ingest/registry.mjs --refresh`, which runs the whole gate over pack content before it
// will write a checksum. It wrote. The gate resolved 105 lore ids and every pack checksum and never
// once asked whether a record's `source` named anything at all. On a project whose whole claim is
// that no governance claim goes in without a source, the harness was checking that the string was
// present and not that it meant anything.
//
// A dangling citation is worse than a missing one. A missing one is visible: the record says it has
// nothing behind it. A dangling one reads as cited, renders as cited, and resolves to nothing.
//
// TWO MODES, BECAUSE THE PACKS ARE NOT ALL THE SAME AGE.
//
//   registry   The pack declares `citation_rule.mode = "registry"`. Every citation field must hold
//              exactly one key of that pack's own `source_registry`, or exactly one of the strings
//              the pack declares in `citation_rule.uncited`, which are the honest admissions that a
//              record has no source at all and are allowed only in the collections the pack names.
//              A bare URL is a blocking fault in this mode: put it in the registry and cite the key,
//              so that one edit moves every record that rests on it.
//
//   pointer    Everything else. The older packs cite by pasting a URL, a local path or a sentence,
//              and retrofitting them is not this check's job. So it reads only the atoms that are
//              shaped like a registry key, which is what a rename breaks, and blocks on any of those
//              that resolves to nothing. Prose and URLs are counted and left alone.
//
// The plural `sources` is deliberately not a citation field. data/subterranean.json uses it for the
// heat sources feeding a cascade step, which are process ids and not citations, and a check that
// guessed would report twenty-one faults that are not faults.
//
// THE SECOND HALF: every other pointer. A citation is one kind of reference and the same hole runs
// through all of them. A lever naming a decider that no institution record defines gets a tier of
// "unknown" and is drawn anyway; a matter pointing at an ecology record that does not exist joins
// the civic layer to nothing. Those maps live in `references` in tools/ingest/schemas.json, beside
// the schema for the same pack, because they are a statement about that pack's shape.

import path from 'node:path';
import { ROOT, readJSON, exists, walkKeys } from './lib.mjs';

const SCHEMAS = 'tools/ingest/schemas.json';

/**
 * Is this key a citation? `source`, and anything ending `_source`: second_source, third_source,
 * quote_source, money_source, capacity_source, coordinate_source, operator_source and the rest.
 * Not `source_note`, `source_kind` or `source_registry`, which are prose, a classification and the
 * table itself.
 */
export function isCitationKey(key) {
  return key === 'source' || key.endsWith('_source');
}

/** Split a legacy citation into the atoms a person separated by hand. */
function atomsOf(value) {
  return String(value).split(/[,;]|\s\+\s|\band\b|\n/).map((s) => s.trim()).filter(Boolean);
}

const POINTER_SHAPE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/;
const BARE_WORD = /^[a-z0-9]+$/;
const LOOKS_LIKE_A_URL = /^(https?:\/\/|www\.)/i;
const FILE_ENDING = /\.(html|pdf|json|js|mjs|md|kml|kmz|csv|au|com|org|gov|net)$/i;

/**
 * Would a reader take this atom for a registry key? A key is lower case, has a separator in it, and
 * carries no space, no scheme and no path. A single bare word counts only when it is the whole
 * field, which is how `osm` and `brief` are cited and is not how the word "general" appears inside
 * the sentence "general knowledge".
 */
function looksLikeAKey(atom, isWholeField) {
  if (/\s/.test(atom)) return false;
  if (atom.includes('://') || atom.includes('/') || atom.includes('\\')) return false;
  if (FILE_ENDING.test(atom)) return false;
  if (POINTER_SHAPE.test(atom)) return true;
  return isWholeField && BARE_WORD.test(atom);
}

/** Bounded edit distance, so a rename can be reported as the rename it is. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 8) return 99;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** The registry key a dangling citation most probably meant, or null when nothing is close. */
function nearest(want, keys) {
  let best = null;
  let bestD = 99;
  for (const k of keys) {
    const d = distance(want, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= Math.max(3, Math.round(want.length * 0.4)) ? best : null;
}

/** `levers[12].source` becomes `levers[]`, which is how the schemas and the registry name a place. */
function collectionOf(pointer) {
  const flat = pointer.replace(/\[\d+\]/g, '[]');
  const cut = flat.lastIndexOf('.');
  return cut < 0 ? flat : flat.slice(0, cut);
}

/* ------------------------------------------------------------------ citations */

function checkPackCitations(ctx, file, doc) {
  const { findings } = ctx;
  const registry = doc.source_registry;
  const keys = Object.keys(registry);
  const keySet = new Set(keys);
  const rule = doc.citation_rule && typeof doc.citation_rule === 'object' ? doc.citation_rule : null;
  const mode = rule && rule.mode === 'registry' ? 'registry' : 'pointer';
  const uncited = new Map(Object.entries((rule && rule.uncited) || {}));
  const allowedIn = new Set((rule && rule.uncited_allowed_in) || []);
  const used = new Set();
  let fields = 0;

  // A registry entry that resolves to nothing is the same hole seen from the other end. Two shapes
  // are in use and both are fine: data/civic.json maps an id to one string, and
  // data/subterranean.json maps an id to a { url, claim } pair, which says more rather than less.
  // What is not fine is an id mapped to nothing at all.
  for (const k of keys) {
    const v = registry[k];
    const empty = v === null || v === undefined
      || (typeof v === 'string' && !v.trim())
      || (typeof v === 'object' && !Object.values(v).some((x) => typeof x === 'string' && x.trim()));
    if (empty) {
      findings.add({
        check: 'citations-resolve', severity: 'blocking', file, locator: `source_registry.${k}`, id: k,
        message: `${file} registers the source "${k}" with nothing behind it.`,
        hint: 'A registry entry is a URL, a document id or a sentence saying where the thing was read. An empty one makes every record citing it read as cited.'
      });
    }
  }

  for (const { key, pointer, value } of walkKeys(doc, '')) {
    if (!isCitationKey(key)) continue;
    if (pointer.startsWith('source_registry.')) continue;
    const list = Array.isArray(value) ? value : [value];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const at = Array.isArray(value) ? `${pointer}[${i}]` : pointer;
      // An explicit null is an absence, not a dangling pointer, and it is sometimes the right
      // answer: data/transport.json leaves the Stradbroke Flyer terminal's coordinate_source null
      // beside a note saying the coordinate was not guessed. Whether a record cites anything at all
      // is the record-envelope check's question and it is ratcheted there. A field holding an empty
      // string is a different thing: it reads as filled in and resolves to nothing.
      if (raw === null || raw === undefined) continue;
      if (typeof raw !== 'string' || !raw.trim()) {
        findings.add({
          check: 'citations-resolve', severity: 'blocking', file, locator: at,
          message: `${file} ${at} is a citation field holding ${raw === '' ? 'an empty string' : JSON.stringify(raw)}.`,
          hint: 'Cite a key of this pack\'s source_registry, use null to say plainly that there is none, or delete the field.'
        });
        continue;
      }
      fields++;
      const trimmed = raw.trim();

      if (mode === 'registry') {
        if (keySet.has(trimmed)) { used.add(trimmed); continue; }
        if (uncited.has(trimmed)) {
          const where = collectionOf(at);
          if (allowedIn.size && !allowedIn.has(where)) {
            findings.add({
              check: 'citations-resolve', severity: 'blocking', file, locator: at,
              message: `${file} ${at} says "${trimmed}", which this pack declares is not a citation, on a record in ${where}.`,
              hint: `citation_rule.uncited_allowed_in permits that only in: ${[...allowedIn].join(', ')}. Everywhere else it is a claim about the real world and needs a source.`
            });
          }
          continue;
        }
        const guess = nearest(trimmed, keys);
        findings.add({
          check: 'citations-resolve', severity: 'blocking', file, locator: at,
          message: LOOKS_LIKE_A_URL.test(trimmed)
            ? `${file} ${at} cites a bare URL rather than a source_registry key.`
            : `${file} ${at} cites "${trimmed}", which is not in this pack's source_registry. The citation resolves to nothing.`,
          hint: LOOKS_LIKE_A_URL.test(trimmed)
            ? 'Add it to source_registry with an id and cite the id, so one edit moves every record that rests on it.'
            : (guess ? `The closest registered id is "${guess}". If that is a rename, every record citing the old id has to move with it.` : 'Add the source to source_registry, or say plainly that this record has none.')
        });
        continue;
      }

      // pointer mode
      const atoms = atomsOf(trimmed);
      const whole = atoms.length === 1;
      for (const atom of atoms) {
        if (!looksLikeAKey(atom, whole)) continue;
        if (keySet.has(atom)) { used.add(atom); continue; }
        const guess = nearest(atom, keys);
        findings.add({
          check: 'citations-resolve', severity: 'blocking', file, locator: at,
          message: `${file} ${at} cites "${atom}", which is shaped like a source_registry key and is not one. The citation resolves to nothing.`,
          hint: guess ? `The closest registered id is "${guess}".` : 'Add it to source_registry, or write the source out in full so nobody reads it as a pointer.'
        });
      }
    }
  }

  // The other end of a rename: an entry nothing cites any more. Advisory, because a registry may
  // honestly carry a source that is about to be used, and because this must never be the finding
  // that trains somebody to ignore the check above.
  const orphans = keys.filter((k) => !used.has(k));
  if (orphans.length) {
    findings.add({
      check: 'citations-resolve', severity: 'advisory', file, locator: 'source_registry',
      message: `${file} registers ${orphans.length} source that nothing cites: ${orphans.join(', ')}.`,
      hint: 'Either a record should be citing it, or it is the leftover half of a rename.'
    });
  }
  return { fields, mode };
}

/* ------------------------------------------------------------------ every other pointer */

/** Walk a dotted path with `[]` array steps and yield every string leaf with a readable pointer. */
function* valuesAt(node, segments, pointer) {
  if (node === undefined || node === null) return;
  if (!segments.length) {
    if (typeof node === 'string') { yield { pointer, value: node }; return; }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') yield { pointer: `${pointer}[${i}]`, value: node[i] };
      }
    }
    return;
  }
  const [head, ...rest] = segments;
  const isArray = head.endsWith('[]');
  const key = isArray ? head.slice(0, -2) : head;
  const child = typeof node === 'object' ? node[key] : undefined;
  if (child === undefined) return;
  const here = pointer ? `${pointer}.${key}` : key;
  if (isArray) {
    if (!Array.isArray(child)) return;
    for (let i = 0; i < child.length; i++) yield* valuesAt(child[i], rest, `${here}[${i}]`);
    return;
  }
  yield* valuesAt(child, rest, here);
}

/** Every id anywhere in a parsed pack. Used when a reference points into another file. */
function everyId(doc) {
  const out = new Set();
  (function walk(n) {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string') out.add(n.id);
    for (const v of Object.values(n)) walk(v);
  })(doc);
  return out;
}

/** Every key of the object at a dotted path. A vocabulary is often written as the keys of a map. */
function keysAt(doc, dotted) {
  let node = doc;
  for (const seg of dotted.split('.')) {
    if (!node || typeof node !== 'object') return new Set();
    node = node[seg];
  }
  return node && typeof node === 'object' && !Array.isArray(node) ? new Set(Object.keys(node)) : new Set();
}

/** The set a reference has to land in, described by the `into` string in the schema. */
function targetSet(into, doc, cache) {
  if (into === 'file') return null;                          // handled by the caller
  if (into.endsWith('{}')) return keysAt(doc, into.slice(0, -2));
  if (into.includes('#')) {
    const [f, what] = into.split('#');
    if (!exists(f)) return new Set();
    if (!cache.has(f)) cache.set(f, readJSON(f));
    const other = cache.get(f);
    return what === 'id' ? everyId(other) : new Set([...valuesAt(other, what.split('.'), '')].map((x) => x.value));
  }
  const segs = into.split('.');
  return new Set([...valuesAt(doc, segs, '')].map((x) => x.value));
}

function checkPackReferences(ctx, file, doc, references) {
  const { findings } = ctx;
  const cache = new Map();
  let checked = 0;
  for (const ref of references) {
    if (!ref || !ref.from || !ref.into) continue;
    const into = ref.into;
    let allowed = null;
    try { allowed = targetSet(into, doc, cache); } catch (e) {
      findings.add({
        check: 'references-resolve', severity: 'blocking', file, locator: ref.from,
        message: `The reference map for ${file} points at ${into}, which could not be read: ${e.message}`
      });
      continue;
    }
    for (const { pointer, value } of valuesAt(doc, ref.from.split('.'), '')) {
      checked++;
      if (into === 'file') {
        if (exists(value)) continue;
        findings.add({
          check: 'references-resolve', severity: 'blocking', file, locator: pointer,
          message: `${file} ${pointer} points at ${value}, and there is no such file in this repository.`,
          hint: ref.why || 'A pointer at a file that was deleted or renamed reads as a working link.'
        });
        continue;
      }
      if (allowed.has(value)) continue;
      findings.add({
        check: 'references-resolve', severity: 'blocking', file, locator: pointer,
        message: `${file} ${pointer} names "${value}", which is not in ${into}. The reference resolves to nothing.`,
        hint: ref.why || 'Every id a record names has to exist, or the record is describing something the twin cannot find.'
      });
    }
  }
  return checked;
}

/* ------------------------------------------------------------------ the step */

export function runCitationChecks(ctx) {
  const { findings, registry } = ctx;
  const packs = (registry && registry.packs) || [];
  let schemas = { packs: {} };
  if (exists(SCHEMAS)) {
    try { schemas = readJSON(SCHEMAS); } catch { schemas = { packs: {} }; }
  }

  let withRegistry = 0;
  let strict = 0;
  let fields = 0;
  let refs = 0;
  let mapped = 0;

  for (const entry of packs) {
    const file = entry.file || `data/${entry.id}.json`;
    if (!exists(file)) continue;
    let doc;
    try { doc = readJSON(file); } catch { continue; }   // pack-parses reports the parse failure
    if (doc && doc.source_registry && typeof doc.source_registry === 'object' && !Array.isArray(doc.source_registry)) {
      withRegistry++;
      const r = checkPackCitations(ctx, file, doc);
      fields += r.fields;
      if (r.mode === 'registry') strict++;
    }
    const schema = (schemas.packs || {})[entry.id];
    if (schema && Array.isArray(schema.references) && schema.references.length) {
      mapped++;
      refs += checkPackReferences(ctx, file, doc, schema.references);
    }
  }

  findings.ran('citations-resolve', `${fields} citation field(s) across ${withRegistry} pack(s) with a source registry, ${strict} of them under the strict registry rule`);
  findings.ran('references-resolve', `${refs} reference(s) across ${mapped} pack(s) with a reference map in tools/ingest/schemas.json`);
}

// Kept so a person fixing one pack can run this alone:
//   node tools/ingest/checks-citations.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(ROOT, 'tools/ingest/checks-citations.mjs'))) {
  const { Findings } = await import('./lib.mjs');
  const findings = new Findings();
  const reg = exists('data/_provenance.json') ? readJSON('data/_provenance.json') : { packs: [] };
  runCitationChecks({ findings, registry: reg });
  for (const i of findings.items) console.log(`[${i.severity}] ${i.file} ${i.locator}\n    ${i.message}${i.hint ? '\n    -> ' + i.hint : ''}`);
  for (const c of findings.checksRun) console.log(`${c.check}: ${c.note}`);
  process.exit(findings.blocking.length ? 1 : 0);
}
