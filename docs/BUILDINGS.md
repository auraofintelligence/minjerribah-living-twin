# Getting real buildings in

Written 10 August 2026, after the owner looked at Amity Point and asked how actual buildings get into
this muck of geometry, and whether there is a lesson plan for it.

There is now. It is four lanes, coarse to fine, and the order matters because the cheapest one fixes
the most.

## Why it looks like that right now

`src/render/layers/buildings.js` generates 1,922 buildings from 3,819 lots in 160 meshes. Every one is
procedural: a footprint guessed from the lot, a roof pitched by rule, stumps because Queensland, a
verandah if the archetype says so. Nothing on screen is a real building, and no building is where a
real building is except by accident.

That was the right call at the time, because there was no other option and an empty island is worse
than an approximate one. It is not the right call now, because real data exists and is free.

Two things are missing before anything better can land, and both are small:

- **`assets/` is empty and no GLB loader is vendored.** `docs/CAPTURE-CONTRACT.md` describes a pipeline
  the build currently cannot execute, because `vendor/` has `babylon.js`, `babylon.gui.js` and
  `babylon.materials.js` and no `babylonjs.loaders.js`. That is one file. Until it is there, no scan,
  no model and no exported mesh can enter the world at all.
- **There is no footprint lane in the ingest spine.** `tools/ingest/` has document, contribution, era,
  scenario and map lanes. Buildings need one more.

## Lane 1: real footprints, and do this one first

**1,059 real building outlines exist for this island in OpenStreetMap, right now, free.**
Counted 10 August 2026 by Overpass over the island bounding box. 78 of them are at Amity Point alone
and 54 across the island already carry a name.

This is the highest return per hour available anywhere in this project. It replaces 1,922 invented
footprints with about a thousand true ones, in one pass, for the whole island. Every downstream thing
gets better at once: the townships stop being a guess, the roads have real setbacks to run past, people
walk to real addresses, and the shorebird disturbance model gets real distances from real houses.

```
[out:json][timeout:120];
(way["building"](-27.76,153.35,-27.37,153.56););
out geom;
```
POST that to `https://overpass-api.de/api/interpreter`. It is an offline ingest step like every other
one: run it deliberately, write a stamped pack, and the running twin never fetches.

**The licence is a real question and must not be waved through.** OpenStreetMap data is ODbL. Rendered
images made from it are a Produced Work and are fine with attribution. Redistributing a derived
*database* carries share-alike obligations, and this repository is published under the owner's own
non-commercial Public Source Licence, which is a different thing. So: attribute OpenStreetMap
visibly, keep the footprint pack identifiable as OSM-derived rather than blended into another pack,
and get the interaction between ODbL and the repository licence settled before the pack is committed.
That is a decision for the owner, not for an agent, and it goes in `docs/CULTURAL-REVIEW.md`'s sibling
question queue rather than being assumed.

**What is missing from OSM here:** coverage on a small island is uneven, most buildings have no height,
almost none have a roof shape, and holiday houses behind vegetation are often absent. Expect to keep
procedural generation for what OSM does not have, and label which is which. A building the twin invented
and a building traced from OSM are different confidences and the inspector should say so.

## Lane 2: real heights

Footprints without heights are still flat. Two free sources:

- **ELVIS**, `elevation.fsdf.org.au`, the national elevation portal, serves LiDAR where it has been
  flown. Check the coverage for Minjerribah before promising anything: it varies by area and the
  island may only have older or coarser captures. If there is a classified point cloud, building
  heights fall straight out of it as the difference between the digital surface model and the bare
  earth model already in `data/geography.json`.
- **Queensland Government open data**, `qldspatial.information.qld.gov.au`, for cadastre and any
  council-derived building layer.

If neither has usable coverage, height by archetype is an honest fallback: a Queenslander on stumps is
about 6 m to the ridge, a single-storey shack about 4 m, the pub about 9 m. Record it as modelled, not
measured, and the interface says so.

## Lane 3: the buildings you actually care about

Not all 1,059 deserve a model. A handful carry the island: the pub, the Little Ship Club, the bakery,
the surf club, the Amity store, the Dunwich barge terminal, the museum. Those are worth scanning, and
the owner already has the pipeline for it.

**`githublocal/aura-scan-pipeline` is the chain**, iPhone LiDAR to CAD, PC side already built with
tests passing, and `docs/CAPTURE-CONTRACT.md` in this repository already settles how the output enters:
the per-asset file set, the metadata schema, and the trust boundaries. Read both before touching this.

The boundaries in that contract are the interesting part and they are correct:
verified metric scale is trusted, scan altitude, heading and sub-metre GPS are not. So an asset is
ground-clamped to the island heightfield and carries its own `yaw_deg` rather than trusting a phone
compass. That is why a scanned building will sit correctly on the terrain instead of floating or
sinking, which is the usual failure.

**What the owner actually does**, per building, roughly:
walk around it with the phone, capture, check the scale against something known, export GLB, drop it in
a contribution folder with its metadata, run the contribution lane, look at it in the twin, adjust the
yaw. Half an hour a building the first time, ten minutes once the habit is in.

**Consent applies here and it is not a formality.** These are other people's businesses and in some
cases their homes. `docs/PARTICIPATION.md` governs it. A publicly visible commercial frontage is a
different question from a dwelling, and the answer for a dwelling is ask first.

## Lane 4: the cheap one nobody thinks of

A single straight-on photograph of a facade, mapped onto the procedural box, buys most of the
recognition of a full scan for about two per cent of the work. The Amity store looking like the Amity
store matters more than the Amity store being geometrically exact.

Worth doing for the fifty or so buildings a resident would name, before scanning any of them.

## The order, if you only do some of it

1. Vendor `babylonjs.loaders.js`. One file, and nothing else in this document works without it.
2. Build the footprint lane and pull the 1,059. Whole island, one pass, biggest single change.
3. Heights, from LiDAR if the coverage is there and by archetype where it is not.
4. Facade photos for the buildings people name.
5. Scans for the handful that carry the place.

Steps 1 and 2 are an agent's job and could be a wave. Steps 4 and 5 are the owner's, because they need
somebody standing in front of the building, and that is the part no swarm can do.

## What this changes about the twin

It stops being a model of an island and starts being a picture of this one. The test is simple and the
owner is the only person who can run it: fly to Amity Point, and see whether you recognise your street.
