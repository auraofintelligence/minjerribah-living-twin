// What a person wants, and what they decide to do about it.
//
// Nine needs, decaying at different rates by age and by the job somebody does, feeding a utility
// score over about fifty things a person on this island can actually do. There is no script. A
// resident picks the highest scoring action available to them right now, and because the score
// carries traits, weather, tide, swell, the day of the week and a small deterministic jitter, two
// neighbours in the same household with the same needs will not always do the same thing. That is
// the point: an agent has to be able to surprise you.
//
// THE SEVEN, AND THE TWO THAT ARE ABOUT HERE
//   hunger, energy, hygiene, bladder, fun, social, comfort are the ordinary ones and they work the
//   way you would expect: one is satisfied, zero is desperate, and the urgency curve is convex so a
//   need under a fifth of full dominates everything else.
//
//   place is attachment to this island: being on it, being outside on it, being at the water. It
//   applies to everybody and it fills faster for people who have been here longer. A resident who
//   has not been near the water in a fortnight starts choosing the beach over the couch.
//
//   islandFatigue is the one nobody models and everybody here lives with: the barge queue, the
//   freight cost of a fridge, the last boat, the same forty faces, and a town that quadruples in
//   January and empties in June. It runs the other way from the rest: zero is fine, one is ground
//   down. It does not make a person unhappy so much as it makes them short, and it drives the
//   behaviour that follows from that: a day on the mainland, a big night, a snap at somebody, and
//   in the end, in population.js, leaving.
//
// CULTURAL NOTE. The brief for this slice asked for a "connection to Country" need for the
// residents it applies to. It is not built, and it is not built on purpose. data/lore.json
// prohibitions carries a blocking rule, no-aboriginal-characters-with-invented-culture: no
// simulated resident may be assigned Aboriginality, cultural knowledge, cultural obligations or a
// cultural role. A need that only some agents have, keyed to who they are, is exactly that, and
// connection to Country is a Quandamooka matter that belongs to Quandamooka people and not to a
// simulation written from public records. What is here instead is `place`, which every resident
// carries and which is about attachment to where you live. The gap is logged in
// docs/CULTURAL-REVIEW.md item R1 for QYAC to resolve, which is the process the contract sets out.
//
// PERFORMANCE, AND WHERE THE NEXT WIN IS
//   Needs live in one flat Float32Array indexed by the slot population.js hands out, and every
//   person's `p.n` is a subarray view onto it rather than a copy. Half the roster is updated each
//   tick on a twenty minute step. Decisions are not made every tick: a person re-decides when their
//   action runs out or when a need crosses a hard floor, which is about two hundred and eighty
//   decisions a tick rather than two thousand. Before a decision is costed, the table is cut twice:
//   once by WHEN, the part of a gate that only reads the world, evaluated once a tick; and once by
//   WHO, the part that only reads the person, evaluated once when they are attached.
//
//   Measured on a full sim-year in Node with 2,068 residents and up to 8,000 visitors: this system
//   is about 2.5 ms a tick and the whole simulation is about 3.6 ms at its best sample and 4.4 ms
//   at its median, against a contract budget of 4 ms for everything. This slice is the hottest
//   thing in the world and it is close to the ceiling with seven slices still to land.
//
//   The next win is named and it is not a tuning pass: about two thirds of this system's cost is
//   scoreList and chooseAction, and almost all of that is closure calls. Compiling the gates and
//   bonuses into a numeric form over typed arrays, so a decision is arithmetic rather than forty
//   function calls, should roughly halve it. Nothing above that line is worth another look first.

export const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social', 'comfort', 'place', 'islandFatigue'];
const N = NEEDS.length;
const HUNGER = 0, ENERGY = 1, HYGIENE = 2, BLADDER = 3, FUN = 4, SOCIAL = 5, COMFORT = 6, PLACE = 7, FATIGUE = 8;

/**
 * Base decay per hour, for a working-age adult. Modelled: no measured figure exists for any of it.
 * Every one of these is budgeted against what a day can put back, so a population left to run for a
 * sim-year settles instead of grinding to zero. Hunger empties in about thirteen waking hours and
 * three meals fill it; energy empties in about fifteen and a night's sleep more than fills it;
 * hygiene empties in a day and a shower fills it.
 */
const BASE_DECAY = [0.075, 0.022, 0.035, 0.200, 0.078, 0.064, 0.050, 0.020, 0.0];

/** How much of that still happens while somebody is asleep. Nobody gets hungry at the same rate
 *  in their sleep, and nobody gets bored at all. */
const SLEEP_SCALE = [0.35, 0.0, 0.30, 0.15, 0.0, 0.0, 1.0, 0.0, 1.0];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Meal times, offset per person by up to an hour. Without the offset half the island sits down to
 *  breakfast inside the same ten minutes, which is not what a street looks like at seven. */
function mealTimeFor(p, c) {
  const h = c.hour - ((p.id % 7) - 3) * 0.17;
  return (h >= 6.5 && h < 8.5) || (h >= 12 && h < 13.5) || (h >= 17.5 && h < 20);
}

/** Convex urgency. A need at four fifths barely registers; a need at a tenth drowns out the rest. */
function urgency(v) {
  const d = 1 - v;
  return d * d * (1 + 2 * d);
}

/* ------------------------------------------------------------------ the action table

Each entry advertises what it does for which needs, per hour. `gate` is the cheap test that runs
before anything is scored, and it is what keeps this inside the tick budget: on a wet Tuesday
morning in June most of this table is not available to most people and never gets costed.

`place` resolves a location. Real places and real businesses only, from data/places.json and
data/businesses.json through world.residents.places. Nothing here names a road, a beach, a shop or
an organisation that is not in a pack. */

const A = (o) => o;

