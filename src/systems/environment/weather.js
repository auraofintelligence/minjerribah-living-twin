// Weather. A subtropical east-coast island: it is nearly always fine, and the exceptions matter
// enormously. Sea breeze, southerly change, summer storm cells, east coast lows, and the swell
// that decides whether the Gorge is spectacular or closed.
//
// This is a Markov-ish synoptic state machine driving continuous fields, not per-tick dice.

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

  const state = world.publish('weather', {
    synoptic: 'ridge', label: '', hoursInState: 0,
    tempC: 22, apparentC: 22, humidity: 0.65, pressure: 1016,
    cloud: 0.2, rainMmHr: 0, rainToday: 0, rainWeek: 0,
    windKt: 10, windDirDeg: 110, gustKt: 14,
    swellM: 1.0, swellPeriodS: 9, swellDirDeg: 110, seaState: 'slight',
    fireDangerIndex: 8, fireDangerLabel: 'Moderate',
    visibilityKm: 30, uvIndex: 6, dewPointC: 14,
    beachCondition: 'good', crossingCondition: 'good'
  });

  let target = { ...SYNOPTIC.ridge };
  let hoursLeft = 18;

  function pickNext(current, season) {
    const table = SYNOPTIC[current].next;
    const bias = SEASON_BIAS[season] || {};
    const items = Object.entries(table).map(([k, p]) => ({ k, w: p * (bias[k] ?? 1) }));
    return rng.weighted(items, (i) => i.w).k;
  }

  return world.register({
    id: 'weather',
    phase: 'environment',
    order: 20,

    init(w) { state.label = SYNOPTIC[state.synoptic].label; step(w, true); },

    tick(w) { step(w, false); },

    describe() {
      return {
        synoptic: state.synoptic,
        tempC: +state.tempC.toFixed(1),
        windKt: +state.windKt.toFixed(0),
        windDirDeg: Math.round(state.windDirDeg),
        swellM: +state.swellM.toFixed(1),
        rainMmHr: +state.rainMmHr.toFixed(2),
        fire: state.fireDangerLabel
      };
    },

    save() { return { synoptic: state.synoptic, hoursLeft, state: { ...state } }; },
    load(w, s) { if (s) { Object.assign(state, s.state); hoursLeft = s.hoursLeft; target = { ...SYNOPTIC[s.synoptic] }; } }
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
      w.bus.emit('weather:change', { synoptic: next, label: state.label });
    }

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
    state.rainToday += state.rainMmHr * dtH;
    state.rainWeek = state.rainWeek * 0.999 + state.rainMmHr * dtH;
    if (w.clock.minuteOfDay < 10) state.rainToday = 0;

    state.swellM += (target.swell * rng.range(0.85, 1.2) - state.swellM) * 0.02;
    state.swellPeriodS = 6 + state.swellM * 2.4;
    state.swellDirDeg = state.synoptic === 'southerly' || state.synoptic === 'eastcoastlow' ? 165 : 105;
    state.seaState = state.swellM < 0.6 ? 'smooth' : state.swellM < 1.3 ? 'slight'
      : state.swellM < 2.5 ? 'moderate' : state.swellM < 4 ? 'rough' : 'very rough';

    state.humidity = Math.max(0.25, Math.min(0.99, 0.55 + state.cloud * 0.3 + (state.rainMmHr > 0 ? 0.2 : 0) + rng.range(-0.04, 0.04)));
    state.dewPointC = state.tempC - (1 - state.humidity) * 20;
    state.apparentC = state.tempC + 0.33 * (state.humidity * 6.105 * Math.exp(17.27 * state.tempC / (237.7 + state.tempC))) - 0.7 * (state.windKt * 0.514) - 4;
    state.pressure += ((state.synoptic === 'eastcoastlow' ? 998 : state.synoptic === 'ridge' ? 1022 : 1013) - state.pressure) * 0.01;
    state.visibilityKm = state.rainMmHr > 4 ? 3 : state.rainMmHr > 0.5 ? 12 : 30 - state.humidity * 8;
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
    // The bay crossing: wind against tide across the Rous is what stops the barges.
    const tide = w.read('tide');
    const windAgainstTide = tide && Math.abs(tide.rate) > 0.2 && state.windKt > 18 ? 1 : 0;
    state.crossingCondition = state.windKt > 30 ? 'cancelled' : state.windKt > 22 || windAgainstTide ? 'rough' : state.windKt > 15 ? 'choppy' : 'good';
  }
}
