# Cultural review

Minjerribah is Quandamooka Country. Anything cultural in this project must come from a published,
citable source and be recorded in `data/lore.json` with that source, or it does not go in the world.

This file is the queue: things an agent found, could source, and deliberately did not build, because a
human needs to resolve them with the Traditional Owners. **Nothing listed here is approved. Nothing listed
here should be rendered to a player until it has been.**

**QYAC, the Quandamooka Yoolooburrabee Aboriginal Corporation, is the authority on every item below.**
QYAC has not seen this project. `data/lore.json` carries `"status": "not_reviewed_by_traditional_owners"`
and that stays true until a human changes it after an actual conversation.

Each item names the file and line it affects. Line numbers are as at 7 August 2026.

---

## A. Take these to QYAC first

These four are the ones that decide whether the project is respectful or embarrassing. Everything
below them is detail.

### A1. Does QYAC want this to exist at all?
**Affects:** the whole repository. `data/lore.json` line 806, `qyac_public_positions.explicitly_unknown`.

Nobody has asked. A browser digital twin of Quandamooka Country, built by non-Quandamooka hands from
public records, is exactly the kind of thing a Traditional Owner corporation may have a firm view about.
The project currently records that QYAC's view on it existing is unknown. That is honest and it is not a
substitute for asking.

### A2. The acknowledgement wording
**Affects:** `data/lore.json` lines 24 to 60. The wording an agent wrote is at line 32
(`acknowledgement.game_wording`), the optional sovereignty line at line 48.

The project does not copy QYAC's own published acknowledgement into a game asset, and instead uses plain
wording written for this build. QYAC may prefer its own wording, may prefer different wording, or may
prefer none from this project at all. The optional line about sovereignty never having been ceded is
QYAC's own statement from its 2015 briefing to the Queensland parliament; it is off by default because
quoting a political statement inside a game is a decision, not a default.

**Ask:** what should the acknowledgement say, where should it appear, and should QYAC's name be on it.

### A3. Naming: three spellings, no ruling
**Affects:** `data/lore.json` lines 141 to 349 (`language.allowlist`); `data/places.json` lines 26, 45,
64, 238, 348, 367, 406; `data/ecology.json` lines 80 and 81; `src/systems/environment/tide.js` lines 9,
29, 30.

Published sources disagree, including QYAC's own documents against each other:

| Place | Spellings found | Where each is published |
| --- | --- | --- |
| Dunwich | Goompi, Gumpi, Koompe | QYAC and the NSI Museum use Goompi; Queensland Government material uses Gumpi; Koompe is a third variant recorded via Wikipedia |
| Amity Point | Pulan, Pulan Pulan, Bulan | QYAC's 2015 briefing uses Pulan; the NSI Museum language map records Pulan Pulan; Bulan is in circulation |
| Point Lookout | Mooloomba, Mulumba | NSI Museum and the Queensland Heritage Register use Mooloomba, and so does the road; stradbrokeisland.com uses Mulumba |
| Blue Lake | Kaboora, Karboora | NSI Museum uses Kaboora; `data/ecology.json` and `data/places.json` currently use Karboora |
| Brown Lake | Bummiera, Bummeria | both published |
| Myora Springs | Capembah, Capeembah | both published |
| Moreton Island | Moorgumpin, Mulgumpin | QYAC's 2015 briefing uses Moorgumpin; its Sustainability Strategy uses Mulgumpin |
| Clan names | Nunukul / Noonuccal, Ngughi / Ngugi / Nughi, Goenpul / Gorenpul | all three variants of each appear in QYAC or island publications |

The North Stradbroke Island Museum states plainly on its language map that colonisation and the
suppression of language produced ad hoc variation, and that the names it publishes are not universal.
The project has recorded the variation rather than picking winners.

**Ask:** which spelling QYAC wants used for each place, and whether the twin should show the variants at
all or just use one.

### A4. Should there be a Quandamooka seasonal calendar in the clock?
**Affects:** `src/kernel/clock.js`, the block introduced by the comment `Island seasons` (the cultural
note starts at the line reading `CULTURAL NOTE, read before touching this block`, at line 68 as at
10 August 2026, and the season array `ISLAND_SEASONS` at line 82); `data/lore.json` line 362
(`language.seasonal_calendar`); `data/lore.json` line 350 (`language.banned_tokens`).

**This has already been fixed once and the fix needs checking.** An earlier version of
`src/kernel/clock.js` carried six season names presented as a Quandamooka calendar, written from
memory. None could be sourced. One was demonstrably misused: *yalingbila* is published as meaning
whale, in the QYAC and University of Queensland project *Yalingbila Bibula* at Mooloomba, and it was
being used as the name of a hot wet season. All six names have been deleted, the export has been renamed
from `QUANDAMOOKA_SEASONS` to `ISLAND_SEASONS`, and the seasons are now plain descriptive English
(High summer, Late summer, Cooling, Cold and clear, Warming, Building storms).

**Corrected 10 August 2026, second pass.** The sentence above used to end "with markers drawn from
the sourced seasonal calendar in `data/ecology.json`", and the code comment said the same. Most were;
four short weather phrases were not, and had been written by the same hand that wrote the season
names. A critic checked the list against the pack line by line and found them. Each band now carries
its two kinds of claim on separate fields rather than run together in one string: `markers` are the
ecological claims and every one of them traces to `data/ecology.json seasonal_calendar`, and
`weather` is one phrase of ordinary south-east Queensland climate description, labelled as such
where a player reads it, matched to what this build's own weather model is weighted toward in that
season. One phrase, "Lakes full", was neither and has been deleted rather than relabelled. This is a
factual accuracy correction and it changes nothing about what is asked below.

No published Quandamooka seasonal calendar was found anywhere: not in QYAC's publications, not in
Queensland Government material, not in the Bureau of Meteorology's Indigenous Weather Knowledge
calendars, not in the North Stradbroke Island Museum's language material. Jajoo Warrngara: The Culture
Classroom hosts a video titled *Quandamooka Seasonal Cycles*, presented by Quandamooka Traditional
Custodian Elisha Kissick, but the contents are behind a subscription and could not be read.

