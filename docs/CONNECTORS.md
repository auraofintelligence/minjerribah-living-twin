# Connectors

How the island's real organisations feed into this twin, and how the twin feeds back.

Read `docs/INGEST.md` first. That document is the contract for how an outside thing becomes a record;
this one is the contract for the outside things that are other people's, that change, and that
somebody has to agree to. The difference matters: a council document is a fixed thing you read once
and cite forever, and a rescue report, an opening hour and a school term are things that were true
when somebody looked.

## The tension, and how it is held

The owner wants real opening hours, the real date and time, and live two-way exchange with real
island organisations. `docs/CONTRACT.md` says the twin is offline and deterministic at runtime.
Both hold, and this is exactly how:

**1. A sync is an offline ingest step, never a runtime fetch.** A connector is run deliberately, by a
person or a scheduled job on somebody's machine. It reads a real source, screens what it finds, and
writes a versioned, stamped, committed feed. The running twin never touches the network: it loads
committed packs off its own origin at boot and nothing else, ever. Nothing in `tools/connectors/`
opens a socket, and any design that puts fetch, XHR or a websocket in the simulation or render loop
is wrong.

**2. The clock has two declared modes.** Simulated and live, and the mode is part of the record, so a
live session still replays. That work belongs to `src/kernel/clock.js` and `docs/KEYS.md`, not here.
What this layer owes it is the other half: `freshnessAt(record, isoNow)` turns a sync stamp into a
word at a given moment and never asks the machine what time it is. It lives in
`src/world/freshness.js`, the browser loads it out of `src/ui/panels/inspector.js`, and
`tools/connectors/lib.mjs` re-exports it rather than keeping a second copy. Same function, same
answer, replayable either way.

The moment it is called with comes off `world.clock` and off nothing else: the real Queensland
moment in live, the declared calendar in simulated, the parked view in scrub. Which one it was goes
on screen underneath the age, in words. **This was wrong for a whole round of this slice**, and the
way it was wrong is worth keeping: this document claimed the twin called that function while nothing
under `src/` had ever imported it, and the inspector had its own inline copy reading `Date.now()`.
So an island sitting at 2 October said an hour checked on 10 August was "checked today", because it
was answering with the reviewer's calendar rather than the island's. A freshness rule that lives only
in a document is a freshness rule that is not running.

**3. Freshness is a first-class property.** Every record carries when it was synced, from what
source, at what commit, and what the source said about its own currency. "The bakery is open" is only
as true as its last sync. A panel drawing anything from a feed shows that on screen rather than
implying live knowledge it does not have.

**4. It goes both ways.** Three emissions are built. Each writes a file to disk for a person to read
and send. The twin never posts anything anywhere by itself, and that restraint is a feature: nothing
leaves the island without a person.

## The shape of it

```
a real organisation's own file, on this machine
        |
        v
  a connector          tools/connectors/<id>.mjs      reads, screens, writes nothing to data/*.json
        |
        v
  a feed               data/feeds/_<id>.json          committed, checksummed, stamped with a commit
        |                                             a person reads this
        v
  the feed gate        tools/connectors/verify.mjs    envelope, privacy, freshness, cultural screen
        |
        v
  promotion            tools/ingest/promote.mjs       the existing spine, unchanged
        |
        v
  a committed pack     data/*.json
        |
        v
  the running twin     offline, deterministic, one fetch per pack at boot
```

One module crosses the line in the middle, and only one:

```
  src/world/freshness.js     the four words and the arithmetic
        |                    imported by tools/connectors/lib.mjs, in node
        |                    imported by src/ui/panels/inspector.js, in the browser
```

It carries no data and opens nothing. It exists so that the rule about how old a fact is has one
implementation, in the place the interface can reach, rather than one in the tools and a different
one on screen. `src/world/data.js` already crosses the same way, for the same reason.

And the other direction:

```
the running twin  ->  tools/connectors/emit-*.mjs  ->  out/emit/**  ->  a person reads it  ->  the island
```

There is no arrow from the twin to anybody. That is the point.

### Why feed files start with an underscore

`tools/gate-audit.mjs` treats every `.json` under `data/` as a pack the twin loads unless its
filename starts with an underscore, and says so in its own hint. A feed is not a pack: it is what a
source said, staged for a person to promote. `data/_provenance.json` already uses the same
convention for the same reason. Feeds are therefore `data/feeds/_<id>.json`, and
`tools/connectors/verify.mjs` fails on one that is not.

**The underscore does not hide a feed from every check, and one of those checks it should not
hide from.** `no-invented-language` is the rule that guards against a fabricated Aboriginal language
word, and it watches for a name-shaped word this repository has not carried before, anywhere under
`data/`. It reads feeds. At the sync recorded here that is 166 new words appearing only in feeds and
13 more shared with a pack, all of them advisory and none in a cultural position, and they are two
different things wearing one label: this layer's own envelope field names, which are English
structure and not vocabulary at all, and real content from a source, an event title or a trading
name, which is the check doing precisely what it exists to do.

