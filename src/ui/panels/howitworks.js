// How it works. The introduction to the machine, given to somebody who has just arrived.
//
// The arrival screens in src/ui/panels/onboarding.js are the first ninety seconds: the
// acknowledgement, where this is, three doors and the keys. This is the other half, and it is the
// part the owner asked for first, because none of the rest is legible without it. Seven sections,
// under five minutes, and the whole of it is the answer to one question: how much should you
// believe the number in front of you.
//
// SIX DECISIONS, SO THE NEXT AGENT DOES NOT REDISCOVER THEM.
//
// 1. IT IS A SHEET, NOT A BOARD. Every other explanatory surface in this build is a full screen
//    board that covers the island. This one must not be, because six of its seven sections are
//    about something you can see out the window, and a wall of text explaining an island you
//    cannot see is the failure mode. It docks to the right, the width of the inspector plus a
//    little, and the island stays on screen with the camera pointed at whatever the section is
//    about. The minimap is the one thing that would sit underneath it, so it stands down while
//    this is open and comes straight back.
//
// 2. THE CAMERA GOES TO THE SUBJECT, NOT TO THE SUBURB, and you can turn that off. The first pass
//    of this file flew to four township-sized bookmarks and the result was fair comment: the time
//    section pointed at a headland stump in the corner of an empty ocean, and the data section held
//    the whole of Dunwich from 1250 m up. Both are now framed on the thing being described. Time
//    stands on the North Gorge walk looking down the slot to the sea. The data section stands over
//    the Junner Street ramp, and swings to take in a vessel when there is one on the water. Real,
//    modelled and proposed stands on the actual premises whose published hours the card quotes.
//    Decision rights stands on the Amity Point shoreline, on the houses and the rock wall, because
//    three of the levers there are about that beach and every one belongs to the council.
//
//    Every anchor is a coordinate out of a pack, projected through `world.island.project`, which is
//    the same projection the traffic system uses to put the barge on the water. Nothing in this
//    file carries a coordinate of its own. The shot is composed around the sheet rather than
//    centred: see `flyFor` for the offset and for the Amity Point framing that made it necessary.
//
// 3. THE SHEET SAYS WHAT IS OUT THE WINDOW, INCLUDING WHEN THERE IS NOTHING TO SEE. This build
//    opens at 05:20 against a 05:39 sunrise, so the honest first thing this panel can say is that
//    the island is not lit yet, how long that has to run, and here is the way to the light. That is
//    the strip under the tabs. It names the subject the camera is on, and when the sun is under the
//    horizon it says so and offers the jump to sunrise. A screen whose whole premise is "with the
//    island in front of you", pointed at a black rectangle and saying nothing about it, is the one
//    failure this panel cannot afford.
//
// 3. NOTHING IN THE COPY IS TYPED IN THAT THE WORLD ALREADY KNOWS. The lever split, the hours that
//    are a guess, the businesses nobody could confirm, the acknowledgement, the tide: all read out
//    of the packs and the read models at the moment you look at them. A screen that explains the
//    data by hand-copying it is the first thing to go stale, and the twin would then be lying
//    about honesty, which is the worst available failure.
//
// 4. THE TIME SECTION DEMONSTRATES RATHER THAN DESCRIBES. There is a button that parks the clock
//    six hours ahead and a button that comes back. While it is parked you can watch the tide and
//    the sun follow the scrub exactly and the wind and the barge refuse to, which is the single
//    hardest idea in this build and cannot be explained in a paragraph. It goes through
//    `world.time`, the same control the bar uses, so it is a declared scrub with the mode chip
//    changing and the record written; it is not a private back door into the clock.
//
// 5. THE WAY BACK WORKS WHOEVER PARKED THE CLOCK. `backToPresent()` used to return early unless
//    this panel was the thing that scrubbed, so a person who dragged the ribbon, opened this sheet
//    and pressed the button that says "back to the island's present" got nothing, with no way to
//    tell a dead control from a working one. The button now always calls `world.time.toPresent()`,
//    which is a no-op when the clock is already at the present, and it says which of those two
//    things it is about to do. Closing the sheet is the one place the old caution still applies: a
//    panel that yanked somebody out of their own scrub because they shut a window would be worse
//    than one that leaves it, so on close it only puts back a scrub it made itself.
//
// Reachable with `Y`, from the last arrival screen, and from Settings. Not shown automatically:
// arriving somewhere and being handed a manual is how a person decides not to read it.

import { registerPanel, el } from '../mount.js';
import { islandDateText, islandTimeText, spanText, ISLAND_TZ, MINUTES_PER_DAY, TICK_MINUTES } from '../../kernel/clock.js';

/* ------------------------------------------------------------------ shared furniture */

