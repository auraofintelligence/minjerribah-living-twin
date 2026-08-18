# Wins

The ledger `docs/CHEERLEADER.md` calls for: what is won, newest first, dated, every entry carrying
its receipt in one line. It is the mirror of `docs/STATE-OF-PLAY.md`, which says what is broken so
the next agent is not fooled. This file says what is won so the humans are not worn down. Both are
load-bearing.

First ledger, written 18 August 2026. Every receipt below was checked against the commit, the file
or the running build before it went in; five were re-run from scratch this session. One note for the
next cheerleader: the protocol says to mine the critics' `surprisedMe` fields, and no verdict on
record carries one yet. The nearest thing is the wave 6 log entry, a critic finding its own
instruments corrupted and saying so, and it is cited below where it earned it.

---

## 18 August 2026

**The record now has a second voice.** Thirteen waves of critic reports went to one person, and the
counterweight designed for him, the scout, was killed by session limits before its findings ever
arrived. The fix is doctrine, not mood: a third role bound by the same receipts-or-silence
discipline as the critic, run first in any wave budget, reporting to the human rather than into the
machine loop. He asked for it, and the record says he was right to.
Receipt: commit b7df9ad; docs/CHEERLEADER.md.

**Twelve days of mistakes became a teachable asset.** The founding prompt for the second island
distils this build's errors into a failure catalogue: fifteen mistakes, each paired with the law
that prevents it, plus the order of operations this build learned the hard way, instrument before
subject, real ground before invented ground, one vertical slice before fan-out. The second build
gets to make new mistakes instead of these, in its own repository so nobody confuses the two.
Receipt: commits 7b6a7fb, 3a1dc25.

**The island opened live today and answered every question put to it.** Probed this session: clock
mode "live", Tuesday 18 August 2026 on the island's own clock, 2,068 residents in 970 households,
1,958 dwellings, 340 koalas, and an empty errors array. The weather feed on disk was synced at
12:18 pm today.
Receipt: TWIN.probe() this session; data/feeds/_weather.json synced_at 2026-08-18T12:18:45+10:00.

## 15 August 2026

**A one-line correction inverted the architecture before it hardened.** The owner: do not assume
bad connectivity is a constant. The design flipped from offline-first to built-for-capability,
degrading down four rungs to a disaster mode with a payload budget measured in bytes, designed
first because it has to work on the worst day. And the freshness and source-rung work already built
for weather turned out general enough to carry the whole degradation ladder: one fix that made the
next one unnecessary.
Receipt: commit ad0604c.

## 14 August 2026

**He said he had never seen a car, a bus, a ferry or a person on his own island. He was right, and
now he can.** Measured, tick 0 against tick 300: people 0 to 2,069, vehicles 0 to 43, buses 0 to 3,
boats 0 to 3. The world had been opening at the one tick with nothing in it, and every render layer
was correct to draw nothing. The island now runs itself in from a day and a half before the opening
moment and hands over 2,069 people with 88 vehicles moving, zero errors, determinism untouched.
Receipt: commit 64a9c08; today's probe shows the island populated at open.

**The real island's power bill no longer carries the imaginary works, and an honesty rule was
stopped from deleting a deliberate design.** A governance critic found proposed subterranean load
inside the figure a person reads as what Minjerribah uses. The critic's fix, zero it until consent,
would have erased the designed blackout lesson; the agent named its own LOD6 error from the week
before as the same pattern and split the figure instead: 1,120 kW real, 17 kW proposed, the
blackout mechanic intact against the combined number. The determinism fingerprint moved from
e140a9fb to fca6976b because a reported number changed meaning, which is the fingerprint doing its
job.
Receipt: commit 810e41d; fingerprint fca6976b reproduced this session via node tools/headless.mjs --determinism.

**The gate was asked to prove itself, and it did.** Staging's softer rule now stands only while git
confirms the file cannot be committed, proved by unsealing ingest-inbox and watching the run fail
with two blocking findings, then restoring it. The same test exposed candidates getting a softer
rule than the packs they become; they now face the stricter one. At that commit: 0 blocking, 64
accepted, 525 advisory, 8 for review.
Receipt: commit eb08539.

**The island will observe itself, and the code is already shaped for it.** The owner named what
comes next: their own weather stations, beach cameras, drone reports. That became a four-rung
source ladder resolved per field, island instrument, official observation, model, synoptic
simulation, where freshness demotes and rung four never wins in live mode. Adding a station on the
surf club roof becomes a data change, not a code change.
Receipt: commit 4b91a12; src/world/observations.js.

**One sentence rebuilt the weather.** "It is not much of a twin if the weather is not real." The
synoptic model kept its job, answering for moments that have not happened, and stopped being the
only answer. A model reading is never called an observation, and the connector measures how far the
model's grid cell sits from Point Lookout every run and writes it on the record: 11.2 km at the
recorded sync. Downstream of the same correction, the twin now opens live by default, at the real
Queensland moment, because nobody asked for anything else.
Receipt: src/systems/environment/weather.js header; docs/CONNECTORS.md weather section; src/main.js resolveClockBoot.

