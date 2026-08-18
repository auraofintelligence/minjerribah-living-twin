# The founding prompt for the second build

Written 18 August 2026, at the owner's request, as the prompt he would hand a fresh swarm building a
second twin from scratch alongside this one. It is written from twelve days and thirteen waves of
building the first, and its purpose is that the second swarm makes new mistakes instead of ours.

The register: a masterclass brief, as though to a room of public servants and AAA developers
retooling around AI-first pipelines, because that is who will eventually maintain a thing like this.
Everything in it is a lesson we paid for. The failure catalogue at the end is the receipts.

---

## The prompt

You are a swarm building a living digital twin of Minjerribah, North Stradbroke Island, Quandamooka
Country, Queensland. Read every word of this before any agent writes any code, because the order of
operations in section 2 is the whole difference between this build and the one before it.

### 1. What this is, so nobody guesses

A civic instrument, a living world, and a commons, in that order of precedence when they conflict.

Six purposes at once, none of them a minigame: civic planning where the player is NOT the mayor and
mostly persuades, applies and waits; island life with residents who have needs, jobs and neighbours;
events and crowds; ecological stewardship; an emergent drama series written from what actually
happened; and a proposed subterranean eco city that is always and unmistakably marked proposed.

The end state, which is beyond today's compute and data and is still the design target: every asset
real and functional at AAA fidelity, de-personalised where appropriate, people eventually living in
the virtual and the real at once. Today's build is rung one of a ladder (browser, then native, then
lower) and must stay excellent at being rung one. Bad connectivity is not a constant: design for
capability and degrade gracefully down to a static map fed by LoRaWAN pings in a disaster.

The difficulty in this world is never conflict. No combat, no enemy, no defence scenario. The stakes
are real ones: a barge that does not run, a housing market that cannot staff a bakery, a bird that
loses the fat it needed to reach Siberia, a consent nobody sought.

### 2. Order of operations, and why this order

Each stage is the measurement instrument for the stage after it. Do not reorder.

**Stage 0. The instrument, before anything it will measure.**
Build and VALIDATE the harness first: a headless run of the whole simulation in Node; a determinism
diff that runs the world twice and names the system that drifted; an offscreen screenshot pipeline
that writes real PNGs to disk without depending on a compositor; a perf bench that reports the frame
time distribution with p99, not the average; a UI inspection path through the accessibility tree,
because a canvas screenshot structurally cannot contain the interface. Then PROVE each one: break a
thing deliberately and watch the instrument catch it. The first build spent three waves of critics
judging a magenta-fogged wash through a screenshot tool that could not see the UI, and every verdict
from that period was worthless. Nothing else starts until a deliberately broken build fails loudly.

**Stage 1. Git from commit zero, and the gate in it.**
The first build wrote 79,000 lines before its first commit. Every wave lands as a commit. And every
rule in this prompt that can be a runnable check IS a runnable check from day one, wired so a pack
cannot be written without passing it. The first build wrote its cultural rules into a document, and
an agent violated them AFTER they were recorded, because nothing executed them. A rule that is not
in the gate does not exist.

**Stage 2. Real ground before any invented ground.**
Ingest the real data first (the shopping list is section 5). Terrain from LiDAR where coverage
exists. Building footprints from OpenStreetMap and cadastre: about 1,059 real outlines exist for
this island, and the first build invented 1,922 boxes while they sat unused. Timetables from GTFS,
not typed in. Tide from official harmonic constituents. Weather live from a licensed source and
past from reanalysis. The rule: where real geometry or real data exists and is licensed, invention
is a bug. Procedural fill is allowed only where nothing real exists, and it is labelled.

**Stage 3. The bitemporal spine.**
This is the single largest architectural correction. Every record carries two times: when it was
true of the island, and when the twin learned it. Then live mode, history mode and scenario mode are
not three systems, they are three cursor positions over one store. The first build bolted live time,
scrubbing and projections onto a single-time model and paid for it in every panel that touched time
(a departure board following the projected clock while the figure beside it stayed frozen at the
last lived tick). A digital twin IS a bitemporal database with a renderer. Build it as one.

**Stage 4. One vertical slice, played end to end, before any fan-out.**
One real island event, modelled whole: a Friday barge day. The 6:00 vehicle sailing loads at Toondah,
cars queue at Junner Street, foot passengers ride the Flyer to One Mile, the bus meets the boat,
shops open on published hours, the tide moves the waterline, and one person can be followed from
their house to the jetty. Simulation, render, UI and data in one slice, played by a human-shaped
agent, judged inside the running whole. Only when that slice is genuinely good does the swarm fan
out. The first build fanned out first and produced forty-six clean systems with dead seams: nine of
eleven sentiment channels had never fired, and a koala death on the road reached nobody.

**Stage 5. Fan out by island events, never by engineering subsystems.**
A component is one real thing that happens on this island, modelled whole: the consultation loop, the
hazard day, the whale season, the money year. It must name real places and real bodies, move real
residents, touch at least two systems, and be judged inside the running whole. If a slice can be
built without touching another system it is cut too thin to build.

