# State of play

An engineering handover for the next agent, written from a fresh run of the build on 8 August 2026,
not from any earlier report. Every number below was measured in this session. `progress/status.json`
was not trusted and should not be trusted: see the note at the end.

This is deliberately unflattering. A handover that reads well and gets the next agent lost is worth
nothing.

---

## 1. The measured numbers

### Simulation, headless

```
node tools/headless.mjs --ticks 4320 --profile
```

| Measure | Value |
| --- | --- |
| Boot | 1.60 s, 46 registrations |
| Island heightfield build | 873 ms, 908 x 1314 at 32 m, 271 km2 land, high point 233 m |
| Tick cost | **3.274 ms/tick** over 4320 ticks (30 sim-days) in 14.1 s |
| Budget | 4 ms. There is about 0.7 ms of headroom and no more. |
| Hottest per-tick system | `tick:needs`, 1.96 ms avg, 10.91 ms max |
| Hottest init | `init:telecoms` 145 ms, `init:population` 130 ms, `init:needs` 40 ms |
| Modules missing | 18 files absent. Headless prints "24 modules not built yet" because six existing render and UI modules cannot import in node (`window is not defined`). `TWIN.missing` in the browser is the accurate list. |

One sim-year, `--ticks 52560`: completes, no runaway populations, no money runaway, no value pinned
at a cap that should not be. **One runtime error**, see section 4.

### Determinism

```
node tools/headless.mjs --determinism
DETERMINISM OK: two runs of 1440 ticks agree (c3c8c9e4).
```

Holds. No `Math.random` and no `Date.now` in simulation code (the only `Date.now` in `src/world/`
is a `performance.now` fallback in a build timer, not simulation logic). No em dash anywhere in
`src`, `data`, `docs`, `index.html` or `tools`.

### Frame, in the browser

`TWIN.bench(120)`, three consecutive runs after a clean load, planner camera over the island:

| Run | mean | median | p95 | worst | est fps | est 1% low | draw calls | active meshes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8.20 | 5.78 | 15.93 | **152.23** | 122 | 35.8 | 109 | 69 |
| 2 | 10.64 | 6.76 | 27.50 | 28.82 | 94 | 35.6 | 149 | 67 |
| 3 | 16.73 | 20.34 | 28.36 | 30.43 | 59.8 | 33.9 | 148 | 67 |

Close in over Dunwich at 120 m: mean 2.07 ms, 96 draw calls, 41 active meshes.

Read that table honestly. Draw calls are comfortable, at 96 to 149 against a 900 budget, and total
vertices are only 114,901 because trees and buildings are thin instances. But frame cost is not
stable: the median moved from 5.78 to 20.34 ms across three identical runs on the same view, and the
1 per cent low sits around 34 to 36 fps, which is above the CRITIC threshold of 30 but not by much.
The 152 ms worst frame in run 1 is shader compilation on first draw. It is real for a player loading
the page and it is not real for a benchmark, so always bench twice and quote the second.

### Entity counts

At 30 sim-days: 5,622 entities across 5 store kinds. 2,069 residents, 970 households, 1,958
dwellings, 1,922 buildings (89 named), 337 koalas, 74 whale pods, 1,700 shorebirds, 65 businesses
trading, 13,677 social ties, 33.1M modelled stems across 11 communities and 23 species, 19 dune
reaches, 61 policy levers, 36 narrative seeds, 22 info views, 82 road nodes and 144 navigation nodes.

At one sim-year: 5,826 entities. Social ties grow to 27,247. Residents 2,086. Visitor peak 8,141 on
27 December 2026. Busiest event channels over the year: `social:met` 92,848, `ferry:departed` 27,976,
`freight:order` 12,195, `ferry:overflow` 4,094, `navigation:beach-open` 2,237, `resident:stranded`
1,495, `resident:crossing-cancelled` 1,302.

### Source

69 JavaScript files under `src/`, 62,296 lines. Eleven data packs, about 1.9 MB, roughly 1,100
`source` fields and 760 URLs.

