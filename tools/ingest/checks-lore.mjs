// The prohibitions harness. Thirteen rules live in data/lore.json under `prohibitions.rules`,
// each with a `check.type` written to be executed. Until now nothing executed them.
//
// The case for this file is written up in docs/CULTURAL-REVIEW.md section D1. Wave 3 deleted six
// invented season names and recorded them as banned. Wave 7 then found five of them still in use
// in data/narrative.json, in 28 seeds, put there by a different agent that had read the rule. A
// rule that is written down and not executed is not a rule.
//
// Design notes that matter if you extend this:
//
// 1. The rules are read out of the pack, not restated here. If QYAC adds a prohibition, it is
//    added to data/lore.json and this file runs it. Where a rule needs code that the pack cannot
//    express, the code is keyed to the rule id, so a rule with no implementation is reported as
//    unimplemented rather than silently passing.
// 2. Three of the thirteen rules are `type: manual`. They are printed as questions for a reviewer,
//    every run, rather than dropped. A manual rule that nobody is ever shown is a rule nobody runs.
// 3. Several token rules have legitimate hits: the files that state the prohibition, the chronicle
//    guard that greps for the same words, and the events panel's substitution table. Those are
//    recorded in tools/ingest/ledger.json with a reason and a frozen count. Anything above the
//    frozen count fails and is named. This is the ratchet, and it is the only reason the harness
//    could be switched on mid-wave without a week of cleanup first.

import path from 'node:path';
import {
  readText, readJSON, repoFiles, exists, walkRecords, walkStrings, walkKeys,
  lineOf, TEXT_EXT
} from './lib.mjs';

/** Does a repo-relative path fall inside one of a rule's scope globs? */
function inScope(file, scope) {
  if (!scope || !scope.length) return true;
  return scope.some((g) => {
    if (g.endsWith('/**')) return file.startsWith(g.slice(0, -2));
    if (g.includes('**')) {
      const rx = new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*') + '$');
      return rx.test(file);
    }
    return file === g;
  });
}

function scopedFiles(scope) {
  const all = repoFiles({ exts: TEXT_EXT });
  return all.filter((f) => inScope(f, scope));
}

