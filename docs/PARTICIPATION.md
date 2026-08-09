# Participation

How the island contributes to its twin. This is the direction the founding brief never contained.
Nothing in this document is built; it exists so the wave that builds contribution starts from the
owner's actual design instead of a guess. Read `docs/CAPTURE-CONTRACT.md` first; this generalises
it from scans to everything else.

The promise `docs/CONTRACT.md` makes to agents extends to every contributor: one shape for a
hundred hands. Whether the contributor is an AI agent, a resident with a tape measure, a shopkeeper
with a menu, or a kid with a LiDAR phone, the contribution lands the same way: a record in a
versioned data pack, carrying its source, its provenance and a confidence rating, gated by the same
cultural review queue as everything else. There is no separate, lower-trust lane for community
content. There is one spine.

## Who contributes

Five roles, from the owner's corpus. Every contribution record names the role that produced it.

- **Player**: plays the twin and logs observations of the real island.
- **Builder**: makes or maintains real things the twin models, and supplies scans, measurements and
  condition notes about them.
- **Developer**: extends the code and the packs, agent or human.
- **Researcher**: works with aggregated pack data, with permission.
- **Custodian**: a person or group entrusted with guardianship of specific knowledge, who decides
  what appears, at what visibility, and can change that answer later. Custodianship is guardianship,
  not moderation. It applies here to non-cultural knowledge: family memories, club records, business
  facts, where the pointer-never-payload floor already protects the content. For culturally
  restricted knowledge this repository has exactly one state: absence, full stop. No record of the
  content, and no record that it exists or who holds it; any such record is QYAC's to make through
  its own processes, never this repo's.

## The lanes

Ordered from lowest technology, because the no-phone islander is a first-class contributor here,
not a fallback.

1. **The spoken correction.** Already proven: the packs fold in the owner's corrections with a note
   explaining why, so a later agent does not re-add a closed business from a stale listing. A
   resident tells someone a fact; the fact lands in a pack with source, contributor and a note.
   This is the entry lane, and it needs nothing but knowing something true.
2. **Paper.** Printable observation cards and sighting logs the twin generates offline, filled by
   hand, typed in later by a named, credited transcriber. Printable QR place cards keyed to places
   already in the packs, so a basic camera phone reaches a simple form. Hand-in points at real
   venues, not accounts.
3. **Measurements.** A tape measure is an instrument of contribution: the capture contract's
   metadata-only tier means a real asset can enter the twin as verified dimensions on paper before
   any scan exists, and upgrade in place when a scan arrives.
4. **Business and community facts.** Shopkeepers and clubs are named contributor classes: trading
   hours, menus, event listings, corrected addresses. Adapted from the corpus's claim-your-listing
   model to this repo's reality: contributions arrive through any channel, become pack records with
   attribution and a verified-by field, and ship in the next release. No live edits, no portal.
5. **Scans.** `docs/CAPTURE-CONTRACT.md` in full: GLB plus record card, ground-clamped, human-placed.
   Extended by this direction with a condition-report block (structural note in plain language,
   maintenance recommendations, contents inventory, materials summary, every field
   confidence-rated), which defaults to island-community visibility or lower: what is inside a real
   building and what is wrong with it is not public-twin material, so the public pack ships only
   what rendering needs, with the rest stripped at pack-build time like raw coordinates. Pre-baked
   variant assets are a legitimate contribution type. Runtime generation of assets stays out, full
   stop.
6. **Observations of living things.** Sightings and seasonal observations, arriving out-of-band
   through the same intake the wildlife work already built, landing as records with place, time,
   evidence link and confidence. Precise locations of anything vulnerable (nests, dens, private
   homes) never enter the repo; fuzzing happens before commit, not at display time.
7. **Wishes.** A wish-list pack: each wish carries its text, a theme, an optional coarse location,
   consent, and review status. Wishes are the lane where any resident shapes what simulations
   optimise for: scenario setup surfaces matching wishes as selectable objectives, and scenario
   reports state which wishes were addressed and by how much.
