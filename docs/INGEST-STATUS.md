# Ingest status: the pipeline, honestly mapped

One row per lane, check, queue part and connector. Every row that says something works carries
the receipt for it: what was actually run on 18 August 2026, against what input, with what
result. A row that says exists, untested is an honest answer. A row that says works without a
receipt is not allowed in this file.

How this was tested: each lane was run against small synthetic fixtures created in a temp
directory outside the repository, with obviously invented content (a Test Hall at 0 Example St,
flagged as a fixture in its own text), and every fixture and every staged by-product was deleted
afterwards. No island fact was invented, and nothing from any fixture survives in the repository.
The commands in the proven-by column reproduce each receipt, except where a row says why not.

The reference document is docs/INGEST.md, which says what each part is for. This file says what
state each part was actually in when somebody last exercised it, which is a different question.

## The state of the gate on the day of testing

`node tools/gate-audit.mjs` was RED at the start of this pass and is still red at the end, for
reasons that predate it: 12 blocking findings, all from data pack changes committed without the
registry being refreshed. In plain words: civic, transport, businesses and ecology were edited,
civic gained 24 records that cite nothing where the registry's accepted debt covers 23, one civic institution and
one transport service are each missing a required field, and the registry's versions, checksums
and confidence counts for those four packs are stale. The sanctioned remedy,
`node tools/ingest/registry.mjs --refresh`, correctly refuses to run while the other findings
stand (receipt below). Clearing this needs a person to give the new civic and transport records
their sources or raise the accepted debt with a written reason, then run the refresh. That is a
content judgement about real island records, so it was not made in this pass.

Everything below was tested against that red baseline, which turned out to be useful: several of
the refusal paths only show themselves when something is genuinely wrong.

## The ingest lanes

| Lane | What it is | Exists | Last actually exercised | Proven by | Known gaps |
| --- | --- | --- | --- | --- | --- |
| document (`tools/ingest/lane-document.mjs`) | A named PDF becomes candidate records with page and line citations; never writes a pack | Yes, built | 18 Aug 2026, this pass; last real use 14 Aug 2026 (rcc-chas-strategy in the register) | Registered a synthetic one-page fixture PDF, extracted 1 candidate with correct page/line locator and sha256, then deleted the candidate and restored the register byte-for-byte. `--list` shows the three real registered documents plus the map entry | `--list` crashed on the map lane's register entry (no sha256, no pages); fixed in this pass. Needs `pdftotext` on PATH (present on this machine, xpdf 4.06). Real extraction beyond the three registered RCC documents has not happened yet |
| contribution (`tools/ingest/lane-contribution.mjs`) | A typed-in batch of community contributions becomes envelope records with consent, attribution and a coarsened location | Yes, built as far as intake normalisation, deliberately no further | 18 Aug 2026, this pass; no real batch has ever been run through it | Valid fixture batch normalised (place coarsened from 50 m to the 250 m floor, credit withheld honoured, status contributed). A batch with an `hours` field REFUSED with the chour.js reason. A batch without consent REFUSED. Fixture candidate deleted after | Never used in anger: no real contribution batch exists yet. Which of the ten PARTICIPATION.md lanes are open is still the owner's call |
| map (`tools/ingest/lane-map.mjs`) | A KML/KMZ becomes screened, bounds-checked candidates reconciled against existing packs | Yes, built | Dry run 18 Aug 2026, this pass; last real run 10 Aug 2026 (map-contributions 0.2.0 in the registry, 42 features drawn by the sim at boot) | Synthetic two-placemark KML through `--extract --dry`: in-bounds placemark verdict NEW, the deliberate wrong-ocean placemark reported as outside the island rather than dropped, 1 planted contact-shaped string stripped and never printed | The real staged KML in ingest-inbox still carries two mobile numbers and cultural-token flags; the gate reports these every run as designed. Applying any CORRECTS verdict into places/businesses remains a person's decision, none applied yet |
| legislation (`tools/ingest/lane-legislation.mjs`) | A hand-written catalogue of Acts becomes measured, verified records; the lane behind data/legislation.json | Yes, built | `--resolve` and `--report` 18 Aug 2026, this pass; full chain last run 14 Aug 2026 (legislation pack 1.0.0) | `--resolve`: 66 of 66 instruments resolved against the official indexes (took about two minutes). `--report`: 66 verified and measured, 38,711 pages, 35,075 numbered provisions | `--index`, `--fetch`, `--measure`, `--judgments` and `--edges` were not re-run in this pass (network fetch and re-measurement; the downloaded consolidations in the gitignored inbox are from 14 Aug 2026). Two staged inbox files carry cultural-token flags the gate reports every run as designed |
| scenario (`tools/ingest/lane-scenario.mjs`) | Stamps a scenario with seed, pack checksums and registry fingerprint so a claim can be replayed by anybody | Partly built by design: stamping half only; running scenarios belongs to the scenario system | 18 Aug 2026, this pass | Fixture scenario with a real basis (civic.levers.vehicle-barge-peak-sailings) validates. A basis that names no real record REFUSED. `--stamp` REFUSED because the gate is red: a stamp says the content passed and it cannot say that today | No scenario has ever been stamped (nothing to stamp appears anywhere in the repository). Cannot be stamped at all until the gate is green again |
| era (`tools/ingest/lane-era.mjs`) | A declared stub, by design, not a gap: it exists to refuse loudly and say what would unblock it | Yes, as a stub that refuses | 18 Aug 2026, this pass | Running it prints the reason (no georeferenced historical mapping in hand; a generated 1896 coastline would put a fabricated island under a real event) and exits 2. `extract()` throws the same reason | None to record here: the unbuilt state is the design. The unblock list (georeferenced mapping, an uncertainty-display decision, the cultural gate) is in the file header |

