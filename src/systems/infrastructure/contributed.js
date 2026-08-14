// The contributed map: 42 public features an islander pinned himself, put where he put them.
//
// WHY THIS SYSTEM EXISTS
//   data/contributions/map-contributions.json is the owner's own Google MyMaps of Minjerribah,
//   screened, bounds-checked and reconciled against every pack that already existed. For one round
//   it sat on disk doing nothing: 325 kB fetched on every boot, 133 records, none of them drawn,
//   none of them clickable, not one of them named anywhere in the interface. A critic drove the
//   build and said so, and was right. The reconciliation, the cultural holds and the personal-data
//   screen are all things a player never sees; a marker at a boat ramp is a thing they do.
//
//   So this reads the pack, takes the records the pack itself marks player-facing, and publishes
//   them as world positions with everything a panel needs to say where each one came from. The
//   render layer draws them and the inspector reads them. Neither decides what may be shown: the
//   pack decided that at ingest, tools/ingest/lane-map.mjs wrote the clause it decided it on into
//   every record's own `player_facing_basis`, and src/world/data.js mayShow() is the one gate this
//   file asks.
//
// WHAT IT WILL NOT SAY
//   That anything is open, running, staffed, serviced or safe. Every one of these records carries
//   `status_confidence: medium`, which is the contributor saying in his own words that current state
//   is exactly what he has not checked. A marker says the thing is there. Nothing in this file, and
//   nothing in the layer or the panel that read it, says anything about its condition today.
//
// THE BUS STOPS, WHICH ARE THE POINT
//   data/transport.json models Route 880 and Route 881 in full, down to every published departure,
//   and its eleven waypoints between them carry not one coordinate. Nothing in the twin could put a
//   bus stop on the ground. This map supplies twenty, and the lane joined five of them to a
//   published timing point on stated evidence at ingest. This system does the other half: it reads
//   the timetable those five stand on and works out, at the island's own clock, what the next
//   departures from that stop actually are. That is docs/DIRECTION.md's standing interaction rule,
//   world-as-UI, at its smallest: the timetable lives at the bus stop.
//
//   The other fifteen are stops between timing points. They show no time, and they say why, because
//   a Translink timetable prints times at a handful of points and the bus stops at every stop in
//   between. Inventing a time for those fifteen would be the easiest lie in this repository.
//
//   What those fifteen get instead is the run. `runsAt()` returns the published runs that have not
//   finished yet, each one carrying every time the timetable prints for it, first to last. The bus
//   calls here somewhere inside that line and the twin does not pretend to know where, so it hands
//   over the published row and lets a person read it. That is a true answer to "when is the next
//   bus" rather than a blank, and it needed no invented stop order to produce.
//
// TWO ANSWERS THAT USED TO DISAGREE
//   A per-stop board is computed on demand from `world.clock`, so it follows a time projection. The
//   island-wide figure used to be a field written by `tick()`, and `tick()` does not run while the
//   clock is parked, so a scrubbed moment had the board saying 14:40 and the figure still answering
//   for whenever the island was last lived to. One of them was lying at every scrubbed minute.
//
//   Both now come out of one function, `summaryAt()`, evaluated at whatever moment the clock is
//   showing, and the summary carries that moment with it so a panel can say which one the number
//   belongs to. The system is not declared `clockDerived` (see `CLOCK_DERIVED` in
//   src/kernel/clock.js): that mechanism snapshots and restores a whole read model around a scrub,
//   and this one holds forty-two feature records the render layer keeps live references into.
//   Making the two readers share one function is the smaller fix and it makes them agree by
//   construction rather than by anybody remembering to.
//
// Reads: world.data['map-contributions'], world.data.transport, world.island, world.clock.
// Publishes: contributed. Imports no other system. Runs headless.

import { mayShow, labelFor } from '../../world/data.js';

/**
 * Which column of the published timetable belongs to which waypoint, per route and per direction.
 *
 * Written out rather than derived. `timing_points_outbound` in the pack lists the points in order
 * and the rows are keyed by short names that do not match them character for character ("Point
 * Lookout - Adder Rock" against `adder_rock`, and `gorge` outbound against `dep_gorge` back), so a
 * derivation would be a string-mangling rule nobody could audit against eleven rows.
 */