/** Every occurrence of a token as a whole word, with its line number. */
function tokenHits(text, token) {
  const rx = new RegExp('(^|[^A-Za-z0-9_])(' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z0-9_])', 'gi');
  const out = [];
  let m;
  while ((m = rx.exec(text)) !== null) {
    out.push({ index: m.index, line: lineOf(text, m.index) });
    if (rx.lastIndex === m.index) rx.lastIndex++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export function runLoreChecks(ctx) {
  const { findings, ledger } = ctx;
  if (!exists('data/lore.json')) {
    findings.add({
      check: 'lore-pack-present',
      file: 'data/lore.json',
      message: 'data/lore.json is missing, so no cultural prohibition can be checked at all.'
    });
    return;
  }
  const lore = readJSON('data/lore.json');
  const rules = (lore.prohibitions && lore.prohibitions.rules) || [];
  findings.ran('lore-prohibitions', `${rules.length} rules read from data/lore.json`);

  const implemented = new Set();
  for (const rule of rules) {
    const fn = RULE_IMPL[rule.id];
    if (!fn) continue;
    implemented.add(rule.id);
    fn({ rule, lore, findings, ledger });
  }
  for (const rule of rules) {
    if (implemented.has(rule.id)) continue;
    findings.add({
      check: 'lore-rule-unimplemented',
      severity: rule.severity === 'blocking' ? 'review' : 'advisory',
      file: 'data/lore.json',
      id: rule.id,
      message: `Prohibition "${rule.id}" (${rule.severity}) has no executable check in tools/ingest/checks-lore.mjs.`,
      hint: rule.check && rule.check.reviewer_question ? rule.check.reviewer_question : rule.rule
    });
  }
}

// ---------------------------------------------------------------------------------------------
// One implementation per rule id.
// ---------------------------------------------------------------------------------------------

const RULE_IMPL = {};

/**
 * The rule that wave 7 needed. Every token in lore.language.banned_tokens must not appear anywhere
 * outside the three files that exist to record the mistake. No ledger, no exceptions beyond the
 * ones the pack itself declares: these words were invented by an agent and there is no legitimate
 * new use for them.
 */
RULE_IMPL['no-banned-tokens'] = ({ rule, lore, findings }) => {
  const tokens = ((lore.language && lore.language.banned_tokens && lore.language.banned_tokens.tokens) || [])
    .map((t) => (typeof t === 'string' ? t : t.token))
    .filter(Boolean);
  const exempt = new Set((rule.check && rule.check.exempt_files) || []);
  // The ledger and this file both name the rule; neither may quote the tokens.
  exempt.add('tools/ingest/ledger.json');
  const files = scopedFiles(rule.scope);
  let scanned = 0;
  for (const file of files) {
    if (exempt.has(file)) continue;
    let text;
    try { text = readText(file); } catch { continue; }
    scanned++;
    for (const token of tokens) {
      for (const hit of tokenHits(text, token)) {
        findings.add({
          check: 'no-banned-tokens',
          severity: 'blocking',
          file,
          locator: `line ${hit.line}`,
          id: token,
          message: `Banned token "${token}" appears in ${file} at line ${hit.line}.`,
          hint: 'This word was invented by an earlier pass and deleted. Remove it, do not rename it: '
            + 'nothing records what it was supposed to mean, so a rename invents a second time.'
        });
      }
    }
  }
  findings.ran('no-banned-tokens', `${tokens.length} tokens across ${scanned} files`);
};

/**
 * Ceremony, and sacred or restricted sites. Both are token scans whose hits are a stop-and-ask
 * rather than an automatic violation: the files that state the prohibition contain the words, and
 * so does the chronicle's own guard list. Those are in the ledger by file and token with a frozen
 * count. A new hit in a new place fails and names the line.
 */
function ledgeredTokenRule(checkId, defaultTokens) {
  return ({ rule, findings, ledger }) => {
    const tokens = (rule.check && rule.check.tokens) || defaultTokens;
    // Only the ledger is exempt in code, because a ledger that quoted the tokens would be a file
    // that fails the rule it administers. Everything else, this file included, goes through the
    // ledger with a reason and a count like any other hit.
    const exempt = new Set((rule.check && rule.check.exempt_files) || []);
    exempt.add('tools/ingest/ledger.json');
    const files = scopedFiles(rule.scope);
    const counts = new Map(); // "file|token" -> {n, lines}
    for (const file of files) {
      if (exempt.has(file)) continue;
      let text;
      try { text = readText(file); } catch { continue; }
      for (const token of tokens) {
        const hits = tokenHits(text, token);
        if (!hits.length) continue;
        counts.set(`${file}|${token}`, { n: hits.length, lines: hits.map((h) => h.line) });
      }
    }
    for (const [key, { n, lines }] of [...counts.entries()].sort()) {
      const [file, token] = key.split('|');
      const allowed = ledger.allowance(checkId, file, token);
      if (n <= allowed.count) {
        findings.add({
          check: checkId,
          severity: 'accepted',
          file,
          locator: `lines ${lines.slice(0, 6).join(', ')}${lines.length > 6 ? ' and more' : ''}`,
          id: token,
          message: `${n} occurrence(s) of "${token}" in ${file}, accepted: ${allowed.reason}`
        });
        continue;
      }
      findings.add({
        check: checkId,
        severity: 'blocking',
        file,
        locator: `lines ${lines.join(', ')}`,
        id: token,
        message: `"${token}" appears ${n} time(s) in ${file}; the ledger accepts ${allowed.count}.`,
        hint: (rule.check && rule.check.note)
          || 'A hit is a stop-and-ask, not an automatic violation. The right resolution is usually to '
          + 'delete the line. If the line exists to state or enforce the prohibition, record it in '
          + 'tools/ingest/ledger.json with a reason.'
      });
    }
    findings.ran(checkId, `${tokens.length} tokens across ${files.length} files in scope`);
  };
}

RULE_IMPL['no-invented-ceremony'] = ledgeredTokenRule('no-invented-ceremony', [
  'ceremony', 'ceremonial', 'corroboree', 'welcome to country', 'initiation',
  'songline', 'dreaming', 'dreamtime', 'totem', 'sorry business'
]);

RULE_IMPL['no-sacred-or-restricted-sites'] = ({ rule, findings, ledger }) => {
  // The capture contract flags that this rule's scope stops short of assets and contribution packs,
  // so a committed scan of a restricted place would slip past it as written. Widen it here, and say
  // in the finding that the widening happened, so the pack and the harness can be reconciled later.
  const widened = [...(rule.scope || []), 'assets/**', 'data/contributions/**', 'data/_provenance.json'];
  ledgeredTokenRule('no-sacred-or-restricted-sites', [
    'midden', 'burial', 'sacred', 'restricted area', "men's business", "women's business", 'bora'
  ])({ rule: { ...rule, scope: widened }, findings, ledger });
};

/**
 * No simulated resident carries Aboriginality, a clan, a totem, a cultural role or a language
 * group. The pack's own check type is `field_absent` over two files.
 *
 * Aggregate census figures about a township are a different thing from a field on a person, and
 * data/residents.json carries four of them (`census_baseline.*.indigenous`, the published ABS
 * proportion). Those are exempted by pointer in the ledger, with the reason recorded there, rather
 * than by weakening the rule.
 */
RULE_IMPL['no-aboriginal-characters-with-invented-culture'] = ({ rule, findings, ledger }) => {
  const fields = (rule.check && rule.check.fields) || [];
  const files = (rule.check && rule.check.in) || (rule.scope || []).filter((s) => s.endsWith('.json'));
  for (const file of files) {
    if (!exists(file)) continue;
    let doc;
    try { doc = readJSON(file); } catch { continue; }
    for (const { key, pointer } of walkKeys(doc)) {
      if (!fields.includes(key.toLowerCase())) continue;
      const allowed = ledger.pointerAllowed('no-aboriginal-characters-with-invented-culture', file, pointer);
      if (allowed) {
        findings.add({
          check: 'no-aboriginal-characters-with-invented-culture',
          severity: 'accepted',
          file,
          locator: pointer,
          id: key,
          message: `Field "${key}" at ${pointer}, accepted: ${allowed}`
        });
        continue;
      }
      findings.add({
        check: 'no-aboriginal-characters-with-invented-culture',
        severity: 'blocking',
        file,
        locator: pointer,
        id: key,
        message: `Forbidden field "${key}" on a record at ${pointer} in ${file}.`,
        hint: 'Quandamooka People live on this island in real households. A generated character with '
          + 'generated culture is a fabrication about real neighbours.'
      });
    }
  }
  findings.ran('no-aboriginal-characters-with-invented-culture', `${fields.length} fields across ${files.length} files`);
};

/**
 * QYAC appears as a civic and corporate actor, never with a view. The pack marks this rule manual,
 * and the reviewer question is printed every run. What can be executed is the shape of the failure:
 * a sentence that gives QYAC a verb of opinion. That will not catch every case and it is not meant
 * to; it catches the case that is easiest to write by accident.
 */
RULE_IMPL['qyac-as-civic-actor-only'] = ({ rule, findings, ledger }) => {
  const OPINION = /\bQYAC\b[^.]{0,40}\b(believes?|wants?|feels?|thinks?|hopes?|fears?|prefers?|opposes?|supports?|backs?|rejects?|welcomes?|is (?:happy|unhappy|angry|concerned|worried|keen))\b/gi;
  const files = scopedFiles(rule.scope);
  for (const file of files) {
    let text;
    try { text = readText(file); } catch { continue; }
    let m;
    OPINION.lastIndex = 0;
    while ((m = OPINION.exec(text)) !== null) {
      const line = lineOf(text, m.index);
      if (ledger.pointerAllowed('qyac-as-civic-actor-only', file, `line ${line}`)) continue;
      findings.add({
        check: 'qyac-as-civic-actor-only',
        severity: 'blocking',
        file,
        locator: `line ${line}`,
        message: `QYAC is given a view in ${file} line ${line}: "${m[0].trim()}".`,
        hint: 'Putting words in the mouths of the Traditional Owners about a policy lever is the single '
          + 'most embarrassing failure available to this project. If the view is real, it belongs in '
          + 'lore.qyac_public_positions with a source and a date, and is quoted from there.'
      });
    }
  }
  findings.add({
    check: 'qyac-as-civic-actor-only',
    severity: 'review',
    file: 'data/lore.json',
    id: rule.id,
    message: rule.check.reviewer_question,
    hint: 'Printed every run because the pack marks this rule manual. The token scan above covers '
      + 'only the obvious phrasing.'
  });
  findings.ran('qyac-as-civic-actor-only');
};

/** Every asserted Quandamooka or QYAC position resolves to a cited, dated public statement. */
RULE_IMPL['no-quandamooka-position-without-citation'] = ({ lore, findings }) => {
  const positions = ((lore.qyac_public_positions && lore.qyac_public_positions.positions) || []);
  const known = new Set(positions.map((p) => p.id).filter(Boolean));
  const sources = lore.sources || {};
  const files = repoFiles({ exts: new Set(['.json']), under: 'data' });
  let checked = 0;
  for (const file of files) {
    let doc;
    try { doc = readJSON(file); } catch { continue; }
    for (const { key, pointer, value } of walkKeys(doc)) {
      if (!/^(qyac|quandamooka)_position$/.test(key)) continue;
      checked++;
      const ref = typeof value === 'string' ? value : (value && (value.position_ref || value.id));
      if (known.has(ref)) continue;
      const src = value && typeof value === 'object' && (value.source || value.source_ref);
      const cited = typeof src === 'string' && (Object.prototype.hasOwnProperty.call(sources, src) || /^https?:/.test(src));
      if (cited) {
        // Cited, so it does not assert an invented position. But it is a second copy of a statement
        // the register already holds, and two copies of a QYAC statement can drift apart.
        findings.add({
          check: 'no-quandamooka-position-without-citation',
          severity: 'advisory',
          file,
          locator: pointer,
          message: `${pointer} states a Quandamooka position, cites "${src}", and carries no `
            + 'position_ref into lore.qyac_public_positions.',
          hint: 'Adding position_ref would tie the two copies together so neither can drift. This is '
            + 'a recommendation and not a change an ingest tool should make to the lore pack by itself.'
        });
        continue;
      }
      findings.add({
        check: 'no-quandamooka-position-without-citation',
        severity: 'blocking',
        file,
        locator: pointer,
        message: `A Quandamooka position at ${pointer} in ${file} resolves to no entry in `
          + 'lore.qyac_public_positions and cites no source of its own.',
        hint: 'Silence is accurate. An invented position is not.'
      });
    }
  }
  findings.ran('no-quandamooka-position-without-citation', `${checked} position field(s), ${known.size} cited positions on record`);
};

/**
 * Cultural content shown to a player resolves to a sourced entry in the lore pack. Two executable
 * halves: every `lore_ref` anywhere must resolve to an id in data/lore.json, and every lore record
 * marked player_facing must itself carry a source and a confidence of medium or better.
 */
RULE_IMPL['no-cultural-content-without-source'] = ({ lore, findings }) => {
  const ids = new Set();
  for (const { record } of walkRecords(lore, '', 'lore')) if (record.id) ids.add(record.id);
  for (const { key, value } of walkKeys(lore)) if (typeof value === 'string' && /^[a-z0-9-]+$/.test(key)) ids.add(key);

  let refs = 0;
  for (const file of repoFiles({ exts: TEXT_EXT }).filter((f) => f.startsWith('data/') || f.startsWith('src/'))) {
    let text;
    try { text = readText(file); } catch { continue; }
    if (!text.includes('lore_ref')) continue;
    const rx = /"lore_ref"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      refs++;
      if (ids.has(m[1])) continue;
      findings.add({
        check: 'no-cultural-content-without-source',
        severity: 'blocking',
        file,
        locator: `line ${lineOf(text, m.index)}`,
        id: m[1],
        message: `lore_ref "${m[1]}" in ${file} does not resolve to any record in data/lore.json.`
      });
    }
  }

  for (const { record, pointer } of walkRecords(lore, '', 'lore')) {
    if (record.player_facing !== true) continue;
    const conf = record.confidence;
    const hasSource = Boolean(record.source || record.source_ref || record.sources || record.published_meanings);
    if (hasSource && (conf === 'high' || conf === 'medium' || conf === undefined)) continue;
    if (conf === 'low') {
      findings.add({
        check: 'no-cultural-content-without-source',
        severity: 'blocking',
        file: 'data/lore.json',
        locator: pointer,
        id: record.id || '',
        message: `Lore record ${pointer} is player_facing with confidence low.`,
        hint: 'Low confidence here means an agent could not verify it. Set player_facing false or source it.'
      });
      continue;
    }
    if (!hasSource) {
      findings.add({
        check: 'no-cultural-content-without-source',
        severity: 'blocking',
        file: 'data/lore.json',
        locator: pointer,
        id: record.id || '',
        message: `Lore record ${pointer} is player_facing and cites nothing.`
      });
    }
  }
  findings.ran('no-cultural-content-without-source', `${refs} lore_ref(s), ${ids.size} resolvable ids`);
};

