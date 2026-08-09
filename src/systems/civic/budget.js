// Real money, in A$.
//
// Four purses, and which one holds the money matters more than how much is in it:
//
//   council-island       Redland City Council's island program. Not a separate budget in real life:
//                        the island is one part of a city whose population is overwhelmingly on the
//                        mainland, so what the island gets is an allocation set once a year, not the
//                        rates it raises. Both numbers are tracked here, side by side, because the
//                        gap between them is the oldest grievance on the island and it is the kind
//                        of thing a civic model should be able to show rather than assert.
//   minjerribah-futures  The state transition program. Approved funding rose from A$20 million to
//                        A$39.4 million, with A$30.6 million spent as at April 2024, so the twin
//                        opens with the balance of that. A further tranche is a political question.
//   redland-water        Water and sewerage charges, ring-fenced. Sewer money cannot seal a road.
//   qyac-enterprise      Camping and vehicle access permit revenue, which goes to QYAC through
//                        Minjerribah Camping. Shown and never spendable by the player, so that
//                        capping camping sites reads for what it is: a cut to Traditional Owner
//                        self-funding, which is a consequence the pack itself records.
//
// THE FINANCIAL YEAR IS A MECHANIC. It runs 1 July to 30 June and the budget is adopted in June. A
// capital bid that lands after adoption waits a year. Nothing about that is unusual and nobody
// models it, and it is the single most common reason a good idea on this island takes two years
// instead of one.
//
// THE BARGE IS A MECHANIC TOO. Every tonne of rubbish leaves on a boat. Waste tonnage here is not a
// constant: it is residents plus whoever is actually on the island today, so the waste line moves
// with a long weekend and the player can watch it do so.
//
// Honesty, which matters more than precision here. Every dollar figure carries a basis and a
// confidence, exactly as data/civic.json does for its own costs. Two figures are published and
// cited: the waste charge Redland households were reported paying, and the state program totals.
// Everything else on this page is modelled, is labelled modelled, and should not be quoted at a
// council meeting.

const DAYS_PER_YEAR = 365.25;

/** Published or cited. Everything not in here is modelled. */
const CITED = {
  wasteChargePerDwelling: {
    value: 600,
    basis: 'Redland households were reported paying over A$600 a year for waste alone, across nine contractors, eight waste centres and island barge logistics.',
    source: 'rbn-waste-bill',
    confidence: 'medium'
  },
  futuresApproved: { value: 39400000, source: 'qao-minjerribah-futures', confidence: 'high' },
  futuresSpentApr2024: { value: 30600000, source: 'qao-minjerribah-futures', confidence: 'high' },
  islandsBoost2025: {
    value: 6950000,
    basis: 'Reported as A$6.95 million for the islands together, not for Minjerribah alone.',
    source: 'rcc-islands-budget-2025',
    confidence: 'medium'
  },
  commercialVehiclePerMetre: {
    value: 26,
    basis: 'A per-metre commercial vehicle barge rate of about A$26 appears in data/transport.json, citing SeaLink, and could not be confirmed against a current page. Order of magnitude only.',
    source: 'data/transport.json svc-freight-carriers',
    confidence: 'low'
  }
};

/** Modelled rating assumptions. Redland City Council's own rating schedule was not read. */
const MODELLED = {
  generalRatePrincipal: 1780,
  generalRateOther: 2420,
  waterAndSewerPerConnection: 1310,
  connectionsShareOfDwellings: 0.72,
  wastePerResidentTonnes: 0.52,
  wastePerVisitorDayKg: 1.4,
  wasteVariableCostPerTonne: 221,
  wasteFixedPerYear: 380000,
  islandShareOfIslandsGrant: 0.30,
  baseOperating: {
    'roads-and-drainage': 1250000,
    'parks-foreshore-and-halls': 780000,
    'local-laws-and-compliance': 260000,
    'emergency-management': 120000,
    'customer-and-administration': 240000
  }
};

