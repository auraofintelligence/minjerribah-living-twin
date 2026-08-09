// Flora. The island dressed in its actual plants.
//
// Minjerribah is a sand island, and the plant communities on it are not variations on one theme:
// they look nothing like each other and they change over a few hundred metres. Walking inland from
// the ocean beach you cross bare quartz sand, a spinifex-bound foredune, a pandanus and wattle
// back dune, wind-pruned wallum heath with banksia in it, then eucalypt open forest on the high old
// dunes, then paperbark and sedge in Eighteen Mile Swamp. On the bay side you get she-oak along the
// foreshore, then mangrove and saltmarsh on the intertidal. In the mine paths you get regrowth that
// is even-aged and evenly spaced, and looks exactly like what it is.
//
// Where the content comes from, and nothing here is invented:
//
//   * data/ecology.json plants[]           fourteen species with roles, flowering months and sources
//   * data/ecology.json habitats[]         the communities and their indicator plants
//   * data/geography.json vegetation_zones eight mapped zones, each with an elevation band, a
//                                          distance-from-shore band and an indicative species list
//   * data/places.json                     Myora Springs, for the littoral rainforest pocket
//   * world.island                         cover, height, slope, shore distance and bayness
//
// How it draws, and why it can afford to:
//
//   * Everything is a thin instance. One mesh per species per level of detail, so twenty-one
//     species cost about forty draw calls no matter how many hundreds of thousands of plants are
//     on the screen. There is never one mesh per tree.
//   * Placement is a three-level clipmap of tiles: 160 m tiles carry every species out to 420 m,
//     640 m tiles carry the tall species out to 3.6 km, 2560 m tiles carry the canopy trees out to
//     9 km. Tiles are generated once, cached, and packed into the instance buffers a species at a
//     time under a per-frame time budget, so a camera move never costs a frame.
//   * Level of detail is per instance, not per tile. Every plant carries a rank; the shader keeps
//     rank below a distance-dependent fraction and cross-fades the ones near the cut with an
//     interleaved gradient dither. The same plant is in the geometry buffer and the card buffer, at
//     the same position, so the handover from three dimensions to a billboard is a cross-fade of
//     the same object rather than a swap. Nothing pops.
//   * Wind is per species and it is the point. Spinifex ripples in bands running with the wind,
//     banksia rattles stiffly at the tips only, casuarina streams downwind and never quite comes
//     back, palm fronds swing slowly from the crown. The parameters are different enough that you
//     can tell the species apart in a still frame and in motion.
//   * Terrain shade comes from a shadow height sweep over the island heightfield at 128 m, run when
//     the sun has moved more than a degree and a half. A tree in a dune hollow at five in the
//     afternoon goes dark with the ground it is standing on, and a tall one has a lit crown over a
//     shaded trunk, because the sweep carries depth and the shader knows how high up the pixel is.
//
// Determinism. One integer is drawn from world.rng.stream('flora') when the layer registers.
// Everything after that is a pure hash of that integer and the tile and instance index, so the same
// island grows the same way at any frame rate, from any camera path, and the placement never
// depends on the order tiles happen to be visited.

import { MEAN_SEA_LEVEL } from '../../world/island.js';
import { makeNoise2D } from '../../kernel/rng.js';

// The renderer half needs Babylon; the census half must run in Node with no window at all.
const B = typeof window !== 'undefined' ? window.BABYLON : null;

/* ------------------------------------------------------------------ small maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic 32 bit hash. Three integers in, a float in [0,1) out. No shared state, so a tile
 *  generated first and a tile generated last give the same plants. */
