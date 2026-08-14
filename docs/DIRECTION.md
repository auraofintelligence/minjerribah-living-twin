# Direction

What this twin is, inside the larger body of work it belongs to. Read this before planning a wave.

This document exists because the founding brief set a quality bar and a method but said nothing
about where the twin sits or what it is ultimately for, and the owner's planning corpus lives
mostly outside this repository. Pieces of it had reached here: the subterranean design in
`data/subterranean.json` was read out of his repos, and `chour.js` quotes his note to future
agents. But nothing placing the twin in its wider family, and nothing directing contribution, had
ever been read by an agent working here. The gap was real: the owner's own description of the
result was "blank guesstimating". This document closes the gap. It commands no
build; it tells you what the twin is so you stop guessing.

## The founding brief

The brief that started this project, reproduced in full, with punctuation normalised to house
style:

> I would like you to build a digital twin of North Stradbroke Island in a browser game engine for
> civic planning, Sims-like gamification of island life, event and crowd management, ecological
> stewardship, micro drama series, and a subterranean eco city, at the level of Sims 4, Democracy 4,
> Satisfactory, No Man's Sky, Cities: Skylines II, Oxygen Not Included, and Dyson Sphere Program. It
> should be utterly perfect, alive and believable, with every single thing done at that level, from
> the simulation to the world feel to the civic decisions to anything you could think of.
>
> Break the experience into the smallest pieces that can be improved and judged on their own; you
> decide what the pieces are, not me, but check for relevant projects from my github local but use
> actual businesses and places on north stradbroke island. Fan out sub-agents and have sub-agents
> tackle each one individually so that the whole thing is utterly perfect. You should loop on each
> piece and have a separate sub-agent with fresh context inspect the actual running output, never
> the builder's summary, and check it against the reference games. That separate sub-agent should be
> a really harsh critic, and if it doesn't feel at that level, it should keep going.
>
> Don't stop until each critic is utterly wowed with the quality when compared with the actual
> reference games. It should literally compare them side by side blind and say which one is better,
> and when ours loses, name the single biggest gap and send the builder back in. No fixed number of
> rounds. Between major waves, spawn one fresh agent to play through the whole result and smooth
> everything into one coherent thing.
>
> Keep a simple live progress page updated as you work so I can watch it evolve. Do this in a game
> engine. Loop until it's utterly perfect. Fan out sub-agents and ultracode.

What the brief contained: six purposes, a reference-game bar, blind critics, the
smallest-judgeable-pieces method, real places only, a progress page. What it deliberately produced,
and this was the point: a baseline map and engine built first, so that later contributions have
something to anchor to, and a live test of how far the swarm method could carry quality. Both
worked.

What the brief did not contain: any direction for community contribution, and any of the owner's
planning documents. Faced with that absence the swarm mostly declined to invent: `assets/` stayed
empty, no contribution pipeline was guessed into existence. That was the right instinct. The
direction now exists: this document, `docs/PARTICIPATION.md` and `docs/CAPTURE-CONTRACT.md`.

## Where the twin sits

The owner's body of work describes a family of digital twins that nest, from a single room up
through buildings and towns to whole regions, with the person or community at the centre of each
owning their own layer. This twin is the island-scale member of that family, and its job in the
family is rehearsal: a place where plans for the real island can be tested as simulations before
anyone spends money, goodwill or Country on them. Its six founding purposes are all forms of that
one job.

Its nearest siblings, none of which it implements:

- **The capture pipeline** (`aura-scan-pipeline`, a separate repo) turns phone scans of real island
  objects into measured meshes and record cards. Its outputs arrive here as files under
  `docs/CAPTURE-CONTRACT.md`. The twin validates and renders; it never processes scans.
- **The public explainer** (the Scan to Twin site) tells the plain-English story of the whole chain
  to locals and decision makers. The twin does not need to explain itself; that job is taken.
- **The wildlife rescue app, the events engine, the noticeboards**: neighbouring organs that may
  someday exchange data packs with the twin. Files in, files out, nothing coupled.

