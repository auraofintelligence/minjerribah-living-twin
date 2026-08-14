// The civic board.
//
// Democracy 4 puts you in the chair. You are the government, the levers are yours, and pulling one is
// a click. This board is built on the opposite fact, and it is the truest thing about this island:
// most of the researched levers in data/civic.json are not the player's. They belong to Redland City
// Council, the Queensland Government, the Commonwealth, Queensland Parks, QYAC as native title
// holder, a joint management arrangement, private ferry operators, a former mine operator, and in one
// case to nobody at all. So the first thing every lever on this board shows is who decides it, and the
// board never offers an action the player does not actually have.
//
// NOT ONE NUMBER ON THIS SCREEN IS TYPED IN. An earlier version of this comment said the player
// decides twenty-one levers, and by the time anybody read it the answer was nineteen. Every count
// the board prints, the split, the body list, the tier list, the number of decision makers, is
// counted out of the pack at the moment it is drawn. If you find yourself writing a number in this
// file, that is the bug.
//
// THE FOURTH TIER, AND WHY IT DID NOT TURN THIS INTO A WALL OF BODIES. The Commonwealth was missing
// from the pack entirely and it binds real decisions here: national environment law over the Ramsar
// wetland the island sits in and the listed shorebirds on its western flats, the Native Title Act
// under which QYAC exists at all, telecommunications, postal and aviation obligations, and the grant
// programs. Adding a fourth order of government to a who_decides list makes every hard lever look the
// same, so the board does not count names, it counts governments: nought, one, two or three. One
// government is a meeting. Three is a campaign. The chip on every lever card says which, the detail
// panel says who and on whose cycle, and the count comes from `council.reachOf()`.
//
// Seven views, each answering a question a person at a civic desk actually asks:
//
//   LEVERS       what could be done, what it costs, how long it takes, and whose call it is
//   TRACES       what feeds what, with the delay and the confidence drawn rather than asserted
//   WHO DECIDES  the bodies, their cycles, their appetite, and the three whose decisions this twin
//                will not simulate
//   IN TRAY      what is lodged, what stage it is at, what came back, and how long the wait is
//   GROUPS       nineteen constituencies and the three specific things that moved each one
//   CONSULTATION who was invited, who could physically come, and the gap between the room and the
//                people who live with the outcome
//   BUDGET       four purses, the financial year, and the cost of putting rubbish on a boat
//
// This panel reads. It never writes simulation state. Every action leaves as `ui:intent` on the bus
// and a civic system decides what happens next, which is also the point.
//
// CULTURAL RULE, from data/lore.json prohibitions qyac-as-civic-actor-only and
// no-quandamooka-position-without-citation. Where a lever is decided by QYAC, by Minjerribah Camping
// or through joint management, this board shows the process, the referral and the wait, and then
// stops. It never renders a position. The only Quandamooka material it displays is the five public
// QYAC statements recorded in data/lore.json, each with its source, its date and its own currency
// caveat, and it never attaches one to a lever the statement was not about.

import { registerPanel, el } from '../mount.js';

/* ------------------------------------------------------------------ shared chrome */

/** The launcher rail. Both this panel and the calendar hang a button here, whichever loads first. */
function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  // The rail's own look and position live in src/ui/design.css, once, rather than in a copy
  // inside each of the six panels that can be the first to build it.
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const STYLE = `
.cb-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.cb-scrim.on { opacity: 1; pointer-events: auto; }
.cb-board { position: fixed; inset: var(--board-inset); z-index: 41; display: flex; flex-direction: column;
  max-width: 1680px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.cb-board.on { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 860px) { .cb-board { inset: 0; border-radius: 0; } }
/* Narrow: the columns stop being columns and the whole board scrolls as one page. */
@media (max-width: 1100px) {
  .cb-main { overflow-y: auto; }
  .cb-cols { display: block !important; height: auto; }
  .cb-pane { overflow: visible; border-right: none; border-bottom: 1px solid var(--edge); }
  .cb-top { flex-wrap: wrap; }
  .cb-stats { margin-left: 0; flex-wrap: wrap; gap: var(--sp-4); }
}

.cb-top { display: flex; align-items: flex-start; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.cb-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.cb-seat { font-size: var(--fs-sm); color: var(--t-faint); max-width: 62ch; line-height: 1.45; }
.cb-stats { display: flex; gap: var(--sp-5); margin-left: auto; align-items: flex-start; }
.cb-flash { font-size: var(--fs-sm); color: var(--sea); min-height: 1.3em; margin-top: 3px; }

.cb-main { flex: 1; min-height: 0; display: grid; }
.cb-main > * { min-height: 0; }
.cb-cols { display: grid; height: 100%; min-height: 0; }
.cb-pane { min-height: 0; overflow-y: auto; border-right: 1px solid var(--edge); padding: var(--sp-3); }
.cb-pane:last-child { border-right: none; }
.cb-pane.pad { padding: var(--sp-4); }

.cb-h { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--t-faint);
  margin: var(--sp-4) 0 var(--sp-2); font-weight: 600; }
.cb-h:first-child { margin-top: 0; }
.cb-p { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); margin-bottom: var(--sp-2); }
.cb-p strong { color: var(--t-hi); font-weight: 500; }
.cb-src { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.5; margin-top: var(--sp-2);
  padding-top: var(--sp-2); border-top: 1px solid var(--edge); }
.cb-quiet { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.5; }

.cb-card { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3);
  margin-bottom: var(--sp-2); background: rgba(255,255,255,.022); }
.cb-card.pick { cursor: pointer; transition: border-color var(--fast), background var(--fast); }
.cb-card.pick:hover { border-color: var(--edge-strong); background: rgba(255,255,255,.05); }
.cb-card.on { border-color: var(--sea); background: rgba(63,182,196,.10); }
.cb-card h4 { color: var(--t-hi); font-size: var(--fs-base); font-weight: 500; line-height: 1.35; }
.cb-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.cb-nums { display: flex; gap: var(--sp-4); margin-top: 8px; }
.cb-num { display: flex; flex-direction: column; }
.cb-num b { font: 400 var(--fs-base)/1.1 var(--f-num); color: var(--t); font-variant-numeric: tabular-nums; }
.cb-num i { font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase;
  color: var(--t-faint); font-style: normal; margin-top: 2px; }

.cb-who { display: flex; align-items: baseline; gap: 6px; margin-top: 8px; font-size: var(--fs-sm);
  padding: 6px 8px; border-radius: var(--r-2); background: var(--s-sunk); line-height: 1.45; }
.cb-who b { font-weight: 600; letter-spacing: .06em; font-size: var(--fs-micro); text-transform: uppercase; }
.cb-who span { color: var(--t-dim); }
.cb-who.decides { box-shadow: inset 2px 0 0 var(--sea); } .cb-who.decides b { color: var(--sea); }
.cb-who.funds { box-shadow: inset 2px 0 0 var(--sun); } .cb-who.funds b { color: var(--sun); }
.cb-who.advocates { box-shadow: inset 2px 0 0 var(--iron); } .cb-who.advocates b { color: var(--iron); }
.cb-who.observes { box-shadow: inset 2px 0 0 var(--coral); } .cb-who.observes b { color: var(--coral); }

.cb-kv { display: grid; grid-template-columns: minmax(90px, auto) 1fr; gap: 4px var(--sp-3);
  font-size: var(--fs-sm); align-items: baseline; }
.cb-kv dt { color: var(--t-faint); font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; }
.cb-kv dd { color: var(--t); }

.cb-track { height: 6px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden; position: relative; }
.cb-track > i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--sea);
  transition: width var(--med) var(--ease); }
.cb-track.mid { position: relative; }
.cb-track.mid::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px;
  background: var(--edge-strong); }

.cb-filters { display: flex; gap: var(--sp-2); align-items: center; margin-bottom: var(--sp-3); flex-wrap: wrap; }
.cb-filters input { background: var(--s-sunk); border: 1px solid var(--edge); border-radius: var(--r-2);
  color: var(--t-hi); font: var(--fs-sm) var(--f-ui); padding: 6px 9px; min-width: 150px; flex: 1; }
.cb-filters input:focus { outline: none; border-color: var(--edge-focus); }

.cb-stage { display: flex; gap: 3px; margin: var(--sp-3) 0 6px; }
.cb-stage div { flex: 1; height: 4px; border-radius: var(--r-pill); background: var(--s-sunk); }
.cb-stage div.done { background: var(--sea-deep); }
.cb-stage div.now { background: var(--sea); }
.cb-stage-lbl { display: flex; justify-content: space-between; font-size: var(--fs-micro);
  color: var(--t-faint); letter-spacing: .08em; text-transform: uppercase; }

.cb-item { display: flex; gap: var(--sp-2); align-items: flex-start; padding: 6px 0;
  border-bottom: 1px dashed var(--edge); font-size: var(--fs-sm); }
.cb-item:last-child { border-bottom: none; }
.cb-item .tick { width: 14px; flex: none; text-align: center; font: 700 12px/1.4 var(--f-num); }
.cb-item .tick.held { color: var(--leaf); } .cb-item .tick.wait { color: var(--sun); }
.cb-item .tick.no { color: var(--coral); }
.cb-item .body { flex: 1; min-width: 0; }
.cb-item .body em { display: block; font-style: normal; color: var(--t-faint); font-size: var(--fs-micro);
  line-height: 1.5; margin-top: 2px; }

.cb-grid { display: grid; gap: var(--sp-2); grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
.cb-grid.wide { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }

.cb-mood { height: 5px; border-radius: var(--r-pill); background: var(--s-sunk); position: relative; margin-top: 8px; }
.cb-mood i { position: absolute; top: 0; bottom: 0; border-radius: var(--r-pill); }
.cb-mood::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--edge-strong); }

.cb-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.cb-table th { text-align: left; font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--edge); }
.cb-table td { padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(232,220,196,.06); vertical-align: top; }
.cb-table td.n, .cb-table th.n { font-family: var(--f-num); font-variant-numeric: tabular-nums; text-align: right;
  padding-right: var(--sp-4); white-space: nowrap; }
.cb-table td.n:last-child, .cb-table th.n:last-child { padding-right: 0; }
.cb-table tr.hi td { color: var(--t-hi); }

.cb-graph { width: 100%; height: auto; display: block; }
.cb-graph text { font-family: var(--f-ui); fill: var(--t-dim); }
.cb-graph .nm { fill: var(--t-hi); font-size: 13px; }
.cb-graph .sub { fill: var(--t-faint); font-size: 10.5px; letter-spacing: .08em; }
.cb-graph .edge-lbl { fill: var(--t-faint); font-size: 10px; }
.cb-legend { display: flex; gap: var(--sp-4); flex-wrap: wrap; font-size: var(--fs-micro);
  color: var(--t-faint); margin-top: var(--sp-2); line-height: 1.6; }

.cb-banner { border: 1px solid var(--sun-deep); border-left-width: 3px; border-radius: var(--r-2);
  background: rgba(240,180,41,.09); padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-3);
  font-size: var(--fs-sm); color: var(--t); line-height: 1.5; }
.cb-banner.stop { border-color: var(--heath); background: rgba(180,138,196,.10); }
.cb-banner b { color: var(--t-hi); }

.cb-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--sp-2);
  margin-bottom: var(--sp-3); }
.cb-form label { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-micro);
  letter-spacing: .1em; text-transform: uppercase; color: var(--t-faint); }
.cb-form select, .cb-form input { background: var(--s-sunk); border: 1px solid var(--edge);
  border-radius: var(--r-2); color: var(--t-hi); font: var(--fs-sm) var(--f-ui); padding: 6px 8px; }
.cb-form select:focus, .cb-form input:focus { outline: none; border-color: var(--edge-focus); }

/* Tiers. The pip strip is the one thing on a lever card that answers "how hard is this" without
   being read: one square per order of authority in play, always in the same order, so two cards
   side by side compare at a glance. Squares rather than dots because a dot row reads as a rating. */
.cb-pips { display: inline-flex; gap: 3px; align-items: center; vertical-align: middle; }
.cb-pip { width: 7px; height: 7px; border-radius: 1.5px; display: block; background: var(--iron); }
.cb-pip.heath { background: var(--heath); }
.cb-pip.sun { background: var(--sun); }
.cb-pip.sea { background: var(--sea); }
.cb-pip.leaf { background: var(--leaf); }
.cb-pip.coral { background: var(--coral); }
.cb-pip.iron { background: var(--iron); }

.cb-tiers { display: flex; flex-direction: column; gap: 6px; margin-top: var(--sp-2); }
.cb-tier { display: flex; gap: var(--sp-2); align-items: baseline; font-size: var(--fs-sm);
  padding: 6px 8px; border-radius: var(--r-2); background: var(--s-sunk); line-height: 1.45; }
.cb-tier > .cb-pip { flex: none; margin-top: 5px; }
.cb-tier b { color: var(--t-hi); font-weight: 500; }
.cb-tier em { font-style: normal; color: var(--t-faint); font-size: var(--fs-micro); display: block; margin-top: 2px; }
.cb-tier .who { flex: 1; min-width: 0; }

.cb-tierhead { display: flex; align-items: baseline; gap: var(--sp-2); margin: var(--sp-4) 0 var(--sp-2); }
.cb-tierhead:first-child { margin-top: 0; }
.cb-tierhead .k { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; }
.cb-tierhead .n { font-size: var(--fs-micro); color: var(--t-faint); margin-left: auto;
  font-family: var(--f-num); }

.cb-reach { display: grid; grid-template-columns: 2.6em 1fr auto; gap: 4px var(--sp-2);
  align-items: center; margin: var(--sp-2) 0; }
.cb-reach .n { font: 400 var(--fs-base)/1 var(--f-num); color: var(--t-hi); text-align: right;
  font-variant-numeric: tabular-nums; }
.cb-reach .l { font-size: var(--fs-sm); color: var(--t-dim); }
.cb-reach .b { height: 5px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden;
  grid-column: 1 / -1; }
.cb-reach .b > i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--sea); }
`;

/* ------------------------------------------------------------------ small helpers */

const DAYS_PER_MONTH = 30.4375;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function money(n) {
  const a = Math.abs(n || 0);
  if (a >= 1000000) return 'A$' + (n / 1000000).toFixed(a >= 10000000 ? 0 : 1) + 'M';
  if (a >= 1000) return 'A$' + Math.round(n / 1000) + 'k';
  return 'A$' + Math.round(n || 0);
}
function moneyFull(n) { return 'A$' + Math.round(n || 0).toLocaleString('en-AU'); }

function leadText(m) {
  if (!m) return 'no lead time';
  if (m < 24) return m + (m === 1 ? ' month' : ' months');
  const y = m / 12;
  return (y % 1 ? y.toFixed(1) : y.toFixed(0)) + ' years';
}

