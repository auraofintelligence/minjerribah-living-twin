# tools/connectors

The connector layer. The island's real organisations feeding in, and the twin feeding back.

`docs/CONNECTORS.md` is the document. This is the map of the directory.

| File | What it is |
| --- | --- |
| `lib.mjs` | Shared machinery: the wall-clock read, checkout reading, the record envelope, coarsening, the screen for records and for wanted entries, the wildlife app's wire format, feed writing. Freshness is not defined here: it is re-exported from `src/world/freshness.js` |
| `registry.mjs` | Every connector, built or not, with its source, cadence, freshness, what it can and cannot know, and what its organisation is asked and promised |
| `sync.mjs` | The runner. `--all`, `--due`, `--id`, `--list`, `--dry-run`, `--inbox` |
| `verify.mjs` | The feed gate. Envelope, privacy floor, coarsening, freshness, the cultural screen over records and wanted entries, the language reconciliation, registry integrity |
| `wildlife-rescue.mjs` | Connector: Wildlife Rescue Minjerribah |
| `noticeboard.mjs` | Connector: the Straddie Noticeboard Network |
| `events-engine.mjs` | Connector: the Quandamooka Country Events Engine |
| `refusals.mjs` | Two connectors built to refuse, which re-read their source every run to check the refusal still holds |
| `emit-day.mjs` | Emission: what the island looked like on this day |
| `emit-noticeboard.mjs` | Emission: a noticeboard notice, and the what-is-on digest for the screen network |
| `emit-rescue-draft.mjs` | Emission: a rescue report draft in the wildlife app's own format |
| `examples/` | The three observation shapes the rescue emitter accepts, including the one it always refuses |

Three rules hold the whole directory:

1. **A sync is an offline step.** Nothing here opens a socket. Reading the git commit of a source
   checkout is a local read of `.git` through git itself.
2. **Freshness is a field, not a feeling.** Every record says when it was synced, from what, at what
   commit, and what the source said about its own currency. The four words that turn a stamp into a
   state live in `src/world/freshness.js`, which the browser loads too, so the interface and this
   layer cannot drift into two vocabularies.
3. **The wall clock is read in exactly one place**, `nowIso()` in `lib.mjs`. Simulation code may
   never call it. It is this layer's equivalent of the clock system's declared exception.

House rules as everywhere: Australian English, no em dash, prices in A$, nothing fabricated, low
confidence never reaches a player, proposed stays proposed.
