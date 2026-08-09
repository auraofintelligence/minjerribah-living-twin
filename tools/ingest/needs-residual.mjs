// Prove the needs residual table.
//
// src/systems/agents/needs.js scores about six thousand action candidates a tick, and for most of
// them the action's `gate` closure only repeats what the once-a-tick WHEN test and the once-a-day
// WHO test have already decided. The RESIDUAL table in that file records, per action, what is left
// to ask. If an entry there is wrong the island quietly changes behaviour and nothing complains.
//
// So it is checked rather than believed. This boots the world with the `needs-gate-audit` flag,
// which makes every candidate run its residual and then its full gate and throw on the first
// disagreement, naming the action and the person. A sim-week is about six million paired
// evaluations across two thousand people, every hour of the day, in whatever weather the seed
// brings.
//
//   node tools/gate-audit.mjs --needs                   one sim-week
//   node tools/gate-audit.mjs --needs --ticks 4320      one sim-month
//
// It is slow on purpose: it runs both halves of every gate. It is not part of the normal loop,
// which is why the data gate runs by default and this runs when you ask for it. This file was
// tools/gate-audit.mjs until the ingest spine took that name for the umbrella; nothing about the
// audit itself has changed.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

export async function runNeedsResidualAudit(ticks = 1008) {
  globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^\/+/, '').split('?')[0];
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };

  const { World } = await import(pathToFileURL(path.join(ROOT, 'src/kernel/world.js')));
  const { loadDataPacks } = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')));
  const { MANIFEST } = await import(pathToFileURL(path.join(ROOT, 'src/systems/manifest.js')));

  const world = new World({ seed: 19770614, flags: ['needs-gate-audit'] });
  world.data = await loadDataPacks();
  world.stage = null;
  for (const imp of MANIFEST) {
    let mod = null;
    try { mod = await imp(); } catch { continue; }
    for (const fn of Object.values(mod)) {
      if (typeof fn === 'function' && /^register/.test(fn.name)) {
        try { fn(world); } catch (e) { console.error('[needs-residual] register failed:', fn.name, e.message); }
      }
    }
  }
  await world.boot();

  console.log(`Auditing ${ticks} ticks (${(ticks / 144).toFixed(1)} sim-days) with every gate evaluated both ways.`);
  world.run(ticks);

  // A system that throws inside tick() is caught by the kernel and recorded rather than propagated,
  // so the errors list is where a disagreement lands.
  const bad = world.errors.filter((e) => e.system === 'needs');
  if (bad.length) {
    console.error(`\nNEEDS RESIDUAL AUDIT FAILED: ${bad.length} disagreement(s).`);
    for (const e of bad.slice(0, 5)) console.error('  ' + e.message);
    return 1;
  }
  if (world.errors.length) {
    console.error(`\n${world.errors.length} unrelated runtime errors:`);
    for (const e of world.errors.slice(0, 5)) console.error(`  ${e.system} (${e.phase}): ${e.message}`);
    return 1;
  }
  const n = world.read('needs');
  console.log(`NEEDS RESIDUAL AUDIT OK: ${ticks} ticks, ${n.tracked} people, no residual disagreed with its gate.`);
  return 0;
}
