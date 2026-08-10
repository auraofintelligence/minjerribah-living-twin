# How it works

An explanation of the machine, for someone who has just arrived.

The running twin gives you this same explanation on screen, seven short sections, with the island
behind it rather than a wall of text and the camera pointed at whatever is being described. Press
`Y`, or take the last door on the arrival screens, and leave it at any screen. This document is the
version for a reader who is not in front of it, and it is fuller than the screens are.

Counts below were read out of the data packs on 10 August 2026. They move, and the twin shows you
the current ones.

---

## 0. The window

Six of the seven sections on screen are about something you can see out of the window, so the sheet
docks to one side and leaves the island in view, and each section moves the camera onto the thing it
is describing: not the township, the thing. The time section stands above the North Gorge walk and
looks down the slot to the sea. The data section stands over the Junner Street ramp at Dunwich, and
opens the shot to take in a vessel when there is one within about seven hundred metres; past that it
holds the ramp and says in words where the boat is. The registers section stands on the actual
premises whose published hours it quotes. The decision-rights section stands on the Amity Point
shoreline, on the houses and the road and the rock wall, because that is what the erosion levers are
about. The last section moves nothing, and says why.

Every one of those anchors is a coordinate out of a pack, put through the same projection the
simulation uses to place a barge on the water, so the camera and the copy cannot disagree about
where something is. If a pack has not loaded, the camera stays where it is rather than flying
somewhere nobody asked for. You can turn the whole behaviour off with one button in the sheet, and
the sheet then says the camera is where you left it.

A strip under the tabs says what is in front of you, and it will tell you when the answer is
nothing. The build opens at 5:20am against a 5:39am sunrise, which means the island out of the
window at that moment is sky and silhouette rather than ground. Rather than let you conclude the
twin is broken, the strip says the sun is five degrees under the horizon, says when sunrise is, and
offers to take the clock to twenty minutes after it, which is the first moment there is light on the
ground. Sunrise itself is not enough: the sun's centre is still under the horizon at the minute
sunrise is published for. That jump is an ordinary declared scrub, the bar at the top says so, and
the same strip then offers the way back. That way back works whoever parked the clock, including
you, from the ribbon, before the sheet was ever opened.

For the next hour after that the strip keeps a quieter line up, because a low sun leaves most of the
ground in its own shadow and a reader who has just jumped to the light and found the island brown
and dim deserves to be told that is the hour rather than the twin. Above six degrees it goes silent.
The arrival screens carry the first half of the same notice, before the three doors, since two of
those doors open on the same dark island.

---

## 1. What this is

A digital twin of Minjerribah, North Stradbroke Island, in Moreton Bay, about thirty kilometres east
of Brisbane. Three townships: Dunwich (Goompi) where the boats land, Amity Point (Pulan) on the
northern corner, and Point Lookout (Mooloomba) on the headland. There is no bridge. Everything that
is not already there arrives on a barge.

It runs in a browser with no build step, no server and no network. It also runs whether or not you
touch it. Two thousand-odd residents get up, go to work, walk the dog, put the bins out on bin night
and go to bed. The tide turns. The barge sails, or the wind gets up and it does not.

Two things it is not.

**It is not a game about a made-up place.** Every business, road, beach, headland, club, agency and
ferry service in it is a real one, taken from a public record, with the record named in the data.
Nothing was invented to fill a gap. Where a fact could not be found, the gap is still there and is
usually visible.

**It is not the island.** It is a model of the island, built by people who do not live there, from
what the island has published about itself. It gets things wrong. The useful thing about it is not
that it is right. It is that every number in it can tell you where it came from and how much weight
it will hold.

---

## 2. How time works

The bar across the top always says what kind of time you are looking at, before you have to ask.

**Simulated** is the default. The clock starts at a moment written down in the record and runs
forward from it, seeded, so the same island happens again on anybody's machine.

**Live** means the island's clock is at the real Queensland moment. It is an anchor, not a feed:
the real date and time it started from is taken once, stamped into the record, and nothing about it
reaches the network. Island time is AEST, UTC plus ten, all year. Queensland has observed no
daylight saving since the summer of 1991-92, when a referendum on it was defeated.

**Scrub** is when you park the clock and look at a moment the island is not at. This is where the
twin has to be careful, and where it tells you the most about itself.

