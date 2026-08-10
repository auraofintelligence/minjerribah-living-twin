# Ingest

How an outside thing becomes a record in this twin, and what has to be true of it before it gets
in. Read this before writing anything that produces a data pack.

Until this pass there was no answer to that question. Eleven packs existed and they were good, but
every one had been written by hand by an agent doing research, `tools/` held no ingest tooling,
`assets/` was empty, and there was no way at all to take a council document, an islander's
correction, a historical record or a planning scenario. This document is the contract for the
machinery that now exists, and it is honest about which parts of that machinery are built.

## The shape of the thing

```
a named document, a contribution, an era, a scenario
        |
        v
  a lane            tools/ingest/lane-*.mjs      finds candidates, writes nothing to data/
        |
        v
  candidates        tools/ingest/candidates/     staging. A person reads these.
        |
        v
  the gate          tools/gate-audit.mjs         blocking. Runs over the whole repository.
        |
        v
  promotion         tools/ingest/promote.mjs     writes the pack and the registry, or rolls back
        |
        v
  a committed pack  data/*.json
  a registry entry  data/_provenance.json        version, lane, sources, date, extractor, checksum
        |
        v
  the running twin  src/world/data.js            offline, deterministic, one fetch per pack
```

The two properties that make it worth trusting:

**A machine finds lines; a person decides what is true.** No lane writes a pack. A lane writes
candidates carrying the document, the page and the sentence, and every one comes out at medium
confidence with a note attached saying a person has to read it. `promote.mjs` refuses a batch in
which any candidate still carries that note, so a file nobody has read cannot become data.

**A pack on disk is a pack that passed.** Promotion writes the pack, writes the registry entry,
runs the whole gate, and if anything blocks it puts both files back exactly as they were. The
checksum in `data/_provenance.json` is therefore not a nicety; it is the record that this exact
content passed the gate. Change a pack by hand and the checksum stops matching, and the gate fails
until you run `node tools/ingest/registry.mjs --refresh`, which itself refuses to write a new
checksum if the new content does not pass. There is no path to a registered pack that skips the
gate.

## The record envelope

Every record a lane produces carries this. It is the contract, and `tools/gate-audit.mjs` enforces
it for any pack the registry marks `"envelope": "v1"`.

| Field | What it is |
| --- | --- |
| `id` | Unique inside its array. |
| `source` | A document id in `_provenance.documents`, or `contribution:<batch>`. |
| `locator` | Where in the source: `p. 214, line 12`, or `paper, 2026-08-09`. |
| `quote` | The sentence, verbatim, where the record asserts something about the real world. |
| `confidence` | `high`, `medium` or `low`, on the scale the packs already use. Never a fourth word. |
| `extracted_at` | ISO date, local calendar. |
| `extractor` | `lane-document/1.0`. Which code, which version. |
| `status` | `committed`, `contributed` or `proposed`. |
| `asserts` | `real_world` when the record is a claim about the island rather than a modelling parameter. |

**A record that cannot cite is not a record.** A record with `asserts: "real_world"` and no quote
fails the gate, and so does one with no locator. A modelling parameter is not held to that, because
demanding a quote for a number nobody published is how invented quotations get into packs, which is
worse than an honest unquoted parameter.

**Do not invent a second confidence scale.** Each pack already defines `high`, `medium` and `low`
in its own terms in its own `confidence_scale` block, because what counts as a high-confidence
ferry timetable is not what counts as a high-confidence species record. The gate fails on any
confidence field holding anything else, and on `null` unless there is a note beside it saying what
could not be established.

**Anything proposed stays proposed.** `statusOf()` and `labelFor()` in `src/world/data.js` are the
only place that decides, and every panel that renders a record calls them. If a pack invents a
status word the classifier does not know, the interface would render that record with no marker at
all, so the gate fails and names it. That is how a plan becomes a fact by being modelled, and it is
the specific failure this check exists to stop.