/** The launcher rail, built by whichever panel mounts first. Its look lives in src/ui/design.css. */
function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** The only place a number becomes text here. Absent is a dash, never NaN and never a stale value. */
function num(v, dp = 0) { return isNum(v) ? v.toFixed(dp) : '–'; }
const CAMERA_KEY = 'twin.howitworks.camera';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-08-10` as `10 August 2026`. An ISO date in front of a reader is a date nobody reads. */
function plainDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

/** `1 page`, `484 pages`. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/** `1356` as `1,356`. Four figures on a screen without a comma read as a year. */
function thousands(n) { return isNum(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '–'; }

/** A pack, or null. Every read in this file goes through here so a missing pack degrades visibly. */
function pack(world, id) {
  const d = world.data;
  return (d && d[id] && typeof d[id] === 'object') ? d[id] : null;
}

/* ------------------------------------------------------------------ the light on the island */

// How long after sunrise before there is enough light on the ground to see the island by. Sunrise
// itself is not it: the sun's centre is still under the horizon at the tick it is published for,
// and the headland at 5:40am is the same silhouette it was at 5:20am. Twenty minutes puts the sun
// four to six degrees up depending on the season, which is where the walkway, the roofs and the
// surf start to read at all. It is still a low sun and the strip goes on saying so.
const LIGHT_AFTER_SUNRISE_MIN = 20;

/**
 * Whether there is anything to see out there, and what to say if not. Null once the sun is properly
 * up, which is taken as six degrees of elevation: below that the ground is still mostly shadow.
 *
 * The horizon test is the one `src/systems/environment/daylight.js` uses for `isDay`: the sun's
 * upper limb clears the horizon at about minus fifty minutes of arc, which is minus 0.833 of a
 * degree of centre elevation. Below that the ground is unlit, and this build opens nineteen minutes
 * under it, which is the whole reason this exists. Exported because the arrival screens have the
 * same problem and two copies of this rule would drift apart inside a week.
 */
export function lightGate(world) {
  const d = (world && world.read) ? (world.read('daylight') || {}) : {};
  const c = world && world.clock;
  if (!isNum(d.elevationDeg) || d.elevationDeg > 6) return null;
  // Above the horizon but low. Nothing to fix and nothing to offer, but worth a line: a person who
  // has just jumped to sunrise and found the island still brown and shadowed should be told that is
  // the hour rather than left to conclude the twin cannot light itself.
  if (d.elevationDeg > -0.833) {
    const up = Math.max(1, Math.round(d.elevationDeg));
    return {
      low: true, jump: null,
      text: 'The sun is ' + up + (up === 1 ? ' degree' : ' degrees') + ' up, so most of the ground '
        + 'is still in its own shadow. That is the hour, not the twin.'
    };
  }
  const deg = Math.round(Math.abs(d.elevationDeg));
  const under = 'The sun is ' + deg + (deg === 1 ? ' degree' : ' degrees') + ' under the horizon';
  const mod = c ? c.minuteOfDay : null;
  const rise = isNum(d.sunriseMin) ? d.sunriseMin % MINUTES_PER_DAY : null;
  const set = isNum(d.sunsetMin) ? d.sunsetMin % MINUTES_PER_DAY : null;
  if (rise === null || mod === null) {
    return { low: false, jump: null,
      text: under + ', so the island out there is silhouette and sky rather than ground.' };
  }
  const beforeSunrise = mod < rise;
  // Forward to the next sunrise: later today if it has not happened, otherwise tomorrow's.
  const toRise = beforeSunrise ? rise - mod : (MINUTES_PER_DAY - mod) + rise;
  // The clock only stops on ticks, so round the landing up to one. Without this the button offered
  // 5:59am and the scrub, snapping, put the island at 6:00am: a small lie, and the wrong kind.
  const raw = mod + toRise + LIGHT_AFTER_SUNRISE_MIN;
  const target = Math.ceil(raw / TICK_MINUTES) * TICK_MINUTES;
  const ahead = target - mod;
  const when = islandTimeText(rise);
  const lands = islandTimeText(target);
  const text = beforeSunrise
    ? under + '. Sunrise is at ' + when + (toRise >= 1 ? ', ' + spanText(toRise) + ' off' : '')
      + '. What is out there is sky and silhouette, not ground.'
    : under + '. It set at ' + (set === null ? 'sunset' : islandTimeText(set))
      + '. The next sunrise is at ' + when + ', ' + spanText(toRise) + ' away.';
  return { low: false, text, jump: { label: 'Take the clock to ' + lands, minutes: ahead, at: lands } };
}

/* ------------------------------------------------------------------ standing somewhere real

   Everything below turns a record in a pack into metres on the ground. `world.island.project` is
   the projection the whole build shares: the traffic system puts the barge on the water with it,
   so a camera anchor worked out here lands in the same place as the thing it is meant to be
   looking at. Every one of these can return null, and a section whose anchor is missing simply
   does not move the camera rather than flying somewhere nobody asked for. */

function localOf(world, lon, lat) {
  const isl = world.island;
  if (!isl || typeof isl.project !== 'function' || !isNum(lon) || !isNum(lat)) return null;
  try {
    const p = isl.project(lon, lat);
    return isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
  } catch (e) { return null; }
}

/** A named record out of data/places.json. `north-gorge`, `amity-erosion-zone`, `dunwich`. */
function placeAt(world, id) {
  const pk = pack(world, 'places');
  const list = pk && Array.isArray(pk.places) ? pk.places : [];
  const p = list.find((q) => q && q.id === id);
  return p ? localOf(world, p.lon, p.lat) : null;
}

/** A terminal out of data/transport.json. The Junner Street ramp is `terminal-junner-street`. */
function terminalAt(world, id) {
  const pk = pack(world, 'transport');
  const list = pk && Array.isArray(pk.terminals) ? pk.terminals : [];
  const t = list.find((q) => q && q.id === id);
  return t ? localOf(world, t.lon, t.lat) : null;
}

/**
 * The camera's own coarse place list, which is the last resort.
 *
 * It holds seventeen townships and beaches rounded to about a hundred metres, and its `gorge` entry
 * sits some seven hundred metres north of the gorge in data/places.json. That gap is exactly what
 * put the first pass of the time section out over open water, so it is a fallback for when a pack
 * has not loaded and never the first choice.
 */
function coarsePlace(world, id) {
  try {
    const list = world.camera && world.camera.places ? world.camera.places() : null;
    const p = list && list.find((q) => q.id === id);
    return p && isNum(p.x) ? { x: p.x, z: p.z } : null;
  } catch (e) { return null; }
}

/** Compass bearing from a to b, in the degrees `camera.flyTo` wants. */
function bearingDeg(a, b) {
  return ((Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI + 360) % 360;
}

/**
 * The nearest thing on the water to a point, out of the traffic read model, or null.
 *
 * The barge is not a fixture. A hull is spawned when a sailing departs and it is gone forty five
 * minutes later, so most of the time there is nothing on the crossing, and a scrubbed clock never
 * spawns one because a scrub does not tick. The data section frames the ramp either way and takes
 * in the vessel when there is one, which is the honest version of "the ramp and a barge".
 */
function vesselNear(world, at, withinM) {
  const t = world.read('traffic');
  const list = t && Array.isArray(t.vehicles) ? t.vehicles : [];
  let best = null, bestD = Infinity;
  for (const v of list) {
    // The read model hands out inspector cards rather than the simulation's own vehicles, and a
    // card carries `surface` and `kind` but no `mode`. Filtering on `mode` here found nothing ever,
    // which is how a screen ends up saying nothing is alongside with a hull plainly in the frame.
    if (!v || !isNum(v.x) || !isNum(v.z)) continue;
    if (v.surface !== 'water' && v.kind !== 'barge' && v.kind !== 'water-taxi') continue;
    const d = Math.hypot(v.x - at.x, v.z - at.z);
    if (d < bestD) { best = { x: v.x, z: v.z, label: v.label || 'a vessel', d }; bestD = d; }
  }
  return best && bestD <= withinM ? best : null;
}

// How close a hull has to be before the camera opens up to take it in as well as the ramp. Past
// this the two of them together are a kilometre of bay, which is the shot this section was pulled
// up for in the first place, so beyond it the camera holds the ramp and the sheet says in words
// where the boat is.
const VESSEL_IN_FRAME_M = 700;

/**
 * The business the "Real" card quotes, chosen once and used twice: the card names it and the camera
 * stands on it. Picking it in two places would let the sheet describe one pub and point at another.
 */
function realExample(world) {
  const biz = pack(world, 'businesses');
  const list = (biz && Array.isArray(biz.businesses)) ? biz.businesses : [];
  return list.find((b) => b && b.typical_hours && b.typical_hours.basis === 'published'
    && b.status === 'trading') || null;
}

/* ------------------------------------------------------------------ the seven sections

   Each one names where the camera should stand, what it is about, and one live line saying what is
   out the window at this moment. `frame` is null for the last one, which is the point of the last
   one. */

const SECTIONS = [
  {
    id: 'what', tab: 'What this is', title: 'What this is',
    place: 'The whole island',
    frame: () => ({ island: true }),
    look: () => 'The whole island, from Mooloomba on the north east corner to Jumpinpin in the '
      + 'south. Everything the next six screens point at is somewhere in this frame.'
  },
  {
    // The walk, and the slot it runs around. Framed from above the track looking east south east,
    // down the gorge and out to the Coral Sea, which is also where the light comes from before
    // sunrise: the one direction that is worth pointing a camera at on a dark morning.
    id: 'time', tab: 'Time', title: 'How time works',
    place: 'The North Gorge walk, Point Lookout (Mooloomba)',
    frame: (w) => {
      const a = placeAt(w, 'north-gorge') || coarsePlace(w, 'gorge');
      return a ? { x: a.x, z: a.z, dist: 200, heading: 108, pitchBias: 0.04 } : null;
    },
    look: (w) => {
      const c = w.read('crowd') || {};
      const g = c.gorge || {};
      const km = isNum(g.lengthKm) ? g.lengthKm.toFixed(1) + ' km of track' : 'the headland track';
      if (!isNum(g.people)) return 'The gorge walk, ' + km + '.';
      return 'The gorge walk, ' + km + ', '
        + (g.people === 0 ? 'nobody on it' : g.people + (g.people === 1 ? ' person' : ' people') + ' on it')
        + ' at this moment.';
    }
  },
  {
    id: 'data', tab: 'The data', title: 'Where the numbers come from',
    place: 'The Junner Street ramp, Dunwich (Goompi)',
    frame: (w) => {
      const a = terminalAt(w, 'terminal-junner-street') || placeAt(w, 'dunwich-barge-ramp')
        || coarsePlace(w, 'dunwich');
      if (!a) return null;
      const boat = vesselNear(w, a, VESSEL_IN_FRAME_M);
      if (boat && boat.d > 120) {
        // Both in one frame: pivot on the midpoint, look along the line between them, and stand
        // back about as far as they are apart.
        return {
          x: (a.x + boat.x) / 2, z: (a.z + boat.z) / 2,
          dist: Math.max(190, boat.d * 0.95),
          heading: bearingDeg(a, boat), pitchBias: 0.22
        };
      }
      return { x: a.x, z: a.z, dist: 150, heading: 58, pitchBias: 0.16 };
    },
    look: (w) => {
      const a = terminalAt(w, 'terminal-junner-street');
      const boat = a ? vesselNear(w, a, 12000) : null;
      const f = w.read('ferry') || {};
      const next = f.next && f.next.toIsland;
      if (boat && boat.d < 240) return 'The ramp, with the ' + boat.label + ' alongside it.';
      if (boat && boat.d <= VESSEL_IN_FRAME_M) return 'The ramp, and the ' + boat.label + ' coming in.';
      if (boat) return 'The ramp, and the ' + boat.label + ' out on the crossing, '
        + (boat.d / 1000).toFixed(1) + ' km off, too far out to be in this frame.';
      const st = w.time ? w.time.status() : null;
      if (st && st.scrubbing) return 'The ramp, with nothing on the water. The clock is parked, and '
        + 'a boat is one of the things that stays at the island’s present rather than following you.';
      return 'The ramp, with nothing on the water'
        + (next && next.time ? '. The next vehicle sailing over is the ' + next.time + '.' : '.');
    }
  },
  {
    // On the premises the Real card quotes, not on the township it sits in. The point of the
    // section is that you can tell a published fact from a modelled one on sight, and the published
    // fact on screen belongs to a building you are looking at.
    id: 'registers', tab: 'Real or not', title: 'Real, modelled, proposed',
    place: 'Point Lookout (Mooloomba)',
    frame: (w) => {
      const b = realExample(w);
      const a = b ? localOf(w, b.lon, b.lat) : null;
      if (a) return { x: a.x, z: a.z, dist: 190, heading: 20, pitchBias: 0.06 };
      const t = placeAt(w, 'point-lookout') || coarsePlace(w, 'pointlookout');
      return t ? { x: t.x, z: t.z, dist: 520, heading: 20, pitchBias: 0.16 } : null;
    },
    look: (w) => {
      const b = realExample(w);
      const p = w.read('population') || {};
      const who = b ? b.name : 'the premises on this front';
      return who + ' is out there because a record says where. The '
        + (isNum(p.residents) ? thousands(p.residents) + ' residents' : 'residents')
        + ' behind it are modelled.';
    }
  },
  {
    // The shoreline itself: the houses, the road behind them and the rock wall on the beach. The
    // erosion levers are about that hundred metres and not about the township in general.
    id: 'levers', tab: 'Your part', title: 'What you can actually change',
    place: 'The Amity Point (Pulan) shoreline',
    frame: (w) => {
      const a = placeAt(w, 'amity-erosion-zone') || placeAt(w, 'amity-point') || coarsePlace(w, 'amity');
      return a ? { x: a.x, z: a.z, dist: 260, heading: 210, pitchBias: 0.1 } : null;
    },
    look: () => 'The houses, the road behind them, and the rock wall on the beach.'
  },
  {
    id: 'contribute', tab: 'Your turn', title: 'How to put something in',
    place: 'Dunwich (Goompi)',
    frame: (w) => {
      const a = placeAt(w, 'dunwich') || coarsePlace(w, 'dunwich');
      return a ? { x: a.x, z: a.z, dist: 300, heading: 236, pitchBias: 0.24 } : null;
    },
    look: (w) => {
      const biz = pack(w, 'businesses');
      const list = (biz && Array.isArray(biz.businesses)) ? biz.businesses : [];
      const here = list.filter((b) => b && b.status !== 'closed' && b.status !== 'proposed'
        && !isNum(b.lat) && /dunwich|goompi/i.test(String(b.township || ''))).length;
      if (!here) return 'Dunwich, where the boats land and most of the island’s work happens.';
      return here + ' of the premises in the pack are somewhere in this view and the pack cannot '
        + 'say where. That is the sort of gap this screen is about.';
    }
  },
  {
    id: 'boundary', tab: 'What it refuses', title: 'What this project will not do',
    place: 'The camera stays where it is',
    frame: null,
    look: () => 'Wherever you left it. Nothing on this screen is somewhere this project is '
      + 'entitled to point a camera.'
  }
];

/* ================================================================== the panel */

registerPanel({
  id: 'howitworks',
  order: 48,
  mount(root, world) { return mountHowItWorks(root, world); }
});

function mountHowItWorks(root, world) {
  injectStyle();

  /* ---- shell ------------------------------------------------------------ */

  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'How it works (y)', onclick: () => toggle()
  }, 'How it works');
  rail().append(launcher);

  const sheet = el('section', {
    class: 'panel hiw', role: 'dialog', tabindex: '-1', 'aria-label': 'How it works'
  });
  root.append(sheet);

  const stepLabel = el('div', { class: 'hiw-step' });
  const head = el('div', { class: 'hiw-top' },
    el('div', { class: 'hiw-head-txt' },
      el('div', { class: 'hiw-kicker' }, 'How it works'),
      stepLabel),
    el('button', { class: 'btn ghost icon', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => toggle(false) }, '×'));

  const tabs = el('div', { class: 'hiw-tabs' });

  // The window strip. What the camera is on, and whether there is any light on it. Built once and
  // repainted with the rest of the sheet, because the answer changes every tick.
  const winSubject = el('div', { class: 'hiw-win-s' });
  const winLight = el('div', { class: 'hiw-win-l' });
  const winActs = el('div', { class: 'hiw-win-a' });
  const windowStrip = el('div', { class: 'hiw-win' },
    el('div', { class: 'hiw-win-k' }, 'Out the window'), winSubject, winLight, winActs);

  const body = el('div', { class: 'hiw-body scroll' });

  const btnBack = el('button', { class: 'btn ghost', type: 'button', onclick: () => go(at - 1) }, 'Back');
  const btnNext = el('button', { class: 'btn hiw-next', type: 'button', onclick: () => go(at + 1) }, 'Next');
  const camToggle = el('button', {
    class: 'btn ghost hiw-cam', type: 'button', 'aria-pressed': 'true',
    onclick: () => { setCamera(!cameraFollows); if (cameraFollows) flyFor(SECTIONS[at]); }
  });
  const foot = el('div', { class: 'hiw-foot' }, btnBack, camToggle, btnNext);

  sheet.append(head, tabs, windowStrip, body, foot);

  let open = false;
  let at = 0;
  let refresh = null;          // the live repaint for the section on screen, or null
  let scrubbedByUs = false;    // this panel parked the clock, so this panel puts it back
  let cameraFollows = true;
  try { cameraFollows = localStorage.getItem(CAMERA_KEY) !== '0'; } catch (e) { /* private browsing is fine */ }

  function setCamera(v) {
    cameraFollows = !!v;
    try { localStorage.setItem(CAMERA_KEY, cameraFollows ? '1' : '0'); } catch (e) { /* fine */ }
    paintCamToggle();
  }
  function paintCamToggle() {
    camToggle.textContent = cameraFollows ? 'Camera follows' : 'Camera stays';
    camToggle.setAttribute('aria-pressed', cameraFollows ? 'true' : 'false');
    camToggle.classList.toggle('on', cameraFollows);
    camToggle.title = cameraFollows
      ? 'Each section flies the camera to the place it is about. Click to stop it.'
      : 'The camera stays where you left it. Click to let each section move it.';
  }

  /**
   * Fly to whatever the section is about, composed for a sheet that is covering the right hand
   * third of the screen.
   *
   * Without the offset below, the camera does exactly what F1 to F4 do, and at Amity Point that put
   * the whole township behind the sheet: the section explaining that three erosion levers belong to
   * the council pointed at houses nobody could see. So the pivot is pushed along the camera's own
   * right, which slides the subject into the half a reader still has. The direction was measured
   * rather than derived: at heading h, screen right runs along (cos h, minus sin h) in world x and
   * z, and a fifth of the orbit distance moves the subject about a quarter of a frame.
   *
   * Not applied on a narrow screen, where the sheet docks along the bottom and the frame is whole.
   * Guarded throughout: a section that cannot move the camera still reads perfectly, and a section
   * whose anchor is missing leaves the camera where it is rather than guessing.
   */
  function flyFor(sec) {
    if (!cameraFollows || !sec || typeof sec.frame !== 'function' || !world.camera) return;
    let spec = null;
    try { spec = sec.frame(world); } catch (e) { console.warn('[howitworks] frame failed', sec.id, e); }
    if (!spec) return;
    try {
      if (spec.island) { world.camera.frameIsland(); return; }
      const o = Object.assign({ dur: 2.2 }, spec);
      const narrow = typeof innerWidth === 'number' && innerWidth <= 860;
      if (!narrow && isNum(o.heading) && isNum(o.dist) && isNum(o.x)) {
        const rad = (o.heading * Math.PI) / 180;
        const k = 0.2 * o.dist;
        o.x += Math.cos(rad) * k;
        o.z -= Math.sin(rad) * k;
      }
      world.camera.flyTo(o);
    } catch (e) { console.warn('[howitworks] camera not ready', e); }
  }

  const darkness = () => lightGate(world);

  function toggle(force) {
    open = force === undefined ? !open : !!force;
    sheet.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    document.body.classList.toggle('twin-explainer', open);
    if (open) {
      world.bus.emit('ui:drawer', { id: 'howitworks' });
      draw();
      flyFor(SECTIONS[at]);
      sheet.focus({ preventScroll: true });
    } else {
      // Leaving somebody parked in a projection after they have read an explanation of what a
      // projection is would be a poor joke. If this panel moved the clock, this panel moves it back.
      backToPresent({ onClose: true });
    }
  }

  function go(n) {
    const next = Math.max(0, Math.min(SECTIONS.length - 1, n));
    if (next === at && open) return;
    at = next;
    draw();
    flyFor(SECTIONS[at]);
    body.scrollTop = 0;
  }

  /**
   * Back to the moment the island has actually lived to.
   *
   * `onClose` is the cautious call: it only puts back a scrub this panel made, because dragging
   * somebody out of their own parked moment for shutting a window is worse than leaving them in it.
   * Everywhere else it always calls through, and `world.time.toPresent()` is a no-op when the clock
   * is already there, so the button is never a control that silently does nothing.
   */
  function backToPresent(opts = {}) {
    if (opts.onClose && !scrubbedByUs) return;
    scrubbedByUs = false;
    try { if (world.time) world.time.toPresent(); } catch (e) { /* the bar will still tell the truth */ }
  }

  /** Park the clock somewhere, through the same control the ribbon uses. */
  function scrubBy(minutes) {
    if (!world.time || !isNum(minutes) || minutes === 0) return;
    world.time.scrubBy(Math.round(minutes));
    scrubbedByUs = true;
    paintWindow();
    if (refresh) refresh();
  }

  /* ---- the window strip -------------------------------------------------- */

  function paintWindow() {
    const sec = SECTIONS[at];
    const dark = darkness();
    const st = world.time ? world.time.status() : null;
    const parked = !!(st && st.scrubbing);

    if (!cameraFollows && sec.frame) {
      winSubject.textContent = 'The camera is where you left it. This screen is about '
        + sec.place.replace(/^The /, 'the ') + '.';
    } else {
      let line = '';
      try { line = sec.look ? sec.look(world) : ''; } catch (e) { line = ''; }
      winSubject.textContent = line || sec.place;
    }

    winLight.textContent = dark ? dark.text : '';
    winLight.classList.toggle('on', !!dark);
    winLight.classList.toggle('soft', !!(dark && dark.low));
    windowStrip.classList.toggle('dark', !!(dark && !dark.low));

    winActs.textContent = '';
    if (dark && dark.jump) {
      winActs.append(el('button', {
        class: 'btn hiw-win-go', type: 'button',
        title: 'Parks the clock at sunrise. A declared scrub, on the record, and you can come '
          + 'straight back.',
        onclick: () => scrubBy(dark.jump.minutes)
      }, dark.jump.label));
    }
    if (parked) {
      winActs.append(el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { backToPresent(); paintWindow(); if (refresh) refresh(); }
      }, 'Back to the island’s present'));
    }
    winActs.classList.toggle('on', winActs.childNodes.length > 0);
  }

  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'howitworks' && open) toggle(false); });
  world.bus.on('ui:open', (p) => {
    if (!p || p.id !== 'howitworks') return;
    const want = SECTIONS.findIndex((s) => s.id === p.section);
    at = want >= 0 ? want : 0;
    toggle(true);
  });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); return; }
    if (e.code === 'KeyY') { toggle(); e.preventDefault(); }
  });

  /* ---- drawing ---------------------------------------------------------- */

  function draw() {
    const sec = SECTIONS[at];
    stepLabel.textContent = (at + 1) + ' of ' + SECTIONS.length + '. ' + sec.place;

    tabs.textContent = '';
    for (let i = 0; i < SECTIONS.length; i++) {
      const s = SECTIONS[i];
      tabs.append(el('button', {
        class: 'hiw-tab' + (i === at ? ' on' : ''), type: 'button',
        title: s.title, onclick: () => go(i)
      }, s.tab));
    }

    body.textContent = '';
    refresh = null;
    try { refresh = DRAW[sec.id](body) || null; } catch (err) {
      body.append(el('p', { class: 'hiw-p warn' }, 'This section could not be drawn: ' + (err && err.message)));
      console.error('[howitworks] section failed', sec.id, err);
    }

    btnBack.disabled = at === 0;
    btnNext.textContent = at === SECTIONS.length - 1 ? 'Close' : 'Next';
    btnNext.onclick = at === SECTIONS.length - 1 ? () => toggle(false) : () => go(at + 1);
    paintCamToggle();
    paintWindow();
  }

  /* ---- small builders shared by the sections ---------------------------- */

  function h(text) { return el('h3', { class: 'hiw-h' }, text); }
  function p(...kids) { return el('p', { class: 'hiw-p' }, ...kids); }
  function lede(text) { return el('p', { class: 'hiw-lede' }, text); }
  function note(text) { return el('p', { class: 'hiw-note' }, text); }
  function chip(text, tone) { return el('span', { class: 'chip ' + (tone || 'iron') }, text); }

  /** A labelled fact with its own line. The workhorse of five of the seven sections. */
  function fact(k, v, sub) {
    return el('div', { class: 'hiw-fact' },
      el('div', { class: 'hiw-fact-k' }, k),
      el('div', { class: 'hiw-fact-v' }, v),
      sub ? el('div', { class: 'hiw-fact-s' }, sub) : null);
  }

  /** A card: a heading, a state chip, a body, and an example in the twin's own words. */
  function card(title, tone, state, ...kids) {
    return el('div', { class: 'hiw-card ' + tone },
      el('div', { class: 'hiw-card-h' }, el('b', {}, title), state ? chip(state, tone) : null),
      ...kids);
  }

  /* ============================================================ 1. what this is */

  const DRAW = {};

  DRAW.what = (root) => {
    root.append(
      lede('A twin of a real island, built out of public records, running whether or not you touch it.'),
      p('Minjerribah, North Stradbroke Island, in Moreton Bay east of Brisbane. Dunwich (Goompi) '
        + 'where the boats land, Amity Point (Pulan) on the northern corner, Point Lookout '
        + '(Mooloomba) on the headland. No bridge: everything that is not already here comes across '
        + 'on a barge.'));

    const live = el('div', { class: 'hiw-facts' });
    const liveKicker = el('div', { class: 'hiw-live-k' });
    root.append(el('div', { class: 'hiw-live' }, liveKicker, live));
    const liveNote = el('p', { class: 'hiw-note' });
    root.append(liveNote);

    root.append(
      h('Not a made-up place'),
      p('Every business, road, beach and boat in here is a real one out of a public record, and '
        + 'nothing was invented to fill a gap.'),
      h('Not the island either'),
      p('It is a model, built by people who do not live there, and it gets things wrong. What it '
        + 'can always tell you is where a number came from and how much weight it will hold. That '
        + 'is the next six screens.'));

    const paint = () => {
      const t = world.read('tide') || {};
      const wx = world.read('weather') || {};
      const b = world.read('businesses') || {};
      const v = world.read('visitors') || {};
      // A screen claiming the island runs without you, over four numbers that are not moving
      // because the clock is stopped, would be the first lie in an explanation about honesty.
      const stopped = !!(world.clock && (world.clock.paused || world.clock.scrubbing));
      liveKicker.textContent = stopped
        ? 'These are the island’s numbers, and the clock is stopped'
        : 'Right now, and none of it needs you';
      liveNote.textContent = stopped
        ? 'Read out of the simulation as you look at it, but nothing is moving: the clock is paused '
          + 'or parked. Press Space and it will.'
        : 'Read out of the simulation as you look at it. Nothing here was typed in for this screen.';
      live.textContent = '';
      live.append(
        fact('The tide', num(t.height, 2) + ' m', t.phase ? String(t.phase).replace(/-/g, ' ') : 'height above the chart datum'),
        fact('The wind', num(wx.windKt, 0) + ' kt', wx.label || 'over the bay'),
        // Only the ones a person could go and check. The rest of the open count is the twin's own
        // pattern for a business nobody has published hours for, and a screen explaining how the
        // twin works is the last place to blur the two together.
        fact('Open on published hours', isNum(b.openOnPublishedHours) ? String(b.openOnPublishedHours) : '–',
          isNum(b.openOnEstimatedHours) ? 'and ' + b.openOnEstimatedHours + ' more on hours nobody published' : 'of the ones that trade'),
        fact('Visitors here', isNum(v.onIsland) ? String(v.onIsland) : '–', 'staying or day tripping'));
    };
    paint();
    return paint;
  };

  /* ============================================================ 2. how time works */

  DRAW.time = (root) => {
    root.append(
      lede('The bar at the top always says what kind of time you are looking at, before you have to ask.'),
      el('div', { class: 'hiw-modes' },
        el('div', { class: 'hiw-mode' }, chip('Simulated', 'sea'),
          el('span', {}, 'Seeded, running forward from a moment written down, so the same island '
            + 'happens again on anybody else’s machine.')),
        el('div', { class: 'hiw-mode' }, chip('Live', 'leaf'),
          el('span', {}, 'The clock is at the real Queensland moment. An anchor, not a feed: taken '
            + 'once, stamped on the record, and nothing about it touches the network.')),
        el('div', { class: 'hiw-mode' }, chip('Scrub', 'sun'),
          el('span', {}, 'You have parked the clock somewhere the island is not. This is the one '
            + 'worth seeing rather than reading about.'))));

    const rows = el('div', { class: 'hiw-timerows' });
    const clockLine = el('div', { class: 'hiw-clockline' });
    root.append(el('div', { class: 'hiw-live' },
      el('div', { class: 'hiw-live-k' }, 'The clock, right now'), clockLine, rows));

    const say = el('p', { class: 'hiw-say' });
    // The dark case first, because at the moment this build opens it is the true one and a reader
    // standing in front of an unlit island should be offered the light before the demonstration.
    const dark = darkness();
    const row = el('div', { class: 'btn-row hiw-demo' });
    if (dark && dark.jump) {
      row.append(el('button', {
        class: 'btn', type: 'button', onclick: () => scrubBy(dark.jump.minutes)
      }, dark.jump.label));
    }
    row.append(
      el('button', {
        class: 'btn' + (dark && dark.jump ? ' ghost' : ''), type: 'button',
        onclick: () => scrubBy(6 * 60)
      }, 'Look six hours ahead'),
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { backToPresent(); paintWindow(); if (refresh) refresh(); }
      }, 'Back to the island’s present'));
    root.append(row, say);

    root.append(
      p('Ahead of the island’s present is a projection, and nothing in it is a record of '
        + 'anything. Behind it, if the simulation never ran that day, it is a real sun over an '
        + 'island that was not there.'),
      note('The mode, the anchor and every jump are on the saved record, so a live session replays '
        + 'exactly. Same seed and same packs, same island: that is what lets somebody else check a '
        + 'claim this twin makes.'));

    const paint = () => {
      const st = world.time ? world.time.status() : null;
      const c = world.clock;
      const t = world.read('tide') || {};
      const d = world.read('daylight') || {};
      const wx = world.read('weather') || {};
      const f = world.read('ferry') || {};
      const scrubbing = !!(st && st.scrubbing);
      const declared = st ? st.declared : (c ? c.declaredMode : 'simulated');

      clockLine.textContent = '';
      clockLine.append(
        chip(declared === 'live' ? 'Live' : declared === 'scrub'
          ? ((st && st.offsetMin > 0) ? 'Projection' : 'Looking back') : 'Simulated',
        declared === 'live' ? 'leaf' : declared === 'scrub' ? 'sun' : 'sea'),
        el('span', { class: 'hiw-clock-moment' }, c ? c.formatMoment() : '–'));

      rows.textContent = '';
      const row = (k, v, tag) => rows.append(el('div', { class: 'hiw-trow' + (tag === 'HELD' ? ' held' : '') },
        el('span', { class: 'k' }, k),
        el('span', { class: 'v' }, v),
        tag ? el('span', { class: 'tag' }, tag) : null));

      if (st) {
        row('The island has lived to', islandDateText(st.livedMinute) + ', ' + islandTimeText(st.livedMinute), null);
        row('The real moment in Queensland', islandTimeText(st.realMinute) + ' ' + ISLAND_TZ,
          Math.abs(st.aheadOfRealMin) < 15 ? null : spanText(st.aheadOfRealMin) + (st.aheadOfRealMin > 0 ? ' ahead' : ' behind'));
      }
      row('The tide', num(t.height, 2) + ' m', scrubbing ? 'FOLLOWS' : null);
      row('Sunrise and sunset', isNum(d.sunriseMin) && isNum(d.sunsetMin)
        ? islandTimeText(d.sunriseMin % MINUTES_PER_DAY) + ' and ' + islandTimeText(d.sunsetMin % MINUTES_PER_DAY)
        : '–', scrubbing ? 'FOLLOWS' : null);
      row('The wind', num(wx.windKt, 0) + ' kt', scrubbing ? 'HELD' : null);
      const boat = f.next && f.next.toIsland;
      row('The next vehicle sailing over', boat && boat.time ? boat.time : 'none left today', scrubbing ? 'HELD' : null);

      say.textContent = scrubbing
        ? 'The sun, the moon and the tide are pure functions of the moment, so they followed you '
          + 'exactly. The wind and the boat have to be lived through, so they stayed at the '
          + 'island’s present and are tagged HELD wherever they appear.'
        : 'Park the clock and watch which of these follow you and which refuse to.';
    };
    paint();
    return paint;
  };

  /* ============================================================ 3. where the numbers come from */

  DRAW.data = (root) => {
    const reg = (world.data && world.data.registry) || null;
    const packs = (reg && Array.isArray(reg.packs)) ? reg.packs : [];
    const docs = (reg && reg.documents) ? Object.values(reg.documents) : [];
    const biz = pack(world, 'businesses');
    const list = (biz && Array.isArray(biz.businesses)) ? biz.businesses : [];

    // How much of the trading hours in the pack anybody actually published. Counted rather than
    // written down, and grouped by whatever words the pack itself uses, because the answer is being
    // improved by another hand and a number typed in here would be wrong within the week.
    const basisCount = new Map();
    let checkedLatest = '';
    for (const b of list) {
      const th = b && b.typical_hours;
      if (!th || typeof th.basis !== 'string') continue;
      if (th.basis === 'not trading') continue;
      basisCount.set(th.basis, (basisCount.get(th.basis) || 0) + 1);
      if (typeof th.checked === 'string' && th.checked > checkedLatest) checkedLatest = th.checked;
    }
    // The pack has carried this vocabulary as a list of {id, means} and as a plain object keyed by
    // the word. Read both, because which one is on disk belongs to whoever is improving the hours
    // and this screen should not go quiet when they change their mind about the shape.
    const vocabRaw = biz && biz.hours_basis_vocabulary;
    const vocab = Array.isArray(vocabRaw)
      ? vocabRaw
      : (vocabRaw && typeof vocabRaw === 'object'
        ? Object.entries(vocabRaw).map(([id, means]) => ({ id, means: typeof means === 'string' ? means : (means && means.means) || '' }))
        : []);
    const BASIS_ORDER = ['published', 'listed', 'estimate'];
    const BASIS_TONE = { published: 'leaf', listed: 'sea', estimate: 'sun' };
    const basisRows = [...basisCount.entries()]
      .sort((a, b2) => (BASIS_ORDER.indexOf(a[0]) + 9) % 9 - (BASIS_ORDER.indexOf(b2[0]) + 9) % 9);
    const hoursTotal = basisRows.reduce((n, r) => n + r[1], 0);
    const guessed = basisCount.get('estimate') || 0;
    const meansOf = (id) => {
      const v = vocab.find((x) => x && x.id === id);
      return v && v.means ? v.means : '';
    };

    // Whether a sync lane exists yet, asked of the registry rather than asserted. When one lands,
    // this card has to start telling the truth about it on the same day.
    const lanes = (reg && reg.lanes && typeof reg.lanes === 'object') ? reg.lanes : {};
    const syncLane = Object.entries(lanes).find(([id, l]) => l && l.built === true
      && /sync|connector|feed/i.test(id + ' ' + (l.produces || '')));

    // How many records there are and how many still carry no rating, out of the registry's own
    // confidence spread rather than by walking a megabyte of JSON on a click.
    let records = 0, unrated = 0;
    for (const pk of packs) {
      const c = pk && pk.confidence;
      if (!c) continue;
      for (const k of Object.keys(c)) if (isNum(c[k])) records += c[k];
      if (isNum(c.unrated)) unrated += c.unrated;
    }

    const closedByLocal = list.find((b) => b && b.status === 'closed'
      && typeof b.source === 'string' && /user correction/i.test(b.source));
    const correctionDate = closedByLocal
      ? (/recorded\s+(\d{1,2}\s+\w+\s+\d{4})/i.exec(String(closedByLocal.source)) || [])[1] : null;

    root.append(
      lede('Four ways this twin can come to know something. One of them is doing nearly all the '
        + 'work, and saying which is which is the point of this screen.'),

      card('Committed packs', 'sea', 'Doing the work',
        p(packs.length + ' packs holding ' + thousands(records) + ' records, each naming where it '
          + 'came from and most carrying a confidence rating. Nearly everything you see rests on '
          + 'these.'),
        unrated
          ? note(thousands(unrated) + ' still carry no rating. That number is frozen: it can be '
            + 'paid off, not grown.')
          : null),

      card('A document, with the page', 'iron', docs.length ? 'Built, not yet used' : 'Built',
        p('A tool reads a named public document and writes candidates carrying the page and the '
          + 'sentence, word for word. A person decides what is true, and one nobody has read cannot '
          + 'become data.'),
        docs.length
          ? el('div', { class: 'hiw-eg' },
            el('b', {}, 'Registered so far'),
            el('ul', {}, ...docs.map((d) => el('li', {},
              d.title + (d.publisher ? ', ' + d.publisher : '')
              + (isNum(d.pages) ? ', ' + plural(d.pages, 'page') : '')
              + (d.read_on ? ', read ' + plainDate(d.read_on) : '')))),
            el('span', {}, 'Each is hashed, so a citation cannot become a citation of an older '
              + 'version. Nothing has been promoted through this lane yet.'))
          : null),

      card('A correction from somebody who lives here', 'leaf', 'Has happened',
        p('No form and no portal. A resident says something true and somebody types it in.'),
        // The record's own note is written for whoever maintains the pack and names the person who
        // made the correction. Neither belongs on a screen, so this says what happened in its own
        // words and takes only the date off the record.
        closedByLocal
          ? el('div', { class: 'hiw-eg' },
            el('b', {}, closedByLocal.name + ', ' + (closedByLocal.township || 'on the island')),
            el('span', {}, 'Directory sites still list it as trading. Somebody who lives here said '
              + 'it had shut'
              + (correctionDate ? ', recorded on ' + correctionDate : '')
              + ', and it is kept in the pack marked closed so no later pass can put it back.'))
          : null),

      card('A synced feed, with a freshness date', syncLane ? 'sea' : 'sun',
        syncLane ? 'Working' : 'Designed, not built',
        p('A sync is an offline step that reads a real source and writes a stamped, committed feed '
          + 'for a person to read; the twin itself never fetches anything. Every synced record '
          + 'carries when it was synced and from where, because "the bakery is open" is only as '
          + 'true as its last sync.'),
        syncLane
          ? el('div', { class: 'hiw-eg' },
            el('b', {}, 'The ' + syncLane[0] + ' lane is built'),
            el('span', {}, syncLane[1].produces || 'records stamped with the source and the date they were read.'))
          : note('Nothing has been synced yet, so nothing in front of you carries a sync date.')));

    if (hoursTotal > 0) {
      root.append(h('Opening hours, and who published them'));
      const bar = el('div', { class: 'hiw-bar' });
      const key = el('div', { class: 'hiw-barkey' });
      for (const [id, n] of basisRows) {
        const tone = BASIS_TONE[id] || 'iron';
        bar.append(el('i', { class: tone, style: { width: (100 * n / hoursTotal).toFixed(1) + '%' } }));
        key.append(el('span', { class: tone }, n + ' ' + id));
      }
      root.append(bar, key);
      if (meansOf('listed')) {
        root.append(note('Published means the business said so itself. Listed means a council, a '
          + 'tourism body or a directory did. Estimate means nobody did.'));
      }
      root.append(p((guessed
        ? guessed + ' sets are nobody’s published hours: a pattern for the simulation to run '
          + 'on, never a claim about a real street. That gap is why '
        : 'That is why ')
        + 'real opening hours are the difference between a twin that can tell you something about '
        + 'the island and one that can only tell you about itself.'
        + (checkedLatest ? ' The most recent were checked on ' + plainDate(checkedLatest) + '.' : '')));
    }
    return null;
  };

  /* ============================================================ 4. real, modelled, proposed */

  DRAW.registers = (root) => {
    const data = world.data || {};
    const biz = pack(world, 'businesses');
    const list = (biz && Array.isArray(biz.businesses)) ? biz.businesses : [];
    const sub = pack(world, 'subterranean');
    const pop = world.read('population') || {};

    const realEg = list.find((b) => b && b.typical_hours && b.typical_hours.basis === 'published' && b.status === 'trading');
    const proposedEg = list.find((b) => b && b.status === 'proposed');
    const unconfirmed = list.filter((b) => b && b.status === 'trading-unconfirmed').length;

    /** The badge the twin's own classifier says a record should wear. Not a badge typed in here. */
    const badge = (record) => {
      const lab = (typeof data.labelFor === 'function') ? data.labelFor(record) : null;
      return lab ? el('span', { class: 'chip ' + (lab.tone === 'proposed' ? 'sun' : 'iron') }, lab.marker) : null;
    };

    root.append(
      lede('Three registers. Everything on screen is one of them, and you should be able to tell '
        + 'them apart without being told.'),

      card('Real', 'leaf', 'It exists',
        p('Somebody published it and the record names where. The barge timetable. The road network. '
          + 'The tide window that shuts the beaches to vehicles.'),
        realEg ? el('div', { class: 'hiw-eg' },
          el('b', {}, realEg.name),
          el('span', {}, 'Hours published rather than guessed. Source: '
            + String(realEg.source || 'named in the pack').replace(/^https?:\/\//, '') + '.')) : null),

      card('Modelled', 'sea', 'The twin worked it out',
        p('Nobody measured it. How many people are here this afternoon, what a shop took today. A '
          + 'modelled number is an argument, not an observation.'),
        el('div', { class: 'hiw-eg' },
          el('b', {}, thousands(pop.residents) + ' residents, right now'),
          el('span', {}, pop.source || 'a census baseline with modelled households on top of it'))),

      card('Proposed', 'sun', 'It does not exist',
        p('Somebody suggested it, and it stays marked proposed everywhere, for good. The largest is '
          + 'the works below the sand: not built, not approved, not funded, not sited, not '
          + 'consented, and every one of its screens opens by saying so.'),
        // The record's role_in_sim field is an instruction to whoever renders it, not a description
        // for a reader, so this says what the record is instead of quoting the instruction.
        proposedEg ? el('div', { class: 'hiw-eg' },
          el('b', {}, proposedEg.name, ' ', badge(proposedEg)),
          el('span', {}, 'A proposed association, in the business pack because a proposal may be '
            + 'carried as long as it is carried as one.')) : null),

      h('The two that catch people'),
      el('div', { class: 'hiw-eg' },
        el('b', {}, 'Unconfirmed', ' ', badge({ status: 'trading-unconfirmed' })),
        el('span', {}, unconfirmed + ' businesses. A real place nobody could check lately. A '
          + 'Proposed badge on a shop that is probably open would be the worse falsehood.')),
      el('div', { class: 'hiw-eg' },
        el('b', {}, 'And the one with no badge at all'),
        el('span', {}, 'Anything below the confidence threshold is not shown at all. Unreviewed is '
          + 'invisible, not caveated.')),
      note('One function decides which register a record is in, and the checker that guards the '
        + 'packs runs the same one, so nothing is a proposal in one place and a fact in another.'));

    /* THE FOURTH THING, WHICH IS NOT A FOURTH REGISTER.
       Real, modelled and proposed above are about a record: does this thing exist. The civic board
       carries a different three, about a claim: known, modelled, speculative. The speculative one
       is the only surface in this build that describes an instrument nobody has written, so it is
       switched off until somebody asks for it, and this screen is where a person finds out it is
       there. Saying that out loud is not the same as showing it: a councillor who reads this
       paragraph and never touches the switch sees precisely the island as it is.
       Everything counted, nothing typed in. */
    const civic = pack(world, 'civic');
    const ow = civic && civic.off_world;
    if (ow) {
      const spec = Array.isArray(ow.proposals) ? ow.proposals.length : 0;
      const known = (Array.isArray(ow.instruments) ? ow.instruments.length : 0)
        + (Array.isArray(ow.precedents) ? ow.precedents.length : 0);
      root.append(
        h('And one register you have to switch on'),
        p('The civic board can hold a claim about the future as carefully as it holds a statute, '
          + 'and it keeps them apart by keeping the second lot switched off. '
          + known + ' sourced records of law that already reaches above the nation state, and '
          + spec + ' instruments that do not exist, each one lifted from a real one and each '
          + 'naming the test that would settle it.'),
        el('div', { class: 'hiw-eg' },
          el('b', {}, 'Off unless you ask'),
          el('span', {}, ow.default_state === 'off'
            ? 'Nothing on any screen in this build differs while it is off, and the checker fails '
              + 'the build if a lever, a metric or a budget line ever names anything inside it. '
              + 'The switch is at the end of the tab row on the civic board.'
            : 'The pack says this register defaults to ' + String(ow.default_state) + ', which it '
              + 'should not; the board still starts it off.')),
        note('A speculative instrument attributed to a real body would be a false claim about that '
          + 'body, so the invented offices in there are named as invented, and nothing cultural '
          + 'goes in at any tier.'));
    }
    return null;
  };

  /* ============================================================ 5. what you can change */

  DRAW.levers = (root) => {
    const civic = pack(world, 'civic');
    const levers = (civic && Array.isArray(civic.levers)) ? civic.levers : [];
    const insts = (civic && Array.isArray(civic.institutions)) ? civic.institutions : [];
    const instOf = (id) => insts.find((x) => x && x.id === id) || null;
    const labelOf = (id) => {
      const i = instOf(id);
      return (i && i.label) || String(id || '').replace(/-/g, ' ');
    };
    const tiersBlock = (civic && civic.jurisdiction && civic.jurisdiction.tiers) || {};
    const tierLabels = tiersBlock.labels || {};
    const GOVERNMENTS = Array.isArray(tiersBlock.governments) ? tiersBlock.governments : ['commonwealth', 'state', 'local'];
    const TIER_ORDER = ['commonwealth', 'state', 'local', 'native_title', 'joint', 'private', 'none'];
    const tierOf = (id) => (instOf(id) || {}).tier || 'none';

    const ROLE = [
      ['player_decides', 'Yours to decide', 'leaf'],
      ['player_funds', 'You can fund it', 'sea'],
      ['player_advocates', 'You can only ask', 'sun'],
      ['player_observes', 'You can only watch', 'iron']
    ];
    const roleCount = {};
    const whoCount = {};
    // How many orders of government a lever needs, which is the honest measure of how hard it is,
    // as against how many names are on it, which is only a measure of how long the list looks.
    const govCount = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const l of levers) {
      roleCount[l.player_role] = (roleCount[l.player_role] || 0) + 1;
      const tiers = new Set();
      for (const w of (l.who_decides || [])) { whoCount[w] = (whoCount[w] || 0) + 1; tiers.add(tierOf(w)); }
      const n = GOVERNMENTS.filter((t) => tiers.has(t)).length;
      govCount[n] = (govCount[n] || 0) + 1;
    }
    const decides = levers.filter((l) => l.player_role === 'player_decides');
    const decidesCouncil = decides.filter((l) => (l.who_decides || []).includes('redland-city-council')).length;
    const division = (civic && civic.jurisdiction && Array.isArray(civic.jurisdiction.layers))
      ? civic.jurisdiction.layers.find((x) => x && x.body === 'rcc-division-2') : null;

    root.append(
      lede('You are not the mayor, and that is the subject rather than a limitation somebody worked '
        + 'around.'),
      p('The civic board carries ' + levers.length + ' researched levers. This is how they split.'));

    const split = el('div', { class: 'hiw-split' });
    for (const [key, label, tone] of ROLE) {
      const n = roleCount[key] || 0;
      if (!n) continue;
      split.append(el('div', { class: 'hiw-srow' },
        el('span', { class: 'n ' + tone }, String(n)),
        el('span', { class: 'l' }, label),
        el('span', { class: 'b' }, el('i', { class: tone, style: { width: (100 * n / Math.max(1, levers.length)).toFixed(1) + '%' } }))));
    }
    root.append(split);

    if (decides.length) {
      root.append(p((decidesCouncil === decides.length ? 'Every one of those ' + decides.length : decidesCouncil + ' of the ' + decides.length)
        + ' names Redland City Council among its deciders, so the seat this twin puts you in is a '
        + 'council one.'));
    }
    if (division && division.covers) {
      root.append(el('div', { class: 'hiw-eg' },
        el('b', {}, 'And the council seat has a catch'),
        el('span', {}, division.covers + (division.why_it_matters ? ' ' + division.why_it_matters : ''))));
    }

    /* How many governments. This block exists because the one under it, the list of bodies, was
       being cut at the six largest, and the moment a fourth order of government entered the pack
       that list started hiding the very thing it was there to show. Governments first, because
       three of them agreeing is a different kind of hard from one of them deciding, and then the
       bodies in full so nobody is quietly dropped off the bottom again. */
    const GOV_ROWS = [
      [3, 'need all three governments', 'coral'],
      [2, 'need two of them', 'sun'],
      [1, 'need one', 'sea'],
      [0, 'need no government at all', 'leaf']
    ];
    if (levers.length) {
      root.append(h('How many governments have to agree'));
      const gsplit = el('div', { class: 'hiw-split' });
      for (const [n, label, tone] of GOV_ROWS) {
        const v = govCount[n] || 0;
        if (!v) continue;
        gsplit.append(el('div', { class: 'hiw-srow' },
          el('span', { class: 'n ' + tone }, String(v)),
          el('span', { class: 'l' }, label),
          el('span', { class: 'b' }, el('i', { class: tone, style: { width: (100 * v / Math.max(1, levers.length)).toFixed(1) + '%' } }))));
      }
      root.append(gsplit);
      root.append(note('Four tiers reach this island and three of them are governments: the '
        + 'Commonwealth, Queensland and the council. The levers needing none of the three are not '
        + 'the easy ones. They belong to the native title holders, to joint management or to a '
        + 'private operator, and the first two are decisions this twin will not simulate at all.'));
    }

    root.append(h('Who holds them'));
    const who = el('div', { class: 'hiw-who' });
    const seen = new Set();
    for (const tier of TIER_ORDER) {
      const ids = Object.keys(whoCount).filter((id) => tierOf(id) === tier)
        .sort((a, b) => whoCount[b] - whoCount[a]);
      if (!ids.length) continue;
      who.append(el('div', { class: 'hiw-wrow head' },
        el('span', { class: 'l' }, tierLabels[tier] || tier.replace(/_/g, ' ')),
        el('span', { class: 'n' }, String(ids.reduce((s, id) => s + whoCount[id], 0)))));
      for (const id of ids) {
        seen.add(id);
        who.append(el('div', { class: 'hiw-wrow' },
          el('span', { class: 'l' }, labelOf(id)),
          el('span', { class: 'n' }, whoCount[id])));
      }
    }
    // Anything the pack has not placed in a tier still appears, because a body nobody has filed is
    // worse to hide than a body in the wrong box.
    for (const id of Object.keys(whoCount)) {
      if (seen.has(id)) continue;
      who.append(el('div', { class: 'hiw-wrow' },
        el('span', { class: 'l' }, labelOf(id) + ' (no tier in the pack)'),
        el('span', { class: 'n' }, whoCount[id])));
    }
    root.append(who, note('Every body, not the largest few, counted across every lever, so one '
      + 'needing three bodies is under all three.'));

    /* NOT EVERY BODY DECIDES THE SAME WAY, and the board stopped pretending otherwise.
       Read out of decision_postures in data/civic.json and counted off the institutions' own
       decides_by, so this paragraph moves when somebody reclassifies a body. It is here rather than
       only on the civic board because it is the difference between "the Commonwealth is another
       name on the list" and "the Commonwealth is a different kind of ask", which is the whole point
       of adding a fourth tier at all. */
    const postures = (civic && civic.decision_postures && civic.decision_postures.kinds) || null;
    if (postures) {
      const byKind = {};
      for (const i of insts) if (i && i.decides_by) (byKind[i.decides_by] = byKind[i.decides_by] || []).push(i.label);
      const noMeter = Object.keys(byKind).filter((k) => postures[k] && postures[k].meter === false);
      const withMeter = Object.keys(byKind).filter((k) => postures[k] && postures[k].meter !== false);
      const bodies = noMeter.reduce((n, k) => n + byKind[k].length, 0);
      if (bodies) {
        root.append(h('And they do not all decide the same way'));
        root.append(p('The board carries a mood for a body you can persuade. '
          + withMeter.reduce((n, k) => n + byKind[k].length, 0) + ' of these are like that: a council '
          + 'with a budget, a program with a tranche left, an operator working out whether it pays. '
          + bodies + ' are not, and for those the board shows no appetite at all.'));
        for (const k of noMeter) {
          root.append(el('div', { class: 'hiw-eg' },
            el('b', {}, postures[k].label + ': ' + byKind[k].join(', ')),
            el('span', {}, postures[k].what_moves_it)));
        }
        root.append(note('A 0 to 100 appetite on a body that decides against a statutory test would '
          + 'say that wanting it more helps, and it does not. What you hold with those bodies is '
          + 'whether the file is complete, and that is the whole of it.'));
      }
    }

    root.append(
      h('So what do you actually do'),
      p('Commission a study and pay for it. Lodge it anyway and get an information request back '
        + 'twelve weeks later. Run a consultation. Get up a petition, which is a list of names '
        + 'unless a consultation came back in favour. Wait. Live with the answer.'),
      p('And where a decision belongs to a body this twin will not guess at, it stops and says so. '
        + 'Anything QYAC decides is in that category: the shape of the process is modelled, the '
        + 'decision is not.'),
      p('The Commonwealth is the tier you will notice least and it changes the most. It has no '
        + 'office here, it decides only a handful of these, and it holds the national environment '
        + 'law over the wetland this island sits in, the law under which native title here was '
        + 'determined at all, and most of the money that reaches the island having gone through '
        + 'Queensland or the council first. That is why the count above is governments and not '
        + 'names.'),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { toggle(false); world.bus.emit('ui:open', { id: 'civic' }); }
        }, 'Open the civic board')));
    return null;
  };

  /* ============================================================ 6. how to put something in */

  DRAW.contribute = (root) => {
    const biz = pack(world, 'businesses');
    const list = (biz && Array.isArray(biz.businesses)) ? biz.businesses : [];
    const guessedHours = list.filter((b) => b && b.typical_hours && b.typical_hours.basis === 'estimate').length;
    const noCoords = list.filter((b) => b && b.status !== 'closed' && b.status !== 'proposed'
      && !isNum(b.lat)).length;
    const unconfirmed = list.filter((b) => b && b.status === 'trading-unconfirmed').length;
    const conflicted = list.find((b) => b && typeof b.note === 'string' && /address conflicts/i.test(b.note));

    root.append(
      lede('Ten ways in are designed, lowest technology first, because the islander without a phone '
        + 'is a first class contributor here rather than a fallback.'),
      p('A spoken correction. Paper cards. A tape measure. Business and community facts. Scans. '
        + 'Sightings. Wishes. Scenario suggestions. Memory anchors. Plans for a real event at a '
        + 'real venue.'),

      h('What exists today'),
      el('div', { class: 'hiw-states' },
        el('div', {}, chip('Works', 'leaf'), el('span', {}, 'The spoken correction. It has been '
          + 'used, and you can find it in the pack.')),
        el('div', {}, chip('Works', 'leaf'), el('span', {}, 'An intake tool that turns a typed up '
          + 'batch into records with attribution, consent and visibility.')),
        el('div', {}, chip('None', 'coral'), el('span', {}, 'No form, no portal, no booth software. '
          + 'Things arrive out of band.')),
        el('div', {}, chip('Waiting', 'sun'), el('span', {}, 'The scan pipeline is built. No asset '
          + 'has reached the twin.')),
        el('div', {}, chip('Both ways', 'sea'), el('span', {}, 'It sends as well as takes: a day of '
          + 'the island, a noticeboard notice, a rescue draft, each written to a file for a person '
          + 'to read and send on. Nothing leaves here without one.'))),

      h('What you are promised in return'),
      el('ul', { class: 'hiw-promise' },
        el('li', {}, el('b', {}, 'One spine. '),
          'A resident’s correction and a council document are the same shape of record.'),
        el('li', {}, el('b', {}, 'Your name on the record, and nothing else. '),
          'No points, no badges, no leaderboards. Trust attaches to claims and never to people: on '
          + 'an island this size a score against a person is a social ranking.'),
        el('li', {}, el('b', {}, 'The dial stays in your hand. '),
          'Consent and visibility are per record, enforced when the pack is built rather than when '
          + 'it is drawn.'),
        el('li', {}, el('b', {}, 'Withdrawal is honoured '),
          'at the next release. A public history persists, though, so anything that might need '
          + 'erasing belongs at a lower visibility from the start.'),
        el('li', {}, el('b', {}, 'Nothing becomes an hour verification protocol, '),
          'from any lane, by any route.')),

      h('What this island’s twin does not know'),
      p('No points: a list of the gaps, where the reward for filling one is that it is filled, with '
        + 'your name on it.'));

    const wanted = el('div', { class: 'hiw-wanted' });
    if (guessedHours) wanted.append(el('div', {}, el('b', {}, String(guessedHours)), el('span', {}, 'sets of trading hours nobody has published')));
    if (unconfirmed) wanted.append(el('div', {}, el('b', {}, String(unconfirmed)), el('span', {}, 'real businesses nobody could confirm are still trading')));
    if (noCoords) wanted.append(el('div', {}, el('b', {}, String(noCoords)), el('span', {}, 'premises with no coordinates, so they are in the pack but not on the ground')));
    // Named, not quoted: the pack's note on this one cites who holds each of the two addresses, and
    // the gap is the interesting part rather than who wrote which listing down.
    if (conflicted) {
      wanted.append(el('div', {}, el('b', {}, '1'),
        el('span', {}, conflicted.name + ', where two published sources give different street '
          + 'addresses in the same block. Its coordinates are left empty rather than guessed, until '
          + 'a local settles it.')));
    }
    root.append(wanted);
    return null;
  };

  /* ============================================================ 7. what it will not do */

  DRAW.boundary = (root) => {
    const lore = pack(world, 'lore');
    const ack = lore && lore.acknowledgement ? lore.acknowledgement : null;
    const wording = ack && ack.game_wording ? ack.game_wording : null;
    const text = wording && wording.long ? wording.long.text : null;

    root.append(
      lede('Minjerribah is Quandamooka Country. This screen governs every one before it.'),

      card('QYAC has not seen this project', 'coral', null,
        p('The Quandamooka Yoolooburrabee Aboriginal Corporation holds and manages the Quandamooka '
          + 'People’s native title rights and interests, and nobody has asked it whether this '
          + 'should exist. The cultural pack records its own status as '
          + String((lore && lore.status) || 'not reviewed').replace(/_/g, ' ')
            .replace('traditional owners', 'Traditional Owners')
          + ', until a human changes it after an actual conversation.')),

      card('Cultural material does not enter', 'coral', null,
        p('No language words, no story, no art, no cultural practice, no sacred or restricted '
          + 'places, from any source and any contributor. This project cannot verify anybody’s '
          + 'authority to share it, so the route is through QYAC or it does not exist. That is the '
          + 'most important refusal here.')),

      card('The review file is a queue, not a set of approvals', 'coral', null,
        p('Nothing on it is approved, and the first question on it is whether this should exist at '
          + 'all.')),

      h('Why that last one is a running check and not a note'),
      p('Six season names were once in this code, presented as a Quandamooka calendar and written '
        + 'from memory. None could be sourced and one is published as meaning whale. All six were '
        + 'deleted, and a later pass found five still in the drama pack, put there by a hand that '
        + 'had read the rule. A rule nothing executes is not a rule.'),

      h('What it does carry'),
      p('Publicly documented fact. Native title over Minjerribah was determined on 4 July 2011. The '
        + 'national park is jointly managed. QYAC and Minjerribah Moorgumpin Elders-in-Council are '
        + 'named where the public record names them, which is a different act from representing a '
        + 'view: nobody connected to either speaks here.'));

    if (text) {
      // One block, the exact string, unsplit and unstyled beyond the type. The arrival screen sets
      // it in sentences because it has a whole screen for it and nothing else on it; here it is
      // quoted, and a quotation is not somewhere to make typographic decisions.
      root.append(h('The acknowledgement, word for word from the pack'),
        el('div', { class: 'hiw-ack' }, el('p', {}, text)));
    } else {
      root.append(note('The cultural pack did not load, so the acknowledgement it holds cannot be '
        + 'shown. That is a fault in this build and not a choice.'));
    }

    root.append(note('The camera has not moved for this screen. There is nowhere it could point '
      + 'that would be ours to point it at.'));
    return null;
  };

  /* ---- live ------------------------------------------------------------- */

  paintCamToggle();

  return {
    update() {
      if (!open) return;
      // The strip repaints on every section, not only the live ones: the light on the island moves
      // whether or not the section on screen has a number in it.
      try { paintWindow(); } catch (e) { /* a bad repaint must not stop the island */ }
      if (!refresh) return;
      try { refresh(); } catch (e) { /* the same */ }
    }
  };
}

/* ------------------------------------------------------------------ style */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'hiw-style';
  s.textContent = `
