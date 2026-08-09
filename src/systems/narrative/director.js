// The drama director. It watches the island and mostly decides to do nothing.
//
// WHAT THIS IS
//   data/narrative.json holds 36 story seeds, a beat grammar, a cast model, a relationship model,
//   a tone guide and a set of director rules. It is a grammar, not a script. This file is the part
//   that reads the world, works out which seeds the island has genuinely produced the conditions
//   for, and opens at most a couple a week. storylines.js runs the beats. chronicle.js writes them
//   down. The three of them are one slice and they talk through world.state and world.bus like
//   everything else, because systems never import each other.
//
// THE ONE RULE THAT MATTERS
//   The director never creates physical state. It cannot cancel a sailing, raise a swell, kill a
//   koala or empty a keg. It waits for a system to do that and then notices. Its phase is
//   `narrative`, which runs after environment, ecology, infrastructure, economy, agents, movement
//   and civic, so everything it reads is settled for the tick. If the trigger state is not there,
//   the seed does not run, and the seed is listed in describe() as waiting rather than quietly
//   dropped.
//
// THE HONEST BIT, READ THIS BEFORE YOU TOUCH PATH_BINDINGS
//   The pack's triggers are written against a state contract of 104 paths, and the pack says
//   plainly that 80 of them belong to systems that did not exist when it was written. Some of
//   those systems now exist and publish the same quantity under a different name, because they
//   were written by different hands at the same time: the pack asks for `housing.rentalListings`
//   and housing.js publishes `housing.rentals.available`, which is the same number.
//
//   So there is a binding table below. Every entry says which real system supplies the number and
//   how confident the binding is:
//
//     same-quantity  the running system publishes exactly this number under another name.
//     derived        a statistic computed from published numbers, with no invented constant in it:
//                    a share, a rolling mean, a difference between two published readings.
//     proxy          a related but not identical quantity. Used only where the note says why, and
//                    every one of them is listed in describe() so a critic can argue with it.
//
//   A native path always wins: the moment ferry.js publishes `ferry.barge.cancelledToday` the
//   binding below is never consulted again. A path with no binding resolves to undefined, its seed
//   is skipped, and it appears in describe().waitingOn so whoever builds that system can see who
//   is waiting on them. Nothing here invents a number to make a story possible.
//
// CULTURAL RULE, ABSOLUTE
//   Minjerribah is Quandamooka Country. Nobody in this simulation speaks: see the pack's
//   tone_guide.no_speech, which applies to every character for the reason it gives. Quandamooka
//   households are cast in exactly the same working and civic roles as any other household,
//   because roughly a quarter of the resident population is Aboriginal or Torres Strait Islander
//   and leaving them out of the ordinary life of the island would be its own falsification. What
//   this file never does is know which households those are in any way that reaches a player:
//   population.js keeps `archetypeId` on the live graph only, this file reads it to match a role,
//   and it never goes into published state, a chronicle line or a UI label. There is no elder
//   role, no knowledge holder role and no cultural guide role in the pack, and culturalGate()
//   below refuses any seed that grows one. See data/lore.json prohibitions and
//   docs/CULTURAL-REVIEW.md.
//
// DETERMINISM
//   Every draw comes from world.rng.stream('narrative') or world.rng.stream('narrative-cast').
//   Every date comes from world.clock. No Math.random, no Date.now, no iteration over a Map whose
//   insertion order depends on anything unstable.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TICKS_PER_DAY = 144;

/** The director wakes every six sim-hours, which the pack sets and which is 36 ticks. */
const EVAL_TICKS = 36;

/** How many past readings of a watched path to keep, in evaluations. 4 a day, so 120 is a month. */
const SERIES_LEN = 120;

/** Roles that would carry cultural authority. The pack contains none. If one ever appears in a
 *  future pack, the seed carrying it does not run and it is reported. */
const FORBIDDEN_ROLE_TOKENS = ['elder-', 'the-elder', 'knowledge', 'cultural', 'ceremon', 'lore-'];

/** Nothing with any of these in its written text runs, whatever else it says. Mirrors
 *  data/lore.json prohibitions no-invented-ceremony and no-sacred-or-restricted-sites. */
const FORBIDDEN_TEXT_TOKENS = [
  'ceremony', 'ceremonial', 'corroboree', 'initiation', 'songline', 'totem',
  'sacred', 'midden', 'burial', 'welcome to country'
];

/* ------------------------------------------------------------------ path binding

Each entry maps a contract path onto the real published state. `get` returns undefined when the
supplying system is not loaded yet, which is the same as the path not existing, which is the same
as the seed not running. `kind` is the honesty label described in the header. `why` is what a critic
reads when they want to argue.

Patterns use <name> for a placeholder the trigger binds. */

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