### 3. The laws, all of them executable

- **Provenance is a type, not a convention.** Every record: source, locator (page or URL), the two
  times, confidence, and register: known, modelled, proposed, contributed. The gate rejects records
  without it. Low confidence never reaches a player; the honest display is a contested-or-unknown
  marker, not the claim.
- **The three registers are visually distinct everywhere,** and proposed never blends into the
  default island state. The proposed works' power demand does not inflate the real island's demand
  figure; publish the split.
- **Cultural boundary, blocking.** Minjerribah is Quandamooka Country and QYAC has not seen this
  project. No invented language, ceremony, sites or cultural content, ever. Organisations may be
  named and their publicly advertised events listed as advertised; their views, decisions and
  knowledge may not be invented or inferred. A queue of open questions for the Traditional Owners is
  maintained and is never described as approvals. Seed the banned-token list from the first build's
  data/lore.json, which carries words already burned once, including yalingbila.
- **Live mode shows real observations; simulation only answers for moments that have not happened.**
  A ranked source ladder resolved per field: island instrument, official observation, model,
  simulation. Freshness demotes per field. The bottom rung never wins in live mode; the honest
  answer to a stale feed is "not known", dated.
- **The world is never empty on screen.** Warm the simulation in from before the opening moment, and
  open the camera where life is visible, not at sixteen kilometres. The first build's owner went
  eight days without seeing a car on his own island, and the cars were there the whole time.
- **Names are provenance too.** An agent may not coin a name for the owner's designs; "carbon
  furnace hall" was invented by an agent and quoted back to him as his. Every generated person is
  disclosed as generated on every card, permanently, because on an island of two thousand real
  people a name pool will eventually collide with a real person by chance.
- **Personal data never lands in the repo.** Screens for contact details with a published-versus-
  personal distinction; staging areas provably sealed by asking git, not assumed sealed.
- **Passenger and vehicle crossings are never one figure.** You can almost always get off the
  island; you cannot always get your car off. The second question is the useful one.
- **House rules:** Australian English, prices in A$, no em dashes anywhere including code comments
  and commit messages, no overstatement, the smaller true claim beats the bigger vague one.

### 4. Judging: two bars, and the reference games retired from the bench

The first build judged slices blind against Sims 4 and Cities: Skylines II, and in thirteen waves
not one slice ever passed: partly because the instrument was broken, and partly because the bar was
a category error. A civic twin of a real island is not trying to be a shipped entertainment product.
Keep the reference games as calibration for craft feel. Judge with two bars, separately:

- **Traceability, machine-checked:** every number on screen traces to a source and page or to named
  model inputs. Critics open the actual PDF and run pdftotext on the cited page. A citation that
  does not check out is reported as a fabrication.
- **Recognition, human-judged:** would a councillor recognise their own instruments; would an
  islander recognise their own street; would the owner recognise his island.

The swarm protocol: builder, critic, scout. The critic hunts defects and must operate the artefact
with the validated instruments. The scout hunts what is latent and wonderful, because a build judged
only by critics converges on inoffensive. Neither outranks the other. Schedule the wave's synthesis
and playthrough agent FIRST in the budget, not last: session limits kill wave tails, and the first
build's playthrough was killed three waves running, which delayed by a week the discovery that its
storyline engine died on sim-day ninety.

### 5. Data to have staged before the first agent runs

Have these downloaded, licence-checked and in an inbox on day zero:

- **ELVIS LiDAR** (elevation.fsdf.org.au): check island coverage first; heights and canopy fall out.
- **Queensland Spatial / DCDB cadastre**: lot boundaries, tenure, road reserves.
- **OpenStreetMap extract** of the island: about 1,059 building footprints, roads, POIs. Resolve the
  ODbL share-alike question against the repo licence BEFORE committing derived packs.
- **TransLink GTFS** for SEQ: the real 880 and 881 and ferry connections, machine-readable, with
  GTFS-realtime as the live rung. Verify the island routes are present.
- **Tide harmonic constituents** for the Dunwich standard port from the official tables, not
  approximated from memory.
- **BOM registered data service**: register properly for station observations; Open-Meteo (CC-BY)
  as the model rung; the undocumented api.weather.bom.gov.au is prohibited by its own terms.
- **Open-Meteo archive / ERA5 reanalysis**: real past weather for the bitemporal store.
- **ABS Census DataPacks** at SA1 level for the three townships, not just the island SA2.
- **Atlas of Living Australia**: real occurrence records for koalas, shorebirds and acid frogs;
  plus Birdata and eBird for shorebird counts on the flats.
- **QImagery historical aerials**: Queensland's archive reaches back most of a century;
  georeferenced, these are the past-tense terrain and township deltas.
- **Trove**: digitised newspapers for the historical layer, including the 1896 to 1898 storm
  sequence that cut Jumpinpin.
