// The chronicle. The reader for the record.
//
// src/systems/narrative/chronicle.js writes the entries. This is where you read them: a dated
// column, newest first, grouped by day, in the voice the tone guide in data/narrative.json asks
// for. It is deliberately not a feed and not a notification log. Those exist already, on the left
// edge of the screen, and they are about the last ninety seconds. This is about the year.
//
// It reads like a local paper because that is the honest form for it. A local paper carries the
// council refusing a seawall, a household leaving, the water taxi leaving people on the pontoon
// nineteen times in a week, and a whale two kilometres off the Gorge, and it carries them at the
// same size, because on a small island they are the same size.
//
// WHAT THE READER ADDS, over and above showing the text:
//
//   FILTERS that are about this place rather than about a database: a theme, a register from the
//   pack's own list, a place, a household, and a search. Every filter says how many entries it
//   leaves, so a filter that empties the page tells you so before you wonder why.
//
//   CLICKING AN ENTRY flies the camera to where it happened and selects the people it is about, so
//   the record is a way into the island rather than a wall of text beside it. An entry with a
//   person gets the person; an entry with only a place gets the place; an entry with neither says
//   so rather than flying you somewhere arbitrary.
//
//   THE EVIDENCE. Every entry that came out of the drama director carries the state that had to be
//   true for that beat to fire, with the value it actually had. That is the difference between a
//   generated story and a story about this simulation, and it is one click away rather than hidden.
//
// CULTURAL RULE, ABSOLUTE, and it is worth restating in the file that displays the words rather
// than only in the file that writes them. Nothing here puts words in anybody's mouth: there is no
// dialogue anywhere in this record and the writer rejects any sentence containing a quotation mark.
// No simulated resident on this island has an Aboriginality, a clan, a family group, a cultural
// role or cultural knowledge, because data/lore.json forbids generating any of those and the packs
// that make the people do not contain them. This panel renders what the writer published and adds
// no cultural framing of its own. The rejections the writer made are shown, in the panel, under
// the house rules, because a guard nobody can see is a guard nobody can check.

import { registerPanel, el } from '../mount.js';

/* ------------------------------------------------------------------ shared chrome */

function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  // The rail's own look and position live in src/ui/design.css, once, rather than in a copy
  // inside each of the six panels that can be the first to build it.
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The registers are the pack's, with the pack's own note on each. */
function registerNote(world, id) {
  const list = ((world.data && world.data.narrative) || {}).registers || [];
  const r = list.find((x) => x.id === id);
  return r ? { label: r.label, note: r.note } : { label: String(id || '').replace(/-/g, ' '), note: '' };
}

/* ================================================================== the panel */

registerPanel({
  id: 'chronicle',
  order: 46,
  mount(root, world) { return mountChronicle(root, world); }
});