const ACTIONS = [
  /* ---- the house ---- */
  A({
    id: 'sleep', label: 'asleep', at: 'home', mode: 'idle', dur: [300, 540], sleeping: true,
    gains: { energy: 0.125, comfort: 0.040 },
    gate: (p, c) => c.night || p.n[ENERGY] < 0.12,
    bonus: (p, c) => (c.night ? 2.4 : 0) + (c.lateNight ? 1.6 : 0) + p.traits.homebody * 0.2,
    why: (p, c) => (c.night ? 'it is the middle of the night' : 'ran out of legs and went to bed')
  }),
  A({
    id: 'nap', label: 'having a lie down', at: 'home', mode: 'idle', dur: [40, 95],
    gains: { energy: 0.10, comfort: 0.05 },
    gate: (p, c) => !c.night && p.n[ENERGY] < 0.45 && (p.role === 'elder' || p.role === 'preschool' || p.workLoad === 'shift'),
    why: () => 'worn out in the middle of the day'
  }),
  A({
    id: 'eat-at-home', label: 'eating at home', at: 'home', mode: 'idle', dur: [25, 50],
    gains: { hunger: 1.05, comfort: 0.12, social: 0.25 },
    gate: (p, c) => !c.night || p.n[HUNGER] < 0.2,
    bonus: (p, c) => (mealTimeFor(p, c) ? 1.1 : 0),
    why: (p, c) => (!mealTimeFor(p, c) ? 'hungry' : c.hour < 10 ? 'breakfast' : c.hour < 15 ? 'lunch' : 'dinner')
  }),
  A({
    id: 'cook-for-the-house', label: 'cooking for the house', at: 'home', mode: 'idle', dur: [45, 80],
    gains: { hunger: 0.9, social: 0.55, fun: 0.2, comfort: 0.1 },
    gate: (p, c) => p.age >= 16 && p.householdSize > 1 && (mealTimeFor(p, c) || p.n[HUNGER] < 0.3),
    why: () => 'somebody has to cook'
  }),
  A({
    id: 'shower', label: 'in the shower', at: 'home', mode: 'idle', dur: [15, 25],
    gains: { hygiene: 3.2, comfort: 0.3 },
    gate: (p) => p.n[HYGIENE] < 0.5,
    why: () => 'covered in salt and sand'
  }),
  A({
    id: 'toilet', label: 'in the bathroom', at: 'home', mode: 'idle', dur: [10, 10],
    gains: { bladder: 6.0 },
    gate: (p) => p.n[BLADDER] < 0.32,
    why: () => 'needed the toilet'
  }),
  A({
    id: 'sit-with-the-house', label: 'sitting around with the house', at: 'home', mode: 'idle', dur: [40, 120],
    gains: { social: 0.6, comfort: 0.45, fun: 0.3 },
    gate: (p, c) => p.householdSize > 1 && !c.night,
    bonus: (p) => p.traits.homebody * 0.5,
    why: () => 'everyone was home at once'
  }),
  A({
    id: 'the-couch', label: 'on the couch', at: 'home', mode: 'idle', dur: [45, 130],
    gains: { fun: 0.42, comfort: 0.55, energy: 0.02 },
    gate: (p, c) => !c.night,
    bonus: (p) => p.traits.homebody * 0.6 - p.traits.outdoors * 0.3,
    why: () => 'nothing else on'
  }),
  A({
    id: 'jobs-around-the-house', label: 'doing jobs around the house', at: 'home', mode: 'idle', dur: [40, 110],
    gains: { comfort: 0.5, fun: -0.12 },
    gate: (p, c) => p.age >= 14 && c.daylight,
    why: () => 'the house needed it'
  }),
  A({
    id: 'the-yard', label: 'out in the yard', at: 'home', mode: 'idle', dur: [45, 140],
    gains: { comfort: 0.34, place: 0.55, fun: 0.25, energy: -0.045 },
    gate: (p, c) => c.daylight && !c.raining && c.apparentC < 33 && p.age >= 12,
    bonus: (p) => p.traits.outdoors * 0.6,
    why: (p, c) => (c.raining ? 'it will be too wet tomorrow' : 'the yard gets away from you')
  }),
  A({
    id: 'bins-out', label: 'putting the bins out', at: 'home', mode: 'walk', dur: [10, 10],
    gains: { comfort: 0.15, social: 0.2 },
    gate: (p, c) => c.binNight && p.age >= 12 && c.hour >= 17,
    bonus: () => 1.5,
    why: () => 'bin night'
  }),
  A({
    id: 'ring-the-mainland', label: 'on the phone to the mainland', at: 'home', mode: 'idle', dur: [20, 45],
    gains: { social: 0.75, islandFatigue: -0.006 },
    gate: (p, c) => !c.night && p.age >= 16,
    why: () => 'everybody they grew up with lives over there'
  }),

  /* ---- work, school and the boat ---- */
  A({
    id: 'work-shift', label: 'at work', at: 'work', mode: 'commute', dur: [60, 60], duty: true,
    gains: { social: 0.22, fun: -0.05, hygiene: -0.10, energy: -0.035, comfort: -0.08 },
    gate: (p, c) => !!p.duty && p.duty.kind === 'work',
    bonus: () => 6,
    why: (p) => (p.duty && p.duty.reason) || 'on shift'
  }),
  A({
    id: 'school', label: 'at school', at: 'school', mode: 'commute', dur: [60, 60], duty: true,
    gains: { social: 0.45, fun: 0.15, energy: -0.03 },
    gate: (p) => !!p.duty && p.duty.kind === 'school',
    bonus: () => 6,
    why: () => 'school'
  }),
  A({
    id: 'the-school-run', label: 'on the school run', at: 'school', mode: 'drive', dur: [25, 40], duty: true,
    gains: { social: 0.5, comfort: -0.05 },
    gate: (p) => !!p.duty && p.duty.kind === 'school-run',
    bonus: () => 5,
    why: () => 'dropping the kids at the school gate'
  }),
  A({
    id: 'crossing-out', label: 'on the boat to the mainland', at: 'ferry', mode: 'boat', dur: [40, 60], duty: true,
    gains: { islandFatigue: 0.01, energy: -0.025, social: 0.15 },
    gate: (p) => !!p.duty && p.duty.kind === 'crossing-out',
    bonus: () => 7,
    why: (p) => (p.duty && p.duty.reason) || 'catching the boat across'
  }),
  A({
    id: 'on-the-mainland', label: 'over on the mainland', at: 'mainland', mode: 'offisland', dur: [240, 480], duty: true,
    gains: { islandFatigue: -0.0125, fun: 0.15, social: 0.2, energy: -0.04 },
    gate: (p) => !!p.duty && p.duty.kind === 'mainland',
    bonus: () => 7,
    why: (p) => (p.duty && p.duty.reason) || 'a day across the bay'
  }),
  A({
    id: 'crossing-back', label: 'on the boat home', at: 'ferry', mode: 'boat', dur: [40, 60], duty: true,
    gains: { islandFatigue: -0.005, place: 0.35, energy: -0.02 },
    gate: (p) => !!p.duty && p.duty.kind === 'crossing-back',
    bonus: () => 7,
    why: () => 'coming home on the boat'
  }),
  A({
    id: 'waiting-for-the-boat', label: 'waiting at the terminal', at: 'ferry', mode: 'walk', dur: [20, 90],
    gains: { islandFatigue: 0.03, fun: -0.2, social: 0.3 },
    gate: (p) => !!p.duty && p.duty.kind === 'waiting',
    bonus: () => 6,
    why: (p) => (p.duty && p.duty.reason) || 'the boat is late'
  }),
  A({
    id: 'stuck-on-the-mainland', label: 'stuck on the mainland', at: 'mainland', mode: 'offisland', dur: [420, 720],
    gains: { islandFatigue: 0.015, comfort: -0.25, social: -0.1 },
    gate: (p) => !!p.duty && p.duty.kind === 'stranded',
    bonus: () => 9,
    why: () => 'the last boat went without them'
  }),
  A({
    id: 'looking-for-work', label: 'chasing work', at: 'home', mode: 'idle', dur: [60, 120],
    gains: { islandFatigue: 0.01, fun: -0.15 },
    gate: (p, c) => p.occupationId === 'unemployed' && c.workHours && !c.weekend,
    bonus: () => 1.4,
    why: () => 'there are four jobs on this island and thirty people after them'
  }),
  A({
    id: 'a-callout', label: 'out on a callout', at: 'island', mode: 'drive', dur: [60, 200], duty: true,
    gains: { place: 0.6, social: 0.8, fun: 0.3, energy: -0.25, comfort: -0.3 },
    gate: (p) => !!p.duty && p.duty.kind === 'callout',
    bonus: () => 9,
    why: (p) => (p.duty && p.duty.reason) || 'the pager went'
  }),
  A({
    id: 'on-patrol', label: 'on patrol', at: 'point-lookout-slsc', mode: 'drive', dur: [120, 240], duty: true,
    gains: { place: 0.5, social: 0.7, fun: 0.35, energy: -0.15 },
    gate: (p) => !!p.duty && p.duty.kind === 'patrol',
    bonus: () => 6,
    why: () => 'on the roster at the surf club'
  }),

  /* ---- the towns ---- */
  A({
    id: 'coffee-and-a-chat', crowdShy: true, label: 'out for a coffee', at: 'cafe', mode: 'walk', dur: [30, 60],
    gains: { fun: 0.5, social: 0.95, hunger: 0.35, islandFatigue: -0.006 },
    gate: (p, c) => c.hour >= 6 && c.hour < 14 && p.age >= 14,
    bonus: (p) => p.traits.sociable * 0.9,
    why: () => 'the coffee is an excuse and everybody knows it'
  }),
  A({
    id: 'counter-lunch', crowdShy: true, label: 'having lunch out', at: 'pub', mode: 'drive', dur: [50, 90],
    gains: { hunger: 1.35, social: 0.65, fun: 0.55 },
    gate: (p, c) => c.hour >= 11 && c.hour < 15 && p.age >= 16,
    bonus: (p, c) => (c.weekend ? 0.6 : 0) + p.traits.sociable * 0.4,
    why: () => 'could not be bothered cooking'
  }),
  A({
    id: 'a-night-at-the-club', crowdShy: true, label: 'down at the club', at: 'club', mode: 'drive', dur: [90, 210],
    gains: { social: 1.35, fun: 1.2, hunger: 0.55, islandFatigue: -0.015 },
    gate: (p, c) => c.hour >= 16 && c.hour < 23 && p.age >= 18,
    bonus: (p, c) => p.traits.sociable * 1.1 + (c.friday || c.saturday ? 0.9 : 0) + p.n[FATIGUE] * 0.8,
    why: (p) => (p.n[FATIGUE] > 0.55 ? 'needed to be somewhere that was not the house' : 'the usual crowd would be there')
  }),
  A({
    id: 'the-shop-run', crowdShy: true, label: 'up at the shop', at: 'shop', mode: 'drive', dur: [25, 55],
    gains: { hunger: 0.25, comfort: 0.35, social: 0.4 },
    gate: (p, c) => c.hour >= 7 && c.hour < 19 && p.age >= 15,
    bonus: (p, c) => (c.peak ? -0.4 : 0.2),
    why: (p, c) => (c.peak ? 'the shop is picked over in January and it still has to be done' : 'out of everything')
  }),
  A({
    id: 'the-markets', crowdShy: true, label: 'at the markets', at: 'point-lookout-markets', mode: 'drive', dur: [60, 120],
    gains: { fun: 0.7, social: 0.9, hunger: 0.3, place: 0.3 },
    gate: (p, c) => c.marketDay && c.hour >= 8 && c.hour < 14,
    bonus: (p) => p.traits.sociable * 0.6,
    why: () => 'markets are on'
  }),
  A({
    id: 'an-appointment', label: 'at an appointment', at: 'clinic', mode: 'drive', dur: [40, 80], duty: true,
    gains: { comfort: 0.15, islandFatigue: 0.01 },
    gate: (p) => !!p.duty && p.duty.kind === 'appointment',
    bonus: () => 5,
    why: (p) => (p.duty && p.duty.reason) || 'an appointment'
  }),
  A({
    id: 'bowls-or-a-game', label: 'having a game', at: 'club', mode: 'drive', dur: [90, 180],
    gains: { fun: 0.95, social: 1.05, energy: -0.075, place: 0.15 },
    gate: (p, c) => c.daylight && p.age >= 45 && !c.raining,
    bonus: (p) => p.traits.sociable * 0.5,
    why: () => 'the same four have played every week for years'
  }),
  A({
    id: 'training-or-nippers', label: 'at training', at: 'oval', mode: 'drive', dur: [60, 110],
    gains: { fun: 0.75, social: 0.95, energy: -0.175, place: 0.2 },
    gate: (p, c) => (p.age < 18 || (p.age < 55 && p.traits.civic > 0.5)) && c.hour >= 15 && c.hour < 19 && !c.raining,
    why: (p) => (p.age < 18 ? 'training after school' : 'somebody has to run the kids through it')
  }),
  A({
    id: 'a-working-bee', label: 'at a working bee', at: 'park', mode: 'drive', dur: [90, 180],
    gains: { place: 0.95, social: 1.0, fun: 0.3, energy: -0.2, islandFatigue: -0.015 },
    gate: (p, c) => c.weekend && c.daylight && c.hour >= 7 && c.hour < 13 && p.age >= 16 && !c.raining,
    bonus: (p) => p.traits.civic * 1.4 - 0.5,
    why: () => 'the same dozen people who always turn up'
  }),

  /* ---- the water and the bush ---- */
  A({
    id: 'a-swim', label: 'in for a swim', at: 'beach', mode: 'drive', dur: [40, 90],
    gains: { fun: 0.95, place: 0.95, hygiene: -0.12, energy: -0.1, comfort: 0.2, islandFatigue: -0.0125 },
    gate: (p, c) => c.daylight && c.tempC > 20 && c.beachOk && p.age >= 4,
    bonus: (p, c) => c.beachDay * 2.4 + p.traits.water * 0.9 + p.traits.outdoors * 0.5 + (c.weekend ? 0.4 : 0),
    why: (p, c) => (c.beachDay > 0.6 ? `it is ${Math.round(c.tempC)} degrees and there is no wind`
      : c.hour < 9 ? 'a swim before the day starts' : c.hour > 16 ? 'a swim to wash the day off' : 'in for a swim')
  }),
  A({
    id: 'surf', label: 'out for a surf', at: 'surfbreak', mode: 'drive', dur: [50, 110],
    gains: { fun: 1.7, place: 1.35, energy: -0.17, hygiene: -0.15, islandFatigue: -0.02 },
    gate: (p, c) => c.daylight && c.surfable && c.surfQuality > 0.16 && c.beachOk
      && p.traits.water > 0.42 && p.age >= 10 && p.age < 72,
    bonus: (p, c) => c.surfQuality * 2.2 + p.traits.water * 1.4 + (c.offshore ? 0.9 : 0),
    why: (p, c) => `the swell is ${c.swellM.toFixed(1)} metres` + (c.offshore ? ' and the wind is offshore' : '')
  }),
  A({
    id: 'the-surf-check', label: 'checking the surf', at: 'surfbreak', mode: 'drive', dur: [20, 30],
    gains: { place: 0.6, fun: 0.25 },
    gate: (p, c) => c.firstLight && p.traits.water > 0.5 && p.age >= 12,
    bonus: (p) => p.traits.water * 1.2 + p.traits.earlyRiser * 0.8,
    why: () => 'first light, to see what it is doing'
  }),
  A({
    id: 'fishing-off-the-rocks', label: 'fishing off the rocks', at: 'rockshelf', mode: 'drive', dur: [90, 200],
    gains: { fun: 0.95, place: 1.15, social: 0.3, energy: -0.075 },
    gate: (p, c) => c.daylight && p.traits.water > 0.4 && c.swellM < 2.4 && p.age >= 12,
    bonus: (p, c) => p.traits.water * 0.9 + (c.risingTide ? 0.5 : 0) + (c.dawnOrDusk ? 0.7 : 0),
    why: (p, c) => (c.risingTide ? 'the tide is making' : 'a couple of hours on the rocks')
  }),
  A({
    id: 'out-in-the-tinny', label: 'out in the boat', at: 'ramp', mode: 'boat', dur: [120, 280],
    gains: { fun: 1.15, place: 1.45, social: 0.4, energy: -0.125, islandFatigue: -0.0175 },
    gate: (p, c) => c.daylight && p.hasBoat && c.windKt < 18 && c.swellM < 2.2,
    bonus: (p, c) => p.traits.water * 1.3 + (c.earlyTide ? 0.6 : 0),
    why: (p, c) => (c.windKt < 10 ? 'the bay is flat' : 'a window in the wind')
  }),
  A({
    id: 'the-gorge-walk', label: 'walking the gorge', at: 'north-gorge-walk', mode: 'drive', dur: [45, 80],
    gains: { fun: 0.85, place: 1.25, comfort: 0.2, energy: -0.125 },
    gate: (p, c) => c.daylight && !c.raining && c.apparentC < 33 && p.age >= 5,
    bonus: (p, c) => p.traits.outdoors * 0.8 + c.beachDay * 0.7 + (c.whaleSeason ? 0.7 : 0) - (c.peak ? 0.7 : 0),
    why: (p, c) => (c.whaleSeason ? 'the whales are going past' : 'the same lap they have done for years')
  }),
  A({
    id: 'whale-watching', label: 'watching for whales', at: 'headland', mode: 'drive', dur: [40, 90],
    gains: { fun: 1.1, place: 1.05, comfort: 0.15 },
    gate: (p, c) => c.whaleSeason && c.daylight && c.windKt < 24,
    bonus: (p, c) => 0.6 + p.traits.outdoors * 0.5 - (c.peak ? 0.8 : 0),
    why: () => 'they come past close from the headland'
  }),
  A({
    id: 'a-walk-on-the-beach', label: 'walking the beach', at: 'beach', mode: 'walk', dur: [35, 70],
    gains: { fun: 0.55, place: 0.85, social: 0.45, energy: -0.06, comfort: 0.15 },
    gate: (p, c) => c.daylight && !c.raining && c.apparentC < 32,
    bonus: (p, c) => p.traits.outdoors * 0.6 + c.beachDay * 0.9 + (c.dawnOrDusk ? 0.8 : 0) + (p.role === 'elder' ? 0.5 : 0),
    why: (p, c) => (c.dawnOrDusk ? 'the walk they do every morning' : 'a lap of the beach')
  }),
  A({
    id: 'walking-the-dog', label: 'walking the dog', at: 'foreshore', mode: 'walk', dur: [30, 55],
    gains: { fun: 0.45, place: 0.7, social: 0.6, energy: -0.05 },
    gate: (p, c) => p.hasDog && !c.night && c.apparentC < 33,
    bonus: (p, c) => 0.8 + (c.dawnOrDusk ? 0.7 : 0),
    why: () => 'the dog does not care what the weather is doing'
  }),
  A({
    id: 'the-lake', label: 'up at the lake', at: 'lake', mode: 'drive', dur: [70, 150],
    gains: { fun: 0.85, place: 0.95, hygiene: -0.05, energy: -0.075 },
    gate: (p, c) => c.daylight && c.tempC > 22 && !c.raining && p.age >= 4,
    bonus: (p, c) => c.beachDay * 1.5 + p.traits.outdoors * 0.5,
    why: () => 'the lake is warmer than the ocean and the kids can stand up in it'
  }),
  A({
    id: 'beach-driving', label: 'driving the beach', at: 'beach', mode: 'drive', dur: [60, 140],
    gains: { fun: 0.9, place: 0.85, social: 0.3 },
    gate: (p, c) => c.daylight && c.beachDrivingOpen && p.has4WD,
    bonus: (p, c) => p.traits.outdoors * 0.7 + p.traits.water * 0.4,
    why: (p, c) => `the tide is low enough to get along the beach for another ${c.beachWindowMin} minutes`
  }),
  A({
    id: 'sitting-and-looking', label: 'sitting and looking at it', at: 'lookout', mode: 'walk', dur: [20, 60],
    gains: { comfort: 0.65, place: 0.8, fun: 0.25, islandFatigue: -0.025 },
    gate: (p, c) => !c.night,
    bonus: (p, c) => p.n[FATIGUE] * 1.2 + (c.dawnOrDusk ? 0.45 : 0) + (p.role === 'elder' ? 0.4 : 0),
    why: (p) => (p.n[FATIGUE] > 0.5 ? 'needed twenty minutes where nobody wanted anything' : 'it is worth stopping for')
  }),
  A({
    id: 'a-ride', label: 'out on the bike', at: 'island', mode: 'bike', dur: [45, 90],
    gains: { fun: 0.65, place: 0.6, energy: -0.225, hygiene: -0.15 },
    gate: (p, c) => c.daylight && !c.raining && c.windKt < 22 && p.age >= 8 && p.age < 68,
    bonus: (p) => p.traits.outdoors * 0.7,
    why: () => 'twenty two kilometres of road and no traffic lights'
  }),

  /* ---- each other ---- */
  A({
    id: 'visiting-someone', crowdShy: true, label: 'round at somebody\'s place', at: 'tie', mode: 'drive', dur: [60, 150],
    gains: { social: 1.4, fun: 0.65, comfort: 0.2, islandFatigue: -0.01 },
    gate: (p, c) => c.hour >= 8 && c.hour < 22 && p.age >= 12 && p.tieCount > 0,
    bonus: (p) => p.traits.sociable * 1.0,
    why: () => 'dropped in on somebody'
  }),
  A({
    id: 'having-people-over', label: 'having people over', at: 'home', mode: 'idle', dur: [90, 200],
    gains: { social: 1.45, fun: 0.85, hunger: 0.5, comfort: 0.1 },
    crowdShy: true,
    gate: (p, c) => c.hour >= 11 && c.hour < 22 && p.age >= 18 && p.tieCount > 1,
    bonus: (p, c) => p.traits.sociable * 0.7 + (c.weekend ? 0.45 : 0) - 0.35,
    why: () => 'a few people came round'
  }),
  A({
    id: 'a-day-across-the-bay', label: 'a day on the mainland', at: 'mainland', mode: 'offisland', dur: [420, 600],
    gains: { islandFatigue: -0.0275, fun: 0.45, comfort: 0.25, social: 0.3, hunger: 0.2 },
    gate: (p, c) => c.hour >= 5 && c.hour < 10 && c.boatsRunning && p.age >= 16 && p.n[FATIGUE] > 0.45,
    bonus: (p, c) => p.n[FATIGUE] * 2.6 - (c.peak ? 0.4 : 0),
    why: () => 'the big shop, the specialist, and a shopping centre that has more than one of everything'
  })
];