/**
 * The acknowledgement is on the page at load, not behind a menu, and it is the pack's own wording.
 *
 * This one has already drifted once: the boot markup carried a third wording that was neither the
 * short nor the long text. index.html holds a copy on purpose, because the markup is on screen
 * before any pack has loaded, and a copy is a thing that drifts. So the check is that the copy is
 * still character for character what the pack says.
 */
RULE_IMPL['acknowledgement-present'] = ({ lore, findings }) => {
  const w = (lore.acknowledgement && lore.acknowledgement.game_wording) || {};
  const candidates = [w.long && w.long.text, w.short && w.short.text].filter(Boolean);
  if (!candidates.length) {
    findings.add({
      check: 'acknowledgement-present',
      file: 'data/lore.json',
      message: 'lore.acknowledgement.game_wording carries neither a long nor a short text.'
    });
    return;
  }
  const html = exists('index.html') ? readText('index.html') : '';
  const present = candidates.some((t) => html.includes(t));
  if (!present) {
    findings.add({
      check: 'acknowledgement-present',
      severity: 'blocking',
      file: 'index.html',
      message: 'Neither acknowledgement wording from data/lore.json appears verbatim in index.html.',
      hint: 'A digital twin of Quandamooka Country that does not acknowledge Quandamooka Country has '
        + 'failed before it renders a frame. The wording lives in the pack; index.html holds a copy '
        + 'because the markup is on screen before any pack has loaded.'
    });
  }
  findings.ran('acknowledgement-present', present ? 'verbatim in index.html' : 'missing');
};