`STATUS_VOCABULARY` maps every status word in the packs onto what the interface must do about it,
and carries two kinds beyond the envelope's three because the packs already draw a distinction the
envelope does not. `unconfirmed` is the one that matters: `trading-unconfirmed` in
`data/businesses.json` means a real business nobody could confirm is still trading, and there are 33
of them. Folding those into `proposed` would put a Proposed badge on a shop that is probably open,
which is a worse falsehood than the one the badge exists to prevent, so they get a marker that says
what is actually true. Those extra kinds classify what the legacy packs already say. They do not
widen the envelope, and a `v1` record carrying one fails the gate.

### The legacy packs

The twelve packs that predate this document are marked `"envelope": "legacy"`. They carry a
`source` and a `confidence` on most records but not the rest of the envelope, and retrofitting
1,356 records was not this pass's job. They are held instead by a ratchet: `accepted_debt` in each
registry entry freezes how many of its records cite nothing, carry no confidence, or sit at low
confidence inside a collection the registry marks player-facing. The gate prints those counts every
run and fails the moment one grows, naming the new record. Debt that cannot grow is debt that gets
paid.

## The lanes

| Lane | Built | Tool | What it does |
| --- | --- | --- | --- |
| research | yes, historically | none | How every existing pack got here: an agent reading public sources and writing JSON. Not repeatable by machine. **No new pack should use it.** |
| document | **yes** | `tools/ingest/lane-document.mjs` | A named published document to cited candidates with page numbers and verbatim quotes. |
| contribution | **yes**, as far as intake | `tools/ingest/lane-contribution.mjs` | An intake batch to envelope records with attribution, consent, visibility and a coarsened location. |
| map | **yes** | `tools/ingest/lane-map.mjs` | A KML or KMZ of the island to screened, bounds-checked records, each carrying a four-way reconciliation verdict against the packs that already exist. |
| era | **no, deliberately** | `tools/ingest/lane-era.mjs` | Historical layers. See below. |
| scenario | partly | `tools/ingest/lane-scenario.mjs` | Stamps a scenario with the seed and the pack fingerprint so it replays. Running one belongs to the scenario system. |

### The document lane

```bash
node tools/ingest/lane-document.mjs --register "<path to the pdf>" --id rcc-city-plan-v13 \
     --title "Redland City Plan version 13" --publisher "Redland City Council"
node tools/ingest/lane-document.mjs --extract rcc-city-plan-v13 \
     --terms "Point Lookout,Dunwich,Amity Point,Minjerribah,North Stradbroke" --context 1
node tools/ingest/lane-document.mjs --list
```

Registering hashes the PDF and records where the copy that was read lives. The documents themselves
are not in this repository and are not meant to be: they are public documents belonging to their
publishers, and the register records where they are, what they hash to, and when they were read. If
the file at that path stops matching its hash, extraction refuses and says so, because a citation
that names a title rather than a specific file can silently become a citation of version 12.

Candidates are staging and are not committed: `tools/ingest/candidates/` is in `.gitignore`. The
audit trail is the register plus the terms, because a document with a recorded hash and a recorded
term list re-extracts to exactly the same candidates on anybody's machine, and that is a better
record than a partial copy of somebody else's document sitting in this repository forever. What is
committed is what survived a person reading it, with its page and its quote.

**Narrow diet, and it is a rule not a preference.** The lane has no mode that points at a
directory, and it refuses a document over forty pages without `--terms`. Reading a 484 page
planning scheme into a pack whole is copying, not extraction.

**What it cannot do, honestly.** It reads lines. A two-column fact sheet extracts as interleaved
lines, half a sentence from each column, and a line mentioning Point Lookout may be a rule, a table
of contents entry, a map legend or a sentence explaining that the rule does not apply there. The
lane does not try to tell those apart and never will, because a machine that guesses which lines
are rules produces a pack that is confidently wrong. It produces candidates. A person reads them.

