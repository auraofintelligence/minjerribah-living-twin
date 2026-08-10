// How the island is feeling, and why.
//
// There is no approval slider here. Nineteen groups from data/civic.json, each with a base mood the
// pack sets, and every movement away from it traceable to a specific thing that happened on a
// specific day. Click a group and you get three sentences, not a number.
//
// WHERE THE CARING COMES FROM. A group's priorities are not written by hand in this file. They are
// derived from the pack itself: for every lever, the pack lists who_supports and who_opposes, and
// the effects that lever has on named metrics. So if long-term residents support four levers that
// push peak day load down, the model concludes they want peak day load down, and it can name the
// four levers when asked. If they oppose a lever that pushes it up, that counts too. The derivation
// is auditable, it moves when the data pack is corrected, and it never puts an opinion in anyone's
// mouth that the researched pack did not already record.
//
// WHAT PEOPLE ARE USED TO. Moods react to change, not to level. Somewhere in the policy read model
// each metric carries a slow-moving `remembered` value, roughly eighteen months of memory. A group
// is unhappy when a metric it cares about is worse than what it got used to, and it eventually
// stops being unhappy about a thing that never changes back. That is why a grievance fades and a
// win fades faster, which is the pack's own rule: mood decays toward base at 0.05 a month, and the
// pack says to use half that rate for negative movements. Bad news lasts about twice as long.
//
// CULTURAL RULE, and it is a hard one.
// `quandamooka-families` is in this model because the pack put it there, with an ABS source, and
// the pack's own note travels with it everywhere it is shown: "A civic constituency label for the
// simulation. It is not a cultural authority and does not speak for QYAC." Every movement in this
// group's mood must trace to a lever the researched pack already listed them under. This file never
// infers a Quandamooka position from anything else, and QYAC, Minjerribah Camping and the joint
// management arrangement have no mood in this system at all: they are not constituencies, they are
// decision makers whose decisions this twin does not simulate. See data/lore.json prohibitions
// qyac-as-civic-actor-only and no-quandamooka-position-without-citation.

const DAYS_PER_MONTH = 30.4375;

/** The pack's rule. A win fades at this rate a month; a grievance fades at half of it. */
const DECAY_PER_MONTH_POSITIVE = 0.05;
const DECAY_PER_MONTH_NEGATIVE = 0.025;

/** How hard a metric moving translates into feeling. Modelled. */
const METRIC_GAIN = 1.9;

/** Bodies that make decisions rather than hold opinions. They get no mood, on purpose. */
const NOT_A_CONSTITUENCY = new Set(['qyac', 'minjerribah-camping', 'joint-management', 'qpws']);

/**
 * Channels from the rest of the island: the things that happen to people, arriving as bus events
 * and moving a group's mood.
 *
 * These were written before the ecology, movement and infrastructure systems existed, against
 * guessed event names. Nine of the eleven guesses were wrong, and because a channel that never
 * matches also never complains, the mistake was invisible: over a full sim-year exactly two of the
 * eleven ever fired. A koala hit on East Coast Road did not move the conservation groups, smoke
 * over the townships did not move the retirees, and a household losing its lease to a holiday
 * letting did not move the renters. Every prefix below is now an event a system in this repository
 * actually emits, with the emitter named beside it so the next person can check.
 *
 * `when` is optional and narrows a channel to part of one event type, which is how one
 * `wildlife:call` can mean a road strike to one group and a dog attack to another.
 */