So the connector gate reconciles against it rather than shrugging. It imports that check, counts the
words that are the feeds' doing, attributes them, and **blocks outright on any that land in a
cultural position**, at sync time rather than at gate time. The rest is one advisory with the number
and the command that clears it. Nothing here writes `tools/ingest/vocabulary.json`: that file belongs
to the ingest spine, and its own tool exists so a person reads every word before any of them is
accepted. A hundred and sixty-six advisories with nothing owning them is noise, and noise is how a
real finding gets missed; the same number with a name on it is a debt with a receipt. Clearing it is
a human's ten minutes with `node tools/ingest/vocabulary-accept.mjs`, and no agent should do it
alone.

## What a connector is

Five things, and a connector that has fewer is a scraper:

1. **A named real source.** A file on this machine, belonging to a real organisation, at a recorded
   commit.
2. **A reader** that turns it into records carrying provenance and freshness.
3. **A cadence**: how often a person should run it, and why that interval and not another.
4. **A statement of what it can and cannot know.** The second half is longer than the first in every
   connector here, and that is the correct proportion.
5. **An ask and a promise**, written as though the organisation will read them, because eventually
   one will.

All five are declared in `tools/connectors/registry.mjs`, for connectors that are built and for
connectors that are not. `verify.mjs` fails on a connector that says it is built with no module, on
one that is not built with no reason, and on one that promises nothing.

## Running it

```bash
node tools/connectors/sync.mjs                     what is on disk and what is due
node tools/connectors/sync.mjs --list              every connector, built or not, and why
node tools/connectors/sync.mjs --all               run everything
node tools/connectors/sync.mjs --due               only what is past its cadence
node tools/connectors/sync.mjs --id wildlife-rescue --inbox C:/path/to/exports
node tools/connectors/sync.mjs --id noticeboard --dry-run
node tools/connectors/verify.mjs                   the feed gate. Run before committing.
```

Emissions:

```bash
node tools/connectors/emit-day.mjs --date 2026-11-23
node tools/connectors/emit-noticeboard.mjs --day out/emit/day/2026-11-23.json
node tools/connectors/emit-noticeboard.mjs --events
node tools/connectors/emit-rescue-draft.mjs --observation <file.json>
```

## How a feed record becomes pack content

There is one route and it is the existing one. `data/_provenance.json` now declares a `connector`
lane beside the five that were already there, so a promoted batch names where it came from and the
registry check accepts it.

```bash
# 1. Read the feed. It is a JSON file and it is meant to be read by a person.
#    Delete what is wrong. Keep what is right.
# 2. Put what survived into a candidates file, in the shape tools/ingest/promote.mjs expects:
#    { "kind": "ingest-candidates", "lane": "connector", "candidates": [ ...records... ] }
# 3. Promote it. This writes the pack, writes the registry entry, runs the whole gate over the
#    result, and rolls both files back if anything blocks.
node tools/ingest/promote.mjs <candidates.json> --pack <id> --collection <name> --lane connector
```

Feed records carry the full v1 envelope precisely so that step 2 is a copy rather than a
translation. **Nothing in this slice has been promoted.** A machine found the lines; a person
decides what is true, and no person has read these yet.

## The record envelope, plus freshness

Every feed record carries the v1 envelope from `docs/INGEST.md` in full, so a record promoted out of
a feed into a pack needs no reshaping and passes the real gate unchanged. On top of it:

| Field | What it is |
| --- | --- |
| `freshness.synced_at` | The real datetime the connector ran, in the island's offset |
| `freshness.stale_after_days` | How long a record from this source can be believed before it must say so |
| `freshness.source_commit` | The commit of the source checkout that was read |
| `upstream_sources` | The URLs the source itself cited. Two hops, both recorded |
| `location_precision_m` | Present on anything carrying a coordinate. A coordinate with no declared precision reads as exact |
| `handling` | What the reader of this record must do about it |

`source` on a feed record is `feed:<connector>@<sync datetime>`, and `locator` names the file, the
path inside it and the commit, so anybody with that repository can open the exact line.

**Two hops, both recorded.** Most of these sources are the owner's own research repositories, which
cite operator websites. The record cites the repository and carries the website as
`upstream_sources`. Nothing here claims to have read an operator's own page, because nothing here
did, and that is why nothing from the noticeboard connector reaches high confidence.

## The screen

`screenRecord()` in `tools/connectors/lib.mjs` runs over every record before it is written, and
`screenWanted()` runs over every wanted-list entry, which is the same door. A held record is the
connector working, and a held record always says why. The reason never quotes the word that caused
it, for the same reason `tools/ingest/ledger.json` does not: a file that quoted the words it exists
to refuse would be the one file in the repository failing the rule it administers.

It holds a record that:

- carries a token from the prohibition lists in `data/lore.json`, read out of the pack rather than
  restated in code, so a rule QYAC adds is a rule this runs;
