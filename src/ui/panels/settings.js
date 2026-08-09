// Settings. Six tabs, one instrument, and every control does something you can measure.
//
// The rule this file holds to is the one Oxygen Not Included gets right and most games do not: a
// setting that cannot be verified is a lie with a slider on it. So every control here either
// reaches a system that already accepts it, or says plainly that nothing reads it yet.
//
//   PICTURE   drives the quality tier in src/render/layers/postfx.js through the `quality` intent
//             it already accepts, and the scatter density in src/render/layers/flora.js through
//             `flora:quality`. The Measure button runs the same offscreen bench the critic tooling
//             uses (TWIN.bench) and prints the real numbers against the contract: 60 fps mean and
//             30 fps at the one per cent low. Low is the tier the contract is written about, so it
//             is the one with a stated target on screen.
//
//   SOUND     drives the audio engine's own mix rather than keeping a second copy of it. The engine
//             in src/audio/audio.js owns the buses, the meters and a full mixer of its own on shift
//             and N. This tab is the short version for somebody who came here to turn it down, and
//             it says where the long version is. Two sources of truth for one gain is a bug.
//
//   CAMERA    reaches the rig through the `camera:tune` intent. Pan is deliberately not tunable:
//             dragging holds the ground under the pointer and has to track it exactly.
//
//   INTERFACE is this file's own: scale, motion, and colour vision. The colour vision setting is
//             the one worth reading the code for. It daltonises both halves of the instrument, the
//             info view sheet draped over the island and the palette tokens the panels are built
//             from, so a legend swatch and the ground it describes stay the same colour. It works
//             by wrapping the info view controller rather than editing it, and it puts everything
//             back when switched off.
//
//   SIMULATION default speed and autosave. Autosave runs on a day boundary from the UI loop, never
//             on a tick, because the sim is already at 3.9 ms of a 4 ms budget.
//
//   SAVES     four slots and a file. world.save() and world.load() already work; this is a front
//             end for them that is honest about size, because a snapshot of two thousand residents
//             does not always fit in local storage and finding that out silently is the worst
//             possible time to find it out.
//
// Settings are presentation state. They are kept in localStorage and on `world.settings`, which is
// a plain handle like world.island and world.camera. Nothing here goes into world.state, so nothing
// here can change the determinism fingerprint.

import { registerPanel, el } from '../mount.js';
import { infoView } from '../../render/layers/infoview.js';

/* ------------------------------------------------------------------ shared chrome */

/** The launcher rail. Whichever panel loads first builds it. */
function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  // The rail's own look and position live in src/ui/design.css, once, rather than in a copy
  // inside each of the six panels that can be the first to build it.
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

/* ------------------------------------------------------------------ defaults */

const STORE_KEY = 'twin.settings';
const SLOT_KEY = 'twin.save.';
const SLOTS = ['auto', '1', '2', '3'];

const DEFAULTS = {
  quality: 'auto',              // auto | low | medium | high | ultra
  flora: 1,                     // 0.15 to 2, the scatter density multiplier
  camera: { orbit: 1, look: 1, zoom: 1, invertX: false, invertY: false },
  uiScale: 1,                   // 0.85 to 1.4
  reducedMotion: false,
  colourVision: 'off',          // off | protanopia | deuteranopia | tritanopia
  hints: true,
  startSpeed: 1,                // clock speed index the island opens at
  autosaveDays: 7,              // 0 is off
  lastSaveDay: -1
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}

function load() {
  try { return deepMerge(DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
  catch (e) { return deepMerge(DEFAULTS, {}); }
}
function persist(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private browsing */ }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => Math.round(v * 100) + '%';

function bytes(n) {
  if (!isNum(n)) return '–';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' kB';
  return n + ' B';
}

/* ==================================================================== colour vision

   Daltonisation, not simulation. The point is not to show a person with a colour vision
   deficiency what they cannot see; it is to move the information that would be lost into the
   part of the space they can. Standard chain: sRGB to linear, linear RGB to LMS, collapse the
   missing cone, take the error, redistribute it into the channels that survive, back to sRGB.

   The LMS matrices are the Hunt-Pointer-Estevez pair used by the published daltonisation work,
   and the dichromat collapses are the Viénot, Brettel and Mollon 1999 planes. The redistribution
   matrix is the conventional one: red error into green and blue, and nothing back into red.

   Cost. The info view lattice is roughly three hundred thousand cells and this runs once per
   bake, which is once a sim hour. Doing it per pixel with a matrix multiply would be several
   milliseconds on a frame that already has a stutter to avoid, so it goes through a lazily filled
   lookup table on six bits a channel. Quantising to four levels of 256 is invisible under the
   sheet's own hillshade, and it turns the per pixel cost into one index and one read. */

const LMS = [
  0.31399022, 0.63951294, 0.04649755,
  0.15537241, 0.75789446, 0.08670142,
  0.01775239, 0.10944209, 0.87256922
];
const LMS_INV = [
  5.47221206, -4.6419601, 0.16963708,
  -1.1252419, 2.29317094, -0.1678952,
  0.02980165, -0.19318073, 1.16364789
];
const COLLAPSE = {
  protanopia: [0, 1.05118294, -0.05116099, 0, 1, 0, 0, 0, 1],
  deuteranopia: [1, 0, 0, 0.9513092, 0, 0.04866992, 0, 0, 1],
  tritanopia: [1, 0, 0, 0, 1, 0, -0.86744736, 1.86727089, 0]
};
// Error redistribution. Row per output channel, column per error channel.
const SHIFT = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];

function mul3(m, x, y, z, out) {
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);

const _a = [0, 0, 0], _b = [0, 0, 0], _c = [0, 0, 0];

/** One colour through the whole chain. r, g, b are 0 to 255; the result is written back in place. */
function daltonise(mode, r, g, b, out) {
  const collapse = COLLAPSE[mode];
  if (!collapse) { out[0] = r; out[1] = g; out[2] = b; return out; }
  const lr = srgbToLinear(r / 255), lg = srgbToLinear(g / 255), lb = srgbToLinear(b / 255);
  mul3(LMS, lr, lg, lb, _a);
  mul3(collapse, _a[0], _a[1], _a[2], _b);
  mul3(LMS_INV, _b[0], _b[1], _b[2], _c);
  const er = lr - _c[0], eg = lg - _c[1], eb = lb - _c[2];
  mul3(SHIFT, er, eg, eb, _a);
  out[0] = Math.round(clamp(linearToSrgb(lr + _a[0]), 0, 1) * 255);
  out[1] = Math.round(clamp(linearToSrgb(lg + _a[1]), 0, 1) * 255);
  out[2] = Math.round(clamp(linearToSrgb(lb + _a[2]), 0, 1) * 255);
  return out;
}

/** Six bits a channel, filled on demand. 0 means "not computed yet". */
function makeLut(mode) {
  const table = new Int32Array(262144);
  const out = [0, 0, 0];
  return function lookup(r, g, b) {
    const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let v = table[k];
    if (v === 0) {
      daltonise(mode, (r & 0xfc) | 2, (g & 0xfc) | 2, (b & 0xfc) | 2, out);
      v = table[k] = ((out[0] << 16) | (out[1] << 8) | out[2]) | 0x40000000;
    }
    return v;
  };
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
function shiftHex(mode, hex) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return hex;
  const out = [0, 0, 0];
  daltonise(mode, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), out);
  return '#' + hex2(out[0]) + hex2(out[1]) + hex2(out[2]);
}