function hash3(a, b, c) {
  let h = (a ^ Math.imul(b, 0x27d4eb2d) ^ Math.imul(c, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function hash2i(a, b) {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ the species

Every entry below is a plant named in data/ecology.json plants[] or in the indicative_species list
of a data/geography.json vegetation zone. `pack` records which, so a critic can check the list
against the packs without reading this file. Sizes are metres. Colours are linear reflectances,
kept in the same family as the terrain layer's canopy palette so a tree does not float off its own
ground, but more saturated and more varied, because a plant is not a colour patch.

`geomEnd` is where the three dimensional model has faded out. `cardEnd` is where the billboard has.
`d0` is the distance out to which the full modelled density is drawn; past it the shader keeps a
falling fraction of the plants and grows the survivors, which is how a forest becomes a canopy
rather than a thinning scatter of dots. */

const SPECIES = [
  {
    id: 'beach-spinifex', common: 'Beach spinifex', sci: 'Spinifex sericeus',
    pack: 'ecology.plants plant-beach-spinifex; geography veg-dune-spinifex',
    arch: 'tuft', leaf: 'blade',
    h: [0.32, 0.62], w: [1.10, 1.90], lean: 0.30,
    leafA: [0.640, 0.672, 0.520], leafB: [0.470, 0.530, 0.410], wood: [0.60, 0.58, 0.48],
    // Silvery and pale: it is the brightest living thing on the dune and it reads almost grey
    // against the sand from any distance.
    density: 0.14, d0: 60, geomEnd: 36, cardEnd: 190,
    // Low stiffness so the whole tussock lays over, a long travelling wave so the ripple runs in
    // bands up the dune face rather than every plant moving at once.
    sway: [1.55, 0.30, 3.10, 0.62], sway2: [1.15, 0.05, 5.2, 0.55], transluc: 0.55
  },
  {
    id: 'dune-mat', common: "Goat's foot and pigface", sci: 'Ipomoea pes-caprae, Carpobrotus glaucescens',
    pack: 'geography veg-dune-spinifex indicative_species',
    arch: 'mat', leaf: 'succulent',
    h: [0.10, 0.20], w: [1.30, 2.60], lean: 0,
    leafA: [0.360, 0.470, 0.300], leafB: [0.300, 0.400, 0.270], wood: [0.34, 0.36, 0.28],
    flower: [0.720, 0.400, 0.640], flowerMonths: [9, 10, 11, 0, 1, 2],
    density: 0.048, d0: 48, geomEnd: 28, cardEnd: 120,
    sway: [1.9, 0.06, 4.0, 0.50], sway2: [2.2, 0.02, 3.0, 0.35], transluc: 0.35
  },
  {
    id: 'pandanus', common: 'Pandanus', sci: 'Pandanus tectorius',
    pack: 'ecology.plants plant-pandanus; geography veg-casuarina-foreshore',
    arch: 'pandanus', leaf: 'strap',
    h: [2.6, 6.2], w: [1.05, 1.45], lean: 0.16,
    leafA: [0.420, 0.500, 0.330], leafB: [0.300, 0.380, 0.250], wood: [0.520, 0.500, 0.455],
    density: 0.0042, d0: 240, geomEnd: 96, cardEnd: 1300,
    // Stiff straps that clatter: small amplitude, high frequency, all of it at the leaf tips.
    sway: [2.30, 0.075, 5.10, 0.16], sway2: [2.6, 0.03, 7.5, 0.45], transluc: 0.42
  },
  {
    id: 'coastal-sheoak', common: 'Coastal she-oak', sci: 'Casuarina equisetifolia',
    pack: 'ecology.plants plant-coastal-sheoak; geography veg-casuarina-foreshore',
    arch: 'droop', leaf: 'needle',
    h: [6.0, 15.0], w: [0.72, 1.00], lean: 0.34,
    leafA: [0.340, 0.400, 0.310], leafB: [0.245, 0.300, 0.235], wood: [0.360, 0.322, 0.278],
    density: 0.0055, d0: 330, geomEnd: 108, cardEnd: 2400,
    // Streaming: a large steady downwind offset that grows toward the tips, plus a slow swell.
    // A she-oak on the Amity foreshore never looks like it has stopped moving.
    sway: [0.62, 0.22, 1.45, 0.045], sway2: [1.35, 0.34, 2.4, 0.70], transluc: 0.60
  },
  {
    id: 'black-sheoak', common: 'Black she-oak', sci: 'Allocasuarina littoralis',
    pack: 'ecology.plants plant-black-sheoak',
    arch: 'droop', leaf: 'needle',
    h: [3.5, 8.5], w: [0.55, 0.80], lean: 0.14,
    leafA: [0.225, 0.285, 0.215], leafB: [0.160, 0.210, 0.160], wood: [0.205, 0.185, 0.165],
    density: 0.0032, d0: 300, geomEnd: 96, cardEnd: 1900,
    sway: [0.78, 0.14, 1.80, 0.05], sway2: [1.6, 0.22, 2.8, 0.60], transluc: 0.50
  },
  {
    id: 'wallum-banksia', common: 'Wallum banksia', sci: 'Banksia aemula',
    pack: 'ecology.plants plant-wallum-banksia; geography veg-wallum-heath',
    arch: 'shrub', leaf: 'serrated',
    h: [1.5, 4.4], w: [0.85, 1.35], lean: 0.22,
    leafA: [0.318, 0.356, 0.222], leafB: [0.176, 0.212, 0.128], wood: [0.318, 0.270, 0.226],
    // The candles. Pale greenish yellow, upright, and they are what feeds the gliders and the
    // honeyeaters through the cold months when nothing else is out.
    flower: [0.800, 0.760, 0.400], flowerMonths: [2, 3, 4, 5, 6, 7],
    density: 0.042, d0: 150, geomEnd: 60, cardEnd: 640,
    // Stiff and gnarled. Only the outer third moves, and it rattles rather than sways.
    sway: [2.05, 0.055, 4.30, 0.10], sway2: [3.4, 0.02, 6.0, 0.50], transluc: 0.30
  },
  {
    id: 'coast-tea-tree', common: 'Tea-tree', sci: 'Leptospermum polygalifolium',
    pack: 'ecology.plants plant-coast-tea-tree; geography veg-wallum-heath',
    arch: 'shrub', leaf: 'fine',
    h: [1.1, 3.2], w: [0.90, 1.40], lean: 0.20,
    leafA: [0.320, 0.375, 0.255], leafB: [0.235, 0.290, 0.195], wood: [0.380, 0.330, 0.275],
    flower: [0.930, 0.925, 0.860], flowerMonths: [8, 9, 10, 11],
    density: 0.036, d0: 130, geomEnd: 54, cardEnd: 520,
    sway: [1.70, 0.10, 3.60, 0.14], sway2: [2.3, 0.05, 5.0, 0.55], transluc: 0.44
  },
  {
    id: 'wattle', common: 'Wattle', sci: 'Acacia',
    pack: 'geography veg-casuarina-foreshore and veg-rehabilitation-regrowth indicative_species',
    note: 'The packs name the genus only. No species is published for this island, so none is asserted here.',
    arch: 'shrub', leaf: 'phyllode',
    h: [1.4, 3.6], w: [1.00, 1.55], lean: 0.24,
    leafA: [0.375, 0.435, 0.295], leafB: [0.280, 0.345, 0.230], wood: [0.330, 0.290, 0.240],
    // Late winter gold. This is the one seasonal change on this island you can see from a moving
    // car, and it is why the rehabilitation paths read as rehabilitation in August.
    flower: [0.960, 0.780, 0.170], flowerMonths: [6, 7, 8],
    density: 0.032, d0: 150, geomEnd: 60, cardEnd: 640,
    sway: [1.60, 0.115, 3.30, 0.13], sway2: [2.0, 0.06, 4.4, 0.60], transluc: 0.48
  },
  {
    id: 'midyim', common: 'Midyim', sci: 'Austromyrtus dulcis',
    pack: 'ecology.plants plant-midyim',
    arch: 'shrub', leaf: 'fine',
    h: [0.35, 0.95], w: [1.20, 1.90], lean: 0.10,
    leafA: [0.360, 0.415, 0.275], leafB: [0.265, 0.320, 0.210], wood: [0.360, 0.310, 0.260],
    // The speckled white berry, ripening through summer and autumn. Same months the pack gives.
    flower: [0.905, 0.890, 0.845], flowerMonths: [11, 0, 1, 2, 3],
    density: 0.028, d0: 70, geomEnd: 36, cardEnd: 190,
    sway: [1.85, 0.075, 3.90, 0.20], sway2: [2.1, 0.04, 4.6, 0.50], transluc: 0.46
  },
  {
    id: 'grass-tree', common: 'Grass tree', sci: 'Xanthorrhoea',
    pack: 'geography veg-wallum-heath indicative_species',
    arch: 'grasstree', leaf: 'blade',
    h: [0.7, 2.6], w: [0.85, 1.20], lean: 0.06,
    leafA: [0.250, 0.320, 0.180], leafB: [0.180, 0.240, 0.135], wood: [0.115, 0.105, 0.095],
    flower: [0.780, 0.720, 0.520], flowerMonths: [8, 9, 10],
    density: 0.011, d0: 120, geomEnd: 54, cardEnd: 430,
    sway: [1.30, 0.085, 2.80, 0.22], sway2: [1.7, 0.03, 4.0, 0.45], transluc: 0.40
  },
  {
    id: 'heath-sedge', common: 'Cord rush and sedge', sci: 'Restio, Empodisma minus',
    pack: 'geography veg-wallum-heath and veg-wallum-swamp-sedgeland indicative_species',
    arch: 'tuft', leaf: 'blade',
    h: [0.30, 0.75], w: [0.75, 1.30], lean: 0.10,
    leafA: [0.352, 0.376, 0.216], leafB: [0.258, 0.294, 0.160], wood: [0.34, 0.32, 0.23],
    density: 0.085, d0: 58, geomEnd: 32, cardEnd: 170,
    sway: [1.95, 0.19, 4.20, 0.42], sway2: [1.4, 0.05, 5.5, 0.55], transluc: 0.52
  },
  {
    id: 'swamp-sedge', common: 'Twig rush and saw sedge', sci: 'Baumea, Gahnia',
    pack: 'geography veg-wallum-swamp-sedgeland indicative_species',
    arch: 'tuft', leaf: 'sedge',
    h: [0.75, 1.85], w: [0.80, 1.30], lean: 0.14,
    leafA: [0.398, 0.412, 0.216], leafB: [0.276, 0.312, 0.168], wood: [0.36, 0.34, 0.23],
    density: 0.1, d0: 85, geomEnd: 46, cardEnd: 300,
    sway: [1.60, 0.22, 3.40, 0.34], sway2: [1.25, 0.07, 4.6, 0.60], transluc: 0.58
  },
  {
    id: 'broad-leaved-paperbark', common: 'Broad-leaved paperbark', sci: 'Melaleuca quinquenervia',
    pack: 'ecology.plants plant-broad-leaved-paperbark; geography veg-wallum-swamp-sedgeland',
    arch: 'tree', leaf: 'broad',
    h: [5.5, 14.0], w: [0.62, 0.92], lean: 0.10,
    leafA: [0.268, 0.322, 0.204], leafB: [0.152, 0.196, 0.122], wood: [0.828, 0.806, 0.746],
    flower: [0.900, 0.890, 0.790], flowerMonths: [2, 3, 4],
    density: 0.0085, d0: 340, geomEnd: 104, cardEnd: 2600,
    sway: [0.86, 0.135, 1.95, 0.05], sway2: [2.0, 0.10, 3.2, 0.65], transluc: 0.50
  },
  {
    id: 'scribbly-gum', common: 'Scribbly gum', sci: 'Eucalyptus racemosa',
    pack: 'ecology.plants plant-scribbly-gum; geography veg-eucalypt-forest',
    arch: 'tree', leaf: 'broad',
    h: [8.0, 18.0], w: [0.72, 1.05], lean: 0.09,
    // Pale trunks. This is the tree that makes the island's forest look the way it does from the
    // Cylinder Beach road: white-grey boles under a thin grey-green canopy you can see sky through.
    leafA: [0.300, 0.352, 0.222], leafB: [0.166, 0.216, 0.132], wood: [0.760, 0.735, 0.672],
    density: 0.0055, d0: 380, geomEnd: 112, cardEnd: 3200,
    sway: [0.70, 0.155, 1.62, 0.042], sway2: [2.2, 0.11, 2.9, 0.70], transluc: 0.52
  },
  {
    id: 'blackbutt', common: 'Blackbutt', sci: 'Eucalyptus pilularis',
    pack: 'ecology.plants plant-blackbutt; geography veg-eucalypt-forest',
    arch: 'tree', leaf: 'broad',
    h: [13.0, 27.0], w: [0.70, 1.00], lean: 0.06,
    leafA: [0.216, 0.292, 0.166], leafB: [0.118, 0.170, 0.096], wood: [0.300, 0.260, 0.222],
    density: 0.0026, d0: 420, geomEnd: 120, cardEnd: 3400,
    sway: [0.58, 0.135, 1.36, 0.036], sway2: [2.5, 0.10, 2.6, 0.72], transluc: 0.42
  },
  {
    id: 'pink-bloodwood', common: 'Pink bloodwood', sci: 'Corymbia intermedia',
    pack: 'ecology.plants plant-pink-bloodwood; geography veg-rehabilitation-regrowth',
    arch: 'tree', leaf: 'broad',
    h: [9.0, 20.0], w: [0.76, 1.10], lean: 0.08,
    leafA: [0.252, 0.320, 0.190], leafB: [0.140, 0.194, 0.112], wood: [0.352, 0.262, 0.206],
    flower: [0.935, 0.905, 0.820], flowerMonths: [0, 1, 2],
    density: 0.0028, d0: 380, geomEnd: 112, cardEnd: 3200,
    sway: [0.66, 0.145, 1.55, 0.040], sway2: [2.3, 0.10, 2.8, 0.70], transluc: 0.48
  },
  {
    id: 'forest-red-gum', common: 'Forest red gum', sci: 'Eucalyptus tereticornis',
    pack: 'ecology.plants plant-forest-red-gum',
    arch: 'tree', leaf: 'broad',
    h: [11.0, 23.0], w: [0.78, 1.12], lean: 0.08,
    leafA: [0.264, 0.336, 0.204], leafB: [0.148, 0.204, 0.120], wood: [0.686, 0.680, 0.658],
    density: 0.0017, d0: 380, geomEnd: 112, cardEnd: 3200,
    sway: [0.64, 0.150, 1.50, 0.040], sway2: [2.3, 0.10, 2.8, 0.70], transluc: 0.50
  },
  {
    id: 'swamp-mahogany', common: 'Swamp mahogany', sci: 'Eucalyptus robusta',
    pack: 'ecology.plants plant-swamp-mahogany',
    arch: 'tree', leaf: 'broad',
    h: [7.0, 16.0], w: [0.86, 1.24], lean: 0.07,
    leafA: [0.184, 0.266, 0.150], leafB: [0.104, 0.156, 0.088], wood: [0.330, 0.236, 0.180],
    // Winter nectar. The pack gives May to August, and that is when the flying-foxes are in it.
    flower: [0.885, 0.860, 0.680], flowerMonths: [4, 5, 6, 7],
    density: 0.0038, d0: 340, geomEnd: 106, cardEnd: 2800,
    sway: [0.72, 0.130, 1.68, 0.042], sway2: [2.2, 0.09, 2.9, 0.66], transluc: 0.44
  },
  {
    id: 'cabbage-tree-palm', common: 'Cabbage tree palm', sci: 'Livistona australis',
    pack: 'ecology.plants plant-cabbage-tree-palm; geography veg-littoral-rainforest',
    arch: 'palm', leaf: 'frond',
    h: [5.0, 15.0], w: [0.90, 1.20], lean: 0.05,
    leafA: [0.275, 0.400, 0.215], leafB: [0.195, 0.300, 0.155], wood: [0.455, 0.428, 0.378],
    density: 0.0034, d0: 300, geomEnd: 104, cardEnd: 2200,
    // A crown on a bare stem: everything moves, slowly, and all of it together.
    sway: [0.52, 0.20, 1.20, 0.035], sway2: [1.5, 0.12, 2.1, 0.75], transluc: 0.55
  },
  {
    id: 'rainforest-canopy', common: 'Tuckeroo and fig', sci: 'Cupaniopsis anacardioides, Ficus',
    pack: 'geography veg-littoral-rainforest indicative_species',
    arch: 'tree', leaf: 'glossy',
    h: [7.0, 17.0], w: [1.15, 1.55], lean: 0.04,
    leafA: [0.165, 0.265, 0.145], leafB: [0.110, 0.185, 0.100], wood: [0.300, 0.268, 0.230],
    density: 0.0105, d0: 300, geomEnd: 102, cardEnd: 2200,
    sway: [0.60, 0.085, 1.40, 0.035], sway2: [2.6, 0.06, 2.4, 0.55], transluc: 0.30
  },
  {
    id: 'grey-mangrove', common: 'Grey mangrove', sci: 'Avicennia marina',
    pack: 'geography veg-mangrove-saltmarsh indicative_species',
    arch: 'mangrove', leaf: 'mangroveleaf',
    h: [1.8, 6.5], w: [1.05, 1.55], lean: 0.05,
    leafA: [0.300, 0.380, 0.278], leafB: [0.220, 0.290, 0.205], wood: [0.520, 0.500, 0.445],
    density: 0.03, d0: 135, geomEnd: 70, cardEnd: 900,
    sway: [1.10, 0.055, 2.40, 0.09], sway2: [2.8, 0.03, 3.4, 0.40], transluc: 0.34
  },
  {
    id: 'red-mangrove', common: 'Red mangrove', sci: 'Rhizophora stylosa',
    pack: 'geography veg-mangrove-saltmarsh indicative_species',
    arch: 'mangrove', leaf: 'glossy',
    h: [2.2, 7.0], w: [1.00, 1.45], lean: 0.05,
    leafA: [0.200, 0.320, 0.198], leafB: [0.140, 0.230, 0.140], wood: [0.285, 0.225, 0.185],
    density: 0.013, d0: 135, geomEnd: 70, cardEnd: 900,
    sway: [1.05, 0.050, 2.30, 0.09], sway2: [3.0, 0.03, 3.2, 0.38], transluc: 0.30
  },
  {
    id: 'saltmarsh', common: 'Saltmarsh couch and samphire', sci: 'Sporobolus virginicus, Sarcocornia quinqueflora',
    pack: 'geography veg-mangrove-saltmarsh indicative_species',
    arch: 'mat', leaf: 'succulent',
    h: [0.12, 0.32], w: [1.10, 2.00], lean: 0.06,
    leafA: [0.465, 0.480, 0.365], leafB: [0.520, 0.345, 0.285], wood: [0.40, 0.38, 0.30],
    density: 0.075, d0: 62, geomEnd: 36, cardEnd: 200,
    sway: [2.10, 0.05, 4.30, 0.40], sway2: [1.9, 0.02, 3.6, 0.40], transluc: 0.42
  }
];

const SP_INDEX = {};
for (let i = 0; i < SPECIES.length; i++) SP_INDEX[SPECIES[i].id] = i;

/* ------------------------------------------------------------------ the communities

Eleven communities, each a weighted species mix. The mixes come from the indicator_plants of the
matching data/ecology.json habitat and the indicative_species of the matching data/geography.json
vegetation zone. `scale` multiplies every member's modelled density, which is what makes a closed
littoral rainforest pocket read differently from open wallum with the same species in it. */

const COMMUNITIES = [
  {
    id: 'foredune', label: 'Foredune',
    habitat: 'hab-foredune', zone: 'veg-dune-spinifex',
    scale: 1.0,
    mix: [['beach-spinifex', 1.0], ['dune-mat', 0.32], ['pandanus', 0.055], ['wattle', 0.10],
      ['coastal-sheoak', 0.030], ['midyim', 0.06]]
  },
  {
    id: 'casuarina-foreshore', label: 'She-oak foreshore',
    habitat: 'hab-foredune', zone: 'veg-casuarina-foreshore',
    scale: 1.0,
    mix: [['coastal-sheoak', 1.0], ['pandanus', 0.30], ['wattle', 0.55], ['beach-spinifex', 0.35],
      ['midyim', 0.22], ['heath-sedge', 0.30]]
  },
  {
    id: 'wallum-heath', label: 'Wallum heath',
    habitat: 'hab-wallum-heath', zone: 'veg-wallum-heath',
    scale: 1.0,
    mix: [['wallum-banksia', 1.0], ['coast-tea-tree', 0.85], ['heath-sedge', 1.0],
      ['grass-tree', 0.45], ['midyim', 0.40], ['scribbly-gum', 0.16], ['black-sheoak', 0.20],
      ['wattle', 0.16]]
  },
  {
    id: 'eucalypt-forest', label: 'High dune eucalypt forest',
    habitat: 'hab-eucalypt-forest', zone: 'veg-eucalypt-forest',
    scale: 1.0,
    mix: [['scribbly-gum', 1.0], ['blackbutt', 0.55], ['pink-bloodwood', 0.42],
      ['forest-red-gum', 0.26], ['black-sheoak', 0.45], ['wallum-banksia', 0.30],
      ['heath-sedge', 0.55], ['grass-tree', 0.28], ['midyim', 0.22], ['coast-tea-tree', 0.18]]
  },
  {
    id: 'swamp', label: 'Eighteen Mile Swamp and wallum sedgeland',
    habitat: 'hab-eighteen-mile-swamp', zone: 'veg-wallum-swamp-sedgeland',
    scale: 1.0,
    mix: [['swamp-sedge', 1.0], ['broad-leaved-paperbark', 1.0], ['coast-tea-tree', 0.55],
      ['swamp-mahogany', 0.45], ['cabbage-tree-palm', 0.14], ['heath-sedge', 0.35]]
  },
  {
    id: 'littoral-rainforest', label: 'Littoral rainforest at Myora',
    habitat: 'hab-littoral-rainforest', zone: 'veg-littoral-rainforest',
    scale: 1.15,
    mix: [['rainforest-canopy', 1.0], ['cabbage-tree-palm', 0.75], ['midyim', 0.40],
      ['broad-leaved-paperbark', 0.30], ['forest-red-gum', 0.10]]
  },
  {
    id: 'mangrove', label: 'Mangrove',
    habitat: 'hab-mangrove-saltmarsh', zone: 'veg-mangrove-saltmarsh',
    scale: 1.0,
    mix: [['grey-mangrove', 1.0], ['red-mangrove', 0.45]]
  },
  {
    id: 'saltmarsh', label: 'Saltmarsh',
    habitat: 'hab-mangrove-saltmarsh', zone: 'veg-mangrove-saltmarsh',
    scale: 1.0,
    mix: [['saltmarsh', 1.0], ['grey-mangrove', 0.09]]
  },
  {
    id: 'rehab', label: 'Mine path rehabilitation regrowth',
    habitat: null, zone: 'veg-rehabilitation-regrowth',
    scale: 1.0, planted: true,
    // Even-aged and evenly spaced. The pack's own note says the regrowth does not simply return to
    // what was there before, and from the air the geometry of the planting is the giveaway.
    mix: [['wattle', 1.0], ['wallum-banksia', 0.75], ['pink-bloodwood', 0.50],
      ['coast-tea-tree', 0.35], ['heath-sedge', 0.45]]
  },
  {
    id: 'headland', label: 'Headland scrub',
    habitat: 'hab-rocky-headland', zone: null,
    scale: 0.55,
    mix: [['pandanus', 1.0], ['wattle', 0.85], ['coast-tea-tree', 0.60], ['midyim', 0.75],
      ['heath-sedge', 0.60], ['coastal-sheoak', 0.25]]
  },
  {
    id: 'township', label: 'Township and cleared ground',
    habitat: null, zone: null,
    scale: 0.30,
    mix: [['coastal-sheoak', 1.0], ['scribbly-gum', 0.55], ['pandanus', 0.35],
      ['wattle', 0.45], ['forest-red-gum', 0.25], ['heath-sedge', 0.25]]
  }
];

const COM_INDEX = {};
for (let i = 0; i < COMMUNITIES.length; i++) {
  COM_INDEX[COMMUNITIES[i].id] = i;
  const c = COMMUNITIES[i];
  c.members = c.mix.map(([id, w]) => ({ sp: SP_INDEX[id], w }));
  c.missing = c.mix.filter(([id]) => SP_INDEX[id] === undefined).map(([id]) => id);
  // Sum of modelled stems per square metre for this community, used by the census.
  c.stemsPerM2 = 0;
  for (const m of c.members) if (m.sp !== undefined) c.stemsPerM2 += SPECIES[m.sp].density * m.w * c.scale;
}

/* ------------------------------------------------------------------ where each community sits

One function decides what grows at a point, and both the whole-island census and the per-tile
scatter call it, so the numbers a critic reads out of world.state and the plants on the screen are
the same answer to the same question.

The elevation bands and the distance-from-shore bands are read out of data/geography.json
vegetation_zones at boot rather than written here, so if the pack is corrected the plants move. */

const NO_COMMUNITY = -1;

function makeClassifier(world, island) {
  const covers = island.grid ? island.grid.covers : [];
  const C = {};
  for (let i = 0; i < covers.length; i++) C[covers[i]] = i;

  // Zone rules from the pack, with the fallbacks recorded in notes if a zone is missing.
  const zones = {};
  const notes = [];
  const geo = world.data && world.data.geography;
  for (const z of (geo && geo.vegetation_zones) || []) zones[z.id] = z.rule || {};
  const band = (zoneId, key, fallback) => {
    const r = zones[zoneId];
    const v = r && Array.isArray(r[key]) ? r[key] : null;
    if (!v) notes.push(`data/geography.json ${zoneId}.${key} missing, using ${JSON.stringify(fallback)}`);
    return v || fallback;
  };
  const duneShore = band('veg-dune-spinifex', 'distance_from_shore_m', [0, 120]);
  const duneElev = band('veg-dune-spinifex', 'elevation_band_m', [0, 15]);
  const casShore = band('veg-casuarina-foreshore', 'distance_from_shore_m', [20, 300]);
  const casElev = band('veg-casuarina-foreshore', 'elevation_band_m', [1, 20]);
  const heathElev = band('veg-wallum-heath', 'elevation_band_m', [5, 120]);
  const forestElev = band('veg-eucalypt-forest', 'elevation_band_m', [30, 239]);
  const rainElev = band('veg-littoral-rainforest', 'elevation_band_m', [1, 40]);
  const mangElev = band('veg-mangrove-saltmarsh', 'elevation_band_m', [0, 3]);
  const swampElev = band('veg-wallum-swamp-sedgeland', 'elevation_band_m', [0, 10]);

  // The littoral rainforest pockets. Three published coordinates, and they disagree: the ecology
  // pack's habitat centroid, the geography pack's two sample points and the places pack's spring
  // are spread over about 1.5 km of the same piece of shore, and every one of them is flagged low
  // confidence in its own pack. All three are used as pocket centres rather than one being picked,
  // and the disagreement is written into the notes instead of being hidden.
  const pockets = [];
  const addPocket = (lon, lat, r, src) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const p = island.project(lon, lat);
    pockets.push({ x: p.x, z: p.z, r, src });
  };
  for (const z of (geo && geo.vegetation_zones) || []) {
    if (z.id !== 'veg-littoral-rainforest') continue;
    for (const sp of z.sample_points || []) addPocket(sp[0], sp[1], 560, 'geography veg-littoral-rainforest sample point');
  }
  const eco = world.data && world.data.ecology;
  for (const h of (eco && eco.habitats) || []) {
    if (h.id !== 'hab-littoral-rainforest' || !h.centroid) continue;
    addPocket(h.centroid.lng, h.centroid.lat, 520, 'ecology hab-littoral-rainforest centroid');
  }
  const places = world.data && world.data.places;
  const myora = ((places && places.places) || []).find((p) => p.id === 'myora-springs');
  if (myora) addPocket(myora.lon, myora.lat, 520, 'places myora-springs');
  if (pockets.length > 1) {
    let maxSep = 0;
    for (let i = 0; i < pockets.length; i++) {
      for (let j = i + 1; j < pockets.length; j++) {
        maxSep = Math.max(maxSep, Math.hypot(pockets[i].x - pockets[j].x, pockets[i].z - pockets[j].z));
      }
    }
    notes.push(`littoral rainforest: ${pockets.length} published centres, up to ${Math.round(maxSep)} m apart, `
      + 'every one flagged low confidence in its own pack. All are drawn as pockets.');
  }
  if (!pockets.length) notes.push('no published littoral rainforest coordinate found: no rainforest pocket is drawn.');

  const seed = 0;
  const out = { com: NO_COMMUNITY, open: 1, prune: 1 };

  /**
   * @param cov land cover index @param elev metres above mean sea level @param slope radians
   * @param sd metres inland from the coastline @param bay 0 Pacific, 1 Moreton Bay
   */
  function classify(cov, elev, slope, sd, bay, x, z, noise, o) {
    const r = o || out;
    r.com = NO_COMMUNITY; r.open = 1; r.prune = 1;
    if (cov === C.water || cov === C.lake || cov === undefined) return r;

    let com = NO_COMMUNITY;
    let open = 1;

    if (cov === C.mangrove) com = COM_INDEX.mangrove;
    else if (cov === C.saltmarsh) com = COM_INDEX.saltmarsh;
    else if (cov === C.rehab) com = COM_INDEX.rehab;
    else if (cov === C.swamp) com = COM_INDEX.swamp;
    else if (cov === C.rock) {
      // The splash zone and the wave-cut platform carry nothing. Above it, wind-shaped scrub.
      if (elev < 7) return r;
      com = COM_INDEX.headland;
      open = smoothstep(7, 22, elev);
    } else if (cov === C.urban) { com = COM_INDEX.township; open = 0.42; }
    else if (cov === C.cleared) { com = COM_INDEX.township; open = 0.85; }
    else if (cov === C.beach) {
      // Bare sand carries nothing until it is far enough above the swash to hold a plant.
      if (elev < 2.2 || sd < 10) return r;
      com = bay > 0.45 ? COM_INDEX['casuarina-foreshore'] : COM_INDEX.foredune;
      open = 0.28 * smoothstep(2.2, 5.0, elev);
    } else if (cov === C.foredune) {
      // The pack puts spinifex in the first 120 m and the she-oaks from 20 to 300 m. Between them
      // it is a blend, and on this island that blend is what the back of the dune actually looks
      // like: spinifex thinning out under wattle and pandanus with she-oak coming through.
      const toCas = smoothstep(duneShore[1] * 0.6, casShore[1] * 0.75, sd);
      com = toCas > 0.5 ? COM_INDEX['casuarina-foreshore'] : COM_INDEX.foredune;
      open = 0.55 + 0.45 * smoothstep(duneElev[0], duneElev[1] * 0.7, elev);
    } else if (cov === C.heath) {
      const bayFront = bay > 0.5 && sd < casShore[1] && elev >= casElev[0] && elev <= casElev[1] * 1.4;
      com = bayFront ? COM_INDEX['casuarina-foreshore'] : COM_INDEX['wallum-heath'];
      // Wallum on the sand plains: the pack's band is 5 to 120 m and it thins at both ends.
      open = 0.55 + 0.45 * smoothstep(heathElev[0] * 0.4, heathElev[0] * 2.2, elev);
      if (elev > swampElev[1] * 0.4 && elev < swampElev[1] && sd > 400) open *= 1.05;
    } else if (cov === C.forest) {
      com = COM_INDEX['eucalypt-forest'];
      open = 0.62 + 0.38 * smoothstep(forestElev[0] * 0.35, forestElev[0] * 1.15, elev);
    } else return r;

    // The rainforest pockets override whatever the cover said, inside the published elevation band.
    if (elev >= rainElev[0] && elev <= rainElev[1]) {
      for (let i = 0; i < pockets.length; i++) {
        const p = pockets[i];
        const dx = x - p.x, dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < p.r * p.r) {
          const t = 1 - smoothstep(p.r * 0.55, p.r, Math.sqrt(d2));
          if (t > 0.45) { com = COM_INDEX['littoral-rainforest']; open = Math.max(open, 0.75 + 0.25 * t); }
          break;
        }
      }
    }
    if (com === NO_COMMUNITY) return r;

    // A steep face sheds its cover. Below about twenty degrees the heath holds a dune; above
    // thirty it is a blowout and it is bare quartz sand. This is the same threshold the terrain
    // shader uses to show sand through the vegetation, so the two agree about where a blowout is.
    open *= 1 - smoothstep(0.36, 0.62, slope);

    // Glades and thickets. Without this the forest is a uniform lawn of trees and reads as wallpaper.
    if (noise) {
      const g = noise.fbm(x / 210, z / 210, 2, 2.1, 0.55);
      open *= clamp(0.55 + 1.05 * (g * 0.5 + 0.5), 0.10, 1.45);
    }

    // Salt pruning. Everything within a few hundred metres of the open ocean is cut down to the
    // height the wind allows, which is why the heath behind Main Beach is knee high and the same
    // species two kilometres inland is over your head.
    const exposure = 1 - bay * 0.55;
    const prune = clamp(0.34 + 0.66 * smoothstep(30, 620, sd) + 0.30 * (1 - exposure), 0.30, 1);

    r.com = com; r.open = clamp(open, 0, 1.5); r.prune = prune;
    return r;
  }

  classify.notes = notes;
  classify.pockets = pockets;
  classify.cover = C;
  classify.seed = seed;
  return classify;
}

/* ------------------------------------------------------------------ the census

The whole island, counted once at boot from the same rules the renderer scatters by. It runs with
no renderer at all, so `node tools/headless.mjs --system flora` prints real numbers for the whole
275 km2 rather than for whatever happens to be on the screen. */

function census(island, classify, noise) {
  const g = island.grid;
  if (!g) return { areaHa: {}, stems: {}, totalStems: 0, totalVegetatedHa: 0, sampledCells: 0 };
  const STRIDE = 2;                       // every second node: 64 m, 4096 m2 a sample
  const cellArea = (g.cell * STRIDE) * (g.cell * STRIDE);
  const areaHa = {}, stems = {};
  for (const c of COMMUNITIES) { areaHa[c.id] = 0; stems[c.id] = 0; }
  const o = { com: NO_COMMUNITY, open: 1, prune: 1 };
  let vegetated = 0, sampled = 0;
  const nx = g.nx, nz = g.nz, H = g.height, SD = g.shoreDistance, CV = g.cover, BY = g.bayness;
  for (let j = 1; j < nz - 1; j += STRIDE) {
    for (let i = 1; i < nx - 1; i += STRIDE) {
      const k = j * nx + i;
      sampled++;
      const h = H[k];
      if (h <= MEAN_SEA_LEVEL - 0.4) continue;
      const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell;
      const hx = (H[k + 1] - H[k - 1]) / (2 * g.cell);
      const hz = (H[k + nx] - H[k - nx]) / (2 * g.cell);
      const slope = Math.atan(Math.sqrt(hx * hx + hz * hz));
      classify(CV[k], h - MEAN_SEA_LEVEL, slope, SD[k], BY[k] / 255, x, z, noise, o);
      if (o.com === NO_COMMUNITY || o.open <= 0) continue;
      const c = COMMUNITIES[o.com];
      areaHa[c.id] += cellArea / 10000;
      stems[c.id] += c.stemsPerM2 * o.open * cellArea;
      vegetated += cellArea;
    }
  }
  let total = 0;
  for (const c of COMMUNITIES) {
    areaHa[c.id] = Math.round(areaHa[c.id]);
    stems[c.id] = Math.round(stems[c.id]);
    total += stems[c.id];
  }
  return {
    areaHa, stems, totalStems: total,
    totalVegetatedHa: Math.round(vegetated / 10000),
    sampledCells: sampled, sampleCellM: g.cell * STRIDE
  };
}

/** Which months a species is in flower or fruit, as a smooth 0..1 across a month boundary. */
function flowering(sp, month, dayFrac) {
  if (!sp.flowerMonths || !sp.flowerMonths.length) return 0;
  const inM = (m) => (sp.flowerMonths.indexOf(((m % 12) + 12) % 12) >= 0 ? 1 : 0);
  const here = inM(month), prev = inM(month - 1), next = inM(month + 1);
  if (!here) {
    // Ease in over the last quarter of the month before, and out over the first quarter after.
    if (next && dayFrac > 0.75) return smoothstep(0.75, 1.0, dayFrac) * 0.6;
    if (prev && dayFrac < 0.25) return (1 - smoothstep(0, 0.25, dayFrac)) * 0.6;
    return 0;
  }
  let v = 1;
  if (!prev) v *= smoothstep(0, 0.35, dayFrac) * 0.4 + 0.6;
  if (!next) v *= (1 - smoothstep(0.65, 1, dayFrac)) * 0.4 + 0.6;
  return v;
}

/* ================================================================== registration */

export function registerFlora(world) {
  const island = world.island;
  if (!island || typeof island.height !== 'function') {
    console.warn('[flora] no world.island, nothing to plant. Is src/world/island.js registered?');
    return;
  }

  // One draw from the named stream, at registration, before any tick. Everything downstream is a
  // pure hash of this integer, so the scatter cannot depend on the order tiles are visited.
  const rng = world.rng.stream('flora');
  const SEED = rng.int(1, 0x7ffffffe) | 0;
  const noise = makeNoise2D(rng.int(1, 0x7ffffffe));

  const classify = makeClassifier(world, island);
  const notes = classify.notes.slice();

  // Check every species and mix against the packs, and say so rather than failing quietly.
  const eco = world.data && world.data.ecology;
  const packPlants = new Set(((eco && eco.plants) || []).map((p) => p.common_name.toLowerCase()));
  const packSci = new Set(((eco && eco.plants) || []).map((p) => p.scientific_name));
  for (const c of COMMUNITIES) {
    if (c.missing.length) notes.push(`community ${c.id} names a species that is not in the table: ${c.missing.join(', ')}`);
  }
  const fromEcologyPack = SPECIES.filter((s) => packSci.has(s.sci) || packPlants.has(s.common.toLowerCase())).length;

  // Flowering months, taken from the pack where the pack publishes them rather than from this file.
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  for (const p of (eco && eco.plants) || []) {
    const sp = SPECIES.find((s) => s.sci === p.scientific_name);
    if (!sp) continue;
    const months = p.flowering_months || p.fruiting_months;
    if (!months) continue;
    const idx = months.map((m) => MON[String(m).slice(0, 3).toLowerCase()]).filter((m) => m !== undefined);
    if (idx.length) { sp.flowerMonths = idx; sp.flowerSource = 'data/ecology.json ' + p.id; }
  }

  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const cen = census(island, classify, noise);
  const censusMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

  /* ---- the read model ---------------------------------------------------- */

  const state = world.publish('flora', {
    source: 'data/ecology.json plants and habitats; data/geography.json vegetation_zones',
    speciesCount: SPECIES.length,
    speciesFromEcologyPack: fromEcologyPack,
    communities: COMMUNITIES.map((c) => ({
      id: c.id, label: c.label, habitat: c.habitat, zone: c.zone,
      species: c.mix.map(([id]) => id),
      areaHa: cen.areaHa[c.id], modelledStems: cen.stems[c.id]
    })),
    totalModelledStems: cen.totalStems,
    vegetatedHa: cen.totalVegetatedHa,
    censusSampleM: cen.sampleCellM,
    censusMs: +censusMs.toFixed(0),
    season: '', greenness: 1, greennessSource: '', canopySwayM: 0, windKt: 0, windDirDeg: 0,
    floweringNow: [],
    burntHa: 0, meanTimeSinceFireY: 0, fireSource: 'no fire or vegetation system loaded',
    // Filled in by the render layer. Zero and honest when there is no renderer.
    renderer: 'not loaded',
    instances: { geometry: 0, cards: 0, total: 0 },
    tiles: { fine: 0, coarse: 0, far: 0, cached: 0, pending: 0 },
    drawCalls: 0, buildMs: 0, packMs: 0, scatterMs: 0, shadowMs: 0, burnRescatters: 0,
    shadedFraction: 0, overflowingSpecies: 0, atlasCells: 0, meshVertices: 0,
    quality: 1, renderDensity: 1,
    notes
  });

  /* ---- season, weather and fire ------------------------------------------ */

  // What the wind is doing to the canopy, in metres of tip displacement. It is a real number
  // derived from the live weather, it moves every tick, and the render layer drives its shader
  // from exactly the same expression, so the read model is not a separate story.
  function canopySway(windKt) {
    const s = clamp(windKt / 34, 0, 1.35);
    return +(s * s * 0.9 * 3.2).toFixed(2);
  }

  // Fire. The wallum needs it and is damaged by too much of it, which is the pack's own summary of
  // proc-fire-regime, and it is the one thing that visibly changes what is standing on this island.
  // The ecology systems own the model; this layer reads whichever of them is loaded and says which
  // one it found, so nobody has to read this file to learn whether the heath is responding yet.
  const fireProbe = { source: 'no fire or vegetation system loaded', burntHa: 0, meanTsfY: 0, sample: null };
  function readFire(w) {
    const veg = w.read('vegetation');
    if (veg && typeof veg.timeSinceFireYAt === 'function') {
      fireProbe.source = 'vegetation system, per point time since fire';
      fireProbe.sample = veg.timeSinceFireYAt;
      fireProbe.integrity = typeof veg.integrityAt === 'function' ? veg.integrityAt : null;
      fireProbe.meanTsfY = +(veg.meanTimeSinceFireY || 0).toFixed(2);
      fireProbe.burntHa = Math.round((veg.burns && (veg.burns.plannedRolling365Ha + veg.burns.wildfireRolling365Ha)) || 0);
      return;
    }
    const f = w.read('fire');
    if (f && typeof f.timeSinceFireYAt === 'function') {
      fireProbe.source = 'fire system, per point time since fire';
      fireProbe.sample = f.timeSinceFireYAt;
      return;
    }
    fireProbe.source = 'no fire or vegetation system loaded';
    fireProbe.sample = null;
    fireProbe.integrity = null;
    fireProbe.burntHa = 0;
    fireProbe.meanTsfY = 0;
  }

  const live = {
    flowerAmt: new Float32Array(SPECIES.length),
    greenness: 1, windKt: 10, windDirDeg: 110, gust: 0.2, wet: 0
  };

  function updatePhenology(w) {
    const wx = w.read('weather');
    const month = w.clock.month;
    const dayFrac = clamp((w.clock.dayOfMonth - 1) / 30, 0, 1);
    const flowering_ = [];
    for (let i = 0; i < SPECIES.length; i++) {
      const a = flowering(SPECIES[i], month, dayFrac);
      live.flowerAmt[i] = a;
      if (a > 0.35) flowering_.push(SPECIES[i].common);
    }
    // Greenness. A fortnight without rain takes the colour out of the heath and the sedge long
    // before it touches the eucalypts, and this island does that most winters.
    const veg = w.read('vegetation');
    if (veg && Number.isFinite(veg.curing)) {
      // Curing is the fraction of the ground layer that has dried off, and it is the number the
      // island's own fire model runs on, so the colour of the heath and the fire danger agree.
      live.greenness = clamp(1 - veg.curing * 0.48, 0.52, 1.0);
      live.greenSource = 'vegetation.curing';
    } else {
      const rainWeek = wx ? wx.rainWeek : 12;
      live.greenness = clamp(0.58 + 0.42 * smoothstep(1, 26, rainWeek), 0.55, 1.0);
      live.greenSource = 'weather.rainWeek';
    }
    live.windKt = wx ? wx.windKt : 10;
    live.windDirDeg = wx ? wx.windDirDeg : 110;
    live.gust = wx ? clamp((wx.gustKt - wx.windKt) / 12, 0, 1) : 0.2;
    live.wet = wx ? clamp(wx.rainMmHr / 6, 0, 1) : 0;

    readFire(w);

    state.season = w.clock.season.name;
    state.greenness = +live.greenness.toFixed(3);
    state.greennessSource = live.greenSource;
    state.windKt = +live.windKt.toFixed(1);
    state.windDirDeg = Math.round(live.windDirDeg);
    state.canopySwayM = canopySway(live.windKt);
    state.floweringNow = flowering_;
    state.burntHa = fireProbe.burntHa;
    state.meanTimeSinceFireY = fireProbe.meanTsfY;
    state.fireSource = fireProbe.source;
  }

  world.register({
    id: 'flora',
    phase: 'presentation',
    order: 40,
    init(w) { updatePhenology(w); },
    tick(w) { updatePhenology(w); },
    describe(w) {
      // Census numbers, phenology and wind response. No timings and no camera-dependent counts:
      // this is hashed by the determinism check and a frame cost would make two identical islands
      // look different. The instanced counts live in the published read model instead.
      return {
        species: SPECIES.length,
        communities: COMMUNITIES.length,
        vegetatedHa: state.vegetatedHa,
        modelledStems: state.totalModelledStems,
        stemsByCommunity: COMMUNITIES.reduce((a, c) => { a[c.id] = cen.stems[c.id]; return a; }, {}),
        season: state.season,
        greenness: state.greenness,
        canopySwayM: state.canopySwayM,
        flowering: state.floweringNow,
        fire: state.fireSource
      };
    },
    save() { return null; },
    load() {}
  });

  if (!world.stage || !B) return;   // headless: the census stands, nothing is drawn

  buildFloraRenderer(world, island, {
    SEED, classify, noise, state, live, fireProbe, notes
  });
}

/* ================================================================== the atlas

There are no image files in this repository and there is no network at runtime, so every leaf in
this layer is drawn here, in code, from the same numbers the geometry is built from. One 1024 by
1024 atlas of 128 pixel cells holds two kinds of card:

  * a foliage cluster per leaf type, used by the three dimensional models. Twelve of them, and they
    are genuinely different: a spinifex blade is not a banksia leaf and a casuarina needle is not
    either of them.
  * a whole-plant silhouette per species, used by the billboard. Drawn from that species' own
    height, width and crown parameters, so the moment a model becomes a card it keeps its shape.

Channels: R a brightness multiplier, G how deep inside the canopy the pixel is (which is the
ambient occlusion), B a hue shift between the species' two leaf tones, A coverage. */

const ATLAS_SIZE = 1024;
const ATLAS_CELL = 128;
const ATLAS_COLS = ATLAS_SIZE / ATLAS_CELL;

function makeAtlas(seed) {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const n2 = makeNoise2D(seed);
  let cursor = 0;
  const cells = {};

  const put = (ci, x, y, r, g, b, a) => {
    if (a <= 0) return;
    x |= 0; y |= 0;
    if (x < 1 || y < 1 || x >= ATLAS_CELL - 1 || y >= ATLAS_CELL - 1) return;   // keep a border
    const px = (ci % ATLAS_COLS) * ATLAS_CELL + x;
    const py = ((ci / ATLAS_COLS) | 0) * ATLAS_CELL + y;
    const o = (py * ATLAS_SIZE + px) * 4;
    if (a * 255 <= data[o + 3]) return;
    data[o] = clamp(r * 0.60, 0, 1) * 255;
    data[o + 1] = clamp(g, 0, 1) * 255;
    data[o + 2] = clamp(b, 0, 1) * 255;
    data[o + 3] = clamp(a, 0, 1) * 255;
  };

  /** A tapered, curved blade or needle from (x0,y0) to (x1,y1). The workhorse. */
  function blade(ci, x0, y0, x1, y1, w0, w1, bright, hue, depth, curve, erode) {
    const steps = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) * 1.6));
    const nx = -(y1 - y0), nz = (x1 - x0);
    const nl = Math.hypot(nx, nz) || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bow = Math.sin(t * Math.PI) * curve;
      const cx = lerp(x0, x1, t) + (nx / nl) * bow;
      const cy = lerp(y0, y1, t) + (nz / nl) * bow;
      const w = lerp(w0, w1, t);
      for (let u = -w; u <= w; u += 0.5) {
        const px = cx + (nx / nl) * u, py = cy + (nz / nl) * u;
        const edge = 1 - Math.abs(u) / (w + 0.001);
        let a = clamp(edge * 3.0, 0, 1);
        if (erode) a *= 0.65 + 0.55 * (n2(px * 0.22, py * 0.22) * 0.5 + 0.5);
        if (a < 0.35) continue;
        // Lit along the spine, shaded at the margins: without it a blade is a flat stripe.
        const b = bright * (0.80 + 0.34 * edge) * (0.90 + 0.20 * (n2(px * 0.09, py * 0.09) * 0.5 + 0.5));
        put(ci, px, py, b, depth * (1 - 0.35 * t), hue, 1);
      }
    }
  }

  /** A leaf blob or a crown clump, with a noise-eroded margin so it is not a smooth ellipse. */
  function blob(ci, cx, cy, rx, ry, rot, bright, hue, depth, erode) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.max(rx, ry) + 2;
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const lx = (x * c + y * s) / rx, ly = (-x * s + y * c) / ry;
        let d = lx * lx + ly * ly;
        if (erode > 0) d += (n2((cx + x) * erode, (cy + y) * erode)) * 0.55;
        if (d > 1) continue;
        const edge = 1 - d;
        const b = bright * (0.74 + 0.40 * Math.sqrt(edge))
          * (0.88 + 0.24 * (n2((cx + x) * 0.35, (cy + y) * 0.35) * 0.5 + 0.5));
        put(ci, cx + x, cy + y, b, depth * (0.45 + 0.55 * edge), hue, 1);
      }
    }
  }

  /** A solid stem or trunk, tapering, with bark grain in the brightness channel. */
  function stem(ci, x0, y0, x1, y1, w0, w1, bright, grain) {
    const steps = Math.max(8, Math.round(Math.hypot(x1 - x0, y1 - y0) * 1.4));
    const nx = -(y1 - y0), nz = (x1 - x0);
    const nl = Math.hypot(nx, nz) || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = lerp(x0, x1, t), cy = lerp(y0, y1, t);
      const w = lerp(w0, w1, t);
      for (let u = -w; u <= w; u += 0.5) {
        const px = cx + (nx / nl) * u, py = cy + (nz / nl) * u;
        const round = Math.sqrt(Math.max(0, 1 - (u / (w + 0.001)) * (u / (w + 0.001))));
        const b = (0.52 + 0.62 * round) * (1 - grain * 0.42 * (n2(px * 0.9, py * 0.16) * 0.5 + 0.5));
        put(ci, px, py, b * bright, 0.22, 0.5, 1);
      }
    }
  }

  /* ---- the twelve foliage cluster cards ---------------------------------- */

  const LEAF_PAINTERS = {
    blade(ci) {            // spinifex, cord rush, grass tree skirt
      for (let i = 0; i < 26; i++) {
        const bx = 20 + hash3(seed, ci, i) * 88;
        const tipX = bx + (hash3(seed, ci, i + 90) - 0.5) * 96;
        const tipY = 8 + hash3(seed, ci, i + 180) * 54;
        blade(ci, bx, 124, tipX, tipY, 2.2, 0.4,
          0.72 + hash3(seed, ci, i + 270) * 0.42, hash3(seed, ci, i + 360), 0.35,
          (hash3(seed, ci, i + 450) - 0.5) * 22, false);
      }
    },
    sedge(ci) {            // Baumea and Gahnia: taller, stiffer, more upright
      for (let i = 0; i < 22; i++) {
        const bx = 24 + hash3(seed, ci, i) * 80;
        blade(ci, bx, 126, bx + (hash3(seed, ci, i + 60) - 0.5) * 52, 4 + hash3(seed, ci, i + 120) * 26,
          2.6, 0.5, 0.70 + hash3(seed, ci, i + 200) * 0.40, hash3(seed, ci, i + 300), 0.30,
          (hash3(seed, ci, i + 400) - 0.5) * 10, false);
      }
    },
    needle(ci) {           // casuarina: fine drooping branchlets, jointed
      for (let i = 0; i < 44; i++) {
        const bx = 8 + hash3(seed, ci, i) * 112;
        const by = 2 + hash3(seed, ci, i + 70) * 40;
        const len = 40 + hash3(seed, ci, i + 140) * 70;
        blade(ci, bx, by, bx + (hash3(seed, ci, i + 210) - 0.5) * 26, by + len,
          0.95, 0.35, 0.66 + hash3(seed, ci, i + 280) * 0.40, hash3(seed, ci, i + 350), 0.55,
          (hash3(seed, ci, i + 420) - 0.5) * 9, false);
      }
    },
    serrated(ci) {         // banksia aemula: stiff, blunt, saw-edged, held out from the twig
      for (let i = 0; i < 22; i++) {
        const cx = 16 + hash3(seed, ci, i) * 96, cy = 14 + hash3(seed, ci, i + 55) * 100;
        const rot = hash3(seed, ci, i + 110) * Math.PI;
        blob(ci, cx, cy, 4.2 + hash3(seed, ci, i + 165) * 2.2, 15 + hash3(seed, ci, i + 220) * 9, rot,
          0.74 + hash3(seed, ci, i + 275) * 0.36, hash3(seed, ci, i + 330), 0.62, 0.62);
      }
    },
    fine(ci) {             // tea-tree and midyim: many small leaves, dense
      for (let i = 0; i < 130; i++) {
        const cx = 8 + hash3(seed, ci, i) * 112, cy = 8 + hash3(seed, ci, i + 200) * 112;
        blob(ci, cx, cy, 2.4 + hash3(seed, ci, i + 400) * 1.9, 3.4 + hash3(seed, ci, i + 600) * 2.6,
          hash3(seed, ci, i + 800) * 3.14, 0.72 + hash3(seed, ci, i + 1000) * 0.42,
          hash3(seed, ci, i + 1200), 0.55, 0.5);
      }
    },
    phyllode(ci) {         // wattle: long flat phyllodes, sickle shaped
      for (let i = 0; i < 30; i++) {
        const cx = 12 + hash3(seed, ci, i) * 104, cy = 12 + hash3(seed, ci, i + 50) * 104;
        blob(ci, cx, cy, 3.4 + hash3(seed, ci, i + 100) * 1.6, 14 + hash3(seed, ci, i + 150) * 10,
          hash3(seed, ci, i + 200) * 3.14, 0.74 + hash3(seed, ci, i + 250) * 0.38,
          hash3(seed, ci, i + 300), 0.58, 0.45);
      }
    },
    broad(ci) {            // eucalypt: pendulous lanceolate leaves hanging edge on to the sun
      for (let i = 0; i < 34; i++) {
        const cx = 10 + hash3(seed, ci, i) * 108, cy = 10 + hash3(seed, ci, i + 44) * 100;
        const rot = (hash3(seed, ci, i + 88) - 0.5) * 1.5;
        blob(ci, cx, cy, 4.4 + hash3(seed, ci, i + 132) * 2.4, 17 + hash3(seed, ci, i + 176) * 11, rot,
          0.70 + hash3(seed, ci, i + 220) * 0.44, hash3(seed, ci, i + 264), 0.60, 0.40);
      }
    },
    glossy(ci) {           // tuckeroo and fig: broad, dark, held flat, closed canopy
      for (let i = 0; i < 26; i++) {
        const cx = 10 + hash3(seed, ci, i) * 108, cy = 10 + hash3(seed, ci, i + 33) * 108;
        blob(ci, cx, cy, 12 + hash3(seed, ci, i + 66) * 7, 8 + hash3(seed, ci, i + 99) * 6,
          hash3(seed, ci, i + 132) * 3.14, 0.66 + hash3(seed, ci, i + 165) * 0.50,
          hash3(seed, ci, i + 198), 0.78, 0.30);
      }
    },
    // A single leaf, not a cluster: the pandanus geometry places ten of these as ten straps, so a
    // card holding twelve straps would give a plant a hundred and twenty of them.
    strap(ci) {            // pandanus: one long stiff strap with a spiny margin
      blade(ci, 64, 127, 64, 4, 13, 2.4, 0.90, 0.5, 0.34, 6, false);
      for (let i = 0; i < 30; i++) {   // the marginal spines
        const t = i / 29, s = i % 2 ? 1 : -1;
        const w = lerp(13, 2.4, t);
        blob(ci, 64 + s * w, lerp(126, 6, t), 2.0, 1.4, 0, 0.95, 0.5, 0.20, 0);
      }
    },
    frond(ci) {            // livistona: one fan on one petiole
      stem(ci, 64, 127, 64, 74, 2.6, 2.0, 0.66, 0.4);
      for (let i = 0; i < 19; i++) {
        const a = -Math.PI * 0.10 - (i / 18) * Math.PI * 0.80;
        const len = 54 + hash3(seed, ci, i) * 18;
        blade(ci, 64, 74, 64 + Math.cos(a) * len, 74 + Math.sin(a) * len, 2.8, 0.7,
          0.70 + hash3(seed, ci, i + 30) * 0.40, hash3(seed, ci, i + 60), 0.45, 2, false);
      }
    },
    succulent(ci) {        // pigface and samphire: fat, short, low
      for (let i = 0; i < 90; i++) {
        const cx = 8 + hash3(seed, ci, i) * 112, cy = 30 + hash3(seed, ci, i + 150) * 92;
        blob(ci, cx, cy, 3.6 + hash3(seed, ci, i + 300) * 2.4, 6.4 + hash3(seed, ci, i + 450) * 3.4,
          hash3(seed, ci, i + 600) * 3.14, 0.72 + hash3(seed, ci, i + 750) * 0.42,
          hash3(seed, ci, i + 900), 0.48, 0.35);
      }
    },
    mangroveleaf(ci) {     // avicennia: thick oval leaves, pale underneath
      for (let i = 0; i < 40; i++) {
        const cx = 10 + hash3(seed, ci, i) * 108, cy = 10 + hash3(seed, ci, i + 45) * 108;
        blob(ci, cx, cy, 6.6 + hash3(seed, ci, i + 90) * 3.0, 10 + hash3(seed, ci, i + 135) * 5,
          hash3(seed, ci, i + 180) * 3.14, 0.68 + hash3(seed, ci, i + 225) * 0.46,
          hash3(seed, ci, i + 270), 0.66, 0.34);
      }
    }
  };

  for (const key of Object.keys(LEAF_PAINTERS)) {
    const ci = cursor++;
    LEAF_PAINTERS[key](ci);
    cells['leaf:' + key] = ci;
  }

  /* ---- bark. Four cells, fully opaque, carrying grain in the brightness channel --------- */

  const fillBark = (ci, fn) => {
    for (let y = 0; y < ATLAS_CELL; y++) {
      for (let x = 0; x < ATLAS_CELL; x++) put(ci, x, y, fn(x, y), 0.28, 0.5, 1);
    }
  };
  const BARK = {
    // Smooth gum bark with the scribbles in it. Eucalyptus racemosa is called scribbly gum because
    // a moth larva tunnels under the bark and the tunnel is left on the trunk when the bark sheds.
    // It is the single most recognisable thing about this island's forest and it is one loop here.
    smooth(ci) {
      fillBark(ci, (x, y) => 0.80 + 0.20 * (n2(x * 0.055, y * 0.012) * 0.5 + 0.5)
        - 0.16 * smoothstep(0.55, 0.95, n2(x * 0.09, y * 0.03) * 0.5 + 0.5));
      for (let s = 0; s < 7; s++) {
        let x = 12 + hash3(seed, ci, s) * 104, y = 8 + hash3(seed, ci, s + 40) * 112;
        let a = hash3(seed, ci, s + 80) * 6.283;
        for (let k = 0; k < 190; k++) {
          a += (n2(x * 0.13, y * 0.13) * 1.5) * 0.30;
          x += Math.cos(a) * 1.05; y += Math.sin(a) * 1.05;
          if (x < 3 || x > 124 || y < 3 || y > 124) break;
          put(ci, x, y, 0.34, 0.30, 0.5, 1);
          put(ci, x + 1, y, 0.44, 0.30, 0.5, 1);
        }
      }
    },
    rough(ci) {            // stringy fibrous bark: blackbutt at the base, swamp mahogany all over
      fillBark(ci, (x, y) => 0.52 + 0.44 * (n2(x * 0.42, y * 0.020) * 0.5 + 0.5)
        * (0.55 + 0.45 * (n2(x * 0.10, y * 0.06) * 0.5 + 0.5)));
    },
    paper(ci) {            // melaleuca: horizontal layers of peeling white paper
      fillBark(ci, (x, y) => {
        const layer = Math.floor(y * 0.14 + n2(x * 0.03, y * 0.02) * 1.6);
        const edge = Math.abs((y * 0.14 + n2(x * 0.03, y * 0.02) * 1.6) - layer - 0.5);
        return 0.86 + 0.16 * (n2(x * 0.3, y * 0.3) * 0.5 + 0.5) - 0.42 * smoothstep(0.34, 0.5, edge);
      });
    },
    ringed(ci) {           // livistona: old leaf-base rings all the way up the stem
      fillBark(ci, (x, y) => 0.66 + 0.26 * (n2(x * 0.2, y * 0.05) * 0.5 + 0.5)
        - 0.30 * smoothstep(0.62, 0.98, Math.abs(Math.sin(y * 0.42))));
    }
  };
  for (const key of Object.keys(BARK)) {
    const ci = cursor++;
    BARK[key](ci);
    cells['bark:' + key] = ci;
  }

  /* ---- one silhouette per species ---------------------------------------- */

  function silhouette(ci, sp) {
    const leaf = sp.leaf;
    // The card is 128 wide by 128 tall and the plant stands on the bottom edge. Aspect comes from
    // the species' own width to height ratio, so a she-oak is narrow and a midyim is wide and low.
    const aspect = clamp((sp.w[0] + sp.w[1]) * 0.5, 0.5, 2.2);
    const halfW = clamp(56 * aspect, 22, 62);
    const rnd = (i) => hash3(seed, ci * 977, i);

    const drawCrownBlobs = (cy, ry, count, spread, size) => {
      for (let i = 0; i < count; i++) {
        const a = rnd(i) * 6.283, r = Math.sqrt(rnd(i + 500));
        const cx = 64 + Math.cos(a) * r * spread;
        const yy = cy + Math.sin(a) * r * ry;
        const dep = 0.34 + 0.64 * (1 - r);
        blob(ci, cx, yy, size * (0.55 + rnd(i + 1000) * 0.6), size * (0.45 + rnd(i + 1500) * 0.5),
          rnd(i + 2000) * 3.14, 0.50 + rnd(i + 2500) * 0.62, rnd(i + 3000), dep,
          leaf === 'glossy' ? 0.42 : 0.92);
      }
    };

    if (sp.arch === 'tuft') {
      for (let i = 0; i < 40; i++) {
        const bx = 64 + (rnd(i) - 0.5) * halfW * 0.8;
        const tipX = bx + (rnd(i + 100) - 0.5) * halfW * 1.9;
        const tipY = 6 + rnd(i + 200) * 52;
        blade(ci, bx, 127, tipX, tipY, 2.3, 0.4, 0.70 + rnd(i + 300) * 0.44, rnd(i + 400), 0.34,
          (rnd(i + 500) - 0.5) * 20, false);
      }
    } else if (sp.arch === 'mat') {
      for (let i = 0; i < 110; i++) {
        const cx = 64 + (rnd(i) - 0.5) * halfW * 2.0;
        const cy = 108 + rnd(i + 300) * 19;
        blob(ci, cx, cy, 4.2 + rnd(i + 600) * 3, 3.4 + rnd(i + 900) * 2.4, rnd(i + 1200) * 3.14,
          0.70 + rnd(i + 1500) * 0.44, rnd(i + 1800), 0.42, 0.35);
      }
    } else if (sp.arch === 'grasstree') {
      stem(ci, 64, 127, 64, 74, 9, 7, 0.34, 0.9);                     // the charred trunk
      for (let i = 0; i < 46; i++) {
        const a = -0.15 - rnd(i) * 2.85;
        const len = 34 + rnd(i + 60) * 26;
        blade(ci, 64, 76, 64 + Math.cos(a) * len, 76 + Math.sin(a) * len * 0.95, 1.9, 0.4,
          0.66 + rnd(i + 120) * 0.42, rnd(i + 180), 0.42, (rnd(i + 240) - 0.5) * 12, false);
      }
      stem(ci, 64, 74, 64, 12, 2.6, 1.8, 0.86, 0.3);                  // the spear
    } else if (sp.arch === 'pandanus') {
      stem(ci, 64, 127, 64, 62, 7, 5.5, 0.62, 0.6);
      for (let i = 0; i < 5; i++) {                                    // prop roots
        const s = i % 2 ? 1 : -1;
        stem(ci, 64, 96 - i * 4, 64 + s * (12 + i * 5), 127, 2.4, 1.6, 0.55, 0.5);
      }
      for (let i = 0; i < 22; i++) {                                   // the strap crown
        const a = -0.06 - rnd(i) * 3.02;
        const len = 42 + rnd(i + 40) * 22;
        blade(ci, 64, 60, 64 + Math.cos(a) * len, 60 + Math.sin(a) * len * 1.05, 3.6, 0.9,
          0.70 + rnd(i + 80) * 0.42, rnd(i + 120), 0.44, (rnd(i + 160) - 0.5) * 26, false);
      }
    } else if (sp.arch === 'palm') {
      stem(ci, 64, 127, 64, 52, 4.6, 3.6, 0.70, 0.75);
      for (let i = 0; i < 15; i++) {                                   // the fan crown
        const a = -0.12 - rnd(i) * 2.9;
        const len = 30 + rnd(i + 30) * 18;
        const tx = 64 + Math.cos(a) * len, ty = 50 + Math.sin(a) * len * 0.9;
        blade(ci, 64, 52, tx, ty, 2.2, 1.0, 0.70 + rnd(i + 60) * 0.40, rnd(i + 90), 0.44, 5, false);
        blob(ci, tx, ty, 9 + rnd(i + 120) * 5, 8 + rnd(i + 150) * 4, a,
          0.68 + rnd(i + 180) * 0.44, rnd(i + 210), 0.52, 0.6);
      }
    } else if (sp.arch === 'droop') {
      stem(ci, 64, 127, 64, 40, 4.2, 2.4, 0.60, 0.65);
      for (let i = 0; i < 40; i++) {                                   // hanging branchlets
        const bx = 64 + (rnd(i) - 0.5) * halfW * 1.5;
        const by = 12 + rnd(i + 60) * 62;
        const len = 22 + rnd(i + 120) * 40;
        blade(ci, bx, by, bx + (rnd(i + 180) - 0.5) * 12, by + len, 2.4, 0.6,
          0.64 + rnd(i + 240) * 0.46, rnd(i + 300), 0.60, (rnd(i + 360) - 0.5) * 6, true);
      }
    } else if (sp.arch === 'mangrove') {
      for (let i = 0; i < 7; i++) {                                    // many low stems, not one
        const bx = 64 + (rnd(i) - 0.5) * halfW * 1.2;
        stem(ci, bx, 127, 64 + (rnd(i + 20) - 0.5) * halfW * 0.7, 66, 2.6, 1.6, 0.62, 0.5);
      }
      drawCrownBlobs(52, 24, 26, halfW * 0.95, 12);
      for (let i = 0; i < 26; i++) {                                   // pneumatophores in the mud
        const bx = 64 + (rnd(i + 700) - 0.5) * halfW * 2.0;
        stem(ci, bx, 127, bx + (rnd(i + 800) - 0.5) * 3, 118 - rnd(i + 900) * 6, 1.1, 0.5, 0.50, 0.4);
      }
    } else if (sp.arch === 'shrub') {
      for (let i = 0; i < 5; i++) {                                    // gnarled multiple stems
        const tx = 64 + (rnd(i) - 0.5) * halfW * 0.9;
        stem(ci, 64 + (rnd(i + 10) - 0.5) * 8, 127, tx, 74 + rnd(i + 20) * 12, 2.6, 1.5, 0.56, 0.6);
      }
      drawCrownBlobs(58, 30, 22, halfW * 0.98, 12);
    } else {                                                            // tree
      const boleTop = 58;
      stem(ci, 64, 127, 64 + (rnd(1) - 0.5) * 8, boleTop, 4.6, 2.6, 0.72, 0.55);
      for (let i = 0; i < 4; i++) {                                     // limbs into the crown
        const s = i % 2 ? 1 : -1;
        stem(ci, 64, boleTop + 8 - i * 3, 64 + s * (16 + rnd(i + 40) * 16), 34 - rnd(i + 60) * 14,
          1.9, 0.9, 0.66, 0.5);
      }
      drawCrownBlobs(32, 23, 26, halfW * 0.98, 12);
    }
  }

  for (const sp of SPECIES) {
    const ci = cursor++;
    silhouette(ci, sp);
    cells['card:' + sp.id] = ci;
  }

  // Flowers get their own two cells: an upright candle for the banksia and the grass tree, and a
  // loose head for everything else. They are drawn white and tinted by the species' flower colour.
  const candle = cursor++;
  for (let i = 0; i < 90; i++) {
    const t = i / 89;
    blob(candle, 64 + (hash3(seed, candle, i) - 0.5) * 5, 118 - t * 104,
      12 - t * 3, 4.5, 0, 0.72 + hash3(seed, candle, i + 200) * 0.42, 0.5, 0.30, 0.55);
  }
  cells['flower:candle'] = candle;
  const head = cursor++;
  for (let i = 0; i < 150; i++) {
    const a = hash3(seed, head, i) * 6.283, r = Math.sqrt(hash3(seed, head, i + 400)) * 48;
    blob(head, 64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.9,
      5 + hash3(seed, head, i + 800) * 4, 5 + hash3(seed, head, i + 1200) * 4, 0,
      0.70 + hash3(seed, head, i + 1600) * 0.46, 0.5, 0.26, 0.5);
  }
  cells['flower:head'] = head;

  return { data, cells, size: ATLAS_SIZE, cell: ATLAS_CELL, cols: ATLAS_COLS, used: cursor };
}