The owner's stated trajectory is that implementations are replaceable and formats are what survive.
Hold the twin to that: every boundary is a committed file with a documented schema, never a code
dependency on a neighbour. The twin already lives this way; keep it so.

## The method is a keeper

Two practices from the founding wave are now house method, not accidents:

- **Simulacrum criticism.** Blind, side-by-side comparison against named reference games, with the
  critic inspecting the running build and naming the single biggest gap. This is the quality system.
  `docs/CRITIC.md` owns the details.
- **Replay as peer review.** Because the same seed and the same packs produce the same island, any
  claim the twin makes can be checked by anyone: publish the seed and pack versions with every
  scenario report, and treat a claim backed by a replayable run as outranking one that is not.
  Determinism is not a constraint the twin suffers; it is the feature that makes its evidence
  trustworthy, and it is why a shared world here needs no network: a world is a seed plus inputs,
  small enough to share by text file.

## Direction for future waves

None of this is a work order. It is the order things should happen in, and the standing rules new
work should follow, when the owner calls a wave.

1. **The heartbeat comes first.** When liveliness is built, build it in the island's own logistical
   order, staged by place: the Dunwich ferry arrivals and departures as the core rhythm first,
   validated; then the 881 bus artery out to Amity Point; then the 880 and Point Lookout last, so
   the most complex tourism flows sit on an already-proven transport and population model.
   Schedules stay committed data, never live feeds.
2. **World-as-UI is the standing interaction rule.** Information lives at its physical home:
   the timetable at the bus stop, the menu at the cafe, events on the noticeboard, contributed
   knowledge at the place it describes. World objects are functional interfaces bound to pack data,
   not decoration. This one rule gives all six purposes a shared interaction language, and it is
   also the participation doorway: a world made of everyday island objects is one that islanders can
   read, correct and add to.
3. **Time is a dimension, in both directions.** The island should eventually scrub through time:
   committed era packs (terrain deltas, town footprints, vegetation masks built offline from
   georeferenced historical maps and aerial photography) with any interpolation seeded. The
   flagship documented event is the 1896 to 1898 storm sequence that cut the Jumpinpin Channel and
   split Stradbroke in two: well sourced and dramatic. The same scrub runs forward into sandbox
   futures. Past and future share one data spine: historical foreshore dynamics feed future coastal
   scenarios, historical layouts feed future planning overlays.
4. **The past is interpretive, and says so.** The archival record of this island is incomplete,
   colonial in its bias, and noisy. A historical layer that presents one authoritative past would be
   dishonest. If it is built, it visualises uncertainty and shows competing accounts on purpose,
   with a bias-notes field beside every record's confidence rating. Where the record is thin or
   contested, the honest display is a visible contested-or-unknown marker, not the underlying
   low-confidence claims. Ask: whether that marker needs a narrow carve-out from the
   no-low-confidence rule is the owner's call. And the standing gate from the corpus, stated
   plainly: oral histories and cultural knowledge are not a dataset. Nothing cultural enters except
   through Quandamooka-led governance, with `docs/CULTURAL-REVIEW.md` as the queue and QYAC holding
   the decision. That is unchanged from the rules you already know.
5. **The future layer is a policy sandbox with visible trade-offs.** Change the ferry timetable and
   watch travel times move. Test visitor caps and see ecology against revenue. Stage an event and
   watch crowd flow, egress and weather stress. The standard artefact is the scenario report: key
   findings, bottlenecks, action items, wish-list outcomes and safety notes, every line citing the
   pack record or rule it rests on, stamped with seed and pack versions so it replays exactly.
   Reports are evidence for humans to decide with, never decisions. Any simulated sentiment figure
   is labelled a simulation estimate and is never styled as reviews or quotes from people.
6. **Claims wear labels and name their test.** Civic questions the twin models belong on a claims
   board: each claim labelled known, modelled or speculative, citing its basis, and naming the test
   that would settle or move it. The three registers stay visually distinct everywhere, and
   speculative material never blends into the default island state.