// Flatten the advertised gains into parallel arrays once, so scoring is a short numeric loop, and
// precompute the cheap numeric preconditions that let a candidate be rejected without calling a
// closure at all. Fifty closure calls per person per decision, two hundred decisions a tick, was
// the single most expensive thing in this slice before these existed.
for (const a of ACTIONS) {
  a.gi = []; a.gv = [];
  for (const k of Object.keys(a.gains)) {
    const i = NEEDS.indexOf(k);
    if (i >= 0) { a.gi.push(i); a.gv.push(a.gains[k]); }
  }
  a.hasDuty = !!a.duty;
  a.salt = (a.id.length * 7 + a.id.charCodeAt(0)) | 0;
  a.wide = a.at === 'surfbreak' || a.at === 'beach';
  a.travels = a.mode === 'drive' || a.mode === 'commute' || a.mode === 'walk' || a.mode === 'bike' || a.mode === 'boat';
  // How far somebody will go, and what it costs them. Walking has a hard limit: without one, a
  // Dunwich resident was "walking" to the Point Lookout headland at twenty past five in the
  // morning, twenty two kilometres up the only road on the island.
  a.maxKm = a.mode === 'walk' ? 2.5 : a.mode === 'bike' ? 14 : 40;
  a.kmCost = a.mode === 'walk' ? 0.55 : a.mode === 'bike' ? 0.14 : 0.055;
  // Effort: what it costs to bother. Without it, a population whose needs are all full picks by
  // trait bonus and jitter alone, and a hundred people get in the ute at once because the tide
  // happens to be low. With it, a satisfied islander stays home unless something is worth going
  // out for, which is both cheaper and truer.
  a.effort = a.hasDuty ? 0
    : a.mode === 'idle' ? 0.15
      : a.mode === 'walk' ? 0.5
        : a.mode === 'bike' ? 0.75
          : a.mode === 'boat' ? 1.15
            : a.mode === 'offisland' ? 1.6 : 0.9;
}