**One substitution happens, and it is declared.** An em dash inside a source's own wording is
rendered as a hyphen, the record carries `quote_note` saying so, and nothing else about the wording
changes. The house rule against em dashes is about this project's prose, not about what a council
wrote, and this is the only way to hold both.

### The contribution lane

```bash
node tools/ingest/lane-contribution.mjs <batch.json>
```

The intake shape is in the header of that file. It validates and normalises; it does not open a
form, a portal or a network connection. Contributions arrive out of band, on paper, in conversation,
at a booth, and somebody types them in. The intake file is the boundary.

It refuses, on purpose:

- **Anything with a field called hours.** Nothing in any contribution lane may become an
  hour-verification protocol. Read the header of `src/systems/economy/chour.js` before arguing with
  this.
- **Memory anchors.** Lane 9 in `docs/PARTICIPATION.md` has the strictest floor in the project, and
  whether it proceeds at all is the owner's and the Traditional Owners' call before the first anchor
  ships. A tool that could write one today would be answering a question nobody has asked.
- **Anything without explicit consent.** Held is a normal state and the docs say so: unreviewed is
  invisible, not caveated.

Locations are coarsened at intake, before commit, never filtered at display time. The rounding is
deterministic, so the same input always coarsens to the same output and the twin stays replayable.

Which of the ten lanes in `docs/PARTICIPATION.md` open first, the default for contributor credit,
and the consent wording are all on the ask list in that document and none of them is decided here.

### The map lane

```bash
node tools/ingest/lane-map.mjs --extract ingest-inbox/mymaps/north-stradbroke-island.kml \
     --batch mymaps-nsi-2026-08 --contributor "Luke Hayes" --role builder \
     --source "Google MyMaps mid=..." --fetched 2026-08-10 --consent "<what was agreed>"
node tools/ingest/lane-map.mjs --extract <file> --dry      parse, screen and report, write nothing
node tools/ingest/promote.mjs tools/ingest/candidates/map-<batch>.json \
     --pack map-contributions --collection pins --lane map \
     --file data/contributions/map-contributions.json
```

A document lane reads a publisher's words. A map lane reads somebody's hand, and the differences are
the whole design.

**The confidence is split, not averaged.** The first map through this lane is the owner's own Google
MyMaps of the island he lives on, and it carries his own statement about itself: *under construction,
he does not know what on it is up to date or accurate, use it as a starting point*. That is the pack's
`data_status` and nothing overrides it. So every record carries `existence_confidence: high`, because
he stood there and put the pin there, and `status_confidence: low` for a shop, a rental or a lease,
because whether it still trades is exactly what he says he cannot vouch for. A beach and a boat ramp
get `medium`, because they do not open and shut. Folding those into one number would throw away the
most useful thing the source said, which is the reading `docs/SOURCES.md` already takes of the events
engine's own `dataStatus`.

**The four-way reconciliation is the output, not a side effect.** Every pin is matched against
`data/places.json`, `data/businesses.json`, `data/transport.json` and `data/geography.json` by name
and by distance, and lands on one of four verdicts with the reason recorded on the record:

| Verdict | What it means |
| --- | --- |
| NEW | Nothing in the packs looks like this. |
| CONFIRMS | An existing record, and his pin corroborates its position. |
| CORRECTS | The existing record carries a different position, or none, and his is first hand, so his wins on position. |
| CONFLICTS | They disagree about something the source's own `data_status` says it is unsure of. The existing sourced record wins on status; his pin wins on position. |

**A verdict is a lead, never an edit.** The lane writes into its own contribution pack and touches
nothing else. Applying a CORRECTS into `data/places.json` or `data/businesses.json` is a person's
decision and a separate commit, and the corrected record has to say whose pin it came from, because
`docs/PARTICIPATION.md` says corrections are provenance rather than overwrite. A machine that silently
replaced a sourced coordinate with a contributed one would be exactly the lower-trust lane this
project promises not to have, running in the opposite direction.

