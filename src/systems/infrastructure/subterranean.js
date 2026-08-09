// The subterranean eco city: the works below the sand, simulated as a production graph.
//
// ============================================================================================
// READ THIS FIRST. NONE OF THIS EXISTS.
//
// data/subterranean.json marks every one of its forty-three buildings `existence: "proposed"`.
// Not one of them is on the island. Not one is approved, funded, sited, surveyed or consented.
// This file simulates a design being tested in a twin, and every number it publishes carries
// that word. If a screenshot of this system could be mistaken for a facility on Minjerribah,
// this file has failed at its first job, whatever the throughput looks like.
//
// Minjerribah is Quandamooka Country. On 4 July 2011 the Federal Court made two consent
// determinations recognising Quandamooka native title, and the Traditional Natural Resources
// named in that determination expressly include any clay, soil, sand, ochre, gravel or rock on
// or below the surface. The sand itself is named. Every excavation concept below would require
// Traditional Owner consent, sought again at each stage and never carried over, and nothing in
// this simulation is allowed to model that decision as a meter that fills up. See `GATES`.
//
// ============================================================================================
// WHOSE DESIGN THIS IS
//
// The pack's own words: "This is Luke Nathan Hayes' own long running design, read out of his
// repos and turned into a machine readable graph." The material stack, the maker loop, the
// spoil-becomes-supply rule, the C-hour, the aquifer-first rule and the honest labelling are
// all his. This file adds no process, no resource, no building and no rate. It reads the graph
// and runs it. Where the graph has a hole, this file names the hole rather than filling it:
// see `state.unsourcedInputs`, which lists ten inputs the pack consumes and never produces,
// only eight of which the pack's own `imports_that_never_close` list names.
//
// WHAT THIS FILE ADDS, so it can be told apart from the pack:
//   * Siting. The pack has no coordinates. The corridor, the shaft and the surface hub below
//     are this project's, placed on real named ground (Ballow Road, Dunwich) and tested
//     against the real Naree Budjong Djara National Park outline in data/geography.json.
//     They are a candidate line on a map, not a route. `state.siting.basis` says so.
//   * The freshwater lens surface. Modelled, calibrated to the one published number available:
//     Blue Lake is a window lake at 72 m, which means the island water table surfaces there.
//     Everything else about the lens is what tier one exists to find out.
//   * Conveyance. The pack gives rates; it does not give belts. The trunk in a two metre bore
//     is finite and this file makes it finite, because a bottleneck you cannot see is not a
//     game, it is a spreadsheet.
//   * The thermal cascade as a running staircase with a ground sink, because underground there
//     is no sky to throw heat at, and heat that has nowhere to go warms the sand you are
//     standing in until the machines derate. That consequence is the pack's design read
//     forward, not a new idea.
//
// ============================================================================================
// THE THREE NUMBERS ON THE PANEL, in the pack's own words:
//
//   "The three numbers to put on the panel are the connected load against generation, the
//    orphan stream total, and the residual to landfill. If those three are getting worse, the
//    city is not working, however good the throughput looks."
//
// And the sting the pack computed rather than asserted: building every process to tier three
// puts about 2,478 kW of connected load under the sand, roughly 23,792 kWh a day at forty per
// cent utilisation, against an island estimated at 30,000 and rooftops that could carry about
// 19,000. The generation described inside the pack is 54 kW. "A player who rushes the carbon
// furnace hall should black out the island. That is the intended lesson and it should be
// enforced, not softened." It is enforced here. See `loadDiscipline`.
//
// ============================================================================================
// WHERE IT STARTS
//
// Tier one is the only rung that needs nobody's permission but the landholder's: a repair
// bench, a tip triage bay, a cullet crusher, a shredder, a compost windrow, a retort, rooftop
// panels, a material passport and an open groundwater model. So the twin runs the tier one
// proposal by default and everything below the sand sits behind consent that has not been
// sought. Run a year and the honest answer comes back: the surface loop diverts real tonnage
// and the excavation has not started, because the decision is not the player's to make.
//
// A player who wants to see the rest runs a scenario. `world.subterranean.scenario('consent-
// given')` marks the community gates `assumed-in-scenario`, which is the only label they can
// ever carry, and `scenario('consent-refused')` runs the branch where the answer is no. The
// pack: "If the answer is no, or not here, or not yet, that is the answer and it is a good one
// to hear." Both branches are first class and the refused one is worth playing.
//
// Determinism: world.rng.stream('subterranean'). No Math.random, no Date.now.

import {
  clamp, lerp, smoothstep, levers, nudge, crossing, servedPopulation,
  aud, Rolling, EventLog, DailyRing, TICK_HOURS, absDay, BASIS
} from './infra-common.js';

/* ------------------------------------------------------------------ time and scale */

const TICK_MIN = 10;                 // one sim tick is ten sim-minutes
const TICKS_PER_DAY = 144;
const MIN_PER_DAY = 1440;

/* ------------------------------------------------------------------ conveyance

The pack rates every process in kilograms a minute and says nothing about how the kilograms
get from one machine to the next. Underground they get there in a two metre bore, and a two
metre bore holds a finite number of belts, pipes and rails. That finiteness is the whole
logistics game: in Satisfactory the belt is the puzzle, and the equivalent here is that the
island's entire material economy has to fit down one hole.

Per-lane capacities are modelled. They are chosen against the pack's own extremes so that the
early game works on one lane and the heavy flows visibly do not: dune nourishment moves 200 kg
a minute of spoil sand and the desalination hall drinks 198 kg a minute of seawater, and
neither fits on one Mk1 anything. That is the intended lesson, the same way a Mk1 belt in
front of a smelter is. */

const CONVEYANCE = {
  belt:    { id: 'belt',    label: 'belt',            perLane: [60, 130, 270],  tierOf: [2, 3, 4] },
  pipe:    { id: 'pipe',    label: 'pipe',            perLane: [150, 400, 900], tierOf: [2, 3, 4] },
  slurry:  { id: 'slurry',  label: 'slurry line',     perLane: [90, 220, 480],  tierOf: [2, 3, 4] },
  gas:     { id: 'gas',     label: 'gas main',        perLane: [40, 110, 260],  tierOf: [2, 3, 4] },
  haulage: { id: 'haulage', label: 'haulage',         perLane: [300, 300, 300], tierOf: [1, 1, 1] },
  hand:    { id: 'hand',    label: 'hand and barrow', perLane: [12, 12, 12],    tierOf: [1, 1, 1] }
};

/** Which way a resource travels. Read off the pack's own classes and names, not invented. */
function conveyanceFor(id, res) {
  if (/slurry|spoil-slurry/.test(id)) return CONVEYANCE.slurry;
  if (/^(seawater|brine|spent-brine|fresh-water|process-water|pore-water|wash-water-loss|groundwater-lens|pyrolysis-water)$/.test(id)) return CONVEYANCE.pipe;
  if (/acid|liquor|sodium-hydroxide|sodium-silicate|methanol|bio-oil|pyrolysis-oil|extractant|tetrachloride|copperas/.test(id)) return CONVEYANCE.pipe;
  if (/^(air|oxygen|nitrogen-gas|hydrogen|chlorine|carbon-dioxide|carbon-monoxide|syngas|water-vapour|trace-gases|argon|volatiles|binder-burnout-gas|methyl-chloride|sulfur-dioxide|sulfur-trioxide)$/.test(id)) return CONVEYANCE.gas;
  if (id === 'liquid-nitrogen') return CONVEYANCE.pipe;
  if (/^(placed-dune-sand|reef-module|placed-lining-block|in-situ-saturated-sand|dune-sand|mixed-tip-waste|green-waste|timber-waste|geopolymer-block)$/.test(id)) return CONVEYANCE.haulage;
  if (res && (res.class === 'record')) return CONVEYANCE.hand;
  return CONVEYANCE.belt;
}

/** The trunk in the bore. Everything between the surface and the works shares it. Modelled. */
const TRUNK = {
  solidsPerLane: 260,     // kg/min on one belt lane in the corridor
  fluidsPerLane: 700,     // kg/min on one pipe run
  maxSolidLanes: 4,       // a two metre bore with a walkway holds about this many, modelled
  maxFluidLanes: 6,
  note: 'The corridor trunk is modelled. data/subterranean.json rates the processes and does '
    + 'not describe the conveyance. A two metre logistics bore is the pack\'s own tier two '
    + 'size; how many belts and pipes fit down it beside a walkway and a services duct is this '
    + 'project\'s estimate and is the number to argue with first.'
};

/* ------------------------------------------------------------------ the thermal staircase

The pack's own five steps, with the grade bands it publishes. Heat only ever flows one way, so
this is a staircase and not a circle, and the pack says calling it a loop would be the
dishonest move. Each step takes what the step above had finished with. What reaches the bottom
and finds no customer has to go somewhere, and underground there is no sky.

Delivery efficiency is the pack's own: waste-heat-cascade collects 900 kW thermal and delivers
720, which is 0.8. Nothing is delivered at all without the thermal plant room built, because
without it the pipework does not exist and the heat simply leaves. */

const HEAT_BUSES = [
  { id: 'flame',   label: '1,000 to 1,700 C', minC: 1000, maxC: 2000 },
  { id: 'furnace', label: '700 to 1,000 C',   minC: 700,  maxC: 1000 },
  { id: 'kiln',    label: '400 to 700 C',     minC: 400,  maxC: 700 },
  { id: 'steam',   label: '90 to 250 C',      minC: 90,   maxC: 400 },
  { id: 'warm',    label: '30 to 90 C',       minC: 0,    maxC: 90 }
];
const CASCADE_DELIVERY = 0.8;

/**
 * The ground the heat ends up in. Sand: about 830 J/kg/K, 1,600 kg/m3 dry. The rejection field
 * is the block of sand around the works that the ground loops reach into. Both numbers are
 * modelled and both are stated, because the equilibrium temperature of the works follows
 * directly from them and a player is entitled to argue with the assumption rather than the
 * result.
 */
const GROUND = {
  rejectionFieldM3: 120000,        // modelled: the sand the ground loops reach
  specificHeatJPerKgK: 830,        // dry quartz sand, textbook
  densityKgM3: 1600,
  ambientC: 20.5,                  // mean annual ground temperature at depth on this coast
  loopUaKwPerK: 26,                // modelled: what the ground loops shift per kelvin of lift
  seaLoopUaKwPerK: 44,             // a seawater-cooled loop, once the desalination intake exists
  derateStartK: 8,                 // above this much lift, machines start losing efficiency
  derateFullK: 30,                 // and at this much lift they are down to the floor
  derateFloor: 0.40,
  occupiedLimitK: 12,              // the living corridor is not a workplace above this
  note: 'The rejection field volume and the ground loop conductance are modelled. Neither is '
    + 'published anywhere. They set the temperature the works settle at, so they are the first '
    + 'two numbers to replace with real ones.'
};
GROUND.capacityKwhPerK = (GROUND.rejectionFieldM3 * GROUND.densityKgM3 * GROUND.specificHeatJPerKgK) / 3.6e6;

/* ------------------------------------------------------------------ the freshwater lens

The island's fresh water floats in a lens beneath the sand and that lens is the whole reason
people can live here. The pack is unambiguous about the order of work: "The first build in this
pack is not a machine, it is an open groundwater model. Nothing excavates until the twin exists,
the community owns it, and it says the lens is safe."

The surface below is a modelled subdued replica of the topography, calibrated to the single
published control available: Blue Lake is a window lake, which means the water table surfaces
there, and data/geography.json publishes its level as 72 m. Everything else about this lens,
its shape, its gradient, its response time, its salt interface, is exactly what tier one exists
to measure. That is not a weakness in the model; it is the model saying what it does not know,
which is the only thing an aquifer twin is for. */

const LENS = {
  controlLevelM: 72,          // Blue Lake, published, a window lake
  controlShoreDistM: 2504,    // that lake's distance to the nearest coast in this heightfield
  exponent: 0.62,             // modelled: the shape of an unconfined lens between coast and crest
  minCoverM: 1.5,             // the table sits at least this far below the ground surface
  ghybenHerzberg: 40,         // metres of fresh below sea level per metre above it, textbook
  agreedBandMm: 40,           // the drawdown band beyond which every excavation halts
  recoveryHalfLifeDays: 120,  // modelled: how fast the lens comes back when pumping stops
  basis: 'Modelled. Calibrated to one published point: Blue Lake (Kaboora) is recorded in '
    + 'data/geography.json as a window lake with a surface at 72 m, which is the island water '
    + 'table showing itself. No lens survey for Minjerribah was found in any pack read here.'
};

/* ------------------------------------------------------------------ siting

The pack carries no coordinates, so these are this project's and are labelled as this
project's everywhere they surface. They are placed on real named ground out of
data/geography.json and data/places.json, and every one of them is tested against the real
Naree Budjong Djara National Park outline before it is allowed to exist.

Ballow Road is a real street in Dunwich (Goompi) and the pack itself names the Ballow Road hub
as a candidate for the surface bench: "The Ballow Road hub and the maker-space proposal are the
named candidates in Luke's own repos." The pack's own provenance note for that repo is also
recorded here, because it is the honest half of the sentence: the ballow-road-sand-screen-hub
repo carries "the explicit note that Sandworm-style subterranean systems are long range
research, not a promise to dig under Ballow Road." Nothing here is a promise to dig anywhere. */

const SITING = {
  hub: { id: 'ballow-road-hub', label: 'Ballow Road hub, Dunwich (Goompi)', lon: 153.4048, lat: -27.5016 },
  tip: { id: 'waste-centre', label: 'Beside the recycling and waste centre', lon: 153.4060, lat: -27.4930 },
  shaft: { id: 'jacking-pit', label: 'Drive shaft and jacking pit', lon: 153.4085, lat: -27.5044 },
  shore: { id: 'bay-frontage', label: 'Bay frontage south of the barge ramp', lon: 153.3985, lat: -27.5030 },
  /** The candidate corridor: east-south-east, inland, under the dune, away from the park. */
  corridorBearingDeg: 111,
  corridorLengthM: 2400,
  basis: 'Siting is this project\'s, not the pack\'s. data/subterranean.json carries no '
    + 'coordinates. Every point is on ground named in data/geography.json, is tested against '
    + 'the Naree Budjong Djara National Park outline in that pack, and is a candidate for '
    + 'discussion rather than a route. The park outline itself is indicative.'
};

/* ------------------------------------------------------------------ the reality gates

The pack's twelve gates, kept in its order and its words, with the one thing this file adds:
how each is tested. Three kinds:

  computed      the twin can answer this itself, honestly, from geometry or arithmetic
  regulated     a published process with published criteria, so it can be modelled as one
  not-ours      a decision held by the Quandamooka People or by the island community

The third kind is never modelled as an outcome. This twin does not predict what the Quandamooka
People would decide and does not put a probability on it. What it does is show what would have
to be true before the question could honestly be asked, and let a player run both branches with
the answer marked `assumed-in-scenario` so that nobody, ever, reads a screenshot of this and
thinks consent was given. */