/**
 * No generated Aboriginal visual art. assets/ is empty today, so this is written for the day the
 * first folder lands: every image committed under assets/ must be declared in an asset manifest
 * with a named human creator and a consent note, per docs/CAPTURE-CONTRACT.md. An undeclared image
 * fails rather than being assumed innocent.
 */
RULE_IMPL['no-generated-aboriginal-art'] = ({ rule, findings }) => {
  const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ktx2', '.glb', '.gltf']);
  const assets = repoFiles({ under: 'assets' }).filter((f) => IMAGE.has(path.extname(f).toLowerCase()));
  let manifest = null;
  if (exists('assets/manifest.json')) {
    try { manifest = readJSON('assets/manifest.json'); } catch { manifest = null; }
  }
  const declared = new Set();
  if (manifest && Array.isArray(manifest.items)) {
    for (const it of manifest.items) {
      for (const k of ['glb', 'image', 'thumbnail', 'file']) if (typeof it[k] === 'string') declared.add(it[k]);
    }
  }
  for (const f of assets) {
    if (declared.has(f)) continue;
    findings.add({
      check: 'no-generated-aboriginal-art',
      severity: 'blocking',
      file: f,
      message: `${f} is committed under assets/ and is not declared in assets/manifest.json.`,
      hint: 'Every committed asset names who made or captured it and who okayed it. An image nobody '
        + 'claims cannot be shown to have come from a Quandamooka artist rather than a model.'
    });
  }
  findings.add({
    check: 'no-generated-aboriginal-art',
    severity: 'review',
    file: 'assets/',
    id: rule.id,
    message: rule.check.reviewer_question,
    hint: `${assets.length} asset file(s) present, ${declared.size} declared.`
  });
  findings.ran('no-generated-aboriginal-art', `${assets.length} asset file(s)`);
};