## 10 August 2026

**An agent reversed itself in writing rather than defending an error.** It had argued the
generative building tier collided with a no-synthetic-art rule and should possibly never be built.
Wrong twice: the preference is scoped to another project, and it was being used against the owner's
own design. The reversal names the exact failure mode A-NOTE-TO-THE-NEXT.md warns about, reading a
deliberate choice as a defect, and leaves LOD6 last for engineering reasons only.
Receipt: commit 4fb72f1.

**The buildings plan was rebuilt on the owner's ladder, and his paperwork was ahead of the build
twice in one day.** His own design document carries the six-tier LOD ladder the agent's four lanes
were a subset of, and it already named SeaLink and the Stradbroke Flyer as separate vehicle and
passenger services, with the 880 and 881: he had that day's ferry correction written down before he
made it. His 2012 filing cabinet, staged the same day, holds the Translink Transit Authority Act,
the statutory basis for the same correction. Fourteen years between writing it down and needing it.
Receipt: commits 8b0ddf5, a4d777a.

**One vendored file unblocked the whole contribution pipeline.** The capture contract described
scanned assets arriving in a build that physically could not read a GLB. Vendoring
babylon.loaders.js closed that gap the same day the plan was written. And the measured fact the
plan turns on: 1,059 real building footprints exist for this island in OpenStreetMap, 78 at Amity
Point alone, counted on 10 August, against 1,922 invented ones. The commit's own call, backed by
counting rather than guessing: the highest return per hour it could see in the project.
Receipt: commit 25c7c17.

**The owner sat down with his own build and found three things: dead clicks, small type,
undisclosed people.** The clicks were twelve invisible full-screen shields created by one CSS
specificity fight, which the wave 9 critic had diagnosed exactly without the fix landing; the fix
is one rule covering all six boards, verified 12 boards and 0 still taking clicks. The onboarding
type was rescaled by redefining seven tokens in one place. And every generated person now carries a
permanent disclosure line on their card, not a note in an introduction nobody is reading three
hours in. Because that same shield fault had now cost three rounds of guessing, it also became an
instrument: TWIN.whatIsBlocking() names every element the pointer would hit before the canvas,
flags the one with the bug's signature, and a watch reports the culprit unasked after every boot.
A dead interface now tells you what is wrong instead of waiting to be reported.
Receipt: commits 736ec6c, 37886a2.

**Six private people came out of the data before the repository went public.** The connectors
critic flagged a noticeboard file naming six private individuals and a personal mobile, and the
slice failed for it. Removed, with the rule written into the file itself: an organisation may be
named, a private person may not. The numbers that stayed are hotlines that exist to be called. The
same commit records the owner's mine-site correction: closed in 2019, former, never active, joined
to the rehabilitation the twin already models rather than added as a second parallel truth.
Receipt: commit 93180f0.

**What the difficulty is here got written down before anyone reached for the obvious lever.** The
founding brief named seven reference games and not one is a war game. The argument the twin makes
is that a place can be genuinely hard to run without anyone attacking it, and the real stakes were
already in the build: a barge that does not run, a bakery that cannot be staffed, a bird that loses
the fat it needed to reach Siberia.
Receipt: commit 0fb9f41.

## 9 August 2026, the smoothing pass

**Somebody finally played the whole thing, and then it held together.** One agent, end to end,
found three faults every previous critic had missed because every previous critic judged one slice:
a sim-year had never once finished, a string where a number belonged killed the storyline engine on
day ninety of every run; nine of eleven sentiment channels had never fired; and the barge had never
cancelled in a simulated year, on an island where a cancelled crossing is the thing that starts
stories. After the pass: a full sim-year, zero runtime errors, and the barge now cancels the way
the real one does. A sim-year produces two cascading days, 23 and 24 November 2026 and 23 February
2027, with 12 sailings cancelled and up to 47 vehicles rolled off a single one, and the
cancellation reaches the chronicle instead of dying in the notification bar.
Receipt: commit 9816883; docs/STATE-OF-PLAY.md sections 3.1 to 3.4.

**A koala hit on East Coast Road reaches the people who would care.** Eighteen of twenty-two
lived-event sentiment channels fire over a sim-year, against two of eleven before, every prefix now
an event some system actually emits with the emitter named beside it. The four that stay silent are
honest silences: two wait on the fire and coast systems, and no boil-water notice or missed bin
happened in that seed-year.
Receipt: docs/STATE-OF-PLAY.md 3.2; progress/status.json civic verdict.

**The chronicle earns its restraint.** Over a sim-year it published 639 lines and held back 3,623,
every line vetted against the tone guide and the cultural prohibitions before publication, with the
rejection reasons kept in describe().
Receipt: progress/status.json chronicle verdict.