function mountChronicle(root, world) {
  injectStyle();

  /* ---- launcher and board ---------------------------------------------- */

  const badge = el('span', { class: 'dot' });
  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'The chronicle (j)', onclick: () => toggle()
  }, 'Chronicle', badge);
  rail().append(launcher);

  const scrim = el('div', { class: 'cr-scrim', onclick: () => toggle(false) });
  const board = el('section', {
    class: 'panel cr-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'The chronicle'
  });
  root.append(scrim, board);

  const headStat = el('div', { class: 'cr-stat' });
  const head = el('div', { class: 'cr-top' },
    el('div', {},
      el('h2', {}, 'The chronicle'),
      el('div', { class: 'cr-sub' },
        'What happened on Minjerribah in this playthrough, written from what the simulation actually '
        + 'did. Nobody in it speaks: people act, and the record reports the action.')),
    headStat,
    el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

  const colFilters = el('div', { class: 'cr-pane cr-filters scroll' });
  const colFeed = el('div', { class: 'cr-pane cr-feed scroll' });
  const colDetail = el('div', { class: 'cr-pane cr-detail scroll' });
  board.append(head, el('div', { class: 'cr-cols' }, colFilters, colFeed, colDetail));

  let open = false;
  let unseen = 0;

  function toggle(force) {
    open = force === undefined ? !open : !!force;
    scrim.classList.toggle('on', open);
    board.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    if (open) {
      unseen = 0;
      badge.textContent = '';
      world.bus.emit('ui:drawer', { id: 'chronicle' });
      refresh(true);
      board.focus({ preventScroll: true });
    }
  }
  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'chronicle' && open) toggle(false); });
  world.bus.on('ui:open', (p) => { if (p && p.id === 'chronicle') { if (p.entryId) selectedId = p.entryId; toggle(true); } });
  world.bus.on('chronicle:entry', () => {
    if (open) return;
    unseen = Math.min(99, unseen + 1);
    badge.textContent = String(unseen);
  });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
    else if (e.code === 'KeyJ') { toggle(); e.preventDefault(); }
  });

  /* ---- filter state ------------------------------------------------------ */

  const F = { theme: 'all', register: 'all', place: 'all', household: 'all', query: '', leadsOnly: false };
  let selectedId = null;

  function entries() {
    const c = world.read('chronicle');
    return (c && c.entries) || [];
  }

  function filtered() {
    const q = F.query.trim().toLowerCase();
    return entries().filter((e) => {
      if (F.theme !== 'all' && e.theme !== F.theme) return false;
      if (F.register !== 'all' && e.register !== F.register) return false;
      if (F.place !== 'all' && (!e.place || e.place.id !== F.place)) return false;
      if (F.household !== 'all' && e.householdId !== F.household) return false;
      if (F.leadsOnly && e.weight < 3) return false;
      if (q) {
        const hay = (e.text + ' ' + (e.detail || '') + ' '
          + (e.people || []).map((p) => p.name).join(' ') + ' ' + (e.place ? e.place.label : '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* ---- rebuild ----------------------------------------------------------- */

  let sig = '';
  function signature() {
    const c = world.read('chronicle') || {};
    return [c.count, c.lastDate, F.theme, F.register, F.place, F.household, F.query, F.leadsOnly, selectedId].join('~');
  }
  function refresh(force) {
    if (!open) return;
    const s = signature();
    if (!force && s === sig) return;
    sig = s;
    drawHead();
    drawFilters();
    drawFeed();
    drawDetail();
  }

  function drawHead() {
    const c = world.read('chronicle') || {};
    headStat.textContent = '';
    const stat = (k, v) => headStat.append(el('div', { class: 'readout' },
      el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)));
    stat('Entries', isNum(c.count) ? String(c.count) : '–');
    stat('Latest', c.lastDate || '–');
    const list = filtered();
    stat('Showing', String(list.length));
  }

  /* ---- column one: filters ----------------------------------------------- */

  function drawFilters() {
    const c = world.read('chronicle') || {};
    colFilters.textContent = '';

    colFilters.append(el('input', {
      type: 'search', class: 'cr-search', placeholder: 'Search the record', value: F.query,
      oninput: (e) => { F.query = e.target.value; refresh(true); }
    }));

    const chipRow = (title, options, current, pick) => {
      colFilters.append(el('div', { class: 'cr-h' }, title));
      const wrap = el('div', { class: 'cr-chips' });
      for (const [value, label, n] of options) {
        wrap.append(el('button', {
          class: 'btn' + (value === current ? ' on' : ''), type: 'button',
          onclick: () => { pick(value); refresh(true); }
        }, label, n !== undefined ? el('em', {}, String(n)) : null));
      }
      colFilters.append(wrap);
    };

    const all = entries();
    const themes = (c.themes || []).filter((t) => t.count > 0).map((t) => [t.id, t.label, t.count]);
    chipRow('Theme', [['all', 'Everything', all.length]].concat(themes), F.theme, (v) => { F.theme = v; });

    const regs = new Map();
    for (const e of all) if (e.register) regs.set(e.register, (regs.get(e.register) || 0) + 1);
    if (regs.size) {
      chipRow('Register', [['all', 'Any']].concat([...regs.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => [id, registerNote(world, id).label, n])), F.register, (v) => { F.register = v; });
      const rn = F.register !== 'all' ? registerNote(world, F.register) : null;
      if (rn && rn.note) colFilters.append(el('p', { class: 'cr-p quiet' }, rn.note));
    }

    const places = (c.places || []).slice(0, 14).map((p) => [p.id, p.label, p.count]);
    if (places.length) chipRow('Place', [['all', 'Anywhere']].concat(places), F.place, (v) => { F.place = v; });

    // Households are ids in the record, so they are labelled with the people the record already
    // named. A household nobody has been named in stays an id, honestly.
    const houses = new Map();
    for (const e of all) {
      if (!e.householdId) continue;
      const cur = houses.get(e.householdId) || { n: 0, names: new Set() };
      cur.n++;
      for (const p of e.people || []) if (p.name) cur.names.add(p.name.split(' ').slice(-1)[0]);
      houses.set(e.householdId, cur);
    }
    if (houses.size) {
      chipRow('Household', [['all', 'Any']].concat([...houses.entries()]
        .sort((a, b) => b[1].n - a[1].n).slice(0, 10)
        .map(([id, v]) => [id, v.names.size ? [...v.names].join(' and ') : id, v.n])),
      F.household, (v) => { F.household = v; });
    }

    colFilters.append(el('div', { class: 'cr-h' }, 'The page'));
    colFilters.append(el('button', {
      class: 'btn' + (F.leadsOnly ? ' on' : ''), type: 'button',
      onclick: () => { F.leadsOnly = !F.leadsOnly; refresh(true); }
    }, 'Only the days that mattered'));
    if (F.theme !== 'all' || F.register !== 'all' || F.place !== 'all' || F.household !== 'all' || F.query || F.leadsOnly) {
      colFilters.append(el('button', {
        class: 'btn ghost', type: 'button', style: { marginTop: 'var(--sp-2)' },
        onclick: () => {
          F.theme = 'all'; F.register = 'all'; F.place = 'all'; F.household = 'all';
          F.query = ''; F.leadsOnly = false; refresh(true);
        }
      }, 'Clear the filters'));
    }

    colFilters.append(el('div', { class: 'cr-h' }, 'House rules'));
    colFilters.append(el('p', { class: 'cr-p quiet' },
      'Nobody in this record speaks. Every sentence is checked before it is published against the '
      + 'tone guide in data/narrative.json and the cultural prohibitions in data/lore.json, and a '
      + 'line that fails is not shown.'));
    if (c.rejected && c.rejected.length) {
      colFilters.append(el('p', { class: 'cr-p quiet' },
        c.rejected.length + ' line' + (c.rejected.length === 1 ? '' : 's') + ' held back so far:'));
      for (const r of c.rejected) {
        colFilters.append(el('div', { class: 'cr-reject' }, el('b', {}, r.why), el('span', {}, r.text)));
      }
    } else {
      colFilters.append(el('p', { class: 'cr-p quiet' }, 'Nothing has failed those checks so far.'));
    }
  }

  /* ---- column two: the record --------------------------------------------- */

  function drawFeed() {
    colFeed.textContent = '';
    const list = filtered();
    if (!list.length) {
      const c = world.read('chronicle');
      colFeed.append(el('p', { class: 'cr-p' }, !c || !c.ready
        ? 'The chronicle is not running in this build.'
        : entries().length
          ? 'Nothing in the record matches that.'
          : 'Nothing has happened yet. Let the island run.'));
      return;
    }
    let day = null;
    for (const e of list) {
      if (e.date !== day) {
        day = e.date;
        colFeed.append(el('div', { class: 'cr-day' }, el('span', {}, e.date), el('i', {})));
      }
      const card = el('article', {
        class: 'cr-entry w' + e.weight + (selectedId === e.id ? ' on' : ''),
        tabindex: '0', role: 'button',
        onclick: () => { selectedId = e.id; refresh(true); goTo(e); },
        onkeydown: (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectedId = e.id; refresh(true); goTo(e); }
        }
      },
      el('p', { class: 'cr-text' }, e.text),
      e.detail ? el('p', { class: 'cr-det' }, e.detail) : null,
      el('div', { class: 'cr-meta' },
        el('span', { class: 'cr-time' }, e.time),
        el('span', { class: 'cr-theme' }, e.themeLabel),
        e.place ? el('span', { class: 'cr-place' }, e.place.label) : null,
        (e.people || []).length ? el('span', { class: 'cr-who' }, e.people.map((p) => p.name).join(', ')) : null));
      colFeed.append(card);
    }
  }

  /**
   * Clicking an entry takes you there. A person first, because a person is the thing worth
   * standing next to; then the place; then nothing, and it says nothing rather than guessing.
   */
  function goTo(e) {
    const person = (e.people || []).find((p) => p.id);
    if (person) {
      world.bus.emit('ui:intent', { kind: 'select', target: { kind: 'resident', id: person.id }, source: 'chronicle', focus: true, dist: 120 });
      return;
    }
    if (e.place && isNum(e.place.x)) {
      world.bus.emit('camera:goto', { x: e.place.x, z: e.place.z, dist: 900, dur: 1.3 });
    }
  }

  /* ---- column three: the entry -------------------------------------------- */

  function drawDetail() {
    colDetail.textContent = '';
    const e = entries().find((x) => x.id === selectedId);
    if (!e) {
      colDetail.append(el('div', { class: 'cr-h' }, 'An entry'));
      colDetail.append(el('p', { class: 'cr-p' },
        'Click a line. The camera goes to where it happened and the people it is about get selected, '
        + 'so you can look at them rather than only read about them.'));
      const c = world.read('chronicle') || {};
      if (c.basis) colDetail.append(el('div', { class: 'cr-h' }, 'How this is written'), el('p', { class: 'cr-p quiet' }, c.basis));
      if (c.voice) colDetail.append(el('p', { class: 'cr-p quiet' }, c.voice));
      return;
    }

    colDetail.append(el('div', { class: 'cr-h' }, e.date + ', ' + e.time));
    colDetail.append(el('p', { class: 'cr-lede' }, e.text));
    if (e.detail) colDetail.append(el('p', { class: 'cr-p' }, e.detail));

    const chips = el('div', { class: 'cr-chips tight' },
      el('span', { class: 'chip sea' }, e.themeLabel),
      e.register ? el('span', { class: 'chip heath' }, registerNote(world, e.register).label) : null,
      e.season ? el('span', { class: 'chip iron' }, e.season) : null,
      e.weight >= 3 ? el('span', { class: 'chip sun' }, 'the day\'s lead') : null);
    colDetail.append(chips);
    if (e.register) {
      const rn = registerNote(world, e.register);
      if (rn.note) colDetail.append(el('p', { class: 'cr-p quiet' }, rn.note));
    }

    if ((e.people || []).length) {
      colDetail.append(el('div', { class: 'cr-h' }, 'Who this is about'));
      for (const p of e.people) {
        const card = world.read('population') && world.read('population').card ? world.read('population').card(p.id) : null;
        colDetail.append(el('div', {
          class: 'cr-person', tabindex: p.id ? '0' : null, role: p.id ? 'button' : null,
          onclick: () => p.id && world.bus.emit('ui:intent', { kind: 'select', target: { kind: 'resident', id: p.id }, focus: true, dist: 90, source: 'chronicle' }),
          onkeydown: (ev) => { if (p.id && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); world.bus.emit('ui:intent', { kind: 'select', target: { kind: 'resident', id: p.id }, focus: true, dist: 90, source: 'chronicle' }); } }
        },
        el('b', {}, p.name),
        el('span', {}, card
          ? [card.age + ', ' + (card.job && card.job.occupation ? card.job.occupation : 'no listed occupation'), card.township].filter(Boolean).join(' · ')
          : (p.role ? String(p.role).replace(/-/g, ' ') : 'no longer on the island')),
        card && card.doing ? el('em', {}, 'Right now: ' + card.doing.toLowerCase() + '.') : null));
      }
    }

    if (e.place) {
      colDetail.append(el('div', { class: 'cr-h' }, 'Where'));
      colDetail.append(el('div', { class: 'cr-place-card' },
        el('b', {}, e.place.label),
        isNum(e.place.x) ? el('button', {
          class: 'btn', type: 'button',
          onclick: () => world.bus.emit('camera:goto', { x: e.place.x, z: e.place.z, dist: 700, dur: 1.3 })
        }, 'Fly there') : null));
    }

    if (e.evidence && e.evidence.length) {
      colDetail.append(el('div', { class: 'cr-h' }, 'What had to be true'));
      colDetail.append(el('p', { class: 'cr-p quiet' },
        'The state this beat stood on, with the value it actually had at the time. A beat whose state '
        + 'nothing publishes is skipped rather than written.'));
      const ul = el('div', { class: 'cr-ev' });
      for (const line of e.evidence) ul.append(el('code', {}, line));
      colDetail.append(ul);
    }

    colDetail.append(el('div', { class: 'cr-h' }, 'Where this came from'));
    colDetail.append(el('p', { class: 'cr-p quiet' }, e.source + (e.seedId ? ', seed ' + e.seedId : '')));
    if (e.seedId) {
      const seed = ((world.data && world.data.narrative) || {}).seeds || [];
      const s = seed.find((x) => x.id === e.seedId);
      if (s && s.of_this_place) {
        colDetail.append(el('div', { class: 'cr-h' }, 'Why this is a Minjerribah story'));
        colDetail.append(el('p', { class: 'cr-p' }, s.of_this_place));
      }
    }
  }

  /* ---- the loop ----------------------------------------------------------- */

  return {
    update() { refresh(false); }
  };
}

/* ------------------------------------------------------------------ style */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'cr-style';
  s.textContent = `
.cr-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.cr-scrim.on { opacity: 1; pointer-events: auto; }
.cr-board { position: fixed; inset: var(--board-inset); z-index: 41; display: flex; flex-direction: column;
  max-width: 1560px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.cr-board.on { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 860px) { .cr-board { inset: 0; border-radius: 0; } }

.cr-top { display: flex; align-items: flex-start; gap: var(--sp-5); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.cr-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.cr-sub { font-size: var(--fs-sm); color: var(--t-faint); max-width: 76ch; line-height: 1.5; }
.cr-stat { display: flex; gap: var(--sp-5); margin-left: auto; }
.cr-top > button { flex: none; }

.cr-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px 1fr 360px; }
.cr-cols > * { min-height: 0; }
.cr-pane { min-height: 0; padding: var(--sp-3); border-right: 1px solid var(--edge); }
.cr-pane:last-child { border-right: none; }
.cr-feed { padding: var(--sp-3) var(--sp-5); }

.cr-h { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--t-faint);
  font-weight: 600; margin: var(--sp-4) 0 var(--sp-2); }
.cr-h:first-child { margin-top: 0; }
.cr-p { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); margin-bottom: var(--sp-2); }
.cr-p.quiet { color: var(--t-faint); font-size: var(--fs-micro); line-height: 1.7; }

.cr-search { width: 100%; appearance: none; background: var(--s-sunk); border: 1px solid var(--edge-strong);
  border-radius: var(--r-2); color: var(--t); font: var(--fs-sm) var(--f-ui); padding: var(--sp-2) var(--sp-3); }
.cr-search:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.cr-chips { display: flex; flex-wrap: wrap; gap: 3px; }
.cr-chips .btn { padding: 3px 7px; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; gap: 4px; }
.cr-chips .btn em { font-style: normal; font-family: var(--f-num); opacity: .6; }
.cr-chips.tight { margin-bottom: var(--sp-3); }

.cr-reject { border-left: 2px solid var(--coral); padding: 4px var(--sp-2); margin-bottom: 4px;
  background: rgba(226,114,91,.07); }
.cr-reject b { display: block; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--coral); }
.cr-reject span { display: block; font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.5; }

.cr-day { display: flex; align-items: center; gap: var(--sp-3); margin: var(--sp-5) 0 var(--sp-2); }
.cr-day:first-child { margin-top: 0; }
.cr-day span { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .18em; text-transform: uppercase;
  color: var(--sand); white-space: nowrap; }
.cr-day i { flex: 1; height: 1px; background: var(--edge); }

.cr-entry { padding: var(--sp-2) var(--sp-3); border-left: 2px solid transparent; cursor: pointer;
  border-radius: 0 var(--r-2) var(--r-2) 0; transition: background var(--fast), border-color var(--fast); }
.cr-entry:hover { background: rgba(255,255,255,.045); border-left-color: var(--edge-strong); }
.cr-entry.on { background: rgba(63,182,196,.10); border-left-color: var(--sea); }
.cr-entry:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.cr-text { font: 400 var(--fs-base)/1.65 var(--f-ui); color: var(--t); max-width: 72ch; }
.cr-entry.w3 .cr-text { font-size: var(--fs-lg); line-height: 1.55; color: var(--t-hi); font-weight: 300; }
.cr-entry.w1 .cr-text { color: var(--t-dim); }
.cr-det { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-faint); max-width: 72ch; margin-top: 3px; }
.cr-meta { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: 5px;
  font: 400 var(--fs-micro)/1.5 var(--f-num); color: var(--t-faint); }
.cr-meta .cr-theme { color: var(--sea); }
.cr-meta .cr-who { color: var(--sand); }

.cr-lede { font: 300 var(--fs-lg)/1.6 var(--f-ui); color: var(--t-hi); margin-bottom: var(--sp-3); }
.cr-person { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-2); cursor: pointer; transition: border-color var(--fast), background var(--fast); }
.cr-person:hover { border-color: var(--sea); background: rgba(63,182,196,.08); }
.cr-person:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.cr-person b { display: block; color: var(--t-hi); font-weight: 500; }
.cr-person span { display: block; font-size: var(--fs-sm); color: var(--t-faint); }
.cr-person em { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--sea); margin-top: 3px; }
.cr-place-card { display: flex; align-items: center; gap: var(--sp-3); border: 1px solid var(--edge);
  border-radius: var(--r-2); padding: var(--sp-2) var(--sp-3); }
.cr-place-card b { flex: 1; color: var(--t-hi); font-weight: 500; }

.cr-ev { display: flex; flex-direction: column; gap: 3px; }
.cr-ev code { display: block; font: 400 var(--fs-micro)/1.6 var(--f-num); color: var(--t-dim);
  background: var(--s-sunk); border-radius: var(--r-1); padding: 4px 7px; word-break: break-word; }

@media (max-width: 1200px) {
  .cr-cols { grid-template-columns: 1fr; overflow-y: auto; }
  .cr-pane { border-right: none; border-bottom: 1px solid var(--edge); }
  .cr-stat { margin-left: 0; }
}
`;
  document.head.appendChild(s);
}