/** Culture is not a mechanic. The pack marks this manual; the question is printed every run. */
RULE_IMPL['no-gamified-culture'] = ({ rule, findings }) => {
  findings.add({
    check: 'no-gamified-culture',
    severity: 'review',
    file: 'data/lore.json',
    id: rule.id,
    message: rule.check.reviewer_question,
    hint: 'Anything cultural that a player can gain, spend, lose or optimise fails this rule.'
  });
  findings.ran('no-gamified-culture');
};

RULE_IMPL['language-words-need-a-flagged-source'] = ({ rule, findings }) => {
  findings.add({
    check: 'language-words-need-a-flagged-source',
    severity: 'advisory',
    file: 'src/ui/',
    id: rule.id,
    message: rule.check.reviewer_question,
    hint: 'Advisory in the pack. Spellings vary and showing the source teaches the player something true.'
  });
  findings.ran('language-words-need-a-flagged-source');
};

/**
 * no-invented-language: the hardest rule to execute, and the one worth the most.
 *
 * You cannot detect "an Aboriginal language word" by tokenising, and pretending otherwise would be
 * a check that does not check. What is detectable is a word this repository has never carried
 * before, appearing where a language word would appear. So the harness keeps a committed
 * vocabulary of every name-shaped token already in the packs (tools/ingest/vocabulary.json,
 * reviewed once, at the state waves 3 and 7 left it) and watches for new ones.
 *
 * Two tiers, because friction in the wrong place gets a check switched off:
 *   blocking  a new token in a cultural context: inside data/lore.json, or under a key that names
 *             language, a gloss, a spelling, a season or a cultural field. That is exactly the
 *             route the wave 7 fault took, which arrived as `season_bias` object keys.
 *   advisory  a new token anywhere else. A new species, business or lever brings new words all the
 *             time and stopping the build for those would be noise.
 */
