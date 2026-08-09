// The shape of the day, and what bends it.
//
// This system does not tell anybody what to do. It works out what the day *asks* of a person: the
// shift, the school gate, the boat, the roster, the appointment. needs.js then decides whether they
// do it, because a person who has been awake since four and has not eaten will break a shift, and
// the break is where the drama is. That split is the pack's own instruction: use the rhythm blocks
// as intentions, not as a script.
//
// WHAT THE DAY IS MADE OF HERE
//   The ferry timetable. Everything on Minjerribah is downstream of it. The published departures in
//   data/transport.json are used literally: the Flyer's 05:15 out of One Mile is the boat the
//   commuters catch, the 20:15 out of Cleveland is the last one home, and if the weather has
//   stopped the boats then somebody who crossed this morning does not come back tonight.
//   The school. Dunwich State School on Bingle Road is Prep to Year 6 and it is the only school on
//   the island, so the primary run converges on Dunwich from all three townships and every
//   secondary student is on a boat before seven.
//   Shift work. The occupations pack publishes shift windows and a seasonal multiplier for each
//   occupation, and a winter risk where hours are cut. A cook works sixty hours in January and
//   twenty in June, and that difference is the rent.
//   Volunteers. The surf club patrols weekends and public holidays from the first weekend of the
//   September school holidays to the first weekend in May, in the club's own published words. The
//   rural fire brigade turns out when the fire danger says so, and it pulls people off paid work.
//   Bin night. Redland City Council collects on the island on Mondays, so the bins go out on Sunday
//   afternoon, and a Monday public holiday is the specific failure.
//
// It publishes the day's context for needs.js and for anything else that wants to know what today
// is doing: the sailings, whether the buses are running, whether the beach is drivable, whether the
// markets are on. It never mutates a need and it never chooses an action.

