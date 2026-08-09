// Deterministic RNG. Every stochastic system takes a named stream so replays are exact.
// Two runs with the same seed and the same inputs must produce the same island.

function splitmix32(a) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = splitmix32(this.seed);
    this._calls = 0;
  }
  float() {
    this._calls++;
    return this._next();
  }
  range(min, max) {
    return min + this.float() * (max - min);
  }
  int(minInclusive, maxExclusive) {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }
  bool(p = 0.5) {
    return this.float() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.float() * arr.length)];
  }
  /** Weighted pick. items: [{weight, ...}] or parallel weights array. */
  weighted(items, weightFn = (i) => i.weight) {
    let total = 0;
    for (const it of items) total += weightFn(it) || 0;
    if (total <= 0) return items[0];
    let r = this.float() * total;
    for (const it of items) {
      r -= weightFn(it) || 0;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** Box-Muller normal. */
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.float());
    const v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Derive a child stream. Same name always yields the same child. */
  fork(name) {
    return new Rng(hashString(name) ^ this.seed);
  }
  save() {
    return { seed: this.seed, calls: this._calls };
  }
  restore(state) {
    this.seed = state.seed >>> 0;
    this._next = splitmix32(this.seed);
    this._calls = 0;
    for (let i = 0; i < state.calls; i++) this._next();
    this._calls = state.calls;
  }
}

/** Registry of named streams, so system A drawing numbers never desyncs system B. */
export class RngPool {
  constructor(masterSeed) {
    this.masterSeed = masterSeed >>> 0;
    this.streams = new Map();
  }
  stream(name) {
    let s = this.streams.get(name);
    if (!s) {
      s = new Rng(hashString(name) ^ this.masterSeed);
      this.streams.set(name, s);
    }
    return s;
  }
  save() {
    const out = {};
    for (const [k, v] of this.streams) out[k] = v.save();
    return { masterSeed: this.masterSeed, streams: out };
  }
  restore(state) {
    this.masterSeed = state.masterSeed >>> 0;
    this.streams.clear();
    for (const [k, v] of Object.entries(state.streams || {})) {
      const s = new Rng(hashString(k) ^ this.masterSeed);
      s.restore(v);
      this.streams.set(k, s);
    }
  }
}

export { hashString };

/** Value noise + fBm, deterministic from a seed. Used by terrain, weather, ecology. */
export function makeNoise2D(seed) {
  const perm = new Uint8Array(512);
  const r = new Rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r.float() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (hash, x, y) => {
    switch (hash & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);

  function noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  noise.fbm = function (x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
  noise.ridged = function (x, y, octaves = 5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(noise(x * freq, y * freq)));
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  return noise;
}