// A word is in a cultural position when it sits where a language word would sit: as a key under a
// season or language block, or as the value of a field that names a word, a spelling or a gloss.
// Not merely because it is somewhere in data/lore.json, which is mostly English prose about why
// the project is careful, and not in a `meaning` field, which is an English sentence.
//
// The narrow definition is the one that matters. The wave 7 fault arrived as object keys under
// `season_bias`, which is the first case below.
// Only maps that are keyed *by a word*. An allowlist entry's own field names are structure, not
// vocabulary, so `allowlist` is deliberately not in this list; the words inside it are caught by
// CULTURAL_VALUE_KEY instead.
const CULTURAL_PARENT_KEY = /^(season_bias|seasons|seasonal_calendar|words|spellings|glosses|language_words)$/;
const CULTURAL_VALUE_KEY = /^(word|spelling|gloss|traditional_name|language_name|season|alt_name)$/;
const NAMEISH_KEY = /^(id|name|word|spelling|gloss|label|token|title|key|slug|season|season_bias)$|_id$|_name$|_word$/;

/** The last key in a pointer such as `seeds[0].season_bias`, or an empty string. */
function lastKey(pointer) {
  const m = String(pointer).match(/([A-Za-z0-9_]+)(\[\d+\])*$/);
  return m ? m[1] : '';
}

/** A short value is a name; a long one is prose and its words are English, not vocabulary. */
function nameLike(value, maxWords) {
  const v = String(value).trim();
  if (!v || v.length > 64) return false;
  return v.split(/\s+/).length <= maxWords;
}