const LIVED_CHANNELS = [
  // movement/ferry.js
  { prefix: 'ferry:cancelled', groups: ['ferry-commuters', 'young-families-and-school', 'renters-and-key-workers'], delta: -0.012, cause: 'a crossing cancelled' },
  { prefix: 'ferry:stranded', groups: ['ferry-commuters', 'renters-and-key-workers'], delta: -0.014, cause: 'a boat called off with people waiting' },
  { prefix: 'ferry:queue-spill', groups: ['long-term-residents', 'tradies-and-builders'], delta: -0.008, cause: 'the queue at the ramp' },
  // ecology/koala.js and marine.js: one event type, told apart by what the call was for
  { prefix: 'wildlife:call', when: (p) => /hit on the road/.test(String((p && p.situation) || '')),
    groups: ['environmental-stewards', 'volunteers-and-emergency', 'conservation-groups'], delta: -0.02, cause: 'wildlife hit on the road' },
  { prefix: 'wildlife:call', when: (p) => /dog/.test(String((p && p.situation) || '')),
    groups: ['environmental-stewards', 'conservation-groups'], delta: -0.03, cause: 'a dog attack on wildlife' },
  { prefix: 'wildlife:call', groups: ['volunteers-and-emergency'], delta: -0.006, cause: 'a call out to an animal' },
  // ecology/vegetation.js
  { prefix: 'ecology:smoke', groups: ['retirees-and-seniors', 'tourism-operators'], delta: -0.01, cause: 'smoke over the townships' },
  { prefix: 'ecology:burn', when: (p) => (p && p.cause) !== 'planned',
    groups: ['volunteers-and-emergency', 'long-term-residents'], delta: -0.03, cause: 'a fire on the island' },
  // ecology/dunes.js
  { prefix: 'coast:flow-slide', groups: ['foreshore-landowners', 'long-term-residents'], delta: -0.04, cause: 'the foreshore gave way' },
  { prefix: 'coast:storm-cut', groups: ['foreshore-landowners', 'long-term-residents'], delta: -0.02, cause: 'a storm on the foreshore' },
  // infrastructure/waste.js
  { prefix: 'waste:kerbside-missed', groups: ['long-term-residents', 'holiday-home-owners'], delta: -0.01, cause: 'a bin not collected' },
  { prefix: 'waste:centre-closed', groups: ['long-term-residents', 'tradies-and-builders'], delta: -0.008, cause: 'the transfer station shut' },
  // infrastructure/power.js and water.js
  { prefix: 'power:shedding', groups: ['long-term-residents', 'retirees-and-seniors', 'tourism-operators'], delta: -0.03, cause: 'the power went off' },
  { prefix: 'water:restrictions', when: (p) => !!(p && p.level > 0),
    groups: ['long-term-residents', 'holiday-home-owners'], delta: -0.012, cause: 'water restrictions' },
  { prefix: 'water:boil-notice', groups: ['long-term-residents', 'young-families-and-school'], delta: -0.05, cause: 'a boil water notice' },
  // agents/population.js
  { prefix: 'housing:lost-to-holiday-let', groups: ['renters-and-key-workers'], delta: -0.05, cause: 'a house went to the holiday rate' },
  // economy/jobs.js
  { prefix: 'jobs:left-for-want-of-a-room', groups: ['renters-and-key-workers', 'tradies-and-builders'], delta: -0.03, cause: 'somebody left for want of a room' },
  // agents/events.js: what is on. Both directions, because an event is not a nuisance and it is
  // not a gift either. The operators earn from it and the people who live beside the car park pay
  // for it, and on this island those are often the same street.
  { prefix: 'events:peak', when: (p) => (p && p.people || 0) >= 500,
    groups: ['tourism-operators'], delta: 0.012, cause: 'a big day on the calendar' },
  { prefix: 'events:peak', when: (p) => (p && p.people || 0) >= 500,
    groups: ['long-term-residents', 'retirees-and-seniors'], delta: -0.008, cause: 'the island full for an event' },
  { prefix: 'events:capacity-bit', groups: ['tourism-operators', 'ferry-commuters'], delta: -0.02, cause: 'people who could not get over for it' },
  { prefix: 'events:called-off', groups: ['tourism-operators', 'volunteers-and-emergency'], delta: -0.015, cause: 'an event called off' },
  // agents/visitors.js, movement/crowd.js, economy/tourism.js
  { prefix: 'visitors:peak', groups: ['long-term-residents', 'retirees-and-seniors'], delta: -0.006, cause: 'a long weekend' },
  { prefix: 'crowd:crush', groups: ['long-term-residents', 'retirees-and-seniors'], delta: -0.004, cause: 'the gorge walk was shoulder to shoulder' },
  { prefix: 'tourism:parking-full', groups: ['long-term-residents', 'tourism-operators'], delta: -0.004, cause: 'nowhere to park at Point Lookout' },
  // ecology/whales.js and marine.js: the two that move a mood the other way
  { prefix: 'whales:season', groups: ['tourism-operators', 'long-term-residents'], delta: 0.02, cause: 'the whales came back' },
  { prefix: 'ecology:hatch', groups: ['environmental-stewards', 'conservation-groups'], delta: 0.02, cause: 'turtles made the water' }
];

