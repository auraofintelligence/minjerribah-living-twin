// The works below the sand: the production interface.
//
// ============================================================================================
// NONE OF THIS EXISTS. Read that again before reading anything else in this file.
//
// data/subterranean.json marks every one of its forty three buildings `existence: "proposed"`.
// Not one of them is on Minjerribah. Not one is approved, funded, sited, surveyed or consented.
// This panel is a production interface over a design being tested in a twin, and it carries that
// word on every screen, in the board header, on a badge that sits over the world while the panel
// is open, on every building row and on every machine row. There is no view of this panel from
// which a person could take a screenshot and reasonably conclude the works are real, and if a
// future edit makes one, that edit is wrong.
//
// Minjerribah is Quandamooka Country. Every excavation concept here would need Traditional Owner
// consent, sought again at each stage and never carried over. This twin does not model that
// decision, will not put a number on it, and shows it as what it is: a gate held by somebody else,
// not sought, with a list of what would have to be true before the question could honestly be
// asked. The scenario switch can assume consent so a player can see the rest of the graph run, and
// when it does, every gate it touched is permanently labelled assumed, not given.
//
// Mineral sand mining on this island ended in 2019 under the North Stradbroke Island Protection
// and Sustainability Act 2011. This is not a proposal to restart it.
// ============================================================================================
//
// WHAT THE PANEL IS FOR, once that is understood. It is the Satisfactory problem: a graph of
// machines, a finite way to move material between them, and one question a player asks over and
// over, which is why is that thing stopped. The answer has to be actionable, and a limit code is
// not an answer. So the Overview tab traces the causal chain: this process is starved of X,
// because the thing that makes X is running at forty per cent, because its own line out is full.
// Up to four hops, each one a row you can click through to.
//
// The three numbers on the header strip are the pack's own choice, in its own words: the connected
// load against generation, the orphan stream total, and the residual to landfill. "If those three
// are getting worse, the city is not working, however good the throughput looks."

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

/* ------------------------------------------------------------------ helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function n1(v) { return isNum(v) ? (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) : '–'; }
function kg(v) {
  if (!isNum(v)) return '–';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + ' t';
  return Math.round(v) + ' kg';
}
function money(v) {
  if (!isNum(v) || v === 0) return 'A$0';
  const a = Math.abs(v);
  if (a >= 1e6) return 'A$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return 'A$' + Math.round(v / 1e3) + 'k';
  return 'A$' + Math.round(v);
}
function pctOf(v) { return isNum(v) ? Math.round(v * 100) + '%' : '–'; }

const GATE_STATE_TONE = {
  passed: 'leaf', 'in progress': 'sun', 'not sought': 'coral', 'assumed-in-scenario': 'heath'
};

/* ================================================================== the panel */

registerPanel({
  id: 'subterranean',
  order: 47,
  mount(root, world) { return mountSub(root, world); }
});

