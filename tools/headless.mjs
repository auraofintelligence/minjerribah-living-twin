// Headless island. Runs the whole simulation in Node with no browser and no renderer, which is the
// point of the sim/render split in the contract. Use it to check determinism, to fast-forward a year
// and see whether the economy or the ecology falls over, and to profile a system without a GPU in the way.
//
//   node tools/headless.mjs                     boot and run 1440 ticks (10 sim-days), print a probe
//   node tools/headless.mjs --ticks 20000       run longer
//   node tools/headless.mjs --determinism       run twice and diff, fail loudly if they differ
//   node tools/headless.mjs --system koala      print one system's describe() every sim-day
//   node tools/headless.mjs --profile           print the hottest systems by tick cost
//   node tools/headless.mjs --json              machine-readable output only

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The data loader uses fetch with repo-relative paths. In Node, serve those off disk.
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/+/, '').split('?')[0];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const TICKS = Number(flag('ticks', 1440));
const JSON_ONLY = !!flag('json');
const say = (...a) => { if (!JSON_ONLY) console.log(...a); };

async function build(seed = 19770614) {
  const { World } = await import(pathToFileURL(path.join(ROOT, 'src/kernel/world.js')));
  const { loadDataPacks } = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')));
  const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/systems/manifest.js')));

  const world = new World({ seed });
  world.data = await loadDataPacks();
  world.stage = null; // headless: render layers must no-op

  const loaded = [];
  const skipped = [];
  for (const imp of MANIFEST) {
    let mod = null;
    try {
      mod = await imp();
    } catch (e) {
      skipped.push(String(imp).match(/['"](.+?)['"]/)?.[1] || 'unknown');
      continue;
    }
    for (const fn of Object.values(mod)) {
      if (typeof fn === 'function' && /^register/.test(fn.name)) {
        try { fn(world); loaded.push(fn.name); }
        catch (e) { console.error('[headless] register failed:', fn.name, e.message); }
      }
    }
  }
  await world.boot();
  return { world, loaded, skipped };
}

/** A stable fingerprint of the world, for determinism checks. Order-independent, value-sensitive. */
function fingerprint(world) {
  const h = (s) => {
    let x = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const parts = [];
  parts.push('tick:' + world.clock.tick);
  const st = world.store.stats();
  parts.push('ents:' + st.entities);
  for (const k of Object.keys(st.components).sort()) parts.push(`c:${k}=${st.components[k]}`);
  for (const id of Object.keys(world.state).sort()) {
    const sys = world.system(id);
    if (sys && sys.describe) {
      try { parts.push(`d:${id}=${JSON.stringify(sys.describe(world))}`); } catch { /* ignore */ }
    }
  }
  return h(parts.join('|'));
}

async function main() {
  const t0 = performance.now();
  const { world, loaded, skipped } = await build();
  const bootMs = performance.now() - t0;

  say(`Booted in ${bootMs.toFixed(0)} ms. ${loaded.length} registrations, ${skipped.length} modules not built yet.`);
  if (world.errors.length) {
    say(`\n${world.errors.length} boot errors:`);
    for (const e of world.errors.slice(0, 10)) say(`  ${e.system} (${e.phase}): ${e.message}`);
  }

  const watch = flag('system');
  const t1 = performance.now();
  for (let i = 0; i < TICKS; i++) {
    world.step();
    if (typeof watch === 'string' && world.clock.minuteOfDay === 0) {
      const sys = world.system(watch);
      if (sys && sys.describe) say(world.clock.formatDate(), JSON.stringify(sys.describe(world)));
    }
  }
  const runMs = performance.now() - t1;
  const perTick = runMs / Math.max(1, TICKS);

  say(`\nRan ${TICKS} ticks (${(TICKS / 144).toFixed(1)} sim-days) in ${runMs.toFixed(0)} ms, ${perTick.toFixed(3)} ms/tick.`);
  if (perTick > 4) say(`  WARNING: over the 4 ms budget in the contract.`);
  say(`Now: ${world.clock.formatDate()} ${world.clock.format()}, season ${world.clock.season.name}`);

  if (flag('profile')) {
    say('\nHottest systems:');
    for (const row of world.telemetry.summary(20).hottest) {
      say(`  ${row.avgMs.toFixed(3)} ms avg  ${row.maxMs.toFixed(2)} ms max  ${row.key}`);
    }
  }

  if (world.errors.length) {
    say(`\n${world.errors.length} runtime errors. First few:`);
    for (const e of world.errors.slice(0, 8)) say(`  ${e.system} (${e.phase} @ tick ${e.tick}): ${e.message}`);
  }

  if (flag('determinism')) {
    const fpA = fingerprint(world);
    const b = await build();
    b.world.run(TICKS);
    const fpB = fingerprint(b.world);
    if (fpA === fpB) {
      say(`\nDETERMINISM OK: two runs of ${TICKS} ticks agree (${fpA}).`);
    } else {
      console.error(`\nDETERMINISM FAILED: ${fpA} vs ${fpB}. Something is using Math.random, Date.now, or iteration order that is not stable.`);
      // Narrow it down for whoever has to fix it.
      for (const id of Object.keys(world.state).sort()) {
        const s1 = world.system(id), s2 = b.world.system(id);
        if (!s1?.describe || !s2?.describe) continue;
        const a = JSON.stringify(s1.describe(world)), c = JSON.stringify(s2.describe(b.world));
        if (a !== c) console.error(`  diverged: ${id}\n    A ${a}\n    B ${c}`);
      }
      process.exitCode = 1;
    }
  }

  const probe = world.probe();
  if (JSON_ONLY) {
    console.log(JSON.stringify({ bootMs, runMs, perTick, ticks: TICKS, loaded: loaded.length, skipped: skipped.length,
      errors: world.errors.length, probe }, null, 2));
  } else {
    say('\nSystems reporting:');
    for (const [id, d] of Object.entries(probe.systems)) {
      say(`  ${id.padEnd(16)} ${JSON.stringify(d)}`.slice(0, 200));
    }
    say(`\nStore: ${probe.store.entities} entities across ${Object.keys(probe.store.kinds).length} kinds.`);
    const ev = Object.entries(probe.events).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (ev.length) say('Busiest events: ' + ev.map(([k, v]) => `${k}=${v}`).join(', '));
  }
}

main().catch((e) => { console.error('[headless] fatal', e); process.exit(1); });
