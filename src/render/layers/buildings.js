// The three townships of Minjerribah, built from the packs rather than from an idea of a town.
//
// Every named premises here is a real one out of data/businesses.json and data/places.json, at its
// published coordinate where the pack has one and inside its own township where it does not. The
// houses around them are generated, but their number is not: the 2021 Census counted 1,964 private
// dwellings on this island and half of them, 50.3 per cent, had nobody in them on census night.
// Queensland's figure was 9.3. That one number is the island's economy, its housing shortage and
// its politics, and it is the thing this layer is built to make visible: at nine at night in August
// most of Point Lookout is dark, and at New Year it is not.
//
// The three towns have to read as three different places, because they are:
//
//   Point Lookout (Mooloomba). On the rock, stepped down the slope, everything strung along one
//     road. Two storey holiday houses on stumps and poles with the deck turned to the water, unit
//     blocks near the shops, the pub above Home Beach, the surf club at the Main Beach end, the
//     bowls club and the markets behind the oval. Most of it is empty most of the year.
//   Dunwich (Goompi). The working town: low, flat, on the bay, and the only one that is mostly
//     lived in. The barge ramp, the school, the museum, the Little Ship Club, QYAC, the ambulance
//     and police, the waste facility, the cemetery on Bingle Road. More sheds, more utes, more
//     permanent gardens, fewer decks.
//   Amity Point (Pulan). Small, quiet and low, right on the water, mostly fibro with a few new
//     builds among them. The store, the jetty, the caravan park, and a foreshore that has been
//     retreating since 1886: a rock wall, a scarped bank and a line of ground on the seaward side
//     of Ballow Street that no longer has anything built on it.
//
// Nothing in here is drawn on a road that is not in the pack. Where a street exists in real life
// and not in data/geography.json, the houses that would front it are laid out in blocks behind the
// mapped road instead, and no new street is drawn or named.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ the towns

Dwelling counts are the ABS 2021 Census counts for each township, the same numbers
src/systems/agents/population.js works from, so the two halves of the island agree about how many
houses there are and how many of them are dark. */

const TOWNS = [
  {
    id: 'point-lookout', name: 'Point Lookout', alt: 'Mooloomba', placeId: 'point-lookout',
    radius: 1600, dwellings: 1012, occupied: 354,
    frontage: 14.5, rows: 7, rowDepth: 29, setback: 7.5, jitter: 2.4,
    // On the headland: two storeys is normal, decks face the water, and the ground moves under you.
    mix: { 'beach-house': 0.30, 'fibro-shack': 0.15, 'modern-box': 0.17, 'units': 0.09, 'brick-lowset': 0.19, shed: 0.10 },
    twoStoreyBias: 0.52, deckToWater: 0.85, tankRate: 0.34, solarRate: 0.42, boatRate: 0.24, fenceRate: 0.30,
    minGroundM: 1.6
  },
  {
    id: 'dunwich', name: 'Dunwich', alt: 'Goompi', placeId: 'dunwich',
    radius: 1500, dwellings: 404, occupied: 299,
    frontage: 18, rows: 6, rowDepth: 33, setback: 9.5, jitter: 3.0,
    mix: { queenslander: 0.16, 'fibro-cottage': 0.26, 'brick-lowset': 0.30, shed: 0.16, duplex: 0.12 },
    twoStoreyBias: 0.16, deckToWater: 0.30, tankRate: 0.46, solarRate: 0.36, boatRate: 0.30, fenceRate: 0.58,
    minGroundM: 1.3
  },
  {
    id: 'amity-point', name: 'Amity Point', alt: 'Pulan', placeId: 'amity-point',
    radius: 1200, dwellings: 404, occupied: 220,
    frontage: 19, rows: 5, rowDepth: 32, setback: 9.0, jitter: 3.4,
    mix: { 'fibro-shack': 0.42, 'low-cottage': 0.26, 'newer-build': 0.18, shed: 0.08, 'brick-lowset': 0.06 },
    twoStoreyBias: 0.10, deckToWater: 0.55, tankRate: 0.52, solarRate: 0.30, boatRate: 0.44, fenceRate: 0.40,
    minGroundM: 1.1
  },
  {
    id: 'one-mile', name: 'One Mile', alt: null, placeId: 'one-mile-jetty',
    radius: 1000, dwellings: 60, occupied: 40,
    frontage: 22, rows: 4, rowDepth: 33, setback: 9.0, jitter: 3.2,
    mix: { 'fibro-cottage': 0.36, 'brick-lowset': 0.30, shed: 0.20, 'low-cottage': 0.14 },
    twoStoreyBias: 0.12, deckToWater: 0.35, tankRate: 0.5, solarRate: 0.32, boatRate: 0.4, fenceRate: 0.5,
    minGroundM: 1.2
  }
];

/* ------------------------------------------------------------------ palettes

Queensland coastal, and specifically this island: corrugated roofs that have chalked off in the
salt, fibro in pale greens and creams, weatherboard in white, timber that has silvered. The roof
list has no black in it, because a black roof at 27 degrees south is a mistake nobody here makes
twice, and no bright red, because that is a Sydney terrace. */

/* Repeats are the weighting. Chalked zincalume, pale green and dusty galvanised are most of what
   is actually on these roofs; charcoal belongs to the newest builds and dark green to a handful. A
   flat pick across eight colours gave Amity Point a skyline of black roofs, which is a Melbourne
   street, not a fibro town on a sand island. */
const ROOF_COLOURS = [
  [0.660, 0.652, 0.626],   // chalked zincalume
  [0.660, 0.652, 0.626],
  [0.694, 0.686, 0.658],   // near white, the newer sheet
  [0.596, 0.572, 0.522],   // bone
  [0.596, 0.572, 0.522],
  [0.540, 0.518, 0.476],   // old galvanised, dusty
  [0.540, 0.518, 0.476],
  [0.512, 0.540, 0.520],   // pale eucalypt green, gone flat
  [0.512, 0.540, 0.520],
  [0.448, 0.480, 0.506],   // blue-grey colorbond
  [0.492, 0.392, 0.342],   // faded terracotta red, the seventies brick
  [0.372, 0.360, 0.348],   // charcoal, the newer builds
  [0.336, 0.382, 0.374]    // deep sea green
];
const WALL_COLOURS = {
  fibro:     [[0.812, 0.800, 0.756], [0.742, 0.776, 0.740], [0.800, 0.762, 0.688], [0.726, 0.748, 0.774], [0.836, 0.812, 0.780]],
  weatherboard: [[0.868, 0.860, 0.836], [0.786, 0.808, 0.796], [0.842, 0.812, 0.752], [0.700, 0.726, 0.748]],
  timber:    [[0.548, 0.492, 0.418], [0.616, 0.560, 0.470], [0.486, 0.452, 0.404], [0.660, 0.606, 0.512]],
  brick:     [[0.628, 0.512, 0.436], [0.700, 0.616, 0.520], [0.548, 0.472, 0.428], [0.744, 0.688, 0.612]],
  render:    [[0.858, 0.842, 0.812], [0.796, 0.780, 0.744], [0.884, 0.868, 0.828]],
  colorbond: [[0.560, 0.578, 0.572], [0.640, 0.628, 0.600], [0.470, 0.486, 0.496]]
};
const TIMBER = [0.474, 0.418, 0.348];
const CONCRETE = [0.700, 0.690, 0.664];
const DECKING = [0.586, 0.524, 0.436];

/* Materials index carried in the instance colour alpha, so one shader can shade a corrugated roof,
   a fibro wall and a concrete stump differently without a material per surface.
   0 painted sheet, 0.25 corrugated metal, 0.5 timber, 0.75 masonry, 1.0 glass or water tank. */
const MAT = { sheet: 0.0, iron: 0.25, timber: 0.5, masonry: 0.75, metal: 1.0 };

/* ------------------------------------------------------------------ named premises

Businesses whose township is 'Island-wide' have no single premises to draw: the rural fire brigade,
the chamber of commerce, the mobile vet, the wildlife rescue volunteers, the council itself. They
are listed in the read model as modelled without premises rather than given an invented shopfront. */

