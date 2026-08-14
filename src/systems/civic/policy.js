// The lever engine.
//
// Everything here is driven by data/civic.json. Sixty-two real levers, fifty metrics, twenty-three
// issues, all researched with a source field. This file does not invent a lever, a cost, a magnitude
// or an interest group. It reads the pack and makes it move through time.
//
// The three things that make a civic decision hard, and that this file models:
//
//   1. DELAY. A lever pulled today shows nothing for months. Every effect carries delay_months from
//      the pack, and the pack says to apply it as a ramp rather than a step: "Nothing on this island
//      happens on the day it is announced."
//   2. UNCERTAINTY. The pack's magnitudes are modelling values, not measured elasticities, and it
//      says so. So a magnitude is a claim, not a promise. The realised value is drawn once, at
//      enactment, from a band set by that effect's own confidence. A low-confidence effect can land
//      at a third of what was promised, or backwards.
//   3. SECOND ORDER. Every lever in the pack carries side_effects with their own delays. They are
//      not shown up front. They arrive later and are surfaced as discoveries, with the pack's own
//      one-line description of what just happened and why.
//
// THE BASELINE RULE, which is the thing to understand before reading anything else here.
// Twenty-two levers in the pack are marked `in_place`. Their effects are already in the island the
// player starts on: the dunes are the condition they are because dune restoration is already
// running. So an in_place lever contributes zero while it sits at its status quo. It matters in two
// directions instead: step it up and the pack's effects apply, or cease it and they unwind. Cutting
// a program the island already has is a real decision with a real, delayed, discoverable cost, and
// it is the cheapest thing a budget under pressure will reach for.
//
// Metric ownership lives here and nowhere else. Council, consultation and budget move metrics by
// emitting `civic:metric-nudge` with a reason string, so every movement on every metric can be
// traced to something that happened, by name, in the explain() read model.
//
// Reads nothing it cannot survive without. If visitors, population, weather or coast are not built
// yet, the live couplings report themselves as not connected and contribute nothing.

const DAYS_PER_MONTH = 30.4375;

/** Metrics whose unit is a real count rather than a 0..1 index. Everything else in the pack is an
 *  index, including the ones whose unit says sites, beds or dwellings: their notes say so. */
const COUNTED = {
  visitor_volume: { swing: 300000, min: 40000, max: 900000, round: 1000 },
  population_permanent: { swing: 1200, min: 600, max: 5000, round: 1 }
};

/** Effects arrive inside a band set by their own confidence. These are the bands. */
const CONFIDENCE_BAND = { high: 0.15, medium: 0.35, low: 0.7 };
/** A low-confidence effect can land the wrong way round. That is what low confidence means. */
const BACKFIRE_CHANCE = { high: 0, medium: 0.03, low: 0.12 };

/** How fast a metric follows its target. Half-life in days. Civic metrics are slow. */
const METRIC_HALF_LIFE_DAYS = 21;
/** What people are used to. Moods react to the change from this, not to the absolute. 18 months. */
const REMEMBERED_HALF_LIFE_DAYS = 548;

/** When a lever stops, do its effects stop? Depends on whether it built something. */
const UNWIND_HALF_LIFE_DAYS = { capital: 1100, program: 180 };

/** A side effect becomes a discovery once it is big enough to notice and has had time to land. */
const DISCOVERY_THRESHOLD = 0.025;
const DISCOVERY_MIN_DAYS = 30;

