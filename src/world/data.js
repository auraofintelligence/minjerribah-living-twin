// Static data packs. Everything the island is made of that is not code lives in /data as JSON
// so it can be checked, corrected and sourced without touching the simulation.
// A missing pack is not fatal: the loader returns an empty pack and the systems degrade visibly.
//
// Which packs exist is no longer a list in this file. It is data/_provenance.json, the pack
// registry: one entry per pack carrying its version, the lane it came through, the documents it
// was read out of, when it was ingested, by which extractor, its checksum and the spread of
// confidence inside it. The registry is a committed file, so loading is still one fetch per pack
// off disk with no lookup, no service and no network beyond the origin the page came from.
// docs/INGEST.md is the contract; tools/gate-audit.mjs is what enforces it.
//
// This file also carries the small set of judgements every system and panel needs to make about a
// record and must all make the same way: what confidence is this, may a player see it, is it
// proposed rather than real, and where did it come from. They are plain functions with no
// dependencies so that tools/ingest can import the very same code the interface runs. A gate that
// re-implements the runtime's judgement is a gate that tests a copy.

/**
 * The packs to load if data/_provenance.json is missing or unreadable. The registry is the source
 * of truth; this exists so that a repository with a damaged registry still boots an island, and so
 * that the loader has no ordering dependency on a file that can go wrong.
 */
const FALLBACK_PACKS = [
  'geography',   // coastline, lakes, roads, elevation control points, place polygons
  'places',      // named places, beaches, lookouts, headlands, tracks
  'businesses',  // real operating businesses and organisations, with hours and roles
  'ecology',     // species, habitats, seasonal behaviour, thresholds
  'civic',       // council, QYAC, agencies, levers, real live issues
  'residents',   // household archetypes, occupations, name pools, demographics
  'transport',   // ferries, barges, buses, roads, parking, capacity
  'events',      // real recurring events and festivals
  'subterranean',// the below-sand works: layout, processes, materials
  'narrative',   // drama beats, character seeds, storyline grammar
  'soundscape',  // every voice the island can make, and where the claim it belongs here comes from
  'lore'         // acknowledgements, protocol notes, cultural guidance and its sources
];

export const REGISTRY_FILE = 'data/_provenance.json';

/**
 * The feed index, which is not the pack registry and must not be confused with it.
 *
 * `data/_provenance.json` registers packs: durable claims about the island that a person read and
 * vouched for. `data/feeds/_feeds.json` indexes feeds: what a source said at a moment, staged. Until
 * this pass the twin loaded packs and nothing else, and docs/CONNECTORS.md said so plainly under
 * "what is not built": no feed was drawn in the running twin.
 *
 * Weather is what changed that, and the reason is worth writing down rather than treating as an
 * exception granted quietly. A twin of a real island, opened live, showing invented weather is a
 * demonstration wearing a twin's clothes. The promotion queue is the right gate for a claim that
 * will sit in a pack for years and the wrong one for a measurement with a shelf life of minutes: by
 * the time a person had read a rain figure it would be worthless. So a feed may declare
 * `runtime_read` and be loaded here, and what that buys it is narrow. It is never promoted, it never
 * becomes a fact about the island, and nothing drawn from it appears without the moment it is for
 * and the rung it came off.
 *
 * The flag lives in the index rather than in a list in this file on purpose. A weather station on
 * the surf club roof should arrive as a feed with a flag on it, not as a line somebody has to add
 * to a loader. See docs/CONNECTORS.md, "The source ladder".
 */
export const FEED_INDEX_FILE = 'data/feeds/_feeds.json';

/** The one confidence scale. Each pack defines these three words in its own terms; nothing may add a fourth. */
export const CONFIDENCE = ['high', 'medium', 'low'];
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

/** The three statuses a record produced by a lane may carry. docs/INGEST.md is the contract. */
export const ENVELOPE_STATUSES = ['committed', 'contributed', 'proposed'];