- names QYAC or MMEIC next to a word that would read as their view, decision or intention;
- carries a contact detail and cites no published source for it, which executes the events engine's
  own rule about not treating guessed catalogue data as consent;
- is low confidence and marked player-facing;
- still carries an em dash in text taken from a source. Source wording goes through `quoted()`, which
  renders an em dash as a hyphen and records that it did. That is the only substitution made to
  anybody else's words, and it is the same one `tools/ingest/lane-document.mjs` declares.

The screen judges what came out of somebody else's file, not this repository's own explanatory prose.
`PROSE_KEYS` in `lib.mjs` names the fields a connector writes itself. This was the first thing the
check got wrong: a handling note reading "the source itself says to confirm dates" caused a correct
record about a publicly advertised event to be held, because the note contained the word "says" and
the record named MMEIC.

It judges sentences, not identifiers, and that is the second thing it got wrong. `IDENTIFIER_KEYS`
in `lib.mjs` narrows the position-verb rule to prose. The noticeboard connector names a gap
`nb-want-<organisation>`, "want" is a position verb, and the QYAC and MMEIC wanted entries therefore
tripped the cultural rule on a word in their own ids and were held. Held is the safe direction to
fail in and it was still wrong: it quietly took the two organisations off the list of organisations
nobody has asked, which is the one list where hiding a gap does damage. Only that rule narrows. The
prohibition token lists from `data/lore.json` and the em dash rule still read every string in a
record, ids included, and `verify.mjs` self-tests both halves of the narrowing on every run.

### The wanted list goes through it too

This was the hole. The screen ran over records, and the wanted list, which is written into the same
committed file, was pushed on unscreened. So `data/feeds/_noticeboard.json` carried a QYAC entry and
an MMEIC entry with no review flag on either, and the feed gate had nothing to raise, because the
only thing it asked a wanted entry was whether it named somebody who would have to agree. That is a
check that a gap has an owner, not a check that it is safe to publish.

`screenWanted()` does three things to an entry naming a Traditional Owner organisation:

- it drops the source repository's guess about what that organisation might share, because a guess
  about what a body would supply reads as that body's intention;
- it adds a handling note saying what may and may not be added to the entry, and by whom;
- it raises a `cultural_flags` entry so a person reads it before anything is promoted or sent.

The name stays. An organisation nobody has asked is a real gap and hiding the gap would be worse
than naming it. Every feed now carries a `cultural_flags` block, empty when nothing was flagged,
because an absent block and an empty one read the same on a screen and mean opposite things, and
`verify.mjs` blocks a feed that names one of those organisations in a wanted entry that is in no
flag, that still carries the guess, or that carries no handling note. Two entries in the noticeboard
feed are flagged this way and both are in the review queue.

## The connectors

### Wildlife rescue

**Source** `minjerribah-wildlife-rescue`, a local checkout, plus an optional inbox folder.
**Cadence** daily while a case is open, otherwise weekly, run by the rescue coordinator.
**Freshness** 7 days.
**Organisation** Wildlife Rescue Minjerribah.

This is the most valuable connector here and the reason is not technical. Every other source is a
research pass or a listing. This one is a working stream: a free offline app on volunteers' phones,
with a triage tree, an island map, and a sync-by-text format that already carries real reports
between real people through a group chat. Nothing had to be built for the island to start producing
this data.

So the connector reads the format the volunteers already use, rather than asking a volunteer group to
build an export for a simulation. It reads:

- `assets/contacts.js`, the numbers the app tells the public to ring. Published, real, citable.
- `assets/db.js`, the vocabulary: 17 animal groups, 5 conditions, 12 causes, 3 mobility states.
- `lookouts.json`, the keep-an-eye-out board the coordinator publishes by editing one committed file.
- `--inbox <folder>`, whatever a coordinator dropped in: an app export in JSON or CSV, or a text file
  of copied group-chat messages carrying sync codes.

The vocabulary records carry a crosswalk to this twin's own species ids, which is what makes the feed
worth having: a report of a koala hit by a vehicle and the twin's own modelled strike become the same
two words, and the modelled hotspots can finally be checked against real ones.

**What it can know**: the numbers to ring; the vocabulary the island already uses; that a case was
open at the moment somebody exported it; roughly where and roughly when.

**What it cannot know**: whether an animal is still there now, because a report is a moment and not a
state; who reported it; the exact spot; anything about an animal nobody reported, because absence
here is absence of a report; clinical outcome, because the app records condition on arrival and not
what happened at the carer.

**What is thrown away before anything is written to disk**, and this list is the connector:

- reporter name and reporter phone, never, in any file, at any confidence
- free-text notes, because a note is where a private address or a person's name ends up, and no
  amount of screening makes free text safe
- exact coordinates, rounded to three decimal places, about 110 m, before commit. Not filtered at
  display time: `docs/PARTICIPATION.md` is explicit that a runtime filter is one bug away from
  publishing the thing it was hiding