---

## 2. What is genuinely strong

**The island geometry.** `src/world/island.js` (1,570 lines) builds a 908 x 1314 heightfield at 32 m
from `data/geography.json` in 873 ms and exposes `height`, `normal`, `landCover`, `regionAt` and
`raycast` to every system. It is not decoration: navigation, buildings, flora, dunes, vegetation and
the info views all sample it. Flown to Point Lookout at 620 m the shape reads as the real place: the
Main Beach curve south, Home and Cylinder and Deadmans stepping round the headland, the Gorge, the
reef shelf turquoise offshore, the township strung along the ridge. That is the strongest single
asset in the repository.

**The kernel contract.** `src/kernel/world.js` is small, nine phases, deterministic ordering by
phase then order then id so registration order cannot change results, throw isolation, save and load,
and a mandatory `describe()` per system that makes the whole world machine-readable. Determinism
actually holds, which for a project this size with sixty-odd contributors is the load-bearing fact.

**The sim / render split is real, not aspirational.** Nothing under `src/systems/` imports Babylon.
That is why a sim-year runs in a terminal in about three minutes and why you can bisect a
non-determinism without a browser. Do not break this to save a turn.

**The data packs and their honesty.** 1,100 source fields, per-record confidence, and
`docs/DATA-NOTES.md` naming exactly what could not be verified: trading hours estimated for 94 of 101
businesses, every headcount an estimate, five unresolved address conflicts listed by name. Luke's own
corrections are folded in with a note explaining why, so a later agent does not re-add Rufus King
Seafoods from a stale tourism listing.

**The cultural governance.** `data/lore.json` carries thirteen prohibition rules and a banned-token
list. `docs/CULTURAL-REVIEW.md` queues about thirty open questions for QYAC and records refusals
rather than hiding them. The best example is R1: the brief asked for a "connection to Country" need,
and the build does not have one, with the reasoning written down. That is the right instinct and it
should survive every future wave.

**Second-order consequences that only appear over long horizons.** Koala vehicle and dog deaths are
zero at 30 days and 5 and 3 at one year. Marine hatchlings are 0 then 1,241 with 1 fox-taken nest.
Dune cut is 0.3 m then 8.2 m with the worst reach moving from South Gorge to the northern end of Main
Beach. `jobs.leftForARoom365` reaches 123. Those chains are real and they are the kind of thing the
CONTRACT means by depth.

**The interface writing.** The inspector empty state offers three starter picks: a named resident, "A
house with nobody in it, Point Lookout, half the island is like this", and "A koala, one of 340 on
the island". That is legible without a tutorial and it teaches something true about the island in one
line. The civic board's refusal wording, "No public statement by this body on this lever is held by
this project", is equally well judged.

---

## 3. What is scaffolding wearing a good coat

**Nothing alive is on screen, anywhere, at any zoom.** `people.js`, `vehicles.js`, `fauna.js` and
`weatherfx.js` are all missing from `src/render/layers/`. 2,069 residents with needs and jobs and
13,677 relationships, 337 koalas, 74 whale pods, 1,700 shorebirds, every ferry and every car exist
purely as numbers in panels. The world is terrain, water, sky, roads, buildings and trees. Six of the
CONTRACT's six purposes assume you can see people.

**Close range fails.** Street mode at head height at North Gorge is a flat green wash with a handful
of cross-billboard shrubs and nothing else: no ground clutter, no rocks, no surf, no path, no
buildings in frame. The "standing still and looking" test the CONTRACT names is currently not passed.
North Gorge is the most photographed place on the real island and it is the worst view in the build.

**Rock and reef platforms render as a fault.** From the air the shore platforms are flat, unlit,
hard-edged brown polygons with visible contour stepping along the east coast and around the Point
Lookout headland. An earlier wave already recorded a critic misreading the beaches as brown and
blaming the harness. The harness was fine then. These platforms are genuinely wrong now and they are
the first thing a stranger notices.

