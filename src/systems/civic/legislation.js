// The legislative weight on one person, on this island, at this moment.
//
// data/legislation.json is sixty-six Acts measured from their own consolidations, plus five records
// for the edges of that corpus. This system is the join nobody had built: it takes the life events
// each Act says it touches and works out which of them a particular resident is actually living,
// from what the twin already knows about them. The result is a different list for different people,
// and a number of pages beside it.
//
// WHY THAT IS THE WHOLE POINT. The owner's question, which this pack exists to answer, is how much
// legislative weight is crippling and how much is uplifting, and in what measure, for an ordinary
// person. A single number for the island cannot answer it, because there is no ordinary person:
// there is a ranger who rents, a retired owner in a paid-off house at Amity, a cook on a casual
// roster with a dog and a ute. They are not carrying the same weight and they are not carrying it
// in the same direction. So the measure has to be per person, and the reasons have to be visible,
// or it is just a big number.
//
// FOUR RULES.
//
// 1. EVERY BINDING SAYS WHY. A person is bound to an Act because of something the twin holds about
//    them: an age, a tenure, an occupation, a vehicle, a dog. `forPerson` returns the reason with
//    every life event, and the panel shows it. A binding with no reason would be an assertion about
//    somebody's legal position, which is the one thing this pack must never make.
//
// 2. WHAT THE TWIN CANNOT TELL, IT DOES NOT CLAIM. Four of the pack's twenty-seven life events are
//    about things no system here models: separating, living with disability, owning a unit, falling
//    out with a neighbour. Nothing is attached for them and `unknowable` says so by name, because a
//    person who reads a list that quietly omits their situation is worse off than one who is told.
//
// 3. NOTHING HERE IS ADVICE. Every record carries the pack's not_advice line and so does every
//    screen that renders one. This system publishes `notAdvice` so a panel cannot forget it.
//
// 4. THESE ARE NOT REAL PEOPLE. The residents are generated. The binding is real law read against
//    invented circumstances, which makes it a worked example and not a statement about anyone.
//
// WHAT MOVES. The corpus does not change while you watch it, but who is inside it does. Every other
// tick this counts the people currently driving, currently on the water, currently at work, at
// school, or across the bay, because each of those is a life event the pack names and the Act that
// follows applies while it is happening and not before. At three in the morning the road use Act is
// doing almost nothing on this island; at ten past eight it is the busiest instrument in the pack.

/* ------------------------------------------------------------------ the reading */

/**
 * Occupations this system reads as working for yourself rather than for a wage.
 *
 * It is a reading, not a field in the pack: data/residents.json describes what each occupation does
 * and who employs it, and does not carry an employment status. These are the ones whose employer
 * list is empty or is the person themselves, and the panel says it is a reading.
 */
const SELF_EMPLOYED = new Set([
  'self-employed-cleaner', 'artist-maker', 'holiday-letting-manager', '4wd-tour-guide',
  'cultural-tour-guide', 'dive-and-surf-instructor', 'commercial-fisher', 'island-builder-carpenter',
  'mainland-tradesperson', 'water-taxi-skipper'
]);

/**
 * What a person's day binds them to, and why.
 *
 * Each rule reads the person and their household and returns a reason in plain words, or null. The
 * reason is the record: it is what the panel prints beside the Act, and it is what makes this a
 * worked example rather than an assertion.
 */
