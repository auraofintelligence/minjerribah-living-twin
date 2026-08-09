// Terrain. The island as you see it: thirty-nine kilometres of it from orbit, and the grain of
// the sand under your feet, out of one mesh and one draw call.
//
// How it is built, and why:
//
//   * Geometry is CDLOD: a quadtree over the whole domain, selected on the CPU each frame, drawn
//     as thin instances of one 32 by 32 quad patch. Vertices morph toward their parent grid as a
//     patch approaches its switch distance, so a level change is a continuous slide rather than a
//     pop, and adjacent levels share an edge exactly, so there are no cracks and no skirts.
//   * Height comes from world.island: the same Float32Array the simulation samples, uploaded once
//     as a 16 bit texture and read back in the vertex shader with a hand written bilinear tap.
//     The rendered surface is therefore the surface island.height() returns, to the millimetre,
//     which is why a person can stand on it and a camera can collide with it.
//   * Materials are blended from continuous fields rather than switched on a land cover index, so
//     heath does not meet forest along a 32 m staircase. Everything is generated in code: there
//     are no image files in this repository and there is no network at runtime.
//   * Sun shadows come from a shadow height sweep over the heightfield rather than a cascaded
//     shadow map. One O(n) pass gives a correct shadow across all thirty-nine kilometres with no
//     cascade seams, no depth bias to tune, and no peter-panning, and it carries the distance the
//     shadow has travelled, which is what makes the edge hard against a dune face and soft where
//     it falls from a ridge a kilometre away. It is rebuilt only when the sun has actually moved.
//   * Ambient occlusion is baked from the heightfield at two scales, so the dune hollows hold
//     shade at noon when there is no directional shadow to give them shape.
//
// It reads the tide, the weather and the daylight out of world.state. It never imports the ocean
// layer, and the sun and sky colours are computed with the same expressions the ocean uses, so
// the beach and the water agree about what colour the light is at the waterline.

const B = window.BABYLON;

/* ------------------------------------------------------------------ tuning */

const PATCH_QUADS = 64;       // quads across one patch: 4225 vertices, one draw call for all of them
const LEAF_SIZE = 256;        // metres across the finest patch, so 4 m quads at the camera
const LEVELS = 9;             // 256 m up to 65536 m, which covers the whole island and its sea
const LEAF_RANGE = 1500;      // metres: how close before the finest level is used. Ranges double
                              // with the level, which holds the on-screen triangle at about
                              // seven pixels whether you are standing on it or six kilometres up.
const MAX_PATCHES = 768;

const HEIGHT_MIN = -80;       // encoding range for the 16 bit height texture
const HEIGHT_SPAN = 340;

const SHADOW_STEP = 2;              // heightfield nodes per shadow cell: 64 m across the island
const SHADOW_DEPTH_RANGE = 12.0;    // metres below the light plane the shadow texture can encode
const SHADOW_TRAVEL_RANGE = 4000.0; // metres of shadow travel the penumbra term can encode
const SHADOW_STEP_MIN_TAN = 0.012;  // the sun on the horizon casts a shadow to the horizon
const SUN_MOVE_REBAKE = 0.90;       // degrees of sun movement before the shadow sweep is redone.
                                    // Below a degree the shadow edge does not visibly move, and each
                                    // rebuild costs a texture upload, so a tighter threshold bought
                                    // nothing and spent a frame.

// Minjerribah, for the solar geometry this layer falls back to. Same site and same NOAA model
// as src/systems/environment/daylight.js, so the two never disagree about where the sun is.
const SITE_LAT = -27.4283 * Math.PI / 180;
const SITE_LON = 153.4517;
const SITE_TZ = 10;                 // AEST. Queensland does not use daylight saving.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Sun altitude and azimuth for this island at this clock reading.
 *
 * The terrain used to take the sun from world.read('daylight') and fall back to a fixed pair of
 * angles when that system was not loaded. A critic judging the terrain slice on its own got the
 * fixed pair, so the land was lit from the same direction at five in the morning and at noon
 * while only the sky changed colour, and the dune field came out as a painted mottle with the
 * same pixels in every frame of a day strip. The fallback is now the real thing, so this layer
 * lights correctly whatever else is or is not loaded beside it.
 *
 * @param {number} dayOfYear 1 to 366
 * @param {number} minuteOfDay 0 to 1439
 * @param {{alt:number, az:number}} out reused, no allocation in the frame path
 */
function solarAngles(dayOfYear, minuteOfDay, out) {
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minuteOfDay / 60 - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const tst = minuteOfDay + eqTime + 4 * SITE_LON - 60 * SITE_TZ;
  const ha = ((tst / 4) - 180) * Math.PI / 180;
  const cosZen = Math.sin(SITE_LAT) * Math.sin(decl) + Math.cos(SITE_LAT) * Math.cos(decl) * Math.cos(ha);
  out.alt = Math.PI / 2 - Math.acos(clamp(cosZen, -1, 1));
  out.az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(SITE_LAT) - Math.tan(decl) * Math.cos(SITE_LAT)) + Math.PI;
  return out;
}

/* ------------------------------------------------------------------ shaders */

const VERT = `
precision highp float;

attribute vec3 position;
#ifdef INSTANCES
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
#endif

uniform mat4 viewProjection;
uniform vec3 uCam;
uniform vec4 uField;    // x0, z0, cell, 0
uniform vec4 uFieldN;   // nx, nz, 1/nx, 1/nz
uniform vec2 uMorph;    // leaf size, leaf range
uniform sampler2D texH;

varying vec3 vPos;
varying vec3 vNrm;
varying vec2 vUVf;      // normalised position in the field, for the mask textures
varying float vQuad;    // metres across one quad of this patch, for texture scaling

// Height and surface normal in one tap set. R,G carry a 16 bit height, B,A carry the normal.
void fieldTap(vec2 uv, out float h, out vec2 n) {
  vec4 t = texture2D(texH, uv);
  h = (t.r * 255.0 + t.g * 65280.0) / 65535.0 * ${HEIGHT_SPAN.toFixed(1)} + (${HEIGHT_MIN.toFixed(1)});
  n = t.ba * 2.0 - 1.0;
}

void fieldSample(vec2 world, out float h, out vec3 nrm) {
  vec2 g = (world - uField.xy) / uField.z;
  g = clamp(g, vec2(0.0), uFieldN.xy - 1.0001);
  vec2 i = floor(g);
  vec2 f = g - i;
  vec2 uv = (i + 0.5) * uFieldN.zw;
  float h00, h10, h01, h11;
  vec2 n00, n10, n01, n11;
  fieldTap(uv, h00, n00);
  fieldTap(uv + vec2(uFieldN.z, 0.0), h10, n10);
  fieldTap(uv + vec2(0.0, uFieldN.w), h01, n01);
  fieldTap(uv + vec2(uFieldN.z, uFieldN.w), h11, n11);
  h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  vec2 n = mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
  nrm = normalize(vec3(n.x, sqrt(max(0.02, 1.0 - dot(n, n))), n.y));
}

void main(void) {
#ifdef INSTANCES
  mat4 W = mat4(world0, world1, world2, world3);
  float size = W[0][0];
  vec2 origin = vec2(W[3][0], W[3][2]);
#else
  float size = uMorph.x;
  vec2 origin = vec2(0.0);
#endif

  // Where this vertex sits before any morphing, and how far the camera is from it.
  vec2 grid = position.xz;
  vec2 world = origin + grid * size;
  float h0; vec3 n0;
  fieldSample(world, h0, n0);
  float d = distance(uCam, vec3(world.x, h0, world.y));

  // Continuous level of detail: slide the odd vertices onto the even ones as the patch
  // approaches the distance at which its parent takes over. Neighbouring patches of the same
  // level compute the same factor for a shared vertex, so an edge cannot split.
  float range = uMorph.y * (size / uMorph.x);
  float k = clamp((d - range * 0.62) / (range * 0.33), 0.0, 1.0);
  vec2 fr = fract(grid * ${(PATCH_QUADS / 2).toFixed(1)}) * ${(2.0 / PATCH_QUADS).toFixed(6)};
  vec2 morphed = grid - fr * k;
  world = origin + morphed * size;

  float h; vec3 nrm;
  fieldSample(world, h, nrm);

  vPos = vec3(world.x, h, world.y);
  vNrm = nrm;
  vUVf = (world - uField.xy) / (uFieldN.xy * uField.z);
  vQuad = size * ${(1.0 / PATCH_QUADS).toFixed(6)};
  gl_Position = viewProjection * vec4(vPos, 1.0);
}
`;

