// UI registry. Panels register themselves and are mounted into #ui-root in order.
// UI reads world.state and world.store; it never mutates simulation data directly,
// it emits intents on the bus (`ui:intent`) which civic/economy systems decide about.

const PANELS = [];

/**
 * @param {{id:string, order?:number, mount:(root:HTMLElement, world:World)=>({update?:Function}|void)}} panel
 */
export function registerPanel(panel) {
  panel.order = panel.order ?? 100;
  PANELS.push(panel);
  PANELS.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  return panel;
}

export function mountUI(world) {
  const root = document.getElementById('ui-root');
  const live = [];
  for (const p of PANELS) {
    try {
      const handle = p.mount(root, world);
      if (handle && handle.update) live.push(handle);
    } catch (e) {
      console.error('[ui] panel failed to mount', p.id, e);
    }
  }
  // UI updates at 10 Hz. Simulation speed does not change UI cadence.
  setInterval(() => {
    for (const h of live) {
      try { h.update(world); } catch (e) { /* a bad panel must not stop the island */ }
    }
  }, 100);
  world.ui = { root, panels: PANELS.map((p) => p.id) };
  return live;
}

/** Small helper so panels stay declarative. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}
