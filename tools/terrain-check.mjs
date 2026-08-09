// Terrain numbers without a GPU: slope statistics, the Point Lookout transect, the cover census
// and the shadow sweep the render layer uses. Run: node tools/terrain-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/+/, '').split('?')[0];
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};
const { World } = await import(pathToFileURL(path.join(ROOT, 'src/kernel/world.js')));
const { loadDataPacks } = await import(pathToFileURL(path.join(ROOT, 'src/world/data.js')));
const { registerIsland } = await import(pathToFileURL(path.join(ROOT, 'src/world/island.js')));
const data = await loadDataPacks();
const w = new World({ seed: 19770614, startISO: '2026-09-19T05:20' });
w.data = data; registerIsland(w); await w.boot();
const isl = w.island, g = isl.grid;
const { nx, nz, cell, height: H } = g;

function slopeStats(minH) {
  const bins = new Array(20).fill(0); let n = 0, maxS = 0, sum = 0;
  for (let j = 2; j < nz - 2; j += 2) for (let i = 2; i < nx - 2; i += 2) {
    const k = j * nx + i; if (H[k] < minH) continue;
    const dx = (H[k + 1] - H[k - 1]) / (2 * cell), dz = (H[k + nx] - H[k - nx]) / (2 * cell);
    const s = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
    bins[Math.min(19, Math.floor(s / 2))]++; n++; sum += s; if (s > maxS) maxS = s;
  }
  let over20 = 0; for (let b = 10; b < 20; b++) over20 += bins[b];
  return { n, mean: sum / n, max: maxS, over20: 100 * over20 / n, bins: bins.map((b) => (100 * b / n).toFixed(1)) };
}
console.log('build ms', isl.buildMs.toFixed(0));
for (const [label, minH] of [['all land', 2], ['dune field above 40 m', 40], ['high dunes above 120 m', 120]]) {
  const s = slopeStats(minH);
  console.log(label.padEnd(24) + 'mean ' + s.mean.toFixed(1) + ' deg  max ' + s.max.toFixed(1)
    + '  over 20 deg ' + s.over20.toFixed(1) + '%   hist ' + s.bins.slice(0, 14).join(' '));
}

const row = [];
for (let lon = 153.5300; lon <= 153.5480; lon += 0.0012) {
  const p = isl.project(lon, -27.4306);
  row.push(lon.toFixed(4) + ' ' + isl.landCover(p.x, p.z) + ' ' + isl.height(p.x, p.z).toFixed(0) + 'm '
    + (isl.slope(p.x, p.z) * 180 / Math.PI).toFixed(0) + 'deg');
}
console.log('Point Lookout transect at lat -27.4306:\n  ' + row.join('\n  '));
for (const [nm, lon, lat] of [['North Gorge', 153.5405, -27.4278], ['North Gorge slot', 153.5450, -27.4347], ['South Gorge', 153.5433, -27.4363]]) {
  const p = isl.project(lon, lat);
  console.log(nm, isl.height(p.x, p.z).toFixed(1) + 'm', (isl.slope(p.x, p.z) * 180 / Math.PI).toFixed(1) + 'deg', isl.landCover(p.x, p.z));
}
const census = {}; let tot = 0;
for (let j = 0; j < nz; j += 3) for (let i = 0; i < nx; i += 3) {
  const c = g.covers[g.cover[j * nx + i]]; census[c] = (census[c] || 0) + 1; tot++;
}
console.log('cover census:', Object.entries(census).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + (100 * v / tot).toFixed(2) + '%').join(', '));

// The same horizon sweep the render layer runs, so the shaded fraction can be checked with no GPU.
const step = 2;
const snx = Math.floor((nx + step - 1) / step), snz = Math.floor((nz + step - 1) / step);
const sc = cell * step;
const sh = new Float32Array(snx * snz);
for (let j = 0; j < snz; j++) for (let i = 0; i < snx; i++) sh[j * snx + i] = H[Math.min(nz - 1, j * step) * nx + Math.min(nx - 1, i * step)];
const S = new Float32Array(snx * snz);
function sweep(azDeg, altDeg) {
  const az = azDeg * Math.PI / 180, alt = altDeg * Math.PI / 180;
  const dx = -Math.sin(az), dz = -Math.cos(az);
  const tanAlt = Math.max(0.012, Math.tan(Math.max(0.004, alt)));
  const si = dx >= 0 ? 1 : -1, sj = dz >= 0 ? 1 : -1;
  const wI = Math.abs(dx) / (Math.abs(dx) + Math.abs(dz) + 1e-6), wJ = 1 - wI;
  const drop = tanAlt * sc * (Math.abs(dx) + Math.abs(dz));
  const i0 = dx >= 0 ? 0 : snx - 1, i1 = dx >= 0 ? snx : -1;
  const j0 = dz >= 0 ? 0 : snz - 1, j1 = dz >= 0 ? snz : -1;
  for (let j = j0; j !== j1; j += sj) {
    const base = j * snx, pj = j - sj, hasJ = pj >= 0 && pj < snz;
    for (let i = i0; i !== i1; i += si) {
      const k = base + i, pi = i - si;
      let up = 0;
      if (pi >= 0 && pi < snx) up += wI * S[k - si]; else up += wI * sh[k];
      if (hasJ) up += wJ * S[pj * snx + i]; else up += wJ * sh[k];
      const carried = up - drop;
      S[k] = carried > sh[k] ? carried : sh[k];
    }
  }
  let shaded = 0, land = 0;
  for (let k = 0; k < sh.length; k++) { if (sh[k] < 1.5) continue; land++; if (S[k] > sh[k] + 0.25) shaded++; }
  return (shaded / land);
}
const t0 = Date.now();
for (const [az, alt] of [[85, 5.7], [77, 18.9], [57, 43.5], [345, 59.9], [291, 31.7], [275, 5.8], [272, 1.0]]) {
  console.log('sun az ' + az + ' alt ' + alt + ' -> shaded land fraction ' + sweep(az, alt).toFixed(3));
}
console.log('7 sweeps in', Date.now() - t0, 'ms at', sc, 'm');

// The cliff, measured perpendicular to the coast rather than along a line of latitude.
{
  const p = isl.project(153.5440, -27.4330);
  let best = 0, bestAt = null;
  for (let dz = -900; dz <= 900; dz += 16) for (let dx = -900; dx <= 900; dx += 16) {
    const x = p.x + dx, z = p.z + dz;
    const s = isl.slope(x, z) * 180 / Math.PI;
    if (s > best && isl.landCover(x, z) === 'rock') { best = s; bestAt = isl.unproject(x, z); }
  }
  console.log('steepest rock face within 900 m of the Gorge: ' + best.toFixed(1) + ' deg at '
    + bestAt.lon.toFixed(4) + ', ' + bestAt.lat.toFixed(4));
  const prof = [];
  for (let d = 0; d <= 220; d += 20) {
    const x = p.x - d * 0.72, z = p.z + d * 0.69;   // inland, roughly normal to the coast here
    prof.push(d + 'm ' + isl.height(x, z).toFixed(1));
  }
  console.log('profile inland from the Gorge:', prof.join('  '));
}
