// Boot. Loads data packs, assembles systems from the manifest, starts the render loop.
// Everything a system needs reaches it through `world`; everything the renderer needs
// reaches it through `stage`. Nothing else is global except the TWIN debug handle.

import { World } from './kernel/world.js';
import { Stage } from './render/stage.js';
import { loadDataPacks } from './world/data.js';
import { MANIFEST, PLANNED } from './systems/manifest.js';
import { mountUI } from './ui/mount.js';
import { makeTimeControl, liveStartISO, DEFAULT_START_ISO } from './kernel/clock.js';

/**
 * What kind of time this island opens in.
 *
 * THE DEFAULT IS LIVE, and it changed on 14 August 2026 on the owner's instruction: open on live
 * time and speed, with the tide, the timetable and what is on today, the way a noticeboard would.
 * A twin of a real island that opens on a date in the future is a demonstration; one that opens on
 * the real Queensland moment is a thing you can use, and everything on
 * `src/ui/panels/today.js` is arranged around that being true.
 *
 * Live does not cost determinism and this is the sentence worth reading twice: live is an anchor,
 * not a feed. The real datetime it started from is stamped into the clock's record and into the
 * save, so a live session replays exactly. See the header of src/kernel/clock.js.
 *
 * Four inputs, in this order, because an address bar is an explicit instruction, a setting somebody
 * chose is a preference, and a setting nobody chose is neither:
 *
 *   ?clock=live        open at the real Queensland moment and keep pace with it
 *   ?start=<ISO>       a specific island moment, in island time, e.g. 2026-12-27T16:00
 *   ?clock=simulated   the old default: a seeded run from DEFAULT_START_ISO. This is the escape
 *                      hatch, and it is what a critic uses to reproduce the deterministic baseline
 *                      in a browser.
 *   the setting        src/ui/panels/settings.js writes { clock: { mode, startISO, chosen } } into
 *                      the localStorage key it owns, and this reads it. The two ends of that
 *                      contract are named in each other's comments and nowhere else keeps a copy.
 *                      `chosen` matters: that panel writes its whole object back on any change, so
 *                      a stored `clock.mode` exists the moment somebody drags the interface scale,
 *                      and honouring that would let a preference nobody expressed quietly override
 *                      the default. Only the two controls in Settings that are actually about time
 *                      set it, so an older stored blob with no `chosen` field reads as not chosen
 *                      and lands on live, which is the honest answer.
 *   nothing            live.
 *
 * THE HEADLESS HARNESS IS UNTOUCHED BY ALL OF IT, and that is the trap this note exists for.
 * `tools/headless.mjs` constructs `new World({ seed })` directly: it never loads this module, has
 * no query string, no localStorage and no clock boot at all, so it still opens at
 * DEFAULT_START_ISO, simulated, and `node tools/headless.mjs --determinism` produces the same
 * fingerprint it did before this changed. Anything that would make that untrue belongs in the
 * World constructor and not here.
 */
const CLOCK_SETTINGS_KEY = 'twin.settings';
function resolveClockBoot(params) {
  let stored = null;
  try {
    const raw = localStorage.getItem(CLOCK_SETTINGS_KEY);
    if (raw) stored = (JSON.parse(raw) || {}).clock || null;
  } catch (e) { /* private browsing, or a setting written by an older build */ }

  const asked = (params.get('clock') || '').toLowerCase();
  const askedStart = params.get('start');
  const chose = !!(stored && stored.chosen);

  if (asked === 'live') {
    return { mode: 'live', startISO: liveStartISO(), why: 'the address bar asked for live' };
  }
  if (askedStart) {
    return { mode: 'simulated', startISO: askedStart, why: 'the address bar named a moment' };
  }
  if (asked === 'simulated') {
    return { mode: 'simulated', startISO: DEFAULT_START_ISO, why: 'the address bar asked for a simulation' };
  }
  if (chose && stored.mode === 'simulated') {
    return {
      mode: 'simulated',
      startISO: stored.startISO || DEFAULT_START_ISO,
      why: 'the last choice made in Settings was a simulated island'
    };
  }
  if (chose && stored.mode === 'live') {
    return { mode: 'live', startISO: liveStartISO(), why: 'the last choice made in Settings was live' };
  }
  return {
    mode: 'live',
    startISO: liveStartISO(),
    why: 'nobody asked for anything else, and this island opens at the real Queensland moment'
  };
}