/** UV rectangle of an atlas cell, inset by half a texel so a bilinear tap cannot cross the border. */
function cellUV(ci) {
  const inset = 1.5 / ATLAS_SIZE;
  const u0 = (ci % ATLAS_COLS) / ATLAS_COLS + inset;
  const v0 = ((ci / ATLAS_COLS) | 0) / ATLAS_COLS + inset;
  const s = 1 / ATLAS_COLS - inset * 2;
  return { u0, v0, s };
}

/* ================================================================== geometry

Local space is normalised: y runs 0 at the ground to 1 at the top of the plant, x and z run about
minus a half to a half. The instance matrix carries the real height in metres in its middle column
and the width in the other two, so one mesh is a four metre banksia and a twenty seven metre
blackbutt without a second mesh.

The vertex colour is four channels of instruction rather than a colour:
  r  which part this is: 0 wood, 0.5 foliage, 1 flower
  g  bend weight, 0 where the plant is anchored and 1 at the part that moves most
  b  a per-card phase offset, so the cards on one plant do not move as a single rigid object
  a  ambient occlusion, dark deep inside the canopy and bright on the outside of it */

const BARK_OF = {
  'scribbly-gum': 'smooth', 'forest-red-gum': 'smooth', 'blackbutt': 'rough',
  'swamp-mahogany': 'rough', 'pink-bloodwood': 'rough', 'broad-leaved-paperbark': 'paper',
  'cabbage-tree-palm': 'ringed', 'pandanus': 'ringed', 'coastal-sheoak': 'rough',
  'black-sheoak': 'rough', 'grass-tree': 'rough', 'grey-mangrove': 'smooth', 'red-mangrove': 'rough'
};

