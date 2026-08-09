# Minjerribah Living Twin

A digital twin of Minjerribah, North Stradbroke Island, Quandamooka Country, south east Queensland,
that runs in a browser game engine. The island is modelled as a heightfield with real coordinates, and
a set of simulation systems runs on top of it: tide, weather, daylight, the lakes and the water
table, dunes, vegetation, koalas, whales, shorebirds, marine life, power, water, waste, telecoms,
businesses, tourism, housing, jobs, prices, residents with needs and jobs and relationships,
visitors, navigation, traffic, crowds, the ferry, council decisions, policy levers, a budget, public
sentiment, a narrative director and the island's own written chronicle.

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
that would enforce them is not written yet, and on 9 August 2026 the first hand-run of one of them
found a live violation in a shipped data pack: five deleted season names were still being used as
keys in `data/narrative.json`. They have been removed and the whole episode is written up in
`docs/CULTURAL-REVIEW.md` section D1. A rule that nothing executes is not a rule.

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
node tools/headless.mjs --ticks 52560 --profile    # one sim-year, about five minutes
node tools/headless.mjs --determinism              # runs the world twice and diffs it
node tools/headless.mjs --system koala             # one system's describe() output
```

The keyboard is in `docs/KEYS.md`, in one table per area, and the arrival screens show the same map.
If you bind a key, put it in that file in the same commit.

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

Everything that is content rather than code lives in `data/`: twelve JSON packs, about 1.9 MB,
covering geography, places, businesses, ecology, residents, transport, civic levers, events,
narrative seeds, the soundscape, the proposed subterranean works, and lore.

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

Measured on 9 August 2026 by an agent who played the whole thing end to end, not reported by a
builder.

- **The island.** 271 km2 of land, high point 233 m, built as a 908 by 1314 heightfield at 32 m
  resolution in under a second, with height, normal, land cover, named regions and raycasting
  available to every system. Flown to Amity Point at 900 m the shape reads as the real place: the
  spit, the jetty, the two streets, the bay banks. Flown to Point Lookout at 420 m it is streets of
  houses on a headland above a beach.
- **55 systems and layers registering clean**, with zero console errors on a cold load and zero
  entries in `TWIN.errors()` after driving every panel and pressing every key in `docs/KEYS.md`.
- **A sim-year completes with zero runtime errors.** It did not until this pass: a string where a
  number belonged killed the storyline engine about ninety days in, every time.
- **Determinism.** Two runs of the same seed agree to a fingerprint over 1440 ticks.
- **13 panels and 15 render layers.** The HUD with air, wind, swell, tide, UV, fire danger and
  crossing conditions; the island log with severity filters and search; 22 searchable info views
  that paint data over the ground; a civic board with levers, traces, decision makers, an in tray,
  groups, consultation and budget; an inspector that fills when you click anything; a map with a
  full-screen mode; an island calendar; a siting bench; the chronicle; the proposed works below the
  sand; settings; and a generative soundscape with a mixer.
- **People, vehicles and wildlife are on screen.** About 2,300 people drawn at a township in four
  draw calls, vehicles on the road graph, whales off the headland in daylight and not at night,
  koalas in the trees.
- **The civic chain works end to end.** Pick a lever, read who decides it and what it claims it will
  do, open a file, and the in tray gives you five commissionable studies with real week counts and
  real prices, a lodge-it-anyway path that comes back as an information request twelve weeks later,
  and a petition that is described as a list of names unless a consultation came back in favour.
- **The seams between systems carry.** A koala hit on the road reaches the wildlife rescue call, the
  notification bar, the chronicle and the conservation groups' mood. A barge cancellation rolls
  vehicles, moves the ferry commuters, and gets written up. Eighteen of twenty-two lived-event
  channels fire over a sim-year; two of eleven did before this pass.
- **A camera** with planner, street, follow, drone and cinematic modes, bookmarks, labels,
  letterbox and a photo mode.

## What does not work today

- **The tick is over budget**, at 6.23 ms against 4. Draw calls are comfortable at 115 to 179
  against a budget of 900, so this is CPU rather than the renderer.
- **Close range is hazed and washed out.** Street level in a township has almost no contrast. The
  bay-side water renders a saturated fluorescent green rather than turquoise.
- **Five modules named in the design are not written**: fire, coastal erosion, groundwater, shared
  presentation read models, and a stewardship board. They are listed in `PLANNED` in
  `src/systems/manifest.js` and reported at boot rather than requested and failed.
- **Several read models describe the instant rather than the day**, so a probe taken at 5:20am
  reports zeros for a ferry that carried thousands of people. The ferry is the clearest case.
- **Sixteen per cent of vehicle route requests fail**, every one of them because
  `data/geography.json` does not carry the street. The system counts the failure rather than drawing
  a car on a road that is not there, which is right, but it is why the roads look quiet.
- **The narrative layer is thin against its brief.** Over a sim-year, 12 threads opened and 35 beats
  fired against 514 cast failures, and most days are quiet.

`docs/STATE-OF-PLAY.md` is the blunt engineering version of this list, with the measured numbers, the
known traps, and what to do next.

## Documents

| File | What it is |
| --- | --- |
| `docs/CONTRACT.md` | The build contract. Architecture, non-negotiables, performance budget, definition of done. |
| `docs/CRITIC.md` | How the project is judged. Read this before reviewing anything. |
| `docs/KEYS.md` | The keyboard, in one place. Add a key here in the same commit you bind it. |
| `docs/STATE-OF-PLAY.md` | Engineering handover: measured numbers, what is strong, what is scaffolding, what to fix. |
| `docs/CULTURAL-REVIEW.md` | Open questions for QYAC. Not approvals. |
| `docs/DATA-NOTES.md` | What each data pack could not verify. |
| `docs/CAPTURE-CONTRACT.md` | How real-world scanned assets arrive, what they contain, and what to decide before loading one. |
| `docs/DIRECTION.md` | What this twin is, inside the larger body of work: the founding brief, where the twin sits, and the direction future waves follow. |
| `docs/PARTICIPATION.md` | The contribution design, none of it built: the lanes, the trust spine, consent, and the floor. The direction the founding brief never contained. |
| `docs/SOURCES.md` | Where the source material is, what is in it, and what to do with it. Read before dispatching a wave that needs facts. |

## Credit

Built by Luke Catalyst Nathan Hayes with Claude (Opus 5).
