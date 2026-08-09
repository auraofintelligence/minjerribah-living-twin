# Minjerribah Living Twin

A digital twin of Minjerribah, North Stradbroke Island, Quandamooka Country, south east Queensland,
that runs in a browser game engine. The island is modelled as a heightfield with real coordinates, and
a set of simulation systems runs on top of it: tide, weather, daylight, groundwater and the lakes,
dunes, koalas, whales, shorebirds, marine life, power, water, waste, telecoms, businesses, tourism,
housing, jobs, prices, residents with needs and jobs and relationships, visitors, roads, the ferry,
council decisions, policy levers, a budget, public sentiment and a narrative director.

It is a work in progress. It is not a product, it is not finished, and it does not claim to be
better than anything.

## Acknowledgement of Country

> Minjerribah is Quandamooka Country. This project acknowledges the Quandamooka People as the
> Traditional Owners of Minjerribah and of the lands and waters of Moreton Bay, and pays respect to
> Elders past and present. QYAC, the Quandamooka Yoolooburrabee Aboriginal Corporation, holds and
> manages the Quandamooka People's native title rights and interests. This is a simulation built from
> public records. It is not a cultural work and it does not speak for the Quandamooka People.

Source: `data/lore.json`, `acknowledgement.game_wording.long`. That entry also records that QYAC
publishes its own acknowledgement in *Jara marumba yaga: Make good Country, Quandamooka Country
Sustainability Strategy* (QYAC, source key `qyac-sustainability`), and that this project deliberately
does not copy QYAC's wording into a game asset. QYAC's own wording is the reference. This project's
wording is its own.

`data/lore.json` carries `"status": "not_reviewed_by_traditional_owners"`. QYAC has not seen this
project.

## Cultural review: open questions, not approvals

`docs/CULTURAL-REVIEW.md` is a queue of things an agent found, could source, and deliberately did not
build, because a human needs to resolve them with the Traditional Owners. It runs to roughly thirty
items across naming, history, sites, language, art and what the twin should model at all.

Nothing in that file is approved. Nothing in it is settled. It is not a record of consultation and it
is not a sign off. It is a list of questions for QYAC, written down so they are not quietly forgotten,
and the first question on it is whether QYAC wants this project to exist.

`data/lore.json` also carries a `prohibitions` block of thirteen rules covering invented language,
invented ceremony, sacred and restricted sites, cultural content without a source, and generated
Aboriginal art. Those rules are currently a convention that agents follow by hand. The check harness
that would enforce them is not written yet.

## Running it

You need Node. There is no build step, no package install and no network access at runtime. The
engine, Babylon.js 9.20, is vendored in `vendor/babylon.js`.

In the browser:

```
node tools/serve.js
```

then open `http://localhost:4271/`.

With no browser at all:

```
node tools/headless.mjs --ticks 4320 --profile     # 30 sim-days, with timings
node tools/headless.mjs --determinism              # runs the world twice and diffs it
node tools/headless.mjs --system koala             # one system's describe() output
```

On the running page, `window.TWIN` is the debug handle: `TWIN.probe()` for full machine-readable
state, `TWIN.run(n)` to advance n ticks, `TWIN.bench(120)` for frame cost and draw calls,
`await TWIN.shot('name', 1600, 900)` to write a PNG into `shots/`, and `TWIN.errors()` for anything
that threw.

## Architecture

One `World` object owns a clock, a seeded RNG pool, an event bus, an entity store and a list of
systems. Each system declares a phase (environment, ecology, infrastructure, economy, agents,
movement, civic, narrative, presentation) and an order within it, and runs in that order every tick,
which is ten sim-minutes. Systems never import each other: they publish a read model under their own
id and read other systems' read models by id, defensively, so half the island can be missing and the
rest still runs. Render layers and DOM panels sit on the same registry but are separate files.

The rule that makes it work is that **simulation never imports the renderer**. Anything under
`src/systems/` and `src/world/` runs with no Babylon and no DOM, which is why `tools/headless.mjs`
can run a sim-year in a terminal and why determinism can be checked by running the world twice and
diffing every system's `describe()`. Simulation uses `world.rng.stream('id')` and never
`Math.random`, and `world.clock` and never `Date.now`. Render code lives under `src/render/`, panels
under `src/ui/panels/`, and both guard on `world.stage` so headless is unaffected.

## The data