/** The design tokens that carry meaning rather than surface. Only these move. */
const PALETTE_TOKENS = {
  '--sea': '#3fb6c4', '--sea-deep': '#1c6c78',
  '--sun': '#f0b429', '--sun-deep': '#a8760d',
  '--coral': '#e2725b',
  '--leaf': '#8fbf5a', '--leaf-deep': '#4e7a2c',
  '--heath': '#b48ac4',
  '--iron': '#8c99a3'
};

/* ==================================================================== the panel */

registerPanel({
  id: 'settings',
  order: 60,
  mount(root, world) { return mountSettings(root, world); }
});

function mountSettings(root, world) {
  injectStyle();

  const S = load();
  world.settings = S;

  /* ---- launcher and board ---------------------------------------------- */

  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'Settings (o)', onclick: () => toggle()
  }, 'Settings');
  rail().append(launcher);

  const scrim = el('div', { class: 'st-scrim', onclick: () => toggle(false) });
  const board = el('section', {
    class: 'panel st-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'Settings'
  });
  root.append(scrim, board);

  const head = el('div', { class: 'st-top' },
    el('div', {},
      el('h2', {}, 'Settings'),
      el('div', { class: 'st-sub' },
        'Everything here either reaches a system that reads it, or says that nothing does yet.')),
    el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

  const TABS = [
    ['picture', 'Picture'],
    ['sound', 'Sound'],
    ['camera', 'Camera'],
    ['interface', 'Interface'],
    ['sim', 'Simulation'],
    ['saves', 'Saves']
  ];
  const tabBar = el('nav', { class: 'tabs' });
  const tabBtns = {};
  let tab = 'picture';
  for (const [id, label] of TABS) {
    const b = el('button', { type: 'button', onclick: () => { tab = id; refresh(); } }, label);
    tabBtns[id] = b;
    tabBar.append(b);
  }
  const main = el('div', { class: 'st-main scroll' });
  board.append(head, tabBar, main);

  let open = false;
  function toggle(force) {
    open = force === undefined ? !open : !!force;
    scrim.classList.toggle('on', open);
    board.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    if (open) { world.bus.emit('ui:drawer', { id: 'settings' }); refresh(); board.focus({ preventScroll: true }); }
  }
  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'settings' && open) toggle(false); });
  world.bus.on('ui:open', (p) => { if (p && p.id === 'settings') { if (p.tab && tabBtns[p.tab]) tab = p.tab; toggle(true); } });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
    else if (e.code === 'KeyO') { toggle(); e.preventDefault(); }
  });

  /* ---- small builders --------------------------------------------------- */

  function group(title, note) {
    const g = el('section', { class: 'st-group' }, el('h3', {}, title));
    if (note) g.append(el('p', { class: 'st-note' }, note));
    return g;
  }
  function row(label, control, why) {
    return el('div', { class: 'st-row' },
      el('div', { class: 'st-lab' }, el('b', {}, label), why ? el('span', {}, why) : null),
      el('div', { class: 'st-ctl' }, control));
  }
  function slider(value, min, max, step, onInput, fmt) {
    const out = el('span', { class: 'st-val' }, (fmt || pct)(value));
    const input = el('input', {
      type: 'range', min, max, step, value,
      oninput: (e) => {
        const v = Number(e.target.value);
        out.textContent = (fmt || pct)(v);
        onInput(v);
      }
    });
    return el('div', { class: 'st-slider' }, input, out);
  }
  function segmented(options, current, onPick) {
    const wrap = el('div', { class: 'btn-row st-seg' });
    for (const [value, label, title] of options) {
      wrap.append(el('button', {
        class: 'btn' + (value === current ? ' on' : ''), type: 'button', title: title || null,
        onclick: () => { onPick(value); refresh(); }
      }, label));
    }
    return wrap;
  }
  function toggleBtn(on, labelOn, labelOff, onPick) {
    return el('button', {
      class: 'btn' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => { onPick(!on); refresh(); }
    }, on ? labelOn : labelOff);
  }

  function save() { persist(S); }

  /* ---- applying settings ------------------------------------------------ */

  function applyQuality() {
    world.bus.emit('ui:intent', { kind: 'quality', tier: S.quality });
  }
  function applyFlora() {
    world.bus.emit('ui:intent', { kind: 'flora:quality', value: S.flora });
  }
  function applyCamera() {
    world.bus.emit('ui:intent', Object.assign({ kind: 'camera:tune' }, S.camera));
  }
  function applyHints() {
    world.bus.emit('ui:hints', { enabled: S.hints });
  }
  /** The audio engine's own handle, when it has attached. Never a second copy of its state. */
  function audioApi() {
    return (window.TWIN && window.TWIN.audio) || null;
  }
  function applyScale() {
    const r = document.documentElement;
    const k = clamp(S.uiScale, 0.85, 1.4);
    const base = { micro: 10, label: 11, sm: 12, base: 13, lg: 15, xl: 19, display: 28 };
    for (const [name, px] of Object.entries(base)) {
      r.style.setProperty('--fs-' + name, (px * k).toFixed(2) + 'px');
    }
    for (let i = 1; i <= 7; i++) {
      const px = [4, 8, 12, 16, 24, 32, 48][i - 1];
      r.style.setProperty('--sp-' + i, Math.round(px * (1 + (k - 1) * 0.6)) + 'px');
    }
  }
  function applyMotion() {
    document.body.classList.toggle('twin-still', !!S.reducedMotion);
  }

  /* ---- colour vision: the info view wrapper ----------------------------- */

  const cvw = { installed: null, orig: null, lut: null, job: null, lastBaking: false, cells: 0, ms: 0, bands: 0 };

  function applyPaletteTokens() {
    const r = document.documentElement;
    for (const [token, hex] of Object.entries(PALETTE_TOKENS)) {
      r.style.setProperty(token, S.colourVision === 'off' ? hex : shiftHex(S.colourVision, hex));
    }
  }

  /**
   * A band of the field, not the whole thing. Recolouring three hundred thousand cells in one go
   * measured at seven milliseconds warm, which is a visible hitch on a sixteen millisecond frame
   * and this build already has a stutter to avoid making worse. So it goes a band at a time across
   * the frames after a bake, the same way the bake itself is spread. The info view layer re-uploads
   * the live buffer on every frame between bakes, so a partially transformed field still reaches
   * the screen and simply finishes arriving over the next few frames.
   */
  const BAND_CELLS = 40000;
  function transformBand(job) {
    if (!cvw.lut || !job || !job.buf) return true;
    const t0 = performance.now();
    const buf = job.buf;
    const end = Math.min(buf.length, job.at + BAND_CELLS * 4);
    for (let i = job.at; i < end; i += 4) {
      if (buf[i + 3] === 0) continue;
      const v = cvw.lut(buf[i], buf[i + 1], buf[i + 2]);
      buf[i] = (v >> 16) & 255;
      buf[i + 1] = (v >> 8) & 255;
      buf[i + 2] = v & 255;
    }
    job.at = end;
    job.ms = (job.ms || 0) + (performance.now() - t0);
    if (job.at >= buf.length) {
      cvw.cells = buf.length >> 2;
      cvw.ms = +job.ms.toFixed(2);
      cvw.bands = Math.ceil((buf.length >> 2) / BAND_CELLS);
      return true;
    }
    return false;
  }

  function installColourVision() {
    const mode = S.colourVision;
    applyPaletteTokens();
    let iv = null;
    try { iv = infoView(world); } catch (e) { iv = null; }
    if (!iv) return;

    if (mode === 'off') {
      if (cvw.orig) {
        iv._pump = cvw.orig.pump;
        iv.legend = cvw.orig.legend;
        cvw.orig = null;
      }
      cvw.installed = null;
      cvw.lut = null;
      cvw.job = null;
      try { iv.refresh(); } catch (e) { /* nothing active is fine */ }
      return;
    }

    cvw.lut = makeLut(mode);
    cvw.installed = mode;
    cvw.job = null;
    if (!cvw.orig) {
      cvw.orig = { pump: iv._pump, legend: iv.legend };
      // The sheet is rebuilt band by band into an offscreen buffer and swapped in when it is
      // complete. Catching the swap is the one moment the whole field is settled and has not yet
      // been uploaded to the texture, so a transform here costs one pass and never a re-upload.
      iv._pump = function wrappedPump(dt) {
        const m = cvw.orig.pump.call(iv, dt);
        const st = iv._state();
        const F = iv.lattice();
        if (cvw.lut && F) {
          // A bake has just finished: queue the buffer it wrote.
          if (cvw.lastBaking && !st.baking && F.buf) cvw.job = { buf: F.buf, at: 0, ms: 0 };
          // A new bake has started over the buffer we were still recolouring: abandon it, because
          // the bake is about to write fresh colour into it and will be queued in its turn.
          if (!cvw.lastBaking && st.baking && cvw.job && cvw.job.buf === F.buf) cvw.job = null;
          if (cvw.job && transformBand(cvw.job)) cvw.job = null;
        }
        cvw.lastBaking = st.baking;
        return m;
      };
      // The legend has to agree with the ground it describes, or the sheet is unreadable in a
      // different way from the one this setting was turned on to fix.
      iv.legend = function wrappedLegend() {
        const L = cvw.orig.legend.call(iv);
        if (!L || !cvw.lut) return L;
        if (Array.isArray(L.items)) {
          for (const it of L.items) if (it && it.colour) it.colour = shiftHex(cvw.installed, it.colour);
        }
        return L;
      };
    }
    try { iv.refresh(); } catch (e) { /* nothing active is fine */ }
  }

  /* ---- the bench -------------------------------------------------------- */

  let benchResult = null;
  let benchBusy = false;

  function runBench(tierForLabel) {
    const TWIN = window.TWIN;
    if (!TWIN || typeof TWIN.bench !== 'function') {
      benchResult = { error: 'TWIN.bench is not available. This build is headless or still booting.' };
      refresh();
      return;
    }
    benchBusy = true;
    refresh();
    // Warm up, then measure. Switching a tier throws away every post-process render target and
    // queues a shader compile, and the first version of this reported a 734 ms worst frame that
    // was the compile rather than the island. Forty frames are rendered and discarded first, which
    // is the same thing a player's first second of play does, and then the real window is taken.
    setTimeout(() => {
      let r = null;
      try {
        TWIN.bench(40);
        r = TWIN.bench(120);
      } catch (e) { r = { error: String(e && e.message || e) }; }
      // A hidden tab is throttled by the browser, so a measurement taken in one is a measurement
      // of the throttle. Say so rather than print a number that means nothing.
      benchResult = r ? Object.assign({ tier: tierForLabel, hidden: document.hidden || false }, r) : null;
      benchBusy = false;
      refresh();
    }, 450);
  }

  /* ---- saves ------------------------------------------------------------ */

  /**
   * The header of a slot, kept in its own key. A populated island snapshot is megabytes and the
   * slot list is drawn every time this tab opens, so parsing four of them to print a date would
   * be a visible pause for nothing.
   */
  function slotMeta(slot) {
    try {
      const raw = localStorage.getItem(SLOT_KEY + slot + '.meta');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function readSlot(slot) {
    try {
      const raw = localStorage.getItem(SLOT_KEY + slot);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return { size: raw.length, meta: o.__meta || null, snapshot: o.snapshot || o };
    } catch (e) { return null; }
  }

  function writeSlot(slot, text, meta) {
    localStorage.setItem(SLOT_KEY + slot, text);
    localStorage.setItem(SLOT_KEY + slot + '.meta', JSON.stringify({ size: text.length, meta }));
  }

  let saveNote = '';
  function say(msg) {
    saveNote = msg;
    refresh();
    setTimeout(() => { if (saveNote === msg) { saveNote = ''; if (open) refresh(); } }, 6000);
  }

  function snapshotBlob() {
    const snapshot = world.save();
    return {
      __meta: {
        version: 1,
        date: world.clock.formatDate(),
        time: world.clock.format(),
        tick: world.clock.tick,
        day: world.clock.dayIndex,
        season: world.clock.season ? world.clock.season.name : '',
        seed: world.seed,
        residents: (world.read('population') || {}).residents || null
      },
      snapshot
    };
  }

  function saveToSlot(slot) {
    let blob = null;
    let text = '';
    try { blob = snapshotBlob(); text = JSON.stringify(blob); }
    catch (e) { say('Could not build a snapshot: ' + e.message); return; }
    try {
      writeSlot(slot, text, blob.__meta);
      S.lastSaveDay = world.clock.dayIndex;
      save();
      say('Saved to slot ' + slot + ', ' + bytes(text.length) + '.');
    } catch (e) {
      // Local storage is about five megabytes across the whole origin and a populated island
      // snapshot is not small. Say so, and point at the file, rather than failing quietly.
      say('Slot ' + slot + ' would not fit in local storage at ' + bytes(text.length)
        + '. Use Save to a file instead. Browsers give a page about five megabytes in total.');
    }
  }

  function loadFromSlot(slot) {
    const r = readSlot(slot);
    if (!r || !r.snapshot) { say('Slot ' + slot + ' is empty.'); return; }
    try {
      world.load(r.snapshot);
      say('Loaded slot ' + slot + '. The island is at ' + (r.meta ? r.meta.date + ', ' + r.meta.time : 'the saved point') + '.');
    } catch (e) { say('That save would not load: ' + e.message); }
  }

  function clearSlot(slot) {
    try {
      localStorage.removeItem(SLOT_KEY + slot);
      localStorage.removeItem(SLOT_KEY + slot + '.meta');
    } catch (e) { /* fine */ }
    say('Slot ' + slot + ' cleared.');
  }

  function saveToFile() {
    let text = '';
    try { text = JSON.stringify(snapshotBlob()); } catch (e) { say('Could not build a snapshot: ' + e.message); return; }
    // A blob URL is made and revoked in this page. Nothing leaves the machine and no network is
    // touched, which is the offline rule in the contract.
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'minjerribah-' + world.clock.dayIndex + '.twin.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    say('Written to a file, ' + bytes(text.length) + '.');
  }

  const fileInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const o = JSON.parse(String(fr.result));
          world.load(o.snapshot || o);
          say('Loaded from ' + f.name + '.');
        } catch (err) { say('That file would not load: ' + err.message); }
      };
      fr.readAsText(f);
      e.target.value = '';
    }
  });
  root.append(fileInput);

  /* ---- autosave ---------------------------------------------------------- */

  let lastDaySeen = world.clock.dayIndex;
  function pumpAutosave() {
    const d = world.clock.dayIndex;
    if (d === lastDaySeen) return;
    lastDaySeen = d;
    if (!S.autosaveDays) return;
    if (S.lastSaveDay >= 0 && d - S.lastSaveDay < S.autosaveDays) return;
    // On a day boundary only, and from the ten hertz UI loop rather than from a tick, so this
    // never lands inside the four millisecond simulation budget.
    saveToSlotQuiet('auto');
  }
  function saveToSlotQuiet(slot) {
    try {
      const blob = snapshotBlob();
      const text = JSON.stringify(blob);
      writeSlot(slot, text, blob.__meta);
      S.lastSaveDay = world.clock.dayIndex;
      save();
      world.bus.emit('ui:autosave', { slot, day: world.clock.dayIndex, bytes: text.length });
    } catch (e) {
      // Turn it off rather than throw every seven days for the rest of the run.
      S.autosaveDays = 0;
      save();
      world.bus.emit('ui:autosave', { slot, failed: true, why: String(e && e.message || e) });
    }
  }

  /* ---- views ------------------------------------------------------------ */

  function refresh() {
    if (!open) return;
    for (const [id] of TABS) tabBtns[id].classList.toggle('on', tab === id);
    main.textContent = '';
    try { VIEWS[tab](); } catch (e) {
      main.append(el('p', { class: 'st-note' }, 'This tab could not be drawn: ' + (e && e.message)));
      console.error('[settings] view failed', tab, e);
    }
    main.scrollTop = 0;
  }

  const VIEWS = {};

  /* --- picture ---------------------------------------------------------- */

  VIEWS.picture = () => {
    const pf = world.read('postfx') || {};
    const g = group('Graphics',
      'The contract this build is written to is sixty frames a second on integrated graphics at '
      + '1080p with the island populated, and under nine hundred draw calls. Low is the tier that '
      + 'promise is about. Measure it rather than believe it.');

    g.append(row('Quality',
      segmented([
        ['auto', 'Auto', 'The image layer picks a tier and moves it if frames get expensive'],
        ['low', 'Low', 'Tone mapping, auto exposure, the grade and FXAA. Nothing with a per pixel gather'],
        ['medium', 'Medium', 'Adds ambient occlusion and the film grain'],
        ['high', 'High', 'Adds depth of field and temporal antialiasing'],
        ['ultra', 'Ultra', 'Adds 2x MSAA and the heaviest occlusion']
      ], S.quality, (v) => { S.quality = v; save(); applyQuality(); benchResult = null; }),
      'Running now: ' + (pf.tierLabel || pf.tier || 'unknown') + (pf.auto ? ', chosen automatically' : ', held')));

    g.append(row('Scatter density',
      slider(S.flora, 0.15, 2, 0.05, (v) => { S.flora = v; save(); applyFlora(); }, (v) => v.toFixed(2) + '×'),
      'Thirty three million stems are indexed. This is how many of them are drawn near you.'));

    const measure = el('div', { class: 'st-bench' });
    measure.append(el('div', { class: 'btn-row' },
      el('button', { class: 'btn', type: 'button', disabled: benchBusy || null, onclick: () => runBench(S.quality) },
        benchBusy ? 'Measuring…' : 'Measure this tier'),
      el('button', {
        class: 'btn ghost', type: 'button', disabled: benchBusy || null,
        onclick: () => { S.quality = 'low'; save(); applyQuality(); runBench('low'); }
      }, 'Set Low and measure it')));

    if (benchResult) {
      if (benchResult.error) {
        measure.append(el('p', { class: 'st-note bad' }, benchResult.error));
      } else if (benchResult.hidden) {
        measure.append(el('p', { class: 'st-note warn' },
          'The page was in a background tab while that ran. Browsers throttle a hidden tab hard, so '
          + 'the numbers would have been about the tab and not about the island. Bring this window to '
          + 'the front and measure again.'));
      } else {
        const b = benchResult;
        const fpsOk = isNum(b.estimatedFps) && b.estimatedFps >= 60;
        const lowOk = isNum(b.estimated1PercentLow) && b.estimated1PercentLow >= 30;
        const drawOk = !isNum(b.drawCalls) || b.drawCalls < 900;
        const t = el('table', { class: 'st-table' });
        const line = (k, v, ok) => t.append(el('tr', {},
          el('th', {}, k),
          el('td', { class: 'n' + (ok === undefined ? '' : ok ? ' good' : ' bad') }, v)));
        line('Tier measured', b.tier);
        line('Mean frame', b.meanMs + ' ms');
        line('Median frame', b.medianMs + ' ms');
        line('95th percentile', b.p95Ms + ' ms');
        line('Worst of 120', b.worstMs + ' ms');
        line('Frames a second', b.estimatedFps, fpsOk);
        line('One per cent low', b.estimated1PercentLow, lowOk);
        line('Draw calls', isNum(b.drawCalls) ? b.drawCalls : '–', drawOk);
        line('Active meshes', b.activeMeshes);
        measure.append(t);
        measure.append(el('p', { class: 'st-note' + (fpsOk && lowOk && drawOk ? ' good' : ' warn') },
          fpsOk && lowOk && drawOk
            ? 'That tier holds the contract on this machine.'
            : 'That tier does not hold the contract on this machine. '
              + (!fpsOk ? 'The mean is under sixty. ' : '')
              + (!lowOk ? 'The one per cent low is under thirty, which is the stutter you can feel. ' : '')
              + (!drawOk ? 'Draw calls are over nine hundred. ' : '')
              + 'Drop a tier, or drop the scatter density.'));
        measure.append(el('p', { class: 'st-note' },
          'Forty frames rendered and thrown away to warm the shaders, then one hundred and twenty '
          + 'measured. Drawn manually rather than read off the compositor, so the figure does not '
          + 'depend on this window being visible. It is the same measurement the critic tooling takes.'));
      }
    } else {
      measure.append(el('p', { class: 'st-note' },
        'Nothing measured yet on this machine at this tier.'));
    }
    g.append(measure);
    main.append(g);

    if (pf.passes) {
      const g2 = group('What is actually switched on', 'Read back from the image layer, not from this list.');
      const chips = el('div', { class: 'st-chips' });
      const on = (k, label) => chips.append(el('span', { class: 'chip ' + (pf.passes[k] ? 'sea' : 'iron') },
        label + (pf.passes[k] ? '' : ' off')));
      on('exposure', 'auto exposure'); on('grade', 'grade'); on('bloom', 'bloom');
      on('ssao', 'occlusion'); on('dof', 'depth of field'); on('taa', 'temporal aa');
      on('fxaa', 'fxaa'); on('film', 'film');
      g2.append(chips);
      if (pf.cost && isNum(pf.cost.drawCalls)) {
        g2.append(el('p', { class: 'st-note' },
          'Last frame: ' + pf.cost.drawCalls + ' draw calls, peak ' + pf.cost.drawCallsPeak
          + '. Render scale ' + (isNum(pf.renderScale) ? pf.renderScale.toFixed(2) : '–') + '.'));
      }
      main.append(g2);
    }
  };

  /* --- sound ------------------------------------------------------------ */

  VIEWS.sound = () => {
    const A = audioApi();
    const st = world.read('audio') || {};
    if (!A) {
      const g0 = group('Mix',
        'The audio engine has not published a handle yet. It attaches once the page is ready, and '
        + 'a browser will not make a sound at all until you have clicked the page once, which is a '
        + 'rule of the platform rather than a setting.');
      main.append(g0);
      return;
    }
    const mixState = st.mix || {};
    const g = group('Mix',
      'These are the audio engine\'s own buses. Nothing here keeps a second copy of a gain.');
    const mix = (key, label, why) => g.append(row(label,
      slider(isNum(mixState[key]) ? mixState[key] : 1, 0, 1, 0.01, (v) => { A.set(key, v); }), why));
    mix('master', 'Master', null);
    mix('ambience', 'Ambience', 'Surf, wind, rain on four different surfaces.');
    mix('wildlife', 'Wildlife', 'Whatever is actually calling where you are standing, at that hour.');
    mix('human', 'People', 'Town, the pub, a mower, the school.');
    mix('ui', 'Interface', 'The clicks and the notifications.');
    mix('music', 'Music', null);
    g.append(row('Sound',
      toggleBtn(!!st.muted, 'Muted', 'Sound on', (v) => { if (v) A.mute(); else { A.start(); A.unmute(); } })));
    main.append(g);

    const g2 = group('The mixer',
      'The full mixer has live levels for every bus, the list of voices that could be calling here '
      + 'right now, and the reason each one is. Shift and N opens it.');
    const t = el('table', { class: 'st-table' });
    const line = (k, v) => t.append(el('tr', {}, el('th', {}, k), el('td', {}, v == null ? '–' : String(v))));
    line('Supported by this browser', st.supported ? 'yes' : 'no');
    line('Started', st.started ? 'yes' : 'no, click the page once');
    line('Context', st.contextState || '–');
    if (st.levels && st.levels.master) line('Master level', st.levels.master.db + ' dB');
    g2.append(t);
    main.append(g2);
  };

  /* --- camera ----------------------------------------------------------- */

  VIEWS.camera = () => {
    const cam = world.read('camera') || {};
    const g = group('Pointer',
      'Panning is not on this list on purpose. A pan holds the ground under the pointer and has to '
      + 'track it exactly, so a sensitivity multiplier there would make the island slide out from '
      + 'under your hand.');
    g.append(row('Orbit sensitivity',
      slider(S.camera.orbit, 0.2, 3, 0.05, (v) => { S.camera.orbit = v; save(); applyCamera(); }, (v) => v.toFixed(2) + '×'),
      'Right drag in the planner, and the arm in follow.'));
    g.append(row('Look sensitivity',
      slider(S.camera.look, 0.2, 3, 0.05, (v) => { S.camera.look = v; save(); applyCamera(); }, (v) => v.toFixed(2) + '×'),
      'On foot and in the drone.'));
    g.append(row('Zoom speed',
      slider(S.camera.zoom, 0.2, 3, 0.05, (v) => { S.camera.zoom = v; save(); applyCamera(); }, (v) => v.toFixed(2) + '×'),
      'The wheel, which is a zoom in the planner and a lens on foot.'));
    g.append(row('Invert horizontal',
      toggleBtn(S.camera.invertX, 'Inverted', 'Normal', (v) => { S.camera.invertX = v; save(); applyCamera(); })));
    g.append(row('Invert vertical',
      toggleBtn(S.camera.invertY, 'Inverted', 'Normal', (v) => { S.camera.invertY = v; save(); applyCamera(); })));
    main.append(g);

    const g2 = group('Now', 'What the rig says it is doing.');
    const t = el('table', { class: 'st-table' });
    const line = (k, v) => t.append(el('tr', {}, el('th', {}, k), el('td', {}, v == null ? '–' : String(v))));
    line('Mode', cam.mode || (world.camera ? world.camera.mode : '–'));
    line('Looking at', (cam.lookingAt && cam.lookingAt.label) || '–');
    if (isNum(cam.altitudeM)) line('Altitude', Math.round(cam.altitudeM) + ' m');
    if (isNum(cam.distanceM)) line('Distance', Math.round(cam.distanceM) + ' m');
    if (isNum(cam.headingDeg)) line('Heading', Math.round(cam.headingDeg) + '°');
    g2.append(t);
    g2.append(el('p', { class: 'st-note' },
      'Tab cycles planner, street, follow, drone and cinematic. F1 to F4 are the townships and the '
      + 'Gorge, and shift with one of them sets it to where you are standing. Home frames the island.'));
    main.append(g2);
  };

  /* --- interface -------------------------------------------------------- */

  VIEWS.interface = () => {
    const g = group('Reading it');
    g.append(row('Interface scale',
      slider(S.uiScale, 0.85, 1.4, 0.05, (v) => { S.uiScale = v; save(); applyScale(); }),
      'Scales the type and the spacing across every panel. The island is not scaled.'));
    g.append(row('Reduced motion',
      toggleBtn(S.reducedMotion, 'Motion reduced', 'Normal motion', (v) => { S.reducedMotion = v; save(); applyMotion(); }),
      'Stops panel transitions and the pulsing attention rings. The camera still moves when you move it.'));
    g.append(row('Hints',
      toggleBtn(S.hints, 'Hints on', 'Hints off', (v) => { S.hints = v; save(); applyHints(); }),
      'Small notes that appear once each, when something on the island is worth explaining.'));
    g.append(el('div', { class: 'btn-row', style: { marginTop: 'var(--sp-3)' } },
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { world.bus.emit('ui:open', { id: 'onboarding', step: 0 }); toggle(false); }
      }, 'Show the arrival again'),
      el('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => { world.bus.emit('ui:hints', { reset: true, enabled: S.hints }); say('Every hint can appear once more.'); }
      }, 'Let the hints run again')));
    if (saveNote) g.append(el('p', { class: 'st-note good' }, saveNote));
    main.append(g);

    const g2 = group('Colour vision',
      'This moves the information that a colour vision deficiency would lose into the part of the '
      + 'space that survives. It changes both halves of the instrument together: the sheet draped '
      + 'over the island and the palette the panels are built from, so a legend swatch and the '
      + 'ground it describes stay the same colour.');
    g2.append(row('Palette',
      segmented([
        ['off', 'Off'],
        ['protanopia', 'Protanopia', 'Red cone absent'],
        ['deuteranopia', 'Deuteranopia', 'Green cone absent'],
        ['tritanopia', 'Tritanopia', 'Blue cone absent']
      ], S.colourVision, (v) => { S.colourVision = v; save(); installColourVision(); })));

    const swatches = el('div', { class: 'st-sw' });
    for (const [token, hex] of Object.entries(PALETTE_TOKENS)) {
      const shown = S.colourVision === 'off' ? hex : shiftHex(S.colourVision, hex);
      swatches.append(el('div', { class: 'st-sw-i' },
        el('i', { style: { background: shown } }),
        el('span', {}, token.replace('--', ''))));
    }
    g2.append(swatches);
    if (S.colourVision !== 'off' && cvw.cells) {
      g2.append(el('p', { class: 'st-note' },
        'The info view sheet is recoloured ' + cvw.cells.toLocaleString('en-AU') + ' cells in '
        + cvw.ms + ' ms, spread across ' + cvw.bands + ' frames so no single one of them wears it, '
        + 'once each time the sheet rebuilds. It goes through a lookup table rather than a matrix '
        + 'multiply per cell, which is the difference between about seven milliseconds and about one.'));
    }
    g2.append(el('p', { class: 'st-note' },
      'Colour is never the only channel in this interface. Every meter carries a number, every chip '
      + 'carries a word, and every legend is labelled. This setting is for the ground, where the '
      + 'colour is the reading.'));
    main.append(g2);
  };

  /* --- simulation ------------------------------------------------------- */

  VIEWS.sim = () => {
    const g = group('Time');
    g.append(row('Speed the island opens at',
      segmented([[0, 'Paused'], [1, '1×'], [2, '3×'], [3, '12×'], [4, '60×']],
        S.startSpeed, (v) => { S.startSpeed = v; save(); }),
      'One tick is ten minutes of island time. A day is a hundred and forty four of them. The '
      + 'simulation is identical at every speed.'));
    g.append(el('p', { class: 'st-note' },
      'Running at ' + (world.clock.speed ? world.clock.speed.label : '–') + ' now. This setting only '
      + 'decides where the clock starts next time.'));
    main.append(g);

    const g2 = group('Autosave',
      'Runs on a change of day from the interface loop, never inside a tick. The simulation is at '
      + 'about 3.9 milliseconds of a 4 millisecond tick budget and a snapshot does not belong in it.');
    g2.append(row('Autosave every',
      segmented([[0, 'Off'], [1, 'day'], [7, 'week'], [30, 'month'], [91, 'season']],
        S.autosaveDays, (v) => { S.autosaveDays = v; save(); }),
      'Island days, not real ones.'));
    const auto = slotMeta('auto');
    g2.append(el('p', { class: 'st-note' }, auto && auto.meta
      ? 'Last autosave: ' + auto.meta.date + ', ' + auto.meta.time + ', ' + bytes(auto.size) + '.'
      : 'Nothing autosaved yet.'));
    main.append(g2);
  };

  /* --- saves ------------------------------------------------------------ */

  VIEWS.saves = () => {
    const g = group('Slots',
      'A save is every system\'s own save() plus the clock, the random pool and the store. Loading '
      + 'one puts the island back exactly where it was, because every system has to answer for its '
      + 'own state and none of them is allowed to keep any outside it.');
    for (const slot of SLOTS) {
      const m = slotMeta(slot);
      const label = slot === 'auto' ? 'Autosave' : 'Slot ' + slot;
      const desc = m && m.meta
        ? m.meta.date + ', ' + m.meta.time + '  ·  ' + (m.meta.season || '') + '  ·  ' + bytes(m.size)
        : 'empty';
      g.append(el('div', { class: 'st-slot' },
        el('div', { class: 'st-slot-id' }, el('b', {}, label), el('span', {}, desc)),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn', type: 'button', onclick: () => saveToSlot(slot) }, 'Save'),
          el('button', { class: 'btn', type: 'button', disabled: m ? null : true, onclick: () => loadFromSlot(slot) }, 'Load'),
          el('button', { class: 'btn ghost danger', type: 'button', disabled: m ? null : true, onclick: () => clearSlot(slot) }, 'Clear'))));
    }
    if (saveNote) g.append(el('p', { class: 'st-note good' }, saveNote));
    main.append(g);

    const g2 = group('A file',
      'Written and read entirely in this page. Nothing about this build touches a network at '
      + 'runtime, and a save is no exception.');
    g2.append(el('div', { class: 'btn-row' },
      el('button', { class: 'btn', type: 'button', onclick: saveToFile }, 'Save to a file'),
      el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Load from a file')));
    main.append(g2);

    const g3 = group('This island');
    const t = el('table', { class: 'st-table' });
    const line = (k, v) => t.append(el('tr', {}, el('th', {}, k), el('td', {}, v == null ? '–' : String(v))));
    line('Seed', world.seed);
    line('Date', world.clock.formatDate() + ', ' + world.clock.format());
    line('Ticks run', world.clock.tick);
    line('Days', world.clock.dayIndex);
    line('Systems', world.systems.length);
    line('Errors', world.errors.length);
    g3.append(t);
    g3.append(el('p', { class: 'st-note' },
      'Same seed and same inputs is the same island. Change the seed in the address bar with '
      + '?seed= and everything downstream of it changes with it.'));
    main.append(g3);
  };

  /* ---- first apply ------------------------------------------------------ */

  applyScale();
  applyMotion();
  applyHints();
  applyQuality();
  applyFlora();
  applyCamera();
  applyPaletteTokens();
  // The info view controller is built by whichever panel or layer asks for it first. Wrapping it
  // at mount would build it early and bake a lattice nobody asked to see, so a non-default palette
  // waits for the first frame instead.
  if (S.colourVision !== 'off') setTimeout(installColourVision, 1200);
  if (S.startSpeed !== 1 && world.clock.tick < 4) world.clock.setSpeed(S.startSpeed);

  let ticks = 0;
  return {
    update() {
      pumpAutosave();
      // The picture tab reads live numbers out of the image layer. Everything else is static
      // until something is clicked, so it is redrawn once a second rather than ten times.
      if (open && tab === 'picture' && (++ticks % 10) === 0 && !benchBusy) refresh();
    }
  };
}

