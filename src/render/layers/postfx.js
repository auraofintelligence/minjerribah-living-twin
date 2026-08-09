// Post effects: the image layer. This is the last thing that touches the frame, and it is most of
// the difference between "a browser build" and "a photograph of a place".
//
// The chain, in order, assembled from one function so the ordering can never drift:
//
//   scene -> SSAO2 -> motion blur -> auto exposure -> DefaultRenderingPipeline (bloom, DoF, ACES,
//         FXAA) -> twin grade -> TAA -> twin film (vignette, chromatic, grain, sharpen) -> screen
//
// Four things here are not Babylon boilerplate, and they are the reason this looks the way it does.
//
// 1. Exposure adapts on the GPU. Two tiny passes run every frame: the previous frame's linear HDR
//    image is reduced to a 16x9 grid of log luminance, then to a single texel that also carries the
//    adapted exposure forward from the frame before it. A full screen multiply applies that texel
//    before tone mapping. Nothing is ever read back to the CPU, so it costs nothing on the timeline
//    and it cannot stall the pipeline. Adaptation is deliberately asymmetric: bright to dark takes
//    about two and a half seconds, dark to bright about half a second, which is the way an eye
//    behaves. Walk from open sand into the shade and the image opens up.
// 2. Exposure is applied before the pipeline rather than after it, so the bloom threshold means what
//    it says: a thing blooms when it would read as blown out on screen, at midday and at midnight.
// 3. The colour grade is one pass. The four looks are blended as numbers on the CPU rather than as
//    branches in the shader, so a cross fade between Bright day and Golden costs nothing extra.
// 4. Every pass can be measured. TWIN.postfx.bench() rebuilds the chain one pass at a time and
//    times each increment with GPU timer queries, so the cost table is measured rather than guessed.
//
// No island facts are asserted anywhere in this file. When it runs on its own (?only=postfx) it
// builds a calibration scene: a test chart in the shape of a beach edge, not a model of any
// particular place on Minjerribah.

import { makeNoise2D } from '../../kernel/rng.js';

const B = window.BABYLON;

// ---------------------------------------------------------------------------
// The looks. Four grades, cross faded by sun elevation and cloud.
// Values are deliberately small. A grade that announces itself is a filter, not a grade.
//
// `key` is the middle grey the auto exposure aims the scene at, so it also carries how bright
// each time of day is meant to feel relative to the others. Night sits about two stops under
// midday from the key alone, and the night gain takes it another stop down.
// ---------------------------------------------------------------------------

const GRADES = {
  day: {
    label: 'Bright day',
    // Subtropical light at 27 degrees south: hard sun, and a very blue sky filling the shadows.
    // The separation between a warm key and a cold fill is the whole look.
    gain: [1.020, 1.008, 0.998],
    lift: [-0.001, 0.000, 0.003],
    gamma: [1.000, 1.000, 0.992],
    shadowTint: [-0.006, 0.002, 0.018],
    highTint: [0.014, 0.006, -0.006],
    tone: [1.00, 1.00, 0.34, 0.00],     // shadow amount, highlight amount, bleach, purkinje
    look: [1.07, 0.18, 1.13, 0.000],    // saturation, vibrance, contrast, black lift
    place: [0.38, 0.55],                // bay push, sand warmth
    // Middle grey for the meter to aim at. Raised from 0.115: at that key the planner view of
    // the island metered a frame that is mostly Moreton Bay and put the land a stop and a half
    // under, and the beaches never got near the top of the scale. The whole point of Minjerribah
    // from the air is that the ocean beach is the brightest thing in the frame.
    key: 0.200,
    bloom: { threshold: 1.05, weight: 0.20, kernelScale: 1.00 },
    grain: 0.000, vignette: 0.000
  },
  golden: {
    label: 'Golden',
    gain: [1.100, 1.000, 0.902],
    lift: [0.006, 0.002, 0.005],
    gamma: [0.994, 1.000, 1.010],
    shadowTint: [-0.005, 0.000, 0.022],
    highTint: [0.032, 0.014, -0.012],
    tone: [1.10, 1.20, 0.18, 0.00],
    look: [1.10, 0.24, 1.05, 0.004],
    place: [0.22, 0.75],
    key: 0.165,
    bloom: { threshold: 0.88, weight: 0.32, kernelScale: 1.25 },
    grain: 0.000, vignette: 0.000
  },
  overcast: {
    label: 'Overcast',
    gain: [0.985, 1.000, 1.022],
    lift: [0.006, 0.007, 0.010],
    gamma: [1.006, 1.000, 0.996],
    shadowTint: [0.004, 0.006, 0.009],
    highTint: [-0.005, 0.000, 0.007],
    tone: [0.90, 0.80, 0.12, 0.00],
    look: [0.90, 0.28, 0.94, 0.010],
    place: [0.46, 0.20],
    key: 0.170,
    bloom: { threshold: 1.20, weight: 0.13, kernelScale: 0.85 },
    grain: 0.000, vignette: 0.000
  },
  night: {
    label: 'Night',
    gain: [0.480, 0.550, 0.680],
    lift: [0.000, 0.001, 0.004],
    gamma: [1.020, 1.000, 0.985],
    shadowTint: [-0.004, 0.000, 0.010],
    highTint: [0.022, 0.012, -0.008],
    tone: [1.00, 1.30, 0.05, 0.62],
    look: [0.60, 0.10, 1.12, 0.002],
    place: [0.10, 0.00],
    key: 0.040,
    bloom: { threshold: 0.70, weight: 0.42, kernelScale: 1.35 },
    grain: 0.055, vignette: 0.055
  }
};

const GRADE_IDS = ['day', 'golden', 'overcast', 'night'];

// ---------------------------------------------------------------------------
// Quality tiers. Low is the contract: 60 fps on integrated graphics at 1080p.
// It keeps tone mapping, auto exposure, the grade and FXAA, because those are the identity of
// the image and they are close to free. Everything with a per pixel gather is off.
// ---------------------------------------------------------------------------

const TIERS = {
  low: {
    label: 'Low', scale: 1.30, msaa: 1,
    bloom: true, bloomKernel: 20, bloomScale: 0.35,
    ssao: false, dof: false, taa: false, film: false, fxaa: true,
    sharpen: 0.00, pickEvery: 0
  },
  medium: {
    label: 'Medium', scale: 1.10, msaa: 1,
    bloom: true, bloomKernel: 32, bloomScale: 0.5,
    ssao: true, ssaoSamples: 8, ssaoRatio: 0.5, ssaoBlur: false,
    dof: false, taa: false, film: true, fxaa: true,
    sharpen: 0.00, pickEvery: 0
  },
  high: {
    label: 'High', scale: 1.00, msaa: 1,
    bloom: true, bloomKernel: 40, bloomScale: 0.5,
    ssao: true, ssaoSamples: 16, ssaoRatio: 0.66, ssaoBlur: false,
    dof: true, dofBlur: 1, taa: true, taaSamples: 8, film: true, fxaa: true,
    sharpen: 0.16, pickEvery: 6
  },
  ultra: {
    label: 'Ultra', scale: 1.00, msaa: 2,
    bloom: true, bloomKernel: 56, bloomScale: 0.5,
    ssao: true, ssaoSamples: 32, ssaoRatio: 1.0, ssaoBlur: true,
    dof: true, dofBlur: 2, taa: true, taaSamples: 16, film: true, fxaa: true,
    sharpen: 0.22, pickEvery: 4
  }
};

const TIER_IDS = ['low', 'medium', 'high', 'ultra'];

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const GRADE_UNIFORMS = ['uLift', 'uGamma', 'uGain', 'uShadowTint', 'uHighTint', 'uTone', 'uLook', 'uPlace'];
const FILM_UNIFORMS = ['uTexel', 'uFilm', 'uSeed'];
const EXPOSURE_UNIFORMS = ['uExposure', 'uLimit'];

// The exposure the meter is allowed to reach, as a plain multiplier on the linear scene.
// It used to run 0.004 to 400, which is thirty-four stops, far more range than any frame this
// world produces and enough that a single bad measurement put a white sheet on the screen.
// Midday on white sand meters around 0.5 and a moonlit beach around 0.004, so a floor of 0.03
// and a ceiling of 24 covers everything the island can render with room either side.
const EXPOSURE_MIN = 0.03;
const EXPOSURE_MAX = 24.0;

const METER_W = 16, METER_H = 9;