- the exact minute, rounded down to the hour
- a free-text place name, unless it resolves to a place already in `data/places.json`

**What the group is asked**: permission to read the export at all, which is the group's data and not
this project's; a coordinator willing to drop a file into a folder on a schedule; and a ruling on
whether 110 m is coarse enough, from people who know which species on this island are worth hiding a
pin for.

**What the group is promised**: reporter name and phone never enter this repository; coordinates are
rounded before they are written rather than filtered when they are drawn; nothing is ever sent back
automatically; and the feed can be withdrawn, leaving a tombstone that keeps the id and nothing else.

### Noticeboard

**Source** `straddie-noticeboard-network`, a local checkout of `data.js`.
**Cadence** monthly, run by whoever is maintaining the noticeboard network.
**Freshness** 60 days.
**Organisation** the Straddie Noticeboard Network, and through it the organisations it names.

The noticeboard network is a research pass over 164 island organisations, and it is unusually honest
about being one. Its own project block says the entity data is explicitly guessed from a research
directory, that it is a conversation map rather than a claim that any group has agreed to take part,
and that every feed idea needs direct approval before public use. That sentence travels with every
record this connector writes.

The connector splits the source in two, and the split is the whole design:

- **Nine entities carry a researched profile**: a public name, an address, sometimes a phone and an
  ABN, a public status, source notes and source URLs. Those become records, at medium confidence,
  each quoting the source note it rests on.
- **The rest become the wanted list.** They are real organisations and naming them is fine; turning a
  guess about what they might publish into a record in a model of the island is not.

**Two exclusions, applied before anything else.** Individuals: the source has a public-figures
category of 22 people whose own note calls them references rather than assumed participants, and
individual artists appear in other categories too. A person is not a feed, and among the individuals
in that source are Quandamooka artists, where the line this project holds is not a preference. The
test errs toward leaving an entity out; four trading names read as personal names to it and are off
the wanted list because of that, and the feed says so. No record is built from that test: records
come only from entities carrying a researched business profile, and every one of those is an
organisation. Email addresses: the source records some, and none is carried, because a public git
history is a spam harvester and the twin has no use for an email address.

**Hours, and this is the honest answer to the question that started this whole slice.** Not one
organisation in that repository carries confirmed hours, and several say in their own words that
hours need confirming before publishing. So hours arrive as a gap, in the shape `data/businesses.json`
uses for hours, with `basis` null: that pack's own vocabulary offers published, listed and estimate,
and this source reaches none of them. At the sync recorded in the feed, of the 40 organisations this
feed matches to the twin's business pack, 12 have hours the business published itself, 3 have hours a
directory published, and 24 are still opening and closing on an estimate. Those four numbers are
recounted on every sync and written into the wanted list, so the document cannot go stale against the
pack. An estimate is a modelling pattern and is never
shown to a player as fact, which means the twin cannot currently tell anybody whether the bakery is
open on a Tuesday in June. That is the wanted list's first entry and it is the most useful thing in
this document.

**What the organisations are asked**: are these details right, and do you want them in a public model
of the island; and for the nine with a profile, confirm the address and phone, and tell us your hours
if you want them shown. The other 90 on the wanted list are asked nothing yet, because nobody has
asked them anything.

**What they are promised**: no individual is a record; a phone number appears only where the source
recorded where it read it, and only for an organisation; no email addresses at all; and a correction
from an organisation outranks anything in the source repository and is recorded as a correction, not
an overwrite.

### Events engine

**Source** `quandamooka-country-events-engine`, a local checkout of `assets/site-data.js`.
**Cadence** weekly, and always before a wave that touches the calendar, run by a person after pulling
that repository.
**Freshness** 21 days.
**Organisation** the Quandamooka Country Events Engine, and through it the listing sources it names.

This source is different from the others in one way that changes how it must be treated: it is
refreshed. Its git history carries repeated public source refreshes through June and July 2026,
roughly weekly, so a local checkout lags the remote. Every record carries the commit it was read at,
and the sync says plainly when the checkout is older than the cadence and prints the number of days.

It publishes its own freshness and its own honesty flag, and this connector does not invent
replacements for either. `project.lastPublicSearch` and `project.dataStatus` are carried through
verbatim, and the second one caps confidence: while the source calls itself a draft event atlas,
nothing from it reaches high. A twin that computed its own high confidence for a source telling you
it is a draft would be overstating.

**`docs/PUBLIC_BOUNDARY.md` in that repository is treated here as blocking**, on the same footing as
`data/lore.json`. It is the owner's own publication contract for this material, it is closer to the
source than anything this project would have written, and four of its five wording rules are rules
this repository already holds under different names. Where the two differ on this material, that one
wins.

