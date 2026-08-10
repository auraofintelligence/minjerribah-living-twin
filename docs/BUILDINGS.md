# Objects in the world: the LOD ladder and world-as-UI

Written 10 August 2026, after the owner looked at Amity Point and asked how actual buildings get into
this muck of geometry, and then pointed at the document that already answers it.

**This supersedes the first version of this file.** That version proposed four lanes for getting
buildings in. They were not wrong, but they were a subset of a six-tier ladder the owner had already
designed, and his is the canonical scheme. Where this document and that one differ, his wins.

Read first:
- `SORT\Generative_Simulation_Engine_&_Asset_Pipeline_for_Quandamooka_Country.md` (the LOD ladder,
  the expert guild, the worked bowls club shed example)
- `SORT\Virtual_Minjerribah_Design_Document.md` (world-as-UI, Memory-Palace UX, the transport MVP)
- `docs/CAPTURE-CONTRACT.md` in this repository (how an asset actually enters, and the trust boundaries)
- `githublocal/aura-scan-pipeline` (the working iPhone LiDAR to CAD chain)

`SORT` = `C:\Users\sbt41\OneDrive\Documents\Sorting_Files\02_Processed_MD\PDFs_to_Sort`

## The point, which is not fidelity

The owner's framing is Google Street View, but with the game mechanics and the objects. The design
document puts it as a principle rather than a feature:

> the world itself as the primary user interface ... To check the bus schedule, a user should be able
> to walk to a virtual bus stop in Dunwich and interact with a virtual timetable. To find a cafe, they
> should see its virtual representation with a menu they can interact with ... the worldbuilding team
> is not just creating art assets; they are building functional, interactive UI components.

So a building is not decoration that the interface sits on top of. **The building is the interface.**
That reframes the whole asset question: the reason to get a real bus stop into the world is not that it
looks better, it is that the timetable lives on it, and `data/transport.json` already holds the
timetable. The asset is the last mile of a data binding that already exists.

This is also `docs/DIRECTION.md` item 2, which arrived at the same rule independently, and it is why
that item is a standing interaction rule rather than a nice idea.

## The ladder

Six tiers, from the owner's pipeline document, with where this build actually sits on each.

| Tier | What it is | State in this build |
| --- | --- | --- |
| **LOD1** Metadata | name, type, location, size, usage, condition | **Mostly there.** 101 businesses, 220 places, 1,059 possible footprints. Condition is not modelled. |
| **LOD2** Footprint | bounding proxy, ground outline, correct dimensions | **Available and not taken.** 1,059 real outlines sit in OpenStreetMap for this island, counted by Overpass on 10 August 2026, 78 at Amity Point alone and 54 already named. |
| **LOD3** Basic shape | low-poly massing, no fine detail | **This is what you are looking at.** `src/render/layers/buildings.js` generates 1,922 of these from 3,819 lots in 160 meshes. Every one is invented and none is where a real building is except by accident. |
| **LOD4** Mid detail | primary features, simple texture | **Nothing.** The cheapest real win: one straight-on facade photograph mapped onto the LOD3 box buys most of the recognition of a full scan for about two per cent of the work. |
| **LOD5** High detail textured | refined mesh, high-res textures | **Nothing, but the chain exists.** `aura-scan-pipeline` plus `CAPTURE-CONTRACT.md` plus, as of today, a vendored GLB loader. |
| **LOD6** Generative | a LoRA plus a base model, rendered on demand | **Nothing, and it should stay that way for now.** See the honest note below. |

## The order, and why it is this order

**1. LOD2 first, for the whole island at once.** One Overpass query replaces about a thousand invented
footprints with true ones. Everything downstream improves in the same pass: roads get real setbacks,
people walk to real addresses, crowd density lands on real building lines, and the shorebird
disturbance model gets real distances from real houses to the roost. Nothing else in this document
touches that many systems.

```
[out:json][timeout:120];
(way["building"](-27.76,153.35,-27.37,153.56););
out geom;
```
POST to `https://overpass-api.de/api/interpreter`. An offline ingest step like every other one: run it
deliberately, write a stamped pack, and the running twin never fetches.