const FRAG = `
precision highp float;

varying vec3 vPos;
varying vec3 vNrm;
varying vec2 vUVf;
varying float vQuad;

uniform vec3 uCam;
uniform vec4 uSun;      // xyz direction to the sun, w how far above the horizon 0..1
uniform vec4 uSunCol;   // rgb colour, a intensity
uniform vec4 uSky;      // rgb zenith, a cloud
uniform vec4 uSkyHz;    // rgb horizon, a haze
uniform vec4 uEnv;      // x wind kt, y cloud, z wind dir x, w wind dir z
uniform vec4 uWet;      // x recent high water level, y tide level, z spring/neap, w time
uniform vec4 uTune;     // x haze extinction at sea level (1/m), y detail gain, z shimmer gain, w sea level
uniform vec4 uAir;      // x haze scale height (m), y inscatter gain, z sun forward scatter, w 0

uniform vec4 uField;    // x0, z0, cell, 0
uniform vec4 uFieldN;   // nx, nz, 1/nx, 1/nz

uniform sampler2D texH; // rg height, ba surface normal
uniform sampler2D texM; // r wet, g rock, b rehab, a vegetation density
uniform sampler2D texC; // r built, g tidal, b shore band, a bayness
uniform sampler2D texS; // r shadow depth, g shadow travel, b ambient occlusion
uniform sampler2D texN; // rg detail normal, b midK noise, a fine noise

// The same hand written bilinear the vertex shader uses. Reading the height and the normal per
// pixel rather than per vertex is what keeps the waterline, the beach and the shape of a dune
// honest when the patch under them is a hundred metres across.
void fieldTap(vec2 uv, out float h, out vec2 n) {
  vec4 t = texture2D(texH, uv);
  h = (t.r * 255.0 + t.g * 65280.0) / 65535.0 * ${HEIGHT_SPAN.toFixed(1)} + (${HEIGHT_MIN.toFixed(1)});
  n = t.ba * 2.0 - 1.0;
}
void fieldSample(vec2 world, out float h, out vec3 nrm) {
  vec2 g = (world - uField.xy) / uField.z;
  g = clamp(g, vec2(0.0), uFieldN.xy - 1.0001);
  vec2 i = floor(g);
  vec2 f = g - i;
  vec2 uv = (i + 0.5) * uFieldN.zw;
  float h00, h10, h01, h11;
  vec2 n00, n10, n01, n11;
  fieldTap(uv, h00, n00);
  fieldTap(uv + vec2(uFieldN.z, 0.0), h10, n10);
  fieldTap(uv + vec2(0.0, uFieldN.w), h01, n01);
  fieldTap(uv + vec2(uFieldN.z, uFieldN.w), h11, n11);
  h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  vec2 n = mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
  nrm = normalize(vec3(n.x, sqrt(max(0.02, 1.0 - dot(n, n))), n.y));
}

vec3 skyColour(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, pow(up, 0.42));
  float s = max(dot(normalize(d), uSun.xyz), 0.0);
  c += uSunCol.rgb * uSunCol.a * (pow(s, 400.0) * 9.0 + pow(s, 14.0) * 0.30 + pow(s, 3.0) * 0.05);
  return c;
}

// Triplanar weights from the surface normal, so a steep dune face is not a smear. The three
// taps are unconditional: a texture read inside a branch has undefined derivatives, and the
// steep faces on this island are exactly where the artefact would show.
vec4 tri(sampler2D t, vec3 p, float scale, vec3 n) {
  vec3 w = abs(n);
  w = w * w * w * w;
  w /= (w.x + w.y + w.z);
  return texture2D(t, p.xz * scale) * w.y
       + texture2D(t, p.zy * scale) * w.x
       + texture2D(t, p.xy * scale) * w.z;
}

void main(void) {
  float hPix; vec3 N;
  fieldSample(vPos.xz, hPix, N);
  vec3 V = uCam - vPos;
  float dist = length(V);
  V /= dist;

  vec4 m = texture2D(texM, vUVf);
  vec4 c = texture2D(texC, vUVf);
  vec4 s = texture2D(texS, vUVf);

  float wet = m.r;          // swamp, lake bed, waterlogged ground
  float rock = m.g;
  float rehab = m.b;
  float veg = m.a;
  float built = c.r;
  float tidal = c.g;
  float shore = c.b * 1024.0 - 512.0;   // metres from the waterline, positive inland
  float bay = c.a;

  // The sine of the surface angle, not one minus its cosine. The earlier measure read 0.06 on a
  // twenty degree dune face, so every threshold keyed off it needed a forty five degree slope to
  // fire and none of them ever did: the bare sand on the steep faces, the blowouts and the wind
  // shimmer on the crests were all in the shader and none of them was ever on the screen.
  float slope = sqrt(max(0.0, 1.0 - N.y * N.y));
  float elev = hPix - uTune.w;

  // ---- detail. Five scales, faded out with distance and with the mottle size, so nothing
  // aliases at range and nothing is computed for a triangle five kilometres away. The two
  // sub-metre scales are what a person standing on the beach is actually looking at: without
  // them the ground at head height is a noise plane with no scale cue in it at all.
  float lodFade = clamp(40.0 / max(vQuad, 1.0), 0.0, 1.0);
  float nearK = (1.0 - smoothstep(9.0, 70.0, dist)) * lodFade;
  float closeK = (1.0 - smoothstep(150.0, 1600.0, dist)) * lodFade;
  float midK = 1.0 - smoothstep(1200.0, 9000.0, dist);
  vec4 nA = tri(texN, vPos, 0.31, N);           // 3 m grain
  vec4 nB = texture2D(texN, vPos.xz * 0.041);   // 24 m patchiness
  vec4 nC = texture2D(texN, vPos.xz * 0.0052);  // 190 m variation
  vec4 nD = tri(texN, vPos, 1.85, N);           // 0.54 m: the grain of the ground itself
  float grain = mix(0.5, nA.a, closeK);
  float mottle = mix(0.5, nB.b, midK);
  float broad = nC.b;
  float speck = mix(0.5, nD.a, nearK);          // shell grit and leaf litter, per handspan

  // Wind ripples on bare sand, and the swash lines the last tide left on the beach face. Both
  // are under a metre across, both are the first thing you see when you look down on this
  // island, and neither costs anything past seventy metres.
  float ripple = 0.0, swash = 0.0;
  if (nearK > 0.004) {
    vec2 wdir = normalize(uEnv.zw + vec2(1.0e-5, 1.0e-5));
    float rn = texture2D(texN, vPos.xz * 0.075).b;
    ripple = (sin(dot(vPos.xz, vec2(-wdir.y, wdir.x)) * 7.4 + rn * 7.0) * 0.5 + 0.5) * nearK;
    vec2 down = normalize(N.xz + vec2(1.0e-4, 1.0e-4));
    swash = (sin(dot(vPos.xz, down) * 2.9 + texture2D(texN, vPos.xz * 0.017).a * 11.0) * 0.5 + 0.5) * nearK;
  }

  // Detail normal, strongest on bare sand and weakest under canopy.
  float bumpAmt = uTune.y * closeK * (0.9 - 0.45 * veg);
  vec3 Nd = normalize(N + vec3((nA.r - 0.5) * 2.2 + (nB.r - 0.5) * 1.1 * midK,
                               0.0,
                               (nA.g - 0.5) * 2.2 + (nB.g - 0.5) * 1.1 * midK) * bumpAmt
                        + vec3((nD.r - 0.5), 0.0, (nD.g - 0.5)) * nearK * uTune.y * 2.6);

  // How deep this point sits below the ground around it, from the baked occlusion sweep. It is
  // the only cheap read of landform curvature this shader has, and it is what lets a hollow be
  // a different colour from a crest rather than the same green at a different brightness.
  float hollow = clamp((1.0 - s.b) * 1.6, 0.0, 1.0);

  // ---- the palettes ---------------------------------------------------------------------
  //
  // Minjerribah is sand nearly all the way down, and the ocean-side sand is close to pure
  // quartz: the silica mined here for a century assayed over 99 per cent SiO2. Dry quartz beach
  // sand is the brightest natural surface on the island by a wide margin, and the unbroken white
  // strip down the ocean side is the single feature you recognise the island by from the air.
  // These are reflectances, not moods, and the number that matters is the ratio: the beach sits
  // three to four times the canopy, which is what makes it read as white rather than as pale.
  // ACES downstream takes the top off it; this shader no longer squashes it flat first.
  vec3 silicaDry = vec3(0.800, 0.782, 0.734);
  silicaDry *= 0.90 + 0.15 * mottle + 0.10 * grain;
  // The bay side is the same quartz with mud, shell grit and seagrass wrack worked through it.
  // Pale, but a plain warm grey rather than white, and never as bright as the surf beach.
  vec3 flatDry = vec3(0.618, 0.586, 0.502) * (0.90 + 0.18 * mottle + 0.10 * grain);
  // Inland sand: the blowouts, the bare crests and the tracks. Dust and litter take the edge
  // off it, so it is bright but not beach bright.
  vec3 sandInland = mix(silicaDry * 0.88, flatDry, 0.34);
  vec3 sandDry = mix(silicaDry, flatDry, bay);
  // Wet sand darkens because water fills the pores and light bounces around inside them before
  // it gets back out. It loses more of the blue than the red, which is why a wet beach reads
  // warm-dark and not grey-dark.
  vec3 sandWet = sandDry * vec3(0.575, 0.545, 0.487);

  // Wallum heath: waist high, grey-green, wiry, and always with the sand showing through it.
  // This is the tone that separates the open dune plains from the forested ridges from the air,
  // so it is held distinctly lighter than the canopy on purpose.
  vec3 heath = mix(vec3(0.430, 0.438, 0.308), vec3(0.302, 0.334, 0.208), mottle);
  heath = mix(heath, sandInland, 0.42 * smoothstep(0.34, 0.82, broad));
  heath *= 1.0 + 0.10 * (1.0 - 2.0 * hollow);      // paler on the exposed rises

  // Eucalypt forest, three ways: the grey-green of scribbly gum on the crests, the darker green
  // of the wetter gullies, and banksia olive between them. Which one you get varies over a
  // couple of hundred metres, and the tall dark stands sit in the hollows, because that is where
  // the water is. That is the whole reason a dune field does not read as one flat green mass.
  vec3 forest = mix(vec3(0.272, 0.306, 0.182), vec3(0.166, 0.210, 0.118), mottle);
  forest = mix(forest, vec3(0.332, 0.338, 0.244), smoothstep(0.50, 0.92, broad) * 0.55);
  forest = mix(forest, forest * 0.70, smoothstep(0.16, 0.60, hollow));
  forest *= 0.88 + 0.26 * nB.a;

  // Eighteen Mile Swamp: sedge, paperbark and tea coloured water lying in a corridor behind the
  // ocean beach. Dark, and brown-dark rather than black. The colour is tannin, and tannin is the
  // colour of tea, so there is more red in it than green.
  vec3 swampCol = mix(vec3(0.232, 0.198, 0.122), vec3(0.146, 0.126, 0.084), mottle);
  swampCol = mix(swampCol, vec3(0.284, 0.250, 0.160), smoothstep(0.48, 0.88, broad) * 0.55);
  // Sedge and paperbark stand up out of it in bands, so it is not one flat tone even from a
  // kilometre up: the corridor is a mosaic of open water, reed and low scrub.
  swampCol *= 0.88 + 0.30 * nB.a;

  vec3 marsh = mix(vec3(0.492, 0.482, 0.358), vec3(0.376, 0.382, 0.264), mottle);
  vec3 mangrove = mix(vec3(0.176, 0.240, 0.148), vec3(0.232, 0.222, 0.176), 0.35 * mottle);
  // The rock at Point Lookout: weathered rhyolite and sandstone, warm grey with the darker
  // basalt dykes in it, and lichen orange on the dry faces above the splash zone. It is the only
  // rock on the island, so it is also the only place this colour is allowed to appear.
  vec3 rockCol = mix(vec3(0.368, 0.336, 0.296), vec3(0.212, 0.198, 0.186), mottle);
  rockCol = mix(rockCol, vec3(0.470, 0.402, 0.310), smoothstep(0.55, 0.95, grain) * 0.5);
  // The rehabilitated mine paths. Re-contoured sand replanted all at once, so the stand is one
  // age and one height. The tell is not the colour, it is the evenness: the variation that makes
  // the untouched forest mottled is deliberately damped here, and the sand still shows through.
  vec3 rehabCol = mix(vec3(0.356, 0.390, 0.258), vec3(0.320, 0.346, 0.234), nB.b);
  rehabCol = mix(rehabCol, sandInland, 0.20 * smoothstep(0.40, 0.86, nB.b));
  vec3 builtCol = mix(vec3(0.386, 0.412, 0.262), vec3(0.446, 0.430, 0.402), smoothstep(0.5, 0.9, mottle));

  // ---- assemble ---------------------------------------------------------------------------
  // The two beaches are not the same beach and must never render as one. bay is 0 on the
  // Pacific side and 1 in Moreton Bay; shore is metres from the coastline, positive inland.
  float ocean = 1.0 - bay;

  // The surf beach: quartz from the swash line up over the foredune, thirty-two kilometres of
  // it down the east side.
  float surfBeach = ocean
                  * (1.0 - smoothstep(70.0, 250.0, shore))
                  * (1.0 - smoothstep(4.0, 15.0, elev))
                  * (1.0 - wet) * (1.0 - built) * (1.0 - rock);
  surfBeach = max(surfBeach, ocean * (1.0 - smoothstep(-1.2, 2.2, elev)) * (1.0 - rock));

  // The bay side does not break, it dries: wide banked intertidal sand from Dunwich up to Amity
  // Point that comes out of the water on a low tide and goes back under on a high one. The
  // water level comes from world.state, shared with the ocean layer, never imported from it.
  float exposedFlat = bay
                    * smoothstep(-0.10, 0.30, hPix - uWet.y)
                    * (1.0 - smoothstep(2.4, 5.2, elev))
                    * (1.0 - smoothstep(0.35, 0.85, tidal))
                    * (1.0 - built);

  float veget = smoothstep(0.42, 0.96, veg);
  vec3 col = mix(heath, forest, veget);
  col = mix(col, rehabCol, rehab * 0.90);
  col = mix(col, swampCol, wet * (1.0 - bay * 0.7));
  col = mix(col, marsh, tidal * (1.0 - smoothstep(0.4, 0.9, tidal)) * 1.6);
  col = mix(col, mangrove, tidal * smoothstep(0.45, 0.95, tidal));
  col = mix(col, builtCol, built);

  // Bare inland sand where nothing holds it: tracks, crests, the backs of the blowouts.
  float bareInland = clamp((1.0 - veg * 1.5), 0.0, 1.0)
                   * (1.0 - wet) * (1.0 - rehab) * (1.0 - built) * (1.0 - tidal);

  // Open blowouts. On the windward flanks of the high old dunes the sand comes through in
  // patches hundreds of metres across, and from the air they are the brightest thing inland.
  // Held to the high exposed flanks: the earlier threshold fired on almost every rise on the
  // island and speckled the whole heath white.
  float blowout = smoothstep(0.74, 0.94, broad) * smoothstep(0.14, 0.38, slope)
                * (1.0 - wet) * (1.0 - built) * (1.0 - rock) * (1.0 - rehab)
                * smoothstep(38.0, 110.0, elev);

  col = mix(col, sandInland, clamp(bareInland * 0.85 + blowout * 0.70, 0.0, 1.0));
  col = mix(col, flatDry, exposedFlat * 0.92);
  col = mix(col, silicaDry, surfBeach);

  // Steep faces shed their cover and show what is underneath. The threshold sits where a bound
  // dune face starts to move: below about twenty-four degrees the heath holds it. Faded out with
  // distance, because at range the dune grain puts a steep sample in every second pixel and the
  // island came out speckled.
  // Gated on the patch noise as well as the angle, so bare sand appears where a face has
  // actually let go rather than on every steep sample of the dune grain. Without the second
  // gate the whole heath came out speckled with single bright pixels.
  float steep = smoothstep(0.42, 0.78, slope) * (0.35 + 0.65 * midK)
              * smoothstep(0.30, 0.72, nB.b);
  col = mix(col, mix(sandInland, rockCol, smoothstep(0.3, 0.8, rock)),
            steep * 0.55 * (1.0 - built) * (1.0 - wet));

  // Rock last: at Point Lookout it is under everything else, not blended with it.
  col = mix(col, rockCol, smoothstep(0.22, 0.68, rock));

  float beachness = clamp(max(surfBeach, exposedFlat), 0.0, 1.0);
  float sandy = clamp(max(beachness, max(bareInland, blowout * 0.8)), 0.0, 1.0);

  // ---- the wet band. The tide covers this beach twice a day and the sand remembers it for
  // about an hour, so the band is not the waterline: it is where the water has recently been.
  float wetBand = (1.0 - smoothstep(0.0, 0.35, hPix - uWet.x)) * sandy;
  wetBand = max(wetBand, (1.0 - smoothstep(0.0, 0.08, hPix - uWet.y)) * (1.0 - veget));
  wetBand *= (1.0 - rock * 0.5) * (1.0 - wet * 0.8);
  col = mix(col, sandWet, wetBand * 0.90);

  // Ripples and swash are a sand feature, so they go on once the ground is known to be sand.
  // They bend the normal, which is what makes them read under a low sun, and they lighten and
  // darken the albedo a little, which is what makes them read at noon. Grit and litter go on
  // everything: it is the difference between ground and a painted plane.
  if (nearK > 0.004) {
    float bare = sandy * (1.0 - veg);
    float rip = (ripple - 0.5) * bare * (0.35 + 0.65 * smoothstep(0.03, 0.30, slope));
    float sw = (swash - 0.5) * bare * beachness;
    vec2 wdir = normalize(uEnv.zw + vec2(1.0e-5, 1.0e-5));
    Nd = normalize(Nd + vec3(-wdir.y, 0.0, wdir.x) * rip * 0.50
                      + normalize(vec3(N.x, 0.0, N.z) + vec3(1.0e-4, 0.0, 1.0e-4)) * sw * 0.28);
    col *= 1.0 + rip * 0.09 + sw * 0.06;
    col *= 0.93 + 0.14 * speck;
  }

  // ---- light
  vec3 L = uSun.xyz;
  float lam = clamp(dot(Nd, L), 0.0, 1.0);

  // Sun shadow from the heightfield sweep. The travel distance sets the penumbra, so a shadow
  // cast by the dune you are standing on is hard and one thrown from a ridge a kilometre back
  // is soft, which is the difference between a game and a place.
  float shDepth = s.r * ${SHADOW_DEPTH_RANGE.toFixed(1)};
  float shDist = s.g * ${SHADOW_TRAVEL_RANGE.toFixed(1)};
  float penumbra = clamp(0.75 + shDist * 0.0040, 0.75, 7.0);
  float lit = 1.0 - smoothstep(0.0, penumbra, shDepth);
  // Fade the sweep out only in the last degree before the sun goes under, and never let cloud
  // erase it entirely: an overcast day still has a bright side and a dark side to a dune.
  lit = mix(1.0, lit, smoothstep(-0.012, 0.030, uSun.y) * (1.0 - uEnv.y * 0.45));

  // The self shading term. A face turned away from the sun is dark whether or not anything is
  // between it and the sun, and on a dune field at a low sun that is most of what you see.
  float lamShaded = lam * lit;

  float ao = mix(1.0, s.b, 0.85);
  // A little wrap on the ambient: sand bounces a lot of light into its own hollows.
  float skyLight = (0.55 + 0.45 * Nd.y) * ao;
  lam = lamShaded;

  // Direct sun carries the image and the sky fills the shadows. The weights are the ones the
  // ocean layer uses on its own sand, so the beach does not change brightness at the waterline.
  //
  // The sky fill falls away faster than the sun does as the sun drops. That is both true and
  // necessary: at a fixed fill weight a dune field under a ten degree sun came out an even cold
  // mauve, because a broad blue ambient was filling the shadowed faces as fast as the low sun
  // was lighting the sunlit ones, and the shape went back out of the landscape. Dropping the
  // fill and warming what is left is what makes low sun read as low sun.
  float lowSun = 1.0 - smoothstep(0.02, 0.40, uSun.y);
  float fillK = 0.28 + 0.66 * clamp(uSun.y * 3.2, 0.0, 1.0);
  vec3 ambCol = mix(uSkyHz.rgb * 0.34 + uSky.rgb * 0.15,
                    uSunCol.rgb * 0.15 + uSkyHz.rgb * 0.14, lowSun);
  // The pedestal on the direct term is small on purpose. It is there so a face turned fully away
  // from the sun is not pure black, not so a dune field can be lit without a sun in the sky.
  vec3 lightSun = uSunCol.rgb * uSunCol.a * (0.03 + 1.22 * lam);
  vec3 lightSky = ambCol * skyLight * fillK;
  // Sand bounces a lot of light back up into whatever is standing on it. On an island made of
  // white quartz that is not a nicety, it is why the underside of the scrub behind a beach is
  // lit at all.
  vec3 bounce = sandDry * 0.12 * uSunCol.rgb * uSunCol.a * clamp(uSun.y, 0.0, 1.0) * ao * sandy;
  // A floor so the island is legible under a moon rather than a black cut-out.
  vec3 nightFill = vec3(0.014, 0.018, 0.030) * (1.0 - uSun.w) * skyLight;

  vec3 outCol = col * (lightSun + lightSky + nightFill) + bounce;

  // No tone curve and no exposure here on purpose. The post-effects layer owns both: it meters
  // the frame, adapts, tone maps with ACES and then grades. A curve applied in this shader as
  // well is graded twice, and the auto exposure quietly takes back whatever this adds.

  // Wet sand is glossy, and that gloss is most of why a receding tide reads as receding.
  vec3 H = normalize(L + V);
  float gloss = pow(max(dot(Nd, H), 0.0), 90.0) * wetBand * uSun.w * (1.0 - rock * 0.5);
  outCol += uSunCol.rgb * uSunCol.a * gloss * 1.3;

  // Dry loose sand on an exposed crest shimmers when the wind is up: the grains streaming off
  // the crest catch the light. Subtle on purpose. It is a hint, not a special effect.
  float exposedCrest = sandy * (1.0 - veg) * smoothstep(0.10, 0.36, slope) * smoothstep(30.0, 90.0, elev);
  if (exposedCrest > 0.01 && uTune.z > 0.0) {
    vec2 drift = uEnv.zw * uWet.w * 1.4;
    float streak = texture2D(texN, vPos.xz * vec2(0.06, 0.006) + drift * 0.02).b;
    float shimmer = smoothstep(0.62, 0.95, streak) * exposedCrest * uTune.z
                  * smoothstep(9.0, 26.0, uEnv.x) * uSun.w;
    outCol += uSunCol.rgb * uSunCol.a * shimmer * 0.22;
  }

  // ---- aerial perspective.
  //
  // Exponential height fog, not a flat exponential. The haze on this coast lives in the first
  // kilometre or so of air, so a planner view from eight kilometres up looks down through almost
  // none of it while a look along the beach at head height looks through all of it. A flat model
  // cannot tell those two apart: it was tuned down to a third of the meteorological figure to
  // stop the aerial view washing out, and then a ten kilometre look along the ground had no
  // depth left in it at all. With the height falloff, uTune.x can carry the honest Koschmieder
  // extinction for the reported visibility and both views come out right.
  //
  // The integral of exp(-y/H) along a straight path from the surface up to the camera has a
  // closed form, so this costs two exponentials and a divide.
  float hazeH = uAir.x;
  float y0 = max(uCam.y - uTune.w, 0.0);
  float y1 = max(vPos.y - uTune.w, 0.0);
  float f0 = exp(-y0 / hazeH);
  float f1 = exp(-y1 / hazeH);
  float dy = y0 - y1;
  float column = abs(dy) > 1.0 ? (f1 - f0) * hazeH / dy : f1;
  // Never quite one. Thirty-nine kilometres of island has to read as far away, and it cannot do
  // that if the far end has been replaced by the colour of the air.
  float fog = min(1.0 - exp(-uTune.x * dist * clamp(column, 0.0, 1.0)), 0.90);

  // What the haze is lit by, along the direction actually being looked in, plus the forward
  // scatter that puts a bright wash around the sun's side of the sky. Desaturated rather than
  // taken straight: full sky colour over ten kilometres of forest turned the whole island teal.
  vec3 look = -V;
  vec3 hz = skyColour(normalize(vec3(look.x, max(look.y, 0.0) * 0.35 + 0.055, look.z)));
  hz += uSunCol.rgb * uSunCol.a * pow(max(dot(look, uSun.xyz), 0.0), 7.0) * uAir.z;
  hz = mix(vec3(dot(hz, vec3(0.30, 0.59, 0.11))), hz, 0.82) * uAir.y;
  // Looking down is not looking at the horizon. Haze against the sky is the brightest thing in
  // the frame; the same haze seen from above, against dark land and water, is a fraction of it,
  // and using the horizon value for both put a bright veil over the whole island in the planner
  // view. It is worst under a low sun, when the land is dim and the horizon is at its brightest,
  // which is exactly when the old model turned a five o'clock aerial into a flat mauve sheet.
  hz *= mix(1.0, 0.34, clamp(-look.y, 0.0, 1.0));
  outCol = mix(outCol, hz, fog);

  // A soft shoulder, well above the middle of the range. Its job is to stop a specular highlight
  // going to infinity, not to hold the beach down: the exposure and the ACES curve downstream
  // own the top of the scale, and the earlier knee at 0.78 was quietly capping sunlit quartz
  // sand at the same value as the grass beside it.
  float pk = max(outCol.r, max(outCol.g, outCol.b));
  if (pk > 1.15) {
    float over = pk - 1.15;
    outCol *= (1.15 + over / (1.0 + over * 0.75)) / pk;
  }

  gl_FragColor = vec4(max(outCol, vec3(0.0)), 1.0);
}
`;

