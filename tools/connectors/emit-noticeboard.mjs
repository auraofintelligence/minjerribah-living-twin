// Emission: a noticeboard notice, written by the twin for a person to read and send.
//
//   node tools/connectors/emit-noticeboard.mjs --day out/emit/day/2026-11-23.json
//   node tools/connectors/emit-noticeboard.mjs --events
//   node tools/connectors/emit-noticeboard.mjs --day <file> --screen kiosk_portrait
//
// This is the loop closing. The connectors read the island into the twin; this writes the twin back
// out in the shape the island's own noticeboard network already uses: one markdown file with
// frontmatter, schema `public_noticeboard.v0`, status `draft_for_human_review`. That schema and
// that status word are the noticeboard's, not ours. Emitting into somebody else's format rather
// than inventing one is the whole point of a connector layer.
//
// THE TWIN NEVER POSTS ANYTHING ANYWHERE. It writes a file to disk. A person reads it, decides
// whether it is true and useful, and sends it or does not. That restraint is a feature and it is
// worth stating plainly: nothing leaves the island without a person.
//
// TWO REFUSALS, and both are runnable rather than remembered:
//
//   A modelled day is never written as news. Every notice built from a simulation run carries a
//   standfirst saying so, in the body and in the frontmatter, and the emitter refuses to write one
//   without it. A noticeboard tile reading "four sailings cancelled" over a modelled day would be
//   a false report on a real screen, which is the worst thing this whole layer could produce.
//
//   Nothing goes out uncited. Every figure on a notice names the system or the pack record it came
//   from, and the notice carries the seed and the pack fingerprint. If a figure arrives without a
//   source, the emitter refuses the whole notice rather than dropping the line, because a notice
//   that quietly drops what it cannot cite is a notice you cannot trust the rest of.

import fs from 'node:fs';
import path from 'node:path';
import { readFeed, outFile, relative, nowIso, today, packFingerprint, argOf, houseStyle } from './lib.mjs';

const SCHEMA = 'public_noticeboard.v0';

/** The screen shapes the noticeboard network defines. Its words, not ours. */
const SCREEN_TARGETS = ['wall_16x9', 'kiosk_portrait', 'counter_tablet', 'phone_story', 'ticker', 'offline_fallback'];

function yaml(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '\\"') + '"';
}

function yamlList(items, indent = '  ') {
  if (!items || !items.length) return indent + '- "none"';
  return items.map((i) => indent + '- ' + yaml(i)).join('\n');
}

/** Which proposed screens exist, read from the noticeboard feed so the two stay joined. */
function proposedScreens() {
  const feed = readFeed('noticeboard');
  if (!feed) return [];
  return (feed.records || [])
    .filter((r) => r.kind === 'proposed-screen')
    .map((r) => ({ id: r.id.replace(/^nb-screen-/, ''), label: r.label, township: r.township, role: r.role }));
}

/**
 * Turn a day export into the four things a notice needs: a headline, a standfirst that says what
 * kind of thing this is, the body, and one short line that fits a ticker strip or an SMS.
 *
 * The choice of headline is made from what actually happened in the run rather than from a
 * template, because a notice about a quiet day and a notice about a day the barge broke down are
 * not the same notice.
 */
