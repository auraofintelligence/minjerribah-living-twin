# The course

A training course for the owner and for the next new person. Nine short modules, each with a
thing to do right now. It teaches you to open the island, read it without being fooled, ask it
questions, put something true into it, run it yourself, and finally to point the whole method at
a place of your own.

Two promises about this document. First, every command, key and click in it was actually
performed against the running build on 18 August 2026 before it was written down; nothing here is
a guess about what the twin probably does. Second, every number in it is a measurement from that
day, and the build moves: where this course and the twin's own screen disagree, the screen is
right and this file needs updating. `docs/STATE-OF-PLAY.md` is the blunt account of what is
strong and what is not, and nothing below claims more than it does.

What you need: this repository, Node, and a browser. No install, no build step, no network at
runtime.

---

## Module 1: Opening the island

Start the server and open the page:

```
node tools/serve.js
```

then `http://localhost:4271/`. If the command stops at once with `EADDRINUSE`, something is
already serving port 4271, usually an earlier copy of this same server still running; the page
will load anyway, so check the browser before assuming anything is broken.

The first thing you see is the acknowledgement: Minjerribah is Quandamooka Country, this is a
simulation built from public records, it is not a cultural work and it does not speak for the
Quandamooka People. That screen is step one of four, and the project treats it as
load-bearing: the wording lives in `data/lore.json` and an automated check fails the whole
repository if the page's copy drifts from it. The same screen states what the
project will not do, and that QYAC has not seen it. Read it once properly; it governs everything
else in this course.

The last arrival screen asks where you would like to start and offers four doors: arrive on the
barge at Dunwich (Goompi), stand on the Gorge walk at Point Lookout (Mooloomba), open the planner
over the whole island, or have it explained first across seven short screens. There is also a
button called The keys first, for the keyboard before you are in the world; `docs/KEYS.md` is
the same map in file form. If it is
night on the island the screen says so plainly ("It is dark out there, and it is meant to be")
and offers to park the clock just after sunrise, because what is out of the window at 2am is sky
and silhouette, not a broken renderer.

Whichever door you take, the island opens with the Today noticeboard: the date, the tide, the
light, the crossing, what is on, and what is open. This one surface answers the five-second
questions a real person actually has:

- **Can my vehicle get off the island today?** The crossing section, marked **Real**, gives the
  next barge each way with the published timetable behind it, and then tells you the one thing it
  cannot know: there are 560 vehicle slots each way on the published day, whether one is still
  free lives in the operator's booking system, and "Book with SeaLink, do not read it here."
- **Is anything on?** The what-is-on section, also marked **Real**, listed real weekend events
  with their organiser and source, and for the day itself said: "Nothing is on today. That is
  true of most days on this island and it is worth knowing on its own."

**The three registers.** Everything on screen is one of three things, and you should be able to
tell which on sight:

- **Real**: somebody published it and the record names where. The barge timetable. The tide
  windows that shut the beaches to vehicles.
- **Modelled**: the twin worked it out and nobody measured it. How many people are on the island
  this afternoon. A shop's takings. A modelled number is an argument, not an observation.
- **Proposed**: suggested and not existing, marked proposed everywhere, forever. Press `U` for
  the biggest example: the works below the sand open with the words "Nothing below the sand is
  built, approved, funded, sited or consented."

Two further markers matter: **unconfirmed** (a real thing nobody has been able to check lately)
and **contributed** (supplied by a contributor, not yet verified by a second source). And a
fourth state has no marker because you never see it: anything below the confidence threshold is
not shown at all. Held is a normal state here.

The bar across the top always names what kind of time you are looking at: **LIVE** anchored to
the real Queensland clock, **SIMULATED** running its own seeded days, or a parked clock showing a
**PROJECTION**. On the day this was written the bar opened with "Live: 12 h behind the real
clock, catching up", which is the twin telling you exactly what it is doing rather than letting
you assume.

