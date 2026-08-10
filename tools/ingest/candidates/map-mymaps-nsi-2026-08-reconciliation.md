# Map reconciliation: North Stradbroke Island

Run on 2026-08-10 by lane-map/1.0. Nothing in data/ was written by this run.

**139 placemarks** in 10 folders. 133 became candidates, 6 were held, 0 fell outside the island, 0 had no geometry.

## The four-way split

| Verdict | Count | What it means |
| --- | --- | --- |
| NEW | 86 | Nothing in the packs looks like this. |
| CONFIRMS | 28 | An existing record, and his pin corroborates its position. |
| CORRECTS | 11 | The existing record has a different position, or none. His is first hand. |
| CONFLICTS | 8 | They disagree on status. The sourced record wins on status, his pin on position. |

## Every CORRECTS (11)

These are the ones to look at. Nothing has been applied.

- **Six Beaches** (Local Businesses) against `businesses/six-beaches`, no position on the existing record.
  The name matches businesses/six-beaches, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Fishes at the Point** (Local Businesses) against `businesses/fishes-at-the-point`, no position on the existing record.
  The name matches businesses/fishes-at-the-point, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Straddie Super Sports** (Local Businesses) against `businesses/straddie-super-sports`, no position on the existing record.
  The name matches businesses/straddie-super-sports, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Straddie Hardware & Servo** (Local Businesses) against `businesses/straddie-servo-and-hardware`, no position on the existing record.
  The name matches businesses/straddie-servo-and-hardware, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Volunteer Marine Rescue** (Local Businesses) against `businesses/vmr-north-stradbroke`, no position on the existing record.
  The name matches businesses/vmr-north-stradbroke, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Gold Cat Flyer Water Taxi** (Local Businesses) against `businesses/stradbroke-flyer`, 143 m.
  The name matches businesses/stradbroke-flyer and his pin is 143 m away. He put the pin there himself, so his position is the first-hand one.
- **Waste Deposit and Transfer Station** (Public Services and Utilities) against `businesses/nsi-recycling-and-waste-centre`, no position on the existing record.
  The name matches businesses/nsi-recycling-and-waste-centre, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Dunwich Police Station** (Public Services and Utilities) against `businesses/dunwich-police-station`, no position on the existing record.
  The name matches businesses/dunwich-police-station, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Allure Resort Stradbroke Island** (Point Lookout Holiday Rental Properties) against `businesses/allure-stradbroke-resort`, no position on the existing record.
  The name matches businesses/allure-stradbroke-resort, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Manta Lodge & Scuba Centre** (Point Lookout Holiday Rental Properties) against `businesses/manta-lodge-scuba-centre`, no position on the existing record.
  The name matches businesses/manta-lodge-scuba-centre, which carries no coordinate at all. His pin supplies the position that record has been missing.
- **Whale Watch Ocean Beach Resort** (Point Lookout Holiday Rental Properties) against `businesses/whalewatch-ocean-beach-resort`, no position on the existing record.
  The name matches businesses/whalewatch-ocean-beach-resort, which carries no coordinate at all. His pin supplies the position that record has been missing.

## Every CONFLICTS (8)

These are the ones to look at. Nothing has been applied.

- **Spa Express** (Local Businesses) against `businesses/spar-express-dunwich`, 13 m.
  A partial name match to businesses/spar-express-dunwich and 13 m from it. Same spot, different wording for the same thing. The existing record is marked "trading-unconfirmed", and his map lists it as a going concern. His own note says he does not know what is current, so the sourced record wins on status and his pin wins on position.
- **Loaves Bakery** (Local Businesses) against `businesses/loaves-bakery-point-lookout`, no position on the existing record.
  The name matches businesses/loaves-bakery-point-lookout, which carries no coordinate at all. His pin supplies the position that record has been missing. The existing record is marked "trading-unconfirmed", and his map lists it as a going concern. His own note says he does not know what is current, so the sourced record wins on status and his pin wins on position.
