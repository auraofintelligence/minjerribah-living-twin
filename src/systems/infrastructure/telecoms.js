// Telecoms. Where the signal is, where it is not, and what happens when everybody rings at once.
//
// WHAT IS PUBLISHED. Almost nothing, and this file says so loudly rather than quietly. No tower
// register, no carrier footprint, no NBN technology split and no outage record for this island is
// in any pack read here. What the packs do carry is two observations from people who live here, and
// they are worth more than a coverage map from a carrier's marketing page:
//
//   * data/places.json lists "limited mobile coverage" as a hazard of Naree Budjong Djara National
//     Park. Not slow. Limited. In the middle of the island.
//   * data/residents.json household_archetypes.ferry-commuter-family-dunwich has a weekday line
//     that reads, in full: "Ferry home, phone signal drops halfway across."
//   * data/residents.json household_archetypes.sea-change-remote-professional-point-lookout lists
//     "internet and mobile coverage" first among its pressure points. First. Ahead of the school
//     run and ahead of the employer changing its mind about remote work.
//
// So the design brief for this file was written by three islanders and it is: the middle of the
// island has no signal, the middle of the crossing has no signal, and the people whose livelihood
// depends on it are the ones who notice.
//
// HOW THE DEAD SPOTS ARE FOUND. Not by hand. The sites are placed at the three township centres,
// which is where the people are and which is the only honest place to put a mast when no register
// was found, and then coverage is computed against the actual heightfield: distance, an exponent
// for vegetated ground, and a knife-edge diffraction term over whatever ridge is in the way. The
// interior of this island is a Pleistocene dune field running to 228 m at Mount Hardgrave. That
// ridge is why there is no signal at Blue Lake, and this file works it out rather than asserting it.
// If somebody later adds a real tower register to a pack, the same code produces a different and
// better map without a line changing.
//
// FAILURE MODES A PLAYER CAUSES AND THEN LIVES WITH
//   1. The shedding order. A mobile site runs on its own battery when the power goes. Modelled at
//      six hours, which is generous. Put telecoms low in power.js's shedding order and the phones
//      do not go out when the power does: they go out six hours later, in the dark, after everybody
//      has already stopped worrying about the power. That delay is the whole trap.
//   2. Ringing at once. A cell has a finite number of simultaneous calls. On a fire day or after a
//      crash, everybody on the island rings somebody, and the call that matters gets a fast busy.
//      This is modelled with Erlang B, which is the same formula a carrier sizes a cell with.
//   3. Growth without capacity. Every extra visitor shares the same site. A January Saturday at
//      Point Lookout is one cell carrying five thousand phones, and it degrades for residents at
//      exactly the moment the island stops being able to absorb anything.
//   4. The backhaul. Every fixed service on the island runs back to the mainland through one path
//      under the bay. It is modelled, it is labelled modelled, and when it is out nothing fixed works.
//
// Determinism: world.rng.stream('telecoms'). No Math.random, no Date.now.

import {
  clamp, ecoGrid, places, townshipShares, servedPopulation, nudge,
  hoursMinutes, Rolling, EventLog, TICK_HOURS
} from './infra-common.js';

/* ------------------------------------------------------------------ the sites

Placed at the three township centres from data/places.json. Modelled: no tower register was found
for this island in any pack, and the packs are explicit about what they do and do not contain.
Mast height, power and channel count are chosen for a rural macro cell. */

const SITES = [
  { id: 'site-dunwich', label: 'Dunwich', placeId: 'dunwich', mastM: 32, eirpDbm: 61, channels: 210, dataMbps: 480, batteryHours: 6 },
  { id: 'site-point-lookout', label: 'Point Lookout', placeId: 'point-lookout', mastM: 30, eirpDbm: 61, channels: 210, dataMbps: 480, batteryHours: 6 },
  { id: 'site-amity-point', label: 'Amity Point', placeId: 'amity-point', mastM: 26, eirpDbm: 58, channels: 120, dataMbps: 260, batteryHours: 6 }
];

/**
 * A fourth signal source standing for the mainland network, placed at the Cleveland passenger
 * terminal from data/transport.json. It exists so the crossing has two ends and the gap in the
 * middle comes out of the geometry instead of being written in. It is not a claim about a tower.
 */
const MAINLAND = {
  id: 'mainland-network', label: 'The mainland network (modelled)',
  terminalId: 'terminal-toondah-passenger', mastM: 40, eirpDbm: 62, channels: 0, dataMbps: 0, batteryHours: 0
};

/** Signal thresholds in dBm. The usual industry bands, and they are what a phone shows as bars. */
const BANDS = [
  { id: 'good', minDbm: -85, label: 'full bars' },
  { id: 'fair', minDbm: -100, label: 'usable' },
  { id: 'marginal', minDbm: -112, label: 'a call if you stand still' },
  { id: 'none', minDbm: -999, label: 'nothing' }
];
/** Two thresholds, because they are two different questions and merging them hides the answer.
 *  A call needs less signal than data does, which is why the ferry still rings and will not load. */
const CALL_DBM = -105;
const DATA_DBM = -95;