**KML is lon,lat,alt.** `toLatLon` in `tools/ingest/kml.mjs` is the one place that turns a KML triple
into a lat and a lon, and it is named so a reader can check it. Every point is tested against the
island's bounding box, and a point outside it is reported rather than dropped: a placemark in the
wrong ocean is a fact about the file that somebody needs to know.

**The NetworkLink trap, because the next person will hit it.** Download KMZ from Google MyMaps returns
a zip containing a two kilobyte `doc.kml` that holds a `<NetworkLink>` and no map data at all. A
parser reads it happily and reports nought placemarks, which tells a person their map is empty when it
is not. `readMapFile` detects that case exactly, refuses, and prints what to do instead: three dot
menu, Export to KML/KMZ, tick "Export as KML instead of KMZ". Following the link once and saving the
result is a fetch, which is an offline step; the running twin never touches any of it.

**Two screens run before anything is written, and both are gate checks rather than code in this
lane.** They are in `tools/ingest/checks-screens.mjs` and they run on every gate, over the staging
area as well as the packs, so the next map is looked at before somebody promotes it rather than after.

- `personal-data`. No contact detail and no residential address enters this repository through a
  contribution, under any consent, from anyone. The rule is not "no phone numbers in data": a twin
  that models wildlife rescue carries the rescue hotline and a twin that models the ferry carries the
  operator's booking line, and those are published, sit on a record that names where they were
  published, and a player who needs one needs the real one. So the severity turns on three questions
  the check can answer. In a contribution pack, blocking. Elsewhere with a citation on the record,
  advisory and printed every run. Elsewhere without one, blocking. **Nothing in the check or the lane
  ever prints the value**, because a gate log is a file, a scrollback and a screen share.
- `contribution-culture`. The two cultural prohibitions in `data/lore.json`, read out of the pack
  rather than restated, applied to contributed and staged material. A placemark either of them touches
  is **held**: no record, no coordinate, no name in the interface, no place record. So is any other
  placemark drawn over the same ground, within 25 metres or inside a held polygon, because the harm
  the sacred-sites rule names is the publishing of a location and not the wording beside it. Held
  items go to `docs/CULTURAL-REVIEW.md` as questions for QYAC, described accurately and without
  reproducing the detail, and nothing the lane writes names them.

**Positions of dwellings are coarsened before commit.** A resort with a reception desk is a business
with a street frontage and keeps its exact pin. A house let out by its owners is a house, and the fact
that it is advertised does not make its precise position this project's to publish, so it is rounded
to 250 metres through the same deterministic `coarsen` the contribution lane uses. Rounding happens
before commit, never at display time, because a runtime filter is one bug away from publishing what it
was hiding. For a coarsened record the reconciliation distance is published as a band rather than a
number, because a distance to a known record would undo the rounding.

**What it gets wrong, honestly.** Name matching is Jaccard plus a guarded containment lift, and on an
island where the shops sit ten metres apart and township names repeat it gets some of these wrong in
both directions. Three guards exist because they were each caught doing damage: a containment lift on
a single shared word offered to move the township of Dunwich to the post office; a whole-name match
paired a bus stop with the lodge it stands outside; and a beach-named holiday house was reported as
corroborating the beach. The report the lane writes has a "same name, far apart" section listing every
pair it could not separate, which is where a person who has been there settles each one in a sentence.

### The era lane, and why it is not built

`tools/ingest/lane-era.mjs` exists to refuse, with its reasons in its header.

This project has no georeferenced historical map and no historical aerial photography.
`docs/SOURCES.md` is explicit that there is no GIS anywhere in the owner's corpus. The only way to
build the lane today would be to generate a coastline for 1896 from description and then invite a
player to scrub between that and the real island as though both were the same kind of thing. Every
rule here says no to that. An honest gap beats a confident fabrication, and this is the gap.