/* The sheet. Right hand column, the inspector's rectangle and a little wider, so the island is on
   screen to the left of it with the camera pointed at whatever the section is about. */
.hiw { position: fixed; right: var(--sp-4); top: calc(var(--hud-height) + var(--sp-2));
  bottom: calc(var(--bottom-chrome) + var(--sp-2)); width: min(456px, 40vw); min-width: 336px;
  z-index: 26; display: flex; flex-direction: column; opacity: 0; transform: translateX(14px);
  pointer-events: none; transition: opacity var(--med) var(--ease), transform var(--med) var(--ease-out); }
.hiw.on { opacity: 1; transform: none; pointer-events: auto; }

/* The minimap is the only permanent panel whose rectangle this one takes, so it stands down while
   this is open rather than being drawn underneath it, and comes back the moment this closes. */
body.twin-explainer .map-panel, body.twin-explainer .map-show { display: none; }

.hiw-top { flex: none; display: flex; align-items: flex-start; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--edge);
  background: linear-gradient(180deg, rgba(255,255,255,.035), transparent); }
.hiw-head-txt { flex: 1; min-width: 0; }
.hiw-kicker { font: 600 var(--fs-label)/1 var(--f-ui); letter-spacing: .16em; text-transform: uppercase;
  color: var(--sea); }