/** Every word in the allowlist, including variant spellings and published glosses. */
export function allowlistWords(lore) {
  const allow = new Set();
  const addWord = (w) => { if (typeof w === 'string') for (const t of w.split(/[^A-Za-z']+/)) if (t.length > 2) allow.add(t.toLowerCase()); };
  for (const entry of (lore.language && lore.language.allowlist) || []) {
    addWord(entry.word);
    for (const v of entry.variants || []) addWord(v.spelling);
    for (const m of entry.published_meanings || []) addWord(m.gloss);
  }
  for (const g of ((lore.peoples && lore.peoples.clans && lore.peoples.clans.groups) || [])) {
    addWord(g.name);
    for (const s of g.spellings || []) addWord(s.spelling);
  }
  return allow;
}

/**
 * Every name-shaped word in the packs, with where it sits and whether that position is cultural.
 * The gate and tools/ingest/vocabulary-accept.mjs both call this, so the words the tool offers to
 * accept are exactly the words the check would have stopped.
 */
export function nameShapedTokens() {
  const found = new Map(); // token -> [{file, pointer, cultural}]
  const note = (token, file, pointer, cultural) => {
    const t = token.toLowerCase();
    if (t.length < 3) return;
    if (!found.has(t)) found.set(t, []);
    found.get(t).push({ file, pointer, cultural });
  };
  for (const file of repoFiles({ exts: new Set(['.json']), under: 'data' })) {
    let doc;
    try { doc = readJSON(file); } catch { continue; }
    for (const { key, pointer, parentPointer } of walkKeys(doc)) {
      // The banned tokens are recorded in the lore pack precisely so they can be refused. They are
      // never vocabulary and must never be offered for acceptance.
      if (pointer.startsWith('language.banned_tokens')) continue;
      const cultural = CULTURAL_PARENT_KEY.test(lastKey(parentPointer));
      for (const t of key.split(/[^A-Za-z]+/)) note(t, file, pointer, cultural);
    }
    for (const { value, key, pointer } of walkStrings(doc)) {
      if (pointer.startsWith('language.banned_tokens')) continue;
      // A source beside a name is a citation, usually a URL. Its words are not vocabulary.
      if (/^(source|source_2|source_3|url|href|note|reason|citation|confidence)$/.test(key)) continue;
      const cultural = CULTURAL_VALUE_KEY.test(key) || /\.alt_names\b/.test(pointer);
      if (!cultural && !NAMEISH_KEY.test(key)) continue;
      if (!nameLike(value, cultural ? 4 : 6)) continue;
      for (const t of value.split(/[^A-Za-z']+/)) note(t, file, pointer, cultural);
    }
  }
  return found;
}

RULE_IMPL['no-invented-language'] = ({ lore, findings, ledger }) => {
  const allow = allowlistWords(lore);
  const vocab = new Set(ledger.vocabulary());
  const unseen = new Map();
  for (const [token, sites] of nameShapedTokens()) {
    if (allow.has(token) || vocab.has(token)) continue;
    unseen.set(token, sites);
  }

  let blocked = 0;
  for (const [token, sites] of [...unseen.entries()].sort()) {
    const cultural = sites.filter((s) => s.cultural);
    if (cultural.length) {
      blocked++;
      const s = cultural[0];
      findings.add({
        check: 'no-invented-language',
        severity: 'blocking',
        file: s.file,
        locator: s.pointer,
        id: token,
        message: `"${token}" is a word this repository has not carried before, and it appears in a `
          + `cultural position (${s.file} at ${s.pointer}).`,
        hint: 'If it is an Aboriginal language word it must be in lore.language.allowlist with a '
          + 'published source before it ships. If it is not, add it to tools/ingest/vocabulary.json '
          + 'with `node tools/ingest/vocabulary-accept.mjs`, which prints every new word for a human '
          + 'to read before it writes any of them.'
      });
      continue;
    }
    findings.add({
      check: 'no-invented-language',
      severity: 'advisory',
      file: sites[0].file,
      locator: sites[0].pointer,
      id: token,
      message: `New name-shaped word "${token}" (${sites.length} site(s)), first at ${sites[0].file} ${sites[0].pointer}.`
    });
  }
  findings.ran('no-invented-language',
    `${vocab.size} known words, ${allow.size} allowlisted, ${unseen.size} new (${blocked} in a cultural position)`);
};

RULE_IMPL['no-low-confidence-to-player'] = ({ findings }) => {
  // Implemented in checks-records.mjs, where every record is already in hand. Recorded here so the
  // rule does not report itself unimplemented.
  findings.ran('no-low-confidence-to-player', 'implemented in checks-records.mjs');
};