**Counters that never move over a full sim-year.** These are systems with real code that are not
actually binding on anything:

- `jobs`: `fillRate` 1, `shortBy` 0, `daysToFill` 0 at 30 days and at 365. The labour market never
  binds, so nothing downstream of labour scarcity can happen.
- `water`: `storagePct` pinned at 100 all year.
- `businesses`: `marginPct` 0 always; `openNow` and `takingsTodayA$` 0 whenever the probe is taken
  outside trading hours, which is most of the time.
- `telecoms`: `landUsablePct` 45.6, `deadSpots` 2, `sitesDown` 0, `blockingPct` 0, unchanged all year.
- `roads`: `culverts` 0, `causeways` 0.
- `dunes`: `blowouts` 0. `marine`: `turbidity` 0. `subterranean`: `generationKw` 0.
- `chour`: `hoursLogged` 0. **This one is deliberate and correct.** The ledger is money-only by
  design because islanders do not self-report hours. Do not "fix" it.

**Read models that report a dead island while the island is busy.** `ferry.describe()` returns
`carried: 0, waitMedianMin: 0, waitP90Min: 0, notCarried: 0, spilled: 0` after a full sim-year in
which `ferry:overflow` fired 4,094 times and 1,495 residents were stranded. The daily counters reset
at midnight and the probe lands at a quiet hour. The next critic will call the ferry a painting of a
simulation and will be wrong, but the fault will be ours.

**The narrative layer is the thinnest thing relative to its brief.** Over a sim-year: 36 seeds, 1,460
evaluations, **248 cast failures**, 9 threads opened, 23 storyline beats fired, 5 closed, 2 fizzled,
and 30 quiet days out of the last 30. Purpose 5 in the CONTRACT names *Disco Elysium* as the writing
bar. This is not near it, and the cast-failure rate says the seeds cannot find people who match their
requirements.

**Civic throughput is near zero.** One sim-year produces 3 development applications lodged (1
approved with conditions, 1 refused) and 1 consultation run. `policy` has 61 levers of which 38 stay
dormant all year. The machinery in `council.js` (1,303 lines) and `consultation.js` (781 lines) is
substantial and almost nothing flows through it.

**The subterranean layer is a static graph.** `built: 5, running: 5, stalled: 8, generationKw: 0`
after a year. It is correctly and consistently marked `existence: "proposed"`, which is the important
thing and must not change. As a play system it currently does nothing over time.

**`progress/status.json` is not a status of record.** It claims 27 slices passed, 16 building, 3 in
review, 2 failed, and its headline says seven UI panels are live. Seven panels are live, and six more
named in the manifest are not built. Read `TWIN.missing` and run the harness instead.

---

## 4. Bugs found this session

### 4.1 The storyline engine dies about 200 sim-days in

Reproduced at tick 28770 of a 52560-tick run:

```
storylines (tick @ tick 28770): r.delta.toFixed is not a function
```

Cause: `data/narrative.json` has five sentiment `sets` entries with a string where a number belongs.

```
.seeds.28.beats.3.sets.0  {"channel":"sentiment","group":"long-term-residents","delta":"computed"}
.seeds.29.beats.3.sets.1  {"channel":"sentiment","group":"volunteers-and-emergency","delta":"computed"}
.seeds.31.beats.3.sets.0  {"channel":"sentiment","group":"tourism-operators","delta":"computed"}
.seeds.33.beats.4.sets.1  {"channel":"sentiment","group":"ferry-commuters","delta":"computed"}
.seeds.35.beats.3.sets.1  {"channel":"sentiment","group":"tourism-operators","delta":"computed"}
```

`noteSentiment` in `src/systems/narrative/storylines.js:767` does `row.delta + delta`, which string
concatenates to `"0computed"`. `clamp` at line 68 is `(v, a, b) => (v < a ? a : v > b ? b : v)`, which
does no coercion and passes the string straight through. `describe()` at line 1223 then calls
`.toFixed(3)` on it and throws.