function fromDay(doc) {
  const find = (label) => (doc.conditions.concat(doc.island)).find((f) => f.label === label);
  const cited = [];
  const line = (label, text) => {
    const f = find(label);
    if (!f) return null;
    cited.push({ claim: text, figure: `${f.label} ${f.value}${f.unit ? ' ' + f.unit : ''}`, system: f.system });
    return text;
  };

  const cancelled = (doc.events || []).find((e) => e.type === 'ferry:cancelled');
  const notCarried = find('Not carried');
  const carried = find('Vehicles carried');
  const visitors = find('Visitors on the island');
  const lead = (doc.chronicle.lines || []).find((l) => l.weight === 3) || (doc.chronicle.lines || [])[0];

  const body = [];
  let headline;
  let ticker;

  if (cancelled && cancelled.times > 0) {
    headline = `If ${cancelled.times} barge sailings went in one day`;
    body.push(`The twin was run over ${doc.day.date} with the vehicle ferry losing ${cancelled.times} `
      + 'sailings to a mechanical fault. This is what the model says the rest of the day does.');
    body.push('');
    const l1 = line('Vehicles carried', `${carried ? carried.value : 'some'} vehicles still crossed.`);
    const l2 = line('Not carried', `${notCarried ? notCarried.value : 'some'} did not get across at all.`);
    if (l1) body.push('- ' + l1);
    if (l2) body.push('- ' + l2);
    for (const l of (doc.chronicle.lines || []).filter((x) => /barge|boat|ferry/i.test(x.text)).slice(0, 3)) {
      body.push(`- ${l.text}${l.detail ? ' ' + l.detail : ''}`);
      cited.push({ claim: l.text, figure: `chronicle line at ${l.time}`, system: 'chronicle' });
    }
    ticker = `MODEL, NOT NEWS: ${cancelled.times} lost barge sailings on a modelled ${doc.day.date} `
      + `left ${notCarried ? notCarried.value : 'some'} vehicles on the wrong side. Twin run, seed ${doc.replay.seed}.`;
  } else {
    headline = `A modelled ${doc.day.date}`;
    body.push(`The twin was run over ${doc.day.date}. This is what the model had the island doing.`);
    body.push('');
    const l1 = line('Visitors on the island', `${visitors ? visitors.value : 'some'} visitors were on the island.`);
    const l2 = line('Vehicles carried', `${carried ? carried.value : 'some'} vehicles crossed on the barge.`);
    if (l1) body.push('- ' + l1);
    if (l2) body.push('- ' + l2);
    if (lead) {
      body.push(`- ${lead.text}${lead.detail ? ' ' + lead.detail : ''}`);
      cited.push({ claim: lead.text, figure: `chronicle line at ${lead.time}`, system: 'chronicle' });
    }
    ticker = `MODEL, NOT NEWS: a twin run over ${doc.day.date}. `
      + `${visitors ? visitors.value : 'Some'} visitors, ${carried ? carried.value : 'some'} vehicles across. Seed ${doc.replay.seed}.`;
  }

  const conditions = ['Synoptic pattern', 'Temperature', 'Wind', 'Swell', 'Tide height']
    .map((label) => {
      const f = find(label);
      if (!f) return null;
      cited.push({ claim: `${f.label} ${f.value}`, figure: `${f.value}${f.unit ? ' ' + f.unit : ''}`, system: f.system });
      return `${f.label.toLowerCase()} ${f.value}${f.unit ? ' ' + f.unit : ''}`;
    })
    .filter(Boolean);
  if (conditions.length) {
    body.push('');
    body.push('Conditions in the run: ' + conditions.join(', ') + '.');
  }

  return {
    headline,
    kind: 'simulation_rehearsal',
    standfirst: 'This is a simulation, not a report. Nothing here happened. The twin was run on a '
      + 'published seed against published data packs, and anybody with this repository can run it again '
      + 'and get the same day.',
    body,
    ticker,
    cited,
    replay: doc.replay,
    category: 'Environment, wildlife, safety and emergency',
    category_slug: 'environment-safety-and-emergency',
    place: 'Minjerribah, island wide',
    expires: doc.day.iso
  };
}

/**
 * A what-is-on digest, built from the events feed. This is the one the screen and media network
 * asked for, and it is the easier of the two to get wrong: an event listing on a screen reads as a
 * promise. So every line carries who listed it and when somebody last went looking, and the digest
 * refuses to run at all if the feed is past its own staleness limit.
 */