**The cultural line.** Some events in the atlas are cultural events run by or listed through
Quandamooka organisations. This project may list a publicly advertised event exactly as advertised:
its name, its date, its place, and who listed it. It may not carry a programme, a description of what
happens, a protocol, a meaning, or anything a member of an organisation would have had to tell
somebody. So for a cultural record the atlas's descriptive prose, its load tags and its movement note
are all dropped, and the record is flagged for a human. Six of the 39 events are flagged. The match is
on words rather than on a curated list, because a curated list goes stale the moment the atlas is
refreshed and the failure mode of a stale list is a new cultural event arriving with a full
description attached.

One field is renamed on the way in and the rename is not cosmetic. The atlas calls a field `season`
and means a listing grouping: winter school holidays, a festival series. `season` is one of the keys
the gate treats as a cultural position, because the wave 7 fault arrived through exactly such a key,
so it is carried as `listing_period`. A connector writing a listing grouping into a field named
season would be putting words where a seasonal calendar goes.

**What it can know**: that an event was publicly listed, on what date, at what place, by which
listing source; the source's own view of its own currency; which events are confirmed, which are
dates to confirm, which recur and which are past.

**What it cannot know**: whether an event is going ahead; attendance, crowd or load, which are the
twin's own estimates in `data/events.json` and are labelled there as estimates; anything about the
content of a cultural event; whether an organiser wants their event modelled.

## The two refusals

Both are built, both re-read their source every run, and neither lifts its own refusal. A refusal
held in a document is a memory; a refusal that re-reads its source is a check. `tools/ingest/lane-era.mjs`
set this pattern.

### Straddie News: refused

That repository's own footer calls it an internal research document. Its main table is a stakeholder
map, and two of its stakeholders are QYAC and MMEIC, each carrying a characterisation of the
relationship and a strategy for handling it.

Carrying any of that would be this project representing a Traditional Owner organisation's position
and its internal workings, from a document that was not written for publication. That is the one
thing this project may never do. The connector exists so that the next agent who notices the
repository finds the refusal rather than the temptation, and it checks every run whether the
disqualifying material is still there. If it ever stops being there, that is not permission: a human
reads the repository and decides, and until then the refusal stands.

Recorded in `docs/CULTURAL-REVIEW.md` section N.

### Point Lookout Fishing Club: refused, for two reasons

The first is a correction. The brief that asked for this connector described PLFC as a football club
with fixtures and results. It is a fishing club, formed in 2024, and neither `PLFC_Live` nor
`PLFC_2026_Data` holds a fixture, a round, a ladder or a result. Writing that down is most of the
value of the entry, because the next agent will otherwise spend a wave looking for a list that does
not exist.

The second would still stand if the fixtures appeared. What is in `PLFC_2026_Data` is an AGM
dashboard: capacity, shortcomings, remedies, grant readiness, and a comparison against two other
island clubs. That is committee material. A member putting it on a web page for a meeting is not a
club resolution to publish it inside a model of the island, and the noticeboard network's own
publication boundary keeps internal conflict, negotiation and capacity material private for exactly
this reason.

**What the club is asked**: if you want competition dates and public results on the island calendar, a
plain list of dates and a yes is the whole of it, and it would make the twin's weekends real.

## Defined, not invented

Seven organisations with no data in hand. Each has a full registry entry: a cadence, a freshness
limit, what it could and could not know, what is being asked and what is being promised. None has a
reader, and none has a guessed feed. A stub that names what is missing is worth more than a
fabricated one.

| Connector | Organisation | Why it is not built |
| --- | --- | --- |
| `minjerribah-camping` | Minjerribah Camping, a QYAC enterprise | A connector that scraped its booking site would be this project taking data from a Traditional Owner organisation without asking, which `docs/DIRECTION.md` rules out under no surveillance-shaped anything. The route is a conversation. The first question on the review queue comes first. |
| `surf-life-saving` | Point Lookout Surf Life Saving Club | The highest-value unbuilt connector here, and the one where a wrong answer is a safety answer. A twin showing flags up on a day the beach was closed would be worse than a twin showing nothing. Patrol times would be shown as a roster with a sync date, never as a live flag state, and the twin never tells anybody a beach is safe. |
| `mmeic` | Minjerribah Moorgumpin Elders-in-Council | A real organisation that employs people and advertises events. This project may list what it has publicly advertised, exactly as advertised, and that reaches the twin through the events connector as a date and a place. A connector pointed at MMEIC would be a machine for crossing the line, so there is not one. |
| `qyac-rangers` | QYAC Land and Sea Rangers, with Queensland Parks | A ranger closing a track is a publicly reported land management activity and a legitimate connector. The closure is the fact; everything about why and how a burn is done sits on the other side of a line this project does not cross. `docs/CULTURAL-REVIEW.md` B12 holds it. |
| `dunwich-state-school` | Dunwich State School | The value is the rhythm: the bus, the crossing for high school on the mainland, the pupil-free day that empties a township. All of it comes from a calendar of dates and none of it needs a fact about a child, so a connector that could carry one should not exist. |
| `sandy-sports-club` | Sandy Sports Club | The nearest thing on disk is a proposal for how a community-run club might work. Proposed stays proposed: a plan for a club is not a club's fixture list. |
| `little-ship-club` | Little Ship Club, Dunwich | A real club with a real venue and no feed in hand. Listed so the gap is a named gap with a person to ask, which is the difference between a backlog and a guess. |