## The gate and its checks

| Part | What it is | Exists | Last actually exercised | Proven by | Known gaps |
| --- | --- | --- | --- | --- | --- |
| `tools/gate-audit.mjs` umbrella | The one command a person runs; four severities, ledgered accepted debt, `--strict`, `--only`, `--json`, `--needs` | Yes | 18 Aug 2026, many times in this pass | Full runs before, during and after every experiment below; `--only lore` narrowing works and says the hours envelope was skipped because of it | Red at baseline for the pre-existing reasons above, not because of anything in this pass |
| deliberate-break test | Does the gate actually catch a broken record, not just in principle | n/a | 18 Aug 2026, this pass | Set places[0].confidence to an illegal value in the committed pack: caught three ways (confidence-scale, record-envelope, registry checksum drift), each naming file, record and field. Restored via git, diff empty afterwards | None |
| checks-lore.mjs | The lore pack's prohibitions: acknowledgement verbatim, no gamified culture, no generated Aboriginal art, language words need a flagged source, the word ledger | Yes | 18 Aug 2026, every full gate run | Gate lines: acknowledgement-present verbatim in index.html; 3 manual rules printed every run for a human, as designed | The manual rules are questions, not executable checks, and say so themselves |
| checks-records.mjs | Record envelope and per-pack schema | Yes | 18 Aug 2026 | Caught the deliberate break above, and caught the fixture promotion's illegal status (see promote row). Gate line: 1,669 records across 14 packs validated | The two pre-existing schema findings (civic institutions[11].source, transport services[2].status) stand for a person to fix |
| checks-repo.mjs | Em dashes, Australian English, registry integrity, fingerprint | Yes | 18 Aug 2026 | Gate lines: 203 files scanned, 0 em dashes; 39 spelling patterns, 0 hits; registry checks caught the four stale packs at baseline, which is this check doing its job | None found in this pass |
| checks-screens.mjs | Personal data and cultural tokens in staged or contributed material | Yes | 18 Aug 2026 | Gate lines: 45 files, 116 contact-shaped strings found, none printed; staged inbox files flagged for cultural tokens every run, promoted content clean | The flags on staged files are for-a-human by design and will print every run until the staged material is dealt with |
| checks-geo.mjs | Every coordinate against Moreton Bay, and contributed maps against the island | Yes | 18 Aug 2026 | Gate line: 242 positions in 14 packs checked. The map lane's own bounds check separately reported the fixture's wrong-ocean point | None found in this pass |
| checks-citations.mjs | Citations resolve against source registries; references resolve against the reference map | Yes | 18 Aug 2026 | Gate line: 717 citation fields resolved across 4 packs with a registry; 1,156 in 10 packs counted but unresolvable by design (they cite by URL or sentence); 1,087 references resolved | The 10 packs without a source registry stay honestly unresolved until somebody builds registries for them |
| checks-offworld.mjs | The off-world register stays sealed off from the default island state | Yes | 18 Aug 2026 | Gate line: 24 records, 0 references from the default island state into the register, which must be 0 and is | None found in this pass |
| needs-residual audit (`--needs`) | Slow proof that the cached action-gate residuals agree with the full gates | Yes | 18 Aug 2026, short run this pass | `--needs-only --ticks 72`: 72 ticks, 2,068 people, no residual disagreed with its gate | Only half a sim-day was run in this pass; the standard week (1008 ticks) and month were not re-run today |

## The promotion queue

