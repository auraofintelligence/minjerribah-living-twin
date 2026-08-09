// The permanent chrome. One bar across the top of the island: what day it is, how fast time is
// running, what the weather and the water are doing, and three numbers that say how the island
// is travelling.
//
// Three rules this file holds to.
//
// 1. EVERY NUMBER IS READ DEFENSIVELY. A system that has not been built yet, or one that threw and
//    got disabled, must produce a clean dash. Never NaN, never undefined, never a stale value
//    presented as live. `pick()` and `num()` at the top are the only way values reach the screen.
//
// 2. EVERY READOUT TEACHES. Each cell carries a tooltip that says what that number actually does
//    in THIS simulation, with the real thresholds out of the real systems: 22 knots is where the
//    bay goes rough because that is the number in weather.js, two hours either side of high water
//    is the beach driving rule because that is the number in navigation.js. A HUD that shows a
//    number without saying what it drives is decoration.
//
// 3. NOTHING HERE MUTATES THE SIMULATION. The one exception is the clock speed, which is a
//    presentation control rather than world state: it changes how many ticks a real second buys,
//    not what a tick does. Everything else that wants to change the island emits `ui:intent`.
//
// The tide sparkline is the piece worth understanding before editing. `tide.next` is a list of
// upcoming turns computed once a day, so its `inHours` is measured from the last day boundary and
// not from now. This file tracks that anchor (from `tide:day`, and from the clock at mount) and
// converts to hours-from-now. The curve between turns is a cosine, which is the same shape as the
// old rule of twelfths, fitted so it passes exactly through the current height. Past the last
// published turn the line is projected at the observed cadence and drawn faded, because the tide
// system only publishes about twenty six hours ahead and a full day has to come from somewhere.

import { registerPanel, el } from '../mount.js';
import { SPEEDS, ISLAND_SEASONS } from '../../kernel/clock.js';

/* ------------------------------------------------------------------ safe reads */