/**
 * Every status word in the packs, mapped onto what the interface has to do about it.
 *
 * Two of these kinds are legacy only and exist because the packs already draw a distinction the
 * envelope does not. `unconfirmed` is the important one: `trading-unconfirmed` in
 * data/businesses.json means a real business somebody could not confirm is still trading, and there
 * are 33 of them. Folding that into `proposed` would put a Proposed badge on a shop that is
 * probably open, which is a different and worse falsehood than the one the marker exists to
 * prevent. So it gets its own marker that says what is actually true: nobody has checked lately.
 */
export const STATUS_VOCABULARY = {
  committed: [
    'committed', 'current', 'in_place', 'operating', 'trading', 'funded', 'ended', 'closed',
    'adopted', 'built'
  ],
  contributed: ['contributed', 'submitted', 'awaiting_review'],
  proposed: ['proposed', 'modelled_option', 'under_study', 'concept', 'draft', 'planned'],
  unconfirmed: [
    'unconfirmed', 'trading-unconfirmed', 'closed-unconfirmed', 'contested', 'not verified',
    'not_reviewed_by_traditional_owners'
  ],
  withdrawn: ['withdrawn', 'tombstoned']
};

/** Visibility levels from docs/PARTICIPATION.md, lowest first. A player sees public_twin only. */
export const VISIBILITY = ['private', 'island_community', 'public_twin'];

// ------------------------------------------------------------------------------------------------
// The judgements. Cheap, allocation-free where they are called in a loop, and shared with the gate.
// ------------------------------------------------------------------------------------------------

/**
 * The confidence rating on a record, or null when it carries none.
 *
 * Only the `confidence` field. A place with `coordinate_confidence: low` is a place whose position
 * is rough, not a place whose existence is doubtful, and hiding it would be the wrong call.
 */
export function confidenceOf(record) {
  if (!record || typeof record !== 'object') return null;
  const v = record.confidence;
  return typeof v === 'string' && CONFIDENCE_RANK[v] ? v : null;
}

/** True when the record's confidence is at or above `floor`. Records with no rating do not pass. */
export function confidentTo(record, floor = 'medium') {
  const c = confidenceOf(record);
  return c ? CONFIDENCE_RANK[c] >= (CONFIDENCE_RANK[floor] || 2) : false;
}

/**
 * Normalise whatever a record says about its status onto the envelope's four words, or null when
 * the value is not one this project knows. Null is the interesting answer: it means the interface
 * would render the record with no marker at all, which is how a proposal becomes a fact by being
 * modelled. tools/gate-audit.mjs fails on it.
 */
export function statusOf(record) {
  if (!record || typeof record !== 'object') return null;
  const raw = record.status;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim().toLowerCase();
  for (const kind of ['withdrawn', 'proposed', 'unconfirmed', 'contributed', 'committed']) {
    if (STATUS_VOCABULARY[kind].includes(v)) return kind;
  }
  return null;
}

/**
 * The badge a record must wear wherever it is rendered. Null means it needs none.
 * Anything proposed stays marked proposed, everywhere, in every panel, forever.
 */
export function labelFor(record) {
  const s = statusOf(record);
  if (s === 'proposed') return { marker: 'Proposed', tone: 'proposed', why: 'not built, not approved, not funded' };
  if (s === 'contributed') return { marker: 'Contributed', tone: 'contributed', why: 'supplied by a contributor and not yet verified by a second source' };
  if (s === 'unconfirmed') return { marker: 'Unconfirmed', tone: 'unconfirmed', why: 'a real thing nobody has been able to check lately' };
  if (s === 'withdrawn') return { marker: 'Withdrawn', tone: 'withdrawn', why: 'the contributor withdrew this record' };
  return null;
}

/**
 * May a player see this record?
 *
 * The rules this executes are already written down in three places and until now nothing enforced
 * any of them: `player_facing: false` in data/lore.json's own conventions, the blocking prohibition
 * no-low-confidence-to-player, and the per-record visibility level in docs/PARTICIPATION.md.
 *
 * It does not decide *how* to show a record. A record carrying a `handling_rule` may be shown only
 * in the way that rule says, and the caller must read it with handlingOf().
 */
