// The map lane. A KML or KMZ of the island becomes candidate records, screened, bounds-checked and
// reconciled against what the packs already hold.
//
//   node tools/ingest/lane-map.mjs --extract ingest-inbox/mymaps/north-stradbroke-island.kml \
//        --batch mymaps-nsi-2026-08 --contributor "Luke Hayes" \
//        --source "Google MyMaps mid=..." --fetched 2026-08-10
//
//   node tools/ingest/lane-map.mjs --extract <file> --dry     parse, screen and report, write nothing
//
// It writes to tools/ingest/candidates/ and never to data/. Promotion is tools/ingest/promote.mjs,
// which runs the whole gate and rolls back if anything blocks.
//
// WHY THIS LANE IS DIFFERENT FROM THE OTHERS
//
// A document lane reads a publisher's words. A map lane reads somebody's hand. The first map through
// here is the owner's own Google MyMaps of the island he lives on, and it is the highest-trust
// contribution this project has received, because he put every pin there himself. It also carries
// his own confidence statement, which is the pack's dataStatus and is not overridden anywhere in
// this file:
//
//   "UNDER CONSTRUCTION. I don't know what information on this map is up to date or accurate so just
//    use this as a starting point to do your own research."
//
// So the confidence is split rather than averaged. High on the fact that a thing exists and is
// roughly where the pin is, because he stood there. Lower on whether it still trades, under that
// name, with that operator, because he says so himself. Averaging those two into one number would
// throw away the most useful thing the source told us about itself, which is the same reading
// docs/SOURCES.md takes of the events engine's own dataStatus.
//
// FOUR THINGS THIS LANE WILL NOT DO
//
//   It does not overwrite a sourced record. Every pin lands in its own contribution pack carrying a
//   reconciliation verdict against what already exists. Applying a CORRECTS into data/places.json or
//   data/businesses.json is a person's decision and a separate commit, and the note on the corrected
//   record has to say whose pin it came from.
//
//   It does not swap coordinates. KML is lon,lat,alt. Everything that turns a KML triple into a lat
//   and a lon goes through toLatLon in tools/ingest/kml.mjs, and every point is checked against the
//   island's bounding box. A point outside it is reported, not dropped: a placemark in the wrong
//   ocean is a fact about the file that somebody needs to know.
//
//   It does not carry a contact detail. tools/ingest/checks-screens.mjs strips them here and fails
//   the gate if one ever reaches a contribution pack. Nothing in this tool ever prints the value.
//
//   It does not decide a cultural question. A placemark whose text touches ceremony, or names a
//   place as sacred or restricted, is held: no record, no coordinate, no name in the interface. So
//   is any other placemark drawn over the same ground, because the site is the thing that would be
//   published, not the wording. Held items go to docs/CULTURAL-REVIEW.md as questions for QYAC, and
//   this file names none of them in anything it writes.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, today, shortHash, readJSON, exists } from './lib.mjs';
import { readMapFile, placemarks, toLatLon } from './kml.mjs';
import { findContactDetails, stripContactDetails, tokenFamily } from './checks-screens.mjs';
import { coarsen } from './lane-contribution.mjs';

export const EXTRACTOR = { id: 'lane-map', version: '1.0' };

// ------------------------------------------------------------------------------------------------
// The island
// ------------------------------------------------------------------------------------------------

/**
 * Minjerribah's bounding box, generously drawn.
 *
 * A pin outside this is not necessarily wrong; it may be the mainland ferry terminal at Cleveland,
 * which is a real part of how this island works. It is reported either way, because the alternative
 * is a tool that quietly drops a placemark and a person who never finds out.
 */
export const ISLAND_BOUNDS = { minLat: -27.75, maxLat: -27.35, minLon: 153.35, maxLon: 153.55 };

const EARTH_R = 6371008.8;

/** Metres between two lat/lon pairs. Equirectangular, which is exact enough over 30 km. */
export function metresBetween(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * EARTH_R;
}

/** The representative point of a geometry: the point itself, or the mean of a ring's vertices. */
export function representativePoint(geometry) {
  if (!geometry || !geometry.outer || !geometry.outer.length) return null;
  if (geometry.type === 'Point') return toLatLon(geometry.outer[0]);
  // A closed ring repeats its first vertex last. Counting it twice pulls the mean toward it.
  const ring = geometry.outer.slice();
  if (ring.length > 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  let lat = 0;
  let lon = 0;
  for (const t of ring) { const p = toLatLon(t); lat += p.lat; lon += p.lon; }
  return { lat: lat / ring.length, lon: lon / ring.length, alt: 0 };
}

// ------------------------------------------------------------------------------------------------
// Names
// ------------------------------------------------------------------------------------------------

const NAME_NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'on', 'in', 'inc', 'pty', 'ltd', 'co', 'qld']);