What would unblock it, in order: obtain and georeference Queensland's historical survey plans and
aerial photography series; decide how uncertainty is drawn, which `docs/DIRECTION.md` item 4 leaves
open; and clear the cultural gate, which is not a formality when the recent past includes Myora
Mission and the protection era. `docs/CULTURAL-REVIEW.md` B5 holds that one.

### The scenario lane

```bash
node tools/ingest/lane-scenario.mjs --stamp <scenario.json>
```

A stamp is the seed, the registry fingerprint, and every pack id, version and checksum as they
stood, plus the fact that the gate passed over that content at that moment. `docs/DIRECTION.md`
calls replay peer review: a claim backed by a replayable run outranks one that is not, and that only
works if a report carries enough to reconstruct the exact world it ran in. A seed alone is not
enough, because the packs move.

Every input must name the pack record it rests on, and the tool checks that the record exists. A
scenario whose inputs do not resolve produces a report that cannot cite, which
`docs/DIRECTION.md` forbids.

## The gate

```bash
node tools/gate-audit.mjs                 every rule, every pack, every file
node tools/gate-audit.mjs --strict        accepted debt counts as blocking: the honest number
node tools/gate-audit.mjs --only lore     one group while you fix something
node tools/gate-audit.mjs --json          machine-readable
node tools/gate-audit.mjs --needs         also run the slow needs residual audit
```

One command, non-zero exit on any blocking finding, and every finding names the file, the record and
the line.

### What it checks

- **The thirteen prohibitions in `data/lore.json`**, read out of the pack rather than restated in
  code, so a rule QYAC adds is a rule the harness runs. Ten of the thirteen have executable checks;
  the three the pack marks manual are printed as questions every run rather than dropped, and a rule
  with no implementation reports itself as unimplemented rather than silently passing.
- **The record envelope**, in full for `v1` packs and against the frozen debt counts for legacy ones.
- **One confidence scale**, three words, no fourth, no unexplained null.
- **Nothing at low confidence marked player-facing**, and the count of low-confidence records inside
  player-facing collections held at its frozen number.
- **A schema per pack** in `tools/ingest/schemas.json`: the top-level fields it must carry, the
  collections it must contain, the fields every record must have, and a floor under each collection
  so a pack that quietly empties fails instead of a system quietly stopping.
- **Registry integrity**: every pack accounted for, checksums live, versions agreeing with the pack's
  own, extractor and ingest date recorded, the confidence spread still matching what is in the file,
  and the fingerprint current.
- **No em dash anywhere**, code comments included.
- **Australian English** in prose and in pack strings, skipping verbatim quotes because correcting a
  council's spelling inside quotation marks would be worse than carrying it.
- **Proposed stays proposed**, by running the runtime's own classifier over every status value in
  the packs.

### The four severities

| Severity | Effect |
| --- | --- |
| blocking | Non-zero exit. Named file, record and line. |
| accepted | A blocking-class fault that `tools/ingest/ledger.json` records as known, with a reason and a frozen count. It prints every run and fails the moment the count grows. |
| advisory | Worth knowing, never fails. |
| review | A rule whose check is a question for a human. Printed every run so it gets asked. |

The middle one is why this could be switched on at all. Eleven packs and eighty thousand lines were
written before any of this existed, and a gate that failed on all of it on day one would have been
switched off on day one, while a gate that ignored it would be a decoration. Every accepted entry
names a reason somebody wrote down.

**Do not add a ledger entry to make a failure go away.** Read the finding first. Most token hits
under the cultural rules are the prohibition being stated or enforced: `chronicle.js` has to contain
the word `corroboree` in order to refuse it, and the events panel has to name `ceremony` in order to
substitute it. Those belong in the ledger. A hit that is the thing the rule forbids belongs in a
deletion.

### The word ledger

`no-invented-language` is the hardest rule to execute and the most valuable. You cannot detect an
Aboriginal language word by tokenising, because nothing in a string says which language it came
from, and a check that pretended otherwise would be a check that does not check.