/**
 * Context-only preconditions, one per action, evaluated once a tick rather than once per person per
 * decision. This is the whole performance story of this file: two hundred decisions a tick times
 * forty gate closures is twenty thousand calls, and at any given hour most of the table cannot fire
 * for anybody. Splitting the part of a gate that only reads the world from the part that reads the
 * person cuts the live list to roughly a dozen. The per-person `gate` still runs and is still the
 * authority; this only decides what is worth asking about.
 */
const WHEN = {
  nap: (c) => !c.night,
  'sit-with-the-house': (c) => !c.night,
  'the-couch': (c) => !c.night,
  'jobs-around-the-house': (c) => c.daylight,
  'the-yard': (c) => c.daylight && !c.raining && c.apparentC < 33,
  'bins-out': (c) => c.binNight && c.hour >= 17,
  'ring-the-mainland': (c) => !c.night,
  'looking-for-work': (c) => c.workHours && !c.weekend,
  'coffee-and-a-chat': (c) => c.hour >= 6 && c.hour < 14,
  'counter-lunch': (c) => c.hour >= 11 && c.hour < 15,
  'a-night-at-the-club': (c) => c.hour >= 16 && c.hour < 23,
  'the-shop-run': (c) => c.hour >= 7 && c.hour < 19,
  'the-markets': (c) => c.marketDay && c.hour >= 8 && c.hour < 14,
  'bowls-or-a-game': (c) => c.daylight && !c.raining,
  'training-or-nippers': (c) => c.hour >= 15 && c.hour < 19 && !c.raining,
  'a-working-bee': (c) => c.weekend && c.daylight && c.hour >= 7 && c.hour < 13 && !c.raining,
  'a-swim': (c) => c.daylight && c.tempC > 20 && c.beachOk,
  surf: (c) => c.daylight && c.surfable && c.surfQuality > 0.16 && c.beachOk,
  'the-surf-check': (c) => c.firstLight,
  'fishing-off-the-rocks': (c) => c.daylight && c.swellM < 2.4,
  'out-in-the-tinny': (c) => c.daylight && c.windKt < 18 && c.swellM < 2.2,
  'the-gorge-walk': (c) => c.daylight && !c.raining && c.apparentC < 33,
  'whale-watching': (c) => c.whaleSeason && c.daylight && c.windKt < 24,
  'a-walk-on-the-beach': (c) => c.daylight && !c.raining && c.apparentC < 32,
  'walking-the-dog': (c) => !c.night && c.apparentC < 33,
  'the-lake': (c) => c.daylight && c.tempC > 22 && !c.raining,
  'beach-driving': (c) => c.daylight && c.beachDrivingOpen,
  'sitting-and-looking': (c) => !c.night,
  'a-ride': (c) => c.daylight && !c.raining && c.windKt < 22,
  'visiting-someone': (c) => c.hour >= 8 && c.hour < 22,
  'having-people-over': (c) => c.hour >= 11 && c.hour < 22,
  'a-day-across-the-bay': (c) => c.hour >= 5 && c.hour < 10 && c.boatsRunning
};
/**
 * The part of a gate that is about the person rather than the world, evaluated once when they are
 * attached rather than on every decision. A seventy year old is never going to surf, a household
 * with no boat is never going out in one, and asking twice a sim-hour for a sim-year is a lot of
 * asking. Anything not listed here is always possible for everybody and is left to the gate.
 */
const WHO = {
  surf: (p) => p.traits.water > 0.42 && p.age >= 10 && p.age < 72,
  'the-surf-check': (p) => p.traits.water > 0.5 && p.age >= 12,
  'fishing-off-the-rocks': (p) => p.traits.water > 0.4 && p.age >= 12,
  'out-in-the-tinny': (p) => p.hasBoat,
  'walking-the-dog': (p) => p.hasDog,
  'beach-driving': (p) => p.has4WD,
  'bowls-or-a-game': (p) => p.age >= 45,
  'cook-for-the-house': (p) => p.age >= 16 && p.householdSize > 1,
  'sit-with-the-house': (p) => p.householdSize > 1,
  'having-people-over': (p) => p.age >= 18,
  'a-night-at-the-club': (p) => p.age >= 18,
  'counter-lunch': (p) => p.age >= 16,
  'coffee-and-a-chat': (p) => p.age >= 14,
  'the-shop-run': (p) => p.age >= 15,
  'ring-the-mainland': (p) => p.age >= 16,
  'visiting-someone': (p) => p.age >= 12,
  'a-day-across-the-bay': (p) => p.age >= 16,
  'jobs-around-the-house': (p) => p.age >= 14,
  'the-yard': (p) => p.age >= 12,
  'bins-out': (p) => p.age >= 12,
  'a-ride': (p) => p.age >= 8 && p.age < 68,
  'a-swim': (p) => p.age >= 4,
  'the-lake': (p) => p.age >= 4,
  'the-gorge-walk': (p) => p.age >= 5,
  'looking-for-work': (p) => p.occupationId === 'unemployed',
  'a-working-bee': (p) => p.age >= 16
};
for (const a of ACTIONS) { a.when = WHEN[a.id] || null; a.who = WHO[a.id] || null; }
for (let i = 0; i < ACTIONS.length; i++) ACTIONS[i].index = i;