const RULES = [
  { event: 'vote', why: (p) => (p.age >= 18 ? 'eighteen or older, so an eligible citizen has to be enrolled and has to vote' : null) },
  { event: 'work-for-wages', why: (p) => (p.employed && !SELF_EMPLOYED.has(p.occupationId) ? `works for a wage${p.occupationLabel ? ' as ' + lower(p.occupationLabel) : ''}` : null) },
  { event: 'run-a-small-business', why: (p) => (SELF_EMPLOYED.has(p.occupationId) ? `works for themselves${p.occupationLabel ? ' as ' + lower(p.occupationLabel) : ''}` : null) },
  { event: 'pay-tax', why: (p) => (p.employed || SELF_EMPLOYED.has(p.occupationId) ? 'earns an income' : null) },
  { event: 'receive-a-payment', why: (p) => (p.occupationId === 'retired' ? 'retired, so the age pension rules are the ones that decide' : p.occupationId === 'unpaid-carer' ? 'an unpaid carer, and the carer payments sit in the same Act' : null) },
  { event: 'grow-old', why: (p) => (p.age >= 68 ? `${Math.floor(p.age)} years old` : null) },
  { event: 'study', why: (p) => (p.role === 'primary' || p.role === 'secondary' ? 'at school' : null) },
  { event: 'have-a-child', why: (p, hh, ctx) => (p.age >= 18 && ctx.childInHousehold ? 'a child in the house' : null) },
  { event: 'rent-a-home', why: (p, hh) => (hh && /^rented/.test(hh.tenure || '') ? `renting: ${plain(hh.tenure)}` : null) },
  { event: 'buy-or-sell-a-home', why: (p, hh) => (hh && /^(owned_outright|mortgage)$/.test(hh.tenure || '') ? `the household owns the house: ${plain(hh.tenure)}` : null) },
  { event: 'build-or-renovate', why: (p, hh) => (hh && /^(owned_outright|mortgage)$/.test(hh.tenure || '') ? 'owning the house is what puts a person in front of the building Act' : null) },
  { event: 'drive', why: (p) => (p.hasVehicle ? 'has a vehicle' : null) },
  { event: 'go-on-the-water', why: (p) => (p.hasBoat ? 'has a boat' : null) },
  { event: 'fish-crab-or-camp', why: (p) => (p.has4WD ? 'a four wheel drive on this island means the beach, a permit and a camp site' : p.hasBoat ? 'a boat, so the fisheries rules are the ones that decide' : null) },
  { event: 'keep-an-animal', why: (p) => (p.hasDog ? 'has a dog' : null) },
  { event: 'buy-and-borrow', why: (p) => (p.age >= 18 ? 'an adult buying things and signing for them' : null) },
  { event: 'be-online', why: (p) => (p.age >= 12 ? 'old enough that their information is being held by somebody' : null) },
  { event: 'die-and-leave-things', why: (p) => (p.age >= 18 ? 'an adult with something to leave' : null) },
  { event: 'deal-with-police', why: (p) => (p.age >= 18 ? 'anybody can be stopped, and the powers are the same for everyone' : null) },
  { event: 'get-sick-or-injured', why: () => 'everyone' },
  { event: 'deal-with-government', why: () => 'everyone' },
  { event: 'live-through-a-disaster', why: () => 'everyone on the island, and this one is not hypothetical here' },
  { event: 'care-for-country', why: () => 'everyone, and on Minjerribah it is joint managed Country' }
];

/** Life events the pack names that nothing in this twin can tell about a person. */
const UNKNOWABLE = [
  { key: 'separate', why: 'no system here models a relationship ending, so nothing is attached' },
  { key: 'live-with-disability', why: 'the population pack carries no disability status and this twin will not infer one' },
  { key: 'own-a-unit', why: 'dwellings here are houses; no resident is modelled as owning a lot in a scheme' },
  { key: 'disagree-with-a-neighbour', why: 'neighbours are modelled as ties and distances, not as disputes' }
];

/**
 * An occupation that puts a named Act in front of a person directly, over and above the life events.
 *
 * This is where the island shows through. A mine rehabilitation worker on Minjerribah works under
 * the Act that stopped the mining. A QYAC land and sea ranger works under the cultural heritage duty
 * of care. A deckhand on the vehicle ferry works under the passenger transport Act that the service
 * is contracted under. Every line names the Act by id and says why in one sentence.
 */
