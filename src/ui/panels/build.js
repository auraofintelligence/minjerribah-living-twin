// The siting bench. Where you would put a thing, and what happens when you ask.
//
// THE CONSTRAINT IS THE GAME. In Cities: Skylines you draw a road and a road appears. On this
// island almost nothing physical happens because somebody decided it should. Read the count in
// data/civic.json: of sixty two levers, forty are decided by Redland City Council, twenty five by
// the Queensland Government, fourteen by QYAC, ten through the joint management of the national
// park, six by a private ferry operator, four by Minjerribah Camping, and one by nobody at all.
// The pack's own note is blunt about it: who_decides is the most important field in the file, and
// it is deliberately, frequently, not the player.
//
// So there is no build button here and there is never going to be one. What there is instead:
//
//   1. A CATALOGUE of the physical works in the pack, the ones with capital attached, because
//      those are the only ones that have to go somewhere.
//   2. A PIN. Drop it on the island, on the bench's own relief map or straight onto the ground in
//      the world. The pin is projected back into the view every frame, so it stays on the spot
//      while you fly around it.
//   3. WHAT THE GROUND SAYS. Read live out of world.island at that exact point: the region, the
//      cover, the height, the slope, how far from the waterline, whether it is inside a mapped
//      protected area, how far to a road you could get a truck down, and how far to a township.
//      Then the checks that matter for this particular work, derived from the metrics the lever's
//      own record says it touches, the same way src/systems/civic/council.js derives its form.
//   4. THE WALL. Who actually decides, in that body's own words from the pack, what the file will
//      have to carry, and what it will cost to find that out. Then one button, and the button does
//      not build anything: it emits civic:pursue and opens a file, and the file goes to the civic
//      board where the waiting happens.
//
// The most useful thing this panel does is tell you no before the council does, and tell you why
// in terms of the actual ground. A site inside Naree Budjong Djara National Park is not a planning
// argument you can win. A site 40 m from the waterline on a declared erosion prone reach is going
// to attract a coastal hazard assessment whatever anybody thinks of the idea.
//
// NOT MODELLED, AND SAID SO. Cultural heritage. Ground disturbance in Queensland carries a duty of
// care and this bench shows that the duty exists, what it costs and how long it takes, exactly as
// council.js does. It does not model the assessment and it does not generate a finding. Where a
// decision belongs to QYAC or to joint management, this panel says so and stops. data/lore.json is
// explicit: silence is accurate, an invented position is not.

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

/* ------------------------------------------------------------------ helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function money(v) {
  if (!isNum(v) || v === 0) return 'nothing';
  const a = Math.abs(v);
  if (a >= 1e6) return 'A$' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return 'A$' + Math.round(v / 1e3) + 'k';
  return 'A$' + Math.round(v);
}
function distance(m) {
  if (!isNum(m)) return '–';
  if (m < 950) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(1) + ' km';
}
function months(n) {
  if (!isNum(n)) return '–';
  if (n < 12) return n + ' months';
  const y = n / 12;
  return (Number.isInteger(y) ? y : y.toFixed(1)) + (y === 1 ? ' year' : ' years');
}

const COVER_WORDS = {
  water: 'open water', beach: 'beach', foredune: 'foredune', heath: 'wallum heath',
  forest: 'eucalypt forest', swamp: 'swamp', lake: 'a lake', rock: 'rock',
  saltmarsh: 'saltmarsh', mangrove: 'mangrove', cleared: 'cleared ground',
  urban: 'built-up ground', rehab: 'mine path rehabilitation'
};

/** Point in polygon, on a ring of [x, z] pairs. */
function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ the catalogue

   Physical works only. A lever with no capital does not have to go anywhere: a permit price, a
   registration scheme or a timetable change is a decision, not a site. The bench is for the ones
   that need ground under them, and it says how many it is leaving out. */

function catalogue(world) {
  const levers = (world.data && world.data.civic && world.data.civic.levers) || [];
  return levers.filter((l) => (l.cost_aud && l.cost_aud.capital) > 0);
}

/** The metrics a lever touches, in one set, exactly as src/systems/civic/council.js reads them. */
function touchesOf(lv) {
  const set = new Set();
  for (const e of lv.effects || []) set.add(e.target);
  for (const e of lv.side_effects || []) set.add(e.target);
  return set;
}

/* ================================================================== the panel */

registerPanel({
  id: 'build',
  order: 45,
  mount(root, world) { return mountBench(root, world); }
});