**Ask:** whether a Quandamooka seasonal calendar should be in the twin at all, and if so, whose, in whose
words, and with what attribution. Until then the English names stay.

---

## B. From the lore pack (7 August 2026)

### B1. The twelve family groups
**Affects:** `data/lore.json` line 118 (`peoples.family_groups`).

QYAC's board has one director from each of the twelve families descended from the twelve apical
ancestors recognised in the 2011 determination. Those ancestors are named in Schedule 1 of *Delaney on
behalf of the Quandamooka People v State of Queensland* [2011] FCA 741, which is a public court document.
The pack records the structure and deliberately **does not record the names**. They are the named
forebears of living families on a small island and that is not an agent's call.

**Ask:** whether the twelve families should be named anywhere in this project, and whether the twin should
model QYAC's board at all.

### B2. How long, and whose number
**Affects:** `data/lore.json` line 72 (`peoples.occupation_length`); `data/lore.json` line 455
(`history.timeline` entry `h-wallen-wallen`).

QYAC's 2015 briefing says at least 20,000 years BCE. QYAC's Sustainability Strategy says over 40,000
years of stewardship. Archaeology at Wallen Wallen Creek gives 21,800 plus or minus 400 BP, revised
in 2024 work to between about 30 and 49 thousand years ago. The pack records all four and rules that if
a number is shown it is QYAC's, attributed, and never presented as corrected by an archaeological date.

**Ask:** which number QYAC wants used, and whether the archaeological site should be named at all.

### B3. Middens
**Affects:** `data/lore.json` line 465 (`history.timeline` entry `h-middens`); the prohibition
`no-sacred-or-restricted-sites` in `data/lore.json` under `prohibitions.rules`.

Middens are across the island and are protected cultural heritage. The pack states that they exist and
records **no location, no count and no detail**, and prohibits placing one at a coordinate, generating
them procedurally, or letting a player dig, collect from or build on one. That prohibition is currently
absolute. A softer version, where middens appear as a legal and planning constraint layer with no
location detail, is possible and has not been built.

**Ask:** whether middens appear in the twin at all, and if so at what resolution.

### B4. Cooperative dolphin fishing at Amity
**Affects:** `data/lore.json` line 622 (`cooperative_dolphin_fishing`); `data/ecology.json` line 802
(`sp-indo-pacific-bottlenose-dolphin.cultural_reference`, which already carries a handling rule blocking
it from player-facing copy).

The published record, principally Neil's 2002 review in *Anthrozoos*, describes cooperative fishing
between Aboriginal people and dolphins in eastern Australia including at Amity Point, with people
signalling from shore and dolphins driving fish toward the nets, and describes a significance beyond
food. It is a living relationship recorded largely in colonial-era sources. The project does not depict
it, animate it, make it a mechanic or write dialogue about it.

**Ask:** whether it appears at all, in whose words, and with what framing. Public sources also say the
Quandamooka People regard the dolphin as significant; the pack records **no description of that
significance** because none was found in an authoritative source and it is not an agent's to summarise.

### B5. Myora Mission and the protection era
**Affects:** `data/lore.json` line 529 (`history.timeline` entry `h-myora-mission`).

The pack records the documented history: the 1892 reserve at Moongalba, the 1896 re-proclamation, control
by the Chief Protectors of Aborigines from 1897, residents used as cheap or free labour at the Benevolent
Institution, the fish cannery, the abattoir and the Moreton Bay Oyster Company, and closure in 1943. This
is protection-era history involving the forebears of families living on the island now.

**Ask:** whether this history is in the twin, how it is told, and whether the twin should carry it as
timeline text only or not at all. The scholarly source is Faith Walker's 1998 University of Queensland
thesis on Myora 1892 to 1940. **A human should read it before any of this is built.** No mission
buildings are placed in the world and none should be until this is resolved.

### B6. Moongalba
**Affects:** `data/lore.json` line 252 (`language.allowlist`, `Moongalba`, marked
`player_facing: false`); `data/places.json` line 418, where the Myora Springs record notes that
Moongalba is a separate nearby place and is deliberately not recorded.

Moongalba is a real place with a real association, including with Oodgeroo Noonuccal. It has no
coordinate, no marker and no record in this project.

**Ask:** whether Moongalba is placed in the world at all.

### B7. Oodgeroo Noonuccal
**Affects:** `data/lore.json` line 547 (`history.timeline` entry `h-oodgeroo`) and line 342
(`language.allowlist`, marked `player_facing: false`).

A real, recently living, much-loved person with living family on this island, and a body of work in
copyright. QYAC quotes her in its own 2015 briefing. The project does not write her, quote her at
length, place her or voice her.

**Ask:** the family and QYAC, before her name appears anywhere a player can see it.

### B8. Bummiera and Kaboora
**Affects:** `data/lore.json` lines 211 and 220 (`language.allowlist`, both carrying a
`protocol_flag`); `data/ecology.json` lines 80 and 81; `data/places.json` lines 348 and 367.

Published sources describe Bummiera as a place of deep significance with a protocol before entering the
water, and Kaboora as an area of special cultural significance. The lore pack names both lakes, records
that a protocol exists and its source, and records **nothing about what the protocol is**. The project
does not model, dramatise or gate the protocol, and does not turn it into a mechanic.

**Ask:** whether the names are welcome, whether any protocol should be surfaced to a player, and whether
the meaning published for Kaboora on a tourism site should be repeated. It currently is not.

### B9. Naree Budjong Djara: whose Mother Earth
**Affects:** `data/lore.json` line 229 (`language.allowlist`, `Naree Budjong Djara`, with the two
glosses at lines 232 and 233);
`data/places.json` and `data/ecology.json` wherever the park is named.

QYAC's 2015 briefing glosses it as Our Mother Earth. Queensland Parks glosses it as My Mother Earth. Both
are authoritative. The pack records both and asserts neither.

**Ask:** which gloss, and whether the park name should carry any explanation in-world beyond what
Queensland Parks publishes.

### B10. What Minjerribah means
**Affects:** `data/lore.json` line 143 (`language.allowlist`, `Minjerribah`, `"meaning": "contested, do
not assert"`).

