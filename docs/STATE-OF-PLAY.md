# State of play

An engineering handover, rewritten on 9 August 2026 by the smoothing pass: one agent who played the
whole build end to end, from the acknowledgement screen through every panel and every key, then ran
it headless for a sim-year. Every number below was measured in that session. Nothing here is
repeated from an earlier report; where the previous version of this file said something that is no
longer true, it has been replaced rather than annotated.

This is deliberately unflattering. A handover that reads well and gets the next agent lost is worth
nothing.

---

## 1. The measured numbers

### Simulation, headless

```
node tools/headless.mjs --ticks 52560 --profile
```

| Measure | Value |
| --- | --- |
| Boot | 1.69 s, **55 registrations**, 6 modules not imported |
| Island heightfield | 908 x 1314 at 32 m, 271 km2 land, high point 233 m, built in about 900 ms |
| Tick cost | **6.23 ms/tick** over 52,560 ticks (365 sim-days) |
| Budget | 4 ms. **Over by about 55 per cent.** This is the performance pass's job, not a mystery. |
| Hottest init | `init:telecoms` 150 ms, `init:population` 125 ms, `init:needs` 37 ms |
| Runtime errors over a sim-year | **zero** |
| Modules designed and not written | 5. They are in `PLANNED` in `src/systems/manifest.js`, reported at boot, and not requested over the network. |

The six modules headless does not import are existing render, audio and UI files that need `window`.
That is expected and is not the same thing as a missing file. `TWIN.missing` in the browser is the
list of files that genuinely do not exist, and it has five entries.

### Determinism

```
node tools/headless.mjs --determinism
DETERMINISM OK: two runs of 1440 ticks agree (e140a9fb).
```

Holds. No `Math.random` and no `Date.now` in simulation code: the only `Date.now` under `src/world/`
is a `performance.now` fallback in a build timer. No em dash anywhere in the repository, including
`src/systems/narrative/chronicle.js`, whose em dash rule now spells the character by code point so
that a repo-wide grep comes back clean.

### Frame, in the browser

**Not measured reliably this session, and the honest answer is that this environment could not
measure it.** The browser pane stopped compositing part way through the pass, `document.hidden`
went true, and every `TWIN.bench` reading after that point is throttled: the same view returned
56.8 fps, then 26.6, then 20.1, then 7.7. Do not quote any of those.

What is measurable and did not move with the throttling:

| Measure | Value | Budget |
| --- | --- | --- |
| Draw calls, planner over the whole island | 115 | 900 |
| Draw calls, planner over Point Lookout at 600 m | 133 | 900 |
| Draw calls, street level in a township | 179 | 900 |
| Active meshes | 48 to 89 | |
| Total vertices | about 154,000 | |

Draw calls are comfortable, because trees, buildings, people and vehicles are all thin instances.
The frame budget is the thing under pressure, and it belongs with the 6.23 ms tick cost as one
problem for the performance pass.

### Entity counts

At 10 sim-days: 5,902 entities across 5 store kinds. 2,071 residents in 970 households, 1,958
dwellings, 1,922 buildings (89 named premises), 340 koalas, 65 whale pods, 1,700 shorebirds, 563
visitor parties, 65 businesses trading, 6,693 social ties, 33.1M modelled stems, 19 dune reaches,
62 policy levers, 36 narrative seeds, 22 info views, 144 navigation nodes.

At one sim-year: 5,826 entities. Residents 2,086, median age 51. Social ties grow to 27,247 across
1,306 bubbles. Visitor peak 8,141 on 27 December 2026. Koalas 337 with 78 births and 65 deaths, of
which 5 were vehicles and 3 dogs. Shorebirds fall from 1,700 to 1,569 with mean fat 0.446. Turtle
hatchlings 1,241. Dune cut 8.2 m with the worst reach at the northern end of Main Beach.

### Interface

13 panels mounted, 15 render layers, zero console errors on a cold load, zero entries in
`TWIN.errors()` after driving every panel and pressing every key.

---