/**
 * Vegetation, counted twice and for two different reasons.
 *
 * PATH_VEG is decibels per kilometre of path through that cover, integrated along the ray and
 * capped, because a radio path through fifteen kilometres of eucalypt forest is not the same
 * problem as a radio path through fifteen kilometres of bay. This is the term that decides where
 * the coverage edge falls on this island, and it is why an island of dune forest behaves nothing
 * like a flat open plain of the same size.
 *
 * LOCAL_CLUTTER is what is over the phone itself: standing under a canopy costs a few decibels
 * that standing on the beach does not. Small, and separate, because they are separate things.
 *
 * Both are modelled. Measured attenuation for Australian dry sclerophyll at 850 MHz is not in any
 * pack read here.
 */
const PATH_VEG = {
  forest: 3.2, swamp: 1.6, heath: 1.4, rehab: 1.2, mangrove: 2.4, foredune: 0.4,
  beach: 0.15, rock: 0.1, water: 0, lake: 0, saltmarsh: 0.3, cleared: 0.4, urban: 0.9
};
const PATH_VEG_CAP_DB = 26;
const LOCAL_CLUTTER = {
  forest: 6, swamp: 3, heath: 2, rehab: 2, mangrove: 5, foredune: 1,
  beach: 0, rock: 0, water: 0, lake: 0, saltmarsh: 1, cleared: 1, urban: 4
};

/** Places the read model reports a signal for by name, so a panel has something a local recognises. */
const REPORT_PLACES = [
  'dunwich', 'point-lookout', 'amity-point', 'one-mile-jetty', 'blue-lake', 'brown-lake',
  'main-beach', 'flinders-beach', 'north-gorge-walk', 'cylinder-beach', 'myora-springs',
  'naree-budjong-djara-national-park', 'amity-jetty', 'dunwich-ferry-terminal'
];