export function mayShow(record, opts) {
  if (!record || typeof record !== 'object') return false;
  if (record.player_facing === false) return false;
  if (statusOf(record) === 'withdrawn') return false;
  const c = record.confidence;
  if (c === 'low') return false;
  const vis = record.visibility;
  if (typeof vis === 'string') {
    const audience = (opts && opts.audience) || 'public_twin';
    if (VISIBILITY.indexOf(vis) < VISIBILITY.indexOf(audience)) return false;
  }
  return true;
}

/** The handling rule attached to a record, or null. Read it before rendering anything cultural. */
export function handlingOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.handling_rule === 'string') return record.handling_rule;
  for (const k of ['cultural_reference', 'cultural_handling']) {
    const v = record[k];
    if (v && typeof v === 'object' && typeof v.handling_rule === 'string') return v.handling_rule;
    if (typeof v === 'string') return v;
  }
  return null;
}

/** Whatever the record says about where it came from, as a single string, or an empty string. */
export function sourceOf(record) {
  if (!record || typeof record !== 'object') return '';
  for (const k of ['source', 'sources', 'source_ref', 'source_pack', 'citation', 'reference', 'url']) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v.map((x) => (typeof x === 'string' ? x : x && x.source) || '').filter(Boolean).join('; ');
  }
  return '';
}

// ------------------------------------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------------------------------------

async function fetchJSON(file) {
  const res = await fetch(file, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status + '');
  return res.json();
}

/**
 * Load the registry, then every pack it lists, in the registry's own order.
 *
 * Order matters more than it looks. The previous loader assigned each pack into the result inside
 * a Promise.all callback, so the key order of world.data was the order the fetches happened to
 * finish in, which is a piece of non-determinism sitting one `Object.keys` away from mattering.
 * The packs are still fetched in parallel; only the assembly is ordered.
 */
export async function loadDataPacks() {
  let registry = null;
  try {
    registry = await fetchJSON(REGISTRY_FILE);
  } catch (e) {
    console.warn('[data] pack registry data/_provenance.json missing or invalid, falling back to the built-in list', e.message);
  }

  const entries = registry && Array.isArray(registry.packs) && registry.packs.length
    ? registry.packs.filter((p) => p && p.id && p.load !== false)
    : FALLBACK_PACKS.map((id) => ({ id, file: `data/${id}.json` }));

  const loaded = await Promise.all(entries.map(async (entry) => {
    const file = entry.file || `data/${entry.id}.json`;
    try {
      return { id: entry.id, pack: await fetchJSON(file), ok: true };
    } catch (e) {
      console.warn(`[data] pack "${entry.id}" (${file}) missing or invalid`, e.message);
      return { id: entry.id, pack: { __missing: true, items: [] }, ok: false };
    }
  }));

  const out = {};
  for (const { id, pack } of loaded) out[id] = pack;

  attachProvenance(out, registry, loaded.filter((l) => !l.ok).map((l) => l.id));
  await attachFeeds(out);
  return out;
}

/**
 * Load the feeds that declare themselves readable by the running twin, in the index's own order.
 *
 * Two fetches deep and no further: the index, then whatever it flags. Both come off the page's own
 * origin at boot, exactly as the packs do, and nothing here is ever called again. A missing index is
 * the normal case on a checkout where nobody has synced, and it degrades to no feeds rather than to
 * an error, because an island with no weather reading still runs its own weather.
 *
 * Attached as a non-enumerable function so nothing walking the packs trips over it, which is the
 * same reason the provenance API is attached that way.
 */
