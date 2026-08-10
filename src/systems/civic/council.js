// Who actually decides.
//
// This is the file that separates this from Democracy 4. In Democracy 4 you are the government and
// pulling a lever is a click. Here you are not the government. You hold the island's civic desk: a
// budget line, a mailing list, and no vote in anybody's chamber.
//
// Read the pack and count. Every number below is derived at runtime, in `countReach()`, and
// published on the read model, because a count typed into a comment goes stale the first time
// somebody adds a lever. As at the Commonwealth pass the pack holds sixty-four levers across
// fifteen bodies, and the largest holders are Redland City Council, the Queensland Government,
// QYAC, the joint management arrangement of the national park, SeaLink and the Commonwealth. The
// pack's own honesty note puts it plainly: "who_decides is the most important field in the file.
// It is deliberately, frequently, not the player."
//
// COUNTING BODIES IS THE WRONG MEASURE, AND THIS IS THE FILE THAT FIXES IT.
// A list of six names beside a lever tells a player nothing except that it is complicated. What
// they actually need to know is how many *governments* have to agree, because that is the thing
// that changes the kind of difficulty rather than the amount of it. Three of the pack's seven
// tiers are orders of government: the Commonwealth, Queensland and the council. Every institution
// in data/civic.json carries a tier, `reachOf()` reduces a lever's who_decides to the distinct
// tiers in it, and the answer comes out at nought, one, two or three governments. Nought is not
// easy; it means the decision belongs to a native title body, a joint arrangement or a private
// operator, and this file will not simulate the first two of those at all.
//
// The Commonwealth is a real and small presence and both halves of that matter. It decides seven
// levers and constrains many more, it has no office here, and most of its money arrives having
// already passed through Queensland or the council. So it enters this file three ways: as a
// decision maker on the levers it genuinely holds, as an extra referral on the form for anything
// that touches a matter of national environmental significance, and as an extra wait, because a
// thing that needs three governments does not take three times as long but it certainly does not
// take the same time as one.
//
// So the verbs here are not "enact". They are:
//   PREPARE   commission the assessments an application actually needs, and pay for them
//   LODGE     and then wait, because a lodged application is a clock, not an outcome
//   ANSWER    an information request that arrives after the clock has already run
//   CONSULT   because evidence of community support is a form item, not a nicety
//   ADVOCATE  submissions, petitions, deputations, and the boat home from a mainland meeting
//   LIVE WITH refusal, deferral, or approval with conditions that change what you built
//
// AND THE ONE THING THIS TWIN WILL NOT DO.
// Fourteen levers are decided by QYAC as native title holder, four by Minjerribah Camping, ten
// through joint management with Queensland Parks. data/lore.json forbids this project from giving
// QYAC a simulated opinion, vote, mood or negotiating position, and forbids representing any
// Quandamooka view on a lever unless QYAC has publicly stated it. There are five such public
// statements and they are listed in the pack. So for those levers this file models the process,
// the referral, the documented capacity constraint and the wait, and then it stops and says so.
// The player can record an assumption to keep playing, and everything downstream of that assumption
// is permanently labelled as resting on it. Silence is accurate. An invented position is not.
//
// Intents this system accepts on the bus as `ui:intent`:
//   {kind:'civic:pursue', leverId}                open a file on a lever
//   {kind:'civic:commission', applicationId, item} pay for and start a required assessment
//   {kind:'civic:lodge', applicationId}           lodge it, ready or not
//   {kind:'civic:withdraw', applicationId}        pull it
//   {kind:'civic:escalate', applicationId, how}   petition | deputation | media
//   {kind:'civic:assume', referralId, outcome}    record what you assume a body you do not sit on decided
//   {kind:'civic:cease', leverId}                 stop funding something the island already does
//   {kind:'civic:stepup', leverId}                do more of something already in place

const DAYS_PER_MONTH = 30.4375;
const WEEK = 7;

/** Modelled decision cadences. Labelled as modelled: no meeting calendar was read for this build. */
const CADENCE = {
  'redland-city-council': { days: 28, label: 'a monthly council meeting' },
  'rcc-division-2': { days: 28, label: 'a monthly council meeting' },
  'redland-water': { days: 28, label: 'the council cycle' },
  'qld-government': { days: 182, label: 'a budget cycle' },
  detsi: { days: 120, label: 'a program round' },
  qpws: { days: 91, label: 'a quarterly park cycle' },
  'joint-management': { days: 91, label: 'a quarterly joint management cycle' },
  'tmr-translink': { days: 182, label: 'a contract variation window' },
  edq: { days: 182, label: 'a development authority cycle' },
  seqwater: { days: 91, label: 'a quarterly cycle' },
  sealink: { days: 91, label: 'a commercial review' },
  'stradbroke-flyer': { days: 91, label: 'a commercial review' },
  sibelco: { days: 182, label: 'a rehabilitation program review' },
  'private-landowners': { days: 60, label: 'whenever the owners can agree and afford it' },
  'australian-government': { days: 365, label: 'a federal funding round' },
  // Not a meeting cycle: a statutory clock. Section 75 of the EPBC Act gives the minister twenty
  // business days to decide whether a referred action is a controlled action, which is about
  // twenty-eight calendar days. What follows that decision has no such clock, and the Toondah
  // referral sat with the Commonwealth from 2018 to 2024.
  dcceew: { days: 28, label: 'a statutory referral clock of twenty business days' },
  qyac: { days: 0, label: 'not modelled' },
  'minjerribah-camping': { days: 0, label: 'not modelled' },
  community: { days: 30, label: 'whenever somebody volunteers' }
};

/** Bodies whose decisions this twin will not simulate, and why. */
const NOT_MODELLED = {
  qyac: 'QYAC holds the native title rights and interests of the Quandamooka People, recognised on 4 July 2011. This twin does not model its decisions.',
  'minjerribah-camping': 'Minjerribah Camping is a QYAC business. This twin does not model its commercial decisions.',
  'joint-management': 'Naree Budjong Djara National Park and the Minjerribah Recreation Area are jointly managed by QYAC and Queensland Parks under an Indigenous Management Agreement. This twin does not model a joint management decision.'
};

/** Which fund a decision maker's money comes out of. External means it is not the player's to spend. */
const FUND_OF = {
  'redland-city-council': 'council-island',
  'rcc-division-2': 'council-island',
  community: 'council-island',
  'redland-water': 'redland-water',
  seqwater: 'redland-water',
  'qld-government': 'minjerribah-futures',
  detsi: 'minjerribah-futures',
  qpws: 'minjerribah-futures',
  'tmr-translink': 'minjerribah-futures',
  edq: 'minjerribah-futures',
  qyac: 'qyac-enterprise',
  'minjerribah-camping': 'qyac-enterprise',
  'joint-management': 'qyac-enterprise',
  sealink: 'external',
  'stradbroke-flyer': 'external',
  sibelco: 'external',
  'private-landowners': 'external',
  'australian-government': 'external',
  dcceew: 'external'
};

/**
 * Which tier a body belongs to when the pack does not say.
 *
 * The pack is the authority: every institution in data/civic.json carries a `tier`, and this map
 * exists so a pack written before that field still resolves rather than reporting every body as
 * unknown. If you are adding a body, add it to the pack, not here.
 */
const TIER_FALLBACK = {
  'redland-city-council': 'local', 'rcc-division-2': 'local', 'redland-water': 'local',
  seqwater: 'state', 'qld-government': 'state', detsi: 'state', qpws: 'state',
  'tmr-translink': 'state', edq: 'state',
  'joint-management': 'joint', qyac: 'native_title', 'minjerribah-camping': 'native_title',
  'transit-systems': 'private', sealink: 'private', 'stradbroke-flyer': 'private',
  sibelco: 'private', 'private-landowners': 'private',
  'australian-government': 'commonwealth', dcceew: 'commonwealth', community: 'none'
};

/** The three tiers that are orders of government. The other four are hard in a different way. */
const GOVERNMENT_TIERS = ['commonwealth', 'state', 'local'];

const TIER_LABEL = {
  commonwealth: 'the Commonwealth',
  state: 'the state',
  local: 'the council',
  native_title: 'the native title holders',
  joint: 'joint management',
  private: 'a private operator',
  none: 'nobody in particular'
};

/**
 * How much longer a thing takes when more than one government has to agree.
 *
 * Not a multiplier, on purpose. Two governments does not mean twice the wait: it means one more
 * body that has to see the file, and the file mostly sits in an in tray while it does. These are
 * modelling values in weeks added to the assessment, and they are labelled as modelling values
 * wherever a player sees them. Nobody has published a measured figure for this island.
 */
const EXTRA_WEEKS_PER_GOVERNMENT = [0, 0, 6, 14];

/**
 * The form. Every item is derived from something in the lever's own record: what it costs, what it
 * touches, who decides it. Nothing here is invented for flavour. An application lodged without a
 * required item still runs its assessment clock and then comes back as an information request,
 * which is the part that costs a player a season and is exactly how it goes.
 */