## 2. What is genuinely strong

**The island geometry.** `src/world/island.js` builds the heightfield from `data/geography.json` and
exposes `height`, `normal`, `landCover`, `regionAt` and `raycast` to every system. Navigation,
buildings, flora, dunes, vegetation and all 22 info views sample it. Flown to Amity Point at 900 m
the shape reads as the real place: the spit, the jetty, the two streets, the bay banks. Flown to
Point Lookout at 420 m the township is streets of houses on a headland above a beach. That is the
strongest single asset in the repository.

**The kernel contract, and the split that makes it possible.** Deterministic ordering by phase then
order then id, throw isolation, save and load, and a mandatory `describe()` per system. Nothing
under `src/systems/` imports Babylon, which is why a sim-year runs in a terminal in five minutes and
why non-determinism can be bisected without a browser. Do not break this to save a turn.

**The civic board.** Sixty-two researched levers, each carrying what it costs to build, what it
costs to run, how long it takes and who decides it, with the last one the point. Open a file on a
lever and you get an in tray with five commissionable studies, each with a real week count and a
real price, a lodge-it-anyway path that comes back as an information request twelve weeks later, and
a petition that is described as a list of names unless a consultation came back in favour. It is
better than the *Democracy 4* comparison it was built against on the specific question of whose
decision a decision is.

**The resident model, played rather than read.** Following one resident through a day gives
breakfast, a lap of Adams Beach, the yard, the toilet, then bed, each with a plain-English reason.
Across the island the day has a shape: surf at dawn, the yard mid-morning, a swim at midday, bins
out at 5:20pm on bin night, dinner, sleep. Nine needs including island fatigue, which runs the other
way and says so on screen.

**The chronicle's discipline.** Every line is vetted before publication against the tone guide in
`data/narrative.json` and the prohibitions in `data/lore.json`: em dashes, quotation marks, banned
words, banned tokens and a ceremony token list, with the count of rejections and their reasons in
`describe()`. Over a sim-year 639 lines were written, 3,623 held back, and none was rejected by the
guard, which is the shape you want.

**The subterranean board's honesty.** Every one of its seven tabs opens with the same paragraph:
nothing below the sand is built, approved, funded, sited or consented. The consent tab models the
process shape, waits, and says it does not model the decision. `cHours` in that pack is explicitly
non-money, non-traded, and points at `src/systems/economy/chour.js` so the two do not drift.

**The data packs and their working.** About 1,100 `source` fields and 760 URLs, per-record
confidence, and `docs/DATA-NOTES.md` naming what could not be verified. Luke's own corrections are
folded in with a note explaining why, so a later agent does not re-add Rufus King Seafoods from a
stale tourism listing.

---

## 3. What the smoothing pass fixed

Recorded in enough detail that nobody re-introduces any of it.

**3.1 A sim-year could not complete.** `data/narrative.json` carries `"delta": "computed"` in five
coda beats. `noteSentiment` in `storylines.js` added that string to a number, `clamp` compared it
without coercing, and the first `.toFixed` threw. `World.step` then set `sys.tick = null`, so the
whole drama layer was silently dead from about day 90 of every long game. The delta is now coerced
and unresolvable ones are counted into `describe().unresolvedSets` instead of taking the system
down. Nothing derives `"computed"` yet: that is a real gap and it is now visible instead of fatal.

**3.2 Nine of eleven sentiment channels had never fired.** `LIVED_CHANNELS` in
`src/systems/civic/sentiment.js` was written before the ecology, movement and infrastructure systems
existed, against guessed event names: `wildlife:strike`, `wildlife:dog`, `fire:burn`,
`fire:incident`, `storm:`, `waste:missed`, `housing:eviction`, `event:`. None of those events is
emitted by anything. A koala hit on East Coast Road did not move the conservation groups, smoke over
the townships did not move the retirees, and a household losing its lease to a holiday letting did
not move the renters. Over a sim-year exactly two channels ever fired. Every prefix is now an event
a system actually emits, with the emitter named beside it, plus an optional `when` predicate so one
`wildlife:call` can mean a road strike to one group and a dog attack to another. **Eighteen of
twenty-two channels now fire over a sim-year**, and the four that do not are honest: there is no
wildfire because `fire.js` is not built, and no boil-water notice, missed bin collection or storm
cut happened in that seed-year.

