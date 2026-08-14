// Arrival. What a person sees opening this having never heard of it.
//
// Four moments, in this order, and the order is the whole design.
//
//   1. THE ACKNOWLEDGEMENT. Its own screen, its own minute, nothing else on it and no timer
//      pushing you off it. data/lore.json is the gate for every word of it: the text is the
//      exact string at acknowledgement.game_wording.long.text and it is not paraphrased,
//      shortened, decorated or turned into an icon here. The pack's own rules are explicit and
//      this file obeys all four: never abbreviate it, never put it behind a menu the player has
//      to find, never write it in first person plural on behalf of Quandamooka People, and never
//      generate a Welcome to Country, because a Welcome can only be given by a Traditional Owner
//      and an acknowledgement is what a visitor gives. The sources sit one click away, which is
//      the advisory rule `language-words-need-a-flagged-source` in the same pack.
//
//   2. THE ARRIVAL. Where this is and what it is for. The island's real numbers, read out of
//      world.island and the population read model rather than typed in here, so the screen
//      cannot drift from the simulation behind it. Then the six purposes, one line each.
//
//   3. WHERE TO START. Three doors, and each one is a real thing the camera and the clock can
//      actually do: the barge run in to Dunwich, the headland walk at the Gorge, or the whole
//      island from the planner. The Gorge door reads the whale system and tells you the truth
//      about what is out there today rather than promising humpbacks in March.
//
//   4. THE HANDOVER. The keys, once, and then it gets out of the way.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not explain the machine. Four screens is the
// right length for arriving somewhere and the wrong length for how the clock has two modes, what a
// synced record's freshness date means, or why nineteen of the sixty-two civic levers are yours and
// forty-three are not. That is `src/ui/panels/howitworks.js`, seven sections on a sheet with the
// island still visible behind it and the camera pointed at whatever is being described, reachable
// with `Y`, from the third door below, from the handover, and from Settings. The one idea that
// appears in both, because it is the one a person must be able to use on sight, is the difference
// between real, modelled and proposed.
//
// AFTER THAT: CONTEXTUAL HINTS. Not a tutorial and not a checklist. Each hint has a condition
// that has to be true on this island right now, appears once ever, is remembered in
// localStorage, and never appears while a board is open or while another hint is up. There is a
// floor of four minutes of real time between any two, so a busy hour on the ferry cannot turn
// into a stack of advice. Every one of them names a real threshold from a real system, so
// reading one teaches you something about Minjerribah rather than about this interface.
//
// Skippable at every step. Never shows twice unless asked: `?` reopens it, and so does the
// button in the settings panel.

import { registerPanel, el } from '../mount.js';
import { lightGate } from './howitworks.js';

/* ------------------------------------------------------------------ storage */

const SEEN_KEY = 'twin.onboarding.seen';
const HINT_KEY = 'twin.onboarding.hints';

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
}
function writeSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private browsing is fine */ }
}
function readHints() {
  try { return new Set(JSON.parse(localStorage.getItem(HINT_KEY) || '[]')); } catch (e) { return new Set(); }
}
function writeHints(set) {
  try { localStorage.setItem(HINT_KEY, JSON.stringify([...set])); } catch (e) { /* fine */ }
}