const PATH_BINDINGS = {
  /* --- the clock. Not a published system, so every clock path needs a binding. --- */
  'clock.dayOfWeek': { kind: 'same-quantity', why: 'src/kernel/clock.js', get: (w) => w.clock.dayOfWeek },
  'clock.month': { kind: 'same-quantity', why: 'src/kernel/clock.js, 0 based', get: (w) => w.clock.month },
  'clock.isQldSchoolHoliday': { kind: 'same-quantity', why: 'src/kernel/clock.js', get: (w) => w.clock.isQldSchoolHoliday },
  'clock.season.id': { kind: 'same-quantity', why: 'src/kernel/clock.js island seasons', get: (w) => w.clock.season.id },

  /* --- tide. tide.js publishes station heights as bare numbers, not objects. --- */
  'tide.stations.<station>.height': {
    kind: 'same-quantity', why: 'tide.js publishes stations.<id> as the height in metres above LAT',
    get: (w, b) => num((w.state.tide && w.state.tide.stations || {})[b.station])
  },
  'tide.stations.<station>.rate': {
    kind: 'proxy',
    why: 'tide.js publishes one rate, at Dunwich. Every station on this island floods and ebbs '
      + 'together with a published lag of under an hour, so the sign is right everywhere and the '
      + 'magnitude is the Dunwich one.',
    get: (w) => num(w.state.tide && w.state.tide.rate)
  },

  /* --- daylight --- */
  'daylight.sunsetMin': { kind: 'same-quantity', why: 'daylight.js', get: (w) => num(w.state.daylight && w.state.daylight.sunsetMin) },

  /* --- the coast at Amity. coast.js is not built; dunes.js models the same reach. --- */
  'coast.amity.flowSlideEvent': {
    kind: 'same-quantity',
    why: 'dunes.js publishes amity.lastEvent and emits coast:flow-slide. A flow slide inside the '
      + 'last three days reads as the event being live.',
    get: (w, b, ctx) => {
      const d = w.state.dunes && w.state.dunes.amity;
      if (!d) return undefined;
      if (!d.lastEvent) return false;
      return ctx.daysSince('amity-flow-slide', d.lastEvent.day) <= 3;
    }
  },
  'coast.amity.reachRetreatM': {
    kind: 'same-quantity', why: 'dunes.js amity.lastEvent.retreatM, metres of foreshore lost in the event',
    get: (w) => {
      const d = w.state.dunes && w.state.dunes.amity;
      return d && d.lastEvent ? num(d.lastEvent.retreatM) : undefined;
    }
  },
  'coast.amity.propertiesAtRisk': {
    kind: 'proxy',
    why: 'dunes.js publishes propertiesInStrip: the modelled number of lots inside the declared '
      + 'erosion-prone frontage. Nobody publishes a lot by lot list, so this is the count of '
      + 'properties in the strip rather than a count for this event.',
    get: (w) => {
      const d = w.state.dunes && w.state.dunes.amity;
      return d ? num(d.propertiesInStrip) : undefined;
    }
  },

  /* --- beaches. dunes.js publishes a reach per beach with real numbers on it. --- */
  'dunes.<beachId>.volumeChangeM3PerM': {
    kind: 'same-quantity', why: 'dunes.js reach cutThisYearM3PerM, signed so a cut is negative',
    get: (w, b, ctx) => {
      const r = ctx.reach(b.beachId);
      return r ? -num(r.cutThisYearM3PerM) : undefined;
    }
  },

  /* --- fire. fire.js is not built; vegetation.js runs the burn programme. --- */
  'fire.plannedBurnActive': {
    kind: 'same-quantity', why: 'vegetation.js burnProgramme: burnable season with area burnt going up',
    get: (w, b, ctx) => {
      const v = w.state.vegetation && w.state.vegetation.burnProgramme;
      if (!v) return undefined;
      return !!v.season && ctx.rising('vegetation.burnProgramme.burntThisSeasonHa', num(v.burntThisSeasonHa) || 0, 2);
    }
  },
  'fire.smokePlume.<townshipId>': {
    kind: 'proxy',
    why: 'vegetation.js publishes one smokeOverTownship index for the townships as a group. It '
      + 'does not resolve which township is under it.',
    get: (w) => num(w.state.vegetation && w.state.vegetation.smokeOverTownship)
  },

  /* --- water table. groundwater.js is not built; lakes.js runs the aquifer. --- */
  'groundwater.tableM': { kind: 'same-quantity', why: 'lakes.js waterTableM', get: (w) => num(w.state.lakes && w.state.lakes.waterTableM) },
  'lakes.<lakeId>.levelM': {
    kind: 'same-quantity', why: 'lakes.js bodies[].levelM',
    get: (w, b) => {
      const L = (w.state.lakes && w.state.lakes.bodies || []).find((x) => x.id === b.lakeId || x.id === 'water-' + b.lakeId);
      return L ? num(L.levelM) : undefined;
    }
  },

  /* --- koala --- */
  'koala.roadDeaths.lastEvent': {
    kind: 'same-quantity', why: 'koala.js events[] carries the road strikes with the road on them',
    get: (w) => {
      const k = w.state.koala;
      if (!k || !Array.isArray(k.events)) return undefined;
      const e = k.events.find((x) => /road/.test(x.what || ''));
      return e ? { roadId: e.where, day: e.day, outcome: e.what } : null;
    }
  },
  'koala.roadDeaths.rolling90': {
    kind: 'derived', why: 'koala.js recorded365.vehicle differenced against its reading a quarter ago',
    get: (w, b, ctx) => {
      const k = w.state.koala;
      if (!k || !k.recorded365) return undefined;
      return ctx.deltaOver('koala.recorded365.vehicle', num(k.recorded365.vehicle) || 0, 90);
    }
  },
  'koala.dispersalIndex': {
    kind: 'derived',
    why: 'koala.js publishes how many animals are dispersing and how many adults there are. The '
      + 'index is the share of adults on the move, which is what the seed is asking about.',
    get: (w) => {
      const k = w.state.koala;
      if (!k || !k.adults) return undefined;
      return clamp((num(k.dispersing) || 0) / Math.max(1, k.adults) * 4, 0, 1);
    }
  },

  /* --- whales --- */
  'whales.passingPerDay': { kind: 'same-quantity', why: 'whales.js podsOnStage', get: (w) => num(w.state.whales && w.state.whales.podsOnStage) },
  'whales.rolling7DayMean': {
    kind: 'derived', why: 'the seven day mean of whales.js podsOnStage, held by this file',
    norm: { scaler: 'whales.seasonIndex' },
    get: (w, b, ctx) => ctx.rollingMean('whales.podsOnStage', num(w.state.whales && w.state.whales.podsOnStage), 7)
  },
  'whales.calvesInshore': {
    kind: 'same-quantity',
    why: 'whales.js publishes each pod with a calf flag and its distance offshore. Inshore is the '
      + 'published sighting range from the headland, which the same file calls about 3 km.',
    get: (w) => {
      const p = w.state.whales && w.state.whales.pods;
      if (!Array.isArray(p)) return undefined;
      let n = 0;
      for (const pod of p) if (pod.calf && pod.offshoreKm <= 3) n++;
      return n;
    }
  },

  /* --- shorebirds --- */
  'shorebirds.roost.<placeId>.count': {
    kind: 'same-quantity', why: 'shorebirds.js roosts[].birds',
    get: (w, b, ctx) => { const r = ctx.roost(b.placeId); return r ? num(r.birds) : undefined; }
  },
  'shorebirds.roost.<placeId>.flushEvents': {
    kind: 'derived',
    why: 'shorebirds.js publishes flushes365 per roost. The seed means recent flushes, so this is '
      + 'the running total differenced against its reading a week ago.',
    get: (w, b, ctx) => {
      const r = ctx.roost(b.placeId);
      if (!r) return undefined;
      return ctx.deltaOver('shorebirds.flush.' + b.placeId, num(r.flushes365) || 0, 7);
    }
  },

  /* --- marine --- */
  'marine.turtleNests.<beachId>': {
    kind: 'proxy',
    why: 'marine.js publishes loggerhead nests for the island, not per beach. The ocean beaches '
      + 'are where they nest, so this is the island count read against the named beach.',
    get: (w) => {
      const t = w.state.marine && w.state.marine.turtles;
      return t && t.loggerhead ? num(t.loggerhead.nestsActive) : undefined;
    }
  },
  'marine.tailorRunIndex': {
    kind: 'same-quantity', why: 'marine.js runs[] sp-tailor strength',
    get: (w) => {
      const r = (w.state.marine && w.state.marine.runs || []).find((x) => x.id === 'sp-tailor');
      return r ? num(r.strength) : undefined;
    }
  },
  'marine.foxBaitingActive': {
    kind: 'same-quantity', why: 'marine.js turtles.loggerhead.foxControlLevel above zero',
    get: (w) => {
      const t = w.state.marine && w.state.marine.turtles;
      if (!t || !t.loggerhead) return undefined;
      return (num(t.loggerhead.foxControlLevel) || 0) > 0;
    }
  },

  /* --- the crossing. ferry.js is not built; prices.js models the sailings and the freight. --- */
  'ferry.barge.cancelledToday': {
    kind: 'same-quantity', why: 'prices.js crossings.lostToday, sailings scheduled that did not run',
    get: (w) => num(w.state.prices && w.state.prices.crossings && w.state.prices.crossings.lostToday)
  },
  'ferry.allServicesSuspended': {
    kind: 'same-quantity', why: 'prices.js crossings: everything scheduled today was lost',
    get: (w) => {
      const c = w.state.prices && w.state.prices.crossings;
      if (!c) return undefined;
      return (c.scheduledToday || 0) > 0 && (c.ranToday || 0) === 0;
    }
  },
  'ferry.waterTaxi.cancelledToday': {
    kind: 'proxy',
    why: 'prices.js does not separate the walk-on boat from the vehicle barge. The crossing is '
      + 'entirely inside the bay, so this reads zero unless every sailing was lost.',
    get: (w) => {
      const c = w.state.prices && w.state.prices.crossings;
      if (!c) return undefined;
      return (c.scheduledToday || 0) > 0 && (c.ranToday || 0) === 0 ? 1 : 0;
    }
  },
  'ferry.waterTaxi.onRoute': {
    kind: 'same-quantity', why: 'schedule.js boatsRunning, from the published timetable and the weather',
    get: (w) => (w.state.schedule ? !!w.state.schedule.boatsRunning : undefined)
  },
  'ferry.barge.nextAvailableBookingDays': {
    kind: 'proxy',
    why: 'prices.js publishes freight.backlogDays: how far behind the boats are on getting things '
      + 'across. No system models a vehicle booking sheet yet, and the backlog is the closest '
      + 'published answer to how long a tradie waits.',
    get: (w) => num(w.state.prices && w.state.prices.freight && w.state.prices.freight.backlogDays)
  },

  /* --- crowds. crowd.js is not built. Three honest sources, in order of how good they are. --- */
  'crowd.<placeId>.people': {
    kind: 'same-quantity',
    why: 'dunes.js counts people on each beach reach today and lakes.js counts visitors at each '
      + 'lake. Anywhere else, this counts residents standing at that place right now, from the '
      + 'agent simulation.',
    get: (w, b, ctx) => ctx.crowdAt(b.placeId)
  },

  /* --- businesses --- */
  'businesses.<businessId>.stockout': {
    kind: 'same-quantity', why: 'businesses.js stockouts.live, filtered to the one business',
    get: (w, b) => {
      const s = w.state.businesses && w.state.businesses.stockouts;
      if (!s || !Array.isArray(s.live)) return undefined;
      return s.live.filter((x) => x.id === b.businessId).map((x) => x.line);
    }
  },
  'businesses.<businessId>.viability': {
    kind: 'proxy',
    why: 'businesses.js publishes a viability phrase per business on its board rather than a '
      + 'number. This maps the four phrases onto a scale so a threshold can be tested.',
    get: (w, b) => {
      const row = (w.state.businesses && w.state.businesses.board || []).find((x) => x.id === b.businessId);
      if (!row) return undefined;
      const v = String(row.viability || '');
      if (/well/.test(v)) return 0.85;
      if (/steady|sound/.test(v)) return 0.6;
      if (/thin|tight/.test(v)) return 0.35;
      return 0.15;
    }
  },

  /* --- housing --- */
  'housing.rentalListings': {
    kind: 'same-quantity', why: 'housing.js rentals.available',
    get: (w) => num(w.state.housing && w.state.housing.rentals && w.state.housing.rentals.available)
  },
  'housing.shortStayShare.<townshipId>': {
    kind: 'derived', why: 'housing.js stock.byTownship: short stay lets over that township total dwellings',
    get: (w, b) => {
      const t = w.state.housing && w.state.housing.stock && w.state.housing.stock.byTownship;
      const row = t && t[b.townshipId];
      if (!row || !row.total) return undefined;
      return row.shortStay / row.total;
    }
  },
  'housing.workerBeds': {
    kind: 'same-quantity', why: 'housing.js workers.beds',
    get: (w) => num(w.state.housing && w.state.housing.workers && w.state.housing.workers.beds)
  },
  'housing.saleEvents': {
    kind: 'same-quantity',
    why: 'housing.js emits housing:lost-to-holiday-let and housing:converted. This file collects '
      + 'them off the bus and hands back the last thirty days of them in the shape the pack asks for.',
    get: (w, b, ctx) => ctx.saleEvents()
  },

  /* --- jobs --- */
  'jobs.vacancies.<occupationId>': {
    kind: 'derived', why: 'jobs.js vacancies[], summed for the businesses whose sector employs that occupation',
    get: (w, b, ctx) => ctx.vacanciesFor(b.occupationId)
  },
  'jobs.unfilledDays.<occupationId>': {
    kind: 'derived', why: 'jobs.js vacancies[].daysOpen, the longest open vacancy touching that occupation',
    get: (w, b, ctx) => ctx.unfilledDaysFor(b.occupationId)
  },

  /* --- prices --- */
  'prices.crossingCostIndex': {
    kind: 'proxy',
    why: 'No system publishes a passenger fare index. policy.js carries ferry_cost_burden, which '
      + 'is the same question asked from the household end: what the crossing costs the people who '
      + 'have to make it.',
    get: (w) => {
      const m = w.state.policy && w.state.policy.metrics && w.state.policy.metrics.ferry_cost_burden;
      return m ? num(m.value) : undefined;
    }
  },

  /* --- the C-hour ledger --- */
  'chour.attendedHoursThisMonth': {
    kind: 'derived', why: 'chour.js care.hoursThisWeek, over a month of 30.4 days',
    get: (w) => {
      const c = w.state.chour && w.state.chour.care;
      return c ? (num(c.hoursThisWeek) || 0) * (30.4 / 7) : undefined;
    }
  },
  'chour.loggedHoursThisMonth': {
    kind: 'same-quantity',
    why: 'chour.js care.hoursTheLedgerKnows. In money mode this is zero because nobody was asked, '
      + 'which is the ledger design and not a gap in it.',
    get: (w) => {
      const c = w.state.chour && w.state.chour.care;
      return c ? num(c.hoursTheLedgerKnows) : undefined;
    }
  },

  /* --- population --- */
  'population.leavers.rolling365': { kind: 'same-quantity', why: 'population.js', get: (w) => num(w.state.population && w.state.population.leavers && w.state.population.leavers.rolling365) },
  'population.returners.rolling365': { kind: 'same-quantity', why: 'population.js', get: (w) => num(w.state.population && w.state.population.returners && w.state.population.returners.rolling365) },

  /* --- infrastructure --- */
  'power.outage.active': { kind: 'same-quantity', why: 'power.js outage.on', get: (w) => (w.state.power && w.state.power.outage ? !!w.state.power.outage.on : undefined) },
  'waste.transferStationFullness': {
    kind: 'same-quantity', why: 'waste.js yard.pctFullByVolume, already a 0 to 1 share',
    get: (w) => num(w.state.waste && w.state.waste.yard && w.state.waste.yard.pctFullByVolume)
  },
  'water.mainBreak.active': {
    kind: 'same-quantity', why: 'water.js pressure.outages, which is what a main break shows up as',
    get: (w) => {
      const p = w.state.water && w.state.water.pressure;
      return p ? (p.outages || []).length > 0 : undefined;
    }
  },
  'water.pressureIndex.<townshipId>': {
    kind: 'same-quantity', why: 'water.js pressure.byTownship[id].fillPct as a 0 to 1 index',
    get: (w, b) => {
      const t = w.state.water && w.state.water.pressure && w.state.water.pressure.byTownship;
      const row = t && t[b.townshipId];
      return row ? clamp((num(row.fillPct) || 0) / 100, 0, 1) : undefined;
    }
  },
  'telecoms.outage.active': {
    kind: 'same-quantity', why: 'telecoms.js: the backhaul under the bay is down or a site is off air',
    get: (w) => {
      const t = w.state.telecoms;
      if (!t) return undefined;
      return (t.nbn && t.nbn.backhaulUp === false) || (t.sitesDown || 0) > 0;
    }
  },

  /* --- civic. council.js runs the applications; policy.js runs the metrics. --- */
  'council.metrics.<metricId>': {
    kind: 'same-quantity', why: 'policy.js metrics[id].value, ids from data/civic.json',
    get: (w, b) => {
      const m = w.state.policy && w.state.policy.metrics && w.state.policy.metrics[b.metricId];
      return m ? num(m.value) : undefined;
    }
  },
  'consultation.open.<leverId>': {
    kind: 'same-quantity', why: 'consultation.js open[], matched on leverId',
    get: (w, b) => {
      const c = w.state.consultation;
      if (!c || !Array.isArray(c.open)) return undefined;
      return c.open.some((x) => x.leverId === b.leverId);
    }
  },
  'sentiment.groups.<groupId>.mood': {
    kind: 'derived',
    why: 'sentiment.js publishes mood on minus one to one. Every threshold in the pack is written '
      + 'on zero to one, and so is every other civic number in it, so this rescales.',
    get: (w, b) => {
      const m = w.state.sentiment && w.state.sentiment.moods;
      const v = m && num(m[b.groupId]);
      return v === undefined ? undefined : (v + 1) / 2;
    }
  },
  'policy.levers.<leverId>.status': {
    kind: 'same-quantity', why: 'policy.js levers[id].status',
    get: (w, b) => {
      const L = w.state.policy && w.state.policy.levers && w.state.policy.levers[b.leverId];
      return L ? L.status : undefined;
    }
  },

  /* --- events. No system reads data/events.json yet. This is assembled from what the island is
         actually doing, never from the pack, so an event only appears here when it is happening. --- */
  'events.active': {
    kind: 'derived',
    why: 'schedule.js says whether it is market day and needs.js says how many people are at a '
      + 'working bee right now. Nothing here is read out of data/events.json: an event is on this '
      + 'list only when residents are actually doing it.',
    get: (w, b, ctx) => ctx.activeEvents()
  },
  'events.periodActive.<periodId>': {
    kind: 'same-quantity', why: 'schedule.js day flags for the periods it already tracks',
    get: (w, b) => {
      const d = w.state.schedule && w.state.schedule.day;
      if (!d) return undefined;
      if (b.periodId === 'surf-patrol-season') return !!d.isPatrolDay;
      if (b.periodId === 'school-term') return !!d.isTermTime;
      if (b.periodId === 'whale-season') return !!d.isWhaleSeason;
      if (b.periodId === 'builder-shutdown') return !!d.isBuilderShutdown;
      return undefined;
    }
  }
};