Some things are pure functions of the moment. The sun, the moon, the tide at every station and the
calendar can all be worked out exactly for any minute you care to name, so when you scrub, they
follow you exactly. Everything else has to be lived through. The weather next Tuesday, the queue at
the ramp, which shops are open after a month of trading decided which of them cut their hours: none
of that can be conjured out of a timestamp. So it stays at the island's present and every cell
holding one of those numbers is tagged HELD, so you can see which is which.

Forward of the island's present is a **projection**. Nothing there is a record of anything. You can
turn a projection into history by running the ticks the island skipped, and the twin tells you how
many that is before it starts, because it is the expensive option.

Back before the island's present is not automatically history either. If the simulation never ran
that Tuesday, then what you are looking at is a real sun and a real tide over an island that was
not there. The twin draws the stretches it has actually lived through, so it can never claim to
have lived through a gap it jumped.

Determinism survives all of it, including live, because the mode, the anchor and every jump are
part of the saved record. Same seed and same packs, same island. That is not a constraint the twin
suffers. It is what makes a claim it produces checkable by somebody else.

The jump to sunrise offered on a dark morning is one of these scrubs and nothing more. It goes
through the same control the ribbon uses, so the chip changes to a projection, the jump is written
to the record, and one press puts the island back at its own present. The button that does that
works whether the sheet moved the clock or you did.

---

## 3. Where the numbers come from

There are four ways this twin can come to know something. Today one of them is doing nearly all the
work, and saying which is which is the point of this section.

**Committed packs.** Twelve of them, one per subject, holding around fourteen hundred records
between them. Each record names where it came from, and most carry a confidence rating on a
three-word scale the packs define in their own terms. The ones that do not are counted, and that
count is frozen so it can be paid off but cannot grow. This is where almost everything you see comes
from.

**Documents with page citations.** A tool reads a named public document, pulls the lines that
mention this island, and writes candidates carrying the page number and the sentence, verbatim. It
never writes a pack. A person reads the candidates and decides what is true, and a candidate nobody
has read cannot become data. Two Redland City Council documents are registered so far, hashed so a
citation cannot silently become a citation of an older version. No record has been promoted through
that lane yet.

**Contributions from islanders.** One of these is already in the running build and you can find it.
Rufus King Seafoods at Amity Point is in the business pack with its status set to closed. Several
tourism and directory sites still list it as trading. A resident said it had closed, that correction
was recorded on 6 May 2026, and the record is kept, closed, with the correction attached, so that a
later pass does not re-add it from a stale listing. There is no form and no portal. It arrived in
conversation and somebody typed it in.

**Synced feeds, with a freshness date.** A sync is an offline step, run deliberately by a person or
a scheduled job, that reads a real source and writes a versioned, stamped, committed feed. The
running twin still never fetches anything: no request leaves the page after it has loaded, in the
simulation or in the drawing. Every synced record carries when it was synced, from what source, at
what commit, and what the source said about its own currency, because "the bakery is open" is only
ever as true as its last sync. `docs/CONNECTORS.md` is the contract for this lane, and the twin's
own screen says whether it is running yet rather than leaving you to trust a date in this document.

Trading hours are where this gets sharp, and the business pack now grades every set of them with one
of three words:

- **published**, meaning the business published them itself, on its own site or page;
- **listed**, meaning a council, a tourism body or an island directory published them, which is real
  and citable and one step further from the kitchen;
- **estimate**, meaning nobody published them, so what is in the pack is a pattern for the
  simulation to run on and is never shown to you as a fact about a real street.

Each set carries the source, the date somebody checked it and its own confidence. The twin shows the
current split on screen. Real opening hours are not a nice-to-have: they are the difference between
a simulation that can tell you something about the island and one that can only tell you about
itself.

---

## 4. Real, modelled, proposed

Three registers, and you should be able to tell them apart on sight. Everything on screen is one of
them.

**Real.** It exists, somebody published it, and the record names where. The vehicle barge timetable.
The road network. Which beaches are gazetted for vehicles and the tide window that shuts them.

**Modelled.** The twin worked it out. Nobody measured it. How many people are on the island this
afternoon, what a shop took today, how many koalas are in a patch of forest. A modelled number is an
argument, not an observation, and the panel that shows it says what it rests on.