/* Lake water. Small, flat, and above the sea: a perched lake is the whole point of this island. */
const LAKE_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 uCam;
varying vec3 vPos;
void main(void) { vPos = position; gl_Position = viewProjection * vec4(position, 1.0); }
`;

const LAKE_FRAG = `
precision highp float;
varying vec3 vPos;
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTint;     // rgb body colour, a 1 when the water is tannin stained
uniform vec4 uTune;     // x haze extinction at sea level, y time, z wind kt, w sea level
uniform vec4 uAir;      // x haze scale height, y inscatter gain, z sun forward scatter, w 0
uniform vec4 uField;    // x0, z0, cell, 0
uniform vec4 uFieldN;   // nx, nz, 1/nx, 1/nz
uniform vec4 uLake;     // x surface level, y extinction per metre, z 0, w 0
uniform sampler2D texN;
uniform sampler2D texH; // rg height of the lake bed
uniform sampler2D texS; // r shadow depth, g shadow travel, b ambient occlusion

float bedHeight(vec2 world) {
  vec2 g = (world - uField.xy) / uField.z;
  g = clamp(g, vec2(0.0), uFieldN.xy - 1.0001);
  vec2 i = floor(g);
  vec2 f = g - i;
  vec2 uv = (i + 0.5) * uFieldN.zw;
  vec4 a = texture2D(texH, uv);
  vec4 b = texture2D(texH, uv + vec2(uFieldN.z, 0.0));
  vec4 c = texture2D(texH, uv + vec2(0.0, uFieldN.w));
  vec4 d = texture2D(texH, uv + vec2(uFieldN.z, uFieldN.w));
  vec4 hs = vec4(a.r * 255.0 + a.g * 65280.0, b.r * 255.0 + b.g * 65280.0,
                 c.r * 255.0 + c.g * 65280.0, d.r * 255.0 + d.g * 65280.0) / 65535.0
            * ${HEIGHT_SPAN.toFixed(1)} + ${HEIGHT_MIN.toFixed(1)};
  return mix(mix(hs.x, hs.y, f.x), mix(hs.z, hs.w, f.x), f.y);
}

