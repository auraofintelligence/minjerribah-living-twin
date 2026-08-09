// Lakes, wetlands and the water under the island.
//
// Minjerribah is a sand mass holding a very large freshwater store, and every lake, swamp, spring
// and acid wetland on it is connected to that store in one of two ways. Getting the difference
// right is the whole point of this file:
//
//   * A WINDOW LAKE sits in a hollow that cuts down into the regional water table. Blue Lake
//     (Kaboora) at 72 m is one. Its level follows the aquifer, not last week's rain.
//   * A PERCHED LAKE sits above the water table on a sealed layer of organic matter. Brown Lake
//     (Bummiera) at 62 m is one, tea-coloured from tannins. Its level follows rainfall and it
//     hardly notices what the aquifer is doing.
//
// Draw the water table down and the window lake, Eighteen Mile Swamp, the springs and the acid
// frog breeding habitat go first. Brown Lake keeps looking fine. That gap between what looks fine
// and what is happening is the lesson data/ecology.json proc-groundwater asks for, and it is the
// reason a player who watches the pretty lake learns nothing.
//
// EVERY EXTRACTION FIGURE IN HERE IS A PLACEHOLDER AND SAYS SO. The pack is explicit: the numbers
// come from secondary reporting, one of the quoted licence figures was garbled at source, and the
// Seqwater drought response plan could not be text-extracted. They are carried with their basis
// attached and are never presented to a player as measured.
//
// Residents have raised concern about lagoons drying. Whether that is extraction, drought, or both
// is contested. The pack takes no position and neither does this file: it models both drivers
// separately so the question stays open rather than being answered by a coefficient.
//
// Determinism: world.rng.stream('lakes'). No Math.random, no Date.now.

