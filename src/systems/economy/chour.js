// The community contribution ledger, and the thing it deliberately does not measure.
//
// READ THIS BEFORE YOU CHANGE ANYTHING IN HERE.
//
//   This ledger is money-only on purpose. It is not an unfinished hours ledger. There is no hour
//   verification protocol in this file and there must not be one, and that is a design decision
//   with a reason behind it that is older and better evidenced than any code here.
//
//   The reason, in the author's own framing, recorded in C:/Users/sbt41/githublocal/A-NOTE-TO-THE-NEXT.md:
//   "Every document treats verification as a technical problem to be solved with ledgers and
//   credentials. The actual problem is that people do not report volunteer hours. They help because
//   someone they love or trust or owe asked them, and logging it converts a relationship into a
//   transaction. This is a documented effect, not local colour. His live community ledger is
//   deliberately money-only for exactly this reason. If you arrive and propose a verification
//   protocol, you are solving a problem he solved by not building it."
//
//   data/subterranean.json carries the C-hour itself, out of the author's own grain-by-grain
//   capital.html: "One C-hour is a record that one real hour of community work happened: a real
//   person, a real hour, signed off. It is deliberately not money. It has no price, it is not
//   traded, and it is never sold back to the person who did it." That is what a C-hour is when
//   somebody chooses to record one. It is not, and was never, a reporting obligation.
//
// SO WHAT DOES THIS FILE ACTUALLY SIMULATE
//
//   Three things, side by side, and the gap between them is the whole point.
//
//   1. THE LEDGER. Money in, money out, a locked portion that cannot be spent, and a published
//      allocation rule. Every recipient is a real organisation out of data/businesses.json. It
//      balances, it never runs to zero and it never runs away.
//
//   2. THE CARE. The hours of unpaid work the island actually does, every week, computed from the
//      resident population: the surf club roster, the fire brigade, marine rescue, wildlife rescue,
//      the committees, the working bees, and above all the unpaid carers, who are the single largest
//      block and who data/residents.json insists the simulation treat as work rather than leisure.
//      The ledger never sees any of this. `hoursTheLedgerKnows` is zero, and it says so in words.
//
//   3. THE EXPERIMENT. A player can switch the ledger to hours, which is what nearly everybody
//      proposes on first contact with this problem. When they do, two things happen at once and
//      only one of them is visible on the ledger:
//
//        the measured number rises from zero to something, because some people do log
//        the real number falls, because being asked to log it changes what the help is
//
//      The fall is not uniform and that distinction is the useful part. Rostered volunteering
//      barely moves: a surf club patrol already has a sign-on sheet, and nobody experiences signing
//      it as being audited. Informal help falls hard, because a lift to a specialist appointment,
//      a meal after a funeral, or checking that the neighbour's light went on this morning is a
//      relationship, and putting a timesheet against it makes it something else.
//
//      Switch back and it recovers, slowly, and not all the way. That hysteresis is deliberate too.
//      Trust is cheaper to keep than to rebuild.
//
//   The simulation is not making an argument here. It is running the arithmetic and letting the two
//   lines cross, which is what a simulation is for.
//
// WHAT IS PUBLISHED AND WHAT IS MODELLED
//   Published: the organisations and their status, from data/businesses.json. The C-hour's own
//   definition, from data/subterranean.json out of the author's grain-by-grain capital.html. The
//   count of unpaid carers and volunteers follows the occupation list in data/residents.json, which
//   flags itself as a modelling construct on a real ABS baseline.
//   Modelled: every dollar, every hour rate, the reporting rate under an hours regime, and the size
//   of the crowding-out effect. The direction of that effect is documented; the magnitude here is a
//   modelling parameter and it is labelled as one everywhere it surfaces.
//
// Reads: population, businesses, schedule, policy, tourism. Publishes `chour`.
// Emits `chour:allocated`, `chour:mode-changed`, `chour:hours-experiment`.
// Listens for `ui:intent` of kind `chour:mode`.

import { clamp, approach, Rolling } from './common.js';
import { makeCalendar } from '../agents/calendar.js';

/* ------------------------------------------------------------------ the fund */

/** Share of the balance that is locked and cannot be allocated. The author's locked fund, out of
 *  grain-by-grain capital.html by way of data/subterranean.json. Modelled at this figure. */
