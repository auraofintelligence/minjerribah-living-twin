// The off-world register, checked rather than promised.
//
// WHY THIS FILE EXISTS. data/civic.json now carries a third register: known, modelled and
// speculative, per docs/DIRECTION.md item 6. The speculative half describes instruments that do not
// exist. Five rules make that defensible rather than decorative, and every one of them was a
// sentence in a document until this file made it a runnable check. docs/INGEST.md states the
// standard plainly: a rule that is not a runnable check is not a rule, and section D of
// docs/CULTURAL-REVIEW.md is the case history, where a blocking rule was written down, agreed, and
// violated inside the same repository by an agent that had read it.
//
// THE FIVE RULES, AND WHAT EACH ONE CATCHES.
//
//   1. THE ONE-WAY RULE. The register may name a lever, so that a proposal is concrete rather than
//      abstract. Nothing in the default island state may name the register. That direction is the
//      whole of the promise that turning the register on changes no number: if no lever, metric,
//      issue, institution or instrument outside the block can reach an id inside it, then no
//      simulation path can read it, whatever a future panel decides to draw. This is the check that
//      would catch the interesting failure, which is not somebody writing a bad speculative record
//      but somebody quietly wiring one into the budget six months from now.
//
//   2. NO SPECULATIVE INSTRUMENT ATTRIBUTED TO A REAL BODY. A proposal's holder must be a holder
//      record carrying `invented: true`. Naming a real regulator as the holder of an invented power
//      is a false claim about that body, and it is the specific way a register like this goes bad:
//      the invented part borrows the credibility of a real name. The check also scans the
//      structured holder and obligation fields for the label of any real body and for any
//      institution id in the pack, because the id check alone would miss prose.
//
//   3. NOTHING CULTURAL, AND NO ROUTE AROUND THE GATE. The thirteen prohibitions in data/lore.json
//      already run over the whole repository, so this adds only what they cannot see: a speculative
//      record naming QYAC, MMEIC or any native title body in a holder, an obligation or a settling
//      test. An off-world frame is not a way around data/lore.json, and the temptation to use it as
//      one is exactly why this is checked rather than trusted.
//
//   4. EVERY RECORD DECLARES ITS REGISTER, AND EVERY SPECULATIVE ONE NAMES ITS TEST. A record with
//      no register renders with no marker, which is the same failure `statusOf` exists to stop one
//      level down. A speculative record with no settling test is a wish, and docs/DIRECTION.md item
//      6 requires the test by name.
//
//   5. OFF BY DEFAULT, IN THE DATA. `default_state` must say off. The interface reads it, and a
//      pack that said on would be a pack that had quietly changed what a councillor sees.
//
// WHAT THIS CHECK DOES NOT DO. It cannot tell whether a speculative record is a good idea, and it
// does not try. It also cannot read the interface: that the panel honours `default_state` is
// checked by opening the board, not by this file. What it can do is make the boundary between the
// three registers a property of the repository rather than of the afternoon somebody wrote them.

import { readJSON, exists, walkStrings } from './lib.mjs';

const PACK = 'data/civic.json';
const REGISTERS = ['known', 'modelled', 'speculative'];

/** Arrays inside the block that hold records, with the register each is expected to be in. */
const ARRAYS = [
  ['instruments', 'known'],
  ['precedents', 'known'],
  ['readings', 'modelled'],
  ['proposals', 'speculative']
];

/** Fields on a speculative record that state who holds it or what it makes anybody do. */
const ATTRIBUTION_FIELDS = [
  'holder', 'what_it_would_oblige', 'what_it_would_be', 'settling_test', 'the_line_it_does_not_cross'
];

/**
 * Bodies whose name may never appear in an attribution field on a speculative record. Read out of
 * the pack rather than restated, so a body somebody adds tomorrow is covered tomorrow.
 */
function realBodies(doc) {
  const out = [];
  for (const inst of doc.institutions || []) {
    if (inst && typeof inst.id === 'string') out.push({ id: inst.id, label: inst.label || inst.id });
  }
  for (const h of (doc.off_world && doc.off_world.holders) || []) {
    if (h && h.invented === false) out.push({ id: h.id, label: h.label || h.id });
  }
  return out;
}

/** Every id defined anywhere inside the off_world block. */
function idsInBlock(block) {
  const out = new Set();
  (function walk(n) {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string') out.add(n.id);
    for (const v of Object.values(n)) walk(v);
  })(block);
  return out;
}