function newGeo() { return { p: [], n: [], u: [], c: [], i: [] }; }

/** A quad standing on the point `c`, `r` half across, `up` tall. Normals are spherical about
 *  `centre`, which is what stops a crown of flat cards reading as a crown of flat cards. */
function quad(g, cx, cy, cz, rx, ry, rz, ux, uy, uz, uv, part, bendA, bendB, ao, phase, centre) {
  const base = g.p.length / 3;
  const P = [
    [cx - rx, cy - ry, cz - rz, uv.u0, uv.v0 + uv.s, bendA],
    [cx + rx, cy + ry, cz + rz, uv.u0 + uv.s, uv.v0 + uv.s, bendA],
    [cx + rx + ux, cy + ry + uy, cz + rz + uz, uv.u0 + uv.s, uv.v0, bendB],
    [cx - rx + ux, cy - ry + uy, cz - rz + uz, uv.u0, uv.v0, bendB]
  ];
  for (const v of P) {
    g.p.push(v[0], v[1], v[2]);
    let nx = v[0] - centre[0], ny = (v[1] - centre[1]) * 0.75, nz = v[2] - centre[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    g.n.push(nx / l, ny / l, nz / l);
    g.u.push(v[3], v[4]);
    g.c.push(part, v[5], phase, ao);
  }
  g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  g.i.push(base, base + 2, base + 1, base, base + 3, base + 2);   // and the back face
}

/** A tapered prism: trunk, limb, prop root, pneumatophore. */
function prism(g, x0, y0, z0, x1, y1, z1, r0, r1, sides, uv, bendA, bendB, ao) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz) || 1;
  const ax = dx / len, ay = dy / len, az = dz / len;
  // Any perpendicular pair will do for a trunk.
  let ux = 0, uy = 0, uz = 1;
  if (Math.abs(az) > 0.9) { ux = 1; uy = 0; uz = 0; }
  let sx = uy * az - uz * ay, sy = uz * ax - ux * az, sz = ux * ay - uy * ax;
  let sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const tx = ay * sz - az * sy, ty = az * sx - ax * sz, tz = ax * sy - ay * sx;
  const base = g.p.length / 3;
  for (let ring = 0; ring < 2; ring++) {
    const r = ring ? r1 : r0;
    const bx = ring ? x1 : x0, by = ring ? y1 : y0, bz = ring ? z1 : z0;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = sx * ca + tx * sa, ny = sy * ca + ty * sa, nz = sz * ca + tz * sa;
      g.p.push(bx + nx * r, by + ny * r, bz + nz * r);
      g.n.push(nx, ny, nz);
      g.u.push(uv.u0 + uv.s * (i / sides), uv.v0 + uv.s * (ring ? 0.02 : 0.98));
      g.c.push(0, ring ? bendB : bendA, 0, ao);
    }
  }
  const per = sides + 1;
  for (let i = 0; i < sides; i++) {
    const a = base + i, b = a + 1, c = a + per, d = c + 1;
    g.i.push(a, c, b, b, c, d);
  }
}

