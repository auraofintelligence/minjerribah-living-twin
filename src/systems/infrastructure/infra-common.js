// Shared substrate for the four infrastructure systems: power, water, waste and telecoms.
//
// THIS IS NOT A SYSTEM. It exports nothing beginning with `register`, it is not in the manifest,
// and it never writes to world.state. It exists for the same reason src/systems/agents/calendar.js
// and src/systems/ecology/ecology-common.js exist: four files that have to agree on how many
// people are on the island tonight should agree in one place rather than four.
//
// It leans on ecology-common for the pieces that are island-wide rather than ecological: the lever
// reconciliation, the 256 m sampling of the island, and the projected places table. Those are
// deliberately not copied. Two different answers in one build to "is the transfer station upgrade
// running" would be worse than a cross-folder import of a pure helper.
//
// THE ONE IDEA UNDERNEATH ALL FOUR SYSTEMS
//
// On the mainland, infrastructure is a rate. You turn the tap and water comes out, because behind
// the tap is a grid big enough that your household is a rounding error. On an island of about two
// thousand people at the end of one cable, one pipe network, one transfer station and a boat
// timetable, infrastructure is a STOCK WITH A BUFFER. Kilowatt-hours in a battery. Megalitres in a
// reservoir. Tonnes in a skip yard. Ampere-hours in a phone tower cabinet. Every one of those
// buffers is measured in hours or days, not months, and every one of them empties fastest on the
// weekend the island is fullest.
//
// data/events.json says it plainly for waste and it is true of all four:
// "Model waste as a stock with an outflow limited by barge slots, not as a rate that clears
// itself. That single choice makes every event in this pack cost something real."
//
// Australian English. A$ throughout. Determinism: every stochastic term in the four systems draws
// from its own named world.rng stream. No Math.random, no Date.now.

import {
  clamp, lerp, smoothstep, levers, humanLoad, metric, places, place, ecoGrid, absDay,
  DailyRing, EventLog
} from '../ecology/ecology-common.js';
import { makeCalendar } from '../agents/calendar.js';

export { clamp, lerp, smoothstep, levers, humanLoad, metric, places, place, ecoGrid, absDay, DailyRing, EventLog };

/** Ten sim-minutes a tick, so a tick is this many days. */
export const TICK_DAYS = 10 / 1440;
export const TICK_HOURS = 10 / 60;
export const TICKS_PER_DAY = 144;

/** A$ with thousands separators and no decimals, ready for a panel to print unchanged. */
export function aud(v) {
  const n = Math.round(v || 0);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-A$' : 'A$') + s;
}

/** Exponential approach written so the caller states a half-life in days rather than a magic 0.03. */
export function approach(current, target, halfLifeDays, dtDays) {
  if (!(halfLifeDays > 0)) return target;
  return current + (target - current) * (1 - Math.pow(0.5, dtDays / halfLifeDays));
}

/* ------------------------------------------------------------------ the townships

Four served places. Dunwich (Goompi), Amity Point (Pulan) and Point Lookout (Mulumba) are the three
townships in data/places.json; One Mile is the northern end of Dunwich and is carried separately
because it has its own jetty, its own water taxi landing and, for the purposes of a water main, its
own elevation. Every share below is a modelling estimate and is replaced at init by the real
occupied-dwelling split out of population.js the moment that system is loaded. */

export const TOWNSHIPS = [
  { id: 'dunwich', label: 'Dunwich (Goompi)', placeId: 'dunwich', share: 0.42 },
  { id: 'point-lookout', label: 'Point Lookout (Mulumba)', placeId: 'point-lookout', share: 0.40 },
  { id: 'amity-point', label: 'Amity Point (Pulan)', placeId: 'amity-point', share: 0.13 },
  { id: 'one-mile', label: 'One Mile', placeId: 'one-mile-jetty', share: 0.05 }
];

const townCache = new WeakMap();

/**
 * The four served places, projected into local metres off data/places.json, carrying the ground
 * height at the township centre. The height is not decoration: it is why Point Lookout loses water
 * pressure first. It sits on the island's only rock headland and the reservoir has to lift to it.
 */
