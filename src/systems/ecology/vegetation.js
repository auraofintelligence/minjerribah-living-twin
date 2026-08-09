// Vegetation. The plant communities of Minjerribah, and the four things that decide what they are:
// fire, water, weeds and time.
//
// This is the bottom of the ecology stack. Fuel for the fire system, food trees for the koalas,
// spinifex for the dunes, she-oak cones for the glossy black-cockatoos, sedge beds for the acid
// frogs: all of it is grown here, on a 256 m grid, one day at a time.
//
// WHAT THE ISLAND ACTUALLY DOES, and what this file has to get right:
//
//   * The wallum needs fire. Wallum banksia is serotinous: the woody cone holds the seed until a
//     fire opens it. Burn it before it has built a seed store and the store is spent for nothing.
//     Stop burning it altogether and the shrubs senesce, the canopy closes, the fuel piles up, and
//     the community goes a different way. Both failures are slow and both are reachable here.
//     (data/ecology.json proc-fire-regime: target interval 7 to 15 years, a modelling placeholder.)
//   * Black she-oak takes years to bear cones again after fire, and the glossy black-cockatoo eats
//     almost nothing else. Burn the same block twice too close together and the cockatoos are gone
//     for years. That is the second-order consequence the fire lever needs, and it is published.
//   * Seventy per cent of the island's bushland burnt in the 2013 to 2014 fires: 16,800 hectares
//     from a single lightning strike starting 29 December 2013. The island the player arrives on
//     in 2026 is still the island that had that fire, so the initial mosaic is built from it.
//   * Eighteen Mile Swamp sits on peat. Fire in peat, on a low water table, smoulders and takes the
//     seed bank with it, and the swamp does not come back on a decade timescale.
//
// CULTURAL HANDLING. data/ecology.json proc-fire-regime carries this rule and it is followed here:
// "Fire practice is Quandamooka knowledge. Model the ecological effect; do not depict, name or
// invent the practice." This file models burns as area, intensity and interval, and nothing else.
// It does not name, describe, schedule, attribute or depict anybody's fire practice.
//
// Determinism: world.rng.stream('vegetation'). No Math.random, no Date.now.

import {
  clamp, smoothstep, daysSinceISO, absDay,
  ecoGrid, cellsWithin, distanceField, levers, metric, DailyRing, EventLog
} from './ecology-common.js';

/* ------------------------------------------------------------------ the communities

Ten communities, keyed to the habitats in data/ecology.json and drawn from the island's own land
cover so a cell is whatever the heightfield says it is. `litter` and `decay` are the two numbers
that decide a fuel load: an Olson steady state of litter over decay, in tonnes a hectare. */

const COMMUNITIES = [
  {
    id: 'wallum', label: 'Wallum heath', habitat: 'hab-wallum-heath',
    carriesFire: true, litter: 3.6, decay: 0.225, fuelPeak: 22,
    fireBand: [7, 15],          // years: the interval this community is built for
    senesceY: 28,               // beyond this, no fire is its own problem
    foodTreeCap: 0.42,          // koala food trees: scattered scribbly gum and swamp mahogany
    sheoakShare: 0.55,          // how much black she-oak the community carries
    hollowCap: 0.35,
    weedProne: 0.55,
    note: 'Fire adapted and fire dependent. Serotinous banksia over sedge, tea-tree and paperbark.'
  },
  {
    id: 'forest', label: 'High dune eucalypt forest', habitat: 'hab-eucalypt-forest',
    carriesFire: true, litter: 5.4, decay: 0.27, fuelPeak: 28,
    fireBand: [8, 22], senesceY: 45,
    foodTreeCap: 1.0, sheoakShare: 0.75, hollowCap: 1.0, weedProne: 0.35,
    note: 'Scribbly gum over blackbutt, bloodwood and blue gum. Koala and glider country.'
  },
  {
    id: 'swamp', label: 'Eighteen Mile Swamp and wallum sedgeland', habitat: 'hab-eighteen-mile-swamp',
    carriesFire: true, litter: 4.8, decay: 0.36, fuelPeak: 26,
    fireBand: [15, 40], senesceY: 70,
    foodTreeCap: 0.72, sheoakShare: 0.10, hollowCap: 0.5, weedProne: 0.25,
    peat: true,
    note: 'Sedge and paperbark on peat, fed by the water table. Swamp mahogany is a koala food tree.'
  },
  {
    id: 'acid-wetland', label: 'Acid ephemeral wetland', habitat: 'hab-acid-wetland',
    carriesFire: true, litter: 3.0, decay: 0.4, fuelPeak: 14,
    fireBand: [10, 30], senesceY: 60,
    foodTreeCap: 0.2, sheoakShare: 0.05, hollowCap: 0.15, weedProne: 0.2,
    note: 'Shallow low-pH sedge beds inside the wallum. The acid frogs breed here and little else can.'
  },
  {
    id: 'foredune', label: 'Foredune', habitat: 'hab-foredune',
    carriesFire: false, litter: 0.9, decay: 0.5, fuelPeak: 4,
    fireBand: [0, 0], senesceY: 999,
    foodTreeCap: 0.05, sheoakShare: 0.2, hollowCap: 0.05, weedProne: 0.8,
    note: "Spinifex, goat's foot and pigface binding the sand. Trampled cover is lost dune."
  },
  {
    id: 'littoral', label: 'Littoral rainforest at Myora', habitat: 'hab-littoral-rainforest',
    carriesFire: false, litter: 6.5, decay: 0.75, fuelPeak: 16,
    fireBand: [0, 0], senesceY: 999,
    foodTreeCap: 0.25, sheoakShare: 0.02, hollowCap: 0.85, weedProne: 0.95,
    note: 'The only closed forest on the island, on the spring-fed ground at Myora. Fire kills it.'
  },
  {
    id: 'rehab', label: 'Mine path rehabilitation regrowth', habitat: 'hab-rehabilitating-minesite',
    carriesFire: true, litter: 3.2, decay: 0.3, fuelPeak: 18,
    fireBand: [12, 30], senesceY: 55,
    foodTreeCap: 0.3, sheoakShare: 0.3, hollowCap: 0.04, weedProne: 0.7,
    note: 'Even-aged planted regrowth. No hollows for decades, which is the part rehabilitation cannot rush.'
  },
  {
    id: 'headland', label: 'Headland scrub', habitat: 'hab-rocky-headland',
    carriesFire: true, litter: 2.4, decay: 0.35, fuelPeak: 11,
    fireBand: [12, 35], senesceY: 60,
    foodTreeCap: 0.08, sheoakShare: 0.25, hollowCap: 0.15, weedProne: 0.85,
    note: 'Pandanus, wattle and tea-tree on the only rock on the island.'
  },
  {
    id: 'mangrove', label: 'Mangrove and saltmarsh', habitat: 'hab-mangrove-saltmarsh',
    carriesFire: false, litter: 4.0, decay: 1.2, fuelPeak: 5,
    fireBand: [0, 0], senesceY: 999,
    foodTreeCap: 0.02, sheoakShare: 0, hollowCap: 0.2, weedProne: 0.4,
    note: 'The western fringe. Holds the mud, takes the punch out of a surge, nurses the fish.'
  },
  {
    id: 'township', label: 'Township and garden interface', habitat: 'hab-township-interface',
    carriesFire: true, litter: 2.0, decay: 0.5, fuelPeak: 9,
    fireBand: [0, 0], senesceY: 999,
    foodTreeCap: 0.34, sheoakShare: 0.15, hollowCap: 0.55, weedProne: 1.0,
    note: 'Yards, verges and road corridors. Where the koalas meet the cars and the weeds get out.'
  }
];
const COM = {};
for (let i = 0; i < COMMUNITIES.length; i++) COM[COMMUNITIES[i].id] = i;