const PREMISES_FORM = {
  'hotel-pub-accommodation': { w: 34, d: 22, storeys: 2, kind: 'pub', roof: 'hip', verandah: 3, colour: 'render' },
  'accommodation-resort':    { w: 26, d: 16, storeys: 2, kind: 'units', roof: 'skillion', verandah: 2, colour: 'render' },
  'accommodation-apartments': { w: 22, d: 14, storeys: 3, kind: 'units', roof: 'skillion', verandah: 2, colour: 'render' },
  'hostel-and-dive-operator': { w: 20, d: 13, storeys: 2, kind: 'units', roof: 'gable', verandah: 1, colour: 'weatherboard' },
  'camping-operator':        { w: 14, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'real-estate-and-holiday-letting': { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'cafe-restaurant-takeaway': { w: 13, d: 10, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 2, colour: 'weatherboard' },
  cafe:                      { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 2, colour: 'weatherboard' },
  restaurant:                { w: 14, d: 11, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 2, colour: 'render' },
  takeaway:                  { w: 9, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'sheet' },
  'takeaway-pizza':          { w: 9, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'sheet' },
  bakery:                    { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'gelato-coffee':           { w: 8, d: 7, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  gelato:                    { w: 8, d: 7, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  coffee:                    { w: 6, d: 5, storeys: 1, kind: 'kiosk', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'coffee-van':              { w: 5.4, d: 2.4, storeys: 1, kind: 'van', roof: 'flat', verandah: 0, colour: 'colorbond' },
  'juice-van':               { w: 5.0, d: 2.3, storeys: 1, kind: 'van', roof: 'flat', verandah: 0, colour: 'colorbond' },
  'food-van':                { w: 5.6, d: 2.4, storeys: 1, kind: 'van', roof: 'flat', verandah: 0, colour: 'colorbond' },
  'seafood-retail':          { w: 9, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'sheet' },
  'seafood-retail-and-charter': { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'fuel-grocery-takeaway':   { w: 18, d: 13, storeys: 1, kind: 'servo', roof: 'skillion', verandah: 0, colour: 'render' },
  'general-store-fuel':      { w: 16, d: 12, storeys: 1, kind: 'servo', roof: 'skillion', verandah: 1, colour: 'weatherboard' },
  'fuel-hardware':           { w: 20, d: 14, storeys: 1, kind: 'servo', roof: 'skillion', verandah: 0, colour: 'colorbond' },
  'cafe-takeaway':           { w: 10, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'weatherboard' },
  'club-bistro':             { w: 26, d: 18, storeys: 1, kind: 'club', roof: 'hip', verandah: 2, colour: 'render' },
  'club-bistro-bowls':       { w: 24, d: 16, storeys: 1, kind: 'club', roof: 'hip', verandah: 2, colour: 'render' },
  'sports-club-licensed':    { w: 26, d: 17, storeys: 1, kind: 'club', roof: 'gable', verandah: 2, colour: 'colorbond' },
  'community-club-bistro':   { w: 22, d: 15, storeys: 1, kind: 'club', roof: 'hip', verandah: 2, colour: 'weatherboard' },
  'tavern-restaurant':       { w: 24, d: 16, storeys: 1, kind: 'club', roof: 'hip', verandah: 3, colour: 'render' },
  'brewery-taproom':         { w: 22, d: 16, storeys: 1, kind: 'shed', roof: 'gable', verandah: 1, colour: 'colorbond' },
  'wine-bar-cafe':           { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'timber' },
  grocery:                   { w: 28, d: 20, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'convenience-grocery':     { w: 14, d: 11, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  butcher:                   { w: 10, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'bottle-shop':             { w: 13, d: 10, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 0, colour: 'render' },
  'post-office':             { w: 10, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  pharmacy:                  { w: 12, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'gp-clinic':               { w: 15, d: 11, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 1, colour: 'render' },
  'emergency-health-outpost': { w: 13, d: 10, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 1, colour: 'render' },
  'aboriginal-community-controlled-health': { w: 24, d: 16, storeys: 1, kind: 'civic', roof: 'hip', verandah: 2, colour: 'render' },
  'outdoor-sporting-goods':  { w: 14, d: 11, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'gift-retail':             { w: 8, d: 7, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'weatherboard' },
  'homewares-retail':        { w: 9, d: 7, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'weatherboard' },
  'art-retail-studio':       { w: 9, d: 8, storeys: 1, kind: 'shop', roof: 'gable', verandah: 1, colour: 'timber' },
  'aboriginal-art-gallery':  { w: 13, d: 10, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' },
  'artist-shopfront':        { w: 8, d: 7, storeys: 1, kind: 'shop', roof: 'gable', verandah: 1, colour: 'timber' },
  'tour-operator-4wd':       { w: 10, d: 8, storeys: 1, kind: 'shed', roof: 'skillion', verandah: 0, colour: 'colorbond' },
  'tour-operator-cultural':  { w: 10, d: 8, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'weatherboard' },
  'surf-school':             { w: 8, d: 6, storeys: 1, kind: 'kiosk', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'water-taxi-operator':     { w: 12, d: 8, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 1, colour: 'colorbond' },
  'ferry-operator':          { w: 20, d: 12, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 1, colour: 'render' },
  'bus-operator':            { w: 22, d: 14, storeys: 1, kind: 'shed', roof: 'gable', verandah: 0, colour: 'colorbond' },
  'traditional-owner-corporation': { w: 26, d: 17, storeys: 1, kind: 'civic', roof: 'hip', verandah: 2, colour: 'render' },
  'arts-and-culture-centre': { w: 24, d: 17, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 2, colour: 'timber' },
  'elders-corporation':      { w: 14, d: 11, storeys: 1, kind: 'civic', roof: 'hip', verandah: 2, colour: 'weatherboard' },
  'primary-school':          { w: 30, d: 12, storeys: 1, kind: 'school', roof: 'gable', verandah: 2, colour: 'weatherboard' },
  'surf-life-saving-club':   { w: 22, d: 14, storeys: 2, kind: 'club', roof: 'skillion', verandah: 2, colour: 'render' },
  'fishing-club':            { w: 12, d: 9, storeys: 1, kind: 'club', roof: 'gable', verandah: 1, colour: 'colorbond' },
  'golf-club':               { w: 16, d: 12, storeys: 1, kind: 'club', roof: 'hip', verandah: 2, colour: 'weatherboard' },
  museum:                    { w: 18, d: 13, storeys: 1, kind: 'civic', roof: 'gable', verandah: 2, colour: 'weatherboard' },
  'emergency-service-ambulance': { w: 14, d: 11, storeys: 1, kind: 'emergency', roof: 'skillion', verandah: 0, colour: 'render' },
  'emergency-service-police':    { w: 14, d: 11, storeys: 1, kind: 'emergency', roof: 'hip', verandah: 1, colour: 'render' },
  'emergency-service-marine':    { w: 15, d: 11, storeys: 1, kind: 'shed', roof: 'gable', verandah: 0, colour: 'colorbond' },
  'council-waste-facility':  { w: 20, d: 14, storeys: 1, kind: 'shed', roof: 'gable', verandah: 0, colour: 'colorbond' },
  'community-hall':          { w: 20, d: 13, storeys: 1, kind: 'civic', roof: 'gable', verandah: 1, colour: 'weatherboard' },
  'aged-care':               { w: 26, d: 15, storeys: 1, kind: 'civic', roof: 'hip', verandah: 2, colour: 'render' },
  'housing-provider':        { w: 12, d: 9, storeys: 1, kind: 'civic', roof: 'skillion', verandah: 1, colour: 'render' },
  market:                    { w: 0, d: 0, storeys: 0, kind: 'openair', roof: 'none', verandah: 0, colour: 'sheet' }
};
const DEFAULT_FORM = { w: 11, d: 9, storeys: 1, kind: 'shop', roof: 'skillion', verandah: 1, colour: 'render' };

/* ------------------------------------------------------------------ part meshes */

function unitBox(scene, name) {
  // pivot at the base centre, one metre cube, so a scale is the real size in metres
  const p = [], n = [], idx = [];
  const faces = [
    { o: [0, 0, -0.5], u: [1, 0, 0], v: [0, 1, 0], nn: [0, 0, -1] },
    { o: [0, 0, 0.5], u: [-1, 0, 0], v: [0, 1, 0], nn: [0, 0, 1] },
    { o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], nn: [-1, 0, 0] },
    { o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], nn: [1, 0, 0] },
    { o: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], nn: [0, 1, 0] },
    { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], nn: [0, -1, 0] }
  ];
  for (const f of faces) {
    const base = p.length / 3;
    for (const [su, sv] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
      const uu = f.v[1] === 1 ? sv : sv - 0.5;
      p.push(f.o[0] + f.u[0] * su + f.v[0] * uu,
        f.o[1] + f.u[1] * su + f.v[1] * uu,
        f.o[2] + f.u[2] * su + f.v[2] * uu);
      n.push(f.nn[0], f.nn[1], f.nn[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return meshFrom(scene, name, p, n, idx);
}

/** Gable roof. Base 1x1 at y=0, ridge along x at y=1. Eaves overhang comes from the instance scale. */
function unitGable(scene, name) {
  const p = [], n = [], idx = [];
  const add = (a, b, c) => {
    const base = p.length / 3;
    for (const v of [a, b, c]) p.push(v[0], v[1], v[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    for (let i = 0; i < 3; i++) n.push(nx / L, ny / L, nz / L);
    idx.push(base, base + 1, base + 2);
  };
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
  const r0 = [-0.5, 1, 0], r1 = [0.5, 1, 0];
  add(a, b, r1); add(a, r1, r0);          // the -z slope
  add(c, d, r0); add(c, r0, r1);          // the +z slope
  add(a, r0, d);                          // gable end, -x
  add(b, c, r1);                          // gable end, +x
  add(a, d, c); add(a, c, b);             // soffit
  return meshFrom(scene, name, p, n, idx);
}

/** Hip roof. Base 1x1, ridge along x from -0.22 to 0.22 at y=1. */
function unitHip(scene, name) {
  const p = [], n = [], idx = [];
  const add = (a, b, c) => {
    const base = p.length / 3;
    for (const v of [a, b, c]) p.push(v[0], v[1], v[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    for (let i = 0; i < 3; i++) n.push(nx / L, ny / L, nz / L);
    idx.push(base, base + 1, base + 2);
  };
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
  const r0 = [-0.22, 1, 0], r1 = [0.22, 1, 0];
  add(a, b, r1); add(a, r1, r0);
  add(c, d, r0); add(c, r0, r1);
  add(a, r0, d);
  add(b, c, r1);
  add(a, d, c); add(a, c, b);
  return meshFrom(scene, name, p, n, idx);
}

/** Skillion. Base 1x1, low edge at -z (y=0), high edge at +z (y=1). A flat roof is this, squashed. */
function unitSkillion(scene, name) {
  const p = [], n = [], idx = [];
  const add = (a, b, c) => {
    const base = p.length / 3;
    for (const v of [a, b, c]) p.push(v[0], v[1], v[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    for (let i = 0; i < 3; i++) n.push(nx / L, ny / L, nz / L);
    idx.push(base, base + 1, base + 2);
  };
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 1, 0.5], d = [-0.5, 1, 0.5];
  const a2 = [-0.5, -0.14, -0.5], b2 = [0.5, -0.14, -0.5], c2 = [0.5, 0.86, 0.5], d2 = [-0.5, 0.86, 0.5];
  add(a, b, c); add(a, c, d);                 // the sloping plane
  add(a2, d2, c2); add(a2, c2, b2);           // the soffit under it
  add(a, a2, b2); add(a, b2, b);              // the eave fascia at the low edge
  add(d, c, c2); add(d, c2, d2);              // the high edge
  add(a, d, d2); add(a, d2, a2);
  add(b, b2, c2); add(b, c2, c);
  return meshFrom(scene, name, p, n, idx);
}

/** A quad in the XY plane facing +z, one metre square, pivot at the base centre. */
function unitQuad(scene, name) {
  const p = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  const n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  return meshFrom(scene, name, p, n, [0, 1, 2, 0, 2, 3]);
}

/** A ten sided rainwater tank with a slightly domed lid, unit diameter and unit height. */
function unitTank(scene, name) {
  const seg = 10, p = [], n = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    p.push(cx, 0, cz); n.push(Math.cos(a), 0, Math.sin(a));
    p.push(cx, 1, cz); n.push(Math.cos(a), 0, Math.sin(a));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  const top = p.length / 3;
  p.push(0, 1.09, 0); n.push(0, 1, 0);
  for (let i = 0; i < seg; i++) idx.push(top, i * 2 + 1, ((i + 1) % seg) * 2 + 1);
  return meshFrom(scene, name, p, n, idx);
}

/** A rotary clothes hoist: the post and four arms. Unit height, arms at 1.6 m across when scaled. */
function unitHoist(scene, name) {
  const p = [], n = [], idx = [];
  const bar = (x0, y0, z0, x1, y1, z1, r) => {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const L = Math.hypot(dx, dy, dz) || 1;
    // a cheap two-quad cross section: enough at the size a clothes line is ever seen
    let ax = -dz / L, az = dx / L;
    if (Math.abs(dy) > 0.9 * L) { ax = 1; az = 0; }
    const base = p.length / 3;
    const pts = [[x0 - ax * r, y0, z0 - az * r], [x0 + ax * r, y0, z0 + az * r],
      [x1 + ax * r, y1, z1 + az * r], [x1 - ax * r, y1, z1 - az * r]];
    for (const q of pts) { p.push(q[0], q[1], q[2]); n.push(0, 1, 0); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const base2 = p.length / 3;
    for (const q of pts) { p.push(q[0], q[1] + r * 1.4, q[2]); n.push(0, 1, 0); }
    idx.push(base2, base2 + 2, base2 + 1, base2, base2 + 3, base2 + 2);
  };
  bar(0, 0, 0, 0, 1, 0, 0.035);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    bar(0, 0.94, 0, Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.8, 0.022);
  }
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + 0.3, a1 = ((i + 1) / 4) * Math.PI * 2 + 0.3;
    bar(Math.cos(a0) * 0.62, 0.905, Math.sin(a0) * 0.62, Math.cos(a1) * 0.62, 0.905, Math.sin(a1) * 0.62, 0.012);
  }
  return meshFrom(scene, name, p, n, idx);
}

/** A small runabout on a trailer: a hull with a raked bow, unit length. There is one in half the
 *  carports on this island and leaving them out would be the tell. */
function unitBoat(scene, name) {
  const p = [], n = [], idx = [];
  const add = (a, b, c) => {
    const base = p.length / 3;
    for (const v of [a, b, c]) p.push(v[0], v[1], v[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    for (let i = 0; i < 3; i++) n.push(nx / L, ny / L, nz / L);
    idx.push(base, base + 1, base + 2);
  };
  // keel line runs along x; the bow is at +x
  const kA = [-0.5, 0.18, 0], kB = [0.34, 0.22, 0], bow = [0.5, 0.52, 0];
  const gun = 0.16;
  const tl = [-0.5, 0.52, -gun], tr = [-0.5, 0.52, gun];
  const ml = [0.2, 0.54, -gun], mr = [0.2, 0.54, gun];
  add(kA, kB, ml); add(kA, ml, tl);
  add(kB, kA, tr); add(kB, tr, mr);
  add(kB, bow, ml); add(bow, mr, ml);
  add(kB, mr, bow);
  add(tl, ml, mr); add(tl, mr, tr);          // the open deck
  // windscreen
  add([0.02, 0.54, -0.11], [0.02, 0.78, -0.10], [0.02, 0.78, 0.10]);
  add([0.02, 0.54, -0.11], [0.02, 0.78, 0.10], [0.02, 0.54, 0.11]);
  return meshFrom(scene, name, p, n, idx);
}

/** A rounded boulder for the Amity Point rock wall. Six sided, squashed, one metre across. */
function unitRock(scene, name) {
  const p = [], n = [], idx = [];
  const seg = 6;
  const rows = [[0, 0.5], [0.42, 0.56], [0.78, 0.36], [1.0, 0]];
  const ring = [];
  for (let r = 0; r < rows.length; r++) {
    const [y, rad] = rows[r];
    const start = p.length / 3;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const wob = 0.82 + 0.36 * ((i * 7 + r * 3) % 5) / 5;
      p.push(Math.cos(a) * rad * wob, y, Math.sin(a) * rad * wob);
      n.push(Math.cos(a), 0.4, Math.sin(a));
    }
    ring.push(start);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      idx.push(ring[r] + i, ring[r] + j, ring[r + 1] + j, ring[r] + i, ring[r + 1] + j, ring[r + 1] + i);
    }
  }
  return meshFrom(scene, name, p, n, idx);
}

/* Part geometry is kept as plain arrays rather than as a template mesh, and every group builds its
   own mesh from it. Cloning is not an option here: a Babylon clone shares its source's geometry,
   thin instance buffers live on the geometry, and two hundred clones sharing one buffer is a
   screen full of GL_INVALID_OPERATION and nothing drawn. Twenty four vertices two hundred times
   is nothing; a shared instance buffer is fatal. */
function meshFrom(scene, name, pos, nrm, idx) {
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

function realiseMesh(scene, name, data) {
  const mesh = new B.Mesh(name, scene);
  const vd = new B.VertexData();
  vd.positions = data.pos;
  vd.normals = data.nrm;
  vd.indices = data.idx;
  vd.applyToMesh(mesh, false);
  mesh.isPickable = false;
  return mesh;
}

/* ------------------------------------------------------------------ shaders */

const BUILD_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 instCol;
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
varying vec3 vLocal;
void main(void){
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 wp = W * vec4(position, 1.0);
  vPos = wp.xyz;
  vNrm = normalize(mat3(W) * normal);
  vCol = instCol;
  vLocal = position;
  gl_Position = viewProjection * wp;
}
`;

const BUILD_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
varying vec3 vLocal;
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;    // x fog density, y wetness, z time, w sea level

// Haze only, so the sun disc terms are left out. See the same note in roads.js.
vec3 skyColour(vec3 d){
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, sqrt(up));
  float s = max(dot(d, uSun.xyz), 0.0);
  return c + uSunCol.rgb * uSunCol.a * (s * s * s * 0.05);
}

void main(void){
  vec3 V = vPos - uCam;
  float dist = length(V);
  V /= max(dist, 0.001);
  vec3 N = normalize(vNrm);
  float matId = vCol.a;
  vec3 base = vCol.rgb;

  // Corrugated iron: ribs at about seventy six millimetres, read off the world position so a
  // roof plane picks them up whichever way it faces. This is the single detail that makes a
  // Queensland roof look like a Queensland roof rather than a coloured triangle.
  // Faded out with distance, because a seventy six millimetre rib seen from three hundred metres
  // is finer than a pixel and turns a whole township of roofs into moire.
  float near = clamp(1.0 - dist / 130.0, 0.0, 1.0);
  float ironMat = 1.0 - abs(matId - 0.25) * 4.0;
  // the chalky, salt weathered top surface, which is the part that must not fade with distance
  base = mix(base, base * 1.10 + 0.035, clamp(N.y, 0.0, 1.0) * 0.5 * max(ironMat, 0.0));
  // The three surface treatments are all short range detail, so past a hundred and thirty metres
  // none of them run at all. A township is two thousand buildings and this branch is the whole
  // difference between a fragment shader that fits in a frame and one that does not.
  if (near > 0.0) {
    if (ironMat > 0.0) {
      float along = abs(N.x) > abs(N.z) ? vPos.z : vPos.x;
      base *= 1.0 + sin(along * 82.0) * 0.085 * ironMat * near;
    }
    float timber = (1.0 - abs(matId - 0.5) * 4.0) * near;
    if (timber > 0.0) base *= 1.0 + sin(vPos.y * 26.0 + vPos.x * 0.7) * 0.05 * timber;
    float masonry = (1.0 - abs(matId - 0.75) * 4.0) * near;
    if (masonry > 0.0) {
      float course = smoothstep(0.42, 0.5, abs(fract(vPos.y * 11.9) - 0.5));
      base *= 1.0 - course * 0.10 * masonry;
    }
  }

  float ndl = max(dot(N, uSun.xyz), 0.0);
  // A soft wrap on the terminator: rendering a wall as a hard lambert step makes a town of boxes.
  ndl = ndl * 0.92 + pow(max(dot(N, uSun.xyz) * 0.5 + 0.5, 0.0), 2.0) * 0.08;
  vec3 sun = uSunCol.rgb * uSunCol.a * ndl;
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.5) * (0.34 + 0.38 * clamp(N.y, 0.0, 1.0));
  // bounce off pale sand: this island throws a lot of light back up under the eaves
  vec3 bounce = vec3(0.84, 0.78, 0.64) * uSunCol.rgb * uSunCol.a * 0.10 * clamp(-N.y, 0.0, 1.0);
  vec3 col = base * (sun + sky + bounce);

  // Sheet metal and glass keep a highlight; fibro and brick do not.
  float gloss = max(1.0 - abs(matId - 0.25) * 3.0, 1.0 - abs(matId - 1.0) * 3.0);
  if (gloss > 0.0) {
    vec3 H = normalize(uSun.xyz - V);
    col += uSunCol.rgb * uSunCol.a * pow(max(dot(N, H), 0.0), 46.0) * gloss * (0.22 + uTune.y * 0.5);
  }

  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = skyColour(normalize(vec3(-V.x, max(0.02, -V.y * 0.2 + 0.05), -V.z)));
  hz = mix(vec3(dot(hz, vec3(0.30, 0.59, 0.11))), hz, 0.72) * 0.94;
  col = mix(col, hz, fog * 0.86);
  gl_FragColor = vec4(col, 1.0);
}
`;

/* Windows. The instance carries who lives here rather than whether the light is on, and the
   shader decides, so twelve thousand windows cost nothing to animate through a night. */
const WINDOW_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 instCol;   // rgb glass tint, a material
attribute vec4 instLit;   // x household phase, y this window's phase, z occupied 0/1, w kind
uniform mat4 viewProjection;
uniform vec4 uLight;      // x darkness 0..1, y minute of day / 1440, z holiday load, w px scale
uniform vec3 uCam;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
varying float vLit;

void main(void){
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 wp = W * vec4(position, 1.0);

  // A lit window a kilometre away is a fraction of a pixel and disappears. Hold it to a minimum
  // apparent size so a township still reads as a township of lights from the air at night.
  float d = distance(wp.xyz, uCam);
  float grow = max(0.0, d * uLight.w - 1.0);
  if (grow > 0.0) {
    vec3 c = (W * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
    wp.xyz = c + (wp.xyz - c) * (1.0 + grow);
  }

  float m = uLight.y * 1440.0;
  float wake = 300.0 + instLit.x * 165.0;
  float sleep = 1275.0 + fract(instLit.x * 7.31) * 195.0;
  float awake = step(wake, m) * step(m, sleep);
  // more rooms are lit at seven in the evening than at six in the morning
  float e = (m - 1140.0) / 190.0;
  float rooms = 0.30 + 0.56 * exp(-e * e) + 0.14 * step(m, 720.0);
  float on = step(instLit.y, rooms);
  vLit = uLight.x * instLit.z * awake * on;

  vPos = wp.xyz;
  vNrm = normalize(mat3(W) * normal);
  vCol = instCol;
  gl_Position = viewProjection * wp;
}
`;

const WINDOW_FRAG = `
precision highp float;
varying vec3 vPos;
varying vec3 vNrm;
varying vec4 vCol;
varying float vLit;
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;
void main(void){
  vec3 V = normalize(vPos - uCam);
  vec3 N = normalize(vNrm);
  // Daytime glass: dark inside, with the sky reflected off it at a glancing angle.
  vec3 refl = reflect(V, N);
  float up = clamp(refl.y, 0.0, 1.0);
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, pow(up, 0.42));
  float fres = pow(1.0 - max(dot(-V, N), 0.0), 3.2);
  vec3 col = vCol.rgb * 0.20 + sky * (0.10 + 0.75 * fres);
  float sp = max(dot(reflect(V, N), uSun.xyz), 0.0);
  col += uSunCol.rgb * uSunCol.a * pow(sp, 90.0) * 0.9;
  // Tungsten behind a curtain, warm rather than bright: at 1.9 the tone curve took every window
  // to flat white and a township at night read as a runway, not as houses with people in them.
  col = mix(col, vec3(1.00, 0.605, 0.295) * 1.18, vLit);
  float dist = length(vPos - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  col = mix(col, mix(uSkyHz.rgb, uSky.rgb, 0.3), fog * 0.5 * (1.0 - vLit));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* Ground shadows. The terrain runs a custom shader and does not receive a shadow map, so the
   buildings project their own: a sheared footprint rebuilt on the CPU whenever the sun has moved
   far enough to matter, sampled onto the real ground so it follows the slope. */
const SHADOW_VERT = `
precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 viewProjection;
varying float vA;
varying vec3 vPos;
void main(void){ vA = color.a; vPos = position; gl_Position = viewProjection * vec4(position, 1.0); }
`;
const SHADOW_FRAG = `
precision highp float;
varying float vA;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uTune;
uniform vec4 uShadow;   // x strength
void main(void){
  float dist = length(vPos - uCam);
  float fade = exp(-dist * uTune.x * 1.4);
  gl_FragColor = vec4(0.03, 0.035, 0.05, vA * uShadow.x * fade);
}
`;

/* ------------------------------------------------------------------ the layer */

export function registerBuildings(world) {
  const island = world.island;
  const rng = world.rng.stream('buildings');
  const notes = [];

  if (!island || typeof island.height !== 'function') {
    world.publish('buildings', { ready: false, notes: ['no island to build on'] });
    return;
  }

  /* ================================================================ 1. lots

  A lot is a piece of ground with a road in front of it and a direction to face. They are laid out
  from the real road centrelines in data/geography.json: a frontage row along each side, then
  blocks behind it, because the pack does not carry every residential street and a house that
  would front an unmapped street still has to stand somewhere. No street is drawn or named for
  those back rows: they are simply lots on the same orientation as the road they sit behind. */

  const geo = (world.data && world.data.geography) || null;
  const lots = [];
  const lotGrid = new Map();
  const CELL = 24;
  const cellKey = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;

  function tooClose(x, z, minD) {
    const gi = Math.floor(x / CELL), gj = Math.floor(z / CELL);
    const r = Math.ceil(minD / CELL);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const list = lotGrid.get(`${gi + di}:${gj + dj}`);
        if (!list) continue;
        for (const l of list) {
          const dx = l.x - x, dz = l.z - z;
          if (dx * dx + dz * dz < minD * minD) return true;
        }
      }
    }
    return false;
  }
  function addLot(lot) {
    lots.push(lot);
    const k = cellKey(lot.x, lot.z);
    if (!lotGrid.has(k)) lotGrid.set(k, []);
    lotGrid.get(k).push(lot);
    return lot;
  }

  // Ground that a house can stand on. Sand is fine; a mangrove flat, a beach, a lake, the cliff at
  // the Gorge and a slope over about twenty five degrees are not.
  const BAD_COVER = { water: 1, lake: 1, beach: 1, mangrove: 1, swamp: 1, rock: 1, foredune: 1 };
  function buildable(x, z, town) {
    const h = island.height(x, z);
    if (h < island.seaLevel + town.minGroundM) return false;
    if (BAD_COVER[island.landCover(x, z)]) return false;
    if (island.slope(x, z) > 0.44) return false;
    return true;
  }

  /** Unit vector toward the nearest open water, for turning a deck the right way. */
  const waterCache = new Map();
  function waterBearing(x, z) {
    const key = `${Math.round(x / 60)}:${Math.round(z / 60)}`;
    if (waterCache.has(key)) return waterCache.get(key);
    let best = null, bd = Infinity;
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const dx = Math.sin(th), dz = Math.cos(th);
      for (let r = 60; r <= 900; r += 60) {
        if (island.height(x + dx * r, z + dz * r) < island.seaLevel) {
          if (r < bd) { bd = r; best = { x: dx, z: dz }; }
          break;
        }
      }
    }
    waterCache.set(key, best);
    return best;
  }

  // Ground that must stay clear: the ovals, the school grounds, the cemetery, the parks and the
  // published Amity Point erosion and slump zone, which Redland City Council's Shoreline Erosion
  // Management Plan moves buildings out of rather than into.
  const KEEP_CLEAR = [];
  const placesPack = (world.data && world.data.places && world.data.places.places) || [];
  const CLEAR_RADIUS = {
    sports_field: 95, cemetery: 115, park: 45, school: 70, hazard_zone: 120, campground: 0,
    boat_ramp: 40, barge_ramp: 70, ferry_terminal: 80, jetty: 30
  };
  for (const p of placesPack) {
    const r = CLEAR_RADIUS[p.type];
    if (!r || !Number.isFinite(p.lon)) continue;
    const xy = island.project(p.lon, p.lat);
    KEEP_CLEAR.push({ x: xy.x, z: xy.z, r, id: p.id, why: p.type });
  }
  function clearOf(x, z) {
    for (const k of KEEP_CLEAR) {
      const dx = x - k.x, dz = z - k.z;
      if (dx * dx + dz * dz < k.r * k.r) return false;
    }
    return true;
  }

  // The mapped roads a lot can front. Beach routes, beach access tracks and walking tracks do not
  // get houses on them: nobody has a front door on Main Beach.
  const FRONTABLE = { sealed_road: 1, street: 1, unsealed_road: 1 };
  const townRoads = new Map(TOWNS.map((t) => [t.id, []]));
  const townCentres = new Map();
  for (const t of TOWNS) {
    const pl = placesPack.find((p) => p.id === t.placeId);
    if (pl && Number.isFinite(pl.lon)) {
      const xy = island.project(pl.lon, pl.lat);
      townCentres.set(t.id, { x: xy.x, z: xy.z });
    }
  }
  if (geo && Array.isArray(geo.roads)) {
    for (const r of geo.roads) {
      if (!FRONTABLE[r.type] || !Array.isArray(r.coordinates)) continue;
      const pts = r.coordinates.map((c) => {
        const p = island.project(c[0], c[1]);
        return [p.x, p.z];
      });
      for (const t of TOWNS) {
        const c = townCentres.get(t.id);
        if (!c) continue;
        // keep the run of this road that falls inside the township
        let run = [];
        for (let i = 0; i < pts.length; i++) {
          const dx = pts[i][0] - c.x, dz = pts[i][1] - c.z;
          const inside = dx * dx + dz * dz < t.radius * t.radius;
          if (inside) run.push(pts[i]);
          else if (run.length > 1) { townRoads.get(t.id).push({ pts: run, name: r.name, type: r.type }); run = []; }
          else run = [];
        }
        if (run.length > 1) townRoads.get(t.id).push({ pts: run, name: r.name, type: r.type });
      }
    }
  } else {
    notes.push('no geography pack: the townships have no roads to lay out lots against.');
  }

  /** Walk one side of one road and lay lots down it, then the blocks behind. */
  function layOut(town, road) {
    const dense = [];
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        dense.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      }
    }
    if (dense.length < 3) return;
    const centre = townCentres.get(town.id);
    let along = 0;
    let nextAt = town.frontage * 0.5;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i];
      along += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (along < nextAt) continue;
      nextAt = along + town.frontage;
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const nx = tz, nz = -tx;
      for (const side of [-1, 1]) {
        for (let row = 0; row < town.rows; row++) {
          // Deeper rows are less likely to be taken up, so the town thins toward the bush.
          if (row > 0 && rng.float() > 0.93 - row * 0.045) continue;
          const off = town.setback + 4.5 + row * town.rowDepth;
          const jx = (rng.float() - 0.5) * town.jitter * 2;
          const jz = (rng.float() - 0.5) * town.jitter * 2;
          const shift = row > 0 ? (rng.float() - 0.5) * town.frontage * 0.7 : 0;
          const x = b[0] + nx * side * off + tx * shift + jx;
          const z = b[1] + nz * side * off + tz * shift + jz;
          if (!buildable(x, z, town)) continue;
          if (!clearOf(x, z)) continue;
          if (tooClose(x, z, row === 0 ? town.frontage * 0.62 : town.frontage * 0.78)) continue;
          const dxc = centre ? x - centre.x : 0, dzc = centre ? z - centre.z : 0;
          addLot({
            x, z,
            faceX: -nx * side, faceZ: -nz * side,     // the direction the front of the house looks
            townId: town.id,
            row,
            roadName: road.name,
            roadX: b[0] + nx * side * (town.setback * 0.2), roadZ: b[1] + nz * side * (town.setback * 0.2),
            frontageDist: off,
            centreDist: Math.sqrt(dxc * dxc + dzc * dzc),
            taken: null
          });
        }
      }
    }
  }

  for (const t of TOWNS) for (const road of townRoads.get(t.id) || []) layOut(t, road);

  // Deterministic order: closer to the town centre and closer to the road first, so the named
  // premises land on the main street and the houses fill outward exactly as a town does.
  lots.sort((a, b) => (a.townId < b.townId ? -1 : a.townId > b.townId ? 1
    : (a.row - b.row) || (a.centreDist - b.centreDist) || (a.x - b.x) || (a.z - b.z)));

  const lotsByTown = new Map(TOWNS.map((t) => [t.id, []]));
  for (const l of lots) lotsByTown.get(l.townId).push(l);

  /* ================================================================ 2. named premises */

  const buildings = [];
  const bizPack = (world.data && world.data.businesses && world.data.businesses.businesses) || [];
  const TOWNSHIP_KEY = {
    'Point Lookout (Mulumba)': 'point-lookout',
    'Dunwich (Goompi)': 'dunwich',
    'Amity Point (Pulan)': 'amity-point',
    'One Mile': 'one-mile'
  };
  const noPremises = [];

  /** Take the nearest free lot to a point inside a township, or null. */
  function claimNear(townId, x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const l of lotsByTown.get(townId) || []) {
      if (l.taken) continue;
      const dx = l.x - x, dz = l.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  /** The first free lot in the township, which is the one nearest the main street. */
  function claimCentral(townId) {
    for (const l of lotsByTown.get(townId) || []) if (!l.taken) return l;
    return null;
  }

  function placeNamed(rec) {
    const townId = TOWNSHIP_KEY[rec.township];
    const form = Object.assign({}, PREMISES_FORM[rec.type] || DEFAULT_FORM);
    if (!townId) { noPremises.push({ id: rec.id, name: rec.name, why: rec.township }); return null; }
    if (form.kind === 'openair') { noPremises.push({ id: rec.id, name: rec.name, why: 'open air, no building' }); return null; }

    let lot = null;
    if (Number.isFinite(rec.lat) && Number.isFinite(rec.lon)) {
      const xy = island.project(rec.lon, rec.lat);
      lot = claimNear(townId, xy.x, xy.z, 190);
      if (!lot && buildable(xy.x, xy.z, TOWNS.find((t) => t.id === townId))) {
        // The pack has a coordinate but no lot reached it. Stand the building on the coordinate.
        const near = lots.length ? lots.reduce((p, c) => {
          const d = (c.x - xy.x) ** 2 + (c.z - xy.z) ** 2;
          return d < p.d ? { l: c, d } : p;
        }, { l: null, d: Infinity }) : { l: null };
        lot = addLot({
          x: xy.x, z: xy.z,
          faceX: near.l ? near.l.faceX : 0, faceZ: near.l ? near.l.faceZ : 1,
          townId, row: 0, roadName: null,
          roadX: xy.x, roadZ: xy.z, frontageDist: 12, centreDist: 0, taken: null
        });
      }
    }
    if (!lot) lot = claimCentral(townId);
    if (!lot) { noPremises.push({ id: rec.id, name: rec.name, why: 'no free lot in the township' }); return null; }

    lot.taken = rec.id;
    const bld = design({
      lot,
      id: rec.id,
      label: rec.name,
      kind: form.kind,
      archetype: 'premises',
      form,
      townId,
      status: rec.status,
      role: rec.role_in_sim || null,
      employs: rec.employs ? rec.employs.max : 0,
      source: rec.source,
      coordSource: Number.isFinite(rec.lat) ? (rec.coords_source || 'pack') : 'placed inside its township, no coordinate published'
    });
    buildings.push(bld);
    return bld;
  }

  // Sorted by id, so the order premises take lots never depends on the pack's own ordering.
  const bizSorted = bizPack.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const rec of bizSorted) {
    if (rec.status === 'closed') continue;      // Rufus King Seafoods stays in the pack, not on the ground
    placeNamed(rec);
  }

  // Institutions from data/places.json that are not businesses: the halls, the school, the clubs.
  const PLACE_FORM = {
    school: { w: 32, d: 12, storeys: 1, kind: 'school', roof: 'gable', verandah: 2, colour: 'weatherboard' },
    hall: { w: 20, d: 13, storeys: 1, kind: 'civic', roof: 'gable', verandah: 1, colour: 'weatherboard' },
    pool: null, museum: null, club: null, surf_club: null, sports_field: null,
    cemetery: { w: 0, d: 0, storeys: 0, kind: 'cemetery', roof: 'none', verandah: 0, colour: 'render' }
  };
  for (const p of placesPack) {
    if (!Number.isFinite(p.lon)) continue;
    const form = PLACE_FORM[p.type];
    if (!form) continue;
    const xy = island.project(p.lon, p.lat);
    const townId = nearestTown(xy.x, xy.z);
    if (!townId) continue;
    if (buildings.some((b) => b.id === p.id || b.label === p.name)) continue;
    const lot = claimNear(townId, xy.x, xy.z, 160) || claimCentral(townId);
    if (!lot) continue;
    lot.taken = p.id;
    buildings.push(design({
      lot, id: p.id, label: p.name, kind: form.kind, archetype: 'premises', form, townId,
      status: 'trading', source: p.source, coordSource: p.coordinate_source || 'pack'
    }));
  }

  function nearestTown(x, z) {
    let best = null, bd = Infinity;
    for (const t of TOWNS) {
      const c = townCentres.get(t.id);
      if (!c) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd && d < (t.radius * 1.4) ** 2) { bd = d; best = t.id; }
    }
    return best;
  }

  /* ================================================================ 3. the houses */

  const dwellings = [];
  for (const t of TOWNS) {
    const free = (lotsByTown.get(t.id) || []).filter((l) => !l.taken);
    const want = Math.min(t.dwellings, free.length);
    if (want < t.dwellings) {
      notes.push(`${t.name}: ${free.length} lots for ${t.dwellings} census dwellings. `
        + 'The pack does not carry every street in this township, so the rest are not placed.');
    }
    const mixKeys = Object.keys(t.mix);
    for (let i = 0; i < want; i++) {
      const lot = free[i];
      lot.taken = 'dwelling';
      let r = rng.float(), pick = mixKeys[0];
      for (const k of mixKeys) { r -= t.mix[k]; if (r <= 0) { pick = k; break; } }
      const bld = design({ lot, id: null, label: null, kind: 'house', archetype: pick, townId: t.id });
      buildings.push(bld);
      dwellings.push(bld);
    }
  }

  /* ================================================================ 4. the design pass

  Everything about a building that is not its position: how big, how many storeys, how far off the
  ground, which way the deck looks, whether there is a boat under the carport. Terrain decides more
  of this than taste does, which is the point: a lot with two metres of fall across it gets a pole
  frame, and a flat one at Dunwich gets a slab. */

  function design(spec) {
    const town = TOWNS.find((t) => t.id === spec.townId) || TOWNS[0];
    const lot = spec.lot;
    const arch = spec.archetype;
    const form = spec.form;

    // orientation: square to the road, then turned toward the water if this is a place that does
    let fx = lot.faceX, fz = lot.faceZ;
    const faceLen = Math.hypot(fx, fz) || 1; fx /= faceLen; fz /= faceLen;

    let w, d, storeys, roof, verandahSides, wallFamily, kind;
    if (form) {
      w = form.w; d = form.d; storeys = form.storeys; roof = form.roof;
      verandahSides = form.verandah; wallFamily = form.colour; kind = form.kind;
      // premises are wider on their frontage and take the road square on
      w *= 0.94 + rng.float() * 0.16;
      d *= 0.94 + rng.float() * 0.16;
    } else {
      kind = 'house';
      const two = rng.float() < town.twoStoreyBias;
      switch (arch) {
        case 'beach-house':
          w = 10 + rng.float() * 5; d = 9 + rng.float() * 4; storeys = two ? 2 : 1;
          roof = rng.float() < 0.5 ? 'skillion' : 'gable'; verandahSides = 2;
          wallFamily = rng.float() < 0.5 ? 'timber' : 'weatherboard'; break;
        case 'modern-box':
          w = 11 + rng.float() * 6; d = 9 + rng.float() * 4; storeys = two ? 2 : 1;
          roof = 'flat'; verandahSides = 1;
          wallFamily = rng.float() < 0.45 ? 'render' : 'timber'; break;
        case 'units':
          w = 16 + rng.float() * 8; d = 11 + rng.float() * 3; storeys = 2 + (rng.float() < 0.35 ? 1 : 0);
          roof = 'flat'; verandahSides = 2; wallFamily = 'render'; kind = 'units'; break;
        case 'queenslander':
          w = 11 + rng.float() * 4; d = 10 + rng.float() * 3; storeys = 1;
          roof = rng.float() < 0.6 ? 'hip' : 'gable'; verandahSides = 3; wallFamily = 'weatherboard'; break;
        case 'fibro-shack':
        case 'fibro-cottage':
          w = 8 + rng.float() * 3.5; d = 7 + rng.float() * 3; storeys = 1;
          roof = rng.float() < 0.42 ? 'skillion' : 'gable'; verandahSides = 1; wallFamily = 'fibro'; break;
        case 'low-cottage':
          w = 9 + rng.float() * 3; d = 8 + rng.float() * 3; storeys = 1;
          roof = 'gable'; verandahSides = 1; wallFamily = rng.float() < 0.5 ? 'fibro' : 'weatherboard'; break;
        case 'newer-build':
          w = 12 + rng.float() * 4; d = 10 + rng.float() * 3; storeys = 1;
          roof = rng.float() < 0.5 ? 'hip' : 'flat'; verandahSides = 1; wallFamily = 'render'; break;
        case 'brick-lowset':
          w = 12 + rng.float() * 4; d = 9.5 + rng.float() * 3; storeys = 1;
          roof = 'hip'; verandahSides = 1; wallFamily = 'brick'; break;
        case 'duplex':
          w = 16 + rng.float() * 4; d = 9 + rng.float() * 2; storeys = 1;
          roof = 'hip'; verandahSides = 1; wallFamily = 'brick'; break;
        case 'shed':
          w = 8 + rng.float() * 5; d = 6.5 + rng.float() * 3.5; storeys = 1;
          roof = 'gable'; verandahSides = 0; wallFamily = 'colorbond'; kind = 'shed'; break;
        default:
          w = 10; d = 8.5; storeys = 1; roof = 'gable'; verandahSides = 1; wallFamily = 'fibro';
      }
    }

    // The pad. Sample the four corners and split the difference between cut and fill, then let the
    // stumps make up whatever is left. On the Point Lookout slope that is often more than a metre.
    const hw = w * 0.5, hd = d * 0.5;
    const rx = -fz, rz = fx;                        // right along the frontage
    const corner = (a, b) => ({ x: lot.x + rx * a + fx * b, z: lot.z + rz * a + fz * b });
    const cs = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
    let lo = Infinity, hi = -Infinity, sum = 0;
    const ch = cs.map((c) => {
      const h = island.height(c.x, c.z);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      sum += h;
      return h;
    });
    const mean = sum / 4;
    const fall = hi - lo;
    // Cut into the hill a little, fill a little, then stand on stumps for the rest.
    const pad = mean + (hi - mean) * 0.32;
    const highsetBias = arch === 'queenslander' ? 1 : arch === 'beach-house' ? 0.7 : 0.25;
    const baseStump = 0.42 + rng.float() * 0.34 + highsetBias * (0.35 + rng.float() * 1.5);
    const floor = pad + Math.max(baseStump, fall * 0.55 + 0.35);
    const stumpMax = floor - lo;
    const highset = stumpMax > 1.55;
    const cut = Math.max(0, hi - pad);

    const storeyH = kind === 'units' ? 3.0 : 2.72;
    const wallCols = WALL_COLOURS[wallFamily] || WALL_COLOURS.fibro;
    const wallCol = wallCols[Math.floor(rng.float() * wallCols.length)];
    const roofCol = ROOF_COLOURS[Math.floor(rng.float() * ROOF_COLOURS.length)];
    const roofPitch = roof === 'flat' ? 0.06 : roof === 'skillion' ? 0.20 : 0.30 + rng.float() * 0.09;

    // Which way is the water? Point Lookout turns its deck to the ocean; Amity turns it to the
    // bay and the sunset; Dunwich mostly turns it to the street, because Dunwich is a working town.
    let deckX = fx, deckZ = fz;
    if (rng.float() < town.deckToWater) {
      const seaward = waterBearing(lot.x, lot.z);
      if (seaward) { deckX = seaward.x; deckZ = seaward.z; }
    }

    // Windows are counted here rather than in the render layer, so the headless build knows how
    // many lights are on tonight without a GPU in the room.
    const phase = rng.float();
    const spacing = kind === 'units' ? 3.4 : 4.0;
    const nW = Math.max(1, Math.floor(w / spacing));
    const nD = Math.max(1, Math.floor(d / spacing));
    const windows = [];
    if (kind !== 'cemetery' && kind !== 'openair') {
      let wIdx = 0;
      for (let s = 0; s < 4; s++) {
        const n = s < 2 ? nW : nD;
        for (let st = 0; st < storeys; st++) {
          for (let i = 0; i < n; i++) windows.push((phase * 37.19 + (wIdx++) * 0.2637) % 1);
        }
      }
    }

    return {
      id: spec.id,
      label: spec.label,
      kind,
      archetype: arch,
      townId: spec.townId,
      x: lot.x, z: lot.z,
      fx, fz, rx, rz,
      deckX, deckZ,
      w, d, storeys, storeyH,
      roof, roofPitch, roofCol,
      wallCol, wallFamily,
      verandahSides,
      pad, floor, lo, hi, fall, cut, highset,
      lot,
      carport: kind === 'house' && rng.float() < 0.72,
      tank: rng.float() < (kind === 'house' ? town.tankRate : 0.5),
      solar: rng.float() < (kind === 'house' ? town.solarRate : 0.28),
      hoist: kind === 'house' && rng.float() < 0.55,
      boat: kind === 'house' && rng.float() < town.boatRate,
      fence: kind === 'house' && rng.float() < town.fenceRate,
      status: spec.status || 'dwelling',
      role: spec.role || null,
      employs: spec.employs || 0,
      source: spec.source || null,
      coordSource: spec.coordSource || 'generated on a lot off a mapped road',
      // occupancy: overwritten from the population system when it is loaded
      occupied: true,
      phase,
      nW, nD, spacing,
      windows
    };
  }

  /* ================================================================ 5. the read model */

  const byTown = {};
  for (const t of TOWNS) {
    const list = buildings.filter((b) => b.townId === t.id);
    byTown[t.id] = {
      name: t.name + (t.alt ? ` (${t.alt})` : ''),
      buildings: list.length,
      dwellings: list.filter((b) => b.kind === 'house').length,
      premises: list.filter((b) => b.label).length,
      censusDwellings: t.dwellings,
      censusOccupied: t.occupied
    };
  }

  const censusTotal = TOWNS.reduce((k, t) => k + t.dwellings, 0);
  if (dwellings.length < censusTotal - 4) {
    notes.push(`${dwellings.length} of ${censusTotal} modelled dwellings stand on a lot off a mapped `
      + 'road. The rest belong to streets that data/geography.json does not carry, and no street is '
      + 'invented to hold them.');
  }

  const state = world.publish('buildings', {
    ready: true,
    source: 'data/businesses.json and data/places.json for the named premises, '
      + 'ABS 2021 Census dwelling counts for the houses, laid out on data/geography.json roads',
    total: buildings.length,
    named: buildings.filter((b) => b.label).length,
    dwellings: dwellings.length,
    lots: lots.length,
    byTownship: byTown,
    occupiedTonight: 0,
    litWindows: 0,
    windows: buildings.reduce((k, b) => k + b.windows.length, 0),
    occupancySource: 'census baseline until the population system loads',
    withoutPremises: noPremises,
    notes,
    drawCalls: 0,
    instances: 0
  });

  /* ---- who is home tonight ------------------------------------------------
     The census says half the island's houses were empty on census night in August. That is the
     baseline. When src/systems/agents/population.js is loaded it knows which particular dwelling
     is a resident household, which is a holiday house and which is empty, and whether a visitor
     party is in it this week, so the lights follow the real thing instead of a percentage. */

  let occupancyDirty = true;   // the window instance buffer needs repacking
  let occupancyStale = true;   // who is home needs recomputing
  let linked = false;
  let occupancySource = 'census baseline';
  const dwellingLink = new Map();     // population dwelling id -> building

  function linkPopulation() {
    const R = world.residents;
    if (!R || !Array.isArray(R.dwellings) || !R.dwellings.length) return false;
    dwellingLink.clear();
    const pools = new Map();
    for (const t of TOWNS) pools.set(t.id, dwellings.filter((b) => b.townId === t.id));
    const cursor = new Map();
    // Nearest first, so a dwelling the population system put near the water stays near the water.
    for (const d of R.dwellings) {
      const pool = pools.get(d.townshipId);
      if (!pool || !pool.length) continue;
      let best = null, bd = Infinity, bi = -1;
      for (let i = 0; i < pool.length; i++) {
        const b = pool[i];
        if (b._claimed) continue;
        const dx = b.x - d.x, dz = b.z - d.z;
        const q = dx * dx + dz * dz;
        if (q < bd) { bd = q; best = b; bi = i; }
      }
      if (!best) {
        const k = cursor.get(d.townshipId) || 0;
        best = pool[k % pool.length];
        cursor.set(d.townshipId, k + 1);
      }
      best._claimed = true;
      best.dwellingId = d.id;
      dwellingLink.set(d.id, best);
      // One position for a house, not two. The population system sites dwellings on the land
      // cover mask; this layer sites them on a lot with a road in front of it, and the lot wins,
      // because that is where the building is actually drawn and where a person has to walk to.
      d.x = best.x; d.z = best.z;
      const comp = world.store.get ? world.store.get(d.id, 'dwelling') : null;
      if (comp) { comp.x = best.x; comp.z = best.z; }
    }
    for (const b of dwellings) delete b._claimed;
    occupancySource = 'population system: real households, holiday lets and visitor parties';
    return true;
  }

  function refreshOccupancy(w) {
    const R = w.residents;
    let occ = 0;
    if (R && dwellingLink.size) {
      for (const b of dwellings) { b._occ = false; b._holidayLet = false; }
      for (const d of R.dwellings) {
        const b = dwellingLink.get(d.id);
        if (!b) continue;
        if (d.use === 'holiday-home' || d.use === 'weekender') b._holidayLet = true;
        // More than one modelled dwelling can share a building where the pack's streets ran out,
        // so a duplex with one household in it still counts as a building with a light on.
        if (d.householdId || d.occupiedByPartyId) b._occ = true;
      }
      /* Holiday houses. The population system knows which dwellings are holiday lets and
         weekenders; who is in them on a given week is the visitor system's job. Until that system
         is loaded, a holiday house follows the one thing that is certain about it: it is mostly
         empty, and it fills in the school holidays. Half the dwellings on this island were empty
         on census night in August, against 9.3 per cent for Queensland, and that is the number a
         player should be able to see out the window. */
      const visitors = w.read('visitors');
      const holidayFill = visitors ? null : (w.clock.isQldSchoolHoliday ? 0.74 : 0.17);
      for (const b of dwellings) {
        if (b.dwellingId === undefined) b.occupied = b.phase < 0.494;
        else if (!b._occ && holidayFill !== null && b._holidayLet) b.occupied = b.phase < holidayFill;
        else b.occupied = b._occ;
        if (b.occupied) occ++;
      }
    } else {
      // census baseline, per township, and holidays fill the empty houses
      const holiday = w.clock.isQldSchoolHoliday ? 1 : 0;
      for (const b of dwellings) {
        const t = TOWNS.find((k) => k.id === b.townId) || TOWNS[0];
        const base = t.occupied / t.dwellings;
        const full = base + (1 - base) * (holiday ? 0.72 : 0.16);
        b.occupied = b.phase < full;
        if (b.occupied) occ++;
      }
    }
    for (const b of buildings) if (b.kind !== 'house') b.occupied = b.status !== 'closed';
    for (let i = 0; i < N; i++) litOcc[i] = buildings[i].occupied ? 1 : 0;
    state.occupiedTonight = occ;
    state.occupancySource = occupancySource;
    occupancyDirty = true;
    occupancyStale = false;
  }

  world.bus.on('population:ready', () => { linked = linkPopulation(); if (linked) refreshOccupancy(world); });
  for (const ev of ['household:moved-in', 'household:dissolved', 'household:left-the-island',
    'housing:lost-to-holiday-let', 'visitors:arrived', 'visitors:departed']) {
    world.bus.on(ev, () => { occupancyStale = true; });
  }

  /* ---- the system half ---------------------------------------------------- */

  let lastDay = -1;
  world.register({
    id: 'buildings',
    phase: 'infrastructure',
    order: 30,

    init(w) {
      refreshOccupancy(w);
    },

    tick(w) {
      if (w.clock.dayIndex !== lastDay || occupancyStale) {
        // a school holiday starting or ending changes who is in half the houses on this island
        lastDay = w.clock.dayIndex;
        if (!linked) linked = linkPopulation();
        refreshOccupancy(w);
      }
      state.litWindows = countLit(w);
    },

    describe(w) {
      return {
        buildings: state.total,
        named: state.named,
        dwellings: state.dwellings,
        occupiedTonight: state.occupiedTonight,
        occupiedPct: state.dwellings ? +((state.occupiedTonight / state.dwellings) * 100).toFixed(1) : 0,
        litWindows: state.litWindows,
        pointLookout: byTown['point-lookout'] ? byTown['point-lookout'].buildings : 0,
        dunwich: byTown.dunwich ? byTown.dunwich.buildings : 0,
        amityPoint: byTown['amity-point'] ? byTown['amity-point'].buildings : 0
      };
    },

    save() { return null; },
    load() {}
  });

  /* The same rule the window shader runs, on the CPU, so the probe reports the number that is
     actually on the screen rather than an estimate of it. Flat typed arrays and a binary search
     over each building's sorted window phases: eighteen thousand windows counted in about twenty
     microseconds, which is what a shared four millisecond tick budget can afford. */
  const N = buildings.length;
  const litStart = new Uint32Array(N + 1);
  const litWake = new Float32Array(N);
  const litSleep = new Float32Array(N);
  const litOcc = new Uint8Array(N);
  {
    let total = 0;
    for (let i = 0; i < N; i++) { litStart[i] = total; total += buildings[i].windows.length; }
    litStart[N] = total;
    var litPhase = new Float32Array(total);
    for (let i = 0; i < N; i++) {
      const b = buildings[i];
      b.index = i;
      const sorted = b.windows.slice().sort((p, q) => p - q);
      litPhase.set(sorted, litStart[i]);
      litWake[i] = 300 + b.phase * 165;
      litSleep[i] = 1275 + ((b.phase * 7.31) % 1) * 195;
    }
  }
  function countLit(w) {
    const dl = w.read('daylight');
    const dark = dl ? clamp((-dl.elevationDeg - 1) / 6, 0, 1) : 0;
    if (dark <= 0) return 0;
    const m = w.clock.minuteOfDay;
    const e = (m - 1140) / 190;
    const rooms = 0.30 + 0.56 * Math.exp(-e * e) + (m <= 720 ? 0.14 : 0);
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (!litOcc[i]) continue;
      if (m < litWake[i] || m > litSleep[i]) continue;
      let lo = litStart[i];
      let hi = litStart[i + 1];
      const base = lo;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (litPhase[mid] < rooms) lo = mid + 1; else hi = mid; }
      n += lo - base;
    }
    return Math.round(n * dark);
  }

  if (!B || !world.stage) return;

  /* ================================================================ 6. the geometry */

  const PARTS = {};
  const groups = new Map();       // key -> {parts: Map(part -> {m:[], c:[], l:[]}) }
  const GROUP_CELL = 420;
  let instanceCount = 0;

  /** Push one instance of a part. `detail` parts are cut by distance; the rest always draw. */
  function push(partName, detail, cellKeyStr, m, col, lit) {
    const key = detail ? 'd:' + cellKeyStr : 't:' + cellKeyStr;
    let g = groups.get(key);
    if (!g) { g = { detail, key, parts: new Map(), minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; groups.set(key, g); }
    let p = g.parts.get(partName);
    if (!p) { p = { m: [], c: [], l: [] }; g.parts.set(partName, p); }
    for (let i = 0; i < 16; i++) p.m.push(m[i]);
    p.c.push(col[0], col[1], col[2], col[3]);
    if (lit) p.l.push(lit[0], lit[1], lit[2], lit[3]);
    const x = m[12], z = m[14];
    if (x < g.minX) g.minX = x; if (x > g.maxX) g.maxX = x;
    if (z < g.minZ) g.minZ = z; if (z > g.maxZ) g.maxZ = z;
    instanceCount++;
  }

  // A column-major 4x4 for a box: scale, rotate about y by the frame (fx, fz), translate.
  const M = new Float32Array(16);
  function mat(cx, cy, cz, sx, sy, sz, ax, az) {
    // ax, az is the forward axis in xz; the right axis is (-az, ax)
    M[0] = -az * sx; M[1] = 0; M[2] = ax * sx; M[3] = 0;
    M[4] = 0; M[5] = sy; M[6] = 0; M[7] = 0;
    M[8] = ax * sz; M[9] = 0; M[10] = az * sz; M[11] = 0;
    M[12] = cx; M[13] = cy; M[14] = cz; M[15] = 1;
    return M;
  }
  /** Same, but tilted about the right axis by `pitch` radians. Used for solar panels and ramps. */
  const M2 = new Float32Array(16);
  function matPitch(cx, cy, cz, sx, sy, sz, ax, az, pitch) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    M2[0] = -az * sx; M2[1] = 0; M2[2] = ax * sx; M2[3] = 0;
    M2[4] = 0; M2[5] = c * sy; M2[6] = 0; M2[7] = 0;
    M2[8] = ax * c * sz; M2[9] = s * sz; M2[10] = az * c * sz; M2[11] = 0;
    M2[12] = cx; M2[13] = cy; M2[14] = cz; M2[15] = 1;
    return M2;
  }

  const shadowCasters = [];

  function emit(b) {
    const ck = `${Math.floor(b.x / GROUP_CELL)}:${Math.floor(b.z / GROUP_CELL)}`;
    const tk = b.townId;
    const fx = b.fx, fz = b.fz;
    const rx = b.rx, rz = b.rz;
    const wallC = [b.wallCol[0], b.wallCol[1], b.wallCol[2], b.wallFamily === 'brick' ? MAT.masonry
      : b.wallFamily === 'timber' ? MAT.timber : b.wallFamily === 'colorbond' ? MAT.iron : MAT.sheet];
    const roofC = [b.roofCol[0], b.roofCol[1], b.roofCol[2], MAT.iron];
    const trimC = [TIMBER[0], TIMBER[1], TIMBER[2], MAT.timber];
    const concC = [CONCRETE[0], CONCRETE[1], CONCRETE[2], MAT.masonry];
    const deckC = [DECKING[0], DECKING[1], DECKING[2], MAT.timber];

    if (b.kind === 'openair') return;

    /* Dunwich Cemetery. One of the earliest surviving cemeteries in Queensland, on Bingle Road,
       3.3 hectares, closed to new interments in 1952. It is drawn as what it is from the road: a
       fenced, mown enclosure with a gate. No markers are generated. Most of the ground here is
       unmarked, the identifications are still being added to a memorial wall by people doing
       careful work, and a procedural generator has no business inventing a single stone of it. */
    if (b.kind === 'cemetery') {
      const R0 = 92;
      const n = 96;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = b.x + Math.cos(a) * R0, pz = b.z + Math.sin(a) * R0 * 0.8;
        if (island.height(px, pz) < island.seaLevel + 0.6) continue;
        const g = island.height(px, pz);
        push('sbox', true, ck, mat(px, g, pz, 0.12, 1.15, 0.12, Math.cos(a), Math.sin(a)), trimC);
        const a2 = ((i + 0.5) / n) * Math.PI * 2;
        const qx = b.x + Math.cos(a2) * R0, qz = b.z + Math.sin(a2) * R0 * 0.8;
        push('sbox', true, ck, mat((px + qx) * 0.5, island.height(px, pz) + 0.92, (pz + qz) * 0.5,
          Math.hypot(qx - px, qz - pz) * 1.1, 0.07, 0.06, -Math.sin(a), Math.cos(a)), trimC);
      }
      return;
    }

    const bodyH = b.storeys * b.storeyH;
    const eave = b.floor + bodyH;

    /* --- the understorey: stumps, or a poured slab, or a closed-in ground floor --- */
    const stumpTop = b.floor - 0.12;
    if (b.highset) {
      // stumps on a grid under the floor, each one down to the ground it stands on
      const nx = Math.max(2, Math.round(b.w / 3.2));
      const nz = Math.max(2, Math.round(b.d / 3.2));
      for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
          if (i > 0 && i < nx && j > 0 && j < nz) continue;         // perimeter and one internal line
          const u = (i / nx - 0.5) * b.w, v = (j / nz - 0.5) * b.d;
          const px = b.x + rx * u + fx * v, pz = b.z + rz * u + fz * v;
          const g = island.height(px, pz);
          const h = Math.max(0.2, stumpTop - g);
          push('sbox', true, ck, mat(px, g, pz, 0.24, h, 0.24, fx, fz), concC);
        }
      }
      // the floor platform itself, so there is no daylight between the stumps and the walls
      push('box', false, tk, mat(b.x, stumpTop, b.z, b.w * 1.02, 0.24, b.d * 1.02, fx, fz), trimC);
    } else {
      // a slab on a low edge beam, plus whatever fill the pad needed on the low side
      const h = Math.max(0.22, b.floor - b.lo);
      push('box', false, tk, mat(b.x, b.floor - h, b.z, b.w * 1.04, h, b.d * 1.04, fx, fz), concC);
    }

    /* --- a retaining wall where the pad was cut into the slope. Point Lookout is full of them. */
    if (b.cut > 0.45) {
      const hgt = Math.min(2.4, b.cut + 0.15);
      // on the uphill side, which is whichever corner sampled highest
      const up = uphill(b);
      push('box', false, tk, mat(b.x + up.x * (b.d * 0.5 + 2.2), b.pad - 0.1, b.z + up.z * (b.d * 0.5 + 2.2),
        Math.max(b.w, b.d) * 1.15, hgt, 0.36, up.z, -up.x), concC);
    }

    /* --- the body --- */
    push('box', false, tk, mat(b.x, b.floor, b.z, b.w, bodyH, b.d, fx, fz), wallC);
    // a second, smaller wing on about a third of the houses, so no two silhouettes are the same
    let wing = null;
    if (b.kind === 'house' && b.w > 9.5 && ((b.phase * 100) % 1) < 0.42) {
      const ww = b.w * (0.38 + 0.2 * b.phase), wd = b.d * (0.5 + 0.2 * b.phase);
      const side = ((b.phase * 13) % 1) < 0.5 ? -1 : 1;
      wing = {
        x: b.x + rx * side * (b.w * 0.5 + ww * 0.42) + fx * (b.d * 0.12),
        z: b.z + rz * side * (b.w * 0.5 + ww * 0.42) + fz * (b.d * 0.12),
        w: ww, d: wd, h: b.storeyH
      };
      push('box', false, tk, mat(wing.x, b.floor, wing.z, ww, wing.h, wd, fx, fz), wallC);
      push(roofPart(b.roof), false, tk,
        mat(wing.x, b.floor + wing.h, wing.z, ww + 1.0, Math.max(0.28, wd * b.roofPitch * 0.5), wd + 1.0, fx, fz), roofC);
    }

    /* --- the roof --- */
    const roofRise = Math.max(0.3, Math.min(b.w, b.d) * b.roofPitch * 0.5);
    const over = b.kind === 'house' ? 0.92 : 0.7;           // deep eaves: this is the subtropics
    push(roofPart(b.roof), false, tk,
      mat(b.x, eave, b.z, b.w + over * 2, roofRise, b.d + over * 2, fx, fz), roofC);

    /* --- windows and the front door --- */
    const winY = b.floor + 0.95;
    const faces = [
      { nx: fx, nz: fz, half: b.w * 0.5, span: b.w, tan: [rx, rz] },
      { nx: -fx, nz: -fz, half: b.w * 0.5, span: b.w, tan: [-rx, -rz] },
      { nx: rx, nz: rz, half: b.d * 0.5, span: b.d, tan: [-fx, -fz] },
      { nx: -rx, nz: -rz, half: b.d * 0.5, span: b.d, tan: [fx, fz] }
    ];
    let wIdx = 0;
    for (let s = 0; s < 4; s++) {
      const f = faces[s];
      const n = s < 2 ? b.nW : b.nD;
      for (let st = 0; st < b.storeys; st++) {
        for (let i = 0; i < n; i++) {
          const u = ((i + 0.5) / n - 0.5) * f.span * 0.82;
          const px = b.x + f.tan[0] * u + f.nx * (f.half + 0.03);
          const pz = b.z + f.tan[1] * u + f.nz * (f.half + 0.03);
          const ww = b.kind === 'units' ? 2.1 : (s === 0 ? 2.3 : 1.5);
          const wh = b.kind === 'units' ? 1.9 : (s === 0 ? 1.75 : 1.25);
          const y = b.floor + 0.95 + st * b.storeyH;
          push('window', false, tk,
            mat(px, y, pz, ww, wh, 1, f.nx, f.nz),
            [0.09, 0.11, 0.13, MAT.metal],
            [b.phase, b.windows[wIdx] !== undefined ? b.windows[wIdx] : 0.5, b.occupied ? 1 : 0, s]);
          wIdx++;
        }
      }
    }
    // the front door
    push('door', false, tk, mat(b.x + fx * (b.d * 0.5 + 0.04) + rx * (b.w * 0.22), b.floor,
      b.z + fz * (b.d * 0.5 + 0.04) + rz * (b.w * 0.22), 0.95, 2.05, 1, fx, fz),
      [b.roofCol[0] * 0.5, b.roofCol[1] * 0.48, b.roofCol[2] * 0.46, MAT.timber]);

    /* --- verandah and deck: the one thing every one of these houses has --- */
    if (b.verandahSides > 0) {
      const sides = [];
      sides.push({ nx: b.deckX, nz: b.deckZ, span: b.w });
      if (b.verandahSides > 1) sides.push({ nx: fx, nz: fz, span: b.w });
      if (b.verandahSides > 2) sides.push({ nx: rx, nz: rz, span: b.d });
      const seen = new Set();
      for (const s of sides) {
        const k = `${Math.round(s.nx * 10)}:${Math.round(s.nz * 10)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const depth = 2.4 + b.phase * 0.9;
        const half = (Math.abs(s.nx * fx + s.nz * fz) > 0.7 ? b.d : b.w) * 0.5;
        const cx = b.x + s.nx * (half + depth * 0.5);
        const cz = b.z + s.nz * (half + depth * 0.5);
        // the deck floor
        push('box', false, tk, mat(cx, b.floor - 0.16, cz, s.span * 0.94, 0.16, depth, s.nx, s.nz), deckC);
        // the roof over it, a skillion falling away from the house
        const vTop = b.floor + b.storeyH - 0.15;
        push('skillion', false, tk,
          matPitch(cx, vTop - 0.5, cz, s.span * 0.98, 0.5, depth + 0.5, -s.nx, -s.nz, 0), roofC);
        // posts and a balustrade
        const nPosts = Math.max(2, Math.round(s.span / 2.6));
        const tx = -s.nz, tz = s.nx;
        for (let i = 0; i <= nPosts; i++) {
          const u = ((i / nPosts) - 0.5) * s.span * 0.94;
          const px = cx + tx * u + s.nx * (depth * 0.42);
          const pz = cz + tz * u + s.nz * (depth * 0.42);
          const g = island.height(px, pz);
          push('sbox', true, ck, mat(px, b.floor - 0.16, pz, 0.15, vTop - b.floor + 0.16, 0.15, s.nx, s.nz), trimC);
          if (b.highset) push('sbox', true, ck, mat(px, g, pz, 0.16, Math.max(0.2, b.floor - 0.16 - g), 0.16, s.nx, s.nz), trimC);
        }
        // top rail, bottom rail, infill
        const balY = b.floor - 0.16;
        const bx = cx + s.nx * (depth * 0.47), bz = cz + s.nz * (depth * 0.47);
        push('sbox', true, ck, mat(bx, balY + 0.94, bz, s.span * 0.94, 0.09, 0.10, s.nx, s.nz), trimC);
        push('sbox', true, ck, mat(bx, balY + 0.16, bz, s.span * 0.94, 0.08, 0.09, s.nx, s.nz), trimC);
        push('sbox', true, ck, mat(bx, balY + 0.26, bz, s.span * 0.94, 0.66, 0.045, s.nx, s.nz),
          [trimC[0] * 1.14, trimC[1] * 1.16, trimC[2] * 1.2, MAT.timber]);
      }
      // stairs down to the ground on the front
      if (b.floor - b.lo > 0.7) {
        const sx = b.x + fx * (b.d * 0.5 + 3.1) + rx * (b.w * 0.3);
        const sz = b.z + fz * (b.d * 0.5 + 3.1) + rz * (b.w * 0.3);
        const g = island.height(sx, sz);
        const rise = Math.max(0.4, b.floor - g);
        const steps = Math.max(2, Math.round(rise / 0.19));
        for (let i = 0; i < steps; i++) {
          const y = g + (i / steps) * rise;
          const t = 1 - (i / steps);
          push('sbox', true, ck, mat(sx + fx * t * 1.3, y, sz + fz * t * 1.3, 1.1, 0.16, 0.28, fx, fz), trimC);
        }
      }
    }

    /* --- carport, driveway, boat --- */
    if (b.carport) {
      const side = ((b.phase * 29) % 1) < 0.5 ? -1 : 1;
      const cw = 3.6, cd = 6.2;
      const cx = b.x + rx * side * (b.w * 0.5 + cw * 0.62) + fx * (b.d * 0.18);
      const cz = b.z + rz * side * (b.w * 0.5 + cw * 0.62) + fz * (b.d * 0.18);
      const g = island.height(cx, cz);
      const top = g + 2.55;
      push('box', false, tk, mat(cx, g + 0.03, cz, cw, 0.1, cd, fx, fz), concC);
      push('skillion', false, tk, mat(cx, top, cz, cw + 0.7, 0.32, cd + 0.6, rx * side, rz * side), roofC);
      for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = cx + rx * a * cw * 0.44 + fx * c * cd * 0.44;
        const pz = cz + rz * a * cw * 0.44 + fz * c * cd * 0.44;
        const pg = island.height(px, pz);
        push('sbox', true, ck, mat(px, pg, pz, 0.13, top - pg, 0.13, fx, fz), trimC);
      }
      if (b.boat) {
        push('boat', true, ck, mat(cx, g + 0.55, cz, 4.6, 1.5, 1.9, fz, -fx),
          [0.86, 0.87, 0.86, MAT.sheet]);
      }
      // The driveway out to the road it fronts, and only for the houses that actually front one.
      // A back block reaches its street through land the pack does not map, so it gets no drive
      // rather than a line of concrete across three neighbours' lawns.
      const dxr = b.lot.roadX - cx, dzr = b.lot.roadZ - cz;
      const dl = Math.hypot(dxr, dzr);
      if (b.lot.row === 0 && dl > 2 && dl < 42) {
        const steps = Math.max(1, Math.round(dl / 4));
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps;
          const px = cx + dxr * (t0 + 0.5 / steps), pz = cz + dzr * (t0 + 0.5 / steps);
          const g2 = island.height(px, pz);
          push('box', false, tk, mat(px, g2 + 0.02, pz, 3.0, 0.06, dl / steps + 0.4, dxr / dl, dzr / dl),
            [CONCRETE[0] * 0.94, CONCRETE[1] * 0.93, CONCRETE[2] * 0.9, MAT.masonry]);
        }
      }
    }

    /* --- tank, clothes line, solar, fence --- */
    if (b.tank) {
      const side = ((b.phase * 61) % 1) < 0.5 ? -1 : 1;
      const px = b.x + rx * side * (b.w * 0.5 + 1.5) - fx * (b.d * 0.3);
      const pz = b.z + rz * side * (b.w * 0.5 + 1.5) - fz * (b.d * 0.3);
      const g = island.height(px, pz);
      const dia = 2.1 + ((b.phase * 17) % 1) * 0.9;
      push('tank', true, ck, mat(px, g, pz, dia, 2.15 + ((b.phase * 5) % 1) * 0.5, dia, fx, fz),
        [0.612, 0.640, 0.628, MAT.iron]);
    }
    if (b.hoist) {
      const px = b.x - fx * (b.d * 0.5 + 5.5) + rx * (((b.phase * 23) % 1) - 0.5) * b.w;
      const pz = b.z - fz * (b.d * 0.5 + 5.5) + rz * (((b.phase * 23) % 1) - 0.5) * b.w;
      const g = island.height(px, pz);
      push('hoist', true, ck, mat(px, g, pz, 2.0, 1.95, 2.0, fx, fz), [0.72, 0.73, 0.72, MAT.metal]);
    }
    if (b.solar) {
      // Every panel on this island faces north, which in local metres is +z.
      const n = 2 + Math.floor(((b.phase * 11) % 1) * 5);
      const roofY = eave + roofRise * 0.42;
      for (let i = 0; i < n; i++) {
        const u = ((i + 0.5) / n - 0.5) * b.w * 0.7;
        const px = b.x + rx * u * 0.4 + fx * u * 0.4;
        const pz = b.z + rz * u * 0.4 + fz * u * 0.4 + 0.6;
        push('sbox', true, ck, matPitch(px, roofY, pz, 1.6, 0.06, 1.0, 0, 1, -0.26),
          [0.088, 0.096, 0.128, MAT.metal]);
      }
    }
    if (b.fence) {
      const half = b.w * 0.62;
      const fxr = b.x + fx * (b.d * 0.5 + b.lot.frontageDist * 0.42);
      const fzr = b.z + fz * (b.d * 0.5 + b.lot.frontageDist * 0.42);
      const g = island.height(fxr, fzr);
      push('sbox', true, ck, mat(fxr, g, fzr, half * 2, 1.05, 0.09, fx, fz),
        [trimC[0] * 1.2, trimC[1] * 1.2, trimC[2] * 1.18, MAT.timber]);
    }

    shadowCasters.push(b);
  }

  function roofPart(kind) {
    return kind === 'hip' ? 'hip' : kind === 'gable' ? 'gable' : 'skillion';
  }
  function uphill(b) {
    // which way the ground rises, from four samples around the pad
    const dx = island.height(b.x + b.rx * 8, b.z + b.rz * 8) - island.height(b.x - b.rx * 8, b.z - b.rz * 8);
    const dz = island.height(b.x + b.fx * 8, b.z + b.fz * 8) - island.height(b.x - b.fx * 8, b.z - b.fz * 8);
    const L = Math.hypot(dx, dz) || 1;
    return { x: (b.rx * dx + b.fx * dz) / L, z: (b.rz * dx + b.fz * dz) / L };
  }

  /* --- the Amity Point rock wall -------------------------------------------
     The foreshore at Amity has been retreating since 1886 and the jetty entry in data/places.json
     records rock seawall on either side of it. This lays that wall along the waterline through the
     published erosion and slump zone, and the lot pass above has already refused to put a house
     inside it, so there is a line of empty ground behind the rocks. That gap is the story. */

  function buildRevetment() {
    const zone = placesPack.find((p) => p.id === 'amity-erosion-zone');
    const jetty = placesPack.find((p) => p.id === 'amity-jetty');
    if (!zone || !Number.isFinite(zone.lon)) return 0;
    const c = island.project(zone.lon, zone.lat);
    const anchor = jetty && Number.isFinite(jetty.lon) ? island.project(jetty.lon, jetty.lat) : c;
    let n = 0;
    const ck = `${Math.floor(c.x / GROUP_CELL)}:${Math.floor(c.z / GROUP_CELL)}`;
    // walk the waterline either side of the zone centre
    for (let a = 0; a < 260; a++) {
      const th = (a / 260) * Math.PI * 2;
      const dx = Math.sin(th), dz = Math.cos(th);
      // find the waterline along this bearing from the zone centre
      let hit = null;
      for (let r = 20; r < 420; r += 6) {
        const x = c.x + dx * r, z = c.z + dz * r;
        if (island.height(x, z) < island.seaLevel + 0.35) { hit = { x, z, r }; break; }
      }
      if (!hit) continue;
      const dxa = hit.x - anchor.x, dza = hit.z - anchor.z;
      if (dxa * dxa + dza * dza > 420 * 420) continue;
      const g = island.height(hit.x, hit.z);
      // Armour rock is graded, not sorted: sizes, seats and orientations all wander, and two rows
      // that match each other read as a row of bollards rather than as a wall somebody tipped.
      const j1 = ((a * 7919) % 97) / 97, j2 = ((a * 104729) % 89) / 89, j3 = ((a * 65537) % 71) / 71;
      const sz = 0.85 + j1 * 1.35;
      const ang = j2 * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      push('rock', true, ck, mat(hit.x - dx * (0.7 + j3 * 1.6), g - 0.30 - j2 * 0.25, hit.z - dz * (0.7 + j3 * 1.6),
        sz * 1.45, sz * (0.72 + j3 * 0.5), sz * 1.25, ca, sa),
        [0.352 + j1 * 0.07, 0.336 + j1 * 0.06, 0.314 + j1 * 0.05, MAT.masonry]);
      if (j2 > 0.28) {
        push('rock', true, ck, mat(hit.x - dx * (2.4 + j1 * 1.8), g + 0.18 + j1 * 0.5, hit.z - dz * (2.4 + j1 * 1.8),
          sz * 1.1, sz * (0.6 + j1 * 0.45), sz * 1.05, sa, -ca),
          [0.392 + j3 * 0.06, 0.374 + j3 * 0.05, 0.346 + j3 * 0.05, MAT.masonry]);
        n++;
      }
      n++;
    }
    return n;
  }

  /* ================================================================ 7. the layer */

  const RS = {
    ready: false, meshes: [], mat: null, winMat: null, shadowMat: null,
    shadowMesh: null, shadowLastAz: -99, shadowLastAlt: -99, shadowVerts: 0,
    shadowCamX: 1e9, shadowCamZ: 1e9,
    winBuffers: [], enabled: 0, buildMs: 0, rocks: 0
  };
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 0.9, 0.8, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.85, 0.4);
  const vTune = new B.Vector4(0.000045, 0, 0, island.seaLevel);
  const vLight = new B.Vector4(0, 0, 0, 0);
  const vShadow = new B.Vector4(0.5, 0, 0, 0);
  const camPos = new B.Vector3();

  world.stage.addLayer({
    id: 'buildings',
    order: 26,

    init(stage) {
      const scene = stage.scene;
      const t0 = performance.now();

      const opaque = new B.ShaderMaterial('buildingMat', scene,
        { vertexSource: BUILD_VERT, fragmentSource: BUILD_FRAG },
        {
          attributes: ['position', 'normal', 'world0', 'world1', 'world2', 'world3', 'instCol'],
          uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune']
        });
      opaque.backFaceCulling = true;
      RS.mat = opaque;

      const winMat = new B.ShaderMaterial('windowMat', scene,
        { vertexSource: WINDOW_VERT, fragmentSource: WINDOW_FRAG },
        {
          attributes: ['position', 'normal', 'world0', 'world1', 'world2', 'world3', 'instCol', 'instLit'],
          uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uLight']
        });
      winMat.backFaceCulling = true;
      RS.winMat = winMat;

      const shMat = new B.ShaderMaterial('buildingShadowMat', scene,
        { vertexSource: SHADOW_VERT, fragmentSource: SHADOW_FRAG },
        {
          attributes: ['position', 'color'],
          uniforms: ['viewProjection', 'uCam', 'uTune', 'uShadow'],
          needAlphaBlending: true
        });
      shMat.backFaceCulling = false;
      shMat.alphaMode = B.Engine.ALPHA_COMBINE;
      shMat.zOffset = -8;
      shMat.disableDepthWrite = true;
      RS.shadowMat = shMat;

      PARTS.box = unitBox(scene, 'p-box');
      PARTS.sbox = unitBox(scene, 'p-sbox');
      PARTS.gable = unitGable(scene, 'p-gable');
      PARTS.hip = unitHip(scene, 'p-hip');
      PARTS.skillion = unitSkillion(scene, 'p-skillion');
      PARTS.window = unitQuad(scene, 'p-window');
      PARTS.door = unitQuad(scene, 'p-door');
      PARTS.tank = unitTank(scene, 'p-tank');
      PARTS.hoist = unitHoist(scene, 'p-hoist');
      PARTS.boat = unitBoat(scene, 'p-boat');
      PARTS.rock = unitRock(scene, 'p-rock');

      for (const b of buildings) emit(b);
      RS.rocks = buildRevetment();

      // One mesh per part per group. A group is a township for the parts that always draw and a
      // four hundred metre cell for the small detail that only draws when you are close enough to
      // see it, which is what keeps the whole island inside the draw call budget.
      for (const [key, g] of groups) {
        for (const [partName, p] of g.parts) {
          const src = PARTS[partName];
          if (!src) continue;
          const mesh = realiseMesh(scene, `b-${partName}-${key}`, src);
          mesh.material = partName === 'window' ? winMat : opaque;
          mesh.thinInstanceSetBuffer('matrix', new Float32Array(p.m), 16, true);
          mesh.thinInstanceSetBuffer('instCol', new Float32Array(p.c), 4, true);
          if (p.l.length) mesh.thinInstanceSetBuffer('instLit', new Float32Array(p.l), 4, false);
          mesh.thinInstanceRefreshBoundingInfo(true);
          mesh.alwaysSelectAsActiveMesh = false;
          mesh._twinGroup = g;
          mesh._twinPart = partName;
          if (partName === 'window') RS.winBuffers.push(mesh);
          RS.meshes.push(mesh);
        }
      }

      // the shadow mesh, rebuilt when the sun moves
      RS.shadowMesh = new B.Mesh('building-shadows', scene);
      RS.shadowMesh.material = shMat;
      RS.shadowMesh.isPickable = false;
      RS.shadowMesh.alwaysSelectAsActiveMesh = true;
      RS.shadowMesh.doNotSyncBoundingInfo = true;
      RS.shadowMesh.alphaIndex = 2;

      RS.ready = true;
      RS.buildMs = performance.now() - t0;
      state.instances = instanceCount;
      state.drawCalls = RS.meshes.length;
      state.windows = buildings.reduce((s, b) => s + b.windows.length, 0);
      console.info(`[buildings] ${buildings.length} buildings (${state.named} named premises, `
        + `${dwellings.length} dwellings) from ${lots.length} lots, ${instanceCount} instances in `
        + `${RS.meshes.length} meshes, ${state.windows} windows, ${RS.rocks} rocks on the Amity wall, `
        + `built in ${RS.buildMs.toFixed(0)} ms`);
      if (notes.length) for (const n of notes) console.info('[buildings] ' + n);
    },

    frame(stage, w, dt) {
      if (!RS.ready) return;
      const cam = stage.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);
      const dl = w.read('daylight');
      const wx = w.read('weather');

      const alt = dl ? dl.altitude : 0.9;
      const az = dl ? dl.azimuth : 0.4;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(
        0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF,
        0.4
      );
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      const wet = wx ? clamp(wx.rainMmHr / 5, 0, 1) : 0;
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), wet, 0, island.seaLevel);

      // The window shader needs to know how dark it is, what time it is, and how big one metre is
      // on screen at one metre away, so a distant lit window can be held above a pixel.
      const elev = dl ? dl.elevationDeg : 20;
      const dark = clamp((-elev - 1) / 6, 0, 1);
      const fovScale = 1 / Math.max(1, stage.engine.getRenderHeight()) * 2 * Math.tan((cam.fov || 0.8) * 0.5) * 1.6;
      vLight.set(dark, w.clock.minuteOfDay / 1440, 0, fovScale);

      RS.mat.setVector3('uCam', camPos);
      RS.mat.setVector4('uSun', vSun);
      RS.mat.setVector4('uSunCol', vSunCol);
      RS.mat.setVector4('uSky', vSky);
      RS.mat.setVector4('uSkyHz', vSkyHz);
      RS.mat.setVector4('uTune', vTune);
      RS.winMat.setVector3('uCam', camPos);
      RS.winMat.setVector4('uSun', vSun);
      RS.winMat.setVector4('uSunCol', vSunCol);
      RS.winMat.setVector4('uSky', vSky);
      RS.winMat.setVector4('uSkyHz', vSkyHz);
      RS.winMat.setVector4('uTune', vTune);
      RS.winMat.setVector4('uLight', vLight);
      RS.shadowMat.setVector3('uCam', camPos);
      RS.shadowMat.setVector4('uTune', vTune);
      // Ambient light on a sand island bounces hard: a cast shadow here is a soft grey, not a hole.
      vShadow.set(clamp(dayF * 1.05, 0, 1) * (1 - cloud * 0.62) * 0.44, 0, 0, 0);
      RS.shadowMat.setVector4('uShadow', vShadow);

      /* --- level of detail. The small parts only draw where they can be seen. --- */
      const ground = island.height(camPos.x, camPos.z);
      const height = camPos.y - ground;
      const detailRange = height > 900 ? 0 : clamp(2400 - height * 1.4, 400, 1500);
      let on = 0;
      for (const m of RS.meshes) {
        const g = m._twinGroup;
        let want = true;
        if (g.detail) {
          const cx = (g.minX + g.maxX) * 0.5, cz = (g.minZ + g.maxZ) * 0.5;
          const dx = cx - camPos.x, dz = cz - camPos.z;
          want = detailRange > 0 && (dx * dx + dz * dz) < detailRange * detailRange;
        }
        if (m.isEnabled(false) !== want) m.setEnabled(want);
        if (want) on++;
      }
      RS.enabled = on;

      /* --- ground shadows, rebuilt when the sun has moved far enough to see --- */
      const azDeg = az * 180 / Math.PI, altDeg = alt * 180 / Math.PI;
      const moved = Math.abs(azDeg - RS.shadowLastAz) + Math.abs(altDeg - RS.shadowLastAlt);
      // The camera matters as much as the sun does: shadows are built for what is near enough to
      // see, so walking into a township has to trigger a rebuild the same way an hour passing does.
      const camMoved = Math.hypot(camPos.x - RS.shadowCamX, camPos.z - RS.shadowCamZ);
      if (moved > 0.7 || camMoved > 220 || RS.shadowVerts === 0) {
        RS.shadowLastAz = azDeg; RS.shadowLastAlt = altDeg;
        RS.shadowCamX = camPos.x; RS.shadowCamZ = camPos.z;
        rebuildShadows(alt, az, camPos);
      }
      state.shadowPolys = RS.shadowVerts;
      state.casters = shadowCasters.length;

      // Window occupancy only changes when somebody moves house or a holiday party arrives.
      if (occupancyDirty) { refreshWindowBuffers(); occupancyDirty = false; }
    },

    dispose() {
      for (const m of RS.meshes) m.dispose();
      RS.meshes.length = 0;
      if (RS.shadowMesh) RS.shadowMesh.dispose();
      for (const m of [RS.mat, RS.winMat, RS.shadowMat]) if (m) m.dispose();
      RS.ready = false;
    }
  });

  /** Repack the per-window occupancy flag. Twelve thousand floats, a few times a sim-year. */
  function refreshWindowBuffers() {
    for (const mesh of RS.winBuffers) {
      const g = mesh._twinGroup;
      const p = g.parts.get('window');
      if (!p || !p.l.length) continue;
      const buf = new Float32Array(p.l);
      // instLit.z is the occupancy flag; walk the buildings in the same order they were emitted
      let i = 0;
      for (const b of buildings) {
        if (b.townId !== g.key.slice(2)) continue;
        for (let k = 0; k < b.windows.length; k++, i++) {
          if (i * 4 + 2 < buf.length) buf[i * 4 + 2] = b.occupied ? 1 : 0;
        }
      }
      mesh.thinInstanceSetBuffer('instLit', buf, 4, false);
    }
  }

  /**
   * Project every nearby building's footprint along the sun and lay the shape on the ground. The
   * terrain runs its own shader and does not read a shadow map, so this is how a town gets shadows
   * that lengthen through the afternoon and swing round with the sun.
   */
  function rebuildShadows(alt, az, cam) {
    if (!RS.shadowMesh) return;
    if (alt < 0.06) {
      RS.shadowMesh.setEnabled(false);
      RS.shadowVerts = 1;
      return;
    }
    RS.shadowMesh.setEnabled(true);
    const sx = -Math.sin(az), sz = -Math.cos(az);        // the direction a shadow travels
    const stretch = clamp(1 / Math.tan(alt), 0.35, 3.4);
    const pos = [], col = [], idx = [];
    const RANGE = 2600 * 2600;
    for (const b of shadowCasters) {
      const dx = b.x - cam.x, dz = b.z - cam.z;
      if (dx * dx + dz * dz > RANGE) continue;
      const h = (b.floor - b.pad) + b.storeys * b.storeyH + b.w * b.roofPitch * 0.4;
      const ox = sx * h * stretch, oz = sz * h * stretch;
      const hw = b.w * 0.5 + 0.5, hd = b.d * 0.5 + 0.5;
      const c = [];
      for (const [a, e] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        c.push([b.x + b.rx * a + b.fx * e, b.z + b.rz * a + b.fz * e]);
      }
      const hull = convexHull(c.concat(c.map((p) => [p[0] + ox, p[1] + oz])));
      if (hull.length < 3) continue;
      const base = pos.length / 3;
      for (const p of hull) {
        pos.push(p[0], island.height(p[0], p[1]) + 0.07, p[1]);
        // the far end of the shadow is softer than the contact edge
        const t = ((p[0] - b.x) * sx + (p[1] - b.z) * sz) / Math.max(1, h * stretch);
        col.push(0, 0, 0, clamp(1 - t * 0.62, 0.12, 1));
      }
      for (let i = 1; i < hull.length - 1; i++) idx.push(base, base + i, base + i + 1);
    }
    if (!idx.length) { RS.shadowMesh.setEnabled(false); RS.shadowVerts = 1; return; }
    const vd = new B.VertexData();
    vd.positions = new Float32Array(pos);
    vd.colors = new Float32Array(col);
    vd.indices = pos.length / 3 > 65000 ? new Uint32Array(idx) : new Uint16Array(idx);
    vd.applyToMesh(RS.shadowMesh, true);
    RS.shadowVerts = pos.length / 3;
  }

  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }
}
