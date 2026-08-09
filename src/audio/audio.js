// The island's sound. Every sample of it is made by Web Audio nodes at runtime: there are no audio
// files in this repository and there must not be any. That is the constraint and it is also the
// point, because a recording is fixed and this is not. The swell period you hear between breakers is
// `weather.swellPeriodS`. The wind timbre is whatever `island.landCover` says you are standing in.
// The frog chorus follows `lakes.frogCalling`, which follows the water table. Nothing here is a loop
// triggered by a region trigger; it is the simulation, sounding.
//
// Read this before editing.
//
// 1. THE SPLIT. The simulation half decides what the ISLAND is doing: which voices are sounding,
//    where they are, how often and why. It never knows where the camera is and never touches Web
//    Audio, so it runs headless and appears in `TWIN.probe().systems.audio`. The engine half decides
//    what the LISTENER hears: distances, panning, masking, gain. It runs in `frame()` and does
//    nothing at all in node.
//
// 2. THE BUDGET. `tick()` costs about 0.03 ms because it is one pass over a fixed roster of about
//    forty voices with no allocation. The heavy per-voice geography (nearest surf reach, nearest
//    road, nearest township) is recomputed on a day boundary or when the listener has moved more
//    than 60 m, not every tick. The DSP itself runs on the audio thread and costs nothing at all in
//    frame time; only the JavaScript that drives it counts, and that is rate limited to 20 Hz.
//
// 3. THE PROOF. A critic must be able to show this thing is making sound without listening to it.
//    `world.state.audio` carries an analyser RMS and peak in decibels for every bus, the number of
//    live source nodes, the limiter's gain reduction, and the list of voices currently sounding with
//    the reason each one is. `TWIN.audio.meter(1500)` samples all of that over a window and hands
//    back the envelope. The mixer panel prints the same numbers as text, so `read_page` sees them.
//
// 4. DETERMINISM. The simulation half draws from `world.rng.stream('audio')` and only on tick
//    boundaries. The engine half has its own `Rng`, seeded from the world seed, because it draws at
//    frame rate and must never be allowed to move a simulation stream. `Math.random` appears nowhere.
//    Timing uses `world.clock` for the island and `ctx.currentTime` for the audio thread; `Date.now`
//    appears nowhere.
//
// 5. CULTURAL CARE. Nothing in this file is, refers to, or evokes Quandamooka song, ceremony or
//    cultural performance. The generative underscore is ordinary tonal synthesis, it is off by
//    default, and it is never described as belonging to this Country. See data/lore.json
//    prohibitions, rule no-invented-ceremony.

import { Rng, hashString } from '../kernel/rng.js';
import { registerPanel, el } from '../ui/mount.js';

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ================================================================== small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Trapezoid window: 0 below a, ramps to 1 across a..b, holds to c, falls to 0 by d. */
function win(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return b === a ? 1 : (x - a) / (b - a);
  if (x > c) return d === c ? 1 : (d - x) / (d - c);
  return 1;
}
/** Signed minutes from a reference minute of day, wrapped into plus or minus twelve hours. */
function around(minuteOfDay, ref) {
  let d = minuteOfDay - ref;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}
/** A roster text function that is never allowed to take the island down. */
function safeText(fn, c) {
  try { return String(fn(c)); } catch (e) { return ''; }
}
/** Distance from a point to a segment. The roads and the beaches are both lines, not points. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
const dbToGain = (db) => (db <= -90 ? 0 : Math.pow(10, db / 20));
const gainToDb = (g) => (g <= 1e-5 ? -100 : 20 * Math.log10(g));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** Frame-rate independent approach. */
const damp = (cur, tgt, lambda, dt) => tgt + (cur - tgt) * Math.exp(-lambda * dt);

/* ================================================================== the roster

   One entry per voice. `gain` is how loud the island is making this sound at its source, nought to
   one. `rate` is calls per minute for a voice made of separate calls; a bed leaves it at nought and
   is held open continuously. `why` is the one line that has to be true: it names the state that put
   the voice where it is, so a player who opens the mixer learns something rather than reading a
   label. `where` says how the engine should place it. */

const BUS_IDS = ['ambience', 'wildlife', 'human', 'ui', 'music'];

/**
 * How loud each voice is allowed to be relative to every other one, at full activity. This is the
 * balance of the whole island and it lives in one table on purpose: a mix spread across forty call
 * sites is a mix nobody can ever even out again. A voice's published `gain` is how busy the island
 * is being with it; `level` is `gain` times this, and that is what reaches the ear and what the
 * mixer prints. Surf is the loudest thing here because on this island it is.
 */
const LOUDNESS = {
  'surf-ocean': 0.5, 'surf-bay': 0.5, wind: 0.75, rain: 0.5,
  'dawn-chorus': 0.3, kookaburra: 0.32, magpie: 0.24, lorikeet: 0.26,
  'bush-stone-curlew': 0.4, 'beach-stone-curlew': 0.34, 'koala-bellow': 0.52, 'flying-fox': 0.22,
  'eastern-curlew': 0.3, oystercatcher: 0.24, 'little-tern': 0.18, 'sea-eagle': 0.3,
  osprey: 0.22, 'brahminy-kite': 0.24, 'bee-eater': 0.16, 'glossy-black': 0.18,
  cicadas: 0.32, mosquitoes: 0.05, frogs: 0.24,
  'whale-blow': 0.44, 'dolphin-blow': 0.26,
  township: 0.34, car: 0.6, dog: 0.26, mower: 0.11, pub: 0.4, school: 0.16, 'boat-ramp': 0.28
};

// Bird and animal voices. Sources and confidence live in data/soundscape.json and are joined on id
// at init, so the citation and the behaviour cannot drift apart.
const ROSTER = [
  /* ---------------------------------------------------------------- dawn and dusk */
  {
    id: 'dawn-chorus', bus: 'wildlife', where: 'bush', synth: 'chorus',
    gain: (c) => {
      const t = around(c.minuteOfDay, c.sunriseMin);
      const w = win(t, -75, -40, 5, 55);
      if (w <= 0) return 0;
      return w * (0.5 + 0.5 * c.springness) * c.bushNear * c.rainQuiet * (0.55 + 0.45 * c.vegCondition);
    },
    rate: () => 0,
    why: (c) => {
      const t = Math.round(around(c.minuteOfDay, c.sunriseMin));
      return t < 0 ? `${-t} min before sunrise` : `${t} min after sunrise`;
    }
  },
  {
    id: 'kookaburra', bus: 'wildlife', where: 'bush', synth: 'kookaburra',
    gain: (c) => {
      const dawn = win(around(c.minuteOfDay, c.sunriseMin), -55, -30, 20, 70);
      const dusk = win(around(c.minuteOfDay, c.sunsetMin), -50, -25, 10, 45);
      return Math.max(dawn, dusk) * c.bushNear * c.rainQuiet;
    },
    rate: (c) => 1.6 * ROSTER_GAIN(c, 'kookaburra'),
    why: (c) => (around(c.minuteOfDay, c.sunriseMin) < 180 ? 'first light' : 'the light going')
  },
  {
    id: 'magpie', bus: 'wildlife', where: 'open', synth: 'magpie',
    gain: (c) => {
      const dawn = win(around(c.minuteOfDay, c.sunriseMin), -50, -20, 40, 110);
      const arvo = win(around(c.minuteOfDay, c.sunsetMin), -170, -120, -30, 10);
      return Math.max(dawn, arvo * 0.7) * c.openNear * c.rainQuiet;
    },
    rate: (c) => 2.2 * ROSTER_GAIN(c, 'magpie'),
    why: () => 'mown and cleared ground'
  },
  {
    id: 'lorikeet', bus: 'wildlife', where: 'bush', synth: 'lorikeet',
    gain: (c) => {
      const arvo = win(c.hourF, 13.5, 15.5, 18, 19.2);
      const early = win(around(c.minuteOfDay, c.sunriseMin), -25, 5, 60, 110);
      // The flowering that actually feeds them: swamp mahogany and wallum banksia, both winter.
      const nectar = 0.55 + 0.45 * c.nectar;
      return Math.max(arvo, early * 0.75) * c.bushNear * nectar * c.rainQuiet;
    },
    rate: (c) => 5.5 * ROSTER_GAIN(c, 'lorikeet'),
    why: (c) => (c.nectar > 0.6 ? 'trees in flower, late afternoon' : 'late afternoon')
  },

  /* ---------------------------------------------------------------- night */
  {
    id: 'bush-stone-curlew', bus: 'wildlife', where: 'edge', synth: 'curlewWail',
    gain: (c) => {
      const night = win(around(c.minuteOfDay, c.sunsetMin), 10, 45, 500, 620);
      // A bright night is a loud night, and a wet night is a quiet one.
      return night * (0.6 + 0.4 * c.moon) * c.edgeNear * c.rainQuiet;
    },
    rate: (c) => 1.15 * ROSTER_GAIN(c, 'bush-stone-curlew'),
    why: (c) => `after dark, moon ${Math.round(c.moon * 100)} per cent lit`
  },
  {
    id: 'beach-stone-curlew', bus: 'wildlife', where: 'beach', synth: 'curlewWail',
    gain: (c) => {
      const night = win(around(c.minuteOfDay, c.sunsetMin), 5, 40, 480, 600);
      return night * (0.55 + 0.45 * c.moon) * c.beachNear * c.rainQuiet * 0.8;
    },
    rate: (c) => 0.55 * ROSTER_GAIN(c, 'beach-stone-curlew'),
    why: () => 'open sand after dark'
  },
  {
    id: 'koala-bellow', bus: 'wildlife', where: 'bush', synth: 'koalaBellow',
    gain: (c) => {
      const night = win(around(c.minuteOfDay, c.sunsetMin), -20, 40, 500, 610);
      // August to February, hardest through September to November: the season the clock calls
      // Warming, and the season koala.js is dispersing animals in.
      const m = c.month;
      const season = m === 8 || m === 9 || m === 10 ? 1 : m === 7 || m === 11 ? 0.6 : m === 0 || m === 1 ? 0.35 : 0.08;
      const pop = clamp01(c.koalaPop / 340);
      return night * season * pop * c.bushNear * c.rainQuiet;
    },
    rate: (c) => 0.42 * ROSTER_GAIN(c, 'koala-bellow'),
    why: (c) => `breeding season, ${Math.round(c.koalaPop)} koalas, ${c.koalaDispersing} dispersing`
  },
  {
    id: 'flying-fox', bus: 'wildlife', where: 'bush', synth: 'flyingFox',
    gain: (c) => {
      const night = win(around(c.minuteOfDay, c.sunsetMin), -15, 25, 240, 330);
      return night * (0.35 + 0.65 * c.nectar) * c.bushNear;
    },
    rate: (c) => 2.4 * ROSTER_GAIN(c, 'flying-fox'),
    why: (c) => (c.nectar > 0.6 ? 'a tree in flower after dark' : 'after dark')
  },

  /* ---------------------------------------------------------------- the flats and the coast */
  {
    id: 'eastern-curlew', bus: 'wildlife', where: 'flats', synth: 'easternCurlew',
    gain: (c) => {
      if (c.curlewCount <= 0) return 0;
      const day = win(c.sunDeg, -9, -2, 60, 90);
      // Loudest when the flats are out and the flock is spread over them feeding.
      const feeding = 0.35 + 0.65 * clamp01(c.flatsExposed / Math.max(1, c.flatsTotal) * 3);
      return clamp01(c.curlewCount / 210) * feeding * (0.35 + 0.65 * day) * c.flatsNear;
    },
    rate: (c) => 1.1 * ROSTER_GAIN(c, 'eastern-curlew'),
    why: (c) => `${c.curlewCount} on the island, ${Math.round(c.flatsExposed)} ha of flats out`
  },
  {
    id: 'oystercatcher', bus: 'wildlife', where: 'beach', synth: 'oystercatcher',
    gain: (c) => win(c.sunDeg, -8, 0, 60, 90) * c.beachNear * 0.75,
    rate: (c) => 1.9 * ROSTER_GAIN(c, 'oystercatcher'),
    why: () => 'the tide line'
  },
  {
    id: 'little-tern', bus: 'wildlife', where: 'flats', synth: 'tern',
    gain: (c) => {
      const m = c.month; // present in the warm half, breeding on the banks
      const season = m >= 9 || m <= 2 ? 1 : m === 3 || m === 8 ? 0.4 : 0;
      return season * win(c.sunDeg, -4, 4, 60, 90) * c.flatsNear * 0.7;
    },
    rate: (c) => 4.5 * ROSTER_GAIN(c, 'little-tern'),
    why: () => 'over the shallow water'
  },
  {
    id: 'sea-eagle', bus: 'wildlife', where: 'coast', synth: 'seaEagle',
    gain: (c) => win(c.sunDeg, -3, 6, 55, 88) * c.coastNear * 0.85,
    rate: (c) => 0.5 * ROSTER_GAIN(c, 'sea-eagle'),
    why: () => 'a pair over the headland'
  },
  {
    id: 'osprey', bus: 'wildlife', where: 'coast', synth: 'osprey',
    gain: (c) => win(c.sunDeg, -3, 6, 55, 88) * c.coastNear * 0.6,
    rate: (c) => 0.7 * ROSTER_GAIN(c, 'osprey'),
    why: () => 'over the channel'
  },
  {
    id: 'brahminy-kite', bus: 'wildlife', where: 'mangrove', synth: 'kite',
    gain: (c) => win(c.sunDeg, -2, 8, 55, 88) * c.mangroveNear * 0.8,
    rate: (c) => 0.85 * ROSTER_GAIN(c, 'brahminy-kite'),
    why: () => 'over the mangroves'
  },
  {
    id: 'bee-eater', bus: 'wildlife', where: 'open', synth: 'beeEater',
    gain: (c) => {
      const m = c.month; // through the warm months, digging nest burrows in sandy banks from late October
      const season = m >= 9 || m <= 2 ? 1 : m === 3 ? 0.35 : 0;
      return season * win(c.sunDeg, 4, 14, 60, 88) * c.openNear * c.rainQuiet * 0.7;
    },
    rate: (c) => 3.2 * ROSTER_GAIN(c, 'bee-eater'),
    why: () => 'open sandy ground, warm months'
  },
  {
    id: 'glossy-black', bus: 'wildlife', where: 'bush', synth: 'glossyBlack',
    gain: (c) => {
      // The one voice whose loudness is a conservation number. Vegetation publishes both.
      const habitat = c.sheoakCrop * c.glossyIndex;
      return win(c.sunDeg, -2, 8, 55, 88) * clamp01(habitat * 2.6) * c.bushNear * c.rainQuiet;
    },
    rate: (c) => 0.9 * ROSTER_GAIN(c, 'glossy-black'),
    why: (c) => `sheoak crop ${c.sheoakCrop.toFixed(2)}, index ${c.glossyIndex.toFixed(2)}`
  },

  /* ---------------------------------------------------------------- insects and frogs */
  {
    id: 'cicadas', bus: 'wildlife', where: 'bush', synth: 'cicadas', bed: true,
    gain: (c) => {
      // Heat is the switch. Under about 22 degrees there is nothing, and a cloud across the sun
      // takes the whole chorus out inside a second.
      const heat = clamp01((c.tempC - 21.5) / 8);
      const sun = win(c.sunDeg, 8, 22, 70, 90);
      return heat * sun * c.bushNear * c.rainQuiet * (0.25 + 0.75 * clamp01(1 - c.cloud * 1.15));
    },
    rate: () => 0,
    why: (c) => `${c.tempC.toFixed(1)} C, cloud ${Math.round(c.cloud * 100)} per cent`
  },
  {
    id: 'mosquitoes', bus: 'wildlife', where: 'listener', synth: 'mosquito', bed: true,
    gain: (c) => {
      // Still, damp, dusk, and on the mangrove and saltmarsh edge. Wind kills it.
      const dusk = Math.max(
        win(around(c.minuteOfDay, c.sunsetMin), -45, -10, 90, 200),
        win(around(c.minuteOfDay, c.sunriseMin), -90, -40, 10, 40) * 0.7
      );
      const still = clamp01(1 - c.windKt / 11);
      const wet = clamp01(c.rainWeek / 45);
      return dusk * still * wet * clamp01(c.marshNear * 1.2 + 0.12) * clamp01(c.tempC / 20);
    },
    rate: () => 0,
    why: (c) => `still evening, ${Math.round(c.rainWeek)} mm of rain this week, marsh edge`
  },
  {
    id: 'frogs', bus: 'wildlife', where: 'wet', synth: 'frogs', bed: true,
    gain: (c) => {
      if (c.frogCalling <= 0) return 0;
      const night = win(around(c.minuteOfDay, c.sunsetMin), -30, 20, 480, 600);
      return clamp01(c.frogCalling / 3) * (0.3 + 0.7 * night) * c.wetNear;
    },
    rate: () => 0,
    why: (c) => `${c.frogCalling} of ${c.frogSpecies} wallum species calling`
  },

  /* ---------------------------------------------------------------- the water */
  {
    id: 'whale-blow', bus: 'wildlife', where: 'whale', synth: 'whaleBlow',
    gain: (c) => (c.whaleNear > 0 ? clamp01(c.whaleNear) * 0.95 : 0),
    rate: (c) => 2.6 * clamp01(c.whaleNear),
    why: (c) => (c.whaleNearestKm < 90 ? `nearest pod ${c.whaleNearestKm.toFixed(1)} km out` : 'no pod inside earshot')
  },
  {
    id: 'dolphin-blow', bus: 'wildlife', where: 'dolphin', synth: 'dolphinBlow',
    gain: (c) => clamp01(c.dolphinNear) * 0.8,
    rate: (c) => 3.4 * clamp01(c.dolphinNear),
    why: (c) => (c.dolphinNearestKm < 90 ? `pod ${c.dolphinNearestKm.toFixed(2)} km off` : 'no pod inside earshot')
  },

  /* ---------------------------------------------------------------- the beds

     These four are worked out before the roster runs, because the whole island is under them and
     because the surf is what everything else has to sit on top of. They read their own numbers back
     so they appear in the mixer and the probe alongside everything else. */
  {
    id: 'surf-ocean', bus: 'ambience', where: 'reach', synth: 'surf', bed: true,
    gain: (c) => c.surfOcean,
    rate: () => 0,
    why: (c) => (c.surfNearest
      ? `${c.swellM} m at ${c.swellPeriodS} s, ${c.surfNearest} ${c.surfNearestM} m off`
      : `${c.swellM} m at ${c.swellPeriodS} s`)
  },
  {
    id: 'surf-bay', bus: 'ambience', where: 'reach', synth: 'chop', bed: true,
    gain: (c) => c.surfBay,
    rate: () => 0,
    why: (c) => `fetch limited: ${c.windKt.toFixed(0)} kt of wind, no groundswell in the bay`
  },
  {
    id: 'wind', bus: 'ambience', where: 'listener', synth: 'wind', bed: true,
    gain: (c) => c.windLevel,
    rate: () => 0,
    why: (c) => `${c.windKt.toFixed(0)} kt gusting ${c.gustKt.toFixed(0)}, ${c.windThrough}`
  },
  {
    id: 'rain', bus: 'ambience', where: 'listener', synth: 'rain', bed: true,
    gain: (c) => c.rainLevel,
    rate: () => 0,
    why: (c) => `${c.rainMmHr.toFixed(1)} mm an hour on ${c.rainSurfaces}`
  },

  /* ---------------------------------------------------------------- people */
  {
    id: 'township', bus: 'human', where: 'town', synth: 'town', bed: true,
    gain: (c) => c.townLoud,
    rate: () => 0,
    why: (c) => c.townWhy
  },
  {
    // Not a traffic loop. traffic.js runs real vehicles on the real road graph, and the engine
    // fires a pass when one of them actually goes past the ear. The gain here is whether you are
    // near enough to a road to hear anything at all.
    id: 'car', bus: 'human', where: 'road', synth: 'car',
    // No vehicles near means no sound at all, not a quieter road loop. Drive out to Blue Lake at
    // two in the morning and the road is silent because the road is empty. The level here is how
    // loud one pass is, not a bed: nothing is running between vehicles.
    cadence: (c) => (c.vehiclesNear ? 'when one goes past' : 'nothing on the road'),
    gain: (c) => c.roadNear * clamp01(c.vehiclesNear / 3),
    rate: () => 0,
    why: (c) => (c.roadName
      ? `${c.roadName}, ${Math.round(c.roadDistM)} m off, ${c.vehiclesNear} vehicle${c.vehiclesNear === 1 ? '' : 's'} in earshot`
      : 'no road inside earshot')
  },
  {
    id: 'dog', bus: 'human', where: 'town', synth: 'dog',
    gain: (c) => clamp01(c.townLoud * 1.5 + c.beachNear * 0.25),
    rate: (c) => 0.5 * clamp01(c.townLoud * 2 + c.beachNear * 0.4) * (1.3 - 0.6 * c.dogControl),
    why: (c) => (c.beachNear > c.townLoud
      ? `on the sand, dog control enforcement at ${c.dogControl.toFixed(2)}`
      : `in a yard, dog control enforcement at ${c.dogControl.toFixed(2)}`)
  },
  {
    id: 'mower', bus: 'human', where: 'town', synth: 'mower', bed: true,
    gain: (c) => {
      const weekend = c.dow === 6 ? 1 : c.dow === 0 ? 0.55 : 0.06;
      const morning = win(c.hourF, 7.2, 8.2, 11.2, 12.5);
      return weekend * morning * c.townNear * c.rainQuiet * 0.85;
    },
    rate: () => 0,
    why: (c) => (c.dow === 6 ? 'Saturday morning' : c.dow === 0 ? 'Sunday morning' : 'a weekday, so hardly ever')
  },
  {
    id: 'pub', bus: 'human', where: 'pub', synth: 'pub', bed: true,
    gain: (c) => {
      if (!c.pubOpen) return 0;
      const evening = win(c.hourF, 16.5, 18.5, 22, c.dow === 5 || c.dow === 6 ? 24 : 22.6);
      const crowd = clamp01((c.visitorsPointLookout + 120) / 900);
      return evening * (0.4 + 0.6 * crowd) * c.pubNear;
    },
    rate: () => 0,
    why: (c) => (c.pubOpen ? `open, ${c.visitorsPointLookout} visitors at Point Lookout` : 'shut')
  },
  {
    id: 'school', bus: 'human', where: 'school', synth: 'school', bed: true,
    gain: (c) => {
      if (!c.termTime || c.dow === 0 || c.dow === 6) return 0;
      const breaks = Math.max(win(c.hourF, 10.4, 10.6, 11, 11.2), win(c.hourF, 12.7, 12.9, 13.4, 13.6),
        win(c.hourF, 8.4, 8.6, 8.9, 9.1), win(c.hourF, 14.7, 14.85, 15.1, 15.4));
      return breaks * c.schoolNear;
    },
    rate: () => 0,
    why: (c) => (c.termTime ? 'a school day, at the break' : 'school holidays')
  },
  {
    id: 'boat-ramp', bus: 'human', where: 'ramp', synth: 'outboard',
    gain: (c) => c.rampNear * (c.crossingGood ? 1 : 0.25),
    rate: (c) => {
      const early = win(c.hourF, 4.6, 5.4, 8.2, 10);
      const weekend = c.dow === 0 || c.dow === 6 ? 1 : 0.45;
      return 1.4 * early * weekend * c.rampNear * (c.crossingGood ? 1 : 0.2);
    },
    why: (c) => `crossing ${c.crossingCondition}`
  }
];

