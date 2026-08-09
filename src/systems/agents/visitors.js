// The other population. The one that pays for everything and turns up all at once.
//
// On a wet Tuesday in June there are a couple of hundred visitors on Minjerribah. On the Saturday of
// the Easter long weekend there are several thousand, and the island's resident population is 2,156.
// That swing is the whole economic story of this place, and the whole civic argument as well: the
// services, the water, the waste, the car parks, the ambulance and the two shops are all sized
// somewhere between those two numbers and are wrong at both ends.
//
// WHAT IS MEASURED AND WHAT IS NOT
//   Measured, and the only measured figure in this file: 375,000 visitors in 2018, reported in 2019,
//   with a median day-tripper spend of A$120 and a median overnight spend of A$172, 95 per cent
//   domestic and 72 per cent of those from within 50 km. data/residents.json visitor_baseline, and
//   the pack is clear it is not current.
//   Published, and used as a hard ceiling: the ferry timetables and the vessel capacities in
//   data/transport.json. The Minjerribah carries 52 cars and 400 passengers, the Sea Breeze 60 and
//   300, the Quandamooka 52 and 400, and the Yalingbila 198 passengers. Those numbers decide how
//   many people can physically be on this island tomorrow, and on a long weekend they bind.
//   Published: the Queensland school holiday and long weekend load multipliers in data/events.json,
//   the campground site counts at Adder Rock and Flinders Beach, and the nine visitor archetypes
//   with their party sizes, stay lengths and hour by hour days in data/residents.json.
//   Modelled: everything else, including the shape of the year, the weather response, campground
//   capacity where none is published, and the split of walk-on capacity between the two water taxi
//   operators, because one of them does not publish a passenger capacity at all.
//
// A visitor party is one simulation object with named members rather than one object per person.
// Several thousand people arriving on a Friday afternoon is a party of four in a wagon repeated
// eight hundred times, and modelling it as eight hundred wagons is both cheaper and truer than
// modelling it as three thousand two hundred individuals with independent bladders.

import { makeCalendar } from './calendar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WEATHER_MEAN_CORRECTION = 1.165;
const mins = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/**
 * Campground capacity. Two of these are published by Minjerribah Camping and are used as published.
 * The rest are modelled, because no site count for them could be found, and they are flagged as
 * modelled in the read model rather than quietly presented as fact.
 */
const CAMPGROUNDS = [
  { id: 'adder-rock-campground', sites: 153, basis: 'published' },       // 107 tent + 13 van + 26 powered + 7 cabins
  { id: 'flinders-beach-camping', sites: 200, basis: 'published' },
  { id: 'cylinder-beach-campground', sites: 90, basis: 'estimate' },
  { id: 'home-beach-campground', sites: 70, basis: 'estimate' },
  { id: 'amity-point-campground', sites: 80, basis: 'estimate' },
  { id: 'main-beach-camping', sites: 120, basis: 'estimate' },
  { id: 'bradburys-beach-campground', sites: 40, basis: 'estimate' },
  { id: 'adams-beach-campground', sites: 40, basis: 'estimate' },
  { id: 'thankful-rest', sites: 30, basis: 'estimate' }
];

/** Where an archetype's day is spent, when the pack's own hour-by-hour block names a place. */
const FALLBACK_PLACE = {
  'day-tripper': 'cylinder-beach',
  'family-in-a-holiday-house': 'home-beach',
  'weekend-camper': 'flinders-beach',
  surfer: 'main-beach',
  'whale-watcher': 'north-gorge-walk',
  'school-group': 'north-gorge-walk',
  backpacker: 'cylinder-beach',
  'tradesperson-from-the-mainland': 'point-lookout',
  'grey-nomad': 'amity-beach'
};

