// Today. The surface this island opens as, and the only screen in the build a stranger will read
// as information about the real Minjerribah on the real day they are standing in.
//
// WHY IT IS THE FOURTEENTH PANEL, WHEN THIRTEEN WAS ALREADY TOO MANY.
// Because the app now opens live (see `resolveClockBoot` in src/main.js) and an island that opens
// at the real Queensland moment has to open saying something useful about it. This replaces
// nothing: the boards, the rail, the info views and the island itself are all behind it and one
// button away. It is a noticeboard, not a dashboard, and the difference is that a noticeboard is
// read at a glance by somebody walking past who did not ask for it.
//
// ============================================================================================
// THE LINE THIS WHOLE FILE IS BUILT AROUND
// ============================================================================================
//
// Some of what this twin computes is genuinely real and some of it is a simulation, and mixing
// them on a screen a stranger reads as today would be the most damaging thing this project could
// do. So every block below is one of three things and says which:
//
//   REAL       the date, the day, the season, the Queensland school calendar, the tide, the sun,
//              the moon, the published ferry and barge timetable, the published opening hours, and
//              the events in data/events.json with their organiser and their source.
//
//   MODELLED   the conditions, and nothing else on this screen. src/systems/environment/weather.js
//              is a synoptic state machine. It has never touched the Bureau of Meteorology and it
//              is not a forecast. It carries a chip, a border and a plain sentence saying so, and
//              it is deliberately the smallest block on the surface rather than the largest, which
//              is the opposite of what a weather widget normally gets.
//
//   ABSENT     everything the twin does not know. An empty slot that says nothing is published
//              beats a confident invention, so "nothing is on today" is a sentence this screen is
//              happy to print, because on this island it is true most days and is itself worth
//              knowing.
//
// THE NOTICEBOARD RULE, from C:/Users/sbt41/githublocal/straddie-noticeboard-network: public
// screens get public truth only. Nothing here may come from a modelled resident, a simulated
// sentiment figure, a modelled crowd count, a modelled dollar, or anything in the proposed
// register. The works below the sand do not appear. No person is named. That rule is the same
// boundary as the O and I faces in the aura-horn-torus repository and the same boundary as this
// repository's committed, contributed and proposed registers: three expressions of one idea.
//
// WHAT THAT COSTS, STATED PLAINLY, so nobody adds them back thinking they were forgotten:
// no attendance estimate beside an event, because every attendance figure in data/events.json is
// a modelling estimate at low confidence and the pack says so; no visitor number; no island mood;
// no business takings; no crowd on site now. All of those exist in the read models a few lines
// away and all of them are the wrong kind of true for this screen.
//
// WHAT IT READS RATHER THAN RECOMPUTES. The tide comes out of `world.read('tide')`, the sun and
// moon out of `daylight`, the crossing out of `ferry.remaining` and `ferry.tomorrowFirst`, which are
// the running ferry system's own board and not a second reading of the pack, what is open out of the businesses
// system's own `hours(id)` accessor, and the calendar out of the same pure helper the simulation
// resolves its event days with (`src/systems/agents/calendar.js`), so what a person reads here and
// what the island runs cannot drift apart. The one piece of arithmetic this file does is
// converting the tide system's `inHours` into a clock time, and it does that against the same
// anchor src/ui/panels/hud.js tracks, for the same reason and by the same route.
//
// THE TEST IT IS BUILT AGAINST: open it cold on a phone and know within five seconds whether you
// can get off the island today and whether anything is on. Everything else on the screen is
// arranged around not getting in the way of those two.

import { registerPanel, el } from '../mount.js';
import { ISLAND_TZ, ISLAND_SEASONS, islandTimeText, spanText } from '../../kernel/clock.js';
import { makeCalendar } from '../../systems/agents/calendar.js';
import { checkedPhrase, freshnessMoment, STALE_AFTER_DAYS } from '../../world/freshness.js';

/* ------------------------------------------------------------------ shared chrome */

function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------------ safe reads

   Same discipline as the bar across the top: a system that has not been built, or one that threw
   and got disabled, produces a dash or an absent block. Never NaN, never undefined, and never a
   stale number presented as though it were this minute's. */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function num(v, dp = 0, suffix = '') {
  if (!isNum(v)) return '–';
  return v.toFixed(dp) + suffix;
}

/** A minute of the day as `6:19am`. */
function hhmm(minuteOfDay) {
  if (!isNum(minuteOfDay)) return '–';
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m % 60).padStart(2, '0') + (h < 12 ? 'am' : 'pm');
}

/** A published `HH:MM` from the packs, in the same twelve hour form the rest of the screen uses. */
function packTime(hhmmText) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmmText || '').trim());
  if (!m) return null;
  return hhmm(Number(m[1]) * 60 + Number(m[2]));
}

