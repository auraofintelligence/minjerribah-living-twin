// Entity store. Sparse component maps with tag indexes and dirty tracking.
// Deliberately simple: systems own their component data, the store owns identity and lookup.

export class Store {
  constructor() {
    this._nextId = 1;
    this.alive = new Set();
    this.components = new Map(); // name -> Map<id, data>
    this.tags = new Map(); // tag -> Set<id>
    this.meta = new Map(); // id -> {kind, name}
    this._byKind = new Map(); // kind -> Set<id>
    this._listeners = { create: [], destroy: [] };
  }

  create(kind = 'entity', name = null) {
    const id = this._nextId++;
    this.alive.add(id);
    this.meta.set(id, { kind, name });
    let set = this._byKind.get(kind);
    if (!set) this._byKind.set(kind, (set = new Set()));
    set.add(id);
    for (const fn of this._listeners.create) fn(id, kind);
    return id;
  }

  destroy(id) {
    if (!this.alive.has(id)) return;
    for (const fn of this._listeners.destroy) fn(id);
    const m = this.meta.get(id);
    if (m) {
      const set = this._byKind.get(m.kind);
      if (set) set.delete(id);
    }
    for (const map of this.components.values()) map.delete(id);
    for (const set of this.tags.values()) set.delete(id);
    this.meta.delete(id);
    this.alive.delete(id);
  }

  onCreate(fn) { this._listeners.create.push(fn); }
  onDestroy(fn) { this._listeners.destroy.push(fn); }

  /** Attach or replace component data. */
  set(id, comp, data) {
    let map = this.components.get(comp);
    if (!map) this.components.set(comp, (map = new Map()));
    map.set(id, data);
    return data;
  }
  get(id, comp) {
    const map = this.components.get(comp);
    return map ? map.get(id) : undefined;
  }
  has(id, comp) {
    const map = this.components.get(comp);
    return !!map && map.has(id);
  }
  remove(id, comp) {
    const map = this.components.get(comp);
    if (map) map.delete(id);
  }
  /** All [id, data] for a component. Hot path: returns the live Map. */
  all(comp) {
    let map = this.components.get(comp);
    if (!map) this.components.set(comp, (map = new Map()));
    return map;
  }
  count(comp) {
    const map = this.components.get(comp);
    return map ? map.size : 0;
  }

  /** Entities with every listed component. */
  query(...comps) {
    if (comps.length === 0) return [];
    const maps = comps.map((c) => this.all(c));
    maps.sort((a, b) => a.size - b.size);
    const out = [];
    outer: for (const id of maps[0].keys()) {
      for (let i = 1; i < maps.length; i++) if (!maps[i].has(id)) continue outer;
      out.push(id);
    }
    return out;
  }

  tag(id, t) {
    let set = this.tags.get(t);
    if (!set) this.tags.set(t, (set = new Set()));
    set.add(id);
  }
  untag(id, t) {
    const set = this.tags.get(t);
    if (set) set.delete(id);
  }
  tagged(t) {
    return this.tags.get(t) || new Set();
  }
  hasTag(id, t) {
    const set = this.tags.get(t);
    return !!set && set.has(id);
  }

  kind(id) {
    const m = this.meta.get(id);
    return m ? m.kind : null;
  }
  name(id) {
    const m = this.meta.get(id);
    return m ? m.name : null;
  }
  ofKind(kind) {
    return this._byKind.get(kind) || new Set();
  }

  stats() {
    const comps = {};
    for (const [k, v] of this.components) comps[k] = v.size;
    const kinds = {};
    for (const [k, v] of this._byKind) kinds[k] = v.size;
    return { entities: this.alive.size, components: comps, kinds };
  }

  serialise() {
    const comps = {};
    for (const [name, map] of this.components) comps[name] = Array.from(map.entries());
    return {
      nextId: this._nextId,
      meta: Array.from(this.meta.entries()),
      kinds: Array.from(this._byKind.entries()).map(([k, v]) => [k, Array.from(v)]),
      tags: Array.from(this.tags.entries()).map(([k, v]) => [k, Array.from(v)]),
      components: comps
    };
  }

  deserialise(s) {
    this._nextId = s.nextId;
    this.alive = new Set(s.meta.map(([id]) => id));
    this.meta = new Map(s.meta);
    this._byKind = new Map(s.kinds.map(([k, v]) => [k, new Set(v)]));
    this.tags = new Map(s.tags.map(([k, v]) => [k, new Set(v)]));
    this.components = new Map();
    for (const [name, entries] of Object.entries(s.components)) {
      this.components.set(name, new Map(entries));
    }
  }
}