const TIMETABLE_COLUMNS = {
  'svc-bus-880': {
    out: { key: 'dunwich_to_point_lookout', towards: 'Point Lookout' },
    back: { key: 'point_lookout_to_dunwich', towards: 'Dunwich' },
    points: {
      'Junner Street Ferry Terminal': { out: 'dep_junner', back: 'junner' },
      'One Mile Ferry Terminal': { out: 'one_mile', back: 'one_mile' },
      'Amity Point turnoff': { out: 'amity_turnoff', back: 'amity_turnoff' },
      'Point Lookout, Adder Rock': { out: 'adder_rock', back: 'adder_rock' },
      'Point Lookout, Cylinder Beach': { out: 'cylinder', back: 'cylinder' },
      'Point Lookout, Gorge Walk': { out: 'gorge', back: 'dep_gorge' }
    }
  },
  'svc-bus-881': {
    out: { key: 'dunwich_to_amity_point', towards: 'Amity Point' },
    back: { key: 'amity_point_to_dunwich', towards: 'Dunwich' },
    points: {
      'One Mile Ferry Terminal': { out: 'one_mile', back: 'one_mile' },
      'Junner Street Ferry Terminal': { out: 'junner', back: 'junner' },
      QUAMPI: { out: 'quampi', back: 'quampi' },
      'Amity Point turnoff': { out: 'amity_turnoff', back: 'amity_turnoff' },
      'Amity Point (Pulan)': { out: 'amity_point', back: 'amity_point' }
    }
  }
};

/**
 * The columns of both published timetables, named the way a person would say them out loud.
 *
 * Written out for the same reason `TIMETABLE_COLUMNS` is: the outbound and inbound tables key the
 * same physical point differently (`gorge` one way, `dep_gorge` the other) and a derivation would be
 * a string rule nobody could audit. The labels themselves come from the `waypoints` list in
 * data/transport.json, which is where the notes on the Beehive Road junction and on QUAMPI live.
 */
const COLUMN_LABEL = {
  dep_junner: 'Junner Street, Dunwich',
  junner: 'Junner Street, Dunwich',
  one_mile: 'One Mile',
  quampi: 'QUAMPI, Dunwich',
  amity_turnoff: 'the Amity Point turnoff',
  amity_point: 'Amity Point (Pulan)',
  adder_rock: 'Adder Rock',
  cylinder: 'Cylinder Beach',
  gorge: 'the Gorge Walk',
  dep_gorge: 'the Gorge Walk'
};

/**
 * THE CONTRIBUTOR'S OWN FOLDERS, WHICH ARE A TAXONOMY AND NOT A FILING ACCIDENT
 *
 * A critic flew this island at five hundred metres and found the contributed layer reading as a
 * row of identical yellow squares: twenty bus stops in the same attention colour as each other and
 * as nothing else, including the fifteen with no bus for hours. The layer was drawing one fact,
 * that a thing was pinned here, and throwing away the one the pack already carried.
 *
 * The pack carries it in `folder`. He sorted his own map of the island into nine folders and they
 * are a real classification of public life here: what is beautiful, what trades, what the community
 * uses, how you get about, what the council runs, where people stay, and the ground the mine was
 * on. So the folder sets the family and the family sets the colour and the plate shape, the kind
 * sets the glyph, and the attention colour is not spent on any of them. `--sun` is reserved for one
 * thing: a stop with a bus inside ten minutes. Attention colour for the thing that deserves
 * attention, and nothing else.
 *
 * Four of the nine folders reach the world today; the other five are held by the gate at ingest.
 * All nine are written down because this table decides the words if that ever changes, and because
 * one of them is a correction rather than a name.
 *
 * `tone` is a design token from src/ui/design.css, and it is what the minimap draws with.
 * `plate` is the quieter rgb the world markers take, because a dot on a dark island can be softer
 * than a dot on a panel and still be read.
 */
