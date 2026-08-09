// The word ledger.
//
//   node tools/ingest/vocabulary-accept.mjs           show every name-shaped word in the packs that
//                                                     this repository has not carried before
//   node tools/ingest/vocabulary-accept.mjs --write   add them, after you have read them
//
// Why this exists. The blocking prohibition `no-invented-language` says no Aboriginal language word
// may appear anywhere in the repository unless it is in the lore pack's allowlist. You cannot test
// that by tokenising, because nothing in a string says which language it came from. What you can
// test is whether a word is new here, and make a person look at every new one.
//
// tools/ingest/vocabulary.json is the result: every name-shaped word already in the packs at the
// state waves 3 and 7 left them, which is to say after the invented season names were found and
// deleted. A new word in a cultural position fails the gate until somebody has read it and either
// sourced it into the allowlist or accepted it here. A new word anywhere else is advisory.
//
// This tool prints, it does not decide. Read the list. The whole point is the reading.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, exists, today } from './lib.mjs';
import { nameShapedTokens, allowlistWords } from './checks-lore.mjs';

const FILE = 'tools/ingest/vocabulary.json';
const write = process.argv.includes('--write');

const lore = exists('data/lore.json') ? readJSON('data/lore.json') : {};
const allow = allowlistWords(lore);
const current = exists(FILE) ? readJSON(FILE) : {
  about: 'Every name-shaped word the data packs already carried when the word ledger was written. '
    + 'A word here has been seen by somebody. A word not here has not.',
  reviewed_on: '',
  note: 'Generated and extended by tools/ingest/vocabulary-accept.mjs. Words in the lore pack '
    + 'allowlist are not repeated here: the allowlist is where a sourced Quandamooka word belongs, '
    + 'and this file must never become a back door around it.',
  words: []
};
const known = new Set(current.words || []);

const cultural = [];
const ordinary = [];
for (const [token, sites] of [...nameShapedTokens()].sort()) {
  if (allow.has(token) || known.has(token)) continue;
  (sites.some((s) => s.cultural) ? cultural : ordinary).push([token, sites]);
}

if (!cultural.length && !ordinary.length) {
  console.log(`No new words. ${known.size} in ${FILE}, ${allow.size} in the lore allowlist.`);
  process.exit(0);
}

if (cultural.length) {
  console.log(`\nNEW WORDS IN A CULTURAL POSITION (${cultural.length}). These block the gate. Read every one.`);
  console.log('If any of these is an Aboriginal language word it belongs in lore.language.allowlist with a');
  console.log('published source, not here.\n');
  for (const [t, sites] of cultural) console.log(`  ${t.padEnd(24)} ${sites[0].file} ${sites[0].pointer}`);
}
if (ordinary.length) {
  console.log(`\nNEW WORDS ELSEWHERE (${ordinary.length}). Advisory.\n`);
  for (const [t, sites] of ordinary.slice(0, 200)) console.log(`  ${t.padEnd(24)} ${sites[0].file} ${sites[0].pointer}`);
  if (ordinary.length > 200) console.log(`  and ${ordinary.length - 200} more`);
}

if (!write) {
  console.log('\nNothing written. Re-run with --write once you have read the list above.');
  process.exit(cultural.length ? 1 : 0);
}

const words = [...new Set([...(current.words || []), ...cultural.map((x) => x[0]), ...ordinary.map((x) => x[0])])].sort();
current.words = words;
current.reviewed_on = today();
fs.writeFileSync(path.join(ROOT, FILE), JSON.stringify(current, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${FILE}: ${words.length} words.`);
