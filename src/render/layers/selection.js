// Picking. Click anything on this island and find out what it is.
//
// WHY THIS IS NOT scene.pick()
//   Almost nothing on screen is a pickable mesh. The houses are thin instances of a shared part
//   under a custom shader, the trees are 33 million stems packed into instance buffers, the people
//   and the animals are positions in a simulation that a render layer draws from. Babylon's picker
//   can tell you which triangle of which merged buffer the ray hit, which is not an answer to
//   "who is that". So this layer does the opposite: it asks the heightfield where the cursor is
//   standing, then asks the simulation what lives near that point, and settles the argument in
//   screen space so the thing you clicked is the thing nearest your cursor rather than the thing
//   nearest the ground.
//
//   island.raycast() marches the heightfield directly, so this works with no pickable geometry at
//   all and keeps working when the buildings layer changes how it batches.
//
// WHAT CAN BE SELECTED
//   resident, visitor party, household, building (a dwelling or a named premises), business,
//   vehicle (when a vehicle system publishes one), road segment, koala, whale pod, shorebird roost,
//   lake, dune reach, and failing all of those, the 32 m terrain cell under the cursor. Nothing is
//   ever "nothing": a click on bare heath selects the ground and the inspector tells you what grows
//   there.
//
// THE READ MODEL
//   world.state.selection is {kind, id, worldPos} plus a label and the hover under the cursor.
//   world.bus 'select' fires on every change, with kind null when it clears.
//   Panels ask for a selection with world.bus.emit('ui:intent', {kind:'select', target:{kind,id}}),
//   which is the contract in docs/CONTRACT.md: a panel never writes simulation state.
//
// THE HIGHLIGHT
//   A band draped on the terrain: a dark keyline either side of a bright core, six vertices across,
//   built from a polyline so one primitive draws a ring round a person, the outline of a lake, the
//   length of a road segment and the square of a terrain cell. No boxes, no bounding brackets, no
//   spinning brackets. It is the same mark a surveyor would leave.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

/** Selection colours, from src/ui/design.css. --sea for the selection, --sand for the hover. */
const SEA = [0.247, 0.714, 0.769];
const SAND = [0.910, 0.863, 0.769];
const KEYLINE = [0.016, 0.035, 0.047];

/**
 * How near the cursor a thing has to be, in CSS pixels, before it can be picked, and how hard it
 * competes when two things are both in range. A koala outranks the house it is sitting behind
 * because a koala is the rarer answer to "what is that".
 */
const KINDS = {
  koala: { px: 30, weight: 0.66, ring: 1.6, priority: 9 },
  whale: { px: 44, weight: 0.72, ring: 26, priority: 8 },
  resident: { px: 26, weight: 0.78, ring: 1.5, priority: 7 },
  visitor: { px: 24, weight: 0.88, ring: 1.8, priority: 6 },
  vehicle: { px: 26, weight: 0.80, ring: 2.6, priority: 7 },
  business: { px: 34, weight: 0.90, ring: 11, priority: 5 },
  roost: { px: 34, weight: 0.90, ring: 30, priority: 5 },
  // A contributed public feature: a bus stop, a jetty, a toilet block, a water treatment plant.
  // It outranks the house behind it for the same reason a koala does, which is that it is the
  // rarer and more useful answer to "what is that", and it is the only marker on this island a
  // player can follow back to the person who put it there.
  facility: { px: 32, weight: 0.84, ring: 7, priority: 6 },
  building: { px: 30, weight: 1.00, ring: 8, priority: 4 }
};