| Part | What it is | Exists | Last actually exercised | Proven by | Known gaps |
| --- | --- | --- | --- | --- | --- |
| candidates staging (`tools/ingest/candidates/`) | Where lanes write and people read; 7 real candidate files staged there now | Yes | Continuously; fixture candidates written and deleted in this pass | Both fixture lanes wrote here and nowhere else; `Nothing has been added to data/` printed each time and was true | The 7 real staged candidate files are waiting on a person; nothing in this pass judged them |
| `tools/ingest/promote.mjs` unread refusal | A candidate still carrying the lane's `needs` note has been read by nobody, and the whole batch refuses | Yes | 18 Aug 2026, this pass | Promoting the fresh fixture candidate REFUSED, naming the unread record | None |
| `tools/ingest/promote.mjs` transaction | Pack and registry written, whole gate run, byte-exact rollback if anything blocks | Yes | Rollback path 18 Aug 2026, this pass; success path last used for the real packs (most recently legislation, 14 Aug 2026) | A fixture candidate with a deliberately illegal status was promoted into a throwaway pack: the gate caught it three ways, the pack was deleted and the registry was byte-identical afterwards (checked with cmp, not trusted) | The success path was not re-run in this pass, because a successful promotion writes a real pack and there was no real batch to promote. It cannot run at all until the gate is green |
| accepted-debt ledger (`tools/ingest/ledger.json`) | Blocking-class faults somebody accepted in writing, frozen counts that fail if they grow | Yes | Every gate run; 28 accepted entries, 8 pointers | The gate prints 32 accepted findings every run, each held to its frozen count. The same frozen-count idea in the registry's per-pack accepted debt is what blocks civic at baseline: 24 found, 23 covered | Paying the debt down is listed work, not tool work |
| word ledger (`tools/ingest/vocabulary-accept.mjs`) | Every name-shaped word new to the repository, printed for a person before anything is written | Yes | 18 Aug 2026, read-only run this pass | Printed 682 advisory new words and wrote nothing; `--write` was not run because the whole point is a person reading the list first | The list has not been read and accepted by a person since the feeds grew |
| `tools/ingest/registry.mjs --refresh` | The only sanctioned way to re-checksum packs; runs the whole gate first | Yes | 18 Aug 2026, this pass | Refused on the red gate with its own reason (a checksum over failed content would be a lie) and left the registry byte-identical, checked with cmp | Blocked until a person clears the baseline findings |

## The connectors, inbound

| Connector | What it is | Exists | Last actually exercised | Proven by | Known gaps |
| --- | --- | --- | --- | --- | --- |
| sync runner (`tools/connectors/sync.mjs`) | `--all`, `--due`, `--id`, `--list`, `--dry-run`, `--inbox` | Yes | 18 Aug 2026, this pass | `--list` prints all 15 connectors in their four honesty groups; `--dry-run --all` read every built source and wrote nothing; three real syncs below | None found in this pass |
| wildlife-rescue | Reads the local checkout of the island's rescue app repository | Yes, built | Real sync 18 Aug 2026, this pass | Read checkout at f23639197 (20 Jul 2026, clean), wrote the feed and updated the index; contacts 3, kept 40, held 0; the source's empty lookout board carried as a real answer, not a gap | Source checkout is from 20 July; the case stream itself remains an open ask of the rescue group |
| noticeboard | Reads the noticeboard network's research checkout; organisations only, individuals excluded whole | Yes, built | Dry run only 18 Aug 2026, this pass, DELIBERATELY | Dry run read 164 entities, profiled 9, kept 14, wanted 91. Then checked in memory without writing: a real re-sync would re-add the 6 person-named wanted entries and 1 mobile-shaped string that commit 93180f0 deliberately redacted from the committed feed. So the feed on disk was left alone | REAL GAP, sized: the privacy redaction lives only in the committed feed, not in the connector, so the connector cannot be re-run until the exclusion is moved into tools/connectors/noticeboard.mjs (drop or role-ise a wanted entry that names a private person). Until then the feed gate's one blocking finding (noticeboard checksum) stands, and re-syncing would be worse than the finding. An hour of careful work plus a person checking the six exclusions |
| events-engine | Reads the events engine checkout; cultural events carried as date, place and listing source only | Yes, built | Real sync 18 Aug 2026, this pass | Read checkout at 3bb21b632, kept 63, held 0, 6 cultural records flagged for a human as designed; feed and index written | The checkout is from 3 July against a weekly cadence and the connector itself warns to pull first; it was not pulled in this pass (a fetch of another repository was out of scope). The 6 flagged records are still waiting in docs/CULTURAL-REVIEW.md |
| weather | The one networked connector: two named Open-Meteo endpoints, CC BY 4.0, model output honestly labelled | Yes, built | Real sync 18 Aug 2026, this pass | Both endpoints reachable from this machine; 15 readings, kept 2; feed written with the modelled-at time separate from the fetched-at time | Model output for a grid cell, not station observations, and the feed says so itself. Goes stale after 1 day by its own rule, so it is stale most of the time unless a scheduled job runs it |
| bom-weather-api, straddie-news, plfc | Built to refuse; they re-read their source every run to check the refusal still holds | Yes | 18 Aug 2026, via `--dry-run --all` | Each printed its grounds and confirmed the refusal still holds on what is in the source today; nothing written | None: refusing is their job |
| minjerribah-camping, surf-life-saving, mmeic, qyac-rangers, dunwich-state-school, sandy-sports-club, little-ship-club | Defined, no data in hand: registry entries stating what would be asked and promised | Registry entries only, honestly labelled | n/a, nothing to run | `--list` prints each with its reason under Defined, no data in hand | Each needs a human conversation before it is a connector; surf-life-saving is flagged in its own entry as highest value because patrol status is a safety answer |
| feed gate (`tools/connectors/verify.mjs`) | Envelope, privacy floor, coarsening, freshness, cultural screen, checksum over every feed | Yes | 18 Aug 2026, before and after the syncs | Before: caught the noticeboard hand-edit as a checksum mismatch and two stale feeds. After the three re-syncs: freshness advisories cleared, the noticeboard finding stands for the reason in its row | The one standing blocking finding is deliberate, see the noticeboard row |

