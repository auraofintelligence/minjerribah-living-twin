// The World is the single object every system attaches to. Systems never import one another.
// They read/write the store, publish on the bus, and expose a read model for the UI.

import { Bus } from './bus.js';
import { Store } from './store.js';
import { Clock } from './clock.js';
import { RngPool } from './rng.js';
import { Telemetry } from './telemetry.js';

/**
 * Tick phases run in this order every tick. A system declares one phase.
 * Ordering is the whole contract for determinism: within a phase, systems run by
 * ascending `order`, then by id, so registration order never changes results.
 */
export const PHASES = [
  'environment', // tide, weather, light, fire danger, swell
  'ecology',     // species populations, whales, koalas, water quality, dune health
  'infrastructure', // power, water, waste, ferry, roads, the subterranean works
  'economy',     // businesses, jobs, prices, tourism spend, the C-hour ledger
  'agents',      // residents and visitors: needs, decisions, schedules
  'movement',    // pathing, vehicles, crowds
  'civic',       // policy effects, council, consultation, approvals
  'narrative',   // drama director, events, storylines
  'presentation' // read models for UI and render sync
];

export class World {
  constructor(opts = {}) {
    this.seed = opts.seed >>> 0 || 19770614;
    this.bus = new Bus();
    this.store = new Store();
    this.clock = new Clock(opts.startISO);
    this.rng = new RngPool(this.seed);
    this.telemetry = new Telemetry();
    this.data = {};           // static data packs, loaded before boot
    this.systems = [];        // {id, phase, order, tick, init, ...}
    this._byId = new Map();
    this.state = {};          // shared read models, namespaced by system id
    this.flags = new Set(opts.flags || []);
    this.booted = false;
    this.paused = false;
    this.errors = [];
  }

  /**
   * @param {{id:string, phase:string, order?:number, init?:Function, tick?:Function,
   *          lateTick?:Function, save?:Function, load?:Function, describe?:Function}} sys
   */
  register(sys) {
    if (!sys.id) throw new Error('system needs an id');
    if (!PHASES.includes(sys.phase)) throw new Error(`unknown phase ${sys.phase} for ${sys.id}`);
    if (this._byId.has(sys.id)) throw new Error(`duplicate system id ${sys.id}`);
    sys.order = sys.order ?? 100;
    this._byId.set(sys.id, sys);
    this.systems.push(sys);
    this.systems.sort((a, b) => {
      const pa = PHASES.indexOf(a.phase), pb = PHASES.indexOf(b.phase);
      if (pa !== pb) return pa - pb;
      if (a.order !== b.order) return a.order - b.order;
      return a.id < b.id ? -1 : 1;
    });
    return sys;
  }

  system(id) { return this._byId.get(id); }

  /** Namespaced shared state. Systems publish here; UI and other systems read. */
  publish(id, obj) {
    this.state[id] = obj;
    return obj;
  }
  read(id) { return this.state[id]; }

  async boot() {
    for (const sys of this.systems) {
      if (!sys.init) continue;
      const t0 = performance.now();
      try {
        await sys.init(this);
      } catch (e) {
        this.errors.push({ system: sys.id, phase: 'init', message: String(e && e.message || e), stack: e && e.stack });
        console.error(`[world] init failed: ${sys.id}`, e);
      }
      this.telemetry.record('init:' + sys.id, performance.now() - t0);
    }
    this.booted = true;
    this.bus.emit('world:booted', { systems: this.systems.length });
  }

  /** One deterministic simulation step. */
  step() {
    this.clock.advance();
    const ctx = this;
    for (const sys of this.systems) {
      if (!sys.tick) continue;
      const t0 = performance.now();
      try {
        sys.tick(ctx);
      } catch (e) {
        this.errors.push({ system: sys.id, phase: 'tick', tick: this.clock.tick, message: String(e && e.message || e), stack: e && e.stack });
        console.error(`[world] tick failed: ${sys.id}`, e);
        sys.tick = null; // a system that throws is disabled rather than allowed to spam
      }
      this.telemetry.record('tick:' + sys.id, performance.now() - t0);
    }
    this.bus.emit('world:tick', { tick: this.clock.tick });
  }

  /** Called once per rendered frame, after any steps. For interpolation and smooth reads. */
  frame(dtSeconds) {
    for (const sys of this.systems) {
      if (!sys.frame) continue;
      try {
        sys.frame(this, dtSeconds);
      } catch (e) {
        this.errors.push({ system: sys.id, phase: 'frame', message: String(e && e.message || e) });
        sys.frame = null;
      }
    }
  }

  /** Run n ticks with no rendering. Used by headless tests and by fast-forward. */
  run(ticks) {
    for (let i = 0; i < ticks; i++) this.step();
    return this;
  }

  save() {
    const out = { version: 4, seed: this.seed, clock: this.clock.save(), rng: this.rng.save(), store: this.store.serialise(), systems: {} };
    for (const sys of this.systems) {
      if (sys.save) {
        try { out.systems[sys.id] = sys.save(this); } catch (e) { console.error('save failed', sys.id, e); }
      }
    }
    return out;
  }

  load(snapshot) {
    this.seed = snapshot.seed;
    this.clock.restore(snapshot.clock);
    this.rng.restore(snapshot.rng);
    this.store.deserialise(snapshot.store);
    for (const sys of this.systems) {
      if (sys.load && snapshot.systems[sys.id] !== undefined) {
        try { sys.load(this, snapshot.systems[sys.id]); } catch (e) { console.error('load failed', sys.id, e); }
      }
    }
    this.bus.emit('world:loaded', {});
  }

  /** Machine-readable snapshot for the critic tooling. Never used by gameplay. */
  probe() {
    const sys = {};
    for (const s of this.systems) {
      sys[s.id] = s.describe ? safe(() => s.describe(this)) : { phase: s.phase };
    }
    return {
      tick: this.clock.tick,
      time: this.clock.format(),
      date: this.clock.formatDate(),
      season: this.clock.season.name,
      store: this.store.stats(),
      events: this.bus.types(),
      errors: this.errors.slice(-20),
      perf: this.telemetry.summary(),
      systems: sys,
      state: this.state
    };
  }
}

function safe(fn) {
  try { return fn(); } catch (e) { return { error: String(e && e.message || e) }; }
}