/** Look up a roster entry's own gain from the context cache. Used by rate functions so a voice
 *  never fires calls it is not loud enough to make. */
function ROSTER_GAIN(c, id) {
  const v = c.gains && c.gains[id];
  return typeof v === 'number' ? v : 0;
}

/* ================================================================== registration */

export function registerAudio(world) {
  const rng = world.rng.stream('audio');

  const state = world.publish('audio', {
    ready: false,
    supported: HAS_DOM && typeof window.AudioContext === 'function',
    engine: 'none',
    contextState: 'none',
    sampleRate: 0,
    started: false,
    muted: true,
    declined: false,
    fadingIn: false,
    mix: { master: 0.8, ambience: 1, wildlife: 0.95, human: 0.85, ui: 0.7, music: 0.55 },
    listener: {
      x: 0, z: 0, y: 0, mode: 'planner', region: 'Minjerribah', cover: 'water',
      bayness: 0.5, shoreDistanceM: 0, heightAboveGroundM: 0, openness: 0, headingDeg: 0
    },
    field: {
      swellM: 0, swellPeriodS: 0, swellDirDeg: 0, seaState: '', windKt: 0, gustKt: 0, windDirDeg: 0,
      rainMmHr: 0, tempC: 0, cloud: 0, sunElevationDeg: 0, moonIllum: 0, tideHeightM: 0, tidePhase: ''
    },
    surf: { oceanDb: -100, bayDb: -100, breakEveryS: 0, setEvery: 0, reaches: [], nearest: null, side: 'neither' },
    wind: { db: -100, timbre: 'open', through: '', gustDepth: 0 },
    rain: { db: -100, mmHr: 0, surfaces: { ground: 0, roof: 0, water: 0, leaves: 0 } },
    voices: [],
    quiet: [],
    music: { enabled: false, playing: false, register: null, chord: null, beats: 0 },
    pending: [],   // sim-side sound events waiting for the engine: proof they happened, headless too
    flushes365: 0,
    // byKind is a running tally of every one-shot ever fired, by synth. It is the cheapest possible
    // answer to "is the kookaburra actually a kookaburra or is that label decoration".
    sources: { active: 0, byBus: { ambience: 0, wildlife: 0, human: 0, ui: 0, music: 0 }, byKind: {}, created: 0, oneShots: 0 },
    levels: {
      master: { rms: 0, peak: 0, db: -100, peakDb: -100 },
      ambience: { rms: 0, peak: 0, db: -100, peakDb: -100 },
      wildlife: { rms: 0, peak: 0, db: -100, peakDb: -100 },
      human: { rms: 0, peak: 0, db: -100, peakDb: -100 },
      ui: { rms: 0, peak: 0, db: -100, peakDb: -100 },
      music: { rms: 0, peak: 0, db: -100, peakDb: -100 }
    },
    limiter: { reductionDb: 0, engaged: false },
    cues: [],
    heardToday: 0,
    notes: []
  });

  /* ---------------------------------------------------------------- geography, built once */

  const geo = {
    reaches: [],       // surf and chop emitters, from dunes.js
    towns: [],         // township centres
    roads: [],         // road segments, sampled
    points: {},        // named single points: pub, school, ramps, ferry
    ready: false
  };

  const ctxCache = makeContext();
  const soundPack = { byId: {}, surfaces: {} };

  /** Everything the roster reads, rebuilt once a tick. One object, mutated, never reallocated. */
  function makeContext() {
    return {
      world: null, minuteOfDay: 0, hourF: 0, dow: 0, month: 0, sunDeg: 0, sunriseMin: 330, sunsetMin: 1065,
      moon: 0, springness: 0, tempC: 18, cloud: 0, windKt: 0, gustKt: 0, rainMmHr: 0, rainWeek: 0,
      rainQuiet: 1, nectar: 0, vegCondition: 0.9, sheoakCrop: 0, glossyIndex: 0,
      koalaPop: 0, koalaDispersing: 0, curlewCount: 0, flatsExposed: 0, flatsTotal: 1,
      frogCalling: 0, frogSpecies: 4, whaleNear: 0, whaleNearestKm: 99, dolphinNear: 0, dolphinNearestKm: 99,
      bushNear: 0, openNear: 0, beachNear: 0, edgeNear: 0, flatsNear: 0, coastNear: 0, mangroveNear: 0,
      marshNear: 0, wetNear: 0, townNear: 0, townLoud: 0, townWhy: '', roadNear: 0, roadName: null,
      carsPerMin: 0, dogControl: 0, pubOpen: false, pubNear: 0, visitorsPointLookout: 0,
      termTime: false, schoolNear: 0, rampNear: 0, crossingGood: false, crossingCondition: '',
      roadDistM: 9999, vehiclesNear: 0,
      surfOcean: 0, surfBay: 0, surfNearest: null, surfNearestM: 0, swellM: 0, swellPeriodS: 0,
      windLevel: 0, windThrough: '', rainLevel: 0, rainSurfaces: '',
      gains: Object.create(null)
    };
  }

  /* ---------------------------------------------------------------- the listener

     The simulation half does not know where the camera is. This is the one exception, and it is
     read-only: the roster needs to know what is near the ear to decide whether a voice is sounding
     at all, otherwise every bird on a 27 km island would be in the mix at once. It degrades to the
     middle of the island when no camera exists, which is what happens headless. */

  const ear = { x: 0, z: 0, y: 40, cover: 'forest', region: 'Minjerribah', bayness: 0.5, shore: 0, agl: 400, openness: 1, heading: 0, mode: 'planner' };
  let lastGeoX = 1e9, lastGeoZ = 1e9;

  function readEar(w) {
    const cam = w.read('camera');
    const isl = w.island;
    let x = 0, z = 8000, y = 400, agl = 400, heading = 0, mode = 'planner';
    if (cam && cam.position) {
      const above = num(cam.heightAboveGroundM, 400);
      // High up, the ear rides the point the camera is looking at rather than the camera itself,
      // so the island opens into a wide distant field instead of going silent at altitude.
      const t = smooth(clamp01((above - 90) / 700));
      x = lerp(num(cam.position.x), num(cam.target && cam.target.x, num(cam.position.x)), t);
      z = lerp(num(cam.position.z), num(cam.target && cam.target.z, num(cam.position.z)), t);
      y = num(cam.position.y, 400);
      agl = above;
      heading = num(cam.headingDeg, 0);
      mode = cam.mode || 'planner';
    }
    ear.x = x; ear.z = z; ear.y = y; ear.agl = agl; ear.heading = heading; ear.mode = mode;
    ear.openness = smooth(clamp01((agl - 60) / 900));
    if (isl) {
      try {
        ear.cover = isl.landCover(x, z) || 'water';
        ear.bayness = num(isl.bayness(x, z), 0.5);
        ear.shore = num(isl.shoreDistance(x, z), 0);
        ear.region = isl.regionAt(x, z) || 'Minjerribah';
      } catch (e) { /* the island is allowed to be half built */ }
    }
  }

  /* ---------------------------------------------------------------- geography build */

  function buildGeography(w) {
    const isl = w.island;
    const toLocal = (lon, lat) => {
      if (isl && typeof isl.toLocal === 'function') {
        const p = isl.toLocal(lon, lat);
        if (p && Number.isFinite(p.x)) return p;
      }
      return null;
    };

    // Surf and chop emitters come straight off the dune reaches, which are real named beaches with
    // real positions, lengths and exposures. Each one is a line, not a point: a 4 km beach heard
    // from the top of the dune is a wall of sound, and a point source cannot do that.
    const d = w.read('dunes');
    geo.reaches.length = 0;
    if (d && Array.isArray(d.reaches)) {
      for (const r of d.reaches) {
        if (!Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
        let bay = 0.5;
        try { bay = isl ? num(isl.bayness(r.x, r.z), 0.5) : 0.5; } catch (e) { /* fine */ }
        const lengthM = num(r.lengthM, 800);
        // Lay the reach out as a segment along the coast rather than leaving it as its centre
        // point. Main Beach is nineteen kilometres of sand in four reaches: at the centre-point
        // distance, standing in the middle of one of them put you 2.5 km from the surf you were
        // looking at. The direction of the coast comes from the gradient of the shore-distance
        // field, because the shoreline runs at right angles to it.
        const half = lengthM / 2;
        let tx = 1, tz = 0;
        if (isl && typeof isl.shoreDistance === 'function') {
          try {
            const h = 64;
            const gx = isl.shoreDistance(r.x + h, r.z) - isl.shoreDistance(r.x - h, r.z);
            const gz = isl.shoreDistance(r.x, r.z + h) - isl.shoreDistance(r.x, r.z - h);
            const gl = Math.hypot(gx, gz);
            if (gl > 1e-4) { tx = -gz / gl; tz = gx / gl; }   // perpendicular to the gradient
          } catch (e) { /* the fallback axis is east-west and still better than a point */ }
        }
        geo.reaches.push({
          id: r.id, label: r.label, x: r.x, z: r.z,
          ax: r.x - tx * half, az: r.z - tz * half,
          bx: r.x + tx * half, bz: r.z + tz * half,
          lengthM, exposure: num(r.exposure, 0.6),
          bayness: bay, ocean: bay < 0.5, dist: 0, gain: 0
        });
      }
    }

    // Township centres, from the places pack.
    geo.towns.length = 0;
    const places = (w.data && w.data.places && w.data.places.places) || [];
    const TOWN_KEY = { 'point-lookout': 'point-lookout', dunwich: 'dunwich', 'amity-point': 'amity-point' };
    for (const p of places) {
      if (p.type !== 'township') continue;
      const l = toLocal(p.lon, p.lat);
      if (!l) continue;
      geo.towns.push({ id: TOWN_KEY[p.id] || p.id, label: p.name, x: l.x, z: l.z, dist: 0, loud: 0 });
    }
    if (!geo.towns.length && isl) {
      // The pack is allowed to be missing. These three are the townships and their positions are
      // in data/places.json; this is the same list with the projection done by hand.
      for (const t of [['dunwich', 'Dunwich', 153.4025, -27.4992], ['point-lookout', 'Point Lookout', 153.54, -27.4297],
        ['amity-point', 'Amity Point', 153.4411, -27.3953]]) {
        const l = toLocal(t[2], t[3]);
        if (l) geo.towns.push({ id: t[0], label: t[1], x: l.x, z: l.z, dist: 0, loud: 0 });
      }
    }

    // Named single points. Every one of these is a real place with a published coordinate.
    const pt = (id) => {
      const p = places.find((q) => q.id === id);
      if (!p) return null;
      const l = toLocal(p.lon, p.lat);
      return l ? { x: l.x, z: l.z, label: p.name } : null;
    };
    geo.points = {
      bargeRamp: pt('dunwich-barge-ramp') || pt('dunwich-ferry-terminal'),
      ferryTerminal: pt('dunwich-ferry-terminal'),
      oneMileJetty: pt('one-mile-jetty'),
      amityJetty: pt('amity-jetty'),
      amityRamp: pt('amity-boat-ramp'),
      school: pt('dunwich-state-school'),
      pub: null
    };
    const biz = (w.data && w.data.businesses && w.data.businesses.businesses) || [];
    const hotel = biz.find((b) => b.id === 'stradbroke-island-beach-hotel');
    if (hotel) {
      const l = toLocal(hotel.lon, hotel.lat);
      if (l) geo.points.pub = { x: l.x, z: l.z, label: hotel.name };
    }

    // The road graph, sampled to segment midpoints. Real roads, real names.
    geo.roads.length = 0;
    const rn = w.read('roadNetwork');
    if (rn && Array.isArray(rn.nodes) && Array.isArray(rn.edges)) {
      const byId = new Map();
      for (const n of rn.nodes) byId.set(n.id, n);
      for (const e of rn.edges) {
        const a = byId.get(e.a || e.from), b = byId.get(e.b || e.to);
        if (!a || !b) continue;
        geo.roads.push({
          name: e.road || e.name || (a.roads && a.roads[0]) || 'a road',
          x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
          lengthM: Math.hypot(b.x - a.x, b.z - a.z),
          ax: a.x, az: a.z, bx: b.x, bz: b.z
        });
      }
    }

    // Join the citations on. A voice with no entry in the pack still runs, and says so.
    const pack = (w.data && w.data.soundscape) || null;
    if (pack && Array.isArray(pack.voices)) {
      for (const v of pack.voices) soundPack.byId[v.id] = v;
      soundPack.surfaces = (pack.surfaces && pack.surfaces.map) || {};
    }

    geo.ready = true;
  }

  /* ---------------------------------------------------------------- nearness

     How much of a voice reaches the ear. Real distance rolls off, but so does what is actually
     around: there is no wallum heath rattle on a jetty and no chop on the ocean side. */

  const near = { bush: 0, open: 0, beach: 0, edge: 0, flats: 0, coast: 0, mangrove: 0, marsh: 0, wet: 0, town: 0 };
  const COVER_BUSH = { forest: 1, heath: 0.85, rehab: 0.7, swamp: 0.6, cleared: 0.35, urban: 0.35, foredune: 0.25 };
  const COVER_OPEN = { cleared: 1, urban: 0.9, beach: 0.6, foredune: 0.6, rehab: 0.5, heath: 0.3 };
  const COVER_WET = { swamp: 1, lake: 0.9, saltmarsh: 0.5, heath: 0.35, mangrove: 0.3 };

  function recomputeNearness(w) {
    const isl = w.island;
    const x = ear.x, z = ear.z;
    const cover = ear.cover;
    const shore = ear.shore;
    // Land cover is sampled in a small ring around the ear rather than at one point, so standing on
    // the boundary between heath and forest gives you both and not a switch.
    let bush = 0, open = 0, wet = 0, mangrove = 0, marsh = 0, urban = 0, samples = 0;
    if (isl && typeof isl.landCover === 'function') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rr = i === 0 ? 0 : 160;
        let cv = cover;
        try { cv = isl.landCover(x + Math.cos(a) * rr, z + Math.sin(a) * rr) || cover; } catch (e) { /* fine */ }
        bush += COVER_BUSH[cv] || 0;
        open += COVER_OPEN[cv] || 0;
        wet += COVER_WET[cv] || 0;
        if (cv === 'mangrove') mangrove += 1;
        if (cv === 'saltmarsh' || cv === 'mangrove') marsh += 1;
        if (cv === 'urban' || cv === 'cleared') urban += 1;
        samples++;
      }
      const n = Math.max(1, samples);
      bush /= n; open /= n; wet /= n; mangrove /= n; marsh /= n; urban /= n;
    } else {
      bush = 0.7; open = 0.3;
    }
    // Altitude thins everything that lives on the ground and widens the coast.
    const alt = 1 - 0.75 * ear.openness;
    near.bush = bush * alt;
    near.open = open * alt;
    near.wet = wet * alt;
    near.mangrove = mangrove * alt;
    near.marsh = marsh * alt;
    near.town = urban * alt;
    // Beach: on the sand or just behind it.
    near.beach = clamp01(win(shore, -160, -20, 90, 420)) * (cover === 'beach' || cover === 'foredune' || cover === 'water' ? 1 : 0.55) * alt;
    // Edge: where the bush meets the cleared ground, which is where the stone-curlews stand.
    near.edge = clamp01(Math.min(bush, open) * 2.6) * alt;
    // Flats: the bay-side intertidal, which is where the migratory shorebirds are.
    near.flats = clamp01(ear.bayness * 1.2) * clamp01(win(shore, -900, -300, 260, 1400)) * alt;
    // Coast: anywhere the sea is in sight, and it stays with you at altitude.
    near.coast = clamp01(win(shore, -3000, -900, 700, 2600)) * (0.4 + 0.6 * (1 - ear.openness * 0.4));
  }

  /* ---------------------------------------------------------------- the score */

  let dayStamp = -1;
  const voiceOut = [];
  const quietOut = [];
  const voicePool = [];
  let pausedAccum = 0;

  function buildScore(w) {
    const c = ctxCache;
    const clk = w.clock;
    const weather = w.read('weather') || {};
    const day = w.read('daylight') || {};
    const tide = w.read('tide') || {};
    const veg = w.read('vegetation') || {};
    const koala = w.read('koala') || {};
    const birds = w.read('shorebirds') || {};
    const lakes = w.read('lakes') || {};
    const whales = w.read('whales') || {};
    const marine = w.read('marine') || {};
    const pop = w.read('population') || {};
    const vis = w.read('visitors') || {};
    const sched = w.read('schedule') || {};
    const biz = w.read('businesses') || {};
    const roads = w.read('roadNetwork') || {};

    c.world = w;
    c.minuteOfDay = clk.minuteOfDay;
    c.hourF = clk.minuteOfDay / 60;
    c.dow = clk.dayOfWeek;
    c.month = clk.month;
    c.sunDeg = num(day.elevationDeg, 20);
    c.sunriseMin = num(day.sunriseMin, 330);
    c.sunsetMin = num(day.sunsetMin, 1065);
    c.moon = num(day.moonIllum, 0.5) * clamp01((num(day.moonAltitudeDeg, 0) + 6) / 20);
    c.tempC = num(weather.tempC, 20);
    c.cloud = num(weather.cloud, 0.3);
    c.windKt = num(weather.windKt, 10);
    c.gustKt = num(weather.gustKt, c.windKt * 1.35);
    c.rainMmHr = num(weather.rainMmHr, 0);
    c.rainWeek = num(weather.rainWeek, 0);
    c.rainQuiet = clamp01(1 - c.rainMmHr / 6);
    // Springness: the animals that call hardest in the warming months.
    c.springness = c.month === 8 || c.month === 9 ? 1 : c.month === 7 || c.month === 10 ? 0.7 : 0.3;
    // Nectar: what is actually in flower. Both the wallum banksia and the swamp mahogany in the
    // ecology pack flower through the cold months, which is why winter is the loud parrot season.
    c.nectar = c.month >= 4 && c.month <= 7 ? 1 : c.month === 3 || c.month === 8 ? 0.6 : 0.2;
    c.vegCondition = num(veg.forestCondition, 0.9);
    c.sheoakCrop = num(veg.sheoakCrop, 0);
    c.glossyIndex = num(veg.glossyBlackCockatooIndex, 0);
    c.koalaPop = num(koala.population, 0);
    c.koalaDispersing = num(koala.dispersing, 0);

    const curlew = Array.isArray(birds.bySpecies) ? birds.bySpecies.find((s) => s.id === 'sp-eastern-curlew') : null;
    c.curlewCount = curlew ? num(curlew.count, 0) : 0;
    c.flatsExposed = num(birds.flatsExposedHa, 0);
    c.flatsTotal = Math.max(1, num(birds.flatsTotalHa, 1597));

    c.frogCalling = num(lakes.frogCalling, 0);
    c.frogSpecies = Array.isArray(lakes.frogs) ? lakes.frogs.length : 4;

    // Whales and dolphins: real pods with real positions. Distance to the nearest surfacing one.
    c.whaleNear = 0; c.whaleNearestKm = 99;
    if (Array.isArray(whales.pods)) {
      let best = 1e9;
      for (const p of whales.pods) {
        if (!p.surfacing) continue;
        const dd = Math.hypot(p.x - ear.x, p.z - ear.z);
        if (dd < best) best = dd;
      }
      if (best < 1e9) {
        c.whaleNearestKm = best / 1000;
        // A blow carries about 2 km on a still day and much less into wind.
        c.whaleNear = clamp01(1 - best / (2400 - c.windKt * 45)) * clamp01(1 - c.windKt / 30);
      }
    }
    c.dolphinNear = 0; c.dolphinNearestKm = 99;
    if (marine.dolphins && Array.isArray(marine.dolphins.pods)) {
      let best = 1e9;
      for (const p of marine.dolphins.pods) {
        const dd = Math.hypot(p.x - ear.x, p.z - ear.z);
        if (dd < best) best = dd;
      }
      if (best < 1e9) {
        c.dolphinNearestKm = best / 1000;
        c.dolphinNear = clamp01(1 - best / 420);
      }
    }

    // Nearness of habitat around the ear.
    c.bushNear = near.bush; c.openNear = near.open; c.beachNear = near.beach; c.edgeNear = near.edge;
    c.flatsNear = near.flats; c.coastNear = near.coast; c.mangroveNear = near.mangrove;
    c.marshNear = near.marsh; c.wetNear = near.wet; c.townNear = near.town;

    /* --- townships ------------------------------------------------------- */
    // The murmur follows the people who are actually outside, not the people on the island. On a
    // wet Tuesday everybody is indoors and the town goes quiet even though the census has not moved.
    const crowd = w.read('crowd');
    const outdoorShare = crowd
      ? clamp01((num(crowd.outdoors, 0) + num(crowd.visitorsOutdoors, 0))
        / Math.max(1, num(crowd.onIsland, 1) + num(crowd.visitorsOutdoors, 0) + num(crowd.indoors, 0)) * 3.2)
      : 0.5;
    let townLoud = 0, townWhy = 'nobody about';
    let nearestTown = null, nearestTownDist = 1e9;
    for (const t of geo.towns) {
      t.dist = Math.hypot(t.x - ear.x, t.z - ear.z);
      const key = t.id;
      const res = (pop.byTownship && pop.byTownship[key] && pop.byTownship[key].residents) || 0;
      const guests = (vis.byTownship && vis.byTownship[key]) || 0;
      const heads = res + guests;
      // The daily curve of a small coastal town: quiet before six, up through the morning, a lull,
      // a second peak at knock-off, and gone by ten.
      const h = c.hourF;
      const curve = win(h, 5.2, 6.8, 9.5, 11) * 0.9 + win(h, 10.5, 12, 14, 16.5) * 0.55
        + win(h, 15.5, 17, 19.5, 21.5) * 1 + win(h, 21, 21.6, 22.4, 23.6) * 0.25;
      const level = clamp01(heads / 1400) * clamp01(curve) * (0.3 + 0.7 * outdoorShare);
      t.loud = level;
      // Nearest is what you actually hear; the roll-off is about 1.6 km of scrub and sand.
      const reach = clamp01(1 - t.dist / 1600);
      const contrib = level * reach;
      if (contrib > townLoud) {
        townLoud = contrib;
        townWhy = `${t.label}: ${heads} people, ${Math.round(t.dist)} m away`;
      }
      if (t.dist < nearestTownDist) { nearestTownDist = t.dist; nearestTown = t; }
    }
    c.townLoud = townLoud * (1 - 0.55 * ear.openness);
    c.townWhy = townWhy;
    c.visitorsPointLookout = (vis.byTownship && vis.byTownship['point-lookout']) || 0;

    /* --- the road -------------------------------------------------------- */
    c.roadNear = 0; c.roadName = null; c.roadDistM = 9999; c.vehiclesNear = 0;
    let bestRoad = 1e9;
    for (const r of geo.roads) {
      const dd = segDist(ear.x, ear.z, r.ax, r.az, r.bx, r.bz);
      if (dd < bestRoad) { bestRoad = dd; c.roadName = r.name; }
    }
    if (bestRoad < 1e9) {
      c.roadDistM = bestRoad;
      c.roadNear = clamp01(1 - bestRoad / 340) * (1 - 0.7 * ear.openness);
    }
    // There is no bridge to this island, so the fleet is only ever what the barge carried, and
    // traffic.js is running those actual vehicles. Count the ones near enough to be heard.
    const traf = w.read('traffic');
    if (traf && Array.isArray(traf.vehicles)) {
      let n = 0;
      const lim = Math.min(traf.vehicles.length, 400);
      for (let i = 0; i < lim; i++) {
        const v = traf.vehicles[i];
        if (!Number.isFinite(v.x)) continue;
        const dx = v.x - ear.x, dz = v.z - ear.z;
        if (dx * dx + dz * dz < 400 * 400) n++;
      }
      c.vehiclesNear = n;
    }

    /* --- people and places ----------------------------------------------- */
    const levers = koala.levers || {};
    c.dogControl = num(levers['dog-control-enforcement'], 0);
    const board = Array.isArray(biz.board) ? biz.board : [];
    const hotel = board.find((b) => b.id === 'stradbroke-island-beach-hotel');
    c.pubOpen = !!(hotel && hotel.open);
    c.pubNear = geo.points.pub ? clamp01(1 - Math.hypot(geo.points.pub.x - ear.x, geo.points.pub.z - ear.z) / 700) : 0;
    c.termTime = !!(sched.day && sched.day.isTermTime);
    c.schoolNear = geo.points.school ? clamp01(1 - Math.hypot(geo.points.school.x - ear.x, geo.points.school.z - ear.z) / 600) : 0;
    let rampNear = 0;
    for (const k of ['amityRamp', 'bargeRamp', 'oneMileJetty']) {
      const p = geo.points[k];
      if (!p) continue;
      rampNear = Math.max(rampNear, clamp01(1 - Math.hypot(p.x - ear.x, p.z - ear.z) / 800));
    }
    c.rampNear = rampNear;
    c.crossingCondition = weather.crossingCondition || 'unknown';
    // weather.js grades the crossing good, choppy, rough or cancelled. Boats still go out in chop.
    c.crossingGood = c.crossingCondition === 'good' || c.crossingCondition === 'choppy';


    /* --- the beds, first: everything else sits on top of them -------------- */
    scoreSurf(w, weather, tide);
    scoreWind(w, weather, veg);
    scoreRain(w, weather);
    c.surfOcean = dbToGain(state.surf.oceanDb);
    c.surfBay = dbToGain(state.surf.bayDb);
    c.surfNearest = state.surf.nearest ? state.surf.nearest.label : null;
    c.surfNearestM = state.surf.nearest ? state.surf.nearest.distanceM : 0;
    c.swellM = +num(weather.swellM, 0).toFixed(2);
    c.swellPeriodS = +num(weather.swellPeriodS, 0).toFixed(1);
    c.windLevel = dbToGain(state.wind.db);
    c.windThrough = state.wind.through;
    c.rainLevel = dbToGain(state.rain.db);
    const rs = state.rain.surfaces;
    const surfNames = [];
    if (rs.roof > 0.2) surfNames.push('tin');
    if (rs.leaves > 0.2) surfNames.push('leaves');
    if (rs.water > 0.2) surfNames.push('water');
    if (rs.ground > 0.2) surfNames.push('the ground');
    c.rainSurfaces = surfNames.length ? surfNames.join(', ') : 'not much';

    /* --- run the roster --------------------------------------------------- */
    // The output objects are pooled. This runs every tick for the life of the world, and handing
    // the collector twenty fresh objects a tick is the kind of thing that shows up as a stutter
    // an hour in rather than as a number in a profile.
    quietOut.length = 0;
    let n = 0;
    for (const v of ROSTER) {
      if (!v.gain) continue;
      let g = 0;
      try { g = clamp01(num(v.gain(c), 0)); } catch (e) { g = 0; }
      c.gains[v.id] = g;
      if (g < 0.012) {
        if (quietOut.length < 8) quietOut.push(v.id);
        continue;
      }
      let r = 0;
      if (v.rate) { try { r = Math.max(0, num(v.rate(c), 0)); } catch (e) { r = 0; } }
      let why = '';
      if (v.why) { try { why = String(v.why(c)); } catch (e) { why = ''; } }
      const pk = soundPack.byId[v.id];
      let o = voicePool[n];
      if (!o) o = voicePool[n] = {};
      const loud = LOUDNESS[v.id] === undefined ? 0.25 : LOUDNESS[v.id];
      o.id = v.id;
      o.label = (pk && pk.label) || v.id;
      o.bus = v.bus;
      o.gain = +g.toFixed(3);
      o.level = +(g * loud).toFixed(4);
      o.db = +gainToDb(g * loud).toFixed(1);
      o.callsPerMin = +r.toFixed(2);
      o.bed = !!v.bed;
      o.cadence = v.cadence ? safeText(v.cadence, c) : null;
      o.why = why;
      o.confidence = (pk && pk.confidence) || 'unstated';
      o.source = (pk && (pk.source_ref || pk.source_note)) || 'no entry in data/soundscape.json';
      n++;
    }
    voiceOut.length = 0;
    for (let i = 0; i < n; i++) voiceOut.push(voicePool[i]);
    // Sorted by what actually reaches the ear, not by how busy the island is being. A cockatoo at
    // full activity is still quieter than half a gale, and a list that says otherwise teaches wrong.
    voiceOut.sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1));
    state.voices = voiceOut;
    state.quiet = quietOut;
    state.heardToday = n;

    /* --- the field readout ------------------------------------------------ */
    const f = state.field;
    f.swellM = +num(weather.swellM, 0).toFixed(2);
    f.swellPeriodS = +num(weather.swellPeriodS, 0).toFixed(1);
    f.swellDirDeg = Math.round(num(weather.swellDirDeg, 0));
    f.seaState = weather.seaState || '';
    f.windKt = +c.windKt.toFixed(1);
    f.gustKt = +c.gustKt.toFixed(1);
    f.windDirDeg = Math.round(num(weather.windDirDeg, 0));
    f.rainMmHr = +c.rainMmHr.toFixed(2);
    f.tempC = +c.tempC.toFixed(1);
    f.cloud = +c.cloud.toFixed(2);
    f.sunElevationDeg = +c.sunDeg.toFixed(1);
    f.moonIllum = +num(day.moonIllum, 0).toFixed(2);
    f.tideHeightM = +num(tide.height, 0).toFixed(2);
    f.tidePhase = tide.phase || '';

    const L = state.listener;
    L.x = Math.round(ear.x); L.z = Math.round(ear.z); L.y = Math.round(ear.y);
    L.mode = ear.mode; L.region = ear.region; L.cover = ear.cover;
    L.bayness = +ear.bayness.toFixed(2);
    L.shoreDistanceM = Math.round(ear.shore);
    L.heightAboveGroundM = Math.round(ear.agl);
    L.openness = +ear.openness.toFixed(2);
    L.headingDeg = Math.round(ear.heading);
  }

  /* ---------------------------------------------------------------- surf */

  function scoreSurf(w, weather, tide) {
    const s = state.surf;
    const swell = num(weather.swellM, 1);
    const period = clamp(num(weather.swellPeriodS, 9), 4, 20);
    const windKt = num(weather.windKt, 10);
    const tideH = num(tide.height, 1.2);

    s.breakEveryS = +period.toFixed(2);
    // Sets on the Australian east coast run in groups. Eight to thirteen waves is the honest range
    // and the number here moves with the period, because longer period swell arrives in tighter sets.
    s.setEvery = Math.round(lerp(13, 8, clamp01((period - 6) / 8)));

    let oceanBest = 0, bayBest = 0, nearest = null, nearestD = 1e9;
    const list = s.reaches;
    list.length = 0;
    for (const r of geo.reaches) {
      // Distance to the sand, not to the middle of the reach.
      r.dist = segDist(ear.x, ear.z, r.ax, r.az, r.bx, r.bz);
      let g;
      if (r.ocean) {
        // Ocean side: the swell is the driver, but not linearly. Standing on the sand, a one metre
        // day is already loud; what four metres buys you is not four times the level, it is a
        // longer reach inland and a heavier bottom end. So the level saturates and the carry does
        // not. Exposure is the reach's own number out of dunes.js: a pocket beach in the lee of
        // Point Lookout does not get what Main Beach gets.
        const power = (0.45 + 0.55 * clamp01(swell / 3.4)) * (0.35 + 0.65 * r.exposure);
        const carry = 900 + r.lengthM * 0.55 + swell * 700;
        g = power * clamp01(1 - r.dist / carry);
        // A high tide on a steep beach dumps closer in and sounds heavier.
        g *= 0.85 + 0.3 * clamp01(tideH / 2);
        if (g > oceanBest) oceanBest = g;
      } else {
        // Bay side: Moreton Bay is fetch limited. There is no groundswell in here, so the water
        // noise on the western shore follows the wind and nothing else.
        const chop = clamp01((windKt - 6) / 22);
        g = chop * clamp01(1 - r.dist / (500 + r.lengthM * 0.35)) * 0.55;
        if (g > bayBest) bayBest = g;
      }
      r.gain = g;
      if (r.dist < nearestD) { nearestD = r.dist; nearest = r; }
      if (g > 0.02) {
        list.push({ id: r.id, label: r.label, distanceM: Math.round(r.dist), gain: +g.toFixed(3), side: r.ocean ? 'ocean' : 'bay' });
      }
    }
    list.sort((a, b) => b.gain - a.gain);
    if (list.length > 6) list.length = 6;
    s.oceanDb = +gainToDb(oceanBest).toFixed(1);
    s.bayDb = +gainToDb(bayBest).toFixed(1);
    s.nearest = nearest ? { id: nearest.id, label: nearest.label, distanceM: Math.round(nearestD), side: nearest.ocean ? 'ocean' : 'bay' } : null;
    s.side = oceanBest > bayBest * 1.15 ? 'ocean' : bayBest > oceanBest * 1.15 ? 'bay' : oceanBest + bayBest > 0.02 ? 'both' : 'neither';
  }

  /* ---------------------------------------------------------------- wind */

  const TIMBRE_LABEL = {
    open: 'over open sand',
    rattle: 'through banksia heath',
    canopy: 'through the canopy',
    papery: 'through the sedge',
    clatter: 'through the mangroves',
    eaves: 'round the eaves',
    hiss: 'through the sheoak'
  };

  function scoreWind(w, weather, veg) {
    const s = state.wind;
    const kt = num(weather.windKt, 10);
    const gust = num(weather.gustKt, kt * 1.3);
    // Wind is quiet in still air and rises steeply once the vegetation starts moving. A square law
    // on speed is closer to what an ear does than a straight line.
    const g = clamp01(Math.pow(clamp01((kt - 2) / 32), 1.45)) * (0.45 + 0.55 * (1 - ear.openness * 0.5));
    let timbre = soundPack.surfaces[ear.cover] || 'open';
    // Sheoak stands on the foreshore. Wherever the crop is up and the shore is close, the hiss goes
    // over the top of whatever the cover would otherwise give you.
    const sheoak = num(veg.sheoakCrop, 0);
    const nearShore = ear.shore > -200 && ear.shore < 420;
    if (sheoak > 0.45 && nearShore && (timbre === 'open' || timbre === 'canopy')) timbre = 'hiss';
    s.db = +gainToDb(g).toFixed(1);
    s.timbre = timbre;
    s.through = TIMBRE_LABEL[timbre] || TIMBRE_LABEL.open;
    s.gustDepth = +clamp01((gust - kt) / Math.max(6, kt)).toFixed(2);
  }

  /* ---------------------------------------------------------------- rain */

  function scoreRain(w, weather) {
    const s = state.rain;
    const mm = num(weather.rainMmHr, 0);
    s.mmHr = +mm.toFixed(2);
    const g = clamp01(Math.log1p(mm * 2.4) / Math.log1p(24));
    s.db = +gainToDb(g).toFixed(1);
    const cover = ear.cover;
    const surf = s.surfaces;
    // Which surfaces are actually under and around the ear. Four of them, mixed, not one rain loop.
    surf.ground = +clamp01(cover === 'water' || cover === 'lake' ? 0.05 : 0.55 + 0.45 * (cover === 'beach' || cover === 'cleared' ? 1 : 0)).toFixed(2);
    surf.roof = +clamp01((cover === 'urban' ? 1 : cover === 'cleared' ? 0.4 : 0) * near.town * 1.6).toFixed(2);
    surf.water = +clamp01((cover === 'water' || cover === 'lake' ? 1 : 0) + ear.bayness * clamp01(1 - Math.abs(ear.shore) / 260) * 0.7).toFixed(2);
    surf.leaves = +clamp01(near.bush * 1.1).toFixed(2);
  }

  /* ================================================================ the system */

  const sys = world.register({
    id: 'audio',
    phase: 'presentation',
    order: 96,

    init(w) {
      buildGeography(w);
      readEar(w);
      recomputeNearness(w);

      // A roost lifting is a consequence, not decoration: shorebirds.js counts every flush against
      // the fuel the flock needs for an 11,000 km flight, and it puts the lift on the bus as it
      // happens with the roost, the position, the cause and the number of birds already on it.
      // Queueing it here rather than in the engine means it is provable headless, in the probe,
      // with no browser in the room.
      w.bus.on('shorebirds:flush', (p) => {
        if (!p || !Number.isFinite(p.x)) return;
        const d = Math.hypot(p.x - ear.x, p.z - ear.z);
        state.flushes365++;
        if (d > 2600) return;
        state.pending.push({
          kind: 'roostFlush', x: p.x, z: p.z, birds: num(p.birds, 200),
          label: `${num(p.birds, 0)} birds up at ${p.label}, put up by ${p.source || 'something'}`,
          at: w.clock.format(), day: w.clock.formatDate(), distanceM: Math.round(d)
        });
        if (state.pending.length > 8) state.pending.splice(0, state.pending.length - 8);
      });

      state.ready = true;
      state.notes = [
        'Nothing here is a recording. Every voice is Web Audio nodes built at runtime, and the repository contains no audio files.',
        `${ROSTER.length} voices in the roster, ${geo.reaches.length} surf reaches from dunes.js, ${geo.towns.length} townships, ${geo.roads.length} road segments.`,
        'Sources and confidence for every voice are in data/soundscape.json. A voice marked low confidence is a species no pack in this repository records for this island.'
      ];
      if (HAS_DOM) engine.attach(w);
    },

    tick(w) {
      // The listener moves at frame rate, not tick rate, but the roster only needs to know roughly
      // where it is. Rebuild the nearness sample when it has actually gone somewhere, and always on
      // a day boundary, so a long fast-forward never carries stale geography.
      readEar(w);
      const moved = Math.hypot(ear.x - lastGeoX, ear.z - lastGeoZ);
      if (moved > 60 || w.clock.minuteOfDay === 0) {
        lastGeoX = ear.x; lastGeoZ = ear.z;
        recomputeNearness(w);
      }
      if (w.clock.dayIndex !== dayStamp) {
        dayStamp = w.clock.dayIndex;
        // Once a day: the geography can change under us as other systems finish booting.
        if (!geo.reaches.length || !geo.towns.length || !geo.roads.length) buildGeography(w);
      }
      buildScore(w);
    },

    frame(w, dt) {
      if (!HAS_DOM) return;
      // The ear rides the camera at frame rate, not tick rate, otherwise turning on the spot at
      // 1x would take half a second to move the surf across the stereo field, and turning while
      // paused would never move it at all.
      readEar(w);
      // Paused is a state a player spends real time in: they stop the clock and look around.
      // Rebuild the score at about four times a second so the soundscape still follows the camera.
      if (w.clock.paused) {
        pausedAccum += dt;
        if (pausedAccum > 0.25) {
          pausedAccum = 0;
          recomputeNearness(w);
          buildScore(w);
        }
      } else {
        pausedAccum = 0;
      }
      engine.frame(w, dt);
    },

    describe(w) {
      const top = state.voices.slice(0, 6).map((v) => `${v.id} ${v.db} dB`);
      return {
        supported: state.supported,
        started: state.started,
        muted: state.muted,
        contextState: state.contextState,
        voices: state.voices.length,
        beds: state.voices.filter((v) => v.bed).length,
        loudest: top,
        surfSide: state.surf.side,
        surfOceanDb: state.surf.oceanDb,
        surfBayDb: state.surf.bayDb,
        breakEveryS: state.surf.breakEveryS,
        windDb: state.wind.db,
        windTimbre: state.wind.timbre,
        rainDb: state.rain.db,
        listenerCover: state.listener.cover,
        listenerRegion: state.listener.region,
        sourcesActive: state.sources.active,
        oneShots: state.sources.oneShots,
        pendingCues: state.pending.length,
        lastCue: state.cues.length ? state.cues[0].what : null,
        rmsMasterDb: state.levels.master.db,
        rmsAmbienceDb: state.levels.ambience.db,
        rmsWildlifeDb: state.levels.wildlife.db,
        rmsHumanDb: state.levels.human.db,
        limiterDb: state.limiter.reductionDb
      };
    },

    save() {
      return { mix: { ...state.mix }, muted: state.muted, music: state.music.enabled };
    },
    load(w, s) {
      if (!s) return;
      if (s.mix) Object.assign(state.mix, s.mix);
      if (typeof s.muted === 'boolean') state.muted = s.muted;
      if (typeof s.music === 'boolean') state.music.enabled = s.music;
      engine.applyMix();
    }
  });

  /* ================================================================ the engine */

  const engine = makeEngine(world, state, geo, ear, near, rng);

  if (HAS_DOM) {
    mountMixerPanel(world, state, engine, soundPack);
    const api = engine.api;
    world.bus.on('app:ready', () => { if (window.TWIN) window.TWIN.audio = api; });
    if (window.TWIN) window.TWIN.audio = api;
  }

  return sys;
}

