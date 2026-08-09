// Event bus. Systems never import each other; they talk through here.
// Events are recorded to a ring buffer so the critic tooling can read what the world actually did.

export class Bus {
  constructor(historySize = 4096) {
    this._handlers = new Map();
    this._any = [];
    this.history = [];
    this.historySize = historySize;
    this.counts = new Map();
  }

  on(type, fn) {
    let list = this._handlers.get(type);
    if (!list) this._handlers.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  onAny(fn) {
    this._any.push(fn);
    return () => {
      const i = this._any.indexOf(fn);
      if (i >= 0) this._any.splice(i, 1);
    };
  }

  off(type, fn) {
    const list = this._handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload = {}) {
    this.counts.set(type, (this.counts.get(type) || 0) + 1);
    this.history.push({ type, payload, t: payload && payload.__t });
    if (this.history.length > this.historySize) this.history.shift();
    const list = this._handlers.get(type);
    if (list) {
      // copy: handlers may unsubscribe during dispatch
      for (const fn of list.slice()) {
        try {
          fn(payload, type);
        } catch (e) {
          console.error('[bus] handler failed for', type, e);
        }
      }
    }
    for (const fn of this._any.slice()) {
      try {
        fn(payload, type);
      } catch (e) {
        console.error('[bus] any-handler failed for', type, e);
      }
    }
  }

  /** Introspection for tests and critics. */
  recent(type, n = 20) {
    const out = [];
    for (let i = this.history.length - 1; i >= 0 && out.length < n; i--) {
      if (!type || this.history[i].type === type) out.push(this.history[i]);
    }
    return out;
  }
  types() {
    return Object.fromEntries(this.counts);
  }
}
