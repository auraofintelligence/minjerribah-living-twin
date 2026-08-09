// The beats. director.js decides which story the island has produced the conditions for and opens a
// thread; this file walks that thread through its beats, and every step of the walk has to be paid
// for by something the simulation actually did.
//
// WHAT A BEAT IS
//   data/narrative.json gives every seed five beats: setup, complication, choice, consequence, coda.
//   Each beat carries `requires`, a list of conditions written against the pack's state contract, and
//   `sets`, a list of writes on four channels. A beat fires when its requires are satisfied against
//   published state, and not before. There is no timer that advances a story on its own.
//
// THE THREE THINGS THAT CAN HAPPEN TO A BEAT, AND WHY THE THIRD ONE MATTERS
//   fired    every required condition resolved and passed. The beat happened, it is written down,
//            and the numbers that made it true are carried with it so a critic can check them.
//   waiting  a required condition resolved and was false. The island has not done the thing yet.
//            The thread waits, for at most the seed's patience_days, and then it fizzles: the pack
//            asks for about one thread in five to go nowhere, and this is where that comes from.
//   skipped  a required condition did not resolve at all, because no system on this island publishes
//            that number yet. The beat is not written. It is not faked, it is not softened into a
//            sentence that sounds true, and it is not counted as having happened. It is recorded in
//            describe().skipped with the path that was missing, so whoever builds traffic.js can see
//            exactly which beats are waiting on them. The beat grammar allows a stage to be skipped,
//            so the thread carries on to the next one.
//
// A thread that runs out of firable beats ends. It ends well, badly, quietly or unresolved, and
// quietly is the most common because quietly is what usually happens. The endings ratio in the pack
// is 30 well, 15 badly, 35 quietly, 20 unresolved, and nothing in this file forces a thread into a
// bucket to hit it: the ratio comes out of the branch the story took and the state at the end of it.
//
// THE FOUR CHANNELS, AND WHAT EACH ONE ACTUALLY MOVES
//   own        thread.vars. The thread's own memory. Nothing outside narrative reads it.
//   social     a named change rule from the pack's relationship_model, applied to the real tie in
//              social.js. The numbers come out of the pack's own effect strings, parsed at boot, so
//              the rule and the number cannot drift apart. Every change is written into the tie's
//              history with the rule that caused it, which is the pack's hard rule: a thread may
//              never set a relationship value directly.
//   sentiment  a bounded mood delta on an interest group, emitted as narrative:sentiment and held in
//              this file's own ledger. sentiment.js has no channel for it yet, and this file does not
//              pretend otherwise: the deltas are listed in describe().sentimentOwed so that whoever
//              adds the channel can see what is waiting. Where a beat's effect names a real policy
//              metric instead, that goes out as civic:metric-nudge, which policy.js does consume, so
//              a consequence beat moves a number the player can find on the civic board.
//   intent     world.bus.emit('narrative:intent', ...). Another system may honour it or ignore it.
//              Nothing here checks whether anybody listened, because nothing here is entitled to.
//
// THE CHOICE BEAT
//   Every seed has exactly one branch. The pack says who decides: the player, a resident, or nobody.
//   A player branch is offered on the bus and on the chronicle panel and is held open for the shorter
//   of the seed's patience and three days; if the player does not answer, it resolves the way it
//   would have without them, because no seed may require the player to act. A resident branch is
//   drawn from the cast's own position: what they can afford, who owes whom, how long they have been
//   here. A nobody branch is decided by the weather and the timetable.
//
// CULTURAL RULE, ABSOLUTE
//   Nobody speaks. See the pack's tone_guide.no_speech: this file never generates quoted speech, and
//   never attributes a word, a view or a position to any character or to any real organisation.
//   Quandamooka households are cast in the ordinary working and civic roles of the island like every
//   other household, and nothing about which households those are reaches published state, a
//   chronicle line or a label. See data/lore.json prohibitions and docs/CULTURAL-REVIEW.md.
//
// DETERMINISM
//   Every draw comes from world.rng.stream('storylines'). Every date comes from world.clock. No
//   Math.random, no Date.now, no iteration over anything whose order is not stable.
//
// COST
//   The whole file runs once an hour of sim time, which is every six ticks, over at most four open
//   threads. Everything expensive is behind that gate.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** One sim-hour. The director evaluates every six, and a beat never needs finer than that. */
const STEP_TICKS = 6;

/** How long a player branch stays open before it resolves itself. Days, capped by seed patience. */
const PLAYER_WINDOW_DAYS = 3;

/** A relationship change that could not land because social.js has no stored tie for the pair is
 *  retried for this many days and then given up on. */
const PENDING_TIE_DAYS = 30;

/* ------------------------------------------------------------------ local path bindings

The director carries the main binding table. These are the beat-level paths it has no entry for,
bound here against systems that were built after the pack was written. Same three honesty labels it
uses, same rule: a path with no binding resolves to undefined, and a beat with an unresolvable
require is skipped rather than guessed at. Every one of these is listed in describe().bindings. */

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

/** Events that are events and not states, collected off the bus the way director.js collects sales.
 *  Each entry is a real emit from a real system, and the window is how long it stays true. */
const COLLECTED = {
  'housing:lease-ending': { key: 'leaseEndings', days: 30, from: 'housing' },
  'business:stockout': { key: 'stockouts', days: 3, from: 'businesses' },
  'wildlife:call': { key: 'wildlifeCalls', days: 3, from: 'koala' }
};
const COLLECTED_BY_KEY = {};
for (const t of Object.keys(COLLECTED)) COLLECTED_BY_KEY[COLLECTED[t].key] = COLLECTED[t];