export function registerTelecoms(world) {
  const rng = world.rng.stream('telecoms');
  const log = new EventLog(30);

  const state = world.publish('telecoms', {
    ready: false,
    basis: 'No tower register, carrier footprint, NBN technology split or outage record for this '
      + 'island is published in any pack read here. The sites are placed at the three township '
      + 'centres because that is where the people are, and the coverage is computed against the '
      + 'real heightfield rather than drawn. Two observations are from the packs and are the reason '
      + 'this file exists: "limited mobile coverage" as a hazard of the national park, and "ferry '
      + 'home, phone signal drops halfway across".',

    coverage: {
      landUsablePct: 0, landGoodPct: 0,
      byBand: {}, byPlace: {}, deadSpots: [],
      note: ''
    },

    crossing: {
      profile: [], lengthKm: 0, worstDbm: 0, worstAtKm: 0, gapKm: 0, callGapKm: 0,
      vesselLossDb: 0, seawardLossDb: 0, sentence: '',
      note: 'Sampled along the line from the Dunwich terminal to the Cleveland terminal, both from '
        + 'data/transport.json. The gap in the middle is geometry plus the hull of the boat, not an '
        + 'assertion. data/residents.json already records an islander whose weekday reads "Ferry '
        + 'home, phone signal drops halfway across".'
    },

    sites: [],
    sitesUp: 0, sitesOnBattery: 0, sitesDown: 0,

    mobile: {
      subscribers: 0, activeCalls: 0, offeredErlangs: 0, channels: 0,
      blockingPct: 0, gradeOfService: 'normal',
      dataMbpsPerUser: 0, congestion: 0
    },

    emergency: {
      surge: 1, callsAttempted: 0, callsBlocked: 0, blockedRolling365: 0,
      triple0AtRisk: false, reason: '', vhfNote: 'Marine Rescue Queensland is raised on VHF Channel '
        + '16 or Triple Zero. When the mobile network is blocked, the radio is not. '
        + '(data/transport.json emergency_transport)'
    },

    nbn: {
      connections: 0, backhaulUp: true, backhaulOutageMinutes: 0,
      eveningCongestion: 0, mbpsTypicalEvening: 0, byTech: {},
      note: 'Every fixed service on this island runs back to the mainland through one modelled path '
        + 'under the bay. No published NBN technology split for this island was found.'
    },

    outage: { on: false, cause: null, minutes: 0, sinceDay: null, minutesRolling365: 0 },
    powerKw: 0,
    events: [],
    notes: []
  });

  /* -------------------------------------------------------------- runtime */

  const notes = state.notes;
  const sites = [];
  let mainland = null;
  let g = null;
  let best = null;          // Float32Array of best dBm per grid cell, live sites only
  let bestSite = null;      // Uint8Array of which site index wins, 255 for none
  let coverageDirty = true;
  let landCells = 0;

  let lastDay = -1;
  let outageOn = false, outageCause = null, outageMinutes = 0, outageSinceDay = null;
  let backhaulUp = true, backhaulDaysLeft = 0, backhaulOutageMinutes = 0;
  let dayBlocked = 0;
  const blocked365 = new Rolling(365);
  const outageMinutes365 = new Rolling(365);
  let dayOutageMinutes = 0;
  let surgeUntilTick = -1;
  let surgeReason = '';
  let deadSpotsAnnounced = false;

  world.bus.on('ui:intent', (p) => {
    if (!p || typeof p.kind !== 'string' || !p.kind.startsWith('telecoms:')) return;
    if (p.kind === 'telecoms:site-battery' && Number.isFinite(p.hours)) {
      for (const s of sites) s.batteryHours = clamp(p.hours, 0, 96);
    } else if (p.kind === 'telecoms:backhaul-fault') {
      breakBackhaul(world, 'requested for a scenario');
    }
  });

  // A fire, a crash, a storm or a power cut is when everybody rings at once. These are the events
  // that make the network the thing that fails rather than the thing that helps.
  world.bus.on('fire:started', () => surge(world, 14, 'a fire on the island'));
  world.bus.on('fire:escalated', () => surge(world, 18, 'a fire on the island'));
  world.bus.on('power:shedding', () => surge(world, 4, 'the power is off'));
  world.bus.on('power:cable-fault', () => surge(world, 6, 'the cable under the bay is out'));
  world.bus.on('water:boil-notice', () => surge(world, 2.5, 'a boil water notice'));
  world.bus.on('weather:change', (p) => {
    if (p && (p.synoptic === 'eastcoastlow')) surge(world, 3.5, 'an east coast low');
  });

  function surge(w, multiplier, reason) {
    // Two hours of everybody ringing. A surge does not replace a bigger one already running.
    const until = w.clock.tick + 12;
    if (until > surgeUntilTick || multiplier > (state.emergency.surge || 1)) {
      surgeUntilTick = until;
      surgeReason = reason;
      state.emergency.surge = multiplier;
    }
  }

  /* -------------------------------------------------------------- the coverage field */

  function buildField(w) {
    g = ecoGrid(w);
    if (!g.ready) {
      notes.push('The island grid is not available, so no coverage field was built.');
      return;
    }
    const island = w.island;
    landCells = g.land.length;

    const all = SITES.map((spec) => {
      const p = places(w).get(spec.placeId);
      return {
        ...spec,
        found: !!p,
        x: p ? p.x : 0, z: p ? p.z : 0,
        groundM: p ? p.y : island.seaLevel,
        on: true, onBattery: false, batteryLeftHours: spec.batteryHours,
        field: new Float32Array(g.n)
      };
    });
    // The mainland source, from the transport pack's terminal coordinate.
    const tp = (w.data.transport && w.data.transport.terminals || []).find((t) => t.id === MAINLAND.terminalId);
    if (tp && Number.isFinite(tp.lon)) {
      const xz = island.project(tp.lon, tp.lat);
      mainland = {
        ...MAINLAND, found: true, x: xz.x, z: xz.z, groundM: island.seaLevel + 8,
        on: true, onBattery: false, batteryLeftHours: 0, field: new Float32Array(g.n), isMainland: true
      };
    } else {
      notes.push('data/transport.json has no Cleveland passenger terminal coordinate, so the '
        + 'mainland side of the crossing is not modelled and the crossing profile is island-side only.');
    }

    for (const s of all) {
      if (!s.found) {
        notes.push(`data/places.json has no coordinate for ${s.label}, so no site was placed there.`);
        s.field.fill(-999);
        continue;
      }
      computeSiteField(s);
      sites.push(s);
    }
    if (mainland) computeSiteField(mainland);

    best = new Float32Array(g.n);
    bestSite = new Uint8Array(g.n);
    coverageDirty = true;
  }

  /**
   * One site's field over the whole grid.
   *
   * The path loss is COST 231 Hata in its suburban form, which is the model a carrier actually
   * plans a rural macro cell with, at 850 MHz, which is the band that carries rural coverage in
   * Australia. It is used rather than a free-space exponent because free space is wrong by twenty
   * decibels at ten kilometres and twenty decibels is the difference between an island with
   * coverage everywhere and the island the packs describe.
   *
   *   L = A + B log10(d_km),  A = 46.3 + 33.9 log10(f) - 13.82 log10(hb) - a(hm)
   *                           B = 44.9 - 6.55 log10(hb)
   *
   * Over water the ground is flat, wet and reflective and the path behaves much better, so B is
   * blended toward an open-water value by the share of the ray that is over the bay. That is what
   * lets a phone work off Amity on a boat and not work at Blue Lake three kilometres closer.
   *
   * Then a single knife-edge diffraction term for the worst intrusion into the first Fresnel zone
   * along the ray, and the loss through whatever is growing where the phone is. The ray is marched
   * over the cached 256 m heightfield rather than through island.height, which is the difference
   * between fifty milliseconds at boot and five seconds.
   */
  function computeSiteField(s) {
    const H = g.height, nx = g.nx, nz = g.nz, cell = g.cell;
    const txY = s.groundM + s.mastM;
    const si = Math.round((s.x - g.x0) / cell);
    const sj = Math.round((s.z - g.z0) / cell);
    const F = s.field;
    const covers = g.covers;
    const isLand = g.isLand;

    const f = 850;                          // MHz
    const lf = Math.log10(f);
    const hb = Math.max(12, s.mastM);       // effective mast height
    const hm = 1.5;                         // a phone in a hand
    const aHm = (1.1 * lf - 0.7) * hm - (1.56 * lf - 0.8);
    // Hata's open-area correction. This island is not a suburb: outside the three townships it is
    // dune, heath and swamp with no buildings at all, and the model's urban form is twenty-eight
    // decibels wrong about that. The vegetation is not ignored, it is counted separately below,
    // which is the right decomposition rather than burying trees inside a clutter constant.
    const OPEN = -4.78 * lf * lf + 18.33 * lf - 40.94;
    const A = 46.3 + 33.9 * lf - 13.82 * Math.log10(hb) - aHm + OPEN;
    const B_LAND = 44.9 - 6.55 * Math.log10(hb);
    const B_WATER = B_LAND * 0.74;          // flat, wet and reflective: modelled

    // Beyond this there is nothing worth computing: the signal is forty decibels under the floor.
    const MAX_M = 30000;

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const dx = (i - si) * cell, dz = (j - sj) * cell;
        const dMetres = Math.sqrt(dx * dx + dz * dz);
        if (dMetres > MAX_M) { F[k] = -999; continue; }
        const dKm = Math.max(0.05, dMetres / 1000);

        // March the line once and take three things off it: the worst intrusion into the first
        // Fresnel zone, how much of the path is over water, and how much vegetation it goes through.
        let worst = -1e9, waterSteps = 0, steps = 0, vegDb = 0;
        const rxY = H[k] + hm;
        const n = Math.min(90, Math.max(2, Math.round(dMetres / cell)));
        const segKm = dKm / n;
        for (let t = 1; t < n; t++) {
          const u = t / n;
          const pi = (si + (i - si) * u) | 0, pj = (sj + (j - sj) * u) | 0;
          if (pi < 0 || pj < 0 || pi >= nx || pj >= nz) continue;
          const kk = pj * nx + pi;
          steps++;
          if (!isLand[kk]) waterSteps++;
          vegDb += (PATH_VEG[covers[g.cover[kk]]] ?? 1) * segKm;
          // The earth is round and the bay is 12 km wide, so at the far end of Main Beach the
          // horizon is doing more than the dunes are. Four-thirds earth radius, the standard
          // refraction allowance, which is why a 60 m mast reaches further than the geometry says.
          const d1 = dMetres * u, d2 = dMetres * (1 - u);
          const bulge = (d1 * d2) / (2 * 8495000);
          const terr = H[kk] + bulge;
          const lineY = txY + (rxY - txY) * u;
          // First Fresnel radius at 850 MHz: sqrt(lambda d1 d2 / d), lambda about 0.353 m.
          const fres = Math.sqrt(0.353 * d1 * d2 / Math.max(1, dMetres));
          const intrusion = terr - (lineY - 0.6 * fres);
          if (intrusion > worst) worst = intrusion;
        }
        const waterShare = steps > 0 ? waterSteps / steps : 0;
        const Bmix = B_LAND + (B_WATER - B_LAND) * waterShare;
        const loss = A + Bmix * Math.log10(dKm);

        let diffraction = 0;
        if (worst > 0) {
          // Single knife edge, capped at 34 dB. A dune ridge you cannot talk over is a dune ridge
          // you cannot talk over, and the extra decibels past that change nothing a player sees.
          const v = worst / 30;
          diffraction = Math.min(34, 6.9 + 20 * Math.log10(Math.sqrt(v * v + 1) + v));
        }

        const coverName = covers[g.cover[k]] || 'water';
        const clutter = LOCAL_CLUTTER[coverName] ?? 2;
        F[k] = s.eirpDbm - loss - diffraction - Math.min(PATH_VEG_CAP_DB, vegDb) - clutter;
      }
    }
  }

  function refreshBest() {
    if (!g || !g.ready) return;
    best.fill(-999);
    bestSite.fill(255);
    const live = [];
    for (let i = 0; i < sites.length; i++) if (sites[i].on) live.push(i);
    for (const idx of live) {
      const F = sites[idx].field;
      for (let k = 0; k < g.n; k++) {
        if (F[k] > best[k]) { best[k] = F[k]; bestSite[k] = idx; }
      }
    }
    coverageDirty = false;
    summariseCoverage();
  }

  function bandOf(dbm) {
    for (const b of BANDS) if (dbm >= b.minDbm) return b.id;
    return 'none';
  }

  function summariseCoverage() {
    const counts = { good: 0, fair: 0, marginal: 0, none: 0 };
    for (let n = 0; n < g.land.length; n++) {
      counts[bandOf(best[g.land[n]])]++;
    }
    const total = Math.max(1, g.land.length);
    state.coverage.byBand = {
      good: +(counts.good / total).toFixed(3),
      fair: +(counts.fair / total).toFixed(3),
      marginal: +(counts.marginal / total).toFixed(3),
      none: +(counts.none / total).toFixed(3)
    };
    state.coverage.landUsablePct = +((counts.good + counts.fair) / total * 100).toFixed(1);
    state.coverage.landGoodPct = +(counts.good / total * 100).toFixed(1);

    const byPlace = {};
    const P = places(world);
    for (const id of REPORT_PLACES) {
      const p = P.get(id);
      if (!p) continue;
      const k = g.at(p.x, p.z);
      const dbm = best[k];
      byPlace[id] = { name: p.name, dbm: +dbm.toFixed(0), band: bandOf(dbm) };
    }
    state.coverage.byPlace = byPlace;

    // The dead spots, named from the places table rather than invented. A dead spot that has a
    // published name is worth reporting; an unnamed grid cell is not.
    const dead = [];
    for (const [id, row] of Object.entries(byPlace)) {
      if (row.band === 'none' || row.band === 'marginal') dead.push({ id, name: row.name, dbm: row.dbm, band: row.band });
    }
    dead.sort((a, b) => (a.dbm - b.dbm) || (a.id < b.id ? -1 : 1));
    state.coverage.deadSpots = dead;
    state.coverage.note = `${state.coverage.landUsablePct.toFixed(0)} per cent of the island's land has a `
      + 'usable signal from a site at one of the three townships. The rest is the interior: the old '
      + 'dune field runs to 228 m at Mount Hardgrave and the ridge is between the towns and the lakes. '
      + 'data/places.json already lists limited mobile coverage as a hazard of the national park, and '
      + 'this is that hazard worked out from the terrain.';
  }

  /**
   * The crossing profile, which is the line islanders actually complain about.
   *
   * Two things make the middle of the bay a hole and neither of them is invented. The obvious one
   * is distance: at the midpoint you are six kilometres from both ends and nobody plans a cell to
   * cover open water. The one people forget is that you are inside a boat. A catamaran hull and a
   * vehicle deck are a Faraday cage with windows, and eighteen decibels of it is a modest estimate.
   * That is the number that turns a marginal signal into no signal, and it is why the phone works
   * on the top deck at Dunwich and dies in the cabin ten minutes later.
   */
  const VESSEL_LOSS_DB = 18;
  /**
   * And the part people do not think of: a township cell is pointed at the township. Sector
   * antennas have a front-to-back ratio around twenty-five decibels, and there is no commercial
   * reason to put a sector on open water where nobody lives and nobody pays a bill. Twenty decibels
   * of it is modelled here, which is conservative.
   */
  const SEAWARD_LOSS_DB = 20;

  function buildCrossing(w) {
    const P = places(w);
    const dun = P.get('dunwich-ferry-terminal') || P.get('dunwich');
    if (!dun || !mainland) return;
    const steps = 24;
    const profile = [];
    let worst = 1e9, worstAt = 0, dataGapSteps = 0, callGapSteps = 0;
    for (let t = 0; t <= steps; t++) {
      const f = t / steps;
      const x = dun.x + (mainland.x - dun.x) * f;
      const z = dun.z + (mainland.z - dun.z) * f;
      const k = g.at(x, z);
      let dbm = -999;
      for (const s of sites) if (s.on && s.field[k] > dbm) dbm = s.field[k];
      if (mainland.field[k] > dbm) dbm = mainland.field[k];
      // Off the end of the pontoon you are already off the back of the antenna, and once the doors
      // shut you are inside the hull as well. Both are eased in over the first kilometre so the
      // profile is a curve and not a cliff at the wharf.
      const away = Math.min(1, Math.min(f, 1 - f) * steps / 2);
      dbm -= (VESSEL_LOSS_DB + SEAWARD_LOSS_DB) * away;
      const km = Math.sqrt(Math.pow(x - dun.x, 2) + Math.pow(z - dun.z, 2)) / 1000;
      profile.push({ km: +km.toFixed(1), dbm: +dbm.toFixed(0), band: bandOf(dbm) });
      if (dbm < worst) { worst = dbm; worstAt = km; }
      if (dbm < DATA_DBM) dataGapSteps++;
      if (dbm < CALL_DBM) callGapSteps++;
    }
    const totalKm = profile[profile.length - 1].km;
    state.crossing.profile = profile;
    state.crossing.lengthKm = +totalKm.toFixed(1);
    state.crossing.worstDbm = +worst.toFixed(0);
    state.crossing.worstAtKm = +worstAt.toFixed(1);
    state.crossing.gapKm = +(totalKm * dataGapSteps / (steps + 1)).toFixed(1);
    state.crossing.callGapKm = +(totalKm * callGapSteps / (steps + 1)).toFixed(1);
    state.crossing.vesselLossDb = VESSEL_LOSS_DB;
    state.crossing.seawardLossDb = SEAWARD_LOSS_DB;
    state.crossing.sentence = state.crossing.gapKm > 0.3
      ? `About ${state.crossing.gapKm} km of the ${totalKm.toFixed(1)} km crossing has no working `
        + `data inside the vessel, worst at ${state.crossing.worstAtKm} km out`
        + (state.crossing.callGapKm > 0.3 ? `, and ${state.crossing.callGapKm} km of it will not hold a call.` : '. A call still gets through.')
      : 'The signal holds all the way across on this model, which does not match what islanders say. '
        + 'Worth a look before anybody trusts it.';
  }

  /* -------------------------------------------------------------- traffic

  Erlang B, the same formula a carrier sizes a cell with. A is the offered traffic in erlangs and N
  is the number of simultaneous calls the site can carry. The recursion is exact and it is cheap. */

  function erlangB(N, A) {
    if (N <= 0) return 1;
    let b = 1;
    for (let n = 1; n <= N; n++) b = (A * b) / (n + A * b);
    return b;
  }

  function stepTraffic(w) {
    const pop = servedPopulation(w);
    const shares = townshipShares(w);
    const hour = w.clock.hour;
    const surgeOn = w.clock.tick <= surgeUntilTick;
    const mult = surgeOn ? state.emergency.surge : 1;
    if (!surgeOn && state.emergency.surge !== 1) { state.emergency.surge = 1; surgeReason = ''; }

    // Busy hour shape. People ring in the morning and in the evening and not at four o'clock.
    const shape = [0.15, 0.08, 0.05, 0.05, 0.08, 0.2, 0.5, 0.85, 1.0, 0.95, 0.9, 0.9,
      0.95, 0.9, 0.85, 0.85, 0.95, 1.0, 0.95, 0.85, 0.7, 0.5, 0.32, 0.22][hour];

    let totalChannels = 0, totalOffered = 0, totalBlockedCalls = 0, totalActive = 0;
    let totalDataMbps = 0, totalUsers = 0;

    for (const s of sites) {
      const share = shares[s.id.replace('site-', '')] ?? (1 / sites.length);
      const here = pop.total * share;
      totalUsers += here;
      // 0.022 erlangs a person in the busy hour is a normal residential figure: about eighty
      // seconds of call an hour each. Modelled.
      const offered = here * 0.022 * shape * mult;
      const channels = s.on ? s.channels : 0;
      const blocking = channels > 0 ? erlangB(channels, offered) : 1;
      const carried = offered * (1 - blocking);
      totalChannels += channels;
      totalOffered += offered;
      totalActive += carried;
      // Attempts a tick, ten minutes' worth, times the blocking probability.
      const attempts = here * 0.03 * shape * mult * (TICK_HOURS);
      totalBlockedCalls += attempts * blocking;
      totalDataMbps += s.on ? s.dataMbps : 0;
      s.blocking = blocking;
      s.offered = offered;
      s.here = here;
    }

    // Data. Everybody on the island shares whatever the live sites carry, and the evening is when
    // it hurts, and the people it hurts are the ones whose work is on the other end of it.
    const dataShape = [0.2, 0.1, 0.06, 0.05, 0.06, 0.12, 0.3, 0.5, 0.6, 0.6, 0.6, 0.62,
      0.65, 0.62, 0.6, 0.65, 0.75, 0.9, 1.0, 1.0, 0.95, 0.8, 0.55, 0.35][hour];
    // Nine per cent of everybody pulling data at the same moment in the busiest hour. Modelled: a
    // rule of thumb, not a measurement, and the one number that decides whether the island's remote
    // workers can do their job in January.
    const activeUsers = Math.max(1, totalUsers * 0.09 * dataShape);
    const perUser = totalDataMbps / activeUsers;

    return {
      channels: totalChannels, offered: totalOffered, active: totalActive,
      blockedCalls: totalBlockedCalls,
      blocking: totalOffered > 0 ? clamp(totalBlockedCalls / Math.max(0.001, totalUsers * 0.03 * shape * mult * TICK_HOURS), 0, 1) : 0,
      perUser, users: totalUsers, activeUsers, surgeOn, mult
    };
  }

  /* -------------------------------------------------------------- power and faults */

  function stepPower(w) {
    const pw = w.read('power');
    let shed = false;
    if (pw && pw.shedding && pw.shedding.on) {
      for (const b of pw.shedding.blocks || []) if (b.id === 'telecoms-sites') shed = true;
    }
    let up = 0, onBattery = 0, down = 0;
    let changed = false;
    for (const s of sites) {
      if (shed) {
        if (s.batteryLeftHours > 0) {
          s.batteryLeftHours -= TICK_HOURS;
          if (!s.onBattery) {
            s.onBattery = true;
            log.push({
              day: w.clock.dayIndex, kind: 'on-battery',
              text: `${s.label} is on its own battery. About ${hoursMinutes(s.batteryLeftHours)} of it.`
            });
          }
          if (s.batteryLeftHours <= 0 && s.on) {
            s.on = false; s.batteryLeftHours = 0; changed = true;
            log.push({
              day: w.clock.dayIndex, kind: 'site-down',
              text: `${s.label} has gone off. Its battery lasted ${s.batteryHours} hours and the power `
                + 'has been off longer than that. Nobody in that township has a phone now.'
            });
            w.bus.emit('telecoms:site-down', { site: s.id, label: s.label });
          }
        }
      } else {
        if (!s.on) { s.on = true; changed = true; log.push({ day: w.clock.dayIndex, kind: 'site-up', text: `${s.label} is back on air.` }); }
        s.onBattery = false;
        s.batteryLeftHours = Math.min(s.batteryHours, s.batteryLeftHours + TICK_HOURS * 0.4);
      }
      if (!s.on) down++; else if (s.onBattery) onBattery++; else up++;
    }
    if (changed) coverageDirty = true;
    return { up, onBattery, down, shed };
  }

  function breakBackhaul(w, cause) {
    if (!backhaulUp) return;
    backhaulUp = false;
    backhaulDaysLeft = rng.range(0.5, 6);
    log.push({
      day: w.clock.dayIndex, kind: 'backhaul',
      text: `The backhaul under the bay is out: ${cause}. Nothing fixed on the island works until it is back.`
    });
    w.bus.emit('telecoms:backhaul-fault', { cause, days: +backhaulDaysLeft.toFixed(1) });
    nudge(w, 'business_viability', -0.06, 'the island is off the network', 'infrastructure/telecoms.js', 120);
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'telecoms',
    phase: 'infrastructure',
    order: 40,

    init(w) {
      buildField(w);
      if (g && g.ready) {
        refreshBest();
        buildCrossing(w);
      }
      notes.push('The three sites are placed at the township centres because no tower register was '
        + 'found. Mast heights, transmit power, channel counts and the six hours of site battery are '
        + 'all modelled. The coverage between them is not: it is computed against the heightfield.');
      notes.push('data/residents.json records a Dunwich commuter household whose weekday reads '
        + '"Ferry home, phone signal drops halfway across". The crossing profile in this read model '
        + 'is that sentence, worked out.');
      notes.push('Marine Rescue Queensland is raised on VHF Channel 16 as well as Triple Zero. When '
        + 'the mobile network is blocked the radio is not, and that is not a detail: it is why the '
        + 'unit at Yabbie Street exists.');
      state.ready = true;
    },

    tick(w) {
      const day = w.clock.dayIndex;
      if (day !== lastDay) {
        if (lastDay >= 0) {
          blocked365.push(dayBlocked);
          outageMinutes365.push(dayOutageMinutes);
        }
        dayBlocked = 0; dayOutageMinutes = 0;
        lastDay = day;
        dailyWorks(w);
      }

      const p = stepPower(w);
      if (coverageDirty) refreshBest();
      const t = stepTraffic(w);

      dayBlocked += t.blockedCalls;

      // Backhaul: rain fade is not the risk on a buried path, an anchor and a backhoe are.
      if (!backhaulUp) {
        backhaulOutageMinutes += 10;
        dayOutageMinutes += 10;
      }

      const anyDown = p.down > 0 || !backhaulUp;
      if (anyDown && !outageOn) {
        outageOn = true;
        outageSinceDay = day;
        outageCause = !backhaulUp ? 'the backhaul under the bay is out'
          : `${p.down} of ${sites.length} sites are off after the power`;
        w.bus.emit('telecoms:outage', { cause: outageCause });
      } else if (!anyDown && outageOn) {
        outageOn = false;
        if (outageMinutes > 120) {
          nudge(w, 'emergency_readiness', -clamp(outageMinutes / 4000, 0.02, 0.14),
            `${hoursMinutes(outageMinutes / 60)} with part of the island off the network`,
            'infrastructure/telecoms.js', 160);
        }
        outageMinutes = 0;
      }
      if (outageOn) { outageMinutes += 10; dayOutageMinutes += 10; }

      publish(w, p, t);
    },

    describe(w) {
      return {
        landUsablePct: state.coverage.landUsablePct,
        deadSpots: state.coverage.deadSpots.length,
        crossingWorstDbm: state.crossing.worstDbm,
        crossingGapKm: state.crossing.gapKm,
        sitesUp: state.sitesUp,
        sitesOnBattery: state.sitesOnBattery,
        sitesDown: state.sitesDown,
        blockingPct: +state.mobile.blockingPct.toFixed(2),
        surge: state.emergency.surge,
        mbpsPerUser: +state.mobile.dataMbpsPerUser.toFixed(1),
        backhaul: state.nbn.backhaulUp,
        outageMin365: Math.round(state.outage.minutesRolling365)
      };
    },

    save() {
      return {
        sites: sites.map((s) => ({ id: s.id, on: s.on, onBattery: s.onBattery, batteryLeftHours: s.batteryLeftHours, batteryHours: s.batteryHours })),
        backhaulUp, backhaulDaysLeft, backhaulOutageMinutes,
        outageOn, outageCause, outageMinutes, outageSinceDay,
        lastDay, dayBlocked, dayOutageMinutes, surgeUntilTick, surgeReason,
        surge: state.emergency.surge,
        rings: { blocked365: blocked365.save(), outageMinutes365: outageMinutes365.save() }
      };
    },

    load(w, s) {
      if (!s) return;
      for (const row of s.sites || []) {
        const site = sites.find((x) => x.id === row.id);
        if (site) { site.on = row.on; site.onBattery = row.onBattery; site.batteryLeftHours = row.batteryLeftHours; site.batteryHours = row.batteryHours ?? site.batteryHours; }
      }
      backhaulUp = s.backhaulUp !== false;
      backhaulDaysLeft = s.backhaulDaysLeft ?? 0;
      backhaulOutageMinutes = s.backhaulOutageMinutes ?? 0;
      outageOn = !!s.outageOn;
      outageCause = s.outageCause ?? null;
      outageMinutes = s.outageMinutes ?? 0;
      outageSinceDay = s.outageSinceDay ?? null;
      lastDay = s.lastDay ?? -1;
      dayBlocked = s.dayBlocked ?? 0;
      dayOutageMinutes = s.dayOutageMinutes ?? 0;
      surgeUntilTick = s.surgeUntilTick ?? -1;
      surgeReason = s.surgeReason ?? '';
      state.emergency.surge = s.surge ?? 1;
      const r = s.rings || {};
      blocked365.load(r.blocked365); outageMinutes365.load(r.outageMinutes365);
      coverageDirty = true;
    }
  });

  /* -------------------------------------------------------------- daily works */

  function dailyWorks(w) {
    const wx = w.read('weather');
    // A buried path under a shipping channel is cut by an anchor or by somebody digging, and both
    // are more likely in a blow. Modelled, and rare.
    const storm = wx && (wx.synoptic === 'eastcoastlow' || wx.windKt > 30) ? 5 : 1;
    if (backhaulUp) {
      if (rng.float() < (0.20 / 365) * storm) breakBackhaul(w, storm > 1 ? 'an anchor in the low' : 'a fault on the crossing');
    } else {
      backhaulDaysLeft -= 1;
      if (backhaulDaysLeft <= 0) {
        backhaulUp = true;
        backhaulDaysLeft = 0;
        log.push({ day: w.clock.dayIndex, kind: 'backhaul-back', text: 'The backhaul is back. Everything fixed works again.' });
        w.bus.emit('telecoms:backhaul-restored', {});
      }
    }

    // Say the dead spots once, when the island is first built, rather than every day.
    if (!deadSpotsAnnounced && state.coverage.deadSpots.length) {
      deadSpotsAnnounced = true;
      const worst = state.coverage.deadSpots.slice(0, 3).map((d) => d.name).join(', ');
      log.push({
        day: w.clock.dayIndex, kind: 'coverage',
        text: `Worked out from the terrain: no usable signal at ${worst}. The ridge between the towns `
          + 'and the interior is the reason, and it is 228 m high.'
      });
    }
  }

  /* -------------------------------------------------------------- read model */

  function publish(w, p, t) {
    state.sites = sites.map((s) => ({
      id: s.id, label: s.label, on: s.on, onBattery: s.onBattery,
      batteryLeftHours: +Math.max(0, s.batteryLeftHours).toFixed(2),
      batteryLabel: s.on && s.onBattery ? hoursMinutes(Math.max(0, s.batteryLeftHours)) : '',
      channels: s.channels, offeredErlangs: +(s.offered || 0).toFixed(1),
      blockingPct: +((s.blocking || 0) * 100).toFixed(2),
      peopleInRange: Math.round(s.here || 0)
    }));
    state.sitesUp = p.up;
    state.sitesOnBattery = p.onBattery;
    state.sitesDown = p.down;

    state.mobile.subscribers = Math.round(t.users);
    state.mobile.activeCalls = Math.round(t.active);
    state.mobile.offeredErlangs = +t.offered.toFixed(1);
    state.mobile.channels = t.channels;
    state.mobile.blockingPct = t.blocking * 100;
    state.mobile.gradeOfService = t.blocking < 0.01 ? 'normal'
      : t.blocking < 0.03 ? 'busy' : t.blocking < 0.12 ? 'congested' : 'calls are failing';
    state.mobile.dataMbpsPerUser = t.perUser;
    // Twelve megabits is the reference: enough for a video call and a second person streaming,
    // which is what a household on this island is actually trying to do at seven in the evening.
    state.mobile.congestion = clamp(1 - t.perUser / 12, 0, 1);

    state.emergency.callsAttempted = Math.round(t.users * 0.03 * t.mult);
    state.emergency.callsBlocked = Math.round(t.blockedCalls);
    state.emergency.blockedRolling365 = Math.round(blocked365.total);
    // The line that matters. A Triple Zero call is carried on any carrier and it gets priority, but
    // priority on a cell with no free channel is still no channel. Ten per cent blocking is the
    // point at which an emergency call is a coin toss.
    state.emergency.triple0AtRisk = t.blocking > 0.10 || p.down > 0;
    state.emergency.reason = p.down > 0
      ? `${p.down} site${p.down > 1 ? 's are' : ' is'} off: there is no network there at all`
      : t.blocking > 0.10
        ? `${(t.blocking * 100).toFixed(0)} per cent of calls are being blocked${surgeReason ? ': ' + surgeReason : ''}`
        : '';
    if (state.emergency.surge > 1) state.emergency.reason = state.emergency.reason || surgeReason;

    const dwellings = (w.read('population')?.dwellings?.total) || 1900;
    state.nbn.connections = Math.round(dwellings * 0.82);
    state.nbn.backhaulUp = backhaulUp;
    state.nbn.backhaulOutageMinutes = backhaulOutageMinutes;
    state.nbn.eveningCongestion = +state.mobile.congestion.toFixed(3);
    state.nbn.mbpsTypicalEvening = backhaulUp ? +Math.max(1, 52 - 44 * state.mobile.congestion).toFixed(1) : 0;
    state.nbn.byTech = {
      note: 'No published technology split for this island was found. The connection count is '
        + 'dwellings from the population system times a modelled take-up.'
    };

    state.outage.on = outageOn;
    state.outage.cause = outageOn ? outageCause : null;
    state.outage.minutes = outageMinutes;
    state.outage.sinceDay = outageSinceDay;
    state.outage.minutesRolling365 = outageMinutes365.total;

    // What the sites draw, for power.js. Modelled: a macro cell site with its air conditioning.
    state.powerKw = sites.reduce((a, s) => a + (s.on && !s.onBattery ? 11 : 0), 0) + 4;

    state.events = log.recent(8);
  }
}
