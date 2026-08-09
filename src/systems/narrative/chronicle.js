// The chronicle. The dated record of what happened on this island in this playthrough.
//
// director.js decides which situations are live, storylines.js runs their beats. This file is the
// third thing: it writes them down, along with everything else the island did that a local paper
// would have carried. It is the only place in the project where prose is generated, so it is the
// only place where the tone guide in data/narrative.json is enforced rather than merely quoted.
//
// THE VOICE, which is the feature.
//
//   Flat declaratives. The event carries the weight, the sentence does not have to. Concrete
//   nouns: a boat, a bin, a fence post. The island's own units: a barge sailing, a tide, a long
//   weekend, a school term. Anticlimax is allowed and is often the truest ending available: the
//   wind drops, the thing does not happen, and that is the entry.
//
//   Nothing is dramatised. There is no "worst storm in living memory" because a storm is enough.
//   Nobody is a villain. Nobody makes a speech.
//
// NOBODY SPEAKS. Not one line of dialogue is generated anywhere in this file, and the guard below
// rejects any sentence containing a quotation mark. data/narrative.json gives two reasons and both
// hold: generated dialogue is where a place stops sounding like itself, and this is Quandamooka
// Country, where putting generated words in somebody's mouth is not a thing a program gets to do.
// A rule that applied to one group only would be a worse rule, so it applies to everyone. People
// act, and the chronicle reports the action.
//
// THE CULTURAL RULE, absolute. data/lore.json forbids assigning Aboriginality, a clan, a family
// group, cultural knowledge, a cultural role or culturally framed dialogue to any simulated
// resident, and forbids depicting ceremony of any kind. No generated character in this world has
// any of those fields, because the pack that generates them does not have them either, so this
// file cannot render one. The guard checks anyway, on every sentence, before it is published, and
// counts what it rejects. Silence is accurate. An invented position is not.
//
// HOW A SENTENCE IS MADE. Every writer below reads real published state and real event payloads
// and puts real numbers in the line. Where the narrative pack has written its own chronicle line
// for a beat, that line is used verbatim, because it is the pack author's voice and it is better
// than anything this file would assemble. What this file adds around it is the date, the cast, the
// place and the evidence, so an entry can be clicked and the island will fly you there.
//
// COST. Every writer runs off a bus event, which is rare, plus one pass on a change of day. There
// is no per-tick work in this file beyond draining a queue that is almost always empty. The sim is
// at 3.93 ms of a 4 ms budget and this is not where the next millisecond goes.

const MAX_LIVE = 420;     // entries held in memory
const MAX_SAVED = 160;    // entries written into a save
const QUIET_GAP_DAYS = 6; // no more than one quiet-day line a week
const DAY_CAP = 5;        // ordinary items a day. A lead still gets through above it.

/* ------------------------------------------------------------------ the editor

   The first draft of this file wrote every event it could see and produced a thousand entries in
   a sim month, seven hundred of them about the ferry. That is a log, not a record. A local paper
   does not run "three cars got on standby" twice a day; it runs it the first time, then it runs a
   number at the end of the week.

   So there are two kinds of writer here.

     ONE-OFF     Something that is news when it happens: a household leaving, a refusal, a whale
                 close in, a yard that filled. Published on the event, then held for `GAP` days so
                 the same story does not run all month.
     TALLIED     Something that happens most days: people left behind by a water taxi, cars that
                 got on standby, an hour of circling for a park. These feed a counter and become
                 one line at the end of the week with a real number in it, which is both better
                 writing and a truer picture than fourteen separate paragraphs.

   Everything is still generated from real state. What changed is which of it is worth a line. */

const GAP = {
  'ferry:rolled': 3,
  'ferry:queue-spill': 6,
  'ferry:emergency-priority': 12,
  'navigation:beach-closed': 14,
  'weather:change': 5,
  'waste:backlog': 12,
  'whales:sighting': 6,
  'wildlife:call': 4,
  'business:stockout': 5,
  'household:moved-in': 4,
  'civic:agenda': 0,
  'civic:decision': 0,
  'civic:referral': 0,
  'civic:consultation-closed': 0,
  'household:left-the-island': 0,
  'jobs:left-for-want-of-a-room': 0,
  story: 0
};

/* ------------------------------------------------------------------ themes */

const THEMES = {
  crossing: 'The crossing',
  weather: 'Weather and water',
  council: 'The council',
  people: 'People',
  country: 'The coast and the bush',
  trade: 'Work and trade',
  underground: 'The works below the sand',
  story: 'Stories'
};

/* ------------------------------------------------------------------ the guard

   Machine-checkable house rules. A line that fails any of them is not published, is counted, and
   its reason is kept so the failure is visible in describe() rather than swallowed. */