export const FOLDER_FAMILY = {
  'Natural Beauty': {
    id: 'natural', label: 'Natural beauty', shape: 'diamond',
    tone: 'leaf', plate: [0.498, 0.682, 0.373],
    what: 'The places on the island he thinks are worth going to look at.'
  },
  'Local Businesses': {
    id: 'business', label: 'Local business', shape: 'circle',
    tone: 'sand', plate: [0.796, 0.733, 0.588],
    what: 'Somewhere that trades. None of these is drawn: data/businesses.json is the register the world uses.'
  },
  'Active Community Spaces': {
    id: 'community', label: 'Community space', shape: 'circle',
    tone: 'heath', plate: [0.651, 0.549, 0.722],
    what: 'Somewhere islanders use rather than somewhere they are sold something.'
  },
  'Getting Around; Public Transport': {
    id: 'transport', label: 'Getting around', shape: 'square',
    tone: 'sea', plate: [0.490, 0.608, 0.820],
    what: 'How a person without a car moves on an island 39 km long.'
  },
  'Public Services and Utilities': {
    id: 'services', label: 'Public service or utility', shape: 'hex',
    tone: 'iron', plate: [0.549, 0.600, 0.639],
    what: 'The works that keep the island running, most of which nobody thinks about until they stop.'
  },
  'Point Lookout Holiday Rental Properties': {
    id: 'accommodation', label: 'Holiday letting', shape: 'circle',
    tone: 'sand', plate: [0.725, 0.651, 0.553],
    what: 'A dwelling let to visitors. Positions in this family are coarsened to 250 m before commit and none is drawn.'
  },
  'Amity Holiday Rentals': {
    id: 'accommodation', label: 'Holiday letting', shape: 'circle',
    tone: 'sand', plate: [0.725, 0.651, 0.553],
    what: 'A dwelling let to visitors. Positions in this family are coarsened to 250 m before commit and none is drawn.'
  },
  'Dunwich Holiday Accommodation': {
    id: 'accommodation', label: 'Holiday letting', shape: 'circle',
    tone: 'sand', plate: [0.725, 0.651, 0.553],
    what: 'A dwelling let to visitors. Positions in this family are coarsened to 250 m before commit and none is drawn.'
  },
  /**
   * The one entry where the folder name is wrong and the label is a correction.
   *
   * The owner corrected this himself on 10 August 2026 and docs/SOURCES.md holds it: the leases were
   * closed in 2019 and what is on that ground now is the former mine sites, in various states of
   * rehabilitation. Sand mining on Minjerribah ended under the North Stradbroke Island Protection
   * and Sustainability Act 2011, amended in 2016 to bring the end date back to the end of 2019,
   * which is `nsipsa-2011` in data/civic.json. Nothing here may present that ground as operating or
   * imply that anybody holds a right to mine it now, so the label never repeats the folder name and
   * `former` travels with every record out of it.
   */
  'Private Mine Leases': {
    id: 'former-mine', label: 'Former mine site', shape: 'hex',
    tone: 'iron', plate: [0.604, 0.545, 0.431], former: true,
    what: 'Ground the sand mining happened on. Mining on Minjerribah ended in 2019 under the North '
      + 'Stradbroke Island Protection and Sustainability Act 2011: these are not current leases and '
      + 'nothing here is operating.'
  }
};

const FAMILY_FALLBACK = {
  id: 'other', label: 'Public feature', shape: 'circle',
  tone: 'sand', plate: [0.796, 0.733, 0.588],
  what: 'A public feature on the island.'
};

/**
 * What each kind of marker is called out loud, the glyph it wears, and the one sentence that says
 * what it is for.
 *
 * The sentence is about the kind of thing, never about this one: "a shark-proof swimming enclosure"
 * is what the contributor wrote about that pin and it is in his quote, and "the island's rubbish
 * goes here" is a fact about how a tip works. Nothing here claims a condition, an operator or an
 * opening hour.
 *
 * `tone` and `plate` are gone from this table on purpose. Colour is the family's to set, because a
 * colour per kind is eighteen colours and eighteen colours is no colours at all. The kind is told
 * apart by the glyph, which src/render/layers/contributed.js draws into an atlas at boot.
 */