export function registerPolicy(world) {
  // world.rng.restore() rebuilds the pool with fresh Rng objects rather than mutating the existing
  // ones, so a stream captured at registration is a stale object after a load and quietly draws from
  // a different position in the sequence. Resolve the stream at the point of use. It is a Map lookup.
  const STREAM = 'civic-policy';
  const rng = {
    float: () => world.rng.stream(STREAM).float(),
    int: (a, b) => world.rng.stream(STREAM).int(a, b),
    bool: (p) => world.rng.stream(STREAM).bool(p),
    pick: (a) => world.rng.stream(STREAM).pick(a),
    normal: (m, s) => world.rng.stream(STREAM).normal(m, s),
    weighted: (items, fn) => world.rng.stream(STREAM).weighted(items, fn)
  };

  const state = world.publish('policy', {
    ready: false,
    day: 0,
    metrics: {},
    levers: {},
    issues: [],
    active: [],
    delivering: [],
    discoveries: [],
    nudges: [],
    qyacSqueeze: { on: false, count: 0, levers: [], rule: '' },
    couplings: [],
    obligations: [],
    obligationSummary: { total: 0, engaged: 0, atIssue: 0, daysAtIssue: 0, byForce: {}, note: '' },
    notes: [],
    explain: () => [],
    leverCard: () => null,
    metricCard: () => null,
    obligationsFor: () => []
  });

  /** id -> metric runtime */
  const M = new Map();
  /** id -> lever runtime */
  const L = new Map();
  /** id -> obligation runtime. See buildObligations(). */
  const O = new Map();
  /** every live contribution, in a flat list so the daily pass is one loop */
  const contributions = [];
  /** named nudges from council, consultation and budget */
  const nudges = [];
  /** pack lookups */
  let pack = null;
  const inbox = [];
  let lastDay = -1;
  let seq = 0;
  /**
   * A rolling year of arrivals, so the visitor number is counted rather than assumed. Sampled as a
   * running peak through the day and banked at the rollover: the visitors system resets its daily
   * counter on the same tick this one wakes up, so reading it at the rollover reads a fresh zero.
   */
  const arrivals = new Float64Array(365);
  let arrivalsFilled = 0, arrivalsPeak = 0;

  /* ------------------------------------------------------------------ helpers */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayOf = (w) => w.clock.dayIndex;
  const halfLifeDecay = (days, halfLife) => Math.pow(0.5, days / halfLife);

  function metricSwing(id) {
    return COUNTED[id] ? COUNTED[id].swing : 1;
  }

  function clampMetric(id, v) {
    const c = COUNTED[id];
    if (c) return clamp(v, c.min, c.max);
    return clamp(v, 0, 1);
  }

  /* ------------------------------------------------------------------ boot */

  function build(w) {
    pack = (w.data && w.data.civic) || null;
    if (!pack || !Array.isArray(pack.levers)) {
      state.notes.push('data/civic.json is missing or has no levers. The civic slice is inert.');
      return;
    }

    for (const m of pack.metrics || []) {
      const counted = !!COUNTED[m.id];
      M.set(m.id, {
        id: m.id,
        label: m.label,
        unit: m.unit,
        direction: m.direction,
        note: m.note || '',
        source: m.source,
        confidence: m.confidence,
        counted,
        baseline: m.baseline,
        value: m.baseline,
        target: m.baseline,
        remembered: m.baseline,
        live: 0,
        policy: 0,
        nudge: 0,
        movers: [],
        dayDelta: 0,
        yesterday: m.baseline
      });
    }

    for (const lv of pack.levers) {
      const decider = (lv.who_decides && lv.who_decides[0]) || 'community';
      const inPlace = lv.status === 'in_place';
      const rt = {
        id: lv.id,
        name: lv.name,
        issue: lv.issue,
        role: lv.player_role,
        packStatus: lv.status,
        deciders: lv.who_decides.slice(),
        decider,
        leadMonths: lv.lead_time_months || 0,
        capital: (lv.cost_aud && lv.cost_aud.capital) || 0,
        recurring: (lv.cost_aud && lv.cost_aud.recurring_per_year) || 0,
        costBasis: (lv.cost_aud && lv.cost_aud.basis) || '',
        costConfidence: (lv.cost_aud && lv.cost_aud.confidence) || 'low',
        // level: -1 ceased, 0 status quo, +1 the pack's described change in effect
        level: 0,
        status: inPlace ? 'in-place' : lv.status === 'funded' ? 'delivering' : 'dormant',
        startedDay: null,
        progress: 0,
        deliveryDays: Math.max(1, Math.round((lv.lead_time_months || 1) * DAYS_PER_MONTH)),
        conditions: [],
        // The obligations that sit over this lever, filled by buildObligations() out of the pack.
        obligations: [],
        restsOnPlayerAssumption: false,
        squeezed: false,
        squeezeDays: 0,
        my: [],             // contribution ids owned by this lever
        note: lv.note || '',
        source: lv.source,
        history: []
      };
      L.set(lv.id, rt);
    }

    // The one lever the player can only watch. Mining ended at the end of 2019 under the 2011 Act as
    // amended in 2016; rehabilitation has been running since. Its early effects are already in the
    // baseline. Its ninety-six month side effect, the rehabilitation work finishing and those jobs
    // going with it, has not arrived yet, and it lands inside this simulation.
    const rehab = L.get('mine-rehabilitation-pace');
    if (rehab) {
      const startISO = Date.UTC(2019, 11, 31) / 86400000;
      rehab.startedDay = Math.round(startISO - w.clock.epochDay); // negative: before the sim began
      rehab.level = 1;
      rehab.status = 'running';
      enact(w, 'mine-rehabilitation-pace', { silent: true, backdated: true });
    }

    // The seawall is the one lever the pack marks funded: decided, paid for, not yet built.
    const wall = L.get('amity-southern-buried-seawall');
    if (wall) {
      wall.startedDay = 0;
      wall.level = 1;
      wall.status = 'delivering';
      enact(w, 'amity-southern-buried-seawall', { silent: true, alreadyDecided: true });
    }

    for (const iss of pack.issues || []) {
      state.issues.push({
        id: iss.id,
        label: iss.label,
        oneLine: iss.one_line,
        tension: iss.primary_tension,
        levers: (iss.levers || []).filter((id) => L.has(id)),
        heat: 0
      });
    }

    buildObligations(w);

    state.qyacSqueeze.rule = (pack.sim_defaults && pack.sim_defaults.qyac_capacity_rule) || '';
    state.notes.push(`${L.size} levers, ${M.size} metrics, ${state.issues.length} issues from data/civic.json.`);
    state.notes.push('Levers marked in_place in the pack sit at zero because their effects are already in the island the player starts on. They move when they are stepped up, and they unwind when they are cut.');
    publishLevers();
    publishMetrics();
    state.ready = true;
  }

  /* ------------------------------------------------------------------ enacting */

  function packLever(id) {
    return (pack.levers || []).find((x) => x.id === id) || null;
  }

  /**
   * Turn a decision into contributions. `level` is +1 for the pack's described change and -1 for
   * ceasing an existing program, in which case every effect is applied in reverse.
   */
  function enact(w, leverId, opts = {}) {
    const rt = L.get(leverId);
    const lv = packLever(leverId);
    if (!rt || !lv) return null;
    const level = opts.level != null ? opts.level : 1;
    const day = opts.backdated && rt.startedDay != null ? rt.startedDay : dayOf(w);

    // Conditions attached by the decision maker can scale a lever before it starts.
    let magScale = 1, timeScale = 1;
    for (const c of rt.conditions) {
      magScale *= c.magnitudeScale != null ? c.magnitudeScale : 1;
      timeScale *= c.leadTimeScale != null ? c.leadTimeScale : 1;
    }

    rt.level = level;
    rt.startedDay = day;
    rt.deliveryDays = Math.max(1, Math.round(rt.leadMonths * DAYS_PER_MONTH * timeScale));
    // A back-dated lever is already part way through. Mining ended at the end of 2019 and the
    // rehabilitation has been running ever since; it does not start again on day one.
    rt.progress = day < 0 ? clamp(-day / rt.deliveryDays, 0, 1) : 0;
    rt.status = level < 0 ? 'ceasing' : rt.progress >= 1 ? 'active' : rt.deliveryDays > 1 ? 'delivering' : 'active';
    rt.restsOnPlayerAssumption = !!opts.restsOnPlayerAssumption || rt.restsOnPlayerAssumption;

    const rampBase = Math.max(15, Math.round((rt.leadMonths / 2) * DAYS_PER_MONTH * timeScale));

    const add = (e, kind, description) => {
      const met = M.get(e.target);
      if (!met) return;
      const conf = e.confidence || lv.confidence || rt.costConfidence || 'low';
      const stated = e.magnitude * level * magScale;
      // Conditions can target one named side effect rather than the whole lever.
      let condScale = 1;
      for (const c of rt.conditions) {
        if (c.dampens && c.dampens.includes(e.target) && kind === 'side') condScale *= c.dampenScale ?? 0.4;
      }
      const realised = realise(stated * condScale, conf);
      const delayDays = realiseDelay(e.delay_months || 0, conf);
      contributions.push({
        cid: ++seq,
        leverId,
        leverName: rt.name,
        kind,
        target: e.target,
        stated: stated * condScale,
        realised,
        confidence: conf,
        startDay: day,
        delayDays,
        rampDays: rampBase,
        description: description || '',
        alive: true,
        unwinding: false,
        unwindFrom: 0,
        unwindDay: 0,
        discovered: kind !== 'side',
        restsOnPlayerAssumption: rt.restsOnPlayerAssumption
      });
      rt.my.push(seq);
    };

    // Effects that have already arrived, for a back-dated lever, are part of the island the player
    // starts on. Only the ones still in the future are simulated.
    const elapsed = day < 0 ? -day : 0;
    for (const e of lv.effects || []) {
      if (elapsed > 0 && (e.delay_months || 0) * DAYS_PER_MONTH + rampBase < elapsed) continue;
      add(e, 'effect', '');
    }
    for (const e of lv.side_effects || []) {
      if (elapsed > 0 && (e.delay_months || 0) * DAYS_PER_MONTH + rampBase < elapsed) continue;
      add(e, 'side', e.description || '');
    }

    // The pack's own rule: being right is not the same as being consulted.
    if (level > 0 && lv.player_role === 'player_decides' && !isSteppedUp('consultation-model') && !opts.silent) {
      nudge(w, {
        metric: 'consultation_trust',
        delta: -0.05,
        reason: `${rt.name} was decided without the consultation model in place`,
        source: 'data/civic.json sim_defaults.consultation_trust_rule',
        halfLifeDays: 540
      });
    }

    if (!opts.silent) {
      w.bus.emit('civic:enacted', {
        leverId, name: rt.name, level, deliveryDays: rt.deliveryDays,
        capital: rt.capital, recurring: rt.recurring, decider: rt.decider,
        conditions: rt.conditions.map((c) => c.label),
        restsOnPlayerAssumption: rt.restsOnPlayerAssumption
      });
      rt.history.push({ day, event: level > 0 ? 'enacted' : 'ceased', detail: rt.conditions.map((c) => c.label).join('; ') });
    }
    publishLevers();
    return rt;
  }

  /** Draw the realised magnitude once. Confidence sets the band; low confidence can go backwards. */
  function realise(stated, confidence) {
    if (!stated) return 0;
    const band = CONFIDENCE_BAND[confidence] ?? CONFIDENCE_BAND.low;
    let v = stated * (1 + rng.normal(0, band * 0.6));
    const lo = stated > 0 ? stated * (1 - band * 1.6) : stated * (1 + band * 1.6);
    const hi = stated > 0 ? stated * (1 + band * 1.6) : stated * (1 - band * 1.6);
    v = clamp(v, Math.min(lo, hi), Math.max(lo, hi));
    if (rng.float() < (BACKFIRE_CHANCE[confidence] ?? 0)) v = -Math.abs(v) * Math.sign(stated) * 0.5;
    return v;
  }

  /** Things run late far more often than they run early. */
  function realiseDelay(months, confidence) {
    const base = months * DAYS_PER_MONTH;
    if (base <= 0) return 0;
    const spread = confidence === 'high' ? 0.10 : confidence === 'medium' ? 0.22 : 0.35;
    const centre = confidence === 'high' ? 0.04 : confidence === 'medium' ? 0.12 : 0.2;
    return Math.round(base * (1 + Math.max(-0.1, rng.normal(centre, spread))));
  }

  function isSteppedUp(id) {
    const rt = L.get(id);
    return !!rt && rt.level > 0;
  }

  /**
   * Stop something.
   *
   * Two different things wear that word, and telling them apart is the whole reason this file has a
   * baseline rule. Stopping a lever you switched on unwinds what it did: fast for a program, slowly
   * for anything that got built, because a seawall stays after the funding for it does not. Stopping
   * a lever that was already running when the twin started is the opposite: it was sitting at zero
   * because its work is already in the island, so cutting it applies the pack's effects in reverse,
   * on the pack's own delays. Cut dune restoration and the dunes do not fall over on the Tuesday.
   * They go quietly, over about two years, and by then it is somebody else's problem.
   */
  function cease(w, leverId, reason) {
    const rt = L.get(leverId);
    if (!rt) return;
    const day = dayOf(w);

    if (rt.level === 0 && (rt.packStatus === 'in_place' || rt.packStatus === 'funded')) {
      enact(w, leverId, { level: -1 });
      rt.status = 'ceasing';
      rt.history.push({ day, event: 'cut', detail: reason || 'Funding withdrawn from a program the island already had.' });
      // Taking away something the island already had is not the same as declining to start it, and
      // the island reads it that way for years.
      nudge(w, {
        metric: 'consultation_trust',
        delta: -0.06,
        reason: `${rt.name} was cut`,
        source: 'civic/policy.js',
        halfLifeDays: 1100
      });
    } else {
      for (const c of contributions) {
        if (c.leverId !== leverId || !c.alive || c.unwinding) continue;
        c.unwinding = true;
        c.unwindDay = day;
        c.unwindFrom = currentValue(c, day);
        c.unwindHalfLife = rt.capital > 0 ? UNWIND_HALF_LIFE_DAYS.capital : UNWIND_HALF_LIFE_DAYS.program;
      }
      rt.status = 'lapsed';
      rt.level = 0;
      rt.history.push({ day, event: 'stopped', detail: reason || '' });
    }
    w.bus.emit('civic:lapsed', { leverId, name: rt.name, reason: reason || '' });
    w.bus.emit('civic:release', { leverId });
    publishLevers();
  }

  /* ------------------------------------------------------------------ the daily pass */

  function currentValue(c, day) {
    if (c.unwinding) {
      return c.unwindFrom * halfLifeDecay(day - c.unwindDay, c.unwindHalfLife || 365);
    }
    // A stalled project's clock stops with it. Delay does not run down while nothing is happening.
    const t = day - c.startDay - (c.stallDays || 0) - c.delayDays;
    if (t <= 0) return 0;
    const ramp = c.rampDays > 0 ? Math.min(1, t / c.rampDays) : 1;
    return c.realised * ramp * (c.squeeze ? 0.5 : 1);
  }

  /**
   * @param advanceTime false when this is being called to rebuild the read model after a load,
   *        where nothing may move: no extra day of delivery, no extra step of metric lag. Getting
   *        this wrong is how a saved game quietly stops matching the game it was saved from.
   */
  function dailyPass(w, advanceTime = true) {
    const day = dayOf(w);
    state.day = day;

    if (advanceTime) {
      arrivals[day % 365] = arrivalsPeak;
      arrivalsPeak = 0;
      if (arrivalsFilled < 365) arrivalsFilled++;
    }

    applyQyacCapacityRule(w, advanceTime);

    // 1. Zero the policy contribution on every metric, then sum the live ones.
    for (const m of M.values()) { m.policy = 0; m.movers.length = 0; }
    const leverHeat = new Map();

    for (let i = contributions.length - 1; i >= 0; i--) {
      const c = contributions[i];
      if (!c.alive) continue;
      const rt = L.get(c.leverId);
      c.squeeze = !!(rt && rt.squeezed);
      if (advanceTime && rt && rt.stalled && !c.unwinding) c.stallDays = (c.stallDays || 0) + 1;
      const v = currentValue(c, day);
      if (c.unwinding && Math.abs(v) < 0.001) { c.alive = false; contributions.splice(i, 1); continue; }
      if (v === 0) continue;
      const m = M.get(c.target);
      if (!m) continue;
      leverHeat.set(c.leverId, (leverHeat.get(c.leverId) || 0) + Math.abs(v));
      m.policy += v * metricSwing(c.target);
      m.movers.push({
        kind: c.kind,
        leverId: c.leverId,
        label: c.leverName,
        value: v,
        text: c.kind === 'side' ? c.description : null,
        restsOnPlayerAssumption: c.restsOnPlayerAssumption
      });

      // Second order becomes visible only once it is big enough to notice.
      if (advanceTime && !c.discovered && Math.abs(v) >= DISCOVERY_THRESHOLD && day - c.startDay - c.delayDays >= DISCOVERY_MIN_DAYS) {
        c.discovered = true;
        const rec = {
          day,
          date: w.clock.formatDate(),
          leverId: c.leverId,
          leverName: c.leverName,
          metric: c.target,
          metricLabel: m.label,
          direction: worseOrBetter(m, v),
          text: c.description || `${c.leverName} is moving ${m.label}.`,
          magnitude: +v.toFixed(3)
        };
        state.discoveries.unshift(rec);
        if (state.discoveries.length > 40) state.discoveries.pop();
        w.bus.emit('civic:discovery', rec);
      }
    }

    // 2. Nudges: named, decaying, from council, consultation and budget.
    for (const m of M.values()) m.nudge = 0;
    for (let i = nudges.length - 1; i >= 0; i--) {
      const n = nudges[i];
      const v = n.delta * halfLifeDecay(day - n.day, n.halfLifeDays);
      if (Math.abs(v) < 0.0015) { nudges.splice(i, 1); continue; }
      const m = M.get(n.metric);
      if (!m) { nudges.splice(i, 1); continue; }
      m.nudge += v * metricSwing(n.metric);
      m.movers.push({ kind: 'nudge', leverId: null, label: n.reason, value: v, text: n.source || null });
    }

    // 3. Live couplings: what the rest of the island is doing to these numbers.
    runCouplings(w);

    // 3b. The layer above. Deliberately after the couplings and before the metrics settle, because
    // it reads the world and writes nothing back: no obligation may ever appear in m.policy,
    // m.nudge or m.live. If a future pass wants an obligation to move a number, that is a design
    // decision and it needs an argument, not an extra line here.
    stepObligations(w, advanceTime);

    // 4. Settle. Metrics lag their target; memory lags the value.
    const k = 1 - halfLifeDecay(1, METRIC_HALF_LIFE_DAYS);
    const kr = 1 - halfLifeDecay(1, REMEMBERED_HALF_LIFE_DAYS);
    for (const m of M.values()) {
      m.yesterday = m.value;
      // No one channel owns a metric. Levers, named nudges from elsewhere on the island, and the
      // live couplings each get their own soft ceiling, so a busy upstream system can dominate a
      // number without erasing everything else that moves it.
      const cap = 0.62 * metricSwing(m.id);
      m.target = clampMetric(m.id, m.baseline + soften(m.policy, cap) + soften(m.nudge, cap) + soften(m.live, cap));
      if (advanceTime) {
        m.value += (m.target - m.value) * k;
        m.remembered += (m.value - m.remembered) * kr;
      }
      m.dayDelta = m.value - m.yesterday;
      m.movers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      if (m.movers.length > 6) m.movers.length = 6;
    }

    // 5. Delivery progress and the moment a lever finishes.
    if (advanceTime) {
      for (const rt of L.values()) {
        if (rt.status !== 'delivering' || rt.startedDay == null) continue;
        if (rt.stalled) continue;   // the money stopped, so the works stopped
        const rate = rt.squeezed ? 0.5 : 1;
        rt.progress = clamp(rt.progress + rate / rt.deliveryDays, 0, 1);
        if (rt.progress >= 1) {
          rt.status = 'active';
          rt.history.push({ day, event: 'delivered', detail: '' });
          w.bus.emit('civic:delivered', { leverId: rt.id, name: rt.name });
        }
      }
    }

    // 6. Issue heat: how much is moving under each issue right now.
    for (const iss of state.issues) {
      let heat = 0;
      for (const id of iss.levers) {
        const rt = L.get(id);
        if (!rt) continue;
        if (rt.status === 'delivering') heat += 0.5;
        else if (rt.status === 'active' || rt.status === 'ceasing') heat += 0.3;
        heat += (leverHeat.get(id) || 0) * 0.6;
      }
      iss.heat = +clamp(heat, 0, 3).toFixed(2);
    }

    publishMetrics();
    publishLevers();
  }

  function worseOrBetter(m, v) {
    if (m.direction === 'context') return 'changed';
    const good = m.direction === 'higher_is_better' ? v > 0 : v < 0;
    return good ? 'better' : 'worse';
  }

  /**
   * The pack's rule, applied literally: "If more than two levers whose who_decides includes qyac are
   * in delivery at once, halve the magnitude of all their effects and double their lead_time_months.
   * This is the audit office finding, expressed as a rule."
   */
  function applyQyacCapacityRule(w, advanceTime = true) {
    const inDelivery = [];
    for (const rt of L.values()) {
      if (rt.status === 'delivering' && rt.deciders.includes('qyac')) inDelivery.push(rt.id);
    }
    inDelivery.sort();
    const on = inDelivery.length > 2;
    for (const rt of L.values()) {
      const should = on && rt.deciders.includes('qyac') && rt.status === 'delivering';
      if (should && !rt.squeezed) {
        rt.squeezed = true;
        if (advanceTime) rt.history.push({ day: dayOf(w), event: 'capacity', detail: 'Delivery slowed: too many projects with the same body at once.' });
      } else if (!should && rt.squeezed) {
        rt.squeezed = false;
      }
      if (rt.squeezed && advanceTime) rt.squeezeDays++;
    }
    if (on !== state.qyacSqueeze.on) {
      state.qyacSqueeze.on = on;
      if (advanceTime) w.bus.emit('civic:capacity', {
        body: 'qyac', on, count: inDelivery.length,
        note: 'The Queensland Audit Office found QYAC was assigned multiple complex construction projects at once, with fewer than 100 staff, without an adequate capacity assessment.'
      });
    }
    state.qyacSqueeze.count = inDelivery.length;
    state.qyacSqueeze.levers = inDelivery;
  }

  /* ------------------------------------------------------------------ live couplings

  The civic numbers must not be a spreadsheet that only moves when the player moves it. These read
  the rest of the island. Each one is defensive: if the system it needs is not built, it reports
  itself as not connected and contributes nothing, and describe() says so. */

  const COUPLINGS = [
    {
      id: 'visitor-load',
      needs: 'visitors',
      note: 'Peak load, parking, traffic, litter and trade all follow how many people are actually on the island.',
      apply(w, out) {
        const v = w.read('visitors');
        if (!v || !v.ready) return false;
        const p = clamp(v.pressure || 0, 0, 1.6);
        const d = p - 0.5;
        out('peak_day_load', d * 0.55);
        out('parking_pressure', d * 0.4);
        out('traffic_volume', d * 0.35);
        out('litter', d * 0.22);
        out('waste_export_tonnes', d * 0.2);
        out('business_viability', d * 0.28);
        out('resident_amenity', -d * 0.3);
        out('visitor_satisfaction', -Math.max(0, d) * 0.25);
        if (v.turnedAwayRolling30 > 0) out('island_accessibility', -clamp(v.turnedAwayRolling30 / 400, 0, 0.25));
        return true;
      }
    },
    {
      id: 'annual-visitors',
      needs: 'visitors',
      note: 'A rolling year of actual arrivals off the boats, shown beside the published figure rather than replacing it.',
      apply(w, out) {
        const v = w.read('visitors');
        if (!v || !v.ready) return false;
        // No lever in the pack moves this metric: it is context, and its baseline is a published
        // 2018 figure that the pack says has no post-2019 replacement. So the simulation's own count
        // is reported next to it and never written over it. A modelled number quietly replacing a
        // sourced one is how a twin starts lying to the person who lives here.
        const m = M.get('visitor_volume');
        if (m && arrivalsFilled >= 30) {
          let sum = 0;
          for (let i = 0; i < arrivalsFilled; i++) sum += arrivals[i];
          m.simCount = Math.round((sum / arrivalsFilled) * 365 / 1000) * 1000;
          m.simCountDays = arrivalsFilled;
        }
        return true;
      }
    },
    {
      id: 'housing-occupancy',
      needs: 'population',
      note: 'Half the island\'s dwellings were empty on census night. Rental supply and short-stay stock follow the real occupancy in the simulation, not a slider.',
      apply(w, out) {
        const p = w.read('population');
        if (!p || !p.ready || !p.dwellings || !p.dwellings.total) return false;
        const unoccupiedShare = p.dwellings.unoccupied / p.dwellings.total;
        // 0.503 is the census figure the pack's baselines were set against.
        const d = unoccupiedShare - 0.503;
        out('rental_supply', -d * 0.9);
        out('short_stay_stock', d * 0.8);
        out('housing_affordability', -d * 0.5);
        if (p.residents) out('population_permanent', p.residents - 2156);
        if (p.schoolEnrolments) out('school_enrolments', clamp((p.schoolEnrolments - 120) / 400, -0.3, 0.3));
        return true;
      }
    },
    {
      id: 'fire-weather',
      needs: 'weather',
      note: 'Fuel load and smoke are weather-driven as well as policy-driven. A dry run lifts the hazard whatever the burn program is doing.',
      apply(w, out) {
        const wx = w.read('weather');
        if (!wx) return false;
        const fdi = wx.fireDangerIndex || 0;
        out('fire_hazard_load', clamp((fdi - 10) / 90, -0.08, 0.25));
        if (wx.rainWeek != null) out('water_security', clamp((wx.rainWeek - 20) / 300, -0.12, 0.12));
        return true;
      }
    },
    {
      id: 'storm-and-swell',
      needs: 'weather',
      note: 'Amity Point erosion is not a slow line on a chart. It moves in the days a big swell meets a spring tide.',
      apply(w, out) {
        const wx = w.read('weather');
        const td = w.read('tide');
        if (!wx) return false;
        const swell = wx.swellM || 0;
        const spring = td ? (td.springNeap || 0) : 0.5;
        const storm = clamp((swell - 2.2) / 2.5, 0, 1) * (0.6 + 0.4 * spring);
        out('erosion_risk_amity', storm * 0.12);
        out('beach_width_amity', -storm * 0.08);
        out('dune_condition', -storm * 0.05);
        return true;
      }
    },
    {
      id: 'wildlife-pressure',
      needs: 'traffic',
      note: 'Road deaths follow traffic. Until the traffic system is built this contributes nothing.',
      apply(w, out) {
        const t = w.read('traffic');
        if (!t) return false;
        const load = clamp(t.load ?? t.pressure ?? 0, 0, 1);
        out('wildlife_road_deaths', (load - 0.5) * 0.3);
        return true;
      }
    },
    {
      id: 'waste-flow',
      needs: 'waste',
      note: 'Tonnage off the island, if the waste system is publishing it.',
      apply(w, out) {
        const s = w.read('waste');
        if (!s || s.tonnesPerYear == null) return false;
        out('waste_export_tonnes', clamp((s.tonnesPerYear - 1650) / 3000, -0.25, 0.35));
        return true;
      }
    },
    {
      id: 'water-draw',
      needs: 'groundwater',
      note: 'Aquifer stress from the actual borefield draw, if the groundwater system is publishing it.',
      apply(w, out) {
        const g = w.read('groundwater');
        if (!g || g.stress == null) return false;
        out('aquifer_stress', clamp(g.stress - 0.35, -0.25, 0.4));
        return true;
      }
    }
  ];

  function runCouplings(w) {
    for (const m of M.values()) m.live = 0;
    state.couplings.length = 0;
    for (const c of COUPLINGS) {
      const out = (metricId, delta) => {
        const m = M.get(metricId);
        if (!m || !Number.isFinite(delta) || delta === 0) return;
        m.live += delta;
        m.movers.push({ kind: 'live', leverId: null, label: c.id, value: delta, text: c.note });
      };
      let connected = false;
      try { connected = !!c.apply(w, out); } catch (e) { connected = false; }
      state.couplings.push({ id: c.id, needs: c.needs, connected, note: c.note });
    }
  }

  /* ------------------------------------------------------------------ the treaty layer

  A LAYER, NOT A LEVER, AND THE DIFFERENCE IS THE WHOLE POINT.

  Everything else in this file is a decision: somebody enacts a thing, it takes months, it lands
  smaller or larger than promised, and it can be cut. `data/civic.json treaty_layer` is the other
  kind of constraint. Nine obligations, out of the Ramsar Convention, the Bonn Convention, the three
  bilateral migratory bird agreements, the flyway partnership, the EPBC Act and one state planning
  requirement. Not one of them is enactable, ceasable, fundable or persuadable, none of them has a
  magnitude, and nothing in this block ever writes to a metric. There is deliberately no path from
  here into `contributions`, so a future pass cannot quietly turn an obligation into a lever with a
  cost.

  What they do instead is three things:

    1. THEY SIT OVER LEVERS. `leversUnder` is computed from the pack: any lever whose effects or
       side effects touch a metric the obligation names. It is exact rather than curated, so a lever
       added later lands under the right obligations without anybody remembering to wire it.
    2. THEY READ THE WORLD, NOT THE BOARD. `engaged_when` and `at_issue_when` name a published read
       model and a field on it. The eastern curlew obligation is engaged when curlews are on the
       island and not otherwise; the Article 3.2 one goes to issue when the shorebird system's own
       character indicator falls below the band. Nothing a player does to the civic board can switch
       either of them off.
    3. THEY REMEMBER. `daysAtIssue` counts up and never decays, never resets and is not in anybody's
       budget. Cutting the program that caused it does not clear it, a new council does not clear
       it, and it is the only number on this board with that property. That is what an obligation is.

  AND THEY DECIDE NOTHING. No obligation here says a lever needs a referral, an approval or a
  notification. `national_environmental_significance.handling` in the pack, and `recordSection75` in
  council.js, both stop at the same place for the same reason: whether an action is likely to have a
  significant impact is a judgement for a proponent and then for a minister, and this project does
  not make it. This block does not make it either. It says which instrument reaches the ground. */

  const TRIGGER_TESTS = { above: (v, x) => v > x, below: (v, x) => v < x };

  /** Read one trigger. Defensive in the same way the live couplings are: an unbuilt system is not
   *  an engaged obligation, it is a disconnected one, and the read model says which. */
  function evalTrigger(w, t) {
    if (!t) return { on: false, connected: true, why: '' };
    if (t.always) return { on: true, connected: true, why: t.says || '' };
    if (t.never) return { on: false, connected: true, why: t.says || '' };
    const read = w.read(t.reads);
    if (!read) {
      return { on: false, connected: false, why: `${t.reads} is not built in this world, so nothing is watching this one.` };
    }
    const v = read[t.field];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { on: false, connected: false, why: `${t.reads} publishes no number at ${t.field} yet.` };
    }
    const test = TRIGGER_TESTS[t.test] || TRIGGER_TESTS.above;
    return { on: test(v, t.value), connected: true, value: v, threshold: t.value, why: t.says || '' };
  }

  function buildObligations(w) {
    const layer = pack.treaty_layer;
    if (!layer || !Array.isArray(layer.obligations)) {
      state.notes.push('data/civic.json carries no treaty_layer, so no international obligation is modelled. '
        + 'That is a gap in the pack rather than a decision by this file.');
      return;
    }
    const instruments = pack.instruments || [];
    for (const ob of layer.obligations) {
      if (!ob || !ob.id) continue;
      const named = [ob.instrument, ...(ob.also_instruments || [])].filter(Boolean);
      const resolved = named.map((id) => instruments.find((x) => x && x.id === id)).filter(Boolean);
      const metrics = (ob.metrics || []).filter((m) => M.has(m));
      // Which levers sit under this obligation. Read out of the pack rather than listed by hand, so
      // a lever added next month lands here without anybody remembering to.
      const under = [];
      for (const lv of pack.levers || []) {
        if (!L.has(lv.id)) continue;
        const touches = [...(lv.effects || []), ...(lv.side_effects || [])]
          .some((e) => e && metrics.includes(e.target));
        if (touches) under.push(lv.id);
      }
      under.sort();
      O.set(ob.id, {
        id: ob.id,
        pack: ob,
        instrumentLabel: resolved.length ? resolved[0].label : ob.instrument,
        instrumentLabels: resolved.map((x) => x.label),
        metrics,
        leversUnder: under,
        engaged: false,
        atIssue: false,
        engagedSinceDay: null,
        atIssueSinceDay: null,
        daysAtIssue: 0,
        connected: true,
        why: '',
        atIssueWhy: '',
        reading: null
      });
      for (const id of under) {
        const rt = L.get(id);
        if (rt && !rt.obligations.includes(ob.id)) rt.obligations.push(ob.id);
      }
    }
    state.notes.push(`${O.size} international and statutory obligations from data/civic.json treaty_layer, `
      + 'sitting over the levers rather than beside them. None of them is enactable and none of them '
      + 'moves a metric.');
    stepObligations(w, false);
  }

  /**
   * Once a day. Cheap: nine records, one read model lookup each.
   * @param advanceTime false on a load or a rebuild, where daysAtIssue must not tick and no
   *        transition event may fire, because the transition already happened in the saved game.
   */
  function stepObligations(w, advanceTime = true) {
    if (!O.size) return;
    const day = dayOf(w);
    let engaged = 0, atIssue = 0, daysTotal = 0;
    const byForce = {};

    for (const o of O.values()) {
      const ob = o.pack;
      const e = evalTrigger(w, ob.engaged_when);
      const wasEngaged = o.engaged;
      o.engaged = e.on;
      o.connected = e.connected;
      o.why = e.why;
      o.reading = e.value != null ? { value: +e.value.toFixed(3), threshold: e.threshold ?? null } : null;
      if (o.engaged && !wasEngaged) o.engagedSinceDay = day;
      if (!o.engaged) o.engagedSinceDay = null;

      // At issue is only meaningful while engaged. An obligation nobody is under cannot be strained.
      const i = ob.at_issue_when ? evalTrigger(w, ob.at_issue_when) : { on: false, connected: true, why: '' };
      const wasAtIssue = o.atIssue;
      o.atIssue = !!(o.engaged && i.on);
      o.atIssueWhy = i.why;
      if (i.value != null) o.reading = { value: +i.value.toFixed(3), threshold: i.threshold ?? null };

      if (o.atIssue) {
        if (!wasAtIssue) {
          o.atIssueSinceDay = day;
          if (advanceTime) {
            w.bus.emit('civic:obligation', {
              obligationId: o.id, state: 'at-issue', instrument: o.instrumentLabel,
              article: ob.article || '', force: ob.force,
              binds: ob.binds || '', text: i.why || '',
              levers: o.leversUnder.slice(),
              date: w.clock.formatDate()
            });
          }
        }
        if (advanceTime) o.daysAtIssue++;
      } else if (wasAtIssue) {
        o.atIssueSinceDay = null;
        if (advanceTime) {
          w.bus.emit('civic:obligation', {
            obligationId: o.id, state: 'eased', instrument: o.instrumentLabel,
            article: ob.article || '', force: ob.force,
            binds: ob.binds || '',
            text: 'The indicator is back inside its band. The days it spent outside it are still on the record.',
            daysAtIssue: o.daysAtIssue,
            levers: o.leversUnder.slice(),
            date: w.clock.formatDate()
          });
        }
      }

      if (o.engaged) engaged++;
      if (o.atIssue) atIssue++;
      daysTotal += o.daysAtIssue;
      byForce[ob.force] = (byForce[ob.force] || 0) + 1;
    }

    publishObligations();
    state.obligationSummary = {
      total: O.size,
      engaged,
      atIssue,
      daysAtIssue: daysTotal,
      byForce,
      note: (pack.treaty_layer && pack.treaty_layer.not_a_veto) || ''
    };
  }

  function publishObligations() {
    state.obligations = [...O.values()].map((o) => {
      const ob = o.pack;
      return {
        id: o.id,
        instrument: ob.instrument,
        instrumentLabel: o.instrumentLabel,
        alsoInstruments: o.instrumentLabels.slice(1),
        article: ob.article || '',
        obliges: ob.obliges || '',
        force: ob.force,
        binds: ob.binds || '',
        bindsHere: ob.binds_here || '',
        domesticRoute: ob.domestic_route || '',
        doesNotDo: ob.what_it_does_not_do || '',
        derivesFrom: (ob.derives_from || []).slice(),
        modellingNote: ob.modelling_note || '',
        handling: ob.handling || '',
        source: ob.source,
        confidence: ob.confidence,
        engaged: o.engaged,
        atIssue: o.atIssue,
        connected: o.connected,
        why: o.why,
        atIssueWhy: o.atIssueWhy,
        reading: o.reading,
        daysAtIssue: o.daysAtIssue,
        daysEngaged: o.engagedSinceDay == null ? 0 : Math.max(0, state.day - o.engagedSinceDay),
        levers: o.leversUnder.slice(),
        sim: ob.sim_ref || null
      };
    });
  }

  /* ------------------------------------------------------------------ read models */

  function publishMetrics() {
    for (const m of M.values()) {
      const round = m.counted ? COUNTED[m.id].round : null;
      state.metrics[m.id] = {
        id: m.id,
        label: m.label,
        unit: m.unit,
        direction: m.direction,
        baseline: m.baseline,
        value: round ? Math.round(m.value / round) * round : +m.value.toFixed(4),
        remembered: round ? Math.round(m.remembered / round) * round : +m.remembered.toFixed(4),
        fromBaseline: +(m.value - m.baseline).toFixed(4),
        trend: +(m.dayDelta * 30).toFixed(4),
        state: readOut(m),
        note: m.note,
        source: m.source,
        confidence: m.confidence,
        // What this simulation counted for itself, where it can. Shown beside the published figure,
        // never instead of it, and only once there is enough of a year behind it to mean anything.
        countedInSim: m.simCount != null ? m.simCount : null,
        countedOverDays: m.simCountDays || 0,
        movers: m.movers.slice(0, 4).map((x) => ({
          kind: x.kind, label: x.label, value: +x.value.toFixed(4),
          text: x.text || null, assumed: !!x.restsOnPlayerAssumption
        }))
      };
    }
  }

  /** Plain words for where a metric sits, so a panel does not have to invent them. */
  function readOut(m) {
    if (m.counted) return null;
    const d = m.value - m.baseline;
    if (Math.abs(d) < 0.02) return 'about where it started';
    const dir = m.direction === 'context' ? (d > 0 ? 'higher' : 'lower')
      : worseOrBetter(m, d) === 'better' ? 'better' : 'worse';
    const size = Math.abs(d) > 0.2 ? 'much ' : Math.abs(d) > 0.08 ? '' : 'a little ';
    return `${size}${dir} than it started`;
  }

  function publishLevers() {
    for (const rt of L.values()) {
      state.levers[rt.id] = {
        id: rt.id,
        name: rt.name,
        issue: rt.issue,
        role: rt.role,
        packStatus: rt.packStatus,
        status: rt.status,
        level: rt.level,
        decider: rt.decider,
        deciders: rt.deciders,
        leadMonths: rt.leadMonths,
        progress: +rt.progress.toFixed(3),
        capital: rt.capital,
        recurring: rt.recurring,
        squeezed: rt.squeezed,
        stalled: !!rt.stalled,
        conditions: rt.conditions.map((c) => c.label),
        restsOnPlayerAssumption: rt.restsOnPlayerAssumption,
        obligations: rt.obligations.slice(),
        note: rt.note
      };
    }
    state.active = [...L.values()].filter((r) => r.status === 'active' || r.status === 'running').map((r) => r.id).sort();
    state.delivering = [...L.values()].filter((r) => r.status === 'delivering').map((r) => r.id).sort();
    state.nudges = nudges.slice(-12).map((n) => ({ metric: n.metric, delta: +n.delta.toFixed(3), reason: n.reason }));
  }

  /**
   * A named, decaying push on a metric from council, consultation, budget, or any other system on
   * the island that has something to say about a civic number.
   *
   * Two guards, and they exist because of something that actually happened here. The water system
   * issued thirteen boil water notices in two hundred days and each one nudged water security by
   * the same amount. Summed, they drove the metric through the floor and pinned it there, and a
   * pinned metric is a dead one: it stops responding, so the player can no longer see whether
   * anything they do helps. Neither guard is a fudge. The first says the thirteenth boil water
   * notice does not land like the first, which is true of people. The second says no single channel
   * gets to own a metric outright, which is true of indices.
   */
  function nudge(w, { metric, delta, reason, source, halfLifeDays }) {
    if (!M.has(metric) || !Number.isFinite(delta) || !delta) return;
    const day = dayOf(w);
    let priors = 0;
    for (const n of nudges) {
      if (n.metric === metric && n.reason === reason && day - n.day < 180) priors++;
    }
    if (priors) delta *= Math.max(0.15, Math.pow(0.6, priors));
    if (Math.abs(delta) < 0.002) return;
    nudges.push({ metric, delta, reason, source: source || '', halfLifeDays: halfLifeDays || 365, day });
    if (nudges.length > 300) nudges.shift();
  }

  /** Soft limit. Approaches the cap and never crosses it, and stays linear where it matters. */
  function soften(x, cap) {
    if (!cap || !x) return x || 0;
    return cap * Math.tanh(x / cap);
  }

  /* ------------------------------------------------------------------ registration */

  return world.register({
    id: 'policy',
    phase: 'civic',
    order: 20,

    init(w) {
      build(w);

      // Council decides; this file enacts. Queued rather than handled inline, so the two systems
      // never depend on which order they happen to tick in.
      w.bus.on('civic:enact', (p) => inbox.push({ kind: 'enact', ...p }));
      w.bus.on('civic:cease', (p) => inbox.push({ kind: 'cease', ...p }));
      w.bus.on('civic:metric-nudge', (p) => inbox.push({ kind: 'nudge', ...p }));
      w.bus.on('civic:conditions', (p) => inbox.push({ kind: 'conditions', ...p }));
      w.bus.on('civic:stalled', (p) => inbox.push({ kind: 'stalled', ...p }));

      // State the read model helpers once the maps exist.
      state.explain = (metricId) => {
        const m = M.get(metricId);
        if (!m) return [];
        return m.movers.slice(0, 5).map((x) => ({
          label: x.label,
          value: +x.value.toFixed(4),
          kind: x.kind,
          text: x.text || null,
          assumed: !!x.restsOnPlayerAssumption
        }));
      };
      state.metricCard = (id) => state.metrics[id] || null;
      // The layer above, for one lever. Panels call this on a click, never in a tick.
      state.obligationsFor = (leverId) => {
        const rt = L.get(leverId);
        if (!rt || !rt.obligations.length) return [];
        const set = new Set(rt.obligations);
        return state.obligations.filter((o) => set.has(o.id));
      };
      state.leverCard = (id) => {
        const rt = L.get(id);
        const lv = packLever(id);
        if (!rt || !lv) return null;
        return {
          ...state.levers[id],
          description: lv.description,
          costBasis: rt.costBasis,
          costConfidence: rt.costConfidence,
          source: lv.source,
          supports: lv.who_supports.slice(),
          opposes: lv.who_opposes.slice(),
          promised: (lv.effects || []).map((e) => ({
            metric: e.target,
            metricLabel: (M.get(e.target) || {}).label || e.target,
            stated: e.magnitude,
            delayMonths: e.delay_months,
            confidence: e.confidence,
            band: bandText(e.magnitude, e.confidence)
          })),
          // Side effects are deliberately not listed until they are discovered.
          discovered: state.discoveries.filter((d) => d.leverId === id).map((d) => d.text),
          delivered: rt.progress >= 1,
          history: rt.history.slice(-8)
        };
      };
    },

    tick(w) {
      // Drain the inbox first so a decision made this tick lands today.
      while (inbox.length) {
        const msg = inbox.shift();
        if (msg.kind === 'enact') {
          const rt = L.get(msg.leverId);
          if (!rt) continue;
          if (msg.conditions) rt.conditions = msg.conditions.slice();
          enact(w, msg.leverId, { level: msg.level != null ? msg.level : 1, restsOnPlayerAssumption: msg.restsOnPlayerAssumption });
        } else if (msg.kind === 'cease') {
          cease(w, msg.leverId, msg.reason);
        } else if (msg.kind === 'nudge') {
          nudge(w, msg);
        } else if (msg.kind === 'conditions') {
          const rt = L.get(msg.leverId);
          if (rt) rt.conditions = (msg.conditions || []).slice();
        } else if (msg.kind === 'stalled') {
          const rt = L.get(msg.leverId);
          if (rt && rt.stalled !== !!msg.on) {
            rt.stalled = !!msg.on;
            rt.history.push({ day: dayOf(w), event: msg.on ? 'stalled' : 'restarted', detail: msg.text || '' });
            publishLevers();
          }
        }
      }

      if (!state.ready) return;

      // Cheapest possible per-tick work: the running high-water mark of today's arrivals.
      const vis = w.read('visitors');
      if (vis && vis.ready && vis.arrivalsToday > arrivalsPeak) arrivalsPeak = vis.arrivalsToday;

      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        dailyPass(w);
      }
    },

    describe(w) {
      const counts = { dormant: 0, inPlace: 0, delivering: 0, active: 0, ceasing: 0, lapsed: 0, running: 0 };
      for (const rt of L.values()) {
        const k = rt.status === 'in-place' ? 'inPlace' : rt.status;
        counts[k] = (counts[k] || 0) + 1;
      }
      const moved = [...M.values()]
        .filter((m) => !m.counted)
        .map((m) => ({ id: m.id, d: m.value - m.baseline }))
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, 3)
        .map((x) => `${x.id}${x.d >= 0 ? '+' : ''}${x.d.toFixed(3)}`);
      const trust = M.get('consultation_trust');
      const amenity = M.get('resident_amenity');
      return {
        ready: state.ready,
        levers: counts,
        contributions: contributions.length,
        nudges: nudges.length,
        discoveries: state.discoveries.length,
        squeeze: state.qyacSqueeze.on ? state.qyacSqueeze.count : 0,
        connected: state.couplings.filter((c) => c.connected).length + '/' + state.couplings.length,
        trust: trust ? +trust.value.toFixed(3) : null,
        amenity: amenity ? +amenity.value.toFixed(3) : null,
        moved,
        obligations: {
          total: state.obligationSummary.total,
          engaged: state.obligationSummary.engaged,
          atIssue: state.obligationSummary.atIssue,
          daysAtIssue: state.obligationSummary.daysAtIssue,
          // The one number here that never comes back down. Named so a headless year shows it.
          worst: [...O.values()].filter((o) => o.daysAtIssue > 0)
            .sort((a, b) => b.daysAtIssue - a.daysAtIssue)
            .slice(0, 2).map((o) => `${o.id}:${o.daysAtIssue}`)
        }
      };
    },

    save(w) {
      return {
        v: 1,
        day: state.day,
        lastDay,
        arrivals: Array.from(arrivals), arrivalsFilled, arrivalsPeak,
        // A message emitted by a system that ticks after this one is still sitting in the inbox when
        // the save is taken. Drop it and the loaded game quietly loses a decision.
        inbox: inbox.slice(),
        // No rounding anywhere in here. A save that rounds a metric to five decimal places is a
        // save that quietly plays a slightly different game from the one it was taken from, and the
        // difference shows up months later as a decision that went the other way.
        // Conditions go in whole, not as their labels: a condition carries the time and magnitude
        // scales that set how long the works take, and a lever reloaded without them delivers on a
        // different schedule from the one it was saved on.
        levers: [...L.values()].map((r) => [r.id, r.status, r.level, r.startedDay, r.progress, r.squeezed ? 1 : 0, r.restsOnPlayerAssumption ? 1 : 0, r.conditions, r.stalled ? 1 : 0, r.deliveryDays, r.squeezeDays]),
        metrics: [...M.values()].map((m) => [m.id, m.value, m.remembered]),
        contributions: contributions.map((c) => [c.cid, c.leverId, c.kind, c.target, c.stated, c.realised, c.startDay, c.delayDays, c.rampDays, c.confidence, c.description, c.discovered ? 1 : 0, c.unwinding ? 1 : 0, c.unwindFrom, c.unwindDay, c.unwindHalfLife || 0, c.stallDays || 0, c.restsOnPlayerAssumption ? 1 : 0]),
        nudges: nudges.map((n) => [n.metric, n.delta, n.reason, n.source, n.halfLifeDays, n.day]),
        discoveries: state.discoveries.slice(0, 20),
        // daysAtIssue is the one counter on this board that does not decay and does not reset, so
        // it is the one a save has to carry or the whole property is a lie.
        obligations: [...O.values()].map((o) => [o.id, o.daysAtIssue, o.engagedSinceDay, o.atIssueSinceDay]),
        seq
      };
    },

    load(w, s) {
      if (!s || !state.ready) return;
      seq = s.seq || 0;
      for (const [id, status, level, startedDay, progress, squeezed, assumed, conds, stalled, deliveryDays, squeezeDays] of s.levers || []) {
        const rt = L.get(id);
        if (!rt) continue;
        Object.assign(rt, {
          status, level, startedDay, progress,
          squeezed: !!squeezed, restsOnPlayerAssumption: !!assumed, stalled: !!stalled,
          deliveryDays: deliveryDays || rt.deliveryDays,
          squeezeDays: squeezeDays || 0
        });
        rt.conditions = (conds || []).slice();
      }
      for (const [id, value, remembered] of s.metrics || []) {
        const m = M.get(id);
        if (m) { m.value = value; m.remembered = remembered; }
      }
      contributions.length = 0;
      for (const c of s.contributions || []) {
        contributions.push({
          cid: c[0], leverId: c[1], leverName: (L.get(c[1]) || {}).name || c[1], kind: c[2], target: c[3],
          stated: c[4], realised: c[5], startDay: c[6], delayDays: c[7], rampDays: c[8], confidence: c[9],
          description: c[10], discovered: !!c[11], unwinding: !!c[12], unwindFrom: c[13], unwindDay: c[14],
          unwindHalfLife: c[15], stallDays: c[16] || 0, restsOnPlayerAssumption: !!c[17], alive: true
        });
      }
      nudges.length = 0;
      for (const n of s.nudges || []) nudges.push({ metric: n[0], delta: n[1], reason: n[2], source: n[3], halfLifeDays: n[4], day: n[5] });
      state.discoveries = (s.discoveries || []).slice();
      for (const [id, days, engagedSince, atIssueSince] of s.obligations || []) {
        const o = O.get(id);
        if (!o) continue;
        o.daysAtIssue = days || 0;
        o.engagedSinceDay = engagedSince != null ? engagedSince : null;
        o.atIssueSinceDay = atIssueSince != null ? atIssueSince : null;
        o.atIssue = atIssueSince != null;
      }
      inbox.length = 0;
      for (const m of s.inbox || []) inbox.push(m);
      if (s.arrivals) arrivals.set(s.arrivals);
      arrivalsFilled = s.arrivalsFilled || 0;
      arrivalsPeak = s.arrivalsPeak || 0;
      // Restore the day marker rather than forcing a recompute: a loaded game must not get a free
      // extra day of delivery. Then rebuild the read model without advancing anything.
      lastDay = s.lastDay != null ? s.lastDay : -1;
      dailyPass(w, false);
    }
  });

  function bandText(magnitude, confidence) {
    const band = CONFIDENCE_BAND[confidence] ?? CONFIDENCE_BAND.low;
    const lo = magnitude * (1 - band * 1.6), hi = magnitude * (1 + band * 1.6);
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    return `modelled at ${magnitude > 0 ? '+' : ''}${magnitude.toFixed(2)}, ${confidence} confidence, so anywhere from ${a.toFixed(2)} to ${b.toFixed(2)}`;
  }
}