export function townships(world) {
  let t = townCache.get(world);
  if (t) return t;
  t = [];
  for (const spec of TOWNSHIPS) {
    const p = place(world, spec.placeId);
    t.push({
      id: spec.id,
      label: spec.label,
      share: spec.share,
      found: !!p,
      x: p ? p.x : 0,
      z: p ? p.z : 0,
      groundM: p ? p.y : 0
    });
  }
  townCache.set(world, t);
  return t;
}

/**
 * Occupied-dwelling share by township, from population.js when it is loaded and from the modelled
 * shares above when it is not. Returns a plain object keyed by township id, summing to one.
 */
export function townshipShares(world) {
  const out = {};
  const pop = world.read('population');
  let total = 0;
  if (pop && pop.ready && pop.byTownship) {
    for (const t of TOWNSHIPS) {
      const row = pop.byTownship[t.id];
      const v = row ? (row.residents ?? row.people ?? 0) : 0;
      out[t.id] = v;
      total += v;
    }
  }
  if (total <= 0) {
    for (const t of TOWNSHIPS) out[t.id] = t.share;
    total = 1;
  }
  for (const t of TOWNSHIPS) out[t.id] = out[t.id] / total;
  return out;
}

/* ------------------------------------------------------------------ named events

data/events.json carries thirty-six real events with published or estimated attendance, and every
one of them lists what it needs: bins, toilets, potable water, stage power, ferry seats.

REWRITTEN 10 AUGUST 2026, and the old version is worth recording because it was the only door the
pack had into the whole simulation. It read each record's `next_known` window and nothing else.
Every `next_known` in the pack is a 2026 date, and eleven records have none at all, so the weekly
and the monthly ones had never once fired and every dated one would have stopped on 1 January 2027.
Four infrastructure systems were reading a list that was empty on most days and would have been
empty on every day of a second sim-year.

It now resolves each record's own `date_rule` through `src/systems/agents/calendar.js`, the same
helper the agent systems already import and the same arithmetic the calendar board shows a player,
so the bins a festival needs and the date the board prints cannot disagree.

Read through the calendar rather than through `world.read('events')` on purpose: the infrastructure
phase runs before the agents phase, so a read model would be one tick stale at midnight, and a
shared pure helper has no phase at all. */

const calCache = new WeakMap();

function calendarFor(world) {
  let c = calCache.get(world);
  if (c) return c;
  c = (world.residents && world.residents.calendar) || makeCalendar(world.data && world.data.events);
  calCache.set(world, c);
  return c;
}

/**
 * Named events running today, with the extra load they bring. `crowd` is people on site at the
 * peak of the day, from the pack's own attendance estimate, and it is an estimate: every attendance
 * figure in data/events.json is flagged `basis: estimate` and most carry low confidence.
 */
export function eventsToday(world) {
  const day = absDay(world.clock);
  const out = { running: [], crowd: 0, extraBins: 0, wasteStrain: 0, waterStrain: 0, powerStrain: 0, byTownship: {} };
  for (const ev of calendarFor(world).eventsOnDay(day)) {
    const rec = ev.rec;
    const att = rec.attendance || {};
    const needs = rec.needs || null;
    const strains = {};
    for (const s of rec.strains || []) strains[s.system] = s.level;
    out.running.push({
      id: ev.id, name: ev.name, township: ev.township, crowd: ev.peak,
      confidence: att.confidence || rec.confidence || 'low',
      dayOfEvent: ev.dayOfEvent, days: ev.days
    });
    out.crowd += ev.peak;
    out.extraBins += (needs && needs.waste_extra_bins) || 0;
    out.wasteStrain = Math.max(out.wasteStrain, strains.waste || 0);
    out.waterStrain = Math.max(out.waterStrain, strains.water || 0);
    out.powerStrain = Math.max(out.powerStrain, strains.power || 0);
    out.byTownship[ev.township] = (out.byTownship[ev.township] || 0) + ev.peak;
  }
  return out;
}

/* ------------------------------------------------------------------ who is on the island

Residents plus visitors plus any festival crowd, and the same number in all four systems.

THE SPLIT THAT MATTERS FOR INFRASTRUCTURE. A visitor sleeping in a holiday house and a visitor who
came over on the nine o'clock boat and goes home at four are the same line in a visitor count and
completely different lines in a power bill. The one in the house runs a fridge, an air conditioner,
a hot water system, a washing machine and four showers. The day tripper uses a public toilet, buys a
coffee and leaves. On a Boxing Day this island can hold eight thousand visitors, and treating all
eight thousand as households would put a demand on the cable that no cable has and no island sees.

data/residents.json publishes nine visitor archetypes with their stay lengths. The share of each
that stays the night is modelled from those lengths, because the pack gives a range rather than a
split, and the fallback when the visitor system is not loaded is stated rather than assumed silently. */

