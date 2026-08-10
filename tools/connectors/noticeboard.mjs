// Connector: the Straddie Noticeboard Network.
//
//   node tools/connectors/sync.mjs --id noticeboard
//
// The noticeboard network is a research pass over 164 island organisations, and it is unusually
// honest about being one. Its own project block says the entity data is explicitly guessed from a
// research directory, that it is a conversation map rather than a claim that any group has agreed
// to take part, and that every feed idea needs direct approval before public use. That sentence is
// the most important thing in the file and it travels with every record this connector writes.
//
// So the connector splits the source in two, and the split is the whole design:
//
//   NINE entities carry a researched `profile` block: a public name, an address, sometimes a phone
//   and an ABN, a public status, source notes and source URLs. Those become records, at medium
//   confidence, each quoting the source note it rests on.
//
//   ONE HUNDRED AND FIFTY FIVE do not. Those become the wanted list. They are real organisations
//   and naming them is fine; turning a guess about what they might publish into a record in a model
//   of the island is not. The wanted list is what the twin emits back and asks about, and it is the
//   participation loop's actual content: a visible list of what the commons needs next, where the
//   reward for filling a gap is that the gap is filled.
//
// TWO EXCLUSIONS, applied before anything else:
//
//   Individuals. The source has a public-figures-and-legacies category of 22 people, and its own
//   note calls them references rather than assumed participants. Individual artists appear in other
//   categories too. A person is not a feed. Every entity that reads as a person is excluded whole,
//   and among them are Quandamooka artists, where the line this project holds is not a preference.
//
//   Email addresses. The source records some. A public git history is a spam harvester and the twin
//   has no use for an email address, so none is carried, even where the organisation published it.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, nowIso, readCheckout, sourceFile, readWindowData, envelope, screenRecord, screenWanted, quoted
} from './lib.mjs';
import { connector as declared, CONNECTOR_VERSION } from './registry.mjs';

export const ID = 'noticeboard';
const PUBLIC_URL = 'https://auraofintelligence.github.io/straddie-noticeboard-network/';

/** Categories that are people rather than organisations. Excluded whole, before any other rule. */
const PEOPLE_CATEGORIES = new Set(['public-figures-and-legacies']);

/**
 * Does this entity read as a person rather than an organisation?
 *
 * Four signals, in order, and the order matters:
 *
 *   an organisational word in the name          Point Lookout Surf Life Saving Club
 *   an island place word in the name            Stradbroke Island Butchery
 *   a word shared with its own type or share    Bo Beans Coffee, type "Coffee and cafe"
 *   otherwise, two to four capitalised words    Tamara Armstrong, Craig Henderson
 *
 * It errs toward calling something a person, and the residue is reported on the feed rather than
 * hidden: four trading names in the source read as people to this test and are left out of the
 * wanted list because of it. That is the right side to be wrong on. A false positive costs one
 * business a line on a list of organisations to go and ask. A false negative puts a named
 * individual into a public model of an island of about two thousand people, and several of the
 * individuals in this source are Quandamooka artists, where the line this project holds is not a
 * preference.
 *
 * No record is ever built from this test alone: records come only from entities carrying a
 * researched business profile, and every one of those is an organisation.
 */
const ORGANISATION_WORDS = /\b(club|inc\.?|incorporated|association|society|group|network|company|co\.|studios?|gallery|store|shop|cafe|coffee|hotel|brewing|services?|centre|school|council|corporation|rescue|brigade|bushcare|post|lpo|organisation|trust|foundation|committee|team|pty|ltd|marine|surf|surfboards?|pavilion|bar|bistro|bakery|butcher|butchery|pharmacy|seafoods?|holiday|realty|real estate|property|tours?|charters?|museum|library|church|hall|markets?|festival|theatre|band|collective|works|foodworks|supplies|hire|transport|ferry|taxi|garage|motors?|sports?|events?|music|workshop|singers|show|carnival|trail|van|agent|express|construction|carpentry|welding|signs|marketing|renovations|boardriders|salute|invitational)\b/i;

