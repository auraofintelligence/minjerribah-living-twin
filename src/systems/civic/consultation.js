// Who turns up, and who does not.
//
// This is the quiet one. Every civic game has an approval rating and none of them has a Tuesday
// evening in a hall at Point Lookout where eleven people came, nine of them retired, about a
// decision that lands hardest on renters who were all at work.
//
// The model has three numbers and the third is the one nobody builds:
//
//   WHO IS AFFECTED   derived from the lever's own effects and each group's derived care vector.
//   WHO TURNS UP      that same group, multiplied by whether they can physically be in that room at
//                     that hour: shift work, the last boat, a five o'clock with small children,
//                     twenty-one kilometres of island road in the dark, and a hall that seats sixty.
//   THE GAP           the total variation between those two distributions. One number, 0 to 1. At
//                     zero the room was the island. At one, the people in the room and the people
//                     who will live with it are different people.
//
// Everything here is modelled and labelled modelled, except the things that are not: the three halls
// are real buildings in data/businesses.json, the distances between the townships are real, the
// Amity Point Progress Association really has wound up so there is no local body left to convene a
// meeting there, and the council chamber really is in Cleveland, on the other side of the water, at
// an hour that no islander on a shift can make and get home from.
//
// Deputations model that last fact directly. You can speak to the chamber. You will spend a day on
// it, two people will come with you, and neither of them works Saturdays.
//
// CULTURAL NOTE. Attendance for `quandamooka-families` is modelled the same way as every other
// group: from size, township and whether people can be in the room. This system does not model QYAC
// engagement, which runs through its own processes as native title holder and joint manager, and it
// does not generate a Quandamooka view on anything. Where a consultation touches a lever QYAC or
// joint management decides, the record says the decision is not this meeting's to make.

const DAYS_PER_MONTH = 30.4375;

/** Real buildings. Capacities are modelled: no published seating figure was found for any of them. */
const VENUES = {
  'dunwich-public-hall': { label: 'Dunwich Public Hall', township: 'dunwich', capacity: 120, hire: 220, note: 'Heritage listed. The natural room when a decision affects the working town.' },
  'point-lookout-community-hall': { label: 'Point Lookout Community Hall', township: 'point-lookout', capacity: 100, hire: 240, note: 'The hall and the library. Where the beach and the gorge get argued about.' },
  'amity-point-public-hall': { label: 'Amity Point Public Hall', township: 'amity-point', capacity: 60, hire: 180, note: 'The only indoor public room in the western township.' },
  online: { label: 'Online', township: null, capacity: 99999, hire: 0, note: 'Reaches the people who are not here, and misses the people with no connection.' },
  'cleveland-chamber': { label: 'The council chamber, Cleveland', township: 'mainland', capacity: 3, hire: 0, note: 'On the mainland, in business hours, on the wrong side of the water.' }
};

const METHODS = {
  'public-meeting': {
    label: 'a public meeting', venueRequired: true, days: 1, staffCost: 2800, notices: 650,
    heat: 1, reach: 1, trustIfDone: 0.05, note: 'The loudest room and the narrowest one.'
  },
  'drop-in-session': {
    label: 'a drop-in session', venueRequired: true, days: 2, staffCost: 3900, notices: 650,
    heat: 0.5, reach: 1.15, trustIfDone: 0.05, note: 'Two afternoons, no microphone, and the quiet people come.'
  },
  'online-submissions': {
    label: 'an online submission period', venueRequired: false, days: 28, staffCost: 900, notices: 400,
    heat: 0.2, reach: 0.8, trustIfDone: 0.03, note: 'Best reach for the people who are not on the island. No heat at all.'
  },
  survey: {
    label: 'a survey', venueRequired: false, days: 21, staffCost: 2400, notices: 500,
    heat: 0.15, reach: 1.4, trustIfDone: 0.02, note: 'Broad and shallow. Good for numbers, useless for the thing somebody wanted to say.'
  },
  deputation: {
    label: 'a deputation to the council', venueRequired: false, days: 1, staffCost: 0, notices: 0,
    heat: 0.4, reach: 0.05, trustIfDone: 0.01, note: 'A day of your life and the 3pm boat home gone.'
  },
  combined: {
    label: 'a meeting and an online period together', venueRequired: true, days: 28, staffCost: 4200, notices: 900,
    heat: 0.9, reach: 1.5, trustIfDone: 0.08,
    note: 'Reaches the most people and moves trust the most. It does not close the gap much: the ones who write in are not the ones who could not come.'
  }
};

const SLOTS = {
  'weekday-day': { label: 'a Wednesday at 10am' },
  'weekday-evening': { label: 'a Wednesday at 5.30pm' },
  saturday: { label: 'a Saturday morning' },
  sunday: { label: 'a Sunday morning' }
};

/**
 * Who can physically be in a room, and when. Modelled. Where a figure lines up with something the
 * group says about itself in data/civic.json, the pack's own words are carried through to the UI in
 * `because`, so a player can check the reasoning rather than take it.
 */
