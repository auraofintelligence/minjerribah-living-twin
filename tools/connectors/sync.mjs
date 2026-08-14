// The sync runner. One command, run by a person or by a scheduled job on somebody's machine.
//
//   node tools/connectors/sync.mjs --all
//   node tools/connectors/sync.mjs --id wildlife-rescue --inbox C:/some/folder
//   node tools/connectors/sync.mjs --due          only the feeds past their cadence
//   node tools/connectors/sync.mjs --list         every connector, built or not, and why
//   node tools/connectors/sync.mjs --dry-run      read and report, write nothing
//
// A sync is an offline step. It reads local checkouts of the owner's own repositories and any
// folder somebody dropped an export into, screens every record against the cultural prohibitions in
// data/lore.json and the privacy floor in docs/PARTICIPATION.md, and writes a committed,
// checksummed feed. The running twin never touches any of it.
//
// One connector reaches a network and only one: `weather`, which has no local checkout to read
// because nobody keeps the weather in a git repository. It calls two named Open-Meteo hosts, when a
// person or a scheduled job runs this command, and writes the same kind of stamped file everything
// else here writes. Run it with --inbox and it reads two saved responses off disk instead. See the
// header of tools/connectors/lib.mjs, which states the rule and its one exception together.

import fs from 'node:fs';
import { CONNECTORS, connector as declared } from './registry.mjs';
import { writeFeed, readFeedIndex, freshnessAt, nowIso, daysBetween, argOf, relative, FEED_DIR } from './lib.mjs';
import { runRefusal } from './refusals.mjs';

const MODULES = {
  'wildlife-rescue': () => import('./wildlife-rescue.mjs'),
  noticeboard: () => import('./noticeboard.mjs'),
  'events-engine': () => import('./events-engine.mjs'),
  weather: () => import('./weather.mjs')
};

/** Roughly how many days a cadence means, for working out what is due. */
function cadenceDays(cadence) {
  const text = String((cadence && cadence.every) || '').toLowerCase();
  // Nought, not a fraction: a feed synced faster than once a day is due whenever anybody asks,
  // which is the honest answer for weather and the reason this line exists.
  if (text.includes('hourly')) return 0;
  if (text.includes('daily')) return 1;
  if (text.includes('weekly')) return 7;
  if (text.includes('monthly')) return 30;
  if (text.includes('term')) return 90;
  return 30;
}

function dueList() {
  const index = readFeedIndex();
  const now = nowIso();
  const rows = [];
  for (const spec of CONNECTORS) {
    if (spec.built !== true || spec.direction === 'out') continue;
    const entry = index && (index.feeds || []).find((f) => f.id === spec.id);
    const age = entry ? daysBetween(entry.synced_at, now) : null;
    const want = cadenceDays(spec.cadence);
    rows.push({
      id: spec.id,
      lastSync: entry ? entry.synced_at.slice(0, 10) : 'never',
      ageDays: age,
      cadenceDays: want,
      due: age === null || age >= want,
      freshness: entry ? freshnessAt({ freshness: { synced_at: entry.synced_at, stale_after_days: spec.stale_after_days } }, now).state : 'never synced'
    });
  }
  return rows;
}

function printList() {
  console.log('\nCONNECTORS\n');
  const groups = [
    ['Built and working', (c) => c.built === true && c.direction !== 'out'],
    ['Outward only', (c) => c.built === true && c.direction === 'out'],
    ['Built to refuse', (c) => c.built === 'refused'],
    ['Defined, no data in hand', (c) => c.built === false]
  ];
  for (const [label, pick] of groups) {
    const rows = CONNECTORS.filter(pick);
    if (!rows.length) continue;
    console.log(`  ${label}`);
    for (const c of rows) {
      console.log(`    ${c.id.padEnd(22)} ${c.organisation}`);
      console.log(`    ${''.padEnd(22)} cadence: ${c.cadence.every}, run by ${c.cadence.run_by}`);
      if (c.reason) console.log(`    ${''.padEnd(22)} why not: ${c.reason.split('. ')[0]}.`);
    }
    console.log('');
  }
}