function fromEvents({ from = null, weeks = 8 } = {}) {
  const feed = readFeed('events-engine');
  if (!feed) throw new Error('no events feed. Run node tools/connectors/sync.mjs --id events-engine first.');
  const start = from || today();
  const end = new Date(Date.parse(start) + weeks * 7 * 86400000).toISOString().slice(0, 10);

  const upcoming = (feed.records || [])
    .filter((r) => r.kind === 'public-event-listing')
    .filter((r) => r.starts && r.starts >= start && r.starts <= end)
    .sort((a, b) => (a.starts < b.starts ? -1 : 1));

  const cited = [];
  const body = [];
  body.push(`What was publicly listed for the ${weeks} weeks from ${start}, as at the last sync of the `
    + 'island event atlas.');
  body.push('');
  if (!upcoming.length) {
    body.push('Nothing in that window is currently listed in the atlas. That is a gap in the listing, '
      + 'not a quiet island: the atlas records when somebody last went looking, and it was '
      + (feed.sync.source_last_public_search || 'not recorded') + '.');
  }
  for (const r of upcoming) {
    body.push(`- **${r.date_label}** ${r.name}, ${r.place}. Listed by ${r.listed_by}.`
      + (r.atlas_status === 'tbc' ? ' Date to confirm.' : ''));
    cited.push({ claim: r.name, figure: r.date_label, system: `feed:events-engine ${r.id}` });
  }
  body.push('');
  body.push('Every line here is a public listing, not a confirmation. ' + feed.sync.source_statement.quote);

  return {
    headline: 'What is listed on the island',
    kind: 'listing_digest',
    standfirst: 'A digest of public listings, not a programme. Confirm dates, permissions and contacts '
      + 'with the organiser before relying on any of it. Last public search: '
      + (feed.sync.source_last_public_search || 'not recorded') + '.',
    body,
    ticker: `WHAT IS ON: ${upcoming.length} event(s) listed to ${end}. Public listings only, `
      + `last searched ${feed.sync.source_last_public_search || 'not recorded'}. Confirm before you go.`,
    cultural_count: upcoming.filter((r) => r.cultural_event).length,
    cited,
    replay: { seed: null, pack_fingerprint: packFingerprint(), source: feed.sync.source, synced_at: feed.sync.synced_at },
    category: 'Events, festivals and markets',
    category_slug: 'events',
    place: 'Minjerribah, island wide',
    expires: end
  };
}