const bootStatus = document.getElementById('boot-status');
const bootFill = document.getElementById('boot-bar-fill');
let bootStep = 0;
const BOOT_STEPS = 7;
function step(msg) {
  bootStep++;
  if (bootStatus) bootStatus.textContent = msg;
  if (bootFill) bootFill.style.width = Math.round((bootStep / BOOT_STEPS) * 100) + '%';
  // setTimeout, not rAF: a backgrounded or hidden tab never fires rAF and boot would hang.
  return new Promise((r) => setTimeout(r, 0));
}

async function main() {
  const params = new URLSearchParams(location.search);
  const seed = params.has('seed') ? Number(params.get('seed')) : 19770614;
  const headless = params.get('headless') === '1';

  await step('reading the island');
  const data = await loadDataPacks();

  await step('setting the clock');
  const clockBoot = resolveClockBoot(params);
  const world = new World({ seed, startISO: clockBoot.startISO });
  if (clockBoot.mode === 'live') {
    // Stamp the anchor now, before a single system has run, so the real datetime this island
    // started from is in the record rather than in somebody's memory of when they opened the tab.
    world.clock.goLive();
  }
  world.clock.note('opened ' + clockBoot.mode + ' at ' + world.clock.formatISO() + ': ' + clockBoot.why);
  // The time control belongs to the clock, not to a panel: a panel must not decide what a system
  // is allowed to recompute. Attached like world.settings and world.camera, read by the HUD.
  world.time = makeTimeControl(world);
  world.data = data;
  if (params.get('flags')) for (const f of params.get('flags').split(',')) world.flags.add(f.trim());

  await step('lighting the sky');
  const stage = headless ? null : new Stage(document.getElementById('stage'), world);
  if (stage) await stage.init();
  world.stage = stage;

  await step('assembling systems');
  // ?only=terrain,ocean loads just those modules, so a critic can judge one slice in isolation
  // without another agent's half-written system throwing in the same console.
  // Anything a slice cannot sensibly be judged without. A critic asked for ?only=terrain and got
  // a console line saying there was no island to draw, then judged a terrain layer that had no
  // sun because the daylight system was not in the list: the land was lit from the same angle at
  // dawn and at noon. A filter that silently removes the ground under the thing you asked for is
  // a trap, so the ground now always comes with it.
  const ALWAYS = ['island', 'daylight', 'weather', 'tide'];
  const only = params.get('only')
    ? params.get('only').split(',').map((s) => s.trim()).filter(Boolean).concat(ALWAYS)
    : null;
  if (only) console.info('[manifest] ?only resolved to:', Array.from(new Set(only)).join(', '));
  const wanted = only
    ? MANIFEST.filter((m) => only.some((o) => String(m).includes('/' + o + '.js')))
    : MANIFEST;
  // A module in MANIFEST that fails to import is a real fault and says so. Modules that have been
  // designed but not written live in PLANNED and are reported, not requested: asking the server for
  // a file nobody has written yet only fills the console with 404s that read like breakage.
  const missing = PLANNED.map((p) => p.path);
  const broke = [];
  const modules = await Promise.all(wanted.map((m) => m().catch((e) => {
    const path = String(m).match(/['"](.+?)['"]/)?.[1] || 'unknown';
    broke.push(path);
    console.error('[manifest] failed to load', path, e);
    return null;
  })));
  if (missing.length) console.info('[manifest] designed, not built yet (' + missing.length + '):', missing.join(', '));
  if (broke.length) missing.push(...broke);
  for (const mod of modules) {
    if (!mod) continue;
    const fns = Object.values(mod).filter((v) => typeof v === 'function' && /^register/.test(v.name));
    for (const fn of fns) {
      try { fn(world); } catch (e) { console.error('[manifest] register failed', fn.name, e); }
    }
  }

  await step('waking the residents');
  await world.boot();

  // Let the island live before anybody looks at it.
  //
  // THE BUG THIS FIXES, and it was the reason the owner had never seen a car, a bus, a ferry or a
  // person on his own island. At tick zero every one of those counts is zero, because a resident is
  // not placed until the schedule system decides where they are going and a vehicle does not exist
  // until somebody sets off. The render layers were correct: they drew nothing because there was
  // nothing. Measured at tick 0 against tick 300: people on island 0 -> 2,069, outdoors 0 -> 593,
  // vehicles on the road 0 -> 43, buses 0 -> 3, boats afloat 0 -> 3.
  //
  // So a world that opens is a world that has already been somewhere. This matters more since the
  // default became live: opening at the real Queensland moment means the island is supposed to have
  // BEEN there, with the four o'clock barge already loaded and the school run already done.
  //
  // Two sim-days, run backwards from the opening moment so the moment you land on is the one you
  // asked for. Costs about a second and a half of boot on this machine and buys an island that is
  // alive in the first frame instead of the ninetieth.
  //
  // Determinism is untouched: this is the same deterministic step() the headless harness runs, from
  // the same seed. tools/headless.mjs does its own running and never calls this file, so the
  // fingerprint is unaffected.
  const WARMUP_TICKS = 216; // a day and a half: enough to populate, about 3 s on a slow machine
  if (!headless) {
    await step('living a couple of days');
    const startMinute = world.clock.minuteOfDay;
    const startDay = world.clock.dayIndex;
    world.clock.minuteOfDay = startMinute;
    world.clock.dayIndex = startDay - 2;  // run in from before the opening moment
    const t0 = performance.now();
    // In slices, so the boot bar can paint and a slow machine does not look hung.
    for (let done = 0; done < WARMUP_TICKS; done += 48) {
      world.run(Math.min(48, WARMUP_TICKS - done));
      await new Promise((r) => setTimeout(r, 0));
    }
    world.clock.warmupMs = Math.round(performance.now() - t0);
    console.info(`[boot] warmed ${WARMUP_TICKS} ticks in ${world.clock.warmupMs} ms: `
      + `${world.read('crowd')?.onIsland ?? '?'} people on the island, `
      + `${world.read('traffic')?.counts?.onRoad ?? '?'} vehicles moving.`);
  }

  await step('opening the doors');
  if (!headless) mountUI(world);

  await step('ready');

  // Debug/critic handle. Deliberately rich: an inspecting agent must be able to
  // interrogate the running world rather than read a builder's report.
  window.TWIN = {
    world, stage,
    // The clock's own record travels with every probe, so a critic never has to wonder whether a
    // number they are reading belongs to the real island or to a simulation of a moment that has
    // not happened. `world.probe()` itself is untouched, so the headless fingerprint is untouched.
    // `reconcile()` first, on purpose. If something has moved the moment without going through
    // world.time, the honest answer to "what state is this world in" is the declared one, and a
    // probe that reported the undeclared state would be the one place in the build where a
    // direct write still looked like nothing had happened. `world.probe()` itself is untouched,
    // so the headless fingerprint is untouched.
    probe: () => { world.time.reconcile(); const p = world.probe(); p.clock = world.clock.describe(); return p; },
    run: (n) => { world.run(n); return world.probe(); },
    speed: (i) => world.clock.setSpeed(i),
    save: () => world.save(),
    load: (s) => world.load(s),
    events: (t, n) => world.bus.recent(t, n),
    errors: () => world.errors,
    missing,

    /**
     * Time, from the console. `TWIN.clock.status()` says which of the three modes the island is
     * in and where it is looking; the rest do what their names say. `scrubResidue()` is the one
     * worth running once: it parks the clock somewhere else, comes back, and proves the derived
     * systems are exactly as they were, which is the whole claim scrubbing rests on.
     */
    get clock() {
      return {
        describe: () => { world.time.reconcile(); return world.clock.describe(); },
        record: () => world.clock.record.slice(),
        status: () => world.time.status(),
        live: () => world.time.goLive(),
        simulated: () => world.time.goSimulated('asked for from the console'),
        scrub: (minutes) => world.time.scrubBy(minutes),
        scrubTo: (minutes) => world.time.scrubTo(minutes),
        present: () => world.time.toPresent(),
        catchUp: () => world.time.catchUp(),
        scrubResidue: (m) => world.time.scrubResidue(m),
        /**
         * Did anything move the moment without coming through `world.time`? Nought is the only
         * healthy answer. Any other number names a defect in whatever wrote to the clock: the
         * moment was already declared and put on the record when it happened, so this is the
         * count, not the alarm.
         */
        offRecord: () => world.clock.offRecordMoves
      };
    },

    /**
     * Jump to a time of day and render. For screenshot comparisons.
     *
     * Setting the time of day is moving the moment, so it goes through `world.time` like every
     * other mover in this build. It lands as a declared scrub: the bar says PROJECTION or LOOKING
     * BACK, and `TWIN.clock.present()` is the way back. It used to write `clock.minuteOfDay`
     * straight in and then call `world.step()`, which meant taking a screenshot at midday quietly
     * advanced the island through a tick, and left the mode chip saying whatever it had said
     * before. Only the sun, the moon and the tide follow, which is all a time-of-day shot needs
     * and all this build can honestly recompute.
     *
     * Three frames, not one. The sky layer eases the sun light rather than snapping it, so one
     * frame after a jump the lighting still belongs to the hour you left.
     */
    /**
     * Validated, for the same reason `setWeather` below it is.
     *
     * `TWIN.setTime('14:00')` is the obvious thing to try and it used to poison the clock for the
     * rest of the session: `'14:00' * 60` is NaN, the scrub landed on NaN, `DAYS[NaN]` is undefined,
     * and from then on every `TWIN.probe()` threw inside `islandDateText` while the bus filled with
     * "any-handler failed for tide:day" once a tick. `TWIN.errors()` reported nothing the whole
     * time, because nothing had thrown inside a system's own tick. A critic hit exactly that and had
     * to reload to get a probe back. Hours and minutes now have to be numbers that are hours and
     * minutes, and anything else says so and leaves the clock where it was.
     */
    setTime: (h, m = 0) => {
      const hh = typeof h === 'number' ? h : Number(h);
      const mm = typeof m === 'number' ? m : Number(m);
      if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 24 || mm < 0 || mm >= 60) {
        console.warn('[TWIN] setTime(hour, minute) takes numbers: hour 0 to 24, minute 0 to 59. '
          + `Got ${JSON.stringify(h)}, ${JSON.stringify(m)}. The clock has not moved.`);
        return world.clock.format();
      }
      world.time.scrubToMinuteOfDay(hh * 60 + mm);
      if (stage) for (let i = 0; i < 3; i++) { world.frame(0.016); stage.render(0.016); }
      return world.clock.format();
    },
    /** Force a weather state, so a critic can check the wet look without waiting for rain. */
    /**
     * Force a synoptic pattern. Validated, because it used to write whatever it was given straight
     * into the read model: a name the weather system does not know (`TWIN.setWeather('clear')` is
     * the obvious thing to try) threw at the next synoptic change, and World.step then disabled the
     * weather system for the rest of the session with nothing on screen to say so.
     */
    setWeather: (synoptic) => {
      const w = world.read('weather');
      if (!w) return null;
      const known = w.synoptics || [];
      if (!known.includes(synoptic)) {
        console.warn('[TWIN] setWeather: no such pattern "' + synoptic + '". Try one of: ' + known.join(', '));
        return w;
      }
      if (typeof w.force === 'function') w.force(synoptic);
      else w.synoptic = synoptic;
      return w;
    },

    /**
     * Render offscreen and write a PNG to shots/<name>.png on disk, so a critic can open the file
     * and look at it. Works even when the browser pane is not compositing frames.
     */
    async shot(name = 'shot', width = 1600, height = 900) {
      if (!stage) return { error: 'headless' };
      const c = stage.canvas;
      const prev = { w: c.width, h: c.height, sw: c.style.width, sh: c.style.height };
      // Freeze the clock for the duration. The shot is awaited, and at any speed above zero the
      // render loop keeps pumping ticks while the PNG is being encoded and posted, so the frame
      // that lands on disk is not the time of day you asked for. A critic hit exactly that and
      // spent four screenshots looking at night frames labelled midday.
      // `freeze` rather than `setSpeed(0)`: choosing a speed is how you leave live, and taking a
      // photograph of a live island must not be the thing that stops it being one.
      world.clock.freeze();
      // Size the drawing buffer explicitly. Babylon's CreateScreenshotAsync waits for a composited
      // frame, which never arrives when the pane is hidden, so render manually and read the buffer.
      c.style.width = width + 'px';
      c.style.height = height + 'px';
      stage.engine.setSize(width, height);
      // Sixty passes at a twentieth of a second, not two at a sixtieth. Resizing the drawing
      // buffer reallocates every post-process render target, including the one the auto exposure
      // carries its adapted value in, so after a resize the image starts from an unadapted
      // exposure and takes a couple of seconds of frames to come back. Two frames of that landed
      // a sheet of pure white on disk every time the shot was taken at midday. Three seconds of
      // simulated frame time is longer than the slowest adaptation in the chain.
      // Drive the exposure meter during the warm-up. The postfx layer keeps its luminance read
      // entirely on the GPU because a per-frame pixel readback stalls this device, which means the
      // adapted exposure sits at zero unless something asks for it. Nothing asked during a shot, so
      // every screenshot came out as a pale wash and three critics judged an island that was not
      // the island anyone would see while playing.
      for (let i = 0; i < 60; i++) {
        world.frame(0.05);
        stage.render(0.05);
        if (i % 6 === 0 && window.TWIN && window.TWIN.postfx && window.TWIN.postfx.meter) {
          try { window.TWIN.postfx.meter(); } catch (e) { /* meter is a convenience, never fatal */ }
        }
      }
      const data = c.toDataURL('image/png');
      c.style.width = prev.sw; c.style.height = prev.sh;
      stage.engine.setSize(prev.w, prev.h);
      stage.render(0.016);
      world.clock.thaw();
      // The sink is tools/serve.js, which only exists when someone is developing locally. On a static
      // host such as GitHub Pages there is nothing listening, so hand the caller the image rather than
      // throwing: a critic on a local server still gets a file on disk, and anyone opening the
      // published build still gets a screenshot they can save. Nothing about the island depends on it.
      try {
        const res = await fetch('__shot/' + encodeURIComponent(name), { method: 'POST', body: data });
        if (res.ok) return res.json();
      } catch (e) { /* no sink here: fall through to the data URL */ }
      return { ok: false, sink: 'none', hint: 'no local shot sink, so the PNG is returned instead of written', dataUrl: data };
    },

    /** Render a contact sheet of the same view across a day. One call, six files. */
    async dayStrip(prefix = 'day', hours = [5, 7, 12, 17, 19, 22]) {
      const out = [];
      for (const h of hours) {
        this.setTime(h, 0);
        out.push(await this.shot(`${prefix}-${String(h).padStart(2, '0')}00`));
      }
      return out;
    },

    /**
     * Measure real render cost without relying on the compositor. Runs n manual renders and
     * reports the frame time distribution, so "60 fps" is a measurement rather than a claim.
     */
    bench(n = 120) {
      if (!stage) return { error: 'headless' };
      const times = [];
      // Babylon's engine._drawCalls is a lifetime accumulator: nothing resets it unless a
      // SceneInstrumentation with captureDrawCalls is attached, and there is none here. Reading
      // .current straight out reported every draw call since the page loaded, which is how a
      // scene with five active meshes came out at 7735 draw calls. Difference it across the
      // bench window and divide by the frames actually rendered.
      const counter = stage.engine._drawCalls;
      const drawBefore = counter ? counter.current : null;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        world.frame(1 / 60);
        stage.render(1 / 60);
        times.push(performance.now() - t0);
      }
      const drawPerFrame = counter ? Math.round((counter.current - drawBefore) / n) : null;
      times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
      return {
        frames: n,
        meanMs: +mean.toFixed(2),
        medianMs: +pct(0.5).toFixed(2),
        p95Ms: +pct(0.95).toFixed(2),
        worstMs: +times[times.length - 1].toFixed(2),
        estimatedFps: +(1000 / mean).toFixed(1),
        estimated1PercentLow: +(1000 / pct(0.99)).toFixed(1),
        drawCalls: drawPerFrame,
        drawCallsLifetime: counter ? counter.current : null,
        activeMeshes: stage.scene.getActiveMeshes().length,
        totalVertices: stage.scene.getTotalVertices()
      };
    },
    /**
     * What is between the pointer and the island.
     *
     * This exists because the same failure has now cost three rounds of guessing, and it is
     * invisible by construction: an element with opacity 0 or a transparent background, sitting
     * over the canvas with pointer-events auto, swallows every click while looking like nothing at
     * all. The island appears frozen, the interface appears dead, and only the keyboard still
     * works, because key handlers are on document and never meet the shield.
     *
     * Call it with no arguments to test the centre of the screen, or with a point.
     * It names every element the pointer would hit before the canvas, and says which one is the
     * culprit. Run it in your own browser and paste the answer: it is quicker than any description.
     */
    whatIsBlocking(x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2)) {
      const stack = document.elementsFromPoint(x, y);
      const canvasAt = stack.findIndex((e) => e.id === 'stage');
      const rows = stack.slice(0, canvasAt < 0 ? 8 : canvasAt).map((e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        const coverage = (r.width * r.height) / (innerWidth * innerHeight);
        return {
          el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
              (e.className ? '.' + String(e.className).trim().split(/\s+/).join('.') : ''),
          pointerEvents: cs.pointerEvents,
          zIndex: cs.zIndex,
          opacity: cs.opacity,
          visibility: cs.visibility,
          coversScreenPct: Math.round(coverage * 100),
          // The signature of the bug: big, on top, takes clicks, and you cannot see it.
          suspect: coverage > 0.5 && cs.pointerEvents !== 'none' &&
                   (Number(cs.opacity) < 0.05 || cs.visibility === 'hidden')
        };
      });
      const culprit = rows.find((r) => r.suspect) || rows[0] || null;
      return {
        point: { x, y },
        canvasReached: canvasAt >= 0,
        inTheWay: rows,
        culprit: culprit ? culprit.el : null,
        verdict: canvasAt === 0
          ? 'nothing is in the way: the pointer reaches the island directly'
          : canvasAt < 0
            ? 'the island is not under this point at all'
            : rows.some((r) => r.suspect)
              ? 'an invisible element is swallowing clicks: see culprit'
              : 'something is in the way but it is visible, so it is probably meant to be'
      };
    },
    version: '0.1.0'
  };

  const boot = document.getElementById('boot');
  if (boot) { boot.classList.add('gone'); setTimeout(() => boot.remove(), 900); }

  if (!headless && stage) {
    let last = performance.now();
    stage.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const ticks = world.clock.pump(dt);
      for (let i = 0; i < ticks; i++) world.step();
      world.frame(dt);
      stage.render(dt);
      world.telemetry.frame(performance.now() - now);
    });
    addEventListener('resize', () => stage.engine.resize());
  }
  // Watch for click shields rather than waiting for somebody to report a dead interface.
  //
  // An element that covers the screen, sits above the canvas, takes pointer events and cannot be
  // seen is the one failure in this build that gives a user no information at all: the island looks
  // frozen and only the keyboard answers. It has happened three times, from three different files,
  // so it is now checked rather than remembered. Cheap: a handful of elements, twice a second, and
  // it stops the moment it has nothing to say.
  if (!headless) {
    let quiet = 0;
    const watch = setInterval(() => {
      const r = window.TWIN.whatIsBlocking();
      const bad = r.inTheWay.filter((x) => x.suspect);
      if (!bad.length) { if (++quiet > 20) clearInterval(watch); return; }
      quiet = 0;
      console.warn('[shield] an invisible element is swallowing clicks over the island:',
        bad.map((b) => `${b.el} (z ${b.zIndex}, opacity ${b.opacity}, covers ${b.coversScreenPct}%)`).join(', '),
        '\nRun TWIN.whatIsBlocking() for the full stack.');
    }, 500);
  }

  world.bus.emit('app:ready', {});
}

main().catch((e) => {
  console.error('[boot] fatal', e);
  const s = document.getElementById('boot-status');
  if (s) { s.textContent = 'boot failed: ' + (e && e.message); s.style.color = '#e2725b'; }
});