const STAYING_SHARE = {
  'day-tripper': 0,
  'family-in-a-holiday-house': 1,
  'weekend-camper': 1,
  backpacker: 1,
  'grey-nomad': 1,
  surfer: 0.5,
  'whale-watcher': 0.35,
  'school-group': 0.4,
  'tradesperson-from-the-mainland': 0.45
};
const STAYING_FALLBACK = 0.55;

export function servedPopulation(world) {
  const h = humanLoad(world);
  const ev = eventsToday(world);
  const shares = townshipShares(world);
  const vis = world.read('visitors');

  let staying = 0;
  let stayingKnown = false;
  if (vis && vis.byArchetype) {
    let counted = 0;
    for (const [id, n] of Object.entries(vis.byArchetype)) {
      counted += n;
      staying += n * (STAYING_SHARE[id] ?? STAYING_FALLBACK);
    }
    stayingKnown = counted > 0;
    // Anything the archetype table did not account for keeps the fallback share.
    if (counted < h.visitors) staying += (h.visitors - counted) * STAYING_FALLBACK;
  }
  if (!stayingKnown) staying = h.visitors * STAYING_FALLBACK;
  const day = Math.max(0, h.visitors - staying);

  const byTownship = {};
  for (const t of TOWNSHIPS) {
    const visHere = vis && vis.byTownship ? (vis.byTownship[t.id] || 0) : h.visitors * shares[t.id];
    const evHere = (ev.byTownship[t.id] || 0) + (ev.byTownship['island-wide'] || 0) * shares[t.id];
    const stayShare = h.visitors > 0 ? staying / h.visitors : STAYING_FALLBACK;
    byTownship[t.id] = {
      residents: h.residents * shares[t.id],
      visitors: visHere,
      staying: visHere * stayShare,
      day: visHere * (1 - stayShare),
      event: evHere,
      total: h.residents * shares[t.id] + visHere + evHere
    };
  }
  return {
    residents: h.residents,
    visitors: h.visitors,
    /** Visitors sleeping on the island tonight. These are the ones with a household load. */
    staying,
    /** Visitors who came over this morning and go home tonight. A toilet block and a coffee. */
    day,
    stayingBasis: stayingKnown
      ? 'split by archetype, from the stay lengths published in data/residents.json'
      : `the visitor system is not loaded, so a flat ${STAYING_FALLBACK} staying share is assumed`,
    event: ev.crowd,
    total: h.residents + h.visitors + ev.crowd,
    /** How far past a normal day this is. 0 is the census island with nobody visiting. */
    pressure: (h.visitors + ev.crowd) / Math.max(1, h.residents),
    events: ev,
    byTownship
  };
}

/* ------------------------------------------------------------------ civic metrics

Every movement these four systems make on a data/civic.json metric goes through here, so it arrives
with a reason a player can read in the policy panel's explain() list. Nudges are for events, not for
weather: a nudge every day would fill the policy system's three-hundred-entry buffer in ten weeks
and drown the movements that matter. */

export function nudge(world, metricId, delta, reason, source, halfLifeDays = 180) {
  if (!Number.isFinite(delta) || delta === 0) return;
  world.bus.emit('civic:metric-nudge', {
    metric: metricId, delta, reason, source, halfLifeDays
  });
}

/* ------------------------------------------------------------------ plain speaking

Two numbers nobody has a feel for, turned into something a reader can see. An Olympic pool is
2.5 megalitres. A kettle is about 2.2 kilowatts. Both are used in the read models rather than in
comments, because "twenty megalitres a day" means nothing to most people and "eight Olympic pools a
day leave the island" means everything. The Olympic pool line is the subterranean pack's own. */

export const OLYMPIC_POOL_ML = 2.5;
export function pools(ml) { return +(ml / OLYMPIC_POOL_ML).toFixed(1); }
export const KETTLE_KW = 2.2;
export function kettles(kw) { return Math.round(kw / KETTLE_KW); }