Everything that is content rather than code lives in `data/`: eleven JSON packs, about 1.9 MB,
covering geography, places, businesses, ecology, residents, transport, civic levers, events,
narrative seeds, the proposed subterranean works, and lore.

The packs were built by reading public sources and they carry their working. There are about 1,100
`source` fields and 760 source URLs across them, and most records carry a `confidence` of high,
medium or low. `docs/DATA-NOTES.md` is the companion: one section per pack, listing what could not be
verified. That includes trading hours for most businesses, every business headcount, several
unresolved street addresses, and a number of modelling estimates that are plainly labelled as
estimates rather than measurements.

Corrections from Luke's own island work are folded in and recorded, so that a later pass does not
re-add something from a stale listing: Rufus King Seafoods is closed, Amity Point Progress
Association has wound up, and Oceanic Gelati is now Whale Tail Gelati & Coffee Bar at the same site.

Nothing in the world is invented. No business, place, road or Aboriginal language word appears unless
it is in a pack with a source, or is clearly marked as proposed. The subterranean works are proposed
and are never shown as existing.

## What works today

- The island. 271 km2 of land, high point 233 m, built as a 908 by 1314 heightfield at 32 m
  resolution in under a second, with height, normal, land cover, named regions and raycasting
  available to every system. From the air the shape reads true: the Point Lookout headland, Main
  Beach, Eighteen Mile Swamp behind the dunes, the bay shallows.
- 46 systems and layers registering and running clean, with no console errors over 30 sim-days.
- Determinism. Two runs of the same seed agree to a fingerprint over 1440 ticks.
- Headless simulation at 3.27 ms per tick over 30 sim-days, against a 4 ms budget.
- Rendering at 96 to 149 draw calls, against a 900 budget, using thin instances for trees and
  buildings.
- Seven UI panels: the HUD with weather, tide, fire danger and crossing conditions, the island log,
  22 searchable info views that paint data over the island, a civic board with levers, traces,
  decision makers, an in tray, groups, consultation and budget, an inspector, a map, and an island
  calendar.
- A camera with planner, street, follow, drone and cinematic modes, bookmarks and a photo mode.

## What does not work today

- Nothing alive appears on screen. The render layers for people, vehicles, fauna and weather effects
  are not built. 2,069 residents, 337 koalas, 74 whale pods, every car and every boat exist only as
  numbers in a panel.
- Close range is poor. At head height the ground is a flat colour wash with billboard trees and no
  clutter, no surf line and no detail. Rock and reef platforms render as flat brown polygons with
  visible contour stepping.
- Eighteen of the modules named in `src/systems/manifest.js` do not exist yet, including fire, coast
  erosion, groundwater, traffic, crowds, audio, and six UI panels. The manifest lists them on purpose
  and the world runs without them.
- Several read models report zeros for things that are actually happening, because the counters reset
  daily and are read at a quiet hour. The ferry is the clearest case.
- Two known bugs kill a system mid run: a data type problem in `data/narrative.json` disables the
  storyline engine after roughly 200 sim-days, and `TWIN.setWeather` with an unknown value disables
  the weather system.
- The narrative director is thin against what it is meant to do. Twenty-three storylines fired across
  a sim-year, and most days are quiet.

`docs/STATE-OF-PLAY.md` is the blunt engineering version of this list, with the measured numbers, the
known traps, and what to do next.

## Documents

| File | What it is |
| --- | --- |
| `docs/CONTRACT.md` | The build contract. Architecture, non-negotiables, performance budget, definition of done. |
| `docs/CRITIC.md` | How the project is judged. Read this before reviewing anything. |
| `docs/STATE-OF-PLAY.md` | Engineering handover: measured numbers, what is strong, what is scaffolding, what to fix. |
| `docs/CULTURAL-REVIEW.md` | Open questions for QYAC. Not approvals. |
| `docs/DATA-NOTES.md` | What each data pack could not verify. |
| `docs/CAPTURE-CONTRACT.md` | How real-world scanned assets arrive, what they contain, and what to decide before loading one. |
| `docs/DIRECTION.md` | What this twin is, inside the larger body of work: the founding brief, where the twin sits, and the direction future waves follow. |
| `docs/PARTICIPATION.md` | The contribution design, none of it built: the lanes, the trust spine, consent, and the floor. The direction the founding brief never contained. |

## Credit

Built by Luke Catalyst Nathan Hayes with Claude (Opus 5).