/** Split once. Eleven of these can only fire when schedule.js has put an obligation on somebody,
 *  and most people most of the time do not have one, so they are never scored. */
const DUTY_ACTIONS = ACTIONS.filter((a) => a.hasDuty);
const FREE_ACTIONS = ACTIONS.filter((a) => !a.hasDuty);

/** How much each need matters when it is scored. Fun and social are the Sims levers; place and
 *  fatigue are this island's, and they are deliberately slower and quieter than the rest. */
const WEIGHT = [1.35, 1.30, 0.85, 1.10, 1.00, 1.05, 0.75, 0.80, 0.0];
const INV_WEIGHT_SUM = 1 / WEIGHT.slice(0, 8).reduce((s, v) => s + v, 0);

const MOODS = [
  [0.82, 'buoyant'], [0.70, 'good'], [0.58, 'settled'], [0.46, 'flat'],
  [0.34, 'tired'], [0.22, 'frayed'], [0, 'at the end of it']
];

export function registerNeeds(world) {
  const rng = world.rng.stream('needs');

  // Per-agent read model. The narrative pack's state contract asks for needs.<agentId>.unmet and
  // needs.<householdId>.crowding, so agent and household ids are keys on this object alongside the
  // named summary fields. Entity ids are numbers and the summary keys are not, so they never clash.
  const state = world.publish('needs', {
    ready: false,
    tracked: 0,
    decisionsLastTick: 0,
    mean: {},
    unmetTop: [],
    islandFatigue: { mean: 0, worstTownship: null, over70: 0 },
    doingNow: {},
    levelsOf: () => null,
    describeAction: (id) => {
      const a = ACTIONS.find((x) => x.id === id);
      return a ? { id: a.id, label: a.label, gains: a.gains } : null;
    }
  });

  let arr = new Float32Array(0);
  let cap = 0;
  const byId = new Map();      // agent id -> its published entry

  /**
   * Grow the flat store. Every person's `p.n` is a subarray view onto it rather than a copy, so a
   * decay pass writes the array the UI and the render layer read without a second pass to sync
   * them. Growing detaches those views, so they are re-pointed here and nowhere else.
   */
  function ensure(slots) {
    if (slots <= cap) return;
    const next = Math.max(64, slots + 256);
    const bigger = new Float32Array(next * N);
    bigger.set(arr);
    arr = bigger;
    cap = next;
    if (R && R.people) for (const p of R.people) if (p.slot >= 0 && p.n) p.n = arr.subarray(p.slot * N, p.slot * N + N);
  }

  /* -------------------------------------------------------------- context

  One object a tick, shared by every scoring call, so the weather, the tide and the calendar are
  read once rather than two thousand times. */

  const ctx = {};

  function buildContext(w) {
    const weather = w.read('weather') || {};
    const tide = w.read('tide') || {};
    const day = w.read('daylight') || {};
    const sched = w.read('schedule') || {};
    const pop = w.read('population') || {};
    const vis = w.read('visitors') || {};
    const cal = pop.today || {};
    const hour = w.clock.hour + w.clock.minute / 60;

    ctx.hour = hour;
    ctx.minuteOfDay = w.clock.minuteOfDay;
    ctx.daylight = !!day.isDay;
    ctx.night = !day.isDay && (hour >= 20 || hour < 5);
    ctx.lateNight = hour >= 23 || hour < 4.5;
    ctx.firstLight = day.elevationDeg > -7 && day.elevationDeg < 8 && hour < 9;
    ctx.dawnOrDusk = !!day.isGolden;
    ctx.tempC = weather.tempC ?? 22;
    ctx.apparentC = weather.apparentC ?? ctx.tempC;
    ctx.windKt = weather.windKt ?? 10;
    ctx.windDirDeg = weather.windDirDeg ?? 110;
    ctx.swellM = weather.swellM ?? 1;
    ctx.raining = (weather.rainMmHr ?? 0) > 0.6;
    ctx.beachOk = weather.beachCondition !== 'closed' && !ctx.raining;
    ctx.boatsRunning = weather.crossingCondition !== 'cancelled';

    // Offshore at Point Lookout means a westerly through to a south westerly: the ocean beaches
    // face east and north east, so 200 to 300 degrees holds the face up.
    ctx.offshore = ctx.windDirDeg > 200 && ctx.windDirDeg < 305;
    // Surfable is a window, not a threshold. Under half a metre there is nothing; over about three
    // and a half the ocean beaches shut and only the point corners hold shape.
    ctx.surfable = ctx.swellM > 0.55 && ctx.swellM < 3.6 && ctx.windKt < 28;
    const s = ctx.swellM;
    ctx.surfQuality = Math.max(0, Math.min(1, (s - 0.5) / 1.4) * Math.max(0.25, 1 - Math.max(0, s - 2.6) / 1.4))
      * (ctx.offshore ? 1 : 0.62) * Math.max(0.3, 1 - ctx.windKt / 34);

    // The still twenty-seven degree Saturday. This is one number and it moves the whole island.
    // A nine knot breeze is a perfect beach day, not a half-marked one, and twenty six degrees is
    // as good as twenty eight. The first version of these two curves scored a still 26 degree
    // Saturday at 0.34 and the island stayed indoors on it, which is the one thing this place
    // demonstrably does not do.
    const warm = Math.max(0, 1 - Math.abs(ctx.tempC - 28) / 11);
    const calm = Math.max(0, Math.min(1, 1 - Math.max(0, ctx.windKt - 8) / 18));
    const clear = 1 - (weather.cloud ?? 0.3) * 0.7;
    ctx.beachDay = ctx.beachOk ? warm * calm * clear : 0;
    // Nobody walks in the middle of a February day. The apparent temperature does this on its own,
    // but it is worth naming because it is the single most visible seasonal behaviour here.
    ctx.middayHeat = ctx.apparentC > 31 && hour > 10 && hour < 16;
    if (ctx.middayHeat) ctx.beachDay *= 0.55;

    ctx.tideHeight = tide.height ?? 1.0;
    ctx.risingTide = (tide.rate ?? 0) > 0.05;
    ctx.earlyTide = ctx.risingTide && hour < 10;
    // Minjerribah Camping's own permit condition: two hours either side of low water on the ocean
    // beaches. The pack records three different published windows and rules that two hours is the
    // one to use, because it comes from the body that issues the permit and enforces it.
    const mainBeach = (tide.stations && tide.stations.mainbeach) ?? ctx.tideHeight;
    ctx.beachDrivingOpen = mainBeach < 0.95;
    ctx.beachWindowMin = ctx.beachDrivingOpen ? Math.max(10, Math.round((0.95 - mainBeach) * 260)) : 0;

    ctx.weekend = w.clock.isWeekend;
    ctx.friday = w.clock.dayOfWeek === 5;
    ctx.saturday = w.clock.dayOfWeek === 6;
    ctx.workHours = hour >= 8 && hour < 17;
    ctx.mealTime = (hour >= 6.5 && hour < 8.5) || (hour >= 12 && hour < 13.5) || (hour >= 17.5 && hour < 20);
    ctx.whaleSeason = !!cal.isWhaleSeason;
    ctx.schoolHoliday = !!cal.isSchoolHoliday;
    ctx.publicHoliday = !!cal.isPublicHoliday;
    ctx.marketDay = !!sched.marketDay;
    // Routes 880 and 881 run to meet the ferries. A household with no car depends on them, and the
    // pack's own pressure point for a car-less household is that a missed lift is a missed day.
    ctx.busRunning = sched.busRunning !== undefined ? !!sched.busRunning : (hour >= 6.5 && hour <= 18.5);
    ctx.binNight = !!sched.binNight;
    ctx.peak = (cal.loadMultiplier ?? 1) > 2 || (vis.onIsland ?? 0) > 1800;
    ctx.visitorPressure = Math.min(1, (vis.onIsland ?? 0) / 3500);
    ctx.freightPressure = 0;
    const prices = w.read('prices');
    if (prices && Number.isFinite(prices.freightIndex)) ctx.freightPressure = Math.max(0, Math.min(1, (prices.freightIndex - 1) * 1.2));
    return ctx;
  }

  /* -------------------------------------------------------------- location resolution */

  const KIND_MAP = {
    cafe: ['cafe', 'coffee', 'cafe-restaurant-takeaway', 'cafe-takeaway', 'bakery', 'gelato-coffee', 'coffee-van', 'gelato'],
    pub: ['hotel-pub-accommodation', 'club-bistro', 'tavern-restaurant', 'restaurant', 'takeaway', 'club-bistro-bowls', 'community-club-bistro', 'fuel-grocery-takeaway'],
    club: ['club-bistro', 'club-bistro-bowls', 'community-club-bistro', 'sports-club-licensed', 'hotel-pub-accommodation', 'surf-life-saving-club', 'golf-club', 'fishing-club'],
    shop: ['grocery', 'general-store-fuel', 'convenience-grocery', 'fuel-hardware', 'butcher', 'bottle-shop', 'seafood-retail', 'post-office', 'fuel-grocery-takeaway'],
    clinic: ['gp-clinic', 'aboriginal-community-controlled-health', 'emergency-health-outpost', 'pharmacy'],
    school: ['school', 'primary-school'],
    oval: ['sports_field', 'pool'],
    park: ['park', 'foreshore'],
    beach: ['beach'],
    lake: ['lake'],
    lookout: ['lookout', 'headland', 'gorge', 'walk'],
    headland: ['headland', 'lookout'],
    rockshelf: ['rock', 'headland', 'gorge'],
    ramp: ['boat_ramp', 'jetty'],
    ferry: ['ferry_terminal', 'jetty'],
    foreshore: ['park', 'beach'],
    surfbreak: ['beach']
  };
  // Surf breaks: the ocean-facing beaches only. Nothing on the bay side ever has a wave on it.
  const SURF_BREAKS = ['main-beach', 'south-gorge', 'cylinder-beach', 'frenchmans-beach', 'deadmans-beach', 'home-beach', 'flinders-beach'];

  let R = null;
  /** townshipId -> kind -> [places], nearest first. Built once at init, never at decision time:
   *  resolving a place was five per cent of the whole profile when it was a string key on a Map. */
  const kindLists = {};

  function buildKindLists(townships) {
    for (const t of townships) {
      const per = kindLists[t] = {};
      const home = R.byTownshipSeat ? R.byTownshipSeat[t] : null;
      for (const kind of Object.keys(KIND_MAP)) {
        const wants = KIND_MAP[kind];
        const out = [];
        for (const rec of R.places.values()) {
          if (kind === 'surfbreak') { if (SURF_BREAKS.includes(rec.id)) out.push(rec); continue; }
          const type = rec.kind === 'business' ? rec.bizType : rec.kind;
          if (wants.includes(type)) out.push(rec);
        }
        if (home) {
          out.sort((a, b) => {
            const da = (a.x - home.x) * (a.x - home.x) + (a.z - home.z) * (a.z - home.z);
            const db = (b.x - home.x) * (b.x - home.x) + (b.z - home.z) * (b.z - home.z);
            return da - db;
          });
        }
        per[kind] = out;
      }
    }
  }

  /**
   * Where an action happens for this person. Nearby is preferred but not forced: an islander will
   * drive twenty kilometres for the right beach, and which beach is the right one is a trait.
   */
  function resolvePlace(a, p) {
    switch (a.at) {
      case 'home': return p._homePlace || (p._homePlace = { id: 'home', label: 'home', x: p.homeX, z: p.homeZ });
      case 'work': {
        const e = p.employerPlace;
        return e || (p._homePlace || (p._homePlace = { id: 'home', label: 'home', x: p.homeX, z: p.homeZ }));
      }
      case 'island': return p._islandPlace || (p._islandPlace = { id: 'island', label: 'out on the island', x: p.homeX, z: p.homeZ });
      case 'mainland': return R.places.get('mainland');
      case 'tie': {
        const t = p.visitTarget;
        return t ? { id: 'home:' + t.id, label: `${t.name}'s place`, x: t.homeX, z: t.homeZ } : null;
      }
      default: break;
    }
    const fixed = R.places.get(a.at);
    if (fixed) return fixed;
    const per = kindLists[p.townshipId];
    const list = per && per[a.at];
    if (!list || !list.length) return null;
    // One of the few nearest, chosen by a stable per-person offset, so a street does not all end up
    // on the same patch of sand and the same person keeps their own regular spot.
    const n = Math.min(list.length, a.wide ? 4 : 3);
    return list[(p.id + a.salt) % n];
  }

  /* -------------------------------------------------------------- decay */

  function decayRates(p) {
    const out = p._decay || (p._decay = new Float32Array(N));
    for (let i = 0; i < N; i++) out[i] = BASE_DECAY[i];
    const age = p.age;
    if (age < 12) {
      out[HUNGER] *= 1.4; out[BLADDER] *= 1.5; out[ENERGY] *= 1.25; out[FUN] *= 1.5; out[SOCIAL] *= 1.3; out[HYGIENE] *= 1.35;
    } else if (age < 18) {
      out[FUN] *= 1.35; out[SOCIAL] *= 1.4; out[ENERGY] *= 1.15; out[HUNGER] *= 1.25;
    } else if (age >= 68) {
      out[ENERGY] *= 1.2; out[BLADDER] *= 1.3; out[COMFORT] *= 1.3; out[FUN] *= 0.85; out[HUNGER] *= 0.85;
    }
    // The job. A housekeeper on a changeover run and a remote knowledge worker do not empty at the
    // same rate, and the pack publishes a physical and a stress number for every occupation.
    out[ENERGY] *= 1 + (p.physical || 0.3) * 0.25;
    out[HYGIENE] *= 1 + (p.physical || 0.3) * 0.7;
    out[FUN] *= 1 + (p.stress || 0.4) * 0.35;
    out[PLACE] *= 0.6 + Math.min(1.6, (p.yearsOnIsland || 1) / 14);
    return out;
  }

  /* -------------------------------------------------------------- scoring */

  const URG = new Float32Array(N);

  function scoreList(list, p, c, u, out) {
    let best = out.best, bestScore = out.bestScore, bestPlace = out.bestPlace;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (a.who && !p.canDo[a.index]) continue;
      if (a.gate && !a.gate(p, c)) continue;
      let score = 0;
      for (let g = 0; g < a.gi.length; g++) {
        const i = a.gi[g];
        const v = a.gv[g];
        // A need an action costs counts, but not as much as a need it fills: nobody stays on the
        // couch because a swim would use energy. At the harsher weighting this had, every outdoor
        // action on the island scored a shade under zero and a still 26 degree Saturday looked
        // like a wet Tuesday.
        score += WEIGHT[i] * v * (v > 0 ? u[i] : 0.5);
      }
      if (a.bonus) score += a.bonus(p, c);
      score -= a.effort;
      // Six hundred people cannot all be having people over. For the handful of actions where
      // being one of a crowd is itself the deterrent, the previous tick's count pushes back.
      if (a.crowdShy) score -= Math.min(1.4, (crowd[a.id] || 0) / 220);
      let place = null;
      // Distance. Everything on this island is a drive except inside a township, and a household
      // with no car is a household whose day runs on other people's timetables.
      //
      // Which place a person uses for a given action does not change from hour to hour: the same
      // person goes to the same beach and the same shop, because that is what people do. So the
      // resolved place and the distance home are cached per person per action and thrown away only
      // when they move house. Re-resolving them inside the scoring loop was a quarter of it.
      if (a.travels) {
        let cache = p._places;
        if (!cache) cache = p._places = {};
        let entry = cache[a.id];
        if (entry === undefined) {
          const resolved = resolvePlace(a, p);
          if (!resolved) { cache[a.id] = null; continue; }
          const dx0 = resolved.x - p.homeX, dz0 = resolved.z - p.homeZ;
          entry = cache[a.id] = { place: resolved, km: Math.sqrt(dx0 * dx0 + dz0 * dz0) * 0.001 };
        }
        if (entry === null) continue;
        // `tie` and `work` move with the person's life rather than with the map.
        if (a.at === 'tie' || a.at === 'work') {
          const live = resolvePlace(a, p);
          if (!live) continue;
          const dx1 = live.x - p.homeX, dz1 = live.z - p.homeZ;
          entry = { place: live, km: Math.sqrt(dx1 * dx1 + dz1 * dz1) * 0.001 };
        }
        place = entry.place;
        const km = entry.km;
        if (km > a.maxKm && !a.hasDuty) continue;
        if (km > 1.2) {
          if (a.mode === 'drive' && !p.hasVehicle && !a.hasDuty) {
            if (!c.busRunning || km > 24) continue;    // no car, no bus, no trip
            score -= km * 0.18;
          } else score -= km * a.kmCost;
        }
      }
      // Doing the same thing twice in a row is not how a day goes.
      const last = p.lastActionIds;
      if (last[0] === a.id) score -= 1.6;
      else if (last[1] === a.id || last[2] === a.id || last[3] === a.id) score -= 0.9;
      // The jitter. Small, deterministic, and the reason two identical people diverge.
      score += rng.range(-0.42, 0.42);
      if (score > bestScore) { bestScore = score; best = a; bestPlace = place; }
    }
    out.best = best; out.bestScore = bestScore; out.bestPlace = bestPlace;
  }

  const choice = { best: null, bestScore: 0, bestPlace: null };
  /** How many people were doing each action on the previous tick. Read only by crowd-shy actions. */
  let crowd = {};
  /** The free actions the world allows at all right now, rebuilt once a tick. */
  let liveFree = FREE_ACTIONS;

  function refreshLive(c) {
    liveFree = [];
    for (let i = 0; i < FREE_ACTIONS.length; i++) {
      const a = FREE_ACTIONS[i];
      if (!a.when || a.when(c)) liveFree.push(a);
    }
  }

  function chooseAction(p, c) {
    const n = p.n;
    for (let i = 0; i < FATIGUE; i++) URG[i] = urgency(n[i]);
    URG[FATIGUE] = 0;   // fatigue does not advertise; it biases the actions that relieve it
    choice.best = null; choice.bestScore = -1e9; choice.bestPlace = null;
    scoreList(liveFree, p, c, URG, choice);
    if (p.duty) scoreList(DUTY_ACTIONS, p, c, URG, choice);
    return choice;
  }

  function commit(p, a, c, tick, known, resuming) {
    const place = known || resolvePlace(a, p);
    // What to go back to afterwards. Only the genuinely brief interruptions set this.
    if (!resuming) {
      if (a.dur[1] <= 20 && p.currentGains && p.currentGains.dur[1] > 40 && !p.currentGains.sleeping) {
        p.resumeAction = p.currentGains;
        p.resumeUntil = p.untilTick;
      } else {
        p.resumeAction = null;
      }
    } else {
      p.resumeAction = null;
    }
    const dur = a.dur[0] + rng.float() * (a.dur[1] - a.dur[0]);
    p.actionId = a.id;
    p.actionLabel = place && place.id !== 'home' && place.id !== 'island' && place.label
      ? `${a.label}, ${place.label}` : a.label;
    p.reason = a.why ? a.why(p, c) : '';
    p.locationId = place ? place.id : 'home';
    p.locationLabel = place ? place.label : 'home';
    p.mode = a.mode === 'commute' ? (p.hasVehicle ? 'drive' : 'walk') : a.mode;
    p.sleeping = !!a.sleeping;
    p.untilTick = tick + Math.max(1, Math.round(dur / 10));
    p.onIsland = a.mode !== 'offisland';
    if (place) { p.tx = place.x; p.tz = place.z; }
    const last = p.lastActionIds;
    last[3] = last[2]; last[2] = last[1]; last[1] = last[0]; last[0] = a.id;
    p.currentGains = a;

    // The handful of things worth writing down. A person's history is what makes them legible when
    // a player clicks on them six sim-months later, so it records the days that were different, not
    // every meal and every shower.
    const h = p.history;
    if (h) {
      if (a.id === 'surf' && c.surfQuality > 0.72) {
        p.stats.surfs++;
        h.push({ tick, text: `a good one at ${place ? place.label : 'the beach'}: ${c.swellM.toFixed(1)} m and offshore`, weight: 2 });
      } else if (a.id === 'a-callout') {
        p.stats.calloutsAnswered++;
        h.push({ tick, text: p.reason, weight: 3 });
      } else if (a.id === 'stuck-on-the-mainland') {
        h.push({ tick, text: 'did not get home', weight: 3 });
      } else if (a.id === 'a-day-across-the-bay') {
        h.push({ tick, text: 'took a day off the island', weight: 2 });
      } else if (a.id === 'work-shift') {
        p.stats.shiftsWorked++;
      }
      if (h.length > 14) h.shift();
    }
  }

  /* -------------------------------------------------------------- the system */

  const lanes = [[], []];
  let lanesDirty = true;

  /** Split the roster into the two update lanes. Rebuilt only when the roster itself changes,
   *  which on this island is a household or two a day. */
  function rebuildLanes(w, c) {
    lanes[0].length = 0;
    lanes[1].length = 0;
    for (const p of R.people) {
      if (p.slot < 0) continue;
      if (!p.n) attach(p, w, c);
      if (p.canDo) for (const a of ACTIONS) p.canDo[a.index] = !a.who || a.who(p) ? 1 : 0;
      lanes[p.slot & 1].push(p);
    }
    lanesDirty = false;
  }

  return world.register({
    id: 'needs',
    phase: 'agents',
    order: 30,

    init(w) {
      R = w.residents;
      if (!R || !R.ready) return;
      R.byTownshipSeat = {};
      for (const p of R.places.values()) if (p.kind === 'township') R.byTownshipSeat[p.township] = p;
      for (const hh of R.households) {
        if (!R.byTownshipSeat[hh.townshipId]) R.byTownshipSeat[hh.townshipId] = { x: hh.x, z: hh.z };
      }

      buildKindLists(Object.keys(R.byTownshipSeat));

      ensure(R.slotCapacity);
      const c = buildContext(w);
      for (const p of R.people) attach(p, w, c);
      rebuildLanes(w, c);
      state.ready = true;
      state.levelsOf = (id) => {
        const q = R.peopleById.get(id);
        if (!q || q.slot < 0) return null;
        const o = {};
        for (let i = 0; i < N; i++) o[NEEDS[i]] = +arr[q.slot * N + i].toFixed(3);
        return o;
      };
      w.bus.emit('needs:ready', { tracked: R.people.length });
    },

    tick(w) {
      if (!R || !R.ready) return;
      const tick = w.clock.tick;
      const c = buildContext(w);
      refreshLive(c);
      ensure(R.slotCapacity);

      const people = R.people;
      let decisions = 0;
      const dt = 1 / 3;   // twenty minutes: each person is updated on alternate ticks

      // What the island is grinding on today, hoisted out of the loop: the visitor load, the cost
      // of freight, and whether the boats are running at all. This is the level island fatigue
      // moves toward, before a person's own patience and stress scale it.
      const grindBase = 0.06 + c.visitorPressure * 0.68 + c.freightPressure * 0.25
        + (c.boatsRunning ? 0 : 0.28);
      const reportTick = tick & 15;
      // Needs move on a twenty minute step, not a ten minute one: half the roster is updated each
      // tick with a doubled interval. At two thousand people the decay pass is the single most
      // expensive thing in this slice and nothing in a need is visible at ten minute resolution.
      // The two halves are held as their own arrays rather than tested inside the loop, so the tick
      // that is not updating somebody does not pay to walk past them either.
      if (lanesDirty || lanes[0].length + lanes[1].length !== people.length) rebuildLanes(w, c);
      const lane = lanes[tick & 1];

      for (let i = 0; i < lane.length; i++) {
        const p = lane[i];
        if (!p || p.slot < 0 || !p.n) continue;
        const n = p.n;                 // a view into the flat array: writing n writes arr
        const d = p._decay;
        const act = p.currentGains;
        const asleep = p.sleeping;

        // 1. decay, then whatever the current action is putting back
        if (asleep) {
          for (let k = 0; k < FATIGUE; k++) {
            const v = n[k] - d[k] * SLEEP_SCALE[k] * dt;
            n[k] = v < 0 ? 0 : v;
          }
        } else {
          for (let k = 0; k < FATIGUE; k++) {
            const v = n[k] - d[k] * dt;
            n[k] = v < 0 ? 0 : v;
          }
        }
        if (act) {
          const gi = act.gi, gv = act.gv;
          for (let g = 0; g < gi.length; g++) {
            const idx = gi[g];
            if (idx === FATIGUE) continue;
            const v = n[idx] + gv[g] * dt;
            n[idx] = v < 0 ? 0 : v > 1 ? 1 : v;
          }
        }

        // 2. island fatigue. Not an integral: a lagged read of what is actually grinding right now,
        //    with a time constant of about ten days either way. Integrating it was tried and it
        //    saturated: after a sim-year more than half the island sat pinned at the top of the
        //    scale and it stopped meaning anything. As a lag it does what the real thing does, which
        //    is sit low through a wet June and climb through January, and the actions that relieve
        //    it push it below the line for a while rather than resetting a counter.
        const target = (grindBase + (n[SOCIAL] < 0.35 ? 0.12 : 0)) * p._grindMult;
        let fat = n[FATIGUE] + (target - n[FATIGUE]) * 0.0020 * (dt * 6);
        if (act) {
          const gi = act.gi, gv = act.gv;
          for (let g = 0; g < gi.length; g++) if (gi[g] === FATIGUE) fat += gv[g] * dt;
        }
        n[FATIGUE] = fat < 0 ? 0 : fat > 1 ? 1 : fat;

        // 3. decide. When the action runs out, or when something crosses a floor that no plan
        //    survives. This is what spreads the cost: roughly one person in eight decides a tick.
        // A sleeper wakes when they have had enough, not when the timer says so. Without this a
        // person who went to bed at three in the morning is still in it at eleven.
        if (tick >= p.untilTick || n[BLADDER] < 0.07 || n[HUNGER] < 0.05 || (n[ENERGY] < 0.05 && !asleep)
          || (asleep && n[ENERGY] > 0.97 && c.daylight)) {
          // A ten minute errand does not restart the afternoon. Somebody who breaks off the couch
          // for the bathroom goes back to the couch, which is both what happens and about a third
          // of all the decisions on this island if it is not handled.
          const resume = p.resumeAction;
          if (resume && tick < p.resumeUntil && (!resume.gate || resume.gate(p, c))) {
            commit(p, resume, c, tick, null, true);
          } else {
            const ch = chooseAction(p, c);
            if (ch.best) { commit(p, ch.best, c, tick, ch.bestPlace); decisions++; }
            else p.untilTick = tick + 3;
          }
        }

        // 4. mood, and what the player is told about it
        let m = 0;
        for (let k = 0; k < FATIGUE; k++) m += n[k] * WEIGHT[k];
        m = m * INV_WEIGHT_SUM - n[FATIGUE] * 0.30;
        p.mood = m;

        // 5. per-agent read model, mutated in place, one eighth of the roster a tick
        if ((p.id & 15) === reportTick) {
          for (let k = 0; k < MOODS.length; k++) { if (m >= MOODS[k][0]) { p.moodLabel = MOODS[k][1]; break; } }
          const entry = byId.get(p.id);
          if (entry) {
            const unmet = entry.unmet;
            unmet.length = 0;
            for (let k = 0; k < FATIGUE; k++) if (n[k] < 0.28) unmet.push(NEEDS[k]);
            if (n[FATIGUE] > 0.62) unmet.push('islandFatigue');
            entry.mood = Math.round(m * 1000) / 1000;
            entry.moodLabel = p.moodLabel;
            entry.doing = p.actionId;
          }
        }
      }

      // Household crowding, which the narrative pack asks for by name. Amortised over a sim-hour.
      if (tick % 6 === 0) {
        for (const hh of R.households) {
          const e = byId.get(hh.id);
          if (e) e.crowding = Math.round(hh.crowding * 1000) / 1000;
        }
      }

      state.decisionsLastTick = decisions;
      state.tracked = people.length;

      if (w.clock.minuteOfDay === 200) lanesDirty = true;
      if (tick % 6 === 0) summarise(people);
    },

    describe(w) {
      return {
        tracked: state.tracked,
        decisions: state.decisionsLastTick,
        mean: state.mean,
        fatigueMean: state.islandFatigue.mean,
        fatigueOver70: state.islandFatigue.over70,
        topActions: state.topActions,
        unmetPeople: state.unmetCount
      };
    },

    save() {
      if (!R || !R.ready) return null;
      return {
        v: 2,
        needs: Array.from(arr.subarray(0, R.slotCapacity * N)),
        // What everybody was in the middle of. Without this a reload puts two thousand people back
        // on their meters but with no idea what they were doing, and the island jolts.
        doing: R.people.map((p) => [p.id, p.actionId, p.untilTick, p.locationId, p.reason, p.lastActionIds.slice()])
      };
    },
    load(w, s) {
      if (!s || !R || !R.ready) return;
      ensure(R.slotCapacity);
      for (let i = 0; i < s.needs.length && i < arr.length; i++) arr[i] = s.needs[i];
      for (const p of R.people) {
        if (p.slot < 0) continue;
        p.n = arr.subarray(p.slot * N, p.slot * N + N);
      }
      for (const [id, actionId, until, locationId, reason, last] of s.doing || []) {
        const p = R.peopleById.get(id);
        if (!p) continue;
        const a = ACTIONS.find((x) => x.id === actionId);
        p.actionId = actionId;
        p.untilTick = until;
        p.locationId = locationId;
        p.reason = reason;
        p.currentGains = a || null;
        p.sleeping = !!(a && a.sleeping);
        p.actionLabel = a ? a.label : actionId;
        p.resumeAction = null;
        if (last) p.lastActionIds = last;
        const place = a ? resolvePlace(a, p) : null;
        if (place) { p.locationLabel = place.label; p.tx = place.x; p.tz = place.z; }
      }
      lanesDirty = true;
    }
  });

  /* -------------------------------------------------------------- helpers */

  function attach(p, w, c) {
    ensure(p.slot + 1);
    p.n = arr.subarray(p.slot * N, p.slot * N + N);
    const hh = R.householdsById.get(p.householdId);
    p.householdSize = hh ? hh.members.length : 1;
    p.hasVehicle = hh ? hh.vehicles > 0 : false;
    // A ute or a wagon that can legally go on the beach, and a boat, are household facts drawn
    // once. data/residents.json publishes a vehicle count and kinds per archetype; the pack lists a
    // tinny for the Amity weekender and a 4WD for several island households.
    if (!hh) { p.has4WD = false; p.hasBoat = false; p.hasDog = false; }
    else {
      if (hh.has4WD === undefined) {
        hh.has4WD = hh.vehicles > 0 && rng.float() < (hh.townshipId === 'amity-point' || hh.townshipId === 'one-mile' ? 0.55 : 0.42);
        hh.hasBoat = rng.float() < (hh.townshipId === 'amity-point' ? 0.42 : hh.townshipId === 'dunwich' ? 0.24 : 0.20);
        hh.hasDog = rng.float() < 0.38;
      }
      p.has4WD = hh.has4WD; p.hasBoat = hh.hasBoat; p.hasDog = hh.hasDog;
    }
    p.tieCount = p.ties ? p.ties.size : 0;
    p.householdCrowding = hh ? hh.crowding : 0;
    // A byte per action rather than a Set of ids: a string hash in the innermost loop of the
    // hottest system measured slower than the closure it was meant to replace.
    p.canDo = new Uint8Array(ACTIONS.length);
    for (const a of ACTIONS) p.canDo[a.index] = !a.who || a.who(p) ? 1 : 0;
    p.lastActionIds = p.lastActionIds || ['', '', '', ''];
    decayRates(p);
    p._grindMult = (1.7 - p.traits.patience) * (0.8 + (p.stress || 0.4));

    // Start the day mid-range rather than full, with a per-person offset, so the first sim-hour is
    // not two thousand people all deciding to eat at once.
    for (let k = 0; k < FATIGUE; k++) p.n[k] = clamp01(rng.range(0.42, 0.92));
    p.n[FATIGUE] = clamp01(rng.range(0.05, 0.45) * (1.6 - p.traits.patience));

    if (!byId.has(p.id)) {
      const entry = { unmet: [], mood: 0.6, moodLabel: 'settled', doing: 'at-home' };
      byId.set(p.id, entry);
      state[p.id] = entry;
    }
    const hhEntry = hh && !byId.has(hh.id) ? { crowding: hh.crowding } : null;
    if (hhEntry) { byId.set(hh.id, hhEntry); state[hh.id] = hhEntry; }

    p.untilTick = w.clock.tick + rng.int(1, 6);
    p.currentGains = null;
    p.resumeAction = null;
    p.resumeUntil = 0;
  }

  function summarise(people) {
    const sums = new Float64Array(N);
    let over70 = 0, unmet = 0;
    const acts = new Map();
    const townFat = new Map();
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p.n) continue;
      for (let k = 0; k < N; k++) sums[k] += p.n[k];
      if (p.n[FATIGUE] > 0.7) over70++;
      let any = false;
      for (let k = 0; k < FATIGUE; k++) if (p.n[k] < 0.28) { any = true; break; }
      if (any) unmet++;
      acts.set(p.actionId, (acts.get(p.actionId) || 0) + 1);
      const t = townFat.get(p.townshipId) || [0, 0];
      t[0] += p.n[FATIGUE]; t[1]++;
      townFat.set(p.townshipId, t);
    }
    const n = Math.max(1, people.length);
    const mean = {};
    for (let k = 0; k < N; k++) mean[NEEDS[k]] = +(sums[k] / n).toFixed(3);
    state.mean = mean;
    state.unmetCount = unmet;
    let worst = null, worstV = -1;
    const byTown = {};
    for (const [t, v] of townFat) {
      const m = v[0] / Math.max(1, v[1]);
      byTown[t] = +m.toFixed(3);
      if (m > worstV) { worstV = m; worst = t; }
    }
    state.islandFatigue = { mean: mean.islandFatigue, worstTownship: worst, byTownship: byTown, over70 };
    const top = Array.from(acts.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
    state.topActions = top.map(([id, count]) => `${id}:${count}`);
    const doing = {};
    for (const [id, count] of acts) doing[id] = count;
    state.doingNow = doing;
    crowd = doing;
  }
}