/** Two spellings of the same word across the packs and the map. Declared, and deliberately short. */
const NAME_SYNONYMS = [
  [/\bcampgrounds?\b/g, 'camping ground'],
  [/\bcar ?parks?\b/g, 'car park'],
  [/\btoilets?\b/g, 'toilet'],
  [/\bfoodworks\b/g, 'foodworks']
];

/** A name reduced to comparable tokens. Deterministic, and it never drops a word that carries a place. */
export function nameTokens(name) {
  let s = String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [rx, to] of NAME_SYNONYMS) s = s.replace(rx, to);
  return s.split(' ').filter((t) => t && !NAME_NOISE.has(t));
}

/**
 * The part of a placemark name that says what the thing is.
 *
 * This author uses a semicolon the way a signpost does: the thing, then where it is. "Bus Stop;
 * Manta Lodge YHA" is a bus stop, not a lodge, and matching on the whole string paired it with
 * `businesses/manta-lodge-scuba-centre` at a containment score of 0.85 and then offered to move the
 * lodge to the bus stop. "Brown Lake; Picnic Area and Park" is Brown Lake. Taking the leading
 * segment is the author's own convention read back, and the full name is kept on the record.
 */
export function matchName(name) {
  const head = String(name).split(/\s*;\s*/)[0].trim();
  return head.length >= 3 ? head : String(name).trim();
}

/**
 * How alike two names are, from 0 to 1.
 *
 * Jaccard over the token sets, lifted when one name contains the other whole. The lift is the part
 * that needs guarding: a single shared token is contained in everything. "Dunwich" is inside
 * "Dunwich RSL", "Dunwich Post Office" and "Dunwich Police Station", and an unguarded containment
 * score of 0.85 had this lane offering to move the township of Dunwich to the post office. So the
 * lift only applies when the shorter name is at least two words long.
 */
export function nameScore(a, b) {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const jaccard = shared / (A.size + B.size - shared);
  const smaller = Math.min(A.size, B.size);
  const containment = smaller >= 2 ? (shared / smaller) * 0.85 : 0;
  return Math.max(jaccard, containment);
}

/**
 * Feature types whose recorded coordinate is a representative point rather than a doorway.
 *
 * A beach is 600 m long and a national park is 27 km. A pin 140 m along Main Beach does not correct
 * `places/main-beach`; it corroborates it. Getting this wrong turned twelve honest corroborations
 * into corrections, which is the sort of report that trains a reader to stop believing the column.
 */
const EXTENDED_TYPES = new Set([
  'township', 'beach', 'lake', 'national_park', 'conservation_park', 'headland', 'gorge', 'walk',
  'campground', 'beach_camping', 'spring', 'rock', 'park', 'hazard_zone', 'sports_field', 'cemetery',
  'historic_site', 'lighthouse', 'lookout', 'mine_rehabilitation_area', 'water_body'
]);

const STRONG_NAME = 0.55;
const WEAK_NAME = 0.30;
const SAME_SPOT_M = 75;
const SAME_EXTENDED_M = 600;
const NEAR_SPOT_M = 600;
const WEAK_CLOSE_M = 80;

function sameSpotTolerance(record) {
  return EXTENDED_TYPES.has(String(record.type || '').toLowerCase()) ? SAME_EXTENDED_M : SAME_SPOT_M;
}

// ------------------------------------------------------------------------------------------------
// The screens
// ------------------------------------------------------------------------------------------------

/**
 * Accommodation that is a commercial premises rather than somebody's house.
 *
 * The distinction decides whether a coordinate is published as pinned or coarsened before commit.
 * docs/PARTICIPATION.md is specific: precise locations of private homes never enter the repository,
 * and the fuzzing happens before commit rather than at display time, because a runtime filter is one
 * bug away from publishing the thing it was hiding. A resort with a reception desk is a business
 * with a street frontage. A three bedroom house let out by its owners is a house, and the fact that
 * it is advertised does not make its exact position this project's to publish at full precision.
 */
const COMMERCIAL_PREMISES = /\b(resort|lodge|hotel|motel|apartments?|units|camping|campground|caravan|cabins|hostel|camp|scuba|bed and breakfast|holiday park|marina|pavilion)\b/i;

const DWELLING_FOLDERS = /holiday (rental|accommodation)|holiday rentals/i;

/** Placemarks that propose renaming a real place. Held, and asked about, never applied. */
const RENAMING = /\bre-?nam(e|es|ed|ing)\b/i;

function culturalTokens() {
  const lore = readJSON('data/lore.json');
  const rules = ((lore.prohibitions && lore.prohibitions.rules) || [])
    .filter((r) => r.id === 'no-invented-ceremony' || r.id === 'no-sacred-or-restricted-sites');
  return [...new Set(rules.flatMap((r) => (r.check && r.check.tokens) || []))].sort();
}

function hitsCulturalToken(text, tokens) {
  for (const token of tokens) {
    const rx = new RegExp('(^|[^A-Za-z0-9_])(' + tokenFamily(token) + ')(?![A-Za-z0-9_])', 'i');
    if (rx.test(text)) return token;
  }
  return null;
}

