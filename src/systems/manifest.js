// System manifest. Each entry is a lazy import of a module exporting one or more `registerXxx(world)`
// functions. A module that does not exist yet fails softly, so the island keeps running while it is
// being built.
//
// PLANNED, below, holds the modules that have been designed but not written. They live in their own
// list rather than in MANIFEST because a lazy import of a file that is not there is a 404 on the
// network panel and a red line in the console, and a build that opens with five red lines reads as
// broken to anyone who has not been told otherwise. Nothing is hidden: main.js still reports them,
// TWIN.missing still lists them, and adding a system is still one line, moved from one list to the
// other.
//
// Simulation order comes from phase + order in world.register, never from this list.

export const MANIFEST = [
  // --- the island itself. First, because every layer and system below stands on world.island:
  // the heightfield, the projection, the land cover and the named regions.
  () => import('../world/island.js'),

  // --- environment: the physical conditions everything else reads
  () => import('./environment/tide.js'),
  () => import('./environment/daylight.js'),
  () => import('./environment/weather.js'),

  // --- ecology: the living island
  () => import('./ecology/vegetation.js'),
  () => import('./ecology/koala.js'),
  () => import('./ecology/whales.js'),
  () => import('./ecology/shorebirds.js'),
  () => import('./ecology/marine.js'),
  () => import('./ecology/dunes.js'),
  () => import('./ecology/lakes.js'),

  // --- infrastructure: what keeps a place running
  () => import('./infrastructure/power.js'),
  () => import('./infrastructure/water.js'),
  () => import('./infrastructure/waste.js'),
  () => import('./infrastructure/telecoms.js'),
  () => import('./infrastructure/subterranean.js'), // the production graph below the sand
  () => import('./infrastructure/contributed.js'),  // public features an islander pinned himself

  // --- economy
  () => import('./economy/businesses.js'),
  () => import('./economy/tourism.js'),
  () => import('./economy/housing.js'),
  () => import('./economy/jobs.js'),
  () => import('./economy/prices.js'),
  () => import('./economy/chour.js'),               // the community contribution ledger

  // --- agents: residents and visitors
  () => import('./agents/events.js'),                // what is on today, from data/events.json
  () => import('./agents/population.js'),
  () => import('./agents/needs.js'),
  () => import('./agents/schedule.js'),
  () => import('./agents/social.js'),
  () => import('./agents/visitors.js'),

  // --- movement
  () => import('./movement/navigation.js'),
  () => import('./movement/traffic.js'),
  () => import('./movement/crowd.js'),
  () => import('./movement/ferry.js'),

  // --- civic
  () => import('./civic/policy.js'),
  () => import('./civic/council.js'),
  () => import('./civic/sentiment.js'),
  () => import('./civic/budget.js'),
  () => import('./civic/consultation.js'),

  // --- narrative
  () => import('./narrative/director.js'),
  () => import('./narrative/storylines.js'),
  () => import('./narrative/chronicle.js'),

  // --- render layers (each guards on world.stage and does nothing headless)
  () => import('../render/camera.js'),
  () => import('../render/layers/terrain.js'),
  () => import('../render/layers/ocean.js'),
  () => import('../render/layers/sky.js'),
  () => import('../render/layers/flora.js'),
  () => import('../render/layers/buildings.js'),
  () => import('../render/layers/roads.js'),
  () => import('../render/layers/people.js'),
  () => import('../render/layers/eventsite.js'),   // what is on, on the ground
  () => import('../render/layers/contributed.js'), // the contributed map, on the ground
  () => import('../render/layers/vehicles.js'),
  () => import('../render/layers/fauna.js'),
  () => import('../render/layers/weatherfx.js'),
  () => import('../render/layers/underground.js'),
  () => import('../render/layers/infoview.js'),
  () => import('../render/layers/selection.js'),
  () => import('../render/layers/postfx.js'),

  // --- audio
  () => import('../audio/audio.js'),

  // --- UI panels
  () => import('../ui/panels/today.js'),          // the noticeboard the island opens as
  () => import('../ui/panels/hud.js'),
  () => import('../ui/panels/notifications.js'),
  () => import('../ui/panels/infoviews.js'),
  () => import('../ui/panels/inspector.js'),
  () => import('../ui/panels/civic.js'),
  () => import('../ui/panels/build.js'),
  () => import('../ui/panels/events.js'),
  () => import('../ui/panels/subterranean.js'),
  () => import('../ui/panels/chronicle.js'),
  () => import('../ui/panels/map.js'),
  () => import('../ui/panels/onboarding.js'),
  () => import('../ui/panels/howitworks.js'),
  () => import('../ui/panels/settings.js')
];

// Designed, not written. Reported at boot so the gap is visible without pretending to load it.
// To build one: write the file, move the line up into MANIFEST.
export const PLANNED = [
  { path: './environment/fire.js', note: 'fire danger, ignition, spread and track closures' },
  { path: './environment/coast.js', note: 'erosion, accretion, the Amity problem' },
  { path: './environment/groundwater.js', note: 'the aquifer, the lakes, the borefield' },
  { path: './presentation/readmodels.js', note: 'presentation-side simulation helpers' },
  { path: '../ui/panels/ecology.js', note: 'a stewardship board beside the civic one' }
];