async function attachFeeds(out) {
  const feeds = {};
  const notes = { index: false, loaded: [], missing: [] };
  let index = null;
  try {
    index = await fetchJSON(FEED_INDEX_FILE);
    notes.index = true;
  } catch {
    // No feed index on this checkout. Not a fault: nobody has run a connector here.
  }
  const wanted = index && Array.isArray(index.feeds)
    ? index.feeds.filter((f) => f && f.id && f.runtime_read === true)
    : [];
  const got = await Promise.all(wanted.map(async (entry) => {
    const file = entry.file || `data/feeds/_${entry.id}.json`;
    try { return { id: entry.id, feed: await fetchJSON(file), ok: true }; } catch (e) {
      console.warn(`[data] runtime feed "${entry.id}" (${file}) missing or invalid`, e.message);
      return { id: entry.id, feed: null, ok: false };
    }
  }));
  for (const { id, feed, ok } of got) {
    if (ok) { feeds[id] = feed; notes.loaded.push(id); } else notes.missing.push(id);
  }

  const api = {
    /** One feed by id, or null. Null is a normal answer and every caller has to handle it. */
    feed(id) { return feeds[id] || null; },
    /** Which runtime feeds loaded, which did not, and whether there was an index at all. */
    feedStatus() { return { index: notes.index, loaded: notes.loaded.slice(), missing: notes.missing.slice() }; }
  };
  for (const [k, v] of Object.entries(api)) {
    Object.defineProperty(out, k, { value: v, enumerable: false, writable: false, configurable: true });
  }
  return out;
}

/**
 * The provenance API, attached to world.data as non-enumerable properties so that nothing which
 * walks the packs trips over a function. Systems ask three questions through it: where did this
 * record come from, how confident is it, and may it be shown to a player.
 */
function attachProvenance(out, registry, missing) {
  const byId = new Map();
  const docs = new Map();
  if (registry) {
    for (const p of registry.packs || []) byId.set(p.id, p);
    for (const [id, d] of Object.entries(registry.documents || {})) docs.set(id, d);
  }

  const api = {
    /** The whole registry, or null when it did not load. */
    registry: registry || null,
    /** Pack ids that failed to load. Empty is the normal case. */
    missing,
    /**
     * A short stable hash over every pack id, version and checksum in the registry. Publish it
     * beside the seed with any scenario report: seed plus fingerprint is the whole of what makes a
     * run replayable by somebody else, per docs/DIRECTION.md.
     */
    fingerprint: (registry && registry.fingerprint) || 'unregistered',

    /** The registry entry for a pack: lane, sources, extractor, checksum, confidence spread. */
    packInfo(id) { return byId.get(id) || null; },

    /** The source document record behind a document id, from the registry's document register. */
    document(id) { return docs.get(id) || null; },

    confidenceOf,
    confidentTo,
    statusOf,
    labelFor,
    mayShow,
    handlingOf,
    sourceOf,

    /**
     * Everything known about where one record came from, in one object, for an inspector panel or
     * a scenario report line. Allocates, so call it on a click and not in a tick.
     */
    originOf(record, packId) {
      const pack = byId.get(packId) || null;
      const src = sourceOf(record);
      const doc = docs.get(record && record.source) || null;
      return {
        pack: packId || '',
        packVersion: pack ? pack.version : null,
        lane: pack ? pack.lane : '',
        source: src,
        document: doc,
        locator: (record && (record.locator || record.page)) || '',
        quote: (record && record.quote) || '',
        confidence: confidenceOf(record),
        status: statusOf(record),
        extractedAt: (record && record.extracted_at) || (pack ? pack.ingested_at : ''),
        extractor: (record && record.extractor) || (pack && pack.extractor ? `${pack.extractor.id}/${pack.extractor.version}` : ''),
        contributedBy: (record && record.contributed_by) || '',
        handling: handlingOf(record)
      };
    },

    /**
     * One line a player can read, for the promise in docs/PARTICIPATION.md that any contributed
     * record a player can see is one click from who made it and how it was verified.
     */
    citationOf(record, packId) {
      const o = api.originOf(record, packId);
      const bits = [];
      if (o.document && o.document.title) bits.push(o.document.title);
      else if (o.source) bits.push(o.source);
      if (o.locator) bits.push(o.locator);
      if (o.contributedBy) bits.push('contributed by ' + o.contributedBy);
      if (o.confidence) bits.push(o.confidence + ' confidence');
      return bits.join(', ');
    }
  };

  for (const [k, v] of Object.entries(api)) {
    Object.defineProperty(out, k, { value: v, enumerable: false, writable: false, configurable: true });
  }
  return out;
}
