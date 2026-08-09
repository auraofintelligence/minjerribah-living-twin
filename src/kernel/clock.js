// Island time. One tick = 10 sim-minutes at 1x. Speeds are tick multipliers, not timestep changes,
// so the simulation is identical at every speed (Cities Skylines does the opposite and it shows).

export const TICK_MINUTES = 10;
export const MINUTES_PER_DAY = 1440;
export const TICKS_PER_DAY = MINUTES_PER_DAY / TICK_MINUTES; // 144

export const SPEEDS = [
  { label: 'Paused', ticksPerSecond: 0, key: '0' },
  { label: '1x', ticksPerSecond: 2, key: '1' },
  { label: '3x', ticksPerSecond: 6, key: '2' },
  { label: '12x', ticksPerSecond: 24, key: '3' },
  { label: '60x', ticksPerSecond: 120, key: '4' }
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Island seasons. Six bands keyed to what the Country is doing, not to a meteorological grid.
// Boundaries are month spans; the seasons are read from the world, so in practice they overlap.
//
// CULTURAL NOTE, read before touching this block.
// An earlier version of this file carried six season names presented as a Quandamooka calendar,
// written from memory. They could not be sourced. No published Quandamooka seasonal calendar was
// found: not in QYAC's own publications, not in Queensland Government material, not in the Bureau
// of Meteorology's Indigenous Weather Knowledge calendars, not in the North Stradbroke Island
// Museum's language material. At least one of the words was demonstrably wrong in the way it was
// used: yalingbila is published as meaning whale, in the QYAC and University of Queensland project
// Yalingbila Bibula at Mooloomba, and it was being used here as the name of a hot wet season.
// The names have been removed. See data/lore.json language.seasonal_calendar and
// language.banned_tokens, and docs/CULTURAL-REVIEW.md.
//
// What is here now is plain descriptive English. The six bands nest inside the four-season calendar
// in data/ecology.json, and every marker below is drawn from that pack's seasonal_calendar, so a
// marker can be checked against a sourced ecology record rather than against somebody's memory.
export const ISLAND_SEASONS = [
  { id: 'high-summer', name: 'High summer', months: [11, 0], marker: 'Afternoon storms. Loggerhead turtles nesting on the ocean beaches. Manta rays on the bommie. Peak visitor pressure on all of it.' },
  { id: 'late-summer', name: 'Late summer', months: [1], marker: 'Heat and storm rain. Lakes full. Acid frogs calling after rain. Turtle hatchlings on the ocean beaches.' },
  { id: 'cooling', name: 'Cooling', months: [2, 3, 4], marker: 'Shorebirds fatten and depart by about April. Midyim fruiting ends. Mullet start moving. Planned burn season opens.' },
  { id: 'cold-and-clear', name: 'Cold and clear', months: [5, 6, 7], marker: 'Humpbacks passing north, peaking about July. The mullet run. Tailor in the gutters, strong in August. Cold westerlies.' },
  { id: 'warming', name: 'Warming', months: [8, 9], marker: 'Humpbacks passing south with calves, close inshore, peaking about October. Snakes and blue-tongues at their most active. Koala breeding and dispersal. Shorebirds returning.' },
  { id: 'building-storms', name: 'Building storms', months: [10], marker: 'First real storms. Bushfire risk rising. Loggerhead mating from late October. Rainbow bee-eaters digging nest burrows in the sandy banks.' }
];

export class Clock {
  /** @param startISO e.g. '2026-09-19T06:00' */
  constructor(startISO = '2026-09-19T05:20') {
    // Parsed as UTC and read back as UTC throughout, so the island calendar does not
    // shift with whatever machine the build happens to run on. Island time is AEST by definition.
    const d = new Date(startISO + ':00Z');
    this.epochDay = Math.floor(d.getTime() / 86400000);
    this.tick = 0;
    this.minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
    this.startMinuteOfDay = this.minuteOfDay;
    this.dayIndex = 0;
    this.speedIndex = 1;
    this.accumulator = 0;
    this._date = d;
  }

  get speed() { return SPEEDS[this.speedIndex]; }
  get paused() { return this.speedIndex === 0; }

  setSpeed(i) { this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i)); }
  togglePause() { this.speedIndex = this.speedIndex === 0 ? 1 : 0; }

  /** Advance wall-clock; returns how many sim ticks to run. Capped so a stalled tab does not spiral. */
  pump(dtSeconds) {
    if (this.paused) return 0;
    this.accumulator += dtSeconds * this.speed.ticksPerSecond;
    const n = Math.floor(this.accumulator);
    this.accumulator -= n;
    return Math.min(n, 240);
  }

  advance() {
    this.tick++;
    this.minuteOfDay += TICK_MINUTES;
    while (this.minuteOfDay >= MINUTES_PER_DAY) {
      this.minuteOfDay -= MINUTES_PER_DAY;
      this.dayIndex++;
    }
  }

  get date() {
    const d = new Date((this.epochDay + this.dayIndex) * 86400000);
    return d;
  }
  get hour() { return Math.floor(this.minuteOfDay / 60); }
  get minute() { return this.minuteOfDay % 60; }
  /** 0..1 through the day. */
  get dayFraction() { return this.minuteOfDay / MINUTES_PER_DAY; }
  get month() { return this.date.getUTCMonth(); }
  get dayOfMonth() { return this.date.getUTCDate(); }
  get dayOfWeek() { return this.date.getUTCDay(); }
  get isWeekend() { const d = this.dayOfWeek; return d === 0 || d === 6; }
  get dayOfYear() {
    const d = this.date;
    return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  }

  get season() {
    const m = this.month;
    return ISLAND_SEASONS.find((s) => s.months.includes(m)) || ISLAND_SEASONS[0];
  }
  /** Southern-hemisphere meteorological season, for anything that needs the familiar name. */
  get southernSeason() {
    const m = this.month;
    if (m === 11 || m <= 1) return 'summer';
    if (m <= 4) return 'autumn';
    if (m <= 7) return 'winter';
    return 'spring';
  }

  /** School holidays and long weekends drive the visitor curve harder than anything else here. */
  get isQldSchoolHoliday() {
    const doy = this.dayOfYear;
    return (doy <= 24) || (doy >= 350) ||          // summer break
      (doy >= 92 && doy <= 106) ||                  // April
      (doy >= 179 && doy <= 193) ||                 // late June/July
      (doy >= 262 && doy <= 276);                   // late September
  }

  format() {
    const h = this.hour;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12)}:${String(this.minute).padStart(2, '0')}${ampm}`;
  }
  formatDate() {
    const d = this.date;
    return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
  }

  save() {
    return { epochDay: this.epochDay, tick: this.tick, minuteOfDay: this.minuteOfDay, dayIndex: this.dayIndex };
  }
  restore(s) {
    Object.assign(this, s);
  }
}
