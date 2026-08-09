// Tide. Reference implementation for how a system is written in this project: read this first.
//
// Moreton Bay is semi-diurnal with a strong spring/neap swing. This is a harmonic model
// (M2, S2, N2, K1, O1) rather than a sine, because the whole island runs on the tide:
// the barge and vehicle ferry timetable, the Amity sand flats, the Rous Channel bar,
// whether you can walk the Gorge low shelf, when the yabby banks are out, when the
// mosquitoes lift out of the Amity saltmarsh.
//
// Datum: metres above LAT. Dunwich (Goompi) is the reference port; other locations carry
// an amplitude ratio and a lag, because high water at Amity is not high water at the Gorge.

import { PHASES } from '../../kernel/world.js';

// Amplitude (m), speed (deg/hr), phase lag (deg). Approximate constituents for the
// Dunwich / southern Moreton Bay standard port. Sourced values live in data/lore.json.
const CONSTITUENTS = [
  { name: 'M2', amp: 0.63, speed: 28.9841042, phase: 216 },
  { name: 'S2', amp: 0.19, speed: 30.0000000, phase: 250 },
  { name: 'N2', amp: 0.13, speed: 28.4397295, phase: 196 },
  { name: 'K1', amp: 0.17, speed: 15.0410686, phase: 8 },
  { name: 'O1', amp: 0.11, speed: 13.9430356, phase: 350 },
  { name: 'K2', amp: 0.05, speed: 30.0821373, phase: 248 },
  { name: 'Q1', amp: 0.03, speed: 13.3986609, phase: 336 }
];
const MEAN_LEVEL = 1.02; // m above LAT

// Local stations: how the same tide reads at different parts of the island.
export const TIDE_STATIONS = {
  dunwich:    { label: 'Dunwich (Goompi)',   ratio: 1.00, lagMin: 0 },
  amity:      { label: 'Amity Point (Pulan)', ratio: 0.94, lagMin: -14 },
  onemile:    { label: 'One Mile',            ratio: 1.00, lagMin: 4 },
  myora:      { label: 'Myora Springs',       ratio: 0.97, lagMin: -8 },
  gorge:      { label: 'The Gorge',           ratio: 0.86, lagMin: -46 },
  cylinder:   { label: 'Cylinder Beach',      ratio: 0.85, lagMin: -48 },
  mainbeach:  { label: 'Main Beach',          ratio: 0.84, lagMin: -50 },
  jumpinpin:  { label: 'Jumpinpin',           ratio: 0.88, lagMin: 36 }
};

function heightAtHours(hoursSinceEpoch) {
  let h = MEAN_LEVEL;
  for (const c of CONSTITUENTS) {
    h += c.amp * Math.cos(((c.speed * hoursSinceEpoch - c.phase) * Math.PI) / 180);
  }
  return h;
}

export function registerTide(world) {
  const state = world.publish('tide', {
    height: 0,           // metres above LAT at Dunwich
    rate: 0,             // m/hr, positive = flooding
    phase: 'slack',      // flood | ebb | slack
    range: 0,            // today's predicted range
    springNeap: 0,       // 0 neap .. 1 spring
    next: [],            // upcoming turns
    stations: {}
  });

  function hoursOf(clock) {
    return (clock.epochDay + clock.dayIndex) * 24 + clock.minuteOfDay / 60;
  }

  function stationHeight(id, hours) {
    const st = TIDE_STATIONS[id];
    const base = heightAtHours(hours + st.lagMin / 60);
    return MEAN_LEVEL + (base - MEAN_LEVEL) * st.ratio;
  }

  function computeTurns(fromHours, spanHours = 30) {
    const turns = [];
    let prev = heightAtHours(fromHours - 0.25);
    let cur = heightAtHours(fromHours);
    for (let t = 0.25; t < spanHours; t += 0.25) {
      const next = heightAtHours(fromHours + t);
      if ((cur - prev) * (next - cur) < 0) {
        turns.push({ inHours: t - 0.25, height: +cur.toFixed(2), kind: cur > next ? 'high' : 'low' });
        if (turns.length >= 5) break;
      }
      prev = cur; cur = next;
    }
    return turns;
  }

  let lastRecompute = -1;

  return world.register({
    id: 'tide',
    phase: 'environment',
    order: 10,

    init(w) {
      recompute(w);
    },

    tick(w) {
      recompute(w);
    },

    describe(w) {
      return {
        height: +state.height.toFixed(2),
        phase: state.phase,
        rate: +state.rate.toFixed(3),
        springNeap: +state.springNeap.toFixed(2),
        nextTurn: state.next[0] || null
      };
    },

    save() { return null; },
    load() {}
  });

  function recompute(w) {
    const hours = hoursOf(w.clock);
    state.height = heightAtHours(hours);
    const dh = heightAtHours(hours + 0.25) - heightAtHours(hours - 0.25);
    state.rate = dh / 0.5;
    state.phase = Math.abs(state.rate) < 0.06 ? 'slack' : state.rate > 0 ? 'flood' : 'ebb';

    for (const id of Object.keys(TIDE_STATIONS)) {
      state.stations[id] = +stationHeight(id, hours).toFixed(2);
    }

    // Daily-ish work: turns and the spring/neap read.
    if (w.clock.dayIndex !== lastRecompute || !state.next.length) {
      lastRecompute = w.clock.dayIndex;
      state.next = computeTurns(hours);
      let lo = 99, hi = -99;
      for (let t = 0; t < 25; t += 0.5) {
        const h = heightAtHours(hours + t);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      state.range = hi - lo;
      // Spring range here runs about 2.0 m, neap about 0.9 m.
      state.springNeap = Math.max(0, Math.min(1, (state.range - 0.9) / 1.1));
      w.bus.emit('tide:day', { range: +state.range.toFixed(2), springNeap: +state.springNeap.toFixed(2), turns: state.next });
    }
  }
}
