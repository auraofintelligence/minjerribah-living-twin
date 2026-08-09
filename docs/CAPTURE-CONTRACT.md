# The capture contract

How scanned, real-world 3D assets arrive at this twin, what they look like when they get here,
what can be trusted about them, and what this codebase has to decide before it loads one.

This document exists because the twin currently has no asset ingestion at all: `assets/` is empty,
no glTF loader is vendored, and every mesh on screen is generated from `data/*.json`. That is not a
criticism, it is the honest starting point. When an agent builds the ingest, it should build against
this contract, not against a guess. The capture side is real, running code that has processed a
real-world scan; nothing here is speculative about what the files contain.

## Where assets come from

The capture chain is external to this repo and already works end to end:

1. **Capture**: Stray Scanner on a LiDAR iPhone (open source, records locally, no cloud, no licence
   over the data). Chosen deliberately over Scaniverse/Polycam, whose terms grant the vendor a
   perpetual licence over scans of Country. Free capture apps that export plain meshes are an
   accepted fallback lane.
2. **Processing**: `githublocal\aura-scan-pipeline` on a local PC. Fuses raw depth and poses,
   cleans, meshes, verifies scale against tape measurements, cuts sections, and exports. Covered by
   an automated test suite and shaken down on a real scan (July 2026). Its capture field guide and
   raw format spec live in that repo under `docs/`.
3. **Delivery**: plain files. No service, no network, no accounts. Assets reach this repo the same
   way everything else does: committed into it.

## What arrives per asset

One processed scan produces one asset folder. The files that matter to the twin:

| File | What it is |
| --- | --- |
| `<name>_lod1.glb` | Web-weight mesh, under 15,000 triangles, vertex colours, glTF convention: Y up, metres | 
| `<name>_lod2.obj` / `_lod2.ply` | Full-detail archival mesh, metres, Z up |
| `<name>_points.ply` (and `.las`) | The point cloud, for anyone who needs the raw geometry |
| `<name>.dxf` | Dimensioned CAD drawing. Engineering lane, not for the twin |
| `metadata.json` | The record card. Schema `aura-scan-metadata/2.0`. The twin should treat this as the source of truth about the asset |
| `thumbnail.png` | Honest low-fi preview render |

The metadata fields the twin will care about:

```json
{
  "schema": "aura-scan-metadata/2.0",
  "id": "uuid4",
  "name": "point-lookout-picnic-table-01",
  "capture_mode": "asset",
  "asset_type": "picnic_table",
  "condition": "good",
  "captured_at": "ISO-8601",
  "capture_app": "stray-scanner",
  "location": { "lat": null, "lng": null, "gps_accuracy_m": null,
                "local_frame": "short name for this scan's own frame",
                "datum": "GDA2020", "notes": "" },
  "frame": { "up_axis": "Z", "units": "m", "origin_note": "" },
  "scale": { "method": "control_points", "factor_applied": 1.0, "verified": true,
             "constraints": [ { "distance_m": 1.52, "error_after_m": 0.003, "note": "" } ],
             "rmse_m": 0.004 },
  "dimensions_m": { "length": 1.82, "width": 0.85, "height": 0.78 },
  "links": { "places_link_id": "point-lookout" },
  "sensorium_evidence": { "rung": "lidar", "status": "captured" },
  "permissions": { "captured_by": "", "consent_note": "who okayed the capture" }
}
```

## What the twin can trust, and what it must not

**Trust:**

- **Metric scale.** ARKit capture is metric to about one percent, and when `scale.verified` is true
  the dimensions have been checked against a physical tape measure with the residual error reported
  in millimetres. `dimensions_m` is real.
- **The mesh itself.** Cleaned, largest-component, capped triangle count. One asset is roughly one
  draw call plus one material; no textures to fetch (vertex colours).
- **Provenance fields.** Who captured it, with what, when, with whose okay. Filled at capture time,
  not reconstructed later.

**Do not trust:**

- **Altitude.** The scan's vertical reference is its own session frame plus consumer GPS. This
  twin's ground is metres above LAT on ASTER terrain with 10 to 20 m vertical error
  (`data/geography.json`, elevation note). These will never agree. Seat assets by ground clamp:
  sample `island.height()` at the placement point and sit the asset's base on it. Never use the
  scan's own altitude.
- **Heading.** Each scan's local frame has arbitrary yaw; ARKit does not promise north. Placement
  needs an explicit `yaw_deg` per asset, set by a human eyeballing it. A future capture-side
  north-alignment step may remove this, but do not assume it.
- **Sub-metre position.** `location.lat/lng` is phone GPS, good to a few metres, good enough to
  place a pin. Final position is a human decision, recorded in the manifest, exactly like the pin
  the siting bench already places.