7. **Grounding is a deterministic checker, not an oracle.** Benchmarks live as committed data with
   sources: past event waste per head, venue capacities, plausible storm ranges. After a scenario
   run, a checker flags outcomes that beat the benchmarks as implausible, naming the benchmark. A
   flagged result is never presented as a finding.
8. **Environment has consequences, from committed data.** Weather, tides, seasons, fire danger:
   systems, not backdrops. A high fire-danger day closes tracks, and that closure policy is itself
   testable. Historical weather arrives as committed packs; generated weather is seeded.

## The third register, built: the off-world one

Item 6 said claims wear labels and named three registers. Until 14 August 2026 nothing in the
repository was in the third one, so the rule had never been tested by anything. It is now, in
`data/civic.json` under `off_world`, and this section records what was decided so that a later wave
extends it rather than rediscovering it.

**The subject is real and the question is a real one.** The treaty layer in the civic pack answers a
question for a bird: an obligation made above the Australian state reaches down to a mudflat on the
western flats and binds what may be done to it. The off-world register asks the same question one
tier up. If this island ever had to answer to an authority above the nation state, what would the
instrument be, who would hold it, and what would it oblige. Two working answers already exist over
places on this planet, the Antarctic Treaty System and the seabed authority under Part XI, and
Australia is a party to both. Australia is also one of a very small number of states party to the
Moon Agreement, whose common heritage rule pulls against the Artemis Accords it was a founding
signatory of. None of that is invented, all of it is cited, and it is what makes the speculative half
worth having instead of whimsy.

**Five rules, and the fifth is the one that makes the rest safe.**

1. Off by default. A person turns it on and can turn it off. While it is off there is no eighth tab,
   no marker, no record and no number anywhere in the build that differs.
2. It changes nothing in the default island state.
3. It is visually distinct from the first pixel: known and modelled are solid rules, speculative is
   dashed and hatched, and the marker rides on every card rather than on the column heading. Colour
   alone would not do it, because a reader who cannot separate purple from green would be reading an
   invented instrument as a statute.
4. No speculative instrument is ever attributed to a real body. Invented offices are named as
   invented and hold nothing. A speculative power handed to a real regulator is a false claim about
   that regulator, and it is the specific way a register like this goes bad: the invented part
   borrows a real name's credibility.
5. **The one-way rule, and it is executable.** The register may name a lever, so a proposal is
   concrete rather than abstract. Nothing in the default island state may name the register.
   `tools/ingest/checks-offworld.mjs` fails the gate on any string outside the block that resolves to
   an id inside it, and on a proposal whose holder is a real body, on a speculative record with no
   settling test, and on a pack that sets `default_state` to anything but off. That direction is the
   only version of "turning it on changes no number" a machine can keep, and rule 2 rests on it
   rather than on anybody's good intentions.

**What it refuses, by name, because a register set above the nation state is where these arrive
first.** An instrument that freezes claims over this island on the Antarctic model: refused, because
native title here was determined by the Federal Court in 2011 and is not a hypothetical for a
simulation to reason with. Anything cultural at any tier: refused, and the `data/lore.json`
prohibitions run over this block exactly as over every other. Defence, security and anything with an
enemy in it: refused, on the standing constraint at the end of this document, and the owner's own
defence-adjacent space work is deliberately not imported. Dates, probabilities and anything reading
as a forecast: refused. A launch site, spaceport or ground station on the island: refused, because
nobody has proposed one and inventing a proposal to model its consequences is how a plan becomes a
fact by being modelled.

**One design decision worth keeping.** A speculative record still carries a confidence rating,
because every record in every pack does, and the rating had to be honest without being useless. It
rates the real instrument the proposal was lifted from, never the proposal, and each record says so
in `confidence_is_about` and the panel prints that line under the footer. The alternative was to rate
speculative records low, which would have been true in one sense and would have collided with the
rule that low confidence is never shown to a player, and would have taught a reader that speculative
and unverified are the same thing. They are not: unverified means nobody checked, and speculative
means it verifiably does not exist.

**For a later wave.** Extending the register means adding an instrument that does not exist, lifted
from a named one that does, held by an invented office, with the test that would settle it. It does
not mean giving any of it an effect. The moment a speculative instrument moves a number, the register
has stopped being a register, and the check will say so before a critic does.