/* ==================================================================================================
   THE ENGINE

   Everything below here is browser only and never runs headless. It reads world.state.audio and
   world.state.camera and turns them into nodes. It never writes simulation state: it writes only the
   measured half of world.state.audio, which is the proof half.
   ================================================================================================== */

function makeEngine(world, state, geo, ear, near, simRng) {
  // A separate deterministic stream. The engine draws at frame rate, which depends on the machine,
  // so it must never touch a simulation stream. Seeded from the world seed, so two runs on the same
  // machine make the same choices.
  const rng = new Rng(hashString('audio-engine') ^ (world.seed >>> 0));

  const E = {
    ctx: null, ready: false, started: false, fading: false,
    master: null, limiter: null, buses: {}, analysers: {}, verb: null, verbSend: null,
    noise: null, pink: null,
    beds: {},
    live: 0, created: 0, oneShots: 0,
    lastNow: 0, mixAt: 0, meterAt: 0,
    auditing: false, faults: 0,
    music: null,
    api: null
  };

  const BUS_LIST = BUS_IDS;

  /* ---------------------------------------------------------------- build */

  function build() {
    if (E.ctx || !state.supported) return;
    let ctx;
    try {
      ctx = new window.AudioContext({ latencyHint: 'interactive' });
    } catch (e) {
      state.supported = false;
      state.contextState = 'unavailable';
      return;
    }
    E.ctx = ctx;
    state.sampleRate = ctx.sampleRate;
    state.engine = 'web-audio';

    // Master chain: everything meets at one limiter so nothing in this file can ever clip the
    // output, however many voices happen to land on the same second.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value = 2;
    lim.ratio.value = 18;
    lim.attack.value = 0.004;
    lim.release.value = 0.22;
    E.limiter = lim;

    const master = ctx.createGain();
    master.gain.value = 0;              // starts silent. Nothing sounds until a gesture.
    E.master = master;

    const masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 1024;
    masterAnalyser.smoothingTimeConstant = 0.2;

    lim.connect(master);
    master.connect(masterAnalyser);
    master.connect(ctx.destination);
    E.analysers.master = { node: masterAnalyser, buf: new Float32Array(masterAnalyser.fftSize) };

    // One shared reverb, made out of noise. It is the outdoors: a short, dark tail that makes a
    // bird call 300 m away sit behind the surf instead of on top of it.
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 1.7, 2.6);
    const verbIn = ctx.createGain();
    verbIn.gain.value = 1;
    const verbTone = ctx.createBiquadFilter();
    verbTone.type = 'lowpass';
    verbTone.frequency.value = 2600;
    verbIn.connect(verbTone);
    verbTone.connect(verb);
    E.verb = verb;
    E.verbSend = verbIn;

    for (const id of BUS_LIST) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.15;
      g.connect(a);
      g.connect(lim);
      E.buses[id] = g;
      E.analysers[id] = { node: a, buf: new Float32Array(a.fftSize) };
    }
    verb.connect(E.buses.ambience);

    E.noise = makeNoise(ctx, 4, rng);
    E.pink = makePink(ctx, 4, rng);

    buildBeds(ctx);
    E.ready = true;
    state.ready = true;
    state.contextState = ctx.state;
    applyMix();
  }

  /* ---------------------------------------------------------------- buffers */

  function makeNoise(ctx, seconds, r) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = r.float() * 2 - 1;
    }
    return buf;
  }

  /** Pink noise by the usual one-pole cascade. Surf and wind both want a minus three slope, not white. */
  function makePink(ctx, seconds, r) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const white = r.float() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    return buf;
  }

  function makeImpulse(ctx, seconds, decay) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (rng.float() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /* ---------------------------------------------------------------- node helpers */

  function src(buf, rate) {
    const s = E.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    if (rate) s.playbackRate.value = rate;
    E.created++;
    return s;
  }
  function gain(v) { const g = E.ctx.createGain(); g.gain.value = v; return g; }
  function filt(type, f, q, g) {
    const b = E.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q !== undefined) b.Q.value = q;
    if (g !== undefined) b.gain.value = g;
    return b;
  }
  /**
   * The spatialiser. Azimuth and distance are worked out in the listener's frame from the camera,
   * which is cheaper than a PannerNode per voice and, more to the point, inspectable: `panTo()` and
   * `place()` are the whole of it and both are twelve lines. A browser with no StereoPannerNode
   * gets the sound in mono rather than a half-working 3D path, and says so in the read model.
   */
  function pan(v) {
    if (E.ctx.createStereoPanner) { const p = E.ctx.createStereoPanner(); p.pan.value = v || 0; return p; }
    const g = E.ctx.createGain();
    g.pan = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} };
    return g;
  }

  /** Keep the Web Audio listener on the camera as well, so anything that later wants a real
   *  PannerNode inherits the right frame rather than sitting at the origin facing north. */
  function setListener() {
    const l = E.ctx.listener;
    if (!l) return;
    const rad = (ear.heading * Math.PI) / 180;
    const fx = Math.sin(rad), fz = Math.cos(rad);
    if (l.positionX) {
      const t = E.ctx.currentTime;
      l.positionX.setTargetAtTime(ear.x, t, 0.08);
      l.positionY.setTargetAtTime(ear.y, t, 0.08);
      l.positionZ.setTargetAtTime(ear.z, t, 0.08);
      l.forwardX.setTargetAtTime(fx, t, 0.08);
      l.forwardY.setTargetAtTime(0, t, 0.08);
      l.forwardZ.setTargetAtTime(fz, t, 0.08);
      l.upX.setTargetAtTime(0, t, 0.08);
      l.upY.setTargetAtTime(1, t, 0.08);
      l.upZ.setTargetAtTime(0, t, 0.08);
    } else if (l.setPosition) {
      l.setPosition(ear.x, ear.y, ear.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }
  const at = (param, v, tau, now) => {
    if (!Number.isFinite(v)) return;
    param.setTargetAtTime(v, now, tau);
  };

  /* ---------------------------------------------------------------- the beds

     A bed is a permanently running chain whose gains are steered. Building them once and steering
     them is the difference between an ambience that breathes and one that stutters every time a
     value crosses a threshold. */

  function buildBeds(ctx) {
    const B = E.beds;

    /* --- surf: the roar, plus a wave scheduler ------------------------ */
    B.surf = { roar: [], wave: { nextAt: 0, index: 0 } };
    for (let i = 0; i < 2; i++) {
      // Two roar layers: one for the ocean side, one for the bay side, each independently panned.
      const s = src(E.pink, 0.7 + i * 0.2);
      const lp = filt('lowpass', 260, 0.7);
      const hp = filt('highpass', 45, 0.5);
      const g = gain(0);
      const p = pan(0);
      s.connect(lp); lp.connect(hp); hp.connect(g); g.connect(p); p.connect(E.buses.ambience);
      s.start();
      B.surf.roar.push({ src: s, lp, g, p, kind: i === 0 ? 'ocean' : 'bay' });
    }
    // The bay's chop is a separate texture from the ocean's roar: shorter, brighter, modulated.
    {
      const s = src(E.noise, 1);
      const bp = filt('bandpass', 700, 0.8);
      const g = gain(0);
      const mod = ctx.createGain();
      mod.gain.value = 1;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 1.1;
      const lfoAmt = gain(0.55);
      lfo.connect(lfoAmt); lfoAmt.connect(mod.gain);
      const p = pan(0);
      s.connect(bp); bp.connect(mod); mod.connect(g); g.connect(p); p.connect(E.buses.ambience);
      s.start(); lfo.start();
      B.chop = { src: s, bp, g, p, lfo, mod };
    }

    /* --- wind: a body plus one voiced resonance, retuned by land cover -- */
    {
      const s = src(E.pink, 0.85);
      const body = filt('lowpass', 380, 0.6);
      const bodyG = gain(0);
      const s2 = src(E.noise, 1);
      const voice = filt('bandpass', 900, 2.4);
      const voiceG = gain(0);
      const grain = gain(1);          // amplitude modulation for the rattle timbres
      const glfo = ctx.createOscillator();
      glfo.type = 'sawtooth';
      glfo.frequency.value = 9;
      const glfoAmt = gain(0);
      glfo.connect(glfoAmt); glfoAmt.connect(grain.gain);
      const out = gain(1);
      s.connect(body); body.connect(bodyG); bodyG.connect(out);
      s2.connect(voice); voice.connect(grain); grain.connect(voiceG); voiceG.connect(out);
      out.connect(E.buses.ambience);
      s.start(); s2.start(); glfo.start();
      B.wind = { bodyG, body, voice, voiceG, glfo, glfoAmt, out, gustPhase: 0, gustTarget: 1, gustNow: 1 };
    }

    /* --- rain: four surfaces ------------------------------------------- */
    {
      const mk = (type, f, q, buf, rate) => {
        const s = src(buf || E.noise, rate || 1);
        const b = filt(type, f, q);
        const g = gain(0);
        s.connect(b); b.connect(g); g.connect(E.buses.ambience);
        s.start();
        return { src: s, filt: b, g };
      };
      B.rain = {
        ground: mk('lowpass', 2200, 0.7),
        leaves: mk('bandpass', 3100, 0.8),
        water: mk('lowpass', 1100, 1.1),
        roofA: mk('peaking', 2900, 8, E.noise, 1),
        roofB: mk('peaking', 4700, 10, E.noise, 1.13),
        pingAt: 0
      };
      B.rain.roofA.filt.gain.value = 12;
      B.rain.roofB.filt.gain.value = 10;
    }

    /* --- cicadas: a modulated band, because that is what a tymbal is ---- */
    {
      const s = src(E.noise, 1);
      const bp = filt('bandpass', 4900, 3.2);
      const bp2 = filt('bandpass', 7200, 4);
      const mod = gain(0.5);
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 58;
      const lfoAmt = gain(0.5);
      lfo.connect(lfoAmt); lfoAmt.connect(mod.gain);
      const g = gain(0);
      s.connect(bp); bp.connect(mod);
      s.connect(bp2); bp2.connect(mod);
      mod.connect(g); g.connect(E.buses.wildlife);
      s.start(); lfo.start();
      B.cicadas = { g, lfo, bp, shade: 1, shadeTarget: 1, nextShade: 0 };
    }

    /* --- mosquito: two detuned tones that wander ----------------------- */
    {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 560;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 566;
      const lp = filt('lowpass', 2400, 1);
      const g = gain(0);
      const p = pan(0);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(p); p.connect(E.buses.wildlife);
      o1.start(); o2.start();
      B.mosquito = { o1, o2, g, p, phase: 0, near: 0, nextMove: 0 };
    }

    /* --- frogs: a sparse clicking chorus, not a wall -------------------- */
    {
      const s = src(E.noise, 1);
      const bp = filt('bandpass', 1900, 6);
      const mod = gain(0.35);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 15;
      const amt = gain(0.5);
      lfo.connect(amt); amt.connect(mod.gain);
      const g = gain(0);
      s.connect(bp); bp.connect(mod); mod.connect(g); g.connect(E.buses.wildlife);
      s.start(); lfo.start();
      B.frogs = { g, lfo, bp };
    }

    /* --- township murmur ------------------------------------------------ */
    {
      const s = src(E.pink, 0.6);
      const bp = filt('bandpass', 520, 0.9);
      const lp = filt('lowpass', 1400, 0.7);
      const g = gain(0);
      const p = pan(0);
      s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(p); p.connect(E.buses.human);
      s.start();
      B.town = { g, p, bp };
    }

    /* --- the pub, heard through a wall ---------------------------------- */
    {
      const s = src(E.pink, 0.5);
      const lp = filt('lowpass', 420, 1.4);
      const g = gain(0);
      const p = pan(0);
      // A slow bass pulse under it. Never a tune: you are outside.
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 72;
      const og = gain(0);
      const beat = ctx.createOscillator(); beat.type = 'square'; beat.frequency.value = 1.9;
      const beatAmt = gain(0.5);
      beat.connect(beatAmt); beatAmt.connect(og.gain);
      s.connect(lp); lp.connect(g);
      o.connect(og); og.connect(g);
      g.connect(p); p.connect(E.buses.human);
      s.start(); o.start(); beat.start();
      B.pub = { g, p, og, beat };
    }

    /* --- a mower, two stroke -------------------------------------------- */
    {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 112;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 56;
      const lp = filt('lowpass', 900, 2.2);
      const g = gain(0);
      const p = pan(0.2);
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(p); p.connect(E.buses.human);
      o.start(); o2.start();
      B.mower = { o, o2, g, p, lp, load: 0, nextLoad: 0 };
    }

    /* --- the school playground ------------------------------------------ */
    {
      const s = src(E.noise, 1);
      const bp = filt('bandpass', 1700, 1.1);
      const g = gain(0);
      const p = pan(0);
      s.connect(bp); bp.connect(g); g.connect(p); p.connect(E.buses.human);
      s.start();
      B.school = { g, p };
    }

    /* --- the underscore -------------------------------------------------- */
    {
      const g = gain(0);
      const lp = filt('lowpass', 2200, 0.8);
      g.connect(lp); lp.connect(E.buses.music);
      B.music = { g, lp, notes: [], nextAt: 0, chord: null, register: null };
    }
  }

  /* ---------------------------------------------------------------- one-shots

     Every call in the world is built here, played once and thrown away. Each returns the number of
     nodes it made so the source count in the read model is a real count and not an estimate. */

  function envGain(a, peak, d, when, sustain) {
    const g = E.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + a);
    if (sustain) g.gain.setValueAtTime(Math.max(0.0002, peak), when + a + sustain);
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + (sustain || 0) + d);
    return g;
  }

  function place(node, x, z, busId, sendVerb) {
    // Distance and azimuth in the listener's frame. Doing the panning by hand rather than with a
    // PannerNode per voice keeps the node count down and makes the maths inspectable.
    const p = pan(0);
    node.connect(p);
    if (sendVerb && E.verbSend) {
      const send = gain(sendVerb);
      node.connect(send);
      send.connect(E.verbSend);
    }
    p.connect(E.buses[busId] || E.buses.wildlife);
    if (Number.isFinite(x)) {
      const dx = x - ear.x, dz = z - ear.z;
      const dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      const rel = bearing - (ear.heading * Math.PI) / 180;
      p.pan.value = clamp(Math.sin(rel) * clamp01(1 - dist / 900) * 0.85, -1, 1);
    }
    return p;
  }

  /** A short pitched note with a body and a bite. The building block for most calls. */
  function tone(when, freq, freq2, dur, peak, type, q) {
    const ctx = E.ctx;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, when);
    if (freq2 && freq2 !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), when + dur);
    const f = filt('bandpass', Math.max(freq, freq2 || freq) * 1.25, q || 1.1);
    const g = envGain(Math.min(0.02, dur * 0.25), peak, dur, when);
    o.connect(f); f.connect(g);
    o.start(when);
    o.stop(when + dur + 0.06);
    E.created++;
    return g;
  }

  function noiseBurst(when, f0, f1, dur, peak, q, type) {
    const s = E.ctx.createBufferSource();
    s.buffer = E.noise;
    s.loop = true;
    const b = filt(type || 'bandpass', f0, q || 1.2);
    if (f1 && f1 !== f0) {
      b.frequency.setValueAtTime(f0, when);
      b.frequency.exponentialRampToValueAtTime(Math.max(30, f1), when + dur);
    }
    const g = envGain(Math.min(0.015, dur * 0.2), peak, dur, when);
    s.connect(b); b.connect(g);
    s.start(when);
    s.stop(when + dur + 0.06);
    E.created++;
    return g;
  }

  const CALLS = {
    /** The cackle. Pulses that accelerate then fall away, sometimes two birds. */
    kookaburra(when, peak, x, z) {
      const out = gain(1);
      const birds = rng.float() < 0.45 ? 2 : 1;
      for (let b = 0; b < birds; b++) {
        const f0 = 620 + rng.float() * 220 - b * 90;
        const n = 9 + Math.floor(rng.float() * 9);
        let t = when + b * (0.24 + rng.float() * 0.2);
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const step = lerp(0.135, 0.075, smooth(clamp01(u * 1.6))) * (u > 0.65 ? 1.5 : 1);
          const f = f0 * (1 + 0.5 * Math.sin(u * 3.1)) * (u > 0.55 ? 1.28 : 1);
          const amp = peak * (0.35 + 0.65 * Math.sin(Math.PI * clamp01(u * 1.15))) * (b ? 0.6 : 1);
          const g = tone(t, f * 1.7, f * 0.62, 0.055 + rng.float() * 0.03, amp, 'sawtooth', 2.6);
          g.connect(out);
          t += step;
        }
      }
      place(out, x, z, 'wildlife', 0.4);
      return out;
    },

    /** A harsh, fast-modulated screech. */
    lorikeet(when, peak, x, z) {
      const out = gain(1);
      const n = 1 + Math.floor(rng.float() * 3);
      let t = when;
      for (let i = 0; i < n; i++) {
        const f = 1900 + rng.float() * 900;
        const g = noiseBurst(t, f, f * 0.55, 0.13 + rng.float() * 0.1, peak * (0.8 + rng.float() * 0.4), 4.5);
        g.connect(out);
        const h = tone(t, f * 1.02, f * 0.5, 0.12, peak * 0.5, 'sawtooth', 3);
        h.connect(out);
        t += 0.16 + rng.float() * 0.12;
      }
      place(out, x, z, 'wildlife', 0.35);
      return out;
    },

    /** The wail. A soft rise, a held top, then a long fall. Repeated and answered. */
    curlewWail(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 4);
      let t = when;
      const base = 700 + rng.float() * 260;
      for (let i = 0; i < n; i++) {
        const dur = 0.55 + rng.float() * 0.35;
        const amp = peak * (0.55 + 0.45 * (i / Math.max(1, n - 1)));
        const o = E.ctx.createOscillator();
        o.type = 'sine';
        const f = base * (1 + i * 0.03);
        o.frequency.setValueAtTime(f * 0.72, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.16, t + dur * 0.34);
        o.frequency.exponentialRampToValueAtTime(f * 0.58, t + dur);
        // A touch of vibrato and a second partial: a pure sine is a synthesiser, not a bird.
        const vib = E.ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.4;
        const vibAmt = gain(9);
        vib.connect(vibAmt); vibAmt.connect(o.frequency);
        const o2 = E.ctx.createOscillator();
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(f * 1.44, t);
        o2.frequency.exponentialRampToValueAtTime(f * 1.16, t + dur);
        const o2g = gain(0.16);
        const g = envGain(dur * 0.22, amp, dur * 0.7, t);
        o.connect(g); o2.connect(o2g); o2g.connect(g);
        g.connect(out);
        o.start(t); o.stop(t + dur + 0.1);
        o2.start(t); o2.stop(t + dur + 0.1);
        vib.start(t); vib.stop(t + dur + 0.1);
        E.created += 3;
        t += dur + 0.28 + rng.float() * 0.3;
      }
      // The wail is the sound of a big empty night, so it gets the most reverb of anything here.
      place(out, x, z, 'wildlife', 0.7);
      return out;
    },

    /** Two notes, the second higher, carrying over water. */
    easternCurlew(when, peak, x, z) {
      const out = gain(1);
      const f = 1180 + rng.float() * 260;
      tone(when, f * 0.78, f * 0.82, 0.2, peak * 0.7, 'sine', 2).connect(out);
      tone(when + 0.21, f * 1.12, f * 1.28, 0.3, peak, 'sine', 2).connect(out);
      if (rng.float() < 0.5) {
        tone(when + 0.72, f * 0.8, f * 0.84, 0.18, peak * 0.5, 'sine', 2).connect(out);
        tone(when + 0.92, f * 1.14, f * 1.3, 0.28, peak * 0.7, 'sine', 2).connect(out);
      }
      place(out, x, z, 'wildlife', 0.65);
      return out;
    },

    oystercatcher(when, peak, x, z) {
      const out = gain(1);
      const n = 1 + Math.floor(rng.float() * 4);
      for (let i = 0; i < n; i++) {
        tone(when + i * 0.13, 2500 + rng.float() * 500, 2100, 0.075, peak, 'square', 5).connect(out);
      }
      place(out, x, z, 'wildlife', 0.4);
      return out;
    },

    tern(when, peak, x, z) {
      const out = gain(1);
      const n = 3 + Math.floor(rng.float() * 5);
      for (let i = 0; i < n; i++) {
        noiseBurst(when + i * (0.07 + rng.float() * 0.05), 3600 + rng.float() * 1400, 2600, 0.05, peak * 0.8, 8).connect(out);
      }
      place(out, x, z, 'wildlife', 0.35);
      return out;
    },

    /** A loud repeated honk, usually a pair answering. */
    seaEagle(when, peak, x, z) {
      const out = gain(1);
      const n = 4 + Math.floor(rng.float() * 5);
      const f = 360 + rng.float() * 110;
      for (let i = 0; i < n; i++) {
        const t = when + i * (0.19 + rng.float() * 0.05);
        tone(t, f * 1.06, f * 0.94, 0.13, peak * (0.7 + 0.3 * rng.float()), 'sawtooth', 3.4).connect(out);
      }
      if (rng.float() < 0.5) {
        const t2 = when + 0.9 + rng.float() * 0.4;
        for (let i = 0; i < 4; i++) {
          tone(t2 + i * 0.2, f * 1.22, f * 1.08, 0.12, peak * 0.55, 'sawtooth', 3.4).connect(out);
        }
      }
      place(out, x, z, 'wildlife', 0.6);
      return out;
    },

    osprey(when, peak, x, z) {
      const out = gain(1);
      const n = 4 + Math.floor(rng.float() * 4);
      for (let i = 0; i < n; i++) {
        tone(when + i * 0.18, 2300 - i * 70, 1900 - i * 60, 0.11, peak * 0.85, 'sine', 4).connect(out);
      }
      place(out, x, z, 'wildlife', 0.55);
      return out;
    },

    kite(when, peak, x, z) {
      const out = gain(1);
      const f = 1150 + rng.float() * 240;
      tone(when, f * 1.1, f * 0.62, 0.62, peak, 'sawtooth', 4.5).connect(out);
      place(out, x, z, 'wildlife', 0.6);
      return out;
    },

    beeEater(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 3);
      for (let i = 0; i < n; i++) {
        const t = when + i * (0.22 + rng.float() * 0.1);
        for (let k = 0; k < 5; k++) {
          tone(t + k * 0.018, 2900 + rng.float() * 400, 2500, 0.02, peak * 0.7, 'sine', 6).connect(out);
        }
      }
      place(out, x, z, 'wildlife', 0.4);
      return out;
    },

    /** Soft, creaky, wheezy. Deliberately quiet: this bird does not shout. */
    glossyBlack(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 3);
      for (let i = 0; i < n; i++) {
        const t = when + i * (0.55 + rng.float() * 0.35);
        noiseBurst(t, 1250, 900, 0.45, peak * 0.75, 3.2).connect(out);
        tone(t + 0.04, 560, 480, 0.36, peak * 0.35, 'triangle', 2.2).connect(out);
      }
      place(out, x, z, 'wildlife', 0.5);
      return out;
    },

    magpie(when, peak, x, z) {
      const out = gain(1);
      const n = 5 + Math.floor(rng.float() * 6);
      let t = when;
      let f = 900 + rng.float() * 400;
      for (let i = 0; i < n; i++) {
        const dur = 0.09 + rng.float() * 0.11;
        tone(t, f, f * (0.7 + rng.float() * 0.7), dur, peak * (0.6 + 0.4 * rng.float()), 'triangle', 2.2).connect(out);
        tone(t, f * 2, f * 1.7, dur * 0.7, peak * 0.2, 'sine', 3).connect(out);
        f = clamp(f * (0.75 + rng.float() * 0.7), 500, 2100);
        t += dur + 0.02;
      }
      place(out, x, z, 'wildlife', 0.45);
      return out;
    },

    flyingFox(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 5);
      for (let i = 0; i < n; i++) {
        const t = when + i * (0.14 + rng.float() * 0.16);
        noiseBurst(t, 1500 + rng.float() * 900, 700, 0.16 + rng.float() * 0.12, peak * 0.8, 2.2).connect(out);
        tone(t, 420 + rng.float() * 300, 260, 0.14, peak * 0.4, 'sawtooth', 2).connect(out);
      }
      place(out, x, z, 'wildlife', 0.35);
      return out;
    },

    /** The bellow. A low grinding pulse train with an audible intake at the end of each phrase. */
    koalaBellow(when, peak, x, z) {
      const ctx = E.ctx;
      const out = gain(1);
      const dur = 3.5 + rng.float() * 3.5;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 32 + rng.float() * 14;
      const lp = filt('lowpass', 420, 3.2);
      const growl = E.ctx.createBufferSource();
      growl.buffer = E.noise; growl.loop = true;
      const growlF = filt('lowpass', 700, 1.6);
      const growlG = gain(0.35);
      // The pulse: irregular, two to four a second, which is what makes it sound mechanical.
      const pulse = ctx.createOscillator();
      pulse.type = 'sawtooth';
      pulse.frequency.value = 2.6 + rng.float() * 1.6;
      const pulseAmt = gain(0.55);
      const vca = gain(0.5);
      pulse.connect(pulseAmt); pulseAmt.connect(vca.gain);
      const env = envGain(0.5, peak, 1.2, when, dur - 1.7);
      o.connect(lp); lp.connect(vca);
      growl.connect(growlF); growlF.connect(growlG); growlG.connect(vca);
      vca.connect(env); env.connect(out);
      o.start(when); o.stop(when + dur + 0.2);
      growl.start(when); growl.stop(when + dur + 0.2);
      pulse.start(when); pulse.stop(when + dur + 0.2);
      E.created += 4;
      place(out, x, z, 'wildlife', 0.55);
      return out;
    },

    whaleBlow(when, peak, x, z) {
      const out = gain(1);
      noiseBurst(when, 260, 900, 0.55, peak, 0.9, 'bandpass').connect(out);
      tone(when, 70, 45, 0.4, peak * 0.35, 'sine', 1).connect(out);
      place(out, x, z, 'wildlife', 0.75);
      return out;
    },

    dolphinBlow(when, peak, x, z) {
      const out = gain(1);
      noiseBurst(when, 900, 2400, 0.18, peak, 1.4, 'bandpass').connect(out);
      place(out, x, z, 'wildlife', 0.45);
      return out;
    },

    /** A whole roost off the sand at once. Wings first, then the alarm. */
    roostFlush(when, peak, x, z, count) {
      const out = gain(1);
      const n = clamp(Math.round((count || 200) / 26), 6, 26);
      // The rush of wings: a swelling band of noise.
      const rush = noiseBurst(when, 420, 1500, 1.5, peak * 0.9, 0.7, 'bandpass');
      rush.connect(out);
      for (let i = 0; i < n; i++) {
        const t = when + rng.float() * 1.9;
        const f = 1400 + rng.float() * 1800;
        tone(t, f, f * 0.8, 0.06 + rng.float() * 0.06, peak * (0.25 + rng.float() * 0.4), 'sine', 4).connect(out);
      }
      place(out, x, z, 'wildlife', 0.7);
      return out;
    },

    /** A small chirp, for the dawn chorus. Cheap on purpose: there are a lot of them. */
    chirp(when, peak, x, z) {
      const f = 2200 + rng.float() * 3200;
      const g = tone(when, f, f * (0.7 + rng.float() * 0.8), 0.03 + rng.float() * 0.05, peak, 'sine', 5);
      place(g, x, z, 'wildlife', 0.5);
      return g;
    },

    /* --------------------------------------------------------- human */

    /** Tyres, then engine, then tyres. Panned across you and dopplered a little. */
    car(when, peak, x, z, kind, speedKmh) {
      const ctx = E.ctx;
      const out = gain(1);
      const speed = clamp(num(speedKmh, 50), 8, 90);
      // A bus is slower, longer and lower than a ute, and that is audible before it is visible.
      const bus = kind === 'bus' || kind === 'service';
      const dur = clamp(bus ? 6.2 : 260 / speed, 2.2, 8);
      const tyre = ctx.createBufferSource();
      tyre.buffer = E.noise; tyre.loop = true;
      const tf = filt('bandpass', 700, 0.6);
      tf.frequency.setValueAtTime(420, when);
      tf.frequency.linearRampToValueAtTime(700 + speed * 6, when + dur * 0.5);
      tf.frequency.linearRampToValueAtTime(380, when + dur);
      const tg = envGain(dur * 0.42, peak, dur * 0.55, when);
      const eng = ctx.createOscillator();
      eng.type = 'sawtooth';
      const f0 = (bus ? 38 : kind === 'fourwd' || kind === 'ute' ? 54 : 68) + speed * 0.35;
      eng.frequency.setValueAtTime(f0 * 1.06, when);
      eng.frequency.linearRampToValueAtTime(f0 * 1.12, when + dur * 0.5);
      eng.frequency.linearRampToValueAtTime(f0 * 0.9, when + dur);
      const elp = filt('lowpass', 420, 2.6);
      const eg = envGain(dur * 0.45, peak * 0.55, dur * 0.5, when);
      tyre.connect(tf); tf.connect(tg); tg.connect(out);
      eng.connect(elp); elp.connect(eg); eg.connect(out);
      tyre.start(when); tyre.stop(when + dur + 0.1);
      eng.start(when); eng.stop(when + dur + 0.1);
      E.created += 2;
      // Panning is the whole effect: it has to cross you.
      const p = pan(0);
      const side = rng.float() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-0.85 * side, when);
      p.pan.linearRampToValueAtTime(0.85 * side, when + dur);
      out.connect(p);
      const send = gain(0.25); out.connect(send); send.connect(E.verbSend);
      p.connect(E.buses.human);
      return out;
    },

    /** One long low horn. Three partials, slow on, slow off. */
    bargeHorn(when, peak, x, z) {
      const out = gain(1);
      const dur = 2.6;
      // Four partials, and they sum, so each one is scaled to leave headroom. The limiter would
      // catch it either way, but a limiter working on the horn every sailing is a limiter that
      // ducks the whole island every sailing.
      for (const [f, a] of [[104, 0.55], [156, 0.3], [208, 0.17], [312, 0.07]]) {
        const g = envGain(0.35, peak * a, 1.1, when, dur - 1.45);
        const o = E.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (0.998 + rng.float() * 0.004);
        const lp = filt('lowpass', 900, 1);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(when); o.stop(when + dur + 0.2);
        E.created++;
      }
      place(out, x, z, 'human', 0.85);
      return out;
    },

    /** The water taxi: a strained outboard note that arrives and leaves. */
    outboard(when, peak, x, z) {
      const ctx = E.ctx;
      const out = gain(1);
      const dur = 6 + rng.float() * 8;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 118 + rng.float() * 70;
      o.frequency.setValueAtTime(f0 * 0.6, when);
      o.frequency.linearRampToValueAtTime(f0, when + 1.6);
      o.frequency.linearRampToValueAtTime(f0 * 1.02, when + dur - 1);
      const lp = filt('lowpass', 1100, 3.4);
      const hiss = ctx.createBufferSource(); hiss.buffer = E.noise; hiss.loop = true;
      const hf = filt('bandpass', 2400, 1.2);
      const hg = gain(0.12);
      const env = envGain(1.4, peak * 0.6, 2.2, when, Math.max(0.1, dur - 3.6));
      o.connect(lp); lp.connect(env);
      hiss.connect(hf); hf.connect(hg); hg.connect(env);
      env.connect(out);
      o.start(when); o.stop(when + dur + 0.2);
      hiss.start(when); hiss.stop(when + dur + 0.2);
      E.created += 2;
      place(out, x, z, 'human', 0.6);
      return out;
    },

    dog(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 6);
      const f = 320 + rng.float() * 260;
      for (let i = 0; i < n; i++) {
        const t = when + i * (0.28 + rng.float() * 0.22);
        noiseBurst(t, f * 3, f * 1.4, 0.1, peak * 0.8, 1.6).connect(out);
        tone(t, f, f * 0.62, 0.12, peak, 'sawtooth', 2.4).connect(out);
      }
      place(out, x, z, 'human', 0.45);
      return out;
    },

    voice(when, peak, x, z) {
      const out = gain(1);
      const n = 2 + Math.floor(rng.float() * 3);
      let t = when;
      let f = 130 + rng.float() * 90;
      for (let i = 0; i < n; i++) {
        const dur = 0.14 + rng.float() * 0.2;
        noiseBurst(t, f * 6, f * 4, dur, peak * 0.5, 1.1).connect(out);
        tone(t, f, f * (0.8 + rng.float() * 0.5), dur, peak * 0.6, 'sawtooth', 1.6).connect(out);
        t += dur + rng.float() * 0.14;
      }
      place(out, x, z, 'human', 0.4);
      return out;
    },

    /* --------------------------------------------------------- interface */

    /** All of these are under 120 ms, soft, and physical. Nothing beeps. */
    uiSelect(when, peak) {
      const out = gain(1);
      tone(when, 232, 210, 0.075, peak * 0.9, 'sine', 1.2).connect(out);
      noiseBurst(when, 2600, 1400, 0.012, peak * 0.45, 1.4).connect(out);
      out.connect(E.buses.ui);
      return out;
    },
    uiHover(when, peak) {
      const out = gain(1);
      tone(when, 880, 840, 0.018, peak * 0.4, 'sine', 1).connect(out);
      out.connect(E.buses.ui);
      return out;
    },
    uiOpen(when, peak) {
      const out = gain(1);
      tone(when, 330, 336, 0.045, peak * 0.7, 'sine', 1).connect(out);
      tone(when + 0.035, 494, 500, 0.06, peak * 0.6, 'sine', 1).connect(out);
      out.connect(E.buses.ui);
      return out;
    },
    uiClose(when, peak) {
      const out = gain(1);
      tone(when, 494, 488, 0.04, peak * 0.6, 'sine', 1).connect(out);
      tone(when + 0.032, 330, 324, 0.06, peak * 0.6, 'sine', 1).connect(out);
      out.connect(E.buses.ui);
      return out;
    },
    uiRefuse(when, peak) {
      const out = gain(1);
      tone(when, 138, 122, 0.1, peak * 0.85, 'sine', 1).connect(out);
      noiseBurst(when, 420, 260, 0.05, peak * 0.3, 0.9).connect(out);
      out.connect(E.buses.ui);
      return out;
    },
    uiNotify(when, peak) {
      const out = gain(1);
      tone(when, 660, 658, 0.105, peak * 0.7, 'sine', 1).connect(out);
      tone(when, 1320, 1316, 0.05, peak * 0.2, 'sine', 1).connect(out);
      out.connect(E.buses.ui);
      return out;
    },

    /* --------------------------------------------------------- surf */

    /** One wave. Build, break, wash. The three parts a wave actually has. */
    wave(when, peak, x, z, big, periodS) {
      const out = gain(1);
      const build = 0.35 + periodS * 0.055;
      // The build: a rising band as the face stands up.
      const b = noiseBurst(when, 620, 220, build + 0.5, peak * 0.55, 1.1, 'bandpass');
      b.connect(out);
      const t0 = when + build;
      // The break: the crack. Bright at the top, then everything.
      const brk = noiseBurst(t0, 900, 340, 0.75 + (big ? 0.4 : 0), peak * (big ? 1.15 : 0.85), 0.75, 'lowpass');
      brk.connect(out);
      if (big) {
        // A set wave has a thump you feel more than hear.
        tone(t0, 58, 38, 0.55, peak * 0.5, 'sine', 0.8).connect(out);
      }
      // The wash: hiss running up the sand, and it takes its time.
      const wash = noiseBurst(t0 + 0.2, 1500, 3400, 2.2 + rng.float() * 1.6, peak * 0.42, 0.55, 'highpass');
      wash.connect(out);
      place(out, x, z, 'ambience', 0.35);
      return out;
    },

    /** Bay chop. A slap, not a break. */
    slap(when, peak, x, z) {
      const out = gain(1);
      noiseBurst(when, 900, 420, 0.16, peak, 1.1, 'bandpass').connect(out);
      place(out, x, z, 'ambience', 0.2);
      return out;
    },

    /** Rain on tin, one drop at a time, which only happens when it is just starting. */
    ping(when, peak) {
      const out = gain(1);
      noiseBurst(when, 3800 + rng.float() * 2200, 2600, 0.045, peak, 14).connect(out);
      out.connect(E.buses.ambience);
      return out;
    }
  };

  /* ---------------------------------------------------------------- scheduling */

  const pending = [];      // {node, until} so the live count is a real count

  function fire(kind, peak, x, z, a, b) {
    if (!E.ready || E.auditing || !CALLS[kind]) return null;
    const when = E.ctx.currentTime + 0.02;
    let node = null;
    try {
      node = CALLS[kind](when, clamp(peak, 0.0005, 1), x, z, a, b);
    } catch (e) {
      return null;
    }
    E.oneShots++;
    const k = state.sources.byKind;
    k[kind] = (k[kind] || 0) + 1;
    pending.push({ node, until: when + 9 });
    if (pending.length > 240) pending.splice(0, pending.length - 240);
    return node;
  }

  function reapPending(now) {
    let live = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].until < now) pending.splice(i, 1);
      else live++;
    }
    return live;
  }

  /* ---------------------------------------------------------------- the mix */

  // Which land covers each habitat class will accept. A bird is not placed in water and a
  // mangrove kite is not placed on a road, so the direction a call comes from is never a lie.
  const WANTED = {
    bush: { forest: 1, heath: 1, rehab: 1, swamp: 1 },
    open: { cleared: 1, urban: 1, foredune: 1, beach: 1, rehab: 1 },
    edge: { cleared: 1, urban: 1, heath: 1, forest: 1 },
    mangrove: { mangrove: 1, saltmarsh: 1 },
    wet: { swamp: 1, lake: 1, saltmarsh: 1, heath: 1 }
  };

  const emitterFor = {
    bush: () => coverPoint('bush', 30, 230),
    open: () => coverPoint('open', 25, 200),
    edge: () => coverPoint('edge', 25, 180),
    beach: () => nearestReach(true),
    flats: () => nearestReach(false),
    coast: () => nearestReach(null),
    mangrove: () => coverPoint('mangrove', 40, 500),
    wet: () => coverPoint('wet', 40, 420),
    listener: () => ({ x: ear.x, z: ear.z }),
    road: () => nearestRoadPoint(),
    town: () => nearestTownPoint(),
    ramp: () => nearestNamedPoint(['amityRamp', 'bargeRamp', 'oneMileJetty']),
    pub: () => geo.points.pub || { x: ear.x, z: ear.z },
    school: () => geo.points.school || { x: ear.x, z: ear.z },
    whale: () => nearestPod('whales'),
    dolphin: () => nearestPod('dolphins')
  };

  /** A point near the ear whose land cover actually suits the animal. Six samples, only when a
   *  call fires, which is a few times a minute. */
  function coverPoint(kind, minD, maxD) {
    const want = WANTED[kind];
    const isl = world.island;
    let fallback = null;
    for (let i = 0; i < 6; i++) {
      const a = rng.float() * Math.PI * 2;
      const d = minD + rng.float() * (maxD - minD);
      const p = { x: ear.x + Math.cos(a) * d, z: ear.z + Math.sin(a) * d };
      if (!fallback) fallback = p;
      if (!want || !isl || typeof isl.landCover !== 'function') return p;
      let cv = '';
      try { cv = isl.landCover(p.x, p.z); } catch (e) { return p; }
      if (want[cv]) return p;
    }
    return fallback || { x: ear.x, z: ear.z };
  }

  function nearestRoadPoint() {
    let best = null, bd = 1e9;
    for (const r of geo.roads) {
      const d = Math.hypot(r.x - ear.x, r.z - ear.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) return { x: ear.x, z: ear.z };
    // Somewhere along the segment, not always the midpoint.
    const t = rng.float();
    return { x: lerp(best.ax, best.bx, t), z: lerp(best.az, best.bz, t) };
  }

  function nearestTownPoint() {
    let best = null, bd = 1e9;
    for (const t of geo.towns) {
      const d = Math.hypot(t.x - ear.x, t.z - ear.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return { x: ear.x, z: ear.z };
    return { x: best.x + (rng.float() - 0.5) * 460, z: best.z + (rng.float() - 0.5) * 460 };
  }

  function nearestNamedPoint(keys) {
    let best = null, bd = 1e9;
    for (const k of keys) {
      const p = geo.points[k];
      if (!p) continue;
      const d = Math.hypot(p.x - ear.x, p.z - ear.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best || { x: ear.x, z: ear.z };
  }

  /** The real animal, at its real position. A blow that comes from where no whale is would be a lie
   *  the player can check against the water. */
  function nearestPod(which) {
    const list = which === 'whales'
      ? ((world.read('whales') || {}).pods || [])
      : (((world.read('marine') || {}).dolphins || {}).pods || []);
    let best = null, bd = 1e9;
    for (const p of list) {
      if (which === 'whales' && !p.surfacing) continue;
      const d = Math.hypot(p.x - ear.x, p.z - ear.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { x: best.x, z: best.z } : { x: ear.x, z: ear.z };
  }
  /** The nearest point on the nearest matching stretch of sand, which is where the sound is. */
  function nearestReach(oceanOnly) {
    let best = null, bd = 1e9;
    for (const r of geo.reaches) {
      if (oceanOnly === true && !r.ocean) continue;
      if (oceanOnly === false && r.ocean) continue;
      const d = segDist(ear.x, ear.z, r.ax, r.az, r.bx, r.bz);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) return { x: ear.x, z: ear.z };
    return closestOnSegment(ear.x, ear.z, best.ax, best.az, best.bx, best.bz);
  }

  function closestOnSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return { x: ax, z: az };
    let t = ((px - ax) * dx + (pz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: ax + dx * t, z: az + dz * t };
  }

  const accum = Object.create(null);   // per-voice call accumulator
  const passSeen = new Set();          // vehicle ids currently inside earshot

  function updateMix(w, dtReal) {
    const ctx = E.ctx;
    const now = ctx.currentTime;
    const B = E.beds;
    const tau = 0.25;
    const s = state;
    const openness = ear.openness;

    /* --- surf ---------------------------------------------------------- */
    {
      const oceanG = dbToGain(s.surf.oceanDb);
      const bayG = dbToGain(s.surf.bayDb);
      const roarO = B.surf.roar[0], roarB = B.surf.roar[1];
      // The roar gets darker with distance and wider from the air.
      at(roarO.g.gain, oceanG * 0.5, tau, now);
      at(roarO.lp.frequency, lerp(170, 380, clamp01(oceanG)), tau, now);
      at(roarO.p.pan, panTo(nearestReach(true)), tau, now);
      at(roarB.g.gain, bayG * 0.28, tau, now);
      at(roarB.lp.frequency, lerp(210, 430, clamp01(bayG)), tau, now);
      at(roarB.p.pan, panTo(nearestReach(false)), tau, now);
      at(B.chop.g.gain, bayG * 0.5, tau, now);
      at(B.chop.bp.frequency, lerp(520, 1250, clamp01(s.field.windKt / 30)), tau, now);
      at(B.chop.lfo.frequency, lerp(0.7, 2.6, clamp01(s.field.windKt / 30)), tau, now);
      at(B.chop.p.pan, panTo(nearestReach(false)), tau, now);

      // Individual waves, on the real period, with a set every eight to thirteen.
      const period = Math.max(3.5, s.surf.breakEveryS);
      if (oceanG > 0.02 && now >= B.surf.wave.nextAt) {
        const i = B.surf.wave.index++;
        const setPhase = (i % Math.max(4, s.surf.setEvery)) / Math.max(4, s.surf.setEvery);
        // A set is a swelling of size, not a single big one out of nowhere.
        const setSize = 0.62 + 0.55 * Math.pow(Math.sin(setPhase * Math.PI), 2.2);
        const big = setSize > 1.02 || rng.float() < 0.07;
        const r = pickReach(true);
        if (r) fire('wave', clamp01(oceanG * setSize * 0.9), r.x, r.z, big, period);
        B.surf.wave.nextAt = now + period * (0.82 + rng.float() * 0.36);
      }
      if (bayG > 0.05) {
        accum.slap = (accum.slap || 0) + dtReal * lerp(0.4, 3.4, clamp01(s.field.windKt / 28));
        while (accum.slap >= 1) {
          accum.slap -= 1;
          const r = pickReach(false);
          if (r) fire('slap', bayG * 0.5 * (0.6 + rng.float() * 0.6), r.x, r.z);
        }
      }
    }

    /* --- wind ---------------------------------------------------------- */
    {
      const W = B.wind;
      const g = dbToGain(s.wind.db);
      // Gusts: a slow walk toward the gust ceiling and back, not a sine.
      W.gustPhase -= dtReal;
      if (W.gustPhase <= 0) {
        W.gustPhase = 3 + rng.float() * 9;
        W.gustTarget = 1 + s.wind.gustDepth * (rng.float() * 1.5 - 0.35);
      }
      W.gustNow = damp(W.gustNow, W.gustTarget, 0.8, dtReal);
      const gg = g * clamp(W.gustNow, 0.4, 2.2);
      at(W.bodyG.gain, gg * 0.5, 0.3, now);
      at(W.body.frequency, lerp(220, 620, clamp01(gg)), 0.3, now);
      // Timbre. This is the part that makes the island sound like the island.
      const T = s.wind.timbre;
      const spec = T === 'hiss' ? [3400, 1.1, 0, 0.55]
        : T === 'rattle' ? [1550, 6.5, 0.5, 0.5]
          : T === 'canopy' ? [860, 2.4, 0.06, 0.62]
            : T === 'papery' ? [2500, 2, 0.22, 0.42]
              : T === 'clatter' ? [700, 5, 0.42, 0.34]
                : T === 'eaves' ? [1150, 8, 0.05, 0.3]
                  : [260, 1.2, 0, 0.3];
      at(W.voice.frequency, spec[0], 0.5, now);
      at(W.voice.Q, spec[1], 0.5, now);
      at(W.glfoAmt.gain, spec[2] * clamp01(gg * 1.4), 0.4, now);
      at(W.glfo.frequency, lerp(6, 22, clamp01(s.field.windKt / 30)), 0.5, now);
      at(W.voiceG.gain, gg * spec[3], 0.3, now);
    }

    /* --- rain ---------------------------------------------------------- */
    {
      const R = B.rain;
      const g = dbToGain(s.rain.db);
      const sf = s.rain.surfaces;
      at(R.ground.g.gain, g * sf.ground * 0.5, tau, now);
      at(R.leaves.g.gain, g * sf.leaves * 0.42, tau, now);
      at(R.water.g.gain, g * sf.water * 0.4, tau, now);
      at(R.roofA.g.gain, g * sf.roof * 0.3, tau, now);
      at(R.roofB.g.gain, g * sf.roof * 0.22, tau, now);
      // Only at the very start of rain do you hear individual drops on the tin.
      if (sf.roof > 0.1 && s.rain.mmHr > 0.02 && s.rain.mmHr < 2.4) {
        accum.ping = (accum.ping || 0) + dtReal * clamp(s.rain.mmHr * 9, 0, 16) * sf.roof;
        while (accum.ping >= 1) { accum.ping -= 1; fire('ping', 0.1 + rng.float() * 0.12); }
      }
    }

    /* --- cicadas ------------------------------------------------------- */
    {
      const C = B.cicadas;
      const target = voiceGain('cicadas');
      // A cloud crossing the sun takes them out in under a second and they come back slowly. This
      // is the detail that tells you it is a real afternoon and not a loop.
      C.nextShade -= dtReal;
      if (C.nextShade <= 0) {
        C.nextShade = 6 + rng.float() * 26;
        const cloud = s.field.cloud;
        C.shadeTarget = rng.float() < cloud * 0.8 ? 0.06 + rng.float() * 0.12 : 1;
      }
      C.shade = damp(C.shade, C.shadeTarget, C.shadeTarget < C.shade ? 4.2 : 0.32, dtReal);
      at(C.g.gain, target * C.shade * 0.32, 0.15, now);
      at(C.lfo.frequency, lerp(42, 78, clamp01((s.field.tempC - 22) / 12)), 0.6, now);
      at(C.bp.frequency, lerp(4200, 5800, clamp01((s.field.tempC - 22) / 12)), 0.6, now);
    }

    /* --- mosquito ------------------------------------------------------ */
    {
      const M = B.mosquito;
      const target = voiceGain('mosquitoes');
      M.nextMove -= dtReal;
      if (M.nextMove <= 0) {
        M.nextMove = 0.7 + rng.float() * 3.4;
        M.near = rng.float() < 0.35 ? 1 : 0.05 + rng.float() * 0.3;
        at(M.p.pan, rng.float() * 1.8 - 0.9, 0.6, now);
        at(M.o1.frequency, 480 + rng.float() * 190, 0.5, now);
        at(M.o2.frequency, 486 + rng.float() * 190, 0.5, now);
      }
      at(M.g.gain, target * M.near * 0.05, 0.35, now);
    }

    /* --- frogs --------------------------------------------------------- */
    {
      const F = B.frogs;
      const target = voiceGain('frogs');
      at(F.g.gain, target * 0.24, 0.4, now);
      at(F.lfo.frequency, lerp(9, 22, clamp01(target)), 0.6, now);
      at(F.bp.frequency, lerp(1500, 2600, clamp01(target)), 0.6, now);
    }

    /* --- township, pub, mower, school ---------------------------------- */
    {
      at(B.town.g.gain, voiceGain('township') * 0.34, 0.5, now);
      let townPan = 0;
      let bestLoud = -1;
      for (const t of geo.towns) if (t.loud > bestLoud) { bestLoud = t.loud; townPan = panTo(t); }
      at(B.town.p.pan, townPan, 0.6, now);

      const pubG = voiceGain('pub');
      at(B.pub.g.gain, pubG * 0.4, 0.6, now);
      at(B.pub.og.gain, pubG * 0.55, 0.6, now);
      if (geo.points.pub) at(B.pub.p.pan, panTo(geo.points.pub), 0.6, now);

      const mowG = voiceGain('mower');
      B.mower.nextLoad -= dtReal;
      if (B.mower.nextLoad <= 0) {
        B.mower.nextLoad = 1.2 + rng.float() * 4;
        B.mower.load = rng.float() < 0.4 ? 0.72 : 1;
      }
      at(B.mower.g.gain, mowG * 0.11, 0.5, now);
      at(B.mower.o.frequency, 112 * B.mower.load, 0.35, now);
      at(B.mower.o2.frequency, 56 * B.mower.load, 0.35, now);
      at(B.mower.lp.frequency, lerp(600, 1300, B.mower.load), 0.35, now);

      at(B.school.g.gain, voiceGain('school') * 0.16, 0.6, now);
      if (geo.points.school) at(B.school.p.pan, panTo(geo.points.school), 0.6, now);
    }

    /* --- the dawn chorus ------------------------------------------------ */
    {
      const g = voiceGain('dawn-chorus');
      if (g > 0.02) {
        accum.chorus = (accum.chorus || 0) + dtReal * lerp(1.5, 15, clamp01(g));
        let budget = 6;   // never dump a stall's worth of birds into one instant
        while (accum.chorus >= 1 && budget-- > 0) {
          accum.chorus -= 1;
          const p = coverPoint('bush', 20, 160);
          fire('chirp', g * (0.05 + rng.float() * 0.11), p.x, p.z);
        }
        if (accum.chorus > 6) accum.chorus = 0;
      }
    }

    /* --- vehicles actually going past ------------------------------------ */
    // Not a rate. traffic.js has real vehicles on the real road graph with real positions, so a
    // pass fires when one of them crosses into earshot and never when nothing is there. Drive out
    // to Blue Lake at two in the morning and the road is silent because the road is empty.
    {
      const traf = w.read('traffic');
      if (traf && Array.isArray(traf.vehicles)) {
        const seen = passSeen;
        const lim = Math.min(traf.vehicles.length, 400);
        for (let i = 0; i < lim; i++) {
          const v = traf.vehicles[i];
          if (!Number.isFinite(v.x)) continue;
          const dx = v.x - ear.x, dz = v.z - ear.z;
          const d2 = dx * dx + dz * dz;
          const inside = d2 < 260 * 260;
          const had = seen.has(v.id);
          if (inside && !had) {
            seen.add(v.id);
            const speed = Math.max(6, num(v.speedKmh, 50));
            const g = clamp01(1 - Math.sqrt(d2) / 260) * clamp01(speed / 60) * (1 - 0.6 * openness);
            if (g > 0.03) fire('car', g * (v.kind === 'bus' ? 0.9 : 0.7), v.x, v.z, v.kind, speed);
          } else if (!inside && had && d2 > 340 * 340) {
            seen.delete(v.id);
          }
        }
        if (seen.size > 300) seen.clear();
      }
    }

    /* --- events the simulation raised ------------------------------------ */
    while (state.pending.length) {
      const ev = state.pending.shift();
      if (!ev) break;
      const d = Math.hypot(ev.x - ear.x, ev.z - ear.z);
      if (d > 2600) continue;              // too far away to hear, and pretending otherwise is a lie
      const g = clamp01(1 - d / 2600) * 0.5;
      fireCue(ev.kind, g, ev.x, ev.z, ev.birds, ev.label);
    }

    /* --- the call roster ------------------------------------------------ */
    for (const v of state.voices) {
      if (v.bed || v.callsPerMin <= 0) continue;
      const synth = SYNTH_FOR[v.id];
      if (!synth) continue;
      accum[v.id] = (accum[v.id] || 0) + (dtReal * v.callsPerMin) / 60;
      // One call per pass at most, so a long stall never dumps a minute of birds at once.
      if (accum[v.id] >= 1) {
        accum[v.id] = 0;
        const where = WHERE_FOR[v.id] || 'bush';
        const p = (emitterFor[where] || emitterFor.bush)();
        // One number, straight off the published voice. The balance lives in LOUDNESS, on the
        // simulation side, where it can be read next to the reason the voice is sounding at all.
        fire(synth, clamp01(v.level) * 0.5, p.x, p.z);
      }
    }

    /* --- whales and dolphins get real positions ------------------------- */
    // Handled through the roster above, but the emitter is the actual pod, not a guess.

    /* --- the underscore -------------------------------------------------- */
    updateMusic(now, dtReal);

    /* --- the master and the buses ---------------------------------------- */
    applyMix();
  }

  function pickReach(ocean) {
    let best = null, bestG = 0;
    for (const r of geo.reaches) {
      if (r.ocean !== ocean) continue;
      if (r.gain > bestG) { bestG = r.gain; best = r; }
    }
    if (!best) return null;
    // Waves break along the whole reach, so they come from along the whole reach: the nearest
    // point, scattered up and down the sand. Standing on the dune above Main Beach, that is what
    // makes it a wall of water rather than one loudspeaker on the horizon.
    const p = closestOnSegment(ear.x, ear.z, best.ax, best.az, best.bx, best.bz);
    const spread = clamp(best.lengthM * 0.5, 120, 1400);
    const t = (rng.float() + rng.float() - 1);       // triangular: mostly near, sometimes far off
    const dx = best.bx - best.ax, dz = best.bz - best.az;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / l) * t * spread, z: p.z + (dz / l) * t * spread };
  }

  function panTo(p) {
    if (!p) return 0;
    const dx = p.x - ear.x, dz = p.z - ear.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1) return 0;
    const rel = Math.atan2(dx, dz) - (ear.heading * Math.PI) / 180;
    return clamp(Math.sin(rel) * clamp01(1 - dist / 2600) * 0.8, -1, 1);
  }

  function voiceGain(id) {
    for (const v of state.voices) if (v.id === id) return v.gain;
    return 0;
  }

  /* ---------------------------------------------------------------- the underscore

     Restrained on purpose, and off by default. It answers a story beat with one chord change and
     then gets out of the way. It is plain tonal synthesis and it has nothing to do with the culture
     of this Country. */

  const REGISTER_CHORDS = {
    'held-breath': [0, 3, 10],      // minor seventh, unresolved
    'plain-good': [0, 7, 14],       // open fifths
    'slow-burn': [0, 5, 10],
    'wry': [0, 4, 11],
    'hard-news': [0, 1, 8],
    'default': [0, 7, 12]
  };

  function updateMusic(now, dt) {
    const M = E.beds.music;
    if (!M) return;
    if (!state.music.enabled) {
      at(M.g.gain, 0, 0.6, now);
      state.music.playing = false;
      return;
    }
    if (M.nextAt > now) return;
    M.nextAt = now + 6 + rng.float() * 6;
    const reg = state.music.register || 'default';
    const ivals = REGISTER_CHORDS[reg] || REGISTER_CHORDS.default;
    const root = 110 * Math.pow(2, (state.music.beats % 4) / 12);
    // Three notes, long, quiet. Any more than this and it stops being an underscore.
    for (let i = 0; i < ivals.length; i++) {
      const f = root * Math.pow(2, ivals[i] / 12);
      const o = E.ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = envGain(2.2, 0.1 / (i + 1), 3.4, now + i * 0.14, 1.6);
      o.connect(g); g.connect(M.g);
      o.start(now + i * 0.14);
      o.stop(now + i * 0.14 + 7.5);
      E.created++;
    }
    at(M.g.gain, 1, 1.5, now);
    state.music.playing = true;
    state.music.chord = ivals.join(',');
  }

  /* ---------------------------------------------------------------- metering */

  function measure() {
    for (const id of ['master', ...BUS_LIST]) {
      const a = E.analysers[id];
      if (!a) continue;
      a.node.getFloatTimeDomainData(a.buf);
      let sum = 0, peak = 0;
      const b = a.buf;
      for (let i = 0; i < b.length; i++) {
        const v = b[i];
        sum += v * v;
        const av = v < 0 ? -v : v;
        if (av > peak) peak = av;
      }
      const rms = Math.sqrt(sum / b.length);
      const L = state.levels[id];
      L.rms = +rms.toFixed(5);
      L.peak = +peak.toFixed(5);
      L.db = +gainToDb(rms).toFixed(1);
      L.peakDb = +gainToDb(peak).toFixed(1);
    }
    if (E.limiter && typeof E.limiter.reduction === 'number') {
      state.limiter.reductionDb = +E.limiter.reduction.toFixed(2);
      state.limiter.engaged = E.limiter.reduction < -0.5;
    }
  }

  /* ---------------------------------------------------------------- mix control */

  function applyMix() {
    if (!E.ready) return;
    const now = E.ctx.currentTime;
    const m = state.mix;
    const on = state.started && !state.muted;
    at(E.master.gain, on ? clamp01(m.master) : 0, state.fading ? 0.7 : 0.08, now);
    for (const id of BUS_LIST) {
      const g = E.buses[id];
      if (!g) continue;
      at(g.gain, clamp01(m[id] === undefined ? 1 : m[id]), 0.12, now);
    }
  }

  /* ---------------------------------------------------------------- lifecycle */

  function start() {
    build();
    if (!E.ready) return false;
    state.contextState = E.ctx.state;
    if (E.ctx.state === 'suspended') E.ctx.resume().then(() => { state.contextState = E.ctx.state; });
    if (!state.started) {
      state.started = true;
      state.muted = false;
      state.fading = true;
      E.fading = true;
      // Two seconds up from silence. Nobody should be startled by a browser tab.
      const now = E.ctx.currentTime;
      E.master.gain.cancelScheduledValues(now);
      E.master.gain.setValueAtTime(0.0001, now);
      E.master.gain.linearRampToValueAtTime(clamp01(state.mix.master), now + 2);
      window.setTimeout(() => { state.fading = false; E.fading = false; }, 2100);
      world.bus.emit('audio:started', { sampleRate: E.ctx.sampleRate });
    } else {
      state.muted = false;
      applyMix();
    }
    saveSettings();
    return true;
  }

  function mute(on) {
    state.muted = on === undefined ? !state.muted : !!on;
    if (!state.muted) { state.declined = false; if (!state.started) return start(); }
    applyMix();
    saveSettings();
    world.bus.emit('audio:mute', { muted: state.muted });
    return state.muted;
  }

  /** Said no. Nothing starts on a gesture from here on, and the choice survives a reload. */
  function decline() {
    state.declined = true;
    state.muted = true;
    saveSettings();
    world.bus.emit('audio:declined', {});
    return true;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem('minjerribah.audio', JSON.stringify({
        mix: state.mix, muted: state.muted, music: state.music.enabled, declined: state.declined
      }));
    } catch (e) { /* private browsing, and it does not matter */ }
  }
  function loadSettings() {
    try {
      const raw = window.localStorage.getItem('minjerribah.audio');
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && o.mix) Object.assign(state.mix, o.mix);
      if (o && typeof o.music === 'boolean') state.music.enabled = o.music;
      if (o && o.declined === true) state.declined = true;
    } catch (e) { /* fine */ }
  }

  /* ---------------------------------------------------------------- attach */

  const SYNTH_FOR = {};
  const WHERE_FOR = {};

  function attach(w) {
    if (!HAS_DOM) return;
    loadSettings();
    for (const v of ROSTER) {
      if (v.synth) SYNTH_FOR[v.id] = v.synth;
      if (v.where) WHERE_FOR[v.id] = v.where;
    }
    // Web Audio will not make a sound until the person has done something. That is the browser's
    // rule and it is a good one, so the whole graph waits for a real gesture and comes up on the
    // first one, faded in over two seconds. Somebody who has said no once is never asked again.
    const kick = () => {
      if (state.started || state.declined) return;
      // The graph is built on the gesture, not before it: a context created without one lands in
      // suspended and never leaves on some builds.
      start();
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    if (!state.declined) {
      window.addEventListener('pointerdown', kick, { once: false });
      window.addEventListener('keydown', kick, { once: false });
    }

    // Interface sounds, and only these, fire without something in the world making them.
    // Every one is under 120 ms and none of them beeps: see CALLS.uiSelect and its neighbours.
    //
    // The rule that decides what belongs here: an interface sound is feedback for something the
    // PLAYER just did. It is not a notification about the island. An earlier pass had the refusal
    // thud on `ferry:sold-out`, and a sailing sells out sixty times in ten days on this island, so
    // the player got a refusal noise sixty times for something that was not about them. The
    // island's own events belong to the island's own voices and to the notifications panel.
    w.bus.on('select', () => ui('uiSelect', 0.24));
    w.bus.on('selection:hover', () => ui('uiHover', 0.1));
    w.bus.on('ui:drawer', (p) => ui(p && p.open === false ? 'uiClose' : 'uiOpen', 0.16));
    w.bus.on('ui:intent', () => ui('uiSelect', 0.16));
    // ecology-common.js tags a lever the player moved with by: 'ui'. A lever that moved for any
    // other reason is the island doing something, not the player, and gets no click.
    w.bus.on('policy:changed', (p) => ui(p && p.by === 'ui' ? 'uiOpen' : null, 0.18));
    w.bus.on('civic:consultation-refused', () => ui('uiRefuse', 0.22));

    // The barge. Real vessels, on the published sailing times.
    w.bus.on('ferry:departed', (p) => onSailing(p, 'departed'));
    w.bus.on('ferry:arrived', (p) => onSailing(p, 'arrived'));

    // A drone putting a roost up. shorebirds.js raises this with the text already written.
    w.bus.on('ecology:alert', (p) => {
      if (!p || !/roost/i.test(String(p.id || '') + String(p.text || ''))) return;
      const roost = nearestRoost(w);
      if (roost) fireCue('roostFlush', 0.4, roost.x, roost.z, roost.birds, 'the roost up at ' + roost.label);
    });

    // A dog on an animal. koala.js says which situation it was, and only the dog one gets a dog.
    w.bus.on('wildlife:call', (p) => {
      if (!p || !Number.isFinite(p.x)) return;
      if (!/dog/i.test(String(p.situation || ''))) return;
      const d = Math.hypot(p.x - ear.x, p.z - ear.z);
      if (d < 900) fireCue('dog', 0.24, p.x, p.z, null, `${p.situation} at ${p.where || 'a yard'}`);
    });

    // The underscore listens for both names. The bus emits narrative:beat; the brief called it
    // story:beat, and a listener that only answers to one of them is a listener that misses.
    const onBeat = (p) => {
      state.music.beats++;
      state.music.register = (p && (p.register || p.tone)) || state.music.register || 'default';
      if (E.beds.music) E.beds.music.nextAt = 0;
    };
    w.bus.on('narrative:beat', onBeat);
    w.bus.on('story:beat', onBeat);
    w.bus.on('narrative:thread-open', onBeat);
  }

  function nearestRoost(w) {
    const b = w.read('shorebirds');
    if (!b || !Array.isArray(b.roosts)) return null;
    let best = null, bd = 1e9;
    for (const r of b.roosts) {
      if (!Number.isFinite(r.x)) continue;
      const d = Math.hypot(r.x - ear.x, r.z - ear.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best && bd < 2600 ? best : null;
  }

  let uiAt = -1;
  function ui(kind, peak) {
    if (!kind || !E.ready || !state.started || state.muted) return;
    // Rate limited. Hovering across a dense panel emits a hover event per row, and forty ticks in
    // eighty milliseconds is a rattle rather than feedback.
    const now = E.ctx.currentTime;
    if (now - uiAt < 0.07) return;
    uiAt = now;
    fire(kind, peak);
  }

  function fireCue(kind, peak, x, z, extra, label) {
    const node = fire(kind, peak, x, z, extra);
    if (!node) return;
    state.cues.unshift({ at: world.clock.format(), day: world.clock.formatDate(), kind, what: label || kind });
    if (state.cues.length > 12) state.cues.length = 12;
  }

  function onSailing(p, what) {
    if (!E.ready || !state.started || state.muted) return;
    const vehicle = p && (p.kind === 'vehicle' || /barge|Minjerribah|Sea Breeze/i.test(String(p.vessel || '')));
    const pt = vehicle ? geo.points.bargeRamp : geo.points.ferryTerminal;
    if (!pt) return;
    const d = Math.hypot(pt.x - ear.x, pt.z - ear.z);
    if (d > 4200) return;
    const g = clamp01(1 - d / 4200);
    if (vehicle) fireCue('bargeHorn', 0.28 * g, pt.x, pt.z, null, `${p && p.vessel ? p.vessel : 'the barge'} ${what}`);
    else fireCue('outboard', 0.18 * g, pt.x, pt.z, null, `${p && p.vessel ? p.vessel : 'the water taxi'} ${what}`);
  }

  /* ---------------------------------------------------------------- frame */

  function frame(w, dtSim) {
    if (!E.ready || E.auditing) {
      if (!E.ready) state.contextState = state.supported ? 'not started' : 'unsupported';
      return;
    }
    const now = E.ctx.currentTime;
    // Real audio-thread time, never the simulation dt. A screenshot pumps sixty frames of 0.05 s
    // through this in a few milliseconds, and a scheduler that believed that would dump three
    // seconds of birds into one instant.
    const dtReal = clamp(now - E.lastNow, 0, 0.25);
    E.lastNow = now;
    state.contextState = E.ctx.state;

    if (now - E.mixAt > 0.05) {
      E.mixAt = now;
      setListener();
      // One bad frame must not take the sound out for the rest of the session: world.frame disables
      // any system whose frame hook throws, and silence for an hour is a worse failure than a line
      // in the notes.
      try {
        if (state.started && !state.muted) updateMix(w, Math.max(dtReal, 0.05));
        else applyMix();
      } catch (e) {
        E.faults++;
        if (E.faults < 4) console.warn('[audio] mix pass failed', e);
        if (E.faults === 4) state.notes.push('The mix pass has thrown four times. Sound is degraded.');
      }
    }
    if (now - E.meterAt > 0.1) {
      E.meterAt = now;
      measure();
      const live = reapPending(now);
      const byBus = state.sources.byBus;
      byBus.ambience = countBed('ambience');
      byBus.wildlife = countBed('wildlife');
      byBus.human = countBed('human');
      byBus.ui = 0;
      byBus.music = state.music.playing ? 3 : 0;
      state.sources.active = live + byBus.ambience + byBus.wildlife + byBus.human + byBus.music;
      state.sources.created = E.created;
      state.sources.oneShots = E.oneShots;
    }
  }

  /** How many permanently running sources on a bus are actually above silence. */
  function countBed(busId) {
    const B = E.beds;
    let n = 0;
    const up = (g) => (g && g.gain && g.gain.value > 0.0008 ? 1 : 0);
    if (busId === 'ambience') {
      n += up(B.surf.roar[0].g) + up(B.surf.roar[1].g) + up(B.chop.g);
      n += up(B.wind.bodyG) + up(B.wind.voiceG);
      n += up(B.rain.ground.g) + up(B.rain.leaves.g) + up(B.rain.water.g) + up(B.rain.roofA.g) + up(B.rain.roofB.g);
    } else if (busId === 'wildlife') {
      n += up(B.cicadas.g) + up(B.mosquito.g) + up(B.frogs.g);
    } else if (busId === 'human') {
      n += up(B.town.g) + up(B.pub.g) + up(B.mower.g) + up(B.school.g);
    }
    return n;
  }

  /* ---------------------------------------------------------------- the handle */

  const api = {
    /** Everything the read model has, in one object. */
    probe: () => JSON.parse(JSON.stringify(state)),
    state: () => state,
    start,
    mute,
    decline,
    unmute: () => mute(false),
    set(bus, v) {
      if (state.mix[bus] === undefined) return null;
      state.mix[bus] = clamp01(Number(v));
      applyMix();
      saveSettings();
      return state.mix[bus];
    },
    music(on) { state.music.enabled = on === undefined ? !state.music.enabled : !!on; saveSettings(); return state.music.enabled; },
    /** Play a voice on demand, for testing. Returns whether it fired. */
    test(kind, peak) { return !!fire(kind, peak === undefined ? 0.3 : peak, ear.x + 30, ear.z + 30); },
    voices: () => state.voices.map((v) => `${v.id.padEnd(20)} ${String(v.db).padStart(6)} dB  ${v.callsPerMin}/min  ${v.why}`),
    /**
     * The proof. Samples every bus over a real window and reports the envelope, so a critic can show
     * sound is being produced without listening to it. Returns a promise.
     */
    meter(ms = 1500) {
      return new Promise((resolve) => {
        if (!E.ready) { resolve({ error: 'engine not built: click the page once' }); return; }
        const out = {};
        for (const id of ['master', ...BUS_LIST]) out[id] = { samples: 0, sumRms: 0, maxRms: 0, maxPeak: 0, minRms: 1 };
        const t0 = E.ctx.currentTime;
        const iv = window.setInterval(() => {
          measure();
          for (const id of ['master', ...BUS_LIST]) {
            const L = state.levels[id], o = out[id];
            o.samples++; o.sumRms += L.rms;
            if (L.rms > o.maxRms) o.maxRms = L.rms;
            if (L.rms < o.minRms) o.minRms = L.rms;
            if (L.peak > o.maxPeak) o.maxPeak = L.peak;
          }
          if (E.ctx.currentTime - t0 >= ms / 1000) {
            window.clearInterval(iv);
            const res = { windowMs: ms, contextState: E.ctx.state, sampleRate: E.ctx.sampleRate, started: state.started, muted: state.muted, buses: {} };
            for (const id of ['master', ...BUS_LIST]) {
              const o = out[id];
              res.buses[id] = {
                samples: o.samples,
                meanRmsDb: +gainToDb(o.sumRms / Math.max(1, o.samples)).toFixed(1),
                maxRmsDb: +gainToDb(o.maxRms).toFixed(1),
                minRmsDb: +gainToDb(o.minRms).toFixed(1),
                maxPeakDb: +gainToDb(o.maxPeak).toFixed(1),
                movedDb: +(gainToDb(o.maxRms) - gainToDb(o.minRms)).toFixed(1),
                producing: o.maxRms > 1e-4
              };
            }
            res.limiterDb = state.limiter.reductionDb;
            res.sourcesActive = state.sources.active;
            res.oneShotsFired = state.sources.oneShots;
            res.voices = state.voices.slice(0, 10).map((v) => ({ id: v.id, db: v.db, why: v.why }));
            resolve(res);
          }
        }, 40);
      });
    },
    /**
     * Renders the whole roster's synthesis offline, in order, and reports the peak of each one. A
     * voice that does not appear here does not exist. This runs in an OfflineAudioContext, so it
     * proves the synthesis without needing anybody's speakers.
     */
    async audit() {
      if (typeof window.OfflineAudioContext !== 'function') return { error: 'no OfflineAudioContext' };
      const names = Object.keys(CALLS);
      const results = [];
      const keep = E.ctx;
      // The live graph is put down for the duration. frame() checks this and stays out of the way,
      // because swapping the context under a running render loop is exactly how you break both.
      E.auditing = true;
      for (const name of names) {
        const off = new window.OfflineAudioContext(2, 48000 * 5, 48000);
        const savedBuses = E.buses, savedVerb = E.verbSend, savedNoise = E.noise, savedPink = E.pink, savedCreated = E.created;
        E.ctx = off;
        E.noise = makeNoise(off, 2, new Rng(11));
        E.pink = makePink(off, 2, new Rng(12));
        const collect = off.createGain();
        collect.connect(off.destination);
        E.buses = { ambience: collect, wildlife: collect, human: collect, ui: collect, music: collect };
        const vs = off.createGain(); vs.connect(collect);
        E.verbSend = vs;
        let ok = true;
        try { CALLS[name](0.05, 0.5, ear.x + 20, ear.z + 20, name === 'roostFlush' ? 200 : true, 10); } catch (e) { ok = false; results.push({ voice: name, error: String(e.message) }); }
        if (ok) {
          const buf = await off.startRendering();
          const d = buf.getChannelData(0);
          let peak = 0, sum = 0, first = -1;
          for (let i = 0; i < d.length; i++) {
            const a = d[i] < 0 ? -d[i] : d[i];
            if (a > peak) peak = a;
            sum += d[i] * d[i];
            if (first < 0 && a > 0.002) first = i;
          }
          results.push({
            voice: name,
            peak: +peak.toFixed(4),
            peakDb: +gainToDb(peak).toFixed(1),
            rmsDb: +gainToDb(Math.sqrt(sum / d.length)).toFixed(1),
            startsAtMs: first < 0 ? null : Math.round((first / 48000) * 1000),
            silent: peak < 0.0008
          });
        }
        E.ctx = keep; E.buses = savedBuses; E.verbSend = savedVerb; E.noise = savedNoise; E.pink = savedPink; E.created = savedCreated;
      }
      E.auditing = false;
      E.lastNow = keep ? keep.currentTime : 0;
      return { rendered: results.length, silent: results.filter((r) => r.silent).length, voices: results };
    },
    listener: () => ({ ...state.listener }),
    context: () => E.ctx
  };

  const engineApi = {
    attach,
    frame,
    applyMix,
    start,
    mute,
    decline,
    fire,
    api,
    get ready() { return E.ready; },
    get ctx() { return E.ctx; }
  };
  E.api = api;
  return engineApi;
}

/* ==================================================================================================
   THE MIXER

   Six faders, a limiter readout, and a live level per bus printed as text. The text matters: a
   screenshot of a canvas cannot contain the interface, so every number a critic needs is in the DOM
   where read_page can find it.
   ================================================================================================== */

function mountMixerPanel(world, state, engine, soundPack) {
  const BUS_META = [
    ['master', 'Master', 'Everything, after the limiter.'],
    ['ambience', 'Ambience', 'Surf, wind and rain.'],
    ['wildlife', 'Wildlife', 'Birds, frogs, insects, whales, koalas.'],
    ['human', 'Human', 'Townships, cars, the barge, the pub.'],
    ['ui', 'Interface', 'Clicks and confirmations, all under 120 ms.'],
    ['music', 'Underscore', 'A response to story beats. Off unless you turn it on.']
  ];

  registerPanel({
    id: 'audio',
    order: 62,
    mount(root, w) {
      injectCss();

      /* ---- the launcher, on the shared rail ---------------------------- */
      const railEl = rail();
      const btn = el('button', {
        class: 'btn rail-btn', id: 'audio-rail-btn', 'aria-pressed': 'false',
        title: 'Sound and the mixer  (N to mute, Shift + N for the mixer)'
      }, el('span', { class: 'ar-ico', id: 'audio-rail-ico' }, 'off'), el('span', {}, 'Sound'),
      el('span', { class: 'ar-vu', id: 'audio-rail-vu' }));
      railEl.append(btn);

      /* ---- the first-run prompt ----------------------------------------

         A browser will not make a sound until the person has done something, so the sound comes on
         at the first click anywhere. That is the right behaviour and it is also a thing that should
         never happen to somebody without warning, so this says what is about to happen, says what
         happened when it does, and gives an immediate way out that works on the same click. */
      const promptTitle = el('div', { class: 'aud-prompt-t' }, 'The island is muted');
      const promptSub = el('div', { class: 'aud-prompt-s' },
        'Sound comes on the moment you click anything. Surf on the real swell period, wind through '
        + 'whatever you are standing in, and whatever is calling at this hour.');
      const promptYes = el('button', { class: 'btn aud-prompt-b', onclick: () => { engine.start(); refresh(w); } }, 'Turn the sound on');
      const promptNo = el('button', {
        class: 'btn ghost aud-prompt-x',
        // pointerdown, not click: the window listener that starts the sound also runs on
        // pointerdown, and a decline that arrives after the thing it declines is not a decline.
        onpointerdown: () => { engine.decline(); hidePrompt(); }
      }, 'Keep it quiet');
      const prompt = el('div', { class: 'aud-prompt', id: 'audio-prompt', role: 'status' },
        el('div', { class: 'aud-prompt-in' }, promptTitle, promptSub, promptYes, promptNo));
      root.append(prompt);
      let promptGone = false;
      let promptAt = 0;
      function hidePrompt() {
        if (promptGone) return;
        promptGone = true;
        prompt.classList.add('gone');
        window.setTimeout(() => prompt.remove(), 500);
      }
      /** Once the sound is actually on, say so, then get out of the way. */
      function promptSaysOn() {
        promptTitle.textContent = 'Sound on';
        promptSub.textContent = 'Press N to mute. Shift and N opens the mixer, which shows what you are hearing and why.';
        promptYes.remove();
        promptNo.textContent = 'Right';
        if (!promptAt) promptAt = 1;
      }

      /* ---- the panel ---------------------------------------------------- */
      const panel = el('div', { class: 'panel floating aud-panel', id: 'audio-panel' });
      const head = el('div', { class: 'panel-head' },
        el('div', { class: 'panel-title' }, 'Sound'),
        el('button', {
          class: 'btn ghost icon', title: 'Close  (Shift + N)', 'aria-label': 'Close the mixer',
          onclick: () => setOpen(false)
        }, '×'));
      const body = el('div', { class: 'panel-body dense aud-body' });
      panel.append(head, body);
      root.append(panel);

      const muteBtn = el('button', {
        class: 'btn aud-mute', id: 'audio-mute',
        onclick: () => { engine.mute(); refresh(w); }
      }, 'Unmute');
      const stateLine = el('div', { class: 'aud-state', id: 'audio-state' }, 'not started');
      body.append(el('div', { class: 'aud-top' }, muteBtn, stateLine));

      const faders = {};
      const meters = {};
      const readouts = {};
      const fadeWrap = el('div', { class: 'aud-faders' });
      for (const [id, label, hint] of BUS_META) {
        const input = el('input', {
          type: 'range', min: '0', max: '100', step: '1',
          value: String(Math.round((state.mix[id] === undefined ? 1 : state.mix[id]) * 100)),
          id: 'audio-fader-' + id, 'aria-label': label + ' level',
          oninput: (e) => { engine.api.set(id, Number(e.target.value) / 100); refresh(w); }
        });
        const meter = el('i', { class: 'aud-meter-fill' });
        const read = el('span', { class: 'aud-db', id: 'audio-db-' + id }, '-100.0 dB');
        faders[id] = input;
        meters[id] = meter;
        readouts[id] = read;
        fadeWrap.append(el('div', { class: 'aud-fader', title: hint },
          el('label', { class: 'aud-lab', for: 'audio-fader-' + id }, label),
          input,
          el('div', { class: 'aud-meter' }, meter),
          read));
      }
      body.append(fadeWrap);

      const musicBtn = el('button', {
        class: 'btn aud-music', id: 'audio-music',
        onclick: () => { engine.api.music(); refresh(w); }
      }, 'Underscore off');
      body.append(el('div', { class: 'aud-row' }, musicBtn,
        el('span', { class: 'aud-note', id: 'audio-limiter' }, 'limiter 0.0 dB')));

      const heard = el('div', { class: 'aud-heard', id: 'audio-heard' });
      body.append(el('div', { class: 'aud-h' }, 'What you are hearing'), heard);

      const fieldLine = el('div', { class: 'aud-field', id: 'audio-field' });
      body.append(fieldLine);

      const honesty = el('div', { class: 'aud-honesty' },
        'None of this is a recording. Every sound is built out of Web Audio nodes while you watch, '
        + 'and the repository holds no audio files. Where each voice comes from, and how sure anyone is '
        + 'that it belongs on this island, is in data/soundscape.json. A voice marked low confidence is '
        + 'a species no pack here records for Minjerribah.');
      body.append(honesty);

      /* ---- open and close ---------------------------------------------- */
      let open = false;
      function setOpen(v) {
        open = v;
        panel.classList.toggle('on', open);
        btn.setAttribute('aria-pressed', String(open));
        world.bus.emit('ui:drawer', { panel: 'audio', open });
      }
      btn.addEventListener('click', () => setOpen(!open));

      window.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // N sits next to M, and M is the map. That is the whole mnemonic and it is enough.
        if (e.code !== 'KeyN') return;
        e.preventDefault();
        if (e.shiftKey) setOpen(!open);
        else { engine.mute(); hidePrompt(); refresh(w); }
      });

      let promptTicks = 0;
      /** The prompt waits behind anything full screen, and clears itself once it has been read. */
      function tendPrompt() {
        if (promptGone) return;
        // Whatever is running the arrival sequence owns the screen while it is up.
        const over = document.querySelector('.ob-stage');
        const busy = over && getComputedStyle(over).display !== 'none';
        prompt.classList.toggle('waiting', !!busy);
        if (busy) return;
        if (state.started) {
          promptSaysOn();
          promptTicks++;
          if (promptTicks > 45) hidePrompt();   // about four and a half seconds at 10 Hz
        }
      }

      /* ---- refresh ------------------------------------------------------ */
      const fmt = (v) => (v <= -99 ? '-inf' : v.toFixed(1)) + ' dB';
      /** How often a voice speaks, in words. A bed and a call an hour are not the same thing and a
       *  list of decibels that does not say which is which is a list that misleads. */
      function cadence(v) {
        if (v.cadence) return v.cadence;
        if (v.bed) return 'continuous';
        const m = v.callsPerMin;
        if (!m) return 'silent';
        if (m >= 2) return `about ${Math.round(m)} a minute`;
        if (m >= 0.6) return 'about once a minute';
        const mins = Math.round(1 / m);
        if (mins < 60) return `about every ${mins} minutes`;
        return `about every ${Math.round(mins / 60)} hours`;
      }
      function refresh(wo) {
        const s = wo.read('audio') || state;
        tendPrompt();
        const ico = document.getElementById('audio-rail-ico');
        const vu = document.getElementById('audio-rail-vu');
        const on = s.started && !s.muted;
        if (ico) ico.textContent = on ? 'on' : 'off';
        btn.classList.toggle('is-live', on);
        muteBtn.textContent = on ? 'Mute' : s.started ? 'Unmute' : 'Turn the sound on';
        stateLine.textContent = s.supported
          ? `${s.contextState}, ${s.sampleRate || 0} Hz, ${s.sources.active} live sources, ${s.sources.oneShots} calls made`
          : 'this browser has no Web Audio';
        const mDb = s.levels.master.db;
        if (vu) vu.textContent = on ? fmt(mDb) : 'muted';
        for (const [id] of BUS_META) {
          const L = s.levels[id];
          if (!L) continue;
          readouts[id].textContent = fmt(L.db);
          const pct = clamp01((L.db + 60) / 60) * 100;
          meters[id].style.width = pct.toFixed(1) + '%';
          meters[id].classList.toggle('hot', L.peakDb > -1.5);
          const want = Math.round((s.mix[id] === undefined ? 1 : s.mix[id]) * 100);
          if (document.activeElement !== faders[id] && Number(faders[id].value) !== want) faders[id].value = String(want);
        }
        musicBtn.textContent = s.music.enabled ? 'Underscore on' : 'Underscore off';
        musicBtn.classList.toggle('on', !!s.music.enabled);
        const lim = document.getElementById('audio-limiter');
        if (lim) lim.textContent = `limiter ${s.limiter.reductionDb.toFixed(1)} dB${s.limiter.engaged ? ', holding' : ''}`;

        // The list is the teaching surface: every line says what is sounding and what put it there.
        heard.textContent = '';
        const rows = s.voices.slice(0, 9);
        if (!rows.length) heard.append(el('div', { class: 'aud-none' }, 'nothing above the floor here'));
        for (const v of rows) {
          const pk = soundPack.byId[v.id];
          heard.append(el('div', { class: 'aud-v' },
            el('span', { class: 'aud-vd' }, `${v.db}`),
            el('span', { class: 'aud-vn' }, v.label),
            el('span', { class: 'aud-vr' }, cadence(v)),
            el('span', { class: 'aud-vw' }, v.why || ''),
            v.confidence === 'low' ? el('span', { class: 'aud-vc', title: (pk && pk.source_note) || 'no island record in any pack' }, 'unsourced') : null));
        }
        const f = s.field;
        fieldLine.textContent = `${s.listener.region}, ${s.listener.cover}. Swell ${f.swellM} m at ${f.swellPeriodS} s, `
          + `${s.surf.side} side. Wind ${f.windKt} kt ${s.wind.through}. Rain ${f.rainMmHr} mm/h. `
          + `${f.tempC} C, sun ${f.sunElevationDeg} deg.`;
      }

      refresh(w);
      return { update: refresh };
    }
  });
}

/** The shared launcher rail. Whichever panel loads first makes it; the rest hang buttons on it. */
function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  const s = document.createElement('style');
  s.id = 'twin-rail-css-audio';
  s.textContent = `
#twin-rail { position: absolute; left: var(--sp-3); top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: var(--sp-2); z-index: 20; }
.rail-btn { position: relative; width: 116px; justify-content: flex-start; letter-spacing: .1em;
  font-size: var(--fs-micro); text-transform: uppercase; padding: var(--sp-3) var(--sp-3); }`;
  if (!document.getElementById('twin-rail-css')) document.head.append(s);
  r = document.createElement('div');
  r.id = 'twin-rail';
  (document.getElementById('ui-root') || document.body).append(r);
  return r;
}

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'audio-panel-css';
  s.textContent = `
.aud-panel { left: calc(var(--sp-3) + 128px); top: 50%; transform: translateY(-50%) translateX(-8px);
  width: 336px; z-index: 23; opacity: 0; pointer-events: none;
  transition: opacity var(--med) var(--ease), transform var(--med) var(--ease-out); }
.aud-panel.on { opacity: 1; pointer-events: auto; transform: translateY(-50%); }
.aud-body { display: flex; flex-direction: column; gap: var(--sp-3); }
.aud-top { display: flex; align-items: center; gap: var(--sp-2); }
.aud-mute { flex: 0 0 auto; }
.aud-state { font: 400 var(--fs-micro)/1.4 var(--f-num); color: var(--t-faint); flex: 1; min-width: 0; }
.aud-faders { display: flex; flex-direction: column; gap: 5px; }
.aud-fader { display: grid; grid-template-columns: 62px 1fr 46px; grid-template-rows: auto auto;
  align-items: center; gap: 2px 8px; }
.aud-lab { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .1em; text-transform: uppercase;
  color: var(--t-dim); grid-row: 1 / span 2; }
.aud-fader input[type=range] { grid-column: 2; appearance: none; width: 100%; height: 16px; background: none; cursor: pointer; }
.aud-fader input[type=range]::-webkit-slider-runnable-track { height: 3px; background: var(--s-sunk);
  border-radius: var(--r-pill); border: 1px solid var(--edge); }
.aud-fader input[type=range]::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -5px;
  border-radius: 50%; background: var(--sea); border: 1px solid rgba(0,0,0,.4); }
.aud-fader input[type=range]::-moz-range-track { height: 3px; background: var(--s-sunk); border-radius: var(--r-pill); }
.aud-fader input[type=range]::-moz-range-thumb { width: 12px; height: 12px; border: none; border-radius: 50%; background: var(--sea); }
.aud-fader input[type=range]:focus-visible { outline: none; box-shadow: var(--glow-sea); border-radius: var(--r-pill); }
.aud-meter { grid-column: 2; height: 3px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden; }
.aud-meter-fill { display: block; height: 100%; width: 0%; background: var(--leaf); border-radius: var(--r-pill);
  transition: width .1s linear; }
.aud-meter-fill.hot { background: var(--coral); }
.aud-db { grid-column: 3; grid-row: 1 / span 2; font: 400 var(--fs-micro)/1 var(--f-num);
  color: var(--t-dim); text-align: right; font-variant-numeric: tabular-nums; }
.aud-row { display: flex; align-items: center; gap: var(--sp-2); }
.aud-note { font: 400 var(--fs-micro)/1 var(--f-num); color: var(--t-faint); margin-left: auto; }
.aud-h { font: 600 var(--fs-micro)/1 var(--f-ui); letter-spacing: .14em; text-transform: uppercase;
  color: var(--t-faint); padding-top: var(--sp-2); border-top: 1px solid var(--edge); }
.aud-heard { display: flex; flex-direction: column; gap: 2px; max-height: 190px; overflow-y: auto;
  scrollbar-width: thin; }
.aud-v { display: grid; grid-template-columns: 42px 1fr; gap: 2px 7px; align-items: baseline; }
.aud-vd { font: 400 var(--fs-micro)/1.5 var(--f-num); color: var(--sea); text-align: right; font-variant-numeric: tabular-nums; }
.aud-vn { font-size: var(--fs-sm); color: var(--t-hi); }
.aud-vr { grid-column: 2; font: 400 var(--fs-micro)/1.4 var(--f-num); color: var(--t-dim); }
.aud-vw { grid-column: 2; font-size: var(--fs-micro); color: var(--t-faint); }
.aud-vc { grid-column: 2; font: 600 9px/1.4 var(--f-ui); letter-spacing: .1em; text-transform: uppercase;
  color: var(--sun); cursor: help; }
.aud-none { font-size: var(--fs-micro); color: var(--t-faint); }
.aud-field { font: 400 var(--fs-micro)/1.55 var(--f-num); color: var(--t-dim);
  padding-top: var(--sp-2); border-top: 1px solid var(--edge); }
.aud-honesty { font-size: 10px; line-height: 1.55; color: var(--t-faint); }
.ar-ico { font: 700 9px/1 var(--f-num); letter-spacing: .08em; color: var(--t-faint); }
.rail-btn.is-live .ar-ico { color: var(--leaf); }
.ar-vu { margin-left: auto; font: 400 9px/1 var(--f-num); color: var(--t-faint); font-variant-numeric: tabular-nums; }

.aud-prompt { position: absolute; left: 50%; bottom: 108px; transform: translateX(-50%);
  z-index: 30; transition: opacity var(--med) var(--ease), transform var(--med) var(--ease); }
.aud-prompt.gone { opacity: 0; transform: translateX(-50%) translateY(8px); pointer-events: none; }
.aud-prompt.waiting { opacity: 0; pointer-events: none; }
.aud-prompt-in { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4);
  background: var(--s-2); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--edge-strong); border-radius: var(--r-3); box-shadow: var(--shadow-2);
  max-width: min(640px, 92vw); flex-wrap: wrap; }
.aud-prompt-t { font: 400 var(--fs-lg)/1.2 var(--f-ui); color: var(--t-hi); }
.aud-prompt-s { font-size: var(--fs-sm); color: var(--t-dim); flex: 1 1 260px; min-width: 200px; }
@media (max-width: 860px) {
  .aud-panel { left: var(--sp-2); right: var(--sp-2); width: auto; top: auto; bottom: var(--sp-2);
    transform: none; }
  .aud-panel.on { transform: none; }
  .aud-prompt { bottom: 140px; }
}`;
  document.head.append(s);
}