## The four decisions this repo owns

These are the twin's calls, not the capture side's. Recorded here so the agent who builds ingest
does not rediscover them.

1. **Loader.** GLB support requires vendoring `babylonjs.loaders.js` beside the existing vendored
   engine. The pipeline's GLBs are plain: no Draco, no meshopt, no KTX2, so no decoders are needed.
   `tools/serve.js` already MIME-maps `.glb`.
2. **Offline and determinism.** Assets and their manifest are committed files, so the offline rule
   holds untouched. For determinism, the manifest is world input like any data pack: same repo state,
   same island. If `--determinism` fingerprints inputs, the manifest belongs in the fingerprint.
3. **Frame conversion.** Twin local space is ENU metres, `+x` east, `+z` north, `y` up, via
   `island.project(lon, lat)` (`src/world/island.js`). The GLB is Y up already, so up matches.
   Do the lat/lng to local conversion with `island.project`, never a fresh derivation, then apply
   `yaw_deg`, then ground-clamp. Babylon's glTF import wraps meshes in a `__root__` transform for
   handedness; place via a parent node, not by editing vertices.
4. **Budget.** Contributed assets are individual draw calls; they cannot thin-instance like the
   procedural content. Current headroom is roughly 750 calls. LOD1 assets are cheap, but the budget
   line belongs to this repo, and a cap on concurrently visible scanned assets is its to set.

## Cultural gates

The capture side carries `permissions.consent_note` and a hard rule that culturally restricted
places are never scanned. But enforcement on the twin side has a known gap worth closing when the
prohibitions harness gets written: in `data/lore.json`, the `no-sacred-or-restricted-sites` rule's
scope does not currently include `assets/**` or an asset manifest, so a committed scan would slip
past it as written. Whoever builds the check harness (named as a next job in
`docs/CULTURAL-REVIEW.md` and `docs/STATE-OF-PLAY.md`) should extend that scope.

The existing `no-low-confidence-to-player` rule maps cleanly: an asset with `scale.verified: false`
or a `places_link_id` whose place record carries `coordinate_confidence: low` should be treated the
same way the packs treat low confidence, held back until checked.

## Vocabulary collisions

Five words in the capture schema already mean something else in this repo. Keep them separate; do
not merge the concepts.

| Word | In the capture contract | Already in this repo |
| --- | --- | --- |
| tier / LOD | Asset detail levels (LOD1 web, LOD2 archive) | Shader distance fade (`uLod` in flora) and subterranean build phases (`tier-2`...) |
| rung | Evidence ladder: photo, photogrammetry, lidar, drone, open-data, modelled | Flora regeneration distance bands |
| evidence | How a place was captured (`sensorium_evidence`) | Civic application completeness scoring |
| consent | Who okayed a capture (`permissions`) | Traditional Owner consent state gating subterranean works, already rendered with its own colour |
| contribution | Files: a scan someone processed and committed | The money-only C-hour ledger |

On that last one: `src/systems/economy/chour.js` states, deliberately, that there is no hour
verification protocol and there must not be one. The capture contract respects that position
completely. A contributed scan is files with a name attached, full stop. No hours, no ledger, no
verification protocol arrives with it.

## A minimal ingest shape (proposal only)

Not built, not mandated; `docs/CONTRACT.md` governs. Recorded so the first attempt starts from the
architecture the repo already has:

- `assets/manifest.json`, loaded exactly like a thirteenth data pack (same fetch pattern, same
  degrade-if-missing behaviour as `src/world/data.js`):

```json
{ "pack": "assets", "version": 1, "items": [
  { "id": "point-lookout-picnic-table-01",
    "glb": "assets/point-lookout-picnic-table-01/asset_lod1.glb",
    "metadata": "assets/point-lookout-picnic-table-01/metadata.json",
    "place_id": "point-lookout",
    "position": { "lat": -27.4276, "lng": 153.5270 },
    "yaw_deg": 0,
    "ground_clamp": true,
    "height_offset_m": 0 } ] }
```

- One render layer, `src/render/layers/scans.js`, Babylon-only per the split that matters. No
  simulation system needs to exist for assets to appear; if one ever reads the manifest (an asset
  register panel, say), it reads the JSON and never the GLB.

## Status, honestly

The processing pipeline is built and tested; one real object (a child's bike) has been through it at
correct scale; no asset has yet been delivered to this twin. The first candidates are a tape-measured
picnic table proof scan and the Point Lookout skate park. When the first folder lands in `assets/`,
this contract is what it will look like.

Capture side: `githublocal\aura-scan-pipeline` (formats and field guide in its `docs/`). The
plain-English public story of the same chain: https://auraofintelligence.github.io/straddie-digital-twin-explainer/