## The emissions, outbound

| Emitter | What it is | Exists | Last actually exercised | Proven by | Known gaps |
| --- | --- | --- | --- | --- | --- |
| emit-day | Boots the sim headlessly to a named date and writes what the island was doing to out/emit/day/ | Yes | 18 Aug 2026, this pass | Asked for a date before the world opens: refused with the reason (this world opens 2026-09-19). Asked for 2026-09-20: wrote the .json and .md pair, labelled a model of a day, not a record of one | Runs take a minute or two; out/ is gitignored so emissions never enter history |
| emit-noticeboard | A draft notice in the noticeboard's own schema, status draft_for_human_review | Yes | 18 Aug 2026, this pass, both modes | `--day` wrote a draft from the emitted day; `--events` wrote the what-is-on digest; both name the proposed island screens and say a person sends it, the twin does not | Drafts only; nobody has ever actually sent one to the noticeboard network |
| emit-rescue-draft | A rescue report draft in the wildlife app's own wire format, with the guard that matters | Yes | 18 Aug 2026, this pass, all three example shapes | Fixture observation: screened, encoded with the app's own sync.js, written with DO NOT SEND on the first line. Simulated observation: REFUSED outright, no flag exists to override. Incomplete real observation: refused naming the four missing human fields | Sending remains a person pasting into the group chat, by design; no real observation has been through it |

## Feed index versus pack registry, because they are different things

| Register | What it is | Its gate | Proven by |
| --- | --- | --- | --- |
| `data/feeds/_feeds.json` | One entry per connector feed: synced-at, checksum over the feed file as it stands. Feeds are what a source said, they are never packs, and the sim does not read them as truth | `tools/connectors/verify.mjs` | It caught the hand-edited noticeboard feed as a checksum mismatch in this pass |
| `data/_provenance.json` | One entry per data pack: version, checksum (sha256-lf), record counts, confidence spread, lane, plus the document register and the whole-repo fingerprint scenarios pin | `tools/gate-audit.mjs`, and only `tools/ingest/promote.mjs` or `registry.mjs --refresh` may write it | It caught the four stale packs at baseline, and the fixture promotion's rollback left it byte-identical |

## What this pass changed in the repository

- `tools/ingest/lane-document.mjs`: fixed the `--list` crash on register entries without sha256
  or pages (the map lane writes such entries). Behaviour otherwise unchanged.
- `data/feeds/_wildlife-rescue.json`, `_events-engine.json`, `_weather.json`, `_feeds.json`:
  re-synced through their own connectors, which is those files' normal life.
- This file.

Everything else was exercised and put back: fixtures deleted, the registry and packs
byte-identical after every experiment, checked with cmp rather than assumed.

## Verification of this pass itself

- `node tools/headless.mjs --determinism` run after everything above: DETERMINISM OK, two runs
  of 1440 ticks agree, hash fca6976b.
- The gate was run after every write. It is red for the pre-existing baseline reasons stated at
  the top, and this pass added no finding to it: the blocking list before and after is the same
  12, name for name.