export function runOffWorldChecks(ctx) {
  const { findings } = ctx;
  if (!exists(PACK)) return;
  let doc;
  try { doc = readJSON(PACK); } catch { return; }
  const block = doc.off_world;
  if (!block || typeof block !== 'object') {
    findings.ran('off-world', 'no off_world block in data/civic.json, nothing to check');
    return;
  }

  const ids = idsInBlock(block);
  const bodies = realBodies(doc);
  let records = 0;
  let speculative = 0;

  /* ---- 5. off by default ---------------------------------------------------------------- */
  if (block.default_state !== 'off') {
    findings.add({
      check: 'off-world-default-off', severity: 'blocking', file: PACK, locator: 'off_world.default_state',
      message: `off_world.default_state is ${JSON.stringify(block.default_state)} and must be "off".`,
      hint: 'The register is turned on by a person, deliberately, and can be turned off again. A pack that '
        + 'shipped it on would have changed what somebody sees without their asking.'
    });
  }

  /* ---- 4. every record declares its register, every proposal names its test --------------- */
  for (const [name, expected] of ARRAYS) {
    const arr = block[name];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      if (!r || typeof r !== 'object') continue;
      records++;
      const at = `off_world.${name}[${i}]`;
      if (!REGISTERS.includes(r.register)) {
        findings.add({
          check: 'off-world-register-declared', severity: 'blocking', file: PACK, locator: at, id: r.id,
          message: `${at} declares register ${JSON.stringify(r.register)}, which is not one of known, modelled or speculative.`,
          hint: 'A record with no register renders with no marker, and speculative material that renders '
            + 'with no marker is the one failure this whole block exists to prevent.'
        });
      } else if (r.register !== expected) {
        findings.add({
          check: 'off-world-register-declared', severity: 'blocking', file: PACK, locator: at, id: r.id,
          message: `${at} is in off_world.${name}, which holds ${expected} records, and declares itself ${r.register}.`,
          hint: 'The array a record sits in and the register it declares have to agree, because the panel '
            + 'styles by array and a reader believes the marker.'
        });
      }
      if (r.register === 'speculative') {
        speculative++;
        if (typeof r.settling_test !== 'string' || !r.settling_test.trim()) {
          findings.add({
            check: 'off-world-names-its-test', severity: 'blocking', file: PACK, locator: at, id: r.id,
            message: `${at} is speculative and names no settling test.`,
            hint: 'docs/DIRECTION.md item 6 requires the test that would settle or move a claim. Without one '
              + 'it is a wish rather than a claim.'
          });
        }
      }
      if (r.register === 'modelled' && (typeof r.settling_test !== 'string' || !r.settling_test.trim())) {
        findings.add({
          check: 'off-world-names-its-test', severity: 'blocking', file: PACK, locator: at, id: r.id,
          message: `${at} is a modelled reading and names no settling test.`,
          hint: 'A reading with no test is an assertion wearing a label.'
        });
      }
    }
  }

  /* ---- 2 and 3. attribution --------------------------------------------------------------- */
  const holders = new Map();
  for (const h of block.holders || []) if (h && typeof h.id === 'string') holders.set(h.id, h);

  const CULTURAL = [
    { token: 'qyac', why: 'the native title body corporate' },
    { token: 'mmeic', why: 'the Moorgumpin Elders in Council' },
    { token: 'quandamooka', why: 'the Traditional Owners of this Country' },
    { token: 'native title', why: 'native title holders' },
    { token: 'traditional owner', why: 'Traditional Owners' }
  ];

  for (let i = 0; i < (block.proposals || []).length; i++) {
    const p = block.proposals[i];
    if (!p || typeof p !== 'object') continue;
    const at = `off_world.proposals[${i}]`;

    const holder = holders.get(p.holder);
    if (holder && holder.invented !== true) {
      findings.add({
        check: 'off-world-no-real-body-holds-a-fiction', severity: 'blocking', file: PACK,
        locator: `${at}.holder`, id: p.id,
        message: `${at} gives a speculative instrument to ${JSON.stringify(holder.label || p.holder)}, which the pack records as a real body.`,
        hint: 'A speculative instrument is held by an office marked invented: true, or by nothing. Giving one '
          + 'to a real regulator is a false claim about that regulator and it borrows a real name for an invented power.'
      });
    }

    for (const field of ATTRIBUTION_FIELDS) {
      const v = p[field];
      if (typeof v !== 'string') continue;
      const low = v.toLowerCase();
      for (const b of bodies) {
        if (v.includes(b.id) || (b.label.length > 6 && low.includes(b.label.toLowerCase()))) {
          findings.add({
            check: 'off-world-no-real-body-holds-a-fiction', severity: 'blocking', file: PACK,
            locator: `${at}.${field}`, id: p.id,
            message: `${at}.${field} names ${JSON.stringify(b.label)}, a real body, in a field that says who holds a speculative instrument or what it obliges.`,
            hint: 'Say what the invented office would do. A real body may be described in why_this_one or in a '
              + 'known record, and never in a field that hands it a power.'
          });
        }
      }
      for (const c of CULTURAL) {
        if (low.includes(c.token)) {
          findings.add({
            check: 'off-world-nothing-cultural', severity: 'blocking', file: PACK,
            locator: `${at}.${field}`, id: p.id,
            message: `${at}.${field} names ${JSON.stringify(c.token)} in a field that says who holds a speculative instrument or what it obliges.`,
            hint: `data/lore.json binds this register exactly as it binds the rest of the pack, and an off-world `
              + `frame is not a route around it. Nothing here speaks for ${c.why}. If the point is that the `
              + `register stops at that line, say so in a field that obliges nobody.`
          });
        }
      }
    }
  }

  /* ---- 1. the one-way rule ---------------------------------------------------------------- */
  // Every string anywhere in the pack, outside the block, that is exactly an id defined inside it.
  // Whole-string only: a sentence mentioning a treaty by name is prose, and a field holding the id
  // is a pointer, and only the second one can be read by code.
  let reaches = 0;
  for (const { value, pointer, key } of walkStrings(doc, '')) {
    if (pointer.startsWith('off_world')) continue;
    if (key === 'id') continue;
    if (!ids.has(value)) continue;
    reaches++;
    findings.add({
      check: 'off-world-one-way', severity: 'blocking', file: PACK, locator: pointer,
      message: `${pointer} names "${value}", which is defined inside off_world. The default island state may not reach the off-world register.`,
      hint: 'The register may name a lever. Nothing outside it may name the register. That direction is the whole '
        + 'of the promise that turning it on changes no number, and it is the only version of that promise a '
        + 'machine can keep.'
    });
  }

  findings.ran('off-world', `${records} record(s) in the off-world register, ${speculative} speculative, `
    + `${holders.size} holder(s) of which ${[...holders.values()].filter((h) => h.invented === true).length} invented, `
    + `${reaches} reference(s) from the default island state into the register (must be 0)`);
}
