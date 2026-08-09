// The shoreline as a live process, over years rather than over days.
//
// `src/systems/ecology/dunes.js` already runs the sand budget: every ten minutes it takes wave runup
// against the dune toe, puts wind-blown sand back where there is spinifex to catch it, opens and
// closes blowouts, counts feet and vehicles on nineteen reaches, and fires the Amity Point flow
// slides. None of that is repeated here. This system is the layer above it: the decade, the
// mechanism underneath the decade, and the three things anybody can actually do about it.
//
// WHAT THIS FILE OWNS THAT THE DAILY BUDGET CANNOT SEE:
//
//   * THE AMITY MECHANISM, properly. The land at Amity Point is not being nibbled away by waves.
//     data/ecology.json proc-amity-erosion names the two drivers as episodic flow slides, sudden
//     underwater collapses of the sand slope, and the southerly migration of the deep Rainbow
//     Channel toward the shore. The mechanism that joins them is geometry: the channel scours a
//     deep hole close inshore, the sand slope between the beach and that hole gets steeper as the
//     channel comes closer, and loose saturated sand on a slope that is too steep does not creep,
//     it liquefies and goes all at once, taking the beach above it. So this file tracks the slope,
//     not the retreat rate, and publishes the slope as the thing that is actually getting worse.
//     No published rate exists for either driver; the pack says so and says to model the outcome as
//     episodic. It is, in dunes.js, and this file does not second-guess it.
//   * THE THREE RESPONSES, with their real costs and their real consequences. Armour, retreat and
//     nourish. All three are in data/civic.json with capital costs, annual costs and lead times, and
//     the argument on this island is not which one works, it is which one you can afford for thirty
//     years and what each one costs somebody else. A rock wall protects the house behind it and
//     scours the beach in front of it and the reach beside it, which is why the neighbours are part
//     of the argument. Nourishment is the only option that keeps a beach and it is never finished.
//     Retreat is the cheapest in the long run and the one nobody wants to say out loud.
//   * THE RECOVERY GAP. proc-dune-cycle names "storm sequences with no recovery gap" as a
//     disturbance. A beach that takes eighty cubic metres a metre in June and gets it back by
//     Christmas is fine. The same beach hit again in August is not, and the second storm is not
//     visible in any daily number. This file counts them.
//   * SEA LEVEL, as a slow parameter. Three and a half millimetres a year is invisible in a sim
//     year and it is a fifth of a metre over fifty. It is published as a projection so it can be
//     seen without waiting for it.
//   * JUMPINPIN, at the south. A storm sequence in 1896 to 1898 cut the channel and separated North
//     and South Stradbroke. That break is now the southern end of the island's sand budget, and it
//     is a sink: sand moving north along the ocean beach has to get past a tidal delta that stores it.
//
// EVERY FLUX AND RATE IN THIS FILE IS MODELLED AND SAYS SO. There is no published sediment budget,
// no published channel migration rate, no published flow slide frequency and no island tide gauge
// trend in any pack in this repository. What is published, and is carried here verbatim, is the
// 2017 reference event, the erosion-prone declaration, the shoreline plan and its three reaches,
// and the costs of the four Amity levers.
//
// Determinism: world.rng.stream('coast'). No Math.random, no Date.now.

import {
  clamp, smoothstep, absDay, onshoreComponent,
  levers, metric, place, DailyRing, EventLog
} from '../ecology/ecology-common.js';

const YEAR = 365.25;

/* ------------------------------------------------------------------ sea level

A slow parameter, and the only honest way to carry it is with its confidence attached. No Moreton
Bay tide gauge trend is in any pack here, so this is the order of magnitude of published global mean
sea level trends and is labelled as a modelling choice, not as a measurement for this place. */

const SEA_LEVEL = {
  mmPerYear: 3.5,
  confidence: 'low',
  basis: 'A modelling choice at the order of magnitude of published global mean sea level trends. '
    + 'No island or Moreton Bay tide gauge trend is in any pack in this repository, and a local rate '
    + 'would differ from a global one. Change it with the ui:intent coast:sea-level to run a scenario.'
};

/* The island's sand budget, as a structure rather than as an answer. Every number is modelled; what
   is not modelled is the shape, which is well established for a drift-dominated ocean shore. */

const BUDGET = {
  netDriftM3PerYear: 250000,
  confidence: 'low',
  basis: 'Modelled. Net northward littoral drift along an exposed south-east Queensland ocean shore '
    + 'is of this order, but no measured budget for this island is in any pack here. The direction '
    + 'is the well-established part; the magnitude is the guess.'
};

/* The three low-lying foreshores a storm tide actually reaches, with modelled crest levels.

   The island heightfield is ASTER-derived with ten to twenty metres of vertical error
   (data/geography.json elevation note), which is an order of magnitude larger than the thing being
   modelled here. So the crest of a foreshore is NOT read off the terrain. It is a modelled level on
   the same datum the tide system uses, stated as a modelled level, and the output is an exceedance
   against it rather than a flood map, because a flood map built on that terrain would be a lie with
   a coastline drawn around it. */

