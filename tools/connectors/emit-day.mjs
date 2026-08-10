// Emission: what the island looked like on this day.
//
//   node tools/connectors/emit-day.mjs --date 2026-11-23
//   node tools/connectors/emit-day.mjs --date 2026-12-27 --seed 19770614
//
// The twin reads from the island through the connectors. This is the twin reading back out, and it
// is deliberately the simplest of the three emissions, because everything else is built on it: a
// noticeboard notice, a screen digest and a chronicle entry are all this file with a different
// layout.
//
// It boots the whole simulation headlessly, runs it to a named date, and writes down what the
// island was doing: the tide, the weather, the ferry, who was on the island, what the chronicle
// published that day, and what went wrong. Two files land in out/emit/day/, one for a machine and
// one for a person.
//
// EVERY FIGURE NAMES THE SYSTEM THAT PRODUCED IT, and the whole export carries the seed and the
// pack fingerprint, because docs/DIRECTION.md calls replay peer review: a claim backed by a
// replayable run outranks one that is not, and that only works if the report carries enough to
// reconstruct the exact world it ran in. A seed alone is not enough, because the packs move.
//
// This is a model, not a record of a real day. It says so on the first line of everything it
// writes, and nothing in here may be presented as an observation of the real island.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, outFile, relative, packFingerprint, nowIso, argOf } from './lib.mjs';

const DEFAULT_SEED = 19770614;

/** The data loader fetches repo-relative paths. Headless serves them off disk, offline. */
function installOfflineFetch() {
  globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^\/+/, '').split('?')[0];
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
}

export async function buildWorld(seed = DEFAULT_SEED) {
  installOfflineFetch();
  const { World } = await import(pathToFileURL(path.join(ROOT, 'src/kernel/world.js')));
  const { loadDataPacks } = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')));
  const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/systems/manifest.js')));

  const world = new World({ seed });
  world.data = await loadDataPacks();
  world.stage = null;
  for (const imp of MANIFEST) {
    let mod = null;
    try { mod = await imp(); } catch { continue; }
    for (const fn of Object.values(mod)) {
      if (typeof fn === 'function' && /^register/.test(fn.name)) {
        try { fn(world); } catch { /* the kernel reports it */ }
      }
    }
  }
  await world.boot();
  return world;
}

function isoOf(world) {
  const s = world.clock.formatISO ? world.clock.formatISO() : '';
  return String(s).slice(0, 10);
}

/** Run forward until the clock reads the wanted day, or until the cap says stop. */
function runToDate(world, wantedDate, capTicks = 60000) {
  const start = isoOf(world);
  if (wantedDate < start) {
    throw new Error(`this world opens on ${start} and cannot run backwards to ${wantedDate}. `
      + 'The simulated clock starts where data/_provenance.json and the clock module say it does.');
  }
  let ticks = 0;
  while (isoOf(world) < wantedDate && ticks < capTicks) { world.step(); ticks++; }
  if (isoOf(world) !== wantedDate) {
    throw new Error(`ran ${ticks} ticks and reached ${isoOf(world)}, not ${wantedDate}. Raise the cap.`);
  }
  return { ticks, start };
}

const n = (v, dp = 1) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(dp)) : null);

/**
 * A figure, with the system that produced it beside it. Nothing in an emission is allowed to be a
 * number on its own: docs/DIRECTION.md requires every line of a report to cite what it rests on.
 */
function figure(system, label, value, unit = '') {
  return { system, label, value, unit };
}