/** Walk a path into world.state and return `undefined` rather than throwing on a missing system. */
function pick(world, path) {
  let v = world.state;
  for (const k of path.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** The only place a number becomes text. An absent or broken value is a dash, always. */
function num(v, dp = 0, suffix = '') {
  if (!isNum(v)) return '–';
  return v.toFixed(dp) + suffix;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

function moneyShort(v) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return 'A$' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 2) + 'M';
  if (a >= 1e3) return 'A$' + Math.round(v / 1e3) + 'k';
  return 'A$' + Math.round(v);
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compass(deg) {
  if (!isNum(deg)) return '–';
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Hours as a human gap: "3 h 45 min", "45 min", "under a minute". */
function gap(hours) {
  if (!isNum(hours) || hours < 0) return '–';
  const mins = Math.round(hours * 60);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') + ' min';
}

/** The same gap in as few characters as possible, for the strip where room is the constraint. */
function shortGap(hours) {
  if (!isNum(hours) || hours < 0) return '–';
  const mins = Math.round(hours * 60);
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + 'h ' + String(mins % 60).padStart(2, '0') + 'm';
}

function hourLabel(minuteOfDay) {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (h < 12 ? 'a' : 'p');
}

/* ------------------------------------------------------------------ svg helper */

const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/* ------------------------------------------------------------------ the tide curve

   Everything here works in hours from now. `knots` are real published turns; anything the
   function has to invent to fill a full day carries `projected: true` and is drawn faded. */

const SEMIDIURNAL_H = 12.42 / 2; // half a lunar semi-diurnal cycle, the fallback turn spacing

function buildTideCurve(world, anchor, fromH, toH, samples) {
  const t = world.read('tide');
  if (!t || !Array.isArray(t.next) || !t.next.length || !isNum(t.height)) return null;

  // `inHours` is measured from whenever tide.js last recomputed its turns, which is the last day
  // boundary (or boot). Convert to hours from now.
  const c = world.clock;
  let elapsed = 0;
  if (anchor) elapsed = ((c.dayIndex - anchor.dayIndex) * 1440 + (c.minuteOfDay - anchor.minuteOfDay)) / 60;
  const knots = t.next
    .filter((k) => k && isNum(k.inHours) && isNum(k.height))
    .map((k) => ({ t: k.inHours - elapsed, h: k.height, kind: k.kind }))
    .filter((k) => k.t > 0.02)
    .sort((a, b) => a.t - b.t);
  if (!knots.length) return null;

  const hNow = t.height;
  const cadence = knots.length > 1
    ? clamp((knots[knots.length - 1].t - knots[0].t) / (knots.length - 1), 3.5, 9)
    : SEMIDIURNAL_H;
  const highs = knots.filter((k) => k.kind === 'high').map((k) => k.h);
  const lows = knots.filter((k) => k.kind === 'low').map((k) => k.h);
  const highMean = mean(highs);
  const lowMean = mean(lows);

  // The turn behind us. Solved rather than guessed, so the cosine passes exactly through the
  // height the tide system is publishing right now and the "now" dot sits on the line.
  const k0 = knots[0];
  const hPrev = k0.kind === 'high'
    ? (lowMean !== null ? lowMean : k0.h - 1)
    : (highMean !== null ? highMean : k0.h + 1);
  const mid = (hPrev + k0.h) / 2;
  const amp = (hPrev - k0.h) / 2;
  let tPrev = k0.t - cadence;
  if (Math.abs(amp) > 1e-3) {
    const u = Math.acos(clamp((hNow - mid) / amp, -1, 1)) / Math.PI; // 0 at the last turn, 1 at the next
    if (u > 0.02 && u < 0.985) tPrev = (u * k0.t) / (u - 1);
  }

  const all = [{ t: tPrev, h: hPrev, kind: k0.kind === 'high' ? 'low' : 'high' }, ...knots];
  // Back far enough to cover the requested window, forward far enough to fill a full day.
  while (all[0].t > fromH) {
    const prev = all[0];
    all.unshift({
      t: prev.t - cadence,
      h: prev.kind === 'high' ? (lowMean !== null ? lowMean : prev.h - 1) : (highMean !== null ? highMean : prev.h + 1),
      kind: prev.kind === 'high' ? 'low' : 'high',
      projected: true
    });
  }
  while (all[all.length - 1].t < toH) {
    const last = all[all.length - 1];
    all.push({
      t: last.t + cadence,
      h: last.kind === 'high' ? (lowMean !== null ? lowMean : last.h - 1) : (highMean !== null ? highMean : last.h + 1),
      kind: last.kind === 'high' ? 'low' : 'high',
      projected: true
    });
  }

  const firstProjected = all.find((k) => k.projected && k.t > 0);
  const projectedFrom = firstProjected ? firstProjected.t - cadence : null;

  const pts = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const x = fromH + ((toH - fromH) * i) / samples;
    let a = all[0], b = all[all.length - 1];
    for (let j = 0; j < all.length - 1; j++) {
      if (x >= all[j].t && x <= all[j + 1].t) { a = all[j]; b = all[j + 1]; break; }
    }
    const span = b.t - a.t;
    const u = span > 1e-6 ? clamp((x - a.t) / span, 0, 1) : 0;
    const h = (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * u);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
    pts.push({ x, h });
  }
  return {
    pts, lo, hi, cadence,
    turns: all.filter((k) => k.t >= fromH && k.t <= toH),
    nextTurn: knots[0],
    projectedFrom,
    elapsed
  };
}

/* ------------------------------------------------------------------ island health

   A flat average of five ecological read models, each already published on a nought to one scale
   by the system that owns it. It is a summary and it says so in its own tooltip: the point of the
   figure is direction of travel, not precision. Anything missing is dropped rather than assumed,
   so the number degrades honestly while other slices are still being built. */

function islandHealth(world) {
  const parts = [];
  const add = (label, v, from) => { if (isNum(v)) parts.push({ label, v: clamp(v, 0, 1), from }); };

  add('Dunes and beaches', pick(world, 'dunes.islandCondition'), 'dunes');
  const veg = [pick(world, 'vegetation.wallumCondition'), pick(world, 'vegetation.forestCondition'),
    pick(world, 'vegetation.swampCondition')].filter(isNum);
  if (veg.length) add('Bushland', mean(veg), 'vegetation');
  // The water table, not the aquifer stress index. Stress is worked out once a day, so for the
  // first day of a new island it still reads as its placeholder of one, and a composite built on
  // it would climb nine points overnight for no reason anything on the island did.
  add('Fresh water', pick(world, 'lakes.waterTableIndex'), 'lakes');
  const koala = [pick(world, 'koala.occupancy'), pick(world, 'koala.meanCondition'),
    isNum(pick(world, 'koala.disease.clinicalShare')) ? 1 - pick(world, 'koala.disease.clinicalShare') : null]
    .filter(isNum);
  if (koala.length) add('Koalas', mean(koala), 'koala');
  add('Seagrass and the bay', pick(world, 'marine.seagrass.meanShootDensity'), 'marine');

  if (!parts.length) return { value: null, parts };
  return { value: mean(parts.map((p) => p.v)), parts };
}

/* ------------------------------------------------------------------ trend history

   The HUD keeps its own short memory so the three headline figures can show direction of travel
   rather than a bare number. One sample an hour of island time, seven days deep. It is presentation
   state: it never goes into a save and never feeds the simulation. */

const TRACK_HOURS = 176;
const WARMUP_TICKS = 36; // six hours of island time before the first trend sample is kept
function makeTrack() {
  return { hour: null, vals: [] };
}
function sampleTrack(track, absHour, v) {
  if (track.hour === absHour) { if (isNum(v)) track.vals[track.vals.length - 1] = v; return; }
  track.hour = absHour;
  if (isNum(v)) track.vals.push(v);
  while (track.vals.length > TRACK_HOURS) track.vals.shift();
}
/**
 * Change over the last `hours` of island time. A week, not a day: these three figures move slowly
 * by design, and a window short enough to be quiet is a window that says "steady" forever.
 */
function trend(track, hours = 168) {
  const v = track.vals;
  if (v.length < 3) return { delta: null, from: null, span: v.length };
  const back = Math.min(v.length - 1, hours);
  return { delta: v[v.length - 1] - v[v.length - 1 - back], from: v[v.length - 1 - back], span: back };
}

/* ================================================================== the panel */

export function registerHudPanel(world) {
  registerPanel({
    id: 'hud',
    order: 10,
    mount(root, w) { return mountHud(root, w); }
  });
}

function mountHud(root, world) {
  injectStyle();

  /* ---- tooltip, one for the whole bar ---------------------------------- */
  const tipEl = el('div', { class: 'tip', id: 'twin-hud-tip' });
  root.appendChild(tipEl);
  let tipSource = null;

  function renderTip(spec) {
    tipEl.textContent = '';
    if (spec.title) tipEl.appendChild(el('h5', {}, spec.title));
    for (const line of spec.lines || []) {
      if (!line) continue;
      if (Array.isArray(line)) {
        tipEl.appendChild(el('div', { class: 'tip-kv' },
          el('span', { class: 'tip-k' }, line[0]),
          el('span', { class: 'tip-v' }, line[1])));
      } else {
        tipEl.appendChild(el('div', { class: 'tip-l' }, line));
      }
    }
    if (spec.why) tipEl.appendChild(el('div', { class: 'why' }, spec.why));
  }

  function placeTip(node) {
    const r = node.getBoundingClientRect();
    const tr = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = clamp(left, 10, Math.max(10, window.innerWidth - tr.width - 10));
    let top = r.bottom + 10;
    if (top + tr.height > window.innerHeight - 10) top = Math.max(10, r.top - tr.height - 10);
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
  }

  /** Bind a live tooltip. `fn(world)` is called on show and again on every UI update while open. */
  function tip(node, fn) {
    node.classList.add('has-tip');
    node.addEventListener('pointerenter', () => {
      tipSource = { node, fn };
      renderTip(fn(world));
      tipEl.classList.add('show');
      placeTip(node);
    });
    node.addEventListener('pointerleave', () => {
      if (tipSource && tipSource.node === node) tipSource = null;
      tipEl.classList.remove('show');
    });
    return node;
  }

  /* ---- small builders --------------------------------------------------- */

  /** A three-line readout: label, value, sub. Returns the node with `.v` and `.s` handles. */
  function cell(key, cls) {
    const v = el('div', { class: 'v' });
    const s = el('div', { class: 's' });
    const node = el('div', { class: 'hud-cell ' + (cls || '') },
      el('div', { class: 'k' }, key), v, s);
    node.vEl = v;
    node.sEl = s;
    return node;
  }

  const setText = (node, s) => {
    if (node.__last === s) return;
    node.__last = s;
    node.textContent = s;
  };
  /** setAttribute rather than .className, because half of these nodes are SVG. */
  const setCls = (node, s) => {
    if (node.__cls === s) return;
    node.__cls = s;
    node.setAttribute('class', s);
  };
  /** Tone is the only class the update loop owns on a cell. Everything else stays put. */
  const setTone = (node, tone) => {
    if (node.__tone === tone) return;
    node.classList.remove('tone-good', 'tone-warn', 'tone-bad', 'tone-dim');
    node.__tone = tone;
    if (tone) node.classList.add(tone);
  };

  /* ---- time block ------------------------------------------------------- */

  const dateEl = el('div', { class: 'hud-date' });
  const pausedChip = el('span', { class: 'hud-paused' }, 'PAUSED');
  const seasonEl = el('span', { class: 'hud-season' });
  const clockEl = el('div', { class: 'hud-clock' });

  const speedBtns = SPEEDS.map((sp, i) => {
    const b = el('button', {
      class: 'hud-sp',
      type: 'button',
      'aria-label': sp.label,
      onclick: () => setSpeed(i)
    }, i === 0 ? pauseGlyph() : sp.label);
    return b;
  });
  const speedRow = el('div', { class: 'hud-speeds' }, speedBtns);

  const timeBlock = el('div', { class: 'hud-time' },
    el('div', { class: 'hud-row1' }, dateEl, pausedChip, seasonEl),
    el('div', { class: 'hud-row2' }, clockEl, speedRow));

  tip(dateEl, () => {
    const d = world.clock;
    const dl = world.read('daylight') || {};
    return {
      title: d.formatDate(),
      lines: [
        ['Sunrise', isNum(dl.sunriseMin) ? hhmm(dl.sunriseMin) : '–'],
        ['Sunset', isNum(dl.sunsetMin) ? hhmm(dl.sunsetMin) : '–'],
        ['Daylight', isNum(dl.dayLengthMin) ? gap(dl.dayLengthMin / 60) : '–'],
        ['Moon', isNum(dl.moonIllum) ? Math.round(dl.moonIllum * 100) + '% lit' : '–'],
        d.isQldSchoolHoliday ? 'Queensland school holidays. The visitor curve on this island follows the school calendar harder than it follows the weather.' : null,
        d.isWeekend ? 'Weekend.' : null
      ],
      why: 'Island time is AEST by definition. One tick is ten minutes of island time.'
    };
  });

  tip(seasonEl, () => {
    const s = world.clock.season || ISLAND_SEASONS[0];
    return {
      title: s.name,
      lines: [s.marker],
      why: 'Plain descriptive names. No published Quandamooka seasonal calendar was found for this '
        + 'project, so none is used. See data/lore.json and docs/CULTURAL-REVIEW.md.'
    };
  });

  tip(clockEl, () => {
    const sp = world.clock.speed || SPEEDS[0];
    return {
      title: 'Island clock: ' + sp.label,
      lines: [
        ['Tick', '10 minutes of island time'],
        ['At ' + (sp.label === 'Paused' ? '1x' : sp.label), (sp.ticksPerSecond || 2) + ' ticks a second'],
        ['Day so far', Math.round(world.clock.minuteOfDay / 14.4) + '% through'],
        'The simulation is identical at every speed. Speed changes how many ticks a real second buys, never what a tick does.'
      ],
      why: 'Space pauses. Keys 0 to 4 set paused, 1x, 3x, 12x and 60x.'
    };
  });

  tip(speedRow, () => ({
    title: 'Speed',
    lines: [
      ['Space', 'pause and resume'],
      ['0', 'paused'], ['1', '1x, two ticks a second'], ['2', '3x'], ['3', '12x'], ['4', '60x, about a day every three seconds'],
      'Tab cycles the camera between planner, street, follow, drone and cinematic.'
    ],
    why: 'A day is 144 ticks. At 60x that is roughly three real seconds, so a season goes past in five minutes.'
  }));

  /* ---- conditions strip ------------------------------------------------- */

  const cTemp = cell('Air');
  const cWind = cell('Wind');
  const windArrow = sv('svg', { class: 'hud-arrow', viewBox: '0 0 16 16', width: 13, height: 13 },
    sv('path', { d: 'M8 1.6 12 12.6 8 10.2 4 12.6Z' }));
  cWind.vEl.appendChild(windArrow);
  const windVal = el('span', {});
  cWind.vEl.appendChild(windVal);

  const cSwell = cell('Swell');
  const cTide = cell('Tide');
  const tideCaret = sv('svg', { class: 'hud-caret', viewBox: '0 0 16 16', width: 11, height: 11 },
    sv('path', { d: 'M8 3.4 13 12.6H3Z' }));
  const tideVal = el('span', {});
  cTide.vEl.append(tideCaret, tideVal);

  const cUv = cell('UV');
  const cFire = cell('Fire danger');
  const cCross = cell('Crossing');

  const conditions = el('div', { class: 'hud-conditions' },
    cTemp, cWind, cSwell, cTide, cUv, cFire, cCross);

  tip(cTemp, () => {
    const wx = world.read('weather') || {};
    return {
      title: 'Air temperature',
      lines: [
        ['Now', num(wx.tempC, 1, ' °C')],
        ['Feels like', num(wx.apparentC, 1, ' °C')],
        ['Humidity', isNum(wx.humidity) ? Math.round(wx.humidity * 100) + '%' : '–'],
        ['Rain', isNum(wx.rainMmHr) ? num(wx.rainMmHr, 1, ' mm/h, ') + num(wx.rainToday, 0, ' mm today') : '–'],
        'Koalas stop moving in the daytime once the apparent temperature climbs past about 27 degrees, '
        + 'and start coming down out of the trees past 33. Power and water demand both follow the heat, '
        + 'and so does what residents choose to do with their day.'
      ],
      why: wx.label || 'weather'
    };
  });

  tip(cWind, () => {
    const wx = world.read('weather') || {};
    return {
      title: 'Wind',
      lines: [
        ['Speed', num(wx.windKt, 0, ' kt')],
        ['Gusts', num(wx.gustKt, 0, ' kt')],
        ['From', compass(wx.windDirDeg) + ', ' + num(wx.windDirDeg, 0, '°')],
        'The arrow points the way it is blowing, not the way it is coming from.',
        'The crossing feels it first: past 15 knots the bay is choppy, past 22 it is rough, past 30 the '
        + 'barges stop. Wind also moves sand up the dunes, dries the fuel on the heath, and the burn crew '
        + 'will not light up above 22 knots.'
      ],
      why: 'weather, and read by the ferry, the dunes, the vegetation and the phone sites'
    };
  });

  tip(cSwell, () => {
    const wx = world.read('weather') || {};
    const nav = world.read('navigation') || {};
    const extra = isNum(wx.swellM) ? Math.round(clamp((wx.swellM - 1.5) * 40, 0, 100)) : null;
    return {
      title: 'Swell',
      lines: [
        ['Height', num(wx.swellM, 1, ' m')],
        ['Period', num(wx.swellPeriodS, 1, ' s')],
        ['From', compass(wx.swellDirDeg)],
        ['Sea state', wx.seaState || '–'],
        ['Beach', wx.beachCondition || '–'],
        extra !== null ? ['Beach window lost to swell', extra + ' min at each end'] : null,
        'A big swell cuts sand off the ocean dunes and shortens the drivable window on Main Beach and '
        + 'Flinders Beach: every metre over 1.5 m takes another 40 minutes off each end. It also stirs '
        + 'the water over the seagrass and pushes the whales further off the headland.',
        nav.beachRule ? nav.beachRule.rule : null
      ],
      why: 'weather, read by dunes, navigation, marine and whales'
    };
  });

  tip(cTide, () => {
    const t = world.read('tide') || {};
    const st = t.stations || {};
    const turn = curve && curve.nextTurn;
    return {
      title: 'Tide at Dunwich (Goompi)',
      lines: [
        ['Height', num(t.height, 2, ' m above LAT')],
        ['Moving', t.phase === 'flood' ? 'rising ' + num(Math.abs(t.rate), 2, ' m an hour')
          : t.phase === 'ebb' ? 'falling ' + num(Math.abs(t.rate), 2, ' m an hour') : 'slack'],
        turn ? ['Next turn', (turn.kind === 'high' ? 'High ' : 'Low ') + num(turn.h, 2, ' m in ') + gap(turn.t)] : null,
        ['Range today', num(t.range, 2, ' m')],
        ['Springs or neaps', isNum(t.springNeap) ? (t.springNeap > 0.66 ? 'springs' : t.springNeap < 0.33 ? 'neaps' : 'between') : '–'],
        ['At the Gorge', num(st.gorge, 2, ' m')],
        ['At Amity Point', num(st.amity, 2, ' m')],
        'More of this island runs on the tide than on the clock. Main Beach and Flinders Beach are shut '
        + 'to vehicles for two hours either side of high water. The sand flats the shorebirds feed on go '
        + 'under and come back with it. Wind against tide across the Rous is what makes the crossing rough.'
      ],
      why: 'A harmonic model of the Dunwich standard port. High water at Amity is not high water at the Gorge.'
    };
  });

  tip(cUv, () => {
    const wx = world.read('weather') || {};
    const dl = world.read('daylight') || {};
    return {
      title: 'UV index',
      lines: [
        ['Now', isNum(wx.uvIndex) ? Math.round(wx.uvIndex) + ', ' + uvBand(wx.uvIndex) : '–'],
        ['Sun elevation', num(dl.elevationDeg, 1, '°')],
        ['Cloud', isNum(wx.cloud) ? Math.round(wx.cloud * 100) + '%' : '–'],
        'Worked out from the sun angle and the cloud.',
        'Nothing on this island reads it yet. It is here because it belongs on an island readout, not '
        + 'because it drives anything. When a system starts using it, this line will say what it changed.'
      ],
      why: 'Low 0 to 2, moderate 3 to 5, high 6 to 7, very high 8 to 10, extreme above that.'
    };
  });

  tip(cFire, () => {
    const wx = world.read('weather') || {};
    const veg = world.read('vegetation') || {};
    return {
      title: 'Fire danger',
      lines: [
        ['Rating', wx.fireDangerLabel || '–'],
        ['Index', num(wx.fireDangerIndex, 1)],
        ['Fuel near the townships', num(veg.fuelNearTownshipTHa, 1, ' t/ha')],
        ['Grass curing', isNum(veg.curing) ? Math.round(veg.curing * 100) + '%' : '–'],
        ['Rain this week', num(wx.rainWeek, 0, ' mm')],
        'The burn crew will not light up above index 30, above 22 knots of wind, or on wet fuel. Above '
        + 'index 26 the rural fire brigade volunteers start getting turned out, which takes them off '
        + 'whatever else they had on that day.',
        'Fuel builds on the heath whether anyone burns it or not.'
      ],
      why: 'Forest fire danger index: under 12 moderate, under 24 high, under 50 extreme, above that catastrophic.'
    };
  });

  tip(cCross, () => {
    const wx = world.read('weather') || {};
    const f = world.read('ferry') || {};
    const rel = f.reliability || {};
    const next = (f.next && f.next.toIsland) || null;
    const walk = (f.next && f.next.walkOnToIsland) || null;
    const deck = f.deck || {};
    return {
      title: 'The crossing',
      lines: [
        ['Condition', wx.crossingCondition || rel.condition || '–'],
        ['Wind', num(rel.windKt !== undefined ? rel.windKt : wx.windKt, 0, ' kt')],
        next ? ['Next barge in', next.time + ', ' + (isNum(next.inMin) ? next.inMin + ' min' : '–')
          + (isNum(next.spaceCars) ? ', ' + next.spaceCars + ' car spaces' : '')] : null,
        walk ? ['Next passenger boat', walk.time + ', ' + (isNum(walk.inMin) ? walk.inMin + ' min' : '–')] : null,
        isNum(deck.slotsLeftToday) ? ['Car slots left today', deck.slotsLeftToday + ' of ' + (deck.slotsToday || '–')] : null,
        'Everything that is not already on the island comes across this water: groceries, freight, '
        + 'tradies, day visitors, and anyone who has to be at work on the mainland. A rough crossing '
        + 'slows the boats. A cancelled one rolls the vehicle queue into tomorrow, and the chilled '
        + 'freight does not keep.'
      ],
      why: rel.basis
        ? 'The wind thresholds are modelled. No published wind limit for this crossing was found.'
        : 'ferry and weather'
    };
  });

  /* ---- tide sparkline --------------------------------------------------- */

  const SPARK_W = 214, SPARK_H = 36;
  const SPARK_FROM = -2, SPARK_TO = 22;

  const gradId = 'twin-tide-grad';
  const sparkArea = sv('path', { class: 'tide-area', fill: 'url(#' + gradId + ')' });
  const sparkLine = sv('path', { class: 'tide-line' });
  const sparkProj = sv('path', { class: 'tide-line proj' });
  const sparkTicks = sv('g', { class: 'tide-ticks' });
  const sparkTurns = sv('g', { class: 'tide-turns' });
  const nowLine = sv('line', { class: 'tide-now' });
  const nowDot = sv('circle', { class: 'tide-dot', r: 2.6 });

  const spark = sv('svg', {
    class: 'tide-spark', viewBox: '0 0 ' + SPARK_W + ' ' + SPARK_H,
    width: SPARK_W, height: SPARK_H, 'aria-hidden': 'true'
  },
  sv('defs', {}, sv('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 },
    sv('stop', { offset: '0%', 'stop-color': '#3fb6c4', 'stop-opacity': '0.34' }),
    sv('stop', { offset: '100%', 'stop-color': '#3fb6c4', 'stop-opacity': '0.02' }))),
  sparkTicks, sparkArea, sparkLine, sparkProj, sparkTurns, nowLine, nowDot);

  const sparkCap = el('div', { class: 'tide-cap' });
  const sparkBlock = el('div', { class: 'hud-spark' },
    el('div', { class: 'k' }, 'Tide, next 24 hours'), spark, sparkCap);

  tip(sparkBlock, () => {
    const t = world.read('tide') || {};
    const turn = curve && curve.nextTurn;
    return {
      title: 'The next 24 hours of tide',
      lines: [
        ['Now', num(t.height, 2, ' m, ') + (t.phase === 'flood' ? 'rising' : t.phase === 'ebb' ? 'falling' : 'slack')],
        turn ? ['Next turn', (turn.kind === 'high' ? 'high' : 'low') + ' water ' + gap(turn.t)] : null,
        curve ? ['Shown', num(curve.lo, 2) + ' m to ' + num(curve.hi, 2, ' m above LAT')] : null,
        'The turns come from the tide system. The line between them is a cosine, fitted so it passes '
        + 'through the height the island is publishing right now.',
        curve && curve.projectedFrom !== null && curve.projectedFrom < SPARK_TO
          ? 'The faded section past ' + gap(Math.max(0, curve.projectedFrom)) + ' is projected at the same turn '
            + 'cadence. The tide system only publishes about twenty six hours of turns from each midnight.'
          : null
      ],
      why: 'Heights are metres above the lowest astronomical tide at Dunwich (Goompi). Mean sea level sits at about 1.02 m on that datum.'
    };
  });

  /* ---- headline civic figures ------------------------------------------ */

  // Short labels: the full name of each is the first line of its tooltip. A HUD that spells
  // everything out is a HUD that has run out of room for the numbers.
  const figs = [
    { id: 'budget', key: 'Budget' },
    { id: 'mood', key: 'Mood' },
    { id: 'health', key: 'Health' }
  ];
  const figNodes = {};
  for (const f of figs) {
    const arrow = sv('svg', { class: 'fig-arrow', viewBox: '0 0 12 12', width: 10, height: 10 },
      sv('path', { d: 'M6 1.6 10.4 8.4H1.6Z' }));
    const val = el('span', { class: 'fig-val' });
    const s = el('span', { class: 'fig-delta' });
    const v = el('div', { class: 'v' }, arrow, val, s);
    const line = sv('polyline', { class: 'fig-line', 'vector-effect': 'non-scaling-stroke' });
    const base = sv('line', { class: 'fig-base', x1: 0, x2: 100, y1: 7.5, y2: 7.5, 'vector-effect': 'non-scaling-stroke' });
    const trendSvg = sv('svg', {
      class: 'fig-spark', viewBox: '0 0 100 15', preserveAspectRatio: 'none', 'aria-hidden': 'true'
    }, base, line);
    const node = el('div', { class: 'hud-cell hud-fig' },
      el('div', { class: 'k' }, f.key), v, trendSvg);
    figNodes[f.id] = { node, val, arrow, line, s, track: makeTrack() };
  }

  tip(figNodes.budget.node, () => {
    const b = world.read('budget') || {};
    const funds = b.funds || {};
    const ci = funds['council-island'] || {};
    const lines = [
      ['Uncommitted this year', isNum(ci.headroomShare) ? Math.round(ci.headroomShare * 100) + '%' : '–'],
      ['That is', moneyShort(ci.availableThisYear) + ' of ' + moneyShort(ci.allocation)],
      ['Cash on hand', ci.balanceText || moneyShort(ci.balance)],
      ['Financial year', b.fy || '–'],
      isNum(b.daysToAdoption) ? ['Budget adopted in', Math.round(b.daysToAdoption) + ' days'] : null
    ];
    for (const id of ['minjerribah-futures', 'redland-water', 'qyac-enterprise']) {
      const f = funds[id];
      if (f) lines.push([f.label, (f.balanceText || moneyShort(f.balance)) + (f.ringFenced ? ', ring fenced' : '')]);
    }
    if (ci.note) lines.push(ci.note);
    if (b.islandLedger && b.islandLedger.sentence) lines.push(b.islandLedger.sentence);
    return { title: 'Council island program', lines, why: 'The share of the council island program not yet committed for the year. This is the money a decision on this island actually has to come out of.' };
  });

  tip(figNodes.mood.node, () => {
    const s = world.read('sentiment') || {};
    const isl = s.island || {};
    const ch = Array.isArray(s.channels) ? s.channels.length : null;
    return {
      title: 'Island mood',
      lines: [
        ['Overall', num(isl.mood, 2) + (isl.label ? ', ' + isl.label : '')],
        ['Spread', num(isl.spread, 2) + ' between the angriest and the happiest'],
        isl.angriest ? ['Angriest', isl.angriest.label + ' ' + num(isl.angriest.mood, 2)] : null,
        isl.happiest ? ['Happiest', isl.happiest.label + ' ' + num(isl.happiest.mood, 2)] : null,
        ch !== null ? ['Groups tracked', Object.keys(s.moods || {}).length + ' across ' + ch + ' channels'] : null,
        'Nineteen groups, each with its own priorities drawn from what the civic levers do to the metrics '
        + 'they care about. A decision that pleases the average pleases nobody in particular.'
      ],
      why: 'Runs from minus one to plus one. A wide spread with a flat average is a fight, not a consensus.'
    };
  });

  tip(figNodes.health.node, () => {
    const h = islandHealth(world);
    const lines = h.parts.map((p) => [p.label, Math.round(p.v * 100) + '  (' + p.from + ')']);
    lines.push('A flat average of the five ecological read models above, each already published on a '
      + 'nought to one scale by the system that owns it. Fresh water is the water table index.');
    lines.push('It is a summary, not a measurement. Direction of travel is the useful part: open the '
      + 'ecology panels for what is actually happening.');
    if (h.parts.length < 5) lines.push('Only ' + h.parts.length + ' of the five are loaded. Missing systems are dropped rather than assumed.');
    return { title: 'Island health', lines, why: 'Averaged over dunes, bushland, fresh water, koalas and seagrass.' };
  });

  /* ---- assemble --------------------------------------------------------- */

  const sparkDiv = el('div', { class: 'hud-div spark-div' });
  const bar = el('div', { class: 'hud-bar', id: 'twin-hud' },
    timeBlock,
    el('div', { class: 'hud-div' }),
    conditions,
    sparkDiv,
    sparkBlock,
    el('div', { class: 'hud-div' }),
    el('div', { class: 'hud-figs' }, figs.map((f) => figNodes[f.id].node)));
  root.appendChild(bar);

  /* ---- keeping out from under whatever else docks at the top -------------

     The bar is permanent chrome and publishes --hud-height so panels can dock below it. Panels
     that park themselves over the top right anyway should not be allowed to hide a number. Once a
     second the bar measures what is actually sitting on it, reserves that much room on its right,
     and drops the tide sparkline if what is left is too tight for it. The conditions strip is the
     flexible item, so everything that survives stays aligned and legible rather than clipped. */

  let lastGutter = -1;
  let gutterTick = 0;
  function reserveGutter() {
    const barRect = bar.getBoundingClientRect();
    const half = barRect.width * 0.5;
    let leftMost = barRect.right;
    for (const n of root.children) {
      if (n === bar || n === tipEl) continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      // A panel part way through its entry animation reads as transparent and is about to be
      // there, so it still counts. One that is settled at nought is genuinely closed.
      const animating = typeof n.getAnimations === 'function' && n.getAnimations().length > 0;
      if (!animating && parseFloat(cs.opacity) < 0.06) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      if (r.top >= barRect.bottom - 2 || r.bottom <= barRect.top + 2) continue; // not on the bar
      if (r.left < half) continue;   // a full width overlay is not a dock, leave the bar alone
      if (r.left < leftMost) leftMost = r.left;
    }
    const gutter = Math.max(0, Math.round(barRect.right - leftMost));
    if (gutter === lastGutter) return;
    lastGutter = gutter;
    bar.style.setProperty('--hud-gutter', gutter + 'px');
    const free = barRect.width - gutter;
    bar.classList.toggle('no-spark', free < 1340);
    bar.classList.toggle('tight', free < 1290);
  }
  reserveGutter();

  /* ---- speed control ---------------------------------------------------- */

  function setSpeed(i) {
    world.clock.setSpeed(i);
    paintSpeed();
    world.bus.emit('ui:speed', { index: world.clock.speedIndex, label: world.clock.speed.label });
  }

  function paintSpeed() {
    const idx = world.clock.speedIndex;
    for (let i = 0; i < speedBtns.length; i++) {
      const on = i === idx;
      if (speedBtns[i].__on !== on) {
        speedBtns[i].__on = on;
        speedBtns[i].classList.toggle('on', on);
        speedBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    const paused = world.clock.paused;
    if (bar.__paused !== paused) {
      bar.__paused = paused;
      bar.classList.toggle('is-paused', paused);
    }
  }

  // The camera rig owns 1 to 5 for its modes unless something else claims the number keys. It
  // provides this flag for exactly that. Tab still cycles the camera modes.
  if (world.flags && typeof world.flags.add === 'function') world.flags.add('camera-no-number-keys');

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  function onKeyDown(e) {
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      // The drone camera flies up on Space. Leave it alone while that mode is active.
      const cam = world.read('camera');
      if (cam && cam.mode === 'drone') return;
      e.preventDefault();
      setSpeed(world.clock.speedIndex === 0 ? 1 : 0);
      return;
    }
    const m = /^(?:Digit|Numpad)([0-4])$/.exec(e.code);
    if (m) { e.preventDefault(); setSpeed(Number(m[1])); }
  }
  window.addEventListener('keydown', onKeyDown);

  /* ---- update ----------------------------------------------------------- */

  // `tide.next` is recomputed on a day boundary, so its `inHours` is measured from that moment.
  // At mount the anchor is either boot (day 0, at the start minute) or the last midnight.
  let tideAnchor = world.clock.dayIndex === 0
    ? { dayIndex: 0, minuteOfDay: world.clock.startMinuteOfDay }
    : { dayIndex: world.clock.dayIndex, minuteOfDay: 0 };
  world.bus.on('tide:day', () => {
    tideAnchor = { dayIndex: world.clock.dayIndex, minuteOfDay: world.clock.minuteOfDay };
  });

  let curve = null;
  let lastCurveTick = -1;
  let lastMinute = -1;

  function hhmm(minuteOfDay) {
    if (!isNum(minuteOfDay)) return '–';
    const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m % 60).padStart(2, '0') + ampm;
  }

  paintSpeed();

  function update(w) {
    const c = w.clock;
    // Layout reads force a reflow, so once a second rather than ten times a second.
    if ((gutterTick = (gutterTick + 1) % 10) === 0) reserveGutter();

    /* time */
    setText(dateEl, c.formatDate().toUpperCase());
    setText(clockEl, c.format());
    const season = c.season || ISLAND_SEASONS[0];
    setText(seasonEl, season.name);
    paintSpeed();

    /* conditions */
    // Sub lines are kept short enough that they never need an ellipsis. Whatever will not fit in
    // a word or two belongs in the tooltip, where there is room to say what it actually does.
    const wx = w.read('weather') || {};
    setText(cTemp.vEl, num(wx.tempC, 1) + '°');
    setText(cTemp.sEl, isNum(wx.rainMmHr) && wx.rainMmHr > 0.05
      ? num(wx.rainMmHr, 1) + ' mm/h'
      : (isNum(wx.apparentC) ? 'feels ' + num(wx.apparentC, 0) + '°' : (wx.label || '–')));

    setText(windVal, num(wx.windKt, 0) + ' kt');
    if (isNum(wx.windDirDeg)) {
      // Meteorological direction is where the wind comes from. The arrow shows where it is going.
      const rot = (wx.windDirDeg + 180) % 360;
      if (windArrow.__rot !== Math.round(rot)) {
        windArrow.__rot = Math.round(rot);
        windArrow.style.transform = 'rotate(' + rot.toFixed(0) + 'deg)';
      }
      windArrow.style.opacity = '1';
    } else {
      windArrow.style.opacity = '0.25';
    }
    setText(cWind.sEl, compass(wx.windDirDeg) + (isNum(wx.gustKt) ? ', gust ' + num(wx.gustKt, 0) : ''));

    setText(cSwell.vEl, num(wx.swellM, 1) + ' m');
    setText(cSwell.sEl, num(wx.swellPeriodS, 0, ' s') + ', ' + (wx.seaState || '–'));

    const t = w.read('tide') || {};
    setText(tideVal, num(t.height, 2) + ' m');
    const rising = t.phase === 'flood';
    const slack = t.phase === 'slack' || !t.phase;
    setCls(tideCaret, 'hud-caret' + (rising ? ' up' : slack ? ' flat' : ''));
    setTone(cTide, slack ? 'tone-dim' : '');

    /* the tide curve. Rebuilt when the sim tick moves, which is at most ten times a second. */
    if (c.tick !== lastCurveTick) {
      lastCurveTick = c.tick;
      curve = buildTideCurve(w, tideAnchor, SPARK_FROM, SPARK_TO, 72);
      drawSpark();
    }
    if (c.minuteOfDay !== lastMinute) {
      lastMinute = c.minuteOfDay;
      drawSparkTicks();
    }

    const turn = curve && curve.nextTurn;
    setText(cTide.sEl, turn
      ? (turn.kind === 'high' ? 'high ' : 'low ') + num(turn.h, 2) + ' m, ' + shortGap(turn.t)
      : (slack ? 'slack water' : rising ? 'rising' : 'falling'));

    const uv = wx.uvIndex;
    setText(cUv.vEl, isNum(uv) ? String(Math.round(uv)) : '–');
    setText(cUv.sEl, isNum(uv) ? uvBand(uv) : '–');
    setTone(cUv, uvTone(uv));

    setText(cFire.vEl, wx.fireDangerLabel || '–');
    setText(cFire.sEl, isNum(wx.fireDangerIndex) ? 'index ' + num(wx.fireDangerIndex, 1) : '–');
    setTone(cFire, fireTone(wx.fireDangerLabel));

    const ferry = w.read('ferry') || {};
    const cross = wx.crossingCondition || (ferry.reliability && ferry.reliability.condition);
    setText(cCross.vEl, cross ? cross[0].toUpperCase() + cross.slice(1) : '–');
    const nextBarge = ferry.next && ferry.next.toIsland;
    setText(cCross.sEl, nextBarge && nextBarge.time
      ? 'barge ' + nextBarge.time
      : (isNum(wx.windKt) ? num(wx.windKt, 0) + ' kt on the bay' : '–'));
    setTone(cCross, crossTone(cross));

    /* headline figures */
    const absHour = c.dayIndex * 24 + Math.floor(c.minuteOfDay / 60);

    const b = w.read('budget') || {};
    const ci = (b.funds && b.funds['council-island']) || {};
    // Deadbands are the smallest weekly change worth calling a direction. They are set from what
    // these three actually do over a year of headless running, not from a round number.
    const headroom = isNum(ci.headroomShare) ? ci.headroomShare * 100 : null;
    paintFig('budget', headroom, (v) => Math.round(v) + '%', absHour, 0.05);

    const isl = (w.read('sentiment') || {}).island || {};
    const mood = isNum(isl.mood) ? isl.mood : null;
    paintFig('mood', mood, (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), absHour, 0.004);

    const health = islandHealth(w);
    const hv = isNum(health.value) ? health.value * 100 : null;
    paintFig('health', hv, (v) => String(Math.round(v)), absHour, 0.05);

    /* live tooltip refresh */
    if (tipSource) {
      renderTip(tipSource.fn(w));
      placeTip(tipSource.node);
    }
  }

  function paintFig(id, value, fmt, absHour, deadband) {
    const f = figNodes[id];
    // Six hours of warm up. Several systems publish a placeholder at init and compute the real
    // number on their first pass, and a track that recorded that would report an improvement
    // that nothing on the island did.
    if (world.clock.tick >= WARMUP_TICKS) sampleTrack(f.track, absHour, value);
    setText(f.val, isNum(value) ? fmt(value) : '–');
    const tr = trend(f.track);
    let dir = 'flat';
    if (isNum(tr.delta)) {
      if (tr.delta > deadband) dir = 'up';
      else if (tr.delta < -deadband) dir = 'down';
    }
    setCls(f.arrow, 'fig-arrow ' + dir + (isNum(tr.delta) ? '' : ' none'));
    // Direction of travel, not a bare number: the arrow says which way, the delta says how far
    // over the last week of island time, and "new" says the HUD has not watched long enough yet.
    const dp = deadband < 0.01 ? 3 : deadband < 0.1 ? 2 : 1;
    if (isNum(tr.delta) && dir !== 'flat') {
      setText(f.s, (tr.delta > 0 ? '+' : '−') + Math.abs(tr.delta).toFixed(dp));
    } else if (isNum(tr.delta)) {
      setText(f.s, 'steady');
    } else {
      setText(f.s, isNum(value) ? 'new' : '');
    }
    setCls(f.s, 'fig-delta ' + dir);
    drawFigSpark(f, deadband);
  }

  function drawFigSpark(f, deadband) {
    const v = f.track.vals;
    if (v.length < 2) { f.line.setAttribute('points', ''); return; }
    let lo = Infinity, hi = -Infinity;
    for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    // A floor under the vertical scale, so a figure the HUD is calling steady does not draw
    // itself a cliff. The floor is six deadbands: enough that a real move still fills the box.
    const mid = (lo + hi) / 2;
    const floor = deadband * 6;
    if (hi - lo < floor) { lo = mid - floor / 2; hi = mid + floor / 2; }
    const span = hi - lo || 1;
    const n = Math.min(v.length, 100);
    const start = v.length - n;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 100 : (i / (n - 1)) * 100;
      const y = 13.5 - ((v[start + i] - lo) / span) * 12;
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    const s = pts.join(' ');
    if (f.line.__pts !== s) { f.line.__pts = s; f.line.setAttribute('points', s); }
  }

  /* ---- sparkline drawing ------------------------------------------------ */

  const PAD_T = 5, PAD_B = 11;
  function xAt(hours) { return ((hours - SPARK_FROM) / (SPARK_TO - SPARK_FROM)) * SPARK_W; }

  function drawSpark() {
    if (!curve) {
      sparkLine.setAttribute('d', '');
      sparkProj.setAttribute('d', '');
      sparkArea.setAttribute('d', '');
      sparkTurns.textContent = '';
      nowDot.setAttribute('opacity', '0');
      setText(sparkCap, 'no tide data');
      return;
    }
    nowDot.setAttribute('opacity', '1');
    const pad = Math.max(0.12, (curve.hi - curve.lo) * 0.14);
    const lo = curve.lo - pad, hi = curve.hi + pad;
    const yAt = (h) => PAD_T + (1 - (h - lo) / (hi - lo)) * (SPARK_H - PAD_T - PAD_B);

    const cut = curve.projectedFrom === null ? SPARK_TO : curve.projectedFrom;
    let solid = '', dashed = '', area = '';
    for (let i = 0; i < curve.pts.length; i++) {
      const p = curve.pts[i];
      const X = xAt(p.x).toFixed(1), Y = yAt(p.h).toFixed(1);
      area += (i === 0 ? 'M' : 'L') + X + ' ' + Y;
      if (p.x <= cut) solid += (solid ? 'L' : 'M') + X + ' ' + Y;
      if (p.x >= cut) dashed += (dashed ? 'L' : 'M') + X + ' ' + Y;
    }
    area += 'L' + SPARK_W + ' ' + (SPARK_H - PAD_B + 4) + 'L0 ' + (SPARK_H - PAD_B + 4) + 'Z';
    sparkLine.setAttribute('d', solid);
    sparkProj.setAttribute('d', dashed);
    sparkArea.setAttribute('d', area);

    const x0 = xAt(0);
    nowLine.setAttribute('x1', x0.toFixed(1));
    nowLine.setAttribute('x2', x0.toFixed(1));
    nowLine.setAttribute('y1', String(PAD_T - 4));
    nowLine.setAttribute('y2', String(SPARK_H - PAD_B + 3));
    const hNow = curve.pts.find((p) => p.x >= 0) || curve.pts[0];
    nowDot.setAttribute('cx', x0.toFixed(1));
    nowDot.setAttribute('cy', yAt(hNow.h).toFixed(1));

    sparkTurns.textContent = '';
    for (const k of curve.turns) {
      if (k.t < SPARK_FROM + 0.4 || k.t > SPARK_TO - 0.4) continue;
      sparkTurns.appendChild(sv('circle', {
        class: 'turn' + (k.projected ? ' proj' : ''),
        cx: xAt(k.t).toFixed(1), cy: yAt(k.h).toFixed(1), r: k.projected ? 1.6 : 2.1
      }));
    }
    // The next turn is already spelled out in the tide cell, so the caption carries the thing the
    // cell has no room for: how big a tide this is, and where in the spring to neap swing it sits.
    const t = world.read('tide') || {};
    const swing = isNum(t.springNeap)
      ? (t.springNeap > 0.66 ? 'springs' : t.springNeap < 0.33 ? 'neaps' : 'between springs and neaps')
      : null;
    setText(sparkCap, (isNum(t.range) ? num(t.range, 2) + ' m range' : num(curve.hi - curve.lo, 2) + ' m shown')
      + (swing ? ', ' + swing : ''));
  }

  function drawSparkTicks() {
    const start = world.clock.minuteOfDay;
    const key = Math.floor(start / 60);
    if (sparkTicks.__key === key) return;
    sparkTicks.__key = key;
    sparkTicks.textContent = '';
    // A tick on every sixth hour of island time, so the shape is readable against the day.
    const firstSix = Math.ceil((start / 60 + SPARK_FROM) / 6) * 6;
    for (let hAbs = firstSix; ; hAbs += 6) {
      const rel = hAbs - start / 60;
      if (rel > SPARK_TO) break;
      if (rel < SPARK_FROM) continue;
      const x = xAt(rel);
      sparkTicks.appendChild(sv('line', { class: 'grid', x1: x.toFixed(1), x2: x.toFixed(1), y1: PAD_T - 3, y2: SPARK_H - PAD_B + 2 }));
      sparkTicks.appendChild(sv('text', { class: 'lab', x: x.toFixed(1), y: SPARK_H - 2, 'text-anchor': 'middle' },
        hourLabel(hAbs * 60)));
    }
  }

  drawSparkTicks();

  /* ---- debug handle ----------------------------------------------------- */

  const api = {
    tideCurve: () => curve,
    health: () => islandHealth(world),
    tracks: () => Object.fromEntries(Object.entries(figNodes).map(([k, f]) => [k, f.track.vals.slice()])),
    speed: setSpeed,
    /** Repaint now. Panels normally update at 10 Hz, which a backgrounded tab throttles to a
     *  crawl, so a critic fast forwarding with TWIN.run needs a way to make the bar catch up. */
    tick: () => update(world),
    node: bar
  };
  world.bus.on('app:ready', () => { if (window.TWIN) window.TWIN.hud = api; });
  if (typeof window !== 'undefined' && window.TWIN) window.TWIN.hud = api;

  return { update };
}

/* ------------------------------------------------------------------ tone helpers */

function uvBand(uv) {
  if (!isNum(uv)) return '–';
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}
function uvTone(uv) {
  if (!isNum(uv) || uv < 3) return '';
  if (uv < 8) return 'tone-warn';
  return 'tone-bad';
}
function fireTone(label) {
  if (label === 'High') return 'tone-warn';
  if (label === 'Extreme' || label === 'Catastrophic') return 'tone-bad';
  return '';
}
function crossTone(c) {
  if (c === 'good') return 'tone-good';
  if (c === 'choppy') return 'tone-warn';
  if (c === 'rough' || c === 'cancelled') return 'tone-bad';
  return '';
}
function pauseGlyph() {
  return sv('svg', { viewBox: '0 0 12 12', width: 10, height: 10 },
    sv('rect', { x: 2.4, y: 1.8, width: 2.4, height: 8.4, rx: 0.6 }),
    sv('rect', { x: 7.2, y: 1.8, width: 2.4, height: 8.4, rx: 0.6 }));
}

/* ================================================================== style */

function injectStyle() {
  if (document.getElementById('twin-hud-style')) return;
  const s = document.createElement('style');
  s.id = 'twin-hud-style';
  s.textContent = `
/* The bar is the one piece of chrome that is always there, so it owns the top of the screen and
   publishes how much of it. Anything using the shared layout anchors docks below it. A panel that
   positions itself by hand should read var(--hud-height) rather than guess. */
:root{ --hud-height:74px }
.anchor-tl,.anchor-tr,.anchor-tc{ top:calc(var(--hud-height) + var(--sp-3)) }
@media (max-width:860px){ :root{ --hud-height:132px } }

.hud-bar{
  position:fixed; top:0; left:0; right:0; height:74px; z-index:14;
  --hud-gutter:0px;
  display:flex; align-items:stretch; padding:0 calc(14px + var(--hud-gutter)) 0 14px;
  color:var(--t); font:var(--fs-base)/1.35 var(--f-ui);
  background:linear-gradient(180deg, rgba(9,13,16,.93), rgba(12,17,20,.86));
  backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  border-bottom:1px solid var(--edge);
  box-shadow:0 10px 30px rgba(0,0,0,.35);
}
/* No entry animation on the permanent chrome. A browser that starts the page in a background tab
   freezes CSS animations at their first keyframe, and an animation with fill-mode both then holds
   the bar at opacity nought until the tab is looked at. Chrome that might not be there is not chrome. */
.hud-bar::after{content:'';position:absolute;left:0;right:0;top:100%;height:26px;pointer-events:none;
  background:linear-gradient(180deg, rgba(9,13,16,.42), rgba(9,13,16,0))}
.hud-bar.is-paused{border-bottom-color:rgba(240,180,41,.45)}
.hud-bar.is-paused::before{content:'';position:absolute;left:0;right:0;bottom:-1px;height:1px;
  background:var(--sun); opacity:.75; animation:fade-in .3s var(--ease) both}

/* ---- time block ---- */
.hud-time{display:flex;flex-direction:column;justify-content:center;gap:3px;flex:0 0 auto;padding-right:2px}
.hud-row1{display:flex;align-items:center;gap:8px;height:13px}
.hud-row2{display:flex;align-items:center;gap:10px}
.hud-date{font:600 10px/1 var(--f-ui);letter-spacing:.15em;color:var(--t-dim);white-space:nowrap;cursor:help}
.hud-season{font:600 9.5px/1 var(--f-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--sea);
  border:1px solid rgba(63,182,196,.4);border-radius:var(--r-pill);padding:2.5px 7px;white-space:nowrap;cursor:help}
.hud-paused{display:none;font:700 9.5px/1 var(--f-ui);letter-spacing:.16em;color:var(--t-on-accent);
  background:var(--sun);border-radius:var(--r-1);padding:3px 5px}
.hud-bar.is-paused .hud-paused{display:inline-block;animation:fade-in .2s var(--ease) both}
.hud-clock{font:300 25px/1 var(--f-num);color:var(--t-hi);font-variant-numeric:tabular-nums;
  letter-spacing:-.01em;min-width:88px;cursor:help}
.hud-bar.is-paused .hud-clock{color:var(--sun)}
.hud-speeds{display:flex;gap:3px}
.hud-sp{appearance:none;border:1px solid var(--edge-strong);background:var(--s-sunk);color:var(--t-dim);
  font:600 10.5px/1 var(--f-ui);letter-spacing:.04em;height:22px;min-width:26px;padding:0 6px;
  border-radius:var(--r-1);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  transition:background var(--fast) var(--ease),color var(--fast),border-color var(--fast)}
.hud-sp svg{fill:currentColor}
.hud-sp:hover{color:var(--t-hi);border-color:rgba(63,182,196,.55);background:rgba(63,182,196,.12)}
.hud-sp.on{background:var(--sea);border-color:var(--sea);color:var(--t-on-accent);
  box-shadow:0 0 0 1px rgba(63,182,196,.3),0 0 14px rgba(63,182,196,.28)}
.hud-sp:focus-visible{outline:none;box-shadow:var(--glow-sea)}
.hud-bar.is-paused .hud-sp.on{background:var(--sun);border-color:var(--sun);
  box-shadow:0 0 0 1px rgba(240,180,41,.3),0 0 14px rgba(240,180,41,.3)}

/* ---- dividers ---- */
.hud-div{flex:0 0 1px;width:1px;align-self:center;height:40px;background:var(--edge);margin:0 12px}

/* ---- condition cells ---- */
/* The flexible item. When something docks over the right of the bar this is what gives, and it
   scrolls inside itself rather than clipping, so the page body never scrolls sideways. */
.hud-conditions{display:flex;align-items:stretch;gap:15px;flex:1 1 auto;min-width:0;overflow-x:auto;
  overflow-y:hidden;scrollbar-width:none;
  mask-image:linear-gradient(90deg,#000 calc(100% - 18px),transparent);
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 18px),transparent)}
.hud-conditions::-webkit-scrollbar{height:0}
.hud-cell{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;cursor:help;
  padding:0 1px;position:relative}
.hud-cell .k{font:600 9.5px/1 var(--f-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--t-faint);
  white-space:nowrap}
.hud-cell .v{font:400 15.5px/1.05 var(--f-num);color:var(--t-hi);font-variant-numeric:tabular-nums;
  display:flex;align-items:center;gap:4px;white-space:nowrap}
.hud-cell .s{font:400 10px/1.2 var(--f-ui);color:var(--t-faint);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:126px}
.hud-cell.tone-good .v{color:var(--leaf)}
.hud-cell.tone-warn .v{color:var(--sun)}
.hud-cell.tone-bad  .v{color:var(--coral)}
.hud-cell.tone-dim  .v{color:var(--t)}
.hud-cell.has-tip::after{content:'';position:absolute;left:-6px;right:-6px;top:-6px;bottom:-6px;border-radius:var(--r-2)}
.hud-cell.has-tip:hover{color:var(--t-hi)}
.hud-cell.has-tip:hover .k{color:var(--sea)}

.hud-arrow{fill:var(--sea);transition:transform .5s var(--ease);transform-origin:50% 50%}
.hud-caret{fill:var(--coral);transform:rotate(180deg);transform-origin:50% 50%;transition:transform .3s var(--ease)}
.hud-caret.up{fill:var(--sea);transform:none}
.hud-caret.flat{fill:var(--t-faint);transform:rotate(90deg)}

/* ---- tide sparkline ---- */
.hud-spark{display:flex;flex-direction:column;justify-content:center;gap:1px;flex:0 0 auto;cursor:help;position:relative}
.hud-spark .k{font:600 9.5px/1 var(--f-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--t-faint)}
.hud-spark:hover .k{color:var(--sea)}
.tide-spark{display:block;margin:-1px 0 -2px}
.tide-line{fill:none;stroke:var(--sea);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.tide-line.proj{stroke:var(--sea);opacity:.34;stroke-dasharray:2.5 2.5}
.tide-now{stroke:var(--sand);stroke-width:1;opacity:.55;stroke-dasharray:1.5 2}
.tide-dot{fill:var(--sand);stroke:rgba(9,13,16,.8);stroke-width:1}
.tide-turns .turn{fill:none;stroke:var(--sea);stroke-width:1.2;opacity:.85}
.tide-turns .turn.proj{opacity:.3}
.tide-ticks .grid{stroke:var(--edge);stroke-width:1}
.tide-ticks .lab{fill:var(--t-faint);font:9px var(--f-num);letter-spacing:.02em}
.tide-cap{font:400 10px/1.2 var(--f-ui);color:var(--t-dim);white-space:nowrap}

/* ---- headline figures ---- */
.hud-figs{display:flex;align-items:stretch;gap:15px;flex:0 0 auto}
.hud-fig{width:96px;gap:3px}
.hud-fig .v{font-size:19px;color:var(--t-hi);gap:3px}
.fig-val{flex:0 0 auto}
.fig-delta{font:400 10px/1 var(--f-num);color:var(--t-faint);align-self:flex-end;padding-bottom:2px}
.fig-delta.up{color:var(--leaf)} .fig-delta.down{color:var(--coral)}
.fig-spark{display:block;width:100%;height:15px}
.fig-line{fill:none;stroke:var(--sea);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round;opacity:.85}
.fig-base{stroke:var(--edge);stroke-width:1}
.fig-arrow{flex:0 0 auto;fill:var(--leaf);transition:transform .3s var(--ease)}
.fig-arrow.down{fill:var(--coral);transform:rotate(180deg);transform-origin:50% 50%}
.fig-arrow.flat{fill:var(--t-faint);transform:rotate(90deg);transform-origin:50% 50%}
.fig-arrow.none{opacity:.2}
.hud-bar.no-spark .hud-spark,.hud-bar.no-spark .spark-div{display:none}
/* Squeezed by something docked over the right of the bar: close the gaps before anything scrolls. */
.hud-bar.tight .hud-div{margin:0 8px}
.hud-bar.tight .hud-conditions{gap:12px}
.hud-bar.tight .hud-figs{gap:11px}
.hud-bar.tight .hud-fig{width:88px}
.hud-bar.tight .hud-clock{min-width:78px}
.hud-bar.tight .hud-cell .s{max-width:112px}

/* ---- tooltip extras (the base .tip lives in design.css) ---- */
/* #ui-root > * turns pointer events back on for every direct child, and the tooltip is one. */
#twin-hud-tip{max-width:340px;pointer-events:none;font-family:var(--f-ui)}
#twin-hud-tip .tip-kv{display:flex;justify-content:space-between;gap:12px;margin-top:2px}
#twin-hud-tip .tip-k{color:var(--t-faint);font-size:var(--fs-sm);white-space:nowrap}
#twin-hud-tip .tip-v{color:var(--t-hi);font:var(--fs-sm)/1.5 var(--f-num);font-variant-numeric:tabular-nums;text-align:right}
#twin-hud-tip .tip-l{margin-top:7px;color:var(--t-dim);font-size:var(--fs-sm);line-height:1.55}
#twin-hud-tip .tip-l:first-of-type{margin-top:5px}

/* ---- responsive: the middle of the screen stays clear at every width ---- */
@media (max-width:1480px){ .hud-figs{gap:12px} .hud-fig{min-width:92px} .hud-div{margin:0 10px} }
@media (max-width:1300px){ .hud-spark,.spark-div{display:none} }
@media (max-width:1040px){ .hud-conditions{gap:12px} .hud-cell .s{max-width:96px} }
@media (max-width:860px){
  .hud-bar{height:auto;flex-wrap:wrap;padding:8px 10px;gap:8px}
  .hud-div{display:none}
  .hud-conditions{order:3;flex-basis:100%;gap:14px}
  .hud-figs{order:2;margin-left:auto}
  .hud-clock{font-size:21px;min-width:74px}
}
`;
  document.head.appendChild(s);
}
