// Rolling perf and counters. The point is that a critic agent can ask the running build
// "what is slow, what is broken, what has actually happened" without trusting a builder's summary.

export class Telemetry {
  constructor(window = 120) {
    this.window = window;
    this.series = new Map(); // key -> {samples:[], total, n, max}
    this.counters = new Map();
    this.frames = [];
    this.marks = [];
  }

  record(key, ms) {
    let s = this.series.get(key);
    if (!s) this.series.set(key, (s = { samples: [], total: 0, n: 0, max: 0 }));
    s.samples.push(ms);
    if (s.samples.length > this.window) s.samples.shift();
    s.total += ms;
    s.n++;
    if (ms > s.max) s.max = ms;
  }

  count(key, by = 1) {
    this.counters.set(key, (this.counters.get(key) || 0) + by);
  }

  frame(ms) {
    this.frames.push(ms);
    if (this.frames.length > 240) this.frames.shift();
  }

  mark(label) {
    this.marks.push({ label, at: performance.now() });
    if (this.marks.length > 200) this.marks.shift();
  }

  get fps() {
    if (!this.frames.length) return 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  get fps1PercentLow() {
    if (this.frames.length < 20) return 0;
    const sorted = this.frames.slice().sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.01)));
    const avg = worst.reduce((a, b) => a + b, 0) / worst.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  summary(topN = 12) {
    const rows = [];
    for (const [key, s] of this.series) {
      const recent = s.samples.reduce((a, b) => a + b, 0) / Math.max(1, s.samples.length);
      rows.push({ key, avgMs: +recent.toFixed(3), maxMs: +s.max.toFixed(3), n: s.n });
    }
    rows.sort((a, b) => b.avgMs - a.avgMs);
    return {
      fps: +this.fps.toFixed(1),
      fps1Low: +this.fps1PercentLow.toFixed(1),
      frameMs: this.frames.length ? +(this.frames.reduce((a, b) => a + b, 0) / this.frames.length).toFixed(2) : 0,
      hottest: rows.slice(0, topN),
      counters: Object.fromEntries(this.counters)
    };
  }
}
