// Weather. A subtropical east-coast island: it is nearly always fine, and the exceptions matter
// enormously. Sea breeze, southerly change, summer storm cells, east coast lows, and the swell
// that decides whether the Gorge is spectacular or closed.
//
// ==============================================================================================
// TWO WEATHERS, RANKED, RESOLVED ONE FIELD AT A TIME
// ==============================================================================================
//
// The synoptic state machine below is a Markov-ish model driving continuous fields, and it is the
// only thing here that can answer for a moment that has not happened. It stays. What it stopped
// being, in this pass, is the only answer.
//
//   "It is not much of a twin if the weather is not real."
//
// That is the correction this file was rebuilt around, and it is right. A twin of a real island,
// opened live, showing invented weather is a demonstration wearing a twin's clothes. So when the
// clock declares live, every field this island publishes is resolved against the source ladder in
// `docs/CONNECTORS.md`, which is implemented once in `src/world/observations.js`:
//
//   1  island instrument      a station or gauge at a real place here          not built yet
//   2  official observation   a measured station reading via a public service  not built yet
//   3  model                  Open-Meteo, CC BY 4.0, model output              built
//   4  synoptic simulation    the state machine in this file                   the floor
//
// PER FIELD, NOT PER SOURCE. A station on the surf club roof will have wind and no swell. The wind
// then comes off rung one and the swell off rung three and each number says which, because one
// source line over a mixed panel is a lie of omission.
//
// FRESHNESS DEMOTES, and it does so through the shelf lives in `src/world/freshness.js` rather than
// through a rule of its own. Rain is worthless at half an hour old and temperature is fine at two
// hours, so an ageing rain reading falls out of the ladder while the temperature beside it holds.
//
// RUNG FOUR NEVER WINS IN LIVE MODE, and this is the hard one, so read the next paragraph before
// changing anything here. If no real reading is current for a field while the clock says live, the
// honest answer is that the twin does not know, and that field's name goes on `notKnown` for the
// interface to draw as not known rather than as a number. The number itself does not disappear,
// because the island cannot stop living: the dunes, the fire index, the ferry and the koalas all
// need a wind speed to keep running, and pausing the island because a feed went stale would be a
// worse falsehood than the one being avoided. So rung four keeps the island alive and is never
// offered as an answer about the real island. `knows(field)` is how a panel asks, and every surface
// drawing one of these numbers has to.
//
// DETERMINISM IS UNAFFECTED, and that is checkable rather than asserted. Every branch below is
// gated on `declaredMode === 'live'`. A seeded run is simulated, resolves nothing, allocates
// nothing, consumes the random stream in exactly the order it always did, and produces exactly the
// numbers it always produced. `describe()` gains a key only when a real reading is actually in use,
// so the determinism fingerprint is the same one it was before this file changed.

import { resolveObservations, ladderSentence, SOURCE_RUNGS, rungOf } from '../../world/observations.js';

/**
 * The fields a real source can answer for, and therefore the fields the ladder governs. Everything
 * else this system publishes is derived from these, so it inherits their standing rather than
 * having one of its own: a fire danger index worked out from an observed temperature and an
 * observed wind is a modelled number resting on real inputs, and it says so that way round.
 */
const OBSERVABLE = [
  'tempC', 'apparentC', 'humidity', 'pressure', 'cloud', 'rainMmHr',
  'windKt', 'windDirDeg', 'gustKt',
  'swellM', 'swellPeriodS', 'swellDirDeg',
  'groundSwellM', 'groundSwellPeriodS', 'groundSwellDirDeg'
];