function mountSub(root, world) {
  injectStyle();

  /* ---- launcher, the standing badge, the board -------------------------- */

  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'The works below the sand, proposed (u)',
    onclick: () => toggle()
  }, 'Below the sand');
  rail().append(launcher);

  // The badge is not part of the board. It sits over the world, above everything, for as long as
  // this panel is open, so a screenshot that catches the island and this interface together still
  // carries the word. It has no close button on purpose.
  const badge = el('div', { class: 'sub-badge', role: 'note' },
    el('b', {}, 'PROPOSED'),
    el('span', {}, 'None of the works below the sand exists on Minjerribah. This is a design being '
      + 'tested in a twin, not a facility.'));
  root.append(badge);

  const scrim = el('div', { class: 'sub-scrim', onclick: () => toggle(false) });
  const board = el('section', {
    class: 'panel sub-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
    'aria-label': 'The proposed works below the sand'
  });
  root.append(scrim, board);

  const banner = el('div', { class: 'sub-banner' },
    el('b', {}, 'PROPOSED'),
    el('span', {}, ''));

  const strip = el('div', { class: 'sub-strip' });
  const head = el('div', { class: 'sub-top' },
    el('div', { class: 'sub-title' },
      el('h2', {}, 'The works below the sand'),
      el('div', { class: 'sub-sub' }, '')),
    strip,
    el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

  const TABS = [
    ['overview', 'Overview'],
    ['lines', 'Lines'],
    ['power', 'Power'],
    ['heat', 'Heat'],
    ['material', 'Material'],
    ['consent', 'Consent'],
    ['tiers', 'Tiers']
  ];
  const tabBar = el('nav', { class: 'tabs' });
  const tabBtns = {};
  let tab = 'overview';
  for (const [id, label] of TABS) {
    const b = el('button', { type: 'button', onclick: () => { tab = id; refresh(true); } }, label);
    tabBtns[id] = b;
    tabBar.append(b);
  }
  const main = el('div', { class: 'sub-main scroll' });
  board.append(banner, head, tabBar, main);

  let open = false;
  function toggle(force) {
    open = force === undefined ? !open : !!force;
    scrim.classList.toggle('on', open);
    board.classList.toggle('on', open);
    badge.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    if (open) { world.bus.emit('ui:drawer', { id: 'subterranean' }); refresh(true); board.focus({ preventScroll: true }); }
  }
  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'subterranean' && open) toggle(false); });
  world.bus.on('ui:open', (p) => { if (p && p.id === 'subterranean') { if (p.tab && tabBtns[p.tab]) tab = p.tab; toggle(true); } });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
    else if (e.code === 'KeyU') { toggle(); e.preventDefault(); }
  });

  const S = () => world.read('subterranean') || null;
  function intent(kind, extra) { world.bus.emit('ui:intent', Object.assign({ kind: 'subterranean:' + kind }, extra || {})); refresh(true); }

  /* ---- the causal chain -------------------------------------------------
     The one question a player asks over and over. `plainly` from the system says what is short;
     this walks back up the graph and says what is short of it, and what is short of that. */

  function producersOf(s, resourceName) {
    return (s.lines || []).filter((l) => l.dir === 'out' && l.resourceName === resourceName);
  }
  function machinesIn(s, buildingId) {
    return (s.machines || []).filter((m) => m.building === buildingId && m.units > 0);
  }

  function chain(s, start) {
    // The head is pushed once, outside the loop. Pushing it at the top of each pass duplicated
    // every hop and produced "because the compost windrow, because the compost windrow".
    const out = [{ name: start.name, building: start.building, limit: start.limit, detail: start.why, hop: 0 }];
    const seen = new Set([start.building]);
    let limit = start.limit;
    let detail = start.why;

    for (let hop = 1; hop <= 4; hop++) {
      if (limit !== 'starved' || !detail) break;
      const producers = producersOf(s, detail);
      if (!producers.length) {
        out.push({
          name: detail, building: null, limit: 'nothing makes it',
          short: 'nothing in the graph that is built produces ' + detail.toLowerCase() + ' at all',
          detail: 'Nothing in the graph that is currently built produces ' + detail.toLowerCase()
            + '. It is either an import, or the process that makes it has not been built. The line '
            + 'list this is traced through is the busiest forty, so a very quiet producer can also '
            + 'fall off the end of it.',
          hop, terminal: true
        });
        break;
      }
      // Prefer a producer that is not already in the chain, so a process that both makes and
      // consumes the same stream does not read as its own cause.
      const p = producers.find((x) => !seen.has(x.building)) || producers[0];
      if (seen.has(p.building)) {
        out.push({
          name: p.buildingName, building: p.building, limit: 'a loop',
          short: 'the only thing making it is ' + p.buildingName + ', which is the building waiting on it',
          detail: 'The only thing making ' + detail.toLowerCase() + ' is in ' + p.buildingName
            + ', which is the building waiting on it. A loop like that has to be broken from '
            + 'outside: build the process that feeds it, or bring the first batch in on the barge.',
          hop, terminal: true
        });
        break;
      }
      seen.add(p.building);
      const ms = machinesIn(s, p.building);
      // The slowest machine in the producing building is the one holding the line up.
      const worst = ms.slice().sort((a, b) => a.utilisation - b.utilisation)[0];
      if (!worst) {
        out.push({
          name: p.buildingName, building: p.building, limit: 'not built',
          short: 'the only thing that makes it is in ' + p.buildingName + ', and nothing in it is built yet',
          detail: 'The only thing that makes ' + detail.toLowerCase() + ' is in ' + p.buildingName
            + ', and nothing in it is built yet.',
          hop, terminal: true
        });
        break;
      }
      out.push({
        name: worst.name, building: p.building, limit: worst.limit, detail: worst.why,
        utilisation: worst.utilisation, hop, machine: worst.id
      });
      if (worst.limit !== 'starved') break;
      limit = worst.limit;
      detail = worst.why;
    }
    return out;
  }

  /**
   * The chain, as a sentence a person could act on. The first clause is the system's own words,
   * because it has a good line for every limit code it can produce and rewriting them here would
   * only make them worse. Everything after "because" is this panel walking back up the graph.
   */
  function chainSentence(s, rows, head) {
    if (!rows.length) return '';
    const parts = [];
    // The system's own line ends with a general clause about what is upstream. When the trace has
    // an actual answer to that, the general clause is dropped and the specific one takes its place.
    const terminal = rows.find((r) => r.terminal);
    let lead = String(head || (rows[0].name + ' is held by ' + rows[0].limit));
    if (terminal && rows.length > 1) lead = (lead.match(/^[^.]+\./) || [lead])[0];
    parts.push(lead.replace(/\.$/, ''));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.terminal) {
        parts.push('and ' + String(r.short || r.detail).replace(/\.$/, ''));
        break;
      }
      const at = isNum(r.utilisation) ? ' is at ' + Math.round(r.utilisation * 100) + ' per cent' : '';
      parts.push('because ' + r.name + at
        + (r.limit && r.limit !== 'running at nameplate'
          ? ' (' + r.limit + (r.detail ? ': ' + String(r.detail).toLowerCase() : '') + ')'
          : ''));
    }
    return parts.join(', ') + '.';
  }

  /* ---- rebuild ----------------------------------------------------------- */

  let sig = '';
  function signature() {
    const s = S();
    if (!s) return 'none';
    return [tab, s.tier, s.scenario, s.built, s.running, s.stalled, s.tripped,
      Math.round(s.connectedLoadKw), Math.round(s.orphanKg), s.bottleneck ? s.bottleneck.process + s.bottleneck.limit : '',
      world.clock.dayIndex, Math.round(world.clock.tick / 6)].join('~');
  }
  function refresh(force) {
    if (!open) return;
    const s = signature();
    if (!force && s === sig) return;
    sig = s;
    for (const [id] of TABS) tabBtns[id].classList.toggle('on', tab === id);
    drawHeader();
    main.textContent = '';
    try { VIEWS[tab](); } catch (e) {
      main.append(el('p', { class: 'sub-p' }, 'This tab could not be drawn: ' + (e && e.message)));
      console.error('[subterranean] view failed', tab, e);
    }
  }

  function drawHeader() {
    const s = S();
    banner.querySelector('span').textContent = s
      ? s.whatThisIs
      : 'The subterranean system is not loaded in this build.';
    head.querySelector('.sub-sub').textContent = s
      ? 'Tier ' + s.tier + ', ' + s.tierName + '. ' + s.built + ' of ' + s.proposed + ' proposed buildings stood up in the twin.'
      : '';
    strip.textContent = '';
    if (!s) return;
    const cell = (k, v, sub, tone) => strip.append(el('div', { class: 'readout' + (tone ? ' ' + tone : '') },
      el('div', { class: 'k' }, k),
      el('div', { class: 'v' }, v, sub ? el('small', {}, ' ' + sub) : null)));
    const genShort = s.connectedLoadKw > 0 && s.generationKw < s.connectedLoadKw * 0.4;
    cell('Connected load', n1(s.connectedLoadKw), 'kW', genShort ? 'warn' : '');
    cell('Own generation', n1(s.generationKw), 'kW', s.generationKw > 0 ? 'good' : 'bad');
    cell('Orphan streams', kg(s.orphanKg), '', s.orphanKg > 4000 ? 'warn' : '');
    cell('Residual to landfill', kg(s.residualToLandfillKg), 'a year', s.residualToLandfillKg > 0 ? 'warn' : 'good');
  }

  const VIEWS = {};

  function notLoaded() {
    main.append(el('p', { class: 'sub-p' },
      'The subterranean system is not registered in this build, so there is nothing to show. '
      + 'That is the correct result rather than an invented one.'));
  }

  /* ---- overview ---------------------------------------------------------- */

  VIEWS.overview = () => {
    const s = S();
    if (!s) return notLoaded();

    // The bottleneck, first, because it is the thing a player came here to fix.
    main.append(el('div', { class: 'sub-h' }, 'Why is it stopped'));
    if (!s.bottleneck) {
      main.append(el('p', { class: 'sub-p' },
        s.running > 0
          ? 'Nothing is being held back. Every built process is running at its clock.'
          : 'Nothing is built yet, so nothing is stopped. Tier one is the rung that needs nobody\'s '
            + 'permission but the landholder\'s: a repair bench, a tip triage bay, a cullet crusher, '
            + 'a compost windrow, rooftop panels and the two records that make the rest legible.'));
    } else {
      const rows = chain(s, s.bottleneck);
      main.append(el('div', { class: 'sub-diag' },
        el('b', {}, chainSentence(s, rows, s.bottleneck.plainly)),
        el('span', {}, 'About ' + n1(s.bottleneck.lostUnits) + ' of the units built at '
          + s.bottleneck.name + ' are sitting idle because of it.')));
      const chainBox = el('div', { class: 'sub-chain' });
      for (const r of rows) {
        chainBox.append(el('div', { class: 'sub-hop' + (r.terminal ? ' end' : '') },
          el('i', {}, String(r.hop + 1)),
          el('div', {},
            el('b', {}, r.name),
            el('span', {}, r.limit + (r.detail ? ': ' + r.detail : '')),
            isNum(r.utilisation) ? el('div', { class: 'meter' + (r.utilisation < 0.5 ? ' bad' : r.utilisation < 0.85 ? ' warn' : ' good') },
              el('i', { style: { width: Math.round(r.utilisation * 100) + '%' } })) : null)));
      }
      main.append(chainBox);
      main.append(el('p', { class: 'sub-p quiet' },
        'What to do about it is upstream, not here: build or add units to the thing at the bottom of '
        + 'that chain, or add a lane to the line that is full. Both are on the Lines tab.'));
    }

    // The state of the works.
    main.append(el('div', { class: 'sub-h' }, 'The works'));
    const t = el('table', { class: 'sub-table' });
    const line = (k, v, tone) => t.append(el('tr', {},
      el('th', {}, k), el('td', { class: tone || '' }, v)));
    line('Built in the twin', s.built + ' of ' + s.proposed + ' proposed buildings');
    line('Running', String(s.running), s.running > 0 ? 'good' : '');
    line('Stalled', String(s.stalled), s.stalled > 0 ? 'warn' : '');
    line('Tripped by the power discipline', String(s.tripped), s.tripped > 0 ? 'bad' : '');
    line('Trunk, solids', s.trunk.solidLanes + ' lane' + (s.trunk.solidLanes === 1 ? '' : 's') + ', ' + s.trunk.solidPct + '% used');
    line('Trunk, fluids', s.trunk.fluidLanes + ' lane' + (s.trunk.fluidLanes === 1 ? '' : 's') + ', ' + s.trunk.fluidPct + '% used');
    line('Mass balance', n1(s.massBalanceKgPerDay) + ' kg a day in over out',
      Math.abs(s.massBalanceKgPerDay) > 500 ? 'warn' : 'good');
    line('C-hours recorded', String(s.cHours.recorded));
    line('Material passports issued', String(s.passports.issued));
    line('Capital spent in the twin', money(s.capital.spentA$));
    main.append(t);

    if (s.blockedBy && s.blockedBy.length) {
      main.append(el('div', { class: 'sub-h' }, 'What is standing in the way'));
      for (const b of s.blockedBy) main.append(el('div', { class: 'sub-block' }, b));
      main.append(el('p', { class: 'sub-p quiet' },
        'In the order a person would ask. The Consent tab has what each one is and who holds it.'));
    }

    main.append(el('div', { class: 'sub-h' }, 'The controls'));
    main.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn' + (s.autoWorks ? ' on' : ''), type: 'button',
        onclick: () => intent('auto-works', { on: !s.autoWorks })
      }, s.autoWorks ? 'Works manager on' : 'Works manager off'),
      el('button', {
        class: 'btn' + (s.power.discipline === 'protect-the-island' ? ' on' : ''), type: 'button',
        onclick: () => intent('discipline', { discipline: 'protect-the-island' })
      }, 'Protect the island'),
      el('button', {
        class: 'btn' + (s.power.discipline === 'run-regardless' ? ' on' : ''), type: 'button',
        onclick: () => intent('discipline', { discipline: 'run-regardless' })
      }, 'Run regardless')));
    main.append(el('p', { class: 'sub-p quiet' },
      'The works manager provisions lanes and builds the next obvious thing. It never advances a tier '
      + 'and it never touches a consent gate, because those are the two decisions this simulation is '
      + 'not allowed to make. ' + s.power.note));

    main.append(el('div', { class: 'sub-h' }, 'Recently, in the twin'));
    if (!s.events.length) main.append(el('p', { class: 'sub-p quiet' }, 'Nothing yet.'));
    for (const e of s.events) {
      main.append(el('div', { class: 'sub-event' },
        el('i', {}, e.kind || 'note'), el('span', {}, e.text)));
    }
  };

  /* ---- lines ------------------------------------------------------------- */

  VIEWS.lines = () => {
    const s = S();
    if (!s) return notLoaded();
    main.append(el('div', { class: 'sub-h' }, 'Throughput on every link'));
    main.append(el('p', { class: 'sub-p' }, s.trunk.note));

    const trunkRow = el('div', { class: 'sub-trunk' },
      trunkBox('Solids down the bore', s.trunk.solidLanes, s.trunk.solidKgMin, s.trunk.solidPct, 'solid'),
      trunkBox('Fluids down the bore', s.trunk.fluidLanes, s.trunk.fluidKgMin, s.trunk.fluidPct, 'fluid'));
    main.append(trunkRow);

    if (!s.lines.length) {
      main.append(el('p', { class: 'sub-p' }, 'Nothing is moving yet, so there are no lines to show.'));
      return;
    }
    const t = el('table', { class: 'sub-table wide' });
    t.append(el('tr', {},
      el('th', {}, 'Line'),
      el('th', {}, 'At'),
      el('th', { class: 'n' }, 'Flow'),
      el('th', { class: 'n' }, 'Capacity'),
      el('th', { class: 'n' }, 'Used'),
      el('th', {}, '')));
    for (const l of s.lines) {
      const tone = l.pct >= 98 ? 'bad' : l.pct >= 80 ? 'warn' : '';
      t.append(el('tr', { class: tone },
        el('td', {}, el('b', {}, l.resourceName), el('em', {}, ' ' + l.dir + ', ' + l.conveyance
          + (l.lanes > 1 ? ' ×' + l.lanes : ''))),
        el('td', {}, l.buildingName),
        el('td', { class: 'n' }, n1(l.flowKgMin) + ' kg/min'),
        el('td', { class: 'n' }, n1(l.capacityKgMin) + ' kg/min'),
        el('td', { class: 'n ' + tone }, l.pct + '%'),
        el('td', {}, l.pct >= 70 && l.lanes < 4
          ? el('button', { class: 'btn', type: 'button', onclick: () => intent('add-lane', { line: l.id }) }, 'Add a lane')
          : null)));
    }
    main.append(t);
    main.append(el('p', { class: 'sub-p quiet' },
      'A line at ninety eight per cent is the reason something upstream is backing up and something '
      + 'downstream is starved. Adding a lane is the cheapest fix and it is also the one that fills '
      + 'the bore, which is finite. Four lanes is the limit on any one line.'));

    main.append(el('div', { class: 'sub-h' }, 'What is running'));
    const m = el('table', { class: 'sub-table wide' });
    m.append(el('tr', {},
      el('th', {}, 'Process'),
      el('th', {}, 'In'),
      el('th', { class: 'n' }, 'Units'),
      el('th', { class: 'n' }, 'Clock'),
      el('th', { class: 'n' }, 'Running at'),
      el('th', {}, 'Held by')));
    for (const mm of (s.machines || []).filter((x) => x.units > 0)) {
      const tone = mm.tripped ? 'bad' : mm.utilisation < 0.5 ? 'warn' : '';
      m.append(el('tr', { class: tone },
        el('td', {}, el('b', {}, mm.name), el('em', {}, ' proposed, tier ' + mm.tier)),
        el('td', {}, mm.building),
        el('td', { class: 'n' }, String(mm.units)),
        el('td', { class: 'n' },
          el('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: mm.rate > 0 ? 1 : 1,
            class: 'sub-clock',
            onchange: (e) => intent('clock', { id: mm.id, clock: Number(e.target.value) })
          })),
        el('td', { class: 'n ' + tone }, pctOf(mm.utilisation)),
        el('td', {}, mm.tripped ? 'tripped by the power discipline' : (mm.limit + (mm.why ? ': ' + mm.why : '')))));
    }
    main.append(m);
  };

  function trunkBox(label, lanes, flow, pct, what) {
    return el('div', { class: 'sub-trunkbox' },
      el('b', {}, label),
      el('div', { class: 'meter thick ' + (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '') },
        el('i', { style: { width: clamp(pct, 0, 100) + '%' } })),
      el('span', {}, lanes + ' lane' + (lanes === 1 ? '' : 's') + ', ' + n1(flow) + ' kg a minute, ' + pct + '% used'),
      el('button', { class: 'btn', type: 'button', onclick: () => intent('trunk', { what }) }, 'Add a lane'));
  }

  /* ---- power ------------------------------------------------------------- */

  VIEWS.power = () => {
    const s = S();
    if (!s) return notLoaded();
    const P = s.power;
    main.append(el('div', { class: 'sub-h' }, 'Power'));

    if (P.brownout) {
      main.append(el('div', { class: 'sub-alarm' },
        el('b', {}, 'Brownout'),
        el('span', {}, 'The works are drawing ' + n1(P.demandKw) + ' kW against ' + n1(P.ownGenerationKw)
          + ' kW of their own generation, and the island cable is short by ' + n1(P.deficitKw) + ' kW. '
          + (P.trippedIds.length ? P.trippedIds.length + ' processes have been tripped.' : ''))));
    }

    const t = el('table', { class: 'sub-table' });
    const line = (k, v, tone) => t.append(el('tr', {}, el('th', {}, k), el('td', { class: tone || '' }, v)));
    line('Connected load, everything built', n1(s.connectedLoadKw) + ' kW');
    line('Drawing now', n1(P.demandKw) + ' kW');
    line('Own generation', n1(P.ownGenerationKw) + ' kW', P.ownGenerationKw > 0 ? 'good' : 'bad');
    line('Off the island cable', n1(P.gridDrawKw) + ' kW');
    line('Headroom on the cable', n1(P.headroomKw) + ' kW', P.headroomKw < 200 ? 'warn' : 'good');
    line('Utilisation', pctOf(s.utilisation));
    line('Discipline', P.discipline === 'protect-the-island' ? 'the works trip before the island does' : 'the load goes on the cable');
    main.append(t);
    main.append(el('p', { class: 'sub-p quiet' }, P.note));

    main.append(el('div', { class: 'sub-h' }, 'Storage'));
    const st = el('div', { class: 'sub-cards' },
      storeCard('Sand battery, thermal', s.storage.sandBatteryKwhTh, 'kWh thermal', s.storage.sandBatteryPct),
      storeCard('Pumped hydro', s.storage.hydroKwh, 'kWh', s.storage.hydroPct));
    main.append(st);

    if (s.packSting) {
      main.append(el('div', { class: 'sub-h' }, 'The arithmetic, in the pack\'s own words'));
      main.append(el('div', { class: 'sub-sting' },
        el('p', {}, s.packSting.note),
        el('p', {}, s.packSting.worstOffenders),
        el('p', { class: 'lesson' }, s.packSting.forPlay)));
      const st2 = el('table', { class: 'sub-table' });
      const l2 = (k, v) => st2.append(el('tr', {}, el('th', {}, k), el('td', {}, v)));
      l2('Every process at tier three', n1(s.packSting.totalConnectedKw) + ' kW connected');
      l2('Generation described in the pack', n1(s.packSting.totalGeneratingKw) + ' kW');
      l2('Island demand, estimated', n1(s.packSting.islandDemandKwhDay) + ' kWh a day');
      l2('Rooftops could carry', n1(s.packSting.rooftopKwhDay) + ' kWh a day');
      main.append(st2);
    }
  };

  function storeCard(label, value, unit, pct) {
    return el('div', { class: 'sub-card' },
      el('b', {}, label),
      el('div', { class: 'v' }, n1(value), el('small', {}, ' ' + unit)),
      el('div', { class: 'meter' }, el('i', { style: { width: clamp(pct || 0, 0, 100) + '%' } })),
      el('span', {}, Math.round(pct || 0) + '% full'));
  }

  /* ---- heat -------------------------------------------------------------- */

  VIEWS.heat = () => {
    const s = S();
    if (!s) return notLoaded();
    const H = s.heat;
    main.append(el('div', { class: 'sub-h' }, 'Waste heat'));
    main.append(el('p', { class: 'sub-p' },
      'Underground there is no sky to throw heat at. Every kilowatt a machine rejects goes into the '
      + 'sand it is standing in, and warm sand derates the machines. The cascade is the answer: the '
      + 'hot process feeds the warm one, and only what nothing can use goes into the ground.'));

    const t = el('table', { class: 'sub-table' });
    const line = (k, v, tone) => t.append(el('tr', {}, el('th', {}, k), el('td', { class: tone || '' }, v)));
    line('Rejected', n1(H.rejectKw) + ' kW');
    line('Delivered into the cascade', n1(H.deliveredKw) + ' kW', H.deliveredKw > 0 ? 'good' : '');
    line('Wanted by something', n1(H.demandKw) + ' kW');
    line('Short by', n1(H.shortfallKw) + ' kW', H.shortfallKw > 0 ? 'warn' : 'good');
    line('Ground temperature', n1(H.groundC) + ' °C');
    line('Lift above ambient', n1(H.groundLiftK) + ' K', H.groundLiftK > 4 ? 'bad' : H.groundLiftK > 1.5 ? 'warn' : 'good');
    line('Machines derated to', pctOf(H.derate), H.derate < 0.95 ? 'warn' : 'good');
    line('Cold available', n1(H.coldKwTh) + ' kW thermal');
    main.append(t);

    main.append(el('div', { class: 'sub-h' }, 'The cascade, by grade'));
    const g = el('table', { class: 'sub-table wide' });
    g.append(el('tr', {},
      el('th', {}, 'Grade'),
      el('th', { class: 'n' }, 'Supply'),
      el('th', { class: 'n' }, 'Demand'),
      el('th', { class: 'n' }, 'Delivered'),
      el('th', { class: 'n' }, 'Met')));
    for (const b of H.buses || []) {
      g.append(el('tr', { class: b.metPct < 60 ? 'warn' : '' },
        el('td', {}, el('b', {}, b.id), el('em', {}, ' ' + b.label)),
        el('td', { class: 'n' }, n1(b.supplyKw) + ' kW'),
        el('td', { class: 'n' }, n1(b.demandKw) + ' kW'),
        el('td', { class: 'n' }, n1(b.deliveredKw) + ' kW'),
        el('td', { class: 'n' }, Math.round(b.metPct) + '%')));
    }
    main.append(g);
    main.append(el('p', { class: 'sub-p quiet' }, H.note));
  };

  /* ---- material ---------------------------------------------------------- */

  VIEWS.material = () => {
    const s = S();
    if (!s) return notLoaded();

    main.append(el('div', { class: 'sub-h' }, 'Byproducts with nowhere to go'));
    main.append(el('p', { class: 'sub-p' },
      'The pack calls these the orphan streams and says the honest goal for the list is nothing. It '
      + 'is not nothing. A stream that fills its store stops the process that makes it, which is the '
      + 'design refusing to pretend the problem away.'));
    if (!s.orphans.length) {
      main.append(el('p', { class: 'sub-p quiet' }, 'None accumulating yet.'));
    } else {
      const t = el('table', { class: 'sub-table wide' });
      t.append(el('tr', {},
        el('th', {}, 'Stream'),
        el('th', { class: 'n' }, 'Held'),
        el('th', { class: 'n' }, 'Store'),
        el('th', {}, 'What it is')));
      for (const o of s.orphans) {
        const tone = o.pct >= 90 ? 'bad' : o.pct >= 60 ? 'warn' : '';
        t.append(el('tr', { class: tone },
          el('td', {}, el('b', {}, o.name), o.hazard ? el('em', {}, ' ' + o.hazard) : null),
          el('td', { class: 'n' }, kg(o.kg)),
          el('td', { class: 'n ' + tone }, o.pct === null ? '–' : o.pct + '%'),
          el('td', { class: 'wrap' }, o.note || '')));
      }
      main.append(t);
    }

    if (s.zeroWasteAudit) {
      const a = s.zeroWasteAudit;
      main.append(el('div', { class: 'sub-h' }, 'The zero waste audit'));
      main.append(el('p', { class: 'sub-p' },
        a.streams + ' streams in the graph. ' + a.withDestination + ' have a destination and '
        + a.withNoFate + ' do not. The pack itself names ' + a.packOrphanCount + '.'));
      main.append(el('p', { class: 'sub-p quiet' }, a.note));
    }

    if (s.unsourcedInputs && s.unsourcedInputs.length) {
      main.append(el('div', { class: 'sub-h' }, 'Inputs nothing in the graph makes'));
      main.append(el('p', { class: 'sub-p' },
        'Consumed by the design and produced by nothing in it. These arrive on a barge, and a closed '
        + 'loop with ' + s.unsourcedInputs.length + ' holes in it is not a closed loop. The pack names '
        + s.unsourcedInputs.filter((u) => u.namedByPack).length + ' of them itself.'));
      const t = el('table', { class: 'sub-table wide' });
      t.append(el('tr', {}, el('th', {}, 'Input'), el('th', { class: 'n' }, 'Consumed'), el('th', {}, 'Named by the pack')));
      for (const u of s.unsourcedInputs) {
        t.append(el('tr', {},
          el('td', {}, u.name),
          el('td', { class: 'n' }, n1(u.consumedKgMin) + ' kg/min'),
          el('td', {}, u.namedByPack ? 'yes' : 'no, this build found it')));
      }
      main.append(t);
    }

    main.append(el('div', { class: 'sub-h' }, 'Residual to landfill'));
    main.append(el('p', { class: 'sub-p' },
      kg(s.residualToLandfillKg) + ' over the last year of the twin. One of the three numbers the pack '
      + 'says to put on the panel, and it is on the strip at the top of this board for that reason.'));

    if (s.chlorine) {
      main.append(el('div', { class: 'sub-h' }, 'The chlorine balance'));
      main.append(el('p', { class: 'sub-p quiet' }, s.chlorine.note));
      const t = el('table', { class: 'sub-table' });
      const l = (k, v) => t.append(el('tr', {}, el('th', {}, k), el('td', {}, v)));
      l('Made', n1(s.chlorine.madeKgMin) + ' kg/min');
      l('Used', n1(s.chlorine.usedKgMin) + ' kg/min');
      l('Short by', n1(s.chlorine.shortfallKgMin) + ' kg/min');
      l('Closes', s.chlorine.closes === null ? 'nothing is using it yet' : s.chlorine.closes ? 'yes, within 12 per cent' : 'no');
      main.append(t);
    }
  };

  /* ---- consent ----------------------------------------------------------- */

  VIEWS.consent = () => {
    const s = S();
    if (!s) return notLoaded();

    main.append(el('div', { class: 'sub-country' },
      el('b', {}, 'Quandamooka Country'),
      el('p', {}, s.country),
      el('p', { class: 'quiet' }, s.notAMiningProposal)));

    main.append(el('div', { class: 'sub-h' }, 'The scenario'));
    main.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn' + (s.scenario === 'as-it-stands' ? ' on' : ''), type: 'button',
        onclick: () => intent('scenario', { scenario: 'as-it-stands' })
      }, 'As it stands'),
      el('button', {
        class: 'btn' + (s.scenario === 'consent-given' ? ' on' : ''), type: 'button',
        onclick: () => intent('scenario', { scenario: 'consent-given' })
      }, 'Assume consent'),
      el('button', {
        class: 'btn' + (s.scenario === 'consent-refused' ? ' on' : ''), type: 'button',
        onclick: () => intent('scenario', { scenario: 'consent-refused' })
      }, 'Assume it is refused')));
    main.append(el('p', { class: 'sub-p' }, s.scenarioNote));
    main.append(el('p', { class: 'sub-p quiet' },
      'Both branches are worth playing and the refused one is the more interesting of the two. The '
      + 'pack is plain about it: if the answer is no, or not here, or not yet, that is the answer and '
      + 'it is a good one to hear.'));

    main.append(el('div', { class: 'sub-h' }, 'The gates'));
    const gates = Object.values(s.gates || {});
    const notOurs = gates.filter((g) => g.kind === 'not-ours');
    const rest = gates.filter((g) => g.kind !== 'not-ours');
    for (const g of notOurs.concat(rest)) {
      const tone = GATE_STATE_TONE[g.state] || 'iron';
      const card = el('div', { class: 'sub-gate ' + tone },
        el('div', { class: 'sub-gate-h' },
          el('b', {}, g.name),
          el('span', { class: 'chip ' + tone }, g.state)),
        el('div', { class: 'sub-gate-who' }, 'Held by ' + (g.heldBy || 'unknown')),
        g.note ? el('p', {}, g.note) : null,
        g.detail ? el('p', { class: 'quiet' }, g.detail) : null);
      if (g.readiness && g.readiness.length) {
        const ul = el('div', { class: 'sub-ready' });
        for (const r of g.readiness) {
          ul.append(el('div', { class: 'sub-ready-i' + (r.ok ? ' ok' : '') },
            el('i', {}, r.ok ? '✓' : '·'), el('span', {}, r.text)));
        }
        card.append(el('div', { class: 'sub-ready-h' }, 'What would have to be true before the question could honestly be asked'), ul);
      }
      if (g.kind === 'regulated' && g.state === 'not sought') {
        card.append(el('button', {
          class: 'btn', type: 'button', onclick: () => intent('seek', { gate: g.id })
        }, 'Start the process'));
      }
      main.append(card);
    }
  };

  /* ---- tiers ------------------------------------------------------------- */

  VIEWS.tiers = () => {
    const s = S();
    if (!s) return notLoaded();
    main.append(el('div', { class: 'sub-h' }, 'The four rungs'));
    main.append(el('p', { class: 'sub-p' },
      'A tier opens when every condition on it is recorded as met. Nothing about that makes any of it '
      + 'real, and it never opens because a player clicked something: the conditions are read off the '
      + 'state of the twin and off gates that belong to other people.'));

    for (const t of s.tiers || []) {
      const card = el('div', { class: 'sub-tier' + (t.open ? ' open' : '') + (t.tier === s.tier ? ' now' : '') },
        el('div', { class: 'sub-tier-h' },
          el('i', {}, String(t.tier)),
          el('div', {},
            el('b', {}, t.name),
            el('span', {}, t.lane + ' lane, ' + t.register)),
          el('span', { class: 'chip ' + (t.open ? 'leaf' : 'iron') },
            t.open ? (t.tier === s.tier ? 'current' : 'open') : t.conditionsMet + ' of ' + t.conditionsTotal)),
        el('p', {}, t.summary));
      const conds = el('div', { class: 'sub-conds' });
      for (const c of t.conditions || []) {
        conds.append(el('div', { class: 'sub-cond' + (c.ok ? ' ok' : '') },
          el('i', {}, c.ok ? '✓' : '·'), el('span', {}, c.text)));
      }
      card.append(conds);
      if (t.completionTest) {
        card.append(el('div', { class: 'sub-test' }, el('b', {}, 'Finished when: '), el('span', {}, t.completionTest)));
      }
      main.append(card);
    }

    main.append(el('div', { class: 'sub-h' }, 'What is proposed, and where it would go'));
    main.append(el('p', { class: 'sub-p quiet' }, s.siting.basis));
    const t2 = el('table', { class: 'sub-table wide' });
    t2.append(el('tr', {},
      el('th', {}, 'Building'),
      el('th', { class: 'n' }, 'Tier'),
      el('th', { class: 'n' }, 'Depth'),
      el('th', { class: 'n' }, 'Load'),
      el('th', { class: 'n' }, 'Cost'),
      el('th', {}, 'State')));
    for (const b of (s.buildings || []).slice().sort((a, c) => a.tier - c.tier || (a.id < c.id ? -1 : 1))) {
      t2.append(el('tr', { class: b.units > 0 ? 'good' : '' },
        el('td', {}, el('b', {}, b.name), el('em', {}, ' proposed'), b.belowWaterTable ? el('em', { class: 'warn' }, ' below the water table') : null),
        el('td', { class: 'n' }, String(b.tier)),
        el('td', { class: 'n' }, b.surface ? 'surface' : b.depthM + ' m'),
        el('td', { class: 'n' }, n1(b.connectedKw) + ' kW'),
        el('td', { class: 'n' }, money(b.costA$)),
        el('td', {}, b.units > 0
          ? el('span', {}, b.units + ' built in the twin')
          : (b.blocked
            ? el('span', { class: 'sub-blocked' }, b.blocked)
            : el('button', { class: 'btn', type: 'button', onclick: () => intent('build', { id: b.id }) }, 'Stand it up in the twin')))));
    }
    main.append(t2);
    main.append(el('p', { class: 'sub-p quiet' },
      'Standing something up in the twin is a modelling act. It changes what this simulation runs and '
      + 'it changes nothing on Minjerribah. There is no version of this panel where it does.'));
  };

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
  s.id = 'sub-style';
  s.textContent = `
.sub-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.sub-scrim.on { opacity: 1; pointer-events: auto; }
.sub-board { position: fixed; inset: 3vh 2.2vw; z-index: 41; display: flex; flex-direction: column;
  max-width: 1680px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.sub-board.on { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 860px) { .sub-board { inset: 0; border-radius: 0; } }

/* The marker. Not dismissible, not part of the scrolling content, and above the board so it is in
   any screenshot that contains any of this. */
.sub-badge { position: fixed; top: 0; left: 0; right: 0; z-index: 62; display: none;
  align-items: baseline; gap: var(--sp-3); padding: 7px var(--sp-5);
  background: repeating-linear-gradient(135deg, rgba(226,114,91,.28) 0 14px, rgba(226,114,91,.14) 14px 28px);
  border-bottom: 1px solid rgba(226,114,91,.6); pointer-events: none; }
.sub-badge.on { display: flex; }
.sub-badge b { font: 700 var(--fs-label)/1.4 var(--f-ui); letter-spacing: .28em; color: #ffd9cf; flex: none; }
.sub-badge span { font-size: var(--fs-sm); line-height: 1.4; color: #f6ded6; }

.sub-banner { display: flex; align-items: baseline; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4);
  background: rgba(226,114,91,.13); border-bottom: 1px solid rgba(226,114,91,.42); flex: none; }
.sub-banner b { font: 700 var(--fs-label)/1.4 var(--f-ui); letter-spacing: .26em; color: var(--coral); flex: none; }
.sub-banner span { font-size: var(--fs-sm); line-height: 1.5; color: var(--t); }

.sub-top { display: flex; align-items: flex-start; gap: var(--sp-5); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); }
.sub-title h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.sub-sub { font-size: var(--fs-sm); color: var(--t-faint); }
.sub-strip { display: flex; gap: var(--sp-5); margin-left: auto; }
.sub-top > button { flex: none; }
.sub-main { flex: 1; min-height: 0; padding: var(--sp-4); }

.sub-h { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--t-faint);
  font-weight: 600; margin: var(--sp-5) 0 var(--sp-2); }
.sub-h:first-child { margin-top: 0; }
.sub-p { font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); margin-bottom: var(--sp-3); max-width: 92ch; }
.sub-p.quiet { color: var(--t-faint); font-size: var(--fs-micro); line-height: 1.7; }

.sub-diag { border-left: 3px solid var(--sun); background: rgba(240,180,41,.09); padding: var(--sp-3) var(--sp-4);
  border-radius: 0 var(--r-2) var(--r-2) 0; margin-bottom: var(--sp-3); }
.sub-diag b { display: block; color: var(--t-hi); font-weight: 400; font-size: var(--fs-lg); line-height: 1.5; }
.sub-diag span { display: block; font-size: var(--fs-sm); color: var(--t-faint); margin-top: 5px; }

.sub-chain { display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.sub-hop { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--edge); border-radius: var(--r-2); background: rgba(255,255,255,.022); }
.sub-hop.end { border-color: rgba(226,114,91,.5); background: rgba(226,114,91,.07); }
.sub-hop i { flex: none; width: 20px; height: 20px; border-radius: 50%; background: var(--s-sunk);
  border: 1px solid var(--edge-strong); font: 600 var(--fs-micro)/19px var(--f-num); text-align: center;
  font-style: normal; color: var(--t-dim); }
.sub-hop b { display: block; color: var(--t-hi); font-weight: 500; font-size: var(--fs-sm); }
.sub-hop span { display: block; font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.55; }
.sub-hop .meter { margin-top: 5px; width: 160px; }

.sub-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin-bottom: var(--sp-3); }
.sub-table.wide th, .sub-table.wide td { padding: 5px var(--sp-3) 5px 0; }
.sub-table th { text-align: left; font-weight: 400; color: var(--t-faint); padding: 4px var(--sp-3) 4px 0;
  border-bottom: 1px solid rgba(232,220,196,.07); vertical-align: top; white-space: nowrap; }
.sub-table td { padding: 4px 0; color: var(--t-hi); border-bottom: 1px solid rgba(232,220,196,.05);
  vertical-align: top; }
.sub-table td.wrap { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.55; white-space: normal; }
.sub-table th.n, .sub-table td.n { text-align: right; font-family: var(--f-num);
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.sub-table td b { font-weight: 500; }
.sub-table td em { font-style: normal; font-size: var(--fs-micro); color: var(--t-faint); }
.sub-table td em.warn { color: var(--sun); }
.sub-table tr.warn td, .sub-table td.warn { color: var(--sun); }
.sub-table tr.bad td, .sub-table td.bad { color: var(--coral); }
.sub-table td.good { color: var(--leaf); }
.sub-table tr.good td b { color: var(--leaf); }
.sub-blocked { font-size: var(--fs-micro); color: var(--t-faint); }

.sub-trunk { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--sp-3);
  margin-bottom: var(--sp-4); }
.sub-trunkbox { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3); }
.sub-trunkbox b { display: block; color: var(--t-hi); font-weight: 500; margin-bottom: var(--sp-2); }
.sub-trunkbox span { display: block; font: 400 var(--fs-micro)/1.6 var(--f-num); color: var(--t-faint); margin: 5px 0 var(--sp-2); }

.sub-clock { width: 84px; appearance: none; height: 3px; border-radius: var(--r-pill);
  background: var(--s-sunk); outline: none; cursor: pointer; }
.sub-clock::-webkit-slider-thumb { appearance: none; width: 11px; height: 11px; border-radius: 50%;
  background: var(--sea); border: 2px solid var(--s-1); cursor: pointer; }

.sub-alarm { border: 1px solid var(--coral); border-left-width: 3px; background: rgba(226,114,91,.10);
  border-radius: var(--r-2); padding: var(--sp-3); margin-bottom: var(--sp-3); }
.sub-alarm b { display: block; color: var(--coral); letter-spacing: .1em; text-transform: uppercase;
  font-size: var(--fs-micro); font-weight: 700; }
.sub-alarm span { display: block; font-size: var(--fs-sm); line-height: 1.55; color: var(--t); margin-top: 4px; }

.sub-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--sp-3);
  margin-bottom: var(--sp-3); }
.sub-card { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3); }
.sub-card b { display: block; font-size: var(--fs-micro); letter-spacing: .12em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; }
.sub-card .v { font: 300 var(--fs-xl)/1.2 var(--f-num); color: var(--t-hi); margin: 4px 0 var(--sp-2); }
.sub-card .v small { font-size: .55em; color: var(--t-dim); }
.sub-card span { display: block; font-size: var(--fs-micro); color: var(--t-faint); margin-top: 5px; }

.sub-sting { border-left: 3px solid var(--sun); padding: var(--sp-3) var(--sp-4); background: rgba(240,180,41,.06);
  border-radius: 0 var(--r-2) var(--r-2) 0; margin-bottom: var(--sp-3); }
.sub-sting p { font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); margin-bottom: var(--sp-2); }
.sub-sting p.lesson { color: var(--sun); }

.sub-event { display: flex; gap: var(--sp-3); padding: 5px 0; border-bottom: 1px dashed var(--edge);
  font-size: var(--fs-sm); color: var(--t-dim); line-height: 1.55; }
.sub-event i { flex: none; width: 74px; font-style: normal; font-size: 9px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--t-faint); padding-top: 3px; }
.sub-block { border-left: 2px solid var(--coral); padding: 5px var(--sp-3); margin-bottom: 4px;
  background: rgba(226,114,91,.07); font-size: var(--fs-sm); color: var(--t); }

.sub-country { border: 1px solid var(--heath); border-left-width: 3px; background: rgba(180,138,196,.09);
  border-radius: var(--r-2); padding: var(--sp-4); margin-bottom: var(--sp-4); }
.sub-country b { display: block; font: 600 var(--fs-label)/1 var(--f-ui); letter-spacing: .22em;
  text-transform: uppercase; color: var(--heath); margin-bottom: var(--sp-3); }
.sub-country p { font-size: var(--fs-sm); line-height: 1.7; color: var(--t); margin-bottom: var(--sp-2); max-width: 96ch; }
.sub-country p.quiet { color: var(--t-faint); font-size: var(--fs-micro); }

.sub-gate { border: 1px solid var(--edge); border-left-width: 3px; border-radius: var(--r-2);
  padding: var(--sp-3); margin-bottom: var(--sp-3); }
.sub-gate.coral { border-left-color: var(--coral); }
.sub-gate.leaf { border-left-color: var(--leaf); }
.sub-gate.sun { border-left-color: var(--sun); }
.sub-gate.heath { border-left-color: var(--heath); }
.sub-gate.iron { border-left-color: var(--iron); }
.sub-gate-h { display: flex; align-items: center; gap: var(--sp-3); }
.sub-gate-h b { flex: 1; color: var(--t-hi); font-weight: 500; }
.sub-gate-who { font-size: var(--fs-micro); letter-spacing: .06em; color: var(--sea); margin-top: 3px; }
.sub-gate p { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); margin-top: var(--sp-2); max-width: 96ch; }
.sub-gate p.quiet { color: var(--t-faint); font-size: var(--fs-micro); }
.sub-gate .btn { margin-top: var(--sp-3); }
.sub-ready-h { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--t-faint);
  margin: var(--sp-3) 0 var(--sp-2); }
.sub-ready-i, .sub-cond { display: flex; gap: var(--sp-2); align-items: flex-start; padding: 3px 0;
  font-size: var(--fs-sm); color: var(--t-faint); line-height: 1.55; }
.sub-ready-i i, .sub-cond i { flex: none; width: 14px; font-style: normal; color: var(--t-faint); text-align: center; }
.sub-ready-i.ok, .sub-cond.ok { color: var(--t); }
.sub-ready-i.ok i, .sub-cond.ok i { color: var(--leaf); }

.sub-tier { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3);
  margin-bottom: var(--sp-3); opacity: .74; }
.sub-tier.open { opacity: 1; }
.sub-tier.now { border-color: var(--sea); background: rgba(63,182,196,.06); }
.sub-tier-h { display: flex; align-items: center; gap: var(--sp-3); }
.sub-tier-h i { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--edge-strong);
  font: 300 var(--fs-lg)/25px var(--f-num); font-style: normal; text-align: center; color: var(--t-dim); }
.sub-tier-h > div { flex: 1; }
.sub-tier-h b { display: block; color: var(--t-hi); font-weight: 500; }
.sub-tier-h span { display: block; font-size: var(--fs-micro); color: var(--t-faint); letter-spacing: .06em; }
.sub-tier p { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); margin: var(--sp-2) 0; max-width: 96ch; }
.sub-conds { margin-top: var(--sp-2); }
.sub-test { margin-top: var(--sp-2); padding-top: var(--sp-2); border-top: 1px solid var(--edge); }
.sub-test b { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--t-faint);
  margin-right: var(--sp-2); }
.sub-test span { font-size: var(--fs-micro); color: var(--t-dim); line-height: 1.6; }

@media (max-width: 1100px) { .sub-strip { margin-left: 0; flex-wrap: wrap; gap: var(--sp-4); }
  .sub-top { flex-wrap: wrap; } }
`;
  document.head.appendChild(s);
}
