// Notifications. The island is loud: thirty eight systems publish about fifty kinds of event and
// some of them fire a thousand times a day. This file is the filter between all of that and a
// player who has a screen full of island to look at.
//
// ============================================================================================
// ADDING AN EVENT: add one row to EVENT_COPY below. Do not touch anything further down.
// ============================================================================================
//
// A row looks like this and every field except `type` and `headline` is optional:
//
//   { type:      'ferry:cancelled',            // the exact bus event type
//     tier:      'critical',                   // critical | warning | notice | chatter
//     icon:      'ferry',                      // a key from ICONS at the bottom of this file
//     system:    'Vehicle ferry',              // who raised it, in words a player knows
//     when:      (p) => p.lastOfDay,           // optional filter: false means do not raise it
//     headline:  (p) => `The ${p.sailing} barge is cancelled`,
//     detail:    (p) => p.why,                 // optional second line
//     group:     () => 'ferry-cancelled',      // optional: same key collapses into one card
//     grouped:   (n) => `${n} sailings cancelled`,
//     at:        (p) => ({ x: p.x, z: p.z }),  // or { place:'dunwich' } or { lon, lat }
//     act:       () => ({ label:'More sailings', lever:'vehicle-barge-peak-sailings' }) }
//
// `at` gives the card a "take me there" that flies the camera. `act` gives it a "do something"
// that emits `ui:intent` on the bus, which a civic system then decides about: nothing in this
// file changes the island directly.
//
// Only types listed here are ever shown. Anything else is ignored, which is why the ferry
// arriving eight hundred and fifty times in ten days does not bury the one that was cancelled.
// `TWIN.notify.unmapped()` lists every event type the world has raised that has no row here, so
// the next person can see what they are missing without reading the whole bus.

import { registerPanel, el } from '../mount.js';

/* ==========================================================================================
   THE COPY TABLE
   ========================================================================================== */