export async function dayExport({ date, seed = DEFAULT_SEED, capTicks = 60000 } = {}) {
  const world = await buildWorld(seed);
  const { ticks, start } = runToDate(world, date, capTicks);

  // Run the whole of the wanted day so the chronicle has something to have published, and so the
  // daily counters have a day behind them rather than landing at breakfast.
  const dayStart = world.clock.dayIndex;
  // Read the day's own label before running it out, because by the end of the last tick the clock
  // has rolled into tomorrow and would put tomorrow's date on today's page.
  const dayLabel = world.clock.formatDate();
  const daySeason = world.clock.season ? world.clock.season.name : null;
  const dayIsWeekend = world.clock.isWeekend;
  const eventsBefore = { ...world.bus.types() };

  const describeAll = () => {
    const out = {};
    for (const id of ['weather', 'tide', 'daylight', 'ferry', 'visitors', 'population', 'businesses',
      'traffic', 'roads', 'schedule']) {
      const s = world.system(id);
      if (!s || !s.describe) { out[id] = {}; continue; }
      try { out[id] = s.describe(world) || {}; } catch { out[id] = {}; }
    }
    return out;
  };

  // Two snapshots, and the reason is a known fault in the read models rather than a preference.
  // docs/STATE-OF-PLAY.md 4.5 records that the daily counters reset at midnight, so a probe taken
  // after the day has rolled reports a ferry that carried nobody on a day it carried hundreds.
  // Conditions are read at the middle of the day because that is the day a person means; totals are
  // read at the last hour of it because that is when the day's counting is finished.
  let midday = null;
  let lateEvening = null;
  let dayTicks = 0;
  while (world.clock.dayIndex === dayStart && dayTicks < 200) {
    if (!midday && world.clock.minuteOfDay >= 720) midday = describeAll();
    if (!lateEvening && world.clock.minuteOfDay >= 1380) lateEvening = describeAll();
    world.step();
    dayTicks++;
  }
  const eventsAfter = world.bus.types();
  const late = lateEvening || midday || describeAll();
  const noon = midday || late;

  const read = (id) => world.read(id) || {};
  const weather = noon.weather;
  const tide = noon.tide;
  const daylight = noon.daylight;
  const ferry = late.ferry;
  const visitors = late.visitors;
  const population = late.population;
  const businesses = late.businesses;
  const traffic = late.traffic;
  const roads = noon.roads;
  const schedule = noon.schedule;
  const chronicle = read('chronicle');

  const dayEvents = [];
  for (const [type, count] of Object.entries(eventsAfter)) {
    const before = eventsBefore[type] || 0;
    if (count > before) dayEvents.push({ type, times: count - before });
  }
  dayEvents.sort((a, b) => b.times - a.times || (a.type < b.type ? -1 : 1));

  const todaysLines = (chronicle.entries || [])
    .filter((e) => e.day === dayStart)
    .map((e) => ({
      time: e.time,
      theme: e.themeLabel || e.theme,
      weight: e.weight,
      text: e.text,
      detail: e.detail || null,
      place: e.place || null,
      township: e.township || null
    }));

  return {
    kind: 'twin-day-export',
    schema: 'minjerribah-day-export/1',
    generated_at: nowIso(),
    honesty: 'This is a model of a day, produced by running a simulation. It is not a record of '
      + 'anything that happened on the real island, and no line in it may be presented as an '
      + 'observation. Every figure names the system that produced it, and the run below replays '
      + 'exactly on the same seed and the same packs.',
    replay: {
      seed,
      pack_fingerprint: packFingerprint(),
      clock_mode: world.clock.declaredMode,
      opened_on: start,
      date,
      ticks_run: ticks + dayTicks,
      command: `node tools/connectors/emit-day.mjs --date ${date} --seed ${seed}`
    },
    day: {
      date: dayLabel,
      iso: date,
      season: daySeason,
      school: schedule.term || null,
      is_weekend: dayIsWeekend,
      sunrise: daylight.sunrise || null,
      sunset: daylight.sunset || null
    },
    read_at: {
      conditions: 'midday, so the reading is the day a person means rather than the small hours',
      totals: 'the last hour of the day, because the daily counters reset at midnight and a probe '
        + 'taken after the roll reports zero for a day that was busy'
    },
    conditions: [
      figure('weather', 'Synoptic pattern', weather.synoptic),
      figure('weather', 'Temperature', n(weather.tempC), 'degrees'),
      figure('weather', 'Wind', n(weather.windKt, 0), 'kt'),
      figure('weather', 'Swell', n(weather.swellM), 'm'),
      figure('weather', 'Fire danger', weather.fire),
      figure('tide', 'Tide height', n(tide.height, 2), 'm'),
      figure('tide', 'Tide phase', tide.phase),
      figure('roads', 'Beach highway open', roads.beachHighwayOpen),
      figure('roads', 'Open road', n(roads.openKm), 'km')
    ].filter((f) => f.value !== null && f.value !== undefined),
    island: [
      figure('population', 'Residents', population.residents),
      figure('visitors', 'Visitors on the island', visitors.onIsland),
      figure('visitors', 'Visitor pressure', n(visitors.pressure, 2)),
      figure('ferry', 'Vehicle slots today', ferry.slotsToday),
      figure('ferry', 'Vehicles carried', ferry.carried),
      figure('ferry', 'Not carried', ferry.notCarried),
      figure('traffic', 'Vehicles moving', traffic.vehicles),
      figure('traffic', 'Worst queue', traffic.worstQueue),
      figure('traffic', 'Where', traffic.worstRoad),
      figure('businesses', 'Businesses trading', businesses.trading)
    ].filter((f) => f.value !== null && f.value !== undefined),
    events: dayEvents.slice(0, 25),
    chronicle: {
      published_today: todaysLines.length,
      held_back: chronicle.held || null,
      lines: todaysLines,
      voice: chronicle.voice || null,
      basis: chronicle.basis || null
    },
    errors: world.errors.slice(-5).map((e) => `${e.system}: ${e.message}`)
  };
}