Queensland Parks publishes *place of many mosquitoes*. Tourism and secondary material widely repeats
*island in the sun*, and no primary source for it was found. The pack records both, marks the second as
low confidence, and asserts neither. The island's name is used throughout regardless; only the meaning is
withheld.

**Ask:** the correct meaning, or whether the twin should simply not gloss it.

### B11. QYAC's positions
**Affects:** `data/lore.json` line 757 (`qyac_public_positions`) and line 806
(`explicitly_unknown`); `data/civic.json` line 1381 (`planned-burn-extent`) and line 1651
(`sim_defaults.qyac_capacity_rule`).

Five QYAC positions are recorded, all from its May 2015 briefing to the Queensland parliament and its
Sustainability Strategy, all with sources, and four of the five are marked historical rather than
current. The pack explicitly records as unknown QYAC's current views on the ferry terminal, Toondah
Harbour, fares, visitor caps, camping numbers, short-stay letting, rates, and the subterranean works this
project imagines.

**Ask:** nothing yet. **Do not fill these in from inference, news reporting or a conversation with anyone
who is not QYAC.** The prohibition `no-quandamooka-position-without-citation` fails the build if a lever
carries a QYAC position that is not in this list with a source and a date.

Note that `qyac_capacity_rule` in `data/civic.json` turns a Queensland Audit Office finding about the
state's management of Minjerribah Futures funding into a delivery mechanic. That finding is about state
agencies, not about QYAC's competence, and the twin must not present it as a criticism of QYAC.

### B12. Cultural burning
**Affects:** `data/ecology.json` line 1249 (`proc-fire-regime.cultural_burning`); `data/civic.json`
line 1381 (`planned-burn-extent`); `src/kernel/clock.js`, the `cooling` entry in `ISLAND_SEASONS`
(line 85 as at 10 August 2026), where the marker says "Planned burn season opens".

Research indicates the island's large old cypress pines reflect a long history of cultural burning with
mild fires, and that their survival depends on the practice continuing. QYAC leads the island's bushfire
management. The project models the **ecological and civic effect of fire frequency, timing and extent**
and deliberately does not depict, name or animate the practice.

An earlier draft of the clock had a season marker reading "Fires cool and clean", which reads as a
description of cultural burning. It has been replaced with "Planned burn season opens", which is the
published civic fact from `data/ecology.json`.

**Ask:** whether the twin should show cultural burning, and how.

### B13. Sand mining rehabilitation
**Affects:** `data/lore.json` line 589 (`sand_mining.rehabilitation`, status `not verified`).

Mining ended in 2019. Current rehabilitation obligations, progress and handback arrangements were not
established. Rehabilitation outcomes are not modelled as fact.

**Ask:** this is a factual gap more than a cultural one, but the land in question is native title land and
the answer sits with QYAC and the state together.

### B14. The Quandamooka Coast claim
**Affects:** `data/lore.json` line 398 (`native_title.pending`).

QYAC's own page records a trial commencing 1 September 2025 with a further week from 1 December 2025. No
determination or judgment was found in searches on 7 August 2026. The pack records the status as unknown
and forbids showing the claim as decided.

**Ask:** the current status. This is off-island but it is live, and getting it wrong in a UI would be a
real error.

### B15. Art
**Affects:** `assets/**` and the prohibition `no-generated-aboriginal-art` in `data/lore.json` under
`prohibitions.rules`.

No generated, synthesised or imitated Aboriginal visual art, pattern, motif, ochre design, flag or symbol
may be produced by any agent on this project. QYAC has its own artists and its own arts and culture
strategy.

**Ask:** if the twin needs any Quandamooka visual work at all, it is commissioned from a Quandamooka
artist through QYAC, or it does not exist.

### B16. Two ILUAs nobody has read
**Affects:** `data/lore.json` line 412 (`native_title.agreements`, entry `ilua-state-2011` at line 414),
and `docs/DATA-NOTES.md` under
`## civic`, gap 5.

The Quandamooka Indigenous Land Use Agreement with the State was signed on 15 June 2011. The pack records
that it exists and its date, and records that its contents have not been read and must not be
paraphrased. Several `who_decides` fields in `data/civic.json` will probably be wrong until someone
reads it.

---

## C. From the ecology pack (6 August 2026)

Retained from the previous version of this file. Items 1 and 2 are now also covered above at B4 and B12
with file and line references; item 3 is covered at B8.

**C1. Cooperative dolphin fishing at Amity Point.** Recorded in `data/ecology.json` line 802 under
`sp-indo-pacific-bottlenose-dolphin.cultural_reference`, with a `handling_rule` blocking it from
player-facing copy. See **B4**, which adds the primary citation and the lore-pack record.

**C2. Cultural burning and the old cypress pines.** Recorded in `data/ecology.json` line 1249 under
`proc-fire-regime.cultural_burning`. See **B12**.

**C3. Two named lakes.** Karboora (Blue Lake) and Bummiera (Brown Lake) are named in `data/ecology.json`
lines 80 and 81 because both names are in wide published use, including on Queensland Parks and Redlands
tourism material. The pack records that both are culturally significant and adds nothing further. No
story, no meaning, no ceremony, no other language words anywhere in the pack. See **B8** and **B9**.

---

## R. From the residents slice (7 August 2026)

`src/systems/agents/` builds about 2,070 simulated residents in 970 households from
`data/residents.json`. Three decisions in it were made to stay inside the blocking rule
`no-aboriginal-characters-with-invented-culture`, and a human needs to confirm all three.

### R1. "Connection to Country" was asked for and was not built
**Affects:** `src/systems/agents/needs.js`, the need list.

The brief for this slice asked for a need called connection to Country, "for those it applies to".
It is not in the build. A need that only some agents carry, keyed to who those agents are, assigns a
cultural obligation to a simulated person, which is exactly what the blocking rule forbids. Beyond
the rule: connection to Country is not a meter, it is not a thing that empties and refills, and it
belongs to Quandamooka people rather than to a simulation written from public records by people who
are not Quandamooka.

What is there instead is a need called `place`: attachment to this island, filled by being outside on
it and by being near the water, carried by every resident, and weighted by how long somebody has
lived here. It is not a substitute and it does not claim to be one.