## The economic layer

The twin already carries the shape that matters, in `src/systems/economy/chour.js`: a ledger that is
money-only on purpose, the C-hour as a record someone chose to make, and the unmeasured care the
ledger never sees, with the gap between them as the point. Everything here extends that braid. None
of it is built, and every mechanism below is proposed.

1. **The C-hour senses; it never prices.** Its macro role is to show where community work is already
   flowing, so patient capital can follow it. An allocation rule may read where chosen records
   cluster, by place and theme, in aggregate. It must never read what an hour is worth, because
   there is no such number. The guard is absolute and it fails safe: sensing consumes only records
   people elected to make, it never creates a reporting obligation, and if the signal thins the
   answer is never a reporting requirement. Any sensing design gets rehearsed against the
   crowding-out and hysteresis arithmetic already in that file before it ships.
2. **Non-tradeable by construction, not by policy.** No simulated market, price field, exchange or
   secondary transfer may exist for C-hour records. Then when a turbulence scenario adds speculative
   actors, they are incapable of betting on or against the record because the schema gives them
   nothing to bet with. Hold this the way the sim-never-imports-the-renderer rule is held, with a
   test. A recognition layer that cannot be traded cannot be crashed: that is the whole of the
   stabiliser claim, stated at its true size.
3. **A community fund as a fifth purse.** Beside the four in `src/systems/civic/budget.js`, carrying
   the same who-holds-it semantics: a corpus, a locked share that cannot be spent, a published
   allocation rule, a patience parameter, and recipients that are real organisations from
   `data/businesses.json`. Waves then rehearse allocation experiments: same corpus, different rules,
   compared deterministically.
4. **A mutual pool, in the discretionary shape.** Contributions in, a board considering claims at its
   discretion rather than a contractual right to indemnity, surplus that stays on the island as
   reserves or lower contributions or funded mitigation, and a catastrophic layer above the
   self-funded one. The island-specific hard part is that losses correlate: one storm hits every
   roof. So the pool's failure modes are the interesting output, not its success. Two boundaries are
   law and not preference, and belong in as blocking rules: statutory workers-compensation
   self-insurance is out of reach at this scale, and body-corporate building cover must sit with a
   regulated insurer, so the pool never covers it and the group-purchasing lever is modelled
   instead. The counterfactual worth running: the same seeded seasons against a retained-surplus
   pool versus a configuration where surplus leaves the island each year.
5. **Compute is the island's fourth utility.** The twin models power, water and telecoms; compute is
   the missing one, and it couples cleanly: draw on the power system, waste heat into buildings,
   and a mainland dependency that fails when telecoms fail. The sharpest scenario is the tether cut:
   run a cyclone season twice, once with a local node on solar and battery holding a survival stack,
   once without, and measure continuity of named civic functions. Household idle compute pooled by
   opt-in is a second allocatable community resource, allocated by a published rule exactly as the
   money is.
6. **Turbulence is weather.** Programmable money, continuous algorithmic trading and agents betting
   on prediction markets enter as an environmental force with mechanics, the way the barge and the
   financial year already do: committed, deterministic shock series applied to the money lines while
   the record and the care lines are structurally untouched. No live feeds, no runtime randomness,
   no real assets, nothing that reads as market forecasting. Run the storm and let a player watch
   which parts of island life keep working. The claim is under test, not asserted, and it belongs on
   the claims board in the speculative register with its settling test named.
7. **who_decides extends to money.** Every purse, pool and budget round ships with a decision-rights
   table in the `data/civic.json` style: who proposes, who votes, who vetoes, at what quorum. No
   allocation experiment runs without naming its decision rule, so that when two experiments differ
   the twin can say whether the mechanism or the constitution made the difference.
