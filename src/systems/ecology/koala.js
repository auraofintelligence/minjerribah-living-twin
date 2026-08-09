// Koalas. Individual animals with home ranges, not a number in a box.
//
// Minjerribah's koalas have been separated from the mainland for roughly 8,000 years and carry the
// lowest genetic diversity of the south-east Queensland populations. Chlamydia is present, but
// clinical disease is reported at lower rates here than in stressed mainland populations, and the
// usual explanation offered is lower habitat disturbance. This population is not chlamydia free and
// this file does not describe it as one. (data/ecology.json sp-koala island_traits.)
//
// THE ONE HARD NUMBER IN THE PACK, and the thing this model is calibrated against:
// recorded mortality on the island from 1997 to 2010 was 35 vehicle strikes, 21 disease, 16 dog
// attacks. Seventy-two animals over thirteen and a half years. That is a record of what was found,
// not of what died: a koala hit on the road is nearly always found, and a koala that dies of
// chlamydia up a tree in the middle of Naree Budjong Djara National Park nearly never is. So the
// model runs true mortality and a separate detection rate per cause, and publishes both, with the
// published ratio next to ours so anyone can check the calibration without reading this file.
//
// There is no published island-wide koala total. The pack says so and gives a modelling range of
// 200 to 600. The starting number here sits inside that range and is carried in the read model as
// a placeholder with its basis attached, not as a fact.
//
// Determinism: world.rng.stream('koala'). No Math.random, no Date.now.

import {
  clamp, smoothstep, seasonal, absDay,
  ecoGrid, levers, roadIndex, dogPressure, humanLoad, metric, place, DailyRing, EventLog
} from './ecology-common.js';

const YEAR = 365.25;
const SLICES = 9;                    // ticks between updates for one animal: 90 sim-minutes

/** Recorded mortality on this island, 1997 to 2010. The calibration target. */
const RECORDED_1997_2010 = { vehicle_strike: 35, disease: 21, dog_attack: 16, years: 13.5 };

/**
 * How often a death by each cause is found and recorded. A koala on the bitumen gets reported; a
 * koala that dies in the heath does not. These are modelling choices and are published as such.
 */
const DETECTION = {
  vehicle: 0.85,
  dog: 0.62,
  disease: 0.20,
  heat: 0.16,
  fire: 0.10,
  natural: 0.05
};