export const EVENT_COPY = [
  /* ---- the crossing. Everything that is not already here comes over this water ---- */
  { type: 'ferry:cancelled', tier: 'critical', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => `The ${p.sailing || ''} barge is cancelled`.trim(),
    detail: (p) => [p.why, p.slotsLost ? `${p.slotsLost} car slots gone from the day` : null].filter(Boolean).join('. '),
    group: () => 'ferry-cancelled',
    grouped: (n) => `${n} barge sailings cancelled today`,
    at: () => ({ place: 'dunwich' }),
    act: () => ({ label: 'Ask for more sailings', lever: 'vehicle-barge-peak-sailings' }) },

  { type: 'ferry:stranded', tier: 'critical', icon: 'ferry', system: 'Passenger ferry',
    headline: (p) => p.lastOfDay
      ? `${p.people || 'Some'} people are not getting home tonight`
      : `${p.people || 'Some'} people are waiting on the next water taxi`,
    detail: (p) => p.why,
    at: () => ({ place: 'dunwich' }) },

  { type: 'ferry:vessel-down', tier: 'critical', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => `${p.vessel || 'A vessel'} is out of service`,
    detail: (p) => p.text,
    at: () => ({ place: 'dunwich' }) },

  { type: 'ferry:queue-spill', tier: 'warning', icon: 'car', system: 'Toondah Harbour',
    headline: (p) => `The barge queue is out onto ${p.street || 'the street'}`,
    detail: (p) => `${p.vehicles || 0} vehicles past a yard that holds ${p.yardCapacity || '?'}`,
    group: () => 'queue-spill',
    grouped: (n) => `The barge queue spilled onto the street ${n} times today`,
    act: () => ({ label: 'A proper holding area', lever: 'dunwich-queue-holding-area' }) },

  { type: 'ferry:rolled', tier: 'warning', icon: 'car', system: 'Vehicle ferry',
    headline: (p) => `${plural(p.vehicles, 'vehicle')} did not get across today`,
    detail: (p) => p.text,
    group: () => 'ferry-rolled',
    grouped: (n, p) => `${plural(p.vehicles, 'vehicle')} did not get across, ${n} days running`,
    at: () => ({ place: 'dunwich' }),
    act: () => ({ label: 'Ask for more sailings', lever: 'vehicle-barge-peak-sailings' }) },

  { type: 'ferry:overflow', tier: 'notice', icon: 'people', system: 'Passenger ferry',
    headline: (p) => `${p.people || 0} people did not fit on the ${p.sailing || ''} water taxi`.trim(),
    detail: (p) => `About ${p.waitMin || 75} minutes to the next one`,
    group: () => 'ferry-overflow',
    grouped: (n) => `${n} water taxi sailings left people behind today` },

  { type: 'ferry:freight-spoiled', tier: 'warning', icon: 'box', system: 'Freight',
    headline: (p) => `${p.items || 0} chilled freight lines missed the boat`,
    detail: (p) => p.text,
    act: () => ({ label: 'The cost of the crossing', lever: 'freight-and-cost-of-living' }) },

  { type: 'ferry:emergency-priority', tier: 'notice', icon: 'alert', system: 'Vehicle ferry',
    headline: () => 'An emergency vehicle took priority on the barge',
    detail: (p) => p.text },

  { type: 'ferry:sold-out', tier: 'chatter', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => `The ${p.sailing} sailing is sold out`,
    detail: (p) => `${p.vessel}, ${p.cars} cars`,
    group: () => 'ferry-sold-out',
    grouped: (n) => `${n} sailings sold out today` },

  { type: 'ferry:vessel-back', tier: 'notice', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => `${p.vessel || 'The vessel'} is back on the run` },

  { type: 'ferry:day', tier: 'chatter', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => trimStop(p.text) || 'Today\'s sailings are set' },

  { type: 'ferry:delayed', tier: 'chatter', icon: 'ferry', system: 'Vehicle ferry',
    headline: (p) => `The ${p.sailing || ''} sailing is running ${p.delayMin || 0} minutes late`.trim(),
    group: () => 'ferry-delayed',
    grouped: (n) => `${n} sailings ran late today` },

  { type: 'freight:crossing-lost', tier: 'warning', icon: 'box', system: 'Freight',
    headline: (p) => `No freight came over today: ${p.why || 'no sailings ran'}`,
    detail: (p) => `${p.runs || 0} carrier runs lost. The shelves feel it two days later, not today.` },

  { type: 'freight:bumped', tier: 'notice', icon: 'box', system: 'Freight',
    headline: (p) => `${plural(p.runs, 'freight run')} bumped off the barge`,
    detail: (p) => p.why },

  { type: 'freight:abandoned', tier: 'notice', icon: 'box', system: 'Freight',
    headline: (p) => `${plural(p.orders, 'order')} given up on` },

  /* ---- getting around the island ---- */
  { type: 'navigation:island-cut', tier: 'critical', icon: 'road', system: 'Roads',
    headline: () => 'The island is cut in two',
    detail: (p) => p.text,
    act: () => ({ label: 'Renew the main road', lever: 'east-coast-road-renewal' }) },

  { type: 'navigation:island-rejoined', tier: 'notice', icon: 'road', system: 'Roads',
    headline: () => 'East Coast Road is open again' },

  { type: 'navigation:beach-closed', tier: 'chatter', icon: 'wave', system: 'Beach access',
    headline: (p) => `${p.beach} is closed to vehicles`,
    detail: (p) => p.text,
    at: (p) => ({ place: p.beach }) },

  { type: 'navigation:beach-open', tier: 'chatter', icon: 'wave', system: 'Beach access',
    headline: (p) => `${p.beach} is drivable again`,
    detail: (p) => p.text,
    at: (p) => ({ place: p.beach }) },

  { type: 'tourism:parking-full', tier: 'notice', icon: 'car', system: 'Tourism',
    headline: (p) => `Point Lookout parking is full`,
    detail: (p) => `${p.wanted || 0} carloads wanting ${p.bays || 0} bays, about ${Math.round(p.searchMinutes || 0)} minutes circling`,
    group: () => 'parking-full',
    grouped: (n) => `Point Lookout parking filled ${n} times today`,
    at: () => ({ place: 'point-lookout' }),
    act: () => ({ label: 'Manage the parking', lever: 'point-lookout-parking-management' }) },

  { type: 'tourism:capacity-lost', tier: 'warning', icon: 'car', system: 'Tourism',
    headline: (p) => `${p.people || 0} people gave up looking for a park`,
    detail: (p) => `${p.carloads || 0} carloads turned around at ${p.where || 'Point Lookout'}`,
    at: () => ({ place: 'point-lookout' }),
    act: () => ({ label: 'Manage the parking', lever: 'point-lookout-parking-management' }) },

  /* ---- what is on. src/systems/agents/events.js, out of data/events.json ---- */

  { type: 'events:opens', tier: 'notice', icon: 'bell', system: 'The calendar',
    headline: (p) => `${p.name} starts today`,
    detail: (p) => [
      `About ${p.expected} people at the busiest moment, which is an estimate`,
      p.days > 1 ? `over ${p.days} days` : null,
      p.sourced ? null : 'date worked out from the pattern, not published'
    ].filter(Boolean).join(', '),
    at: (p) => (p.place ? { place: p.place } : null) },

  { type: 'events:peak', tier: 'notice', icon: 'people', system: 'The calendar',
    headline: (p) => `${p.name} is at its busiest`,
    detail: (p) => `About ${p.people} people on site`,
    at: (p) => (p.place ? { place: p.place } : null) },

  { type: 'events:called-off', tier: 'warning', icon: 'wind', system: 'The calendar',
    headline: (p) => (p.effect === 'postponed' ? `${p.name} is held over` : `${p.name} is off`),
    detail: (p) => p.why,
    at: (p) => (p.place ? { place: p.place } : null) },

  // The weather does more than cancel. A surf club moves the session to the sheltered beach before
  // it calls it off, and a cancelled crossing takes half the crowd out of a club night rather than
  // ending it. Both come out of the record's own `cancels_if` sentence.
  { type: 'events:moved', tier: 'notice', icon: 'wind', system: 'The calendar',
    headline: (p) => `${p.name} has moved`,
    detail: (p) => p.why,
    at: (p) => (p.to ? { place: p.to } : null) },

  { type: 'events:shortened', tier: 'notice', icon: 'wind', system: 'The calendar',
    headline: (p) => `${p.name} is running short`,
    detail: (p) => `${p.why}. About ${p.expected} people now expected at the busiest moment.` },

  { type: 'events:capacity-bit', tier: 'warning', icon: 'ferry', system: 'The calendar',
    headline: (p) => `${p.people} people did not get across for ${p.name}`,
    detail: () => 'The boats are the ceiling on every event on this island, and today it bound.',
    at: () => ({ place: 'dunwich' }),
    act: () => ({ label: 'Ask for more sailings', lever: 'vehicle-barge-peak-sailings' }) },

  { type: 'visitors:peak', tier: 'notice', icon: 'people', system: 'Visitors',
    headline: (p) => `${p.onIsland || 0} visitors on the island, a new peak`,
    detail: (p) => `Pressure index ${Number(p.pressure || 0).toFixed(2)} against the island's practical limit`,
    group: () => 'visitor-peak',
    grouped: (n) => `The visitor peak was broken ${n} times` },

  { type: 'visitors:turned-away', tier: 'notice', icon: 'people', system: 'Visitors',
    headline: () => 'Visitors turned away at the water',
    detail: (p) => p.reason },

  /* ---- the works ---- */
  { type: 'power:shedding', tier: 'critical', icon: 'bolt', system: 'Power',
    headline: (p) => `The power is off in ${(p.blocks && p.blocks.length) || 'some'} places`,
    detail: (p) => [p.cause, p.kwShort ? `${p.kwShort} kW short` : null].filter(Boolean).join('. '),
    act: () => ({ label: 'Island energy resilience', lever: 'island-energy-resilience' }) },

  { type: 'power:restored', tier: 'notice', icon: 'bolt', system: 'Power',
    headline: (p) => `Power restored after ${Math.round((p.minutes || 0) / 60)} h ${Math.round((p.minutes || 0) % 60)} min` },

  { type: 'power:cable-fault', tier: 'warning', icon: 'bolt', system: 'Power',
    headline: (p) => `A bay cable circuit is out: ${p.cause || 'cause unknown'}`,
    detail: (p) => `About ${p.repairDays || '?'} days to repair. ${p.circuitsUp || 0} circuits still up.` },

  { type: 'power:diesel-out', tier: 'warning', icon: 'bolt', system: 'Power',
    headline: (p) => `${p.label || 'A standby generator'} is out of fuel` },

  { type: 'water:restrictions', tier: 'warning', icon: 'droplet', system: 'Water',
    headline: (p) => (p.level > 0
      ? `Water restrictions: ${p.label || 'level ' + p.level}`
      : 'Water restrictions lifted'),
    detail: (p) => p.reason,
    act: (p) => (p.level > 0 ? { label: 'Recycled water scheme', lever: 'recycled-water-scheme' } : null) },

  { type: 'water:boil-notice', tier: 'critical', icon: 'droplet', system: 'Water',
    headline: () => 'Boil water notice',
    detail: (p) => [p.reason, (p.townships || []).join(', ')].filter(Boolean).join('. ') },

  { type: 'water:boil-notice-lifted', tier: 'notice', icon: 'droplet', system: 'Water',
    headline: () => 'The boil water notice is lifted' },

  { type: 'water:overflow', tier: 'warning', icon: 'droplet', system: 'Wastewater',
    headline: (p) => `${p.kl || 0} kL went past the treatment plant`,
    detail: () => 'It went out on the ocean side, which is the side people swim on.',
    at: () => ({ place: 'point-lookout' }),
    act: () => ({ label: 'Extend the sewer', lever: 'sewer-network-extension' }) },

  { type: 'water:bore-offline', tier: 'notice', icon: 'droplet', system: 'Water',
    headline: (p) => `${p.label || 'A bore'} is offline`,
    detail: (p) => `About ${p.days || '?'} days` },

  { type: 'waste:backlog', tier: 'warning', icon: 'bin', system: 'Waste',
    headline: (p) => `${p.tonnes || 0} tonnes of rubbish sitting in the yard`,
    detail: (p) => `About ${p.days || 0} days of backlog waiting on a barge`,
    at: () => ({ place: 'dunwich' }),
    act: () => ({ label: 'Change the waste barge run', lever: 'waste-barge-frequency' }) },

  { type: 'waste:centre-closed', tier: 'warning', icon: 'bin', system: 'Waste',
    headline: () => 'The transfer station is shut to the public',
    detail: (p) => p.reason,
    act: () => ({ label: 'Upgrade the transfer station', lever: 'transfer-station-upgrade' }) },

  { type: 'waste:centre-open', tier: 'notice', icon: 'bin', system: 'Waste',
    headline: () => 'The transfer station is open again' },

  { type: 'waste:kerbside-missed', tier: 'notice', icon: 'bin', system: 'Waste',
    headline: (p) => `${p.bins || 0} bins were not emptied`,
    detail: (p) => `${p.tonnes || 0} tonnes still on the kerb` },

  { type: 'waste:load-rejected', tier: 'notice', icon: 'bin', system: 'Waste',
    headline: (p) => `${p.loads || 0} recycling loads rejected`,
    detail: (p) => `Contamination at ${Math.round((p.contamination || 0) * 100)} per cent`,
    act: () => ({ label: 'A reuse and repair shop', lever: 'island-reuse-and-repair' }) },

  { type: 'telecoms:outage', tier: 'critical', icon: 'signal', system: 'Telecoms',
    headline: () => 'Part of the island is off the network',
    detail: (p) => p.cause },

  { type: 'telecoms:site-down', tier: 'warning', icon: 'signal', system: 'Telecoms',
    headline: (p) => `${p.label || 'A mobile site'} is down`,
    group: () => 'telecoms-site',
    grouped: (n) => `${n} mobile sites are down` },

  { type: 'telecoms:backhaul-fault', tier: 'warning', icon: 'signal', system: 'Telecoms',
    headline: (p) => `Backhaul fault: ${p.cause || 'cause unknown'}`,
    detail: (p) => `About ${p.days || '?'} days` },

  { type: 'telecoms:backhaul-restored', tier: 'notice', icon: 'signal', system: 'Telecoms',
    headline: () => 'Backhaul is restored' },

  /* ---- the living island ---- */
  { type: 'ecology:alert', tier: 'warning', icon: 'leaf', system: 'Ecology',
    headline: (p) => firstSentence(p.text) || 'Something changed in the ecology',
    detail: (p) => restOfText(p.text),
    group: (p) => 'eco-' + (p.id || 'alert'),
    grouped: (n, p) => `${firstSentence(p.text)} (${n} times)` },

  { type: 'wildlife:call', tier: 'warning', icon: 'paw', system: 'Wildlife rescue',
    headline: (p) => capitalise(p.situation || `${p.species} needs help`),
    detail: (p) => [p.where ? `At ${p.where}.` : null, p.publicRule || 'Watch, keep back, call.',
      p.contact].filter(Boolean).join(' '),
    group: (p) => 'call-' + (p.species || '') + '-' + (p.situation || ''),
    grouped: (n, p) => `${n} calls: ${p.situation || p.species}`,
    at: (p) => ({ x: p.x, z: p.z, place: p.where }),
    act: (p) => (p.species === 'Koala'
      ? { label: 'Speeds and crossings', lever: 'wildlife-speed-and-crossings' }
      : { label: 'Fund the rescue volunteers', lever: 'wildlife-rescue-support' }) },

  { type: 'coast:flow-slide', tier: 'critical', icon: 'wave', system: 'Coast',
    headline: (p) => `Flow slide at ${p.where || 'the foreshore'}`,
    detail: (p) => `${p.frontageM || 0} m of foreshore, ${p.retreatM || 0} m of land. ${p.warned ? 'The survey had it on the watch list.' : 'Nobody was watching this reach.'}`,
    at: () => ({ place: 'amity-point' }),
    act: () => ({ label: 'The buried seawall', lever: 'amity-southern-buried-seawall' }) },

  { type: 'coast:storm-cut', tier: 'warning', icon: 'wave', system: 'Coast',
    headline: (p) => `Storm cut sand off ${p.where || 'the dunes'}`,
    detail: (p) => `${p.cutM3PerM || 0} cubic metres a metre in ${p.swellM || 0} m of swell`,
    at: (p) => ({ place: p.where }),
    group: () => 'storm-cut',
    grouped: (n) => `Storm cut sand off ${n} reaches`,
    act: () => ({ label: 'Dune restoration', lever: 'dune-restoration-program' }) },

  { type: 'ecology:burn', tier: 'notice', icon: 'flame', system: 'Vegetation',
    headline: (p) => `${p.cause === 'planned' ? 'Planned burn' : 'Fire'} at ${p.where || 'the heath'}: ${Math.round(p.ha || 0)} ha`,
    at: (p) => ({ x: p.x, z: p.z, place: p.where }) },

  { type: 'ecology:smoke', tier: 'notice', icon: 'flame', system: 'Vegetation',
    headline: (p) => p.notified ? `Smoke over ${p.where}, notified in advance` : `Unnotified smoke over ${p.where}`,
    detail: (p) => p.text,
    at: (p) => ({ place: p.where }),
    act: () => ({ label: 'Notify and time the burns', lever: 'burn-notification-and-timing' }) },

  { type: 'ecology:nest', tier: 'notice', icon: 'turtle', system: 'Marine',
    headline: (p) => `${p.species} nested at ${p.where}`,
    detail: (p) => `${p.eggs || 0} eggs`,
    at: (p) => ({ place: p.where }) },

  { type: 'ecology:hatch', tier: 'notice', icon: 'turtle', system: 'Marine',
    headline: (p) => `${p.hatchlings || 0} loggerhead hatchlings made the water at ${p.where}`,
    detail: (p) => `Sand at ${p.sandTempC} °C, about ${p.femaleSharePct} per cent female`,
    at: (p) => ({ place: p.where }) },

  { type: 'whales:sighting', tier: 'notice', icon: 'whale', system: 'Whales',
    headline: (p) => `Whales off ${p.from || 'the headland'}: ${p.what || 'surfacing'}`,
    detail: (p) => `${p.podSize || 1} in the pod${p.calf ? ' with a calf' : ''}, ${p.distanceKm} km out`,
    group: () => 'whale-sighting',
    grouped: (n) => `${n} whale sightings from the headland`,
    at: (p) => ({ x: p.x, z: p.z, place: p.from }) },

  { type: 'whales:season', tier: 'notice', icon: 'whale', system: 'Whales',
    headline: () => 'Whale season',
    detail: (p) => p.text },

  { type: 'shorebirds:departed-light', tier: 'warning', icon: 'bird', system: 'Shorebirds',
    headline: (p) => `${p.birds || 0} ${p.species} left ${p.shortPct} per cent light`,
    detail: (p) => p.text,
    at: (p) => ({ place: p.where }),
    act: () => ({ label: 'Seasonal beach closures', lever: 'beach-driving-seasonal-closures' }) },

  /* ---- people, houses and work ---- */
  { type: 'housing:worker-cannot-find-a-room', tier: 'warning', icon: 'house', system: 'Housing',
    headline: (p) => `${p.people || 0} island workers cannot find a room`,
    detail: (p) => `${p.rentalsOnTheMarket || 0} rentals advertised, ${p.housesLetToVisitors || 0} houses let to visitors`,
    act: () => ({ label: 'Build worker accommodation', lever: 'worker-accommodation-build' }) },

  { type: 'jobs:left-for-want-of-a-room', tier: 'warning', icon: 'house', system: 'Jobs',
    headline: (p) => `${plural(p.people, 'person', 'people')} left the island for want of a room`,
    detail: (p) => `Rent is ${p.rentAsShareOfWagePct} per cent of an island wage`,
    act: () => ({ label: 'Register short stay letting', lever: 'short-stay-letting-registration' }) },

  { type: 'jobs:vacancy-unfilled', tier: 'notice', icon: 'coin', system: 'Jobs',
    headline: (p) => `A job at ${leverish(p.business)} has been open ${plural(Math.round(p.daysOpen), 'day')}`,
    detail: (p) => `${township(p.township)}, short by ${Number(p.short || 0).toFixed(1)} of a full roster`,
    group: () => 'vacancy',
    grouped: (n) => `${n} island jobs nobody has taken`,
    at: (p) => ({ place: p.township }),
    act: () => ({ label: 'Build worker accommodation', lever: 'worker-accommodation-build' }) },

  { type: 'jobs:trade-queue', tier: 'notice', icon: 'house', system: 'Jobs',
    headline: (p) => `${plural(p.waiting, 'job')} waiting on a tradie`,
    detail: (p) => `${p.why}. Longest wait ${Math.round(p.longestWaitDays || 0)} days.`,
    act: () => ({ label: 'Buy local and train local', lever: 'local-procurement-and-training' }) },

  { type: 'household:left-the-island', tier: 'notice', icon: 'house', system: 'Population',
    headline: (p) => `A household left ${township(p.township)}`,
    detail: (p) => p.why,
    group: () => 'left-island',
    grouped: (n) => `${n} households have left the island`,
    at: (p) => ({ place: p.township }) },

  { type: 'household:dissolved', tier: 'notice', icon: 'house', system: 'Population',
    headline: (p) => `A household in ${township(p.township)} broke up`,
    detail: (p) => p.why,
    group: () => 'dissolved',
    grouped: (n) => `${n} households broke up`,
    at: (p) => ({ place: p.township }) },

  { type: 'housing:lease-ending', tier: 'notice', icon: 'house', system: 'Housing',
    headline: (p) => `A lease is ending: ${p.household || 'a household'}`,
    detail: (p) => `${plural(p.people, 'person', 'people')} in ${township(p.township)}, `
      + `${plural(p.rentalsOnTheMarket, 'rental')} advertised on the whole island`,
    group: () => 'lease-ending',
    grouped: (n) => `${n} leases are ending with nowhere to go`,
    at: (p) => ({ place: p.township }),
    act: () => ({ label: 'Expand community housing', lever: 'community-housing-expansion' }) },

  { type: 'housing:converted', tier: 'chatter', icon: 'house', system: 'Housing',
    headline: (p) => `A house in ${township(p.township)} became ${p.to}`,
    detail: (p) => p.why,
    group: (p) => 'converted-' + p.to,
    grouped: (n, p) => `${n} houses became ${p.to}` },

  { type: 'household:moved-in', tier: 'chatter', icon: 'house', system: 'Population',
    headline: (p) => `${p.people || 1} people moved into ${township(p.township)}`,
    group: () => 'moved-in',
    grouped: (n) => `${n} households moved in`,
    at: (p) => ({ place: p.township }) },

  { type: 'housing:lost-to-holiday-let', tier: 'notice', icon: 'house', system: 'Housing',
    headline: (p) => `A rental in ${township(p.township)} became a holiday let`,
    group: () => 'to-holiday-let',
    grouped: (n) => `${n} rentals became holiday lets`,
    act: () => ({ label: 'Cap short stay by township', lever: 'short-stay-cap-by-township' }) },

  { type: 'business:stockout', tier: 'notice', icon: 'box', system: 'Businesses',
    headline: (p) => `${p.name} is out of ${p.label || p.line}`,
    detail: (p) => p.why,
    group: () => 'stockout',
    grouped: (n) => `${n} businesses are out of something`,
    at: (p) => ({ place: p.township }) },

  { type: 'business:strained', tier: 'notice', icon: 'coin', system: 'Businesses',
    headline: (p) => `${p.name} is under strain`,
    detail: (p) => `${p.township}, strain index ${p.strain}`,
    group: () => 'strained',
    grouped: (n) => `${n} businesses are under strain`,
    at: (p) => ({ place: p.township }) },

  { type: 'business:reduced-hours', tier: 'notice', icon: 'coin', system: 'Businesses',
    headline: (p) => `${p.name} cut its hours by ${p.cutPct} per cent`,
    detail: (p) => p.why,
    at: (p) => ({ place: p.township }) },

  { type: 'business:recovered', tier: 'chatter', icon: 'box', system: 'Businesses',
    headline: (p) => `${p.name} has ${p.line} back on the shelf`,
    group: () => 'recovered',
    grouped: (n) => `${n} businesses restocked` },

  { type: 'resident:stranded', tier: 'notice', icon: 'people', system: 'Residents',
    headline: (p) => `${p.name || 'A resident'} is stuck on the wrong side of the water`,
    detail: (p) => p.why,
    group: () => 'resident-stranded',
    grouped: (n) => `${n} residents are stuck on the wrong side of the water` },

  { type: 'person:died', tier: 'chatter', icon: 'people', system: 'Population',
    headline: (p) => `${p.name} of ${township(p.township)} has died, aged ${Math.floor(p.age || 0)}` },

  { type: 'person:born', tier: 'chatter', icon: 'people', system: 'Population',
    headline: (p) => `${p.name} was born in ${township(p.township)}` },

  { type: 'resident:crossing-cancelled', tier: 'chatter', icon: 'ferry', system: 'Residents',
    headline: (p) => `${p.name || 'A resident'} lost a crossing`,
    group: () => 'crossing-cancelled',
    grouped: (n) => `${n} residents lost a crossing today` },

  /* ---- the civic layer ---- */
  { type: 'civic:agenda', tier: 'warning', icon: 'doc', system: 'Council',
    headline: (p) => `${p.deciderLabel || 'A decision maker'} put ${p.leverName || 'something'} on its agenda`,
    detail: (p) => p.text },

  { type: 'civic:application', tier: 'notice', icon: 'doc', system: 'Council',
    headline: (p) => `A file is open on ${p.leverId ? leverName(p.leverId) : 'a lever'}`,
    detail: (p) => `Stage: ${p.stage}. Decided by ${p.decider}.`,
    group: (p) => 'app-' + p.applicationId,
    grouped: (n, p) => `${leverName(p.leverId)} is at ${p.stage}` },

  { type: 'civic:decision', tier: 'critical', icon: 'doc', system: 'Council',
    headline: (p) => `${capitalise(p.outcome || 'decided')}: ${leverName(p.leverId)}`,
    detail: (p) => p.reason },

  { type: 'civic:enact', tier: 'notice', icon: 'doc', system: 'Council',
    headline: (p) => `${leverName(p.leverId)} is going ahead` },

  { type: 'civic:delivered', tier: 'notice', icon: 'doc', system: 'Policy',
    headline: (p) => `${p.name || leverName(p.leverId)} is delivered` },

  { type: 'civic:lapsed', tier: 'warning', icon: 'doc', system: 'Policy',
    headline: (p) => `${p.name || leverName(p.leverId)} has lapsed`,
    detail: (p) => p.reason },

  { type: 'civic:stalled', tier: 'warning', icon: 'coin', system: 'Budget',
    headline: (p) => p.on === false ? `${p.name} is moving again` : `${p.name} has stopped for want of money`,
    detail: (p) => p.text },

  { type: 'civic:overdrawn', tier: 'critical', icon: 'coin', system: 'Budget',
    headline: () => 'A fund is overdrawn',
    detail: (p) => p.text || p.reason },

  { type: 'civic:funds-short', tier: 'warning', icon: 'coin', system: 'Budget',
    headline: (p) => p.text || 'There is not enough money in the fund',
    detail: (p) => p.reason },

  { type: 'civic:funds-exhausted', tier: 'critical', icon: 'coin', system: 'Budget',
    headline: (p) => p.text || 'A fund is spent out',
    detail: (p) => p.reason },

  { type: 'civic:budget-open', tier: 'notice', icon: 'coin', system: 'Budget',
    headline: (p) => `The ${p.fy || 'new'} budget is open` },

  { type: 'civic:budget-adopted', tier: 'notice', icon: 'coin', system: 'Budget',
    headline: (p) => `The ${p.fy || ''} budget is adopted`.replace('  ', ' ') },

  { type: 'civic:consultation-opened', tier: 'warning', icon: 'people', system: 'Consultation',
    headline: (p) => `Consultation opened on ${p.leverName || leverName(p.leverId)}`,
    detail: (p) => p.text },

  { type: 'civic:consultation-closed', tier: 'warning', icon: 'people', system: 'Consultation',
    headline: (p) => `Consultation closed on ${leverName(p.leverId)}`,
    detail: (p) => (typeof p.supportShare === 'number'
      ? `${Math.round(p.supportShare * 100)} per cent of those who turned up were in favour`
      : null) },

  { type: 'civic:consultation-refused', tier: 'notice', icon: 'people', system: 'Consultation',
    headline: (p) => `No consultation on ${leverName(p.leverId)}`,
    detail: (p) => p.reason },

  { type: 'civic:referral', tier: 'notice', icon: 'doc', system: 'Council',
    headline: (p) => `Referred to ${p.toLabel || p.to || 'another body'}`,
    detail: (p) => p.text || p.reason },

  { type: 'civic:media', tier: 'notice', icon: 'doc', system: 'Council',
    headline: (p) => `${p.leverName || leverName(p.leverId)} is in the paper` },

  { type: 'civic:info-request', tier: 'warning', icon: 'doc', system: 'Council',
    headline: (p) => `More information wanted on ${leverName(p.leverId)}`,
    detail: (p) => p.text },

  { type: 'civic:deputation', tier: 'notice', icon: 'people', system: 'Council',
    headline: (p) => `A deputation went across for ${leverName(p.leverId)}`,
    detail: (p) => p.text },

  { type: 'civic:commitment', tier: 'notice', icon: 'coin', system: 'Budget',
    headline: (p) => `${p.name || leverName(p.leverId)} is committed`,
    detail: (p) => [p.capital ? `${money(p.capital)} of capital` : null,
      p.recurringPerYear ? `${money(p.recurringPerYear)} a year` : null,
      p.months ? `over ${plural(p.months, 'month')}` : null].filter(Boolean).join(', ') },

  { type: 'civic:enacted', tier: 'notice', icon: 'doc', system: 'Policy',
    headline: (p) => p.level > 0 ? `${p.name} is under way` : `${p.name} is being wound back`,
    detail: (p) => [(p.conditions || []).join('; ') || null,
      p.restsOnPlayerAssumption ? 'This rests on an assumption you recorded, not on a decision anyone made.' : null]
      .filter(Boolean).join(' ') },

  { type: 'civic:cease', tier: 'warning', icon: 'doc', system: 'Council',
    headline: (p) => `${leverName(p.leverId)} has been stopped`,
    detail: (p) => p.reason },

  { type: 'civic:discovery', tier: 'warning', icon: 'doc', system: 'Policy',
    headline: (p) => p.text || `${p.leverName} is moving ${p.metricLabel}`,
    detail: (p) => `Second order effect on ${p.metricLabel}, ${p.direction}. Nobody planned this one.` },

  { type: 'civic:capacity', tier: 'warning', icon: 'doc', system: 'Policy',
    headline: (p) => p.on
      ? `Too much at once: ${plural(p.count, 'project')} in delivery`
      : 'The delivery load has eased',
    detail: (p) => p.note },

  { type: 'civic:spend', tier: 'chatter', icon: 'coin', system: 'Budget',
    headline: (p) => `${money(p.amount)} out of the ${p.fund === 'council-island' ? 'council island program' : p.fund}`,
    detail: (p) => p.reason || p.label,
    group: (p) => 'spend-' + p.fund,
    grouped: (n, p) => `${n} payments out of the ${p.fund === 'council-island' ? 'council island program' : p.fund}` },

  { type: 'chour:allocated', tier: 'chatter', icon: 'coin', system: 'C-hour ledger',
    headline: (p) => `${money(p.a$)} to ${p.name}`,
    detail: (p) => p.purpose,
    group: () => 'chour-allocated',
    grouped: (n) => `${n} allocations out of the C-hour ledger` },

  { type: 'chour:mode-changed', tier: 'notice', icon: 'coin', system: 'C-hour ledger',
    headline: (p) => `The C-hour ledger is now in ${p.mode} mode` },

  /* ---- the proposed works below the sand. Nothing here exists on the island. ---- */
  { type: 'subterranean:tier', tier: 'notice', icon: 'box', system: 'Proposed works',
    headline: (p) => `Tier ${p.tier} of the proposed works would open: ${p.name}`,
    detail: () => 'Every condition on it is recorded as met. None of it is built.' },

  { type: 'subterranean:trip', tier: 'notice', icon: 'bolt', system: 'Proposed works',
    headline: (p) => `The proposed works would trip: ${plural(p.deficitKw, 'kW')} short`,
    detail: (p) => `${(p.ids || []).length} processes would stop.` },

  { type: 'subterranean:lens-breach', tier: 'warning', icon: 'droplet', system: 'Proposed works',
    headline: (p) => `The proposed works would draw the fresh water lens down ${p.drawdownMm} mm`,
    detail: (p) => `The band this design allows itself is ${p.bandMm} mm. This is a modelled proposal, not a facility.` },

  { type: 'subterranean:orphan-stall', tier: 'notice', icon: 'box', system: 'Proposed works',
    headline: (p) => `A proposed process would shut down: ${leverish(p.resource)} has nowhere to go` },

  /* ---- the drama ---- */
  { type: 'narrative:thread-open', tier: 'notice', icon: 'book', system: 'Story',
    headline: (p) => p.title || 'Something is happening',
    detail: (p) => {
      const cast = (p.cast || []).filter((c) => c.billing === 'primary').map((c) => c.name);
      return cast.length ? cast.join(' and ') + ', ' + township(p.township) : township(p.township);
    },
    at: (p) => ({ place: p.township }) },

  { type: 'social:partnership', tier: 'chatter', icon: 'people', system: 'Island life',
    headline: (p) => p.text },
  { type: 'social:friendship', tier: 'chatter', icon: 'people', system: 'Island life',
    headline: (p) => p.text },
  { type: 'social:falling-out', tier: 'chatter', icon: 'people', system: 'Island life',
    headline: (p) => p.text },

  /* ---- weather, and the generic channel anything can use ---- */
  { type: 'weather:change', tier: 'chatter', icon: 'wind', system: 'Weather',
    headline: (p) => p.label || 'The weather is changing' },

  { type: 'tide:day', tier: 'chatter', icon: 'wave', system: 'Tide',
    headline: (p) => `${p.springNeap > 0.66 ? 'Spring tides' : p.springNeap < 0.33 ? 'Neap tides' : 'Middling tides'}, ${p.range} m of range today` },

  { type: 'power:diesel-ordered', tier: 'chatter', icon: 'bolt', system: 'Power',
    headline: (p) => `${plural(p.litres, 'litre')} of standby diesel ordered`,
    detail: (p) => money(p.costA$) + ', and it comes over on the barge like everything else' },

  { type: 'notice', tier: 'notice', icon: 'alert', system: 'System',
    headline: (p) => p.text || 'Notice',
    when: (p) => !!(p && p.text) }
];

