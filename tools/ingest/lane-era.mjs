// The era lane. NOT BUILT, deliberately, and this file exists to say so in a place a tool can read
// rather than only in a document a person might not.
//
// What it would be. docs/DIRECTION.md item 3 describes the island scrubbing through time in both
// directions, with committed era packs holding terrain deltas, town footprints and vegetation
// masks, built offline from georeferenced historical maps and aerial photography, and any
// interpolation seeded. The flagship documented event is the 1896 to 1898 storm sequence that cut
// the Jumpinpin Channel and split Stradbroke in two.
//
// Why it is not built. This project does not have a single georeferenced historical map or aerial
// photograph in hand. docs/SOURCES.md is explicit that there is no GIS anywhere in the owner's
// corpus: no coordinates, no shapefiles, no elevation data. The island's present geometry came
// from elsewhere and a historical geometry would have to come from elsewhere too.
//
// So the only way to build this lane today would be to generate a coastline for 1896 from
// description, which would put a fabricated island underneath a real and well documented event and
// then invite a player to scrub between them as though both were the same kind of thing. Every
// rule this project has says no to that: never fabricate a place, take the pattern and leave the
// register, and the archival record of this island is incomplete and colonial in its bias so a
// historical layer that presents one authoritative past is dishonest. An honest gap beats a
// confident fabrication, and this is the gap.
//
// What would unblock it, in order:
//
// 1. Georeferenced historical mapping. Queensland's historical parish and survey plans, and the
//    aerial photography series held by the state, are the obvious first ask. Somebody has to
//    obtain them, check their licence, and georeference them. That is a research job with a real
//    cost, not an afternoon.
// 2. A decision on how uncertainty is drawn. docs/DIRECTION.md item 4 already says the honest
//    display where the record is thin is a visible contested-or-unknown marker rather than the
//    low-confidence claims underneath, and asks whether that marker needs a carve-out from the
//    no-low-confidence-to-player rule. That is the owner's call and it is not made.
// 3. The cultural gate, which is not a formality here. The recent past of this island includes
//    Myora Mission and the protection era, which involves the forebears of families living there
//    now. docs/CULTURAL-REVIEW.md B5 says a human should read Walker's thesis before any of it is
//    built, and QYAC holds the decision.
//
// When it is built, it implements the same interface as the other lanes: a function that takes
// named sources and produces candidates, and writes nothing to data/ itself.

export const EXTRACTOR = { id: 'lane-era', version: '0' };
export const BUILT = false;

export const REASON =
  'The era lane is not built. It needs georeferenced historical maps and aerial photography, which '
  + 'this project does not have. Generating a historical coastline from description would put a '
  + 'fabricated island under a real event, and an honest gap beats a confident fabrication.';

/** The interface the other lanes implement, so that calling this one fails loudly and usefully. */
export function extract() {
  throw new Error(REASON);
}

const RAN_DIRECTLY = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/ingest/lane-era.mjs');
if (RAN_DIRECTLY) {
  console.log(REASON);
  console.log('\nWhat would unblock it is in the header of tools/ingest/lane-era.mjs, and the design it '
    + 'would serve is in docs/DIRECTION.md item 3.');
  process.exit(2);
}