function installShaders() {
  if (B.Effect.ShadersStore.twinGradeFragmentShader) return;

  // --- auto exposure: reduce, adapt, apply ---------------------------------

  // R carries the log luminance. G carries coverage: the fraction of the taps that found any
  // light at all. Coverage is the difference between "this frame is dark" and "there is no
  // frame here yet", and telling those two apart is what stops the exposure running away.
  B.Effect.ShadersStore.twinMeterDownFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uSpan;
void main(void) {
  float s = 0.0;
  float cov = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture2D(textureSampler, vUV + vec2(float(x), float(y)) * uSpan).rgb;
      float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
      s += log(l + 1e-4);
      cov += step(1.0e-6, l);
    }
  }
  gl_FragColor = vec4(s / 9.0, cov / 9.0, 0.0, 1.0);
}`;

  B.Effect.ShadersStore.twinMeterAdaptFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D prevSampler;
uniform vec4 uAdapt;   // key, k down, k up, snap (1 = lock straight onto the target)
uniform vec2 uLimit;   // hard safety clamp on exposure
void main(void) {
  float wsum = 0.0;
  float lsum = 0.0;
  float csum = 0.0;
  for (int y = 0; y < ${METER_H}; y++) {
    for (int x = 0; x < ${METER_W}; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(${METER_W}.0, ${METER_H}.0);
      // Centre weighted metering, tilted a little below the horizon line, because the sky is
      // not the subject. This is why a bright sky does not close the whole image down. The
      // pedestal is small: at 0.20 the weighting was nearly flat, so from the planner camera
      // the corners of Moreton Bay set the exposure and the island in the middle of the frame
      // went two stops under.
      vec2 d = (uv - vec2(0.5, 0.56)) * vec2(1.0, 1.30);
      float w = exp(-dot(d, d) * 3.4) + 0.09;
      vec2 t = texture2D(textureSampler, uv).rg;
      lsum += t.r * w;
      csum += t.g * w;
      wsum += w;
    }
  }
  float coverage = csum / max(wsum, 1e-5);
  float measured = exp(lsum / max(wsum, 1e-5));
  float prev = texture2D(prevSampler, vec2(0.5)).r;
  if (!(prev > 0.0)) prev = 0.0;

  // A frame that is not there yet cannot be metered. Every resize of the drawing buffer, every
  // quality-tier change and every chain rebuild reallocates the render target the meter reads,
  // and for one frame every texel in it is zero. The log average then collapses onto its own
  // epsilon, the target pins at the ceiling, and the frame after that is a white sheet. That is
  // the whole 8:30am failure. Coverage tells a black frame from an absent one: hold, do not
  // chase, and the next real frame picks up exactly where this one left off.
  if (coverage < 0.5) {
    gl_FragColor = vec4(prev > 0.0 ? prev : uLimit.x, measured, prev, 1.0);
    return;
  }

  float target = clamp(uAdapt.x / max(measured, 1e-5), uLimit.x, uLimit.y);
  float next = target;
  if (prev > 0.0 && uAdapt.w < 0.5) {
    float k = target < prev ? uAdapt.y : uAdapt.z;
    next = prev + (target - prev) * k;
  }
  gl_FragColor = vec4(next, measured, target, 1.0);
}`;

  B.Effect.ShadersStore.twinExposureFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D expSampler;
uniform vec2 uExposure;  // frozen value or negative for automatic, then the compensation gain
uniform vec2 uLimit;     // the same clamp the meter works to, applied again at the point of use
void main(void) {
  float e = uExposure.x >= 0.0 ? uExposure.x : texture2D(expSampler, vec2(0.5, 0.5)).r;
  if (!(e > 0.0)) e = 1.0;   // never let a cold or broken meter black the screen out
  e = clamp(e, uLimit.x, uLimit.y);
  gl_FragColor = vec4(texture2D(textureSampler, vUV).rgb * e * uExposure.y, 1.0);
}`;

  // --- the grade -----------------------------------------------------------

  B.Effect.ShadersStore.twinGradeFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform vec4 uTone;   // shadow amount, highlight amount, bleach, purkinje
uniform vec4 uLook;   // saturation, vibrance, contrast, black lift
uniform vec3 uPlace;  // bay push, sand warmth, overall strength

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 SCOT = vec3(0.06, 0.44, 0.50);

void main(void) {
  vec3 src = texture2D(textureSampler, vUV).rgb;
  vec3 lin = pow(max(src, vec3(0.0)), vec3(2.2));
  vec3 c = lin;

  // The colourist's three way: gain scales, lift raises the floor, gamma bends the middle.
  c = c * uGain;
  c = c + uLift * (1.0 - clamp(c, 0.0, 1.0));
  c = pow(max(c, vec3(1e-5)), uGamma);

  // Power contrast about a mid grey pivot. It never clips, unlike a straight lerp.
  c = 0.18 * pow(max(c, vec3(1e-5)) / 0.18, vec3(uLook.z));

  float l = dot(c, LUMA);

  // Split tone: cool skylight into the shadows, warm sun into the highlights. Applied as a
  // proportion of what is already there, not as a flat offset. As an offset a blue of 0.018 is
  // nothing on a sunlit beach and is most of the pixel on anything genuinely dark, which is how
  // the tea-dark water of Eighteen Mile Swamp came out navy at midday and why every low-key
  // frame in the day strip read as blue rather than as dark.
  float sMask = 1.0 - smoothstep(0.0, 0.30, l);
  float hMask = smoothstep(0.30, 0.90, l);
  c *= vec3(1.0) + (uShadowTint * sMask * uTone.x + uHighTint * hMask * uTone.y) * (1.0 / 0.18);
  c = max(c, vec3(0.0));

  l = dot(c, LUMA);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float chroma = mx - mn;

  // Water: cyan leaning pixels get nudged toward green, which is what shallow water over pale
  // sand reads as. Deep channel blue sits elsewhere in chroma and is barely touched.
  float bay = smoothstep(0.02, 0.30, (c.g + c.b) * 0.5 - c.r) * smoothstep(0.01, 0.10, chroma);
  c.g += bay * uPlace.x * 0.10 * l;
  c.r -= bay * uPlace.x * 0.05 * l;

  // Bright, nearly colourless surfaces go warm white rather than cream: bleached silica sand.
  float sand = smoothstep(0.45, 0.92, l) * (1.0 - smoothstep(0.04, 0.22, chroma));
  c = mix(c, vec3(l) * vec3(1.030, 1.000, 0.955), sand * uPlace.y);

  // Film loses colour before it loses light.
  c = mix(c, vec3(l), smoothstep(0.55, 1.05, l) * uTone.z);

  // Saturation with vibrance: lift the quiet colours, leave the loud ones alone.
  float vib = 1.0 + uLook.y * (1.0 - smoothstep(0.0, 0.55, chroma));
  l = dot(c, LUMA);
  c = mix(vec3(l), c, max(0.0, uLook.x * vib));

  // Purkinje shift. In low light the rods take over: reds go dark and everything leans blue
  // green. Only the dark part of the frame shifts, so a lit window keeps its colour.
  float scot = dot(max(c, vec3(0.0)), SCOT);
  float dark = 1.0 - smoothstep(0.004, 0.16, l);
  c = mix(c, vec3(scot) * vec3(0.68, 0.94, 1.30), dark * uTone.w);

  c += uLook.w;

  c = mix(lin, c, uPlace.z);
  gl_FragColor = vec4(pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}`;

  // --- the film pass -------------------------------------------------------

  B.Effect.ShadersStore.twinFilmFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uTexel;
