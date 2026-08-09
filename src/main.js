// Boot. Loads data packs, assembles systems from the manifest, starts the render loop.
// Everything a system needs reaches it through `world`; everything the renderer needs
// reaches it through `stage`. Nothing else is global except the TWIN debug handle.

import { World } from './kernel/world.js';
import { Stage } from './render/stage.js';
import { loadDataPacks } from './world/data.js';
import { MANIFEST } from './systems/manifest.js';
import { mountUI } from './ui/mount.js';

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
  const world = new World({ seed, startISO: params.get('start') || '2026-09-19T05:20' });
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
  const missing = [];
  const modules = await Promise.all(wanted.map((m) => m().catch((e) => {
    missing.push(String(m).match(/['"](.+?)['"]/)?.[1] || 'unknown');
    return null;
  })));
  if (missing.length) console.info('[manifest] not built yet (' + missing.length + '):', missing.join(', '));
  for (const mod of modules) {
    if (!mod) continue;
    const fns = Object.values(mod).filter((v) => typeof v === 'function' && /^register/.test(v.name));
    for (const fn of fns) {
      try { fn(world); } catch (e) { console.error('[manifest] register failed', fn.name, e); }
    }
  }

  await step('waking the residents');
  await world.boot();

  await step('opening the doors');
  if (!headless) mountUI(world);

  await step('ready');

  // Debug/critic handle. Deliberately rich: an inspecting agent must be able to
  // interrogate the running world rather than read a builder's report.
  window.TWIN = {
    world, stage,
    probe: () => world.probe(),
    run: (n) => { world.run(n); return world.probe(); },
    speed: (i) => world.clock.setSpeed(i),
    save: () => world.save(),
    load: (s) => world.load(s),
    events: (t, n) => world.bus.recent(t, n),
    errors: () => world.errors,
    missing,
    /** Jump to a time of day and render one frame. For screenshot comparisons. */
    // Three frames, not one. The sky layer eases the sun light rather than snapping it, so one
    // frame after a jump the lighting still belongs to the hour you left.
    setTime: (h, m = 0) => {
      world.clock.minuteOfDay = h * 60 + m;
      world.step();
      if (stage) for (let i = 0; i < 3; i++) { world.frame(0.016); stage.render(0.016); }
      return world.clock.format();
    },
    /** Force a weather state, so a critic can check the wet look without waiting for rain. */
    setWeather: (synoptic) => { const w = world.read('weather'); if (w) { w.synoptic = synoptic; } return w; },

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
      const heldSpeed = world.clock.speedIndex;
      world.clock.setSpeed(0);
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
      world.clock.setSpeed(heldSpeed);
      const res = await fetch('/__shot/' + encodeURIComponent(name), { method: 'POST', body: data });
      return res.json();
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
  world.bus.emit('app:ready', {});
}

main().catch((e) => {
  console.error('[boot] fatal', e);
  const s = document.getElementById('boot-status');
  if (s) { s.textContent = 'boot failed: ' + (e && e.message); s.style.color = '#e2725b'; }
});
