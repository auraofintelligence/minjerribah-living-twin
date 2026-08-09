// The map. A real one: the island drawn from its own heightfield, with the roads that exist, the
// three townships, the ferry crossing, where the camera is actually looking, and whatever the
// active info view has to say, live.
//
// Minjerribah is 39 km from Point Lookout to Jumpinpin and about 11 km across, so the map is tall
// and narrow, because the island is. It docks bottom right at a size you can read at a glance and
// opens full screen when you want to read it properly.
//
// How it is drawn:
//
//   * The relief is baked once from island.sampleGrid into an offscreen canvas: land cover for the
//     hue, a hillshade off the height gradient for the form, and a depth ramp for the bay and the
//     ocean. It is the same island the terrain layer draws, from the same array.
//   * The active info view is composited straight from the render layer's own texture buffer, so
//     the map and the world are never showing two different versions of the same data.
//   * Everything else is vector: the roads from data/geography.json, the crossing from the two
//     published terminals, the info view's markers, and the camera's ground footprint, which is
//     four picking rays put through the heightfield rather than a guess from the field of view.
//
// Click anywhere to fly there. The panel never mutates simulation state: it emits camera:goto and
// lets the camera rig decide.

import { registerPanel, el } from '../mount.js';
import { infoView, roadLines, placeMap, terminals } from '../../render/layers/infoview.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Land cover on a map is not land cover in a render: it wants to be quiet, so the data drawn over
   it is the loud thing. These are the terrain layer's families, desaturated and darkened. */
const COVER_MAP = {
  water: [16, 40, 54], beach: [214, 200, 168], foredune: [186, 168, 124],
  heath: [96, 110, 68], forest: [46, 68, 42], swamp: [62, 56, 36],
  lake: [42, 106, 118], rock: [104, 96, 88], saltmarsh: [116, 120, 84],
  mangrove: [40, 66, 52], cleared: [128, 126, 96], urban: [140, 84, 66],
  rehab: [88, 112, 66]
};

const ROAD_STYLE = {
  sealed_road: ['#6fd0dc', 1.7],
  street: ['#9fd07a', 1.0],
  unsealed_road: ['#c8bc9c', 1.0],
  track_4wd: ['#c98a3a', 0.9],
  beach_route: ['#f0b429', 1.2],
  beach_access_track: ['#c9a03a', 0.7],
  walking_track: ['#8d9aa4', 0.6]
};

const TONE = {
  sea: '#3fb6c4', sun: '#f0b429', coral: '#e2725b',
  leaf: '#8fbf5a', heath: '#b48ac4', iron: '#8c99a3', sand: '#e8dcc4'
};