uniform vec4 uFilm;  // vignette, chromatic, grain, sharpen
uniform vec2 uSeed;  // frame seed, grain cell size

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main(void) {
  vec2 uv = vUV;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec3 c;

  if (uFilm.y > 0.0001) {
    // Lateral chromatic aberration only: radial, quadratic, zero in the centre. Like a lens.
    vec2 off = d * r2 * uFilm.y * 0.055;
    c.r = texture2D(textureSampler, uv + off).r;
    c.g = texture2D(textureSampler, uv).g;
    c.b = texture2D(textureSampler, uv - off).b;
  } else {
    c = texture2D(textureSampler, uv).rgb;
  }

  if (uFilm.w > 0.0001) {
    // Unsharp mask. Temporal accumulation is soft by construction; this puts the edge back.
    vec3 blur = texture2D(textureSampler, uv + vec2(uTexel.x, 0.0)).rgb
              + texture2D(textureSampler, uv - vec2(uTexel.x, 0.0)).rgb
              + texture2D(textureSampler, uv + vec2(0.0, uTexel.y)).rgb
              + texture2D(textureSampler, uv - vec2(0.0, uTexel.y)).rgb;
    c = c + (c * 4.0 - blur) * (uFilm.w * 0.25);
  }

  if (uFilm.x > 0.0001) {
    c *= 1.0 - uFilm.x * smoothstep(0.10, 0.62, r2);
  }

  if (uFilm.z > 0.0001) {
    float g = hash13(vec3(floor(uv / max(uSeed.y, 1e-5)), uSeed.x)) - 0.5;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Grain lives in the mids and the low tones, the way it does on real stock.
    float shape = (0.35 + 0.90 * (1.0 - smoothstep(0.0, 0.50, lum))) * (0.35 + 0.65 * smoothstep(0.0, 0.05, lum));
    c += g * uFilm.z * shape;
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
}

// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------

export function registerPostFx(world) {
  // The read model. Published whether or not there is a renderer, so a headless probe still
  // says what the image layer would be doing.
  const state = world.publish('postfx', {
    available: false,
    tier: 'high',
    tierLabel: 'High',
    auto: true,
    ceiling: 'ultra',
    mode: 'planner',           // planner | photo | cinematic
    scaling: 1,
    renderScale: 1,
    exposure: { adapted: 0, measuredLuma: 0, target: 0, frozen: false, ev: 0, readAgeFrames: -1, source: 'gpu' },
    keyTarget: 0.115,
    grade: { dominant: 'day', label: 'Bright day', mix: { day: 1, golden: 0, overcast: 0, night: 0 }, strength: 1 },
    sunElevationDeg: 0,
    cloud: 0,
    focus: { metres: 0, targetMetres: 0, fStop: 11, focalLengthMm: 55, hit: null },
    passes: {
      ssao: false, exposure: false, bloom: false, dof: false, motionBlur: false,
      fxaa: false, taa: false, grade: false, film: false, msaa: 1
    },
    film: { vignette: 0, chromatic: 0, grain: 0, sharpen: 0 },
    cost: {
      method: 'not measured yet',
      gpuTimerSupported: false,
      frameMs: 0,
      gpuMs: 0,
      baselineMs: 0,
      estimateMs: 0,
      readbackMs: 0,
      // Draw calls in the frame just rendered, measured as the difference across one frame.
      // The contract's budget is 900. Do not read engine._drawCalls directly: it never resets.
      drawCalls: 0,
      drawCallsPeak: 0,
      passes: null
    },
    fps: 0,
    notes: []
  });

  const pending = { tier: null, mode: null };

  // The simulation side citizen: no Babylon, runs headless, gives probe() a describe().
  world.register({
    id: 'postfx',
    phase: 'presentation',
    order: 90,
    describe() {
      return {
        available: state.available,
        tier: state.tier,
        auto: state.auto,
        mode: state.mode,
        sunElevationDeg: +state.sunElevationDeg.toFixed(1),
        grade: state.grade.dominant,
        gradeMix: {
          day: +state.grade.mix.day.toFixed(2),
          golden: +state.grade.mix.golden.toFixed(2),
          overcast: +state.grade.mix.overcast.toFixed(2),
          night: +state.grade.mix.night.toFixed(2)
        },
        keyTarget: +state.keyTarget.toFixed(3),
        exposure: +state.exposure.adapted.toFixed(4),
        measuredLuma: +state.exposure.measuredLuma.toFixed(4),
        focusM: +state.focus.metres.toFixed(1),
        passes: state.passes,
        costMs: +state.cost.estimateMs.toFixed(2),
        drawCalls: state.cost.drawCalls,
        fps: +state.fps.toFixed(0)
      };
    },
    save() { return { tier: state.tier, auto: state.auto, mode: state.mode, ev: state.exposure.ev }; },
    load(w, s) {
      if (!s) return;
      if (s.tier) pending.tier = s.tier;
      if (typeof s.auto === 'boolean') state.auto = s.auto;
      if (s.mode) pending.mode = s.mode;
    }
  });

  // Intents. A settings panel drives the tier; a camera drives the mode.
  world.bus.on('ui:intent', (p) => {
    if (!p) return;
    if (p.kind === 'quality') {
      if (p.tier === 'auto') { state.auto = true; state.ceiling = 'ultra'; }
      else if (TIERS[p.tier]) { state.auto = false; state.ceiling = p.tier; api.setTier(p.tier); }
    } else if (p.kind === 'photo') {
      api.setMode(p.on === false ? 'planner' : 'photo');
    } else if (p.kind === 'cinematic') {
      api.setMode(p.on === false ? 'planner' : 'cinematic');
    } else if (p.kind === 'postfx') {
      api.set(p.set || p);
    }
  });
  world.bus.on('camera:mode', (p) => { if (p && p.mode) api.setMode(p.mode); });

  const stage = world.stage;
  if (!stage) {
    state.notes.push('headless: no renderer, image layer inert');
    return null;
  }

  installShaders();

  // ---- live objects -------------------------------------------------------
  let scene = null, engine = null, camera = null;
  let ssao = null, motionBlur = null, exposurePass = null, drp = null;
  let gradePass = null, taa = null, filmPass = null;
  let effectRenderer = null, downWrapper = null, adaptWrapper = null;
  let meterDown = null, adaptRT = [null, null], adaptIndex = 0, meterReady = false;
  let baseScaling = 1, frameNo = 0, built = false, needsRebuild = false;
  let demo = null, lastKernelKey = '';
  let current = null;   // the option set the chain was assembled from

  const rng = world.rng.stream('postfx');
  const grainSeed = Math.floor(rng.float() * 4096);

  // Blended grade parameters, allocated once and mutated in place.
  const g = {
    gain: [1, 1, 1], lift: [0, 0, 0], gamma: [1, 1, 1],
    shadowTint: [0, 0, 0], highTint: [0, 0, 0],
    tone: [0, 0, 0, 0], look: [1, 0, 1, 0], place: [0, 0],
    key: 0.200, bloomThreshold: 1, bloomWeight: 0.2, grain: 0, vignette: 0
  };
  const mix = { day: 1, golden: 0, overcast: 0, night: 0 };
  const mixTarget = { day: 1, golden: 0, overcast: 0, night: 0 };

  // The photographer's controls. All of these apply in photo mode.
  const manual = {
    freezeExposure: false, ev: 0,
    gradeLock: null, gradeStrength: 1,
    fStop: null, focalLength: null, focusDistance: null,
    vignette: null, chromatic: null, grain: null,
    motionBlur: false
  };

  // ---- exposure ----------------------------------------------------------
  let adaptDown = 0.5, adaptUp = 0.5;   // per frame blend factors, recomputed from dt
  // Frames on which the meter locks straight onto its target instead of easing toward it.
  // Set whenever the render targets have just been thrown away and rebuilt: a resize, a tier
  // change, a chain rebuild. Easing from a value that belongs to a buffer that no longer exists
  // is how a screenshot taken one frame after a resize lands on disk two stops out.
  let snapFrames = 8;

  function buildMeter() {
    if (meterReady) return;
    const opts = { generateMipMaps: false, type: B.Constants.TEXTURETYPE_HALF_FLOAT,
      samplingMode: B.Texture.NEAREST_SAMPLINGMODE, format: B.Constants.TEXTUREFORMAT_RGBA };
    meterDown = new B.RenderTargetTexture('twin-meter-down', { width: METER_W, height: METER_H }, scene, opts);
    adaptRT[0] = new B.RenderTargetTexture('twin-meter-adapt-0', { width: 1, height: 1 }, scene, opts);
    adaptRT[1] = new B.RenderTargetTexture('twin-meter-adapt-1', { width: 1, height: 1 }, scene, opts);
    // These are targets for explicit shader passes, never scene renders, so they stay out of
    // scene.customRenderTargets and cost nothing when the meter is not running.
    effectRenderer = new B.EffectRenderer(engine);
    downWrapper = new B.EffectWrapper({
      engine, name: 'twinMeterDown', fragmentShader: 'twinMeterDown', useShaderStore: true,
      samplerNames: ['textureSampler'], uniformNames: ['uSpan']
    });
    adaptWrapper = new B.EffectWrapper({
      engine, name: 'twinMeterAdapt', fragmentShader: 'twinMeterAdapt', useShaderStore: true,
      samplerNames: ['textureSampler', 'prevSampler'], uniformNames: ['uAdapt', 'uLimit']
    });
    // Uniforms have to be set after the effect is bound, which is what onApply is for.
    downWrapper.onApplyObservable.add(() => {
      const e = downWrapper.effect;
      if (!e || !meterSource) return;
      e.setTexture('textureSampler', meterSource);
      e.setFloat2('uSpan', 0.33 / METER_W, 0.33 / METER_H);
    });
    adaptWrapper.onApplyObservable.add(() => {
      const e = adaptWrapper.effect;
      if (!e) return;
      e.setTexture('textureSampler', meterDown);
      e.setTexture('prevSampler', adaptRT[adaptIndex]);
      e.setFloat4('uAdapt', g.key, adaptDown, adaptUp, snapFrames > 0 ? 1 : 0);
      e.setFloat2('uLimit', EXPOSURE_MIN, EXPOSURE_MAX);
    });
    meterReady = true;
  }

  const srcThin = { texture: null, thin: null };
  function sourceTexture() {
    // The pass that applies exposure reads the raw HDR scene, so its input texture is exactly
    // what the meter wants: linear, pre exposure, pre tone map.
    const wrap = exposurePass && exposurePass.inputTexture;
    const internal = wrap && wrap.texture;
    if (!internal) return null;
    if (srcThin.texture !== internal) {
      srcThin.texture = internal;
      srcThin.thin = new B.ThinTexture(internal);
    }
    return srcThin.thin;
  }

  let meterRuns = 0, meterSkips = '', meterSource = null, meterColdFrames = 0;
  function runMeter(dt) {
    if (!meterReady || !exposurePass) { meterSkips = 'no meter or no exposure pass'; return; }
    if (!downWrapper.effect || !downWrapper.effect.isReady()) { meterSkips = 'down effect not ready'; meterColdFrames++; return; }
    if (!adaptWrapper.effect || !adaptWrapper.effect.isReady()) { meterSkips = 'adapt effect not ready'; meterColdFrames++; return; }
    const src = sourceTexture();
    if (!src) { meterSkips = 'no source texture'; meterColdFrames++; return; }
    meterSkips = '';
    meterRuns++;

    // The eye stops down quickly and opens up slowly. Everything about how this feels is here.
    adaptDown = 1 - Math.exp(-dt / 0.45);
    adaptUp = 1 - Math.exp(-dt / 2.4);

    meterSource = src;
    effectRenderer.render(downWrapper, meterDown);
    if (!manual.freezeExposure) {
      effectRenderer.render(adaptWrapper, adaptRT[1 - adaptIndex]);
      adaptIndex = 1 - adaptIndex;
      if (snapFrames > 0) snapFrames--;
    }
    engine.restoreDefaultFramebuffer();
  }

  // Reading the adapted value back is only ever for the read model, never for the image.
  // It costs a pipeline sync, so the first read times itself and sets its own cadence.
  let readbackCost = -1, readbackEvery = 90, readingBack = false, lastReadFrame = -1;
  function readExposure() {
    if (!meterReady || readingBack) return Promise.resolve(null);
    const rt = adaptRT[adaptIndex];
    if (!rt) return Promise.resolve(null);
    readingBack = true;
    const t0 = performance.now();
    let p;
    try { p = rt.readPixels(); } catch (e) { readingBack = false; return Promise.resolve(null); }
    if (!p) { readingBack = false; return Promise.resolve(null); }
    return p.then((data) => {
      const cost = performance.now() - t0;
      readbackCost = readbackCost < 0 ? cost : readbackCost * 0.7 + cost * 0.3;
      state.cost.readbackMs = +readbackCost.toFixed(2);
      readbackEvery = readbackCost < 3 ? 60 : readbackCost < 12 ? 600 : 0;
      if (readbackEvery === 0) note('exposure readout is on demand only: a single pixel readback '
        + 'stalls this device badly, so the meter stays entirely on the GPU. Call TWIN.postfx.meter().');
      const v = decodeRgba(data);
      if (v) {
        state.exposure.adapted = v[0];
        state.exposure.measuredLuma = v[1];
        state.exposure.target = v[2];
        state.exposure.readAgeFrames = 0;
        lastReadFrame = frameNo;
      }
      readingBack = false;
      return v ? { adapted: v[0], measuredLuma: v[1], target: v[2], costMs: +cost.toFixed(2) } : null;
    }).catch(() => { readingBack = false; return null; });
  }

  function decodeRgba(data) {
    if (!data) return null;
    if (data instanceof Float32Array) return [data[0], data[1], data[2]];
    if (data instanceof Uint16Array) return [half(data[0]), half(data[1]), half(data[2])];
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return [data[0] / 255, data[1] / 255, data[2] / 255];
    return null;
  }
  function half(h) {
    const s = (h & 0x8000) ? -1 : 1;
    const e = (h & 0x7c00) >> 10;
    const f = h & 0x03ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  // ---- focus -------------------------------------------------------------
  let focusM = 120, focusTargetM = 120, pickCost = 0, lastHit = null;
  const pickPredicate = (m) => m.isVisible && m.isEnabled() && m.isPickable !== false;

  function updateFocus(dt) {
    const tier = TIERS[state.tier];
    let cadence = manual.focusDistance != null ? 0
      : state.mode !== 'planner' ? Math.max(2, (tier.pickEvery || 6) - 2) : (tier.pickEvery || 8);
    // Ray casting against a dense terrain mesh is not cheap. If it turns out to cost real time,
    // slow it down rather than pay for it: the focus pull is smoothed anyway, so a 3 Hz sample
    // is indistinguishable from a 10 Hz one.
    if (cadence > 0 && pickCost > 1.2) cadence = Math.min(48, cadence * (pickCost > 4 ? 8 : 4));
    if (cadence > 0 && frameNo % cadence === 0 && scene.meshes.length) {
      const t0 = performance.now();
      try {
        // Where the lens is pointed, in client pixels, a touch below centre because that is
        // where the subject of a shot actually sits.
        const cw = stage.canvas.clientWidth || engine.getRenderWidth();
        const ch = stage.canvas.clientHeight || engine.getRenderHeight();
        const info = scene.pick(cw * 0.5, ch * 0.54, pickPredicate, false);
        if (info && info.hit && info.pickedPoint) {
          focusTargetM = B.Vector3.Distance(camera.globalPosition, info.pickedPoint);
          lastHit = info.pickedMesh ? info.pickedMesh.name : null;
        } else {
          focusTargetM = camera.radius != null ? camera.radius : 400;
          lastHit = null;
        }
      } catch (e) { lastHit = null; }
      pickCost = pickCost * 0.85 + (performance.now() - t0) * 0.15;
    }
    if (manual.focusDistance != null) focusTargetM = manual.focusDistance;

    // A focus puller works in log distance, not linear. This is why a rack focus feels right.
    const tau = state.mode === 'photo' ? 0.18 : 0.42;
    focusM = Math.exp(lerp(Math.log(Math.max(0.5, focusM)), Math.log(Math.max(0.5, focusTargetM)), 1 - Math.exp(-dt / tau)));
  }

  // ---- grade blending ----------------------------------------------------
  function sunElevation() {
    const dl = world.read('daylight');
    if (dl && typeof dl.elevationDeg === 'number') return dl.elevationDeg;
    // Fallback when daylight is not loaded, so the grades still cross fade on their own.
    const h = world.clock.minuteOfDay / 60;
    return 62 * Math.sin(((h - 6) / 12) * Math.PI);
  }
  function cloudiness() {
    const w = world.read('weather');
    if (!w) return 0.15;
    return clamp01(w.cloud + (w.rainMmHr > 0.5 ? 0.25 : 0));
  }

  function updateGradeMix(dt, immediate) {
    const el = sunElevation();
    const cloud = cloudiness();
    state.sunElevationDeg = el;
    state.cloud = cloud;

    let n = clamp01((-3 - el) / 7);
    let gd = clamp01(1 - Math.abs(el - 2.5) / 9);
    let d = clamp01((el - 5) / 12);
    let sum = n + gd + d;
    if (sum <= 0.0001) { d = 1; sum = 1; }
    n /= sum; gd /= sum; d /= sum;

    // Cloud takes over from the two daylight grades, never from night.
    const cf = clamp01((cloud - 0.38) / 0.42) * 0.92;
    const over = (gd + d) * cf;
    gd *= 1 - cf; d *= 1 - cf;

    mixTarget.night = n; mixTarget.golden = gd; mixTarget.day = d; mixTarget.overcast = over;
    if (manual.gradeLock) for (const id of GRADE_IDS) mixTarget[id] = id === manual.gradeLock ? 1 : 0;

    const k = immediate ? 1 : 1 - Math.exp(-dt / 0.9);
    let total = 0;
    for (const id of GRADE_IDS) { mix[id] = lerp(mix[id], mixTarget[id], k); total += mix[id]; }
    if (total > 0.0001) for (const id of GRADE_IDS) mix[id] /= total;

    // Blend the parameters, not the shader output: a cross fade is one CPU loop, not a pass.
    for (let i = 0; i < 3; i++) { g.gain[i] = 0; g.lift[i] = 0; g.gamma[i] = 0; g.shadowTint[i] = 0; g.highTint[i] = 0; }
    for (let i = 0; i < 4; i++) { g.tone[i] = 0; g.look[i] = 0; }
    g.place[0] = 0; g.place[1] = 0;
    g.key = 0; g.bloomThreshold = 0; g.bloomWeight = 0; g.grain = 0; g.vignette = 0;

    let dominant = 'day', dominantW = -1;
    for (const id of GRADE_IDS) {
      const w = mix[id];
      if (w > dominantW) { dominantW = w; dominant = id; }
      if (w <= 0) continue;
      const s = GRADES[id];
      for (let i = 0; i < 3; i++) {
        g.gain[i] += s.gain[i] * w; g.lift[i] += s.lift[i] * w; g.gamma[i] += s.gamma[i] * w;
        g.shadowTint[i] += s.shadowTint[i] * w; g.highTint[i] += s.highTint[i] * w;
      }
      for (let i = 0; i < 4; i++) { g.tone[i] += s.tone[i] * w; g.look[i] += s.look[i] * w; }
      g.place[0] += s.place[0] * w; g.place[1] += s.place[1] * w;
      g.key += s.key * w;
      g.bloomThreshold += s.bloom.threshold * w; g.bloomWeight += s.bloom.weight * w;
      g.grain += s.grain * w; g.vignette += s.vignette * w;
    }

    state.grade.dominant = dominant;
    state.grade.label = GRADES[dominant].label;
    state.grade.mix.day = mix.day; state.grade.mix.golden = mix.golden;
    state.grade.mix.overcast = mix.overcast; state.grade.mix.night = mix.night;
    state.grade.strength = manual.gradeStrength;
    state.keyTarget = g.key;
  }

  // ---- the chain ---------------------------------------------------------
  function shaderMaterialCount() {
    let n = 0;
    for (const m of scene.materials) if (m instanceof B.ShaderMaterial) n++;
    return n;
  }
  function ssaoUsable() {
    if (!B.SSAO2RenderingPipeline || !B.SSAO2RenderingPipeline.IsSupported) return false;
    return scene.materials.length > 0 && shaderMaterialCount() === 0;
  }

  function optionsFor(tier, mode) {
    const t = TIERS[tier];
    const photo = mode === 'photo', cinematic = mode === 'cinematic';
    return {
      ssao: !!t.ssao, exposure: true, drp: true,
      bloom: !!t.bloom, dof: !!(t.dof || photo), fxaa: !!t.fxaa,
      grade: true, taa: !!(t.taa || photo), film: !!t.film,
      motion: !!((cinematic || manual.motionBlur) && tier !== 'low'),
      msaa: t.msaa, photo, cinematic
    };
  }

  function destroyChain() {
    try { if (filmPass) filmPass.dispose(camera); } catch (e) { /* already gone */ }
    try { if (taa) taa.dispose(); } catch (e) { /* already gone */ }
    try { if (gradePass) gradePass.dispose(camera); } catch (e) { /* already gone */ }
    try { if (drp) drp.dispose(); } catch (e) { /* already gone */ }
    try { if (exposurePass) exposurePass.dispose(camera); } catch (e) { /* already gone */ }
    try { if (motionBlur) motionBlur.dispose(camera); } catch (e) { /* already gone */ }
    try { if (ssao) ssao.dispose(); } catch (e) { /* already gone */ }
    filmPass = taa = gradePass = drp = exposurePass = motionBlur = ssao = null;
    srcThin.texture = null; srcThin.thin = null;
    built = false;
  }

  /** Build the chain in canonical order from an option set. The only place passes are created. */
  function assemble(o) {
    destroyChain();
    camera = scene.activeCamera || stage.camera;
    if (!camera) return;
    const tier = TIERS[state.tier];
    const HALF = B.Constants.TEXTURETYPE_HALF_FLOAT;

    // 1. Ambient occlusion, first, so it multiplies the beauty pass rather than the bloom.
    //
    // Screen space occlusion needs a depth and normal prepass, and a hand written ShaderMaterial
    // cannot write one: Babylon's prepass renderer has no path for it. This island draws its
    // terrain, its water and its sky from ShaderMaterials that displace their own vertices, so
    // the prepass comes back empty and the combine pass multiplies the entire frame by zero.
    // That is a black screen, and it is exactly what every quality tier above Low was rendering.
    //
    // Nothing is lost by leaving it off. The terrain bakes its own occlusion from the heightfield
    // at two scales, which is correct at this scale and free, and the moment the scene is drawn
    // from materials that can feed a prepass this turns itself back on.
    if (o.ssao && !ssaoUsable()) {
      note('screen space occlusion is off: ' + shaderMaterialCount() + ' hand written ShaderMaterials '
        + 'in the scene cannot write the depth and normal prepass it needs, and without one it '
        + 'renders a black frame. The terrain bakes its own occlusion from the heightfield.');
    }
    if (o.ssao && ssaoUsable()) {
      try {
        ssao = new B.SSAO2RenderingPipeline('twin-ssao', scene,
          { ssaoRatio: tier.ssaoRatio || 0.5, blurRatio: 1 }, [camera], false, HALF);
        ssao.samples = tier.ssaoSamples || 8;
        ssao.radius = 1.15;          // metres: the island is modelled 1:1
        ssao.totalStrength = 0.85;
        ssao.base = 0.06;            // a floor of ambient, so nothing goes to pitch black
        ssao.expensiveBlur = !!tier.ssaoBlur;
        ssao.bilateralSamples = tier.ssaoBlur ? 12 : 8;
        ssao.bilateralSoften = 0.12;
        ssao.bilateralTolerance = 0.35;
        ssao.epsilon = 0.022;        // the anti ringing knob: raise it and haloes go away
        ssao.maxZ = 260;             // occlusion past a couple of hundred metres is noise
        ssao.minZAspect = 0.12;
        ssao.textureSamples = o.msaa;
      } catch (e) { ssao = null; note('ambient occlusion unavailable: ' + (e && e.message)); }
    }

    // 2. Motion blur. Per object, from the velocity buffer, and expensive, so it is opt in.
    if (o.motion) {
      try {
        motionBlur = new B.MotionBlurPostProcess('twin-motion', scene, 1.0, camera);
        motionBlur.isObjectBased = true;
        motionBlur.motionStrength = o.cinematic ? 1.0 : 0.65;
        motionBlur.motionBlurSamples = state.tier === 'ultra' ? 20 : 12;
      } catch (e) { motionBlur = null; note('motion blur unavailable: ' + (e && e.message)); }
    }

    // 3. Auto exposure, before tone mapping, which is the only place it physically belongs.
    if (o.exposure) {
      buildMeter();
      exposurePass = new B.PostProcess('twin-exposure', 'twinExposure', EXPOSURE_UNIFORMS,
        ['expSampler'], 1.0, camera, B.Texture.BILINEAR_SAMPLINGMODE, engine, false, null, HALF);
      exposurePass.samples = o.msaa;
      exposurePass.onApply = (effect) => {
        effect.setTexture('expSampler', adaptRT[adaptIndex]);
        effect.setFloat2('uExposure', -1, Math.pow(2, manual.freezeExposure || state.mode === 'photo' ? manual.ev : 0));
        effect.setFloat2('uLimit', EXPOSURE_MIN, EXPOSURE_MAX);
      };
    }

    // 4. The pipeline: bloom, depth of field, ACES, FXAA.
    if (o.drp) {
      drp = new B.DefaultRenderingPipeline('twin-image', true, scene, [camera], false);
      drp.samples = o.msaa;
      drp.fxaaEnabled = !!o.fxaa;
      drp.sharpenEnabled = false;          // sharpening is folded into the film pass
      drp.grainEnabled = false;            // grain lives after temporal accumulation
      drp.chromaticAberrationEnabled = false;
      drp.glowLayerEnabled = false;

      drp.bloomEnabled = !!o.bloom;
      drp.bloomKernel = tier.bloomKernel;
      drp.bloomScale = tier.bloomScale;
      drp.bloomWeight = g.bloomWeight;
      drp.bloomThreshold = g.bloomThreshold;

      drp.depthOfFieldEnabled = !!o.dof;
      if (o.dof) {
        drp.depthOfFieldBlurLevel = o.photo ? 2 : (tier.dofBlur ?? 1);
        drp.depthOfField.focalLength = o.photo ? 85 : o.cinematic ? 50 : 55;
        drp.depthOfField.fStop = o.photo ? 2.8 : o.cinematic ? 4.0 : 11.0;
        drp.depthOfField.lensSize = o.photo ? 60 : 50;
        drp.depthOfField.focusDistance = focusM * 1000;
      }

      drp.imageProcessingEnabled = true;
      const ip = scene.imageProcessingConfiguration;
      ip.toneMappingEnabled = true;
      ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.0;                 // exposure is applied upstream, in linear light
      ip.contrast = 1.0;                 // contrast belongs to the grade, not to two places
      ip.vignetteEnabled = false;        // the film pass owns the vignette
      ip.ditheringEnabled = true;        // kills the banding a big smooth sky always shows
      ip.ditheringIntensity = 1 / 255;
      drp.prepare();
    }

    // 5. The grade.
    if (o.grade) {
      gradePass = new B.PostProcess('twin-grade', 'twinGrade', GRADE_UNIFORMS, null, 1.0,
        camera, B.Texture.BILINEAR_SAMPLINGMODE, engine, false);
      gradePass.onApply = applyGrade;
    }

    // 6. Temporal accumulation. Babylon's TAA stops the moment the camera moves, which is the
    //    contract: a held shot resolves to a clean image, a moving shot never smears.
    if (o.taa) {
      try {
        taa = new B.TAARenderingPipeline('twin-taa', scene, [camera]);
        taa.samples = o.photo ? 24 : (tier.taaSamples || 8);
        taa.factor = 0.06;
        taa.disableOnCameraMove = true;
        taa.clampHistory = true;
        taa.msaaSamples = 1;
        taa.isEnabled = true;
      } catch (e) { taa = null; note('temporal accumulation unavailable: ' + (e && e.message)); }
    }

    // 7. The film pass, after accumulation, so grain stays grain instead of being averaged away.
    if (o.film) {
      filmPass = new B.PostProcess('twin-film', 'twinFilm', FILM_UNIFORMS, null, 1.0,
        camera, B.Texture.BILINEAR_SAMPLINGMODE, engine, false);
      filmPass.onApply = applyFilm;
    }

    current = o;
    built = true;
    needsRebuild = false;
    lastKernelKey = '';
    // Every target in the chain is new and empty. The meter must lock rather than ease.
    snapFrames = 8;
    publishPasses();
  }

  function buildChain() {
    // Only touch the hardware scaling when it actually changes. Setting it calls engine.resize(),
    // which reallocates the drawing buffer and every render target hanging off it, and doing that
    // for no reason in the middle of a screenshot is how a frame ends up on disk at a different
    // size and a different exposure from the one that was asked for.
    const want = baseScaling * TIERS[state.tier].scale;
    if (Math.abs(engine.getHardwareScalingLevel() - want) > 1e-4) engine.setHardwareScalingLevel(want);
    assemble(optionsFor(state.tier, state.mode));
  }

  function publishPasses() {
    const tier = TIERS[state.tier];
    state.tierLabel = tier.label;
    state.scaling = +(baseScaling * tier.scale).toFixed(3);
    state.renderScale = +(1 / (baseScaling * tier.scale)).toFixed(3);
    state.passes.ssao = !!ssao;
    state.passes.exposure = !!exposurePass;
    state.passes.bloom = !!(drp && drp.bloomEnabled);
    state.passes.dof = !!(drp && drp.depthOfFieldEnabled);
    state.passes.motionBlur = !!motionBlur;
    state.passes.fxaa = !!(drp && drp.fxaaEnabled);
    state.passes.taa = !!taa;
    state.passes.grade = !!gradePass;
    state.passes.film = !!filmPass;
    state.passes.msaa = drp ? drp.samples : 1;
    state.available = built;
  }

  function note(msg) {
    if (state.notes.indexOf(msg) < 0) state.notes.push(msg);
    if (state.notes.length > 8) state.notes.shift();
  }

  // ---- uniform upload ----------------------------------------------------
  function applyGrade(effect) {
    effect.setFloat3('uLift', g.lift[0], g.lift[1], g.lift[2]);
    effect.setFloat3('uGamma', g.gamma[0], g.gamma[1], g.gamma[2]);
    effect.setFloat3('uGain', g.gain[0], g.gain[1], g.gain[2]);
    effect.setFloat3('uShadowTint', g.shadowTint[0], g.shadowTint[1], g.shadowTint[2]);
    effect.setFloat3('uHighTint', g.highTint[0], g.highTint[1], g.highTint[2]);
    effect.setFloat4('uTone', g.tone[0], g.tone[1], g.tone[2], g.tone[3]);
    effect.setFloat4('uLook', g.look[0], g.look[1], g.look[2], g.look[3]);
    effect.setFloat3('uPlace', g.place[0], g.place[1], manual.gradeStrength);
  }

  function applyFilm(effect) {
    const tier = TIERS[state.tier];
    const vig = manual.vignette != null ? manual.vignette : g.vignette;
    const ca = manual.chromatic != null ? manual.chromatic : 0;
    const grain = manual.grain != null ? manual.grain : g.grain;
    const sharp = state.mode === 'photo' ? (tier.sharpen || 0) * 1.2 : (tier.sharpen || 0);
    effect.setFloat2('uTexel', filmPass.texelSize.x, filmPass.texelSize.y);
    effect.setFloat4('uFilm', vig, ca, grain, sharp);
    // Grain cells run about one and a half pixels. Any bigger and it reads as dirt on the lens.
    effect.setFloat2('uSeed', ((frameNo + grainSeed) % 1024) * 0.6180339887, filmPass.texelSize.y * 1.5);
    state.film.vignette = vig; state.film.chromatic = ca; state.film.grain = grain; state.film.sharpen = sharp;
  }

  // ---- cost --------------------------------------------------------------
  let gpuSupported = false, baselineGpu = 0, baselineFrames = 0, bench = null;

  function gpuMs() {
    if (!gpuSupported) return 0;
    const c = engine.getGPUFrameTimeCounter();
    if (!c) return 0;
    const v = c.lastSecAverage;
    return isFinite(v) && v > 0 ? v / 1e6 : 0;
  }

  const BENCH_STEPS = [
    ['sceneOnly', {}],
    ['ssao', { ssao: 1 }],
    ['autoExposure', { ssao: 1, exposure: 1 }],
    ['toneMap', { ssao: 1, exposure: 1, drp: 1 }],
    ['bloom', { ssao: 1, exposure: 1, drp: 1, bloom: 1 }],
    ['depthOfField', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1 }],
    ['fxaa', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1, fxaa: 1 }],
    ['grade', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1, fxaa: 1, grade: 1 }],
    ['taa', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1, fxaa: 1, grade: 1, taa: 1 }],
    ['film', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1, fxaa: 1, grade: 1, taa: 1, film: 1 }],
    ['motionBlur', { ssao: 1, exposure: 1, drp: 1, bloom: 1, dof: 1, fxaa: 1, grade: 1, taa: 1, film: 1, motion: 1 }]
  ];

  function applyBenchStep(i) {
    const base = optionsFor(state.tier, state.mode);
    const want = BENCH_STEPS[i][1];
    assemble({
      ssao: !!want.ssao && base.ssao, exposure: !!want.exposure, drp: !!want.drp,
      bloom: !!want.bloom, dof: !!want.dof, fxaa: !!want.fxaa, grade: !!want.grade,
      taa: !!want.taa, film: !!want.film, motion: !!want.motion,
      msaa: base.msaa, photo: base.photo, cinematic: base.cinematic
    });
  }

  function stepBench(frameMs) {
    if (!bench) return;
    if (bench.i < 0) { bench.i = 0; applyBenchStep(0); bench.warm = 0; bench.samples.length = 0; return; }
    if (bench.warm < bench.warmFrames) { bench.warm++; return; }
    const v = gpuSupported ? gpuMs() : frameMs;
    if (v > 0) bench.samples.push(v);
    if (bench.samples.length < bench.sampleFrames) return;

    const sorted = bench.samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const id = BENCH_STEPS[bench.i][0];
    if (bench.i === 0) { bench.results.sceneOnlyMs = +median.toFixed(3); baselineGpu = median; }
    else bench.results[id] = +Math.max(0, median - bench.prev).toFixed(3);
    bench.prev = median;
    bench.i++;

    if (bench.i >= BENCH_STEPS.length) {
      bench.results.totalPostMs = +Math.max(0, median - bench.results.sceneOnlyMs).toFixed(3);
      bench.results.withEverythingMs = +median.toFixed(3);
      bench.results.tier = state.tier;
      bench.results.renderSize = [engine.getRenderWidth(), engine.getRenderHeight()];
      state.cost.passes = bench.results;
      state.cost.baselineMs = bench.results.sceneOnlyMs;
      state.cost.method = (gpuSupported ? 'GPU timer query' : 'CPU frame time')
        + ', incremental, median of ' + bench.sampleFrames + ' frames per pass';
      const done = bench.resolve;
      bench = null;
      buildChain();
      world.bus.emit('postfx:bench', state.cost.passes);
      if (done) done(state.cost.passes);
      return;
    }
    applyBenchStep(bench.i);
    bench.warm = 0;
    bench.samples.length = 0;
  }

  // ---- draw calls --------------------------------------------------------
  // Babylon's engine._drawCalls is a lifetime accumulator. Nothing resets it unless a
  // SceneInstrumentation with captureDrawCalls is attached, and there is none here, so reading
  // .current gives the number of draw calls since the page loaded. That is where the reported
  // 7735 draw calls "with five active meshes" came from: it was ten minutes of frames added up,
  // not one frame. The honest number is the difference across a frame, which is what this keeps.
  let lastDrawTotal = -1, drawPerFrame = 0, drawPeak = 0;
  function countDrawCalls() {
    const c = engine._drawCalls;
    if (!c) return;
    const total = c.current;
    if (lastDrawTotal >= 0 && total >= lastDrawTotal) {
      drawPerFrame = total - lastDrawTotal;
      if (frameNo > 90 && drawPerFrame > drawPeak) drawPeak = drawPerFrame;
    }
    lastDrawTotal = total;
    state.cost.drawCalls = drawPerFrame;
    state.cost.drawCallsPeak = drawPeak;
  }

  // ---- the automatic tier guard -----------------------------------------
  // engine.getFps() measures wall clock frame intervals. world.telemetry.fps measures CPU work
  // per frame and reads much higher when the GPU is the bottleneck, so it is the wrong number
  // to steer image quality with.
  let lowFor = 0, highFor = 0, lastGuardMs = 0, tierMovedAtMs = -1e9, lastEngineFrameId = -1;
  function guard() {
    const fps = engine.getFps();
    state.fps = fps;
    // Real elapsed seconds, never the simulation dt that was handed in. TWIN.shot() pumps sixty
    // frames through this layer inside a few hundred milliseconds with the render loop stopped,
    // and on the simulated dt of 0.05 that measured three seconds of "too slow" and stepped the
    // tier down in the middle of a screenshot. A tier step resizes the drawing buffer, and the
    // frame that landed on disk was the one rendered into the fresh, unmetered targets: the
    // pure white 8:30am frame. Frame rate is a wall clock property, so measure it on the wall.
    const now = performance.now();
    const real = lastGuardMs ? (now - lastGuardMs) / 1000 : 0;
    lastGuardMs = now;
    if (!state.auto || bench || !built || frameNo < 120) return;
    // A frame interval outside this window is not a frame rate reading: it is a burst render, a
    // tab that was in the background, or a breakpoint.
    if (!(real > 0.002 && real < 0.4)) return;
    if (now - tierMovedAtMs < 5000) return;   // let a tier change settle before judging it
    const idx = TIER_IDS.indexOf(state.tier);
    const ceil = TIER_IDS.indexOf(state.ceiling);
    if (fps > 0 && fps < 52) { lowFor += real; highFor = 0; }
    else if (fps > 88) { highFor += real; lowFor = 0; }
    else { lowFor = Math.max(0, lowFor - real * 0.5); highFor = Math.max(0, highFor - real * 0.5); }
    if (lowFor > 3 && idx > 0) {
      lowFor = 0; tierMovedAtMs = now;
      api.setTier(TIER_IDS[idx - 1]);
      api.notice('Image quality stepped down to ' + TIERS[state.tier].label + ' to hold frame rate');
    } else if (highFor > 12 && idx < ceil) {
      highFor = 0; tierMovedAtMs = now;
      api.setTier(TIER_IDS[idx + 1]);
      api.notice('Image quality stepped up to ' + TIERS[state.tier].label);
    }
  }

  // ---- the public handle -------------------------------------------------
  const api = {
    tiers: TIER_IDS.slice(),
    grades: GRADE_IDS.slice(),
    state,
    setTier(t) {
      if (!TIERS[t] || t === state.tier) return state.tier;
      state.tier = t;
      state.tierLabel = TIERS[t].label;
      needsRebuild = true;
      world.bus.emit('postfx:tier', { tier: t, label: TIERS[t].label });
      return t;
    },
    setMode(m) {
      const mode = m === 'photo' || m === 'cinematic' ? m : 'planner';
      if (mode === state.mode) return mode;
      state.mode = mode;
      if (mode === 'photo') {
        if (manual.vignette == null) manual.vignette = 0.10;
      } else if (mode === 'planner') {
        manual.freezeExposure = false; manual.ev = 0;
        manual.gradeLock = null; manual.vignette = null; manual.chromatic = null;
        manual.grain = null; manual.focusDistance = null;
        manual.fStop = null; manual.focalLength = null;
      }
      state.exposure.frozen = manual.freezeExposure;
      needsRebuild = true;
      world.bus.emit('postfx:mode', { mode });
      return mode;
    },
    /** Photo mode controls. Any subset may be passed at once. */
    set(o = {}) {
      if (o.tier) api.setTier(o.tier);
      if (o.mode) api.setMode(o.mode);
      if (o.ev !== undefined) { manual.ev = o.ev || 0; manual.freezeExposure = o.ev !== null; }
      if (o.autoExposure !== undefined) manual.freezeExposure = !o.autoExposure;
      if (o.grade !== undefined) manual.gradeLock = o.grade && GRADES[o.grade] ? o.grade : null;
      if (o.gradeStrength !== undefined) manual.gradeStrength = clamp01(o.gradeStrength);
      if (o.fStop !== undefined) manual.fStop = o.fStop;
      if (o.focalLength !== undefined) manual.focalLength = o.focalLength;
      if (o.focus !== undefined) manual.focusDistance = o.focus;
      if (o.vignette !== undefined) manual.vignette = o.vignette;
      if (o.chromatic !== undefined) manual.chromatic = o.chromatic;
      if (o.grain !== undefined) manual.grain = o.grain;
      if (o.motionBlur !== undefined) { manual.motionBlur = !!o.motionBlur; needsRebuild = true; }
      state.exposure.frozen = manual.freezeExposure;
      state.exposure.ev = manual.ev;
      return api.report();
    },
    ev(v) { manual.freezeExposure = true; manual.ev = v; state.exposure.ev = v; state.exposure.frozen = true; return v; },
    autoExposure() { manual.freezeExposure = false; state.exposure.frozen = false; return true; },
    grade(id) { manual.gradeLock = id && GRADES[id] ? id : null; return state.grade; },
    photo(on = true) { return api.setMode(on ? 'photo' : 'planner'); },
    cinematic(on = true) { return api.setMode(on ? 'cinematic' : 'planner'); },
    /** Read the adapted exposure back off the GPU. Async, and it costs a pipeline sync. */
    meter() { return readExposure(); },
    /** Rebuild the chain one pass at a time and time each increment. Takes a few seconds. */
    bench(sampleFrames = 34) {
      if (bench) return Promise.reject(new Error('a bench is already running'));
      return new Promise((resolve) => {
        bench = { i: -1, warm: 0, warmFrames: 14, sampleFrames, samples: [], results: {}, prev: 0, resolve };
      });
    },
    report() {
      return JSON.parse(JSON.stringify({
        tier: state.tier, tierLabel: state.tierLabel, auto: state.auto, mode: state.mode,
        exposure: state.exposure, keyTarget: +state.keyTarget.toFixed(3),
        sunElevationDeg: +state.sunElevationDeg.toFixed(1), cloud: +state.cloud.toFixed(2),
        grade: state.grade, focus: state.focus, passes: state.passes, film: state.film,
        cost: state.cost, fps: +state.fps.toFixed(1),
        pickCostMs: +pickCost.toFixed(3), notes: state.notes
      }));
    },
    notice(msg) { world.bus.emit('notice', { source: 'postfx', text: msg, tone: 'info' }); },
    /** Internals, for diagnosing the exposure loop from the console. */
    debug() {
      const src = sourceTexture();
      return {
        meterReady, meterRuns, meterSkips, adaptIndex, frameNo, built,
        downCompiled: !!(downWrapper && downWrapper.effect && downWrapper.effect.isReady()),
        downError: downWrapper && downWrapper.effect ? downWrapper.effect.getCompilationError() : 'no wrapper',
        adaptCompiled: !!(adaptWrapper && adaptWrapper.effect && adaptWrapper.effect.isReady()),
        adaptError: adaptWrapper && adaptWrapper.effect ? adaptWrapper.effect.getCompilationError() : 'no wrapper',
        hasSource: !!src,
        sourceSize: src && src.getSize ? src.getSize() : null,
        chain: camera ? camera._postProcesses.map((p) => p && p.name) : null
      };
    }
  };

  // ---------------------------------------------------------------------------
  // The render layer.
  // ---------------------------------------------------------------------------
  stage.addLayer({
    id: 'postfx',
    order: 900,   // last, so every other layer has already built its meshes and lights

    init(st) {
      scene = st.scene;
      engine = st.engine;
      camera = scene.activeCamera || st.camera;
      baseScaling = engine.getHardwareScalingLevel();

      // Any resize throws every render target in the chain away, including the one the meter
      // reads. Lock the exposure onto the first valid frame of the new buffers instead of easing
      // toward it from a value that belonged to buffers that no longer exist.
      try { engine.onResizeObservable.add(() => { snapFrames = 8; lastDrawTotal = -1; }); }
      catch (e) { /* older engine: the coverage gate in the meter still covers this */ }

      gpuSupported = !!engine.getCaps().timerQuery;
      if (gpuSupported) {
        try { engine.captureGPUFrameTime = true; } catch (e) { gpuSupported = false; }
      }
      state.cost.gpuTimerSupported = gpuSupported;
      state.cost.method = (gpuSupported ? 'GPU frame time' : 'CPU frame time') + ' less a pre attach baseline';

      if (pending.tier && TIERS[pending.tier]) { state.tier = pending.tier; state.ceiling = pending.tier; state.auto = false; }
      if (pending.mode) state.mode = pending.mode;

      // A starting guess from what the machine looks like. The guard corrects it within a few
      // seconds if the guess was wrong, which is cheaper than trying to guess perfectly.
      if (state.auto) {
        const cores = navigator.hardwareConcurrency || 4;
        state.tier = cores <= 4 ? 'medium' : 'high';
        state.ceiling = 'ultra';
      }
      publishPasses();
    },

    frame(st, w, dt) {
      frameNo++;
      const t0 = performance.now();

      // The calibration scene, if this module is running on its own.
      if (frameNo === 10) maybeBuildCalibration(st, w);
      if (demo && demo.updateLight) demo.updateLight(st, w);

      // Baseline: a handful of frames of the raw scene before anything is attached. It lines up
      // with the boot overlay fading out, so nobody sees an ungraded frame.
      if (!built && !bench) {
        if (frameNo > 22 && frameNo <= 40) {
          const v = gpuSupported ? gpuMs() : (w.telemetry.frameMs || 0);
          if (v > 0) { baselineGpu = (baselineGpu * baselineFrames + v) / (baselineFrames + 1); baselineFrames++; }
        }
        if (frameNo === 41) { state.cost.baselineMs = +baselineGpu.toFixed(3); buildChain(); }
      }

      // Is the engine's own render loop driving this frame, or is something pumping frames by
      // hand? engine.frameId only advances inside beginFrame(), which the render loop calls and
      // a direct scene.render() does not. TWIN.shot() renders sixty frames by hand, and a chain
      // rebuild in the middle of that burst resizes the drawing buffer under the screenshot and
      // throws away every render target the meter and the tone mapper were using. The frame that
      // then lands on disk is white, or black. Nothing that changes the shape of the chain may
      // happen inside a burst; it waits for the next real frame, which is a sixtieth of a second.
      const fid = typeof engine.frameId === 'number' ? engine.frameId : -1;
      const drivenByLoop = fid < 0 || fid !== lastEngineFrameId;
      lastEngineFrameId = fid;

      const cam = scene.activeCamera || st.camera;
      // A camera swap is not a quality choice: the chain is attached to a camera that is no
      // longer rendering, so it has to move now whether or not this is a burst.
      const cameraChanged = built && cam !== camera;
      if (cameraChanged) needsRebuild = true;
      if (needsRebuild && !bench && (drivenByLoop || cameraChanged)) buildChain();

      updateGradeMix(dt, frameNo < 45);

      // The exposure loop, entirely on the GPU, reading the frame that was drawn last.
      if (built && exposurePass) runMeter(dt);
      if (meterRuns === 0 && meterColdFrames > 180) {
        note('auto exposure did not start (' + meterSkips + '): exposure is holding at 1.0');
        meterColdFrames = -1e9;
      }
      if (state.exposure.readAgeFrames >= 0) state.exposure.readAgeFrames = frameNo - lastReadFrame;
      if (built && meterReady && !bench && !readingBack
        && (frameNo === 150 || (readbackEvery > 0 && frameNo % readbackEvery === 0))) {
        readExposure();
      }

      if (built && drp) {
        if (drp.bloomEnabled) {
          if (Math.abs(drp.bloomThreshold - g.bloomThreshold) > 0.002) drp.bloomThreshold = g.bloomThreshold;
          const wt = g.bloomWeight * (state.mode === 'photo' ? 1.15 : 1);
          if (Math.abs(drp.bloomWeight - wt) > 0.002) drp.bloomWeight = wt;
          // Kernel width rebuilds the blur chain, so it only moves when the dominant grade
          // changes, never continuously through a cross fade.
          const kernKey = state.tier + ':' + state.grade.dominant;
          if (kernKey !== lastKernelKey) {
            lastKernelKey = kernKey;
            const kern = Math.round(TIERS[state.tier].bloomKernel * GRADES[state.grade.dominant].bloom.kernelScale / 8) * 8;
            if (drp.bloomKernel !== kern) drp.bloomKernel = kern;
          }
        }

        if (drp.depthOfFieldEnabled) {
          updateFocus(dt);
          const dof = drp.depthOfField;
          const fl = manual.focalLength != null ? manual.focalLength
            : state.mode === 'photo' ? 85 : state.mode === 'cinematic' ? 50 : 55;
          const fs = manual.fStop != null ? manual.fStop
            : state.mode === 'photo' ? 2.8 : state.mode === 'cinematic' ? 4.0 : 11.0;
          if (dof.focalLength !== fl) dof.focalLength = fl;
          if (dof.fStop !== fs) dof.fStop = fs;
          dof.focusDistance = clamp(focusM, 0.5, 12000) * 1000;
          state.focus.metres = focusM; state.focus.targetMetres = focusTargetM;
          state.focus.fStop = fs; state.focus.focalLengthMm = fl; state.focus.hit = lastHit;
        }
      }

      const running = gpuSupported ? gpuMs() : (w.telemetry.frameMs || 0);
      state.cost.gpuMs = +running.toFixed(3);
      state.cost.frameMs = +(w.telemetry.frameMs || 0).toFixed(3);
      state.cost.estimateMs = +Math.max(0, running - baselineGpu).toFixed(3);
      countDrawCalls();

      if (drivenByLoop) guard();
      if (bench) stepBench(w.telemetry.frameMs || (performance.now() - t0));

      world.telemetry.record('layer:postfx', performance.now() - t0);
    },

    dispose() {
      destroyChain();
      try { if (meterDown) meterDown.dispose(); } catch (e) { /* gone */ }
      try { if (adaptRT[0]) adaptRT[0].dispose(); } catch (e) { /* gone */ }
      try { if (adaptRT[1]) adaptRT[1].dispose(); } catch (e) { /* gone */ }
      try { if (downWrapper) downWrapper.dispose(); } catch (e) { /* gone */ }
      try { if (adaptWrapper) adaptWrapper.dispose(); } catch (e) { /* gone */ }
      try { if (effectRenderer) effectRenderer.dispose(); } catch (e) { /* gone */ }
      meterReady = false;
      if (demo) { try { demo.dispose(); } catch (e) { /* gone */ } demo = null; }
    }
  });

  // Hang the handle off TWIN once main.js has built it.
  world.bus.on('app:ready', () => {
    if (window.TWIN) window.TWIN.postfx = api;
    const params = new URLSearchParams(location.search);
    if (params.get('bench') === '1') setTimeout(() => api.bench().catch(() => {}), 1500);
  });

  return api;

  // ---------------------------------------------------------------------------
  // Calibration scene.
  //
  // Loaded on its own (?only=postfx) there is nothing in the scene to grade. Rather than hand a
  // critic a black screen, build a test chart in the shape of a beach edge: a sand slope with real
  // relief, water with a specular path for the bloom to find, silhouettes at four depths for the
  // depth of field, and objects sitting on the ground for the ambient occlusion to hold down.
  // It is a chart, not a place. No location on Minjerribah is claimed or modelled here.
  // ---------------------------------------------------------------------------
  function maybeBuildCalibration(st, w) {
    const params = new URLSearchParams(location.search);
    const only = params.get('only');
    if (!only || !only.includes('postfx')) return;
    if (params.get('nodemo') === '1') return;
    if (st.scene.meshes.length > 0) return;   // someone else built the island: leave it alone

    const scene2 = st.scene;
    const rngD = w.rng.stream('postfx-calibration');
    const noise = makeNoise2D(w.seed ^ 0x5f3a);
    const nodes = [];
    demo = { dispose() { for (const n of nodes) { try { n.dispose(); } catch (e) { /* gone */ } } nodes.length = 0; } };

    note('calibration scene built: ?only=postfx has no island to grade');

    function sandHeight(x, z) {
      const t = clamp01((60 - z) / 120);
      let h = 3.4 * Math.pow(t, 1.7);
      if (z < -40) h += 11 * (1 - Math.exp((z + 40) / 75));
      h += noise.fbm(x * 0.006, z * 0.006, 4) * 1.7 * clamp01(t + 0.25);
      h += noise.fbm(x * 0.05, z * 0.05, 2) * 0.16;
      return h;
    }

    const ground = B.MeshBuilder.CreateGround('twinfx-sand', { width: 900, height: 900, subdivisions: 160 }, scene2);
    const pos = ground.getVerticesData(B.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      pos[i + 1] = z > 62 ? -1.6 - (z - 62) * 0.02 : sandHeight(x, z);
    }
    ground.updateVerticesData(B.VertexBuffer.PositionKind, pos);
    ground.createNormals(true);
    ground.receiveShadows = true;
    nodes.push(ground);

    const sandTex = new B.DynamicTexture('twinfx-sandtex', { width: 256, height: 256 }, scene2, true);
    const sctx = sandTex.getContext();
    const img = sctx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 214 + Math.floor(rngD.float() * 28) + Math.floor(noise.fbm((i % 256) * 0.05, Math.floor(i / 256) * 0.05, 3) * 10);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v - 3; img.data[i * 4 + 2] = v - 13; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    sandTex.update();
    sandTex.uScale = 90; sandTex.vScale = 90;

    const sandMat = new B.StandardMaterial('twinfx-sandmat', scene2);
    sandMat.diffuseTexture = sandTex;
    sandMat.diffuseColor = new B.Color3(1.0, 0.97, 0.90);
    sandMat.specularColor = new B.Color3(0.07, 0.07, 0.07);
    sandMat.specularPower = 24;
    ground.material = sandMat;
    nodes.push(sandMat, sandTex);

    const water = B.MeshBuilder.CreateGround('twinfx-water', { width: 2400, height: 1400, subdivisions: 2 }, scene2);
    water.position.z = 760; water.position.y = 0.05;
    const waterMat = new B.StandardMaterial('twinfx-watermat', scene2);
    waterMat.diffuseColor = new B.Color3(0.050, 0.185, 0.205);
    waterMat.specularColor = new B.Color3(1.6, 1.62, 1.55);
    waterMat.specularPower = 480;
    waterMat.emissiveColor = new B.Color3(0.010, 0.040, 0.046);
    water.material = waterMat;
    nodes.push(water, waterMat);

    const shallow = B.MeshBuilder.CreateGround('twinfx-shallow', { width: 2400, height: 130, subdivisions: 2 }, scene2);
    shallow.position.z = 126; shallow.position.y = 0.09;
    const shallowMat = new B.StandardMaterial('twinfx-shallowmat', scene2);
    shallowMat.diffuseColor = new B.Color3(0.28, 0.60, 0.55);
    shallowMat.specularColor = new B.Color3(1.0, 1.05, 1.0);
    shallowMat.specularPower = 200;
    shallowMat.alpha = 0.9;
    shallow.material = shallowMat;
    nodes.push(shallow, shallowMat);

    const trunk = B.MeshBuilder.CreateCylinder('twinfx-trunk', { height: 6.5, diameterTop: 0.42, diameterBottom: 0.66, tessellation: 8 }, scene2);
    const trunkMat = new B.StandardMaterial('twinfx-trunkmat', scene2);
    trunkMat.diffuseColor = new B.Color3(0.21, 0.17, 0.13);
    trunkMat.specularColor = new B.Color3(0.03, 0.03, 0.03);
    trunk.material = trunkMat;
    nodes.push(trunk, trunkMat);

    const blade = B.MeshBuilder.CreateBox('twinfx-blade', { width: 0.22, height: 0.06, depth: 3.4 }, scene2);
    const bladeMat = new B.StandardMaterial('twinfx-blademat', scene2);
    bladeMat.diffuseColor = new B.Color3(0.15, 0.26, 0.13);
    bladeMat.specularColor = new B.Color3(0.10, 0.12, 0.08);
    bladeMat.specularPower = 48;
    blade.material = bladeMat;
    nodes.push(blade, bladeMat);

    const rock = B.MeshBuilder.CreateIcoSphere('twinfx-rock', { radius: 1, subdivisions: 2 }, scene2);
    const rockMat = new B.StandardMaterial('twinfx-rockmat', scene2);
    rockMat.diffuseColor = new B.Color3(0.29, 0.27, 0.24);
    rockMat.specularColor = new B.Color3(0.06, 0.06, 0.06);
    rock.material = rockMat;
    nodes.push(rock, rockMat);

    // The prototype mesh is placement zero, so nothing is left stranded at the origin.
    let usedTrunk = false, usedBlade = false, usedRock = false;
    const place = (proto, name, first) => (first ? proto : proto.createInstance(name));

    for (let i = 0; i < 26; i++) {
      const x = rngD.range(-190, 190);
      const z = rngD.range(-120, 40) - (i % 4) * 12;
      const y = sandHeight(x, z);
      const s = rngD.range(0.8, 1.5);
      const t = place(trunk, 'twinfx-trunk-' + i, !usedTrunk); usedTrunk = true;
      t.position.set(x, y + 3.1 * s, z);
      t.rotation.z = rngD.range(-0.13, 0.13);
      t.scaling.setAll(s);
      for (let b = 0; b < 7; b++) {
        const bl = place(blade, 'twinfx-blade-' + i + '-' + b, !usedBlade); usedBlade = true;
        const a = (b / 7) * Math.PI * 2 + rngD.range(-0.3, 0.3);
        bl.position.set(x + Math.cos(a) * 1.2 * s, y + 6.2 * s, z + Math.sin(a) * 1.2 * s);
        bl.rotation.set(rngD.range(-0.5, -0.1), -a, rngD.range(-0.25, 0.25));
        bl.scaling.setAll(rngD.range(0.9, 1.6) * s);
      }
    }
    for (let i = 0; i < 34; i++) {
      const x = rngD.range(-160, 160);
      const z = rngD.range(-70, 58);
      const r = rngD.range(0.35, 1.5);
      const rk = place(rock, 'twinfx-rock-' + i, !usedRock); usedRock = true;
      rk.position.set(x, sandHeight(x, z) + r * 0.45, z);
      rk.scaling.set(r * rngD.range(0.8, 1.4), r * rngD.range(0.5, 0.9), r * rngD.range(0.8, 1.4));
      rk.rotation.y = rngD.range(0, 6.28);
    }

    // A few small emitters, so night has something over 1.0 for the bloom to catch.
    const lampMat = new B.StandardMaterial('twinfx-lampmat', scene2);
    lampMat.diffuseColor = new B.Color3(0, 0, 0);
    lampMat.emissiveColor = new B.Color3(6.0, 4.1, 1.9);
    lampMat.disableLighting = true;
    nodes.push(lampMat);
    for (let i = 0; i < 3; i++) {
      const x = -70 + i * 62;
      const lamp = B.MeshBuilder.CreateSphere('twinfx-lamp-' + i, { diameter: 0.5, segments: 8 }, scene2);
      lamp.position.set(x, sandHeight(x, -30 + i * 9) + 5.4, -30 + i * 9);
      lamp.material = lampMat;
      nodes.push(lamp);
    }

    // The lighting layer owns shadows in the real build. There is no lighting layer here, so one
    // shadow map keeps the ambient occlusion honest about what it is and is not doing.
    try {
      const sg = new B.ShadowGenerator(2048, st.sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0016;
      sg.normalBias = 0.014;
      st.sun.autoCalcShadowZBounds = true;
      sg.addShadowCaster(trunk, true);
      sg.addShadowCaster(blade, true);
      sg.addShadowCaster(rock, true);
      nodes.push(sg);
    } catch (e) { note('calibration shadows unavailable'); }

    // Frame it like a photograph rather than like a plan. setTarget rebuilds the orbit angles
    // from the current position, so it has to happen before alpha, beta and radius are set.
    const cam = scene2.activeCamera;
    if (cam && cam.setTarget) {
      cam.setTarget(new B.Vector3(0, 5, 30));
      cam.alpha = -Math.PI / 2 + 0.30;
      cam.beta = 1.33;
      cam.radius = 82;
      cam.lowerRadiusLimit = 6;
      cam.minZ = 0.4;
      cam.maxZ = 4000;
    }

    demo.updateLight = function (s2, w2) {
      const elDeg = sunElevation();
      const el = elDeg * Math.PI / 180;
      const dl = w2.read('daylight');
      const az = dl ? dl.azimuth : Math.PI * 1.15;
      s2.sun.direction.set(-Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el));
      const day = clamp01((elDeg + 4) / 12);
      const golden = clamp01(1 - Math.abs(elDeg - 3) / 10);
      s2.sun.intensity = lerp(0.02, 3.4, day);
      s2.sun.diffuse.set(lerp(0.55, 1.0, day) + golden * 0.30, lerp(0.62, 0.965, day) + golden * 0.05, lerp(0.95, 0.905, day) - golden * 0.22);
      s2.hemi.intensity = lerp(0.06, 0.58, day);
      s2.hemi.diffuse.set(lerp(0.10, 0.52, day), lerp(0.15, 0.70, day), lerp(0.30, 0.96, day));
      s2.hemi.groundColor.set(lerp(0.04, 0.42, day), lerp(0.05, 0.38, day), lerp(0.09, 0.30, day));
      s2.scene.clearColor.set(lerp(0.006, 0.33, day), lerp(0.013, 0.53, day), lerp(0.032, 0.80, day), 1);
      s2.scene.fogMode = B.Scene.FOGMODE_EXP2;
      s2.scene.fogDensity = 0.00085;
      s2.scene.fogColor.set(lerp(0.015, 0.60, day), lerp(0.024, 0.70, day), lerp(0.05, 0.83, day));
    };
  }
}
