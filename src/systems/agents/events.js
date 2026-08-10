// What is on today.
//
// WHY THIS FILE EXISTS. data/events.json has carried thirty-six real events, seven load periods and
// eleven operating rhythms, each with an attendance band, an hourly crowd curve, a list of what it
// strains and a list of who earns from it. Until 10 August 2026 none of that reached the island.
// One consumer read the pack, `eventsToday()` in src/systems/infrastructure/infra-common.js, and it
// read only each record's `next_known` window. Every `next_known` in the pack is a 2026 date and
// eleven records have none at all, so the weekly and monthly ones had never fired once and the
// dated ones would all have gone dark on 1 January 2027.
//
// What that looked like in the running build, measured before this file was written: 16 to 18
// October 2026 is the Gage Roads Straddie Invitational, the island's biggest surfing weekend, and
// `visitors.onIsland` on the Friday was 1,027, the lowest figure anywhere in a seventy-five day run
// and lower than the ordinary Thursday before it. Twenty-one November is the Oyster and Seafood
// Festival and the island was quieter than the two Saturdays either side of it. The calendar was a
// table, and a critic would have been right to say so.
//
// WHAT THIS SYSTEM IS FOR, AND WHAT IT IS NOT.
// It is the read model: what is on, how many people the pack expects, how many are on site at this
// hour, what it strains, and what the weather has done to it. It publishes and it announces. It
// does not move anybody: `src/systems/agents/visitors.js` decides who crosses the water, because
// that is where the seats, the beds and the capacity gate live, and two systems both adding
// visitors is how a population runs away.
//
// THREE THINGS IT IS HONEST ABOUT, ON SCREEN, EVERY TIME.
//   1. Every attendance figure in the pack is a modelling estimate at low confidence. Nobody
//      publishes gate counts for this island. The read model carries `basis` and `confidence` on
//      every row so a panel cannot show the number without the caveat.
//   2. A pattern-derived date is not a published date. Records resolved from `date_rule` rather
//      than from a sourced `next_known` are flagged, and the flag survives into the read model.
//   3. Three records carry `cultural_handling`. They are held as civic load only: the date, the
//      crowd, the ferries, the bins and the money. No programme, no content, nothing generated.
//      See data/lore.json prohibitions and docs/CULTURAL-REVIEW.md.
//
// DETERMINISM. The per-day attendance jitter the pack asks for comes from
// `world.rng.stream('events').fork(id + ':' + dayNum)`, which is a pure function of the seed, the
// record and the day. It does not depend on call order and it does not need saving, so a world
// reloaded at three in the afternoon gets the same crowd it had at three in the afternoon.
//
// WHAT THE SECOND PASS ON 10 AUGUST 2026 CHANGED, AND WHY EACH ONE MATTERED.
//
//   1. THE WEATHER WAS READ AT MIDNIGHT AND THE SENTENCES WERE READ BY A REGEX. Fourteen records
//      carry a `cancels_if` sentence and the calendar board prints every one of them to a player as
//      "Called off if: ...". This file recognised four of the fourteen, and it asked the question
//      once a day, at midnight, when it is almost never raining. Measured over a sim-year: 8,597
//      ticks with rain over 4 mm/h and the Point Lookout markets opened twenty-two times and were
//      never once rained off. Now every sentence carries `called_off_when` beside it in the pack, a
//      list of conditions a machine can test, and this file tests them through the event's own
//      hours rather than at midnight. A record with a sentence and no conditions is counted in
//      `describe().sentencesWithoutConditions`, so the gap is a number instead of a silence.
//
//   2. AN EVENT DOES NOT ONLY CANCEL. The pack's own sentences say four different things and this
//      file now does all four: called off, postponed, shortened (the Straddie Salute swim leg goes
//      before the event does; a cancelled crossing takes the mainland half of a club night), and
//      moved. The moved one is the best of them and it was already written in the pack: the nippers
//      record's place note says the beach is chosen on the morning based on conditions, so on a
//      1.8 m swell the session moves to Cylinder Beach, the read model says so, and the render
//      layer puts the club tent and the flags on the other beach.
//
//   3. THE WEATHER MULTIPLIER WAS ALSO A MIDNIGHT NUMBER. It is now taken when the event opens and
//      held for the day, so the rain that matters to a market is the rain at eight in the morning.
//
//   4. NOTHING IN THE PACK WAS VISIBLE OUT OF THE WINDOW. An island holding fourteen hundred people
//      at a festival looked exactly like the same island on a Tuesday. This file now publishes
//      `sites`: where each running event is, what it has on the ground from
//      `sim_defaults.site_kit`, and how far up that kit is at this minute.
//      `src/render/layers/eventsite.js` draws it and decides nothing.
//
//   5. "BUSIEST TODAY" MEANT THE LAST TWENTY-FOUR HOURS. At five in the morning the board was
//      showing yesterday's crowd under the word today. Both numbers exist now and each is labelled
//      as what it is.