/* ==========================================================================================
   Everything below is the machinery. Adding an event should not need any of it.
   ========================================================================================== */

const TIERS = {
  critical: { rank: 3, label: 'Critical', holdMs: 0, colour: 'coral' },
  warning: { rank: 2, label: 'Warning', holdMs: 26000, colour: 'sun' },
  notice: { rank: 1, label: 'Notice', holdMs: 13000, colour: 'sea' },
  chatter: { rank: 0, label: 'Chatter', holdMs: 0, colour: 'iron' }
};
// Three on screen, everything in the log. Three is what fits between the bottom left corner and
// the tool rail on the left edge without the stack ever reaching into the middle of the screen.
const STACK_MAX = 3;
const HISTORY_MAX = 800;

/* ---- small text helpers used by the copy table --------------------------- */

function capitalise(s) {
  s = String(s == null ? '' : s);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function firstSentence(s) {
  if (!s) return '';
  const m = String(s).match(/^(.{0,120}?[.!?])(\s|$)/);
  return m ? m[1].replace(/\.$/, '') : String(s).slice(0, 118);
}
function restOfText(s) {
  if (!s) return '';
  const first = firstSentence(s);
  const rest = String(s).slice(first.length).replace(/^[.!?\s]+/, '');
  return rest;
}
/** A headline does not end in a full stop. Payload `text` fields usually do. */
function trimStop(s) {
  return s ? String(s).replace(/\s*\.\s*$/, '') : '';
}
/** "1 person", "3 people". Counting is the commonest way a HUD sounds like a machine. */
function plural(n, one, many) {
  const v = Number(n);
  if (!Number.isFinite(v)) return one;
  const rounded = Math.round(v * 100) / 100;
  return rounded + ' ' + (Math.abs(rounded) === 1 ? one : (many || one + 's'));
}
/** A$ in the house style: whole dollars under a thousand, k and M above. */
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'A$0';
  const a = Math.abs(n);
  if (a >= 1e6) return 'A$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 2) + 'M';
  if (a >= 1e4) return 'A$' + Math.round(n / 1e3) + 'k';
  return 'A$' + Math.round(n).toLocaleString('en-AU');
}
/** An id turned back into words, for payloads that only carry an id. */
function leverish(id) {
  return String(id == null ? '' : id).replace(/-/g, ' ');
}