function daysText(d) {
  if (d == null) return 'no date set';
  if (d <= 0) return 'due now';
  if (d === 1) return '1 day';
  if (d < 60) return d + ' days';
  const m = d / DAYS_PER_MONTH;
  return (m < 24 ? m.toFixed(1) + ' months' : (m / 12).toFixed(1) + ' years');
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateOfDay(world, dayIndex) {
  const d = new Date((world.clock.epochDay + dayIndex) * 86400000);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Who decides, in four honest colours. */
const ROLES = {
  player_decides: { cls: 'decides', label: 'Yours to decide' },
  player_funds: { cls: 'funds', label: 'You can fund it' },
  player_advocates: { cls: 'advocates', label: 'You can only ask' },
  player_observes: { cls: 'observes', label: 'You can only watch' }
};
function roleOf(role) { return ROLES[role] || { cls: 'advocates', label: 'Somebody else decides' }; }

const STATUS_CHIP = {
  'in-place': ['leaf', 'already running'],
  delivering: ['sun', 'in delivery'],
  active: ['leaf', 'in effect'],
  running: ['leaf', 'running'],
  ceasing: ['coral', 'unwinding'],
  lapsed: ['coral', 'stopped'],
  dormant: ['iron', 'not started']
};

function chip(cls, text, title) {
  return el('span', { class: 'chip ' + cls, title: title || null }, text);
}

/** Prose out of a data pack. Strips the markdown backticks pack authors write around file paths,
 *  which are noise on a screen. data/civic.json is clean of them today; this keeps it that way if a
 *  future correction to the pack is not. */
function txt(s) { return s == null ? '' : String(s).replace(/`/g, ''); }

/**
 * A source field into something a reader can act on.
 *
 * Records in data/civic.json cite by key into the pack's own `source_registry`, so the board was
 * printing "Source: rbn-walker-exit", which is a fact about the file rather than about the island.
 * This resolves the key, drops the scheme so a long URL does not blow the column, and falls back to
 * the raw value when the key is not in the registry, because a key nobody registered is worth
 * seeing rather than swallowing.
 */
function sourceText(w, key) {
  if (!key) return 'not recorded';
  const reg = (w.data && w.data.civic && w.data.civic.source_registry) || {};
  const raw = String(key);
  const resolved = reg[raw];
  if (!resolved) return raw;
  if (/^https?:\/\//.test(resolved)) return resolved.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return resolved;
}

function moodColour(m) {
  if (m <= -0.3) return 'var(--coral)';
  if (m <= -0.12) return 'var(--sun)';
  if (m < 0.12) return 'var(--iron)';
  return 'var(--leaf)';
}

/** Bodies this twin will not simulate. Matches src/systems/civic/council.js. */
const NOT_MODELLED = new Set(['qyac', 'minjerribah-camping', 'joint-management']);

/* ------------------------------------------------------------------ tiers

   How many governments have to agree, drawn rather than described.

   The pack carries a tier on every institution and `jurisdiction.tiers` names them, so all of this
   reads out of the pack and none of it is a list kept in step by hand. What lives here is only the
   look: which colour a tier wears and in which order the pips read left to right. The three
   government tiers come first because the pip strip is a sentence about government, and the other
   four sit after it because a native title body, a joint arrangement, a private operator and nobody
   are each hard in a way that is not counted in governments. */

const TIER_ORDER = ['commonwealth', 'state', 'local', 'native_title', 'joint', 'private', 'none', 'unknown'];
const TIER_TONE = {
  commonwealth: 'heath', state: 'sun', local: 'sea',
  native_title: 'leaf', joint: 'leaf', private: 'iron', none: 'iron', unknown: 'coral'
};
/** Short enough for a pip's tooltip and a legend row. The pack's own labels are longer. */
const TIER_SHORT = {
  commonwealth: 'Commonwealth', state: 'State', local: 'Council',
  native_title: 'Native title', joint: 'Joint management', private: 'Private', none: 'Nobody',
  unknown: 'Unplaced'
};

/** The pack's tier block, or a usable shape if the pack has not loaded. */
function tierPack(w) {
  const t = w.data && w.data.civic && w.data.civic.jurisdiction && w.data.civic.jurisdiction.tiers;
  return {
    labels: (t && t.labels) || {},
    governments: (t && Array.isArray(t.governments)) ? t.governments : ['commonwealth', 'state', 'local']
  };
}

/**
 * How far a lever reaches, asked of the council system first because that is where the rule lives.
 * Falls back to counting the pack directly so the board still says something true before the system
 * publishes, and returns null only when there is no lever.
 */
function reachOf(w, lv) {
  if (!lv) return null;
  const cou = w.read('council');
  if (cou && typeof cou.reachOf === 'function') {
    const r = cou.reachOf(lv.id);
    if (r) return r;
  }
  const insts = (w.data && w.data.civic && w.data.civic.institutions) || [];
  const govs = tierPack(w).governments;
  const tiers = [];
  const bodies = [];
  for (const id of lv.who_decides || []) {
    const inst = insts.find((x) => x && x.id === id);
    const tier = (inst && inst.tier) || 'unknown';
    if (!tiers.includes(tier)) tiers.push(tier);
    bodies.push({ id, label: (inst && inst.label) || id, tier, cadence: '' });
  }
  const governments = govs.filter((t) => tiers.includes(t));
  return {
    tiers, bodies, governments, governmentCount: governments.length,
    bodyCount: (lv.who_decides || []).length,
    label: ['Outside government', 'One government', 'Two governments', 'Three governments'][governments.length] || '',
    plain: ''
  };
}

/** The pip strip: one filled square per tier in play, in a fixed order so it reads the same twice. */
function tierPips(reach) {
  const strip = el('span', { class: 'cb-pips', title: reach ? reach.label : '' });
  for (const t of TIER_ORDER) {
    if (!reach || !reach.tiers.includes(t)) continue;
    strip.append(el('i', { class: 'cb-pip ' + (TIER_TONE[t] || 'iron'), title: TIER_SHORT[t] || t }));
  }
  return strip;
}

/* ------------------------------------------------------------------ the panel */

registerPanel({
  id: 'civic',
  order: 40,
  mount(root, world) {
    if (!document.getElementById('cb-style')) {
      const st = document.createElement('style');
      st.id = 'cb-style';
      st.textContent = STYLE;
      document.head.append(st);
    }

    /* --- launcher -------------------------------------------------- */
    const badge = el('span', { class: 'dot' });
    const launcher = el('button', {
      class: 'btn rail-btn', type: 'button', title: 'The civic board (g)',
      onclick: () => toggle()
    }, 'Civic board', badge);
    rail().append(launcher);

    const scrim = el('div', { class: 'cb-scrim', onclick: () => toggle(false) });
    const board = el('section', { class: 'panel cb-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'The civic board' });
    root.append(scrim, board);

    /* --- header ---------------------------------------------------- */
    const flash = el('div', { class: 'cb-flash' });
    const statBox = el('div', { class: 'cb-stats' });
    // Counted, not written. The number of levers and the number of them that are the player's move
    // every time somebody edits the pack, and a sentence that states them from memory is the first
    // thing on this board to become untrue.
    const seatLine = el('div', { class: 'cb-seat' });
    const head = el('div', { class: 'cb-top' },
      el('div', {},
        el('h2', {}, 'The civic board'),
        seatLine,
        flash),
      statBox,
      el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

    const TABS = [
      ['levers', 'Levers'],
      ['traces', 'Traces'],
      ['deciders', 'Who decides'],
      ['intray', 'In tray'],
      ['groups', 'Groups'],
      ['consult', 'Consultation'],
      ['budget', 'Budget']
    ];
    const view = {
      tab: 'levers', leverId: null, issueId: null, instId: null, groupId: null, appId: null,
      query: '', roleFilter: 'all', traceId: null,
      consult: { method: 'public-meeting', venue: '', slot: 'weekday-evening', notice: 21 }
    };
    const tabBar = el('nav', { class: 'tabs' });
    const tabBtns = {};
    for (const [id, label] of TABS) {
      const b = el('button', { type: 'button', onclick: () => { view.tab = id; refresh(true); } }, label);
      tabBtns[id] = b;
      tabBar.append(b);
    }
    const main = el('div', { class: 'cb-main' });
    board.append(head, tabBar, main);

    /* --- binding: values that move every tick without a rebuild ----
       Two lists. `chrome` holds the header readouts, which are built once and must survive every
       rebuild; `binds` holds the current view's and is thrown away with its DOM. Sharing one list
       was a real bug: the header went permanently blank the first time a tab was drawn. */
    const chrome = [];
    let binds = chrome;
    const bind = (fn, cls) => { const n = el('span', cls ? { class: cls } : {}); binds.push(['t', n, fn]); return n; };
    const bindW = (node, fn) => { binds.push(['w', node, fn]); return node; };

    function runBinds(list) {
      for (const b of list) {
        try {
          if (b[0] === 't') { const v = String(b[2](world)); if (b[1].textContent !== v) b[1].textContent = v; }
          else { const v = b[2](world); if (b[1].style.width !== v) b[1].style.width = v; }
        } catch (e) { /* a bad binding must not stop the board */ }
      }
    }
    function live() { runBinds(chrome); if (binds !== chrome) runBinds(binds); }

    /* --- header readouts ------------------------------------------- */
    function readout(k, fn, cls) {
      return el('div', { class: 'readout' + (cls ? ' ' + cls : '') },
        el('div', { class: 'k' }, k), el('div', { class: 'v' }, bind(fn)));
    }
    statBox.append(
      readout('Island mood', (w) => { const s = w.read('sentiment'); return s && s.island ? s.island.label : 'not built'; }),
      readout('Next council meeting', (w) => { const c = w.read('council'); return c ? daysText(c.nextCouncilMeetingInDays) : 'not built'; }),
      readout('Island program', (w) => { const b = w.read('budget'); return b && b.funds && b.funds['council-island'] ? b.funds['council-island'].balanceText : 'not built'; }),
      readout('In tray', (w) => { const c = w.read('council'); return c ? String(c.inTrayCount) : '0'; })
    );

    /* --- open and close -------------------------------------------- */
    let open = false;
    function toggle(force) {
      open = force === undefined ? !open : !!force;
      scrim.classList.toggle('on', open);
      board.classList.toggle('on', open);
      launcher.classList.toggle('on', open);
      if (open) { world.bus.emit('ui:drawer', { id: 'civic' }); refresh(true); board.focus({ preventScroll: true }); }
    }
    world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'civic' && open) toggle(false); });
    // One panel handing over to another. The siting bench (build.js) ends by opening a file, and
    // the file is this board's business, so it asks for this board by name rather than telling
    // the player to go and find a key.
    world.bus.on('ui:open', (p) => {
      if (!p || p.id !== 'civic') return;
      if (p.tab && TABS.some(([id]) => id === p.tab)) view.tab = p.tab;
      if (p.appId) view.appId = p.appId;
      if (p.leverId) { view.leverId = p.leverId; view.traceId = p.leverId; }
      toggle(true);
    });

    // G, not C: the camera rig already owns KeyC for its next shot, and the HUD owns space and the
    // number keys. Checked against src/render/camera.js and src/ui/panels/hud.js.
    const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && TYPING[e.target.tagName]) return;
      if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
      else if (e.code === 'KeyG') { toggle(); e.preventDefault(); }
    });

    function say(msg) {
      flash.textContent = msg;
      setTimeout(() => { if (flash.textContent === msg) flash.textContent = ''; }, 5000);
    }
    function intent(payload, msg) {
      world.bus.emit('ui:intent', payload);
      say(msg);
      refresh(true);
    }

    /**
     * The council republishes its file list once a day, on its daily pass. A file opened at eleven
     * in the morning therefore exists in the system but is not in the read model until the change of
     * the day. Without this the player clicks, is told it worked, opens the in tray and finds
     * nothing, which reads as a bug rather than as a cadence. So the board listens for the system's
     * own `civic:application` event and holds the opening until the read model catches up. Nothing
     * here invents state: it shows a thing the system has already said happened.
     */
    const pendingOpens = [];
    world.bus.on('civic:application', (p) => {
      if (!p || p.stage !== 'preparing') return;
      if (pendingOpens.some((x) => x.leverId === p.leverId)) return;
      const lv = packLevers(world).find((x) => x.id === p.leverId);
      pendingOpens.push({ leverId: p.leverId, name: lv ? lv.name : p.leverId, day: world.clock.dayIndex });
    });
    function prunePending() {
      const cou = world.read('council');
      const live = new Set(((cou && cou.applications) || []).map((a) => a.leverId));
      for (let i = pendingOpens.length - 1; i >= 0; i--) {
        if (live.has(pendingOpens[i].leverId) || world.clock.dayIndex - pendingOpens[i].day > 2) pendingOpens.splice(i, 1);
      }
    }

    /* --- rebuild control ------------------------------------------- */
    let sig = '';
    function signature(w) {
      prunePending();
      const c = w.read('council') || {};
      const p = w.read('policy') || {};
      const b = w.read('budget') || {};
      const cn = w.read('consultation') || {};
      return [
        view.tab, view.leverId, view.issueId, view.instId, view.groupId, view.appId, view.traceId,
        view.query, view.roleFilter,
        view.consult.method, view.consult.venue, view.consult.slot, view.consult.notice,
        w.clock.dayIndex,
        (c.applications || []).map((a) => a.id + a.stage + (a.form || []).filter((f) => f.held).length).join(','),
        (c.referrals || []).map((r) => r.id + r.status).join(','),
        (c.closed || []).length,
        (p.delivering || []).join(','), (p.active || []).join(','), (p.discoveries || []).length,
        (cn.open || []).length, (cn.closed || []).length,
        (b.commitments || []).length, b.adopted, b.fy,
        pendingOpens.map((x) => x.leverId).join(',')
      ].join('~');
    }
    /** The seat sentence, counted out of the pack every draw. */
    function paintSeat(w) {
      const levers = packLevers(w);
      const mine = levers.filter((l) => l.player_role === 'player_decides').length;
      const cou = w.read('council');
      const three = cou && cou.reach && cou.reach.byGovernments ? (cou.reach.byGovernments[3] || 0) : 0;
      seatLine.textContent = 'You hold the island’s civic desk. You have a budget line, a mailing list, '
        + 'and no vote in anybody’s chamber. '
        + (levers.length
          ? 'Of the ' + levers.length + ' researched levers, ' + mine + ' are yours to decide'
            + (three ? ' and ' + three + ' need three governments to agree' : '') + '.'
          : 'The civic pack has not loaded.');
    }

    function refresh(force) {
      if (!open) return;
      const s = signature(world);
      if (!force && s === sig) { live(); return; }
      sig = s;
      try { paintSeat(world); } catch (e) { /* the board must still draw */ }
      binds = [];
      for (const [id] of TABS) tabBtns[id].classList.toggle('on', view.tab === id);
      main.textContent = '';
      try { VIEWS[view.tab](world); } catch (e) {
        main.append(el('div', { class: 'cb-pane pad' }, el('div', { class: 'cb-p' }, 'This view could not be drawn: ' + (e && e.message))));
        console.error('[civic] view failed', view.tab, e);
      }
      live();
    }

    /* ============================================================== VIEW: LEVERS */

    function packLevers(w) { return (w.data && w.data.civic && w.data.civic.levers) || []; }
    function packGroups(w) { return (w.data && w.data.civic && w.data.civic.interest_groups) || []; }
    function packMetric(w, id) {
      const p = w.read('policy');
      return (p && p.metrics && p.metrics[id]) || null;
    }

    function leverRow(w, lv, rt) {
      const role = roleOf(lv.player_role);
      const who = w.read('council');
      const inst = who && who.institutions ? who.institutions[lv.who_decides[0]] : null;
      const st = STATUS_CHIP[rt ? rt.status : 'dormant'] || STATUS_CHIP.dormant;
      const notMod = NOT_MODELLED.has(lv.who_decides[0]);
      const reach = reachOf(w, lv);
      // The whole point of the chip: two governments is a different kind of hard from one, and a
      // card that only listed four names would say nothing except that it is complicated.
      const reachChip = reach && reach.governmentCount >= 2
        ? chip(reach.governmentCount === 3 ? 'heath' : 'sun', reach.label, reach.plain
          || (reach.governmentCount + ' orders of government have to agree'))
        : null;
      const card = el('div', { class: 'cb-card pick' + (view.leverId === lv.id ? ' on' : ''), onclick: () => { view.leverId = lv.id; view.traceId = lv.id; refresh(true); } },
        el('h4', {}, lv.name),
        el('div', { class: 'cb-chips' },
          chip(st[0], st[1]),
          chip(role.cls === 'decides' ? 'sea' : role.cls === 'funds' ? 'sun' : role.cls === 'observes' ? 'coral' : 'iron', role.label),
          reachChip,
          notMod ? chip('heath', 'not modelled', 'This twin does not simulate this body’s decisions.') : null,
          rt && rt.squeezed ? chip('sun', 'slowed') : null,
          rt && rt.stalled ? chip('coral', 'stopped, unbuilt') : null,
          rt && rt.restsOnPlayerAssumption ? chip('heath', 'rests on your assumption') : null),
        el('div', { class: 'cb-nums' },
          el('div', { class: 'cb-num' }, el('b', {}, lv.cost_aud.capital ? money(lv.cost_aud.capital) : 'no capital'), el('i', {}, 'to build')),
          el('div', { class: 'cb-num' }, el('b', {}, lv.cost_aud.recurring_per_year ? money(lv.cost_aud.recurring_per_year) : 'nothing'), el('i', {}, 'a year to run')),
          el('div', { class: 'cb-num' }, el('b', {}, leadText(lv.lead_time_months)), el('i', {}, 'lead time'))),
        el('div', { class: 'cb-who ' + role.cls },
          el('b', {}, 'Decided by'),
          el('span', {}, (inst ? inst.label : lv.who_decides[0])
            + (reach && reach.bodyCount > 1 ? ' and ' + (reach.bodyCount - 1) + ' other' + (reach.bodyCount > 2 ? 's' : '') : '')),
          tierPips(reach)));
      if (rt && rt.status === 'delivering') {
        card.append(el('div', { class: 'cb-track', style: { marginTop: '8px' } },
          bindW(el('i'), () => {
            const p = w.read('policy');
            const r = p && p.levers ? p.levers[lv.id] : null;
            return Math.round((r ? r.progress : 0) * 100) + '%';
          })));
      }
      return card;
    }

    VIEWS_DEF('levers', (w) => {
      const pol = w.read('policy');
      if (!pol || !pol.ready) return notBuilt('The policy system is not publishing yet.');
      const levers = packLevers(w);
      const issues = pol.issues || [];

      /* left: the twenty-three arguments */
      const left = el('div', { class: 'cb-pane' });
      left.append(el('div', { class: 'cb-h' }, 'The arguments'));
      const allBtn = el('div', { class: 'cb-card pick' + (view.issueId ? '' : ' on'), onclick: () => { view.issueId = null; refresh(true); } },
        el('h4', {}, 'Everything'), el('div', { class: 'cb-quiet' }, levers.length + ' levers across ' + issues.length + ' arguments'));
      left.append(allBtn);
      for (const iss of issues) {
        const c = el('div', { class: 'cb-card pick' + (view.issueId === iss.id ? ' on' : ''), onclick: () => { view.issueId = iss.id; refresh(true); } },
          el('h4', {}, iss.label),
          el('div', { class: 'cb-quiet' }, txt(iss.oneLine)),
          el('div', { class: 'cb-track', style: { marginTop: '7px' }, title: 'How much is moving under this argument right now' },
            bindW(el('i'), () => {
              const p = w.read('policy');
              const i2 = p && p.issues ? p.issues.find((x) => x.id === iss.id) : null;
              return Math.round(clamp((i2 ? i2.heat : 0) / 3, 0, 1) * 100) + '%';
            })));
        left.append(c);
      }

      /* middle: the levers */
      const mid = el('div', { class: 'cb-pane' });
      const search = el('input', {
        type: 'search', placeholder: 'Search levers', value: view.query,
        oninput: (e) => { view.query = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => refresh(true), 220); }
      });
      const roleBtn = (k, label) => el('button', {
        type: 'button', class: 'btn' + (view.roleFilter === k ? ' on' : ''),
        onclick: () => { view.roleFilter = k; refresh(true); }
      }, label);
      mid.append(el('div', { class: 'cb-filters' }, search,
        roleBtn('all', 'All'), roleBtn('mine', 'Mine'), roleBtn('theirs', 'Theirs'),
        roleBtn('crossing', 'Two or more governments'), roleBtn('unmodelled', 'Not modelled')));

      if (pol.qyacSqueeze && pol.qyacSqueeze.on) {
        mid.append(el('div', { class: 'cb-banner' },
          el('b', {}, 'Too much at once. '),
          pol.qyacSqueeze.count + ' projects with the same body are in delivery together, so all of them are running at half speed and double the lead time. ',
          el('span', { class: 'cb-quiet' }, 'The Queensland Audit Office found QYAC was assigned multiple complex construction projects at once, with fewer than 100 staff, without an adequate capacity assessment.')));
      }

      const q = view.query.trim().toLowerCase();
      let list = levers.filter((lv) => {
        if (view.issueId && lv.issue !== view.issueId) return false;
        if (q && !(lv.name.toLowerCase().includes(q) || (lv.description || '').toLowerCase().includes(q))) return false;
        const first = lv.who_decides[0];
        if (view.roleFilter === 'mine' && lv.player_role !== 'player_decides' && lv.player_role !== 'player_funds') return false;
        if (view.roleFilter === 'theirs' && (lv.player_role === 'player_decides')) return false;
        if (view.roleFilter === 'unmodelled' && !NOT_MODELLED.has(first)) return false;
        if (view.roleFilter === 'crossing') {
          const r = reachOf(w, lv);
          if (!r || r.governmentCount < 2) return false;
        }
        return true;
      });
      const rank = { delivering: 0, ceasing: 1, active: 2, 'in-place': 3, lapsed: 4, dormant: 5 };
      list = list.slice().sort((a, b) => {
        const ra = rank[(pol.levers[a.id] || {}).status] ?? 5, rb = rank[(pol.levers[b.id] || {}).status] ?? 5;
        return ra - rb || (a.name < b.name ? -1 : 1);
      });
      const crossing = list.filter((l) => { const r = reachOf(w, l); return r && r.governmentCount >= 2; }).length;
      mid.append(el('div', { class: 'cb-quiet', style: { marginBottom: '8px' } },
        list.length + ' of ' + levers.length + ' levers. ' +
        list.filter((l) => l.player_role === 'player_decides').length + ' of these are yours to decide' +
        (crossing ? ', and ' + crossing + ' need more than one government to agree.' : '.')));
      for (const lv of list) mid.append(leverRow(w, lv, pol.levers[lv.id]));
      if (!list.length) mid.append(el('div', { class: 'cb-p' }, 'Nothing matches that.'));

      /* right: the detail */
      const right = el('div', { class: 'cb-pane pad' });
      right.append(leverDetail(w, view.leverId));

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(190px, 15%) minmax(300px, 1fr) minmax(320px, 30%)' } }, left, mid, right));
    });

    /** The full card for one lever: what it claims, what it costs, who decides, and what came back. */
    function leverDetail(w, id) {
      const wrap = el('div', {});
      if (!id) {
        const levers = packLevers(w);
        const cou = w.read('council');
        const pol = w.read('policy');
        const byRole = {};
        for (const lv of levers) byRole[lv.player_role] = (byRole[lv.player_role] || 0) + 1;
        const notMod = levers.filter((lv) => NOT_MODELLED.has(lv.who_decides[0])).length;
        const bodies = new Set(levers.map((lv) => lv.who_decides[0]));
        const running = levers.filter((lv) => lv.status === 'in_place');
        const annual = running.reduce((s, lv) => s + ((lv.cost_aud && lv.cost_aud.recurring_per_year) || 0), 0);

        wrap.append(el('div', { class: 'cb-h' }, 'Where the power sits'));
        wrap.append(el('div', { class: 'cb-p' },
          'Every lever on this board carries the same four facts before anything else: what it costs to build, what it costs every year after that, how long it takes, and who decides it. The last one is the one that matters.'));
        const t = el('table', { class: 'cb-table' });
        const tb = el('tbody', {});
        t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Whose call it is'), el('th', { class: 'n' }, 'Levers'))), tb);
        for (const [k, r] of Object.entries(ROLES)) {
          tb.append(el('tr', { class: k === 'player_decides' ? 'hi' : '' },
            el('td', {}, r.label), el('td', { class: 'n' }, String(byRole[k] || 0))));
        }
        wrap.append(t);
        wrap.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
          levers.length + ' levers, ' + bodies.size + ' different bodies holding the first call on them, and ' +
          notMod + ' whose decision this twin will not simulate at all.'));

        /* How many governments, which is a different question from how many bodies and a more
           useful one. Counted here rather than taken from the system, so this block still says
           something true on the first frame before council publishes. */
        const govBuckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        for (const lv of levers) {
          const r = reachOf(w, lv);
          if (r) govBuckets[r.governmentCount] = (govBuckets[r.governmentCount] || 0) + 1;
        }
        const GOV_ROWS = [
          [3, 'need all three governments', 'heath'],
          [2, 'need two governments', 'sun'],
          [1, 'need one government', 'sea'],
          [0, 'need no government at all', 'leaf']
        ];
        wrap.append(el('div', { class: 'cb-h' }, 'How many governments have to agree'));
        const reachBox = el('div', { class: 'cb-reach' });
        for (const [n, label, tone] of GOV_ROWS) {
          const v = govBuckets[n] || 0;
          if (!v) continue;
          reachBox.append(
            el('span', { class: 'n' }, String(v)),
            el('span', { class: 'l' }, label),
            tierPips({ tiers: n === 0 ? ['native_title'] : ['commonwealth', 'state', 'local'].slice(3 - n), label }),
            el('span', { class: 'b' }, el('i', { class: tone, style: { width: (100 * v / Math.max(1, levers.length)).toFixed(1) + '%', background: 'var(--' + tone + ')' } })));
        }
        wrap.append(reachBox);
        wrap.append(el('div', { class: 'cb-quiet' },
          'Counting names makes a long list. Counting governments says what kind of hard a thing is: '
          + 'one government is a meeting, two is a meeting and a letter, three is a campaign. The '
          + 'levers that need none are not the easy ones. They belong to the native title holders, '
          + 'to joint management or to a private operator, and the first two of those are decisions '
          + 'this twin will not simulate.'));

        wrap.append(el('div', { class: 'cb-h' }, 'The desk you inherited'));
        wrap.append(el('div', { class: 'cb-nums' },
          el('div', { class: 'cb-num' }, el('b', {}, String(running.length)), el('i', {}, 'already running')),
          el('div', { class: 'cb-num' }, el('b', {}, money(annual)), el('i', {}, 'a year they cost')),
          el('div', { class: 'cb-num' }, el('b', {}, bind((ww) => String(((ww.read('policy') || {}).delivering || []).length))), el('i', {}, 'in delivery'))));
        wrap.append(el('div', { class: 'cb-p', style: { marginTop: '10px' } },
          'A lever already in place sits at zero on this board, because its work is in the island you started with. It moves in two directions instead: step it up and its effects apply, cut it and they unwind on the same delays. Cutting is the cheapest thing a budget under pressure reaches for and the slowest thing to show.'));

        wrap.append(el('div', { class: 'cb-h' }, 'What is connected'));
        for (const c of (pol && pol.couplings) || []) {
          wrap.append(el('div', { class: 'cb-item' },
            el('div', { class: 'tick ' + (c.connected ? 'held' : 'no') }, c.connected ? '✓' : '✗'),
            el('div', { class: 'body' }, el('div', {}, c.id.replace(/-/g, ' ')), el('em', {}, c.note))));
        }
        wrap.append(el('div', { class: 'cb-quiet' },
          'These are the places the rest of the island pushes on the civic numbers. A coupling whose system is not built yet contributes nothing and says so rather than quietly inventing a value.'));
        if (cou && cou.notes) for (const n of cou.notes) wrap.append(el('div', { class: 'cb-src' }, n));
        return wrap;
      }
      const pol = w.read('policy');
      const cou = w.read('council');
      const card = pol.leverCard ? pol.leverCard(id) : null;
      const lv = packLevers(w).find((x) => x.id === id);
      if (!card || !lv) { wrap.append(el('div', { class: 'cb-p' }, 'No record for that lever.')); return wrap; }
      const role = roleOf(card.role);
      const decides = cou && cou.whoDecides ? cou.whoDecides(id) : null;
      const first = lv.who_decides[0];
      const notMod = NOT_MODELLED.has(first);

      wrap.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)', lineHeight: '1.3' } }, card.name));
      wrap.append(el('div', { class: 'cb-p', style: { marginTop: '6px' } }, txt(card.description)));

      wrap.append(el('div', { class: 'cb-who ' + role.cls, style: { marginTop: '12px' } },
        el('b', {}, role.label),
        el('span', {}, decides ? decides.plain : '')));

      /* Who has to agree, one row each, in tier order. This is the part a player has to be able to
         read at a glance: a lever needing the council is a meeting, and a lever needing the council
         and the state and the Commonwealth is a different animal, and until this block existed both
         of them looked like a list of names. */
      const reach = reachOf(w, lv);
      if (reach && reach.bodies.length) {
        const labels = tierPack(w).labels;
        wrap.append(el('div', { class: 'cb-h' },
          reach.governmentCount >= 2 ? 'Everybody who has to agree' : 'Who has to agree'));
        if (reach.plain) wrap.append(el('div', { class: 'cb-p' }, reach.plain));
        const rows = el('div', { class: 'cb-tiers' });
        const ordered = reach.bodies.slice().sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
        for (const b of ordered) {
          const instB = cou && cou.institutions ? cou.institutions[b.id] : null;
          rows.append(el('div', { class: 'cb-tier' },
            el('i', { class: 'cb-pip ' + (TIER_TONE[b.tier] || 'iron') }),
            el('div', { class: 'who' },
              el('b', {}, b.label),
              el('em', {}, (labels[b.tier] || TIER_SHORT[b.tier] || b.tier)
                + ' · ' + (b.notModelled
                  ? 'this twin does not simulate this decision'
                  : 'decides on ' + ((instB && instB.cadence) || b.cadence || 'an unmodelled cycle'))))));
        }
        wrap.append(rows);
        const openApp0 = cou && cou.applications ? cou.applications.find((a) => a.leverId === id) : null;
        if (openApp0 && openApp0.crossingWeeks) {
          wrap.append(el('div', { class: 'cb-quiet' },
            'The open file on this carries about ' + openApp0.crossingWeeks + ' extra weeks of assessment '
            + 'for crossing governments. That is a modelling estimate, not a measured one: nobody has '
            + 'published how much longer a multi-government approval takes on this island.'));
        }
      }

      /* Native title is Commonwealth law, and fourteen levers named QYAC without ever naming it. */
      if (reach && reach.tiers.includes('native_title')) {
        const nta = ((w.data && w.data.civic && w.data.civic.instruments) || [])
          .find((x) => x && x.id === 'native-title-act-1993');
        if (nta) {
          wrap.append(el('div', { class: 'cb-banner' },
            el('b', {}, 'Under what law. '),
            'QYAC decides this as the registered native title body corporate for the Quandamooka People, '
            + 'under the ' + nta.label + ', a Commonwealth statute, following the Federal Court '
            + 'determinations of 4 July 2011. ',
            el('div', { class: 'cb-quiet', style: { marginTop: '6px' } }, txt(nta.the_part_that_bites || ''))));
        }
      }

      /* The Commonwealth block. Only where the pack says so on this lever, and where it does the
         board shows the live number the twin is already producing rather than a paragraph about it. */
      if (lv.commonwealth_note) {
        const box = el('div', { class: 'cb-banner' },
          el('b', {}, 'The Commonwealth. '),
          txt(lv.commonwealth_note));
        const insts = (w.data && w.data.civic && w.data.civic.instruments) || [];
        const named = (lv.instruments || []).map((iid) => insts.find((x) => x && x.id === iid)).filter(Boolean);
        for (const ins of named) {
          box.append(el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
            el('b', {}, ins.label + (ins.the_part_that_bites ? '. ' : '')),
            txt(ins.the_part_that_bites || ins.what_it_does || '')));
        }
        if (lv.commonwealth_source) {
          box.append(el('div', { class: 'cb-src' }, 'Source: ' + sourceText(w, lv.commonwealth_source)));
        }
        wrap.append(box);
      }

      /* The join the pack now makes and the interface should show: a lever that touches shorebird
         disturbance is a lever that touches listed migratory species, and the shorebird system is
         running right now with a number for it. */
      const touchesBirds = [...(lv.effects || []), ...(lv.side_effects || [])]
        .some((e) => e && e.target === 'shorebird_disturbance');
      if (touchesBirds) {
        const sb = w.read('shorebirds');
        const mnes = (w.data && w.data.civic && w.data.civic.national_environmental_significance) || null;
        const migratory = mnes && Array.isArray(mnes.matters)
          ? mnes.matters.find((m) => m && m.id === 'mnes-migratory') : null;
        const box = el('div', { class: 'cb-banner' },
          el('b', {}, 'A matter of national environmental significance. '),
          migratory
            ? 'This lever moves shorebird disturbance, and the birds it disturbs are listed migratory species under '
              + (migratory.epbc_section || 'the EPBC Act') + '. ' + txt(migratory.here)
            : 'This lever moves shorebird disturbance, which is a matter of national environmental significance under the EPBC Act.');
        if (sb && sb.bySpecies && sb.bySpecies.length) {
          const listed = sb.bySpecies.filter((s) => s && s.migrant && s.count > 0);
          box.append(el('div', { class: 'cb-p', style: { marginTop: '6px' } },
            listed.length
              ? 'On the flats at this moment: ' + listed.map((s) => s.count + ' ' + s.name.toLowerCase().replace(/\s*\(.*\)$/, '') + ' (' + s.status + ')').join(', ') + '.'
              : 'No migratory shorebirds on the flats at this moment. They are away in the northern hemisphere.'));
          box.append(bind((ww) => {
            const s2 = ww.read('shorebirds');
            if (!s2 || typeof s2.disturbance365 !== 'number') return '';
            return 'Roosts flushed in the last year: ' + Math.round(s2.roostFlushes365 || 0)
              + '. Birds lifted: ' + Math.round(s2.disturbance365) + '.';
          }, 'cb-quiet'));
        }
        box.append(el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
          'Whether any particular action is likely to have a significant impact is a judgement for the '
          + 'proponent and then for the minister. This board does not make it, and nothing here says '
          + 'this lever needs a referral. It says the Act reaches this ground.'));
        wrap.append(box);
      }

      if (notMod) {
        const inst = cou && cou.institutions ? cou.institutions[first] : null;
        wrap.append(el('div', { class: 'cb-banner stop' },
          el('b', {}, 'This twin stops here. '),
          inst ? inst.why : '',
          el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
            'No public statement by this body on this lever is held by this project. The board will not guess at one. ' +
            'You can lodge, wait, and record your own assumption, and everything downstream of that assumption stays labelled as resting on it.')));
      }

      wrap.append(el('div', { class: 'cb-h' }, 'The money and the clock'));
      const kv = el('dl', { class: 'cb-kv' });
      kv.append(el('dt', {}, 'To build'), el('dd', {}, card.capital ? moneyFull(card.capital) : 'nothing to build'));
      kv.append(el('dt', {}, 'Each year'), el('dd', {}, card.recurring ? moneyFull(card.recurring) + ' a year' : 'no ongoing cost'));
      kv.append(el('dt', {}, 'Lead time'), el('dd', {}, leadText(card.leadMonths) + ' before it is finished'));
      kv.append(el('dt', {}, 'Cost basis'), el('dd', {}, (card.costBasis || 'not stated') + ' (' + (card.costConfidence || 'low') + ' confidence)'));
      kv.append(el('dt', {}, 'Status'), el('dd', {}, bind(() => {
        const r = w.read('policy').levers[id];
        if (!r) return 'unknown';
        if (r.status === 'delivering') return 'in delivery, ' + Math.round(r.progress * 100) + ' per cent through';
        return (STATUS_CHIP[r.status] || ['iron', r.status])[1];
      })));
      wrap.append(kv);

      wrap.append(el('div', { class: 'cb-h' }, 'What it claims it will do'));
      if (!card.promised.length) wrap.append(el('div', { class: 'cb-p' }, 'The pack records no effects for this lever.'));
      for (const p of card.promised) {
        const m = packMetric(w, p.metric);
        wrap.append(el('div', { class: 'cb-item' },
          el('div', { class: 'tick ' + (p.stated > 0 ? 'held' : 'no') }, p.stated > 0 ? '+' : '−'),
          el('div', { class: 'body' },
            el('div', {}, p.metricLabel + ', starting about ' + leadText(p.delayMonths) + ' after it begins'),
            el('em', {}, p.band))));
      }
      wrap.append(el('div', { class: 'cb-quiet' },
        'The magnitudes above are the pack’s modelling values, not measured elasticities. The realised value is drawn once when a lever is enacted, inside the band its own confidence allows, so a low-confidence effect can land at a third of what was promised or the wrong way round.'));

      if (card.discovered && card.discovered.length) {
        wrap.append(el('div', { class: 'cb-h' }, 'What has turned up since'));
        for (const d of card.discovered) wrap.append(el('div', { class: 'cb-p' }, d));
      }

      wrap.append(el('div', { class: 'cb-h' }, 'Who is for it and who is against'));
      const sent = w.read('sentiment');
      const gname = (gid) => (sent && sent.groups && sent.groups[gid] ? sent.groups[gid].label : gid);
      const gline = (list, verb) => el('div', { class: 'cb-p' },
        el('strong', {}, verb + ': '), list.length ? list.map(gname).join(', ') : 'nobody the pack records');
      wrap.append(gline(card.supports, 'For'), gline(card.opposes, 'Against'));

      if (card.history && card.history.length) {
        wrap.append(el('div', { class: 'cb-h' }, 'What has happened to it'));
        for (const h of card.history.slice().reverse()) {
          wrap.append(el('div', { class: 'cb-item' },
            el('div', { class: 'body' },
              el('div', {}, h.event + ' · ' + dateOfDay(w, h.day)),
              h.detail ? el('em', {}, h.detail) : null)));
        }
      }

      /* the actions the player actually has */
      wrap.append(el('div', { class: 'cb-h' }, 'What you can do about it'));
      const rt = pol.levers[id];
      const openApp = cou && cou.applications ? cou.applications.find((a) => a.leverId === id) : null;
      const row = el('div', { class: 'btn-row' });
      if (openApp) {
        row.append(el('button', { class: 'btn on', type: 'button', onclick: () => { view.tab = 'intray'; view.appId = openApp.id; refresh(true); } },
          'A file is already open: ' + openApp.stageLabel.toLowerCase()));
      } else if (card.role === 'player_observes') {
        row.append(el('button', { class: 'btn', type: 'button', disabled: true }, 'Nothing. This one you watch.'));
      } else if (rt && (rt.status === 'in-place' || rt.status === 'active' || rt.status === 'running')) {
        row.append(el('button', { class: 'btn', type: 'button', onclick: () => intent({ kind: 'civic:stepup', leverId: id }, 'Asked for more of ' + card.name.toLowerCase() + '.') }, 'Do more of it'));
        row.append(el('button', { class: 'btn danger', type: 'button', onclick: () => intent({ kind: 'civic:cease', leverId: id, reason: 'Funding withdrawn from the civic desk.' }, 'Withdrew funding from ' + card.name.toLowerCase() + '.') }, 'Stop funding it'));
      } else {
        row.append(el('button', { class: 'btn', type: 'button', onclick: () => intent({ kind: 'civic:pursue', leverId: id }, 'Opened a file on ' + card.name.toLowerCase() + '.') },
          card.role === 'player_advocates' ? 'Prepare a case and ask' : 'Open a file'));
      }
      row.append(el('button', { class: 'btn ghost', type: 'button', onclick: () => { view.tab = 'consult'; view.leverId = id; refresh(true); } }, 'Consult on it'));
      row.append(el('button', { class: 'btn ghost', type: 'button', onclick: () => { view.tab = 'traces'; view.traceId = id; refresh(true); } }, 'Trace it'));
      wrap.append(row);

      if (rt && (rt.status === 'in-place')) {
        wrap.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
          'This is already running, so it sits at zero: its work is in the island you started with. Stepping it up applies the effects above. Stopping it applies them in reverse, on the same delays, which is the cheapest thing a budget under pressure reaches for and the slowest to show.'));
      }

      wrap.append(el('div', { class: 'cb-src' }, 'Source: ' + sourceText(w, card.source) + (card.note ? '. ' + txt(card.note) : '')));
      return wrap;
    }

    /* ============================================================== VIEW: TRACES */

    /**
     * The relationship view.
     *
     * Democracy 4 draws an arrow between two nodes and asks you to believe it. Here every edge
     * carries where it came from. A lever-to-metric edge is a claim the researched pack makes, and
     * it is drawn with its delay written on the line, its confidence in the dash pattern and its
     * size in the thickness. A metric-to-metric edge is not a causal claim at all: it is derived,
     * and it says exactly what it is derived from. Two numbers are joined when the pack's own levers
     * move both of them, and the edge says how many levers and which way they pull.
     *
     * Side effects are deliberately not in this graph until they have been discovered in play. The
     * board does not spoil the thing the simulation is built to teach.
     */
    function metricGraph(w) {
      if (metricGraph._cache && metricGraph._cache.w === w) return metricGraph._cache.g;
      const levers = packLevers(w);
      const edges = new Map();
      for (const lv of levers) {
        const t = (lv.effects || []).filter((e) => e.magnitude);
        for (let i = 0; i < t.length; i++) {
          for (let j = i + 1; j < t.length; j++) {
            const a = t[i], b = t[j];
            const k = a.target < b.target ? a.target + '|' + b.target : b.target + '|' + a.target;
            let rec = edges.get(k);
            if (!rec) edges.set(k, (rec = { weight: 0, levers: [], together: 0 }));
            rec.weight += Math.min(Math.abs(a.magnitude), Math.abs(b.magnitude));
            rec.levers.push(lv.name);
            if (Math.sign(a.magnitude) === Math.sign(b.magnitude)) rec.together++;
          }
        }
      }
      const byMetric = new Map();
      for (const [k, rec] of edges) {
        const [a, b] = k.split('|');
        if (!byMetric.has(a)) byMetric.set(a, []);
        if (!byMetric.has(b)) byMetric.set(b, []);
        byMetric.get(a).push({ other: b, ...rec });
        byMetric.get(b).push({ other: a, ...rec });
      }
      for (const list of byMetric.values()) list.sort((x, y) => y.weight - x.weight || (x.other < y.other ? -1 : 1));
      metricGraph._cache = { w, g: byMetric };
      return byMetric;
    }

    const svg = (tag, attrs = {}, ...kids) => {
      const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
      for (const c of kids.flat()) if (c) n.append(c.nodeType ? c : document.createTextNode(String(c)));
      return n;
    };

    function dashOf(conf) { return conf === 'high' ? null : conf === 'medium' ? '7 3' : '2 4'; }

    VIEWS_DEF('traces', (w) => {
      const pol = w.read('policy');
      if (!pol || !pol.ready) return notBuilt('The policy system is not publishing yet.');
      const levers = packLevers(w);
      const id = view.traceId || view.leverId || 'short-stay-letting-registration';
      const lv = levers.find((x) => x.id === id) || levers[0];

      /* left: pick a lever to trace */
      const left = el('div', { class: 'cb-pane' });
      left.append(el('div', { class: 'cb-h' }, 'Trace a lever'));
      const search = el('input', {
        type: 'search', placeholder: 'Search', value: view.query,
        oninput: (e) => { view.query = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => refresh(true), 220); }
      });
      left.append(el('div', { class: 'cb-filters' }, search));
      const q = view.query.trim().toLowerCase();
      for (const x of levers) {
        if (q && !x.name.toLowerCase().includes(q)) continue;
        left.append(el('div', { class: 'cb-card pick' + (x.id === lv.id ? ' on' : ''), onclick: () => { view.traceId = x.id; view.leverId = x.id; refresh(true); } },
          el('h4', {}, x.name),
          el('div', { class: 'cb-quiet' }, (x.effects || []).length + ' claimed effects · ' + leadText(x.lead_time_months))));
      }

      /* right: the graph */
      const right = el('div', { class: 'cb-pane pad' });
      right.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)' } }, lv.name),
        el('div', { class: 'cb-p', style: { marginTop: '6px', maxWidth: '90ch' } }, lv.description));

      const graph = metricGraph(w);
      const primary = (lv.effects || []).slice(0, 5);
      const discovered = (pol.discoveries || []).filter((d) => d.leverId === lv.id);
      const seen = new Set(primary.map((e) => e.target));
      const second = [];
      for (const e of primary) {
        for (const link of (graph.get(e.target) || []).slice(0, 4)) {
          if (seen.has(link.other) || second.some((s) => s.metric === link.other)) continue;
          second.push({ metric: link.other, from: e.target, ...link });
        }
      }
      second.sort((a, b) => b.weight - a.weight);
      const secondTop = second.slice(0, 6);

      const rows = Math.max(primary.length, secondTop.length, 1);
      const W = 1200, H = Math.max(300, 70 + rows * 78);
      const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cb-graph', role: 'img', 'aria-label': 'What this lever feeds' });

      const NODE_W = 300;
      const col = [8, 420, 892];
      const yFor = (i, n) => 60 + (H - 110) * (n === 1 ? 0.5 : i / (n - 1));

      /* the lever node */
      const cou = w.read('council');
      const inst = cou && cou.institutions ? cou.institutions[lv.who_decides[0]] : null;
      const ly = H / 2;
      g.append(svg('rect', { x: col[0], y: ly - 36, width: 250, height: 72, rx: 6, fill: 'rgba(63,182,196,.12)', stroke: 'var(--sea)', 'stroke-width': 1 }));
      g.append(svg('text', { x: col[0] + 12, y: ly - 14, class: 'nm' }, trunc(lv.name, 28)));
      g.append(svg('text', { x: col[0] + 12, y: ly + 4, class: 'sub' }, trunc((inst ? inst.label : lv.who_decides[0]).toUpperCase(), 32)));
      g.append(svg('text', { x: col[0] + 12, y: ly + 22, class: 'sub' },
        (lv.cost_aud.capital ? money(lv.cost_aud.capital) + ' · ' : '') + leadText(lv.lead_time_months).toUpperCase()));

      const edge = (x1, y1, x2, y2, o) => {
        const run = x2 - x1;
        const c1 = x1 + run * (o.bow != null ? o.bow : 0.55);
        const c2 = x2 - run * (o.bow != null ? o.bow : 0.55);
        g.append(svg('path', {
          d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`,
          fill: 'none', stroke: o.colour, 'stroke-width': o.width, 'stroke-dasharray': o.dash,
          'stroke-linecap': 'round', opacity: o.opacity != null ? o.opacity : 0.9
        }));
        if (o.label) {
          g.append(svg('text', { x: x1 + run * 0.5, y: (y1 + y2) / 2 - 7, class: 'edge-lbl', 'text-anchor': 'middle' }, o.label));
        }
      };

      const metricNode = (x, y, mid, sub, sub2) => {
        const m = packMetric(w, mid);
        const label = m ? m.label : mid;
        const h = sub2 ? 58 : 54;
        g.append(svg('rect', { x, y: y - 27, width: NODE_W, height: h, rx: 5, fill: 'rgba(255,255,255,.035)', stroke: 'var(--edge)', 'stroke-width': 1 }));
        g.append(svg('text', { x: x + 11, y: y - 8, class: 'nm' }, trunc(label, 32)));
        g.append(svg('text', { x: x + 11, y: y + 8, class: 'sub', fill: sub2 ? 'var(--t-faint)' : null }, trunc(sub, 46)));
        if (sub2) {
          g.append(svg('text', { x: x + 11, y: y + 23, class: 'sub', fill: 'var(--t-faint)' }, trunc(sub2, 46)));
          return;
        }
        if (m && m.unit === 'index') {
          const bx = x + 11, bw = NODE_W - 22;
          g.append(svg('rect', { x: bx, y: y + 16, width: bw, height: 3, rx: 1.5, fill: 'rgba(0,0,0,.35)' }));
          g.append(svg('rect', { x: bx, y: y + 16, width: Math.max(2, bw * clamp(m.value, 0, 1)), height: 3, rx: 1.5, fill: 'var(--iron)' }));
          g.append(svg('rect', { x: bx + bw * clamp(m.baseline, 0, 1) - 0.5, y: y + 13, width: 1, height: 9, fill: 'var(--t-dim)' }));
        }
      };

      primary.forEach((e, i) => {
        const y = yFor(i, primary.length);
        const m = packMetric(w, e.target);
        const good = m && m.direction !== 'context' ? ((m.direction === 'higher_is_better') === (e.magnitude > 0)) : null;
        const colour = good === null ? 'var(--sea)' : good ? 'var(--leaf)' : 'var(--coral)';
        edge(col[0] + 250, ly, col[1], y, {
          colour, width: clamp(Math.abs(e.magnitude) * 14, 1.2, 6), dash: dashOf(e.confidence),
          label: e.delay_months ? e.delay_months + ' months' : 'at once'
        });
        const now = m ? (m.fromBaseline >= 0 ? '+' : '') + m.fromBaseline.toFixed(3) : '';
        metricNode(col[1], y, e.target,
          (e.magnitude > 0 ? '+' : '') + e.magnitude.toFixed(2) + ' claimed, ' + (e.confidence || 'low') + ', now ' + now);
      });

      secondTop.forEach((s, i) => {
        const y = yFor(i, secondTop.length);
        const fromIdx = Math.max(0, primary.findIndex((p) => p.target === s.from));
        const fy = yFor(fromIdx, primary.length);
        const together = s.together >= s.levers.length / 2;
        // Fan the control points by source row so a braid of second-hop links stays traceable.
        edge(col[1] + NODE_W, fy, col[2], y, {
          colour: 'var(--iron)', width: clamp(s.weight * 8, 1, 3.5), dash: '3 5',
          opacity: 0.5, bow: 0.28 + fromIdx * 0.13
        });
        metricNode(col[2], y, s.metric,
          'from ' + ((packMetric(w, s.from) || {}).label || s.from).toLowerCase(),
          s.levers.length + (s.levers.length === 1 ? ' lever moves both, ' : ' levers move both, ') +
          (together ? 'the same way' : 'opposite ways'));
      });

      right.append(g);
      right.append(el('div', { class: 'cb-legend' },
        el('span', {}, 'Thickness is the size of the claim.'),
        el('span', {}, 'Solid is high confidence, dashed medium, dotted low.'),
        el('span', {}, 'The months on a first-hop line are the wait before anything starts arriving.'),
        el('span', {}, 'Green moves the number the way the pack calls better, coral the other way, blue is context.'),
        el('span', {}, 'Grey links are derived, not causal. The list below says exactly how.')));

      right.append(el('div', { class: 'cb-h' }, 'How the second hop was worked out'));
      right.append(el('div', { class: 'cb-p', style: { maxWidth: '92ch' } },
        'The grey links are not causal arrows and this board will not draw one. They are derived from the pack itself: two numbers are joined when the researched levers move both of them, and the label says how many levers do it. "Moves with" means most of those levers push the pair the same way. That is a claim about the data, which you can check, rather than a claim about the world, which you cannot.'));
      for (const s of secondTop) {
        right.append(el('div', { class: 'cb-item' },
          el('div', { class: 'body' },
            el('div', {}, ((packMetric(w, s.from) || {}).label || s.from) + ' → ' + ((packMetric(w, s.metric) || {}).label || s.metric)),
            el('em', {}, 'Shared levers: ' + s.levers.slice(0, 4).join('; ') + (s.levers.length > 4 ? ' and ' + (s.levers.length - 4) + ' more' : '')))));
      }

      /* what else is already moving these numbers */
      right.append(el('div', { class: 'cb-h' }, 'What else is moving these numbers right now'));
      const anyMover = [];
      for (const e of primary) {
        const m = packMetric(w, e.target);
        if (!m || !m.movers || !m.movers.length) continue;
        anyMover.push(el('div', { class: 'cb-item' },
          el('div', { class: 'body' },
            el('div', {}, m.label),
            el('em', {}, m.movers.map((x) => `${x.label} ${x.value >= 0 ? '+' : ''}${x.value.toFixed(3)}`).join(' · ')))));
      }
      if (anyMover.length) right.append(anyMover);
      else right.append(el('div', { class: 'cb-p' }, 'Nothing is pushing these numbers today. They sit where the island started.'));

      if (discovered.length) {
        right.append(el('div', { class: 'cb-h' }, 'Second order, discovered in play'));
        for (const d of discovered) right.append(el('div', { class: 'cb-p' }, d.text + ' (' + d.date + ')'));
      } else if ((lv.side_effects || []).length) {
        right.append(el('div', { class: 'cb-h' }, 'Second order'));
        right.append(el('div', { class: 'cb-p' },
          'This lever carries ' + lv.side_effects.length + ' recorded side effects. They are not drawn until they arrive, which is months after the decision. That is the whole reason they are worth modelling.'));
      }

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(210px, 20%) 1fr' } }, left, right));
    });

    function trunc(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''); }

    /* ============================================================== VIEW: WHO DECIDES */

    VIEWS_DEF('deciders', (w) => {
      const cou = w.read('council');
      if (!cou || !cou.ready) return notBuilt('The council system is not publishing yet.');
      const levers = packLevers(w);
      const counts = {};
      for (const lv of levers) for (const d of lv.who_decides) counts[d] = (counts[d] || 0) + 1;
      const firsts = {};
      for (const lv of levers) firsts[lv.who_decides[0]] = (firsts[lv.who_decides[0]] || 0) + 1;

      const insts = Object.values(cou.institutions).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || (a.label < b.label ? -1 : 1));
      const labels = tierPack(w).labels;
      const tiersPresent = TIER_ORDER.filter((t) => insts.some((i) => i.tier === t));

      const left = el('div', { class: 'cb-pane' });
      /* The pack's own opening sentence, on screen. It was written to be the first thing anybody
         read about who governs this island and until now nothing in src/ rendered it, so it went
         two rounds carrying two claims that no record in the pack supported. A sentence nobody can
         see is a sentence nobody checks. */
      const jur = (w.data && w.data.civic && w.data.civic.jurisdiction) || null;
      if (jur && jur.summary) {
        left.append(el('div', { class: 'cb-banner' }, el('b', {}, 'The island in one sentence. '), txt(jur.summary)));
      }
      // Counted, and grouped. A flat list ordered by lever count buried the fourth tier in the
      // middle of it: the Commonwealth would have sat between Minjerribah Camping and TransLink,
      // which tells a reader nothing about what kind of body it is.
      left.append(el('div', { class: 'cb-h' },
        insts.length + ' decision makers, across ' + tiersPresent.length + ' tiers'));
      left.append(el('div', { class: 'cb-quiet', style: { marginBottom: '10px' } },
        'Counted from the pack’s own who_decides field, which its honesty note calls the most important field in the file, and deliberately, frequently, not the player. Three of these tiers are orders of government and the rest are not, which is the difference that matters when you are working out how hard something will be.'));
      for (const t of tiersPresent) {
        const mine = insts.filter((i) => i.tier === t);
        const leverCount = levers.filter((lv) => (lv.who_decides || []).some((d) => mine.some((m) => m.id === d))).length;
        left.append(el('div', { class: 'cb-tierhead' },
          el('i', { class: 'cb-pip ' + (TIER_TONE[t] || 'iron') }),
          el('span', { class: 'k' }, labels[t] || TIER_SHORT[t] || t),
          el('span', { class: 'n' }, leverCount + ' levers')));
        for (const i of mine) {
          left.append(el('div', { class: 'cb-card pick' + (view.instId === i.id ? ' on' : ''), onclick: () => { view.instId = i.id; refresh(true); } },
            el('h4', {}, i.label),
            el('div', { class: 'cb-chips' },
              chip('iron', i.kind),
              i.notModelled ? chip('heath', 'not modelled') : chip('sea', i.cadence),
              (firsts[i.id] || 0) ? chip('sun', firsts[i.id] + (firsts[i.id] === 1 ? ' lever' : ' levers'),
                'Levers where this body has the first call. It sits in ' + (counts[i.id] || 0) + ' altogether.') : null)));
        }
      }

      const right = el('div', { class: 'cb-pane pad' });
      const i = cou.institutions[view.instId] || cou.institutions['redland-city-council'];
      if (!i) { right.append(el('div', { class: 'cb-p' }, 'No record.')); }
      else {
        right.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)' } }, i.label));
        right.append(el('div', { class: 'cb-p', style: { marginTop: '6px', maxWidth: '90ch' } }, txt(i.role)));

        if (i.notModelled) {
          right.append(el('div', { class: 'cb-banner stop' }, el('b', {}, 'This twin does not simulate this body’s decisions. '), i.why));
          right.append(el('div', { class: 'cb-p' },
            'What the board does instead is model the process around it: the referral, the documented capacity constraint, and the wait. Then it stops. You can record your own assumption to keep playing, and everything downstream of that assumption stays labelled as resting on it rather than on anybody’s position.'));
          if (i.capacityNote) right.append(el('div', { class: 'cb-p' }, el('strong', {}, 'Capacity: '), txt(i.capacityNote)));
          right.append(qyacPositions(w));
        } else {
          const kv = el('dl', { class: 'cb-kv' });
          kv.append(el('dt', {}, 'Tier'), el('dd', {}, labels[i.tier] || TIER_SHORT[i.tier] || i.tier));
          const f0 = firsts[i.id] || 0;
          kv.append(el('dt', {}, 'Decides'), el('dd', {},
            (f0 === 0 ? 'nothing outright' : f0 + (f0 === 1 ? ' lever' : ' levers') + ' outright')
            + ', and sits in the decision on ' + (counts[i.id] || 0)));
          kv.append(el('dt', {}, 'Cadence'), el('dd', {}, 'Modelled as ' + i.cadence + '. No meeting calendar was read for this build.'));
          const bud = w.read('budget');
          const fundLabel = i.fund === 'external' ? 'Not the island’s money'
            : (bud && bud.funds && bud.funds[i.fund] ? bud.funds[i.fund].label + ', held by ' + bud.funds[i.fund].holder : i.fund);
          kv.append(el('dt', {}, 'Purse'), el('dd', {}, fundLabel));
          right.append(kv);

          /* HOW THIS BODY DECIDES, WHICH IS NOT ALWAYS A NUMBER.
             This card used to print one 0 to 100 appetite meter for every body on the board, so the
             federal environment department was drawn with a meter reading 20 out of 100 directly
             above the line saying the minister decides against a statutory test and not against how
             much the island wants it. A meter is a claim, and on that body the claim is false. The
             pack now carries a posture per institution and the meter only appears where wanting it
             more actually helps. */
          if (i.postureMeter) {
            right.append(el('div', { class: 'cb-h' }, i.postureLabel || 'Appetite right now'));
            right.append(el('div', { class: 'cb-track' },
              bindW(el('i'), () => {
                const c = w.read('council');
                const x = c && c.institutions ? c.institutions[i.id] : null;
                return Math.round((x && x.appetite != null ? x.appetite : 0) * 100) + '%';
              })));
            right.append(el('div', { class: 'cb-quiet', style: { marginTop: '5px' } },
              bind((ww) => {
                const c = ww.read('council');
                const x = c && c.institutions ? c.institutions[i.id] : null;
                if (!x || x.appetite == null) return 'not modelled';
                return Math.round(x.appetite * 100) + ' out of 100. ' + x.openWithThem + ' of your files are open with them, and asking one body for five things at once costs you.';
              })));
          } else {
            right.append(el('div', { class: 'cb-h' }, i.postureLabel || 'What it decides against'));
            right.append(el('div', { class: 'cb-banner' },
              el('b', {}, 'No appetite is modelled for this body. '),
              i.postureMoves || ''));
            if (i.postureInstead) right.append(el('div', { class: 'cb-p' }, i.postureInstead));
            right.append(el('div', { class: 'cb-quiet', style: { marginTop: '5px' } },
              bind((ww) => {
                const c = ww.read('council');
                const x = c && c.institutions ? c.institutions[i.id] : null;
                const open = x ? x.openWithThem : 0;
                return open === 0
                  ? 'Nothing of yours is with them right now.'
                  : open + (open === 1 ? ' file of yours is' : ' files of yours are') + ' with them. That number does not help you here and it does not hurt you either.';
              })));
          }

          if (i.standingApplies !== false) {
            right.append(el('div', { class: 'cb-h' }, 'How they regard you'));
            right.append(el('div', { class: 'cb-track' },
              bindW(el('i'), () => {
                const c = w.read('council');
                const x = c && c.institutions ? c.institutions[i.id] : null;
                return Math.round((x ? x.standing : 0.5) * 100) + '%';
              })));
            right.append(el('div', { class: 'cb-quiet', style: { marginTop: '5px' } },
              'Standing drifts back toward neutral. A bad year with a council is not a life sentence, and a run of refusals should not feed itself.'));
          } else {
            right.append(el('div', { class: 'cb-h' }, 'How they regard you'));
            right.append(el('div', { class: 'cb-p' },
              'It does not come into it, so nothing here tracks it. A round does not remember you and '
              + 'a statutory test was never going to be about you. The board does not score you with '
              + 'this body, which is a smaller thing to hold than it sounds: what you do hold is '
              + 'whether the file is complete when it goes in.'));
          }

          if (i.constraint) {
            right.append(el('div', { class: 'cb-h' }, 'The constraint they are under'));
            right.append(el('div', { class: 'cb-p' }, i.constraint));
          }
        }

        /* Instruments. This is where a tier stops being a colour and becomes an Act with a section
           in it. The pack tags each instrument with the tier it belongs to; the Commonwealth ones
           carry the part that bites, because "the EPBC Act applies" is not information and
           "section 16, a declared Ramsar wetland" is. */
        const instruments = ((w.data && w.data.civic && w.data.civic.instruments) || [])
          .filter((x) => x && x.tier === i.tier);
        if (instruments.length) {
          right.append(el('div', { class: 'cb-h' }, 'The instruments at this tier'));
          for (const ins of instruments) {
            right.append(el('div', { class: 'cb-item' },
              el('div', { class: 'body' },
                el('div', {}, ins.label + (ins.date ? ' · ' + ins.date : '')),
                el('em', {}, txt(ins.the_part_that_bites || ins.what_it_does || '')))));
          }
          right.append(el('div', { class: 'cb-quiet' },
            'Read out of data/civic.json. Each carries its own source; where a record says a gap, that gap is in the pack rather than hidden here.'));
        }

        // Every lever they sit in, not only the ones where their name happens to be first. A body
        // that shares eight decisions and leads none was previously rendered as deciding nothing,
        // which is exactly how a whole tier stays invisible.
        right.append(el('div', { class: 'cb-h' }, 'The levers they sit in'));
        const theirs = levers.filter((lv) => (lv.who_decides || []).includes(i.id));
        if (!theirs.length) right.append(el('div', { class: 'cb-p' }, 'None. They are in the pack as a body this island answers to rather than as a decider on any lever in it.'));
        for (const lv of theirs) {
          const first = lv.who_decides[0] === i.id;
          const r = reachOf(w, lv);
          right.append(el('div', { class: 'cb-item' },
            el('div', { class: 'body' },
              el('div', {}, lv.name),
              el('em', {}, (first ? 'Theirs to call' : 'Shared, and ' + ((cou.institutions[lv.who_decides[0]] || {}).label || lv.who_decides[0]) + ' has the first call')
                + ' · ' + roleOf(lv.player_role).label
                + ' · ' + (lv.cost_aud.capital ? money(lv.cost_aud.capital) + ' to build' : 'no capital')
                + ' · ' + leadText(lv.lead_time_months)
                + (r && r.governmentCount >= 2 ? ' · ' + r.label.toLowerCase() : ''))),
            el('button', { class: 'btn ghost', type: 'button', onclick: () => { view.tab = 'levers'; view.leverId = lv.id; view.issueId = null; refresh(true); } }, 'Open')));
        }
        if (i.moneyNote) {
          right.append(el('div', { class: 'cb-h' }, 'How their money actually gets here'));
          right.append(el('div', { class: 'cb-p' }, txt(i.moneyNote)));
        }
        /* The named routes, which the pack researched and nothing rendered. The note above gives
           the shape of it and this gives the programs, each naming the Act or the arrangement it
           runs on. A tier statement rather than a body one, like the instruments above, because the
           money does not come from whichever federal body a player happens to have open: it arrives
           through Queensland or through the council, having been paid to one of them first, which
           is the thing worth learning here and the reason a player who goes looking for a
           Commonwealth lever finds almost none. */
        const cwMoney = (w.data && w.data.civic && w.data.civic.commonwealth_money) || null;
        if (i.tier === 'commonwealth' && cwMoney && Array.isArray(cwMoney.routes) && cwMoney.routes.length) {
          right.append(el('div', { class: 'cb-h' }, 'The ways the money gets here'));
          if (!i.moneyNote && cwMoney.the_honest_note) right.append(el('div', { class: 'cb-p' }, txt(cwMoney.the_honest_note)));
          for (const r of cwMoney.routes) {
            const ins = instruments.find((x) => x.id === r.instrument);
            right.append(el('div', { class: 'cb-item' },
              el('div', { class: 'body' },
                el('div', {}, r.route + ' · ' + (r.tied ? 'tied to what it is for' : 'untied')),
                el('em', {}, txt(r.reaches_the_island_via + '.'
                  + (ins ? ' ' + ins.label + '.' : '')
                  + (r.note ? ' ' + r.note : ''))))));
          }
          if (cwMoney.gap) right.append(el('div', { class: 'cb-quiet' }, txt(cwMoney.gap)));
        }
        right.append(el('div', { class: 'cb-src' }, 'Source: ' + sourceText(w, i.source)));
      }
      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(230px, 24%) 1fr' } }, left, right));
    });

    /** The only Quandamooka material this board may display, straight out of data/lore.json. */
    function qyacPositions(w) {
      const lore = w.data && w.data.lore;
      const block = el('div', {});
      const pos = lore && lore.qyac_public_positions;
      block.append(el('div', { class: 'cb-h' }, 'What has actually been said in public'));
      if (!pos || !pos.positions || !pos.positions.length) {
        block.append(el('div', { class: 'cb-p' }, 'This project holds no public statements for this body.'));
        return block;
      }
      block.append(el('div', { class: 'cb-quiet', style: { marginBottom: '8px' } }, pos.note));
      for (const p of pos.positions) {
        block.append(el('div', { class: 'cb-card' },
          el('h4', {}, p.topic),
          el('div', { class: 'cb-p', style: { marginTop: '5px' } }, txt(p.position)),
          el('div', { class: 'cb-src' }, 'Stated ' + p.stated + ' · source ' + p.source + ' · ' + txt(p.currency))));
      }
      if (pos.explicitly_unknown && pos.explicitly_unknown.length) {
        block.append(el('div', { class: 'cb-h' }, 'What this project does not know'));
        for (const u of pos.explicitly_unknown) block.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, txt(u))));
        block.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
          'An empty area is not an invitation to fill it. Where a lever has no cited public position, this board says so and stops.'));
      }
      return block;
    }

    /* ============================================================== VIEW: IN TRAY */

    /** The pipeline a file actually walks. A body this twin will not simulate has a different end. */
    function stagesFor(app) {
      if (NOT_MODELLED.has(app.decider)) {
        return [['preparing', 'Preparing'], ['assessment', 'Assessment'], ['referred', 'Referred, and it stops there']];
      }
      return [
        ['preparing', 'Preparing'],
        ['assessment', 'Assessment'],
        ['information-request', 'Information requested'],
        ['notification', 'Publicly notified'],
        ['awaiting-decision', 'Waiting for a meeting'],
        ['closed', 'Decided']
      ];
    }

    VIEWS_DEF('intray', (w) => {
      const cou = w.read('council');
      if (!cou || !cou.ready) return notBuilt('The council system is not publishing yet.');

      const left = el('div', { class: 'cb-pane' });
      left.append(el('div', { class: 'cb-h' }, 'Open files'));
      const apps = cou.applications || [];
      for (const p of pendingOpens) {
        left.append(el('div', { class: 'cb-card' },
          el('h4', {}, p.name),
          el('div', { class: 'cb-chips' }, chip('sea', 'yours'), chip('sun', 'opened today')),
          el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
            'The file is open. The desk works through its list once a day, so the paperwork and the assessment clock appear at the change of the day.')));
      }
      if (!apps.length && !pendingOpens.length) {
        left.append(el('div', { class: 'cb-p' }, 'Nothing lodged. Open a file on a lever and the clock starts.'));
      }
      for (const a of apps) {
        left.append(el('div', { class: 'cb-card pick' + (view.appId === a.id ? ' on' : ''), onclick: () => { view.appId = a.id; refresh(true); } },
          el('h4', {}, a.leverName),
          el('div', { class: 'cb-chips' },
            chip(a.origin === 'agenda' ? 'sun' : 'sea', a.origin === 'agenda' ? 'theirs' : 'yours'),
            chip('iron', a.stageLabel.toLowerCase()),
            (a.governments || []).length >= 2
              ? chip((a.governments || []).length === 3 ? 'heath' : 'sun', a.reachLabel, a.reachPlain)
              : null,
            a.infoRequests ? chip('coral', a.infoRequests + ' info request' + (a.infoRequests > 1 ? 's' : '')) : null),
          el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
            a.deciderLabel + ' · open ' + daysText(Math.round(a.openedMonthsAgo * DAYS_PER_MONTH)) +
            (a.waitingDays != null ? ' · ' + daysText(a.waitingDays) + ' to go' : '') +
            (a.crossingWeeks ? ' · ' + a.crossingWeeks + ' weeks of that is crossing governments' : ''))));
      }
      const refs = (cou.referrals || []).filter((r) => r.status === 'open');
      if (refs.length) {
        left.append(el('div', { class: 'cb-h' }, 'Waiting on a body this twin will not simulate'));
        for (const r of refs) {
          left.append(el('div', { class: 'cb-card pick' + (view.appId === r.applicationId ? ' on' : ''), onclick: () => { view.appId = r.applicationId; refresh(true); } },
            el('h4', {}, r.leverName), el('div', { class: 'cb-chips' }, chip('heath', 'referred'))));
        }
      }
      left.append(el('div', { class: 'cb-h' }, 'Closed'));
      const closed = cou.closed || [];
      if (!closed.length) left.append(el('div', { class: 'cb-quiet' }, 'Nothing has come back yet.'));
      for (const c of closed.slice(0, 14)) {
        const cls = c.outcome === 'refused' || c.outcome === 'lapsed' ? 'coral' : c.outcome === 'approved' ? 'leaf' : c.outcome === 'withdrawn' ? 'iron' : 'sun';
        left.append(el('div', { class: 'cb-card' },
          el('h4', {}, c.leverName),
          el('div', { class: 'cb-chips' }, chip(cls, c.outcome.replace(/-/g, ' ')), chip('iron', c.months + ' months')),
          el('div', { class: 'cb-quiet', style: { marginTop: '6px' } }, c.reason),
          c.conditions && c.conditions.length ? el('div', { class: 'cb-quiet', style: { marginTop: '4px' } }, 'Conditions: ' + c.conditions.join('; ')) : null,
          c.restsOnPlayerAssumption ? el('div', { class: 'cb-quiet', style: { marginTop: '4px', color: 'var(--heath)' } }, 'Rests on an assumption you recorded.') : null));
      }

      const right = el('div', { class: 'cb-pane pad' });
      const app = apps.find((a) => a.id === view.appId) || apps[0];
      const ref = (cou.referrals || []).find((r) => r.applicationId === (app && app.id) && r.status === 'open')
        || (cou.referrals || []).find((r) => r.applicationId === view.appId);
      if (!app && !ref) {
        right.append(el('div', { class: 'cb-h' }, 'The waiting is the mechanic'));
        right.append(el('div', { class: 'cb-p', style: { maxWidth: '86ch' } },
          'Nothing on this island happens on the day it is asked for. An application is a clock, not an outcome. It runs an assessment period whether or not the file is complete, and if something is missing it comes back as an information request twelve weeks later, which costs you a season and is exactly how it goes.'));
        right.append(el('div', { class: 'cb-p', style: { maxWidth: '86ch' } },
          'Capital decisions land in a meeting, and a capital decision made after the budget was adopted waits for the next financial year. That single rule is the most common reason a good idea here takes two years instead of one.'));
        right.append(el('div', { class: 'cb-h' }, 'Running totals'));
        const s = cou.stats;
        const t = el('table', { class: 'cb-table' });
        t.append(el('tr', {}, el('th', {}, 'Outcome'), el('th', { class: 'n' }, 'Count')));
        for (const [k, label] of [['lodged', 'Lodged'], ['approved', 'Approved'], ['withConditions', 'Approved with conditions'], ['deferred', 'Deferred'], ['refused', 'Refused'], ['withdrawn', 'Withdrawn'], ['infoRequests', 'Information requests'], ['referred', 'Referred and not modelled']]) {
          t.append(el('tr', {}, el('td', {}, label), el('td', { class: 'n' }, String(s[k] || 0))));
        }
        right.append(t);
        main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(250px, 28%) 1fr' } }, left, right));
        return;
      }

      if (ref && (!app || app.stage === 'referred')) {
        right.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)' } }, ref.leverName));
        right.append(el('div', { class: 'cb-banner stop' }, el('b', {}, 'Referred to ' + ref.bodyLabel + '. '), ref.why));
        right.append(el('div', { class: 'cb-p', style: { maxWidth: '86ch' } }, ref.statement));
        if (ref.capacityNote) right.append(el('div', { class: 'cb-p' }, el('strong', {}, 'Capacity: '), ref.capacityNote));
        right.append(el('div', { class: 'cb-h' }, 'What this project holds on the record'));
        for (const p of ref.citedPositions || []) {
          right.append(el('div', { class: 'cb-card' },
            p.topic ? el('h4', {}, p.topic) : null,
            el('div', { class: 'cb-p', style: { marginTop: p.topic ? '5px' : 0 } }, txt(p.position)),
            el('div', { class: 'cb-src' }, [p.stated ? 'Stated ' + p.stated : null, p.source ? 'source ' + p.source : null, txt(p.currency), txt(p.caveat)].filter(Boolean).join(' · '))));
        }
        right.append(el('div', { class: 'cb-h' }, 'What you can do'));
        for (const line of ref.whatYouCanDo || []) right.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, line)));
        right.append(el('div', { class: 'btn-row', style: { marginTop: '12px' } },
          el('button', { class: 'btn', type: 'button', onclick: () => intent({ kind: 'civic:assume', referralId: ref.id, outcome: 'proceeds' }, 'Recorded an assumption that it proceeded. Everything downstream is now labelled as resting on it.') }, 'Record an assumption that it proceeds'),
          el('button', { class: 'btn danger', type: 'button', onclick: () => intent({ kind: 'civic:assume', referralId: ref.id, outcome: 'declines' }, 'Recorded an assumption that it did not proceed, and closed the file.') }, 'Record that it does not'),
          el('button', { class: 'btn ghost', type: 'button', disabled: true }, 'Leave it pending, which is the truthful outcome')));
        right.append(el('div', { class: 'cb-src' }, 'Opened ' + ref.openedDate + '. Nothing on this file moves while it waits, and that is not a bug.'));
        main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(250px, 28%) 1fr' } }, left, right));
        return;
      }

      /* an ordinary application */
      right.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)' } }, app.leverName));
      right.append(el('div', { class: 'cb-p', style: { marginTop: '5px' } }, app.whose + ' Decided by ' + app.deciderLabel + '.'));

      const stages = stagesFor(app);
      const idx = stages.findIndex((s) => s[0] === app.stage);
      const bar = el('div', { class: 'cb-stage' });
      stages.forEach((s, i2) => bar.append(el('div', { class: i2 < idx ? 'done' : i2 === idx ? 'now' : '', title: s[1] })));
      right.append(bar, el('div', { class: 'cb-stage-lbl' },
        el('span', {}, app.stageLabel),
        el('span', {}, app.waitingDays != null ? daysText(app.waitingDays) + ' to go' : 'your move')));

      const notStarted = app.form.filter((f) => !f.held && !f.inProgress).length;
      const onTheWay = app.form.filter((f) => !f.held && f.inProgress).length;
      const kv = el('dl', { class: 'cb-kv', style: { marginTop: '14px' } });
      kv.append(el('dt', {}, 'Open for'), el('dd', {}, daysText(Math.round(app.openedMonthsAgo * DAYS_PER_MONTH))));
      if (app.waitingDays != null) {
        kv.append(el('dt', {}, 'Next step'), el('dd', {}, 'about ' + dateOfDay(w, (w.read('council').day || 0) + app.waitingDays)));
      }
      kv.append(el('dt', {}, 'File'), el('dd', {}, app.complete ? 'complete'
        : [notStarted ? notStarted + ' not commissioned' : null, onTheWay ? onTheWay + ' on the way' : null].filter(Boolean).join(', ')));
      kv.append(el('dt', {}, 'Consultation'), el('dd', {}, app.consultationRan ? 'one has been run on this' : 'none run'));
      kv.append(el('dt', {}, 'Escalation'), el('dd', {}, app.escalations.length ? app.escalations.join(', ') : 'none'));
      right.append(kv);

      right.append(el('div', { class: 'cb-h' }, 'The form'));
      const budget = w.read('budget');
      for (const f of app.form) {
        const tick = f.held ? ['held', '✓'] : f.inProgress ? ['wait', '•'] : ['no', '✗'];
        const item = el('div', { class: 'cb-item' },
          el('div', { class: 'tick ' + tick[0] }, tick[1]),
          el('div', { class: 'body' },
            el('div', {}, f.label + (f.held ? '' : f.inProgress ? ' (commissioned)' : '')),
            el('em', {}, f.why + ' ' + f.weeks + ' weeks' + (f.cost ? ', ' + moneyFull(f.cost) : ', no cost') +
              (f.satisfiedByConsultation ? '. A consultation satisfies this one.' : ''))));
        if (!f.held && !f.inProgress && app.stage !== 'closed') {
          const afford = !f.cost || !budget || !budget.canSpend || budget.canSpend('council-island', f.cost);
          item.append(el('button', {
            class: 'btn', type: 'button', disabled: !afford,
            title: afford ? null : 'There is not enough in the island program for this.',
            onclick: () => intent({ kind: 'civic:commission', applicationId: app.id, item: f.id }, 'Commissioned ' + f.label.toLowerCase() + '.')
          }, afford ? 'Commission' : 'No money'));
        }
        right.append(item);
      }

      /* The section 75 fork. It appears only once the referral has actually gone in, and it says
         what the twin will not tell you as plainly as what it will: whether this is a controlled
         action is a judgement on a statutory test, and the pack says in the open that this project
         does not make that judgement. The player is told the fork and both sides of it, which is
         more useful than a made-up finding and is the only honest thing available. */
      if (app.commonwealth) {
        const cw = app.commonwealth;
        right.append(el('div', { class: 'cb-h' }, 'With the Commonwealth'));
        right.append(el('div', { class: 'cb-banner' },
          el('b', {}, cw.instrument + '. '),
          'Lodged ' + cw.lodgedDate + ' with ' + cw.body + '. The clock on that decision is '
          + cw.clockDays + ' days, and it is a statutory one rather than a meeting cycle.'));
        right.append(el('div', { class: 'cb-p', style: { maxWidth: '86ch' } }, cw.notModelled));
        for (const f of cw.forks) right.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, el('em', {}, f))));
        right.append(el('div', { class: 'cb-quiet', style: { marginTop: '6px' } }, cw.whatYouHold));
      }

      right.append(el('div', { class: 'cb-h' }, 'What you can do'));
      const row = el('div', { class: 'btn-row' });
      if (app.stage === 'preparing') {
        row.append(el('button', { class: 'btn on', type: 'button', onclick: () => intent({ kind: 'civic:lodge', applicationId: app.id }, 'Lodged. The clock is running.') },
          app.complete ? 'Lodge it' : 'Lodge it anyway'));
        if (!app.complete) right.append(el('div', { class: 'cb-quiet' }, 'An incomplete application still runs its assessment clock, and then comes back as an information request. Twelve weeks, on top of the eight you already waited.'));
      }
      if (app.stage !== 'preparing') {
        row.append(el('button', {
          class: 'btn', type: 'button',
          disabled: app.escalations.includes('petition') || !app.consultationRan,
          title: app.consultationRan ? null : 'A petition with nothing behind it is a list of names. Run a consultation first and have it come back in favour.',
          onclick: () => intent({ kind: 'civic:escalate', applicationId: app.id, how: 'petition' }, 'Petition lodged.')
        }, 'Petition'));
        row.append(el('button', { class: 'btn', type: 'button', disabled: app.escalations.includes('deputation'), onclick: () => intent({ kind: 'civic:escalate', applicationId: app.id, how: 'deputation' }, 'Deputation made in Cleveland. There goes the day.') }, 'Deputation in Cleveland'));
        row.append(el('button', { class: 'btn danger', type: 'button', disabled: app.escalations.includes('media'), onclick: () => intent({ kind: 'civic:escalate', applicationId: app.id, how: 'media' }, 'Taken to the paper. It will be read in Cleveland too.') }, 'Take it to the paper'));
      }
      row.append(el('button', { class: 'btn ghost', type: 'button', onclick: () => { view.tab = 'consult'; view.leverId = app.leverId; refresh(true); } }, 'Consult'));
      row.append(el('button', { class: 'btn ghost', type: 'button', onclick: () => intent({ kind: 'civic:withdraw', applicationId: app.id, reason: 'Withdrawn from the civic desk.' }, 'Withdrawn.') }, 'Withdraw'));
      right.append(row);
      right.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
        'A petition with nothing behind it is a list of names: it needs a consultation that came back in favour. A deputation is a day of your life, the first boat over and the 3pm home gone. Media raises the pressure and lowers the welcome.'));

      right.append(el('div', { class: 'cb-h' }, 'The file so far'));
      for (const h of (app.history || []).slice().reverse()) {
        right.append(el('div', { class: 'cb-item' },
          el('div', { class: 'body' }, el('div', {}, dateOfDay(w, h.day)), el('em', {}, h.detail))));
      }

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(250px, 28%) 1fr' } }, left, right));
    });

    /* ============================================================== VIEW: GROUPS */

    VIEWS_DEF('groups', (w) => {
      const sent = w.read('sentiment');
      if (!sent || !sent.ready) return notBuilt('The sentiment system is not publishing yet.');
      const groups = Object.values(sent.groups).sort((a, b) => a.mood - b.mood);

      const left = el('div', { class: 'cb-pane' });
      left.append(el('div', { class: 'cb-h' }, 'The island, weighted'));
      left.append(el('div', { class: 'cb-card' },
        el('h4', {}, bind((ww) => { const s = ww.read('sentiment'); return s.island.label.replace(/^./, (c) => c.toUpperCase()); })),
        el('div', { class: 'cb-quiet' }, bind((ww) => {
          const s = ww.read('sentiment');
          return 'Angriest: ' + (s.island.angriest ? s.island.angriest.label : 'nobody') +
            '. Happiest: ' + (s.island.happiest ? s.island.happiest.label : 'nobody') + '.';
        }))));
      left.append(el('div', { class: 'cb-quiet', style: { margin: '10px 0' } },
        'There is no approval slider here. Every movement traces to a thing that happened on a day, and clicking a group shows the three that moved it most.'));
      for (const g of groups) {
        const c = el('div', { class: 'cb-card pick' + (view.groupId === g.id ? ' on' : ''), onclick: () => { view.groupId = g.id; refresh(true); } },
          el('h4', {}, g.label),
          el('div', { class: 'cb-chips' },
            chip('iron', g.moodLabel),
            g.isActor ? chip('heath', 'an actor, not a constituency') : chip('sea', Math.round(g.weight * 100) + '% of civic weight')),
          el('div', { class: 'cb-mood' },
            (() => {
              const i = el('i');
              const m = g.mood;
              i.style.background = moodColour(m);
              if (m >= 0) { i.style.left = '50%'; i.style.width = (m * 50) + '%'; }
              else { i.style.right = '50%'; i.style.width = (-m * 50) + '%'; }
              return i;
            })()));
        left.append(c);
      }

      const right = el('div', { class: 'cb-pane pad' });
      const g = sent.groups[view.groupId] || groups[0];
      if (!g) { right.append(el('div', { class: 'cb-p' }, 'No groups.')); }
      else {
        right.append(el('h3', { style: { color: 'var(--t-hi)', fontSize: 'var(--fs-lg)' } }, g.label));
        right.append(el('div', { class: 'cb-p', style: { marginTop: '6px', maxWidth: '90ch' } }, txt(g.about)));

        right.append(el('div', { class: 'cb-h' }, 'The three things that moved them'));
        const why = (sent.explain ? sent.explain(g.id) : g.why) || [];
        if (!why.length) {
          right.append(el('div', { class: 'cb-p' }, 'Nothing yet. They sit at the base mood the researched pack gives them, which is ' + g.base.toFixed(2) + '.'));
        }
        for (const x of why) {
          right.append(el('div', { class: 'cb-item' },
            el('div', { class: 'tick ' + (x.value >= 0 ? 'held' : 'no') }, x.value >= 0 ? '+' : '−'),
            el('div', { class: 'body' },
              el('div', {}, x.text),
              el('em', {}, [x.date, x.kind === 'metric' ? 'a number they watch' : 'something that happened', x.because].filter(Boolean).join(' · ')))));
        }

        const kv = el('dl', { class: 'cb-kv', style: { marginTop: '14px' } });
        kv.append(el('dt', {}, 'Size'), el('dd', {}, g.isActor ? 'not a headcount: this is a body, not a bloc' : Math.round(g.size * 100) + ' per cent of the island’s civic weight'));
        const issueCount = ((w.read('policy') || {}).issues || []).length || 23;
        kv.append(el('dt', {}, 'Intensity'), el('dd', {}, g.intensity.toFixed(2) + '. They are in ' + g.issuesTheyAreIn + ' of the pack’s ' + issueCount + ' arguments' +
          (g.intensity > 1.5 ? ', and that narrow focus is how a small group ends up mattering.' : ', so their attention is spread thin.')));
        kv.append(el('dt', {}, 'Mood'), el('dd', {}, g.moodLabel + ' (' + g.mood.toFixed(2) + ', from a base of ' + g.base.toFixed(2) + ')'));
        right.append(kv);

        right.append(el('div', { class: 'cb-h' }, 'What they want'));
        for (const x of g.wants || []) right.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, txt(x))));
        right.append(el('div', { class: 'cb-h' }, 'What makes them angry'));
        for (const x of g.angers || []) right.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, txt(x))));

        right.append(el('div', { class: 'cb-h' }, 'The numbers they watch, and why the board thinks so'));
        for (const c of g.cares || []) {
          const m = packMetric(w, c.metric);
          right.append(el('div', { class: 'cb-item' },
            el('div', { class: 'body' },
              el('div', {}, (m ? m.label : c.metric) + ' · they want it ' + c.wants),
              el('em', {}, 'Derived from the pack: ' + (c.because || []).map((b) => b.stance + ' ' + b.name).join('; ')))));
        }
        right.append(el('div', { class: 'cb-quiet' },
          'No priority in this list was written by hand. Support a lever and the model concludes you want its effects; oppose one and it concludes the reverse, a little less strongly. Correct the pack and this list moves with it.'));

        if (g.note) right.append(el('div', { class: 'cb-src' }, txt(g.note) + ' Source: ' + (g.source || 'not recorded') + '.'));
      }

      /* the ledger, so a player can see the island reacting */
      const far = el('div', { class: 'cb-pane' });
      far.append(el('div', { class: 'cb-h' }, 'What the island has felt lately'));
      const led = sent.ledger || [];
      if (!led.length) far.append(el('div', { class: 'cb-quiet' }, 'Nothing yet.'));
      for (const e of led) {
        far.append(el('div', { class: 'cb-item' },
          el('div', { class: 'tick ' + (e.delta >= 0 ? 'held' : 'no') }, e.delta >= 0 ? '+' : '−'),
          el('div', { class: 'body' },
            el('div', {}, e.groupLabel + ': ' + e.cause),
            el('em', {}, [e.date, e.detail].filter(Boolean).join(' · ')))));
      }

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: 'minmax(230px, 22%) 1fr minmax(240px, 24%)' } }, left, right, far));
    });

    /* ============================================================== VIEW: CONSULTATION */

    VIEWS_DEF('consult', (w) => {
      const con = w.read('consultation');
      if (!con || !con.ready) return notBuilt('The consultation system is not publishing yet.');
      const levers = packLevers(w);
      const leverId = view.leverId || (con.ifYouCalledOneTonight && con.ifYouCalledOneTonight.leverId) || levers[0].id;
      const lv = levers.find((x) => x.id === leverId);

      const left = el('div', { class: 'cb-pane pad' });
      left.append(el('div', { class: 'cb-h' }, 'If you called one tonight'));
      const tonight = con.ifYouCalledOneTonight;
      if (tonight) {
        left.append(el('div', { class: 'cb-p' }, tonight.line));
        const t = el('table', { class: 'cb-table', style: { marginTop: '8px' } });
        t.append(el('tr', {}, el('th', {}, 'When'), el('th', { class: 'n' }, 'Who comes'), el('th', { class: 'n' }, 'Gap'), el('th', {}, 'Missing most')));
        for (const o of tonight.options) {
          t.append(el('tr', { class: o.slot === tonight.fairestSlot ? 'hi' : '' },
            el('td', {}, o.when), el('td', { class: 'n' }, String(o.attendance)),
            el('td', { class: 'n' }, o.gapIndex.toFixed(2)),
            el('td', {}, labelOfGroup(w, o.worstUnder))));
        }
        left.append(t);
      } else {
        left.append(el('div', { class: 'cb-p' }, 'Nothing is live enough to call a meeting about.'));
      }

      left.append(el('div', { class: 'cb-h' }, 'Plan one'));
      const methodSel = el('select', { onchange: (e) => { view.consult.method = e.target.value; refresh(true); } });
      for (const m of Object.values(con.methods)) methodSel.append(el('option', { value: m.id, selected: view.consult.method === m.id || null }, m.label.replace(/^an? /, '')));
      const venueSel = el('select', { onchange: (e) => { view.consult.venue = e.target.value; refresh(true); } });
      venueSel.append(el('option', { value: '', selected: view.consult.venue === '' || null }, 'The obvious hall for it'));
      for (const v of Object.values(con.venues)) venueSel.append(el('option', { value: v.id, selected: view.consult.venue === v.id || null }, v.label));
      const slotSel = el('select', { onchange: (e) => { view.consult.slot = e.target.value; refresh(true); } });
      for (const [k, label] of [['weekday-day', 'A Wednesday at 10am'], ['weekday-evening', 'A Wednesday at 5.30pm'], ['saturday', 'A Saturday morning'], ['sunday', 'A Sunday morning']]) {
        slotSel.append(el('option', { value: k, selected: view.consult.slot === k || null }, label));
      }
      const noticeIn = el('input', { type: 'number', min: '3', max: '60', value: String(view.consult.notice), onchange: (e) => { view.consult.notice = clamp(Number(e.target.value) || 21, 3, 60); refresh(true); } });
      const leverSel = el('select', { onchange: (e) => { view.leverId = e.target.value; refresh(true); } });
      for (const x of levers) leverSel.append(el('option', { value: x.id, selected: x.id === leverId || null }, x.name));

      left.append(el('div', { class: 'cb-form' },
        el('label', {}, 'About', leverSel),
        el('label', {}, 'How', methodSel),
        el('label', {}, 'Where', venueSel),
        el('label', {}, 'When', slotSel),
        el('label', {}, 'Days of notice', noticeIn)));

      const method = con.methods[view.consult.method];
      if (method) left.append(el('div', { class: 'cb-quiet', style: { marginBottom: '10px' } }, method.note));

      const pre = con.preview ? con.preview(leverId, view.consult.method, view.consult.venue || undefined, view.consult.slot, view.consult.notice) : null;
      if (pre) {
        left.append(el('div', { class: 'cb-nums' },
          el('div', { class: 'cb-num' }, el('b', {}, String(pre.expectedAttendance)), el('i', {}, 'in the room')),
          el('div', { class: 'cb-num' }, el('b', {}, String(pre.expectedSubmissions)), el('i', {}, 'write in')),
          el('div', { class: 'cb-num' }, el('b', {}, String(pre.turnedAway)), el('i', {}, 'turned away')),
          el('div', { class: 'cb-num' }, el('b', {}, pre.gapIndex.toFixed(2)), el('i', {}, 'the gap')),
          el('div', { class: 'cb-num' }, el('b', {}, moneyFull(pre.cost)), el('i', {}, 'it costs'))));
        left.append(el('div', { class: 'cb-p', style: { marginTop: '10px' } }, pre.quietTruth));
        left.append(el('div', { class: 'btn-row', style: { marginTop: '10px' } },
          el('button', {
            class: 'btn on', type: 'button',
            onclick: () => intent({ kind: 'civic:consult', leverId, method: view.consult.method, venue: view.consult.venue || undefined, slot: view.consult.slot, noticeDays: view.consult.notice },
              'Consultation called. Notice goes out today and the record closes in ' + (view.consult.notice + (method ? method.days : 1)) + ' days.')
          }, 'Run it'),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => { view.tab = 'levers'; refresh(true); } }, 'Back to the lever')));
        left.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
          'Fewer than fourteen days of notice costs trust whatever the meeting finds. The venue capacity is modelled: no published seating figure was found for any of the three halls.'));

        left.append(el('div', { class: 'cb-h' }, 'Who would be in that room'));
        const t2 = el('table', { class: 'cb-table' });
        t2.append(el('tr', {}, el('th', {}, 'Group'), el('th', { class: 'n' }, 'Affected'), el('th', { class: 'n' }, 'Voice'), el('th', { class: 'n' }, 'Ratio'), el('th', {}, 'Could they come')));
        const rows = Object.entries(pre.byGroup).sort((a, b) => b[1].affectedShare - a[1].affectedShare);
        for (const [gid, r] of rows) {
          t2.append(el('tr', { class: r.ratio < 0.5 ? 'hi' : '' },
            el('td', {}, r.label),
            el('td', { class: 'n' }, Math.round(r.affectedShare * 100) + '%'),
            el('td', { class: 'n' }, Math.round(r.voiceShare * 100) + '%'),
            el('td', { class: 'n' }, r.ratio.toFixed(2)),
            el('td', {}, Math.round(r.couldTheyCome * 100) + '%' + (r.because ? '. ' + r.because : ''))));
        }
        left.append(t2);
      }

      const right = el('div', { class: 'cb-pane' });
      right.append(el('div', { class: 'cb-h' }, 'Open now'));
      if (!(con.open || []).length) right.append(el('div', { class: 'cb-quiet' }, 'Nothing open.'));
      for (const c of con.open) {
        right.append(el('div', { class: 'cb-card' },
          el('h4', {}, c.leverName),
          el('div', { class: 'cb-chips' }, chip('sea', c.methodLabel.replace(/^an? /, '')), c.auto ? chip('sun', 'not yours') : null,
            c.decisionNotOurs ? chip('heath', 'not this meeting’s call') : null),
          el('div', { class: 'cb-quiet', style: { marginTop: '6px' } },
            c.venueLabel + ', ' + c.whenLabel + '. ' + (c.daysToEvent > 0 ? daysText(c.daysToEvent) + ' until it happens' : 'happening now') + ', closes in ' + daysText(c.daysToClose) + '.')));
      }

      right.append(el('div', { class: 'cb-h' }, 'What came back'));
      if (!(con.closed || []).length) right.append(el('div', { class: 'cb-quiet' }, 'Nothing yet.'));
      for (const r of (con.closed || []).slice(0, 8)) {
        const card = el('div', { class: 'cb-card' },
          el('h4', {}, r.leverName),
          el('div', { class: 'cb-quiet', style: { marginTop: '4px' } }, r.date + ' · ' + r.methodLabel + ' at ' + r.venueLabel),
          el('div', { class: 'cb-nums' },
            el('div', { class: 'cb-num' }, el('b', {}, String(r.attended)), el('i', {}, 'came')),
            el('div', { class: 'cb-num' }, el('b', {}, String(r.submissions)), el('i', {}, 'wrote in')),
            el('div', { class: 'cb-num' }, el('b', {}, Math.round(r.supportShare * 100) + '%'), el('i', {}, 'in favour')),
            el('div', { class: 'cb-num' }, el('b', {}, r.gapIndex.toFixed(2)), el('i', {}, 'the gap'))),
          el('div', { class: 'cb-p', style: { marginTop: '8px' } }, r.quietTruth));
        if (r.turnedAway > 0) card.append(el('div', { class: 'cb-quiet' }, r.turnedAway + ' people could not get in.'));
        if (r.issuesRaised && r.issuesRaised.length) {
          card.append(el('div', { class: 'cb-h' }, 'What was said'));
          for (const is of r.issuesRaised) {
            card.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' }, el('div', {}, is.text), el('em', {}, 'raised by ' + is.fromGroupLabel))));
          }
        }
        if (r.notOursNote) card.append(el('div', { class: 'cb-banner stop', style: { marginTop: '10px' } }, r.notOursNote));
        right.append(card);
      }

      right.append(el('div', { class: 'cb-h' }, 'Consultation fatigue'));
      right.append(el('div', { class: 'cb-track' }, bindW(el('i'), (ww) => Math.round(clamp((ww.read('consultation') || {}).fatigue || 0, 0, 1) * 100) + '%')));
      right.append(el('div', { class: 'cb-quiet', style: { marginTop: '5px' } },
        bind((ww) => {
          const c = ww.read('consultation') || {};
          return (c.running12Months || 0) + ' consultations in the last twelve months. Every one of them makes the next one smaller.';
        })));
      for (const n of con.notes || []) right.append(el('div', { class: 'cb-src' }, n));

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: '1fr minmax(300px, 32%)' } }, left, right));
    });

    function labelOfGroup(w, gid) {
      const s = w.read('sentiment');
      return (s && s.groups && s.groups[gid] ? s.groups[gid].label : gid) || 'nobody in particular';
    }

    /* ============================================================== VIEW: BUDGET */

    VIEWS_DEF('budget', (w) => {
      const b = w.read('budget');
      if (!b || !b.ready) return notBuilt('The budget system is not publishing yet.');

      const left = el('div', { class: 'cb-pane pad' });
      left.append(el('div', { class: 'cb-h' }, 'Four purses, and which one holds the money matters more than how much is in it'));
      const grid = el('div', { class: 'cb-grid wide' });
      for (const f of Object.values(b.funds)) {
        if (f.id === 'external' && !f.balance && !f.committedRecurring) continue;
        const card = el('div', { class: 'cb-card' },
          el('h4', {}, f.label),
          el('div', { class: 'cb-chips' },
            chip(f.spendableByPlayer ? 'sea' : 'iron', f.spendableByPlayer ? 'you can spend it' : 'not yours to spend'),
            f.ringFenced ? chip('sun', 'ring fenced') : null,
            f.capitalOnly ? chip('heath', 'capital only') : null),
          el('div', { class: 'cb-nums' },
            el('div', { class: 'cb-num' }, el('b', {}, bind(() => (w.read('budget').funds[f.id] || {}).balanceText || '')), el('i', {}, 'in it now')),
            f.spendableByPlayer
              ? el('div', { class: 'cb-num' }, el('b', {}, money(f.availableThisYear)), el('i', {}, 'free this year'))
              : el('div', { class: 'cb-num' }, el('b', {}, bind(() => money((w.read('budget').funds[f.id] || {}).revenueYTD))), el('i', {}, 'raised this year')),
            el('div', { class: 'cb-num' }, el('b', {}, money(f.committedRecurring)), el('i', {}, 'a year already spoken for'))),
          el('div', { class: 'cb-quiet', style: { marginTop: '8px' } }, f.holder + '. ' + f.note));
        if (f.openingNote) card.append(el('div', { class: 'cb-src' }, f.openingNote));
        grid.append(card);
      }
      left.append(grid);

      left.append(el('div', { class: 'cb-h' }, 'The financial year is a mechanic'));
      left.append(el('div', { class: 'cb-p', style: { maxWidth: '92ch' } },
        bind((ww) => {
          const bb = ww.read('budget');
          // daysText already returns a phrase for a date that has arrived, so "away" only belongs
          // on a date that has not: "adoption is due now away" was reaching the screen.
          return 'It is ' + bb.fy + ', day ' + bb.dayOfFY + '. The budget is '
            + (bb.adopted ? 'adopted'
              : 'not adopted yet, and adoption is ' + daysText(bb.daysToAdoption)
                + (bb.daysToAdoption != null && bb.daysToAdoption > 0 ? ' away' : '')) + '. ' +
            'A capital bid that lands after adoption waits a year, and island capital left unspent at 30 June goes back to a city with 150,000 people on the mainland.';
        })));

      left.append(el('div', { class: 'cb-h' }, 'What the island raises against what it gets'));
      const L = b.islandLedger;
      left.append(el('div', { class: 'cb-nums' },
        el('div', { class: 'cb-num' }, el('b', {}, money(L.ratesRaised)), el('i', {}, 'general rates')),
        el('div', { class: 'cb-num' }, el('b', {}, money(L.wasteChargeRaised)), el('i', {}, 'waste charge')),
        el('div', { class: 'cb-num' }, el('b', {}, money(L.programAllocation)), el('i', {}, 'island program')),
        el('div', { class: 'cb-num' }, el('b', {}, L.ratio.toFixed(2) + '×'), el('i', {}, 'program to own source'))));
      left.append(el('div', { class: 'cb-p', style: { marginTop: '8px' } }, L.sentence));
      left.append(el('div', { class: 'cb-src' }, L.caveat));

      left.append(el('div', { class: 'cb-h' }, 'Every tonne leaves on a boat'));
      left.append(el('div', { class: 'cb-nums' },
        el('div', { class: 'cb-num' }, el('b', {}, bind(() => String(w.read('budget').waste.tonnesPerYearRate))), el('i', {}, 'tonnes a year')),
        el('div', { class: 'cb-num' }, el('b', {}, moneyFull(b.waste.costPerTonne)), el('i', {}, 'a tonne')),
        el('div', { class: 'cb-num' }, el('b', {}, bind(() => money(w.read('budget').waste.costPerYear))), el('i', {}, 'a year to shift it')),
        el('div', { class: 'cb-num' }, el('b', {}, money(b.waste.chargeRaisedFromIsland)), el('i', {}, 'raised from the island'))));
      left.append(el('div', { class: 'cb-p', style: { marginTop: '8px' } }, bind(() => w.read('budget').waste.sentence)));
      left.append(el('div', { class: 'cb-src' }, b.waste.basis + ' Source: ' + b.waste.source + '.'));

      const right = el('div', { class: 'cb-pane' });
      right.append(el('div', { class: 'cb-h' }, 'Revenue, and where each number comes from'));
      const rt = el('table', { class: 'cb-table' });
      rt.append(el('tr', {}, el('th', {}, 'Line'), el('th', { class: 'n' }, 'A year'), el('th', {}, 'Basis')));
      for (const r of b.revenue) rt.append(el('tr', { title: r.basis }, el('td', {}, r.label), el('td', { class: 'n' }, r.text), el('td', {}, r.basisKind)));
      right.append(rt);
      right.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
        'Only the waste charge and the state program totals on this page are published figures. Everything else is modelled and labelled as such, and none of it should be quoted at a council meeting.'));

      right.append(el('div', { class: 'cb-h' }, 'What it costs to run the island'));
      const et = el('table', { class: 'cb-table' });
      et.append(el('tr', {}, el('th', {}, 'Line'), el('th', { class: 'n' }, 'A year'), el('th', {}, 'Basis')));
      for (const r of b.expenditure.slice(0, 18)) et.append(el('tr', { title: r.basis }, el('td', {}, r.label), el('td', { class: 'n' }, r.text), el('td', {}, r.basisKind)));
      right.append(et);

      right.append(el('div', { class: 'cb-h' }, 'Committed'));
      for (const c of b.commitments) {
        if (!c.capital && c.standing) continue;
        right.append(el('div', { class: 'cb-item' },
          el('div', { class: 'body' },
            el('div', {}, c.name),
            el('em', {}, (c.capital ? money(c.drawn) + ' drawn of ' + money(c.capital) + ', ' + money(c.remaining) + ' unbuilt. ' : '') +
              (c.recurring ? money(c.recurring) + ' a year. ' : '') + 'From the ' + c.fund + ' purse.'))));
      }
      const standing = b.commitments.filter((c) => c.standing && !c.capital);
      if (standing.length) {
        right.append(el('div', { class: 'cb-quiet', style: { marginTop: '8px' } },
          standing.length + ' programs were already running and already costing money on day one, at ' +
          money(standing.reduce((s, c) => s + c.recurring, 0)) + ' a year. The island’s budget starts committed, because it is.'));
      }

      if ((b.recentSpends || []).length) {
        right.append(el('div', { class: 'cb-h' }, 'Recently spent'));
        for (const s of b.recentSpends) {
          right.append(el('div', { class: 'cb-item' }, el('div', { class: 'body' },
            el('div', {}, moneyFull(s.amount) + ' · ' + s.reason), el('em', {}, s.date + ' · ' + s.fund))));
        }
      }
      if ((b.history || []).length) {
        right.append(el('div', { class: 'cb-h' }, 'Years closed'));
        const ht = el('table', { class: 'cb-table' });
        ht.append(el('tr', {}, el('th', {}, 'Year'), el('th', { class: 'n' }, 'In'), el('th', { class: 'n' }, 'Out'), el('th', { class: 'n' }, 'Tonnes')));
        for (const h of b.history) ht.append(el('tr', {}, el('td', {}, h.fy), el('td', { class: 'n' }, money(h.revenue)), el('td', { class: 'n' }, money(h.spend)), el('td', { class: 'n' }, String(h.wasteTonnes))));
        right.append(ht);
      }

      main.append(el('div', { class: 'cb-cols', style: { gridTemplateColumns: '1fr minmax(320px, 38%)' } }, left, right));
    });

    /* ------------------------------------------------------------------ plumbing */

    function notBuilt(msg) {
      main.append(el('div', { class: 'cb-pane pad' },
        el('div', { class: 'cb-h' }, 'Not connected'),
        el('div', { class: 'cb-p' }, msg + ' The board reads published state and never guesses at it, so it shows you the gap instead.')));
    }

    return {
      update(w) {
        const c = w.read('council');
        const n = c ? c.inTrayCount : 0;
        const txt = n ? String(n) : '';
        if (badge.textContent !== txt) badge.textContent = txt;
        if (!open) return;
        refresh(false);
      }
    };

    /** Declared after use on purpose: hoisted so the views can be written in reading order. */
    function VIEWS_DEF(id, fn) { VIEWS[id] = fn; }
  }
});

/** Filled by VIEWS_DEF inside mount. One board per page, so a module-level map is fine. */
const VIEWS = {};