- **Fishlass - Perry's Seafood** (Local Businesses) against `businesses/perrys-seafood-van`, 212 m.
  The name matches businesses/perrys-seafood-van and his pin is 212 m away. He put the pin there himself, so his position is the first-hand one. The existing record is marked "trading-unconfirmed", and his map lists it as a going concern. His own note says he does not know what is current, so the sourced record wins on status and his pin wins on position.
- **Amity Post Office** (Public Services and Utilities) against `businesses/australia-post-amity-point-lpo`, 37 m.
  The name matches businesses/australia-post-amity-point-lpo and his pin is 37 m from it, which is inside the precision either source claims. The existing record is marked "trading-unconfirmed", and his map lists it as a going concern. His own note says he does not know what is current, so the sourced record wins on status and his pin wins on position.
- **The Islander Holiday Resort** (Point Lookout Holiday Rental Properties) against `businesses/islander-holiday-resort`, no position on the existing record.
  The name matches businesses/islander-holiday-resort, which carries no coordinate at all. His pin supplies the position that record has been missing. The existing record is marked "trading-unconfirmed", and his map lists it as a going concern. His own note says he does not know what is current, so the sourced record wins on status and his pin wins on position.
- **Yarraman Sand Mine** (Private Mine Leases) against `geography/rehab-central-east-a`, 1140 m.
  His pin sits 1140 m from geography/rehab-central-east-a, which data/geography.json records as a sand mining rehabilitation area and deliberately leaves unnamed, because which of the three mine names belongs to which polygon had not been verified. His folder files it as a current private lease. The sourced record wins on status, mining having ended; his pin wins on position and, subject to a person checking it, supplies the name. 1 other rehabilitation polygon(s) sit within 2 km: rehab-central-east-b at 1655 m. Which polygon carries which mine name is exactly the question the pack says is open, so this pairing is a lead for a person and not a fact.
- **Vance Sand Mine** (Private Mine Leases) against `geography/rehab-north-of-dunwich-b`, 218 m.
  His pin sits 218 m from geography/rehab-north-of-dunwich-b, which data/geography.json records as a sand mining rehabilitation area and deliberately leaves unnamed, because which of the three mine names belongs to which polygon had not been verified. His folder files it as a current private lease. The sourced record wins on status, mining having ended; his pin wins on position and, subject to a person checking it, supplies the name. 1 other rehabilitation polygon(s) sit within 2 km: rehab-north-of-dunwich-a at 1588 m. Which polygon carries which mine name is exactly the question the pack says is open, so this pairing is a lead for a person and not a fact.
- **Enterprise Sand Mine** (Private Mine Leases) against `geography/rehab-central-south`, 495 m.
  His pin sits 495 m from geography/rehab-central-south, which data/geography.json records as a sand mining rehabilitation area and deliberately leaves unnamed, because which of the three mine names belongs to which polygon had not been verified. His folder files it as a current private lease. The sourced record wins on status, mining having ended; his pin wins on position and, subject to a person checking it, supplies the name.

## Same name, far apart (3)

Neither a confirmation nor a correction. The name matches a record in the packs and the two positions are too far apart to be the same thing. Either the names repeat, which they do here, or one of the two positions is wrong. Somebody who has been there settles each of these in a sentence.

- **Myora Springs** (Natural Beauty) against `places/myora-springs`, 1320 m apart.
- **North Stradbroke Island Aero Club** (Getting Around; Public Transport) against `businesses/north-stradbroke-island-golf-club`, 2838 m apart.
- **Home Beach Camping Ground** (Point Lookout Holiday Rental Properties) against `places/home-beach-campground`, 802 m apart.

## What is drawn in the world

**42 of 133.** Every other record is in the pack and out of the world, and its own `player_facing_basis` says which clause held it back. The five clauses, in order: the contributor filed it under one of his four public folders; the verdict is NEW so there is no sourced record behind it to overwrite or contradict; it is an observation and not a proposal; the position is the one he pinned rather than a coarsened one; and nothing shown asserts a current status, because that is exactly what his own data status says nobody has checked.