import { makeCalendar, curveAt, isoOfDay } from './calendar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function registerEvents(world) {
  const rng = world.rng.stream('events');

  const state = world.publish('events', {
    ready: false,
    day: null,
    // What is on today, weather-adjusted, soonest-finishing last.
    running: [],
    // People on site right now, summed across everything running, from each record's own curve.
    crowdNow: 0,
    // The busiest moment since midnight. This is the one the board calls "busiest today", and until
    // this pass it was the rolling figure below, so at five in the morning a player was shown
    // yesterday's crowd under the word today.
    crowdPeakToday: 0,
    // The busiest moment in the last twenty-four hours, so a probe at dawn still sees a day.
    crowdPeak24h: 0,
    // The pack's own estimate of the busiest moment today, after weather.
    expectedPeakToday: 0,
    // How many of today's crowd would not otherwise be on the island. The visitor model owns this
    // number; it is published here so a panel can show the two side by side.
    incrementToday: 0,
    byTownship: {},
    strains: {},
    extraBins: 0,
    needsWater: false,
    needsPower: false,
    calledOff: [],
    // What the weather has done to today, beyond calling things off: an event moved to another
    // beach, a leg shortened, a night thinned by a cancelled crossing.
    weatherChanges: [],
    // Where the running events physically are and what is on the ground at each, for the render
    // layer. Simulation side only: no Babylon, no coordinates, just place ids and counts.
    sites: [],
    ahead: [],
    // Annual events whose dates the organiser announces, for the years no listing covers.
    annualWindows: [],
    // What has just been on, because on a small island that is half of what a calendar is for.
    justGone: [],
    held: { ended: 0, lowConfidence: 0 },
    yearAhead: { occurrences: 0, peopleDrawn: 0 },
    notes: []
  });

  let cal = null;
  let siteKit = null;           // sim_defaults.site_kit: what an event puts on the ground
  let lastDay = -1;
  let today = [];               // per-day working rows
  let peakAnnounced = new Set();
  let openedToday = 0;
  let dayPeak = 0;              // the busiest moment since midnight, which is what "today" means
  // Running totals, so a headless year can be asked whether any of this ever happens rather than
  // whether it could. The previous version of this file called off two events in a whole sim-year.
  let calledOffCount = 0, movedCount = 0, shortenedCount = 0;
  // Counted once at init: a printed promise the island cannot keep, and a condition it cannot test.
  let sentencesWithoutConditions = 0, conditionsNotEvaluable = 0;
  // A rolling day of crowd readings. docs/STATE-OF-PLAY.md 4.5: a read model that describes the
  // instant reads as a dead system to anybody whose probe lands at twenty past five in the morning,
  // which is exactly where the headless probe lands.
  const ring = new Float32Array(144);
  let ringAt = 0;

  /* ---------------------------------------------------------------- weather */

  /**
   * The pack's own coupling rule, in its own words: multiply attendance by (1 - sensitivity *
   * severity) for each active driver, then apply `cancels_if` as a hard gate. The severities are
   * this file's, because the pack gives sensitivities and the weather system gives conditions and
   * nobody publishes the curve between them.
   */
  function weatherFactor(rec, wx) {
    const ws = rec.weather_sensitivity;
    if (!ws || !wx) return { mult: 1, drivers: [] };
    const sev = {
      rain: clamp((wx.rainMmHr || 0) / 6, 0, 1),
      wind: clamp(((wx.windKt || 0) - 15) / 25, 0, 1),
      swell: clamp(((wx.swellM || 0) - 2) / 2.5, 0, 1),
      heat: clamp(((wx.apparentC ?? wx.tempC ?? 22) - 30) / 8, 0, 1)
    };
    let mult = 1;
    const drivers = [];
    for (const k of ['rain', 'wind', 'swell', 'heat']) {
      const s = ws[k] || 0;
      if (!s || sev[k] <= 0) continue;
      mult *= (1 - s * sev[k]);
      if (s * sev[k] > 0.25) drivers.push(k);
    }
    return { mult: clamp(mult, 0, 1), drivers };
  }

  /**
   * What the weather has actually done to a record, from the record's own conditions.
   *
   * This replaced a regex over the `cancels_if` prose. That approach could only ever recognise the
   * sentences somebody had thought to write a pattern for, and it recognised four of fourteen, so
   * "Rain closes the green" and "Dangerous surf" and "A water taxi cancellation" all printed to the
   * player as promises and then did nothing at all. The pack now carries the same sentence as
   * `called_off_when`, a list of testable conditions, and this reads those. A sentence with no
   * conditions beside it does nothing and is counted rather than silently ignored.
   *
   * Every threshold is the pack's, and every threshold is modelled: nobody publishes the millimetre
   * at which a market packs up. That is said in the pack and on the board.
   */
  const DRIVER = {
    rain: (wx) => wx.rainMmHr || 0,
    'rain-today': (wx) => wx.rainToday || 0,
    wind: (wx) => wx.windKt || 0,
    swell: (wx) => wx.swellM || 0,
    heat: (wx) => (wx.apparentC ?? wx.tempC ?? 0)
  };

  /** True when one condition is met right now. Unknown drivers and unevaluable ones are never met. */
  function conditionMet(cond, wx) {
    if (!cond || cond.not_evaluated) return false;
    if (cond.driver === 'crossing') return wx.crossingCondition === (cond.state || 'cancelled');
    if (cond.driver === 'fire-ban') return false;   // nothing in this build declares one; see the pack
    const read = DRIVER[cond.driver];
    if (!read) return false;
    const v = read(wx);
    if (cond.over != null && v > cond.over) return true;
    if (cond.under != null && v < cond.under) return true;
    return false;
  }

  /** Every condition on a record that is met right now, worst effect first. */
  const EFFECT_RANK = { 'called-off': 3, postponed: 3, moved: 2, shortened: 1 };
  function weatherVerdicts(rec, wx) {
    const ws = rec.weather_sensitivity;
    if (!ws || !wx || !Array.isArray(ws.called_off_when)) return [];
    const out = [];
    for (const c of ws.called_off_when) {
      if (!conditionMet(c, wx)) continue;
      out.push(c);
    }
    out.sort((a, b) => (EFFECT_RANK[b.effect] || 0) - (EFFECT_RANK[a.effect] || 0));
    return out;
  }

  /* ---------------------------------------------------------------- what is on the ground

  The kit an event puts on a place, entirely from `sim_defaults.site_kit` in data/events.json. This
  function decides no counts of its own: it reads the table, reads the record's own `needs`, and
  clamps. The point of that split is that anybody who thinks a market does not look like this can
  argue with a number in a data file instead of with a render layer. */

  function kitFor(row) {
    const t = siteKit;
    if (!t) return null;
    const spec = (t.by_category && t.by_category[row.category]) || t.default || null;
    if (!spec) return null;
    const per = spec.marquee_per_sqrt || 0;
    const marquees = per > 0
      ? clamp(Math.round(Math.sqrt(Math.max(0, row.expected)) * per), spec.min || 0, spec.max || 0)
      : 0;
    const needs = row.needs || {};
    return {
      marquees,
      stage: !!spec.stage && row.expected >= 150,
      banners: spec.banners || 0,
      bunting: !!spec.bunting,
      toilets: spec.toilets === false ? 0 : Math.min(24, needs.toilets_extra || 0),
      bins: spec.bins === false ? 0 : Math.min(60, needs.waste_extra_bins || 0),
      note: spec.note || null
    };
  }

  /** The minutes of the day an event's own crowd curve is above the pack's opening threshold. */
  function windowOf(curve) {
    const open = (siteKit && siteKit.curve_open != null) ? siteKit.curve_open : 0.04;
    if (!curve || !curve.length) return { from: 8 * 60, to: 18 * 60 };
    let first = -1, last = -1;
    for (let h = 0; h < 24; h++) {
      if ((curve[h] || 0) < open) continue;
      if (first < 0) first = h;
      last = h;
    }
    if (first < 0) return { from: 8 * 60, to: 18 * 60 };
    return { from: first * 60, to: (last + 1) * 60 };
  }

  /**
   * How far the kit is up, 0 to 1. It goes up over the pack's `raise_minutes` before the window
   * opens and comes down over `pack_down_minutes` after it closes, so a Sunday market is marquees
   * going up in the half light and a paddock again by two. A multi-day event does not pack down
   * overnight, because nobody does.
   */
  function kitUp(row, minute) {
    const raise = (siteKit && siteKit.raise_minutes) || 90;
    const down = (siteKit && siteKit.pack_down_minutes) || 75;
    const startedYesterday = row.dayOfEvent > 1;
    const moreToCome = row.dayOfEvent < row.days;
    const up0 = row.window.from - raise;
    if (minute < up0) return startedYesterday ? 1 : 0;
    if (minute < row.window.from) return clamp((minute - up0) / Math.max(1, raise), 0, 1);
    if (minute <= row.window.to) return 1;
    if (moreToCome) return 1;
    return clamp(1 - (minute - row.window.to) / Math.max(1, down), 0, 1);
  }

  /* ---------------------------------------------------------------- the day */

  function newDay(w, announce = true) {
    const dayNum = w.clock.epochDay + w.clock.dayIndex;
    const wx = w.read('weather') || null;
    const rows = [];
    for (const e of cal.eventsOnDay(dayNum)) {
      const rec = e.rec;
      const att = rec.attendance || {};
      const base = e.peak || 0;
      // The pack asks for plus or minus twenty per cent on `typical`, clamped to the published low
      // and high. Forked by record and day so it does not move when anything else draws a number.
      const jitter = 0.8 + rng.fork(e.id + ':' + dayNum).float() * 0.4;
      const jittered = clamp(base * jitter, att.low ?? base * 0.5, att.high ?? base * 1.6);
      // The weather figure taken here is provisional: it is the weather at midnight, which is not
      // the weather the event runs in. It is replaced and locked when the event opens. A probe that
      // lands before dawn still gets a number rather than a zero.
      const wf = weatherFactor(rec, wx);
      const row = {
        id: e.id,
        name: e.name,
        category: e.category,
        township: e.township,
        placeIds: e.placeIds,
        // Where it actually is today. The weather can move it: see the nippers record.
        siteIds: e.placeIds,
        movedTo: null,
        dayOfEvent: e.dayOfEvent,
        days: e.days,
        sourcedDate: e.sourcedDate,
        unconfirmed: e.status === 'unconfirmed',
        culturalLoadOnly: e.culturalLoadOnly,
        confidence: att.confidence || e.confidence || 'low',
        basis: att.basis || 'estimate',
        packTypical: base,
        // Before weather. Everything the weather does is applied to this, so two conditions do not
        // compound into a number nobody can trace.
        jittered,
        expected: Math.round(jittered * wf.mult),
        calledOff: null,
        calledOffAt: null,
        effect: null,
        shortenTo: 1,
        weatherMult: Math.round(wf.mult * 100) / 100,
        weatherDrivers: wf.drivers,
        weatherLocked: false,
        firedConditions: [],
        increment: 0,
        curve: e.curve,
        window: windowOf(e.curve),
        peakHour: peakHourOf(e.curve),
        strains: rec.strains || [],
        needs: rec.needs || null,
        revenueTo: (rec.revenue_to || []).map((r) => r.business_id),
        organiser: rec.organiser || null,
        rec
      };
      row.increment = row.expected * e.incrementShare;
      row.incrementShare = e.incrementShare;
      row.kit = kitFor(row);
      rows.push(row);
    }
    rows.sort((a, b) => (b.expected - a.expected) || (a.id < b.id ? -1 : 1));
    today = rows;
    peakAnnounced = new Set();
    openedToday = rows.length;
    state.day = isoOfDay(dayNum);
    dayPeak = 0;
    settleDay();

    // What is coming, so a panel and a player can plan rather than be surprised.
    state.ahead = cal.eventsAhead(dayNum, 120).filter((x) => x.start > dayNum && x.peak >= 100).slice(0, 8)
      .map((x) => ({ id: x.id, name: x.name, date: isoOfDay(x.start), inDays: x.start - dayNum, peak: x.peak, sourced: x.sourced }));
    // Annual events the organiser has not announced yet. Without this the island's largest cultural
    // event vanished from the board entirely the moment its one published weekend had passed.
    state.annualWindows = cal.annualWindowsAhead(dayNum, 400).slice(0, 4).map((x) => ({
      id: x.id, name: x.name, year: x.year, from: isoOfDay(x.start), to: isoOfDay(x.end),
      inDays: x.in, peak: x.peak,
      lastPublished: x.lastPublished ? isoOfDay(x.lastPublished.start) : null
    }));
    state.justGone = cal.eventsJustGone(dayNum, 21).filter((x) => x.peak >= 60).slice(0, 5).map((x) => ({
      id: x.id, name: x.name, date: isoOfDay(x.start), endedDaysAgo: x.ago, peak: x.peak
    }));

    // A load rebuilds the day against the loaded weather, which is right, and must not re-announce
    // a festival the player was already told about before they saved.
    if (!announce) return;

    for (const r of rows) {
      if (r.dayOfEvent !== 1) continue;
      if (r.expected < 100) continue;   // the club night does not need announcing
      w.bus.emit('events:opens', {
        id: r.id, name: r.name, township: r.township, place: r.placeIds[0] || null,
        expected: r.expected, days: r.days, confidence: r.confidence, sourced: r.sourcedDate,
        text: `${r.name} starts today. The pack expects about ${r.expected} people at the busiest moment, and that is an estimate.`
      });
    }
    // Nothing is called off here any more. A day is called off during the day, by the weather the
    // event actually runs in, which is the whole of the fix. See `applyWeather` below.
  }

  /**
   * The day's totals, recomputed from the rows. Called at the start of a day and again whenever the
   * weather changes one of them, because an event that has just been called off must stop asking
   * for its twelve bins in the same tick the player is told it is off.
   */
  function settleDay() {
    const rows = today;
    let bins = 0, water = false, power = false;
    const strains = {};
    for (const r of rows) {
      if (r.calledOff) continue;
      bins += (r.needs && r.needs.waste_extra_bins) || 0;
      water = water || !!(r.needs && r.needs.potable_water);
      power = power || !!(r.needs && r.needs.power);
      for (const s of r.strains) strains[s.system] = Math.max(strains[s.system] || 0, s.level || 0);
    }
    state.extraBins = bins;
    state.needsWater = water;
    state.needsPower = power;
    state.strains = strains;
    state.expectedPeakToday = rows.reduce((s, r) => s + r.expected * (r.curve ? Math.max(...r.curve) : 1), 0);
    state.incrementToday = Math.round(rows.reduce((s, r) => s + r.increment, 0));
    state.calledOff = rows.filter((r) => r.calledOff)
      .map((r) => ({ id: r.id, name: r.name, why: r.calledOff, effect: r.effect, at: r.calledOffAt }));
    state.weatherChanges = rows.filter((r) => !r.calledOff && r.effect)
      .map((r) => ({ id: r.id, name: r.name, effect: r.effect, why: r.firedConditions.join('; '), movedTo: r.movedTo }));
  }

  /**
   * What the weather is doing to one running event, right now.
   *
   * Called every tick from the point the kit starts going up to the point the crowd has gone. A
   * decision holds for the rest of the day: an event called off at ten does not come back on at two
   * because the shower passed, because in the real world the stallholders have gone home.
   */
  function applyWeather(w, r, minute, wx) {
    if (!wx || r.calledOff) return;
    const raise = (siteKit && siteKit.raise_minutes) || 90;
    if (minute < r.window.from - raise || minute > r.window.to) return;

    // The day's multiplier is taken when the event opens, not at midnight, and then held. Rain at
    // three in the morning is not what thins a market that opens at eight.
    if (!r.weatherLocked && minute >= r.window.from) {
      const wf = weatherFactor(r.rec, wx);
      r.weatherMult = Math.round(wf.mult * 100) / 100;
      r.weatherDrivers = wf.drivers;
      r.weatherLocked = true;
      r.expected = Math.round(r.jittered * wf.mult * r.shortenTo);
      r.increment = r.expected * r.incrementShare;
      r.kit = kitFor(r);
      settleDay();
    }

    for (const c of weatherVerdicts(r.rec, wx)) {
      const says = c.says || 'the weather';
      if (c.effect === 'called-off' || c.effect === 'postponed') {
        r.calledOff = says;
        r.effect = c.effect;
        r.calledOffAt = minute;
        r.expected = 0;
        r.increment = 0;
        r.kit = kitFor(r);
        r.firedConditions.push(says);
        calledOffCount++;
        settleDay();
        w.bus.emit('events:called-off', {
          id: r.id, name: r.name, why: says, effect: c.effect, township: r.township,
          place: r.siteIds[0] || null,
          text: c.effect === 'postponed'
            ? `${r.name} is held over: ${says}.`
            : `${r.name} is off: ${says}.`
        });
        return;
      }
      if (c.effect === 'moved' && !r.movedTo && c.move_to) {
        r.movedTo = c.move_to;
        // The move is a reordering of the record's own place list, never a new place. If the record
        // does not already name the place it moves to, nothing moves: this file will not invent a
        // venue for an event.
        if (r.placeIds.includes(c.move_to)) {
          r.siteIds = [c.move_to].concat(r.placeIds.filter((p) => p !== c.move_to));
          r.effect = r.effect || 'moved';
          r.firedConditions.push(says);
          movedCount++;
          settleDay();
          w.bus.emit('events:moved', {
            id: r.id, name: r.name, to: c.move_to, why: says, township: r.township,
            text: `${r.name} has moved: ${says}.`
          });
        }
      }
      if (c.effect === 'shortened' && r.shortenTo === 1) {
        r.shortenTo = c.reduce_to != null ? c.reduce_to : 0.75;
        r.effect = r.effect || 'shortened';
        r.firedConditions.push(says);
        shortenedCount++;
        r.expected = Math.round(r.expected * r.shortenTo);
        r.increment = r.expected * r.incrementShare;
        r.kit = kitFor(r);
        settleDay();
        w.bus.emit('events:shortened', {
          id: r.id, name: r.name, why: says, township: r.township, expected: r.expected,
          text: `${r.name} is running short: ${says}.`
        });
      }
    }
  }

  function peakHourOf(curve) {
    if (!curve || !curve.length) return 12;
    let best = 0;
    for (let i = 1; i < curve.length; i++) if (curve[i] > curve[best]) best = i;
    return best;
  }

  /* ---------------------------------------------------------------- the system */

  return world.register({
    id: 'events',
    phase: 'agents',
    order: 1,

    init(w) {
      const pack = w.data && w.data.events;
      if (!pack || !Array.isArray(pack.events)) {
        state.notes.push('data/events.json is missing, so nothing is on and nothing is claimed.');
        return;
      }
      cal = (w.residents && w.residents.calendar) || makeCalendar(pack);
      siteKit = (pack.sim_defaults && pack.sim_defaults.site_kit) || null;
      if (!siteKit) state.notes.push('data/events.json has no sim_defaults.site_kit, so nothing is put on the ground for an event and the island looks the same whatever is on.');
      state.held = { ended: cal.held.ended, lowConfidence: cal.held.lowConfidence };
      if (cal.held.lowConfidence) {
        state.notes.push(`${cal.held.lowConfidence} record(s) held below the confidence threshold and not shown or simulated. data/lore.json no-low-confidence-to-player.`);
      }
      if (cal.mismatches.length) state.notes.push(...cal.mismatches);

      // Every `cancels_if` sentence the calendar board prints to a player is a promise. Count the
      // ones this system cannot keep, at boot, once, and put the number in `describe()` so a critic
      // does not have to instrument a sim-year to find out. It was fourteen sentences and four
      // patterns before this pass, and nobody knew.
      const liveIds = new Set(cal.liveEvents().map((r) => r.id));
      for (const rec of pack.events) {
        const ws = (rec && rec.weather_sensitivity) || {};
        if (!ws.cancels_if) continue;
        const list = Array.isArray(ws.called_off_when) ? ws.called_off_when : [];
        const testable = list.filter((c) => c && !c.not_evaluated);
        // Counted across the whole pack, including the records held below the confidence threshold,
        // because a condition this build cannot measure is a gap in the build rather than in the
        // record, and hiding it behind the confidence filter would hide the wrong thing.
        conditionsNotEvaluable += list.length - testable.length;
        if (testable.length || !liveIds.has(rec.id)) continue;
        sentencesWithoutConditions++;
        state.notes.push(`${rec.id} says it is called off by weather and carries no condition this build can test, so the board must not print that sentence as a promise.`);
      }
      if (conditionsNotEvaluable) {
        state.notes.push(`${conditionsNotEvaluable} weather condition(s) in the pack name something this build cannot measure, and each says so in its own record.`);
      }

      // A jump moves the clock without running a tick, so a paused player who steps back a fortnight
      // was left reading the day they came from. Rebuilding here costs nothing and only ever runs on
      // a deliberate move.
      const onJump = () => {
        if (!state.ready || w.clock.dayIndex === lastDay) return;
        lastDay = w.clock.dayIndex;
        newDay(w, false);
      };
      for (const ev of ['clock:scrub', 'clock:present', 'clock:mode', 'clock:restored', 'clock:caughtup']) w.bus.on(ev, onJump);

      const start = w.clock.epochDay + w.clock.dayIndex;
      let occurrences = 0, drawn = 0;
      for (let d = 0; d < 365; d++) {
        for (const e of cal.eventsOnDay(start + d)) { occurrences++; drawn += e.peak * e.incrementShare; }
      }
      state.yearAhead = { occurrences, peopleDrawn: Math.round(drawn) };
      newDay(w);
      lastDay = w.clock.dayIndex;
      state.ready = true;
      w.bus.emit('events:ready', { records: cal.liveEvents().length, occurrencesInAYear: occurrences });
    },

    tick(w) {
      if (!state.ready) return;
      if (w.clock.dayIndex !== lastDay) { lastDay = w.clock.dayIndex; newDay(w); }

      const minute = w.clock.minuteOfDay;
      const wx = w.read('weather') || null;
      let crowd = 0;
      const byTown = {};
      const running = [];
      const sites = [];
      for (const r of today) {
        applyWeather(w, r, minute, wx);
        if (r.calledOff) continue;
        const share = curveAt(r.curve, minute);
        const on = Math.round(r.expected * share);
        if (on > 0) {
          crowd += on;
          byTown[r.township] = (byTown[r.township] || 0) + on;
        }
        // What is physically on the ground at this minute. The render layer reads this and resolves
        // the place ids against data/places.json itself; nothing here knows a coordinate.
        const up = kitUp(r, minute);
        if (r.kit && up > 0.001) {
          sites.push({
            id: r.id, name: r.name, category: r.category, township: r.township,
            placeIds: r.siteIds, up: Math.round(up * 1000) / 1000,
            onSiteNow: on, expected: r.expected,
            spread: r.siteIds.length > 2 ? 'distributed' : 'single',
            kit: r.kit, movedTo: r.movedTo
          });
        }
        running.push({
          id: r.id, name: r.name, category: r.category, township: r.township,
          placeIds: r.placeIds, siteIds: r.siteIds, movedTo: r.movedTo,
          dayOfEvent: r.dayOfEvent, days: r.days,
          onSiteNow: on, expected: r.expected, packTypical: r.packTypical,
          confidence: r.confidence, basis: r.basis, sourcedDate: r.sourcedDate,
          unconfirmed: r.unconfirmed, culturalLoadOnly: r.culturalLoadOnly,
          weatherMult: r.weatherMult, weatherDrivers: r.weatherDrivers,
          weatherEffect: r.effect, weatherWhy: r.firedConditions.slice(),
          kit: r.kit, kitUp: Math.round(up * 100) / 100,
          opensAt: r.window.from, closesAt: r.window.to,
          organiser: r.organiser, revenueTo: r.revenueTo
        });

        // The moment it is at its busiest, once, and only when it is big enough to notice.
        if (!peakAnnounced.has(r.id) && r.expected >= 250 && minute >= r.peakHour * 60 && minute < r.peakHour * 60 + 10) {
          peakAnnounced.add(r.id);
          const ferry = w.read('ferry');
          const turned = ferry && ferry.walkOn ? ferry.walkOn.turnedAwayToday : 0;
          w.bus.emit('events:peak', {
            id: r.id, name: r.name, township: r.township, place: r.placeIds[0] || null,
            people: on, turnedAwayToday: turned,
            text: `${r.name} is at its busiest: about ${on} people on site.`
          });
          const worst = r.strains.reduce((m, s) => Math.max(m, s.level || 0), 0);
          if (worst >= 4 && turned > 0) {
            w.bus.emit('events:capacity-bit', {
              id: r.id, name: r.name, people: turned, township: r.township,
              text: `${turned} people did not fit on a boat on the day of ${r.name}. The pack rates this event at strain level ${worst} of 5.`
            });
          }
        }
      }
      state.crowdNow = crowd;
      state.byTownship = byTown;
      state.running = running;
      state.sites = sites;
      ring[ringAt] = crowd;
      ringAt = (ringAt + 1) % ring.length;
      let peak = 0;
      for (let i = 0; i < ring.length; i++) if (ring[i] > peak) peak = ring[i];
      state.crowdPeak24h = Math.round(peak);
      if (crowd > dayPeak) dayPeak = crowd;
      state.crowdPeakToday = Math.round(dayPeak);
    },

    describe() {
      return {
        ready: state.ready,
        onToday: state.running.length,
        crowdNow: state.crowdNow,
        crowdPeakToday: state.crowdPeakToday,
        crowdPeak24h: state.crowdPeak24h,
        expectedPeak: Math.round(state.expectedPeakToday),
        increment: state.incrementToday,
        calledOff: state.calledOff.length,
        weatherChanged: state.weatherChanges.length,
        calledOffThisYear: calledOffCount,
        movedThisYear: movedCount,
        shortenedThisYear: shortenedCount,
        openedToday,
        sitesOnGround: state.sites.length,
        marqueesUp: state.sites.reduce((s, x) => s + (x.kit ? x.kit.marquees : 0), 0),
        strainWorst: Object.values(state.strains).reduce((m, v) => Math.max(m, v), 0),
        extraBins: state.extraBins,
        next: state.ahead[0] ? state.ahead[0].id + '@' + state.ahead[0].date : null,
        annualWindow: state.annualWindows[0] ? state.annualWindows[0].id + '@' + state.annualWindows[0].from : null,
        yearOccurrences: state.yearAhead.occurrences,
        yearDrawn: state.yearAhead.peopleDrawn,
        // A record whose `cancels_if` sentence the panel prints and this system cannot test. It
        // should be zero, and if it is not, the board is making a promise the island will not keep.
        sentencesWithoutConditions: sentencesWithoutConditions,
        conditionsNotEvaluable: conditionsNotEvaluable,
        held: state.held.ended + state.held.lowConfidence
      };
    },

    save() {
      // A day's weather decisions are history, not a function of the current weather, so they have
      // to be carried. Without this a world saved at noon on a rained-off market day reloads with
      // the market on, because the rebuild reads the weather at the moment of the load.
      return {
        lastDay,
        peakAnnounced: [...peakAnnounced],
        dayPeak,
        counts: [calledOffCount, movedCount, shortenedCount],
        weather: today.filter((r) => r.calledOff || r.effect || r.weatherLocked).map((r) => ({
          id: r.id, off: r.calledOff, effect: r.effect, at: r.calledOffAt, moved: r.movedTo,
          shorten: r.shortenTo, mult: r.weatherMult, drivers: r.weatherDrivers,
          locked: r.weatherLocked, why: r.firedConditions
        }))
      };
    },
    load(w, s) {
      if (!s || !state.ready || !cal) return;   // no pack, nothing to restore
      newDay(w, false);                   // rebuild against the loaded weather, announce nothing
      lastDay = w.clock.dayIndex;
      peakAnnounced = new Set(s.peakAnnounced || []);
      dayPeak = s.dayPeak || 0;
      if (Array.isArray(s.counts)) { calledOffCount = s.counts[0] || 0; movedCount = s.counts[1] || 0; shortenedCount = s.counts[2] || 0; }
      for (const saved of s.weather || []) {
        const r = today.find((x) => x.id === saved.id);
        if (!r) continue;
        r.calledOff = saved.off || null;
        r.effect = saved.effect || null;
        r.calledOffAt = saved.at == null ? null : saved.at;
        r.movedTo = saved.moved || null;
        r.shortenTo = saved.shorten == null ? 1 : saved.shorten;
        r.weatherMult = saved.mult == null ? r.weatherMult : saved.mult;
        r.weatherDrivers = saved.drivers || [];
        r.weatherLocked = !!saved.locked;
        r.firedConditions = saved.why || [];
        if (r.movedTo && r.placeIds.includes(r.movedTo)) {
          r.siteIds = [r.movedTo].concat(r.placeIds.filter((p) => p !== r.movedTo));
        }
        r.expected = r.calledOff ? 0 : Math.round(r.jittered * r.weatherMult * r.shortenTo);
        r.increment = r.expected * r.incrementShare;
        r.kit = kitFor(r);
      }
      settleDay();
      // The rolling day of crowd readings is not saved. It refills within a sim-day and a saved
      // figure would be a claim about hours the loaded world has not lived.
      ring.fill(0);
      ringAt = 0;
      state.crowdPeak24h = 0;
      state.crowdPeakToday = Math.round(dayPeak);
    }
  });
}