export function registerWeather(world) {
  const rng = world.rng.stream('weather');

  const SYNOPTIC = {
    'ridge':        { label: 'High to the south, ridging',   rain: 0.02, cloud: 0.15, windDir: 110, windKt: 10, swell: 1.0, next: { ridge: .62, trough: .14, seabreeze: .18, southerly: .04, storm: .02 } },
    'seabreeze':    { label: 'Nor\'easter, sea breeze day',  rain: 0.03, cloud: 0.25, windDir: 60,  windKt: 14, swell: 1.1, next: { seabreeze: .5, ridge: .2, storm: .16, southerly: .1, trough: .04 } },
    'trough':       { label: 'Inland trough, humid',         rain: 0.18, cloud: 0.55, windDir: 340, windKt: 9,  swell: 1.0, next: { trough: .38, storm: .3, southerly: .16, ridge: .14, seabreeze: .02 } },
    'storm':        { label: 'Storms building west',         rain: 0.62, cloud: 0.8,  windDir: 300, windKt: 18, swell: 1.2, next: { storm: .28, southerly: .34, trough: .2, ridge: .18 } },
    'southerly':    { label: 'Southerly change through',     rain: 0.3,  cloud: 0.7,  windDir: 190, windKt: 22, swell: 2.0, next: { southerly: .4, ridge: .38, eastcoastlow: .06, trough: .16 } },
    'eastcoastlow': { label: 'East coast low offshore',      rain: 0.75, cloud: 0.95, windDir: 150, windKt: 32, swell: 4.0, next: { eastcoastlow: .48, southerly: .34, trough: .18 } },
    'westerly':     { label: 'Cold westerly, glassy surf',   rain: 0.02, cloud: 0.1,  windDir: 260, windKt: 15, swell: 1.4, next: { westerly: .45, ridge: .4, southerly: .15 } }
  };

  // Seasonal weighting: which synoptic patterns are plausible this month.
  const SEASON_BIAS = {
    // month index -> multipliers
    summer: { storm: 2.4, trough: 1.8, seabreeze: 1.6, westerly: 0.15, eastcoastlow: 0.8 },
    autumn: { seabreeze: 1.2, southerly: 1.3, eastcoastlow: 1.4, storm: 0.7, westerly: 0.5 },
    winter: { westerly: 2.6, ridge: 1.5, storm: 0.15, trough: 0.4, seabreeze: 0.4, eastcoastlow: 0.9 },
    spring: { seabreeze: 1.4, trough: 1.2, storm: 1.3, westerly: 0.6, ridge: 1.1 }
  };

  const SIM_RUNG = rungOf('synoptic-simulation');

  const state = world.publish('weather', {
    synoptic: 'ridge', label: '', hoursInState: 0,
    tempC: 22, apparentC: 22, humidity: 0.65, pressure: 1016,
    cloud: 0.2, rainMmHr: 0, rainToday: 0, rainWeek: 0,
    windKt: 10, windDirDeg: 110, gustKt: 14,
    swellM: 1.0, swellPeriodS: 9, swellDirDeg: 110, seaState: 'slight',
    // The long-period swell component, kept apart from the total sea rather than folded into it.
    // `swellM` is and always was the height of the sea on the ocean beaches, which is what shuts a
    // beach and shortens the drivable window. This is the ground swell underneath it, and it is
    // null until a real source answers for it, because this twin's own model does not produce one.
    groundSwellM: null, groundSwellPeriodS: null, groundSwellDirDeg: null,
    fireDangerIndex: 8, fireDangerLabel: 'Moderate',
    visibilityKm: 30, uvIndex: 6, dewPointC: 14,
    beachCondition: 'good', crossingCondition: 'good',

    // ---- where each number came from ------------------------------------------------------
    // `sourceRung` is the worst rung any published field is resting on, which is the honest
    // headline: a panel that said "island instrument" because one field of fifteen came off a mast
    // would be overstating. Read `fieldSource` for the per-field truth, which is the one that
    // matters and the one the interface has to draw.
    sourceRung: SIM_RUNG.rung,
    sourceLabel: SIM_RUNG.label,
    sourceNote: '',
    /** field -> { rung, rungLabel, provider, observedAt, ageMin, ago, freshness, measured }. */
    fieldSource: {},
    /** Fields with no current real reading while the clock is live. The twin does not know these. */
    notKnown: [],
    /** Attribution owed for what is actually on screen. A licence condition, not a courtesy. */
    attributions: [],
    /** The ladder itself, so a panel can explain it without restating it. */
    rungs: SOURCE_RUNGS,

    // The list of patterns this system knows, so that anything driving the weather from outside
    // (TWIN.setWeather, a scenario pack) can check a value against it rather than write a name
    // nothing recognises and take the whole system down at the next synoptic change.
    synoptics: Object.keys(SYNOPTIC),
    /**
     * Force a pattern, properly: the name, its label, the target it eases toward and the clock on
     * how long it holds. Returns false for a name this system does not know, so a caller can say
     * so rather than corrupt the state. TWIN.setWeather goes through here.
     *
     * Forcing also stands the ladder down until the pattern expires. Without that, forcing a storm
     * on a live island would set a synoptic target and then have every observable field overwritten
     * by the real reading on the very next tick, so the call would appear to do nothing. A forced
     * pattern is a deliberate act by somebody at a console and it wins, and while it holds the
     * source says simulation rather than pretending a real reading is still in force.
     */
    force: null,
    /** True while a pattern forced by hand is holding the ladder down. */
    forced: false,
    /**
     * Does this twin actually know this field right now? False means draw "not known", never the
     * number. In simulated and scrubbed time this is true for everything, because the island is
     * honestly answering for its own weather and saying so; it is only in live that a simulated
     * number would be a simulated number wearing a live badge.
     */
    knows: null
  });

  state.force = (id) => {
    if (!SYNOPTIC[id]) return false;
    state.synoptic = id;
    state.label = SYNOPTIC[id].label;
    target = { ...SYNOPTIC[id] };
    hoursLeft = 18;
    state.hoursInState = 0;
    state.forced = true;
    world.bus.emit('weather:change', { synoptic: id, label: state.label, forced: true });
    return true;
  };
  state.knows = (field) => !state.notKnown.includes(field);

  let target = { ...SYNOPTIC.ridge };
  let hoursLeft = 18;

  /* ---- the ladder ------------------------------------------------------------------------ */

  /** The feed records, read once at boot. The running twin never fetches; this is already on disk. */
  let sources = [];
  /** Memo, so the ladder is climbed once per moment rather than once per reader. */
  let resolvedAt = null;
  let resolved = { byField: {}, considered: {}, providers: [] };

  function loadSources(w) {
    sources = [];
    const feed = w.data && typeof w.data.feed === 'function' ? w.data.feed('weather') : null;
    if (feed && Array.isArray(feed.records)) sources = feed.records;
  }

  /**
   * Climb the ladder for this moment, or do nothing at all.
   *
   * The early return is not an optimisation, it is the determinism guarantee: in simulated and
   * scrubbed time this function allocates nothing, touches nothing and leaves every published field
   * exactly where the model put it. A scrubbed Tuesday has no observation and cannot have one, and
   * inventing a reading for it would be the precise thing this whole project exists not to do.
   */
  function climb(w) {
    const declared = w.clock && w.clock.declaredMode;
    if (declared !== 'live' || state.forced) {
      if (state.sourceRung !== SIM_RUNG.rung) resetToSimulation(declared);
      return null;
    }
    const iso = w.clock.formatISO();
    if (iso !== resolvedAt) {
      resolvedAt = iso;
      resolved = resolveObservations(sources, iso);
    }
    return resolved;
  }

  function resetToSimulation(declared) {
    state.sourceRung = SIM_RUNG.rung;
    state.sourceLabel = SIM_RUNG.label;
    state.fieldSource = {};
    state.notKnown = [];
    state.attributions = [];
    state.sourceNote = state.forced
      ? 'A weather pattern was forced by hand, so the island is running that pattern and no real reading is being applied.'
      : declared === 'scrub'
        ? 'This is a moment the island is not at, so its weather is the island\'s own model. Nothing can be observed about a moment that has not happened.'
        : 'The island is running its own seeded weather, which is what simulated time means.';
    resolvedAt = null;
  }

  /**
   * Put the winning reading into each field it won, and record what won and what did not.
   *
   * Returns the set of fields a real source answered for, which the derivation below reads so that
   * it does not overwrite an observed apparent temperature with a computed one.
   */
  function applyLadder(w, res) {
    const observed = new Set();
    if (!res) return observed;

    const fieldSource = {};
    const notKnown = [];
    let worst = 0;

    for (const field of OBSERVABLE) {
      const win = res.byField[field];
      if (win) {
        state[field] = win.value;
        observed.add(field);
        fieldSource[field] = {
          rung: win.rung,
          rungLabel: win.rungLabel,
          measured: win.measured,
          provider: win.provider,
          observedAt: win.observedAt,
          ageMin: win.ageMin,
          ago: win.ago,
          freshness: win.freshness,
          unit: win.unit
        };
        if (win.rung > worst) worst = win.rung;
        continue;
      }
      // Nothing real is current for this field. The model keeps producing a number so the island
      // keeps running, and the twin does not claim to know it.
      const tried = res.considered[field] || [];
      const best = tried.length ? tried.reduce((a, b) => ((a.ageMin ?? 1e9) <= (b.ageMin ?? 1e9) ? a : b)) : null;
      fieldSource[field] = {
        rung: SIM_RUNG.rung,
        rungLabel: SIM_RUNG.label,
        measured: false,
        provider: null,
        observedAt: null,
        ageMin: null,
        ago: null,
        freshness: 'unknown',
        why: best
          ? `The last real reading for this was ${best.ago} from ${best.rungLabel}, past the `
            + `${best.limitMin} minutes it may be believed for. ${best.why}`
          : 'No source on the ladder answers for this field yet.'
      };
      notKnown.push(field);
      worst = SIM_RUNG.rung;
    }

    // The ground swell trio is a special case worth naming rather than letting it read as a fault.
    // This twin's own model produces no ground swell at all, so when no real source answers for it
    // the honest value is null and the field is simply absent, not unknown-and-therefore-suspect.
    for (const f of ['groundSwellM', 'groundSwellPeriodS', 'groundSwellDirDeg']) {
      if (!observed.has(f)) state[f] = null;
    }

    state.fieldSource = fieldSource;
    state.notKnown = notKnown;
    state.sourceRung = worst || SIM_RUNG.rung;
    const entry = rungOf(state.sourceRung) || SIM_RUNG;
    state.sourceLabel = entry.label;
    state.attributions = res.providers.filter((p) => p.in_use);
    state.sourceNote = ladderSentence(res.byField, { declaredMode: 'live' })
      + (notKnown.length
        ? ` ${notKnown.length} of ${OBSERVABLE.length} have no current reading and are not claimed.`
        : '');
    return observed;
  }

  return world.register({
    id: 'weather',
    phase: 'environment',
    order: 20,

    init(w) {
      loadSources(w);
      state.label = SYNOPTIC[state.synoptic].label;
      resetToSimulation(w.clock && w.clock.declaredMode);
      step(w, true);
    },

    tick(w) { step(w, false); },

    describe() {
      const d = {
        synoptic: state.synoptic,
        tempC: +state.tempC.toFixed(1),
        windKt: +state.windKt.toFixed(0),
        windDirDeg: Math.round(state.windDirDeg),
        swellM: +state.swellM.toFixed(1),
        rainMmHr: +state.rainMmHr.toFixed(2),
        fire: state.fireDangerLabel
      };
      // Added only when a real reading is actually in force, which in a seeded run is never. That
      // is what keeps the determinism fingerprint the one it was before the ladder existed.
      if (state.sourceRung < SIM_RUNG.rung) {
        d.source = { rung: state.sourceRung, label: state.sourceLabel, notKnown: state.notKnown.length };
      }
      return d;
    },

    save() { return { synoptic: state.synoptic, hoursLeft, forced: state.forced, state: { ...state } }; },
    load(w, s) {
      if (s) {
        Object.assign(state, s.state);
        hoursLeft = s.hoursLeft;
        state.forced = s.forced === true;
        target = { ...SYNOPTIC[s.synoptic] };
        // Functions do not survive a JSON round trip, and a loaded save must not leave a panel
        // holding a state object whose `knows` is a string or undefined.
        state.knows = (field) => !state.notKnown.includes(field);
        resolvedAt = null;
        loadSources(w);
      }
    }
  });

  function step(w, immediate) {
    const dtH = 10 / 60;
    state.hoursInState += dtH;
    hoursLeft -= dtH;
    if (hoursLeft <= 0) {
      const season = w.clock.southernSeason;
      const next = pickNext(state.synoptic, season);
      state.synoptic = next;
      state.label = SYNOPTIC[next].label;
      target = { ...SYNOPTIC[next] };
      hoursLeft = rng.range(6, 40);
      state.hoursInState = 0;
      // A forced pattern lasts until it would have changed anyway, and then the ladder comes back.
      state.forced = false;
      w.bus.emit('weather:change', { synoptic: next, label: state.label });
    }

    stepModel(w, immediate);
    const observed = applyLadder(w, climb(w));
    derive(w, observed);
  }

  /**
   * The synoptic model. Unchanged from what it always was, line for line and in the same order,
   * because the random stream is consumed inside it and any reordering here would move every
   * seeded island ever produced. The only thing that left is the derivation, which is pure and now
   * runs after the ladder so that a real reading feeds the consequences rather than sitting beside
   * them: an observed 25 knot wind has to reach the fire index and the crossing, or the twin has
   * real weather on the dial and invented weather in the world.
   */
  function stepModel(w, immediate) {
    const k = immediate ? 1 : 0.035;
    const daylight = w.read('daylight');
    const doy = w.clock.dayOfYear;
    // Climatology: Point Lookout mean max ~28.6 Jan, ~20.6 Jul; mean min ~21.5 / ~11.9.
    const seasonal = Math.cos(((doy - 15) / 365) * 2 * Math.PI);
    const meanMax = 24.6 + 4.0 * seasonal;
    const meanMin = 16.7 + 4.8 * seasonal;
    const dayShape = daylight ? Math.max(0, Math.sin(Math.max(0, daylight.elevationDeg) * Math.PI / 140)) : 0.5;
    const cloudCool = state.cloud * 3.2;
    const baseTemp = meanMin + (meanMax - meanMin) * (0.15 + 0.85 * dayShape) - cloudCool;

    state.tempC += (baseTemp - state.tempC) * (immediate ? 1 : 0.08);
    state.cloud += (target.cloud + rng.range(-0.08, 0.08) - state.cloud) * k;
    state.cloud = Math.max(0, Math.min(1, state.cloud));

    // Sea breeze: onshore nor'easter builds from late morning, drops after sunset.
    let dirTarget = target.windDir;
    let ktTarget = target.windKt;
    const hour = w.clock.hour;
    if (state.synoptic === 'seabreeze' || state.synoptic === 'ridge') {
      if (hour >= 10 && hour <= 18) { ktTarget += 6 * Math.sin(((hour - 10) / 8) * Math.PI); dirTarget = 55; }
      else if (hour >= 20 || hour <= 6) { ktTarget *= 0.55; dirTarget = 240; } // light land breeze overnight
    }
    state.windKt += (ktTarget + rng.range(-2, 2) - state.windKt) * k;
    state.windKt = Math.max(0, state.windKt);
    let dd = ((dirTarget - state.windDirDeg + 540) % 360) - 180;
    state.windDirDeg = (state.windDirDeg + dd * k * 1.6 + 360) % 360;
    state.gustKt = state.windKt * (1.25 + state.cloud * 0.45);

    const raining = rng.float() < target.rain * (0.35 + state.cloud);
    state.rainMmHr += ((raining ? rng.range(0.4, target.rain * 26) : 0) - state.rainMmHr) * (raining ? 0.5 : 0.15);
    if (state.rainMmHr < 0.02) state.rainMmHr = 0;

    state.swellM += (target.swell * rng.range(0.85, 1.2) - state.swellM) * 0.02;

    state.humidity = Math.max(0.25, Math.min(0.99, 0.55 + state.cloud * 0.3 + (state.rainMmHr > 0 ? 0.2 : 0) + rng.range(-0.04, 0.04)));
    state.pressure += ((state.synoptic === 'eastcoastlow' ? 998 : state.synoptic === 'ridge' ? 1022 : 1013) - state.pressure) * 0.01;
  }

  /**
   * Everything that follows from the numbers above, whoever produced them. Pure: it consumes no
   * random stream and holds no accumulator that a second call would double, which is what lets it
   * run after the ladder has had its say.
   */
  function derive(w, observed) {
    const dtH = 10 / 60;

    state.rainToday += state.rainMmHr * dtH;
    state.rainWeek = state.rainWeek * 0.999 + state.rainMmHr * dtH;
    if (w.clock.minuteOfDay < 10) state.rainToday = 0;

    if (!observed.has('swellPeriodS')) state.swellPeriodS = 6 + state.swellM * 2.4;
    if (!observed.has('swellDirDeg')) {
      state.swellDirDeg = state.synoptic === 'southerly' || state.synoptic === 'eastcoastlow' ? 165 : 105;
    }
    state.seaState = state.swellM < 0.6 ? 'smooth' : state.swellM < 1.3 ? 'slight'
      : state.swellM < 2.5 ? 'moderate' : state.swellM < 4 ? 'rough' : 'very rough';

    state.dewPointC = state.tempC - (1 - state.humidity) * 20;
    if (!observed.has('apparentC')) {
      state.apparentC = state.tempC + 0.33 * (state.humidity * 6.105 * Math.exp(17.27 * state.tempC / (237.7 + state.tempC))) - 0.7 * (state.windKt * 0.514) - 4;
    }
    state.visibilityKm = state.rainMmHr > 4 ? 3 : state.rainMmHr > 0.5 ? 12 : 30 - state.humidity * 8;
    const daylight = w.read('daylight');
    state.uvIndex = daylight && daylight.elevationDeg > 0
      ? Math.max(0, (daylight.elevationDeg / 90) * 13 * (1 - state.cloud * 0.6)) : 0;

    // Fire danger. Dry westerlies over the heath behind Point Lookout are the real risk here.
    const drought = Math.max(0, 1 - state.rainWeek / 25);
    const ffdi = 2 * Math.exp(-0.45 + 0.987 * Math.log(Math.max(1, drought * 10))
      - 0.0345 * (state.humidity * 100) + 0.0338 * state.tempC + 0.0234 * (state.windKt * 1.852));
    state.fireDangerIndex = Math.min(120, ffdi);
    state.fireDangerLabel = ffdi < 12 ? 'Moderate' : ffdi < 24 ? 'High' : ffdi < 50 ? 'Extreme' : 'Catastrophic';

    state.beachCondition = state.swellM > 3 || state.windKt > 25 ? 'closed'
      : state.swellM > 2 ? 'hazardous' : state.rainMmHr > 2 ? 'poor' : state.windKt < 12 && state.cloud < 0.5 ? 'excellent' : 'good';

    // THE BAY CROSSING, AND WHAT THIS FIELD IS AND IS NOT.
    //
    // Wind against tide across the Rous is what stops the barges, and that is the whole of what
    // this number is: a statement about the water, from wind and tide, and no swell term, because
    // the crossing is entirely inside the bay and ocean swell is not a factor. docs/DATA-NOTES.md
    // records that as the one high-confidence thing known about this crossing's weather limits, and
    // every threshold below it is a modelling choice with no published figure behind it.
    //
    // It is NOT an answer to "can I get off the island", and nothing may draw it as one. On this
    // island those are two different questions with two different answers. You can get yourself
    // across on a passenger sailing during normal operating hours almost any day, so that question
    // is nearly always yes and is nearly never the useful one. Getting your VEHICLE across is the
    // one that fails, and at peak it fails on bookings rather than on weather: the vehicle ferries
    // book out. Weather can stop both and demand stops only one, so a rough bay and a booked-out
    // barge are separate facts and this field is only the first of them. The deck, the queue and
    // what is left for today belong to the ferry system, which owns them.
    const tide = w.read('tide');
    const windAgainstTide = tide && Math.abs(tide.rate) > 0.2 && state.windKt > 18 ? 1 : 0;
    state.crossingCondition = state.windKt > 30 ? 'cancelled' : state.windKt > 22 || windAgainstTide ? 'rough' : state.windKt > 15 ? 'choppy' : 'good';
  }

  function pickNext(current, season) {
    const table = SYNOPTIC[current].next;
    const bias = SEASON_BIAS[season] || {};
    const items = Object.entries(table).map(([k, p]) => ({ k, w: p * (bias[k] ?? 1) }));
    return rng.weighted(items, (i) => i.w).k;
  }
}
