// The inspector. Click anything on the island and this is what tells you what it is and why.
//
// The rest of the project spends thirty-eight systems working out that Wendy Eastwood is asleep at
// twenty past five in the morning because it is the middle of the night, that she has lived here
// forty-one years, that the house two doors up has had nobody in it since Easter, and that the
// koala in the gum behind them is carrying chlamydia with no signs yet. None of that is worth
// anything if a player cannot see it. This panel is where the simulation becomes legible.
//
// THE RULE THIS PANEL IS BUILT ON
//   A number with no reason is a failure. Every figure here comes with what it is, where it came
//   from, and what is making it that. Where a number is modelled rather than measured, it says so,
//   because half the interesting figures on this island have never been published by anybody and
//   pretending otherwise would be the one unforgivable thing in a twin of a real place.
//
// HOW IT UPDATES
//   Panels tick at 10 Hz. Rebuilding four hundred nodes ten times a second would throw away scroll
//   position and keyboard focus, so the structure is built once per selection and per tab, and
//   anything that moves registers a small closure in `live`. Selecting a person and watching their
//   energy drain is then a few dozen text writes a second.
//
// KEYBOARD
//   Tab reaches the panel. Inside it, up and down move between rows, left and right change tabs,
//   Enter follows a row to whatever it points at, Backspace goes back, Escape clears the selection
//   and hands the island back to the camera. Every key pressed inside the panel is stopped from
//   reaching the camera rig, so arrowing through a list of relatives does not fly you across the bay.

import { registerPanel, el } from '../mount.js';
import { freshnessAt, checkedPhrase, freshnessMoment, STALE_AFTER_DAYS } from '../../world/freshness.js';

/* ------------------------------------------------------------------ formatting */

const A$ = (v) => (v === null || v === undefined || !Number.isFinite(v) ? 'not modelled'
  : 'A$' + Math.round(v).toLocaleString('en-AU'));
const pct = (v, dp = 0) => (Number.isFinite(v) ? (v * 100).toFixed(dp) + '%' : '-');
const num = (v, dp = 0) => (Number.isFinite(v)
  ? (Math.abs(v) >= 10000 ? v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : v.toFixed(dp))
  : '-');
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
/** Ids into English: kebab, snake and camel all come out as words. */
const plain = (s) => String(s || '').replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const count = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const days = (n) => (n <= 0 ? 'today' : count(n, 'day') + ' ago');

const TOWNSHIP = {
  dunwich: 'Dunwich', 'point-lookout': 'Point Lookout', 'amity-point': 'Amity Point',
  'one-mile': 'One Mile and the rural balance'
};
/** Takes an id or a label. Some read models carry "point-lookout" and some carry the pack's own
 *  "Point Lookout (Mulumba)", and flattening the second one to lower case would be wrong. */
const townshipName = (id) => {
  if (!id) return 'the island';
  if (TOWNSHIP[id]) return TOWNSHIP[id];
  return /[A-Z ]/.test(id) ? String(id) : cap(plain(id));
};

/** Sim ticks into something a person says out loud. 144 ticks is a day. */
function agoLabel(world, tick) {
  const d = Math.floor((world.clock.tick - tick) / 144);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return 'last week';
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/* ------------------------------------------------------------------ needs vocabulary

A meter at 0.62 tells a player nothing. "Peckish" tells them everything. Eight of the nine run
one way, from desperate at zero to satisfied at one; island fatigue runs the other way, because
being ground down by a place is not the absence of a need, it is the presence of one. */

const NEED_WORDS = {
  hunger: [[0.7, 'fed'], [0.45, 'peckish'], [0.22, 'hungry'], [0, 'has not eaten']],
  energy: [[0.7, 'rested'], [0.45, 'going alright'], [0.22, 'tired'], [0, 'running on empty']],
  hygiene: [[0.7, 'clean'], [0.45, 'salty'], [0.22, 'sandy and sticky'], [0, 'needs a shower badly']],
  bladder: [[0.5, 'fine'], [0.25, 'thinking about it'], [0, 'needs the toilet']],
  fun: [[0.7, 'enjoying themselves'], [0.45, 'ticking along'], [0.22, 'flat'], [0, 'bored stiff']],
  social: [[0.7, 'well connected'], [0.45, 'seen a few people'], [0.22, 'quiet'], [0, 'lonely']],
  comfort: [[0.7, 'comfortable'], [0.45, 'settled enough'], [0.22, 'unsettled'], [0, 'wretched']],
  place: [[0.7, 'at home here'], [0.45, 'grounded'], [0.22, 'has not been out in it'], [0, 'has not been near the water in a fortnight']],
  islandFatigue: [[0.7, 'ground down'], [0.55, 'worn by it'], [0.35, 'feeling the island'], [0, 'fine with it']]
};
const NEED_LABEL = {
  hunger: 'Hunger', energy: 'Energy', hygiene: 'Clean', bladder: 'Bladder', fun: 'Fun',
  social: 'Company', comfort: 'Comfort', place: 'This place', islandFatigue: 'Island fatigue'
};
const NEED_ORDER = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'comfort', 'place', 'islandFatigue'];

function needWord(key, v) {
  const table = NEED_WORDS[key] || [[0, '']];
  for (const [t, w] of table) if (v >= t) return w;
  return table[table.length - 1][1];
}
function needClass(key, v) {
  if (key === 'islandFatigue') return v > 0.62 ? 'bad' : v > 0.42 ? 'warn' : 'good';
  return v < 0.22 ? 'bad' : v < 0.45 ? 'warn' : 'good';
}

/* ------------------------------------------------------------------ panel css

Layout only. Every colour, radius, shadow, easing and space is a token from src/ui/design.css:
if this file ever needs a new one, it goes there, not here. */

const CSS = `
/* The right hand column. The bar at the top of the screen is permanent chrome that publishes
   --hud-height, so this docks under it rather than over it: parked on top of the bar it used to
   steal 376 px from a 1280 px readout and crush every conditions tile into its neighbour. The
   minimap sits to the left of this column, not under it, because the island is 39 km by 15 km and
   a minimap of it is inherently tall and thin. */
.insp {
  top: calc(var(--hud-height) + var(--sp-2)); right: var(--sp-4); width: 376px;
  max-height: calc(100% - var(--hud-height) - var(--sp-2) - var(--sp-4));
  display: flex; flex-direction: column; z-index: 24;
}
.insp .panel-head { flex: none; }
.insp-id { flex: none; padding: var(--sp-3) var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--edge); }
.insp-name { font-size: var(--fs-xl); line-height: 1.15; color: var(--t-hi); font-weight: 400; }
.insp-sub { font-size: var(--fs-sm); color: var(--t-dim); margin-top: 2px; }
.insp-chips { display: flex; gap: var(--sp-1); flex-wrap: wrap; margin-top: var(--sp-2); }
.insp .tabs { flex: none; padding: 0 var(--sp-2); }
.insp-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--sp-3) var(--sp-3) var(--sp-5); }
.insp-foot {
  flex: none; padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--edge);
  font-size: var(--fs-micro); color: var(--t-faint); display: flex; gap: var(--sp-2); align-items: center;
}
.insp-foot .grow { flex: 1; }

.sec { margin-bottom: var(--sp-4); }
.sec:last-child { margin-bottom: 0; }
.sec > h4 {
  font-size: var(--fs-micro); letter-spacing: .14em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; margin-bottom: var(--sp-2); padding: 0 var(--sp-1);
}
.lede { font-size: var(--fs-lg); color: var(--t-hi); line-height: 1.35; padding: 0 var(--sp-1); }
.why-box {
  background: var(--s-sunk); border-left: 2px solid var(--sea); border-radius: var(--r-1);
  padding: var(--sp-2) var(--sp-3); font-size: var(--fs-sm); color: var(--t); line-height: 1.55;
}
.why-box + .why-box { margin-top: var(--sp-2); }
.why-box.warn { border-left-color: var(--sun); }
.why-box.bad { border-left-color: var(--coral); }
.why-box b { color: var(--t-hi); font-weight: 600; }

.kv { display: grid; grid-template-columns: 104px 1fr; gap: 3px var(--sp-3); font-size: var(--fs-sm); padding: 0 var(--sp-1); }
.kv dt { color: var(--t-faint); }
.kv dd { color: var(--t); min-width: 0; overflow-wrap: anywhere; }
.kv dd em { color: var(--t-faint); font-style: normal; }

.need { display: grid; grid-template-columns: 74px 1fr 136px; gap: var(--sp-2); align-items: center;
  padding: 3px var(--sp-1); font-size: var(--fs-sm); border-radius: var(--r-1); }
.need .n { color: var(--t-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.need .s { text-align: right; color: var(--t-faint); font-size: var(--fs-micro); line-height: 1.3; }
.need.hi { background: rgba(226,114,91,.10); }
.need-split { display: flex; align-items: center; gap: var(--sp-2); margin: var(--sp-3) var(--sp-1) var(--sp-1); }
.need-split span { font-size: var(--fs-micro); color: var(--t-faint); white-space: nowrap; }
.need-split i { flex: 1; height: 1px; background: var(--edge); }

.tie { padding: var(--sp-2) var(--sp-1); border-radius: var(--r-2); cursor: pointer; transition: background var(--fast); }
.tie:hover { background: rgba(255,255,255,.055); }
.tie:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.tie-top { display: flex; align-items: baseline; gap: var(--sp-2); }
.tie-top .name { flex: 1; color: var(--t-hi); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tie .meter { margin: 5px 0 4px; }
.tie-facts { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.5; }

.basis { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.65; padding: 0 var(--sp-1); margin-top: var(--sp-2); }
.basis b { color: var(--t-dim); font-weight: 600; }
.stat-row { display: flex; gap: var(--sp-4); flex-wrap: wrap; padding: 0 var(--sp-1); }
.insp .row.pick:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.insp .row .bar { width: 54px; flex: none; }
.tie-note { font-size: var(--fs-micro); color: var(--t-faint); padding: 0 var(--sp-3) var(--sp-2) 34px; line-height: 1.55; }
.hist { display: flex; gap: var(--sp-3); padding: var(--sp-2) var(--sp-1); border-bottom: 1px solid var(--edge); font-size: var(--fs-sm); }
.hist:last-child { border-bottom: none; }
.hist .when { flex: none; width: 84px; color: var(--t-faint); font-size: var(--fs-micro); padding-top: 2px; }
.hist .what { flex: 1; color: var(--t); }

.insp-empty { padding: var(--sp-5) var(--sp-4); text-align: center; }
/* Quiet enough not to shout over the person, loud enough that nobody can say they were not told. */
/* --fs-sm, not --fs-micro. The first version of this rendered at 10px, and a disclosure nobody can
   comfortably read is not a disclosure. It stays visually quiet through colour rather than size. */
.insp-synthetic { font-size: var(--fs-sm); line-height: 1.5; color: var(--t-dim);
  border-left: 2px solid var(--heath); padding: var(--sp-2) var(--sp-3);
  background: rgba(180,138,196,.07); border-radius: 0 var(--r-2) var(--r-2) 0;
  margin-bottom: var(--sp-3); }
.insp-empty .big { font-size: var(--fs-lg); color: var(--t-dim); margin-bottom: var(--sp-2); }
.insp-empty p { font-size: var(--fs-sm); color: var(--t-faint); line-height: 1.6; }
.insp-empty .rows { margin-top: var(--sp-2); text-align: left; }
.insp-empty h4 { font-size: var(--fs-micro); letter-spacing: .14em; color: var(--t-faint); font-weight: 600; }

@media (max-width: 860px) {
  .insp { top: auto; bottom: var(--sp-2); max-height: 56%; }
}
`;

export function registerInspector(world) {
  registerPanel({
    id: 'inspector',
    order: 40,
    mount(root) { return mount(root, world); }
  });
}