export function registerKoala(world) {
  const rng = world.rng.stream('koala');
  const L = levers(world);

  const pack = (world.data && world.data.ecology) || null;
  const sp = pack && (pack.species || []).find((s) => s.id === 'sp-koala');

  const state = world.publish('koala', {
    ready: false,
    source: 'data/ecology.json sp-koala',
    status: { epbc: 'Endangered', qldNca: 'Endangered', asAt: '2026-08' },
    population: 0,
    populationBasis: '',
    adults: 0, joeys: 0, independentYoung: 0,
    males: 0, females: 0,
    meanAgeY: 0, meanCondition: 0,
    disease: { naive: 0, latent: 0, clinical: 0, prevalence: 0, clinicalShare: 0 },
    carryingCapacity: 0, occupancy: 0,
    homeRangeMeanHa: 0,
    onGroundNow: 0, movingNow: 0, dispersing: 0,
    roadCrossings365: 0,
    deaths365: { vehicle: 0, dog: 0, disease: 0, heat: 0, fire: 0, natural: 0, total: 0 },
    recorded365: { vehicle: 0, dog: 0, disease: 0, heat: 0, fire: 0, natural: 0, total: 0 },
    births365: 0,
    calibration: null,
    blackspots: [],
    heatStress: 0,
    rescue: null,
    individuals: [],
    civicMetrics: {},
    events: [],
    levers: {},
    notes: []
  });

  const notes = state.notes;
  const log = new EventLog(30);
  const deaths = {};
  const recorded = {};
  for (const c of ['vehicle', 'dog', 'disease', 'heat', 'fire', 'natural']) {
    deaths[c] = new DailyRing(365);
    recorded[c] = new DailyRing(365);
  }
  const births = new DailyRing(365);
  const crossRing = new DailyRing(365);
  // Cumulative, for the thirteen and a half year calibration comparison.
  const lifetime = { vehicle: 0, dog: 0, disease: 0, heat: 0, fire: 0, natural: 0, days: 0 };
  const strikeByRoad = new Map();

  let g = null;
  let roads = null;
  let animals = [];
  let cursor = 0;
  let lastDay = -1;
  let capacityCell = null;     // koalas the cell can carry
  let densityCell = null;      // koalas currently in the cell
  // Crowding is a home range question, not a cell question. A koala's range is around forty
  // hectares and a grid cell is six and a half, so both sides of the comparison are summed over
  // the nine cells around a point: fifty-nine hectares, which is the scale the animal lives at.
  let capacityNbr = null;
  let densityNbr = null;
  let totalK = 0;
  let dogsToday = null;
  let heatIndex = 0;
  let nextId = 1;

  /* ---------------------------------------------------------------- the habitat */

  /**
   * Carrying capacity, built from the vegetation system's food tree density rather than from a
   * number typed in here. Swamp mahogany, scribbly gum, blackbutt and forest red gum are the four
   * food trees the pack lists, and the vegetation system already grows them, loses them to hot
   * fire and brings them back over about eleven years. So the koala ceiling moves when the trees do.
   */
  function buildCapacity(w) {
    g = ecoGrid(w);
    if (!g.ready) return false;
    capacityCell = new Float32Array(g.n);
    densityCell = new Float32Array(g.n);
    capacityNbr = new Float32Array(g.n);
    densityNbr = new Float32Array(g.n);
    refreshCapacity(w);
    return true;
  }

  /** Sum a field over the nine cells around each cell, in place into `out`. */
  function boxSum(src, out) {
    const nx = g.nx, nz = g.nz;
    out.fill(0);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const v = src[k];
        if (v === 0) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= nz) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= nx) continue;
            out[jj * nx + ii] += v;
          }
        }
      }
    }
  }

  /** How many koalas the home range around this point can carry. */
  function capacityAt(x, z) { return capacityNbr[g.at(x, z)]; }

  /** How full this patch is: 1 means the home range around here is at its food tree ceiling. */
  function crowdingAt(x, z) {
    const k = g.at(x, z);
    const cap = capacityNbr[k];
    // A koala standing on a beach is not in a crowd, it is in the wrong place. The fallback is
    // deliberately modest, because a cliff at the edge of the habitat map turns every animal that
    // wanders past it into a starving one.
    return cap > 0.004 ? densityNbr[k] / cap : 2;
  }

  function refreshCapacity(w) {
    const veg = w.read('vegetation');
    let sum = 0;
    for (let q = 0; q < g.land.length; q++) {
      const k = g.land[q];
      let f;
      if (veg && veg.foodTreeAt) f = veg.foodTreeAt(g.xOf(k), g.zOf(k));
      else {
        const cover = g.coverOf(k);
        f = cover === 'forest' ? 0.8 : cover === 'heath' ? 0.35 : cover === 'swamp' ? 0.6
          : cover === 'cleared' || cover === 'urban' ? 0.3 : 0;
      }
      const v = Math.pow(clamp(f, 0, 1), 1.6);
      capacityCell[k] = v;
      sum += v;
    }
    // Scale so the island ceiling sits at 470, comfortably inside the pack's 200 to 600 modelling
    // range and above the starting population, so the population has somewhere to go in both
    // directions. This is a placeholder and the read model says so.
    const scale = sum > 0 ? 470 / sum : 0;
    for (let q = 0; q < g.land.length; q++) capacityCell[g.land[q]] *= scale;
    totalK = 470 * (sum > 0 ? 1 : 0);
    state.carryingCapacity = Math.round(totalK);
    boxSum(capacityCell, capacityNbr);
  }

  /* ---------------------------------------------------------------- animals */

  function makeKoala(w, x, z, ageY, sex) {
    const veg = w.read('vegetation');
    const q = veg && veg.foodTreeAt ? veg.foodTreeAt(x, z) : 0.5;
    // A poorer patch means a bigger range: the animal has to walk further between feed trees.
    const base = sex === 'm' ? rng.range(210, 520) : rng.range(120, 260);
    const k = {
      id: nextId++, eid: 0,
      sex, age: ageY * YEAR,
      x, z, hx: x, hz: z,
      rangeM: base * clamp(1.9 - q, 0.75, 1.9),
      cond: rng.range(0.55, 0.85),
      infection: 0, infDays: 0,
      joey: -1,                        // days since birth, or -1
      onGround: false, moving: false,
      dispDays: 0,
      lastX: x, lastZ: z
    };
    k.eid = w.store.create('koala', 'Koala');
    w.store.set(k.eid, 'koala', k);
    w.store.set(k.eid, 'position', { x, z, y: w.island ? w.island.height(x, z) : 0 });
    return k;
  }

  function seedPopulation(w) {
    // Start at 340: the middle of the pack's 200 to 600 modelling range, which is explicitly a
    // placeholder and not a count. Placed by habitat quality, so the animals are where the trees
    // are and the map is worth looking at on the first day.
    const target = 340;
    const cells = [];
    for (let q = 0; q < g.land.length; q++) {
      const k = g.land[q];
      if (capacityCell[k] > 0.02) cells.push(k);
    }
    if (!cells.length) { notes.push('no habitat with food trees: no koalas placed.'); return; }
    let guard = 0;
    while (animals.length < target && guard++ < target * 40) {
      const k = cells[(rng.float() * cells.length) | 0];
      if (rng.float() > capacityCell[k] / 0.45) continue;
      const x = g.xOf(k) + rng.range(-120, 120);
      const z = g.zOf(k) + rng.range(-120, 120);
      if (!w.island || !w.island.isLand(x, z)) continue;
      const sex = rng.bool(0.48) ? 'm' : 'f';
      // A standing population is not all newborns: an age structure that decays with age.
      const ageY = clamp(-Math.log(Math.max(1e-6, rng.float())) * 5.4, 0.4, 16);
      const a = makeKoala(w, x, z, ageY, sex);
      // Some of them already carry it. The pack is explicit that this population is not free of it.
      if (rng.float() < 0.34) { a.infection = rng.float() < 0.12 ? 2 : 1; a.infDays = rng.range(0, 900); }
      if (sex === 'f' && ageY > 2 && rng.float() < 0.35) a.joey = rng.range(20, 300);
      animals.push(a);
    }
  }

  /* ---------------------------------------------------------------- pressures */

  /** Vehicles an hour on the sealed network right now. Modelled if no traffic system is loaded. */
  function trafficNow(w) {
    const t = w.read('traffic');
    if (t && Number.isFinite(t.vehiclesPerHour)) return t.vehiclesPerHour;
    const h = humanLoad(w);
    // Trips a day: residents make about 2.6, visitors about 1.4, and both are squeezed onto one
    // sealed spine. The hour shape is the island's: a barge peak, a school run, an evening tail.
    const tripsPerDay = h.residents * 2.6 + h.visitors * 1.4;
    const hour = w.clock.hour + w.clock.minute / 60;
    const shape = 0.18
      + 1.5 * Math.exp(-Math.pow((hour - 8.2) / 1.5, 2))
      + 1.2 * Math.exp(-Math.pow((hour - 15.6) / 2.0, 2))
      + 0.9 * Math.exp(-Math.pow((hour - 18.4) / 1.6, 2));
    return (tripsPerDay / 24) * shape;
  }

  /** How much of the animal's day is spent moving right now. */
  function activity(w, a) {
    const daylight = w.read('daylight');
    const el = daylight ? daylight.elevationDeg : -20;
    // Crepuscular and nocturnal: the peak is the hour either side of last light and first light.
    const night = el < -6 ? 1 : el < 0 ? 1 : el < 8 ? 0.75 : 0.12;
    const season = sp ? seasonal(sp.seasonal_activity, w.clock) : 0.7;
    let act = night * season;
    // Summer heat suppresses daytime movement, which is in the pack's own seasonal note.
    const wx = w.read('weather');
    if (wx && el > 0) act *= clamp(1 - (wx.apparentC - 27) / 16, 0.15, 1);
    if (a.dispDays > 0) act = Math.max(act, 0.85);
    if (a.infection === 2) act *= 0.6;
    return clamp(act, 0, 1);
  }

  /* ---------------------------------------------------------------- one animal */

  function updateAnimal(w, a, dtDays) {
    const wx = w.read('weather');
    const veg = w.read('vegetation');
    const act = activity(w, a);
    a.moving = false;
    a.onGround = false;

    /* --- move --- */
    if (rng.float() < act) {
      a.moving = true;
      const step = a.dispDays > 0 ? rng.range(180, 900) : rng.range(12, 70);
      let ang = rng.range(0, Math.PI * 2);
      if (a.dispDays > 0) {
        // A dispersing male walks in one direction for weeks, which is why late winter and spring
        // are when koalas turn up on the road and in somebody's yard.
        ang = a.dispAngle;
      } else {
        // Otherwise the animal stays inside a home range centred on its feed trees.
        const dx = a.hx - a.x, dz = a.hz - a.z;
        const d = Math.hypot(dx, dz);
        if (d > a.rangeM) ang = Math.atan2(dz, dx) + rng.range(-0.6, 0.6);
      }
      const nx = a.x + Math.cos(ang) * step;
      const nz = a.z + Math.sin(ang) * step;
      if (w.island && w.island.isLand(nx, nz)) {
        // A koala on the move between trees is a koala on the ground.
        a.onGround = true;
        checkRoad(w, a, a.x, a.z, nx, nz);
        if (!a.dead) {
          a.x = nx; a.z = nz;
          // Keep the entity's position current rather than waiting for the daily pass, so a
          // render layer or an inspector is looking at where the animal is now.
          const pos = w.store.get(a.eid, 'position');
          if (pos) { pos.x = nx; pos.z = nz; pos.y = w.island.height(nx, nz); }
        }
      }
    }

    /* --- heat --- */
    // Koalas do not drink much when the leaves are wet, and in a heatwave they come down to find
    // water. That is when the dogs and the cars get them, which is why heat shows up in this model
    // as a movement change before it shows up as a death.
    let heat = 0;
    if (wx) {
      heat = clamp((wx.apparentC - 33) / 9, 0, 1);
      if (heat > 0.15 && rng.float() < heat * 0.35) a.onGround = true;
      a.cond -= heat * 0.05 * dtDays;
    }

    /* --- food and crowding --- */
    const q = veg && veg.foodTreeAt ? veg.foodTreeAt(a.x, a.z) : 0.5;
    const crowd = crowdingAt(a.x, a.z);
    const feed = clamp(0.34 + q * 1.05, 0, 1) * clamp(1.22 - crowd * 0.26, 0.35, 1);
    a.cond += (feed - a.cond) * 0.06 * dtDays;
    if (a.infection === 2) a.cond -= 0.0016 * dtDays;
    a.cond = clamp(a.cond, 0, 1);

    // Crowding or a burnt-out patch sends young males walking.
    if (a.dispDays > 0) {
      a.dispDays -= dtDays;
      if (a.dispDays <= 0) {
        // A dispersing animal settles where the trees are, not where it happened to stop. Without
        // this the population walks itself into the heath and the beaches over a decade and starves
        // there, which is a modelling artefact and not a koala.
        let bx = a.x, bz = a.z, best = capacityAt(a.x, a.z);
        for (let t = 0; t < 8; t++) {
          const ang = rng.range(0, Math.PI * 2), d = rng.range(150, 900);
          const tx = a.x + Math.cos(ang) * d, tz = a.z + Math.sin(ang) * d;
          if (!w.island || !w.island.isLand(tx, tz)) continue;
          const c = capacityAt(tx, tz);
          if (c > best) { best = c; bx = tx; bz = tz; }
        }
        if (best <= 0.004) { a.dispDays = rng.range(4, 14); a.dispAngle = rng.range(0, Math.PI * 2); }
        else { a.x = bx; a.z = bz; a.hx = bx; a.hz = bz; }
      }
    } else if (a.sex === 'm' && a.age > 1.6 * YEAR && a.age < 4 * YEAR
      && (crowd > 1.1 || q < 0.12) && rng.float() < 0.02 * dtDays) {
      a.dispDays = rng.range(8, 40);
      a.dispAngle = rng.range(0, Math.PI * 2);
    }

    /* --- dogs, and the yards they are in --- */
    if (a.onGround && dogsToday) {
      const near = townshipShareAt(a.x, a.z);
      if (near > 0.02) {
        const p = 1.2e-5 * dogsToday.roaming * near * dtDays;
        if (rng.float() < p) { kill(w, a, 'dog'); return; }
        // A koala on the ground in a yard is a phone call whether or not anything happens to it,
        // and on this island that call is the commonest koala contact the rescue service gets.
        if (rng.float() < 0.0015 * near * dtDays) {
          w.bus.emit('wildlife:call', {
            species: 'Koala', situation: 'koala on the ground in a yard',
            where: whereOf(a), x: a.x, z: a.z, joeyPossible: false,
            contact: 'Wildlife Rescue Minjerribah 0448 466 556'
          });
        }
      }
    }

    /* --- disease --- */
    stepDisease(w, a, dtDays, heat, crowd);
    if (a.dead) return;

    /* --- breeding --- */
    stepBreeding(w, a, dtDays);

    /* --- age and the rest of the ways a koala dies --- */
    a.age += dtDays;
    const ageY = a.age / YEAR;
    // Age hazard: high in the first two years, low through the middle, rising past ten.
    let hazard = ageY < 2 ? 0.235 : ageY < 10 ? 0.072 : 0.072 + (ageY - 10) * 0.075;
    hazard *= clamp(1.7 - a.cond * 1.05, 0.65, 1.7);
    if (rng.float() < hazard * dtDays / YEAR) { kill(w, a, 'natural'); return; }
    if (a.cond < 0.06 && rng.float() < 0.25 * dtDays) { kill(w, a, heat > 0.5 ? 'heat' : 'natural'); }
  }

  function stepDisease(w, a, dtDays, heat, crowd) {
    a.infDays += dtDays;
    if (a.infection === 0) {
      // Transmission is contact driven, so it tracks crowding rather than the calendar.
      const p = 0.085 * clamp(0.4 + crowd, 0.4, 2.4) / YEAR;
      if (rng.float() < p * dtDays) { a.infection = 1; a.infDays = 0; }
      return;
    }
    if (a.infection === 1) {
      // Latent to clinical. Stress is the trigger, and on this island there is less of it: the
      // pack attributes the lower clinical rate to lower habitat disturbance, so the model makes
      // heat, crowding and poor condition the drivers rather than a fixed rate.
      const stress = clamp(0.25 + (1 - a.cond) * 0.9 + heat * 0.8 + Math.max(0, crowd - 1) * 0.6, 0, 3);
      const p = 0.052 * stress / YEAR;
      if (rng.float() < p * dtDays) {
        a.infection = 2; a.infDays = 0;
        log.push({ day: w.clock.formatDate(), what: 'clinical disease', where: whereOf(a) });
      }
      return;
    }
    // Clinical. Sick animals decline over one to three years and are infertile while they do.
    const p = (0.26 + (1 - a.cond) * 0.55) / YEAR;
    if (rng.float() < p * dtDays) kill(w, a, 'disease');
  }

  function stepBreeding(w, a, dtDays) {
    if (a.sex !== 'f') return;
    if (a.joey >= 0) {
      a.joey += dtDays;
      // Pouch for about six months, on the back to about twelve, then independent.
      if (a.joey > 340) {
        const ok = rng.float() < clamp(0.45 + a.cond * 0.5, 0, 0.95);
        if (ok && animals.length < 1200) {
          const y = makeKoala(w, a.x + rng.range(-90, 90), a.z + rng.range(-90, 90), 1, rng.bool(0.48) ? 'm' : 'f');
          y.cond = clamp(a.cond * rng.range(0.7, 1.0), 0.2, 0.9);
          if (a.infection > 0 && rng.float() < 0.45) y.infection = 1;
          animals.push(y);
        }
        a.joey = -1;
      }
      return;
    }
    if (a.age < 2 * YEAR || a.infection === 2 || a.cond < 0.42) return;
    // Breeding season: births run through the warm months, so conception is spring into summer.
    const m = w.clock.month;
    if (!(m >= 8 || m <= 1)) return;
    const crowd = crowdingAt(a.x, a.z);
    const p = 0.024 * clamp(a.cond * 1.4, 0, 1.3) * clamp(1.3 - crowd * 0.42, 0.05, 1.2);
    if (rng.float() < p * dtDays) {
      a.joey = 0;
      births.add(1);
    }
  }

  /* ---------------------------------------------------------------- roads */

  function checkRoad(w, a, ax, az, bx, bz) {
    if (!roads || !roads.ready) return;
    const seg = roads.crossing(ax, az, bx, bz);
    if (!seg) return;
    crossRing.add(1);
    if (seg.cls === 'walk') return;
    const veh = trafficNow(w);
    // Most of the island's traffic is on the one sealed spine, so a sand track carries a fraction.
    const share = seg.sealed ? 1 : 0.12;
    // Risk goes with speed harder than with volume: a strike at fifty is survivable and at eighty
    // is not, and the driver's chance of seeing the animal at dusk falls off the same way.
    const speed = effectiveSpeed(seg);
    const daylight = w.read('daylight');
    const dark = !daylight || daylight.elevationDeg < 2 ? 1.9 : 1;
    const p = 4.0e-6 * veh * share * Math.pow(speed / 50, 2.1) * dark;
    if (rng.float() > p) return;

    strikeByRoad.set(seg.name, (strikeByRoad.get(seg.name) || 0) + 1);
    // Not every strike kills at the scene. Roughly two in five animals are found alive, which is
    // most of what the rescue service actually attends, and whether they come through depends on
    // how fast somebody with a carrier and a vet contact can get there.
    if (rng.float() < 0.62) { kill(w, a, 'vehicle', seg.name); return; }
    a.cond = clamp(a.cond - 0.4, 0.02, 1);
    a.injured = true;
    w.bus.emit('wildlife:call', {
      species: 'Koala',
      situation: 'koala hit on the road, alive',
      where: seg.name, x: a.x, z: a.z,
      joeyPossible: a.sex === 'f' && a.joey >= 0,
      contact: 'Wildlife Rescue Minjerribah 0448 466 556'
    });
    log.push({ day: w.clock.formatDate(), what: 'hit and found alive', where: seg.name });
    const rescued = rng.float() < 0.32 + 0.42 * L.level('wildlife-rescue-support');
    if (rescued) a.cond = clamp(a.cond + 0.3, 0, 1);
    else if (rng.float() < 0.55) kill(w, a, 'vehicle', seg.name);
  }

  /**
   * The signposted limit, moved by the wildlife speed lever. The pack's own note on this lever is
   * the trade-off worth remembering: a speed limit that saves koalas also lengthens the run to
   * Point Lookout and annoys the people trying to make the barge.
   */
  function effectiveSpeed(seg) {
    const lever = L.level('wildlife-speed-and-crossings');
    const base = seg.speedKmh || seg.speed || 50;
    return base * (1 - 0.18 * lever);
  }

  /* ---------------------------------------------------------------- death and rescue */

  function kill(w, a, cause, detail) {
    if (a.dead) return;
    a.dead = cause;
    deaths[cause].add(1);
    lifetime[cause]++;
    const found = rng.float() < DETECTION[cause];
    if (found) recorded[cause].add(1);
    const where = whereOf(a);
    if (cause === 'vehicle' || cause === 'dog' || (cause === 'heat' && found)) {
      log.push({ day: w.clock.formatDate(), what: cause === 'vehicle' ? 'hit on the road' : cause === 'dog' ? 'dog attack' : 'heat', where: detail || where });
      w.bus.emit('wildlife:call', {
        species: 'Koala',
        situation: cause === 'vehicle' ? 'koala hit on the road' : cause === 'dog' ? 'koala taken by a dog' : 'koala down in the heat',
        where: detail || where, x: a.x, z: a.z,
        joeyPossible: a.sex === 'f' && a.joey >= 0,
        contact: 'Wildlife Rescue Minjerribah 0448 466 556'
      });
    }
    if (a.eid) w.store.destroy(a.eid);
  }

  function whereOf(a) {
    return world.island ? world.island.regionAt(a.x, a.z) : 'Minjerribah';
  }

  /** How much this point is inside a township, which is where the dogs and the cars are. */
  const townCentres = [];
  function buildTownships(w) {
    for (const id of ['point-lookout', 'dunwich', 'amity-point']) {
      const p = place(w, id);
      if (p) townCentres.push({ id, name: p.name, x: p.x, z: p.z, r: id === 'amity-point' ? 1100 : 1500 });
    }
    if (!townCentres.length) notes.push('data/places.json has no townships: dog and traffic pressure cannot be placed.');
  }
  function townshipShareAt(x, z) {
    let best = 0;
    for (const t of townCentres) {
      const d = Math.hypot(x - t.x, z - t.z);
      const v = 1 - smoothstep(t.r * 0.6, t.r * 1.9, d);
      if (v > best) best = v;
    }
    return best;
  }

  /* ---------------------------------------------------------------- fire */

  world.bus.on('ecology:burn', (p) => {
    if (!p || !Number.isFinite(p.x)) return;
    // A hot fire in a food tree stand kills the animals in it and moves the survivors. The
    // vegetation system has already taken the trees; this takes the koalas that were in them.
    const r = p.radiusM || 400;
    for (const a of animals) {
      if (a.dead) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d > r) continue;
      const hot = p.cause === 'wildfire' ? 0.22 : 0.03;
      if (rng.float() < hot) kill(world, a, 'fire');
      else {
        // Move out of the scar. A displaced koala crosses roads it does not know.
        const ang = Math.atan2(a.z - p.z, a.x - p.x);
        a.hx = p.x + Math.cos(ang) * (r + 400);
        a.hz = p.z + Math.sin(ang) * (r + 400);
        a.dispDays = Math.max(a.dispDays, 6);
        a.dispAngle = ang;
      }
    }
  });

  /* ---------------------------------------------------------------- the daily pass */

  function dailyPass(w) {
    // Density, so crowding and carrying capacity mean something local.
    densityCell.fill(0);
    let adults = 0, joeys = 0, young = 0, males = 0, females = 0;
    let ageSum = 0, condSum = 0, rangeSum = 0;
    let naive = 0, latent = 0, clinical = 0;
    let alive = 0, onGround = 0, moving = 0, dispersing = 0;
    const keep = [];
    for (const a of animals) {
      if (a.dead) continue;
      keep.push(a);
      alive++;
      densityCell[g.at(a.x, a.z)] += 1;
      const ageY = a.age / YEAR;
      if (ageY >= 2) adults++; else young++;
      if (a.joey >= 0) joeys++;
      if (a.sex === 'm') males++; else females++;
      if (a.onGround) onGround++;
      if (a.moving) moving++;
      if (a.dispDays > 0) dispersing++;
      ageSum += ageY; condSum += a.cond; rangeSum += Math.PI * a.rangeM * a.rangeM / 10000;
      if (a.infection === 0) naive++; else if (a.infection === 1) latent++; else clinical++;
      const pos = w.store.get(a.eid, 'position');
      if (pos) { pos.x = a.x; pos.z = a.z; pos.y = w.island ? w.island.height(a.x, a.z) : 0; }
    }
    animals = keep;
    boxSum(densityCell, densityNbr);
    dogsToday = dogPressure(w, 1);

    state.population = alive;
    state.adults = adults;
    state.independentYoung = young;
    state.joeys = joeys;
    state.males = males; state.females = females;
    state.meanAgeY = alive ? +(ageSum / alive).toFixed(1) : 0;
    state.meanCondition = alive ? +(condSum / alive).toFixed(3) : 0;
    state.homeRangeMeanHa = alive ? +(rangeSum / alive).toFixed(1) : 0;
    state.disease = {
      naive, latent, clinical,
      prevalence: alive ? +((latent + clinical) / alive).toFixed(3) : 0,
      clinicalShare: alive ? +(clinical / alive).toFixed(3) : 0
    };
    state.occupancy = totalK > 0 ? +(alive / totalK).toFixed(3) : 0;

    let d = 0, r = 0;
    for (const c of Object.keys(deaths)) {
      state.deaths365[c] = Math.round(deaths[c].total);
      state.recorded365[c] = Math.round(recorded[c].total);
      d += deaths[c].total; r += recorded[c].total;
    }
    state.deaths365.total = Math.round(d);
    state.recorded365.total = Math.round(r);
    state.births365 = Math.round(births.total);
    state.roadCrossings365 = Math.round(crossRing.total);

    // The calibration, published rather than claimed. Scale our recorded deaths to the same
    // thirteen and a half years the island's own record covers.
    const yearsRun = Math.max(0.08, lifetime.days / YEAR);
    const f = RECORDED_1997_2010.years / yearsRun;
    state.calibration = {
      published: { vehicle: 35, disease: 21, dog: 16, period: '1997 to 2010, recorded on this island' },
      modelledOverSamePeriod: {
        vehicle: Math.round(lifetime.vehicle * DETECTION.vehicle * f),
        disease: Math.round(lifetime.disease * DETECTION.disease * f),
        dog: Math.round(lifetime.dog * DETECTION.dog * f)
      },
      note: 'Recorded, not total. Detection rates are modelling choices: '
        + `${DETECTION.vehicle} of road deaths found, ${DETECTION.dog} of dog attacks, ${DETECTION.disease} of disease deaths.`
    };

    const spots = [...strikeByRoad.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 4);
    state.blackspots = spots.map(([name, n]) => ({ road: name, strikes: n }));

    const wx = w.read('weather');
    heatIndex = wx ? clamp((wx.apparentC - 32) / 10, 0, 1) : 0;
    state.heatStress = +heatIndex.toFixed(2);
    state.onGroundNow = onGround;
    state.movingNow = moving;
    state.dispersing = dispersing;

    // A handful of individuals for the inspector, so a player can follow one animal across years.
    // Sorted by id so the same animals stay on the list as others are born and die: a panel whose
    // rows reshuffle every time something dies is not a panel anybody can follow.
    const followed = animals.slice().sort((a, b) => a.id - b.id).slice(0, 16);
    state.individuals = followed.map((a) => ({
      id: a.id, sex: a.sex === 'm' ? 'male' : 'female',
      ageY: +(a.age / YEAR).toFixed(1),
      where: whereOf(a),
      condition: +a.cond.toFixed(2),
      homeRangeHa: +(Math.PI * a.rangeM * a.rangeM / 10000).toFixed(1),
      health: a.infection === 2 ? 'clinical chlamydiosis' : a.infection === 1 ? 'carrying chlamydia, no signs' : 'no signs',
      joey: a.joey >= 0 ? (a.joey < 190 ? 'joey in pouch' : 'joey on her back') : null,
      doing: a.dispDays > 0 ? 'dispersing' : a.moving ? 'on the move' : 'up a tree'
    }));

    state.events = log.recent(6);
    state.levers = L.snapshot(['wildlife-speed-and-crossings', 'dog-control-enforcement',
      'koala-habitat-overlay', 'wildlife-rescue-support', 'feral-and-weed-control']);
    state.civicMetrics = {
      koala_population: metric(0.5 * clamp(alive / 340, 0, 1.4) / 1.4 + 0.5 * clamp(1 - state.disease.clinicalShare * 6, 0, 1)),
      wildlife_road_deaths: metric(1 - clamp(state.deaths365.vehicle / 18, 0, 1)),
      dog_incidents: metric(clamp(state.deaths365.dog / 12, 0, 1))
    };
  }

  /* ---------------------------------------------------------------- registration */

  return world.register({
    id: 'koala',
    phase: 'ecology',
    order: 40,

    init(w) {
      if (!buildCapacity(w)) { notes.push('no island: no koalas.'); return; }
      roads = roadIndex(w);
      buildTownships(w);
      seedPopulation(w);
      state.ready = animals.length > 0;
      state.populationBasis = sp && sp.population_estimate ? sp.population_estimate.basis
        : 'no published island-wide total; 200 to 600 is a modelling range';
      state.rescue = {
        service: 'Wildlife Rescue Minjerribah',
        number: '0448 466 556',
        marineStrandings: '1300 130 372',
        publicRule: 'Watch, keep back, call. The public is never asked to handle or contain an animal.',
        source: 'data/ecology.json proc-wildlife-response'
      };
      if (!roads.ready) notes.push('no road network published: road strike cannot be modelled.');
      notes.push(`${animals.length} koalas placed by food tree density. The island total is not published anywhere: `
        + 'the pack gives 200 to 600 as a modelling range and this sits inside it.');
      notes.push('Carrying capacity is derived from the vegetation system, so hot fire in a food tree '
        + 'stand lowers the koala ceiling for about eleven years and the population follows it down.');
      lastDay = absDay(w.clock);
      dailyPass(w);
      w.bus.emit('koala:ready', { population: animals.length });
    },

    tick(w) {
      if (!state.ready) return;
      const n = animals.length;
      if (!n) return;

      // Round robin: every animal is updated once every nine ticks, which is ninety sim-minutes.
      const slice = Math.ceil(n / SLICES);
      const dtDays = (SLICES * 10) / 1440;
      for (let i = 0; i < slice; i++) {
        cursor = cursor >= n ? 0 : cursor;
        const a = animals[cursor++];
        if (a && !a.dead) updateAnimal(w, a, dtDays);
      }

      const day = absDay(w.clock);
      if (day === lastDay) return;
      lastDay = day;
      lifetime.days++;
      for (const c of Object.keys(deaths)) { deaths[c].roll(); recorded[c].roll(); }
      births.roll();
      crossRing.roll();
      if (w.clock.dayOfMonth === 1) refreshCapacity(w);
      dailyPass(w);

      if (state.population < 90 && w.clock.dayOfMonth === 1) {
        w.bus.emit('ecology:alert', {
          id: 'koala-low',
          text: `The koala population is down to ${state.population}. This population has the lowest genetic `
            + 'diversity in south-east Queensland and there is nowhere for it to be topped up from.'
        });
      }
    },

    describe(w) {
      return {
        population: state.population,
        adults: state.adults, joeys: state.joeys,
        cond: state.meanCondition,
        prevalence: state.disease.prevalence,
        clinical: state.disease.clinicalShare,
        K: state.carryingCapacity,
        occupancy: state.occupancy,
        births365: state.births365,
        deaths365: state.deaths365.total,
        vehicle365: state.deaths365.vehicle,
        dog365: state.deaths365.dog,
        disease365: state.deaths365.disease,
        crossings365: state.roadCrossings365,
        rangeHa: state.homeRangeMeanHa,
        dispersing: state.dispersing,
        blackspot: state.blackspots[0] ? state.blackspots[0].road : null
      };
    },

    save(w) {
      return {
        nextId,
        animals: animals.map((a) => ({
          id: a.id, sex: a.sex, age: a.age, x: a.x, z: a.z, hx: a.hx, hz: a.hz,
          rangeM: a.rangeM, cond: a.cond, infection: a.infection, infDays: a.infDays,
          joey: a.joey, dispDays: a.dispDays, dispAngle: a.dispAngle || 0
        })),
        lifetime: { ...lifetime },
        strikeByRoad: [...strikeByRoad.entries()],
        log: log.save()
      };
    },
    load(w, s) {
      if (!s || !state.ready) return;
      for (const a of animals) if (a.eid) w.store.destroy(a.eid);
      animals = [];
      nextId = s.nextId || 1;
      for (const r of s.animals || []) {
        const a = makeKoala(w, r.x, r.z, r.age / YEAR, r.sex);
        Object.assign(a, r);
        animals.push(a);
      }
      Object.assign(lifetime, s.lifetime || {});
      strikeByRoad.clear();
      for (const [k, v] of s.strikeByRoad || []) strikeByRoad.set(k, v);
      log.load(s.log);
      dailyPass(w);
    }
  });
}
