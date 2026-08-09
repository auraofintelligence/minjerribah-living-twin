// System manifest. Each entry is a lazy import of a module exporting one or more `registerXxx(world)`
// functions. A module that does not exist yet fails softly, so the island keeps running while it is
// being built. Adding a system means creating the file: the line is already here.
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
  () => import('./environment/fire.js'),
  () => import('./environment/coast.js'),          // erosion, accretion, the Amity problem
  () => import('./environment/groundwater.js'),    // the aquifer, the lakes, the borefield

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

  // --- economy
  () => import('./economy/businesses.js'),
  () => import('./economy/tourism.js'),
  () => import('./economy/housing.js'),
  () => import('./economy/jobs.js'),
  () => import('./economy/prices.js'),
  () => import('./economy/chour.js'),               // the community contribution ledger

  // --- agents: residents and visitors
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

  // --- presentation-side simulation helpers
  () => import('./presentation/readmodels.js'),

  // --- render layers (each guards on world.stage and does nothing headless)
  () => import('../render/camera.js'),
  () => import('../render/layers/terrain.js'),
  () => import('../render/layers/ocean.js'),
  () => import('../render/layers/sky.js'),
  () => import('../render/layers/flora.js'),
  () => import('../render/layers/buildings.js'),
  () => import('../render/layers/roads.js'),
  () => import('../render/layers/people.js'),
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
  () => import('../ui/panels/hud.js'),
  () => import('../ui/panels/notifications.js'),
  () => import('../ui/panels/infoviews.js'),
  () => import('../ui/panels/inspector.js'),
  () => import('../ui/panels/civic.js'),
  () => import('../ui/panels/build.js'),
  () => import('../ui/panels/ecology.js'),
  () => import('../ui/panels/events.js'),
  () => import('../ui/panels/subterranean.js'),
  () => import('../ui/panels/chronicle.js'),
  () => import('../ui/panels/map.js'),
  () => import('../ui/panels/onboarding.js'),
  () => import('../ui/panels/settings.js')
];