export function registerBudget(world) {
  // world.rng.restore() rebuilds the pool with fresh Rng objects rather than mutating the existing
  // ones, so a stream captured at registration is a stale object after a load and quietly draws from
  // a different position in the sequence. Resolve the stream at the point of use. It is a Map lookup.
  const STREAM = 'civic-budget';
  const rng = {
    float: () => world.rng.stream(STREAM).float(),
    int: (a, b) => world.rng.stream(STREAM).int(a, b),
    bool: (p) => world.rng.stream(STREAM).bool(p),
    pick: (a) => world.rng.stream(STREAM).pick(a),
    normal: (m, s) => world.rng.stream(STREAM).normal(m, s),
    weighted: (items, fn) => world.rng.stream(STREAM).weighted(items, fn)
  };

  const state = world.publish('budget', {
    ready: false,
    fy: '',
    dayOfFY: 0,
    adopted: false,
    daysToAdoption: 0,
    funds: {},
    revenue: [],
    expenditure: [],
    waste: {},
    islandLedger: {},
    commitments: [],
    recentSpends: [],
    bids: [],
    history: [],
    notes: [],
    canSpend: () => false,
    money: (n) => 'A$' + Math.round(n || 0).toLocaleString('en-AU'),
    fundCard: () => null
  });

  const FUNDS = {
    'council-island': {
      id: 'council-island', label: 'Council island program', holder: 'Redland City Council',
      spendableByPlayer: true, balance: 0, allocation: 0, revenueYTD: 0, spendYTD: 0,
      committedRecurring: 0, capitalCommitted: 0,
      note: 'An allocation from a city budget, not the island\'s own money. Set once a year.'
    },
    'minjerribah-futures': {
      id: 'minjerribah-futures', label: 'Minjerribah Futures', holder: 'Queensland Government',
      spendableByPlayer: true, capitalOnly: true, balance: 0, allocation: 0, revenueYTD: 0, spendYTD: 0,
      committedRecurring: 0, capitalCommitted: 0, recurringLoad: 0,
      note: 'A finite capital balance. Ongoing program costs are not paid from it: the state pays those from general revenue, so what they cost is political rather than financial and it turns up in the state\'s appetite for the next thing.'
    },
    'redland-water': {
      id: 'redland-water', label: 'Redland Water', holder: 'Redland Water',
      spendableByPlayer: true, ringFenced: true, balance: 0, allocation: 0, revenueYTD: 0, spendYTD: 0,
      committedRecurring: 0, capitalCommitted: 0,
      note: 'Ring-fenced. Water and sewerage charges pay for water and sewerage and nothing else.'
    },
    'qyac-enterprise': {
      id: 'qyac-enterprise', label: 'Camping and permit revenue', holder: 'QYAC, through Minjerribah Camping',
      spendableByPlayer: false, balance: 0, allocation: 0, revenueYTD: 0, spendYTD: 0,
      committedRecurring: 0, capitalCommitted: 0,
      note: 'Shown, not spendable. This is Traditional Owner self-funding and it is not the player\'s money.'
    },
    external: {
      id: 'external', label: 'Somebody else\'s money', holder: 'Private operators, landowners, the Commonwealth',
      spendableByPlayer: false, balance: 0, allocation: 0, revenueYTD: 0, spendYTD: 0,
      committedRecurring: 0, capitalCommitted: 0,
      note: 'Costs that fall outside every purse the island controls.'
    }
  };

  const commitments = [];   // {leverId, name, fund, capital, recurring, drawnToDate, perDay, endDay, active}
  const oneOffs = [];       // recent one-off spends, for the read model
  const inbox = [];
  let lastDay = -1;
  let fyKey = '';
  let fyStartDay = 0;
  let yearRevenue = 0, yearSpend = 0;
  let wasteTonnesYTD = 0, wasteTonnesLastYear = 1650;
  let dwellings = { total: 1964, occupied: 970, unoccupied: 988 };
  let residents = 2156;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayOf = (w) => w.clock.dayIndex;
  const money = (n) => 'A$' + Math.round(n || 0).toLocaleString('en-AU');
  const moneyShort = (n) => {
    const a = Math.abs(n);
    if (a >= 1000000) return 'A$' + (n / 1000000).toFixed(a >= 10000000 ? 0 : 1) + 'M';
    if (a >= 1000) return 'A$' + Math.round(n / 1000) + 'k';
    return 'A$' + Math.round(n);
  };

  /* ------------------------------------------------------------------ boot */

  function build(w) {
    // The state program opens at what was left of it.
    FUNDS['minjerribah-futures'].balance = CITED.futuresApproved.value - CITED.futuresSpentApr2024.value;
    FUNDS['minjerribah-futures'].openingNote =
      `Approved funding rose from A$20 million to ${money(CITED.futuresApproved.value)}, with ${money(CITED.futuresSpentApr2024.value)} spent as at April 2024.`;

    // Every lever the pack marks in_place is already being paid for. The island's budget starts
    // committed, because it is.
    const civic = (w.data && w.data.civic) || null;
    if (civic) {
      for (const lv of civic.levers || []) {
        if (lv.status !== 'in_place' && lv.status !== 'funded') continue;
        const recurring = (lv.cost_aud && lv.cost_aud.recurring_per_year) || 0;
        if (!recurring) continue;
        const fund = fundOf(lv.who_decides[0]);
        commitments.push({
          leverId: lv.id, name: lv.name, fund, capital: 0, recurring,
          drawnToDate: 0, perDay: 0, endDay: null, active: true, standing: true,
          note: 'Already running when the twin starts.'
        });
        if (FUNDS[fund]) FUNDS[fund].committedRecurring += recurring;
      }
      state.notes.push(`${commitments.length} programs were already running and already costing money on day one. Their annual cost is ${money(commitments.reduce((s, c) => s + c.recurring, 0))} across all purses.`);
    }

    // The opening allocation. What the island gets is what it already costs to run, plus a capital
    // program: roughly the island's share of the last reported islands infrastructure allocation.
    // That capital program is the whole of the player's discretion in year one, and it is not much.
    const fixed = baseOperatingTotal() + standingRecurring('council-island');
    const capitalProgram = Math.round(islandShareOfGrant() * 0.8);
    FUNDS['council-island'].allocation = Math.round(fixed + capitalProgram);
    FUNDS['council-island'].capitalProgram = capitalProgram;
    FUNDS['council-island'].balance = Math.round(capitalProgram * 0.5);
    state.notes.push(`The island program opens at ${moneyShort(FUNDS['council-island'].allocation)} a year, of which ${moneyShort(capitalProgram)} is not already spoken for. That is the size of the desk.`);

    startFinancialYear(w, true);
    state.notes.push('Only the waste charge and the state program totals on this page are published figures. Everything else is modelled and labelled as such.');
    state.ready = true;
    publish(w);
  }

  function fundOf(institutionId) {
    const map = {
      'redland-city-council': 'council-island', 'rcc-division-2': 'council-island', community: 'council-island',
      'redland-water': 'redland-water', seqwater: 'redland-water',
      'qld-government': 'minjerribah-futures', detsi: 'minjerribah-futures', qpws: 'minjerribah-futures',
      'tmr-translink': 'minjerribah-futures', edq: 'minjerribah-futures',
      qyac: 'qyac-enterprise', 'minjerribah-camping': 'qyac-enterprise', 'joint-management': 'qyac-enterprise'
    };
    return map[institutionId] || 'external';
  }

  /* ------------------------------------------------------------------ the financial year */

  function fyLabel(w) {
    const d = w.clock.date;
    const y = d.getUTCFullYear();
    const start = d.getUTCMonth() >= 6 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }

  function startFinancialYear(w, first) {
    if (!first) {
      // Use it or lose it. Island capital that sits unspent at 30 June is money a city with a
      // hundred and fifty thousand people on the mainland can find a use for, and it does.
      const ci = FUNDS['council-island'];
      const idle = ci.balance - 1500000;
      if (idle > 0) {
        const swept = Math.round(idle * 0.4);
        ci.balance -= swept;
        w.bus.emit('civic:swept', {
          fund: 'council-island', amount: swept,
          text: `${moneyShort(swept)} of unspent island capital went back to the city at the end of the financial year. It was there in May.`
        });
        w.bus.emit('civic:metric-nudge', {
          metric: 'consultation_trust', delta: -0.02,
          reason: `${moneyShort(swept)} of island capital handed back unspent`,
          source: 'civic/budget.js', halfLifeDays: 400
        });
      }
      state.history.unshift({
        fy: fyKey, revenue: Math.round(yearRevenue), spend: Math.round(yearSpend),
        result: Math.round(yearRevenue - yearSpend),
        wasteTonnes: Math.round(wasteTonnesYTD),
        closing: Math.round(FUNDS['council-island'].balance)
      });
      if (state.history.length > 12) state.history.pop();
      wasteTonnesLastYear = wasteTonnesYTD || wasteTonnesLastYear;
    }
    fyKey = fyLabel(w);
    fyStartDay = dayOf(w);
    yearRevenue = 0; yearSpend = 0; wasteTonnesYTD = 0;
    state.ownSourceYTD = 0;
    for (const f of Object.values(FUNDS)) { f.revenueYTD = 0; f.spendYTD = 0; }
    state.adopted = false;
    w.bus.emit('civic:budget-open', { fy: fyKey });
  }

  /**
   * Adoption. The council decides in June what the island gets next year. It is not the island's
   * rates coming back: it is an allocation, and it moves with how the year went and with how much
   * appetite the chamber has for an island line item.
   */
  function adoptBudget(w) {
    const pol = w.read('policy');
    const sent = w.read('sentiment');
    const cou = w.read('council');
    const metric = (id) => (pol && pol.metrics && pol.metrics[id] ? pol.metrics[id].value : null);

    // Base operating and the programs already running are not really up for grabs in one budget.
    // What moves is the capital program, which is why every argument on this island is about the
    // one line that can actually change.
    const fixed = baseOperatingTotal() + standingRecurring('council-island');
    let factor = 1;
    const councilMood = sent && sent.moods ? sent.moods['council-as-actor'] : null;
    if (councilMood != null) factor += councilMood * 0.14;
    const trust = metric('consultation_trust');
    if (trust != null) factor += (trust - 0.35) * 0.2;
    const appetite = cou && cou.institutions && cou.institutions['redland-city-council']
      ? cou.institutions['redland-city-council'].appetite : null;
    if (appetite != null) factor += (appetite - 0.45) * 0.3;
    factor += rng.normal(0, 0.03);
    factor = clamp(factor, 0.78, 1.35);

    const capitalProgram = Math.round(clamp(islandShareOfGrant() * 0.8 * factor + (factor - 1) * fixed * 0.5, 0, fixed));
    const allocation = Math.round(fixed + capitalProgram);

    FUNDS['council-island'].allocation = allocation;
    FUNDS['council-island'].capitalProgram = capitalProgram;
    state.adopted = true;

    w.bus.emit('civic:budget-adopted', {
      fy: fyLabel(w), allocation, capitalProgram, fixed,
      text: `The council adopted its budget. The island program is ${moneyShort(allocation)} for ${fyLabel(w)}, with ${moneyShort(capitalProgram)} of that for capital works.`
    });
  }

  function baseOperatingTotal() {
    let t = 0;
    for (const v of Object.values(MODELLED.baseOperating)) t += v;
    return t + wasteCostPerYear();
  }

  function standingRecurring(fund) {
    let t = 0;
    for (const c of commitments) if (c.active && c.fund === fund) t += c.recurring;
    return t;
  }

  function islandShareOfGrant() {
    return CITED.islandsBoost2025.value * MODELLED.islandShareOfIslandsGrant;
  }

  /* ------------------------------------------------------------------ revenue and cost */

  function ratesPerYear(w) {
    const pol = w.read('policy');
    const differential = pol && pol.levers && pol.levers['rates-differential-unoccupied'] && pol.levers['rates-differential-unoccupied'].level > 0;
    const other = MODELLED.generalRateOther * (differential ? 1.08 : 1);
    return dwellings.occupied * MODELLED.generalRatePrincipal + dwellings.unoccupied * other;
  }

  function wasteChargePerYear() {
    return dwellings.total * CITED.wasteChargePerDwelling.value;
  }

  function waterChargesPerYear() {
    return Math.round(dwellings.total * MODELLED.connectionsShareOfDwellings) * MODELLED.waterAndSewerPerConnection;
  }

  function dailyWasteTonnes(w) {
    const vis = w.read('visitors');
    const onIsland = vis && vis.ready ? (vis.onIsland || 0) : 900;
    const resident = (residents * MODELLED.wastePerResidentTonnes) / DAYS_PER_YEAR;
    const visitor = (onIsland * MODELLED.wastePerVisitorDayKg) / 1000;
    return resident + visitor;
  }

  function wasteCostPerYear() {
    return MODELLED.wasteFixedPerYear + wasteTonnesLastYear * MODELLED.wasteVariableCostPerTonne;
  }

  function levyRevenuePerYear(w) {
    const pol = w.read('policy');
    if (!pol || !pol.levers) return 0;
    const levy = pol.levers['visitor-levy-on-accommodation'];
    if (!levy || levy.level <= 0 || levy.progress < 1) return 0;
    // Modelled: a levy on paid accommodation nights, not a published rate.
    return 1450000;
  }

  function campingRevenuePerYear(w) {
    const pol = w.read('policy');
    const index = pol && pol.metrics && pol.metrics.campground_revenue ? pol.metrics.campground_revenue.value : 0.5;
    // Modelled. The camping operator's own site refused the connection to the research agent, so no
    // site count and no permit price could be verified. This is an index scaled to a plausible
    // island-scale enterprise turnover and it is not a published figure.
    return 4200000 * (index / 0.5);
  }

  /* ------------------------------------------------------------------ spending */

  function book(w, fund, amount, reason, category) {
    const f = FUNDS[fund] || FUNDS.external;
    f.balance -= amount;
    f.spendYTD += amount;
    if (fund !== 'external' && fund !== 'qyac-enterprise') yearSpend += amount;
    if (category !== 'accrual') {
      oneOffs.unshift({ day: dayOf(w), date: w.clock.formatDate(), fund, amount, reason, category: category || 'other' });
      if (oneOffs.length > 30) oneOffs.pop();
    }
  }

  function canSpend(fund, amount) {
    const f = FUNDS[fund];
    if (!f || !f.spendableByPlayer) return false;
    return f.balance - amount > -availableOverdraft(f);
  }

  /** The council can carry a small deficit against next year. The state program cannot. */
  function availableOverdraft(f) {
    return f.id === 'council-island' ? 400000 : 0;
  }

  function commit(w, p) {
    const fund = p.fund || 'external';
    const months = Math.max(1, p.months || 1);
    const days = Math.round(months * 30.4375);
    const capital = p.capital || 0;
    const existing = commitments.find((c) => c.leverId === p.leverId && c.active);
    if (existing) {
      // Stepping up something already running: the program cost changes and the works get drawn.
      const f0 = FUNDS[existing.fund];
      if (f0) f0.committedRecurring += (p.recurringPerYear || 0) - existing.recurring;
      existing.recurring = p.recurringPerYear || 0;
      if (capital > 0) {
        existing.capital = capital;
        existing.drawnToDate = 0;
        existing.perDay = days > 0 ? capital / days : capital;
        existing.startDay = dayOf(w);
        existing.endDay = dayOf(w) + days;
        existing.standing = false;
        if (f0) f0.capitalCommitted += capital;
      }
      return;
    }
    const c = {
      leverId: p.leverId, name: p.name, fund, capital,
      recurring: p.recurringPerYear || 0,
      drawnToDate: 0,
      perDay: days > 0 ? capital / days : capital,
      startDay: dayOf(w), endDay: dayOf(w) + days,
      active: true, standing: false, decider: p.decider
    };
    commitments.push(c);
    if (FUNDS[fund]) {
      FUNDS[fund].committedRecurring += c.recurring;
      FUNDS[fund].capitalCommitted += capital;
    }
    if (fund !== 'external' && capital > 0 && !canSpend(fund, capital * 0.25)) {
      w.bus.emit('civic:funds-short', {
        leverId: p.leverId, fund, needed: capital,
        text: `${p.name} is committed against ${FUNDS[fund] ? FUNDS[fund].label : fund} and there is not enough in it. Something else has to give.`
      });
    }
  }

  function release(w, leverId) {
    for (const c of commitments) {
      if (c.leverId !== leverId || !c.active) continue;
      c.active = false;
      const f = FUNDS[c.fund];
      if (f) {
        f.committedRecurring = Math.max(0, f.committedRecurring - c.recurring);
        f.capitalCommitted = Math.max(0, f.capitalCommitted - Math.max(0, c.capital - c.drawnToDate));
      }
    }
  }

  /* ------------------------------------------------------------------ the daily pass */

  function dailyPass(w) {
    const day = dayOf(w);
    const d = w.clock.date;

    // Population and dwellings, if the residents system is running.
    const pop = w.read('population');
    if (pop && pop.ready && pop.dwellings && pop.dwellings.total) {
      dwellings = {
        total: pop.dwellings.total,
        occupied: pop.dwellings.occupied,
        unoccupied: pop.dwellings.unoccupied
      };
      residents = pop.residents || residents;
    }

    // A new financial year.
    if (fyLabel(w) !== fyKey) startFinancialYear(w, false);
    // Adoption, mid June.
    if (!state.adopted && d.getUTCMonth() === 5 && d.getUTCDate() >= 15) adoptBudget(w);
    state.daysToAdoption = daysToAdoption(w);

    // Revenue accrues daily. Rates are quarterly in reality but daily accrual is the honest
    // simplification: what matters to the player is the annual shape.
    const rates = ratesPerYear(w) / DAYS_PER_YEAR;
    const wasteCharge = wasteChargePerYear() / DAYS_PER_YEAR;
    const water = waterChargesPerYear() / DAYS_PER_YEAR;
    const levy = levyRevenuePerYear(w) / DAYS_PER_YEAR;
    const camping = campingRevenuePerYear(w) / DAYS_PER_YEAR * seasonalFactor(w);

    // The council's island program is funded by an allocation, not by the rates it raises. The
    // rates are tracked anyway, because the difference is the point.
    const allocation = (FUNDS['council-island'].allocation || baseOperatingTotal()) / DAYS_PER_YEAR;
    FUNDS['council-island'].balance += allocation + levy;
    FUNDS['council-island'].revenueYTD += allocation + levy;
    FUNDS['redland-water'].balance += water;
    FUNDS['redland-water'].revenueYTD += water;
    FUNDS['qyac-enterprise'].balance += camping;
    FUNDS['qyac-enterprise'].revenueYTD += camping;
    yearRevenue += allocation + levy;

    state.ownSourceYTD = (state.ownSourceYTD || 0) + rates + wasteCharge;

    // Waste: tonnes today, straight off how many people are actually here.
    const tonnes = dailyWasteTonnes(w);
    wasteTonnesYTD += tonnes;
    const wasteCost = tonnes * MODELLED.wasteVariableCostPerTonne + MODELLED.wasteFixedPerYear / DAYS_PER_YEAR;
    book(w, 'council-island', wasteCost, 'waste', 'accrual');

    // Base operating.
    let base = 0;
    for (const v of Object.values(MODELLED.baseOperating)) base += v;
    book(w, 'council-island', base / DAYS_PER_YEAR, 'base operating', 'accrual');

    // Standing and committed programs.
    for (const f of Object.values(FUNDS)) f.recurringLoad = 0;
    for (const c of commitments) {
      if (!c.active) continue;
      const cf = FUNDS[c.fund];
      if (cf && cf.capitalOnly) cf.recurringLoad += c.recurring;
      else book(w, c.fund, c.recurring / DAYS_PER_YEAR, c.name, 'accrual');
      if (c.capital > 0 && c.drawnToDate < c.capital && day <= c.endDay) {
        const draw = Math.min(c.perDay, c.capital - c.drawnToDate);
        const f = FUNDS[c.fund];
        // The money runs out and the works stop. Not cancelled, not refused: stopped, with the
        // trenches open. This is the most Minjerribah failure mode there is and it deserves to be
        // modelled rather than papered over with an overdraft nobody has.
        // Hysteresis, and a minimum stall of a month. Works do not stop on the Tuesday and restart
        // on the Thursday because a rates instalment landed. A crew stood down is a crew you have
        // to get back, and the site sits there while you do.
        const floor = f ? -availableOverdraft(f) : -Infinity;
        const canDraw = c.fund === 'external' || !f || f.balance - draw > floor;
        if (!canDraw && !c.stalled) {
          c.stalled = true;
          c.stalledSince = day;
          w.bus.emit('civic:stalled', {
            leverId: c.leverId, name: c.name, fund: c.fund, on: true,
            text: `${c.name} has stopped. There is nothing left in ${f ? f.label : c.fund} to draw against, and ${moneyShort(c.capital - c.drawnToDate)} of it is unbuilt.`
          });
        } else if (c.stalled && day - (c.stalledSince || 0) >= 28 && f && f.balance > floor + 250000) {
          c.stalled = false;
          w.bus.emit('civic:stalled', { leverId: c.leverId, name: c.name, fund: c.fund, on: false, text: `${c.name} is moving again after ${Math.round((day - (c.stalledSince || 0)) / 30)} months stopped.` });
        }
        if (!c.stalled) {
          c.drawnToDate += draw;
          book(w, c.fund, draw, c.name + ' (capital)', 'accrual');
        } else {
          c.endDay += 1;  // stopped work does not deliver on the original date
        }
      }
    }

    // Running out of money is a decision, not a game over. The council program can carry a small
    // deficit; the state program simply stops.
    const ci = FUNDS['council-island'];
    if (ci.balance < -availableOverdraft(ci) && !state.overdrawnFlagged) {
      state.overdrawnFlagged = true;
      w.bus.emit('civic:overdrawn', {
        fund: 'council-island', balance: Math.round(ci.balance),
        text: 'The island program is overdrawn. Something running now has to stop, or the next budget has to be argued for.'
      });
      w.bus.emit('civic:metric-nudge', {
        metric: 'council_budget', delta: -0.12, reason: 'the island program went into deficit',
        source: 'civic/budget.js', halfLifeDays: 500
      });
    } else if (ci.balance > 0) state.overdrawnFlagged = false;

    const mf = FUNDS['minjerribah-futures'];
    if (mf.balance <= 0 && !state.futuresExhausted) {
      state.futuresExhausted = true;
      w.bus.emit('civic:funds-exhausted', {
        fund: 'minjerribah-futures',
        text: 'The Minjerribah Futures balance is spent. From here, anything state-funded starts with asking for the next tranche.'
      });
    }

    publish(w);
  }

  function daysToAdoption(w) {
    const d = w.clock.date;
    const y = d.getUTCFullYear();
    const target = Date.UTC(d.getUTCMonth() > 5 || (d.getUTCMonth() === 5 && d.getUTCDate() >= 15) ? y + 1 : y, 5, 15) / 86400000;
    return Math.max(0, Math.round(target - (w.clock.epochDay + w.clock.dayIndex)));
  }

  /** Camping and permits are a summer and school holiday business. */
  function seasonalFactor(w) {
    const holiday = w.clock.isQldSchoolHoliday ? 2.1 : 1;
    const weekend = w.clock.isWeekend ? 1.4 : 0.75;
    return holiday * weekend * 0.62;
  }

  /* ------------------------------------------------------------------ read model */

  function publish(w) {
    state.fy = fyKey;
    state.dayOfFY = dayOf(w) - fyStartDay;

    const annualRates = ratesPerYear(w);
    const annualWasteCharge = wasteChargePerYear();
    const ownSource = annualRates + annualWasteCharge;
    const islandSpend = (FUNDS['council-island'].allocation || baseOperatingTotal());

    state.funds = {};
    for (const f of Object.values(FUNDS)) {
      // For the council program this is the capital line and nothing else: the allocation minus
      // what is already spoken for. Reserves count for something but not for much, and they get
      // swept at the end of the year anyway.
      const availableThisYear = f.id === 'council-island'
        ? Math.max(0, (f.allocation || baseOperatingTotal()) - standingRecurring(f.id) - baseOperatingTotal()) + Math.max(0, f.balance) * 0.3
        : Math.max(0, f.balance);
      state.funds[f.id] = {
        id: f.id, label: f.label, holder: f.holder,
        spendableByPlayer: !!f.spendableByPlayer,
        ringFenced: !!f.ringFenced,
        balance: Math.round(f.balance),
        balanceText: moneyShort(f.balance),
        allocation: Math.round(f.allocation || 0),
        capitalProgram: Math.round(f.capitalProgram || 0),
        revenueYTD: Math.round(f.revenueYTD),
        spendYTD: Math.round(f.spendYTD),
        committedRecurring: Math.round(f.committedRecurring),
        recurringLoad: Math.round(f.recurringLoad || 0),
        capitalOnly: !!f.capitalOnly,
        availableThisYear: Math.round(availableThisYear),
        headroomShare: +clamp(availableThisYear / Math.max(1, (f.allocation || f.balance || 1)), 0, 1).toFixed(3),
        note: f.note,
        openingNote: f.openingNote || ''
      };
    }

    const tonnesRate = wasteTonnesYTD > 0 && state.dayOfFY > 3
      ? (wasteTonnesYTD / state.dayOfFY) * DAYS_PER_YEAR : wasteTonnesLastYear;
    state.waste = {
      tonnesThisYearSoFar: Math.round(wasteTonnesYTD),
      tonnesPerYearRate: Math.round(tonnesRate),
      costPerYear: Math.round(MODELLED.wasteFixedPerYear + tonnesRate * MODELLED.wasteVariableCostPerTonne),
      costPerTonne: MODELLED.wasteVariableCostPerTonne,
      bargeShareOfTonneCost: 36,
      chargeRaisedFromIsland: Math.round(annualWasteCharge),
      basis: `Variable cost of ${money(MODELLED.wasteVariableCostPerTonne)} a tonne is modelled: a barge crossing at about ${money(CITED.commercialVehiclePerMetre.value)} a metre for a commercial vehicle, plus mainland haulage, gate fees and the landfill levy. Only the ${money(CITED.wasteChargePerDwelling.value)} household charge is a reported figure.`,
      source: CITED.wasteChargePerDwelling.source,
      sentence: `About ${Math.round(tonnesRate)} tonnes leaves the island a year, on a boat, and the tonnage moves with who is here.`
    };

    state.islandLedger = {
      ratesRaised: Math.round(annualRates),
      wasteChargeRaised: Math.round(annualWasteCharge),
      ownSource: Math.round(ownSource),
      programAllocation: Math.round(islandSpend),
      ratio: +(islandSpend / Math.max(1, ownSource)).toFixed(2),
      perHousehold: Math.round(ownSource / Math.max(1, dwellings.total)),
      sentence: `The island raises about ${moneyShort(ownSource)} a year in rates and the waste charge, and its council program is ${moneyShort(islandSpend)}.`,
      caveat: 'The rating figures here are modelled, not from Redland City Council\'s rating schedule, and the waste charge funds a city-wide system rather than only what happens on the island. Read the ratio as a shape, not a finding.',
      confidence: 'low'
    };

    state.revenue = [
      line('General rates', annualRates, 'modelled', `${money(MODELLED.generalRatePrincipal)} a year for a principal residence and ${money(MODELLED.generalRateOther)} for everything else. Modelled from typical south-east Queensland rating. Redland City Council's own rating schedule was not read for this build.`, 'low'),
      line('Waste utility charge', annualWasteCharge, 'reported', CITED.wasteChargePerDwelling.basis, CITED.wasteChargePerDwelling.confidence),
      line('Water and sewerage charges', waterChargesPerYear(), 'modelled', 'Ring-fenced to Redland Water.', 'low'),
      line('State islands infrastructure share', islandShareOfGrant(), 'part-reported', CITED.islandsBoost2025.basis + ' The island share here is modelled at ' + Math.round(MODELLED.islandShareOfIslandsGrant * 100) + ' per cent.', 'low'),
      line('Camping and vehicle access permits', campingRevenuePerYear(w), 'modelled', 'Goes to QYAC through Minjerribah Camping. No site count or permit price could be verified for this build.', 'low'),
      line('Visitor levy on paid accommodation', levyRevenuePerYear(w), 'modelled', 'Only if the levy lever is in effect.', 'low')
    ].filter((r) => r.amount > 0);

    const opex = Object.entries(MODELLED.baseOperating).map(([k, v]) =>
      line(k.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), v, 'modelled', 'Island share of a council service.', 'low'));
    opex.push(line('Waste, including the barge', state.waste.costPerYear, 'modelled', state.waste.basis, 'low'));
    for (const c of commitments) {
      if (!c.active || !c.recurring) continue;
      opex.push(line(c.name, c.recurring, c.standing ? 'already running' : 'committed', 'From data/civic.json cost_aud.recurring_per_year.', 'low'));
    }
    state.expenditure = opex.sort((a, b) => b.amount - a.amount);

    state.commitments = commitments.filter((c) => c.active).map((c) => ({
      leverId: c.leverId, name: c.name, fund: c.fund,
      capital: Math.round(c.capital), drawn: Math.round(c.drawnToDate),
      recurring: Math.round(c.recurring), standing: !!c.standing,
      remaining: Math.round(Math.max(0, c.capital - c.drawnToDate))
    }));
    state.recentSpends = oneOffs.slice(0, 10);
  }

  function line(label, amount, basisKind, basis, confidence) {
    return { label, amount: Math.round(amount), text: moneyShort(amount), basisKind, basis, confidence };
  }

  /* ------------------------------------------------------------------ registration */

  return world.register({
    id: 'budget',
    phase: 'civic',
    order: 10,

    init(w) {
      build(w);
      w.bus.on('civic:commitment', (p) => inbox.push(['commit', p]));
      w.bus.on('civic:release', (p) => inbox.push(['release', p]));
      w.bus.on('civic:spend', (p) => inbox.push(['spend', p]));
      w.bus.on('civic:tranche-granted', (p) => inbox.push(['tranche', p]));
      w.bus.on('civic:delivered', (p) => inbox.push(['delivered', p]));

      state.canSpend = canSpend;
      state.money = money;
      state.moneyShort = moneyShort;
      state.fundCard = (id) => state.funds[id] || null;
    },

    tick(w) {
      if (!state.ready) return;
      while (inbox.length) {
        const [kind, p] = inbox.shift();
        if (kind === 'commit') commit(w, p);
        else if (kind === 'release') release(w, p.leverId);
        else if (kind === 'spend') {
          if (p.amount > 0) book(w, p.fund || 'council-island', p.amount, p.reason || 'unnamed', p.category || 'other');
        } else if (kind === 'tranche') {
          if (!p.silent) {
            const amount = p.amount || 12000000;
            FUNDS['minjerribah-futures'].balance += amount;
            state.futuresExhausted = false;
          }
          state.notes.push(`A further transition tranche of ${moneyShort(p.amount || 12000000)} was granted. Modelled: no tranche beyond the ${money(CITED.futuresApproved.value)} approved to April 2024 has been announced.`);
          if (state.notes.length > 12) state.notes.shift();
        } else if (kind === 'delivered') {
          // Capital is done. What is left is the cost of owning the thing.
          const c = commitments.find((x) => x.leverId === p.leverId && x.active);
          if (c) { c.capital = c.drawnToDate; c.perDay = 0; }
          // Asking the state for another tranche is a lever in the pack, and if it lands it has to
          // land as money rather than as a number moving on a chart. Two years from the ask.
          if (p.leverId === 'next-transition-tranche') {
            const amount = 12000000;
            FUNDS['minjerribah-futures'].balance += amount;
            state.futuresExhausted = false;
            w.bus.emit('civic:tranche-granted', { amount, silent: true });
            w.bus.emit('civic:metric-nudge', {
              metric: 'state_budget', delta: -0.08, reason: 'a further transition tranche was granted',
              source: 'civic/budget.js', halfLifeDays: 900
            });
          }
        }
      }
      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        dailyPass(w);
      }
    },

    describe(w) {
      const ci = state.funds['council-island'] || {};
      const mf = state.funds['minjerribah-futures'] || {};
      return {
        fy: state.fy,
        adopted: state.adopted,
        council: ci.balance,
        councilHeadroom: ci.headroomShare,
        futures: mf.balance,
        recurringCommitted: Math.round(commitments.filter((c) => c.active).reduce((s, c) => s + c.recurring, 0)),
        capitalOutstanding: Math.round(commitments.filter((c) => c.active).reduce((s, c) => s + Math.max(0, c.capital - c.drawnToDate), 0)),
        wasteTonnesRate: state.waste.tonnesPerYearRate,
        ownSourceVsProgram: state.islandLedger.ratio,
        daysToAdoption: state.daysToAdoption
      };
    },

    save() {
      return {
        v: 1, fyKey, fyStartDay, yearRevenue, yearSpend, wasteTonnesYTD, wasteTonnesLastYear, lastDay,
        adopted: state.adopted, dwellings, residents,
        overdrawnFlagged: !!state.overdrawnFlagged, futuresExhausted: !!state.futuresExhausted,
        inbox: inbox.slice(),
        funds: Object.values(FUNDS).map((f) => [f.id, f.balance, f.allocation || 0, f.capitalProgram || 0, f.revenueYTD, f.spendYTD, f.committedRecurring]),
        commitments: commitments.map((c) => [c.leverId, c.name, c.fund, c.capital, c.recurring, c.drawnToDate, c.perDay, c.startDay || 0, c.endDay || 0, c.active ? 1 : 0, c.standing ? 1 : 0]),
        history: state.history
      };
    },

    load(w, s) {
      if (!s || !state.ready) return;
      fyKey = s.fyKey; fyStartDay = s.fyStartDay;
      yearRevenue = s.yearRevenue; yearSpend = s.yearSpend;
      wasteTonnesYTD = s.wasteTonnesYTD; wasteTonnesLastYear = s.wasteTonnesLastYear;
      state.adopted = !!s.adopted;
      for (const [id, balance, allocation, capitalProgram, revenueYTD, spendYTD, committedRecurring] of s.funds || []) {
        const f = FUNDS[id];
        if (f) Object.assign(f, { balance, allocation, capitalProgram, revenueYTD, spendYTD, committedRecurring });
      }
      commitments.length = 0;
      for (const c of s.commitments || []) {
        commitments.push({
          leverId: c[0], name: c[1], fund: c[2], capital: c[3], recurring: c[4], drawnToDate: c[5],
          perDay: c[6], startDay: c[7], endDay: c[8], active: !!c[9], standing: !!c[10]
        });
      }
      state.history = s.history || [];
      if (s.dwellings) dwellings = s.dwellings;
      if (s.residents) residents = s.residents;
      state.overdrawnFlagged = !!s.overdrawnFlagged;
      state.futuresExhausted = !!s.futuresExhausted;
      inbox.length = 0;
      for (const m of s.inbox || []) inbox.push(m);
      lastDay = s.lastDay != null ? s.lastDay : -1;
      state.daysToAdoption = daysToAdoption(w);
      publish(w);
    }
  });
}
