// Shared vocabulary for the six economy systems. NOT a system: it exports no `registerXxx`, so the
// manifest loader will never register it. It exists for the same reason src/systems/agents/calendar.js
// exists: six files that have to agree on what a cafe is should agree in one place rather than six.
//
// Everything in here is either read straight out of a data pack or is a modelling constant with its
// basis written beside it. Nothing here is a measured trading figure for any real business, because
// no such figure is published for any business on this island. data/businesses.json says so in its own
// honesty block: "All employs figures and all peak_multiplier_estimate figures are modelling estimates
// for the simulation, not measured headcounts or measured trade data."
//
// Money is A$ throughout. Australian English throughout.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round2 = (v) => Math.round(v * 100) / 100;
export const round0 = (v) => Math.round(v);

/** A$ with no decimals, for a read model a panel can print without formatting it again. */
export function aud(v) {
  const n = Math.round(v);
  return 'A$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ------------------------------------------------------------------ sectors

Eighty-one distinct `type` slugs appear in data/businesses.json across 101 records. Classifying by
regular expression rather than by an exhaustive table is deliberate: if the pack gains a business
type nobody thought of, it lands in `services` and keeps trading, instead of vanishing from the
island because a lookup missed. */

export const SECTORS = [
  'hospitality',   // pubs, clubs, cafes, restaurants, takeaways, the brewery, the vans
  'grocery',       // supermarkets, the general stores, the butcher, the bottle shop, seafood
  'accommodation', // resorts, apartments, the hostel, the campgrounds
  'fuel',          // the two servos and the general dealers, which are also shops
  'retail',        // gifts, homewares, art, the sporting goods shop
  'tours',         // 4WD, cultural, surf and dive, scooter hire
  'letting',       // the real estate and holiday letting agents
  'transport',     // the ferry operator, the water taxi, the buses, the cab, the transfers
  'health',        // the clinic, the two pharmacies, the health service, aged care
  'education',     // the school
  'emergency',     // ambulance, police, rural fire, marine rescue, wildlife rescue
  'civic',         // council, the waste centre, the housing provider
  'community'      // QYAC, QUAMPI, MMEIC, the halls, the clubs, the museum, the market, landcare
];

/**
 * Sector for a data/businesses.json `type` slug. Order matters: the first match wins, so
 * 'fuel-grocery-takeaway' is fuel first and a shop second, which is how a roadhouse actually trades.
 */
export function sectorOf(type) {
  const t = String(type || '');
  if (/^emergency-service|wildlife-rescue/.test(t)) return 'emergency';
  if (/^local-government|council-waste|housing-provider/.test(t)) return 'civic';
  if (/school/.test(t)) return 'education';
  if (/pharmacy|gp-clinic|health|aged-care|veterinary/.test(t)) return 'health';
  if (/ferry-operator|water-taxi|bus-operator|taxi-operator|transfer-operator/.test(t)) return 'transport';
  if (/real-estate|holiday-letting/.test(t)) return 'letting';
  if (/fuel/.test(t)) return 'fuel';
  // Anchored, and the anchor matters: `hotel-pub-accommodation` contains the word accommodation,
  // so an unanchored test classified the island's biggest pub as a resort and gave it a resort's
  // sixteen per cent cost of sales. It has 28 rooms and it is still a pub. One sector per business
  // is a limitation of this model; where a business is two things, it is filed as the one that
  // decides how it trades.
  if (/^accommodation|hostel|resort|^camping-operator/.test(t)) return 'accommodation';
  if (/tour-operator|surf-school|walking-tour|vehicle-hire|dive/.test(t)) return 'tours';
  if (/hotel-pub|tavern|club-bistro|community-club|sports-club-licensed|restaurant|cafe|bakery|takeaway|gelato|coffee|juice|food-van|brewery|wine-bar/.test(t)) return 'hospitality';
  if (/grocery|convenience|general-store|butcher|bottle-shop|seafood-retail/.test(t)) return 'grocery';
  if (/gift|homewares|art-retail|art-gallery|artist|outdoor-sporting|market/.test(t)) return 'retail';
  if (/traditional-owner|elders|arts-and-culture|museum|business-association|community-hall|community-association|landcare|environmental|surf-life-saving|fishing-club|golf-club|sports-and-culture/.test(t)) return 'community';
  return 'services';
}

/**
 * Which sectors sell to a walk-in customer for money. The rest are employers and service providers:
 * they have staff, hours and a service level, and they do not have a till. `community` is in the
 * list because the bowls club, the golf club, the museum and the market all take money over a
 * counter and all carry a price band in the pack; the halls and the volunteer bodies inside that
 * sector carry a band of `free` or `n/a` and so never trade. `letting`, `transport`, `education`,
 * `emergency` and `civic` never trade here: the letting agents' commission is housing.js's, the
 * fares are tourism.js's, and the rest are funded rather than sold.
 */
export const TRADING_SECTORS = new Set(['hospitality', 'grocery', 'accommodation', 'fuel', 'retail', 'tours', 'health', 'community']);

/* ------------------------------------------------------------------ the household basket

The categories a dollar can land in. Every demand figure in tourism.js and businesses.js is expressed
in one of these, which is the only reason the two systems can be read against each other. */

export const CATEGORIES = ['groceries', 'hospitality', 'fuel', 'retail', 'tours', 'accommodation', 'health'];

/** Which sectors can serve a category. A roadhouse sells fuel, food and a pie: it is in three. */
export const CATEGORY_SECTORS = {
  groceries: ['grocery', 'fuel'],
  hospitality: ['hospitality', 'fuel', 'community'],
  fuel: ['fuel'],
  retail: ['retail', 'grocery', 'community'],
  tours: ['tours', 'community'],
  accommodation: ['accommodation'],
  health: ['health']
};

/**
 * Mean ticket in A$ by the pack's own price band. Modelled. The bands in data/businesses.json are
 * explicitly relative ("free | $ | $$ | $$$ | n/a, relative in A$") and carry no dollar value, so
 * these are the dollar values this simulation gives them, and nothing more.
 */
export const BAND_TICKET = { free: 0, $: 15, $$: 36, $$$: 78, 'n/a': 0 };

/** How much of a ticket is the cost of the thing sold, before freight. Modelled, by sector. */
export const COST_OF_SALES = {
  hospitality: 0.34, grocery: 0.72, accommodation: 0.22, fuel: 0.80,
  retail: 0.52, tours: 0.24, letting: 0.10, health: 0.62, community: 0.38, services: 0.3
};

/**
 * Fixed costs are not the same shape in every sector. A resort's rates, insurance, mortgage and
 * grounds do not care whether anybody stayed last night; a coffee van's do not exist. The multiplier
 * applies to the per-scale daily overhead in businesses.js. Modelled.
 */
export const OVERHEAD_MULTIPLIER = {
  accommodation: 2.6, tours: 1.4, hospitality: 1.2, health: 1.2, retail: 1.1,
  grocery: 1.0, community: 1.0, fuel: 0.9, letting: 1.0, services: 1.0
};

/* ------------------------------------------------------------------ hours

data/businesses.json typical_hours: a `basis` plus mon..sun, each 'HH:MM-HH:MM', 'closed',
'unverified' or '24h'. Basis is 'estimate' on nearly every record, and the pack is explicit that
estimated hours must never be shown to a player as fact, so `basis` travels with the parsed hours
all the way to the read model. */

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'HH:MM' to minutes past midnight. Returns null on anything that is not a time. */
export function mins(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Parse one weekday's entry into {open, close, kind}. `close` may exceed 1440 when a venue trades
 * past midnight, which the pub does on Friday and Saturday ('11:00-00:00'). A midnight close read
 * literally is a zero-minute trading day, and the pub is the island's biggest evening venue.
 */
export function parseDay(entry) {
  const s = String(entry || '').trim().toLowerCase();
  if (!s || s === 'closed') return { open: 0, close: 0, kind: 'closed' };
  if (s === '24h') return { open: 0, close: 1440, kind: '24h' };
  if (s === 'unverified') return { open: null, close: null, kind: 'unverified' };
  const parts = s.split('-');
  if (parts.length !== 2) return { open: null, close: null, kind: 'unverified' };
  const a = mins(parts[0]), b = mins(parts[1]);
  if (a == null || b == null) return { open: null, close: null, kind: 'unverified' };
  return { open: a, close: b <= a ? b + 1440 : b, kind: 'published' };
}

/** All seven days, plus the basis the pack recorded. */
export function parseHours(typical) {
  const basis = (typical && typical.basis) || 'unstated';
  const days = [];
  let unverified = 0;
  for (let d = 0; d < 7; d++) {
    const parsed = parseDay(typical ? typical[DOW_KEYS[d]] : null);
    if (parsed.kind === 'unverified') unverified++;
    days.push(parsed);
  }
  return { basis, days, unverified };
}

/** Is this venue trading at `minute` on weekday `dow`? Handles the after-midnight tail. */
export function openAt(hours, dow, minute) {
  if (!hours) return false;
  const today = hours.days[dow];
  if (today && today.open != null && minute >= today.open && minute < today.close) return true;
  // A venue that closed at 01:00 is still open at 00:30 on the following day.
  const yest = hours.days[(dow + 6) % 7];
  if (yest && yest.open != null && yest.close > 1440 && minute < yest.close - 1440) return true;
  return false;
}

/* ------------------------------------------------------------------ the shape of a day

Where the money lands hour by hour. Twenty-four weights per category, normalised by the caller.
Modelled from the hour_by_hour blocks in data/residents.json visitor_archetypes and from the
published trading hours in data/businesses.json, not from any transaction data, because there is
none. The shapes matter more than the levels: a pub that takes its money at eleven in the morning
would be wrong about this island in a way a player would feel. */

export const HOUR_CURVE = {
  //          0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  groceries: [0, 0, 0, 0, 0, 0, 1, 3, 6, 9, 10, 10, 9, 8, 9, 11, 12, 10, 6, 3, 1, 0, 0, 0],
  hospitality: [1, 0, 0, 0, 0, 0, 1, 4, 8, 9, 7, 8, 13, 11, 6, 5, 6, 9, 13, 14, 10, 6, 3, 2],
  fuel: [0, 0, 0, 0, 0, 1, 3, 7, 9, 9, 8, 7, 7, 7, 8, 9, 10, 8, 5, 2, 1, 0, 0, 0],
  retail: [0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 11, 12, 12, 11, 11, 10, 8, 5, 2, 1, 0, 0, 0, 0],
  tours: [0, 0, 0, 0, 0, 2, 6, 10, 14, 14, 10, 6, 6, 8, 8, 6, 4, 3, 2, 1, 0, 0, 0, 0],
  accommodation: [0, 0, 0, 0, 0, 0, 0, 1, 3, 6, 9, 8, 6, 8, 12, 14, 13, 10, 6, 3, 1, 0, 0, 0],
  health: [0, 0, 0, 0, 0, 0, 0, 1, 6, 12, 14, 13, 9, 8, 11, 12, 8, 4, 1, 1, 0, 0, 0, 0],
  // Where the cars are, hour by hour, at the Point Lookout headland. Not a spend curve: a parking
  // occupancy curve. Modelled from the hour_by_hour blocks in data/residents.json, which put the
  // gorge walk and the beach between about nine and four, and the dawn surf session before that.
  parking: [1, 1, 1, 1, 1, 2, 5, 8, 12, 16, 19, 20, 19, 19, 18, 16, 12, 8, 5, 3, 2, 1, 1, 1]
};

/**
 * Occupancy shape rather than spend share: the value at this hour as a fraction of the busiest
 * hour, so 1.0 is the peak of the day and 0.05 is five in the morning. Used for anything that is a
 * stock at a moment (cars in bays, people on a boardwalk) rather than a flow over a day.
 */
/* Totals and peaks, computed once at module load rather than on every call. hourWeight() is read
   inside the per-tick allocation loop in businesses.js, up to a couple of hundred times a tick, and
   a twenty-four element sum each time is a lot of arithmetic for a constant. */
const CURVE_TOTAL = {};
const CURVE_MAX = {};
for (const [k, curve] of Object.entries(HOUR_CURVE)) {
  let total = 0, max = 0;
  for (let i = 0; i < 24; i++) { total += curve[i]; if (curve[i] > max) max = curve[i]; }
  CURVE_TOTAL[k] = total;
  CURVE_MAX[k] = max;
}

export function dayShape(category, minute) {
  const key = HOUR_CURVE[category] ? category : 'parking';
  const curve = HOUR_CURVE[key];
  const max = CURVE_MAX[key];
  const h = Math.floor(minute / 60) % 24;
  const next = curve[(h + 1) % 24];
  const f = (minute % 60) / 60;
  return max > 0 ? (curve[h] + (next - curve[h]) * f) / max : 0;
}

/** Normalised weight for one tick of one category. `minute` is minutes past midnight. */
export function hourWeight(category, minute) {
  const key = HOUR_CURVE[category] ? category : 'groceries';
  const total = CURVE_TOTAL[key];
  const h = Math.floor(minute / 60) % 24;
  // One tick is ten sim-minutes, so a tick gets a sixth of its hour.
  return total > 0 ? (HOUR_CURVE[key][h] / total) / 6 : 0;
}

/* ------------------------------------------------------------------ stock

Stock lines and why each one behaves differently. Cover is measured in days of trade at the current
rate, which is how a publican or a shopkeeper actually thinks about it, and it is the number that
makes the long weekend legible: three days of beer cover meeting a peak multiplier of three is one
day of beer.

`freightClass` decides how a replenishment order crosses the bay, and that is not a modelling
choice: data/transport.json structural_facts.walk-on-freight-rides-the-passenger-boat is published.
Small items may ride the passenger ferry unaccompanied at a per-item rate. Anything bulky goes in a
vehicle or a truck on the vehicle deck, and competes with visitor cars for the same finite space. */

export const STOCK_LINES = {
  // Five days of fresh, reordered at three. It looks generous for something that goes off, and it
  // is not: there is no carrier run on a Sunday, so a Friday order that misses the deck is Tuesday's
  // problem, and a shop that keeps only two days of cover is out of milk every second long weekend.
  perishable: { label: 'fresh food', coverDays: 5, reorderAt: 3.5, spoilPerDay: 0.055, freightClass: 'deck', kgPerUnit: 1.1 },
  drink: { label: 'beer, wine and spirits', coverDays: 12, reorderAt: 4.5, spoilPerDay: 0, freightClass: 'deck', kgPerUnit: 1.4 },
  dry: { label: 'packaged goods', coverDays: 21, reorderAt: 8, spoilPerDay: 0, freightClass: 'deck', kgPerUnit: 0.7 },
  frozen: { label: 'frozen goods', coverDays: 18, reorderAt: 7, spoilPerDay: 0.004, freightClass: 'deck', kgPerUnit: 1.2 },
  fuel: { label: 'fuel', coverDays: 9, reorderAt: 3.5, spoilPerDay: 0, freightClass: 'tanker', kgPerUnit: 0.75 },
  linen: { label: 'linen and consumables', coverDays: 10, reorderAt: 4, spoilPerDay: 0, freightClass: 'deck', kgPerUnit: 0.5 },
  dispensary: { label: 'dispensary stock', coverDays: 14, reorderAt: 5, spoilPerDay: 0, freightClass: 'walk-on', kgPerUnit: 0.05 }
};

/** Which lines a sector carries, and how many units one A$ of trade consumes from each. */
export function stockLinesFor(sector, type) {
  const t = String(type || '');
  if (/pharmacy/.test(t)) return { dispensary: 0.02, dry: 0.004 };
  if (sector === 'grocery') return { perishable: 0.016, dry: 0.012, frozen: 0.005, drink: /bottle-shop/.test(t) ? 0.022 : 0.004 };
  if (sector === 'fuel') return { fuel: 0.02, dry: 0.006, perishable: 0.004 };
  if (sector === 'hospitality') {
    // A bottle shop attached to a pub and a bowls club both move a lot more of the drink line than
    // a bakery does. The split follows the licence, which is in the type slug.
    const licensed = /hotel-pub|tavern|club|brewery|wine-bar/.test(t);
    return licensed ? { drink: 0.014, perishable: 0.009, dry: 0.004 } : { perishable: 0.014, dry: 0.005, drink: 0.001 };
  }
  if (sector === 'accommodation') return { linen: 0.004, dry: 0.003 };
  if (sector === 'retail') return { dry: 0.010 };
  return null;
}

/* ------------------------------------------------------------------ small helpers */

/** Township id from any of the spellings the four packs use. Matches population.js. */
export function townshipIdFor(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('dunwich') || s.includes('goompi')) return 'dunwich';
  if (s.includes('point lookout') || s.includes('mulumba') || s.includes('mooloomba')) return 'point-lookout';
  if (s.includes('amity')) return 'amity-point';
  if (s.includes('one mile')) return 'one-mile';
  return 'island-wide';
}

export const TOWNSHIP_IDS = ['dunwich', 'point-lookout', 'amity-point', 'one-mile'];

/** A rolling window that never grows without bound and never divides by zero. */
export class Rolling {
  constructor(n) { this.n = n; this.buf = new Float64Array(n); this.i = 0; this.filled = 0; this.sum = 0; }
  push(v) {
    if (!Number.isFinite(v)) v = 0;
    this.sum -= this.buf[this.i];
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.n;
    if (this.filled < this.n) this.filled++;
    return this.sum;
  }
  get mean() { return this.filled ? this.sum / this.filled : 0; }
  get total() { return this.sum; }
  save() { return { buf: Array.from(this.buf), i: this.i, filled: this.filled, sum: this.sum }; }
  load(s) {
    if (!s || !Array.isArray(s.buf) || s.buf.length !== this.n) return;
    this.buf.set(s.buf); this.i = s.i | 0; this.filled = s.filled | 0; this.sum = s.sum || 0;
  }
}

/** Exponential approach, framed so a caller writes a half-life in days rather than a magic 0.03. */
export function approach(current, target, halfLifeDays, dtDays) {
  if (!(halfLifeDays > 0)) return target;
  const k = 1 - Math.pow(0.5, dtDays / halfLifeDays);
  return current + (target - current) * k;
}