/**
 * A duration in whole hours and minutes, for a read model that is about to say how long a buffer
 * lasts. Buffers on this island are measured in hours, so "1.8" is worse writing than "1 h 48 m".
 */
export function hoursMinutes(hours) {
  if (!Number.isFinite(hours) || hours < 0) return 'none';
  if (hours > 96) return Math.round(hours / 24) + ' days';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return m + ' min';
  return m === 0 ? h + ' h' : `${h} h ${m} m`;
}

/* ------------------------------------------------------------------ the crossing

Nothing arrives on this island except by boat. data/transport.json structural_facts.no-bridge is
published and it is the hardest constraint in the world:

  "Set a hard daily import and export ceiling equal to the sum of scheduled sailings times their
   capacity, minus crew and vehicle deck losses. No system may exceed it."

Diesel for the generators, chlorine for the water plants, a replacement transformer, and every
tonne of rubbish leaving, all compete for the same deck as the visitors' cars. The prices system
already models the deck; this reads its published state rather than modelling a second one. */

export function crossing(world) {
  const p = world.read('prices');
  const wx = world.read('weather');
  const condition = (wx && wx.crossingCondition) || 'good';
  if (p && p.ready && p.crossings) {
    const c = p.crossings;
    return {
      connected: true,
      scheduledToday: c.scheduledToday || 0,
      ranToday: c.ranToday || 0,
      lostToday: c.lostToday || 0,
      running: (c.ranToday || 0) > 0 || (c.scheduledToday || 0) === 0,
      condition: c.condition || condition,
      consecutiveLostDays: c.consecutiveLostDays || 0,
      utilisation: c.utilisation || 0,
      freightIndex: p.freightIndex || 1
    };
  }
  // The economy slice is not loaded. Fall back to the weather, which is the thing that actually
  // stops a barge, rather than to an assumption that the boats always run.
  const cancelled = condition === 'cancelled';
  return {
    connected: false,
    scheduledToday: 10, ranToday: cancelled ? 0 : 10, lostToday: cancelled ? 10 : 0,
    running: !cancelled, condition, consecutiveLostDays: 0, utilisation: 0.5, freightIndex: 1
  };
}

/* ------------------------------------------------------------------ small shared shapes */

/** A fixed-length rolling window of daily values. Never grows, never divides by zero. */
export class Rolling {
  constructor(n) { this.n = n; this.buf = new Float64Array(n); this.i = 0; this.filled = 0; this.sum = 0; }
  push(v) {
    if (!Number.isFinite(v)) v = 0;
    this.sum -= this.buf[this.i];
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.n;
    if (this.filled < this.n) this.filled++;
    return this.sum;
  }
  get mean() { return this.filled ? this.sum / this.filled : 0; }
  get total() { return this.sum; }
  get max() { let m = -Infinity; for (let k = 0; k < this.filled; k++) if (this.buf[k] > m) m = this.buf[k]; return this.filled ? m : 0; }
  save() { return { buf: Array.from(this.buf), i: this.i, filled: this.filled, sum: this.sum }; }
  load(s) {
    if (!s || !Array.isArray(s.buf) || s.buf.length !== this.n) return;
    this.buf.set(s.buf); this.i = s.i | 0; this.filled = s.filled | 0; this.sum = s.sum || 0;
  }
}

/**
 * A service interruption, in the shape all four systems report one. Kept here so an outage of the
 * power, the water, the tip and the phones all read the same way in a panel, and so a chronicle
 * or a notification layer can handle one shape rather than four.
 */
export function outageRecord(kind, cause, day, minuteOfDay) {
  return {
    kind, cause,
    startDay: day, startMinute: minuteOfDay,
    minutes: 0, ended: false, endDay: null,
    peopleAffected: 0, sites: []
  };
}

/**
 * The house rule for how a stated capacity is described to a reader. Nothing in the four systems is
 * allowed to present a modelled number as a measured one, and this is the vocabulary they use.
 * `published` means a figure in a data pack with a source. `modelled` means this project chose it.
 * `placeholder` means a pack carries the number and says in its own words not to trust it.
 */
export const BASIS = {
  published: 'published',
  modelled: 'modelled',
  placeholder: 'placeholder: the pack that carries this number says to check it before use'
};