const AVAILABILITY = {
  'long-term-residents': { 'weekday-day': 0.35, 'weekday-evening': 0.80, saturday: 0.60, sunday: 0.50 },
  'quandamooka-families': { 'weekday-day': 0.30, 'weekday-evening': 0.60, saturday: 0.55, sunday: 0.45 },
  'holiday-home-owners': { 'weekday-day': 0.05, 'weekday-evening': 0.05, saturday: 0.35, sunday: 0.30, because: 'Here six to thirty nights a year, and almost none of them a Wednesday.' },
  'renters-and-key-workers': { 'weekday-day': 0.10, 'weekday-evening': 0.12, saturday: 0.15, sunday: 0.40, because: 'The dinner service is at six. Their own list starts with "any long-term rental at all".' },
  'tourism-operators': { 'weekday-day': 0.25, 'weekday-evening': 0.15, saturday: 0.05, sunday: 0.05, because: 'Working, and hardest in exactly the weeks the decisions are about.' },
  'retirees-and-seniors': { 'weekday-day': 0.85, 'weekday-evening': 0.45, saturday: 0.60, sunday: 0.50, because: 'The largest bloc on the island and the most available. Evening driving is the limit.' },
  'young-families-and-school': { 'weekday-day': 0.15, 'weekday-evening': 0.18, saturday: 0.25, sunday: 0.40, because: 'Five to seven is dinner, bath and bed. Saturday morning is sport.' },
  'tradies-and-builders': { 'weekday-day': 0.05, 'weekday-evening': 0.50, saturday: 0.40, sunday: 0.30 },
  'environmental-stewards': { 'weekday-day': 0.50, 'weekday-evening': 0.80, saturday: 0.70, sunday: 0.60 },
  'fishers-and-boaties': { 'weekday-day': 0.30, 'weekday-evening': 0.60, saturday: 0.30, sunday: 0.30 },
  'surf-and-beach-users': { 'weekday-day': 0.25, 'weekday-evening': 0.50, saturday: 0.35, sunday: 0.35 },
  'volunteers-and-emergency': { 'weekday-day': 0.35, 'weekday-evening': 0.55, saturday: 0.40, sunday: 0.35, because: 'Already at three other meetings.' },
  'ferry-commuters': { 'weekday-day': 0.02, 'weekday-evening': 0.35, saturday: 0.50, sunday: 0.45, because: 'On the boat. A 5.30pm start is a meeting they walk into at twenty past six.' },
  'day-visitors': { 'weekday-day': 0, 'weekday-evening': 0, saturday: 0, sunday: 0, because: 'They are about sixty per cent of the visitors and they never come to anything. They vote in Redlands and Brisbane.' },
  campers: { 'weekday-day': 0.02, 'weekday-evening': 0.02, saturday: 0.03, sunday: 0.03, because: 'Nobody notifies a campsite.' },
  'conservation-groups': { 'weekday-day': 0.60, 'weekday-evening': 0.80, saturday: 0.60, sunday: 0.50 },
  'foreshore-landowners': { 'weekday-day': 0.85, 'weekday-evening': 0.92, saturday: 0.85, sunday: 0.80, because: 'Small in number, very high in intensity. Their back fence is the erosion problem.' }
};

/** How likely a person in this group is to write something in, rather than turn up. Modelled. */
const WRITE_RATE = {
  'conservation-groups': 0.22, 'foreshore-landowners': 0.50, 'environmental-stewards': 0.12,
  'holiday-home-owners': 0.09, 'tourism-operators': 0.06, 'long-term-residents': 0.05,
  'retirees-and-seniors': 0.05, 'quandamooka-families': 0.03, 'ferry-commuters': 0.03,
  'fishers-and-boaties': 0.03, 'volunteers-and-emergency': 0.03, 'surf-and-beach-users': 0.025,
  'young-families-and-school': 0.02, 'tradies-and-builders': 0.015, 'renters-and-key-workers': 0.012,
  campers: 0.002, 'day-visitors': 0.0008
};

/** Roughly where each group lives, so a hall twenty-one kilometres away means something. Modelled,
 *  except the Dunwich share for Quandamooka families, which is the census figure: 30.5 per cent of
 *  Dunwich against 16.1 per cent island-wide. */