Because `World.step` sets `sys.tick = null` on any throw, the storyline engine is then **silently
dead for the rest of the run**. Everything after that day in a long game has no drama in it. Fix the
five data entries and add a `Number.isFinite` guard in `noteSentiment`.

### 4.2 `TWIN.setWeather` can permanently disable weather

`src/main.js:101` writes the argument straight into weather state with no validation:

```js
setWeather: (synoptic) => { const w = world.read('weather'); if (w) { w.synoptic = synoptic; } return w; },
```

Any value not in the `SYNOPTIC` table in `src/systems/environment/weather.js` causes
`pickNext` (line 44, `SYNOPTIC[current].next`) to throw at the next synoptic change, and the weather
system is disabled for the session. `TWIN.setWeather('clear')` is a natural thing for a critic to try
and it kills the weather. Validate against the table and set `label` and `target` too.

### 4.3 `TWIN.camera.flyTo` does not take a place id

`flyTo` (`src/render/camera.js:1037`) takes `{x, z}` or `{lon, lat}` plus `dist`, `heading`,
`pitchBias`, `alt`, `pitch`, `dur`. `TWIN.camera.places()` returns a list of ids that look like they
should work, and `TWIN.camera.flyTo('pointlookout')` silently flies to the projection origin instead.
Three shots were wasted on this. Either accept an id string or make it throw.

### 4.4 The boot acknowledgement does not match the lore pack

`index.html:18` reads "Quandamooka Country. Built with respect for the Traditional Owners of
Minjerribah, past and present." That wording is not in `data/lore.json`. The pack ships
`acknowledgement.game_wording.short` for the loading screen and `.long` for the splash screen, about
panel and README, and carries a rule against abbreviating the acknowledgement. The long version does
not appear anywhere in the running build. Given that `acknowledgement-present` is one of the thirteen
prohibition rules, this is exactly the drift the unwritten check harness would have caught.

---

## 5. Infrastructure traps

Do not rediscover these. Each one has already cost somebody a turn.

1. **`TWIN.shot()` captures the WebGL canvas only.** The interface is DOM and never appears in a
   shot. `read_page` on the tab is the only way to see the UI, and a UI verdict written from a
   screenshot is worthless because the screenshot cannot contain the thing being judged.

2. **The browser pane tab is hidden and `requestAnimationFrame` never fires.** Measured this session:
   `document.hidden === true`, zero rAF callbacks in one second, world stuck at tick 1 after minutes
   of wall time. Consequences: the sim does not advance on its own (use `TWIN.run(n)`), the live fps
   counter is meaningless, and **any camera move that blends over frames never lands**. `flyTo` calls
   `beginTransition()`, so the pose applies to the internal planner state and the shot comes out
   right, but `camera.state.position` is only refreshed on a frame and reads stale. Trust the shot,
   not `state.position`.

3. **The exposure meter is GPU-only and evaluated on demand.** A shot taken immediately after
   changing the time of day comes back at the previous exposure, which looks washed out or black.
   Three critic rounds were spent judging images that were artefacts of this. Set the time, wait a
   few hundred milliseconds, then shoot. A shot at the world's own start time is a night shot and
   the island will be nearly black: that is correct behaviour, not a bug.

4. **Babylon's `engine._drawCalls` is a lifetime accumulator, not a per-frame count.** `TWIN.bench`
   already reports both: `drawCalls` is the per-frame figure (96 to 149 here) and `drawCallsLifetime`
   is the accumulator (15,326 rising to 86,340 across one session). Quote the first one. Anyone
   reading the raw counter will report thousands of draw calls and fail the build wrongly.

5. **The first `bench(120)` after a load includes shader compilation.** Worst frame 152 ms on run 1,
   29 ms on run 2. Always bench twice.

6. **`World.step` disables any system that throws** by setting `sys.tick = null`. One bad tick removes
   a system for the remainder of the run and nothing in the UI says so. `TWIN.errors()` and the
   headless "N runtime errors" line are the only traces. Read them after every long run. This is how
   4.1 and 4.2 stay invisible.