**3.3 The barge never cancelled, in any year.** `mechanical()` in `ferry.js` rolled a failure for
all three vehicle vessels, but the base timetable is worked by two of them: Quandamooka is the
relief boat and appears in no sailing. A third of every failure landed on a vessel with nothing to
cancel, and the other failures happened at night. Result: over a sim-year the water taxis were
called off 343 times but the barge was never once cancelled, so `ferry:cancelled`,
`ferry:freight-spoiled` and the whole cascading-day chain the code's own comment describes had never
run. `mechanical()` now rolls only for vessels rostered that day. A sim-year produces **two
cascading days**, 23 and 24 November 2026 and 23 February 2027, with 12 barge sailings cancelled and
up to 47 vehicles rolled off a single one.

**3.4 The cancelled barge and the called-off water taxi reached nothing but the notification bar.**
Both now write to the chronicle: `ferry:cancelled` as a lead, `ferry:stranded` held for a week so a
fortnight of southerlies does not become a fortnight of the same paragraph.

**3.5 A blocking cultural rule was being violated in the data.** `data/narrative.json` carried five
of the deleted invented season names as `season_bias` keys, in 28 seeds, including `yalingbila` used
as a season when its published meaning is whale. Removed, not renamed. Written up in
`docs/CULTURAL-REVIEW.md` section D1.

**3.6 The interface was four panels fighting for the same rectangles.** At 1280 x 720 the inspector
docked over the top right of the HUD and stole 376 px from a 1280 px readout, crushing every
conditions tile until "15.2°" and "6 kt" overlapped; it also covered the minimap completely, top to
bottom. The info view legend grew upward out of the bottom left corner and covered the entire
launcher rail, so with a data layer on, six of the thirteen panels could not be reached with the
mouse. The audio prompt landed on the first-run hint and the island log at the same moment. Measured
now, in every state including a legend open and a board open: **zero overlaps between permanent
panels**. The left edge reads rail, then legend, then log; the right edge is the inspector, with the
minimap beside it.

**3.7 Five 404s on every cold boot.** `manifest.js` lazily imported five modules nobody has written.
They are in a `PLANNED` list now, still reported at boot and still in `TWIN.missing`, and the console
is clean.

**3.8 Smaller things.** The civic board printed "adoption is due now away". The inspector footer
ended every card with raw local-frame metres, "-6657, 6750". The chronicle published lower case
sentences as detail lines ("three animals in the pod."). The roads layer logged
"8103.666666666667 sections". The boot screen's acknowledgement had drifted from the lore pack's own
wording and is now verbatim from `acknowledgement.game_wording.short`. `TWIN.setWeather` accepted
any string and disabled the weather system at the next synoptic change; it validates now and applies
properly. `TWIN.camera.flyTo('pointlookout')` flew to the projection origin; it takes a place id
now. Six copies of the launcher rail's CSS lived in six panels, guarded by a shared style id so
whichever panel loaded first decided the layout for the other five; it is in `src/ui/design.css`
once. Five full-screen boards used three different insets; there is a `--board-inset` token.

---

## 4. What is still wrong

**4.1 The tick is over budget and the frame rate is unknown.** 6.23 ms/tick against 4. The
performance pass owns this.

**4.2 The bay reads fluorescent green.** From 900 m over Amity Point the bay-side water is a
saturated, clipped green rather than the turquoise the ocean side gets. The shader colours in
`src/render/layers/ocean.js` are plausible in linear space (`sssCol` mixes toward
`vec3(0.32, 0.46, 0.16)` on the bay side, `scatter` toward `vec3(0.12, 0.20, 0.10)`), which points
at the interaction with the tone mapper rather than at the colours themselves. Left alone
deliberately: `postfx.js` is another agent's this wave and correcting both ends at once produces a
double correction nobody can unpick. `shots/smooth-05-amity.png` is the evidence.