function mountBench(root, world) {
  if (!world.island || !world.island.bounds) return null;
  injectStyle();

  const island = world.island;
  const B = island.bounds;
  const works = catalogue(world);
  const allLevers = (world.data && world.data.civic && world.data.civic.levers) || [];

  /* ---- roads and townships, indexed once ------------------------------- */

  const DRIVEABLE = { sealed_road: 1, street: 1, unsealed_road: 1 };
  const roadPts = [];
  for (const r of (world.data && world.data.geography && world.data.geography.roads) || []) {
    if (!DRIVEABLE[r.type] || !Array.isArray(r.coordinates)) continue;
    for (const c of r.coordinates) {
      const p = island.project(c[0], c[1]);
      roadPts.push([p.x, p.z, r.name, r.type]);
    }
  }
  const towns = [];
  for (const p of (world.data && world.data.places && world.data.places.places) || []) {
    if (p.type !== 'township' || !isNum(p.lon)) continue;
    const q = island.project(p.lon, p.lat);
    towns.push({ id: p.id, name: p.name, x: q.x, z: q.z });
  }

  function nearest(list, x, z) {
    let best = null, bestD = Infinity;
    for (const p of list) {
      const dx = (Array.isArray(p) ? p[0] : p.x) - x;
      const dz = (Array.isArray(p) ? p[1] : p.z) - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { item: best, m: Math.sqrt(bestD) } : null;
  }

  function parkAt(x, z) {
    if (!island.parks) return null;
    for (const p of island.parks) for (const part of p.parts) if (inRing(x, z, part)) return p.name;
    return null;
  }

  /* ---- launcher and board ---------------------------------------------- */

  const badge = el('span', { class: 'dot' });
  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'The siting bench (k)', onclick: () => toggle()
  }, 'Siting bench', badge);
  rail().append(launcher);

  const scrim = el('div', { class: 'bd-scrim', onclick: () => toggle(false) });
  const board = el('section', {
    class: 'panel bd-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'The siting bench'
  });
  root.append(scrim, board);

  const flash = el('div', { class: 'bd-flash' });
  const head = el('div', { class: 'bd-top' },
    el('div', {},
      el('h2', {}, 'The siting bench'),
      el('div', { class: 'bd-sub' },
        'Nothing here is built by placing it. Of the ' + allLevers.length + ' levers in the pack, '
        + works.length + ' need ground under them, and most of those are somebody else\'s decision. '
        + 'What you can do is find out what the ground says before you ask.'),
      flash),
    el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

  const colWorks = el('div', { class: 'bd-pane bd-works scroll' });
  const colMap = el('div', { class: 'bd-pane bd-mid' });
  const colSite = el('div', { class: 'bd-pane bd-site scroll' });
  const cols = el('div', { class: 'bd-cols' }, colWorks, colMap, colSite);
  board.append(head, cols);

  let open = false;
  function toggle(force) {
    open = force === undefined ? !open : !!force;
    scrim.classList.toggle('on', open);
    board.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    if (open) { world.bus.emit('ui:drawer', { id: 'build' }); refresh(true); board.focus({ preventScroll: true }); }
    else armWorldPick(false);
    marker.classList.toggle('hide', !open && !pin);
  }
  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'build' && open) toggle(false); });
  world.bus.on('ui:open', (p) => { if (p && p.id === 'build') { if (p.leverId) select(p.leverId); toggle(true); } });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && (open || picking)) { armWorldPick(false); toggle(false); e.preventDefault(); }
    else if (e.code === 'KeyK') { toggle(); e.preventDefault(); }
  });

  function say(msg) {
    flash.textContent = msg;
    setTimeout(() => { if (flash.textContent === msg) flash.textContent = ''; }, 6000);
  }

  /**
   * Asking is not the same as being heard. The council refuses to open a file on a lever that is
   * already being delivered, and the first version of this panel said "file opened" either way,
   * which is exactly the kind of lie this project is not allowed to tell. So the panel listens for
   * the system's own confirmation and reports what actually happened.
   */
  const opened = new Set();
  world.bus.on('civic:application', (p) => {
    if (!p || p.stage !== 'preparing' || !p.leverId) return;
    opened.add(p.leverId);
    if (asked && asked.leverId === p.leverId) {
      say('File opened on ' + asked.name + '. It appears in the in tray on the change of the day, '
        + 'because that is when the council republishes its list.');
      asked = null;
    }
    refresh(true);
  });
  let asked = null;

  /** What the policy system says this lever is already doing, if anything. */
  function runtimeOf(id) {
    const p = world.read('policy');
    return (p && p.levers && p.levers[id]) || null;
  }

  /* ---- state ------------------------------------------------------------ */

  let leverId = null;
  let pin = null;             // {x, z}
  let query = '';
  let issueFilter = 'all';
  let lastAppId = null;

  function lever() { return works.find((l) => l.id === leverId) || null; }
  function select(id) {
    leverId = id;
    // The pin stays where it is when you change your mind about what goes there, which is how
    // anybody actually uses a map: you find the spot first and argue about the building after.
    refresh(true);
  }

  /* ---- the world marker -------------------------------------------------
     A DOM pin projected from the world point every UI frame. It costs one matrix transform and it
     means the pin is a thing standing on the island rather than a dot on a minimap. */

  const marker = el('div', { class: 'bd-marker hide' },
    el('i', {}), el('b', {}), el('u', {}));
  root.append(marker);

  function paintMarker() {
    if (!pin || !world.stage || !world.stage.scene) { marker.classList.add('hide'); return; }
    const scene = world.stage.scene;
    const cam = scene.activeCamera;
    const BJS = window.BABYLON;
    if (!cam || !BJS) { marker.classList.add('hide'); return; }
    const y = island.height(pin.x, pin.z);
    const eng = world.stage.engine;
    let p = null;
    try {
      p = BJS.Vector3.Project(
        new BJS.Vector3(pin.x, y + 1.5, pin.z),
        BJS.Matrix.Identity(),
        scene.getTransformMatrix(),
        cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
    } catch (e) { marker.classList.add('hide'); return; }
    // Behind the camera, or off screen: hide rather than pin it to an edge.
    const toPoint = new BJS.Vector3(pin.x - cam.globalPosition.x, 0, pin.z - cam.globalPosition.z);
    const fwd = cam.getForwardRay ? cam.getForwardRay().direction : null;
    const behind = fwd ? (toPoint.x * fwd.x + toPoint.z * fwd.z) < 0 : false;
    const r = world.stage.canvas.getBoundingClientRect();
    const sx = r.width / Math.max(1, eng.getRenderWidth());
    const sy = r.height / Math.max(1, eng.getRenderHeight());
    const px = r.left + p.x * sx;
    const py = r.top + p.y * sy;
    if (behind || px < -80 || py < -80 || px > window.innerWidth + 80 || py > window.innerHeight + 80) {
      marker.classList.add('hide');
      return;
    }
    marker.classList.remove('hide');
    marker.style.left = Math.round(px) + 'px';
    marker.style.top = Math.round(py) + 'px';
    const lv = lever();
    marker.querySelector('b').textContent = lv ? lv.name : 'Candidate site';
    marker.querySelector('u').textContent = island.regionAt(pin.x, pin.z);
  }

  /* ---- picking on the world --------------------------------------------
     Capture phase on pointerup only. Pointerdown still reaches the camera, so the island can be
     panned and orbited while a site is being chosen; the selection layer's own click never fires,
     so choosing a site does not also select a house. */

  let picking = false;
  let downAt = null;

  function onDown(e) {
    if (!picking || e.button !== 0) return;
    const r = world.stage.canvas.getBoundingClientRect();
    downAt = { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onUp(e) {
    if (!picking || !downAt) return;
    const r = world.stage.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const moved = Math.hypot(x - downAt.x, y - downAt.y);
    downAt = null;
    if (moved > 5) return;              // that was a pan, and the camera keeps it
    e.preventDefault();
    e.stopPropagation();
    const scene = world.stage.scene;
    const eng = world.stage.engine;
    let ray = null;
    try {
      ray = scene.createPickingRay(
        (x / r.width) * eng.getRenderWidth(),
        (y / r.height) * eng.getRenderHeight(), null, scene.activeCamera);
    } catch (err) { ray = null; }
    if (!ray) return;
    const hit = island.raycast(ray.origin, ray.direction, 42000);
    if (!hit) { say('That ray went past the island.'); return; }
    setPin(hit.x, hit.z);
    armWorldPick(false);
  }

  function armWorldPick(on) {
    if (!world.stage || !world.stage.canvas) return;
    const c = world.stage.canvas;
    if (on === picking) return;
    picking = !!on;
    if (picking) {
      c.addEventListener('pointerdown', onDown, true);
      c.addEventListener('pointerup', onUp, true);
      c.style.cursor = 'crosshair';
      document.body.classList.add('bd-picking');
    } else {
      c.removeEventListener('pointerdown', onDown, true);
      c.removeEventListener('pointerup', onUp, true);
      c.style.cursor = '';
      document.body.classList.remove('bd-picking');
    }
    refresh(true);
  }

  function setPin(x, z) {
    pin = { x, z };
    world.bus.emit('build:sited', { x, z, leverId });
    refresh(true);
  }

  /**
   * A console handle, in the same spirit as world.island, world.camera and world.selection. It is
   * how a critic drives this bench without a mouse, and how a reader of the read model can check
   * that the checks below are reading the real heightfield rather than a table.
   */
  world.siting = {
    place: (x, z) => { setPin(x, z); return world.siting.report(); },
    at: (lon, lat) => { const q = island.project(lon, lat); return world.siting.place(q.x, q.z); },
    clear: () => { pin = null; refresh(true); },
    work: (id) => { select(id); return id; },
    works: () => works.map((l) => ({ id: l.id, name: l.name, capital: l.cost_aud.capital, role: l.player_role })),
    report: () => {
      const g = readGround();
      const lv = lever();
      return { lever: lv ? lv.id : null, ground: g, checks: checks(g, lv) };
    }
  };

  /* ---- the relief map ---------------------------------------------------- */

  const PAD = 1200;
  const box = { x0: B.minX - PAD, x1: B.maxX + PAD, z0: B.minZ - PAD, z1: B.maxZ + PAD };
  const aspect = (box.x1 - box.x0) / (box.z1 - box.z0);
  const base = bakeRelief(world);

  const cv = el('canvas', { class: 'bd-cv' });
  const mapTip = el('div', { class: 'bd-tip' });
  const mapWrap = el('div', { class: 'bd-map' }, cv, mapTip);
  const mapFoot = el('div', { class: 'bd-mapfoot' });
  colMap.append(
    el('div', { class: 'bd-h' }, 'Where'),
    mapWrap,
    mapFoot);

  function sizeMap() {
    const h = clamp(Math.round(colMap.clientHeight - 120), 220, 620);
    const w = Math.round(h * aspect);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const toPx = (x, z) => ({
    px: ((x - box.x0) / (box.x1 - box.x0)) * cv.width,
    py: ((box.z1 - z) / (box.z1 - box.z0)) * cv.height
  });
  const toWorld = (px, py) => ({
    x: box.x0 + (px / cv.width) * (box.x1 - box.x0),
    z: box.z1 - (py / cv.height) * (box.z1 - box.z0)
  });

  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const p = toWorld(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height);
    setPin(p.x, p.z);
    world.bus.emit('camera:goto', { x: p.x, z: p.z, dist: 1400, dur: 1.1 });
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    const p = toWorld(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height);
    const h = island.height(p.x, p.z) - island.seaLevel;
    mapTip.textContent = island.regionAt(p.x, p.z) + ' · '
      + (h > 0 ? (COVER_WORDS[island.landCover(p.x, p.z)] || island.landCover(p.x, p.z)) + ', ' + h.toFixed(0) + ' m' : 'water');
    mapTip.style.left = clamp(e.clientX - r.left + 12, 4, r.width - 190) + 'px';
    mapTip.style.top = clamp(e.clientY - r.top + 12, 4, r.height - 40) + 'px';
    mapTip.classList.add('on');
  });
  cv.addEventListener('pointerleave', () => mapTip.classList.remove('on'));

  function drawMap() {
    if (!cv.width) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    blit(g, base, box, cv.width, cv.height);
    const k = cv.width / 260;

    // Protected areas, because they are the first answer the bench gives.
    g.save();
    g.strokeStyle = 'rgba(143,191,90,.72)';
    g.fillStyle = 'rgba(143,191,90,.10)';
    g.lineWidth = Math.max(0.6, 0.8 * k);
    for (const p of island.parks || []) {
      for (const part of p.parts) {
        if (part.length < 3) continue;
        g.beginPath();
        for (let i = 0; i < part.length; i++) {
          const q = toPx(part[i][0], part[i][1]);
          if (i === 0) g.moveTo(q.px, q.py); else g.lineTo(q.px, q.py);
        }
        g.closePath(); g.fill(); g.stroke();
      }
    }
    g.restore();

    // The roads you could get a truck down.
    g.strokeStyle = 'rgba(140,153,163,.66)';
    g.lineWidth = Math.max(0.5, 0.7 * k);
    g.beginPath();
    for (const r of (world.data && world.data.geography && world.data.geography.roads) || []) {
      if (!DRIVEABLE[r.type] || !Array.isArray(r.coordinates)) continue;
      for (let i = 0; i < r.coordinates.length; i++) {
        const p = island.project(r.coordinates[i][0], r.coordinates[i][1]);
        const q = toPx(p.x, p.z);
        if (i === 0) g.moveTo(q.px, q.py); else g.lineTo(q.px, q.py);
      }
    }
    g.stroke();

    // The three townships.
    g.textAlign = 'center';
    for (const t of towns) {
      const q = toPx(t.x, t.z);
      g.fillStyle = 'rgba(242,235,220,.9)';
      g.beginPath(); g.arc(q.px, q.py, 1.8 * k, 0, Math.PI * 2); g.fill();
      g.font = '600 ' + Math.round(8 * k) + 'px system-ui, sans-serif';
      g.strokeStyle = 'rgba(6,9,11,.85)'; g.lineWidth = 2.6 * k;
      g.strokeText(t.name, q.px, q.py - 5 * k);
      g.fillText(t.name, q.px, q.py - 5 * k);
    }

    if (pin) {
      const q = toPx(pin.x, pin.z);
      const ok = !parkAt(pin.x, pin.z) && island.height(pin.x, pin.z) > island.seaLevel;
      g.strokeStyle = ok ? '#3fb6c4' : '#e2725b';
      g.lineWidth = Math.max(1, 1.3 * k);
      g.beginPath(); g.arc(q.px, q.py, 5 * k, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      g.moveTo(q.px - 8 * k, q.py); g.lineTo(q.px + 8 * k, q.py);
      g.moveTo(q.px, q.py - 8 * k); g.lineTo(q.px, q.py + 8 * k);
      g.stroke();
    }
  }

  /* ---- what the ground says ---------------------------------------------- */

  function readGround() {
    if (!pin) return null;
    const { x, z } = pin;
    const h = island.height(x, z) - island.seaLevel;
    const road = nearest(roadPts, x, z);
    const town = nearest(towns, x, z);
    return {
      x, z,
      region: island.regionAt(x, z),
      cover: island.landCover(x, z),
      heightM: h,
      slopeDeg: (island.slope(x, z) * 180) / Math.PI,
      shoreM: island.shoreDistance(x, z),
      park: parkAt(x, z),
      road: road ? { name: road.item[2], type: road.item[3], m: road.m } : null,
      town: town ? { name: town.item.name, m: town.m } : null,
      lonLat: island.unproject(x, z)
    };
  }

  /**
   * The checks. Everything general first, then the ones that come from what this particular lever
   * says it touches. A `stop` is the ground saying no. A `flag` is the ground saying it will cost
   * you: a study, a season, or a condition on the approval.
   */
  function checks(g, lv) {
    const out = [];
    const add = (level, text, why) => out.push({ level, text, why });
    if (!g) return out;

    if (g.heightM <= 0) {
      add('stop', 'This point is under water', 'The heightfield puts it ' + Math.abs(g.heightM).toFixed(1)
        + ' m below mean sea level. Works in the water are a different approval again and this bench does not model them.');
    }
    if (g.park) {
      add('stop', 'Inside ' + g.park, 'Naree Budjong Djara National Park is jointly managed by QYAC '
        + 'and Queensland Parks under an Indigenous Management Agreement. This twin does not model a '
        + 'joint management decision and will not guess at one. The park outline itself is indicative.');
    }
    if (g.slopeDeg > 16) {
      add('flag', 'Steep: ' + g.slopeDeg.toFixed(0) + ' degrees', 'Anything over about sixteen degrees '
        + 'on unconsolidated sand means earthworks, and earthworks on this island mean sand going somewhere else.');
    }
    if (g.heightM > 0 && g.heightM < 3 && g.shoreM < 220) {
      add('flag', 'Low and close to the water', 'About ' + distance(g.shoreM) + ' from the waterline at '
        + g.heightM.toFixed(1) + ' m. Redland City Council\'s 2016 current hazards work assessed Amity '
        + 'Point as the only part of the city at high risk, and low ground near the shore is where a '
        + 'coastal hazard assessment comes from.');
    }
    if (g.road && g.road.m > 400) {
      add('flag', 'No road to it: ' + distance(g.road.m) + ' to ' + g.road.name,
        'Nothing gets built where a truck cannot go. That distance is either a new access track, which '
        + 'is its own approval, or it is the reason the estimate doubles.');
    }
    if (g.cover === 'forest') {
      add('flag', 'Eucalypt forest', 'Koala habitat on this island is forest. Clearing it is what the '
        + 'habitat overlay is about, and it is the fastest way to attract an environmental assessment.');
    }
    if (g.cover === 'swamp' || g.cover === 'saltmarsh' || g.cover === 'mangrove') {
      add('flag', COVER_WORDS[g.cover] + ' ground', 'Wetland. Eighteen Mile Swamp is the water table '
        + 'showing itself, and the shorebirds feed on the flats. Expect the assessment to be about that.');
    }
    if (g.cover === 'foredune' || g.cover === 'beach') {
      add('flag', 'On the active dune', 'The foredune is the thing that moves. Building on it is how '
        + 'the sand stops being able to.');
    }

    if (!lv) return out;
    const touches = touchesOf(lv);
    const has = (m) => touches.has(m);

    if ((has('erosion_risk_amity') || has('beach_width_amity') || lv.issue === 'amity-erosion') && g.shoreM > 250) {
      add('flag', 'A long way from the reach it is meant to protect',
        distance(g.shoreM) + ' inland. This lever is written about the shoreline, so a site back here '
        + 'is going to need explaining before anything else does.');
    }
    if (has('housing_supply') || lv.issue === 'housing') {
      if (g.town && g.town.m > 1500) {
        add('flag', 'Away from a township: ' + distance(g.town.m) + ' to ' + g.town.name,
          'Housing away from services is housing that needs a car, and this island has one main road.');
      }
      add('note', 'Publicly notified', 'A housing application decided by Redland City Council goes out '
        + 'for public notification. Four weeks of submissions before anybody votes on it.');
    }
    if (has('traffic_volume') || has('parking_pressure') || has('barge_queue_peak')) {
      add('note', 'Traffic and parking assessment', 'One main road, three townships, and a carpark that '
        + 'fills by eight. About ten weeks and A$38,000.');
    }
    if (has('shorebird_disturbance') || has('koala_population') || has('dune_condition') || has('water_quality_nearshore')) {
      add('note', 'Environmental assessment', 'It touches habitat, so it needs somebody to say by how '
        + 'much. About sixteen weeks and A$45,000.');
    }
    if ((lv.cost_aud.capital || 0) > 250000) {
      add('note', 'Cultural heritage duty of care',
        'Ground disturbance in Queensland carries a duty of care. This twin models the requirement, the '
        + 'cost and the wait. It does not model the assessment and it does not generate a finding. '
        + 'QYAC is the cultural heritage body for the Quandamooka estate.');
    }
    return out;
  }

  /* ---- rebuild ----------------------------------------------------------- */

  let sig = '';
  function signature() {
    const c = world.read('council') || {};
    return [leverId, pin ? Math.round(pin.x) + ',' + Math.round(pin.z) : '', query, issueFilter, picking,
      (c.applications || []).map((a) => a.id + a.stage).join(',')].join('~');
  }

  function refresh(force) {
    if (!open) return;
    const s = signature();
    if (!force && s === sig) return;
    sig = s;
    drawWorks();
    sizeMap();
    drawMap();
    drawSite();
  }

  /* ---- column one: the works --------------------------------------------- */

  function drawWorks() {
    colWorks.textContent = '';
    const issues = [...new Set(works.map((l) => l.issue))].sort();
    const filters = el('div', { class: 'bd-filters' },
      el('input', {
        type: 'search', class: 'bd-search', placeholder: 'Search the works', value: query,
        oninput: (e) => { query = e.target.value; refresh(true); }
      }));
    const chips = el('div', { class: 'bd-chips' });
    chips.append(el('button', {
      class: 'btn' + (issueFilter === 'all' ? ' on' : ''), type: 'button',
      onclick: () => { issueFilter = 'all'; refresh(true); }
    }, 'All'));
    for (const i of issues) {
      chips.append(el('button', {
        class: 'btn' + (issueFilter === i ? ' on' : ''), type: 'button',
        onclick: () => { issueFilter = i; refresh(true); }
      }, i.replace(/-/g, ' ')));
    }
    colWorks.append(el('div', { class: 'bd-h' }, 'What'), filters, chips);

    const q = query.trim().toLowerCase();
    const list = works.filter((l) =>
      (issueFilter === 'all' || l.issue === issueFilter)
      && (!q || (l.name + ' ' + l.description).toLowerCase().includes(q)));

    if (!list.length) {
      colWorks.append(el('p', { class: 'bd-p' }, 'Nothing in the pack matches that.'));
      return;
    }
    const rows = el('div', { class: 'rows' });
    for (const l of list) {
      const role = l.player_role;
      const roleChip = role === 'player_decides' ? ['sea', 'yours to decide']
        : role === 'player_funds' ? ['sun', 'you can fund it']
          : role === 'player_advocates' ? ['iron', 'you can only ask']
            : ['coral', 'you can only watch'];
      rows.append(el('div', {
        class: 'bd-work' + (leverId === l.id ? ' on' : ''), tabindex: '0', role: 'button',
        onclick: () => select(l.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(l.id); } }
      },
      el('div', { class: 'bd-work-n' }, l.name),
      el('div', { class: 'bd-work-m' },
        el('span', {}, money(l.cost_aud.capital)),
        el('span', {}, months(l.lead_time_months)),
        el('span', { class: 'chip ' + roleChip[0] }, roleChip[1]))));
    }
    colWorks.append(rows);
    colWorks.append(el('p', { class: 'bd-p quiet' },
      'The other ' + (allLevers.length - works.length) + ' levers in the pack carry no capital: a price, '
      + 'a registration, a timetable, a rule. They do not need a site, so they are not on this bench. '
      + 'They are all on the civic board.'));
  }

  /* ---- column two footer ------------------------------------------------- */

  function drawMapFoot() {
    mapFoot.textContent = '';
    mapFoot.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn' + (picking ? ' on' : ''), type: 'button',
        onclick: () => armWorldPick(!picking)
      }, picking ? 'Click the island…' : 'Place on the world'),
      pin ? el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { world.bus.emit('camera:goto', { x: pin.x, z: pin.z, dist: 420, dur: 1.2 }); }
      }, 'Fly to it') : null,
      pin ? el('button', {
        class: 'btn ghost', type: 'button', onclick: () => { pin = null; refresh(true); }
      }, 'Clear the pin') : null));
    mapFoot.append(el('p', { class: 'bd-p quiet' },
      picking
        ? 'Click the ground in the view behind this panel. Drag still pans the camera, so you can move '
          + 'around while you choose. Escape gives up.'
        : 'Click the map to drop a pin, or place it on the ground in the world. Green is a mapped '
          + 'protected area. Grey is a road a truck can use.'));
  }

  /* ---- column three: the site -------------------------------------------- */

  function drawSite() {
    drawMapFoot();
    colSite.textContent = '';
    const lv = lever();
    const g = readGround();

    colSite.append(el('div', { class: 'bd-h' }, 'What the ground says'));

    if (!g) {
      colSite.append(el('p', { class: 'bd-p' },
        'No pin yet. Drop one on the map, or put it on the ground in the world.'));
      if (lv) drawWho(lv);
      return;
    }

    const facts = el('table', { class: 'bd-table' });
    const line = (k, v) => facts.append(el('tr', {}, el('th', {}, k), el('td', {}, v)));
    line('Where', g.region);
    line('Ground', COVER_WORDS[g.cover] || g.cover);
    line('Height', g.heightM > 0 ? g.heightM.toFixed(1) + ' m above mean sea level' : Math.abs(g.heightM).toFixed(1) + ' m below it');
    line('Slope', g.slopeDeg.toFixed(1) + '°');
    line('To the waterline', distance(g.shoreM));
    line('Nearest road', g.road ? distance(g.road.m) + ' to ' + g.road.name : 'none within the network');
    line('Nearest township', g.town ? distance(g.town.m) + ' to ' + g.town.name : '–');
    line('Protected area', g.park || 'none mapped here');
    line('Position', g.lonLat.lat.toFixed(5) + ', ' + g.lonLat.lon.toFixed(5));
    colSite.append(facts);

    const list = checks(g, lv);
    const stops = list.filter((c) => c.level === 'stop');
    if (list.length) {
      colSite.append(el('div', { class: 'bd-h' }, stops.length ? 'The ground says no' : 'What this site will cost you'));
      for (const c of list) {
        colSite.append(el('div', { class: 'bd-check ' + c.level },
          el('b', {}, c.text),
          el('span', {}, c.why)));
      }
    } else if (lv) {
      colSite.append(el('p', { class: 'bd-p' }, 'Nothing on this ground stands in the way of it.'));
    }

    if (lv) drawWho(lv, stops.length > 0);
  }

  function drawWho(lv, blocked) {
    const council = world.read('council');
    const who = council && council.whoDecides ? council.whoDecides(lv.id) : null;
    const app = council ? (council.applications || []).find((a) => a.leverId === lv.id) : null;

    colSite.append(el('div', { class: 'bd-h' }, 'Who decides'));
    colSite.append(el('div', { class: 'bd-who' },
      el('b', {}, who ? who.deciders.map((d) => d.label).join(', ') : lv.who_decides.join(', ')),
      el('span', {}, who ? who.plain : ''),
      who && who.deciders.some((d) => d.notModelled)
        ? el('em', {}, 'This twin does not model that decision and will not guess at it. '
          + 'data/lore.json records the rule: no Quandamooka or QYAC view on a lever unless QYAC has '
          + 'publicly stated it. There are five such statements and they are all in the pack.')
        : null));

    const nums = el('div', { class: 'bd-nums' },
      numBox(money(lv.cost_aud.capital), 'to build'),
      numBox(lv.cost_aud.recurring_per_year ? money(lv.cost_aud.recurring_per_year) : 'nothing', 'a year to run'),
      numBox(months(lv.lead_time_months), 'lead time'));
    colSite.append(nums);
    if (lv.cost_aud.basis) {
      colSite.append(el('p', { class: 'bd-p quiet' },
        'Costs: ' + lv.cost_aud.basis + (lv.cost_aud.confidence ? ' (' + lv.cost_aud.confidence + ' confidence)' : '') + '.'));
    }

    // Already under way. The council will not open a second file on something it is already
    // delivering, so the bench does not offer to, and it says what is happening instead.
    const rt = runtimeOf(lv.id);
    const running = rt && (rt.status === 'delivering' || rt.status === 'active' || rt.status === 'in-place' || rt.level > 0);
    if (running && !app) {
      colSite.append(el('div', { class: 'bd-open' },
        el('b', {}, 'This one is already under way'),
        el('span', {}, rt.note || ('Status: ' + rt.status + '.')),
        rt.status === 'delivering' && isNum(rt.progress)
          ? el('span', {}, Math.round(rt.progress * 100) + ' per cent through a '
            + months(rt.leadMonths) + ' delivery.')
          : null,
        el('span', {}, 'A file cannot be opened on something that is already being delivered. '
          + 'The trace on the civic board is where the rest of it is.'),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { world.bus.emit('ui:open', { id: 'civic', tab: 'traces', leverId: lv.id }); toggle(false); }
        }, 'Follow it on the civic board')));
      return;
    }

    if (app) {
      colSite.append(el('div', { class: 'bd-open' },
        el('b', {}, 'A file is already open on this'),
        el('span', {}, app.stageLabel + (isNum(app.waitingDays) && app.waitingDays > 0
          ? ', ' + app.waitingDays + ' days to the next move.' : '.')),
        el('span', {}, app.whose),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { world.bus.emit('ui:open', { id: 'civic', tab: 'intray', appId: app.id, leverId: lv.id }); toggle(false); }
        }, 'Open it on the civic board')));
      return;
    }

    const canOpen = !blocked;
    colSite.append(el('div', { class: 'bd-act' },
      el('button', {
        class: 'btn bd-go', type: 'button', disabled: canOpen ? null : true,
        onclick: () => {
          asked = { leverId: lv.id, name: lv.name, at: world.clock.tick };
          world.bus.emit('ui:intent', { kind: 'civic:pursue', leverId: lv.id });
          say('Asked. The council picks intents up on its next pass, so this takes a tick to answer.');
          refresh(true);
        }
      }, 'Open a file on it'),
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { world.bus.emit('ui:open', { id: 'civic', tab: 'levers', leverId: lv.id }); toggle(false); }
      }, 'Read the whole lever')));
    colSite.append(el('p', { class: 'bd-p quiet' },
      canOpen
        ? 'Opening a file does not build anything. It starts a clock. The studies get commissioned and '
          + 'paid for on the civic board, and the decision belongs to somebody else.'
        : 'The ground rules this site out before anybody votes on it. Move the pin.'));
  }

  function numBox(v, k) {
    return el('div', { class: 'bd-num' }, el('b', {}, v), el('i', {}, k));
  }

  /* ---- the loop ---------------------------------------------------------- */

  window.addEventListener('resize', () => { if (open) { sizeMap(); drawMap(); } });

  let frames = 0;
  return {
    update() {
      if (pin) paintMarker();
      // An ask that nothing answered within a few ticks was refused by the system, silently, and
      // the panel says so rather than leaving a message on screen that turned out not to be true.
      if (asked && world.clock.tick - asked.at > 3) {
        const name = asked.name;
        asked = null;
        say('The council did not open a file on ' + name + '. It refuses one on a lever that is '
          + 'already being delivered or already in place. The civic board has the trace.');
      }
      if (!open) return;
      refresh(false);
      // The relief and the roads do not move, but the pin does and the camera does, so the map is
      // redrawn twice a second rather than ten times.
      if ((++frames % 5) === 0) drawMap();
    }
  };

  /* ---- the relief bake ---------------------------------------------------- */

  function bakeRelief(w) {
    const G = w.island.sampleGrid(340);
    const cvs = document.createElement('canvas');
    cvs.width = G.nx; cvs.height = G.nz;
    const g = cvs.getContext('2d');
    const img = g.createImageData(G.nx, G.nz);
    const sea = G.seaLevel;
    const COVER = {
      water: [16, 40, 54], beach: [206, 192, 160], foredune: [178, 160, 118],
      heath: [88, 102, 62], forest: [42, 62, 38], swamp: [58, 52, 34],
      lake: [40, 100, 112], rock: [98, 90, 82], saltmarsh: [110, 114, 80],
      mangrove: [38, 62, 48], cleared: [122, 120, 92], urban: [134, 80, 62],
      rehab: [82, 106, 62]
    };
    const cover = G.covers.map((c) => COVER[c] || [80, 84, 76]);
    const lx = -0.6, lz = 0.6, ly = 0.53;
    for (let j = 0; j < G.nz; j++) {
      const row = (G.nz - 1 - j) * G.nx;
      const jm = Math.max(0, j - 1) * G.nx, jp = Math.min(G.nz - 1, j + 1) * G.nx;
      for (let i = 0; i < G.nx; i++) {
        const k = j * G.nx + i;
        const h = G.height[k];
        const o = (row + i) * 4;
        img.data[o + 3] = 255;
        if (h <= sea) {
          const d = clamp((sea - h) / 26, 0, 1);
          img.data[o] = 20 - 12 * d; img.data[o + 1] = 48 - 28 * d; img.data[o + 2] = 62 - 30 * d;
          continue;
        }
        const c = cover[G.cover[k]];
        const im = Math.max(0, i - 1), ip = Math.min(G.nx - 1, i + 1);
        const hx = (G.height[j * G.nx + ip] - G.height[j * G.nx + im]) / ((ip - im) * G.cellX);
        const hz = (G.height[jp + i] - G.height[jm + i]) / (((jp - jm) / G.nx) * G.cellZ);
        const inv = 1 / Math.sqrt(hx * hx + hz * hz + 1);
        const shade = 0.66 + 0.94 * clamp((-hx * lx + -hz * lz + ly) * inv, 0, 1);
        img.data[o] = clamp(c[0] * shade, 0, 255);
        img.data[o + 1] = clamp(c[1] * shade, 0, 255);
        img.data[o + 2] = clamp(c[2] * shade, 0, 255);
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: cvs, nx: G.nx, nz: G.nz, x0: G.x0, z0: G.z0, cellX: G.cellX, cellZ: G.cellZ };
  }

  function blit(g, meta, frame, W, H) {
    let sx = (frame.x0 - meta.x0) / meta.cellX;
    let sw = (frame.x1 - frame.x0) / meta.cellX;
    let sy = meta.nz - 1 - (frame.z1 - meta.z0) / meta.cellZ;
    let sh = (frame.z1 - frame.z0) / meta.cellZ;
    let dx = 0, dy = 0, dw = W, dh = H;
    const kx = W / sw, ky = H / sh;
    if (sx < 0) { dx = -sx * kx; dw += sx * kx; sw += sx; sx = 0; }
    if (sy < 0) { dy = -sy * ky; dh += sy * ky; sh += sy; sy = 0; }
    if (sx + sw > meta.nx) { const over = sx + sw - meta.nx; sw -= over; dw -= over * kx; }
    if (sy + sh > meta.nz) { const over = sy + sh - meta.nz; sh -= over; dh -= over * ky; }
    if (sw > 1 && sh > 1) g.drawImage(meta.canvas, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

/* ------------------------------------------------------------------ style */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'bd-style';
  s.textContent = `
.bd-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.bd-scrim.on { opacity: 1; pointer-events: auto; }
.bd-board { position: fixed; inset: var(--board-inset); z-index: 41; display: flex; flex-direction: column;
  max-width: 1680px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.bd-board.on { opacity: 1; transform: none; pointer-events: auto; }
/* While a site is being chosen the board gets out of the way of the island it is about. */
body.bd-picking .bd-board { opacity: .12; pointer-events: none; }
body.bd-picking .bd-scrim { opacity: 0; pointer-events: none; }
@media (max-width: 860px) { .bd-board { inset: 0; border-radius: 0; } }

.bd-top { display: flex; align-items: flex-start; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.bd-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.bd-sub { font-size: var(--fs-sm); color: var(--t-faint); max-width: 84ch; line-height: 1.5; }
.bd-top > button { margin-left: auto; }
.bd-flash { font-size: var(--fs-sm); color: var(--sea); margin-top: 5px; min-height: 1.3em; }

.bd-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px 1fr 380px; }
.bd-cols > * { min-height: 0; }
.bd-pane { min-height: 0; padding: var(--sp-3); border-right: 1px solid var(--edge); }
.bd-pane:last-child { border-right: none; }
.bd-mid { display: flex; flex-direction: column; align-items: center; }

.bd-h { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--t-faint);
  font-weight: 600; margin: var(--sp-4) 0 var(--sp-2); align-self: stretch; }
.bd-h:first-child { margin-top: 0; }
.bd-p { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-dim); margin: var(--sp-2) 0; }
.bd-p.quiet { color: var(--t-faint); font-size: var(--fs-micro); line-height: 1.65; }

.bd-filters { margin-bottom: var(--sp-2); }
.bd-search { width: 100%; appearance: none; background: var(--s-sunk); border: 1px solid var(--edge-strong);
  border-radius: var(--r-2); color: var(--t); font: var(--fs-sm) var(--f-ui); padding: var(--sp-2) var(--sp-3); }
.bd-search:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.bd-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: var(--sp-3); }
.bd-chips .btn { padding: 3px 6px; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }

.bd-work { padding: var(--sp-2) var(--sp-3); border-radius: var(--r-2); cursor: pointer;
  border: 1px solid transparent; transition: background var(--fast), border-color var(--fast); }
.bd-work:hover { background: rgba(255,255,255,.05); }
.bd-work.on { background: rgba(63,182,196,.12); border-color: rgba(63,182,196,.4); }
.bd-work:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.bd-work-n { color: var(--t-hi); font-size: var(--fs-sm); line-height: 1.4; }
.bd-work-m { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: 3px;
  font: 400 var(--fs-micro)/1.6 var(--f-num); color: var(--t-faint); }

.bd-map { position: relative; }
.bd-cv { display: block; cursor: crosshair; background: #06111a; border: 1px solid var(--edge);
  border-radius: var(--r-2); }
.bd-tip { position: absolute; pointer-events: none; background: var(--s-2); border: 1px solid var(--edge-strong);
  border-radius: var(--r-1); padding: 3px 7px; font: 400 var(--fs-micro)/1.5 var(--f-num); color: var(--t);
  opacity: 0; transition: opacity var(--fast); white-space: nowrap; }
.bd-tip.on { opacity: 1; }
.bd-mapfoot { align-self: stretch; margin-top: var(--sp-3); }

.bd-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin-bottom: var(--sp-3); }
.bd-table th { text-align: left; font-weight: 400; color: var(--t-faint); padding: 3px 8px 3px 0;
  white-space: nowrap; vertical-align: top; }
.bd-table td { padding: 3px 0; color: var(--t-hi); text-align: right; font-family: var(--f-num);
  font-variant-numeric: tabular-nums; }

.bd-check { border-left: 2px solid var(--iron); padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-2);
  background: rgba(255,255,255,.022); border-radius: 0 var(--r-2) var(--r-2) 0; }
.bd-check b { display: block; color: var(--t-hi); font-weight: 500; font-size: var(--fs-sm); }
.bd-check span { display: block; font-size: var(--fs-micro); line-height: 1.6; color: var(--t-faint); margin-top: 3px; }
.bd-check.stop { border-left-color: var(--coral); background: rgba(226,114,91,.08); }
.bd-check.stop b { color: var(--coral); }
.bd-check.flag { border-left-color: var(--sun); background: rgba(240,180,41,.06); }
.bd-check.note { border-left-color: var(--sea); }

.bd-who { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3); }
.bd-who b { display: block; color: var(--t-hi); font-weight: 500; }
.bd-who span { display: block; font-size: var(--fs-sm); line-height: 1.55; color: var(--t-dim); margin-top: 4px; }
.bd-who em { display: block; font-style: normal; font-size: var(--fs-micro); line-height: 1.6;
  color: var(--heath); margin-top: var(--sp-2); padding-top: var(--sp-2); border-top: 1px solid var(--edge); }

.bd-nums { display: flex; gap: var(--sp-4); flex-wrap: wrap; margin: var(--sp-3) 0; }
.bd-num { display: flex; flex-direction: column; }
.bd-num b { font: 400 var(--fs-base)/1.1 var(--f-num); color: var(--t); font-variant-numeric: tabular-nums; }
.bd-num i { font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; color: var(--t-faint);
  font-style: normal; margin-top: 2px; }

.bd-open { border: 1px solid var(--sea-deep); background: rgba(63,182,196,.08); border-radius: var(--r-2);
  padding: var(--sp-3); margin-top: var(--sp-3); }
.bd-open b { display: block; color: var(--sea); font-size: var(--fs-sm); }
.bd-open span { display: block; font-size: var(--fs-sm); color: var(--t-dim); margin-top: 3px; }
.bd-open .btn { margin-top: var(--sp-3); }
.bd-act { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-3); }
.bd-go { background: var(--sea); border-color: var(--sea); color: var(--t-on-accent); }
.bd-go:hover:not([disabled]) { background: #55c8d5; border-color: #55c8d5; color: var(--t-on-accent); }

.bd-marker { position: fixed; z-index: 39; transform: translate(-50%, -100%); pointer-events: none;
  display: flex; flex-direction: column; align-items: center; }
.bd-marker.hide { display: none; }
.bd-marker i { display: block; width: 13px; height: 13px; border: 2px solid var(--sea); border-radius: 50%;
  background: rgba(63,182,196,.22); box-shadow: 0 0 0 1px rgba(6,9,11,.7), 0 0 14px rgba(63,182,196,.5);
  order: 2; margin-top: 3px; }
.bd-marker b { order: 0; font: 600 var(--fs-micro)/1.5 var(--f-ui); letter-spacing: .06em; color: var(--t-hi);
  background: var(--s-2); border: 1px solid var(--edge-strong); border-radius: var(--r-1); padding: 2px 7px;
  white-space: nowrap; box-shadow: var(--shadow-1); }
.bd-marker u { order: 1; text-decoration: none; font: 400 9px/1.6 var(--f-num); letter-spacing: .1em;
  text-transform: uppercase; color: var(--sea); }

@media (max-width: 1200px) {
  .bd-cols { grid-template-columns: 1fr; overflow-y: auto; }
  .bd-pane { border-right: none; border-bottom: 1px solid var(--edge); }
}
`;
  document.head.appendChild(s);
}