| What | How many |
| --- | --- |
| bus stop | 20 |
| water treatment | 3 |
| court | 2 |
| toilet block | 2 |
| waste bay | 2 |
| airfield | 1 |
| ambulance | 1 |
| beach | 1 |
| bmx track | 1 |
| depot | 1 |
| jetty | 1 |
| park | 1 |
| public phone | 1 |
| skate park | 1 |
| sports ground | 1 |
| spring | 1 |
| swimming enclosure | 1 |
| waste transfer | 1 |

### Held out of the world although the verdict is NEW

- **Amity Point** (Natural Beauty). A proposal by the contributor rather than an observation. Proposed stays proposed, and this world has no register for proposals to sit in, so it is held out of the world rather than blended into it.
- **Dream Space of Yarraman Mine** (Public Services and Utilities). A proposal by the contributor rather than an observation. Proposed stays proposed, and this world has no register for proposals to sit in, so it is held out of the world rather than blended into it.

## Bus stops against the published timetable

Route 880 and Route 881 in `data/transport.json` carry eleven waypoints between them and not one coordinate on any of them. This map supplies 20 bus stops with a first-hand position, and 5 of them join to a published timing point on the evidence shown below. The rest are stops between timing points, which is the ordinary case: a Translink timetable prints times at a handful of points and the bus stops at every stop in between, so no departure time is published for them and none is shown for them.

| Stop, as contributed | Township | Routes through | Timing point | On what evidence |
| --- | --- | --- | --- | --- |
| Bus Stop | between townships | 880, 881 |  |  |
| Bus Stop | between townships | 880, 881 | 880 Junner Street Ferry Terminal; 881 Junner Street Ferry Terminal | The waypoint refers to terminal-junner-street, which carries a coordinate, and the pin is 0 m from it. |
| Bust Stop | between townships | 880, 881 | 880 One Mile Ferry Terminal; 881 One Mile Ferry Terminal | The waypoint refers to terminal-one-mile, which carries a coordinate, and the pin is 55 m from it. |
| Bus Stop | between townships | 880, 881 |  |  |
| Bus Stop and Exchange | between townships | 880, 881 |  |  |
| Bus Stop; Amity General Store | between townships | 881 | 881 Amity Point (Pulan) | The contributed name carries the word that identifies this timing point and no other on this route, and the pin stands in amity-point. |
| Bus Stop | between townships | 880 |  |  |
| Bus Stop; Adder Rock | between townships | 880 | 880 Point Lookout, Adder Rock | The contributed name carries the word that identifies this timing point and no other on this route, and the pin stands in point-lookout. |
| Bus Stop; Manta Lodge YHA | between townships | 880 |  |  |
| Bus Stop; Anchorage Resort | between townships | 880 |  |  |
| Bus Stop; Allure Resort | between townships | 880 |  |  |
| Bus Stop; George Nothling Drive | between townships | 880 |  |  |
| Bus Stop; Home Beach | between townships | 880 |  |  |
| Bus Stop; Stradbroke Hotel | between townships | 880 |  |  |
| Bus Stop; Cylinder Beach | between townships | 880 | 880 Point Lookout, Cylinder Beach | The contributed name carries the word that identifies this timing point and no other on this route, and the pin stands in point-lookout. |
| Bus Stop; Bob's Shop | between townships | 880 |  |  |
| Bus Stop | between townships | 880 |  |  |
| Bus Stop; Bimba Street | between townships | 880 |  |  |
| Bus Stop | between townships | 880 |  |  |
| Bus Stop and Turnaround | between townships | 880 |  |  |

### Timing points nothing joined to