**4.3 Close range is still poor and the whole frame is hazed.** Street level in a township is a
washed-out grey-blue with no contrast. This is the fog bug, and it is the other agent's.

**4.4 Counters that never move over a full sim-year.** Real code that is not binding on anything:

- `jobs`: `fillRate` 1, `shortBy` 0, `daysToFill` 0 at 10 days and at 365. The labour market never
  binds, so nothing downstream of labour scarcity can happen. `leftForARoom365` reaches 123, so the
  housing side of it does bind: it is specifically the vacancy side that does not.
- `water`: `storagePct` pinned at 100 all year.
- `telecoms`: `landUsablePct` 45.6, `deadSpots` 2, `sitesDown` 0, `outageMin365` 0, unchanged.
- `roads`: `culverts` 0, `causeways` 0, although the roads render layer builds 3 culverts and 1
  causeway, so the two disagree.
- `businesses`: `marginPct` 0 always.
- `subterranean`: `generationKw` 0 all year.
- `chour`: `hoursLogged` 0. **Deliberate and correct.** The ledger is money-only by design because
  islanders do not self-report hours. Read the header of `src/systems/economy/chour.js` before
  touching anything near it. Do not "fix" this.

**4.5 Read models that describe the instant, not the day.** `ferry.describe()` still returns
`carried: 0, waitMedianMin: 0, notCarried: 0` after a sim-year in which `ferry:overflow` fired 4,090
times and 343 sailings were called off, because the daily counters reset at midnight and the probe
lands at 5:20am. The next critic will call the ferry a painting of a simulation and will be wrong,
and the fault will be ours. Rolling 24-hour and 7-day figures beside the instantaneous ones would
fix ferry, council, consultation and jobs at once.

**4.6 Sixteen per cent of route requests fail.** 328,801 failures out of 2,182,279 over a sim-year,
all of them `no route on the mapped network`. This is honest rather than broken: `data/geography.json`
does not carry every street, and `traffic.js` counts the failure rather than drawing a vehicle on a
road that is not there, with the reasoning in `state.routing.failedNote` and the specific gaps named
in `navigation.notes`. It is still the largest single thing standing between the road network and
looking alive.

**4.7 The narrative layer is thin against its brief.** Over a sim-year: 36 seeds, 1,460 evaluations,
**514 cast failures**, 12 threads opened, 35 beats fired, 12 closed, 5 fizzled, and 30 quiet days
out of the last 30. Purpose 5 in the contract names *Disco Elysium* as the writing bar. The lines
that do get written are good. There are not enough of them, and the cast-failure rate says the seeds
cannot find people who match their requirements.

**4.8 Civic throughput is near zero.** One sim-year produces 3 development applications and 1
consultation. `council.js` and `consultation.js` are substantial and almost nothing flows through
them. Some of this is correct (the player is not the one who decides) and some of it is that nothing
else in the world lodges anything.

**4.9 Five `"delta": "computed"` sets still resolve to nothing.** See 3.1. They no longer crash and
they are counted, but the coda beats they belong to have no mood effect.

**4.10 The prohibitions harness is still not written**, and section D1 of
`docs/CULTURAL-REVIEW.md` is now the argument for writing it: a blocking rule was recorded, agreed
and violated inside the same repository by an agent that had read the file.

---

## 5. Infrastructure traps

Each of these has already cost somebody a turn.

1. **`TWIN.shot()` captures the WebGL canvas only.** The interface is DOM and never appears in a
   shot. A UI verdict written from a canvas screenshot is worthless because the screenshot cannot
   contain the thing being judged. Use `read_page`, or measure the DOM directly.