const TOWNSHIP_MIX = {
  'quandamooka-families': { dunwich: 0.64, 'point-lookout': 0.18, 'amity-point': 0.18 },
  'long-term-residents': { dunwich: 0.34, 'point-lookout': 0.42, 'amity-point': 0.24 },
  'holiday-home-owners': { dunwich: 0.10, 'point-lookout': 0.68, 'amity-point': 0.22 },
  'renters-and-key-workers': { dunwich: 0.48, 'point-lookout': 0.36, 'amity-point': 0.16 },
  'tourism-operators': { dunwich: 0.25, 'point-lookout': 0.62, 'amity-point': 0.13 },
  'retirees-and-seniors': { dunwich: 0.30, 'point-lookout': 0.44, 'amity-point': 0.26 },
  'young-families-and-school': { dunwich: 0.52, 'point-lookout': 0.33, 'amity-point': 0.15 },
  'tradies-and-builders': { dunwich: 0.40, 'point-lookout': 0.36, 'amity-point': 0.24 },
  'environmental-stewards': { dunwich: 0.28, 'point-lookout': 0.50, 'amity-point': 0.22 },
  'fishers-and-boaties': { dunwich: 0.30, 'point-lookout': 0.30, 'amity-point': 0.40 },
  'surf-and-beach-users': { dunwich: 0.12, 'point-lookout': 0.76, 'amity-point': 0.12 },
  'volunteers-and-emergency': { dunwich: 0.38, 'point-lookout': 0.40, 'amity-point': 0.22 },
  'ferry-commuters': { dunwich: 0.55, 'point-lookout': 0.30, 'amity-point': 0.15 },
  'foreshore-landowners': { dunwich: 0, 'point-lookout': 0, 'amity-point': 1 },
  'day-visitors': { dunwich: 0.34, 'point-lookout': 0.5, 'amity-point': 0.16 },
  campers: { dunwich: 0.2, 'point-lookout': 0.6, 'amity-point': 0.2 },
  'conservation-groups': { dunwich: 0.3, 'point-lookout': 0.4, 'amity-point': 0.3 }
};

/** Real road distances between the townships, in kilometres. */
const ROAD_KM = {
  dunwich: { dunwich: 0, 'point-lookout': 21, 'amity-point': 9 },
  'point-lookout': { dunwich: 21, 'point-lookout': 0, 'amity-point': 24 },
  'amity-point': { dunwich: 9, 'point-lookout': 24, 'amity-point': 0 }
};

const TURNOUT_BASE = 0.062;

