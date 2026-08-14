// The boats. There is no bridge to Minjerribah, so this file is the island's front door.
//
// Every vehicle, every person and all freight crosses Quandamooka (Moreton Bay) by boat, or lands
// on a private aircraft at the Dunwich airfield. data/transport.json states the consequence for the
// simulation in as many words: there is a hard daily import and export ceiling equal to the sum of
// scheduled sailings times their capacity, and no system may exceed it. This file owns that ceiling.
//
// WHAT IS PUBLISHED, AND IS USED LITERALLY
//   The vehicle ferry timetable, both directions, sailing by sailing, with the vessel on each and
//   the days it runs. The two vessel alternating rotation: Minjerribah out of Cleveland at 06:00 is
//   the same boat out of Dunwich at 07:00, with Sea Breeze an hour behind. Vessel capacities:
//   Minjerribah 52 cars and 400 passengers, Sea Breeze 60 and 300, Quandamooka 52 and 400 as the
//   third vessel, Yalingbila 198 passengers on the walk-on run. The 20 minute check-in cut, the
//   100 per cent no-show forfeit, the two hour online change cut-off, and the operator's reserved
//   right to give emergency service vehicles priority. Both walk-on timetables, which the pack
//   shows run to almost identical times into two different Dunwich landings a kilometre apart.
//   Base daily vehicle capacity each way: 560 cars, five Minjerribah sailings at 52 plus five Sea
//   Breeze sailings at 60.
//
// WHAT IS MODELLED, AND IS LABELLED MODELLED EVERYWHERE IT SHOWS
//   The demand. The Toondah marshalling yard capacity of 110 vehicles, which the pack itself calls
//   "the single number in this pack most likely to be wrong" and which drives all the spillover.
//   The peak day's extra sailings, taken verbatim from the pack's own worked scenario rather than
//   invented here. The wind thresholds, because no published wind cut-off for this route was found.
//   The Stradbroke Flyer's passenger capacity, which is not published at all and is read from
//   data/transport.json as one declared modelled number rather than being guessed twice.
//   The share of a crossing each walk-on operator takes when both leave at the same minute.
//
// THREE OPERATORS, NOT TWO, AND THEY ARE NOT INTERCHANGEABLE
//   Corrected 14 August 2026 after the owner, who lives there, said the Straddie Flyer is the family
//   owned passenger ferry to One Mile and must not be folded into SeaLink. Three things in this file
//   had folded it in and each was a real defect rather than a wording problem.
//
//   1. Walk-on freight rode any walk-on sailing, the Flyer included. The rule it was implementing is
//      SeaLink's own term and condition, about SeaLink's own passenger service: on this route walk-on
//      freight is permitted on the passenger ferry service only. Nothing published says the Flyer
//      carries unaccompanied freight, so applying a competitor's term to it was inventing a service.
//   2. The Flyer's sailings carried the literal string 'flyer' where every other sailing carries a
//      vessel name, and src/ui/panels/events.js prints that field, so a player read "flyer" as the
//      name of a boat. The operator publishes a fleet, the Calypso and the Legacy, and does not
//      publish which one runs a given departure, so this file names the service and not a vessel.
//   3. Both walk-on boats drew a full independent load at the same minute, so the island imported
//      one crossing's worth of people twice. data/transport.json has always said what to do instead:
//      split walk-on demand between the two by destination preference, not by time. It does that now,
//      and the two afternoon departures where the Flyer runs alone are worth what the pack says they
//      are worth, because on those it takes the whole slot.
//
// WHAT IS DELIBERATELY NOT MODELLED
//   Swell on the crossing. The pack is explicit: Minjerribah and Moorgumpin shelter the whole route
//   and swell belongs to the beaches, not to the barge. A tide gate on the barge, for the same
//   reason: whether the Toondah channel or the Dunwich apron restricts the vehicle ferry could not
//   be verified, and the pack says do not model one until a local or the operator confirms it.
//
// Reads: weather, tide, population.today (the calendar), visitors, prices.
// Publishes: ferry. Emits: ferry:day ferry:departed ferry:arrived ferry:cancelled ferry:delayed
//            ferry:queue-spill ferry:standby-missed ferry:rolled ferry:stranded ferry:sold-out
//            ferry:vessel-down ferry:vessel-back ferry:emergency-priority ferry:freight-spoiled

import { makeCalendar } from '../agents/calendar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const mins = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/**
 * The peak day. data/transport.json publishes an extended Friday as a worked scenario with its
 * arithmetic on show: three extra Quandamooka sailings, one extra Minjerribah, fifteen sailings and
 * 820 car slots. It says plainly that SeaLink publishes peak timetables per period and that this is
 * one plausible extended day, not the real one. It is used here exactly as published, so the numbers
 * in this simulation can be checked against the numbers in the pack line by line.
 */
const PEAK_EXTRAS_WESTBOUND = [
  { time: '09:00', vessel: 'quandamooka' },
  { time: '11:30', vessel: 'quandamooka' },
  { time: '14:30', vessel: 'quandamooka' },
  { time: '17:30', vessel: 'quandamooka' },
  { time: '18:30', vessel: 'minjerribah' }
];

/**
 * Which days of the week the barge is busiest. Published: "Public holidays, school holidays,
 * Fridays and Sundays are the busiest times to travel." The shape below is modelled to that
 * statement and normalised so an ordinary week averages one.
 */
const DOW_DEMAND = { sun: 1.05, mon: 0.94, tue: 0.84, wed: 0.84, thu: 0.95, fri: 1.25, sat: 1.10 };

/** Base ordinary-Friday load: the pack models a normal Friday at 85 per cent of the 560 slots. */
const BASE_PRESENTING = 476;

/** Published and modelled queue parameters, kept together so the read model can show their basis. */
const QUEUE = {
  yardCapacity: 110,
  yardBasis: 'MODELLED and UNVERIFIED. No lane count or yard capacity is published for Toondah '
    + 'Harbour. data/transport.json calls this the single number most likely to be wrong, and it '
    + 'drives every spillover in this file.',
  checkInCutMin: 20,
  checkInBasis: 'published: SeaLink reserves the right to refuse boarding for vehicles that check in '
    + 'less than 20 minutes before departure',
  noShowRate: 0.03,
  noShowBasis: 'modelled, kept low because a no-show forfeits 100 per cent of the fare',
  soldInAdvance: 0.92,
  earlyArrivalShare: 0.16,
  loadMinPerSailing: [12, 20],
  spillStreet: 'Middle Street'
};

/**
 * Which walk-on operator a crossing's passengers pick when both boats leave at the same minute.
 * data/transport.json states the behaviour and this file supplies the number: "They compete head to
 * head on the same departures to two different Dunwich landings, so the choice a walk-on passenger
 * makes is mostly about which side of Dunwich they want to arrive at, not about time."
 *
 * The share is MODELLED and nobody has counted it. The reasoning, so it can be argued with: Junner
 * Street is the barge apron, the ticket office, the bus interchange and the shops end of the
 * township, and One Mile is a jetty about a kilometre north at the anchorage, so the larger share
 * goes to the landing with more reasons to be at it. Both are timing points on both bus routes, so
 * this is not a bus-connection advantage, which is why the split is close to even.
 *
 * It only applies where two services leave in the same minute in the same direction. Where one runs
 * alone it takes the whole crossing, which is exactly the pack's point about the Flyer's 16:45 and
 * 18:00 westbound being the one place where the time genuinely differs.
 */