/** Which community a land cover class becomes. Anything not listed carries no vegetation. */
const COVER_TO_COMMUNITY = {
  heath: 'wallum',
  forest: 'forest',
  swamp: 'swamp',
  foredune: 'foredune',
  rehab: 'rehab',
  rock: 'headland',
  mangrove: 'mangrove',
  saltmarsh: 'mangrove',
  cleared: 'township',
  urban: 'township'
};

/* The nine weeds in data/ecology.json, grouped by where they actually get in. The pack names the
   spread vector for the first two; the rest are recorded without one and are not given one here. */
const WEEDS = [
  { id: 'weed-asparagus-fern', name: 'Asparagus fern', into: ['township', 'littoral', 'foredune'], vector: 'birds and garden dumping' },
  { id: 'weed-easter-cassia', name: 'Easter cassia', into: ['township', 'foredune'], vector: 'spread by rainbow lorikeets feeding on it' },
  { id: 'weed-umbrella-tree', name: 'Umbrella tree', into: ['township', 'littoral'], vector: 'birds' },
  { id: 'weed-broad-leaf-pepper', name: 'Broad-leaf pepper tree', into: ['township', 'mangrove'], vector: null },
  { id: 'weed-ochna', name: 'Ochna', into: ['township'], vector: null },
  { id: 'weed-mother-of-millions', name: 'Mother of millions', into: ['township'], vector: null },
  { id: 'weed-glory-lily', name: 'Glory lily', into: ['foredune', 'township'], vector: null },
  { id: 'weed-brazilian-cherry', name: 'Brazilian cherry', into: ['township', 'littoral'], vector: null },
  { id: 'weed-bitou-lantana-groundsel', name: 'Bitou bush, lantana and groundsel bush', into: ['foredune', 'township', 'mangrove'], vector: null }
];

const YEAR = 365.25;