const BY_OCCUPATION = {
  'mine-rehabilitation-worker': [
    ['qld-nsipsa-2011', 'the rehabilitation is the work this Act required when it ended the mining'],
    ['qld-whs-2011', 'a rehabilitation site is a workplace']
  ],
  'qalsma-ranger': [
    ['qld-aboriginal-cultural-heritage-2003', 'the duty of care in this Act is the daily work'],
    ['cth-native-title-1993', 'the ranger programme sits under the native title determinations over this Country'],
    ['qld-nature-conservation-1992', 'the protected areas here are jointly managed']
  ],
  'qpws-ranger': [
    ['qld-nature-conservation-1992', 'the national park is declared under it'],
    ['qld-marine-parks-2004', 'the Moreton Bay Marine Park boundary runs along this coast']
  ],
  'commercial-fisher': [
    ['qld-fisheries-1994', 'the licence, the quota and the closures are all in it'],
    ['qld-marine-safety-1994', 'the boat and the crew']
  ],
  'ferry-deckhand': [
    ['qld-passenger-transport-1994', 'the service is a public passenger service'],
    ['qld-marine-safety-1994', 'the vessel and the crew']
  ],
  'water-taxi-skipper': [
    ['qld-passenger-transport-1994', 'a water taxi carries passengers for a fare'],
    ['qld-marine-safety-1994', 'the vessel and the crew']
  ],
  'terminal-and-barge-attendant': [['qld-passenger-transport-1994', 'the terminal is part of the service']],
  'island-bus-driver': [
    ['qld-passenger-transport-1994', 'the island bus is a contracted service'],
    ['qld-torum-1995', 'a heavy vehicle licence and the road rules']
  ],
  'police-officer': [['qld-police-powers-2000', 'it is the Act that says what may be done and how']],
  'council-outdoor-worker': [
    ['qld-local-government-2009', 'the employer is the council and this Act is what a council is'],
    ['qld-whs-2011', 'roadside and reserve work']
  ],
  'waste-facility-attendant': [['qld-whs-2011', 'a transfer station is a workplace with plant on it']],
  'island-builder-carpenter': [
    ['qld-building-1975', 'the building work and the certification'],
    ['qld-whs-2011', 'a site with a duty holder on it']
  ],
  'mainland-tradesperson': [['qld-building-1975', 'the same building Act follows the work across the water']],
  'primary-school-teacher': [['qld-human-rights-2019', 'a State school is a public entity, so decisions have to be compatible with the listed rights']],
  'teacher-aide': [['qld-human-rights-2019', 'a State school is a public entity']],
  'aboriginal-health-worker': [
    ['cth-privacy-1988', 'health records are sensitive information'],
    ['cth-health-insurance-1973', 'Medicare is how most of the service is paid for']
  ],
  'practice-nurse': [['cth-privacy-1988', 'health records are sensitive information']],
  'general-practitioner': [
    ['cth-health-insurance-1973', 'the schedule and the bulk billing rules'],
    ['cth-privacy-1988', 'health records are sensitive information']
  ],
  paramedic: [['qld-disaster-management-2003', 'the island arrangements are what a callout runs under when the road is cut']],
  'aged-and-disability-support-worker': [
    ['cth-ndis-2013', 'the scheme is how most of this work is funded'],
    ['cth-aged-care-2024', 'and the aged care side of the same round']
  ],
  'holiday-letting-manager': [
    ['qld-bccm-1997', 'letting in a scheme runs into the body corporate by-laws'],
    ['cth-competition-consumer-2010', 'the consumer guarantees apply to a booking']
  ],
  'rural-fire-volunteer': [['qld-disaster-management-2003', 'the local disaster management group is constituted under it']],
  'marine-rescue-volunteer': [['qld-disaster-management-2003', 'the same arrangements when the call is on the water']],
  retired: [
    ['cth-social-security-1991', 'the age pension is in it'],
    ['cth-aged-care-2024', 'and the care that may follow']
  ],
  'unpaid-carer': [['cth-social-security-1991', 'the carer payments are in it']]
};

/** What a person is doing right now, and the life event that names it. */
const LIVE = [
  { key: 'on-the-road', event: 'drive', label: 'on the road', test: (p) => p.mode === 'drive' || (p.mode === 'commute' && p.hasVehicle) },
  { key: 'on-the-water', event: 'go-on-the-water', label: 'on the water', test: (p) => p.mode === 'boat' },
  { key: 'at-work', event: 'work-for-wages', label: 'at work', test: (p) => p.actionId === 'work-shift' },
  { key: 'at-school', event: 'study', label: 'at school', test: (p) => p.actionId === 'school' },
  { key: 'across-the-bay', event: null, label: 'across the bay', test: (p) => !p.onIsland || p.mode === 'offisland' }
];

const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);
const plain = (s) => String(s || '').replace(/_/g, ' ');

/* ------------------------------------------------------------------ the system */