export const FACILITY_LOOK = {
  bus_stop: { label: 'Bus stop', glyph: 'bus', height: 3.2, what: 'Route 880 and Route 881 are the island\'s only public transport, and they run to meet the ferries.' },
  airfield: { label: 'Airfield', glyph: 'plane', height: 3.4, what: 'There is no scheduled air service. The strip is general aviation and the flying doctor.' },
  water_treatment: { label: 'Water treatment plant', glyph: 'drop', height: 3.0, what: 'Every drop of drinking water on this island comes out of the sand under it.' },
  waste_transfer: { label: 'Refuse tip', glyph: 'bin', height: 3.4, what: 'Everything the island throws away is handled here, and what leaves crosses the bay on a barge.' },
  waste_bay: { label: 'Waste bay', glyph: 'bays', height: 2.4, what: 'A separated bay inside the tip.' },
  depot: { label: 'Council depot', glyph: 'shed', height: 3.0, what: 'Where the council keeps the plant that maintains the roads, the parks and the bins.' },
  ambulance: { label: 'Ambulance station', glyph: 'cross', height: 3.0, what: 'The only way off this island for a patient who needs a hospital is a boat or a helicopter.' },
  public_phone: { label: 'Public phone', glyph: 'phone', height: 2.4, what: 'Mobile coverage on Minjerribah has holes in it, and a payphone works when the tower does not.' },
  toilet_block: { label: 'Public toilets', glyph: 'toilet', height: 2.6, what: 'Public amenities.' },
  jetty: { label: 'Jetty', glyph: 'jetty', height: 2.8, what: 'Fishing and small boats.' },
  skate_park: { label: 'Skate park', glyph: 'ramp', height: 2.6, what: 'Somewhere for the island\'s kids to go.' },
  bmx_track: { label: 'BMX track', glyph: 'bike', height: 2.6, what: 'Somewhere for the island\'s kids to go.' },
  court: { label: 'Courts', glyph: 'court', height: 2.8, what: 'Community sport.' },
  sports_ground: { label: 'Sports ground', glyph: 'posts', height: 2.8, what: 'Community sport.' },
  swimming_enclosure: { label: 'Swimming enclosure', glyph: 'net', height: 2.4, what: 'A netted swimming area in the bay.' },
  spring: { label: 'Spring', glyph: 'spring', height: 2.4, what: 'Fresh water coming up out of the sand at the shore.' },
  park: { label: 'Park', glyph: 'tree', height: 2.6, what: 'Public open space.' },
  beach: { label: 'Beach', glyph: 'wave', height: 2.4, what: 'Public foreshore.' },
  facility: { label: 'Public feature', glyph: 'dot', height: 2.6, what: 'A public feature on the island.' }
};

const TOWNSHIP_LABEL = {
  dunwich: 'Dunwich (Goompi)', 'amity-point': 'Amity Point (Pulan)', 'point-lookout': 'Point Lookout (Mulumba)'
};

