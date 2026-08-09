// The info view switcher, and the legend that goes with whichever one is on.
//
// Two rules shaped this panel:
//
//   1. It must never cover the thing you are looking at. So it lives in the bottom left corner, it
//      is narrow, the picker closes the moment you choose, and the whole thing fades back while
//      you are dragging the camera. The middle of the screen is the island's.
//   2. A legend is not decoration. Every view here carries its units, its numbers, one plain
//      sentence about why it matters on this island, and a line saying where the field came from,
//      including when the answer is that this layer modelled it rather than read it.
//
// Keyboard: V opens the picker, Alt and a letter jumps straight to a view, square brackets step
// through them, Alt and V clears. Inside the picker, type to filter, arrows and Enter to choose.
//
// The panel never writes simulation state. It calls the info view controller, which lives with the
// render layer, and the controller announces itself on the bus as infoview:set.

import { registerPanel, el } from '../mount.js';
import { infoView, INFO_GROUPS } from '../../render/layers/infoview.js';

export function registerInfoViewsPanel(world) {
  registerPanel({
    id: 'infoviews',
    order: 30,
    mount(root, w) {
      injectCss();
      const iv = infoView(w);
      const all = iv.all();

      /* -------------------------------------------------------------- the dock */

      const dock = el('div', { class: 'iv-dock' });

      const launch = el('button', {
        class: 'btn iv-launch', 'aria-haspopup': 'true', 'aria-expanded': 'false',
        title: 'Info views  (V)'
      }, iconLayers(), el('span', { class: 'iv-launch-t' }, 'Info views'), el('kbd', {}, 'V'));

      const card = el('div', { class: 'iv-card', 'aria-live': 'polite' });
      const cardHead = el('div', { class: 'iv-card-head' },
        el('span', { class: 'iv-card-group' }, ''),
        el('span', { class: 'iv-card-name' }, ''),
        el('button', { class: 'btn ghost icon iv-card-min', title: 'Collapse the legend' }, '−'),
        el('button', { class: 'btn ghost icon iv-card-x', title: 'Turn the info view off  (Alt + V)' }, '×'));
      const cardBody = el('div', { class: 'iv-card-body scroll' });
      card.append(cardHead, cardBody);

      dock.append(card, launch);
      root.appendChild(dock);

      /* -------------------------------------------------------------- the picker */

      const pick = el('div', { class: 'iv-pick', role: 'dialog', 'aria-label': 'Choose an info view' });
      const search = el('input', {
        class: 'iv-search', type: 'text', placeholder: 'Search the island: koala, tide, rent, signal…',
        'aria-label': 'Search info views', spellcheck: 'false', autocomplete: 'off'
      });
      const searchWrap = el('div', { class: 'iv-search-wrap' }, iconSearch(), search);
      const listEl = el('div', { class: 'iv-list scroll' });
      const hint = el('div', { class: 'iv-hint' },
        el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' move'),
        el('span', {}, el('kbd', {}, '⏎'), ' choose'),
        el('span', {}, el('kbd', {}, 'Alt'), ' + letter'),
        el('span', {}, el('kbd', {}, '['), el('kbd', {}, ']'), ' step'),
        el('span', {}, el('kbd', {}, 'Esc'), ' close'));
      pick.append(searchWrap, listEl, hint);
      dock.appendChild(pick);

      /* -------------------------------------------------------------- state */

      let open = false;
      let query = '';
      let cursor = 0;
      let filtered = [];
      let collapsed = false;
      let dimmed = false;

      // Searched against the words a person would actually type, not only the ones on the label.
      // Somebody looking for the mobile coverage view types "signal" or "reception".
      function matches(v, q) {
        if (!q) return true;
        const hay = `${v.label} ${v.short} ${v.group} ${v.explain} ${v.find || ''}`.toLowerCase();
        return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
      }

      function buildList() {
        filtered = all.filter((v) => matches(v, query));
        listEl.innerHTML = '';
        if (!filtered.length) {
          listEl.append(el('div', { class: 'iv-empty' }, 'Nothing here matches that. Try ',
            el('em', {}, 'sand'), ', ', el('em', {}, 'rent'), ' or ', el('em', {}, 'whale'), '.'));
          return;
        }
        let n = 0;
        for (const grp of INFO_GROUPS) {
          const inGroup = filtered.filter((v) => v.group === grp.id);
          if (!inGroup.length) continue;
          listEl.append(el('div', { class: 'iv-grp' },
            el('i', { style: { background: grp.tone } }), grp.label));
          for (const v of inGroup) {
            const idx = n++;
            const ok = iv.available(v);
            const row = el('button', {
              class: 'iv-row' + (v.id === iv.activeId() ? ' on' : '') + (ok ? '' : ' off'),
              'data-i': filtered.indexOf(v), type: 'button',
              onclick: () => choose(v.id)
            },
              el('span', { class: 'iv-row-main' },
                el('span', { class: 'iv-row-name' }, v.label),
                el('span', { class: 'iv-row-why' }, v.explain)),
              el('kbd', { class: 'iv-row-key' }, v.key));
            row.addEventListener('pointerenter', () => { cursor = filtered.indexOf(v); paintCursor(); });
            listEl.append(row);
          }
        }
        paintCursor();
      }

      function paintCursor() {
        const rows = listEl.querySelectorAll('.iv-row');
        rows.forEach((r) => {
          const on = Number(r.dataset.i) === cursor;
          r.classList.toggle('cursor', on);
          if (on) r.scrollIntoView({ block: 'nearest' });
        });
      }

      function setOpen(v) {
        open = v;
        pick.classList.toggle('on', v);
        launch.setAttribute('aria-expanded', v ? 'true' : 'false');
        launch.classList.toggle('on', v);
        if (v) {
          query = ''; search.value = ''; cursor = 0;
          buildList();
          search.focus();
        } else {
          search.blur();
        }
      }

      function choose(id) {
        iv.set(id === iv.activeId() ? null : id);
        setOpen(false);
        render();
      }

      /* -------------------------------------------------------------- the legend */

      function render() {
        const L = iv.legend();
        card.classList.toggle('on', !!L);
        card.classList.toggle('folded', collapsed);
        launch.querySelector('.iv-launch-t').textContent = L ? L.label : 'Info views';
        launch.classList.toggle('active', !!L);
        if (!L) { cardBody.innerHTML = ''; return; }

        const grp = INFO_GROUPS.find((g) => g.id === L.group);
        cardHead.querySelector('.iv-card-group').textContent = grp ? grp.label : '';
        cardHead.querySelector('.iv-card-group').style.color = grp ? grp.tone : '';
        cardHead.querySelector('.iv-card-name').textContent = L.label;
        if (collapsed) { cardBody.innerHTML = ''; return; }

        const parts = [];
        parts.push(`<p class="iv-why">${esc(L.explain)}</p>`);
        if (L.unit) parts.push(`<div class="iv-unit">${esc(L.unit)}</div>`);

        const keyRow = (it) => `
            <div class="iv-key">
              <i style="background:${esc(it.colour)}"></i>
              <span>${esc(it.label)}</span>
              ${it.value ? `<b>${esc(it.value)}</b>` : ''}
            </div>`;
        if (L.items && L.items.length) {
          const ramp = L.kind === 'ramp';
          parts.push(`<div class="iv-keys${ramp ? ' ramp' : ''}">` + L.items.map(keyRow).join('') + '</div>');
        }
        if (L.extra && L.extra.length) {
          parts.push('<div class="iv-keys">' + L.extra.map(keyRow).join('') + '</div>');
        }

        if (L.stats && L.stats.length) {
          parts.push('<div class="iv-stats">' + L.stats.filter((s) => s.v !== '' && s.v != null).map((s) => `
            <div class="iv-stat"><span class="k">${esc(s.k)}</span><span class="v">${esc(String(s.v))}</span></div>`).join('') + '</div>');
        }

        if (L.note) parts.push(`<p class="iv-note">${esc(L.note)}</p>`);
        if (L.basis) parts.push(`<details class="iv-basis"><summary>Where this comes from</summary><p>${esc(L.basis)}</p></details>`);
        cardBody.innerHTML = parts.join('');
      }

      /* -------------------------------------------------------------- events */

      launch.addEventListener('click', () => setOpen(!open));
      cardHead.querySelector('.iv-card-x').addEventListener('click', () => { iv.clear(); render(); });
      cardHead.querySelector('.iv-card-min').addEventListener('click', (e) => {
        collapsed = !collapsed;
        e.currentTarget.textContent = collapsed ? '+' : '−';
        render();
      });
      cardHead.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        collapsed = !collapsed;
        cardHead.querySelector('.iv-card-min').textContent = collapsed ? '+' : '−';
        render();
      });

      search.addEventListener('input', () => { query = search.value; cursor = 0; buildList(); });

      // Capture, so a key this panel owns never also reaches the camera rig. Only the keys it
      // actually handles are stopped: everything else goes straight through.
      window.addEventListener('keydown', (e) => {
        const typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
        if (e.metaKey || e.ctrlKey) return;

        if (open) {
          if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
          if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            if (filtered.length) cursor = (cursor + (e.code === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
            paintCursor();
            return;
          }
          if (e.code === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            if (filtered[cursor]) choose(filtered[cursor].id);
            return;
          }
        }

        if (e.altKey) {
          if (e.code === 'KeyV') { e.preventDefault(); e.stopPropagation(); iv.clear(); render(); return; }
          const m = /^Key([A-Z])$/.exec(e.code);
          if (m) {
            const v = all.find((q) => q.key === m[1]);
            if (v) { e.preventDefault(); e.stopPropagation(); iv.set(v.id); setOpen(false); render(); }
          }
          return;
        }

        if (typing) return;
        if (e.code === 'KeyV') { e.preventDefault(); e.stopPropagation(); setOpen(!open); return; }
        if (e.code === 'BracketRight') { e.preventDefault(); e.stopPropagation(); iv.step(1); render(); return; }
        if (e.code === 'BracketLeft') { e.preventDefault(); e.stopPropagation(); iv.step(-1); render(); }
      }, true);

      // Clicking on the island closes the picker, so it is never in the way of the next thing
      // you want to look at.
      const canvas = document.getElementById('stage');
      if (canvas) {
        canvas.addEventListener('pointerdown', () => {
          if (open) setOpen(false);
          if (!dimmed) { dimmed = true; dock.classList.add('dim'); }
        });
        window.addEventListener('pointerup', () => {
          if (dimmed) { dimmed = false; dock.classList.remove('dim'); }
        });
      }

      iv.on(() => render());
      render();

      let last = null;
      return {
        update() {
          if (collapsed || !iv.activeId()) return;
          // The numbers are live, so the legend is redrawn when the island has moved on.
          const key = `${iv.activeId()}:${Math.floor(w.clock.tick / 3)}`;
          if (key === last) return;
          last = key;
          render();
        }
      };
    }
  });
}