**Do this now.** Boot the island. Read the acknowledgement screen to the end. Take the planner
door. On the Today board, answer both five-second questions out loud, and find the label on each
section that says whether it is Real or A simulation. Then press `U`, read the first paragraph of
the proposed works, and press `Escape`.

---

## Module 2: Moving around

The keyboard has one map and it is `docs/KEYS.md`; the arrival screens show the same thing. The
short version you will use constantly:

- **Drag** holds the ground and moves it. **Right drag** orbits and tilts. **Wheel** zooms.
- **`Tab`** steps through the five camera modes: planner, street, follow, drone, cinematic.
  `Shift` + `Tab` goes back.
- **`F1` to `F4`** fly to Dunwich, Amity Point, Point Lookout and North Gorge. `Shift` + a
  function key saves your current view over that slot. `Alt` + `1` to `4` does the same four
  places without the function row.
- **`Home`** frames the whole island. **`W` `A` `S` `D`** pans, walks or flies depending on mode.
- **`Space`** pauses and unpauses; **`1` to `4`** set speed; **`,`** and **`.`** step an hour;
  **`0`** pauses.
- **`P`** is photo mode. **`L`** toggles place labels, **`B`** letterbox bars, **`H`** hides the
  whole interface, **`C`** cuts to the next cinematic shot.

One practical note from doing this: the camera's letter keys land on the island itself, so if a
panel or a search box has the focus, click the ground once and then press the key.

Photo mode deserves a minute. It hides the interface and gives you a small panel carrying the
camera modes, the four places, a **Time** slider with the mode word and the date beside it, and
Bars, Capture and Done. The slider is the same declared scrub as the ribbon, so photographing
golden hour does not quietly advance anyone's island, and while parked the panel grows a Back to
now button.

Verified on the day: `F1` put the camera at 578 m over the Dunwich end looking along One Mile;
`Tab` cycled all five modes and came back; `F3` landed at 615 m over Point Lookout, where the
township reads as streets of houses on a headland above a beach, with the contributed bus stops
carrying real Route 880 departure boards; `P` in and out worked with the panel exactly as above.

**Do this now.** Press `F1`. Drag, orbit, zoom. Press `Tab` five times, watching the mode strip.
Press `F3`, then `P`, slide Time to late afternoon, press Capture, then Done. Then `Home` to see
the whole island at once. If it is dark, take the sunrise jump the twin offers and look again.

---

## Module 3: Reading it honestly

This module is the reason the twin is worth your trust. Three habits.

**Ask every number where it came from.** Click any business and the inspector fills. On the day
this was written, Minjerribah Camping showed the chip **OPEN, NOT PUBLISHED**, and under WHO SAYS
SO: "Nobody has published hours for this place. What you are looking at is the simulation's own
pattern for an island business of this kind, and it is not a claim about when the doors are open.
Somebody went looking on 10 August 2026 and found nothing." The pattern it runs on is written out
in one line of prose, deliberately not drawn as a weekly roster, "so that it cannot be mistaken
for one". Trading hours across the pack are graded three ways: **published** by the business
itself, **listed** by a council or directory, or an **estimate** that is never shown as a fact
about a real street. The Today board printed the day's split: of 101 business records, 23
published, 17 listed, 34 estimates, 25 with no week at all, last reviewed 10 August 2026.

**Check the freshness on anything that claims to be current.** The conditions section of the
Today board said Air: not known, Wind: not known, with the reason underneath: the clock is live,
no current reading is in hand, so the twin keeps simulating its own weather so the island lives,
and it will not show you that as though it were today. "15 of 15 have no current reading and are
not claimed. Do not plan a day on this screen." The synced feeds in `data/feeds/` each carry when
they were synced and from what; the weather feed goes stale after one day by its own rule and
says so.