.hiw-step { font-size: var(--fs-sm); color: var(--t-faint); margin-top: 3px; }

/* The seven names wrap rather than scroll. Scrolling them put the last one, which is the cultural
   boundary, off the right hand edge of a 456 px sheet until somebody thought to drag sideways for
   it. Two rows of names everybody can see beats one row that hides the most important screen. */
.hiw-tabs { flex: none; display: flex; flex-wrap: wrap; gap: 0 var(--sp-1);
  padding: var(--sp-2) var(--sp-2) 0; border-bottom: 1px solid var(--edge); }
.hiw-tab { appearance: none; background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--t-faint); font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .07em;
  text-transform: uppercase; padding: var(--sp-2) 5px var(--sp-2); cursor: pointer;
  white-space: nowrap; transition: color var(--fast), border-color var(--fast); }
.hiw-tab:hover { color: var(--t); }
.hiw-tab.on { color: var(--sea); border-bottom-color: var(--sea); }

/* The window strip. Between the tabs and the reading, because it is about the thing on the other
   side of the sheet rather than about the sheet. It turns amber when the sun is under the horizon,
   which is the state this build opens in. */
.hiw-win { flex: none; padding: var(--sp-2) var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--edge);
  background: rgba(255,255,255,.022); }
.hiw-win.dark { background: rgba(228,164,74,.07); border-bottom-color: rgba(228,164,74,.28); }
.hiw-win-k { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .14em; text-transform: uppercase;
  color: var(--t-faint); margin-bottom: 4px; }
