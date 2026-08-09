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
**Affects:** `src/kernel/clock.js` lines 20 to 44 (the cultural note starts at line 23, the season array
at line 37); `data/lore.json` line 362
(`language.seasonal_calendar`); `data/lore.json` line 350 (`language.banned_tokens`).

**This has already been fixed once and the fix needs checking.** An earlier version of
`src/kernel/clock.js` carried six season names presented as a Quandamooka calendar, written from
memory. None could be sourced. One was demonstrably misused: *yalingbila* is published as meaning
whale, in the QYAC and University of Queensland project *Yalingbila Bibula* at Mooloomba, and it was
being used as the name of a hot wet season. All six names have been deleted, the export has been renamed
from `QUANDAMOOKA_SEASONS` to `ISLAND_SEASONS`, and the seasons are now plain descriptive English
(High summer, Late summer, Cooling, Cold and clear, Warming, Building storms) with markers drawn from
the sourced seasonal calendar in `data/ecology.json`.

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
line 1381 (`planned-burn-extent`); `src/kernel/clock.js` line 39, where the Cooling season marker says
"Planned burn season opens".

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