const WALK_ON_SHARE = {
  'svc-sealink-passenger-ferry': 0.55,
  'svc-stradbroke-flyer': 0.45,
  basis: 'MODELLED. No count of how walk-on passengers split between the two operators exists. '
    + 'Weighted toward the Junner Street landing because the terminal, the ticket office, the barge '
    + 'apron and the township centre are there. A local settles this in one sentence.'
};

/** Wind. No published threshold for this route was found, so both figures are modelled and say so. */
const WIND = {
  vehicleSlowKt: 25,
  vehicleCancelKt: 35,
  walkOnOffsetKt: 5,
  basis: 'MODELLED. No published wind threshold for this crossing was found. The operator\'s terms '
    + 'only say services are subject to alteration, sometimes without notice. The walk-on boats are '
    + 'given a threshold five knots lower because a 24 m catamaran slows in bay chop before a 60 car '
    + 'barge does.'
};

export function registerFerry(world) {
  const rng = world.rng.stream('ferry');

  const state = world.publish('ferry', {
    ready: false,
    source: 'data/transport.json services, published timetables and capacities',
    today: null,
    deck: {
      slotsToday: 0, slotsLeftToday: 0, carriedToday: 0, soldToday: 0,
      basis: 'published sailing list times published vessel capacities'
    },
    walkOn: { seatsToday: 0, seatsLeftToday: 0, carriedToday: 0, turnedAwayToday: 0 },
    importCeiling: { carsEachWay: 0, walkOnSeatsEachWay: 0, basis: '', rule: '' },
    sailings: [],
    next: { toIsland: null, toMainland: null, walkOnToIsland: null, walkOnToMainland: null },
    // Everything still to come today on each of the four lines, in order, so a screen can say "then
    // 17:30, 18:45, 19:45" instead of only the next one. `next.X` is simply `remaining.X[0]` and is
    // kept because half a dozen readers already take it.
    remaining: { toIsland: [], toMainland: [], walkOnToIsland: [], walkOnToMainland: [] },
    // The first published departure on each line tomorrow, so a line with nothing left today has
    // somewhere to send a person instead of stopping at "nothing more today". Straight off the
    // committed timetable for tomorrow's day of the week: no modelled peak extras are in it.
    tomorrowFirst: { toIsland: null, toMainland: null, walkOnToIsland: null, walkOnToMainland: null },
    vessels: [],
    toondah: {
      presentedToday: 0, inYard: 0, yardCapacity: QUEUE.yardCapacity, yardBasis: QUEUE.yardBasis,
      spilled: 0, spilledPeak: 0, spillWindow: null, saturatedFrom: null, clearsAt: null,
      standbyWaiting: 0, standbyServedToday: 0, notCarriedToday: 0, rolledToTomorrow: 0,
      waitMedianMin: 0, waitP90Min: 0, longestWaitMin: 0
    },
    // Four places, because there are four landings and not three. The Flyer runs its own terminal on
    // Emmett Drive at Cleveland, a few hundred metres from SeaLink's, and its own jetty at One Mile a
    // kilometre north of Junner Street. Somebody left standing is left standing somewhere specific.
    stranded: { atToondah: 0, atFlyerTerminal: 0, atDunwich: 0, atOneMile: 0, story: null },
    cancellations: { today: 0, reason: null, rolling30: 0, lastCancelled: null },
    reliability: { windKt: 0, condition: 'good', slowKt: WIND.vehicleSlowKt, cancelKt: WIND.vehicleCancelKt, basis: WIND.basis, delayMinNow: 0 },
    freight: { waitingItems: 0, spoiledToday: 0, note: 'On this route walk-on freight rides the passenger ferry, not the barge.' },
    scenario: null,
    notes: []
  });

  let cal = null;
  const svc = { vehicle: null, passenger: null, flyer: null };
  const vessels = new Map();
  // Vehicle vessel ids that appear in today's sailing list. See mechanical().
  const rosteredToday = new Set();
  let flyerSeats = 0;
  /** How a sailing is labelled when its operator does not publish which vessel runs it. */
  const serviceLabel = new Map();
  /** Which walk-on services this pack actually carries, so the share is never assumed. */
  const walkOnServices = new Set();

  /** Today's sailings, rebuilt at midnight. */
  let sailings = [];
  /** Vehicles waiting at Toondah, in ten minute cohorts so a whole day is a hundred small records. */
  let yard = [];
  let dayStats = null;
  const rolling = { cancel30: [], carried30: [] };
  let carryOver = 0;             // vehicles rolled from yesterday
  let freightWaiting = 0;

  const nowMin = (w) => w.clock.dayIndex * 1440 + w.clock.minuteOfDay;

  /* ---------------------------------------------------------------- reading the pack */

  function readPack(w) {
    const pack = w.data && w.data.transport;
    if (!pack || !Array.isArray(pack.services)) {
      state.notes.push('data/transport.json is missing or has no services: there are no boats.');
      return false;
    }
    for (const s of pack.services) {
      if (s.type === 'vehicle-ferry') svc.vehicle = s;
      else if (s.type === 'passenger-ferry') svc.passenger = s;
      else if (s.type === 'water-taxi') svc.flyer = s;
    }
    if (!svc.vehicle) { state.notes.push('no vehicle ferry in the pack.'); return false; }

    for (const v of (svc.vehicle.capacity && svc.vehicle.capacity.vessels) || []) {
      vessels.set(v.id, {
        id: v.id, name: v.name, cars: v.cars || 0, passengers: v.passengers || 0,
        role: v.role || 'base timetable', built: v.built || null,
        status: 'in service', where: 'cleveland', outUntilMin: 0, reason: null,
        sailingsToday: 0, carsToday: 0
      });
    }
    for (const v of (svc.passenger && svc.passenger.capacity && svc.passenger.capacity.vessels) || []) {
      vessels.set(v.id, {
        id: v.id, name: v.name, cars: 0, passengers: v.passengers || 0,
        role: 'walk-on', built: v.built || null,
        status: 'in service', where: 'cleveland', outUntilMin: 0, reason: null,
        sailingsToday: 0, carsToday: 0
      });
    }
    // A service whose operator does not publish which vessel runs a given departure is labelled by
    // its own short name, never by its slug. The Stradbroke Flyer publishes a fleet, the Calypso and
    // the Legacy, and says which one runs depends on requirements, so inventing a roster here would
    // put a boat name on a screen that nobody published. Before this, its sailings carried the
    // string 'flyer' and the events panel printed it as a vessel name.
    for (const s of [svc.vehicle, svc.passenger, svc.flyer]) {
      if (!s) continue;
      serviceLabel.set(s.id, (Array.isArray(s.also_known_as) && s.also_known_as[0]) || s.name || s.id);
    }
    if (svc.passenger) walkOnServices.add(svc.passenger.id);
    if (svc.flyer) walkOnServices.add(svc.flyer.id);

    // The Flyer publishes no passenger capacity anywhere a fetch could read it. The pack now carries
    // the modelled figure once, with its basis, so this file and src/systems/agents/visitors.js read
    // the same number instead of guessing separately. It is deliberately not SeaLink's published 198.
    const fc = svc.flyer && svc.flyer.capacity;
    flyerSeats = (fc && Number(fc.modelled_passengers_per_sailing)) || 120;
    state.notes.push('Stradbroke Flyer passenger capacity is MODELLED at ' + flyerSeats
      + ' per sailing, read from data/transport.json capacity.modelled_passengers_per_sailing. The '
      + 'operator does not publish it and the pack says to ask the office on (07) 3821 3821 rather '
      + 'than guess, so this number is on show and is not treated as fact. It is not set equal to '
      + 'the 198 SeaLink publishes for Yalingbila: that is a different company\'s boat.');
    state.notes.push('Walk-on demand at a shared departure minute is split '
      + Math.round(WALK_ON_SHARE['svc-sealink-passenger-ferry'] * 100) + '/'
      + Math.round(WALK_ON_SHARE['svc-stradbroke-flyer'] * 100)
      + ' between the Junner Street and One Mile landings. ' + WALK_ON_SHARE.basis);

    const dc = svc.vehicle.schedule && svc.vehicle.schedule.variants
      && svc.vehicle.schedule.variants[0]
      && svc.vehicle.schedule.variants[0].daily_capacity_each_way_cars;
    state.importCeiling = {
      carsEachWay: dc ? dc.mon_to_sat : 560,
      walkOnSeatsEachWay: 0,
      basis: dc ? dc.derivation : 'derived from the published sailing list and vessel capacities',
      rule: 'There is no bridge. Nothing may cross that a scheduled sailing did not carry.'
    };
    return true;
  }

  /* ---------------------------------------------------------------- today's timetable */

  function buildDay(w) {
    rosteredToday.clear();
    const dow = DOW[w.clock.dayOfWeek];
    const info = cal ? cal.day(w.clock.date) : null;
    const peak = !!(info && (info.isSchoolHoliday || info.isLongWeekend || info.isPublicHoliday));
    const v = svc.vehicle.schedule.variants[0];
    const out = [];
    let seq = 0;

    const runsToday = (entry) => !entry.days || entry.days.includes(dow);

    const push = (dir, timeStr, vesselId, kind, extra, service) => {
      const t = mins(timeStr);
      if (t == null) return;
      const ves = vessels.get(vesselId);
      if (kind === 'vehicle' && ves) rosteredToday.add(ves.id);
      out.push({
        id: 's' + (seq++),
        service,
        dir,                              // 'to-island' | 'to-mainland'
        time: timeStr,
        timeMin: t,
        vessel: vesselId,
        vesselName: ves ? ves.name : (serviceLabel.get(service) || vesselId),
        vesselPublished: !!ves,
        kind,                             // 'vehicle' | 'walk-on'
        capacityCars: ves ? ves.cars : 0,
        capacityPax: kind === 'walk-on' && !ves ? flyerSeats : (ves ? ves.passengers : 0),
        demandShare: 1,                   // set below, once both walk-on lists are in
        extra: !!extra,
        booked: 0, standbyTaken: 0, emergencyTaken: 0,
        carsCarried: 0, paxCarried: 0, paxTurnedAway: 0,
        status: 'scheduled', delayMin: 0, why: null,
        departedAt: null, arrivesAt: null
      });
    };

    for (const e of v.cleveland_to_dunwich || []) if (runsToday(e)) push('to-island', e.time, e.vessel, 'vehicle', false, 'svc-vehicle-ferry');
    for (const e of v.dunwich_to_cleveland || []) if (runsToday(e)) push('to-mainland', e.time, e.vessel, 'vehicle', false, 'svc-vehicle-ferry');

    if (peak) {
      // The published rotation says a Cleveland departure is the same vessel out of Dunwich about
      // an hour later, so the extras are mirrored on that rule rather than on a second guess.
      for (const e of PEAK_EXTRAS_WESTBOUND) {
        push('to-island', e.time, e.vessel, 'vehicle', true, 'svc-vehicle-ferry');
        push('to-mainland', hhmm(mins(e.time) + 60), e.vessel, 'vehicle', true, 'svc-vehicle-ferry');
      }
    }

    // Walk-on boats. The two operators run to nearly identical times into two different landings,
    // so both are carried: the choice a passenger makes is which side of Dunwich they want.
    const walkOn = (service, list, dir, vesselId) => {
      for (const t of list || []) push(dir, t, vesselId, 'walk-on', false, service);
    };
    if (svc.passenger) {
      const pv = svc.passenger.schedule.variants[0];
      walkOn('svc-sealink-passenger-ferry', pv.cleveland_to_dunwich, 'to-island', 'yalingbila');
      walkOn('svc-sealink-passenger-ferry', pv.dunwich_to_cleveland, 'to-mainland', 'yalingbila');
      const late = pv.late_service;
      if (late && (!late.days || late.days.includes(dow))) {
        walkOn('svc-sealink-passenger-ferry', [late.cleveland_to_dunwich], 'to-island', 'yalingbila');
        walkOn('svc-sealink-passenger-ferry', [late.dunwich_to_cleveland], 'to-mainland', 'yalingbila');
      }
    }
    if (svc.flyer) {
      const fv = svc.flyer.schedule.variants[0];
      walkOn('svc-stradbroke-flyer', fv.cleveland_to_one_mile, 'to-island', 'flyer');
      walkOn('svc-stradbroke-flyer', fv.one_mile_to_cleveland, 'to-mainland', 'flyer');
    }

    out.sort((a, b) => a.timeMin - b.timeMin || (a.id < b.id ? -1 : 1));

    // One crossing, two operators. Where both walk-on services leave in the same minute in the same
    // direction they are competing for the same people, so the slot's demand is split between them
    // rather than each drawing a full independent load. Where one runs alone it takes the slot.
    // data/transport.json: "the choice a walk-on passenger makes is mostly about which side of
    // Dunwich they want to arrive at, not about time."
    const slot = new Map();
    for (const s of out) {
      if (s.kind !== 'walk-on') continue;
      const key = s.dir + '@' + s.timeMin;
      if (!slot.has(key)) slot.set(key, []);
      slot.get(key).push(s);
    }
    for (const group of slot.values()) {
      if (group.length < 2) { group[0].demandShare = 1; continue; }
      let total = 0;
      for (const s of group) total += (WALK_ON_SHARE[s.service] || 0);
      for (const s of group) {
        // Normalised, so a pack that adds a third walk-on operator does not silently lose passengers.
        s.demandShare = total > 0 ? (WALK_ON_SHARE[s.service] || 0) / total : 1 / group.length;
      }
    }

    sailings = out;

    for (const ves of vessels.values()) { ves.sailingsToday = 0; ves.carsToday = 0; }

    // The day's demand. The published statement is that Fridays, Sundays, public holidays and
    // school holidays are the busiest; the arithmetic below turns that into a number and shows it.
    const dowFactor = DOW_DEMAND[dow] || 1;
    const load = info ? info.loadMultiplier : 1;
    const holidayFactor = 1 + (load - 1) * 0.55;
    let presenting = Math.round(BASE_PRESENTING * dowFactor * holidayFactor);
    // The pack's own scenario: a long weekend Friday presents 1050 vehicles westbound.
    const isLongWeekendFriday = !!(info && info.isLongWeekend && info.longWeekendDay === 1 && w.clock.dayOfWeek === 5);
    presenting += carryOver;

    const westbound = out.filter((s) => s.dir === 'to-island' && s.kind === 'vehicle');
    const slots = westbound.reduce((s2, x) => s2 + x.capacityCars, 0);
    const walkSeats = out.filter((s) => s.dir === 'to-island' && s.kind === 'walk-on').reduce((s2, x) => s2 + x.capacityPax, 0);

    dayStats = {
      dow, peak, isLongWeekendFriday,
      presentingTarget: presenting,
      presented: 0, carried: 0, booked: 0, standbyServed: 0, notCarried: 0,
      slots, walkSeats,
      waits: [], waitWeights: [],
      spillFrom: null, spillTo: null, spilledPeak: 0, saturatedFrom: null, clearsAt: null,
      cancelled: 0, cancelReason: null,
      paxCarried: 0, paxTurnedAway: 0
    };
    yard = [];
    carryOver = 0;

    state.today = {
      iso: info ? info.iso : w.clock.formatDate(),
      day: w.clock.formatDate(),
      peakTimetable: peak,
      peakBasis: peak
        ? 'MODELLED extended day, taken verbatim from the worked scenario in data/transport.json. '
          + 'SeaLink publishes the real peak timetable per period.'
        : 'published base timetable',
      isLongWeekend: !!(info && info.isLongWeekend),
      longWeekendAnchor: info ? info.longWeekendAnchor : null,
      isSchoolHoliday: !!(info && info.isSchoolHoliday),
      loadMultiplier: info ? info.loadMultiplier : 1,
      vehiclesExpectedWestbound: presenting,
      demandBasis: `${BASE_PRESENTING} base times ${dowFactor.toFixed(2)} for ${dow} times `
        + `${holidayFactor.toFixed(2)} for the calendar`
    };
    state.deck.slotsToday = slots;
    state.deck.slotsLeftToday = slots;
    state.deck.carriedToday = 0;
    state.deck.soldToday = 0;
    state.walkOn.seatsToday = walkSeats;
    state.walkOn.seatsLeftToday = walkSeats;
    state.walkOn.carriedToday = 0;
    state.walkOn.turnedAwayToday = 0;
    state.importCeiling.walkOnSeatsEachWay = walkSeats;
    state.cancellations.today = 0;
    state.cancellations.reason = null;
    state.freight.spoiledToday = 0;
    state.toondah.presentedToday = 0;
    state.toondah.spilled = 0;
    state.toondah.spilledPeak = 0;
    state.toondah.spillWindow = null;
    state.toondah.saturatedFrom = null;
    state.toondah.clearsAt = null;
    state.toondah.standbyServedToday = 0;
    state.toondah.notCarriedToday = 0;
    state.toondah.rolledToTomorrow = 0;
    state.toondah.longestWaitMin = 0;

    w.bus.emit('ferry:day', {
      sailingsWestbound: westbound.length,
      slots,
      expected: presenting,
      peak,
      text: peak
        ? `${westbound.length} westbound sailings today, ${slots} car slots, about ${presenting} vehicles expected.`
        : `${westbound.length} westbound sailings today, ${slots} car slots.`
    });

    // The board, before anything ticks. See publishBoard for why this line matters more than it looks.
    publishBoard(w.clock.minuteOfDay);
  }

  /* ---------------------------------------------------------------- the arrival profile

  When the vehicles turn up. The pack publishes an hour by hour arrival profile for the long weekend
  Friday scenario and it is used directly on that day. Every other day gets a modelled shape with
  the same character: a morning tail, a heavy middle afternoon, and a run for the last boat. */

  const PEAK_PROFILE = [
    { from: 300, to: 480, share: 90 / 1050 },
    { from: 480, to: 600, share: 95 / 1050 },
    { from: 600, to: 720, share: 130 / 1050 },
    { from: 720, to: 840, share: 200 / 1050 },
    { from: 840, to: 960, share: 285 / 1050 },
    { from: 960, to: 1140, share: 250 / 1050 }
  ];

  function arrivalShare(minute, peak) {
    if (peak) {
      for (const w2 of PEAK_PROFILE) {
        if (minute >= w2.from && minute < w2.to) return w2.share / ((w2.to - w2.from) / 10);
      }
      return 0;
    }
    // Ordinary day: three humps, tied to the sailing pattern rather than to a smooth curve.
    if (minute < 300 || minute >= 1080) return 0;
    const h = minute / 60;
    const g = (c, s) => Math.exp(-((h - c) * (h - c)) / (2 * s * s));
    const shape = 0.9 * g(7.2, 1.1) + 1.0 * g(11.5, 1.7) + 1.25 * g(15.6, 1.5);
    return shape * 0.0125;
  }

  /* ---------------------------------------------------------------- the crossing */

  function windEffect(w) {
    const weather = w.read('weather') || {};
    const kt = weather.windKt || 0;
    const cond = weather.crossingCondition || 'good';
    let delay = 0;
    if (kt > WIND.vehicleSlowKt) delay = Math.round(5 + (kt - WIND.vehicleSlowKt) * 0.7);
    state.reliability.windKt = +kt.toFixed(1);
    state.reliability.condition = cond;
    state.reliability.delayMinNow = delay;
    return { kt, cond, delay };
  }

  /** Does this sailing run? Wind, and whether its vessel is in the water. */
  function decideCancellation(w, s, wind) {
    const ves = vessels.get(s.vessel);
    if (ves && ves.status !== 'in service') {
      return `${ves.name} is out of service: ${ves.reason}`;
    }
    const threshold = s.kind === 'walk-on' ? WIND.vehicleCancelKt - WIND.walkOnOffsetKt : WIND.vehicleCancelKt;
    if (wind.kt >= threshold) {
      // Above the threshold the chance rises with the wind rather than switching on.
      const p = clamp((wind.kt - threshold) / 12, 0.25, 0.98);
      if (rng.float() < p) return `${Math.round(wind.kt)} knots across the bay`;
    }
    if (wind.cond === 'cancelled' && s.kind === 'walk-on' && rng.float() < 0.7) {
      return 'the crossing was called off';
    }
    return null;
  }

  /* ---------------------------------------------------------------- the Toondah queue

  Two queues, not one, exactly as the pack describes them. A booked queue that is orderly, and a
  standby queue that is not, and the standby queue is where the anger lives. */

  function presentVehicles(w, minute) {
    if (!dayStats) return;
    const share = arrivalShare(minute, dayStats.peak);
    if (share <= 0) return;
    let n = dayStats.presentingTarget * share;
    // Deterministic rounding with a carried fraction, so a whole day sums to the target.
    n += presentVehicles.carry || 0;
    const whole = Math.floor(n);
    presentVehicles.carry = n - whole;
    if (whole <= 0) return;
    const booked = Math.round(whole * QUEUE.soldInAdvance);
    yard.push({ at: minute, count: whole, booked, standby: whole - booked, waited: 0 });
    dayStats.presented += whole;
    state.toondah.presentedToday = dayStats.presented;
  }
  presentVehicles.carry = 0;

  function yardCount() {
    let n = 0;
    for (const c of yard) n += c.count;
    return n;
  }

  /**
   * The check-in cut, twenty minutes before a sailing. Booked vehicles that are here get on.
   * A no-show forfeits the whole fare and releases a slot to standby, which is the one moment in
   * the day when a standby driver's afternoon turns around.
   */
  function runCheckIn(w, s, minute) {
    let free = s.capacityCars;

    // Published: SeaLink reserves the right to prioritise emergency service vehicles. When it
    // happens it displaces booked cars from a sold-out sailing, and those drivers are angry at
    // something that is nobody's fault.
    if (rng.float() < 0.012) {
      const take = 2 + rng.int(0, 3);
      s.emergencyTaken = take;
      free -= take;
      w.bus.emit('ferry:emergency-priority', {
        sailing: s.time, vessel: s.vesselName, displaced: take,
        source: 'data/transport.json structural_facts.emergency-vehicles-jump-the-queue',
        text: `An emergency service vehicle took priority on the ${s.time} barge. ${take} booked cars `
          + 'rolled to the next sailing.'
      });
    }

    // Booked first, oldest cohort first.
    let bookedBoarded = 0;
    for (const c of yard) {
      if (free <= 0) break;
      if (c.booked <= 0) continue;
      const take = Math.min(c.booked, free);
      c.booked -= take; c.count -= take; free -= take;
      bookedBoarded += take;
      recordWait(minute - c.at, take);
    }
    // No-shows on the slots that were sold but whose driver never presented.
    const soldButAbsent = Math.max(0, Math.round(s.capacityCars * QUEUE.soldInAdvance) - bookedBoarded);
    const released = Math.round(soldButAbsent * QUEUE.noShowRate) + free;

    // Standby, oldest first. This is the queue with no reservation to fall back on.
    let standbyBoarded = 0;
    let left = Math.max(0, released);
    for (const c of yard) {
      if (left <= 0) break;
      if (c.standby <= 0) continue;
      const take = Math.min(c.standby, left);
      c.standby -= take; c.count -= take; left -= take;
      standbyBoarded += take;
      recordWait(minute - c.at, take);
    }
    for (let i = yard.length - 1; i >= 0; i--) if (yard[i].count <= 0) yard.splice(i, 1);

    s.booked = bookedBoarded;
    s.standbyTaken = standbyBoarded;
    s.carsCarried = bookedBoarded + standbyBoarded;
    dayStats.booked += bookedBoarded;
    dayStats.standbyServed += standbyBoarded;
    dayStats.carried += s.carsCarried;

    if (standbyBoarded > 0) {
      w.bus.emit('ferry:standby-lucky', { sailing: s.time, vehicles: standbyBoarded, vessel: s.vesselName });
    }
    if (s.carsCarried >= s.capacityCars) {
      w.bus.emit('ferry:sold-out', { sailing: s.time, vessel: s.vesselName, cars: s.carsCarried });
    }
  }

  function recordWait(minutes, weight) {
    if (!dayStats) return;
    dayStats.waits.push(Math.max(0, minutes));
    dayStats.waitWeights.push(weight);
    if (minutes > state.toondah.longestWaitMin) state.toondah.longestWaitMin = Math.round(minutes);
  }

  function weightedPercentile(values, weights, p) {
    if (!values.length) return 0;
    const idx = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    let total = 0;
    for (const wgt of weights) total += wgt;
    let acc = 0;
    for (const i of idx) {
      acc += weights[i];
      if (acc >= total * p) return Math.round(values[i]);
    }
    return Math.round(values[idx[idx.length - 1]]);
  }

  /* ---------------------------------------------------------------- walk-on passengers */

  /**
   * How many people want this particular boat. Split out so a cancelled sailing strands the load it
   * would have carried rather than a number drawn out of the air, and so the two operators split one
   * crossing rather than each importing a full one. Draws from the ferry stream exactly once, which
   * is what it did before, so a cancelled sailing and a sailed one cost the same in rng draws.
   */
  function walkOnDemand(w, s) {
    const vis = w.read('visitors') || {};
    const sched = w.read('schedule') || {};
    // Demand for a walk-on sailing: the school and commuter block on the early boats, the day
    // tripper wave through the middle of the day, and the run for the last boat home.
    const info = state.today || {};
    const h = s.timeMin / 60;
    let base = 26;
    if (h < 7.5) base = s.dir === 'to-mainland' ? 62 : 18;         // students and commuters out
    else if (h < 11) base = s.dir === 'to-island' ? 78 : 26;
    else if (h < 15) base = 58;
    else if (h < 18.5) base = s.dir === 'to-mainland' ? 84 : 40;
    else base = s.dir === 'to-mainland' ? 46 : 22;
    const load = (info.loadMultiplier || 1);
    let want = Math.round(base * (0.75 + 0.55 * load) * (0.85 + rng.float() * 0.35));
    if (vis.pressure) want = Math.round(want * clamp(0.8 + vis.pressure * 0.5, 0.8, 2.2));

    // An event does not just add people to a day, it puts them on particular boats. A dawn surf
    // contest fills the early sailings out of Cleveland and empties the island in one hour after
    // the last heat; an evening concert cannot draw a day tripper at all, because the last water
    // taxi home beats the encore. The shape comes from each record's own crowd curve in
    // data/events.json, resolved by src/systems/agents/calendar.js.
    const events = info.events || [];
    if (events.length) {
      let pull = 0;
      for (const ev of events) {
        if (!ev.curve || ev.peak < 100) continue;
        const rise = ev.curve[Math.max(0, Math.floor(h) - 1)] || 0;
        const now = ev.curve[Math.min(23, Math.floor(h))] || 0;
        const later = ev.curve[Math.min(23, Math.floor(h) + 1)] || 0;
        // Toward the island while the curve is climbing, toward the mainland while it falls.
        const climbing = Math.max(0, now - rise);
        const falling = Math.max(0, now - later);
        const share = s.dir === 'to-island' ? climbing : falling;
        pull += ev.peak * ev.incrementShare * share * 0.5;
      }
      if (pull > 0) want += Math.round(pull);
    }
    void sched;

    // The two walk-on operators at the same minute are one crossing, not two.
    return Math.max(0, Math.round(want * (s.demandShare == null ? 1 : s.demandShare)));
  }

  function runWalkOn(w, s, minute) {
    const want = walkOnDemand(w, s);
    const cap = s.capacityPax || flyerSeats;
    const carried = Math.min(cap, want);
    s.paxCarried = carried;
    s.paxTurnedAway = Math.max(0, want - cap);
    dayStats.paxCarried += carried;
    dayStats.paxTurnedAway += s.paxTurnedAway;
    state.walkOn.carriedToday += carried;
    state.walkOn.seatsLeftToday = Math.max(0, state.walkOn.seatsLeftToday - carried);
    state.walkOn.turnedAwayToday += s.paxTurnedAway;

    if (s.paxTurnedAway > 0) {
      w.bus.emit('ferry:overflow', {
        service: s.service, sailing: s.time, people: s.paxTurnedAway,
        operator: s.vesselName,
        landing: s.dir === 'to-island'
          ? (s.service === 'svc-stradbroke-flyer' ? 'One Mile Jetty' : 'Junner Street')
          : 'Cleveland',
        waitMin: 75,
        text: `${s.paxTurnedAway} people did not fit on the ${s.time} ${s.vesselName}. The next one `
          + 'is about seventy five minutes away.'
      });
    }
    // Walk-on freight rides the passenger boat on this route, not the barge. Note whose passenger
    // boat: the rule is SeaLink's own term and condition about SeaLink's own service, that on this
    // route walk-on freight is permitted on the passenger ferry service only, may travel
    // unaccompanied and is charged per item. The Stradbroke Flyer is a different company and
    // publishes no unaccompanied freight service, so applying SeaLink's term to its boats would be
    // inventing a service for a business that has not offered one. Until this line it did.
    if (freightWaiting > 0 && s.dir === 'to-island' && s.service === 'svc-sealink-passenger-ferry') {
      const room = Math.max(0, Math.round((cap - carried) / 4));
      const moved = Math.min(freightWaiting, room);
      freightWaiting -= moved;
    }
  }

  /* ---------------------------------------------------------------- mechanical failure

  Two vessels run the base timetable in a clean alternating loop, so losing one is not an incident,
  it is a cascading day: about half the vehicle capacity gone, and the backlog rolling forward until
  the third vessel arrives. */

  function mechanical(w, t) {
    // Only a vessel that is actually rostered today can break down on the run. Three vehicle
    // vessels are in the pack but the base timetable is worked by two of them: Quandamooka is the
    // relief boat and appears in no sailing. Rolling for all three sent a third of every failure to
    // a vessel with nothing to cancel, and over a full sim-year that meant the barge never once
    // cancelled and the whole chain hanging off it (rolled vehicles, spoiled chilled freight, a
    // restock a day behind the shelves) never fired at all.
    for (const v of vessels.values()) {
      if (v.status === 'in service') {
        if (v.role === 'walk-on') continue;
        if (!rosteredToday.has(v.id)) continue;
        // About one failure per rostered vessel per two hundred sim-days.
        if (rng.float() < 1 / (200 * 144)) {
          v.status = 'out of service';
          v.reason = rng.pick(['a gearbox fault', 'a generator fault', 'a ramp hydraulic failure', 'unscheduled survey work']);
          v.outUntilMin = t + Math.round(rng.range(4 * 60, 12 * 60));
          w.bus.emit('ferry:vessel-down', {
            vessel: v.name, reason: v.reason, hours: +((v.outUntilMin - t) / 60).toFixed(1),
            text: `${v.name} is out of service with ${v.reason}. That is about half the day's vehicle `
              + 'capacity gone, and the backlog rolls forward until she is back.',
            source: 'data/transport.json structural_facts.two-vessel-rotation'
          });
        }
      } else if (t >= v.outUntilMin) {
        v.status = 'in service';
        w.bus.emit('ferry:vessel-back', { vessel: v.name, text: `${v.name} is back on the run.` });
        v.reason = null;
      }
    }
  }

  /* ---------------------------------------------------------------- the tick */

  function step(w) {
    const t = nowMin(w);
    const minute = w.clock.minuteOfDay;
    const wind = windEffect(w);

    mechanical(w, t);
    presentVehicles(w, minute);

    // Yard occupancy and spillover onto Middle Street.
    const inYard = yardCount();
    state.toondah.inYard = Math.min(inYard, QUEUE.yardCapacity);
    const spill = Math.max(0, inYard - QUEUE.yardCapacity);
    const wasSpilling = state.toondah.spilled > 0;
    state.toondah.spilled = spill;
    if (spill > state.toondah.spilledPeak) state.toondah.spilledPeak = spill;
    if (spill > 0 && !wasSpilling) {
      dayStats.spillFrom = hhmm(minute);
      state.toondah.saturatedFrom = hhmm(minute);
      w.bus.emit('ferry:queue-spill', {
        vehicles: spill, street: QUEUE.spillStreet, at: hhmm(minute),
        yardCapacity: QUEUE.yardCapacity, basis: QUEUE.yardBasis,
        text: `The Toondah yard is full. The queue is out onto ${QUEUE.spillStreet}.`
      });
    }
    if (spill === 0 && wasSpilling) {
      dayStats.spillTo = hhmm(minute);
      state.toondah.spillWindow = `${dayStats.spillFrom} to ${dayStats.spillTo}`;
    }

    // Sailings whose check-in cut or departure falls in this tick.
    for (const s of sailings) {
      if (s.status === 'scheduled' && minute >= s.timeMin - QUEUE.checkInCutMin && minute < s.timeMin) {
        const why = decideCancellation(w, s, wind);
        if (why) {
          s.status = 'cancelled';
          s.why = why;
          dayStats.cancelled++;
          dayStats.cancelReason = why;
          state.cancellations.today = dayStats.cancelled;
          state.cancellations.reason = why;
          state.cancellations.lastCancelled = `${s.time} ${s.vesselName}`;
          onCancelled(w, s, minute);
          continue;
        }
        if (s.kind === 'vehicle') runCheckIn(w, s, minute);
        else runWalkOn(w, s, minute);
        s.status = 'boarding';
      }

      if ((s.status === 'boarding' || s.status === 'scheduled') && minute >= s.timeMin) {
        if (s.status === 'scheduled') {
          // A sailing whose cut we never saw, because the clock stepped over it.
          if (s.kind === 'vehicle') runCheckIn(w, s, minute); else runWalkOn(w, s, minute);
        }
        s.status = 'crossing';
        s.delayMin = wind.delay;
        const crossMin = (s.kind === 'vehicle' ? 47 : 27) + wind.delay;
        s.departedAt = t;
        s.arrivesAt = t + crossMin;
        if (s.kind === 'vehicle') {
          state.deck.carriedToday += s.carsCarried;
          state.deck.slotsLeftToday = Math.max(0, state.deck.slotsLeftToday - s.capacityCars);
          const ves = vessels.get(s.vessel);
          if (ves) { ves.sailingsToday++; ves.carsToday += s.carsCarried; }
        }
        w.bus.emit('ferry:departed', {
          service: s.service, sailing: s.time, dir: s.dir, vessel: s.vesselName,
          cars: s.carsCarried, people: s.paxCarried, delayMin: s.delayMin,
          arrivesInMin: crossMin
        });
        if (s.delayMin >= 5) {
          w.bus.emit('ferry:delayed', {
            sailing: s.time, vessel: s.vesselName, minutes: s.delayMin,
            why: `${Math.round(wind.kt)} knots of wind across the bay`,
            text: `The ${s.time} is running ${s.delayMin} minutes late into a ${Math.round(wind.kt)} knot breeze.`
          });
        }
      }

      if (s.status === 'crossing' && t >= s.arrivesAt) {
        s.status = 'arrived';
        // This is the pulse the island feels: fifty to sixty vehicles onto Junner Street at once.
        w.bus.emit('ferry:arrived', {
          service: s.service, sailing: s.time, dir: s.dir, vessel: s.vesselName,
          cars: s.carsCarried, people: s.paxCarried,
          at: s.dir === 'to-island'
            ? (s.service === 'svc-stradbroke-flyer' ? 'One Mile Jetty' : 'Junner Street')
            : 'Cleveland (Toondah Harbour)',
          delayMin: s.delayMin
        });
      }
    }

    // End of the day: whoever is still in the yard did not get across.
    if (minute >= 1200) {
      const left = yardCount();
      if (left > 0 && !state.toondah.clearsAt) {
        state.toondah.notCarriedToday = left;
        dayStats.notCarried = left;
      }
    }
    if (minute === 1430) endOfDay(w);

    // Live read model.
    state.deck.slotsLeftToday = Math.max(0, dayStats.slots - state.deck.carriedToday);
    state.toondah.standbyWaiting = yard.reduce((s2, c) => s2 + c.standby, 0);
    state.toondah.waitMedianMin = weightedPercentile(dayStats.waits, dayStats.waitWeights, 0.5);
    state.toondah.waitP90Min = weightedPercentile(dayStats.waits, dayStats.waitWeights, 0.9);
    state.vessels = Array.from(vessels.values()).map((v) => ({
      id: v.id, name: v.name, cars: v.cars, passengers: v.passengers,
      status: v.status, reason: v.reason, sailingsToday: v.sailingsToday, carsToday: v.carsToday
    }));
    publishBoard(minute);
    state.freight.waitingItems = freightWaiting;
  }

  function sailingCard(s) {
    return {
      time: s.time, dir: s.dir, kind: s.kind, vessel: s.vesselName, extra: s.extra,
      cars: s.carsCarried, of: s.capacityCars, people: s.paxCarried,
      status: s.status, delayMin: s.delayMin, why: s.why
    };
  }

  /**
   * The board, published whole.
   *
   * WHY THIS IS ITS OWN FUNCTION AND WHY buildDay CALLS IT.
   * This used to live inline at the bottom of `step`, which meant `state.next`, `state.remaining`
   * and `state.sailings` did not exist until the first tick had run. In simulated time the first
   * tick is a fraction of a second away and nobody noticed. In live time a tick is ten real minutes
   * (see `pump` in src/kernel/clock.js), so an island opened live at twenty past four published four
   * empty legs and every screen reading them said there was nothing more today, while the pack
   * underneath held a 16:30 barge and four more passenger sailings. A person reads that and does not
   * drive to the jetty. There is no version of this project where that is acceptable, so the board is
   * built with the day now, and rebuilt on every tick after it.
   */
  function publishBoard(minute) {
    state.sailings = sailings.map(sailingCard);
    for (const [key, dir, kind] of BOARD_LINES) {
      const rows = remainingOf(dir, kind, minute);
      state.remaining[key] = rows;
      state.next[key] = rows.length ? rows[0] : null;
      state.tomorrowFirst[key] = firstTomorrow(dir, kind);
    }
  }

  /** The four lines a person actually asks about, in the order they are asked. */
  const BOARD_LINES = [
    ['toMainland', 'to-mainland', 'vehicle'],
    ['walkOnToMainland', 'to-mainland', 'walk-on'],
    ['toIsland', 'to-island', 'vehicle'],
    ['walkOnToIsland', 'to-island', 'walk-on']
  ];

  /** Every sailing still to come on one line today, soonest first. Cancelled ones are not offered. */
  function remainingOf(dir, kind, minute) {
    const rows = [];
    for (const s of sailings) {
      if (s.dir !== dir || s.kind !== kind) continue;
      if (s.status === 'cancelled' || s.timeMin < minute) continue;
      rows.push({
        time: s.time, inMin: s.timeMin - minute, vessel: s.vesselName,
        service: s.service, extra: s.extra, status: s.status,
        spaceCars: s.kind === 'vehicle' ? s.capacityCars : 0
      });
    }
    rows.sort((a, b) => a.inMin - b.inMin || (a.vessel < b.vessel ? -1 : 1));
    return rows;
  }

  function nextOf(dir, kind, minute) {
    return remainingOf(dir, kind, minute)[0] || null;
  }

  /**
   * The first published departure on one line tomorrow.
   *
   * Read straight off the committed timetable for tomorrow's day of the week rather than out of the
   * simulation, because tomorrow has not been built and building it early would move the random
   * stream. The modelled peak extras are deliberately not in it: this is what the operator publishes,
   * which is the only thing worth telling somebody who has just missed the last boat.
   */
  function firstTomorrow(dir, kind) {
    const dow = DOW[(world.clock.dayOfWeek + 1) % 7];
    const runs = (e) => !e || !e.days || e.days.includes(dow);
    let best = null;
    const take = (timeStr, label, service) => {
      const t = mins(timeStr);
      if (t == null) return;
      if (!best || t < best.timeMin) best = { time: timeStr, timeMin: t, vessel: label, service };
    };
    if (kind === 'vehicle') {
      const v = svc.vehicle && svc.vehicle.schedule && svc.vehicle.schedule.variants[0];
      const list = (v && (dir === 'to-island' ? v.cleveland_to_dunwich : v.dunwich_to_cleveland)) || [];
      for (const e of list) {
        if (!runs(e)) continue;
        const ves = vessels.get(e.vessel);
        take(e.time, ves ? ves.name : (serviceLabel.get('svc-vehicle-ferry') || 'the barge'), 'svc-vehicle-ferry');
      }
      return best;
    }
    if (svc.passenger) {
      const pv = svc.passenger.schedule.variants[0];
      const list = (dir === 'to-island' ? pv.cleveland_to_dunwich : pv.dunwich_to_cleveland) || [];
      const label = (vessels.get('yalingbila') || {}).name || serviceLabel.get(svc.passenger.id);
      for (const t of list) take(t, label, svc.passenger.id);
      const late = pv.late_service;
      if (late && runs(late)) {
        take(dir === 'to-island' ? late.cleveland_to_dunwich : late.dunwich_to_cleveland, label, svc.passenger.id);
      }
    }
    if (svc.flyer) {
      const fv = svc.flyer.schedule.variants[0];
      const list = (dir === 'to-island' ? fv.cleveland_to_one_mile : fv.one_mile_to_cleveland) || [];
      for (const t of list) take(t, serviceLabel.get(svc.flyer.id) || 'the Flyer', svc.flyer.id);
    }
    return best;
  }

  /**
   * A cancelled crossing does three things and they are all stories: it strands people, it spoils
   * freight, and on the last boat of the day it takes somebody's night away.
   */
  function onCancelled(w, s, minute) {
    // Last of the day for this operator, which is the question a person standing at a jetty is
    // actually asking. Whether the other operator has a later boat is a separate question, and on
    // this crossing it has a different answer at each end: at Cleveland the two terminals are a few
    // hundred metres apart on the same street, and at Dunwich they are a kilometre and a bus apart.
    const lastOfDay = !sailings.some((x) => x.dir === s.dir && x.kind === s.kind
      && x.service === s.service && x.timeMin > s.timeMin && x.status !== 'cancelled');
    const otherOperatorLater = s.kind === 'walk-on' && sailings.some((x) => x.dir === s.dir
      && x.kind === 'walk-on' && x.service !== s.service && x.timeMin > s.timeMin
      && x.status !== 'cancelled');
    if (s.kind === 'walk-on') {
      // The people stranded are the people that boat would have carried, not a number pulled out of
      // the air. A 05:15 out of One Mile and a Sunday afternoon into Dunwich strand different loads,
      // and the two operators land in different townships, so the boat that failed decides both how
      // many are standing there and where they are standing.
      const wanted = walkOnDemand(w, s);
      const people = Math.min(wanted, s.capacityPax || flyerSeats);
      const isFlyer = s.service === 'svc-stradbroke-flyer';
      const where = s.dir === 'to-island'
        ? (isFlyer ? 'atFlyerTerminal' : 'atToondah')
        : (isFlyer ? 'atOneMile' : 'atDunwich');
      const place = s.dir === 'to-island'
        ? (isFlyer ? 'the Flyer terminal at Cleveland' : 'Toondah Harbour')
        : (isFlyer ? 'One Mile Jetty' : 'the Junner Street pontoon');
      state.stranded[where] += people;
      const otherWay = s.dir === 'to-island'
        ? 'the other operator has a later one from the same street'
        : 'the other operator has a later one from the other side of Dunwich';
      w.bus.emit('ferry:stranded', {
        people, where, place, operator: s.vesselName, service: s.service,
        sailing: s.time, why: s.why, lastOfDay, otherOperatorLater,
        text: lastOfDay
          ? (otherOperatorLater
            ? `The last ${s.vesselName} is cancelled: ${s.why}. ${people} people at ${place} have to `
              + `find out that ${otherWay}.`
            : `The last ${s.vesselName} is cancelled: ${s.why}. ${people} people at ${place} are not `
              + 'getting home tonight.')
          : `The ${s.time} ${s.vesselName} is cancelled: ${s.why}. ${people} people at ${place} are `
            + 'waiting on the next one.'
      });
    } else {
      const rolled = Math.min(yardCount(), s.capacityCars);
      w.bus.emit('ferry:cancelled', {
        sailing: s.time, vessel: s.vesselName, why: s.why, slotsLost: s.capacityCars,
        vehiclesRolled: rolled, lastOfDay,
        text: `The ${s.time} barge is cancelled: ${s.why}. ${s.capacityCars} car slots gone from the day.`
      });
      if (freightWaiting > 0) {
        const spoiled = Math.max(1, Math.round(freightWaiting * 0.18));
        freightWaiting = Math.max(0, freightWaiting - spoiled);
        state.freight.spoiledToday += spoiled;
        w.bus.emit('ferry:freight-spoiled', {
          items: spoiled, why: s.why,
          text: `${spoiled} chilled freight lines missed the boat and will not keep. The restock is `
            + 'now a day later than the shelves are.'
        });
      }
    }
    void minute;
  }

  function endOfDay(w) {
    const left = yardCount();
    dayStats.notCarried = left;
    // Some rebook for tomorrow, which pushes tomorrow's queue up before today's has cleared.
    carryOver = Math.round(left * 0.39);
    state.toondah.rolledToTomorrow = carryOver;
    state.toondah.notCarriedToday = left;
    state.toondah.standbyServedToday = dayStats.standbyServed;
    state.toondah.clearsAt = hhmm(Math.min(1439, (sailings.filter((s) => s.dir === 'to-island' && s.kind === 'vehicle').slice(-1)[0] || { timeMin: 1080 }).timeMin + 40));
    if (left > 0) {
      w.bus.emit('ferry:rolled', {
        vehicles: left, rebooking: carryOver,
        text: `${left} vehicles did not get across today. About ${carryOver} of them will try again `
          + 'tomorrow, which puts tomorrow ahead before it starts.'
      });
    }
    rolling.cancel30.push(dayStats.cancelled);
    rolling.carried30.push(dayStats.carried);
    while (rolling.cancel30.length > 30) rolling.cancel30.shift();
    while (rolling.carried30.length > 30) rolling.carried30.shift();
    state.cancellations.rolling30 = rolling.cancel30.reduce((a, b) => a + b, 0);
    state.stranded.atToondah = Math.round(state.stranded.atToondah * 0.2);
    state.stranded.atFlyerTerminal = Math.round(state.stranded.atFlyerTerminal * 0.2);
    state.stranded.atDunwich = Math.round(state.stranded.atDunwich * 0.2);
    state.stranded.atOneMile = Math.round(state.stranded.atOneMile * 0.2);

    if (dayStats.isLongWeekendFriday) recordScenario();
  }

  /**
   * The pack's worked scenario, side by side with what this simulation actually did. It is here so a
   * critic can check the model against the data rather than against a claim, and so the places where
   * the two disagree are visible rather than argued about.
   */
  function recordScenario() {
    const pack = (world.data.transport.scenarios || []).find((s) => s.id === 'toondah-long-weekend-friday');
    if (!pack) return;
    const o = pack.modelled_day.outcomes;
    state.scenario = {
      id: pack.id,
      name: pack.name,
      status: pack.status,
      ranOn: state.today ? state.today.day : null,
      pack: {
        sailings: pack.modelled_day.sailings,
        capacityCars: pack.modelled_day.capacity_cars,
        presenting: pack.modelled_day.arrival_profile_total,
        carried: o.carried,
        notCarried: o.not_carried_on_the_day,
        standbyServed: o.slots_released_at_the_cut,
        rolledToSaturday: o.rolled_to_saturday,
        spillWindow: o.queue_spillover_window,
        yardPeak: o.queue_peak_vehicles_in_yard,
        waitMedianMin: o.standby_wait_median_min,
        waitP90Min: o.standby_wait_p90_min
      },
      modelled: {
        sailings: sailings.filter((s) => s.dir === 'to-island' && s.kind === 'vehicle').length,
        capacityCars: dayStats.slots,
        presenting: dayStats.presented,
        carried: dayStats.carried,
        notCarried: dayStats.notCarried,
        standbyServed: dayStats.standbyServed,
        rolledToSaturday: carryOver,
        spillWindow: state.toondah.spillWindow,
        yardPeak: Math.min(QUEUE.yardCapacity, state.toondah.spilledPeak + QUEUE.yardCapacity),
        waitMedianMin: state.toondah.waitMedianMin,
        waitP90Min: state.toondah.waitP90Min
      },
      confidence: pack.confidence,
      howToFalsify: pack.how_to_falsify_this
    };
  }

  /* ---------------------------------------------------------------- the public interface */

  const api = {
    /** The one number the pack says a player must always be able to see. */
    slotsLeftToday: () => state.deck.slotsLeftToday,
    sailingsToday: () => sailings.map(sailingCard),
    nextSailing: (dir, kind) => nextOf(dir || 'to-island', kind || 'vehicle', world.clock.minuteOfDay),
    /** Is a walk-on or a vehicle able to cross in the next `withinMin` minutes? */
    canCross: (dir, kind, withinMin) => {
      const n = nextOf(dir || 'to-island', kind || 'vehicle', world.clock.minuteOfDay);
      return !!n && n.inMin <= (withinMin ?? 1440);
    },
    vessel: (id) => vessels.get(id) || null,
    queueLength: () => yardCount(),
    /** Freight waiting for a crossing, so prices.js and the shops can see the same backlog. */
    addFreight: (n) => { freightWaiting += Math.max(0, n | 0); },
    freightWaiting: () => freightWaiting
  };
  for (const k of Object.keys(api)) {
    Object.defineProperty(state, k, { value: api[k], enumerable: false, configurable: true });
  }

  /* ---------------------------------------------------------------- system */

  world.bus.on('freight:order', () => { freightWaiting++; });
  world.bus.on('freight:delivered', () => { if (freightWaiting > 0) freightWaiting--; });

  return world.register({
    id: 'ferry',
    phase: 'movement',
    order: 20,

    init(w) {
      cal = makeCalendar(w.data.events);
      if (!readPack(w)) return;
      buildDay(w);
      state.ready = true;
    },

    tick(w) {
      if (!state.ready) return;
      if (w.clock.minuteOfDay === 0) buildDay(w);
      step(w);
    },

    describe(w) {
      const nx = state.next.toIsland;
      return {
        slotsToday: state.deck.slotsToday,
        slotsLeft: state.deck.slotsLeftToday,
        carried: state.deck.carriedToday,
        presented: state.toondah.presentedToday,
        inYard: state.toondah.inYard,
        spilled: state.toondah.spilled,
        standbyWaiting: state.toondah.standbyWaiting,
        waitMedianMin: state.toondah.waitMedianMin,
        waitP90Min: state.toondah.waitP90Min,
        notCarried: state.toondah.notCarriedToday,
        rolled: state.toondah.rolledToTomorrow,
        walkOnCarried: state.walkOn.carriedToday,
        walkOnTurnedAway: state.walkOn.turnedAwayToday,
        cancelled: state.cancellations.today,
        cancelled30: state.cancellations.rolling30,
        vesselsDown: state.vessels.filter((v) => v.status !== 'in service').map((v) => v.name).join(',') || null,
        peak: !!(state.today && state.today.peakTimetable),
        next: nx ? `${nx.time} ${nx.vessel}` : null,
        stranded: state.stranded.atToondah + state.stranded.atFlyerTerminal
          + state.stranded.atDunwich + state.stranded.atOneMile,
        freightWaiting: state.freight.waitingItems,
        freightSpoiled: state.freight.spoiledToday
      };
    },

    save() {
      return {
        carryOver, freightWaiting,
        vessels: Array.from(vessels.values()).map((v) => [v.id, v.status, v.outUntilMin, v.reason]),
        rolling: { cancel30: rolling.cancel30.slice(), carried30: rolling.carried30.slice() }
      };
    },
    load(w, s) {
      if (!s) return;
      carryOver = s.carryOver || 0;
      freightWaiting = s.freightWaiting || 0;
      for (const [id, status, until, reason] of s.vessels || []) {
        const v = vessels.get(id);
        if (v) { v.status = status; v.outUntilMin = until; v.reason = reason; }
      }
      if (s.rolling) { rolling.cancel30 = s.rolling.cancel30.slice(); rolling.carried30 = s.rolling.carried30.slice(); }
      buildDay(w);
    }
  });
}