function mount(root, world) {
  if (!document.getElementById('insp-css')) {
    const style = el('style', { id: 'insp-css' });
    style.textContent = CSS;
    document.head.append(style);
  }

  /* ---- shell ---- */

  const nameEl = el('div', { class: 'insp-name' }, 'Nothing selected');
  const subEl = el('div', { class: 'insp-sub' }, 'Click anything on the island');
  const chipsEl = el('div', { class: 'insp-chips' });
  const idEl = el('div', { class: 'insp-id' }, nameEl, subEl, chipsEl);

  const tabsEl = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Inspector views' });
  const bodyEl = el('div', { class: 'insp-body scroll', role: 'tabpanel', tabindex: '-1' });
  const footEl = el('div', { class: 'insp-foot' });

  const backBtn = el('button', {
    class: 'btn ghost icon', title: 'Back to the last thing (Backspace)', 'aria-label': 'Back',
    onclick: () => goBack()
  }, '←');
  const focusBtn = el('button', {
    class: 'btn ghost icon', title: 'Fly to it', 'aria-label': 'Fly to the selection',
    onclick: () => world.bus.emit('ui:intent', { kind: 'select:focus' })
  }, '◎');
  const followBtn = el('button', {
    class: 'btn ghost icon', title: 'Lock the camera on it', 'aria-label': 'Follow the selection',
    onclick: () => world.bus.emit('ui:intent', { kind: 'select:follow' })
  }, '▶');
  const closeBtn = el('button', {
    class: 'btn ghost icon', title: 'Clear the selection (Esc)', 'aria-label': 'Clear the selection',
    onclick: () => world.bus.emit('ui:intent', { kind: 'select:clear' })
  }, '✕');

  const head = el('div', { class: 'panel-head' },
    backBtn,
    el('div', { class: 'panel-title' }, 'Inspector'),
    focusBtn, followBtn, closeBtn);

  const panel = el('aside', {
    class: 'panel floating insp enter', id: 'inspector-panel',
    'aria-label': 'Inspector'
  }, head, idEl, tabsEl, bodyEl, footEl);
  root.append(panel);

  /* ---- state ---- */

  let curKind = null, curId = null, curTab = null;
  let live = [];               // closures re-run at 10 Hz; the only thing that touches the DOM after a build
  let tabs = [];

  const sel = () => world.read('selection') || {};

  function intent(kind, id, opts) {
    world.bus.emit('ui:intent', Object.assign({ kind: 'select', target: { kind, id }, source: 'inspector' }, opts || {}));
  }
  function goBack() {
    const s = sel();
    if (!s.history || !s.history.length) return;
    world.bus.emit('ui:intent', { kind: 'select:back', source: 'inspector' });
  }

  /* ---- building blocks ---------------------------------------------------
     Each returns a node. Anything that changes registers a closure in `live`. */

  /** A closure re-run at 10 Hz. Wrapped, because one missing field in one read model must not take
   *  the whole panel down: this is the panel a player will have open when something else breaks. */
  const bind = (fn) => {
    const safe = () => { try { fn(); } catch (e) { /* a bad readout is a blank readout */ } };
    live.push(safe);
    safe();
  };

  function sec(title, ...kids) {
    const body = kids.flat().filter(Boolean);
    if (!body.length) return null;
    return el('div', { class: 'sec' }, title ? el('h4', {}, title) : null, body);
  }

  function kv(pairs) {
    const nodes = [];
    for (const [k, v] of pairs) {
      if (v === null || v === undefined || v === '') continue;
      nodes.push(el('dt', {}, k), el('dd', {}, v));
    }
    return nodes.length ? el('dl', { class: 'kv' }, nodes) : null;
  }

  function chip(text, tone) {
    return el('span', { class: 'chip ' + (tone || 'sea') }, text);
  }

  function meterRow(label, get, opts = {}) {
    const fill = el('i');
    const bar = el('div', { class: 'meter' }, fill);
    const words = el('div', { class: 's' });
    const row = el('div', { class: 'need' }, el('div', { class: 'n' }, label), bar, words);
    bind(() => {
      const r = get();
      if (!r) return;
      const v = Math.max(0, Math.min(1, r.value));
      fill.style.width = (v * 100).toFixed(1) + '%';
      bar.className = 'meter ' + (r.tone || '');
      words.textContent = r.word || pct(v);
      row.classList.toggle('hi', !!r.urgent);
    });
    return row;
  }

  function pickRow(label, sub, target, extra) {
    const node = el('div', {
      class: 'row pick', tabindex: '0', role: 'button',
      onclick: () => intent(target.kind, target.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); intent(target.kind, target.id); } }
    },
    el('div', { class: 'lead' }, el('div', { class: 'name' }, label), sub ? el('div', { class: 'sub' }, sub) : null),
    extra || null);
    return node;
  }

  function readout(k, get, tone) {
    const v = el('div', { class: 'v' });
    const node = el('div', { class: 'readout ' + (tone || '') }, el('div', { class: 'k' }, k), v);
    bind(() => { v.textContent = get(); });
    return node;
  }

  function basis(...lines) {
    const kids = lines.flat().filter(Boolean).map((t) => el('div', {}, t));
    return kids.length ? el('div', { class: 'basis' }, kids) : null;
  }

  function whyBox(tone, ...kids) {
    return el('div', { class: 'why-box ' + (tone || '') }, kids.flat().filter(Boolean));
  }

  /* ==================================================================== views */

  const VIEWS = {};

  /* ---------------------------------------------------------------- resident */

  VIEWS.resident = {
    tabs: ['Now', 'Needs', 'People', 'Story'],
    header(id) {
      const p = world.residents && world.residents.peopleById.get(id);
      if (!p) return null;
      const chips = [];
      if (p.moodLabel) chips.push(chip(p.moodLabel, moodTone(p.mood)));
      if (!p.onIsland) chips.push(chip('off the island', 'iron'));
      if (p.duty) chips.push(chip(plain(p.duty.kind), 'sun'));
      if (p.newcomer) chips.push(chip('new here', 'heath'));
      if (p.volunteerLabel) chips.push(chip(p.volunteerLabel, 'leaf'));
      return {
        name: p.displayName,
        sub: `${Math.floor(p.age)} years old, ${townshipName(p.townshipId)}`,
        chips
      };
    },
    build(id, tab) {
      const R = world.residents;
      const p = R && R.peopleById.get(id);
      const pop = world.read('population');
      const card = pop && pop.card ? pop.card(id) : null;
      if (!p || !card) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That person is no longer on the roster.'))];
      if (tab === 'Needs') return residentNeeds(p, card);
      if (tab === 'People') return residentPeople(p, card);
      if (tab === 'Story') return residentStory(p, card);
      return residentNow(p, card);
    }
  };

  const moodTone = (m) => (m >= 0.7 ? 'leaf' : m >= 0.46 ? 'sea' : m >= 0.34 ? 'sun' : 'coral');

  function residentNow(p, card) {
    const needs = world.read('needs');
    const out = [];

    // Say it before anything else, on every person, every time.
    //
    // A stranger reading "Wendy Eastwood, 71, sitting and looking at it, Polka Point" reads a person.
    // She is not one. Names come from a curated pool of common Australian names, given names grouped
    // by the decade someone that age would plausibly have been named in, surnames script-checked
    // against every name in data/businesses.json and data/places.json. Ages are invented; the age
    // DISTRIBUTION is the real ABS 2021 Census for this island. See the header of
    // src/systems/agents/population.js for which numbers are published and which are modelled.
    //
    // The reason this is a permanent line and not a one-off note in the introduction: on an island of
    // about two thousand real people, a pool of common Australian surnames will eventually produce a
    // combination that matches a real islander by coincidence, and there is no register to check
    // against, so it cannot be prevented. It can only be disclosed, and disclosure that appears once
    // at the start is not disclosure by the time somebody is three hours in and screenshotting a card.
    out.push(el('div', { class: 'insp-synthetic', title:
      'Generated from data/residents.json name pools. The person is invented. The age distribution, '
      + 'household composition and tenure mix are the published ABS 2021 Census for this island.' },
      'A generated resident. Not a real person, and not based on one. '
      + 'The island’s age and household figures behind them are real.'));

    // What they are doing, live, and why the needs system chose it.
    const doing = el('div', { class: 'lede' });
    bind(() => { doing.textContent = cap(p.actionLabel || 'at home'); });
    const because = el('div', {});
    const gains = el('div', { style: { marginTop: 'var(--sp-2)', display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' } });
    const lowest = el('div', { style: { marginTop: 'var(--sp-2)', color: 'var(--t-dim)' } });
    const method = el('div', { style: { marginTop: 'var(--sp-2)', color: 'var(--t-dim)' } });
    bind(() => {
      because.textContent = p.reason ? cap(p.reason) : 'no reason recorded';
      gains.replaceChildren();
      lowest.textContent = '';
      method.textContent = '';
      const act = needs && needs.describeAction ? needs.describeAction(p.actionId) : null;
      if (!act) return;
      const onDuty = !!(p.currentGains && p.currentGains.hasDuty);
      const levels = needs.levelsOf ? needs.levelsOf(p.id) : null;
      let worstKey = null, worstV = 2;
      for (const [k, v] of Object.entries(act.gains)) {
        if (k === 'islandFatigue') {
          gains.append(chip(v < 0 ? 'eases island fatigue' : 'adds to island fatigue', v < 0 ? 'leaf' : 'coral'));
          continue;
        }
        gains.append(chip((v > 0 ? '+ ' : '− ') + (NEED_LABEL[k] || k).toLowerCase(), v > 0 ? 'leaf' : 'iron'));
        if (v > 0 && levels && levels[k] < worstV) { worstV = levels[k]; worstKey = k; }
      }
      if (onDuty) {
        // An obligation is not a want. Saying "company was lowest" about a rostered shift would be
        // a plausible sentence about the wrong thing, which is the worst kind of wrong.
        lowest.textContent = 'This is an obligation, not a choice. A shift, a school run, a boat, a '
          + 'callout or an appointment outscores everything they might have wanted instead. The chips '
          + 'above are what it does to them while they are on it.';
      } else if (worstKey && worstV < 0.45) {
        lowest.textContent = `Of the needs it fills, ${(NEED_LABEL[worstKey] || worstKey).toLowerCase()} `
          + `was the emptiest when they chose: ${pct(worstV)}, which is ${needWord(worstKey, worstV)}.`;
      } else {
        lowest.textContent = 'Nothing was urgent when they chose. This won on the day rather than on '
          + 'need: the weather, the tide, the hour, who they are and how far it was.';
      }
    });
    out.push(sec('Right now',
      doing,
      whyBox('', el('b', {}, 'Why: '), because, gains, lowest, method),
      basis('The needs system scores everything this person could do here, at this hour, in this '
        + 'weather, at this tide, and commits to the highest. Traits, the walk or drive to get '
        + 'there, and how recently they did it all count against it.')));

    // Where. Live, because a person on a twenty seven kilometre island spends real time getting
    // places, and "at the pub" while still four kilometres from it is a lie a panel should not tell.
    const where = el('dl', { class: 'kv' });
    bind(() => {
      const away = Math.hypot(p.tx - p.x, p.tz - p.z);
      const isl = world.island;
      const kids = [];
      if (away > 120) {
        kids.push(el('dt', {}, 'Heading for'), el('dd', {}, cap(p.locationLabel || 'home')));
        kids.push(el('dt', {}, 'Right now'), el('dd', {},
          `on the way, ${num(away / 1000, 1)} km short${isl ? ', near ' + isl.regionAt(p.x, p.z) : ''}`));
        kids.push(el('dt', {}, 'Getting there'), el('dd', {}, travelWord(p.mode, p.hasVehicle)));
      } else {
        kids.push(el('dt', {}, 'At'), el('dd', {}, cap(p.locationLabel || 'home')));
        if (isl) kids.push(el('dt', {}, 'Which is in'), el('dd', {}, isl.regionAt(p.x, p.z)));
      }
      if (!p.onIsland) kids.push(el('dt', {}, 'On the island'), el('dd', {}, 'no, across the bay'));
      where.replaceChildren(...kids);
    });
    out.push(sec('Where', where));

    if (p.duty) {
      out.push(sec('What the day is asking of them',
        whyBox('warn', el('b', {}, cap(plain(p.duty.kind)) + ': '), p.duty.reason || 'on the roster')));
    }

    // Work.
    const bizId = employerBizId(p);
    out.push(sec('Work', kv([
      ['Occupation', card.job.occupation || 'none recorded'],
      ['Employer', card.job.employer && bizId
        ? pickRow(card.job.employer, 'open the business', { kind: 'business', id: bizId })
        : (card.job.employer || 'not an island employer')],
      ['Pattern', card.job.pattern || p.workLoad],
      ['Hours', p.employed ? p.workLoad : null]
    ])));

    // Home and household.
    const hh = world.residents.householdsById.get(p.householdId);
    if (hh) {
      out.push(sec('Home',
        pickRow(`The ${hh.surname} house`, `${cap(hh.shape)}, ${hh.bedrooms} bedrooms, ${plain(hh.tenure)}`,
          { kind: 'building', id: hh.dwellingId }),
        card.livesWith.length
          ? el('div', { class: 'rows' }, card.livesWith.map((o) => pickRow(o.name, `${Math.floor(o.age)} years old`, { kind: 'resident', id: o.id })))
          : el('div', { class: 'basis' }, 'Lives alone. A third of the households on this island are one person.')));
    }

    out.push(sec('This island', kv([
      ['Here since', `${num(card.yearsOnIsland, 1)} years`],
      ['Township', townshipName(p.townshipId)],
      ['Volunteers', p.volunteerLabel || 'not on a roster']
    ]),
    basis('Names, traits, exactly which house and how long they have been here are modelled from '
      + 'data/residents.json household archetypes. The age structure, the household composition and '
      + 'the tenure split are the published 2021 Census for this island.')));

    return out;
  }

  function travelWord(mode, hasVehicle) {
    switch (mode) {
      case 'drive': return hasVehicle ? 'driving' : 'on the bus or cadging a lift';
      case 'walk': return 'walking';
      case 'bike': return 'on the bike';
      case 'boat': return 'on the water';
      case 'offisland': return 'across the bay';
      case 'commute': return hasVehicle ? 'driving to work' : 'walking to work';
      default: return 'staying put';
    }
  }

  function employerBizId(p) {
    if (!p.employerId) return null;
    return String(p.employerId).replace(/^biz:/, '');
  }

  function residentNeeds(p) {
    const needs = world.read('needs');
    const out = [];

    const meterFor = (key) => meterRow(NEED_LABEL[key], () => {
      const levels = needs && needs.levelsOf ? needs.levelsOf(p.id) : null;
      const v = levels ? levels[key] : 0.5;
      return {
        value: v,
        tone: needClass(key, v),
        word: `${needWord(key, v)} · ${pct(v)}`,
        urgent: key === 'islandFatigue' ? v > 0.62 : v < 0.22
      };
    });
    const meters = NEED_ORDER.slice(0, 8).map(meterFor);
    // Island fatigue is separated rather than listed ninth, because it is the one that reads
    // backwards: a short bar on the other eight is a problem and a short bar on this one is not.
    const split = el('div', { class: 'need-split' }, el('i'), el('span', {}, 'AND THE ONE THAT RUNS THE OTHER WAY'), el('i'));
    out.push(sec('The nine needs', meters, split, meterFor('islandFatigue'),
      basis('Eight of these run from empty at nought to satisfied at one. Island fatigue runs the '
        + 'other way: nought is fine with the place, one is ground down by it. Every rate here is '
        + 'modelled. Nobody has measured how fast an islander gets bored.')));

    // Mood, and where it comes from.
    const mood = el('div', {});
    bind(() => {
      mood.replaceChildren(
        el('b', {}, cap(p.moodLabel || 'settled')),
        el('span', {}, ` at ${pct(p.mood)}. Mood is the weighted average of the eight ordinary `
          + 'needs, less a third of island fatigue. It is the one number that carries the other nine.'));
    });
    out.push(sec('Mood', whyBox('', mood)));

    // Island fatigue, and what is grinding.
    const grind = el('div', {});
    bind(() => {
      const levels = needs && needs.levelsOf ? needs.levelsOf(p.id) : null;
      const f = levels ? levels.islandFatigue : 0;
      const vis = world.read('visitors');
      const prices = world.read('prices');
      const wx = world.read('weather');
      const bits = [];
      if (vis && vis.onIsland) bits.push(`${vis.onIsland.toLocaleString('en-AU')} visitors on the island against 2,069 residents`);
      if (prices && Number.isFinite(prices.freightIndex) && prices.freightIndex > 1.02) bits.push(`freight running at ${prices.freightIndex.toFixed(2)} times the mainland`);
      if (wx && wx.crossingCondition === 'cancelled') bits.push('the boats are not running');
      else if (wx && wx.crossingCondition === 'rough') bits.push('a rough crossing today');
      grind.replaceChildren(
        el('b', {}, `${cap(needWord('islandFatigue', f))} (${pct(f)}). `),
        el('span', {}, bits.length ? `What is grinding right now: ${bits.join(', ')}.`
          : 'Nothing much is grinding today.'),
        el('div', { style: { marginTop: 'var(--sp-2)', color: 'var(--t-dim)' } },
          'A day on the mainland, a night at the club, twenty minutes sitting and looking at it: '
          + 'those are what push it back down. It does not make a person unhappy so much as short.'));
    });
    out.push(sec('Island fatigue', whyBox(needClass('islandFatigue', 0.8) === 'bad' ? 'warn' : '', grind)));

    // Why this person's needs move the way they do.
    out.push(sec('Why theirs move differently', kv([
      ['Age', `${Math.floor(p.age)}, ${p.role}`],
      ['Job strain', `physical ${pct(p.physical || 0)}, stress ${pct(p.stress || 0)}`],
      ['Here since', `${num(p.yearsOnIsland, 1)} years, which is what sets how fast attachment to the place empties`],
      ['Patience', pct(p.traits ? p.traits.patience : 0.5)]
    ]),
    basis('A child under twelve empties hunger forty per cent faster than an adult. A housekeeper on '
      + 'a changeover run loses hygiene faster than a remote knowledge worker. Somebody who has been '
      + 'here thirty years feels the pull of the water harder than somebody who arrived last winter.')));

    // Traits.
    const traitRows = Object.entries(p.traits || {}).map(([k, v]) =>
      meterRow(cap(plain(k)), () => ({ value: v, tone: '', word: pct(v) })));
    out.push(sec('Traits', traitRows,
      basis('Modelled, drawn once at birth or arrival and nudged by age and occupation. Two '
        + 'neighbours with the same needs and different traits do different things with their '
        + 'Saturday, which is the whole point of them.')));

    return out;
  }

  function residentPeople(p, card) {
    const out = [];
    const social = world.read('social');
    const ties = social && social.forAgent ? social.forAgent(p.id, 12) : (card.relationships || []);

    if (card.livesWith.length) {
      out.push(sec('Lives with', card.livesWith.map((o) =>
        pickRow(o.name, `${Math.floor(o.age)} years old`, { kind: 'resident', id: o.id }))));
    }

    if (!ties.length) {
      out.push(sec('Knows', el('div', { class: 'basis' }, 'No recorded ties yet. Ties form where people '
        + 'actually share a place: a household, a street, a workplace, the school gate, a club, a boat.')));
    } else {
      const rows = [];
      for (const t of ties) {
        const last = (t.history || [])[0];
        const lastText = last ? (typeof last === 'string' ? last : last.text) : null;
        rows.push(el('div', {
          class: 'tie', tabindex: '0', role: 'button',
          onclick: () => intent('resident', t.id),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); intent('resident', t.id); } }
        },
        el('div', { class: 'tie-top' }, el('div', { class: 'name' }, t.name), chip(t.kind, tieTone(t.kind))),
        el('div', { class: 'meter ' + (t.trust < -0.05 ? 'bad' : t.familiarity > 0.6 ? 'good' : '') },
          el('i', { style: { width: (Math.max(0, Math.min(1, t.familiarity)) * 100).toFixed(0) + '%' } })),
        el('div', { class: 'tie-facts' }, tieLine(t)),
        lastText ? el('div', { class: 'tie-facts', style: { color: 'var(--t-dim)', marginTop: '2px' } }, lastText) : null));
      }
      out.push(sec(`Knows (${ties.length} closest)`, el('div', {}, rows),
        basis('Familiarity is the bar. Trust, obligation and friction sit underneath it and are what '
          + 'make a favour asked of one person land differently from the same favour asked of another. '
          + 'All of it is modelled: no relationship on this island is a published fact.')));
    }

    return out;
  }

  function tieLine(t) {
    const bits = [];
    bits.push(`familiarity ${pct(t.familiarity)}`);
    bits.push(`trust ${t.trust > 0 ? '+' : ''}${num(t.trust, 2)}`);
    if (Math.abs(t.obligation) > 0.05) bits.push(t.obligation > 0 ? `owes them ${num(t.obligation, 2)}` : `owed ${num(-t.obligation, 2)}`);
    if (t.friction > 0.08) bits.push(`friction ${num(t.friction, 2)}`);
    if (Number.isFinite(t.lastSeenDaysAgo)) bits.push('seen ' + days(t.lastSeenDaysAgo));
    return bits.join(' · ');
  }
  const TIE_TONE = { partner: 'heath', family: 'heath', housemate: 'sea', colleague: 'iron', neighbour: 'leaf', friend: 'leaf', acquaintance: 'iron' };
  const tieTone = (k) => TIE_TONE[k] || 'iron';

  function residentStory(p, card) {
    const out = [];
    const hist = (card.history || []);
    if (hist.length) {
      out.push(sec('What they have done', el('div', {}, hist.map((h) =>
        el('div', { class: 'hist' },
          el('div', { class: 'when' }, agoLabel(world, h.tick)),
          el('div', { class: 'what' }, cap(h.text)))))));
    } else {
      out.push(sec('What they have done', el('div', { class: 'basis' },
        'Nothing worth writing down yet. A history records the days that were different: a good '
        + 'swell, a callout answered, a boat missed, a day taken off the island. Not every meal.')));
    }

    const s = card.stats || {};
    out.push(sec('Tally', el('div', { class: 'stat-row' },
      readout('Shifts', () => String(s.shiftsWorked || 0)),
      readout('Surfs', () => String(s.surfs || 0)),
      readout('Callouts', () => String(s.calloutsAnswered || 0)),
      readout('Boats missed', () => String(s.boatsMissed || 0)),
      readout('Nights away', () => String(s.nightsAway || 0)))));

    const social = world.read('social');
    const mine = social && social.milestonesToday
      ? social.milestonesToday.filter((m) => m.a === p.id || m.b === p.id) : [];
    if (mine.length) {
      out.push(sec('Today', el('div', {}, mine.map((m) => el('div', { class: 'hist' },
        el('div', { class: 'when' }, 'today'), el('div', { class: 'what' }, m.text))))));
    }
    return out;
  }

  /* ---------------------------------------------------------------- business */

  VIEWS.business = {
    tabs: ['Trade', 'Stock', 'Staff', 'About'],
    header(id) {
      const card = bizCard(id);
      const pack = bizPack(id);
      if (!card) return null;
      const chips = [];
      /**
       * The open sign, and the two things that were wrong with it.
       *
       * It used to be stamped once, inside `header()`, which only runs when you select something.
       * A card opened at three in the morning and left open still read SHUT at eleven the next
       * morning while the Trade tab underneath it said "Open. It closes late". Now it is bound and
       * re-reads the card at 10 Hz like everything else on the panel.
       *
       * And it used to be a two-way switch over `card.openNow`, so a null meant SHUT. A null does
       * not mean shut. It means the twin is not entitled to an opinion: nobody published a week, or
       * the thing is not a shopfront. A live SHUT chip over the Minjerribah Moorgumpin
       * Elders-in-Council was this twin describing how an Elders' council runs, which is the one
       * thing it is not allowed to do. Three states now, and the third one says what it is.
       */
      const POSTURE_CHIP = { organisation: 'not a shopfront', 'on-call': 'on call', 'by-timetable': 'runs to a timetable' };
      const openChip = chip('', 'iron');
      bind(() => {
        const c = bizCard(id) || card;
        const gone = c.status === 'closed' || c.status === 'proposed';
        // A shopfront running on a week nobody published still gets its state, because the
        // simulation is running on it and hiding that would be its own kind of dishonesty. It does
        // not get to say it the way a published week says it.
        const modelled = c.hoursBasis !== 'published' && c.hoursBasis !== 'listed';
        const word = gone ? '' : POSTURE_CHIP[c.hoursPosture]
          || (!c.answersOpenShut ? 'hours not published'
            : modelled ? (c.openNow ? 'open, not published' : 'shut, not published')
              : c.openNow ? 'open now' : 'shut');
        openChip.textContent = word;
        openChip.className = 'chip ' + (word === 'open now' ? 'leaf' : 'iron');
        openChip.style.display = word ? '' : 'none';
      });
      chips.push(openChip);
      if (card.status && card.status !== 'trading') chips.push(chip(plain(card.status), 'sun'));
      if (card.viability && card.viability !== 'steady') chips.push(chip(card.viability, card.viability === 'thin' ? 'coral' : 'sun'));
      if (card.winterClosed) chips.push(chip('closed for winter', 'iron'));
      if (card.confidence && card.confidence !== 'high') chips.push(chip(card.confidence + ' confidence', 'iron'));
      // A published or listed set of hours that nobody has looked at for a season says so on the
      // card, in the word rather than in a colour. An estimate gets no freshness chip at all,
      // because there is nothing published underneath it to have gone off.
      //
      // Bound rather than stamped once, unlike the chips above it, and the reason is the clock: a
      // player who presses live moves the moment this age is counted from, and a chip reading
      // "hours ageing" beside a sentence reading "checked today" would be the panel arguing with
      // itself. The chip empties itself when the hours are fresh.
      if (card.hoursBasis === 'published' || card.hoursBasis === 'listed') {
        const ageChip = chip('', 'sun');
        bind(() => {
          // The chip wants the state word rather than the sentence, so it calls the shared
          // function directly. Same module, same limit, same four words as the prose below it.
          const f = freshnessAt(
            { freshness: { synced_at: card.hoursChecked, stale_after_days: STALE_AFTER_DAYS.hours } },
            freshnessMoment(world.clock).iso
          );
          const say = f.state === 'ageing' || f.state === 'stale' ? 'hours ' + f.state : '';
          ageChip.textContent = say;
          ageChip.className = 'chip ' + (f.state === 'stale' ? 'coral' : 'sun');
          ageChip.style.display = say ? '' : 'none';
        });
        chips.push(ageChip);
      }
      const aka = Array.isArray(card.alsoKnownAs) ? card.alsoKnownAs[0] : card.alsoKnownAs;
      return {
        name: card.name,
        sub: `${cap(plain(card.type))}, ${card.township}` + (aka ? ` · known here as ${aka}` : ''),
        chips
      };
    },
    build(id, tab) {
      const card = bizCard(id);
      if (!card) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That business is not in the register.'))];
      if (tab === 'Stock') return bizStock(id);
      if (tab === 'Staff') return bizStaff(id);
      if (tab === 'About') return bizAbout(id);
      return bizTrade(id);
    }
  };

  function bizCard(id) {
    const bs = world.read('businesses');
    return bs && bs.card ? bs.card(id) : null;
  }
  function bizPack(id) {
    const pack = world.data && world.data.businesses && world.data.businesses.businesses;
    return pack ? pack.find((b) => b.id === id) || null : null;
  }

  const DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function bizHours(id) {
    const bs = world.read('businesses');
    return bs && bs.hours ? bs.hours(id) : null;
  }

  /**
   * How old a check is, in words a person reads rather than a date they have to subtract.
   *
   * The age is counted against the clock's declared moment, never against the machine's wall
   * clock, and that is not a detail. This panel used to read `Date.now()`, so an island sitting at
   * 2 October could tell you an hour checked on 10 August was "checked today", because it was
   * answering with the reviewer's calendar rather than the island's. `src/world/freshness.js` owns
   * the arithmetic and the vocabulary, `tools/connectors/lib.mjs` imports the same module, and the
   * moment comes off `world.clock`: the real Queensland moment in live, the declared calendar in
   * simulated, the parked view in scrub. Which one it was goes on screen underneath.
   */
  function checkAge(checked, staleAfterDays) {
    return checkedPhrase(checked, freshnessMoment(world.clock), staleAfterDays || STALE_AFTER_DAYS.hours);
  }

  /** The clause that says what the age was counted against. One sentence, always shown with it. */
  function countedAgainst() {
    return freshnessMoment(world.clock).countedAgainst;
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  /**
   * An ISO date in the words the rest of the card uses: '10 August 2026'.
   *
   * The pack writes its notes in prose and its stamps in ISO, so a card could carry "checked
   * 2026-08-10" in one line and "checked 10 August 2026" in the next, which reads as two different
   * facts. One format wins on screen and it is the readable one; the ISO stays in the data.
   */
  function longDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }

  function bizTrade(id) {
    const out = [];

    /* ---- open, shut, and how sure anybody is ---- */

    const lede = el('div', { class: 'lede' });
    const hoursToday = el('div', {});
    const kitchenLine = el('div', {});
    bind(() => {
      const h = bizHours(id);
      const c = bizCard(id);
      if (!h) {
        lede.textContent = c && c.openNow ? 'Open now.' : 'Shut at the moment.';
        return;
      }
      // Nothing to hang a sign on. An Elders' council, a Traditional Owner corporation, an
      // ambulance station, a hall, a school, a ferry line, or a shop nobody has published a week
      // for. The twin says what it does know and stops there, and the one thing it does not do is
      // fall through to the shut branch below and make something up.
      if (!h.answersOpenShut) {
        lede.textContent = h.postureLine
          || 'Nobody has published hours for this place and nothing has been made up in their place.';
        const said = [];
        if (h.noWeek) said.push('There is no week here to show you.');
        else said.push('What it does publish is below, and it is published rather than worked out.');
        if (h.checked) said.push(`Somebody looked on ${longDate(h.checked)}.`);
        else said.push('Nobody has gone looking yet.');
        hoursToday.textContent = said.join(' ');
        kitchenLine.textContent = '';
        return;
      }
      if (!h.weekIsPublished) {
        // A shopfront the simulation is running on a pattern of its own. The state is real, in the
        // sense that it is what the twin is doing this minute, and it is not a fact about the
        // island. The sentence has to carry both, and the subject of it is the simulation.
        lede.textContent = h.open
          ? 'The simulation has it open. Nobody has published hours for this place.'
          : 'The simulation has it shut. Nobody has published hours for this place.';
      } else if (h.open) {
        lede.textContent = h.closesAt
          ? (h.closeUnpublished ? 'Open. It closes late and the closing time is not published.'
            : `Open until ${h.closesAt}.`)
          : 'Open now.';
      } else {
        lede.textContent = h.nextOpen ? `Shut. Opens again ${h.nextOpen}.` : 'Shut, and nothing published says when it opens again.';
      }
      const dowNow = world.clock.dayOfWeek;
      const row = h.rows[dowNow];
      const bits = h.weekIsPublished ? [`${DOW_LABEL[dowNow]}: ${row ? row.text : 'not recorded'}.`]
        : [`The pattern it is running on today: ${row ? row.text : 'not recorded'}.`];
      if (h.week && h.week !== 'ordinary week') bits.push(`These are its ${h.week} hours.`);
      const m = h.modelled || {};
      if (m.shutReason && !h.open) bits.push(cap(m.shutReason) + '.');
      if (m.hoursCutPct) bits.push(`They are cutting about ${Math.round(m.hoursCutPct)} per cent off the late end to save wages, which is modelled here and is not a published change.`);
      if (m.stretchMin) bits.push(`The simulation is running them ${m.stretchMin} minutes later than the estimate while the island is full. Modelled.`);
      hoursToday.textContent = bits.join(' ');

      if (h.kitchenOpen === null || h.kitchenOpen === undefined) { kitchenLine.textContent = ''; return; }
      const krow = h.rows[dowNow];
      const kwhen = krow && krow.kitchen ? ` The kitchen today: ${krow.kitchen}.` : '';
      kitchenLine.textContent = (h.kitchenOpen
        ? 'Somebody is still in the kitchen.'
        : h.open ? 'The kitchen has shut. The bar is open and you cannot get a meal.' : 'The kitchen is shut with the rest of it.')
        + kwhen + (m.kitchenShort ? ' ' + cap(m.kitchenShort) + '.' : '');
    });
    // "Trading" is the wrong heading over a body that does not trade, in the same small way that
    // "shut" was the wrong chip. The tab keeps its name because it is one name for a hundred
    // records; the heading on the card does not have to.
    out.push(sec((bizHours(id) || {}).posture && bizHours(id).posture !== 'shopfront' ? 'Open or shut' : 'Trading',
      lede, whyBox('', hoursToday), kitchenLine));

    /* ---- where the hours came from, and when anybody last looked ---- */

    const provenance = el('div', {});
    const sourceLine = el('div', {});
    bind(() => {
      const h = bizHours(id);
      if (!h) { provenance.textContent = ''; return; }
      // The week actually in force decides this line, not the base week. A club that publishes its
      // winter hours and then says only that the holidays are "extended" is publishing one and
      // guessing the other, and on a day in the holidays a player is looking at the guess.
      const applied = h.weekBasis || h.basis;
      const age = checkAge(h.checked);
      // "and ageing", "and stale", or nothing at all when it is fresh. The rule in
      // docs/CONNECTORS.md is that a stale record says the word where it is drawn, not that every
      // record announces its own health.
      const standing = age.standing ? ` and ${age.standing}` : '';
      // The clause naming the clock is dropped when the phrase has already named it. "Checked on
      // 2026-08-10, which is later than the moment on screen, counted against the island's own
      // clock" says the same thing twice and reads like a machine.
      const against = age.state === 'unknown' ? '' : `, counted against ${countedAgainst()}`;
      if (applied === 'estimate' && h.basis !== 'estimate') {
        provenance.textContent = `This week is not the published one. The business publishes its ordinary week `
          + `and says only that its hours extend in the holidays, without saying how far, so the ${h.week} hours `
          + `you are looking at are the simulation’s estimate on top of that. `
          + `The published week underneath it was ${age.phrase}${standing}${against}.`;
      } else if (h.basis === 'none') {
        provenance.textContent = 'Nobody has published hours for this place and this pack carries no guess at '
          + 'them either. There is a difference between a guess and a blank, and this is the blank. '
          + (h.checked ? 'Somebody went looking on ' + longDate(h.checked) + ' and found nothing.' : 'Nobody has gone looking yet.');
      } else if (applied === 'estimate') {
        provenance.textContent = 'Nobody has published hours for this place. What you are looking at is the '
          + 'simulation’s own pattern for an island business of this kind, and it is not a claim about when the '
          + 'doors are open. '
          + (h.checked ? 'Somebody went looking on ' + longDate(h.checked) + ' and found nothing.' : 'Nobody has gone looking yet.');
      } else {
        const words = h.basis === 'published'
          ? (h.posture === 'shopfront'
            ? 'These hours are the business’s own, as published on its own page.'
            : 'These hours are the organisation’s own, as published on its own page.')
          : 'These hours were published by somebody else: a council, a tourism body or an island directory. Real and citable, and one step further from the kitchen, so they go stale without anybody being told.';
        provenance.textContent = `${words} ${cap(age.phrase)}${standing}${against}.`;
      }
      sourceLine.textContent = h.source ? h.source : '';
      sourceLine.className = h.source ? 'basis' : '';
    });
    out.push(sec('Who says so', whyBox(null, provenance), sourceLine));

    /* ---- the week, and only when somebody published one ----

    This section used to draw seven rows under a heading reading THE WEEK for every record in the
    pack, including the ninety-odd that nobody has published an hour for. A critic found the
    Pandanus Palms card saying, in as many words, that the hours below were not a claim about when
    the doors were open, and then drawing Sunday to Saturday, 08:30 to 17:00, directly underneath
    it. The label was doing the work the layout was undoing.

    Seven rows in a grid is the shape of a published roster and a reader takes it as one. So a week
    is drawn as a week only when somebody published it. What the simulation is running on is real
    and is not hidden: it is stated in one line, in a sentence with a subject, and the subject is
    the simulation. */

    const weekRows = el('div', {});
    const weekBasis = el('div', { class: 'basis' });
    const hCard = bizHours(id);
    const drawGrid = !!(hCard && hCard.weekIsPublished);
    const weekTitle = !hCard ? 'The week'
      : hCard.noWeek ? 'The week'
        : !drawGrid ? 'What the simulation runs it on'
          : hCard.posture !== 'shopfront' ? 'Office hours, as published'
            : 'The week';
    bind(() => {
      const h = bizHours(id);
      if (!h) return;
      weekRows.textContent = '';
      if (h.noWeek) {
        weekRows.append(el('div', { class: 'basis' },
          'Not published, and not invented. There is no week on this record.'));
      } else if (!drawGrid) {
        weekRows.append(el('div', { class: 'basis' }, h.patternLine
          ? `The simulation runs this one on ${h.patternLine}. That is the twin’s own working `
            + 'pattern for an island business of this kind. It is not a roster, nobody published '
            + 'it, and it is written out here in one line rather than drawn as a week so that it '
            + 'cannot be mistaken for one.'
          : 'Nothing published, and nothing modelled.'));
      } else {
        for (let i = 0; i < 7; i++) {
          const r = h.rows[i];
          const shut = r.text === 'closed' || r.text === 'not published';
          weekRows.append(el('div', { class: 'need' },
            el('div', { class: 'n' }, r.label.slice(0, 3)),
            el('div', { style: { color: shut ? 'var(--t-faint)' : 'var(--t)', fontSize: 'var(--fs-sm)' } },
              r.text + (r.kitchen && r.kitchen !== r.text ? `  (kitchen ${r.kitchen})` : '')),
            el('div', { class: 's' }, r.today ? 'today' : '')));
        }
      }
      const lines = [];
      if (h.note) lines.push(h.note);
      if (h.kitchenHours && h.kitchenHours.note) lines.push('Kitchen: ' + h.kitchenHours.note);
      if (h.variants.length) {
        lines.push('A different week applies when: ' + h.variants.map((v) => `${v.applies.join(' or ')} (${v.basis})`).join(', ') + '.');
      }
      if (h.publicHolidayRule === 'closed') lines.push('Closed public holidays, in the business’s own words.');
      // Only worth saying where there is a published week for a public holiday to depart from.
      // On a record that publishes nothing it is a second sentence saying the same nothing.
      // Only worth saying where there is a published week and something computed off it for a
      // public holiday to change. On a record that publishes nothing, or one the twin never asks
      // about, "the ordinary week is used" describes a calculation that does not happen.
      else if (h.publicHolidayRule === 'unverified' && h.weekIsPublished && h.answersOpenShut) lines.push('Nothing is published about what this place does on a public holiday, so the ordinary week is used and that may be wrong.');
      else if (h.publicHolidayNote) lines.push(h.publicHolidayNote);
      const m = h.modelled || {};
      if (m.exposure) lines.push('Weather, swell and the state of the beach can shut this one, which is modelled here and is published by nobody.');
      weekBasis.textContent = '';
      for (const t of lines) weekBasis.append(el('div', {}, t));
    });
    out.push(sec(weekTitle, weekRows, weekBasis));

    // Money, but only where there is money. This panel used to draw A$0 takings, a 0.0 per cent
    // margin and a meter labelled "can this place keep trading" under the Minjerribah Moorgumpin
    // Elders-in-Council, which is a question about them that does not apply and reads worse than
    // the wrong number would.
    if ((bizCard(id) || {}).trades === false) {
      out.push(sec('Takings', el('div', { class: 'basis' },
        'Nothing. This one has no till in this model: it is here because it is part of how the '
        + 'island works, not because it sells anything.')));
      return out.concat(bizClosingBasis(id));
    }

    out.push(sec('Takings', el('div', { class: 'stat-row' },
      readout('Today, so far', () => A$((bizCard(id) || {}).takingsTodayA$)),
      readout('Rolling year', () => A$((bizCard(id) || {}).takingsYearA$)),
      readout('Margin today', () => num((bizCard(id) || {}).marginPct, 1) + '%',
        ((bizCard(id) || {}).marginPct || 0) < 0 ? 'bad' : ''),
      readout('Cash', () => A$((bizCard(id) || {}).cashA$))),
    basis('A single day’s margin on an island with a four month season swings from deeply negative '
      + 'on a wet Tuesday to comfortable at Christmas. The rolling year is the number that answers '
      + '“can this place keep trading”.')));

    const strain = meterRow('Strain', () => {
      const c = bizCard(id) || {};
      return { value: c.strain || 0, tone: c.strain > 0.6 ? 'bad' : c.strain > 0.35 ? 'warn' : 'good', word: strainWord(c) };
    });
    const service = meterRow('Service', () => {
      const c = bizCard(id) || {};
      return { value: c.serviceLevel ?? 1, tone: (c.serviceLevel ?? 1) < 0.7 ? 'bad' : (c.serviceLevel ?? 1) < 0.9 ? 'warn' : 'good', word: pct(c.serviceLevel ?? 1) };
    });
    out.push(sec('How it is holding up', strain, service, shortOf(id)));

    return out.concat(bizClosingBasis(id));
  }

  /** The line at the foot of the Trade tab that says what on it is real. */
  function bizClosingBasis(id) {
    const closing = el('div', {});
    bind(() => {
      const h = bizHours(id);
      const c = bizCard(id) || {};
      const hoursWord = !h ? ''
        : h.basis === 'none'
          ? ' There are no hours on this card because nobody has published any and none have been made up.'
          : h.basis === 'estimate'
            ? ' The trading hours on this card are not real either: nobody has published any for this place, '
              + 'and what you are reading is the simulation’s own pattern for an island business of this kind.'
            : h.posture !== 'shopfront'
              ? ' The hours are real and the page they came from is named above. They are office hours, not '
                + 'trading hours, and the twin does not work anything out from them.'
              : ' The trading hours are real, and the page they came from is named above.';
      closing.textContent = (c.trades === false
        ? 'Nothing on this card is a trading figure, because there is no trade here to figure. What is real '
          + 'is the organisation, its type and its township, out of data/businesses.json.'
        : 'Every dollar on this card is modelled. No trading figure is published for any business on this '
          + 'island. What is real here is the business, its type, its township and its price band, out of '
          + 'data/businesses.json, which flags the staffing band as an estimate.') + hoursWord;
    });
    return [sec(null, el('div', { class: 'basis' }, closing))];
  }

  function strainWord(c) {
    if (c.viability === 'thin') return 'thin: it is not covering its costs';
    if ((c.strain || 0) > 0.6) return 'under real pressure';
    if ((c.strain || 0) > 0.35) return 'stretched';
    return 'coping';
  }

  function shortOf(id) {
    const box = el('div', {});
    bind(() => {
      const c = bizCard(id) || {};
      const outOf = c.outOf || [];
      box.replaceChildren();
      if (!outOf.length) {
        box.append(el('div', { class: 'basis' }, 'Not short of anything today.'));
        return;
      }
      box.append(whyBox('bad', el('b', {}, 'Short of: '),
        el('span', {}, outOf.map((s) => plain(s)).join(', ')),
        el('div', { style: { marginTop: 'var(--sp-1)', color: 'var(--t-dim)' } },
          'Stock comes over on the barge. A line that runs out stays out until the next run lands.')));
    });
    return box;
  }

  function bizStock(id) {
    const out = [];
    const box = el('div', {});
    bind(() => {
      const c = bizCard(id) || {};
      box.replaceChildren();
      if (!c.stock) {
        box.append(el('div', { class: 'basis' }, 'This one does not carry stock in the model: '
          + 'it sells time, a room or a service rather than a shelf.'));
        return;
      }
      for (const [line, s] of Object.entries(c.stock)) {
        const cover = s.coverDays;
        const tone = cover < 0.5 ? 'bad' : cover < 2 ? 'warn' : 'good';
        box.append(el('div', { class: 'row' },
          el('div', { class: 'lead' },
            el('div', { class: 'name' }, s.label),
            el('div', { class: 'sub' }, coverWord(cover) + (s.onOrder > 0 ? ` · ${num(s.onOrder, 1)} on order` : '')
              + (s.heldAgainstCapacityPct !== null && s.heldAgainstCapacityPct !== undefined ? ` · store ${s.heldAgainstCapacityPct}% full` : ''))),
          // A week of cover fills the bar. Anything past that is comfortable and the exact number
          // is on the line above; what a player needs to see at a glance is the one that is short.
          el('div', { class: 'meter bar ' + tone }, el('i', { style: { width: Math.min(100, (cover / 7) * 100).toFixed(0) + '%' } }))));
      }
    });
    out.push(sec('On the shelf', box,
      basis('Cover days is how long the line lasts at the rate it is currently selling. Everything '
        + 'here crosses on a barge with a deck to share, so the storage limit is as real a '
        + 'constraint as the money.')));
    return out;
  }

  function coverWord(d) {
    if (!Number.isFinite(d)) return 'not stocked';
    if (d <= 0.02) return 'out of it';
    if (d < 0.5) return 'runs out today';
    if (d < 2) return `about ${num(d, 1)} days left`;
    return `${num(d, 1)} days cover`;
  }

  function bizStaff(id) {
    const out = [];
    const c = bizCard(id) || {};
    const s = c.staff || {};
    out.push(sec('Roster', el('div', { class: 'stat-row' },
      readout('On shift now', () => String((bizCard(id) || {}).staff.onShiftNow ?? 0)),
      readout('Positions', () => `${(bizCard(id) || {}).staff.filled}/${(bizCard(id) || {}).staff.needed}`,
        (s.fillRate ?? 1) < 0.9 ? 'warn' : ''),
      readout('On the books', () => `${s.band ? s.band.min : '?'}–${s.band ? s.band.max : '?'}`)),
    basis(s.basis || '')));

    const bs = world.read('businesses');
    const need = bs && bs.staffNeeds ? bs.staffNeeds[id] : null;
    if (need) {
      out.push(sec('Finding people', kv([
        ['Wants', `${need.needed} on the roster`],
        ['On the island', `${need.onIsland} who could do it`],
        ['Peak today', need.peakToday ? 'yes, the day is loaded' : 'no']
      ]),
      basis('Whether a job is filled is a housing question on this island before it is a wages '
        + 'question. Look at the dwellings: half of them had nobody in them on census night.')));
    }

    const jobs = world.read('jobs');
    if (jobs && jobs.hardest) {
      out.push(sec(null, basis('Island-wide, the hardest rosters to fill right now: '
        + (Array.isArray(jobs.hardest) ? jobs.hardest.slice(0, 3).map((h) => h.label || h.business || h).join(', ') : String(jobs.hardest)) + '.')));
    }
    return out;
  }

  function bizAbout(id) {
    const c = bizCard(id) || {};
    const pack = bizPack(id);
    const out = [];
    // The pack's status vocabulary is written for shops, so `trading` is its word for "confirmed
    // to exist and running". Printed unchanged it puts the word Trading over an Elders' council
    // and a rural fire brigade, which is the same category error as the open sign, one size down.
    const status = c.hoursPosture && c.hoursPosture !== 'shopfront' && c.status === 'trading'
      ? 'Operating' : cap(plain(c.status));
    out.push(sec('What it is', kv([
      ['Type', cap(plain(c.type))],
      ['Sector', cap(plain(c.sector))],
      ['Township', c.township],
      ['Price band', c.trades === false ? 'nothing sold in this model' : c.priceBand],
      ['Status', status],
      ['Address', pack ? pack.address : null]
    ])));
    if (c.role) out.push(sec('Role in this island', whyBox('', c.role)));
    if (c.note) out.push(sec('Note', whyBox('', c.note)));
    if (pack && pack.seasonality) {
      out.push(sec('Season', whyBox('', pack.seasonality.pattern || ''),
        basis(`Peak multiplier estimate ${pack.seasonality.peak_multiplier_estimate || 1}× in `
          + (pack.seasonality.peak_periods || []).map(plain).join(', ') + '.')));
    }
    out.push(sec('Source', basis(c.source || 'no source recorded', `Confidence: ${c.confidence}.`)));
    return out;
  }

  /* ---------------------------------------------------------------- building */

  VIEWS.building = {
    tabs(id) {
      const d = dwelling(id);
      return d && d.householdId ? ['House', 'Who lives here'] : ['House'];
    },
    header(id) {
      const R = world.residents;
      const d = dwelling(id);
      if (d) {
        const hh = d.householdId ? R.householdsById.get(d.householdId) : null;
        const chips = [];
        chips.push(chip(USE_CHIP[d.use] || 'house', USE_TONE[d.use] || 'iron'));
        if (d.occupiedByPartyId) chips.push(chip('let this week', 'sun'));
        if (d.vacantReason) chips.push(chip(d.vacantReason, 'iron'));
        if (d.condition && d.condition !== 'sound') chips.push(chip(d.condition, 'sun'));
        return {
          name: hh ? `The ${hh.surname} house` : USE_TITLE[d.use] || 'A house',
          sub: `${d.bedrooms} bedrooms, ${townshipName(d.townshipId)}`,
          chips
        };
      }
      const place = R && R.places.get(id);
      return place ? { name: place.label, sub: townshipName(place.township), chips: [] } : null;
    },
    build(id, tab) {
      const d = dwelling(id);
      if (!d) {
        const place = world.residents && world.residents.places.get(id);
        if (!place) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That building is gone from the register.'))];
        return [sec('Premises', kv([['Name', place.label], ['Kind', cap(plain(place.kind))], ['Township', townshipName(place.township)]]))];
      }
      if (tab === 'Who lives here') return household(d.householdId);
      return buildingHouse(d);
    }
  };

  const USE_CHIP = { resident: 'lived in', 'holiday-home': 'holiday house', weekender: 'weekender', vacant: 'empty' };
  const USE_TONE = { resident: 'leaf', 'holiday-home': 'sun', weekender: 'sun', vacant: 'coral' };
  const USE_TITLE = { 'holiday-home': 'A holiday house', weekender: 'A weekender', vacant: 'An empty house' };

  function dwelling(id) {
    const R = world.residents;
    return R && R.dwellingsById ? R.dwellingsById.get(id) || null : null;
  }

  function buildingHouse(d) {
    const out = [];
    const R = world.residents;
    const pop = world.read('population');
    const hh = d.householdId ? R.householdsById.get(d.householdId) : null;
    const town = pop && pop.byTownship ? pop.byTownship[d.townshipId] : null;

    // The headline fact about housing on this island, said in front of the specific house.
    if (hh) {
      out.push(sec('Who is in it',
        pickRow(`The ${hh.surname} house`, `${cap(hh.shape)} · ${count(hh.members.length, 'person', 'people')} · ${plain(hh.tenure)}`,
          { kind: 'household', id: hh.id })));
    } else if (d.occupiedByPartyId) {
      out.push(sec('Who is in it',
        whyBox('warn', el('b', {}, 'Let out this week. '),
          'A visiting party is in it. It is somebody’s house for six nights and nobody’s for the rest of the year.'),
        pickRow('The party staying here', 'open the visitors', { kind: 'visitor', id: d.occupiedByPartyId })));
    } else if (d.use === 'holiday-home' || d.use === 'weekender') {
      out.push(sec('Who is in it', whyBox('warn',
        el('b', {}, 'Nobody. '),
        d.use === 'weekender' ? 'A weekender. Used a handful of times a year and owned by somebody who lives elsewhere.'
          : 'A holiday house, owned off the island. Empty tonight.')));
    } else {
      out.push(sec('Who is in it', whyBox('bad', el('b', {}, 'Nobody. '),
        d.vacantReason ? cap(d.vacantReason) + '.' : 'Standing empty.')));
    }

    if (town) {
      out.push(sec('The one number that matters here',
        whyBox('', el('b', {}, `${town.unoccupied} of ${townshipName(d.townshipId)}’s ${town.dwellings} dwellings had nobody in them. `),
          `That is ${pct(town.unoccupied / Math.max(1, town.dwellings), 0)} of the houses, against 9.3 per cent for Queensland. `
          + 'It is why the rentals are thin, why the businesses cannot roster, and why the school '
          + 'roll is what it is.'),
        basis('Published: ABS 2021 Census dwelling counts for this island. Which particular house '
          + 'is which is modelled.')));
    }

    out.push(sec('The house', kv([
      ['Bedrooms', String(d.bedrooms)],
      ['Condition', cap(d.condition)],
      ['Use', cap(plain(d.use))],
      ['Township', townshipName(d.townshipId)],
      ['Ground', groundLine(d.x, d.z)]
    ])));

    const housing = world.read('housing');
    if (housing && (d.use === 'holiday-home' || d.use === 'weekender')) {
      out.push(sec('What an empty house is worth', kv([
        ['Short stay, net', A$(housing.shortStay ? housing.shortStay.netPerLetA$ : null) + ' a year'],
        ['Long term, net', A$(housing.shortStay ? housing.shortStay.longTermNetA$ : null) + ' a year'],
        ['Ratio', housing.shortStay ? housing.shortStay.yieldRatio + '×' : '-']
      ]),
      basis('Modelled from the published median rent and modelled nightly rates. While that ratio '
        + 'sits above one, no owner is choosing wrong: the incentive is doing exactly what it is '
        + 'built to do. That is the policy problem, not a moral one.')));
    }

    return out;
  }

  function groundLine(x, z) {
    const isl = world.island;
    if (!isl) return null;
    return `${cap(plain(isl.landCover(x, z)))}, ${Math.round(isl.height(x, z) - isl.seaLevel)} m above the sea`;
  }

  /* ---------------------------------------------------------------- household */

  VIEWS.household = {
    tabs: ['Members', 'Home'],
    header(id) {
      const hh = world.residents && world.residents.householdsById.get(id);
      if (!hh) return null;
      const chips = [chip(plain(hh.tenure), 'iron')];
      if (hh.crowding > 0.2) chips.push(chip('crowded', 'coral'));
      if (hh.vehicles === 0) chips.push(chip('no car', 'sun'));
      return { name: `The ${hh.surname}s`, sub: `${hh.shape}, ${hh.townshipName}`, chips };
    },
    build(id, tab) {
      const hh = world.residents && world.residents.householdsById.get(id);
      if (!hh) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That household has gone.'))];
      if (tab === 'Home') return householdHome(hh);
      return household(id);
    }
  };

  function household(id) {
    const R = world.residents;
    const hh = R && R.householdsById.get(id);
    if (!hh) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No household here.'))];
    const out = [];
    const rows = hh.members.map((m) => {
      const o = R.peopleById.get(m);
      if (!o) return null;
      const doing = el('div', { class: 'sub' });
      bind(() => { doing.textContent = `${Math.floor(o.age)} · ${o.actionLabel}`; });
      return el('div', {
        class: 'row pick', tabindex: '0', role: 'button',
        onclick: () => intent('resident', o.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); intent('resident', o.id); } }
      },
      el('div', { class: 'lead' }, el('div', { class: 'name' }, o.displayName), doing),
      chip(o.moodLabel || '', moodTone(o.mood)));
    }).filter(Boolean);
    out.push(sec('Everyone here', el('div', { class: 'rows' }, rows)));

    out.push(sec('The household', kv([
      ['Shape', cap(hh.shape)],
      ['Tenure', cap(plain(hh.tenure))],
      ['Income', `${A$(hh.incomeWeekly)} a week, ${plain(hh.incomeBand || '')}`],
      ['Vehicles', String(hh.vehicles)],
      ['Here since', `${num(hh.yearsOnIsland, 0)} years`],
      ['Crowding', hh.crowding > 0.01 ? pct(hh.crowding) : 'none']
    ])));

    if (hh.pressures && hh.pressures.length) {
      out.push(sec('What presses on them', el('div', {}, (Array.isArray(hh.pressures) ? hh.pressures : [hh.pressures])
        .map((t) => whyBox('warn', cap(String(t)))))));
    }
    const rhythm = rhythmRows(hh);
    if (rhythm) {
      out.push(sec(world.clock.isWeekend ? 'Their weekend, in the pack' : 'Their weekday, in the pack', rhythm,
        basis('This is the archetype’s written day from data/residents.json. It is not a script: '
          + 'nobody here follows it. The needs system decides what actually happens, and comparing '
          + 'the two is how you see the difference between a plan and a day.')));
    }
    if (hh.seasonalNote) out.push(sec('Their year', whyBox('', hh.seasonalNote)));
    out.push(sec(null, basis('Household archetypes, incomes and pressures are from '
      + 'data/residents.json and are modelled. The composition and tenure splits they are fitted '
      + 'to are the published 2021 Census.')));
    return out;
  }

  /** The archetype's written day, and where the hour hand is on it right now. */
  function rhythmRows(hh) {
    const r = hh.rhythm;
    const list = r && (world.clock.isWeekend ? r.weekend : r.weekday);
    if (!Array.isArray(list) || !list.length) return null;
    const mins = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
    const now = world.clock.minuteOfDay;
    return el('div', {}, list.map((b) => {
      const from = mins(b.from), to = mins(b.to);
      const on = to > from ? (now >= from && now < to) : (now >= from || now < to);
      return el('div', { class: 'row' + (on ? ' on' : '') },
        el('div', { class: 'lead' },
          el('div', { class: 'name' }, b.do),
          b.where && b.where !== 'home' ? el('div', { class: 'sub' }, plain(b.where)) : null),
        el('div', { class: 'num' }, `${b.from}–${b.to}`));
    }));
  }

  function householdHome(hh) {
    const d = world.residents.dwellingsById.get(hh.dwellingId);
    if (!d) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No dwelling recorded.'))];
    return buildingHouse(d);
  }

  /* ---------------------------------------------------------------- visitor */

  VIEWS.visitor = {
    tabs: ['Party'],
    header(id) {
      const c = world.store.get(id, 'visitor');
      const s = sampleParty(id);
      if (!c && !s) return null;
      const label = s ? s.label : cap(plain(c.archetype));
      return {
        name: label,
        sub: `a visiting party of ${s ? s.size : c.size}`,
        chips: [chip('visitor', 'sun')]
      };
    },
    build(id) {
      const c = world.store.get(id, 'visitor');
      const s = sampleParty(id);
      if (!c && !s) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That party has gone home.'))];
      const out = [];
      const dwell = findLetDwelling(id);
      out.push(sec('Right now', el('div', { class: 'lede' }, cap(s ? s.doing : 'on the island')),
        kv([
          ['Staying', s ? s.staying : (dwell ? 'a holiday house' : 'not recorded')],
          ['At', s ? s.at : null],
          ['Nights booked', s ? String(s.nights) : null],
          ['Leaves', s ? s.leaves : null]
        ]),
        dwell ? pickRow('The house they are in', 'open the dwelling', { kind: 'building', id: dwell.id }) : null));

      const tour = world.read('tourism');
      const arch = (c && c.archetype) || (s && s.archetype);
      const a = tour && tour.byArchetype ? tour.byArchetype[arch] : null;
      if (a) {
        out.push(sec('What this kind of visitor is worth', el('div', { class: 'stat-row' },
          readout('Spend a day', () => A$(a.perPersonPerDayA$)),
          readout('Captured here', () => pct(a.captureRate)),
          readout('On the island', () => String(a.people))),
        basis('Capture rate is the share of their spend that lands with an island business rather '
          + 'than with the ferry, the fuel card or a mainland supermarket. It is modelled: no study '
          + 'of visitor spend capture on this island was found.')));
      }
      const pub = world.read('tourism');
      if (pub && pub.publicCost) {
        out.push(sec('What they cost the island', el('div', { class: 'stat-row' },
          readout('Toilets', () => A$(pub.publicCost.toiletsA$)),
          readout('Waste', () => A$(pub.publicCost.wasteA$)),
          readout('Per day visitor', () => A$(pub.publicCost.perDayVisitorA$))),
        basis('Today’s island-wide public cost of visitors, modelled.')));
      }
      out.push(sec(null, basis('Visiting parties are modelled groups drawn from the archetypes in '
        + 'data/residents.json. They are not named people and nothing here is about a real visitor.')));
      return out;
    }
  };

  function sampleParty(id) {
    const v = world.read('visitors');
    return v && v.sample ? v.sample.find((p) => p.id === id) || null : null;
  }
  function findLetDwelling(id) {
    const R = world.residents;
    if (!R) return null;
    for (const d of R.dwellings) if (d.occupiedByPartyId === id) return d;
    return null;
  }

  /* ---------------------------------------------------------------- koala */

  VIEWS.koala = {
    tabs: ['Animal', 'Pressures'],
    header(id) {
      const k = world.store.get(id, 'koala');
      if (!k) return null;
      const ko = world.read('koala');
      const chips = [];
      if (ko && ko.status) chips.push(chip(ko.status.epbc + ' (EPBC)', 'coral'));
      if (k.infection === 2) chips.push(chip('clinical signs', 'coral'));
      else if (k.infection === 1) chips.push(chip('carrying chlamydia', 'sun'));
      if (k.joey >= 0) chips.push(chip(k.joey < 190 ? 'joey in pouch' : 'joey on her back', 'leaf'));
      if (k.dispDays > 0) chips.push(chip('dispersing', 'heath'));
      return {
        name: 'Koala',
        sub: `${k.sex === 'm' ? 'male' : 'female'}, ${(k.age / 365).toFixed(1)} years old`,
        chips
      };
    },
    build(id, tab) {
      const k = world.store.get(id, 'koala');
      if (!k) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That animal is no longer in the population.'))];
      return tab === 'Pressures' ? koalaPressures(k) : koalaAnimal(k, id);
    }
  };

  function koalaAnimal(k, id) {
    const out = [];
    const isl = world.island;
    const doing = el('div', { class: 'lede' });
    bind(() => {
      const live2 = world.store.get(id, 'koala') || k;
      doing.textContent = live2.dispDays > 0 ? 'Dispersing: looking for a range of its own.'
        : live2.moving ? 'On the move between feed trees.'
          : live2.onGround ? 'On the ground, which is when a koala is at risk.'
            : 'Up a tree.';
    });
    out.push(sec('Right now', doing));

    const cond = meterRow('Condition', () => {
      const l = world.store.get(id, 'koala') || k;
      return { value: l.cond, tone: l.cond < 0.45 ? 'bad' : l.cond < 0.6 ? 'warn' : 'good', word: condWord(l.cond) };
    });
    out.push(sec('The animal', cond, kv([
      ['Sex', k.sex === 'm' ? 'male' : 'female'],
      ['Age', `${(k.age / 365).toFixed(1)} years`],
      ['Home range', `${num(Math.PI * k.rangeM * k.rangeM / 10000, 1)} ha, about ${Math.round(k.rangeM)} m across`],
      ['Health', k.infection === 2 ? 'clinical chlamydiosis' : k.infection === 1 ? 'carrying chlamydia, no signs' : 'no signs'],
      ['Where', isl ? isl.regionAt(k.x, k.z) : null]
    ]),
    basis('A poorer patch means a bigger range: the animal has to walk further between feed trees, '
      + 'and walking is when a koala meets a car or a dog.')));

    const veg = world.read('vegetation');
    if (veg && veg.foodTreeAt) {
      const food = veg.foodTreeAt(k.x, k.z);
      out.push(sec('Its patch', meterRow('Food trees', () => ({ value: food, tone: food < 0.35 ? 'bad' : food < 0.55 ? 'warn' : 'good', word: pct(food) })),
        meterRow('Hollows', () => {
          const h = veg.hollowAt(k.x, k.z);
          return { value: h, tone: h < 0.15 ? 'warn' : 'good', word: pct(h) };
        }),
        basis('Food tree density here against the best on the island. It is what sets the home range '
          + 'and, in aggregate, the island’s carrying capacity.')));
    }

    const rescue = (world.read('koala') || {}).rescue;
    if (rescue) {
      out.push(sec('If you find one in trouble',
        whyBox('warn', el('b', {}, rescue.publicRule || 'Watch, keep back, call.'),
          el('div', { style: { marginTop: 'var(--sp-1)' } }, `${rescue.service}: ${rescue.number}`)),
        basis(rescue.source || '')));
    }
    return out;
  }

  const condWord = (c) => (c < 0.4 ? 'poor' : c < 0.55 ? 'thin' : c < 0.72 ? 'fair' : 'good');

  function koalaPressures(k) {
    const ko = world.read('koala') || {};
    const out = [];
    const bits = [];
    if (ko.disease) bits.push(`${pct(ko.disease.prevalence)} of the island’s koalas are carrying chlamydia and ${ko.disease.clinical} have clinical signs`);
    if (ko.roadCrossings365) bits.push(`${ko.roadCrossings365} road crossings in the last year across the population`);
    if (ko.heatStress > 0.05) bits.push(`heat stress at ${pct(ko.heatStress)} right now`);
    out.push(sec('What is pressing on it', whyBox('warn', bits.length ? bits.join('. ') + '.' : 'Nothing acute today.')));

    out.push(sec('The population it belongs to', el('div', { class: 'stat-row' },
      readout('Koalas', () => String((world.read('koala') || {}).population || 0)),
      readout('Capacity', () => String(ko.carryingCapacity || 0)),
      readout('Occupancy', () => pct((world.read('koala') || {}).occupancy || 0)),
      readout('Births, year', () => String(ko.births365 || 0))),
    basis(ko.populationBasis || '')));

    if (ko.calibration) {
      const c = ko.calibration;
      out.push(sec('Against the island’s own record', kv([
        ['Published', `${c.published.vehicle} vehicle, ${c.published.disease} disease, ${c.published.dog} dog, ${c.published.period}`],
        ['This model', `${c.modelledOverSamePeriod.vehicle} vehicle, ${c.modelledOverSamePeriod.disease} disease, ${c.modelledOverSamePeriod.dog} dog`]
      ]), basis(c.note)));
    }

    if (ko.levers) {
      const rows = Object.entries(ko.levers).map(([k2, v]) => el('div', { class: 'need' },
        el('div', { class: 'n' }, cap(plain(k2))),
        el('div', { class: 'meter ' + (v > 0.6 ? 'good' : v > 0.2 ? 'warn' : 'bad') }, el('i', { style: { width: (v * 100) + '%' } })),
        el('div', { class: 's' }, v > 0 ? pct(v) : 'off')));
      out.push(sec('Levers that touch it', rows,
        basis('These are real policy levers from data/civic.json. Off means nobody has pulled it.')));
    }
    return out;
  }

  /* ---------------------------------------------------------------- whale */

  VIEWS.whale = {
    tabs: ['Pod'],
    header(id) {
      const pod = whalePod(id);
      if (!pod) return null;
      const chips = [chip(pod.behaviour || 'travelling', 'sea')];
      if (pod.calf) chips.push(chip('with a calf', 'leaf'));
      if (pod.entangled) chips.push(chip('entangled', 'coral'));
      return { name: 'Humpback pod', sub: `${pod.size} ${pod.size === 1 ? 'whale' : 'whales'}, ${num(pod.offshoreKm, 1)} km offshore`, chips };
    },
    build(id) {
      const pod = whalePod(id);
      const wh = world.read('whales') || {};
      if (!pod) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That pod has moved on.'))];
      const out = [];
      out.push(sec('The pod', kv([
        ['Size', `${pod.size}${pod.calf ? ', including a calf' : ''}${pod.escorts ? `, ${pod.escorts} escorts` : ''}`],
        ['Doing', cap(pod.behaviour)],
        ['Heading', pod.heading],
        ['Offshore', `${num(pod.offshoreKm, 1)} km`],
        ['Speed', `${num(pod.speedKmh, 1)} km/h`],
        ['Visible from land', pod.visible ? 'yes' : 'not right now']
      ])));
      out.push(sec('The migration', whyBox('', cap(wh.season || '')),
        kv([
          ['Passed north', String(wh.passedNorthThisSeason || 0)],
          ['Passed south', String(wh.passedSouthThisSeason || 0)],
          ['Calves this season', String(wh.calvesThisSeason || 0)],
          ['Best viewpoint', wh.bestViewpoint]
        ]),
        basis(wh.population ? wh.population.basis : '')));
      if (wh.lastSighting) {
        out.push(sec('Last sighting from land', whyBox('',
          `${wh.lastSighting.what}, ${num(wh.lastSighting.distanceKm, 1)} km off ${wh.lastSighting.from}, `
          + `${wh.lastSighting.time} on ${wh.lastSighting.day}.`)));
      }
      return out;
    }
  };
  function whalePod(id) {
    const wh = world.read('whales');
    return wh && wh.pods ? wh.pods.find((p) => p.id === id) || null : null;
  }

  /* ---------------------------------------------------------------- roost */

  VIEWS.roost = {
    tabs: ['Roost'],
    header(id) {
      const r = roost(id);
      if (!r) return null;
      return { name: r.label, sub: 'shorebird roost', chips: [chip(`${Math.round(r.birds)} birds`, 'sea')] };
    },
    build(id) {
      const r = roost(id);
      const sb = world.read('shorebirds') || {};
      if (!r) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No roost here.'))];
      const out = [];
      out.push(sec('The roost', kv([
        ['Birds', String(Math.round(r.birds))],
        ['Openness', pct(r.openness)],
        ['Disturbance now', pct(r.pressureNow)],
        ['Worst source', r.worstSource ? plain(r.worstSource) : 'nothing today'],
        ['Flushes, year', String(Math.round(r.flushes365))]
      ])));
      out.push(sec('What a flush costs', whyBox('warn',
        `Across the island the flocks have lost about ${num(sb.fuelLostToDisturbanceDays, 0)} bird-days of `
        + 'fuel to disturbance this year. A bird that cannot put on fat does not make the flight.'),
      basis(sb.flyway ? `${sb.flyway.basis} Source: ${sb.flyway.source}` : '')));
      if (sb.droneExclusionM) {
        out.push(sec('Rules here', basis(`Drone exclusion modelled at ${sb.droneExclusionM} m from a roost.`)));
      }
      return out;
    }
  };
  function roost(id) {
    const sb = world.read('shorebirds');
    return sb && sb.roosts ? sb.roosts.find((r) => r.id === id) || null : null;
  }

  /* ---------------------------------------------------------------- road */

  /** The road classes in data/geography.json, said the way an islander would say them. */
  const ROAD_CLASS = {
    spine: 'the island spine', sealed: 'sealed road', gravel: 'gravel road', street: 'street',
    sandtrack: 'sand track', walk: 'walking track', beachaccess: 'beach access track',
    beachroute: 'beach route: a gazetted road made of sand'
  };

  VIEWS.road = {
    tabs: ['Road'],
    header(id) {
      const e = roadEdge(id);
      if (!e) return null;
      const chips = [chip(e.open ? 'open' : 'closed', e.open ? 'leaf' : 'coral')];
      if (e.fourWdOnly) chips.push(chip('4WD only', 'sun'));
      if (e.permitRequired) chips.push(chip('permit', 'sun'));
      if (e.tideDependent) chips.push(chip('tide dependent', 'sea'));
      return { name: e.name, sub: `${cap(ROAD_CLASS[e.cls] || plain(e.cls))} · ${(e.lengthM / 1000).toFixed(2)} km`, chips };
    },
    build(id) {
      const e = roadEdge(id);
      const net = world.read('roadNetwork') || {};
      if (!e) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No road segment here.'))];
      const out = [];
      out.push(sec('This segment', kv([
        ['Surface', cap(e.surface)],
        ['Sealed', e.sealed ? 'yes' : 'no'],
        ['Width', `${num(e.widthM, 1)} m, ${e.lanes} lanes`],
        ['Speed', `${e.speedKmh} km/h`],
        ['Length', `${(e.lengthM / 1000).toFixed(2)} km`],
        ['Township', e.township ? townshipName(e.township) : 'between the towns']
      ]),
      basis(el('b', {}, 'Speed: '), e.speedBasis + ` (confidence ${e.speedConfidence}).`)));

      if (e.note) out.push(sec('What it is for', whyBox('', e.note)));

      if (e.tideDependent) {
        const tideBox = el('div', {});
        bind(() => {
          const open = net.beachOpen;
          const mins = net.beachNextChangeMin;
          tideBox.replaceChildren(
            el('b', {}, open ? 'Open now. ' : 'Closed now. '),
            el('span', {}, Number.isFinite(mins) ? `${open ? 'Closes' : 'Opens'} in about ${mins} minutes.` : ''),
            el('div', { style: { marginTop: 'var(--sp-1)', color: 'var(--t-dim)' } }, net.beachRule || ''));
        });
        out.push(sec('The tide decides', whyBox(net.beachOpen ? '' : 'warn', tideBox)));
      }

      const nav = world.read('navigation');
      if (nav && nav.beachRule && e.tideDependent) {
        out.push(sec(null, basis(el('b', {}, 'Which window applies: '), nav.beachRule.resolution || '')));
      }

      out.push(sec('The network it belongs to', el('div', { class: 'stat-row' },
        readout('Driveable', () => `${num(net.driveableKm, 0)} km`),
        readout('On sand', () => `${num((net.lengthKm && (net.lengthKm.beachroute || 0) + (net.lengthKm.sandtrack || 0)) || 0, 0)} km`),
        readout('Walking only', () => `${num(net.walkingKm, 0)} km`)),
      basis('More than half of this island’s road network is sand.')));

      out.push(sec('Source', basis(e.source || '')));
      return out;
    }
  };
  function roadEdge(id) {
    const net = world.read('roadNetwork');
    return net && net.edges ? net.edges.find((e) => e.id === id) || null : null;
  }

  /* ---------------------------------------------------------------- lake */

  VIEWS.lake = {
    tabs: ['Lake', 'Life'],
    header(id) {
      const b = lakeBody(id);
      const isl = world.island && world.island.lakes.find((l) => l.id === id);
      if (!b && !isl) return null;
      const name = b ? b.name : isl.name;
      const chips = [];
      if (b) chips.push(chip(b.typeLabel, 'sea'));
      if (b && b.dry) chips.push(chip('dry', 'coral'));
      return { name, sub: b ? `${num(b.areaHa, 0)} ha` : 'lake', chips };
    },
    build(id, tab) {
      const b = lakeBody(id);
      if (!b) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No lake record.'))];
      return tab === 'Life' ? lakeLife(b) : lakeMain(b);
    }
  };
  function lakeBody(id) {
    const lk = world.read('lakes');
    return lk && lk.bodies ? lk.bodies.find((b) => b.id === id) || null : null;
  }

  function lakeMain(b) {
    const lk = world.read('lakes') || {};
    const out = [];
    out.push(sec('What kind of lake', whyBox('', b.note || ''),
      kv([
        ['Type', b.typeLabel],
        ['Area', `${num(b.areaHa, 1)} ha`],
        ['Surface', b.surfaceM !== null ? `${num(b.surfaceM, 1)} m above the sea` : 'no published level'],
        ['Max depth', b.maxDepthM ? `${num(b.maxDepthM, 1)} m` : 'not published'],
        ['Water', `pH ${num(b.ph, 1)}, ${b.colour}`],
        ['Level now', `${b.levelM > 0 ? '+' : ''}${num(b.levelM, 2)} m against its normal`]
      ]),
      basis(b.surfaceSource === 'published' ? 'Water level published in data/geography.json.'
        : 'No published water level for this one, so none is invented.')));

    const water = meterRow('Water table', () => ({
      value: lk.waterTableIndex || 0,
      tone: (lk.waterTableIndex || 0) < 0.3 ? 'bad' : (lk.waterTableIndex || 0) < 0.45 ? 'warn' : 'good',
      word: `${num(lk.waterTableM, 2)} m against the long run`
    }));
    out.push(sec('The aquifer under it', water, kv([
      ['Storage', `${num(lk.storageGl, 0)} GL`],
      ['Recharge', `${num(lk.rechargeMlDay, 0)} ML a day`],
      ['Extraction', `${num(lk.extractionMlDay, 1)} ML a day`],
      ['Stress', pct(lk.aquiferStress || 0)]
    ]),
    basis('These lakes sit on the water table, not on runoff. What comes out of the borefield and '
      + 'what falls as rain is what sets their level. Extraction figures are from secondary '
      + 'reporting and are flagged in the pack as such.')));

    if (b.visitorsToday) {
      out.push(sec('People on it today', el('div', { class: 'stat-row' },
        readout('Visitors', () => String(Math.round(lakeBody(b.id).visitorsToday))),
        readout('Reed condition', () => pct(lakeBody(b.id).reedCondition))),
      basis('Trampling at the edge is what a lake here loses first.')));
    }
    return out;
  }

  function lakeLife(b) {
    const lk = world.read('lakes') || {};
    const out = [];
    const frogs = lk.frogs || [];
    if (frogs.length) {
      out.push(sec('Acid frogs', frogs.map((f) => meterRow(f.name.replace(' (North Stradbroke Island population)', ''),
        () => ({ value: f.index, tone: f.index < 0.35 ? 'bad' : f.index < 0.6 ? 'warn' : 'good', word: f.limitedBy ? `limited by ${plain(f.limitedBy)}` : pct(f.index) }))),
      basis('These frogs need water more acid than most things can stand, which is exactly what a '
        + 'wallum wetland gives them. Anything that sweetens the water takes them out.')));
    }
    out.push(sec('The wetland', kv([
      ['Acid wetland now', `${num(lk.acidWetlandHa, 0)} ha`],
      ['Baseline', `${num(lk.acidWetlandBaselineHa, 0)} ha`],
      ['Eighteen Mile Swamp', lk.swamp ? `${num(lk.swamp.wetHa, 0)} of ${num(lk.swamp.areaHa, 0)} ha wet` : null]
    ]), basis(lk.swamp ? lk.swamp.note : '')));
    return out;
  }

  /* ---------------------------------------------------------------- dune */

  VIEWS.dune = {
    tabs: ['Beach', 'Pressures'],
    header(id) {
      const r = duneReach(id);
      if (!r) return null;
      const chips = [chip(r.exposure > 0.5 ? 'ocean facing' : r.exposure > 0.2 ? 'part exposed' : 'bay side',
        r.exposure > 0.5 ? 'sea' : 'iron')];
      if (r.condition < 0.7) chips.push(chip('under stress', 'coral'));
      return { name: r.label, sub: `beach and dune reach, ${num(r.lengthM / 1000, 2)} km`, chips };
    },
    build(id, tab) {
      const r = duneReach(id);
      if (!r) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No reach here.'))];
      return tab === 'Pressures' ? dunePressures(r) : duneMain(r);
    }
  };
  function duneReach(id) {
    const dn = world.read('dunes');
    return dn && dn.reaches ? dn.reaches.find((r) => r.id === id) || null : null;
  }

  function duneMain(r) {
    const dn = world.read('dunes') || {};
    const out = [];
    const cond = meterRow('Condition', () => {
      const l = duneReach(r.id) || r;
      return { value: l.condition, tone: l.condition < 0.6 ? 'bad' : l.condition < 0.78 ? 'warn' : 'good', word: pct(l.condition) };
    });
    const veg = meterRow('Dune plants', () => {
      const l = duneReach(r.id) || r;
      return { value: l.vegetationCover, tone: l.vegetationCover < 0.5 ? 'bad' : l.vegetationCover < 0.7 ? 'warn' : 'good', word: pct(l.vegetationCover) };
    });
    out.push(sec('The reach', cond, veg, kv([
      ['Length', `${num(r.lengthM / 1000, 2)} km`],
      ['Sand budget', `${num(r.sandM3PerM, 0)} m³ per metre of beach`],
      ['Shoreline', `${r.shorelineM > 0 ? '+' : ''}${num(r.shorelineM, 1)} m this year`],
      ['Blowouts', r.blowouts ? `${r.blowouts}, widest ${num(r.widestBlowoutM, 0)} m` : 'none']
    ]),
    basis('Sand budget is what stands between a storm and the houses behind. A dune with plants on '
      + 'it holds. A dune walked across in the same place every day does not.')));

    if (/amity/.test(r.id) && dn.amity) {
      out.push(sec('Amity Point', whyBox('warn', dn.amity.status),
        kv([
          ['Channel', `${num(dn.amity.channelDistanceM, 0)} m offshore, moving in about ${num(dn.amity.channelMigrationMPerYear, 1)} m a year`],
          ['Properties in the strip', String(dn.amity.propertiesInStrip)],
          ['Risk index', pct(dn.amity.riskIndex)],
          ['Works', dn.amity.worksNote]
        ]),
        basis(dn.amity.channelMigrationConfidence, dn.amity.propertiesBasis)));
      if (dn.amityReference) {
        out.push(sec('The reference event', whyBox('', `${dn.amityReference.description} (${dn.amityReference.date})`),
          basis(`Confidence ${dn.amityReference.confidence}. ${dn.amityReference.source}`)));
      }
    }
    return out;
  }

  function dunePressures(r) {
    const dn = world.read('dunes') || {};
    const out = [];
    out.push(sec('On it today', el('div', { class: 'stat-row' },
      readout('On foot', () => String(Math.round((duneReach(r.id) || r).pedestriansToday))),
      readout('Vehicles', () => String(Math.round((duneReach(r.id) || r).vehiclesToday))))));
    out.push(sec('The island’s dunes', el('div', { class: 'stat-row' },
      readout('Ocean side', () => pct(dn.oceanCondition)),
      readout('Bay side', () => pct(dn.bayCondition)),
      readout('Worst reach', () => dn.worstReach ? dn.worstReach.label : '-'))));
    if (dn.levers) {
      const rows = Object.entries(dn.levers).map(([k, v]) => el('div', { class: 'need' },
        el('div', { class: 'n' }, cap(plain(k))),
        el('div', { class: 'meter ' + (v > 0.6 ? 'good' : v > 0.2 ? 'warn' : 'bad') }, el('i', { style: { width: (v * 100) + '%' } })),
        el('div', { class: 's' }, v > 0 ? pct(v) : 'off')));
      out.push(sec('Levers that touch this coast', rows));
    }
    return out;
  }

  /* ---------------------------------------------------------------- terrain cell */

  VIEWS.cell = {
    tabs: ['Ground', 'Life'],
    header(id) {
      const p = cellPos(id);
      const isl = world.island;
      if (!p || !isl) return null;
      return {
        name: isl.regionAt(p.x, p.z),
        sub: `${cap(plain(isl.landCover(p.x, p.z)))} · ${Math.round(isl.height(p.x, p.z) - isl.seaLevel)} m above the sea`,
        chips: [chip(`${isl.grid.cell} m cell`, 'iron')]
      };
    },
    build(id, tab) {
      const p = cellPos(id);
      if (!p || !world.island) return [el('div', { class: 'insp-empty' }, el('p', {}, 'No ground here.'))];
      return tab === 'Life' ? cellLife(p) : cellGround(p);
    }
  };
  function cellPos(id) {
    const [, x, z] = String(id).split(':');
    return Number.isFinite(Number(x)) ? { x: Number(x), z: Number(z) } : null;
  }

  function cellGround(p) {
    const isl = world.island;
    const out = [];
    const ll = isl.unproject(p.x, p.z);
    out.push(sec('This ground', kv([
      ['Region', isl.regionAt(p.x, p.z)],
      ['Cover', cap(plain(isl.landCover(p.x, p.z)))],
      ['Elevation', `${num(isl.height(p.x, p.z) - isl.seaLevel, 1)} m above mean sea level`],
      ['Slope', `${num((isl.slope(p.x, p.z) * 180) / Math.PI, 1)} degrees`],
      ['To the coast', `${num(isl.shoreDistance(p.x, p.z), 0)} m`],
      ['Side of the island', isl.bayness(p.x, p.z) > 0.5 ? 'Moreton Bay side' : 'ocean side'],
      ['Coordinates', `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`]
    ]),
    basis('Elevation comes from the heightfield built from data/geography.json elevation points and '
      + 'contours, on a 32 metre grid. The datum is metres above lowest astronomical tide; mean sea '
      + 'level sits at 1.02 m on it.')));

    const tide = world.read('tide');
    if (tide && isl.height(p.x, p.z) < isl.seaLevel + 2.2) {
      out.push(sec('The tide here', whyBox('',
        `${cap(tide.phase)}, ${num(tide.height, 2)} m now. `
        + (tide.next && tide.next[0] ? `Next ${tide.next[0].kind} in ${num(tide.next[0].inHours, 1)} hours at ${num(tide.next[0].height, 2)} m.` : ''))));
    }
    return out;
  }

  function cellLife(p) {
    const veg = world.read('vegetation');
    const out = [];
    if (!veg || !veg.communityAt) {
      return [sec('Life', el('div', { class: 'basis' }, 'The vegetation system is not loaded.'))];
    }
    const comId = veg.communityAt(p.x, p.z);
    const com = (veg.communities || []).find((c) => c.id === comId);
    if (com) {
      out.push(sec('What grows here', el('div', { class: 'lede' }, com.label),
        com.note ? whyBox('', com.note) : null,
        basis(`Around ${num(com.areaHa, 0)} ha of this community on the island, condition ${pct(com.condition)}.`)));
    }
    out.push(sec('This patch',
      meterRow('Integrity', () => { const v = veg.integrityAt(p.x, p.z); return { value: v, tone: v < 0.5 ? 'bad' : v < 0.75 ? 'warn' : 'good', word: pct(v) }; }),
      meterRow('Food trees', () => { const v = veg.foodTreeAt(p.x, p.z); return { value: v, tone: '', word: pct(v) }; }),
      meterRow('Hollows', () => { const v = veg.hollowAt(p.x, p.z); return { value: v, tone: '', word: pct(v) }; }),
      meterRow('Weeds', () => { const v = veg.weedAt(p.x, p.z); return { value: v, tone: v > 0.3 ? 'bad' : v > 0.12 ? 'warn' : 'good', word: pct(v) }; }),
      meterRow('Moisture', () => { const v = veg.moistureAt(p.x, p.z); return { value: v, tone: '', word: pct(v) }; })));

    const tsf = veg.timeSinceFireYAt(p.x, p.z);
    const fuel = veg.fuelAt(p.x, p.z);
    out.push(sec('Fire', kv([
      ['Last burnt', `${num(tsf, 1)} years ago`],
      ['Fuel', `${num(fuel, 1)} tonnes a hectare`],
      ['Curing', pct(veg.curing)],
      ['Danger today', veg.fireDangerLabel || (world.read('weather') || {}).fireDangerLabel]
    ]),
    whyBox(tsf > 15 ? 'warn' : '', veg.burnProgramme ? veg.burnProgramme.verdict : ''),
    basis('Wallum wants fire on an interval of years, not decades, and it wants patches left '
      + 'unburnt for the things that cannot outrun it.')));
    return out;
  }

  /* ---------------------------------------------------------------- vehicle */

  VIEWS.vehicle = {
    tabs: ['Vehicle'],
    header(id) {
      const v = vehicle(id);
      if (!v) return null;
      return { name: v.label || cap(plain(v.kind || 'vehicle')), sub: v.doing || v.mode || 'on the road', chips: [] };
    },
    build(id) {
      const v = vehicle(id);
      if (!v) return [el('div', { class: 'insp-empty' }, el('p', {}, 'That vehicle is gone.'))];
      const pairs = [];
      for (const [k, val] of Object.entries(v)) {
        if (k === 'x' || k === 'z' || k === 'y' || typeof val === 'object' || typeof val === 'function') continue;
        pairs.push([cap(plain(k)), String(val)]);
      }
      return [sec('Vehicle', kv(pairs)),
        sec(null, basis('No traffic system is loaded yet, so this is whatever the vehicle record '
          + 'carries. When one lands, this becomes who is in it and where they are going.'))];
    }
  };
  function vehicle(id) {
    const t = world.read('traffic') || world.read('vehicles');
    const list = t && (t.vehicles || t.list || t.active);
    return Array.isArray(list) ? list.find((v) => v.id === id) || null : null;
  }

  /* ==================================================================== empty state */

  /**
   * Nothing selected is not nothing to read. A blank panel would be the worst possible first
   * impression of the deepest thing in this build, so the empty state hands the player four or five
   * live doors into it: somebody who is up and doing something, the house they live in, a business
   * that is open right now, and an animal. Deterministic: the same island gives the same doors.
   */
  function emptyState() {
    const rows = [];
    const pop = world.read('population');
    const bs = world.read('businesses');
    const R = world.residents;

    if (pop && pop.roster && pop.roster.length) {
      const seen = new Set();
      const towns = new Map();
      const picks = [];
      // Two passes: the ones doing something first, then whatever is left, so the list is never
      // empty at four in the morning when the whole island is asleep.
      for (const pass of [0, 1]) {
        for (const r of pop.roster) {
          if (picks.length >= 3) break;
          if (!r.onIsland) continue;
          if (pass === 0 && /asleep|lie down/.test(r.action)) continue;
          if (seen.has(r.action)) continue;
          if ((towns.get(r.township) || 0) >= 2) continue;
          seen.add(r.action);
          towns.set(r.township, (towns.get(r.township) || 0) + 1);
          picks.push(r);
        }
      }
      for (const r of picks) rows.push(pickRow(r.name, `${r.age}, ${r.action}`, { kind: 'resident', id: r.id }));
    }

    // The housing fact, as a door rather than as a statistic.
    if (R && R.dwellings) {
      const empty = R.dwellings.find((d) => (d.use === 'holiday-home' || d.use === 'weekender') && !d.occupiedByPartyId);
      if (empty) rows.push(pickRow('A house with nobody in it', `${townshipName(empty.townshipId)} · half the island is like this`, { kind: 'building', id: empty.id }));
    }

    if (bs && bs.board) {
      const open = bs.board.find((b) => b.open) || bs.board[0];
      if (open) rows.push(pickRow(open.name, (open.open ? 'open now · ' : 'shut now · ') + `${cap(plain(open.sector))}, ${townshipName(open.township)}`, { kind: 'business', id: open.id }));
    }

    const koalas = world.store.all('koala');
    const ko = world.read('koala');
    if (koalas.size) {
      rows.push(pickRow('A koala', `one of ${ko ? ko.population : koalas.size} on the island`, { kind: 'koala', id: koalas.keys().next().value }));
    }

    return el('div', { class: 'insp-empty' },
      el('div', { class: 'big' }, 'Click anything'),
      el('p', {}, 'A person, a house, a shop, a road, a koala, a beach, or bare ground. '
        + 'Everything here has a reason for being the way it is, and this is where you read it.'),
      el('p', { style: { marginTop: 'var(--sp-2)' } }, 'Hover to see what is under the cursor. '
        + 'Double click flies to it. Escape clears.'),
      rows.length ? el('h4', { style: { marginTop: 'var(--sp-5)', textAlign: 'left' } }, 'OR START HERE') : null,
      rows.length ? el('div', { class: 'rows' }, rows) : null);
  }

  /* ==================================================================== assembly */

  function tabsFor(kind, id) {
    const v = VIEWS[kind];
    if (!v) return [];
    return typeof v.tabs === 'function' ? v.tabs(id) : (v.tabs || []);
  }

  function rebuild() {
    const s = sel();
    const kind = s.kind, id = s.id;
    live = [];

    // Header
    const view = kind ? VIEWS[kind] : null;
    const head2 = view && view.header ? view.header(id) : null;
    if (!kind || !view) {
      nameEl.textContent = 'Nothing selected';
      subEl.textContent = 'Click anything on the island';
      chipsEl.replaceChildren();
      tabsEl.replaceChildren();
      tabs = [];
      curTab = null;
      bodyEl.replaceChildren(emptyState());
      footEl.replaceChildren(el('span', { class: 'grow' }, ''),
        el('span', {}, 'Esc clears · double click flies'));
      backBtn.disabled = !(s.history && s.history.length);
      focusBtn.disabled = true; followBtn.disabled = true; closeBtn.disabled = true;
      return;
    }

    nameEl.textContent = head2 ? head2.label || head2.name : (s.label || cap(kind));
    subEl.textContent = head2 ? head2.sub : (s.sub || '');
    chipsEl.replaceChildren(...(head2 && head2.chips ? head2.chips : []));

    // Tabs
    const wanted = tabsFor(kind, id);
    tabs = wanted;
    if (!wanted.includes(curTab)) curTab = wanted[0] || null;
    tabsEl.replaceChildren(...(wanted.length > 1 ? wanted.map((t) => el('button', {
      class: t === curTab ? 'on' : '', role: 'tab', 'aria-selected': t === curTab ? 'true' : 'false',
      tabindex: t === curTab ? '0' : '-1',
      onclick: () => { curTab = t; rebuild(); }
    }, t)) : []));

    // Body
    const nodes = view.build(id, curTab) || [];
    bodyEl.replaceChildren(...nodes.flat().filter(Boolean));
    bodyEl.scrollTop = 0;

    // Footer: where it is right now, and how to let go of it. Bound, because most of what can be
    // selected here moves.
    //
    // This used to end with the raw local frame pair, "-6657, 6750", which is metres east and
    // north of the projection origin and means nothing to anybody reading a panel about a
    // seventy-one year old in Dunwich. Every other number in this interface says what it is; that
    // one was debug output that had been left on screen. The coordinates are still in
    // TWIN.probe().state.selection for anyone driving the build.
    const footWhere = el('span', { class: 'grow' });
    const footHint = el('span', {}, 'Esc clears · double click flies');
    footEl.replaceChildren(footWhere, footHint);
    bind(() => {
      const now = sel();
      footWhere.textContent = now.at || 'Minjerribah';
    });
    backBtn.disabled = !(s.history && s.history.length);
    focusBtn.disabled = false; followBtn.disabled = false; closeBtn.disabled = false;
  }

  /* ---- keyboard ---- */

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      world.bus.emit('ui:intent', { kind: 'select:clear' });
      const c = document.getElementById('stage');
      if (c) c.focus();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); goBack(); e.stopPropagation(); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tabs.length > 1) {
      const i = tabs.indexOf(curTab);
      curTab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      e.preventDefault();
      rebuild();
      const on = tabsEl.querySelector('button.on');
      if (on) on.focus();
      e.stopPropagation();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const focusables = Array.from(panel.querySelectorAll('[tabindex="0"], button:not([disabled])'));
      const i = focusables.indexOf(document.activeElement);
      const next = focusables[(i + (e.key === 'ArrowDown' ? 1 : focusables.length - 1) + focusables.length) % focusables.length];
      if (next) { next.focus(); e.preventDefault(); }
      e.stopPropagation();
      return;
    }
    // Anything else typed inside the panel stays inside the panel: the camera rig listens on
    // window for single keys and would otherwise fly the island out from under a reader.
    e.stopPropagation();
  });

  /* ---- the update loop ---- */

  let lastKind = null, lastId = null, lastTab = null, idleTicks = 0;

  function swapTo() {
    const s = sel();
    // Following a relationship replaces every node in the body, which drops the keyboard focus onto
    // the document. Somebody arrowing through a family should land in the new card, not in nowhere.
    const hadFocus = panel.contains(document.activeElement);
    lastKind = s.kind; lastId = s.id;
    rebuild();
    lastTab = curTab;
    if (hadFocus) bodyEl.focus();
    panel.classList.remove('enter');
    void panel.offsetWidth;
    panel.classList.add('enter');
  }

  // A selection is a click, and a click has to answer inside a tenth of a second. The 10 Hz poll
  // below would do it on average, but the panel is the response to the input, so it rebuilds on the
  // event rather than waiting for the next poll to notice.
  world.bus.on('select', () => swapTo());
  world.bus.on('select:lost', () => swapTo());

  rebuild();

  return {
    update() {
      const s = sel();
      if (s.kind !== lastKind || s.id !== lastId || curTab !== lastTab) {
        swapTo();
        return;
      }
      backBtn.disabled = !(s.history && s.history.length);
      // The empty state offers live doors into the island: somebody who is up and about, a shop
      // that is open now. Those go stale, so it is rebuilt every few seconds while it is showing.
      if (!s.kind && ++idleTicks > 30) { idleTicks = 0; rebuild(); return; }
      for (let i = 0; i < live.length; i++) {
        try { live[i](); } catch (e) { /* one bad readout must not stop the panel */ }
      }
    }
  };
}
