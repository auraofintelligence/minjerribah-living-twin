# Data notes

What each data pack could not verify. One section per pack. Written for the next agent and for a
local reader who will know instantly where we are wrong.

## businesses

`data/businesses.json`, 101 entries, written 6 August 2026.

Counts: 67 trading, 31 trading-unconfirmed, 1 proposed, 2 closed. Confidence: 46 high, 36 medium, 19 low.
48 entries carry coordinates; the rest are null rather than guessed.

### Corrections already applied from Luke's own repos

- Rufus King Seafoods is closed. Luke corrected this on 6 May 2026 in `stradbroke-grants-lab/data/entities.json`.
  Tourism and directory sites still list it as trading. It stays in the file with status `closed` so a future
  agent does not re-add it from a stale listing.
- Amity Point Progress Association has wound up. ABN 31 108 354 328 cancelled from 10 October 2024.
- Bo's Beans moved in with the venue at Amity Point that is now the Amity Pavilion. Same correction pass.
- Oceanic Gelati & Coffee Bar is now Whale Tail Gelati & Coffee Bar at the same site. The brief asked for both;
  they are one business.
- Sealevel 21 at 21 Ballow Street, Amity Point is now the Amity Pavilion, also registered as Amity Tavern
  North Stradbroke Island under TOOMEY FALCONER PTY LTD from 23 July 2025.

### Could not verify

1. **Trading hours.** Superseded on 10 August 2026 by the pass recorded below, which took the pack from seven
   published weeks to forty published or listed ones. The rule this line was written to protect still stands and
   is now enforced by `node tools/hours-envelope.mjs`: an estimate is not shown to a player as a week.
2. **Every headcount.** No `employs` figure was verified. All are modelling estimates with `basis: "estimate"`.
   The ones most likely to be wrong are QYAC, Yulu-Burri-Ba, SeaLink and Redland City Council, where the
   organisation extends well beyond the island.
3. **Every `peak_multiplier_estimate`.** These are modelling numbers, not measured trade data. Nobody has given us
   turnover, covers, occupancy or foot traffic for any business on this island.