const LOCAL_BINDINGS = {
  'visitors.byArchetype.<archetype>': {
    kind: 'same-quantity',
    why: 'visitors.js publishes byArchetype only for the archetypes that have somebody on the island '
      + 'right now. A missing key is a real zero, not a missing system, so this reads it as zero.',
    get: (w, b) => {
      const v = w.state.visitors;
      if (!v || !v.ready) return undefined;
      return num((v.byArchetype || {})[b.archetype]) || 0;
    }
  },

  'events.periodActive.long-weekends': {
    kind: 'same-quantity',
    why: 'schedule.js day.isLongWeekend, from the published Queensland calendar',
    get: (w) => {
      const d = w.state.schedule && w.state.schedule.day;
      return d ? !!d.isLongWeekend : undefined;
    }
  },

  'waste.binsUncollectedDays': {
    kind: 'derived',
    why: 'waste.js publishes kerbside.weeksBehind and kerbside.since, the day the truck stopped '
      + 'emptying because the yard had nowhere to tip. Days since that day is the same quantity in '
      + 'the unit the seed asks for.',
    get: (w) => {
      const k = w.state.waste && w.state.waste.kerbside;
      if (!k) return undefined;
      if (k.since === null || k.since === undefined) return 0;
      return Math.max(0, w.clock.dayIndex - k.since);
    }
  },

  'council.closures.<placeId>': {
    kind: 'same-quantity',
    why: 'navigation.js publishes closures[] with the closed route or track on each. A named place '
      + 'is shut when it is on that list.',
    get: (w, b) => {
      const n = w.state.navigation;
      if (!n || !Array.isArray(n.closures)) return undefined;
      const want = String(b.placeId);
      return n.closures.some((c) => String(c.id || c.route || c.where || '').includes(want));
    }
  },

  'vegetation.rehabilitationProgress': {
    kind: 'proxy',
    why: 'No system publishes a rehabilitated area figure for the old mine leases. policy.js '
      + 'publishes the delivery progress of the mine-rehabilitation-pace lever, which is the same '
      + 'programme measured from the civic end rather than from the ground.',
    get: (w) => {
      const L = w.state.policy && w.state.policy.levers && w.state.policy.levers['mine-rehabilitation-pace'];
      return L ? num(L.progress) : undefined;
    }
  },

  'dunes.<beachId>.scarpM': {
    kind: 'proxy',
    why: 'No system measures the height of the face. dunes.js publishes cutThisYearM3PerM for the '
      + 'same reach: the sand taken off a metre of beach this year. Read against an active face of '
      + 'about ten metres it gives a height in metres. The ten metres is a modelling assumption in '
      + 'this file, not a measurement, and it is the reason this is labelled a proxy.',
    get: (w, b) => {
      const d = w.state.dunes;
      if (!d || !Array.isArray(d.reaches)) return undefined;
      const r = d.reaches.find((x) => x.id === b.beachId);
      return r ? clamp((num(r.cutThisYearM3PerM) || 0) / 10, 0, 6) : undefined;
    }
  },

  'housing.leaseEndings.next30': {
    kind: 'same-quantity',
    why: 'housing.js emits housing:lease-ending as it happens. Collected off the bus and handed '
      + 'back as the last thirty days of them, which is the window the seed asks about.',
    get: (w, b, C) => (C ? C.recent('leaseEndings', w) : undefined)
  },

  'businesses.<businessId>.deliveriesMissed': {
    kind: 'derived',
    why: 'businesses.js emits business:stockout with the reason on it. A stockout whose reason is '
      + 'that the delivery has not landed is a missed delivery, counted for that business over the '
      + 'last three days.',
    get: (w, b, C) => {
      if (!C) return undefined;
      const list = C.recent('stockouts', w);
      if (list === undefined) return undefined;
      let n = 0;
      for (const e of list) if (e.id === b.businessId && /delivery/.test(e.why || '')) n++;
      return n;
    }
  },

  'koala.inTownshipTrees': {
    kind: 'derived',
    why: 'koala.js emits wildlife:call when an animal is on the ground in a yard, with the place on '
      + 'it. Those calls over the last three days are the animals in township trees the seed means. '
      + 'Nothing here counts an animal the simulation did not put in somebody\'s yard.',
    get: (w, b, C) => {
      if (!C) return undefined;
      const list = C.recent('wildlifeCalls', w);
      if (list === undefined) return undefined;
      let n = 0;
      for (const e of list) if (/yard|tree/.test(e.situation || '')) n++;
      return n;
    }
  }
};

const LOCAL_PATTERNS = Object.keys(LOCAL_BINDINGS).map((p) => ({
  pattern: p, parts: p.split('.'), entry: LOCAL_BINDINGS[p]
}));

/* ------------------------------------------------------------------ comparison

Same operator set the director uses, minus the series operators, which belong to whoever holds the
series. A beat asking for `rising` or `changed` is handed straight back to the director's own test so
there is one history of every watched number and not two. */

const SERIES_OPS = { rising: 1, falling: 1, changed: 1, increased: 1, fallenBy: 1, crossedThreshold: 1, belowSeasonalNormBy: 1, ratioBelow: 1 };

function compare(op, v, want) {
  switch (op) {
    case '==': return v === want || (typeof want === 'boolean' && !!v === want);
    case '!=': return v !== want;
    case '>': return typeof v === 'number' && v > want;
    case '>=': return typeof v === 'number' && v >= want;
    case '<': return typeof v === 'number' && v < want;
    case '<=': return typeof v === 'number' && v <= want;
    case 'in': return Array.isArray(want) && want.includes(v);
    case 'between': return Array.isArray(want) && typeof v === 'number' && v >= want[0] && v <= want[1];
    case 'exists': return v !== undefined && v !== null;
    case 'contains': return Array.isArray(v) && v.includes(want);
    case 'containsAny': return Array.isArray(v) && Array.isArray(want) && want.some((x) => v.includes(x));
    case 'containsMatching': return Array.isArray(v) && v.some((o) => o && typeof o === 'object'
      && Object.keys(want).every((k) => o[k] === want[k]));
    case 'lengthAtLeast': return (Array.isArray(v) ? v.length : 0) >= want;
    default: return false;
  }
}

/* ------------------------------------------------------------------ placeholders

Beat requires use placeholders the trigger never bound: <tradie>, <publican>, <asker>, <dogOwner>.
They are people, and the people are already cast. This maps a placeholder onto a cast role. Anything
not in the table falls through to a kebab-case match against the cast, then to the primaries in
billing order, which is the honest default: the story is about its primaries. */

const ROLE_ALIASES = {
  tradie: 'the-tradie', publican: 'the-publican', shiftWorker: 'the-shift-worker',
  skipper: 'the-skipper', fisher: 'the-fisher', ranger: 'the-ranger', volunteer: 'the-volunteer',
  wildlifeCarer: 'the-wildlife-carer', longTimer: 'the-long-timer', newcomer: 'the-newcomer',
  renter: 'the-renter', schoolKid: 'the-school-kid', teacher: 'the-teacher',
  healthWorker: 'the-health-worker', carer: 'the-carer', lettingManager: 'the-letting-manager',
  holidayOwner: 'the-holiday-owner', bushcareRegular: 'the-bushcare-regular',
  councilOfficer: 'the-council-officer', shopkeeper: 'the-shopkeeper', visitor: 'the-visitor',
  leaver: 'the-leaver', returner: 'the-returner', commuter: 'the-commuter',
  exMineWorker: 'the-ex-mine-worker', lender: 'the-shopkeeper',
  // Branch-dependent in one seed and resolved by the branch when it is; these are the defaults.
  dogOwner: 'the-long-timer', asker: 'the-newcomer',
  stuckDriver: 'the-visitor', localWhoHelped: 'the-long-timer', helpers: 'the-volunteer'
};

function kebab(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }

/* ------------------------------------------------------------------ the relationship rules

The pack writes each rule's effect as a sentence: "obligation +0.20 on the receiver, trust +0.10
both ways". The numbers are parsed out of that sentence at boot so they can never drift from the
pack. Who gets which number is here, in code, because that part is semantics and a regex has no
business guessing it. Every entry names the pack rule it implements. */

const RULE_SHAPE = {
  'shared-load': { pairs: 'all-acted', symmetric: true },
  'favour-given': { pairs: 'from-to', receiverGets: 'obligation', symmetric: ['trust'] },
  'favour-repaid': { pairs: 'from-to', towardZero: 'obligation' },
  'promise-broken': { pairs: 'from-to', symmetric: true },
  'public-disagreement': { pairs: 'between', symmetric: true },
  'insider-outsider': { pairs: 'between', asymmetric: 'long-term-side' },
  'loss-witnessed': { pairs: 'all-acted', symmetric: true },
  'newcomer-turns-up': { pairs: 'newcomer-to-township', symmetric: true },
  'left-holding-it': { pairs: 'others-to-one', receiverGets: 'obligation', fatigue: true },
  departure: { pairs: 'none' }
};