export function registerMapPanel(world) {
  registerPanel({
    id: 'map',
    order: 40,
    mount(root, w) {
      if (!w.island || !w.island.bounds) return null;
      injectCss();
      const iv = infoView(w);

      // The frame the map covers: the island, plus a margin so the beach and the banks are not
      // hard against the edge.
      const b = w.island.bounds;
      const pad = 1200;
      const box = { x0: b.minX - pad, x1: b.maxX + pad, z0: b.minZ - pad, z1: b.maxZ + pad };
      const aspect = (box.x1 - box.x0) / (box.z1 - box.z0);

      const base = bakeBase(w, 460);

      /* -------------------------------------------------------------- the docked panel */

      const panel = el('div', { class: 'panel floating map-panel', id: 'map-panel' });
      const head = el('div', { class: 'panel-head map-head' });
      const title = el('div', { class: 'panel-title' }, 'Minjerribah');
      const btnFull = el('button', {
        class: 'btn ghost icon', title: 'Full screen map  (Shift + M)', 'aria-label': 'Open the full screen map'
      }, iconExpand());
      const btnHide = el('button', {
        class: 'btn ghost icon', title: 'Hide the map  (M)', 'aria-label': 'Hide the map'
      }, '−');
      head.append(title, btnFull, btnHide);

      const wrap = el('div', { class: 'map-wrap' });
      const cv = el('canvas', { class: 'map-cv' });
      const tip = el('div', { class: 'map-tip' });
      wrap.append(cv, tip);
      const foot = el('div', { class: 'map-foot' },
        el('span', { class: 'map-scale' }, el('i'), el('u', {}, '')),
        el('span', { class: 'map-view' }, ''));
      panel.append(head, wrap, foot);
      root.appendChild(panel);

      const showBtn = el('button', {
        class: 'btn map-show', title: 'Show the map  (M)', 'aria-label': 'Show the map'
      }, iconMap(), 'Map');
      showBtn.style.display = 'none';
      root.appendChild(showBtn);

      /* -------------------------------------------------------------- the full screen map */

      const full = el('div', { class: 'map-full', 'aria-hidden': 'true' });
      const fullCv = el('canvas', { class: 'map-full-cv' });
      const fullBar = el('div', { class: 'map-full-bar' },
        el('div', { class: 'map-full-title' }, 'Minjerribah'),
        el('div', { class: 'map-full-sub' }, 'North Stradbroke Island, Quandamooka Country'),
        el('div', { class: 'map-full-spacer' }),
        el('div', { class: 'map-full-legend' }));
      const fullTip = el('div', { class: 'map-tip' });
      const fullClose = el('button', { class: 'btn map-full-close' }, 'Close  (Esc)');
      full.append(fullCv, fullBar, fullTip, fullClose);
      root.appendChild(full);

      /* -------------------------------------------------------------- state */

      let visible = true;
      let expanded = false;
      let hover = null;               // {x, z, px, py} in world and canvas space
      let fieldCanvas = null;
      let fieldKey = '';
      const frustum = [];

      function setVisible(v) {
        visible = v;
        panel.style.display = v ? '' : 'none';
        showBtn.style.display = v ? 'none' : '';
      }
      function setExpanded(v) {
        expanded = v;
        full.classList.toggle('on', v);
        full.setAttribute('aria-hidden', v ? 'false' : 'true');
        if (v) sizeFull();
      }

      /* -------------------------------------------------------------- sizing */

      function sizeDocked() {
        const h = clamp(Math.round(window.innerHeight * 0.46), 220, 430);
        const wpx = Math.round(h * aspect);
        cv.style.width = wpx + 'px';
        cv.style.height = h + 'px';
        const dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
        cv.width = Math.round(wpx * dpr);
        cv.height = Math.round(h * dpr);
        cv._dpr = dpr;
      }
      function sizeFull() {
        const availH = window.innerHeight - 140;
        const availW = window.innerWidth - 120;
        const h = Math.min(availH, availW / aspect);
        const wpx = h * aspect;
        fullCv.style.width = Math.round(wpx) + 'px';
        fullCv.style.height = Math.round(h) + 'px';
        const dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
        fullCv.width = Math.round(wpx * dpr);
        fullCv.height = Math.round(h * dpr);
        fullCv._dpr = dpr;
      }
      sizeDocked();
      window.addEventListener('resize', () => { sizeDocked(); if (expanded) sizeFull(); });

      /* -------------------------------------------------------------- projection */

      const toPx = (canvas, x, z) => ({
        px: ((x - box.x0) / (box.x1 - box.x0)) * canvas.width,
        // World +z is north and canvas +y is down, so north has to end up at the top.
        py: ((box.z1 - z) / (box.z1 - box.z0)) * canvas.height
      });
      const toWorld = (canvas, px, py) => ({
        x: box.x0 + (px / canvas.width) * (box.x1 - box.x0),
        z: box.z1 - (py / canvas.height) * (box.z1 - box.z0)
      });

      /* -------------------------------------------------------------- pointer */

      function bindPointer(canvas, tipEl) {
        canvas.addEventListener('pointermove', (e) => {
          const r = canvas.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * canvas.width;
          const py = ((e.clientY - r.top) / r.height) * canvas.height;
          const p = toWorld(canvas, px, py);
          hover = { x: p.x, z: p.z, canvas };
          showTip(tipEl, e.clientX - r.left, e.clientY - r.top, p, r);
        });
        canvas.addEventListener('pointerleave', () => { hover = null; tipEl.classList.remove('show'); });
        canvas.addEventListener('click', (e) => {
          const r = canvas.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * canvas.width;
          const py = ((e.clientY - r.top) / r.height) * canvas.height;
          const p = toWorld(canvas, px, py);
          w.bus.emit('camera:goto', { x: p.x, z: p.z, dist: e.shiftKey ? 420 : 2100, dur: 1.1 });
          if (expanded) setExpanded(false);
        });
      }

      function showTip(tipEl, cx, cy, p, r) {
        const isl = w.island;
        const inside = isl.height(p.x, p.z) > isl.seaLevel;
        const region = isl.regionAt(p.x, p.z);
        const cover = isl.landCover(p.x, p.z);
        const h = isl.height(p.x, p.z) - isl.seaLevel;
        const s = iv.sample(p.x, p.z);
        const view = iv.active();
        const lines = [
          `<h5>${region}</h5>`,
          `<div class="map-tip-r">${inside ? cover : 'water'} · ${h > 0 ? h.toFixed(0) + ' m' : (-h).toFixed(1) + ' m deep'}</div>`
        ];
        if (view && s) {
          lines.push(`<div class="map-tip-v"><i style="background:${s.colour}"></i>${view.short}</div>`);
        }
        lines.push('<div class="why">Click to fly. Shift and click to arrive close.</div>');
        tipEl.innerHTML = lines.join('');
        tipEl.style.left = clamp(cx + 14, 6, r.width - 220) + 'px';
        tipEl.style.top = clamp(cy + 14, 6, r.height - 90) + 'px';
        tipEl.classList.add('show');
      }
      bindPointer(cv, tip);
      bindPointer(fullCv, fullTip);

      /* -------------------------------------------------------------- the camera footprint */

      function readFrustum() {
        frustum.length = 0;
        const stage = w.stage;
        if (!stage || !stage.scene) return;
        const cam = stage.scene.activeCamera;
        if (!cam) return;
        const eng = stage.engine;
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        const corners = [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]];
        for (const [u, v] of corners) {
          let ray = null;
          try { ray = stage.scene.createPickingRay(u * W, v * H, null, cam); } catch (e) { return; }
          if (!ray) return;
          const hit = w.island.raycast(ray.origin, ray.direction, 42000);
          if (hit) { frustum.push([hit.x, hit.z]); continue; }
          // Looking past the island, or at the sky. Run the ray to the water and cap how far it
          // may travel: an uncapped corner lands sixty kilometres out and the footprint stops
          // being a quadrilateral you can read and becomes two lines across the map.
          const d = ray.direction;
          const CAP = 16000;
          let t = CAP;
          if (d.y < -1e-4) t = Math.min(CAP, (w.island.seaLevel - ray.origin.y) / d.y);
          frustum.push([ray.origin.x + d.x * t, ray.origin.z + d.z * t]);
        }
      }

      /* -------------------------------------------------------------- info view compositing */

      function syncField() {
        const f = iv.field();
        const view = iv.activeId();
        if (!f || !view) { fieldCanvas = null; fieldKey = ''; return null; }
        const st = iv._state();
        const key = `${view}:${st.liveIsB}:${st.row}:${w.clock.tick}`;
        if (key === fieldKey && fieldCanvas) return fieldCanvas;
        fieldKey = key;
        if (!fieldCanvas || fieldCanvas.width !== f.nx) {
          fieldCanvas = document.createElement('canvas');
          fieldCanvas.width = f.nx; fieldCanvas.height = f.nz;
        }
        const fx = fieldCanvas.getContext('2d');
        const img = fx.createImageData(f.nx, f.nz);
        // Flip vertically on the way in: the lattice runs south to north, the canvas runs down.
        for (let j = 0; j < f.nz; j++) {
          const src = j * f.nx * 4;
          const dst = (f.nz - 1 - j) * f.nx * 4;
          img.data.set(f.rgba.subarray(src, src + f.nx * 4), dst);
        }
        fx.putImageData(img, 0, 0);
        fieldCanvas._f = f;
        return fieldCanvas;
      }

      /* -------------------------------------------------------------- draw */

      function draw(canvas, big) {
        const g = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const k = W / (big ? 900 : 220);           // one stroke unit, so both maps read the same
        g.clearRect(0, 0, W, H);
        g.imageSmoothingEnabled = true;
        blit(g, base.canvas, base, box, W, H);

        const fc = syncField();
        if (fc) {
          const f = fc._f;
          g.save();
          g.globalAlpha = 0.95;
          g.imageSmoothingEnabled = !/landcover|vegetation/.test(iv.activeId() || '');
          blit(g, fc, { nx: f.nx, nz: f.nz, x0: f.x0, z0: f.z0, cellX: f.cell, cellZ: f.cell }, box, W, H);
          g.restore();
        }

        // Roads. Drawn thin and cool so they read as a network rather than as the subject.
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (const r of roadLines(w)) {
          const st = ROAD_STYLE[r.type];
          if (!st) continue;
          if (!big && st[1] < 0.9) continue;              // the docked map keeps the roads you drive
          g.strokeStyle = st[0];
          g.globalAlpha = r.type === 'walking_track' ? 0.45 : 0.8;
          g.lineWidth = Math.max(0.6, st[1] * k);
          g.beginPath();
          for (let i = 0; i < r.pts.length; i++) {
            const p = toPx(canvas, r.pts[i][0], r.pts[i][1]);
            if (i === 0) g.moveTo(p.px, p.py); else g.lineTo(p.px, p.py);
          }
          g.stroke();
        }
        g.globalAlpha = 1;

        // The crossing. There is no bridge: everything arrives on one of these two lines.
        const junner = terminals(w).find((t) => /Junner/.test(t.name));
        const oneMile = terminals(w).find((t) => /One Mile/.test(t.name));
        const cleveland = terminals(w).find((t) => /Toondah Harbour vehicle/.test(t.name));
        g.save();
        g.setLineDash([5 * k, 4 * k]);
        g.strokeStyle = 'rgba(63,182,196,.66)';
        g.lineWidth = Math.max(0.7, 1.1 * k);
        for (const from of [junner, oneMile]) {
          if (!from || !cleveland) continue;
          const a = toPx(canvas, from.x, from.z);
          const bpt = toPx(canvas, cleveland.x, cleveland.z);
          g.beginPath(); g.moveTo(a.px, a.py); g.lineTo(bpt.px, bpt.py); g.stroke();
        }
        g.restore();
        if (junner) {
          const a = toPx(canvas, junner.x, junner.z);
          g.fillStyle = 'rgba(63,182,196,.9)';
          g.font = `${Math.round(9 * k)}px ui-monospace, monospace`;
          g.textAlign = 'left';
          if (big) g.fillText('to Cleveland, 11.9 km', 6, a.py - 6 * k);
        }

        // The three townships, always. They are how you know where you are.
        const pm = placeMap(w);
        g.textAlign = 'center';
        for (const id of ['point-lookout', 'dunwich', 'amity-point']) {
          const p = pm.get(id);
          if (!p) continue;
          const q = toPx(canvas, p.x, p.z);
          g.fillStyle = 'rgba(242,235,220,.95)';
          g.beginPath(); g.arc(q.px, q.py, 2.1 * k, 0, Math.PI * 2); g.fill();
          g.font = `600 ${Math.round((big ? 11 : 9) * k)}px system-ui, sans-serif`;
          const half = g.measureText(p.name).width / 2;
          const lx = clamp(q.px, half + 3 * k, W - half - 3 * k);
          g.strokeStyle = 'rgba(6,9,11,.85)';
          g.lineWidth = 3 * k;
          g.strokeText(p.name, lx, q.py - 5.5 * k);
          g.fillText(p.name, lx, q.py - 5.5 * k);
        }

        // The active info view's markers.
        const marks = iv.activeId() ? iv.markers() : [];
        const shown = marks.slice().sort((a, c) => (a.rank || 5) - (c.rank || 5)).slice(0, big ? 30 : 14);
        const placed = [];
        for (const m of shown) {
          const q = toPx(canvas, m.x, m.z);
          if (q.px < -20 || q.py < -20 || q.px > W + 20 || q.py > H + 20) continue;
          const tone = TONE[m.tone] || TONE.sea;
          g.beginPath(); g.arc(q.px, q.py, 3 * k, 0, Math.PI * 2);
          g.fillStyle = tone; g.fill();
          g.strokeStyle = 'rgba(6,9,11,.8)'; g.lineWidth = 1.2 * k; g.stroke();
          if (!big) continue;
          let clash = false;
          for (const p of placed) if (Math.abs(p[0] - q.px) < 120 * k && Math.abs(p[1] - q.py) < 13 * k) { clash = true; break; }
          if (clash) continue;
          placed.push([q.px, q.py]);
          g.font = `600 ${Math.round(10 * k)}px system-ui, sans-serif`;
          g.textAlign = 'left';
          const label = m.value ? `${m.label}  ${m.value}` : m.label;
          g.strokeStyle = 'rgba(6,9,11,.86)'; g.lineWidth = 3.2 * k;
          g.strokeText(label, q.px + 6 * k, q.py + 3.4 * k);
          g.fillStyle = '#f2ebdc';
          g.fillText(label, q.px + 6 * k, q.py + 3.4 * k);
          g.textAlign = 'center';
        }

        // Where the camera is looking. Four rays through the heightfield, so on a hill the shape
        // bends the way the ground does.
        if (frustum.length === 4) {
          g.beginPath();
          for (let i = 0; i < 4; i++) {
            // Clamped to the frame. A ray that misses the island lands sixty kilometres away, and
            // an unclamped footprint draws two lines off the edge of a minimap and looks broken.
            const q = toPx(canvas,
              clamp(frustum[i][0], box.x0, box.x1),
              clamp(frustum[i][1], box.z0, box.z1));
            if (i === 0) g.moveTo(q.px, q.py); else g.lineTo(q.px, q.py);
          }
          g.closePath();
          // Filled only while the footprint is small enough to read as a footprint. Zoomed out,
          // the four rays land off the island, the shape clamps to the frame, and a filled
          // quadrilateral over half the map says nothing except that the map is broken.
          let area = 0;
          for (let i2 = 0; i2 < 4; i2++) {
            const a = toPx(canvas, clamp(frustum[i2][0], box.x0, box.x1), clamp(frustum[i2][1], box.z0, box.z1));
            const b2 = toPx(canvas, clamp(frustum[(i2 + 1) % 4][0], box.x0, box.x1), clamp(frustum[(i2 + 1) % 4][1], box.z0, box.z1));
            area += a.px * b2.py - b2.px * a.py;
          }
          area = Math.abs(area) / 2;
          if (area < W * H * 0.32) { g.fillStyle = 'rgba(242,235,220,.11)'; g.fill(); }
          g.strokeStyle = 'rgba(242,235,220,.62)';
          g.lineWidth = Math.max(0.8, 1.1 * k);
          g.stroke();
        }

        if (hover && hover.canvas === canvas) {
          const q = toPx(canvas, hover.x, hover.z);
          g.strokeStyle = 'rgba(63,182,196,.85)';
          g.lineWidth = Math.max(0.7, 1 * k);
          g.beginPath();
          g.moveTo(q.px - 7 * k, q.py); g.lineTo(q.px + 7 * k, q.py);
          g.moveTo(q.px, q.py - 7 * k); g.lineTo(q.px, q.py + 7 * k);
          g.stroke();
        }

        // North. On a map this long and thin it is the one thing that stops it being a shape.
        g.save();
        g.translate(W - 16 * k, 16 * k);
        g.fillStyle = 'rgba(242,235,220,.8)';
        g.beginPath(); g.moveTo(0, -8 * k); g.lineTo(4 * k, 5 * k); g.lineTo(0, 2 * k); g.lineTo(-4 * k, 5 * k); g.closePath(); g.fill();
        g.font = `600 ${Math.round(8 * k)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText('N', 0, 15 * k);
        g.restore();
      }

      /* -------------------------------------------------------------- the scale bar */

      const scaleBar = foot.querySelector('.map-scale i');
      const scaleTxt = foot.querySelector('.map-scale u');
      const viewTxt = foot.querySelector('.map-view');

      function updateScale() {
        const cssW = parseFloat(cv.style.width) || 200;
        const mPerPx = (box.x1 - box.x0) / cssW;
        const targets = [500, 1000, 2000, 5000, 10000];
        let m = targets[0];
        for (const t of targets) { if (t / mPerPx < cssW * 0.42) m = t; }
        scaleBar.style.width = Math.round(m / mPerPx) + 'px';
        scaleTxt.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
      }
      updateScale();

      /* -------------------------------------------------------------- the legend strip */

      const fullLegend = fullBar.querySelector('.map-full-legend');
      function updateFullLegend() {
        const L = iv.legend();
        if (!L) { fullLegend.innerHTML = '<span class="map-none">No info view. Press V.</span>'; return; }
        const swatches = (L.items || []).slice(0, 8)
          .map((it) => `<span class="map-sw"><i style="background:${it.colour}"></i>${it.label}${it.value ? ` <b>${it.value}</b>` : ''}</span>`)
          .join('');
        fullLegend.innerHTML = `<span class="map-lg-name">${L.label}</span>${swatches}`;
      }

      /* -------------------------------------------------------------- controls */

      btnFull.addEventListener('click', () => setExpanded(!expanded));
      btnHide.addEventListener('click', () => setVisible(false));
      showBtn.addEventListener('click', () => setVisible(true));
      fullClose.addEventListener('click', () => setExpanded(false));
      full.addEventListener('click', (e) => { if (e.target === full) setExpanded(false); });

      window.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === 'KeyM') {
          e.preventDefault();
          if (e.shiftKey) { if (!visible) setVisible(true); setExpanded(!expanded); }
          else if (expanded) setExpanded(false);
          else setVisible(!visible);
        } else if (e.code === 'Escape' && expanded) {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(false);
        }
      }, true);

      /* -------------------------------------------------------------- the update loop */

      let frames = 0;
      return {
        update(w2) {
          frames++;
          if (!visible && !expanded) return;
          readFrustum();
          if (visible) draw(cv, false);
          if (expanded) { draw(fullCv, true); updateFullLegend(); }
          const view = iv.active();
          viewTxt.textContent = view ? view.short : '';
          viewTxt.className = 'map-view' + (view ? ' on' : '');
          if (frames % 20 === 0) updateScale();
        }
      };
    }
  });
}

/* ------------------------------------------------------------------ the relief bake */

/**
 * The island, once, into an offscreen canvas: land cover for hue, a hillshade off the height
 * gradient for form, a depth ramp for the water. `res` is samples across the box.
 */
/**
 * The island, once, into an offscreen canvas: island.sampleGrid for the height and the land cover,
 * a hillshade off the height gradient for the form, and a depth ramp for the water. The grid
 * covers the whole sampled domain, so the canvas does too and the map crops it, which is the same
 * thing the info view lattice needs and lets one blit serve both.
 *
 * @param res samples across the domain's x axis
 */
function bakeBase(world, res) {
  const G = world.island.sampleGrid(res);
  const cvs = document.createElement('canvas');
  cvs.width = G.nx; cvs.height = G.nz;
  const g = cvs.getContext('2d');
  const img = g.createImageData(G.nx, G.nz);
  const sea = G.seaLevel;
  const cover = [];
  for (let i = 0; i < G.covers.length; i++) cover[i] = COVER_MAP[G.covers[i]] || [80, 84, 76];

  // The sun for the hillshade sits in the north west, which is the cartographic convention and is
  // not where the sun is over Queensland. A map is not a photograph: relief lit the other way
  // reads inside out for most people, so the convention wins.
  const lx = -0.6, lz = 0.6, ly = 0.53;

  for (let j = 0; j < G.nz; j++) {
    // The grid runs south to north and the canvas runs down, so the rows are written in reverse.
    const row = (G.nz - 1 - j) * G.nx;
    const jm = Math.max(0, j - 1) * G.nx, jp = Math.min(G.nz - 1, j + 1) * G.nx;
    for (let i = 0; i < G.nx; i++) {
      const k = j * G.nx + i;
      const h = G.height[k];
      const o = (row + i) * 4;
      img.data[o + 3] = 255;
      if (h <= sea) {
        const d = clamp((sea - h) / 26, 0, 1);
        img.data[o] = 22 - 14 * d; img.data[o + 1] = 52 - 30 * d; img.data[o + 2] = 68 - 34 * d;
        continue;
      }
      const c = cover[G.cover[k]];
      const im = Math.max(0, i - 1), ip = Math.min(G.nx - 1, i + 1);
      const hx = (G.height[j * G.nx + ip] - G.height[j * G.nx + im]) / ((ip - im) * G.cellX);
      const hz = (G.height[jp + i] - G.height[jm + i]) / (((jp - jm) / G.nx) * G.cellZ);
      const inv = 1 / Math.sqrt(hx * hx + hz * hz + 1);
      const lam = clamp((-hx * lx + -hz * lz + ly) * inv, 0, 1);
      const shade = 0.68 + 0.92 * lam;
      img.data[o] = clamp(c[0] * shade, 0, 255);
      img.data[o + 1] = clamp(c[1] * shade, 0, 255);
      img.data[o + 2] = clamp(c[2] * shade, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: cvs, nx: G.nx, nz: G.nz, x0: G.x0, z0: G.z0, cellX: G.cellX, cellZ: G.cellZ };
}

/**
 * Draw a domain-wide image into the map frame. The frame and the image do not have to line up, so
 * the source rectangle is clipped to the image and the destination is clipped by the same
 * fraction: handing drawImage a source rectangle that runs off the image loses the whole draw.
 * Both images are stored top row north, so the row for box.z1 counts from the top.
 */
function blit(g, img, meta, box, W, H) {
  let sx = (box.x0 - meta.x0) / meta.cellX;
  let sw = (box.x1 - box.x0) / meta.cellX;
  let sy = meta.nz - 1 - (box.z1 - meta.z0) / meta.cellZ;
  let sh = (box.z1 - box.z0) / meta.cellZ;
  let dx = 0, dy = 0, dw = W, dh = H;
  const kx = W / sw, ky = H / sh;
  if (sx < 0) { dx = -sx * kx; dw += sx * kx; sw += sx; sx = 0; }
  if (sy < 0) { dy = -sy * ky; dh += sy * ky; sh += sy; sy = 0; }
  if (sx + sw > meta.nx) { const over = sx + sw - meta.nx; sw -= over; dw -= over * kx; }
  if (sy + sh > meta.nz) { const over = sy + sh - meta.nz; sh -= over; dh -= over * ky; }
  if (sw > 1 && sh > 1) g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/* ------------------------------------------------------------------ chrome */

function iconExpand() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '13'); s.setAttribute('height', '13');
  s.innerHTML = '<path d="M2 6V2h4M14 10v4h-4M14 6V2h-4M2 10v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  return s;
}
function iconMap() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '13'); s.setAttribute('height', '13');
  s.innerHTML = '<path d="M1.6 3.6 5.6 2l4.8 2 4-1.6v10L10.4 14 5.6 12 1.6 13.6zM5.6 2v10M10.4 4v10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
  return s;
}

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'map-panel-css';
  s.textContent = `
.map-panel { position:absolute; right:var(--sp-4); bottom:var(--sp-4); z-index:12; }
.map-head { padding:var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3); gap:2px; }
.map-head .panel-title { font-size:var(--fs-micro); }
.map-wrap { position:relative; }
.map-cv { display:block; cursor:crosshair; background:#06111a; }
.map-foot { display:flex; align-items:center; gap:var(--sp-2); padding:5px var(--sp-3) 6px;
  border-top:1px solid var(--edge); }
.map-scale { display:flex; align-items:center; gap:5px; }
.map-scale i { display:block; height:3px; border-left:1px solid var(--t-dim); border-right:1px solid var(--t-dim);
  border-bottom:1px solid var(--t-dim); min-width:18px; }
.map-scale u { text-decoration:none; font:400 var(--fs-micro)/1 var(--f-num); color:var(--t-faint); }
.map-view { margin-left:auto; font:600 var(--fs-micro)/1 var(--f-ui); letter-spacing:.1em;
  text-transform:uppercase; color:var(--t-faint); }
.map-view.on { color:var(--sea); }
.map-show { position:absolute; right:var(--sp-4); bottom:var(--sp-4); z-index:12; }

.map-tip { position:absolute; z-index:3; pointer-events:none; max-width:230px;
  background:var(--s-2); border:1px solid var(--edge-strong); border-radius:var(--r-2);
  box-shadow:var(--shadow-2); padding:var(--sp-2) var(--sp-3); font-size:var(--fs-sm);
  color:var(--t); opacity:0; transform:translateY(3px); transition:opacity var(--fast), transform var(--fast); }
.map-tip.show { opacity:1; transform:none; }
.map-tip h5 { font-size:var(--fs-base); color:var(--t-hi); margin-bottom:1px; }
.map-tip-r { font:400 var(--fs-micro)/1.5 var(--f-num); color:var(--t-dim); }
.map-tip-v { display:flex; align-items:center; gap:5px; margin-top:3px; font-size:var(--fs-micro);
  letter-spacing:.08em; text-transform:uppercase; color:var(--t-dim); }
.map-tip-v i { width:9px; height:9px; border-radius:2px; display:block; }
.map-tip .why { color:var(--t-faint); font-size:var(--fs-micro); margin-top:var(--sp-2);
  padding-top:var(--sp-2); border-top:1px solid var(--edge); }

.map-full { position:fixed; inset:0; z-index:40; display:none; place-items:center;
  background:rgba(6,9,11,.86); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  animation:fade-in var(--med) var(--ease) both; }
.map-full.on { display:grid; }
.map-full-cv { display:block; cursor:crosshair; border:1px solid var(--edge-strong);
  border-radius:var(--r-2); box-shadow:var(--shadow-3); background:#06111a; }
.map-full-bar { position:absolute; top:0; left:0; right:0; display:flex; align-items:baseline;
  gap:var(--sp-4); padding:var(--sp-4) var(--sp-5); }
.map-full-title { font:300 var(--fs-xl)/1 var(--f-ui); letter-spacing:.22em; color:var(--sand); }
.map-full-sub { font-size:var(--fs-sm); color:var(--t-faint); }
.map-full-spacer { flex:1; }
.map-full-legend { display:flex; flex-wrap:wrap; gap:var(--sp-3); justify-content:flex-end;
  max-width:56%; font-size:var(--fs-sm); color:var(--t-dim); }
.map-lg-name { font:600 var(--fs-label)/1 var(--f-ui); letter-spacing:.14em; text-transform:uppercase; color:var(--sea); }
.map-sw { display:inline-flex; align-items:center; gap:5px; }
.map-sw i { width:10px; height:10px; border-radius:2px; display:block; }
.map-sw b { font:400 var(--fs-micro)/1 var(--f-num); color:var(--t); }
.map-none { color:var(--t-faint); }
.map-full-close { position:absolute; bottom:var(--sp-5); left:50%; transform:translateX(-50%); }

@media (max-width: 900px) {
  .map-panel { display:none; }
}
`;
  document.head.appendChild(s);
}