/* ------------------------------------------------------------------ safe reads */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function num(v, dp = 0) { return isNum(v) ? v.toFixed(dp) : '–'; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** The acknowledgement, its rules and its sources, straight out of the pack. Never assembled. */
function lorePack(world) {
  return (world.data && world.data.lore) || null;
}

/* ------------------------------------------------------------------ the six purposes

   One line each, plain, no reference games named and nothing claimed that the island does not
   already do. Each names the panel or key that opens it, so the list is also a map. */

const PURPOSES = [
  ['Civic planning', 'Sixty-two real levers, and most of them are not yours to pull. Press G.'],
  ['Island life', 'Two thousand residents in nine hundred and seventy households, with jobs, needs and neighbours. Click one.'],
  ['Events and crowds', 'The barge queue on a long weekend, the carpark that fills by eight. Press E.'],
  ['Stewardship', 'Dunes, koalas, whales, the lakes, the water table, fire. Press V for the info views.'],
  ['A drama series', 'Small true stories about the people who live here, written from what actually happened. Press J.'],
  ['The works below the sand', 'A proposed underground eco city, run as a production graph. Nothing in it exists. Press U.']
];

/* ------------------------------------------------------------------ contextual hints

   A hint fires on one of two things: `when(world)`, a condition that has to be true of the island
   right now, or `event`, a bus message the simulation actually emitted. Nothing here fires on a
   timer and nothing fires twice. The thresholds quoted in the copy are the real ones out of the
   real systems, so a hint teaches the island rather than the interface. */

const HINTS = [
  {
    id: 'beach-tide-gate',
    title: 'The beach is a road, and the tide shuts it',
    body: 'Main Beach and Flinders Beach are closed to vehicles for two hours either side of high '
      + 'water. That gate has just shut. The window is set by Minjerribah Camping, which issues and '
      + 'enforces the vehicle access permit. Press V and choose the beach access view.',
    event: 'navigation:beach-closed'
  },
  {
    id: 'crossing-rough',
    title: 'Wind against tide on the Rous',
    body: 'Past twenty two knots the crossing is rough and the barges start running late. Past thirty '
      + 'they stop. Everything that is not already here comes across that water.',
    when: (w) => {
      const wx = w.read('weather');
      return !!(wx && isNum(wx.windKt) && wx.windKt >= 22);
    }
  },
  {
    id: 'barge-cancelled',
    title: 'A sailing has been pulled',
    body: 'A cancelled vehicle sailing does not disappear. It rolls into the next one, which is '
      + 'already booked, and the chilled freight on it does not keep. Press E for the calendar.',
    when: (w) => {
      const f = w.read('ferry');
      return !!(f && f.cancellations && isNum(f.cancellations.today) && f.cancellations.today >= 1);
    }
  },
  {
    id: 'council-agenda',
    title: 'Somebody else put something up',
    body: 'That application is not yours. A body that runs part of this island brought it forward '
      + 'on its own agenda, and you cannot stop it. You can make a submission. Press G.',
    when: (w) => {
      const c = w.read('council');
      return !!(c && (c.applications || []).some((a) => a.origin === 'agenda'));
    }
  },
  {
    id: 'first-story',
    title: 'Something happened to somebody',
    body: 'The chronicle has its first entry. It is the dated record of this playthrough, written '
      + 'from what the simulation actually did. Press J.',
    when: (w) => {
      const ch = w.read('chronicle');
      return !!(ch && isNum(ch.count) && ch.count >= 1);
    }
  },
  {
    id: 'fire-danger',
    title: 'The fuel is dry',
    body: 'Above a fire danger index of twenty six the rural fire brigade volunteers start getting '
      + 'turned out, and that takes them off whatever else they had on. Above thirty nobody lights a '
      + 'planned burn.',
    when: (w) => {
      const wx = w.read('weather');
      return !!(wx && isNum(wx.fireDangerIndex) && wx.fireDangerIndex >= 26);
    }
  },
  {
    id: 'whales',
    title: 'Humpbacks off the headland',
    body: 'They pass north about July and south with calves about October, close in at Point Lookout. '
      + 'One is up off the headland now. Press V and choose the whale view, or fly to the Gorge and look.',
    when: (w) => {
      const wh = w.read('whales');
      return !!(wh && isNum(wh.visibleFromHeadland) && wh.visibleFromHeadland >= 1);
    }
  },
  {
    id: 'ferry-sold-out',
    title: 'The boat is full',
    body: 'Vehicle slots on a long weekend sell out days ahead. A resident who did not book is in the '
      + 'same queue as a day tripper who did.',
    when: (w) => {
      const f = w.read('ferry');
      return !!(f && f.deck && isNum(f.deck.slotsLeftToday) && f.deck.slotsLeftToday <= 0);
    }
  },
  {
    id: 'referral',
    title: 'The twin stops here',
    body: 'That decision belongs to a body this simulation will not model or guess at. You can leave '
      + 'it pending, which is the truthful outcome, or record your own assumption and carry the label. '
      + 'Press G and open the in tray.',
    when: (w) => {
      const c = w.read('council');
      return !!(c && (c.referrals || []).some((r) => r.status === 'open'));
    }
  },
  {
    id: 'proposed-works',
    title: 'Nothing under the sand is real',
    body: 'The subterranean works are a design being tested in this twin. Every building in that pack '
      + 'is marked proposed, none of it is consented, and the panel says so on every screen. Press U.',
    when: (w) => {
      const s = w.read('subterranean');
      return !!(s && isNum(s.built) && s.built >= 3);
    }
  }
];

/* ================================================================== the panel */

export function registerOnboardingPanel(world) {
  registerPanel({
    id: 'onboarding',
    order: 5,
    mount(root, w) { return mountOnboarding(root, w); }
  });
}

function mountOnboarding(root, world) {
  injectStyle();

  const lore = lorePack(world);
  const ack = lore && lore.acknowledgement ? lore.acknowledgement : null;
  const wording = ack && ack.game_wording ? ack.game_wording : null;

  /* ---- the overlay ------------------------------------------------------ */

  const stage = el('div', { class: 'ob-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Arrival', tabindex: '-1' });
  const sheet = el('div', { class: 'ob-sheet' });
  const dots = el('div', { class: 'ob-dots' });
  const skip = el('button', { class: 'btn ghost ob-skip', type: 'button' }, 'Skip');
  stage.append(sheet, el('div', { class: 'ob-foot' }, dots, skip));
  root.appendChild(stage);

  let step = 0;
  let open = false;
  let heldTheIsland = false;

  const STEPS = [drawAcknowledgement, drawArrival, drawDoors, drawHandover];

  function setOpen(v) {
    open = !!v;
    stage.classList.toggle('on', open);
    document.body.classList.toggle('twin-onboarding', open);
    if (open) {
      world.bus.emit('ui:drawer', { id: 'onboarding' });
      draw();
      stage.focus({ preventScroll: true });
    }
  }

  function go(n) {
    step = clamp(n, 0, STEPS.length - 1);
    draw();
  }

  function finish() {
    writeSeen();
    setOpen(false);
    // Give the island back. See the note where it is held, below: this used to leave it stopped,
    // so the first thing a person saw after reading four screens about a place that runs on its
    // own was a place that was not running.
    if (heldTheIsland) {
      heldTheIsland = false;
      try { world.clock.thaw(); } catch (e) { /* an unfrozen clock is the state we wanted anyway */ }
    }
    // The camera rig puts up its own movement card on a first run. Step four has just taught the
    // same keys with room to read them, so it is retired rather than left to appear over the top.
    const cam = document.getElementById('cam-hint');
    if (cam) cam.remove();
    try { localStorage.setItem('twin.camera.hint', '1'); } catch (e) { /* fine */ }
    // The arrival is over, so whatever else wanted the screen may have it.
    //
    // This exists for src/ui/panels/today.js, which is what the island opens as on every visit
    // after the first and must not open on top of the acknowledgement on the first. The ordering is
    // not a preference: data/lore.json's own rules say the acknowledgement is never put behind a
    // menu somebody has to find, and a noticeboard laid over it would be exactly that. So Today
    // waits for this message rather than racing a localStorage read, and nothing else in the build
    // is allowed to jump the queue either.
    world.bus.emit('onboarding:done', { skipped: step < STEPS.length - 1 });
  }

  skip.addEventListener('click', finish);

  function draw() {
    sheet.textContent = '';
    dots.textContent = '';
    for (let i = 0; i < STEPS.length; i++) {
      dots.append(el('button', {
        class: 'ob-dot' + (i === step ? ' on' : '') + (i < step ? ' done' : ''),
        type: 'button',
        'aria-label': 'Step ' + (i + 1) + ' of ' + STEPS.length,
        onclick: () => go(i)
      }));
    }
    skip.textContent = step === STEPS.length - 1 ? 'Close' : 'Skip';
    try { STEPS[step](); } catch (e) {
      sheet.append(el('p', { class: 'ob-p' }, 'This screen could not be drawn: ' + (e && e.message)));
      console.error('[onboarding] step failed', step, e);
    }
    sheet.scrollTop = 0;
  }

  /* ---- step 1: the acknowledgement -------------------------------------- */

  function drawAcknowledgement() {
    sheet.classList.add('ack');
    const text = wording && wording.long ? wording.long.text : null;

    sheet.append(el('div', { class: 'ob-place' }, 'Quandamooka Country'));

    if (text) {
      // The exact string from the pack. Split on sentences for line length only: not one word of
      // it is changed, reordered, shortened or added to.
      const sentences = text.match(/[^.]+\.\s*/g) || [text];
      const body = el('div', { class: 'ob-ack' });
      for (const s of sentences) body.append(el('p', {}, s.trim()));
      sheet.append(body);
    } else {
      sheet.append(el('p', { class: 'ob-p warn' },
        'data/lore.json did not load, so the acknowledgement it holds cannot be shown. That is a '
        + 'fault in this build and not a choice. Nothing else here should be read until it is fixed.'));
    }

    // The boundary, on the surface rather than inside the fold below it. A person should not have
    // to open a disclosure triangle to find out that the Traditional Owner corporation has not seen
    // this. Each line is a statement of what this project refuses to do, and every one of them is
    // enforced somewhere: the first by data/lore.json's own status field, the second by the
    // prohibitions in the same pack and the scan that runs over the whole repository, the third by
    // docs/CULTURAL-REVIEW.md being a queue that nobody has answered.
    const wont = el('div', { class: 'ob-wont' },
      el('h5', {}, 'What this project will not do'),
      el('ul', {},
        el('li', {}, 'QYAC has not seen this project. Nobody has asked whether it should exist.'),
        el('li', {}, 'No language words, no story, no art, no cultural practice, no sacred or '
          + 'restricted places go into it, from any source and from any contributor, however '
          + 'offered.'),
        el('li', {}, 'The cultural review file is an open queue and not a set of approvals. Nothing '
          + 'on it is approved.')));
    sheet.append(wont);

    const details = el('details', { class: 'ob-src' },
      el('summary', {}, 'Where this wording comes from, and what it is not'));
    const inner = el('div', { class: 'ob-src-in' });

    if (ack && ack.note) inner.append(el('p', {}, ack.note));
    if (ack && ack.qyac_published_acknowledgement) {
      const q = ack.qyac_published_acknowledgement;
      inner.append(el('p', {}, 'QYAC publishes its own acknowledgement. ' + q.where + '. '
        + q.summary_of_content));
    }
    if (wording && wording.optional_line) {
      const o = wording.optional_line;
      inner.append(el('p', { class: 'quote' }, o.text));
      inner.append(el('p', { class: 'attrib' }, o.basis));
    }
    if (ack && Array.isArray(ack.rules)) {
      const ul = el('ul', {});
      for (const r of ack.rules) ul.append(el('li', {}, r));
      inner.append(el('h5', {}, 'The rules this screen is built to'), ul);
    }
    const auth = lore && lore.authority;
    if (auth) {
      inner.append(el('p', { class: 'attrib' },
        auth.body + '. ' + auth.role + ' ' + auth.rule));
    }
    if (lore && lore.status) {
      inner.append(el('p', { class: 'attrib' },
        'Status of the cultural pack behind this: ' + String(lore.status).replace(/_/g, ' ') + '. '
        + 'Everything in it is public-record material assembled for this project. Open questions are '
        + 'listed in docs/CULTURAL-REVIEW.md for a human to take to QYAC.'));
    }
    const srcs = lore && lore.sources ? lore.sources : {};
    const cite = ['qyac-sustainability', 'qyac-briefing-2015', 'qyac-native-title'].map((k) => srcs[k]).filter(Boolean);
    if (cite.length) {
      const ul = el('ul', { class: 'ob-cites' });
      for (const s of cite) ul.append(el('li', {}, s.what + (s.url ? ' (' + s.url + ')' : '')));
      inner.append(el('h5', {}, 'Sources'), ul);
    }
    details.append(inner);
    sheet.append(details);

    sheet.append(el('div', { class: 'ob-act' },
      el('button', { class: 'btn ob-go', type: 'button', onclick: () => go(1) }, 'Continue')));
  }

  /* ---- step 2: the arrival ---------------------------------------------- */

  function drawArrival() {
    sheet.classList.remove('ack');
    const isl = world.read('island') || {};
    const pop = world.read('population') || {};
    const dw = pop.dwellings || {};
    const unoccupiedPct = isNum(dw.total) && dw.total > 0 && isNum(dw.unoccupied)
      ? Math.round((dw.unoccupied / dw.total) * 100) : null;

    sheet.append(
      el('h2', {}, 'Minjerribah'),
      el('div', { class: 'ob-alt' }, 'North Stradbroke Island, Moreton Bay, south east Queensland'),
      el('p', { class: 'ob-lede' },
        'A sand island about thirty kilometres east of Brisbane, in the bay rather than out at sea. '
        + 'Three townships: Dunwich (Goompi) where the boats land, Amity Point (Pulan) on the northern '
        + 'corner, and Point Lookout (Mooloomba) on the headland. There is no bridge. Everything that '
        + 'is not already here arrives on a barge.'));

    const facts = el('div', { class: 'ob-facts' });
    const fact = (k, v, s) => facts.append(el('div', { class: 'readout' },
      el('div', { class: 'k' }, k),
      el('div', { class: 'v' }, v, s ? el('small', {}, ' ' + s) : null)));
    fact('Land', num(isl.landAreaKm2, 0), 'km²');
    fact('High point', num(isl.maxElevationM, 0), 'm');
    fact('End to end', isl.extentKm ? num(isl.extentKm.northSouth, 0) : '–', 'km');
    fact('Residents', isNum(pop.residents) ? String(pop.residents) : '–');
    fact('Households', isNum(pop.households) ? String(pop.households) : '–');
    fact('Homes with nobody in them', unoccupiedPct === null ? '–' : unoccupiedPct + '%');
    sheet.append(facts);
    sheet.append(el('p', { class: 'ob-note' },
      'Those figures are the running simulation, not a brochure. The dwelling share is the one that '
      + 'explains most of the island: about half the houses are somebody\'s second one.'));

    sheet.append(el('h3', {}, 'What this is for'));
    const list = el('div', { class: 'ob-purposes' });
    for (const [name, line] of PURPOSES) {
      list.append(el('div', { class: 'ob-purpose' },
        el('b', {}, name),
        el('span', {}, line)));
    }
    sheet.append(list);

    sheet.append(el('h3', {}, 'And what it is not'));
    sheet.append(el('p', { class: 'ob-note' },
      'Not a game about a made-up place: every business, road, beach, headland, club and boat in '
      + 'here is a real one out of a public record, and nothing was invented to fill a gap. And not '
      + 'the island either: it is a model of the island, built by people who do not live there, and '
      + 'it gets things wrong. What it can always tell you is where a number came from and how much '
      + 'weight it will hold.'));

    sheet.append(el('div', { class: 'ob-act' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => go(0) }, 'Back'),
      el('button', { class: 'btn ob-go', type: 'button', onclick: () => go(2) }, 'Continue')));
  }

  /* ---- step 3: three doors ---------------------------------------------- */

  /**
   * What is actually out there today, rather than a promise of whales. The Gorge door is only
   * worth offering if it tells the truth in March as well as in October, so this reads the whale
   * system and reports it, including when the answer is nothing.
   */
  function whaleLine() {
    const wh = world.read('whales');
    if (!wh) return 'The whale system is not loaded in this build, so there is nothing to say about what is out there.';
    const visible = isNum(wh.visibleFromHeadland) ? wh.visibleFromHeadland : null;
    const pods = isNum(wh.podsOnStage) ? wh.podsOnStage : null;
    const watching = isNum(wh.watchingFromLand) ? wh.watchingFromLand : null;
    const last = wh.lastSighting;
    if (visible) {
      return 'Right now: ' + visible + ' pod' + (visible === 1 ? '' : 's') + ' in sight of the headland'
        + (watching ? ', ' + watching + ' people on the walk watching' : '') + '.';
    }
    if (pods) {
      const bits = [pods + ' pod' + (pods === 1 ? '' : 's') + ' off this coast today, none in sight of the walk yet'];
      if (last && last.what) bits.push('Last seen from ' + last.from + ': ' + last.what + ', ' + last.day + '.');
      return bits.join('. ');
    }
    return 'Nothing off this coast at the moment. ' + (wh.season ? 'The migration is ' + wh.season + '.' : '');
  }

  /**
   * The state of the light, said before the three doors rather than after them.
   *
   * This build opens at 5:20am against a 5:39am sunrise, so two of the three doors below open on a
   * dark island. Sending somebody through one of them without a word about that is how a person
   * decides the twin is broken. The rule lives in `lightGate`, which the explainer sheet uses for
   * the same thing, so there is one answer to what counts as dark rather than two that drift.
   */
  function lightNotice() {
    let gate = null;
    try { gate = lightGate(world); } catch (e) { gate = null; }
    // Only the true dark case gets a notice here. A low sun is a line on the explainer sheet and
    // not a reason to stop somebody on their way through the door.
    if (!gate || !gate.jump) return null;
    const row = el('div', { class: 'ob-light' },
      el('b', {}, 'It is dark out there, and it is meant to be'),
      el('span', {}, gate.text));
    if (gate.jump && world.time) {
      row.append(el('button', {
        class: 'btn ob-light-go', type: 'button',
        onclick: () => {
          try { world.time.scrubBy(Math.round(gate.jump.minutes)); } catch (e) { /* the bar still tells the truth */ }
          go(2);
        }
      }, gate.jump.label));
      row.append(el('em', {}, 'That parks the clock, which the bar at the top will say. The ribbon '
        + 'up there puts it back.'));
    }
    return row;
  }

  function drawDoors() {
    sheet.classList.remove('ack');
    sheet.append(
      el('h2', {}, 'Where would you like to start'),
      el('p', { class: 'ob-lede' }, 'None of these is a tutorial. Three of them are places to stand. '
        + 'The fourth is the explanation, and you can take it whenever you like.'));

    const notice = lightNotice();
    if (notice) sheet.append(notice);

    const doors = el('div', { class: 'ob-doors' });

    doors.append(door(
      'Arrive on the barge',
      'Dunwich (Goompi)',
      'The approach every visitor makes, across the bay to the ramp at Goompi. It is the only way on '
      + 'to the island with a vehicle, and the queue on the other side is at Toondah Harbour.',
      null,
      () => {
        finish();
        try {
          if (world.camera && world.camera.cinematic) world.camera.cinematic('dunwich-arrival');
          else world.bus.emit('camera:cinematic', { shot: 'dunwich-arrival' });
        } catch (e) { console.warn('[onboarding] camera not ready', e); }
      }));

    doors.append(door(
      'Stand on the Gorge walk',
      'North Gorge, Point Lookout (Mooloomba)',
      'The headland track above the water at the eastern tip of the island. In whale season the pods '
      + 'come close enough in to watch from the path.',
      whaleLine(),
      () => {
        finish();
        try {
          if (world.camera && world.camera.cinematic) world.camera.cinematic('gorge-dawn');
          else world.bus.emit('camera:cinematic', { shot: 'gorge-dawn' });
        } catch (e) { console.warn('[onboarding] camera not ready', e); }
      }));

    doors.append(door(
      'Open the planner',
      'The whole island',
      'Thirty nine kilometres of it, from Point Lookout in the north east to Jumpinpin in the south. '
      + 'This is where the civic work happens: press V to lay data over the ground.',
      null,
      () => {
        finish();
        try {
          if (world.camera && world.camera.frameIsland) world.camera.frameIsland();
          else world.bus.emit('camera:mode:set', { mode: 'planner' });
        } catch (e) { console.warn('[onboarding] camera not ready', e); }
      }));

    // The fourth door, and the different kind of thing. It hands over to the explainer sheet, which
    // keeps the island on screen and walks the camera around it, so this is a door out of the dark
    // overlay rather than a deeper room inside it.
    const explain = el('button', {
      class: 'ob-door wide', type: 'button',
      onclick: () => { finish(); world.bus.emit('ui:open', { id: 'howitworks', section: 'what' }); }
    },
    el('b', {}, 'Have it explained first'),
    el('i', {}, 'Seven short screens, with the island in front of you'),
    el('span', {}, 'How time works and what a projection is, where every number came from, how to '
      + 'tell what is real from what is modelled and what is only proposed, which levers are '
      + 'actually yours, and how to put something of your own in. Press Y at any time.'));
    doors.append(explain);

    sheet.append(doors);
    sheet.append(el('div', { class: 'ob-act' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => go(1) }, 'Back'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => go(3) }, 'The keys first')));
  }

  function door(title, where, body, live, onGo) {
    const card = el('button', { class: 'ob-door', type: 'button', onclick: onGo },
      el('b', {}, title),
      el('i', {}, where),
      el('span', {}, body),
      live ? el('em', {}, live) : null);
    return card;
  }

  /* ---- step 4: the handover --------------------------------------------- */

  // The whole map, in the order somebody meets it. It must agree with docs/KEYS.md, which is the
  // record: a key that is bound and not on this screen is a key nobody finds.
  const KEYS = [
    ['Drag', 'hold the ground and move it'],
    ['Wheel', 'zoom, from the whole island to a street sign'],
    ['Right drag', 'orbit and tilt'],
    ['W A S D', 'pan, walk or fly'],
    ['Tab', 'planner, street, follow, drone, cinematic'],
    ['Home', 'frame the whole island'],
    ['F1 to F4', 'Dunwich, Amity Point, Point Lookout, North Gorge'],
    ['Space', 'pause, and 1 to 4 for speed'],
    ['V', 'info views: lay data over the ground'],
    ['Alt and a letter', 'straight to one of the twenty-two views'],
    ['M', 'the map, shift and M for full screen'],
    ['G', 'the civic board'],
    ['E', 'the island calendar'],
    ['K', 'the siting bench'],
    ['J', 'the chronicle'],
    ['I', 'the island log'],
    ['U', 'the works below the sand, proposed'],
    ['N', 'mute, and shift with it for the mixer'],
    ['O', 'settings'],
    ['P', 'photo mode. L for labels, B for bars, H hides all of this'],
    ['Esc', 'close whatever is open, or let go of what you picked'],
    ['Y', 'how it works: the time, the data, and your part in it'],
    ['?', 'this screen again']
  ];

  function drawHandover() {
    sheet.classList.remove('ack');
    sheet.append(
      el('h2', {}, 'That is everything'),
      el('p', { class: 'ob-lede' },
        'Click anything on the island and it will tell you who or what it is and what it is doing. '
        + 'Every number in this interface carries a note saying what it actually drives.'));

    const grid = el('div', { class: 'ob-keys' });
    for (const [k, v] of KEYS) {
      grid.append(el('div', { class: 'ob-key' }, el('kbd', {}, k), el('span', {}, v)));
    }
    sheet.append(grid);

    sheet.append(el('p', { class: 'ob-note' },
      'Small hints will appear when something on the island is worth explaining, once each, and '
      + 'never again. Turn them off in settings. If you would rather have the whole thing explained '
      + 'than discover it, that is Y, and you can leave it at any screen.'));

    sheet.append(el('div', { class: 'ob-act' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => go(2) }, 'Back'),
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { finish(); world.bus.emit('ui:open', { id: 'howitworks', section: 'what' }); }
      }, 'How it works'),
      el('button', { class: 'btn ob-go', type: 'button', onclick: finish }, 'Take me to the island')));
  }

  /* ---- reopening -------------------------------------------------------- */

  world.bus.on('ui:open', (p) => { if (p && p.id === 'onboarding') { go(p.step || 0); setOpen(true); } });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (open) {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
      if (e.code === 'ArrowRight') { e.preventDefault(); go(step + 1); return; }
      if (e.code === 'ArrowLeft') { e.preventDefault(); go(step - 1); return; }
      return;
    }
    // Shift and slash is a question mark on every layout that has one.
    if (e.code === 'Slash' && e.shiftKey) { e.preventDefault(); go(0); setOpen(true); }
  }, true);

  /* ---- the hint layer --------------------------------------------------- */

  const hintBox = el('div', { class: 'ob-hint', role: 'status' });
  root.appendChild(hintBox);

  const shown = readHints();
  let hintOn = null;
  let hintUntil = 0;
  let nextAllowedAt = 0;
  let hintsEnabled = true;
  const HINT_GAP_MS = 240000;   // four real minutes between any two
  const HINT_HOLD_MS = 16000;

  world.bus.on('ui:hints', (p) => {
    if (!p) return;
    if (typeof p.enabled === 'boolean') hintsEnabled = p.enabled;
    // "Let the hints run again" means now, not in four minutes. The gap exists so a busy hour does
    // not stack them up, not so a deliberate reset has to be waited out.
    if (p.reset) { shown.clear(); writeHints(shown); armed.clear(); nextAllowedAt = 0; }
  });

  // Event-armed hints. The simulation says a thing happened; the hint waits for a moment when
  // saying so would not be an interruption. Arming is free and never repeats.
  const armed = new Set();
  for (const h of HINTS) {
    if (!h.event) continue;
    world.bus.on(h.event, () => { if (!shown.has(h.id)) armed.add(h.id); });
  }

  function closeHint() {
    hintOn = null;
    hintBox.classList.remove('on');
  }

  function raiseHint(h) {
    hintOn = h;
    shown.add(h.id);
    writeHints(shown);
    hintUntil = performance.now() + HINT_HOLD_MS;
    nextAllowedAt = performance.now() + HINT_GAP_MS;
    hintBox.textContent = '';
    hintBox.append(
      el('div', { class: 'ob-hint-k' }, 'On this island'),
      el('h5', {}, h.title),
      el('p', {}, h.body),
      el('button', { class: 'btn ghost icon ob-hint-x', type: 'button', 'aria-label': 'Dismiss', onclick: closeHint }, '×'));
    hintBox.classList.add('on');
  }

  /** A board being open means the player is already reading something. Do not talk over it. */
  function boardOpen() {
    return open || !!document.querySelector('.cb-board.on, .ev-board.on, .st-board.on, .bd-board.on, .cr-board.on, .sub-board.on, .td-board.on, .map-full.on');
  }

  function pumpHints() {
    if (hintOn) {
      if (performance.now() > hintUntil) closeHint();
      return;
    }
    if (!hintsEnabled || boardOpen()) return;
    if (performance.now() < nextAllowedAt) return;
    for (const h of HINTS) {
      if (shown.has(h.id)) continue;
      let hit = false;
      if (h.event) hit = armed.has(h.id);
      else { try { hit = !!h.when(world); } catch (e) { hit = false; } }
      if (hit) { armed.delete(h.id); raiseHint(h); return; }
    }
  }

  /* ---- first run -------------------------------------------------------- */

  if (!readSeen()) {
    // Hold the clock while the acknowledgement is up. Nothing about this island needs to keep
    // running behind a screen that asks you to read six lines.
    //
    // `freeze()` and not `setSpeed(0)`, and the difference is not cosmetic. Choosing a speed is how
    // a person leaves live, so `setSpeed(0)` on a build configured to open at the real Queensland
    // moment would drop it out of live before anybody had touched anything, and write "a speed was
    // chosen" on the clock's record over a choice nobody made. `freeze()` is the clock's own word
    // for holding the world still without touching what kind of time it is, and `finish()` thaws.
    heldTheIsland = true;
    try { world.clock.freeze(); } catch (e) { heldTheIsland = false; }
    setOpen(true);
  } else {
    // A returning player has already seen the four minute floor reset, so let the first hint of a
    // session come reasonably quickly rather than waiting out a gap that was never used.
    nextAllowedAt = performance.now() + 45000;
  }

  return {
    update() { pumpHints(); }
  };
}

