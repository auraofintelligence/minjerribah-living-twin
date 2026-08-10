# Feeds

What a connector read from a real island source, staged for a person.

**A feed is not a data pack.** The twin never loads anything in this folder. `data/_provenance.json`
is the registry for packs; `data/feeds/_feeds.json` is the index for these, and it records for each
feed the source it came from, the commit it read, when it was synced, its cadence and a checksum.

**Why every filename starts with an underscore.** `tools/gate-audit.mjs` treats every `.json` under
`data/` as a pack the twin loads unless the filename starts with one, and says so in its own hint.
`data/_provenance.json` already uses the same convention for the same reason.
`tools/connectors/verify.mjs` fails on a feed file that does not.

**Do not edit a feed by hand.** A feed is what a source said. The checksum in `_feeds.json` catches a
hand edit and `verify.mjs` reports it, which is the check doing its job rather than a nuisance. If
something in a feed is wrong, the fix is upstream, or it is a correction recorded as a correction
through the contribution lane. The checksum is not the only thing that catches an edit: the gate
also re-runs the cultural screen, the privacy floor and the envelope over what is on disk, so a
record or a wanted entry broken on its merits fails on its merits and names which rule.

**Four blocks in every feed, and `cultural_flags` is the one to read first.**

| Block | What it holds |
| --- | --- |
| `records` | What passed the screen and carries the full envelope, ready to promote |
| `held` | What the screen refused, with the rule that refused it. A held record is the connector working |
| `wanted` | Real organisations and real gaps nobody has asked about. This is the participation loop's content |
| `cultural_flags` | Anything in either of the two lists above that names a cultural event, a Traditional Owner organisation or Country. Empty is a valid answer and an absent block is not, which is why the gate blocks on one that is missing |

The underscore keeps a feed out of the pack loader and out of the pack registry check. It does not
keep it out of `no-invented-language`, which reads every `.json` under `data/`, so feeds raise
advisories there. `verify.mjs` counts and attributes them and blocks on any new word that lands in a
cultural position. `docs/CONNECTORS.md` has the number and the route to clear it.

```bash
node tools/connectors/sync.mjs --all       rewrite every feed from its source
node tools/connectors/verify.mjs           the feed gate
```

The whole design, every connector, its cadence, its freshness policy, what it can and cannot know,
and what each source organisation is being asked for and promised: `docs/CONNECTORS.md`.