## What the twin emits

Three emissions, all built, all writing files for a person. Every one carries the seed and the pack
fingerprint, because `docs/DIRECTION.md` calls replay peer review: a claim backed by a replayable run
outranks one that is not, and that only works if the report carries enough to reconstruct the exact
world it ran in.

### A day export

```bash
node tools/connectors/emit-day.mjs --date 2026-11-23
```

Boots the whole simulation headlessly, runs it to a named date, plays the day out, and writes down
what the island was doing: conditions, ferry, visitors, traffic, what the chronicle published, what
events fired, and what went wrong. Two files land in `out/emit/day/`, one for a machine and one for a
person, and every figure names the system that produced it.

Conditions are read at midday and totals at the last hour of the day, and the reason is a known fault
rather than a preference: `docs/STATE-OF-PLAY.md` 4.5 records that the daily counters reset at
midnight, so a probe taken after the roll reports a ferry that carried nobody on a day it carried
hundreds. 23 November 2026 on the default seed is the day the barge loses four sailings to a ramp
hydraulic failure, 361 vehicles still cross and 11 do not get across at all.

### A noticeboard notice

```bash
node tools/connectors/emit-noticeboard.mjs --day out/emit/day/2026-11-23.json
node tools/connectors/emit-noticeboard.mjs --events
```

Writes one markdown file with frontmatter, schema `public_noticeboard.v0`, status
`draft_for_human_review`. That schema and that status word are the noticeboard network's, not ours.
Emitting into somebody else's format rather than inventing one is the whole point of a connector
layer. It carries the six screen shapes the noticeboard defines, the device ids of the five proposed
screens, a table showing where every line came from, and a one-line version for a ticker strip, a
low-power sign or an SMS.

`--events` builds the what-is-on digest for the screen and media network from the events feed, with
the last public search date on the front and a line under it saying what to do about the cultural
listings in it.

**Two refusals, and both are runnable rather than remembered.** A modelled day is never written as
news: every notice built from a simulation carries a standfirst saying so, in the body and in the
frontmatter, and the emitter refuses to write one without it. A tile reading "four sailings
cancelled" over a modelled day would be a false report on a real screen, which is the worst thing
this layer could produce. And nothing goes out uncited: if a figure arrives without a source the
emitter refuses the whole notice rather than dropping the line, because a notice that quietly drops
what it cannot cite is a notice you cannot trust the rest of. It also refuses when the run's pack
fingerprint no longer matches the packs on disk, because then the findings are about a different
island.

### A wildlife rescue draft

```bash
node tools/connectors/emit-rescue-draft.mjs --observation <file.json>
```

Writes a message a volunteer can paste into the group chat, with a compact sync code on the end that
any phone running the wildlife app reads back into a pin on the map. The encoding is copied field for
field from that app's `assets/sync.js`, and before writing anything the emitter decodes its own
output twice: once with our decoder, and once by running the app's own `sync.js` unmodified out of
its checkout. Only the second proves anything, because our encoder was written from that file. It
reports the commit it tested against.

**The guard, and it is the reason this emitter is worth more than the encoder inside it.** This twin
simulates koalas being hit by cars, dozens a year, each with a place, a time and a cause, in exactly
the shape a rescue report takes. Feeding one of those into a real rescue group's chat would be a
false report of an injured animal, and volunteers would drive to it.

| `origin` | What happens |
| --- | --- |
| `simulation` | Refused, always. There is no flag that turns this on, and adding one would be the single worst change anybody could make to this repository. |
| `fixture` | Written, with DO NOT SEND stamped through the message and the filename, so the pipe can be tested end to end without anything sendable coming out. |
| `observation` | Written, once it names the person who saw it and carries their consent, which is per record and purpose-bound. |

`tools/connectors/examples/` holds all three shapes. The real one ships empty on purpose: filling it
in would be fabricating a sighting, a person and a consent, and this repository does not do that. Run
the emitter over it and it lists what is still missing.

## Cadence and staleness

| Connector | Cadence | Stale after | Why |
| --- | --- | --- | --- |
| `wildlife-rescue` | daily while a case is open, otherwise weekly | 7 days | A case moves in hours. A koala on the ground at breakfast is in care or dead by lunch. |
| `noticeboard` | monthly | 60 days | Addresses move a few times a year. The reason to run it monthly is not that the data changes fast, it is that the wanted list needs a person looking at it often enough to go and ask somebody. |
| `events-engine` | weekly | 21 days | The source refreshes its public sources roughly weekly. A stale checkout produces a stale calendar that looks current. |
| `minjerribah-camping` | daily in the peak | 3 days | Occupancy is a daily number in December and a monthly one in June. |
| `surf-life-saving` | seasonal, then weekly | 7 days | The roster is set for a season and amended weekly by weather. |
| `qyac-rangers` | daily in fire season | 3 days | A track closure is a same-day fact. |
| `dunwich-state-school` | each term | 90 days | A school calendar is set a term at a time. |
| `little-ship-club` | monthly | 45 days | Club calendars move monthly. |
| `sandy-sports-club` | weekly in season | 14 days | A fixture list is a weekly rhythm. |