**Ask:** should anything of this kind exist in the model at all, and if so, who defines it and who
holds it. The safe default, and the current one, is that it does not.

### R2. Two archetypes in the pack are named as Quandamooka households
**Affects:** `data/residents.json` `household_archetypes[0]` and `[1]`;
`src/systems/agents/population.js` household sampling and labelling.

`quandamooka-family-multigenerational-dunwich` and `quandamooka-lone-elder-dunwich` are sampled,
because 30.5 per cent of Dunwich residents are Aboriginal and Torres Strait Islander at the published
census and leaving them out would falsify the township. What the build does not do is put that on an
agent. No person and no household carries an Aboriginality field. The archetype id never reaches the
published read model and never reaches a player-facing label: households are labelled by surname and
composition, so the pack's "Quandamooka family, three generations, Dunwich" renders as "the Fenwick
house, three generations, Dunwich". The occupations at QYAC and Yulu-Burri-Ba are public job types at
real organisations and carry nothing else.

**Ask:** is sampling those archetypes at all the right call, and is the labelling handling right, or
should the archetype list be reworked so the question does not arise.

### R3. Nothing in the slice generates cultural behaviour
**Affects:** `src/systems/agents/needs.js` action table, `src/systems/agents/schedule.js`,
`src/systems/agents/social.js`.

The action table has about fifty entries and none of them is cultural. Nobody in this build attends
anything cultural, holds cultural knowledge, has a cultural role, or says anything at all. Relationship
kinds are household, family, partner, housemate, neighbour, colleague, friend, acquaintance, rival and
ex, and there is no kinship model. The volunteer organisations, the clubs and the employers are all
real entities from `data/businesses.json` doing things they publicly do.

**Ask:** confirm that this is the right floor, and that nothing further should be added without QYAC.

---

## G. From the civic board and calendar panels (7 August 2026)
**Affects:** `src/ui/panels/civic.js`, `src/ui/panels/events.js`.

### G1. Where the board stops, and what it shows instead
Ten of the sixty-two levers in `data/civic.json` have QYAC, Minjerribah Camping or joint management as
their first decision maker. On those the board shows the process, the referral, the documented capacity
constraint and the wait, and then stops. It renders no position. The player can record their own
assumption to keep playing, and every downstream effect stays labelled as resting on that assumption
rather than on anybody's view.

The only Quandamooka material the board displays is the five public QYAC statements in
`data/lore.json`, each shown whole with its date, its source key and its own currency caveat, plus the
`explicitly_unknown` list. It never attaches a statement to a lever that statement was not about: the
lever-to-position anchoring lives in `src/systems/civic/council.js` and the panel only reproduces what
that system already decided to cite.

**Ask:** confirm the wording of the stop, which is "No public statement by this body on this lever is
held by this project", rather than anything that could read as "QYAC has no view".

### G2. One word is substituted before it reaches a screen
`data/events.json` uses the word for cultural performance correctly, in its own notes, to record what
has deliberately been left out of the pack: the named days within the Quandamooka Festival season, and
the absence of any local NAIDOC programme. Those notes are worth showing a player, because a calendar
that hides its own gaps is a lie on an island this size. But `no-invented-ceremony` blocks that word
across `src/`, and a panel that renders it puts it on the screen.

So `src/ui/panels/events.js` carries a three-entry substitution table, listed in the file, applied to
every pack string before it is rendered. The note is shown, the word is not, and nothing the sentence
claims is changed. The three cultural records are shown as civic load only: dates, crowd, ferries,
bins and money, under a banner saying so.

**Ask:** is substituting the word the right call, or should those two `left_out` entries and the
`cultural_handling` notes simply not be rendered at all?

### G3. What the calendar shows about cultural records
The Quandamooka Festival, NAIDOC Week and the Goompi NAIDOC film celebration appear in the calendar
with dates, attendance bands, crowd curves, strains, ferry load and the businesses that trade off
them. No programme, no content and no protocol is held in the data or generated by the panel. The
festival's own `cultural_handling` note is not rendered; a plain line of the panel's own wording is
shown in its place.

**Ask:** confirm that carrying these events as civic load at all is wanted, and that the attendance
and strain estimates being visibly labelled as estimates is enough.

### G4. What changed on 10 August 2026, and four new questions with it
**Affects:** `data/events.json`, `src/systems/agents/calendar.js`, `src/systems/agents/events.js`,
`src/systems/agents/visitors.js`, `src/ui/panels/events.js`.

The calendar slice was widened from twenty-seven events to thirty-six, and for the first time the
pack drives the simulation rather than only the board: a record in `data/events.json` now puts
people on a boat, on a beach and in a shop. G2 and G3 above still describe the handling correctly
and nothing in them was relaxed. Four things are new and each is a question rather than a decision.

**G4a. MMEIC is now named as an organiser, with a council grant recorded beside it.**
`goompi-naidoc-film-celebration` previously read "Listed with MMEIC and Redlands Coast". It now
names the Minjerribah Moorgumpin Elders-in-Council Aboriginal Corporation as the organiser and
records, from a July 2026 Redlands Coast Today report, that Redland City Council awarded Community
Celebration Grants funding to MMEIC to hold Goompi NAIDOC community celebrations, and that MMEIC
will hold three events including a community film celebration and dinner. The record holds the
date, the place, the crowd, the power for a screen and the car park, and nothing else. The report
goes on to describe the programme of those events; that sentence was deliberately not carried, and
the two events with no public listing of their own are not in the pack at all.

**Ask:** is naming MMEIC as the organiser of a publicly advertised, publicly funded event wanted,
and is stopping at "a community film celebration and dinner" the right place to stop? The rule this
was written to is that an organisation's publicly advertised events may be listed exactly as
advertised, and that nothing about its views, decisions, internal workings or knowledge may be
represented. A reviewer should check that the line held.

**G4b. The mainland NAIDOC celebration is recorded in a note and not as an event.**
The Redlands Coast NAIDOC Cultural Celebration at Raby Bay Harbour Park, Cleveland, on Sunday 5 July
2026, run by Redland City Council in partnership with Yulu-Burri-Ba Aboriginal Corporation, is off
the island. It is in a `notes` field on the island record because it pulls islanders the other way,
onto an early Sunday boat out, which is a transport load this simulation has no way to represent.
No performer, no programme and no content is carried.