// The township ids the agent systems use, in the words a player sees on a sign. Both spellings
// of the Quandamooka names here are published ones and are recorded in data/lore.json.
const TOWNSHIPS = {
  dunwich: 'Dunwich (Goompi)',
  'point-lookout': 'Point Lookout (Mooloomba)',
  'amity-point': 'Amity Point (Pulan)',
  'one-mile': 'One Mile',
  island: 'the island'
};
function township(id) {
  if (!id) return 'the island';
  return TOWNSHIPS[id] || String(id);
}

// The lever registry is filled in at mount from data/civic.json, so a copy row can name a lever
// without hard coding its title in two places.
const LEVER_NAMES = new Map();
function leverName(id) {
  if (!id) return 'a lever';
  return LEVER_NAMES.get(id) || String(id).replace(/-/g, ' ');
}

/* ================================================================== registration */

export function registerNotifications(world) {
  registerPanel({
    id: 'notifications',
    order: 20,
    mount(root, w) { return mountNotifications(root, w); }
  });
}

function mountNotifications(root, world) {
  injectStyle();
  injectSprite();

  for (const l of ((world.data && world.data.civic && world.data.civic.levers) || [])) {
    if (l && l.id) LEVER_NAMES.set(l.id, l.name || l.id);
  }
  const places = buildPlaceIndex(world);

  /* ---- compile the copy table ------------------------------------------ */
  const byType = new Map();
  for (const row of EVENT_COPY) {
    if (!row || !row.type) continue;
    if (!byType.has(row.type)) byType.set(row.type, []);
    byType.get(row.type).push(row);
  }
  const unmapped = new Map();

  /* ---- state ------------------------------------------------------------ */
  const live = [];      // cards currently in the stack
  const history = [];   // everything, newest last
  let seq = 0;
  let drawerOpen = false;
  let filterTier = 'all';
  let query = '';
  let unseen = 0;
  // Painting is batched to the 10 Hz update rather than done per event, because at 60x the island
  // can raise a hundred events a second and none of them is worth a reflow of its own.
  let badgeDirty = false;
  let drawerDirty = false;
  let drawerTick = 0;
  let hot = false;
  const PAGE = 150;
  let shown = PAGE;

  /* ---- DOM -------------------------------------------------------------- */

  const stack = el('div', { class: 'ntf-stack' });

  const badge = el('span', { class: 'ntf-badge' }, '0');
  const drawerBtn = el('button', {
    class: 'ntf-tab', type: 'button', title: 'The island log (I)',
    onclick: () => toggleDrawer()
  }, icon('bell'), el('span', { class: 'ntf-tab-label' }, 'Island log'), badge);

  const search = el('input', {
    class: 'ntf-search', type: 'search', placeholder: 'Search the log',
    'aria-label': 'Search the island log',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; paintDrawer(); }
  });

  const tierBtns = ['all', 'critical', 'warning', 'notice', 'chatter'].map((k) => el('button', {
    class: 'ntf-filter' + (k === 'all' ? ' on' : ''), type: 'button', 'data-tier': k,
    onclick: () => {
      filterTier = k;
      for (const b of tierBtns) b.classList.toggle('on', b.getAttribute('data-tier') === k);
      shown = PAGE;
      paintDrawer();
    }
  }, k === 'all' ? 'All' : TIERS[k].label));

  const drawerList = el('div', { class: 'ntf-list scroll' });
  const drawerCount = el('div', { class: 'ntf-count' });
  const drawer = el('div', { class: 'ntf-drawer panel' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, 'Island log'),
      drawerCount,
      el('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Close the log', onclick: () => toggleDrawer(false) }, '×')),
    el('div', { class: 'ntf-tools' }, search, el('div', { class: 'ntf-filters' }, tierBtns)),
    drawerList);

  const wrap = el('div', { class: 'ntf-wrap', id: 'twin-notifications' }, drawer, stack, drawerBtn);
  root.appendChild(wrap);

  /* ---- raising a card ---------------------------------------------------- */

  function stamp() {
    const c = world.clock;
    return {
      day: c.dayIndex,
      minute: c.minuteOfDay,
      abs: c.dayIndex * 1440 + c.minuteOfDay,
      time: c.format(),
      date: c.formatDate()
    };
  }

  function raise(row, payload) {
    let headline;
    try { headline = row.headline ? row.headline(payload, world) : null; } catch (e) { headline = null; }
    if (!headline) return;
    let detail = null;
    try { detail = row.detail ? row.detail(payload, world) : null; } catch (e) { detail = null; }

    const tier = TIERS[row.tier] ? row.tier : 'notice';
    let groupKey = null;
    try { groupKey = row.group ? row.group(payload, world) : null; } catch (e) { groupKey = null; }

    const entry = {
      id: ++seq,
      type: row.type,
      tier,
      icon: row.icon || 'alert',
      system: row.system || row.type.split(':')[0],
      headline: String(headline),
      detail: detail ? String(detail) : '',
      at: stamp(),
      payload,
      row,
      groupKey,
      count: 1
    };
    history.push(entry);
    while (history.length > HISTORY_MAX) history.shift();

    markUnseen(entry);
    drawerDirty = true;
    if (tier === 'chatter') return;

    // Grouping. Five koala road deaths is one card with a count, not five cards.
    if (groupKey) {
      const open = live.find((c) => c.groupKey === groupKey);
      if (open) {
        open.count++;
        open.payload = payload;
        open.at = entry.at;
        try {
          open.headline = row.grouped ? String(row.grouped(open.count, payload, world)) : open.headline;
        } catch (e) { /* keep the first headline rather than lose the card */ }
        open.detail = entry.detail;
        open.expires = expiryFor(open);
        paintCard(open);
        return;
      }
    }

    entry.expires = expiryFor(entry);
    live.push(entry);
    buildCard(entry);
    // Sorted lowest tier first, so what gets pushed out of a full stack is the quietest and oldest
    // thing on it. A critical card is never evicted by anything.
    live.sort((a, b) => (TIERS[a.tier].rank - TIERS[b.tier].rank) || (a.id - b.id));
    while (live.length > STACK_MAX) {
      const drop = live.find((c) => c.tier !== 'critical') || live[0];
      if (drop === entry && live.length <= STACK_MAX + 1 && live.every((c) => c.tier === 'critical' || c === entry)) break;
      dismiss(drop);
    }

    // Only the top tier interrupts. A critical card does not time out, it pulses, and it fades
    // everything below it so the eye goes to the thing that matters.
    if (tier === 'critical') wrap.classList.add('has-critical');
  }

  function expiryFor(entry) {
    const hold = TIERS[entry.tier].holdMs;
    // Wall time, because a player reads in wall time. Held still while the island is paused, so
    // pausing to read a notification never makes it disappear.
    return hold ? { holdMs: hold, started: performance.now() } : null;
  }

  function markUnseen(entry) {
    if (drawerOpen) return;
    unseen++;
    badgeDirty = true;
    if (TIERS[entry.tier].rank >= 2) hot = true;
  }

  /* ---- cards ------------------------------------------------------------ */

  function buildCard(entry) {
    const headline = el('div', { class: 'ntf-headline' });
    const detail = el('div', { class: 'ntf-detail' });
    const countPill = el('span', { class: 'ntf-count-pill' });
    const actions = el('div', { class: 'ntf-actions' });
    const meta = el('span', { class: 'ntf-meta' });

    const node = el('div', { class: 'ntf-card tier-' + entry.tier + ' enter' },
      el('div', { class: 'ntf-ico' }, icon(entry.icon)),
      el('div', { class: 'ntf-body' },
        el('div', { class: 'ntf-top' }, headline, countPill),
        detail,
        el('div', { class: 'ntf-foot' }, meta, actions)),
      el('button', {
        class: 'ntf-x', type: 'button', 'aria-label': 'Dismiss',
        onclick: () => dismiss(entry)
      }, '×'));

    entry.node = node;
    entry.els = { headline, detail, countPill, actions, meta };
    stack.appendChild(node);
    paintCard(entry);
  }

  function paintCard(entry) {
    const e = entry.els;
    if (!e) return;
    if (e.headline.textContent !== entry.headline) e.headline.textContent = entry.headline;
    if (e.detail.textContent !== entry.detail) {
      e.detail.textContent = entry.detail;
      e.detail.style.display = entry.detail ? '' : 'none';
    }
    e.countPill.textContent = entry.count > 1 ? '×' + entry.count : '';
    e.countPill.style.display = entry.count > 1 ? '' : 'none';
    const m = entry.system + ' · ' + entry.at.time;
    if (e.meta.textContent !== m) e.meta.textContent = m;

    if (!e.actions.__built) {
      e.actions.__built = true;
      const target = resolveAt(entry, places, world);
      if (target && world.camera && typeof world.camera.flyTo === 'function') {
        e.actions.appendChild(el('button', {
          class: 'ntf-act', type: 'button',
          onclick: () => flyTo(target)
        }, 'Take me there'));
      }
      let act = null;
      try { act = entry.row.act ? entry.row.act(entry.payload, world) : null; } catch (err) { act = null; }
      if (act) {
        const intent = act.intent || (act.lever ? { kind: 'civic:pursue', leverId: act.lever } : null);
        if (intent) {
          e.actions.appendChild(el('button', {
            class: 'ntf-act primary', type: 'button',
            onclick: (ev) => {
              world.bus.emit('ui:intent', intent);
              ev.currentTarget.textContent = 'Asked for';
              ev.currentTarget.disabled = true;
            }
          }, act.label || 'Do something'));
        }
      }
    }
  }

  function dismiss(entry) {
    const i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
    const node = entry.node;
    entry.node = null;
    entry.els = null;
    // Removed on the spot rather than after an exit animation. A card that waits on a timer to
    // leave the DOM piles up the moment the browser throttles timers, which it does to any tab
    // that is not being looked at, and the stack grows down the whole left of the screen.
    if (node) node.remove();
    if (!live.some((c) => c.tier === 'critical')) wrap.classList.remove('has-critical');
  }

  function flyTo(target) {
    try {
      if (world.camera && typeof world.camera.flyTo === 'function') world.camera.flyTo(target.opts);
      else world.bus.emit('camera:goto', target.opts);
    } catch (e) { /* the rig is not attached: the card stays, nothing breaks */ }
  }

  /* ---- the log drawer --------------------------------------------------- */

  function toggleDrawer(force) {
    drawerOpen = force === undefined ? !drawerOpen : !!force;
    wrap.classList.toggle('open', drawerOpen);
    if (drawerOpen) {
      unseen = 0;
      hot = false;
      badgeDirty = true;
      paintBadge();
      paintDrawer();
      search.focus();
    }
  }

  // I for the island log. Every other board on this island opens from one key and this one only
  // opened from a click, which is the sort of gap that reads as an oversight rather than a
  // decision. The full map is in docs/KEYS.md. Escape closes it, the way Escape closes everything.
  {
    const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && TYPING[e.target.tagName]) {
        // The drawer's own search box: Escape gets you out of it and out of the drawer.
        if (e.code === 'Escape' && drawerOpen) { e.preventDefault(); toggleDrawer(false); }
        return;
      }
      if (e.code === 'KeyI') { e.preventDefault(); toggleDrawer(); }
      else if (e.code === 'Escape' && drawerOpen) { e.preventDefault(); toggleDrawer(false); }
    });
  }

  function paintBadge() {
    if (!badgeDirty) return;
    badgeDirty = false;
    badge.textContent = unseen > 99 ? '99+' : String(unseen);
    badge.classList.toggle('on', unseen > 0);
    drawerBtn.classList.toggle('hot', hot && unseen > 0);
  }

  function paintDrawer() {
    drawerDirty = false;
    if (!drawerOpen) return;
    // Matches are counted in full and rendered up to a limit, so a busy island does not spend
    // five milliseconds a repaint building rows nobody has scrolled to yet. Show older raises it.
    const rows = [];
    let matches = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (filterTier !== 'all' && h.tier !== filterTier) continue;
      if (query) {
        const hay = (h.headline + ' ' + h.detail + ' ' + h.system + ' ' + h.type).toLowerCase();
        if (!hay.includes(query)) continue;
      }
      matches++;
      if (rows.length < shown) rows.push(h);
    }
    drawerList.textContent = '';
    if (!rows.length) {
      drawerList.appendChild(el('div', { class: 'ntf-empty' },
        history.length ? 'Nothing in the log matches that.' : 'Nothing has happened yet. Let the island run.'));
    }
    let lastDate = null;
    for (const h of rows) {
      if (h.at.date !== lastDate) {
        lastDate = h.at.date;
        drawerList.appendChild(el('div', { class: 'ntf-day' }, h.at.date));
      }
      const target = resolveAt(h, places, world);
      drawerList.appendChild(el('div', { class: 'ntf-row tier-' + h.tier },
        el('span', { class: 'ntf-row-time' }, h.at.time),
        el('span', { class: 'ntf-row-ico' }, icon(h.icon)),
        el('span', { class: 'ntf-row-text' },
          el('span', { class: 'ntf-row-head' }, h.headline + (h.count > 1 ? ' ×' + h.count : '')),
          h.detail ? el('span', { class: 'ntf-row-detail' }, h.detail) : null,
          el('span', { class: 'ntf-row-sys' }, h.system)),
        target && world.camera && typeof world.camera.flyTo === 'function'
          ? el('button', { class: 'ntf-row-go', type: 'button', 'aria-label': 'Take me there', onclick: () => flyTo(target) }, icon('pin'))
          : null));
    }
    if (matches > rows.length) {
      drawerList.appendChild(el('button', {
        class: 'ntf-more', type: 'button',
        onclick: () => { shown += PAGE; paintDrawer(); }
      }, 'Show older (' + (matches - rows.length) + ' more)'));
    }
    drawerCount.textContent = rows.length + ' of ' + matches
      + (matches === history.length ? '' : ' · ' + history.length + ' logged');
  }

  /* ---- the bus ---------------------------------------------------------- */

  world.bus.onAny((payload, type) => {
    const rows = byType.get(type);
    if (!rows) {
      unmapped.set(type, (unmapped.get(type) || 0) + 1);
      return;
    }
    for (const row of rows) {
      try {
        if (row.when && !row.when(payload, world)) continue;
      } catch (e) { continue; }
      raise(row, payload || {});
    }
  });

  // A system that throws is disabled by the kernel rather than allowed to spam. That is exactly
  // the sort of thing a player should be told about rather than left to find in a console.
  let lastErrorCount = world.errors.length;

  /* ---- update ----------------------------------------------------------- */

  function update(w) {
    if (w.errors.length > lastErrorCount) {
      const e = w.errors[w.errors.length - 1];
      lastErrorCount = w.errors.length;
      raise({
        type: 'world:error', tier: 'critical', icon: 'alert', system: 'Simulation',
        headline: () => `The ${e.system} system stopped`,
        detail: () => e.message + '. Everything it published has frozen where it was.'
      }, e);
    }

    // Expiry runs on wall time but only while the island is running, so a paused game does not
    // quietly throw away the notification you paused to read.
    if (!w.clock.paused) {
      const now = performance.now();
      for (let i = live.length - 1; i >= 0; i--) {
        const c = live[i];
        if (c.expires && now - c.expires.started > c.expires.holdMs) dismiss(c);
      }
    } else {
      for (const c of live) if (c.expires) c.expires.started = performance.now();
    }

    paintBadge();
    // The log rebuilds its whole list, which costs about five milliseconds at two hundred rows.
    // At 60x the island can dirty it ten times a second, so it repaints two or three times a
    // second instead. Nothing is lost: the rows are already in history when they are raised.
    if (drawerDirty && drawerOpen && (drawerTick = (drawerTick + 1) % 4) === 0) paintDrawer();
  }

  /* ---- debug handle ----------------------------------------------------- */

  const api = {
    /** Event types the world has raised that no row in EVENT_COPY covers. */
    unmapped: () => Object.fromEntries([...unmapped].sort((a, b) => b[1] - a[1])),
    /** Every type the table does cover. */
    mapped: () => [...byType.keys()].sort(),
    history: (n = 40) => history.slice(-n).map((h) => ({ t: h.at.date + ' ' + h.at.time, tier: h.tier, type: h.type, text: h.headline, count: h.count })),
    live: () => live.map((c) => ({ tier: c.tier, type: c.type, text: c.headline, count: c.count })),
    open: (v) => toggleDrawer(v),
    /** Repaint now. See the note on TWIN.hud.tick. */
    tick: () => update(world),
    /** Raise one by hand, for looking at the design without waiting for the island. */
    test: (type, payload = {}) => {
      const rows = byType.get(type);
      if (!rows) return 'no row for ' + type;
      for (const r of rows) raise(r, payload);
      return 'raised ' + type;
    },
    clear: () => { for (const c of live.slice()) dismiss(c); }
  };
  world.bus.on('app:ready', () => { if (window.TWIN) window.TWIN.notify = api; });
  if (typeof window !== 'undefined' && window.TWIN) window.TWIN.notify = api;

  return { update };
}

