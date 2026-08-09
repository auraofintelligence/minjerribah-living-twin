// The island calendar.
//
// Every civic game has a festival that adds tourists. This one has data/events.json: twenty-seven
// real events, five load periods and nine operating rhythms, each carrying what it needs, what it
// strains, who earns from it and an hourly crowd curve. Nothing here was invented. The pack says so
// in its own honesty block, it marks the ones that could not be confirmed, it keeps the festival
// that ended because the reasons it ended are civic levers, and it records what was deliberately
// left out. All of that is on this panel, because a calendar that hides its own gaps is a lie about
// a small island where everyone knows what is on.
//
// The three things this panel does that a "tourism event" system does not:
//
//   1. It resolves dates from the pack's own `date_rule` rather than from a hard-coded list, so the
//      calendar keeps working in 2029. Fixed dates, nth weekday, Easter-anchored, weekly, fortnightly,
//      monthly and seasonal windows are all computed, and where the pack holds a sourced date for the
//      next occurrence that date wins and is labelled as published rather than derived.
//   2. It shows the strain before the crowd, at the pack's own level 1 to 5, against the island's
//      actual published ceiling. Twenty clubs at a surf contest need about 500 extra one-way seats.
//      The whole island's day is 4,254 walk-on seats and 560 vehicle spaces each way, and there is
//      no bridge.
//   3. It gives equal weight to the rhythms nobody puts in a calendar and everybody plans around:
//      Monday bins against a Monday public holiday, the hourly barge, the school terms, the Friday
//      wave and the Sunday queue, and a fishing window that runs on the tide rather than the clock.
//
// CULTURAL RULE. Three records in the pack carry a cultural_handling field: they are held as civic
// load only, and no programme, protocol or cultural content exists in the data. This panel renders
// the dates, the crowd, the ferries and the bins, and says plainly that the rest is not this
// project's to hold. It never generates any of it. See data/lore.json prohibitions and
// docs/CULTURAL-REVIEW.md.

import { registerPanel, el } from '../mount.js';

/* ------------------------------------------------------------------ shared chrome */

function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  if (!document.getElementById('twin-rail-css')) {
    const s = document.createElement('style');
    s.id = 'twin-rail-css';
    s.textContent = `
#twin-rail { position: absolute; left: var(--sp-3); top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: var(--sp-2); z-index: 20; }
.rail-btn { position: relative; width: 116px; justify-content: flex-start; letter-spacing: .1em;
  font-size: var(--fs-micro); text-transform: uppercase; padding: var(--sp-3) var(--sp-3); }
.rail-btn .dot { position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: var(--r-pill); background: var(--sun); color: var(--t-on-accent);
  font: 700 10px/17px var(--f-num); text-align: center; }
.rail-btn .dot:empty { display: none; }
@media (max-width: 860px) { #twin-rail { left: var(--sp-2); gap: 4px; } .rail-btn { width: 96px; } }`;
    document.head.append(s);
  }
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const STYLE = `
.ev-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.ev-scrim.on { opacity: 1; pointer-events: auto; }
.ev-board { position: fixed; inset: 2.4vh 2.2vw; z-index: 41; display: flex; flex-direction: column;
  max-width: 1680px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.ev-board.on { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 860px) { .ev-board { inset: 0; border-radius: 0; } }
/* Narrow: the columns stop being columns and the whole board scrolls as one page. */
@media (max-width: 1100px) {
  .ev-cols { display: block !important; height: auto; overflow-y: auto; }
  .ev-pane { overflow: visible; border-right: none; border-bottom: 1px solid var(--edge); }
  .ev-top { flex-wrap: wrap; }
  .ev-stats { margin-left: 0; flex-wrap: wrap; gap: var(--sp-4); }
}

.ev-top { display: flex; align-items: flex-start; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.ev-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.ev-sub { font-size: var(--fs-sm); color: var(--t-faint); max-width: 66ch; line-height: 1.45; }
.ev-stats { display: flex; gap: var(--sp-5); margin-left: auto; }

.ev-cols { flex: 1; min-height: 0; display: grid; }
.ev-cols > * { min-height: 0; }
.ev-pane { min-height: 0; overflow-y: auto; border-right: 1px solid var(--edge); padding: var(--sp-3); }
.ev-pane:last-child { border-right: none; }
.ev-pane.pad { padding: var(--sp-4); }

.ev-h { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--t-faint);
  margin: var(--sp-4) 0 var(--sp-2); font-weight: 600; }
.ev-h:first-child { margin-top: 0; }
.ev-p { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); margin-bottom: var(--sp-2); }
.ev-p strong { color: var(--t-hi); font-weight: 500; }
.ev-quiet { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.55; }
.ev-src { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.5; margin-top: var(--sp-2);
  padding-top: var(--sp-2); border-top: 1px solid var(--edge); word-break: break-word; }

.ev-card { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3);
  margin-bottom: var(--sp-2); background: rgba(255,255,255,.022); }
.ev-card.pick { cursor: pointer; transition: border-color var(--fast), background var(--fast); }
.ev-card.pick:hover { border-color: var(--edge-strong); background: rgba(255,255,255,.05); }
.ev-card.on { border-color: var(--sea); background: rgba(63,182,196,.10); }
.ev-card h4 { color: var(--t-hi); font-size: var(--fs-base); font-weight: 500; line-height: 1.35; }
.ev-when { display: flex; align-items: baseline; gap: var(--sp-2); font: var(--fs-sm)/1 var(--f-num);
  color: var(--sea); font-variant-numeric: tabular-nums; margin-bottom: 3px; }
.ev-when em { font-style: normal; color: var(--t-faint); font-size: var(--fs-micro); letter-spacing: .08em;
  text-transform: uppercase; }
.ev-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

.ev-nums { display: flex; gap: var(--sp-4); flex-wrap: wrap; margin-top: 8px; }
.ev-num { display: flex; flex-direction: column; }
.ev-num b { font: 400 var(--fs-base)/1.1 var(--f-num); color: var(--t); font-variant-numeric: tabular-nums; }
.ev-num i { font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase;
  color: var(--t-faint); font-style: normal; margin-top: 2px; }

.ev-item { display: flex; gap: var(--sp-3); align-items: flex-start; padding: 6px 0;
  border-bottom: 1px dashed var(--edge); font-size: var(--fs-sm); }
.ev-item:last-child { border-bottom: none; }
.ev-item .body { flex: 1; min-width: 0; }
.ev-item .body em { display: block; font-style: normal; color: var(--t-faint); font-size: var(--fs-micro);
  line-height: 1.5; margin-top: 2px; }

.ev-lvl { display: flex; gap: 2px; flex: none; padding-top: 4px; }
.ev-lvl i { width: 7px; height: 12px; border-radius: 1px; background: var(--s-sunk); display: block; }
.ev-lvl i.on1 { background: var(--leaf); } .ev-lvl i.on2 { background: var(--leaf); }
.ev-lvl i.on3 { background: var(--sun); } .ev-lvl i.on4 { background: var(--sun); }
.ev-lvl i.on5 { background: var(--coral); }

.ev-range { position: relative; height: 26px; margin: 10px 0 4px; }
.ev-range .bar { position: absolute; left: 0; right: 0; top: 11px; height: 4px; border-radius: var(--r-pill);
  background: var(--s-sunk); }
.ev-range .band { position: absolute; top: 11px; height: 4px; border-radius: var(--r-pill); background: var(--sea-deep); }
.ev-range .pin { position: absolute; top: 5px; width: 2px; height: 16px; background: var(--sea); }
.ev-range .pin.alt { background: var(--sun); }
.ev-range span { position: absolute; top: -2px; font: var(--fs-micro) var(--f-num); color: var(--t-faint); }

.ev-curve { width: 100%; height: auto; display: block; }
.ev-curve text { font-family: var(--f-num); fill: var(--t-faint); font-size: 9px; }
.ev-curve .lbl { font-family: var(--f-ui); fill: var(--t-dim); font-size: 10px; }

.ev-banner { border: 1px solid var(--sun-deep); border-left-width: 3px; border-radius: var(--r-2);
  background: rgba(240,180,41,.09); padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-3);
  font-size: var(--fs-sm); color: var(--t); line-height: 1.5; }
.ev-banner.stop { border-color: var(--heath); background: rgba(180,138,196,.10); }
.ev-banner.gone { border-color: var(--coral); background: rgba(226,114,91,.10); }
.ev-banner b { color: var(--t-hi); }

.ev-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.ev-table th { text-align: left; font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--edge); }
.ev-table td { padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(232,220,196,.06); vertical-align: top; }
.ev-table td.n, .ev-table th.n { font-family: var(--f-num); font-variant-numeric: tabular-nums; text-align: right;
  padding-right: var(--sp-4); white-space: nowrap; }
.ev-table td.n:last-child, .ev-table th.n:last-child { padding-right: 0; }

.ev-track { height: 5px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden; }
.ev-track > i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--sea);
  transition: width var(--med) var(--ease); }
.ev-filters { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-3); flex-wrap: wrap; }
`;

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86400000;
const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const edOf = (y, m0, d) => Math.floor(Date.UTC(y, m0, d) / DAY_MS);
const dowOf = (e) => ((e + 4) % 7 + 7) % 7;
const parseISO = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? edOf(+m[1], +m[2] - 1, +m[3]) : null;
};
function fmtDay(e) {
  const d = new Date(e * DAY_MS);
  return `${DAY3[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]}`;
}
function fmtSpan(a, b) {
  if (b == null || b === a) return fmtDay(a);
  const da = new Date(a * DAY_MS), db = new Date(b * DAY_MS);
  if (da.getUTCMonth() === db.getUTCMonth()) return `${DAY3[da.getUTCDay()]} ${da.getUTCDate()} to ${db.getUTCDate()} ${MON3[db.getUTCMonth()]}`;
  return `${fmtDay(a)} to ${fmtDay(b)}`;
}
function awayText(days) {
  if (days < 0) return 'on now';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return 'in ' + days + ' days';
  if (days < 70) return 'in ' + Math.round(days / 7) + ' weeks';
  return 'in ' + Math.round(days / 30.4375) + ' months';
}