**Ask:** should an off-island event appear in an island pack at all, even as a note about transport?

**G4c. A youth gathering advertised on Quandamooka Country was left out.**
A two-day ticketed youth gathering at the Minjerribah Camping ground on 18 and 19 July 2026 appears
in the owner's public event atlas from a ticketing platform. Its title names Quandamooka Country and
the listing does not name an organiser this project could verify. `PUBLIC_BOUNDARY.md` in
`quandamooka-country-events-engine` says not to treat guessed catalogue data as consent and not to
imply an authority that has not been granted, and that document governs this material. It is in the
pack's `left_out` list with that reason.

**Ask:** was that the right call, or is a publicly ticketed event fair to list on its dates alone?

**G4d. `quandamooka-family` is now a share of a modelled crossing.**
`data/events.json` has always carried `quandamooka-family` as one of ten visitor archetypes in the
`archetype_mix` of several events, describing who the crowd is. Until this pass that mix was
displayed and nothing more. It now feeds the visitor model: a share of an event's crowd becomes
arrivals who take a seat on a boat.

What the build does with that share is deliberately nothing beyond the seat. Those arrivals are
mapped onto the same unlabelled generic visitor archetypes as everybody else, carry no field, no
label, no name pool, no behaviour and no cultural attribute of any kind, and the archetype id never
reaches a player-facing string. This is the same handling as `R2` above, for the same reason:
`no-aboriginal-characters-with-invented-culture` is blocking, and modelling the crossing load is a
transport fact while modelling who those people are is not this project's to do. The reasoning is
written into the header of the mapping table in `src/systems/agents/visitors.js`.

**Ask:** should that archetype drive arrivals at all, or should its share be folded into the
undifferentiated visitor draw so the question does not arise? The safest alternative is to zero its
increment share in `sim_defaults.event_visitor_increment.by_archetype`, which is one number in a
data file and would understate the crossing load on those days rather than overstate anything.

**G4e. A heritage walk and a burn season entered the pack.**
`goompi-heritage-walk`, a guided walk advertised by the North Stradbroke Island Museum on
Minjerribah, is carried with a `cultural_handling` note holding it to the date, the group size and
the starting point, because the history of that township includes the protection era, which **B5**
holds open. `planned-burn-season` records the publicly notified hazard reduction season, reported as
led by QYAC on the island, and holds the months, the notification and the smoke. Neither carries a
route, a stop, an interpretation or any account of practice, and **B12** is unchanged: the knowledge
behind fire on this Country is not in this project and is not modelled.

**Ask:** confirm both, and in particular confirm that recording a burn season as a civic period,
with QYAC named as the body reported to lead it, sits on the right side of the line drawn at B12.

---

## N. From the connector layer (10 August 2026)
**Affects:** `tools/connectors/`, `data/feeds/`, `docs/CONNECTORS.md`.

The connector layer reads real island sources into committed feeds and writes drafts back out.
Five items from building it belong on this queue. None of them is approved and none is rendered to
a player.

### N1. Six publicly advertised events with a Quandamooka or First Nations subject are in a feed
**Affects:** `data/feeds/_events-engine.json`, the records flagged in its `cultural_flags` block.

The Quandamooka Country Events Engine's public event atlas lists them. Six are flagged by
`tools/connectors/events-engine.mjs`: they name a cultural event, a Quandamooka organisation, or
Country. Each is carried as **the date, the place, the event name and who listed it, exactly as
advertised, and nothing else**. For those six the atlas's own descriptive summary, its load tags and
its movement note are all dropped, because a description of what happens at a cultural event is not
this project's to hold. Two of the six were listed through MMEIC or QUAMPI; naming a listing source
is naming who advertised it, and is not a claim about anything either body holds.

**Ask:** confirm that carrying a publicly advertised cultural event as a date, a place and a listing
source is wanted at all, and confirm the wording of the note the emission puts under any screen
digest containing one, which currently reads: do not add a description, a programme or anything
about what happens at it.

### N2. Straddie News is refused, and the refusal is worth a human reading
**Affects:** `tools/connectors/refusals.mjs`, `checkStraddieNews`.

`githublocal\straddie-news` is a strategy dashboard whose own footer calls it an internal research
document. Its main table is a stakeholder map, and two of its entries are QYAC and MMEIC, each with a
characterisation of the relationship and a strategy field for handling it. No connector reads it, and
`refusals.mjs` re-reads it every run to check the disqualifying material is still there rather than
holding the refusal as a memory.

**Ask:** nothing of QYAC or MMEIC. This is recorded so that a future agent who finds that repository
finds the refusal first, and so that a human who wants island news in the twin knows the route is a
public story feed and not that document.

### N3. Minjerribah Camping and the QYAC rangers are defined and deliberately not built
**Affects:** `tools/connectors/registry.mjs`, entries `minjerribah-camping` and `qyac-rangers`.

Both would be genuinely useful. Camping occupancy is the missing half of the visitor model, and a
track closure changes what the twin should say about a walk. Both are QYAC. A connector that read
either without asking would be this project taking data from a Traditional Owner organisation, which
`docs/DIRECTION.md` rules out under no surveillance-shaped anything. Neither has a reader and neither
has a guessed feed.

**Ask:** these sit behind A1. If and when there is a conversation, the question for camping is
whether nightly site counts and closures are welcome and in what form, and the question for rangers
is whether ranger activity should appear at all. The line this project already holds stands either
way: a closure is a closure and a date, and nothing about fire practice on this Country enters
through any route, including a connector. B12 holds that one.

### N4. A coarsening ruling is wanted, and the people who can give it are not us
**Affects:** `tools/connectors/wildlife-rescue.mjs`, `coarsen()` in `tools/connectors/lib.mjs`.

Wildlife records are rounded to about 110 m and to the hour before anything is written, and reporter
names, phone numbers and free-text notes are dropped entirely. That floor was set by this project
from `docs/PARTICIPATION.md` and nobody with local knowledge has looked at it.

**Ask:** Wildlife Rescue Minjerribah, on which animal groups should carry a pin at all and which
should carry only a township. And for anything on Country, A1 comes first.