**Proposed.** Somebody has suggested it and it does not exist. It stays marked proposed everywhere,
in every panel, forever. The works below the sand are the biggest example: an entire subterranean
production graph that is not built, not approved, not funded, not sited and not consented, and every
one of its screens opens by saying so.

How to tell on sight: the marker. One function in `src/world/data.js` decides which register a
record is in, and the checker that guards the packs runs the same function, so nothing can be a
proposal in one place and a fact in another. Two other markers matter. **Unconfirmed** is a real
thing nobody has been able to check lately, and thirty-one businesses carry it; a Proposed badge on
a shop that is probably open would be a worse falsehood than the one the badge exists to prevent.
**Contributed** is supplied by a contributor and not yet verified by a second source.

Honestly: the classification is shared and enforced, but the badge is not yet drawn identically in
every panel. The subterranean board opens every screen by saying nothing in it is built, the civic
board carries each lever's status, and the introduction screen renders the badges from that same
function. Making every panel draw the marker the same way is work that has not been done.

There is a fourth state and it has no badge, because you never see it. Anything below the confidence
threshold is not shown at all. Held is a normal state here: an unreviewed record is invisible, not
caveated.

---

## 5. What you can actually change

This is the part that makes this twin different from a city builder, and it is not a limitation that
was worked around. It is the subject.

You are not the mayor. The civic board carries sixty-two researched levers. Nineteen of them are
yours to decide. Seventeen you can fund but not decide. Twenty-five you can only ask for. One you
can only watch.

Every one of those nineteen belongs to Redland City Council, so the seat this twin puts you in is a
council one. The councillor for this island represents Division 2, which covers Cleveland on the
mainland and North Stradbroke Island together, so the island's representative also answers to a
mainland suburb with a great deal more voters. That single fact sits underneath most island
grievances about being outvoted.

Of the rest: the Queensland Government is named on twenty-five levers, QYAC on fourteen, the joint
management arrangement over the national park on ten, SeaLink on six, Minjerribah Camping on four,
and Translink, the Australian Government, Redland Water, Seqwater, Economic Development Queensland,
Sibelco and private landowners on the remainder. The barge is a commercial service with a commercial
timetable, no ballot and no published resident quota, so on a long weekend your lever is asking.

So what you do instead is the real game: commission a study and pay for it, lodge the thing anyway
and get an information request back twelve weeks later, run a consultation, get up a petition that
is a list of names unless a consultation came back in favour, make a properly made submission, wait,
and live with the answer.

And where a decision belongs to a body this simulation will not model or guess at, it stops and says
so. You can leave it pending, which is the truthful outcome, or record your own assumption and carry
the label. Anything QYAC decides is in that category: the twin models the shape of the process,
waits, and states that it does not model the decision.

---

## 6. How to put something in

Ten lanes are designed, ordered from the lowest technology up, because the islander without a phone
is a first-class contributor here rather than a fallback: a spoken correction, paper cards, a tape
measure, business and community facts, scans, sightings, wishes, scenario suggestions, memory
anchors and event plans. `docs/PARTICIPATION.md` has all ten.

What actually exists today, said plainly:

- **The spoken correction works and has been used.** See section 3.
- **An intake tool exists** that turns a typed-up batch into records with attribution, consent,
  visibility and a coarsened location. It refuses anything without explicit consent.
- **There is no form, no portal and no booth software.** Contributions arrive out of band and
  somebody types them in. That file is the boundary.
- **The scan pipeline is built** and has been run on one real object at correct scale, and no asset
  has been delivered to the twin yet. `assets/` is empty.
- **It goes both ways.** Three emissions are built: a day of the island, a noticeboard notice and a
  rescue draft, each written to a file for a person to read and send on. The twin never posts
  anything anywhere by itself, and that restraint is the feature. `docs/CONNECTORS.md`.

What a contributor is promised, and it is the tooling that keeps these rather than the document:

- **One spine, no lower-trust lane.** A resident's correction and a council document arrive as the
  same shape of record and pass the same checks.
- **Your name on the record, and nothing else.** No points, no badges, no leaderboards, no tallies.
  Trust attaches to claims, never to people, because on an island this size a person-score is a
  social ranking.