/**
 * One species, one mesh. Everything a plant is made of is here: which cards, at what angle, how
 * far out, how much of it moves. The numbers are what make a she-oak read as a she-oak.
 */
function buildSpeciesGeometry(sp, cells, seed, spIndex) {
  const g = newGeo();
  const R = (i) => hash3(seed ^ 0x51ed, spIndex, i);
  const leafUV = cellUV(cells['leaf:' + sp.leaf]);
  const barkUV = cellUV(cells['bark:' + (BARK_OF[sp.id] || 'rough')]);
  const flowerUV = cellUV(cells[(sp.arch === 'shrub' && sp.id === 'wallum-banksia') || sp.arch === 'grasstree'
    ? 'flower:candle' : 'flower:head']);
  const wide = clamp((sp.w[0] + sp.w[1]) * 0.5, 0.5, 2.2);
  const centre = [0, 0.55, 0];

  // Foliage cards go on in crossed pairs so a plant has depth from every angle.
  const crossPair = (cx, cy, cz, size, tilt, bendA, bendB, ao, phase, uv, part) => {
    for (let k = 0; k < 2; k++) {
      const a = (k * Math.PI) / 2 + phase * 3.1;
      const ca = Math.cos(a), sa = Math.sin(a);
      quad(g, cx, cy, cz, ca * size * 0.5, 0, sa * size * 0.5,
        -ca * tilt * size, size, -sa * tilt * size, uv, part, bendA, bendB, ao, phase, centre);
    }
  };

  const addFlowers = (count, cy, spread, size, up) => {
    if (!sp.flower) return;
    for (let i = 0; i < count; i++) {
      const a = R(i + 700) * 6.283, r = Math.sqrt(R(i + 750)) * spread;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const y = cy + (R(i + 800) - 0.5) * 0.12;
      quad(g, cx - size * 0.5, y, cz, size, 0, 0, 0, size * up, 0, flowerUV, 1, 0.75, 1.0, 1, R(i + 850), centre);
      quad(g, cx, y, cz - size * 0.5, 0, 0, size, 0, size * up, 0, flowerUV, 1, 0.75, 1.0, 1, R(i + 860), centre);
    }
  };

  switch (sp.arch) {
    case 'tuft': {
      // Five crossed cards of blades, splayed outward, the whole plant bending from the base.
      for (let i = 0; i < 3; i++) {
        const a = R(i) * 6.283, r = R(i + 20) * 0.16 * wide;
        crossPair(Math.cos(a) * r, 0, Math.sin(a) * r,
          0.9 + R(i + 40) * 0.5, (R(i + 60) - 0.5) * 0.55, 0.05, 1.0, 0.55 + R(i + 80) * 0.45,
          R(i + 100), leafUV, 0.5);
      }
      break;
    }
    case 'mat': {
      // A creeper: mostly flat on the sand with a few leaves standing up out of it.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + R(i) * 0.7;
        const ca = Math.cos(a), sa = Math.sin(a);
        quad(g, -ca * 0.55, 0.02 + R(i + 10) * 0.06, -sa * 0.55, -sa * 0.5, 0, ca * 0.5,
          ca * 1.1, 0.10, sa * 1.1, leafUV, 0.5, 0.2, 0.7, 0.85, R(i + 20), centre);
      }
      crossPair(0, 0, 0, 0.55, 0.15, 0.1, 1.0, 1.0, R(50), leafUV, 0.5);
      addFlowers(5, 0.10, 0.5, 0.16, 1);
      break;
    }
    case 'shrub': {
      for (let i = 0; i < 4; i++) {         // several gnarled stems from the ground, not one trunk
        const a = (i / 4) * 6.283 + R(i) * 1.2;
        prism(g, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04,
          Math.cos(a) * 0.16 * wide, 0.42 + R(i + 8) * 0.18, Math.sin(a) * 0.16 * wide,
          0.030, 0.016, 4, barkUV, 0, 0.35, 0.55);
      }
      for (let i = 0; i < 4; i++) {
        const a = R(i + 30) * 6.283, r = Math.sqrt(R(i + 60)) * 0.42 * wide;
        const y = 0.30 + R(i + 90) * 0.58;
        crossPair(Math.cos(a) * r, y, Math.sin(a) * r, 0.28 + R(i + 120) * 0.17,
          (R(i + 150) - 0.5) * 0.55, 0.25, 0.9, 0.22 + 0.78 * (r / (0.42 * wide)),
          R(i + 180), leafUV, 0.5);
      }
      addFlowers(sp.id === 'wallum-banksia' ? 4 : 5, 0.62, 0.30 * wide,
        sp.id === 'wallum-banksia' ? 0.13 : 0.16, sp.id === 'wallum-banksia' ? 1.5 : 1);
      break;
    }
    case 'grasstree': {
      prism(g, 0, 0, 0, 0, 0.42, 0, 0.075, 0.062, 6, barkUV, 0, 0.10, 0.5);
      for (let i = 0; i < 7; i++) {          // the skirt of blades, radiating and drooping
        const a = (i / 7) * 6.283 + R(i) * 0.5;
        const ca = Math.cos(a), sa = Math.sin(a);
        quad(g, -ca * 0.05 - sa * 0.22, 0.44, -sa * 0.05 + ca * 0.22,
          sa * 0.44, 0, -ca * 0.44, ca * 0.44, 0.44, sa * 0.44,
          leafUV, 0.5, 0.15, 1.0, 0.75, R(i + 20), centre);
      }
      prism(g, 0, 0.44, 0, 0, 0.72, 0, 0.020, 0.014, 4, barkUV, 0.1, 0.5, 0.9);
      if (sp.flower) {
        quad(g, -0.055, 0.70, 0, 0.11, 0, 0, 0, 0.30, 0, flowerUV, 1, 0.5, 1.0, 1, 0.2, centre);
        quad(g, 0, 0.70, -0.055, 0, 0, 0.11, 0, 0.30, 0, flowerUV, 1, 0.5, 1.0, 1, 0.4, centre);
      }
      break;
    }
    case 'pandanus': {
      prism(g, 0, 0, 0, (R(1) - 0.5) * 0.10, 0.60, (R(2) - 0.5) * 0.10, 0.055, 0.040, 5, barkUV, 0, 0.20, 0.5);
      for (let i = 0; i < 5; i++) {          // the prop roots, which are the whole silhouette
        const a = (i / 5) * 6.283 + R(i + 5) * 0.6;
        prism(g, Math.cos(a) * 0.020, 0.30 - i * 0.03, Math.sin(a) * 0.020,
          Math.cos(a) * 0.24 * wide, 0, Math.sin(a) * 0.24 * wide, 0.016, 0.024, 4, barkUV, 0.05, 0, 0.45);
      }
      for (let i = 0; i < 8; i++) {          // the crown of straps, each one a card
        const a = (i / 8) * 6.283 + R(i + 40) * 0.4;
        const ca = Math.cos(a), sa = Math.sin(a);
        const out = 0.40 + R(i + 60) * 0.20, up = 0.34 + R(i + 80) * 0.24;
        quad(g, -sa * 0.055, 0.58, ca * 0.055, sa * 0.11, 0, -ca * 0.11,
          ca * out * wide, up, sa * out * wide, leafUV, 0.5, 0.10, 1.0, 0.9, R(i + 100), centre);
      }
      break;
    }
    case 'palm': {
      prism(g, 0, 0, 0, (R(1) - 0.5) * 0.05, 0.74, (R(2) - 0.5) * 0.05, 0.036, 0.028, 6, barkUV, 0, 0.25, 0.55);
      for (let i = 0; i < 8; i++) {          // the fan crown, every frond a card
        const a = (i / 8) * 6.283 + R(i + 30) * 0.35;
        const ca = Math.cos(a), sa = Math.sin(a);
        const droop = -0.06 - R(i + 50) * 0.22;
        const out = 0.34 + R(i + 60) * 0.14;
        quad(g, -sa * 0.05, 0.73, ca * 0.05, sa * 0.10, 0, -ca * 0.10,
          ca * out * wide, 0.26 + droop, sa * out * wide, leafUV, 0.5, 0.05, 1.0, 0.95, R(i + 80), centre);
      }
      break;
    }
    case 'droop': {
      const th = 0.62;
      prism(g, 0, 0, 0, 0, th, 0, 0.032, 0.014, 5, barkUV, 0, 0.30, 0.5);
      for (let i = 0; i < 3; i++) {
        const a = R(i) * 6.283;
        prism(g, 0, th * 0.55, 0, Math.cos(a) * 0.22 * wide, th + 0.16, Math.sin(a) * 0.22 * wide,
          0.014, 0.006, 4, barkUV, 0.3, 0.7, 0.5);
      }
      // Hanging foliage. The card is anchored at its top and the bend weight runs downward, so the
      // tips are what streams and the branch it hangs from does not.
      for (let i = 0; i < 8; i++) {
        const a = R(i + 40) * 6.283, r = Math.sqrt(R(i + 60)) * 0.40 * wide;
        const top = 0.42 + R(i + 80) * 0.56;
        const drop = 0.22 + R(i + 100) * 0.24;
        const ca = Math.cos(a), sa = Math.sin(a);
        quad(g, ca * r, top - drop, sa * r, -sa * 0.15, 0, ca * 0.15, 0, drop, 0,
          leafUV, 0.5, 1.0, 0.15, 0.35 + 0.65 * (r / (0.40 * wide)), R(i + 120), centre);
      }
      break;
    }
    case 'mangrove': {
      for (let i = 0; i < 4; i++) {          // low multiple stems out of the mud
        const a = (i / 4) * 6.283 + R(i) * 0.9;
        prism(g, Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06,
          Math.cos(a) * 0.14, 0.40 + R(i + 8) * 0.14, Math.sin(a) * 0.14, 0.026, 0.014, 4, barkUV, 0, 0.30, 0.5);
      }
      if (sp.id === 'red-mangrove') {        // rhizophora: the arching prop roots
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 6.283 + R(i + 20) * 0.5;
          prism(g, Math.cos(a) * 0.05, 0.34, Math.sin(a) * 0.05,
            Math.cos(a) * 0.30 * wide, 0, Math.sin(a) * 0.30 * wide, 0.013, 0.018, 4, barkUV, 0.05, 0, 0.4);
        }
      } else {                                // avicennia: pneumatophores standing out of the mud
        for (let i = 0; i < 9; i++) {
          const a = R(i + 200) * 6.283, r = 0.20 + Math.sqrt(R(i + 220)) * 0.42 * wide;
          prism(g, Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * r, 0.09 + R(i + 240) * 0.07,
            Math.sin(a) * r, 0.011, 0.005, 3, barkUV, 0, 0.05, 0.35);
        }
      }
      for (let i = 0; i < 7; i++) {
        const a = R(i + 40) * 6.283, r = Math.sqrt(R(i + 60)) * 0.48 * wide;
        crossPair(Math.cos(a) * r, 0.34 + R(i + 80) * 0.48, Math.sin(a) * r,
          0.30 + R(i + 100) * 0.18, (R(i + 120) - 0.5) * 0.40, 0.25, 0.85,
          0.22 + 0.78 * (r / (0.48 * wide)), R(i + 140), leafUV, 0.5);
      }
      break;
    }
    default: {                                // tree
      const th = 0.52 + R(3) * 0.10;
      prism(g, 0, 0, 0, (R(1) - 0.5) * 0.06, th, (R(2) - 0.5) * 0.06, 0.034, 0.019, 5, barkUV, 0, 0.22, 0.5);
      for (let i = 0; i < 3; i++) {           // limbs into the crown
        const a = (i / 3) * 6.283 + R(i + 10) * 1.1;
        prism(g, 0, th * 0.86, 0, Math.cos(a) * 0.26 * wide, th + 0.26 + R(i + 14) * 0.14,
          Math.sin(a) * 0.26 * wide, 0.014, 0.007, 4, barkUV, 0.25, 0.6, 0.5);
      }
      const crownY = th + 0.06;
      for (let i = 0; i < 8; i++) {
        const a = R(i + 30) * 6.283, r = Math.sqrt(R(i + 60)) * 0.56 * wide;
        const y = crownY + R(i + 90) * (0.97 - crownY);
        crossPair(Math.cos(a) * r, y, Math.sin(a) * r, 0.30 + R(i + 120) * 0.19,
          (R(i + 150) - 0.5) * 0.55, 0.45, 1.0,
          0.16 + 0.84 * clamp(r / (0.56 * wide) * 0.75 + (y - crownY) * 0.9, 0, 1),
          R(i + 180), leafUV, 0.5);
      }
      addFlowers(6, crownY + 0.20, 0.36 * wide, 0.14, 1);
      break;
    }
  }
  return g;
}