`node tools/connectors/sync.mjs` with no arguments prints what is due. `freshnessAt()` turns a sync
stamp into `fresh`, `ageing` or `stale`: fresh to a third of the limit, ageing to the limit, stale
past it. There is a fourth word, `unknown`, for a record with no stamp and for a moment earlier than
the stamp, and no fifth word anywhere.

## What the twin does with this, on screen

`src/world/freshness.js` is loaded by the browser and by node, and it is the only implementation.
The interface calls it in one place so far, and that place is the business card in the inspector,
which is where the island's opening hours are read.

- The age of a check is counted against the clock's declared moment. The sentence that carries it
  names which clock: "Checked 42 days ago and ageing, counted against the island's own clock, which
  is simulated and started from a moment on its record." Press live and the same card reads "Checked
  today, counted against the real Queensland moment, which is what this clock shows while it is
  live", because in live the island's clock is the real Queensland moment.
- Scrub the view back past the day somebody looked and it says so rather than pretending: "checked
  on 2026-08-10, which is later than the moment on screen."
- A published or listed set of hours that has gone past a third of its shelf life carries a chip on
  the card reading **hours ageing**, and past the limit **hours stale**. In the word, not in a
  colour alone. The chip is bound rather than stamped once, so pressing live cannot leave a chip
  reading "hours ageing" beside a sentence reading "checked today".
- An estimate gets no freshness chip at all, because there is nothing published underneath it to
  have gone off. That card says something better instead: nobody has published hours for this place,
  somebody went looking on a named date, and they found nothing.

The shelf life for an opening hour is 90 days, declared in `STALE_AFTER_DAYS` in that module with
its reason: an island business changes its hours with the season and there are four of them, so a
check older than one season is a check that has not seen the season the player is standing in. It is
policy rather than measurement and it is written where it can be argued with.

## The freshness policy, stated as a rule for whoever renders one of these

1. **Nothing from a feed is drawn without its sync date beside it.** Not in a tooltip, not behind a
   click. Beside it.
2. **A stale record says it is stale**, in words, where the record is drawn. Not a colour alone.
3. **A rescue record describes a moment, never a state.** "Seen 3 days ago" is honest. "There is a
   koala here" is not.
4. **An opening hour is never shown without its basis.** Published, listed or estimate, in the
   business pack's own three words. An estimate is a modelling pattern and never reaches a player as
   fact.
5. **A cultural listing is drawn as a date, a place and who listed it.** Nothing else, ever, from this
   layer.
6. **Absence in a feed is absence of a record, not absence of the thing.** An empty lookout board
   means nobody is currently watching for an animal. It does not mean there is no animal.

## What a source organisation is being asked for, and promised

Written as though the organisation will read it.

**We are asking for less than you might expect.** Every connector here takes the narrowest thing that
would do the job: a list of dates, a roster of hours, an export with the names already stripped. None
of them wants your members, your bookings, your finances or your minutes, and the ones that could not
avoid touching those are not built.

**Here is what happens to what you give us.** It becomes a record in a committed file in a public
repository, carrying where it came from, when it was read, and how confident we are in it. It is
checked by a gate that runs every time, and the checks are readable: they are in
`tools/connectors/verify.mjs` and `tools/gate-audit.mjs` and you can run them yourself. Nothing goes
in that cannot say where it came from.

**Here is what we will not do.** We will not scrape you. We will not infer your position on anything.
We will not put an individual in this repository as a record. We will not carry an email address. We
will not publish a coordinate at a precision that could put somebody at a nest, a den or a front
door. We will not show a player anything we are not confident in. And the twin will never send
anything to anybody: everything it produces for you is a file that a person has to read and decide
about.

**You can change your mind.** Withdrawal is honoured at the next release through a tombstone that
keeps the id with a withdrawn marker, so the record disappears honestly rather than silently. And the
truth about the medium: a public git history persists, so revocation after publication is
best-effort, and anything that might one day need full erasure should not be given to us in the first
place.

**Two organisations are treated differently and it is deliberate.** QYAC and MMEIC are real
organisations that exist, employ people, hold responsibilities and advertise events publicly. This
project lists what they have publicly advertised, exactly as advertised, and nothing else. It does not
represent their views, their decisions, their internal workings, or anything a member would have had
to tell us. QYAC has not seen this project. `data/lore.json` records that its view on this existing at
all is unknown, and `docs/CULTURAL-REVIEW.md` A1 is the first question on the queue and stands over
everything in this document.