/** Is a lat/lon inside a KML ring? Ray casting, in lon/lat space, which is fine at this scale. */
export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > point.lat) !== (yj > point.lat)
      && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** How close two placemarks have to be before they are drawings of the same thing. */
const SAME_GROUND_M = 25;

/**
 * What is held, and why.
 *
 * Two passes, because the second is the one that matters. The first finds the wording. The second
 * finds every other placemark drawn over the same ground and holds that too: the harm the
 * sacred-sites prohibition names is publishing a location, and a polygon outlining the clearing a
 * held pin sits in publishes exactly that location under a different label.
 *
 * "The same ground" is deliberately tight. Twenty five metres is about a hand's width on a web map
 * at the zoom people draw at, and a point falling inside a held polygon is the same thing said
 * geometrically. Anything looser starts holding the neighbours: an earlier draft used 150 m and held
 * the whole waste transfer station, four real public facilities, because a proposal pinned nearby
 * happened to contain a word. A screen that quietly swallows the street around it is not protecting
 * anybody; it is just refusing more.
 */
export function screenCulture(items, tokens) {
  const held = new Map(); // index -> { reason, token }
  for (const it of items) {
    const text = [it.name, it.description].filter(Boolean).join('\n');
    const token = hitsCulturalToken(text, tokens);
    if (token) {
      held.set(it.index, { reason: 'cultural-token', token, detail: `the placemark's own text uses "${token}"` });
      continue;
    }
    if (RENAMING.test(text)) {
      held.set(it.index, {
        reason: 'renaming-proposal',
        token: null,
        detail: 'the placemark proposes renaming a real place, and place naming on Minjerribah is an '
          + 'open question with QYAC in docs/CULTURAL-REVIEW.md A3'
      });
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of items) {
      if (held.has(it.index)) continue;
      const p = representativePoint(it.geometry);
      if (!p) continue;
      for (const other of items) {
        if (!held.has(other.index)) continue;
        const q = representativePoint(other.geometry);
        if (!q) continue;
        const close = metresBetween(p, q) <= SAME_GROUND_M;
        const inside = other.geometry && other.geometry.type === 'Polygon' && pointInRing(p, other.geometry.outer);
        if (close || inside) {
          held.set(it.index, {
            reason: 'same-ground',
            token: null,
            detail: inside
              ? 'its position falls inside a placemark held above, so publishing it would publish that '
                + 'location under a different label'
              : 'it marks the same ground as a placemark held above, within '
                + `${SAME_GROUND_M} m, so publishing it would publish that location under a different label`
          });
          grew = true;
          break;
        }
      }
    }
  }
  return held;
}

/** Strip contact details out of a placemark and say how many came out, never what they were. */
export function screenPersonalData(item) {
  const before = findContactDetails([item.name, item.description].join('\n'));
  const name = stripContactDetails(item.name);
  const description = stripContactDetails(item.description);
  return {
    name: name.text,
    description: description.text,
    removed: name.removed + description.removed,
    kinds: [...new Set(before.map((h) => h.label))].sort()
  };
}

// ------------------------------------------------------------------------------------------------
// What the packs already hold
// ------------------------------------------------------------------------------------------------

/**
 * Every record in the committed packs that a map pin could plausibly be about, flattened into one
 * comparable shape. Read straight off disk, so the reconciliation is against the packs as they are
 * rather than against anybody's memory of them.
 */
