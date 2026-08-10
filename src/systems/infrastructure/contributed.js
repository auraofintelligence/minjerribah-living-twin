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
 * What each kind of marker is called out loud, and the one sentence that says what it is for.
 *
 * The sentence is about the kind of thing, never about this one: "a shark-proof swimming enclosure"
 * is what the contributor wrote about that pin and it is in his quote, and "the island's rubbish
 * goes here" is a fact about how a tip works. Nothing here claims a condition, an operator or an
 * opening hour.
 */
export const FACILITY_LOOK = {
  bus_stop: { label: 'Bus stop', tone: 'sun', height: 3.2, what: 'Route 880 and Route 881 are the island\'s only public transport, and they run to meet the ferries.' },
  airfield: { label: 'Airfield', tone: 'iron', height: 3.4, what: 'There is no scheduled air service. The strip is general aviation and the flying doctor.' },
  water_treatment: { label: 'Water treatment plant', tone: 'sea', height: 3.0, what: 'Every drop of drinking water on this island comes out of the sand under it.' },
  waste_transfer: { label: 'Refuse tip', tone: 'iron', height: 3.4, what: 'Everything the island throws away is handled here, and what leaves crosses the bay on a barge.' },
  waste_bay: { label: 'Waste bay', tone: 'iron', height: 2.4, what: 'A separated bay inside the tip.' },
  depot: { label: 'Council depot', tone: 'iron', height: 3.0, what: 'Where the council keeps the plant that maintains the roads, the parks and the bins.' },
  ambulance: { label: 'Ambulance station', tone: 'coral', height: 3.0, what: 'The only way off this island for a patient who needs a hospital is a boat or a helicopter.' },
  public_phone: { label: 'Public phone', tone: 'iron', height: 2.4, what: 'Mobile coverage on Minjerribah has holes in it, and a payphone works when the tower does not.' },
  toilet_block: { label: 'Public toilets', tone: 'leaf', height: 2.6, what: 'Public amenities.' },
  jetty: { label: 'Jetty', tone: 'sea', height: 2.8, what: 'Fishing and small boats.' },
  skate_park: { label: 'Skate park', tone: 'heath', height: 2.6, what: 'Somewhere for the island\'s kids to go.' },
  bmx_track: { label: 'BMX track', tone: 'heath', height: 2.6, what: 'Somewhere for the island\'s kids to go.' },
  court: { label: 'Courts', tone: 'heath', height: 2.8, what: 'Community sport.' },
  sports_ground: { label: 'Sports ground', tone: 'heath', height: 2.8, what: 'Community sport.' },
  swimming_enclosure: { label: 'Swimming enclosure', tone: 'sea', height: 2.4, what: 'A netted swimming area in the bay.' },
  spring: { label: 'Spring', tone: 'sea', height: 2.4, what: 'Fresh water coming up out of the sand at the shore.' },
  park: { label: 'Park', tone: 'leaf', height: 2.6, what: 'Public open space.' },
  beach: { label: 'Beach', tone: 'sand', height: 2.4, what: 'Public foreshore.' },
  facility: { label: 'Public feature', tone: 'sand', height: 2.6, what: 'A public feature on the island.' }
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
    drawn: 0,
    inPack: 0,
    /** The bus stops, which carry their own live departure board. */
    stops: [],
    timingPoints: 0,
    /** Live, and the reason this system has a tick at all. */
    nextBus: null,
    nextBusMinutes: null,
    busesDueWithinHour: 0,
    serviceDayLabel: '',
    notes: []
  });

  let transport = null;
  /** Per stop, the published departures as flat minute-of-day rows. Built once. */
  const boards = new Map();

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

    const island = w.island;
    for (const pin of pack.pins) {
      // One gate, and it is the runtime's own. mayShow() reads player_facing, the visibility level
      // and the confidence floor, and it is the same function tools/gate-audit.mjs runs.
      if (!mayShow(pin)) continue;
      if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lon)) continue;
      const look = FACILITY_LOOK[pin.facility_kind] || FACILITY_LOOK.facility;
      const xz = island ? island.project(pin.lon, pin.lat) : { x: 0, z: 0 };
      const y = island ? island.height(xz.x, xz.z) : 0;
      const f = {
        id: pin.id,
        name: pin.display_name || pin.name,
        contributedName: pin.name,
        nameNote: pin.display_name_note || null,
        kind: pin.facility_kind || 'facility',
        kindLabel: look.label,
        tone: look.tone,
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
      if (f.kind === 'bus_stop') state.stops.push(f);
    }
    state.drawn = state.features.length;
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
    if (state.timingPoints) {
      const sch = (transport.services.find((s) => s.id === 'svc-bus-880') || {}).schedule || {};
      state.notes.push(`Departure boards are the published Translink timetable effective ${sch.effective_from || 'the date in data/transport.json'}, `
        + 'held as a dated snapshot. It is not a live feed and a departure shown here is not today\'s departure.');
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

  /** The soonest departure anywhere on the island, and how many are due in the next hour. */
  function summarise(w) {
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
    state.busesDueWithinHour = within;
    state.nextBusMinutes = best ? best.at - now : null;
    state.nextBus = best
      ? `${best.row.routeLabel} towards ${best.row.towards} from ${best.stop.name}, ${hhmm(best.at)}`
      : 'no more published departures today';
    state.serviceDayLabel = w.clock.isWeekend
      ? 'weekend timetable, so the A-flagged runs are on'
      : w.clock.isQldSchoolHoliday
        ? 'school holiday weekday, so the A-flagged runs are on'
        : 'school term weekday, so the A-flagged runs are off';
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
  for (const [k, v] of Object.entries({ departuresAt, nearest, byId, boardFor: (id) => boards.get(id) || null })) {
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
        console.info(`[contributed] ${state.drawn} public features from ${state.contributor}'s map, `
          + `${state.stops.length} of them bus stops, ${state.timingPoints} with a published departure board.`);
      }
    },

    tick(w) {
      if (!state.ready) return;
      summarise(w);
    },

    describe() {
      return {
        drawn: state.drawn,
        inPack: state.inPack,
        stops: state.stops.length,
        withDepartureBoard: state.timingPoints,
        nextBusMinutes: state.nextBusMinutes,
        busesDueWithinHour: state.busesDueWithinHour,
        kinds: Object.keys(state.byKind).length,
        contributor: state.contributor
      };
    }
  });
}
