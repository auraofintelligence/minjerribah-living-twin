// Who knows who, and how well.
//
// THE THING THIS GETS RIGHT
//   Minjerribah is not a village where everybody knows everybody. It is about two thousand people
//   in three separated townships strung along thirty kilometres of one road, with a fourth cluster
//   at One Mile and scattered bush blocks between. A retired fisher at Amity Point and a seasonal
//   cook in a share house at Point Lookout can live here for years and never meet. Modelling this
//   as one dense social graph would be wrong, and it would also be the single most expensive thing
//   in the whole simulation.
//
//   So it is bubbles. Everybody belongs to a handful of them: the house, the street, the workplace,
//   the school gate, the club, the brigade or the patrol roster, the boat crowd, the township, and
//   an extended family that lives in more than one house. Two people who share a bubble know each
//   other. Two people who share none, do not, however small the island is.
//
// TWO LAYERS, ON PURPOSE
//   Ambient familiarity is computed, never stored. It is the answer to "would these two nod at each
//   other at the shop", and it comes straight out of the bubbles they share. That is what makes the
//   published relationship model's line about two long-term residents in the same township starting
//   above 0.6 true without storing two million pairs.
//
//   A tie is stored, and it only exists when something has actually happened between two people.
//   It carries the four dimensions data/narrative.json publishes: familiarity, trust, obligation
//   (positive means the first owes the second) and friction, plus a kind, a first-met tick and a
//   short history of the moments that made it. Ties are capped, they decay from absence at the
//   published monthly rates, and they are what the drama director reads.
//
// WHAT MOVES A TIE
//   Being in the same place at the same time. Doing the same thing in the same place counts double,
//   because turning up at the same working bee is not the same as passing in the shop. Absence
//   decays it. Friction rises when two people who do not get on are both worn down, which on this
//   island means January. Nothing here writes dialogue, and nothing here is cultural: see
//   data/lore.json prohibitions.

/** The whole vocabulary. Published so a UI can label a tie without guessing, and so it is obvious
 *  from one line that nothing in it is cultural. */
export const TIE_KINDS = ['household', 'family', 'partner', 'housemate', 'neighbour', 'colleague', 'friend', 'acquaintance', 'rival', 'ex'];

/** Published monthly decay rates from data/narrative.json relationship_model. */
const DECAY_PER_MONTH = { familiarity: 0.01, trust: 0.03, obligation: 0.02, friction: 0.06 };
const DAYS_PER_MONTH = 30.4;

/** How many stored ties one person carries. Above this the weakest is dropped, which is what
 *  actually happens: you stop keeping up with people. */
const MAX_TIES = 30;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Where an argument has an audience: a club, a hall, a shop, a terminal, an oval. */
const VENUE_KINDS = /club|hall|hotel|foodworks|general-dealers|roadhouse|terminal|jetty|oval|slsc|museum|quampi|markets|pavilion/i;