import {
  clamp, smoothstep, seasonal, absDay,
  ecoGrid, cellsWithin, levers, humanLoad, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;

/* Published extraction figures, carried with their confidence. Megalitres a day. */
const EXTRACTION = {
  township: { value: 1.6, confidence: 'low' },
  mainlandExport: { value: 25, confidence: 'low' },
  shareOfRedlandsSupply: { value: 0.6, qualifier: 'up to', confidence: 'low' },
  note: 'From secondary reporting. One quoted licence number was clearly garbled at source. '
    + 'The Seqwater North Stradbroke Island Drought Response Plan is the document to read and it '
    + 'could not be text-extracted. Treat all of these as placeholders.',
  source: 'data/ecology.json proc-groundwater'
};

/* The four wallum frogs in the pack. Two are listed, two are not, and all four need the same
   thing: shallow, acid, undrained water in the warm months. */
const FROGS = [
  { id: 'sp-wallum-sedge-frog', name: 'Wallum sedge frog', status: 'Vulnerable', phMax: 5.2, needsLake: true },
  { id: 'sp-wallum-froglet', name: 'Wallum froglet', status: 'Not listed', phMax: 5.6, needsLake: false },
  { id: 'sp-wallum-rocketfrog', name: 'Wallum rocketfrog', status: 'Not listed', phMax: 5.6, needsLake: false },
  { id: 'sp-nsi-sedgefrog', name: 'Cooloola sedgefrog (North Stradbroke Island population)', status: 'Not listed', phMax: 5.0, needsLake: true }
];

export function registerLakes(world) {
  const rng = world.rng.stream('lakes');
  const L = levers(world);

  const state = world.publish('lakes', {
    ready: false,
    source: 'data/geography.json water_bodies; data/ecology.json proc-groundwater and the wallum frogs',
    waterTableIndex: 0.5,          // 0 drought, 1 full. What every other system reads.
    waterTableM: 0,                // metres above the long-run mean, at the island centre
    storageGl: 0, storageMean: 0,
    rechargeMlDay: 0, dischargeMlDay: 0, extractionMlDay: 0,
    extraction: EXTRACTION,
    rainMm365: 0, naturalHeadDropM: 0, rainScale: 1,
    bodies: [],
    swamp: { wetShareOfArea: 0, areaHa: 0, note: '' },
    springs: [],
    acidWetlandHa: 0, acidWetlandBaselineHa: 0,
    frogs: [],
    frogCalling: 0,
    visitorPressure: { brownLake: 0, blueLake: 0, tramplingIndex: 0 },
    aquiferStress: 0,
    drought: false, droughtDays: 0,
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(24);
  const rain365 = new DailyRing(365);

  let g = null;
  let bodies = [];
  let lastDay = -1;
  let acidBaselineHa = 0;
  let swampAreaHa = 0;
  let droughtDays = 0;

  // The lumped aquifer. Storage is held as an equivalent depth of water over the island's land
  // area, because the island's specific yield and aquifer geometry are not in any pack and a
  // three-dimensional model built on numbers nobody published would be a more confident lie.
  //
  // The important property is the time constant. Recharge is roughly six hundred and fifty
  // millimetres a year over two hundred and seventy-five square kilometres and the store is deep,
  // so the residence time is around eighteen years. That is why Blue Lake is famously steady, why
  // a dry year moves it by centimetres, and why a decision to take more water does not show up
  // for seasons. A player who changes the export and looks at the lake tomorrow sees nothing,
  // which is the honest answer and the uncomfortable one.
  const AREA_KM2 = 275.2;
  const AREA_M2 = AREA_KM2 * 1e6;
  const SPECIFIC_YIELD = 0.28;               // sand: modelled
  const MEAN_ANNUAL_RAIN_MM = 1560;          // modelled for the island's east coast position
  const RECHARGE_FRACTION = 0.42;            // sand takes a large share of what falls: modelled
  const RESIDENCE_YEARS = 18;                // modelled
  const RECHARGE_MEAN_MM_Y = MEAN_ANNUAL_RAIN_MM * RECHARGE_FRACTION;
  const STORAGE_NATURAL_MM = RECHARGE_MEAN_MM_Y * RESIDENCE_YEARS;   // with nothing taken out
  const DRAIN_K = 1 / RESIDENCE_YEARS;       // a year of discharge, as a share of storage
  /** Millimetres over the island in a year, for a take in megalitres a day.
   *  One megalitre is a million litres, and a litre spread over a square metre is a millimetre. */
  const mlDayToMmYear = (ml) => ((ml * 1e6) / AREA_M2) * YEAR;
  /** Megalitres a day, for a depth in millimetres a day over the island. */
  const mmDayToMlDay = (mm) => (mm / 1000) * AREA_M2 / 1000;

  let storageMm = 0;                         // millimetres of water in store, over the island
  let storageMean = 0;                       // the long-run level at today's published extraction
  let head = 0;                              // metres of water table above that long-run level
  let rainAccumMm = 0;                       // rain since the last daily pass, summed tick by tick
  // The weather system is a synoptic state machine, not a rain gauge, and integrated over a
  // year its drizzle adds up to several times what falls on this island. Rather than hard-code
  // a correction, the wet and dry sequencing is taken from the weather as published and the
  // amplitude is normalised against the island's modelled mean annual rainfall, tracked as a
  // running annualised mean. If the weather system is recalibrated, this scale walks back to
  // one on its own and nothing here has to change.
  let rawRainAnnualised = MEAN_ANNUAL_RAIN_MM;
  let rainDaysSeen = 0;

  /* ---------------------------------------------------------------- the water bodies */

  function build(w) {
    g = ecoGrid(w);
    const island = w.island;
    if (!island || !Array.isArray(island.lakes)) {
      notes.push('no island lakes: nothing to model.');
      return false;
    }

    for (const lk of island.lakes) {
      const type = classify(lk);
      const areaHa = polyAreaHa(lk.poly);
      const b = {
        id: lk.id,
        name: lk.nameQuandamooka ? `${lk.name} (${lk.nameQuandamooka})` : lk.name,
        plainName: lk.name,
        type: type.id,
        typeLabel: type.label,
        x: lk.x, z: lk.z,
        areaHa: +areaHa.toFixed(1),
        surfaceM: lk.surfaceM != null ? +(lk.surfaceM - island.seaLevel).toFixed(1) : null,
        surfaceSource: lk.surfaceSource,
        maxDepthM: lk.maxDepthM,
        levelM: 0,               // metres relative to its own normal level
        levelSource: '',
        ph: type.ph,
        colour: type.colour,
        dry: false,
        visitorsToday: 0,
        reedCondition: 1,
        note: type.note
      };
      bodies.push(b);
    }

    // Eighteen Mile Swamp: a water table expression, not a lake, and the biggest of them.
    swampAreaHa = 0;
    for (let q = 0; q < g.land.length; q++) {
      if (g.coverOf(g.land[q]) === 'swamp') swampAreaHa += g.cellHa;
    }
    // The acid ephemeral wetland baseline, from the vegetation system's own classification if it
    // is loaded, otherwise from low flat ground inside the heath.
    const veg = w.read('vegetation');
    acidBaselineHa = 0;
    for (let q = 0; q < g.land.length; q++) {
      const k = g.land[q];
      const cid = veg && veg.communityAt ? veg.communityAt(g.xOf(k), g.zOf(k)) : null;
      if (cid === 'acid-wetland') acidBaselineHa += g.cellHa;
      else if (!cid && g.coverOf(k) === 'heath' && g.height[k] < g.seaLevel + 26 && g.slopeDeg[k] < 3.0) acidBaselineHa += g.cellHa;
    }
    if (acidBaselineHa < 40) acidBaselineHa = 40;

    // Myora Springs (Capembah Creek). One secondary source gives 2.4 megalitres a day. Carried
    // with that confidence, because the pack says it is worth a local check.
    const my = place(w, 'myora-springs');
    state.springs = [{
      id: 'myora-springs',
      name: my ? my.name : 'Myora Springs',
      x: my ? my.x : 0, z: my ? my.z : 0,
      flowMlDay: 2.4, baseFlowMlDay: 2.4,
      confidence: 'low',
      source: 'data/ecology.json hab-littoral-rainforest spring_flow_litres_per_day, single secondary source'
    }];

    // The long-run level the island sits at with today's published extraction running. Index 0.5
    // is that level, so a player reading 0.5 is reading "normal for the island as it is now", not
    // "normal for an island nobody takes water from". How far apart those two are is published as
    // naturalHeadDropM, because that gap is the argument.
    const baselineTakeMmY = mlDayToMmYear(EXTRACTION.township.value + EXTRACTION.mainlandExport.value);
    storageMean = Math.max(1, (RECHARGE_MEAN_MM_Y - baselineTakeMmY) / DRAIN_K);
    storageMm = storageMean;
    state.naturalHeadDropM = +(((STORAGE_NATURAL_MM - storageMean) / 1000) / SPECIFIC_YIELD).toFixed(2);
    return bodies.length > 0;
  }

  function classify(lk) {
    if (lk.type === 'window_lake') {
      return {
        id: 'window', label: 'Window lake', ph: 6.2, colour: 'clear',
        note: 'A window into the island water table. Its level follows the aquifer, not last week of rain.'
      };
    }
    if (lk.type === 'perched_lake') {
      return {
        id: 'perched', label: 'Perched lake', ph: 4.8, colour: 'tea-coloured',
        note: 'Perched above the water table on a sealed layer of organic matter. Tannins from the '
          + 'paperbark and tea-tree litter are what make it tea-coloured.'
      };
    }
    if (lk.type === 'perched_lagoon' || lk.type === 'lagoon') {
      return {
        id: 'perched-ephemeral', label: 'Perched lagoon, ephemeral', ph: 4.6, colour: 'tea-coloured',
        note: 'Shallow and perched. It can dry out entirely in a run of dry years and fill again.'
      };
    }
    return { id: 'other', label: lk.type || 'water body', ph: 5.5, colour: 'unknown', note: '' };
  }

  function polyAreaHa(poly) {
    if (!poly || poly.length < 3) return 0;
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    }
    return Math.abs(a / 2) / 10000;
  }

  /* ---------------------------------------------------------------- the aquifer */

  /** Today's raw rain from the weather system, scaled to the island's mean annual rainfall. */
  function calibrateRain(rawMm) {
    rainDaysSeen++;
    const alpha = Math.max(0.006, 1 / rainDaysSeen);
    rawRainAnnualised += (rawMm * YEAR - rawRainAnnualised) * alpha;
    const scale = MEAN_ANNUAL_RAIN_MM / Math.max(120, rawRainAnnualised);
    state.rainScale = +scale.toFixed(3);
    return rawMm * scale;
  }

  function stepAquifer(w, dtDays, rainMm) {
    rain365.add(rainMm);

    // Recharge. Sand takes a large share of what falls on it straight down, which is why a sand
    // island the size of a small city holds more fresh water than the city does.
    const recharge = rainMm * RECHARGE_FRACTION;

    // Discharge. Baseflow to the sea, to Myora Springs and to the swamp rises with the store, so
    // the fuller the island is the faster it leaks out around its edges.
    const discharge = storageMm * DRAIN_K * (dtDays / YEAR);

    // Extraction. Township supply moves a little with how many people are on the island; the
    // mainland export is the big number and it is the one a player can turn.
    const townshipMl = EXTRACTION.township.value * (1 + 0.4 * clamp(humanLoad(w).pressure, 0, 2))
      * (1 - 0.22 * L.level('peak-water-restrictions'))
      * (1 - 0.18 * L.level('recycled-water-scheme'));
    const exportMl = EXTRACTION.mainlandExport.value * exportDial();
    const extractMm = mlDayToMmYear(townshipMl + exportMl) * (dtDays / YEAR);

    storageMm += recharge - discharge - extractMm;
    if (storageMm < STORAGE_NATURAL_MM * 0.15) storageMm = STORAGE_NATURAL_MM * 0.15;

    head = ((storageMm - storageMean) / 1000) / SPECIFIC_YIELD;   // metres of water table movement
    state.waterTableM = +head.toFixed(2);
    state.waterTableIndex = +clamp(0.5 + head / 5, 0, 1).toFixed(3);
    state.storageGl = +((storageMm / 1000) * AREA_M2 * SPECIFIC_YIELD / 1e6).toFixed(0);
    state.storageMean = +((storageMean / 1000) * AREA_M2 * SPECIFIC_YIELD / 1e6).toFixed(0);
    state.rechargeMlDay = +mmDayToMlDay(rain365.total * RECHARGE_FRACTION / YEAR).toFixed(1);
    state.dischargeMlDay = +mmDayToMlDay(discharge / dtDays).toFixed(1);
    state.extractionMlDay = +(townshipMl + exportMl).toFixed(1);
    state.rainMm365 = Math.round(rain365.total);

    // Aquifer stress: what is being taken against what is coming in. It is nowhere near one on
    // this island, and saying so is more useful than inventing a crisis. The argument here is
    // about where the water is taken from and what it is connected to, not about running out.
    const inflow = Math.max(0.1, state.rechargeMlDay);
    state.aquiferStress = metric(clamp(state.extractionMlDay / inflow, 0, 1));
  }

  /**
   * How much of the published mainland export is running. The pack's 25 megalitres a day is a
   * placeholder; this dial is what a civic system or a player moves, and one is the placeholder
   * as published.
   */
  function exportDial() {
    // No civic lever sets the export volume directly. Recycled water and monitoring reduce the
    // pressure to take more; a player can set it outright through the ecology intent.
    return clamp(exportOverride ?? 1, 0, 2.5);
  }
  let exportOverride = null;
  world.bus.on('ui:intent', (p) => {
    if (!p) return;
    if (p.kind === 'water:export') exportOverride = Number.isFinite(p.share) ? clamp(p.share, 0, 2.5) : 1;
  });

  /* ---------------------------------------------------------------- the bodies */

  function stepBodies(w, dtDays, rainMm) {
    const evapMm = evaporationMm(w) * dtDays;
    const h = humanLoad(w);
    const boardwalk = L.level('gorge-walk-visitor-flow') * 0.4 + L.level('ranger-program-funding') * 0.6;

    for (const b of bodies) {
      if (b.type === 'window') {
        // A window lake is the water table with the lid off. It moves with the aquifer and it
        // moves slowly, which is exactly why it is the one worth monitoring.
        b.levelM += (head * 0.92 - b.levelM) * 0.02 * dtDays;
        b.levelSource = 'follows the regional water table';
      } else {
        // A perched lake is a bucket with a sill. Rain on the lake and on the sand immediately
        // around it goes in; evaporation, slow seepage through the organic seal and, once it is
        // full, an outlet take it back out. Most of the time it sits at its sill, which is why
        // Brown Lake looks the same every summer whatever the aquifer is doing underneath it.
        const inflow = rainMm * 1.55;                   // the lake plus its immediate catchment
        const seep = 1.2 * dtDays;                      // mm a day through the organic seal
        const spill = Math.max(0, b.levelM - 0.3) * 26 * dtDays;
        b.levelM += (inflow - evapMm - seep - spill) / 1000;
        b.levelM = clamp(b.levelM, -2.6, 0.6);
        b.levelSource = 'follows rainfall, not the aquifer';
      }
      const wasDry = b.dry;
      b.dry = b.type === 'perched-ephemeral' && b.levelM < -0.85;
      if (b.dry && !wasDry) {
        log.push({ day: w.clock.formatDate(), what: `${b.plainName} has dried out`, note: 'It is ephemeral: it fills again.' });
        w.bus.emit('ecology:alert', {
          id: 'lagoon-dry',
          text: `${b.plainName} has dried out. It is a perched, ephemeral water body and it does this, `
            + 'but whether it does it more often is the question residents have been asking.'
        });
      }
      if (!b.dry && wasDry) log.push({ day: w.clock.formatDate(), what: `${b.plainName} has water in it again` });

      // Visitors. Brown Lake and Blue Lake are the two people walk to, and reed bed trampling at
      // popular lakes is named in the pack as a real problem on this island.
      const draw = b.plainName === 'Brown Lake' ? 0.055 : b.plainName === 'Blue Lake' ? 0.022 : 0.002;
      b.visitorsToday = Math.round(h.visitors * draw * (h.holiday ? 1.5 : 1));
      const trample = (b.visitorsToday / 260) * (1 - 0.55 * boardwalk);
      b.reedCondition = clamp(b.reedCondition + (0.0016 - trample * 0.012) * dtDays, 0.1, 1);

      // Chemistry. A perched, tannin-stained lake is acid because of what falls into it; a window
      // lake sits closer to neutral. Nutrient loading from a busy shore pushes both the wrong way.
      const nutrient = clamp(b.visitorsToday / 900, 0, 0.5) * (1 - 0.4 * L.level('sewer-network-extension'));
      const basePh = b.type === 'window' ? 6.2 : b.type === 'perched' ? 4.8 : 4.6;
      b.ph = +(basePh + nutrient * 0.9 + clamp(-b.levelM, 0, 1) * 0.25).toFixed(2);
    }
  }

  function evaporationMm(w) {
    const wx = w.read('weather');
    const dl = w.read('daylight');
    if (!wx) return 4;
    const sun = dl ? clamp(dl.dayLengthMin / 780, 0.6, 1.25) : 1;
    return clamp(1.6 + wx.tempC * 0.16, 1, 9) * sun * (1 - wx.cloud * 0.35) * (1 - (wx.humidity - 0.6) * 0.6);
  }

  /* ---------------------------------------------------------------- the wetlands and the frogs */

  function stepWetlands(w) {
    // Eighteen Mile Swamp and the acid wetlands are the water table showing at the surface. When
    // the table drops, the wet area shrinks first and the lakes barely move, which is the wrong
    // way round from what a player expects and is the point.
    const wetShare = clamp(0.55 + head * 0.24, 0.05, 1);
    state.swamp = {
      wetShareOfArea: +wetShare.toFixed(3),
      areaHa: Math.round(swampAreaHa),
      wetHa: Math.round(swampAreaHa * wetShare),
      note: 'Fed by the water table, not by runoff. It is the first thing to shrink when the table drops.'
    };
    const acidHa = acidBaselineHa * clamp(0.35 + head * 0.30 + 0.25 * clamp(rain365.total / MEAN_ANNUAL_RAIN_MM, 0, 1.6), 0.05, 1.35);
    state.acidWetlandHa = Math.round(acidHa);
    state.acidWetlandBaselineHa = Math.round(acidBaselineHa);

    for (const s of state.springs) {
      s.flowMlDay = +(s.baseFlowMlDay * clamp(1 + head * 0.28, 0.15, 1.9)).toFixed(2);
    }

    // The frogs. Breeding needs warm-season rain in the sedge beds, water acid enough to keep the
    // predatory fish and the competing frogs out, and beds nobody has walked through. The pack is
    // explicit that trampling of reed beds at popular lakes is a real problem here.
    const wx = w.read('weather');
    const warm = wx ? clamp((wx.tempC - 15) / 12, 0, 1) : 0.5;
    const wet = clamp((wx ? wx.rainWeek : 10) / 22, 0, 1.2);
    const lakeReeds = bodies.length
      ? bodies.reduce((s2, b) => s2 + b.reedCondition, 0) / bodies.length : 1;
    const habitat = clamp(acidHa / Math.max(1, acidBaselineHa), 0, 1.35);
    const out = [];
    let calling = 0;
    for (const f of FROGS) {
      // Acidity is the frog's defence. Anything that pushes the water toward neutral lets in the
      // things that eat tadpoles, so a rising pH is a loss even when the water level looks fine.
      // Only the acid water counts. A wallum frog does not breed in a window lake sitting near
      // neutral, so averaging Blue Lake into its water chemistry would flatter the answer.
      const acidBodies = bodies.filter((b) => b.type !== 'window');
      const ph = f.needsLake && acidBodies.length
        ? acidBodies.reduce((s2, b) => s2 + b.ph, 0) / acidBodies.length
        : 4.9 + clamp(-head, 0, 1) * 0.4;
      const acidOk = clamp((f.phMax + 0.5 - ph) / 0.8, 0, 1);
      const reeds = f.needsLake ? lakeReeds : 1;
      const breeding = clamp(warm * wet * acidOk * habitat * reeds, 0, 1.2);
      // Recruitment in the warm months against a steady adult loss, rather than an index that
      // relaxes toward whatever today looks like. A frog population is built in summer and spent
      // through winter, and the point of modelling it that way is that a single failed breeding
      // season shows up two years later rather than tomorrow.
      const x = f.index ?? 0.7;
      f.index = clamp(x + breeding * 0.016 * (1 - x) - x * 0.0014, 0, 1);
      const call = breeding * (wx && wx.rainMmHr > 0.05 ? 1 : 0.35);
      calling += call;
      out.push({
        id: f.id, name: f.name, status: f.status,
        index: +f.index.toFixed(3),
        breedingNow: +breeding.toFixed(3),
        callingNow: +call.toFixed(3),
        limitedBy: acidOk < 0.6 ? 'water chemistry drifting toward neutral'
          : habitat < 0.6 ? 'wetland area, which follows the water table'
            : reeds < 0.6 ? 'trampled reed beds'
              : breeding < 0.3 ? 'the season' : 'nothing right now'
      });
    }
    state.frogs = out;
    state.frogCalling = +(calling / FROGS.length).toFixed(3);
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'lakes',
    phase: 'ecology',
    order: 10,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      for (const f of FROGS) f.index = 0.72;
      stepAquifer(w, 1, MEAN_ANNUAL_RAIN_MM / YEAR);
      stepBodies(w, 1, MEAN_ANNUAL_RAIN_MM / YEAR);
      for (let i = 0; i < 364; i++) rain365.roll();   // so the annual total is not a one day figure
      rain365.add(MEAN_ANNUAL_RAIN_MM);
      stepWetlands(w);
      publish(w);
      lastDay = absDay(w.clock);
      for (const b of bodies) {
        if (b.surfaceM == null) {
          notes.push(`${b.plainName}: data/geography.json carries the outline and no water level, `
            + 'so no surface elevation is published for it here either.');
        }
      }
      notes.push('Extraction figures are placeholders from secondary reporting. '
        + EXTRACTION.note);
      notes.push('The aquifer is a lumped store: recharge in, baseflow and extraction out, expressed '
        + 'as millimetres over the island. Specific yield, recharge fraction and mean rainfall are '
        + 'modelling choices, not measurements from a bore.');
      w.bus.emit('lakes:ready', { bodies: bodies.length });
    },

    tick(w) {
      if (!state.ready) return;
      // Rain is summed tick by tick. Reading the instantaneous rate once a day and multiplying it
      // by twenty-four turns a passing shower into a hundred millimetres, which is the error that
      // had an earlier version of this file raining sixteen thousand millimetres a year.
      const wx = w.read('weather');
      if (wx) rainAccumMm += wx.rainMmHr * (10 / 60);

      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      rain365.roll();

      const dayRain = calibrateRain(rainAccumMm);
      rainAccumMm = 0;
      stepAquifer(w, 1, dayRain);
      stepBodies(w, 1, dayRain);
      stepWetlands(w);
      publish(w);

      // Drought is a state, not an event: the island notices it in the swamp before the lakes.
      const dry = state.waterTableIndex < 0.34;
      if (dry) droughtDays++; else droughtDays = Math.max(0, droughtDays - 3);
      const wasDrought = state.drought;
      state.drought = droughtDays > 60;
      state.droughtDays = droughtDays;
      if (state.drought && !wasDrought) {
        w.bus.emit('ecology:alert', {
          id: 'water-table-low',
          text: 'The water table is low. Eighteen Mile Swamp and the acid wetlands are shrinking and '
            + 'the springs are down. Brown Lake looks the same as it always does, because it is perched '
            + 'and is not connected to any of it.'
        });
        log.push({ day: w.clock.formatDate(), what: 'the water table is low', note: 'the swamp goes first' });
      }
    },

    describe(w) {
      const b = {};
      for (const x of bodies) b[x.plainName] = +x.levelM.toFixed(2);
      return {
        waterTable: state.waterTableIndex,
        headM: state.waterTableM,
        naturalDropM: state.naturalHeadDropM,
        storageGl: state.storageGl,
        rechargeMlDay: state.rechargeMlDay,
        extractionMlDay: state.extractionMlDay,
        stress: state.aquiferStress,
        rain365: state.rainMm365,
        rainScale: state.rainScale,
        swampWet: state.swamp.wetShareOfArea,
        acidHa: state.acidWetlandHa,
        springMlDay: state.springs[0] ? state.springs[0].flowMlDay : 0,
        frogs: state.frogs.map((f) => f.index),
        calling: state.frogCalling,
        levels: b,
        drought: state.drought
      };
    },

    save() {
      return {
        storageMm, droughtDays, rawRainAnnualised, rainDaysSeen,
        bodies: bodies.map((b) => ({ id: b.id, levelM: b.levelM, reed: b.reedCondition, ph: b.ph, dry: b.dry })),
        frogs: FROGS.map((f) => f.index),
        rain: rain365.save(), log: log.save(), exportOverride
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      storageMm = s.storageMm;
      rawRainAnnualised = s.rawRainAnnualised ?? MEAN_ANNUAL_RAIN_MM;
      rainDaysSeen = s.rainDaysSeen || 0;
      droughtDays = s.droughtDays || 0;
      exportOverride = s.exportOverride ?? null;
      for (const r of s.bodies || []) {
        const b = bodies.find((x) => x.id === r.id);
        if (b) { b.levelM = r.levelM; b.reedCondition = r.reed; b.ph = r.ph; b.dry = r.dry; }
      }
      (s.frogs || []).forEach((v, i) => { if (FROGS[i]) FROGS[i].index = v; });
      rain365.load(s.rain);
      log.load(s.log);
      stepWetlands(w);
      publish(w);
    }
  });

  function publish(w) {
    state.bodies = bodies.map((b) => ({
      id: b.id, name: b.name, type: b.type, typeLabel: b.typeLabel,
      areaHa: b.areaHa, surfaceM: b.surfaceM, surfaceSource: b.surfaceSource,
      maxDepthM: b.maxDepthM,
      levelM: +b.levelM.toFixed(2),
      levelSource: b.levelSource,
      ph: b.ph, colour: b.colour, dry: b.dry,
      visitorsToday: b.visitorsToday,
      reedCondition: +b.reedCondition.toFixed(3),
      note: b.note
    }));
    state.visitorPressure = {
      brownLake: bodies.find((b) => b.plainName === 'Brown Lake')?.visitorsToday || 0,
      blueLake: bodies.find((b) => b.plainName === 'Blue Lake')?.visitorsToday || 0,
      tramplingIndex: +(1 - (bodies.length ? bodies.reduce((s, b) => s + b.reedCondition, 0) / bodies.length : 1)).toFixed(3)
    };
    state.events = log.recent(6);
    state.levers = L.snapshot(['peak-water-restrictions', 'recycled-water-scheme', 'borefield-monitoring',
      'sewer-network-extension', 'ranger-program-funding']);
    state.civicMetrics = {
      aquifer_stress: state.aquiferStress,
      water_security: metric(state.waterTableIndex * 0.7 + 0.3 * (1 - state.aquiferStress)),
      wetland_extent: metric(state.acidWetlandHa / Math.max(1, state.acidWetlandBaselineHa)),
      acid_frog_index: metric(state.frogs.length ? state.frogs.reduce((s, f) => s + f.index, 0) / state.frogs.length : 0)
    };
  }
}
