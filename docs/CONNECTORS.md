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
committed files off its own origin at boot and nothing else, ever, and any design that puts fetch,
XHR or a websocket in the simulation or render loop is wrong.

This used to be stated as "nothing in `tools/connectors/` opens a socket", which was true when every
source was a checkout of somebody's repository on this machine, and is not true now. Nobody keeps the
weather in a git repository. `tools/connectors/weather.mjs` calls two named Open-Meteo hosts and
nothing else, when a person or a scheduled job runs it, and writes the same kind of stamped file
everything else here writes. That is the same shape `tools/ingest/lane-legislation.mjs --fetch`
already had for the two legislation registers, and the rule that matters is untouched: what an
offline step means is that the fetching happens when a person runs it and ends in a committed file,
not that no socket is ever opened anywhere in the repository. `--inbox` reads two saved responses off
disk instead, for a machine with no network. `fetch` appears in exactly one file in that directory.

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
node tools/connectors/sync.mjs --id weather        fetches the two Open-Meteo endpoints
node tools/connectors/sync.mjs --id weather --inbox C:/path/to/saved   reads them off disk instead
node tools/connectors/verify.mjs                   the feed gate. Run before committing.
```

The weather one is the only command here that needs a network, and it is the one to put on a
schedule: it is the only feed the running twin reads directly, and everything it carries goes off
within hours.

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

### Weather

**Source** Open-Meteo, two endpoints, over the network.
**Cadence** hourly while anybody is looking at a live island, and before any session that opens in live.
**Freshness** per field, in minutes, from 25 for rain to 720 for ground swell. See below.
**Organisation** Open-Meteo. **Licence** CC BY 4.0, and the attribution is a condition rather than a courtesy.
**Rung** 3 of the ladder at the end of this document.

The correction that produced this connector was one sentence: **it is not much of a twin if the
weather is not real.** That is right, and the earlier answer, which was to keep the synoptic
simulation and put a label on it, was the correct answer to a question nobody had asked. Labelling is
what you do for a moment that has not happened. For a real island opened at the real moment, invented
weather is a demonstration wearing a twin's clothes.

**This is the only connector here that opens a socket, and it is still an offline step.** There is no
local checkout of the weather, so it fetches, from two named hosts and nothing else, when a person or
a scheduled job runs it, and writes the same stamped file every other connector writes. The rule that
does not bend is about the running twin, and it is untouched: the twin loads that file off its own
origin at boot and never touches a network. `tools/ingest/lane-legislation.mjs --fetch` already had
this exact shape for the two legislation registers. Run it with `--inbox <folder>` and it fetches
nothing at all, reading `open-meteo-forecast.json` and `open-meteo-marine.json` off disk instead, so a
machine with no network still syncs. The header of `tools/connectors/lib.mjs` used to say that nothing
in that directory ever opens a socket; that sentence has been corrected rather than quietly falsified,
because a claim a repository makes about itself and does not keep is the fault this project keeps
finding.

**The marine endpoint is the find.** Wave height, period and direction for the ocean side is the
number that decides whether the Gorge is spectacular or shut, and no other free source hands it over
without a key. It also splits the sea into a total and a long-period swell partition, and this twin
keeps both apart rather than averaging them away: `swellM` is the total, because the total is what
shuts a beach and shortens the drivable window, and `groundSwellM` is the long-period component
underneath it, which is what makes the walk worth it. This twin's own model produces no ground swell
at all, so that field is null in simulated time rather than filled with a number nothing stands behind.

**Say model, never observed.** Open-Meteo is model output for a grid cell. It is not a reading from
an instrument at Point Lookout, and the difference is not pedantry: the response names its own
coordinates and they are not the ones in the request. At the sync recorded in the feed the land cell
came back **11.2 km** from Point Lookout, at 43 m elevation, and the marine cell **3.6 km** off it.
The connector measures that distance every run and writes it onto the record as
`location_precision_m` with a sentence saying what it means. A twin that hid it would be claiming a
precision it has not got.

**Freshness is per field and the day is the wrong unit.** An hour-old temperature is fine, because
air follows the sun and takes hours to move. An hour-old rain reading is worth nothing, because rain
here arrives in cells that cross a township in twenty minutes. So the shelf life sits on the field,
in `OBSERVATION_STALE_AFTER_MINUTES` in `src/world/freshness.js`, which the connector and the twin
both read so there is one table and not two. Each entry carries its reason:

| Field | Minutes | Why |
| --- | --- | --- |
| rain | 25 | Rain arrives in cells. Half an hour is a wet road or a dry one. |
| gusts | 45 | The peak over its interval, and the number a barge master reads. |
| wind speed and direction | 90 | The nor'easter builds and drops over about two hours. |
| cloud | 90 | Makes and clears in an hour on a storm day. |
| temperature, apparent, humidity | 180 | All follow the sun, slowly. |
| pressure, wave height, period, direction | 360 | Synoptic and sea-state scale. |
| ground swell height, period, direction | 720 | Generated a long way offshore, and slow to change character. |

Those numbers are the demotion mechanism, not a second rule beside it. A rung one reading an hour old
is already outside its twenty-five minutes for rain and loses to a fresher model figure, and is
comfortably inside its three hours for temperature and still wins. The example in the ladder section
below falls out of the table rather than needing code of its own, and
`tools/connectors/weather.mjs` and `src/systems/environment/weather.js` share it.

**What it can know**: what a named weather model has for the two grid cells nearest this island, at a
stamped moment; wave height, period and direction on the ocean side, and the swell partition
separately; how far the cell it answered for sits from the place asked about.

**What it cannot know**: anything observed, because nothing here is a reading; the difference between
one end of a 27 km island and the other, because two cells answer for all of it; the weather at any
moment the island has not lived through, which is why simulated and scrubbed time get the synoptic
model and say so; and whether it rained, exactly. The source returns a precipitation total and stamps
it with an interval, and this connector reads it as the sum over the preceding hour because that is
how the current-weather aggregation is documented. The interval is carried on the record so the
reading can be checked rather than assumed, and the conservative direction was chosen deliberately:
reading an hourly sum as a quarter-hourly rate would overstate rainfall fourfold.

**What Open-Meteo is asked**: nothing beyond what the licence already grants.
**What it is promised**: the attribution it requires appears on screen beside the numbers and not
only in a file; every figure carries the moment it was modelled for as well as the moment it was
fetched; and a reading past its own shelf life stops being used rather than sitting there looking
current.

## The three refusals

All three are built and none lifts its own refusal. Two of them re-read their source every run,
because a refusal held in a document is a memory and a refusal that re-reads its source is a check.
`tools/ingest/lane-era.mjs` set that pattern. The third cannot, and the reason it cannot is the
reason it refuses.

### The Bureau of Meteorology's internal weather interface: refused

**Recorded here so that nobody rediscovers it and assumes nobody looked.** `api.weather.bom.gov.au`
works. Point Lookout has its own geohash on it, `r7j5vwr`. It would give this twin better weather
than anything else free. It was tested on 14 August 2026 and it is refused, on two grounds, and the
second one is the durable one.

The first: every response carries a notice from the Bureau stating that it owns the interface and
that **you must not use, copy or share it.** That is the owner of the data saying no, inside the
payload, to the person reading it. This repository is public.

The second would still stand if that notice were withdrawn tomorrow. It is an undocumented internal
interface, and a public repository cannot cite one. Every rule this project holds about weather comes
back to the same place: a figure a player sees has to be able to say where it came from, and a figure
whose source is an internal endpoint that nobody has published a contract for cannot. A twin that
could not cite its own weather would be worse than a twin with no weather.

**This is the one refusal in the layer that cannot re-read its own evidence**, and
`checkBomWeatherApi()` in `tools/connectors/refusals.mjs` says so rather than pretending otherwise.
The evidence sits inside a response, and fetching the response is the act being refused. So that
check fetches nothing, states what a person found and when, and names the second ground, which needs
no fetch to hold.

**The upgrade path, which is the owner's decision and not an agent's.** The Bureau's registered data
services are the sanctioned route to actual station observations, and they are what rung 2 of the
ladder below is waiting for. Written down so the decision can be made rather than rediscovered:

*What registering would get.* Measured readings from actual instruments, rather than model output for
a grid cell some kilometres away. On the ladder that is a move from rung 3 to rung 2 for every field
a station carries, and it is the difference between "a model has this for the coast" and "an
instrument recorded this". For wind on the crossing, which is the one number where being wrong is a
safety answer, that difference is the whole thing.

*What it would cost.* Not established here, and deliberately not guessed. The Bureau operates
registered and licensed data services whose terms and fees depend on which products are wanted and
what they are used for, and they are agreed rather than published as a price list, so the honest
entry is that somebody has to ask. Two things are worth knowing before anybody does. The Bureau also
runs a public FTP service carrying a range of observation and forecast products, which may cover what
this twin needs at no cost at all and should be checked first. And registering means identifying this
project and agreeing to terms on its behalf, which is exactly why it is the owner's call.

*What is not established and would be part of the work.* Which station or stations actually serve this
island, and how far each is from the places the twin draws. No station identifier is written down
here, because guessing one produces a confident citation of the wrong instrument, which is the
failure mode `tools/ingest/lane-legislation.mjs` exists to prevent for Act numbers and the same
discipline applies here.

*And the direction nobody has to wait for.* The Bureau's Weather Observations Website accepts data
from citizen stations. A station on this island could be a rung 1 source for this twin and a public
contribution at the same time, which closes the participation loop without anybody building anything
new. That is rung 1 arriving from the island rather than rung 2 arriving from a registration, and it
is the cheaper of the two.

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
| `weather` | hourly while anybody is looking at a live island | per field, 25 min to 720 min | The day is the wrong unit for weather and one number is the wrong shape. See the table in the weather section above. |

`node tools/connectors/sync.mjs` with no arguments prints what is due. `freshnessAt()` turns a sync
stamp into `fresh`, `ageing` or `stale`: fresh to a third of the limit, ageing to the limit, stale
past it. There is a fourth word, `unknown`, for a record with no stamp and for a moment earlier than
the stamp, and no fifth word anywhere.

`observedAt()` is the same four words and the same thirds rule counted in minutes, for a reading
rather than a record. It exists because weather forced the question and it is not weather's alone:
anything measured rather than researched will want it. A connector on an hourly cadence is always
due, which is why `cadenceDays()` answers nought for one, and that is the honest answer rather than
a fraction rounded to something.

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
- ~~Any feed drawn in the running twin.~~ **This changed with the weather connector, and it is the
  one exception, declared rather than granted quietly.** `data/feeds/_weather.json` declares
  `runtime_read: true`, the feed index carries that flag up, and `src/world/data.js` loads the index
  and whatever declares it at boot, off the page's own origin, exactly as it loads packs. Two fetches
  deep and no further, and nothing at runtime.

  What that exception buys is narrow, and the boundary is the point. A weather feed is **never
  promoted into a pack** and never becomes a fact about the island. The promotion queue is the right
  gate for a claim that will sit in a pack for years and the wrong one for a measurement with a shelf
  life of twenty-five minutes: by the time a person had read a rain figure it would be worthless. So
  an observation takes a different road with a lower ceiling. It is drawn only with the moment it is
  for and the rung it came off beside it, it is used only while it is inside its own shelf life, and
  it vanishes from the interface the moment it is not, which is a stricter treatment than any pack
  record gets.

  The flag lives in the index rather than in a list inside the loader so that a weather station on
  the surf club roof is a data change, per the ladder at the end of this document. Every feed written
  before this carries no flag and is therefore not loaded, which is the right default.
- The other three feeds on screen. `wildlife-rescue`, `noticeboard` and `events-engine` are still
  staging and still go through a person and `tools/ingest/promote.mjs`. Nothing from any of them has
  been promoted, so there is still nothing from those on screen to date.
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

**It is built.** The ladder is implemented once, in `src/world/observations.js`, which node loads out
of `tools/connectors/lib.mjs` and the browser loads out of `src/systems/environment/weather.js`, for
the same reason `src/world/freshness.js` crosses that line: two copies of a ladder is two ladders.
A connector stamps a rung onto every record it writes and the twin ranks by it.

The ladder, best first. Each rung answers for a field, not for the whole of weather:

| Rung | Source | What it is | Beats the one below because | Built |
| --- | --- | --- | --- | --- |
| 1 | **Island instrument** | a station, a gauge, a camera at a real place on the island | it is the actual thing, here, now | no source yet. The ladder reads one the day one exists |
| 2 | **Official observation** | a Bureau station reading via their registered data service | measured, but not on this island | no. Registering is the owner's decision, written up under the refusals above |
| 3 | **Model** | Open-Meteo, CC BY 4.0, model output for this location | real physics, not a reading | **yes**, `tools/connectors/weather.mjs` |
| 4 | **Synoptic simulation** | `src/systems/environment/weather.js` | the only rung that can answer for a moment that has not happened | yes, and unchanged |

Adding rung 1 is genuinely a data change and this is the whole of it: write a feed whose records
carry `rung: 1`, a `readings` array of `{ field, value, unit, stale_after_minutes }`, an
`observed_at`, and `runtime_read: true`. Nothing under `src/` is edited. A check of that is in the
repository rather than in this sentence: a test station carrying wind and rain, both an hour old,
takes wind off the model and loses rain to it, because ninety minutes and twenty-five minutes are
what the shelf lives say.

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
- **The rung is visible**, and here is where. Every weather figure in the bar's tooltips carries its
  own rung, provider and age, per field: "9 kt (model, Open-Meteo, 5 min ago)". The attribution
  CC BY 4.0 requires sits on the same tooltips, because the licence is a condition and a file is not
  the interface. The Today screen's conditions block changes its own chip with the rung, reading
  **A weather model** at rung 3, **Measured** at rungs 1 and 2, and **A simulation** at rung 4.
- **Rung four never wins in live mode.** If every real rung has failed, the honest answer is that the
  twin does not know, not a simulated number wearing a live badge. On screen that field reads **not
  known**, in the word and not in a colour alone, and the tooltip says which reading went off and
  after how long.

  **And the honest wrinkle, because it took a decision.** The island cannot stop living when a feed
  goes stale. The dunes, the fire index, the ferry, the koalas and the residents all need a wind
  speed on every tick, and pausing the simulation because a rain figure aged out would be a worse
  falsehood than the one being avoided. So rung four keeps producing numbers underneath and the twin
  simply stops offering them as answers about the real island: `notKnown` lists those fields,
  `knows(field)` is how a panel asks, and every surface that draws one of them has to ask. Rung four
  never wins the question. It only keeps the world turning while nobody can answer it.
- **Determinism is unaffected**, and this is checkable rather than asserted. Every ladder branch is
  gated on the clock declaring live, so a seeded run resolves nothing, allocates nothing and consumes
  the random stream in exactly the order it always did. `describe()` gains its `source` key only when
  a real reading is actually in force, so the fingerprint `node tools/headless.mjs --determinism`
  prints is the same one it printed before the ladder existed.

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