- **The dial stays in your hand.** Consent and visibility are per record and are enforced when the
  pack is built, not when it is displayed.
- **One click to who made it**, for anything contributed that a player can see.
- **Held is a normal state.** Below the threshold, a record is invisible rather than shown badly.
- **Withdrawal is honoured at the next release**, through a marker that keeps the id so the record
  disappears honestly rather than silently. The honest truth about the medium as well: a public git
  history persists, so revocation after publication is best-effort, and anything that might one day
  need full erasure belongs at a lower visibility level from the start.
- **Nothing becomes an hour-verification protocol.** Not from any lane, not by any route. The
  community ledger in this twin is money-only on purpose, and the reasoning is in
  `src/systems/economy/chour.js`.

The one device that looks like a game and is not: a wanted list. Not points, just a visible list of
what this island's twin does not know, counted out of the packs as they stand. Trading hours nobody
published. Premises with no coordinates, so they are in the pack but not on the ground. Businesses
nobody could confirm are still trading. The Blue Room Cafe, where two published sources give
different street addresses, so its coordinates are left empty until a local says which one is right.
The reward for filling a gap is that the gap is filled, with your name on the record.

---

## 7. What this will not do

Minjerribah is Quandamooka Country. This is the part to read twice, and it is stated here rather
than in a footnote because it governs everything above it.

**QYAC has not seen this project.** The Quandamooka Yoolooburrabee Aboriginal Corporation holds and
manages the Quandamooka People's native title rights and interests, and nobody has asked it whether
this should exist. The cultural pack records its own status as not reviewed by Traditional Owners,
and that stays true until a human changes it after an actual conversation.

**Cultural material does not enter.** No language words, no story, no art, no cultural practice, no
sacred or restricted places, from any source, from any contributor, however offered. This repository
cannot verify anybody's authority to share cultural material, so the route for Quandamooka cultural
material is through QYAC, or it does not exist. That is the most important refusal in the project.

**`docs/CULTURAL-REVIEW.md` is an open queue, not a set of approvals.** Nothing on it is approved.
The first question on it is whether this should exist at all, and that question is QYAC's to answer.

Why that rule is a running check and not a line in a document: six season names were once presented
in this codebase as a Quandamooka calendar, written from memory. None could be sourced, and one of them,
*yalingbila*, is published as meaning whale and was being used as the name of a hot wet season. All
six were deleted. A later pass then found five of them still in use in the drama pack, in twenty-eight
places, put there by a different hand that had read the rule. A rule that is not a runnable check is
not a rule, so there is now a scan that runs over the whole repository every time the gate runs.

What the twin does carry is publicly documented fact about real organisations. Native title over
Minjerribah was determined on 4 July 2011. The national park is jointly managed. QYAC and
Minjerribah Moorgumpin Elders-in-Council are real organisations that employ people, hold
responsibilities and run publicly advertised events, and they are named where the public record
names them. Naming a listed responsibility is a different act from representing a view, and the
second one does not happen here. Nobody connected to either speaks in this twin, and no position is
inferred for either.

The acknowledgement, exactly as it is held in `data/lore.json` and shown on the arrival screen:

> Minjerribah is Quandamooka Country. This project acknowledges the Quandamooka People as the
> Traditional Owners of Minjerribah and of the lands and waters of Moreton Bay, and pays respect to
> Elders past and present. QYAC, the Quandamooka Yoolooburrabee Aboriginal Corporation, holds and
> manages the Quandamooka People's native title rights and interests. This is a simulation built
> from public records. It is not a cultural work and it does not speak for the Quandamooka People.

---

## Where to go next

`docs/CONTRACT.md` is the build contract. `docs/DIRECTION.md` says what the twin is for.
`docs/PARTICIPATION.md` has the ten contribution lanes. `docs/INGEST.md` is how an outside thing
becomes a record and `docs/CONNECTORS.md` is how a source that keeps changing does, in both
directions. `docs/CULTURAL-REVIEW.md` is the queue. `docs/KEYS.md` is the keyboard.

In the running build: press `G` for the civic board, `V` to lay data over the ground, `J` for the
chronicle of what has actually happened, `U` for the works below the sand, and `Y` for this
document on screen, with the island behind it.
