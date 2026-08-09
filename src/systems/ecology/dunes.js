// Dunes, beaches and the Amity Point erosion problem.
//
// A dune is a bank account. Storms take sand out and wind puts it back, and how fast it goes back
// depends on how much spinifex is left to catch it. Nothing here is an event: it is a balance that
// runs every day of the simulation, and a player can lose a dune over ten sim-years without ever
// making one visibly bad decision. That is the point.
//
// AMITY POINT IS A DIFFERENT PROBLEM AND IS MODELLED SEPARATELY.
// Amity Point is losing land now. It is not ordinary beach erosion. The two drivers named in
// data/ecology.json proc-amity-erosion are episodic flow slides, which are sudden underwater
// collapses of the sand slope, and the southerly migration of the deep Rainbow Channel toward the
// shore. It is a declared erosion-prone area under the Coastal Protection and Management Act 1995.
// Redland City Council adopted a Shoreline Erosion Management Plan in 2019 and an implementation
// plan in 2021, over three reaches: northern (monitoring and survey), central (flow slide barrier)
// and southern (buried seawall near the campground). In November 2017 about thirty metres of
// foreshore near Toompany Street was affected and three to four metres of land, including trees,
// fell into the sea. Houses have been lost here.
//
// No annual retreat rate and no flow slide frequency has been published. The pack says so
// explicitly and says to model it as episodic rather than as a steady rate, because that is how
// flow slides behave, and because a player who budgets for a steady rate should be caught out
// exactly the way real budgets are. The event rate here is a modelling choice and is published as
// one, sitting next to the reference event so anyone can see what it was fitted to.
//
// Determinism: world.rng.stream('dunes'). No Math.random, no Date.now.