/** Bindings keyed by their pattern, split once so resolution is a walk and not a regex per call. */
const BINDING_PATTERNS = Object.keys(PATH_BINDINGS).map((p) => ({
  pattern: p, parts: p.split('.'), entry: PATH_BINDINGS[p]
}));

/* ------------------------------------------------------------------ operators */

function compare(op, v, want, ctx, key, prev) {
  switch (op) {
    case '==': return v === want || (typeof want === 'boolean' && !!v === want);
    case '!=': return v !== want;
    case '>': return typeof v === 'number' && v > want;
    case '>=': return typeof v === 'number' && v >= want;
    case '<': return typeof v === 'number' && v < want;
    case '<=': return typeof v === 'number' && v <= want;
    case 'in': return Array.isArray(want) && want.includes(v);
    case 'between': return Array.isArray(want) && typeof v === 'number' && v >= want[0] && v <= want[1];
    case 'within': return typeof v === 'number' && Math.abs(v - ctx.nowMinute) <= want;
    case 'exists': return v !== undefined && v !== null;
    case 'changed': return ctx.changed(key, v);
    case 'rising': return ctx.rising(key, v, 3);
    case 'falling': return ctx.falling(key, v, 3);
    case 'increased': return ctx.increasedBy(key, v, want);
    case 'fallenBy': return ctx.fallenBy(key, v, want);
    case 'crossedThreshold': return ctx.crossedThreshold(key, v, want);
    case 'belowSeasonalNormBy': return ctx.belowSeasonalNorm(key, v, want);
    case 'ratioBelow': return typeof v === 'number' && typeof prev === 'number' && prev > 0 && (v / prev) < want;
    case 'contains': return Array.isArray(v) && v.includes(want);
    case 'containsAny': return Array.isArray(v) && Array.isArray(want) && want.some((x) => v.includes(x));
    case 'containsMatching': return Array.isArray(v) && v.some((o) => o && typeof o === 'object'
      && Object.keys(want).every((k) => o[k] === want[k]));
    case 'containsSeed': return Array.isArray(v) && v.some((o) => (o && o.seedId) === want);
    case 'lengthAtLeast': return (Array.isArray(v) ? v.length : 0) >= want;
    default: return false;
  }
}

/* ------------------------------------------------------------------ the system */

