// Static data packs. Everything the island is made of that is not code lives in /data as JSON
// so it can be checked, corrected and sourced without touching the simulation.
// A missing pack is not fatal: the loader returns an empty pack and the systems degrade visibly.

const PACKS = [
  'geography',   // coastline, lakes, roads, elevation control points, place polygons
  'places',      // named places, beaches, lookouts, headlands, tracks
  'businesses',  // real operating businesses and organisations, with hours and roles
  'ecology',     // species, habitats, seasonal behaviour, thresholds
  'civic',       // council, QYAC, agencies, levers, real live issues
  'residents',   // household archetypes, occupations, name pools, demographics
  'transport',   // ferries, barges, buses, roads, parking, capacity
  'events',      // real recurring events and festivals
  'subterranean',// the below-sand works: layout, processes, materials
  'narrative',   // drama beats, character seeds, storyline grammar
  'soundscape',  // every voice the island can make, and where the claim it belongs here comes from
  'lore'         // acknowledgements, protocol notes, cultural guidance and its sources
];

export async function loadDataPacks() {
  const out = {};
  await Promise.all(PACKS.map(async (name) => {
    try {
      const res = await fetch(`data/${name}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status + '');
      out[name] = await res.json();
    } catch (e) {
      console.warn(`[data] pack "${name}" missing or invalid`, e.message);
      out[name] = { __missing: true, items: [] };
    }
  }));
  return out;
}