const FORM_RULES = [
  {
    id: 'cost-estimate',
    label: 'A costed estimate',
    weeks: 4,
    cost: (lv) => Math.max(6000, Math.round((lv.cost_aud.capital || 0) * 0.005)),
    when: () => true,
    why: 'Nobody assesses anything without a number on it.'
  },
  {
    id: 'business-case',
    label: 'A business case',
    weeks: 12,
    cost: (lv) => Math.round((lv.cost_aud.capital || 0) * 0.012),
    when: (lv) => (lv.cost_aud.capital || 0) >= 1000000,
    why: 'Capital over a million dollars does not move without one.'
  },
  {
    id: 'funding-source',
    label: 'A nominated funding source',
    weeks: 2,
    cost: () => 0,
    when: (lv) => (lv.cost_aud.recurring_per_year || 0) > 0,
    why: 'An ongoing cost with no ongoing funding is the fastest refusal there is.'
  },
  {
    id: 'environmental-assessment',
    label: 'An environmental assessment',
    weeks: 16,
    cost: () => 45000,
    when: (lv, touches) => touches('shorebird_disturbance') || touches('koala_population') || touches('dune_condition') || touches('water_quality_nearshore'),
    why: 'It touches habitat, so it needs someone to say by how much.'
  },
  {
    // THE COMMONWEALTH ON THE FORM.
    //
    // The island already carries four matters of national environmental significance and the civic
    // layer never knew. data/ecology.json has the eastern curlew at Critically Endangered and the
    // bar-tailed godwit at Endangered under the EPBC Act, shorebirds.js flushes them off the western
    // flats, the koala has been Endangered nationally since February 2022, and half the island sits
    // inside the Moreton Bay Ramsar site listed in 1993. So an action likely to have a significant
    // impact on any of those is referred to the Commonwealth before anybody local gets to decide it.
    //
    // What this models is the referral and the wait, and nothing else. The twenty business days in
    // section 75 is the decision on whether it is a controlled action, so it is short and it is
    // real; everything after it depends on an answer this file does not generate. The twin does not
    // decide that a given lever is a controlled action, does not produce a finding and does not
    // approve or refuse anything on the Commonwealth's behalf. It puts the referral on the form,
    // because that is what a proponent actually has to do, and it says who is being asked.
    id: 'epbc-referral',
    label: 'A referral to the Australian Government',
    weeks: 10,
    cost: () => 32000,
    when: (lv, touches) => touches('shorebird_disturbance') || touches('koala_population')
      || touches('water_quality_nearshore'),
    why: 'It touches a matter of national environmental significance: the Ramsar wetland the island '
      + 'sits in, the listed migratory shorebirds on the western flats, or the koala, which has been '
      + 'listed as Endangered nationally since February 2022. Six weeks to prepare it and about four '
      + 'for the minister to decide whether it is a controlled action. If it is, the assessment after '
      + 'that has no clock this twin can give you.'
  },
  {
    id: 'coastal-hazard-assessment',
    label: 'A coastal hazard assessment',
    weeks: 20,
    cost: () => 85000,
    when: (lv, touches) => touches('erosion_risk_amity') || touches('beach_width_amity') || lv.issue === 'amity-erosion',
    why: 'Amity Point is a declared erosion prone area and the only part of the city assessed at high risk in the 2016 current hazards work.'
  },
  {
    id: 'traffic-and-parking-assessment',
    label: 'A traffic and parking assessment',
    weeks: 10,
    cost: () => 38000,
    when: (lv, touches) => touches('traffic_volume') || touches('parking_pressure') || touches('barge_queue_peak'),
    why: 'One main road, three townships, and a carpark that fills by eight.'
  },
  {
    id: 'cultural-heritage-duty-of-care',
    label: 'A cultural heritage duty of care assessment',
    weeks: 12,
    cost: () => 28000,
    when: (lv) => (lv.cost_aud.capital || 0) > 250000,
    why: 'Ground disturbance in Queensland carries a duty of care. This twin models the requirement, the cost and the wait. It does not model the assessment, and it does not generate a finding.'
  },
  {
    id: 'evidence-of-community-support',
    label: 'Evidence of community support',
    weeks: 8,
    cost: () => 0,
    satisfiedByConsultation: true,
    when: (lv) => lv.player_role === 'player_advocates' || lv.player_role === 'player_funds',
    why: 'You are asking somebody else to do this. The first question back is who wants it.'
  }
];