.hiw-win.dark .hiw-win-k { color: var(--sun); }
.hiw-win-s { font-size: var(--fs-sm); line-height: 1.5; color: var(--t); }
.hiw-win-l { display: none; }
.hiw-win-l.on { display: block; font-size: var(--fs-sm); line-height: 1.5; color: var(--sun);
  margin-top: 4px; }
.hiw-win-l.soft { color: var(--t-faint); }
.hiw-win-a { display: none; }
.hiw-win-a.on { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-2); }
.hiw-win-a .btn { font-size: var(--fs-sm); }
.hiw-win-go { background: var(--sun); border-color: var(--sun); color: var(--t-on-accent); }
.hiw-win-go:hover { background: #f0b95f; border-color: #f0b95f; color: var(--t-on-accent); }

.hiw-body { flex: 1 1 auto; min-height: 0; padding: var(--sp-4) var(--sp-4) var(--sp-5); }
.hiw-body > * + * { margin-top: var(--sp-3); }

.hiw-h { font: 600 var(--fs-label)/1 var(--f-ui); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-dim); margin-top: var(--sp-5) !important; }
.hiw-lede { font: 300 var(--fs-lg)/1.6 var(--f-ui); color: var(--t-hi); }
.hiw-p { font-size: var(--fs-base); line-height: 1.65; color: var(--t); }
.hiw-p.warn { color: var(--coral); }
.hiw-note { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-faint); }
.hiw-say { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); }