const GATE_KIND = { computed: 'computed', regulated: 'regulated', notOurs: 'not-ours' };

const GATES = [
  { id: 'traditional-owner-consent', kind: GATE_KIND.notOurs, order: 1,
    name: 'Traditional Owner consent', heldBy: 'The Quandamooka People, through QYAC',
    note: 'Not a permit to be obtained. A relationship, and a right to refuse. Sought again for each stage, not carried over.' },
  { id: 'sea-country-consent', kind: GATE_KIND.notOurs, order: 2,
    name: 'Sea Country consent', heldBy: 'The Quandamooka People, through QYAC',
    note: 'Anything in the water or on the shore. Reefs, shoreline work, wave devices, placed sand.' },
  { id: 'cultural-heritage-clearance', kind: GATE_KIND.notOurs, order: 3,
    name: 'Cultural heritage clearance', heldBy: 'Traditional Owners and the state cultural heritage process',
    note: 'No excavation is sited on or near a place of cultural significance. Where that cannot be established, the answer is no.' },
  { id: 'community-vote', kind: GATE_KIND.notOurs, order: 4,
    name: 'Community vote', heldBy: 'The island community',
    note: 'Held with full information and a real option to refuse. A vote you cannot lose is not a vote.' },
  { id: 'aquifer-twin-pass', kind: GATE_KIND.computed, order: 5,
    name: 'Aquifer twin pass', heldBy: 'The community, through an open model of the freshwater lens',
    note: 'The lens comes before the tunnel, first and every time. You cannot negotiate what you cannot see.' },
  { id: 'national-park-exclusion', kind: GATE_KIND.computed, order: 6,
    name: 'National park exclusion', heldBy: 'Naree Budjong Djara joint management',
    note: 'More than half the island. Nothing here goes there.' },
  { id: 'mining-law', kind: GATE_KIND.computed, order: 7,
    name: 'Mining ended by law', heldBy: 'North Stradbroke Island Protection and Sustainability Act 2011',
    note: 'Operations ceased 2019. This pack is not a mining proposal and does not want to be one.' },
  { id: 'nuclear-prohibition-note', kind: GATE_KIND.computed, order: 8,
    name: 'Nuclear prohibition', heldBy: 'EPBC Act 1999 s140A and ARPANS Act 1998 s10',
    note: 'Federal law prohibits nuclear power installations. This pack contains no reactor. The thorium is banked in glass and stewarded, not burned.' },
  { id: 'radiation-licence', kind: GATE_KIND.regulated, order: 9,
    name: 'Radiation management licence', heldBy: 'Queensland radiation safety regulation and ARPANSA guidance',
    note: 'The moment monazite is concentrated this is a licensed radiation workplace: monitored workers, contained dust, a plan for the whole decay chain.' },
  { id: 'engineering-certification', kind: GATE_KIND.regulated, order: 10,
    name: 'Engineering certification', heldBy: 'Registered professional engineers of Queensland',
    note: 'Occupied underground space, ventilation, egress, fire, structural.' },
  { id: 'coastal-management-approval', kind: GATE_KIND.regulated, order: 11,
    name: 'Coastal management approval', heldBy: 'Queensland coastal management and Redland City Council',
    note: 'Shoreline works, erosion control, placed sand.' },
  { id: 'marine-ecology-review', kind: GATE_KIND.regulated, order: 12,
    name: 'Marine ecology review', heldBy: 'Independent review before anything enters the water',
    note: 'No blade a living thing can reach. Noise, sediment, turtles, dugong, dolphins.' }
];

/** Modelled elapsed time for the processes that genuinely are processes. Days. */
const REGULATED_DAYS = {
  'radiation-licence': 240,
  'engineering-certification': 180,
  'coastal-management-approval': 300,
  'marine-ecology-review': 210
};

/* ------------------------------------------------------------------ where a stream ends up

The pack's tier three completion test is "the zero waste audit shows every named stream with a
destination, and the orphan list is shorter than it was when the tier opened". So this file
builds that audit rather than describing it. Every resource with no consumer inside the graph
gets a destination out of this table, and anything the pack itself lists as an orphan gets the
destination `no fate`, which means it accumulates until its store is full and then stalls the
machine making it. That is not a punishment. It is the pack's own honesty rendered as a
mechanic: a stream with nowhere to go stops the line, and the line stopping is the argument. */

const SINK = {
  bargeExport: 'barge-export',
  seaDischarge: 'sea-discharge',
  placedOnIsland: 'placed-on-island',
  usedInWorks: 'used-in-works',
  vented: 'vented',
  storedForever: 'stored-and-monitored',
  noFate: 'no-fate'
};

const VENTED = new Set(['water-vapour', 'trace-gases', 'binder-burnout-gas', 'volatiles', 'organic-dust']);
const PLACED = new Set(['placed-dune-sand', 'reef-module', 'placed-lining-block', 'paver-tile', 'fused-quartz-liner']);
const SEA = new Set(['spent-brine', 'wash-water-loss', 'process-water']);
const WORKS = new Set(['working-goods', 'compost', 'mycelium-panel', 'silica-aerogel', 'silicone-rubber',
  'bio-oil', 'pyrolysis-oil', 'biochar', 'residual-quartz', 'glass-product', 'baled-steel', 'copper-feed']);

/* ------------------------------------------------------------------ imports

Nothing arrives on this island except by boat. data/transport.json publishes it as the hardest
constraint in the world and infra-common exposes the deck. So an import is not a number that
appears: it is a pallet on a barge that competes for lane metres with everybody's caravan, and
a gale that stops the barge stops the polysilicon plant a fortnight later. */

const IMPORT_LEAD_DAYS = 9;
const IMPORT_COVER_DAYS = 21;         // how much cover the works try to hold
const IMPORT_A$_PER_KG = {            // modelled order of magnitude, freight included
  'soda-ash-imported': 1.1, 'silver-paste': 1400, 'ferroboron': 14, 'encapsulant-polymer': 9,
  'organic-extractant': 26, 'borosilicate-frit': 6, 'raw-kaolin-clay': 0.9, 'junction-parts': 22,
  'limestone-or-shell': 0.5, 'ceramic-binder': 18, 'nutrient-salts': 4, 'mycelium-spawn': 12,
  flux: 5, 'calcium-reductant': 11, 'fungal-organic-acid': 30, 'geopolymer-binder': 1.4,
  'crushed-shell': 0.6, 'harvested-parts': 3
};
const IMPORT_DEFAULT_A$_PER_KG = 4;

/** The pack's own list of imports it says never close. Anything else this file finds is new. */
const PACK_NAMED_IMPORTS = new Set(['soda-ash-imported', 'raw-kaolin-clay', 'silver-paste',
  'ferroboron', 'encapsulant-polymer', 'organic-extractant', 'borosilicate-frit', 'elemental-sulfur']);

/* ------------------------------------------------------------------ small maths */

const round = (v, n = 1) => { const p = Math.pow(10, n); return Math.round((v || 0) * p) / p; };
const kg = (v) => (Math.abs(v) >= 1000 ? round(v / 1000, 1) + ' t' : Math.round(v) + ' kg');

/** Even-odd point in polygon, on the projected rings island.js already holds. */
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const zi = poly[i][1], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((poly[j][0] - poly[i][0]) * (z - zi)) / (zj - zi) + poly[i][0]) inside = !inside;
  }
  return inside;
}

/* ================================================================== the system */