export function registerLegislation(world) {
  const state = world.publish('legislation', {
    ready: false,
    source: 'data/legislation.json, sixty-six Acts measured from their own consolidations',
    notAdvice: '',
    totals: null,
    lifeEvents: [],
    unknowable: UNKNOWABLE,
    edges: [],
    live: {},
    busiest: null,
    people: null,
    sample: [],
    forPerson: () => null,
    difference: () => null,
    instrument: () => null
  });

  const R = {
    pack: null,
    byId: new Map(),          // instrument id -> record
    byEvent: new Map(),       // life event key -> [instrument ids]
    eventLabel: new Map(),
    lastCount: 0
  };

  function instrumentsFor(eventKey) { return R.byEvent.get(eventKey) || []; }

  /**
   * What binds one person, and why. Nothing is cached: age, tenure, work, vehicles and the dog all
   * live on the person object and change while the island runs, so a cached answer would be a
   * yesterday answer. One person costs about six hundredths of a millisecond, which a panel at ten
   * hertz will never notice; the island-wide pass uses `weigh` below instead.
   */
  function forPerson(id) {
    const people = world.residents;
    const p = people && people.peopleById ? people.peopleById.get(id) : null;
    if (!p || !R.pack) return null;
    const hh = people.householdsById ? people.householdsById.get(p.householdId) : null;
    const ctx = {
      childInHousehold: Boolean(hh && (hh.members || []).some((m) => m && m.age !== undefined && m.age < 18))
    };

    const events = [];
    for (const rule of RULES) {
      const why = rule.why(p, hh, ctx);
      if (!why) continue;
      const label = R.eventLabel.get(rule.event) || rule.event;
      events.push({ key: rule.event, label, why, instruments: instrumentsFor(rule.event).length });
    }

    const seen = new Map();   // instrument id -> [reasons]
    for (const e of events) {
      for (const iid of instrumentsFor(e.key)) {
        if (!seen.has(iid)) seen.set(iid, []);
        seen.get(iid).push(e.label);
      }
    }
    const occupation = [];
    for (const [iid, why] of BY_OCCUPATION[p.occupationId] || []) {
      if (!R.byId.has(iid)) continue;
      occupation.push({ id: iid, why });
      if (!seen.has(iid)) seen.set(iid, []);
    }

    const list = [];
    let pages = 0;
    let provisions = 0;
    const bearing = { mostly_protects: 0, mostly_requires: 0, both: 0, machinery: 0 };
    for (const [iid, reasons] of seen) {
      const rec = R.byId.get(iid);
      if (!rec) continue;
      const occ = occupation.find((o) => o.id === iid);
      list.push({
        id: iid,
        short_title: rec.short_title,
        citation: rec.citation,
        jurisdiction: rec.jurisdiction,
        pages: rec.size.pages || 0,
        provisions: rec.size.contents_entries,
        bearing: rec.bearing,
        because: reasons,
        occupation_reason: occ ? occ.why : ''
      });
      pages += rec.size.pages || 0;
      provisions += rec.size.contents_entries || 0;
      if (bearing[rec.bearing] !== undefined) bearing[rec.bearing]++;
    }
    list.sort((a, b) => b.pages - a.pages || (a.id < b.id ? -1 : 1));

    return {
      id,
      name: p.displayName || p.name,
      age: Math.floor(p.age),
      township: p.townshipId,
      occupation: p.occupationLabel || 'not in the labour force',
      occupationId: p.occupationId,
      tenure: hh ? plain(hh.tenure) : 'not in a household',
      employed: p.employed,
      hasVehicle: p.hasVehicle,
      hasBoat: p.hasBoat,
      hasDog: p.hasDog,
      events,
      instruments: list,
      count: list.length,
      pages,
      provisions,
      bearing,
      unknowable: UNKNOWABLE,
      generated: 'A generated resident. The Acts are real and measured; the circumstances are not a '
        + 'real person and are not based on one.',
      notAdvice: state.notAdvice
    };
  }

  /** Three residents chosen so that the difference between them is visible rather than argued. */
  function chooseSample() {
    const people = (world.residents && world.residents.people) || [];
    if (!people.length) return [];
    const want = [
      (p) => p.employed && p.hasVehicle && /^rented/.test(tenureOf(p)),
      (p) => p.occupationId === 'retired' && tenureOf(p) === 'owned_outright',
      (p) => SELF_EMPLOYED.has(p.occupationId)
    ];
    const picked = [];
    for (const test of want) {
      const hit = people.find((p) => p.alive && p.age >= 18 && !picked.includes(p.id) && test(p));
      if (hit) picked.push(hit.id);
    }
    // Never pad. If a shape is not on the island today, the panel shows the ones that are.
    for (const p of people) {
      if (picked.length >= 3) break;
      if (p.alive && p.age >= 18 && !picked.includes(p.id)) picked.push(p.id);
    }
    return picked.slice(0, 3);
  }

  function tenureOf(p) {
    const hh = world.residents && world.residents.householdsById.get(p.householdId);
    return hh ? hh.tenure || '' : '';
  }

  /**
   * The weight on one person and nothing else about them: the union of the instruments their life
   * events reach, and the pages in it.
   *
   * This exists separately from `forPerson` because the island-wide pass runs it sixteen hundred
   * times and `forPerson` builds a sentence for every binding. Doing that for everybody cost 95 ms
   * in one tick, which is a visible hitch on a 60 fps budget. This one allocates nothing per person
   * beyond clearing a reused set.
   */
  const weighing = new Set();
  function weigh(p, hh, ctx) {
    weighing.clear();
    let pages = 0;
    for (const rule of RULES) {
      if (!rule.why(p, hh, ctx)) continue;
      for (const iid of instrumentsFor(rule.event)) {
        if (weighing.has(iid)) continue;
        weighing.add(iid);
        const rec = R.byId.get(iid);
        if (rec) pages += rec.size.pages || 0;
      }
    }
    for (const [iid] of BY_OCCUPATION[p.occupationId] || []) {
      if (weighing.has(iid)) continue;
      const rec = R.byId.get(iid);
      if (!rec) continue;
      weighing.add(iid);
      pages += rec.size.pages || 0;
    }
    return { pages, count: weighing.size };
  }

  /**
   * Everyone, once, so the spread across the island is measured rather than asserted, done a slice
   * at a time so no single tick carries the whole cost. The result only replaces the published one
   * when a pass finishes, so a panel never reads half an island.
   */
  const PASS_SLICE = 50;
  const pass = { cursor: 0, running: false, counts: [], lightest: null, heaviest: null };

  function startPass() {
    pass.cursor = 0;
    pass.running = true;
    pass.counts = [];
    pass.lightest = null;
    pass.heaviest = null;
  }

  function stepPass() {
    const people = (world.residents && world.residents.people) || [];
    const end = Math.min(people.length, pass.cursor + PASS_SLICE);
    for (let i = pass.cursor; i < end; i++) {
      const p = people[i];
      if (!p || !p.alive || p.age < 18) continue;
      const hh = world.residents.householdsById.get(p.householdId);
      const ctx = { childInHousehold: Boolean(hh && (hh.members || []).some((m) => m && m.age !== undefined && m.age < 18)) };
      const w = weigh(p, hh, ctx);
      pass.counts.push(w.pages);
      if (!pass.lightest || w.pages < pass.lightest.pages) pass.lightest = { id: p.id, pages: w.pages, count: w.count };
      if (!pass.heaviest || w.pages > pass.heaviest.pages) pass.heaviest = { id: p.id, pages: w.pages, count: w.count };
    }
    pass.cursor = end;
    if (pass.cursor < people.length) return;

    pass.running = false;
    const counts = pass.counts.slice().sort((a, b) => a - b);
    const detail = (row) => {
      if (!row) return null;
      const b = forPerson(row.id);
      return b ? { id: row.id, name: b.name, pages: b.pages, count: b.count, occupation: b.occupation, tenure: b.tenure } : null;
    };
    state.people = {
      adults: counts.length,
      medianPages: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
      lightest: detail(pass.lightest),
      heaviest: detail(pass.heaviest),
      note: 'Every adult resident, measured the same way. The spread is the answer to the question: '
        + 'there is no single weight, there is a range, and where a person sits in it is decided by '
        + 'what they do and what they own.'
    };
  }

  /**
   * Two people, side by side, and what one carries that the other does not.
   *
   * This is the part that answers the question properly. Almost everybody on the island carries most
   * of the corpus, so a total on its own reads as though the law falls evenly. It does not. The
   * difference is where the answer lives, and it is usually a dozen Acts and several thousand pages.
   */
  function difference(idA, idB) {
    const a = forPerson(idA);
    const b = forPerson(idB);
    if (!a || !b) return null;
    const inB = new Set(b.instruments.map((i) => i.id));
    const inA = new Set(a.instruments.map((i) => i.id));
    const onlyA = a.instruments.filter((i) => !inB.has(i.id));
    const onlyB = b.instruments.filter((i) => !inA.has(i.id));
    return {
      a: { id: a.id, name: a.name, occupation: a.occupation, tenure: a.tenure, count: a.count, pages: a.pages },
      b: { id: b.id, name: b.name, occupation: b.occupation, tenure: b.tenure, count: b.count, pages: b.pages },
      shared: a.instruments.length - onlyA.length,
      sharedPages: a.instruments.filter((i) => inB.has(i.id)).reduce((t, i) => t + i.pages, 0),
      onlyA,
      onlyB
    };
  }

  return world.register({
    id: 'legislation',
    phase: 'civic',
    order: 75,

    init(w) {
      const pack = (w.data && w.data.legislation) || null;
      if (!pack) return;
      R.pack = pack;
      for (const i of pack.instruments || []) R.byId.set(i.id, i);
      for (const le of pack.life_events || []) R.eventLabel.set(le.key, le.label);
      for (const i of pack.instruments || []) {
        for (const key of i.life_events || []) {
          if (!R.byEvent.has(key)) R.byEvent.set(key, []);
          R.byEvent.get(key).push(i.id);
        }
      }

      let pages = 0;
      let provisions = 0;
      const byBearing = {};
      const byJurisdiction = {};
      for (const i of pack.instruments || []) {
        pages += i.size.pages || 0;
        provisions += i.size.contents_entries || 0;
        byBearing[i.bearing] = (byBearing[i.bearing] || 0) + 1;
        byJurisdiction[i.jurisdiction] = (byJurisdiction[i.jurisdiction] || 0) + 1;
      }
      state.notAdvice = (pack.not_advice && pack.not_advice.line) || '';
      state.totals = {
        instruments: (pack.instruments || []).length,
        pages,
        provisions,
        byBearing,
        byJurisdiction,
        // A tenth of a millimetre a page is ordinary office paper. The height is arithmetic on a
        // measured number, and the assumption is printed beside it wherever it is shown.
        stackMetres: +((pages * 0.1) / 1000).toFixed(2),
        stackNote: 'at a tenth of a millimetre a page, which is ordinary paper'
      };
      state.lifeEvents = (pack.life_events || []).map((le) => {
        const ids = instrumentsFor(le.key);
        return {
          key: le.key,
          label: le.label,
          instruments: ids.length,
          pages: ids.reduce((a, id) => a + ((R.byId.get(id) || { size: {} }).size.pages || 0), 0)
        };
      });
      state.edges = (pack.edges || []).map((e) => ({ id: e.id, type: e.type, title: e.title }));
      state.forPerson = forPerson;
      state.difference = difference;
      state.instrument = (id) => R.byId.get(id) || null;
      state.ready = true;
    },

    tick(w) {
      if (!state.ready) return;
      const people = (w.residents && w.residents.people) || [];
      if (!people.length) return;

      // The roster changed, so the island-wide measure is about a slightly different island. Start
      // the pass again rather than patching it.
      if (people.length !== R.lastCount) {
        R.lastCount = people.length;
        state.sample = chooseSample();
        startPass();
      }
      if (pass.running) stepPass();

      // Every other tick, which is twenty sim-minutes: what is happening now, and which instrument
      // is doing the most work while it happens.
      if (w.clock.tick % 2 !== 0) return;
      const live = {};
      for (const l of LIVE) live[l.key] = 0;
      for (const p of people) {
        if (!p.alive) continue;
        for (const l of LIVE) if (l.test(p)) live[l.key]++;
      }
      state.live = live;

      // What the most people are inside at this moment. It names the life event and the Acts under
      // it rather than picking one of them, because there is no honest way to rank four Acts that
      // all apply to the same driver: the road use Act, the vehicle registration duty and the
      // security interest over the car loan are all live while the ute is moving.
      let busiest = null;
      for (const l of LIVE) {
        if (!l.event || !live[l.key]) continue;
        if (busiest && live[l.key] <= busiest.people) continue;
        busiest = {
          event: l.event,
          doing: l.label,
          people: live[l.key],
          instruments: instrumentsFor(l.event)
            .map((id) => R.byId.get(id))
            .filter(Boolean)
            .map((rec) => ({ id: rec.id, short_title: rec.short_title, citation: rec.citation, pages: rec.size.pages || 0 }))
        };
      }
      state.busiest = busiest;
    },

    describe(w) {
      return {
        ready: state.ready,
        instruments: state.totals ? state.totals.instruments : 0,
        pages: state.totals ? state.totals.pages : 0,
        live: state.live,
        busiest: state.busiest ? { event: state.busiest.event, people: state.busiest.people } : null,
        adults: state.people ? state.people.adults : 0,
        medianPages: state.people ? state.people.medianPages : 0,
        heaviest: state.people && state.people.heaviest ? state.people.heaviest.pages : 0,
        lightest: state.people && state.people.lightest ? state.people.lightest.pages : 0
      };
    },

    save() { return null; },
    load() {}
  });
}