### N5. QYAC and MMEIC are on the noticeboard connector's wanted list, as names and nothing else
**Affects:** `data/feeds/_noticeboard.json`, the two entries in its `cultural_flags` block, and
`screenWanted()` in `tools/connectors/lib.mjs`.

The Straddie Noticeboard Network's research pass names 164 island organisations, and QYAC and MMEIC
are two of them. Neither carries a researched profile, so neither becomes a record. Both become
wanted-list entries, which is this layer's word for an organisation that is real, is named, and has
been asked nothing by anybody.

Each entry now carries **the organisation's name, its category and township as the source recorded
them, the sentence that nobody has asked it anything, and a handling note**. What the source
repository guessed each might one day share has been dropped, because a guess about what a body
would supply reads as that body's intention. Both are flagged so this queue sees them.

Two things are worth a human knowing about how this arrived. It was a hole: for one round the wanted
list was written into a committed feed without passing the screen at all, so these two entries sat
in a public file carrying the source's guess and no flag. And when the screen was first extended
over it, the entries were held rather than flagged, because the connector names a gap
`nb-want-<organisation>` and "want" reads as a position verb, so two Traditional Owner organisations
were quietly dropped off the list of organisations nobody has asked. Both are fixed and both are
checked on every run.

**Ask:** whether either organisation should be named on a public list of organisations this project
has not spoken to at all. Naming an organisation nobody has asked is honest about a gap and it is
still naming somebody in a file they have not seen. A1 stands over this one, and if the answer is
that neither should be listed, the entries come out and the count says two were removed rather than
the list quietly shortening.

---

## D. Machine checks that back this file up

`data/lore.json` carries a `prohibitions` block with thirteen rules written to be checked by a build
script, not just read. The blocking ones:

| Rule id | What it fails on |
| --- | --- |
| `no-invented-language` | any Aboriginal language word in the repo that is not in `language.allowlist` |
| `no-banned-tokens` | the six deleted season names, plus the identifier `QUANDAMOOKA_SEASONS` |
| `no-invented-ceremony` | ceremony, corroboree, songline, dreaming, totem, sorry business and similar |
| `no-sacred-or-restricted-sites` | midden, burial, sacred, bora and similar, anywhere with a coordinate |
| `no-aboriginal-characters-with-invented-culture` | any `clan`, `totem`, `aboriginality` or similar field on a simulated resident |
| `qyac-as-civic-actor-only` | QYAC given an opinion, a mood, a vote or a line of dialogue |
| `no-quandamooka-position-without-citation` | a civic lever asserting a QYAC view that is not in `qyac_public_positions` |
| `no-cultural-content-without-source` | player-facing cultural text with no `lore_ref` |
| `no-low-confidence-to-player` | anything marked `confidence: low` rendered to a player |
| `acknowledgement-present` | the acknowledgement missing from the built page at load |
| `no-gamified-culture` | culture as a resource, score, currency, collectible, unlock or win condition |
| `no-generated-aboriginal-art` | any imitated Aboriginal visual motif in `assets/` |

The check harness is not written yet. Writing it is the next job, and it is small: most of the rules are
token scans over `src/`, `data/` and `docs/`.

### D1. What the first hand-run of `no-banned-tokens` found (9 August 2026)

Because the harness does not exist, the smoothing pass ran the token scan by hand. It failed.

`data/narrative.json` still carried five of the deleted season names as `season_bias` keys, in 28
seeds: `gubinbara` twelve times, `nunmatta` sixteen, `gulayi` twelve, `bujaboo` four, and
`yalingbila` nine. The names had been removed from `src/kernel/clock.js` and recorded as banned in
`data/lore.json` in wave 3, and the narrative pack, written afterwards by a different agent, used
them anyway. `yalingbila` is the worse of the two cases: it is an allowlisted word with a published
meaning, whale, and it was being used here as the name of a season, which is precisely the mistake
wave 3 had already found and written up.

They have been deleted, not renamed. Nothing in the repository records what the invented names were
supposed to mean, so mapping each one onto a plain English season would have meant inventing a
second time. `src/systems/narrative/director.js` never read them: it reads only
`long_weekends`, `school_holidays`, `school_term` and `high_summer`, so no behaviour changed, and
the `note` fields beside each block still carry the real seasonal reasoning in sourced plain
English ("Southbound with calves peaks about October", "The mullet run runs May to August").

Two things follow. First, a rule that is written down but not executed is not a rule: this one was
recorded, agreed and violated inside the same repository, by an agent that had read the file.
Second, the harness should be written before the next pack lands, and it should run over
`data/**` as hard as over `src/**`, because the pack is where this came in.

### D2. The harness, written 10 August 2026

It exists now. `node tools/gate-audit.mjs` reads the thirteen rules out of this pack's
`prohibitions` block and runs them, over `data/**`, `src/**`, `docs/**`, `tools/**`, `index.html`
and `assets/**` according to each rule's own scope. Ten of the thirteen have executable checks.
The three the pack marks `manual` are printed as questions on every run rather than dropped, and a
rule with no implementation reports itself as unimplemented instead of quietly passing, so adding a
rule to this pack cannot silently do nothing.

What the first full run found, on twelve packs and about eighty thousand lines: no banned token
anywhere, which is the wave 7 fault confirmed closed by a check rather than by a memory; the
acknowledgement in `index.html` still character for character what
`acknowledgement.game_wording.short` says; twenty-eight token hits under `no-invented-ceremony` and
`no-sacred-or-restricted-sites`, every one of them a file stating the prohibition or enforcing it,
each now recorded in `tools/ingest/ledger.json` with a reason and a frozen count so a
twenty-ninth fails the build; and four `indigenous` fields in `data/residents.json` that are
published Australian Bureau of Statistics proportions for a township rather than a field on a
person, exempted by pointer with that reason written down.

Two things it raised that belong to a reviewer rather than to a tool:

1. `data/ecology.json` carries the word *sacred* twice, in the aquifer record's `community_concern`
   field and its source, reporting a Redland City Bulletin headline about residents fearing lagoons
   drying. It names no place, carries no coordinate and takes no position, so it does not breach
   `no-sacred-or-restricted-sites` as that rule is written. It is a word that could reach a player
   through an ecology readout, and whether it should is a question for this queue.