**Ask every lever whose decision it is.** Press `G` for the civic board. It opens by putting you
in your actual seat: "You have a budget line, a mailing list, and no vote in anybody's chamber.
Of the 64 researched levers, 19 are yours to decide and 4 need three governments to agree."
Every lever carries what it costs to build, what it costs to run, the lead time, and DECIDED BY.
Example from the day: Build the buried seawall at Amity Point, IN DELIVERY, YOURS TO DECIDE,
A$11M to build, A$250k a year to run, 3.5 years lead time, decided by Redland City Council. The
filters along the top are Mine, Theirs, Two or more governments, and Not modelled: that last one
is where the twin says a decision belongs to a body it will not model or guess at, which includes
everything QYAC decides.

Why "not known" is a feature and not a failure: a screen that shows you a number it cannot back
is training you to stop checking. This twin would rather admit a gap than defend a guess, and
every one of its packs carries a companion note (`docs/DATA-NOTES.md`) listing exactly what could
not be verified.

**Do this now.** Click a shop, read WHO SAYS SO, and say in one sentence who published its hours,
if anyone. Press `G`, find one lever marked YOURS TO DECIDE and one marked YOU CAN ONLY WATCH,
and read who decides each. Then find one "not known" anywhere on screen and read the sentence
under it that explains why.

---

## Module 4: Asking it questions

**The inspector** is the always-open panel on the right. It has no key because clicking the
island is the way in: click a person, a house, a shop, a road, a koala, a beach, or bare ground.
When nothing is selected it offers OR START HERE, a short list of residents, a business and a
koala to begin with. `Escape` clears, `Backspace` goes back to your last selection, double click
flies to a thing.

**Follow one resident through a day.** On the day this was written the inspector offered Kim
Ingham, 50, Dunwich. Her card opened with the honesty line every resident carries: "A generated
resident. Not a real person, and not based on one. The island's age and household figures behind
them are real." At 10:00am she was having people over, with the reasons listed: company, fun,
hunger, comfort, and the note that nothing was urgent when she chose. Three sim-hours later she
was watching for whales at Polka Point, "They come past close from the headland". Her tabs run
Now, Needs, People, Story and Law, and the Law tab is worth the click: 61 of 66 Acts in the
legislation pack reach her, 37,067 pages counted from the published consolidations, broken down
by the life events that bring each one into her life, with the not-advice line on top.

**The info views** paint data over the ground. `V` opens the picker with its 22 views in five
groups; `Alt` + a letter goes straight to one; `[` and `]` step through them; `Alt` + `V` turns
the current view off. Verified on the day: `Alt` + `K` lit up koala country and road strikes with
its legend, and `Alt` + `V` cleared it.