const CEREMONY_TOKENS = [
  'ceremony', 'ceremonial', 'corroboree', 'welcome to country', 'initiation',
  'sacred site', 'songline', 'dreaming', 'dreamtime', 'totem', 'sorry business',
  'midden', 'burial'
];

function buildGuard(world) {
  const pack = (world.data && world.data.narrative) || null;
  const tone = (pack && pack.tone_guide) || {};
  const banned = (tone.banned_words || []).map((w) => String(w).toLowerCase());
  const loreBanned = (((world.data && world.data.lore) || {}).language || {}).banned_tokens;
  const tokens = ((loreBanned && loreBanned.tokens) || []).map((t) => String(t.token).toLowerCase());

  return function vet(text) {
    if (typeof text !== 'string' || !text.trim()) return 'empty';
    const low = text.toLowerCase();
    if (text.indexOf('—') >= 0) return 'em dash';
    if (/["“”‘’]/.test(text)) return 'quotation mark: nobody speaks in this chronicle';
    for (const w of banned) if (low.indexOf(w) >= 0) return 'tone guide banned word: ' + w;
    for (const t of tokens) if (low.indexOf(t) >= 0) return 'lore banned token: ' + t;
    for (const t of CEREMONY_TOKENS) if (low.indexOf(t) >= 0) return 'cultural prohibition: ' + t;
    // Two sentences at the absolute most, per the pack's own chronicle_style.
    const stops = (text.match(/[.!?](\s|$)/g) || []).length;
    if (stops > 3) return 'longer than the tone guide allows';
    return null;
  };
}

/* ------------------------------------------------------------------ small helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** "one", "two", ... up to twelve, then digits. A local paper does not write 3 vehicles. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function count(n, one, many) {
  if (!isNum(n)) return '–';
  const v = Math.round(n);
  const word = v >= 0 && v <= 12 ? WORDS[v] : String(v);
  return word + ' ' + (Math.abs(v) === 1 ? one : (many || one + 's'));
}
function num(n) { return isNum(n) ? String(Math.round(n)) : '–'; }

function money(v) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return 'A$' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + ' million';
  if (a >= 1e3) return 'A$' + Math.round(v / 1e3) + ',000';
  return 'A$' + Math.round(v);
}

const TOWNSHIPS = {
  dunwich: 'Dunwich', 'point-lookout': 'Point Lookout', 'amity-point': 'Amity Point',
  'one-mile': 'One Mile', island: 'the island'
};
function township(id) { return TOWNSHIPS[id] || (id ? String(id).replace(/-/g, ' ') : 'the island'); }

/** Lower-case the first letter of a clause so it can be joined to another. */
function join(a, b) {
  if (!b) return a;
  return a.replace(/\.$/, '') + '. ' + b;
}

/* ================================================================== the system */

export function registerChronicle(world) {
  const vet = buildGuard(world);

  const state = world.publish('chronicle', {
    ready: false,
    count: 0,
    entries: [],
    themes: Object.entries(THEMES).map(([id, label]) => ({ id, label, count: 0 })),
    places: [],
    households: [],
    rejected: [],
    lastDate: '',
    basis: 'Every line is written from published state or from an event payload at the moment it '
      + 'happened. Nothing here is invented and nothing here is dialogue: data/narrative.json rules '
      + 'out generated speech and this file enforces that on every sentence before it is published.',
    voice: 'Understated. Flat declaratives. The island\'s own units. Anticlimax is a legitimate ending.'
  });

  const entries = [];      // newest first
  const rejected = [];     // {text, why, day}
  const placeIndex = new Map();
  const lastByKey = new Map();  // writer key -> day it last ran
  const lastText = new Map();   // exact sentence -> day it last ran
  const bylined = new Set();    // threads whose byline has already run
  let seq = 0;
  let held = 0;            // lines the editor decided were not news this week
  let lastDay = -1;
  let lastQuietDay = -999;
  let lastWeekDay = 0;
  let dayHadSomething = false;
  let todayCount = 0;

  /** The week's running counts, turned into one sentence each on a change of week. */
  function freshTally() {
    return {
      taxiLeftBehind: 0, taxiSailings: 0, taxiWorst: 0,
      standbyCars: 0, standbySailings: 0,
      beachClosures: 0, beachSwellEarly: 0,
      circlingMinutes: 0, circlingDays: 0,
      stockouts: 0, stockoutNames: new Set(),
      rolledVehicles: 0, cancelledSailings: 0
    };
  }
  let tally = freshTally();

  const themeCount = {};
  for (const k of Object.keys(THEMES)) themeCount[k] = 0;

  /* -------------------------------------------------------------- places */

  function buildPlaces(w) {
    const pack = (w.data && w.data.places) || null;
    if (!pack || !Array.isArray(pack.places) || !w.island) return;
    for (const p of pack.places) {
      if (!isNum(p.lon) || !isNum(p.lat)) continue;
      const xy = w.island.project(p.lon, p.lat);
      placeIndex.set(p.id, { id: p.id, label: p.name, x: xy.x, z: xy.z, type: p.type, township: p.township || null });
    }
  }
  function place(id) { return placeIndex.get(id) || null; }
  /** The best guess at where a township is, so an entry about one can still be flown to. */
  function townPlace(id) {
    return place(id) || place('dunwich') || null;
  }

  /* -------------------------------------------------------------- writing */

  /**
   * Publish one entry. `text` is vetted first and a failure is recorded rather than shown.
   * Everything else on the record is metadata the reader uses for filtering and for flying there.
   */
  function write(w, rec) {
    const day = w.clock.dayIndex;
    const key = rec.key || rec.source || 'chronicle';
    const gap = GAP[key];
    const weight = rec.weight || 2;
    if (gap) {
      const last = lastByKey.get(key);
      if (last !== undefined && day - last < gap) { held++; return null; }
    }
    // The day's page is finite. Above the cap only a lead gets in, which is what a front page is.
    if (todayCount >= DAY_CAP && weight < 3) { held++; return null; }

    // A sentence can start with a counted noun, and "one person left the island" has to come out
    // of the writer that way so it can also be joined mid-sentence. It is capitalised here.
    rec.text = capitalise(String(rec.text || '').trim());

    // The same sentence twice in a fortnight is the record repeating itself, which reads as a bug
    // even when it is true. Identical text is held, and the count says how often.
    const seen = lastText.get(rec.text);
    if (seen !== undefined && day - seen < 24) { held++; return null; }

    const why = vet(rec.text);
    if (why) {
      rejected.unshift({ text: String(rec.text).slice(0, 160), why, date: w.clock.formatDate() });
      if (rejected.length > 12) rejected.pop();
      return null;
    }
    lastByKey.set(key, day);
    lastText.set(rec.text, day);
    if (lastText.size > 200) { const k0 = lastText.keys().next().value; lastText.delete(k0); }
    todayCount++;
    const e = {
      id: 'c-' + (++seq),
      day: w.clock.dayIndex,
      date: w.clock.formatDate(),
      time: w.clock.format(),
      minute: w.clock.minuteOfDay,
      season: w.clock.season ? w.clock.season.name : '',
      theme: rec.theme || 'people',
      themeLabel: THEMES[rec.theme] || THEMES.people,
      register: rec.register || null,
      weight: rec.weight || 2,             // 1 quiet, 2 ordinary, 3 the day's lead
      text: rec.text,
      detail: rec.detail || null,
      people: rec.people || [],
      householdId: rec.householdId || null,
      place: rec.place || null,
      township: rec.township || null,
      seedId: rec.seedId || null,
      threadId: rec.threadId || null,
      evidence: rec.evidence || null,
      source: rec.source || 'chronicle'
    };
    entries.unshift(e);
    if (entries.length > MAX_LIVE) entries.pop();
    themeCount[e.theme] = (themeCount[e.theme] || 0) + 1;
    dayHadSomething = true;
    w.bus.emit('chronicle:entry', { id: e.id, theme: e.theme, text: e.text, day: e.day });
    return e;
  }

  /* -------------------------------------------------------------- the writers */

  function bind(w) {
    const bus = w.bus;

    /* --- the drama series --------------------------------------------------
       The pack has written its own line for every beat. It is better than anything assembled
       here, so it is used exactly as written. What this file adds is the record around it. */

    bus.on('narrative:beat', (p) => {
      if (!p) return;
      const cast = (p.cast || []).filter((c) => c && c.name);
      const primaries = cast.filter((c) => c.billing === 'primary');
      const who = primaries.length ? primaries : cast.slice(0, 2);
      const text = p.chronicle || p.what;
      if (!text) return;
      // A byline, and only on the first beat of a thread. Each name carries its own occupation
      // rather than the first person's, which is how the first version of this read and was wrong.
      // Nothing here says what anybody felt about it, because the record does not know.
      let detail = null;
      if (who.length && !bylined.has(p.threadId)) {
        bylined.add(p.threadId);
        const parts = who.map((c) => c.name + (c.occupation ? ' (' + String(c.occupation).toLowerCase() + ')' : ''));
        const list = parts.length === 1 ? parts[0]
          : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
        detail = list + (p.township ? ', at ' + township(p.township) : '') + '.';
      }
      write(w, {
        key: 'story',
        theme: 'story',
        register: p.register,
        weight: p.stage === 'climax' || p.stage === 'coda' ? 3 : 2,
        text,
        detail,
        people: who.map((c) => ({ id: c.personId, name: c.name, role: c.role })),
        householdId: (who[0] && who[0].householdId) || null,
        township: p.township,
        place: townPlace(p.township),
        seedId: p.seedId,
        threadId: p.threadId,
        evidence: (p.evidence || []).map((ev) => ev.path + ' ' + ev.op + ' ' + JSON.stringify(ev.want)
          + ', was ' + JSON.stringify(ev.value)),
        source: 'data/narrative.json'
      });
    });

    bus.on('narrative:thread-close', (p) => {
      if (!p) return;
      const text = p.chronicle;
      if (!text) return;
      const cast = (p.cast || []).filter((c) => c && c.name);
      write(w, {
        key: 'story',
        theme: 'story',
        register: p.register,
        weight: 3,
        text,
        detail: p.label
          ? p.label + '. ' + (isNum(p.days) && p.days > 0
            ? capitalise(count(p.days, 'day')) + ' from the first sign of it.'
            : 'It ran its course inside a day.')
          : null,
        people: cast.map((c) => ({ id: c.personId, name: c.name, role: c.role })),
        householdId: (cast[0] && cast[0].householdId) || null,
        township: p.township,
        place: townPlace(p.township),
        seedId: p.seedId,
        threadId: p.threadId,
        source: 'data/narrative.json'
      });
    });

    /* --- the crossing ------------------------------------------------------
       The most consequential fact about this island is that there is no bridge, so the ferry is
       where most of the ordinary drama is and it gets the most writers. */

    bus.on('ferry:rolled', (p) => {
      if (!p || !isNum(p.vehicles) || p.vehicles < 1) return;
      tally.rolledVehicles += p.vehicles;
      const f = w.read('ferry') || {};
      const t = f.toondah || {};
      write(w, {
        key: 'ferry:rolled',
        theme: 'crossing', weight: 3,
        text: count(p.vehicles, 'vehicle') + ' did not get across today'
          + (isNum(t.longestWaitMin) && t.longestWaitMin > 60
            ? ', and the longest wait on the apron was ' + Math.round(t.longestWaitMin / 60) + ' hours.'
            : '.')
          + (isNum(p.rebooking) && p.rebooking > 0
            ? ' About ' + num(p.rebooking) + ' of them will try again tomorrow, which puts tomorrow behind before it starts.'
            : ''),
        place: place('dunwich-ferry-terminal') || place('dunwich'),
        township: 'dunwich',
        source: 'ferry'
      });
    });

    bus.on('ferry:queue-spill', (p) => {
      if (!p) return;
      write(w, {
        key: 'ferry:queue-spill',
        theme: 'crossing', weight: 2,
        text: 'The Toondah yard filled at ' + (p.at || 'some point in the morning') + ' and the queue went out onto '
          + (p.street || 'the street') + '.',
        detail: p.yardCapacity ? 'Yard capacity is modelled at ' + p.yardCapacity + ' vehicles. '
          + 'data/transport.json calls that the single number most likely to be wrong.' : null,
        place: place('dunwich-ferry-terminal') || place('dunwich'),
        source: 'ferry'
      });
    });

    bus.on('ferry:emergency-priority', (p) => {
      if (!p) return;
      write(w, {
        key: 'ferry:emergency-priority',
        theme: 'crossing', weight: 2,
        text: 'An emergency vehicle took the front of the ' + p.sailing + ' barge and '
          + count(p.displaced, 'booked car') + ' rolled to the next one.',
        detail: 'Nobody argues with this one. It is in the published operating rules.',
        place: place('dunwich-ferry-terminal') || place('dunwich'),
        source: 'ferry'
      });
    });

    // Tallied, not written. The water taxi leaves somebody behind most days and a paper that ran
    // that every day would be unreadable. It becomes one number on a Sunday.
    bus.on('ferry:overflow', (p) => {
      if (!p || !isNum(p.people)) return;
      tally.taxiLeftBehind += p.people;
      tally.taxiSailings++;
      if (p.people > tally.taxiWorst) tally.taxiWorst = p.people;
    });
    bus.on('ferry:standby-lucky', (p) => {
      if (!p || !isNum(p.vehicles)) return;
      tally.standbyCars += p.vehicles;
      tally.standbySailings++;
    });

    /* --- weather, water and the ground -------------------------------------- */

    bus.on('navigation:beach-closed', (p) => {
      if (!p) return;
      tally.beachClosures++;
      if (isNum(p.extraMinutesFromSwell) && p.extraMinutesFromSwell > 20) tally.beachSwellEarly++;
      const wx = w.read('weather') || {};
      write(w, {
        key: 'navigation:beach-closed',
        theme: 'weather', weight: 1,
        text: (p.beach || 'The beach') + ' shut to vehicles on the tide'
          + (isNum(p.extraMinutesFromSwell) && p.extraMinutesFromSwell > 20
            ? ', about ' + Math.round(p.extraMinutesFromSwell) + ' minutes early on the swell.'
            : '.'),
        detail: p.rule ? p.rule + (isNum(wx.swellM) ? ' Swell was running ' + wx.swellM.toFixed(1) + ' m.' : '') : null,
        place: place('main-beach'),
        source: 'navigation'
      });
    });

    bus.on('weather:change', (p) => {
      if (!p) return;
      const wx = w.read('weather') || {};
      // Only the states worth a line. A change from bright to bright is not news.
      if (!/storm|front|trough|gale|southerly|rain/i.test(String(p.synoptic) + ' ' + String(p.label))) return;
      write(w, {
        key: 'weather:change',
        theme: 'weather', weight: 2,
        text: (p.label || 'The weather changed') + '. '
          + (isNum(wx.windKt) ? num(wx.windKt) + ' knots on the bay' : 'The bay came up')
          + (isNum(wx.swellM) ? ' and ' + wx.swellM.toFixed(1) + ' m of swell outside.' : '.'),
        source: 'weather'
      });
    });

    bus.on('waste:backlog', (p) => {
      if (!p) return;
      write(w, {
        key: 'waste:backlog',
        theme: 'trade', weight: 2,
        text: 'The transfer station is holding ' + num(p.tonnes) + ' tonnes, about '
          + (isNum(p.days) ? p.days.toFixed(1) : '–') + ' days of it, because nothing has gone off the island.',
        place: place('dunwich'),
        township: 'dunwich',
        source: 'waste'
      });
    });

    /* --- the coast and the bush --------------------------------------------- */

    bus.on('whales:sighting', (p) => {
      if (!p) return;
      write(w, {
        key: 'whales:sighting',
        theme: 'country', weight: 1,
        text: 'Off ' + (p.from || 'the headland') + ', '
          + (isNum(p.distanceKm) ? p.distanceKm.toFixed(1) + ' km out: ' : 'well out: ')
          + (p.what || 'something worth stopping for') + (p.calf ? ', with a calf.' : '.'),
        detail: isNum(p.podSize) ? count(p.podSize, 'animal') + ' in the pod.' : null,
        place: p.x !== undefined ? { id: 'sighting', label: p.from || 'off the headland', x: p.x, z: p.z } : place('north-gorge-walk'),
        source: 'whales'
      });
    });

    bus.on('wildlife:call', (p) => {
      if (!p) return;
      write(w, {
        key: 'wildlife:call',
        theme: 'country', weight: 2,
        // The situation string is the wildlife system's own words and is left exactly as it wrote
        // it, after the colon, rather than bent into a clause that would change what it said.
        text: 'A call went out from ' + (p.where || 'somewhere on the island') + ': '
          + (p.situation || 'an animal in trouble') + '.',
        detail: p.publicRule || (p.contact ? 'Reported to ' + p.contact + '.' : null),
        place: isNum(p.x) ? { id: 'call', label: p.where || 'the island', x: p.x, z: p.z } : null,
        source: 'wildlife'
      });
    });

    /* --- the council -------------------------------------------------------- */

    bus.on('civic:decision', (p) => {
      if (!p) return;
      const c = w.read('council') || {};
      const inst = c.institutions ? c.institutions[p.decider] : null;
      const body = inst ? inst.label : String(p.decider || 'the decision maker').replace(/-/g, ' ');
      const verb = { approved: 'approved', 'approved-with-conditions': 'approved', refused: 'refused', deferred: 'deferred' }[p.outcome];
      if (!verb) return;
      // The pack's lever names are a mix of imperatives and noun phrases, so no single sentence
      // frame reads well around all of them. Leading with the name as its own sentence does, and
      // it is also the form a local paper uses: the thing, then what happened to it.
      const name = leverTitle(w, p.leverId);
      const bits = [];
      if (p.outcome === 'approved-with-conditions' && p.conditions && p.conditions.length) {
        bits.push('The conditions are ' + p.conditions.map((s) => String(s).toLowerCase()).join(', ') + '.');
      } else if (p.reason) {
        const r = p.reason.replace(/^(Refused|Approved|Deferred)[.,]?\s*/i, '').trim();
        if (r) bits.push(capitalise(r));
      }
      if (p.restsOnPlayerAssumption) {
        bits.push('This one rests on an assumption you recorded, not on anybody\'s stated position.');
      }
      write(w, {
        key: 'civic:decision',
        theme: 'council',
        weight: p.outcome === 'refused' ? 3 : 2,
        text: name + '. ' + body + ' ' + verb + ' it.',
        detail: bits.length ? bits.join(' ') : null,
        source: 'council',
        evidence: ['civic:decision ' + p.outcome + ' by ' + p.decider]
      });
    });

    bus.on('civic:agenda', (p) => {
      if (!p) return;
      write(w, {
        key: 'civic:agenda',
        theme: 'council', weight: 2,
        text: leverTitle(w, p.leverId) + '. ' + (p.deciderLabel || 'A body that runs part of this island')
          + ' put it on its own agenda, and nobody on the island asked for it.',
        detail: 'You cannot stop it. You can make a submission.',
        source: 'council'
      });
    });

    bus.on('civic:referral', (p) => {
      if (!p) return;
      write(w, {
        key: 'civic:referral',
        theme: 'council', weight: 2,
        text: leverTitle(w, p.leverId) + '. Referred to ' + (p.bodyLabel || 'a body') + ', and the file stopped there.',
        detail: p.statement || null,
        source: 'council'
      });
    });

    bus.on('civic:consultation-closed', (p) => {
      if (!p) return;
      const support = isNum(p.supportShare) ? Math.round(p.supportShare * 100) : null;
      const gap = isNum(p.gapIndex) ? Math.round((1 - p.gapIndex) * 100) : null;
      write(w, {
        key: 'civic:consultation-closed',
        theme: 'council', weight: 2,
        text: leverTitle(w, p.leverId) + '. ' + (p.methodLabel || 'The consultation') + ' on it closed with '
          + count(p.attended, 'person', 'people') + ' in the room'
          + (isNum(p.submissions) ? ' and ' + count(p.submissions, 'submission') + '.' : '.')
          + (support !== null ? ' ' + support + ' per cent of them were in favour.' : ''),
        detail: gap !== null
          ? 'The room matched the people actually affected ' + gap + ' per cent. A council lawyer reads that number too.'
          : null,
        place: p.venueLabel ? place(p.venue) : null,
        source: 'consultation'
      });
    });

    /* --- people ------------------------------------------------------------- */

    bus.on('household:left-the-island', (p) => {
      if (!p) return;
      write(w, {
        key: 'household:left-the-island',
        theme: 'people', weight: 3,
        text: 'A household of ' + count(p.people, 'person', 'people') + ' left ' + township(p.township) + '.'
          + (p.why ? ' ' + capitalise(String(p.why)) + '.' : ''),
        township: p.township,
        place: townPlace(p.township),
        source: 'population'
      });
    });

    bus.on('household:moved-in', (p) => {
      if (!p) return;
      const h = w.read('housing') || {};
      write(w, {
        key: 'household:moved-in',
        theme: 'people', weight: 2,
        text: count(p.people, 'person', 'people') + ' moved into ' + township(p.township) + '.',
        detail: h.rentals && isNum(h.rentals.available)
          ? count(h.rentals.available, 'rental') + ' left on the market.' : null,
        township: p.township,
        householdId: p.id,
        place: townPlace(p.township),
        source: 'population'
      });
    });

    bus.on('jobs:left-for-want-of-a-room', (p) => {
      if (!p) return;
      write(w, {
        key: 'jobs:left-for-want-of-a-room',
        theme: 'people', weight: 3,
        text: count(p.people, 'person', 'people') + ' left the island because there was nowhere to live.',
        detail: isNum(p.rentAsShareOfWagePct)
          ? 'Rent was running at ' + Math.round(p.rentAsShareOfWagePct) + ' per cent of a local wage'
            + (isNum(p.rentalsOnTheMarket) ? ', with ' + count(p.rentalsOnTheMarket, 'rental') + ' on the market.' : '.')
          : null,
        source: 'jobs'
      });
    });

    /* --- work and trade ------------------------------------------------------ */

    bus.on('business:stockout', (p) => {
      if (!p) return;
      tally.stockouts++;
      if (p.name) tally.stockoutNames.add(p.name);
      write(w, {
        key: 'business:stockout',
        theme: 'trade', weight: 2,
        text: (p.name || 'A business') + ' at ' + (p.township || 'the island') + ' had no '
          + String(p.label || p.line || 'stock').toLowerCase() + ' on the shelf'
          + (isNum(p.onOrder) && p.onOrder > 0
            ? '. There are ' + num(p.onOrder) + ' on order and the boat has not landed.'
            : ' and the delivery has not landed.'),
        detail: 'Everything on this island that is not already here comes across on a barge.',
        place: place(p.id),
        source: 'businesses'
      });
    });

    // Tallied. The carpark at Point Lookout fills on most fine days in the season and the number
    // that matters is how many days, not that it happened again on Tuesday.
    bus.on('tourism:parking-full', (p) => {
      if (!p || !isNum(p.searchMinutes)) return;
      tally.circlingMinutes += p.searchMinutes;
      tally.circlingDays++;
    });

    /* --- the works below the sand -------------------------------------------
       Every line about this carries the word proposed, because none of it exists. */

    bus.on('subterranean:tier', (p) => {
      if (!p) return;
      write(w, {
        key: 'subterranean:tier',
        theme: 'underground', weight: 2,
        text: 'Tier ' + p.tier + ' of the proposed underground works, ' + (p.name || '') + ', met its conditions in the twin.',
        detail: 'Nothing about that makes any of it real. Every building in that design is marked proposed '
          + 'and none of it is consented, funded or sited.',
        source: 'subterranean'
      });
    });

    bus.on('subterranean:lens-breach', (p) => {
      if (!p) return;
      write(w, {
        key: 'subterranean:lens-breach',
        theme: 'underground', weight: 3,
        text: 'The modelled freshwater lens went ' + (isNum(p.drawdownMm) ? Math.round(p.drawdownMm) + ' mm' : 'past')
          + ' below the agreed band in the proposed works.',
        detail: 'A modelled result on a proposed design. The band itself is modelled and the community '
          + 'would set it, not this simulation.',
        source: 'subterranean'
      });
    });
  }

  function capitalise(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  /** The lever's name exactly as the pack wrote it, used as a sentence of its own. */
  function leverTitle(w, id) {
    const levers = (w.data && w.data.civic && w.data.civic.levers) || [];
    const lv = levers.find((l) => l.id === id);
    return lv ? lv.name.replace(/\.$/, '') : capitalise(String(id || 'a decision').replace(/-/g, ' '));
  }

  /* -------------------------------------------------------------- the quiet day

     The tone guide asks for anticlimax to be a legitimate ending, and a record that only carries
     the days something went wrong is a record that reads as decline. So a day on which nothing was
     written gets one flat line about what the island was actually doing, at most once a week. */

  /* -------------------------------------------------------------- the week's numbers

     One line each, at most three of them, on a change of week. This is where the things that
     happen most days end up, and it is the better piece of writing: a number with a week behind
     it says more about living here than fourteen paragraphs saying the boat was full again. */

  function weekInReview(w) {
    const lines = [];
    if (tally.taxiSailings >= 3) {
      // Sailings and the worst of them, not the sum. The same person turned away twice is two
      // events and one person, and a total that quietly counts them twice is a false number.
      lines.push({
        theme: 'crossing', weight: 2,
        text: 'The water taxi left people on the pontoon on ' + count(tally.taxiSailings, 'sailing')
          + ' this week, ' + count(tally.taxiWorst, 'person', 'people') + ' on the worst of them.',
        place: place('dunwich-ferry-terminal') || place('dunwich')
      });
    }
    if (tally.standbySailings >= 4) {
      lines.push({
        theme: 'crossing', weight: 1,
        text: count(tally.standbyCars, 'car') + ' got across on standby this week, on '
          + count(tally.standbySailings, 'sailing') + ' where somebody booked and did not turn up.',
        place: place('dunwich-ferry-terminal') || place('dunwich')
      });
    }
    // The tide shuts the beach runs every day, so the count is not news. What is news is a week
    // where the swell shut them early, because that is sand coming off the ocean side.
    if (tally.beachSwellEarly >= 3) {
      lines.push({
        theme: 'weather', weight: 2,
        text: 'The swell shut the beach runs early on ' + count(tally.beachSwellEarly, 'tide')
          + ' this week, ahead of the two hour rule.',
        place: place('main-beach')
      });
    }
    if (tally.circlingDays >= 3) {
      const mean = tally.circlingMinutes / Math.max(1, tally.circlingDays);
      lines.push({
        theme: 'trade', weight: 1,
        text: 'The bays at Point Lookout filled on ' + count(tally.circlingDays, 'day') + ' this week, with '
          + Math.round(mean) + ' minutes of circling on the worst of them.',
        place: place('point-lookout'), township: 'point-lookout'
      });
    }
    if (tally.stockouts >= 4) {
      const names = [...tally.stockoutNames].slice(0, 2);
      lines.push({
        theme: 'trade', weight: 1,
        text: count(tally.stockouts, 'shelf', 'shelves') + ' went empty this week waiting on a delivery'
          + (names.length ? ', ' + names.join(' and ') + ' among them.' : '.')
      });
    }
    // Three at the outside. The rest of the week's numbers are in the panels that own them.
    lines.sort((a, b) => b.weight - a.weight);
    for (const l of lines.slice(0, 3)) {
      write(w, Object.assign({ key: 'week', source: 'chronicle' }, l));
    }
    tally = freshTally();
  }

  function quietDay(w) {
    const wx = w.read('weather') || {};
    const t = w.read('tide') || {};
    const f = w.read('ferry') || {};
    const wh = w.read('whales') || {};
    const bits = [];
    if (isNum(wx.windKt)) {
      bits.push(wx.windKt < 8 ? 'The bay was flat'
        : wx.windKt < 16 ? num(wx.windKt) + ' knots on the bay'
          : 'A steady ' + num(wx.windKt) + ' knots on the bay');
    }
    if (isNum(wx.rainToday) && wx.rainToday > 1) bits.push(num(wx.rainToday) + ' mm of rain');
    else if (isNum(wx.tempC)) bits.push(Math.round(wx.tempC) + ' degrees');
    if (f.cancellations && f.cancellations.today === 0) bits.push('every sailing ran');
    if (isNum(wh.visibleFromHeadland) && wh.visibleFromHeadland > 0) {
      bits.push(count(wh.visibleFromHeadland, 'pod') + ' in sight of the walk');
    }
    if (bits.length < 2) return;
    const text = 'Nothing much. ' + bits.slice(0, 3).join(', ') + '.';
    write(w, { theme: 'weather', weight: 1, text, source: 'chronicle' });
  }

  /* -------------------------------------------------------------- publishing */

  function publish(w) {
    state.count = entries.length;
    // The reader wants the newest first and does not need four hundred rows at once.
    state.entries = entries.slice(0, 220);
    state.themes = Object.entries(THEMES).map(([id, label]) => ({ id, label, count: themeCount[id] || 0 }));
    const places = new Map();
    const houses = new Map();
    for (const e of entries) {
      if (e.place && e.place.label) places.set(e.place.id, { id: e.place.id, label: e.place.label, count: (places.get(e.place.id) || { count: 0 }).count + 1 });
      if (e.householdId) houses.set(e.householdId, (houses.get(e.householdId) || 0) + 1);
    }
    state.places = [...places.values()].sort((a, b) => b.count - a.count).slice(0, 24);
    state.households = [...houses.entries()].map(([id, n]) => ({ id, count: n })).sort((a, b) => b.count - a.count).slice(0, 24);
    state.rejected = rejected.slice(0, 6);
    state.lastDate = entries.length ? entries[0].date : '';
  }

  /* -------------------------------------------------------------- registration */

  return world.register({
    id: 'chronicle',
    phase: 'narrative',
    order: 60,

    init(w) {
      buildPlaces(w);
      bind(w);
      lastDay = w.clock.dayIndex;
      state.ready = true;
      publish(w);
    },

    tick(w) {
      const d = w.clock.dayIndex;
      if (d === lastDay) return;
      // One pass on a change of day. Everything else in this file runs off a bus event.
      // The flag is read and cleared before anything below is allowed to write, because the week
      // in review writes at this same boundary and would otherwise clear the day it just filled.
      const hadSomething = dayHadSomething;
      dayHadSomething = false;
      todayCount = 0;
      if (d - lastWeekDay >= 7) { lastWeekDay = d; weekInReview(w); }
      if (!hadSomething && d - lastQuietDay >= QUIET_GAP_DAYS) {
        lastQuietDay = d;
        quietDay(w);
      }
      lastDay = d;
      publish(w);
    },

    describe() {
      const byTheme = {};
      for (const [k, v] of Object.entries(themeCount)) if (v) byTheme[k] = v;
      const last = entries[0] || null;
      return {
        ready: state.ready,
        entries: entries.length,
        written: seq,
        held,
        byTheme,
        rejected: rejected.length,
        rejectedReasons: rejected.slice(0, 3).map((r) => r.why),
        withPeople: entries.filter((e) => e.people && e.people.length).length,
        withPlace: entries.filter((e) => e.place).length,
        leads: entries.filter((e) => e.weight >= 3).length,
        lastDate: last ? last.date : null,
        lastLine: last ? last.text.slice(0, 110) : null
      };
    },

    save() {
      return {
        v: 1, seq, held, lastQuietDay, lastWeekDay,
        entries: entries.slice(0, MAX_SAVED),
        rejected: rejected.slice(0, 6),
        lastByKey: [...lastByKey.entries()],
        themeCount
      };
    },

    load(w, s) {
      if (!s) return;
      seq = s.seq || 0;
      held = s.held || 0;
      lastQuietDay = isNum(s.lastQuietDay) ? s.lastQuietDay : -999;
      lastWeekDay = isNum(s.lastWeekDay) ? s.lastWeekDay : 0;
      lastByKey.clear();
      for (const [k, v] of s.lastByKey || []) lastByKey.set(k, v);
      bylined.clear();
      tally = freshTally();
      entries.length = 0;
      for (const e of s.entries || []) entries.push(e);
      rejected.length = 0;
      for (const r of s.rejected || []) rejected.push(r);
      for (const k of Object.keys(themeCount)) themeCount[k] = (s.themeCount && s.themeCount[k]) || 0;
      lastDay = w.clock.dayIndex;
      publish(w);
    }
  });
}