2. **The browser pane's compositing comes and goes.** It composited for the first part of this
   session and then stopped, with `document.hidden === true` for the rest. When it is hidden:
   `requestAnimationFrame` does not fire, so the sim does not advance on its own (use `TWIN.run(n)`),
   every `TWIN.bench` reading is throttled and meaningless, CSS animations sit at `currentTime: 0`
   with `playState: "running"` forever, and any panel whose entry animation is `both`-filled reads as
   `opacity: 0` and will be missed by any script that filters on visibility. Call
   `document.getAnimations().forEach(a => a.finish())` before measuring the DOM.

3. **`camera.state.position` is only refreshed on a rendered frame.** After a `flyTo` with the pane
   hidden it reads `{0, 0, 0}`. `TWIN.shot()` renders manually, so taking a shot updates it. Trust
   the shot, not the state.

4. **The exposure meter is GPU-only and evaluated on demand.** A shot taken immediately after
   changing the time of day comes back at the previous exposure. Set the time, wait a few hundred
   milliseconds, then shoot.

5. **Babylon's `engine._drawCalls` is a lifetime accumulator.** `TWIN.bench` reports both:
   `drawCalls` is per frame, `drawCallsLifetime` is the accumulator. Quote the first.

6. **`World.step` disables any system that throws** by setting `sys.tick = null`. One bad tick
   removes a system for the rest of the run and nothing in the interface says so. `TWIN.errors()`
   and the headless error count are the only traces. This is exactly how 3.1 stayed invisible for
   two waves.

7. **A read model with a function on it survives `describe()` but not a JSON save.**
   `weather.force` is deliberate and `save()` drops it; if you add another, check `load()`.

---

## 6. What is designed and not written

Five files, listed in `PLANNED` in `src/systems/manifest.js`, reported at boot, and not requested
over the network:

- `src/systems/environment/fire.js` : fire danger, ignition, spread, track closures. Its absence is
  why `ecology:burn` only ever fires as a planned burn and why the fire info view has nothing
  unplanned to show.
- `src/systems/environment/coast.js` : erosion, accretion, the Amity problem. `dunes.js` carries
  some of this.
- `src/systems/environment/groundwater.js` : the aquifer and the borefield. `lakes.js` carries some
  of this.
- `src/systems/presentation/readmodels.js` : shared presentation read models. Section 4.5 is the
  case for it.
- `src/ui/panels/ecology.js` : a stewardship board beside the civic one.

Also not written: the prohibitions check harness for the thirteen rules in `data/lore.json`, named
as the next job in `docs/CULTURAL-REVIEW.md` section D.

---

## 7. The five things that would most improve this next, in order

**1. Write the prohibitions harness.** It moved to the top of this list because the hand-run of one
rule during this pass found a live blocking violation in a shipped data pack. Most of the thirteen
rules are token scans over `src/`, `data/` and `docs/`. Extend the scope to `assets/**` and any
contribution pack while you are there, per `docs/CAPTURE-CONTRACT.md`.

**2. Bring the tick under 4 ms and get an honest frame number.** 6.23 ms/tick with the hottest
systems already known. Draw calls have 720 of headroom, so this is CPU, not the renderer. An honest
frame measurement needs a compositing pane; if the environment will not give one, say so rather than
quote a throttled figure.

**3. Make the read models describe the day, not the instant.** Ferry, council, consultation and jobs
all have substantial machinery and all describe as zeros at 5:20am. Rolling 24-hour and 7-day
figures beside the instantaneous ones. Four systems that look dead to a critic and are not is a bad
trade for the work already in them.

**4. Feed the narrative director people it can cast.** 514 cast failures against 1,460 evaluations
over a sim-year, and 30 quiet days in the last 30. The writing that does land is the best prose in
the build. Find out which requirements the seeds cannot satisfy and either widen them or give the
population the attributes they are asking for.

**5. Close the last four sentiment channels honestly.** `ecology:burn` unplanned, `coast:storm-cut`,
`waste:kerbside-missed` and `water:boil-notice` never fired in a sim-year. Two of them are waiting on
`fire.js` and `coast.js`. The other two are worth checking: a year with not one missed bin and not
one boil-water notice may be right, or may be another counter that does not bind.