- **Amity Point turnoff** on bus-880. The Beehive Road junction on East Coast Road, which stands in no township. The nearest contributed pin, "Bus Stop and Exchange", is 393 m from where data/geography.json puts that junction: close enough to be a lead for somebody who knows the road and too far to assert.
- **Point Lookout, Gorge Walk** on bus-880. No contributed pin names the Gorge Walk. "Bus Stop and Turnaround" is the last stop on Mooloomba Road and may be it, and only somebody who catches that bus can say.
- **QUAMPI** on bus-881. Added as a timing point in the 1 December 2025 timetable change. No contributed pin names it.
- **Amity Point turnoff** on bus-881. The same Beehive Road junction as on Route 880.

## Held

Held items are not named here, do not carry a coordinate here, and are not in the pack. They are described in docs/CULTURAL-REVIEW.md, which is the queue, and the decision is not this project's to make.

- `held-e9000f1f`, a point in "Public Services and Utilities": its position falls inside a placemark held above, so publishing it would publish that location under a different label.
- `held-9cc1a8f7`, a polygon in "Public Services and Utilities": its own text uses one of the tokens the two cultural prohibitions in data/lore.json declare, which is a stop and ask.
- `held-1b4422c2`, a point in "Public Services and Utilities": the placemark proposes renaming a real place, and place naming on Minjerribah is an open question with QYAC in docs/CULTURAL-REVIEW.md A3.
- `held-1b3eb0e1`, a polygon in "Public Services and Utilities": it marks the same ground as a placemark held above, within 25 m, so publishing it would publish that location under a different label.
- `held-f98bba54`, a point in "Public Services and Utilities": its own text uses one of the tokens the two cultural prohibitions in data/lore.json declare, which is a stop and ask.
- `held-27706ee8`, a point in "Public Services and Utilities": its own text uses one of the tokens the two cultural prohibitions in data/lore.json declare, which is a stop and ask.

## Screened out

- the map description: 1 contact detail(s) removed (a mobile number). The value is not recorded anywhere.
- held placemark held-f98bba54: 1 contact detail(s) removed (a mobile number). The value is not recorded anywhere.
- folder "Active Community Spaces", placemark 42: 2 external image link(s) dropped. The twin makes no network request and carries no external image.

## Every verdict, by folder

### Natural Beauty (8 of 8)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Brown Lake; Picnic Area and Park | CONFIRMS | places/brown-lake | 349 m |
| Myora Springs | NEW | places/myora-springs (about) | 1320 m |
| Point Lookout Gorge Walk | CONFIRMS | places/north-gorge-walk | 193 m |
| Swimming Enclosure | NEW |  |  |
| Cabarita Park | NEW |  |  |
| Fishing Beach | NEW |  |  |
| Frenchman's Beach | CONFIRMS | places/frenchmans-beach | 355 m |
| Amity Point | NEW | places/amity-point (about) | 668 m |

### Local Businesses (32 of 32)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Stradcrete | NEW |  |  |
| Straddie Island Bakery | NEW |  |  |
| Straddie Kebab & Pizza | NEW |  |  |
| Spa Express | CONFLICTS | businesses/spar-express-dunwich | 13 m |
| Amity Pavilion | CONFIRMS | businesses/amity-pavilion | 11 m |
| Amity Point Community Club Inc. | CONFIRMS | places/amity-point-community-club | 0 m |
| Foodworks | CONFIRMS | businesses/foodworks-point-lookout | 20 m |
| Fins N Fries | CONFIRMS | businesses/fins-n-fries | 3 m |
| Six Beaches | CORRECTS | businesses/six-beaches |  |
| Fishes at the Point | CORRECTS | businesses/fishes-at-the-point |  |
| Loaves Bakery | CONFLICTS | businesses/loaves-bakery-point-lookout |  |
| Gelati and Coffee | CONFIRMS | businesses/whale-tail-gelati | 10 m |
| The Green Room | NEW |  |  |
| News Agency | NEW |  |  |
| Bob Mintee Surfboards | NEW |  |  |
| FoodWorks Dunwich | CONFIRMS | businesses/foodworks-dunwich | 15 m |
| Bottle Shop | NEW |  |  |
| Pharmacy | CONFIRMS | businesses/stradbroke-pharmacy | 15 m |
| Butcher | NEW |  |  |
| Second Hand Store | NEW |  |  |
| Fishlass - Perry's Seafood | CONFLICTS | businesses/perrys-seafood-van | 212 m |
| Straddie Super Sports | CORRECTS | businesses/straddie-super-sports |  |
| Straddie Hardware & Servo | CORRECTS | businesses/straddie-servo-and-hardware |  |
| Dunwich RSL | NEW |  |  |
| Little Ship Club QLD | CONFIRMS | places/little-ship-club | 11 m |
| Volunteer Marine Rescue | CORRECTS | businesses/vmr-north-stradbroke |  |
| Gold Cat Flyer Water Taxi | CORRECTS | businesses/stradbroke-flyer | 143 m |
| Straddie Roadhouse | NEW |  |  |
| Straddie All Sports Club | CONFIRMS | businesses/straddie-sharks-all-sports-club | 2 m |
| Swimming Enclosure | NEW |  |  |
| Minjerribah Camping | CONFIRMS | businesses/minjerribah-camping | 213 m |
| Straddie Brewing Co | CONFIRMS | businesses/straddie-brewing-co | 5 m |