/* ------------------------------------------------------------------ places */

/**
 * Where a notification points. Built from data/places.json, which carries 58 real named places
 * with published coordinates, plus the township ids the agent systems use in their payloads.
 * A place that is not in the pack simply gets no "take me there", rather than a guessed one.
 */
function buildPlaceIndex(world) {
  const index = new Map();
  const put = (key, rec) => {
    const k = String(key || '').toLowerCase().trim();
    if (k && !index.has(k)) index.set(k, rec);
  };
  const list = (world.data && world.data.places && world.data.places.places) || [];
  for (const p of list) {
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const rec = { lon: p.lon, lat: p.lat, label: p.name || p.id, type: p.type };
    put(p.id, rec);
    put(p.name, rec);
    put(String(p.id || '').replace(/-/g, ' '), rec);
    for (const a of p.alt_names || []) put(a && a.name, rec);
  }
  // The ids the agent and economy systems actually put in their payloads.
  const alias = {
    'point-lookout': 'point-lookout', 'amity-point': 'amity-point', dunwich: 'dunwich',
    'one-mile': 'one-mile-jetty', 'main beach': 'main-beach', 'flinders beach': 'flinders-beach'
  };
  for (const [from, to] of Object.entries(alias)) {
    const rec = index.get(to);
    if (rec) put(from, rec);
  }
  return index;
}