export function registerVegetation(world) {
  const rng = world.rng.stream('vegetation');
  const L = levers(world);

  const state = world.publish('vegetation', {
    ready: false,
    source: 'data/ecology.json habitats, plants, weeds and proc-fire-regime; land cover from the island heightfield',
    cellM: 0, cells: 0, vegetatedHa: 0, bushlandHa: 0,
    communities: [],
    fuelMeanTHa: 0, fuelNearTownshipTHa: 0, curing: 0,
    meanTimeSinceFireY: 0, unburntRefugeShare: 0, longUnburntShare: 0,
    wallumCondition: 0, forestCondition: 0, swampCondition: 0, foreduneCover: 0,
    sheoakCrop: 0, nestHollowIndex: 0, glossyBlackCockatooIndex: 0,
    foodTreeIndex: 0, hollowIndex: 0,
    weedLoad: 0, weedFront: [],
    burnProgramme: { dial: 0, targetHaPerYear: 0, burntThisSeasonHa: 0, rotationYears: 0, verdict: '',
      season: false, daysBurnableThisSeason: 0, lastSeason: null, lastBurn: null },
    burns: { plannedRolling365Ha: 0, wildfireRolling365Ha: 0, count365: 0 },
    smokeOverTownship: 0,
    fireSource: 'no fire system loaded',
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  /* ---- fields, built once ---- */

  let g = null;                 // the 256 m ecology grid
  let cellIdx = null;           // compact index -> grid cell index
  let com = null;               // compact index -> community index
  let tsf = null;               // days since last fire
  let fuel = null;              // tonnes a hectare
  let seedStore = null;         // 0..1 serotinous seed store
  let sheoak = null;            // 0..1 she-oak cone crop
  let foodTree = null;          // 0..1 koala food tree density
  let hollow = null;            // 0..1 hollow-bearing tree index
  let weed = null;              // 0..1
  let integrity = null;         // 0..1 how much this cell is still the community it should be
  let moisture = null;          // 0..1
  let townDist = null;          // metres to the nearest built-up cell, per grid cell
  let nCells = 0;
  let cellToCompact = null;     // grid cell index -> compact index, or -1

  const burnLog = new EventLog(30);
  const plannedRing = new DailyRing(365);
  const wildRing = new DailyRing(365);
  const seenScars = new Set();
  const areaHa = [];
  let bushlandHa = 0, vegetatedHa = 0;
  let burntThisSeasonHa = 0;
  let lastBurnDay = -1;
  let lastRollDay = -1;
  let smoke = 0;
  let seasonDaysSeen = 0;
  let seasonDaysBurnable = 0;
  let lastSeason = { daysSeen: 0, daysBurnable: 0, burntHa: 0, targetHa: 0 };

  const notes = state.notes;

  /* ---------------------------------------------------------------- build */

  function build(w) {
    g = ecoGrid(w);
    if (!g.ready) { notes.push('no island: nothing to grow.'); return false; }

    const compact = [];
    cellToCompact = new Int32Array(g.n).fill(-1);
    const myora = { x: (153.4166 - 153.47) * 98683, z: (-27.4777 + 27.56) * 110950 };

    for (let q = 0; q < g.land.length; q++) {
      const k = g.land[q];
      const cover = g.coverOf(k);
      let cid = COVER_TO_COMMUNITY[cover];
      if (!cid) continue;
      const x = g.xOf(k), z = g.zOf(k);
      // The littoral rainforest pocket at Myora Springs. data/ecology.json puts it there and
      // nowhere else on the island, so it is placed by distance from the published spring and
      // is not scattered anywhere a rule might otherwise put it.
      if ((cid === 'wallum' || cid === 'forest') && Math.hypot(x - myora.x, z - myora.z) < 750) cid = 'littoral';
      // Acid ephemeral wetland: the low, flat, wet ground inside the wallum, away from the swamp
      // proper. It is the frog breeding habitat and it behaves differently to the heath around it.
      if (cid === 'wallum' && g.height[k] < g.seaLevel + 26 && g.slopeDeg[k] < 3.0 && g.shore[k] > 700) cid = 'acid-wetland';
      cellToCompact[k] = compact.length;
      compact.push({ k, c: COM[cid] });
    }

    nCells = compact.length;
    cellIdx = new Int32Array(nCells);
    com = new Uint8Array(nCells);
    for (let i = 0; i < nCells; i++) { cellIdx[i] = compact[i].k; com[i] = compact[i].c; }

    tsf = new Float32Array(nCells);
    fuel = new Float32Array(nCells);
    seedStore = new Float32Array(nCells);
    sheoak = new Float32Array(nCells);
    foodTree = new Float32Array(nCells);
    hollow = new Float32Array(nCells);
    weed = new Float32Array(nCells);
    integrity = new Float32Array(nCells);
    moisture = new Float32Array(nCells);

    townDist = distanceField(g, (k) => {
      const c = g.covers[g.cover[k]];
      return c === 'urban' || c === 'cleared';
    });

    for (let i = 0; i < COMMUNITIES.length; i++) areaHa[i] = 0;
    for (let i = 0; i < nCells; i++) areaHa[com[i]] += g.cellHa;
    vegetatedHa = 0; bushlandHa = 0;
    for (let i = 0; i < COMMUNITIES.length; i++) {
      vegetatedHa += areaHa[i];
      if (COMMUNITIES[i].carriesFire && COMMUNITIES[i].id !== 'township') bushlandHa += areaHa[i];
    }
    return true;
  }

  /* ---------------------------------------------------------------- the fire history

  The island in 2026 is the island that burnt in 2013 to 2014. Seventy per cent of its bushland
  went in just over two weeks from a single lightning strike, and everything about the vegetation
  the player meets follows from that: an even-aged wallum thirteen years old, a she-oak crop that
  has had time to come back once, and a thirty per cent unburnt remnant that is where the ground
  mammals survived. The mosaic is built from the published event, then twelve years of planned
  burning at the modelled rate are laid over it so the map is patchy rather than uniform. */

  function seedHistory(w) {
    const fireDay = daysSinceISO(w.clock, '2013-12-29');
    const bigFire = fireDay > 0 && fireDay < 60 * YEAR;
    // A coherent patch, not salt and pepper: the 2013 fire ran as one front over two weeks.
    const wob = (x, z) => Math.sin(x / 2300 + 1.7) * Math.cos(z / 3100 - 0.4) + 0.55 * Math.sin((x + z) / 1450);
    for (let i = 0; i < nCells; i++) {
      const C = COMMUNITIES[com[i]];
      if (!C.carriesFire) { tsf[i] = 60 * YEAR; continue; }
      const k = cellIdx[i];
      const x = g.xOf(k), z = g.zOf(k);
      const burnt = bigFire && (wob(x, z) + rng.range(-0.55, 0.55) > -0.62);   // about seventy per cent
      if (burnt) {
        tsf[i] = fireDay + rng.range(0, 16);        // the fire ran for just over two weeks
      } else {
        tsf[i] = rng.range(15, 46) * YEAR;          // the long-unburnt remnant
      }
    }
    // Fuel has to exist before a burn can be laid over the top of it, because a planned burn that
    // finds no fuel does not carry and this model says so.
    settle();

    // Twelve years of planned burning since, at the modelled rate, so the mosaic has grain.
    const dial = burnDial();
    const perYear = bushlandHa * burnShare(dial);
    for (let yearsAgo = 11; yearsAgo >= 1; yearsAgo--) {
      let placed = 0;
      let guard = 0;
      while (placed < perYear && guard++ < 200) {
        const i = pickBurnCell(true);
        if (i < 0) break;
        const ha = rng.range(45, 240);
        const r = Math.sqrt((ha * 10000) / Math.PI);
        placed += applyBurn(w, g.xOf(cellIdx[i]), g.zOf(cellIdx[i]), r, 0.45, 'planned', yearsAgo * YEAR + rng.range(0, 120), true);
      }
    }
    settle();
  }

  /**
   * Set every recovery curve to what its time since fire implies, rather than spinning the model
   * up for a decade of ticks at boot. Four clocks at four speeds: the seed store fills in about
   * four years, the she-oak crop in three and a half, the food trees in eleven, the hollows in
   * fifty-five, and everything downstream follows from the gaps between those numbers.
   */
  function settle() {
    for (let i = 0; i < nCells; i++) {
      const C = COMMUNITIES[com[i]];
      const y = tsf[i] / YEAR;
      const k = cellIdx[i];
      fuel[i] = (C.litter / C.decay) * (1 - Math.exp(-C.decay * y));
      seedStore[i] = C.carriesFire ? clamp(1 - Math.exp(-y / 4.2), 0, 1) : 1;
      sheoak[i] = clamp(1 - Math.exp(-y / 3.4), 0, 1);
      foodTree[i] = Math.min(C.foodTreeCap,
        C.foodTreeCap * clamp(0.55 + 0.45 * (1 - Math.exp(-y / 9)), 0, 1) * rng.range(0.72, 1.15));
      hollow[i] = C.hollowCap * clamp(1 - Math.exp(-y / 55), 0, 1);
      const near = clamp(1 - townDist[k] / 1400, 0, 1);
      weed[i] = clamp(C.weedProne * (0.10 + 0.55 * near) * rng.range(0.5, 1.4), 0, 1);
      // Integrity: a cell burnt at the right interval is whole; one that has not seen fire in
      // forty years, or that is full of weed, is on its way to being something else.
      const band = C.fireBand;
      let ok = 1;
      if (band[1] > 0) {
        if (y > C.senesceY) ok = clamp(1 - (y - C.senesceY) / 45, 0.35, 1);
        else if (y < band[0] * 0.5) ok = clamp(0.55 + y / band[0], 0.4, 1);
      }
      integrity[i] = clamp(ok * (1 - 0.55 * weed[i]) * rng.range(0.9, 1.02), 0.15, 1);
      moisture[i] = 0.5;
    }
  }

  /* ---------------------------------------------------------------- fire mechanics */

  /** The planned burn extent dial. The pack says the programme exists; it does not say how big. */
  function burnDial() { return L.dial('planned-burn-extent', 0.45); }
  /** Share of bushland burnt in a year at this dial position. 0.02 is a 50 year rotation. */
  function burnShare(dial) { return 0.02 + 0.115 * dial; }

  /**
   * Burn a patch. Returns hectares actually burnt, which is less than the circle because a burn
   * leaves unburnt ground inside it, and how much it leaves is the whole argument: the pack's
   * unburnt refuge target is thirty per cent, and a hot summer wildfire does not hit it.
   */
  function applyBurn(w, cx, cz, radiusM, intensity, cause, ageDays = 0, quiet = false) {
    const refuge = cause === 'planned' ? 0.32 - 0.12 * intensity : 0.1 - 0.08 * intensity;
    let ha = 0;
    let peatBurn = 0;
    const wt = waterTable(w);
    cellsWithin(g, cx, cz, radiusM, (k, d) => {
      const i = cellToCompact[k];
      if (i < 0) return;
      const C = COMMUNITIES[com[i]];
      if (!C.carriesFire) return;
      // Edges of a burn are patchier than the middle.
      const edge = 1 - smoothstep(radiusM * 0.55, radiusM, d);
      if (rng.float() < refuge + (1 - edge) * 0.5) return;
      if (fuel[i] < 3.5 && cause === 'planned') return;      // will not carry
      ha += g.cellHa;

      const hot = clamp(intensity * (0.55 + fuel[i] / 26), 0, 1.4);
      const consumed = fuel[i] * clamp(0.5 + 0.45 * hot, 0, 0.97);
      fuel[i] -= consumed;

      // Serotiny. A seed store that has had time to build is released and the heath comes back
      // stronger. A store that has not is spent, and the cell loses a piece of what it was.
      if (C.id === 'wallum' || C.id === 'acid-wetland') {
        if (seedStore[i] > 0.62) integrity[i] = clamp(integrity[i] + 0.06, 0, 1);
        else integrity[i] = clamp(integrity[i] - 0.30 * (0.62 - seedStore[i]) / 0.62, 0.1, 1);
      }
      seedStore[i] = 0;
      sheoak[i] = 0;                                        // the cone crop is gone
      foodTree[i] = Math.max(0, foodTree[i] - C.foodTreeCap * 0.42 * hot * hot);
      hollow[i] = Math.max(0, hollow[i] - C.hollowCap * 0.30 * hot * hot * hot);
      weed[i] = Math.max(0, weed[i] - 0.35 * hot);
      // Peat. Fire in the swamp on a low water table smoulders, and the seed bank goes with it.
      if (C.peat && wt < 0.42 && hot > 0.5) {
        integrity[i] = clamp(integrity[i] - 0.28 * (0.42 - wt) / 0.42, 0.05, 1);
        peatBurn += g.cellHa;
      }
      tsf[i] = ageDays;
    });

    if (ha > 0 && !quiet) {
      const where = world.island ? world.island.regionAt(cx, cz) : 'Minjerribah';
      const entry = {
        day: w.clock.formatDate(), cause, ha: Math.round(ha),
        where, intensity: +intensity.toFixed(2),
        peatHa: peatBurn > 0 ? Math.round(peatBurn) : 0
      };
      burnLog.push(entry);
      lastBurnDay = absDay(w.clock);
      if (cause === 'planned') { plannedRing.add(ha); burntThisSeasonHa += ha; }
      else wildRing.add(ha);
      w.bus.emit('ecology:burn', { cause, ha: Math.round(ha), x: cx, z: cz, radiusM, where, peatHa: entry.peatHa });
      if (peatBurn > 4) {
        w.bus.emit('ecology:alert', {
          id: 'peat-fire',
          text: `Fire in the peat at ${where}. ${Math.round(peatBurn)} ha of swamp seed bank burnt with the water table low.`
        });
      }
    }
    return ha;
  }

  /**
   * Pick a cell to burn. Hazard reduction wants the fuel next to the townships; the wallum wants
   * the block that is due. Both are in here, and the split is what a player is really choosing.
   */
  function pickBurnCell(history = false) {
    if (!nCells) return -1;
    let best = -1, bestScore = -1;
    const hazardBias = rng.float() < 0.42;                  // roughly two burns in five are hazard work
    for (let t = 0; t < 48; t++) {
      const i = (rng.float() * nCells) | 0;
      const C = COMMUNITIES[com[i]];
      if (!C.carriesFire || C.id === 'township') continue;
      if (fuel[i] < 5) continue;
      const y = tsf[i] / YEAR;
      if (y < 4) continue;                                  // nobody burns four year old regrowth on purpose
      const k = cellIdx[i];
      let score = fuel[i] / C.fuelPeak;
      if (hazardBias) score *= clamp(1.9 - townDist[k] / 1200, 0.05, 1.9);
      else {
        const band = C.fireBand;
        score *= band[1] > 0 ? (1 - Math.abs(y - (band[0] + band[1]) / 2) / band[1]) : 0.2;
        score *= clamp(0.4 + townDist[k] / 2500, 0.4, 1.4);
      }
      if (!history && C.peat && waterTable(world) < 0.5) score *= 0.15;
      score *= rng.range(0.7, 1.3);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /** Read a fire system's scars, if one exists. Same shape src/render/layers/flora.js reads. */
  function readWildfire(w) {
    const f = w.read('fire');
    if (!f) { state.fireSource = 'no fire system loaded: only planned burns are running'; return; }
    const list = Array.isArray(f.scars) ? f.scars : Array.isArray(f.burns) ? f.burns : Array.isArray(f.active) ? f.active : null;
    if (!list) { state.fireSource = 'fire system loaded but publishes no scars, burns or active array'; return; }
    state.fireSource = 'fire system, ' + list.length + ' scars';
    for (const s of list) {
      const id = s.id != null ? String(s.id) : `${Math.round(s.x)},${Math.round(s.z)},${Math.round(s.radiusM || s.radius || 0)}`;
      if (seenScars.has(id)) continue;
      seenScars.add(id);
      const r = s.radiusM || s.radius || s.rM;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !Number.isFinite(r)) continue;
      const intensity = Number.isFinite(s.intensity) ? s.intensity : 0.85;
      applyBurn(w, s.x, s.z, r, intensity, 'wildfire', Number.isFinite(s.ageDays) ? s.ageDays : 0);
    }
    if (seenScars.size > 4000) seenScars.clear();
  }

  /* ---------------------------------------------------------------- water */

  /** 0 is a drought water table, 1 is a full one. Deferred to lakes.js when it is loaded. */
  function waterTable(w) {
    const lk = w.read('lakes');
    if (lk && Number.isFinite(lk.waterTableIndex)) return lk.waterTableIndex;
    const gw = w.read('groundwater');
    if (gw && Number.isFinite(gw.index)) return gw.index;
    const wx = w.read('weather');
    return wx ? clamp(0.3 + wx.rainWeek / 40, 0, 1) : 0.55;
  }

  /* ---------------------------------------------------------------- the daily pass */

  function dailyPass(w) {
    const wx = w.read('weather');
    const rainWeek = wx ? wx.rainWeek : 12;
    const wt = waterTable(w);
    const weedEffort = L.level('feral-and-weed-control');
    const dt = 1 / YEAR;                                      // one day, in years

    let sumFuel = 0, sumFuelTown = 0, townCells = 0, sumTsf = 0, sumWeed = 0;
    let sumSheoak = 0, sheoakWeight = 0, sumFood = 0, sumHollow = 0;
    let sumHollowTree = 0, hollowTreeWeight = 0;
    let refuge = 0, longUnburnt = 0;
    const conditionSum = new Float64Array(COMMUNITIES.length);
    const conditionN = new Float64Array(COMMUNITIES.length);

    for (let i = 0; i < nCells; i++) {
      const C = COMMUNITIES[com[i]];
      const k = cellIdx[i];
      tsf[i] += 1;
      const y = tsf[i] / YEAR;

      // Moisture: the last week of rain, the water table under this cell, and how low it sits.
      const lowGround = clamp(1 - (g.height[k] - g.seaLevel) / 26, 0, 1);
      const target = clamp(0.16 + 0.5 * smoothstep(0, 30, rainWeek) + 0.42 * wt * lowGround, 0, 1);
      moisture[i] += (target - moisture[i]) * 0.08;

      // Fuel. Litter falls at a rate the community sets and rots at a rate the moisture sets.
      // Dry years pile fuel up; wet years take it away. This is the number the fire system wants.
      const decay = C.decay * (0.45 + 1.05 * moisture[i]);
      fuel[i] += (C.litter - decay * fuel[i]) * dt;
      if (fuel[i] < 0) fuel[i] = 0;
      if (fuel[i] > C.fuelPeak * 1.4) fuel[i] = C.fuelPeak * 1.4;

      // Seed store, cone crop, food trees, hollows. Four clocks at four speeds, and the gap
      // between the fastest and the slowest is why fire interval matters more than fire extent.
      if (C.carriesFire) seedStore[i] += (1 - seedStore[i]) * dt / 4.2;
      sheoak[i] += (1 - sheoak[i]) * dt / 3.4;
      const foodCap = C.foodTreeCap * (0.55 + 0.45 * integrity[i]);
      foodTree[i] += (foodCap - foodTree[i]) * dt / 11;
      hollow[i] += (C.hollowCap - hollow[i]) * dt / 55;

      // Weeds. Birds and garden dumping carry them out of the townships; the control programme
      // pushes them back. A cell far from a yard is nearly safe and a cell in one never is.
      const near = clamp(1 - townDist[k] / 1800, 0, 1);
      const spread = C.weedProne * (0.02 + 0.26 * near) * (0.6 + 0.8 * moisture[i]);
      const control = weedEffort * (0.18 + 0.5 * near);
      weed[i] = clamp(weed[i] + (spread * (1 - weed[i]) - control * weed[i]) * dt, 0, 1);

      // Integrity. Too much fire and too little fire both cost, and so do the weeds.
      let drift = 0;
      const band = C.fireBand;
      if (band[1] > 0) {
        if (y > C.senesceY) drift -= 0.012 * clamp((y - C.senesceY) / 20, 0, 1.5);
        else if (y > band[0] && y < band[1]) drift += 0.006;
      } else if (C.id === 'foredune' || C.id === 'littoral') {
        drift += 0.010;                                       // these recover with time, not fire
      } else {
        drift += 0.004;
      }
      drift -= 0.030 * weed[i] * weed[i];
      if (C.peat && wt < 0.35) drift -= 0.010 * (0.35 - wt) / 0.35;   // a drained swamp oxidises
      integrity[i] = clamp(integrity[i] + drift * dt, 0.05, 1);

      sumFuel += fuel[i];
      sumTsf += tsf[i];
      sumWeed += weed[i];
      sumFood += foodTree[i];
      sumHollow += hollow[i];
      if (C.sheoakShare > 0.05) {
        sumSheoak += sheoak[i] * C.sheoakShare; sheoakWeight += C.sheoakShare;
        // The hollow index the cockatoos care about is the one in the trees they nest in, not an
        // island average that a hectare of saltmarsh gets a vote in.
        sumHollowTree += hollow[i] * C.sheoakShare; hollowTreeWeight += C.sheoakShare * C.hollowCap;
      }
      if (townDist[k] < 900) { sumFuelTown += fuel[i]; townCells++; }
      if (C.carriesFire && y > 6) refuge++;
      if (C.carriesFire && y > 30) longUnburnt++;
      conditionSum[com[i]] += integrity[i];
      conditionN[com[i]] += 1;
    }

    const inv = nCells ? 1 / nCells : 0;
    state.fuelMeanTHa = +(sumFuel * inv).toFixed(2);
    state.fuelNearTownshipTHa = +(townCells ? sumFuelTown / townCells : 0).toFixed(2);
    state.meanTimeSinceFireY = +(sumTsf * inv / YEAR).toFixed(1);
    state.unburntRefugeShare = +(refuge * inv).toFixed(3);
    state.longUnburntShare = +(longUnburnt * inv).toFixed(3);
    state.weedLoad = +(sumWeed * inv).toFixed(3);
    state.foodTreeIndex = +(sumFood * inv).toFixed(3);
    state.hollowIndex = +(sumHollow * inv).toFixed(3);
    state.sheoakCrop = +(sheoakWeight ? sumSheoak / sheoakWeight : 0).toFixed(3);

    // The glossy black-cockatoo eats she-oak seed and nests in big hollows. It needs both, and it
    // is the species that makes the fire interval legible: burn the same block twice too close
    // together and the cones are gone for years, whatever the fuel maps say.
    const nestHollows = hollowTreeWeight ? clamp(sumHollowTree / hollowTreeWeight, 0, 1) : 0;
    state.nestHollowIndex = +nestHollows.toFixed(3);
    state.glossyBlackCockatooIndex = +clamp(
      Math.pow(state.sheoakCrop, 1.35) * (0.30 + 0.70 * nestHollows), 0, 1
    ).toFixed(3);

    // Curing: how ready the fuel is to burn. Dry fine fuel is what carries a fire in the heath.
    state.curing = +clamp(1 - 0.85 * (sumFuel > 0 ? averageMoisture() : 0.5), 0, 1).toFixed(3);

    const rows = [];
    for (let c = 0; c < COMMUNITIES.length; c++) {
      if (!conditionN[c]) continue;
      const C = COMMUNITIES[c];
      rows.push({
        id: C.id, label: C.label, habitat: C.habitat,
        areaHa: Math.round(areaHa[c]),
        condition: +(conditionSum[c] / conditionN[c]).toFixed(3),
        note: C.note
      });
    }
    state.communities = rows;
    state.vegetatedHa = Math.round(vegetatedHa);
    state.bushlandHa = Math.round(bushlandHa);
    state.wallumCondition = condOf('wallum', rows);
    state.forestCondition = condOf('forest', rows);
    state.swampCondition = condOf('swamp', rows);
    state.foreduneCover = condOf('foredune', rows);

    // Which weeds are actually getting away, named from the pack rather than in general.
    const front = [];
    for (const w2 of WEEDS) {
      let load = 0, n = 0;
      for (const cid of w2.into) {
        const r = rows.find((x) => x.id === cid);
        if (!r) continue;
        load += weedInCommunity(COM[cid]); n++;
      }
      if (!n) continue;
      const v = load / n;
      if (v > 0.18) front.push({ id: w2.id, name: w2.name, load: +v.toFixed(2), vector: w2.vector });
    }
    front.sort((a, b) => b.load - a.load);
    state.weedFront = front.slice(0, 5);
  }

  function condOf(id, rows) {
    const r = rows.find((x) => x.id === id);
    return r ? r.condition : 0;
  }

  const commWeed = new Float64Array(COMMUNITIES.length);
  const commWeedN = new Float64Array(COMMUNITIES.length);
  function weedInCommunity(c) { return commWeedN[c] ? commWeed[c] / commWeedN[c] : 0; }
  function refreshCommunityWeed() {
    commWeed.fill(0); commWeedN.fill(0);
    for (let i = 0; i < nCells; i++) { commWeed[com[i]] += weed[i]; commWeedN[com[i]] += 1; }
  }
  function averageMoisture() {
    let s = 0;
    for (let i = 0; i < nCells; i++) s += moisture[i];
    return nCells ? s / nCells : 0.5;
  }

  /* ---------------------------------------------------------------- the burn programme */

  const BURN_SEASON = [3, 4, 5, 6, 7];   // April to August, from proc-fire-regime sim_parameters

  function publishSummary(w) {
    const dial = burnDial();
    const targetHa = bushlandHa * burnShare(dial);
    state.burnProgramme.dial = +dial.toFixed(2);
    state.burnProgramme.targetHaPerYear = Math.round(targetHa);
    state.burnProgramme.rotationYears = targetHa > 0 ? +(bushlandHa / targetHa).toFixed(1) : 0;
    state.burnProgramme.season = BURN_SEASON.includes(w.clock.month);
    state.burnProgramme.burntThisSeasonHa = Math.round(burntThisSeasonHa);
    state.burnProgramme.daysBurnableThisSeason = seasonDaysBurnable;
    state.burnProgramme.lastSeason = lastSeason.daysSeen ? lastSeason : null;
    state.burnProgramme.lastBurn = burnLog.items[0] || null;
    // The wallum takes fifteen to twenty-five years to show what a fire regime is doing to it,
    // which is longer than anybody will sit and watch. The rotation is knowable today, so it is
    // stated today, against the interval the community is actually built for.
    const rot = state.burnProgramme.rotationYears;
    const band = COMMUNITIES[COM.wallum].fireBand;
    state.burnProgramme.wallumTargetIntervalY = band;
    state.burnProgramme.verdict = targetHa <= 0
      ? 'No burning at all. The heath closes over, the seed store is never released, and the fuel '
        + 'next to the townships keeps going up.'
      : rot > band[1] * 2.2
        ? `A ${rot} year rotation. The wallum is built for ${band[0]} to ${band[1]}. On this interval `
          + 'the heath senesces and the fuel next to the townships keeps rising.'
        : rot > band[1]
          ? `A ${rot} year rotation, slower than the ${band[0]} to ${band[1]} years the wallum is built for.`
          : rot < band[0]
            ? `A ${rot} year rotation, faster than the ${band[0]} to ${band[1]} years the wallum is built `
              + 'for. Black she-oak needs about seven years to bear cones again, and the glossy '
              + 'black-cockatoos go with them.'
            : `A ${rot} year rotation, inside the ${band[0]} to ${band[1]} years the wallum is built for.`;
    state.burns.plannedRolling365Ha = Math.round(plannedRing.total);
    state.burns.wildfireRolling365Ha = Math.round(wildRing.total);
    state.burns.count365 = burnLog.items.length;
    state.events = burnLog.recent(6);
    state.levers = L.snapshot(['planned-burn-extent', 'burn-notification-and-timing',
      'feral-and-weed-control', 'ranger-program-funding']);
    // The metrics data/civic.json asks the ecology to supply.
    state.civicMetrics = {
      fire_hazard_load: metric(state.fuelNearTownshipTHa / 26),
      smoke_exposure: metric(smoke),
      wallum_condition: metric(state.wallumCondition),
      glossy_black_cockatoo: metric(state.glossyBlackCockatooIndex)
    };
  }

  function runBurnProgramme(w) {
    const month = w.clock.month;
    const inSeason = BURN_SEASON.includes(month);
    const dial = burnDial();
    const targetHa = bushlandHa * burnShare(dial);

    if (month === 2 && seasonDaysSeen) {                     // the ledger resets before the season
      lastSeason = {
        daysSeen: seasonDaysSeen, daysBurnable: seasonDaysBurnable,
        burntHa: Math.round(burntThisSeasonHa), targetHa: Math.round(targetHa)
      };
      burntThisSeasonHa = 0; seasonDaysSeen = 0; seasonDaysBurnable = 0;
    }
    if (!inSeason || targetHa <= 0) return;

    const wx = w.read('weather');
    if (!wx) return;
    // A burn goes ahead on a day it can be held: not on an extreme fire danger day, not in a
    // strong wind, not in the rain, and not so soon after rain that it will not carry. How many
    // days a season pass that test is the thing that quietly decides the rotation, so it is
    // counted and published rather than left as an emergent surprise.
    seasonDaysSeen++;
    const burnable = wx.fireDangerIndex <= 30 && wx.windKt <= 22 && wx.rainMmHr <= 0.15
      && wx.rainWeek <= 45;
    if (!burnable) return;
    seasonDaysBurnable++;

    // A burn programme chases its target. Early in the season a crew can wait for the right day;
    // by August, with the season closing and the target unmet, they take the days they can get.
    // Modelling the catch-up matters, because otherwise a run of bad weather in May quietly turns
    // a fourteen year rotation into a forty year one and nothing in the read model says so.
    const remaining = targetHa - burntThisSeasonHa;
    if (remaining <= 0) return;
    // A burn covers about ninety-five hectares of ground even when it is planned over a bigger
    // circle, because roughly a third of the inside of a planned burn does not carry: that unburnt
    // ground is the refuge the pack asks for, not a modelling loss.
    const meanBurnHa = 95;
    const seasonEndDay = 243;                                // the end of August, in days of the year
    const daysLeft = Math.max(6, seasonEndDay - w.clock.dayOfYear);
    // Only about two days in five through the season are burnable: not too dry, not too wet, not
    // too windy. The catch-up rate is set against the burnable days, not the calendar days, which
    // is the difference between a fourteen year rotation and a forty year one.
    const burnableLeft = Math.max(1, daysLeft * 0.38);
    const pressure = clamp((remaining / meanBurnHa) / burnableLeft, 0, 3);
    if (rng.float() > Math.min(0.85, pressure)) return;

    const i = pickBurnCell();
    if (i < 0) return;
    // When the programme is a long way behind and the day is right, the burn is a big one. That is
    // what actually happens: a crew that has lost May and June to rain takes the whole block in
    // August. It is also the mechanism that lets a player over-burn if they turn the dial up.
    const ha = Math.min(remaining, rng.range(35, 260) * clamp(1 + (pressure - 0.6) * 1.1, 1, 3.2));
    const r = Math.sqrt((ha * 10000) / Math.PI);
    const cx = g.xOf(cellIdx[i]), cz = g.zOf(cellIdx[i]);
    // A cool burn is the point of a planned burn. Intensity rises with fuel and fire danger,
    // which is why the crew waits for the day rather than the date.
    const intensity = clamp(0.22 + fuel[i] / 70 + wx.fireDangerIndex / 90, 0.2, 0.7);
    applyBurn(w, cx, cz, r, intensity, 'planned');

    // Smoke. A burn upwind of a township is a burn the town smells for two days, and that is the
    // real cost of hazard reduction on an island where everybody lives inside three villages.
    const k = cellIdx[i];
    if (townDist[k] < 3200) {
      const strength = clamp(1 - townDist[k] / 3200, 0, 1) * clamp(ha / 200, 0.2, 1.4);
      smoke = clamp(smoke + strength * 0.55, 0, 1);
      const notify = L.level('burn-notification-and-timing');
      w.bus.emit('ecology:smoke', {
        where: world.island ? world.island.regionAt(cx, cz) : 'Minjerribah',
        strength: +strength.toFixed(2),
        notified: notify > 0.5,
        text: notify > 0.5 ? 'Planned burn, notified in advance.' : 'Smoke over the township from an unnotified burn.'
      });
    }
  }

  /* ---------------------------------------------------------------- sampling

  Hung off the published state so another system can ask about a place rather than an average:
  the fire system wants the fuel here, the koalas want the food trees here, the frogs want the
  moisture here. Defined as non-enumerable so a probe dumped to JSON stays readable. */

  function idxAt(x, z) {
    if (!g || !g.ready || !cellToCompact) return -1;
    return cellToCompact[g.at(x, z)];
  }
  {
    const def = (name, fn) => Object.defineProperty(state, name, { value: fn, enumerable: false });
    def('fuelAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : fuel[i]; });
    def('foodTreeAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : foodTree[i]; });
    def('hollowAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : hollow[i]; });
    def('weedAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : weed[i]; });
    def('integrityAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : integrity[i]; });
    def('moistureAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0.5 : moisture[i]; });
    def('timeSinceFireYAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : tsf[i] / YEAR; });
    def('communityAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? null : COMMUNITIES[com[i]].id; });
    def('seedStoreAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : seedStore[i]; });
    def('communityList', () => COMMUNITIES.map((c) => ({ id: c.id, label: c.label, habitat: c.habitat, note: c.note })));
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'vegetation',
    phase: 'ecology',
    order: 20,

    init(w) {
      if (!build(w)) return;
      seedHistory(w);
      refreshCommunityWeed();
      dailyPass(w);
      publishSummary(w);
      lastRollDay = absDay(w.clock);
      state.ready = true;
      state.cellM = g.cell;
      state.cells = nCells;
      notes.push(`${nCells} vegetation cells at ${g.cell} m, ${Math.round(vegetatedHa)} ha vegetated, `
        + `${Math.round(bushlandHa)} ha of it bushland that carries fire.`);
      notes.push('The starting fire mosaic is built from the 2013 to 2014 bushfires: 16,800 ha, '
        + "about seventy per cent of the island's bushland, from a single lightning strike on "
        + '29 December 2013, plus twelve years of planned burning since at the modelled rate.');
      notes.push('Fuel loads, fire intervals and recovery times are modelling placeholders from '
        + 'data/ecology.json proc-fire-regime. They are not figures from an island fire plan.');
      notes.push('Community areas come from the land cover baked into the island heightfield, which splits heath '
        + 'from forest at a single elevation. That puts more of the island in forest and less in wallum '
        + 'than data/ecology.json estimates (30 per cent forest, 35 per cent wallum). The split is not '
        + 'overridden here, because a vegetation map that disagreed with the terrain the player is '
        + 'looking at would be a worse problem than a shifted ratio.');
      w.bus.emit('vegetation:ready', { cells: nCells, vegetatedHa: Math.round(vegetatedHa) });
    },

    tick(w) {
      if (!state.ready) return;
      const day = absDay(w.clock);

      // Wildfire is read every tick, because a fire system that starts one wants it to land now.
      readWildfire(w);

      // Smoke clears with the wind over a day or so.
      const wx = w.read('weather');
      smoke *= wx ? clamp(1 - (0.004 + wx.windKt * 0.0012), 0.9, 0.999) : 0.995;
      state.smokeOverTownship = +smoke.toFixed(3);

      if (day === lastRollDay) return;

      // --- once a sim-day from here down
      lastRollDay = day;
      plannedRing.roll();
      wildRing.roll();
      dailyPass(w);
      if (w.clock.dayOfMonth === 1) refreshCommunityWeed();
      runBurnProgramme(w);
      publishSummary(w);

      // Two failures, both slow, both legible, both announced once when they start.
      if (state.longUnburntShare > 0.42 && w.clock.dayOfMonth === 1) {
        w.bus.emit('ecology:alert', {
          id: 'wallum-unburnt',
          text: `${Math.round(state.longUnburntShare * 100)}% of the bushland has not seen fire in thirty years. `
            + 'The heath is closing over and the fuel is still going up.'
        });
      }
      if (state.sheoakCrop < 0.3 && w.clock.dayOfMonth === 1) {
        w.bus.emit('ecology:alert', {
          id: 'sheoak-crop',
          text: 'The she-oak seed crop is down. Glossy black-cockatoos eat almost nothing else and '
            + 'the cones take years to come back.'
        });
      }
    },

    describe(w) {
      return {
        cells: nCells,
        fuelTHa: state.fuelMeanTHa,
        fuelNearTown: state.fuelNearTownshipTHa,
        tsfY: state.meanTimeSinceFireY,
        longUnburnt: state.longUnburntShare,
        wallum: state.wallumCondition,
        forest: state.forestCondition,
        swamp: state.swampCondition,
        foredune: state.foredunecover,
        sheoak: state.sheoakCrop,
        glossy: state.glossyBlackCockatooIndex,
        foodTree: state.foodTreeIndex,
        hollow: state.hollowIndex,
        nestHollow: state.nestHollowIndex,
        refuge: state.unburntRefugeShare,
        weed: state.weedLoad,
        burnHa365: state.burns.plannedRolling365Ha,
        wildHa365: state.burns.wildfireRolling365Ha,
        smoke: state.smokeOverTownship
      };
    },

    save(w) {
      return {
        tsf: Array.from(tsf), fuel: Array.from(fuel), seed: Array.from(seedStore),
        sheoak: Array.from(sheoak), food: Array.from(foodTree), hollow: Array.from(hollow),
        weed: Array.from(weed), integrity: Array.from(integrity), moisture: Array.from(moisture),
        burnLog: burnLog.save(), planned: plannedRing.save(), wild: wildRing.save(),
        burntThisSeasonHa, lastBurnDay, smoke
      };
    },
    load(w, s) {
      if (!s || !state.ready || !s.tsf || s.tsf.length !== nCells) return;
      tsf.set(s.tsf); fuel.set(s.fuel); seedStore.set(s.seed); sheoak.set(s.sheoak);
      foodTree.set(s.food); hollow.set(s.hollow); weed.set(s.weed);
      integrity.set(s.integrity); moisture.set(s.moisture);
      burnLog.load(s.burnLog); plannedRing.load(s.planned); wildRing.load(s.wild);
      burntThisSeasonHa = s.burntThisSeasonHa || 0;
      lastBurnDay = s.lastBurnDay ?? -1;
      smoke = s.smoke || 0;
      refreshCommunityWeed();
      dailyPass(w);
    }
  });

  /* ---------------------------------------------------------------- the read model's sampling
     functions, hung off the published state so other systems can ask about a place rather than
     about an average. They are not enumerable, so a probe dumped to JSON stays readable. */

  function defineSamplers() {
    const def = (name, fn) => Object.defineProperty(state, name, { value: fn, enumerable: false });
    def('fuelAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : fuel[i]; });
    def('foodTreeAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : foodTree[i]; });
    def('hollowAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : hollow[i]; });
    def('weedAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : weed[i]; });
    def('integrityAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : integrity[i]; });
    def('moistureAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0.5 : moisture[i]; });
    def('timeSinceFireYAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : tsf[i] / YEAR; });
    def('communityAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? null : COMMUNITIES[com[i]].id; });
    def('seedStoreAt', (x, z) => { const i = idxAt(x, z); return i < 0 ? 0 : seedStore[i]; });
    def('communityList', () => COMMUNITIES.map((c) => ({ id: c.id, label: c.label, habitat: c.habitat, note: c.note })));
  }
  function idxAt(x, z) {
    if (!g || !g.ready || !cellToCompact) return -1;
    return cellToCompact[g.at(x, z)];
  }
  defineSamplers();
}