/** Minutes as a gap somebody would say out loud: `52 min`, `1 h 42 min`. */
function gapText(minutes) {
  if (!isNum(minutes) || minutes < 0) return '–';
  const m = Math.round(minutes);
  if (m < 1) return 'any minute';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

/** The hostname of a source URL, or the source string itself when it is not one. */
function sourceLabel(source) {
  const s = String(source || '').trim();
  if (!s) return null;
  const m = /^https?:\/\/([^/?#]+)/i.exec(s);
  if (!m) return s.length > 96 ? s.slice(0, 93) + '...' : s;
  return m[1].replace(/^www\./, '');
}

/* ------------------------------------------------------------------ what kind of time this is

   The bar across the top already says this in three places and this screen says it a fourth time,
   which is not duplication: the bar is chrome a person learns, and this is the surface they meet
   first, possibly on a wall, possibly having never seen the build before. If the island is not
   live, the loudest thing on this screen has to be that the date below is not today. */

function modeOf(world) {
  const c = world.clock;
  if (c.scrubbing) {
    return c.viewOffsetMin > 0
      ? {
        word: 'PROJECTION', tone: 'sun', live: false,
        banner: 'This is not today. The clock is parked ' + spanText(c.viewOffsetMin)
          + ' ahead of anything this island has run, so nothing below is a record of anything.'
      }
      : {
        word: 'LOOKING BACK', tone: 'sun', live: false,
        banner: 'This is not today. The clock is parked ' + spanText(c.viewOffsetMin)
          + ' back, at a moment this island was never at.'
      };
  }
  if (c.mode === 'live') {
    return {
      word: 'LIVE', tone: 'sea', live: true,
      banner: null
    };
  }
  return {
    word: 'SIMULATED', tone: 'iron', live: false,
    banner: 'This is not today. The island is running forward from a moment somebody chose, so the '
      + 'date below is the simulation\'s date. Everything on this screen is still worked out '
      + 'honestly for that date; it is simply not the day you are standing in.'
  };
}

/* ------------------------------------------------------------------ the panel */

registerPanel({
  id: 'today',
  // Before the boards, so the Today button sits at the top of the rail. It is the surface the
  // island opens as, and a launcher for it four buttons down would be an odd thing to explain.
  order: 39,

  mount(root, world) {
    if (!document.getElementById('td-style')) {
      const st = document.createElement('style');
      st.id = 'td-style';
      st.textContent = STYLE;
      document.head.append(st);
    }

    /* ---- storage ------------------------------------------------------
       One key, owned by settings.js, read here. `today.openOnStart` decides whether this surface
       is what the island opens as. It defaults to true, because that is the whole point of it, and
       the toggle that turns it off is on this screen and in Settings rather than buried. */

    const STORE_KEY = 'twin.settings';
    function opensOnStart() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return true;
        const s = (JSON.parse(raw) || {}).today;
        return !s || s.openOnStart !== false;
      } catch (e) { return true; }
    }
    function setOpensOnStart(v) {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        const s = raw ? (JSON.parse(raw) || {}) : {};
        s.today = Object.assign({}, s.today, { openOnStart: !!v });
        localStorage.setItem(STORE_KEY, JSON.stringify(s));
      } catch (e) { /* private browsing: the choice holds for this session and no longer */ }
      world.bus.emit('today:preference', { openOnStart: !!v });
    }

    /* ---- the calendar -------------------------------------------------
       The same instance the agent systems share where there is one, so this screen and the island
       resolve an event date the same way. `makeCalendar` filters out the ended records and
       everything at low confidence before this file sees it, which is how
       `no-low-confidence-to-player` in data/lore.json is honoured here. */

    let cal = null;
    try {
      cal = (world.residents && world.residents.calendar) || makeCalendar(world.data && world.data.events);
    } catch (e) { cal = null; }

    /** Organiser and source live on the pack record, not on the read model. Indexed once. */
    const eventPack = new Map();
    for (const rec of ((world.data && world.data.events && world.data.events.events) || [])) {
      if (rec && rec.id) eventPack.set(rec.id, rec);
    }
    const placeName = new Map();
    for (const p of ((world.data && world.data.places && world.data.places.places) || [])) {
      if (p && p.id) placeName.set(p.id, p.name);
    }

    /* ---- who has published hours --------------------------------------
       The candidate list for "open right now", fixed at mount because it is a property of the pack
       and not of the minute. Three filters and each one is a rule rather than a preference:

         confidence low     `no-low-confidence-to-player` is blocking. Nineteen records in
                            data/businesses.json are at low confidence and eight of those carry
                            listed hours, so without this filter they would walk straight onto a
                            public screen.
         closed, proposed   a shut business is not open and a proposed one does not exist.
         basis              published or listed only. An estimate is the twin's own guess about a
                            real street and it goes in its own block below, styled so it cannot be
                            mistaken for the first list. */

    const PUBLIC_BASIS = new Set(['published', 'listed']);
    const bizList = ((world.data && world.data.businesses && world.data.businesses.businesses) || []);
    const bizById = new Map();
    for (const b of bizList) if (b && b.id) bizById.set(b.id, b);
    const publishedHours = bizList.filter((b) => b
      && b.confidence !== 'low'
      && b.status !== 'closed' && b.status !== 'proposed'
      && b.typical_hours && PUBLIC_BASIS.has(b.typical_hours.basis));

    /* ---- the tide anchor ----------------------------------------------
       `tide.next` carries `inHours` measured from whenever tide.js last worked its turns out, which
       is the last day boundary or boot, and not from now. src/ui/panels/hud.js tracks that anchor
       and this tracks it the same way and for the same reasons, including the awkward one: parking
       the clock across a midnight makes tide.js recompute at the scrubbed moment, and coming back
       to the island's present restores the pre-scrub turn list verbatim, so the anchor has to come
       back with it or a restored list gets read against a scrubbed anchor. */

    let tideAnchor = world.clock.dayIndex === 0
      ? { dayIndex: 0, minuteOfDay: world.clock.startMinuteOfDay }
      : { dayIndex: world.clock.dayIndex, minuteOfDay: 0 };
    let anchorBeforePark = null;
    let lastTickSeen = world.clock.tick;
    world.bus.on('tide:day', () => {
      if (world.clock.scrubbing && anchorBeforePark === null) anchorBeforePark = tideAnchor;
      tideAnchor = { dayIndex: world.clock.dayIndex, minuteOfDay: world.clock.minuteOfDay };
    });
    world.bus.on('clock:restored', () => {
      if (anchorBeforePark !== null) { tideAnchor = anchorBeforePark; anchorBeforePark = null; }
    });
    world.bus.on('world:loaded', () => {
      const c = world.clock;
      tideAnchor = c.dayIndex === 0
        ? { dayIndex: 0, minuteOfDay: c.startMinuteOfDay }
        : { dayIndex: c.dayIndex, minuteOfDay: 0 };
      anchorBeforePark = null;
      lastTickSeen = c.tick;
    });

    /** The next published turn, in hours from now, or null when the tide has not published any. */
    function nextTurn() {
      const t = world.read('tide');
      if (!t || !Array.isArray(t.next) || !t.next.length) return null;
      const c = world.clock;
      const elapsed = tideAnchor
        ? ((c.dayIndex - tideAnchor.dayIndex) * 1440 + (c.minuteOfDay - tideAnchor.minuteOfDay)) / 60
        : 0;
      let best = null;
      for (const k of t.next) {
        if (!k || !isNum(k.inHours) || !isNum(k.height)) continue;
        const h = k.inHours - elapsed;
        if (h <= 0.02) continue;
        if (!best || h < best.hoursFromNow) best = { kind: k.kind, height: k.height, hoursFromNow: h };
      }
      if (!best) return null;
      best.atMinute = c.absoluteMinute + best.hoursFromNow * 60;
      return best;
    }

    /* ---- the shell ----------------------------------------------------
       Named `td-board` and `td-scrim` on purpose: the one id selector in src/ui/ui.css that stops a
       closed board sitting over the island as an invisible click shield keys on those two suffixes,
       so a new board that follows the convention is covered without touching that file. */

    const scrim = el('div', { class: 'td-scrim', onclick: () => toggle(false) });
    const board = el('section', {
      class: 'td-board', role: 'dialog', 'aria-modal': 'false', tabindex: '-1',
      'aria-label': 'Today on Minjerribah'
    });
    root.append(scrim, board);

    const badge = el('span', { class: 'dot' });
    const launcher = el('button', {
      class: 'btn rail-btn', type: 'button', title: 'Today: the noticeboard (t)',
      onclick: () => toggle()
    }, 'Today', badge);
    rail().append(launcher);

    const head = el('div', { class: 'td-head' });
    const body = el('div', { class: 'td-body scroll' });
    const foot = el('div', { class: 'td-foot' });
    board.append(head, body, foot);

    /* ---- open and close ------------------------------------------------ */

    let open = false;
    let autoOpened = false;
    function toggle(force) {
      const next = force === undefined ? !open : !!force;
      if (next === open) return;
      open = next;
      scrim.classList.toggle('on', open);
      board.classList.toggle('on', open);
      launcher.classList.toggle('on', open);
      if (open) {
        world.bus.emit('ui:drawer', { id: 'today' });
        paint(true);
        board.focus({ preventScroll: true });
      }
    }
    world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'today' && open) toggle(false); });

    // T. Free: checked against docs/KEYS.md and against every Key* binding in src/, where the
    // camera rig, the bar, the boards and the info views between them leave T, X and Z. Recorded
    // in docs/KEYS.md in the same commit, which is that file's own rule.
    const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && TYPING[e.target.tagName]) return;
      if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
      else if (e.code === 'KeyT') { toggle(); e.preventDefault(); }
    });

    /* ---- first run ordering --------------------------------------------
       The Acknowledgement of Country comes first on a genuinely first visit and nothing may open
       over it. src/ui/panels/onboarding.js holds the clock and puts up four screens, and it emits
       `onboarding:done` when a person has been through them or skipped them. So on a first visit
       this waits for that message, and on every visit after it opens straight away. Either way it
       opens once a session and never again on its own, so dismissing it stays dismissed for as
       long as the tab is up whatever else happens. */

    function autoOpen() {
      if (autoOpened) return;
      autoOpened = true;
      if (!opensOnStart()) return;
      toggle(true);
    }
    world.bus.on('onboarding:done', () => autoOpen());
    if (!arrivalPending()) setTimeout(autoOpen, 0);

    /** Whether the arrival sequence still owes somebody the acknowledgement. */
    function arrivalPending() {
      try { return localStorage.getItem('twin.onboarding.seen') !== '1'; } catch (e) { return false; }
    }

    /* ================================================================== painting

       The whole surface is rebuilt on a change of the moment being viewed rather than patched in
       place, because every block on it changes together and a hundred and fifty nodes once a sim
       minute is nothing. Two throttles: it does no work at all while it is closed, and it does no
       work more than four times a real second however fast the island is running, because the
       businesses system's `hours(id)` walks a week and there are forty records to ask. */

    let lastKey = '';
    let lastPaintAt = 0;

    function paint(force) {
      if (!open) return;
      const now = performance.now();
      if (!force && now - lastPaintAt < 400) return;
      const c = world.clock;
      if (c.tick !== lastTickSeen) { lastTickSeen = c.tick; anchorBeforePark = null; }
      const key = c.absoluteMinute + '|' + c.declaredMode + '|' + c.mode;
      if (!force && key === lastKey) return;
      lastKey = key;
      lastPaintAt = now;
      try {
        drawHead();
        drawBody();
        drawFoot();
      } catch (e) {
        console.error('[today] paint failed', e);
      }
    }

    /* ---- the moment ---------------------------------------------------- */

    function drawHead() {
      const c = world.clock;
      const m = modeOf(world);
      const d = c.date;
      head.textContent = '';

      const season = c.season || ISLAND_SEASONS[0];
      const schoolWord = c.isQldSchoolHoliday
        ? 'Queensland school holidays, the ' + c.schoolHolidayLabel + ' break'
        : 'Queensland school term';
      // Only a year whose published dates are on file may be called exact. Every other year is
      // derived from the published anchors, and saying so costs one word.
      const schoolBasis = c.schoolCalendarBasis === 'published' ? '' : ', derived';

      head.append(
        el('div', { class: 'td-head-main' },
          el('div', { class: 'td-eyebrow' }, 'Today on Minjerribah'),
          el('div', { class: 'td-date' }, DAY_FULL[d.getUTCDay()] + ' ' + d.getUTCDate() + ' '
            + MONTH_FULL[d.getUTCMonth()] + ' ' + d.getUTCFullYear()),
          el('div', { class: 'td-time' }, c.format(), el('span', { class: 'td-tz' }, ISLAND_TZ)),
          el('div', { class: 'td-context' }, season.name + '. ' + schoolWord + schoolBasis + '.')),
        el('div', { class: 'td-head-side' },
          el('span', { class: 'td-mode tone-' + m.tone }, m.word),
          el('button', {
            class: 'btn ghost td-close', type: 'button', title: 'Close and look at the island (Esc)',
            onclick: () => toggle(false)
          }, 'Show me the island'))
      );

      if (m.banner) head.append(el('div', { class: 'td-banner' }, m.banner));
    }

    /* ---- blocks --------------------------------------------------------- */

    /** A section with a heading, a register word and a body. `register` is real or modelled. */
    // `register` is 'modelled', 'real', or an object { label, tone } for the case the two words do
    // not cover. Conditions needed the third: while the clock is live, the air and the wind may be
    // coming off a weather model of the actual sky, which is neither this twin's own simulation nor
    // a reading anybody took. Calling that "Real" overstates it and calling it "A simulation"
    // understates it, so it gets its own word. See the source ladder in docs/CONNECTORS.md.
    function block(cls, title, register, ...kids) {
      const spec = typeof register === 'object' && register
        ? register
        : register === 'modelled'
          ? { label: 'A simulation', tone: 'modelled' }
          : { label: 'Real', tone: 'real' };
      const chip = el('span', { class: 'td-chip ' + spec.tone }, spec.label);
      return el('section', { class: 'td-block ' + cls + (spec.tone === 'modelled' ? ' is-modelled' : '') },
        el('div', { class: 'td-block-head' }, el('h3', {}, title), chip),
        ...kids);
    }

    /** The small grey line under a block saying where the number came from. */
    const srcLine = (text) => el('p', { class: 'td-src' }, text);
    /** The plain sentence a block uses when the honest answer is that the twin does not know. */
    const noneLine = (text) => el('p', { class: 'td-none' }, text);

    function drawBody() {
      body.textContent = '';
      body.append(tideBlock(), lightBlock(), conditionsBlock(), crossingBlock(), onBlock(), openBlock());
    }

    /* ---- the tide -------------------------------------------------------
       The single most useful number on this island and it gets the space. It is also the piece of
       this screen with the strongest claim: a seven constituent harmonic sum with a per station
       lag, evaluated at an hour, which is a prediction in the same sense a published tide table is
       a prediction rather than a reading off a gauge. */

    function tideBlock() {
      const t = world.read('tide');
      const wrap = block('td-tide', 'The tide', 'real');
      if (!t || !isNum(t.height)) {
        wrap.append(noneLine('The tide system is not running, so this screen has nothing to tell you '
          + 'about the water. That is a fault in the build, not a quiet day.'));
        return wrap;
      }

      const rising = t.phase === 'flood';
      const slack = t.phase === 'slack' || !t.phase;
      const moving = slack ? 'slack water' : rising ? 'and rising' : 'and falling';
      wrap.append(el('div', { class: 'td-hero' },
        el('span', { class: 'td-hero-num' }, num(t.height, 2)),
        el('span', { class: 'td-hero-unit' }, 'm'),
        el('span', { class: 'td-hero-word ' + (slack ? '' : rising ? 'up' : 'down') }, moving)));

      const turn = nextTurn();
      if (turn) {
        wrap.append(el('div', { class: 'td-second' },
          el('strong', {}, (turn.kind === 'high' ? 'High water ' : 'Low water ') + num(turn.height, 2) + ' m'),
          ' at ' + islandTimeText(turn.atMinute) + ', ',
          el('strong', {}, gapText(turn.hoursFromNow * 60)),
          ' away'));
      } else {
        wrap.append(noneLine('No turn is published within the next day and a bit. The tide system '
          + 'works its turns out from each midnight and this moment is past the end of that list.'));
      }

      const st = (t.stations || {});
      const others = [
        ['Amity Point', st.amity], ['The Gorge', st.gorge], ['Main Beach', st.mainbeach],
        ['One Mile', st.onemile]
      ].filter((r) => isNum(r[1]));
      if (others.length) {
        wrap.append(el('div', { class: 'td-stations' },
          others.map((r) => el('span', { class: 'td-station' },
            el('span', { class: 'k' }, r[0]), el('span', { class: 'v' }, num(r[1], 2) + ' m')))));
      }

      if (isNum(t.range)) {
        const swing = isNum(t.springNeap)
          ? (t.springNeap > 0.66 ? 'near springs' : t.springNeap < 0.33 ? 'near neaps' : 'between springs and neaps')
          : null;
        wrap.append(el('p', { class: 'td-note' },
          'Range today ' + num(t.range, 2) + ' m' + (swing ? ', ' + swing : '') + '.'
          + ' More of this island runs on the tide than on the clock: Main Beach and Flinders Beach '
          + 'are shut to vehicles for two hours either side of high water.'));
      }

      wrap.append(srcLine('Metres above the lowest astronomical tide at the Dunwich (Goompi) standard '
        + 'port, where mean sea level sits at about 1.02 m. A seven constituent harmonic model with '
        + 'an amplitude ratio and a lag for each place, so high water at Amity Point is not high '
        + 'water at the Gorge. Sources are in data/lore.json.'));
      return wrap;
    }

    /* ---- first and last light ------------------------------------------- */

    function lightBlock() {
      const dl = world.read('daylight');
      const wrap = block('td-light', 'Light', 'real');
      if (!dl || !isNum(dl.sunriseMin)) {
        wrap.append(noneLine('The sun and moon system is not running.'));
        return wrap;
      }
      wrap.append(el('div', { class: 'td-pair-row' },
        el('div', { class: 'td-pair' }, el('span', { class: 'k' }, 'Sunrise'), el('span', { class: 'v' }, hhmm(dl.sunriseMin))),
        el('div', { class: 'td-pair' }, el('span', { class: 'k' }, 'Sunset'), el('span', { class: 'v' }, hhmm(dl.sunsetMin))),
        el('div', { class: 'td-pair' }, el('span', { class: 'k' }, 'Daylight'),
          el('span', { class: 'v' }, isNum(dl.dayLengthMin) ? gapText(dl.dayLengthMin) : '–'))));

      if (isNum(dl.moonIllum)) {
        const pct = Math.round(dl.moonIllum * 100);
        const waxing = isNum(dl.moonPhase) && dl.moonPhase < 0.5;
        const words = pct >= 96 ? 'Full, or near enough. A bright night on the beaches.'
          : pct <= 4 ? 'New. A dark night, which is the one the turtles and the mullet answer to.'
            : pct + ' per cent lit, ' + (waxing ? 'waxing' : 'waning') + '.';
        wrap.append(el('p', { class: 'td-note' }, el('strong', {}, 'Moon. '), words));
      }
      wrap.append(srcLine('Solar geometry for 27.43 degrees south, 153.45 degrees east. The moon is a '
        + 'synodic approximation, good for how much light there will be rather than to the minute, '
        + 'and it says so here rather than being quietly rounded into a fact.'));
      return wrap;
    }

    /* ---- conditions, and the whole point of the block is the label -------
       Deliberately the smallest block on this screen and deliberately the one carrying the most
       words of caveat per number. Three readings, not eight: the pattern, the air and the wind.
       The bar across the top carries swell, UV, fire danger and the sea state for anyone who wants
       them, in an interface that person has chosen to learn. This is a noticeboard. */

    function conditionsBlock() {
      const wx = world.read('weather');
      if (!wx) {
        const wrap = block('td-cond', 'Conditions', 'modelled');
        wrap.append(noneLine('The weather system is not running.'));
        return wrap;
      }
      // Which register this block is in is now a question rather than a constant, because the
      // answer changes with the clock. The chip follows the worst rung any number here is resting
      // on, which is the honest headline: one measured field among four modelled ones does not make
      // the block measured.
      const rung = wx.sourceRung || 4;
      const knows = typeof wx.knows === 'function' ? wx.knows : () => true;
      const chip = rung >= 4 ? { label: 'A simulation', tone: 'modelled' }
        : rung === 3 ? { label: 'A weather model', tone: 'real' }
          : { label: 'Measured', tone: 'real' };
      const wrap = block('td-cond', 'Conditions', chip);

      // A pattern name is the simulation's own vocabulary and it has no meaning when the numbers
      // came off a model of the real sky, so it only appears when the island is running its own.
      if (rung >= 4) wrap.append(el('div', { class: 'td-cond-line' }, wx.label || '–'));

      // WHEN IT WAS TAKEN, beside the number and not in a footnote.
      // The businesses block one region below prints "checked 4 days ago" on every row, and this
      // block used to print no time at all while the pack it was reading carried an observation
      // stamp to the minute. An hour-old rain figure and an hour-old temperature are not the same
      // claim, so the age rides on each field rather than on the block: src/world/freshness.js sets
      // the shelf life per field and the ladder has already worked out which of them are still in.
      const stampOf = (field) => {
        const s = wx.fieldSource && wx.fieldSource[field];
        if (!s || !s.observedAt || !isNum(s.ageMin)) return null;
        const hm = /T(\d{2}):(\d{2})/.exec(String(s.observedAt));
        return {
          at: hm ? hhmm(Number(hm[1]) * 60 + Number(hm[2])) : null,
          ago: s.ago || gapText(s.ageMin) + ' ago',
          standing: s.freshness === 'fresh' ? 'fresh' : s.freshness === 'ageing' ? 'ageing' : 'stale'
        };
      };
      const pair = (k, v, field) => {
        const node = el('div', { class: 'td-pair' },
          el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
        const st = knows(field) ? stampOf(field) : null;
        if (st) {
          node.append(el('span', { class: 'td-age ' + st.standing },
            st.at ? st.at + ', ' + st.ago : st.ago));
        }
        return node;
      };
      wrap.append(el('div', { class: 'td-pair-row' },
        pair('Air', knows('tempC') ? num(wx.tempC, 1) + '°' : 'not known', 'tempC'),
        pair('Wind', knows('windKt') ? num(wx.windKt, 0) + ' kt' : 'not known', 'windKt')));

      if (rung >= 4) {
        wrap.append(el('p', { class: 'td-warn' },
          wx.notKnown && wx.notKnown.length
            ? 'The clock is live and no current reading is in hand, so the twin does not know what the '
              + 'sky is doing. It carries on running weather of its own so the island keeps living, and '
              + 'it will not show you that as though it were today. Do not plan a day on this screen.'
            : 'This is a simulation, not a forecast. The twin makes its own weather with a synoptic '
              + 'state machine, which is the only thing that can answer for a moment that has not '
              + 'happened. Do not plan a day on it, and do not read it as what the sky is doing outside.'));
      } else {
        // The oldest field still in use, because a block is only as current as its stalest number.
        let oldest = null;
        for (const f of Object.keys(wx.fieldSource || {})) {
          const s = wx.fieldSource[f];
          if (!s || !isNum(s.ageMin) || !s.observedAt || s.rung >= 4) continue;
          if (!oldest || s.ageMin > oldest.ageMin) oldest = s;
        }
        const st = oldest ? stampOf(Object.keys(wx.fieldSource).find((f) => wx.fieldSource[f] === oldest)) : null;
        wrap.append(el('p', { class: 'td-warn' },
          (st && st.at ? 'Taken at ' + st.at + ', ' + st.ago + ' at the oldest. ' : '')
          + 'Model output for a grid cell near the island, not a reading anybody took here, and not a '
          + 'forecast. It is what a weather model has for this coast at the moment stamped on it. The '
          + 'operator, the Bureau and your own eyes all outrank it.'));
      }
      wrap.append(srcLine(wx.sourceNote
        + (wx.attributions && wx.attributions.length
          ? ' ' + wx.attributions.map((a) => a.attribution).join('. ') + '.'
          : '')));
      return wrap;
    }

    /* ---- the crossing ---------------------------------------------------
       Leads with getting off the island, because that is the question an islander is actually
       asking and the one the five second test is written around.

       THE CORRECTION THIS BLOCK WAS REBUILT AROUND, from the owner, who lives there:

         "You can always get on and off the island on a passenger ferry during normal operating
          schedules, but there are peak times when the vehicle ferries get booked out."

       So "can I get off the island" is nearly always yes and is nearly never the useful question.
       "Can I get my VEHICLE across" is the one that fails, and at peak it fails on bookings rather
       than on weather. The block is therefore two groups and not four equal lines, the vehicle group
       goes first because it is the one that can say no, and the passenger group carries every
       remaining sailing rather than only the next one, because the whole point of it is that there
       are usually several more.

       AND IT NEVER STOPS AT "NOTHING MORE TODAY". It used to, on all four lines, at twenty past four
       on a Friday with two barges and nine passenger sailings still to run: the ferry system did not
       publish its board until the first tick, and a live tick is ten real minutes apart. That is
       fixed in src/systems/movement/ferry.js. What is fixed here is the other half of it: a line with
       genuinely nothing left today now says when the first one tomorrow is, off the published
       timetable, instead of leaving a person holding a dead end. */

    function crossingBlock() {
      const f = world.read('ferry');
      const wrap = block('td-cross', 'The crossing', 'real');
      if (!f || !f.ready) {
        wrap.append(noneLine('The ferry system is not running, so this screen cannot tell you when '
          + 'the next boat is.'));
        return wrap;
      }
      const remaining = f.remaining || {};
      const tomorrow = f.tomorrowFirst || {};
      // A peak day runs modelled extra sailings, and a modelled sailing time has no business on a
      // board a stranger reads as today. They are counted at the bottom and named as modelled.
      let extrasHeld = 0;
      const realRows = (key) => {
        const rows = Array.isArray(remaining[key]) ? remaining[key] : [];
        const kept = rows.filter((r) => r && !r.extra);
        extrasHeld += rows.length - kept.length;
        return kept;
      };

      const leg = (label, key, mode) => {
        const rows = realRows(key);
        const first = rows[0];
        const rest = rows.slice(1, 6);
        const line = el('div', { class: 'td-leg' + (first ? '' : ' empty') },
          el('span', { class: 'k' }, label));
        if (first) {
          line.append(
            el('span', { class: 'v' }, packTime(first.time) || first.time),
            el('span', { class: 'in' }, isNum(first.inMin) ? 'in ' + gapText(first.inMin) : ''));
        } else {
          line.append(el('span', { class: 'none' }, 'no more today'));
        }
        // What comes after it, which is the whole difference between the two groups: the barge runs
        // out early and the passenger boats keep going.
        if (rest.length) {
          line.append(el('span', { class: 'then' },
            'then ' + rest.map((r) => packTime(r.time) || r.time).join(', ')
            + (rows.length > rest.length + 1 ? ', and more' : '')));
        } else if (first) {
          line.append(el('span', { class: 'then last' },
            mode === 'vehicle' ? 'the last barge on this line today' : 'the last passenger sailing on this line today'));
        }
        const tm = tomorrow[key];
        if (!first || !rest.length) {
          line.append(el('span', { class: 'then' }, tm && tm.time
            ? 'first tomorrow ' + (packTime(tm.time) || tm.time) + (tm.vessel ? ', ' + tm.vessel : '')
            : 'nothing published for tomorrow on this line'));
        }
        return line;
      };

      wrap.append(el('p', { class: 'td-lede' },
        'Two questions, and only one of them fails. Getting yourself across is nearly always yes: '
        + 'the passenger ferries run their normal schedule and you walk on. Getting your vehicle '
        + 'across is the one that books out.'));

      wrap.append(el('h4', { class: 'td-sub' }, 'Your vehicle, on the barge'));
      wrap.append(el('div', { class: 'td-legs' },
        leg('To the mainland', 'toMainland', 'vehicle'),
        leg('Over to the island', 'toIsland', 'vehicle')));

      // The published ceiling, which is real, and a plain statement that whether a slot is actually
      // free is a booking-system fact this screen does not hold. The twin's own running count of the
      // deck is a modelled number and it stays on the bar, where modelled numbers are labelled.
      const each = (f.importCeiling && f.importCeiling.carsEachWay) || null;
      const t = f.today || {};
      const peakWords = t.isLongWeekend
        ? 'Today is inside a long weekend on the published calendar, which is one of the times the operator names as busiest.'
        : t.isSchoolHoliday
          ? 'Today is in the Queensland school holidays, which is one of the times the operator names as busiest.'
          : 'Public holidays, school holidays, Fridays and Sundays are the ones the operator names as busiest.';
      wrap.append(el('p', { class: 'td-note' },
        (isNum(each) ? each + ' vehicle slots each way on the published day. ' : '')
        + 'Whether one is still free is the operator\'s booking system, and this screen cannot see '
        + 'it: at peak they go days ahead. ' + peakWords + ' Book with SeaLink, do not read it here.'));

      wrap.append(el('h4', { class: 'td-sub' }, 'On foot, on the passenger ferries'));
      wrap.append(el('div', { class: 'td-legs' },
        leg('To the mainland', 'walkOnToMainland', 'walk-on'),
        leg('Over to the island', 'walkOnToIsland', 'walk-on')));
      wrap.append(el('p', { class: 'td-note' },
        'Two operators, two landings a kilometre apart at this end. SeaLink runs to the Junner '
        + 'Street pontoon at Dunwich and the Stradbroke Flyer runs to One Mile Jetty, so the choice '
        + 'is mostly which side of Dunwich you want to arrive at.'));

      if (extrasHeld > 0) {
        wrap.append(el('p', { class: 'td-warn' },
          'The twin is also running ' + extrasHeld + (extrasHeld === 1 ? ' extra sailing' : ' extra sailings')
          + ' today because the calendar says this is a peak day. They are not in the times above, '
          + 'because SeaLink publishes its peak timetable per period and this pack does not hold it: '
          + 'those extras are the simulation\'s own and they do not belong on a screen you would plan '
          + 'a day from.'));
      }

      const cancelled = (f.cancellations && f.cancellations.today) || 0;
      if (cancelled > 0) {
        wrap.append(el('p', { class: 'td-warn' },
          'The twin has called off ' + cancelled + (cancelled === 1 ? ' sailing' : ' sailings')
          + ' today, out of its own modelled weather and its own vessel roster, and the times above '
          + 'skip them. That is this simulation and not a real cancellation. Ring the operator.'));
      }
      wrap.append(srcLine('Sailing times from the published SeaLink and Stradbroke Flyer timetables '
        + 'committed in data/transport.json, read out of the running ferry system so this screen and '
        + 'the island cannot disagree. Timetables change and this pack is a snapshot: the operator is '
        + 'the authority, not this screen.'));
      return wrap;
    }

    /* ---- what is on -----------------------------------------------------
       Real records only, each with the organiser who runs it and the source it was read out of.
       No attendance figure appears anywhere in this block: every one of them in data/events.json is
       a modelling estimate and the pack says so in its own honesty block. */

    function onBlock() {
      const wrap = block('td-on', 'What is on', 'real');
      if (!cal) {
        wrap.append(noneLine('The events pack did not load, so this screen has no calendar.'));
        return wrap;
      }
      const c = world.clock;
      const dayNum = c.epochDay + c.dayIndex;
      const running = new Map();
      for (const r of ((world.read('events') || {}).running || [])) running.set(r.id, r);

      const todayRows = safeDay(dayNum);
      wrap.append(el('h4', { class: 'td-sub' }, 'Today'));
      if (!todayRows.length) {
        wrap.append(noneLine('Nothing is on today. That is true of most days on this island and it '
          + 'is worth knowing on its own.'));
      } else {
        wrap.append(el('div', { class: 'td-cards' }, todayRows.map((r) => eventCard(r, running.get(r.id), true))));
      }

      // The coming weekend. When today is already the weekend, the rest of it counts and the days
      // that have gone are not offered back.
      const dow = c.dayOfWeek;
      const toSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
      const weekendDays = [dayNum + toSat, dayNum + toSat + 1];
      if (dow === 0) { weekendDays[0] = dayNum; weekendDays[1] = dayNum; }
      const seen = new Set(todayRows.map((r) => r.id));
      const weekendRows = [];
      for (const dn of weekendDays) {
        if (dn <= dayNum) continue;
        for (const r of safeDay(dn)) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          weekendRows.push(Object.assign({}, r, { onDay: dn }));
        }
      }
      wrap.append(el('h4', { class: 'td-sub' }, dow === 6 || dow === 0 ? 'The rest of the weekend' : 'This weekend'));
      if (dow === 0 && !weekendRows.length) {
        wrap.append(noneLine('It is Sunday, so the weekend is what is above.'));
      } else if (!weekendRows.length) {
        wrap.append(noneLine('Nothing on the calendar for Saturday or Sunday.'));
      } else {
        wrap.append(el('div', { class: 'td-cards' }, weekendRows.map((r) => eventCard(r, null, false))));
      }

      const held = cal.held || {};
      wrap.append(srcLine('From the ' + (cal.liveEvents ? cal.liveEvents().length : 0) + ' live records in '
        + 'data/events.json, each with a published source. '
        + (held.lowConfidence ? held.lowConfidence + ' more are held back because they are at low confidence and a '
          + 'low confidence record does not go on a screen. ' : '')
        + (held.ended ? held.ended + ' ended and are kept in the pack for the reasons they ended. ' : '')
        + 'This is not everything that happens on a small island. It is everything somebody published.'));
      return wrap;
    }

    function safeDay(dayNum) {
      try { return cal.eventsOnDay(dayNum) || []; } catch (e) { return []; }
    }

    function eventCard(row, runningRow, isToday) {
      const rec = eventPack.get(row.id) || {};
      const card = el('article', { class: 'td-card' });
      const tags = el('div', { class: 'td-tags' });

      if (!row.sourcedDate) {
        tags.append(el('span', { class: 'td-tag' }, 'date worked out from its pattern, not published'));
      }
      if (row.status === 'unconfirmed') {
        tags.append(el('span', { class: 'td-tag warn' }, 'nobody could confirm it still runs'));
      }
      if (row.days > 1) {
        tags.append(el('span', { class: 'td-tag' }, isToday ? 'day ' + row.dayOfEvent + ' of ' + row.days : row.days + ' days'));
      }

      card.append(el('div', { class: 'td-card-name' }, row.name));

      const where = (row.placeIds || []).map((id) => placeName.get(id) || id.replace(/-/g, ' ')).slice(0, 3).join(', ');
      const bits = [];
      if (!isToday) bits.push(DAY_FULL[dowOf(row.onDay)]);
      const th = rec.typical_hours;
      if (th && th.basis === 'published' && packTime(th.start)) {
        bits.push(packTime(th.start) + (packTime(th.end) ? ' to ' + packTime(th.end) : '') + ', as published');
      } else if (isToday && runningRow && isNum(runningRow.opensAt)) {
        bits.push(hhmm(runningRow.opensAt) + ' to ' + hhmm(runningRow.closesAt) + ', times estimated');
      } else if (th) {
        bits.push('times not published');
      }
      if (where) bits.push(where);
      if (bits.length) card.append(el('div', { class: 'td-card-when' }, bits.join(' · ')));

      if (rec.organiser) card.append(el('div', { class: 'td-card-org' }, rec.organiser));
      if (tags.childNodes.length) card.append(tags);

      if (rec.cultural_handling) {
        card.append(el('p', { class: 'td-card-cultural' },
          'This project records the date, the place and the load on the island, and nothing else. No '
          + 'programme and no cultural material is held here and none will be generated. That belongs '
          + 'to the organisations that run it.'));
      }

      const src = sourceLabel(rec.source);
      if (src) card.append(el('div', { class: 'td-card-src', title: String(rec.source) }, 'Source: ' + src));
      return card;
    }

    /** Day of week for a day number. Day number 0 is 1 January 1970, which was a Thursday. */
    function dowOf(dayNum) {
      return isNum(dayNum) ? (((dayNum + 4) % 7) + 7) % 7 : 0;
    }

    /* ---- what is open ---------------------------------------------------
       Two lists, and they look different because they are different. The first is what a business
       or an agency published about its own week. The second is the simulation's guess about a real
       street, which is a legitimate thing for a simulation to run on and not a legitimate thing to
       put on a public screen without saying what it is. */

    function openBlock() {
      const wrap = block('td-open', 'Open right now', 'real');
      const bz = world.read('businesses');
      if (!bz || !bz.ready || typeof bz.hours !== 'function') {
        wrap.append(noneLine('The businesses system is not running, so this screen cannot say what '
          + 'is open.'));
        return wrap;
      }
      const moment = freshnessMoment(world.clock);

      const rows = [];
      for (const b of publishedHours) {
        let h = null;
        try { h = bz.hours(b.id); } catch (e) { h = null; }
        if (!h || !h.answersOpenShut || !h.weekIsPublished || !h.closesAt) continue;
        rows.push({ b, h });
      }
      rows.sort((a, b) => (a.b.township === b.b.township ? 0 : a.b.township < b.b.township ? -1 : 1)
        || (a.b.name < b.b.name ? -1 : 1));

      if (!rows.length) {
        wrap.append(noneLine('Nothing with published hours is open at this hour.'));
      } else {
        wrap.append(el('div', { class: 'td-open-list' }, rows.map(({ b, h }) => {
          const until = h.closeUnpublished ? 'open, closing time not published'
            : h.closesAt === '00:00' ? 'until midnight'
              : 'until ' + (packTime(h.closesAt) || h.closesAt);
          const f = checkedPhrase(h.checked, moment, STALE_AFTER_DAYS.hours);
          const line = el('div', { class: 'td-open-row' },
            el('span', { class: 'n' }, b.name),
            el('span', { class: 'u' }, until),
            el('span', { class: 'w' }, b.township || ''),
            el('span', { class: 'f ' + (f.standing || 'fresh') },
              f.phrase + (h.basis === 'listed' ? ', from a listing' : '')));
          if (b.status === 'trading-unconfirmed') {
            line.append(el('span', { class: 'td-tag warn' }, 'still trading not confirmed'));
          }
          if (h.kitchenOpen === false) line.append(el('span', { class: 'td-tag' }, 'kitchen shut'));
          return line;
        })));
      }

      // The estimated ones, counted and named quietly, in a block that cannot be mistaken for the
      // one above it. `openIds` is the simulation's own answer this tick.
      const estimated = [];
      const ids = bz.openIds;
      if (ids && typeof ids.forEach === 'function') {
        ids.forEach((id) => {
          const b = bizById.get(id);
          if (!b || b.confidence === 'low') return;
          if (b.typical_hours && PUBLIC_BASIS.has(b.typical_hours.basis)) return;
          estimated.push(b);
        });
      }
      estimated.sort((a, b) => (a.name < b.name ? -1 : 1));
      if (estimated.length) {
        wrap.append(el('div', { class: 'td-guess' },
          el('div', { class: 'td-guess-head' }, 'And ' + estimated.length + ' the twin only guesses at'),
          el('p', { class: 'td-guess-note' },
            'Nobody has published a week for these, so the hours below are the simulation\'s own '
            + 'estimate about a real street. Ring before you drive.'),
          el('div', { class: 'td-guess-list' }, estimated.map((b) => b.name).join(' · '))));
      }

      const p = bz.hoursProvenance || {};
      wrap.append(srcLine('Of the ' + bizList.length + ' records in data/businesses.json, '
        + (p.published || 0) + ' carry hours the business or agency published itself and '
        + (p.listed || 0) + ' carry hours somebody else published. ' + (p.estimate || 0) + ' are the '
        + 'twin\'s estimate and ' + (p.none || 0) + ' carry no week at all. '
        + (bz.hoursReviewed ? 'Last reviewed ' + bz.hoursReviewed + '. ' : '')
        + 'Ages are counted against ' + moment.countedAgainst + '.'));
      return wrap;
    }

    /* ---- the footer ----------------------------------------------------- */

    function drawFoot() {
      foot.textContent = '';
      const wantOpen = opensOnStart();
      const toggleBtn = el('button', {
        class: 'btn td-pref', type: 'button', 'aria-pressed': wantOpen ? 'true' : 'false',
        onclick: () => { setOpensOnStart(!opensOnStart()); drawFoot(); }
      }, wantOpen ? 'Opens when the island starts' : 'Does not open at the start');

      foot.append(
        el('p', { class: 'td-legend' },
          el('strong', {}, 'Real on this screen: '),
          'the date, the day, the season, the school calendar, the tide, the sun and the moon, the '
          + 'published timetable, the events with their organiser and their source, and the '
          + 'published opening hours. ',
          el('strong', {}, 'A simulation: '),
          'the conditions, and nothing else here. Where the twin does not know, this screen says so '
          + 'rather than showing a number. Press Y for how all of it works.'),
        el('div', { class: 'td-actions' },
          toggleBtn,
          el('span', { class: 'td-hint' }, 'T brings this back at any time, and so does the Today button on the rail.'),
          el('button', { class: 'btn', type: 'button', onclick: () => toggle(false) }, 'Show me the island'))
      );
    }

    /* ---- and the mount handle ------------------------------------------- */

    drawFoot();
    world.bus.on('today:preference', () => { if (open) drawFoot(); });

    return {
      update() { paint(false); }
    };
  }
});

