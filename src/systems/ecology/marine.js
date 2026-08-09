// The water around the island: seagrass, dugong, turtles, dolphins, the reefs, the fish runs and
// the yabby banks.
//
// Six things are going on here at once and they run on different clocks:
//
//   * SEAGRASS on the Eastern Banks, roughly 142 square kilometres of it off the island's western
//     and northern side. More than 95 per cent of Moreton Bay's dugong are on it. It is grazed hard
//     in patches and grows back, and the shock that actually hurts it comes from a mainland
//     catchment in flood, which nobody on this island can do anything about.
//   * DUGONG, about 601 in the bay at the 2016 aerial survey, with a wide seasonal swing: about
//     503 in July and about 1,019 in January, because animals move in and out of the bay.
//   * TURTLES. Green turtles feed on the seagrass all year. Loggerheads nest on the ocean beaches
//     in summer: 17 nests were recorded in the 2017/18 season from an estimated five or six
//     females. The last recorded fox predation of a nest on this island was in late 2016, and that
//     is not luck, it is a baiting programme somebody has to keep funding.
//   * REEFS. Flat Rock, a marine national park green zone since the 2009 rezoning, holds a grey
//     nurse shark aggregation from about June to October. Manta Bommie at Shag Rock is a cleaning
//     station in the warm months and is described as nationally significant, second to Lady Elliot.
//   * FISH RUNS. The mullet run leaves the estuaries in winter and travels the beaches in visible
//     dark patches, May to August. Tailor work the gutters, strongest in August and September.
//   * THE YABBY BANKS, which come out on a low tide and are the clearest small commons on the
//     island: the bank by the ramp gets hammered and the one a kilometre away sits untouched.
//
// Every count in this file that comes from a bay-wide survey is labelled as bay-wide. The island's
// share is a separate, named, modelled number.
//
// Determinism: world.rng.stream('marine'). No Math.random, no Date.now.