const ISLAND_PLACE_WORDS = /\b(stradbroke|straddie|minjerribah|point|lookout|dunwich|amity|island|goompi|mulumba|mooloomba|moreton|redland)\b/i;

function looksLikeAPerson(entity) {
  const name = String(entity.name || '');
  if (ORGANISATION_WORDS.test(name) || ISLAND_PLACE_WORDS.test(name)) return false;
  if (/\b(dr|mr|mrs|ms|prof)\b\.?/i.test(name)) return true;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (!words.every((w) => /^[A-Z][a-z'-]+$/.test(w)) || name.includes('&')) return false;
  // A trading name usually describes what it does, and the source's own type and share fields say
  // what that is. An overlap between the name and the description is a trading name, not a person.
  const describes = `${entity.type || ''} ${entity.share || ''}`.toLowerCase();
  if (words.some((w) => w.length >= 5 && describes.includes(w.toLowerCase().slice(0, 5)))) return false;
  return true;
}

/**
 * Confidence for a profiled entity.
 *
 * Nothing here reaches high, and the reason is worth stating plainly: this connector read the
 * owner's research repository, not the operator's own website. The repository cites the website;
 * the record cites the repository and carries the website as the upstream source. Two hops, both
 * recorded. A record that claimed to have read the operator's own page would be claiming a check
 * nobody performed.
 */
function confidenceFor(profile) {
  const statusText = String(profile.public_status || '').toLowerCase();
  const sources = (profile.sources || []).filter(Boolean);
  if (!sources.length) return 'low';
  if (statusText.includes('closed')) return 'medium';
  if (statusText.includes('needs confirmation') || statusText.includes('check needed')) return 'medium';
  return 'medium';
}

/** The status word the twin's own classifier understands, from the source's own public status. */
function statusFor(profile) {
  const text = String(profile.public_status || '').toLowerCase();
  if (text.includes('closed')) return 'committed';
  return 'committed';
}

function twinBusinessIndex() {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const idx = new Map();
  for (const b of doc.businesses || []) {
    idx.set(norm(b.name), b);
    for (const alt of b.also_known_as || []) idx.set(norm(alt), b);
  }
  // The pack's own vocabulary for where a set of opening hours came from. Reading it rather than
  // restating it means the feed and the pack cannot drift into two different words for the same
  // idea, and it is read defensively because it arrived in a wave running beside this one and
  // changed shape once from an array of records to a plain map while this was being written.
  const vocab = doc.hours_basis_vocabulary;
  const hoursBasis = Array.isArray(vocab)
    ? vocab.map((v) => v.id).filter(Boolean)
    : (vocab && typeof vocab === 'object' ? Object.keys(vocab) : []);
  return { idx, norm, hoursBasis, packVersion: doc.version };
}

/**
 * How many of the businesses this feed can match already have hours somebody published, and how
 * many are still running on an estimate. The number is the whole argument for the wanted list.
 */
function hoursPosition(business) {
  const h = business && business.typical_hours;
  if (!h) return 'none';
  return h.basis || 'none';
}

export function sync() {
  const spec = declared(ID);
  const syncId = nowIso();
  const checkout = readCheckout(spec.source.id);
  if (!checkout.present) {
    throw new Error(`no checkout of ${spec.source.id} at ${checkout.path}. `
      + 'This connector reads a local checkout and never the network.');
  }
  const data = readWindowData(sourceFile(checkout, 'data.js'), 'NOTICEBOARD_DATA');
  const { idx, norm, hoursBasis, packVersion } = twinBusinessIndex();
  const hoursTally = { published: 0, listed: 0, estimate: 0, none: 0 };

  const records = [];
  const held = [];
  const wanted = [];
  const excluded = { people: 0, people_categories: 0 };
  const freshness = { synced_at: syncId, stale_after_days: spec.stale_after_days, source_commit: checkout.commit };
  const shortCommit = checkout.commit ? checkout.commit.slice(0, 9) : 'unknown';

  const add = (rec) => {
    const screen = screenRecord(rec);
    if (screen.ok) { records.push(rec); return true; }
    held.push({ id: rec.id, kind: rec.kind, reasons: screen.reasons });
    return false;
  };

  // Everything written into a committed feed passes the screen, and a wanted entry is written into
  // a committed feed. It goes through the same door as a record, and the flags it raises go on the
  // feed where the gate and a person can both see them.
  const flagged = [];
  const addWanted = (entry) => {
    const screen = screenWanted(entry);
    if (!screen.ok) {
      held.push({ id: entry.id, kind: 'wanted-list-entry', reasons: screen.reasons });
      return false;
    }
    wanted.push(screen.entry);
    if (screen.culturalFlag) flagged.push(screen.culturalFlag);
    return true;
  };

  let matched = 0;
  let unmatched = 0;

  for (let gi = 0; gi < (data.entityGroups || []).length; gi++) {
    const group = data.entityGroups[gi];
    if (PEOPLE_CATEGORIES.has(group.slug)) {
      excluded.people_categories += group.entities.length;
      continue;
    }
    for (let ei = 0; ei < group.entities.length; ei++) {
      const entity = group.entities[ei];
      if (looksLikeAPerson(entity)) { excluded.people++; continue; }

      const twin = idx.get(norm(entity.name));
      if (twin) {
        matched++;
        const where = hoursPosition(twin);
        hoursTally[where] = (hoursTally[where] || 0) + 1;
      } else unmatched++;
      const profile = entity.profile;

      if (!profile) {
        // No researched profile. Not a record. A named organisation to go and ask.
        addWanted({
          id: `nb-want-${(entity.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          organisation: entity.name,
          category: group.label,
          township: entity.place || null,
          twin_business_id: twin ? twin.id : null,
          what: twin
            ? 'This organisation is already in data/businesses.json and the noticeboard has confirmed nothing about it.'
            : 'This organisation is named in the noticeboard and is in no pack in this twin.',
          what_the_source_thinks_it_might_share: entity.share || null,
          who_would_have_to_agree: entity.name
        });
        continue;
      }

      const note = (profile.source_notes || [])[0] || '';
      const rec = envelope({
        id: `nb-${profile.business_profile_id || (entity.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        connector: ID,
        connectorVersion: CONNECTOR_VERSION,
        syncId,
        locator: `straddie-noticeboard-network/data.js entityGroups[${gi}].entities[${ei}].profile, commit ${shortCommit}`,
        quote: note,
        confidence: confidenceFor(profile),
        status: statusFor(profile),
        asserts: note ? 'real_world' : null,
        freshness,
        extra: {
          kind: 'organisation-profile',
          name: profile.public_name || entity.name,
          organisation_type: entity.type || null,
          category: group.label,
          township: entity.place || null,
          twin_business_id: twin ? twin.id : null,
          address: profile.address || null,
          phone: profile.phone || null,
          website: profile.website && !/^TODO/i.test(profile.website) ? profile.website : null,
          abn: profile.abn || null,
          public_status: quoted(profile.public_status || 'not stated'),
          // Hours arrive as a gap, in the shape data/businesses.json uses for hours, so the two
          // reconcile without a translation step. `basis` is null on purpose: that pack's own
          // vocabulary offers published, listed and estimate, and this source reaches none of them.
          // Several of its entries say in their own words that hours need confirming before
          // publishing, and a connector that turned that sentence into a time would be inventing.
          typical_hours: null,
          hours_basis: null,
          hours_basis_vocabulary: hoursBasis,
          hours_gap: profile.hours_public_note
            ? quoted(profile.hours_public_note)
            : { quote: 'The source records no hours for this organisation.' },
          also_read: (profile.source_notes || []).slice(1).map((n) => quoted(n)),
          upstream_sources: (profile.sources || []).filter(Boolean),
          source_boundary: quoted(data.project.boundary || ''),
          handling: 'The source repository calls its own entity list a conversation map rather than a claim '
            + 'that any group has agreed to take part. Nothing here may be shown as participation, endorsement '
            + 'or consent. Hours are a gap, not a time.'
        }
      });
      add(rec);
    }
  }

  // Screens the emissions would go to, if any existed. All proposed, and labelled so.
  for (const loc of data.deviceLocations || []) {
    add(envelope({
      id: `nb-screen-${loc.id}`,
      connector: ID,
      connectorVersion: CONNECTOR_VERSION,
      syncId,
      locator: `straddie-noticeboard-network/data.js deviceLocations, commit ${shortCommit}`,
      confidence: 'medium',
      status: 'proposed',
      freshness,
      extra: {
        kind: 'proposed-screen',
        label: loc.label,
        township: loc.place,
        shape: loc.shape,
        role: loc.role,
        note: 'Proposed. No screen described here exists on the island today, and nothing in this twin '
          + 'may render one as though it did.'
      }
    }));
  }

  const stillGuessing = (hoursTally.estimate || 0) + (hoursTally.none || 0);
  addWanted({
    id: 'nb-want-hours',
    what: 'Opening hours, from the operators. Not one organisation in the source repository carries '
      + 'confirmed hours, and several say in their own words that hours need confirming before publishing.',
    why_it_matters: `Of the ${matched} organisations this feed can match to data/businesses.json, `
      + `${hoursTally.published || 0} have hours the business published itself, ${hoursTally.listed || 0} `
      + `have hours a directory published, and ${stillGuessing} are still opening and closing on an `
      + 'estimate. An estimate is a modelling pattern and it is never shown to a player as a fact, which '
      + 'means the twin cannot currently tell anybody whether the bakery is open on a Tuesday in June.',
    who_would_have_to_agree: 'Each operator, one at a time.',
    how_small_it_could_start: 'One line per business: the days it opens, the hours, and the date it was '
      + 'said. The twin shows the date beside the hours, always, and says which of the three bases it rests '
      + 'on.'
  });

  return {
    feed: ID,
    schema: 'minjerribah-connector-feed/1',
    version: '1.0.0',
    title: spec.title,
    organisation: spec.organisation,
    about: 'Island organisations as the noticeboard network researched them. Only the entities carrying a '
      + 'researched profile with sources become records. Individuals are excluded whole. The rest are the '
      + 'wanted list: real organisations nobody has asked yet.',
    sync: {
      synced_at: syncId,
      connector: { id: ID, version: CONNECTOR_VERSION },
      source: checkout,
      source_statement: quoted(data.project.boundary || '', 'straddie-noticeboard-network/data.js project.boundary'),
      source_status: data.project.status || null,
      cadence: spec.cadence,
      stale_after_days: spec.stale_after_days,
      counts: {
        entities_read: (data.entityGroups || []).reduce((n, g) => n + g.entities.length, 0),
        excluded_people_category: excluded.people_categories,
        excluded_individuals: excluded.people,
        excluded_individuals_note: 'The test that decides this errs toward leaving an entity out. Four '
          + 'trading names in the source read as personal names to it and are not on the wanted list '
          + 'because of that. No record is built from this test: records come only from entities carrying '
          + 'a researched business profile.',
        profiled: records.filter((r) => r.kind === 'organisation-profile').length,
        proposed_screens: records.filter((r) => r.kind === 'proposed-screen').length,
        kept: records.length,
        held: held.length,
        wanted: wanted.length,
        wanted_flagged_cultural: flagged.length,
        already_in_twin_by_name: matched,
        not_in_twin_by_name: unmatched,
        matched_hours_basis: hoursTally
      },
      reconciled_against: `data/businesses.json version ${packVersion}`
    },
    confidence_scale: {
      high: 'Not used by this connector. This is a research repository citing operator websites, so nothing '
        + 'here has been read at first hand and nothing here is high.',
      medium: 'The source recorded where it read this and quoted what it read. Good enough to act on, and '
        + 'always shown with the date it was synced.',
      low: 'The source recorded no URL at all. Held rather than carried.'
    },
    freshness_rule: 'An address moves rarely and a phone number moves sometimes, so ' + spec.stale_after_days
      + ' days is generous. Hours are not carried at all, at any age, because the source does not have them.',
    cultural_flags: flagged,
    records,
    held,
    wanted
  };
}