export function registerCouncil(world) {
  // world.rng.restore() rebuilds the pool with fresh Rng objects rather than mutating the existing
  // ones, so a stream captured at registration is a stale object after a load and quietly draws from
  // a different position in the sequence. Resolve the stream at the point of use. It is a Map lookup.
  const STREAM = 'civic-council';
  const rng = {
    float: () => world.rng.stream(STREAM).float(),
    int: (a, b) => world.rng.stream(STREAM).int(a, b),
    bool: (p) => world.rng.stream(STREAM).bool(p),
    pick: (a) => world.rng.stream(STREAM).pick(a),
    normal: (m, s) => world.rng.stream(STREAM).normal(m, s),
    weighted: (items, fn) => world.rng.stream(STREAM).weighted(items, fn)
  };

  const state = world.publish('council', {
    ready: false,
    day: 0,
    playerSeat: 'You hold the island\'s civic desk. You have a budget line, a mailing list, and no vote in anybody\'s chamber.',
    institutions: {},
    applications: [],
    closed: [],
    referrals: [],
    nextCouncilMeetingInDays: 0,
    inTrayCount: 0,
    stats: { lodged: 0, approved: 0, withConditions: 0, refused: 0, deferred: 0, withdrawn: 0, infoRequests: 0, referred: 0 },
    notes: [],
    // How the levers split by how many governments have to agree. Derived from the pack at init and
    // never typed in, because the whole point of publishing it is that a screen can print it
    // instead of hard-coding a number that was true the week somebody wrote it.
    reach: { byGovernments: { 0: 0, 1: 0, 2: 0, 3: 0 }, byTier: {}, tiers: [], governmentTiers: GOVERNMENT_TIERS.slice(), total: 0 },
    reachOf: () => null,
    whoDecides: () => null,
    canPlayer: () => null,
    applicationCard: () => null
  });

  const INST = new Map();
  const apps = [];
  const referrals = [];
  let pack = null;
  let seq = 0;
  const intents = [];
  const consultResults = new Map(); // leverId -> latest result
  const refusedRecently = new Map(); // leverId -> day it was last refused
  let lastDay = -1;
  let budgetAdoptedDay = -9999;
  let fyCapitalOpen = true;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayOf = (w) => w.clock.dayIndex;
  const moneyShort = (n) => {
    const a = Math.abs(n || 0);
    if (a >= 1000000) return 'A$' + (n / 1000000).toFixed(a >= 10000000 ? 0 : 1) + 'M';
    if (a >= 1000) return 'A$' + Math.round(n / 1000) + 'k';
    return 'A$' + Math.round(n || 0);
  };

  /* ------------------------------------------------------------------ boot */

  function build(w) {
    pack = (w.data && w.data.civic) || null;
    if (!pack || !Array.isArray(pack.levers)) {
      state.notes.push('data/civic.json is missing. No decision maker can be modelled.');
      return;
    }
    for (const inst of pack.institutions || []) {
      const cad = CADENCE[inst.id] || { days: 90, label: 'an unmodelled cycle' };
      INST.set(inst.id, {
        id: inst.id,
        label: inst.label,
        kind: inst.kind,
        // The pack decides, this file only fills in. An unknown tier reports itself as unknown
        // rather than being quietly folded into one of the seven, because a body nobody has placed
        // is a thing somebody needs to see.
        tier: inst.tier || TIER_FALLBACK[inst.id] || 'unknown',
        role: inst.role,
        source: inst.source,
        confidence: inst.confidence,
        note: inst.note || '',
        capacityNote: inst.capacity_note || '',
        moneyNote: inst.money_note || '',
        cadenceDays: cad.days,
        cadenceLabel: cad.label,
        notModelled: !!NOT_MODELLED[inst.id],
        notModelledWhy: NOT_MODELLED[inst.id] || '',
        appetite: 0.45,
        standing: 0.5,       // how the player is regarded by this body
        openWithThem: 0,
        lastDecisionDay: -999,
        decisionsMade: 0,
        fund: FUND_OF[inst.id] || 'external'
      });
    }
    const unplaced = [...INST.values()].filter((i) => i.tier === 'unknown');
    state.notes.push(`${INST.size} decision makers across ${new Set([...INST.values()].map((i) => i.tier)).size} tiers. ${[...INST.values()].filter((i) => i.notModelled).length} of them make decisions this twin will not simulate.`);
    if (unplaced.length) state.notes.push(`${unplaced.length} body without a tier in the pack: ${unplaced.map((i) => i.label).join(', ')}.`);
    countReach();
    publish();
    state.ready = true;
  }

  const lever = (id) => (pack.levers || []).find((l) => l.id === id) || null;

  /* ------------------------------------------------------------------ how far a lever reaches

  The one idea this file adds to who_decides. A list of names says a thing is complicated. The
  number of distinct governments in that list says what kind of complicated, and that is the number
  a player can act on: one government is a meeting, two is a meeting and a letter, three is a
  campaign. Everything below is derived from the pack, so it moves when the pack moves. */

  /**
   * The tiers a lever's deciders belong to, the governments among them, and a plain sentence.
   * Returns null for a lever that does not exist, so a caller can tell absent from empty.
   */
  function reachOf(lv) {
    if (!lv || !Array.isArray(lv.who_decides)) return null;
    const tiers = [];
    const bodies = [];
    for (const id of lv.who_decides) {
      const inst = INST.get(id);
      const tier = inst ? inst.tier : (TIER_FALLBACK[id] || 'unknown');
      if (!tiers.includes(tier)) tiers.push(tier);
      bodies.push({ id, label: inst ? inst.label : id, tier, cadence: inst ? inst.cadenceLabel : '', notModelled: inst ? inst.notModelled : false });
    }
    const governments = GOVERNMENT_TIERS.filter((t) => tiers.includes(t));
    return {
      tiers,
      bodies,
      governments,
      governmentCount: governments.length,
      bodyCount: lv.who_decides.length,
      label: reachLabel(governments, tiers),
      plain: reachPlain(governments, tiers)
    };
  }

  /** Two or three words for a chip. Short enough to sit on a card next to the cost. */
  function reachLabel(governments, tiers) {
    if (governments.length === 0) {
      if (tiers.includes('native_title')) return 'Outside government';
      if (tiers.includes('joint')) return 'Outside government';
      if (tiers.includes('private')) return 'Not government at all';
      return 'Nobody in particular';
    }
    if (governments.length === 1) return 'One government';
    if (governments.length === 2) return 'Two governments';
    return 'Three governments';
  }

  /** The sentence under the chip. Says which ones, because which ones is most of the difficulty. */
  function reachPlain(governments, tiers) {
    const named = governments.map((t) => TIER_LABEL[t]);
    const others = tiers.filter((t) => !GOVERNMENT_TIERS.includes(t)).map((t) => TIER_LABEL[t]);
    const join = (list) => (list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);
    if (!governments.length) {
      return others.length
        ? `No order of government decides this. It belongs to ${join(others)}.`
        : 'Nothing in the pack decides this.';
    }
    const head = governments.length === 1
      ? `One government decides this, ${named[0]}.`
      : `${governments.length === 2 ? 'Two' : 'Three'} governments have to agree: ${join(named)}.`;
    return others.length ? `${head} ${join(others).replace(/^./, (c) => c.toUpperCase())} as well.` : head;
  }

  /** The whole pack reduced to a split, once, at init. Published so screens can print it. */
  function countReach() {
    const byGovernments = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const byTier = {};
    for (const lv of pack.levers || []) {
      const r = reachOf(lv);
      if (!r) continue;
      byGovernments[r.governmentCount] = (byGovernments[r.governmentCount] || 0) + 1;
      for (const t of r.tiers) byTier[t] = (byTier[t] || 0) + 1;
    }
    state.reach = {
      byGovernments,
      byTier,
      tiers: [...new Set([...INST.values()].map((i) => i.tier))],
      governmentTiers: GOVERNMENT_TIERS.slice(),
      total: (pack.levers || []).length
    };
  }

  function touchesFactory(lv) {
    const set = new Set();
    for (const e of lv.effects || []) set.add(e.target);
    for (const e of lv.side_effects || []) set.add(e.target);
    return (metric) => set.has(metric);
  }

  function buildForm(lv) {
    const touches = touchesFactory(lv);
    const out = [];
    for (const r of FORM_RULES) {
      if (!r.when(lv, touches)) continue;
      out.push({
        id: r.id,
        label: r.label,
        why: r.why,
        weeks: r.weeks,
        cost: r.cost(lv),
        satisfiedByConsultation: !!r.satisfiedByConsultation,
        held: false,
        commissionedDay: null,
        readyDay: null
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ opening a file */

  /**
   * Things happen to this island whether or not the player is involved, which is most of what being
   * on this island is like. Each modelled decision maker runs its own agenda on its own cycle,
   * chooses from the levers it decides, and puts one up. The player finds out from the notification
   * and can consult, object, escalate, or live with it. A civic model where nothing moves unless the
   * player moves it is a menu, not a place.
   */
  function ownAgenda(w, day) {
    const pol = w.read('policy');
    const sent = w.read('sentiment');
    const budget = w.read('budget');
    const heatOf = (issue) => {
      if (!pol || !pol.issues) return 0;
      const i = pol.issues.find((x) => x.id === issue);
      return i ? i.heat : 0;
    };

    // A small island does not get twenty things put to it a year. Three in train at once from the
    // bodies that run the place is already a busy year, and it is enough to keep the player
    // reacting rather than only proposing.
    if (apps.filter((a) => a.open && a.origin === 'agenda').length >= 3) return;

    for (const inst of INST.values()) {
      if (inst.notModelled || inst.cadenceDays <= 0) continue;
      if (inst.id === 'rcc-division-2') continue;   // a representative, not a body with an agenda
      if (inst.fund === 'external' && inst.id !== 'sealink') continue;
      if (day % inst.cadenceDays !== 0) continue;
      if (day - (inst.lastAgendaDay || -999) < inst.cadenceDays * 2) continue;
      if (rng.float() > (inst.fund === 'council-island' ? 0.18 : 0.25)) continue;

      const candidates = [];
      for (const lv of pack.levers || []) {
        if (lv.who_decides[0] !== inst.id) continue;
        if (apps.some((a) => a.open && a.leverId === lv.id)) continue;
        // Nobody brings the same refused thing back to the chamber the following year. They bring
        // it back in three, when the numbers have moved or the councillor has.
        const lastRefusal = refusedRecently.get(lv.id);
        if (lastRefusal != null && day - lastRefusal < 1095) continue;
        const rt = pol && pol.levers ? pol.levers[lv.id] : null;
        if (rt && (rt.status === 'delivering' || rt.status === 'active' || rt.level > 0)) continue;
        // Nobody brings forward something nobody has proposed. modelled_option means this pack
        // invented the framing, and the pack says so.
        let weight = { proposed: 3, under_study: 2, funded: 2.5, contested: 1.2, in_place: 0.5, modelled_option: 0.25 }[lv.status] || 0.3;
        weight += heatOf(lv.issue) * 1.6;
        if (sent && sent.groups) {
          for (const g of lv.who_supports || []) {
            const grp = sent.groups[g];
            if (grp && grp.mood < -0.2) weight += grp.weight * 3;
          }
        }
        const f = budget && budget.funds ? budget.funds[inst.fund] : null;
        if (f && f.availableThisYear != null) {
          const annualised = (lv.cost_aud.capital || 0) / Math.max(1, (lv.lead_time_months || 12) / 12) + (lv.cost_aud.recurring_per_year || 0);
          if (annualised > f.availableThisYear * 2.2) weight *= 0.15;
        }
        if (weight > 0.05) candidates.push({ lv, weight });
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => (a.lv.id < b.lv.id ? -1 : 1));
      const pick = rng.weighted(candidates, (c) => c.weight);
      if (!pick) continue;

      inst.lastAgendaDay = day;
      const app = pursue(w, pick.lv.id, { origin: 'agenda' });
      if (!app) continue;
      // Their own officers, their own studies, their own budget for them.
      for (const f of app.form) f.held = true;
      lodge(w, app);
      note(w, app, `${inst.label} brought this forward itself. Nobody on the island asked for it.`);

      // Councils consult on their own agenda too, and how they do it is the whole question. An
      // online submission period costs the least, reaches the people who are not here, and misses
      // the ones who are working. A hall on a weeknight is the opposite. The body running the
      // process picks the cheap one, and the player gets to watch what that produces.
      if (!inst.notModelled && (pick.lv.cost_aud.capital || 0) > 400000) {
        w.bus.emit('civic:consult-request', {
          leverId: pick.lv.id,
          method: rng.float() < 0.62 ? 'online-submissions' : 'public-meeting',
          noticeDays: 21,
          slot: 'weekday-evening',
          auto: true,
          by: inst.id
        });
      }
      w.bus.emit('civic:agenda', {
        applicationId: app.id, leverId: app.leverId, leverName: app.leverName,
        decider: inst.id, deciderLabel: inst.label,
        text: `${inst.label} has put ${app.leverName} on its own agenda. You did not ask for this and you cannot stop it. You can make a submission.`
      });
    }
  }

  function pursue(w, leverId, opts = {}) {
    const lv = lever(leverId);
    if (!lv) return null;
    if (apps.some((a) => a.leverId === leverId && a.open)) return null;
    const pol = w.read('policy');
    const rt = pol && pol.levers ? pol.levers[leverId] : null;
    if (rt && (rt.status === 'delivering' || rt.status === 'active') && !opts.cease) return null;

    const decider = lv.who_decides[0];
    const inst = INST.get(decider);
    const reach = reachOf(lv);
    const app = {
      id: 'app-' + (++seq),
      leverId,
      leverName: lv.name,
      issue: lv.issue,
      role: lv.player_role,
      decider,
      deciderLabel: inst ? inst.label : decider,
      allDeciders: lv.who_decides.slice(),
      // Carried on the file rather than looked up, so a saved application still knows how far it
      // reaches after a load, and so the in tray can say why it is taking as long as it is.
      governments: reach ? reach.governments.slice() : [],
      reachLabel: reach ? reach.label : '',
      reachPlain: reach ? reach.plain : '',
      fund: inst ? inst.fund : 'external',
      capital: lv.cost_aud.capital || 0,
      recurring: lv.cost_aud.recurring_per_year || 0,
      open: true,
      stage: 'preparing',
      stageLabel: 'Preparing',
      openedDay: dayOf(w),
      stageEndsDay: null,
      form: buildForm(lv),
      infoRequests: 0,
      deferrals: 0,
      escalations: [],
      consultationRan: false,
      conditions: [],
      outcome: null,
      reason: '',
      restsOnPlayerAssumption: false,
      referralId: null,
      origin: opts.origin || 'player',
      history: [{ day: dayOf(w), event: 'opened', detail: opts.origin === 'agenda' ? `${inst ? inst.label : decider} put this up itself.` : `File opened on ${lv.name}.` }],
      cease: !!opts.cease
    };
    apps.push(app);
    w.bus.emit('civic:application', { applicationId: app.id, leverId, stage: 'preparing', decider });
    return app;
  }

  function commission(w, app, itemId) {
    const item = app.form.find((f) => f.id === itemId);
    if (!item || item.held || item.commissionedDay != null) return false;
    const budget = w.read('budget');
    if (item.cost > 0) {
      if (budget && budget.canSpend && !budget.canSpend('council-island', item.cost)) {
        note(w, app, 'no money for ' + item.label.toLowerCase());
        return false;
      }
      w.bus.emit('civic:spend', {
        fund: 'council-island', amount: item.cost,
        reason: `${item.label} for ${app.leverName}`, category: 'studies'
      });
    }
    item.commissionedDay = dayOf(w);
    item.readyDay = dayOf(w) + item.weeks * WEEK;
    note(w, app, `${item.label} commissioned. ${item.weeks} weeks.`);
    return true;
  }

  function lodge(w, app) {
    if (app.stage !== 'preparing') return false;
    const inst = INST.get(app.decider);
    const missing = app.form.filter((f) => !f.held);
    app.stage = 'assessment';
    app.stageLabel = app.role === 'player_advocates' ? 'Lodged and waiting' : 'Under assessment';
    const base = app.role === 'player_advocates' ? 10 * WEEK : 8 * WEEK;
    const heavy = app.capital > 2000000 ? 4 * WEEK : 0;
    // Every extra government is another body that has to see the file, and mostly the file waits
    // while it does. A modelling value, said to be one wherever a player sees it.
    const govs = (app.governments || []).length;
    const crossing = (EXTRA_WEEKS_PER_GOVERNMENT[Math.min(govs, 3)] || 0) * WEEK;
    app.crossingWeeks = crossing / WEEK;
    app.stageEndsDay = dayOf(w) + base + heavy + crossing;
    app.lodgedIncomplete = missing.length;
    state.stats.lodged++;
    note(w, app, missing.length
      ? `Lodged with ${missing.length} item${missing.length > 1 ? 's' : ''} outstanding. The clock runs anyway.`
      : 'Lodged complete.');
    if (crossing > 0) {
      note(w, app, `${app.reachPlain} That adds about ${app.crossingWeeks} weeks to the assessment before anybody has said yes or no, and it is a modelling estimate rather than a measured one.`);
    }
    w.bus.emit('civic:application', { applicationId: app.id, leverId: app.leverId, stage: app.stage, decider: app.decider });
    if (inst) inst.openWithThem++;
    return true;
  }

  function withdraw(w, app, reason) {
    close(w, app, 'withdrawn', reason || 'Withdrawn.');
    state.stats.withdrawn++;
  }

  function note(w, app, text) {
    app.history.push({ day: dayOf(w), event: 'note', detail: text });
    if (app.history.length > 24) app.history.shift();
  }

  /* ------------------------------------------------------------------ the daily pass */

  function dailyPass(w) {
    const day = dayOf(w);

    // Council meeting rhythm. Capital decisions land in a meeting, not on the day you ask.
    const rcc = INST.get('redland-city-council');
    state.nextCouncilMeetingInDays = rcc ? (rcc.cadenceDays - ((day % rcc.cadenceDays))) : 0;

    updatePostures(w);
    ownAgenda(w, day);

    for (const app of apps) {
      if (!app.open) continue;

      // Assessments finishing.
      for (const item of app.form) {
        if (!item.held && item.readyDay != null && day >= item.readyDay) {
          item.held = true;
          note(w, app, `${item.label} received.`);
        }
        if (!item.held && item.satisfiedByConsultation && app.consultationRan) {
          item.held = true;
          note(w, app, `${item.label} satisfied by the consultation.`);
        }
      }

      if (app.stage === 'preparing') {
        continue; // the player decides when to lodge
      }

      if (app.stage === 'assessment' && day >= app.stageEndsDay) {
        const missing = app.form.filter((f) => !f.held);
        if (missing.length && app.infoRequests < 2) {
          app.infoRequests++;
          state.stats.infoRequests++;
          app.stage = 'information-request';
          app.stageLabel = 'Information requested';
          app.stageEndsDay = day + 12 * WEEK;
          note(w, app, `Information request: ${missing.map((m) => m.label.toLowerCase()).join(', ')}. Twelve weeks to answer.`);
          w.bus.emit('civic:info-request', {
            applicationId: app.id, leverId: app.leverId, items: missing.map((m) => m.id),
            text: `${app.deciderLabel} has asked for ${missing.map((m) => m.label.toLowerCase()).join(' and ')} before it will assess ${app.leverName}.`
          });
          nudgeTrust(w, -0.01, `an information request on ${app.leverName} after ${Math.round((day - app.openedDay) / 30)} months`);
          continue;
        }
        // Public notification, for the things a planning scheme would notify.
        if (needsNotification(app) && !app.notified) {
          app.notified = true;
          app.stage = 'notification';
          app.stageLabel = 'Publicly notified';
          app.stageEndsDay = day + 4 * WEEK;
          note(w, app, 'Publicly notified. Submissions are open for four weeks.');
          w.bus.emit('civic:application', {
            applicationId: app.id, leverId: app.leverId, stage: 'notification', decider: app.decider,
            text: `${app.deciderLabel} has publicly notified ${app.leverName}. Submissions close in four weeks.`
          });
          continue;
        }
        toDecisionQueue(w, app, day);
        continue;
      }

      if (app.stage === 'information-request' && day >= app.stageEndsDay) {
        const missing = app.form.filter((f) => !f.held);
        if (missing.length) {
          close(w, app, 'lapsed', `Lapsed. ${missing.map((m) => m.label).join(' and ')} never arrived.`);
          state.stats.refused++;
          continue;
        }
        app.stage = 'assessment';
        app.stageLabel = 'Back under assessment';
        app.stageEndsDay = day + 6 * WEEK;
        note(w, app, 'Information provided. Back in the queue.');
        continue;
      }

      if (app.stage === 'notification' && day >= app.stageEndsDay) {
        toDecisionQueue(w, app, day);
        continue;
      }

      if (app.stage === 'awaiting-decision' && day >= app.stageEndsDay) {
        decide(w, app, day);
        continue;
      }

      if (app.stage === 'referred') {
        // Nothing happens. That is the point. It waits for the player to record an assumption.
        continue;
      }
    }

    // Retire closed applications from the live list.
    for (let i = apps.length - 1; i >= 0; i--) {
      if (!apps[i].open && day - (apps[i].closedDay || 0) > 120) apps.splice(i, 1);
    }

    publish();
  }

  function needsNotification(app) {
    const lv = lever(app.leverId);
    if (!lv) return false;
    if (lv.issue === 'housing' && app.decider === 'redland-city-council') return true;
    if (lv.id === 'koala-habitat-overlay' || lv.id === 'short-stay-letting-registration') return true;
    return (lv.cost_aud.capital || 0) >= 5000000 && app.decider === 'redland-city-council';
  }

  function toDecisionQueue(w, app, day) {
    const inst = INST.get(app.decider);
    if (inst && inst.notModelled) {
      refer(w, app, day);
      return;
    }
    const cadence = inst ? inst.cadenceDays : 90;
    const wait = cadence > 0 ? cadence - (day % cadence) : 0;
    app.stage = 'awaiting-decision';
    app.stageLabel = inst ? `Waiting for ${inst.cadenceLabel}` : 'Waiting';
    app.stageEndsDay = day + wait;
    note(w, app, `Assessment done. Now it waits for ${inst ? inst.cadenceLabel : 'a decision'}.`);
  }

  /* ------------------------------------------------------------------ the referral

  The honest stop. No RNG, no modelled appetite, no simulated position. */

  function refer(w, app, day) {
    const inst = INST.get(app.decider);
    const cited = citedPositions(w, app.leverId);
    const ref = {
      id: 'ref-' + (++seq),
      applicationId: app.id,
      leverId: app.leverId,
      leverName: app.leverName,
      body: app.decider,
      bodyLabel: inst ? inst.label : app.decider,
      openedDay: day,
      openedDate: w.clock.formatDate(),
      status: 'open',
      why: inst ? inst.notModelledWhy : '',
      statement: 'This twin does not model this decision and will not guess at it. data/lore.json records the rule: the twin must not represent a Quandamooka or QYAC view on a policy lever unless QYAC has publicly stated it.',
      capacityNote: inst && inst.capacityNote ? inst.capacityNote : '',
      citedPositions: cited,
      whatYouCanDo: [
        'Leave it pending. Nothing downstream moves, which is the truthful outcome.',
        'Record an assumption that it proceeds, and every effect that follows is labelled as resting on your assumption, not on anybody\'s position.',
        'Record an assumption that it does not, and close the file.'
      ]
    };
    referrals.push(ref);
    app.stage = 'referred';
    app.stageLabel = 'Referred, not modelled';
    app.referralId = ref.id;
    state.stats.referred++;
    note(w, app, `Referred to ${ref.bodyLabel}. This twin stops here.`);
    w.bus.emit('civic:referral', ref);
  }

  /**
   * The only Quandamooka material this project may show, straight out of data/lore.json, with its
   * source and its date, and never generalised past what it says. The anchors are deliberately tight.
   */
  const POSITION_ANCHORS = {
    'pos-sustainability-vision': ['island-reuse-and-repair', 'green-waste-mulched-on-island', 'beach-driving-seasonal-closures', 'vehicle-access-permit-price'],
    'pos-joint-management-funding': ['ranger-program-funding'],
    'pos-economic-transition-funding': ['next-transition-tranche', 'cultural-tourism-investment'],
    'pos-one-mile-infrastructure': ['sewer-network-extension']
  };

  function citedPositions(w, leverId) {
    const lore = w.data && w.data.lore;
    const list = (lore && lore.qyac_public_positions && lore.qyac_public_positions.positions) || [];
    const out = [];
    for (const p of list) {
      const anchored = POSITION_ANCHORS[p.id];
      if (!anchored || !anchored.includes(leverId)) continue;
      out.push({
        id: p.id, topic: p.topic, stated: p.stated, position: p.position,
        source: p.source, currency: p.currency,
        caveat: 'This is a published QYAC statement on a related topic. It is not a position on this application.'
      });
    }
    if (!out.length) {
      out.push({
        id: null,
        position: 'No public QYAC statement on this lever is held by this project.',
        caveat: 'data/lore.json lists what is explicitly unknown, including QYAC\'s current view on visitor caps, camping numbers, short-stay letting, rates policy, the ferry and this project itself.'
      });
    }
    return out;
  }

  function resolveReferral(w, refId, outcome) {
    const ref = referrals.find((r) => r.id === refId && r.status === 'open');
    if (!ref) return false;
    const app = apps.find((a) => a.id === ref.applicationId);
    ref.status = outcome === 'proceeds' ? 'assumed-proceeds' : 'assumed-declined';
    ref.resolvedDay = dayOf(w);
    ref.resolvedDate = w.clock.formatDate();
    ref.label = outcome === 'proceeds'
      ? 'You recorded an assumption that this proceeded. Everything that follows rests on that assumption.'
      : 'You recorded an assumption that this did not proceed.';
    w.bus.emit('civic:referral-resolved', { referralId: refId, leverId: ref.leverId, outcome: ref.status });
    if (!app) return true;
    if (outcome === 'proceeds') {
      app.restsOnPlayerAssumption = true;
      approve(w, app, [], 'Recorded as proceeding on the player\'s own assumption.');
    } else {
      close(w, app, 'not-modelled', 'Closed on the player\'s own assumption that it did not proceed.');
    }
    return true;
  }

  /* ------------------------------------------------------------------ deciding */

  function updatePostures(w) {
    const budget = w.read('budget');
    const sent = w.read('sentiment');
    const pol = w.read('policy');
    const metric = (id) => (pol && pol.metrics && pol.metrics[id] ? pol.metrics[id].value : null);
    const mood = (id) => (sent && sent.moods && sent.moods[id] != null ? sent.moods[id] : null);

    for (const inst of INST.values()) {
      if (inst.notModelled) { inst.appetite = null; continue; }
      let a = 0.45;
      if (inst.fund === 'council-island' || inst.fund === 'redland-water') {
        const head = budget && budget.funds && budget.funds['council-island']
          ? clamp(budget.funds['council-island'].headroomShare, 0, 1) : 0.4;
        a = 0.30 + head * 0.35;
        const cm = mood('council-as-actor');
        if (cm != null) a += cm * 0.18;
        // The Division 2 problem. One councillor, in a division shared with a mainland suburb.
        a -= 0.07;
        inst.constraint = 'Division 2 covers Cleveland on the mainland and the island together, so the island\'s representative also answers to a mainland suburb with far more voters.';
      } else if (inst.fund === 'minjerribah-futures') {
        const sb = metric('state_budget');
        a = 0.28 + (sb != null ? sb * 0.45 : 0.18);
        const sm = mood('state-as-actor');
        if (sm != null) a += sm * 0.2;
        // Every ongoing program the state has picked up on this island is a line somebody in
        // Brisbane has to defend again next year. It does not empty a bank account; it uses up
        // patience, and patience is what the next ask needs.
        const mfFund = budget && budget.funds ? budget.funds['minjerribah-futures'] : null;
        if (mfFund) {
          a -= clamp((mfFund.recurringLoad || 0) / 14000000, 0, 0.15);
          if (mfFund.balance <= 0) a -= 0.12;
        }
        inst.constraint = 'Approved Minjerribah Futures funding rose from $20 million to $39.4 million with $30.6 million spent as at April 2024. A further tranche is a political question, not a budget line.';
      } else if (inst.id === 'sealink' || inst.id === 'stradbroke-flyer') {
        a = 0.35;
        inst.constraint = 'A private operator decides this on commercial grounds. A council or a player can ask.';
      } else if (inst.id === 'private-landowners') {
        a = 0.3;
        inst.constraint = 'Under the shoreline plan, works in the central reach that protect private property are paid for and maintained by the owners of that property.';
      } else if (inst.tier === 'commonwealth') {
        // Not a budget and not a chamber. A competitive national round, or a statutory test.
        // Either way the island is one small place among a great many asking, and being deserving
        // is not the variable.
        a = inst.id === 'dcceew' ? 0.2 : 0.25;
        inst.constraint = inst.id === 'dcceew'
          ? 'The environment minister decides against a statutory test, not against how much the island wants it. Twenty business days to say whether it is a controlled action, and no clock at all on what comes after that.'
          : 'A national program, decided in a competitive round against every other regional place in Australia. Nobody from here is in the room, and most Commonwealth money that does arrive comes through Queensland or the council rather than as a decision about this island.';
      } else if (inst.id === 'community') {
        const vm = mood('volunteers-and-emergency');
        const er = metric('emergency_readiness');
        a = 0.35 + (vm != null ? vm * 0.3 : 0) + (er != null ? (er - 0.5) * 0.3 : 0);
        inst.constraint = 'Some things on this island happen because volunteers do them, or do not happen because nobody is left to.';
      }
      // Asking the same body for five things at once is a real cost.
      a -= clamp(inst.openWithThem * 0.045, 0, 0.22);
      inst.appetite = clamp(a, 0.02, 0.95);
      // Standing drifts back toward neutral. A bad year with the council is not a life sentence,
      // and without this a run of refusals feeds itself into a spiral nothing can climb out of.
      inst.standing += (0.5 - inst.standing) * 0.004;
    }
  }

  function decide(w, app, day) {
    const lv = lever(app.leverId);
    const inst = INST.get(app.decider);
    if (!lv || !inst) { close(w, app, 'refused', 'No decision maker.'); return; }

    const sent = w.read('sentiment');
    const budget = w.read('budget');

    // 1. The public case: who is for it and who is against, weighted by how much civic weight each
    //    group carries and how they are feeling, all of it from the pack's own who_supports lists.
    let forWeight = 0, againstWeight = 0;
    const weightOf = (gid) => {
      if (!sent || !sent.groups || !sent.groups[gid]) return 0.05;
      const g = sent.groups[gid];
      return (g.weight || 0.05) * (1 + Math.abs(g.mood || 0) * 0.6);
    };
    for (const g of lv.who_supports) forWeight += weightOf(g);
    for (const g of lv.who_opposes) againstWeight += weightOf(g);
    const total = forWeight + againstWeight;
    let publicCase = total > 0 ? (forWeight - againstWeight) / total : 0;

    // 2. What the consultation actually found, if one was run.
    const cons = consultResults.get(app.leverId);
    if (cons) {
      publicCase = publicCase * 0.5 + (cons.supportShare - cons.opposeShare) * 0.5;
      // A room that did not look like the people affected is a weak evidence base, and a council
      // lawyer knows it.
      if (cons.gapIndex > 0.45) publicCase *= 0.75;
    }

    // 3. Evidence: is the file actually complete, and did anybody consult.
    const held = app.form.filter((f) => f.held).length;
    const evidence = app.form.length ? held / app.form.length : 1;

    // 4. What it costs the body being asked. Capital is spread across years, so it is measured
    //    against a few years of headroom rather than one, which is how a capital program works and
    //    is the difference between a hard budget and an impossible one.
    let costPressure = 0;
    let brokeReason = null;
    if (inst.fund !== 'external' && budget && budget.funds && budget.funds[inst.fund]) {
      const f = budget.funds[inst.fund];
      const annualised = (app.capital / Math.max(1, lv.lead_time_months / 12)) + app.recurring;
      costPressure = clamp(annualised / Math.max(600000, (f.availableThisYear || 1) * 2.5), 0, 1.1) * 0.34;
      // A finite program with nothing left in it does not approve things. It says come back later.
      if (f.balance <= 0 && (app.capital > 0 || app.recurring > 0) && inst.fund === 'minjerribah-futures') {
        brokeReason = `Refused. The ${f.label} balance is spent. Anything further starts with the next tranche.`;
      }
      // And some things are simply not this body's to fund. A hundred and twenty million dollars is
      // not a line item on an island program, however long you stage it. It needs its own decision
      // somewhere else, and saying so is more useful than pretending a council could approve it.
      const carryingCapacity = Math.max(f.availableThisYear || 0, 250000) * 8;
      if (app.capital > carryingCapacity) {
        brokeReason = `Refused. At ${moneyShort(app.capital)} this is bigger than ${f.label} could carry in eight years of its whole capital program. It needs a separate funding decision, and that is not ${inst.label}'s to make.`;
      }
    } else if (inst.tier === 'commonwealth') {
      // The Commonwealth is not asking whether it pays and it is not asking whether the island can
      // afford it. It is asking whether this beats the other applications, or whether the statute
      // is satisfied. Size barely matters, competition does, and neither is in the island's hands.
      costPressure = 0.18;
    } else if (inst.fund === 'external') {
      // A commercial operator asks one question: does this pay.
      const revenueish = (lv.effects || []).some((e) => ['visitor_volume', 'day_visitor_share', 'campground_revenue', 'business_viability'].includes(e.target) && e.magnitude > 0);
      costPressure = (app.recurring > 0 ? 0.4 : 0.1) - (revenueish ? 0.2 : 0);
    }

    // 5. Escalation. Media raises the pressure and lowers the welcome.
    let pressure = 0;
    for (const e of app.escalations) {
      if (e.how === 'petition') pressure += 0.08;
      if (e.how === 'deputation') pressure += 0.06;
      if (e.how === 'media') pressure += 0.12;
    }

    // 6. Whose idea was it. A body that put something on its own agenda has already decided it
    //    wants it; the meeting is where it gets minuted. An application from outside starts from
    //    considerably further back, which is the whole difference between being in the room and
    //    writing to the room.
    const ownIdea = app.origin === 'agenda' ? 1 : 0.35;

    const score = clamp(
      inst.appetite * 0.30 +
      ((publicCase + 1) / 2) * 0.24 +
      evidence * 0.18 +
      inst.standing * 0.10 +
      ownIdea * 0.18 +
      pressure -
      costPressure +
      rng.normal(0, 0.05),
      0, 1
    );

    const conditions = buildConditions(w, app, lv, publicCase, score);

    if (brokeReason) {
      close(w, app, 'refused', brokeReason);
      state.stats.refused++;
      inst.decisionsMade++;
      inst.lastDecisionDay = day;
      inst.openWithThem = Math.max(0, inst.openWithThem - 1);
      return;
    }

    if (score >= 0.60) {
      approve(w, app, [], 'Approved.');
    } else if (score >= 0.44) {
      approve(w, app, conditions, conditions.length ? 'Approved subject to conditions.' : 'Approved, narrowly.');
    } else if (score >= 0.32 && app.deferrals < 2) {
      app.deferrals = (app.deferrals || 0) + 1;
      app.stage = 'assessment';
      app.stageLabel = 'Deferred';
      app.stageEndsDay = day + Math.round(inst.cadenceDays * 1.5);
      state.stats.deferred++;
      note(w, app, deferralReason(app, evidence, costPressure, publicCase));
      w.bus.emit('civic:decision', { applicationId: app.id, leverId: app.leverId, outcome: 'deferred', decider: app.decider, reason: app.history[app.history.length - 1].detail });
      nudgeTrust(w, -0.012, `${app.leverName} deferred`);
    } else {
      const reason = refusalReason(app, evidence, costPressure, publicCase, inst);
      close(w, app, 'refused', reason);
      state.stats.refused++;
      // Only the player's own applications cost the player standing. Being refused something you
      // never asked for is not a mark against you.
      if (app.origin !== 'agenda') inst.standing = clamp(inst.standing - 0.02, 0, 1);
    }
    inst.decisionsMade++;
    inst.lastDecisionDay = day;
    inst.openWithThem = Math.max(0, inst.openWithThem - 1);
  }

  function deferralReason(app, evidence, costPressure, publicCase) {
    if (evidence < 0.7) return 'Deferred for further information. The file was thin.';
    if (costPressure > 0.3) return 'Deferred pending the next budget. The money is not there this year.';
    if (publicCase < -0.1) return 'Deferred. The submissions ran against it and nobody wanted to carry it into an election year.';
    return 'Deferred to a future meeting.';
  }

  function refusalReason(app, evidence, costPressure, publicCase, inst) {
    if (inst.tier === 'commonwealth') {
      return inst.id === 'dcceew'
        ? 'Refused. The Commonwealth was not satisfied on the statutory test, and nothing about how much the island wanted it was part of that question.'
        : 'Unsuccessful. It went into a national round against every other regional place in Australia and did not come out of it. You can apply again next round.';
    }
    if (inst.fund === 'external' && costPressure > 0.2) return `Declined. ${inst.label} is a commercial operator and the numbers did not work.`;
    if (evidence < 0.5) return 'Refused. The application was never complete.';
    if (costPressure > 0.35) return 'Refused. It creates an ongoing cost with no ongoing funding.';
    if (publicCase < -0.2) return 'Refused. The weight of submissions was against it.';
    if (inst.appetite < 0.3) return `Refused. ${inst.label} has no appetite for it right now.`;
    return 'Refused.';
  }

  /**
   * Conditions are derived from the lever's own recorded side effects and its own recorded
   * opponents. A condition always answers something the pack already said would go wrong.
   */
  function buildConditions(w, app, lv, publicCase, score) {
    const out = [];
    const side = lv.side_effects || [];
    const has = (metric) => side.some((s) => s.target === metric);

    if (has('shorebird_disturbance') || has('dune_condition')) {
      out.push({
        id: 'seasonal-works-restriction',
        label: 'Works outside the shorebird season',
        dampens: ['shorebird_disturbance', 'dune_condition'],
        dampenScale: 0.4,
        leadTimeScale: 1.25,
        because: 'The application\'s own assessment said it would disturb roosting birds.'
      });
    }
    if (has('consultation_trust')) {
      out.push({
        id: 'community-reference-group',
        label: 'A standing community reference group',
        dampens: ['consultation_trust'],
        dampenScale: 0.35,
        addRecurring: 45000,
        leadTimeScale: 1.1,
        because: 'Somebody on the panel had read the last one.'
      });
    }
    // Capital that does not fit is not refused. It is stretched until it does, which is why the
    // three year project takes seven and why nobody can tell you when it will be finished. Sizing
    // this off the actual capital program means the works do not stall halfway through instead.
    const budget = w.read('budget');
    const f = budget && budget.funds ? budget.funds[app.fund] : null;
    if (app.capital > 0 && f && f.availableThisYear > 0 && app.fund !== 'external') {
      const yearsNeeded = app.capital / (f.availableThisYear * 0.7);
      const yearsPlanned = Math.max(0.5, (lv.lead_time_months || 12) / 12);
      if (yearsNeeded > yearsPlanned * 1.1) {
        const scale = clamp(yearsNeeded / yearsPlanned, 1, 3);
        out.push({
          id: 'staged-to-fit',
          label: `Staged over about ${Math.round(yearsPlanned * scale)} years to fit the capital program`,
          leadTimeScale: scale,
          because: `${moneyShort(app.capital)} against a capital program of ${moneyShort(f.availableThisYear)} a year. It gets done, slowly.`
        });
      }
    } else if (app.capital >= 5000000) {
      out.push({
        id: 'staged-delivery',
        label: 'Staged delivery, funded across financial years',
        leadTimeScale: 1.4,
        because: 'The capital does not fit in one year.'
      });
    }
    if (lv.who_opposes.includes('foreshore-landowners') || lv.who_supports.includes('foreshore-landowners')) {
      out.push({
        id: 'owner-contribution',
        label: 'Owners of the protected land contribute and maintain',
        ownerShare: 0.3,
        stallChance: 0.35,
        because: 'Under the shoreline erosion management plan, works in the central reach that protect private property are paid for and maintained by those owners.'
      });
    }
    if (publicCase < 0 && score < 0.5) {
      out.push({
        id: 'review-after-two-years',
        label: 'Reviewed after two years',
        because: 'Half the chamber wanted it refused.'
      });
    }
    return out;
  }

  function approve(w, app, conditions, reason) {
    const inst = INST.get(app.decider);
    app.conditions = conditions || [];
    app.outcome = conditions && conditions.length ? 'approved-with-conditions' : 'approved';
    app.reason = reason;
    if (app.outcome === 'approved-with-conditions') state.stats.withConditions++; else state.stats.approved++;
    if (inst) inst.standing = clamp(inst.standing + 0.03, 0, 1);

    // A capital decision by the council lands in a financial year, not on a Tuesday.
    let startDelayDays = 0;
    if (app.capital >= 250000 && (app.fund === 'council-island' || app.fund === 'redland-water') && !fyCapitalOpen) {
      startDelayDays = daysToNextJuly(w);
      app.conditions.push({ id: 'subject-to-budget', label: 'Subject to the next budget', because: 'The budget for this year was adopted before this was approved.' });
    }

    close(w, app, app.outcome, reason);
    w.bus.emit('civic:decision', {
      applicationId: app.id, leverId: app.leverId, outcome: app.outcome, decider: app.decider,
      reason, conditions: app.conditions.map((c) => c.label),
      restsOnPlayerAssumption: app.restsOnPlayerAssumption
    });

    const lv = lever(app.leverId);
    const ownerCondition = app.conditions.find((c) => c.ownerShare);
    const order = {
      day: dayOf(w) + startDelayDays,
      leverId: app.leverId,
      name: app.leverName,
      fund: app.fund,
      capital: app.capital,
      recurring: app.recurring + app.conditions.reduce((s, c) => s + (c.addRecurring || 0), 0),
      // The conditions stretch the works, so they stretch the drawdown too. A commitment that
      // spends at the un-stretched rate would empty the purse and stall the thing it just funded.
      months: Math.max(1, ((lv && lv.lead_time_months) || 1) * app.conditions.reduce((s, c) => s * (c.leadTimeScale || 1), 1)),
      ownerShare: ownerCondition ? ownerCondition.ownerShare : 0,
      decider: app.decider,
      level: app.cease ? -1 : 1,
      conditions: app.conditions,
      restsOnPlayerAssumption: app.restsOnPlayerAssumption
    };
    if (startDelayDays > 0) pending.push(order);
    else fire(w, order);
  }

  /** Plain data rather than a closure, so a deferred budget start survives a save. */
  function fire(w, o) {
    if (o.ownerShare > 0) {
      w.bus.emit('civic:commitment', {
        leverId: o.leverId + '-owners', name: o.name + ' (owner contribution)',
        fund: 'external', capital: o.capital * o.ownerShare, recurringPerYear: 0,
        months: o.months, decider: 'private-landowners'
      });
    }
    w.bus.emit('civic:commitment', {
      leverId: o.leverId, name: o.name, fund: o.fund,
      capital: o.capital * (1 - o.ownerShare), recurringPerYear: o.recurring,
      months: o.months, decider: o.decider
    });
    w.bus.emit('civic:enact', {
      leverId: o.leverId, level: o.level, conditions: o.conditions,
      restsOnPlayerAssumption: o.restsOnPlayerAssumption
    });
  }

  const pending = [];

  function daysToNextJuly(w) {
    const d = w.clock.date;
    const y = d.getUTCFullYear();
    const target = Date.UTC(d.getUTCMonth() >= 6 ? y + 1 : y, 6, 1) / 86400000;
    return Math.max(1, Math.round(target - (w.clock.epochDay + w.clock.dayIndex)));
  }

  function close(w, app, outcome, reason) {
    app.open = false;
    app.outcome = app.outcome || outcome;
    app.reason = reason;
    app.closedDay = dayOf(w);
    app.stage = 'closed';
    app.stageLabel = outcomeLabel(app.outcome);
    note(w, app, reason);
    state.closed.unshift({
      id: app.id, leverId: app.leverId, leverName: app.leverName, outcome: app.outcome,
      reason, decider: app.deciderLabel, date: w.clock.formatDate(),
      months: +((app.closedDay - app.openedDay) / DAYS_PER_MONTH).toFixed(1),
      conditions: (app.conditions || []).map((c) => c.label),
      restsOnPlayerAssumption: app.restsOnPlayerAssumption
    });
    if (state.closed.length > 30) state.closed.pop();
    const inst = INST.get(app.decider);
    if (inst) inst.openWithThem = Math.max(0, inst.openWithThem - 1);
    if (app.outcome === 'refused' || app.outcome === 'lapsed') refusedRecently.set(app.leverId, app.closedDay);
    if (outcome === 'refused') {
      w.bus.emit('civic:decision', { applicationId: app.id, leverId: app.leverId, outcome: 'refused', decider: app.decider, reason });
    }
  }

  function outcomeLabel(o) {
    return { approved: 'Approved', 'approved-with-conditions': 'Approved with conditions', refused: 'Refused', deferred: 'Deferred', withdrawn: 'Withdrawn', lapsed: 'Lapsed', 'not-modelled': 'Not modelled' }[o] || o;
  }

  function nudgeTrust(w, delta, reason) {
    w.bus.emit('civic:metric-nudge', {
      metric: 'consultation_trust', delta, reason,
      source: 'civic/council.js', halfLifeDays: 400
    });
  }

  /* ------------------------------------------------------------------ escalation */

  function escalate(w, app, how) {
    const day = dayOf(w);
    if (app.escalations.some((e) => e.how === how)) return false;
    const inst = INST.get(app.decider);
    if (how === 'petition') {
      const cons = consultResults.get(app.leverId);
      if (!cons || cons.supportShare < 0.5) { note(w, app, 'A petition with nothing behind it is a list of names.'); return false; }
      app.escalations.push({ how, day });
      note(w, app, 'Petition lodged.');
    } else if (how === 'deputation') {
      app.escalations.push({ how, day });
      // The mainland meeting problem, which is the truest civic fact about this island.
      note(w, app, 'Deputation made in Cleveland. The first boat gets you there, the meeting runs late, and you miss the boat home.');
      w.bus.emit('civic:deputation', {
        leverId: app.leverId,
        text: 'A deputation means a day: the first boat over, a meeting that runs late, and the 3pm home gone. Two islanders came. Neither is a shift worker.'
      });
    } else if (how === 'media') {
      app.escalations.push({ how, day });
      if (inst) inst.standing = clamp(inst.standing - 0.09, 0, 1);
      note(w, app, 'Taken to the paper. It will be read in Cleveland too.');
      w.bus.emit('civic:media', { leverId: app.leverId, leverName: app.leverName });
    } else return false;
    return true;
  }

  /* ------------------------------------------------------------------ read model */

  function publish() {
    state.institutions = {};
    for (const i of INST.values()) {
      state.institutions[i.id] = {
        id: i.id, label: i.label, kind: i.kind, tier: i.tier, role: i.role,
        cadence: i.cadenceLabel, notModelled: i.notModelled, why: i.notModelledWhy,
        appetite: i.appetite == null ? null : +i.appetite.toFixed(3),
        standing: +i.standing.toFixed(3),
        openWithThem: i.openWithThem,
        constraint: i.constraint || '',
        capacityNote: i.capacityNote,
        moneyNote: i.moneyNote || '',
        fund: i.fund,
        source: i.source
      };
    }
    state.applications = apps.filter((a) => a.open).map((a) => ({
      id: a.id, leverId: a.leverId, leverName: a.leverName, issue: a.issue, role: a.role,
      decider: a.decider, deciderLabel: a.deciderLabel, stage: a.stage, stageLabel: a.stageLabel,
      origin: a.origin || 'player',
      governments: (a.governments || []).slice(),
      reachLabel: a.reachLabel || '',
      reachPlain: a.reachPlain || '',
      crossingWeeks: a.crossingWeeks || 0,
      whose: a.origin === 'agenda' ? `${a.deciderLabel} put this up. You did not.` : 'Yours.',
      waitingDays: a.stageEndsDay != null ? Math.max(0, a.stageEndsDay - state.day) : null,
      form: a.form.map((f) => ({
        id: f.id, label: f.label, why: f.why, held: f.held, cost: f.cost, weeks: f.weeks,
        inProgress: !f.held && f.commissionedDay != null,
        satisfiedByConsultation: f.satisfiedByConsultation
      })),
      complete: a.form.every((f) => f.held),
      infoRequests: a.infoRequests,
      escalations: a.escalations.map((e) => e.how),
      referralId: a.referralId,
      consultationRan: a.consultationRan,
      openedMonthsAgo: +((state.day - a.openedDay) / DAYS_PER_MONTH).toFixed(1),
      history: a.history.slice(-6)
    }));
    state.referrals = referrals.filter((r) => r.status === 'open' || (state.day - (r.resolvedDay || 0)) < 200);
    state.inTrayCount = state.applications.length + state.referrals.filter((r) => r.status === 'open').length;
  }

  /* ------------------------------------------------------------------ registration */

  return world.register({
    id: 'council',
    phase: 'civic',
    order: 30,

    init(w) {
      build(w);
      state.day = dayOf(w);

      w.bus.on('ui:intent', (p) => { if (p && typeof p.kind === 'string' && p.kind.startsWith('civic:')) intents.push(p); });
      w.bus.on('civic:consultation-closed', (p) => {
        if (!p || !p.leverId) return;
        consultResults.set(p.leverId, p);
        for (const a of apps) if (a.open && a.leverId === p.leverId) { a.consultationRan = true; note(w, a, `Consultation closed. ${Math.round(p.supportShare * 100)} per cent of those who turned up were in favour, and the room matched the people affected ${Math.round((1 - p.gapIndex) * 100)} per cent.`); }
      });
      w.bus.on('civic:budget-adopted', (p) => { budgetAdoptedDay = dayOf(w); fyCapitalOpen = false; });
      w.bus.on('civic:budget-open', () => { fyCapitalOpen = true; });

      state.reachOf = (leverId) => reachOf(lever(leverId));
      state.whoDecides = (leverId) => {
        const lv = lever(leverId);
        if (!lv) return null;
        const reach = reachOf(lv);
        return {
          leverId,
          role: lv.player_role,
          deciders: lv.who_decides.map((id) => {
            const i = INST.get(id);
            return {
              id, label: i ? i.label : id, tier: i ? i.tier : (TIER_FALLBACK[id] || 'unknown'),
              notModelled: i ? i.notModelled : false, cadence: i ? i.cadenceLabel : ''
            };
          }),
          governments: reach ? reach.governments.slice() : [],
          governmentCount: reach ? reach.governmentCount : 0,
          tiers: reach ? reach.tiers.slice() : [],
          reachLabel: reach ? reach.label : '',
          reachPlain: reach ? reach.plain : '',
          plain: plainWhoDecides(lv)
        };
      };
      state.canPlayer = (leverId) => {
        const lv = lever(leverId);
        return lv ? plainWhoDecides(lv) : null;
      };
      state.applicationCard = (id) => state.applications.find((a) => a.id === id) || null;
    },

    tick(w) {
      if (!state.ready) return;
      state.day = dayOf(w);

      while (intents.length) {
        const it = intents.shift();
        const app = it.applicationId ? apps.find((a) => a.id === it.applicationId) : null;
        switch (it.kind) {
          case 'civic:pursue': pursue(w, it.leverId); break;
          case 'civic:stepup': pursue(w, it.leverId); break;
          case 'civic:cease': {
            // Stopping something the island already does is the one decision that does not need
            // anybody's permission if the island is paying for it.
            const lv = lever(it.leverId);
            const fund = lv ? FUND_OF[lv.who_decides[0]] : 'external';
            if (fund === 'council-island' || fund === 'redland-water') {
              w.bus.emit('civic:cease', { leverId: it.leverId, reason: it.reason || 'Funding withdrawn.' });
            } else {
              pursue(w, it.leverId, { cease: true });
            }
            break;
          }
          case 'civic:commission': if (app) commission(w, app, it.item); break;
          case 'civic:lodge': if (app) lodge(w, app); break;
          case 'civic:withdraw': if (app) withdraw(w, app, it.reason); break;
          case 'civic:escalate': if (app) escalate(w, app, it.how); break;
          case 'civic:assume': resolveReferral(w, it.referralId, it.outcome); break;
          default: break;
        }
      }

      for (let i = pending.length - 1; i >= 0; i--) {
        if (dayOf(w) >= pending[i].day) { const o = pending[i]; pending.splice(i, 1); fire(w, o); }
      }

      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        dailyPass(w);
      }
    },

    describe(w) {
      const open = apps.filter((a) => a.open);
      const byStage = {};
      for (const a of open) byStage[a.stage] = (byStage[a.stage] || 0) + 1;
      const theirs = open.filter((a) => a.origin === 'agenda').length;
      const rcc = INST.get('redland-city-council');
      const qld = INST.get('qld-government');
      // How many of the open files need more than one government. A critic reading a probe should
      // be able to see the fourth tier doing something rather than take a comment's word for it.
      const openByGovernments = {};
      for (const a of open) openByGovernments[(a.governments || []).length] = (openByGovernments[(a.governments || []).length] || 0) + 1;
      return {
        open: open.length,
        theirs,
        byStage,
        leverReach: state.reach.byGovernments,
        openByGovernments,
        commonwealthOpen: open.filter((a) => (a.governments || []).includes('commonwealth')).length,
        referralsOpen: referrals.filter((r) => r.status === 'open').length,
        stats: state.stats,
        appetite: {
          council: rcc && rcc.appetite != null ? +rcc.appetite.toFixed(2) : null,
          state: qld && qld.appetite != null ? +qld.appetite.toFixed(2) : null
        },
        standing: rcc ? +rcc.standing.toFixed(2) : null,
        nextMeeting: state.nextCouncilMeetingInDays
      };
    },

    save(w) {
      return {
        v: 1, seq, lastDay, budgetAdoptedDay, fyCapitalOpen,
        intents: intents.slice(),
        consultResults: [...consultResults.entries()],
        apps: apps.map((a) => ({ ...a, history: a.history.slice(-6) })),
        referrals: referrals.slice(-20),
        inst: [...INST.values()].map((i) => [i.id, i.appetite == null ? null : i.appetite, i.standing, i.openWithThem, i.decisionsMade, i.lastAgendaDay || -999]),
        stats: state.stats,
        pending: pending.slice(),
        refused: [...refusedRecently.entries()]
      };
    },

    load(w, s) {
      if (!s || !state.ready) return;
      seq = s.seq || 0;
      budgetAdoptedDay = s.budgetAdoptedDay != null ? s.budgetAdoptedDay : -9999;
      fyCapitalOpen = s.fyCapitalOpen !== false;
      apps.length = 0;
      for (const a of s.apps || []) apps.push(a);
      referrals.length = 0;
      for (const r of s.referrals || []) referrals.push(r);
      for (const [id, appetite, standing, open, made, lastAgenda] of s.inst || []) {
        const i = INST.get(id);
        if (i) Object.assign(i, { appetite, standing, openWithThem: open, decisionsMade: made, lastAgendaDay: lastAgenda });
      }
      Object.assign(state.stats, s.stats || {});
      pending.length = 0;
      for (const p of s.pending || []) pending.push(p);
      refusedRecently.clear();
      for (const [k, v] of s.refused || []) refusedRecently.set(k, v);
      consultResults.clear();
      for (const [k, v] of s.consultResults || []) consultResults.set(k, v);
      intents.length = 0;
      for (const m of s.intents || []) intents.push(m);
      lastDay = s.lastDay != null ? s.lastDay : -1;
      state.day = dayOf(w);
      const rcc = INST.get('redland-city-council');
      state.nextCouncilMeetingInDays = rcc ? (rcc.cadenceDays - (state.day % rcc.cadenceDays)) : 0;
      publish();
    }
  });

  /**
   * A readable list of names. Four bodies joined by "and" is what a fourth tier of government does
   * to a sentence, and the fix is not to hide the fourth body: it is to name the first two, say how
   * many others there are, and let the who-has-to-agree block underneath carry the full list.
   */
  function nameList(names) {
    if (names.length <= 1) return names[0] || 'nobody';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
  }

  function plainWhoDecides(lv) {
    const names = lv.who_decides.map((id) => (INST.get(id) || {}).label || id);
    const listed = nameList(names);
    const plural = names.length > 1;
    const first = lv.who_decides[0];
    const nm = NOT_MODELLED[first];
    const reach = reachOf(lv);
    // How many governments, said once and up front, because it is the thing that decides how hard
    // this is going to be and a list of names is not.
    const across = reach && reach.governmentCount >= 2
      ? ` ${reach.governmentCount === 3 ? 'Three' : 'Two'} governments have to agree.`
      : '';
    switch (lv.player_role) {
      case 'player_decides':
        return `You can decide this, through ${names[0]}. It still takes a report, a meeting and a budget line.${across}`;
      case 'player_funds':
        return `You can put money to this. ${listed} still ${plural ? 'have' : 'has'} to agree to do it${nm ? ', and this twin does not model that decision' : ''}.${across}`;
      case 'player_advocates':
        return `You cannot do this. ${listed} ${plural ? 'decide' : 'decides'} it. You can prepare a case, consult, and ask${nm ? ', and this twin will not guess at the answer' : ''}.${across}`;
      case 'player_observes':
        return `You can only watch this one. ${listed} ${plural ? 'run' : 'runs'} it on their own schedule.${across}`;
      default:
        return `${listed} ${plural ? 'decide' : 'decides'}.${across}`;
    }
  }
}