async function runOne(id, { inbox = null, dryRun = false } = {}) {
  const spec = declared(id);
  if (!spec) throw new Error(`no connector called "${id}". Run with --list.`);

  if (spec.built === 'refused') {
    const found = runRefusal(id);
    console.log(`\nREFUSED: ${id} (${spec.organisation})`);
    console.log(`  ${spec.reason}`);
    for (const line of found.evidence) console.log(`  found: ${line}`);
    console.log(`  the refusal ${found.still_true ? 'still holds on what is in the source today' : 'rests on material that was not found this run, so a human should look again'}.`);
    console.log('  nothing was written.');
    return { id, wrote: false, refused: true };
  }
  if (spec.built === false) {
    console.log(`\nNOT BUILT: ${id} (${spec.organisation})`);
    console.log(`  ${spec.reason}`);
    console.log(`  asks: ${(spec.asks || [])[0] || 'none recorded'}`);
    return { id, wrote: false, notBuilt: true };
  }
  if (spec.direction === 'out') {
    console.log(`\n${id} is an emission, not a sync. Run node tools/connectors/emit-noticeboard.mjs.`);
    return { id, wrote: false };
  }

  const mod = await MODULES[id]();
  // `await` on a plain object is the object, so the three connectors that read a checkout
  // synchronously are unaffected. The weather connector fetches, so it returns a promise.
  const feed = await mod.sync({ inbox });

  console.log(`\n${id}: ${feed.title}`);
  const src = feed.sync.source;
  if (src.kind === 'http-endpoint') {
    console.log(`  ${feed.sync.retrieval || 'read'} ${src.id}`);
    if (feed.sync.modelled_for) {
      console.log('  modelled for ' + Object.entries(feed.sync.modelled_for)
        .map(([k, v]) => `${k} ${v || 'unstamped'}`).join(', ')
        + ', which is not the moment it was fetched');
    }
    if (feed.sync.attribution) console.log(`  attribution: ${feed.sync.attribution}`);
  } else {
    console.log(`  read ${src.id} at ${src.commit ? src.commit.slice(0, 9) : 'no commit'} (${src.commit_date || 'undated'}, working tree ${src.working_tree})`);
  }
  if (src.files && src.files.length) console.log(`  files: ${src.files.join(', ')}`);
  if (feed.sync.checkout_is_behind_cadence) {
    console.log('  WARNING: this checkout is older than the cadence for this source. Pull it and run again.');
  }
  const c = feed.sync.counts;
  console.log('  ' + Object.entries(c)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${v}`).join(', '));
  for (const [k, v] of Object.entries(c)) {
    if (v && typeof v === 'object') console.log(`  ${k}: ` + Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', '));
  }
  if (feed.held.length) {
    console.log(`  HELD ${feed.held.length} record(s):`);
    for (const h of feed.held.slice(0, 6)) console.log(`    ${h.id}: ${h.reasons[0]}`);
  }
  if (feed.cultural_flags && feed.cultural_flags.length) {
    console.log(`  FLAGGED FOR A HUMAN ${feed.cultural_flags.length} record(s), see docs/CULTURAL-REVIEW.md`);
  }
  if (feed.wanted.length) {
    // The general asks are appended last and are the ones a person can act on. The per-organisation
    // entries above them are a list, and a list belongs in the file rather than in a terminal.
    const asks = feed.wanted.filter((w) => !w.organisation);
    const orgs = feed.wanted.length - asks.length;
    console.log(`  WANTED ${feed.wanted.length}${orgs ? `, of which ${orgs} are organisations nobody has asked anything` : ''}:`);
    // First sentence, and only one full stop on the end of it. Every connector's `what` already
    // ends in one, so appending another gave every line in this list a double stop.
    for (const w of asks) console.log(`    ${w.what.split('. ')[0].replace(/\.$/, '')}.`);
  }

  if (dryRun) {
    console.log('  dry run: nothing written.');
    return { id, wrote: false, feed };
  }
  const written = writeFeed(feed);
  console.log(`  wrote ${written.file} (${written.bytes} bytes) and updated data/feeds/_feeds.json`);
  return { id, wrote: true, feed };
}

async function main() {
  const args = process.argv.slice(2);
  if (argOf(args, 'list')) { printList(); return; }

  const inbox = argOf(args, 'inbox');
  const dryRun = !!argOf(args, 'dry-run');
  const only = argOf(args, 'id');
  const all = !!argOf(args, 'all');
  const due = !!argOf(args, 'due');

  if (!only && !all && !due) {
    console.log('usage: node tools/connectors/sync.mjs [--all | --due | --id <connector>] [--inbox <folder>] [--dry-run]');
    console.log('       node tools/connectors/sync.mjs --list');
    const rows = dueList();
    console.log('\nfeed status:');
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(22)} last sync ${String(r.lastSync).padEnd(12)} ${r.freshness}${r.due ? '  DUE' : ''}`);
    }
    return;
  }

  fs.mkdirSync(FEED_DIR, { recursive: true });
  let ids;
  if (only && typeof only === 'string') ids = [only];
  else if (due) ids = dueList().filter((r) => r.due).map((r) => r.id);
  else ids = CONNECTORS.map((c) => c.id);

  let wrote = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const res = await runOne(id, { inbox: typeof inbox === 'string' ? inbox : null, dryRun });
      if (res.wrote) wrote++;
    } catch (e) {
      failed++;
      console.error(`\n${id}: FAILED. ${e.message}`);
    }
  }
  console.log(`\n${wrote} feed(s) written, ${failed} failed.`);
  console.log('Nothing left this machine. Run node tools/connectors/verify.mjs before committing.');
  if (failed) process.exitCode = 1;
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/connectors/sync.mjs');
if (RAN_DIRECTLY) main().catch((e) => { console.error('[sync] fatal', e); process.exit(1); });

export { runOne, dueList, cadenceDays };