/** "07:15" to 435. Null for a dash, a blank or a footnote marker, which the timetable uses. */
function minutesOf(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const hhmm = (m) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

export function registerContributed(world) {
  const state = world.publish('contributed', {
    ready: false,
    /** Where the whole thing came from, for any panel that shows one of these. */
    pack: 'map-contributions',
    contributor: '',
    method: '',
    fetched: '',
    dataStatus: '',
    /** Everything drawn, in pack order. */
    features: [],
    byKind: {},
    byFamily: {},
    /** The nine folders, drawn or not, so a panel can say what is in the pack and what reaches the world. */
    families: [],
    drawn: 0,
    inPack: 0,
    /** The bus stops, which carry their own live departure board. */
    stops: [],
    timingPoints: 0,
    /**
     * The island-wide bus figures AT THE ISLAND'S OWN PRESENT, written by `tick()`.
     *
     * Read these for a probe, a save or the headless harness. Do not read them on a screen: while
     * the clock is parked they are the last lived answer and the screen is showing another moment.
     * `summary()` is the one to draw with, and it stamps the moment it answered for.
     */
    nextBus: null,
    nextBusMinutes: null,
    busesDueWithinHour: 0,
    serviceDayLabel: '',
    notes: []
  });

  let transport = null;
  /** Per stop, the published departures as flat minute-of-day rows. Built once. */
  const boards = new Map();
  /** Per route and direction, every published run as its whole printed line. Built once. */
  const runs = new Map();

  /* ---------------------------------------------------------------- reading the pack */

  function readPack(w) {
    const pack = w.data && w.data['map-contributions'];
    if (!pack || !Array.isArray(pack.pins)) {
      state.notes.push('data/contributions/map-contributions.json is missing or carries no pins, so no '
        + 'contributed feature is on the ground. The rest of the island is unaffected.');
      return;
    }
    state.inPack = pack.pins.length;
    const c = pack.contribution || {};
    state.contributor = c.contributed_by || '';
    state.method = c.method || '';
    state.fetched = c.fetched || '';
    state.dataStatus = c.data_status || '';

    // Every folder in the pack, drawn or held, with the count each one has. A panel showing one
    // marker can then say what family it belongs to and how much of that family reached the world,
    // which is the difference between a pin and a map.
    const seen = new Map();
    for (const pin of pack.pins) {
      const fam = FOLDER_FAMILY[pin.folder] || FAMILY_FALLBACK;
      const key = pin.folder || '(unfiled)';
      if (!seen.has(key)) {
        seen.set(key, {
          folder: key, id: fam.id, label: fam.label, tone: fam.tone,
          what: fam.what, former: !!fam.former, inPack: 0, drawn: 0
        });
      }
      seen.get(key).inPack++;
    }

    const island = w.island;
    for (const pin of pack.pins) {
      // One gate, and it is the runtime's own. mayShow() reads player_facing, the visibility level
      // and the confidence floor, and it is the same function tools/gate-audit.mjs runs.
      if (!mayShow(pin)) continue;
      if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lon)) continue;
      const look = FACILITY_LOOK[pin.facility_kind] || FACILITY_LOOK.facility;
      const fam = FOLDER_FAMILY[pin.folder] || FAMILY_FALLBACK;
      const xz = island ? island.project(pin.lon, pin.lat) : { x: 0, z: 0 };
      const y = island ? island.height(xz.x, xz.z) : 0;
      const f = {
        id: pin.id,
        name: pin.display_name || pin.name,
        contributedName: pin.name,
        nameNote: pin.display_name_note || null,
        kind: pin.facility_kind || 'facility',
        kindLabel: look.label,
        glyph: look.glyph,
        /* the family, from his own folder. The folder string is carried verbatim beside the label
           because on one of the nine the label is a correction and the difference has to be
           visible: "Private Mine Leases" is what the folder says and former mine site is what it
           is. */
        folder: pin.folder || '',
        family: fam.id,
        familyLabel: fam.label,
        familyWhat: fam.what,
        shape: fam.shape,
        tone: fam.tone,
        plate: fam.plate,
        former: !!fam.former,
        what: look.what,
        x: Math.round(xz.x * 10) / 10,
        z: Math.round(xz.z * 10) / 10,
        y: Math.round(y * 10) / 10,
        lat: pin.lat,
        lon: pin.lon,
        township: pin.township || null,
        townshipLabel: TOWNSHIP_LABEL[pin.township] || null,
        region: island ? island.regionAt(xz.x, xz.z) : '',
        fromOutline: pin.geometry === 'polygon',
        /* provenance, carried whole so a panel never has to go back to the pack */
        quote: pin.quote || '',
        contributedBy: pin.contributed_by || state.contributor,
        role: pin.role || '',
        extractedAt: pin.extracted_at || '',
        consentWording: (pin.consent && pin.consent.wording) || '',
        marker: labelFor(pin),
        existenceConfidence: pin.existence_confidence || null,
        positionConfidence: pin.position_confidence || null,
        statusConfidence: pin.status_confidence || null,
        basis: pin.player_facing_basis || '',
        shownAs: pin.shown_as || '',
        positionBasis: pin.position_basis || '',
        verdict: (pin.reconciliation && pin.reconciliation.verdict) || null,
        verdictReason: (pin.reconciliation && pin.reconciliation.reason) || '',
        transport: pin.transport || null
      };
      state.features.push(f);
      state.byKind[f.kind] = (state.byKind[f.kind] || 0) + 1;
      state.byFamily[f.family] = (state.byFamily[f.family] || 0) + 1;
      const row = seen.get(pin.folder || '(unfiled)');
      if (row) row.drawn++;
      if (f.kind === 'bus_stop') state.stops.push(f);
    }
    state.drawn = state.features.length;
    state.families = [...seen.values()].sort((a, b) => b.drawn - a.drawn || b.inPack - a.inPack);
  }

  /* ---------------------------------------------------------------- the departure boards */

  /**
   * Every published departure from a stop that is a timing point, as minutes of the day.
   *
   * A row whose cell for this stop is a dash is a run that does not call here, and the pack's own
   * footnote says so: "the bus does not travel via that location". Those rows are dropped rather
   * than filled in. A row flagged A runs on weekends, public holidays and school holiday weekdays
   * only, which is published, so the flag travels with the departure and the day decides.
   */
  function buildBoards(w) {
    transport = w.data && w.data.transport;
    if (!transport || !Array.isArray(transport.services)) {
      state.notes.push('data/transport.json carries no services, so no bus stop has a departure board.');
      return;
    }
    const byId = new Map(transport.services.map((s) => [s.id, s]));
    for (const stop of state.stops) {
      const joins = (stop.transport && stop.transport.timing_points) || [];
      if (!joins.length) continue;
      const rows = [];
      for (const join of joins) {
        const svc = byId.get(join.route);
        const spec = TIMETABLE_COLUMNS[join.route];
        if (!svc || !svc.schedule || !spec) continue;
        const col = spec.points[join.timing_point];
        if (!col) continue;
        for (const dir of ['out', 'back']) {
          const table = svc.schedule[spec[dir].key] || [];
          for (const row of table) {
            const at = minutesOf(row[col[dir]]);
            if (at === null) continue;
            rows.push({
              at,
              route: svc.id,
              routeLabel: svc.id.replace('svc-bus-', 'Route '),
              towards: spec[dir].towards,
              flag: row.flag || null
            });
          }
        }
      }
      rows.sort((a, b) => a.at - b.at || (a.route < b.route ? -1 : 1));
      if (rows.length) {
        boards.set(stop.id, rows);
        state.timingPoints++;
      }
    }
    buildRuns(byId);
    if (state.timingPoints) {
      const sch = (transport.services.find((s) => s.id === 'svc-bus-880') || {}).schedule || {};
      state.notes.push(`Departure boards are the published Translink timetable effective ${sch.effective_from || 'the date in data/transport.json'}, `
        + 'held as a dated snapshot. It is not a live feed and a departure shown here is not today\'s departure.');
    }
  }

  /**
   * Every published run on both routes, as its whole printed line.
   *
   * A run is one row of the timetable: the six or five times Translink prints for one bus making
   * one trip. `buildBoards` above takes one column out of that row, which is the right answer for
   * a stop the timetable names. This takes the whole row, which is the only honest answer for the
   * fifteen it does not.
   *
   * The columns come off the row's own key order, which is the printed column order, so nothing
   * here needs a second table saying which point comes first. A dash is dropped, because the
   * footnote says a dash means the bus does not travel via that location, so a run's first and last
   * published times are the first and last it actually calls at.
   */
  function buildRuns(byId) {
    for (const [routeId, spec] of Object.entries(TIMETABLE_COLUMNS)) {
      const svc = byId.get(routeId);
      if (!svc || !svc.schedule) continue;
      for (const dir of ['out', 'back']) {
        const table = svc.schedule[spec[dir].key] || [];
        const list = [];
        for (const row of table) {
          const cells = Object.entries(row)
            .filter(([key]) => key !== 'flag')
            .map(([key, cell]) => ({
              at: minutesOf(cell),
              label: COLUMN_LABEL[key] || key.replace(/_/g, ' ')
            }));
          const first = cells.findIndex((k) => k.at !== null);
          let last = -1;
          for (let i = cells.length - 1; i >= 0; i--) if (cells[i].at !== null) { last = i; break; }
          if (first < 0 || last <= first) continue;
          const calls = [];
          // A dash inside the run rather than at the front of it is the footnote's "the bus does not
          // travel via that location", and it is the one thing that could make "it calls here
          // somewhere inside this run" untrue. Named rather than dropped, so the card can say it.
          const skips = [];
          for (let i = first; i <= last; i++) {
            if (cells[i].at === null) skips.push(cells[i].label);
            else calls.push({ at: cells[i].at, at_text: hhmm(cells[i].at), label: cells[i].label });
          }
          list.push({
            route: routeId,
            routeLabel: routeId.replace('svc-bus-', 'Route '),
            towards: spec[dir].towards,
            flag: row.flag || null,
            calls,
            skips,
            startsAt: calls[0].at,
            endsAt: calls[calls.length - 1].at,
            from: calls[0].label,
            to: calls[calls.length - 1].label
          });
        }
        list.sort((a, b) => a.startsAt - b.startsAt);
        if (list.length) runs.set(routeId + ':' + dir, list);
      }
    }
  }

  /** Does this run operate on the island day the clock is currently in? */
  function runsToday(w, flag) {
    if (flag !== 'A') return true;
    return w.clock.isWeekend || w.clock.isQldSchoolHoliday;
  }

  /**
   * The next departures from one stop, from the island's own clock. Allocates, so it is called on a
   * click and on the small per-tick summary, never in a loop over everything.
   */
  function departuresAt(id, limit = 4) {
    const rows = boards.get(id);
    if (!rows) return [];
    const now = world.clock.minuteOfDay;
    const out = [];
    for (const r of rows) {
      if (r.at < now) continue;
      if (!runsToday(world, r.flag)) continue;
      out.push({ ...r, inMinutes: r.at - now, at_text: hhmm(r.at) });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * The runs that have not finished yet at a stop the timetable does not name.
   *
   * Every field here is printed on the timetable. What is not here is a departure time for this
   * stop, because there is not one, and the difference between the two is the whole point of the
   * function. A run that has already reached its last published point has certainly gone past; one
   * that has not reached its first has certainly not arrived; in between the twin does not know
   * where the bus is and says so rather than dividing the leg up.
   */
  function runsAt(id, limit = 4) {
    const stop = state.stops.find((s) => s.id === id);
    if (!stop || !stop.transport) return [];
    const now = world.clock.minuteOfDay;
    const out = [];
    for (const route of stop.transport.serves_routes || []) {
      for (const dir of ['out', 'back']) {
        for (const r of runs.get(route + ':' + dir) || []) {
          if (r.endsAt < now || !runsToday(world, r.flag)) continue;
          out.push({
            ...r,
            startsIn: r.startsAt - now,
            underway: r.startsAt <= now,
            windowText: `${hhmm(r.startsAt)} from ${r.from} to ${hhmm(r.endsAt)} at ${r.to}`
          });
        }
      }
    }
    out.sort((a, b) => a.startsAt - b.startsAt || (a.route < b.route ? -1 : 1));
    return out.slice(0, limit);
  }

  /** The last published departure from a stop today, board or run, whichever the stop has. */
  function lastToday(id) {
    const rows = boards.get(id);
    if (rows) {
      let best = null;
      for (const r of rows) if (runsToday(world, r.flag) && (!best || r.at > best.at)) best = r;
      return best ? { at_text: hhmm(best.at), routeLabel: best.routeLabel, towards: best.towards, timed: true } : null;
    }
    const stop = state.stops.find((s) => s.id === id);
    if (!stop || !stop.transport) return null;
    let best = null;
    for (const route of stop.transport.serves_routes || []) {
      for (const dir of ['out', 'back']) {
        for (const r of runs.get(route + ':' + dir) || []) {
          if (!runsToday(world, r.flag)) continue;
          if (!best || r.startsAt > best.startsAt) best = r;
        }
      }
    }
    return best
      ? { at_text: hhmm(best.startsAt), endsAt_text: hhmm(best.endsAt), routeLabel: best.routeLabel, towards: best.towards, timed: false }
      : null;
  }

  /**
   * THE ISLAND-WIDE ANSWER, AT WHATEVER MOMENT YOU ASK IT FOR.
   *
   * One function, two callers: `tick()` writes its answer at the island's own present into the read
   * model, and `summary()` hands the same answer for the moment on screen to whatever is drawing.
   * They cannot drift apart because there is only one of them, and the object carries the moment it
   * was computed for so that nothing has to guess which one it is looking at.
   */
  function summaryAt(w) {
    const now = w.clock.minuteOfDay;
    let best = null;
    let within = 0;
    for (const stop of state.stops) {
      const rows = boards.get(stop.id);
      if (!rows) continue;
      for (const r of rows) {
        if (r.at < now || !runsToday(w, r.flag)) continue;
        if (r.at - now <= 60) within++;
        if (!best || r.at < best.at) best = { at: r.at, stop, row: r };
      }
    }
    const off = w.clock.viewOffsetMin || 0;
    return {
      dueWithinHour: within,
      nextBusMinutes: best ? best.at - now : null,
      nextBus: best
        ? `${best.row.routeLabel} towards ${best.row.towards} from ${best.stop.name}, ${hhmm(best.at)}`
        : 'no more published departures today',
      serviceDayLabel: w.clock.isWeekend
        ? 'weekend timetable, so the A-flagged runs are on'
        : w.clock.isQldSchoolHoliday
          ? 'school holiday weekday, so the A-flagged runs are on'
          : 'school term weekday, so the A-flagged runs are off',
      /* which moment this answer belongs to */
      atText: hhmm(now),
      dateText: typeof w.clock.formatDate === 'function' ? w.clock.formatDate() : '',
      scrubMinutes: off,
      moment: off === 0 ? 'present' : off > 0 ? 'ahead' : 'behind'
    };
  }

  function summarise(w) {
    const s = summaryAt(w);
    state.busesDueWithinHour = s.dueWithinHour;
    state.nextBusMinutes = s.nextBusMinutes;
    state.nextBus = s.nextBus;
    state.serviceDayLabel = s.serviceDayLabel;
  }

  /* ---------------------------------------------------------------- lookups for the interface */

  /** The feature nearest a world point, within `withinM`. Used by picking and by the map panel. */
  function nearest(x, z, withinM = 120) {
    let best = null;
    let bestD = withinM * withinM;
    for (const f of state.features) {
      const dx = f.x - x, dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }
  function byId(id) {
    for (const f of state.features) if (f.id === id) return f;
    return null;
  }

  // Non-enumerable, so anything walking the read model for a probe or a save does not trip over a
  // function, which is the same shape src/systems/movement/navigation.js publishes.
  const api = {
    departuresAt,
    runsAt,
    lastToday,
    /** The island-wide figures for the moment on screen. This is the one a panel draws. */
    summary: () => summaryAt(world),
    nearest,
    byId,
    boardFor: (id) => boards.get(id) || null,
    hasBoard: (id) => boards.has(id)
  };
  for (const [k, v] of Object.entries(api)) {
    Object.defineProperty(state, k, { value: v, enumerable: false });
  }

  return world.register({
    id: 'contributed',
    phase: 'infrastructure',
    order: 70,

    init(w) {
      readPack(w);
      buildBoards(w);
      summarise(w);
      state.ready = true;
      // The picker keeps a static spatial index and rebuilds it when something tells it to.
      w.bus.emit('contributed:ready', { drawn: state.drawn, stops: state.stops.length });
      if (state.drawn) {
        const fams = state.families.filter((f) => f.drawn).map((f) => `${f.label} ${f.drawn}`).join(', ');
        console.info(`[contributed] ${state.drawn} public features from ${state.contributor}'s map, `
          + `${state.stops.length} of them bus stops, ${state.timingPoints} with a published departure board. `
          + `Families drawn: ${fams}.`);
      }
    },

    tick(w) {
      if (!state.ready) return;
      summarise(w);
    },

    describe() {
      // The figures here are the island's own present, never a scrubbed moment, because a probe is
      // a reading of the simulation and the simulation does not live through a projection.
      return {
        drawn: state.drawn,
        inPack: state.inPack,
        stops: state.stops.length,
        withDepartureBoard: state.timingPoints,
        withRunLineOnly: state.stops.length - state.timingPoints,
        nextBusMinutes: state.nextBusMinutes,
        busesDueWithinHour: state.busesDueWithinHour,
        kinds: Object.keys(state.byKind).length,
        families: Object.keys(state.byFamily).length,
        byFamily: state.byFamily,
        runLines: [...runs.values()].reduce((n, l) => n + l.length, 0),
        contributor: state.contributor
      };
    }
  });
}