export function registerSentiment(world) {
  // No randomness here on purpose. Every movement in this file traces to something that happened.

  const state = world.publish('sentiment', {
    ready: false,
    moods: {},          // id -> mood, the cheap read for other systems
    groups: {},         // id -> full card
    care: {},           // id -> {metric: {weight, direction, fromLevers:[]}}
    ledger: [],         // most recent movements across all groups
    island: { mood: 0, label: '', spread: 0, angriest: null, happiest: null },
    channels: [],
    notes: [],
    explain: () => [],
    groupCard: () => null,
    whyDoTheyCare: () => null
  });

  const G = new Map();
  const events = [];   // {day, date, group, delta, cause, detail, ref, sign}
  const inbox = [];
  let pack = null;
  let lastDay = -1;
  const channelFired = new Map();
  // Two channels can share an event type and be told apart by `when`, so the tally is keyed by
  // both. Save and load carry these keys, so changing a channel's cause text resets its counter.
  const channelKey = (c) => c.prefix + (c.when ? '/' + c.cause : '');

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayOf = (w) => w.clock.dayIndex;

  /* ------------------------------------------------------------------ boot */

  function build(w) {
    pack = (w.data && w.data.civic) || null;
    if (!pack || !Array.isArray(pack.interest_groups)) {
      state.notes.push('data/civic.json is missing its interest groups. Nothing to feel.');
      return;
    }

    for (const g of pack.interest_groups) {
      if (NOT_A_CONSTITUENCY.has(g.id)) continue;
      G.set(g.id, {
        id: g.id,
        label: g.label,
        size: g.size,
        base: g.base_mood,
        about: g.about,
        wants: (g.what_they_want || []).slice(),
        angers: (g.what_angers_them || []).slice(),
        source: g.source,
        confidence: g.confidence,
        note: g.note || '',
        isActor: g.size === 0,
        care: new Map(),      // metric -> {weight, dir, levers:[]}
        issues: new Set(),    // which of the pack's twenty-three arguments they are in
        intensity: 0,
        weight: 0,
        mood: g.base_mood,
        metricMood: 0,
        eventMood: 0,
        history: []
      });
    }

    deriveCare();
    state.notes.push(`${G.size} groups. Priorities derived from ${(pack.levers || []).length} levers: a group cares about a metric because the pack lists them for or against levers that move it.`);
    state.notes.push('QYAC, Minjerribah Camping and joint management are decision makers in this model, not constituencies. They hold no mood here.');
    publish(w);
    state.ready = true;
  }

  /**
   * The derivation. Support a lever and you want its effects. Oppose it and you want them reversed,
   * a little less strongly, because opposing something is a weaker statement about a number than
   * campaigning for it.
   */
  function deriveCare() {
    for (const lv of pack.levers || []) {
      const record = (gid, sign, weightScale) => {
        const g = G.get(gid);
        if (!g) return;
        for (const e of lv.effects || []) {
          const magnitude = Math.abs(e.magnitude) * weightScale;
          if (magnitude < 0.01) continue;
          let c = g.care.get(e.target);
          if (!c) g.care.set(e.target, (c = { weight: 0, signed: 0, levers: [] }));
          c.weight += magnitude;
          c.signed += Math.sign(e.magnitude) * sign * magnitude;
          if (!c.levers.some((x) => x.id === lv.id)) {
            c.levers.push({ id: lv.id, name: lv.name, stance: sign > 0 ? 'backed' : 'opposed', wants: Math.sign(e.magnitude) * sign > 0 ? 'up' : 'down' });
          }
        }
      };
      for (const gid of lv.who_supports || []) record(gid, 1, 1);
      for (const gid of lv.who_opposes || []) record(gid, -1, 0.8);
      // How many separate arguments is this group in? A group that turns up to one issue is a
      // different political animal to one that turns up to fifteen.
      for (const gid of [...(lv.who_supports || []), ...(lv.who_opposes || [])]) {
        const g = G.get(gid);
        if (g && lv.issue) g.issues.add(lv.issue);
      }
    }

    for (const g of G.values()) {
      let total = 0;
      for (const c of g.care.values()) total += Math.abs(c.signed);
      if (total <= 0) { g.intensity = 0.5; continue; }
      let herfindahl = 0;
      for (const c of g.care.values()) {
        c.norm = Math.abs(c.signed) / total;
        c.dir = Math.sign(c.signed);
        herfindahl += c.norm * c.norm;
      }
      // A group whose caring is spread across twenty numbers and fifteen arguments is diffuse. A
      // group with one argument is the one that turns up to every meeting about it and knows the
      // officer's first name. The Amity Point foreshore landowners are two per cent of the island
      // and this is exactly how a group that small ends up mattering. The pack says so in its own
      // note on them: small in number, very high in intensity.
      const issueFocus = 1.1 / Math.sqrt(Math.max(1, g.issues.size));
      g.intensity = clamp(Math.sqrt(herfindahl) * 1.4 + issueFocus, 0.35, 2.4);
      g.weight = g.isActor ? 0 : g.size * g.intensity;
    }
    // Normalise weights so the resident constituencies sum to about one.
    let sum = 0;
    for (const g of G.values()) sum += g.weight;
    if (sum > 0) for (const g of G.values()) g.weight = g.weight / sum;
  }

  /* ------------------------------------------------------------------ events */

  function record(w, groupId, delta, cause, detail, ref) {
    const g = G.get(groupId);
    if (!g || !delta) return;
    // The second time the same argument comes round it lands softer, and the third softer again.
    // Without this, a body that keeps re-proposing the same thing drives a group to furious on
    // repetition alone, which is not how people work. They get tired of it, not angrier.
    if (ref) {
      const day = dayOf(w);
      let priors = 0;
      for (const p of g.history) if (p.ref === ref && day - p.day < 365) priors++;
      if (priors) delta *= Math.pow(0.55, priors);
      if (Math.abs(delta) < 0.004) return;
    }
    const e = {
      day: dayOf(w),
      date: w.clock.formatDate(),
      group: groupId,
      delta,
      cause,
      detail: detail || '',
      ref: ref || null
    };
    events.push(e);
    g.history.unshift(e);
    if (g.history.length > 24) g.history.pop();
    if (events.length > 900) events.splice(0, 200);
  }

  function decayed(e, day) {
    const months = (day - e.day) / DAYS_PER_MONTH;
    const rate = e.delta >= 0 ? DECAY_PER_MONTH_POSITIVE : DECAY_PER_MONTH_NEGATIVE;
    return e.delta * Math.exp(-rate * months);
  }

  /** How much a lever matters to a group, from that group's own derived care vector. */
  function salience(gid, leverId) {
    const g = G.get(gid);
    if (!g) return 0;
    let s = 0;
    for (const c of g.care.values()) {
      if (c.levers.some((x) => x.id === leverId)) s += c.norm || 0;
    }
    return clamp(s, 0.05, 1);
  }

  function leverOf(id) {
    return (pack.levers || []).find((l) => l.id === id) || null;
  }

  function handleDecision(w, p) {
    const lv = leverOf(p.leverId);
    if (!lv) return;
    const approved = p.outcome === 'approved' || p.outcome === 'approved-with-conditions';
    const refused = p.outcome === 'refused';
    const deferred = p.outcome === 'deferred';
    const scale = deferred ? 0.35 : 1;
    const verb = approved ? 'approved' : refused ? 'refused' : 'deferred';
    for (const gid of lv.who_supports || []) {
      const s = salience(gid, lv.id);
      const d = (approved ? 0.15 : refused ? -0.16 : -0.05) * (0.5 + s) * scale;
      record(w, gid, d, `${lv.name} was ${verb}`, sentence(lv, gid, verb, true, p), lv.id);
    }
    for (const gid of lv.who_opposes || []) {
      const s = salience(gid, lv.id);
      const d = (approved ? -0.17 : refused ? 0.13 : 0.04) * (0.5 + s) * scale;
      record(w, gid, d, `${lv.name} was ${verb}`, sentence(lv, gid, verb, false, p), lv.id);
    }
    // Deciding without asking is its own grievance, and it is not the same as deciding badly.
    if (approved && !p.consulted && lv.player_role === 'player_decides') {
      for (const gid of ['long-term-residents', 'quandamooka-families', 'environmental-stewards']) {
        if (!G.has(gid)) continue;
        record(w, gid, -0.05, 'A decision was made without asking first',
          `${lv.name} was approved with no consultation on the island.`, lv.id);
      }
    }
  }

  function sentence(lv, gid, verb, supporter, p) {
    const g = G.get(gid);
    const who = g ? g.label : gid;
    const cond = p && p.conditions && p.conditions.length ? ` with conditions: ${p.conditions.join(', ').toLowerCase()}` : '';
    if (verb === 'approved') {
      return supporter
        ? `${who} backed this and it got up${cond}.`
        : `${who} argued against this and it got up anyway${cond}.`;
    }
    if (verb === 'refused') {
      return supporter
        ? `${who} backed this and it was refused. ${p && p.reason ? p.reason : ''}`.trim()
        : `${who} argued against this and it was refused.`;
    }
    return supporter
      ? `${who} backed this and it went back on the table for another cycle.`
      : `${who} argued against this and the decision was put off.`;
  }

  function handleDiscovery(w, p) {
    // A side effect landing is felt by whoever cares about the metric it landed on, in the
    // direction they did not want.
    for (const g of G.values()) {
      const c = g.care.get(p.metric);
      if (!c || !c.norm) continue;
      const wanted = c.dir;
      const got = Math.sign(p.magnitude);
      if (!wanted || !got) continue;
      const bad = wanted !== got;
      const d = (bad ? -0.09 : 0.05) * (0.4 + c.norm * 1.6);
      record(w, g.id, d, bad ? 'Something they did not sign up for' : 'An unexpected benefit',
        p.text || `${p.leverName} moved ${p.metricLabel}.`, p.leverId);
    }
  }

  function handleCapacity(w, p) {
    if (!p.on) return;
    // The pack lists this exact grievance for this constituency, sourced to the audit office:
    // "Being asked to deliver complex construction with no capacity funding."
    record(w, 'quandamooka-families', -0.07, 'Too much at once, with no capacity behind it',
      p.note || 'More than two complex projects are in delivery with the same body at the same time.',
      'qao-minjerribah-futures');
    record(w, 'state-as-actor', -0.05, 'A program stalling on capacity', p.note || '', 'qao-minjerribah-futures');
  }

  function handleConsultation(w, p) {
    if (!p || !p.byGroup) return;
    for (const [gid, row] of Object.entries(p.byGroup)) {
      if (!G.has(gid)) continue;
      if (row.attended > 0 || row.submissions > 0) {
        record(w, gid, 0.03, 'They turned up and were heard',
          `${row.attended} came to the ${p.methodLabel} at ${p.venueLabel}${row.submissions ? ` and ${row.submissions} wrote in` : ''}.`, p.leverId);
      } else if (row.affectedShare > 0.1) {
        record(w, gid, -0.035, 'Consulted at a time they could not come',
          `${p.methodLabel} at ${p.venueLabel}, ${p.whenLabel}. They carry ${Math.round(row.affectedShare * 100)} per cent of the impact and nobody from the group was in the room.`, p.leverId);
      }
    }
    if (p.turnedAway > 0) {
      record(w, 'long-term-residents', -0.03, 'The hall was full',
        `${p.turnedAway} people could not get into the ${p.methodLabel} at ${p.venueLabel}.`, p.leverId);
    }
  }

  function handleLived(w, type, payload) {
    for (const ch of LIVED_CHANNELS) {
      if (type !== ch.prefix && !type.startsWith(ch.prefix + ':')) continue;
      if (ch.when && !ch.when(payload)) continue;
      const key = channelKey(ch);
      channelFired.set(key, (channelFired.get(key) || 0) + 1);
      for (const gid of ch.groups) {
        record(w, gid, ch.delta, ch.cause, payload && payload.text ? String(payload.text).slice(0, 160) : '', type);
      }
      return;
    }
  }

  /* ------------------------------------------------------------------ the daily pass */

  /** @param advanceTime false when rebuilding after a load: prune nothing, move nothing. */
  function dailyPass(w, advanceTime = true) {
    const day = dayOf(w);
    const pol = w.read('policy');
    const metrics = pol && pol.metrics ? pol.metrics : null;

    for (const g of G.values()) {
      // 1. Where the numbers they care about sit against what they got used to.
      let mm = 0;
      g.metricDrivers = [];
      if (metrics) {
        for (const [mid, c] of g.care) {
          const m = metrics[mid];
          if (!m || !c.norm) continue;
          const scale = m.unit === 'index' || m.unit === 'share 0-1' ? 1 : Math.max(1, Math.abs(m.baseline));
          const change = (m.value - m.remembered) / scale;
          const felt = change * c.dir * c.norm * METRIC_GAIN;
          if (Math.abs(felt) > 0.0008) {
            mm += felt;
            g.metricDrivers.push({ metric: mid, label: m.label, felt, change, want: c.dir > 0 ? 'up' : 'down', levers: c.levers.slice(0, 3) });
          }
        }
      }
      g.metricMood = clamp(mm, -0.65, 0.65);

      // 2. What happened to them, decayed by the pack's rule.
      let em = 0;
      for (const e of g.history) em += decayed(e, day);
      g.eventMood = clamp(em, -0.8, 0.8);

      g.mood = clamp(g.base + g.metricMood + g.eventMood, -1, 1);
      g.metricDrivers.sort((a, b) => Math.abs(b.felt) - Math.abs(a.felt));
    }

    // Prune events that have decayed to nothing.
    if (advanceTime) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (Math.abs(decayed(events[i], day)) < 0.002) events.splice(i, 1);
      }
    }

    publish(w);
  }

  /* ------------------------------------------------------------------ read model */

  function publish(w) {
    const day = dayOf(w);
    state.moods = {};
    state.groups = {};
    state.care = {};
    let weighted = 0, totalW = 0, lo = 9, hi = -9, loId = null, hiId = null;

    for (const g of G.values()) {
      state.moods[g.id] = +g.mood.toFixed(4);
      const top = explainFor(g, day);
      state.groups[g.id] = {
        id: g.id,
        label: g.label,
        size: g.size,
        weight: +g.weight.toFixed(4),
        intensity: +g.intensity.toFixed(2),
        issuesTheyAreIn: g.issues.size,
        base: g.base,
        mood: +g.mood.toFixed(3),
        moodLabel: moodLabel(g.mood),
        fromBase: +(g.mood - g.base).toFixed(3),
        why: top,
        about: g.about,
        wants: g.wants,
        angers: g.angers,
        source: g.source,
        confidence: g.confidence,
        note: g.note,
        isActor: g.isActor,
        cares: [...g.care.entries()]
          .sort((a, b) => (b[1].norm || 0) - (a[1].norm || 0))
          .slice(0, 5)
          .map(([mid, c]) => ({ metric: mid, weight: +(c.norm || 0).toFixed(3), wants: c.dir > 0 ? 'up' : 'down', because: c.levers.slice(0, 3) }))
      };
      state.care[g.id] = state.groups[g.id].cares;
      if (!g.isActor) {
        weighted += g.mood * g.weight;
        totalW += g.weight;
        if (g.mood < lo) { lo = g.mood; loId = g.id; }
        if (g.mood > hi) { hi = g.mood; hiId = g.id; }
      }
    }

    state.island = {
      mood: totalW > 0 ? +(weighted / totalW).toFixed(3) : 0,
      label: moodLabel(totalW > 0 ? weighted / totalW : 0),
      spread: +(hi - lo).toFixed(3),
      angriest: loId ? { id: loId, label: (G.get(loId) || {}).label, mood: +lo.toFixed(3) } : null,
      happiest: hiId ? { id: hiId, label: (G.get(hiId) || {}).label, mood: +hi.toFixed(3) } : null
    };

    state.ledger = events
      .slice(-40)
      .reverse()
      .slice(0, 20)
      .map((e) => ({
        date: e.date, group: e.group, groupLabel: (G.get(e.group) || {}).label || e.group,
        delta: +decayed(e, day).toFixed(3), cause: e.cause, detail: e.detail
      }));

    state.channels = LIVED_CHANNELS.map((c) => ({ prefix: c.prefix, cause: c.cause, fired: channelFired.get(channelKey(c)) || 0 }));
  }

  /** The three specific things that moved this group, in plain sentences. */
  function explainFor(g, day) {
    const items = [];
    for (const e of g.history) {
      const v = decayed(e, day);
      if (Math.abs(v) < 0.004) continue;
      items.push({ kind: 'event', value: v, text: `${e.cause}. ${e.detail}`.trim(), date: e.date, ref: e.ref });
    }
    for (const d of (g.metricDrivers || []).slice(0, 4)) {
      items.push({
        kind: 'metric',
        value: d.felt,
        text: `${d.label} is ${d.change > 0 ? 'up' : 'down'} on what they had got used to, and they want it ${d.want}.`,
        because: d.levers.length ? `The pack has them ${d.levers[0].stance} ${d.levers[0].name}.` : null
      });
    }
    items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return items.slice(0, 3).map((x) => ({
      text: x.text,
      value: +x.value.toFixed(3),
      kind: x.kind,
      date: x.date || null,
      because: x.because || null
    }));
  }

  function moodLabel(m) {
    if (m <= -0.6) return 'furious';
    if (m <= -0.3) return 'angry';
    if (m <= -0.12) return 'unhappy';
    if (m < 0.12) return 'unmoved';
    if (m < 0.3) return 'pleased';
    if (m < 0.6) return 'happy';
    return 'delighted';
  }

  /* ------------------------------------------------------------------ registration */

  return world.register({
    id: 'sentiment',
    phase: 'civic',
    order: 50,

    init(w) {
      build(w);

      w.bus.on('civic:decision', (p) => inbox.push(['decision', p]));
      w.bus.on('civic:discovery', (p) => inbox.push(['discovery', p]));
      w.bus.on('civic:capacity', (p) => inbox.push(['capacity', p]));
      w.bus.on('civic:consultation-closed', (p) => inbox.push(['consultation', p]));
      w.bus.on('civic:lapsed', (p) => inbox.push(['lapsed', p]));
      w.bus.on('civic:delivered', (p) => inbox.push(['delivered', p]));
      w.bus.on('civic:info-request', (p) => inbox.push(['info', p]));
      w.bus.on('civic:media', (p) => inbox.push(['media', p]));

      // Catch the events the channels above name. The filter here has to agree with handleLived's,
      // or an event reaches the inbox and is then dropped without a word.
      w.bus.onAny((payload, type) => {
        if (!type || type.startsWith('world:') || type.startsWith('civic:') || type.startsWith('ui:')) return;
        for (const ch of LIVED_CHANNELS) {
          if (type === ch.prefix || type.startsWith(ch.prefix + ':')) {
            inbox.push(['lived', { type, payload }]);
            return;
          }
        }
      });

      state.explain = (groupId) => {
        const g = G.get(groupId);
        return g ? explainFor(g, dayOf(w)) : [];
      };
      state.groupCard = (groupId) => state.groups[groupId] || null;
      state.whyDoTheyCare = (groupId, metricId) => {
        const g = G.get(groupId);
        const c = g && g.care.get(metricId);
        if (!c) return null;
        return {
          group: g.label,
          metric: metricId,
          wants: c.dir > 0 ? 'higher' : 'lower',
          weight: +(c.norm || 0).toFixed(3),
          because: c.levers.map((l) => `${l.stance} ${l.name}`),
          derivedFrom: 'data/civic.json levers[].who_supports and who_opposes'
        };
      };
    },

    tick(w) {
      if (!state.ready) return;
      while (inbox.length) {
        const [kind, p] = inbox.shift();
        if (kind === 'decision') handleDecision(w, p);
        else if (kind === 'discovery') handleDiscovery(w, p);
        else if (kind === 'capacity') handleCapacity(w, p);
        else if (kind === 'consultation') handleConsultation(w, p);
        else if (kind === 'lived') handleLived(w, p.type, p.payload);
        else if (kind === 'lapsed') {
          const lv = leverOf(p.leverId);
          if (lv) for (const gid of lv.who_supports || []) {
            record(w, gid, -0.11 * (0.5 + salience(gid, lv.id)), 'A service they relied on stopped',
              `${lv.name} was stopped. ${p.reason || ''}`.trim(), lv.id);
          }
        } else if (kind === 'delivered') {
          const lv = leverOf(p.leverId);
          if (lv) for (const gid of lv.who_supports || []) {
            record(w, gid, 0.07 * (0.5 + salience(gid, lv.id)), 'Something actually got finished',
              `${lv.name} is done.`, lv.id);
          }
        } else if (kind === 'info') {
          record(w, 'long-term-residents', -0.012, 'Another round of paperwork', p.text || '', p.leverId);
        } else if (kind === 'media') {
          record(w, 'council-as-actor', -0.05, 'It made the paper', `${p.leverName} was in the news.`, p.leverId);
          record(w, 'long-term-residents', 0.02, 'Somebody said it out loud', `${p.leverName} was in the news.`, p.leverId);
        }
      }

      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        dailyPass(w);
      }
    },

    describe(w) {
      const rows = [...G.values()].filter((g) => !g.isActor).sort((a, b) => a.mood - b.mood);
      return {
        island: state.island.mood,
        label: state.island.label,
        spread: state.island.spread,
        angriest: rows.length ? `${rows[0].id}:${rows[0].mood.toFixed(2)}` : null,
        happiest: rows.length ? `${rows[rows.length - 1].id}:${rows[rows.length - 1].mood.toFixed(2)}` : null,
        liveEvents: events.length,
        channelsFired: [...channelFired.keys()].length,
        moods: Object.fromEntries(rows.slice(0, 6).map((g) => [g.id, +g.mood.toFixed(2)]))
      };
    },

    save() {
      return {
        v: 1,
        lastDay,
        inbox: inbox.slice(),
        events: events.map((e) => [e.day, e.date, e.group, e.delta, e.cause, e.detail, e.ref]),
        channels: [...channelFired.entries()]
      };
    },

    load(w, s) {
      if (!s || !state.ready) return;
      events.length = 0;
      for (const g of G.values()) g.history.length = 0;
      for (const [day, date, group, delta, cause, detail, ref] of s.events || []) {
        const e = { day, date, group, delta, cause, detail, ref };
        events.push(e);
        const g = G.get(group);
        if (g) g.history.unshift(e);
      }
      channelFired.clear();
      for (const [k, v] of s.channels || []) channelFired.set(k, v);
      inbox.length = 0;
      for (const m of s.inbox || []) inbox.push(m);
      lastDay = s.lastDay != null ? s.lastDay : -1;
      dailyPass(w, false);
    }
  });
}