/** Build the markdown file, in the noticeboard network's own schema. */
function render(notice, { screens, targets }) {
  const stamp = today();
  const front = [
    '---',
    `schema: ${SCHEMA}`,
    'status: draft_for_human_review',
    'publisher_name: ' + yaml('Minjerribah Living Twin'),
    'publisher_kind: ' + yaml('a simulation, run by a person, publishing nothing by itself'),
    'category: ' + yaml(notice.category),
    'category_slug: ' + yaml(notice.category_slug),
    'place_or_service_area: ' + yaml(notice.place),
    'content_kind: ' + yaml(notice.kind),
    'is_a_report_of_real_events: false',
    'standfirst: ' + yaml(notice.standfirst),
    'approval_owner: ' + yaml('unassigned: a person has to put their name here before this goes on a screen'),
    'contact_preference: ' + yaml('ask_before_displaying_contact'),
    'review_rhythm: ' + yaml('every time, because every one of these is a draft'),
    'last_reviewed: ' + yaml('not yet reviewed by anybody'),
    'generated: ' + yaml(stamp),
    'expires: ' + yaml(notice.expires),
    'screen_targets:',
    yamlList(targets),
    'device_location_ids:',
    yamlList(screens.map((s) => s.id)),
    'asset_status: ' + yaml('text only, no artwork'),
    'twin_seed: ' + yaml(notice.replay.seed === null ? 'not applicable' : notice.replay.seed),
    'twin_pack_fingerprint: ' + yaml(notice.replay.pack_fingerprint),
    '---',
    ''
  ];

  const body = [
    `# ${notice.headline}`,
    '',
    `**${notice.standfirst}**`,
    '',
    ...notice.body,
    '',
    '## Where every line came from',
    '',
    '| Claim | Reading | Source |',
    '| --- | --- | --- |',
    ...notice.cited.map((c) => `| ${c.claim.replace(/\|/g, ' ')} | ${String(c.figure).replace(/\|/g, ' ')} | \`${c.system}\` |`),
    '',
    '## The one-line version',
    '',
    'For a ticker strip, a low-power sign or an SMS:',
    '',
    '> ' + notice.ticker,
    '',
    '## Before this goes anywhere',
    '',
    '- A person puts their name in `approval_owner` above. Until then this is a draft and nothing more.',
    '- Check the standfirst is still on it. It is the line that stops this being read as something it is not.',
    '- Check the expiry. A stale notice on a screen is worse than an empty screen.',
    ...(notice.kind === 'simulation_rehearsal'
      ? ['- This run names real vessels, real roads and real businesses, because the twin models real ones. '
        + 'On a screen, a modelled fault attached to a named vessel reads as a claim about that vessel. '
        + 'Either keep the standfirst directly above the line, or take the name out.']
      : ['- Every line is a listing somebody else published. If an organiser has not confirmed it, the '
        + 'screen is passing on a guess with your name under it.']),
    ...(notice.cultural_count
      ? [`- ${notice.cultural_count} of these is a cultural event. Each is here exactly as it was publicly `
        + 'advertised: a name, a date, a place, and who listed it. Do not add a description, a programme or '
        + 'anything about what happens at it. If you are unsure, take it off the screen and ask.']
      : []),
    '- The twin did not send this. It wrote a file. Somebody has to decide.',
    ''
  ];

  const text = front.concat(body).join('\n');
  const styled = houseStyle(text);
  return styled.text;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function emit({ dayFile = null, events = false, targets = null } = {}) {
  const notice = events ? fromEvents({}) : fromDay(JSON.parse(fs.readFileSync(dayFile, 'utf8')));

  // The two refusals, run rather than remembered.
  if (!notice.standfirst || !/simulation|listing|not a report|not a programme/i.test(notice.standfirst)) {
    throw new Error('this notice carries no standfirst saying what kind of thing it is, so it was not written.');
  }
  const uncited = notice.cited.filter((c) => !c.system);
  if (uncited.length) {
    throw new Error(`${uncited.length} claim(s) on this notice name no source, so the whole notice was `
      + 'refused. A notice that quietly drops what it cannot cite is a notice you cannot trust the rest of.');
  }
  if (!events) {
    const current = packFingerprint();
    if (notice.replay.pack_fingerprint !== current) {
      throw new Error(`this run was made against packs ${notice.replay.pack_fingerprint} and the packs on `
        + `disk are now ${current}. The findings are about a different island. Re-run emit-day.mjs.`);
    }
  }

  const screens = proposedScreens();
  const use = targets || SCREEN_TARGETS;
  const text = render(notice, { screens, targets: use });
  const name = events ? `whats-on-${today()}.md` : `${slug(notice.headline)}.md`;
  const file = outFile('noticeboard', name);
  fs.writeFileSync(file, text, 'utf8');
  return { file, notice, screens, targets: use };
}

function main() {
  const args = process.argv.slice(2);
  const dayFile = argOf(args, 'day');
  const events = !!argOf(args, 'events');
  const screen = argOf(args, 'screen');
  if (!dayFile && !events) {
    console.log('usage: node tools/connectors/emit-noticeboard.mjs --day out/emit/day/<date>.json');
    console.log('       node tools/connectors/emit-noticeboard.mjs --events');
    process.exitCode = 1;
    return;
  }
  try {
    const res = emit({
      dayFile: typeof dayFile === 'string' ? dayFile : null,
      events,
      targets: typeof screen === 'string' ? [screen] : null
    });
    console.log(`\n${res.notice.headline}`);
    console.log(`  kind: ${res.notice.kind}, ${res.notice.cited.length} cited claim(s)`);
    console.log(`  screen targets: ${res.targets.join(', ')}`);
    console.log(`  proposed screens on the island: ${res.screens.length ? res.screens.map((s) => s.id).join(', ') : 'none, and none of them exists yet'}`);
    console.log(`  wrote ${relative(res.file)}`);
    console.log('\nThis is a draft. The twin has not sent it anywhere and will not. Read it, put your name '
      + 'in approval_owner, and decide.');
  } catch (e) {
    console.error('\nREFUSED: ' + e.message);
    process.exitCode = 1;
  }
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/connectors/emit-noticeboard.mjs');
if (RAN_DIRECTLY) main();