import {
  clamp, smoothstep, seasonal, absDay,
  ecoGrid, levers, humanLoad, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;

/* ------------------------------------------------------------------ published figures */

const DUGONG = {
  bay2016: 601, ci: [521, 681],
  prior: [{ year: 2013, value: 759, plusMinus: 181 }],
  julyLow: 503, januaryHigh: 1019,
  shareOnEasternBanks: 0.95,
  source: 'data/ecology.json sp-dugong'
};
const SEAGRASS = {
  easternBanksKm2: 142,
  species: ['Halophila ovalis', 'Halophila spinulosa', 'Halodule uninervis', 'Zostera muelleri',
    'Oceana serrulata', 'Syringodium isoetifolium'],
  grazingShootReduction: [0.65, 0.95],
  note: 'Oceana serrulata has increased at Amity and Wanga-Wallen Banks, replacing Zostera muelleri '
    + 'as the dominant. Grazing is a rotating disturbance with recovery, not a loss.',
  source: 'data/ecology.json proc-seagrass-dynamics'
};
const LOGGERHEAD = {
  nests201718: 17, femalesEstimate: [5, 6],
  lastRecordedFoxPredation: 'late 2016',
  source: 'data/ecology.json sp-loggerhead-turtle'
};
const DOLPHINS = {
  bottlenoseBay: 554, bottlenoseCi: [510, 598],
  humpbackDolphinBay: 128, humpbackDolphinCi: [67, 247],
  source: 'data/ecology.json sp-indo-pacific-bottlenose-dolphin and sp-australian-humpback-dolphin'
};

/* The named reefs, from data/ecology.json hab-offshore-reef members. */
const REEFS = [
  {
    id: 'reef-flat-rock', name: 'Flat Rock', lon: 153.55, lat: -27.4172,
    protection: 'Marine national park (green) zone since the 2009 Moreton Bay Marine Park rezoning. '
      + 'No fishing, no anchoring. Four permanent moorings installed in 2012.',
    greenZone: true, moorings: 4,
    species: 'grey nurse shark',
    season: { jan: 0.1, feb: 0.1, mar: 0.15, apr: 0.3, may: 0.5, jun: 0.9, jul: 1, aug: 1, sep: 0.95, oct: 0.8, nov: 0.4, dec: 0.15 }
  },
  {
    id: 'reef-manta-bommie', name: 'Manta Bommie (Shag Rock)', lon: 153.5525, lat: -27.4256,
    protection: 'Dive site with a cleaning station. Moorings preferred over anchoring.',
    greenZone: false, moorings: 2, depthRangeM: [3, 15],
    species: 'reef manta ray',
    season: { jan: 1, feb: 1, mar: 0.9, apr: 0.8, may: 0.6, jun: 0.2, jul: 0.1, aug: 0.1, sep: 0.15, oct: 0.3, nov: 0.7, dec: 0.95 }
  }
];

/* The fish runs. Both are things you can stand on the sand and watch. */
const RUNS = [
  {
    id: 'sp-sea-mullet', name: 'Sea mullet', label: 'the mullet run',
    season: { jan: 0.1, feb: 0.1, mar: 0.2, apr: 0.4, may: 0.85, jun: 1, jul: 1, aug: 0.9, sep: 0.4, oct: 0.2, nov: 0.15, dec: 0.1 },
    note: 'Schools leave the estuaries in winter to spawn and travel along the beaches in visible '
      + 'dark patches, May to August. They feed the tailor and the dolphins.'
  },
  {
    id: 'sp-tailor', name: 'Tailor', label: 'tailor in the gutters',
    season: { jan: 0.2, feb: 0.2, mar: 0.3, apr: 0.5, may: 0.7, jun: 0.85, jul: 0.9, aug: 1, sep: 1, oct: 0.7, nov: 0.4, dec: 0.25 },
    note: 'Winter into early spring, August and September the strong months, working the gutters '
      + 'along Main Beach and through to Amity.'
  }
];

/* The yabby banks. Named from the places they sit off, all of which are in data/places.json. */
const YABBY_BANKS = [
  { id: 'amity-banks', placeId: 'amity-point', label: 'the banks off Amity Point', rampM: 260, areaHa: 90 },
  { id: 'one-mile-bank', placeId: 'one-mile-jetty', label: 'the bank off One Mile', rampM: 700, areaHa: 55 },
  { id: 'polka-point-bank', placeId: 'polka-point', label: 'the bank off Polka Point', rampM: 1500, areaHa: 40 },
  { id: 'myora-bank', placeId: 'myora-springs', label: 'the flats off Myora', rampM: 4200, areaHa: 120 },
  { id: 'adams-bank', placeId: 'adams-beach', label: 'the flats off Adams Beach', rampM: 1800, areaHa: 45 }
];

export function registerMarine(world) {
  const rng = world.rng.stream('marine');
  const L = levers(world);

  const state = world.publish('marine', {
    ready: false,
    source: 'data/ecology.json sp-dugong, sp-green-turtle, sp-loggerhead-turtle, sp-reef-manta-ray, '
      + 'sp-grey-nurse-shark, sp-indo-pacific-bottlenose-dolphin, sp-sea-mullet, sp-tailor, sp-bass-yabby, sp-pipi',
    seagrass: null,
    dugong: null,
    turtles: null,
    dolphins: null,
    reefs: [],
    runs: [],
    yabbyBanks: [],
    pipi: null,
    strandings365: 0,
    gearCalls365: 0,
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(30);
  const strandRing = new DailyRing(365);
  const gearRing = new DailyRing(365);
  const hatchRing = new DailyRing(365);

  let g = null;
  let patches = [];        // seagrass patches on the Eastern Banks
  let herds = [];          // dugong
  let dolphinPods = [];
  let nests = [];
  let banks = [];
  let lastDay = -1;
  let turbidity = 0;       // flood plume: the shock that comes from the mainland
  let greenTurtles = 0;
  let nestsThisSeason = 0, hatchlingsThisSeason = 0, predatedThisSeason = 0;
  let seasonYear = -1;
  const lostTo = { fox: 0, vehicle: 0, tide: 0, light: 0 };

  /* ---------------------------------------------------------------- build */

  function build(w) {
    g = ecoGrid(w);
    const island = w.island;
    if (!g.ready || !island) { notes.push('no island: no marine system.'); return false; }

    // Seagrass, on the shallow banks off the western and northern side. Taken from the heightfield:
    // bay-side seabed between about half a metre and six metres of water is where the meadows are.
    const sea = island.seaLevel;
    const cand = [];
    for (let k = 0; k < g.n; k++) {
      if (g.isLand[k]) continue;
      if (g.bay[k] < 130) continue;
      const depth = sea - g.height[k];
      if (depth < 0.4 || depth > 6.5) continue;
      cand.push(k);
    }
    // Group into patches of a workable size: about sixty of them over the banks.
    const target = 60;
    const step = Math.max(1, Math.floor(cand.length / target));
    for (let i = 0; i < cand.length; i += step) {
      const k = cand[i];
      patches.push({
        id: 'sg' + patches.length,
        x: g.xOf(k), z: g.zOf(k),
        areaHa: step * g.cellHa,
        depthM: +(sea - g.height[k]).toFixed(1),
        shoots: rng.range(0.72, 1.0),      // shoot density, 1 is an ungrazed meadow
        grazedBy: null
      });
    }
    const totalHa = patches.reduce((s, p) => s + p.areaHa, 0);
    if (!patches.length) { notes.push('no shallow bay seabed found: no seagrass.'); return false; }
    notes.push(`${patches.length} seagrass patches over ${Math.round(totalHa)} ha of bay-side seabed `
      + `between 0.4 and 6.5 m, measured off the heightfield. The published Eastern Banks figure is `
      + `${SEAGRASS.easternBanksKm2} km2, which covers more than the island's own frontage.`);

    // Dugong herds. The bay figure is a bay figure; more than ninety-five per cent of them are on
    // these banks, so the island's number is most of the bay's and the read model says which is which.
    const islandDugong = Math.round(DUGONG.bay2016 * DUGONG.shareOnEasternBanks);
    let left = islandDugong;
    for (let i = 0; i < 9 && left > 0; i++) {
      const size = i === 8 ? left : Math.min(left, Math.round(islandDugong / 9 * rng.range(0.5, 1.6)));
      const p = patches[(rng.float() * patches.length) | 0];
      herds.push({ id: 'd' + i, size, x: p.x, z: p.z, patch: p.id, daysOnPatch: rng.int(0, 40) });
      left -= size;
    }

    // Dolphins. Bottlenose are resident and are seen from the Amity Point jetty and off Point
    // Lookout; the Australian humpback dolphin is much scarcer and shyer, and a population of about
    // 128 in the whole bay means one death matters.
    const anchors = ['amity-point', 'one-mile-jetty', 'dunwich-ferry-terminal', 'point-lookout-headland', 'myora-springs'];
    for (let i = 0; i < 12; i++) {
      const a = place(w, anchors[i % anchors.length]);
      dolphinPods.push({
        id: 'bn' + i, species: 'Indo-Pacific bottlenose dolphin',
        size: rng.int(3, 12),
        x: (a ? a.x : 0) + rng.range(-1800, 1800),
        z: (a ? a.z : 0) + rng.range(-1800, 1800),
        home: a ? { x: a.x, z: a.z } : { x: 0, z: 0 },
        near: a ? a.name : 'the bay'
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = place(w, i === 0 ? 'amity-point' : 'myora-springs');
      dolphinPods.push({
        id: 'hd' + i, species: 'Australian humpback dolphin',
        size: rng.int(2, 6),
        x: (a ? a.x : 0) + rng.range(-2500, 2500),
        z: (a ? a.z : 0) + rng.range(-2500, 2500),
        home: a ? { x: a.x, z: a.z } : { x: 0, z: 0 },
        near: a ? a.name : 'the bay',
        rare: true
      });
    }

    // The reefs.
    for (const r of REEFS) {
      const p = island.project(r.lon, r.lat);
      r.x = p.x; r.z = p.z;
      r.presence = 0;
      r.diverPressure = 0;
      r.anchorDamage = 0;
    }

    // The yabby banks.
    for (const b of YABBY_BANKS) {
      const p = place(w, b.placeId);
      if (!p) { notes.push(`${b.label}: the place it is named from is not in data/places.json.`); continue; }
      banks.push({ ...b, x: p.x, z: p.z, density: rng.range(0.75, 1.0), pumpedToday: 0, pumped365: 0 });
    }

    greenTurtles = 900;   // modelled resident feeding population, scaled by seagrass below
    return true;
  }

  /* ---------------------------------------------------------------- seagrass and dugong */

  function stepSeagrass(w, dtDays) {
    const wx = w.read('weather');
    const h = humanLoad(w);
    const goSlow = L.level('recycled-water-scheme') * 0 + L.level('borefield-monitoring') * 0;  // no direct lever
    const moorings = L.level('amity-coastal-research') * 0.2 + L.level('ranger-program-funding') * 0.5;

    // Flood plumes. Big catchment rain on the mainland turns the bay brown and the light stops
    // reaching the meadow. This is the shock that matters and it arrives from somewhere else,
    // which is worth a player understanding before they look for a local lever for it.
    // The weather system integrates a lot of drizzle, so the rain signal is read through the same
    // calibration the lakes system publishes. Without that, a flood plume sits over the banks all
    // year and the seagrass never gets its light back.
    const lk = w.read('lakes');
    const rainScale = lk && Number.isFinite(lk.rainScale) ? lk.rainScale : 1;
    const rainWeek = (wx ? wx.rainWeek : 0) * rainScale;
    if (rainWeek > 4.2 && rng.float() < 0.02 * dtDays) {
      turbidity = clamp(turbidity + rng.range(0.3, 0.75), 0, 1);
      log.push({ day: w.clock.formatDate(), what: 'flood plume over the banks', note: 'a mainland catchment problem, not an island one' });
      w.bus.emit('ecology:alert', {
        id: 'flood-plume',
        text: 'A flood plume is over the Eastern Banks. The seagrass will lose light for weeks and '
          + 'the dugong will move. Nothing on this island caused it and nothing on this island fixes it.'
      });
    }
    // A plume clears over three or four weeks once the catchment stops delivering.
    turbidity = clamp(turbidity - 0.040 * dtDays, 0, 1);

    // Boat traffic. Propeller scarring in shallow water and anchors on the meadow.
    const boats = clamp(h.visitors / 700 + 1.2, 0, 8);

    for (const p of patches) {
      const light = clamp(1 - turbidity * (1 - p.depthM / 8), 0.15, 1);
      const growth = 0.010 * light * (1 - p.shoots) * dtDays;
      let loss = 0;
      if (p.depthM < 1.6) loss += 0.00030 * boats * (1 - 0.5 * moorings) * dtDays;   // prop scarring
      p.shoots = clamp(p.shoots + growth - loss, 0.02, 1);
    }

    // Dugong. A herd works a patch for weeks to months, takes most of the shoot density, and moves
    // on. That is a cycle, not damage, and the model has to let the patch come back.
    const seasonMul = dugongSeasonal(w);
    for (const herd of herds) {
      const p = patches.find((q) => q.id === herd.patch) || patches[0];
      herd.daysOnPatch += dtDays;
      const take = 0.014 * (herd.size / 60) * dtDays;
      p.shoots = clamp(p.shoots - take, 0.02, 1);
      p.grazedBy = herd.id;
      if (p.shoots < 0.28 || herd.daysOnPatch > 110) {
        // Move to the best patch within reach.
        let best = null, bestScore = -1;
        for (let t = 0; t < 12; t++) {
          const q = patches[(rng.float() * patches.length) | 0];
          const d = Math.hypot(q.x - herd.x, q.z - herd.z);
          const score = q.shoots - d / 40000;
          if (score > bestScore) { bestScore = score; best = q; }
        }
        if (best) {
          if (p) p.grazedBy = null;
          herd.patch = best.id; herd.x = best.x; herd.z = best.z; herd.daysOnPatch = 0;
        }
      }
      // Boat strike in shallow water and net entanglement. A dugong death is a real event here.
      if (rng.float() < 0.00016 * clamp(boats / 3, 0, 2) * dtDays) {
        herd.size = Math.max(0, herd.size - 1);
        strandRing.add(1);
        log.push({ day: w.clock.formatDate(), what: 'dugong struck in shallow water' });
        w.bus.emit('wildlife:call', {
          species: 'Dugong', situation: 'dugong struck by a vessel',
          where: 'the Eastern Banks', x: herd.x, z: herd.z,
          contact: 'Queensland marine stranding hotline 1300 130 372 (option 1)'
        });
      }
    }

    // The herd total follows the meadow with a lag of seasons, which is what the pack asks for.
    const meadow = patches.reduce((s, p) => s + p.shoots * p.areaHa, 0)
      / Math.max(1, patches.reduce((s, p) => s + p.areaHa, 0));
    const capacity = Math.round(DUGONG.bay2016 * DUGONG.shareOnEasternBanks * clamp(meadow / 0.8, 0.2, 1.25));
    const now = herds.reduce((s, hd) => s + hd.size, 0);
    if (now < capacity && rng.float() < 0.02 * dtDays) {
      herds[(rng.float() * herds.length) | 0].size++;
    } else if (now > capacity * 1.05 && rng.float() < 0.02 * dtDays) {
      const hd = herds[(rng.float() * herds.length) | 0];
      if (hd.size > 1) hd.size--;
    }

    // Green turtles feed on the same meadow.
    const gtCap = Math.round(900 * clamp(meadow / 0.8, 0.2, 1.3));
    greenTurtles += (gtCap - greenTurtles) * 0.004 * dtDays;

    state.seagrass = {
      patches: patches.length,
      areaHa: Math.round(patches.reduce((s, p) => s + p.areaHa, 0)),
      meanShootDensity: +meadow.toFixed(3),
      turbidity: +turbidity.toFixed(3),
      grazedPatches: patches.filter((p) => p.grazedBy).length,
      recoveringPatches: patches.filter((p) => p.shoots < 0.5).length,
      easternBanksPublishedKm2: SEAGRASS.easternBanksKm2,
      species: SEAGRASS.species,
      note: SEAGRASS.note
    };
    state.dugong = {
      onEasternBanks: now,
      herds: herds.length,
      bayCount2016: DUGONG.bay2016,
      bayConfidenceInterval: DUGONG.ci,
      seasonalSwingBay: { julyLow: DUGONG.julyLow, januaryHigh: DUGONG.januaryHigh },
      inBayNow: Math.round(now / DUGONG.shareOnEasternBanks * seasonMul),
      shareOnEasternBanks: DUGONG.shareOnEasternBanks,
      largestHerd: herds.length ? Math.max(...herds.map((hd) => hd.size)) : 0,
      note: 'The bay figure is a bay figure. More than ninety-five per cent of the bay dugong are '
        + 'on these banks, which is why the island number is most of it.'
    };
  }

  function dugongSeasonal(w) {
    const t = { jan: 1, feb: 0.95, mar: 0.9, apr: 0.8, may: 0.7, jun: 0.6, jul: 0.5,
      aug: 0.55, sep: 0.65, oct: 0.75, nov: 0.85, dec: 0.95 };
    return 0.5 + seasonal(t, w.clock) * 0.7;
  }

  /* ---------------------------------------------------------------- turtles */

  function stepTurtles(w, dtDays) {
    const month = w.clock.month;
    const foxControl = L.level('feral-and-weed-control');
    const beachClose = L.level('beach-driving-seasonal-closures');
    const wardens = L.level('ranger-program-funding');
    const dunes = w.read('dunes');
    const tide = w.read('tide');
    const wx = w.read('weather');
    const h = humanLoad(w);

    const y = w.clock.date.getUTCFullYear();
    if (month === 5 && seasonYear !== y) {
      seasonYear = y;
      nestsThisSeason = 0; hatchlingsThisSeason = 0; predatedThisSeason = 0;
    }

    // Nesting. Females come ashore roughly December to February and may nest up to four times in a
    // season. Seventeen nests were recorded in 2017/18 from five or six females.
    if (month === 11 || month === 0 || month === 1) {
      const perDay = 19 / 90;
      if (rng.float() < perDay * dtDays) {
        const reach = pickOceanReach(dunes);
        nests.push({
          id: 'n' + (nests.length + nestsThisSeason),
          where: reach.label, x: reach.x, z: reach.z,
          laid: absDay(w.clock),
          eggs: Math.round(rng.range(100, 135)),
          // Sand temperature decides the sex ratio: warmer sand makes more females, and the
          // pivotal temperature is around 29 degrees. This is not decoration, it is the thing
          // that decides what a nesting beach is worth in forty years.
          sandTempC: (wx ? wx.tempC : 25) + rng.range(1.4, 3.6),
          aboveTideLine: rng.float() < 0.82
        });
        nestsThisSeason++;
        log.push({ day: w.clock.formatDate(), what: 'loggerhead nest laid', where: reach.label });
        w.bus.emit('ecology:nest', { species: 'Loggerhead turtle', where: reach.label, eggs: nests[nests.length - 1].eggs });
      }
    }

    for (let i = nests.length - 1; i >= 0; i--) {
      const n = nests[i];
      const age = absDay(w.clock) - n.laid;
      // Fox predation. The last recorded predation of a nest on this island was in late 2016, and
      // that is a baiting programme, not luck. Cut the line item and it comes back within seasons.
      if (rng.float() < 0.020 * (1 - 0.985 * foxControl) * dtDays) {
        nests.splice(i, 1); lostTo.fox++; predatedThisSeason++;
        log.push({ day: w.clock.formatDate(), what: 'turtle nest taken by a fox', where: n.where });
        w.bus.emit('ecology:alert', {
          id: 'turtle-nest-predation',
          text: `A fox took a loggerhead nest at ${n.where}. The last recorded nest predation on this `
            + 'island before this was in late 2016. That gap was a baiting programme, not luck.'
        });
        continue;
      }
      // Vehicles compacting the sand above the high tide line.
      if (rng.float() < 0.006 * (1 - 0.75 * beachClose) * dtDays) {
        nests.splice(i, 1); lostTo.vehicle++;
        log.push({ day: w.clock.formatDate(), what: 'turtle nest lost to vehicle compaction', where: n.where });
        continue;
      }
      // Storm tide washout, which is the dune system's problem showing up as a turtle problem.
      if (!n.aboveTideLine && tide && wx && tide.height > 2.0 && wx.swellM > 2.6 && rng.float() < 0.25 * dtDays) {
        nests.splice(i, 1); lostTo.tide++;
        log.push({ day: w.clock.formatDate(), what: 'turtle nest washed out', where: n.where });
        continue;
      }
      // Incubation. Warmer sand hatches faster and produces more females.
      const incubationDays = clamp(90 - (n.sandTempC - 26) * 7, 47, 78);
      if (age >= incubationDays) {
        const femaleShare = clamp(0.5 + (n.sandTempC - 29) * 0.22, 0.02, 0.98);
        // Lights. Hatchlings run to the brightest horizon, and on a dark beach that is the sea.
        const litShare = clamp(nearTownshipLight(n) * (1 - 0.6 * wardens), 0, 0.6);
        const toSea = Math.round(n.eggs * rng.range(0.72, 0.93) * (1 - litShare));
        if (litShare > 0.12) lostTo.light += Math.round(n.eggs * litShare * 0.7);
        hatchRing.add(toSea);
        hatchlingsThisSeason += toSea;
        nests.splice(i, 1);
        log.push({
          day: w.clock.formatDate(),
          what: `${toSea} loggerhead hatchlings to the water, ${Math.round(femaleShare * 100)} per cent female`,
          where: n.where
        });
        w.bus.emit('ecology:hatch', {
          species: 'Loggerhead turtle', where: n.where, hatchlings: toSea,
          femaleSharePct: Math.round(femaleShare * 100),
          sandTempC: +n.sandTempC.toFixed(1)
        });
      }
    }

    state.turtles = {
      loggerhead: {
        status: 'Endangered',
        nestsActive: nests.length,
        nestsThisSeason,
        hatchlingsThisSeason,
        predatedThisSeason,
        hatchlings365: Math.round(hatchRing.total),
        lostTo: { ...lostTo },
        published201718Nests: LOGGERHEAD.nests201718,
        publishedFemales: LOGGERHEAD.femalesEstimate,
        lastRecordedFoxPredation: LOGGERHEAD.lastRecordedFoxPredation,
        foxControlLevel: +foxControl.toFixed(2)
      },
      green: {
        status: 'Vulnerable',
        feedingPopulation: Math.round(greenTurtles),
        basis: 'Modelled resident feeding population on the seagrass. Moreton Bay holds green '
          + 'turtles of all size classes; nesting on this island is rare.'
      }
    };
  }

  function pickOceanReach(dunes) {
    if (dunes && Array.isArray(dunes.reaches) && dunes.reaches.length) {
      const ocean = dunes.reaches.filter((r) => r.exposure > 0.35);
      if (ocean.length) {
        const r = ocean[(rng.float() * ocean.length) | 0];
        return { label: r.label, x: r.x, z: r.z };
      }
    }
    return { label: 'the ocean beach', x: 7000, z: 6000 };
  }

  /** How much artificial light reaches this nesting beach. */
  function nearTownshipLight(n) {
    const towns = [{ x: 6673, z: 14367, r: 2200 }];   // the only township on the ocean side
    let v = 0;
    for (const t of towns) {
      const d = Math.hypot(n.x - t.x, n.z - t.z);
      v = Math.max(v, 1 - smoothstep(t.r * 0.4, t.r * 1.6, d));
    }
    return v * 0.55;
  }

  /* ---------------------------------------------------------------- reefs, runs, banks */

  function stepReefs(w, dtDays) {
    const h = humanLoad(w);
    const wx = w.read('weather');
    const moorings = L.level('ranger-program-funding');
    const diveable = wx ? clamp(1.5 - wx.swellM * 0.45, 0, 1) : 1;
    for (const r of REEFS) {
      const season = seasonal(r.season, w.clock);
      const divers = (h.visitors / 320 + 0.6) * diveable * season;
      r.diverPressure = +divers.toFixed(2);
      // Divers who crowd a cleaning station drive the animals off it, and divers who block the
      // gutters at Flat Rock move the sharks out. The code of conduct is the lever, not the fence.
      const code = clamp(0.45 + 0.45 * moorings, 0, 0.95);
      const crowding = clamp((divers - 3) / 8, 0, 1) * (1 - code);
      r.presence = clamp(season * (1 - crowding * 0.65), 0, 1);
      r.anchorDamage = clamp(r.anchorDamage + (r.greenZone ? 0 : divers * 0.0008 * (1 - moorings) - 0.002) * dtDays, 0, 1);
    }
    state.reefs = REEFS.map((r) => ({
      id: r.id, name: r.name,
      x: Math.round(r.x), z: Math.round(r.z),
      species: r.species,
      seasonNow: +seasonal(r.season, w.clock).toFixed(2),
      presence: +r.presence.toFixed(2),
      diversToday: r.diverPressure,
      greenZone: r.greenZone, moorings: r.moorings,
      anchorDamage: +r.anchorDamage.toFixed(3),
      protection: r.protection
    }));
  }

  function stepRuns(w) {
    state.runs = RUNS.map((r) => {
      const s = seasonal(r.season, w.clock);
      return {
        id: r.id, name: r.name, label: r.label,
        strength: +s.toFixed(2),
        on: s > 0.6,
        visibleFromTheBeach: r.id === 'sp-sea-mullet' && s > 0.7,
        note: r.note
      };
    });
  }

  function stepBanks(w, dtDays) {
    const h = humanLoad(w);
    const tide = w.read('tide');
    const out = tide ? tide.height < 0.9 : false;
    const season = seasonal({ jan: 0.9, feb: 0.9, mar: 0.85, apr: 0.75, may: 0.6, jun: 0.5,
      jul: 0.5, aug: 0.55, sep: 0.7, oct: 0.85, nov: 0.9, dec: 0.95 }, w.clock);
    const pumpers = out ? (h.visitors / 260 + h.residents / 700) * season * (h.holiday ? 1.6 : 1) : 0;

    // The commons. Everybody launches at the ramp, so the bank by the ramp gets worked over and
    // the one four kilometres away sits there full. Spreading the effort is the whole answer and
    // nobody does it, because the near bank is near.
    let weightSum = 0;
    for (const b of banks) { b.weight = 1 / Math.pow(1 + b.rampM / 400, 1.5); weightSum += b.weight; }
    for (const b of banks) {
      const effort = pumpers * (b.weight / Math.max(1e-6, weightSum));
      const take = effort * 0.0016 * dtDays / Math.max(1, b.areaHa / 60);
      const recovery = 0.0055 * (1 - b.density) * dtDays;
      b.density = clamp(b.density + recovery - take, 0.02, 1);
      b.pumpedToday = Math.round(effort);
      b.pumped365 += effort * dtDays;
    }
    state.yabbyBanks = banks.map((b) => ({
      id: b.id, label: b.label,
      x: Math.round(b.x), z: Math.round(b.z),
      metresFromRamp: b.rampM,
      density: +b.density.toFixed(3),
      pumpersToday: b.pumpedToday,
      exposedNow: out,
      state: b.density > 0.75 ? 'untouched' : b.density > 0.5 ? 'worked' : b.density > 0.28 ? 'hammered' : 'pumped out'
    }));

    // Pipi in the swash zone of the ocean beaches, which is exactly where the vehicles drive.
    const dunes = w.read('dunes');
    const vehicles = dunes && dunes.reaches
      ? dunes.reaches.filter((r) => r.exposure > 0.5).reduce((s, r) => s + r.vehiclesToday, 0) : 0;
    if (!state.pipi) state.pipi = { densityIndex: 0.8, vehiclesOnTheWetSand: 0 };
    state.pipi.densityIndex = +clamp(state.pipi.densityIndex
      + (0.0035 * (1 - state.pipi.densityIndex) - vehicles * 0.000022) * dtDays, 0.05, 1).toFixed(3);
    state.pipi.vehiclesOnTheWetSand = Math.round(vehicles);
    state.pipi.note = 'Beds sit in the swash zone, which is the firm wet sand vehicles drive on.';
  }

  /* ---------------------------------------------------------------- dolphins and calls */

  function stepDolphins(w, dtDays) {
    const h = humanLoad(w);
    for (const p of dolphinPods) {
      // Pods work a home range around the jetties and the channel edges.
      const ang = rng.range(0, Math.PI * 2);
      const step = rng.range(200, 900) * dtDays;
      let nx = p.x + Math.cos(ang) * step;
      let nz = p.z + Math.sin(ang) * step;
      const d = Math.hypot(nx - p.home.x, nz - p.home.z);
      if (d > 3200) { nx = p.home.x + (nx - p.home.x) * 0.5; nz = p.home.z + (nz - p.home.z) * 0.5; }
      if (w.island && !w.island.isLand(nx, nz)) { p.x = nx; p.z = nz; }
      // Boat strike and net entanglement. With about 128 Australian humpback dolphins in the whole
      // bay, one death is a significant event and the model treats it as one.
      const risk = (p.rare ? 0.00010 : 0.00016) * clamp(h.visitors / 900 + 0.4, 0.4, 3) * dtDays;
      if (p.size > 1 && rng.float() < risk) {
        p.size--;
        strandRing.add(1);
        log.push({ day: w.clock.formatDate(), what: `${p.species} lost to a vessel or net`, where: p.near });
        w.bus.emit('wildlife:call', {
          species: p.species, situation: 'dolphin struck or entangled',
          where: p.near, x: p.x, z: p.z,
          contact: 'Queensland marine stranding hotline 1300 130 372 (option 1)',
          significant: !!p.rare
        });
        if (p.rare) {
          w.bus.emit('ecology:alert', {
            id: 'humpback-dolphin-death',
            text: `An Australian humpback dolphin died near ${p.near}. There are about 128 of them in `
              + 'the whole of Moreton Bay, so that is one animal the population notices.'
          });
        }
      }
    }
    const bn = dolphinPods.filter((p) => !p.rare).reduce((s, p) => s + p.size, 0);
    const hd = dolphinPods.filter((p) => p.rare).reduce((s, p) => s + p.size, 0);
    state.dolphins = {
      bottlenoseNearIsland: bn,
      bottlenoseBayCount: DOLPHINS.bottlenoseBay,
      bottlenoseBayCi: DOLPHINS.bottlenoseCi,
      humpbackDolphinNearIsland: hd,
      humpbackDolphinBayCount: DOLPHINS.humpbackDolphinBay,
      humpbackDolphinBayCi: DOLPHINS.humpbackDolphinCi,
      pods: dolphinPods.map((p) => ({
        id: p.id, species: p.species, size: p.size,
        x: Math.round(p.x), z: Math.round(p.z), near: p.near, rare: !!p.rare
      })),
      note: 'Bay counts are bay counts. The island numbers are the animals whose home range takes '
        + 'them past the island jetties and the channel edges.'
    };
  }

  /** Fishing gear on seabirds and pelicans is the island's commonest wildlife call. */
  function stepGearCalls(w, dtDays) {
    const h = humanLoad(w);
    const runs = state.runs || [];
    const fishing = runs.reduce((s, r) => s + r.strength, 0) / Math.max(1, runs.length);
    const rate = 0.10 * (0.5 + fishing) * clamp(h.visitors / 900 + 0.5, 0.5, 3);
    if (rng.float() < rate * dtDays) {
      gearRing.add(1);
      const where = ['One Mile Jetty', 'Amity Point jetty', 'Dunwich Foreshore', 'the Point Lookout gutters'][(rng.float() * 4) | 0];
      w.bus.emit('wildlife:call', {
        species: 'Seabird or pelican',
        situation: 'fishing gear on a bird',
        where, contact: 'Wildlife Rescue Minjerribah 0448 466 556',
        publicRule: 'Watch, keep back, call. Nobody pulls a hook.'
      });
    }
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'marine',
    phase: 'ecology',
    order: 60,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      stepSeagrass(w, 1);
      stepTurtles(w, 1);
      stepReefs(w, 1);
      stepRuns(w);
      stepBanks(w, 1);
      stepDolphins(w, 1);
      publish(w);
      lastDay = absDay(w.clock);
      notes.push('Every count that comes from a Moreton Bay survey is labelled as a bay count. The '
        + "island's share is a separate number and it is modelled.");
      notes.push('Loggerhead nesting is calibrated to the seventeen nests recorded in the 2017/18 '
        + 'season from an estimated five or six females. Sex ratio follows sand temperature about a '
        + 'pivotal 29 degrees, which is a general turtle figure and not an island measurement.');
      w.bus.emit('marine:ready', { patches: patches.length, banks: banks.length });
    },

    tick(w) {
      if (!state.ready) return;
      const day = absDay(w.clock);
      if (day === lastDay) {
        // The yabby banks are a tide question, so they get looked at more often than once a day.
        if (w.clock.tick % 18 === 0) stepBanks(w, 18 / 144);
        return;
      }
      lastDay = day;
      strandRing.roll(); gearRing.roll(); hatchRing.roll();
      stepSeagrass(w, 1);
      stepTurtles(w, 1);
      stepReefs(w, 1);
      stepRuns(w);
      stepDolphins(w, 1);
      stepGearCalls(w, 1);
      publish(w);
    },

    describe(w) {
      const t = state.turtles || {};
      return {
        seagrass: state.seagrass ? state.seagrass.meanShootDensity : 0,
        turbidity: state.seagrass ? state.seagrass.turbidity : 0,
        grazed: state.seagrass ? state.seagrass.grazedPatches : 0,
        dugong: state.dugong ? state.dugong.onEasternBanks : 0,
        greenTurtles: t.green ? t.green.feedingPopulation : 0,
        nests: t.loggerhead ? t.loggerhead.nestsActive : 0,
        nestsSeason: t.loggerhead ? t.loggerhead.nestsThisSeason : 0,
        hatchlings365: t.loggerhead ? t.loggerhead.hatchlings365 : 0,
        foxTaken: t.loggerhead ? t.loggerhead.lostTo.fox : 0,
        bottlenose: state.dolphins ? state.dolphins.bottlenoseNearIsland : 0,
        humpbackDolphin: state.dolphins ? state.dolphins.humpbackDolphinNearIsland : 0,
        mullet: state.runs[0] ? state.runs[0].strength : 0,
        tailor: state.runs[1] ? state.runs[1].strength : 0,
        reef: state.reefs.map((r) => r.presence),
        yabbies: state.yabbyBanks.map((b) => b.density),
        pipi: state.pipi ? state.pipi.densityIndex : 0,
        strandings365: Math.round(strandRing.total),
        gearCalls365: Math.round(gearRing.total)
      };
    },

    save() {
      return {
        turbidity, greenTurtles, nestsThisSeason, hatchlingsThisSeason, predatedThisSeason, seasonYear,
        lostTo: { ...lostTo },
        patches: patches.map((p) => ({ id: p.id, shoots: p.shoots, grazedBy: p.grazedBy })),
        herds: herds.map((h) => ({ ...h })),
        pods: dolphinPods.map((p) => ({ id: p.id, size: p.size, x: p.x, z: p.z })),
        nests: nests.slice(),
        banks: banks.map((b) => ({ id: b.id, density: b.density, pumped365: b.pumped365 })),
        reefs: REEFS.map((r) => ({ id: r.id, presence: r.presence, anchorDamage: r.anchorDamage })),
        pipi: state.pipi,
        strand: strandRing.save(), gear: gearRing.save(), hatch: hatchRing.save(), log: log.save()
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      turbidity = s.turbidity || 0;
      greenTurtles = s.greenTurtles || 900;
      nestsThisSeason = s.nestsThisSeason || 0;
      hatchlingsThisSeason = s.hatchlingsThisSeason || 0;
      predatedThisSeason = s.predatedThisSeason || 0;
      seasonYear = s.seasonYear ?? -1;
      Object.assign(lostTo, s.lostTo || {});
      for (const p0 of s.patches || []) {
        const p = patches.find((x) => x.id === p0.id);
        if (p) { p.shoots = p0.shoots; p.grazedBy = p0.grazedBy; }
      }
      herds = (s.herds || []).map((h) => ({ ...h }));
      for (const p0 of s.pods || []) {
        const p = dolphinPods.find((x) => x.id === p0.id);
        if (p) { p.size = p0.size; p.x = p0.x; p.z = p0.z; }
      }
      nests = (s.nests || []).slice();
      for (const b0 of s.banks || []) {
        const b = banks.find((x) => x.id === b0.id);
        if (b) { b.density = b0.density; b.pumped365 = b0.pumped365; }
      }
      for (const r0 of s.reefs || []) {
        const r = REEFS.find((x) => x.id === r0.id);
        if (r) { r.presence = r0.presence; r.anchorDamage = r0.anchorDamage; }
      }
      if (s.pipi) state.pipi = s.pipi;
      strandRing.load(s.strand); gearRing.load(s.gear); hatchRing.load(s.hatch); log.load(s.log);
      publish(w);
    }
  });

  function publish(w) {
    state.strandings365 = Math.round(strandRing.total);
    state.gearCalls365 = Math.round(gearRing.total);
    state.events = log.recent(6);
    state.levers = L.snapshot(['feral-and-weed-control', 'beach-driving-seasonal-closures',
      'ranger-program-funding', 'sewer-network-extension']);
    const sg = state.seagrass || { meanShootDensity: 0 };
    const t = state.turtles && state.turtles.loggerhead ? state.turtles.loggerhead : { hatchlings365: 0 };
    state.civicMetrics = {
      seagrass_condition: metric(sg.meanShootDensity),
      dugong_population: metric((state.dugong ? state.dugong.onEasternBanks : 0) / 700),
      turtle_hatchlings: metric(t.hatchlings365 / 1600),
      water_quality_nearshore: metric(clamp(0.8 - turbidity * 0.55, 0, 1))
    };
    // Shorebirds ask about the food on the flats, so the answer is hung off the read model as a
    // function rather than pushed at them.
    if (!state.yabbyDensityAt) {
      Object.defineProperty(state, 'yabbyDensityAt', {
        value: (x, z) => {
          let best = 0.6, bd = 1e18;
          for (const b of banks) {
            const d = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
            if (d < bd) { bd = d; best = b.density; }
          }
          return bd < 4000 * 4000 ? best : 0.6;
        },
        enumerable: false
      });
    }
  }
}