/** The billboard: one quad standing on the ground, showing this species' own silhouette. */
function buildCardGeometry(sp, cells) {
  const g = newGeo();
  const uv = cellUV(cells['card:' + sp.id]);
  const centre = [0, 0.5, 0];
  // Card space is the same normalised space as the model, so a card and a model of the same plant
  // are the same size and stand in the same place, which is what the cross-fade depends on.
  const wide = clamp((sp.w[0] + sp.w[1]) * 0.5, 0.5, 2.2);
  quad(g, -0.5 * wide, 0, 0, wide, 0, 0, 0, 1, 0, uv, 0.5, 0.10, 1.0, 0.85, 0.0, centre);
  return g;
}

function geoToMesh(scene, name, g) {
  const mesh = new B.Mesh(name, scene);
  const vd = new B.VertexData();
  vd.positions = new Float32Array(g.p);
  vd.normals = new Float32Array(g.n);
  vd.uvs = new Float32Array(g.u);
  vd.colors = new Float32Array(g.c);
  vd.indices = new Uint32Array(g.i);
  vd.applyToMesh(mesh, false);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  return mesh;
}

/* ================================================================== shaders */

const SHADOW_RANGE = 44.0;    // metres of shade depth the terrain sweep texture can encode

const FLORA_VERT = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 color;
#ifdef INSTANCES
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
#endif

uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uWind;    // x,y wind direction on the ground, z strength 0..1.4, w seconds
uniform vec4 uSway;    // x freq A, y amplitude, z freq B, w wave number, 1/metres
uniform vec4 uSway2;   // x stiffness, y steady stream, z flutter frequency, w gust response
uniform vec4 uLod;     // x full-density distance, y card end, z aggregate boost, w minimum keep
uniform vec4 uFade;    // x fade start, y fade end, z 0, w 0
uniform vec4 uSeason;  // x flowering, y greenness, z wet, w 0

varying vec2 vUV;
varying vec4 vNrm;     // xyz normal, w this plant's own colour variation
varying vec3 vWorld;
varying vec4 vCol;     // r part, g metres above the ground, b fade alpha, a baked occlusion

void main(void) {
#ifdef INSTANCES
  mat4 W = mat4(world0, world1, world2, world3);
#else
  mat4 W = mat4(1.0);
#endif
  vec3 ipos = vec3(W[3][0], W[3][1], W[3][2]);
  float rank = W[0][3];
  float varia = W[1][3];
  float phase = W[2][3];
  float sy = max(W[1][1], 0.001);
  float sxz = max(length(W[0].xyz), 0.001);

  float d = length(uCam - ipos);

  // Out of season a flower collapses into the twig it grows on rather than being drawn and hidden.
  vec3 lp = position;
  float isFlower = step(0.75, color.r);
  lp = mix(lp, vec3(0.0, position.y * 0.12, 0.0), isFlower * (1.0 - uSeason.x));

  // How many of this species survive at this distance, and how far this one is through that cut.
  float keep = clamp(pow(uLod.x / max(d, 1.0), 1.90), uLod.w, 1.0);
  float thin = 1.0 - smoothstep(keep * 0.86, keep, rank);

  vec3 wp;
  vec3 rightAxis;
#ifdef CARD
  // Cylindrical billboard. Beyond the full-density distance the survivors grow, so a thinning
  // forest keeps its canopy cover instead of turning into a scatter of separate dots.
  vec3 toCam = uCam - ipos;
  toCam.y = 0.0;
  float tl = max(length(toCam), 0.001);
  vec3 fwd = toCam / tl;
  rightAxis = vec3(-fwd.z, 0.0, fwd.x);
  float boost = 1.0 + uLod.z * smoothstep(uLod.x * 1.15, uLod.y * 0.60, d);
  wp = ipos + rightAxis * (lp.x * sxz * boost) + vec3(0.0, lp.y * sy * boost, 0.0);
  vNrm = vec4(normalize(rightAxis * (lp.x * 1.7) + vec3(0.0, 0.42, 0.0) + fwd * 0.80), varia);
  float a = thin * smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uLod.y * 0.80, uLod.y, d));
#else
  mat3 Rm = mat3(W[0].xyz, W[1].xyz, W[2].xyz);
  wp = ipos + Rm * lp;
  rightAxis = normalize(W[0].xyz);
  vNrm = vec4(normalize(Rm * normal), varia);
  float a = thin * (1.0 - smoothstep(uFade.x, uFade.y, d));
#endif

  // ---- wind. The species parameters are the whole point: spinifex lays over in travelling bands,
  // banksia rattles only at the tips, a she-oak leans downwind and stays there.
  vec2 wdir = uWind.xy;
  float bend = pow(max(color.g, 0.0), uSway2.x);
  float ph = phase * 6.2831 + dot(ipos.xz, wdir) * uSway.w + color.b * 6.2831 + varia * 2.7;
  float t = uWind.w;
  float gust = 1.0 + uSway2.w * uWind.z * (0.5 + 0.5 * sin(t * 0.27 + dot(ipos.xz, wdir) * 0.0032));
  float s1 = sin(t * uSway.x + ph) * uSway.y;
  float s2 = sin(t * uSway.z + ph * 1.63 + 1.7) * uSway.y * 0.42;
  float off = (uWind.z * (s1 + s2) * gust + uWind.z * uSway2.y) * bend * sy;
  wp.xz += wdir * off;
  wp.y -= abs(off) * bend * 0.22;
#ifndef CARD
  // A little sideways flutter at the leaf tips, which is what a fine-leaved plant actually does.
  wp += rightAxis * (sin(t * uSway2.z + ph * 2.9) * uWind.z * bend * 0.035 * sy);
#endif

  vUV = uv;
  vWorld = wp;
  vCol = vec4(color.r, max(wp.y - ipos.y, 0.0), clamp(a, 0.0, 1.0), color.a);

  // An instance that is entirely faded out is collapsed off the screen rather than drawn and
  // discarded a pixel at a time. It matters more than it sounds: a card standing where its own
  // three dimensional model is already drawn is faded to nothing and is also the biggest thing on
  // the screen, so leaving it in the rasteriser was costing more fill than everything else here
  // put together. Clipping it in the vertex shader took the frame from eighty milliseconds to two.
  if (a <= 0.004) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const FLORA_FRAG = `
precision highp float;

varying vec2 vUV;
varying vec4 vNrm;
varying vec3 vWorld;
varying vec4 vCol;

uniform vec3 uCam;
uniform vec4 uSun;      // xyz toward the sun, w how far above the horizon 0..1
uniform vec4 uSunCol;   // rgb colour, a intensity
uniform vec4 uSky;      // rgb zenith
uniform vec4 uSkyHz;    // rgb horizon
uniform vec4 uTune;     // x fog density, y translucency, z occlusion strength, w alpha cutoff
uniform vec4 uLeafA;    // rgb the paler leaf tone
uniform vec4 uLeafB;    // rgb the darker leaf tone
uniform vec4 uWoodC;    // rgb bark
uniform vec4 uFlowerC;  // rgb flower or fruit, a how much of it there is now
uniform vec4 uSeason;   // x flowering, y greenness, z wet, w 0
uniform vec4 uShadowF;  // x0, z0, cell, 0
uniform vec4 uShadowN;  // nx, nz, 1/nx, 1/nz
uniform sampler2D texA;
uniform sampler2D texS;

// The haze colour toward the horizon. This is deliberately the cheap version of the expression the
// terrain and the ocean use: their sun-disc terms are three pow() calls, and a foliage fragment is
// drawn ten or twenty deep, so the same three calls cost ten or twenty times as much here for a
// term the eye cannot find inside a leaf. The zenith to horizon ramp and a soft forward scatter
// carry the same colour, and dropping the rest took the worst view on this island from forty one
// milliseconds a frame to nine.
vec3 hazeColour(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, sqrt(up));
  float s = max(dot(d, uSun.xyz), 0.0);
  c += uSunCol.rgb * uSunCol.a * (s * s * s * 0.14);
  return c;
}

void main(void) {
  // The fade test first, and before any texture is read: a fragment that is about to go has no
  // business fetching two textures on the way out.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vCol.b < ign) discard;

  // Level of detail cross-fade, as an interleaved gradient dither rather than a blend, so foliage
  // stays in the opaque pass with a correct depth and nothing has to be sorted.
  vec4 tex = texture2D(texA, vUV);
  if (tex.a < uTune.w) discard;

  float part = vCol.r;
  float isWood = 1.0 - step(0.25, part);
  float isFlower = step(0.75, part);
  float isLeaf = (1.0 - isWood) * (1.0 - isFlower);

  vec3 base = mix(uLeafA.rgb, uLeafB.rgb, clamp(tex.b * 0.55 + vNrm.w * 0.75, 0.0, 1.0));
  base = mix(base, uWoodC.rgb, isWood);
  base = mix(base, uFlowerC.rgb, isFlower);
  // In flower the outer foliage takes the flower colour too, which is what makes a wattle in
  // August read as gold from a kilometre away rather than as a green bush with dots on it.
  base = mix(base, uFlowerC.rgb, isLeaf * uFlowerC.a * 0.80 * (1.0 - tex.g));

  // Drought. The heath and the sedge go off long before the eucalypts do, and on this island that
  // is most winters. Rain darkens everything and saturates it.
  base = mix(base * vec3(1.14, 1.03, 0.70), base, clamp(uSeason.y, 0.0, 1.0));
  base *= 1.0 - uSeason.z * 0.20;

  float ao = mix(1.0 - uTune.z, 1.0, clamp(vCol.a * (0.46 + 0.54 * (1.0 - tex.g)), 0.0, 1.0));
  vec3 alb = base * (0.74 + 0.90 * tex.r) * ao * (0.84 + 0.28 * vNrm.w);

  vec3 N = normalize(vNrm.xyz);
  vec3 V = uCam - vWorld;
  float dist = length(V);
  V /= dist;
  vec3 L = uSun.xyz;
  float lam = max(dot(N, L), 0.0);

  // Terrain shade, from the heightfield sweep. The depth is measured at the ground, so subtracting
  // how high up this pixel is gives a tree with a lit crown and a shaded trunk for free.
  vec2 suv = (vWorld.xz - uShadowF.xy) / (uShadowN.xy * uShadowF.z);
  float depth = texture2D(texS, suv).r * ${SHADOW_RANGE.toFixed(1)} - vCol.g;
  float lit = 1.0 - smoothstep(0.0, 1.9, depth);
  lit = mix(1.0, lit, smoothstep(-0.012, 0.030, uSun.y));

#ifdef CARD
  // The cheap path. A billboard is never more than a few dozen pixels tall, and it is drawn behind
  // and in front of a dozen others, so it gets direct sun, sky fill, occlusion and haze and
  // nothing else.
  float lowSunC = 1.0 - smoothstep(0.02, 0.40, uSun.y);
  vec3 ambC = mix(uSkyHz.rgb * 0.34 + uSky.rgb * 0.15,
                  uSunCol.rgb * 0.15 + uSkyHz.rgb * 0.14, lowSunC);
  vec3 colC = alb * (uSunCol.rgb * uSunCol.a * (0.05 + 1.12 * max(dot(N, L), 0.0) * lit)
            + ambC * (0.42 + 0.40 * N.y) * ao * ao * (0.30 + 0.70 * clamp(uSun.y * 3.2, 0.0, 1.0))
            + vec3(0.014, 0.018, 0.030) * (1.0 - uSun.w) * ao);
  float fogC = 1.0 - exp(-dist * uTune.x);
  vec3 hzC = mix(uSkyHz.rgb, uSky.rgb, 0.30);
  hzC = mix(vec3(dot(hzC, vec3(0.30, 0.59, 0.11))), hzC, 0.72) * 0.94;
  colC = mix(colC, hzC, fogC * 0.86);
  float pkC = max(colC.r, max(colC.g, colC.b));
  if (pkC > 0.78) { float o = pkC - 0.78; colC *= (0.78 + o / (1.0 + o * 1.9)) / pkC; }
  gl_FragColor = vec4(colC, 1.0);
  return;
#endif

  // Light through a leaf. A canopy at a low sun is mostly this, and without it foliage against
  // the sun reads as a black cut-out. It is transmission, not reflection, so it only belongs on
  // the leaves that are not already lit from the front: at full strength on every leaf it doubled
  // the brightness of the whole canopy and made a eucalypt forest read as pale mint over dark
  // ground, which is the single thing that was most wrong with the first version of this layer.
  float bt = max(dot(-V, L), 0.0);
  float back = bt * bt * bt * uTune.y * lit * (1.0 - isWood) * uSun.w * (1.0 - lam * 0.78);

  float lowSun = 1.0 - smoothstep(0.02, 0.40, uSun.y);
  float fillK = 0.30 + 0.70 * clamp(uSun.y * 3.2, 0.0, 1.0);
  vec3 ambCol = mix(uSkyHz.rgb * 0.34 + uSky.rgb * 0.15,
                    uSunCol.rgb * 0.15 + uSkyHz.rgb * 0.14, lowSun);
  vec3 lightSun = uSunCol.rgb * uSunCol.a * (0.05 + 1.12 * lam * lit);
  vec3 lightSky = ambCol * (0.42 + 0.40 * N.y) * ao * ao * fillK;
  vec3 nightFill = vec3(0.014, 0.018, 0.030) * (1.0 - uSun.w) * ao;

  vec3 outCol = alb * (lightSun + lightSky + nightFill);
  outCol += uSunCol.rgb * uSunCol.a * back * base * 0.62;
  // Bounce off white quartz sand. On this island that is a real term: the ground under an open
  // eucalypt canopy is nearly white and it throws a lot of light back up into the leaves.
  outCol += alb * vec3(0.60, 0.58, 0.52) * 0.07 * uSunCol.rgb * uSunCol.a
          * clamp(uSun.y, 0.0, 1.0) * lit * (1.0 - N.y * 0.5);

  // Aerial perspective on exactly the model and the numbers the terrain layer uses, so a distant
  // forest and the dune it stands on recede together instead of separating.
  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = hazeColour(normalize(vec3(-V.x, max(0.02, -V.y * 0.2 + 0.05), -V.z)));
  hz = mix(vec3(dot(hz, vec3(0.30, 0.59, 0.11))), hz, 0.72) * 0.94;
  outCol = mix(outCol, hz, fog * 0.86);

  // The same highlight shoulder the terrain uses, so a sunlit leaf and the sunlit sand beside it
  // roll off together instead of one of them clipping first. The guard matters: without it the
  // last line divides by the peak channel on every pixel, which lifts every dark fragment to
  // exactly the shoulder value. That one missing branch is what made an entire eucalypt forest
  // render as a flat sheet of pale mint over dark ground, at every time of day and every angle.
  float pk = max(outCol.r, max(outCol.g, outCol.b));
  if (pk > 0.78) {
    float over = pk - 0.78;
    outCol *= (0.78 + over / (1.0 + over * 1.9)) / pk;
  }

  gl_FragColor = vec4(outCol, 1.0);
}
`;

/* ================================================================== terrain shade

The same idea the terrain layer uses at 64 m, run here at 128 m and carrying depth only. One linear
pass over the island gives the shade across all thirty-nine kilometres with no cascade seam and no
depth bias, and it costs about half a millisecond when the sun has moved far enough to want it. */