/* ------------------------------------------------------------------ style */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'st-style';
  s.textContent = `
.st-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.st-scrim.on { opacity: 1; pointer-events: auto; }
.st-board { position: fixed; inset: 6vh 50% 6vh auto; width: min(760px, 94vw); z-index: 41;
  display: flex; flex-direction: column; transform: translateX(50%) translateY(14px); opacity: 0;
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.st-board.on { opacity: 1; transform: translateX(50%); pointer-events: auto; }
@media (max-width: 860px) { .st-board { inset: 0; width: auto; border-radius: 0; transform: none; }
  .st-board.on { transform: none; } }

.st-top { display: flex; align-items: flex-start; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.st-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.st-sub { font-size: var(--fs-sm); color: var(--t-faint); max-width: 62ch; line-height: 1.45; }
.st-top > button { margin-left: auto; }
.st-main { flex: 1; min-height: 0; padding: var(--sp-4); }

.st-group { margin-bottom: var(--sp-6); }
.st-group:last-child { margin-bottom: 0; }
.st-group h3 { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; margin-bottom: var(--sp-2); }
.st-note { font-size: var(--fs-sm); line-height: 1.6; color: var(--t-faint); max-width: 74ch;
  margin-bottom: var(--sp-3); }
.st-note.good { color: var(--leaf); } .st-note.warn { color: var(--sun); } .st-note.bad { color: var(--coral); }

.st-row { display: grid; grid-template-columns: 1fr 260px; gap: var(--sp-4); align-items: center;
  padding: var(--sp-3) 0; border-bottom: 1px solid rgba(232,220,196,.06); }
.st-row:last-child { border-bottom: none; }
.st-lab b { display: block; color: var(--t-hi); font-weight: 500; font-size: var(--fs-base); }
.st-lab span { display: block; font-size: var(--fs-sm); color: var(--t-faint); line-height: 1.5; margin-top: 2px; }
.st-ctl { display: flex; justify-content: flex-end; }
.st-seg { justify-content: flex-end; }
.st-seg .btn { padding: var(--sp-2); font-size: var(--fs-micro); letter-spacing: .06em; }

.st-slider { display: flex; align-items: center; gap: var(--sp-3); width: 100%; }
.st-slider input[type=range] { flex: 1; appearance: none; height: 4px; border-radius: var(--r-pill);
  background: var(--s-sunk); outline: none; cursor: pointer; }
.st-slider input[type=range]::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px;
  border-radius: 50%; background: var(--sea); border: 2px solid var(--s-1); cursor: pointer; }
.st-slider input[type=range]::-moz-range-thumb { width: 11px; height: 11px; border-radius: 50%;
  background: var(--sea); border: 2px solid var(--s-1); cursor: pointer; }
.st-slider input[type=range]:focus-visible { box-shadow: var(--glow-sea); }
.st-val { flex: none; min-width: 46px; text-align: right; font: 400 var(--fs-sm)/1 var(--f-num);
  color: var(--t); font-variant-numeric: tabular-nums; }

.st-bench { margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--edge); }
.st-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin: var(--sp-3) 0; }
.st-table th { text-align: left; font-weight: 500; color: var(--t-dim); padding: 4px 8px 4px 0;
  border-bottom: 1px solid rgba(232,220,196,.06); }
.st-table td { padding: 4px 0; text-align: right; color: var(--t-hi);
  border-bottom: 1px solid rgba(232,220,196,.06); }
.st-table td.n { font-family: var(--f-num); font-variant-numeric: tabular-nums; }
.st-table td.good { color: var(--leaf); } .st-table td.bad { color: var(--coral); }

.st-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: var(--sp-3); }
.st-sw { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin: var(--sp-3) 0; }
.st-sw-i { display: flex; align-items: center; gap: 6px; font-size: var(--fs-micro); color: var(--t-faint); }
.st-sw-i i { width: 22px; height: 12px; border-radius: var(--r-1); display: block; }

.st-slot { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-3) 0;
  border-bottom: 1px solid rgba(232,220,196,.06); }
.st-slot:last-of-type { border-bottom: none; }
.st-slot-id { flex: 1; min-width: 0; }
.st-slot-id b { display: block; color: var(--t-hi); font-weight: 500; }
.st-slot-id span { font: 400 var(--fs-sm)/1.5 var(--f-num); color: var(--t-faint); }

/* Reduced motion, chosen rather than declared by the operating system. */
body.twin-still *, body.twin-still *::before, body.twin-still *::after {
  animation-duration: .01ms !important; animation-iteration-count: 1 !important;
  transition-duration: .01ms !important; scroll-behavior: auto !important;
}
`;
  document.head.appendChild(s);
}