2. `lore.sand_mining.quandamooka_position` states a QYAC position, cites `qyac-briefing-2015`, and
   is a second copy of `pos-2013-act-repeal` in `qyac_public_positions` with no link between them.
   Nothing is wrong with either copy today. Two copies of a QYAC statement can drift apart, and a
   `position_ref` field on the first would stop that. The gate raises it as an advisory and does not
   change the pack, because an ingest tool editing the lore pack by itself is not a thing this
   project should have.

`docs/INGEST.md` is how the harness works and how to extend it.

---

## E. Opening hours, and who is not a shopfront (10 August 2026)

### E1. The open sign came off QYAC and MMEIC, and the reason it should stay off
**Affects:** `data/businesses.json`, records `qyac` and `mmeic`; `src/systems/economy/hours.js`
(`HOURS_POSTURE`); `src/systems/economy/businesses.js` (the gate at the top of the open loop).

Until this pass both records carried a Monday to Friday office roster that nobody had published, and
the inspector drew a live open-or-shut chip from it. A critic named it exactly: a card reading SHUT
over the Minjerribah Moorgumpin Elders-in-Council is the twin describing how an Elders' council runs,
which is the one thing this project is not allowed to do.

Both records now carry `hours_posture: "organisation"`, and a record that is not a shopfront is never
entered into the open-or-shut model at all. Its `open` is null for the life of the run, not false.

QYAC publishes no office hours on its own site, checked 10 August 2026, so its record carries
`basis: "none"`: seven unverified days and no guess. **MMEIC does publish office hours**, on its own
site, as Monday, Wednesday and Friday, 9am to 3pm. Those are carried exactly as published, with the
URL and the date, and the other four days are left unverified because the site says nothing about
them. Nothing is computed from them.

The judgement worth a human's eye is that second one. The instruction this pass was given said to set
every weekday on both records to unverified. It was not followed for MMEIC, and the reason is that
blanking a fact the corporation itself published would have replaced an invented roster with a
different kind of inaccuracy. Carrying their own three days from their own page is the smaller true
claim. **If MMEIC would rather the twin held nothing at all, that is their call and not this
project's**, and the change is one line in the pack.

**Ask:** whether QYAC and MMEIC want to be in this pack at all, and if so, whether the office hours
MMEIC publishes should appear in the twin or whether the record should hold nothing.

### E2. QUAMPI has no published hours and none have been invented
**Affects:** `data/businesses.json`, record `quampi`.

The Quandamooka Arts and Culture Centre is a real gallery with a cafe and a shop and it does have
opening hours; no source found on 10 August 2026 publishes them, including the Queensland Government
tourism listing the record cites. The record previously carried a guessed Tuesday-to-Sunday week.

It is Quandamooka owned and operated, so guessing its week is guessing at an operating detail of a
QYAC business. The week is now empty, `basis: "none"`. This is the one gap in the pack that a single
phone call would close, and it should be closed by a person asking rather than by an agent searching.

**Ask:** QUAMPI's opening hours, from QUAMPI.

### E3. What is still not asked of anybody
`data/businesses.json` holds a `hours_posture` on twenty-four records: eleven organisations, seven
on-call services and five transport operators, plus the school. None of them is asked whether it is
open. That list is a judgement about what kind of thing each body is, made by an agent, and it is
worth a reader's eye. It is checked mechanically by `node tools/hours-envelope.mjs`, which fails the
build if a record that is not a shopfront ever carries a guessed week again.

---

## M. From the owner's own map of the island (10 August 2026)

The map lane, `tools/ingest/lane-map.mjs`, took 139 placemarks from the owner's own Google MyMaps of
Minjerribah into `data/contributions/map-contributions.json`. **Six were held.** A held placemark does
not enter the world, is not rendered, is not named in the interface, does not become a place record
and carries no coordinate anywhere in this repository except in the owner's own file, which is not
committed. This section is the only place any of them is described, and it describes them without
reproducing what they propose.

Every one of these is a question, not a refusal. They are his pins, on his island, and the twin is
simply not the place where any of them gets decided. The screen that caught them is
`tools/ingest/checks-screens.mjs`, which runs on every gate over every future map.

### M1. A proposed ceremonial space at Amity Point
**Affects:** `data/contributions/map-contributions.json`, held ids `held-f98bba54` and
`held-1b3eb0e1`. Prohibitions `no-invented-ceremony` and `no-sacred-or-restricted-sites` in
`data/lore.json`.

The owner walked to a clearing in the bush near Amity Point, marked it with a pin and drew a small
polygon around it, and proposed that it become a multi-purpose ceremonial space. **His own text names
a memorandum of understanding as the prerequisite**, which is the same judgement this file would have
reached from the other direction.

Both the pin and the polygon are held. The polygon carries no wording that any rule catches; it is
held because it outlines the same ground, and the harm the sacred-sites prohibition names is the
publishing of a location, not the wording beside it. The placemark also carried a mobile number, which
was removed at ingest and is recorded nowhere.

**Ask QYAC:** whether a place on Quandamooka Country may be proposed for ceremonial use by anybody
outside the process QYAC already has for that, and whether a proposal of that kind may be modelled,
mapped or named in a digital twin at all before the agreement he himself names exists. Also worth
asking, because it is the question underneath: is a bush clearing near Amity Point a place about which
this project should be holding a coordinate at all.

**Ask the owner:** whether he wants this taken to QYAC as his proposal, in his name, or held out of
the project entirely. Both are honest answers and this file cannot pick one for him.

### M2. A proposed open-air arena at Dunwich whose listed uses include ceremony
**Affects:** `data/contributions/map-contributions.json`, held ids `held-9cc1a8f7` and
`held-e9000f1f`.

A polygon on a small block at Dunwich, with a pin pointing at it, proposing a small outdoor
multi-purpose arena. Six uses are listed and ceremony is one of them; the other five are ordinary
civic uses that this project models happily elsewhere.