const LOCKED_SHARE = 0.30;
/** A ceiling, so a long run cannot produce a community fund the size of a mining company. */
const FUND_CEILING = 900000;

/**
 * Where the money can go. Every one of these is a real organisation in data/businesses.json, with
 * the id the pack uses. Nothing here is invented and nothing here is a person. `annualCapA$` is a
 * modelling parameter that keeps any one recipient from swallowing the fund.
 */
const RECIPIENTS = [
  { id: 'nsi-rural-fire-brigade', purpose: 'gear, fuel and training for the brigade', priority: 1, annualCapA$: 34000 },
  { id: 'vmr-north-stradbroke', purpose: 'the rescue vessel and its running costs', priority: 1, annualCapA$: 34000 },
  { id: 'point-lookout-slsc', purpose: 'patrol equipment and the nippers season', priority: 1, annualCapA$: 30000 },
  { id: 'wildlife-rescue-minjerribah', purpose: 'vehicles, cages and vet bills', priority: 2, annualCapA$: 26000 },
  { id: 'point-lookout-bushcare', purpose: 'plants, water and tools for the dune work', priority: 2, annualCapA$: 14000 },
  { id: 'dunwich-public-hall', purpose: 'keeping the hall standing and the power on', priority: 3, annualCapA$: 12000 },
  { id: 'point-lookout-community-hall', purpose: 'keeping the hall standing and the power on', priority: 3, annualCapA$: 12000 },
  { id: 'amity-point-public-hall', purpose: 'keeping the hall standing and the power on', priority: 3, annualCapA$: 12000 },
  { id: 'nsi-museum-on-minjerribah', purpose: 'collection care and opening hours', priority: 3, annualCapA$: 16000 },
  { id: 'dunwich-state-school', purpose: 'the things a small school budget does not stretch to', priority: 2, annualCapA$: 18000 },
  { id: 'friends-of-stradbroke-island', purpose: 'monitoring and submissions', priority: 4, annualCapA$: 8000 }
];

/* ------------------------------------------------------------------ the care

Hours a week, by kind. Rostered work has an institution and a sign-on sheet behind it. Informal work
does not, and that is exactly why it is the part that a reporting requirement damages. */

const ROSTERED_HOURS = {
  'surf-lifesaver-volunteer': 6.5,
  'rural-fire-volunteer': 3.2,
  'marine-rescue-volunteer': 4.0
};
/** Committee, canteen, working bee, hall roster: not an occupation, a share of the adult population.
 *  Modelled. */
const COMMITTEE_SHARE = 0.075;
const COMMITTEE_HOURS = 2.4;
/**
 * Care, and why it is the biggest block on this island rather than a rounding error.
 *
 * The published age shape does the work here. ABS 2021: median age 52, and the 60 to 74 band alone
 * is 29.5 per cent of the island against a 20 to 34 band of 11.4 per cent. data/residents.json's own
 * note on it is blunt: "Any agent population that looks like a normal Australian town is wrong for
 * this place." An island shaped like that runs on unpaid care, and almost none of it is organised.
 *
 * Three tiers, and only the first is an occupation anybody would put on a form:
 *   a full-time carer          the `unpaid-carer` occupation, at a full working week
 *   a co-resident carer        an adult living with somebody very old, at a part week
 *   an outreach carer          the shopping, the lift, the daily check on somebody living alone
 *
 * data/residents.json on the occupation: "This is unpaid work and the simulation should treat it as
 * work, not as leisure." All three tiers are modelled hours. The age counts underneath them are the
 * published census distribution.
 */
const CARER_HOURS = 31;             // the full-time carer's week
const CO_RESIDENT_CARER_HOURS = 9;  // living with somebody 78 or over
const ELDER_AGE = 78;
/** Hours a week of outreach care that one older person living alone receives, spread across the
 *  neighbours, adult children and friends who provide it. Modelled. */
const LONE_ELDER_CARE_HOURS = 4.5;
/** Everyone else, weighted by how long they have been here and by their civic trait. Modelled. */
const INFORMAL_BASE_HOURS = 0.85;

/* ------------------------------------------------------------------ the experiment

Direction is documented. Magnitude is a modelling parameter, and it is labelled as one. */