What is detectable is a word this repository has never carried before, appearing where a language
word would appear. `tools/ingest/vocabulary.json` holds every name-shaped word already in the packs
at the state waves 3 and 7 left them. A new word in a cultural position, which means as a key under
a season or language block or as the value of a field naming a word, a spelling or a gloss, blocks
the gate. A new word anywhere else is advisory, because a new species or business brings new words
constantly and stopping the build for those is noise nobody would tolerate.

```bash
node tools/ingest/vocabulary-accept.mjs           print every new word, grouped
node tools/ingest/vocabulary-accept.mjs --write   add them, after reading them
```

The tool prints and does not decide. The reading is the whole point. A word that turns out to be an
Aboriginal language word belongs in `lore.language.allowlist` with a published source, never here.

### Why this exists at all

`docs/CULTURAL-REVIEW.md` section D1. Wave 3 found six invented Quandamooka season names, deleted
them, and recorded them as banned. Wave 7 then found five of them still in use in
`data/narrative.json`, in 28 seeds, put there by a different agent that had read the rule, including
`yalingbila`, whose published meaning is whale, used as the name of a season. The rule had been
written down and was violated anyway, because nothing executed it.

**A rule that is not a runnable check is not a rule.** The banned-token scan now runs over
`data/**`, `src/**`, `docs/**`, `tools/**`, `tests/**`, `index.html` and `assets/**` on every gate
run, with no ledger and no exceptions beyond the three files that exist to record the mistake.

## Determinism

The twin is offline and deterministic at runtime, so ingestion is an offline step that produces
committed, versioned, checksummed data. Same seed plus same pack versions must still produce the
same island.

What that requires of anything built here:

- **No network call in the render or simulation loop, ever.** Not a fetch, not a lookup, not a
  cache warm. The registry is a committed file. `src/world/data.js` fetches it and the packs it
  lists off the page's own origin at boot and never again.
- **Loading order is the registry's order.** The previous loader assigned each pack into the result
  inside a `Promise.all` callback, so the key order of `world.data` was whichever fetch finished
  first. The packs are still fetched in parallel; only the assembly is ordered. That was one
  `Object.keys` away from mattering.
- **Coarsening happens at ingest, not at display.** A runtime filter is one bug away from publishing
  the thing it was hiding, and a runtime transform is a place for non-determinism to hide.
- **The fingerprint travels with any claim.** `world.data.fingerprint` is a short hash over every
  pack id, version and checksum. Publish it beside the seed with any scenario report. If the
  fingerprint differs, the packs have moved and the findings are about a different island.

`node tools/headless.mjs --determinism` must still print `DETERMINISM OK` and the same fingerprint,
`e140a9fb`, after any change here.

## The provenance API

`world.data` carries the answers to the three questions a system or panel needs, as non-enumerable
properties so nothing walking the packs trips over a function.

```js
world.data.fingerprint                    // 'b2c36fc9579b'
world.data.packInfo('places')             // lane, version, sources, checksum, confidence spread
world.data.document('rcc-city-plan-v13')  // the source document register entry

world.data.confidenceOf(record)           // 'high' | 'medium' | 'low' | null
world.data.mayShow(record)                // false for low confidence, player_facing false,
                                          // withdrawn, or a visibility above the audience
world.data.labelFor(record)               // { marker: 'Proposed', ... } or null
world.data.handlingOf(record)             // the handling rule, which the caller must read
world.data.originOf(record, 'places')     // everything: document, page, quote, extractor, date
world.data.citationOf(record, 'places')   // one line a player can read
```

`mayShow` and `labelFor` are cheap and allocate nothing; `originOf` and `citationOf` allocate, so
call them on a click and not in a tick.

Three rules that were written down in three different files and enforced by nothing now run through
these functions: `player_facing: false` from the lore pack's own conventions, the blocking
prohibition `no-low-confidence-to-player`, and the per-record visibility level from
`docs/PARTICIPATION.md`. `tools/ingest` imports these same functions rather than re-implementing
them, because a gate that re-implements the runtime's judgement is a gate that tests a copy.

