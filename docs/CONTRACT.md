# Build contract

Read this before writing a line. Every agent working on this project builds to the same shape,
which is the only reason a hundred hands can work on one island without it coming apart.

## What this is

A living digital twin of **Minjerribah / North Stradbroke Island**, Quandamooka Country, running in a
browser game engine (**Babylon.js 9.20**, vendored at `vendor/babylon.js`, no CDN, no build step).
It serves six purposes at once, and none of them is a mini-game bolted on the side:

1. **Civic planning**: real levers, real trade-offs, real consultation. (Reference: *Democracy 4*, *Cities: Skylines II*)
2. **Island life**: residents with needs, relationships, jobs, moods, homes. (Reference: *The Sims 4*)
3. **Events and crowds**: the ferry queue on a long weekend, a festival at Home Beach. (Reference: *Cities: Skylines II*)
4. **Ecological stewardship**: dunes, koalas, whales, water, fire, the lakes. (Reference: *Oxygen Not Included* systems depth)
5. **Micro drama series**: emergent stories about actual people in an actual place. (Reference: *The Sims 4* storytelling, *Disco Elysium* writing bar)
6. **A subterranean eco city**: the works below the sand. (Reference: *Satisfactory*, *Dyson Sphere Program*, *Oxygen Not Included*)

And it must feel like a place, not a dashboard. (Reference: *No Man's Sky* for the standing-still-and-looking test.)

## Non-negotiables

- **Real places, real businesses, real organisations.** Everything named in this world exists on the island
  or is clearly marked as proposed. Never invent a business. Data lives in `data/*.json` with a `source` field.
- **Australian English.** Harbour, realise, licence (noun), organisation, metres, kilometres. Prices in A$.
- **No em dashes.** Use a colon, semicolon, comma or full stop. This is a hard rule.
- **No overstatement.** Nothing is "revolutionary" or "the world's first". The smaller true claim beats the bigger vague one.
- **Cultural care.** Minjerribah is Quandamooka Country. Do not invent language words, do not invent
  ceremony, do not place sacred sites or story into the world. Anything cultural must be from a published,
  citable source and recorded in `data/lore.json` with that source, or it does not go in. When in doubt, leave it out
  and write the gap into `docs/CULTURAL-REVIEW.md` for a human to resolve with the Traditional Owners.
- **Determinism.** Same seed plus same inputs equals the same island. Never call `Math.random()`.
  Use `world.rng.stream('your-system-id')`. Never call `Date.now()` for simulation logic; use `world.clock`.
- **Offline.** No network requests at runtime. No CDN fonts. No external images. Everything is in the repo.

## Architecture in one page

```
index.html
  vendor/babylon.js            engine, vendored, do not modify
  src/main.js                  boot: data -> world -> stage -> systems -> UI -> loop
  src/kernel/                  world, store, bus, clock, rng, telemetry   [DO NOT EDIT without saying so]
  src/render/stage.js          Babylon engine + camera + render layer registry
  src/systems/manifest.js      one line per system module
  src/systems/<area>/<x>.js    simulation systems (no Babylon imports, ever)
  src/render/layers/<x>.js     render layers (Babylon lives here)
  src/ui/panels/<x>.js         DOM panels
  src/world/                   island geometry, terrain sampling, navigation
  data/*.json                  everything that is content rather than code
  tests/                       headless determinism and behaviour tests
```

**The split that matters:** a simulation system must run with no renderer at all
(`?headless=1`). If your system imports Babylon, it is in the wrong folder.

## Writing a system

`src/systems/environment/tide.js` is the reference. Copy its shape.

```js
export function registerThing(world) {
  const rng = world.rng.stream('thing');        // named stream, never Math.random
  const state = world.publish('thing', { ... }); // the read model others and the UI use

  return world.register({
    id: 'thing',
    phase: 'ecology',      // one of: environment ecology infrastructure economy agents movement civic narrative presentation
    order: 40,             // within the phase, ascending
    init(w) {},            // once, after data packs are loaded
    tick(w) {},            // every sim tick = 10 sim-minutes
    frame(w, dt) {},       // optional, once per rendered frame, for smoothing only
    describe(w) { return {...}; },  // small JSON for the critic tooling. Required.
    save(w) { return {...}; },
    load(w, s) {}
  });
}
```

Then add one line to `src/systems/manifest.js`.

**Systems never import each other.** Read another system's published state with `world.read('id')`,
or listen on `world.bus`. If you need something that does not exist yet, read it defensively
(`const t = world.read('tide'); if (!t) return;`) so the island still runs while the other half is being built.

## Writing a render layer

```js
import { registerLayer } from '../registry.js'; // or stage.addLayer from your register fn
world.stage?.addLayer({
  id: 'dunes', order: 30,
  init(stage, world) {},              // build meshes, materials
  frame(stage, world, dt) {},         // read world.state, move things
  dispose() {}
});
```
Guard everything with `if (!world.stage) return;` so headless still works.

## Writing a UI panel

```js
import { registerPanel, el } from '../mount.js';
registerPanel({ id: 'clock', order: 10, mount(root, world) { ... return { update(world) {...} }; } });
```
Panels update at 10 Hz regardless of sim speed. Panels **never** mutate simulation state.
They emit `world.bus.emit('ui:intent', { kind, ... })` and a system decides what happens.

## Performance budget

The whole thing must hold **60 fps on integrated graphics at 1080p** with the island populated.
- Sim: total tick under 4 ms at 1x with full population. Check `TWIN.probe().perf.hottest`.
- Draw calls: under 900 in the default planner view. Use thin instances for anything repeated
  (trees, houses, people, waves). Never one mesh per tree.
- No per-frame allocation in hot loops. Reuse vectors.
- LOD everything. The island is 27 km long; you cannot draw it all at full detail.

## Definition of done for a slice

A slice is not done when it works. It is done when a critic who has never seen your code
loads the running build, drives it, compares it blind against the reference game, and says ours is better.
That means:
- It runs with zero console errors and zero entries in `TWIN.errors()`.
- `TWIN.probe()` shows it doing something real over 500 ticks, not a constant.
- It is legible without a tutorial: a player can tell what is happening and why.
- It has feedback: sound, motion, colour, number, or text that responds within 100 ms of input.
- It has depth: a second-order consequence a player can discover.
- It is about **this island**, not a generic one. A stranger should learn something true about Minjerribah.

## Testing without a browser

The sim/render split exists so you can do this. Use it constantly:

```bash
node tools/headless.mjs --ticks 20000 --profile
node tools/headless.mjs --determinism
node tools/headless.mjs --system koala
```

`--determinism` runs the world twice and diffs a fingerprint of every system's `describe()`.
If it fails it names the system that diverged. That is almost always `Math.random`, `Date.now`,
or iterating a `Set` whose insertion order depends on something unstable.

## The debug handle

`window.TWIN` on the running page:
- `TWIN.probe()` full machine-readable state
- `TWIN.run(n)` advance n ticks headlessly and return a probe
- `TWIN.speed(i)`, `TWIN.save()`, `TWIN.load(s)`, `TWIN.events(type, n)`, `TWIN.errors()`

Critics use these. Keep `describe()` honest and cheap.
