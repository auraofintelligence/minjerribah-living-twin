// Coordinates, re-checked against the map after the pack is committed.
//
// WHY THIS EXISTS
//   Every lane that reads a coordinate bounds-checks it at ingest. tools/ingest/lane-map.mjs checks
//   all 139 placemarks against the island's bounding box and reports what falls outside rather than
//   dropping it, and its report says "0 fell outside the island". That is a true statement about one
//   afternoon in August and it is not a property of the repository.
//
//   A critic proved the gap in one move: leave a record's envelope fields alone and move it to
//   Trafalgar Square, then run `node tools/ingest/registry.mjs --refresh`, which runs the gate over
//   the pack content before it will write. The gate passed. A pin in central London was a clean pack,
//   because the only thing standing between a hand edit and the registry was a checksum, and a
//   refresh is exactly the operation that legitimately replaces the checksum.
//
//   So this is the ingest check moved to where it belongs: over what is on disk, every run, whoever
//   wrote it and however long ago.
//
// THE TWO BOXES
//   Not one. The twin models the mainland end of the crossing, and Cleveland's Toondah Harbour is
//   real, sourced and 11 km off the island. A single island-sized box would fail three true records
//   and be switched off inside a week.
//
//     the region   Moreton Bay and its shores. Everything, in every pack, blocking.
//     the island   Minjerribah itself. Contribution packs only, blocking, because those come from
//                  somebody's map of this island and a pin outside it is a pin somebody dragged.
//
// WHAT IT WILL NOT DO
//   Guess. It reports a probable lat/lon transposition when the numbers fit that shape, because that
//   is the one failure this project is most likely to have and the one a reader most needs named.
//   It never corrects anything: a lane writes records and a gate refuses them.

import { readJSON, exists, walkRecords } from './lib.mjs';

/**
 * Moreton Bay and its shores: Bribie Island in the north to the Gold Coast Broadwater in the south,
 * Ipswich in the west to twenty kilometres off Point Lookout in the east. Every coordinate this
 * project has any business holding is inside this, including the two mainland ferry terminals, the
 * Brisbane hospitals a patient is flown to and Toondah Harbour.
 */
export const REGION_BOUNDS = { minLat: -28.30, maxLat: -26.80, minLon: 152.60, maxLon: 153.75 };

/** Minjerribah, generously drawn. The same box tools/ingest/lane-map.mjs checks at ingest. */
export const ISLAND_BOUNDS = { minLat: -27.75, maxLat: -27.35, minLon: 153.35, maxLon: 153.55 };

/** Lanes whose records are somebody's map of this island, so the island box applies to them. */
const ISLAND_LANES = new Set(['map']);

const inBox = (b, lat, lon) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;

/** The pairs of key names that mean a position. Checked in this order; the first pair present wins. */
const PAIRS = [['lat', 'lon'], ['lat', 'lng'], ['latitude', 'longitude']];

function positionOf(record) {
  for (const [a, b] of PAIRS) {
    const lat = record[a];
    const lon = record[b];
    if (lat === null || lon === null || lat === undefined || lon === undefined) continue;
    if (typeof lat !== 'number' || typeof lon !== 'number') return { bad: true, keys: [a, b] };
    return { lat, lon, keys: [a, b] };
  }
  return null;
}

export function runCoordinateChecks(ctx) {
  const { findings, registry } = ctx;
  const packs = (registry && registry.packs) || [];
  let checked = 0;
  let packsSeen = 0;

  for (const entry of packs) {
    const file = entry.file || `data/${entry.id}.json`;
    if (!exists(file)) continue;
    let doc;
    try { doc = readJSON(file); } catch { continue; }
    packsSeen++;
    const islandOnly = ISLAND_LANES.has(entry.lane);

    for (const { record, pointer } of walkRecords(doc, '', '')) {
      const p = positionOf(record);
      if (!p) continue;
      if (p.bad) {
        findings.add({
          check: 'coordinates', severity: 'blocking', file, locator: pointer, id: record.id,
          message: `${pointer} carries ${p.keys.join(' and ')} that are not numbers.`,
          hint: 'A position is two numbers or it is absent. A string here is a position nothing can use '
            + 'and everything will try to.'
        });
        continue;
      }
      checked++;

      // The one mistake this project is built to make: KML is lon,lat and everything here is lat,lon.
      const swapped = !inBox(REGION_BOUNDS, p.lat, p.lon) && inBox(REGION_BOUNDS, p.lon, p.lat);

      if (!inBox(REGION_BOUNDS, p.lat, p.lon)) {
        findings.add({
          check: 'coordinates', severity: 'blocking', file, locator: pointer, id: record.id,
          message: `${pointer} is at ${p.lat}, ${p.lon}, which is outside Moreton Bay and its shores `
            + `(lat ${REGION_BOUNDS.minLat} to ${REGION_BOUNDS.maxLat}, lon ${REGION_BOUNDS.minLon} to ${REGION_BOUNDS.maxLon}).`
            + (swapped ? ' Reading the two the other way round puts it back inside, so this is a lat and lon transposition.' : ''),
          hint: swapped
            ? 'Every conversion from a lon,lat source goes through toLatLon in tools/ingest/kml.mjs, '
              + 'which is the one place in this project that turns one order into the other. Nothing else may.'
            : 'A record this project holds is somewhere around Moreton Bay. If this position is right, '
              + 'the box in tools/ingest/checks-geo.mjs is what needs the argument, not the record.'
        });
        continue;
      }

      if (islandOnly && !inBox(ISLAND_BOUNDS, p.lat, p.lon)) {
        findings.add({
          check: 'coordinates', severity: 'blocking', file, locator: pointer, id: record.id,
          message: `${pointer} came through the ${entry.lane} lane, which reads somebody's map of `
            + `Minjerribah, and it is at ${p.lat}, ${p.lon}: off the island `
            + `(lat ${ISLAND_BOUNDS.minLat} to ${ISLAND_BOUNDS.maxLat}, lon ${ISLAND_BOUNDS.minLon} to ${ISLAND_BOUNDS.maxLon}).`,
          hint: 'The lane reports a placemark outside the island rather than dropping it, and it does '
            + 'not carry one into a pack. A record here that is off the island was edited after ingest.'
        });
      }
    }
  }

  findings.ran('coordinates', `${checked} positions in ${packsSeen} packs, against Moreton Bay and, `
    + 'for contributed maps, against the island');
}