4. **Address conflicts, unresolved:**
   - The Blue Room: 1 Mintee Street (Discover Stradbroke) versus 27 Mooloomba Road (Luke's own workbook).
   - Amity Point General Dealers: 9 Ballow Street (Yellow Pages, Luke's workbook) versus 1 Llewellyn Street
     (Discover Stradbroke).
   - Bo Beans Coffee: 21 Ballow Street versus 44 Sovereign Road. Address left null.
   - Oasis on Straddie: 83 Dickson Way versus "Oasis Mexican Cantina, East Coast Road".
   - NSI Recycling and Waste Centre: Dickson Way versus East Coast Road. These may be one facility described twice.
5. **No street address found at all** for Pandanus Palms Resort, Whalewatch Ocean Beach Resort, Allure Stradbroke
   Resort, The Islander Holiday Resort, Ray White North Stradbroke Island, Straddie Sales & Rentals, QYAC,
   Straddie Chamber of Commerce, Dunwich police station, and the volunteer groups. Coordinates are null for these.
6. **Low-confidence entries that need a local eye before they appear in the world:** Bella Balena Gelateria,
   Loaves Bakery, Prawn Shack, Straddie Eats, Island Juice, Mint Sushi, CJ's Island Pizza, Bistro Seymour,
   Barn Cafe, Dunwich Bakery, Perry's Seafood Van, Spar Express Dunwich, The Islander Holiday Resort,
   Australia Post Amity Point LPO, Goompi Trail, QAS Point Lookout, Nareeba Moopi Moopi Pa,
   NSI Aboriginal and Islander Housing Society, Point Lookout Bushcare.
   Several of these come from a single 2026 restaurant listing or from Luke's own research layer, which he
   himself labelled "explicitly guessed from the Straddie research directory, a conversation map, not a claim".
7. **Emergency services structure.** We confirmed that police, ambulance, rural fire and SES all operate on the
   island, but not station addresses, crew sizes, rostering or whether Point Lookout has a permanently staffed
   ambulance point. The SES unit could not be confirmed as a distinct island unit and was left out rather than
   invented.
8. **Redland City Council on-island presence.** Whether there is a staffed customer counter on the island was not
   confirmed. Island-based staff count is a guess.
9. **Bike and 4WD hire.** The brief asked for Straddie Super Sports as bike and 4WD hire. Public listings describe
   it as the island's outdoor gear and sporting goods shop. Hire was not confirmed and is not claimed.
10. **Named in the brief but not written in:**
    - North Stradbroke Island Dive and Manta Scuba: the only dive operation we could confirm is Manta Lodge &
      Scuba Centre. Treated as one business, not three.
    - "Straddie Holiday Rentals" and "Stradbroke Island Holidays" as agency names could not be confirmed as current.
      The agencies that could be confirmed are Ray White North Stradbroke Island, Discover Stradbroke,
      Straddie Sales & Rentals and Dolphin.
    - "Island Fruit Barn", "Sea Shanty", "Look Cafe" and "The Green Room" could not be confirmed as trading and
      were left out rather than guessed. Do not assume they are gone; assume we could not check.
    - Yalingbila Bibula (Whale on the Hill) is a QYAC project at Mulumba, not an operating tour business, so it is
      not in this pack. It belongs in the places or lore pack with its own sourcing.
    - "Straddie community hall": there are three halls (Dunwich, Point Lookout, Amity Point) and all three are in.
11. **Sandy Sports Club** is in the file with status `proposed`. It is Luke's own proposed incorporated association
    from `10_entities`, not an existing club. It must never render as a real venue.

### Cultural care

QYAC, QUAMPI, MMEIC, Salt Water Murris, Straddie Adventures, Yura Tours, Goompi Trail and the Delvene
Cockatoo-Collins shopfront are in this pack as civic and commercial entities only. No cultural content, language,
story or ceremony has been attached to any of them, and none should be generated. Anything cultural goes through
`docs/CULTURAL-REVIEW.md` and a human conversation with the Traditional Owners.

### Opening hours, reviewed 10 August 2026

Before this review, ninety-two of the hundred and one records carried a researched weekly pattern flagged
`estimate` and the simulation reported a number of businesses open with nothing behind it. Every trading
business, club and service was then looked for, one at a time, on its own site first and then on a council,
tourism or island listing. Hours now carry a `basis`, a `source`, a `source_kind`, the date somebody looked
and their own confidence, and the interface shows all five.

**Twenty-three carry hours the body published itself.** Stradbroke Island Beach Hotel, Point Lookout Bowls
Club, The Point Bar and Bistro, Little Ship Club, Six Beaches, FoodWorks Point Lookout, FoodWorks Dunwich,
Stradbroke Pharmacy, Point Lookout Pharmacy, Stradbroke Island Medical Centre, Marie Rose Centre,
Yulu-Burri-Ba, NSI Museum on Minjerribah, Whale Tail Gelati, Straddie Brewing Co, Bo Beans Coffee,
North Stradbroke Island Golf Club, Salt Water Murris, The Amity Pavilion, Amity Point Community Club and the
NSI Recycling and Waste Centre. Two of those, Marie Rose and the waste centre, stand at their 6 August check
because the health service directory and every Redland City Council page refused to serve on 10 August 2026.

Two more were added in the second pass on 10 August 2026 and neither is a shop. **Minjerribah Moorgumpin
Elders-in-Council** publishes office hours of Monday, Wednesday and Friday, 9am to 3pm on its own site, which
replaced a Monday to Friday roster nobody had published; the other four days are left unverified because the
site does not mention them. **Dunwich State School** publishes its office as open 8.30am to 3.30pm, school
starting at 9.00am and concluding at 3.00pm, with breaks at 10.45 and 1.00. Neither record is asked whether it
is open: see `hours_posture` below.

**Seventeen carry hours somebody else published**, almost all of them Discover Stradbroke's island restaurant
listing, marked `listed` rather than `published` for a reason worth keeping in view: that same listing still
carries Rufus King Seafoods as trading daily when the owner confirmed on 6 May 2026 that it had closed, and
still lists The Amity Pavilion under its previous name. It is a real, citable, public source and it goes stale
without telling anybody. Where the business publishes its own hours, the business wins, and the difference is
recorded in the note: Straddie Brewing's own page says shut Tuesday and Wednesday while the listing gives it
a seven-day week.

**Thirty-four remain estimates and twenty-five carry no week at all.** The split is the second pass's doing and
it is the point of it. An estimate is a guess the simulation runs on, and it now appears on screen as one line
of prose with the simulation as its subject, never as seven rows under a heading reading THE WEEK. A `basis` of
`none` is a blank: seven unverified days and nothing invented, which is the honest state for a body that was
never going to have trading hours. Thirteen of the estimates carry `checked: null`, meaning nobody has gone
looking rather than somebody looked and found nothing.

**Twenty-four records carry an `hours_posture` and are never asked whether they are open.** Eleven
organisations (QYAC, MMEIC, the chamber of commerce, the council, the housing society, the aged care service,
the three halls, Friends of Stradbroke Island, Point Lookout Bushcare, and Dunwich State School), seven on-call
services (both ambulance stations, the police station, the rural fire brigade, marine rescue, wildlife rescue
and the mobile vet) and five transport operators that run to a timetable rather than opening. Their `open` is
null for the life of a run, not false, and every layer above carries the null. An ambulance station reading
SHUT at two in the morning is a lie with consequences; a card reading SHUT over an Elders' council is this
project describing how somebody else runs, which it is not allowed to do.

The ones worth a phone call first, because they are the gaps that most change what the island does:

- **QUAMPI.** Opened September 2025 and no opening hours are published anywhere found, including the
  Queensland Government tourism listing. One call closes it.
- **Australia Post at Dunwich, Point Lookout and Amity Point.** Australia Post's own locator is script-driven
  and returned nothing readable. Third-party listings circulate a weekday nine to four and disagree with each
  other about the close.
- **Straddie Super Sports.** Two directories give it two different weeks. Neither is the business. An early
  opening matters here because this is where the bait comes from.
- **Minjerribah Camping.** Runs the campgrounds at Adder Rock, Cylinder, Home Beach, Amity Point, Flinders and
  Main Beach, and publishes no office or gate hours. A Friday arrival that misses the office is a real problem
  and the twin cannot model it truthfully yet.
- **Straddie Sharks All Sports Club.** The club publishes its weekly events in detail, meat trays and the
  members draw and trivia, and no club opening hours at all. The Jade Lime bistro's three published event
  nights are recorded; the rest of its week is not.
- **Stradbroke Island Butchery, Cellarbrations Dunwich, Bistro Seymour, Mal Starkey Seafood, Noreen's Seaside
  Shop.** Each has a site or a listing that either carries no hours or would not serve its pages.
- **Point Lookout Markets.** The island tourism page still lists dates from 2019 and 2020. The twin runs them
  every second Sunday, which is what that stale list shows, and that is a modelling choice sitting on an old
  page rather than a fact.

**What is modelled rather than published, and is labelled modelled everywhere it shows:** what the weather,
the swell and a beach shut to vehicles do to anybody trading outdoors; the early close a thin business makes
to save wages; the quiet-season midweek shutdown; the stretch an estimate-hours cafe gets while the island is
full; and the short menu when the barge did not run and the cold room is empty. No source on this island
publishes any of that.

**The show holiday.** Redland City, which is where Minjerribah is, does not take Brisbane's Ekka day. Council
asked the state in 2013 to gazette the Monday before People's Day and has kept it since, so the island has a
public holiday on the Monday and Brisbane has one on the Wednesday. The gazetted People's Day date is read per
year (2026, 2027 and 2028 are in `src/systems/agents/schedule.js`); the island's Monday is derived from
council's published rule. A year nobody has read is left empty and says so.

### Where to check next

The fastest way to fix most of the above is one conversation with someone on the island, or one pass through the
Straddie Chamber of Commerce member list. Web listings for this island go stale quickly and several of them are
demonstrably wrong right now.

## places

`data/places.json`, 58 records, written 6 August 2026. Sources in priority order: Luke's own repos
(`quandamooka-country-events-engine`, `plfc-community-platform` PLFC KMZ), then public verification
(Queensland Heritage Register, Wikipedia, Redland City Council, Minjerribah Camping,
stradbrokeisland.com, OpenStreetMap via Nominatim), then general knowledge.

Every record carries two separate confidence fields: `confidence` (does this place exist under this
name in this township) and `coordinate_confidence` (how good is the point). 13 records have a
low-confidence coordinate. Two records have deliberately null coordinates rather than a guess.

### Could not verify at all

- **Bob Jarrett Park.** Named in the brief. Absent from the Redland City Council park list and from
  the stradbrokeisland.com park list, which between them name every other park in the brief.
  Left in the pack with null coordinates and `confidence: low`. Needs Luke to say which park this is
  and which township, or it should be dropped.
- **Thankful Rest.** Named in the brief. Does not appear on the current Minjerribah Camping
  campground list. One travel source states the old Thankful Rest campground is now called
  Home Beach campground; another describes it as a separate peak-period area beside Home Beach.
  Left with null coordinates. Luke will know which reading is right.
- **Whale Rock.** The name and the blowhole are confirmed by the Queensland Heritage Register
  citation for the Point Lookout Foreshore, but no gazetteer or OSM coordinate exists. The lat and
  lon in the pack are an estimate placed on the seaward side of the gorge walk and must be corrected.

### Wrong in the brief, corrected in the pack

- **Nandeebie is not Adams Beach.** The brief pairs them. Public sources record Nandeebie as the
  Quandamooka name for **Cleveland on the mainland**, the ferry departure side, not for Adams Beach
  at Dunwich. No alternate name has been attached to Adams Beach. If Luke has a local source that
  says otherwise it should go in and this note comes out.
- **The Amity "sand blow" is a slump, not a blow.** The published mechanism at Amity Point is
  foreshore slumping and flow slides driven by the eastward migration of Rainbow Channel, not a
  wind-driven sand blow. The record is `amity-erosion-zone` and it uses the council SEMP language.
  Its coordinate is an approximate mid-point of the affected reach, not a surveyed boundary; the
  council SEMP splits the shoreline into northern and central reaches and those should be used
  for anything precise.

### Coordinates that need a local fix

- **Myora Springs.** Two OSM records disagree. The pack uses the Myora Conservation Park centroid
  (-27.4777, 153.4166), which matches the published "4.5 km from Dunwich on East Coast Road" and sits
  near the coast. A separate OSM node named Myora Springs sits about 1.2 km inland at
  (-27.4687, 153.4254), which does not fit a spring that runs through mangroves into the bay.
  The roadside boardwalk point is the one actually wanted.
- **Dunwich barge ramp.** Public data would not separate the vehicle barge apron from the Junner
  Street passenger pontoon. The pack uses the terminal precinct point. The Stradbroke Ferries ticket
  office is at (-27.5032366, 153.4015771) per OSM but a White Pages listing gives a Ballow Road
  address, which suggests the ramp is a short way south.
- **Home Beach.** OSM puts it at the western end near Adder Rock (-27.42366, 153.51968);
  Luke's events engine puts it about 800 m east (-27.427839, 153.526489). Both are on the beach.
  A mid-beach anchor should be set locally.
- **Amity Point boat ramp vs jetty.** Two sources 125 m apart. The pack uses the PLFC KMZ value for
  the ramp and the events engine value for the jetty park, on the assumption they are two structures.
  No OSM record exists for the jetty itself, so the jetty coordinate is on land.
- **Reused precinct coordinates in the upstream data.** The events engine repeats the single point
  (-27.4276707, 153.527027) for Home Beach campground, Adder Rock Park, Point Lookout Hall Park,
  Point Lookout Skate Park and the oval toilets. It is a Dickson Way precinct fallback, not a real
  location for any of them. Only `home-beach-campground` carries it here, flagged low.
- **Dunwich pool.** The events engine coordinate for the pool is identical to the OSM coordinate for
  Dunwich State School, so the pool is on or immediately beside the school grounds. Whether it is a
  school facility, a council facility or shared is unconfirmed.
- **Naree Budjong Djara National Park.** The coordinate is a centroid over 132 sq km and is not a
  usable point for anything. Use the Blue Lake coordinate for player interaction.
- **Dunwich Benevolent Asylum site.** Remains are dispersed and partly on land in other uses.
  The coordinate is an estimate in the township and what is publicly accessible was not established.
- **Main Beach camping area.** The coordinate sits near the northern access at Point Lookout;
  the camping stretch runs many kilometres south of it.
- **Adams Beach.** The coordinate is the campground point and may sit behind rather than on the beach.

### Language and cultural gaps, for `data/lore.json` and `docs/CULTURAL-REVIEW.md`

Quandamooka names are recorded only where a published public source uses them. Spellings vary between
sources and the variation has been kept rather than resolved. **QYAC is the authority on all of this,
not this file.** Specifically:

- **Amity Point: Pulan or Bulan.** Luke's events engine uses Pulan throughout. Wikipedia records
  Bulan. Both are in public circulation. Unresolved.
- **Point Lookout: Mooloomba or Mulumba.** The Queensland Heritage Register records the foreshore as
  also known as Mooloomba, and Mooloomba Road carries that spelling. stradbrokeisland.com uses
  Mulumba. Unresolved.
- **Blue Lake: Karboora or Kaboora.** Wikipedia uses Karboora; stradbrokeisland.com uses Kaboora and
  gives the meaning as "deep silent pool". The meaning is quoted from that source, not asserted.
- **Brown Lake: Bummiera or Bummeria.** Both spellings published.
- **Myora Springs: Capembah or Capeembah.** Both spellings published. Moongalba, the sitting-down
  place associated with Oodgeroo Noonuccal, is a **separate place** nearby and has not been recorded
  in this pack; it needs its own entry with proper cultural sourcing.
- **Brown Lake cultural significance.** Published sources (Wikipedia, a 2020 Queensland Government
  media release, QYAC quoted material) record Bummiera as a women's place of deep significance and
  describe a permission protocol before entering the water. This has been summarised narrowly in the
  place record with citations. It should not stay in `places.json` as the primary record: it belongs
  in `data/lore.json` with full sourcing, and the question of whether it belongs in a game at all is
  a CULTURAL-REVIEW question for QYAC, not a data question.
- **Blue Lake / Karboora** is described in public sources as an area of special cultural
  significance. No protocol detail has been recorded. Same treatment needed.
- **No sacred site, story or ceremony has been placed in the world by this pack.**

### Known thin spots

- Best-time and hazard fields are grounded but general. Patrol seasons and hours for the Point
  Lookout SLSC, current camping permit conditions, and current park access rules all change and
  none of them were confirmed against a live current source.
- Capacity numbers exist for only four records (Adder Rock sites, Flinders Beach sites,
  Dunwich Cemetery burials, Naree Budjong Djara area) plus 2021 census populations for the three
  townships. Everything else has no published number.
- Beaches and walks are lines, and each carries a single point. Anything that needs a real extent
  (drawing the beach, running agents along it, placing the surf) needs a geometry pack, not this one.

## ecology

`data/ecology.json`, written 6 August 2026. 16 habitats, 51 species, 14 plants, 9 weed entries,
9 processes, a four-season calendar. Every species carries `source`; every uncertain number carries
`confidence` and a `basis` string saying where it came from.

The backbone of the species list is the Queensland Department of Environment, Tourism, Science and
Innovation WetlandInfo wildlife dataset for the North Stradbroke Island DIWA nationally important
wetland. That gave verified scientific names and both NCA and EPBC statuses for the mammals, birds,
reptiles and amphibians. Where a fact came from anywhere weaker, it says so.

### Deliberate corrections to the brief

- **Blue Lake is a window lake, not a perched lake.** Karboora sits in a hollow that intersects the
  island's water table, so its level follows the aquifer. Brown Lake (Bummiera) is the perched one,
  sitting above the water table on a sealed organic layer, so it follows rainfall. This matters for the
  simulation: draw the water table down and Karboora, Eighteen Mile Swamp and the frog wetlands respond
  while Brown Lake looks fine. The brief had these the wrong way round.
- **There are no dingoes on Minjerribah.** Local sources give the absence of large predators as an island
  characteristic. A dingo record does appear in the DETSI dataset for the wetland boundary, which is
  probably historic or a boundary artefact. Recorded as an explicit zero so a later agent does not add
  them from K'gari habit.
- **Do not call the island koalas chlamydia-free.** Lower disturbance correlates with less clinical
  disease than stressed mainland populations, and the population is genetically distinct after roughly
  8,000 years of isolation. But disease is still the second-ranked recorded mortality cause on the island
  (vehicle strike 35, disease 21, dog attack 16, 1997 to 2010). The file says present-but-lower.
- **Foxes are largely won, not lost.** The coordinated program reports about 90 per cent of foxes removed
  and no recorded turtle nest predation since late 2016. An older advocacy estimate of 1,000 to 2,000
  foxes is in the file marked historic. This is the island's clearest ecological success and the pack
  models it as reversible, because the lever is a recurrent budget line.

### Could not verify

1. **No island-wide koala population figure exists in public.** The Redland City Council and University
   of the Sunshine Coast drone survey reports from December 2020 both return HTTP 403 to an automated
   fetch. The only usable number found was a 2019 two-day survey that spotted 33 koalas at selected sites,
   which is not a population. The file carries a modelling range of 200 to 600 marked `confidence: low`
   with the basis spelled out. **This is the single biggest gap in the pack.** Someone with a browser, or
   a phone call to Council, closes it in ten minutes.
2. **The water numbers.** Island township extraction of about 1.6 ML/day, about 25 ML/day to the
   south-east Queensland grid, and up to 60 per cent of Redlands supply coming from the island are all
   from secondary reporting, and one licence figure in the same source was garbled ("750 ML/day for Amity
   Point", which cannot be right). The Seqwater North Stradbroke Island Drought Response Plan is the
   document to read; it is a scanned PDF and would not text-extract. All four figures are marked low.
3. **Amity Point erosion has no published rate.** The mechanism is well documented and specific:
   episodic flow slides plus the southerly migration of the Rainbow Channel. What is missing is metres per
   year, flow slide frequency, the length and date of the existing rock wall, and beach nourishment
   volumes. The pack models it as episodic with null parameters rather than inventing a rate.
4. **Ringtail possum presence.** A local tourism page says they are present but rarer than brushtails.
   The DETSI native mammal list read for this pack does not include *Pseudocheirus peregrinus*. Flagged
   `verification_flag`; ask a local before showing one to a player.
5. **Bitou bush, lantana and groundsel.** The brief named all three. None appeared on the Friends of
   Stradbroke Island weed list, which does name asparagus fern, Easter cassia, umbrella tree, broad-leaf
   pepper, ochna, mother of millions, glory lily, purple succulent, Indian hawthorn, Brazilian cherry and
   sisal. The three named in the brief are in the file as a single low-confidence entry with the flag on it.
6. **Feral deer.** Not named in any island pest source read. Recorded as an explicit zero with the note
   that this is an absence of evidence, not a confirmed absence.
7. **Yellow-tailed black-cockatoo.** Not in the DETSI bird dataset for the island. Left out. Glossy
   black-cockatoo is in and verified as Vulnerable under both Acts.
8. **Dune erosion and accretion rates.** The storm cut volume range of 20 to 80 m3 per metre and the six
   to thirty-six month recovery window are order-of-magnitude placeholders for an exposed east coast sandy
   beach, not measurements from this island. Replace with beach survey data if any can be found.
9. **Fire intervals.** The 7 to 15 year wallum target interval, the 5 to 10 year she-oak recovery and the
   30 per cent unburnt refuge target are all modelling placeholders. The 2013 to 2014 fire figures are
   real: 16,800 ha, about 70 per cent of the island's bushland, from a single lightning strike, over just
   over two weeks from 29 December 2013, with more than 900 campers evacuated.
10. **Coordinates.** Every coordinate in this pack is an approximate centroid marked
    `coord_confidence: low`. They exist so systems have something to hang on. Reconcile them against
    `data/geography.json` and delete these when that pack is authoritative.
11. **Population figures that are bay-wide, not island-wide.** Dugong (601 in 2016), eastern curlew
    (2,304), bar-tailed godwit (12,134), bottlenose dolphin (554), Australian humpback dolphin (128) are
    all Moreton Bay counts. The file says so on every one. Do not let a UI panel present them as island
    numbers.
12. **Manta ray and grey nurse counts.** Photo-identification catalogues exist for the Point Lookout
    manta aggregation and diver counts exist for the Flat Rock grey nurse aggregation. Neither total was
    found. Both are null with the seasons and the protection rules verified.

### Two items routed to cultural review

The historic cooperative dolphin fishing relationship at Amity Point, and the role of cultural burning in
the survival of the island's old cypress pines, are both in the file with published citations and a
`handling_rule` saying they must not be rendered to a player from this pack. Both are written up in
`docs/CULTURAL-REVIEW.md`.

## events

`data/events.json`, written 7 August 2026, widened 10 August 2026. **36 events, 7 periods,
11 rhythms**, 10 visitor archetypes, plus an explicit `left_out` list of **13** things that are not
in the file and why.

What the 10 August pass added, in one place. Events: live music at the Stradbroke Hotel on a Friday
and a Sunday and at the Little Ship Club on a Saturday, Friday Reef and Beef at the bowls club, the
Arthur Mobsby Seafood Spectacular, Pig Day Out, Tones and Tides, the museum's heritage walk, the
gallery and museum hop, and a Red Cross preparedness workshop. Periods: the publicly notified
planned burn season, and the builders' summer shutdown that the simulation has modelled since the
residents slice but never showed. Rhythms: the council meeting cycle, because the decisions this
island lives with are taken in a chamber on the mainland at 9.30 on a Wednesday morning, and the
ferry's peak timetable and public-holiday surcharge. One correction: the Straddie Salute's date rule
said the third Friday of May, which is the right day in 2026 and a week late in 2027; the organiser
publishes Saturday 15 May 2027, which is the third Saturday, so the rule is now the third Saturday
with the festival running the Friday to the Sunday around it.

The same pass wired the pack into the simulation for the first time. `sim_defaults.event_visitor_increment`
is new and is the one number in this file that changes the island's population; it is a modelling
assumption, it is written as data so it can be argued with, and the annual carve-out it describes is
why a year of this island still sums to the 375,000 in `data/residents.json` rather than to
375,000 plus a pile of festival goers.

Sources in priority order: Luke's own repos (`quandamooka-country-events-engine` for the event atlas
and its 22 May 2026 source pass, `straddie-night-market-lab` for the ferry fleet and transport scan,
`plfc-community-platform` for the fishing club field-board pattern), then public verification
(the organisers' own sites, Education Queensland, Fair Work Ombudsman, NAIDOC, Surf Life Saving,
Redland Bayside News, visit.brisbane, stradbrokeisland.com), then general knowledge marked as such.

Every event carries `confidence` and `source`. Nothing was invented. Where the brief named something
that could not be confirmed, it is in `left_out` with the reason, not in the file with a guess.

### Wrong in the brief, corrected in the pack

- **There is no Point Lookout Football Club.** The brief asked for its fixtures. PLFC on this island is
  the **Point Lookout Fishing Club**, an incorporated association operating out of the Bowls Club, which
  Luke co-founded. Rugby league on Minjerribah is the **Straddie Sharks** at Ron Stark Oval, Dunwich,
  and that is what the fixtures record actually covers.
- **The Straddie Assault is now the Gage Roads Straddie Invitational.** Same event, same October weekend,
  same Point Lookout Boardriders, a sponsor name on the front. Locals still say Assault. Both names are
  in the record.
- **Island Vibe Festival is over on this island.** The brief asked for it as a current event. Its final
  Minjerribah edition was 25 to 27 October 2024 at Home Beach, the eighteenth, with about 1,500 people.
  It is in the pack with status `ended` because the reasons it stopped are civic levers a planner in this
  simulation has their hands on: Minjerribah Camping closed over the festival weekend two years running,
  council compliance costs for traffic, fencing and safety officers rose about A$30,000 from 2022, and a
  disputed A$4,948 ground maintenance bill followed the last one. The director called it a hiatus on the
  island and said he would take the festival elsewhere.
- **The Quandamooka Festival is not only a weekend.** The 2026 public listing is two days, 29 and 30
  August. Reporting on an earlier year describes a season running about 1 June to 31 August with separate
  named days. Both patterns are recorded so nobody assumes it is only ever a weekend.
- **Point Lookout SLSC says "the only Surf Life Saving Club in Australia"**, not in Queensland, to
  actively patrol two beaches and rove six others. Its own words are used.

### Could not verify

1. **Every attendance figure except one.** No gate count, ticket count or crowd estimate is published for
   any event on this island. The one sourced figure in the pack is the roughly 1,500 people at the final
   Island Vibe. Everything else is a modelling estimate with `basis: "estimate"` and low confidence.
   Do not display any of them to a player as fact.
2. **Every `needs` number.** No event management plan, traffic management plan, permit condition or
   council report was read for any event. Parking spaces, toilet counts, water and bin numbers are all
   modelling estimates.
3. **Every `crowd_curve`.** Shaped from published start and finish times where those exist, and from the
   ferry timetable where they do not.
4. **The ferry timetable itself.** The single most load-bearing gap in the pack. The SeaLink timetable
   page returns HTTP 403 to an automated fetch and the Stradbroke Flyer publishes its timetable as an
   image. What is in the file is a published prose description: vehicle barge roughly hourly from about
   06:00, 45 to 50 minutes, extra Friday and Sunday sailings; water taxi about 25 minutes from about
   04:45 to about 20:15. **Nobody has transcribed a real sailing time into this repo.** Anyone with a
   browser can fix it in five minutes and should, because half the behaviour in this pack keys off it.
5. **Ferry fleet capacities.** Minjerribah 52 cars and 400 passengers, Sea Breeze 60 cars and 300,
   Quandamooka 52 cars and 400, Yalingbila 198 passengers. These come from Luke's own
   `straddie-night-market-lab` research notes, which cite a SeaLink fleet page read on 11 May 2026. That
   page now returns HTTP 403, so they were not independently re-verified.
6. **Bin day.** Recorded as a Monday collection with bins out Sunday afternoon. The only source found is
   a holiday letting agency's departure information page. The Redland City Council bin day tool is
   address-by-address and could not be queried without an island address. Whether recycling alternates,
   and whether all three townships are on the same day, is unconfirmed. Five minutes for anyone with a
   Straddie address.
7. **The waste transfer and barge removal cycle.** No public data on tonnage, barge slot allocation,
   removal frequency or facility capacity. The rhythm record says so. This is the biggest unfilled gap
   for anyone modelling event load honestly, because on this island waste is a stock with a barge-limited
   outflow, and that is what makes an event cost something real.
8. **Peak island population.** No published figure exists for how many people are on Minjerribah at
   Christmas or New Year. The 2021 census gives 1,975 residents across the three townships. The multiple
   at peak is a modelling estimate.
9. **Annual visitors.** About 400,000, or a range of 350,000 to 400,000, appears in tourism and travel
   guide copy. No Redland City Council, Tourism and Events Queensland or SeaLink figure was found to
   confirm it. Marked low confidence in `reference_2026` and flagged as not for display.
10. **Working bee frequency.** Point Lookout Bushcare and Friends of Stradbroke Island are both real and
    both in `data/businesses.json`, but neither publishes a working bee calendar that could be read. The
    monthly Saturday pattern in the file is an invented modelling default, labelled as one, and must be
    replaced with the real calendar before anything is shown to a player.
11. **Point Lookout Fishing Club competitions.** The club is real, incorporated and running competitions
    and social trips. No competition names, dates or calendar are published, and the field board in
    Luke's own PLFC prototype is explicitly labelled sample data. None of its sample solunar or tide
    times were copied into this pack. The tide-driven fishing window rhythm carries the club's actual
    behaviour instead.
12. **Surf carnivals.** The brief asked for them. Point Lookout SLSC's own history records members
    attending carnivals since the 1950s and Nippers competing against other clubs, but no current home
    carnival on this island could be confirmed. Left out.
13. **Dunwich markets.** The brief asked for them. No current regular market at Dunwich could be
    confirmed. Market stalls appear at Dunwich inside the Quandamooka Festival and the Oyster Festival,
    as part of those events rather than as a standing market. Left out rather than invented.
14. **Point Lookout Markets dates.** Published as every second Sunday with extra holiday dates. The only
    date list found on the official visitor site runs from 2019 to 2020. No current schedule exists in
    public that could be read.
15. **Straddie Arts Trail dates.** Sources give both 13 to 16 August 2026, described as four days, and
    14 to 16 August. The wider range is used so the simulation does not under-book the load. The "more
    than 70 artists" figure appears in a guide summary and could not be confirmed on the organiser's own
    page, so it is not asserted. The published stop directory also includes Cleveland stops, which are on
    the mainland and outside this simulation's boundary.
16. **The Gage Roads Straddie Invitational edition number.** One source says the 41st running was 2024,
    another says 2026. No edition number is recorded. The 1983 first year is from the visit.brisbane
    listing and is the only date claimed.
17. **The Stradbroke Chamber Music Festival edition number.** One listing says the 18th, another says the
    19th year. Not recorded.
18. **Bowls club Wednesday trivia.** On the club's what's-on pages and in Luke's events engine from a
    May 2026 pass, but not visible on the club's front page at the time of writing. Recorded as medium.
    Sunday barefoot bowls from 16:00 is on the club's own front page and is recorded as published.
19. **School bus times and bell times.** The North Stradbroke Island Bus Service publishes its school
    timetables as images. Nothing was transcribed. The morning and afternoon windows in the `school-run`
    rhythm are estimates, as are the secondary school ferry times. What is confirmed is that Dunwich
    State High School closed in 2012 with six students enrolled, and that every island secondary student
    now attends Cleveland District State High School on the mainland.
20. **Whether Point Lookout or Amity Point hold their own Anzac Day services.** The public 2026 notice
    covers Dunwich only. That is not the same as saying the other two townships hold nothing.
21. **The Straddie Salute course.** The distances are published (750 m swim, 15 km mountain bike, 8 km
    run) but the route is not published as a line, so no road closure extent is recorded. The road strain
    level in that record is the least evidenced number in the pack.

### Places and businesses this pack needs and cannot find

Gaps in the other packs, surfaced by writing this one:

- **The Dunwich cenotaph on Welsby Street.** Both Anzac Day services happen there. It has no record in
  `data/places.json`, and `data/geography.json` has no Welsby Street at all.
- **A North Stradbroke Island RSL Memorial Club at 23 Mallon Street** appears in an Anzac Day listing and
  is not in `data/businesses.json`. Mallon Street is in the roads data, so the address is plausible.
- **QUAMPI** is in `data/businesses.json` but has no `data/places.json` record, so the Quandamooka
  Festival and the Arts Trail opening have no venue point to sit on. The 2026 festival listing gives
  100 East Coast Road, Dunwich; Luke's events engine gives QUAMPI. These may be the same site.
- **Straddie Brewing Co**, **the North Stradbroke Island Golf Course** and **the offshore fishing
  grounds** all carry events in this pack and have no place records.
- **Point Lookout Boardriders** runs the island's biggest surfing event and is not in
  `data/businesses.json`.
- **Dunwich State School street conflict.** The school's own material and the schools directory give
  Bingle Road. The 2026 Anzac Day notice gives Welsby Street. They may be corners of the same block.
  Not resolved.

### Cultural care

The Quandamooka Festival and NAIDOC Week are in this pack as **civic load only**: dates, places, crowd,
ferries, bins, money. Published sources name specific ceremony days at specific places within the
festival season. **Those names are not written into this pack and must not be generated into the world.**
They are QYAC's, not ours. Both records carry a `cultural_handling` field saying so, and the question is
logged for `docs/CULTURAL-REVIEW.md`. The `quandamooka-festival-season` period record exists precisely so
that a later agent does not fill the June to August window with invented content.

### Sandy Sports Club

The brief asked for Sandy Sports Club events. Sandy Sports Club is Luke's own proposed incorporated
association, carried in `data/businesses.json` with status `proposed`. It has no events because it does
not yet exist. Nothing has been invented for it, and it must never render as a real venue.

### Where to check next

In order of how much they unlock:

1. Transcribe the real SeaLink and Stradbroke Flyer timetables. Half this pack keys off them.
2. One call to Redland City Council on bin day and on how waste actually leaves the island.
3. One conversation each with the Point Lookout Bowls Club, the Straddie Sharks and Point Lookout
   Bushcare would close the recurring-event gaps and the working bee gap in an afternoon.

## transport

`data/transport.json`, written 7 August 2026. 6 terminals, 12 services, 14 road segments, 3 parking
records, 8 structural facts, 2 live projects and 1 modelled scenario.

Sources in priority order: Luke's own repos first, then public verification, then general knowledge.
The single most valuable source was Luke's own `straddie-night-market-lab`, which holds a dated
timetable snapshot for the vehicle ferry, the SeaLink passenger ferry, the Stradbroke Flyer and
Translink routes 880 and 881, taken 11 May 2026, plus `docs/official-timetable-update-guide.md`,
which is a better refresh procedure than anything this pass could have written. Every timetable in the
transport pack was re-checked against operator and Translink pages on 7 August 2026.

### What is solid

Read in full and quoted from the primary document, so treat these as high confidence:

- **The SeaLink SEQ terms and conditions** (2024, mirrored at allurestradbroke.com.au). This gave the
  legal entity (Stradbroke Ferries Pty Ltd, ABN 63 009 725 713), the 20 minute vehicle check-in cut,
  the 2 hour online change cut, the A$10 cancellation fee, the 100 per cent no-show forfeit, the
  emergency-vehicle priority right, the animal rules, the free push bike carriage, and the whole
  walk-on freight regime including the counterintuitive rule that North Stradbroke Island walk-on
  freight goes on the **passenger** ferry, not the vehicle ferry.
- **The Dunwich Airfield (YDUN) operational guidelines**, effective 1 February 2024, read in full.
- **Translink North Stradbroke Island fares**: single A$0.50, daily A$1.00, weekly A$5.00, paper ticket
  only, not on the go card network.
- **Minjerribah Camping 4WD permit rules**: Main Beach 60 km/h, Flinders Beach 40 km/h, no driving
  2 hours either side of high tide, 4WD only, no all-wheel-drive, no motorbikes, no quad bikes.
- **The Redlands Disaster Plan island evacuation page**: evacuation centres with street addresses,
  assembly areas and the transport actually used.
- **Marine Rescue Queensland North Stradbroke**: base at Yabbie Street overlooking One Mile, operating
  since 1977, operating area, and the medical evacuation role with the Queensland Ambulance Service.

### Could not verify

1. **Every fare on the SeaLink website.** `sealink.com.au` returns HTTP 403 to an automated fetch on
   every page. So does `parks.qld.gov.au` and `tmr.qld.gov.au`. The vehicle ferry uses airline-style
   dynamic pricing, so the fare block in the pack is built from a news article (the resident flat fare),
   a SeaLink special-offer page (the A$79 off-peak floor) and a reseller (FIT Travel), which almost
   certainly carries a margin. **Someone with a browser closes this in five minutes.** It is the
   biggest single gap in the pack after the queue numbers.
2. **The Stradbroke Flyer fare is completely unknown.** New fares took effect 13 July 2026 and the
   operator publishes them as images, which no automated fetch can read. The field is `null` rather
   than a guess. A single Tripadvisor review quotes A$20 adult return, but it predates the change and
   is not used.
3. **Every number in the Toondah long weekend scenario that is not a vessel capacity or a
   published rule.** The demand curve, the 1,050 vehicles presenting, the 110-vehicle yard capacity,
   the wait times, the standby success rate: all modelled, all flagged, all shown with their
   arithmetic so one correction propagates. **The yard capacity is the worst of them.** No lane count
   or marshalling capacity for Toondah Harbour is published anywhere found, and that number drives the
   whole spillover behaviour. The scenario carries a "how to falsify this" field: four hours at Toondah
   with a clicker on the Friday of a long weekend replaces every assumed input.
4. **Bus vehicle capacity.** Charter vehicles are advertised at 40 to 62 seats. The vehicle actually
   allocated to a scheduled 880 or 881 run is not published, so route capacity is `null`. A full bus at
   Cylinder Beach in January is a real event and the sim cannot currently size it.
5. **Stradbroke Flyer passenger capacity per vessel.** Not published in readable form. `null`.
6. **Point Lookout parking.** The brief asked for peak-season parking at Point Lookout. There is no
   published bay count for any car park or street there, and the Redland City Council parking page
   returns 403. The pack records free kerbside parking on Mooloomba Road and Dickson Way with a
   modelled search-time and walk-in distance, all confidence low. Everyone who lives there knows the
   real answer.
7. **The tide window for beach driving is published three different ways.** Minjerribah Camping, which
   issues and enforces the permit, says 2 hours either side of high tide. Visit Straddie says 1 hour
   15 minutes on one page and 1 hour on another. The pack uses 2 hours and records all three, because
   this is exactly the kind of thing that is signposted at the beach entrance and settled on sight.
8. **The 4WD permit price.** Two secondary sources conflict: A$53.65 for up to a month and A$160.80 for
   up to a year, versus A$55.90 for a month. The Minjerribah Camping permit page shows prices only
   inside its booking system. Both figures are in the pack, marked low.
9. **Whether the vehicle ferry has any tide restriction.** The Toondah channel is shallow and dredged.
   No published tidal restriction on sailings was found. The pack deliberately does **not** model a tide
   gate on the barge and says so, rather than inventing one. Beach driving tide rules are separate and
   are verified.
10. **Ferry weather thresholds.** No wind speed, wave height or cancellation trigger is published for
    this route. The operator's terms only say services may be altered without notice, including for
    adverse weather. Every wind number in the pack is a modelling placeholder marked low. What *is*
    high confidence is the negative: this crossing is entirely inside the bay, so **ocean swell is not
    a factor** and no swell term should be added to the ferry.
11. **Fog.** Plausible on a winter bay morning, not confirmed as a cause of cancellations here. Left as
    a named unknown rather than a modelled term.
12. **A second ambulance station at Point Lookout.** Referenced in a secondary read of the SeaLink
    island information page (which 403s directly) but not separately confirmed. This repeats an open
    question already recorded under the businesses pack. Dunwich station at Oxley Parade is medium
    confidence for the same reason.
13. **The Dunwich Airfield runway length.** Reported as 800 m in one aviation listing and 865 m in
    another, and not stated in the airfield's own operational guidelines. Left out rather than picked.
    The helipad exists per the guidelines but the operator currently directs helicopters to the apron
    south of the passenger shelter while remedial works are under way.
14. **Freight.** `stradbrokeislandcarriers.com.au` would not resolve on 7 August 2026. The business
    appears in directory listings. The A$26 per metre commercial vehicle rate comes from Luke's own
    knowledge base citing SeaLink, could not be confirmed against a current page, and has no known
    date. Marked low and described as an order of magnitude.
15. **Bike hire.** No current bike hire operator on the island could be confirmed. This matches the note
    already in the businesses section about Straddie Super Sports: public listings describe it as the
    outdoor gear shop and hire is not claimed. Scooter hire **is** confirmed and is in the pack.
16. **The Dunwich (Gumpi) terminal upgrade funding split** of A$10m Commonwealth, A$30m Queensland and
    A$1m Council came back from a search of the TMR and State Development pages, neither of which could
    be fetched directly. The scope, the consultation close date of 21 June 2026 and the Council position
    are from local news that could be read and are high confidence.

### Conflicts recorded rather than resolved

- **The Flyer timetable moved.** Luke's 11 May 2026 snapshot has the Flyer running ten minutes behind
  the times three current sources now publish (04:55 versus 04:45 and so on). The pack uses the current
  times and flags the snapshot as stale. A local who catches the Flyer weekly settles it in a sentence.
- **The two water taxis are near-identical, not identical.** Visit Straddie says plainly that both
  walk-on water taxis run an identical timetable. Checked departure by departure, eastbound matches
  minute for minute, and westbound matches on every departure except two in the afternoon, where the
  Flyer runs 16:45 and 18:00 against SeaLink's 17:00 and 18:15. That fifteen minute gap is the only
  place time, rather than which side of Dunwich you land on, is a reason to pick one over the other.
- **The Visit Straddie passenger timetable page has a visible row shift** in its Dunwich column from
  14:00 down, pairing 14:00 with 13:25, which cannot be right for a 25 minute crossing. Luke's snapshot
  pairs cleanly and is used.
- **The Sunday-only evening barge.** Luke's snapshot marks the late evening vehicle sailing Sunday only.
  A current read of Visit Straddie suggests Friday and Sunday. The pack uses Sunday only and flags it,
  because a Friday evening barge is precisely what a long weekend arrival depends on.
- **The resident flat fare end date.** One source says the A$59 standard car flat fare runs to
  31 March 2026, another to 31 March 2027. The A$59 and A$69 figures and the A$20 public holiday and
  peak Christmas surcharge are consistent across both.
- **The Toondah long term car park waitlist.** The same SeaLink page returned "longer than a year" and
  "longer than 4 years" on two reads on the same day. The page appears to have been updated between
  them. The pack says "years, not months" and states no number.
- **Scooters On Straddie location.** The operator's own site gives 126 Dickson Way, Point Lookout. A
  tourism listing places the business in Dunwich and is the source of the 27-scooter fleet count. The
  operator's address is used; the fleet count is marked indicative.

### Named in a source but deliberately left out

- **"Trans Island Road".** One travel blog calls the trans-island road this. It returns nothing in
  OpenStreetMap. The mapped name is Alfred Martin Way and that is what the pack uses. If locals do say
  Trans Island Road, it should go in as an alias, not as a replacement.
- **"Tripod Track".** Named in the same blog as a sand track between the Alfred Martin Way area and the
  East Coast Road about 200 m west of the Beehive Road intersection, no permit required, access points
  unmarked. Not in OpenStreetMap and not in any official source found. **Left out of the road segments
  entirely** rather than added on one blog's word. It may be the same thing the geography pack already
  has as Fishermans Road, or it may not. Luke will know in a second.
- **A Point Lookout ambulance station** as a separate asset, for the reason in point 12 above.

### Status flags a local should check first

- `svc-stradbroke-cab` is `trading-unconfirmed`, carried forward from the businesses pack. Two vans for
  the whole island, one of them the only wheelchair accessible vehicle on Minjerribah. If that is still
  true it is one of the most consequential facts in the whole dataset, and if it is not, several
  scenarios change.
- `svc-yura-banji-scooters` is `closed-unconfirmed`. The company entity and booking site exist, but a
  search result reports the operator has closed to start something new. It must not render as an
  operating business until confirmed. Nothing cultural has been attached to it beyond what the operator
  publishes about itself, and the trading name is not translated or interpreted anywhere in the pack.
- `svc-freight-carriers` names Stradbroke Island Carriers on directory listings only, because the
  carrier's own site would not resolve.

### Cultural care

Nothing cultural is asserted in this pack. QUAMPI appears only as a published Translink bus timing
point. Brown Lake Drive is recorded as a road that goes to Bummiera, with an explicit pointer that the
cultural record belongs in `data/lore.json` and `docs/CULTURAL-REVIEW.md`, not here. The walking track
names carried in the geography pack come from OpenStreetMap and have **not** been checked against a
park authority sign or against QYAC; that is flagged in the walking section of the transport pack and
is a cultural-review question, not a transport one.

## civic

`data/civic.json`, written 7 August 2026. 62 levers, 50 metrics, 19 interest groups, 23 issues,
19 institutions, 14 instruments. Sources in priority order: the author's own repos, then public
verification (Queensland Audit Office, Queensland Government ministerial statements, Queensland Parks,
QYAC, Redland City Council and Your Say Redlands, ABS), then general knowledge marked low.

The single most important field in the pack is `who_decides`. Of 62 levers, 19 are the player's to
decide, 17 are the player's to fund, 25 the player can only advocate for, and one the player can only
watch. That distribution is the argument the pack is making about this island.

### What was verified and is safe to show a player

- Division 2 of Redland City Council covers Cleveland and North Stradbroke Island together.
- The 2011 native title determination areas, and QYAC as the Registered Native Title Body Corporate.
- Joint management of Naree Budjong Djara National Park and the Minjerribah Recreation Area by QYAC and QPWS.
- Minjerribah Futures funding: $20 million rising to $39.4 million approved, $30.6 million spent as at
  30 April 2024, $8.74 million direct to QYAC July 2016 to December 2021, and the three audit findings.
- The Amity Point Shoreline Erosion Management Plan's three reaches, the buried seawall and nourishment
  in the southern reach, the flow slide barrier in the central reach, and that private landowners bear
  the cost of works protecting their own property.
- The Point Lookout wastewater plant: $13.5 million, opened 25 November 2016, 1,600 kilolitres a day.
- The December 2023 Quandamooka water reserves: 61,190 megalitres, split evenly.
- The 1 December 2025 island bus changes, route numbers and service counts, and the 50 cent fare.
- 2021 Census population and dwelling counts.

### Could not verify

1. **Every cost figure in the pack except those cited in a note.** No lever cost was quoted by the body
   that would pay it. `cost_aud.basis` says "modelling estimate" on the great majority of levers, and
   `confidence` on those is low. Do not put a lever's dollar figure in front of a player as a real number.
2. **Every magnitude.** Nobody has measured an elasticity for this island. The magnitudes are internally
   consistent modelling values on a shared scale and nothing more.
3. **Minjerribah Camping.** The operator's website refused the connection from this agent on every
   attempt, so campground site counts, current camping prices and current vehicle access permit prices
   are unverified. No dollar figure for a permit or a site appears in this pack. This is the single
   biggest closable gap and one phone call would fix it.
4. **Three council documents returned HTTP 403** to this agent and were read only through search
   extracts: the Local Housing Action Plan PDF, the Amity Point SEMP northern reach page, and the
   2025-2026 operational plan performance reports. The housing co-operative figure of about 44
   properties with no vacancies comes from an extract, not from the plan itself. Anyone with a browser
   should re-read these three and correct the pack.
5. **The two Quandamooka ILUAs were not read.** Only their existence, count and the 8 December 2011
   registration date of the State ILUA are recorded, and that date came from a search summary rather
   than the tribunal register. The schedules of those agreements govern camping, tourism and land
   dealings, and several levers assume a decision path those documents may set differently. This is the
   most consequential unread source in the pack.
6. **No visitor number after 2018.** The baseline of about 375,000 visitors is a 2018 figure published
   in 2019. Everything downstream of `visitor_volume` inherits that staleness.
7. **Toondah Harbour's current status.** Confirmed: the development partner withdrew its federal
   application in April 2024 days after a proposed refusal, and as reported in April 2026 the Priority
   Development Area remains in place with no private partner and no clear pathway. Not confirmed: any
   current plan, funding or timeline for the ferry terminal itself. An earlier search summary suggested
   a council acknowledgement dated 24 April 2026; on reading the article, that date is its publication
   date and not a council resolution, so the claim was removed.
8. **Whether the Gumpi (Dunwich) Master Plan has been given effect** in the current Redland City Plan.
   The temporary local planning instrument that carried it expired in September 2022 and what replaced
   it was not established.
9. **Sewerage coverage now.** The Dunwich figure of 128 properties connected and the $5 million
   three-year Point Lookout extension come from council newsletters of 2016 and 2017. Current connection
   rates were not found. The pack says "previously" and must not be read as a present-tense number.
10. **Ferry fares now.** The flat $59 and $69 vehicle fares with a $20 peak surcharge were reported as
    available to 31 March 2026. The pack records that window explicitly rather than implying it holds.
11. **Whether the passenger crossing could legally be brought into the contracted public transport
    network.** The lever exists because the grievance exists. The legal and commercial path was not checked.
12. **Whether Queensland local government rating powers support a differential** framed on occupancy,
    as `rates-differential-unoccupied` assumes. Not verified. Treated as a design idea, not as advice.
13. **Off-lead dog area locations, roosting beach sections and named road segments** were deliberately
    left unnamed rather than guessed. Roads come from `data/geography.json` and nowhere else.
14. **Emergency services and health staffing.** Clinic hours, rosters and after-hours cover are not stated.
15. **Island power supply arrangement.** The cable route, feeder configuration and outage history were
    not verified, so the energy lever is written as site resilience rather than as a network change.

### Deliberate design choices a reviewer might mistake for errors

- **The interest group ids are shared with `data/residents.json` on purpose.** Thirteen groups carry
  `defined_in: "data/residents.json"` and repeat that pack's framing so a household's `cares_about`
  weights resolve against the same ids the civic system reads. Six more are added here: day visitors,
  campers, conservation groups, Amity Point foreshore landowners, and the council and the state as
  institutional actors with a mood but no constituency size.
- **Ferry, barge, bus and parking capacity numbers are not in this pack.** They belong in
  `data/transport.json`. This pack references them and deliberately does not restate them, so there is
  one place to correct them.
- **28 of the 62 levers are marked `modelled_option`.** That status means nobody has proposed the policy
  and this pack invented the framing. It never means the facts underneath were invented. A lever with
  `status: "modelled_option"` and `confidence: "low"` is a design object, not a claim about what anyone
  is doing.
- **`qyac_capacity` is a metric and a rule, not a criticism.** The Queensland Audit Office found QYAC was
  assigned several complex construction projects at once with fewer than 100 staff and no adequate
  capacity assessment. `sim_defaults.qyac_capacity_rule` turns that finding into a mechanic: more than
  two QYAC-led levers in delivery at once halves their effects and doubles their lead times.

### Cultural care

QYAC appears in this pack only as a civic and corporate actor: native title holder, joint manager,
camping operator, fire management lead. Every one of those functions is publicly sourced. No cultural
content, language, story, practice or ceremony is generated anywhere in the pack. The
`planned-burn-extent` lever models the ecological and civic effect of the scale of the burn program and
explicitly does not depict, name or animate cultural burning, which stays queued in
`docs/CULTURAL-REVIEW.md` for QYAC to resolve. The only Quandamooka township names used are those
published by the Queensland Government in the Gumpi master plan statement.

### Where to check next, in order of payoff

1. One call to Minjerribah Camping: site counts, camping prices, permit prices. Closes gap 3.
2. Read the two ILUAs. Closes gap 5 and will probably correct several `who_decides` fields.
3. Open the three 403 council documents in a browser. Closes gap 4 and puts real dollar figures against
   the housing, waste and coastal levers.

## subterranean

`data/subterranean.json`, written 7 August 2026. Pack `status: "proposed"`. 77 processes, 43 buildings,
150 resources, a four tier tech tree, six named loops, twelve orphan streams and twelve reality gates.
Every building carries `existence: "proposed"`. Nothing in this pack exists.

**This is Luke's design, not the agent's.** The material stack, the spoil-becomes-supply rule, the maker
loop, the aquifer-first rule, the two lane method with its five registers, the C-hour, the locked fund and
the zero waste audit all come straight out of `grain-by-grain`, `civilisation-of-sand`,
`sandworm-subterranean-systems`, `amity_stratum`, `ballow-road-sand-screen-hub` and the
`aura-knowledge-base/themes/minjerribah-quandamooka` corpus. What this pack added is arithmetic:
stoichiometry, specific energies, rates, footprints and costs, so the graph can be simulated and checked.
Mass balance is computed by the build script and closes to within 0.5 per cent on all 77 processes.
If a number here contradicts one of Luke's pages, his page is the design and this file is the error.

### The three numbers that would change most of this pack

None of the three is published anywhere the agent could find. All three are cheap to get.

1. **The real heavy mineral grade of the remaining island sands.** The pack assumes 1.0 per cent heavy
   mineral in excavated sand, split 55 per cent ilmenite, 20 zircon, 10 rutile, 1 monazite, 14 other.
   That split is the general eastern Australian mineral sands pattern, not an island assay. Luke's own
   `materials.html` says plainly that the tonnages and remaining grades are not known well enough to print,
   and this pack did not find them either. Every mineral rate downstream of `spiral-classify` is hostage
   to this one number. Old Sibelco and Consolidated Rutile mining reports would close it.
2. **The composition and tonnage of the island waste stream.** The `tip-triage-bay` split is a modelling
   assumption. Nobody has published a composition audit or an annual tonnage for Minjerribah. Luke's
   `reclaim.html` lists this as one of five open questions worth actual money to answer, and it is
   correct: it is a weekend of phone calls and a spreadsheet, not a research programme.
3. **The real advance rate of a jacked bore in this ground.** 15 metres a day is a target. Luke's own
   `tunnels.html` says quoted advance rates vary tenfold from one estimate to the next, and this pack
   inherits that uncertainty whole. The 46 kWh per cubic metre of excavated ground is also modelled,
   against a soft ground range that is usually quoted at 20 to 60.

### Could not verify

1. **The local wave resource.** Luke's `energy.html` gives a measured 15 kW per metre and 500 m of wave
   frontage carrying about 180,000 kWh a day. No source was found for a Minjerribah-specific figure.
   Published national assessments describe Queensland as moderate, put the northern shelf under 10 kW per
   metre and the southern half of the country at 25 to 35, so 15 is plausible for an exposed east coast
   point. It is carried as a low confidence assumption on `owc-wave-harvest` with that caveat written into
   the record. The Australian Wave Energy Atlas would settle it.
2. **Whether a usable kaolin clay exists on Minjerribah.** The geopolymer story needs a reactive
   aluminosilicate, because quartz is inert filler. `clay-calcine` is in the pack with `raw-kaolin-clay`
   flagged as an import until someone proves a local source. If there is no island clay, every block in
   this pack carries a barge on its back and the economics change.
3. **A local soda ash route.** Flat and container glass want soda ash and evaporating seawater gives table
   salt. Luke names this catch himself. No honest local route was found and soda ash stays an import.
4. **Where the reburied monazite actually is, and how deep.** The general story is verified: monazite is
   normally returned to the mine and dispersed with the tailings, and Australian mineral sands monazite
   runs 5 to 7 per cent thorium and 0.1 to 0.3 per cent uranium. The specific depths, volumes and locations
   on this island are not published and are not in the pack. Those numbers decide whether the tier 4
   monazite branch is even physically reachable.
5. **Island demand and rooftop potential.** 30,000 kWh a day for about 2,200 people and 19,000 kWh a day
   from about 21,000 square metres of viable roof are Luke's own working estimates, labelled by him as
   such. They were not checked against Energex or Ergon network data, and checking them is a first task
   in his own text. Everything in `power_reality_check` keys off them.
6. **Every cost.** Build costs are order of magnitude A$ 2026 figures for plant of that type and size.
   No quote, no tender, no feasibility study sits behind any of them. Treat them as relative weights for
   a tech tree, not as a budget. Two buildings, `device-fab` and its two processes, carry a null cost on
   purpose, because inventing one would be worse than admitting it is not costable here.
7. **The chlorine mass balance.** Four processes in this pack consume or release chlorine
   (`chlor-alkali`, `magnesium-electrolysis`, `chloride-route-chlorination`, `pigment-oxidation`,
   `zircon-chlorination`). Each is individually balanced. The claim that the magnesium and chlorine loop
   needs no top-up chlorine is **not** made, because a full cross-process balance has not been run. That
   is the single most useful piece of arithmetic anyone could add to this file.
8. **Carbon capture.** The carbon loop assumes carbon dioxide is available for methanol, the algae columns
   and the refrigerant. Luke names the gap himself: capturing it is easy to say and hard to do, and exactly
   how to catch it is a choice nobody has made. The furnace and afterburner flues are the obvious
   candidates because they are concentrated, and that is the only reason `methanol-synth` is medium rather
   than low confidence. No parasitic capture energy is costed anywhere in this pack. That is a real hole.
9. **The pyrolysis wastewater.** `pyrolysis-water` at 0.57 kg a minute is acidic and phenolic and carries a
   genuine treatment load that pyrolysis pitches usually skip. It is named as an orphan stream rather than
   quietly dropped, and it has no treatment process in the pack.
10. **Plastic pyrolysis.** Marked `disputed` on purpose. Oil quality, contamination from PVC and additives,
    lifecycle emissions and whether the route beats not making the plastic are all live arguments. The
    yield split of 65 per cent oil, 20 per cent gas and 12 per cent char is mid-range for mixed polyolefin
    feed and would not survive contact with a real island bin.
11. **Bio-leaching of monazite.** Recovery split on `bio-leach-rare-earths` is a placeholder. Bio-mining is
    a real research field but the demonstrations are on soft secondary sources like phosphogypsum and spent
    catalysts. Monazite is a refractory phosphate and nobody has bio-leached it at any useful scale.
12. **Aluminium alloy specification.** `aluminium-remelt` is marked low. Melting reclaimed aluminium is
    routine; hitting a named structural specification from mixed island scrap is not, and no claim to
    AA6xxx is made. Drink cans are the wrong alloys and tramp iron and copper never come back out.
13. **Underground pumped hydro siting.** The 120 m head is a construct: an upper pond on a rehabilitated
    mine bench at about +80 m and a sealed void at about -40 m. The island has the height (Mount Hardgrave
    is cited at between about 219 and 240 m depending on source) but no site has been identified, no void
    exists, and seepage toward the freshwater lens is the whole engineering question.
14. **The pumped hydro head, and whether a sealed void in sand can hold water at all.** Kidston proves a
    dug-out **rock** mine can. Nothing proves a lined void in saturated dune sand can. Marked speculative.

### Deliberately left out

- **No reactor.** Federal law prohibits nuclear power installations (EPBC Act 1999 s140A, ARPANS Act 1998
  s10). The thorium branch ends at `thorium-vitrification-bank`: locked in glass, banked, monitored,
  stewarded. Not burned. China's TMSR-LF1 at Wuwei is described in the record as world context with its
  actual status (2 MW thermal, experimental, criticality October 2023, thorium to uranium conversion
  announced 1 November 2025) and no commercial thorium reactor runs anywhere.
- **No local steel smelter.** `metal-stream-baling` bales clean steel and ships it as a valuable product.
  Claiming a blast furnace on a sand island would have been the easy lie.
- **No rate or cost for `sic-power-device-line` or `sovereign-chip-line`.** A wafer fab is billions of
  dollars and hundreds of process steps. Both sit in the tree visible and out of reach, which is the honest
  shape of them, and both unlock only through an off-island partner.
- **No claim that the residual to landfill is zero.** It is 0.622 kg a minute, about 7.8 per cent of the
  tip stream, and it is in `orphan_streams` where a player can see it get worse.

### Cultural care

Every excavation and every marine placement in this pack carries `traditional-owner-consent` and, where it
touches the water, `sea-country-consent`. The pack records the fact that matters most and that a stranger
would not know: the 4 July 2011 Quandamooka native title determinations name **any clay, soil, sand, ochre,
gravel or rock on or below the surface** as Traditional Natural Resources. The sand itself is named. More
than half the island is Naree Budjong Djara National Park, an Indigenous Joint Management Area, and every
building carries a `national-park-exclusion` gate or a siting rule that keeps it out.

Three specific care rules are written into the data rather than left to a reader's judgement:

- **No language.** No Quandamooka word appears in this pack and none should be generated into it.
- **Shell.** `shell-lime-kiln` and `reef-module-cast` may take shell only from aquaculture waste or a
  lawful commercial source. Never from a midden, never from any shell deposit that is or may be culturally
  significant. Where that cannot be assured the process runs on imported limestone and the pack says so.
- **Ochre.** `copperas-calcine` makes red and yellow iron oxide pigment. That is ordinary pigment
  chemistry and it is described in the record as colour. Ochre means something on this island that a
  pigment plant does not get to borrow, and the record says that out loud.

Consent in this pack is not a resource a player can manufacture. It is in `resources` as a record with the
note that it is given or it is not, and `simulation_hooks.failure_modes` requires excavation to stop the
tick consent is withdrawn, with no override. Tier 4 requires consent to be sought **again** for room
making rather than carried over from the bore.

### The honest sting, and it is in the file

Building every process to tier 3 puts about 2,478 kW of connected load under the sand. At only 40 per cent
utilisation that is roughly 23,800 kWh a day, against an island estimated to use about 30,000 and rooftops
that could carry about 19,000. The whole pack including tier 4 is 5,438 kW connected. The generation
described inside the pack is 54 kW. That gap is not an arithmetic error; it is the arithmetic telling the
truth. Any UI that shows throughput without showing connected load against generation will lie to a player
about this island. The three numbers worth putting on the panel are load against generation, the orphan
stream total, and the residual to landfill.

### Where to check next

In order of how much they unlock:

1. The old mining reports for remaining heavy mineral grade. Unlocks or kills the whole mineral branch.
2. One waste composition audit and one annual tonnage from Redland City Council. Makes the tip loop a
   business case with a number on it instead of an idea, and Luke has already written the five questions.
3. A full chlorine mass balance across the five chlorine processes. Either closes the magnesium loop
   honestly or shows it needs a top-up, and either answer is worth having.
4. The Australian Wave Energy Atlas for a Point Lookout wave power figure.
5. A geological answer on island kaolin. Decides whether cement-free block is genuinely local.

## lore

`data/lore.json`, written 7 August 2026. 19 top-level blocks: 21 allowlisted language entries,
13 machine-readable prohibitions, 14 history timeline entries, 5 recorded QYAC positions, 7 banned
tokens, 35 sources.

**The one thing to read first:** the pack carries `"status": "not_reviewed_by_traditional_owners"`.
Everything in it is public-record material assembled by an agent. QYAC has not seen it. Nothing in it
is approved. `docs/CULTURAL-REVIEW.md` is the queue of what a human needs to take to QYAC, and every
item there names the file and line it affects.

### What could not be verified

1. **Whether QYAC wants this project to exist.** Nobody has asked. Recorded in
   `qyac_public_positions.explicitly_unknown`.
2. **Any published Quandamooka seasonal calendar.** Searched QYAC's own publications, Queensland
   Government material, the Bureau of Meteorology Indigenous Weather Knowledge calendars, the North
   Stradbroke Island Museum language material and the Jandai dictionary listings. There is none in
   public circulation. Jajoo Warrngara: The Culture Classroom hosts a video titled *Quandamooka
   Seasonal Cycles* presented by Quandamooka Traditional Custodian Elisha Kissick, but it sits behind
   a subscription and the contents could not be read. This is why `src/kernel/clock.js` now carries
   plain English season names.
3. **The meaning of Minjerribah.** Queensland Parks publishes *place of many mosquitoes*. Tourism and
   secondary material widely repeats *island in the sun* and no primary source for it was found. Both
   are recorded, neither is asserted, and the second is marked low confidence.
4. **The meanings of Goompi, Pulan, Mooloomba, Bummiera, Kaboora, Capembah, Deanbilla and
   Yulu-Burri-Ba.** No published gloss was found for any of them. None has been invented. The names
   are used; the meanings are absent.
5. **Which spelling is correct, for anything.** Published sources disagree, including QYAC's own
   documents against each other: Moorgumpin in the 2015 briefing against Mulgumpin in the
   Sustainability Strategy; Nunukul / Ngughi / Goenpul in the briefing against Gorenpul / Ngugi /
   Noonuccal in the Sustainability Strategy. The variation is recorded rather than resolved.
6. **The names of the twelve apical ancestors.** These are public, in Schedule 1 of *Delaney on behalf
   of the Quandamooka People v State of Queensland* [2011] FCA 741. They were deliberately **not**
   recorded. That is a decision, not a gap. See `docs/CULTURAL-REVIEW.md` B1.
7. **The current status of the Quandamooka Coast claim.** QYAC's own page records a trial from
   1 September 2025 with a further week from 1 December 2025. No determination or judgment was found
   in searches on 7 August 2026. The pack records the status as unknown and forbids showing it as
   decided.
8. **Current Minjerribah Futures figures.** Published totals vary by scope and date and were not
   reconciled: a $33.62 million programme of 23 delivered projects, and an allocation increased to
   $39.4 million reported in 2024, alongside the Queensland Audit Office figure of $8.74 million paid
   to QYAC by four departments between 1 July 2016 and 31 December 2021. The pack forbids a single
   headline dollar figure on screen. Programme status as at August 2026 is unknown.
9. **When sand mining actually started.** The Queensland Government's own transition strategy says
   "since the 1940s" and that is treated as reliable. The company-level detail found in secondary
   sources (Titanium and Zirconium Industries from 1949, first commercial shipment 1950, Consolidated
   Rutile from 1963) is marked low confidence and no primary source was checked.
10. **Mine rehabilitation.** Current obligations, progress and handback arrangements were not
    established. Rehabilitation outcomes are not modelled as fact.
11. **The two ILUAs.** Not read. The pack records that the State ILUA was signed on 15 June 2011 and
    forbids paraphrasing contents nobody has read. This is the same gap already logged under `## civic`.
12. **The Naree Budjong Djara management plan.** Not read. Joint management is summarised from
    Queensland Parks web pages, not from the plan.
13. **Faith Walker's 1998 University of Queensland thesis on Myora Mission 1892 to 1940.** Not read.
    It is the scholarly source behind most published Myora history and a human should read it before
    any of that history is built.
14. **Neil (2002), *Anthrozoos* 15(1), on cooperative fishing with dolphins.** Abstract and summaries
    only; the full paper was not read.
15. **Whether QYAC has published a position on anything since the 2015 briefing and the Sustainability
    Strategy.** QYAC's media and press release pages were not trawled. The five recorded positions are
    from those two documents and four of the five are marked historical.
16. **The publication date of QYAC's Quandamooka Country Sustainability Strategy.** Not established
    from the document itself. It is cited without a year.

### Sources read only through a search summary

These pages returned 403 or a cross-host redirect to direct fetch, so the facts drawn from them came
from search result summaries rather than the page itself. They are individually plausible and mutually
consistent, but a human with a browser should open them:

- `parks.qld.gov.au` Naree Budjong Djara *about* and *nature, culture and history* pages. This is where
  the *place of many mosquitoes* and *people of the bay* glosses come from.
- `detsi.qld.gov.au` Minjerribah Futures, native title and QUAMPI pages.
- `qao.qld.gov.au` Managing Minjerribah Futures funding.
- Queensland Heritage Register entry 600773, Dunwich Cemetery. The register has moved host.
- The AIATSIS Quandamooka publication PDF, and the National Native Title Tribunal determination
  brochure for 4 July 2011. Both returned 403.
- The University of Queensland Moreton Bay Research Station cultural heritage pages, which now 404 at
  both the old and redirected URLs.

Two QYAC PDFs **were** downloaded and read in full text: the 2015 issues briefing and the Quandamooka
Country Sustainability Strategy. Most of the high-confidence material in the pack comes from those two.
The September 2016 North Stradbroke Island Economic Transition Strategy was also downloaded and read.

### One error found in another file

`src/systems/environment/tide.js` line 15 says the tidal constituent values are sourced in
`data/lore.json`. They are not, and they should not be: they are physical, not cultural. Whoever owns
the environment pack should either move the tide provenance somewhere honest or correct the comment.
The `Dunwich (Goompi)` and `Amity Point (Pulan)` station labels at lines 29 and 30 are fine; both names
are on the lore allowlist.

### Deliberate design choices a reviewer might mistake for errors

- **The seasons in `src/kernel/clock.js` are plain English on purpose.** Six invented season names were
  removed on 7 August 2026 because none could be sourced and one, *yalingbila*, is published as meaning
  whale and was being used as the name of a hot wet season. The export was renamed from
  `QUANDAMOOKA_SEASONS` to `ISLAND_SEASONS`. The six removed strings are in
  `lore.language.banned_tokens` so a build check can catch them if they come back. The new markers are
  drawn from the sourced four-season calendar in `data/ecology.json`, so each one is checkable.
- **`data/lore.json` contains no coordinates.** Not an omission. Placing a cultural feature is the harm.
- **Being on the language allowlist does not mean approved for display.** It means the word is not a
  fabrication. Three entries carry `player_facing: false`: Moongalba, Terangeri and Oodgeroo Noonuccal.
  One entry, Deanbilla, is allowlisted in advance because the QUAMPI place record will need it and is
  not yet used anywhere.
- **`qyac_public_positions` is deliberately short, and `explicitly_unknown` is deliberately long.**
  Silence is accurate. The prohibition `no-quandamooka-position-without-citation` is what stops the next
  agent filling the gaps in from inference.
- **QYAC's own published acknowledgement is not copied into the pack.** The pack records where it is
  published and what it covers, and the game uses its own plain wording instead. Copying a Traditional
  Owner corporation's acknowledgement into a game asset is not a thing to do without asking.
- **The prohibitions block is written to be executed, not read.** Thirteen rules, eleven of them
  blocking, most reducible to a token scan over `src/`, `data/` and `docs/`. The harness that runs them
  does not exist yet. Writing it is the highest-value next job in this pack.

### Where to check next, in order of payoff

1. One conversation with QYAC about items A1 to A4 in `docs/CULTURAL-REVIEW.md`. Everything else is
   detail by comparison.
2. Write the prohibitions check harness in `tools/`. It is small and it converts this file from a
   promise into a test.
3. Open the six 403 pages in a browser and upgrade those facts from search summary to read.

## narrative

`data/narrative.json`, written 7 August 2026. 36 story seeds, 180 beats, 36 branch points with
114 options, 25 cast roles, 10 emotional registers, 10 relationship change rules, and a
state contract of 104 paths, of which 24 exist in `src/systems/` and `src/kernel/` today.

Confidence: 22 high, 11 medium, 3 low. Every seed carries `source` and `notes`.

Sources in priority order: the other packs in this repo, then public verification, then general
knowledge marked as such. The author's screen repos (`minjerribah-screen-media-network`,
`film-club-documentary-builders`, `quandamooka-film-festival`, `infinity-engine`,
`civilisation-of-sand`) were read for house voice rather than for facts: the source-honest posture,
the labelling of drafts and proposals, the refusal to claim approval, and the "humans hold the story"
line at the bottom of every builder template.

### What this pack is not

It is not scripts and it has no dialogue. Beats say what happens and what changes, never what anyone
says. That is a deliberate rule (`tone_guide.no_speech`) and it applies to every character without
exception, for two reasons: generated dialogue is where a place stops sounding like itself, and a
no-speech rule that applied only to Quandamooka characters would be a worse rule than one that
applies to everyone.

### Verified independently for this pack

These were re-checked against a public source rather than taken from a sibling pack:

- Koala mortality on this island, 1997 to 2010: vehicle strike 35, disease 21, dog attack 16.
- East Coast Road speed reduced from 100 to 80 km/h, for road user and wildlife safety.
- The 2013 to 2014 fires: single lightning strike, more than 16,800 ha, an estimated 70 per cent of
  island bushland, just over two weeks from 29 December 2013, and nine hundred campers evacuated
  from Main Beach and the Blue Lake area on New Year's Day.
- The fox program: about 90 per cent of foxes removed, using bait stations, traps and monitoring
  cameras, with sea turtle nests named as a primary reason for the project.
- Point Lookout SLSC patrols two beaches, Main and Cylinder, and roves six others, and says it is the
  only club in Australia doing so. Founded 1947.
- Queensland marine mammal watching rules: a 100 m no approach zone around a whale extending 300 m
  front and behind, and a caution zone to 300 m with a six knot limit.
- East Australian humpback population increasing at roughly 10 to 11 per cent a year, now estimated
  around 50,000.
- The North Gorge Walk closure precedent: a 25 m section requiring reconstruction with new
  foundations into the underlying rock, after rain washed out foundations on the southern side.
- Amity Point declared an erosion prone area, driven by episodic flow slides and the migration of
  Rainbow Channel, with the old racecourse now out under the channel.

### Corrections to other packs, applied here

- **There was no "Dunwich State High School".** `data/events.json` records it that way. What closed
  in 2012 was the Year 8 to 10 **secondary department of Dunwich State School**, whose six students
  moved to Cleveland District State High School, with transport subsidies for island secondary
  students. Three seeds were reworded. The events pack should be corrected to match.
- **A local whale count being down does not mean the population is down.** The brief asked for a
  seed where the whale count is down. Written literally that teaches the player something false, so
  `the-count-is-down` is about what people do with an ambiguous number and states that the east
  Australian population trend is strongly up. If a UI panel ever presents a low sighting week as a
  conservation signal, it is wrong.

### Gaps this pack surfaced in other packs

- **No place record for the Dunwich Public Hall or the Amity Point Public Hall.** Both are in
  `data/businesses.json` as community halls. Neither has a point in `data/places.json`, so the
  consultation and working bee seeds have no venue to sit on. Point Lookout Community Hall does have
  a place record. Three halls, one point.
- **No place record for One Mile as a locality.** `data/places.json` has `one-mile-jetty` and
  `polka-point`. `data/businesses.json` and `data/residents.json` both use One Mile as a township, for
  Nareeba Moopi Moopi Pa, Straddie Adventures, the Stradbroke Flyer and an aged support household.
  The narrative pack had to point three seeds at the jetty instead.
- **No `sp-seagrass` species record.** `data/ecology.json` has `hab-seagrass` and
  `proc-seagrass-dynamics` but no species entry, so `after-the-rain` references the habitat.
- **`beach_access_quality` is a metric, not a lever.** Easy to get wrong when reading `civic.json`
  quickly. Noted for the next agent.

### Could not verify

1. **Every trigger threshold in this file is a modelling choice.** `weather.swellM > 3.0` closing the
   Gorge, `visitors.onIsland >= 2500` making a stockout a story, `housing.rentalListings <= 4`,
   `waste.transferStationFullness >= 0.85`: none of these are measured. They are starting points for
   tuning against a running simulation, not claims about the island. Tune them with
   `tools/headless.mjs`, using the fizzle rate as the signal.
2. **Whether the Gorge Walk is ever closed for swell.** The documented closures were caused by
   rainfall damaging boardwalk foundations, not by swell. `the-gorge-is-shut` assumes a swell-driven
   closure of the low shelf and is marked medium. If the council only ever closes it for structural
   damage, change the trigger to a damage path and the rest of the seed still works.
3. **Amity Point erosion has no published rate.** No metres per year, no flow slide frequency, no
   nourishment volume. `another-two-metres` fires on relative movement, and the two metres is the
   story's number, not a rate. Do not let a panel state an erosion rate.
4. **Island freight.** The pub stockout, the tradie's booking and the waste backlog all rest on a
   freight system nobody has published: no tonnage, no sailing allocation, no delivery schedule, and
   `stradbrokeislandcarriers.com.au` would not resolve on 7 August 2026. All three seeds fire on the
   simulation's own stock state.
5. **Island power supply.** `the-power-goes` is the least evidenced seed in the pack and is marked
   low. Nothing is claimed about how power reaches this island, because nothing was verified. No
   outage history, no generator inventory, no backup capacity. Rewrite its `of_this_place` line once
   the infrastructure pack establishes the real arrangement.
6. **Wastewater.** `after-the-rain` is also low. No treatment arrangement, outfall location, overflow
   history or water quality monitoring programme for this island was verified. The seed asserts only
   the general link between heavy rain and nearshore water quality.
7. **Reticulation at Point Lookout.** `a-main-in-january` assumes a reticulated main serving the
   township. Not verified. Every water volume figure available for this island is secondary reporting
   and one figure in the same source was garbled, so no volume is stated anywhere in this pack.
8. **Filming permits.** No filming or temporary use permit process for this island was verified, so
   `the-crew-wants-the-gorge` describes none in detail and is marked low.
9. **Off leash and prohibited dog areas.** The Redland City Council pages return HTTP 403 to an
   automated fetch. What is in the seeds comes from a search summary of those pages and a travel
   guide: dogs prohibited in Naree Budjong Djara National Park including Blue Lake, and at Brown Lake;
   an off leash area at Home Beach; an off leash park at Dunwich. **No specific off leash boundary
   should be rendered to a player from this pack.**
10. **Working bee frequency.** Carried forward from the events pack, where it is an invented modelling
    default. Two seeds key off working bees. Replace with the real calendar before either is shown.
11. **No island roost count, nest count, hatching success rate, sighting count, enrolment figure,
    volunteer roster size, or crossing fare** is stated anywhere in this pack. Every one of those is
    read from the simulation. Where a character notices a number (four hundred people on the walk,
    nine on the rescue crew, four hundred at the mine), it is written as an impression, and the
    director should render the simulation's own figure or drop the clause.
12. **Seven referenced businesses are `trading-unconfirmed`**: Stradbroke Cab Service, Straddie Mobile
    Vet, Cellarbrations Dunwich, Point Lookout Bushcare, Friends of Stradbroke Island, the NSI
    Aboriginal and Islander Housing Society, and Nareeba Moopi Moopi Pa. The director is required to
    check status at runtime and substitute or skip. A story must never be the thing that makes a
    business look real. Straddie Mobile Vet matters most: `on-east-coast-road` deliberately reads
    treatment capacity from state rather than assuming an island vet exists.
13. **The relationship model is unvalidated.** Four dimensions, ten change rules, decay rates and
    thresholds, all invented. They are a coherent design, not a finding. The rule that will need the
    most tuning is `insider-outsider`, which is deliberately asymmetric.
14. **The director's numbers are guesses**: four concurrent threads, two new a week, a 20 per cent
    fizzle target, eight quiet days in thirty, and the ending ratio of 30 well, 15 badly, 35 quietly,
    20 unresolved. They encode a judgement about pacing, not a measurement.

### State contract

104 paths. 24 exist today, across `weather`, `tide`, `daylight` and `clock`. The other 80 are a
request to the systems named in `src/systems/manifest.js`. The paths use the manifest's published
ids, so `ferry.barge.cancelled`, `koala.roadDeaths` and `businesses.<id>.stockout` rather than the
brief's `transport.`, `ecology.` and `economy.` prefixes. If a system publishes a different shape,
the contract is wrong and should be changed here, not worked around in the director.

Two paths sit in the wrong system on purpose and are flagged in the file: `marine.foxBaitingActive`
and `marine.vesselIncidents` belong to a pest control system and a maritime or emergency system that
the manifest does not yet name.

### Cultural care

No cultural content is in this pack. No language beyond what other packs already cite from published
sources, no ceremony, no story, no sacred site, no protocol, and no words attributed to any person.

Quandamooka households are cast in ordinary working and civic roles across every township, because
leaving them out of the ordinary life of the island would be its own falsification. What is
explicitly prohibited: no elder role, no knowledge holder role, no cultural guide role, no ceremony
generation, no cultural position attributed to a person, and no statement attributed to QYAC, MMEIC
or Yulu-Burri-Ba. Real organisations appear only where they take an action already documented in
`data/civic.json` or `data/businesses.json`.

Three questions are logged for `docs/CULTURAL-REVIEW.md`:

- Whether the Quandamooka Festival season and NAIDOC Week should generate any narrative thread at
  all, or only civic load. This pack generates none.
- Whether a joint management decision in Naree Budjong Djara should ever appear as a thread with a
  Quandamooka household cast in it, or only as a policy state change with no cast. This pack does the
  second.
- Whether the two items already routed to review under the ecology pack, the historic cooperative
  dolphin fishing at Amity Point and cultural burning, may ever be narrative material. This pack
  assumes not. `smoke-over-goompi` is about a council and rural fire brigade hazard reduction burn
  only, and says so.

`the-crew-wants-the-gorge` renders a cultural clearance step as a required constraint on a filming
permit and never resolves it, grants it, refuses it or describes it. Any depiction of a permission
process on Country is out of scope for a data pack.

### Where to check next

In order of how much they unlock:

1. Ten minutes with someone who runs a venue here would settle the freight and stockout mechanism
   behind three seeds.
2. The real working bee calendar from Point Lookout Bushcare or Friends of Stradbroke Island.
3. Whether the Gorge Walk is ever closed for swell rather than only for structural damage.
4. How power and wastewater actually work here, which would move two seeds off low confidence.
5. A place record each for the two missing halls and for One Mile.