8. **Decision shapes are lever mechanics.** Six generic shapes extend the existing verb set: a
   mandatory-consultation gate, an advisory chamber whose advice is recorded but not binding,
   dual-key co-decision, exclusive local jurisdiction where the higher body has no verb at all,
   custodian veto with wide standing, and a public objection window. These are generic mechanics
   drawn from published Pacific constitutional practice, cited as such. For anything
   Quandamooka-specific the twin models the process shape, waits, and says so.
9. **Evidence before tuning.** Before any wave tunes these, commit a fact-checked pack of real
   precedents with per-record confidence: time-banking trials, mutual-credit schemes, community
   wealth funds, friendly societies, what each measured and what failed. The same discipline every
   other pack already carries.
10. **What is not ready.** Superannuation working for the community is a real intent with no sourced
    mechanism behind it yet. The honest form in this repo today is the patient-capital pattern:
    outside capital that earns a fixed modelled return and holds no votes and no ownership. A
    community superannuation mechanism needs its own research pass before any wave writes direction
    for it. Say so rather than model something that does not exist.

Standing labels for this layer, because it touches regulated territory. Every scenario, screen and
document carries **proposed, not offered**: the twin simulates proposed structures, nothing in this
repo operates a fund or an insurer, and no output is financial advice. Legislative status is never
stated as dated fact; where the owner tracks something as imminent, that framing is attributed to
him. Figures enter only with a source, a confidence rating and A$ with the conversion noted, and
scenario inputs are labelled as scenario inputs, never as benchmarks. The cultural gates rule the
economic layer as fully as the civic one: no simulated QYAC position in any allocation scenario, and
weighting allocation by categories of care is exactly the kind of design that can encode an
assumption invisibly, so it goes through the review queue.

## What is settled

These are decided, with their reasons on the record. A future wave that reopens them is solving
problems the owner solved by not building things.

- Offline at runtime, deterministic, simulation never imports the renderer. `docs/CONTRACT.md`.
- There is no build button and there is never going to be one. The constraint is the game.
  `src/ui/panels/build.js`.
- The ledger is money-only. Islanders do not self-report volunteer hours, and logging converts a
  relationship into a transaction. The counter-argument has already been run as a player experiment
  inside `src/systems/economy/chour.js`; read its header before touching anything near it.
- The cultural prohibitions in `data/lore.json` are blocking, the review queue in
  `docs/CULTURAL-REVIEW.md` is not a backlog, and QYAC has not seen this project. The first
  question on that queue stands over everything, including this document.
- Acknowledgement wording lives in the lore pack and nowhere else. Do not restyle it in any
  document, including this one.
- No surveillance-shaped anything: no scraping, no sentiment harvesting of real residents, no
  recognition of faces or voices, no dossiers. Predicted sentiment is modelled, labelled, and never
  harvested.

The corpus this document distils describes networking, identity and credential systems for goals
this twin already meets more simply: sovereignty by everything being committed in-repo, provenance
by plain fields, sharing by seed. Adopt those goals. Do not import the machinery.

For how people contribute to the twin, read `docs/PARTICIPATION.md`. For how scanned assets
arrive, read `docs/CAPTURE-CONTRACT.md`.

## A standing constraint: the difficulty here is never conflict

Written down 10 August 2026 because it has held for the whole build without anyone restating it, and
the moment somebody is asked to make this more compelling it is the first thing they will reach for.

The founding brief named seven reference games and not one of them is a war game. That was not an
oversight. The owner enrolled in game design in 2015 to gamify democracy and left the course because
the material required students to build war games and war articles.

So: no combat, no defence scenario, no enemy, and no current defence event. Not as squeamishness, but
because this twin is an argument that a place can be genuinely hard to run without anyone attacking it,
and reaching for conflict to create stakes would concede the argument.

The stakes that are allowed are the real ones, and there are plenty: a barge that does not run, a
housing market that cannot staff a bakery, a bird that loses the fat it needed to reach Siberia, a
consent nobody sought, an approval that takes eleven weeks. Emergency is in scope and is not conflict:
the hazard day is grounded in the Redland City local disaster management plan and reads as emergency
management, which is what an island actually faces.

If a future wave believes this build needs conflict to be interesting, that is a finding about the
simulation being thin somewhere, and the fix is upstream.