const HHMM = /^(\d{1,2}):(\d{2})$/;
const mins = (s) => {
  const m = HHMM.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Which occupations are paid by the tourist year rather than the ordinary one. */
const SEASONAL = /hospitality|cafe|bar|housekeeper|cleaner|campground|grocery|retail|tour|dive|surf|letting|publican|venue|deckhand|attendant|skipper|bus-driver/;

export function registerSchedule(world) {
  const rng = world.rng.stream('schedule');

  const state = world.publish('schedule', {
    ready: false,
    day: null,
    marketDay: false,
    binNight: false,
    binNightBasis: 'published: Redland City Council collects on the island on Mondays, so bins go out Sunday afternoon',
    busRunning: false,
    boatsRunning: true,
    sailings: { outbound: [], inbound: [], lastBoatHome: null },
    onShift: 0,
    atSchool: 0,
    crossing: 0,
    offIsland: 0,
    stranded: 0,
    onCallout: 0,
    onPatrol: 0,
    volunteers: {},
    plannedToday: 0,
    notes: []
  });

  let R = null;
  let cal = null;
  const ferry = { outbound: [], inbound: [], lastOut: null, lastHome: null, firstOut: null };

  /* -------------------------------------------------------------- the timetable

  Read once from data/transport.json. The Flyer and the SeaLink passenger boat run within minutes
  of each other and the pack says so plainly, so the two walk-on lists are merged and deduplicated:
  an islander catching a boat catches whichever one is next, and that is exactly how it works. */

  function readTimetable(w) {
    const pack = w.data.transport;
    if (!pack || !pack.services) { state.notes.push('data/transport.json is missing: no boats.'); return; }
    const out = new Set(), inb = new Set();
    const takeList = (arr, set) => { for (const t of arr || []) { const m = mins(t); if (m != null) set.add(m); } };
    const takeObjs = (arr, set) => { for (const o of arr || []) { const m = mins(o && o.time); if (m != null) set.add(m); } };

    for (const svc of pack.services) {
      const sch = svc.schedule;
      if (!sch || !sch.variants) continue;
      for (const v of sch.variants) {
        takeList(v.one_mile_to_cleveland, out);
        takeList(v.dunwich_to_cleveland, out);
        takeList(v.cleveland_to_one_mile, inb);
        takeList(v.cleveland_to_dunwich, inb);
        // The vehicle ferry publishes its departures as objects with a vessel and a day list.
        if (Array.isArray(v.dunwich_to_cleveland) && typeof v.dunwich_to_cleveland[0] === 'object') takeObjs(v.dunwich_to_cleveland, out);
        if (Array.isArray(v.cleveland_to_dunwich) && typeof v.cleveland_to_dunwich[0] === 'object') takeObjs(v.cleveland_to_dunwich, inb);
        if (v.late_service) {
          const a = mins(v.late_service.one_mile_to_cleveland || v.late_service.dunwich_to_cleveland);
          const b = mins(v.late_service.cleveland_to_one_mile || v.late_service.cleveland_to_dunwich);
          if (a != null) out.add(a);
          if (b != null) inb.add(b);
        }
      }
    }
    ferry.outbound = Array.from(out).sort((a, b) => a - b);
    ferry.inbound = Array.from(inb).sort((a, b) => a - b);
    ferry.firstOut = ferry.outbound[0] ?? null;
    ferry.lastOut = ferry.outbound[ferry.outbound.length - 1] ?? null;
    ferry.lastHome = ferry.inbound[ferry.inbound.length - 1] ?? null;
    state.sailings = {
      outbound: ferry.outbound.map(fmt),
      inbound: ferry.inbound.map(fmt),
      lastBoatHome: ferry.lastHome != null ? fmt(ferry.lastHome) : null,
      firstBoatOut: ferry.firstOut != null ? fmt(ferry.firstOut) : null,
      source: 'data/transport.json published departures, walk-on operators merged'
    };
  }

  const nextOut = (m) => { for (const t of ferry.outbound) if (t >= m) return t; return null; };
  const nextIn = (m) => { for (const t of ferry.inbound) if (t >= m) return t; return null; };

  /* -------------------------------------------------------------- volunteers

  Modelled, and flagged as modelled: no roster or membership figure for any of these organisations
  was found in a pack. What is published is that Point Lookout Surf Life Saving Club patrols two
  beaches and rove-patrols six more every weekend and public holiday for seven and a half months,
  and that the rural fire brigade's season runs August to November. The counts below are a
  modelling choice sized to make those published commitments possible to staff. */

  const VOLUNTEER_TARGETS = [
    { id: 'slsc', label: 'Point Lookout Surf Life Saving Club', want: 90, township: 'point-lookout', minAge: 14, maxAge: 62 },
    { id: 'rural-fire', label: 'NSI Rural Fire Brigade', want: 45, township: null, minAge: 20, maxAge: 66 },
    { id: 'vmr', label: 'VMR North Stradbroke', want: 35, township: null, minAge: 22, maxAge: 74 },
    { id: 'bushcare', label: 'Point Lookout Bushcare and Friends of Stradbroke Island', want: 40, township: null, minAge: 30, maxAge: 84 }
  ];

  function assignVolunteers() {
    const counts = {};
    for (const v of VOLUNTEER_TARGETS) {
      const pool = R.people
        .filter((p) => !p.volunteer && p.age >= v.minAge && p.age <= v.maxAge
          && (!v.township || p.townshipId === v.township || rng.float() < 0.25))
        .map((p) => ({ p, s: p.traits.civic * 2 + (v.id === 'slsc' || v.id === 'vmr' ? p.traits.water : p.traits.outdoors) + rng.float() * 0.5 }))
        .sort((a, b) => b.s - a.s);
      let n = 0;
      for (const { p } of pool) {
        if (n >= v.want) break;
        p.volunteer = v.id;
        p.volunteerLabel = v.label;
        n++;
      }
      counts[v.id] = n;
    }
    state.volunteers = counts;
    state.volunteersBasis = 'modelled. No membership or roster figure for any of these organisations is published in the packs.';
  }

  /* -------------------------------------------------------------- the working week

  How many days somebody works this week, and which ones. Deterministic per person and per week, so
  a roster is a roster rather than a coin toss every morning. The seasonal multiplier and the winter
  risk both come from the occupation record in data/residents.json. */

  function weekIndex(w) { return Math.floor((w.clock.epochDay + w.clock.dayIndex) / 7); }

  function seasonFactor(p, today) {
    const s = p.seasonality;
    if (!s) return 1;
    const peaks = s.peak || [];
    const mult = s.multiplier || 1;
    let f = 1;
    const inPeak = (today.isSchoolHoliday && peaks.some((x) => /school-holidays/.test(x)))
      || (today.isLongWeekend && peaks.includes('long-weekends'))
      || (today.isWeekend && peaks.includes('weekends'))
      || (today.isWhaleSeason && peaks.some((x) => /whale/.test(x)))
      || (today.isPublicHoliday && peaks.length > 0);
    if (inPeak) f *= 1 + Math.min(0.7, (mult - 1) * 0.28);
    // The winter cut. The pack is explicit for hospitality: hours cut hard in June and July, and a
    // campground attendant's hours can go to almost nothing outside the holidays.
    const month = world.clock.month;
    if (s.winter_risk && (month === 5 || month === 6) && !today.isSchoolHoliday) f *= 0.55;
    return f;
  }

  function workDaysThisWeek(p, today, wk) {
    const occ = p.occupationId;
    if (!p.employed || occ === 'unemployed' || occ === 'retired' || occ === 'none' || occ === 'unpaid-carer') return [];
    if (occ === 'primary-student' || occ === 'secondary-student-mainland') return [];

    let base = p.workLoad === 'full-time' ? 5 : p.workLoad === 'part-time' ? 3 : 1;
    if (/teacher|teacher-aide/.test(occ)) {
      if (!today.isTermTime) return [];
      base = p.workLoad === 'full-time' ? 5 : 4;
    }
    if (/island-builder/.test(occ) && today.isBuilderShutdown) return [];
    if (SEASONAL.test(occ)) base = Math.max(1, Math.min(6, Math.round(base * seasonFactor(p, today))));

    // Which days. A fixed per-person ordering, biased by trade: hospitality lives Wednesday to
    // Sunday, offices and the school live Monday to Friday, and a deckhand works whatever the
    // roster says.
    const bias = SEASONAL.test(occ) ? [0.55, 0.5, 0.6, 0.9, 1.0, 1.2, 1.25]
      : /teacher|aide|nurse|health|council|community|remote|commuter|letting/.test(occ) ? [0.05, 1.2, 1.2, 1.2, 1.2, 1.15, 0.1]
        : [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7];
    const scored = [];
    for (let d = 0; d < 7; d++) {
      // Stable hash of person, week and weekday: the same roster all week, a different one next.
      const h = ((p.id * 2654435761) ^ (wk * 40503) ^ (d * 97)) >>> 0;
      scored.push({ d, s: bias[d] * (0.35 + (h % 1000) / 1000) });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, base).map((x) => x.d).sort((a, b) => a - b);
  }

  /* -------------------------------------------------------------- one person's day */

  function planFor(p, w, today, wk) {
    const plan = [];
    const dow = w.clock.dayOfWeek;
    const push = (from, to, kind, reason, at) => {
      if (from == null || to == null) return;
      plan.push({ from, to, kind, reason, at });
    };

    // --- school
    if (p.role === 'primary' && today.isTermTime && dow >= 1 && dow <= 5) {
      if (p.schoolsOnIsland !== false) push(8 * 60 + 40, 15 * 60, 'school', 'Dunwich State School, the only school on the island', 'dunwich-state-school');
      else crossingDay(plan, p, 6 * 60 + 45, 15 * 60 + 30, 'school on the mainland');
    }
    if (p.role === 'secondary' && today.isTermTime && dow >= 1 && dow <= 5) {
      crossingDay(plan, p, 6 * 60 + 15, 15 * 60 + 30, 'high school on the mainland');
    }

    // --- the school run, for a parent of a primary child at the island school
    if (p.age >= 18 && p.hasSchoolKid && today.isTermTime && dow >= 1 && dow <= 5) {
      push(8 * 60, 8 * 60 + 40, 'school-run', 'dropping them at the school gate', 'dunwich-state-school');
      if (!p.worksMorning) push(14 * 60 + 40, 15 * 60 + 20, 'school-run', 'the afternoon pick-up', 'dunwich-state-school');
    }

    // --- paid work
    const days = p._workDays || [];
    if (days.includes(dow)) {
      if (p.occupationId === 'fifo-resources-worker') {
        // Fourteen days on and fourteen off, and the fourteen on are not on this island at all.
        const cycle = Math.floor((w.clock.epochDay + w.clock.dayIndex + (p.id % 28)) / 1) % 28;
        if (cycle < 14) push(0, 1439, 'mainland', 'away on a swing', 'mainland');
      } else if (p.occupationId === 'mainland-commuter-professional') {
        crossingDay(plan, p, 5 * 60 + 15, 16 * 60, 'work on the mainland');
      } else {
        const shift = pickShift(p, w, dow);
        if (shift) {
          push(shift.from, shift.to, 'work', shiftReason(p, shift, today), 'work');
          p.worksMorning = shift.from < 10 * 60;
        }
      }
    }

    // --- volunteer commitments
    if (p.volunteer === 'slsc' && today.isPatrolDay && (p.id + Math.floor(today.dayNum / 7)) % 4 === 0) {
      push(8 * 60, 16 * 60, 'patrol', 'on the roster at the surf club, two patrolled beaches and six more roving', 'point-lookout-slsc');
    }
    if (p.volunteer === 'rural-fire') {
      const weather = w.read('weather');
      const ffdi = weather ? weather.fireDangerIndex : 0;
      if (ffdi > 26 && rng.float() < 0.06) {
        const start = 10 * 60 + rng.int(0, 360);
        push(start, Math.min(1430, start + 60 * rng.int(2, 7)), 'callout', `the brigade turned out: fire danger is ${weather.fireDangerLabel}`, 'island');
      } else if (dow === 3 && !today.isPublicHoliday) {
        push(18 * 60 + 30, 20 * 60 + 30, 'callout', 'brigade training night', 'island');
      }
    }
    if (p.volunteer === 'vmr' && (dow === 0 || dow === 6) && (p.id + Math.floor(today.dayNum / 7)) % 5 === 0) {
      push(6 * 60, 18 * 60, 'callout', 'duty crew on the rescue boat', 'ramp');
    }

    // --- an appointment on the mainland. The pack's own pressure point: specialists are all over
    //     there and one of them eats a whole day.
    if (p.age >= 16 && !plan.length && rng.float() < (p.age >= 70 ? 0.030 : p.age >= 50 ? 0.016 : 0.010)) {
      crossingDay(plan, p, 7 * 60 + 15, 14 * 60, 'a specialist appointment on the mainland');
    }

    plan.sort((a, b) => a.from - b.from);
    return plan;
  }

  /** A day the other side of the bay: out on a boat, over there, back on a boat, or not back. */
  function crossingDay(plan, p, wantOut, wantBack, reason) {
    const out = nextOut(wantOut);
    if (out == null) return;
    const back = nextIn(wantBack);
    plan.push({ from: Math.max(0, out - 25), to: out, kind: 'waiting', reason: `waiting on the ${fmt(out)} boat`, at: 'ferry' });
    plan.push({ from: out, to: out + 30, kind: 'crossing-out', reason, at: 'ferry' });
    if (back == null) {
      plan.push({ from: out + 30, to: 1439, kind: 'stranded', reason: 'there is no boat back tonight', at: 'mainland' });
      return;
    }
    plan.push({ from: out + 30, to: back, kind: 'mainland', reason, at: 'mainland' });
    plan.push({ from: back, to: Math.min(1439, back + 30), kind: 'crossing-back', reason: 'on the boat home', at: 'ferry' });
  }

  function pickShift(p, w, dow) {
    const shifts = (p.shifts || []).filter((s) => mins(s.from) != null && mins(s.to) != null);
    if (!shifts.length) {
      // No published shift window: an ordinary island working day.
      return { from: 7 * 60 + 30, to: 15 * 60 + 30, label: 'a working day' };
    }
    const allowed = shifts.filter((s) => !s.days || s.days.includes(DOW[dow]));
    const pool = allowed.length ? allowed : shifts;
    // A person keeps to the same shift most of the week and swaps occasionally, which is what a
    // two-shift roster on a ferry or in a kitchen actually looks like.
    const idx = ((p.id * 7919) + Math.floor((w.clock.epochDay + w.clock.dayIndex) / 3)) % pool.length;
    const s = pool[idx];
    let from = mins(s.from), to = mins(s.to);
    if (to <= from) to += 24 * 60;            // a bar shift that finishes after midnight
    return { from, to: Math.min(1439, to), label: s.label };
  }

  function shiftReason(p, shift, today) {
    const base = p.employerLabel ? `${shift.label} at ${p.employerLabel}` : shift.label;
    if (today.isSchoolHoliday && SEASONAL.test(p.occupationId)) return `${base}: the island is full`;
    if ((world.clock.month === 5 || world.clock.month === 6) && SEASONAL.test(p.occupationId)) return `${base}, and the hours are thin this month`;
    return base;
  }

  /* -------------------------------------------------------------- the system */

  let planCursor = 0;
  let planning = false;
  let lastDay = -1;
  let today = null;

  return world.register({
    id: 'schedule',
    phase: 'agents',
    order: 20,

    init(w) {
      R = w.residents;
      if (!R || !R.ready) return;
      cal = R.calendar;
      readTimetable(w);
      assignVolunteers();

      // Who has a child at the island school, which is what makes the morning run an island-wide
      // movement rather than a suburban one.
      for (const hh of R.households) {
        const kids = hh.members.map((m) => R.peopleById.get(m)).filter((q) => q && q.role === 'primary' && q.schoolsOnIsland !== false);
        if (!kids.length) continue;
        const adults = hh.members.map((m) => R.peopleById.get(m)).filter((q) => q && q.age >= 18);
        if (adults.length) adults[0].hasSchoolKid = true;
      }

      today = cal.day(w.clock.date);
      state.day = today;
      const wk = weekIndex(w);
      for (const p of R.people) { p._workDays = workDaysThisWeek(p, today, wk); p.plan = planFor(p, w, today, wk); }
      state.ready = true;
      state.plannedToday = R.people.length;
      w.bus.emit('schedule:ready', { sailings: ferry.outbound.length + ferry.inbound.length, volunteers: state.volunteers });
    },

    tick(w) {
      if (!R || !R.ready || !state.ready) return;
      const minute = w.clock.minuteOfDay;
      const weather = w.read('weather') || {};
      const tide = w.read('tide') || {};

      // --- a new day: re-plan everybody, spread over the first two sim-hours so no single tick
      //     carries two thousand plans. The earliest published shift on this island starts at 04:00.
      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        today = cal.day(w.clock.date);
        state.day = today;
        planning = true;
        planCursor = 0;
        const dow = w.clock.dayOfWeek;
        // Redland City Council collects on the island on Mondays, so the bins go out Sunday
        // afternoon. This is published in data/events.json rhythms.bin-day, not modelled.
        state.binNight = dow === 0;
        // Point Lookout markets: published as every second Sunday, at the bowls club.
        state.marketDay = dow === 0 && (Math.floor(today.dayNum / 7) % 2 === 0);
      }
      if (planning) {
        const wk = weekIndex(w);
        const chunk = Math.ceil(R.people.length / 12);
        const end = Math.min(R.people.length, planCursor + chunk);
        for (let i = planCursor; i < end; i++) {
          const p = R.people[i];
          if (!p) continue;
          if (w.clock.dayOfWeek === 1 || !p._workDays) p._workDays = workDaysThisWeek(p, today, wk);
          p.worksMorning = false;
          p.plan = planFor(p, w, today, wk);
        }
        planCursor = end;
        if (planCursor >= R.people.length) { planning = false; state.plannedToday = R.people.length; }
      }

      // --- context the rest of the slice reads
      state.boatsRunning = weather.crossingCondition !== 'cancelled';
      // Route 880 and 881 run to meet the ferries, so the buses are up while the boats are.
      state.busRunning = minute >= 6 * 60 + 30 && minute <= 18 * 60 + 30;
      const mainBeach = (tide.stations && tide.stations.mainbeach) ?? 1.0;
      state.beachDrivingOpen = mainBeach < 0.95;

      // --- resolve today's duty for everybody. A short scan of at most half a dozen windows.
      let onShift = 0, atSchool = 0, crossing = 0, off = 0, stranded = 0, callout = 0, patrol = 0;
      const people = R.people;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const plan = p.plan;
        let duty = null;
        if (plan) {
          for (let k = 0; k < plan.length; k++) {
            const b = plan[k];
            if (minute >= b.from && minute < b.to) { duty = b; break; }
          }
        }

        // The boats stopped. Somebody due to cross does not cross, and somebody already over there
        // does not come home. That second one is the whole drama of living on an island.
        if (duty && !state.boatsRunning) {
          if (duty.kind === 'crossing-out' || duty.kind === 'waiting') {
            duty = { from: duty.from, to: duty.to, kind: 'waiting', reason: 'the crossing is cancelled: too much wind', at: 'ferry' };
            if (!p._toldCancelled) {
              p._toldCancelled = true;
              w.bus.emit('resident:crossing-cancelled', { id: p.id, name: p.displayName, township: p.townshipId });
              if (p.history) p.history.push({ tick: w.clock.tick, day: today.iso, text: 'the boat was cancelled', weight: 2 });
            }
          } else if (duty.kind === 'crossing-back' || duty.kind === 'mainland') {
            duty = { from: duty.from, to: 1439, kind: 'stranded', reason: 'the weather stopped the boats and they are on the wrong side of it', at: 'mainland' };
            if (!p._toldStranded) {
              p._toldStranded = true;
              p.stats.nightsAway++;
              w.bus.emit('resident:stranded', { id: p.id, name: p.displayName, township: p.townshipId, why: 'crossing cancelled' });
              if (p.history) p.history.push({ tick: w.clock.tick, day: today.iso, text: 'stranded on the mainland overnight', weight: 3 });
            }
          }
        } else if (minute < 60) { p._toldCancelled = false; p._toldStranded = false; }

        p.duty = duty;
        if (!duty) continue;
        switch (duty.kind) {
          case 'work': onShift++; break;
          case 'school': atSchool++; break;
          case 'crossing-out': case 'crossing-back': crossing++; break;
          case 'mainland': off++; break;
          case 'stranded': stranded++; off++; break;
          case 'callout': callout++; break;
          case 'patrol': patrol++; break;
          default: break;
        }
      }
      state.onShift = onShift;
      state.atSchool = atSchool;
      state.crossing = crossing;
      state.offIsland = off;
      state.stranded = stranded;
      state.onCallout = callout;
      state.onPatrol = patrol;
    },

    describe(w) {
      return {
        day: state.day ? state.day.iso : null,
        term: state.day ? (state.day.isTermTime ? 'term' : state.day.schoolBlock + ' holidays') : null,
        onShift: state.onShift,
        atSchool: state.atSchool,
        crossing: state.crossing,
        offIsland: state.offIsland,
        stranded: state.stranded,
        onCallout: state.onCallout,
        onPatrol: state.onPatrol,
        boats: state.boatsRunning,
        binNight: state.binNight,
        marketDay: state.marketDay,
        beachDriving: state.beachDrivingOpen
      };
    },

    // The day's plans are derived from the calendar, the roster and the timetable, so they are
    // rebuilt from the restored clock rather than stored. Only the flag that forces that rebuild
    // needs to survive.
    save() { return { v: 1 }; },
    load(w) {
      lastDay = -1;
      if (!R || !R.ready) return;
      today = cal.day(w.clock.date);
      state.day = today;
      const wk = weekIndex(w);
      for (const p of R.people) { p._workDays = workDaysThisWeek(p, today, wk); p.plan = planFor(p, w, today, wk); }
      planning = false;
      planCursor = R.people.length;
    }
  });
}