export function registerConsultation(world) {
  // world.rng.restore() rebuilds the pool with fresh Rng objects rather than mutating the existing
  // ones, so a stream captured at registration is a stale object after a load and quietly draws from
  // a different position in the sequence. Resolve the stream at the point of use. It is a Map lookup.
  const STREAM = 'civic-consultation';
  const rng = {
    float: () => world.rng.stream(STREAM).float(),
    int: (a, b) => world.rng.stream(STREAM).int(a, b),
    bool: (p) => world.rng.stream(STREAM).bool(p),
    pick: (a) => world.rng.stream(STREAM).pick(a),
    normal: (m, s) => world.rng.stream(STREAM).normal(m, s),
    weighted: (items, fn) => world.rng.stream(STREAM).weighted(items, fn)
  };

  const state = world.publish('consultation', {
    ready: false,
    open: [],
    closed: [],
    lastResult: null,
    ifYouCalledOneTonight: null,
    fatigue: 0,
    running12Months: 0,
    methods: {},
    venues: {},
    notes: [],
    preview: () => null,
    resultCard: () => null
  });

  const open = [];
  const closed = [];
  const intents = [];
  const history = [];   // closing days, for fatigue
  let pack = null;
  let lastDay = -1;
  let seq = 0;
  let residents = 2156;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayOf = (w) => w.clock.dayIndex;

  /* ------------------------------------------------------------------ boot */

  function build(w) {
    pack = (w.data && w.data.civic) || null;
    if (!pack) { state.notes.push('data/civic.json missing.'); return; }
    for (const [k, v] of Object.entries(METHODS)) {
      state.methods[k] = { id: k, label: v.label, days: v.days, cost: v.staffCost + v.notices, note: v.note, venueRequired: v.venueRequired };
    }
    for (const [k, v] of Object.entries(VENUES)) {
      state.venues[k] = { id: k, label: v.label, township: v.township, capacity: v.capacity, hire: v.hire, note: v.note };
    }
    state.notes.push('Attendance is modelled from who can be in a room at that hour. The halls, the road distances and the council chamber being in Cleveland are real.');
    state.notes.push('Amity Point has no progress association: it wound up in 2024, so there is no local body left to convene or to spread the word. Notice reaches fewer people there and the model says so.');
    state.ready = true;
    publish(w);
  }

  const leverOf = (id) => (pack.levers || []).find((l) => l.id === id) || null;

  function peopleOf(gid) {
    const g = (pack.interest_groups || []).find((x) => x.id === gid);
    if (!g || !g.size) return 0;
    // The pack's sizes are shares of civic weight rather than headcounts, and it says so. Scaling
    // them by the resident population gives a working number of people and nothing more.
    return g.size * residents;
  }

  /* ------------------------------------------------------------------ who is affected */

  /**
   * Affectedness is derived, not authored: how much of this lever's total effect lands on metrics
   * this group is recorded as caring about. The care vectors themselves come out of the sentiment
   * system, which derives them from the pack's own who_supports and who_opposes lists.
   */
  function affectedness(w, lv) {
    const sent = w.read('sentiment');
    const raw = {};
    let total = 0, peak = 0;
    const all = [...(lv.effects || []), ...(lv.side_effects || [])];
    for (const g of pack.interest_groups || []) {
      if (!g.size) continue;
      let a = 0;
      const care = sent && sent.care ? sent.care[g.id] : null;
      if (care && care.length) {
        for (const e of all) {
          const c = care.find((x) => x.metric === e.target);
          if (c) a += Math.abs(e.magnitude) * c.weight;
        }
      }
      // Being named for or against a lever is itself being affected by it.
      if ((lv.who_supports || []).includes(g.id)) a += 0.30;
      if ((lv.who_opposes || []).includes(g.id)) a += 0.30;
      if (a <= 0) continue;
      raw[g.id] = a;
      total += a;
      if (a > peak) peak = a;
    }
    // Two different numbers, and conflating them is the mistake that makes a consultation model
    // useless. `share` is how the impact divides across the island, and it is what the gap is
    // measured against. `salience` is how much this lever matters to a person in that group, which
    // is what gets them out of the house. A group can be twelve per cent of the impact and still
    // care about it more than anybody.
    const share = {}, salience = {};
    for (const k of Object.keys(raw)) {
      share[k] = raw[k] / (total || 1);
      salience[k] = clamp(raw[k] / (peak || 1), 0, 1);
    }
    return { share, salience };
  }

  /* ------------------------------------------------------------------ who turns up */

  function proximity(gid, venueTownship, slot) {
    if (!venueTownship) return 1;             // online
    if (venueTownship === 'mainland') return 0.02;
    const mix = TOWNSHIP_MIX[gid] || { dunwich: 0.34, 'point-lookout': 0.42, 'amity-point': 0.24 };
    const night = slot === 'weekday-evening';
    let p = 0;
    for (const [t, share] of Object.entries(mix)) {
      const km = (ROAD_KM[t] && ROAD_KM[t][venueTownship] != null) ? ROAD_KM[t][venueTownship] : 20;
      let f = km === 0 ? 1 : km <= 10 ? 0.62 : 0.38;
      if (night && km > 0) f *= 0.72;         // twenty-one kilometres of island road in the dark
      p += share * f;
    }
    return p;
  }

  function noticeFactor(days) {
    if (days >= 28) return 1.05;
    if (days >= 21) return 1;
    if (days >= 14) return 0.88;
    if (days >= 7) return 0.62;
    return 0.4;
  }

  function fatigueFactor() {
    return Math.pow(0.92, state.running12Months);
  }

  function amityNoticeFactor(venueTownship) {
    // The Amity Point Progress Association wound up in 2024. Nobody is left to put it on a board.
    return venueTownship === 'amity-point' ? 0.7 : 1;
  }

  function intensityOf(w, gid) {
    const sent = w.read('sentiment');
    const g = sent && sent.groups ? sent.groups[gid] : null;
    return g && g.intensity ? g.intensity : 1;
  }

  function project(w, c) {
    const lv = leverOf(c.leverId);
    if (!lv) return null;
    const method = METHODS[c.method];
    const venue = VENUES[c.venue] || VENUES.online;
    const affected = affectedness(w, lv);
    const wx = w.read('weather');
    const wet = wx && (wx.rainMmHr || 0) > 1.5 && c.slot === 'weekday-evening' ? 0.8 : 1;

    const rows = {};
    let attendDemand = 0, submissionTotal = 0;
    for (const gid of Object.keys(affected.share).sort()) {
      const people = peopleOf(gid);
      const aff = affected.share[gid];
      const sal = affected.salience[gid];
      const avail = (AVAILABILITY[gid] || {})[c.slot] ?? 0.3;
      const prox = proximity(gid, venue.township, c.slot);
      const intensity = intensityOf(w, gid);

      const attend = c.method === 'online-submissions' || c.method === 'survey'
        ? 0
        : people * sal * avail * prox * TURNOUT_BASE * (0.5 + intensity * 0.6) *
          noticeFactor(c.noticeDays) * fatigueFactor() * amityNoticeFactor(venue.township) * wet * method.reach;

      // A deputation is one person speaking to a chamber. There is no submission period attached to
      // it and pretending otherwise would flatter it.
      const writes = c.method === 'deputation' ? 0
        : people * sal * (WRITE_RATE[gid] ?? 0.02) *
          (c.method === 'online-submissions' || c.method === 'combined' || c.method === 'survey' ? 1.6 : 0.55) *
          noticeFactor(c.noticeDays);

      rows[gid] = {
        affectedShare: aff,
        salience: +sal.toFixed(2),
        wantAttend: attend,
        attended: 0,
        submissions: Math.round(writes),
        availability: avail,
        proximity: +prox.toFixed(2),
        because: (AVAILABILITY[gid] || {}).because || null
      };
      attendDemand += attend;
      submissionTotal += Math.round(writes);
    }

    // The hall only holds so many.
    let turnedAway = 0;
    const cap = venue.capacity;
    const scale = attendDemand > cap ? cap / attendDemand : 1;
    let attended = 0;
    for (const gid of Object.keys(rows)) {
      const got = Math.round(rows[gid].wantAttend * scale);
      rows[gid].attended = got;
      attended += got;
    }
    if (attendDemand > cap) turnedAway = Math.round(attendDemand - attended);

    return { rows, attended, submissions: submissionTotal, turnedAway, affected, lv, venue, method };
  }

  /* ------------------------------------------------------------------ what was said */

  /**
   * Issues raised are never invented. They come out of the lever's own recorded side effects and out
   * of the opposing groups' own recorded angers, both of which are researched fields in the pack.
   */
  function issuesRaised(w, lv, rows) {
    const out = [];
    const sent = w.read('sentiment');
    for (const se of lv.side_effects || []) {
      // Whoever cares most about the metric this side effect lands on is the one who says it.
      let best = null, bestW = 0;
      for (const gid of Object.keys(rows)) {
        if (!rows[gid].attended && !rows[gid].submissions) continue;
        const care = sent && sent.care ? sent.care[gid] : null;
        const c = care && care.find((x) => x.metric === se.target);
        const wgt = c ? c.weight : 0;
        if (wgt > bestW) { bestW = wgt; best = gid; }
      }
      if (!best) continue;
      out.push({
        text: se.description,
        fromGroup: best,
        fromGroupLabel: labelOf(best),
        source: 'data/civic.json levers[].side_effects[].description'
      });
    }
    for (const gid of lv.who_opposes || []) {
      const row = rows[gid];
      if (!row || (!row.attended && !row.submissions)) continue;
      const g = (pack.interest_groups || []).find((x) => x.id === gid);
      if (!g || !g.what_angers_them || !g.what_angers_them.length) continue;
      const pick = g.what_angers_them[rng.int(0, g.what_angers_them.length)];
      out.push({
        text: pick,
        fromGroup: gid,
        fromGroupLabel: g.label,
        source: 'data/civic.json interest_groups[].what_angers_them'
      });
    }
    return out.slice(0, 6);
  }

  function labelOf(gid) {
    const g = (pack.interest_groups || []).find((x) => x.id === gid);
    return g ? g.label : gid;
  }

  /** Support and opposition among the people who actually took part. */
  function stances(w, lv, rows) {
    const sent = w.read('sentiment');
    let forW = 0, againstW = 0, unclearW = 0;
    for (const [gid, row] of Object.entries(rows)) {
      const voice = row.attended + row.submissions * 0.8;
      if (voice <= 0) continue;
      if ((lv.who_supports || []).includes(gid)) { forW += voice; continue; }
      if ((lv.who_opposes || []).includes(gid)) { againstW += voice; continue; }
      // Not listed either way. Derive from whether the lever moves what they care about in the
      // direction they want it moved.
      const care = sent && sent.care ? sent.care[gid] : null;
      let net = 0;
      for (const e of lv.effects || []) {
        const c = care && care.find((x) => x.metric === e.target);
        if (!c) continue;
        net += Math.sign(e.magnitude) * (c.wants === 'up' ? 1 : -1) * c.weight * Math.abs(e.magnitude);
      }
      if (net > 0.02) forW += voice;
      else if (net < -0.02) againstW += voice;
      else unclearW += voice;
    }
    const total = forW + againstW + unclearW || 1;
    return { supportShare: forW / total, opposeShare: againstW / total, unclearShare: unclearW / total };
  }

  /** The number nobody models. Total variation distance between the room and the affected. */
  function representation(rows, attended, submissions) {
    const out = {};
    let gap = 0;
    const voiceTotal = attended + submissions || 1;
    let worstUnder = null, worstOver = null;
    for (const [gid, row] of Object.entries(rows)) {
      const voiceShare = (row.attended + row.submissions) / voiceTotal;
      const ratio = row.affectedShare > 0 ? voiceShare / row.affectedShare : (voiceShare > 0 ? 9 : 1);
      out[gid] = {
        label: labelOf(gid),
        affectedShare: +row.affectedShare.toFixed(3),
        voiceShare: +voiceShare.toFixed(3),
        ratio: +ratio.toFixed(2),
        attended: row.attended,
        submissions: row.submissions,
        couldTheyCome: +row.availability.toFixed(2),
        because: row.because
      };
      gap += Math.abs(voiceShare - row.affectedShare);
      if (row.affectedShare > 0.06 && (!worstUnder || ratio < out[worstUnder].ratio)) worstUnder = gid;
      if (voiceShare > 0.06 && (!worstOver || ratio > out[worstOver].ratio)) worstOver = gid;
    }
    return { byGroup: out, gapIndex: +(gap / 2).toFixed(3), worstUnder, worstOver };
  }

  function quietTruth(rep, rows, attended, method) {
    const inTheRoom = method === 'online-submissions' || method === 'survey' ? 'of what came back' : 'of the room';
    if (!rep.worstUnder) return attended ? `${attended} people came.` : 'Nobody was affected enough to say anything.';
    const under = rep.byGroup[rep.worstUnder];
    const overId = rep.worstOver;
    const bits = [];
    bits.push(`${labelOf(rep.worstUnder)} carry ${Math.round(under.affectedShare * 100)} per cent of what this does and were ${Math.round(under.voiceShare * 100)} per cent ${inTheRoom}`);
    if (overId && overId !== rep.worstUnder) {
      const over = rep.byGroup[overId];
      bits.push(`${labelOf(overId)} carry ${Math.round(over.affectedShare * 100)} per cent and were ${Math.round(over.voiceShare * 100)} per cent`);
    }
    const why = under.because ? ` ${under.because}` : '';
    return bits.join('; ') + '.' + why;
  }

  /* ------------------------------------------------------------------ running one */

  function openConsultation(w, req) {
    const lv = leverOf(req.leverId);
    if (!lv) return null;
    if (open.some((c) => c.leverId === req.leverId)) return null;
    // Two consultations on the same thing in the same season is not thoroughness, it is a body that
    // does not read its own file, and it wastes the goodwill of everyone who answered the first one.
    const recent = closed.find((r) => r.leverId === req.leverId && dayOf(w) - r.day < 180);
    if (recent && req.auto) return null;
    const method = METHODS[req.method] || METHODS['public-meeting'];
    let venueId = req.venue;
    if (method.venueRequired && !VENUES[venueId]) venueId = defaultVenue(lv);
    if (!method.venueRequired && req.method !== 'deputation') venueId = 'online';
    if (req.method === 'deputation') venueId = 'cleveland-chamber';
    const venue = VENUES[venueId];
    const cost = method.staffCost + method.notices + (venue ? venue.hire : 0);

    const budget = w.read('budget');
    if (cost > 0 && budget && budget.canSpend && !budget.canSpend('council-island', cost)) {
      w.bus.emit('civic:consultation-refused', { leverId: req.leverId, reason: 'There is no money in the island program for it.' });
      return null;
    }
    if (cost > 0) w.bus.emit('civic:spend', { fund: 'council-island', amount: cost, reason: `Consultation on ${lv.name}`, category: 'consultation' });

    const c = {
      id: 'con-' + (++seq),
      leverId: req.leverId,
      leverName: lv.name,
      issue: lv.issue,
      method: req.method in METHODS ? req.method : 'public-meeting',
      methodLabel: method.label,
      venue: venueId,
      venueLabel: venue ? venue.label : 'Online',
      slot: SLOTS[req.slot] ? req.slot : 'weekday-evening',
      noticeDays: req.noticeDays != null ? req.noticeDays : 21,
      openedDay: dayOf(w),
      // Notice first, then the event, then the record closes.
      eventDay: dayOf(w) + (req.noticeDays != null ? req.noticeDays : 21),
      closesDay: dayOf(w) + (req.noticeDays != null ? req.noticeDays : 21) + method.days,
      cost,
      auto: !!req.auto,
      decisionNotOurs: lv.who_decides.some((d) => ['qyac', 'minjerribah-camping', 'joint-management'].includes(d))
    };
    c.whenLabel = SLOTS[c.slot].label;
    open.push(c);
    w.bus.emit('civic:consultation-opened', {
      id: c.id, leverId: c.leverId, leverName: c.leverName, method: c.method, methodLabel: c.methodLabel,
      venue: c.venue, venueLabel: c.venueLabel, whenLabel: c.whenLabel, noticeDays: c.noticeDays, cost
    });
    if (c.noticeDays < 14) {
      w.bus.emit('civic:metric-nudge', {
        metric: 'consultation_trust', delta: -0.03,
        reason: `${c.noticeDays} days notice on ${c.leverName}`,
        source: 'civic/consultation.js', halfLifeDays: 300
      });
    }
    return c;
  }

  function defaultVenue(lv) {
    if (lv.issue === 'amity-erosion') return 'amity-point-public-hall';
    if (['visitors-versus-amenity', 'beach-driving', 'coast-and-dunes'].includes(lv.issue)) return 'point-lookout-community-hall';
    return 'dunwich-public-hall';
  }

  function closeConsultation(w, c) {
    const p = project(w, c);
    if (!p) return;
    const rep = representation(p.rows, p.attended, p.submissions);
    const st = stances(w, p.lv, p.rows);
    const issues = issuesRaised(w, p.lv, p.rows);

    const result = {
      id: c.id,
      leverId: c.leverId,
      leverName: c.leverName,
      issue: c.issue,
      method: c.method,
      methodLabel: c.methodLabel,
      venue: c.venue,
      venueLabel: c.venueLabel,
      whenLabel: c.whenLabel,
      noticeDays: c.noticeDays,
      date: w.clock.formatDate(),
      day: dayOf(w),
      attended: p.attended,
      submissions: p.submissions,
      turnedAway: p.turnedAway,
      capacity: p.venue.capacity,
      cost: c.cost,
      supportShare: +st.supportShare.toFixed(3),
      opposeShare: +st.opposeShare.toFixed(3),
      unclearShare: +st.unclearShare.toFixed(3),
      gapIndex: rep.gapIndex,
      byGroup: rep.byGroup,
      worstUnder: rep.worstUnder,
      worstOver: rep.worstOver,
      quietTruth: quietTruth(rep, p.rows, p.attended, c.method),
      issuesRaised: issues,
      decisionNotOurs: c.decisionNotOurs,
      notOursNote: c.decisionNotOurs
        ? 'Whatever was said in this room, this decision is not the island\'s to make. It sits with QYAC or with joint management, and this twin does not model that decision.'
        : null
    };

    closed.unshift(result);
    if (closed.length > 20) closed.pop();
    history.push(dayOf(w));
    state.lastResult = result;

    // Trust moves on whether the process was real, not on whether the outcome was liked.
    const m = METHODS[c.method];
    let trust = m.trustIfDone;
    if (rep.gapIndex > 0.5) trust -= 0.05;
    if (p.turnedAway > 10) trust -= 0.03;
    if (c.method === 'combined') trust += 0.02;
    w.bus.emit('civic:metric-nudge', {
      metric: 'consultation_trust', delta: trust,
      reason: `${c.methodLabel} on ${c.leverName}: ${p.attended} came, ${p.submissions} wrote in`,
      source: 'civic/consultation.js', halfLifeDays: 420
    });

    w.bus.emit('civic:consultation-closed', result);
    publish(w);
  }

  /* ------------------------------------------------------------------ read model */

  /**
   * What a meeting would look like if you called one tonight, on whatever is most live. This is the
   * useful half of a consultation model: not the record of the last one, but the shape of the next.
   * It is also what makes the gap actionable rather than only sad, because a player can move the
   * night, move the hall, and watch who that lets in and who it shuts out.
   */
  function refreshStandingPreview(w) {
    const cou = w.read('council');
    const pol = w.read('policy');
    let leverId = null;
    if (cou && cou.applications && cou.applications.length) {
      const live = cou.applications.filter((a) => a.stage !== 'closed' && !open.some((c) => c.leverId === a.leverId));
      if (live.length) leverId = live[0].leverId;
    }
    if (!leverId && pol && pol.issues) {
      const hot = pol.issues.filter((i) => i.levers.length).sort((a, b) => b.heat - a.heat || (a.id < b.id ? -1 : 1))[0];
      if (hot) leverId = hot.levers[0];
    }
    if (!leverId) { state.ifYouCalledOneTonight = null; return; }
    const lv = leverOf(leverId);
    if (!lv) { state.ifYouCalledOneTonight = null; return; }
    const venue = defaultVenue(lv);
    const options = [];
    for (const slot of ['weekday-evening', 'saturday', 'sunday']) {
      const p = project(w, { leverId, method: 'public-meeting', venue, slot, noticeDays: 21 });
      if (!p) continue;
      const rep = representation(p.rows, p.attended, p.submissions);
      options.push({ slot, when: SLOTS[slot].label, attendance: p.attended, gapIndex: rep.gapIndex, worstUnder: rep.worstUnder });
    }
    if (!options.length) { state.ifYouCalledOneTonight = null; return; }
    const fairest = options.reduce((a, b) => (a.gapIndex <= b.gapIndex ? a : b));
    state.ifYouCalledOneTonight = {
      leverId,
      leverName: lv.name,
      venue: VENUES[venue].label,
      options,
      fairestSlot: fairest.slot,
      line: `A meeting on ${options[0].when} at ${VENUES[venue].label} about ${lv.name.toLowerCase()} would bring about ${options[0].attendance} people. ${fairest.slot === options[0].slot ? 'That is the fairest night you have.' : `${SLOTS[fairest.slot].label.replace(/^a /, 'A ')} would look more like the island.`}`
    };
  }

  function publish(w) {
    const day = dayOf(w);
    for (let i = history.length - 1; i >= 0; i--) if (day - history[i] > 365) history.splice(i, 1);
    state.running12Months = history.length;
    state.fatigue = +(1 - fatigueFactor()).toFixed(3);
    state.open = open.map((c) => ({
      id: c.id, leverId: c.leverId, leverName: c.leverName, methodLabel: c.methodLabel,
      venueLabel: c.venueLabel, whenLabel: c.whenLabel,
      daysToEvent: Math.max(0, c.eventDay - day), daysToClose: Math.max(0, c.closesDay - day),
      cost: c.cost, auto: c.auto, decisionNotOurs: c.decisionNotOurs
    }));
    state.closed = closed.map((r) => ({
      id: r.id, leverId: r.leverId, leverName: r.leverName, date: r.date, methodLabel: r.methodLabel,
      venueLabel: r.venueLabel, attended: r.attended, submissions: r.submissions, turnedAway: r.turnedAway,
      gapIndex: r.gapIndex, supportShare: r.supportShare, opposeShare: r.opposeShare,
      quietTruth: r.quietTruth, issuesRaised: r.issuesRaised, byGroup: r.byGroup,
      worstUnder: r.worstUnder, worstOver: r.worstOver, decisionNotOurs: r.decisionNotOurs,
      notOursNote: r.notOursNote
    }));
  }

  /* ------------------------------------------------------------------ registration */

  return world.register({
    id: 'consultation',
    phase: 'civic',
    order: 40,

    init(w) {
      build(w);
      const pop = w.read('population');
      if (pop && pop.residents) residents = pop.residents;

      w.bus.on('ui:intent', (p) => { if (p && p.kind === 'civic:consult') intents.push(p); });

      // A publicly notified application gets a submission period whether anybody asked for one.
      w.bus.on('civic:application', (p) => {
        if (!p || p.stage !== 'notification') return;
        if (open.some((c) => c.leverId === p.leverId)) return;
        intents.push({ kind: 'civic:consult', leverId: p.leverId, method: 'online-submissions', noticeDays: 21, auto: true });
      });
      // And the bodies that run the island consult on their own agenda, in their own way.
      w.bus.on('civic:consult-request', (p) => {
        if (!p || !p.leverId) return;
        if (open.some((c) => c.leverId === p.leverId)) return;
        intents.push({ kind: 'civic:consult', ...p });
      });

      state.preview = (leverId, method, venue, slot, noticeDays) => {
        const lv = leverOf(leverId);
        if (!lv) return null;
        const c = {
          leverId, method: method in METHODS ? method : 'public-meeting',
          venue: venue || defaultVenue(lv), slot: slot || 'weekday-evening',
          noticeDays: noticeDays != null ? noticeDays : 21
        };
        const p = project(w, c);
        if (!p) return null;
        const rep = representation(p.rows, p.attended, p.submissions);
        return {
          expectedAttendance: p.attended,
          expectedSubmissions: p.submissions,
          turnedAway: p.turnedAway,
          venue: p.venue.label,
          capacity: p.venue.capacity,
          cost: METHODS[c.method].staffCost + METHODS[c.method].notices + (VENUES[c.venue] ? VENUES[c.venue].hire : 0),
          gapIndex: rep.gapIndex,
          quietTruth: quietTruth(rep, p.rows, p.attended, c.method),
          byGroup: rep.byGroup
        };
      };
      state.resultCard = (id) => closed.find((r) => r.id === id) || null;
    },

    tick(w) {
      if (!state.ready) return;
      while (intents.length) {
        const it = intents.shift();
        openConsultation(w, it);
      }
      if (w.clock.dayIndex !== lastDay) {
        lastDay = w.clock.dayIndex;
        const day = dayOf(w);
        const pop = w.read('population');
        if (pop && pop.residents) residents = pop.residents;
        for (let i = open.length - 1; i >= 0; i--) {
          if (day >= open[i].closesDay) {
            const c = open[i];
            open.splice(i, 1);
            closeConsultation(w, c);
          }
        }
        // Weekly, not daily: projecting a meeting means walking every group and every effect, and
        // nothing about it changes between a Tuesday and a Wednesday.
        if (day % 7 === 0 || !state.ifYouCalledOneTonight) refreshStandingPreview(w);
        publish(w);
      }
    },

    describe(w) {
      const last = state.lastResult;
      const nx = state.ifYouCalledOneTonight;
      return {
        open: open.length,
        closed: closed.length,
        inLast12Months: state.running12Months,
        fatigue: state.fatigue,
        ifCalledTonight: nx ? { lever: nx.leverId, would: nx.options[0].attendance, gap: nx.options[0].gapIndex, fairest: nx.fairestSlot } : null,
        last: last ? {
          lever: last.leverId,
          attended: last.attended,
          submissions: last.submissions,
          gap: last.gapIndex,
          support: last.supportShare,
          under: last.worstUnder
        } : null
      };
    },

    save() {
      return { v: 1, seq, lastDay, residents, intents: intents.slice(), open: open.slice(), closed: closed.slice(0, 8), history: history.slice() };
    },

    load(w, s) {
      if (!s || !state.ready) return;
      seq = s.seq || 0;
      open.length = 0;
      for (const c of s.open || []) open.push(c);
      closed.length = 0;
      for (const r of s.closed || []) closed.push(r);
      history.length = 0;
      for (const d of s.history || []) history.push(d);
      if (s.residents) residents = s.residents;
      intents.length = 0;
      for (const m of s.intents || []) intents.push(m);
      state.lastResult = closed[0] || null;
      lastDay = s.lastDay != null ? s.lastDay : -1;
      publish(w);
    }
  });
}