export function registerDirector(world) {
  const rng = world.rng.stream('narrative');
  const castRng = world.rng.stream('narrative-cast');

  const state = world.publish('narrative', {
    ready: false,
    pack: null,
    source: 'data/narrative.json',
    basis: 'Every seed is a situation type built from public conditions. No seed is a record of '
      + 'anything that happened to a real person on this island, and the pack says so in its own '
      + 'honesty block. The people are generated.',

    /** The pack's own contract paths. Other systems and the UI read these. */
    activeThreads: [],
    closedThreads: [],
    recentSeed: {},         // seedId -> {days}
    recentRegister: {},     // registerId -> {days}
    activeRegister: {},     // registerId -> count

    /** What the director is doing and why, in a form a panel can print. */
    watching: [],           // seeds whose state is close but not there
    waitingOn: [],          // contract paths nothing publishes yet, with who is waiting on them
    withheld: [],           // seeds this file refuses to run, with the reason
    proxies: [],            // every binding that is not the same quantity, for a critic to argue with
    lastEvaluation: null,
    stats: { evaluations: 0, opened: 0, closed: 0, fizzled: 0, castFailures: 0, byOutcome: {}, byRegister: {} },
    quietDaysIn30: 0,
    notes: [],

    /* --- handles for storylines.js and chronicle.js, the way population.js and social.js do it --- */
    seedOf: () => null,
    resolve: () => undefined,
    test: () => false,
    ruleEffect: () => null,
    noteBeat: () => {},
    noteClose: () => {},
    ledgerFor: () => 0
  });

  /* -------------------------------------------------------------- pack */

  let pack = null;
  let seeds = [];
  const seedById = new Map();
  let toneGuide = null;
  let relationshipRules = new Map();
  let castRoles = new Map();
  let budgets = { max_active_threads: 4, max_active_primary_per_township: 2, max_active_per_household: 1, max_new_threads_per_sim_week: 2, max_slow_grief_active: 2, max_same_register_active: 2 };
  let cooldowns = { seed_default_days: 120, seed_min_days: 30, household_after_primary_days: 90, household_after_supporting_days: 21, register_days: 10, place_days: 30 };
  let scoreWeights = {};
  let endingRatio = { well: 0.3, badly: 0.15, quietly: 0.35, unresolved: 0.2 };

  /* -------------------------------------------------------------- memory that survives a save */

  const seedLastRun = new Map();        // seedId -> dayIndex it last opened
  const seedRunCount = new Map();
  const householdCooldown = new Map();  // householdId -> dayIndex it comes free
  const householdCastCount = new Map();
  const registerLastRun = new Map();
  const placeLastRun = new Map();
  const townshipLastClose = new Map();
  const personCastCount = new Map();
  const obligationLedger = new Map();   // 'a>b' -> outstanding obligation a owes b, narrative's own
  const series = new Map();             // watched path -> {v: [], d: []}
  const recentSales = [];               // {day, dwellingId, buyerKind, priorUse, newUse}
  const beatDays = [];                  // dayIndex of every beat that fired, for the leave-space test
  const recentOutcomes = [];            // last 20 closed outcomes
  const recentTownships = [];           // last 12 thread townships
  const recentRegisters = [];           // last 10 thread registers

  let threads = [];
  let nextThreadId = 1;
  let openedThisWeek = [];
  let lastEvalTick = -1;
  let openDay = 0;

  /* -------------------------------------------------------------- evaluation context

  Rebuilt each evaluation. Everything expensive in it is lazy, so a seed that never asks about
  crowds never pays for a pass over two thousand people. */

  function makeCtx(w) {
    const day = w.clock.dayIndex;
    let crowdMap = null;
    let eventList = null;
    const cache = new Map();

    const ctx = {
      day,
      nowMinute: w.clock.minuteOfDay,

      reach(id) {
        const d = w.state.dunes;
        if (!d || !Array.isArray(d.reaches)) return null;
        return d.reaches.find((r) => r.id === id) || null;
      },
      roost(id) {
        const s = w.state.shorebirds;
        if (!s || !Array.isArray(s.roosts)) return null;
        return s.roosts.find((r) => r.id === id) || null;
      },

      /** People at a named place right now. Beaches and lakes have better published counts. */
      crowdAt(placeId) {
        const r = ctx.reach(placeId);
        if (r) return num(r.pedestriansToday);
        const L = (w.state.lakes && w.state.lakes.bodies || []).find((x) => x.id === placeId || x.id === 'water-' + placeId);
        if (L) return num(L.visitorsToday);
        if (!crowdMap) {
          crowdMap = new Map();
          const R = w.residents;
          if (R && R.people) {
            for (let i = 0; i < R.people.length; i++) {
              const p = R.people[i];
              if (!p.onIsland || p.sleeping) continue;
              const loc = p.locationId;
              if (!loc || loc === 'home' || loc === 'mainland') continue;
              crowdMap.set(loc, (crowdMap.get(loc) || 0) + 1);
            }
          }
        }
        if (!crowdMap.size) return undefined;
        return crowdMap.get(placeId) || crowdMap.get('biz:' + placeId) || 0;
      },

      /** What the island is doing that the pack would call an event. Never read out of a pack. */
      activeEvents() {
        if (eventList) return eventList;
        eventList = [];
        const sc = w.state.schedule;
        const nd = w.state.needs;
        if (!sc && !nd) return (eventList = undefined);
        if (sc && sc.marketDay) eventList.push('point-lookout-markets');
        if (sc && sc.day && sc.day.isPatrolDay) eventList.push('surf-patrol');
        if (sc && sc.day && sc.day.isPublicHoliday) eventList.push('public-holiday');
        const doing = nd && nd.doingNow;
        if (doing) {
          if ((doing['a-working-bee'] || 0) >= 4) eventList.push('working-bees');
          if ((doing['training-or-nippers'] || 0) >= 6) eventList.push('nippers');
          if ((doing['a-callout'] || 0) >= 2) eventList.push('a-callout');
        }
        return eventList;
      },

      saleEvents() {
        const cut = day - 30;
        return recentSales.filter((s) => s.day >= cut);
      },

      vacanciesFor(occupationId) {
        const j = w.state.jobs;
        if (!j || !Array.isArray(j.vacancies)) return undefined;
        const sector = sectorForOccupation(occupationId);
        let n = 0;
        for (const v of j.vacancies) if (!sector || v.sector === sector) n += v.short || 0;
        return n;
      },
      unfilledDaysFor(occupationId) {
        const j = w.state.jobs;
        if (!j || !Array.isArray(j.vacancies)) return undefined;
        const sector = sectorForOccupation(occupationId);
        let d = 0;
        for (const v of j.vacancies) if ((!sector || v.sector === sector) && (v.daysOpen || 0) > d) d = v.daysOpen;
        return d;
      },

      /* --- the series operators. Everything here reads published numbers and remembers them. --- */
      push(key, v) {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        let s = series.get(key);
        if (!s) series.set(key, (s = { v: [], d: [] }));
        if (s.d.length && s.d[s.d.length - 1] === day && s.v.length) { s.v[s.v.length - 1] = v; return; }
        s.v.push(v); s.d.push(day);
        if (s.v.length > SERIES_LEN) { s.v.shift(); s.d.shift(); }
      },
      changed(key, v) {
        const s = series.get(key);
        if (!s || s.v.length < 2) return false;
        return s.v[s.v.length - 1] !== s.v[s.v.length - 2];
      },
      rising(key, v, n) {
        ctx.push(key, v);
        const s = series.get(key);
        if (!s || s.v.length < n) return false;
        const tail = s.v.slice(-n);
        for (let i = 1; i < tail.length; i++) if (tail[i] < tail[i - 1]) return false;
        return tail[tail.length - 1] > tail[0];
      },
      falling(key, v, n) {
        ctx.push(key, v);
        const s = series.get(key);
        if (!s || s.v.length < n) return false;
        const tail = s.v.slice(-n);
        for (let i = 1; i < tail.length; i++) if (tail[i] > tail[i - 1]) return false;
        return tail[tail.length - 1] < tail[0];
      },
      increasedBy(key, v, n) {
        const s = series.get(key);
        if (!s || s.v.length < 2) return false;
        return (s.v[s.v.length - 1] - s.v[s.v.length - 2]) >= n;
      },
      deltaOver(key, v, days) {
        ctx.push(key, v);
        const s = series.get(key);
        if (!s || !s.v.length) return undefined;
        const cut = day - days;
        for (let i = 0; i < s.d.length; i++) if (s.d[i] >= cut) return v - s.v[i];
        return v - s.v[0];
      },
      rollingMean(key, v, days) {
        ctx.push(key, v);
        const s = series.get(key);
        if (!s || !s.v.length) return undefined;
        const cut = day - days;
        let sum = 0, n = 0;
        for (let i = 0; i < s.d.length; i++) if (s.d[i] >= cut) { sum += s.v[i]; n++; }
        return n ? sum / n : undefined;
      },
      fallenBy(key, v, frac) {
        const s = series.get(key);
        if (!s || s.v.length < 8) return false;
        let hi = -Infinity;
        for (const x of s.v) if (x > hi) hi = x;
        return hi > 0 && v <= hi * (1 - frac);
      },
      crossedThreshold(key, v, T) {
        const s = series.get(key);
        if (!s || s.v.length < 2) return false;
        const prev = s.v[s.v.length - 2];
        return (prev < T && v >= T) || (prev > T && v <= T);
      },
      belowSeasonalNorm(key, v, frac, scalerPath) {
        const s = series.get(key);
        if (!s || s.v.length < 12 || typeof v !== 'number') return false;
        let sum = 0;
        for (const x of s.v) sum += x;
        let norm = sum / s.v.length;
        if (scalerPath) {
          // Scale the long mean by how far into the season we are, so a quiet July is not read
          // against a busy October. The scaler is the supplying system's own seasonal index.
          const now = resolveRaw(w, scalerPath, {}, ctx);
          const meanScaler = ctx.rollingMean('scaler:' + scalerPath, typeof now === 'number' ? now : undefined, 365);
          if (typeof now === 'number' && typeof meanScaler === 'number' && meanScaler > 0.05) {
            norm = norm * (now / meanScaler);
          }
        }
        return norm > 0 && v <= norm * (1 - frac);
      },

      daysSince(key, dayLabel) {
        // Systems publish a formatted date on their event records. Match it against the day the
        // director first saw it rather than parsing a string into a calendar.
        const k = 'seen:' + key + ':' + dayLabel;
        if (!cache.has(k)) {
          let first = series.get(k);
          if (!first) { series.set(k, (first = { v: [day], d: [day] })); }
          cache.set(k, first.v[0]);
        }
        return day - cache.get(k);
      }
    };
    return ctx;
  }

  /** Which business sector employs an occupation. Rough, published-free, and only used to read
   *  jobs.js vacancies, which are per sector. */
  function sectorForOccupation(occ) {
    const o = String(occ || '');
    if (/cook|cafe|hospitality|bar|publican|housekeep|allrounder/.test(o)) return 'hospitality';
    if (/grocery|retail|shop/.test(o)) return 'retail';
    if (/builder|carpenter|tradesperson|rehabilitation/.test(o)) return 'trades';
    if (/nurse|health|paramedic|support-worker|carer/.test(o)) return 'health';
    return null;
  }

  /* -------------------------------------------------------------- path resolution */

  /** Walk a dotted path into an object. Returns undefined at the first missing step. */
  function walk(obj, parts, from) {
    let cur = obj;
    for (let i = from; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * Resolve a contract path. The running system always wins; the binding table is the fallback;
   * an unresolved path means the seed does not run.
   */
  function resolveRaw(w, path, bind, ctx) {
    const parts = path.split('.');
    // Substitute any <placeholder> that is bound.
    const filled = parts.map((p) => {
      if (p.length > 2 && p[0] === '<' && p[p.length - 1] === '>') {
        const name = p.slice(1, -1);
        return bind && bind[name] !== undefined ? bind[name] : p;
      }
      return p;
    });
    if (filled.some((p) => p[0] === '<')) return undefined;   // still unbound

    // 1. native.
    const head = filled[0];
    if (head === 'clock') {
      // clock is not a published system, so it always goes through a binding.
    } else {
      const st = w.state[head];
      if (st !== undefined) {
        const v = walk(st, filled, 1);
        if (v !== undefined) return v;
      }
    }

    // 2. binding table. Match on the pattern, collecting the placeholder values by position.
    for (const B of BINDING_PATTERNS) {
      if (B.parts.length !== filled.length) continue;
      let ok = true;
      const b = {};
      for (let i = 0; i < B.parts.length; i++) {
        const bp = B.parts[i];
        if (bp.length > 2 && bp[0] === '<' && bp[bp.length - 1] === '>') { b[bp.slice(1, -1)] = filled[i]; continue; }
        if (bp !== filled[i]) { ok = false; break; }
      }
      if (!ok) continue;
      try {
        return B.entry.get(w, b, ctx);
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }

  function bindingFor(path) {
    const parts = path.split('.');
    for (const B of BINDING_PATTERNS) {
      if (B.parts.length !== parts.length) continue;
      let ok = true;
      for (let i = 0; i < B.parts.length; i++) {
        const bp = B.parts[i];
        if (bp.length > 2 && bp[0] === '<') continue;
        if (bp !== parts[i]) { ok = false; break; }
      }
      if (ok) return B;
    }
    return null;
  }

  /* -------------------------------------------------------------- conditions */

  /**
   * Test one condition. Returns {pass, value, missing}. `missing` true means nothing publishes
   * this path, which is different from the condition being false and is reported differently.
   */
  function testCondition(w, cond, bind, ctx, prevValue) {
    const path = cond.path;
    const v = resolveRaw(w, path, bind, ctx);
    if (v === undefined) return { pass: false, value: undefined, missing: true, path };
    const key = path.replace(/<(\w+)>/g, (m, n) => (bind && bind[n]) || n);
    // Feed the series for anything numeric, so the shape operators have something to work on.
    if (typeof v === 'number') ctx.push(key, v);
    let pass;
    if (cond.op === 'belowSeasonalNormBy') {
      const B = bindingFor(path);
      pass = ctx.belowSeasonalNorm(key, v, cond.value, B && B.entry.norm ? B.entry.norm.scaler : null);
    } else {
      pass = compare(cond.op, v, cond.value, ctx, key, prevValue);
    }
    return { pass, value: v, missing: false, path };
  }

  /** All the placeholders a seed's trigger uses, in the order they appear. */
  function placeholdersIn(seed) {
    const names = [];
    const scan = (list) => {
      for (const c of list || []) {
        const m = String(c.path).match(/<(\w+)>/g);
        if (!m) continue;
        for (const t of m) { const n = t.slice(1, -1); if (!names.includes(n)) names.push(n); }
      }
    };
    const t = seed.trigger || {};
    scan(t.conditions); scan(t.also_requires); scan(t.suppress_if);
    return names;
  }

  /**
   * Candidate values for a placeholder. Drawn from the pack wherever the pack names them, from a
   * running system otherwise, and never invented: a placeholder with no candidates means the seed
   * does not run.
   */
  function candidatesFor(w, name, seed, ctx) {
    // The pack often lists them in the condition note: "... : a, b, c."
    const t = seed.trigger || {};
    for (const list of [t.conditions, t.also_requires, t.suppress_if]) {
      for (const c of list || []) {
        if (!String(c.path).includes('<' + name + '>') || !c.note) continue;
        const m = String(c.note).match(/:\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)+)\s*\.?$/);
        if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    const refs = seed.refs || {};
    const townships = ['dunwich', 'point-lookout', 'amity-point', 'one-mile'];
    const reaches = ((w.state.dunes && w.state.dunes.reaches) || []).map((r) => r.id);
    // Cylinder and the northern end of Main Beach are the patrolled ones: the surf club is at
    // Point Lookout and data/businesses.json puts it there. Everything else is not patrolled.
    const patrolled = ['cylinder-beach', 'main-beach-north', 'home-beach'];

    switch (name) {
      case 'venueId': case 'businessId': return (refs.businesses || []).slice();
      case 'townshipId': return townships;
      case 'beachId': return reaches;
      case 'unpatrolledBeachId': return reaches.filter((r) => !patrolled.includes(r));
      case 'lakeId': return ((w.state.lakes && w.state.lakes.bodies) || []).map((b) => b.id);
      case 'placeId': {
        const roosts = ((w.state.shorebirds && w.state.shorebirds.roosts) || []).map((r) => r.id);
        const fromRefs = (refs.places || []).slice();
        return roosts.length && seed.id.includes('roost') ? roosts : fromRefs.concat(reaches);
      }
      case 'leverId': {
        const open = ((w.state.consultation && w.state.consultation.open) || []).map((c) => c.leverId);
        return open.length ? open : (refs.civic_levers || []).slice();
      }
      case 'metricId': return (refs.metrics || []).slice();
      case 'agentId': {
        // Only two seeds ask this, and both ask whether anybody on the island has that need.
        const R = w.residents;
        if (!R || !R.people) return [];
        const out = [];
        for (let i = 0; i < R.people.length && out.length < 400; i += 3) out.push(R.people[i].id);
        return out;
      }
      case 'householdId': {
        const R = w.residents;
        return R && R.households ? R.households.slice(0, 200).map((h) => h.id) : [];
      }
      default: {
        // Occupation placeholders: <youthOccupation>, <tradeOccupation>. Take them from the cast
        // roles the seed itself lists, which is where the pack keeps its occupation vocabulary.
        if (/occupation/i.test(name)) {
          const want = name.replace(/occupation/i, '').toLowerCase();
          const out = [];
          for (const c of seed.cast || []) {
            const role = castRoles.get(c.role);
            if (!role || !role.occupations) continue;
            const roleMatches = !want || c.role.includes(want) || role.id.includes(want)
              || (want === 'youth' && /leaver|school-kid|shift-worker/.test(c.role))
              || (want === 'trade' && /tradie|builder/.test(c.role));
            if (!roleMatches) continue;
            for (const o of role.occupations) if (!out.includes(o)) out.push(o);
          }
          if (out.length) return out;
          const all = [];
          for (const c of seed.cast || []) {
            const role = castRoles.get(c.role);
            for (const o of (role && role.occupations) || []) if (!all.includes(o)) all.push(o);
          }
          return all;
        }
        return [];
      }
    }
  }

  /**
   * Evaluate a seed's whole trigger, binding placeholders as it goes. Returns
   * {fires, bind, fit, missing:[paths]}. `fit` is how far past the threshold the world actually
   * is, which the pack scores on.
   */
  function evaluateSeed(w, seed, ctx) {
    const t = seed.trigger || {};
    const names = placeholdersIn(seed);
    const missing = [];

    // Build the candidate lists once. A seed with a placeholder and no candidates cannot run.
    const candidates = {};
    for (const n of names) {
      const list = candidatesFor(w, n, seed, ctx);
      if (!list.length) return { fires: false, missing: ['<' + n + '> has no candidates'], bind: null, fit: 0 };
      candidates[n] = list;
    }

    // Try each combination of the first placeholder only. Seeds use at most one, and a product of
    // two would be a search this file has no business doing four times a day.
    const primary = names[0];
    const tries = primary ? candidates[primary] : [null];

    let best = null;
    for (const cand of tries) {
      const bind = {};
      for (const n of names) bind[n] = n === primary ? cand : candidates[n][0];

      // suppress_if: any one of these true and the seed is off, whatever else holds.
      let suppressed = false;
      for (const c of t.suppress_if || []) {
        const r = testCondition(w, c, bind, ctx, undefined);
        if (r.missing) continue;                       // cannot suppress on a path nobody publishes
        if (r.pass) { suppressed = true; break; }
      }
      if (suppressed) continue;

      // also_requires: every one of these, always, whatever the mode is.
      let alsoOk = true;
      for (const c of t.also_requires || []) {
        const r = testCondition(w, c, bind, ctx, undefined);
        if (r.missing) { if (!missing.includes(r.path)) missing.push(r.path); alsoOk = false; break; }
        if (!r.pass) { alsoOk = false; break; }
      }
      if (!alsoOk) continue;

      // conditions, under the seed's mode.
      const mode = t.mode === 'any' ? 'any' : 'all';
      let passed = 0, total = 0, fit = 0, anyMissing = false, prevValue;
      const evidence = [];
      for (const c of t.conditions || []) {
        total++;
        const r = testCondition(w, c, bind, ctx, prevValue);
        prevValue = r.value;
        if (r.missing) {
          anyMissing = true;
          if (!missing.includes(r.path)) missing.push(r.path);
          if (mode === 'all') break;
          continue;
        }
        if (r.pass) {
          passed++;
          evidence.push({ path: r.path, op: c.op, want: c.value, value: r.value });
          fit += fitOf(c, r.value);
        }
      }
      if (mode === 'all' && (anyMissing || passed < total)) continue;
      if (mode === 'any' && passed === 0) continue;
      const score = total ? fit / Math.max(1, passed) : 0;
      if (!best || score > best.fit) best = { fires: true, bind, fit: score, evidence, missing: [] };
    }

    if (best) return best;
    return { fires: false, bind: null, fit: 0, missing };
  }

  /** How far past its threshold a condition actually is, 0 to 1. A 4.2 m swell beats a 3.1 m one. */
  function fitOf(cond, v) {
    if (typeof v !== 'number' || typeof cond.value !== 'number') return 0.5;
    const T = cond.value;
    if (cond.op === '>' || cond.op === '>=') return clamp(T === 0 ? 0.5 : (v - T) / Math.abs(T), 0, 1);
    if (cond.op === '<' || cond.op === '<=') return clamp(T === 0 ? 0.5 : (T - v) / Math.abs(T || 1), 0, 1);
    return 0.5;
  }

  /* -------------------------------------------------------------- the cultural gate */

  /**
   * A seed that would need invented cultural content does not run, and the reason is published.
   * The pack contains no such seed. This exists so that a future one cannot get in quietly, and so
   * the three questions the pack itself routes to review stay routed there.
   */
  function culturalGate(seed) {
    const text = [seed.title, seed.one_line, seed.of_this_place,
      ...(seed.beats || []).map((b) => `${b.name} ${b.what_happens} ${b.chronicle}`),
      ...Object.values(seed.endings || {}).map((e) => `${e.label} ${e.chronicle}`)].join(' ').toLowerCase();
    for (const tok of FORBIDDEN_TEXT_TOKENS) {
      if (text.includes(tok)) return `the seed text contains "${tok}", which data/lore.json prohibitions puts behind review`;
    }
    for (const c of seed.cast || []) {
      const r = String(c.role).toLowerCase();
      for (const tok of FORBIDDEN_ROLE_TOKENS) {
        if (r.includes(tok)) return `cast role ${c.role} would carry cultural authority, and the pack's cast model has no such role`;
      }
    }
    return null;
  }

  /* -------------------------------------------------------------- business checks */

  /**
   * The pack's hard rule: never let a story be the thing that makes a business look real. Closed
   * and proposed entries are never used. An unconfirmed one is used only when the economy has
   * actually instantiated it, and otherwise a same-type entry in the same township is substituted.
   */
  function usableBusiness(w, id) {
    const packList = (w.data.businesses && w.data.businesses.businesses) || [];
    const rec = packList.find((b) => b.id === id);
    if (!rec) return null;
    if (rec.status === 'closed' || rec.status === 'proposed') return null;
    const live = w.residents && w.residents.businesses;
    if (rec.status === 'trading-unconfirmed') {
      if (live && live.has(id)) return id;
      const sub = packList.find((b) => b.status === 'trading' && b.type === rec.type
        && b.township === rec.township && (!live || live.has(b.id)));
      return sub ? sub.id : null;
    }
    return id;
  }

  /* -------------------------------------------------------------- casting */

  /** Households that could carry a role, from the pack's own archetype lists. */
  function householdsForRole(w, roleId) {
    const role = castRoles.get(roleId);
    const R = w.residents;
    if (!role || !R || !R.households) return [];
    const want = new Set(role.households || []);
    if (!want.size) return [];
    const out = [];
    for (const hh of R.households) if (want.has(hh.archetypeId)) out.push(hh);
    return out;
  }

  /** The narrative's own obligation ledger, which is what makes month three pay off month one. */
  function outstandingFor(personId) {
    let total = 0;
    for (const [k, v] of obligationLedger) {
      if (k.startsWith(personId + '>') || k.endsWith('>' + personId)) total += Math.abs(v);
    }
    return total;
  }

  /**
   * Draw the cast. Primary roles need a household that is not already the primary of an open
   * thread and is off its cooldown; supporting roles may be shared. Returns null when a primary
   * role cannot be filled, which is the pack's rule: the seed does not run.
   */
  function drawCast(w, seed, ctx) {
    const taken = new Set();
    for (const th of threads) for (const k of Object.keys(th.cast)) {
      const c = th.cast[k];
      if (c.householdId && c.billing === 'primary') taken.add(c.householdId);
    }
    const usedHere = new Set();
    const cast = {};
    let castTownship = null;

    for (let i = 0; i < (seed.cast || []).length; i++) {
      const entry = seed.cast[i];
      const key = entry.role + (cast[entry.role] ? ':' + i : '');
      const role = castRoles.get(entry.role);

      // The visitor role is not a resident. Visitors have no names in this simulation and they do
      // not get one here.
      if (role && role.visitor_archetypes && role.visitor_archetypes.length) {
        const by = (w.state.visitors && w.state.visitors.byArchetype) || {};
        const hint = entry.archetype_hint;
        const present = role.visitor_archetypes.filter((a) => (by[a] || 0) > 0);
        const pick = (hint && (by[hint] || 0) > 0) ? hint : (present.length ? present[castRng.int(0, present.length)] : null);
        if (!pick) {
          if (entry.billing === 'primary') return null;
          continue;
        }
        cast[key] = { role: entry.role, billing: entry.billing, kind: 'visitor', archetype: pick, name: visitorLabel(pick), township: null };
        continue;
      }

      const pool = householdsForRole(w, entry.role).filter((hh) => {
        if (usedHere.has(hh.id)) return false;
        if (entry.billing === 'primary' && taken.has(hh.id)) return false;
        const free = householdCooldown.get(hh.id);
        if (free !== undefined && free > ctx.day) return false;
        if (castTownship && entry.billing === 'primary' && hh.townshipId !== castTownship
          && (seed.cast.filter((c) => c.billing === 'primary').length > 1)) {
          // Two primaries in a story that happens in one place should be in the same place, unless
          // the seed is explicitly about the crossing.
          if (!/boat|barge|crossing|ferry|home/.test(seed.id)) return false;
        }
        return true;
      });
      if (!pool.length) {
        if (entry.billing === 'primary') return null;
        continue;
      }

      // Prefer households carrying an unpaid obligation and households that have never been in a
      // thread. The first is what makes a story three months old pay off; the second keeps the
      // island from being about six people.
      const scored = pool.map((hh) => {
        const cast0 = householdCastCount.get(hh.id) || 0;
        const members = (hh.members || []).map((m) => w.residents.peopleById.get(m)).filter(Boolean);
        let debt = 0;
        for (const m of members) debt += outstandingFor(m.id);
        return { hh, weight: 1 + debt * 1.4 + (cast0 === 0 ? 0.8 : 0.9 / (1 + cast0)) };
      });
      const chosen = castRng.weighted(scored, (s) => s.weight).hh;
      usedHere.add(chosen.id);
      if (entry.billing === 'primary' && !castTownship) castTownship = chosen.townshipId;

      const person = pickPerson(w, chosen, role, entry);
      if (!person) {
        if (entry.billing === 'primary') return null;
        continue;
      }
      cast[key] = {
        role: entry.role, billing: entry.billing, kind: 'resident',
        personId: person.id, householdId: chosen.id,
        name: person.name,                    // never displayName: a nickname the player has not seen
        township: chosen.townshipId,
        occupation: person.occupationLabel,
        yearsOnIsland: Math.round(person.yearsOnIsland),
        newcomer: !!person.newcomer
      };
    }

    const primaries = Object.values(cast).filter((c) => c.billing === 'primary');
    if (!primaries.length) return null;
    return { cast, township: castTownship || (primaries[0] && primaries[0].township) || 'dunwich' };
  }

  /** Somebody in the house who does that work, or failing that an adult who lives there. */
  function pickPerson(w, hh, role, entry) {
    const members = (hh.members || []).map((m) => w.residents.peopleById.get(m)).filter((p) => p && p.alive);
    if (!members.length) return null;
    const wants = new Set((role && role.occupations) || []);
    const exact = members.filter((p) => wants.has(p.occupationId));
    const pool = exact.length ? exact : members.filter((p) => p.age >= 18);
    const use = pool.length ? pool : members;
    // Prefer somebody who has not been in a thread before.
    const scored = use.map((p) => ({ p, weight: 1 / (1 + (personCastCount.get(p.id) || 0) * 2) }));
    return castRng.weighted(scored, (s) => s.weight).p;
  }

  function visitorLabel(a) {
    const map = {
      'day-tripper': 'a day tripper', 'family-in-a-holiday-house': 'a family in a holiday house',
      'weekend-camper': 'a weekend camper', surfer: 'a surfer', 'whale-watcher': 'a whale watcher',
      'school-group': 'a school group', backpacker: 'a backpacker', 'grey-nomad': 'a grey nomad',
      'tradesperson-from-the-mainland': 'a tradesperson over from the mainland'
    };
    return map[a] || 'a visitor';
  }

  /* -------------------------------------------------------------- scoring and the draw */

  function shareOf(list, value) {
    if (!list.length) return 0;
    let n = 0;
    for (const x of list) if (x === value) n++;
    return n / list.length;
  }

  function scoreSeed(w, seed, ev, ctx) {
    const W = scoreWeights;
    const runs = seedRunCount.get(seed.id) || 0;
    const last = seedLastRun.get(seed.id);
    const sinceDays = last === undefined ? 9999 : ctx.day - last;
    const novelty = runs === 0 ? 1 : clamp(sinceDays / 730, 0, 0.5);

    // Cast debt: how much outstanding obligation the households this seed would draw from carry.
    let debt = 0;
    for (const c of seed.cast || []) {
      if (c.billing !== 'primary') continue;
      for (const hh of householdsForRole(w, c.role)) {
        for (const m of hh.members || []) debt += outstandingFor(m);
      }
    }
    const castDebt = clamp(debt / 6, 0, 1);

    // Township and register balance: the inverse of their share of what has run lately. Dunwich is
    // the biggest township and will otherwise take everything.
    const likelyTownship = likelyTownshipOf(w, seed);
    const townshipBalance = 1 - shareOf(recentTownships, likelyTownship);
    const registerBalance = 1 - shareOf(recentRegisters, seed.register);

    // Season. The pack's season_bias keys are its own, and the two that this repo can actually
    // check are the school holidays and the long weekends, both of which schedule.js publishes.
    let seasonBias = 1;
    const sb = seed.season_bias || {};
    const d = w.state.schedule && w.state.schedule.day;
    if (d) {
      if (d.isLongWeekend && sb.long_weekends) seasonBias *= sb.long_weekends;
      if (d.isSchoolHoliday && sb.school_holidays) seasonBias *= sb.school_holidays;
      if (d.isTermTime && sb.school_term) seasonBias *= sb.school_term;
    }

    // Ending balance. The pack asks the director to nudge scoring, not outcomes, so a seed whose
    // endings are mostly of the shape we are short of scores a little higher.
    const endingNudge = 1 + 0.15 * endingShortfall(seed);

    const score = (W.trigger_fit || 1) * ev.fit
      + (W.novelty || 0.9) * novelty
      + (W.cast_debt || 0.7) * castDebt
      + (W.township_balance || 0.6) * townshipBalance
      + (W.register_balance || 0.5) * registerBalance
      + (W.seed_base_weight || 1) * (seed.base_weight || 0.5);
    return Math.max(0.001, score * seasonBias * endingNudge);
  }

  function endingShortfall(seed) {
    if (recentOutcomes.length < 6) return 0;
    let worst = 0;
    for (const k of Object.keys(seed.endings || {})) {
      const have = shareOf(recentOutcomes, k);
      const want = endingRatio[k] || 0;
      if (want - have > worst) worst = want - have;
    }
    return clamp(worst * 3, 0, 1);
  }

  function likelyTownshipOf(w, seed) {
    // The township the seed's primary archetypes live in, which is the pack's own way of saying
    // where a story happens without the seed carrying a place.
    for (const c of seed.cast || []) {
      if (c.billing !== 'primary') continue;
      const role = castRoles.get(c.role);
      for (const a of (role && role.households) || []) {
        if (a.includes('dunwich')) return 'dunwich';
        if (a.includes('point-lookout')) return 'point-lookout';
        if (a.includes('amity')) return 'amity-point';
        if (a.includes('one-mile')) return 'one-mile';
      }
    }
    return 'dunwich';
  }

  /* -------------------------------------------------------------- budgets and pacing */

  function budgetBlocks(w, seed, ctx) {
    if (threads.length >= budgets.max_active_threads) return 'four threads is the ceiling for a player to hold in their head';
    if (openedThisWeek.length >= budgets.max_new_threads_per_sim_week) return 'two new threads this week already';
    const active = threads.filter((t) => t.register === seed.register).length;
    if (seed.register === 'slow-grief' && active >= budgets.max_slow_grief_active) return 'two slow-grief threads are already open';
    if (active >= budgets.max_same_register_active) return `two ${seed.register} threads are already open`;
    if (seed.register === 'homecoming' && active >= 1) return 'a homecoming is already running';

    const last = seedLastRun.get(seed.id);
    if (last !== undefined) {
      const cd = Math.max(cooldowns.seed_min_days, seed.cooldown_days || cooldowns.seed_default_days);
      if (ctx.day - last < cd) return `this seed ran ${ctx.day - last} days ago and its cooldown is ${cd}`;
    }
    const regLast = registerLastRun.get(seed.register);
    if (regLast !== undefined && ctx.day - regLast < cooldowns.register_days) {
      return `another ${seed.register} thread opened ${ctx.day - regLast} days ago`;
    }
    return null;
  }

  /**
   * The leave-space test. An island where something happens every day is a soap. Two rules, both
   * from the pack: nothing opens in a township within three days of a thread closing there, and at
   * least eight days in every thirty have no beat at all.
   */
  function leaveSpaceBlocks(ctx, township) {
    const close = townshipLastClose.get(township);
    if (close !== undefined && ctx.day - close < 3) return `a thread closed at ${township} ${ctx.day - close} days ago`;
    const quiet = quietDaysIn30(ctx.day);
    if (quiet <= 8) return `only ${quiet} of the last thirty days have been quiet, and the pack asks for eight`;
    return null;
  }

  function quietDaysIn30(day) {
    const from = day - 29;
    const busy = new Set();
    for (const d of beatDays) if (d >= from && d <= day) busy.add(d);
    return 30 - busy.size;
  }

  /* -------------------------------------------------------------- the evaluation */

  function evaluate(w) {
    const ctx = makeCtx(w);
    state.stats.evaluations++;
    openedThisWeek = openedThisWeek.filter((d) => ctx.day - d < 7);

    const eligible = [];
    const watching = [];
    const waiting = new Map();

    for (const seed of seeds) {
      if (seed._withheld) continue;
      const ev = evaluateSeed(w, seed, ctx);
      if (!ev.fires) {
        for (const p of ev.missing || []) {
          if (!waiting.has(p)) waiting.set(p, []);
          const l = waiting.get(p);
          if (l.length < 4 && !l.includes(seed.id)) l.push(seed.id);
        }
        continue;
      }
      const blocked = budgetBlocks(w, seed, ctx);
      if (blocked) { watching.push({ seed: seed.id, title: seed.title, held: blocked }); continue; }
      eligible.push({ seed, ev, score: scoreSeed(w, seed, ev, ctx) });
    }

    state.watching = watching.slice(0, 8);
    state.waitingOn = Array.from(waiting.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([path, who]) => ({ path, seeds: who, expected: expectedIn(path) }));

    state.lastEvaluation = {
      day: ctx.day, date: w.clock.formatDate(),
      eligible: eligible.length, active: threads.length,
      quietDaysIn30: quietDaysIn30(ctx.day)
    };
    state.quietDaysIn30 = state.lastEvaluation.quietDaysIn30;

    if (!eligible.length) return;

    // Do not open a thread in the first three sim-days of a save. Let the island be ordinary first.
    if (ctx.day - openDay < 3) return;

    // Draw one, weighted by score, then apply the leave-space test before opening it. The test is
    // applied after the draw on purpose: a seed that loses to the pacing rule is not re-drawn, so
    // some weeks nothing happens, which is the point.
    const pick = rng.weighted(eligible, (e) => e.score);
    if (!pick) return;

    const drawn = drawCast(w, pick.seed, ctx);
    if (!drawn) {
      state.stats.castFailures++;
      return;
    }
    const space = leaveSpaceBlocks(ctx, drawn.township);
    if (space) { state.watching.unshift({ seed: pick.seed.id, title: pick.seed.title, held: space }); return; }

    const perTownship = threads.filter((t) => t.township === drawn.township).length;
    if (perTownship >= budgets.max_active_primary_per_township) return;

    openThread(w, pick.seed, pick.ev, drawn, ctx);
  }

  function expectedIn(path) {
    const p = (pack && pack.state_contract && pack.state_contract.paths || [])
      .find((x) => x.path === path || x.path.replace(/<[^>]+>/g, '') === path.replace(/<[^>]+>/g, ''));
    return p ? (p.expected_in || p.source || '') : '';
  }

  function openThread(w, seed, ev, drawn, ctx) {
    const id = 'th-' + (nextThreadId++);
    const th = {
      id,
      seedId: seed.id,
      title: seed.title,
      register: seed.register,
      township: drawn.township,
      cast: drawn.cast,
      bind: ev.bind || {},
      evidence: (ev.evidence || []).slice(0, 4),
      openedDay: ctx.day,
      openedDate: w.clock.formatDate(),
      beatIndex: 0,
      fired: [],
      branch: null,
      vars: {},
      waitingFor: null,
      waitingSinceDay: ctx.day,
      holdUntilDay: ctx.day,
      outcome: null,
      closedDay: null,
      social: [],
      sentiment: []
    };
    threads.push(th);
    seedLastRun.set(seed.id, ctx.day);
    seedRunCount.set(seed.id, (seedRunCount.get(seed.id) || 0) + 1);
    registerLastRun.set(seed.register, ctx.day);
    recentRegisters.push(seed.register); if (recentRegisters.length > 10) recentRegisters.shift();
    recentTownships.push(drawn.township); if (recentTownships.length > 12) recentTownships.shift();
    openedThisWeek.push(ctx.day);
    state.stats.opened++;
    state.stats.byRegister[seed.register] = (state.stats.byRegister[seed.register] || 0) + 1;
    for (const k of Object.keys(th.cast)) {
      const c = th.cast[k];
      if (!c.householdId) continue;
      householdCastCount.set(c.householdId, (householdCastCount.get(c.householdId) || 0) + 1);
      if (c.personId) personCastCount.set(c.personId, (personCastCount.get(c.personId) || 0) + 1);
    }
    publishThreads();
    w.bus.emit('narrative:thread-open', {
      id, seedId: seed.id, title: seed.title, register: seed.register,
      township: drawn.township, date: th.openedDate,
      cast: Object.values(th.cast).map((c) => ({ role: c.role, name: c.name, billing: c.billing }))
    });
  }

  /* -------------------------------------------------------------- published read model */

  function publishThreads() {
    state.activeThreads = threads.map((t) => ({
      id: t.id, seedId: t.seedId, title: t.title, register: t.register, township: t.township,
      beat: t.beatIndex, stage: t.fired.length ? t.fired[t.fired.length - 1].stage : 'opening',
      openedDate: t.openedDate, openedDay: t.openedDay,
      households: Object.values(t.cast).filter((c) => c.householdId).map((c) => c.householdId),
      cast: Object.values(t.cast).map((c) => ({ role: c.role, billing: c.billing, name: c.name, township: c.township })),
      waitingFor: t.waitingFor,
      branch: t.branch
    }));
    const reg = {};
    for (const t of threads) reg[t.register] = (reg[t.register] || 0) + 1;
    state.activeRegister = reg;
  }

  function refreshRecency(day) {
    const rs = {};
    for (const [k, v] of seedLastRun) rs[k] = { days: day - v };
    state.recentSeed = rs;
    const rr = {};
    for (const [k, v] of registerLastRun) rr[k] = { days: day - v };
    state.recentRegister = rr;
  }

  /* -------------------------------------------------------------- handles for the rest of the slice */

  function installHandles(w) {
    state.seedOf = (id) => seedById.get(id) || null;
    state.resolve = (path, bind) => resolveRaw(w, path, bind || {}, makeCtx(w));
    state.test = (cond, bind) => {
      const r = testCondition(w, cond, bind || {}, makeCtx(w), undefined);
      return { pass: r.pass, value: r.value, missing: r.missing };
    };
    state.ruleEffect = (ruleId) => relationshipRules.get(ruleId) || null;
    state.toneGuide = () => toneGuide;
    state.ledgerFor = (a, b) => obligationLedger.get(a + '>' + b) || 0;
    state.noteLedger = (a, b, delta) => {
      const k = a + '>' + b;
      obligationLedger.set(k, clamp((obligationLedger.get(k) || 0) + delta, -1, 1));
      if (Math.abs(obligationLedger.get(k)) < 0.02) obligationLedger.delete(k);
    };
    state.noteBeat = (thread, beat) => {
      const day = w.clock.dayIndex;
      if (!beatDays.length || beatDays[beatDays.length - 1] !== day) beatDays.push(day);
      if (beatDays.length > 60) beatDays.shift();
      publishThreads();
    };
    state.noteClose = (thread) => {
      threads = threads.filter((t) => t.id !== thread.id);
      townshipLastClose.set(thread.township, w.clock.dayIndex);
      state.stats.closed++;
      state.stats.byOutcome[thread.outcome] = (state.stats.byOutcome[thread.outcome] || 0) + 1;
      if (thread.outcome === 'unresolved') state.stats.fizzled++;
      recentOutcomes.push(thread.outcome);
      if (recentOutcomes.length > 20) recentOutcomes.shift();
      // Households go on cooldown for as long as the pack says, so the same family does not carry
      // the island.
      for (const k of Object.keys(thread.cast)) {
        const c = thread.cast[k];
        if (!c.householdId) continue;
        const days = c.billing === 'primary' ? cooldowns.household_after_primary_days : cooldowns.household_after_supporting_days;
        householdCooldown.set(c.householdId, w.clock.dayIndex + days);
      }
      state.closedThreads.push({
        id: thread.id, seedId: thread.seedId, title: thread.title, register: thread.register,
        township: thread.township, outcome: thread.outcome,
        openedDay: thread.openedDay, closedDay: thread.closedDay,
        openedDate: thread.openedDate, closedDate: thread.closedDate,
        beats: thread.fired.length
      });
      if (state.closedThreads.length > 200) state.closedThreads.shift();
      publishThreads();
    };
    state.threads = () => threads;
  }

  /* -------------------------------------------------------------- the system */

  return world.register({
    id: 'narrative',
    phase: 'narrative',
    order: 10,

    init(w) {
      pack = w.data.narrative || null;
      installHandles(w);
      openDay = w.clock.dayIndex;

      if (!pack || !Array.isArray(pack.seeds)) {
        state.notes.push('data/narrative.json is missing or has no seeds: no thread will ever open.');
        return;
      }
      state.pack = { version: pack.version, generated: pack.generated, seeds: pack.seeds.length };
      toneGuide = pack.tone_guide || null;
      for (const r of (pack.relationship_model && pack.relationship_model.change_rules) || []) relationshipRules.set(r.id, r);
      for (const r of (pack.cast_model && pack.cast_model.roles) || []) castRoles.set(r.id, r);
      Object.assign(budgets, (pack.director && pack.director.budgets) || {});
      Object.assign(cooldowns, (pack.director && pack.director.cooldowns) || {});
      for (const t of (pack.director && pack.director.selection && pack.director.selection.score_terms) || []) {
        scoreWeights[t.id] = t.weight;
      }
      if (pack.endings_vocabulary && pack.endings_vocabulary.ratio_target) {
        endingRatio = { ...endingRatio, ...pack.endings_vocabulary.ratio_target };
      }

      // Withhold anything the cultural gate refuses, and anything with no beats to run.
      const withheld = [];
      for (const s of pack.seeds) {
        const why = culturalGate(s);
        if (why) { s._withheld = why; withheld.push({ seed: s.id, why }); continue; }
        if (!Array.isArray(s.beats) || !s.beats.length) { s._withheld = 'no beats'; continue; }
        seeds.push(s);
        seedById.set(s.id, s);
      }
      state.withheld = withheld;

      // Publish every binding that is not the same quantity, so a critic can find them in one place
      // rather than reading this file.
      state.proxies = Object.keys(PATH_BINDINGS)
        .filter((p) => PATH_BINDINGS[p].kind !== 'same-quantity')
        .sort()
        .map((p) => ({ path: p, kind: PATH_BINDINGS[p].kind, why: PATH_BINDINGS[p].why }));

      // Housing sales are an event, not a state, so they are collected off the bus.
      w.bus.on('housing:lost-to-holiday-let', (p) => {
        recentSales.push({ day: w.clock.dayIndex, dwellingId: p && p.dwellingId, buyerKind: 'off-island', priorUse: 'long-term-rental', newUse: 'short-stay' });
        if (recentSales.length > 60) recentSales.shift();
      });
      w.bus.on('housing:converted', (p) => {
        recentSales.push({ day: w.clock.dayIndex, dwellingId: p && p.dwellingId, buyerKind: 'off-island', priorUse: (p && p.from) || 'long-term-rental', newUse: (p && p.to) || 'short-stay' });
        if (recentSales.length > 60) recentSales.shift();
      });
      // A player may ask the director to stand down, which is a real setting and not a cheat.
      w.bus.on('ui:intent', (p) => {
        if (p && p.kind === 'narrative:pause') state.paused = !!p.value;
      });

      state.ready = true;
      state.notes.push(`${seeds.length} seeds loaded from data/narrative.json ${pack.version}. `
        + `${state.proxies.length} of the ${Object.keys(PATH_BINDINGS).length} state bindings are not the same quantity and are listed in narrative.proxies.`);
      w.bus.emit('narrative:ready', { seeds: seeds.length, withheld: withheld.length });
    },

    tick(w) {
      if (!state.ready || state.paused) return;
      const t = w.clock.tick;
      if (t === lastEvalTick || t % EVAL_TICKS !== 0) return;
      lastEvalTick = t;
      refreshRecency(w.clock.dayIndex);
      evaluate(w);
    },

    describe(w) {
      return {
        seeds: seeds.length,
        withheld: state.withheld.length,
        evaluations: state.stats.evaluations,
        opened: state.stats.opened,
        closed: state.stats.closed,
        fizzled: state.stats.fizzled,
        castFailures: state.stats.castFailures,
        active: threads.length,
        quietDaysIn30: state.quietDaysIn30,
        byOutcome: state.stats.byOutcome,
        byRegister: state.stats.byRegister,
        waitingOnPaths: state.waitingOn.length,
        threads: threads.map((t) => ({
          seed: t.seedId, township: t.township, beat: t.beatIndex,
          households: Object.values(t.cast).filter((c) => c.householdId).map((c) => c.householdId),
          waitingFor: t.waitingFor && t.waitingFor.path ? t.waitingFor.path : null
        }))
      };
    },

    save() {
      return {
        v: 1,
        nextThreadId,
        threads,
        seedLastRun: Array.from(seedLastRun),
        seedRunCount: Array.from(seedRunCount),
        householdCooldown: Array.from(householdCooldown),
        householdCastCount: Array.from(householdCastCount),
        personCastCount: Array.from(personCastCount),
        registerLastRun: Array.from(registerLastRun),
        placeLastRun: Array.from(placeLastRun),
        townshipLastClose: Array.from(townshipLastClose),
        obligationLedger: Array.from(obligationLedger),
        beatDays: beatDays.slice(),
        recentOutcomes: recentOutcomes.slice(),
        recentTownships: recentTownships.slice(),
        recentRegisters: recentRegisters.slice(),
        closedThreads: state.closedThreads.slice(-60),
        stats: state.stats
      };
    },

    load(w, s) {
      if (!s) return;
      nextThreadId = s.nextThreadId || 1;
      threads = s.threads || [];
      const put = (map, list) => { map.clear(); for (const [k, v] of list || []) map.set(k, v); };
      put(seedLastRun, s.seedLastRun); put(seedRunCount, s.seedRunCount);
      put(householdCooldown, s.householdCooldown); put(householdCastCount, s.householdCastCount);
      put(personCastCount, s.personCastCount);
      put(registerLastRun, s.registerLastRun); put(placeLastRun, s.placeLastRun);
      put(townshipLastClose, s.townshipLastClose); put(obligationLedger, s.obligationLedger);
      beatDays.length = 0; for (const d of s.beatDays || []) beatDays.push(d);
      recentOutcomes.length = 0; for (const o of s.recentOutcomes || []) recentOutcomes.push(o);
      recentTownships.length = 0; for (const o of s.recentTownships || []) recentTownships.push(o);
      recentRegisters.length = 0; for (const o of s.recentRegisters || []) recentRegisters.push(o);
      state.closedThreads = s.closedThreads || [];
      if (s.stats) state.stats = s.stats;
      publishThreads();
      refreshRecency(w.clock.dayIndex);
    }
  });
}