export function existingRecords() {
  const out = [];
  const push = (pack, collection, r, lat, lon, extra) => {
    out.push({
      pack,
      collection,
      id: r.id,
      name: r.name || r.label || r.id,
      aliases: []
        .concat((r.alt_names || []).map((a) => a.name))
        .concat(r.also_known_as || [])
        .concat(r.name_quandamooka ? [r.name_quandamooka] : [])
        .filter(Boolean),
      type: r.type || '',
      status: r.status || '',
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
      ...extra
    });
  };

  if (exists('data/places.json')) {
    for (const r of readJSON('data/places.json').places || []) push('places', 'places', r, r.lat, r.lon);
  }
  if (exists('data/businesses.json')) {
    for (const r of readJSON('data/businesses.json').businesses || []) push('businesses', 'businesses', r, r.lat, r.lon);
  }
  if (exists('data/transport.json')) {
    const t = readJSON('data/transport.json');
    for (const r of t.terminals || []) push('transport', 'terminals', r, r.lat, r.lon);
  }
  if (exists('data/geography.json')) {
    const g = readJSON('data/geography.json');
    // The geography pack states its own coordinate order and it is lon,lat. Reading a centroid the
    // other way round would put every mine on the wrong side of the island and the numbers would
    // still look plausible, which is the failure mode worth writing a line of code against.
    const lonFirst = !/lat/i.test(String(g.coordinate_order || '').split(',')[0] || 'lon');
    const centroid = (c) => (Array.isArray(c) && c.length >= 2
      ? (lonFirst ? { lat: c[1], lon: c[0] } : { lat: c[0], lon: c[1] })
      : { lat: null, lon: null });
    for (const r of g.rehabilitation_areas || []) {
      const c = centroid(r.centroid);
      push('geography', 'rehabilitation_areas', r, c.lat, c.lon, { area_ha: r.area_ha });
    }
    for (const r of g.water_bodies || []) {
      const c = centroid(r.centroid);
      push('geography', 'water_bodies', r, c.lat, c.lon, {});
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Reconciliation
// ------------------------------------------------------------------------------------------------

/** Statuses in the committed packs that mean the sourced record and a live pin do not agree. */
const DISPUTED_STATUS = new Set(['closed', 'closed-unconfirmed', 'trading-unconfirmed', 'proposed']);

/**
 * The four-way split, with the reason recorded on every one of them.
 *
 *   NEW       nothing in the packs looks like this
 *   CONFIRMS  an existing record, and his pin corroborates its position
 *   CORRECTS  an existing record has a different position, or none at all, and his is first hand
 *   CONFLICTS they disagree about something his own dataStatus says he is unsure of. The existing
 *             sourced record wins on status; his pin wins on position.
 *
 * The order matters. Position is decided first, because a pin is evidence about position and about
 * nothing else. Then status is checked, and a status disagreement promotes the verdict to CONFLICTS
 * whatever the position said, because that is the thing a reader most needs to see.
 */
/**
 * Is this placemark a proposal rather than an observation?
 *
 * The author marks his own proposals: every one of them is named "Dream Space" something, or is
 * written in the first person about what a place could become. A proposal is not evidence about
 * where anything is, so it never corrects and never conflicts with a sourced record. It names what
 * it is about and stays marked proposed, forever, wherever it is rendered.
 */
export function isProposal(pin) {
  return /^dream space/i.test(pin.name)
    || /\bwould you like to\b|\bI imagine\b|\bI envision\b|\bcharacter overlay\b|\bI dream\b/i.test(pin.description || '');
}

export function reconcileOne(pin, records) {
  const p = pin.point;
  const subject = matchName(pin.name);
  const scored = records.map((r) => {
    let score = nameScore(subject, r.name);
    for (const alias of r.aliases) score = Math.max(score, nameScore(subject, alias));
    // A township is the one type where a containing name means the opposite of a match: everything
    // in Dunwich has Dunwich in its name. Nothing pairs with a township unless the names are the
    // same words.
    if (String(r.type).toLowerCase() === 'township') {
      const A = nameTokens(subject).sort().join(' ');
      const B = nameTokens(r.name).sort().join(' ');
      score = A === B ? 1 : 0;
    }
    const dist = (p && r.lat !== null && r.lon !== null) ? metresBetween(p, { lat: r.lat, lon: r.lon }) : null;
    return { record: r, score, dist };
  });

  // Best by name, then by distance among equally good names.
  const byName = scored
    .filter((s) => s.score >= WEAK_NAME)
    .sort((a, b) => (b.score - a.score) || ((a.dist === null ? 1e9 : a.dist) - (b.dist === null ? 1e9 : b.dist)));
  const nearest = scored
    .filter((s) => s.dist !== null)
    .sort((a, b) => a.dist - b.dist)[0] || null;

  let verdict = 'NEW';
  let against = null;
  let reason = '';
  const winsOn = [];

  const best = byName[0] || null;
  // A weak name match standing on the same doorstep is the same thing under different wording.
  // "FoodWorks Dunwich" against "Stradbroke Island FoodWorks", 15 m apart, is one shop.
  const weakAndClose = byName
    .filter((s) => s.dist !== null && s.dist <= WEAK_CLOSE_M)
    .sort((a, b) => a.dist - b.dist)[0] || null;

  if (best && best.score >= STRONG_NAME) {
    const tolerance = sameSpotTolerance(best.record);
    against = best;
    if (best.dist === null) {
      verdict = 'CORRECTS';
      winsOn.push('position');
      reason = `The name matches ${best.record.pack}/${best.record.id}, which carries no coordinate at all. `
        + 'His pin supplies the position that record has been missing.';
    } else if (best.dist <= tolerance) {
      verdict = 'CONFIRMS';
      reason = `The name matches ${best.record.pack}/${best.record.id} and his pin is ${Math.round(best.dist)} m from it`
        + (tolerance > SAME_SPOT_M
          ? ', which is inside the extent of a feature whose recorded coordinate is one representative point.'
          : ', which is inside the precision either source claims.');
    } else if (best.dist <= NEAR_SPOT_M) {
      verdict = 'CORRECTS';
      winsOn.push('position');
      reason = `The name matches ${best.record.pack}/${best.record.id} and his pin is ${Math.round(best.dist)} m away. `
        + 'He put the pin there himself, so his position is the first-hand one.';
    } else {
      verdict = 'NEW';
      against = null;
      reason = `The nearest record sharing this name, ${best.record.pack}/${best.record.id}, is `
        + `${Math.round(best.dist)} m away, which is too far to be the same thing on an island where `
        + 'names repeat between townships. Treated as new and worth a person\'s eye.';
    }
  } else if (weakAndClose) {
    verdict = 'CONFIRMS';
    against = weakAndClose;
    reason = `A partial name match to ${weakAndClose.record.pack}/${weakAndClose.record.id} and `
      + `${Math.round(weakAndClose.dist)} m from it. Same spot, different wording for the same thing.`;
  } else {
    reason = nearest && nearest.dist !== null
      ? `Nothing in the packs matches this name. The nearest record of any kind is ${nearest.record.pack}/${nearest.record.id}, `
        + `${Math.round(nearest.dist)} m away, and it is a different thing.`
      : 'Nothing in the packs matches this name and nothing is near it.';
  }

  // A proposal is about a place; it is not evidence about where that place is. Whatever the names
  // and the distances said above, the verdict is NEW and the match is recorded as what it is about.
  if (isProposal(pin)) {
    const about = against || nearest;
    return {
      verdict: 'NEW',
      against: null,
      about: about
        ? { pack: about.record.pack, collection: about.record.collection, id: about.record.id, name: about.record.name }
        : null,
      distance_m: about && about.dist !== null && about.dist !== undefined ? Math.round(about.dist) : null,
      wins_on: [],
      reason: 'A proposal by the contributor, not an observation. It does not correct or contradict '
        + (about ? `${about.record.pack}/${about.record.id}, which it is about. ` : 'anything in the packs. ')
        + 'A plan never becomes a fact by being modelled, so it carries the Proposed marker wherever it '
        + 'is rendered and nothing is applied anywhere from it.'
    };
  }

  // The mine folder. His categories are evidence: a pin filed under "Private Mine Leases" asserts a
  // live private lease, and the geography pack holds five mined polygons it explicitly declines to
  // name because nobody had verified which mine is which. Proximity alone is enough to pair them,
  // and the pairing is worth more than the verdict, because it closes a gap the pack names itself.
  if (/mine lease/i.test(pin.folder) && (!against || against.record.pack !== 'geography')) {
    const rehab = scored
      .filter((s) => s.record.collection === 'rehabilitation_areas' && s.dist !== null && s.dist <= 2000)
      .sort((a, b) => a.dist - b.dist)[0];
    if (rehab) {
      against = rehab;
      verdict = 'CONFLICTS';
      winsOn.push('position', 'the name of the matched polygon');
      reason = `His pin sits ${Math.round(rehab.dist)} m from ${rehab.record.pack}/${rehab.record.id}, which `
        + `data/geography.json records as a sand mining rehabilitation area and deliberately leaves unnamed, `
        + 'because which of the three mine names belongs to which polygon had not been verified. His folder '
        + 'files it as a current private lease. The sourced record wins on status, mining having ended; his '
        + 'pin wins on position and, subject to a person checking it, supplies the name.';
    }
  }

  if (against && DISPUTED_STATUS.has(String(against.record.status).toLowerCase()) && verdict !== 'CONFLICTS') {
    verdict = 'CONFLICTS';
    if (!winsOn.includes('position')) winsOn.push('position');
    reason = `${reason} The existing record is marked "${against.record.status}", and his map lists it as a `
      + 'going concern. His own note says he does not know what is current, so the sourced record wins on '
      + 'status and his pin wins on position.';
  }

  return {
    verdict,
    against: against
      ? {
        pack: against.record.pack,
        collection: against.record.collection,
        id: against.record.id,
        name: against.record.name,
        status: against.record.status || null,
        name_score: Math.round(against.score * 100) / 100
      }
      : null,
    distance_m: against && against.dist !== null ? Math.round(against.dist) : null,
    wins_on: [...new Set(winsOn)],
    reason
  };
}

// ------------------------------------------------------------------------------------------------
// Records
// ------------------------------------------------------------------------------------------------

const EM_DASH = String.fromCharCode(0x2014);

/** The house rule is about this project's prose, not about what a contributor wrote. Declare it. */
function quoteText(parts) {
  const joined = parts.filter(Boolean).join('\n');
  const substituted = joined.includes(EM_DASH);
  return { text: joined.split(EM_DASH).join('-'), substituted };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unnamed';
}

/**
 * Status confidence by folder, which is the author's own categorisation and therefore the honest
 * place to take it from. A shopfront's status is exactly what his note says he is unsure about. A
 * beach's is not.
 */
function statusConfidenceFor(folder) {
  if (/business|rental|accommodation|mine lease/i.test(folder)) return 'low';
  return 'medium';
}

export function toRecord(pin, batch, reconciliation) {
  const commercial = COMMERCIAL_PREMISES.test(pin.name);
  const dwelling = DWELLING_FOLDERS.test(pin.folder) && !commercial;
  const published = dwelling
    ? coarsen({ lat: pin.point.lat, lon: pin.point.lon, precision_m: 250 })
    : { lat: pin.point.lat, lon: pin.point.lon, precision_m: 0, coarsened: false };

  const q = quoteText([pin.folder, pin.name, pin.description]);
  const proposal = isProposal(pin);

  const record = {
    id: `map-${slug(pin.folder)}-${slug(pin.name)}-${shortHash(`${pin.folder}|${pin.name}|${pin.index}`, 6)}`,
    name: pin.name,
    folder: pin.folder,
    geometry: pin.geometry ? pin.geometry.type.toLowerCase() : 'none',
    lat: Math.round(published.lat * 1e7) / 1e7,
    lon: Math.round(published.lon * 1e7) / 1e7,
    position_precision_m: published.coarsened ? published.precision_m : 0,
    position_basis: published.coarsened
      ? 'Coarsened to 250 m before commit because this is a dwelling let as a holiday rental, not a '
        + 'commercial premises. docs/PARTICIPATION.md: fuzzing happens before commit, never at display time.'
      : 'As pinned by the contributor.',
    source: `contribution:${batch.id}`,
    locator: `folder "${pin.folder}", placemark ${pin.index + 1} of ${batch.placemark_count}`,
    quote: q.text,
    quote_note: 'The verbatim text of the placemark: its folder name, its own name and its description as '
      + 'the KML nests them, joined with line breaks and otherwise unchanged.'
      + (q.substituted ? ' One em dash in the contributor\'s own wording is rendered as a hyphen, which is the '
        + 'only substitution made, on the same footing as the document lane.' : '')
      + (pin.contact_removed ? ` ${pin.contact_removed} contact detail(s) were removed at ingest and are not `
        + 'recorded anywhere in this repository.' : ''),
    asserts: 'real_world',
    claim: `The contributor's own map of the island places ${pin.name} here.`,
    status: proposal ? 'proposed' : 'contributed',
    confidence: 'high',
    existence_confidence: 'high',
    position_confidence: pin.geometry && pin.geometry.type === 'Polygon' ? 'low' : 'high',
    status_confidence: statusConfidenceFor(pin.folder),
    extracted_at: today(),
    extractor: `${EXTRACTOR.id}/${EXTRACTOR.version}`,
    contributed_by: batch.contributor,
    role: batch.role,
    method: 'map',
    visibility: 'public_twin',
    consent: batch.consent,
    player_facing: false,
    reconciliation,
    note: proposal
      ? 'A proposal by the contributor, not a description of anything that exists. It stays marked '
        + 'proposed wherever it is rendered, forever.'
      : 'Contributed and not verified by a second source. Nothing here has been applied to '
        + 'data/places.json or data/businesses.json; that is a person\'s decision and a separate commit.'
  };

  if (published.coarsened) {
    record.reconciliation = { ...reconciliation };
    if (record.reconciliation.distance_m !== null && record.reconciliation.distance_m !== undefined) {
      const d = record.reconciliation.distance_m;
      record.reconciliation.distance_m = null;
      record.reconciliation.distance_band = d < 100 ? 'under 100 m' : d <= 500 ? '100 to 500 m' : 'over 500 m';
      record.reconciliation.distance_note = 'The exact distance is withheld because this position is '
        + 'coarsened, and a distance to a known record would undo the coarsening.';
    }
  }

  if (pin.geometry && pin.geometry.type === 'Polygon') {
    record.outline = pin.geometry.outer.map((t) => {
      const ll = toLatLon(t);
      return [Math.round(ll.lat * 1e7) / 1e7, Math.round(ll.lon * 1e7) / 1e7];
    });
    record.outline_note = 'Drawn by hand by the contributor on a web map. Treat it as an indication of '
      + 'extent, never as a boundary.';
  }
  return record;
}

// ------------------------------------------------------------------------------------------------
// The run
// ------------------------------------------------------------------------------------------------

export function runLane(file, opts = {}) {
  const read = readMapFile(file);
  if (read.kind === 'network-link-stub') {
    return { stub: true, networkLink: read.networkLink, note: read.note };
  }

  const parsed = placemarks(read.text);
  const tokens = culturalTokens();
  const held = screenCulture(parsed.placemarks, tokens);
  const records = existingRecords();

  const batch = {
    id: opts.batch || `map-${slug(parsed.documentName)}-${today()}`,
    contributor: opts.contributor || 'unattributed',
    role: opts.role || 'player',
    source: opts.source || '',
    fetched: opts.fetched || today(),
    placemark_count: parsed.placemarks.length,
    consent: {
      given: true,
      wording: opts.consent || '',
      recorded_by: opts.contributor || 'unattributed'
    }
  };

  const out = {
    document: parsed.documentName,
    folders: parsed.folders,
    total: parsed.placemarks.length,
    candidates: [],
    heldItems: [],
    outOfBounds: [],
    noGeometry: [],
    stripped: [],
    mediaDropped: [],
    counts: { NEW: 0, CONFIRMS: 0, CORRECTS: 0, CONFLICTS: 0 }
  };

  // The document description is screened too. The owner's map carries a contact number in it, and a
  // tool that screened the pins and copied the header verbatim would have published the thing.
  const docScreen = stripContactDetails(parsed.documentDescription);
  out.documentDescription = docScreen.text;
  if (docScreen.removed) {
    out.stripped.push({ where: 'the map description', kinds: ['a contact detail'], count: docScreen.removed });
  }

  for (const item of parsed.placemarks) {
    if (held.has(item.index)) {
      const h = held.get(item.index);
      const carried = findContactDetails([item.name, item.description].join('\n'));
      const heldId = `held-${shortHash(`${item.folder}|${item.name}|${item.index}`, 8)}`;
      if (carried.length) {
        out.stripped.push({
          where: `held placemark ${heldId}`,
          kinds: [...new Set(carried.map((x) => x.label))].sort(),
          count: carried.length
        });
      }
      out.heldItems.push({
        // No name and no coordinate. A held item is held; a file that recorded what it was called and
        // where it was would be publishing the thing the hold exists to prevent.
        id: heldId,
        folder: item.folder,
        geometry: item.geometry ? item.geometry.type : 'none',
        reason: h.reason,
        detail: h.detail
      });
      continue;
    }

    const screened = screenPersonalData(item);
    if (screened.removed) {
      out.stripped.push({
        where: `folder "${item.folder}", placemark ${item.index + 1}`,
        kinds: screened.kinds,
        count: screened.removed
      });
    }
    if (item.media && item.media.length) {
      out.mediaDropped.push({ where: `folder "${item.folder}", placemark ${item.index + 1}`, count: item.media.length });
    }

    const point = representativePoint(item.geometry);
    if (!point) {
      out.noGeometry.push({ folder: item.folder, name: screened.name });
      continue;
    }
    const inBounds = point.lat >= ISLAND_BOUNDS.minLat && point.lat <= ISLAND_BOUNDS.maxLat
      && point.lon >= ISLAND_BOUNDS.minLon && point.lon <= ISLAND_BOUNDS.maxLon;
    if (!inBounds) {
      out.outOfBounds.push({
        folder: item.folder,
        name: screened.name,
        lat: point.lat,
        lon: point.lon,
        note: 'Outside the island bounding box. Reported, not dropped: it may be the mainland terminal, '
          + 'or it may be a pin somebody moved by accident, and only a person can tell.'
      });
      continue;
    }

    const pin = {
      index: item.index,
      folder: item.folder,
      name: screened.name,
      description: screened.description,
      contact_removed: screened.removed,
      geometry: item.geometry,
      point
    };
    const reconciliation = reconcileOne(pin, records);
    out.counts[reconciliation.verdict]++;
    out.candidates.push(toRecord(pin, batch, reconciliation));
  }

  out.batch = batch;
  return out;
}

// ------------------------------------------------------------------------------------------------
// The report
// ------------------------------------------------------------------------------------------------

export function reportMarkdown(result) {
  const L = [];
  const w = (s = '') => L.push(s);
  const c = result.counts;

  w(`# Map reconciliation: ${result.document}`);
  w('');
  w(`Run on ${today()} by ${EXTRACTOR.id}/${EXTRACTOR.version}. Nothing in data/ was written by this run.`);
  w('');
  w(`**${result.total} placemarks** in ${result.folders.length} folders. `
    + `${result.candidates.length} became candidates, ${result.heldItems.length} were held, `
    + `${result.outOfBounds.length} fell outside the island, ${result.noGeometry.length} had no geometry.`);
  w('');
  w('## The four-way split');
  w('');
  w('| Verdict | Count | What it means |');
  w('| --- | --- | --- |');
  w(`| NEW | ${c.NEW} | Nothing in the packs looks like this. |`);
  w(`| CONFIRMS | ${c.CONFIRMS} | An existing record, and his pin corroborates its position. |`);
  w(`| CORRECTS | ${c.CORRECTS} | The existing record has a different position, or none. His is first hand. |`);
  w(`| CONFLICTS | ${c.CONFLICTS} | They disagree on status. The sourced record wins on status, his pin on position. |`);
  w('');

  for (const verdict of ['CORRECTS', 'CONFLICTS']) {
    const rows = result.candidates.filter((r) => r.reconciliation.verdict === verdict);
    w(`## Every ${verdict} (${rows.length})`);
    w('');
    w('These are the ones to look at. Nothing has been applied.');
    w('');
    for (const r of rows) {
      const a = r.reconciliation.against;
      const d = r.reconciliation.distance_m !== null && r.reconciliation.distance_m !== undefined
        ? `${r.reconciliation.distance_m} m`
        : (r.reconciliation.distance_band || 'no position on the existing record');
      w(`- **${r.name}** (${r.folder}) against \`${a ? a.pack + '/' + a.id : 'nothing'}\`, ${d}.`);
      w(`  ${r.reconciliation.reason}`);
    }
    w('');
  }

  w('## Held');
  w('');
  w('Held items are not named here, do not carry a coordinate here, and are not in the pack. They are '
    + 'described in docs/CULTURAL-REVIEW.md, which is the queue, and the decision is not this project\'s '
    + 'to make.');
  w('');
  for (const h of result.heldItems) {
    w(`- \`${h.id}\`, a ${h.geometry.toLowerCase()} in "${h.folder}": ${h.detail}.`);
  }
  w('');

  w('## Screened out');
  w('');
  if (!result.stripped.length) w('Nothing was stripped.');
  for (const s of result.stripped) {
    w(`- ${s.where}: ${s.count} contact detail(s) removed (${s.kinds.join(', ')}). The value is not recorded anywhere.`);
  }
  for (const m of result.mediaDropped) {
    w(`- ${m.where}: ${m.count} external image link(s) dropped. The twin makes no network request and carries no external image.`);
  }
  w('');

  if (result.outOfBounds.length) {
    w('## Outside the island bounding box');
    w('');
    for (const o of result.outOfBounds) w(`- ${o.name} (${o.folder}) at ${o.lat}, ${o.lon}. ${o.note}`);
    w('');
  }
  if (result.noGeometry.length) {
    w('## No geometry');
    w('');
    for (const o of result.noGeometry) w(`- ${o.name} (${o.folder})`);
    w('');
  }

  w('## Every verdict, by folder');
  w('');
  for (const f of result.folders) {
    const rows = result.candidates.filter((r) => r.folder === f.name);
    if (!rows.length) { w(`### ${f.name} (${f.placemarks} placemarks, none carried)`); w(''); continue; }
    w(`### ${f.name} (${rows.length} of ${f.placemarks})`);
    w('');
    w('| Placemark | Verdict | Against | Distance |');
    w('| --- | --- | --- | --- |');
    for (const r of rows) {
      const a = r.reconciliation.against;
      const d = r.reconciliation.distance_m !== null && r.reconciliation.distance_m !== undefined
        ? `${r.reconciliation.distance_m} m`
        : (r.reconciliation.distance_band || '');
      w(`| ${r.name} | ${r.reconciliation.verdict} | ${a ? a.pack + '/' + a.id : ''} | ${d} |`);
    }
    w('');
  }
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-map.mjs');
if (RAN_DIRECTLY) {
  const args = process.argv.slice(2);
  const val = (f, d = null) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
  const file = val('--extract');
  if (!file) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 20).join('\n'));
    process.exit(1);
  }
  const result = runLane(file, {
    batch: val('--batch'),
    contributor: val('--contributor'),
    role: val('--role', 'player'),
    source: val('--source'),
    fetched: val('--fetched'),
    consent: val('--consent')
  });

  if (result.stub) {
    console.error('\nREFUSED: this file carries no map data.\n');
    console.error(result.note);
    if (result.networkLink) console.error(`\nThe NetworkLink in it points at: ${result.networkLink}`);
    process.exit(1);
  }

  const dir = path.join(ROOT, 'tools/ingest/candidates');
  fs.mkdirSync(dir, { recursive: true });
  const stem = `map-${result.batch.id}`;
  const candidatesFile = path.join(dir, `${stem}.json`);
  const reportFile = path.join(dir, `${stem}-reconciliation.md`);

  if (!args.includes('--dry')) {
    fs.writeFileSync(candidatesFile, JSON.stringify({
      kind: 'ingest-candidates',
      lane: 'map',
      schema: 'minjerribah-candidates/1',
      batch: result.batch.id,
      contributed_by: result.batch.contributor,
      extractor: EXTRACTOR,
      document: { id: result.batch.id, title: result.document, source: result.batch.source, fetched: result.batch.fetched },
      note: 'Screened, bounds-checked and reconciled. Not promoted. A person reads the reconciliation '
        + 'report beside this file, and tools/ingest/promote.mjs runs the whole gate before anything '
        + 'reaches data/.',
      candidates: result.candidates
    }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(reportFile, reportMarkdown(result), 'utf8');
  }

  const c = result.counts;
  console.log(`${result.document}: ${result.total} placemarks in ${result.folders.length} folders.`);
  console.log(`  NEW ${c.NEW}   CONFIRMS ${c.CONFIRMS}   CORRECTS ${c.CORRECTS}   CONFLICTS ${c.CONFLICTS}`);
  console.log(`  held ${result.heldItems.length}, outside the island ${result.outOfBounds.length}, no geometry ${result.noGeometry.length}`);
  console.log(`  ${result.stripped.reduce((n, s) => n + s.count, 0)} contact detail(s) stripped, `
    + `${result.mediaDropped.reduce((n, m) => n + m.count, 0)} external image link(s) dropped`);
  if (!args.includes('--dry')) {
    console.log(`\nWrote ${path.relative(ROOT, candidatesFile).split(path.sep).join('/')}`);
    console.log(`Wrote ${path.relative(ROOT, reportFile).split(path.sep).join('/')}`);
  }
  console.log('\nNothing has been added to data/.');
}