export function registerSocial(world) {
  const rng = world.rng.stream('social');

  const state = world.publish('social', {
    ready: false,
    ties: 0,
    pairs: 0,
    bubbles: 0,
    meanTies: 0,
    crossTownshipTiePct: 0,
    ambientNote: 'Ambient familiarity is computed from shared bubbles and is not stored. Only pairs with a history are in `pair`.',
    kinds: {},
    milestonesToday: [],
    pair: {},                 // pair[a][b] -> the four dimensions, per the narrative state contract
    forAgent: () => [],
    readPair: () => null,
    bubbleSizes: {},
    tieKinds: TIE_KINDS
  });

  let R = null;
  const bubbles = new Map();      // key -> { id, label, members: [personId], strength }
  const pairIndex = new Map();    // 'a|b' -> tie
  let tieCount = 0;

  /* -------------------------------------------------------------- bubbles */

  const STRENGTH = {
    household: 1.00,
    family: 0.72,
    work: 0.68,
    volunteer: 0.66,
    schoolgate: 0.60,
    club: 0.52,
    street: 0.50,
    boat: 0.44,
    township: 0.16
  };

  function bubble(key, label, kind) {
    let b = bubbles.get(key);
    if (!b) bubbles.set(key, (b = { key, label, kind, members: [], strength: STRENGTH[kind] || 0.3 }));
    return b;
  }

  function join(p, key, label, kind) {
    const b = bubble(key, label, kind);
    b.members.push(p.id);
    if (!p.bubbleKeys) p.bubbleKeys = [];
    p.bubbleKeys.push(key);
  }

  /** The clubs a person is actually likely to be a regular at, from data/businesses.json only. */
  const CLUB_RULES = [
    { id: 'point-lookout-bowls-club', township: 'point-lookout', minAge: 45, want: 0.30 },
    { id: 'point-lookout-slsc', township: 'point-lookout', minAge: 8, maxAge: 60, want: 0.16, trait: 'water' },
    { id: 'point-lookout-fishing-club', township: 'point-lookout', minAge: 20, want: 0.14, trait: 'water' },
    { id: 'straddie-sharks-all-sports-club', township: 'dunwich', minAge: 10, want: 0.30 },
    { id: 'little-ship-club', township: 'dunwich', minAge: 25, want: 0.26 },
    { id: 'north-stradbroke-island-golf-club', township: 'dunwich', minAge: 40, want: 0.12 },
    { id: 'amity-point-community-club', township: 'amity-point', minAge: 25, want: 0.40 },
    { id: 'stradbroke-island-beach-hotel', township: 'point-lookout', minAge: 18, want: 0.22 },
    { id: 'the-point-bar-and-bistro', township: 'point-lookout', minAge: 18, want: 0.18 }
  ];

  function buildBubbles() {
    // The house.
    for (const hh of R.households) {
      const b = bubble('hh:' + hh.id, hh.label, 'household');
      for (const m of hh.members) {
        b.members.push(m);
        const p = R.peopleById.get(m);
        if (p) { if (!p.bubbleKeys) p.bubbleKeys = []; p.bubbleKeys.push('hh:' + hh.id); }
      }
    }

    // The street. A 260 m cell around the dwelling, which on this island is a handful of houses and
    // the people you actually wave to.
    for (const p of R.people) {
      const gx = Math.round(p.homeX / 260), gz = Math.round(p.homeZ / 260);
      join(p, `st:${gx}:${gz}`, `the houses around ${p.townshipId}`, 'street');
      join(p, 'tw:' + p.townshipId, p.townshipId, 'township');
    }

    // Work. Only where there is a real employer: a sole trader has no workmates.
    for (const p of R.people) {
      if (p.employerId) join(p, 'wk:' + p.employerId, p.employerLabel, 'work');
    }

    // The school gate. Dunwich State School is the island's only school and it draws from all three
    // townships, so this is the one bubble that reliably crosses them.
    for (const p of R.people) {
      if ((p.role === 'primary' && p.schoolsOnIsland !== false) || p.hasSchoolKid) {
        join(p, 'sg:dunwich-state-school', 'the school gate at Dunwich', 'schoolgate');
      }
      if (p.role === 'secondary' || (p.role === 'primary' && p.schoolsOnIsland === false)) {
        join(p, 'boat:school', 'the school boat', 'boat');
      }
      if (p.occupationId === 'mainland-commuter-professional') join(p, 'boat:commuters', 'the first boat crowd', 'boat');
    }

    // Volunteers, assigned by schedule.js.
    for (const p of R.people) {
      if (p.volunteer) join(p, 'vol:' + p.volunteer, p.volunteerLabel, 'volunteer');
    }

    // Clubs. Membership is modelled: no club publishes a member list, and it would not be used here
    // if it did. The rules above put the right sort of person in the right real venue.
    for (const rule of CLUB_RULES) {
      const biz = R.businesses.get(rule.id);
      if (!biz) continue;
      for (const p of R.people) {
        if (p.age < rule.minAge || (rule.maxAge && p.age > rule.maxAge)) continue;
        const local = p.townshipId === rule.township;
        const traitLift = rule.trait ? p.traits[rule.trait] : p.traits.sociable;
        const chance = rule.want * (local ? 1 : 0.18) * (0.4 + traitLift * 1.2);
        if (rng.float() < chance) join(p, 'cl:' + rule.id, biz.label, 'club');
      }
    }

    // Extended family across houses, from population.js: the same surname in the same township,
    // linked about a third of the time, which is what a fifty-six name pool over 970 households
    // makes true anyway.
    for (const [a, b] of R.extendedFamily || []) {
      const ha = R.householdsById.get(a), hb = R.householdsById.get(b);
      if (!ha || !hb) continue;
      const key = `fam:${ha.surname}:${ha.townshipId}:${Math.min(a, b)}`;
      for (const hh of [ha, hb]) {
        for (const m of hh.members) {
          const p = R.peopleById.get(m);
          if (p) join(p, key, `the ${ha.surname} family`, 'family');
        }
      }
    }

    for (const b of bubbles.values()) b.members = Array.from(new Set(b.members));
  }

  /* -------------------------------------------------------------- ambient familiarity */

  function sharedBubbles(a, b) {
    const ka = a.bubbleKeys, kb = b.bubbleKeys;
    if (!ka || !kb) return null;
    let best = 0, count = 0, bestKey = null;
    for (let i = 0; i < ka.length; i++) {
      for (let j = 0; j < kb.length; j++) {
        if (ka[i] !== kb[j]) continue;
        const bub = bubbles.get(ka[i]);
        if (!bub) continue;
        count++;
        if (bub.strength > best) { best = bub.strength; bestKey = ka[i]; }
      }
    }
    return count ? { best, count, key: bestKey } : null;
  }

  /**
   * Would these two know each other, absent anything specific having happened? This is a function,
   * not a table: storing it for two million pairs would cost more than the rest of the island.
   */
  function ambient(a, b) {
    const sh = sharedBubbles(a, b);
    if (!sh) return 0.02;
    let f = sh.best + Math.min(0.22, (sh.count - 1) * 0.08);
    // Time here counts. A pair who have both been on the island twenty years know each other better
    // than a pair who arrived last winter, whatever they share.
    const both = Math.min(a.yearsOnIsland, b.yearsOnIsland);
    f *= 0.72 + Math.min(0.28, both / 18);
    return clamp(f, 0, 1);
  }

  /* -------------------------------------------------------------- ties */

  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  function kindFor(a, b, sh) {
    if (!sh) return 'acquaintance';
    const bub = bubbles.get(sh.key);
    if (!bub) return 'acquaintance';
    switch (bub.kind) {
      case 'household': {
        const ha = R.householdsById.get(a.householdId);
        if (!ha) return 'housemate';
        if (ha.compositionClass === 'group') return 'housemate';
        return Math.abs(a.age - b.age) <= 14 && a.age >= 18 && b.age >= 18 ? 'partner' : 'family';
      }
      case 'family': return 'family';
      case 'work': return 'colleague';
      case 'street': return 'neighbour';
      default: return 'acquaintance';
    }
  }

  function getTie(a, b, create, tick) {
    const key = pairKey(a.id, b.id);
    let t = pairIndex.get(key);
    if (t || !create) return t || null;
    if (a.ties.size >= MAX_TIES) dropWeakest(a);
    if (b.ties.size >= MAX_TIES) dropWeakest(b);
    const sh = sharedBubbles(a, b);
    const lo = a.id < b.id ? a : b;
    const hi = a.id < b.id ? b : a;
    t = {
      a: lo.id, b: hi.id,
      kind: kindFor(lo, hi, sh),
      familiarity: ambient(a, b),
      trust: 0.05,
      obligation: 0,
      friction: 0,
      met: tick,
      lastSeen: tick,
      together: 0,
      history: []
    };
    pairIndex.set(key, t);
    a.ties.set(b.id, t);
    b.ties.set(a.id, t);
    tieCount++;
    let row = state.pair[lo.id];
    if (!row) row = state.pair[lo.id] = {};
    row[hi.id] = t;
    return t;
  }

  function dropWeakest(p) {
    let worst = null, worstKey = -1, worstScore = Infinity;
    for (const [id, t] of p.ties) {
      if (t.kind === 'household' || t.kind === 'partner' || t.kind === 'family') continue;
      const s = t.familiarity + Math.abs(t.trust) + Math.abs(t.obligation) + t.friction;
      if (s < worstScore) { worstScore = s; worst = t; worstKey = id; }
    }
    if (!worst) return;
    const other = R.peopleById.get(worstKey);
    p.ties.delete(worstKey);
    if (other) other.ties.delete(p.id);
    const key = pairKey(worst.a, worst.b);
    pairIndex.delete(key);
    const row = state.pair[worst.a];
    if (row) delete row[worst.b];
    tieCount--;
  }

  function remember(t, tick, text) {
    const last = t.history[t.history.length - 1];
    if (last && last.text === text) { last.tick = tick; last.times = (last.times || 1) + 1; return; }
    t.history.push({ tick, text });
    if (t.history.length > 4) t.history.shift();
  }

  /* -------------------------------------------------------------- milestones */

  const milestones = [];

  function note(kind, a, b, text) {
    milestones.push({ kind, a: a.id, b: b.id, names: [a.displayName, b.displayName], text });
    if (milestones.length > 40) milestones.shift();
    world.bus.emit('social:' + kind, { a: a.id, b: b.id, names: [a.displayName, b.displayName], text });
    if (a.history) a.history.push({ tick: world.clock.tick, text, weight: 2 });
    if (b.history) b.history.push({ tick: world.clock.tick, text, weight: 2 });
  }

  /** Trait compatibility. Two people who both turn out for things, or who both want a quiet street,
   *  get on. Somebody who wants a quiet street and somebody who has people over every Friday do not. */
  function compatibility(a, b) {
    const ta = a.traits, tb = b.traits;
    let d = 0;
    d += Math.abs(ta.sociable - tb.sociable);
    d += Math.abs(ta.outdoors - tb.outdoors);
    d += Math.abs(ta.civic - tb.civic);
    d += Math.abs(ta.water - tb.water) * 0.6;
    const ageGap = Math.min(1, Math.abs(a.age - b.age) / 45);
    // Scaled so that about one pair in ten genuinely does not click. At a flatter scaling almost
    // every pair came out positive, trust regenerated faster than friction could bite, and the
    // island had no rivals at all in a sim-year, which is not a place anybody lives in.
    return clamp(1 - d / 2.2 - ageGap * 0.4, -1, 1);
  }

  /* -------------------------------------------------------------- the system */

  const buckets = new Map();
  let decayCursor = 0;
  let allTies = [];
  let lastDay = -1;
  let visitCursor = 0;

  return world.register({
    id: 'social',
    phase: 'agents',
    order: 40,

    init(w) {
      R = w.residents;
      if (!R || !R.ready) return;
      buildBubbles();

      // Everybody in a house already knows everybody in that house, and the extended family and
      // the workmates are real from day one. Everything else has to happen.
      const tick = w.clock.tick;
      for (const b of bubbles.values()) {
        if (b.kind !== 'household' && b.kind !== 'family') continue;
        const m = b.members;
        for (let i = 0; i < m.length; i++) {
          for (let j = i + 1; j < m.length; j++) {
            const a = R.peopleById.get(m[i]), c = R.peopleById.get(m[j]);
            if (!a || !c) continue;
            const t = getTie(a, c, true, tick);
            if (!t) continue;
            if (b.kind === 'household') {
              t.kind = kindFor(a, c, { key: b.key });
              t.familiarity = 1;
              t.trust = clamp(0.55 + compatibility(a, c) * 0.3, -1, 1);
            } else {
              // Never below what the household loop already set: two people can be in the same
              // house and the same extended family, and the extended family is the weaker claim.
              t.familiarity = Math.max(t.familiarity, clamp(0.6 + rng.range(-0.15, 0.2), 0, 1));
              t.trust = Math.max(t.trust, clamp(0.35 + compatibility(a, c) * 0.25, -1, 1));
            }
          }
        }
      }

      allTies = Array.from(pairIndex.values());
      state.ready = true;
      state.forAgent = (id, n = 8) => {
        const p = R.peopleById.get(id);
        if (!p) return [];
        const out = [];
        for (const [other, t] of p.ties) {
          const o = R.peopleById.get(other);
          if (!o) continue;
          out.push({
            id: other, name: o.displayName, kind: t.kind,
            familiarity: +t.familiarity.toFixed(2),
            trust: +t.trust.toFixed(2),
            obligation: +(t.a === id ? t.obligation : -t.obligation).toFixed(2),
            friction: +t.friction.toFixed(2),
            lastSeenDaysAgo: Math.round((world.clock.tick - t.lastSeen) / 144),
            history: t.history.slice().reverse()
          });
        }
        out.sort((x, y) => (y.familiarity + Math.abs(y.trust)) - (x.familiarity + Math.abs(x.trust)));
        return out.slice(0, n);
      };
      state.readPair = (a, b) => {
        const t = pairIndex.get(pairKey(a, b));
        if (t) return { stored: true, ...t };
        const pa = R.peopleById.get(a), pb = R.peopleById.get(b);
        if (!pa || !pb) return null;
        return { stored: false, familiarity: +ambient(pa, pb).toFixed(3), trust: 0, obligation: 0, friction: 0, kind: 'ambient' };
      };
      summarise();
      w.bus.emit('social:ready', { bubbles: bubbles.size, ties: tieCount });
    },

    tick(w) {
      if (!R || !R.ready || !state.ready) return;
      const tick = w.clock.tick;

      /* --- 1. who is in the same place. One pass, then capped pairing inside each bucket. */
      buckets.clear();
      const people = R.people;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p.onIsland || p.sleeping) continue;
        const loc = p.locationId;
        if (!loc || loc === 'home' || loc === 'island') continue;   // home is the household bubble
        let list = buckets.get(loc);
        if (!list) buckets.set(loc, (list = []));
        list.push(p);
      }

      let updates = 0;
      const BUDGET = 900;
      for (const [loc, list] of buckets) {
        if (list.length < 2 || updates > BUDGET) continue;
        // Everyone in the bucket meets a few of the others, rotated by tick so that over a couple
        // of sim-hours in the same room everybody has crossed everybody.
        const stride = 1 + (tick % Math.max(1, list.length - 1));
        const per = list.length > 12 ? 2 : 3;
        for (let i = 0; i < list.length && updates < BUDGET; i++) {
          const a = list[i];
          for (let k = 1; k <= per; k++) {
            const j = (i + k * stride) % list.length;
            if (j === i) continue;
            const b = list[j];
            if (b.id < a.id) continue;   // each unordered pair once
            meet(a, b, tick);
            updates++;
          }
        }
      }
      state.metLastTick = updates;

      /* --- 2. absence. The published monthly rates, applied over a sweep of the whole tie set
             once a sim-day, so nothing is a spike. */
      if (allTies.length) {
        const perTick = Math.max(1, Math.ceil(allTies.length / 144));
        const perDay = 1 / DAYS_PER_MONTH;
        for (let k = 0; k < perTick; k++) {
          if (decayCursor >= allTies.length) { decayCursor = 0; allTies = Array.from(pairIndex.values()); if (!allTies.length) break; }
          const t = allTies[decayCursor++];
          if (!t || !pairIndex.has(pairKey(t.a, t.b))) continue;
          const seenRecently = tick - t.lastSeen < 144 * 7;
          if (t.kind === 'household' || t.kind === 'partner') continue;   // you live with them
          t.familiarity = clamp(t.familiarity - DECAY_PER_MONTH.familiarity * perDay, 0, 1);
          t.trust -= Math.sign(t.trust) * DECAY_PER_MONTH.trust * perDay;
          t.obligation -= Math.sign(t.obligation) * DECAY_PER_MONTH.obligation * perDay;
          // Friction decays fastest of the four, because you still see them at the shop. Half that
          // if the two have not crossed paths at all, which is the pack's own rule.
          t.friction = clamp(t.friction - DECAY_PER_MONTH.friction * perDay * (seenRecently ? 1 : 0.5), 0, 1);
          if (Math.abs(t.trust) < 0.005) t.trust = 0;
          if (Math.abs(t.obligation) < 0.005) t.obligation = 0;
        }
      }

      /* --- 3. who is worth dropping in on. Spread across the day rather than done at midnight:
             two thousand people times their address books in one tick was an eighty millisecond
             hitch every sim-day, which is a dropped frame however good the average looks. */
      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        allTies = Array.from(pairIndex.values());
        state.milestonesToday = milestones.slice(-12);
        visitCursor = 0;
      }
      if (visitCursor < people.length) {
        const chunk = Math.ceil(people.length / 120);
        const end = Math.min(people.length, visitCursor + chunk);
        for (let i = visitCursor; i < end; i++) {
          const p = people[i];
          if (!p) continue;
          let best = null, bestScore = -1;
          for (const [other, t] of p.ties) {
            if (t.kind === 'household') continue;
            const o = R.peopleById.get(other);
            if (!o) continue;
            const s = t.familiarity * 0.6 + t.trust * 0.5 - t.friction * 0.8 + rng.float() * 0.4
              + Math.min(1, (tick - t.lastSeen) / (144 * 30)) * 0.3;
            if (s > bestScore) { bestScore = s; best = o; }
          }
          p.visitTarget = best;
          p.tieCount = p.ties.size;
        }
        visitCursor = end;
      }
      // The summary is a full pass over every tie, so it runs twice a sim-day, not every day-start.
      if (tick % 72 === 0) summarise();
    },

    describe(w) {
      return {
        bubbles: bubbles.size,
        ties: tieCount,
        meanTies: state.meanTies,
        kinds: state.kinds,
        crossTownshipPct: state.crossTownshipTiePct,
        metLastTick: state.metLastTick || 0,
        friends: state.kinds.friend || 0,
        rivals: state.kinds.rival || 0,
        knowsEveryonePct: state.knowsEveryonePct
      };
    },

    save() {
      return {
        v: 1,
        ties: Array.from(pairIndex.values()).map((t) => [t.a, t.b, t.kind,
          +t.familiarity.toFixed(3), +t.trust.toFixed(3), +t.obligation.toFixed(3), +t.friction.toFixed(3), t.met, t.lastSeen, t.together])
      };
    },
    load(w, s) {
      if (!s || !R || !R.ready) return;
      // Replace, do not merge. Loading on top of a running graph left every pair counted twice.
      for (const p of R.people) p.ties.clear();
      pairIndex.clear();
      for (const k of Object.keys(state.pair)) delete state.pair[k];
      tieCount = 0;
      for (const [a, b, kind, f, tr, ob, fr, met, seen, tog] of s.ties || []) {
        const pa = R.peopleById.get(a), pb = R.peopleById.get(b);
        if (!pa || !pb) continue;
        const t = getTie(pa, pb, true, met);
        if (!t) continue;
        t.kind = kind; t.familiarity = f; t.trust = tr; t.obligation = ob; t.friction = fr;
        t.met = met; t.lastSeen = seen; t.together = tog;
      }
      allTies = Array.from(pairIndex.values());
      summarise();
    }
  });

  /* -------------------------------------------------------------- meeting */

  function meet(a, b, tick) {
    // People who share nothing at all still only rarely turn into a tie: standing next to somebody
    // in a queue is not knowing them.
    let t = a.ties.get(b.id);
    if (!t) {
      const sh = sharedBubbles(a, b);
      // Slow. An islander does not acquire twenty new people in a fortnight, and the ambient layer
      // already covers the ones they merely recognise.
      const chance = sh ? 0.016 * sh.best + 0.0015 : 0.0005;
      if (rng.float() > chance) return;
      t = getTie(a, b, true, tick);
      if (!t) return;
      note('met', a, b, `${a.given} and ${b.given} got talking at ${a.locationLabel}`);
    }

    const sameThing = a.actionId === b.actionId;
    const gain = sameThing ? 0.0042 : 0.0018;
    t.familiarity = clamp(t.familiarity + gain, 0, 1);
    t.together += sameThing ? 2 : 1;
    t.lastSeen = tick;

    const comp = compatibility(a, b);
    t.trust = clamp(t.trust + (comp - t.trust) * 0.006, -1, 1);

    // Friction. Two people who do not get on, both worn down, in a place that is too busy. This is
    // the January argument, and it is the reason island fatigue exists as a need at all.
    if (comp < 0.12) {
      const fat = ((a.n ? a.n[8] : 0) + (b.n ? b.n[8] : 0)) * 0.5;
      // Plus whatever the house itself is doing to them: a household over its bedroom count is
      // the pack's own housing story, and it comes out sideways at the shop.
      const crowded = Math.min(0.5, (a.householdCrowding || 0) + (b.householdCrowding || 0));
      if (rng.float() < 0.004 + fat * 0.055 + crowded * 0.03) {
        t.friction = clamp(t.friction + 0.12, 0, 1);
        t.trust = clamp(t.trust - 0.11, -1, 1);
        remember(t, tick, `words at ${a.locationLabel}`);
      }
    }
    // The insider and outsider axis, from the published relationship model. It is asymmetric on
    // purpose: it is the actual shape of the argument on this island, and it is what happens when
    // somebody three months off the boat has a view about parking in January. The pack puts it at a
    // civic beat with an audience, so it fires at a venue rather than anywhere two people cross.
    if (a.newcomer !== b.newcomer && VENUE_KINDS.test(a.locationId || '')
      && rng.float() < 0.004 * (1 + (a.n ? a.n[8] : 0))) {
      t.friction = clamp(t.friction + 0.10, 0, 1);
      t.trust = clamp(t.trust - 0.06, -1, 1);
      remember(t, tick, 'a difference of view about how things are done here');
    }

    // Doing a hard thing together. The published rule is shared load: trust and familiarity both
    // move, whether or not it went well.
    if (sameThing && (a.actionId === 'a-callout' || a.actionId === 'on-patrol' || a.actionId === 'a-working-bee')) {
      t.trust = clamp(t.trust + 0.012, -1, 1);
      t.familiarity = clamp(t.familiarity + 0.006, 0, 1);
      if (t.together === 6) remember(t, tick, 'turned out together');
    }

    // A favour: somebody with a car takes somebody without one. The published rule puts the
    // obligation on the receiver and lifts trust both ways, and it is the engine of the whole model.
    if (a.hasVehicle !== b.hasVehicle && t.familiarity > 0.45 && rng.float() < 0.004) {
      const receiver = a.hasVehicle ? b : a;
      const giver = a.hasVehicle ? a : b;
      const sign = receiver.id === t.a ? 1 : -1;
      t.obligation = clamp(t.obligation + 0.20 * sign, -1, 1);
      t.trust = clamp(t.trust + 0.10, -1, 1);
      remember(t, tick, `${giver.given} gave ${receiver.given} a lift`);
    }

    // Milestones.
    if (t.kind === 'acquaintance' && t.familiarity > 0.55 && t.trust > 0.25) {
      t.kind = 'friend';
      remember(t, tick, 'became friends');
      note('friendship', a, b, `${a.given} and ${b.given} are proper mates now`);
      // A rival is somebody you do not get on with, not somebody you merely disagree with. The
      // published rule is explicit that arguing at a meeting leaves trust alone and only makes
      // Thursday awkward, so a high friction pair who still trust each other stay colleagues.
    } else if (t.kind !== 'rival' && t.kind !== 'household' && t.kind !== 'partner' && t.friction > 0.45 && t.trust < 0.30) {
      t.kind = 'rival';
      remember(t, tick, 'fell out');
      note('falling-out', a, b, `${a.given} and ${b.given} are not speaking`);
    } else if ((t.kind === 'friend' || t.kind === 'colleague') && t.familiarity > 0.8 && t.trust > 0.6
      && a.age >= 18 && b.age >= 18 && Math.abs(a.age - b.age) < 16
      && a.householdId !== b.householdId && !a.partnerId && !b.partnerId && rng.float() < 0.0015) {
      t.kind = 'partner';
      a.partnerId = b.id; b.partnerId = a.id;
      remember(t, tick, 'together');
      note('partnership', a, b, `${a.given} and ${b.given} are together`);
      maybeMoveIn(a, b, tick);
    } else if (t.kind === 'partner' && t.friction > 0.55 && t.trust < 0.1 && rng.float() < 0.004) {
      t.kind = 'ex';
      a.partnerId = null; b.partnerId = null;
      remember(t, tick, 'split up');
      note('breakup', a, b, `${a.given} and ${b.given} have split up`);
    }
  }

  /**
   * A new couple moving in together, but only where the housing actually allows it. On an island
   * where half the houses are empty and none of them are available, that is usually a share house
   * or a spare room, and quite often it is nothing at all.
   */
  function maybeMoveIn(a, b, tick) {
    const ha = R.householdsById.get(a.householdId);
    const hb = R.householdsById.get(b.householdId);
    if (!ha || !hb) return;
    const spare = (hh) => hh.bedrooms - hh.members.length;
    let into = null, mover = null;
    if (spare(ha) >= 1 && (hb.compositionClass === 'group' || hb.members.length > 1)) { into = ha; mover = b; }
    else if (spare(hb) >= 1 && (ha.compositionClass === 'group' || ha.members.length > 1)) { into = hb; mover = a; }
    if (!into || !mover) return;
    const from = R.householdsById.get(mover.householdId);
    if (!from || from.id === into.id) return;
    from.members = from.members.filter((m) => m !== mover.id);
    into.members.push(mover.id);
    mover.householdId = into.id;
    mover.townshipId = into.townshipId;
    mover.homeX = mover.x = mover.tx = into.x;
    mover.homeZ = mover.z = mover.tz = into.z;
    mover._homePlace = null;
    mover._places = null;   // the shop and the beach they walk to are different now
    mover.householdSize = into.members.length;
    into.crowding = Math.max(0, into.members.length - into.bedrooms) / Math.max(1, into.bedrooms);
    world.bus.emit('household:moved-in-together', { a: a.id, b: b.id, household: into.id, township: into.townshipId });
    // The house they left may now be empty, which frees a dwelling on an island short of them.
    if (!from.members.length) world.bus.emit('housing:dwelling-freed', { dwellingId: from.dwellingId, township: from.townshipId });
  }

  /* -------------------------------------------------------------- summary */

  function summarise() {
    const kinds = {};
    let cross = 0, total = 0;
    for (const t of pairIndex.values()) {
      kinds[t.kind] = (kinds[t.kind] || 0) + 1;
      total++;
      const a = R.peopleById.get(t.a), b = R.peopleById.get(t.b);
      if (a && b && a.townshipId !== b.townshipId) cross++;
    }
    state.kinds = kinds;
    state.ties = total;
    state.pairs = total;
    state.bubbles = bubbles.size;
    state.meanTies = R.people.length ? +(2 * total / R.people.length).toFixed(2) : 0;
    state.crossTownshipTiePct = total ? +(100 * cross / total).toFixed(1) : 0;
    // The evidence for the claim in this file's header: what share of all possible pairs on this
    // island actually know each other well enough to be worth storing. It should be tiny.
    const n = R.people.length;
    state.knowsEveryonePct = n > 1 ? +(100 * total / (n * (n - 1) / 2)).toFixed(3) : 0;
    const sizes = {};
    for (const b of bubbles.values()) {
      const k = b.kind;
      if (!sizes[k]) sizes[k] = { count: 0, members: 0 };
      sizes[k].count++;
      sizes[k].members += b.members.length;
    }
    state.bubbleSizes = sizes;
  }
}