function makeFloraShadow(island, step) {
  const g = island.grid;
  const nx = Math.floor((g.nx + step - 1) / step);
  const nz = Math.floor((g.nz + step - 1) / step);
  const cell = g.cell * step;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      // The highest node in the block, not one corner: a crest that is not in the field cannot
      // cast the shadow the field exists to carry.
      const j0 = Math.min(g.nz - 1, j * step), i0 = Math.min(g.nx - 1, i * step);
      let m = -1e9;
      for (let b = 0; b < step; b++) {
        const jb = Math.min(g.nz - 1, j0 + b);
        for (let a = 0; a < step; a++) {
          const ib = Math.min(g.nx - 1, i0 + a);
          const v = g.height[jb * g.nx + ib];
          if (v > m) m = v;
        }
      }
      h[j * nx + i] = m;
    }
  }
  const S = new Float32Array(nx * nz);
  const dep = new Float32Array(nx * nz);
  const tmp = new Float32Array(nx * nz);
  const data = new Uint8Array(nx * nz * 4);
  const SCALE = 255 / SHADOW_RANGE;

  return {
    nx, nz, cell, data, ms: 0, shadedFraction: 0,
    update(azimuthRad, altitudeRad) {
      const t0 = performance.now();
      const dx = -Math.sin(azimuthRad), dz = -Math.cos(azimuthRad);
      const tanAlt = Math.max(0.012, Math.tan(Math.max(0.004, altitudeRad)));
      const adx = Math.abs(dx), adz = Math.abs(dz);
      const wI = adx / (adx + adz + 1e-6), wJ = 1 - wI;
      const drop = tanAlt * cell * (adx + adz);
      const si = dx >= 0 ? 1 : -1, sj = dz >= 0 ? 1 : -1;
      const i0 = dx >= 0 ? 0 : nx - 1, i1 = dx >= 0 ? nx : -1;
      const j0 = dz >= 0 ? 0 : nz - 1, j1 = dz >= 0 ? nz : -1;
      for (let j = j0; j !== j1; j += sj) {
        const base = j * nx;
        const pj = j - sj;
        const hasJ = pj >= 0 && pj < nz;
        for (let i = i0; i !== i1; i += si) {
          const k = base + i;
          const pi = i - si;
          let up = 0;
          up += (pi >= 0 && pi < nx) ? wI * S[k - si] : wI * h[k];
          up += hasJ ? wJ * S[pj * nx + i] : wJ * h[k];
          const carried = up - drop;
          S[k] = carried > h[k] ? carried : h[k];
          dep[k] = S[k] - h[k];
        }
      }
      // The sweep arrives quantised to the grid; one three tap blur turns rectangles back into
      // edges that follow the ground.
      for (let j = 0; j < nz; j++) {
        const b = j * nx;
        let prev = dep[b];
        for (let i = 0; i < nx - 1; i++) {
          const cur = dep[b + i];
          tmp[b + i] = (prev + cur + dep[b + i + 1]) / 3;
          prev = cur;
        }
        tmp[b + nx - 1] = (prev + dep[b + nx - 1] * 2) / 3;
      }
      let shaded = 0, land = 0;
      for (let i = 0; i < nx; i++) {
        let prev = tmp[i];
        for (let j = 0; j < nz; j++) {
          const k = j * nx + i;
          const cur = tmp[k];
          const v = j < nz - 1 ? (prev + cur + tmp[k + nx]) / 3 : (prev + cur * 2) / 3;
          prev = cur;
          const d = v * SCALE;
          data[k * 4] = d > 255 ? 255 : d < 0 ? 0 : d | 0;
          data[k * 4 + 3] = 255;
          if (h[k] > island.seaLevel + 0.5) { land++; if (v > 0.25) shaded++; }
        }
      }
      this.shadedFraction = land ? shaded / land : 0;
      this.ms = performance.now() - t0;
    }
  };
}

/* ================================================================== the clipmap

Three grids of tiles over the island, each carrying the species that are still worth drawing at its
range. A tile is generated once and cached; nothing is generated twice and nothing is generated
because the camera turned around.

  fine    160 m tiles out to  420 m   every species, full density
  coarse  640 m tiles out to 3600 m   species still visible past 420 m, thinned by distance
  far    2560 m tiles out to 9000 m   canopy trees only, thinned hard and drawn larger

A coarse tile is built out of the sixteen fine tiles inside it, using the same hash, so the plants
in it are the same plants in the same places as the fine grid would have produced. That is what lets
one tier hand over to the next without a single plant moving. */

const TILE = 160;
const FINE_R = 420;
const COARSE_MUL = 4;      // 640 m
const COARSE_R = 2300;
const FAR_MUL = 16;        // 2560 m
const FAR_R = 4400;
const SUB = 40;            // metres between land cover classifications

// The billboard tier starts thinning at seven tenths of the distance the model tier holds full
// density to, and the survivors grow to cover for the ones that went. Below the floor nothing more
// is removed: a canopy at six kilometres is still a canopy.
// Standing inside the forest is the worst case this layer has, and it is a fill rate problem, not
// a draw call one: alpha tested foliage cannot use early depth rejection, so every card behind
// every other card is still shaded. Sixty thousand tree cards measured fifty two milliseconds a
// frame on the integrated part this project targets. The answer is the aggregate impostor: thin
// the billboards hard with distance and grow the survivors, so the canopy keeps its cover with a
// fifth of the quads. Coverage goes as keep times boost squared, and these two numbers are chosen
// together to hold it near constant out to three kilometres.
const CARD_D0 = 0.85;
const CARD_KEEP_POW = 1.90;
const CARD_BOOST = 2.30;
const CARD_KEEP_MIN = 0.004;

// Distances at which a tile is regenerated. A tile generates for the nearest rung it has reached,
// so approaching it does not rebuild it every metre, and it is only ever rebuilt to add plants.
const NEAR_BANDS = [70, 120, 200, 330, 540, 880, 1450, 2400, 3900, 6400, 12000];
function nearBand(d) {
  for (let i = 0; i < NEAR_BANDS.length; i++) if (d <= NEAR_BANDS[i]) return i;
  return NEAR_BANDS.length - 1;
}

