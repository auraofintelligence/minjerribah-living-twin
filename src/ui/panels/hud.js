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
// 3. NOTHING HERE MUTATES THE SIMULATION. The exceptions are the clock speed and the time ribbon,
//    which are presentation controls rather than world state: they change which moment you are
//    looking at and how many ticks a real second buys, never what a tick does. The deciding is
//    not done here either: the bar calls `world.time`, which lives beside the clock in
//    src/kernel/clock.js, because a panel must not decide what a system may recompute.
//    Everything else that wants to change the island emits `ui:intent`.
//
// THE TIME STATEMENT. A person must never have to wonder whether a number on this bar is the real
// island or a simulation of a moment that has not happened, so the bar answers that before it is
// asked, in three places at three levels of detail: a mode chip you can read at a glance, a plain
// sentence on the ribbon row, and a HELD tag on every cell whose number belongs to a different
// moment from the one on the clock. The rule the whole thing rests on: the sun, the moon, the tide
// and the calendar are pure functions of the moment and follow a scrub exactly; everything the
// island has to live through cannot be conjured, so it is held and says so.
//
// The tide sparkline is the piece worth understanding before editing. `tide.next` is a list of
// upcoming turns computed once a day, so its `inHours` is measured from the last day boundary and
// not from now. This file tracks that anchor (from `tide:day`, and from the clock at mount) and
// converts to hours-from-now. The curve between turns is a cosine, which is the same shape as the
// old rule of twelfths, fitted so it passes exactly through the current height. Past the last
// published turn the line is projected at the observed cadence and drawn faded, because the tide
// system only publishes about twenty six hours ahead and a full day has to come from somewhere.

import { registerPanel, el } from '../mount.js';
import { SPEEDS, ISLAND_SEASONS, TICK_MINUTES, MINUTES_PER_DAY, ISLAND_TZ, ISLAND_TZ_NOTE, spanText } from '../../kernel/clock.js';