8. **Scenario suggestions.** "What if we tried a community garden here" arrives on paper or in
   conversation, a steward converts it into a seeded scenario, and the originator is credited in
   the scenario record. Any scenario shaped like a policy recommendation carries a note that its
   report is input to open community discussion, not a decision.
9. **Memories and stories.** The most sensitive lane, and the one with the strictest floor:
   **pointer, never payload**. A memory anchor is a place, a contributor-chosen public label,
   declared metadata, a consent status, and an opaque pointer to the memory itself, which stays
   with the person or family that owns it. The repo holds the map pin; the person holds the memory.
   Intake follows four modes from the corpus: solo, assisted (a grandchild or carer operates while
   an elder speaks), group workshop, and an event booth: a staffed table at a real community event,
   fully offline, whose output is a curated batch reviewed for consent and cultural gates before it
   lands in a later release. Emotion and relationship labels are declared by the contributor in
   their own words; nothing is ever inferred from faces, voices or text. Every anchor names a
   place, so every anchor passes cultural review before it ships, and an anchor that fails review
   is removed entirely, never flagged; the schema records only that review passed, never why an
   absent record is absent. Anchors touching grief or memorial default to unlisted. Ask: whether
   this lane proceeds at all, and under what governance, is the owner's and Traditional Owners'
   call before the first anchor ships.
10. **Event plans.** The dogfooding lane, and the twin's most concrete near-term civic proof: plan
    one real community event end to end. Scan the venue under the capture contract, place it in the
    twin, run deterministic scenario packs (crowd flow, egress timing, the southerly-buster
    scenario, a high tide at a low foreshore), and hand the organisers a plain planning document.
    Community venues come first: the club, the field, the reserve. A familiar gathering place makes
    the twin legible as a practical tool; a scenic flyover does not.

**Not a lane.** Aboriginal language, story, ceremony, art and site knowledge are not accepted
through this repository, from anyone, however offered. Four blocking prohibitions forbid it, and
this repo cannot verify a contributor's identity or authority to share cultural material. The
route for Quandamooka cultural material is through QYAC, or it does not exist. This is recorded
without apology; it is the most important refusal in the file.

## How contributions are trusted

The existing fact-checking spine, applied without a discount:

- **Provenance travels with the file**, filled at capture time, never reconstructed: contributed_by,
  transcribed_by where relevant, method (spoken, paper, workshop, booth, scan), date, and the
  permissions block (captured_by, consent_note) from the capture contract.
- **Confidence gates ship.** A contribution enters with the contributor's own confidence, gains
  attestations recorded as data (who vouched, how, when), and graduates into player-visible packs
  only past the same threshold every pack already honours. Below it, the record is held. Held is a
  normal state and the docs say so: unreviewed is invisible, not caveated.
- **Corrections are provenance, not overwrite.** When a reviewer corrects a value, the pack keeps
  both: the corrected value displays, the original is retained unrendered, and the correction names
  who and when. Review is visible and auditable, and residents get a real editing role.
- **Trust attaches to claims, never to people.** Records carry scores; contributors never do. On an
  island this small a person-score is a social ranking. Credit is a name in a manifest, and that is
  the whole recognition system: no points, no badges, no leaderboards, no tallies. The wanted list
  is the one gamification-adjacent device this direction allows: a visible list of what the commons
  needs next (a missing scan, a flowering date, a gap in the hours), where the reward for filling a
  gap is that the gap is filled, with your name on the record.
- **Show the source, teach the reader.** Any contributed record a player can see is one click from
  who made it and how it was verified. A calendar that hides its own gaps is a lie on an island
  this size; so is a contribution that hides its provenance.

## Consent and sharing