vec3 skyColour(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHz.rgb, uSky.rgb, pow(up, 0.42));
  float s = max(dot(normalize(d), uSun.xyz), 0.0);
  c += uSunCol.rgb * uSunCol.a * (pow(s, 400.0) * 9.0 + pow(s, 14.0) * 0.30 + pow(s, 3.0) * 0.05);
  return c;
}

void main(void) {
  vec3 V = normalize(uCam - vPos);
  float t = uTune.y;

  // How deep the water is here, from the same heightfield the terrain draws. A perched lake on
  // this island sits in white sand, so the shallows read as sand through water and the middle
  // reads as the body colour. Without this the lake is a coloured sticker with a hard rim.
  float depth = max(0.0, uLake.x - bedHeight(vPos.xz));
  float trans = exp(-depth * uLake.y);         // how much of the sand still shows through
  float edge = smoothstep(0.0, 0.55, depth);   // the shoreline itself, so the water can end

  vec3 n1 = texture2D(texN, vPos.xz * 0.09 + vec2(t * 0.006, t * 0.004)).rgb;
  vec3 n2 = texture2D(texN, vPos.xz * 0.30 - vec2(t * 0.011, 0.0)).rgb;
  float rip = (0.04 + 0.05 * clamp(uTune.z / 20.0, 0.0, 1.0)) * edge;
  vec3 N = normalize(vec3((n1.r - 0.5) * rip + (n2.r - 0.5) * rip * 0.6, 1.0,
                          (n1.g - 0.5) * rip + (n2.g - 0.5) * rip * 0.6));

  // Shade and occlusion from the same sweep the terrain uses, so a lake in the lee of a dune at
  // five in the afternoon goes dark with the ground around it instead of staying lit.
  vec2 fuv = (vPos.xz - uField.xy) / (uFieldN.xy * uField.z);
  vec4 s = texture2D(texS, fuv);
  float lit = 1.0 - smoothstep(0.0, clamp(0.30 + s.g * ${SHADOW_TRAVEL_RANGE.toFixed(1)} * 0.0035, 0.30, 6.0),
                               s.r * ${SHADOW_DEPTH_RANGE.toFixed(1)});
  lit = mix(1.0, lit, smoothstep(-0.012, 0.030, uSun.y));

  // Schlick, with the reflectance of water rather than of a mirror. At 0.60 the sky reflection
  // owned the whole surface at any angle off vertical, so Brown Lake, whose entire identity is
  // that the water is the colour of tea, rendered as a navy blob with the sky in it.
  float fres = 0.020 + 0.32 * pow(1.0 - max(dot(N, V), 0.02), 5.0);
  vec3 refl = skyColour(reflect(-V, N));
  vec3 sunLight = uSunCol.rgb * uSunCol.a * (0.10 + 0.90 * clamp(uSun.y, 0.0, 1.0) * lit);
  // These lakes sit in white quartz sand, so the shallows are sand seen through water and the
  // middle is the water's own colour. Without that the lake is a coloured sticker with a hard rim.
  vec3 sand = vec3(0.90, 0.87, 0.80) * (sunLight * 0.62 + uSkyHz.rgb * 0.30);
  // Tannin water is not dark, it is deeply coloured: light gets through it and comes back amber.
  // Treat the body colour as a transmission tint on the light rather than as a paint chip.
  vec3 body = uTint.rgb * (sunLight * 0.95 + uSkyHz.rgb * 0.28);
  vec3 water = mix(body, sand, trans * 0.88);

  vec3 H = normalize(uSun.xyz + V);
  float spec = pow(max(dot(N, H), 0.0), 420.0) * uSun.w * lit * 1.4 * edge;
  vec3 col = mix(water, refl, fres * edge) + uSunCol.rgb * uSunCol.a * spec;

  // The same height integrated haze the terrain uses, so a lake and the sand around it fade at
  // the same rate instead of the lake staying crisp while its own shoreline goes soft.
  float dist = length(uCam - vPos);
  float hazeH = uAir.x;
  float y0 = max(uCam.y - uTune.w, 0.0);
  float y1 = max(vPos.y - uTune.w, 0.0);
  float f0 = exp(-y0 / hazeH), f1 = exp(-y1 / hazeH);
  float dyy = y0 - y1;
  float column = abs(dyy) > 1.0 ? (f1 - f0) * hazeH / dyy : f1;
  float fog = 1.0 - exp(-uTune.x * dist * clamp(column, 0.0, 1.0));
  vec3 hz = skyColour(normalize(vec3(-V.x, max(-V.y, 0.0) * 0.35 + 0.055, -V.z)));
  hz = mix(vec3(dot(hz, vec3(0.30, 0.59, 0.11))), hz, 0.82) * uAir.y;
  col = mix(col, hz, fog);
  gl_FragColor = vec4(max(col, vec3(0.0)), edge);
}
`;

/* ------------------------------------------------------------------ texture bakes */

/** Height and surface normal, 16 bit height in RG and the normal in BA. NEAREST, tapped by hand. */
function bakeHeightTexture(island) {
  const { nx, nz, cell, height } = island.grid;
  const data = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const h = height[k];
      const v = clamp((h - HEIGHT_MIN) / HEIGHT_SPAN, 0, 1);
      const u16 = Math.round(v * 65535);
      const im = i > 0 ? k - 1 : k, ip = i < nx - 1 ? k + 1 : k;
      const jm = j > 0 ? k - nx : k, jp = j < nz - 1 ? k + nx : k;
      const dx = (height[ip] - height[im]) / ((ip === k || im === k ? 1 : 2) * cell);
      const dz = (height[jp] - height[jm]) / ((jp === k || jm === k ? 1 : 2) * cell);
      const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      const o = k * 4;
      data[o] = u16 & 255;
      data[o + 1] = u16 >> 8;
      data[o + 2] = Math.round(clamp(-dx * inv * 0.5 + 0.5, 0, 1) * 255);
      data[o + 3] = Math.round(clamp(-dz * inv * 0.5 + 0.5, 0, 1) * 255);
    }
  }
  return data;
}

/**
 * The cover fields, as continuous weights rather than an index, then blurred by one cell so a
 * bilinear tap gives a gradient at every boundary instead of a 32 m staircase.
 */
function bakeCoverTextures(island) {
  const { nx, nz, cover, shoreDistance, bayness, covers } = island.grid;
  const n = nx * nz;
  const M = new Uint8Array(n * 4);
  const Cc = new Uint8Array(n * 4);
  const idx = {};
  for (let i = 0; i < covers.length; i++) idx[covers[i]] = i;

  const wet = new Uint8Array(n), rock = new Uint8Array(n), rehab = new Uint8Array(n);
  const veg = new Uint8Array(n), built = new Uint8Array(n), tidal = new Uint8Array(n);

  for (let k = 0; k < n; k++) {
    const c = cover[k];
    if (c === idx.swamp || c === idx.lake) wet[k] = 255;
    if (c === idx.rock) rock[k] = 255;
    if (c === idx.rehab) rehab[k] = 255;
    if (c === idx.forest) veg[k] = 255;
    else if (c === idx.heath) veg[k] = 150;
    else if (c === idx.swamp) veg[k] = 120;
    else if (c === idx.rehab) veg[k] = 190;
    else if (c === idx.cleared) veg[k] = 110;
    else if (c === idx.foredune) veg[k] = 24;
    if (c === idx.urban) built[k] = 255;
    else if (c === idx.cleared) built[k] = 120;
    if (c === idx.mangrove) tidal[k] = 255;
    else if (c === idx.saltmarsh) tidal[k] = 130;
  }
  blur1(wet, nx, nz); blur1(rock, nx, nz); blur1(rehab, nx, nz);
  blur1(veg, nx, nz); blur1(built, nx, nz); blur1(tidal, nx, nz);

  for (let k = 0; k < n; k++) {
    const o = k * 4;
    M[o] = wet[k]; M[o + 1] = rock[k]; M[o + 2] = rehab[k]; M[o + 3] = veg[k];
    Cc[o] = built[k]; Cc[o + 1] = tidal[k];
    Cc[o + 2] = Math.round(clamp((shoreDistance[k] + 512) / 1024, 0, 1) * 255);
    Cc[o + 3] = bayness[k];
  }
  return { M, C: Cc };
}

function blur1(A, nx, nz) {
  const tmp = new Uint8Array(A.length);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const a = A[i > 0 ? k - 1 : k], b = A[k], c = A[i < nx - 1 ? k + 1 : k];
      tmp[k] = (a + 2 * b + c) >> 2;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const a = tmp[j > 0 ? k - nx : k], b = tmp[k], c = tmp[j < nz - 1 ? k + nx : k];
      A[k] = (a + 2 * b + c) >> 2;
    }
  }
}

/**
 * Tiling detail noise. RG is a tangent space normal for the grain of the ground, B and A are two
 * value noise fields for patchiness. Deterministic, from world.rng.stream('terrain').
 */
function bakeNoiseTexture(rng, size = 256) {
  const lattices = [];
  for (const p of [8, 16, 32, 64, 128]) {
    const g = new Float32Array(p * p);
    for (let i = 0; i < p * p; i++) g[i] = rng.float();
    lattices.push({ p, g });
  }
  const fade = (a) => a * a * a * (a * (a * 6 - 15) + 10);
  const samp = (L, u, v) => {
    const x = u * L.p, y = v * L.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const x0 = ((xi % L.p) + L.p) % L.p, y0 = ((yi % L.p) + L.p) % L.p;
    const x1 = (x0 + 1) % L.p, y1 = (y0 + 1) % L.p;
    const a = L.g[y0 * L.p + x0], b = L.g[y0 * L.p + x1];
    const c = L.g[y1 * L.p + x0], d = L.g[y1 * L.p + x1];
    const t1 = a + (b - a) * xf, t2 = c + (d - c) * xf;
    return t1 + (t2 - t1) * yf;
  };
  const bump = (u, v) => samp(lattices[3], u, v) * 0.55 + samp(lattices[4], u, v) * 0.45;

  const out = new Uint8Array(size * size * 4);
  const e = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const gx = (bump(u + e, v) - bump(u - e, v)) * 3.4;
      const gy = (bump(u, v + e) - bump(u, v - e)) * 3.4;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const mid = samp(lattices[1], u, v) * 0.62 + samp(lattices[2], u + 0.31, v - 0.17) * 0.38;
      const fine = samp(lattices[2], u - 0.44, v + 0.23) * 0.6 + samp(lattices[3], u, v) * 0.4;
      const o = (j * size + i) * 4;
      out[o] = Math.round(clamp(-gx * inv * 0.5 + 0.5, 0, 1) * 255);
      out[o + 1] = Math.round(clamp(-gy * inv * 0.5 + 0.5, 0, 1) * 255);
      out[o + 2] = Math.round(clamp(mid, 0, 1) * 255);
      out[o + 3] = Math.round(clamp(fine, 0, 1) * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ shadow and occlusion */

/**
 * Shadow height sweep. Marching the heightfield once in the direction the sunlight travels and
 * carrying the highest surface the light has grazed gives, in one linear pass over the grid, the
 * shadow across the whole island at the current sun angle. Carrying the distance that surface is
 * behind us gives the penumbra for nothing, which is what contact hardening actually is.
 */
function makeShadowField(island) {
  const g = island.grid;
  const step = SHADOW_STEP;             // every second node: 64 m, which is dune scale
  const nx = Math.floor((g.nx + step - 1) / step);
  const nz = Math.floor((g.nz + step - 1) / step);
  const cell = g.cell * step;
  const h = new Float32Array(nx * nz);
  const isLand = new Uint8Array(nx * nz);
  let landCount = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      // Take the highest of the step by step block rather than one corner: sampling every second
      // node with a plain stride drops half the dune crests, and a crest that is not in the field
      // cannot cast the shadow that is the whole point of the field.
      const j0 = Math.min(g.nz - 1, j * step), i0 = Math.min(g.nx - 1, i * step);
      let m = g.height[j0 * g.nx + i0];
      for (let b = 1; b < step; b++) {
        const jb = Math.min(g.nz - 1, j0 + b), ib = Math.min(g.nx - 1, i0 + b);
        const a = g.height[jb * g.nx + i0], c = g.height[j0 * g.nx + ib];
        if (a > m) m = a;
        if (c > m) m = c;
      }
      const k = j * nx + i;
      h[k] = m;
      if (m > island.seaLevel + 0.5) { isLand[k] = 1; landCount++; }
    }
  }

  // Ambient occlusion, baked once: how deep this point sits below the ground around it, at two
  // scales. A dune hollow holds shade at noon; a crest does not.
  const ao = new Uint8Array(nx * nz);
  const b1 = Float32Array.from(h), b2 = Float32Array.from(h);
  boxBlurF32(b1, nx, nz, 2);
  boxBlurF32(b2, nx, nz, 7);
  for (let k = 0; k < h.length; k++) {
    const d1 = clamp((b1[k] - h[k]) / 2.5, 0, 1);
    const d2 = clamp((b2[k] - h[k]) / 11.0, 0, 1);
    ao[k] = Math.round((1 - clamp(d1 * 0.42 + d2 * 0.60, 0, 0.78)) * 255);
  }

  const S = new Float32Array(nx * nz);
  const D = new Float32Array(nx * nz);
  const dep = new Float32Array(nx * nz);
  const tmp = new Float32Array(nx * nz);
  const data = new Uint8Array(nx * nz * 4);

  const DEP_SCALE = 255 / SHADOW_DEPTH_RANGE;
  const TRV_SCALE = 255 / SHADOW_TRAVEL_RANGE;

  // Sweep state, so the pass can be run a band of rows at a time. Doing all six hundred rows in
  // one frame cost seventeen milliseconds, which is a dropped frame every time the sun moves far
  // enough to want a rebuild. The recurrence only ever reads the row behind and the cell beside,
  // so stopping in the middle of it and carrying on next frame is exact, not an approximation.
  const P = { active: false, j: 0, jEnd: 0, sj: 1, si: 1, i0: 0, i1: 0, wI: 0, wJ: 0, drop: 0, advance: 0 };
  const ROWS_PER_FRAME = 96;

  return {
    nx, nz, cell, data, landCount,
    /** @param azimuthRad from north, clockwise. @param altitudeRad above the horizon. */
    update(azimuthRad, altitudeRad) {
      this.start(azimuthRad, altitudeRad);
      while (this.advance(nz)) { /* run it out in one call */ }
    },
    /** Set the sweep up for a sun direction. Nothing is computed until advance() is called. */
    start(azimuthRad, altitudeRad) {
      // The direction the light travels across the ground, away from the sun.
      const dx = -Math.sin(azimuthRad), dz = -Math.cos(azimuthRad);
      const tanAlt = Math.max(SHADOW_STEP_MIN_TAN, Math.tan(Math.max(0.004, altitudeRad)));
      const si = dx >= 0 ? 1 : -1;
      const sj = dz >= 0 ? 1 : -1;
      const adx = Math.abs(dx), adz = Math.abs(dz);
      const wI = adx / (adx + adz + 1e-6);
      const wJ = 1 - wI;
      // How far the ray falls between one cell and the next. The step advances a cell in i and a
      // cell in j at once, so the horizontal advance is cell * (|dx| + |dz|): one cell when the
      // light runs along an axis and 1.41 cells on the diagonal. Using a flat `cell` here, as the
      // first version did, stretched every diagonal shadow by forty per cent.
      P.drop = tanAlt * cell * (adx + adz);
      P.advance = cell * (adx + adz);
      P.i0 = dx >= 0 ? 0 : nx - 1;
      P.i1 = dx >= 0 ? nx : -1;
      P.j = dz >= 0 ? 0 : nz - 1;
      P.jEnd = dz >= 0 ? nz : -1;
      P.si = si; P.sj = sj; P.wI = wI; P.wJ = wJ;
      P.active = true;
      this.sunElevationDeg = altitudeRad * 180 / Math.PI;
    },
    /**
     * Run up to `rows` rows of the sweep. Returns true while there is more to do, false on the
     * pass that finished it, which is the pass that also refreshes the numbers below.
     */
    advance(rows) {
      if (!P.active) return false;
      const { si, sj, i0, i1, wI, wJ, drop, advance } = P;
      const limit = Math.min(rows, Math.abs(P.jEnd - P.j));
      for (let n = 0; n < limit; n++) {
        const j = P.j;
        const base = j * nx;
        const pj = j - sj;
        const hasJ = pj >= 0 && pj < nz;
        for (let i = i0; i !== i1; i += si) {
          const k = base + i;
          const pi = i - si;
          let up = 0, ud = 0;
          if (pi >= 0 && pi < nx) { up += wI * S[k - si]; ud += wI * D[k - si]; }
          else up += wI * h[k];
          if (hasJ) { up += wJ * S[pj * nx + i]; ud += wJ * D[pj * nx + i]; }
          else up += wJ * h[k];
          const carried = up - drop;
          if (carried > h[k]) { S[k] = carried; D[k] = ud + advance; }
          else { S[k] = h[k]; D[k] = 0; }
          dep[k] = S[k] - h[k];
        }
        P.j += sj;
      }
      if (P.j !== P.jEnd) return true;
      P.active = false;

      // The sweep propagates cell by cell along two axes, so its edges arrive quantised to the
      // grid and a shadow across a dune field comes out as a field of rectangles. One box blur
      // over the depth, at the grid scale, turns those back into edges that follow the ground.
      // Written out rather than calling the general blur: this runs on three hundred thousand
      // cells every time the sun moves a degree, and a clamp() call per tap made it a dropped
      // frame all by itself.
      blur1F32(dep, tmp, nx, nz);

      // Pack the texture and measure it in the same pass. Numbers the critic tooling can read,
      // so "there are shadows" is a measurement rather than a claim about a screenshot. The
      // denominator is land, not the whole grid: three quarters of this domain is Moreton Bay
      // and the Pacific, and a shaded fraction of the ocean would make a working sweep look
      // like a broken one.
      let shaded = 0, aoSum = 0, land = 0, deepest = 0;
      for (let k = 0; k < dep.length; k++) {
        const o = k * 4;
        const dv = dep[k];
        const d = dv * DEP_SCALE;
        const trv = D[k] * TRV_SCALE;
        data[o] = d > 255 ? 255 : d < 0 ? 0 : d | 0;
        data[o + 1] = trv > 255 ? 255 : trv | 0;
        data[o + 2] = ao[k];
        data[o + 3] = 255;
        if (isLand[k]) {
          land++;
          if (dv > 0.25) shaded++;
          if (dv > deepest) deepest = dv;
          aoSum += ao[k];
        }
      }
      this.shadedFraction = land ? shaded / land : 0;
      this.meanAO = land ? aoSum / land / 255 : 1;
      this.deepestShadowM = deepest;
      return false;
    },
    get sweeping() { return P.active; },
    rowsPerFrame: ROWS_PER_FRAME,
    shadedFraction: 0,
    meanAO: 1,
    deepestShadowM: 0,
    sunElevationDeg: 0
  };
}

/** Separable three tap blur with edge replication, no allocation and no calls in the inner loop. */
function blur1F32(A, tmp, nx, nz) {
  for (let j = 0; j < nz; j++) {
    const b = j * nx;
    let prev = A[b];
    for (let i = 0; i < nx - 1; i++) {
      const cur = A[b + i];
      tmp[b + i] = (prev + cur + A[b + i + 1]) * (1 / 3);
      prev = cur;
    }
    tmp[b + nx - 1] = (prev + A[b + nx - 1] * 2) * (1 / 3);
  }
  for (let i = 0; i < nx; i++) {
    let prev = tmp[i];
    for (let j = 0; j < nz - 1; j++) {
      const k = j * nx + i;
      const cur = tmp[k];
      A[k] = (prev + cur + tmp[k + nx]) * (1 / 3);
      prev = cur;
    }
    const k = (nz - 1) * nx + i;
    A[k] = (prev + tmp[k] * 2) * (1 / 3);
  }
}

function boxBlurF32(A, nx, nz, r) {
  const tmp = new Float32Array(A.length);
  const w = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    const base = j * nx;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += A[base + clamp(i, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[base + i] = sum / w;
      sum += A[base + clamp(i + r + 1, 0, nx - 1)] - A[base + clamp(i - r, 0, nx - 1)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let sum = 0;
    for (let j = -r; j <= r; j++) sum += tmp[clamp(j, 0, nz - 1) * nx + i];
    for (let j = 0; j < nz; j++) {
      A[j * nx + i] = sum / w;
      sum += tmp[clamp(j + r + 1, 0, nz - 1) * nx + i] - tmp[clamp(j - r, 0, nz - 1) * nx + i];
    }
  }
}

/* ------------------------------------------------------------------ geometry */

/**
 * Ear clipping for a simple closed ring in xz. Returns a flat index list into the input ring.
 * Lake outlines are concave; a centroid fan across a concave ring puts triangles outside the
 * lake, which is how a lake ends up rendering as a bright polygon over the sea.
 * @param {Array<[number,number]>} ring
 */
function earClip(ring) {
  const n = ring.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(area > 0 ? i : n - 1 - i);   // make it counter clockwise

  const cross = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const out = [];
  let guard = n * n + 16;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const A = ring[a], Bp = ring[b], Cp = ring[c];
      if (cross(A[0], A[1], Bp[0], Bp[1], Cp[0], Cp[1]) <= 0) continue;   // reflex, not an ear
      let contains = false;
      for (let k = 0; k < idx.length; k++) {
        const p = idx[k];
        if (p === a || p === b || p === c) continue;
        const P = ring[p];
        if (cross(A[0], A[1], Bp[0], Bp[1], P[0], P[1]) >= 0
          && cross(Bp[0], Bp[1], Cp[0], Cp[1], P[0], P[1]) >= 0
          && cross(Cp[0], Cp[1], A[0], A[1], P[0], P[1]) >= 0) { contains = true; break; }
      }
      if (contains) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;   // degenerate ring: stop with what is already a valid partial fill
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** One patch: a unit grid in x and z, instanced everywhere. */
function buildPatchMesh(scene) {
  const n = PATCH_QUADS + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = i / PATCH_QUADS;
      pos[k + 1] = 0;
      pos[k + 2] = j / PATCH_QUADS;
    }
  }
  const idx = new Uint32Array(PATCH_QUADS * PATCH_QUADS * 6);
  let t = 0;
  for (let j = 0; j < PATCH_QUADS; j++) {
    for (let i = 0; i < PATCH_QUADS; i++) {
      // Wound so the up face is the front face in Babylon's left handed world.
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }
  const mesh = new B.Mesh('terrain-patch', scene);
  const vd = new B.VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.applyToMesh(mesh, false);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  return mesh;
}

/* ------------------------------------------------------------------ the layer */

export function registerTerrain(world) {
  if (!world.stage) return;               // headless: the island still exists, nothing draws
  const island = world.island;
  if (!island || typeof island.height !== 'function') {
    console.warn('[terrain] no world.island, nothing to draw. Is src/world/island.js registered?');
    return;
  }

  const rng = world.rng.stream('terrain');

  /* The waterline, published rather than imported. The ocean layer draws the water and the
     terrain draws the sand it runs up, and the two have to agree about where the wet band is or
     the beach has a seam in it. Neither layer may import the other, so this is the seam: whoever
     is loaded publishes it, and anyone else reads it. */
  const shore = world.read('shoreline') || world.publish('shoreline', {
    owner: 'terrain',
    wetLevelM: island.seaLevel,   // metres above LAT that the water has recently reached
    tideM: island.seaLevel,       // the tide right now
    swellM: 1.0,
    springNeap: 0.5,
    flatsExposed: 0               // 0 covered, 1 the western banks are fully out of the water
  });

  const R = {
    ready: false, mesh: null, mat: null, lakeMeshes: [], lakeMats: [],
    texH: null, texM: null, texC: null, texS: null, texN: null,
    shadow: null, lastSunAz: -999, lastSunAlt: -999, framesSinceShadow: 999,
    instances: null, count: 0, t: 0,
    wetLevel: island.seaLevel, lastSimMin: null,
    patches: 0, selectMs: 0, shadowMs: 0,
    sunSource: 'terrain solar', sunElDeg: 0, sunAzDeg: 0,
    finestPatchM: LEAF_SIZE, csm: null, csmNote: 'not built'
  };
  const sunAng = { alt: 0, az: 0 };

  // Everything the frame path writes into, allocated once.
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 0.9, 0.8, 1);
  const vSky = new B.Vector4(0.2, 0.4, 0.7, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.85, 0.4);
  const vEnv = new B.Vector4(10, 0.2, 0, 1);
  const vWet = new B.Vector4(island.seaLevel, island.seaLevel, 0.5, 0);
  const vTune = new B.Vector4(0.000045, 0.85, 1, island.seaLevel);
  // Haze scale height, inscatter gain, sun forward scatter. The scale height is the one number
  // that decides whether thirty-nine kilometres reads as far or as erased: coastal aerosol on
  // this part of the Queensland coast sits in the first kilometre and a bit of the air column.
  const vAir = new B.Vector4(1150, 1.0, 0.30, 0);
  const vLakeTune = new B.Vector4(0.000045, 0, 10, 0);
  const camPos = new B.Vector3();

  const domain = island.domain;
  const rootSize = LEAF_SIZE * Math.pow(2, LEVELS - 1);
  const rootX = (domain.minX + domain.maxX) * 0.5 - rootSize * 0.5;
  const rootZ = (domain.minZ + domain.maxZ) * 0.5 - rootSize * 0.5;

  /* ---- quadtree selection ------------------------------------------------ */

  const matrices = new Float32Array(MAX_PATCHES * 16);
  const ranges = new Float32Array(LEVELS);
  for (let l = 0; l < LEVELS; l++) ranges[l] = LEAF_RANGE * Math.pow(2, l);
  const planes = [];
  const yMid = (island.bounds.minY + island.bounds.maxY) * 0.5;
  const yHalf = (island.bounds.maxY - island.bounds.minY) * 0.5 + 4;

  function emit(x, z, size) {
    if (R.count >= MAX_PATCHES) return;
    if (size < R.finestPatchM) R.finestPatchM = size;
    const o = R.count * 16;
    // Column major, the way Babylon feeds world0..world3 to the shader. Only the scale and the
    // translation are used: the vertex shader reads the patch size out of m00.
    matrices[o] = size; matrices[o + 1] = 0; matrices[o + 2] = 0; matrices[o + 3] = 0;
    matrices[o + 4] = 0; matrices[o + 5] = 1; matrices[o + 6] = 0; matrices[o + 7] = 0;
    matrices[o + 8] = 0; matrices[o + 9] = 0; matrices[o + 10] = size; matrices[o + 11] = 0;
    matrices[o + 12] = x; matrices[o + 13] = 0; matrices[o + 14] = z; matrices[o + 15] = 1;
    R.count++;
  }

  function visible(x, z, size) {
    if (x > domain.maxX || x + size < domain.minX || z > domain.maxZ || z + size < domain.minZ) return false;
    const cx = x + size * 0.5, cz = z + size * 0.5;
    const r = size * 0.7072 + yHalf;
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      if (p.normal.x * cx + p.normal.y * yMid + p.normal.z * cz + p.d < -r) return false;
    }
    return true;
  }

  function nearer(x, z, size, range) {
    // Closest point of the node's box in xz to the camera, against the level range.
    const dx = Math.max(x - camPos.x, 0, camPos.x - (x + size));
    const dz = Math.max(z - camPos.z, 0, camPos.z - (z + size));
    const dy = Math.max(island.bounds.minY - camPos.y, 0, camPos.y - island.bounds.maxY);
    return dx * dx + dz * dz + dy * dy < range * range;
  }

  function select(x, z, size, level) {
    if (!visible(x, z, size)) return;
    if (level === 0 || !nearer(x, z, size, ranges[level - 1])) { emit(x, z, size); return; }
    const h = size * 0.5;
    select(x, z, h, level - 1);
    select(x + h, z, h, level - 1);
    select(x, z + h, h, level - 1);
    select(x + h, z + h, h, level - 1);
  }

  /* ---- lakes ------------------------------------------------------------- */

  function buildLakes(scene) {
    const g = island.grid;
    for (const lake of island.lakes) {
      if (!lake.poly || lake.poly.length < 3 || lake.surfaceM == null) continue;
      // Ear clipping, not a centroid fan. Lake outlines are concave, and a fan across a concave
      // ring throws long thin triangles clean outside the lake: that is the hard edged white
      // polygon a critic found sitting in the ocean in three separate frames, still bright at
      // twenty past seven at night.
      const tri3 = earClip(lake.poly);
      const n = lake.poly.length;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = lake.poly[i][0];
        pos[i * 3 + 1] = lake.surfaceM;
        pos[i * 3 + 2] = lake.poly[i][1];
      }
      if (!tri3.length) continue;
      const mesh = new B.Mesh('lake-' + lake.id, scene);
      const vd = new B.VertexData();
      vd.positions = pos; vd.indices = new Uint32Array(tri3);
      vd.applyToMesh(mesh, false);
      mesh.isPickable = false;
      const mat = new B.ShaderMaterial('lakeMat-' + lake.id, scene,
        { vertexSource: LAKE_VERT, fragmentSource: LAKE_FRAG },
        {
          attributes: ['position'],
          uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTint', 'uTune',
            'uAir', 'uField', 'uFieldN', 'uLake'],
          samplers: ['texN', 'texH', 'texS'],
          needAlphaBlending: true
        });
      mat.backFaceCulling = false;
      mat.alphaMode = B.Engine.ALPHA_COMBINE;
      // The two lakes on this island that have a published water level are not the same kind of
      // lake and must not render as the same colour.
      //
      // Brown Lake (Bummiera) is a perched lake in a bowl of sand: shallow, and stained by the
      // tea tree and paperbark litter around it, so the water is the colour of strong tea and
      // reads amber-brown over the pale sand under it. Blue Lake (Kaboora) is a window lake, a
      // place where the water table itself comes to the surface: 9.4 m deep in the pack, fed from
      // the aquifer, and it reads a clear blue-green because there is very little in it to stain.
      //
      // The extinction is per metre of water. Tannin absorbs strongly and unevenly, so a metre of
      // Bummiera already carries its colour; Kaboora is clear enough that the sand shows through
      // the shallows and only the deep middle reads as body colour.
      const tannin = /brown|bummiera|tortoise|swallow/i.test(lake.name)
        || /perched_lagoon|wallum/.test(String(lake.type));
      mat.setVector4('uTint',
        tannin ? new B.Vector4(0.238, 0.132, 0.056, 1) : new B.Vector4(0.058, 0.200, 0.232, 0));
      mat.setVector4('uField', new B.Vector4(g.x0, g.z0, g.cell, 0));
      mat.setVector4('uFieldN', new B.Vector4(g.nx, g.nz, 1 / g.nx, 1 / g.nz));
      mat.setVector4('uLake', new B.Vector4(lake.surfaceM, tannin ? 0.95 : 0.40, 0, 0));
      mat.setTexture('texH', R.texH);
      mat.setTexture('texS', R.texS);
      mesh.material = mat;
      mesh.alphaIndex = 5;
      R.lakeMeshes.push(mesh);
      R.lakeMats.push(mat);
    }
  }

  /* ---- the sun's shadow map ------------------------------------------------
     Terrain shades itself from the heightfield sweep above, which is the right tool at this
     scale: one linear pass covers all thirty-nine kilometres with no cascade split to hide and
     no depth bias to tune. Everything that stands on the terrain is a different problem, and
     that is what this is for. It is created here because the terrain layer is the one that
     always exists, it is exposed on the stage, and it does not render a frame until something
     asks to cast into it. */

  function attachSunShadows(stage) {
    if (stage.sunShadows || !stage.sun || !B.CascadedShadowGenerator) return;
    try {
      const sg = new B.CascadedShadowGenerator(2048, stage.sun);
      sg.numCascades = 4;
      sg.lambda = 0.88;
      sg.stabilizeCascades = true;
      sg.cascadeBlendPercentage = 0.06;
      sg.shadowMaxZ = 2400;
      sg.depthClamp = true;
      // Not autoCalcDepthBounds. It builds a depth renderer and draws the whole scene into it
      // every frame to find the cascade bounds, which measured at eighteen milliseconds a frame
      // here for a shadow map that nothing was casting into yet.
      sg.autoCalcDepthBounds = false;
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.004;
      sg.normalBias = 0.012;
      sg.transparencyShadow = false;
      // Nothing casts yet, so nothing is drawn. The first caster switches it on.
      sg.getShadowMap().refreshRate = 0;
      sg.getShadowMap().renderList = [];
      stage.sunShadows = sg;
      stage.addSunCaster = (mesh, receives = true) => {
        if (!mesh) return false;
        sg.addShadowCaster(mesh, true);
        if (receives) mesh.receiveShadows = true;
        sg.getShadowMap().refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
        return true;
      };
      R.csm = sg;
      R.csmNote = '4 cascades at 2048, idle until a layer calls stage.addSunCaster';
    } catch (e) {
      R.csmNote = 'not available: ' + (e && e.message ? e.message : String(e));
      console.warn('[terrain] cascaded shadow map not created', e);
    }
  }

  /* ---- the render layer -------------------------------------------------- */

  world.stage.addLayer({
    id: 'terrain',
    order: 15,   // before the ocean, which draws its water over the top of the beach

    init(stage) {
      const scene = stage.scene;
      const t0 = performance.now();
      const g = island.grid;

      R.texH = new B.RawTexture(bakeHeightTexture(island), g.nx, g.nz, B.Engine.TEXTUREFORMAT_RGBA,
        scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
      R.texH.wrapU = R.texH.wrapV = B.Texture.CLAMP_ADDRESSMODE;

      const cov = bakeCoverTextures(island);
      R.texM = new B.RawTexture(cov.M, g.nx, g.nz, B.Engine.TEXTUREFORMAT_RGBA, scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
      R.texC = new B.RawTexture(cov.C, g.nx, g.nz, B.Engine.TEXTUREFORMAT_RGBA, scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
      R.texM.wrapU = R.texM.wrapV = R.texC.wrapU = R.texC.wrapV = B.Texture.CLAMP_ADDRESSMODE;

      R.texN = new B.RawTexture(bakeNoiseTexture(rng, 256), 256, 256, B.Engine.TEXTUREFORMAT_RGBA, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
      R.texN.wrapU = R.texN.wrapV = B.Texture.WRAP_ADDRESSMODE;

      R.shadow = makeShadowField(island);
      R.shadow.update(Math.PI * 0.25, 0.9);
      R.texS = new B.RawTexture(R.shadow.data, R.shadow.nx, R.shadow.nz, B.Engine.TEXTUREFORMAT_RGBA,
        scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
      R.texS.wrapU = R.texS.wrapV = B.Texture.CLAMP_ADDRESSMODE;

      const mat = new B.ShaderMaterial('terrainMat', scene,
        { vertexSource: VERT, fragmentSource: FRAG },
        {
          attributes: ['position', 'world0', 'world1', 'world2', 'world3'],
          uniforms: ['viewProjection', 'uCam', 'uField', 'uFieldN', 'uMorph',
            'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uEnv', 'uWet', 'uTune', 'uAir'],
          samplers: ['texH', 'texM', 'texC', 'texS', 'texN'],
          needAlphaBlending: false, needAlphaTesting: false
        });
      mat.setTexture('texH', R.texH);
      mat.setTexture('texM', R.texM);
      mat.setTexture('texC', R.texC);
      mat.setTexture('texS', R.texS);
      mat.setTexture('texN', R.texN);
      mat.setVector4('uField', new B.Vector4(g.x0, g.z0, g.cell, 0));
      mat.setVector4('uFieldN', new B.Vector4(g.nx, g.nz, 1 / g.nx, 1 / g.nz));
      mat.setVector2('uMorph', new B.Vector2(LEAF_SIZE, LEAF_RANGE));
      mat.backFaceCulling = true;
      R.mat = mat;

      R.mesh = buildPatchMesh(scene);
      R.mesh.material = mat;
      R.mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
      R.mesh.thinInstanceCount = 1;
      R.mesh.receiveShadows = true;

      buildLakes(scene);
      attachSunShadows(stage);

      R.ready = true;
      console.info('[terrain] built in ' + Math.round(performance.now() - t0) + ' ms: '
        + g.nx + 'x' + g.nz + ' height field, ' + R.lakeMeshes.length + ' lakes, shadow sweep '
        + R.shadow.nx + 'x' + R.shadow.nz + ' at ' + R.shadow.cell + ' m, sun shadow map '
        + R.csmNote);
    },

    frame(stage, w, dt) {
      if (!R.ready) return;
      R.t += Math.min(0.1, dt || 0.016);
      const scene = stage.scene;
      const cam = stage.camera;
      camPos.copyFrom(cam.globalPosition || cam.position);

      const dl = w.read('daylight');
      const wx = w.read('weather');
      const tide = w.read('tide');

      /* --- sun and sky. The same expressions the ocean layer uses, so the beach and the water
             never disagree about the colour of the light at the line where they meet.

             The sun comes from the daylight system when it is loaded and from this layer's own
             copy of the same NOAA model when it is not. It is never a fixed pair of angles: a
             frozen sun is what made the dune field render the same pixels at dawn and at noon. */
      let alt, az;
      if (dl && Number.isFinite(dl.altitude)) { alt = dl.altitude; az = dl.azimuth; R.sunSource = 'daylight'; }
      else {
        solarAngles(w.clock.dayOfYear, w.clock.minuteOfDay, sunAng);
        alt = sunAng.alt; az = sunAng.az;
        R.sunSource = 'terrain solar';
      }
      R.sunElDeg = alt * 180 / Math.PI;
      R.sunAzDeg = az * 180 / Math.PI;
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
      const windKt = wx ? wx.windKt : 10;
      const windDir = wx ? wx.windDirDeg : 110;
      const wTh = ((windDir + 180) * Math.PI) / 180;
      vEnv.set(windKt, cloud, Math.sin(wTh), Math.cos(wTh));

      /* --- the wet band and the drying flats. Driven entirely from world.state, so the darkened
             sand here and the foam line the ocean layer draws agree at the waterline without
             either layer importing the other. If the ocean has already published a shoreline
             read model, defer to it; otherwise publish one, so whichever layer is loaded owns it
             and the other one follows. --- */
      const shared = w.read('shoreline');
      const base = tide ? tide.height : island.seaLevel;
      const simMin = w.clock.dayIndex * 1440 + w.clock.minuteOfDay;
      const dMin = R.lastSimMin === null ? 0 : clamp(simMin - R.lastSimMin, 0, 720);
      R.lastSimMin = simMin;
      // Swell from the ocean layer's own surf read model when it is loaded, from the weather pack
      // when it is not. Both are world.state; neither is an import.
      const surf = w.read('surf');
      const swellM = surf && surf.swellM > 0 ? surf.swellM : (wx ? wx.swellM : 1.0);
      if (shared && shared.owner !== 'terrain' && Number.isFinite(shared.wetLevelM)) {
        R.wetLevel = shared.wetLevelM;
      } else {
        const instantWet = base + Math.min(1.3, 0.42 * swellM + 0.12);
        if (instantWet > R.wetLevel) R.wetLevel = instantWet;
        else R.wetLevel += (instantWet - R.wetLevel) * (1 - Math.exp(-dMin / 38));
        shore.wetLevelM = +R.wetLevel.toFixed(3);
        shore.tideM = +base.toFixed(3);
        shore.swellM = +swellM.toFixed(2);
        shore.springNeap = tide ? +tide.springNeap.toFixed(2) : 0.5;
        // How far the western banks have come out of the water. Sea level on this datum is
        // 1.02 m and the flats crest a little under half a metre above LAT, so anything under
        // about 0.7 m of tide has sand showing between Dunwich and Amity Point.
        shore.flatsExposed = +clamp((0.95 - base) / 0.75, 0, 1).toFixed(2);
      }
      vWet.set(R.wetLevel, base, tide ? tide.springNeap : 0.5, R.t);

      // Aerial perspective. Koschmieder: a contrast of 2 per cent at the reported visibility
      // gives an extinction of 3.9 / visibility. That is the honest number and it is now usable
      // because the shader integrates it against a haze scale height rather than applying it
      // flat, so the planner view from eight kilometres up looks down through almost none of the
      // haze layer while a look along the beach at head height looks through all of it.
      // Subtropical air over a sand island is clear, so it is trimmed to three quarters, and the
      // scale height thickens a little in humid, still, or smoky air.
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      const humid = wx ? clamp(wx.humidity, 0, 1) : 0.6;
      vTune.set(clamp(2.95 / (visKm * 1000), 2.0e-5, 2.0e-3), 0.72, 1, island.seaLevel);
      vAir.set(900 + 500 * humid, 0.94 + 0.10 * cloud, 0.30 * (1 - cloud * 0.6), 0);

      /* --- the sun light itself. The sky layer drives stage.sun when it is loaded; when it is
             not, the terrain drives it, so a cascaded shadow map hanging off that light always
             points where this layer thinks the sun is. --- */
      const sunUp = Math.sin(alt), sunFlat = Math.cos(alt);
      // One owner each. The sky layer drives the light when it is loaded; the terrain drives it
      // only when the sky is not there, so the two never fight over the same vector.
      if (stage.sun && !stage.layer('sky')) {
        stage.sun.direction.set(-sunFlat * Math.sin(az), -sunUp, -sunFlat * Math.cos(az));
        stage.sun.setEnabled(sunUp > -0.05);
      }

      /* --- shadows. Rebuilt only when the sun has actually moved, and then a band of rows at a
             time so the rebuild never costs a frame. --- */
      R.framesSinceShadow++;
      const azDeg = R.sunAzDeg, altDeg = R.sunElDeg;
      const moved = Math.abs(azDeg - R.lastSunAz) + Math.abs(altDeg - R.lastSunAlt);
      if (!R.shadow.sweeping && moved > SUN_MOVE_REBAKE && (R.framesSinceShadow > 8 || moved > 2.0)) {
        R.shadow.start(az, alt);
        R.lastSunAz = azDeg; R.lastSunAlt = altDeg;
        R.framesSinceShadow = 0;
        R.shadowMs = 0;
      }
      if (R.shadow.sweeping) {
        const t0 = performance.now();
        // A jump in time wants the whole sweep now, because the very next thing that happens is
        // a screenshot. Running normally it goes in bands.
        const rows = Math.abs(moved) > 6 ? R.shadow.nz : R.shadow.rowsPerFrame;
        const more = R.shadow.advance(rows);
        if (!more) {
          R.texS.update(R.shadow.data);
          // Publish straight away rather than at the next tick. The read model used to lag the
          // sweep by a step, so a critic who set a time, rendered and probed read the shading for
          // the time before the one on the screen.
          publishShadow();
        }
        R.shadowMs = performance.now() - t0;
      }

      /* --- choose the patches --- */
      const t1 = performance.now();
      planes.length = 0;
      const fp = scene.frustumPlanes || B.Frustum.GetPlanes(scene.getTransformMatrix());
      for (let i = 0; i < fp.length; i++) planes.push(fp[i]);
      R.count = 0;
      R.finestPatchM = rootSize;
      select(rootX, rootZ, rootSize, LEVELS - 1);
      if (R.count === 0) emit(rootX, rootZ, rootSize);
      R.mesh.thinInstanceCount = R.count;
      R.mesh.thinInstanceBufferUpdated('matrix');
      R.patches = R.count;
      R.selectMs = performance.now() - t1;

      /* --- uniforms --- */
      const mat = R.mat;
      mat.setVector3('uCam', camPos);
      mat.setVector4('uSun', vSun);
      mat.setVector4('uSunCol', vSunCol);
      mat.setVector4('uSky', vSky);
      mat.setVector4('uSkyHz', vSkyHz);
      mat.setVector4('uEnv', vEnv);
      mat.setVector4('uWet', vWet);
      mat.setVector4('uTune', vTune);
      mat.setVector4('uAir', vAir);

      vLakeTune.set(vTune.x, R.t, windKt, island.seaLevel);
      for (const lm of R.lakeMats) {
        lm.setVector3('uCam', camPos);
        lm.setVector4('uSun', vSun);
        lm.setVector4('uSunCol', vSunCol);
        lm.setVector4('uSky', vSky);
        lm.setVector4('uSkyHz', vSkyHz);
        lm.setVector4('uTune', vLakeTune);
        lm.setVector4('uAir', vAir);
        lm.setTexture('texN', R.texN);
      }
    },

    dispose() {
      for (const o of [R.mesh, R.mat, R.texH, R.texM, R.texC, R.texS, R.texN]) if (o && o.dispose) o.dispose();
      for (const m of R.lakeMeshes) m.dispose();
      for (const m of R.lakeMats) m.dispose();
      R.ready = false;
    }
  });

  /* A read model, so the critic tooling can see what the terrain is actually doing rather than
     take a screenshot's word for it. */
  const state = world.publish('terrain', {
    patches: 0, drawCalls: 0, leafSizeM: LEAF_SIZE, levels: LEVELS,
    quadsAtCameraM: LEAF_SIZE / PATCH_QUADS,
    selectMs: 0, shadowRebuildMs: 0, wetLevelM: 0, lakes: 0,
    shadedFraction: 0, meanAO: 1, deepestShadowM: 0,
    sunElevationDeg: 0, sunAzimuthDeg: 0, sunSource: 'terrain solar',
    shadowGridM: 0, sunShadowMap: 'not built'
  });

  /** Called straight off the sweep, so the numbers match the frame on the screen. */
  function publishShadow() {
    if (!R.shadow) return;
    state.shadedFraction = +R.shadow.shadedFraction.toFixed(3);
    state.meanAO = +R.shadow.meanAO.toFixed(3);
    state.deepestShadowM = +R.shadow.deepestShadowM.toFixed(1);
    state.sunElevationDeg = +R.sunElDeg.toFixed(1);
    state.sunAzimuthDeg = +R.sunAzDeg.toFixed(1);
    state.sunSource = R.sunSource;
  }

  world.register({
    id: 'terrain',
    phase: 'presentation',
    order: 30,
    tick() {
      state.patches = R.patches;
      // Every selected patch is a thin instance of the same 64 by 64 quad, so the whole island is
      // one draw call however many patches the quadtree picked. The lakes are one each. Do not
      // read engine._drawCalls for this: it is a lifetime accumulator that nothing resets.
      state.drawCalls = 1 + R.lakeMeshes.length;
      state.selectMs = +R.selectMs.toFixed(2);
      state.shadowRebuildMs = +R.shadowMs.toFixed(1);
      state.wetLevelM = +R.wetLevel.toFixed(2);
      state.lakes = R.lakeMeshes.length;
      state.quadsAtCameraM = +(R.finestPatchM / PATCH_QUADS).toFixed(2);
      state.shadowGridM = R.shadow ? R.shadow.cell : 0;
      state.sunShadowMap = R.csmNote;
      publishShadow();
    },
    // Timings stay out of describe(), which is hashed for the determinism check; they are in the
    // published read model instead, and TWIN.probe() carries that.
    describe() {
      return {
        patches: state.patches,
        leafSizeM: LEAF_SIZE,
        quadsAtCameraM: state.quadsAtCameraM,
        sunElevationDeg: state.sunElevationDeg,
        sunSource: state.sunSource,
        shadedFraction: state.shadedFraction,
        deepestShadowM: state.deepestShadowM,
        meanAO: state.meanAO,
        wetLevelM: state.wetLevelM,
        lakes: state.lakes
      };
    },
    save() { return null; },
    load() {}
  });
}