import {
  clamp, smoothstep, absDay, onshoreComponent,
  ecoGrid, eastCoast, levers, humanLoad, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;

/* ------------------------------------------------------------------ the reaches

Every named beach on this island, plus the three Amity Point reaches the Shoreline Erosion
Management Plan is written over. Coordinates come from data/places.json where the place is in it;
the three Main Beach sections and the two Flinders sections are the same real beach sampled at
different points along it, and are labelled that way rather than given invented names.

`face` is the bearing the shore looks out along, which is what decides whether today's swell is
hitting it square on or running past it. `exposure` is how much of the open Pacific gets to it. */

const REACHES = [
  // The Pacific side: thirty-two kilometres of open swell.
  { id: 'main-beach-north', placeId: 'main-beach', label: 'Main Beach (northern end)', face: 95, exposure: 1.0, lengthM: 2600, vehicles: true, accesses: 3, backing: 'dune' },
  { id: 'main-beach-central', atLat: -27.545, label: 'Main Beach (central)', face: 90, exposure: 1.0, lengthM: 12000, vehicles: true, accesses: 8, backing: 'swamp' },
  { id: 'main-beach-south', atLat: -27.665, label: 'Main Beach (southern end)', face: 88, exposure: 1.0, lengthM: 10000, vehicles: true, accesses: 4, backing: 'swamp' },
  // The Point Lookout pocket beaches: short, steep, headland-bounded.
  { id: 'south-gorge', placeId: 'south-gorge', label: 'South Gorge', face: 110, exposure: 0.55, lengthM: 180, vehicles: false, accesses: 1, backing: 'rock' },
  { id: 'frenchmans-beach', placeId: 'frenchmans-beach', label: 'Frenchmans Beach', face: 80, exposure: 0.72, lengthM: 420, vehicles: false, accesses: 2, backing: 'dune' },
  { id: 'deadmans-beach', placeId: 'deadmans-beach', label: 'Deadmans Beach', face: 55, exposure: 0.68, lengthM: 330, vehicles: false, accesses: 1, backing: 'dune' },
  { id: 'cylinder-beach', placeId: 'cylinder-beach', label: 'Cylinder Beach', face: 30, exposure: 0.6, lengthM: 700, vehicles: false, accesses: 4, backing: 'dune' },
  { id: 'home-beach', placeId: 'home-beach', label: 'Home Beach', face: 10, exposure: 0.45, lengthM: 900, vehicles: false, accesses: 3, backing: 'dune' },
  { id: 'adder-rock', placeId: 'adder-rock', label: 'Adder Rock', face: 350, exposure: 0.4, lengthM: 260, vehicles: false, accesses: 1, backing: 'rock' },
  // The north coast: Flinders Beach, which is also a four wheel drive route.
  { id: 'flinders-east', placeId: 'flinders-beach', label: 'Flinders Beach (eastern end)', face: 350, exposure: 0.42, lengthM: 3200, vehicles: true, accesses: 2, backing: 'dune' },
  { id: 'flinders-west', atLon: 153.452, atLat: -27.4055, label: 'Flinders Beach (western end)', face: 340, exposure: 0.34, lengthM: 3000, vehicles: true, accesses: 2, backing: 'dune' },
  { id: 'amity-beach', placeId: 'amity-beach', label: 'Amity Beach', face: 320, exposure: 0.22, lengthM: 900, vehicles: false, accesses: 2, backing: 'dune' },
  // Amity Point, the three reaches the Shoreline Erosion Management Plan is written over.
  { id: 'amity-northern', atLon: 153.4362, atLat: -27.3968, label: 'Amity Point, northern reach', face: 300, exposure: 0.16, lengthM: 420, vehicles: false, accesses: 1, backing: 'town', amity: 'northern' },
  { id: 'amity-central', placeId: 'amity-erosion-zone', label: 'Amity Point, central reach', face: 295, exposure: 0.16, lengthM: 380, vehicles: false, accesses: 1, backing: 'town', amity: 'central' },
  { id: 'amity-southern', atLon: 153.4381, atLat: -27.4034, label: 'Amity Point, southern reach', face: 285, exposure: 0.15, lengthM: 400, vehicles: false, accesses: 1, backing: 'campground', amity: 'southern' },
  // The bay shore at Dunwich and One Mile: low energy, and the erosion here is a different animal.
  { id: 'bradburys-beach', placeId: 'bradburys-beach', label: "Bradbury's Beach", face: 275, exposure: 0.1, lengthM: 500, vehicles: false, accesses: 2, backing: 'town' },
  { id: 'adams-beach', placeId: 'adams-beach', label: 'Adams Beach', face: 265, exposure: 0.1, lengthM: 600, vehicles: false, accesses: 2, backing: 'dune' },
  { id: 'dunwich-foreshore', placeId: 'dunwich-foreshore', label: 'Dunwich Foreshore', face: 280, exposure: 0.09, lengthM: 700, vehicles: false, accesses: 3, backing: 'town' },
  { id: 'one-mile', placeId: 'one-mile-jetty', label: 'One Mile', face: 285, exposure: 0.08, lengthM: 600, vehicles: false, accesses: 2, backing: 'town' }
];

/** The 2017 reference event, from the pack, kept next to the modelled rate it calibrates. */
const AMITY_REFERENCE = {
  date: '2017-11',
  description: 'About 30 metres of foreshore near Toompany Street affected, with three to four '
    + 'metres of land, including trees, falling into the sea.',
  confidence: 'medium',
  source: 'data/ecology.json proc-amity-erosion reference_event'
};

export function registerDunes(world) {
  const rng = world.rng.stream('dunes');
  const L = levers(world);

  const state = world.publish('dunes', {
    ready: false,
    source: 'data/ecology.json proc-dune-cycle and proc-amity-erosion; data/places.json for the beaches',
    reaches: [],
    islandCondition: 0,
    oceanCondition: 0,
    bayCondition: 0,
    sandBudgetM3PerM: 0,
    stormCutThisYearM3PerM: 0,
    accretionThisYearM3PerM: 0,
    blowouts: 0, blowoutAreaM2: 0,
    worstReach: null, bestReach: null,
    lastStorm: null,
    amity: null,
    amityReference: AMITY_REFERENCE,
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(30);
  const cutRing = new DailyRing(365);
  const gainRing = new DailyRing(365);

  let reaches = [];
  let lastDay = -1;
  let amity = null;
  let landLostM2 = 0;
  let channelM = 420;   // metres from the Amity shore to the deep water, held unrounded

  /* ---------------------------------------------------------------- build */

  function build(w) {
    const island = w.island;
    const coast = eastCoast(w);
    if (!island) { notes.push('no island: no beaches.'); return false; }

    for (const def of REACHES) {
      let x = null, z = null;
      if (def.placeId) {
        const p = place(w, def.placeId);
        if (p) { x = p.x; z = p.z; }
      }
      if (x === null && def.atLat != null && def.atLon != null) {
        const p = island.project(def.atLon, def.atLat);
        x = p.x; z = p.z;
      }
      if (x === null && def.atLat != null && coast.ready) {
        // Along the eastern strand: take the latitude and ask the heightfield where the sand is.
        z = (def.atLat + 27.56) * 110950;
        x = coast.at(z) - 40;
      }
      if (x === null) {
        notes.push(`${def.label}: no coordinate in data/places.json and none derivable, so the reach is not placed.`);
        continue;
      }
      // A dune on the ocean side holds far more sand than a bay foreshore does, which is most of
      // why an east coast beach can take a storm and a bay foreshore cannot.
      const baseline = def.exposure > 0.5 ? 240 : def.exposure > 0.2 ? 150 : 85;
      reaches.push({
        ...def,
        x, z,
        sand: baseline, baseline,
        duneHeightM: def.exposure > 0.5 ? 5.5 : def.exposure > 0.2 ? 4 : 2.6,
        // The elevation of the dune toe, above the same datum the tide is on. Below this the sea
        // is on the beach; above it the sea is in the dune.
        toeM: (w.island ? w.island.seaLevel : 1.02) + (def.exposure > 0.5 ? 1.20 : def.exposure > 0.2 ? 0.95 : 0.68),
        cutToday: 0, gainToday: 0,
        veg: def.backing === 'town' ? 0.42 : def.backing === 'rock' ? 0.5 : rng.range(0.62, 0.86),
        shorelineM: 0,
        blowouts: [],
        cut365: 0, gain365: 0,
        pedestriansToday: 0, vehiclesToday: 0,
        nourishedM3PerM: 0,
        lastCut: null
      });
    }

    // Amity Point. The three reaches above are the same three the Shoreline Erosion Management
    // Plan is written over, so the works map onto them one to one.
    amity = {
      status: 'Declared an erosion-prone area under the Coastal Protection and Management Act 1995. '
        + 'Redland City Council adopted a Shoreline Erosion Management Plan in 2019 and an '
        + 'implementation plan in 2021.',
      // How close the deep water is. The Rainbow Channel is migrating toward the shore; no rate
      // is published anywhere, so this is a modelling choice and is labelled as one.
      channelDistanceM: 420,
      channelMigrationMPerYear: 1.4,
      channelMigrationConfidence: 'low: no published rate. Modelled so the hazard rises over a '
        + 'player-visible timescale rather than staying flat.',
      eventsThisDecade: 0,
      landLostM2ThisDecade: 0,
      lastEvent: null,
      worksNote: '',
      propertiesInStrip: 0,
      propertiesBasis: ''
    };
    return reaches.length > 0;
  }

  /* ---------------------------------------------------------------- daily physics */

  /**
   * The sand moves every tick, not once a day. Sampling the wind and the tide once at midnight is
   * how an earlier version of this file managed to run a beach down twenty-two metres in five
   * years and never put a grain back: at midnight this island has a land breeze, so every sample
   * it took was offshore. Sand transport is an integral over the day, so it is integrated.
   */
  function tickPhysics(w) {
    const wx = w.read('weather');
    const tide = w.read('tide');
    if (!wx) return;
    const dtH = 10 / 60;
    const hs = wx.swellM;
    const swellDir = wx.swellDirDeg;
    const windDir = wx.windDirDeg;
    const windKt = wx.windKt;
    const wet = clamp(wx.rainMmHr / 2.5, 0, 1);
    const seaLevel = w.island ? w.island.seaLevel : 1.02;
    const tideH = tide ? tide.height : seaLevel;

    for (const r of reaches) {
      /* --- storm cut --- */
      // Waves only cut the dune when the water actually reaches the toe of it, which is why the
      // damaging storms are the ones that land on a spring high tide and why the same swell two
      // hours later does nothing at all.
      const facing = Math.max(0, onshoreComponent(swellDir, r.face));
      const runup = 0.55 * hs * facing * r.exposure + tideH;
      const excess = runup - r.toeM;
      if (excess > 0) {
        const rate = excess * excess * 0.95 * (1 - 0.42 * r.veg)
          * (r.sand < r.baseline * 0.35 ? 0.55 : 1);
        const cut = rate * dtH;
        r.sand -= cut;
        r.cutToday += cut;
      }

      /* --- the rebuild --- */
      // Wind moves dry sand up the beach and spinifex catches it. No spinifex, no dune: the plant
      // is the machine. This is the multiplier data/ecology.json calls foredune_vegetation_cover.
      const onW = Math.max(0, onshoreComponent(windDir, r.face));
      if (onW > 0.08 && wet < 0.6) {
        const deficit = clamp((r.baseline - r.sand) / r.baseline, 0, 1.2);
        let gain = 0.030 * Math.pow(r.veg, 1.15) * onW * Math.pow(clamp(windKt / 12, 0, 2.4), 2)
          * (1 - wet) * clamp(deficit * 2.4, 0, 1) * (0.35 + 0.65 * r.exposure) * dtH;
        if (r.nourishedM3PerM > 0) {
          const used = Math.min(r.nourishedM3PerM, r.cutToday * 0.02);
          r.nourishedM3PerM -= used;
          gain += used;
        }
        r.sand += gain;
        r.gainToday += gain;
      }

      r.sand = clamp(r.sand, r.baseline * 0.12, r.baseline * 1.35);
    }
  }

  function dailyPass(w) {
    const wx = w.read('weather');
    const veg = w.read('vegetation');
    const h = humanLoad(w);
    const restoration = L.level('dune-restoration-program');
    const trackWorks = L.level('beach-track-maintenance');
    const permitPrice = L.level('vehicle-access-permit-price');
    const campCap = L.level('campground-site-cap');
    const beachClosures = L.level('beach-driving-seasonal-closures');
    const windKt = wx ? wx.windKt : 12;
    const windDir = wx ? wx.windDirDeg : 110;
    const hs = wx ? wx.swellM : 1.1;

    let cutTotal = 0, gainTotal = 0, condSum = 0, oceanSum = 0, oceanN = 0, baySum = 0, bayN = 0;
    let blowoutCount = 0, blowoutArea = 0;
    let worst = null, best = null;
    let biggestCut = 0, biggestCutReach = null;

    for (const r of reaches) {
      const cut = r.cutToday, gain = r.gainToday;
      r.cut365 += cut; r.gain365 += gain;
      cutTotal += cut; gainTotal += gain;
      if (cut > biggestCut) { biggestCut = cut; biggestCutReach = r; }
      r.cutToday = 0; r.gainToday = 0;

      /* --- how many people and vehicles are on this beach today --- */
      const town = nearestTownshipLoad(w, r, h);
      const share = beachDraw(r);
      r.pedestriansToday = Math.round(town * share);
      r.vehiclesToday = r.vehicles
        ? Math.round(town * share * 0.22 * (1 - 0.25 * permitPrice) * (1 - 0.55 * beachClosures))
        : 0;

      /* --- vegetation cover --- */
      // Growth is slow, trampling is fast, and one unmanaged access track cuts a line straight
      // through the spinifex. A formed corridor concentrates the damage into a strip that is
      // already lost, which is the cheapest coastal engineering on the island.
      const formed = clamp(0.25 + 0.55 * restoration + 0.35 * trackWorks, 0, 0.95);
      const moist = veg && veg.moistureAt ? veg.moistureAt(r.x, r.z) : 0.5;
      const growth = 0.0030 * (1 - r.veg) * (0.4 + 0.6 * moist) * (1 - clamp(cut / 14, 0, 0.9));
      const footTraffic = (r.pedestriansToday / Math.max(60, r.lengthM)) * 0.045 * (1 - formed)
        * (1 + 0.3 * r.accesses * (1 - formed));
      const vehicleTraffic = (r.vehiclesToday / Math.max(60, r.lengthM)) * 0.12;
      const campPressure = r.backing === 'campground' ? 0.00035 * (1 - campCap) : 0;
      r.veg = clamp(r.veg + growth - footTraffic - vehicleTraffic - campPressure, 0.02, 0.97);

      /* --- blowouts --- */
      // A gap in the cover, opened by a storm or worn open by feet, that the wind then widens.
      // Left alone it grows; a day with matting and brush closes it.
      const onW = Math.max(0, onshoreComponent(windDir, r.face));
      if (r.veg < 0.42 && windKt > 20 && onW > 0.35 && rng.float() < 0.03) {
        r.blowouts.push({ widthM: rng.range(6, 18), opened: w.clock.formatDate() });
        log.push({ day: w.clock.formatDate(), what: 'blowout opened', where: r.label });
      }
      for (let i = r.blowouts.length - 1; i >= 0; i--) {
        const b = r.blowouts[i];
        if (windKt > 15 && onW > 0.25) b.widthM += 0.14 * (windKt / 20) * (1 - r.veg);
        const repair = restoration * 0.06 + trackWorks * 0.025;
        b.widthM -= repair * (1 + b.widthM / 40);
        if (b.widthM <= 0.5) { r.blowouts.splice(i, 1); continue; }
        blowoutCount++;
        blowoutArea += b.widthM * 22;
        r.sand -= b.widthM * 0.0022;      // sand blows straight out of an open gap and stays out
      }

      r.sand = clamp(r.sand, r.baseline * 0.12, r.baseline * 1.35);
      r.shorelineM = (r.sand - r.baseline) / r.duneHeightM;

      const cond = clamp(0.55 * (r.sand / r.baseline) + 0.45 * r.veg, 0, 1);
      r.condition = cond;
      condSum += cond;
      if (r.exposure > 0.35) { oceanSum += cond; oceanN++; } else { baySum += cond; bayN++; }
      if (!worst || cond < worst.condition) worst = r;
      if (!best || cond > best.condition) best = r;
    }

    if (biggestCut > 6 && biggestCutReach) {
      state.lastStorm = {
        day: w.clock.formatDate(),
        where: biggestCutReach.label,
        swellM: +hs.toFixed(1),
        cutM3PerM: +biggestCut.toFixed(1),
        shorelineM: +biggestCutReach.shorelineM.toFixed(1)
      };
      if (biggestCut > 16) {
        log.push({ day: w.clock.formatDate(), what: `storm cut ${biggestCut.toFixed(0)} m3 a metre`, where: biggestCutReach.label });
        w.bus.emit('coast:storm-cut', {
          where: biggestCutReach.label, cutM3PerM: +biggestCut.toFixed(1),
          swellM: +hs.toFixed(1), shorelineM: +biggestCutReach.shorelineM.toFixed(1)
        });
      }
    }

    cutRing.add(cutTotal / Math.max(1, reaches.length));
    gainRing.add(gainTotal / Math.max(1, reaches.length));

    state.islandCondition = +(condSum / Math.max(1, reaches.length)).toFixed(3);
    state.oceanCondition = +(oceanN ? oceanSum / oceanN : 0).toFixed(3);
    state.bayCondition = +(bayN ? baySum / bayN : 0).toFixed(3);
    state.blowouts = blowoutCount;
    state.blowoutAreaM2 = Math.round(blowoutArea);
    state.worstReach = worst ? { id: worst.id, label: worst.label, condition: +worst.condition.toFixed(2), shorelineM: +worst.shorelineM.toFixed(1) } : null;
    state.bestReach = best ? { id: best.id, label: best.label, condition: +best.condition.toFixed(2) } : null;
    state.stormCutThisYearM3PerM = +cutRing.total.toFixed(1);
    state.accretionThisYearM3PerM = +gainRing.total.toFixed(1);
    state.sandBudgetM3PerM = +(reaches.reduce((s, r) => s + r.sand, 0) / Math.max(1, reaches.length)).toFixed(1);
  }

  /** How many people are within reach of this beach today. */
  function nearestTownshipLoad(w, r, h) {
    const by = h.byTownship || {};
    // Township keys vary by system; fall back to the island total spread over the beaches.
    const total = (by['point-lookout'] || 0) + (by.dunwich || 0) + (by['amity-point'] || 0);
    if (total > 0) {
      if (r.id.startsWith('amity')) return (by['amity-point'] || 0) + h.residents * 0.08;
      if (r.id.startsWith('dunwich') || r.id.startsWith('one-mile') || r.id.startsWith('bradburys') || r.id.startsWith('adams')) {
        return (by.dunwich || 0) + h.residents * 0.3;
      }
      return (by['point-lookout'] || 0) + h.residents * 0.5;
    }
    return (h.visitors + h.residents * 0.4) * 0.34;
  }

  /** What share of the people on that side of the island end up on this particular beach. */
  function beachDraw(r) {
    switch (r.id) {
      case 'cylinder-beach': return 0.24;
      case 'main-beach-north': return 0.20;
      case 'home-beach': return 0.14;
      case 'frenchmans-beach': return 0.10;
      case 'south-gorge': return 0.09;
      case 'deadmans-beach': return 0.07;
      case 'adder-rock': return 0.05;
      case 'flinders-east': return 0.09;
      case 'flinders-west': return 0.05;
      case 'main-beach-central': return 0.06;
      case 'main-beach-south': return 0.02;
      case 'amity-beach': return 0.30;
      case 'dunwich-foreshore': return 0.16;
      case 'bradburys-beach': return 0.10;
      case 'adams-beach': return 0.06;
      case 'one-mile': return 0.09;
      default: return 0.05;
    }
  }

  /* ---------------------------------------------------------------- Amity Point */

  function stepAmity(w, dtDays) {
    const barrier = L.level('amity-flow-slide-barrier');
    const wall = L.level('amity-southern-buried-seawall');
    const nourish = L.level('amity-beach-nourishment');
    const research = L.level('amity-coastal-research');
    const retreat = L.level('amity-managed-retreat');

    // The channel comes closer. No published rate exists, so this is a modelled drift and the
    // read model says so. Research does not stop it; it means the next one is not a surprise.
    channelM = Math.max(60, channelM - amity.channelMigrationMPerYear * (dtDays / YEAR));
    const proximity = clamp(1 - (channelM - 60) / 500, 0, 1.6);

    for (const r of reaches) {
      if (!r.amity) continue;
      // A flow slide is not driven by the waves. It is the underwater slope failing, and it goes
      // when it goes. Steeper slope, closer channel, more load on top: more likely.
      let hazardPerYear = 0.30 * (0.5 + proximity);
      if (r.amity === 'central') hazardPerYear *= (1 - 0.42 * barrier);
      if (r.amity === 'southern') hazardPerYear *= (1 - 0.38 * wall);
      if (r.amity === 'northern') hazardPerYear *= 1.05;              // monitored, not protected
      // Vegetation on the foreshore holds the top of the slope together.
      hazardPerYear *= clamp(1.5 - r.veg * 0.7, 0.85, 1.5);
      hazardPerYear *= clamp(1 - 0.5 * retreat, 0.5, 1);              // fewer assets, less loading

      if (rng.float() < hazardPerYear * (dtDays / YEAR)) {
        // Fitted to the November 2017 event: about thirty metres of frontage, three to four
        // metres of land. Bigger and smaller ones happen; this is the middle of the distribution.
        const frontage = rng.range(18, 46);
        const retreatM = rng.range(2.2, 5.0);
        const areaM2 = frontage * retreatM;
        r.sand -= retreatM * r.duneHeightM;
        r.shorelineM -= retreatM;
        landLostM2 += areaM2;
        amity.eventsThisDecade++;
        amity.landLostM2ThisDecade = Math.round(landLostM2);
        amity.lastEvent = {
          day: w.clock.formatDate(), reach: r.label,
          frontageM: Math.round(frontage), retreatM: +retreatM.toFixed(1),
          areaM2: Math.round(areaM2),
          warned: research > 0.5
        };
        log.push({ day: w.clock.formatDate(), what: `flow slide, ${Math.round(frontage)} m of foreshore, ${retreatM.toFixed(1)} m of land`, where: r.label });
        w.bus.emit('coast:flow-slide', {
          where: r.label, frontageM: Math.round(frontage), retreatM: +retreatM.toFixed(1),
          areaM2: Math.round(areaM2), warned: research > 0.5,
          text: research > 0.5
            ? `Flow slide at ${r.label}. The survey had it on the watch list.`
            : `Flow slide at ${r.label}. Nobody was watching this reach.`
        });
        w.bus.emit('ecology:alert', {
          id: 'amity-flow-slide',
          text: `${Math.round(frontage)} metres of foreshore at ${r.label} went into the sea overnight, `
            + `taking ${retreatM.toFixed(1)} metres of land with it.`
        });
      }

      // Nourishment is sand bought and placed, and the sea starts taking it back the day it lands.
      if (nourish > 0 && rng.float() < nourish * 1.6 * (dtDays / YEAR)) {
        const placed = rng.range(35, 90);
        r.nourishedM3PerM += placed;
        r.sand += placed * 0.35;
        log.push({ day: w.clock.formatDate(), what: `nourishment placed, about ${Math.round(placed)} m3 a metre`, where: r.label });
      }
    }

    // Properties in the erosion-prone strip. No pack carries a lot-by-lot list, so this is a
    // modelled count from the frontage and a typical foreshore lot width, and it says so.
    const frontageM = reaches.filter((r) => r.amity).reduce((s, r) => s + r.lengthM, 0);
    const stripLots = Math.round((frontageM / 22) * (1 - 0.7 * retreat));
    amity.propertiesInStrip = stripLots;
    amity.propertiesBasis = `modelled: ${Math.round(frontageM)} m of declared erosion-prone frontage at a `
      + 'typical foreshore lot width of 22 m. No lot-by-lot list is in any pack.';
    amity.worksNote = [
      barrier > 0.5 ? 'flow slide barrier in place on the central reach' : 'no flow slide barrier',
      wall > 0.5 ? 'buried seawall funded for the southern reach near the campground' : 'no buried seawall',
      nourish > 0.5 ? 'nourishment campaigns running' : 'no nourishment',
      research > 0.5 ? 'coastal process research and survey funded' : 'no survey programme'
    ].join('; ');

    const amityReaches = reaches.filter((r) => r.amity);
    const meanCond = amityReaches.length
      ? amityReaches.reduce((s, r) => s + (r.condition || 0), 0) / amityReaches.length : 0.5;
    amity.riskIndex = metric(clamp(0.45 + proximity * 0.35 - barrier * 0.14 - wall * 0.10
      - research * 0.04 - retreat * 0.12 + (1 - meanCond) * 0.3, 0, 1));
    amity.channelDistanceM = +channelM.toFixed(1);
    amity.beachWidthIndex = metric(clamp(meanCond * (1 + 0.35 * nourish), 0, 1));
    state.amity = amity;
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'dunes',
    phase: 'ecology',
    order: 30,

    init(w) {
      if (!build(w)) return;
      state.ready = true;
      dailyPass(w);
      stepAmity(w, 0);
      publish(w);
      lastDay = absDay(w.clock);
      notes.push(`${reaches.length} beach reaches placed from data/places.json and the heightfield.`);
      notes.push('Storm cut volumes of 20 to 80 cubic metres a metre and recovery times of 6 to 36 '
        + 'months are the order of magnitude in data/ecology.json proc-dune-cycle. They are not '
        + 'survey figures for this island and no survey figures were found.');
      notes.push('Amity Point flow slide frequency is a modelling choice. The pack says no rate has '
        + 'been published and that the university flow slide study is what would settle it.');
      w.bus.emit('dunes:ready', { reaches: reaches.length });
    },

    tick(w) {
      if (!state.ready) return;
      tickPhysics(w);
      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      cutRing.roll();
      gainRing.roll();
      dailyPass(w);
      stepAmity(w, 1);
      publish(w);

      if (w.clock.dayOfMonth === 1) {
        for (const r of reaches) { r.cut365 *= 0.92; r.gain365 *= 0.92; }
        if (state.oceanCondition < 0.42) {
          w.bus.emit('ecology:alert', {
            id: 'dune-condition',
            text: 'The ocean dunes are running down. There is less spinifex holding them than there was, '
              + 'and a dune that cannot catch sand does not come back between storms.'
          });
        }
      }
    },

    describe(w) {
      return {
        reaches: reaches.length,
        island: state.islandCondition,
        ocean: state.oceanCondition,
        bay: state.bayCondition,
        sandM3PerM: state.sandBudgetM3PerM,
        cut365: state.stormCutThisYearM3PerM,
        oceanCut365: +(reaches.filter((r) => r.exposure > 0.5).reduce((a, r) => a + r.cut365, 0) / 3).toFixed(1),
        gain365: state.accretionThisYearM3PerM,
        blowouts: state.blowouts,
        worst: state.worstReach ? state.worstReach.label : null,
        worstShorelineM: state.worstReach ? state.worstReach.shorelineM : 0,
        amityRisk: amity ? amity.riskIndex : 0,
        amityChannelM: amity ? amity.channelDistanceM : 0,
        amityEvents: amity ? amity.eventsThisDecade : 0,
        amityLandM2: amity ? amity.landLostM2ThisDecade : 0
      };
    },

    save() {
      return {
        landLostM2, channelM,
        amity: amity ? { ...amity } : null,
        reaches: reaches.map((r) => ({
          id: r.id, sand: r.sand, veg: r.veg, shorelineM: r.shorelineM,
          nourishedM3PerM: r.nourishedM3PerM,
          blowouts: r.blowouts.map((b) => ({ widthM: b.widthM, opened: b.opened }))
        })),
        cut: cutRing.save(), gain: gainRing.save(), log: log.save()
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      landLostM2 = s.landLostM2 || 0;
      channelM = s.channelM ?? 420;
      if (s.amity) Object.assign(amity, s.amity);
      for (const r0 of s.reaches || []) {
        const r = reaches.find((x) => x.id === r0.id);
        if (!r) continue;
        r.sand = r0.sand; r.veg = r0.veg; r.shorelineM = r0.shorelineM;
        r.nourishedM3PerM = r0.nourishedM3PerM || 0;
        r.blowouts = (r0.blowouts || []).map((b) => ({ ...b }));
      }
      cutRing.load(s.cut); gainRing.load(s.gain); log.load(s.log);
      publish(w);
    }
  });

  function publish(w) {
    state.reaches = reaches.map((r) => ({
      id: r.id, label: r.label,
      x: Math.round(r.x), z: Math.round(r.z),
      lengthM: r.lengthM,
      exposure: r.exposure,
      condition: +(r.condition || 0).toFixed(3),
      sandM3PerM: +r.sand.toFixed(1),
      shorelineM: +r.shorelineM.toFixed(1),
      vegetationCover: +r.veg.toFixed(3),
      blowouts: r.blowouts.length,
      widestBlowoutM: r.blowouts.length ? +Math.max(...r.blowouts.map((b) => b.widthM)).toFixed(1) : 0,
      pedestriansToday: r.pedestriansToday,
      vehiclesToday: r.vehiclesToday,
      formedAccesses: r.accesses,
      backing: r.backing,
      amityReach: r.amity || null,
      nourishedM3PerM: +r.nourishedM3PerM.toFixed(1),
      cutThisYearM3PerM: +r.cut365.toFixed(1),
      accretionThisYearM3PerM: +r.gain365.toFixed(1)
    }));
    state.events = log.recent(6);
    state.levers = L.snapshot(['dune-restoration-program', 'beach-track-maintenance',
      'beach-driving-seasonal-closures', 'vehicle-access-permit-price', 'campground-site-cap',
      'amity-flow-slide-barrier', 'amity-southern-buried-seawall', 'amity-beach-nourishment',
      'amity-coastal-research', 'amity-managed-retreat']);
    state.civicMetrics = {
      dune_condition: metric(state.islandCondition),
      erosion_risk_amity: amity ? amity.riskIndex : 0.8,
      beach_width_amity: amity ? amity.beachWidthIndex : 0.5,
      beach_access_quality: metric(clamp(0.35 + 0.4 * L.level('beach-track-maintenance')
        + 0.25 * (1 - L.level('beach-driving-seasonal-closures')), 0, 1))
    };
  }
}