- Consent is explicit, purpose-bound and per-record. The dial stays in the contributor's hand, and
  the working assumption is generous: people who trust a system share freely, and this system earns
  that by being checkable, not by promising anonymity it cannot deliver.
- Every contributed record carries a visibility level (private to contributor, island community,
  public twin) and, where located, a coarsened location. Both are enforced at pack-build time:
  raw coordinates and above-level records are stripped before commit, never filtered at runtime.
- Withdrawal is honoured at the next release through a tombstone list: the record is removed and
  its id retained with a withdrawn marker, so it disappears honestly rather than silently. And the
  docs tell contributors the truth about the medium: a public git history persists, so revocation
  after publication is best-effort, and anything that might one day need full erasure belongs at a
  lower visibility level from the start.
- A memory that involves other people needs their consent too, or their part is anonymised before
  any label ships.
- A contribution from a minor requires a parent or guardian's consent, recorded in the permissions
  block, and a minor's credit defaults to omitted or pseudonymous, upgradeable only by the
  guardian.

## The three strands of care

Stated here because contribution and care will meet, and the settled position must be carried
correctly, in the owner's framing:

1. **Money is ledgered.** The operational ledger is money-only, because that is what people will
   actually and honestly report.
2. **A C-hour is a record someone chooses to make.** In the owner's own words, already carried in
   this repo: one C-hour is a record that one real hour of community work happened, a real person, a
   real hour, signed off; deliberately not money, no price, never traded, never sold back to the
   person who did it. From the owner's design notes held outside this repo, two graceful shapes for
   how a working bee's afternoon gets recorded: the asker records it rather than the helper
   claiming it, and anything shown publicly aggregates to the group (the club did four hundred
   hours), while the signed-off records underneath stay per person. Ask: the owner confirms that
   recording shape before any wave builds it.
3. **The unmeasured care stays unmeasured on purpose.** The gap between the ledger and the care is
   not missing data; it is the message.

Nothing in any contribution lane may become an hour-verification protocol. A booth operator log
records provenance, never hours. `src/systems/economy/chour.js` has already run the experiment that
shows why; read it before improving it.

## The floor

Any surface through which people contribute or browse contributions meets this floor, and the paper
path is never deprecated once digital lanes exist:

- WCAG 2.2 AA, large targets, high contrast, resizable text, and a voice-first or talk-only
  alternative; complexity hidden behind one big obvious action.
- Assisted contribution is normal, not an edge case: an operator or family member driving the
  tooling while the contributor talks is a first-class mode.
- The target device is a shared community machine or an old laptop, with quality tiers and graceful
  degradation; the people this twin serves should be able to run it.
- Multilingual support is planned for, and any Jandai or cultural language content follows the
  Not-a-lane rule above: custodial route or nothing.

## Mechanics

For the agent who builds this: contributions enter the repo as committed pack updates between
releases; the manifest is world input and belongs in the determinism fingerprint; the twin makes no
network requests at runtime and no contribution mechanic may introduce one; placement of anything
in the world is a human decision recorded in data; and the cultural gates should become
machine-checkable access rules alongside the lore prohibitions, enforced at pack-build time, so
the build refuses what the rules forbid instead of relying on memory. The prohibitions harness, when written, extends the
sacred-sites rule's scope to `assets/**` and every contribution pack; the capture contract already
flags that gap. Keep the five collided words (tier, rung, evidence, consent, contribution) separate
per the capture contract's table.

## Ask

- Ask the owner: which lanes open first; the default for contributor credit (named, pseudonymous,
  or omitted, and whether the contributor chooses per record); the consent wording and who holds
  the withdrawal register; whether transcribers and booth stewards are paid through the ledger;
  whether grief and memorial anchors are ever publicly visible; and whether this document should
  even describe a future QYAC-routed cultural lane, given that describing it could read as implying
  a relationship that does not exist.
- Ask QYAC, through the queue in `docs/CULTURAL-REVIEW.md`, everything that file already asks. The
  first question there stands over this document too.