export function registerSubterranean(world) {
  const rng = world.rng.stream('subterranean');
  const L = levers(world);
  const log = new EventLog(40);
  const decisions = new EventLog(24);      // what the works manager did and why

  const pack = (world.data && world.data.subterranean) || null;

  const state = world.publish('subterranean', {
    ready: false,

    /* ---- the label that never comes off ---- */
    existence: 'proposed',
    headline: 'PROPOSED. None of this exists on Minjerribah.',
    whatThisIs: 'A production graph from data/subterranean.json, run in a twin. Every one of '
      + 'the forty-three buildings in that pack is marked "proposed". Nothing below the sand is '
      + 'built, approved, funded, sited or consented, and no part of this read model may be '
      + 'presented as a facility on the island.',
    country: 'Minjerribah is Quandamooka Country. Every excavation concept here would require '
      + 'Traditional Owner consent, sought again at each stage and never carried over. QYAC is '
      + 'the public doorway for land and sea decisions. This twin does not model that decision '
      + 'and does not put a number on it.',
    notAMiningProposal: 'Mineral sand mining on this island was ended by the North Stradbroke '
      + 'Island Protection and Sustainability Act 2011 and the last mine closed in 2019. This is '
      + 'not a proposal to restart it and does not want to be one.',
    source: 'data/subterranean.json',
    packVersion: pack ? pack.version : null,

    /* ---- the three numbers the pack says to put on the panel ---- */
    connectedLoadKw: 0,
    generationKw: 0,
    orphanKg: 0,
    residualToLandfillKg: 0,

    /* ---- what power.js reads ---- */
    utilisation: 0,
    drawKw: 0,

    /* ---- the tech tree ---- */
    tier: 1,
    tierName: '',
    tierSummary: '',
    nextTier: null,
    tiers: [],

    /* ---- consent and the gates ---- */
    gates: {},
    scenario: 'as-it-stands',
    scenarioNote: '',
    blockedBy: [],

    /* ---- the works ---- */
    buildings: [],
    machines: [],
    lines: [],
    trunk: { solidLanes: 1, fluidLanes: 1, solidKgMin: 0, fluidKgMin: 0, solidPct: 0, fluidPct: 0, note: TRUNK.note },
    bottleneck: null,
    running: 0, stalled: 0, tripped: 0, built: 0, proposed: 0,

    /* ---- material ---- */
    stock: {},
    flowsKgPerDay: {},
    orphans: [],
    unsourcedInputs: [],
    zeroWasteAudit: null,
    massBalanceKgPerDay: 0,

    /* ---- energy ---- */
    power: { demandKw: 0, ownGenerationKw: 0, gridDrawKw: 0, headroomKw: 0, deficitKw: 0,
      brownout: false, trippedIds: [], discipline: 'protect-the-island', note: '' },
    storage: { sandBatteryKwhTh: 0, sandBatteryPct: 0, hydroKwh: 0, hydroPct: 0 },

    /* ---- heat ---- */
    heat: { buses: [], rejectKw: 0, deliveredKw: 0, demandKw: 0, shortfallKw: 0,
      groundLiftK: 0, groundC: GROUND.ambientC, derate: 1, coldKwTh: 0, note: GROUND.note },

    /* ---- water ---- */
    lens: { surfaceAtShaftM: 0, drawdownMm: 0, agreedBandMm: LENS.agreedBandMm, breach: false,
      modelDays: 0, validatedYears: 0, basis: LENS.basis, note: '' },

    /* ---- the ledger side ---- */
    cHours: { recorded: 0, recordedRolling365: 0, note: '' },
    passports: { issued: 0, note: '' },
    capital: { spentA$: 0, committedA$: 0, importsRolling365A$: 0 },

    /* ---- siting ---- */
    siting: { basis: SITING.basis, corridor: [], sites: [], parkTest: null },

    autoWorks: true,
    events: [],
    decisions: [],
    notes: [],
    /** How to drive this from a console or a panel. Kept in the read model on purpose. */
    howToDrive: 'world.subterranean.scenario("consent-given" | "consent-refused" | "as-it-stands"), '
      + '.build(id), .units(id, n), .clock(id, 0..1), .addLane(lineId), .autoWorks(true|false), '
      + '.discipline("protect-the-island" | "run-regardless"). Panels should emit '
      + 'world.bus.emit("ui:intent", { kind: "subterranean:...", ... }) instead.'
  });

  const notes = state.notes;

  /* ================================================================ nothing to run */

  if (!pack || !Array.isArray(pack.processes) || !pack.processes.length) {
    notes.push('data/subterranean.json is missing or has no processes. Nothing below the sand '
      + 'is simulated, which is the correct result rather than an invented one.');
    return world.register({
      id: 'subterranean', phase: 'infrastructure', order: 60,
      describe() { return { ready: false, reason: 'no data/subterranean.json' }; },
      save() { return null; }, load() {}
    });
  }

  /* ================================================================ the graph */

  /** Resources, keyed by id, each with a stock, a cap, a destination and a history. */
  const R = new Map();
  for (const r of pack.resources) {
    R.set(r.id, {
      id: r.id, name: r.name, cls: r.class, unit: r.unit || 'kg',
      hazard: r.hazard || null, note: r.note || null,
      densityKgM3: r.density_kg_m3 || null,
      hardCap: !!r.hard_cap,
      stock: 0, cap: 0, sink: null, sinkNote: '',
      producedKgMin: 0, consumedKgMin: 0,
      isSource: false, sourceAvailable: false, sourceNote: '',
      isImport: false, importNamedByPack: false,
      inKgDay: new DailyRing(1), outKgDay: new DailyRing(1),
      producers: [], consumers: [], conveyance: null,
      full: false, fullTicks: 0
    });
  }
  for (const r of R.values()) r.conveyance = conveyanceFor(r.id, r);

  /** Buildings, one record each, with a built count. Every one of them is proposed. */
  const B = new Map();
  for (const b of pack.buildings) {
    B.set(b.id, {
      id: b.id, name: b.name, tier: b.tier,
      existence: b.existence || 'proposed',
      depthM: b.depth_m_below_surface || 0,
      footprintM2: b.footprint_m2 || 0,
      costA$: b.build_cost_aud || 0,
      connectedKw: Number.isFinite(b.connected_load_kw) ? b.connected_load_kw : null,
      siting: b.siting || '',
      processIds: (b.processes || []).slice(),
      units: 0, built: false,
      ancillaryKw: 0,
      x: 0, z: 0, y: 0, chainageM: 0, side: 1, surface: (b.depth_m_below_surface || 0) === 0,
      inPark: false, buildable: true, buildableWhy: ''
    });
  }

  /** Machines: one per process, sitting in its building. Units follow the building. */
  const M = [];
  for (const p of pack.processes) {
    const b = B.get(p.building);
    const grade = Number.isFinite(p.heat_grade_c) ? p.heat_grade_c : null;
    const m = {
      id: p.id, name: p.name, p,
      buildingId: p.building, tier: p.tier,
      register: p.register || 'modelled', confidence: p.confidence || 'low',
      unlock: p.unlock || 'start',
      gates: (p.consent_gates || []).slice(),
      powerKw: Number.isFinite(p.power_kw) ? p.power_kw : 0,
      heatOutKw: Number.isFinite(p.heat_out_kw_th) ? p.heat_out_kw_th : 0,
      heatInKw: Number.isFinite(p.heat_in_kw_th) ? p.heat_in_kw_th : 0,
      gradeC: grade,
      busOut: grade == null ? null : busIndexFor(grade),
      busIn: grade == null ? null : busIndexFor(grade),
      inputs: (p.inputs || []).map((i) => ({ res: i.resource, kgMin: i.kg_per_min || 0, lineCap: 0 })),
      outputs: (p.outputs || []).map((o) => ({ res: o.resource, kgMin: o.kg_per_min || 0, lineCap: 0 })),
      nonMass: p.non_mass_outputs || null,
      routing: p.byproduct_routing || null,
      notes: p.notes || '',
      packSource: p.source || null,
      // runtime
      units: 0, clock: 1, off: false, rate: 0, utilisation: 0,
      limit: 'not built', limitDetail: '', tripped: false,
      brokenUntilDay: -1, runHours: 0,
      costA$: p.build_cost_aud || 0, footprintM2: p.footprint_m2 || 0,
      neverBuildable: p.unlock === 'tier-4-partner' || !Number.isFinite(p.power_kw)
    };
    // A generator is a machine with negative power. It is not a load and never trips for load.
    m.isGenerator = m.powerKw < 0;
    M.push(m);
    if (b) b.machineIds = (b.machineIds || []).concat(m.id);
  }
  M.sort((a, b2) => (a.tier - b2.tier) || (a.id < b2.id ? -1 : 1));
  const MbyId = new Map(M.map((m) => [m.id, m]));

  function busIndexFor(c) {
    for (let i = 0; i < HEAT_BUSES.length; i++) if (c >= HEAT_BUSES[i].minC && c < HEAT_BUSES[i].maxC) return i;
    return HEAT_BUSES.length - 1;
  }

  // Producers and consumers per resource, and the ancillary base load per building.
  for (const m of M) {
    for (const i of m.inputs) { const r = R.get(i.res); if (r) { r.consumers.push(m.id); r.consumedKgMin += i.kgMin; } }
    for (const o of m.outputs) { const r = R.get(o.res); if (r) { r.producers.push(m.id); r.producedKgMin += o.kgMin; } }
  }
  for (const b of B.values()) {
    if (b.connectedKw == null) { b.ancillaryKw = 0; continue; }
    let sum = 0;
    for (const id of b.processIds) { const m = MbyId.get(id); if (m && m.powerKw > 0) sum += m.powerKw; }
    b.ancillaryKw = b.connectedKw > 0 ? Math.max(0, b.connectedKw - sum) : 0;
  }

  /* ---------------------------------------------------------------- sinks and sources */

  const packOrphans = new Map((pack.orphan_streams || []).map((o) => [o.resource, o]));

  for (const r of R.values()) {
    if (r.cls === 'energy' || r.cls === 'record') { r.sink = null; continue; }
    r.isSource = r.producers.length === 0 && r.consumers.length > 0;
    if (r.consumers.length === 0 && r.producers.length > 0) {
      if (packOrphans.has(r.id)) { r.sink = SINK.noFate; r.sinkNote = packOrphans.get(r.id).note; }
      else if (r.id === 'vitrified-thorium-log') { r.sink = SINK.storedForever; r.sinkNote = 'Banked, monitored, not burned. It never leaves and that is the design.'; }
      else if (VENTED.has(r.id)) { r.sink = SINK.vented; r.sinkNote = 'Vented. The pack does not route it and this file does not invent a scrubber for it.'; }
      else if (PLACED.has(r.id)) { r.sink = SINK.placedOnIsland; r.sinkNote = 'Placed on the island: shoreline, reef, lining or paving.'; }
      else if (SEA.has(r.id)) { r.sink = SINK.seaDischarge; r.sinkNote = 'Discharged, and only behind a marine ecology review.'; }
      else if (WORKS.has(r.id)) { r.sink = SINK.usedInWorks; r.sinkNote = 'Used on the island rather than exported.'; }
      else if (r.cls === 'product') { r.sink = SINK.bargeExport; r.sinkNote = 'Leaves on the barge, competing for the same deck as everything else.'; }
      else if (r.id === 'residual-to-landfill') { r.sink = SINK.bargeExport; r.sinkNote = 'Buried on the mainland. The honest goal for this number is nothing, and it is not nothing.'; }
      else { r.sink = SINK.noFate; r.sinkNote = 'No destination found in the pack and none invented here.'; }
    }
  }

  // Sources: what the island itself offers, what has to be imported, and the one that is
  // ruled out entirely.
  const ISLAND_STREAM = new Set(['mixed-tip-waste', 'food-waste']);
  const ON_SITE = new Set(['dune-sand', 'in-situ-saturated-sand', 'seawater', 'air']);
  for (const r of R.values()) {
    if (!r.isSource) continue;
    if (ISLAND_STREAM.has(r.id)) { r.sourceNote = 'From the island\'s own waste stream, read out of the waste system.'; continue; }
    if (ON_SITE.has(r.id)) { r.sourceNote = 'On site. Sand, seawater and air.'; continue; }
    r.isImport = true;
    r.importNamedByPack = PACK_NAMED_IMPORTS.has(r.id);
    r.sourceNote = r.importNamedByPack
      ? 'An import the pack names in imports_that_never_close.'
      : 'Consumed by the graph and produced by nothing in it. The pack does not name this one, '
        + 'so this build treats it as an import and reports it as a hole rather than closing it quietly.';
  }
  R.get('groundwater-lens').sourceNote = 'Ruled out. The pack draws none of it for industry and '
    + 'neither does this simulation. Every litre of fresh water in the works comes from the sea.';

  // Store caps. Big enough that a ten minute tick is not the constraint, small enough that a
  // stream with nowhere to go fills up inside a week and says so.
  for (const r of R.values()) {
    const throughput = Math.max(r.producedKgMin, r.consumedKgMin, 0.01);
    if (r.isSource && !r.isImport) { r.cap = Infinity; continue; }
    if (r.cls === 'record' || r.cls === 'energy') { r.cap = Infinity; continue; }
    if (r.sink === SINK.noFate) r.cap = Math.max(1200, throughput * MIN_PER_DAY * 5);
    else if (r.isImport) r.cap = Math.max(400, throughput * MIN_PER_DAY * IMPORT_COVER_DAYS);
    else if (r.cls === 'product' || r.cls === 'stored') r.cap = Math.max(6000, throughput * MIN_PER_DAY * 6);
    else r.cap = Math.max(1500, throughput * MIN_PER_DAY * 0.6);
  }

  /* ---------------------------------------------------------------- lines

  One inbound line per building per consumed resource, one outbound per produced resource.
  Everything between the surface and the works also loads the corridor trunk. A line starts at
  one lane and a saturated line is a thing you can point at, which is the whole idea. */

  const LINES = [];
  const lineKey = (bid, res, dir) => dir + ':' + bid + ':' + res;
  const lineIndex = new Map();
  function ensureLine(bid, res, dir) {
    const k = lineKey(bid, res, dir);
    let ln = lineIndex.get(k);
    if (ln) return ln;
    const r = R.get(res);
    const cv = r ? r.conveyance : CONVEYANCE.belt;
    ln = {
      id: k, buildingId: bid, res, dir, conveyance: cv.id, label: cv.label,
      lanes: 1, perLaneKgMin: cv.perLane[0], capacityKgMin: cv.perLane[0],
      flowKgMin: 0, utilisation: 0, saturatedTicks: 0,
      crossesTrunk: false, fluid: cv.id === 'pipe' || cv.id === 'slurry' || cv.id === 'gas'
    };
    lineIndex.set(k, ln);
    LINES.push(ln);
    return ln;
  }
  for (const m of M) {
    for (const i of m.inputs) { const ln = ensureLine(m.buildingId, i.res, 'in'); i.line = ln; }
    for (const o of m.outputs) { const ln = ensureLine(m.buildingId, o.res, 'out'); o.line = ln; }
  }
  for (const ln of LINES) {
    const b = B.get(ln.buildingId);
    ln.crossesTrunk = !!(b && !b.surface);
  }

  /* ---------------------------------------------------------------- the tiers */

  const TIERS = (pack.tech_tree || []).map((t) => ({
    tier: t.tier, id: t.id, name: t.name, lane: t.lane, register: t.register,
    summary: t.summary,
    conditions: (t.unlock_conditions || []).slice(),
    unlocksBuildings: (t.unlocks_buildings || []).slice(),
    completionTest: t.completion_test
  }));

  /* ================================================================ runtime state */

  let ready = false;
  let island = null;
  let lastDay = -1;
  let lastMonth = -1;
  let tier = 1;
  let scenario = 'as-it-stands';
  let autoWorks = true;
  let discipline = 'protect-the-island';

  const gateState = {};
  for (const g of GATES) {
    gateState[g.id] = {
      id: g.id, name: g.name, kind: g.kind, heldBy: g.heldBy, note: g.note,
      state: g.kind === GATE_KIND.computed ? 'testing' : 'not sought',
      since: 0, detail: '', readiness: [], assumed: false
    };
  }

  // Thermal and hydraulic runtime.
  let groundLiftK = 0;
  let thermalDerate = 1;
  let sandBatteryKwhTh = 0;
  let hydroKwh = 0;
  let lensDrawdownMm = 0;
  let twinModelDays = 0;
  let twinValidatedDays = 0;
  let boreMetres = 0;
  let wetSeasonDaysRunning = 0;
  let cHours = 0;
  let passports = 0;
  const cHours365 = new Rolling(365);
  const importSpend365 = new Rolling(365);
  const landfill365 = new Rolling(365);
  const divertedT365 = new Rolling(365);
  let capitalSpent = 0;
  let dayLandfillKg = 0;
  let dayDivertedKg = 0;
  let dayImportA$ = 0;
  let orphanPeakAtTierOpen = 0;
  let lastGradeFactor = 1;
  const pendingImports = [];         // {res, kg, arriveDay, costA$}

  /* ================================================================ helpers */

  function heatBusOf(i) { return heat[i]; }
  const heat = HEAT_BUSES.map((b) => ({ ...b, supplyKw: 0, demandKw: 0, deliveredKw: 0, cascadeInKw: 0, surplusKw: 0, fraction: 1 }));

  function tierUnlocked(u) {
    if (u === 'start') return true;
    if (u === 'tier-2') return tier >= 2;
    if (u === 'tier-3') return tier >= 3;
    if (u === 'tier-4') return tier >= 4;
    return false;   // tier-4-partner: not costed, not rated, never reachable in this build
  }

  function gatesPassedFor(m) {
    for (const gid of m.gates) {
      const gs = gateState[gid];
      if (!gs) continue;
      if (gs.state !== 'passed' && gs.state !== 'assumed-in-scenario') return gid;
    }
    return null;
  }

  /**
   * The freshwater lens surface at a point, in metres above LAT, on the same datum as
   * world.island. Published on the read model so the render layer and any panel draw exactly
   * the number the simulation uses rather than a second one that disagrees.
   */
  function lensSurfaceM(x, z) {
    if (!island) return 1.02;
    const sea = island.seaLevel;
    const s = Math.max(0, island.shoreDistance(x, z));
    const raw = sea + LENS.controlLevelM * Math.pow(s / LENS.controlShoreDistM, LENS.exponent);
    const ground = island.height(x, z);
    return Math.max(sea, Math.min(raw, ground - LENS.minCoverM));
  }

  /* ================================================================ layout

  Placed once at init. Surface things go on named ground; underground things are strung along
  the candidate corridor by tier and depth, so walking out along the bore is walking forward
  through the tech tree, which is what makes the cutaway readable. */

  function layout(w) {
    island = w.island || null;
    const corridor = [];
    if (!island) {
      notes.push('No world.island, so nothing can be sited or tested against the park outline.');
      return corridor;
    }

    const shaft = island.project(SITING.shaft.lon, SITING.shaft.lat);
    const th = (SITING.corridorBearingDeg * Math.PI) / 180;
    // Bearing is compass: 0 is north (+z), 90 is east (+x).
    const dx = Math.sin(th), dz = Math.cos(th);
    for (let s = 0; s <= SITING.corridorLengthM; s += 100) {
      const x = shaft.x + dx * s, z = shaft.z + dz * s;
      corridor.push({
        s, x, z,
        groundM: island.height(x, z),
        lensM: lensSurfaceM(x, z),
        cover: island.landCover(x, z),
        region: island.regionAt(x, z)
      });
    }

    // The park test, on the real outline, for the corridor and for every site.
    const parkAt = (x, z) => {
      if (!island.parks) return null;
      for (const p of island.parks) for (const part of p.parts) if (pointInPoly(x, z, part)) return p.name;
      return null;
    };
    let worstPark = null;
    for (const c of corridor) { const p = parkAt(c.x, c.z); if (p) { worstPark = p; c.park = p; } }

    // Surface sites.
    const surfaceOf = (b) => {
      if (b.id === 'tip-loop-shed' || b.id === 'metal-recovery-hall') return SITING.tip;
      if (b.id === 'owc-breakwater' || b.id === 'tidal-array' || b.id === 'desalination-hall' || b.id === 'brine-works') return SITING.shore;
      if (b.id === 'microtunnel-drive') return SITING.shaft;
      return SITING.hub;
    };

    // Underground: string them out by tier then depth then id, spacing on footprint.
    const under = [...B.values()].filter((b) => !b.surface)
      .sort((a, b) => (a.tier - b.tier) || (a.depthM - b.depthM) || (a.id < b.id ? -1 : 1));
    let chain = 180;
    let side = 1;
    for (const b of under) {
      const span = clamp(Math.sqrt(Math.max(60, b.footprintM2)) * 2.4, 60, 220);
      chain += span * 0.5;
      const s = Math.min(chain, SITING.corridorLengthM - 60);
      const x = shaft.x + dx * s + (-dz) * side * 55;
      const z = shaft.z + dz * s + (dx) * side * 55;
      b.chainageM = s;
      b.side = side;
      b.x = x; b.z = z;
      b.groundM = island.height(x, z);
      b.y = b.groundM - b.depthM;
      b.lensM = lensSurfaceM(x, z);
      b.belowWaterTable = b.y < b.lensM;
      b.inPark = !!parkAt(x, z);
      chain += span * 0.5 + 24;
      side = -side;
    }
    for (const b of B.values()) {
      if (!b.surface) continue;
      const st = surfaceOf(b);
      const p = island.project(st.lon, st.lat);
      // A small deterministic spread so surface sheds do not stack on one point.
      const k = [...B.keys()].indexOf(b.id);
      b.x = p.x + ((k % 5) - 2) * 26;
      b.z = p.z + ((Math.floor(k / 5) % 5) - 2) * 26;
      b.groundM = island.height(b.x, b.z);
      b.y = b.groundM;
      b.lensM = lensSurfaceM(b.x, b.z);
      b.belowWaterTable = false;
      b.siteId = st.id;
      b.siteLabel = st.label;
      b.inPark = !!parkAt(b.x, b.z);
    }

    for (const b of B.values()) {
      if (b.inPark) {
        b.buildable = false;
        b.buildableWhy = 'Sited inside a protected area in data/geography.json. Nothing in this pack goes there.';
      }
    }

    state.siting.parkTest = {
      corridorInPark: !!worstPark,
      parkName: worstPark,
      sitesInPark: [...B.values()].filter((b) => b.inPark).map((b) => b.id),
      testedAgainst: 'data/geography.json protected_areas, projected into local metres by src/world/island.js',
      note: worstPark
        ? 'The candidate corridor crosses ' + worstPark + '. It cannot be used and the siting has to move.'
        : 'The candidate corridor and every candidate site fall outside the mapped protected areas. '
          + 'The outline itself is indicative, so this is a first pass and not a clearance.'
    };
    return corridor;
  }

  /* ================================================================ building */

  function canBuild(b) {
    if (b.units > 0) return 'already built';
    if (!b.buildable) return b.buildableWhy;
    if (b.tier > tier) return 'tier ' + b.tier + ' is not open';
    if (b.connectedKw == null) return 'not costed and not rated in the pack';
    for (const id of b.processIds) {
      const m = MbyId.get(id);
      if (!m) continue;
      const g = gatesPassedFor(m);
      if (g) return 'waiting on ' + gateState[g].name;
    }
    return null;
  }

  function buildBuilding(w, id, why) {
    const b = B.get(id);
    if (!b) return false;
    const no = canBuild(b);
    if (no) return false;
    b.units = 1;
    b.built = true;
    capitalSpent += b.costA$;
    for (const pid of b.processIds) {
      const m = MbyId.get(pid);
      if (!m || m.neverBuildable) continue;
      if (!tierUnlocked(m.unlock)) continue;
      if (gatesPassedFor(m)) continue;
      m.units = 1;
    }
    w.bus.emit('civic:spend', { source: 'infrastructure/subterranean.js', item: b.id, costA$: b.costA$, proposed: true });
    decisions.push({ day: w.clock.dayIndex, kind: 'build', text: 'Proposed ' + b.name + ': ' + (why || 'the works manager judged it needed') + '. ' + aud(b.costA$) + '.' });
    return true;
  }

  function addUnit(w, id, why) {
    const b = B.get(id);
    if (!b || !b.built || b.units >= 6) return false;
    b.units++;
    capitalSpent += b.costA$;
    for (const pid of b.processIds) {
      const m = MbyId.get(pid);
      if (m && m.units > 0) m.units = b.units;
    }
    decisions.push({ day: w.clock.dayIndex, kind: 'unit', text: 'A second line at ' + b.name + ': ' + why + '.' });
    return true;
  }

  /* ================================================================ the solver

  Two passes a tick. The first works out what each machine could run at given its stocks, its
  lines and its heat; the corridor trunk is then loaded and, if it is oversubscribed, everything
  crossing it is scaled back. The second pass re-runs with the trunk fraction and with anything
  the power network tripped held at zero. Flows are applied once, at the end, so no machine gets
  to eat a stock the machine before it in the array has not produced yet. */

  function laneCapacity(ln) {
    const cv = CONVEYANCE[ln.conveyance] || CONVEYANCE.belt;
    let step = 0;
    for (let i = cv.tierOf.length - 1; i >= 0; i--) if (tier >= cv.tierOf[i]) { step = i; break; }
    ln.perLaneKgMin = cv.perLane[step];
    ln.capacityKgMin = ln.perLaneKgMin * ln.lanes;
    return ln.capacityKgMin;
  }

  function solve(trunkFraction) {
    for (const m of M) {
      m.rate = 0;
      if (m.units <= 0) { m.limit = 'not built'; m.limitDetail = ''; continue; }
      if (m.off) { m.limit = 'switched off'; m.limitDetail = ''; continue; }
      if (m.tripped) { m.limit = 'tripped'; m.limitDetail = 'no power headroom'; continue; }
      if (m.brokenUntilDay >= 0) { m.limit = 'down for repair'; m.limitDetail = ''; continue; }
      const gate = gatesPassedFor(m);
      if (gate) { m.limit = 'consent'; m.limitDetail = gateState[gate].name; continue; }

      let r = m.units * m.clock * (m.isGenerator ? 1 : thermalDerate);
      let why = 'running at nameplate';
      let detail = '';

      for (const i of m.inputs) {
        const res = R.get(i.res);
        if (!res || i.kgMin <= 0) continue;
        if (res.isSource && !res.isImport) {
          if (!res.sourceAvailable) { r = 0; why = 'source closed'; detail = res.name; break; }
        } else {
          const canRun = res.stock / (i.kgMin * TICK_MIN);
          if (canRun < r) { r = canRun; why = 'starved'; detail = res.name; }
        }
        const cap = laneCapacity(i.line) / i.kgMin;
        if (cap < r) { r = cap; why = 'line in'; detail = res.name + ' on one ' + i.line.label; }
      }
      for (const o of m.outputs) {
        const res = R.get(o.res);
        if (!res || o.kgMin <= 0) continue;
        if (Number.isFinite(res.cap)) {
          const head = (res.cap - res.stock) / (o.kgMin * TICK_MIN);
          if (head < r) { r = head; why = res.sink === SINK.noFate ? 'nowhere to put it' : 'store full'; detail = res.name; }
        }
        const cap = laneCapacity(o.line) / o.kgMin;
        if (cap < r) { r = cap; why = 'line out'; detail = res.name + ' on one ' + o.line.label; }
      }
      if (m.heatInKw > 0 && m.busIn != null) {
        const f = heat[m.busIn].fraction;
        if (f < 0.999) { const hr = m.units * m.clock * f; if (hr < r) { r = hr; why = 'heat short'; detail = HEAT_BUSES[m.busIn].label; } }
      }
      if (trunkFraction < 0.999) {
        const b = B.get(m.buildingId);
        if (b && !b.surface) { const tr = r * trunkFraction; if (tr < r) { r = tr; why = 'corridor trunk'; detail = 'the bore is carrying all it can'; } }
      }

      m.rate = r > 0 ? r : 0;
      m.utilisation = m.units > 0 ? m.rate / m.units : 0;
      m.limit = m.rate <= 1e-9 ? (why === 'running at nameplate' ? 'idle' : why) : (m.rate < m.units * m.clock - 1e-6 ? why : 'running at nameplate');
      m.limitDetail = detail;
    }
  }

  function trunkLoad() {
    let solid = 0, fluid = 0;
    for (const ln of LINES) ln.flowKgMin = 0;
    for (const m of M) {
      if (m.rate <= 0) continue;
      for (const i of m.inputs) i.line.flowKgMin += i.kgMin * m.rate;
      for (const o of m.outputs) o.line.flowKgMin += o.kgMin * m.rate;
    }
    for (const ln of LINES) {
      ln.utilisation = ln.capacityKgMin > 0 ? ln.flowKgMin / ln.capacityKgMin : 0;
      if (ln.utilisation > 0.985) ln.saturatedTicks++; else ln.saturatedTicks = 0;
      // Only the inbound half is counted, so a hand-off between two underground halls is not
      // charged to the trunk twice.
      if (ln.crossesTrunk && ln.dir === 'in') { if (ln.fluid) fluid += ln.flowKgMin; else solid += ln.flowKgMin; }
    }
    return { solid, fluid };
  }

  function applyFlows(w) {
    let inSum = 0, outSum = 0;
    for (const m of M) {
      if (m.rate <= 0) continue;
      for (const i of m.inputs) {
        const res = R.get(i.res);
        if (!res) continue;
        const q = i.kgMin * m.rate * TICK_MIN;
        if (!(res.isSource && !res.isImport)) res.stock = Math.max(0, res.stock - q);
        res.outKgDay.add(q);
        inSum += q;
      }
      for (const o of m.outputs) {
        const res = R.get(o.res);
        if (!res) continue;
        const q = o.kgMin * m.rate * TICK_MIN;
        res.stock += q;
        if (Number.isFinite(res.cap) && res.stock > res.cap) res.stock = res.cap;
        res.inKgDay.add(q);
        outSum += q;
      }
      m.runHours += TICK_HOURS * (m.units > 0 ? m.rate / m.units : 0);
    }
    state.massBalanceKgPerDay = round((outSum - inSum) * TICKS_PER_DAY, 2);
  }

  /* ================================================================ sinks

  What leaves. Everything with a destination is drained here at the rate its destination can
  take, and everything with no fate is left exactly where the pack says it is: sitting there,
  filling its store, waiting for somebody to answer the question. */

  function drainSinks(w) {
    const cross = crossing(w);
    const bargeRunning = cross.running;
    const marine = gateState['marine-ecology-review'];
    const marineOk = marine.state === 'passed' || marine.state === 'assumed-in-scenario';
    const coastal = gateState['coastal-management-approval'];
    const coastalOk = coastal.state === 'passed' || coastal.state === 'assumed-in-scenario';

    for (const r of R.values()) {
      if (!r.sink || r.stock <= 0) continue;
      let take = 0;
      switch (r.sink) {
        case SINK.vented:
          take = r.stock; break;
        case SINK.usedInWorks:
          take = r.stock * 0.35; break;
        case SINK.placedOnIsland:
          take = coastalOk ? r.stock * 0.5 : 0;
          break;
        case SINK.seaDischarge:
          take = marineOk ? r.stock * 0.8 : 0;
          break;
        case SINK.bargeExport:
          // Deck space. A barge that did not sail takes nothing, and everything queues.
          take = bargeRunning ? Math.min(r.stock, 900 * (cross.ranToday || 1) / 10) : 0;
          if (r.id === 'residual-to-landfill') { dayLandfillKg += take; }
          break;
        case SINK.storedForever:
        case SINK.noFate:
        default:
          take = 0;
      }
      if (take > 0) r.stock = Math.max(0, r.stock - take);
    }
  }

  /* ================================================================ sources */

  function refreshSources(w) {
    const wasteState = w.read('waste');
    const reuse = L.dial('island-reuse-and-repair', 0.35);
    const transfer = L.dial('transfer-station-upgrade', 0.4);

    for (const r of R.values()) { if (r.isSource) r.sourceAvailable = false; }

    // Air and seawater. The pack's own line: the input that never runs out.
    R.get('air').sourceAvailable = true;
    R.get('seawater').sourceAvailable = gateState['marine-ecology-review'].state === 'passed'
      || gateState['marine-ecology-review'].state === 'assumed-in-scenario';
    R.get('dune-sand').sourceAvailable = true;    // a bucket off the ground for the bench

    // The tip. The richest ore on this island, and it arrives by truck already refined.
    const tipRes = R.get('mixed-tip-waste');
    const foodRes = R.get('food-waste');
    if (wasteState && wasteState.ready) {
      // Only the share the island's own reuse and repair programme actually diverts to the loop
      // reaches this shed. The rest goes on the barge as it does today.
      const generatedKgTick = (wasteState.generatedTodayT || 0) * 1000 / TICKS_PER_DAY;
      const share = clamp(0.12 + 0.5 * reuse + 0.2 * transfer, 0, 0.85);
      tipRes.stock += generatedKgTick * share;
      tipRes.sourceAvailable = tipRes.stock > 0;
      foodRes.stock += generatedKgTick * share * 0.14;
      foodRes.sourceAvailable = foodRes.stock > 0;
      dayDivertedKg += generatedKgTick * share;
    } else {
      // No waste system loaded. The pack's own rate for the triage bay, so the loop still runs
      // and the read model says where the number came from.
      tipRes.stock += 8 * TICK_MIN;
      foodRes.stock += 0.4 * TICK_MIN;
      tipRes.sourceAvailable = true;
      foodRes.sourceAvailable = true;
    }
    if (Number.isFinite(tipRes.cap)) tipRes.stock = Math.min(tipRes.stock, tipRes.cap);
    if (Number.isFinite(foodRes.cap)) foodRes.stock = Math.min(foodRes.stock, foodRes.cap);

    // The tunnel face. Only open while every gate on the bore is satisfied and the lens is
    // inside its agreed band. This is the hard stop the pack asks for, not a penalty.
    const bore = MbyId.get('microtunnel-bore');
    const faceOpen = !!bore && bore.units > 0 && !gatesPassedFor(bore) && !state.lens.breach;
    R.get('in-situ-saturated-sand').sourceAvailable = faceOpen;
    R.get('in-situ-saturated-sand').sourceNote = faceOpen
      ? 'The face is open: consent is recorded and the lens is inside the agreed band.'
      : (state.lens.breach ? 'Closed: the lens has moved beyond the agreed band. Every excavation stops.'
        : 'Closed: the bore has no recorded consent in this scenario.');

    // Imports arriving.
    for (let i = pendingImports.length - 1; i >= 0; i--) {
      const o = pendingImports[i];
      if (absDay(w.clock) >= o.arriveDay) {
        const r = R.get(o.res);
        if (r) { r.stock = Math.min(r.cap, r.stock + o.kg); r.sourceAvailable = true; }
        pendingImports.splice(i, 1);
      }
    }
    for (const r of R.values()) if (r.isImport) r.sourceAvailable = r.stock > 0;
  }

  function orderImports(w) {
    const cross = crossing(w);
    if (!cross.running) return;
    for (const r of R.values()) {
      if (!r.isImport) continue;
      const daily = r.consumedKgMin * MIN_PER_DAY;
      if (daily <= 0) continue;
      const want = daily * IMPORT_COVER_DAYS;
      const onOrder = pendingImports.reduce((a, o) => a + (o.res === r.id ? o.kg : 0), 0);
      if (r.stock + onOrder > want * 0.4) continue;
      const qty = Math.max(1, want - r.stock - onOrder);
      const costA$ = qty * (IMPORT_A$_PER_KG[r.id] || IMPORT_DEFAULT_A$_PER_KG);
      pendingImports.push({ res: r.id, kg: qty, arriveDay: absDay(w.clock) + IMPORT_LEAD_DAYS, costA$ });
      dayImportA$ += costA$;
      capitalSpent += costA$;
    }
    if (pendingImports.length > 60) pendingImports.length = 60;
  }

  /* ================================================================ power */

  function runPower(w) {
    // Connected load: what the grid has to be sized for, whether or not it is running.
    let connected = 0;
    for (const b of B.values()) {
      if (b.units <= 0 || b.connectedKw == null) continue;
      connected += b.connectedKw * b.units;
    }

    // Generation, at what the island's weather and sea actually give right now.
    const dl = w.read('daylight');
    const wx = w.read('weather');
    const surf = w.read('surf');
    const td = w.read('tide');
    let gen = 0;
    for (const m of M) {
      if (!m.isGenerator || m.units <= 0 || m.off) continue;
      let avail = 1;
      if (m.id === 'rooftop-solar-harvest') {
        const el = dl ? dl.elevationDeg : 30;
        const cloud = wx ? wx.cloud : 0.25;
        avail = el <= 0.5 ? 0 : clamp(Math.sin((el * Math.PI) / 180) * (1 - 0.78 * cloud * cloud) * 3.4, 0, 3.4);
      } else if (m.id === 'owc-wave-harvest') {
        const swell = surf ? surf.swellM : 1.2;
        avail = clamp(Math.pow(clamp(swell / 1.4, 0, 2.4), 1.6), 0, 3.2);
      } else if (m.id === 'bladeless-tidal-harvest') {
        const rate = td ? Math.abs(td.rate) : 0.2;
        avail = clamp(Math.pow(rate / 0.28, 1.7), 0, 2.6);
      } else if (m.id === 'bladeless-wind-harvest') {
        const wind = wx ? wx.windKph : 16;
        avail = clamp(Math.pow(clamp(wind / 22, 0, 2), 2.2), 0, 3.0);
      } else if (m.id === 'syngas-chp') {
        avail = m.rate / Math.max(1e-6, m.units);
      }
      m.generatingKw = -m.powerKw * m.units * avail;
      gen += m.generatingKw;
    }

    // Load, at the rates the material solver just found.
    let load = 0;
    for (const m of M) {
      if (m.isGenerator || m.rate <= 0) continue;
      load += m.powerKw * m.rate;
    }
    for (const b of B.values()) {
      if (b.units <= 0 || b.connectedKw == null || b.connectedKw <= 0) continue;
      let anyOn = false;
      for (const id of b.processIds) { const m = MbyId.get(id); if (m && m.units > 0 && !m.off) { anyOn = true; break; } }
      if (anyOn) load += b.ancillaryKw * b.units;
    }

    // Storage. The sand battery only ever charges on surplus; the pumped hydro pump is the
    // single biggest load in the pack and only runs when there is genuinely nothing else to do
    // with the electricity.
    let storeCharge = 0, storeDischarge = 0;
    const p = w.read('power');
    let headroom;
    if (p && p.ready) {
      const subLine = (p.demandByCategory && p.demandByCategory.subterranean) || 0;
      const nonSub = Math.max(0, (p.demandKw || 0) - subLine);
      const supply = (p.cable ? p.cable.up * p.cable.ratingKw : 2900)
        + (p.solar ? p.solar.generatingKw : 0)
        + (p.diesel ? p.diesel.runningKw : 0);
      headroom = Math.max(0, supply * 0.92 - nonSub);
      if (p.shedding && p.shedding.on) headroom = 0;
    } else {
      // No power system loaded. The pack's own island estimate, spread over the day.
      headroom = Math.max(0, 30000 / 24 * 1.6 - 900);
    }

    const available = gen + headroom;
    state.power.headroomKw = headroom;
    state.power.ownGenerationKw = gen;

    // Trip order: deepest and hottest first, exactly as the pack asks. A generator never trips.
    const trippable = M.filter((m) => !m.isGenerator && m.rate > 0 && m.powerKw > 0)
      .sort((a, b) => {
        const da = (B.get(a.buildingId) || {}).depthM || 0;
        const db = (B.get(b.buildingId) || {}).depthM || 0;
        if (db !== da) return db - da;
        if ((b.heatOutKw || 0) !== (a.heatOutKw || 0)) return (b.heatOutKw || 0) - (a.heatOutKw || 0);
        if (b.powerKw !== a.powerKw) return b.powerKw - a.powerKw;
        return a.id < b.id ? -1 : 1;
      });

    const tripped = [];
    let deficit = load - available;
    if (discipline === 'protect-the-island') {
      for (const m of trippable) {
        if (deficit <= 0.5) break;
        const shed = m.powerKw * m.rate;
        m.tripped = true;
        tripped.push(m.id);
        deficit -= shed;
        load -= shed;
      }
    }

    // The sand battery charges out of whatever is left over, and only out of that.
    const sandCharge = MbyId.get('sand-battery-charge');
    if (sandCharge && sandCharge.units > 0 && !sandCharge.off) {
      const spec = sandCharge.nonMass || {};
      const capKwh = (spec.capacity_kwh_th || 40000) * sandCharge.units;
      const spare = Math.max(0, available - load);
      const chargeKw = Math.min(spec.charge_kw || 500, spare, (capKwh - sandBatteryKwhTh) / Math.max(0.001, TICK_HOURS));
      if (chargeKw > 1) { sandBatteryKwhTh += chargeKw * TICK_HOURS * 0.97; storeCharge = chargeKw; load += chargeKw; }
      sandBatteryKwhTh *= Math.pow(1 - ((spec.standing_loss_pct_per_day || 0.5) / 100), TICK_HOURS / 24);
      state.storage.sandBatteryKwhTh = round(sandBatteryKwhTh, 0);
      state.storage.sandBatteryPct = round((sandBatteryKwhTh / Math.max(1, capKwh)) * 100, 1);
    }

    const hydro = MbyId.get('underground-pumped-hydro');
    if (hydro && hydro.units > 0 && !hydro.off) {
      const spec = hydro.nonMass || {};
      const capKwh = (spec.storage_kwh || 14000) * hydro.units;
      const spare = Math.max(0, available - load);
      if (spare > 200 && hydroKwh < capKwh) {
        const pumpKw = Math.min(spec.power_kw || 2000, spare);
        hydroKwh = Math.min(capKwh, hydroKwh + pumpKw * TICK_HOURS * (spec.round_trip || 0.78));
        load += pumpKw;
      } else if (deficit > 0 && hydroKwh > 0) {
        const outKw = Math.min(spec.power_kw || 2000, hydroKwh / Math.max(0.001, TICK_HOURS), deficit);
        hydroKwh -= outKw * TICK_HOURS;
        storeDischarge += outKw;
        deficit -= outKw;
      }
      state.storage.hydroKwh = round(hydroKwh, 0);
      state.storage.hydroPct = round((hydroKwh / Math.max(1, capKwh)) * 100, 1);
    }

    state.connectedLoadKw = round(connected, 1);
    state.generationKw = round(gen, 1);
    state.drawKw = round(Math.max(0, load), 1);
    state.utilisation = connected > 0 ? clamp(Math.max(0, load) / connected, 0, 1) : 0;
    state.power.demandKw = round(Math.max(0, load), 1);
    state.power.gridDrawKw = round(Math.max(0, load - gen - storeDischarge), 1);
    state.power.deficitKw = round(Math.max(0, deficit), 1);
    state.power.brownout = deficit > 0.5;
    state.power.trippedIds = tripped;
    state.power.discipline = discipline;
    state.power.note = discipline === 'protect-the-island'
      ? 'The works trip themselves before the island browns out. Switch to run-regardless and the '
        + 'load goes onto the cable, which is the lesson data/subterranean.json asks for: a player '
        + 'who rushes the carbon furnace hall should black out the island.'
      : 'Run-regardless. The works take what they want and the island lives with it.';

    if (tripped.length) {
      w.bus.emit('subterranean:trip', { ids: tripped, deficitKw: round(load - available + tripped.length, 0), proposed: true });
    }
    return tripped.length > 0;
  }

  /* ================================================================ heat */

  function runHeat(w) {
    for (const h of heat) { h.supplyKw = 0; h.demandKw = 0; h.deliveredKw = 0; h.cascadeInKw = 0; h.surplusKw = 0; }

    for (const m of M) {
      if (m.rate <= 0) continue;
      if (m.heatOutKw > 0 && m.busOut != null) heat[m.busOut].supplyKw += m.heatOutKw * m.rate;
      if (m.heatInKw > 0 && m.busIn != null) heat[m.busIn].demandKw += m.heatInKw * m.rate;
    }

    // The sand battery discharges into the 400 to 700 band it was charged at, which is what
    // keeps the block cure and the desalination hall alive when the furnaces are down.
    const disc = MbyId.get('sand-battery-discharge');
    const kilnBus = 2;
    if (disc && disc.units > 0 && !disc.off && sandBatteryKwhTh > 0) {
      const spec = disc.nonMass || {};
      const shortBelow = Math.max(0, heat[kilnBus].demandKw + heat[3].demandKw - heat[kilnBus].supplyKw);
      const outKw = Math.min((spec.discharge_kw_th || 350) * disc.units, shortBelow, sandBatteryKwhTh / Math.max(0.001, TICK_HOURS));
      if (outKw > 0.5) { sandBatteryKwhTh -= outKw * TICK_HOURS; heat[kilnBus].supplyKw += outKw * (spec.round_trip_as_heat || 0.9); }
    }

    // The staircase. Nothing is delivered at all without the thermal plant room, because without
    // it the pipework does not exist and the heat simply leaves. That is the pack's design: the
    // cascade is a building, not a property of the universe.
    const plant = B.get('thermal-plant-room');
    const cascadeOn = !!(plant && plant.units > 0);
    let carry = 0;
    let delivered = 0, demand = 0;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i];
      h.cascadeInKw = carry;
      const avail = h.supplyKw + carry;
      const use = cascadeOn ? Math.min(avail * CASCADE_DELIVERY, h.demandKw) : 0;
      h.deliveredKw = use;
      h.fraction = h.demandKw > 0 ? clamp(use / h.demandKw, 0, 1) : 1;
      h.surplusKw = Math.max(0, avail - use / Math.max(0.001, CASCADE_DELIVERY));
      carry = cascadeOn ? h.surplusKw * CASCADE_DELIVERY : avail;
      delivered += use; demand += h.demandKw;
    }

    // What is left at the bottom of the staircase has to go into the ground, because
    // underground there is no sky to throw it at. That is not a metaphor: it is the reason the
    // works get hot and the machines lose efficiency if the loops cannot keep up.
    const rejectKw = carry;
    const seaLoop = B.get('desalination-hall');
    const ua = GROUND.loopUaKwPerK + ((seaLoop && seaLoop.units > 0) ? GROUND.seaLoopUaKwPerK : 0);
    const lossKw = ua * groundLiftK;
    groundLiftK = Math.max(0, groundLiftK + ((rejectKw - lossKw) * TICK_HOURS) / GROUND.capacityKwhPerK);

    thermalDerate = 1 - (1 - GROUND.derateFloor) * smoothstep(GROUND.derateStartK, GROUND.derateFullK, groundLiftK);

    // The cold side. Separating air for welding gases and life support leaves liquid nitrogen,
    // and piped through the food store before the gas goes and does its industrial job, that
    // cold runs long term cold storage as a by-product rather than a cost.
    const airSep = MbyId.get('air-separation');
    const coldKw = airSep && airSep.rate > 0 ? airSep.rate * 34 : 0;

    state.heat.buses = heat.map((h) => ({
      id: h.id, label: h.label,
      supplyKw: round(h.supplyKw, 1), demandKw: round(h.demandKw, 1),
      deliveredKw: round(h.deliveredKw, 1), surplusKw: round(h.surplusKw, 1),
      metPct: Math.round(h.fraction * 100)
    }));
    state.heat.rejectKw = round(rejectKw, 1);
    state.heat.deliveredKw = round(delivered, 1);
    state.heat.demandKw = round(demand, 1);
    state.heat.shortfallKw = round(Math.max(0, demand - delivered), 1);
    state.heat.groundLiftK = round(groundLiftK, 2);
    state.heat.groundC = round(GROUND.ambientC + groundLiftK, 1);
    state.heat.derate = round(thermalDerate, 3);
    state.heat.coldKwTh = round(coldKw, 1);
    state.heat.cascadeBuilt = cascadeOn;
    state.heat.plainly = cascadeOn
      ? 'The staircase is plumbed. ' + Math.round(delivered) + ' kW of heat is doing a second job '
        + 'before it is thrown away, and ' + Math.round(rejectKw) + ' kW is going into the sand.'
      : 'There is no thermal plant room, so no heat is being caught at all: '
        + Math.round(rejectKw) + ' kW of it is going straight into the sand around the works.';
  }

  /* ================================================================ the lens */

  function runLens(w) {
    if (!island) return;
    const shaft = island.project(SITING.shaft.lon, SITING.shaft.lat);
    const surfaceM = lensSurfaceM(shaft.x, shaft.z);

    // What the works take out of the ground. Pore water arriving with the spoil, and the water
    // a freeze ring holds back while it runs. Neither is a small number when the face is open.
    let takeKgMin = 0;
    const bore = MbyId.get('microtunnel-bore');
    if (bore && bore.rate > 0) takeKgMin += 65.1 * bore.rate * 0.2;      // the pore water fraction
    const lat = MbyId.get('lateral-wall-mining');
    if (lat && lat.rate > 0) takeKgMin += 27 * lat.rate;
    const freeze = MbyId.get('ground-freeze');
    if (freeze && freeze.rate > 0) takeKgMin += 30 * freeze.rate;

    // A kilogram is a litre. Spread over the island's land area, a litre a square metre is a
    // millimetre, so the conversion is arithmetic rather than a fitted constant.
    const areaM2 = (island.landAreaKm2 || 271) * 1e6;
    const mmPerTick = ((takeKgMin * TICK_MIN) / 1000) / areaM2 * 1000 * 1000;
    lensDrawdownMm += mmPerTick;
    // Recovery. The lens is enormous and slow, which is exactly why a decision about it does not
    // show up for seasons and is exactly why you build the model first.
    lensDrawdownMm *= Math.pow(0.5, (TICK_MIN / MIN_PER_DAY) / LENS.recoveryHalfLifeDays);

    // What the community's own aquifer stress is doing, if the lakes system is loaded. A lens
    // already under stress has less room for anything the works do.
    const lakes = w.read('lakes');
    const stress = lakes && Number.isFinite(lakes.aquiferStress) ? lakes.aquiferStress : 0;
    const band = LENS.agreedBandMm * (1 - 0.5 * clamp(stress, 0, 1));

    const wasBreach = state.lens.breach;
    const breach = lensDrawdownMm > band;

    state.lens.surfaceAtShaftM = round(surfaceM - island.seaLevel, 1);
    state.lens.drawdownMm = round(lensDrawdownMm, 2);
    state.lens.agreedBandMm = round(band, 1);
    state.lens.breach = breach;
    state.lens.modelDays = Math.round(twinModelDays);
    state.lens.validatedYears = round(twinValidatedDays / 365, 2);
    state.lens.note = breach
      ? 'The lens has moved beyond the agreed band. Every excavation process has halted. This is a '
        + 'hard stop, not a penalty, and it does not lift until the lens comes back.'
      : 'Inside the agreed band. The band itself is modelled and the community would set it, not this file.';

    if (breach && !wasBreach) {
      log.push({ day: w.clock.dayIndex, kind: 'lens-breach',
        text: 'The aquifer twin has flagged the freshwater lens beyond the agreed band. Every '
          + 'excavation process has stopped this tick. Nothing overrides this.' });
      w.bus.emit('subterranean:lens-breach', { drawdownMm: round(lensDrawdownMm, 1), bandMm: round(band, 1), proposed: true });
      nudge(w, 'aquifer_stress', 0.10, 'the proposed works drew the lens past its agreed band', 'infrastructure/subterranean.js', 540);
    }
  }

  /* ================================================================ the gates */

  function refreshGates(w) {
    const dataLab = B.get('data-lab');
    const twinBuilt = !!(dataLab && dataLab.units > 0);
    const day = w.clock.dayIndex;

    // Computed gates. The twin answers these itself and shows its working.
    const park = gateState['national-park-exclusion'];
    const parkClean = state.siting.parkTest && !state.siting.parkTest.corridorInPark
      && (!state.siting.parkTest.sitesInPark || state.siting.parkTest.sitesInPark.length === 0);
    park.state = parkClean ? 'passed' : 'failed';
    park.detail = state.siting.parkTest ? state.siting.parkTest.note : 'no island loaded, so nothing has been tested';

    const twin = gateState['aquifer-twin-pass'];
    if (!twinBuilt) { twin.state = 'not sought'; twin.detail = 'There is no open groundwater model. The pack builds the model before it builds a machine.'; }
    else if (twinModelDays < 180) { twin.state = 'in progress'; twin.detail = 'The model has ' + Math.round(twinModelDays) + ' days of runs. It needs about 180 before it is worth arguing with.'; }
    else if (state.lens.breach) { twin.state = 'failed'; twin.detail = 'The model says the lens is outside the agreed band.'; }
    else { twin.state = 'passed'; twin.detail = 'The model is running, published and open, and the lens is inside the agreed band at ' + round(lensDrawdownMm, 1) + ' mm.'; }

    const mining = gateState['mining-law'];
    mining.state = 'passed';
    mining.detail = 'This pack is not a mining proposal. Mineral sand mining ended by law and the last mine closed in 2019.';

    const nuke = gateState['nuclear-prohibition-note'];
    const hasReactor = false;   // there is none in the pack and none may be added to it
    nuke.state = hasReactor ? 'failed' : 'passed';
    nuke.detail = 'Federal law prohibits nuclear power installations and this pack contains no reactor. '
      + 'The thorium is banked in glass and stewarded, not burned.';

    // Regulated gates: a real process with a real duration, once it has been started.
    for (const id of Object.keys(REGULATED_DAYS)) {
      const gs = gateState[id];
      if (gs.state !== 'in progress') continue;
      const elapsed = day - gs.since;
      if (elapsed >= REGULATED_DAYS[id]) {
        gs.state = 'passed';
        gs.detail = 'Granted after about ' + Math.round(elapsed / 30) + ' months. Modelled duration.';
        log.push({ day, kind: 'gate', text: gs.name + ' is in place. ' + gs.note });
      } else {
        gs.detail = Math.round(REGULATED_DAYS[id] - elapsed) + ' days to run. Modelled duration, not a published one.';
      }
    }

    // The gates that are not ours. These carry a readiness list and never an outcome.
    for (const g of GATES) {
      if (g.kind !== GATE_KIND.notOurs) continue;
      const gs = gateState[g.id];
      gs.readiness = readinessFor(g.id, twinBuilt);
      if (gs.state === 'not sought') {
        gs.detail = 'Not sought. This twin does not model what the Quandamooka People or the island '
          + 'community would decide, and will not put a number on it. What it can show is what would '
          + 'have to be true before the question could honestly be asked.';
      }
    }

    state.gates = {};
    for (const g of GATES) {
      const gs = gateState[g.id];
      state.gates[g.id] = {
        id: g.id, name: gs.name, kind: gs.kind, heldBy: gs.heldBy, note: gs.note,
        state: gs.state, detail: gs.detail,
        readiness: gs.readiness && gs.readiness.length ? gs.readiness : undefined
      };
    }
  }

  function readinessFor(gid, twinBuilt) {
    const out = [];
    const add = (ok, text) => out.push({ ok: !!ok, text });
    if (gid === 'traditional-owner-consent' || gid === 'cultural-heritage-clearance') {
      add(twinBuilt, 'An open groundwater model of the freshwater lens exists and the community owns it');
      add(gateState['aquifer-twin-pass'].state === 'passed', 'The model says the lens is safe for the proposed method');
      add(gateState['national-park-exclusion'].state === 'passed', 'Every site is outside Naree Budjong Djara National Park');
      add(false, 'Cultural heritage of the specific site has been established with the Traditional Owners. '
        + 'This twin cannot establish it and must not pretend to');
      add(true, 'The question is asked for this stage only and is not carried over from any other');
    } else if (gid === 'sea-country-consent') {
      add(gateState['marine-ecology-review'].state === 'passed', 'An independent marine ecology review is complete');
      add(true, 'No blade a living thing can reach: the wave and tidal devices in the pack are bladeless');
      add(false, 'Sea Country has been discussed with the Traditional Owners for these specific works');
    } else if (gid === 'community-vote') {
      add(twinBuilt, 'The model, the mass balance and the power arithmetic are published and open');
      add(state.orphanKg < 5000, 'The orphan stream list is short enough to put in front of people honestly');
      add(gateState['radiation-licence'].state === 'passed' || !anyMonaziteBuilt(), 'Anything touching monazite is licensed, or is not being built');
      add(true, 'The vote is held with a real option to refuse. A vote you cannot lose is not a vote');
    }
    return out;
  }

  function anyMonaziteBuilt() {
    const n = B.get('norm-plant');
    return !!(n && n.units > 0);
  }

  /* ================================================================ tiers */

  function tierConditions(w, t) {
    const day = w.clock.dayIndex;
    const out = [];
    const add = (ok, text) => out.push({ ok: !!ok, text });
    if (t === 2) {
      add(gateState['aquifer-twin-pass'].state === 'passed', 'aquifer twin built, published and community owned, showing no unacceptable drawdown');
      add(isPassed('traditional-owner-consent'), 'Traditional Owner consent obtained through QYAC for the specific site');
      add(isPassed('cultural-heritage-clearance'), 'cultural heritage clearance for the specific site');
      add(gateState['national-park-exclusion'].state === 'passed', 'site is outside Naree Budjong Djara National Park and outside any place of cultural significance');
      add(isPassed('engineering-certification'), 'engineering and geotechnical certification for a jacked bore below the water table');
    } else if (t === 3) {
      add(tier >= 2 && wetSeasonDaysRunning >= 90, 'tier 2 complete and running for at least one full wet season');
      add(isPassed('radiation-licence'), 'radiation management licence in place before any monazite is concentrated');
      add(state.generationKw >= state.connectedLoadKw * 0.25, 'a signed island energy plan showing the harvest is built before the load');
      add(isPassed('engineering-certification'), 'hazardous materials, emergency egress and ventilation certification for occupied underground space');
      add(chlorineBalanced(), 'a published mass balance for chlorine across every chlorinating process');
    } else if (t === 4) {
      add(tier >= 3, 'tier 3 complete');
      add(isPassed('community-vote'), 'a community vote, held with full information and a real option to refuse');
      add(isPassed('traditional-owner-consent'), 'Traditional Owner consent renewed specifically for room making, not carried over from the bore');
      add(twinValidatedDays >= 3 * 365, 'the aquifer twin validated against at least three years of measured lens data, not just calibrated');
      add(isPassed('radiation-licence'), 'for the monazite branch: a radiation licence, a decay chain plan, and a stated fate for the spent acid');
      add(false, 'for anything nuclear: a change in federal law that does not exist today. There is no reactor in this pack and none may be added');
    }
    // The pack's own rule, applied to every tier: an overflowing orphan stream stops the tree.
    if (t > 1) add(!orphanOverflowing(), 'no stream with no destination is over its store');
    return out;
  }

  function isPassed(gid) {
    const gs = gateState[gid];
    return gs.state === 'passed' || gs.state === 'assumed-in-scenario';
  }

  function orphanOverflowing() {
    for (const r of R.values()) if (r.sink === SINK.noFate && Number.isFinite(r.cap) && r.stock >= r.cap * 0.98) return true;
    return false;
  }

  /** The pack asks for this by name and does not claim it, so this file computes it. */
  function chlorineBalanced() {
    let made = 0, used = 0;
    for (const m of M) {
      if (m.units <= 0) continue;
      for (const o of m.outputs) if (o.res === 'chlorine') made += o.kgMin * m.units;
      for (const i of m.inputs) if (i.res === 'chlorine') used += i.kgMin * m.units;
    }
    if (used <= 0) return true;
    return Math.abs(made - used) / used < 0.12;
  }

  function chlorineLedger() {
    let made = 0, used = 0;
    for (const m of M) {
      if (m.units <= 0) continue;
      for (const o of m.outputs) if (o.res === 'chlorine') made += o.kgMin * m.units;
      for (const i of m.inputs) if (i.res === 'chlorine') used += i.kgMin * m.units;
    }
    return {
      madeKgMin: round(made, 3), usedKgMin: round(used, 3),
      shortfallKgMin: round(used - made, 3),
      closes: used <= 0 ? null : Math.abs(made - used) / used < 0.12,
      note: 'The pack says plainly that it has not run this balance and therefore does not claim '
        + 'no top-up chlorine is needed. This is that balance, run over what is actually built.'
    };
  }

  function refreshTiers(w) {
    state.tiers = TIERS.map((t) => {
      const conds = t.tier <= 1 ? [{ ok: true, text: 'none, this is where anyone starts' }] : tierConditions(w, t.tier);
      return {
        tier: t.tier, id: t.id, name: t.name, lane: t.lane, register: t.register,
        summary: t.summary,
        open: tier >= t.tier,
        conditions: conds,
        conditionsMet: conds.filter((c) => c.ok).length,
        conditionsTotal: conds.length,
        completionTest: t.completionTest
      };
    });
    const cur = TIERS.find((t) => t.tier === tier);
    state.tierName = cur ? cur.name : '';
    state.tierSummary = cur ? cur.summary : '';
    const nxt = state.tiers.find((t) => t.tier === tier + 1);
    state.nextTier = nxt ? { tier: nxt.tier, name: nxt.name, blocking: nxt.conditions.filter((c) => !c.ok).map((c) => c.text) } : null;

    if (nxt && nxt.conditions.every((c) => c.ok)) {
      tier = nxt.tier;
      orphanPeakAtTierOpen = state.orphanKg;
      log.push({ day: w.clock.dayIndex, kind: 'tier',
        text: 'Tier ' + tier + ' is open: ' + nxt.name + '. Every condition on it is recorded as met. '
          + 'Nothing about that makes any of it real.' });
      w.bus.emit('subterranean:tier', { tier, name: nxt.name, proposed: true });
    }
  }

  /* ================================================================ the works manager

  On by default, and deliberately limited. It provisions lanes, builds the next thing that is
  clearly needed and shuts down a process whose byproduct has nowhere to go. It never advances a
  tier and it never touches a consent gate, because those are the two decisions this simulation
  is not allowed to make for anybody. Everything it does is logged with the reason, so a player
  reading the decision log is being taught the diagnosis language rather than watched over. */

  function runWorksManager(w) {
    if (!autoWorks) return;

    // 1. A line that has been saturated for a day gets another lane.
    for (const ln of LINES) {
      if (ln.saturatedTicks < TICKS_PER_DAY) continue;
      const cv = CONVEYANCE[ln.conveyance];
      if (ln.lanes >= 4) continue;
      ln.lanes++;
      ln.saturatedTicks = 0;
      const b = B.get(ln.buildingId);
      const r = R.get(ln.res);
      decisions.push({ day: w.clock.dayIndex, kind: 'lane',
        text: 'A second ' + cv.label + ' for ' + (r ? r.name.toLowerCase() : ln.res) + ' at '
          + (b ? b.name : ln.buildingId) + ': the one lane was full for a whole day.' });
      break;   // one a day, so the log stays readable
    }

    // 2. The trunk, if the corridor itself is the thing that is full.
    if (state.trunk.solidPct > 99 && state.trunk.solidLanes < TRUNK.maxSolidLanes) {
      state.trunk.solidLanes++;
      decisions.push({ day: w.clock.dayIndex, kind: 'trunk', text: 'Another belt run down the bore. The corridor was carrying all it could.' });
    } else if (state.trunk.fluidPct > 99 && state.trunk.fluidLanes < TRUNK.maxFluidLanes) {
      state.trunk.fluidLanes++;
      decisions.push({ day: w.clock.dayIndex, kind: 'trunk', text: 'Another pipe run down the bore.' });
    }

    // 3. Build the next thing. Preference: a building whose inputs are backing up, then any
    //    unbuilt building on the open tier.
    let want = null, wantWhy = '';
    for (const b of [...B.values()].sort((a, c) => (a.tier - c.tier) || (a.id < c.id ? -1 : 1))) {
      if (b.units > 0 || canBuild(b)) continue;
      let backlog = 0;
      for (const pid of b.processIds) {
        const m = MbyId.get(pid);
        if (!m || !tierUnlocked(m.unlock)) continue;
        for (const i of m.inputs) {
          const r = R.get(i.res);
          if (r && Number.isFinite(r.cap) && r.cap > 0) backlog = Math.max(backlog, r.stock / r.cap);
        }
      }
      if (!want || backlog > want.backlog) { want = { b, backlog }; wantWhy = backlog > 0.5 ? 'its feedstock was backing up at ' + Math.round(backlog * 100) + ' per cent of store' : 'the tier is open and nothing else was more urgent'; }
    }
    if (want) buildBuilding(w, want.b.id, wantWhy);

    // 4. A machine starved by a supplier that is already flat out gets that supplier a second line.
    for (const m of M) {
      if (m.limit !== 'starved' || m.units <= 0) continue;
      const res = [...R.values()].find((r) => r.name === m.limitDetail);
      if (!res) continue;
      for (const pid of res.producers) {
        const src = MbyId.get(pid);
        if (!src || src.units <= 0 || src.utilisation < 0.97) continue;
        if (addUnit(w, src.buildingId, (B.get(m.buildingId) || {}).name + ' was starved of ' + res.name.toLowerCase() + ' and the supplier was flat out')) return;
      }
    }

    // 5. A stream with nowhere to go, at three quarters of its store, gets its maker switched off
    //    before it stalls the whole line. The pack's own note for that stream goes in the log.
    for (const r of R.values()) {
      if (r.sink !== SINK.noFate || !Number.isFinite(r.cap)) continue;
      if (r.stock < r.cap * 0.75) continue;
      for (const pid of r.producers) {
        const m = MbyId.get(pid);
        if (!m || m.units <= 0 || m.off) continue;
        m.off = true;
        log.push({ day: w.clock.dayIndex, kind: 'orphan',
          text: m.name + ' has been shut down: ' + r.name.toLowerCase() + ' is at three quarters of '
            + 'its store and has no destination. ' + (r.sinkNote || '') });
        w.bus.emit('subterranean:orphan-stall', { resource: r.id, process: m.id, proposed: true });
        return;
      }
    }
  }

  /* ================================================================ the daily pass */

  function dayPass(w) {
    const day = w.clock.dayIndex;

    // Repairs finish.
    for (const m of M) if (m.brokenUntilDay >= 0 && day >= m.brokenUntilDay) { m.brokenUntilDay = -1; }

    // Breakdowns. One draw per built machine, in array order, so the count of draws is a
    // function of the build state and nothing else.
    for (const m of M) {
      if (m.units <= 0 || m.isGenerator) { continue; }
      const roll = rng.float();
      if (m.brokenUntilDay >= 0) continue;
      // Hotter and deeper machines fail more often, and a machine that has been derated by a hot
      // works fails more often again. Modelled.
      const heatFactor = 1 + (m.heatOutKw || 0) / 260 + (1 - thermalDerate) * 2.2;
      const p = 0.0016 * heatFactor * (m.utilisation > 0 ? 1 : 0.25);
      if (roll < p) {
        m.brokenUntilDay = day + 1 + Math.floor(rng.float() * 4);
        log.push({ day, kind: 'breakdown', text: m.name + ' is down for repair for a few days.' });
      }
    }

    // The heavy mineral grade. The pack names this as one of the three numbers that would change
    // most of it, and says none of the three is published. So it is drawn inside a stated band
    // and the band is in the read model rather than hidden in a constant.
    lastGradeFactor = 0.72 + rng.float() * 0.56;

    // The aquifer twin accrues model days while the data lab is running, and validated days only
    // while there is real monitoring to validate against.
    const twinRun = MbyId.get('aquifer-twin-run');
    if (twinRun && twinRun.rate > 0) {
      twinModelDays += 1;
      if (L.dial('borefield-monitoring', 0.5) > 0.35) twinValidatedDays += 1;
    }

    // A wet season of the bore actually running is what tier 3 asks for.
    const bore = MbyId.get('microtunnel-bore');
    if (bore && bore.rate > 0) { boreMetres += (bore.nonMass ? bore.nonMass.advance_m_per_day || 15 : 15) * (bore.rate / Math.max(1, bore.units)); wetSeasonDaysRunning++; }

    // The records. A C-hour is a record that one real hour of community work happened, and
    // recording one is something a person chooses to do. src/systems/economy/chour.js keeps this
    // island's ledger in money only, on purpose, because people do not report volunteer hours and
    // asking them to turns a favour into a transaction. So the recorded rate here is a small share
    // of what the bench could take, and that share is the honest part of the number.
    const rec = MbyId.get('c-hour-record');
    if (rec && rec.rate > 0) {
      const participation = 0.06 + 0.10 * L.dial('consultation-model', 0.5);
      const today = (rec.nonMass ? rec.nonMass.records_per_hour || 20 : 20) * 8 * participation * rec.rate;
      cHours += today;
      cHours365.push(today);
    } else cHours365.push(0);
    const pp = MbyId.get('material-passport-issue');
    if (pp && pp.rate > 0) passports += (pp.nonMass ? pp.nonMass.passports_per_hour || 6 : 6) * 8 * pp.rate;

    // Roll the daily counters.
    landfill365.push(dayLandfillKg);
    divertedT365.push(dayDivertedKg / 1000);
    importSpend365.push(dayImportA$);
    dayLandfillKg = 0; dayDivertedKg = 0; dayImportA$ = 0;
    for (const r of R.values()) { r.inKgDay.roll(); r.outKgDay.roll(); }

    orderImports(w);
    runWorksManager(w);
    refreshGates(w);
    refreshTiers(w);
  }

  function monthPass(w) {
    // Civic movements, monthly at most, because a nudge a day fills the policy buffer in ten
    // weeks and drowns the movements that matter.
    const divertedT = divertedT365.total;
    if (divertedT > 20) {
      nudge(w, 'waste_export_tonnes', -clamp(divertedT / 900, 0, 0.06),
        'the proposed tip loop is catching material that would otherwise go on the barge',
        'infrastructure/subterranean.js', 200);
      nudge(w, 'waste_cost', -clamp(divertedT / 1400, 0, 0.04),
        'less tonnage on the barge is less freight', 'infrastructure/subterranean.js', 200);
    }
    const repair = MbyId.get('repair-bench');
    if (repair && repair.rate > 0) {
      nudge(w, 'local_employment', 0.012, 'the proposed repair bench and maker space are island jobs',
        'infrastructure/subterranean.js', 260);
    }
    const place = MbyId.get('dune-nourishment-place');
    if (place && place.rate > 0) {
      nudge(w, 'dune_condition', 0.02, 'spoil sand placed back on the shoreline rather than stockpiled',
        'infrastructure/subterranean.js', 260);
    }
    const brine = R.get('spent-brine');
    if (brine && brine.outKgDay.total > 40000) {
      nudge(w, 'water_quality_nearshore', -0.02, 'spent brine discharged nearshore from the proposed desalination hall',
        'infrastructure/subterranean.js', 300);
    }
  }

  /* ================================================================ the read model */

  function publishReadModel(w) {
    let running = 0, stalled = 0, tripped = 0, built = 0;
    for (const m of M) {
      if (m.units > 0) built++;
      if (m.rate > 1e-6) running++;
      else if (m.units > 0) stalled++;
      if (m.tripped) tripped++;
    }
    state.running = running; state.stalled = stalled; state.tripped = tripped;
    state.built = [...B.values()].filter((b) => b.units > 0).length;
    state.proposed = B.size;

    state.machines = M.map((m) => ({
      id: m.id, name: m.name, building: m.buildingId, tier: m.tier,
      register: m.register, confidence: m.confidence,
      existence: 'proposed',
      units: m.units, rate: round(m.rate, 3), utilisation: round(m.utilisation, 3),
      powerKw: round(m.powerKw * m.rate, 1),
      heatOutKw: round(m.heatOutKw * m.rate, 1), heatInKw: round(m.heatInKw * m.rate, 1),
      gradeC: m.gradeC,
      limit: m.limit, why: m.limitDetail,
      tripped: m.tripped, broken: m.brokenUntilDay >= 0,
      notes: m.notes
    }));

    state.buildings = [...B.values()].map((b) => ({
      id: b.id, name: b.name, tier: b.tier, existence: b.existence,
      units: b.units, depthM: b.depthM, footprintM2: b.footprintM2,
      connectedKw: b.connectedKw, costA$: b.costA$,
      x: round(b.x, 1), z: round(b.z, 1), y: round(b.y, 1),
      groundM: round(b.groundM || 0, 1), lensM: round((b.lensM || 0) - (island ? island.seaLevel : 0), 1),
      belowWaterTable: !!b.belowWaterTable,
      chainageM: Math.round(b.chainageM || 0), side: b.side || 0, surface: b.surface,
      siting: b.siting,
      blocked: b.units > 0 ? null : canBuild(b)
    }));

    // Lines, worst first, so a panel that shows five shows the five that matter.
    const sorted = LINES.filter((l) => l.flowKgMin > 0 || l.utilisation > 0)
      .sort((a, b) => b.utilisation - a.utilisation);
    state.lines = sorted.slice(0, 40).map((l) => {
      const b = B.get(l.buildingId), r = R.get(l.res);
      return {
        id: l.id, resource: l.res, resourceName: r ? r.name : l.res,
        building: l.buildingId, buildingName: b ? b.name : l.buildingId,
        dir: l.dir, conveyance: l.label, lanes: l.lanes,
        flowKgMin: round(l.flowKgMin, 2), capacityKgMin: round(l.capacityKgMin, 1),
        pct: Math.round(l.utilisation * 100)
      };
    });

    // The one thing a player asks: why is that line stopped?
    let worst = null;
    for (const m of M) {
      if (m.units <= 0 || m.rate >= m.units * m.clock - 1e-6) continue;
      const lost = m.units * m.clock - m.rate;
      if (!worst || lost > worst.lost) worst = { m, lost };
    }
    state.bottleneck = worst ? {
      process: worst.m.id, name: worst.m.name,
      building: worst.m.buildingId,
      limit: worst.m.limit, why: worst.m.limitDetail,
      lostUnits: round(worst.lost, 3),
      plainly: plainBottleneck(worst.m)
    } : null;

    // Stocks worth showing: anything moving or anything filling up.
    state.stock = {};
    let orphanKg = 0;
    const orphanRows = [];
    for (const r of R.values()) {
      if (r.stock > 0.5 || r.inKgDay.total > 0.5) state.stock[r.id] = Math.round(r.stock);
      if (r.sink === SINK.noFate) {
        orphanKg += r.stock;
        if (r.stock > 0.5 || r.producers.length) {
          orphanRows.push({
            resource: r.id, name: r.name, kg: Math.round(r.stock),
            capKg: Number.isFinite(r.cap) ? Math.round(r.cap) : null,
            pct: Number.isFinite(r.cap) ? Math.round((r.stock / r.cap) * 100) : null,
            hazard: r.hazard || null, note: r.sinkNote
          });
        }
      }
    }
    orphanRows.sort((a, b) => (b.pct || 0) - (a.pct || 0) || (a.resource < b.resource ? -1 : 1));
    state.orphans = orphanRows;
    state.orphanKg = Math.round(orphanKg);
    state.residualToLandfillKg = Math.round(landfill365.total);

    state.flowsKgPerDay = {};
    for (const r of R.values()) {
      const v = r.inKgDay.total * TICKS_PER_DAY / Math.max(1, TICKS_PER_DAY);
      if (v > 1) state.flowsKgPerDay[r.id] = Math.round(v);
    }

    state.cHours.recorded = Math.round(cHours);
    state.cHours.recordedRolling365 = Math.round(cHours365.total);
    state.cHours.note = 'A C-hour is a record that one real hour of community work happened. It is not '
      + 'money, it has no price, it is not traded, it buys nothing in this simulation and it is never '
      + 'sold back to the person who did it. Recording one is a choice, not a reporting obligation. '
      + 'src/systems/economy/chour.js keeps this island\'s ledger in money only, on purpose, and this '
      + 'file does not contradict it.';
    state.passports.issued = Math.round(passports);
    state.passports.note = 'A material passport says what a thing is, where it came from, its safe '
      + 'uses, its unknowns, its repair path, its steward and its end of life.';

    state.capital.spentA$ = Math.round(capitalSpent);
    state.capital.importsRolling365A$ = Math.round(importSpend365.total);

    state.events = log.recent(10);
    state.decisions = decisions.recent(8);
    state.scenario = scenario;
    state.tier = tier;
    state.autoWorks = autoWorks;

    // What is standing in the way, plainly, in the order a person would ask.
    const blocking = [];
    for (const g of GATES) {
      const gs = gateState[g.id];
      if (gs.state === 'passed' || gs.state === 'assumed-in-scenario') continue;
      const needed = M.some((m) => m.units === 0 && m.gates.includes(g.id) && tierUnlocked(m.unlock));
      if (needed || g.kind === GATE_KIND.notOurs) blocking.push(gs.name + ': ' + gs.state);
    }
    state.blockedBy = blocking;
  }

  function plainBottleneck(m) {
    const b = B.get(m.buildingId);
    const where = b ? b.name : m.buildingId;
    switch (m.limit) {
      case 'starved': return where + ' is short of ' + m.limitDetail.toLowerCase() + '. Whatever makes that is not keeping up.';
      case 'line in': return 'The ' + m.limitDetail + ' into ' + where + ' is full. Add a lane or make less of it.';
      case 'line out': return 'The ' + m.limitDetail + ' out of ' + where + ' is full. Nothing is taking it away fast enough.';
      case 'store full': return 'Nowhere to put the ' + m.limitDetail.toLowerCase() + '. The store is full and the consumer is down.';
      case 'nowhere to put it': return 'The ' + m.limitDetail.toLowerCase() + ' has no destination at all. This is not a bottleneck, it is the design asking a question nobody has answered.';
      case 'heat short': return where + ' is a customer of the thermal cascade and the ' + m.limitDetail + ' step is not delivering. Something upstairs is cold.';
      case 'corridor trunk': return 'The bore itself is carrying all it can. Everything underground is scaled back together.';
      case 'tripped': return where + ' tripped: there was no power headroom for it and the deepest and hottest go first.';
      case 'consent': return 'Stopped: ' + m.limitDetail + '. There is no override for this and there should not be.';
      case 'source closed': return 'The source is closed: ' + m.limitDetail.toLowerCase() + '.';
      case 'down for repair': return where + ' is down for repair.';
      case 'switched off': return where + ' has been switched off, most likely because something it makes has nowhere to go.';
      default: return where + ' is running.';
    }
  }

  /* ================================================================ zero waste audit */

  function buildAudit() {
    const rows = [];
    for (const r of R.values()) {
      if (r.cls === 'energy' || r.cls === 'record') continue;
      if (!r.producers.length) continue;
      rows.push({
        resource: r.id, name: r.name, class: r.cls,
        producedKgMin: round(r.producedKgMin, 4),
        consumers: r.consumers.length,
        destination: r.sink || 'consumed inside the graph',
        note: r.sinkNote || null,
        hazard: r.hazard || null
      });
    }
    rows.sort((a, b) => (a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : (a.resource < b.resource ? -1 : 1)));
    const orphanCount = rows.filter((x) => x.destination === SINK.noFate).length;
    return {
      streams: rows.length,
      withDestination: rows.length - orphanCount,
      withNoFate: orphanCount,
      packOrphanCount: (pack.orphan_streams || []).length,
      note: 'Every stream the graph produces, and where it goes. The pack\'s tier three completion '
        + 'test is that this list has no blanks and that the orphan list is shorter than it was when '
        + 'the tier opened. Nothing here invents a destination to make the audit look better.',
      rows
    };
  }

  function buildUnsourced() {
    const rows = [];
    for (const r of R.values()) {
      if (!r.isImport) continue;
      rows.push({
        resource: r.id, name: r.name,
        consumedKgMin: round(r.consumedKgMin, 4),
        namedByPack: r.importNamedByPack,
        note: r.sourceNote
      });
    }
    rows.sort((a, b) => (a.namedByPack === b.namedByPack ? (a.resource < b.resource ? -1 : 1) : (a.namedByPack ? 1 : -1)));
    return rows;
  }

  /* ================================================================ intents */

  function applyScenario(w, name) {
    scenario = name;
    const set = (gid, st, detail) => {
      const gs = gateState[gid];
      gs.state = st; gs.assumed = st === 'assumed-in-scenario'; gs.since = w.clock.dayIndex; gs.detail = detail;
    };
    const notOurs = GATES.filter((g) => g.kind === GATE_KIND.notOurs).map((g) => g.id);
    if (name === 'consent-given') {
      for (const gid of notOurs) {
        set(gid, 'assumed-in-scenario',
          'ASSUMED FOR THIS SCENARIO ONLY. Nobody has been asked and nobody has said yes. This label '
          + 'never becomes "granted", because this twin cannot grant it.');
      }
      state.scenarioNote = 'Consent is assumed, not given. Every gate held by the Quandamooka People '
        + 'or by the island community is marked assumed-in-scenario and stays marked that way. The '
        + 'regulated approvals still have to be worked through in sim time.';
      log.push({ day: w.clock.dayIndex, kind: 'scenario',
        text: 'Scenario: consent assumed. Nobody has been asked. This is a what-if branch and every '
          + 'reading taken inside it carries that.' });
    } else if (name === 'consent-refused') {
      for (const gid of notOurs) set(gid, 'refused', 'Refused in this scenario. That is an answer, and a good one to hear.');
      // Everything below ground stops.
      for (const m of M) { const b = B.get(m.buildingId); if (b && !b.surface) m.units = 0; }
      for (const b of B.values()) if (!b.surface) { b.units = 0; b.built = false; }
      tier = 1;
      state.scenarioNote = 'The answer is no. Nothing goes under the sand. What is left is the tier one '
        + 'surface loop, which needs nobody\'s permission but the landholder\'s, and it is worth '
        + 'watching: the repair bench, the tip triage bay, the cullet crusher, the shredder, the '
        + 'compost windrow, the retort, the rooftop panels, the passports and the open groundwater '
        + 'model. That is the honest floor of this design and it is not nothing.';
      log.push({ day: w.clock.dayIndex, kind: 'scenario',
        text: 'Scenario: consent refused. Every excavation concept is off. The surface loop keeps '
          + 'running, and the question worth asking now is how much of the case it carries on its own.' });
    } else {
      scenario = 'as-it-stands';
      for (const gid of notOurs) set(gid, 'not sought', 'Not sought. Nobody has asked.');
      state.scenarioNote = 'As it stands. Nobody has sought consent for anything, so nothing below the '
        + 'sand can start. This is the true state of this design on this island today.';
    }
    refreshGates(w);
  }

  world.bus.on('ui:intent', (p) => {
    if (!p || typeof p.kind !== 'string' || !p.kind.startsWith('subterranean:')) return;
    const k = p.kind.slice('subterranean:'.length);
    if (k === 'scenario' && typeof p.scenario === 'string') applyScenario(world, p.scenario);
    else if (k === 'build' && p.id) buildBuilding(world, p.id, 'asked for from the interface');
    else if (k === 'units' && p.id && Number.isFinite(p.units)) {
      const b = B.get(p.id);
      if (b && b.built) { b.units = clamp(Math.round(p.units), 1, 6); for (const pid of b.processIds) { const m = MbyId.get(pid); if (m && m.units > 0) m.units = b.units; } }
    } else if (k === 'clock' && p.id && Number.isFinite(p.clock)) {
      const m = MbyId.get(p.id); if (m) m.clock = clamp(p.clock, 0, 1);
    } else if (k === 'switch' && p.id) {
      const m = MbyId.get(p.id); if (m) m.off = !!p.off;
    } else if (k === 'add-lane' && p.line) {
      const ln = lineIndex.get(p.line); if (ln && ln.lanes < 4) ln.lanes++;
    } else if (k === 'trunk' && p.what) {
      if (p.what === 'solid' && state.trunk.solidLanes < TRUNK.maxSolidLanes) state.trunk.solidLanes++;
      if (p.what === 'fluid' && state.trunk.fluidLanes < TRUNK.maxFluidLanes) state.trunk.fluidLanes++;
    } else if (k === 'auto-works') autoWorks = !!p.on;
    else if (k === 'discipline' && typeof p.discipline === 'string') discipline = p.discipline === 'run-regardless' ? 'run-regardless' : 'protect-the-island';
    else if (k === 'seek' && p.gate) {
      const gs = gateState[p.gate];
      const g = GATES.find((x) => x.id === p.gate);
      if (gs && g && g.kind === GATE_KIND.regulated && gs.state === 'not sought') {
        gs.state = 'in progress'; gs.since = world.clock.dayIndex;
        log.push({ day: world.clock.dayIndex, kind: 'gate', text: gs.name + ' has been started. ' + gs.note });
      }
    }
  });

  /** A small console handle, in the same spirit as world.island. Panels should use intents. */
  world.subterranean = {
    scenario: (n) => applyScenario(world, n),
    build: (id) => buildBuilding(world, id, 'asked for from the console'),
    units: (id, n) => world.bus.emit('ui:intent', { kind: 'subterranean:units', id, units: n }),
    clock: (id, c) => world.bus.emit('ui:intent', { kind: 'subterranean:clock', id, clock: c }),
    addLane: (line) => world.bus.emit('ui:intent', { kind: 'subterranean:add-lane', line }),
    autoWorks: (on) => { autoWorks = !!on; },
    discipline: (d) => { discipline = d === 'run-regardless' ? 'run-regardless' : 'protect-the-island'; },
    seek: (gate) => world.bus.emit('ui:intent', { kind: 'subterranean:seek', gate }),
    audit: () => buildAudit(),
    chlorine: () => chlorineLedger(),
    lensSurfaceM
  };

  /* ================================================================ registration */

  return world.register({
    id: 'subterranean',
    phase: 'infrastructure',
    order: 60,     // after power, water, waste and telecoms, so it reads their settled state

    init(w) {
      island = w.island || null;
      const corridor = layout(w);
      state.siting.corridor = corridor.map((c) => ({
        s: c.s, x: round(c.x, 1), z: round(c.z, 1),
        groundM: round(c.groundM, 1),
        lensM: round(c.lensM, 1),
        coverM: round(c.groundM - c.lensM, 1),
        cover: c.cover, region: c.region
      }));
      state.siting.sites = [SITING.hub, SITING.tip, SITING.shaft, SITING.shore].map((s) => {
        const p = island ? island.project(s.lon, s.lat) : { x: 0, z: 0 };
        return { id: s.id, label: s.label, lon: s.lon, lat: s.lat, x: round(p.x, 1), z: round(p.z, 1),
          groundM: island ? round(island.height(p.x, p.z), 1) : 0 };
      });
      state.siting.shaft = state.siting.sites.find((s) => s.id === 'jacking-pit') || null;
      state.siting.bearingDeg = SITING.corridorBearingDeg;
      state.siting.lengthM = SITING.corridorLengthM;
      state.lensSurfaceM = lensSurfaceM;
      state.lensBasis = LENS.basis;
      state.ghybenHerzberg = LENS.ghybenHerzberg;

      state.zeroWasteAudit = buildAudit();
      state.unsourcedInputs = buildUnsourced();
      state.chlorine = chlorineLedger();
      state.packSting = pack.power_reality_check ? {
        totalConnectedKw: pack.power_reality_check.total_connected_load_kw,
        totalGeneratingKw: pack.power_reality_check.total_generating_kw_in_pack,
        islandDemandKwhDay: pack.power_reality_check.island_estimated_demand_kwh_per_day,
        rooftopKwhDay: pack.power_reality_check.rooftop_potential_kwh_per_day,
        note: pack.power_reality_check.note,
        worstOffenders: pack.power_reality_check.the_three_worst_offenders,
        forPlay: pack.power_reality_check.what_this_means_for_play
      } : null;
      state.honesty = pack.honesty || null;
      state.about = pack.about || null;
      state.registerScale = pack.register_scale || null;

      // The default scenario is the true one: nobody has asked anybody anything.
      applyScenario(w, 'as-it-stands');

      // Tier one needs nobody's permission but the landholder's, so the twin runs the tier one
      // proposal from the start. That is a proposal running in a model, not a shed on the island.
      for (const b of [...B.values()].filter((x) => x.tier === 1).sort((x, y) => (x.id < y.id ? -1 : 1))) {
        buildBuilding(w, b.id, 'tier one is lawful today and needs nobody\'s permission but the landholder\'s');
      }

      notes.push('Every building here is proposed. data/subterranean.json marks all forty-three that way '
        + 'and this simulation never says otherwise.');
      notes.push('Siting is this project\'s, not the pack\'s: the pack carries no coordinates. '
        + 'The candidate corridor runs east-south-east from Dunwich (Goompi) and is tested against the '
        + 'Naree Budjong Djara National Park outline in data/geography.json before anything is placed.');
      notes.push('The freshwater lens surface is modelled and calibrated to one published number: Blue '
        + 'Lake is a window lake at 72 m. Measuring the real thing is what tier one exists to do.');
      if (state.unsourcedInputs.length) {
        const extra = state.unsourcedInputs.filter((r) => !r.namedByPack).length;
        notes.push('The graph consumes ' + state.unsourcedInputs.length + ' inputs it never produces. '
          + 'The pack names some of them in imports_that_never_close; ' + extra + ' are not named there '
          + 'and are reported here rather than closed quietly.');
      }
      ready = true;
      state.ready = true;
      refreshGates(w);
      refreshTiers(w);
      publishReadModel(w);
    },

    tick(w) {
      if (!ready) return;
      const day = w.clock.dayIndex;
      if (day !== lastDay) {
        if (lastDay >= 0) dayPass(w);
        lastDay = day;
        const month = w.clock.month;
        if (month !== lastMonth) { if (lastMonth >= 0) monthPass(w); lastMonth = month; }
      }

      refreshSources(w);

      // Pass one: material and lines only.
      for (const m of M) m.tripped = false;
      solve(1);
      const t1 = trunkLoad();
      state.trunk.solidKgMin = round(t1.solid, 1);
      state.trunk.fluidKgMin = round(t1.fluid, 1);
      const solidCap = state.trunk.solidLanes * TRUNK.solidsPerLane;
      const fluidCap = state.trunk.fluidLanes * TRUNK.fluidsPerLane;
      state.trunk.solidPct = Math.round((t1.solid / Math.max(1, solidCap)) * 100);
      state.trunk.fluidPct = Math.round((t1.fluid / Math.max(1, fluidCap)) * 100);
      const trunkFraction = Math.min(
        t1.solid > solidCap ? solidCap / t1.solid : 1,
        t1.fluid > fluidCap ? fluidCap / t1.fluid : 1
      );

      // Power decides who is allowed to run at all, then the second pass settles the rates.
      solve(trunkFraction);
      const anyTripped = runPower(w);
      if (anyTripped) solve(trunkFraction);

      trunkLoad();
      applyFlows(w);
      drainSinks(w);
      runHeat(w);
      runLens(w);

      // The mineral grade the bore actually turns up, inside the stated band.
      const split = MbyId.get('heavy-mineral-split');
      if (split) split.gradeFactor = lastGradeFactor;

      publishReadModel(w);
    },

    describe(w) {
      const gateSummary = {};
      for (const g of GATES) gateSummary[g.id] = gateState[g.id].state;
      return {
        existence: 'proposed',
        tier,
        scenario,
        built: state.built,
        running: state.running,
        stalled: state.stalled,
        connectedLoadKw: state.connectedLoadKw,
        generationKw: state.generationKw,
        drawKw: state.drawKw,
        orphanKg: state.orphanKg,
        residual365Kg: state.residualToLandfillKg,
        groundLiftK: state.heat.groundLiftK,
        heatRejectKw: state.heat.rejectKw,
        lensDrawdownMm: state.lens.drawdownMm,
        trunkPct: state.trunk.solidPct,
        cHours: state.cHours.recorded,
        bottleneck: state.bottleneck ? state.bottleneck.process + ':' + state.bottleneck.limit : null,
        blockedBy: state.blockedBy.slice(0, 3),
        gates: gateSummary
      };
    },

    save() {
      return {
        tier, scenario, autoWorks, discipline,
        groundLiftK, sandBatteryKwhTh, hydroKwh, lensDrawdownMm,
        twinModelDays, twinValidatedDays, boreMetres, wetSeasonDaysRunning,
        cHours, passports, capitalSpent, lastDay, lastMonth,
        gates: Object.fromEntries(Object.entries(gateState).map(([k, v]) => [k, { state: v.state, since: v.since }])),
        buildings: [...B.values()].filter((b) => b.units > 0).map((b) => ({ id: b.id, units: b.units })),
        machines: M.filter((m) => m.units > 0 || m.off).map((m) => ({ id: m.id, units: m.units, clock: m.clock, off: m.off })),
        lines: LINES.filter((l) => l.lanes > 1).map((l) => ({ id: l.id, lanes: l.lanes })),
        trunk: { solid: state.trunk.solidLanes, fluid: state.trunk.fluidLanes },
        stock: Object.fromEntries([...R.values()].filter((r) => r.stock > 0.5).map((r) => [r.id, round(r.stock, 2)])),
        imports: pendingImports.slice(),
        log: log.save()
      };
    },

    load(w, s) {
      if (!s) return;
      tier = s.tier || 1;
      scenario = s.scenario || 'as-it-stands';
      autoWorks = s.autoWorks !== false;
      discipline = s.discipline || 'protect-the-island';
      groundLiftK = s.groundLiftK || 0;
      sandBatteryKwhTh = s.sandBatteryKwhTh || 0;
      hydroKwh = s.hydroKwh || 0;
      lensDrawdownMm = s.lensDrawdownMm || 0;
      twinModelDays = s.twinModelDays || 0;
      twinValidatedDays = s.twinValidatedDays || 0;
      boreMetres = s.boreMetres || 0;
      wetSeasonDaysRunning = s.wetSeasonDaysRunning || 0;
      cHours = s.cHours || 0;
      passports = s.passports || 0;
      capitalSpent = s.capitalSpent || 0;
      lastDay = Number.isFinite(s.lastDay) ? s.lastDay : -1;
      lastMonth = Number.isFinite(s.lastMonth) ? s.lastMonth : -1;
      for (const [k, v] of Object.entries(s.gates || {})) if (gateState[k]) { gateState[k].state = v.state; gateState[k].since = v.since || 0; }
      for (const b of B.values()) { b.units = 0; b.built = false; }
      for (const m of M) { m.units = 0; m.off = false; m.clock = 1; }
      for (const row of s.buildings || []) { const b = B.get(row.id); if (b) { b.units = row.units; b.built = row.units > 0; } }
      for (const row of s.machines || []) { const m = MbyId.get(row.id); if (m) { m.units = row.units; m.clock = row.clock ?? 1; m.off = !!row.off; } }
      for (const ln of LINES) ln.lanes = 1;
      for (const row of s.lines || []) { const ln = lineIndex.get(row.id); if (ln) ln.lanes = row.lanes; }
      if (s.trunk) { state.trunk.solidLanes = s.trunk.solid || 1; state.trunk.fluidLanes = s.trunk.fluid || 1; }
      for (const r of R.values()) r.stock = 0;
      for (const [k, v] of Object.entries(s.stock || {})) { const r = R.get(k); if (r) r.stock = v; }
      pendingImports.length = 0;
      for (const o of s.imports || []) pendingImports.push(o);
      log.load(s.log);
      refreshGates(w);
      refreshTiers(w);
      publishReadModel(w);
    }
  });
}