function resolveAt(entry, places, world) {
  let spec = null;
  try { spec = entry.row && entry.row.at ? entry.row.at(entry.payload, world) : null; } catch (e) { spec = null; }
  if (!spec) return null;
  if (Number.isFinite(spec.x) && Number.isFinite(spec.z)) {
    return { label: spec.place || 'there', opts: { x: spec.x, z: spec.z, dist: 900, pitchBias: -0.16 } };
  }
  if (Number.isFinite(spec.lon) && Number.isFinite(spec.lat)) {
    return { label: spec.place || 'there', opts: { lon: spec.lon, lat: spec.lat, dist: 1400, pitchBias: -0.16 } };
  }
  if (spec.place) {
    const key = String(spec.place).toLowerCase().trim();
    let rec = places.get(key);
    if (!rec) {
      // "Point Lookout (Mulumba)" and "Amity Point jetty" both want to land somewhere real.
      for (const [k, v] of places) {
        if (k.length > 4 && key.includes(k)) { rec = v; break; }
      }
    }
    if (rec) {
      return {
        label: rec.label,
        opts: { lon: rec.lon, lat: rec.lat, dist: rec.type === 'township' ? 1500 : 800, pitchBias: -0.16 }
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ icons

   Line art on a sixteen unit grid, one stroke weight, drawn rather than borrowed. No emoji:
   an emoji is somebody else's typeface pretending to be an icon set, and at this size it reads
   as clip art next to a map of a real island. */

const ICONS = {
  ferry: 'M2.6 10.6h10.8l-1.4 3.1H4zM4.9 10.6V6.6h6.2v4M6.7 6.6V3.8h2.6v2.8',
  wave: 'M1.6 6.1c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0M1.6 10.5c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0',
  wind: 'M1.8 5.4h7a2 2 0 1 0-2-2M1.8 8.8h9.4a2 2 0 1 1-2 2M1.8 12.1h5.6',
  flame: 'M8 14.2c2.3 0 4.1-1.6 4.1-3.8 0-3.3-3.3-4.5-3.1-8.6C6.5 3.3 5.2 5.6 5.2 7.4c0 .9.3 1.5.8 2.1-.9.1-1.6-.4-1.9-1.2-.5.9-.7 1.8-.7 2.6 0 2 1.9 3.3 4.6 3.3z',
  bolt: 'M9.3 1.7 4.2 9h3.5l-.8 5.3L11.9 7H8.5z',
  droplet: 'M8 1.9c2.5 3 4.1 5.1 4.1 7.2A4.1 4.1 0 0 1 8 13.2a4.1 4.1 0 0 1-4.1-4.1c0-2.1 1.6-4.2 4.1-7.2z',
  bin: 'M3.4 4.6h9.2M4.9 4.6 5.5 14h5l.6-9.4M6.4 4.6V2.8h3.2v1.8M7 7v4.4M9 7v4.4',
  signal: 'M4.4 3.2a6 6 0 0 0 0 8.2M11.6 3.2a6 6 0 0 1 0 8.2M8 8.8V14M6.6 7.3a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0',
  leaf: 'M13.2 2.8c0 6-3.4 9.2-7.5 9.2-2 0-3.3-1.2-3.3-2.9 0-4 4.2-5.2 10.8-6.3zM4.4 13.6c1.4-3 3.4-5.2 6-6.8',
  paw: 'M4.4 5.2a1.5 1.6 0 1 0 3 0 1.5 1.6 0 1 0-3 0M8.6 4.2a1.5 1.6 0 1 0 3 0 1.5 1.6 0 1 0-3 0M2.2 9a1.4 1.5 0 1 0 2.8 0 1.4 1.5 0 1 0-2.8 0M11 8.6a1.4 1.5 0 1 0 2.8 0 1.4 1.5 0 1 0-2.8 0M8 14c1.9 0 3.4-1.1 3.4-2.5S9.9 9.2 8 9.2 4.6 10.1 4.6 11.5 6.1 14 8 14z',
  bird: 'M1.6 8.7c1.9-2.7 3.7-3.5 5.3-1.4L8 8.9l1.1-1.6c1.6-2.1 3.4-1.3 5.3 1.4',
  whale: 'M8 12.6C5.2 11 3.4 9 2.6 6.6c-.3-1 .4-1.8 1.3-1.3L8 7.6l4.1-2.3c.9-.5 1.6.3 1.3 1.3-.8 2.4-2.6 4.4-5.4 6z',
  turtle: 'M8 2.9c2.7 0 4.8 2.1 4.8 4.7S10.7 12.3 8 12.3 3.2 10.2 3.2 7.6 5.3 2.9 8 2.9zM8 2.9v9.4M3.3 6.8h9.4M2.3 11.4l1.7-1.1M13.7 11.4 12 10.3M8 12.3v1.8',
  house: 'M2.6 7.4 8 2.7l5.4 4.7M4.2 8.7v4.9h7.6V8.7',
  coin: 'M2.4 8a5.6 5.6 0 1 0 11.2 0 5.6 5.6 0 1 0-11.2 0M8 4.6v6.8M6 6.6h4M6 9.4h4',
  people: 'M4.2 5.5a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0M1.8 13.4c0-2.3 1.6-3.7 4.3-3.7s4.3 1.4 4.3 3.7M10.4 4.2c1.3.3 2.1 1.2 2.1 2.4 0 .8-.4 1.5-1 1.9M11.4 10c1.5.5 2.4 1.6 2.4 3.1',
  car: 'M2.5 10.7h11v-2l-1.6-.5-1.5-3H5.6L4.1 8.2l-1.6.5zM3.7 11.7a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0M9.7 11.7a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0',
  road: 'M5.4 2.2 3 13.8M10.6 2.2 13 13.8M8 3.4v2.2M8 7.4v2.2M8 11.4v2.2',
  box: 'M2.6 5.2 8 2.6l5.4 2.6v5.6L8 13.4l-5.4-2.6zM2.6 5.2 8 7.9l5.4-2.7M8 7.9v5.5',
  doc: 'M4 2.2h5l3 3v8.6H4zM9 2.2v3h3M6 8.6h4M6 11h4',
  book: 'M2.6 3.2h4a2 2 0 0 1 1.4.6 2 2 0 0 1 1.4-.6h4v9.2h-4a2 2 0 0 0-1.4.6 2 2 0 0 0-1.4-.6h-4zM8 3.8v9',
  alert: 'M8 2.4 14.2 13H1.8zM8 6.5v3.3M8 11.6v.1',
  bell: 'M8 1.9c-2.3 0-3.8 1.6-3.8 3.9 0 3.3-1.2 4.3-1.2 4.3h10s-1.2-1-1.2-4.3c0-2.3-1.5-3.9-3.8-3.9zM6.6 12.4a1.5 1.5 0 0 0 2.8 0',
  pin: 'M8 14.2s4.4-4.3 4.4-7.6A4.4 4.4 0 0 0 8 2.2a4.4 4.4 0 0 0-4.4 4.4c0 3.3 4.4 7.6 4.4 7.6zM6.4 6.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0'
};

const NS = 'http://www.w3.org/2000/svg';
function injectSprite() {
  if (document.getElementById('twin-ntf-sprite')) return;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('id', 'twin-ntf-sprite');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  for (const [name, d] of Object.entries(ICONS)) {
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'twin-i-' + name);
    sym.setAttribute('viewBox', '0 0 16 16');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    sym.appendChild(path);
    svg.appendChild(sym);
  }
  document.body.appendChild(svg);
}

function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ntf-i');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  const id = '#twin-i-' + (ICONS[name] ? name : 'alert');
  use.setAttribute('href', id);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', id);
  svg.appendChild(use);
  return svg;
}

/* ================================================================== style */

function injectStyle() {
  if (document.getElementById('twin-ntf-style')) return;
  const s = document.createElement('style');
  s.id = 'twin-ntf-style';
  s.textContent = `
/* The id wins over "#ui-root > * {pointer-events:auto}", so only the cards themselves take the
   mouse and the gaps between them stay part of the island. */
/* Sixteen from the left edge, and clear of the bottom left corner where the info view dock sits. */
/* Above the left edge tool rails, below the inspector and the modal boards. A notification is
   transient and has to be readable the moment it lands; the gaps between cards stay clickable. */
#twin-notifications{position:fixed;left:var(--sp-4);bottom:58px;z-index:21;
  width:min(346px, calc(50vw - 40px));display:flex;flex-direction:column;align-items:flex-start;gap:var(--sp-2);
  font:var(--fs-base)/1.45 var(--f-ui);color:var(--t);pointer-events:none}
.ntf-stack{pointer-events:none}
.ntf-drawer,.ntf-tab,.ntf-card{pointer-events:auto}
.ntf-i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.35;
  stroke-linecap:round;stroke-linejoin:round;display:block;flex:0 0 auto}

/* ---- the stack ---- */
/* 28vh, not 40. The stack grows upward out of the bottom left corner and at 40vh on a 720 px
   screen its ceiling reached the info view legend above it. Anything that does not fit is one
   click away in the drawer, which is what the drawer is for. */
.ntf-stack{display:flex;flex-direction:column;gap:var(--sp-2);width:100%;max-height:28vh;
  justify-content:flex-end}
.ntf-card{display:flex;gap:10px;padding:9px 10px 9px 11px;width:100%;
  background:var(--s-1);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge);border-left-width:3px;border-radius:var(--r-2);
  box-shadow:var(--shadow-2);position:relative}
.ntf-card.enter{animation:ntf-in .28s var(--ease-out) both}
/* Movement only, never opacity: a background tab freezes animations on their first keyframe, and
   a card that entered by fading in would sit there invisible until somebody looked at the tab. */
@keyframes ntf-in{from{transform:translateX(-14px)}to{transform:none}}
.ntf-card.tier-critical{border-left-color:var(--coral);border-color:rgba(226,114,91,.36);
  background:linear-gradient(90deg,rgba(226,114,91,.15),var(--s-1) 62%);
  box-shadow:var(--shadow-2),0 0 0 1px rgba(226,114,91,.12)}
.ntf-card.tier-warning{border-left-color:var(--sun)}
.ntf-card.tier-notice{border-left-color:var(--sea)}
.ntf-card.tier-chatter{border-left-color:var(--iron)}
/* Only the top tier interrupts: everything below it steps back while a critical card is up. */
#twin-notifications.has-critical .ntf-card:not(.tier-critical){opacity:.62;filter:saturate(.75)}
.ntf-ico{flex:0 0 auto;width:26px;height:26px;display:grid;place-items:center;border-radius:var(--r-1);
  background:var(--s-sunk);color:var(--sea);margin-top:1px}
.tier-critical .ntf-ico{color:var(--coral);animation:ntf-pulse 2.4s var(--ease) infinite}
@keyframes ntf-pulse{0%{box-shadow:0 0 0 0 rgba(226,114,91,.5)}70%{box-shadow:0 0 0 10px rgba(226,114,91,0)}
  100%{box-shadow:0 0 0 0 rgba(226,114,91,0)}}
.tier-warning .ntf-ico{color:var(--sun)}
.tier-chatter .ntf-ico{color:var(--iron)}
.ntf-body{flex:1 1 auto;min-width:0}
.ntf-top{display:flex;align-items:flex-start;gap:6px}
.ntf-headline{flex:1 1 auto;color:var(--t-hi);font-size:var(--fs-base);font-weight:500;line-height:1.35}
.ntf-count-pill{flex:0 0 auto;font:700 10px/1 var(--f-num);letter-spacing:.02em;color:var(--t-on-accent);
  background:var(--sand);border-radius:var(--r-pill);padding:3px 6px;margin-top:2px}
.ntf-detail{color:var(--t-dim);font-size:var(--fs-sm);line-height:1.45;margin-top:2px}
.ntf-foot{display:flex;align-items:center;gap:8px;margin-top:7px;flex-wrap:wrap}
.ntf-meta{font:600 9.5px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--t-faint);
  flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ntf-actions{display:flex;gap:5px;flex:0 0 auto}
.ntf-act{appearance:none;border:1px solid var(--edge-strong);background:transparent;color:var(--t-dim);
  font:600 10.5px/1 var(--f-ui);letter-spacing:.03em;padding:5px 8px;border-radius:var(--r-1);cursor:pointer;
  transition:background var(--fast) var(--ease),color var(--fast),border-color var(--fast)}
.ntf-act:hover{background:rgba(63,182,196,.16);border-color:rgba(63,182,196,.6);color:var(--t-hi)}
.ntf-act.primary{color:var(--sea);border-color:rgba(63,182,196,.45)}
.ntf-act.primary:hover{background:var(--sea);color:var(--t-on-accent);border-color:var(--sea)}
.ntf-act[disabled]{opacity:.45;cursor:default;background:none;border-color:var(--edge)}
.ntf-x{position:absolute;top:4px;right:4px;width:20px;height:20px;appearance:none;border:none;
  background:none;color:var(--t-faint);font-size:15px;line-height:1;cursor:pointer;border-radius:var(--r-1);
  opacity:0;transition:opacity var(--fast),color var(--fast)}
.ntf-card:hover .ntf-x{opacity:1}
.ntf-x:hover{color:var(--t-hi);background:rgba(255,255,255,.08)}

/* ---- the tab ---- */
.ntf-tab{display:inline-flex;align-items:center;gap:7px;appearance:none;cursor:pointer;
  background:var(--s-1);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border:1px solid var(--edge);border-radius:var(--r-pill);padding:6px 12px 6px 10px;color:var(--t-dim);
  font:600 10.5px/1 var(--f-ui);letter-spacing:.13em;text-transform:uppercase;box-shadow:var(--shadow-1);
  transition:color var(--fast),border-color var(--fast),background var(--fast)}
.ntf-tab:hover{color:var(--t-hi);border-color:var(--edge-strong);background:var(--s-2)}
.ntf-tab.hot{color:var(--sun);border-color:rgba(240,180,41,.45)}
.ntf-wrap.open .ntf-tab{background:var(--sea);border-color:var(--sea);color:var(--t-on-accent)}
.ntf-badge{font:700 10px/1 var(--f-num);background:var(--s-sunk);border-radius:var(--r-pill);
  padding:3px 6px;color:var(--t-faint);min-width:19px;text-align:center}
.ntf-badge.on{background:var(--sea);color:var(--t-on-accent)}
.ntf-tab.hot .ntf-badge.on{background:var(--sun)}

/* ---- the log drawer ---- */
/* Open, the log takes the whole column and the transient stack stands down: you are reading the
   record, and a card sliding in over the top of it would be the wrong thing twice. */
.ntf-drawer{display:none;width:100%;max-height:calc(100vh - 190px);flex-direction:column;overflow:hidden}
.ntf-wrap.open .ntf-drawer{display:flex}
.ntf-wrap.open .ntf-stack{display:none}
.ntf-count{font:400 10px/1 var(--f-num);color:var(--t-faint);white-space:nowrap}
.ntf-tools{padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--edge);display:flex;
  flex-direction:column;gap:var(--sp-2)}
.ntf-search{appearance:none;width:100%;background:var(--s-sunk);border:1px solid var(--edge);
  border-radius:var(--r-2);color:var(--t-hi);font:var(--fs-sm)/1 var(--f-ui);padding:7px 9px}
.ntf-search::placeholder{color:var(--t-faint)}
.ntf-search:focus{outline:none;border-color:var(--edge-focus);box-shadow:var(--glow-sea)}
.ntf-filters{display:flex;gap:4px;flex-wrap:wrap}
.ntf-filter{appearance:none;background:none;border:1px solid var(--edge);border-radius:var(--r-pill);
  color:var(--t-faint);font:600 9.5px/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;
  padding:4px 8px;cursor:pointer;transition:color var(--fast),border-color var(--fast)}
.ntf-filter:hover{color:var(--t)}
.ntf-filter.on{color:var(--sea);border-color:rgba(63,182,196,.55);background:rgba(63,182,196,.12)}
.ntf-list{flex:1 1 auto;overflow-y:auto;padding:var(--sp-2) var(--sp-2) var(--sp-3)}
.ntf-day{font:600 9.5px/1 var(--f-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--t-faint);
  padding:10px var(--sp-2) 5px;position:sticky;top:0;background:linear-gradient(180deg,var(--s-1),rgba(16,21,25,.86));
  backdrop-filter:blur(6px)}
.ntf-row{display:flex;align-items:flex-start;gap:8px;padding:5px var(--sp-2);border-radius:var(--r-1);
  transition:background var(--fast)}
.ntf-row:hover{background:rgba(255,255,255,.05)}
.ntf-row-time{font:400 10px/1.5 var(--f-num);color:var(--t-faint);flex:0 0 46px;text-align:right}
.ntf-row-ico{flex:0 0 auto;color:var(--iron);margin-top:1px}
.ntf-row.tier-critical .ntf-row-ico{color:var(--coral)}
.ntf-row.tier-warning .ntf-row-ico{color:var(--sun)}
.ntf-row.tier-notice .ntf-row-ico{color:var(--sea)}
.ntf-row-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.ntf-row-head{color:var(--t-hi);font-size:var(--fs-sm);line-height:1.4}
.ntf-row-detail{color:var(--t-faint);font-size:11px;line-height:1.4}
.ntf-row-sys{color:var(--t-faint);font:600 9px/1.4 var(--f-ui);letter-spacing:.12em;text-transform:uppercase}
.ntf-row-go{appearance:none;background:none;border:none;color:var(--t-faint);cursor:pointer;padding:2px;
  opacity:0;transition:opacity var(--fast),color var(--fast)}
.ntf-row:hover .ntf-row-go{opacity:1}
.ntf-row-go:hover{color:var(--sea)}
.ntf-empty{padding:var(--sp-5) var(--sp-3);text-align:center;color:var(--t-faint);font-size:var(--fs-sm)}
.ntf-more{display:block;width:calc(100% - var(--sp-4));margin:var(--sp-2) auto 0;appearance:none;cursor:pointer;
  background:var(--s-sunk);border:1px solid var(--edge);border-radius:var(--r-2);color:var(--t-dim);
  font:600 10px/1 var(--f-ui);letter-spacing:.11em;text-transform:uppercase;padding:8px}
.ntf-more:hover{color:var(--t-hi);border-color:var(--edge-strong)}

@media (max-width:860px){
  .ntf-wrap{width:calc(100vw - var(--sp-4));left:var(--sp-2);bottom:78px}
  .ntf-stack{max-height:36vh}
}
`;
  document.head.appendChild(s);
}