### Active Community Spaces (15 of 15)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Point Lookout Hall | CONFIRMS | places/point-lookout-community-hall | 5 m |
| North Stradbroke Island Golf Course | CONFIRMS | businesses/north-stradbroke-island-golf-club | 303 m |
| Cricket Club | NEW |  |  |
| Tennis Court | NEW |  |  |
| Skateboard Park | NEW |  |  |
| BMX Bike Track | NEW |  |  |
| Boat Ramp | CONFIRMS | places/amity-boat-ramp | 6 m |
| Fishing Jetty | NEW |  |  |
| Amity Public Toilet Block | NEW |  |  |
| Point Lookout Public Toilet Block | NEW |  |  |
| Point Lookout Surf Life Saving Club | CONFIRMS | places/point-lookout-slsc | 40 m |
| Straddie Sharks Football Field | CONFIRMS | businesses/straddie-sharks-all-sports-club | 79 m |
| Multi-Purpose Courts | NEW |  |  |
| Main Beach | CONFIRMS | places/main-beach | 142 m |
| Cylinder Beach | CONFIRMS | places/cylinder-beach | 68 m |

### Getting Around; Public Transport (21 of 21)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| North Stradbroke Island Aero Club | NEW | businesses/north-stradbroke-island-golf-club (about) | 2838 m |
| Bus Stop | NEW |  |  |
| Bus Stop | NEW |  |  |
| Bust Stop | NEW |  |  |
| Bus Stop | NEW |  |  |
| Bus Stop and Exchange | NEW |  |  |
| Bus Stop; Amity General Store | NEW |  |  |
| Bus Stop | NEW |  |  |
| Bus Stop; Adder Rock | NEW |  |  |
| Bus Stop; Manta Lodge YHA | NEW |  |  |
| Bus Stop; Anchorage Resort | NEW |  |  |
| Bus Stop; Allure Resort | NEW |  |  |
| Bus Stop; George Nothling Drive | NEW |  |  |
| Bus Stop; Home Beach | NEW |  |  |
| Bus Stop; Stradbroke Hotel | NEW |  |  |
| Bus Stop; Cylinder Beach | NEW |  |  |
| Bus Stop; Bob's Shop | NEW |  |  |
| Bus Stop | NEW |  |  |
| Bus Stop; Bimba Street | NEW |  |  |
| Bus Stop | NEW |  |  |
| Bus Stop and Turnaround | NEW |  |  |