**The other windows on the island's state:** `J` is the chronicle, the dated record of this
playthrough written from what the simulation actually did ("Ten vehicles did not get across
today. About 4 of them will try again tomorrow, which puts tomorrow behind before it starts"),
with its house rules printed at the top: nobody in the record speaks, and every line is checked
against the tone guide and the cultural prohibitions before publication. `I` is the island log,
`E` the calendar, `X` the fine print, `Y` the seven-screen explainer with the island still in
view beside it.

**Do this now.** Click a resident, or take one from OR START HERE. Read what they are doing and
why. Set speed to 3x, or press `.` a few times, and watch the day change what they do. Open their
Law tab. Then press `Alt` + `K`, look at where the koalas are against where the roads are, and
press `Alt` + `V`.

---

## Module 5: Contributing

The island corrects its twin. The design is `docs/PARTICIPATION.md` (ten lanes, ordered from the
lowest technology up, because the islander without a phone is a first-class contributor), and
the standing precedent is already in the data: Rufus King Seafoods at Amity Point sits in the
business pack with its status set to closed because a resident said so in conversation on 6 May
2026, and the record keeps the correction attached so no later pass re-adds it from a stale
listing.

Two lanes have real tooling today, and both were run before this was written.

**A correction or an observation.** There is no form and no portal; contributions arrive out of
band and somebody types them into a batch file. The intake shape is documented in the header of
`tools/ingest/lane-contribution.mjs`. Write a batch (yours will carry a real fact you know, with
the contributor's consent recorded), then:

```
node tools/ingest/lane-contribution.mjs your-batch.json
```

Run on the day with a labelled practice batch, it printed exactly:

```
1 contribution(s) normalised to tools/ingest/candidates/contribution-2026-08-course-practice.json.
Nothing has been added to data/.
```

That second line is the design. A lane writes candidates into staging, never data. The candidate
it wrote carried the claim as a verbatim quote, a locator, the consent block, a visibility level,
status `contributed`, and a note that a person reviews it before `promote.mjs` will touch a pack.
The lane refuses, on purpose: any batch with a field called hours (read the header of
`src/systems/economy/chour.js` before arguing), any memory anchor, and anything without explicit
consent.

**Your own map.** The proof that this lane works is on screen: the owner exported his Google
MyMaps of the island, 139 placemarks in 10 folders, and the lane turned it into a 133-record
contribution pack of which 42 features now draw in the world, including the Point Lookout bus
stops you saw in Module 2 carrying real Route 880 departures. Dry-run it yourself against his
staged export:

```
node tools/ingest/lane-map.mjs --extract ingest-inbox/mymaps/north-stradbroke-island.kml --dry
```

On the day that printed: 139 placemarks in 10 folders; verdicts NEW 86, CONFIRMS 28, CORRECTS 11,
CONFLICTS 8; 6 held; 2 contact details stripped and never printed. Every pin is reconciled
against the packs that already exist, and a verdict is a lead, never an edit: applying a CORRECTS
into a sourced pack is a person's decision and a separate commit. If you export your own map,
know the trap the tooling already knows: Google's Download KMZ hands back a stub with no map data
in it; use Export to KML instead, and the lane's error message walks you through it.

What a contributor is promised, kept by the tooling rather than the prose: one spine and no
lower-trust lane, your name on the record and nothing else (no points, no badges, no
leaderboards), consent and visibility per record enforced when the pack is built, one click from
anything shown to who made it, held is invisible rather than caveated, and withdrawal honoured at
the next release with the honest caveat that a public git history persists.

And the refusal that outranks all of it: Aboriginal language, story, art and site knowledge are
not accepted through this repository, from anyone, however offered. The route for Quandamooka
cultural material is through QYAC, or it does not exist.

**Do this now.** Copy the intake shape out of the lane header into a file, put one true fact you
personally know into it (a trading hour, a moved noticeboard, a track condition), run the lane,
and open the candidate file it writes. Read what the tooling added around your fact. Then stop:
promotion is Module 7's story, and a candidate nobody has reviewed cannot go further anyway. If
your fact was real and checked, leave the candidate for review; if it was practice, delete it
from `tools/ingest/candidates/`.

---

## Module 6: Running it yourself

Three tools, all plain Node, all run before this was written.

**`node tools/serve.js`** serves the twin at `http://localhost:4271/`. Static files, no build,
no package install; the engine is vendored. This is the only thing between the repository and a
browser.

**`node tools/headless.mjs`** runs the island with no browser at all, which is how you check the
simulation without trusting your eyes:

```
node tools/headless.mjs --ticks 4320 --profile     # 30 sim-days with timings
node tools/headless.mjs --determinism              # runs the world twice and diffs it
node tools/headless.mjs --system koala             # one system's daily describe() lines
```

What the output means, from the day's runs. The profile run booted in about 2.2 s with 60
registrations, ran 4,320 ticks (a tick is ten sim-minutes) at 8.577 ms per tick, and printed
`WARNING: over the 4 ms budget in the contract`, which is the tool refusing to let a known
performance problem pass silently; the hottest systems are listed under it. The determinism run
printed `DETERMINISM OK: two runs of 1440 ticks agree (fca6976b)`; if that line ever says
anything else, something in simulation code is drawing on real time or unseeded randomness, and
that is a stop-everything bug. The `--system` form prints one system's self-description each
sim-day, which is how you watch a population or a queue over a year without a screen. A boot line
worth knowing: `[contributed] 42 public features from Luke Hayes's map...` is Module 5's lane
reporting itself every single run.

**`node tools/gate-audit.mjs`** is the honesty harness: every rule the repository can execute,
run over every pack and file, non-zero exit on any blocking finding. Four severities: blocking
(fails), accepted (a known fault with its count frozen in a ledger; it prints every run and fails
the moment it grows), advisory (worth knowing), and review (a question only a human can answer,
printed every run so it gets asked). Useful forms: `--only lore` to narrow while fixing
something, `--strict` to make accepted debt count as blocking, `--json` for machines.

Honesty about the day this course was written: the full gate was RED, 12 blocking findings, all
of them registry drift from data pack edits made elsewhere in the same working session, none of
them caused by this course, and `docs/INGEST-STATUS.md` documents them and what clearing them
takes. A red gate that names its reasons is the system working. What you must never do is make a
finding disappear without reading it: most token hits under the cultural rules are the
prohibition being enforced, and a ledger entry is for those, never for a hit that is the thing
the rule forbids.

**Do this now.** Run all three headless forms and find, in your own output: the ms-per-tick
figure and whether it is over budget, the DETERMINISM OK line and its hash, and one system value
that changed between two daily lines. Then run the gate and read every blocking finding to the
end, including the arrow line that says what to do about it.

---

## Module 7: The ingest pipeline, end to end

How an outside thing becomes a fact in this twin, in plain words. The contract is
`docs/INGEST.md`; the measured state of every part on 18 August 2026 is
`docs/INGEST-STATUS.md`, which is receipts rather than intentions; this module is the walk
through.

**The inbox.** `ingest-inbox/` holds raw source material a person staged: the owner's KML export,
downloaded legislation consolidations. It is gitignored; nothing in it is data yet, and the gate
still screens it every run for contact details and cultural tokens, so a problem is flagged
before promotion rather than after.

**A lane.** A tool that reads one kind of source and writes candidates, never packs:
`lane-document` reads a registered, hashed PDF and pulls cited lines; `lane-contribution`
normalises a typed-in batch; `lane-map` screens and reconciles a map; `lane-legislation` measures
Acts against the official registers; `lane-scenario` stamps a scenario so it replays;
`lane-era` exists to refuse, with its reasons, until georeferenced historical mapping exists. A
machine finds lines; a person decides what is true.

**Candidates.** `tools/ingest/candidates/` is staging, also gitignored. Every candidate arrives
at medium-or-lower confidence with a note saying a person has to read it. You delete what is
wrong, rate what is left, and remove the needs-review marker from each record you keep: that
marker being gone is how the tooling knows a human looked.

**The gate.** Module 6's `gate-audit.mjs`, run over everything: the thirteen prohibitions in
`data/lore.json` read out of the pack itself, the record envelope, one three-word confidence
scale, citations that must resolve, coordinates against the island's own bounds, no em dash, no
American spelling, proposed staying proposed. For the twelve packs that predate the envelope, a
ratchet holds instead: their uncited records are counted, the count is frozen, and the gate fails
the moment it grows. Debt that cannot grow is debt that gets paid.

**Promotion.** `node tools/ingest/promote.mjs` takes a reviewed candidate file, writes the pack
and the registry entry, runs the whole gate, and rolls both files back byte-for-byte if anything
blocks. It refuses a batch in which any candidate still carries the unread marker. There is no
path to a registered pack that skips the gate: even `registry.mjs --refresh`, the only sanctioned
way to re-checksum a hand-edited pack, runs the gate first and refuses on red, which is exactly
what it did when tested on the day.

**The pack.** A committed JSON file in `data/`, with a registry entry in `data/_provenance.json`
carrying version, lane, sources, date and checksum. The checksum is the record that this exact
content passed. The running twin fetches the registry and the packs it lists at boot, from its
own origin, once, and never touches the network again; the fingerprint over all pack versions
travels with any claim so a scenario can be replayed against the exact island that produced it.

Feeds are the one thing beside packs: `data/feeds/` holds what a synced source said, stamped with
when and from what, gated by `tools/connectors/verify.mjs`, and never read by the simulation as
truth. The connectors also run outbound, and every emission is a draft a person sends or does not
send; the twin never posts anything anywhere by itself.

**Do this now.** Run `node tools/ingest/lane-document.mjs --list` and read the register: four
entries on the day this was written, three of them public documents with their publisher, their
sha256 and the date they were read, and the fourth the owner's own map export, which names its
author and its date but carries no hash. Then open `docs/INGEST-STATUS.md` and read one row of the lanes table
top to bottom, including its Proven by and its Known gaps. That file is what an honest pipeline
audit looks like; hold this course to the same standard.

---

## Module 8: Directing a wave

How this project is actually built: one person directing waves of AI agents. This module is
written so a second human could take a shift.

**The shape of a wave.** Work is cut into slices small enough to be improved and judged on their
own. Each slice gets a brief; a builder agent works it; a separate agent with fresh context
inspects the actual running output, never the builder's summary; between major waves one agent
plays the whole thing end to end and smooths it into one coherent piece, rewriting
`docs/STATE-OF-PLAY.md` from measurements. A progress page in `progress/` tracks the work as it
goes.

**A brief contains:** the single deliverable; the pointer documents for that slice (always
`docs/CONTRACT.md`, plus whichever of KEYS, INGEST, PARTICIPATION and the rest the work touches);
and the standing rules restated, because agents arrive with no memory: Australian English, no em
dashes anywhere, prices in A$, no overstatement (the smaller true claim beats the bigger vague
one), no fabrication, the `data/lore.json` prohibitions are blocking, and
`node tools/gate-audit.mjs` must pass over anything written.

**The three judging roles**, each with its own protocol file, all bound by the same evidence
discipline (run the build, drive it, read the output back; a claim you did not verify yourself is
not evidence):

- **The critic** (`docs/CRITIC.md`) holds the floor on defects. It judges the running build
  blind against a named reference game, area by area, and answers one question: shown these two
  side by side with the branding stripped, which would a player say is better? It is allowed to
  pass a slice only when the build wins and it can say why in one sentence that would survive an
  argument with someone who loves that game.
- **The scout** (`docs/SCOUT.md`) is the counterweight: it finds what is already good and what
  could be, because a build judged only by critics converges on inoffensive. It never overrules
  a fail, and a fail never overrules it.
- **The cheerleader** (`docs/CHEERLEADER.md`) reports what verifiably works to the human,
  receipts or silence, in `docs/WINS.md`. It exists because a builder who reads only defect
  reports starts believing the project is mostly defects, and on this project that belief is
  false.

**The two bars.** Every slice must clear both, and they are different kinds of thing. The
honesty bar is the gate: machine-run, blocking, non-negotiable, and no slice ships over a
finding it caused. The quality bar is the reference game: human-judged, comparative, and never
finished, because "as good as the shipped game" is a moving thing you argue about with evidence.
A slice that is honest but dull has cleared one bar; a slice that is dazzling and cannot cite
itself has cleared the other; neither ships alone.

**Sending a slice back.** The critic names the single biggest gap: one sentence, imperative,
specific enough that the builder can act on it in one pass, with the evidence quoted (a probe
value, a screenshot, an observed behaviour). "Needs more polish" is a useless finding and
reflects on the critic. No fixed number of rounds; the loop ends when the critic is wowed or the
owner calls it.

**Taking a shift, concretely.** Read `docs/STATE-OF-PLAY.md` section 7 for what most needs doing.
Write the brief as above. When the slice comes back, do not read the builder's summary first:
boot the build, check `TWIN.errors()` is empty and the console is clean, run
`node tools/headless.mjs --determinism`, run the gate, and drive the thing the slice claims to
have changed. Then judge. The infrastructure traps that will otherwise cost you a turn are
written down in STATE-OF-PLAY section 5; trust them, they were all paid for.

**Do this now.** Play the critic's opening move on the build as it stands: open the island, run
the boot check, then pick one panel and write a single biggest-gap sentence for it, in the
imperative, with the evidence you personally saw. Compare yours with section 4 of
STATE-OF-PLAY and see whether you found something it already knows.

---

## Module 9: Your own place

This course ends where the owner's course philosophy says every course ends: this twin is a
worked example, and the point is not that you use his island. It is that you can build your own,
for your own place, holding the same standard.

A second build already exists to prove the method transfers: its founding prompt lives in its own
repository (this repo's `docs/SECOND-BUILD-PROMPT.md` is a stub saying where and why the two are
kept apart), and that prompt carries the full shopping list for starting a place from nothing.
The empirical version of that list is this repository's own `data/` directory, because its packs
are exactly what an island turned out to need:

- geography you can build ground from, with real coordinates
- places and businesses, every one from a public record with a source and a confidence
- transport: the timetables that are the place's actual heartbeat
- civic: who decides what, lever by lever, which is the hardest research and the most valuable
- ecology, residents-as-statistics (never residents as people), events, legislation
- and lore: the acknowledgement, the prohibitions, and the sources for both

Gather in that order. The heartbeat rule from `docs/DIRECTION.md` holds anywhere: build the
arrival rhythm first (the ferry, the highway, the train), validate it, and let everything else
attach to it.

**What transfers** is the method, whole: offline and deterministic at runtime; simulation never
imports the renderer; every record carries its source and its confidence; the three registers,
visibly distinct, with proposed staying proposed forever; held as a normal invisible state; a
gate of runnable rules, because a rule that is not a runnable check is not a rule; contribution
as one spine with no lower-trust lane; corrections as provenance, never overwrite; and the
standing constraint that the difficulty is never conflict.

**What is Minjerribah's alone** and must not be copied: the packs themselves; the owner's map
and every contributed record (they carry consent for this project, not yours); the corrections
residents gave this island's twin; the acknowledgement wording; and every fact that makes this
island this island. Your place's twin earns its own.

**Above all: the cultural boundary belongs to the Traditional Owners of your place.** It is not
a file you port. This repository's most important refusal (cultural material enters through the
Traditional Owners' own organisation or it does not exist) is the shape you keep, but everything
inside it is theirs to decide: whose Country it is, who speaks for it, what the acknowledgement
says, what must never be modelled, and whether the twin should exist at all. That last question
is the first one on this project's review queue, unanswered here, and it will be the first
question at your place too. Ask it before you write a line, and build so that any answer,
including no, can be honoured.

**Do this now.** Write one page for your own place, on paper if you like: the place's name and
whose Country it is; the three or four settlements and the one arrival artery; where you would
get each pack's worth of facts, publicly; the first question you must ask, and to whom it
belongs. If you cannot name who speaks for the Country you are standing on, that is the
research to do before any of the rest.

---

## Where everything lives

| Question | File |
| --- | --- |
| What is true of the build right now | `docs/STATE-OF-PLAY.md` |
| Every key | `docs/KEYS.md` |
| The machine, explained for a reader | `docs/HOW-IT-WORKS.md`, or `Y` in the build |
| The build contract and non-negotiables | `docs/CONTRACT.md` |
| How things become data | `docs/INGEST.md`, state in `docs/INGEST-STATUS.md` |
| How people contribute | `docs/PARTICIPATION.md` |
| The judging roles | `docs/CRITIC.md`, `docs/SCOUT.md`, `docs/CHEERLEADER.md` |
| What is for QYAC to answer | `docs/CULTURAL-REVIEW.md` |
| What each pack could not verify | `docs/DATA-NOTES.md` |
| Where the twin sits and what it is for | `docs/DIRECTION.md` |

Course written and verified against the running build on 18 August 2026. Every command was run,
every key was pressed and every screen was read on that day; the measurements will drift and the
screens outrank this file.