const FORESHORES = [
  { id: 'dunwich-foreshore', placeId: 'dunwich-foreshore', label: 'Dunwich foreshore', crestM: 2.35, what: 'the barge ramp approach and the foreshore road' },
  { id: 'one-mile', placeId: 'one-mile-jetty', label: 'One Mile', crestM: 2.20, what: 'the jetty approach and the low ground behind it' },
  { id: 'amity-campground', placeId: 'amity-point-campground', label: 'Amity Point campground', crestM: 2.45, what: 'the foreshore sites' },
  { id: 'bradburys', placeId: 'bradburys-beach', label: "Bradbury's Beach", crestM: 2.30, what: 'the foreshore reserve' },
  { id: 'amity-erosion-zone', placeId: 'amity-erosion-zone', label: 'Amity Point, the declared strip', crestM: 2.60, what: 'the erosion-prone frontage' }
];

/* The three responses, with the pack's own costs. Nothing here is invented: the ids, names, capital
   costs, annual costs and lead times all come from data/civic.json, and the consequences come from
   proc-amity-erosion's own what_disturbs_it and what_helps_it lists. */

const RESPONSES = [
  {
    id: 'armour', label: 'Armour it',
    levers: ['amity-flow-slide-barrier', 'amity-southern-buried-seawall'],
    keeps: 'The land behind the wall, and the houses on it.',
    costs: 'The beach in front of it, and the reach beside it. A hard structure reflects wave '
      + 'energy instead of absorbing it, so the sand in front of a wall goes and does not come '
      + 'back, and the erosion moves to the unarmoured ground at each end.',
    reversible: false,
    note: 'The buried seawall is the expensive version of the same answer, designed to be concealed '
      + 'under sand so the beach looks like a beach until the day it has to hold.'
  },
  {
    id: 'nourish', label: 'Nourish it',
    levers: ['amity-beach-nourishment'],
    keeps: 'A beach in front of the houses, which is the only option that does.',
    costs: 'It is never finished. The sea starts taking the sand back the day it lands, so the cost '
      + 'is not the placement, it is the placement every few years for as long as anybody wants a '
      + 'beach there. And the sand comes from somewhere.',
    reversible: true,
    note: 'Cheap to start and the most expensive over thirty years of any option except doing nothing.'
  },
  {
    id: 'retreat', label: 'Retreat from it',
    levers: ['amity-managed-retreat'],
    keeps: 'The beach, the dune and the money, eventually.',
    costs: 'Houses, and the conversation about them. Voluntary acquisition at island values, over '
      + 'a decade, and the pack is blunt that this is the option nobody wants to say out loud.',
    reversible: false,
    note: 'The only response whose cost stops.'
  }
];