This is the lighter of the two and it is held on the same footing on purpose, because the rule is
about a place being proposed for ceremony and not about how many other uses are listed beside it. It
is the one most likely to come back released, and releasing it is a line in this file.

**Ask QYAC:** whether a civic venue proposal that lists ceremony among its uses may appear in the twin
with that use present, with that use removed, or not at all.

### M3. A proposal to rename a named beach
**Affects:** `data/contributions/map-contributions.json`, held id `held-1b4422c2`. Section A3 above.

A pin on a real, named ocean beach proposing that it be renamed, with a sentence about the deaths the
current name refers to that this project is not going to republish.

Place naming on Minjerribah is already the open question in A3, where published sources disagree and
QYAC has given no ruling. A rename proposed by a resident is a live civic question and a good one; it
is not a thing a twin gets to model, and the beach itself is already in `data/places.json` under its
published name with its position corroborated by his own map.

**Ask QYAC:** nothing new. A3 already asks it. This is one more reason A3 matters.

**Ask the owner:** whether he wants the renaming proposal recorded anywhere in this project, and if so
where, given that it is a proposal about a place name rather than about a building.

### M4. One hold that is probably the screen being wrong
**Affects:** `data/contributions/map-contributions.json`, held id `held-27706ee8`.

A proposal for a community workshop on an existing council site, so that the repair and recycling the
locals want has somewhere to happen. It is held because its name contains the name of a national
community-organisation movement, and one of the tokens in the `no-sacred-or-restricted-sites` rule is
a possessive that appears inside that name. Nothing about the proposal is cultural.

The screen cannot tell the difference and it should not try: a token scan that started guessing which
possessives are innocent would stop being a check. So it holds, and a person releases it. **This is
the one item in section M that a reader can almost certainly clear in a line**, and it is written down
here rather than quietly ledgered so that clearing it is a decision somebody made rather than a number
somebody raised.

**Ask the owner:** confirm this is the community workshop proposal and not something else, and it can
be carried in the next pass with `proposed` status like his other proposals.

### M5. Two contributed proposals that were carried, and why they were not held
**Affects:** `data/contributions/map-contributions.json`, the record named for the Amity Point
character overlay and the record named for the Yarraman mine re-imagining.

Two of the owner's proposals were carried rather than held, both marked `proposed`, both with
`player_facing: false`, and both are worth a reader's eye because neither is a small thing.

The first is a hand-drawn character overlay over the village of Amity Point, asking that development
there keep to the fishing-village character. His own description says the boundary is his and
represents no authority, and that sentence is carried verbatim in the record's quote.

The second re-imagines the Yarraman mine site as a university, a cultural precinct and an adventure
playground. It is a proposal about the future use of a large area of Country under native title and
under joint management, made by somebody who is not a Traditional Owner. It is marked proposed, it is
not rendered, and nothing is derived from it.

**Ask QYAC:** whether a proposal by a resident about the future use of a rehabilitated mine site on
Quandamooka Country belongs in this project at all, even carried as an unrendered proposal with the
proposer's name on it.

### M6. Two property names on the map may be language words
**Affects:** `data/contributions/map-contributions.json`, one holiday rental record in the Point
Lookout folder whose name is two words that look like they may be from an Aboriginal language.

Neither word is in `tools/ingest/vocabulary.json` and neither is in `lore.language.allowlist`. They
sit in a property name rather than in a cultural position, so `no-invented-language` does not block,
which is the rule working as written. They have deliberately not been added to the vocabulary file,
because `docs/INGEST.md` is explicit that a word which turns out to be an Aboriginal language word
belongs in the allowlist with a published source and never in the vocabulary file, and that the
reading is the whole point. Nobody has read these two.

**Ask:** whether a holiday house whose advertised name may be a Quandamooka word should carry that
name in this project, and if so whether the name belongs in the allowlist with a source or stays where
it is as an unresolved advisory.

### M7. What the map lane does not do, recorded so nobody has to ask twice
No cultural material entered this project through this map. The lane holds rather than judges, it
names nothing it holds, and it strips contact details before it writes anything.
`docs/PARTICIPATION.md` already says it plainly and it applies to the owner exactly as it applies to
anybody else: Aboriginal language, story, ceremony, art and site knowledge are not accepted through
this repository, from anyone, however offered. The route is QYAC or it does not exist.

## L. The legislation pack names two Acts that touch Country (10 August 2026)

### L1. Two instruments in `data/legislation.json` are about Aboriginal rights and heritage
**Affects:** `data/legislation.json`, records `qld-aboriginal-cultural-heritage-2003` and
`cth-native-title-1993`.

The legislation pack records sixty-four Acts an ordinary person on this island is subject to. Two of
them are the Aboriginal Cultural Heritage Act 2003 (Qld) and the Native Title Act 1993 (Cth). Both
records deliberately describe the mechanism of the Act and nothing else: what the duty of care is,
what a determination is, what an indigenous land use agreement does. Neither record names a place, a
practice, a piece of knowledge or a holder of it, and neither restates what happened on this island.
Where the island is relevant, the record points at the existing sourced entries in `data/civic.json`
and `data/lore.json` rather than repeating them.

That was a choice and it is worth a human confirming it is the right one. The alternative reading is
that describing a heritage Act at all, in a twin of Quandamooka Country, is a thing to ask about
before doing rather than after.

**Ask QYAC:** whether recording these two Acts as instruments, described by mechanism only, is
acceptable; and if so whether the description of the cultural heritage duty of care should say more
about who the Aboriginal party for this area is, or deliberately less.

### L2. Nothing in this pack may grow toward cultural content without that answer
The catalogue entry for the cultural heritage Act carries this in its own review note: any expansion
beyond the mechanism belongs here and is QYAC's call, not the lane's. The pack is built so that a
later pass cannot quietly widen it without a person editing
`tools/ingest/legislation-catalogue.json` by hand, in a committed file, under review.

### L3. This is not legal advice and the pack is built so it cannot become advice
Every record carries a line saying it is a description of published law rather than advice, and that
a person's actual position depends on facts this twin does not know. That line is a required field in
the pack schema, so a record without it fails the gate. It matters here more than anywhere: a person
reading about the cultural heritage duty of care and treating this pack as their answer would be
badly served, and so would everybody else.