/* ==================================================================== style

   Two constraints shaped every number below and they pull in opposite directions: it has to work
   on a phone held at arm's length, and it has to be readable across a room, because the hypothesis
   this surface is testing is that it ends up on a screen on a wall. So the type is set in `clamp`
   against the viewport rather than in the fixed pixel scale in src/ui/design.css, which is sized
   for an instrument read at a glance while you are looking at something else. Everything else
   (colour, spacing rhythm, radius, edges, motion) comes straight from that file's tokens.

   The layout is one column on a phone in the order the brief set, and on a wide screen it becomes
   a two column grid with explicit placement, so the reading order in the document never changes
   and a screen reader and a phone both get the same sequence. */

const STYLE = `
.td-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(2px);
  z-index: 42; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.td-scrim.on { opacity: 1; pointer-events: auto; }

.td-board { position: fixed; inset: var(--board-inset); z-index: 43; display: flex; flex-direction: column;
  max-width: 1680px; margin: 0 auto; opacity: 0; transform: translateY(12px) scale(.995);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out);
  background: var(--s-1); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--edge); border-radius: var(--r-3); box-shadow: var(--shadow-3);
  color: var(--t); font-family: var(--f-ui); }
.td-board.on { opacity: 1; transform: none; pointer-events: auto; }
.td-board:focus { outline: none; }
@media (max-width: 900px) { .td-board { inset: 0; border-radius: 0; border: none; } }

/* ---- the moment ------------------------------------------------------- */
.td-head { padding: clamp(12px, 2.2vw, 22px) clamp(14px, 2.4vw, 28px) clamp(10px, 1.6vw, 16px);
  border-bottom: 1px solid var(--edge);
  background: linear-gradient(180deg, rgba(255,255,255,.045), transparent);
  display: grid; grid-template-columns: 1fr auto; gap: var(--sp-3); align-items: start; }
.td-head-side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-2); }
.td-eyebrow { font-size: clamp(10px, 1.1vw, 12px); letter-spacing: .2em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; }
.td-date { font-size: clamp(20px, 2.9vw, 34px); font-weight: 300; color: var(--t-hi); line-height: 1.15;
  margin-top: 2px; letter-spacing: .01em; }
.td-time { font-family: var(--f-num); font-size: clamp(26px, 4.2vw, 50px); font-weight: 300;
  color: var(--t-hi); line-height: 1.05; font-variant-numeric: tabular-nums; }
.td-tz { font-size: .34em; letter-spacing: .18em; color: var(--t-faint); margin-left: .5em;
  vertical-align: .9em; font-family: var(--f-ui); }
.td-context { font-size: clamp(12px, 1.35vw, 16px); color: var(--t-dim); margin-top: 4px; }
.td-mode { font: 700 clamp(11px, 1.2vw, 14px)/1 var(--f-ui); letter-spacing: .16em;
  padding: 6px 11px; border-radius: var(--r-pill); border: 1px solid currentColor; white-space: nowrap; }
.td-mode.tone-sea { color: var(--sea); }
.td-mode.tone-sun { color: var(--sun); }
.td-mode.tone-iron { color: var(--iron); }
.td-close { white-space: nowrap; }
.td-banner { grid-column: 1 / -1; margin-top: var(--sp-3); padding: var(--sp-3);
  border: 1px solid var(--sun); border-left-width: 4px; border-radius: var(--r-2);
  background: rgba(240,180,41,.09); color: var(--t-hi);
  font-size: clamp(13px, 1.5vw, 17px); line-height: 1.5; }

/* ---- the body grid ----------------------------------------------------- */
.td-body { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: 1fr;
  gap: clamp(10px, 1.4vw, 18px); padding: clamp(12px, 1.8vw, 22px) clamp(14px, 2.4vw, 28px); align-content: start; }
@media (min-width: 1040px) {
  .td-body { grid-template-columns: minmax(0, 1.32fr) minmax(0, 1fr); }
  .td-tide  { grid-column: 1; grid-row: 1; }
  .td-light { grid-column: 2; grid-row: 1; }
  .td-cond  { grid-column: 2; grid-row: 2; }
  .td-cross { grid-column: 1; grid-row: 2; }
  .td-on    { grid-column: 1; grid-row: 3; }
  .td-open  { grid-column: 2; grid-row: 3; }
}

.td-block { border: 1px solid var(--edge); border-radius: var(--r-3); padding: clamp(12px, 1.6vw, 20px);
  background: rgba(255,255,255,.022); min-width: 0; }
.td-block.is-modelled { border-style: dashed; border-color: var(--sun); border-left-width: 3px;
  border-left-style: solid; background: rgba(240,180,41,.05); }
.td-block-head { display: flex; align-items: baseline; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.td-block-head h3 { flex: 1; font-size: clamp(11px, 1.15vw, 13px); letter-spacing: .18em;
  text-transform: uppercase; color: var(--t-dim); font-weight: 600; }
.td-chip { font: 700 clamp(9px, .95vw, 11px)/1 var(--f-ui); letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 7px; border-radius: var(--r-pill); border: 1px solid currentColor; white-space: nowrap; }
.td-chip.real { color: var(--sea); }
.td-chip.modelled { color: var(--sun); }

.td-src { font-size: clamp(10px, 1.05vw, 12px); line-height: 1.55; color: var(--t-faint);
  margin-top: var(--sp-3); padding-top: var(--sp-2); border-top: 1px solid var(--edge); }
.td-none { font-size: clamp(13px, 1.45vw, 17px); line-height: 1.55; color: var(--t-dim);
  padding: var(--sp-2) 0; }
.td-note { font-size: clamp(11px, 1.2vw, 14px); line-height: 1.55; color: var(--t-dim); margin-top: var(--sp-2); }
.td-warn { font-size: clamp(11px, 1.25vw, 14px); line-height: 1.55; color: var(--sun); margin-top: var(--sp-2); }

/* ---- the tide, which gets the room ------------------------------------- */
.td-hero { display: flex; align-items: baseline; gap: .28em; flex-wrap: wrap; }
.td-hero-num { font-family: var(--f-num); font-size: clamp(46px, 8.5vw, 96px); font-weight: 300;
  line-height: 1; color: var(--sea); font-variant-numeric: tabular-nums; }
.td-hero-unit { font-family: var(--f-num); font-size: clamp(20px, 3vw, 34px); color: var(--sea); opacity: .75; }
.td-hero-word { font-size: clamp(18px, 2.6vw, 30px); color: var(--t-hi); font-weight: 300; }
.td-hero-word.up::before { content: '\\25B2'; font-size: .6em; margin-right: .35em; color: var(--sea); }
.td-hero-word.down::before { content: '\\25BC'; font-size: .6em; margin-right: .35em; color: var(--sea); }
.td-second { font-size: clamp(16px, 2.1vw, 25px); line-height: 1.4; color: var(--t); margin-top: var(--sp-2); }
.td-second strong { color: var(--t-hi); font-weight: 500; }
.td-stations { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); margin-top: var(--sp-3); }
.td-station { display: flex; flex-direction: column; gap: 1px; }
.td-station .k { font-size: clamp(9px, .95vw, 11px); letter-spacing: .12em; text-transform: uppercase; color: var(--t-faint); }
.td-station .v { font-family: var(--f-num); font-size: clamp(13px, 1.5vw, 17px); color: var(--t-hi); }

/* ---- light and conditions ---------------------------------------------- */
.td-pair-row { display: flex; flex-wrap: wrap; gap: var(--sp-3) clamp(16px, 2.4vw, 34px); margin-top: var(--sp-2); }
.td-pair { display: flex; flex-direction: column; gap: 1px; }
.td-pair .k { font-size: clamp(9px, .95vw, 11px); letter-spacing: .13em; text-transform: uppercase; color: var(--t-faint); }
.td-pair .v { font-family: var(--f-num); font-size: clamp(20px, 2.6vw, 30px); font-weight: 300; color: var(--t-hi);
  font-variant-numeric: tabular-nums; }
.td-cond-line { font-size: clamp(14px, 1.7vw, 19px); color: var(--t-hi); font-weight: 300; }
/* How old the number under it is. Same three standings the businesses block uses for opening hours,
   same three colours, because a reader should not have to learn the idea twice on one screen. */
.td-age { font-size: clamp(9px, 1vw, 11px); color: var(--t-faint); margin-top: 2px; }
.td-age.ageing { color: var(--sun); }
.td-age.stale { color: var(--coral); }

/* ---- the crossing ------------------------------------------------------ */
.td-legs { display: grid; grid-template-columns: 1fr; gap: var(--sp-2); }
@media (min-width: 620px) { .td-legs { grid-template-columns: 1fr 1fr; gap: var(--sp-2) clamp(16px, 2.2vw, 30px); } }
.td-leg { display: flex; flex-direction: column; gap: 1px; padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--edge); }
.td-leg .k { font-size: clamp(9px, .95vw, 11px); letter-spacing: .13em; text-transform: uppercase; color: var(--t-faint); }
.td-leg .v { font-family: var(--f-num); font-size: clamp(26px, 4vw, 44px); font-weight: 300; color: var(--t-hi);
  line-height: 1.05; font-variant-numeric: tabular-nums; }
.td-leg .in { font-size: clamp(11px, 1.25vw, 15px); color: var(--sea); }
.td-leg .none { font-size: clamp(17px, 2.4vw, 26px); color: var(--t-faint); font-weight: 300; line-height: 1.15; }
/* What comes after the next one. The reason the passenger group reads as "and there are plenty
   more" and the vehicle group reads as "that is nearly it", which is the whole distinction. */
.td-leg .then { font-size: clamp(10px, 1.15vw, 13px); color: var(--t-dim); line-height: 1.45; }
.td-leg .then.last { color: var(--sun); }
.td-leg.empty { opacity: .9; }
.td-lede { font-size: clamp(12px, 1.4vw, 16px); line-height: 1.5; color: var(--t); margin-bottom: var(--sp-2); }
.td-cross .td-sub:first-of-type { margin-top: var(--sp-2); }

/* ---- what is on -------------------------------------------------------- */
.td-sub { font-size: clamp(10px, 1.05vw, 12px); letter-spacing: .16em; text-transform: uppercase;
  color: var(--sea); font-weight: 600; margin: var(--sp-3) 0 var(--sp-2); }
.td-cards { display: grid; grid-template-columns: 1fr; gap: var(--sp-2); }
@media (min-width: 760px) { .td-cards { grid-template-columns: 1fr 1fr; } }
.td-card { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3);
  background: rgba(255,255,255,.028); min-width: 0; }
.td-card-name { font-size: clamp(15px, 1.8vw, 21px); color: var(--t-hi); font-weight: 500; line-height: 1.25; }
.td-card-when { font-size: clamp(11px, 1.25vw, 14px); color: var(--t); margin-top: 3px; }
.td-card-org { font-size: clamp(11px, 1.2vw, 13px); color: var(--t-dim); margin-top: 3px; }
.td-card-cultural { font-size: clamp(10px, 1.1vw, 12px); line-height: 1.55; color: var(--heath);
  margin-top: var(--sp-2); }
.td-card-src { font-size: clamp(9px, 1vw, 11px); color: var(--t-faint); margin-top: var(--sp-2);
  word-break: break-word; }
.td-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--sp-2); }
.td-tag { font: 600 clamp(8px, .9vw, 10px)/1.5 var(--f-ui); letter-spacing: .06em;
  padding: 2px 6px; border-radius: var(--r-pill); border: 1px solid var(--edge-strong); color: var(--t-faint); }
.td-tag.warn { border-color: var(--sun); color: var(--sun); }

/* ---- what is open ------------------------------------------------------ */
.td-open-list { display: flex; flex-direction: column; }
.td-open-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px var(--sp-2);
  padding: 6px 0; border-bottom: 1px solid var(--edge); }
.td-open-row .n { font-size: clamp(13px, 1.5vw, 17px); color: var(--t-hi); font-weight: 500; }
.td-open-row .u { font-family: var(--f-num); font-size: clamp(11px, 1.25vw, 14px); color: var(--sea); }
.td-open-row .w { font-size: clamp(10px, 1.1vw, 12px); color: var(--t-faint); }
.td-open-row .f { font-size: clamp(9px, 1vw, 11px); color: var(--t-faint); margin-left: auto; white-space: nowrap; }
.td-open-row .f.ageing { color: var(--sun); }
.td-open-row .f.stale { color: var(--coral); }
.td-guess { margin-top: var(--sp-3); padding: var(--sp-3); border: 1px dashed var(--edge-strong);
  border-radius: var(--r-2); background: rgba(255,255,255,.014); }
.td-guess-head { font-size: clamp(10px, 1.05vw, 12px); letter-spacing: .14em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; }
.td-guess-note { font-size: clamp(10px, 1.1vw, 12px); line-height: 1.55; color: var(--t-faint); margin: 4px 0 var(--sp-2); }
.td-guess-list { font-size: clamp(11px, 1.15vw, 13px); line-height: 1.7; color: var(--t-dim); }

/* ---- the footer -------------------------------------------------------- */
.td-foot { border-top: 1px solid var(--edge); padding: clamp(10px, 1.4vw, 16px) clamp(14px, 2.4vw, 28px);
  display: flex; flex-direction: column; gap: var(--sp-2);
  background: linear-gradient(0deg, rgba(255,255,255,.03), transparent); }
.td-legend { font-size: clamp(10px, 1.1vw, 13px); line-height: 1.6; color: var(--t-faint); max-width: 118ch; }
.td-legend strong { color: var(--t-dim); font-weight: 600; }
.td-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
.td-hint { flex: 1; font-size: clamp(10px, 1.05vw, 12px); color: var(--t-faint); }

/* A phone in the hand. The grid is already one column; this trims the chrome so the tide and the
   crossing are both above the fold on a 375 by 812 screen, which is the device the five second
   test is written for. */
@media (max-width: 620px) {
  .td-head { grid-template-columns: 1fr; }
  .td-head-side { flex-direction: row; align-items: center; justify-content: space-between; }
  .td-actions { gap: var(--sp-2); }
  .td-hint { flex-basis: 100%; order: 3; }
}
`;