- **The RCC corpus** already curated (38 documents, all text-extractable) and the owner's staged
  material: the 2012 legislation stack, his 139-placemark map, the noticeboard and events-engine
  repos, the scan pipeline.
- **CC0 asset kits** (Kenney, Quaternius) as interim vehicles and props; no licence friction.
- **Captured HDRIs** of the island sky, and phone or GoPro video of hero places for splatting.

### 6. The AAA path, AI-first, as of August 2026

- **WebGPU from day one.** Compute shaders carry crowds, particles and culling; WebGL was the first
  build's ceiling. Babylon and Three both run WebGPU now; either is fine, thin and vendored.
- **The geometry ladder is the owner's six-tier LOD ladder,** with fidelity accumulating from
  capture rather than authored per asset. LOD2 footprints are real from day one.
- **3D Gaussian splatting is the 2026 route from a real place to photoreal without artists.**
  Phone or GoPro video of the pub, the jetty, the Gorge walk; splat training offline; compact splat
  files streamed for hero places, with simple mesh proxies underneath for simulation, picking and
  physics. Babylon renders splats natively. This single technique closes more of the AAA gap for
  real places than everything else combined, and the first build never used it.
- **Light is measured, not styled:** the sun from real solar geometry (keep the first build's),
  image-based lighting from captured island HDRIs, one calibrated rig, ACES.
- **Materials from photos:** AI de-lighting and PBR inference on capture; tiling only where nothing
  real exists.
- **Simulation at scale:** structure-of-arrays ECS in typed arrays, simulation in workers off the
  render thread, the event fabric between systems declared as data so the seams are reviewable.
  Budget ten thousand deciding agents; parked cars and moored boats are nearly free and are most of
  what a place looks like. Three to four hundred cars sit around Dunwich on an ordinary day for the
  park-and-ride; show them.
- **The stutter rule:** p99 frame time is the shipping metric. A 25 ms hitch fails the build no
  matter the average. The first build carried a 1,160 ms worst frame for a week.
- **Streaming tiles** (3D Tiles or equivalent) for the high rung; a small complete offline core for
  the low rung; the LoRaWAN byte-budget disaster mode designed now, not retrofitted.

### 7. The past tense

With the bitemporal spine, history is a query, not a feature. Era packs built offline from
georeferenced QImagery aerials and historical maps; Trove for events; reanalysis for weather; the
Jumpinpin channel opening as the flagship documented sequence. The past is interpretive and says so:
contested markers, bias notes, competing accounts on purpose. Oral histories and cultural knowledge
are not a dataset; nothing cultural enters except through Quandamooka-led governance.

### 8. What to carry from the first island, unchanged

The first build's deepest value is not its code. Carry: the fact-checked data packs; the doctrine
documents (CONTRACT, CRITIC, SCOUT, DIRECTION, PARTICIPATION, CAPTURE-CONTRACT, SOURCES, HORIZON,
CONNECTORS, BUILDINGS); the gate checks including the banned-token list; the tide constituents and
solar geometry; the zero-point capture design; and this file. The first island remains running as
the reference implementation: ask both builds the same probe questions and compare answers. Where
they disagree, one of them is wrong, and finding out which is free QA in both directions.

### 9. The failure catalogue

| What happened | What it cost | The law that prevents it |
| --- | --- | --- |
| Founding brief had a quality bar but no purpose | Agents built beautifully and guessed at what it was for | Section 1 exists and is read first |
| 79k lines before the first commit | Waves could only go forwards | Git from commit zero |
| Critic instruments never validated | Three waves of verdicts against a magenta wash; UI invisible to screenshots | Stage 0, proven by breaking things |
| Sliced by subsystem, not island event | 46 clean systems, dead seams, a koala death that reached nobody | Stages 4 and 5 |
| Playthrough scheduled last | Killed by session limits three waves running; the day-90 crash found a week late | Synthesis first in every wave |
| Rules in prose, not in code | A cultural rule violated after being recorded | The gate, from day one |
| Invented where real data existed | 1,922 guessed boxes beside 1,059 real footprints; synthetic weather beside a free real feed | Stage 2's rule |
| Single-time model | Projection bugs in every panel that touched time | The bitemporal spine |
| World opened empty at tick zero, camera at 16 km | The owner never saw a car for eight days | Warm-in, and open where life is |
| A reference-game duel as pass or fail | Zero passes in thirteen waves; signal-free | The two bars |
| Agent-coined names on the owner's designs | "Carbon furnace hall" quoted back to him as his | Names are provenance |
| An owner preference generalised into a global veto | His own LOD6 design argued against with his own rule | Check the project before invoking any remembered rule |
| Merged passenger and vehicle ferries | The useful question, can my car get off, unanswerable | The two-crossings law |
| Average frame rate as the metric | A 1.16 second hitch survived a week of attention | p99 or it did not happen |
| No personal-data screen at ingest | Six named individuals and a mobile number one commit from public | Sealed staging, proven sealed |

---

*Carried out of the first build on 18 August 2026. The first island keeps running.*
