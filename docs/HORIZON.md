# The horizon, and what today's decisions do to it

Written 14 August 2026, from the owner's statement of where this ends up:

> every asset real and functional like a AAA game. A real digital twin, only de-personalised where
> appropriate. Eventually people are going to live in the virtual and the real at the same time.

He added that this is beyond the compute and data available now, and that is true. This document is not
a plan for it. It is a list of the decisions being made **this month** that either keep that road open
or quietly close it, because most of them are cheap now and expensive to reverse.

## What holds all the way

These are already right for the end state and should not be traded away for short-term wins.

**Identity before fidelity.** Every real thing gets a stable identity that survives being re-captured
at higher fidelity. The zero point ray address in `aura-scan-pipeline/docs/ZERO-POINT-CAPTURE.md` does
this: a cell keeps its address while its detail accumulates. A twin that keyed assets by file path
would have to be rebuilt from scratch the first time somebody rescanned a building.

**Provenance on every record.** Source, date, confidence, and which register it sits in. At AAA
fidelity the risk is not that something looks wrong, it is that everything looks equally real and
nobody can tell a measured wall from a guessed one. The three registers are what make photoreal honest
rather than misleading, and they get more important as fidelity rises, not less.

**The consent boundary as structure.** `O` and `I` faces, `public_noticeboard.md` against `aura.md`,
the `PARTICIPATION.md` lanes. "De-personalised where appropriate" is only implementable if the twin
knows, per object, what is attached and who agreed to what. Bolting that on later is not possible: it
has to be in the data model from the first asset, and it is.

**Emergent LOD.** Fidelity accumulates from capture rather than being authored per asset. That is the
only version of "every asset real" that scales past a handful of hero buildings, because nobody is ever
going to hand-model an island.

**The gate.** A rule that is not a runnable check is not a rule. That lesson cost this project two
repeats of the same cultural failure. At the scale being described, with contributions arriving from
many people, automated screening is the only thing that keeps it honest.

## What has to break, and knowing which is the point

Named honestly so that nobody defends them past their usefulness.

**Offline and deterministic at runtime.** Correct today, and I had the reason wrong.

The first version of this section said offline-first was load-bearing because the island has bad
connectivity. The owner's correction, 14 August 2026: **do not assume bad connectivity is a constant.
It is now and it will not be forever.** He is aiming at a B200 or B300 class NVLink 72 GPU rack at
9 Ballow Road for the Ready S.E.T. Co-op, and observes that even if that particular rack never
materialises, the compute arriving in the six years before the Olympics will be extraordinary.

That inverts the design. Offline is not a floor imposed by poverty of infrastructure. It is **one rung
on a ladder the twin walks down gracefully**, and the base case is heading the other way:

| Rung | Conditions | What the twin is |
| --- | --- | --- |
| **Full** | bandwidth and local compute | streamed high fidelity, many people in it at once, real time |
| **Reduced** | ordinary connection | local cache with deltas, full simulation, one person |
| **Static** | almost nothing | the map, placeholders, the last known state, honestly dated |
| **Ping** | everything else is down | **LoRaWAN**, light pings, disaster mode |

The last rung is the one worth designing for now, because it is the one that has to work on the worst
day rather than the best. LoRaWAN carries a few dozen bytes at a time over tens of kilometres on a
battery that lasts years, and it keeps working when the cellular network and the power are both gone.
That is the exact shape of an island in a cyclone, and
`RCC_20241216_local_disaster_management_plan__control_copy_.pdf` is already in the corpus describing
what the island does on that day.

What it means concretely: a payload budget measured in **bytes**, not kilobytes. Water level at Amity,
road open or closed, evacuation centre status, whether the barge ran. A twin that can render that on a
static map with everything else greyed and dated is more useful in a disaster than one that shows
nothing because it could not reach its assets. Design the byte format now, while it is cheap, because
retrofitting a disaster mode onto a streaming architecture is how disaster modes end up untested.

So the thing that must never regress is not "offline" as an ideology. It is **the twin's ability to
say what it knows, at whatever rung it is on, with the date on it.** That property is already in the
build: it is the freshness and source-rung work in `src/world/observations.js`, arrived at for the
weather ladder and general enough to carry the whole degradation ladder.

**Single-player identity.** Bundled into the determinism point below in the first draft, and it
deserves its own line, because the owner has already named the mechanism: **DIDs and verifiable
credentials**, per `Web3_Sensorium_for_Science_Debate.md`, carrying massively multiplayer eventually.

That is a better answer than an account system and it is the same boundary this project keeps arriving
at from different directions: the `O` and `I` faces on the torus, `public_noticeboard.md` against
`aura.md`, and the visibility levels in `PARTICIPATION.md`. A verifiable credential is how an islander
proves they are an islander without handing over who they are, which is exactly what
"de-personalised where appropriate" requires when the twin has many people in it. Four expressions of
one idea now, which is usually a sign the idea is right.

**Single-seed determinism.** Two people living in the same virtual island at the same time is shared
state, and shared state is not reproducible from a seed. The likely shape is a deterministic simulation
core plus an observed layer that carries what other people did. Worth saying: determinism has earned
its place, it is how every claim in this build got checked. It should be given up deliberately and
partially, not eroded by accident.

**Invented residents.** Today every person is generated and disclosed as generated, which is right
while the twin knows nothing. The end state has real homes with real people, and that is a completely
different consent problem, not a bigger version of the same one. Nothing about the current approach
prepares for it except the boundary work above.

**The browser.** Babylon in a tab is the right choice for reach today and the wrong one at the top of
the ladder. That is already the owner's own trajectory: browser, then Tauri, then Mojo, then bare metal,
then Straddie silicon. This repository is rung one and should stay excellent at being rung one.

## The honest distance

Worth being specific rather than gesturing, because the gap is the interesting part.

- **Assets.** Today: 1,922 procedural buildings, zero captured. There are about 1,059 real footprints
  available and perhaps 5,000 objects on the island worth modelling. At half an hour a scan that is
  years of one person's evenings, which is why the contribution lane matters more than any renderer.
- **Compute.** Today: 43 draw calls, 713,000 triangles, and a 1,160 ms worst frame that has survived
  several waves. AAA fidelity on this island is a few hundred million triangles streamed. That is two
  orders of magnitude, and the honest first step is not more geometry, it is finding the hitch.
- **Data.** Today: 12 packs, roughly 1,400 records, one weather feed. A twin people live inside needs
  live sensing at a density nobody on the island currently has. The source ladder in `CONNECTORS.md`
  is built for that and is currently running on rung three of four.
- **The thing nobody can buy.** Consent, and a community that wants this. That is the real constraint
  and it is not a compute problem. It is also the one this project is furthest along on, because the
  cultural review queue and the participation lanes exist before the technology does, which is the
  right way round and is unusual.

## What this means for the next decision

When a choice comes up, ask which list it lands on. If it is on the first, protect it even when it
costs something. If it is on the second, take the short-term win and write down that it is temporary,
so nobody two years from now mistakes a scaffold for a foundation.

The failure mode to avoid is not being too ambitious. It is building the demo of the end state on top
of the parts that were only ever meant to hold up the beginning of it.