## How to add a source

1. Register the document: `node tools/ingest/lane-document.mjs --register "<path>" --id <id>
   --title "<title>" --publisher "<who>"`. This hashes it and puts it in
   `data/_provenance.json.documents`.
2. Extract with terms: `--extract <id> --terms "Point Lookout,Dunwich"`. Candidates land in
   `tools/ingest/candidates/`.
3. **Read them.** Delete what is wrong. Rate what is left. Remove the `needs` field from each record
   you are keeping, which is how you tell the tooling a person has looked.
4. Add a schema for the pack in `tools/ingest/schemas.json` if it is a new one.
5. `node tools/ingest/promote.mjs <candidates.json> --pack <id> --collection <name>`. It writes,
   runs the gate, and rolls back if anything blocks.
6. Fill in the registry entry's lane, sources and note by hand. A tool does not know where a pack
   came from.

Two rules stand over all of it. **Named documents for a named purpose**: do not point yourself at a
corpus and synthesise, because `Sorting_Files\PDFs_to_Sort` contradicts itself in places by design
and a wave pointed at all of it will produce something confident and wrong. And **cultural material
is not a source lane**, whatever a document offers, however it is framed. The route for Quandamooka
cultural material is through QYAC or it does not exist.

## How to add a lane

1. `tools/ingest/lane-<name>.mjs`, exporting `EXTRACTOR = { id, version }` and a function that takes
   named sources and returns candidates. It writes to `tools/ingest/candidates/` and never to
   `data/`.
2. Declare it in `data/_provenance.json.lanes` with `built`, `tool`, `produces`, and either a `note`
   or, if it is not built, a `reason`. The gate fails on a lane that says it is built with no tool,
   and on a lane that is not built with no reason. An honest gap is a gap with a reason beside it.
3. If it needs a check nobody has written, add it to `tools/ingest/checks-*.mjs` and register it in
   the `steps` list in `tools/ingest/gate.mjs`. A rule that is not a runnable check is not a rule.

## What a contributor is promised

Written here because it is the tooling that has to keep the promise, not the document that makes it.
`docs/PARTICIPATION.md` is the direction; this is what the code does.

- **One spine, no lower-trust lane.** A resident's correction and a council document arrive as the
  same shape of record and pass the same gate. There is no discount and no separate track.
- **Your name on the record.** Credit is a name in a manifest, and that is the whole recognition
  system: no points, no badges, no leaderboards. Trust attaches to claims, never to people, because
  on an island this size a person-score is a social ranking.
- **The dial stays in your hand.** Consent is explicit, purpose-bound and per record. Visibility is
  per record. Both are enforced when the pack is built, not when it is displayed.
- **One click to who made it.** Every contributed record a player can see resolves through
  `originOf()` to who made it, how, when and how it was verified.
- **Held is a normal state.** A record below the threshold is invisible, not caveated. Nothing about
  it is shown badly.
- **Withdrawal is honoured at the next release**, through a tombstone that keeps the id with a
  withdrawn marker so the record disappears honestly rather than silently. And the truth about the
  medium: a public git history persists, so revocation after publication is best-effort, and
  anything that might one day need full erasure belongs at a lower visibility level from the start.
- **Nothing becomes an hour-verification protocol.** Not from any lane, not by any route.

## What is not built, and is not pretending to be

- The era lane, above, with its reasons.
- Running a scenario and writing its report. Only the stamp is here.
- Asset ingestion. `assets/` is still empty and `docs/CAPTURE-CONTRACT.md` still describes what will
  arrive. The gate covers it in advance: any image committed under `assets/` that is not declared in
  `assets/manifest.json` with a named creator fails, which closes the scope gap that contract flags.
- Retrofitting the envelope onto the twelve legacy packs. Their debt is frozen and printed, not paid.
- Any intake surface. There is no form, no portal, no booth software. The intake file is the
  boundary and everything upstream of it is people.