/* Live blocks: anything read out of the running world rather than written here. */
.hiw-live { background: var(--s-sunk); border: 1px solid var(--edge); border-radius: var(--r-2);
  padding: var(--sp-3); }
.hiw-live-k { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .14em; text-transform: uppercase;
  color: var(--sea); margin-bottom: var(--sp-3); }
.hiw-facts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.hiw-fact-k { font-size: var(--fs-micro); letter-spacing: .12em; text-transform: uppercase; color: var(--t-faint); }
.hiw-fact-v { font: 400 var(--fs-lg)/1.2 var(--f-num); color: var(--t-hi); font-variant-numeric: tabular-nums; }
.hiw-fact-s { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.4; margin-top: 1px; }

.hiw-modes { display: flex; flex-direction: column; gap: var(--sp-3); }
.hiw-mode { display: grid; grid-template-columns: 84px 1fr; gap: var(--sp-3); align-items: start; }
.hiw-mode span { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.hiw-mode .chip { justify-self: start; }

.hiw-clockline { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.hiw-clock-moment { font: 400 var(--fs-sm)/1 var(--f-num); color: var(--t-hi); }
.hiw-timerows { display: flex; flex-direction: column; gap: 1px; }
.hiw-trow { display: flex; align-items: baseline; gap: var(--sp-2); padding: 4px 0;
  border-top: 1px solid rgba(232,220,196,.07); font-size: var(--fs-sm); }
.hiw-trow .k { flex: 1; color: var(--t-faint); }
.hiw-trow .v { font-family: var(--f-num); color: var(--t-hi); font-variant-numeric: tabular-nums; }
.hiw-trow .tag { font: 700 9px/1 var(--f-ui); letter-spacing: .12em; color: var(--sea); }
.hiw-trow.held .v { color: var(--t-dim); }
.hiw-trow.held .tag { color: var(--sun); }
.hiw-demo { margin-top: var(--sp-3); }

.hiw-card { border: 1px solid var(--edge); border-left: 2px solid var(--edge-strong);
  border-radius: var(--r-2); padding: var(--sp-3); background: rgba(255,255,255,.022); }
.hiw-card + .hiw-card { margin-top: var(--sp-2); }
.hiw-card.sea { border-left-color: var(--sea); }
.hiw-card.leaf { border-left-color: var(--leaf); }
.hiw-card.sun { border-left-color: var(--sun); }
.hiw-card.coral { border-left-color: var(--coral); }
.hiw-card.iron { border-left-color: var(--iron); }
.hiw-card-h { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.hiw-card-h b { flex: 1; color: var(--t-hi); font-weight: 500; font-size: var(--fs-base); }
.hiw-card .hiw-p { font-size: var(--fs-sm); }

.hiw-eg { margin-top: var(--sp-3); padding: var(--sp-2) var(--sp-3); background: var(--s-sunk);
  border-radius: var(--r-2); font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.hiw-eg b { display: block; color: var(--t-hi); font-weight: 500; margin-bottom: 2px; }
.hiw-eg ul { margin: 4px 0 6px 1.1em; }
.hiw-eg li { margin-bottom: 3px; }

.hiw-bar { display: flex; height: 8px; border-radius: var(--r-pill); overflow: hidden;
  background: var(--s-sunk); }
.hiw-bar i.leaf { background: var(--leaf); }
.hiw-bar i.sea { background: var(--sea); }
.hiw-bar i.sun { background: var(--sun-deep); }
.hiw-bar i.iron { background: var(--iron); }
.hiw-barkey { display: flex; gap: var(--sp-4); flex-wrap: wrap; font-size: var(--fs-micro);
  letter-spacing: .06em; text-transform: uppercase; }
.hiw-barkey .leaf { color: var(--leaf); } .hiw-barkey .sea { color: var(--sea); }
.hiw-barkey .sun { color: var(--sun); } .hiw-barkey .iron { color: var(--iron); }

.hiw-split { display: flex; flex-direction: column; gap: var(--sp-2); }
.hiw-srow { display: grid; grid-template-columns: 30px 1fr 92px; gap: var(--sp-2); align-items: center; }
.hiw-srow .n { font: 400 var(--fs-lg)/1 var(--f-num); text-align: right; font-variant-numeric: tabular-nums; }
.hiw-srow .n.leaf { color: var(--leaf); } .hiw-srow .n.sea { color: var(--sea); }
.hiw-srow .n.sun { color: var(--sun); } .hiw-srow .n.iron { color: var(--iron); }
.hiw-srow .l { font-size: var(--fs-sm); color: var(--t); }
.hiw-srow .b { height: 4px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden; }
.hiw-srow .b i { display: block; height: 100%; border-radius: var(--r-pill); }
.hiw-srow .b i.leaf { background: var(--leaf); } .hiw-srow .b i.sea { background: var(--sea); }
.hiw-srow .b i.sun { background: var(--sun); } .hiw-srow .b i.iron { background: var(--iron); }

.hiw-who { display: flex; flex-direction: column; gap: 1px; }
.hiw-wrow { display: flex; align-items: baseline; gap: var(--sp-3); padding: 4px 0;
  border-top: 1px solid rgba(232,220,196,.07); font-size: var(--fs-sm); }
.hiw-wrow .l { flex: 1; color: var(--t); }
.hiw-wrow .n { font-family: var(--f-num); color: var(--t-hi); font-variant-numeric: tabular-nums; }
/* The tier heading inside the body list. Small, uppercase and quiet: it is a divider that happens
   to carry a total, not a row in its own right. */
.hiw-wrow.head { border-bottom-color: var(--edge-strong); margin-top: var(--sp-3); padding-top: 0; }
.hiw-wrow.head:first-child { margin-top: 0; }
.hiw-wrow.head .l { font: 600 var(--fs-micro)/1.4 var(--f-ui); letter-spacing: .14em;
  text-transform: uppercase; color: var(--sea); }
.hiw-wrow.head .n { color: var(--t-faint); font-size: var(--fs-micro); }

.hiw-states { display: flex; flex-direction: column; gap: var(--sp-2); }
.hiw-states > div { display: grid; grid-template-columns: 70px 1fr; gap: var(--sp-3); align-items: start; }
.hiw-states span { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.hiw-states .chip { justify-self: start; }

.hiw-promise { margin: 0 0 0 1.05em; display: flex; flex-direction: column; gap: var(--sp-2); }
.hiw-promise li { font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); }
.hiw-promise b { color: var(--t-hi); font-weight: 500; }

.hiw-wanted { display: flex; flex-direction: column; gap: var(--sp-2); }
.hiw-wanted > div { display: grid; grid-template-columns: 44px 1fr; gap: var(--sp-3); align-items: baseline; }
.hiw-wanted b { font: 400 var(--fs-lg)/1 var(--f-num); color: var(--sun); text-align: right; }
.hiw-wanted span { font-size: var(--fs-sm); line-height: 1.5; color: var(--t-dim); }

.hiw-ack p { font: 300 var(--fs-base)/1.8 var(--f-ui); color: var(--t-hi); margin-bottom: var(--sp-2); }
.hiw-ack p:last-child { color: var(--t-dim); margin-bottom: 0; }

.hiw-foot { flex: none; display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--edge); }
.hiw-cam { margin-left: auto; font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; }
.hiw-next { background: var(--sea); border-color: var(--sea); color: var(--t-on-accent); }
.hiw-next:hover { background: #55c8d5; border-color: #55c8d5; color: var(--t-on-accent); }

@media (max-width: 860px) {
  .hiw { right: var(--sp-2); left: var(--sp-2); width: auto; min-width: 0;
    top: auto; bottom: var(--sp-2); max-height: 72%; }
  .hiw-facts { grid-template-columns: 1fr; }
  .hiw-mode, .hiw-states > div { grid-template-columns: 1fr; gap: 2px; }
  /* The sheet is short here and the reading has to keep most of it. The strip loses its label,
     which the line under it says in words anyway. */
  .hiw-win { padding: var(--sp-2) var(--sp-3); }
  .hiw-win-k { display: none; }
}
`;
  document.head.appendChild(s);
}
