// The connector registry.
//
// One entry per organisation this twin either reads from, writes to, or would like to and cannot.
// It is deliberately the same shape for all three, because the honest half of a connector layer is
// the half that names what it cannot know, and a stub that says who would have to agree to a feed
// is worth more than a fabricated one.
//
// Every entry answers six questions:
//
//   source          what real thing is read, and where that thing is
//   cadence         how often a person should run this, and why that interval and not another
//   freshness       how long a record from here can be believed before it needs saying so on screen
//   can_know        what this source is actually evidence of
//   cannot_know     what it is not evidence of, however tempting
//   asks/promises   what the organisation is being asked for, and what it is being promised back
//
// `asks` and `promises` are written as though the organisation will read them, because eventually
// one will. Nothing in this file is an agreement with anybody. QYAC has not seen this project, and
// neither has any other body named here.

export const CONNECTOR_VERSION = '1.0';

export const CONNECTORS = [
  // -------------------------------------------------------------------------------------------
  // Built and working
  // -------------------------------------------------------------------------------------------
  {
    id: 'wildlife-rescue',
    title: 'Wildlife rescue reports, contacts and lookouts',
    organisation: 'Wildlife Rescue Minjerribah',
    direction: 'both',
    built: true,
    module: 'tools/connectors/wildlife-rescue.mjs',
    source: {
      kind: 'repository',
      id: 'minjerribah-wildlife-rescue',
      files: ['assets/contacts.js', 'assets/db.js', 'lookouts.json'],
      also: 'an inbox folder of app exports (JSON or CSV) or pasted group-chat messages carrying sync codes',
      public: 'https://auraofintelligence.github.io/minjerribah-wildlife-rescue/'
    },
    cadence: {
      every: 'daily while a case is open, otherwise weekly',
      run_by: 'the rescue coordinator, or whoever holds the group chat',
      reason: 'A case moves in hours. A koala on the ground at breakfast is in care or dead by lunch, '
        + 'so a weekly sync would put a pin on the map that is wrong more often than right. The '
        + 'reference and contact half of this feed moves once a year and rides along.'
    },
    stale_after_days: 7,
    can_know: [
      'the numbers to ring, because the app publishes them for the public to ring',
      'the vocabulary the island already uses for animals, conditions and causes',
      'that a case was open at the moment the coordinator exported it',
      'roughly where and roughly when, once coarsened'
    ],
    cannot_know: [
      'whether an animal is still there now: a report is a moment, not a state',
      'who reported it. Reporter name and phone are dropped at intake and never enter this repository',
      'the exact spot. Coordinates are rounded before commit, so a nest, a den or a driveway cannot be read off the twin',
      'anything about an animal nobody reported. Absence in this feed is absence of a report, not absence of an animal',
      'clinical outcome, because the app records condition on arrival and not what happened at the carer'
    ],
    asks: [
      'permission to read the group export at all, which is the group\'s data and not this project\'s',
      'a coordinator willing to drop an export or a copied chat thread into a folder on a schedule',
      'a decision on whether the coarsening below is coarse enough, from people who know which species '
        + 'on this island are worth hiding a pin for'
    ],
    promises: [
      'reporter name and phone never enter this repository, in any file, at any confidence',
      'coordinates are rounded before they are written, not filtered when they are drawn',
      'nothing is ever sent back to the app or to anybody automatically: a draft is written to disk for a person to read and send',
      'the group can withdraw the feed and the records go, with a tombstone that keeps the id and nothing else'
    ]
  },
  {
    id: 'noticeboard',
    title: 'Island organisations, addresses, contacts and what each might publish',
    organisation: 'Straddie Noticeboard Network, and through it the organisations it names',
    direction: 'both',
    built: true,
    module: 'tools/connectors/noticeboard.mjs',
    source: {
      kind: 'repository',
      id: 'straddie-noticeboard-network',
      files: ['data.js'],
      public: 'https://auraofintelligence.github.io/straddie-noticeboard-network/'
    },
    cadence: {
      every: 'monthly',
      run_by: 'whoever is maintaining the noticeboard network',
      reason: 'Addresses and phone numbers move a few times a year. The reason to run it monthly is '
        + 'not that the data changes that fast, it is that the wanted list needs a person looking at it '
        + 'often enough to actually go and ask somebody.'
    },
    stale_after_days: 60,
    can_know: [
      'that an organisation exists, what it is, and which township it is in',
      'a researched address, phone and website where the noticeboard recorded one with its sources',
      'which organisations the noticeboard has and has not confirmed anything with'
    ],
    cannot_know: [
      'opening hours. Not one entity in that repository carries confirmed hours, and several say in '
        + 'so many words that hours need confirming before publishing. Hours therefore arrive as a '
        + 'gap with the source\'s own words beside it, never as a time',
      'whether an organisation wants to be in a digital twin. The noticeboard says its own entity list '
        + 'is a conversation map and not a claim that any group has agreed to take part, and that '
        + 'caveat travels with every record',
      'anything about a person. Individuals are excluded, see below',
      'whether a listing is current. The repository is a research pass, not a live directory'
    ],
    asks: [
      'each named organisation: are these details right, and do you want them in a public model of the island',
      'the eight organisations with a researched profile: confirm the address and phone, and tell us your hours if you want them shown',
      'the rest: nothing yet, because nobody has asked them anything'
    ],
    promises: [
      'no individual is a record here. The noticeboard\'s public-figures category and every entity that '
        + 'is a person rather than an organisation are excluded, whole',
      'a phone number appears only where the source recorded where it read it, and only for an organisation',
      'email addresses are not carried at all, because a public repository is a spam harvester and the twin has no use for one',
      'a correction from an organisation outranks anything in the source repository and is recorded as a correction, not an overwrite'
    ]
  },
  {
    id: 'events-engine',
    title: 'The public event atlas: what is on, where, and who listed it',
    organisation: 'Quandamooka Country Events Engine, and through it the listing sources it names',
    direction: 'both',
    built: true,
    module: 'tools/connectors/events-engine.mjs',
    source: {
      kind: 'repository',
      id: 'quandamooka-country-events-engine',
      files: ['assets/site-data.js'],
      public: 'https://auraofintelligence.github.io/quandamooka-country-events-engine/'
    },
    cadence: {
      every: 'weekly, and always before a wave that touches the calendar',
      run_by: 'a person, after pulling that repository',
      reason: 'The git history of that repository carries repeated public source refreshes, roughly '
        + 'weekly through June and July 2026. A local checkout lags the remote, so a sync that did not '
        + 'record which commit it read would claim a currency it does not have.'
    },
    stale_after_days: 21,
    can_know: [
      'that an event was publicly listed, on what date, at what place, by which listing source',
      'the source\'s own view of its own currency, because it publishes one',
      'which events are confirmed, which are dates to confirm, which are recurring and which are past'
    ],
    cannot_know: [
      'whether an event is going ahead. The source itself says to confirm dates, permissions and contacts '
        + 'with the responsible body before use, and that sentence travels with every record',
      'attendance, crowd, or load. Those are the twin\'s own estimates and are labelled as estimates in '
        + 'data/events.json, not read from here',
      'anything about the content of a cultural event. Publicly advertised dates and places pass; '
        + 'programme, protocol and meaning do not, and no connector will ever be the route for them',
      'whether an organiser wants their event modelled'
    ],
    asks: [
      'nothing of any organiser yet, because everything carried here was already published by a listing source',
      'the events engine maintainer: keep publishing lastPublicSearch and dataStatus, because they are what makes this honest'
    ],
    promises: [
      'the source\'s own draft flag is carried through verbatim and caps the confidence of every record from that sync',
      'the publication boundary in that repository\'s docs/PUBLIC_BOUNDARY.md is treated as blocking here, on the same footing as data/lore.json',
      'a cultural event appears as a date, a place and a civic load, exactly as advertised, and never as a description of what happens at it'
    ]
  },

  // -------------------------------------------------------------------------------------------
  // Built, and built to refuse
  // -------------------------------------------------------------------------------------------
  {
    id: 'straddie-news',
    title: 'Island news',
    organisation: 'Straddie News Initiative',
    direction: 'none',
    built: 'refused',
    module: 'tools/connectors/refusals.mjs',
    source: { kind: 'repository', id: 'straddie-news', files: ['index.html'] },
    cadence: { every: 'never', run_by: 'nobody', reason: 'There is nothing here this project may read.' },
    stale_after_days: null,
    can_know: [],
    cannot_know: ['everything in it, for the reason below'],
    reason: 'That repository is a strategy dashboard whose own footer calls it an internal research '
      + 'document. Its main table is a stakeholder map, and two of its stakeholders are QYAC and MMEIC, '
      + 'each with a characterisation of the relationship and a strategy for handling it. Carrying any of '
      + 'that would be this project representing a Traditional Owner organisation\'s position and its '
      + 'internal workings, which is the one thing this project may never do, and it would be doing it '
      + 'from a document that was not written for publication. The connector exists so that the next '
      + 'agent who notices the repository finds the refusal rather than the temptation.',
    asks: [
      'nothing. If an island news service ever publishes a public feed of stories, that is a different '
        + 'source with a different connector, and it would be welcome'
    ],
    promises: ['nothing from that repository enters this one, at any confidence, in any pack, ever']
  },
  {
    id: 'plfc',
    title: 'Point Lookout Fishing Club',
    organisation: 'Point Lookout Fishing Club Inc.',
    direction: 'none',
    built: 'refused',
    module: 'tools/connectors/refusals.mjs',
    source: { kind: 'repository', id: 'PLFC_2026_Data', files: ['index.html'], also: 'PLFC_Live' },
    cadence: { every: 'never yet', run_by: 'the club, if it ever wants this', reason: 'No public fixture or result feed exists.' },
    stale_after_days: null,
    can_know: ['that the club exists, is incorporated, formed in 2024, and runs fishing competitions. That much is already in data/businesses.json from public sources'],
    cannot_know: [
      'fixtures and results. Neither repository holds any. The brief that asked for this connector '
        + 'described PLFC as a football club with fixtures and results; it is a fishing club and there '
        + 'are no fixtures in either repository. Recording that plainly is the whole value of this entry',
      'anything in the AGM dashboard, which is club governance: capacity, shortcomings, remedies and '
        + 'grant readiness. It is a working document for a committee, not a public feed, and a member '
        + 'putting it on a website for a meeting is not a club resolution to publish it in a model of the island'
    ],
    reason: 'The data that exists is internal club material and the data that was asked for does not exist.',
    asks: [
      'the club: if you want competition dates and public results on the island calendar, a plain list of '
        + 'dates and a yes is all it takes, and it would make the twin\'s weekends real'
    ],
    promises: ['no committee material, no member records, no financial position, no capacity assessment']
  },

  // -------------------------------------------------------------------------------------------
  // Defined, not invented. No data is in hand and none is guessed.
  // -------------------------------------------------------------------------------------------
  {
    id: 'minjerribah-camping',
    title: 'Camping grounds: sites, closures and how full the island is',
    organisation: 'Minjerribah Camping, a QYAC enterprise',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'A public booking site exists. Nothing about it is in this repository and nothing has been read from it.' },
    cadence: { every: 'daily in the peak, weekly otherwise', run_by: 'nobody yet', reason: 'Occupancy is a daily number in December and a monthly one in June.' },
    stale_after_days: 3,
    can_know: [],
    cannot_know: [
      'anything, today. The twin currently estimates camping load from visitor archetypes in data/events.json and says so'
    ],
    reason: 'Minjerribah Camping is a QYAC enterprise. A connector that scraped its booking site would be '
      + 'this project taking data from a Traditional Owner organisation without asking, which is exactly '
      + 'the shape of thing docs/DIRECTION.md rules out under no surveillance-shaped anything. The route '
      + 'is a conversation, not a reader.',
    asks: [
      'QYAC and Minjerribah Camping, through the queue in docs/CULTURAL-REVIEW.md and only after item A1 '
        + 'there has an answer: would nightly site counts, closures and campground status be welcome in a '
        + 'model of the island, and in what form',
      'nothing before that. The first question on that queue is whether this project should exist at all'
    ],
    promises: [
      'no booking detail, no guest, no name, no plate, no arrival time. A count and a closure and nothing else',
      'no scraping, at any point, for any reason'
    ]
  },
  {
    id: 'surf-life-saving',
    title: 'Patrol hours, flags and beach closures',
    organisation: 'Point Lookout Surf Life Saving Club',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'Patrol rosters are published seasonally on club and Surf Life Saving Queensland channels. None is in this repository.' },
    cadence: { every: 'at the start of each patrol season, then weekly through it', run_by: 'nobody yet', reason: 'The roster is set for a season and amended weekly by weather.' },
    stale_after_days: 7,
    can_know: [],
    cannot_know: ['whether a beach is patrolled right now, which is the one thing a visitor most wants to know and the one thing an offline twin must never imply'],
    reason: 'This is the highest-value unbuilt connector in the list, because patrol status changes what '
      + 'the twin should say about every beach, and because a wrong answer here is a safety answer. '
      + 'A twin that showed flags up on a day the beach was closed would be worse than a twin that showed nothing.',
    asks: [
      'the club: a season roster as a plain list of dates and hours, and permission to show patrol hours as '
        + 'hours rather than as a live status',
      'agreement on the wording of the caveat, because it has to be the club\'s wording and not ours'
    ],
    promises: [
      'patrol times are shown as a roster with the date it was synced, never as a live flag state',
      'no member, no roster name, no callout, no incident',
      'the twin never tells anybody a beach is safe'
    ]
  },
  {
    id: 'mmeic',
    title: 'Publicly advertised events and public notices',
    organisation: 'Minjerribah Moorgumpin Elders-in-Council',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'MMEIC appears in the events engine as a listing source for a publicly advertised event. Nothing is read from MMEIC itself.' },
    cadence: { every: 'not set', run_by: 'nobody', reason: 'There is nothing to run.' },
    stale_after_days: null,
    can_know: [],
    cannot_know: [
      'anything beyond what MMEIC has itself publicly advertised, which reaches the twin through the '
        + 'events connector as a date and a place and nothing else'
    ],
    reason: 'MMEIC is a real organisation that employs people, holds responsibilities and advertises events. '
      + 'This project may list what it has publicly advertised, exactly as advertised. It may not represent '
      + 'its views, its decisions, its internal workings or anything a member would have had to tell us. '
      + 'A connector pointed at MMEIC would be a machine for crossing that line, so there is not one.',
    asks: ['nothing. Any approach is a human one, and it is not this repository\'s to make'],
    promises: ['no position, no view, no decision, no dialogue, no inference, from any source, in any pack']
  },
  {
    id: 'qyac-rangers',
    title: 'Land management activity: track closures, planned burns, park status',
    organisation: 'QYAC Land and Sea Rangers, and Queensland Parks joint management',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'Queensland Parks publishes park alerts. Nothing has been read and no reader has been written.' },
    cadence: { every: 'daily in fire season, weekly otherwise', run_by: 'nobody yet', reason: 'A track closure is a same-day fact.' },
    stale_after_days: 3,
    can_know: [],
    cannot_know: [
      'anything about fire practice. The twin models the ecological and civic effect of fire frequency, '
        + 'timing and extent, from published sources. The cultural knowledge behind fire practice on this '
        + 'Country is not this project\'s and does not enter through any route, including this one'
    ],
    reason: 'A ranger closing a track is a publicly reported land management activity and a legitimate '
      + 'connector. The care needed is at the boundary: the closure is the fact, and everything about why '
      + 'and how a burn is done sits on the other side of a line this project does not cross. '
      + 'docs/CULTURAL-REVIEW.md B12 holds the question.',
    asks: [
      'Queensland Parks: whether the published alert feed for Naree Budjong Djara may be read into a '
        + 'community model, and at what cadence',
      'QYAC, only through the review queue and only after A1: whether ranger activity should appear at all'
    ],
    promises: [
      'a closure is a closure and a date. No reason, no practice, no place beyond the track already named on a public alert'
    ]
  },
  {
    id: 'dunwich-state-school',
    title: 'Term dates, pupil-free days and the school run',
    organisation: 'Dunwich State School',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'Queensland term dates are published by the department. The school\'s own calendar is not in this repository.' },
    cadence: { every: 'each term', run_by: 'nobody yet', reason: 'A school calendar is set a term at a time and the twin only needs the shape of it.' },
    stale_after_days: 90,
    can_know: [],
    cannot_know: [
      'anything about a child, a class, a family or an enrolment. The twin already models 140 enrolments '
        + 'as a population figure from published census and departmental data, and that is the correct level'
    ],
    reason: 'The value is the daily rhythm: the bus, the ferry crossing for high school on the mainland, '
      + 'the pupil-free day that empties a township. All of that comes from a calendar of dates. None of it '
      + 'needs a single fact about a single child, and a connector that could carry one should not exist.',
    asks: ['the school: a term calendar, and whether it wants the twin to name the school at all'],
    promises: ['dates only. No child, no family, no staff member, no enrolment, no attendance']
  },
  {
    id: 'sandy-sports-club',
    title: 'Fixtures, working bees and what the club has on',
    organisation: 'Sandy Sports Club',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'A community-club builder site exists in the owner\'s repositories as a planning page. It is a proposal, not a club feed.' },
    cadence: { every: 'weekly in season', run_by: 'nobody yet', reason: 'A fixture list is a weekly rhythm.' },
    stale_after_days: 14,
    can_know: [],
    cannot_know: ['anything, because the club has published no feed and the planning site is a proposal about how a club might work'],
    reason: 'The nearest thing on disk is a proposal for how a community-run sand-sports club might work. '
      + 'Proposed stays proposed: a plan for a club is not a club\'s fixture list, and modelling one as the '
      + 'other is exactly how a plan becomes a fact by being modelled.',
    asks: ['the club, if and when it exists in the form the planning site describes: a fixture list and a yes'],
    promises: ['nothing from the planning site enters the twin as though the club had published it']
  },
  {
    id: 'little-ship-club',
    title: 'Club events, competitions and opening times',
    organisation: 'Little Ship Club, Dunwich',
    direction: 'in',
    built: false,
    source: { kind: 'none', note: 'Named in the events engine as one of the venue and club pages its public search covers. No feed of its own is in hand.' },
    cadence: { every: 'monthly', run_by: 'nobody yet', reason: 'Club calendars move monthly.' },
    stale_after_days: 45,
    can_know: [],
    cannot_know: ['its hours, its members, its competitions or its bookings. Anything the twin says about it today comes from public listings through data/businesses.json'],
    reason: 'A real club with a real venue and no feed in hand. It is listed here rather than left out so '
      + 'that the gap is a named gap with a person to ask, which is the difference between a backlog and a guess.',
    asks: ['the club: opening times and a public what-is-on list, if it wants them on a screen at the ferry'],
    promises: ['no member, no booking, no bar takings, no committee material']
  },

  // -------------------------------------------------------------------------------------------
  // Outward only
  // -------------------------------------------------------------------------------------------
  {
    id: 'screen-media',
    title: 'An events and conditions digest for public screens',
    organisation: 'Minjerribah Screen and Media Network',
    direction: 'out',
    built: true,
    module: 'tools/connectors/emit-noticeboard.mjs',
    source: {
      kind: 'repository',
      id: 'minjerribah-screen-media-network',
      files: ['data/site-content.ts'],
      note: 'Read only for where screens are proposed to go. Everything in that repository is a proposal '
        + 'and its own status labels say so, so nothing from it enters the twin as a fact.'
    },
    cadence: { every: 'whenever a person wants a notice', run_by: 'a person', reason: 'An emission is a draft somebody asked for.' },
    stale_after_days: 1,
    can_know: ['where screens are proposed: ferry kiosk, club wall, counter tablet, community screen'],
    cannot_know: ['whether any screen exists. None does. Every screen in both repositories is proposed'],
    asks: ['nothing yet. When a screen exists, the emission already fits the shape it reads'],
    promises: [
      'the twin never posts to a screen. It writes a markdown file with a draft flag on it and stops',
      'every figure on a notice names the pack record it came from, and carries the seed and the pack '
        + 'fingerprint so anybody can replay the run that produced it'
    ]
  }
];

export function connector(id) {
  return CONNECTORS.find((c) => c.id === id) || null;
}

export function builtConnectors() {
  return CONNECTORS.filter((c) => c.built === true && c.direction !== 'out');
}