export function registerVisitors(world) {
  const rng = world.rng.stream('visitors');

  const state = world.publish('visitors', {
    ready: false,
    onIsland: 0,
    parties: 0,
    byArchetype: {},
    byTownship: {},
    arrivalsToday: 0,
    departuresToday: 0,
    turnedAwayToday: 0,
    turnedAwayRolling30: 0,
    peakThisYear: 0,
    peakDay: null,
    spendTodayA$: 0,
    pressure: 0,
    capacity: { walkOnSeatsPerDay: 0, vehicleSlotsPerDay: 0, basis: '' },
    beds: { holidayHouses: 0, campsites: 0, hostelAndResort: 0, occupied: 0 },
    manifest: [],
    sample: [],
    baseline: null,
    notes: []
  });

  let R = null;
  let cal = null;
  const archetypes = [];
  const parties = [];
  /** Arrivals booked for today but not yet off the boat. Declared here rather than beside
   *  planArrivals: a const below the register() call is still in its dead zone on the first tick. */
  const pending = [];

  // Accommodation stock, all of it real and all of it finite.
  const campgrounds = [];
  let hostelBeds = 0, hostelUsed = 0;
  let resortRooms = 0, resortUsed = 0;

  let walkOnSeats = 0, vehicleSlots = 0;
  let seatsUsedToday = 0, slotsUsedToday = 0;
  let annualTarget = 375000;
  let calendarMean = 1;
  const turnedAwayLog = [];

  /* -------------------------------------------------------------- reading the packs */

  function readArchetypes(w) {
    const pack = w.data.residents;
    const list = (pack && pack.visitor_archetypes) || [];
    for (const a of list) {
      const size = (a.party && a.party.size) || [2, 4];
      const nights = a.stay && Array.isArray(a.stay.nights) ? a.stay.nights : [0, 0];
      const day = [];
      for (const blk of a.hour_by_hour || []) {
        const from = mins(blk.from), to = mins(blk.to);
        if (from == null || to == null) continue;
        day.push({ from, to, do: blk.do, where: blk.where || null });
      }
      archetypes.push({
        id: a.id,
        label: a.label,
        size,
        meanSize: (size[0] + size[1]) / 2,
        share: (a.arrival && a.arrival.share_of_visitors_estimate) || 0,
        days: (a.arrival && a.arrival.typical_days) || [],
        arriveWindow: a.arrival && a.arrival.typical_time ? a.arrival.typical_time : null,
        seasonality: (a.arrival && a.arrival.seasonality) || [],
        nights,
        vehicle: /with a vehicle|with a 4WD|caravan|ute or truck|wagon/.test((a.arrival && a.arrival.mode) || ''),
        accommodation: (a.stay && a.stay.accommodation) || [],
        spend: a.spend || null,
        wants: a.wants || [],
        friction: a.friction || [],
        day
      });
    }
    const base = pack && pack.visitor_baseline && pack.visitor_baseline.measured_baseline;
    if (base && base.visitors_2018) annualTarget = base.visitors_2018;
    state.baseline = base ? {
      visitors2018: base.visitors_2018,
      medianDaySpendA$: base.median_spend_day_tripper_a$,
      medianOvernightSpendA$: base.median_spend_overnight_a$,
      source: base.source,
      confidence: base.confidence,
      caveat: base.caveat
    } : null;
  }

  function readCapacity(w) {
    const pack = w.data.transport;
    if (!pack || !pack.services) { state.notes.push('data/transport.json is missing: no capacity ceiling.'); return; }
    let seats = 0, slots = 0;
    let flyerSailings = 0;
    for (const svc of pack.services) {
      const cap = svc.capacity;
      const sch = svc.schedule;
      if (!sch || !sch.variants) continue;
      let sailings = 0;
      for (const v of sch.variants) {
        for (const k of ['cleveland_to_dunwich', 'cleveland_to_one_mile']) {
          const arr = v[k];
          if (Array.isArray(arr)) sailings += arr.length;
        }
        if (v.late_service) sailings++;
      }
      if (svc.type === 'vehicle-ferry') {
        const cars = (cap && cap.vessels ? cap.vessels : []).map((x) => x.cars || 0);
        const meanCars = cars.length ? cars.reduce((s, x) => s + x, 0) / cars.length : 52;
        const pax = (cap && cap.vessels ? cap.vessels : []).map((x) => x.passengers || 0);
        const meanPax = pax.length ? pax.reduce((s, x) => s + x, 0) / pax.length : 350;
        slots += Math.round(sailings * meanCars);
        seats += Math.round(sailings * meanPax * 0.5);   // the deck is rarely full of foot passengers
      } else if (svc.type === 'passenger-ferry') {
        const pax = (cap && cap.vessels && cap.vessels[0] && cap.vessels[0].passengers) || 198;
        seats += Math.round(sailings * pax);
      } else if (svc.type === 'water-taxi') {
        flyerSailings += sailings;
      }
    }
    // The Flyer publishes no passenger capacity. The pack says so and leaves it null rather than
    // guessing, so this build models it at the same per-sailing figure as the vessel that does
    // publish one, and says here that it is modelled.
    const modelledFlyer = flyerSailings * 198;
    seats += modelledFlyer;
    walkOnSeats = seats;
    vehicleSlots = slots;
    state.capacity = {
      walkOnSeatsPerDay: seats,
      vehicleSlotsPerDay: slots,
      basis: 'vessel capacities and sailing counts from data/transport.json. The Stradbroke Flyer '
        + 'publishes no passenger capacity, so its share of the walk-on seats is modelled at the '
        + 'same figure as the vessel that does.'
    };
  }

  function readBeds(w) {
    const places = R.places;
    for (const c of CAMPGROUNDS) {
      const rec = places.get(c.id);
      if (!rec) continue;
      campgrounds.push({ id: c.id, label: rec.label, x: rec.x, z: rec.z, sites: c.sites, basis: c.basis, used: 0 });
    }
    // Hostel and resort beds. Sized from the published staffing bands in data/businesses.json,
    // because no bed count is published for any of them; the ratio is a modelling choice.
    for (const b of R.businesses.values()) {
      const t = b.bizType || '';
      if (/hostel/.test(t)) hostelBeds += (b.employs.max || 6) * 5;
      else if (/accommodation-resort|accommodation-apartments|hotel-pub-accommodation/.test(t)) resortRooms += (b.employs.max || 8) * 1.6;
    }
    hostelBeds = Math.round(hostelBeds);
    resortRooms = Math.round(resortRooms);
    state.notes.push('Hostel and resort bed counts are modelled from the published staffing bands in data/businesses.json. No operator publishes a bed count.');
  }

  /* -------------------------------------------------------------- the shape of the year */

  /** Deterministic part of a day's pull for one archetype: the calendar, the weekday and the season. */
  function calendarWeight(a, info, dow) {
    let w = info.loadMultiplier;
    const s = a.seasonality || [];
    if (s.some((x) => /whale/.test(x)) && info.isWhaleSeason) w *= info.whaleMultiplier;
    if (s.some((x) => /winter-school-holidays/.test(x)) && info.schoolBlock === 'winter') w *= 1.3;
    if (s.some((x) => /shoulder/.test(x)) && !info.isSchoolHoliday) w *= 1.35;
    if (s.some((x) => /autumn-and-winter-swell/.test(x))) w = w * 0.55 + 0.9;   // surfers do not follow the school calendar
    if (a.id === 'grey-nomad') w = w * 0.35 + (info.isSchoolHoliday ? 0.6 : 1.5);   // counter-cyclical, on purpose
    if (a.id === 'tradesperson-from-the-mainland') w = info.isSchoolHoliday && info.schoolBlock === 'summer' ? 0.45 : 1.0;
    if (a.id === 'school-group') w = info.isTermTime && dow >= 1 && dow <= 3 ? 2.4 : 0.05;

    // A long weekend is a wave, not a plateau. The published strain is on the Friday afternoon out
    // and the Monday afternoon back, so arrivals front-load hard and all but stop on the last day,
    // when everybody who is here is queueing to leave.
    if (info.isLongWeekend && info.longWeekendLength > 1 && a.nights && a.nights[1] > 0) {
      const t = (info.longWeekendDay - 1) / (info.longWeekendLength - 1);
      w *= 1.75 - 1.55 * t;
    }

    // The weekday shape. Day trippers are a weekend thing, campers and holiday houses arrive on a
    // Friday, tradespeople come Monday to Thursday on the first barge.
    const days = a.days || [];
    const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dow];
    if (days.length && !days.includes('any') && !days.some((d) => String(d).startsWith('any'))) {
      w *= days.includes(key) ? 2.2 : (info.isPublicHoliday && days.includes('public holidays') ? 2.2 : 0.28);
    }
    return Math.max(0, w);
  }

  /** Normalise so a year of these weights sums to the archetype's share of the measured total. */
  function calibrate(w) {
    let sum = 0;
    const start = new Date(w.clock.date.getTime());
    for (let d = 0; d < 365; d++) {
      const date = new Date(start.getTime() + d * 86400000);
      const info = cal.day(date);
      const dow = date.getUTCDay();
      for (const a of archetypes) sum += calendarWeight(a, info, dow) * (a.share / 100);
    }
    calendarMean = sum / 365;
  }

  /* -------------------------------------------------------------- accommodation */

  function takeHolidayHouse() {
    const pool = R.holidayHomes;
    for (let i = 0; i < 12; i++) {
      const d = pool[rng.int(0, pool.length)];
      if (d && !d.occupiedByPartyId) return d;
    }
    for (const d of pool) if (!d.occupiedByPartyId) return d;
    return null;
  }

  function takeCampsite(size) {
    const need = Math.max(1, Math.ceil(size / 4));
    const open = campgrounds.filter((c) => c.used + need <= c.sites);
    if (!open.length) return null;
    const c = open[rng.int(0, open.length)];
    c.used += need;
    return { camp: c, sites: need };
  }

  /* -------------------------------------------------------------- parties */

  const GIVEN = [];
  const SURNAME = [];

  function seedNames(w) {
    const pools = w.data.residents && w.data.residents.name_pools;
    if (!pools) return;
    for (const era of Object.values(pools.given_names || {})) {
      if (Array.isArray(era)) { for (const n of era) GIVEN.push(n); continue; }
      for (const list of Object.values(era)) for (const n of list) GIVEN.push(n);
    }
    for (const s of pools.surnames || []) SURNAME.push(s);
  }

  function makeParty(a, tick, info) {
    const size = rng.int(a.size[0], a.size[1] + 1);
    // Stay length, skewed to the short end. The pack gives a range of two to fourteen nights for a
    // holiday house; drawn flat, that fills every empty house on the island with a fortnight-long
    // booking, and most bookings are a weekend.
    let nights = 0;
    if (Array.isArray(a.nights) && a.nights[1] > 0) {
      const t = rng.float() * rng.float();
      nights = Math.round(a.nights[0] + t * (a.nights[1] - a.nights[0]));
    }

    // Where they will sleep, if anywhere. A party that cannot be accommodated does not come, which
    // is a real constraint and not a rounding error: campgrounds and holiday houses both sell out.
    let stay = null, home = null;
    if (nights > 0) {
      if (a.id === 'family-in-a-holiday-house') {
        const d = takeHolidayHouse();
        if (!d) return null;
        stay = { kind: 'holiday-house', dwellingId: d.id, label: 'a holiday house', x: d.x, z: d.z };
        home = d;
      } else if (a.id === 'weekend-camper' || a.id === 'grey-nomad' || a.id === 'school-group') {
        const c = takeCampsite(size);
        if (!c) return null;
        stay = { kind: 'campground', campId: c.camp.id, sites: c.sites, label: c.camp.label, x: c.camp.x, z: c.camp.z };
      } else if (a.id === 'backpacker' || a.id === 'surfer') {
        if (hostelUsed + size > hostelBeds) {
          const c = takeCampsite(size);
          if (!c) return null;
          stay = { kind: 'campground', campId: c.camp.id, sites: c.sites, label: c.camp.label, x: c.camp.x, z: c.camp.z };
        } else {
          hostelUsed += size;
          const rec = R.businesses.get('manta-lodge-scuba-centre');
          stay = { kind: 'hostel', label: rec ? rec.label : 'the hostel', x: rec ? rec.x : 0, z: rec ? rec.z : 0 };
        }
      } else {
        if (resortUsed + Math.ceil(size / 2) > resortRooms) return null;
        resortUsed += Math.ceil(size / 2);
        stay = { kind: 'room', label: 'a room at Point Lookout', x: 0, z: 0 };
        const rec = R.places.get('point-lookout');
        if (rec) { stay.x = rec.x; stay.z = rec.z; }
      }
    }

    // Names. A party of six is usually two families sharing or three generations, which is two
    // surnames, not six people who all happen to be called the same thing.
    const members = [];
    const surnames = [SURNAME.length ? SURNAME[rng.int(0, SURNAME.length)] : 'Visitor'];
    if (size > 4 && SURNAME.length) surnames.push(SURNAME[rng.int(0, SURNAME.length)]);
    const surname = surnames[0];
    for (let i = 0; i < Math.min(size, 8); i++) {
      const sn = surnames[i < Math.ceil(size / surnames.length) ? 0 : surnames.length - 1];
      members.push({ name: (GIVEN.length ? GIVEN[rng.int(0, GIVEN.length)] : 'Visitor') + ' ' + sn });
    }

    const spend = a.spend && a.spend.per_person_per_day_a$ ? a.spend.per_person_per_day_a$
      : a.spend && a.spend.per_person_a$ ? a.spend.per_person_a$ : [80, 140];

    const id = world.store.create('visitor-party', null);
    const p = {
      id,
      archetype: a.id,
      label: a.label,
      size,
      members,
      surname,
      nights,
      arrivedTick: tick,
      leavesTick: tick + Math.max(6, nights * 144 + rng.int(30, 60)),
      stay,
      dwelling: home,
      vehicle: a.vehicle,
      x: 0, z: 0, tx: 0, tz: 0,
      activity: 'arriving',
      reason: 'off the boat',
      locationId: 'dunwich-ferry-terminal',
      locationLabel: 'the Dunwich terminal',
      spendPerPersonPerDay: rng.range(spend[0], spend[1]),
      satisfaction: 0.7,
      friction: [],
      day: a.day
    };
    if (home) home.occupiedByPartyId = id;
    world.store.set(id, 'visitor', { archetype: a.id, size, x: 0, z: 0 });
    parties.push(p);
    return p;
  }

  function releaseParty(p) {
    if (p.dwelling) p.dwelling.occupiedByPartyId = null;
    if (p.stay) {
      if (p.stay.kind === 'campground') {
        const c = campgrounds.find((x) => x.id === p.stay.campId);
        if (c) c.used = Math.max(0, c.used - p.stay.sites);
      } else if (p.stay.kind === 'hostel') hostelUsed = Math.max(0, hostelUsed - p.size);
      else if (p.stay.kind === 'room') resortUsed = Math.max(0, resortUsed - Math.ceil(p.size / 2));
    }
    world.store.destroy(p.id);
  }

  /* -------------------------------------------------------------- where a party is right now */

  function placeFor(where, p) {
    if (!where) return null;
    if (where === 'accommodation' || where === 'campground') {
      return p.stay ? { id: p.stay.campId || p.stay.kind, label: p.stay.label, x: p.stay.x, z: p.stay.z } : null;
    }
    if (where === 'home-beach') return R.places.get('home-beach');
    const direct = R.places.get(where) || R.places.get('biz:' + where);
    if (direct) return direct;
    const fb = R.places.get(FALLBACK_PLACE[p.archetype] || 'cylinder-beach');
    return fb || null;
  }

  function updateActivity(p, minute, ctx) {
    let block = null;
    for (let i = 0; i < p.day.length; i++) {
      const b = p.day[i];
      if (minute >= b.from && minute < b.to) { block = b; break; }
    }
    if (!block) {
      p.activity = p.stay ? 'back at the accommodation' : 'making their way about';
      p.reason = p.stay ? 'the day is over' : 'between things';
      const at = p.stay ? { label: p.stay.label, id: p.stay.kind, x: p.stay.x, z: p.stay.z } : R.places.get('point-lookout');
      if (at) { p.locationId = at.id; p.locationLabel = at.label; p.tx = at.x; p.tz = at.z; }
      return;
    }
    let text = block.do;
    let where = block.where;

    // The day bends. A closed beach is a closed beach whatever the plan said, and a surfer who came
    // for the swell goes wherever the swell is best rather than where the itinerary says.
    if (!ctx.beachOk && /beach|swim|surf/i.test(text)) {
      text = 'off the beach: the surf is closed';
      where = ctx.raining ? 'point-lookout' : 'north-gorge-walk';
    } else if (ctx.middayHeat && /walk|gorge/i.test(text)) {
      text = 'waiting out the middle of the day in the shade';
      where = 'accommodation';
    } else if (p.archetype === 'surfer' && ctx.surfable) {
      where = ctx.swellM > 2 ? 'south-gorge' : 'main-beach';
      text = `surfing: the swell is ${ctx.swellM.toFixed(1)} metres`;
    } else if (p.archetype === 'whale-watcher' && !ctx.whaleSeason) {
      text = 'looking anyway, out of season';
    }

    const at = placeFor(where, p);
    p.activity = text;
    p.reason = block.do;
    if (at) { p.locationId = at.id; p.locationLabel = at.label; p.tx = at.x; p.tz = at.z; }
  }

  /* -------------------------------------------------------------- the system */

  let lastDay = -1;
  let today = null;
  const dailySpend = [];

  return world.register({
    id: 'visitors',
    phase: 'agents',
    order: 50,

    init(w) {
      R = w.residents;
      if (!R || !R.ready) { state.notes.push('no resident population: visitors have nowhere to stay.'); return; }
      cal = R.calendar || makeCalendar(w.data.events);
      readArchetypes(w);
      readCapacity(w);
      readBeds(w);
      seedNames(w);
      calibrate(w);
      today = cal.day(w.clock.date);
      state.ready = true;
      state.beds = {
        holidayHouses: R.holidayHomes.length,
        campsites: campgrounds.reduce((s, c) => s + c.sites, 0),
        campsitesPublished: campgrounds.filter((c) => c.basis === 'published').reduce((s, c) => s + c.sites, 0),
        hostelAndResort: hostelBeds + resortRooms * 2,
        occupied: 0
      };
      w.bus.emit('visitors:ready', { archetypes: archetypes.length, beds: state.beds, capacity: state.capacity });
    },

    tick(w) {
      if (!state.ready) return;
      const tick = w.clock.tick;
      const minute = w.clock.minuteOfDay;
      const weather = w.read('weather') || {};
      const tide = w.read('tide') || {};
      const day = w.read('daylight') || {};

      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        today = cal.day(w.clock.date);
        seatsUsedToday = 0;
        slotsUsedToday = 0;
        state.arrivalsToday = 0;
        state.departuresToday = 0;
        state.turnedAwayToday = 0;
        turnedAwayLog.push(0);
        if (turnedAwayLog.length > 30) turnedAwayLog.shift();
        planArrivals(w);
      }

      const ctx = {
        beachOk: weather.beachCondition !== 'closed' && (weather.rainMmHr ?? 0) < 2,
        raining: (weather.rainMmHr ?? 0) > 0.6,
        middayHeat: (weather.apparentC ?? 22) > 31 && w.clock.hour > 10 && w.clock.hour < 16,
        swellM: weather.swellM ?? 1,
        surfable: (weather.swellM ?? 1) > 0.6 && (weather.swellM ?? 1) < 3.6,
        whaleSeason: today.isWhaleSeason,
        isDay: !!day.isDay
      };

      // Arrivals due this tick.
      const due = pending;
      for (let i = due.length - 1; i >= 0; i--) {
        if (due[i].at > minute) continue;
        const item = due[i];
        due.splice(i, 1);
        admit(w, item, tick);
      }

      // Live parties.
      let onIsland = 0, spend = 0;
      const byArch = {};
      const byTown = {};
      for (let i = parties.length - 1; i >= 0; i--) {
        const p = parties[i];
        if (tick >= p.leavesTick) {
          parties.splice(i, 1);
          releaseParty(p);
          state.departuresToday += p.size;
          continue;
        }
        updateActivity(p, minute, ctx);
        // Move toward the target. Visitors drive or walk like everybody else.
        const dx = p.tx - p.x, dz = p.tz - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 16) {
          const step = (p.vehicle ? 12 : 1.35) * 600;
          const d = Math.sqrt(d2);
          if (step >= d) { p.x = p.tx; p.z = p.tz; }
          else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
          const comp = w.store.get(p.id, 'visitor');
          if (comp) { comp.x = p.x; comp.z = p.z; }
        }
        onIsland += p.size;
        byArch[p.archetype] = (byArch[p.archetype] || 0) + p.size;
        const t = townshipOf(p);
        byTown[t] = (byTown[t] || 0) + p.size;
        spend += p.size * p.spendPerPersonPerDay / 144;
      }

      state.onIsland = onIsland;
      state.parties = parties.length;
      state.byArchetype = byArch;
      state.byTownship = byTown;
      state.spendTodayA$ = Math.round((state.spendTodayA$ || 0) * (minute === 0 ? 0 : 1) + spend);
      state.beds.occupied = campgrounds.reduce((s, c) => s + c.used, 0);
      // Pressure: how far past the resident population the visitor load has gone. One is parity.
      const residents = (w.read('population') || {}).residents || 2065;
      state.pressure = +(onIsland / Math.max(1, residents)).toFixed(2);
      if (onIsland > state.peakThisYear) {
        state.peakThisYear = onIsland;
        state.peakDay = today.iso;
        if (onIsland > 2500) w.bus.emit('visitors:peak', { onIsland, day: today.iso, pressure: state.pressure });
      }

      if (tick % 6 === 0) {
        // The one number the transport pack says a player should always be able to see: how many
        // vehicle deck slots are left today, and how many walk-on seats.
        const byHour = new Array(24).fill(0);
        for (const item of pending) byHour[Math.min(23, Math.floor(item.at / 60))] += Math.round(item.a.meanSize);
        state.manifest = {
          walkOnSeatsLeft: Math.max(0, walkOnSeats - seatsUsedToday),
          vehicleSlotsLeft: Math.max(0, vehicleSlots - slotsUsedToday),
          stillToArriveToday: pending.reduce((sum, it) => sum + Math.round(it.a.meanSize), 0),
          arrivalsByHour: byHour
        };
        state.sample = parties.slice(0, 24).map((p) => ({
          id: p.id, archetype: p.archetype, label: p.label, size: p.size,
          who: p.members.map((m) => m.name),
          doing: p.activity, at: p.locationLabel,
          nights: p.nights, staying: p.stay ? p.stay.label : 'day trip only',
          leaves: Math.round((p.leavesTick - tick) / 144 * 10) / 10 + ' days'
        }));
        state.turnedAwayRolling30 = turnedAwayLog.reduce((s, v) => s + v, 0);
      }
    },

    describe(w) {
      return {
        onIsland: state.onIsland,
        parties: state.parties,
        pressure: state.pressure,
        arrivals: state.arrivalsToday,
        departures: state.departuresToday,
        turnedAway: state.turnedAwayToday,
        turnedAway30: state.turnedAwayRolling30,
        peak: state.peakThisYear,
        peakDay: state.peakDay,
        campsitesUsed: state.beds.occupied,
        holidayHousesUsed: R ? R.holidayHomes.filter((d) => d.occupiedByPartyId).length : 0,
        byArchetype: state.byArchetype
      };
    },

    save() {
      return {
        v: 2,
        peak: state.peakThisYear,
        peakDay: state.peakDay,
        seatsUsedToday, slotsUsedToday, lastDay,
        arrivalsToday: state.arrivalsToday, departuresToday: state.departuresToday,
        turnedAwayToday: state.turnedAwayToday,
        // What is still booked to come off a boat later today.
        pending: pending.map((x) => [x.a.id, x.at]),
        parties: parties.map((p) => [
          p.archetype, p.size, p.members.map((mm) => mm.name), p.surname, p.nights,
          p.arrivedTick, p.leavesTick, p.stay, Math.round(p.x), Math.round(p.z),
          Math.round(p.spendPerPersonPerDay), p.vehicle ? 1 : 0, p.dwelling ? p.dwelling.id : 0
        ])
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      // Let go of every bed and every barge slot the running parties are holding, then rebuild.
      for (const p of parties) releaseParty(p);
      parties.length = 0;
      for (const c of campgrounds) c.used = 0;
      hostelUsed = 0; resortUsed = 0;
      state.peakThisYear = s.peak || 0;
      state.peakDay = s.peakDay || null;
      seatsUsedToday = s.seatsUsedToday || 0;
      slotsUsedToday = s.slotsUsedToday || 0;
      for (const row of s.parties || []) {
        const [archId, size, names, surname, nights, arrived, leaves, stay, x, z, spend, vehicle, dwellingId] = row;
        const a = archetypes.find((x2) => x2.id === archId);
        if (!a) continue;
        const id = world.store.create('visitor-party', null);
        const dwelling = dwellingId ? R.dwellingsById.get(dwellingId) : null;
        const party = {
          id, archetype: archId, label: a.label, size, members: names.map((n) => ({ name: n })), surname,
          nights, arrivedTick: arrived, leavesTick: leaves, stay, dwelling,
          vehicle: !!vehicle, x, z, tx: x, tz: z,
          activity: 'settling back in', reason: 'restored', locationId: 'point-lookout',
          locationLabel: 'Point Lookout', spendPerPersonPerDay: spend, satisfaction: 0.7,
          friction: [], day: a.day
        };
        if (dwelling) dwelling.occupiedByPartyId = id;
        if (stay && stay.kind === 'campground') {
          const camp = campgrounds.find((cc) => cc.id === stay.campId);
          if (camp) camp.used += stay.sites || 1;
        } else if (stay && stay.kind === 'hostel') hostelUsed += size;
        else if (stay && stay.kind === 'room') resortUsed += Math.ceil(size / 2);
        world.store.set(id, 'visitor', { archetype: archId, size, x, z });
        parties.push(party);
      }
      pending.length = 0;
      for (const [archId, at] of s.pending || []) {
        const a = archetypes.find((x) => x.id === archId);
        if (a) pending.push({ a, at });
      }
      state.arrivalsToday = s.arrivalsToday || 0;
      state.departuresToday = s.departuresToday || 0;
      state.turnedAwayToday = s.turnedAwayToday || 0;
      // The day is already planned, so do not plan it again on the next tick.
      lastDay = s.lastDay !== undefined ? s.lastDay : -1;
    }
  });

  /* -------------------------------------------------------------- arrivals */

  function planArrivals(w) {
    const info = today;
    const dow = w.clock.dayOfWeek;
    const weather = w.read('weather') || {};
    pending.length = 0;

    // Weather. A day tripper who can see rain on the radar does not get on the boat; a surfer does
    // the opposite. This is a multiplier around one so it does not move the annual total much.
    const wet = clamp(1 - (weather.rainMmHr ?? 0) * 0.22, 0.35, 1);
    const windy = clamp(1 - Math.max(0, (weather.windKt ?? 10) - 18) * 0.03, 0.4, 1);
    const cancelled = weather.crossingCondition === 'cancelled';

    for (const a of archetypes) {
      if (cancelled) continue;   // nothing crosses
      let wgt = calendarWeight(a, info, dow) * (a.share / 100);
      if (a.id === 'surfer') {
        const s = weather.swellM ?? 1;
        wgt *= clamp(0.35 + s * 0.9, 0.3, 3.2);
      } else if (a.id === 'day-tripper' || a.id === 'whale-watcher') {
        wgt *= wet * windy;
      } else if (a.id !== 'tradesperson-from-the-mainland') {
        wgt *= 0.6 + 0.4 * wet;
      }
      // The weather response above averages below one over a year, and a party is a rounded
      // number of whole people, so the raw draw lands about fourteen per cent under the measured
      // baseline. This puts it back, so the modelled year sums to the figure the pack publishes
      // rather than to an artefact of how the daily draw is built.
      const perDay = annualTarget * WEATHER_MEAN_CORRECTION * (wgt / Math.max(1e-6, calendarMean)) / 365;
      const people = Math.max(0, perDay * rng.range(0.8, 1.2));
      let partiesWanted = Math.round(people / Math.max(1, a.meanSize));
      const win = arrivalWindow(a);
      for (let i = 0; i < partiesWanted; i++) {
        pending.push({ a, at: Math.round(rng.range(win[0], win[1])) });
      }
    }
    pending.sort((x, y) => y.at - x.at);   // popped from the back, so earliest first
    state.plannedArrivals = pending.length;
  }

  function arrivalWindow(a) {
    const t = a.arriveWindow;
    if (!t) return [8 * 60, 16 * 60];
    if (/first boat/i.test(t)) return [4 * 60 + 45, 7 * 60];
    const m = /(\d{1,2}):(\d{2})\s*[-to]+\s*(\d{1,2}):(\d{2})/.exec(t);
    if (m) return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
    return [9 * 60, 15 * 60];
  }

  /**
   * The capacity gate, and the point of the whole file. There are only so many seats and only so
   * many vehicle slots in a day, and on a long weekend they run out. A party that cannot get on a
   * boat is not quietly deleted: it is counted, because turning people away is the visible failure
   * the events pack asks for at strain level five.
   */
  function admit(w, item, tick) {
    const a = item.a;
    const size = Math.round(a.meanSize);
    const needSlot = a.vehicle;
    if (seatsUsedToday + size > walkOnSeats || (needSlot && slotsUsedToday + 1 > vehicleSlots)) {
      state.turnedAwayToday += size;
      turnedAwayLog[turnedAwayLog.length - 1] += size;
      if (state.turnedAwayToday === size) {
        w.bus.emit('visitors:turned-away', { day: today.iso, archetype: a.id, reason: needSlot ? 'no vehicle slot left on the barge' : 'no seat left on a boat' });
      }
      return;
    }
    const p = makeParty(a, tick, today);
    if (!p) {
      // No bed. Camping and holiday houses both sell out, and a school group needs a campground to
      // itself. This is the other way a visitor does not arrive.
      state.turnedAwayToday += size;
      turnedAwayLog[turnedAwayLog.length - 1] += size;
      return;
    }
    seatsUsedToday += p.size;
    if (needSlot) slotsUsedToday++;
    state.arrivalsToday += p.size;
    const term = R.places.get(a.id === 'surfer' || a.id === 'backpacker' ? 'one-mile-jetty' : 'dunwich-ferry-terminal');
    if (term) { p.x = p.tx = term.x; p.z = p.tz = term.z; }
  }

  function townshipOf(p) {
    let best = 'point-lookout', bd = Infinity;
    for (const t of ['dunwich', 'point-lookout', 'amity-point', 'one-mile']) {
      const seat = R.byTownshipSeat && R.byTownshipSeat[t];
      if (!seat) continue;
      const dx = p.x - seat.x, dz = p.z - seat.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}