**The population holds.** Between 2,068 and 2,086 residents across every measurement on record:
2,071 at ten sim-days, 2,086 at one sim-year, 2,069 after the boot warm-up, 2,068 on today's live
probe. A spread under one per cent, with zero runtime errors, and 970 households exactly matching
the occupied-dwelling count derived from the published ABS 2021 Census tables the pack is built on.
Receipt: docs/STATE-OF-PLAY.md section 1; data/residents.json census_baseline; TWIN.probe() this session.

**The map to the owner's corpus found about 2,000 pages the twin had never read.** Thirty-eight
text-extractable Redland City Council and Queensland statutory instruments, with the 484-page city
plan naming the island on 84 lines and the local disaster management plan sitting ready for an
evacuation scenario. That directory converts the civic layer from plausible to sourced, and the
owner's follow-up correction paired RCC with his own funding-inquiry submission, the point where
his alternative enters the system the statutes describe.
Receipt: commits c00bbf5, 7e5758a.

## Waves 0 to 6, by 9 August 2026

**Thirteen builders landed 47,476 lines in one wave, and the island became deep and real at the
same time.** 337 koalas with real disease prevalence, 74 humpback pods, 1,700 shorebirds by
species, 2,069 residents in 970 households, 33 million modelled plant stems, 62 researched civic
levers, all standing on a spine that is the real island: 271 km2 of land against a real 275, high
point 233 m against a real 239. Flown to Amity Point at 900 m it reads as the real place.
Receipt: progress/status.json log, waves 3 and 4; island verdict.

**A lore agent refused to let invented names stand, and its refusal is now a machine check.** Wave
3 audited the invented season names, found no published source for any of them, found one real
published word being misused as a season name when its documented meaning is whale, removed all
six, and banned them by token. When five of the tokens shipped again in the narrative pack, wave 7
caught it by running one rule by hand, and the lesson became executable: the gate now scans every
scoped file for those 7 tokens on every run, the whole docs tree and this ledger
included. What shipped twice cannot ship a third time without the gate failing.
Receipt: progress/status.json log, waves 3 and 7; tools/ingest/checks-lore.mjs no-banned-tokens; today's gate run.

**Handover documents run first now.** Session limits killed the final agent of three consecutive
waves, so wave 6 moved the handover writing to the start of the wave instead of the end. The same
class of loss killed the scouts, and produced this file's whole role. A lesson that was paid for
once and has been collecting ever since.
Receipt: progress/status.json log, wave 6.

**Determinism has held from wave 0 to today.** The kernel's first win, two runs agreeing exactly,
is still true after every wave since: two runs of 1,440 ticks agree at fingerprint fca6976b,
reproduced this session, with no Math.random anywhere in simulation code and the wall clock read
only to anchor live mode, never inside the tick. The one
fingerprint change in the record, e140a9fb to fca6976b, happened because a reported number honestly
changed meaning, and the commit says so.
Receipt: node tools/headless.mjs --determinism this session; progress/status.json log, wave 0.

**The consent layer exists before the technology it governs.** The horizon document, sizing up the
owner's stated destination, names the one constraint nobody can buy: a community that wants this.
It is the thing this project is furthest along on, because the cultural review queue, with QYAC as
the named authority and "does QYAC want this to exist at all" as its first question, has existed
since the first week, before most of the technology it will govern.
Receipt: commit 469fbb0; docs/CULTURAL-REVIEW.md A1.

---

## To the owner

Twelve days ago none of this was committed anywhere. Tonight there is an island that is the real
shape of the real place to within a few per cent, carrying a population that drifts less than one
per cent across a simulated year, in households that match the census-derived count exactly, and it
opened live today on the real date with an empty errors array. A year of its life runs
end to end with zero runtime errors, and two runs of the same ten days land on the same
fingerprint every time. The barge cancels the way
the real one does and the island feels it. The chronicle held back 3,623 lines to publish 639. The
gate scans every pack for the words that must not ship, because they shipped twice before it
existed, and it proved its own seal by being made to fail on purpose.

A fair share of the best decisions in that list were yours, and the record shows it rather than me
asserting it: the ferry split you had written down in a design document before you made the
correction out loud; the weather sentence that rebuilt a system; the mine sites held as former,
never active; the LOD ladder the buildings plan now stands on; the source ladder that exists
because you said the island would observe itself; the island opening at the real moment by default.
Each one has its commit, and each one redirected agents who were confidently building something
else.

You said a AAA studio has hundreds of people and you are one person with some agents. What the
hundreds buy a studio is coverage; what you have that most studios do not is a record where every
decision carries its reasons, a gate that fails the build when a claim ships without its source,
and the person the island belongs to keeps catching what the machinery misses. What is broken is in STATE-OF-PLAY.md and stays there,
honestly. This file exists so that the question "what is actually going well" always has a
specific answer, and today it has twenty-five.