### Public Services and Utilities (16 of 22)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Redlands Council Depot | NEW |  |  |
| Stradbroke Island Refuse Tip (Waste) | NEW |  |  |
| Waste Deposit and Transfer Station | CORRECTS | businesses/nsi-recycling-and-waste-centre |  |
| Metal Waste | NEW |  |  |
| Plant/Green Waste | NEW |  |  |
| Amity Post Office | CONFLICTS | businesses/australia-post-amity-point-lpo | 37 m |
| Dunwich Post Office | CONFIRMS | businesses/australia-post-dunwich-lpo | 22 m |
| Point Lookout Public Phone | NEW |  |  |
| Ambulance | NEW |  |  |
| Dunwich Town Hall | CONFIRMS | businesses/dunwich-public-hall | 22 m |
| Dunwich Police Station | CORRECTS | businesses/dunwich-police-station |  |
| Dunwich Water Treatment Plant | NEW |  |  |
| Amity Water Treatment Plant | NEW |  |  |
| Point Lookout Water Treatment Plant | NEW |  |  |
| North Stradbroke Island Historical Museum | CONFIRMS | places/straddie-museum | 18 m |
| Dream Space of Yarraman Mine | NEW | geography/rehab-central-east-a (about) | 337 m |

### Point Lookout Holiday Rental Properties (24 of 24)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| The Islander Holiday Resort | CONFLICTS | businesses/islander-holiday-resort |  |
| Allure Resort Stradbroke Island | CORRECTS | businesses/allure-stradbroke-resort |  |
| Anchorage Beachfront Island Resort | CONFIRMS | businesses/anchorage-on-straddie | 22 m |
| Manta Lodge & Scuba Centre | CORRECTS | businesses/manta-lodge-scuba-centre |  |
| Grass Trees on Straddie | NEW |  |  |
| Adder Rock Camping Ground | CONFIRMS | places/adder-rock-campground | 136 m |
| Home Beach Camping Ground | NEW | places/home-beach-campground (about) | 802 m |
| Palau | NEW |  |  |
| The Lookout Units | NEW |  |  |
| Straddie Views Bed & Breakfast | NEW |  |  |
| Island Time Beach House | NEW |  |  |
| Seachange 1 | NEW |  |  |
| Cylinder Beach Camping Ground | CONFIRMS | places/cylinder-beach-campground | 67 m |
| CLAYTONS ON CYLINDER | NEW |  |  |
| Cylinder Cove Apartments | NEW |  |  |
| C~shack | NEW |  |  |
| Mintee on Deadman's | NEW |  |  |
| Reflections | NEW |  |  |
| Beachies Point Lookout | NEW |  |  |
| Pat's Retreat | NEW |  |  |
| Werai and Weetanga | NEW |  |  |
| Dune | NEW |  |  |
| Samarinda | NEW |  |  |
| Whale Watch Ocean Beach Resort | CORRECTS | businesses/whalewatch-ocean-beach-resort |  |

### Amity Holiday Rentals (12 of 12)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Amity Point Camping Ground | CONFIRMS | places/amity-point-campground | 181 m |
| The Cabarita | NEW |  |  |
| Amity Shaws | NEW |  |  |
| Sunset Palms | NEW |  |  |
| Cosy Cottage Amity Point | NEW |  |  |
| Turtles 2 On The Bay | NEW |  |  |
| Turtles 4 On The Bay | NEW |  |  |
| Sea Shanties | NEW |  |  |
| Amity Beach House | NEW |  |  |
| Straddie Bungalows | NEW |  |  |
| Amity Beach House on Birch | NEW |  |  |
| Amity Point Waterfront Cabins | NEW |  |  |

### Dunwich Holiday Accommodation (1 of 1)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Minjerribah Holiday Camp | NEW |  |  |

### Private Mine Leases (4 of 4)

| Placemark | Verdict | Against | Distance |
| --- | --- | --- | --- |
| Yarraman Sand Mine | CONFLICTS | geography/rehab-central-east-a | 1140 m |
| Vance Sand Mine | CONFLICTS | geography/rehab-north-of-dunwich-b | 218 m |
| Mine Security Gate | NEW |  |  |
| Enterprise Sand Mine | CONFLICTS | geography/rehab-central-south | 495 m |

### On Location Video Blog by Luke (0 placemarks, none carried)