**The licence is a real question and stays open.** OpenStreetMap is ODbL. Rendered images are a
Produced Work and are fine with attribution, but redistributing a derived database carries share-alike
obligations that interact with this repository's non-commercial Public Source Licence. That is the
owner's decision, not an agent's, and the footprint pack stays uncommitted until he makes it.

**2. Heights, so LOD2 becomes massing.** `elevation.fsdf.org.au` serves LiDAR where it has been flown:
check the coverage for Minjerribah rather than assuming it. Where there is a classified point cloud,
building height falls out as the surface model minus the bare earth already in `data/geography.json`.
Where there is not, height by archetype is honest: a Queenslander on stumps about 6 m to the ridge, a
shack about 4 m, the pub about 9 m, recorded as modelled rather than measured.

**3. LOD4 on the fifty buildings a resident would name**, before scanning any of them. The Amity store
looking like the Amity store matters more than the Amity store being geometrically exact.

**4. LOD5 scans of the handful that carry the place.** The pub, the Little Ship Club, the bakery, the
surf club, the Amity store, the Dunwich barge terminal, the museum. The trust boundaries in
`CAPTURE-CONTRACT.md` are the good part and they are correct: verified metric scale is trusted, scan
altitude, heading and sub-metre GPS are not, so an asset is ground-clamped to the heightfield and
carries its own `yaw_deg` instead of trusting a phone compass. That is why a scan will sit on the
terrain rather than floating or sinking.

Roughly half an hour a building the first time, ten minutes once the habit is in. **Consent is not a
formality here:** these are other people's businesses and in some cases their homes. A publicly visible
commercial frontage is a different question from a dwelling, and the answer for a dwelling is ask first.
`docs/PARTICIPATION.md` governs it.

**5. LOD6 last, and possibly never in this repository.** The pipeline document describes a per-asset
LoRA of about 5 MB applied to a base generative model for on-demand variants. It is a good idea and it
collides with two rules this build holds: the twin is offline and deterministic at runtime, and
`no-synthetic-art` says generated imagery is not product imagery. A LoRA that renders a variant of a
real building on demand is generated imagery of a real place. If it is built, it belongs in the
pipeline that produces committed assets a human has looked at, never in the runtime, and never as the
thing a player sees by default.

## The expert guild, and what this build already has of it

The pipeline document names five experts. Two of them exist here in a different form and it is worth
saying which, so nobody rebuilds them:

- **Surveyor**, LiDAR to mesh and georeferencing. Not here. `aura-scan-pipeline` is this.
- **Estimator**, structural condition and repair, and recycling and reuse value. **Partly here.**
  `src/systems/infrastructure/subterranean.js` already issues material passports, 48 of them at last
  count, and runs a mass balance. That is the same idea pointed at a different subject.
- **Spotter**, object detection over video. Not here.
- **Cataloguer**, vision-language classification, condition, and recycling value. Not here, and it is
  the one that would change the twin most, because condition is the missing field at LOD1. A building
  the twin knows the condition of is a building the civic layer can argue about.
- **Generator**, LoRA and LOD packaging. See LOD6 above.

## What street level actually needs, beyond assets

Assets alone do not make Street View with mechanics. Three things, all of which have their pieces here:

1. **Traversal.** `src/render/camera.js` already has street, follow, drone and cinematic modes.
2. **Every object answerable.** `src/render/layers/selection.js` and `src/ui/panels/inspector.js`
   already do this for people, buildings, businesses, animals and terrain. The gap is that most objects
   at street level are not registered as selectable things, because they do not exist as objects yet.
3. **The data binding.** This is the part that is genuinely done and is waiting. `data/transport.json`
   holds the timetable that belongs on the bus stop. `data/businesses.json` holds the hours that belong
   on the door. `data/events.json` holds what belongs on the noticeboard. Every one of those is already
   fact-checked and sourced. The bus stop asset is the last mile, not the first.

The owner's map gave the real bus stop positions, and his design document names the 880 and 881 routes
and, notably, names SeaLink and the Stradbroke Flyer as separate vehicle and passenger services, which
is the same correction he made on 10 August 2026. He had it written down.

## The test

Fly to Amity Point and see whether you recognise your street. Then walk to a bus stop and see whether
it can tell you when the next bus is.