export function registerCoast(world) {
  const rng = world.rng.stream('coast');
  const L = levers(world);

  const state = world.publish('coast', {
    ready: false,
    source: 'data/ecology.json proc-amity-erosion and proc-dune-cycle; costs from data/civic.json; '
      + 'the daily sand budget from the dunes system',
    seaLevel: {
      mmPerYear: SEA_LEVEL.mmPerYear, risenMm: 0, confidence: SEA_LEVEL.confidence,
      basis: SEA_LEVEL.basis, projection: []
    },
    reaches: [],
    ocean: { cutThisYearM3PerM: 0, recoveredShare: 0, stormsThisYear: 0, noGapEvents: 0, worst: null },
    amity: {
      channelDistanceM: 0, channelDepthM: 0, shorefaceSlopeDeg: 0, slopeTrendDegPerDecade: 0,
      susceptibility: 0, mechanism: '', status: '', reference: null,
      eventsThisDecade: 0, landLostM2ThisDecade: 0, landLostM2Total: 0,
      propertiesInStrip: 0, propertiesBasis: '', lastEvent: null
    },
    responses: [],
    doNothing: null,
    stormTide: { levelM: 0, surgeM: 0, setupM: 0, tideM: 0, over: [], worst: null, warningHours: 0, note: '' },
    jumpinpin: {
      cut: '1896 to 1898', history: '', widthM: 0, wideningMPerYear: 0, storedM3PerYear: 0,
      confidence: 'low', basis: '', shareOfDrift: 0
    },
    budget: {
      netDriftM3PerYear: BUDGET.netDriftM3PerYear, confidence: BUDGET.confidence, basis: BUDGET.basis,
      aroundPointLookoutM3PerYear: 0, toJumpinpinM3PerYear: 0, intoTheBayM3PerYear: 0, balance: ''
    },
    armourEffects: [],
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(40);
  const cutRing = new DailyRing(365);

  let lastDay = -1;
  let startDay = 0;
  let risenMm = 0;
  let slrRate = SEA_LEVEL.mmPerYear;
  let foreshores = [];
  let reaches = [];                 // the multi-year ledger, one row per reach dunes publishes
  let landLostTotal = 0;
  let decadeEvents = 0;
  let decadeLand = 0;
  let stormsThisYear = 0;
  let noGapEvents = 0;
  let slopeAtStart = 0;
  let inundationWarned = -1;

  world.bus.on('ui:intent', (p) => {
    if (!p) return;
    if (p.kind === 'coast:sea-level' && Number.isFinite(p.mmPerYear)) {
      slrRate = clamp(p.mmPerYear, -2, 15);
    }
  });

  // dunes.js owns the flow slide. This system keeps the decade ledger of them, so nothing is
  // simulated twice and the two numbers can never disagree.
  world.bus.on('coast:flow-slide', (p) => {
    if (!p) return;
    decadeEvents++;
    decadeLand += p.areaM2 || 0;
    landLostTotal += p.areaM2 || 0;
    state.amity.lastEvent = {
      day: world.clock.formatDate(), where: p.where,
      frontageM: p.frontageM, retreatM: p.retreatM, areaM2: p.areaM2,
      warned: !!p.warned,
      slopeDegAtTime: +state.amity.shorefaceSlopeDeg.toFixed(2)
    };
    log.push({
      day: world.clock.formatDate(),
      what: `flow slide: ${p.frontageM} m of frontage, ${p.retreatM} m of land`,
      where: p.where
    });
  });

  world.bus.on('coast:storm-cut', (p) => {
    if (!p) return;
    stormsThisYear++;
    const r = reaches.find((x) => x.label === p.where);
    if (r) {
      const sinceLast = absDay(world.clock) - r.lastStormDay;
      // Six to thirty-six months is the pack's recovery range. A second storm inside a season is a
      // storm the beach never got to answer, and it is the mechanism that loses a dune quietly.
      if (r.lastStormDay > 0 && sinceLast < 150) {
        noGapEvents++;
        r.noGap++;
        log.push({
          day: world.clock.formatDate(),
          what: `second storm in ${Math.round(sinceLast)} days, before the beach had come back`,
          where: r.label
        });
        world.bus.emit('ecology:alert', {
          id: 'no-recovery-gap',
          text: `${p.where} has taken a second storm ${Math.round(sinceLast)} days after the last one. `
            + 'A beach needs six months to three years to put back what a storm takes, so this cut '
            + 'starts from what the last one left.'
        });
      }
      r.lastStormDay = absDay(world.clock);
      r.storms++;
    }
    cutRing.add(p.cutM3PerM || 0);
  });

  /* ---------------------------------------------------------------- build */

  function build(w) {
    const dn = w.read('dunes');
    if (!dn || !dn.ready) {
      notes.push('the dunes system is not publishing, so there is no daily sand budget to sit on '
        + 'top of. The mechanism, the responses and sea level still run; the reach ledger does not.');
    }
    for (const f of FORESHORES) {
      const p = place(w, f.placeId);
      if (!p) { notes.push(`${f.label}: not in data/places.json, so it is not in the storm tide list.`); continue; }
      foreshores.push({ ...f, x: p.x, z: p.z, overDays: 0, lastOver: null });
    }
    startDay = absDay(w.clock);
    // The pack's own reference event, carried beside everything modelled.
    const eco = w.data && w.data.ecology;
    const proc = eco && Array.isArray(eco.processes)
      ? eco.processes.find((p) => p.id === 'proc-amity-erosion') : null;
    if (proc) {
      state.amity.status = proc.status || '';
      state.amity.reference = proc.reference_event ? { ...proc.reference_event } : null;
      state.amity.losses = proc.losses || '';
    }
    state.amity.mechanism =
      'The Rainbow Channel is deep and it is moving south toward the shore. That leaves a steep '
      + 'slope of loose, saturated sand between the beach and the deep water. Loose sand on a slope '
      + 'that is too steep does not creep away a bit at a time: it liquefies and goes at once, and '
      + 'the beach standing on top of it goes with it. So the number that is getting worse here is '
      + 'not a retreat rate. It is the slope.';
    state.jumpinpin.history =
      'A storm sequence in 1896 to 1898 cut the channel at the southern end and separated North and '
      + 'South Stradbroke. What had been one island became two, and the break is now the southern '
      + 'end of this island\'s sand budget.';
    state.jumpinpin.basis =
      'The cut and its dates are documented. The present width, the widening rate and the volume of '
      + 'sand the tidal delta stores are all modelled: no width series or delta volume for Jumpinpin '
      + 'is in any pack in this repository.';
    return true;
  }

  /* ---------------------------------------------------------------- the mechanism */

  /**
   * The geometry at Amity Point.
   *
   * dunes.js holds the distance from the shore to the deep water and walks it in at a modelled
   * rate. What it does not do, because it is running a sand budget rather than a slope stability
   * problem, is turn that distance into the thing that actually fails. The shoreface slope is the
   * average grade from the shoreline down to the channel thalweg, and as the channel comes closer
   * at a constant depth that grade steepens on its own, with nothing on the beach changing at all.
   * That is why the hazard at Amity rises in years when nothing visible happens.
   */
  function stepMechanism(w, dtDays) {
    const dn = w.read('dunes');
    const amityDn = dn && dn.amity ? dn.amity : null;
    const distance = amityDn && Number.isFinite(amityDn.channelDistanceM) ? amityDn.channelDistanceM : 420;
    // Depth of the channel off Amity Point. Modelled: the Rainbow Channel is a deep tidal channel
    // and no soundings for it are in any pack here.
    const depth = 22;
    const slopeDeg = (Math.atan2(depth, Math.max(40, distance)) * 180) / Math.PI;
    if (!slopeAtStart) slopeAtStart = slopeDeg;

    // Where the flow slide band sits. Loose, contractive, saturated sand fails at grades far below
    // its dry angle of repose. The band below is a modelling choice and is published as one.
    const susceptibility = clamp(smoothstep(2.2, 7.0, slopeDeg), 0, 1);

    const armour = Math.max(L.level('amity-flow-slide-barrier'), L.level('amity-southern-buried-seawall'));
    const retreat = L.level('amity-managed-retreat');
    const research = L.level('amity-coastal-research');

    const elapsedY = Math.max(0.05, (absDay(w.clock) - startDay) / YEAR);
    state.amity.channelDistanceM = +distance.toFixed(1);
    state.amity.channelDepthM = depth;
    state.amity.channelDepthBasis = 'Modelled. No soundings for the Rainbow Channel off Amity Point '
      + 'are in any pack in this repository.';
    state.amity.shorefaceSlopeDeg = +slopeDeg.toFixed(2);
    state.amity.slopeTrendDegPerDecade = +(((slopeDeg - slopeAtStart) / elapsedY) * 10).toFixed(3);
    state.amity.susceptibility = metric(susceptibility);
    state.amity.susceptibilityBasis = 'Modelled: the grade from the shoreline to the channel thalweg, '
      + 'against a failure band of about two to seven degrees for loose saturated sand. The band is a '
      + 'modelling choice. The pack says the university flow slide study is what would settle it, and '
      + 'that study is what the research lever funds.';
    state.amity.watched = research > 0.5;
    state.amity.armourShare = +armour.toFixed(2);
    state.amity.retreatShare = +retreat.toFixed(2);
    state.amity.eventsThisDecade = decadeEvents;
    state.amity.landLostM2ThisDecade = Math.round(decadeLand);
    state.amity.landLostM2Total = Math.round(landLostTotal);
    if (amityDn) {
      state.amity.propertiesInStrip = amityDn.propertiesInStrip;
      state.amity.propertiesBasis = amityDn.propertiesBasis;
      state.amity.worksNote = amityDn.worksNote;
    }
  }

  /**
   * What armour does to everybody else.
   *
   * proc-amity-erosion lists "hard structures that reflect wave energy and scour the sand in front
   * of them" under what disturbs it, and the pack's own summary of the trade-off is that the rock
   * wall option protects assets and costs beach. So a wall is not free even when it works: the sand
   * in front of it goes, and the erosion steps around each end onto the ground that has no wall.
   * Neither effect is in the daily budget, because the daily budget does not know a wall is there.
   */
  function stepArmourEffects(w) {
    const dn = w.read('dunes');
    if (!dn || !Array.isArray(dn.reaches)) { state.armourEffects = []; return; }
    const barrier = L.level('amity-flow-slide-barrier');
    const wall = L.level('amity-southern-buried-seawall');
    const nourish = L.level('amity-beach-nourishment');
    const out = [];
    const walled = [
      { reach: 'amity-central', level: barrier, kind: 'rock barrier' },
      { reach: 'amity-southern', level: wall, kind: 'buried seawall' }
    ];
    for (const wl of walled) {
      if (wl.level <= 0.05) continue;
      const r = dn.reaches.find((x) => x.id === wl.reach);
      if (!r) continue;
      // Passive erosion: the beach in front of a wall narrows because the sand it would have taken
      // from the dune is no longer available and the reflected energy takes what is left.
      const passive = 0.35 * wl.level * (1 - 0.55 * nourish);
      out.push({
        reach: r.label, kind: wl.kind, level: +wl.level.toFixed(2),
        effect: 'passive erosion',
        mPerYear: +passive.toFixed(2),
        text: `The ${wl.kind} holds the land. The beach in front of it narrows by about `
          + `${passive.toFixed(2)} m a year, because the sand that would have come out of the dune `
          + `cannot, and a wall gives the waves back their energy instead of taking it.`
      });
      // End effects: the unarmoured neighbour wears it.
      const neighbour = wl.reach === 'amity-central' ? 'amity-northern' : 'amity-beach';
      const nr = dn.reaches.find((x) => x.id === neighbour);
      if (nr) {
        const end = 0.28 * wl.level;
        out.push({
          reach: nr.label, kind: wl.kind, level: +wl.level.toFixed(2),
          effect: 'end effect',
          mPerYear: +end.toFixed(2),
          text: `Unarmoured, and next door to the ${wl.kind}. Erosion steps around the end of a `
            + `structure onto whatever has none, at about ${end.toFixed(2)} m a year. This is the `
            + 'part of the argument that belongs to the neighbours.'
        });
      }
    }
    state.armourEffects = out;
  }

  /* ---------------------------------------------------------------- the responses */

  /**
   * Armour, retreat and nourish, priced over thirty years.
   *
   * The costs are the pack's own. What this adds is the thing a capital figure hides: a wall is
   * bought once and maintained forever, nourishment is bought again and again, and retreat is the
   * only one whose cost stops. Thirty years is the horizon a coastal plan is written over, so that
   * is the horizon the comparison runs on.
   */
  function stepResponses(w) {
    const packLevers = (w.data && w.data.civic && w.data.civic.levers) || [];
    const byId = new Map(packLevers.map((l) => [l.id, l]));
    const dn = w.read('dunes');
    const prices = w.read('prices');
    const housing = w.read('housing');
    const HORIZON = 30;
    const out = [];

    for (const R of RESPONSES) {
      let capital = 0, annual = 0, lead = 0, running = 0, n = 0;
      const parts = [];
      for (const id of R.levers) {
        const lv = byId.get(id);
        if (!lv) continue;
        const c = lv.cost_aud || {};
        capital += c.capital || 0;
        annual += c.recurring_per_year || 0;
        lead = Math.max(lead, lv.lead_time_months || 0);
        running += L.level(id);
        n++;
        parts.push({ id, name: lv.name, capital: c.capital || 0, annual: c.recurring_per_year || 0, basis: c.basis, confidence: c.confidence });
      }
      let thirtyYear = capital + annual * HORIZON;
      let extra = null;
      if (R.id === 'nourish') {
        // Nourishment is not one placement. It is a placement every few years for as long as
        // anybody wants a beach there, and the pack prices the repeat campaigns in the annual line.
        // The extra here is the part the annual line does not carry: the campaigns get bigger as
        // the channel comes closer, because the sand goes faster.
        const growth = 1 + 0.55 * state.amity.susceptibility;
        thirtyYear = capital + annual * HORIZON * growth;
        extra = `Campaigns get bigger as the slope steepens. At today's susceptibility the thirty `
          + `year cost is about ${(growth * 100 - 100).toFixed(0)} per cent above the flat figure.`;
      }
      if (R.id === 'retreat') {
        // Retreat is priced against island house values, which this simulation has. That is the
        // whole reason it is expensive here and the whole reason it stops being expensive later.
        const lots = dn && dn.amity ? dn.amity.propertiesInStrip : 0;
        const median = housing && housing.medianPriceA$ ? housing.medianPriceA$
          : (prices && prices.medianHousePriceA$ ? prices.medianHousePriceA$ : null);
        if (lots && median) {
          const exposed = Math.round(lots * 0.35);      // the front row, not the whole strip
          thirtyYear = exposed * median + annual * HORIZON;
          extra = `Priced against the island's own house prices: about ${exposed} exposed lots at `
            + `A$${Math.round(median).toLocaleString('en-AU')}. When the island gets dearer, so does `
            + 'retreat, which is exactly why waiting is not free.';
          capital = exposed * median;
        }
      }
      out.push({
        id: R.id, label: R.label,
        levers: R.levers,
        parts,
        capitalA$: Math.round(capital),
        annualA$: Math.round(annual),
        thirtyYearA$: Math.round(thirtyYear),
        leadMonths: lead,
        running: n ? +(running / n).toFixed(2) : 0,
        keeps: R.keeps, costs: R.costs, note: R.note, extra,
        reversible: R.reversible,
        confidence: 'low: every cost in data/civic.json for these four levers is a modelling estimate'
      });
    }

    // And the fourth option, which is the one that happens by default.
    const perEvent = 34 * 3.5;                   // the 2017 event's own frontage times its retreat
    const rate = state.amity.susceptibility * 0.55;   // events a year at today's slope, modelled
    state.doNothing = {
      label: 'Do nothing',
      thirtyYearA$: 0,
      landLostM2Per30Y: Math.round(perEvent * rate * 30),
      text: 'No capital, no annual cost, and the land goes. At today\'s slope this is about '
        + `${Math.round(perEvent * rate * 30)} square metres of Amity Point over thirty years, taken `
        + 'in a handful of nights rather than gradually. The pack is explicit that a player who '
        + 'budgets for a steady rate will be caught out, which is what happens here.',
      confidence: 'low: fitted to the November 2017 event, which is the only one with a published size'
    };
    state.responses = out;
  }

  /* ---------------------------------------------------------------- storm tide */

  /**
   * The level at the foreshore on the day it matters.
   *
   * A storm tide is not one thing. It is the astronomical tide, plus the surge the low pressure and
   * the wind pile up against the coast, plus the setup the breaking waves add at the shore, plus
   * whatever sea level has done since. On a bay foreshore the swell hardly gets in, so the surge is
   * most of it; on the ocean side the setup is most of it. Both are here.
   */
  function stepStormTide(w) {
    const wx = w.read('weather');
    const tide = w.read('tide');
    if (!wx || !tide) return;
    const seaLevel = w.island ? w.island.seaLevel : 1.02;
    // Inverse barometer: about a centimetre for every hectopascal below normal.
    const surge = clamp((1013 - wx.pressure) * 0.010, -0.15, 0.9)
      + clamp((wx.windKt - 18) / 60, 0, 0.55) * Math.max(0, onshoreComponent(wx.windDirDeg, 290));
    const setup = 0.16 * wx.swellM;
    const slr = risenMm / 1000;
    const level = tide.height + surge + slr;
    const readiness = L.level('storm-tide-readiness');

    const over = [];
    let worst = null, worstMargin = -99;
    for (const f of foreshores) {
      const here = level + (f.id === 'amity-erosion-zone' ? setup * 0.4 : setup * 0.25);
      const margin = here - f.crestM;
      if (margin > worstMargin) { worstMargin = margin; worst = f.label; }
      if (margin > 0) {
        over.push({
          id: f.id, label: f.label, what: f.what,
          overByM: +margin.toFixed(2), levelM: +here.toFixed(2), crestM: f.crestM
        });
        f.overDays++;
        f.lastOver = w.clock.formatDate();
      }
    }
    state.stormTide = {
      levelM: +level.toFixed(2),
      tideM: +tide.height.toFixed(2),
      surgeM: +surge.toFixed(2),
      setupM: +setup.toFixed(2),
      seaLevelM: +slr.toFixed(3),
      springNeap: tide.springNeap,
      over,
      worst: worst ? { label: worst, marginM: +worstMargin.toFixed(2) } : null,
      warningHours: +(readiness * 18).toFixed(0),
      note: 'Crest levels are modelled on the tide datum, not read off the terrain: the island '
        + 'heightfield carries ten to twenty metres of vertical error, which is far larger than the '
        + 'thing being modelled, so this is an exceedance against a stated level and not a flood map.'
    };

    const day = absDay(w.clock);
    if (over.length && day - inundationWarned > 2) {
      inundationWarned = day;
      const worstOver = over.slice().sort((a, b) => b.overByM - a.overByM)[0];
      log.push({ day: w.clock.formatDate(), what: `storm tide over the crest by ${worstOver.overByM} m`, where: worstOver.label });
      w.bus.emit('coast:storm-tide', {
        where: worstOver.label, overByM: worstOver.overByM, levelM: worstOver.levelM,
        warned: readiness > 0.5, places: over.length
      });
      w.bus.emit('ecology:alert', {
        id: 'storm-tide',
        text: `The tide is over the ${worstOver.label} by ${worstOver.overByM} m: `
          + `${tide.height.toFixed(2)} m of tide, ${surge.toFixed(2)} m of surge and `
          + `${setup.toFixed(2)} m of wave setup on top of it.`
          + (readiness > 0.5 ? ' The readiness plan gave about eighteen hours of warning.' : '')
      });
    }
  }

  /* ---------------------------------------------------------------- the budget */

  function stepBudget(w) {
    const dn = w.read('dunes');
    const drift = BUDGET.netDriftM3PerYear;
    // Where the drift ends up. Point Lookout is the terminus of the ocean shore: sand that gets
    // that far rounds the headland into the bay and is what keeps Flinders and Amity supplied.
    // At the southern end the Jumpinpin tidal delta stores what comes past it.
    const stored = drift * 0.34;
    const around = drift * 0.42;
    const intoBay = around * 0.75;
    state.jumpinpin.widthM = 3000;
    state.jumpinpin.wideningMPerYear = 6;
    state.jumpinpin.storedM3PerYear = Math.round(stored);
    state.jumpinpin.shareOfDrift = +(stored / drift).toFixed(2);
    state.budget.aroundPointLookoutM3PerYear = Math.round(around);
    state.budget.toJumpinpinM3PerYear = Math.round(stored);
    state.budget.intoTheBayM3PerYear = Math.round(intoBay);
    // Whether the island is in surplus or deficit is not published anywhere, and this file will not
    // pretend to know. What it can say is what the shore itself is doing, which the dune system
    // measures, so the balance is read off that rather than asserted.
    const cond = dn && Number.isFinite(dn.oceanCondition) ? dn.oceanCondition : null;
    state.budget.balance = cond === null
      ? 'Not known: the dune system is not publishing a condition to read it from.'
      : cond > 0.62
        ? 'The ocean beaches are holding what they take. On this shore that is the budget being in '
          + 'balance, whatever the fluxes above say.'
        : cond > 0.45
          ? 'The ocean beaches are not getting all of it back between storms. That is a deficit, and '
            + 'it shows up as a thinner dune rather than as a number anybody measures.'
          : 'The ocean beaches are running down. Whatever the drift is doing, this shore is spending '
            + 'more than it is being sent.';
  }

  /* ---------------------------------------------------------------- the reach ledger */

  function stepReaches(w) {
    const dn = w.read('dunes');
    if (!dn || !Array.isArray(dn.reaches)) return;
    const elapsedY = Math.max(0.08, (absDay(w.clock) - startDay) / YEAR);
    for (const r0 of dn.reaches) {
      let r = reaches.find((x) => x.id === r0.id);
      if (!r) {
        r = {
          id: r0.id, label: r0.label, exposure: r0.exposure,
          startShorelineM: r0.shorelineM, lastStormDay: -1, storms: 0, noGap: 0,
          minShorelineM: r0.shorelineM, maxShorelineM: r0.shorelineM
        };
        reaches.push(r);
      }
      r.shorelineM = r0.shorelineM;
      r.condition = r0.condition;
      r.sinceStartM = +(r0.shorelineM - r.startShorelineM).toFixed(2);
      r.mPerYear = +(r.sinceStartM / elapsedY).toFixed(3);
      if (r0.shorelineM < r.minShorelineM) r.minShorelineM = r0.shorelineM;
      if (r0.shorelineM > r.maxShorelineM) r.maxShorelineM = r0.shorelineM;
      // Recovery: how much of the worst cut this reach has put back.
      const span = r.maxShorelineM - r.minShorelineM;
      r.recoveredShare = span > 0.05 ? +clamp((r0.shorelineM - r.minShorelineM) / span, 0, 1).toFixed(2) : 1;
    }
    let worst = null;
    let oceanCut = 0, oceanN = 0, recovered = 0, recN = 0;
    for (const r of reaches) {
      if (!worst || r.mPerYear < worst.mPerYear) worst = r;
      if (r.exposure > 0.35) { oceanCut += r.sinceStartM; oceanN++; }
      if (r.recoveredShare != null) { recovered += r.recoveredShare; recN++; }
    }
    state.reaches = reaches.map((r) => ({
      id: r.id, label: r.label,
      shorelineM: +r.shorelineM.toFixed(2),
      sinceStartM: r.sinceStartM,
      mPerYear: r.mPerYear,
      worstM: +r.minShorelineM.toFixed(2),
      recoveredShare: r.recoveredShare,
      storms: r.storms, stormsWithNoGap: r.noGap,
      condition: r.condition
    }));
    state.ocean = {
      cutThisYearM3PerM: +cutRing.total.toFixed(1),
      recoveredShare: recN ? +(recovered / recN).toFixed(2) : 1,
      stormsThisYear: stormsThisYear,
      noGapEvents,
      meanSinceStartM: oceanN ? +(oceanCut / oceanN).toFixed(2) : 0,
      worst: worst ? { id: worst.id, label: worst.label, mPerYear: worst.mPerYear, sinceStartM: worst.sinceStartM } : null,
      note: 'The pack puts a storm cut at twenty to eighty cubic metres a metre and recovery at six '
        + 'to thirty-six months. A second storm inside that window starts from what the last one left, '
        + 'and that is what stormsWithNoGap counts.'
    };
  }

  /* ---------------------------------------------------------------- sea level */

  function stepSeaLevel(w, dtDays) {
    risenMm += slrRate * (dtDays / YEAR);
    const proj = [];
    for (const y of [10, 30, 50]) {
      proj.push({
        years: y, mm: Math.round(slrRate * y),
        text: `${Math.round(slrRate * y)} mm in ${y} years at ${slrRate} mm a year`
      });
    }
    state.seaLevel = {
      mmPerYear: slrRate,
      risenMm: +risenMm.toFixed(2),
      confidence: SEA_LEVEL.confidence,
      basis: SEA_LEVEL.basis,
      projection: proj,
      note: 'Three and a half millimetres is nothing in a sim year and it is a fifth of a metre over '
        + 'fifty. It is published as a projection so it can be seen without waiting for it. What it '
        + 'changes is not the average shoreline: it is how often the tide is already high when the '
        + 'storm arrives.'
    };
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'coast',
    phase: 'environment',
    order: 50,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      stepMechanism(w, 0);
      stepArmourEffects(w);
      stepResponses(w);
      stepBudget(w);
      stepReaches(w);
      stepSeaLevel(w, 0);
      stepStormTide(w);
      publish(w);
      lastDay = absDay(w.clock);
      notes.push('The daily sand budget, the nineteen reaches and the flow slide events all belong '
        + 'to the dunes system. This system keeps the decade ledger over the top of them, and does '
        + 'not simulate a grain of sand twice.');
      notes.push('No sediment budget, channel migration rate, flow slide frequency, Jumpinpin width '
        + 'series or local sea level trend is in any pack in this repository. Every one of those '
        + 'numbers here is modelled and carries its basis.');
      notes.push('The four Amity levers in data/civic.json all carry costs marked as modelling '
        + 'estimates with low confidence. The thirty year comparison inherits that confidence.');
      w.bus.emit('coast:ready', { reaches: reaches.length, foreshores: foreshores.length });
    },

    tick(w) {
      if (!state.ready) return;
      // The storm tide is the only thing here that moves within a day, and it is what decides
      // whether a swell reaches anything, so it runs on the hour.
      if (w.clock.minuteOfDay % 60 < 10) stepStormTide(w);

      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      cutRing.roll();

      stepSeaLevel(w, 1);
      stepMechanism(w, 1);
      stepReaches(w);
      stepArmourEffects(w);
      if (w.clock.dayOfMonth === 1) { stepResponses(w); stepBudget(w); }
      publish(w);

      if (w.clock.dayOfYear === 1) { stemYear(); }
      if (w.clock.dayOfMonth === 1 && w.clock.month === 0) {
        // The decade ledger rolls on a decade, not on a year.
        if ((w.clock.date.getUTCFullYear() % 10) === 0) { decadeEvents = 0; decadeLand = 0; }
      }
    },

    describe(w) {
      return {
        slopeDeg: state.amity.shorefaceSlopeDeg,
        slopePerDecade: state.amity.slopeTrendDegPerDecade,
        channelM: state.amity.channelDistanceM,
        susceptibility: state.amity.susceptibility,
        landLostM2: state.amity.landLostM2Total,
        eventsDecade: state.amity.eventsThisDecade,
        seaLevelMm: state.seaLevel.risenMm,
        stormTideM: state.stormTide.levelM,
        over: state.stormTide.over.length,
        storms365: stormsThisYear,
        noGap: noGapEvents,
        oceanSinceStartM: state.ocean.meanSinceStartM,
        recovered: state.ocean.recoveredShare,
        armourEffects: state.armourEffects.length,
        armour30y: state.responses.find((r) => r.id === 'armour')?.thirtyYearA$ || 0,
        nourish30y: state.responses.find((r) => r.id === 'nourish')?.thirtyYearA$ || 0,
        retreat30y: state.responses.find((r) => r.id === 'retreat')?.thirtyYearA$ || 0
      };
    },

    save() {
      return {
        risenMm, slrRate, landLostTotal, decadeEvents, decadeLand,
        stormsThisYear, noGapEvents, slopeAtStart, startDay, inundationWarned,
        reaches: reaches.map((r) => ({
          id: r.id, startShorelineM: r.startShorelineM, lastStormDay: r.lastStormDay,
          storms: r.storms, noGap: r.noGap, minShorelineM: r.minShorelineM, maxShorelineM: r.maxShorelineM
        })),
        foreshores: foreshores.map((f) => ({ id: f.id, overDays: f.overDays, lastOver: f.lastOver })),
        cut: cutRing.save(), log: log.save()
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      risenMm = s.risenMm || 0;
      slrRate = s.slrRate ?? SEA_LEVEL.mmPerYear;
      landLostTotal = s.landLostTotal || 0;
      decadeEvents = s.decadeEvents || 0;
      decadeLand = s.decadeLand || 0;
      stormsThisYear = s.stormsThisYear || 0;
      noGapEvents = s.noGapEvents || 0;
      slopeAtStart = s.slopeAtStart || 0;
      startDay = s.startDay ?? absDay(w.clock);
      inundationWarned = s.inundationWarned ?? -1;
      for (const r0 of s.reaches || []) {
        const r = reaches.find((x) => x.id === r0.id);
        if (r) Object.assign(r, r0);
      }
      for (const f0 of s.foreshores || []) {
        const f = foreshores.find((x) => x.id === f0.id);
        if (f) { f.overDays = f0.overDays; f.lastOver = f0.lastOver; }
      }
      cutRing.load(s.cut); log.load(s.log);
      publish(w);
    }
  });

  function stemYear() { stormsThisYear = 0; noGapEvents = 0; }

  function publish(w) {
    state.events = log.recent(8);
    state.levers = L.snapshot(['amity-flow-slide-barrier', 'amity-southern-buried-seawall',
      'amity-beach-nourishment', 'amity-managed-retreat', 'amity-coastal-research',
      'dune-restoration-program', 'storm-tide-readiness']);
    const dn = w.read('dunes');
    // Property at risk: the metric nothing else in the island supplies. It rises with the slope,
    // falls with what is built, and falls furthest with the option nobody wants to say out loud.
    const retreat = L.level('amity-managed-retreat');
    const armour = Math.max(L.level('amity-flow-slide-barrier'), L.level('amity-southern-buried-seawall'));
    state.civicMetrics = {
      private_property_risk: metric(clamp(
        0.25 + 0.55 * state.amity.susceptibility - 0.28 * armour - 0.45 * retreat
        + (dn && dn.oceanCondition != null ? (1 - dn.oceanCondition) * 0.12 : 0), 0, 1))
    };
  }
}