/** Pull "trust +0.08, familiarity +0.04" out of a pack effect string. */
function parseEffect(text) {
  const out = {};
  const re = /(familiarity|trust|obligation|friction)\s*([+-]?\d*\.?\d+)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const dim = m[1].toLowerCase();
    const v = Number(m[2]);
    if (Number.isFinite(v) && out[dim] === undefined) out[dim] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ branch gates

Some branch options carry their own precondition in plain words inside `effects`, because the pack is
a grammar and not a script: "only available if weather.windKt < 18", "requires trust >= 0.4". Both
forms are read here. An option whose gate cannot be evaluated is left available, because refusing an
option on a number nobody publishes would silently narrow every story on the island. */

const GATE_RE = /(?:only available if|requires|available if)\s+([a-zA-Z][\w.<>-]*)\s*(>=|<=|>|<|==)\s*(-?\d*\.?\d+)/i;

/* ------------------------------------------------------------------ ending overrides

The pack writes each ending's condition in prose, because most of them are about people and people
are not a threshold. These are the ones the island can actually answer for itself at the moment the
coda fires. Anything not in this table takes the ending its branch led to, which is the pack's own
design: the choice is what decides. */

const ENDING_TESTS = {
  'the-power-goes': (w) => {
    const p = w.state.power;
    if (!p || !p.outage) return null;
    if (p.outage.on) return 'badly';
    return (p.outage.worstMinutesThisYear || 0) > 2880 ? 'badly' : 'quietly';
  },
  'the-barge-that-did-not-run': (w) => {
    const f = w.state.ferry;
    if (!f || !f.cancellations) return null;
    return f.cancellations.today === 0 ? 'quietly' : null;
  },
  'the-weather-holds-the-boats': (w) => {
    const f = w.state.ferry;
    if (!f || !f.reliability) return null;
    return f.reliability.windKt < 25 ? 'quietly' : null;
  },
  'the-bins-after-the-weekend': (w) => {
    const y = w.state.waste && w.state.waste.yard;
    if (!y) return null;
    if (y.closedToPublic) return 'badly';
    return y.pctFullByVolume < 0.6 ? 'well' : null;
  },
  'a-main-in-january': (w) => {
    const p = w.state.water && w.state.water.pressure;
    if (!p) return null;
    return (p.outages || []).length === 0 ? 'well' : 'badly';
  },
  'the-count-is-down': (w) => {
    const wh = w.state.whales;
    if (!wh) return null;
    return wh.podsOnStage >= 20 ? 'well' : null;
  },
  'the-roost-at-the-north-end': (w) => {
    const s = w.state.shorebirds;
    if (!s || !Array.isArray(s.roosts)) return null;
    let birds = 0;
    for (const r of s.roosts) birds += r.birds || 0;
    return birds > 900 ? 'quietly' : 'badly';
  },
  'the-shack-sells': (w) => {
    const h = w.state.housing;
    if (!h || !h.rentals) return null;
    return h.rentals.available >= 8 ? 'well' : null;
  },
  'the-gorge-is-shut': (w) => {
    const wx = w.state.weather;
    if (!wx) return null;
    return wx.swellM < 2.4 ? 'quietly' : null;
  },
  'the-fish-are-on': (w) => {
    const m = w.state.marine;
    const run = m && (m.runs || []).find((x) => x.id === 'sp-tailor');
    if (!run) return null;
    return run.strength < 0.3 ? 'quietly' : null;
  }
};

/* ================================================================== the system */

export function registerStorylines(world) {
  const rng = world.rng.stream('storylines');

  const state = world.publish('storylines', {
    ready: false,
    basis: 'A beat fires when the state its seed asks for is there, and not otherwise. A beat whose '
      + 'state nothing publishes is skipped rather than written, and the missing path is named in '
      + 'describe().skipped.',
    running: [],            // one row per open thread: seed, beat, stage, what it is waiting for
    lastBeat: null,
    openChoice: null,       // the branch currently offered to the player, if any
    stats: {
      fired: 0, skipped: 0, waited: 0, closed: 0, fizzled: 0,
      byStage: {}, byOutcome: {}, choices: { player: 0, resident: 0, nobody: 0, timedOut: 0 }
    },
    relationships: [],      // the last 40 relationship movements, with the rule that caused each
    sentimentOwed: [],      // group mood deltas nothing consumes yet, kept honest and visible
    unresolvedSets: [],     // pack sets this file cannot turn into a number, counted not swallowed
    metricNudges: 0,
    skipped: [],            // {path, seed, beat} for every beat that could not be verified
    bindings: [],
    notes: []
  });

  let N = null;                 // world.state.narrative, the director's read model
  const ruleNumbers = new Map(); // ruleId -> {familiarity, trust, obligation, friction}
  const stageLengths = new Map(); // stage id -> [minDays, maxDays]
  let stageTotal = 26;          // sum of the stage midpoints, for scaling a seed's own duration
  let lastStepTick = -1;

  const pendingTies = [];       // relationship changes waiting on social.js to have a tie
  const skipIndex = new Map();  // path -> {path, seeds:[], beats:n}
  const sentimentOwed = new Map();
  // Sets the pack asks for that this file cannot resolve, counted by group and raw value.
  const unresolvedSets = new Map();
  const bindCache = new Map();  // thread id -> {day, bind}. Never stored on the thread: the director
                                // serialises those wholesale and a cache does not belong in a save.

  /* -------------------------------------------------------------- collected events

  Things that happen rather than things that are. Same pattern the director uses for housing sales:
  hold the last few days of them so a beat can ask whether the island did the thing recently. */

  const collected = new Map();  // key -> [{day, ...payload}]

  const C = {
    push(key, day, rec) {
      let list = collected.get(key);
      if (!list) collected.set(key, (list = []));
      list.push(Object.assign({ day }, rec));
      if (list.length > 60) list.shift();
    },
    /** An empty list when the supplying system is loaded and nothing has happened; undefined when
     *  the supplying system is not built, which is the difference between a quiet week and a path
     *  nobody publishes. */
    recent(key, w) {
      const list = collected.get(key);
      if (!list) return undefined;
      const cut = w.clock.dayIndex - (COLLECTED_BY_KEY[key] || { days: 30 }).days;
      return list.filter((e) => e.day >= cut);
    }
  };

  /* -------------------------------------------------------------- local series

  The director holds the history of every number its own bindings supply, and a shape operator on
  one of those goes back to it. These are the shape operators on a number only this file supplies,
  which is a short list and would otherwise be two histories of the same reading. */

  const series = new Map();

  function pushSeries(key, day, v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    let s = series.get(key);
    if (!s) series.set(key, (s = { v: [], d: [] }));
    if (s.d.length && s.d[s.d.length - 1] === day) { s.v[s.v.length - 1] = v; return s; }
    s.v.push(v); s.d.push(day);
    if (s.v.length > 120) { s.v.shift(); s.d.shift(); }
    return s;
  }

  function shapeTest(op, key, day, v, want) {
    const s = pushSeries(key, day, v);
    if (!s) return false;
    const n = s.v.length;
    switch (op) {
      case 'changed': return n >= 2 && s.v[n - 1] !== s.v[n - 2];
      case 'increased': return n >= 2 && (s.v[n - 1] - s.v[n - 2]) >= want;
      case 'crossedThreshold': return n >= 2 && ((s.v[n - 2] < want && v >= want) || (s.v[n - 2] > want && v <= want));
      case 'rising': case 'falling': {
        if (n < 3) return false;
        const tail = s.v.slice(-3);
        for (let i = 1; i < tail.length; i++) {
          if (op === 'rising' && tail[i] < tail[i - 1]) return false;
          if (op === 'falling' && tail[i] > tail[i - 1]) return false;
        }
        return op === 'rising' ? tail[2] > tail[0] : tail[2] < tail[0];
      }
      case 'fallenBy': {
        if (n < 8) return false;
        let hi = -Infinity;
        for (const x of s.v) if (x > hi) hi = x;
        return hi > 0 && v <= hi * (1 - want);
      }
      case 'ratioBelow': return n >= 2 && s.v[n - 2] > 0 && (v / s.v[n - 2]) < want;
      default: return false;
    }
  }

  /* -------------------------------------------------------------- resolution */

  function directorState(w) {
    const n = w.state.narrative;
    return n && typeof n.resolve === 'function' ? n : null;
  }

  /** Walk a dotted path into an object. */
  function walk(obj, parts, from) {
    let cur = obj;
    for (let i = from; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function localBinding(w, filled) {
    for (const B of LOCAL_PATTERNS) {
      if (B.parts.length !== filled.length) continue;
      let ok = true;
      const b = {};
      for (let i = 0; i < B.parts.length; i++) {
        const bp = B.parts[i];
        if (bp.length > 2 && bp[0] === '<' && bp[bp.length - 1] === '>') { b[bp.slice(1, -1)] = filled[i]; continue; }
        if (bp !== filled[i]) { ok = false; break; }
      }
      if (!ok) continue;
      try { return B.entry.get(w, b, C); } catch (e) { return undefined; }
    }
    return undefined;
  }

  /**
   * Resolve a beat path. The running system wins, then the director's table, then this file's own.
   * social.pair is handled first because social.js publishes it under the lower agent id and answers
   * for an unstored pair through its own readPair, which is the ambient familiarity two people on an
   * island of two thousand have whether or not anything has ever happened between them.
   */
  function resolve(w, path, bind) {
    const parts = path.split('.');
    const filled = parts.map((p) => {
      if (p.length > 2 && p[0] === '<' && p[p.length - 1] === '>') {
        const name = p.slice(1, -1);
        return bind && bind[name] !== undefined ? bind[name] : p;
      }
      return p;
    });
    if (filled.some((p) => String(p)[0] === '<')) return undefined;

    if (filled[0] === 'social' && filled[1] === 'pair' && filled.length === 5) {
      const S = w.state.social;
      if (!S || !S.ready || typeof S.readPair !== 'function') return undefined;
      const a = Number(filled[2]), b = Number(filled[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return undefined;
      const t = S.readPair(a, b);
      if (!t) return undefined;
      const v = t[filled[4]];
      return typeof v === 'number' ? v : undefined;
    }

    // Native: the running system publishes exactly this shape.
    const head = filled[0];
    if (head !== 'clock') {
      const st = w.state[head];
      if (st !== undefined) {
        const v = walk(st, filled, 1);
        if (v !== undefined) return v;
      }
    }

    // The director's binding table, which is the island's one place for these.
    if (N) {
      const v = N.resolve(path, bind);
      if (v !== undefined) return v;
    }

    return localBinding(w, filled);
  }

  /** One beat condition. `missing` means nothing publishes the number, which is not the same as false. */
  function testRequire(w, th, cond) {
    const bind = bindFor(w, th);
    // The shape operators need a history of the number. The director already holds one for every
    // path its own table supplies, so those go back through it rather than being answered twice
    // from two different histories of the same reading.
    if (SERIES_OPS[cond.op] && N && typeof N.test === 'function') {
      const r = N.test(cond, bind);
      if (!r.missing) return { pass: !!r.pass, value: r.value, missing: false, path: cond.path };
      // The director cannot see it. If this file can, it keeps its own short history of that one.
      const v = resolve(w, cond.path, bind);
      if (v === undefined) return { pass: false, value: undefined, missing: true, path: cond.path };
      const key = cond.path.replace(/<(\w+)>/g, (m, n) => (bind && bind[n]) || n);
      return { pass: shapeTest(cond.op, key, w.clock.dayIndex, v, cond.value), value: v, missing: false, path: cond.path };
    }
    const v = resolve(w, cond.path, bind);
    if (v === undefined) return { pass: false, value: undefined, missing: true, path: cond.path };
    return { pass: compare(cond.op, v, cond.value), value: v, missing: false, path: cond.path };
  }

  /* -------------------------------------------------------------- casting */

  function castMembers(th) {
    return Object.keys(th.cast || {}).map((k) => th.cast[k]);
  }

  function primaries(th) {
    return castMembers(th).filter((c) => c.billing === 'primary' && c.personId);
  }

  /** The cast member behind a placeholder name. Never invents one. */
  function castFor(th, name) {
    const cast = th.cast || {};
    if (th.roleBind && th.roleBind[name] && cast[th.roleBind[name]]) return cast[th.roleBind[name]];
    const alias = ROLE_ALIASES[name];
    if (alias && cast[alias]) return cast[alias];
    const want = 'the-' + kebab(name);
    if (cast[want]) return cast[want];
    for (const k of Object.keys(cast)) if (k.indexOf(want) === 0) return cast[k];
    const stem = kebab(name);
    for (const k of Object.keys(cast)) if (k.indexOf(stem) >= 0) return cast[k];
    return null;
  }

  /**
   * The bind a beat's requires are resolved against: the trigger's own placeholders, plus every
   * people-shaped placeholder resolved to a real resident id. Pair paths are ordered low id first,
   * because that is how social.js stores them.
   */
  function bindFor(w, th) {
    const cached = bindCache.get(th.id);
    if (cached && cached.day === w.clock.dayIndex) return cached.bind;
    const bind = Object.assign({}, th.bind || {});
    const seed = N && N.seedOf(th.seedId);
    const names = new Set();
    for (const b of (seed && seed.beats) || []) {
      for (const r of b.requires || []) {
        const m = String(r.path).match(/<(\w+)>/g);
        if (m) for (const t of m) names.add(t.slice(1, -1));
      }
    }
    const people = [];
    for (const n of names) {
      if (bind[n] !== undefined) continue;
      const c = castFor(th, n);
      if (c && c.personId) { bind[n] = c.personId; people.push(n); }
    }
    // Two placeholders that resolved to the same person are not a pair. Push the second onto a
    // different primary rather than testing somebody's relationship with themselves.
    const seen = new Map();
    for (const n of people) {
      const id = bind[n];
      if (!seen.has(id)) { seen.set(id, n); continue; }
      const other = primaries(th).find((p) => p.personId !== id);
      if (other) bind[n] = other.personId;
    }
    bindCache.set(th.id, { day: w.clock.dayIndex, bind });
    return bind;
  }

  /* -------------------------------------------------------------- pacing

  The pack's silence rule: a beat does not have to fire on the day it becomes eligible, and should
  not, because things landing on consecutive days reads as a script. The gap comes from the beat
  grammar's own typical length for that stage, scaled so a seed the pack says runs for four months
  is not over in a week. */

  function gapAfter(seed, beat) {
    const L = stageLengths.get(beat.stage) || [0, 1];
    const typical = (seed.duration_sim_days && seed.duration_sim_days.typical) || 3;
    const scale = clamp(typical / Math.max(1, stageTotal), 0.02, 8);
    const raw = rng.range(L[0], L[1] + 0.999) * scale;
    const cap = (seed.duration_sim_days && seed.duration_sim_days.max) || 30;
    return clamp(Math.round(raw), 0, cap);
  }

  /* -------------------------------------------------------------- the four channels */

  function tieBetween(w, a, b) {
    const S = w.state.social;
    if (!S || !S.pair) return null;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const row = S.pair[lo];
    return row ? row[hi] || null : null;
  }

  /**
   * Apply one of the pack's named change rules to a pair. Never sets a value; adds the pack's own
   * delta and writes the rule id into the tie's history so the reason is inspectable, which is the
   * relationship_model's first hard rule.
   */
  function applyRule(w, ruleId, a, b, note) {
    if (!a || !b || a === b) return false;
    const nums = ruleNumbers.get(ruleId);
    if (!nums) return false;
    const shape = RULE_SHAPE[ruleId] || {};
    const tie = tieBetween(w, a, b);
    const day = w.clock.dayIndex;

    // Obligation is the narrative's own currency as well as social.js's, and the director casts on
    // it. It is recorded there whether or not social.js has a tie for the pair, because a favour
    // does not stop being owed just because two people have not been logged as meeting. The pack's
    // direction: positive means the first named owes the second, so the receiver of a favour owes
    // the person who did it.
    if (nums.obligation && N && typeof N.noteLedger === 'function') N.noteLedger(b, a, nums.obligation);
    if (shape.towardZero === 'obligation' && N && typeof N.ledgerFor === 'function') {
      const owed = N.ledgerFor(a, b);
      if (owed) N.noteLedger(a, b, -Math.sign(owed) * Math.min(Math.abs(owed), Math.abs(nums.obligation || 0.25)));
    }

    const rec = { day, date: w.clock.formatDate(), rule: ruleId, a, b, note: note || '', landed: !!tie };
    state.relationships.unshift(rec);
    if (state.relationships.length > 40) state.relationships.pop();

    if (!tie) {
      pendingTies.push({ ruleId, a, b, note, day });
      if (pendingTies.length > 80) pendingTies.shift();
      w.bus.emit('narrative:relationship', { rule: ruleId, a, b, note: note || '', applied: false });
      return false;
    }
    landOn(w, tie, ruleId, nums, shape, a, b, note);
    return true;
  }

  function landOn(w, tie, ruleId, nums, shape, a, b, note) {
    const bump = (dim, delta) => {
      if (!delta) return;
      const lo = dim === 'friction' || dim === 'familiarity' ? 0 : -1;
      tie[dim] = clamp((tie[dim] || 0) + delta, lo, 1);
    };
    if (shape.asymmetric === 'long-term-side') {
      // The pack is deliberately one-sided here: friction lands on both, the loss of trust lands
      // only on the household that has been here longer. That is the actual shape of the argument.
      bump('friction', nums.friction);
      const R = w.residents;
      const pa = R && R.peopleById.get(a);
      const pb = R && R.peopleById.get(b);
      const longer = pa && pb && pa.yearsOnIsland >= pb.yearsOnIsland ? a : b;
      if (nums.trust && longer) bump('trust', nums.trust);
      bump('familiarity', nums.familiarity);
    } else if (shape.receiverGets === 'obligation') {
      // Positive obligation means the low id owes the high id, which is how social.js stores it.
      const sign = b < a ? 1 : -1;
      bump('obligation', (nums.obligation || 0) * sign);
      bump('trust', nums.trust);
      bump('familiarity', nums.familiarity);
      bump('friction', nums.friction);
    } else if (shape.towardZero === 'obligation') {
      const o = tie.obligation || 0;
      if (o) tie.obligation = o - Math.sign(o) * Math.min(Math.abs(o), Math.abs(nums.obligation || 0.25));
      bump('trust', nums.trust);
    } else {
      bump('trust', nums.trust);
      bump('familiarity', nums.familiarity);
      bump('friction', nums.friction);
      bump('obligation', nums.obligation);
    }
    tie.lastSeen = w.clock.tick;
    if (!Array.isArray(tie.history)) tie.history = [];
    const text = note || ruleId.replace(/-/g, ' ');
    const last = tie.history[tie.history.length - 1];
    if (!last || last.text !== text) {
      tie.history.push({ tick: w.clock.tick, text });
      if (tie.history.length > 4) tie.history.shift();
    }
    w.bus.emit('narrative:relationship', { rule: ruleId, a, b, note: note || '', applied: true });
  }

  /** Retry the changes that had nowhere to land. Once a day, cheap, and it gives up after a month. */
  function retryPending(w) {
    if (!pendingTies.length) return;
    const day = w.clock.dayIndex;
    for (let i = pendingTies.length - 1; i >= 0; i--) {
      const p = pendingTies[i];
      if (day - p.day > PENDING_TIE_DAYS) { pendingTies.splice(i, 1); continue; }
      const tie = tieBetween(w, p.a, p.b);
      if (!tie) continue;
      const nums = ruleNumbers.get(p.ruleId);
      if (nums) landOn(w, tie, p.ruleId, nums, RULE_SHAPE[p.ruleId] || {}, p.a, p.b, p.note);
      pendingTies.splice(i, 1);
    }
  }

  /** A group mood delta. sentiment.js has no channel for the narrative yet, so it is kept here.
   *
   *  The delta is coerced rather than trusted. Five coda beats in data/narrative.json carry
   *  `"delta": "computed"`, meaning the pack wanted the coda's mood shift derived from how the
   *  thread actually went. Nothing derives it. Adding a string to a number here produced a string,
   *  clamp compared it without complaint, and the first `.toFixed` on it threw: over a sim-year
   *  that killed this whole system, and the world's own guard then disabled it for the rest of the
   *  run, so a year had no storylines in it at all after roughly day 90. Unresolvable deltas are
   *  now counted and named in describe() instead, so the gap stays visible without taking the
   *  narrative down with it. */
  function noteSentiment(w, group, delta, cause) {
    if (!group) return;
    const d = typeof delta === 'number' ? delta : Number(delta);
    if (!Number.isFinite(d) || d === 0) {
      if (delta !== 0 && delta !== undefined && delta !== null) {
        const k = String(group) + ':' + String(delta);
        unresolvedSets.set(k, (unresolvedSets.get(k) || 0) + 1);
      }
      return;
    }
    delta = d;
    const key = group;
    const row = sentimentOwed.get(key) || { group, delta: 0, causes: [], since: w.clock.formatDate() };
    row.delta = clamp(row.delta + delta, -0.6, 0.6);
    if (cause && row.causes.length < 4 && !row.causes.includes(cause)) row.causes.push(cause);
    sentimentOwed.set(key, row);
    w.bus.emit('narrative:sentiment', { group, delta, cause: cause || '' });
  }

  /** A real policy metric, on the channel policy.js already consumes. */
  function nudgeMetric(w, metric, delta, reason) {
    const M = w.state.policy && w.state.policy.metrics;
    if (!M || !M[metric] || !delta) return;
    w.bus.emit('civic:metric-nudge', {
      metric, delta: clamp(delta, -0.2, 0.2), reason,
      source: 'narrative/storylines.js', halfLifeDays: 200
    });
    state.metricNudges++;
  }

  /** Apply a beat's `sets` list across the four channels the pack allows and no others. */
  function applySets(w, th, seed, beat) {
    const bind = bindFor(w, th);
    const note = `${seed.title}: ${beat.name}`;
    for (const s of beat.sets || []) {
      if (s.channel === 'own') {
        if (s.key) th.vars[String(s.key).replace(/^thread\./, '')] = ownValue(w, th, s);
      } else if (s.channel === 'sentiment') {
        noteSentiment(w, s.group, s.delta, note);
      } else if (s.channel === 'intent') {
        w.bus.emit('narrative:intent', {
          kind: s.kind, threadId: th.id, seedId: th.seedId, lever: s.lever || null,
          issue: s.issue || null, township: th.township, note: s.note || ''
        });
      } else if (s.channel === 'social') {
        applySocialSet(w, th, s, bind, note);
      }
    }
  }

  function ownValue(w, th, s) {
    // The pack writes the shape it wants, not a value: "number", "id", "boolean", "computed from
    // queue". Where the island can answer it, it is answered from published state; where it cannot,
    // the flag is set true and nothing pretends to a figure.
    const key = String(s.key || '');
    if (/stuckParty/.test(key)) {
      const f = w.state.ferry;
      return f && f.toondah ? f.toondah.inYard : true;
    }
    if (/LateMin|Late$/.test(key)) {
      const f = w.state.ferry;
      const late = f && f.reliability ? f.reliability.delayMinNow : 0;
      return Math.max(15, Math.round(late || 0) + 15);
    }
    if (s.value === 'boolean') return true;
    if (s.value === 'number') return 1;
    return s.value === undefined ? true : s.value;
  }

  function applySocialSet(w, th, s, bind, note) {
    const rule = s.rule;
    if (!rule || !ruleNumbers.has(rule)) return;
    const shape = RULE_SHAPE[rule] || {};
    const idOf = (token) => {
      if (!token) return null;
      const name = String(token).replace(/^<|>$/g, '');
      if (bind[name] !== undefined) return bind[name];
      const c = castFor(th, name);
      return c && c.personId ? c.personId : null;
    };
    const prim = primaries(th);

    if (shape.pairs === 'from-to' && (s.from || s.to)) {
      const a = idOf(s.from) || (prim[0] && prim[0].personId);
      const b = idOf(s.to) || (prim[1] && prim[1].personId);
      applyRule(w, rule, a, b, note);
      return;
    }
    if (shape.pairs === 'between' && Array.isArray(s.between)) {
      applyRule(w, rule, idOf(s.between[0]) || (prim[0] && prim[0].personId),
        idOf(s.between[1]) || (prim[1] && prim[1].personId), note);
      return;
    }
    if (shape.pairs === 'others-to-one') {
      const on = idOf(s.on) || (prim[0] && prim[0].personId);
      if (!on) return;
      for (const c of castMembers(th)) {
        if (!c.personId || c.personId === on) continue;
        applyRule(w, rule, c.personId, on, note);
      }
      // The pack's own second half of left-holding-it: the person who carried it gains fatigue.
      if (shape.fatigue) w.bus.emit('narrative:intent', { kind: 'agent:fatigue', personId: on, amount: 0.12, threadId: th.id, note });
      return;
    }
    if (shape.pairs === 'newcomer-to-township') {
      const R = w.residents;
      const newcomerCast = castMembers(th).find((c) => c.newcomer && c.personId)
        || castMembers(th).find((c) => c.personId);
      if (!newcomerCast || !R) return;
      let applied = 0;
      for (const c of castMembers(th)) {
        if (!c.personId || c.personId === newcomerCast.personId) continue;
        const p = R.peopleById.get(c.personId);
        if (!p || p.yearsOnIsland < 3) continue;
        applyRule(w, rule, newcomerCast.personId, c.personId, note);
        if (++applied >= 4) break;
      }
      return;
    }
    // all-acted, and anything without an explicit pair: every primary pairing in the thread.
    const acted = prim.length >= 2 ? prim : castMembers(th).filter((c) => c.personId).slice(0, 3);
    for (let i = 0; i < acted.length; i++) {
      for (let j = i + 1; j < acted.length; j++) applyRule(w, rule, acted[i].personId, acted[j].personId, note);
    }
  }

  /** The branch option's own effect list, where it names a real policy metric. */
  function applyOptionEffects(w, th, option, seed) {
    for (const e of option.effects || []) {
      const m = String(e).match(/^([a-z_]+)\s+([+-]\d*\.?\d+)$/);
      if (m) { nudgeMetric(w, m[1], Number(m[2]), `${seed.title}: ${option.label}`); continue; }
      const s = String(e).match(/^sentiment\.([a-z-]+)\s+([+-]\d*\.?\d+)$/);
      if (s) noteSentiment(w, s[1], Number(s[2]), `${seed.title}: ${option.label}`);
    }
  }

  /** The ending's own change list, same rules. */
  function applyEndingChanges(w, th, ending, seed) {
    for (const c of ending.changes || []) {
      const m = String(c).match(/^([a-z_]+)\s+([+-]\d*\.?\d+)$/);
      if (m) { nudgeMetric(w, m[1], Number(m[2]), `${seed.title}: ${ending.label}`); continue; }
      const s = String(c).match(/^sentiment\.([a-z-]+)\s+([+-]\d*\.?\d+)$/);
      if (s) noteSentiment(w, s[1], Number(s[2]), `${seed.title}: ${ending.label}`);
    }
  }

  /* -------------------------------------------------------------- the branch */

  function gateOpen(w, th, option) {
    for (const e of option.effects || []) {
      const m = String(e).match(GATE_RE);
      if (!m) continue;
      const path = m[1];
      const want = Number(m[3]);
      let v;
      if (/^(trust|familiarity|obligation|friction)$/i.test(path)) {
        const prim = primaries(th);
        if (prim.length < 2) return true;
        v = resolve(w, `social.pair.${prim[0].personId}.${prim[1].personId}.${path.toLowerCase()}`, {});
      } else {
        v = resolve(w, path, bindFor(w, th));
      }
      if (v === undefined) continue;   // a gate nobody can answer does not close the door
      if (!compare(m[2], v, want)) return false;
    }
    return true;
  }

  /**
   * Weight an option for a resident deciding it. Three things move it and all three are the island's
   * own: what the option leads to against what has been short lately, how much the cast already owes
   * each other, and whether the household can carry the cost.
   */
  function residentWeight(w, th, option, seed) {
    let weight = 1;
    if (option.leads_to === 'well') weight *= 1.15;
    if (option.leads_to === 'badly') weight *= 0.75;
    const prim = primaries(th);
    if (prim.length >= 2 && N && typeof N.ledgerFor === 'function') {
      const owed = Math.abs(N.ledgerFor(prim[0].personId, prim[1].personId))
        + Math.abs(N.ledgerFor(prim[1].personId, prim[0].personId));
      // Somebody who is already owed a favour is more likely to be the one who turns up again.
      if (owed > 0.1 && option.leads_to === 'well') weight *= 1 + clamp(owed, 0, 1);
    }
    // A newcomer household reads an option that means asking somebody for something as expensive.
    const newcomers = castMembers(th).filter((c) => c.newcomer).length;
    if (newcomers && /ask|neighbour|ring|borrow/i.test(option.label || '')) weight *= 0.7;
    // Cost words in the pack's own cost line: an option the pack calls guaranteed is the safe one.
    if (/nothing much|guaranteed/i.test(option.cost || '')) weight *= 1.2;
    if (/four hours|no guarantee|nobody/i.test(option.cost || '')) weight *= 0.8;
    void seed;
    return Math.max(0.05, weight);
  }

  function resolveBranch(w, th, seed, branch) {
    const options = (branch.options || []).filter((o) => gateOpen(w, th, o));
    const pool = options.length ? options : (branch.options || []);
    if (!pool.length) return null;
    let chosen;
    if (branch.who_decides === 'nobody') {
      // The weather and the timetable decide. No preference at all beyond what the gates allowed.
      chosen = pool[rng.int(0, pool.length)];
      state.stats.choices.nobody++;
    } else {
      chosen = rng.weighted(pool.map((o) => ({ o, weight: residentWeight(w, th, o, seed) })), (x) => x.weight).o;
      state.stats.choices.resident++;
    }
    return chosen;
  }

  function offerToPlayer(w, th, seed, branch) {
    const options = (branch.options || []).filter((o) => gateOpen(w, th, o));
    const pool = options.length ? options : (branch.options || []);
    th.choice = {
      threadId: th.id, seedId: seed.id, title: seed.title, question: branch.question,
      openedDay: w.clock.dayIndex,
      closesDay: w.clock.dayIndex + Math.min(PLAYER_WINDOW_DAYS, seed.patience_days || PLAYER_WINDOW_DAYS),
      options: pool.map((o) => ({ id: o.id, label: o.label, cost: o.cost }))
    };
    state.openChoice = th.choice;
    w.bus.emit('narrative:choice', th.choice);
  }

  /* -------------------------------------------------------------- beats */

  function fireBeat(w, th, seed, beat, evidence) {
    const day = w.clock.dayIndex;
    th.vars = th.vars || {};

    // The branch belongs to a beat. Resolve it before the beat is written, so what is written is
    // the branch that was actually taken.
    const branch = (seed.branches || []).find((b) => b.at_beat === beat.n);
    let option = null;
    if (branch && !th.branch) {
      if (branch.who_decides === 'player') {
        if (!th.choice) { offerToPlayer(w, th, seed, branch); return false; }
        if (th.choice.answeredId) {
          option = (branch.options || []).find((o) => o.id === th.choice.answeredId) || null;
          th.decidedBy = 'player';
          state.stats.choices.player++;
        } else if (day < th.choice.closesDay) {
          return false;                                   // still open, hold the beat
        } else {
          option = resolveBranch(w, th, seed, branch);     // no seed may require the player to act
          th.decidedBy = 'nobody-answered';
          state.stats.choices.timedOut++;
        }
        state.openChoice = null;
      } else {
        option = resolveBranch(w, th, seed, branch);
        th.decidedBy = branch.who_decides;
      }
      if (option) {
        th.branch = { id: option.id, label: option.label, cost: option.cost, leadsTo: option.leads_to, decidedBy: th.decidedBy };
        applyOptionEffects(w, th, option, seed);
        // One seed's later beats are about who did the asking. Bind it from the branch so the beat
        // reads the right pair rather than a default one.
        if (option.id === 'neighbour-asks') th.roleBind = Object.assign({}, th.roleBind, { asker: 'the-long-timer', dogOwner: 'the-newcomer' });
        if (option.id === 'newcomer-asks') th.roleBind = Object.assign({}, th.roleBind, { asker: 'the-newcomer', dogOwner: 'the-long-timer' });
        th._bindCache = null;
      }
    }

    applySets(w, th, seed, beat);

    const record = {
      n: beat.n, stage: beat.stage, name: beat.name, day, date: w.clock.formatDate(),
      evidence: evidence.slice(0, 3),
      branch: th.branch && branch ? th.branch : null
    };
    th.fired.push(record);
    th.beatIndex++;
    th.waitingFor = null;
    th.waiting = false;
    th.waitingSinceDay = day;
    th.holdUntilDay = day + gapAfter(seed, beat);

    state.stats.fired++;
    state.stats.byStage[beat.stage] = (state.stats.byStage[beat.stage] || 0) + 1;
    state.lastBeat = { thread: th.id, seed: seed.id, stage: beat.stage, name: beat.name, date: record.date };

    if (N && typeof N.noteBeat === 'function') N.noteBeat(th, record);

    // Everything the chronicle needs to write the line, and everything a critic needs to check it.
    w.bus.emit('narrative:beat', {
      threadId: th.id, seedId: seed.id, title: seed.title, register: seed.register,
      township: th.township, n: beat.n, stage: beat.stage, name: beat.name,
      what: beat.what_happens, legible: beat.legible, chronicle: beat.chronicle,
      date: record.date, day,
      evidence: record.evidence,
      branch: record.branch,
      vars: Object.assign({}, th.vars),
      cast: castMembers(th).map((c) => ({
        role: c.role, billing: c.billing, kind: c.kind, name: c.name,
        personId: c.personId || null, householdId: c.householdId || null,
        township: c.township, occupation: c.occupation || null, newcomer: !!c.newcomer
      })),
      bind: bindFor(w, th)
    });
    return true;
  }

  function skipBeat(w, th, seed, beat, missing) {
    const day = w.clock.dayIndex;
    for (const p of missing) {
      let row = skipIndex.get(p);
      if (!row) skipIndex.set(p, (row = { path: p, seeds: [], beats: 0 }));
      row.beats++;
      if (row.seeds.length < 4 && !row.seeds.includes(seed.id)) row.seeds.push(seed.id);
    }
    th.skipped = th.skipped || [];
    th.skipped.push({ n: beat.n, stage: beat.stage, missing: missing.slice(0, 2) });
    th.beatIndex++;
    th.waitingFor = null;
    th.waiting = false;
    th.waitingSinceDay = day;
    th.holdUntilDay = day;
    state.stats.skipped++;
  }

  /* -------------------------------------------------------------- endings */

  function decideOutcome(w, th, seed) {
    if (th.outcome) return th.outcome;
    let outcome = th.branch && th.branch.leadsTo ? th.branch.leadsTo : null;
    const test = ENDING_TESTS[seed.id];
    if (test) {
      try {
        const forced = test(w);
        if (forced) outcome = forced;
      } catch (e) { /* a bad test must not stop the story ending */ }
    }
    if (!outcome) {
      // No branch and nothing checkable: the pack's own ratio decides, weighted by what has been
      // short of late rather than by a fixed roll. Unresolved is not in here because unresolved is
      // written by the fizzle rule and never chosen.
      const want = { well: 0.375, badly: 0.1875, quietly: 0.4375 };
      const have = state.stats.byOutcome;
      const total = Math.max(1, (have.well || 0) + (have.badly || 0) + (have.quietly || 0));
      const rows = Object.keys(want).map((k) => ({ k, weight: Math.max(0.05, want[k] - (have[k] || 0) / total + 0.15) }));
      outcome = rng.weighted(rows, (r) => r.weight).k;
    }
    if (!seed.endings || !seed.endings[outcome]) outcome = seed.endings && seed.endings.quietly ? 'quietly' : outcome;
    return outcome;
  }

  function endThread(w, th, seed, outcome, reason) {
    const day = w.clock.dayIndex;
    th.outcome = outcome;
    th.closedDay = day;
    th.closedDate = w.clock.formatDate();
    const ending = (seed.endings && seed.endings[outcome]) || null;
    if (ending) applyEndingChanges(w, th, ending, seed);

    // The pack's own coda rule: the thread's last act is the relationship, and it survives the
    // thread. Every thread that got past its complication leaves one, so the island remembers.
    if (outcome !== 'unresolved' && th.fired.length >= 3) {
      const prim = primaries(th);
      if (prim.length >= 2) {
        const rule = outcome === 'badly' ? 'public-disagreement' : 'shared-load';
        applyRule(w, rule, prim[0].personId, prim[1].personId, `${seed.title}: ${ending ? ending.label : outcome}`);
      }
    }

    state.stats.closed++;
    state.stats.byOutcome[outcome] = (state.stats.byOutcome[outcome] || 0) + 1;
    if (outcome === 'unresolved') state.stats.fizzled++;
    if (state.openChoice && state.openChoice.threadId === th.id) state.openChoice = null;

    w.bus.emit('narrative:thread-close', {
      threadId: th.id, seedId: seed.id, title: seed.title, register: seed.register,
      township: th.township, outcome,
      label: ending ? ending.label : (outcome === 'unresolved' ? 'Left open' : outcome),
      chronicle: ending ? ending.chronicle : null,
      reason: reason || null,
      openedDate: th.openedDate, closedDate: th.closedDate,
      days: day - th.openedDay,
      beats: th.fired.length,
      skipped: (th.skipped || []).length,
      branch: th.branch || null,
      cast: castMembers(th).map((c) => ({
        role: c.role, billing: c.billing, name: c.name,
        personId: c.personId || null, householdId: c.householdId || null
      }))
    });
    if (N && typeof N.noteClose === 'function') N.noteClose(th);
  }

  /* -------------------------------------------------------------- one thread, one step */

  function stepThread(w, th) {
    const day = w.clock.dayIndex;
    const seed = N.seedOf(th.seedId);
    if (!seed) return;
    if (th.outcome) return;

    if (th.beatIndex >= (seed.beats || []).length) {
      endThread(w, th, seed, decideOutcome(w, th, seed), null);
      return;
    }
    if (day < (th.holdUntilDay === undefined ? day : th.holdUntilDay)) return;

    const beat = seed.beats[th.beatIndex];
    const req = beat.requires || [];
    const missing = [];
    const evidence = [];
    let failed = null;

    for (const c of req) {
      const r = testRequire(w, th, c);
      if (r.missing) { if (!missing.includes(r.path)) missing.push(r.path); continue; }
      if (!r.pass) { failed = { path: r.path, op: c.op, want: c.value, have: r.value, note: c.note || '' }; break; }
      evidence.push({ path: r.path, op: c.op, want: c.value, value: r.value, note: c.note || '' });
    }

    // Nothing publishes one of the numbers this beat stands on. It is not written.
    if (missing.length) { skipBeat(w, th, seed, beat, missing); return; }

    if (failed) {
      if (!th.waiting) { th.waiting = true; state.stats.waited++; }
      th.waitingFor = failed;
      if (th.waitingSinceDay === undefined || th.waitingSinceDay === null) th.waitingSinceDay = day;
      const patience = seed.patience_days || 7;
      if (day - th.waitingSinceDay > patience) {
        if (seed.may_fizzle) {
          endThread(w, th, seed, 'unresolved',
            `waited ${day - th.waitingSinceDay} days for ${failed.path} and it did not come`);
        } else {
          // The state that opened this one cannot un-happen, so the story goes on without the beat.
          skipBeat(w, th, seed, beat, ['waited past patience for ' + failed.path]);
        }
      }
      return;
    }

    if (fireBeat(w, th, seed, beat, evidence)) {
      if (th.beatIndex >= seed.beats.length) endThread(w, th, seed, decideOutcome(w, th, seed), null);
    }
  }

  /* -------------------------------------------------------------- read model */

  function publishRunning(w) {
    const threads = N && typeof N.threads === 'function' ? N.threads() : [];
    const live = new Set(threads.map((t) => t.id));
    for (const id of Array.from(bindCache.keys())) if (!live.has(id)) bindCache.delete(id);
    const open = threads.find((t) => t.choice && !t.choice.answeredId && w.clock.dayIndex < t.choice.closesDay);
    state.openChoice = open ? open.choice : null;
    state.running = threads.map((t) => {
      const seed = N.seedOf(t.seedId);
      const beat = seed && seed.beats ? seed.beats[t.beatIndex] : null;
      return {
        id: t.id, seedId: t.seedId, title: t.title, register: t.register, township: t.township,
        beat: t.beatIndex, next: beat ? { n: beat.n, stage: beat.stage, name: beat.name } : null,
        firedStages: (t.fired || []).map((f) => f.stage),
        skipped: (t.skipped || []).length,
        holdsUntilInDays: Math.max(0, (t.holdUntilDay || 0) - w.clock.dayIndex),
        waitingFor: t.waitingFor || null,
        branch: t.branch || null,
        choiceOpen: !!(t.choice && !t.choice.answeredId && w.clock.dayIndex < t.choice.closesDay),
        cast: Object.keys(t.cast || {}).map((k) => ({
          role: t.cast[k].role, billing: t.cast[k].billing, name: t.cast[k].name,
          personId: t.cast[k].personId || null, householdId: t.cast[k].householdId || null
        }))
      };
    });
    state.skipped = Array.from(skipIndex.values()).sort((a, b) => b.beats - a.beats).slice(0, 12);
    state.sentimentOwed = Array.from(sentimentOwed.values())
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10)
      .map((r) => ({ group: r.group, delta: +Number(r.delta || 0).toFixed(3), causes: r.causes.slice(0, 2), since: r.since }));
    state.unresolvedSets = Array.from(unresolvedSets.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, n]) => ({ set: k, times: n }));
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'storylines',
    phase: 'narrative',
    order: 20,

    init(w) {
      N = directorState(w);
      if (!N) {
        state.notes.push('The director is not loaded, so no thread will ever be walked.');
        return;
      }
      const pack = w.data.narrative;
      if (!pack) {
        state.notes.push('data/narrative.json is missing.');
        return;
      }

      // The rules' numbers come out of the pack's own effect sentences, so they cannot drift.
      let parsed = 0;
      for (const r of (pack.relationship_model && pack.relationship_model.change_rules) || []) {
        const nums = parseEffect(r.effect);
        if (Object.keys(nums).length) parsed++;
        ruleNumbers.set(r.id, nums);
      }

      // And the pacing comes out of the beat grammar's own stage lengths.
      let mid = 0;
      for (const s of (pack.beat_grammar && pack.beat_grammar.stages) || []) {
        const L = Array.isArray(s.typical_length_days) ? s.typical_length_days : [0, 1];
        stageLengths.set(s.id, L);
        mid += (L[0] + L[1]) / 2;
      }
      stageTotal = mid || 26;

      state.bindings = Object.keys(LOCAL_BINDINGS).sort().map((p) => ({
        path: p, kind: LOCAL_BINDINGS[p].kind, why: LOCAL_BINDINGS[p].why
      }));

      // Things that happen rather than things that are, held for as long as the seed asks about.
      // The list only exists when its supplying system does, so a quiet week reads as a quiet week
      // and an unbuilt system reads as an unbuilt system.
      for (const type of Object.keys(COLLECTED)) {
        const spec = COLLECTED[type];
        if (!w.state[spec.from]) continue;
        collected.set(spec.key, []);
        w.bus.on(type, (p) => C.push(spec.key, w.clock.dayIndex, p || {}));
      }

      // The player answering a branch. It is a real setting on a real thread, and it is the only
      // thing outside this file that can change what a story does.
      w.bus.on('ui:intent', (p) => {
        if (!p || p.kind !== 'narrative:choose') return;
        const threads = typeof N.threads === 'function' ? N.threads() : [];
        const th = threads.find((t) => t.id === p.threadId);
        if (!th || !th.choice || th.choice.answeredId) return;
        if (!th.choice.options.some((o) => o.id === p.optionId)) return;
        th.choice.answeredId = p.optionId;
        th.holdUntilDay = w.clock.dayIndex;
        w.bus.emit('narrative:choice-made', { threadId: th.id, optionId: p.optionId, by: 'player' });
      });

      state.ready = true;
      state.notes.push(`${parsed} of the pack's ${ruleNumbers.size} relationship rules carry numbers, `
        + `parsed from their own effect text. ${state.bindings.length} local state bindings fill the `
        + 'gaps the director\'s table leaves, and every one of them is listed in describe().bindings.');
    },

    tick(w) {
      if (!state.ready) return;
      const t = w.clock.tick;
      if (t === lastStepTick || t % STEP_TICKS !== 0) return;
      lastStepTick = t;

      const threads = typeof N.threads === 'function' ? N.threads() : [];
      // A copy: endThread removes the thread from the director's array mid-walk.
      for (const th of threads.slice()) {
        try { stepThread(w, th); } catch (e) {
          // A story that throws closes rather than being allowed to jam the queue behind it.
          const seed = N.seedOf(th.seedId);
          state.notes.push(`thread ${th.id} (${th.seedId}) failed: ${e && e.message}`);
          if (seed) { try { endThread(w, th, seed, 'unresolved', 'the beat failed to run'); } catch (e2) { /* */ } }
        }
      }

      if (w.clock.minuteOfDay === 0) retryPending(w);
      publishRunning(w);
    },

    describe(w) {
      void w;
      return {
        ready: state.ready,
        open: state.running.length,
        fired: state.stats.fired,
        skipped: state.stats.skipped,
        closed: state.stats.closed,
        fizzled: state.stats.fizzled,
        byStage: state.stats.byStage,
        byOutcome: state.stats.byOutcome,
        choices: state.stats.choices,
        metricNudges: state.metricNudges,
        relationshipsApplied: state.relationships.filter((r) => r.landed).length,
        relationshipsPending: pendingTies.length,
        sentimentOwed: state.sentimentOwed.length,
        unresolvedSets: state.unresolvedSets.length,
        skippedPaths: state.skipped.map((s) => s.path),
        threads: state.running.map((r) => ({
          seed: r.seedId, beat: r.beat, next: r.next ? r.next.stage : 'done',
          waitingFor: r.waitingFor ? r.waitingFor.path : null,
          choiceOpen: r.choiceOpen
        }))
      };
    },

    save() {
      return {
        v: 1,
        stats: state.stats,
        relationships: state.relationships.slice(0, 20),
        pendingTies: pendingTies.slice(-40),
        skipIndex: Array.from(skipIndex.values()),
        sentimentOwed: Array.from(sentimentOwed.values()),
        metricNudges: state.metricNudges
      };
    },

    load(w, s) {
      if (!s) return;
      if (s.stats) state.stats = s.stats;
      state.relationships = s.relationships || [];
      pendingTies.length = 0;
      for (const p of s.pendingTies || []) pendingTies.push(p);
      skipIndex.clear();
      for (const r of s.skipIndex || []) skipIndex.set(r.path, r);
      sentimentOwed.clear();
      for (const r of s.sentimentOwed || []) sentimentOwed.set(r.group, r);
      state.metricNudges = s.metricNudges || 0;
      publishRunning(w);
    }
  });
}