/* ------------------------------------------------------------------ style */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'ob-style';
  s.textContent = `
.ob-stage { position: fixed; inset: 0; z-index: 70; display: none; flex-direction: column;
  align-items: center; justify-content: center; gap: var(--sp-4);
  background: radial-gradient(ellipse at 50% 34%, rgba(18,34,43,.93) 0%, rgba(6,9,12,.97) 72%);
  backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
  animation: fade-in var(--slow) var(--ease) both; }
.ob-stage.on { display: flex; }
.ob-sheet { width: min(780px, 92vw); max-height: 76vh; overflow-y: auto; scrollbar-width: thin;
  scrollbar-color: var(--edge-strong) transparent;
  background: var(--s-1); border: 1px solid var(--edge); border-radius: var(--r-3);
  box-shadow: var(--shadow-3); padding: var(--sp-6) var(--sp-6) var(--sp-5);
  color: var(--t); font: var(--fs-base)/1.6 var(--f-ui); animation: slide-up var(--slow) var(--ease-out) both;
  /* The type scale in design.css is sized for the HUD, which is an instrument read at a glance while
     you are looking at something else. This is the opposite: a full screen of prose and a keyboard
     reference that somebody sits and reads. At the HUD's 13px base it came out too small to read
     comfortably, which the owner reported. Redefining the tokens on this one element rather than
     editing forty rules works because custom properties cascade, so every descendant using
     var(--fs-*) scales with it and the proportions of the design system are kept exactly.
     The clamp keeps it sane on a narrow split-screen window and on a wide one. */
  --fs-micro: clamp(11px, 0.78vw + 7px, 13px);
  --fs-label: clamp(12px, 0.85vw + 7px, 14px);
  --fs-sm:    clamp(13px, 0.95vw + 8px, 15px);
  --fs-base:  clamp(15px, 1.05vw + 9px, 17px);
  --fs-lg:    clamp(17px, 1.25vw + 10px, 20px);
  --fs-xl:    clamp(21px, 1.6vw + 12px, 25px);
  --fs-display: clamp(28px, 2.6vw + 14px, 38px); }
.ob-sheet.ack { background: rgba(12,18,22,.9); padding: var(--sp-7) var(--sp-6) var(--sp-6); }
.ob-sheet::-webkit-scrollbar { width: 8px; }
.ob-sheet::-webkit-scrollbar-thumb { background: var(--edge-strong); border-radius: var(--r-pill); }

.ob-sheet h2 { font: 200 var(--fs-display)/1.15 var(--f-ui); letter-spacing: .06em; color: var(--sand); }
.ob-sheet h3 { font: 600 var(--fs-label)/1 var(--f-ui); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-dim); margin: var(--sp-5) 0 var(--sp-3); }
.ob-alt { font-size: var(--fs-sm); color: var(--t-faint); letter-spacing: .06em; margin-top: 4px; }
.ob-lede { margin-top: var(--sp-4); color: var(--t); max-width: 64ch; }
.ob-p { margin-top: var(--sp-3); color: var(--t-dim); }
.ob-p.warn { color: var(--coral); }
.ob-note { margin-top: var(--sp-4); font-size: var(--fs-sm); line-height: 1.6; color: var(--t-faint); max-width: 68ch; }

.ob-place { font: 600 var(--fs-label)/1 var(--f-ui); letter-spacing: .3em; text-transform: uppercase;
  color: var(--sea); margin-bottom: var(--sp-5); }
.ob-ack p { font: 300 var(--fs-lg)/1.85 var(--f-ui); color: var(--t-hi); max-width: 62ch;
  margin-bottom: var(--sp-4); }
.ob-ack p:last-child { margin-bottom: 0; color: var(--t-dim); font-size: var(--fs-base); line-height: 1.7; }

/* The boundary, on the surface of the acknowledgement screen rather than under the fold. Coral
   left edge, because in this palette coral is refusal, and every line here is a refusal. */
.ob-wont { margin-top: var(--sp-6); border-left: 2px solid var(--coral); padding: var(--sp-1) 0 var(--sp-1) var(--sp-4); }
.ob-wont h5 { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase;
  color: var(--coral); margin-bottom: var(--sp-2); }
.ob-wont ul { margin: 0 0 0 1.05em; }
.ob-wont li { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); margin-bottom: 5px; }

.ob-src { margin-top: var(--sp-6); border-top: 1px solid var(--edge); padding-top: var(--sp-3); }
.ob-src summary { cursor: pointer; font-size: var(--fs-sm); color: var(--t-faint); letter-spacing: .04em; }
.ob-src summary:hover { color: var(--t); }
.ob-src-in { padding-top: var(--sp-3); font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); }
.ob-src-in p { margin-bottom: var(--sp-3); max-width: 76ch; }
.ob-src-in h5 { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-faint); margin: var(--sp-4) 0 var(--sp-2); }
.ob-src-in ul { margin: 0 0 var(--sp-3) 1.1em; }
.ob-src-in li { margin-bottom: 5px; }
.ob-src-in .quote { color: var(--t-hi); border-left: 2px solid var(--heath); padding-left: var(--sp-3); }
.ob-src-in .attrib { font-size: var(--fs-micro); color: var(--t-faint); }
.ob-cites li { word-break: break-word; font-size: var(--fs-micro); }

.ob-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: var(--sp-4); margin-top: var(--sp-5); }
.ob-purposes { display: flex; flex-direction: column; gap: var(--sp-2); }
.ob-purpose { display: grid; grid-template-columns: 160px 1fr; gap: var(--sp-3); align-items: baseline;
  padding: var(--sp-2) 0; border-bottom: 1px solid rgba(232,220,196,.06); }
.ob-purpose:last-child { border-bottom: none; }
.ob-purpose b { color: var(--t-hi); font-weight: 500; }
.ob-purpose span { color: var(--t-dim); font-size: var(--fs-sm); line-height: 1.55; }

/* The light notice, above the doors, only when the sun is under the horizon. Amber rather than red:
   it is not a fault, it is the time of day. */
.ob-light { display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  margin-bottom: var(--sp-4); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-2);
  border: 1px solid rgba(228,164,74,.3); background: rgba(228,164,74,.07); }
.ob-light b { color: var(--sun); font-weight: 500; font-size: var(--fs-base); }
.ob-light span { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.ob-light em { font-style: normal; font-size: var(--fs-micro); color: var(--t-faint); }
.ob-light-go { margin-top: 2px; background: var(--sun); border-color: var(--sun); color: var(--t-on-accent); }
.ob-light-go:hover { background: #f0b95f; border-color: #f0b95f; color: var(--t-on-accent); }

.ob-doors { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--sp-3); margin-top: var(--sp-5); }
.ob-door { text-align: left; appearance: none; cursor: pointer; display: flex; flex-direction: column;
  gap: 4px; padding: var(--sp-4); border: 1px solid var(--edge); border-radius: var(--r-2);
  background: rgba(255,255,255,.025); color: var(--t); font: var(--fs-base)/1.55 var(--f-ui);
  transition: border-color var(--fast), background var(--fast), transform var(--fast); }
.ob-door:hover { border-color: var(--sea); background: rgba(63,182,196,.10); transform: translateY(-1px); }
.ob-door:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.ob-door b { color: var(--t-hi); font-size: var(--fs-lg); font-weight: 400; }
.ob-door i { font-style: normal; font-size: var(--fs-micro); letter-spacing: .12em; text-transform: uppercase;
  color: var(--sea); }
.ob-door span { font-size: var(--fs-sm); color: var(--t-dim); margin-top: 4px; }
.ob-door em { font-style: normal; font-size: var(--fs-sm); color: var(--sun); margin-top: 6px;
  padding-top: 6px; border-top: 1px solid var(--edge); }
/* The explainer door is a different kind of thing from the three places, so it spans the row and
   wears the sand accent rather than the sea one. */
.ob-door.wide { grid-column: 1 / -1; background: rgba(232,220,196,.045); }
.ob-door.wide:hover { border-color: var(--sand); background: rgba(232,220,196,.09); }
.ob-door.wide i { color: var(--sand); }

.ob-keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 6px var(--sp-4); margin-top: var(--sp-4); }
.ob-key { display: flex; align-items: baseline; gap: var(--sp-3); font-size: var(--fs-sm); color: var(--t-dim); }
.ob-key kbd { flex: none; min-width: 62px; text-align: center; font: 600 var(--fs-micro)/1.7 var(--f-num);
  letter-spacing: .06em; color: var(--t-hi); background: var(--s-sunk); border: 1px solid var(--edge-strong);
  border-radius: var(--r-1); padding: 2px 6px; }

.ob-act { display: flex; gap: var(--sp-2); margin-top: var(--sp-6); }
.ob-go { background: var(--sea); border-color: var(--sea); color: var(--t-on-accent); }
.ob-go:hover { background: #55c8d5; border-color: #55c8d5; color: var(--t-on-accent); }
.ob-foot { display: flex; align-items: center; gap: var(--sp-4); }
.ob-dots { display: flex; gap: 6px; }
.ob-dot { appearance: none; border: none; cursor: pointer; width: 22px; height: 3px; padding: 0;
  border-radius: var(--r-pill); background: var(--edge-strong); transition: background var(--fast); }
.ob-dot.done { background: var(--sea-deep); }
.ob-dot.on { background: var(--sea); }

.ob-hint { position: absolute; left: 50%; transform: translate(-50%, 10px); bottom: calc(var(--sp-6) + 28px);
  z-index: 30; width: min(420px, 90vw); background: var(--s-2); backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur); border: 1px solid var(--edge-strong); border-left: 2px solid var(--sea);
  border-radius: var(--r-2); box-shadow: var(--shadow-2); padding: var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-4);
  opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease), transform var(--med) var(--ease-out); }
.ob-hint.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.ob-hint-k { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .16em; text-transform: uppercase;
  color: var(--sea); margin-bottom: 5px; }
.ob-hint h5 { font-size: var(--fs-base); color: var(--t-hi); font-weight: 500; margin-bottom: 3px; padding-right: 22px; }
.ob-hint p { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.ob-hint-x { position: absolute; top: 6px; right: 6px; font-size: var(--fs-lg); line-height: 1; }

/* While the arrival is up the camera's own movement card would sit under it unread. */
body.twin-onboarding #cam-hint { display: none !important; }

@media (max-width: 860px) {
  .ob-sheet { padding: var(--sp-5) var(--sp-4); max-height: 80vh; }
  .ob-purpose { grid-template-columns: 1fr; gap: 0; }
  .ob-hint { bottom: var(--sp-4); }
}
`;
  document.head.appendChild(s);
}