7. **Node cannot import six existing render and UI modules** (`window is not defined`), so headless
   reports "24 modules not built yet" when only 18 files are actually absent. `TWIN.missing` in the
   browser gives the true list.

8. **`infoView(world).active()` returns a very large object.** Serialising it into a JS console
   result blew an 11 MB tool response this session. Read `TWIN.probe().systems.infoview` instead,
   which is the cheap `describe()`.

---

## 6. Every module still missing from the manifest

Eighteen files. `src/systems/manifest.js` lists them on purpose and the world runs without them.

Simulation:

- `src/systems/environment/fire.js` : fire danger, ignition, spread, planned burns
- `src/systems/environment/coast.js` : erosion, accretion, the Amity problem
- `src/systems/environment/groundwater.js` : the aquifer and the borefield (`lakes.js` currently
  carries some of this)
- `src/systems/movement/traffic.js` : vehicles on the road graph
- `src/systems/movement/crowd.js` : crowds and queues
- `src/systems/narrative/chronicle.js` : the island's written record
- `src/systems/presentation/readmodels.js` : shared presentation read models

Render layers:

- `src/render/layers/people.js`
- `src/render/layers/vehicles.js`
- `src/render/layers/fauna.js`
- `src/render/layers/weatherfx.js`

Audio:

- `src/audio/audio.js` : nothing in this build makes a sound

UI panels:

- `src/ui/panels/build.js`
- `src/ui/panels/ecology.js`
- `src/ui/panels/subterranean.js`
- `src/ui/panels/chronicle.js`
- `src/ui/panels/onboarding.js`
- `src/ui/panels/settings.js`

Also not written, and named as the next job in `docs/CULTURAL-REVIEW.md` section D: the prohibitions
check harness for the thirteen rules in `data/lore.json`.

---

## 7. The five things that would most improve this next, in order

**1. Fix the `"delta": "computed"` bug and guard `noteSentiment`.**
Five data entries and one `Number.isFinite` check. It currently kills the entire drama layer roughly
200 sim-days into any long game, and drama is one of the six purposes in the CONTRACT. Nothing else
on this list is this cheap or this consequential. Do it first, then re-run
`--ticks 52560 --profile` and confirm the error count is zero.

**2. Build the four missing render layers: people, vehicles, fauna, weatherfx.**
This is the single biggest gap between what the simulation knows and what a player sees. 2,069
residents with schedules, needs, jobs and 13,677 relationships are invisible. So are the koalas, the
whales, the shorebirds and every vehicle. Use thin instances with LOD, because the draw-call budget
has 750 calls of headroom and the frame budget has almost none. Start with people at township scale
and vehicles on the sealed road graph, since `navigation.js` already produces the paths.

**3. Make close range worth looking at, and fix the rock platforms.**
Head height at North Gorge is the worst view in the build, and the flat brown shore platforms read as
a rendering fault from the air. Ground clutter, a surf line at the shore, and shading on the
platforms. This is what decides whether a stranger believes the place is real, and it is the test the
CONTRACT names explicitly.

**4. Make the civic and economic read models describe the day, not the instant.**
Ferry, council, consultation and jobs all have substantial machinery and all `describe()` as zeros.
Add rolling 24-hour and 7-day figures alongside the instantaneous ones, and while you are in there
work out why the labour market never binds and why only 3 development applications are lodged in a
sim-year. Four systems that look dead to a critic and are not is a bad trade for the work already in
them.

**5. Write the prohibitions check harness.**
`docs/CULTURAL-REVIEW.md` section D lists thirteen rules written to be machine-checked, and section D
itself says writing the harness is the next job and that it is small: most are token scans over
`src`, `data` and `docs`. Right now the cultural care in this repository is a convention that agents
follow by hand, and `index.html:18` has already drifted from the pack's own acknowledgement wording
without anything noticing. A convention that nothing enforces will not survive another sixty agents.