const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  /**
   * The spec a node's tooltip should show right now. A cell tagged HELD gets the reason first,
   * before its own numbers, because the most important thing about a held number is that it is
   * not the number for the moment on the clock.
   */
  function specFor(src) {
    const spec = src.fn(world) || {};
    if (world.clock.scrubbing && src.node.classList && src.node.classList.contains('hud-held')) {
      spec.lines = ['HELD. This is the island\'s present, not the moment on the clock. Nothing '
        + 'recomputes it for a moment the island has not lived through, and inventing one would '
        + 'put a made-up number under a real date.'].concat(spec.lines || []);
    }
    return spec;
  }

  /** Bind a live tooltip. `fn(world)` is called on show and again on every UI update while open. */
  function tip(node, fn) {
    node.classList.add('has-tip');
    node.addEventListener('pointerenter', () => {
      tipSource = { node, fn };
      renderTip(specFor(tipSource));
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

  const time = world.time || null;

  // The one-word answer. First thing on the bar, before the date, because the first question a
  // person has about a number on a screen like this is whether it is real.
  const modeWord = el('b', {});
  const modeEl = el('span', { class: 'hud-mode' }, el('i', { class: 'hud-mode-dot' }), modeWord);
  const dateEl = el('div', { class: 'hud-date' });
  const pausedChip = el('span', { class: 'hud-paused', hidden: true }, 'PAUSED');
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
  const liveBtn = el('button', {
    class: 'hud-sp hud-live', type: 'button', 'aria-label': 'Live',
    onclick: () => toggleLive()
  }, 'LIVE');
  const speedRow = el('div', { class: 'hud-speeds' }, liveBtn, speedBtns);

  const timeBlock = el('div', { class: 'hud-time' },
    el('div', { class: 'hud-row1' }, modeEl, dateEl, pausedChip, seasonEl),
    el('div', { class: 'hud-row2' }, clockEl, speedRow));

  tip(modeEl, () => modeTip());
  tip(liveBtn, () => ({
    title: world.clock.mode === 'live' ? 'Live, and this switches it off' : 'Go live',
    lines: [
      ['Live means', 'the island is at the real Queensland moment'],
      ['Pace', 'one tick every ten real minutes'],
      ['Timezone', ISLAND_TZ + ', UTC+10, and it never shifts'],
      // Said carefully. "No daylight saving, ever" is the version everyone reaches for and it is
      // wrong: Queensland ran summer time in 1971-72 and across the three summers to 1991-92, and
      // voted it down at a referendum in February 1992. The operational fact is the true one, and
      // it is the only one this twin needs, because no moment it can reach is inside a trial.
      ISLAND_TZ_NOTE,
      'The real datetime a live session started from is stamped into the save, so the session '
      + 'still replays exactly. Determinism is not given up in live; it is anchored.',
      'Choosing a speed leaves live, because an island running at sixty times real time is not '
      + 'the real island and the bar will not say that it is.'
    ],
    why: 'Nothing about live touches the network. The clock is read once, on the machine, and written down.'
  }));

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
        // The school calendar is worked out from the published Queensland anchors, and only 2026's
        // dates are on file to check against. Where they are, the tooltip says the break by name
        // as published fact; where they are not, it says it is derived. Calling an approximation
        // exact is the fault, not the approximation.
        d.isQldSchoolHoliday
          ? 'Queensland school holidays, the ' + d.schoolHolidayLabel + ' break'
            + (d.schoolCalendarBasis === 'published'
              ? ', on the published dates for this year. '
              : ', derived from the published Queensland anchors: no published calendar for this year is on file. ')
            + 'The visitor curve on this island follows the school calendar harder than it follows the weather.'
          : 'School term. ' + (d.schoolCalendarBasis === 'published'
            ? 'The published Queensland dates for this year are on file.'
            : 'Derived from the published Queensland anchors: no published calendar for this year is on file.'),
        d.isWeekend ? 'Weekend.' : null
      ],
      why: 'Island time is AEST by definition. School dates: data/events.json reference_2026, from '
        + 'education.qld.gov.au term dates. One tick is ten minutes of island time.'
    };
  });

  tip(seasonEl, () => {
    const s = world.clock.season || ISLAND_SEASONS[0];
    // Two kinds of claim, kept apart on screen as well as in the data. The weather line is
    // ordinary climate description and says so; the markers are ecological claims a local could
    // check against a sourced record. Running them together let four unsourced phrases borrow the
    // pack's authority, which a critic caught.
    return {
      title: s.name,
      lines: [['Weather', s.weather + ', typically']].concat(s.markers),
      why: 'The markers are from data/ecology.json seasonal_calendar. The weather line is plain '
        + 'south-east Queensland climate description, and is what this build\'s own weather model '
        + 'is weighted toward in this season. Plain descriptive season names: no published '
        + 'Quandamooka seasonal calendar was found for this project, so none is used. See '
        + 'data/lore.json and docs/CULTURAL-REVIEW.md.'
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

  // Which of these can answer for a moment the island has not lived through, and which cannot.
  // The tide is a harmonic sum evaluated at an hour, so it is exact at whatever moment you scrub
  // to, at every station. The rest are the island's own weather, its own boats and its own books:
  // there is no arithmetic that produces next Tuesday's southerly or next Tuesday's ferry queue,
  // so they stay at the island's present and the bar tags them HELD rather than letting a number
  // sit under a date it does not belong to.
  for (const c of [cTemp, cWind, cSwell, cUv, cFire, cCross]) c.classList.add('hud-held');

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
  const sparkKey = el('div', { class: 'k' }, 'Tide, next 24 hours');
  const sparkBlock = el('div', { class: 'hud-spark' }, sparkKey, spark, sparkCap);

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
    const node = el('div', { class: 'hud-cell hud-fig hud-held' },
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

  /* ---- the time ribbon --------------------------------------------------

     A permanent strip across the bottom of the bar saying what moment you are looking at and what
     kind of moment it is. The centre line is always the moment on screen and the strip slides
     under it, which is the same gesture the camera uses on the island: hold the ground and move
     it. Three bands say what kind of time each part of the window is.

       lived        the island has actually run through this. Sea.
       not lived    later than the island's present. Hatched, because a projection is not a record.
       before       earlier than the moment this island opened at. Nothing happened here at all.

     Two pips: where the island's present is, and where the real Queensland moment is. In a live
     session those two sit on top of each other, which is live mode explained in one glance.

     Scrubbing is cheap because it re-simulates nothing. It moves the clock, runs the two systems
     that are pure functions of the clock, and leaves everything else where it is with a tag on it.
     Turning a projection into history is the expensive option and it is a separate, named button
     that says how many ticks it is about to run. */

  const RIBBON_H = 18;
  const WINDOWS = [6, 12, 24, 48, 96, 168, 336, 720, 2160];
  const GRID_STEPS = [1, 2, 3, 6, 12, 24, 48, 168, 336, 720];
  const MAX_CATCHUP_TICKS = 4320; // thirty island days. Past that the honest answer is a number.
  let windowIdx = 3;              // 48 hours across
  let ribbonW = 0;
  let ribbonKey = '';
  let flashText = '';
  let flashUntil = 0;

  const rbBands = sv('g', { class: 'rb-bands' });
  const rbGrid = sv('g', { class: 'rb-grid' });
  const rbMarks = sv('g', { class: 'rb-marks' });
  const rbCaretLine = sv('line', { class: 'rb-caret-line', y1: 0, y2: RIBBON_H });
  const rbCaretHead = sv('path', { class: 'rb-caret-head' });
  const ribbonSvg = sv('svg', {
    class: 'rb-svg', height: RIBBON_H, preserveAspectRatio: 'none',
    role: 'slider', tabindex: '0',
    'aria-label': 'Island time. Drag to move through it, left and right to step an hour, with shift a day.'
  },
  sv('defs', {}, sv('pattern', {
    id: 'twin-rb-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(50)'
  }, sv('line', { class: 'rb-hatch', x1: 0, y1: 0, x2: 0, y2: 6 }))),
  rbBands, rbGrid, rbMarks, rbCaretLine, rbCaretHead);

  const rbStmt = el('div', { class: 'rb-stmt' });
  const btnPresent = el('button', { class: 'rb-btn', type: 'button', onclick: () => goPresent() }, 'Back to now');
  const btnCatch = el('button', { class: 'rb-btn', type: 'button', onclick: () => startCatchUp() }, 'Live through it');
  const btnStop = el('button', { class: 'rb-btn', type: 'button', onclick: () => { if (time) time.cancelCatchup(); } }, 'Stop');
  const rbActions = el('div', { class: 'rb-actions' }, btnPresent, btnCatch, btnStop);
  const showBtn = (b, on) => {
    if (b.__show === on) return;
    b.__show = on;
    b.classList.toggle('show', on);
    b.hidden = !on;
  };
  for (const b of [btnPresent, btnCatch, btnStop]) { b.hidden = true; b.__show = false; }
  const ribbonRow = el('div', { class: 'hud-ribbon' }, rbStmt, ribbonSvg, rbActions);

  tip(rbStmt, () => modeTip());
  tip(ribbonSvg, () => {
    const st = time ? time.status() : null;
    const win = WINDOWS[windowIdx];
    return {
      title: 'Time, in both directions',
      lines: [
        ['Showing', win < 48 ? win + ' hours across' : Math.round(win / 24) + ' days across'],
        ['Centre line', 'the moment on the clock above'],
        ['Filled', 'a stretch the island has actually run through'],
        ['Bare', 'calendar this island has never been at'],
        ['Hatched', 'later than anything the island has run'],
        st ? ['Sea pip', 'the island\'s present'] : null,
        st ? ['Sand pip', 'the real Queensland moment'] : null,
        'Drag to move through time. The wheel changes how much of it you can see. Left and right '
        + 'step an hour, with shift a day, and the comma and full stop keys do the same without '
        + 'clicking here first.',
        'Moving the clock is free and changes nothing: the tide, the sun and the moon are '
        + 'recomputed for whatever moment you land on, and everything else keeps saying what it '
        + 'says at the island\'s present, tagged HELD so you can see which is which.'
      ],
      why: 'A scrubbed future is a projection, and a scrubbed past that was never simulated is not history.'
    };
  });

  /** What the mode chip and the statement both explain, at length, in one place. */
  function modeTip() {
    const c = world.clock;
    const st = time ? time.status() : null;
    const lines = [
      ['Mode', c.declaredMode],
      ['On the clock', c.formatMoment()],
      ['Opened at', prettyISO(c.startISO) + ' ' + ISLAND_TZ],
      c.anchorRealMs !== null ? ['Live anchor taken', new Date(c.anchorRealMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'] : null
    ];
    if (st) {
      lines.push(['The island has lived to', prettyMinute(st.livedMinute)]);
      lines.push(['The real island is at', prettyMinute(st.realMinute)]);
    }
    if (c.mode === 'live') {
      lines.push('Live: the island is at the real Queensland moment and keeps pace with it, one '
        + 'tick every ten real minutes. The real datetime it started from is in the save, so the '
        + 'session still replays exactly.');
    } else {
      lines.push('Simulated: seeded and deterministic. Same seed, same packs, same island.');
    }
    if (c.scrubbing) {
      lines.push(c.viewOffsetMin > 0
        ? 'You are looking at a projection. The island has not run this far, so nothing here is a record of anything.'
        : 'You are looking back at a moment this island was never at. It is not history; the island opened later than this or has simply not been here since.');
      // The exactness claim is now only made about the things that are exact. The school calendar
      // used to be in this list and is not exact: it is derived from the published Queensland
      // anchors, and only 2026's dates are on file to check it against. Calling an approximation
      // exact was the fabrication, not the approximation.
      lines.push('Exact for this moment: the date, the day of the week, the season, the sun, the '
        + 'moon and the tide at every station. Everything tagged HELD is the island\'s present, '
        + 'because there is no arithmetic that produces this moment\'s weather, its ferry queue '
        + 'or its mood.');
      lines.push(c.schoolCalendarBasis === 'published'
        ? 'The school calendar is exact here too: the published Queensland dates for this year are on file.'
        : 'The school calendar for this year is derived from the published Queensland anchors '
          + 'rather than read from a published calendar, because only 2026 is on file. Treat its '
          + 'edges as close rather than exact.');
    }
    if (c.jumps) lines.push(c.jumps + ' time' + (c.jumps === 1 ? '' : 's') + ' this session the island was ticked from a moment it had not lived through. That is on the clock record.');
    // Nought unless something wrote to the clock without going through world.time. When it is not
    // nought, saying so here is the whole point: the bar noticed, declared it, and wrote it down.
    if (c.offRecordMoves) {
      lines.push(c.offRecordMoves + ' time' + (c.offRecordMoves === 1 ? '' : 's')
        + ' this session the moment was moved without going through the time control. Each one was '
        + 'declared as a scrub the moment it was noticed and is on the clock record.');
    }
    return {
      title: modeWordFor(c, st).long,
      lines,
      why: 'Island time is ' + ISLAND_TZ_NOTE + ' One tick is ten minutes of island time.'
    };
  }

  function prettyISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '–');
    const h = +m[4], h12 = h % 12 === 0 ? 12 : h % 12;
    return `${+m[3]} ${MON3[+m[2] - 1]} ${m[1]}, ${h12}:${m[5]}${h < 12 ? 'am' : 'pm'}`;
  }
  function prettyMinute(absMin) {
    const d = new Date(absMin * 60000);
    const h = d.getUTCHours(), h12 = h % 12 === 0 ? 12 : h % 12;
    return `${DAY3[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]}, ${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  }

  /** The chip word, the sentence under it, and the tone. One function so they cannot disagree. */
  function modeWordFor(c, st) {
    if (c.scrubbing) {
      const away = spanText(c.viewOffsetMin);
      return c.viewOffsetMin > 0
        ? { word: 'PROJECTION', tone: 'sun', long: 'A projection, ' + away + ' ahead',
          stmt: 'Projection: ' + away + ' past what the island has lived.' }
        : { word: 'LOOKING BACK', tone: 'sun', long: 'Looking back ' + away,
          stmt: 'Looking back ' + away + ': this moment was never simulated.' };
    }
    if (c.mode === 'live') {
      const off = st ? st.aheadOfRealMin : 0;
      if (off < -TICK_MINUTES) {
        return { word: 'LIVE', tone: 'sea', long: 'Live, catching up',
          stmt: 'Live: ' + spanText(off) + ' behind the real clock, catching up.' };
      }
      return { word: 'LIVE', tone: 'sea', long: 'Live: the real island, right now',
        stmt: 'Live: this is the real island, at the real Queensland time.' };
    }
    return { word: 'SIMULATED', tone: 'iron', long: 'A simulation, not the real island',
      stmt: 'Simulated: running on from ' + prettyISO(world.clock.anchorISO) + '.' };
  }

  function flash(text) {
    flashText = text;
    flashUntil = performance.now() + 9000;
  }

  /* ---- ribbon drawing ---------------------------------------------------- */

  function gridStepH(windowH) {
    for (const s of GRID_STEPS) if (windowH / s <= 9) return s;
    return GRID_STEPS[GRID_STEPS.length - 1];
  }
  function gridLabel(absMin, stepH) {
    const d = new Date(absMin * 60000);
    if (stepH < 24) {
      const h = d.getUTCHours();
      return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p');
    }
    if (stepH < 168) return DAY3[d.getUTCDay()] + ' ' + d.getUTCDate();
    return d.getUTCDate() + ' ' + MON3[d.getUTCMonth()];
  }

  function drawRibbon(st) {
    // Width is measured once a second in reserveGutter, not here: this runs ten times a second and
    // a getBoundingClientRect ten times a second is a forced reflow ten times a second.
    const w = ribbonW;
    if (!st || w < 40) return;
    const winMin = WINDOWS[windowIdx] * 60;
    const key = [w, winMin, st.viewedMinute, st.livedMinute, st.segments.length, Math.floor(st.realMinute)].join('|');
    if (key === ribbonKey) return;
    ribbonKey = key;
    ribbonSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + RIBBON_H);

    const half = winMin / 2;
    const from = st.viewedMinute - half, to = st.viewedMinute + half;
    const xAt = (absMin) => ((absMin - from) / winMin) * w;
    const clampX = (v) => (v < 0 ? 0 : v > w ? w : v);
    const band = (a, b, cls) => {
      const x0 = clampX(xAt(a)), x1 = clampX(xAt(b));
      if (x1 - x0 < 0.5) return null;
      return sv('rect', { class: 'rb-band ' + cls, x: x0.toFixed(1), y: 4, width: (x1 - x0).toFixed(1), height: RIBBON_H - 9 });
    };

    // Bare track is calendar the island has never been at. Sea is a stretch it actually ran
    // through, one band per stretch, so a re-anchor or a jump shows as a gap rather than being
    // papered over. Hatch is everything past the island's present, which is nobody's record.
    rbBands.textContent = '';
    rbBands.appendChild(sv('rect', { class: 'rb-track', x: 0, y: 4, width: w, height: RIBBON_H - 9 }));
    for (const seg of st.segments) {
      if (seg.to < from || seg.from > to) continue;
      const lived = band(Math.max(from, seg.from), Math.min(seg.to, to), 'rb-lived');
      if (lived) rbBands.appendChild(lived);
      // A stretch one tick long is a real stretch and has to be visible, so it gets a minimum.
      else if (seg.to >= from && seg.from <= to) {
        rbBands.appendChild(sv('rect', {
          class: 'rb-band rb-lived', x: clampX(xAt(seg.from)).toFixed(1), y: 4, width: 1.5, height: RIBBON_H - 9
        }));
      }
    }
    const ahead = band(Math.max(from, st.livedMinute), to, 'rb-ahead');
    if (ahead) rbBands.appendChild(ahead);

    rbGrid.textContent = '';
    const stepH = gridStepH(WINDOWS[windowIdx]);
    const stepMin = stepH * 60;
    const first = Math.ceil(from / stepMin) * stepMin;
    for (let m = first; m <= to; m += stepMin) {
      const x = xAt(m);
      if (x < 14 || x > w - 14) continue;
      const midnight = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY === 0;
      rbGrid.appendChild(sv('line', {
        class: 'rb-tick' + (midnight ? ' day' : ''), x1: x.toFixed(1), x2: x.toFixed(1), y1: 3, y2: RIBBON_H - 4
      }));
      rbGrid.appendChild(sv('text', { class: 'rb-lab', x: (x + 3).toFixed(1), y: RIBBON_H - 6 }, gridLabel(m, stepH)));
    }

    rbMarks.textContent = '';
    const pip = (absMin, cls, label) => {
      const x = xAt(absMin);
      if (x < 1 || x > w - 1) return;
      rbMarks.appendChild(sv('line', { class: 'rb-pip ' + cls, x1: x.toFixed(1), x2: x.toFixed(1), y1: 2, y2: RIBBON_H - 3 }));
      rbMarks.appendChild(sv('circle', { class: 'rb-pip-dot ' + cls, cx: x.toFixed(1), cy: 3.4, r: 2.2 }));
      if (label && Math.abs(x - w / 2) > 46) {
        rbMarks.appendChild(sv('text', { class: 'rb-pip-lab ' + cls, x: (x + 4).toFixed(1), y: 7.5 }, label));
      }
    };
    // Live puts these two on top of each other, and that is the mode explained without a word.
    pip(st.realMinute, 'real', 'real now');
    pip(st.livedMinute, 'lived', st.scrubbing ? 'the island' : null);

    const cx = (w / 2).toFixed(1);
    rbCaretLine.setAttribute('x1', cx);
    rbCaretLine.setAttribute('x2', cx);
    rbCaretHead.setAttribute('d', `M${w / 2 - 4} 0L${w / 2 + 4} 0L${w / 2} 5Z`);
  }

  /* ---- ribbon interaction ------------------------------------------------ */

  let drag = null;
  ribbonSvg.addEventListener('pointerdown', (e) => {
    if (!time) return;
    ribbonSvg.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, offset: world.clock.viewOffsetMin };
    ribbonSvg.classList.add('dragging');
    e.preventDefault();
  });
  ribbonSvg.addEventListener('pointermove', (e) => {
    if (!drag || !time) return;
    const w = ribbonW || ribbonSvg.getBoundingClientRect().width || 1;
    // Drag right, go back: the strip moves with the hand the way the ground does under the camera.
    const deltaMin = -((e.clientX - drag.x) / w) * WINDOWS[windowIdx] * 60;
    time.scrubTo(drag.offset + deltaMin);
    paintSpeed();
  });
  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    ribbonSvg.classList.remove('dragging');
    if (e && e.pointerId !== undefined && ribbonSvg.hasPointerCapture(e.pointerId)) ribbonSvg.releasePointerCapture(e.pointerId);
  };
  ribbonSvg.addEventListener('pointerup', endDrag);
  ribbonSvg.addEventListener('pointercancel', endDrag);

  ribbonSvg.addEventListener('wheel', (e) => {
    e.preventDefault();
    windowIdx = clamp(windowIdx + (e.deltaY > 0 ? 1 : -1), 0, WINDOWS.length - 1);
    ribbonKey = '';
  }, { passive: false });

  ribbonSvg.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    let step = 0;
    if (e.code === 'ArrowLeft') step = -1;
    else if (e.code === 'ArrowRight') step = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    stepTime(step * (e.shiftKey ? MINUTES_PER_DAY : 60));
  });

  function stepTime(minutes) {
    if (!time) return;
    time.scrubBy(minutes);
    paintSpeed();
  }
  function goPresent() {
    if (!time) return;
    time.toPresent();
    paintSpeed();
  }
  function toggleLive() {
    if (!time) return;
    const c = world.clock;
    if (c.mode === 'live' && !c.scrubbing) {
      time.goSimulated('live was switched off');
      flash('Simulated from ' + c.formatMoment() + '. The island runs forward from here.');
    } else {
      const moved = time.goLive();
      const m = moved.movedMinutes;
      flash(m === 0
        ? 'Live. The island is at the real ' + c.formatMoment() + '.'
        : 'Live. The clock moved ' + spanText(m) + (m > 0 ? ' forward' : ' back') + ' to the real '
          + c.formatMoment() + '. Nothing the island had already done was undone.');
    }
    ribbonKey = '';
    paintSpeed();
  }
  function startCatchUp() {
    if (!time) return;
    const ticks = Math.round(world.clock.viewOffsetMin / TICK_MINUTES);
    if (ticks <= 0) return;
    if (ticks > MAX_CATCHUP_TICKS) {
      flash('That is ' + ticks.toLocaleString('en-AU') + ' ticks. The island will live through '
        + (MAX_CATCHUP_TICKS / 144) + ' days at a time; come back closer and run it in stages.');
      return;
    }
    time.catchUp({
      onDone: (s) => flash('Lived through ' + s.total.toLocaleString('en-AU') + ' ticks at '
        + (s.msPerTick === null ? '–' : s.msPerTick) + ' ms each. That stretch is the island\'s own history now, not a projection.')
    });
  }

  /* ---- assemble --------------------------------------------------------- */

  const sparkDiv = el('div', { class: 'hud-div spark-div' });
  const mainRow = el('div', { class: 'hud-main' },
    timeBlock,
    el('div', { class: 'hud-div' }),
    conditions,
    sparkDiv,
    sparkBlock,
    el('div', { class: 'hud-div' }),
    el('div', { class: 'hud-figs' }, figs.map((f) => figNodes[f.id].node)));
  const bar = el('div', { class: 'hud-bar', id: 'twin-hud' }, mainRow, ribbonRow);
  root.appendChild(bar);

  /* ---- keeping out from under whatever else docks at the top -------------

     The bar is permanent chrome and publishes --hud-height so panels can dock below it. Panels
     that park themselves over the top right anyway should not be allowed to hide a number. Once a
     second the bar measures what is actually sitting on it, reserves that much room on its right,
     and drops the tide sparkline if what is left is too tight for it. The conditions strip is the
     flexible item, so everything that survives stays aligned and legible rather than clipped. */

  let lastGutter = '';
  let gutterTick = 0;
  function reserveGutter() {
    // The main row rather than the whole bar: the time ribbon runs under it and a panel that only
    // reaches the ribbon is not sitting on any of the readouts.
    const barRect = mainRow.getBoundingClientRect();
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
    // The ribbon's width comes from here too, because this is already the once-a-second reflow.
    const rw = Math.round(ribbonSvg.getBoundingClientRect().width);
    if (rw !== ribbonW) { ribbonW = rw; ribbonKey = ''; }
    const gutter = Math.max(0, Math.round(barRect.right - leftMost));
    const free = Math.round(barRect.width - gutter);
    // Both numbers, not just the gutter. Widening the window changes how much room the bar has
    // without changing what is docked on it, and keying only on the gutter left the tide
    // sparkline hidden and the cells squeezed for the rest of the session after any resize.
    const key = gutter + ':' + free;
    if (key === lastGutter) return;
    lastGutter = key;
    bar.style.setProperty('--hud-gutter', gutter + 'px');
    bar.classList.toggle('no-spark', free < 1340);
    bar.classList.toggle('tight', free < 1290);
  }
  reserveGutter();

  /* ---- speed control ---------------------------------------------------- */

  function setSpeed(i) {
    // Playing from a parked clock returns to the island's present first. The alternative is to
    // start ticking from a moment the island never reached, which is a jump dressed up as a
    // resume: the clock counts those and this is the one place that would cause them.
    if (time && world.clock.scrubbing) time.toPresent();
    world.clock.setSpeed(i);
    ribbonKey = '';
    paintSpeed();
    world.bus.emit('ui:speed', { index: world.clock.speedIndex, label: world.clock.speed.label });
  }

  function paintSpeed() {
    const c = world.clock;
    const live = c.mode === 'live';
    // Nothing is selected in live (the pace is the real clock's, not one of these) and nothing is
    // selected while parked (nothing is running at all).
    const idx = live || c.scrubbing ? -1 : c.speedIndex;
    for (let i = 0; i < speedBtns.length; i++) {
      const on = i === idx;
      if (speedBtns[i].__on !== on) {
        speedBtns[i].__on = on;
        speedBtns[i].classList.toggle('on', on);
        speedBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    if (liveBtn.__on !== live) {
      liveBtn.__on = live;
      liveBtn.classList.toggle('on', live);
      liveBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
    }
    const paused = !live && !c.scrubbing && c.paused;
    if (bar.__paused !== paused) {
      bar.__paused = paused;
      bar.classList.toggle('is-paused', paused);
      // The attribute as well as the class. A reader that walks the accessibility tree sees every
      // node whether or not CSS is drawing it, and a PAUSED chip sitting next to a LIVE chip in
      // that tree says the opposite of what is on screen.
      pausedChip.hidden = !paused;
    }
    const scrubbed = c.scrubbing;
    if (bar.__scrubbed !== scrubbed) {
      bar.__scrubbed = scrubbed;
      bar.classList.toggle('is-scrubbed', scrubbed);
    }
    // The moment, spoken. A slider that says "minus one hundred and eighty" is no use to anybody,
    // so the number is there because the pattern requires one and the text is the real answer.
    const said = c.formatMoment() + (scrubbed ? ', ' + (c.viewOffsetMin > 0 ? 'a projection' : 'never simulated') : '');
    if (ribbonSvg.__said !== said) {
      ribbonSvg.__said = said;
      ribbonSvg.setAttribute('aria-valuetext', said);
      ribbonSvg.setAttribute('aria-valuenow', String(c.viewOffsetMin));
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
      // Parked, and the clock reads zero because parking stops it: Space is the way back.
      if (world.clock.scrubbing) { setSpeed(world.clock.speedBeforeScrub || 1); return; }
      setSpeed(world.clock.speedIndex === 0 ? 1 : 0);
      return;
    }
    // Step through time. Free keys, checked against docs/KEYS.md, and recorded there.
    if (e.code === 'Comma' || e.code === 'Period') {
      e.preventDefault();
      const dir = e.code === 'Comma' ? -1 : 1;
      stepTime(dir * (e.shiftKey ? MINUTES_PER_DAY : 60));
      return;
    }
    const m = /^(?:Digit|Numpad)([0-4])$/.exec(e.code);
    if (m) { e.preventDefault(); setSpeed(Number(m[1])); }
  }
  window.addEventListener('keydown', onKeyDown);

  /* ---- update ----------------------------------------------------------- */

  let curve = null;
  let lastCurveMinute = null;
  let lastMinute = -1;
  let lastSparkScrub = null;
  let lastTickSeen = world.clock.tick;

  // `tide.next` is recomputed on a day boundary, so its `inHours` is measured from that moment.
  // At mount the anchor is either boot (day 0, at the start minute) or the last midnight.
  //
  // Parking the clock is where this gets subtle, and it is worth the ten lines. A scrub across a
  // midnight makes tide.js work its turns out again at the scrubbed moment, so the anchor follows
  // and the sub-line and the sparkline are exact for the moment you are looking at. But coming
  // back to the island's present puts the pre-scrub turn list back verbatim, because a scrub is a
  // way of looking and must leave no residue. The anchor has to come back with it, or the bar
  // reads a restored list against a scrubbed anchor: measured, that was the next high water
  // reported forty minutes out at the island's own present, in the one condition cell that
  // deliberately carries no HELD tag because the tide really is exact.
  let tideAnchor = world.clock.dayIndex === 0
    ? { dayIndex: 0, minuteOfDay: world.clock.startMinuteOfDay }
    : { dayIndex: world.clock.dayIndex, minuteOfDay: 0 };
  let anchorBeforePark = null;
  world.bus.on('tide:day', () => {
    if (world.clock.scrubbing && anchorBeforePark === null) anchorBeforePark = tideAnchor;
    tideAnchor = { dayIndex: world.clock.dayIndex, minuteOfDay: world.clock.minuteOfDay };
  });
  // Emitted by the time control the instant it has put the derived state back.
  world.bus.on('clock:restored', () => {
    if (anchorBeforePark !== null) { tideAnchor = anchorBeforePark; anchorBeforePark = null; }
    lastCurveMinute = null;
  });
  // A load replaces every read model at once, including the tide's turn list, and tide.js restores
  // its own `lastRecompute` with it. The list it comes back with was worked out on the last day
  // boundary the saved island crossed, which is this day's midnight, or the moment the island
  // opened if it never crossed one.
  world.bus.on('world:loaded', () => {
    const c = world.clock;
    tideAnchor = c.dayIndex === 0
      ? { dayIndex: 0, minuteOfDay: c.startMinuteOfDay }
      : { dayIndex: c.dayIndex, minuteOfDay: 0 };
    anchorBeforePark = null;
    lastCurveMinute = null;
    lastTickSeen = c.tick;
  });

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
    // The island lived a moment, so whatever anchor tide.js is on now is the true one and any
    // copy kept for a parking is void. This is the path a parked clock that gets ticked takes,
    // which never reaches `clock:restored`.
    if (c.tick !== lastTickSeen) { lastTickSeen = c.tick; anchorBeforePark = null; }

    /* time */
    setText(dateEl, c.formatDate().toUpperCase());
    setText(clockEl, c.format());
    const season = c.season || ISLAND_SEASONS[0];
    setText(seasonEl, season.name);
    paintSpeed();

    /* which kind of time this is, said three ways: the chip, the sentence, the ribbon */
    const st = time ? time.status() : null;
    const mode = modeWordFor(c, st);
    setText(modeWord, mode.word);
    setCls(modeEl, 'hud-mode has-tip tone-' + mode.tone);
    if (flashText && performance.now() > flashUntil) flashText = '';
    setText(rbStmt, flashText || mode.stmt);
    rbStmt.classList.toggle('flashing', !!flashText);
    if (st) {
      const cu = st.catchup;
      // `hidden` beside the class for the same reason the PAUSED chip carries it: an action that
      // does not apply must be absent from the accessibility tree, not merely undrawn.
      showBtn(btnPresent, !!st.scrubbing && !cu);
      showBtn(btnCatch, !!st.scrubbing && st.offsetMin > 0 && !cu);
      showBtn(btnStop, !!cu);
      if (btnCatch.classList.contains('show')) {
        setText(btnCatch, 'Live through it: ' + Math.round(st.offsetMin / TICK_MINUTES).toLocaleString('en-AU') + ' ticks');
      }
      if (cu) {
        const left = cu.total - cu.done;
        setText(btnStop, 'Stop: ' + left.toLocaleString('en-AU') + ' ticks to go'
          + (cu.msPerTick ? ', about ' + Math.max(1, Math.round((left * cu.msPerTick) / 1000)) + ' s' : ''));
        ribbonKey = '';
      }
      drawRibbon(st);
    }

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

    /* The tide curve, rebuilt on a change of the moment being VIEWED, not of the tick.
       It used to key on `c.tick`, and a scrub does not move the tick, so the sparkline and the
       Tide cell's sub-line stayed on the island's present while the height above them followed the
       scrub. Scrubbed six weeks, the bar read "high 1.81 m, 4h 50m" under an October date while
       the tide system was publishing a low in forty five minutes, and the sparkline path was
       byte-identical across a three month scrub. The Tide cell is deliberately the one condition
       cell without a HELD tag, because the tide is exact at any moment you scrub to, so two thirds
       of it being stale was the worst possible place for that bug to be.
       The rebuild is 73 samples of a cosine and runs at most ten times a second, exactly as before. */
    const viewedMinute = c.absoluteMinute;
    if (viewedMinute !== lastCurveMinute) {
      lastCurveMinute = viewedMinute;
      curve = buildTideCurve(w, tideAnchor, SPARK_FROM, SPARK_TO, 72);
      drawSpark();
    }
    if (c.minuteOfDay !== lastMinute) {
      lastMinute = c.minuteOfDay;
      drawSparkTicks();
    }
    // "Next 24 hours" from where? From the moment on the clock, which while parked is not now.
    const sparkScrub = c.scrubbing ? (c.viewOffsetMin > 0 ? 'ahead' : 'back') : '';
    if (sparkScrub !== lastSparkScrub) {
      lastSparkScrub = sparkScrub;
      setText(sparkKey, sparkScrub ? 'Tide, 24 hours from that moment' : 'Tide, next 24 hours');
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
      renderTip(specFor(tipSource));
      placeTip(tipSource.node);
    }
  }

  function paintFig(id, value, fmt, absHour, deadband) {
    const f = figNodes[id];
    // Six hours of warm up. Several systems publish a placeholder at init and compute the real
    // number on their first pass, and a track that recorded that would report an improvement
    // that nothing on the island did.
    // Nothing is sampled while the clock is parked: these three figures are held at the island's
    // present, so recording them against a scrubbed hour would draw a week of flat line for a week
    // that has not happened.
    if (world.clock.tick >= WARMUP_TICKS && !world.clock.scrubbing) sampleTrack(f.track, absHour, value);
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
    /** What the bar is currently claiming about time, in the same words it puts on screen. */
    timeStatement: () => {
      const s = modeWordFor(world.clock, time ? time.status() : null);
      return { chip: s.word, sentence: s.stmt, held: world.clock.scrubbing };
    },
    scrub: stepTime,
    present: goPresent,
    live: toggleLive,
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
:root{ --hud-height:94px }
.anchor-tl,.anchor-tr,.anchor-tc{ top:calc(var(--hud-height) + var(--sp-3)) }
@media (max-width:860px){ :root{ --hud-height:154px } }

.hud-bar{
  position:fixed; top:0; left:0; right:0; height:94px; z-index:14;
  --hud-gutter:0px;
  display:flex; flex-direction:column;
  color:var(--t); font:var(--fs-base)/1.35 var(--f-ui);
  background:linear-gradient(180deg, rgba(9,13,16,.93), rgba(12,17,20,.86));
  backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  border-bottom:1px solid var(--edge);
  box-shadow:0 10px 30px rgba(0,0,0,.35);
}
/* The readouts. The time ribbon runs full width underneath them and is a row of its own. */
.hud-main{
  flex:1 1 auto; min-height:0; display:flex; align-items:stretch;
  padding:0 calc(14px + var(--hud-gutter)) 0 14px;
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
.hud-row1{display:flex;align-items:center;gap:8px;height:14px}

/* ---- the mode chip: the one-word answer to "is this real" ---- */
.hud-mode{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;cursor:help;
  font:700 9px/1 var(--f-ui);letter-spacing:.15em;padding:2.5px 6px;
  border:1px solid transparent;border-radius:var(--r-pill)}
.hud-mode-dot{display:block;flex:none;width:5px;height:5px;border-radius:50%;background:currentColor}
.hud-mode.tone-sea{color:var(--sea);border-color:rgba(63,182,196,.5);background:rgba(63,182,196,.13)}
.hud-mode.tone-iron{color:var(--iron);border-color:rgba(140,153,163,.32)}
.hud-mode.tone-sun{color:var(--sun);border-color:rgba(240,180,41,.5);background:rgba(240,180,41,.13)}
/* Live gets a halo round its dot; simulated gets a hollow one. Deliberately not an animation.
   A repeating keyframe here would be the obvious choice and it is the wrong one: this project's
   own handover tells every critic to call document.getAnimations().forEach(a => a.finish())
   before measuring the interface, and finish() throws on an animation with no end. One breathing
   dot would break the documented way of reading every panel in the build. */
.hud-mode.tone-sea .hud-mode-dot{box-shadow:0 0 0 2.5px rgba(63,182,196,.22),0 0 8px rgba(63,182,196,.55)}
.hud-mode.tone-iron .hud-mode-dot{background:transparent;box-shadow:inset 0 0 0 1.5px currentColor}
.hud-row2{display:flex;align-items:center;gap:10px}
.hud-date{font:600 10px/1 var(--f-ui);letter-spacing:.15em;color:var(--t-dim);white-space:nowrap;cursor:help}
.hud-season{font:600 9.5px/1 var(--f-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--sea);
  border:1px solid rgba(63,182,196,.4);border-radius:var(--r-pill);padding:2.5px 7px;white-space:nowrap;cursor:help}
.hud-paused{display:none;font:700 9.5px/1 var(--f-ui);letter-spacing:.16em;color:var(--t-on-accent);
  background:var(--sun);border-radius:var(--r-1);padding:3px 5px}
.hud-bar.is-paused .hud-paused{display:inline-block;animation:fade-in .2s var(--ease) both}
.hud-paused[hidden]{display:none}
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
.hud-sp.hud-live{font-size:9px;letter-spacing:.11em;min-width:36px;margin-right:3px}

/* ---- the time ribbon ---- */
.hud-ribbon{flex:0 0 20px;display:flex;align-items:center;gap:10px;
  padding:0 calc(14px + var(--hud-gutter)) 0 14px;
  border-top:1px solid var(--edge);background:rgba(4,7,9,.3)}
.rb-stmt{flex:0 0 auto;max-width:38ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font:500 10px/1 var(--f-ui);letter-spacing:.02em;color:var(--t-dim);cursor:help}
.rb-stmt.flashing{color:var(--sea)}
.rb-svg{flex:1 1 auto;min-width:60px;height:18px;display:block;cursor:ew-resize;touch-action:none}
.rb-svg.dragging{cursor:grabbing}
.rb-svg:focus-visible{outline:none;box-shadow:var(--glow-sea)}
.rb-track{fill:var(--s-sunk)}
/* The two fills that carry meaning go through the palette tokens rather than a literal colour, so
   the colour-vision setting in src/ui/panels/settings.js moves them with everything else it moves. */
.rb-lived{fill:var(--sea);opacity:.2}
.rb-ahead{fill:url(#twin-rb-hatch)}
.rb-hatch{stroke:var(--sun);opacity:.34;stroke-width:1}
.rb-tick{stroke:var(--edge);stroke-width:1}
.rb-tick.day{stroke:var(--edge-strong)}
.rb-lab{fill:var(--t-faint);font:8.5px var(--f-num)}
.rb-pip{stroke-width:1}
.rb-pip.lived{stroke:var(--sea)}
.rb-pip-dot.lived{fill:var(--sea)}
.rb-pip.real{stroke:var(--sand);stroke-dasharray:1.5 2;opacity:.8}
.rb-pip-dot.real{fill:var(--sand)}
.rb-pip-lab{font:8.5px var(--f-ui);letter-spacing:.05em}
.rb-pip-lab.lived{fill:var(--sea)}
.rb-pip-lab.real{fill:var(--sand);opacity:.85}
.rb-caret-line{stroke:var(--t-hi);stroke-width:1.2;opacity:.9}
.rb-caret-head{fill:var(--t-hi)}
.hud-bar.is-scrubbed .hud-ribbon{background:rgba(240,180,41,.07);border-top-color:rgba(240,180,41,.4)}
.hud-bar.is-scrubbed .rb-caret-line{stroke:var(--sun)}
.hud-bar.is-scrubbed .rb-caret-head{fill:var(--sun)}
.hud-bar.is-scrubbed .rb-stmt{color:var(--sun)}
.rb-actions{display:flex;gap:5px;flex:0 0 auto}
.rb-btn{display:none;appearance:none;border:1px solid var(--edge-strong);background:var(--s-sunk);
  color:var(--t-dim);font:600 9.5px/1 var(--f-ui);letter-spacing:.05em;height:16px;padding:0 7px;
  border-radius:var(--r-1);cursor:pointer;white-space:nowrap;
  transition:background var(--fast) var(--ease),color var(--fast),border-color var(--fast)}
.rb-btn.show{display:inline-flex;align-items:center}
.rb-btn[hidden]{display:none}
.rb-btn:hover{color:var(--t-hi);border-color:rgba(63,182,196,.55);background:rgba(63,182,196,.12)}
.rb-btn:focus-visible{outline:none;box-shadow:var(--glow-sea)}

/* ---- held: a number that belongs to a different moment says so ---- */
.hud-bar.is-scrubbed .hud-held .v,
.hud-bar.is-scrubbed .hud-held .fig-val,
.hud-bar.is-scrubbed .hud-held .fig-delta{color:var(--t-faint)}
.hud-bar.is-scrubbed .hud-held .s{color:rgba(109,118,124,.62)}
.hud-bar.is-scrubbed .hud-held .fig-line,
.hud-bar.is-scrubbed .hud-held .fig-arrow,
.hud-bar.is-scrubbed .hud-held .hud-arrow{opacity:.22}
.hud-bar.is-scrubbed .hud-held .k::after{content:' HELD';color:var(--sun);font-weight:700;letter-spacing:.1em}

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
@media (max-width:1120px){ .rb-stmt{max-width:26ch} }
@media (max-width:860px){
  .hud-bar{height:auto}
  .hud-main{flex-wrap:wrap;padding:8px 10px;gap:8px}
  .hud-div{display:none}
  .hud-conditions{order:3;flex-basis:100%;gap:14px}
  .hud-figs{order:2;margin-left:auto}
  .hud-clock{font-size:21px;min-width:74px}
  .hud-ribbon{padding:0 10px}
  .rb-stmt{max-width:18ch}
}
`;
  document.head.appendChild(s);
}