## What is not built, and is not pretending to be

- Any scheduled runner. A cadence is a sentence in a registry and a line in a terminal. Nobody has
  wired a scheduled task, and doing so is a decision about somebody's machine.
- Any feed drawn in the running twin. The freshness vocabulary is now shared with the interface and
  the inspector uses it against the clock, but what it dates is `data/businesses.json`, a committed
  pack, not a feed. No feed record has been promoted, so there is nothing from a feed on screen to
  date. When there is, the fields are already there: `freshness.synced_at`, `stale_after_days`,
  `source_commit`, and the six rules above.
- The rest of the interface. Only the business card calls `checkedPhrase()`. The chronicle, the
  events panel and the how-it-works panel all show dates somebody checked and none of them says what
  it counted against yet.
- Promotion of any feed record into a pack. `tools/ingest/promote.mjs` is the route and it needs a
  person to read the candidates first. Nothing here has been promoted.
- Reading the noticeboard's markdown notice format inward. This layer writes that format and does not
  yet read it, so a notice an organisation writes cannot yet come back into the twin. That is the
  obvious next connector and it needs no permission from anybody, because the schema is already
  published.
- Anything at all for the seven organisations above.

## The source ladder, and why weather must not be a two-way switch

Added 14 August 2026, while the weather connector was being written, because the owner said what comes
next: **their own weather stations, video camera feeds of the beaches, and drone reports.**

That is the island observing itself, and it outranks anything this project can pull off the internet.
So do not write `live ? openMeteo : model`. Write a **ranked ladder**, resolved per field, per moment,
with the winner named on screen. Adding a station on the roof of the surf club then becomes a data
change and not a code change, which is the whole point.

The ladder, best first. Each rung answers for a field, not for the whole of weather:

| Rung | Source | What it is | Beats the one below because |
| --- | --- | --- | --- |
| 1 | **Island instrument** | a station, a gauge, a camera at a real place on the island | it is the actual thing, here, now |
| 2 | **Official observation** | a Bureau station reading via their registered data service | measured, but not on this island |
| 3 | **Model** | Open-Meteo, CC-BY, model output for this location | real physics, not a reading |
| 4 | **Synoptic simulation** | `src/systems/environment/weather.js` | the only rung that can answer for a moment that has not happened |

Rules that hold for every rung:

- **Per field, not per source.** An island station may have wind and no swell. Take the wind from rung
  one and the swell from rung three, and say so for each. A single "source: Open-Meteo" line over a
  panel where half the numbers came from somewhere else is a lie of omission.
- **Freshness demotes.** A rung one reading an hour old loses to a rung three reading from ten minutes
  ago, for rain. For temperature it does not. Freshness thresholds are per field and are a judgement
  worth writing down rather than a constant.
- **The rung is visible.** Not a footnote. A resident looking at wind speed should be able to see
  whether that came off a mast at Point Lookout or out of a model, because they will trust the two
  differently and they are right to.
- **Rung four never wins in live mode.** If every real rung has failed, the honest answer is that the
  twin does not know, not a simulated number wearing a live badge.
- **Determinism is unaffected.** All of this is ingest. A seeded run with no feeds uses rung four and
  produces exactly what it always produced.

### The three things coming, and what each needs

**Island weather stations.** The easy one, and the one to design for first because it validates the
ladder. A station writes the same record shape as the Open-Meteo connector with `rung: 1` and its
location. Worth noting that the Bureau's own Weather Observations Website accepts citizen station data,
so a station on the island can be both a source for this twin and a public contribution, which is the
participation loop closing without anybody building anything new.

**Beach cameras.** The valuable one and the one with the real problem. A camera pointed at a public
beach records identifiable people, and a public twin republishing that stream is a different act from a
surf club watching its own water. Before any camera feed is connected, that question gets answered, not
assumed. Established practice exists and is worth following: low resolution, wide framing that does not
resolve faces, stills at an interval rather than continuous video, and no recording retained. What the
twin actually needs from a beach camera is mostly **derived**: is the bank open, how big is the shore
break, how full is the car park, are there people in the water. A number extracted on the device and
sent as a number is better than a picture sent to a server, on privacy and on bandwidth, and it is the
design to aim at. `docs/PARTICIPATION.md` and the `O` and `I` faces in `githublocal/aura-horn-torus`
already carry the boundary this needs.

**Drone reports.** These are not a weather source, they are capture, and they belong in the chain in
`githublocal/aura-scan-pipeline/docs/ZERO-POINT-CAPTURE.md` rather than here. A drone is another device
with a session, a frame and a scale reference, at a better altitude. The one thing it adds that a
phone cannot is repeat coverage of somewhere nobody walks: the Amity erosion face, the dune blowouts,
Eighteen Mile Swamp. Coastal change over time is exactly what this twin models and cannot currently see.
Rules and permissions for flying are a real constraint and go in that document, not this one.