/* ------------------------------------------------------------------ chrome */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function iconLayers() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '13'); s.setAttribute('height', '13');
  s.innerHTML = '<path d="M8 1.6 1.8 5 8 8.4 14.2 5zM2.4 8.2 8 11.3l5.6-3.1M2.4 11.2 8 14.3l5.6-3.1" '
    + 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>';
  return s;
}
function iconSearch() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '12'); s.setAttribute('height', '12');
  s.innerHTML = '<circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  return s;
}

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'iv-panel-css';
  s.textContent = `
.iv-dock { position:absolute; left:var(--sp-4); bottom:var(--sp-4); z-index:14;
  display:flex; flex-direction:column; align-items:flex-start; gap:var(--sp-2);
  transition:opacity var(--med) var(--ease); max-width:340px; }
.iv-dock.dim { opacity:.22; }
.iv-dock.dim .iv-card { pointer-events:none; }

.iv-launch { order:2; background:var(--s-1); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  box-shadow:var(--shadow-1); padding:var(--sp-2) var(--sp-3); }
.iv-launch kbd { font:600 9px/1 var(--f-num); background:var(--s-sunk); border:1px solid var(--edge);
  border-radius:3px; padding:2px 4px; color:var(--t-faint); margin-left:2px; }
.iv-launch.active { border-color:rgba(63,182,196,.55); color:var(--t-hi); }
.iv-launch.active svg { color:var(--sea); }

/* ---- the legend card ---- */
.iv-card { order:1; display:none; width:318px;
  background:var(--s-1); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge); border-radius:var(--r-3); box-shadow:var(--shadow-2);
  animation:slide-up var(--med) var(--ease-out) both; overflow:hidden; }
.iv-card.on { display:block; }
.iv-card-head { display:flex; align-items:baseline; gap:var(--sp-2); padding:var(--sp-3) var(--sp-2) var(--sp-2) var(--sp-3);
  border-bottom:1px solid var(--edge); background:linear-gradient(180deg, rgba(255,255,255,.04), transparent);
  cursor:default; }
.iv-card-group { font:600 var(--fs-micro)/1 var(--f-ui); letter-spacing:.14em; text-transform:uppercase; flex:none; }
.iv-card-name { flex:1; font:500 var(--fs-base)/1.25 var(--f-ui); color:var(--t-hi); min-width:0; }
.iv-card-min, .iv-card-x { align-self:center; width:22px; height:22px; padding:0; font-size:14px; line-height:1; }
.iv-card-body { padding:var(--sp-3); max-height:min(52vh, 460px); }
.iv-card.folded .iv-card-body { display:none; }

.iv-why { font-size:var(--fs-sm); line-height:1.5; color:var(--t); margin-bottom:var(--sp-3); }
.iv-unit { font:400 var(--fs-micro)/1.4 var(--f-num); color:var(--t-faint); letter-spacing:.04em;
  text-transform:none; margin-bottom:var(--sp-2); }

.iv-keys { display:flex; flex-direction:column; gap:3px; margin-bottom:var(--sp-3); }
.iv-key { display:flex; align-items:center; gap:var(--sp-2); font-size:var(--fs-sm); color:var(--t-dim); }
.iv-key i { width:13px; height:13px; border-radius:3px; flex:none; box-shadow:inset 0 0 0 1px rgba(0,0,0,.35); }
.iv-key span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iv-key b { font:400 var(--fs-micro)/1 var(--f-num); color:var(--t); font-variant-numeric:tabular-nums; }
/* A ramp is one continuous thing, so its swatches sit shoulder to shoulder rather than in a list. */
.iv-keys.ramp { flex-direction:row; gap:0; margin-bottom:var(--sp-3); }
.iv-keys.ramp .iv-key { flex-direction:column; align-items:stretch; gap:3px; flex:1; min-width:0; }
.iv-keys.ramp .iv-key i { width:auto; height:9px; border-radius:0; }
.iv-keys.ramp .iv-key:first-child i { border-radius:3px 0 0 3px; }
.iv-keys.ramp .iv-key:last-child i { border-radius:0 3px 3px 0; }
.iv-keys.ramp .iv-key span { font-size:9px; letter-spacing:.02em; text-align:center; color:var(--t-faint); }
.iv-keys.ramp .iv-key b { display:none; }

.iv-stats { display:grid; grid-template-columns:1fr 1fr; gap:6px var(--sp-3);
  padding-top:var(--sp-2); border-top:1px solid var(--edge); }
.iv-stat { display:flex; flex-direction:column; gap:1px; min-width:0; }
.iv-stat .k { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:var(--t-faint);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.iv-stat .v { font:400 var(--fs-sm)/1.25 var(--f-num); color:var(--t-hi); font-variant-numeric:tabular-nums; }

.iv-note { margin-top:var(--sp-3); padding-top:var(--sp-3); border-top:1px solid var(--edge);
  font-size:var(--fs-sm); line-height:1.55; color:var(--t-dim); }
.iv-basis { margin-top:var(--sp-2); }
.iv-basis summary { font-size:var(--fs-micro); letter-spacing:.1em; text-transform:uppercase;
  color:var(--t-faint); cursor:pointer; list-style:none; }
.iv-basis summary::-webkit-details-marker { display:none; }
.iv-basis summary::before { content:'▸ '; }
.iv-basis[open] summary::before { content:'▾ '; }
.iv-basis p { margin-top:var(--sp-2); font-size:var(--fs-sm); line-height:1.5; color:var(--t-faint); }

/* ---- the picker ---- */
.iv-pick { position:absolute; left:0; bottom:0; width:352px; display:none; flex-direction:column;
  background:var(--s-2); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge-strong); border-radius:var(--r-3); box-shadow:var(--shadow-3);
  overflow:hidden; animation:slide-up var(--med) var(--ease-out) both; }
.iv-pick.on { display:flex; }
.iv-search-wrap { display:flex; align-items:center; gap:var(--sp-2); padding:var(--sp-3);
  border-bottom:1px solid var(--edge); color:var(--t-faint); }
.iv-search { flex:1; appearance:none; background:none; border:none; outline:none;
  font:400 var(--fs-base)/1.2 var(--f-ui); color:var(--t-hi); min-width:0; }
.iv-search::placeholder { color:var(--t-faint); }

.iv-list { max-height:min(56vh, 460px); padding:var(--sp-2); }
.iv-grp { display:flex; align-items:center; gap:6px; padding:var(--sp-3) var(--sp-2) var(--sp-1);
  font:600 var(--fs-micro)/1 var(--f-ui); letter-spacing:.16em; text-transform:uppercase; color:var(--t-faint); }
.iv-grp i { width:5px; height:5px; border-radius:50%; display:block; }
.iv-row { display:flex; align-items:flex-start; gap:var(--sp-2); width:100%; text-align:left;
  appearance:none; background:none; border:none; cursor:pointer; color:inherit;
  padding:var(--sp-2) var(--sp-2); border-radius:var(--r-2); transition:background var(--fast); }
.iv-row-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.iv-row-name { font:500 var(--fs-base)/1.25 var(--f-ui); color:var(--t-hi); }
.iv-row-why { font-size:var(--fs-sm); line-height:1.45; color:var(--t-faint);
  display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
.iv-row.cursor .iv-row-why, .iv-row.on .iv-row-why { -webkit-line-clamp:3; }
.iv-row-key { flex:none; font:600 9px/1 var(--f-num); background:var(--s-sunk); border:1px solid var(--edge);
  border-radius:3px; padding:3px 5px; color:var(--t-faint); margin-top:2px; }
.iv-row.cursor { background:rgba(255,255,255,.06); }
.iv-row.on { background:rgba(63,182,196,.14); box-shadow:inset 2px 0 0 var(--sea); }
.iv-row.on .iv-row-name { color:var(--sea); }
.iv-row.off { opacity:.4; }
.iv-empty { padding:var(--sp-5) var(--sp-3); text-align:center; color:var(--t-faint); font-size:var(--fs-sm); }
.iv-empty em { color:var(--sea); font-style:normal; }

.iv-hint { display:flex; flex-wrap:wrap; gap:var(--sp-3); padding:var(--sp-2) var(--sp-3);
  border-top:1px solid var(--edge); font-size:9px; letter-spacing:.06em; color:var(--t-faint); }
.iv-hint kbd { font:600 9px/1 var(--f-num); background:var(--s-sunk); border:1px solid var(--edge);
  border-radius:3px; padding:2px 4px; margin-right:2px; }

@media (max-width: 900px) {
  .iv-dock { max-width:none; right:var(--sp-2); left:var(--sp-2); }
  .iv-card, .iv-pick { width:auto; right:0; left:0; }
}
`;
  document.head.appendChild(s);
}