/** The anonymous Gregorian computus. Arithmetic, deterministic, no wall clock. */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return edOf(y, month - 1, day);
}

function nthWeekday(year, month1, weekday, nth) {
  const m0 = month1 - 1;
  const first = edOf(year, m0, 1);
  const want = WD[weekday] ?? 0;
  let e = first + (((want - dowOf(first)) % 7) + 7) % 7;
  e += (nth - 1) * 7;
  const d = new Date(e * DAY_MS);
  return d.getUTCMonth() === m0 ? e : null;
}

/**
 * Resolve a record's occurrences into a window. A sourced `next_known` wins over the pattern and is
 * flagged, because the pack's own honesty note says island event dates move and next_known is a
 * snapshot rather than a rule.
 */
function occurrences(rec, from, to) {
  const out = [];
  const rule = rec.date_rule || {};
  const dur = Math.max(1, rule.duration_days || 1);
  const push = (start, sourced) => {
    if (start == null) return;
    const end = start + dur - 1;
    if (end < from || start > to) return;
    if (out.some((o) => Math.abs(o.start - start) <= 3)) return;
    out.push({ start, end, sourced: !!sourced });
  };

  const nk = rec.next_known;
  if (nk && nk.start) {
    const s = parseISO(nk.start), e = parseISO(nk.end) ?? s;
    if (e != null && e >= from && s <= to) out.push({ start: s, end: e, sourced: true, confidence: nk.confidence });
  }

  const y0 = new Date(from * DAY_MS).getUTCFullYear();
  const y1 = new Date(to * DAY_MS).getUTCFullYear();

  switch (rule.kind) {
    case 'fixed':
      for (let y = y0; y <= y1 + 1; y++) push(edOf(y, (rule.month || 1) - 1, rule.day || 1));
      break;
    case 'nth_weekday':
      for (let y = y0; y <= y1 + 1; y++) push(nthWeekday(y, rule.month || 1, rule.weekday, rule.nth || 1));
      break;
    case 'moveable':
      for (let y = y0; y <= y1 + 1; y++) {
        const anchor = String(rule.anchor || '');
        if (/easter/i.test(anchor)) {
          const es = easterSunday(y);
          if (/good friday/i.test(anchor)) push(es - 2);
          else push(es + (rule.offset_days || 0));
        } else if (/first sunday in july/i.test(anchor)) {
          push(nthWeekday(y, 7, 'sunday', 1));
        }
      }
      break;
    case 'weekly': {
      const want = WD[rule.weekday];
      if (want == null) break;
      let e = from + (((want - dowOf(from)) % 7) + 7) % 7;
      for (; e <= to; e += 7) {
        if (rule.season_months && !rule.season_months.includes(new Date(e * DAY_MS).getUTCMonth() + 1)) continue;
        push(e);
      }
      break;
    }
    case 'fortnightly': {
      const want = WD[rule.weekday];
      if (want == null) break;
      // No anchor date is published, so the phase is pinned to the first matching weekday of the
      // year and the record says the published list goes stale faster than anything else here.
      const y = new Date(from * DAY_MS).getUTCFullYear();
      let anchor = edOf(y, 0, 1);
      anchor += (((want - dowOf(anchor)) % 7) + 7) % 7;
      let e = anchor + Math.ceil((from - anchor) / 14) * 14;
      for (; e <= to; e += 14) push(e);
      break;
    }
    case 'monthly': {
      if (rule.weekday == null || rule.nth == null) break;
      for (let y = y0; y <= y1 + 1; y++) {
        for (let m = 1; m <= 12; m++) push(nthWeekday(y, m, rule.weekday, rule.nth));
      }
      break;
    }
    case 'season':
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const s = edOf(y, (rule.start_month || 1) - 1, rule.start_day || 1);
        const endYear = (rule.end_month || 1) < (rule.start_month || 1) ? y + 1 : y;
        const e = edOf(endYear, (rule.end_month || 1) - 1, rule.end_day || 1);
        if (e >= from && s <= to && !out.some((o) => Math.abs(o.start - s) <= 3)) out.push({ start: s, end: e, sourced: false });
      }
      break;
    default:
      break; // irregular: only the sourced date, which is the honest answer
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function ruleText(rule) {
  if (!rule) return 'no pattern recorded';
  const wd = rule.weekday ? rule.weekday.replace(/^./, (c) => c.toUpperCase()) : '';
  switch (rule.kind) {
    case 'fixed': return `${rule.day} ${MON3[(rule.month || 1) - 1]} every year`;
    case 'nth_weekday': return `the ${['first', 'second', 'third', 'fourth', 'fifth'][(rule.nth || 1) - 1]} ${wd} of ${MON3[(rule.month || 1) - 1]}`;
    case 'moveable': return `moves with ${rule.anchor}`;
    case 'weekly': return `every ${wd}${rule.season_months ? ', in season' : ''}`;
    case 'fortnightly': return `every second ${wd}`;
    case 'monthly': return rule.weekday ? `the ${['first', 'second', 'third', 'fourth'][(rule.nth || 1) - 1]} ${wd} of the month` : 'roughly monthly';
    case 'season': return 'a window rather than a date';
    default: return 'real, but no stable pattern was found';
  }
}

/* ------------------------------------------------------------------ small helpers */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Prose from a data pack, made safe to put on a screen.
 *
 * Two jobs, and the second one is the important one. It strips the markdown backticks that pack
 * authors write around file paths, which are noise to a player. And it substitutes the one word the
 * project may not render.
 *
 * data/lore.json prohibition `no-invented-ceremony` blocks that word across src, data and assets.
 * data/events.json uses it correctly, in its own notes, to say what has deliberately been left out.
 * Those notes are worth showing, because a calendar that hides its own gaps is a lie on an island
 * this size. So the note is shown and the word is not: the substitution is mechanical, it is listed
 * here, and it never changes what the sentence claims. Nothing is invented and nothing is hidden.
 */
const WORD_SUBSTITUTIONS = [
  [/\bceremony days\b/gi, 'cultural days'],
  [/\bceremony\b/gi, 'cultural material'],
  [/\bceremonial\b/gi, 'cultural']
];
function txt(s) {
  if (s == null) return '';
  let out = String(s).replace(/`/g, '');
  for (const [re, to] of WORD_SUBSTITUTIONS) out = out.replace(re, to);
  return out;
}

function chip(cls, text, title) { return el('span', { class: 'chip ' + cls, title: title || null }, text); }
function num(n) { return Math.round(n).toLocaleString('en-AU'); }
function hhmm(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, '0')}${ap}`;
}

const CATEGORY_CHIP = {
  cultural: 'heath', surfing: 'sea', 'endurance-sport': 'sea', 'music-arts': 'heath', arts: 'heath',
  'food-community': 'sun', 'fishing-competition': 'sea', commemoration: 'iron', market: 'sun',
  'club-night': 'iron', 'club-social': 'iron', 'community-workshop': 'heath', 'live-music': 'heath',
  'sport-fixture': 'leaf', 'sport-carnival': 'leaf', 'junior-sport': 'leaf',
  'volunteer-environment': 'leaf', 'sport-fundraiser': 'leaf', community: 'sun',
  'music-festival': 'heath', 'seasonal-peak': 'coral'
};

/* ------------------------------------------------------------------ the panel */

registerPanel({
  id: 'events',
  order: 41,
  mount(root, world) {
    if (!document.getElementById('ev-style')) {
      const st = document.createElement('style');
      st.id = 'ev-style';
      st.textContent = STYLE;
      document.head.append(st);
    }

    const badge = el('span', { class: 'dot' });
    const launcher = el('button', { class: 'btn rail-btn', type: 'button', title: 'The island calendar (e)', onclick: () => toggle() },
      'Calendar', badge);
    rail().append(launcher);

    const scrim = el('div', { class: 'ev-scrim', onclick: () => toggle(false) });
    const board = el('section', { class: 'panel ev-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'The island calendar' });
    root.append(scrim, board);

    const statBox = el('div', { class: 'ev-stats' });
    const head = el('div', { class: 'ev-top' },
      el('div', {},
        el('h2', {}, 'The island calendar'),
        el('div', { class: 'ev-sub' },
          'Twenty-seven real events, five load periods and nine operating rhythms, from data/events.json. ' +
          'Nothing here was invented, the unconfirmed ones say so, and what was deliberately left out is listed at the bottom of the right-hand column.')),
      statBox,
      el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));
    const cols = el('div', { class: 'ev-cols', style: { gridTemplateColumns: 'minmax(230px, 22%) 1fr minmax(280px, 28%)' } });
    board.append(head, cols);

    const view = { eventId: null, horizon: 400 };

    /* --- bindings ---------------------------------------------------
       `chrome` is built once and survives every rebuild; `binds` belongs to the current draw and is
       thrown away with it. One shared list blanks the header the moment a column is redrawn. */
    const chrome = [];
    let binds = chrome;
    const bind = (fn) => { const n = el('span'); binds.push(['t', n, fn]); return n; };
    const bindW = (node, fn) => { binds.push(['w', node, fn]); return node; };
    function runBinds(list) {
      for (const b of list) {
        try {
          if (b[0] === 't') { const v = String(b[2](world)); if (b[1].textContent !== v) b[1].textContent = v; }
          else { const v = b[2](world); if (b[1].style.width !== v) b[1].style.width = v; }
        } catch (e) { /* a bad binding must not stop the calendar */ }
      }
    }
    function live() { runBinds(chrome); if (binds !== chrome) runBinds(binds); }
    function readout(k, fn) {
      return el('div', { class: 'readout' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, bind(fn)));
    }
    statBox.append(
      readout('Today', (w) => w.clock.formatDate()),
      readout('On the island', (w) => { const v = w.read('visitors'); return v && v.ready ? num(v.onIsland) + ' visitors' : 'not built'; }),
      readout('Vehicle slots left', (w) => { const f = w.read('ferry'); return f && f.deck ? num(f.deck.slotsLeftToday) : 'not built'; }),
      readout('Next big one', () => nextEventLabel())
    );

    /* --- open and close -------------------------------------------- */
    let open = false;
    function toggle(force) {
      open = force === undefined ? !open : !!force;
      scrim.classList.toggle('on', open);
      board.classList.toggle('on', open);
      launcher.classList.toggle('on', open);
      if (open) { world.bus.emit('ui:drawer', { id: 'events' }); refresh(true); board.focus({ preventScroll: true }); }
    }
    world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'events' && open) toggle(false); });
    // E is free: the camera rig owns Tab, the digits, F1 to F4, P, L, H, B and C, and the HUD owns
    // space and the digits. Checked against src/render/camera.js and src/ui/panels/hud.js.
    const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && TYPING[e.target.tagName]) return;
      if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
      else if (e.code === 'KeyE') { toggle(); e.preventDefault(); }
    });

    /* --- the pack -------------------------------------------------- */
    const pack = () => (world.data && world.data.events) || null;
    const businesses = () => ((world.data && world.data.businesses && world.data.businesses.businesses) || []);
    const places = () => ((world.data && world.data.places && world.data.places.places) || []);
    function bizName(id) {
      const b = businesses().find((x) => x.id === id);
      if (!b) return { name: id, note: 'not in data/businesses.json' };
      return { name: b.name, note: b.status === 'trading' ? null : b.status.replace(/-/g, ' ') };
    }
    function placeName(id) {
      const p = places().find((x) => x.id === id);
      return p ? p.name : id.replace(/-/g, ' ');
    }

    const today = () => world.clock.epochDay + world.clock.dayIndex;

    /** Next occurrence of every record, cached by day. */
    let schedCache = { day: -1, list: [] };
    function schedule() {
      const t = today();
      if (schedCache.day === t) return schedCache.list;
      const pk = pack();
      const list = [];
      if (pk && pk.events) {
        for (const rec of pk.events) {
          if (rec.status === 'ended') { list.push({ rec, occ: null, days: 99999, ended: true }); continue; }
          const occ = occurrences(rec, t, t + view.horizon);
          if (!occ.length) { list.push({ rec, occ: null, days: 99998 }); continue; }
          list.push({ rec, occ: occ[0], all: occ, days: occ[0].start - t });
        }
      }
      list.sort((a, b) => a.days - b.days || (a.rec.name < b.rec.name ? -1 : 1));
      schedCache = { day: t, list };
      return list;
    }
    function nextEventLabel() {
      const s = schedule().find((x) => x.occ && x.days >= 0 && x.rec.attendance && x.rec.attendance.typical >= 200);
      return s ? s.rec.name.split(' ').slice(0, 3).join(' ') + ', ' + awayText(s.days) : 'nothing big ahead';
    }

    /* --- rebuild control ------------------------------------------- */
    let sig = '';
    function refresh(force) {
      if (!open) return;
      const s = [view.eventId, view.horizon, world.clock.dayIndex].join('~');
      if (!force && s === sig) { live(); return; }
      sig = s;
      binds = [];
      cols.textContent = '';
      try { build(); } catch (e) {
        cols.append(el('div', { class: 'ev-pane pad' }, el('div', { class: 'ev-p' }, 'The calendar could not be drawn: ' + (e && e.message))));
        console.error('[events] build failed', e);
      }
      live();
    }

    /* ============================================================== build */

    function build() {
      const pk = pack();
      if (!pk || !pk.events) {
        cols.append(el('div', { class: 'ev-pane pad' },
          el('div', { class: 'ev-h' }, 'No calendar'),
          el('div', { class: 'ev-p' }, 'data/events.json is missing, so this panel has nothing true to show and will not make anything up.')));
        return;
      }
      cols.append(aheadColumn(pk), detailColumn(pk), rhythmColumn(pk));
    }

    /* --- column one: what is coming --------------------------------- */

    function aheadColumn(pk) {
      const pane = el('div', { class: 'ev-pane' });
      const t = today();

      pane.append(el('div', { class: 'ev-h' }, 'Today'));
      pane.append(todayCard(pk));

      pane.append(el('div', { class: 'ev-h' }, 'What is on'));
      pane.append(el('div', { class: 'ev-filters' },
        el('button', { class: 'btn' + (view.horizon === 45 ? ' on' : ''), type: 'button', onclick: () => { view.horizon = 45; schedCache.day = -1; refresh(true); } }, 'Six weeks'),
        el('button', { class: 'btn' + (view.horizon === 400 ? ' on' : ''), type: 'button', onclick: () => { view.horizon = 400; schedCache.day = -1; refresh(true); } }, 'A year')));

      const list = schedule();
      let shown = 0;
      for (const s of list) {
        if (s.ended || !s.occ) continue;
        shown++;
        pane.append(eventRow(s, t));
      }
      if (!shown) pane.append(el('div', { class: 'ev-quiet' }, 'Nothing dated inside that window.'));

      const unpatterned = list.filter((s) => !s.ended && !s.occ);
      if (unpatterned.length) {
        pane.append(el('div', { class: 'ev-h' }, 'Real, but no date the pack will stand behind'));
        for (const s of unpatterned) pane.append(eventRow(s, t));
      }
      const ended = list.filter((s) => s.ended);
      if (ended.length) {
        pane.append(el('div', { class: 'ev-h' }, 'Ended'));
        for (const s of ended) pane.append(eventRow(s, t));
      }
      return pane;
    }

    function eventRow(s, t) {
      const r = s.rec;
      const on = view.eventId === r.id;
      const att = r.attendance || {};
      return el('div', { class: 'ev-card pick' + (on ? ' on' : ''), onclick: () => { view.eventId = r.id; refresh(true); } },
        s.occ
          ? el('div', { class: 'ev-when' }, fmtSpan(s.occ.start, s.occ.end), el('em', {}, awayText(s.occ.start - t)))
          : el('div', { class: 'ev-when' }, s.ended ? 'no longer runs' : 'no fixed date'),
        el('h4', {}, r.name),
        el('div', { class: 'ev-chips' },
          chip(CATEGORY_CHIP[r.category] || 'iron', r.category.replace(/-/g, ' ')),
          r.status === 'unconfirmed' ? chip('sun', 'unconfirmed') : null,
          s.occ && s.occ.sourced ? chip('leaf', 'published date') : s.occ ? chip('iron', 'from the pattern') : null,
          att.typical ? chip('sea', num(att.typical) + ' at peak') : null));
    }

    function todayCard(pk) {
      const t = today();
      const active = activePeriods(pk, t, t);
      const card = el('div', { class: 'ev-card' },
        el('div', { class: 'ev-when' }, world.clock.formatDate()),
        el('div', { class: 'ev-quiet' }, world.clock.season.name + '. ' + world.clock.season.marker));
      if (active.length) {
        card.append(el('div', { class: 'ev-chips' }, active.map((a) => chip(a.mult >= 2.5 ? 'coral' : a.mult >= 1.5 ? 'sun' : 'leaf', a.label))));
      }
      const onToday = schedule().filter((s) => s.occ && s.occ.start <= t && s.occ.end >= t);
      card.append(el('div', { class: 'ev-quiet', style: { marginTop: '8px' } },
        onToday.length ? 'On today: ' + onToday.map((s) => s.rec.name).join(', ') + '.' : 'Nothing dated on today.'));
      const v = world.read('visitors');
      if (v && v.ready) {
        card.append(el('div', { class: 'ev-nums' },
          el('div', { class: 'ev-num' }, el('b', {}, bind((w) => num(w.read('visitors').onIsland))), el('i', {}, 'here now')),
          el('div', { class: 'ev-num' }, el('b', {}, bind((w) => num(w.read('visitors').arrivalsToday))), el('i', {}, 'arrived today')),
          el('div', { class: 'ev-num' }, el('b', {}, bind((w) => (w.read('visitors').pressure || 0).toFixed(2))), el('i', {}, 'pressure'))));
      }
      return card;
    }

    /** Which load periods and seasons contain a span. */
    function activePeriods(pk, from, to) {
      const out = [];
      for (const p of pk.periods || []) {
        for (const o of p.occurrences_2026 || []) {
          const s = parseISO(o.start), e = parseISO(o.end);
          if (s == null || e == null) continue;
          if (e < from || s > to) continue;
          out.push({
            id: p.id, label: (o.label ? p.name + ', ' + o.label : p.name), mult: o.load_multiplier || 1,
            note: o.note || '', period: p, occ: o
          });
        }
      }
      return out;
    }

    /* --- column two: the detail ------------------------------------- */

    function detailColumn(pk) {
      const pane = el('div', { class: 'ev-pane pad' });
      const t = today();
      const s = schedule().find((x) => x.rec.id === view.eventId) || schedule().find((x) => x.occ);
      if (!s) {
        pane.append(el('div', { class: 'ev-h' }, 'Pick something'),
          el('div', { class: 'ev-p' }, 'Every record carries what it needs, what it strains, who earns from it and an hourly crowd curve, so a day on this island can be run from the data rather than invented.'));
        return pane;
      }
      const r = s.rec;

      pane.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-xl)', lineHeight: '1.25' } }, r.name));
      if (r.also_known_as && r.also_known_as.length) {
        pane.append(el('div', { class: 'ev-quiet', style: { marginTop: '3px' } }, 'Also called ' + r.also_known_as.join(', ') + '.'));
      }
      pane.append(el('div', { class: 'ev-p', style: { marginTop: '8px', maxWidth: '92ch' } }, txt(r.description)));

      if (r.status === 'ended' && r.ended) {
        const e = r.ended;
        pane.append(el('div', { class: 'ev-banner gone' },
          el('b', {}, 'This has ended on the island. '),
          txt(e.final_island_edition) + ', after ' + e.editions + ' editions, about ' + num(e.final_attendance) + ' people. ' + txt(e.director_wording)));
        pane.append(el('div', { class: 'ev-h' }, 'Why it stopped, which is the part that is a civic lever'));
        for (const why of e.reasons || []) pane.append(el('div', { class: 'ev-item' }, el('div', { class: 'body' }, txt(why))));
        if (e.council_position) pane.append(el('div', { class: 'ev-quiet', style: { marginTop: '8px' } }, txt(e.council_position)));
      } else if (r.status === 'unconfirmed') {
        pane.append(el('div', { class: 'ev-banner' },
          el('b', {}, 'Unconfirmed. '),
          'This is a real thing on this island, but nothing public could be found to confirm it still runs on this pattern. The date below is the best the pack has, not a promise.'));
      }

      if (r.cultural_handling) {
        pane.append(el('div', { class: 'ev-banner stop' },
          el('b', {}, 'Held as civic load only. '),
          'This project records the dates, the crowd, the ferries, the bins and the money, and nothing else. No programme and no cultural material is held in this data, and none will be generated. That belongs to the organisations that run it.'));
      }

      /* when */
      pane.append(el('div', { class: 'ev-h' }, 'When'));
      if (s.occ) {
        pane.append(el('div', { class: 'ev-when', style: { fontSize: 'var(--fs-lg)' } },
          fmtSpan(s.occ.start, s.occ.end), el('em', {}, awayText(s.occ.start - t))));
      }
      const kv = [];
      kv.push(['Pattern', ruleText(r.date_rule)]);
      if (r.date_rule && r.date_rule.note) kv.push(['Note', txt(r.date_rule.note)]);
      if (r.typical_hours) kv.push(['Hours', r.typical_hours.start + ' to ' + r.typical_hours.end + ' (' + txt(r.typical_hours.basis) + (r.typical_hours.note ? '. ' + txt(r.typical_hours.note) : '') + ')']);
      if (r.place_ids && r.place_ids.length) kv.push(['Where', r.place_ids.map(placeName).join(', ') + (r.place_note ? '. ' + txt(r.place_note) : '')]);
      if (r.organiser) kv.push(['Run by', txt(r.organiser)]);
      const dl = el('div', {});
      for (const [k, v] of kv) dl.append(el('div', { class: 'ev-item' }, el('div', { class: 'body' }, el('div', {}, k), el('em', {}, v))));
      pane.append(dl);
      if (s.all && s.all.length > 1) {
        pane.append(el('div', { class: 'ev-quiet' }, 'Then again on ' + s.all.slice(1, 4).map((o) => fmtSpan(o.start, o.end)).join(', ') + '.'));
      }

      /* how many */
      if (r.attendance) {
        pane.append(el('div', { class: 'ev-h' }, 'How many, at the busiest moment'));
        pane.append(attendanceBand(r, s, t));
      }

      /* crowd curve */
      if (r.crowd_curve && r.crowd_curve.hours) pane.append(crowdCurve(r, s, t));

      /* strain */
      if (r.strains && r.strains.length) {
        pane.append(el('div', { class: 'ev-h' }, 'What it strains'));
        for (const st of r.strains) {
          pane.append(el('div', { class: 'ev-item' },
            levelBar(st.level),
            el('div', { class: 'body' },
              el('div', {}, st.system.replace(/-/g, ' ') + ' · level ' + st.level),
              st.note ? el('em', {}, txt(st.note)) : null)));
        }
        pane.append(el('div', { class: 'ev-quiet' },
          'Level 1 is noticed by the people running it. Level 3 is noticed by residents who are not attending. Level 5 means the island’s capacity is the binding constraint and something fails.'));
      }

      /* needs against the island's ceiling */
      if (r.needs) {
        pane.append(el('div', { class: 'ev-h' }, 'What it needs'));
        const order = ['parking_spaces', 'toilets_extra', 'waste_extra_bins', 'ferry_capacity', 'potable_water', 'traffic_management', 'power', 'camping', 'shuttle', 'beach_access'];
        const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
        const keys = Object.keys(r.needs).filter((k) => k !== 'basis').sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
        for (const k of keys) {
          pane.append(el('div', { class: 'ev-item' },
            el('div', { class: 'body' },
              el('div', {}, k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) + ': ' + (typeof r.needs[k] === 'number' ? num(r.needs[k]) : txt(r.needs[k]))))));
        }
        const f = world.read('ferry');
        if (f && f.importCeiling) {
          pane.append(el('div', { class: 'ev-p', style: { marginTop: '10px' } },
            el('strong', {}, 'Against the island’s whole day: '),
            num(f.importCeiling.carsEachWay) + ' vehicle spaces and ' + num(f.importCeiling.walkOnSeatsEachWay) +
            ' walk-on seats each way. ' + f.importCeiling.rule));
        }
        if (r.needs.basis) pane.append(el('div', { class: 'ev-quiet' }, 'Basis: ' + r.needs.basis + '. No event management plan, traffic management plan or permit condition was read for any event in this pack.'));
      }

      /* who earns */
      if (r.revenue_to && r.revenue_to.length) {
        pane.append(el('div', { class: 'ev-h' }, 'Who earns from it'));
        const tb = el('table', { class: 'ev-table' });
        const body = el('tbody', {});
        tb.append(el('thead', {}, el('tr', {}, el('th', {}, 'Business'), el('th', {}, 'Effect'), el('th', {}, 'Note'))), body);
        for (const rv of r.revenue_to) {
          const b = bizName(rv.business_id);
          body.append(el('tr', {},
            el('td', {}, b.name + (b.note ? ' (' + b.note + ')' : '')),
            el('td', {}, rv.effect),
            el('td', {}, txt(rv.note))));
        }
        pane.append(tb);
        pane.append(el('div', { class: 'ev-quiet' }, 'Every trade link here is plausible rather than measured. Business records resolve against data/businesses.json.'));
      }

      /* who comes */
      if (r.archetype_mix) {
        pane.append(el('div', { class: 'ev-h' }, 'Who the crowd is'));
        const arch = (pack().visitor_archetypes || []);
        const rows = Object.entries(r.archetype_mix).sort((a, b) => b[1] - a[1]);
        for (const [id, share] of rows) {
          const a = arch.find((x) => x.id === id);
          pane.append(el('div', { class: 'ev-item' },
            el('div', { class: 'body' },
              el('div', {}, Math.round(share * 100) + ' per cent ' + (a ? a.name.toLowerCase() : id.replace(/-/g, ' '))),
              a ? el('em', {}, txt(a.description)) : null)));
        }
      }

      /* weather */
      if (r.weather_sensitivity) pane.append(weatherBlock(r, s, t));

      /* periods it lands in */
      if (s.occ) {
        const laps = activePeriods(pack(), s.occ.start, s.occ.end);
        if (laps.length) {
          pane.append(el('div', { class: 'ev-h' }, 'What else is happening that week'));
          for (const a of laps) {
            pane.append(el('div', { class: 'ev-item' },
              el('div', { class: 'body' },
                el('div', {}, a.label + (a.mult ? ' · visitor baseline ×' + a.mult : '')),
                el('em', {}, txt(a.note || a.period.description.split('. ')[0] + '.')))));
          }
          pane.append(el('div', { class: 'ev-quiet' }, 'A period multiplier applies to the visitor baseline, never to the resident population, and never to the event’s own crowd.'));
        }
      }

      pane.append(el('div', { class: 'ev-src' },
        'Confidence: ' + (r.confidence || 'not stated') + '. Source: ' + (r.source || 'not recorded') +
        (r.notes ? '. ' + txt(r.notes) : '')));
      return pane;
    }

    function levelBar(level) {
      const box = el('div', { class: 'ev-lvl', title: 'Strain level ' + level + ' of 5' });
      for (let i = 1; i <= 5; i++) box.append(el('i', { class: i <= level ? 'on' + level : '' }));
      return box;
    }

    function attendanceBand(r, s, t) {
      const a = r.attendance;
      const wrap = el('div', {});
      const lo = a.low || 0, hi = a.high || a.typical || 1, ty = a.typical || 0;
      const pos = (v) => clamp((v - lo) / Math.max(1, hi - lo), 0, 1) * 100;
      const rangeEl = el('div', { class: 'ev-range' },
        el('div', { class: 'bar' }),
        el('div', { class: 'band', style: { left: '0%', right: '0%' } }),
        el('div', { class: 'pin', style: { left: pos(ty) + '%' } }),
        el('span', { style: { left: '0%' } }, num(lo)),
        el('span', { style: { right: '0%' } }, num(hi)));

      /* weather, but only close enough for today's weather to mean anything */
      const days = s.occ ? s.occ.start - t : 999;
      let adj = null;
      if (days <= 3 && r.weather_sensitivity) {
        const wx = world.read('weather');
        if (wx) {
          const sev = {
            rain: clamp((wx.rainMmHr || 0) / 6, 0, 1),
            wind: clamp(((wx.windKt || 0) - 15) / 25, 0, 1),
            heat: clamp(((wx.tempC || 0) - 30) / 8, 0, 1)
          };
          let mult = 1;
          for (const k of ['rain', 'wind', 'heat']) mult *= (1 - (r.weather_sensitivity[k] || 0) * sev[k]);
          adj = Math.round(ty * mult);
          if (Math.abs(adj - ty) < Math.max(1, ty * 0.02)) adj = null;
          else rangeEl.append(el('div', { class: 'pin alt', style: { left: pos(adj) + '%' } }));
        }
      }
      wrap.append(rangeEl);
      wrap.append(el('div', { class: 'ev-nums' },
        el('div', { class: 'ev-num' }, el('b', {}, num(ty)), el('i', {}, 'typical peak')),
        a.cumulative_over_event ? el('div', { class: 'ev-num' }, el('b', {}, num(a.cumulative_over_event)), el('i', {}, 'across the event')) : null,
        adj != null ? el('div', { class: 'ev-num' }, el('b', {}, num(adj)), el('i', {}, 'if today’s weather held')) : null));
      wrap.append(el('div', { class: 'ev-quiet' },
        'People on site at the busiest moment, not tickets sold. Basis: ' + txt(a.basis || 'estimate') +
        ', ' + (a.confidence || 'low') + ' confidence.' +
        (a.source ? ' Source: ' + a.source : ' Nobody publishes gate counts for this island.')));
      return wrap;
    }

    function crowdCurve(r, s, t) {
      const wrap = el('div', {});
      wrap.append(el('div', { class: 'ev-h' }, 'The hour by hour'));
      const hours = r.crowd_curve.hours || [];
      const peak = (r.attendance && r.attendance.typical) || 100;
      const W = 720, H = 150, pad = 26, bw = (W - pad * 2) / 24;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      g.setAttribute('viewBox', `0 0 ${W} ${H}`);
      g.setAttribute('class', 'ev-curve');
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', 'Crowd on site by hour of the day');
      const mk = (tag, attrs, text) => {
        const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
        if (text != null) n.textContent = text;
        g.append(n);
        return n;
      };
      const top = 16, base = H - 26;
      let peakHour = 0;
      hours.forEach((v, i) => { if (v > hours[peakHour]) peakHour = i; });
      hours.forEach((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, (base - top) * clamp(v, 0, 1));
        mk('rect', {
          x: pad + i * bw + 1, y: base - h, width: bw - 2, height: h, rx: 1.5,
          fill: i === peakHour ? 'var(--sea)' : 'rgba(63,182,196,.35)'
        });
      });
      for (let i = 0; i < 24; i += 3) mk('text', { x: pad + i * bw + bw / 2, y: H - 12, 'text-anchor': 'middle' }, i === 0 ? '12am' : i === 12 ? '12pm' : (i > 12 ? (i - 12) + 'pm' : i + 'am'));
      mk('line', { x1: pad, y1: base, x2: W - pad, y2: base, stroke: 'var(--edge)', 'stroke-width': 1 });
      mk('text', { x: pad, y: 11, class: 'lbl' }, 'about ' + num(peak * clamp(hours[peakHour] || 0, 0, 1)) + ' on site at ' + hhmm(peakHour * 60));

      /* the last boat, which is the real closing time of every evening event here */
      const lastX = pad + (20 + 15 / 60) * bw;
      mk('line', { x1: lastX, y1: top - 6, x2: lastX, y2: base, stroke: 'var(--coral)', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
      mk('text', { x: lastX - 4, y: top - 8, 'text-anchor': 'end', class: 'lbl', fill: 'var(--coral)' }, 'last water taxi, about 8.15pm');

      if (s.occ && s.occ.start <= t && s.occ.end >= t) {
        const nowX = pad + (world.clock.minuteOfDay / 60) * bw;
        mk('line', { x1: nowX, y1: top - 6, x2: nowX, y2: base, stroke: 'var(--sun)', 'stroke-width': 1.5 });
        mk('text', { x: nowX + 4, y: top - 8, class: 'lbl', fill: 'var(--sun)' }, 'now');
      }
      wrap.append(g);
      wrap.append(el('div', { class: 'ev-quiet' },
        'Each bar is that hour’s share of the event’s own peak. Basis: ' + (r.crowd_curve.basis || 'estimate') +
        (r.crowd_curve.note ? '. ' + txt(r.crowd_curve.note) : '') +
        '. The curves are shaped from published start and finish times where those exist, and from the ferry timetable where they do not.'));
      return wrap;
    }

    function weatherBlock(r, s, t) {
      const wrap = el('div', {});
      wrap.append(el('div', { class: 'ev-h' }, 'What weather does to it'));
      const ws = r.weather_sensitivity;
      const rows = [['rain', 'Rain'], ['wind', 'Wind'], ['swell', 'Swell'], ['heat', 'Heat']];
      const tb = el('table', { class: 'ev-table' });
      const body = el('tbody', {});
      tb.append(el('thead', {}, el('tr', {}, el('th', {}, 'Driver'), el('th', { class: 'n' }, 'Sensitivity'), el('th', {}, 'Right now'))), body);
      const wx = world.read('weather');
      for (const [k, label] of rows) {
        if (!ws[k]) continue;
        const now = wx ? (k === 'rain' ? (wx.rainMmHr || 0).toFixed(1) + ' mm/h'
          : k === 'wind' ? Math.round(wx.windKt || 0) + ' kt'
            : k === 'swell' ? (wx.swellM || 0).toFixed(1) + ' m'
              : Math.round(wx.tempC || 0) + '°C') : 'not built';
        body.append(el('tr', {}, el('td', {}, label), el('td', { class: 'n' }, ws[k].toFixed(2)), el('td', {}, now)));
      }
      wrap.append(tb);
      if (ws.cancels_if) wrap.append(el('div', { class: 'ev-p', style: { marginTop: '8px' } }, el('strong', {}, 'Called off if: '), txt(ws.cancels_if)));
      if (ws.note) wrap.append(el('div', { class: 'ev-quiet' }, txt(ws.note)));
      wrap.append(el('div', { class: 'ev-quiet' },
        'A sensitivity of 1 means the event does not happen in that condition. The forecast above only applies today’s weather when the event is within three days, because weather three months out is not a forecast, it is a guess.'));
      return wrap;
    }

    /* --- column three: the rhythms ----------------------------------- */

    function rhythmColumn(pk) {
      const pane = el('div', { class: 'ev-pane' });
      const t = today();

      pane.append(el('div', { class: 'ev-h' }, 'Bin night'));
      pane.append(binCard(pk, t));

      pane.append(el('div', { class: 'ev-h' }, 'The barge'));
      pane.append(bargeCard(pk));

      pane.append(el('div', { class: 'ev-h' }, 'School'));
      pane.append(schoolCard(pk, t));

      pane.append(el('div', { class: 'ev-h' }, 'The fishing window'));
      pane.append(tideCard(pk));

      pane.append(el('div', { class: 'ev-h' }, 'The weekly wave'));
      pane.append(weeklyCard(pk, t));

      pane.append(el('div', { class: 'ev-h' }, 'Seasons and load'));
      pane.append(el('div', { class: 'ev-quiet', style: { marginBottom: '8px' } },
        'The pack holds published occurrence dates for 2026. Past that it holds the pattern and stops claiming a date, so these read "not this year" rather than guessing one.'));
      for (const p of pk.periods || []) {
        const now = activePeriods(pk, t, t).some((a) => a.id === p.id);
        const next = (p.occurrences_2026 || []).map((o) => ({ o, s: parseISO(o.start) })).filter((x) => x.s != null && x.s >= t).sort((a, b) => a.s - b.s)[0];
        pane.append(el('div', { class: 'ev-card' },
          el('h4', {}, p.name),
          el('div', { class: 'ev-chips' },
            now ? chip('sea', 'on now') : next ? chip('iron', awayText(next.s - t)) : chip('iron', 'not this year'),
            chip('heath', p.kind.replace(/-/g, ' '))),
          el('div', { class: 'ev-quiet', style: { marginTop: '6px' } }, txt(p.description.split('. ').slice(0, 2).join('. ') + '.')),
          el('div', { class: 'ev-src' }, 'Source: ' + (p.source || 'not recorded'))));
      }

      pane.append(el('div', { class: 'ev-h' }, 'What is not in this calendar'));
      pane.append(el('div', { class: 'ev-quiet', style: { marginBottom: '8px' } },
        'The pack keeps a list of the things it was asked for and would not invent. On an island this size, a calendar that quietly filled its own gaps would be caught by lunchtime.'));
      for (const g of pk.left_out || []) {
        pane.append(el('div', { class: 'ev-item' }, el('div', { class: 'body' }, el('div', {}, txt(g.name)), el('em', {}, txt(g.reason)))));
      }
      return pane;
    }

    function rhythm(pk, id) { return (pk.rhythms || []).find((r) => r.id === id) || null; }

    function binCard(pk, t) {
      const r = rhythm(pk, 'bin-day');
      const card = el('div', { class: 'ev-card' });
      if (!r) { card.append(el('div', { class: 'ev-quiet' }, 'No bin record.')); return card; }
      const want = WD[(r.cycle && r.cycle.weekday) || 'monday'];
      const daysTo = (((want - dowOf(t)) % 7) + 7) % 7;
      const nextBin = t + daysTo;
      const hol = ((pk.reference_2026 || {}).queensland_public_holidays || []).find((h) => parseISO(h.date) === nextBin);
      card.append(el('div', { class: 'ev-when' }, fmtDay(nextBin), el('em', {}, daysTo === 0 ? 'today' : awayText(daysTo))));
      card.append(el('div', { class: 'ev-quiet' }, 'Bins out ' + (r.cycle.put_out || 'the afternoon before') + ', because collection can start very early.'));
      if (hol) {
        card.append(el('div', { class: 'ev-banner', style: { marginTop: '8px', marginBottom: 0 } },
          el('b', {}, hol.name + ' falls on collection day. '),
          'A Monday public holiday and a Monday bin collection is the specific failure the pack names.'));
      }
      const lw = ((pk.reference_2026 || {}).long_weekends || []).find((x) => { const s = parseISO(x.start), e = parseISO(x.end); return s != null && nextBin >= s - 1 && nextBin <= e + 1; });
      if (lw) card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } }, lw.anchor + ' runs into this collection, so the island makes four days of rubbish before anything is taken away.'));
      const w = world.read('waste');
      if (w && w.ready) {
        const b = world.read('budget');
        card.append(el('div', { class: 'ev-nums' },
          b && b.waste ? el('div', { class: 'ev-num' }, el('b', {}, bind((ww) => num(ww.read('budget').waste.tonnesPerYearRate))), el('i', {}, 'tonnes a year')) : null,
          b && b.waste ? el('div', { class: 'ev-num' }, el('b', {}, 'A$' + b.waste.costPerTonne), el('i', {}, 'a tonne, on a boat')) : null));
      }
      card.append(el('div', { class: 'ev-src' }, txt(r.notes) + ' Source: ' + (r.source || 'not recorded')));
      return card;
    }

    function bargeCard(pk) {
      const r = rhythm(pk, 'vehicle-barge');
      const card = el('div', { class: 'ev-card' });
      const f = world.read('ferry');
      if (r) {
        card.append(el('div', { class: 'ev-quiet' },
          'Roughly hourly from about ' + (r.cycle.first_departure_cleveland || '06:00') + ' to about ' +
          (r.cycle.last_departure_approx || '19:00') + ', crossing about ' + (r.cycle.crossing_minutes || 47) + ' minutes. ' +
          'Every vehicle, every pallet of groceries, every skip bin and every ambulance transfer moves on this.'));
      }
      if (f && f.ready) {
        card.append(el('div', { class: 'ev-nums' },
          el('div', { class: 'ev-num' }, el('b', {}, bind((w) => num(w.read('ferry').deck.slotsLeftToday))), el('i', {}, 'vehicle slots left')),
          el('div', { class: 'ev-num' }, el('b', {}, bind((w) => num(w.read('ferry').walkOn.seatsLeftToday))), el('i', {}, 'walk-on seats left')),
          el('div', { class: 'ev-num' },
            el('b', { style: { color: f.walkOn.turnedAwayToday > 0 ? 'var(--coral)' : null } },
              bind((w) => num(w.read('ferry').walkOn.turnedAwayToday))),
            el('i', {}, 'turned away today'))));
        card.append(el('div', { class: 'ev-track', style: { marginTop: '8px' } },
          bindW(el('i'), (w) => {
            const ff = w.read('ferry');
            const used = ff.deck.slotsToday - ff.deck.slotsLeftToday;
            return Math.round(clamp(used / Math.max(1, ff.deck.slotsToday), 0, 1) * 100) + '%';
          })));
        const next = (f.sailings || []).filter((x) => x.status !== 'arrived').slice(0, 4);
        if (next.length) {
          card.append(el('div', { class: 'ev-h', style: { marginTop: '10px' } }, 'Next sailings'));
          for (const s of next) {
            card.append(el('div', { class: 'ev-item' }, el('div', { class: 'body' },
              el('div', {}, s.time + ' · ' + (s.dir === 'to-island' ? 'to the island' : 'to the mainland')),
              el('em', {}, s.vessel + ' · ' + s.kind + (s.extra ? ' · extra sailing' : '') + (s.why ? ' · ' + s.why : '')))));
          }
        }
      } else {
        card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } }, 'The ferry system is not publishing, so no live sailing is shown.'));
      }
      if (r) card.append(el('div', { class: 'ev-src' }, txt(r.notes), ' Source: ' + (r.source || 'not recorded')));
      return card;
    }

    function schoolCard(pk, t) {
      const r = rhythm(pk, 'school-run');
      const ref = pk.reference_2026 || {};
      const card = el('div', { class: 'ev-card' });
      const terms = ref.queensland_state_school_terms || [];
      const hols = ref.queensland_state_school_holidays || [];
      const inTerm = terms.find((x) => { const s = parseISO(x.start), e = parseISO(x.end); return s != null && t >= s && t <= e; });
      const inHol = hols.find((x) => { const s = parseISO(x.start), e = parseISO(x.end); return s != null && t >= s && t <= e; });
      if (inTerm) {
        card.append(el('div', { class: 'ev-when' }, 'Term ' + inTerm.term, el('em', {}, 'ends ' + fmtDay(parseISO(inTerm.end)))));
      } else if (inHol) {
        card.append(el('div', { class: 'ev-when' }, inHol.label + ' holidays', el('em', {}, 'until ' + fmtDay(parseISO(inHol.end)))));
      } else {
        card.append(el('div', { class: 'ev-when' }, world.clock.isQldSchoolHoliday ? 'School holidays' : 'School term',
          el('em', {}, 'from the simulation’s own rule')));
        card.append(el('div', { class: 'ev-quiet' }, 'The published term dates in the pack cover 2026. Beyond that this line falls back to the clock’s own approximation and says so.'));
      }
      if (r) {
        card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } },
          'Dunwich State School on Bingle Road is the only school on the island and takes Prep to Year 6 from all three townships. Dunwich State High School closed in 2012, so every island secondary student now crosses to Cleveland: a water taxi out about ' +
          (r.cycle.secondary_ferry_out_approx || '06:30') + ' and back about ' + (r.cycle.secondary_ferry_back_approx || '16:00') + ', every school day.'));
        const hh = (r.strains || []).find((x) => x.system === 'household-time');
        if (hh) card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } }, hh.note));
        card.append(el('div', { class: 'ev-src' }, 'Source: ' + (r.source || 'not recorded') + (r.school_closure_source ? '; ' + r.school_closure_source : '')));
      }
      return card;
    }

    function tideCard(pk) {
      const r = rhythm(pk, 'tide-fishing-window');
      const card = el('div', { class: 'ev-card' });
      const tide = world.read('tide');
      if (!tide) { card.append(el('div', { class: 'ev-quiet' }, 'The tide system is not publishing.')); return card; }
      const window = (r && r.cycle && r.cycle.working_window_hours_either_side_of_change) || 2;
      card.append(el('div', { class: 'ev-quiet' },
        'It runs on water movement, not on a clock: the run-in and the run-out about ' + window +
        ' hours either side of a change. Around the South Passage and the bar off Amity Point the tide is a safety limit rather than a preference.'));
      const rows = (tide.next || []).slice(0, 3);
      for (const n of rows) {
        const at = world.clock.minuteOfDay + n.inHours * 60;
        card.append(el('div', { class: 'ev-item' },
          el('div', { class: 'body' },
            el('div', {}, n.kind + ' water ' + n.height.toFixed(2) + ' m at about ' + hhmm(at)),
            el('em', {}, 'working window about ' + hhmm(at - window * 60) + ' to ' + hhmm(at + window * 60)))));
      }
      const wx = world.read('weather');
      if (wx) {
        const rough = (wx.swellM || 0) > 2 || (wx.windKt || 0) > 22;
        card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } },
          'Right now: ' + (wx.swellM || 0).toFixed(1) + ' m swell, ' + Math.round(wx.windKt || 0) + ' knots, the crossing is ' +
          (wx.crossingCondition || 'unrated') + '. ' + (rough ? 'That is a morning where the bar makes the decision, not the fish.' : 'A workable morning on the water.')));
      }
      if (r) card.append(el('div', { class: 'ev-src' }, txt(r.notes), ' Source: ' + (r.source || 'not recorded')));
      return card;
    }

    function weeklyCard(pk, t) {
      const fri = rhythm(pk, 'friday-afternoon-arrivals');
      const sun = rhythm(pk, 'sunday-afternoon-departures');
      const card = el('div', { class: 'ev-card' });
      const d = dowOf(t);
      const which = d === 5 ? fri : d === 0 ? sun : (d < 5 ? fri : sun);
      const daysTo = d === 5 ? 0 : d === 0 ? 0 : (which === fri ? (5 - d + 7) % 7 : (0 - d + 7) % 7);
      if (which) {
        card.append(el('div', { class: 'ev-when' }, which.name, el('em', {}, daysTo === 0 ? 'today' : awayText(daysTo))));
        card.append(el('div', { class: 'ev-quiet' }, txt(which.description)));
        if (which.load_multiplier) card.append(el('div', { class: 'ev-quiet', style: { marginTop: '6px' } },
          'Visitor baseline ×' + which.load_multiplier.value + '. ' + txt(which.load_multiplier.note)));
        if (which.sim_hint) card.append(el('div', { class: 'ev-p', style: { marginTop: '8px' } }, el('strong', {}, 'The small civic puzzle: '), txt(which.sim_hint)));
        card.append(el('div', { class: 'ev-src' }, 'Source: ' + (which.source || 'not recorded')));
      }
      return card;
    }

    /* ------------------------------------------------------------------ */

    return {
      update(w) {
        const soon = schedule().filter((x) => x.occ && x.days >= 0 && x.days <= 7).length;
        const txt = soon ? String(soon) : '';
        if (badge.textContent !== txt) badge.textContent = txt;
        if (!open) return;
        refresh(false);
      }
    };
  }
});