const HOURS_MODE = {
  reportingStart: 0.34,        // share of hours actually logged in the first weeks
  reportingSettled: 0.11,      // where it settles once the novelty is gone
  reportingHalfLifeDays: 34,
  informalLoss: 0.28,          // how far informal help falls once a timesheet is attached to it
  rosteredLoss: 0.06,          // a roster already had a sign-on sheet
  onsetHalfLifeDays: 26,
  recoveryHalfLifeDays: 240,   // trust is slower to rebuild than to lose
  permanentResidual: 0.045     // and it does not come all the way back
};

export function registerChour(world) {

  const state = world.publish('chour', {
    ready: false,
    day: null,

    mode: 'money',
    modeSince: 0,
    design: 'This ledger records money and only money. It does not ask anyone to log an hour, and '
      + 'there is no verification step anywhere in it. That is the design, not a gap in it: people '
      + 'do not report volunteer hours, and asking them to turns a favour into a transaction.',
    whatACHourIs: 'A C-hour is a record that one real hour of community work happened: a real '
      + 'person, a real hour, signed off. It is not money, it has no price, it is not traded, and '
      + 'it is never sold back to the person who did it. Recording one is something a person '
      + 'chooses to do. It is not a reporting obligation and this ledger does not create one. '
      + '(data/subterranean.json, from grain-by-grain capital.html.)',

    fund: {
      balanceA$: 0, lockedA$: 0, spendableA$: 0,
      inRolling365A$: 0, outRolling365A$: 0,
      inTodayA$: 0, outTodayA$: 0,
      lockedSharePct: LOCKED_SHARE * 100
    },
    contributors: {
      businesses: 0, households: 0,
      businessesA$365: 0, householdsA$365: 0, eventsA$365: 0,
      basis: 'Contribution rates are modelled. Businesses give a small share of turnover and only '
        + 'when they are not themselves under strain, households give a small amount a year, and '
        + 'the events line is the raffles, the sausage sizzles and the club nights that data/events.json '
        + 'already schedules. No community fund on this island publishes its receipts.'
    },
    allocations: [],           // recent, most recent first
    allocatedThisYear: {},     // recipient id -> A$

    care: {
      hoursThisWeek: 0,
      rosteredHours: 0,
      informalHours: 0,
      carerHours: 0,
      carers: 0,
      loneOlderPeople: 0,
      people: 0,
      participationPct: 0,
      perAdultHours: 0,
      hoursTheLedgerKnows: 0,
      whyZero: 'Nobody was asked. In money mode this is always zero and that is correct.',
      valuedAtA$: 0,
      valuedAtNote: 'Shown at an indicative hourly figure so an hour is comparable with a dollar on '
        + 'a panel. It is not a price and nobody is paid it.'
    },

    experiment: null,          // populated only while an hours regime is or has been running
    history: [],               // weekly [day, realHours, loggedHours] while an experiment runs
    notes: []
  });

  let cal = null;
  let lastDay = -1;
  let lastWeekDay = -1;
  const in365 = new Rolling(365);
  const out365 = new Rolling(365);
  const bizIn365 = new Rolling(365);
  const hhIn365 = new Rolling(365);
  const evIn365 = new Rolling(365);
  let dayIn = { biz: 0, hh: 0, ev: 0 };
  let dayOut = 0;
  let balance = 42000;         // a modelled opening balance
  const allocatedYear = new Map();
  let yearStamp = -1;

  /** 1.0 in money mode. Falls when an hours regime is running, recovers slowly when it stops. */
  let informalFactor = 1;
  let rosteredFactor = 1;
  let reportingRate = 0;
  let modeStartedDay = -1;
  let baselineRealHours = 0;   // the island's weekly hours the week before the experiment started
  let everRanHours = false;

  const recipients = [];
  let totalAnnualCap = 1;

  /* -------------------------------------------------------------- setup */

  function readRecipients(w) {
    const pack = w.data.businesses;
    const list = (pack && pack.businesses) || [];
    for (const r of RECIPIENTS) {
      const rec = list.find((b) => b.id === r.id);
      if (!rec) { state.notes.push(`recipient ${r.id} is not in data/businesses.json and has been left out.`); continue; }
      if (rec.status === 'closed' || rec.status === 'proposed') continue;
      recipients.push({ ...r, name: rec.name, township: rec.township, status: rec.status });
    }
    recipients.sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : 1));
    totalAnnualCap = recipients.reduce((sum, r) => sum + r.annualCapA$, 0);
  }

  /* -------------------------------------------------------------- the money */

  function collect(w) {
    const biz = w.read('businesses') || {};
    const pop = w.read('population') || {};
    const takings = biz.revenueRolling365A$ || 0;

    // Businesses contribute out of what they took, and only the ones that are not themselves under
    // strain. Modelled at a small share, because that is what a real island fund actually collects.
    const strainScale = biz.strain ? clamp(1 - biz.strain.mean, 0.15, 1) : 0.6;
    const bizDaily = (takings / 365) * 0.0032 * strainScale;

    // Households. A modelled A$ per household per year, tilted by the township's published median
    // income, and it is a small number on purpose: this island's median household income is A$1,147
    // a week against Queensland's A$1,675 and a fund that assumes generosity it cannot afford is a
    // fund that runs to zero.
    const households = pop.households || 0;
    const hhDaily = households * 46 / 365;

    // Events. The pack carries real fundraisers: the golf day, the clean-up, the club social nights.
    // Modelled as a small steady trickle with a lift in the events season rather than as a schedule,
    // because data/events.json owns the schedule and this file does not get to invent one.
    const info = cal.day(w.clock.date);
    const evDaily = (info.isWeekend ? 210 : 40) * (info.isSchoolHoliday ? 1.6 : 1);

    dayIn.biz += bizDaily;
    dayIn.hh += hhDaily;
    dayIn.ev += evDaily;
    balance = Math.min(FUND_CEILING, balance + bizDaily + hhDaily + evDaily);

    state.contributors.businesses = biz.counts ? biz.counts.trading_now : 0;
    state.contributors.households = households;
  }

  function allocate(w) {
    // Once a month. Priority order, an annual cap per recipient, and never into the locked portion.
    const spendable = Math.max(0, balance * (1 - LOCKED_SHARE));
    let budget = spendable * 0.22;      // a month's worth of the spendable balance
    if (budget < 400) return;

    // The caps move with the money. A fund whose caps are fixed while its income grows simply
    // accumulates, which is not what a community fund is for: the locked portion is the capital and
    // everything above it is meant to be spent on the island this year. Scaling the caps by what
    // came in over the last twelve months makes the fund grant roughly what it receives and holds
    // the balance steady instead of letting it climb for a decade.
    const capScale = clamp(in365.total / Math.max(1, totalAnnualCap), 0.5, 2.5);

    for (const r of recipients) {
      if (budget <= 0) break;
      const already = allocatedYear.get(r.id) || 0;
      const headroom = Math.max(0, r.annualCapA$ * capScale - already);
      if (headroom <= 0) continue;
      const give = Math.min(headroom, budget * (r.priority === 1 ? 0.30 : r.priority === 2 ? 0.22 : 0.12));
      if (give < 120) continue;
      allocatedYear.set(r.id, already + give);
      balance -= give;
      dayOut += give;
      budget -= give;
      state.allocations.unshift({
        day: w.clock.formatDate(), to: r.name, id: r.id, township: r.township,
        a$: Math.round(give), purpose: r.purpose
      });
      if (state.allocations.length > 24) state.allocations.pop();
      w.bus.emit('chour:allocated', { to: r.id, name: r.name, a$: Math.round(give), purpose: r.purpose });
    }
  }

  /* -------------------------------------------------------------- the care */

  function measureCare(w) {
    const R = w.residents;
    let rostered = 0, carer = 0, informal = 0, people = 0, adults = 0;
    let carers = 0, loneElders = 0;
    if (R && R.people) {
      // Which households contain somebody very old, and which very old people live on their own.
      // Both are read straight off the household graph population.js built, not assumed.
      const elderHouseholds = new Set();
      for (let i = 0; i < R.households.length; i++) {
        const hh = R.households[i];
        let hasElder = false;
        for (let m = 0; m < hh.members.length; m++) {
          const q = R.peopleById.get(hh.members[m]);
          if (q && q.age >= ELDER_AGE) { hasElder = true; break; }
        }
        if (!hasElder) continue;
        if (hh.members.length === 1) loneElders++;
        else elderHouseholds.add(hh.id);
      }

      for (let i = 0; i < R.people.length; i++) {
        const p = R.people[i];
        if (p.age < 15) continue;
        adults++;
        let gave = 0;
        const roster = ROSTERED_HOURS[p.occupationId];
        if (roster) { rostered += roster * rosteredFactor; gave += roster; }
        if (p.occupationId === 'unpaid-carer') { carer += CARER_HOURS; gave += CARER_HOURS; carers++; }
        else if (p.age < ELDER_AGE && elderHouseholds.has(p.householdId)) {
          carer += CO_RESIDENT_CARER_HOURS; gave += CO_RESIDENT_CARER_HOURS; carers++;
        }

        // Everyone else. Weighted by the civic trait population.js already gave them and by how long
        // they have been here, because on this island who you owe and who owes you is a function of
        // years rather than of goodwill.
        const civic = p.traits && Number.isFinite(p.traits.civic) ? p.traits.civic : 0.5;
        const rooted = clamp((p.yearsOnIsland || 0) / 14, 0, 1);
        const h = INFORMAL_BASE_HOURS * (0.35 + civic * 1.3) * (0.5 + rooted * 0.9) * informalFactor;
        informal += h;
        gave += h;
        if (gave > 0.6) people++;
      }
      // Committee, canteen, hall roster and working bee: a share of the adults, on top.
      rostered += adults * COMMITTEE_SHARE * COMMITTEE_HOURS * rosteredFactor;
      // And the shopping, the lift to the specialist and the daily check on somebody who lives on
      // their own. This is the part with no institution behind it, so it is the part an hours
      // regime damages most: it is counted in the informal pool and it moves with informalFactor.
      informal += loneElders * LONE_ELDER_CARE_HOURS * informalFactor;
    }

    // A carer's week is not damaged by a reporting requirement in the way a favour is: it is not a
    // favour, it is a life. It is held out of the crowding-out effect on purpose.
    const total = rostered + carer + informal;
    return { rostered, carer, informal, total, people, adults, carers, loneElders };
  }

  /* -------------------------------------------------------------- the experiment */

  function setMode(w, mode) {
    if (mode !== 'money' && mode !== 'hours') return;
    if (mode === state.mode) return;
    state.mode = mode;
    state.modeSince = w.clock.dayIndex;
    modeStartedDay = w.clock.dayIndex;
    if (mode === 'hours') {
      everRanHours = true;
      const care = measureCare(w);
      baselineRealHours = care.total;
      reportingRate = HOURS_MODE.reportingStart;
      state.history.length = 0;
      state.notes.push('An hours regime was switched on. This build does not add a verification step: it models what happens to the hours, which is the thing that actually decides whether such a scheme works.');
    }
    w.bus.emit('chour:mode-changed', { mode, day: w.clock.formatDate() });
  }

  world.bus.on('ui:intent', (p) => {
    if (!p || p.kind !== 'chour:mode') return;
    setMode(world, p.mode);
  });

  function stepExperiment(w, care) {
    if (state.mode === 'hours') {
      const days = w.clock.dayIndex - modeStartedDay;
      // Reporting decays toward the settled rate: the first weeks are the novelty, and then it is
      // one more thing to do at the end of a long day.
      reportingRate = HOURS_MODE.reportingSettled
        + (HOURS_MODE.reportingStart - HOURS_MODE.reportingSettled) * Math.pow(0.5, days / HOURS_MODE.reportingHalfLifeDays);
      informalFactor = approach(informalFactor, 1 - HOURS_MODE.informalLoss, HOURS_MODE.onsetHalfLifeDays, 1);
      rosteredFactor = approach(rosteredFactor, 1 - HOURS_MODE.rosteredLoss, HOURS_MODE.onsetHalfLifeDays, 1);
    } else {
      reportingRate = 0;
      if (everRanHours) {
        informalFactor = approach(informalFactor, 1 - HOURS_MODE.permanentResidual, HOURS_MODE.recoveryHalfLifeDays, 1);
        rosteredFactor = approach(rosteredFactor, 1, HOURS_MODE.recoveryHalfLifeDays * 0.4, 1);
      }
    }

    const logged = state.mode === 'hours' ? care.total * reportingRate : 0;
    state.care.hoursTheLedgerKnows = Math.round(logged);
    state.care.whyZero = state.mode === 'hours'
      ? `Logged by the people who logged it: about ${Math.round(reportingRate * 100)} per cent of the hours worked.`
      : 'Nobody was asked. In money mode this is always zero and that is correct.';

    if (!everRanHours) { state.experiment = null; return; }

    const lostReal = baselineRealHours > 0 ? baselineRealHours - care.total : 0;
    state.experiment = {
      running: state.mode === 'hours',
      startedDay: modeStartedDay,
      daysRunning: state.mode === 'hours' ? w.clock.dayIndex - modeStartedDay : null,
      reportingRatePct: +(reportingRate * 100).toFixed(1),
      baselineWeeklyHours: Math.round(baselineRealHours),
      actualWeeklyHours: Math.round(care.total),
      loggedWeeklyHours: Math.round(logged),
      hoursLostPerWeek: Math.round(lostReal),
      informalDownPct: +((1 - informalFactor) * 100).toFixed(1),
      rosteredDownPct: +((1 - rosteredFactor) * 100).toFixed(1),
      verdict: state.mode === 'hours'
        ? (logged < lostReal
          ? 'The ledger is now counting fewer hours than the island stopped doing. The measurement cost more than it measured.'
          : 'The ledger is counting more hours than have been lost so far. Watch it: reporting falls faster than the help comes back.')
        : (informalFactor < 0.99
          ? 'Money mode again. Informal help is coming back, and it is not back yet.'
          : 'Money mode. The island is back where it started.'),
      magnitudeBasis: 'The direction of this effect is documented. The size of it here is a modelling '
        + 'parameter, not a measurement, and it should be read as one.'
    };
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'chour',
    phase: 'economy',
    order: 60,

    init(w) {
      cal = (w.residents && w.residents.calendar) || makeCalendar(w.data.events);
      readRecipients(w);
      state.notes.push('There is no hour verification step in this file, by design. See the note at the top of src/systems/economy/chour.js.');
      state.notes.push(`${recipients.length} recipients, every one a real organisation in data/businesses.json.`);
      lastDay = w.clock.dayIndex;
      lastWeekDay = w.clock.dayIndex;
      yearStamp = w.clock.date.getUTCFullYear();
    },

    // Lazy bind, like the rest of this slice: the economy phase runs before the agents phase, so
    // the people whose hours this file counts do not exist yet at boot.
    tick(w) {
      if (!state.ready) {
        const R = w.residents;
        if (!R || !R.ready || !R.people || !R.people.length) return;
        cal = R.calendar || cal;
        state.ready = true;
        w.bus.emit('chour:ready', { recipients: recipients.length, mode: state.mode });
      }
      if (w.clock.dayIndex === lastDay) return;
      lastDay = w.clock.dayIndex;

      const year = w.clock.date.getUTCFullYear();
      if (year !== yearStamp) { yearStamp = year; allocatedYear.clear(); }

      collect(w);
      if (w.clock.dayOfMonth === 1) allocate(w);

      const care = measureCare(w);
      stepExperiment(w, care);

      in365.push(dayIn.biz + dayIn.hh + dayIn.ev);
      bizIn365.push(dayIn.biz); hhIn365.push(dayIn.hh); evIn365.push(dayIn.ev);
      out365.push(dayOut);
      state.fund.inTodayA$ = Math.round(dayIn.biz + dayIn.hh + dayIn.ev);
      state.fund.outTodayA$ = Math.round(dayOut);
      dayIn = { biz: 0, hh: 0, ev: 0 };
      dayOut = 0;

      balance = clamp(balance, 0, FUND_CEILING);
      state.fund.balanceA$ = Math.round(balance);
      state.fund.lockedA$ = Math.round(balance * LOCKED_SHARE);
      state.fund.spendableA$ = Math.round(balance * (1 - LOCKED_SHARE));
      state.fund.inRolling365A$ = Math.round(in365.total);
      state.fund.outRolling365A$ = Math.round(out365.total);
      state.contributors.businessesA$365 = Math.round(bizIn365.total);
      state.contributors.householdsA$365 = Math.round(hhIn365.total);
      state.contributors.eventsA$365 = Math.round(evIn365.total);
      state.allocatedThisYear = Object.fromEntries([...allocatedYear.entries()].map(([k, v]) => [k, Math.round(v)]));
      state.fund.annualCapA$ = Math.round(totalAnnualCap * clamp(in365.total / Math.max(1, totalAnnualCap), 0.5, 2.5));

      state.care.hoursThisWeek = Math.round(care.total);
      state.care.rosteredHours = Math.round(care.rostered);
      state.care.informalHours = Math.round(care.informal);
      state.care.carerHours = Math.round(care.carer);
      state.care.carers = care.carers;
      state.care.loneOlderPeople = care.loneElders;
      state.care.people = care.people;
      state.care.participationPct = care.adults ? +(100 * care.people / care.adults).toFixed(1) : 0;
      state.care.perAdultHours = care.adults ? +(care.total / care.adults).toFixed(2) : 0;
      // An indicative figure only, so an hour and a dollar can sit on the same panel. It is not a
      // price, nobody is paid it, and no C-hour is ever sold back to the person who did it.
      state.care.valuedAtA$ = Math.round(care.total * 42);

      if (w.clock.dayIndex - lastWeekDay >= 7) {
        lastWeekDay = w.clock.dayIndex;
        if (everRanHours) {
          state.history.push([w.clock.formatDate(), Math.round(care.total), state.care.hoursTheLedgerKnows]);
          if (state.history.length > 60) state.history.shift();
          if (state.mode === 'hours' && state.history.length === 8) {
            w.bus.emit('chour:hours-experiment', {
              weeks: 8,
              actualWeeklyHours: Math.round(care.total),
              loggedWeeklyHours: state.care.hoursTheLedgerKnows,
              baselineWeeklyHours: Math.round(baselineRealHours),
              verdict: state.experiment ? state.experiment.verdict : ''
            });
          }
        }
      }

      state.day = w.clock.formatDate();
    },

    describe() {
      return {
        mode: state.mode,
        balanceA$: state.fund.balanceA$,
        lockedA$: state.fund.lockedA$,
        inYearA$: state.fund.inRolling365A$,
        outYearA$: state.fund.outRolling365A$,
        careHoursWeek: state.care.hoursThisWeek,
        rostered: state.care.rosteredHours,
        informal: state.care.informalHours,
        carers: state.care.carerHours,
        hoursLogged: state.care.hoursTheLedgerKnows,
        participationPct: state.care.participationPct,
        experiment: state.experiment ? state.experiment.hoursLostPerWeek : null
      };
    },

    save() {
      return {
        balance, mode: state.mode, modeStartedDay, informalFactor, rosteredFactor, reportingRate,
        baselineRealHours, everRanHours, yearStamp,
        allocatedYear: [...allocatedYear.entries()],
        allocations: state.allocations.slice(),
        i365: in365.save(), o365: out365.save(), b365: bizIn365.save(), h365: hhIn365.save(), e365: evIn365.save()
      };
    },

    load(w, s) {
      if (!s) return;
      lastDay = -1;
      state.ready = false;      // recounts the island's care on the next tick
      balance = s.balance ?? balance;
      state.mode = s.mode || 'money';
      modeStartedDay = s.modeStartedDay ?? -1;
      informalFactor = s.informalFactor ?? 1;
      rosteredFactor = s.rosteredFactor ?? 1;
      reportingRate = s.reportingRate ?? 0;
      baselineRealHours = s.baselineRealHours ?? 0;
      everRanHours = !!s.everRanHours;
      yearStamp = s.yearStamp ?? yearStamp;
      allocatedYear.clear();
      for (const [k, v] of s.allocatedYear || []) allocatedYear.set(k, v);
      state.allocations = s.allocations || [];
      in365.load(s.i365); out365.load(s.o365); bizIn365.load(s.b365); hhIn365.load(s.h365); evIn365.load(s.e365);
      state.fund.balanceA$ = Math.round(balance);
      state.fund.lockedA$ = Math.round(balance * LOCKED_SHARE);
      state.fund.spendableA$ = Math.round(balance * (1 - LOCKED_SHARE));
      state.fund.inRolling365A$ = Math.round(in365.total);
      state.fund.outRolling365A$ = Math.round(out365.total);
    }
  });
}