/** The kinds small enough and mobile enough to need a standing collar of light as well as a ring. */
const STANDS_UP = new Set(['resident', 'visitor', 'koala', 'whale', 'vehicle']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ spatial index

A uniform hash grid over world metres. Rebuilt lazily: the static sets (dwellings, premises,
roosts) once and again when the population system relinks them, the moving sets no more than four
times a second and only while a pointer is actually asking. A pick that finds nothing costs one
grid query, not a walk of two thousand residents. */

class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.built = -1e9; this.n = 0; }
  static key(i, j) { return i * 46337 + j; }
  clear() { this.map.clear(); this.n = 0; }
  add(x, z, item) {
    const k = Grid.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const a = this.map.get(k);
    if (a) a.push(item); else this.map.set(k, [item]);
    this.n++;
  }
  /** Everything within `r` metres of (x, z). Exact, so a hash collision cannot fake a hit. */
  query(x, z, r, out) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const a = this.map.get(Grid.key(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const it = a[k];
          const dx = it.x - x, dz = it.z - z;
          if (dx * dx + dz * dz <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}

export function registerSelection(world) {
  /* ------------------------------------------------------------ the read model */

  const state = world.publish('selection', {
    /** The three fields the rest of the project reads. */
    kind: null,
    id: null,
    worldPos: null,
    /** Everything else is convenience for the inspector and the tooltip. */
    label: '',
    sub: '',
    at: null,              // the named region the selection sits in
    since: 0,              // sim tick the selection was made
    hover: null,           // {kind, id, label, sub}
    history: [],           // recently selected, most recent first, for a back button
    picks: 0,
    lastPickMs: 0,
    kinds: Object.keys(KINDS).concat(['road', 'lake', 'dune', 'cell', 'household'])
  });

  /* ------------------------------------------------------------ locating things

  One place that turns a (kind, id) into a live world position, so the highlight follows a walking
  resident and a moving animal without every caller knowing where positions live. */

  function residents() { return world.residents && world.residents.ready ? world.residents : null; }

  function locate(kind, id) {
    const R = residents();
    switch (kind) {
      case 'resident': {
        const p = R && R.peopleById.get(id);
        return p && p.onIsland ? { x: p.x, z: p.z } : null;
      }
      case 'visitor': {
        const c = world.store.get(id, 'visitor');
        return c && Number.isFinite(c.x) ? { x: c.x, z: c.z } : null;
      }
      case 'household': {
        const hh = R && R.householdsById.get(id);
        return hh ? { x: hh.x, z: hh.z } : null;
      }
      case 'building': {
        const d = R && R.dwellingsById.get(id);
        if (d) return { x: d.x, z: d.z };
        const b = R && R.places.get(id);
        return b ? { x: b.x, z: b.z } : null;
      }
      case 'business': {
        const b = R && R.businesses.get(id);
        return b ? { x: b.x, z: b.z } : null;
      }
      case 'koala': {
        const k = world.store.get(id, 'koala');
        return k ? { x: k.x, z: k.z } : null;
      }
      case 'whale': {
        const wh = world.read('whales');
        const pod = wh && wh.pods && wh.pods.find((p) => p.id === id);
        return pod ? { x: pod.x, z: pod.z, water: true } : null;
      }
      case 'roost': {
        const sb = world.read('shorebirds');
        const r = sb && sb.roosts && sb.roosts.find((p) => p.id === id);
        return r ? { x: r.x, z: r.z } : null;
      }
      case 'dune': {
        const dn = world.read('dunes');
        const r = dn && dn.reaches && dn.reaches.find((p) => p.id === id);
        return r ? { x: r.x, z: r.z } : null;
      }
      case 'lake': {
        const lk = world.island && world.island.lakes.find((l) => l.id === id);
        return lk ? { x: lk.x, z: lk.z } : null;
      }
      case 'vehicle': {
        const v = vehicleById(id);
        return v ? { x: v.x, z: v.z } : null;
      }
      case 'facility': {
        const f = facilityById(id);
        return f ? { x: f.x, z: f.z } : null;
      }
      case 'road': {
        const e = roadEdge(id);
        if (!e || !e.pts || !e.pts.length) return null;
        const m = e.pts[Math.floor(e.pts.length / 2)];
        return { x: m[0], z: m[1] };
      }
      case 'cell': {
        const [, sx, sz] = String(id).split(':');
        return { x: Number(sx), z: Number(sz) };
      }
      default: return null;
    }
  }

  function roadEdge(id) {
    const net = world.read('roadNetwork');
    if (!net || !net.edges) return null;
    return net.edges.find((e) => e.id === id) || null;
  }

  /** Vehicles are not built yet. Read whatever a traffic system publishes, defensively. */
  function vehicleList() {
    const t = world.read('traffic') || world.read('vehicles');
    if (!t) return null;
    const list = t.vehicles || t.list || t.active;
    return Array.isArray(list) ? list : null;
  }
  function vehicleById(id) {
    const list = vehicleList();
    return list ? list.find((v) => v.id === id) || null : null;
  }

  /** A contributed public feature. The read model carries a byId() so this is a lookup, not a scan. */
  function facilityById(id) {
    const c = world.read('contributed');
    if (!c || !c.ready) return null;
    return typeof c.byId === 'function' ? c.byId(id) : (c.features || []).find((f) => f.id === id) || null;
  }

  /* ------------------------------------------------------------ labels

  Short enough for a tooltip, honest enough to be the panel's header. The inspector does the depth;
  this is what you read in the 100 ms before the panel catches up. */

  function labelOf(kind, id) {
    const R = residents();
    switch (kind) {
      case 'resident': {
        const p = R && R.peopleById.get(id);
        if (!p) return null;
        return {
          label: p.displayName,
          sub: `${Math.floor(p.age)}, ${p.occupationLabel || 'no occupation recorded'}`,
          why: p.actionLabel ? `${p.actionLabel}: ${p.reason || ''}`.trim() : null
        };
      }
      case 'visitor': {
        const c = world.store.get(id, 'visitor');
        const vs = world.read('visitors');
        const s = vs && vs.sample && vs.sample.find((p) => p.id === id);
        if (!c && !s) return null;
        const lab = s ? s.label : archetypeLabel(c && c.archetype);
        const size = s ? s.size : (c && c.size) || 1;
        return { label: lab, sub: `visiting, ${size} ${size === 1 ? 'person' : 'people'}`, why: s ? s.doing : null };
      }
      case 'household': {
        // hh.label is a whole sentence in the population read model. A tooltip wants a name.
        const hh = R && R.householdsById.get(id);
        return hh ? { label: `The ${hh.surname}s`, sub: `${hh.shape}, ${hh.townshipName}` } : null;
      }
      case 'building': {
        const d = R && R.dwellingsById.get(id);
        if (d) {
          const hh = d.householdId ? R.householdsById.get(d.householdId) : null;
          return {
            label: hh ? `The ${hh.surname} house` : useLabel(d.use),
            sub: `${d.bedrooms} bedroom house, ${townshipName(d.townshipId)}`,
            why: hh ? `${hh.shape}, ${hh.members.length === 1 ? '1 person' : hh.members.length + ' people'}` : useWhy(d)
          };
        }
        const b = R && R.places.get(id);
        return b ? { label: b.label, sub: townshipName(b.township) } : null;
      }
      case 'business': {
        const b = R && R.businesses.get(id);
        const bs = world.read('businesses');
        const row = bs && bs.board && bs.board.find((r) => r.id === id);
        if (!b && !row) return null;
        return {
          label: b ? b.label : row.name,
          sub: `${typeLabel(b ? b.bizType : row.sector)}, ${townshipName(b ? b.township : row.township)}`,
          why: row ? (row.open ? 'open now' : 'shut at the moment') : null
        };
      }
      case 'koala': {
        const k = world.store.get(id, 'koala');
        if (!k) return null;
        const yrs = k.age / 365;
        return {
          label: 'Koala',
          sub: `${k.sex === 'm' ? 'male' : 'female'}, ${yrs.toFixed(1)} years`,
          why: k.joey >= 0 ? 'with a joey' : k.dispDays > 0 ? 'dispersing' : k.onGround ? 'on the ground' : 'up a tree'
        };
      }
      case 'whale': {
        const wh = world.read('whales');
        const pod = wh && wh.pods && wh.pods.find((p) => p.id === id);
        if (!pod) return null;
        return {
          label: 'Humpback pod',
          sub: `${pod.size} ${pod.size === 1 ? 'whale' : 'whales'}${pod.calf ? ' including a calf' : ''}`,
          why: pod.behaviour
        };
      }
      case 'roost': {
        const sb = world.read('shorebirds');
        const r = sb && sb.roosts && sb.roosts.find((p) => p.id === id);
        return r ? { label: r.label, sub: `shorebird roost, ${Math.round(r.birds)} birds` } : null;
      }
      case 'road': {
        const e = roadEdge(id);
        return e ? { label: e.name, sub: `${clsLabel(e.cls)}, ${(e.lengthM / 1000).toFixed(2)} km` } : null;
      }
      case 'lake': {
        const lk = world.island && world.island.lakes.find((l) => l.id === id);
        if (!lk) return null;
        return { label: lk.nameQuandamooka ? `${lk.name} (${lk.nameQuandamooka})` : lk.name, sub: 'lake' };
      }
      case 'dune': {
        const dn = world.read('dunes');
        const r = dn && dn.reaches && dn.reaches.find((p) => p.id === id);
        return r ? { label: r.label, sub: 'beach and dune reach' } : null;
      }
      case 'vehicle': {
        const v = vehicleById(id);
        return v ? { label: v.label || v.kind || 'vehicle', sub: v.doing || v.mode || 'on the road' } : null;
      }
      case 'facility': {
        const f = facilityById(id);
        if (!f) return null;
        const c = world.read('contributed');
        // For a bus stop that is a published timing point, the next departure is the most useful
        // thing anybody standing at it wants to know, and it is the one live fact these records have.
        let why = null;
        if (f.kind === 'bus_stop' && c && typeof c.departuresAt === 'function') {
          const next = c.departuresAt(f.id, 1)[0];
          why = next
            ? `${next.routeLabel} at ${next.at_text} towards ${next.towards}, in ${next.inMinutes} minutes`
            : 'no published departure from this stop';
        }
        return {
          label: f.name,
          sub: `${f.kindLabel}, ${f.townshipLabel || f.region || 'the island'}`,
          why
        };
      }
      case 'cell': {
        const p = locate('cell', id);
        if (!p || !world.island) return null;
        const cover = world.island.landCover(p.x, p.z);
        const m = Math.round(world.island.height(p.x, p.z) - world.island.seaLevel);
        return {
          label: world.island.regionAt(p.x, p.z),
          sub: `${cap(coverLabel(cover))}, ${m} m above the sea`
        };
      }
      default: return null;
    }
  }

  const USE = {
    resident: 'A lived-in house', 'holiday-home': 'A holiday house', weekender: 'A weekender', vacant: 'An empty house'
  };
  const useLabel = (u) => USE[u] || 'A house';
  function useWhy(d) {
    if (d.occupiedByPartyId) return 'let out this week';
    if (d.use === 'holiday-home' || d.use === 'weekender') return 'nobody in it tonight';
    if (d.use === 'vacant') return d.vacantReason || 'empty';
    return null;
  }
  const TOWNSHIP_NAMES = {
    dunwich: 'Dunwich', 'point-lookout': 'Point Lookout', 'amity-point': 'Amity Point', 'one-mile': 'One Mile'
  };
  const townshipName = (id) => TOWNSHIP_NAMES[id] || (id ? String(id) : 'the island');
  const typeLabel = (t) => String(t || 'business').replace(/[-_]/g, ' ');
  const coverLabel = (c) => String(c || 'ground').replace(/[-_]/g, ' ');
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
  const CLS = {
    spine: 'the island spine', sealed: 'sealed road', gravel: 'gravel road', street: 'street',
    sandtrack: 'sand track', walk: 'walking track', beachaccess: 'beach access track', beachroute: 'beach route'
  };
  const clsLabel = (c) => CLS[c] || String(c || 'road');
  function archetypeLabel(id) {
    if (!id) return 'A visiting party';
    return String(id).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  /* ------------------------------------------------------------ selecting

  `markDirty` lives up here rather than with the meshes it drives, because the render half returns
  early when there is no stage and a headless world can still be told to select something: a save
  file carries a selection, and the headless harness drives one. With the flag declared below the
  early return, selecting anything in Node threw on a temporal dead zone. */

  let markDirty = true;
  function rebuildHighlight() { markDirty = true; }

  function apply(kind, id, pos, source) {
    const prev = state.kind ? { kind: state.kind, id: state.id, label: state.label } : null;
    if (kind && state.kind === kind && state.id === id) return state;   // already there
    state.kind = kind || null;
    state.id = kind ? id : null;
    const info = kind ? labelOf(kind, id) : null;
    state.label = info ? info.label : '';
    state.sub = info ? info.sub || '' : '';
    const p = pos || (kind ? locate(kind, id) : null);
    state.worldPos = p && world.island
      ? { x: Math.round(p.x), y: Math.round((p.water ? world.island.seaLevel : world.island.height(p.x, p.z)) * 10) / 10, z: Math.round(p.z) }
      : (p ? { x: Math.round(p.x), y: 0, z: Math.round(p.z) } : null);
    state.at = state.worldPos && world.island ? world.island.regionAt(state.worldPos.x, state.worldPos.z) : null;
    state.since = world.clock.tick;
    if (prev && (prev.kind !== kind || prev.id !== id)) {
      state.history.unshift(prev);
      if (state.history.length > 12) state.history.length = 12;
    }
    rebuildHighlight();
    world.bus.emit('select', { kind: state.kind, id: state.id, worldPos: state.worldPos, label: state.label, source: source || 'pick' });
    return state;
  }

  function clear(source) {
    if (!state.kind) return;
    apply(null, null, null, source || 'clear');
  }

  /* ------------------------------------------------------------ the system half

  A system, not only a layer, so world.state.selection exists headless, so describe() reports what
  a critic is looking at, and so a save carries the selection back. It does no work per tick beyond
  checking that whatever is selected is still alive, once a sim-hour. */

  world.register({
    id: 'selection',
    phase: 'presentation',
    order: 10,

    tick(w) {
      if (!state.kind) return;
      // Keep the published position live: a selected resident walks, a koala moves between feed
      // trees and a whale pod is doing eight knots down the coast. One lookup a tick for one thing.
      const p = locate(state.kind, state.id);
      if (p && state.worldPos) {
        state.worldPos.x = Math.round(p.x);
        state.worldPos.z = Math.round(p.z);
        if (w.island) {
          state.worldPos.y = Math.round((p.water ? w.island.seaLevel : w.island.height(p.x, p.z)) * 10) / 10;
          state.at = w.island.regionAt(p.x, p.z);
        }
      }
      if (w.clock.tick % 6 !== 0) return;
      // A koala can be hit by a car and a household can leave the island while you are reading
      // about them. Rather than showing a stale card, say so and clear.
      if (!labelOf(state.kind, state.id)) {
        w.bus.emit('select:lost', { kind: state.kind, id: state.id, label: state.label });
        clear('gone');
      }
    },

    // No wall-clock number goes in here. describe() is what --determinism fingerprints, and a
    // millisecond timing would make two identical runs disagree the moment anybody clicked.
    // The pick cost is on the read model instead, where TWIN.probe() picks it up.
    describe() {
      return {
        kind: state.kind, id: state.id, label: state.label,
        picks: state.picks,
        hover: state.hover ? state.hover.kind : null
      };
    },
    save() { return { kind: state.kind, id: state.id }; },
    load(w, s) { if (s && s.kind) apply(s.kind, s.id, null, 'load'); }
  });

  /* ------------------------------------------------------------ the panel contract

  Panels never write simulation state. They ask, and this decides. */

  world.bus.on('ui:intent', (p) => {
    if (!p) return;
    if (p.kind === 'select' && p.target) {
      apply(p.target.kind, p.target.id, null, p.source || 'panel');
      if (p.focus) focus(p.target.kind, p.target.id, p.dist);
    } else if (p.kind === 'select:clear') {
      clear('panel');
    } else if (p.kind === 'select:back') {
      const prev = state.history.shift();
      if (prev) {
        // Do not push the thing we are leaving back onto a stack we just popped.
        const keep = state.history.slice();
        apply(prev.kind, prev.id, null, 'back');
        state.history.length = 0;
        for (const h of keep) state.history.push(h);
      }
    } else if (p.kind === 'select:focus') {
      focus(p.target ? p.target.kind : state.kind, p.target ? p.target.id : state.id, p.dist);
    } else if (p.kind === 'select:follow') {
      follow(p.target ? p.target.kind : state.kind, p.target ? p.target.id : state.id);
    }
  });

  function focus(kind, id, dist) {
    const p = locate(kind, id);
    if (!p) return;
    const k = KINDS[kind];
    world.bus.emit('camera:goto', {
      x: p.x, z: p.z,
      dist: dist || (k ? clamp(k.ring * 26, 80, 900) : 420),
      dur: 1.1
    });
  }

  /** Lock the camera onto a live position, so following one person through a day is one click. */
  function follow(kind, id) {
    if (!locate(kind, id)) return;
    const info = labelOf(kind, id);
    world.bus.emit('camera:follow', {
      get: () => {
        const p = locate(kind, id);
        if (!p) return null;
        return { x: p.x, y: (p.water ? (world.island ? world.island.seaLevel : 0) : (world.island ? world.island.height(p.x, p.z) : 0)) + 1.4, z: p.z };
      },
      label: info ? info.label : kind
    });
  }

  world.selection = {
    select: (kind, id, opts) => apply(kind, id, null, (opts && opts.source) || 'api'),
    clear: () => clear('api'),
    focus,
    follow,
    locate,
    labelOf,
    get state() { return state; }
  };

  /* ============================================================== the render half */

  if (!world.stage || !B) return;

  const stage = world.stage;
  const scene = stage.scene;
  const canvas = stage.canvas;
  const island = world.island;

  /* ---- the band shader. Unlit, vertex coloured, so the mark is exactly the colour it says it is
     on white silica sand at noon and in the bush at dusk. ---- */

  const BAND_VERT = `
precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec4 vC;
void main(void) {
  vC = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

  const BAND_FRAG = `
precision highp float;
varying vec4 vC;
uniform vec4 uTint;      // rgb multiplier, a = overall opacity (the pulse)
void main(void) {
  gl_FragColor = vec4(vC.rgb * uTint.rgb, vC.a * uTint.a);
}`;

  /**
   * @param additive The flat band paints a dark keyline and a bright core, so it blends normally.
   * The standing collar is light rather than paint: over it goes additively, which is the only way
   * a soft column reads as a glow instead of as a white card standing in a paddock. It also makes
   * the double-sided geometry harmless, since adding the far wall to the near one is what a column
   * of light does anyway.
   */
  function bandMaterial(name, additive) {
    const m = new B.ShaderMaterial(name, scene,
      { vertexSource: BAND_VERT, fragmentSource: BAND_FRAG },
      { attributes: ['position', 'color'], uniforms: ['viewProjection', 'uTint'] });
    m.backFaceCulling = false;
    m.needAlphaBlending = () => true;
    m.alphaMode = additive ? B.Engine.ALPHA_ADD : B.Engine.ALPHA_COMBINE;
    m.disableDepthWrite = true;
    m.zOffset = -12;
    return m;
  }

  /**
   * A polyline draped on the heightfield, widened into a six-across band: a soft dark halo, a dark
   * keyline, a bright core, and the same again on the other side. Written into one pair of buffers
   * that are reallocated only when the point count grows, so a ring that follows a walking person
   * costs one buffer update a frame and no garbage.
   */
  class Band {
    constructor(name, rgb, additive) {
      this.mesh = new B.Mesh(name, scene);
      this.mesh.material = bandMaterial(name + '-mat', additive);
      this.mesh.isPickable = false;
      this.mesh.alwaysSelectAsActiveMesh = true;
      this.mesh.doNotSyncBoundingInfo = true;
      this.mesh.alphaIndex = 20;
      this.mesh.setEnabled(false);
      this.rgb = rgb;
      this.cap = 0;
      this.pos = null; this.col = null; this.idx = null;
      this.tint = new B.Vector4(rgb[0], rgb[1], rgb[2], 1);
    }
    dispose() { try { this.mesh.material.dispose(); this.mesh.dispose(); } catch (e) { /* gone */ } }
    hide() { this.mesh.setEnabled(false); }
    /**
     * @param {number[][]} pts [[x,z], ...]
     * @param {boolean} closed
     * @param {number} w half width in metres (or the collar height when `wall` is set)
     * @param {number} lift metres above the ground
     * @param {boolean} wall true to stand the band up as a collar of light instead of laying it flat
     */
    set(pts, closed, w, lift, wall) {
      const n = pts.length;
      if (n < 2) { this.hide(); return; }
      const rings = closed ? n + 1 : n;
      const need = rings * 6;
      if (need > this.cap) {
        this.cap = Math.ceil(need * 1.5);
        this.pos = new Float32Array(this.cap * 3);
        this.col = new Float32Array(this.cap * 4);
        const quads = (this.cap / 6 - 1) * 5;
        this.idx = new Uint32Array(Math.max(6, Math.floor(quads) * 6));
        this._built = 0;
      }
      // Flat: a soft dark halo, a dark keyline, a bright core, and the same the other side, so the
      // mark reads on white silica sand and in dark heath without changing colour.
      const OFF = [-2.4, -1.0, -0.42, 0.42, 1.0, 2.4];
      const A = [0.0, 0.5, 1.0, 1.0, 0.5, 0.0];
      const DARK = [1, 1, 0, 0, 1, 1];
      // Standing: bright at the ground, gone by the top. A flat ring seen at a grazing angle is a
      // line two pixels high; a collar is visible from anywhere, which is the whole job.
      const UP = [0, 0.18, 0.40, 0.62, 0.82, 1.0];
      const UPA = [0.50, 0.36, 0.22, 0.12, 0.04, 0.0];
      const pos = this.pos, col = this.col;
      const y0 = lift === undefined ? 0.45 : lift;
      for (let i = 0; i < rings; i++) {
        const k = i % n;
        const p = pts[k];
        const prev = pts[(k - 1 + n) % n];
        const next = pts[(k + 1) % n];
        let nx = 0, nz = 0, mitre = 1;
        if (!wall) {
          // Mitre the corner properly. Averaging the two directions and normalising leaves a notch
          // at every right angle, which on a 32 m terrain cell is four visible gaps.
          let ax = p[0] - prev[0], az = p[1] - prev[1];
          let bx = next[0] - p[0], bz = next[1] - p[1];
          const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
          ax /= la; az /= la; bx /= lb; bz /= lb;
          if (!closed && k === 0) { ax = bx; az = bz; }
          if (!closed && k === n - 1) { bx = ax; bz = az; }
          const n1x = -az, n1z = ax, n2x = -bz, n2z = bx;
          let mx = n1x + n2x, mz = n1z + n2z;
          const lm = Math.hypot(mx, mz);
          if (lm < 1e-6) { nx = n1x; nz = n1z; } else {
            mx /= lm; mz /= lm;
            nx = mx; nz = mz;
            // Capped at twice. Uncapped, one reflex vertex in the Brown Lake outline threw a
            // forty metre spike off the shore, which is worse than the small notch the cap leaves.
            mitre = 1 / Math.max(0.5, mx * n1x + mz * n1z);
          }
        }
        for (let s = 0; s < 6; s++) {
          const b = (i * 6 + s) * 3;
          const c = (i * 6 + s) * 4;
          if (wall) {
            pos[b] = p[0];
            pos[b + 1] = (island ? island.height(p[0], p[1]) : 0) + y0 + UP[s] * w;
            pos[b + 2] = p[1];
            col[c] = 1; col[c + 1] = 1; col[c + 2] = 1;
            col[c + 3] = UPA[s];
          } else {
            const o = OFF[s] * w * mitre;
            const x = p[0] + nx * o, z = p[1] + nz * o;
            pos[b] = x;
            pos[b + 1] = (island ? island.height(x, z) : 0) + y0;
            pos[b + 2] = z;
            const dark = DARK[s];
            col[c] = dark ? KEYLINE[0] : 1;
            col[c + 1] = dark ? KEYLINE[1] : 1;
            col[c + 2] = dark ? KEYLINE[2] : 1;
            col[c + 3] = A[s] * (dark ? 0.62 : 1);
          }
        }
      }
      // Indices only when the ring count changes: the strip topology is the only thing that moves.
      if (this._built !== rings) {
        const idx = this.idx;
        let t = 0;
        for (let i = 0; i < rings - 1; i++) {
          for (let s = 0; s < 5; s++) {
            const a = i * 6 + s, b2 = a + 1, c = a + 6, d = c + 1;
            idx[t++] = a; idx[t++] = c; idx[t++] = b2;
            idx[t++] = b2; idx[t++] = c; idx[t++] = d;
          }
        }
        for (let i = t; i < idx.length; i++) idx[i] = 0;
        this._built = rings;
        this._tris = t;
        const vd = new B.VertexData();
        vd.positions = pos.subarray(0, rings * 6 * 3);
        vd.colors = col.subarray(0, rings * 6 * 4);
        vd.indices = idx.subarray(0, t);
        vd.applyToMesh(this.mesh, true);
        this.mesh.hasVertexAlpha = true;
      } else {
        this.mesh.updateVerticesData(B.VertexBuffer.PositionKind, pos.subarray(0, rings * 6 * 3));
        this.mesh.updateVerticesData(B.VertexBuffer.ColorKind, col.subarray(0, rings * 6 * 4));
      }
      this.mesh.setEnabled(true);
    }
    setTint(alpha) {
      this.tint.set(this.rgb[0], this.rgb[1], this.rgb[2], alpha);
      this.mesh.material.setVector4('uTint', this.tint);
    }
  }

  const selBand = new Band('selection-mark', SEA);
  const hovBand = new Band('hover-mark', SAND);
  // A standing collar of light for the small things. A person is 1.5 m across on a 27 km island;
  // a flat ring round one, seen from a planner camera at thirty degrees, is a smudge.
  const selCollar = new Band('selection-collar', SEA, true);
  const hovCollar = new Band('hover-collar', SAND, true);

  /** A circle of `seg` points. Reused, never reallocated. */
  const _ring = [];
  function ringPoints(cx, cz, r, seg) {
    while (_ring.length < seg) _ring.push([0, 0]);
    _ring.length = seg;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      _ring[i][0] = cx + Math.cos(a) * r;
      _ring[i][1] = cz + Math.sin(a) * r;
    }
    return _ring;
  }

  /** Metres per pixel at the pivot, so a mark on a person is the same size on screen at any zoom. */
  function scaleAt(x, z) {
    const cam = scene.activeCamera;
    const p = cam.globalPosition || cam.position;
    const y = island ? island.height(x, z) : 0;
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    const h = stage.engine.getRenderHeight() || 900;
    return (2 * Math.tan((cam.fov || 0.8) * 0.5) * d) / h;   // world metres per render pixel
  }

  /** Geometry for whatever is selected. Returns {pts, closed, w, lift} or null. */
  function markFor(kind, id) {
    const p = locate(kind, id);
    if (!p && kind !== 'road' && kind !== 'lake') return null;
    const mpp = p ? scaleAt(p.x, p.z) : 1;

    if (kind === 'road') {
      const e = roadEdge(id);
      if (!e || !e.pts) return null;
      // Narrow enough that the road is still visible underneath it. A highlight that hides the
      // thing it is highlighting is a paint job.
      return { pts: e.pts, closed: false, w: Math.max(e.widthM * 0.26, mpp * 1.5), lift: 0.7 };
    }
    if (kind === 'lake') {
      const lk = island && island.lakes.find((l) => l.id === id);
      if (!lk) return null;
      return { pts: lk.poly, closed: true, w: Math.max(9, mpp * 2.4), lift: 1.4 };
    }
    if (kind === 'cell') {
      const c = island ? island.grid.cell : 32;
      const h = c / 2;
      return {
        pts: [[p.x - h, p.z - h], [p.x + h, p.z - h], [p.x + h, p.z + h], [p.x - h, p.z + h]],
        closed: true, w: Math.max(0.6, mpp * 1.6), lift: 0.4
      };
    }
    if (kind === 'dune') {
      const dn = world.read('dunes');
      const r = dn && dn.reaches && dn.reaches.find((x) => x.id === id);
      const len = r ? Math.min(r.lengthM, 2400) : 600;
      return { pts: ringPoints(p.x, p.z, Math.max(len * 0.32, 90), 40).map((q) => [q[0], q[1]]), closed: true, w: Math.max(2.5, mpp * 2), lift: 0.6 };
    }

    const k = KINDS[kind] || { ring: 4 };
    const r = Math.max(k.ring, mpp * 13);
    const seg = r > 40 ? 56 : 40;
    return {
      pts: ringPoints(p.x, p.z, r, seg).map((q) => [q[0], q[1]]),
      closed: true,
      w: Math.max(0.28, mpp * 1.7),
      lift: p.water ? Math.max(0.4, (island ? island.seaLevel - island.height(p.x, p.z) : 0) + 0.4) : 0.45,
      // Only the small moving things stand up. A collar round a lake would be a fence, and one
      // round a house would stand inside the walls.
      collar: STANDS_UP.has(kind) ? Math.max(2.2, mpp * 34) : 0
    };
  }

  /* ------------------------------------------------------------ the indexes */

  const staticGrid = new Grid(256);
  const movingGrid = new Grid(192);
  let staticReady = false;

  function buildStatic() {
    const R = residents();
    staticGrid.clear();
    if (R) {
      for (const d of R.dwellings) staticGrid.add(d.x, d.z, { kind: 'building', id: d.id, x: d.x, z: d.z });
      for (const b of R.businesses.values()) staticGrid.add(b.x, b.z, { kind: 'business', id: b.id.replace(/^biz:/, ''), x: b.x, z: b.z, place: b });
    }
    const sb = world.read('shorebirds');
    if (sb && sb.roosts) for (const r of sb.roosts) staticGrid.add(r.x, r.z, { kind: 'roost', id: r.id, x: r.x, z: r.z });
    const cm = world.read('contributed');
    if (cm && cm.ready) for (const f of cm.features) staticGrid.add(f.x, f.z, { kind: 'facility', id: f.id, x: f.x, z: f.z });
    staticReady = true;
  }
  // The buildings layer moves every dwelling onto a lot with a road in front of it when the
  // population system is ready, so an index built before that points at the wrong houses.
  for (const ev of ['population:ready', 'household:moved-in', 'household:dissolved',
    'household:left-the-island', 'businesses:ready', 'shorebirds:ready', 'contributed:ready']) {
    world.bus.on(ev, () => { staticReady = false; });
  }

  function buildMoving() {
    const R = residents();
    movingGrid.clear();
    if (R) {
      const people = R.people;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (!p.onIsland) continue;
        movingGrid.add(p.x, p.z, { kind: 'resident', id: p.id, x: p.x, z: p.z });
      }
    }
    for (const [id, c] of world.store.all('visitor')) {
      if (!Number.isFinite(c.x) || (c.x === 0 && c.z === 0)) continue;
      movingGrid.add(c.x, c.z, { kind: 'visitor', id, x: c.x, z: c.z });
    }
    for (const [id, k] of world.store.all('koala')) {
      movingGrid.add(k.x, k.z, { kind: 'koala', id, x: k.x, z: k.z });
    }
    const wh = world.read('whales');
    if (wh && wh.pods) for (const pod of wh.pods) movingGrid.add(pod.x, pod.z, { kind: 'whale', id: pod.id, x: pod.x, z: pod.z, water: true });
    const veh = vehicleList();
    if (veh) for (const v of veh) if (Number.isFinite(v.x)) movingGrid.add(v.x, v.z, { kind: 'vehicle', id: v.id, x: v.x, z: v.z });
    movingGrid.built = performance.now();
  }

  /* ------------------------------------------------------------ the pick */

  const _id = B.Matrix.Identity();
  const _ray = new B.Ray(B.Vector3.Zero(), B.Vector3.Up());
  const _hit = {};
  const _pv = new B.Vector3();
  const _proj = new B.Vector3();
  const _cands = [];

  /**
   * What is under the cursor. `px`, `py` are CSS pixels relative to the canvas.
   * Returns {kind, id, x, z, ground} or null if the ray missed the world entirely.
   */
  function pickAt(px, py) {
    const t0 = performance.now();
    const cam = scene.activeCamera;
    scene.createPickingRayToRef(px, py, _id, _ray, cam);
    const o = _ray.origin, d = _ray.direction;

    let gx, gz, gy, onWater = false;
    const hit = island ? island.raycast(o, d, 60000, _hit) : null;
    if (hit && hit.hit) {
      gx = hit.x; gz = hit.z; gy = hit.y;
    } else {
      // Missed the land. Try the sea surface, so a whale offshore is still clickable.
      const sea = island ? island.seaLevel : 0;
      if (d.y >= -1e-4) return null;
      const t = (sea - o.y) / d.y;
      if (!(t > 0) || t > 6e4) return null;
      gx = o.x + d.x * t; gz = o.z + d.z * t; gy = sea;
      onWater = true;
    }

    // How far around the ground point to look, in metres. Tight when you are down among the houses,
    // wide when the whole island is on screen and a person is a pixel.
    const mpp = scaleAt(gx, gz);
    const radius = clamp(mpp * 90, 30, 1400);

    if (!staticReady) buildStatic();
    if (performance.now() - movingGrid.built > 220) buildMoving();

    _cands.length = 0;
    movingGrid.query(gx, gz, radius, _cands);
    staticGrid.query(gx, gz, radius, _cands);

    // Settle it in screen space. The thing you clicked is the thing nearest your cursor.
    const vp = cam.viewport.toGlobal(stage.engine.getRenderWidth(), stage.engine.getRenderHeight());
    const tm = scene.getTransformMatrix();
    const hs = stage.engine.getHardwareScalingLevel();
    const camPos = cam.globalPosition || cam.position;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < _cands.length; i++) {
      const c = _cands[i];
      const k = KINDS[c.kind];
      if (!k) continue;
      const y = (c.water ? (island ? island.seaLevel : 0) : (island ? island.height(c.x, c.z) : 0))
        + (c.kind === 'building' || c.kind === 'business' ? 2.4
          // A marker's plate is the part of it a cursor is aimed at, and the layer scales the post
          // with distance, so the target moves up as you pull back. Read the scale the layer
          // published rather than guessing at it.
          : c.kind === 'facility' ? 2.3 * ((world.read('contributedlayer') || {}).scale || 1)
            : c.kind === 'whale' ? 0.5 : 0.9);
      _pv.set(c.x, y, c.z);
      // Behind the camera projects to nonsense, so reject it before it can win.
      if ((c.x - camPos.x) * d.x + (y - camPos.y) * d.y + (c.z - camPos.z) * d.z <= 0) continue;
      B.Vector3.ProjectToRef(_pv, _id, tm, vp, _proj);
      const sx = _proj.x * hs, sy = _proj.y * hs;
      const dist = Math.hypot(sx - px, sy - py);
      if (dist > k.px) continue;
      const score = dist * k.weight - k.priority * 0.35;
      if (score < bestScore) { bestScore = score; best = c; }
    }

    let out;
    if (best) {
      out = { kind: best.kind, id: best.id, x: best.x, z: best.z, ground: { x: gx, y: gy, z: gz } };
    } else {
      out = resolvePlace(gx, gz, gy, mpp, onWater);
    }
    state.lastPickMs = performance.now() - t0;
    return out;
  }

  /**
   * No agent, no building. So what is this ground? A road if you clicked one, the lake if you are
   * standing in it, the beach reach if you are on sand, and otherwise the cell itself, which is
   * never a dead end: the inspector can say what grows on it and what is happening to it.
   */
  function resolvePlace(gx, gz, gy, mpp, onWater) {
    const ground = { x: gx, y: gy, z: gz };

    const net = world.read('roadNetwork');
    if (net && typeof net.nearestPoint === 'function') {
      const near = net.nearestPoint(gx, gz);
      if (near && near.distanceM < Math.max(near.edge.widthM * 0.9, mpp * 9)) {
        return { kind: 'road', id: near.edge.id, x: near.x, z: near.z, ground };
      }
    }

    if (island) {
      for (const lk of island.lakes) {
        if (gx < lk.minX || gx > lk.maxX || gz < lk.minZ || gz > lk.maxZ) continue;
        if (pointInPoly(gx, gz, lk.poly)) return { kind: 'lake', id: lk.id, x: lk.x, z: lk.z, ground };
      }
    }

    // A beach, not a suburb. Sixty metres inland of the coastline is sand and dune; past that you
    // are on somebody's street and the ground itself is the better answer. Over a township the
    // looser test claimed a quarter of the frame for the foreshore reach, which is not what a
    // person clicking on a Dunwich back yard means.
    const dn = world.read('dunes');
    if (dn && dn.reaches && island) {
      const shore = island.shoreDistance(gx, gz);
      if (onWater || shore < 60) {
        let best = null, bd = Infinity;
        for (const r of dn.reaches) {
          const q = (r.x - gx) * (r.x - gx) + (r.z - gz) * (r.z - gz);
          if (q < bd) { bd = q; best = r; }
        }
        if (best && bd < 900 * 900) {
          return { kind: 'dune', id: best.id, x: best.x, z: best.z, ground };
        }
      }
    }

    const cell = island ? island.grid.cell : 32;
    const cx = Math.round(gx / cell) * cell;
    const cz = Math.round(gz / cell) * cell;
    return { kind: 'cell', id: `cell:${cx}:${cz}`, x: cx, z: cz, ground };
  }

  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------------------ the tooltip

  It lives here rather than in a panel because it has to answer inside a frame of the pointer
  moving, and panels update at 10 Hz. Nothing but design.css tokens, and it never covers the thing
  it is describing. */

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'status');
  const tipTitle = document.createElement('h5');
  const tipSub = document.createElement('div');
  tipSub.style.color = 'var(--t-dim)';
  tipSub.style.fontSize = 'var(--fs-sm)';
  const tipWhy = document.createElement('div');
  tipWhy.className = 'why';
  tip.append(tipTitle, tipSub, tipWhy);
  const uiRoot = document.getElementById('ui-root') || document.body;
  uiRoot.append(tip);

  function showTip(px, py, info, kind) {
    if (!info) { tip.classList.remove('show'); return; }
    tipTitle.textContent = info.label;
    tipSub.textContent = info.sub || '';
    tipSub.style.display = info.sub ? '' : 'none';
    tipWhy.textContent = info.why || (kind === 'cell' ? 'click to read the ground' : '');
    tipWhy.style.display = tipWhy.textContent ? '' : 'none';
    const r = canvas.getBoundingClientRect();
    const x = r.left + px + 16;
    const y = r.top + py + 18;
    tip.style.left = Math.min(x, window.innerWidth - 340) + 'px';
    tip.style.top = Math.min(y, window.innerHeight - 120) + 'px';
    tip.classList.add('show');
  }

  /* ------------------------------------------------------------ pointer

  The camera owns pan, orbit and zoom on this canvas. A selection has to coexist with that, so a
  click is defined the way a person means it: pointer down and up in nearly the same place, quickly.
  Anything else was a drag and the camera keeps it. */

  let down = null;
  let hoverAt = 0;
  const listeners = [];
  const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); listeners.push(() => el.removeEventListener(type, fn, opts)); };

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  on(canvas, 'pointerdown', (e) => {
    if (e.button !== 0 || e.altKey) { down = null; return; }
    const p = local(e);
    down = { x: p.x, y: p.y, t: performance.now(), id: e.pointerId };
    tip.classList.remove('show');
  });

  on(canvas, 'pointerup', (e) => {
    if (!down || e.pointerId !== down.id) { down = null; return; }
    const p = local(e);
    const moved = Math.hypot(p.x - down.x, p.y - down.y);
    const held = performance.now() - down.t;
    down = null;
    if (moved > 5 || held > 480) return;      // that was a pan, not a click
    const got = pickAt(p.x, p.y);
    state.picks++;
    if (!got) { clear('sky'); return; }
    apply(got.kind, got.id, { x: got.x, z: got.z, water: got.kind === 'whale' }, 'pick');
    if (e.detail >= 2) focus(got.kind, got.id);   // double click flies there
  });

  on(canvas, 'pointerleave', () => { tip.classList.remove('show'); setHover(null); });

  on(canvas, 'pointermove', (e) => {
    if (down) { tip.classList.remove('show'); return; }
    if (e.pointerType === 'touch') return;
    const now = performance.now();
    if (now - hoverAt < 55) return;            // 18 Hz is under a frame of latency and costs nothing
    hoverAt = now;
    const p = local(e);
    const got = pickAt(p.x, p.y);
    if (!got) { setHover(null); showTip(0, 0, null); canvas.style.cursor = ''; return; }
    setHover(got);
    const info = labelOf(got.kind, got.id);
    showTip(p.x, p.y, info, got.kind);
    canvas.style.cursor = got.kind === 'cell' ? '' : 'pointer';
  });

  let hoverMark = null;
  function setHover(got) {
    if (!got) {
      if (state.hover) { state.hover = null; hoverMark = null; hovBand.hide(); }
      return;
    }
    if (state.hover && state.hover.kind === got.kind && state.hover.id === got.id) return;
    const info = labelOf(got.kind, got.id);
    state.hover = { kind: got.kind, id: got.id, label: info ? info.label : '', sub: info ? info.sub : '' };
    hoverMark = got;
    world.bus.emit('selection:hover', state.hover);
  }

  on(window, 'keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (state.kind) clear('escape');
  });

  /* ------------------------------------------------------------ the layer */

  let pulse = 0;
  let lastX = 0, lastZ = 0;

  stage.addLayer({
    id: 'selection',
    order: 88,

    init() {
      selBand.setTint(1);
      hovBand.setTint(0.5);
      selCollar.setTint(0.8);
      hovCollar.setTint(0.3);
    },

    frame(st, w, dt) {
      pulse += dt;

      // The selected mark. Rebuilt when the selection changes, and while the thing is moving.
      if (state.kind) {
        const p = locate(state.kind, state.id);
        if (!p) { selBand.hide(); selCollar.hide(); } else {
          const moved = Math.hypot(p.x - lastX, p.z - lastZ);
          if (markDirty || moved > 0.25 || KINDS[state.kind]) {
            const m = markFor(state.kind, state.id);
            if (m) {
              selBand.set(m.pts, m.closed, m.w, m.lift);
              if (m.collar) selCollar.set(m.pts, m.closed, m.collar, m.lift, true);
              else selCollar.hide();
              lastX = p.x; lastZ = p.z;
            } else { selBand.hide(); selCollar.hide(); }
            markDirty = false;
          }
          // A slow breath, not a strobe. Reduced-motion users get a steady mark.
          const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const a = still ? 0.95 : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(pulse * 2.1));
          selBand.setTint(a);
          selCollar.setTint(a * 0.8);
        }
      } else {
        selBand.hide(); selCollar.hide();
      }

      // The hover mark. Quiet: it is a suggestion, not a decision.
      if (hoverMark && !(state.kind === hoverMark.kind && state.id === hoverMark.id)) {
        const m = markFor(hoverMark.kind, hoverMark.id);
        if (m) {
          hovBand.set(m.pts, m.closed, m.w * 0.8, m.lift);
          hovBand.setTint(0.42);
          if (m.collar) { hovCollar.set(m.pts, m.closed, m.collar * 0.7, m.lift, true); hovCollar.setTint(0.28); }
          else hovCollar.hide();
        } else { hovBand.hide(); hovCollar.hide(); }
      } else {
        hovBand.hide(); hovCollar.hide();
      }
    },

    dispose() {
      for (const off of listeners) { try { off(); } catch (e) { /* gone */ } }
      listeners.length = 0;
      selBand.dispose(); hovBand.dispose(); selCollar.dispose(); hovCollar.dispose();
      tip.remove();
    }
  });
}
