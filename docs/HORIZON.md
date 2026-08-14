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

**Offline and deterministic at runtime.** This is correct today and it is load-bearing for a low-tech
island community with bad connectivity. It cannot survive AAA asset fidelity: you cannot ship the
island. The resolution is almost certainly tiers rather than abandonment. A small complete offline core
that works on a phone at Amity with no signal, and a high fidelity layer that streams when there is
bandwidth. Both true at once, and the offline core is the one that must never regress, because it is
the one that serves the people who actually live there.

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