function markdown(doc) {
  const out = [];
  out.push(`# ${doc.day.date}`);
  out.push('');
  out.push('A modelled day on Minjerribah. Not a record of anything that happened.');
  out.push('');
  out.push(`Seed ${doc.replay.seed}. Packs ${doc.replay.pack_fingerprint}. Clock ${doc.replay.clock_mode}. `
    + `Replay with \`${doc.replay.command}\`.`);
  out.push('');
  out.push('## The day');
  out.push('');
  out.push(`${doc.day.season}. School: ${doc.day.school || 'not stated'}. `
    + `Sunrise ${doc.day.sunrise}, sunset ${doc.day.sunset}.`);
  out.push('');
  out.push('| What | Reading | From |');
  out.push('| --- | --- | --- |');
  const show = (v) => (v === true ? 'yes' : v === false ? 'no' : v);
  for (const f of doc.conditions.concat(doc.island)) {
    out.push(`| ${f.label} | ${show(f.value)}${f.unit ? ' ' + f.unit : ''} | \`${f.system}\` |`);
  }
  out.push('');
  out.push(`Conditions read at ${doc.read_at.conditions}. Totals read at ${doc.read_at.totals}.`);
  out.push('');
  if (doc.chronicle.lines.length) {
    out.push('## What the chronicle published');
    out.push('');
    for (const l of doc.chronicle.lines) {
      out.push(`- **${l.time}** ${l.text}${l.detail ? ' ' + l.detail : ''}`);
    }
    out.push('');
  }
  if (doc.events.length) {
    out.push('## What happened, by count');
    out.push('');
    for (const e of doc.events.slice(0, 15)) out.push(`- \`${e.type}\` ${e.times}`);
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push(doc.honesty);
  out.push('');
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const date = argOf(args, 'date');
  const seed = Number(argOf(args, 'seed', DEFAULT_SEED));
  const cap = Number(argOf(args, 'cap', 60000));
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.log('usage: node tools/connectors/emit-day.mjs --date YYYY-MM-DD [--seed N] [--cap ticks]');
    process.exitCode = 1;
    return;
  }
  console.log(`Running the island to ${date} on seed ${seed}. This takes a minute or two.`);
  const doc = await dayExport({ date, seed, capTicks: cap });
  const json = outFile('day', `${date}.json`);
  const md = outFile('day', `${date}.md`);
  fs.writeFileSync(json, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(md, markdown(doc), 'utf8');
  console.log(`\n${doc.day.date}, ${doc.day.season}.`);
  console.log(`  ${doc.replay.ticks_run} ticks, packs ${doc.replay.pack_fingerprint}, ${doc.errors.length} error(s).`);
  console.log(`  chronicle published ${doc.chronicle.published_today} line(s), ${doc.events.length} event type(s) fired.`);
  console.log(`  wrote ${relative(json)}`);
  console.log(`  wrote ${relative(md)}`);
  console.log('\nThis is a model of a day, not a record of one. Nothing has been sent anywhere.');
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/connectors/emit-day.mjs');
if (RAN_DIRECTLY) main().catch((e) => { console.error('[emit-day] ' + e.message); process.exit(1); });