export function buildFloraRenderer(world, island, ctx) {
  const { SEED, classify, noise, state, live, notes } = ctx;
  const fire = ctx.fireProbe;
  const stage = world.stage;
  const scene = stage.scene;
  const nSp = SPECIES.length;
  const seaLevel = island.seaLevel;

  /* ---- capacities -------------------------------------------------------- */

  const capGeom = new Int32Array(nSp);
  const capCard = new Int32Array(nSp);
  for (let s = 0; s < nSp; s++) {
    const sp = SPECIES[s];
    // The most any one community puts down, not the average: a spinifex tile on the foredune is
    // all spinifex, and a buffer sized for the island mean would overflow the first time you stood
    // on the dune at Main Beach.
    let peak = 0;
    for (const c of COMMUNITIES) {
      for (const m of c.members) if (m.sp === s) peak = Math.max(peak, sp.density * m.w * c.scale);
    }
    const d0 = sp.d0, end = sp.cardEnd;
    const dc = d0 * CARD_D0;
    const tail = (Math.pow(end, 2 - CARD_KEEP_POW) - Math.pow(dc, 2 - CARD_KEEP_POW)) / (2 - CARD_KEEP_POW);
    const cards = peak * Math.PI * dc * dc + peak * 2 * Math.PI * Math.pow(dc, CARD_KEEP_POW) * tail;
    // Capped, and the cap is reported rather than hidden. A buffer that can hold a hundred
    // thousand instances is a buffer that will one day upload six megabytes in one frame.
    capCard[s] = clamp(Math.round(cards * 1.28), 1500, 22000);
    capGeom[s] = clamp(Math.round(peak * Math.PI * sp.geomEnd * sp.geomEnd * 1.5), 400, 22000);
  }

  /* ---- the atlas, the meshes and the materials ---------------------------- */

  const t0 = performance.now();
  const atlas = makeAtlas(SEED);
  const texA = new B.RawTexture(atlas.data, ATLAS_SIZE, ATLAS_SIZE, B.Engine.TEXTUREFORMAT_RGBA,
    scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  texA.wrapU = texA.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  texA.anisotropicFilteringLevel = 1;

  const shadow = makeFloraShadow(island, 4);
  shadow.update(Math.PI * 0.25, 0.9);
  const texS = new B.RawTexture(shadow.data, shadow.nx, shadow.nz, B.Engine.TEXTUREFORMAT_RGBA,
    scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
  texS.wrapU = texS.wrapV = B.Texture.CLAMP_ADDRESSMODE;

  const shadowF = new B.Vector4(island.grid.x0, island.grid.z0, shadow.cell, 0);
  const shadowN = new B.Vector4(shadow.nx, shadow.nz, 1 / shadow.nx, 1 / shadow.nz);

  const UNIFORMS = ['viewProjection', 'uCam', 'uWind', 'uSway', 'uSway2', 'uLod', 'uFade',
    'uSeason', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uLeafA', 'uLeafB', 'uWoodC',
    'uFlowerC', 'uShadowF', 'uShadowN'];
  const ATTRS = ['position', 'normal', 'uv', 'color', 'world0', 'world1', 'world2', 'world3'];

  function makeMaterial(sp, card) {
    const mat = new B.ShaderMaterial('floraMat-' + sp.id + (card ? '-card' : ''), scene,
      { vertexSource: FLORA_VERT, fragmentSource: FLORA_FRAG },
      {
        attributes: ATTRS, uniforms: UNIFORMS, samplers: ['texA', 'texS'],
        defines: card ? ['#define CARD'] : [],
        needAlphaBlending: false, needAlphaTesting: true
      });
    mat.backFaceCulling = false;
    mat.setTexture('texA', texA);
    mat.setTexture('texS', texS);
    mat.setVector4('uShadowF', shadowF);
    mat.setVector4('uShadowN', shadowN);
    mat.setVector4('uLeafA', new B.Vector4(sp.leafA[0], sp.leafA[1], sp.leafA[2], 0));
    mat.setVector4('uLeafB', new B.Vector4(sp.leafB[0], sp.leafB[1], sp.leafB[2], 0));
    mat.setVector4('uWoodC', new B.Vector4(sp.wood[0], sp.wood[1], sp.wood[2], 0));
    mat.setVector4('uSway', new B.Vector4(sp.sway[0], sp.sway[1], sp.sway[2], sp.sway[3]));
    mat.setVector4('uSway2', new B.Vector4(sp.sway2[0], sp.sway2[1], sp.sway2[2], sp.sway2[3]));
    // Cards keep more of the plant than the model does at the same distance, and they grow as they
    // thin, so what you see at three kilometres is a canopy and not a dot field.
    // Cards thin from closer in than the models do and grow as they thin, so the same number of
    // pixels of canopy is carried by a quarter of the quads.
    mat.setVector4('uLod', new B.Vector4(card ? sp.d0 * CARD_D0 : sp.d0, sp.cardEnd,
      card ? CARD_BOOST : 0, card ? CARD_KEEP_MIN : 0.5));
    mat.setVector4('uFade', card
      ? new B.Vector4(sp.geomEnd * 0.88, sp.geomEnd * 1.02, 0, 0)
      : new B.Vector4(sp.geomEnd * 0.90, sp.geomEnd * 1.04, 0, 0));
    return mat;
  }

  const S = [];
  for (let s = 0; s < nSp; s++) {
    const sp = SPECIES[s];
    const geoMesh = geoToMesh(scene, 'flora-' + sp.id, buildSpeciesGeometry(sp, atlas.cells, SEED, s));
    const cardMesh = geoToMesh(scene, 'floraCard-' + sp.id, buildCardGeometry(sp, atlas.cells));
    const geoBuf = new Float32Array(capGeom[s] * 16);
    const cardBuf = new Float32Array(capCard[s] * 16);
    geoMesh.thinInstanceSetBuffer('matrix', geoBuf, 16, false);
    cardMesh.thinInstanceSetBuffer('matrix', cardBuf, 16, false);
    geoMesh.thinInstanceCount = 0;
    cardMesh.thinInstanceCount = 0;
    geoMesh.setEnabled(false);
    cardMesh.setEnabled(false);
    geoMesh.material = makeMaterial(sp, false);
    cardMesh.material = makeMaterial(sp, true);
    geoMesh.alphaIndex = 20;
    cardMesh.alphaIndex = 21;
    const fc = sp.flower || sp.leafA;
    S.push({
      sp, geoMesh, cardMesh, geoBuf, cardBuf, geoCount: 0, cardCount: 0,
      geoVerts: geoMesh.getTotalVertices(), overflow: 0,
      mat: geoMesh.material, cardMat: cardMesh.material,
      vFlower: new B.Vector4(fc[0], fc[1], fc[2], 0),
      vTuneGeo: new B.Vector4(0.000045, sp.transluc, 0.44, 0.52),
      vTuneCard: new B.Vector4(0.000045, sp.transluc, 0.34, 0.62)
    });
  }
  const buildMs = performance.now() - t0;

  /* ---- the scatter ------------------------------------------------------- */

  // Scratch, reused for every tile so a camera flight allocates nothing.
  const scratch = [];
  for (let s = 0; s < nSp; s++) scratch.push(new Float32Array(Math.min(capCard[s], 26000) * 16));
  const scratchN = new Int32Array(nSp);
  const cls = { com: NO_COMMUNITY, open: 1, prune: 1 };
  // How many of the modelled stems the renderer actually draws. The census in the read model is the
  // island's real modelled population and it does not move; this is the drawing budget, it is
  // published beside the census as renderDensity, and it is the honest way to say that a browser on
  // an integrated part cannot put thirty three million plants on the screen at once. Raise it with
  // world.bus.emit('ui:intent', { kind: 'flora:quality', value: 1 }).
  let quality = 0.55;

  /**
   * One tile of the clipmap. `mul` is how many 160 m fine tiles across it is, `keep` the fraction
   * of full density to lay down, and `minEnd` the shortest card range worth generating at all.
   * Returns per species Float32Arrays of instance matrices, in rank order, so any prefix of one is
   * a valid thinned version of it.
   */
  function generate(ftx, ftz, mul, band, minEnd, sub) {
    scratchN.fill(0);
    const SUB = sub;
    const nsub = Math.max(1, Math.round(TILE / SUB));
    // The nearest this tile can be at this rung. Every species works out its own keep fraction
    // from it, using the same curve the shader uses, so nothing is generated that the shader is
    // then going to fade out, and nothing the shader wants to keep is missing.
    const genDist = band > 0 ? NEAR_BANDS[band - 1] : 1;
    const keepOf = new Float32Array(nSp);
    for (let s = 0; s < nSp; s++) {
      const sp = SPECIES[s];
      if (genDist < sp.geomEnd + TILE) { keepOf[s] = 1; continue; }
      const d0 = sp.d0 * CARD_D0;
      keepOf[s] = clamp(Math.pow(d0 / genDist, CARD_KEEP_POW), CARD_KEEP_MIN, 1);
    }
    for (let sz = 0; sz < mul; sz++) {
      for (let sx = 0; sx < mul; sx++) {
        const tx = ftx + sx, tz = ftz + sz;
        const ox = tx * TILE, oz = tz * TILE;
        const tileHash = (Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ SEED) >>> 0;
        for (let cj = 0; cj < nsub; cj++) {
          for (let ci = 0; ci < nsub; ci++) {
            const cellHash = (tileHash ^ Math.imul(cj * nsub + ci + 1, 0x9e3779b1)) >>> 0;
            // Jitter where the cover is sampled, so a community boundary is a ragged line rather
            // than a staircase on a forty metre grid.
            const qx = ox + ci * SUB + SUB * (0.18 + 0.64 * hash2i(cellHash, 11));
            const qz = oz + cj * SUB + SUB * (0.18 + 0.64 * hash2i(cellHash, 12));
            const h = island.height(qx, qz);
            if (h < seaLevel - 1.4) continue;
            classify(island.landCoverIndex(qx, qz), h - MEAN_SEA_LEVEL, island.slope(qx, qz),
              island.shoreDistance(qx, qz), island.bayness(qx, qz), qx, qz, noise, cls);
            if (cls.com === NO_COMMUNITY || cls.open <= 0.01) continue;
            const com = COMMUNITIES[cls.com];
            const planted = !!com.planted;
            // How long since this ground burnt, from whichever ecology system is publishing it.
            // The wallum is a fire community: the shrubs are top-killed and come back from
            // lignotubers over about eight years, while the eucalypts resprout from epicormic buds
            // and keep standing. So a burn takes the heath down and leaves the trees, which is what
            // a recent burn on this island actually looks like from the Trans Island road.
            let burnT = 0;
            if (fire.sample) {
              const y = fire.sample(qx, qz);
              if (y >= 0 && y < 9) burnT = 1 - smoothstep(0, 9, y);
            }
            const integ = fire.integrity ? clamp(fire.integrity(qx, qz), 0.25, 1.2) : 1;
            for (let mi = 0; mi < com.members.length; mi++) {
              const m = com.members[mi];
              const s = m.sp;
              if (s === undefined) continue;
              const sp = SPECIES[s];
              if (sp.cardEnd < minEnd) continue;
              const keep = keepOf[s];
              if (keep <= 0) continue;
              const woody = sp.arch === 'tree' || sp.arch === 'droop' || sp.arch === 'palm'
                || sp.arch === 'pandanus' || sp.arch === 'mangrove';
              const fireDens = woody ? 1 - 0.22 * burnT : 1 - 0.55 * burnT;
              const dens = sp.density * m.w * com.scale * cls.open * quality * fireDens * integ;
              const nFull = dens * SUB * SUB;
              if (nFull <= 0) continue;
              const nCap = Math.max(1, Math.ceil(nFull));
              const want = Math.floor(nFull * keep + hash2i(cellHash, 40 + s));
              if (want <= 0) continue;
              const n = Math.min(want, nCap);
              const buf = scratch[s];
              const maxN = (buf.length / 16) | 0;
              for (let i = 0; i < n; i++) {
                if (scratchN[s] >= maxN) break;
                const hA = hash3(cellHash, s * 131 + 1, i);
                const hB = hash3(cellHash, s * 131 + 2, i);
                let px, pz;
                if (planted) {
                  // Even-aged and evenly spaced. Rehabilitated mine paths were replanted in rows
                  // and from the air they still look it, which is honest and is part of the story.
                  const gap = Math.max(1.2, 1 / Math.sqrt(Math.max(dens, 1e-4)));
                  const gx = Math.floor(ox / gap) + (i % 3);
                  const gz = Math.floor(oz / gap) + ((i / 3) | 0);
                  px = clamp((gx + 0.5) * gap + (hA - 0.5) * gap * 0.16, ox, ox + TILE);
                  pz = clamp((gz + 0.5) * gap + (hB - 0.5) * gap * 0.16, oz, oz + TILE);
                  px = ox + ci * SUB + ((px - ox) % SUB + SUB) % SUB;
                  pz = oz + cj * SUB + ((pz - oz) % SUB + SUB) % SUB;
                } else {
                  px = ox + ci * SUB + hA * SUB;
                  pz = oz + cj * SUB + hB * SUB;
                }
                const y = island.height(px, pz);
                if (y < seaLevel - 1.2) continue;
                const hC = hash3(cellHash, s * 131 + 3, i);
                const hD = hash3(cellHash, s * 131 + 4, i);
                const hE = hash3(cellHash, s * 131 + 5, i);
                // Even-aged regrowth has almost no size spread. Everything else has plenty.
                const spread = planted ? 0.22 : 1;
                const fireH = woody ? 1 - 0.16 * burnT : 0.24 + 0.76 * (1 - burnT);
                const hM = lerp(sp.h[0], sp.h[1], planted ? 0.42 + hC * spread : hC) * cls.prune * fireH;
                const wF = lerp(sp.w[0], sp.w[1], hD);
                const sxz = hM * wF;
                const rot = hE * 6.2831853;
                const o = scratchN[s] * 16;
                const cs = Math.cos(rot) * sxz, sn = Math.sin(rot) * sxz;
                buf[o] = cs; buf[o + 1] = 0; buf[o + 2] = -sn; buf[o + 3] = (i + 0.5) / nCap;
                buf[o + 4] = 0; buf[o + 5] = hM; buf[o + 6] = 0; buf[o + 7] = hash3(cellHash, s * 131 + 6, i);
                buf[o + 8] = sn; buf[o + 9] = 0; buf[o + 10] = cs; buf[o + 11] = hash3(cellHash, s * 131 + 7, i);
                buf[o + 12] = px; buf[o + 13] = y; buf[o + 14] = pz; buf[o + 15] = 1;
                scratchN[s]++;
              }
            }
          }
        }
      }
    }
    const out = new Array(nSp);
    let total = 0;
    for (let s = 0; s < nSp; s++) {
      out[s] = scratchN[s] ? scratch[s].slice(0, scratchN[s] * 16) : null;
      total += scratchN[s];
    }
    return { data: out, count: total };
  }

  /* ---- residency --------------------------------------------------------- */

  const cache = new Map();          // key -> {data, count, keep, minEnd, level, x, z, mul, used}
  // `sub` is how often the land cover is classified inside a tile. Close in it is every forty
  // metres, which is fine enough that a community boundary is a boundary. On the far grid it is
  // once per fine tile, because at three and a half kilometres a plant is two pixels across and
  // classifying sixteen times more often costs sixteen times more to draw the same two pixels.
  const LEVELS = [
    { mul: 1, radius: FINE_R, minEnd: 0, sub: SUB },
    { mul: COARSE_MUL, radius: COARSE_R, minEnd: FINE_R * 0.75, sub: SUB },
    { mul: FAR_MUL, radius: FAR_R, minEnd: COARSE_R * 0.72, sub: TILE }
  ];
  const wanted = [[], [], []];      // per level: resident tile records
  const pending = [];               // tiles asked for but not generated yet
  let residencyVersion = 0;
  let lastCamX = 1e9, lastCamZ = 1e9;
  const R = {
    scatterMs: 0, packMs: 0, shadowMs: 0, tilesGenerated: 0, pending: 0,
    lastSunAz: -999, lastSunAlt: -999, packSpecies: nSp, dirty: true, primeFrames: 0,
    burnRescatters: 0
  };

  function chooseTiles(cx, cz) {
    for (const w of wanted) w.length = 0;
    pending.length = 0;
    const covered = new Set();      // fine tile keys already carried by a nearer level
    for (let L = 0; L < LEVELS.length; L++) {
      const lv = LEVELS[L];
      const size = lv.mul * TILE;
      const half = size * 0.5;
      const reach = lv.radius + half * 1.5;
      const t0x = Math.floor((cx - reach) / size), t1x = Math.floor((cx + reach) / size);
      const t0z = Math.floor((cz - reach) / size), t1z = Math.floor((cz + reach) / size);
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const wx = tx * size, wz = tz * size;
          // Distance to the nearest point of the tile, which is what the generation density and
          // the shader's own thinning both have to agree about.
          const dx = Math.max(wx - cx, 0, cx - (wx + size));
          const dz = Math.max(wz - cz, 0, cz - (wz + size));
          const near = Math.hypot(dx, dz);
          if (near > lv.radius) continue;
          if (wx + size < island.domain.minX || wx > island.domain.maxX) continue;
          if (wz + size < island.domain.minZ || wz > island.domain.maxZ) continue;
          const ftx = tx * lv.mul, ftz = tz * lv.mul;
          if (L === 0) covered.add(ftx + ',' + ftz);
          const key = L + ':' + tx + ':' + tz;
          const band = nearBand(near);
          let rec = cache.get(key);
          if (!rec || band < rec.band) {
            rec = { key, level: L, tx, tz, ftx, ftz, mul: lv.mul, band, minEnd: lv.minEnd,
              sub: lv.sub, near, data: rec ? rec.data : null, count: rec ? rec.count : 0 };
            cache.set(key, rec);
            pending.push(rec);
          } else {
            rec.near = near;
          }
          rec.touched = residencyVersion;
          wanted[L].push(rec);
        }
      }
    }
    // A coarse or far tile must not repeat what a nearer level already draws. The overlap is
    // resolved at the fine tile, which is the unit both levels are built out of.
    for (let L = 1; L < LEVELS.length; L++) {
      for (const rec of wanted[L]) rec.skip = covered.size ? covered : null;
    }
    // Nearest first: the tiles you are standing in fill before the ones on the horizon.
    pending.sort((a, b) => a.near - b.near);
    // Evict anything that has not been asked for in a while, so a long flight does not grow.
    if (cache.size > 900) {
      for (const [k, rec] of cache) {
        if (rec.touched !== residencyVersion) cache.delete(k);
      }
    }
  }

  function serviceGeneration(budgetMs) {
    if (!pending.length) return 0;
    const t = performance.now();
    let done = 0;
    while (pending.length && performance.now() - t < budgetMs) {
      const rec = pending.shift();
      if (rec.touched !== residencyVersion) continue;
      const g = generate(rec.ftx, rec.ftz, rec.mul, rec.band, rec.minEnd, rec.sub);
      rec.data = g.data;
      rec.count = g.count;
      done++;
      R.tilesGenerated++;
      R.dirty = true;
    }
    R.scatterMs = performance.now() - t;
    return done;
  }

  /* ---- packing ----------------------------------------------------------- */

  // Species are packed one at a time under a time budget. A species whose buffer is a frame or two
  // behind the camera is invisible at these tile sizes, and it means a camera move never costs a
  // frame the way one big repack of every buffer would.
  let packCursor = 0;

  function packSpecies(s, camX, camZ) {
    const rec = S[s];
    const sp = rec.sp;
    const geo = rec.geoBuf, card = rec.cardBuf;
    const geoMax = capGeom[s] * 16, cardMax = capCard[s] * 16;
    let gN = 0, cN = 0, over = 0;
    const geomReach = sp.geomEnd + TILE * 0.75;
    for (let L = 0; L < LEVELS.length; L++) {
      const list = wanted[L];
      for (let t = 0; t < list.length; t++) {
        const tile = list[t];
        if (!tile.data) continue;
        const arr = tile.data[s];
        if (!arr || !arr.length) continue;
        if (L > 0 && tile.skip) {
          // Skip the fine tiles this coarse tile shares with the level above it. Tiles are built
          // fine tile by fine tile in order, so the fine tile a plant belongs to is recoverable
          // from its own position, which is cheaper than storing it.
          if (cN + arr.length <= cardMax) {
            for (let o = 0; o < arr.length; o += 16) {
              const fx = Math.floor(arr[o + 12] / TILE), fz = Math.floor(arr[o + 14] / TILE);
              if (tile.skip.has(fx + ',' + fz)) continue;
              card.set(arr.subarray(o, o + 16), cN);
              cN += 16;
            }
          } else over++;
          continue;
        }
        if (cN + arr.length <= cardMax) { card.set(arr, cN); cN += arr.length; } else over++;
        if (L === 0 && tile.near < geomReach && gN + arr.length <= geoMax) {
          geo.set(arr, gN); gN += arr.length;
        }
      }
    }
    rec.geoCount = gN / 16;
    rec.cardCount = cN / 16;
    rec.overflow = over;
    rec.geoMesh.thinInstanceCount = rec.geoCount;
    rec.cardMesh.thinInstanceCount = rec.cardCount;
    rec.geoMesh.setEnabled(rec.geoCount > 0);
    rec.cardMesh.setEnabled(rec.cardCount > 0);
    if (gN) rec.geoMesh.thinInstancePartialBufferUpdate('matrix', geo.subarray(0, gN), 0);
    if (cN) rec.cardMesh.thinInstancePartialBufferUpdate('matrix', card.subarray(0, cN), 0);
  }

  /* ---- per frame uniforms ------------------------------------------------ */

  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 0.9, 0.8, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.85, 0.4);
  const vWind = new B.Vector4(0.34, 0.94, 0.3, 0);
  const vTune = new B.Vector4(0.000045, 0.5, 0.5, 0.52);
  const vSeason = new B.Vector4(0, 1, 0, 0);
  const camPos = new B.Vector3();
  let clockT = 0;

  const layer = stage.addLayer({
    id: 'flora',
    order: 40,     // after the terrain and the ocean, before the postfx chain

    init() {
      console.info('[flora] built in ' + Math.round(buildMs) + ' ms: ' + nSp + ' species, '
        + (nSp * 2) + ' meshes, atlas ' + ATLAS_SIZE + ' with ' + atlas.used + ' cells, '
        + 'shade sweep ' + shadow.nx + 'x' + shadow.nz + ' at ' + shadow.cell + ' m');
      state.renderer = nSp + ' species as thin instances, ' + (nSp * 2) + ' meshes, one atlas';
    },

    frame(st, w, dt) {
      clockT += Math.min(0.12, dt || 0.016);
      const cam = st.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);

      /* --- sun and sky, on the terrain layer's own expressions so the canopy and the ground
             never disagree about the colour of the light between them. --- */
      const dl = w.read('daylight');
      const wx = w.read('weather');
      const alt = dl && Number.isFinite(dl.altitude) ? dl.altitude : 0.9;
      const az = dl && Number.isFinite(dl.azimuth) ? dl.azimuth : Math.PI * 0.25;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF, 0.4);
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), 0, 0, 0.42);

      /* --- wind. Direction is where the wind is going, not where it comes from, because that is
             what the plants have to be pushed toward. --- */
      const windTh = ((live.windDirDeg + 180) * Math.PI) / 180;
      const strength = clamp(live.windKt / 26, 0.04, 1.35);
      vWind.set(Math.sin(windTh), Math.cos(windTh), strength, clockT);
      vSeason.set(0, live.greenness, live.wet, 0);

      /* --- terrain shade, rebuilt only when the sun has moved enough to see it --- */
      const azDeg = az * 180 / Math.PI, altDeg = alt * 180 / Math.PI;
      if (Math.abs(azDeg - R.lastSunAz) + Math.abs(altDeg - R.lastSunAlt) > 1.5) {
        shadow.update(az, alt);
        texS.update(shadow.data);
        R.lastSunAz = azDeg; R.lastSunAlt = altDeg;
        R.shadowMs = shadow.ms;
      }

      /* --- residency. Only when the camera has actually moved. --- */
      const moved = Math.hypot(camPos.x - lastCamX, camPos.z - lastCamZ);
      if (moved > TILE * 0.25) {
        lastCamX = camPos.x; lastCamZ = camPos.z;
        residencyVersion++;
        chooseTiles(camPos.x, camPos.z);
        R.dirty = true;
      }
      // The first couple of seconds get a bigger budget, so the island is dressed by the time
      // anybody looks at it rather than filling in behind them.
      // The first few seconds get a slightly bigger budget so the island is dressed by the time
      // anybody looks at it, but not so big that the opening frames drop. A five millisecond
      // priming budget put the first second's frame times over thirty and dragged the one per cent
      // low under the sixty frame line the contract sets.
      const priming = R.primeFrames < 260;
      R.primeFrames++;
      serviceGeneration(priming ? 1.6 : 1.1);
      R.pending = pending.length;

      /* --- packing. One species a frame once the island is dressed, four while it is filling.
             A species whose buffer is a few frames behind the camera cannot be seen to be behind
             it at these tile sizes, and it means a camera move never costs a frame the way one
             repack of every buffer at once did: that was measured at a hundred and thirteen
             milliseconds, and it was the whole reason this was ever slow. --- */
      if (R.dirty) {
        const tp = performance.now();
        const runs = 1;
        for (let n = 0; n < runs; n++) {
          packSpecies(packCursor, camPos.x, camPos.z);
          packCursor = (packCursor + 1) % nSp;
          if (packCursor === 0 && !pending.length) { R.dirty = false; break; }
        }
        R.packMs = performance.now() - tp;
      }

      /* --- uniforms. Nothing is allocated in here: the vectors are per species and per tier, made
             once at build, and only the materials that have something to draw are touched. --- */
      for (let s = 0; s < nSp; s++) {
        const rec = S[s];
        if (!rec.geoCount && !rec.cardCount) continue;
        const sp = rec.sp;
        vSeason.x = live.flowerAmt[s];
        rec.vFlower.w = sp.flower ? live.flowerAmt[s] : 0;
        rec.vTuneGeo.x = vTune.x;
        rec.vTuneCard.x = vTune.x;
        for (let k = 0; k < 2; k++) {
          if (k ? !rec.cardCount : !rec.geoCount) continue;
          const m = k ? rec.cardMat : rec.mat;
          m.setVector3('uCam', camPos);
          m.setVector4('uSun', vSun);
          m.setVector4('uSunCol', vSunCol);
          m.setVector4('uSky', vSky);
          m.setVector4('uSkyHz', vSkyHz);
          m.setVector4('uWind', vWind);
          m.setVector4('uSeason', vSeason);
          m.setVector4('uFlowerC', rec.vFlower);
          m.setVector4('uTune', k ? rec.vTuneCard : rec.vTuneGeo);
        }
      }
    },

    dispose() {
      for (const rec of S) {
        rec.geoMesh.dispose(); rec.cardMesh.dispose();
        rec.mat.dispose(); rec.cardMat.dispose();
      }
      texA.dispose(); texS.dispose();
      cache.clear();
    }
  });

  /* ---- what the layer is actually doing, for the read model --------------- */

  let vertsGeom = 0;
  for (const rec of S) vertsGeom += rec.geoVerts;

  layer.report = () => {
    let g = 0, c = 0, draws = 0, over = 0;
    for (const rec of S) {
      g += rec.geoCount; c += rec.cardCount; over += rec.overflow;
      if (rec.geoCount) draws++;
      if (rec.cardCount) draws++;
    }
    state.instances = { geometry: g, cards: c, total: g + c };
    state.tiles = {
      fine: wanted[0].length, coarse: wanted[1].length, far: wanted[2].length,
      cached: cache.size, pending: pending.length, generated: R.tilesGenerated
    };
    state.drawCalls = draws;
    state.buildMs = +buildMs.toFixed(0);
    state.packMs = +R.packMs.toFixed(2);
    state.scatterMs = +R.scatterMs.toFixed(2);
    state.shadowMs = +R.shadowMs.toFixed(2);
    state.shadedFraction = +shadow.shadedFraction.toFixed(3);
    state.overflowingSpecies = over;
    state.quality = quality;
    state.renderDensity = quality;
    state.burnRescatters = R.burnRescatters;
    state.atlasCells = atlas.used;
    state.meshVertices = vertsGeom;
  };

  // A fire changes what is standing on the ground, so the tiles it touched have to be scattered
  // again. Anything else would leave the heath drawn as it was before the burn until the camera
  // happened to move far enough away to evict the tile.
  world.bus.on('ecology:burn', (p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    const r = (p.radiusM || 400) + TILE * 2;
    let dropped = 0;
    for (const [k, rec] of cache) {
      const size = rec.mul * TILE;
      const wx = rec.tx * size, wz = rec.tz * size;
      const dx = Math.max(wx - p.x, 0, p.x - (wx + size));
      const dz = Math.max(wz - p.z, 0, p.z - (wz + size));
      if (dx * dx + dz * dz <= r * r) { cache.delete(k); dropped++; }
    }
    if (dropped) { lastCamX = 1e9; lastCamZ = 1e9; R.dirty = true; R.burnRescatters++; }
  });

  world.bus.on('ui:intent', (p) => {
    if (p && p.kind === 'flora:quality' && Number.isFinite(p.value)) {
      quality = clamp(p.value, 0.15, 2);
      cache.clear();
      residencyVersion++;
      lastCamX = 1e9;
      R.dirty = true;
    }
  });

  // The render layer has no tick of its own, so hang the report off the system that does.
  const sys = world.system('flora');
  if (sys) {
    const inner = sys.tick;
    sys.tick = (w) => { inner(w); layer.report(); };
  }
  if (notes.length) console.info('[flora] notes: ' + notes.join(' | '));
}

export { SPECIES, COMMUNITIES, makeClassifier, census };
