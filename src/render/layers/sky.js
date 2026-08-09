// Sky, atmosphere and celestial bodies over Minjerribah.
//
// The island sits at 27.43 S, 153.45 E. The sun comes up out of open Pacific off Point Lookout
// and goes down behind the mainland ranges, so the two ends of the day do not look alike here:
// sunrise is clean ocean air, sunset is dust and smoke off the continent. That asymmetry, the
// physically deep twilight that ozone gives, and a real southern star sky are the three things
// this layer exists to get right.
//
// How it is built:
//   1. A single-scattering atmosphere (Rayleigh + Mie + ozone, spherical earth, earth shadow on
//      the light ray) is integrated into a small half-float lookup texture on the GPU. The same
//      model is evaluated in JavaScript once a frame to drive the scene lights, the fog colour
//      and the exposure, so the sky and the island can never disagree about what time it is.
//   2. The dome shader reads that lookup and adds the sun disc, the moon with its true phase,
//      stars, the Milky Way, the zodiacal light, and the clouds.
//   3. Clouds are projected onto spherical shells rather than flat planes, so they converge at
//      the horizon the way real cloud does, and are marched in three slices with a sun-direction
//      shadow tap for self shadowing and silver lining.
//
// Nothing here calls Math.random or Date.now. The noise field is drawn from world.rng.stream('sky')
// once at init; everything else is a pure function of world.clock or of the render delta.

const B = window.BABYLON;

// ---------------------------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------------------------
const LAT_DEG = -27.4283;
const LON_DEG = 153.4517;
const LAT = LAT_DEG * Math.PI / 180;
const TZ_OFFSET = 10; // AEST. Queensland does not use daylight saving.
const DEG = Math.PI / 180;

// World axes used by this project: +X east, +Y up, +Z north, metres, left handed.
// Azimuth is measured from north, clockwise, matching src/systems/environment/daylight.js.

// ---------------------------------------------------------------------------------------------
// Atmosphere. Coefficients are the standard Bruneton set at 680/550/440 nm, per metre.
// ---------------------------------------------------------------------------------------------
const RE = 6371000;      // earth radius, m
const RTOP = 6471000;    // top of atmosphere, m
const BR = [5.802e-6, 13.558e-6, 33.100e-6];  // Rayleigh scattering
const BM = 3.996e-6;                          // Mie scattering
const BMX = 4.440e-6;                         // Mie extinction
const BO = [0.650e-6, 1.881e-6, 0.085e-6];    // ozone absorption
const HR = 8000, HM = 1200;
const SUN_I = 22.0;      // solar irradiance in the arbitrary radiance units used throughout
const MULTI = 0.12;      // cheap isotropic stand in for multiple scattering

// ---------------------------------------------------------------------------------------------
// Bright stars. Real catalogue: right ascension in hours, declination in degrees (J2000),
// visual magnitude, B-V colour index. Crux and the Pointers are the ones that must be right,
// because on this island they are the first thing anyone looks for.
// ---------------------------------------------------------------------------------------------
const STARS = [
  // name                RA h      Dec deg   V mag   B-V
  /* Sirius        */  6.7525,  -16.716,  -1.46,  0.00,
  /* Canopus       */  6.3992,  -52.696,  -0.74,  0.15,
  /* Rigil Kent aCen*/ 14.6600, -60.835,  -0.27,  0.71,
  /* Arcturus      */ 14.2610,   19.182,  -0.05,  1.23,
  /* Vega          */ 18.6156,   38.784,   0.03,  0.00,
  /* Capella       */  5.2782,   45.998,   0.08,  0.80,
  /* Rigel         */  5.2422,   -8.202,   0.13, -0.03,
  /* Procyon       */  7.6550,    5.225,   0.34,  0.42,
  /* Achernar      */  1.6286,  -57.237,   0.46, -0.16,
  /* Betelgeuse    */  5.9195,    7.407,   0.50,  1.85,
  /* Hadar bCen    */ 14.0637,  -60.373,   0.61, -0.23,
  /* Altair        */ 19.8464,    8.868,   0.77,  0.22,
  /* Acrux aCru    */ 12.4433,  -63.099,   0.77, -0.24,
  /* Aldebaran     */  4.5987,   16.509,   0.85,  1.54,
  /* Spica         */ 13.4199,  -11.161,   0.98, -0.23,
  /* Antares       */ 16.4901,  -26.432,   1.09,  1.83,
  /* Pollux        */  7.7553,   28.026,   1.14,  1.00,
  /* Fomalhaut     */ 22.9608,  -29.622,   1.16,  0.09,
  /* Deneb         */ 20.6905,   45.280,   1.25,  0.09,
  /* Mimosa bCru   */ 12.7953,  -59.689,   1.25, -0.24,
  /* Regulus       */ 10.1395,   11.967,   1.35, -0.11,
  /* Adhara        */  6.9770,  -28.972,   1.50, -0.21,
  /* Castor        */  7.5766,   31.888,   1.58,  0.03,
  /* Shaula        */ 17.5601,  -37.104,   1.62, -0.22,
  /* Gacrux gCru   */ 12.5194,  -57.113,   1.63,  1.60,
  /* Bellatrix     */  5.4188,    6.350,   1.64, -0.22,
  /* Elnath        */  5.4381,   28.608,   1.65, -0.13,
  /* Miaplacidus   */  9.2200,  -69.717,   1.67,  0.07,
  /* Alnilam       */  5.6036,   -1.202,   1.69, -0.18,
  /* Alnair        */ 22.1372,  -46.961,   1.74, -0.07,
  /* Alnitak       */  5.6793,   -1.943,   1.77, -0.20,
  /* Alioth        */ 12.9005,   55.960,   1.77, -0.02,
  /* Regor g2Vel   */  8.1585,  -47.337,   1.78, -0.15,
  /* Dubhe         */ 11.0622,   61.751,   1.79,  1.07,
  /* Mirfak        */  3.4054,   49.861,   1.79,  0.48,
  /* Wezen         */  7.1399,  -26.393,   1.83,  0.67,
  /* Kaus Australis*/ 18.4029,  -34.385,   1.85, -0.03,
  /* Avior eCar    */  8.3752,  -59.510,   1.86,  1.19,
  /* Alkaid        */ 13.7923,   49.313,   1.86, -0.19,
  /* Sargas        */ 17.6220,  -42.998,   1.86,  0.40,
  /* Menkalinan    */  5.9922,   44.947,   1.90,  0.08,
  /* Atria         */ 16.8110,  -69.028,   1.91,  1.44,
  /* Alhena        */  6.6285,   16.399,   1.93,  0.00,
  /* Peacock       */ 20.4275,  -56.735,   1.94, -0.12,
  /* Alsephina dVel*/  8.7450,  -54.709,   1.96,  0.04,
  /* Mirzam        */  6.3783,  -17.956,   1.98, -0.24,
  /* Alphard       */  9.4597,   -8.659,   1.98,  1.44,
  /* Polaris       */  2.5303,   89.264,   1.98,  0.60,
  /* Hamal         */  2.1195,   23.462,   2.00,  1.15,
  /* Diphda        */  0.7265,  -17.987,   2.04,  1.02,
  /* Nunki         */ 18.9211,  -26.297,   2.05, -0.22,
  /* Menkent       */ 14.1114,  -36.370,   2.06,  1.01,
  /* Alpheratz     */  0.1398,   29.091,   2.07, -0.11,
  /* Mirach        */  1.1622,   35.621,   2.07,  1.58,
  /* Kochab        */ 14.8451,   74.155,   2.08,  1.47,
  /* Rasalhague    */ 17.5822,   12.560,   2.08,  0.16,
  /* Saiph         */  5.7959,   -9.670,   2.09, -0.17,
  /* Almach        */  2.0650,   42.330,   2.10,  1.37,
  /* Bet Gruis     */ 22.7113,  -46.885,   2.11,  1.60,
  /* Algol         */  3.1361,   40.956,   2.12, -0.05,
  /* Denebola      */ 11.8177,   14.572,   2.14,  0.09,
  /* Muhlifain gCen*/ 12.6919,  -48.960,   2.17, -0.01,
  /* Naos zPup     */  8.0597,  -40.003,   2.21, -0.27,
  /* Aspidiske iCar*/  9.2850,  -59.275,   2.21,  0.18,
  /* Suhail lVel   */  9.1332,  -43.433,   2.23,  1.67,
  /* Sadr gCyg     */ 20.3705,   40.257,   2.23,  0.68,
  /* Mintaka dOri  */  5.5334,   -0.299,   2.23, -0.18,
  /* Eps Cen       */ 13.6647,  -53.466,   2.30, -0.22,
  /* Alp Lupi      */ 14.6989,  -47.388,   2.30, -0.20,
  /* Eta Cen       */ 14.5940,  -42.158,   2.31, -0.19,
  /* Kappa Sco     */ 17.7083,  -39.030,   2.39, -0.20,
  /* Ankaa         */  0.4381,  -42.306,   2.40,  1.09,
  /* Zet Cen       */ 13.9257,  -47.288,   2.55, -0.22,
  /* Del Cen       */ 12.1394,  -50.722,   2.58, -0.12,
  /* Zet Sgr       */ 19.0435,  -29.880,   2.60, -0.06,
  /* Acrab bSco    */ 16.0906,  -19.805,   2.62, -0.07,
  /* Bet Lupi      */ 14.9754,  -43.134,   2.68, -0.20,
  /* Lesath uSco   */ 17.5127,  -37.296,   2.69, -0.22,
  /* Kaus Media    */ 18.3499,  -29.828,   2.70, -0.03,
  /* Iota Cen      */ 13.3379,  -36.712,   2.75,  0.05,
  /* Iota Ori      */  5.5925,   -5.910,   2.77, -0.24,
  /* Imai dCru     */ 12.2519,  -58.749,   2.79, -0.19,
  /* Bet Hydri     */  0.4293,  -77.254,   2.80,  0.62,
  /* Kaus Borealis */ 18.4661,  -25.422,   2.81,  1.03,
  /* Tau Sco       */ 16.5981,  -28.216,   2.82, -0.25,
  /* Bet TrA       */ 15.9192,  -63.430,   2.83,  0.29,
  /* Alp Arae      */ 17.5307,  -49.876,   2.84, -0.17,
  /* Bet Arae      */ 17.4218,  -55.530,   2.84,  1.46,
  /* Alp Hydri     */  1.9799,  -61.570,   2.86,  0.28,
  /* Alp Tucanae   */ 22.3083,  -60.259,   2.86,  1.39,
  /* Gam TrA       */ 15.3153,  -68.679,   2.87,  0.01,
  /* Pi Sco        */ 15.9860,  -26.114,   2.89, -0.19,
  /* Sig Sco       */ 16.3536,  -25.593,   2.89,  0.13,
  /* Alnasl gSgr   */ 18.0966,  -30.424,   2.98,  1.00,
  /* Mu Sco        */ 16.8641,  -38.017,   3.00, -0.20,
  /* Gam Gruis     */ 21.8987,  -37.365,   3.00, -0.12,
  /* Iota Sco      */ 17.7932,  -40.127,   3.03,  0.51,
  /* Zeta Ara      */ 16.9772,  -55.990,   3.13,  1.60,
  /* Eta Sco       */ 17.2027,  -43.239,   3.32,  0.41,
  /* Ginan eCru    */ 12.3564,  -60.401,   3.59,  1.39
];

// ---------------------------------------------------------------------------------------------
// One cloud profile per synoptic state published by src/systems/environment/weather.js.
// Everything is lerped between profiles so a change of weather is a transition, never a cut.
// ---------------------------------------------------------------------------------------------
const PROFILES = {
  ridge:        { cover: 0.10, base: 1500, top: 2200, dens: 0.95, cell: 11000, ci: 0.34, ciD: 0.55, ciH: 8000, storm: 0.0, front: 0.0, turb: 1.5, haze: 0.55, look: 'high cirrus, deep blue behind it' },
  seabreeze:    { cover: 0.34, base: 950,  top: 2100, dens: 1.15, cell: 8500,  ci: 0.14, ciD: 0.40, ciH: 8500, storm: 0.0, front: 0.0, turb: 2.3, haze: 0.85, look: 'fair weather cumulus marching in off the nor-easter' },
  trough:       { cover: 0.56, base: 800,  top: 2700, dens: 1.30, cell: 9500,  ci: 0.42, ciD: 0.55, ciH: 7500, storm: 0.25, front: 0.0, turb: 2.9, haze: 1.05, look: 'humid, stacked mid level cloud' },
  storm:        { cover: 0.46, base: 700,  top: 2900, dens: 1.55, cell: 10500, ci: 0.50, ciD: 0.70, ciH: 9500, storm: 1.0, front: 0.0, turb: 3.3, haze: 1.15, look: 'anvil towering to the west with a black base' },
  southerly:    { cover: 0.60, base: 650,  top: 2300, dens: 1.40, cell: 7500,  ci: 0.28, ciD: 0.45, ciH: 7000, storm: 0.0, front: 1.0, turb: 2.5, haze: 1.00, look: 'hard line of cloud crossing from the south' },
  eastcoastlow: { cover: 0.97, base: 320,  top: 1500, dens: 1.85, cell: 5200,  ci: 0.62, ciD: 0.75, ciH: 6500, storm: 0.0, front: 0.0, turb: 3.1, haze: 2.10, look: 'low grey scud, no horizon' },
  westerly:     { cover: 0.07, base: 1700, top: 2400, dens: 0.85, cell: 12000, ci: 0.09, ciD: 0.35, ciH: 8500, storm: 0.0, front: 0.0, turb: 1.1, haze: 0.35, look: 'scoured out by a cold westerly' }
};
const DEFAULT_PROFILE = PROFILES.seabreeze;

const MOON_NAMES = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full',
  'waning gibbous', 'last quarter', 'waning crescent'];

// ---------------------------------------------------------------------------------------------
// Small maths helpers. All scratch arrays are module level: nothing here allocates per frame.
// ---------------------------------------------------------------------------------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const _d3 = [0, 0, 0];
const _od = [0, 0, 0];
const _odl = [0, 0, 0];
const _tr = [0, 0, 0];

function densAt(h, out) {
  out[0] = Math.exp(-h / HR);
  out[1] = Math.exp(-h / HM);
  out[2] = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  return out;
}
function rayTop(px, py, pz, dx, dy, dz) {
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - RTOP * RTOP;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}
function rayGround(px, py, pz, dx, dy, dz) {
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - RE * RE;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
/** Optical depth from p toward the light, or a huge number if the earth is in the way. */
function lightDepth(px, py, pz, lx, ly, lz, out) {
  if (rayGround(px, py, pz, lx, ly, lz) > 0) { out[0] = out[1] = out[2] = 1e9; return out; }
  const tmax = rayTop(px, py, pz, lx, ly, lz);
  out[0] = out[1] = out[2] = 0;
  let prev = 0;
  for (let i = 1; i <= 5; i++) {
    const f = i / 5, t = tmax * f * f, dt = t - prev, tm = prev + dt * 0.5;
    prev = t;
    const qx = px + lx * tm, qy = py + ly * tm, qz = pz + lz * tm;
    densAt(Math.sqrt(qx * qx + qy * qy + qz * qz) - RE, _d3);
    out[0] += _d3[0] * dt; out[1] += _d3[1] * dt; out[2] += _d3[2] * dt;
  }
  return out;
}
function transmit(od, mieK, out) {
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-(BR[i] * od[0] + BMX * mieK * od[1] + BO[i] * od[2]));
  return out;
}
/** Colour of direct sunlight arriving at altitude h, including the earth shadow test. */
function sunlightAt(h, sx, sy, sz, mieK, out) {
  lightDepth(0, RE + h, 0, sx, sy, sz, _odl);
  transmit(_odl, mieK, out);
  out[0] *= SUN_I; out[1] *= SUN_I; out[2] *= SUN_I;
  return out;
}
/** Sky radiance in one direction. The JS twin of the GPU lookup, used for lights and fog. */
const _sr = [0, 0, 0], _sm = [0, 0, 0];
function skyRadiance(dx, dy, dz, sx, sy, sz, mieK, eyeH, out) {
  const oy = RE + Math.max(1, eyeH);
  const tg = rayGround(0, oy, 0, dx, dy, dz);
  const tmax = tg > 0 ? tg : rayTop(0, oy, 0, dx, dy, dz);
  _od[0] = _od[1] = _od[2] = 0;
  _sr[0] = _sr[1] = _sr[2] = 0;
  _sm[0] = _sm[1] = _sm[2] = 0;
  let prev = 0;
  for (let i = 1; i <= 10; i++) {
    const f = i / 10, t = tmax * f * f, dt = t - prev, tm = prev + dt * 0.5;
    prev = t;
    const px = dx * tm, py = oy + dy * tm, pz = dz * tm;
    densAt(Math.sqrt(px * px + py * py + pz * pz) - RE, _d3);
    const sgR = _d3[0] * dt, sgM = _d3[1] * dt, sgO = _d3[2] * dt;
    _od[0] += sgR * 0.5; _od[1] += sgM * 0.5; _od[2] += sgO * 0.5;
    lightDepth(px, py, pz, sx, sy, sz, _odl);
    for (let c = 0; c < 3; c++) {
      const tr = Math.exp(-(BR[c] * (_od[0] + _odl[0]) + BMX * mieK * (_od[1] + _odl[1]) + BO[c] * (_od[2] + _odl[2])));
      _sr[c] += sgR * tr;
      _sm[c] += sgM * tr;
    }
    _od[0] += sgR * 0.5; _od[1] += sgM * 0.5; _od[2] += sgO * 0.5;
  }
  const mu = dx * sx + dy * sy + dz * sz;
  const pr = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = 0.76;
  const pm = (3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu)) /
    ((2 + g * g) * Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * mu), 1.5));
  for (let c = 0; c < 3; c++) {
    out[c] = SUN_I * (_sr[c] * BR[c] * pr + _sm[c] * BM * mieK * pm +
      (_sr[c] * BR[c] + _sm[c] * BM * mieK) * MULTI);
  }
  return out;
}
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ---------------------------------------------------------------------------------------------
// Astronomy. Sun by NOAA, moon by the same synodic approximation daylight.js publishes so the
// two never disagree, sidereal time from the Julian day so the star sky is genuinely correct.
// ---------------------------------------------------------------------------------------------
function solarPosition(dayOfYear, minuteOfDay) {
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minuteOfDay / 60 - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const tst = minuteOfDay + eqTime + 4 * LON_DEG - 60 * TZ_OFFSET;
  const ha = ((tst / 4) - 180) * DEG;
  const cosZen = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha);
  const alt = Math.PI / 2 - Math.acos(clamp(cosZen, -1, 1));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  return { alt, az };
}
function moonPosition(absDay, minuteOfDay) {
  const SYN = 29.530588853;
  const since = ((absDay - 5.5 + minuteOfDay / 1440) % SYN + SYN) % SYN;
  const phase = since / SYN;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const decl = 0.4;
  const ha = ((minuteOfDay / 60) - (12 + phase * 24)) * 15 * DEG;
  const alt = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  return { alt, az, phase, illum };
}
/** Local apparent sidereal time in degrees. */
function siderealDeg(absDay, minuteOfDay) {
  const jd = absDay + 2440587.5 + minuteOfDay / 1440 - TZ_OFFSET / 24;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  gmst = ((gmst % 360) + 360) % 360;
  return (gmst + LON_DEG + 360) % 360;
}
/** Equatorial to horizon rotation, column major for GLSL mat3. Determinant is -1 because the
 *  equatorial frame is right handed and the world is left handed; that flip is the point. */
function celestialMatrix(lstDeg, out, outInv) {
  const th = lstDeg * DEG;
  const st = Math.sin(th), ct = Math.cos(th);
  const sp = Math.sin(LAT), cp = Math.cos(LAT);
  const m00 = -st, m01 = ct, m02 = 0;
  const m10 = cp * ct, m11 = cp * st, m12 = sp;
  const m20 = -sp * ct, m21 = -sp * st, m22 = cp;
  out[0] = m00; out[1] = m10; out[2] = m20;
  out[3] = m01; out[4] = m11; out[5] = m21;
  out[6] = m02; out[7] = m12; out[8] = m22;
  outInv[0] = m00; outInv[1] = m01; outInv[2] = m02;
  outInv[3] = m10; outInv[4] = m11; outInv[5] = m12;
  outInv[6] = m20; outInv[7] = m21; outInv[8] = m22;
}
function equatorialToHorizon(raH, decDeg, lstDeg, out) {
  const a = raH * 15 * DEG, dc = decDeg * DEG;
  const vx = Math.cos(dc) * Math.cos(a), vy = Math.cos(dc) * Math.sin(a), vz = Math.sin(dc);
  const th = lstDeg * DEG, st = Math.sin(th), ct = Math.cos(th);
  const ux = ct * vx + st * vy, uy = -st * vx + ct * vy, uz = vz;
  const sp = Math.sin(LAT), cp = Math.cos(LAT);
  out[0] = uy;
  out[1] = cp * ux + sp * uz;
  out[2] = -sp * ux + cp * uz;
  return out;
}
/** B-V colour index to a rough sRGB tint. */
function starTint(bv, out) {
  const k = clamp((bv + 0.4) / 2.4, 0, 1);
  const stops = [
    [0.62, 0.72, 1.00], [0.79, 0.86, 1.00], [1.00, 0.98, 0.96],
    [1.00, 0.90, 0.76], [1.00, 0.79, 0.58], [1.00, 0.68, 0.47]
  ];
  const f = k * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const t = f - i;
  for (let c = 0; c < 3; c++) out[c] = lerp(stops[i][c], stops[i + 1][c], t);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tileable value noise. Built from world.rng so the cloud field is the same island every run.
// ---------------------------------------------------------------------------------------------
function tileLattice(rng, n) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rng.float();
  return function (u, v) {
    const x = u * n, y = v * n;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    x0 = ((x0 % n) + n) % n; y0 = ((y0 % n) + n) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
}
function buildNoise(rng, size) {
  const oct = (lat) => lat.map((n) => tileLattice(rng, n));
  const R = oct([6, 12, 24]), G = oct([3, 6, 12]), Bc = oct([10, 20, 40]), A = oct([2, 4]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const r = R[0](u, v) * 0.52 + R[1](u, v) * 0.30 + R[2](u, v) * 0.18;
      const g = G[0](u, v) * 0.55 + G[1](u, v) * 0.30 + G[2](u, v) * 0.15;
      let b = 0, w = 0, amp = 1;
      for (let i = 0; i < 3; i++) { b += amp * (1 - Math.abs(2 * Bc[i](u, v) - 1)); w += amp; amp *= 0.5; }
      b /= w;
      const a = A[0](u, v) * 0.66 + A[1](u, v) * 0.34;
      const o = (y * size + x) * 4;
      data[o] = clamp(r, 0, 1) * 255;
      data[o + 1] = clamp(g, 0, 1) * 255;
      data[o + 2] = clamp(b, 0, 1) * 255;
      data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
const LUT_FS = `
precision highp float;
varying vec2 vUV;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonPower;
uniform float uTurb;
uniform float uEyeH;
uniform float uAirglow;

const float PI = 3.14159265359;
const float RE = 6371000.0;
const float RTOP = 6471000.0;
const vec3  BR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BM = 3.996e-6;
const float BMX = 4.44e-6;
const vec3  BO = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float SUN_I = 22.0;
const float MULTI = 0.12;
const int VSTEPS = 16;
const int LSTEPS = 5;

vec3 dens(float h){
  return vec3(exp(-h/8000.0), exp(-h/1200.0), max(0.0, 1.0 - abs(h - 25000.0)/15000.0));
}
float rayTop(vec3 p, vec3 d){
  float b = dot(p,d);
  return -b + sqrt(max(0.0, b*b - (dot(p,p) - RTOP*RTOP)));
}
float rayGround(vec3 p, vec3 d){
  float b = dot(p,d);
  float disc = b*b - (dot(p,p) - RE*RE);
  if (disc < 0.0) return -1.0;
  float t = -b - sqrt(disc);
  return t > 0.0 ? t : -1.0;
}
vec3 lightDepth(vec3 p, vec3 l){
  if (rayGround(p,l) > 0.0) return vec3(1e9);
  float tmax = rayTop(p,l);
  vec3 od = vec3(0.0);
  float prev = 0.0;
  for (int i=1;i<=LSTEPS;i++){
    float f = float(i)/float(LSTEPS);
    float t = tmax*f*f;
    float dt = t - prev;
    od += dens(length(p + l*(prev + dt*0.5)) - RE)*dt;
    prev = t;
  }
  return od;
}
vec3 scatter(vec3 ro, vec3 rd, vec3 ld, vec3 lc, float mieK){
  float tg = rayGround(ro, rd);
  float tmax = tg > 0.0 ? tg : rayTop(ro, rd);
  vec3 od = vec3(0.0), sr = vec3(0.0), sm = vec3(0.0);
  float prev = 0.0;
  for (int i=1;i<=VSTEPS;i++){
    float f = float(i)/float(VSTEPS);
    float t = tmax*f*f;
    float dt = t - prev;
    vec3 p = ro + rd*(prev + dt*0.5);
    prev = t;
    vec3 seg = dens(length(p) - RE)*dt;
    od += seg*0.5;
    vec3 odl = lightDepth(p, ld);
    vec3 tr = exp(-(BR*(od.x+odl.x) + (BMX*mieK)*(od.y+odl.y) + BO*(od.z+odl.z)));
    sr += seg.x*tr;
    sm += seg.y*tr;
    od += seg*0.5;
  }
  float mu = dot(rd, ld);
  float pr = 3.0/(16.0*PI)*(1.0 + mu*mu);
  float g = 0.76;
  float pm = 3.0/(8.0*PI)*((1.0-g*g)*(1.0+mu*mu))/((2.0+g*g)*pow(max(1e-4, 1.0+g*g-2.0*g*mu), 1.5));
  return lc*(sr*BR*pr + sm*(BM*mieK)*pm + (sr*BR + sm*(BM*mieK))*MULTI);
}
void main(void){
  float az = vUV.x * 2.0 * PI;
  float t = vUV.y*2.0 - 1.0;
  float el = (t < 0.0 ? -1.0 : 1.0) * t*t*(PI*0.5);
  vec3 d = vec3(cos(el)*sin(az), sin(el), cos(el)*cos(az));
  vec3 ro = vec3(0.0, RE + max(1.0, uEyeH), 0.0);
  vec3 col = scatter(ro, d, uSunDir, vec3(SUN_I), uTurb);
  if (uMoonPower > 0.0){
    col += scatter(ro, d, uMoonDir, vec3(SUN_I*0.92, SUN_I*0.96, SUN_I)*uMoonPower, uTurb);
  }
  // Airglow: the faint green oxygen emission that keeps a moonless ocean horizon from going black.
  col += uAirglow*vec3(0.45, 1.0, 0.70)*(1.0 + 2.2*exp(-max(el, 0.0)*7.0));
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const DOME_VS = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void){
  vDir = position;
  vec4 p = worldViewProjection*vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w*0.999999, p.w);
}
`;

const DOME_FS = `
precision highp float;

varying vec3 vDir;
uniform sampler2D uLut;
uniform sampler2D uNoise;

uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunDisc;
uniform vec3 uMoonDisc;
uniform vec3 uCuSun;
uniform vec3 uCiSun;
uniform vec3 uStormSun;
uniform vec3 uAmb;
uniform vec3 uSunCel;

uniform vec4 uCu;        // x 1/cell size, y coverage, z density, w base height
uniform vec4 uCu2;       // x top height, y extinction, z shear, w ambient wrap
uniform vec2 uCuDrift;
uniform vec4 uCi;        // x 1/cell size, y coverage, z density, w height
uniform vec2 uCiDrift;
uniform vec4 uFront;     // x amount, y position m, z coverage ahead, w coverage behind
uniform vec2 uFrontN;
uniform vec4 uStorm;     // x amount, y distance m, z top height, w base height
uniform vec4 uStorm2;    // x half width, y anvil half width, z drift, w base darkness
uniform vec2 uStormN;
uniform vec2 uStormS;

uniform float uEyeH;
uniform float uNight;
uniform float uExposure;
uniform float uContrast;
uniform float uMw;
uniform float uStarGain;
uniform float uFlash;
uniform float uCloudFar;
uniform float uZodiac;
uniform float uSunSquash;
uniform float uSunLift;
uniform float uSeaFill;
uniform float uTime;
uniform mat3  uCelInv;

const float PI = 3.14159265359;
const float RE = 6371000.0;
const float SUN_R = 0.004653;   // solar angular radius, rad (0.2666 deg)
const float MOON_R = 0.004528;  // lunar angular radius, rad
const vec3 NGP = vec3(-0.86767, -0.19797, 0.45599);  // north galactic pole, J2000
const vec3 GCX = vec3(-0.05495, -0.87345, -0.48405); // toward the galactic centre
const vec3 GCY = vec3( 0.49410, -0.44505,  0.74698);
const vec3 NEP = vec3(0.0, -0.39778, 0.91748);       // north ecliptic pole

float sat(float x){ return clamp(x, 0.0, 1.0); }
float hg(float mu, float g){
  float gg = g*g;
  return (1.0-gg)/(4.0*PI*pow(max(1e-3, 1.0 + gg - 2.0*g*mu), 1.5));
}
float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx)*0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y)*q.z);
}
float hash13(vec3 p){
  p = fract(p*0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y)*p.z);
}
vec2 lutUv(vec3 d){
  float el = asin(clamp(d.y, -1.0, 1.0));
  float s = el < 0.0 ? -1.0 : 1.0;
  float t = s*sqrt(abs(el)/(PI*0.5));
  return vec2(atan(d.x, d.z)*0.15915494, t*0.5 + 0.5);
}
vec3 skyAt(vec3 d){ return texture2D(uLut, lutUv(d)).rgb; }

// Distance to a spherical shell h metres up. Finite at the horizon, which is why cloud
// converges into the haze there instead of stretching to infinity like a flat plane.
float shellT(float h, float dy){
  float R = RE + uEyeH;
  float Rh = RE + h;
  float b = R*dy;
  return -b + sqrt(max(0.0, b*b + Rh*Rh - R*R));
}

float frontCover(vec2 p){
  if (uFront.x <= 0.0) return uCu.y;
  float s = dot(p, uFrontN) - uFront.y;
  float line = exp(-s*s*(1.0/(7000.0*7000.0)));
  float base = mix(uFront.w, uFront.z, smoothstep(-2000.0, 4000.0, s));
  return mix(uCu.y, min(1.0, base + line*0.42), uFront.x);
}

// Flat base, cauliflower top: widest at the bottom of the slab and tapering with height, which
// is what a fair weather cumulus over warm water actually does.
float cuShape(float hf){ return 1.0 - smoothstep(0.10, 1.14, hf); }

float cuDens(vec2 p, float hf){
  vec2 uv = p*uCu.x;
  float grp = texture2D(uNoise, uv*0.30 + uCuDrift*0.30).a;
  float bod = texture2D(uNoise, uv + uCuDrift + vec2(hf*uCu2.z, hf*uCu2.z*0.35)).r;
  float det = texture2D(uNoise, uv*4.6 + uCuDrift*3.2).b;
  float n = grp*0.50 + bod*0.31 + det*0.19;
  float thr = 1.0 - frontCover(p);
  return max(0.0, n - thr - (1.0 - cuShape(hf))*0.34)*uCu.z;
}
float cuShadow(vec2 p, float hf){
  vec2 uv = p*uCu.x;
  float grp = texture2D(uNoise, uv*0.30 + uCuDrift*0.30).a;
  float bod = texture2D(uNoise, uv + uCuDrift + vec2(hf*uCu2.z, hf*uCu2.z*0.35)).r;
  float n = grp*0.58 + bod*0.42;
  float thr = 1.0 - frontCover(p);
  return max(0.0, n - thr - (1.0 - cuShape(hf))*0.34)*uCu.z;
}

void main(void){
  vec3 d = normalize(vDir);
  float mu = dot(d, uSunDir);
  vec3 col = skyAt(d);

  // ---- sea below the horizon. The ocean layer draws over this when it exists; on its own the
  // island still reads as an island. The horizon sits at the true dip for the eye height, which
  // from the Point Lookout headland is a quarter of a degree and from Mount Tempest is half.
  float dip = -sqrt(2.0*max(uEyeH, 1.0)/RE);
  float below = smoothstep(dip + 0.0004, dip - 0.0007, d.y);
  if (uSeaFill > 0.0 && below > 0.0){
    float tw = max(uEyeH, 1.0)/max(-d.y, 0.0004);
    vec2 wp = d.xz*tw;
    float chop = 0.052*clamp(1.0 - tw/14000.0, 0.05, 1.0);
    float n1 = texture2D(uNoise, wp*0.00042 + vec2(uTime*0.0035, uTime*0.0012)).g - 0.5;
    float n2 = texture2D(uNoise, wp*0.0021 + vec2(uTime*0.009, 0.0)).r - 0.5;
    vec3 r = normalize(vec3(d.x + n1*chop, -d.y + abs(n2)*chop*0.5, d.z + n2*chop*0.7));
    vec3 refl = skyAt(r);
    float f = 0.022 + 0.978*pow(1.0 - sat(-d.y), 5.0);
    float sd = sat(dot(r, uSunDir));
    float glit = pow(sd, 600.0)*0.65 + pow(sd, 42.0)*0.05;
    vec3 sea = refl*f*0.88 + uAmb*vec3(0.010, 0.030, 0.040)*(1.0 - f) + uSunDisc*glit*0.010;
    col = mix(col, sea, below*uSeaFill);
  }
  float aboveSea = 1.0 - below*uSeaFill;

  // ---- stars, Milky Way, zodiacal light
  if (uNight > 0.002){
    vec3 cel = uCelInv*d;
    float above = sat(d.y*14.0 + 0.06);
    float ext = exp(-0.30/max(d.y + 0.09, 0.09));   // atmospheric extinction toward the horizon

    float sb = dot(cel, NGP);
    float band = exp(-sb*sb*26.0);
    float toGc = dot(cel, GCX);
    vec2 guv = vec2(atan(dot(cel, GCY), toGc)*0.15915494, sb*2.2);
    float lane = texture2D(uNoise, guv*vec2(1.0, 0.7)).g;
    float dust = texture2D(uNoise, guv*vec2(3.1, 2.2) + vec2(0.31, 0.07)).r;
    float mwB = band*(0.30 + 1.35*smoothstep(-0.1, 0.9, toGc));
    mwB *= 0.30 + 1.15*lane*(0.45 + 0.75*dust);
    vec3 mw = mwB*uMw*vec3(0.85, 0.88, 1.00);

    // A field of faint stars, denser through the galactic plane.
    vec3 q = cel*260.0;
    vec3 cellf = floor(q);
    float h1 = hash13(cellf);
    float h2 = hash13(cellf + 7.31);
    vec3 pt = cellf + vec3(h1, h2, fract(h1*97.0)) ;
    float dstar = length(q - pt - 0.5)*2.0;
    float bright = step(0.955 - band*0.030, h2)*pow(sat(1.0 - dstar), 9.0);
    float tw = 0.75 + 0.25*sin(uTime*(2.0 + h1*5.0) + h1*30.0);
    vec3 field = vec3(0.85 + h1*0.15, 0.88, 1.0)*bright*tw*uStarGain*0.55;

    // Zodiacal light: the false dawn. A real thing here on a dark clear morning, a cone of
    // sunlight scattered off interplanetary dust standing up along the ecliptic before the sun.
    float eb = dot(cel, NEP);
    float elong = dot(cel, uSunCel);
    float zod = exp(-abs(eb)*6.5)*smoothstep(-0.25, 0.9, elong)*uZodiac;

    col += (mw + field)*uNight*ext*above + vec3(1.0, 0.94, 0.86)*zod*ext*above;
  }

  // ---- sun disc. Lifted by atmospheric refraction and squashed by its gradient, which is why
  // the sun clears the sea a couple of minutes before geometry says it should, and why it is an
  // oval when it does.
  if (mu > 0.99929){
    float elP = asin(clamp(d.y, -1.0, 1.0));
    float elS = asin(clamp(uSunDir.y, -1.0, 1.0)) + uSunLift;
    float dAz = atan(d.x, d.z) - atan(uSunDir.x, uSunDir.z);
    dAz = mod(dAz + PI, 2.0*PI) - PI;
    float x = dAz*cos(elP);
    float y = (elP - elS)*uSunSquash;
    float r = sqrt(x*x + y*y)/SUN_R;
    float limb = 1.0 - 0.62*(1.0 - sqrt(max(0.0, 1.0 - min(r, 1.0)*min(r, 1.0))));
    col += uSunDisc*limb*(1.0 - smoothstep(0.985, 1.02, r))*aboveSea;
  }
  // Aureole: the aerosol glow that wraps the sun and turns the whole western sky at dusk.
  col += uSunDisc*0.0016*hg(mu, 0.86)*sat(1.0 - abs(d.y)*0.4)*aboveSea;

  // ---- moon: the lit fraction comes from the true sun and moon directions, so the bright limb
  // points the way it does from this latitude, which is not the way it does from Europe.
  float mm = dot(d, uMoonDir);
  if (mm > 0.99985 && uMoonDisc.g > 0.0){
    vec3 up = abs(uMoonDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 e1 = normalize(cross(up, uMoonDir));
    vec3 e2 = cross(uMoonDir, e1);
    float x = dot(d, e1)/MOON_R;
    float y = dot(d, e2)/MOON_R;
    float rr = x*x + y*y;
    if (rr < 1.0){
      float z = sqrt(max(0.0, 1.0 - rr));
      vec3 n = e1*x + e2*y - uMoonDir*z;   // -uMoonDir points from the moon back at us
      float lit = sat(dot(n, uSunDir));
      float mare = 0.80 + 0.20*sin(x*6.1 + 1.7)*sin(y*5.3 - 0.9) + 0.08*sin(x*13.0)*sin(y*11.0);
      float edge = 1.0 - smoothstep(0.93, 1.0, rr);
      float earthshine = 0.030*sat(1.0 - dot(uMoonDir, uSunDir));
      col += uMoonDisc*(pow(lit, 0.55)*mare + earthshine)*edge*aboveSea;
    }
  }
  col += uMoonDisc*0.00035*hg(mm, 0.80)*aboveSea;

  // ---- cirrus. High enough that it stays in sunlight for minutes after the low cloud has gone
  // grey, which is the whole reason a subtropical sunset keeps burning after the sun is gone.
  if (uCi.y > 0.005){
    float dy = max(d.y, 0.0016);
    float t = shellT(uCi.w, dy);
    vec2 p = t*d.xz;
    vec2 uv = p*uCi.x + uCiDrift;
    float a = texture2D(uNoise, uv*vec2(0.42, 1.15)).g;
    float b = texture2D(uNoise, uv*vec2(1.7, 3.4) + vec2(0.37, 0.11)).r;
    float dn = max(0.0, a*0.68 + b*0.44 - (1.0 - uCi.y))*uCi.z;
    float alpha = (1.0 - exp(-dn*4.2))*sat(d.y*7.0);
    alpha *= exp(-t/(uCloudFar*2.4));
    float ph = 0.55 + 3.4*hg(mu, 0.72);
    vec3 c = uCiSun*ph*0.35 + uAmb*0.55;
    col = mix(col, c, sat(alpha));
  }

  // ---- storm tower. Placed on the upwind bearing, standing on a vertical slab so the anvil
  // reads at the right scale from 25 km away without marching a volume.
  if (uStorm.x > 0.005){
    float dn = dot(d.xz, uStormN);
    if (dn > 0.02){
      float t = uStorm.y/dn;
      float x = dot(d.xz, uStormS)*t;
      float y = d.y*t;
      float H = uStorm.z;
      float grow = smoothstep(uStorm.w, H*0.55, y);
      float w = uStorm2.x*(0.55 + 0.65*grow);
      float anv = smoothstep(H*0.60, H*0.80, y)*(1.0 - smoothstep(H*0.92, H*1.10, y));
      w = mix(w, max(w, uStorm2.y), anv);
      float n1 = texture2D(uNoise, vec2(x*0.000045 + uStorm2.z, y*0.000075)).b;
      float n2 = texture2D(uNoise, vec2(x*0.00019, y*0.00027) + vec2(0.41, 0.13)).r;
      float bulge = (n1 - 0.5)*0.62 + (n2 - 0.5)*0.30;
      float ww = w*(1.0 + bulge*0.85);
      float body = 1.0 - smoothstep(ww*0.52, ww, abs(x));
      float vert = smoothstep(uStorm.w*0.55, uStorm.w*1.7, y)*(1.0 - smoothstep(H*0.95, H*1.18, y));
      float dens = sat(body*vert)*uStorm.x;
      if (dens > 0.001){
        float side = sat(0.5 + 0.5*(x/max(ww, 1.0))*sign(dot(uSunDir.xz, uStormS)));
        float lightf = mix(0.10, 1.0, side)*mix(uStorm2.w, 1.0, smoothstep(uStorm.w, H*0.85, y));
        float rim = pow(sat(1.0 - abs(x)/max(ww, 1.0)), 3.0);
        vec3 c = uStormSun*lightf*0.16 + uAmb*(0.18 + 0.55*smoothstep(uStorm.w, H, y))
               + uStormSun*(1.0 - rim)*hg(mu, 0.55)*0.25
               + vec3(0.85, 0.90, 1.20)*uFlash*(1.0 - smoothstep(uStorm.w, H*0.7, y))*2.2;
        float alpha = sat(dens*1.8)*exp(-t/(uCloudFar*3.0));
        col = mix(col, c, alpha);
      }
    }
  }

  // ---- cumulus slab, three slices with one shadow tap each
  if (uCu.y > 0.005){
    float dy = max(d.y, 0.0014);
    float base = uCu.w, top = uCu2.x;
    float seg = (top - base)/3.0;
    vec2 sunStep = uSunDir.xz*(seg/max(abs(uSunDir.y), 0.14));
    sunStep = clamp(sunStep, vec2(-5000.0), vec2(5000.0));
    float trans = 1.0;
    vec3 acc = vec3(0.0);
    float depth = 0.0;
    float phase = 0.72*hg(mu, 0.74) + 0.28*hg(mu, -0.32);
    for (int i = 0; i < 3; i++){
      float hf = (float(i) + 0.5)/3.0;
      float t = shellT(base + (top - base)*hf, dy);
      vec2 p = t*d.xz;
      float dn = cuDens(p, hf);
      if (dn > 0.0005){
        float sh = cuShadow(p + sunStep*1.1, min(1.0, hf + 0.34))*1.2
                 + cuShadow(p + sunStep*2.6, min(1.0, hf + 0.8))*0.55;
        float light = exp(-sh*uCu2.y*0.55);
        float ext = exp(-dn*uCu2.y*seg*0.0016);
        float powder = 1.0 - exp(-dn*7.0);
        vec3 lit = uCuSun*light*phase*(0.30 + 0.70*powder)*1.5
                 + uAmb*(uCu2.w + (1.0 - uCu2.w)*hf);
        acc += lit*(1.0 - ext)*trans;
        trans *= ext;
        depth = max(depth, t);
      }
    }
    float alpha = (1.0 - trans)*sat(d.y*9.0 + 0.06);
    float airT = exp(-depth/uCloudFar);
    vec3 cloud = acc*airT + col*(1.0 - airT)*alpha;
    col = col*(1.0 - alpha) + cloud;
  }

  // ---- tone map. Matches the ACES + gamma + contrast chain the scene applies to every other
  // material, so the sky and the island sit in the same exposure.
  col *= uExposure;
  vec3 a = col*(col + 0.0245786) - 0.000090537;
  vec3 b = col*(0.983729*col + 0.4329510) + 0.238081;
  col = clamp(a/b, 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  vec3 hc = col*col*(3.0 - 2.0*col);
  col = mix(col, hc, uContrast - 1.0);
  col += (hash12(gl_FragCoord.xy + fract(uTime)) - 0.5)*(1.5/255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VS = `
precision highp float;
attribute vec3 position;
attribute vec3 aTint;
attribute vec2 aMag;
uniform mat4 worldViewProjection;
uniform mat3 uCel;
uniform float uPix;
uniform float uNight;
uniform float uStarGain;
uniform float uTime;
varying vec3 vCol;
void main(void){
  vec3 dir = uCel*position;
  if (dir.y < -0.02 || uNight < 0.004){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec3(0.0);
    return;
  }
  float ext = exp(-0.32/max(dir.y + 0.10, 0.10));
  float tw = 1.0 + (0.34 + 0.5*(1.0 - min(dir.y*3.0, 1.0)))*
             (sin(uTime*(3.1 + aMag.y*7.0) + aMag.y*40.0)*0.5 +
              sin(uTime*(5.7 + aMag.y*3.0) + aMag.y*17.0)*0.28);
  float f = aMag.x*ext*uNight*uStarGain*max(tw, 0.15);
  vCol = aTint*f;
  gl_PointSize = max(1.0, uPix*(1.35 + 2.5*pow(min(f, 12.0), 0.30)));
  vec4 p = worldViewProjection*vec4(dir, 1.0);
  gl_Position = vec4(p.xy, p.w*0.999998, p.w);
}
`;

const STAR_FS = `
precision highp float;
varying vec3 vCol;
void main(void){
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q);
  float core = exp(-r2*26.0);
  float halo = exp(-r2*7.0)*0.28;
  float spike = pow(max(0.0, 1.0 - abs(q.x)*13.0), 3.0)*exp(-r2*9.0)*0.22
              + pow(max(0.0, 1.0 - abs(q.y)*13.0), 3.0)*exp(-r2*9.0)*0.22;
  vec3 c = vCol*(core + halo + spike);
  gl_FragColor = vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------
export function registerSky(world) {
  // The read model. Published whether or not there is a renderer, so the sky is interrogable
  // headless and so TWIN.probe() shows values that actually move.
  const sky = world.publish('sky', {
    sunElevationDeg: 0, sunAzimuthDeg: 0, phase: 'night',
    moonElevationDeg: 0, moonAzimuthDeg: 0, moonIllum: 0, moonPhase: 'new', moonUp: false,
    turbidity: 2.0, cloudCover: 0, cloudLook: '', cloudBaseM: 0, cloudTopM: 0,
    sunThroughCloud: 1, exposure: 1, skyLuminance: 0, fogVisibilityKm: 30,
    starsVisible: false, milkyWay: false, zodiacalLight: false,
    southernCross: { altitudeDeg: 0, azimuthDeg: 0, up: false },
    poleAltitudeDeg: -LAT_DEG, siderealDeg: 0, source: 'internal'
  });

  const _v = [0, 0, 0];
  const _c = [0, 0, 0];

  function phaseName(e) {
    if (e > 12) return 'day';
    if (e > 6) return 'high sun';
    if (e > 0) return 'golden hour';
    if (e > -0.833) return 'sun on the horizon';
    if (e > -4) return 'burning horizon';
    if (e > -6) return 'civil twilight';
    if (e > -12) return 'blue hour';
    if (e > -18) return 'astronomical twilight';
    return 'night';
  }

  world.register({
    id: 'sky',
    phase: 'presentation',
    order: 5,
    init(w) { update(w); },
    tick(w) { update(w); },
    describe() {
      return {
        phase: sky.phase,
        sunEl: +sky.sunElevationDeg.toFixed(2),
        sunAz: +sky.sunAzimuthDeg.toFixed(1),
        moonEl: +sky.moonElevationDeg.toFixed(1),
        moonPhase: sky.moonPhase,
        moonIllum: +sky.moonIllum.toFixed(2),
        cloud: sky.cloudLook,
        cover: +sky.cloudCover.toFixed(2),
        sunThroughCloud: +sky.sunThroughCloud.toFixed(2),
        exposure: +sky.exposure.toFixed(1),
        skyLuminance: +sky.skyLuminance.toFixed(4),
        crux: sky.southernCross.up
          ? 'Acrux ' + sky.southernCross.altitudeDeg.toFixed(0) + ' deg up, bearing ' + sky.southernCross.azimuthDeg.toFixed(0)
          : 'Acrux below the horizon',
        milkyWay: sky.milkyWay
      };
    },
    save() { return null; },
    load() {}
  });

  function update(w) {
    const day = w.read('daylight');
    const wx = w.read('weather');
    const absDay = w.clock.epochDay + w.clock.dayIndex;
    const min = w.clock.minuteOfDay;

    let alt, az;
    if (day && Number.isFinite(day.altitude)) { alt = day.altitude; az = day.azimuth; sky.source = 'daylight'; }
    else { const s = solarPosition(w.clock.dayOfYear, min); alt = s.alt; az = s.az; sky.source = 'internal'; }
    sky.sunElevationDeg = alt / DEG;
    sky.sunAzimuthDeg = ((az / DEG) % 360 + 360) % 360;
    sky.phase = phaseName(sky.sunElevationDeg);

    const m = moonPosition(absDay, min);
    sky.moonElevationDeg = (day && Number.isFinite(day.moonAltitudeDeg)) ? day.moonAltitudeDeg : m.alt / DEG;
    sky.moonAzimuthDeg = ((m.az / DEG) % 360 + 360) % 360;
    sky.moonIllum = (day && Number.isFinite(day.moonIllum)) ? day.moonIllum : m.illum;
    sky.moonUp = sky.moonElevationDeg > 0;
    sky.moonPhase = MOON_NAMES[Math.round(((day && Number.isFinite(day.moonPhase)) ? day.moonPhase : m.phase) * 8) % 8];

    const prof = (wx && PROFILES[wx.synoptic]) || DEFAULT_PROFILE;
    const cloudDrive = wx ? clamp(wx.cloud * 1.25, 0, 1) : 0.3;
    sky.cloudCover = clamp(prof.cover * 0.55 + cloudDrive * 0.75, 0, 1);
    sky.cloudLook = prof.look;
    sky.cloudBaseM = prof.base;
    sky.cloudTopM = prof.top;
    sky.turbidity = prof.turb * (wx ? (0.85 + wx.humidity * 0.5) : 1);
    sky.fogVisibilityKm = wx ? wx.visibilityKm : 30;

    const lst = siderealDeg(absDay, min);
    sky.siderealDeg = +lst.toFixed(2);
    equatorialToHorizon(STARS[12 * 4], STARS[12 * 4 + 1], lst, _v); // Acrux
    sky.southernCross.altitudeDeg = Math.asin(clamp(_v[1], -1, 1)) / DEG;
    sky.southernCross.azimuthDeg = ((Math.atan2(_v[0], _v[2]) / DEG) % 360 + 360) % 360;
    sky.southernCross.up = sky.southernCross.altitudeDeg > 0;

    // What the sky is actually worth as light, from the same model the shader runs.
    const sx = Math.cos(alt) * Math.sin(az), sy = Math.sin(alt), sz = Math.cos(alt) * Math.cos(az);
    skyRadiance(0, 1, 0, sx, sy, sz, sky.turbidity, 40, _c);
    const zen = lumOf(_c);
    skyRadiance(sx * 0.94, 0.34, sz * 0.94, sx, sy, sz, sky.turbidity, 40, _c);
    const hor = lumOf(_c);
    let lum = (zen * 0.45 + hor * 0.55) * (1 - 0.42 * sky.cloudCover);
    if (sky.moonUp) lum += 0.0016 * sky.moonIllum * Math.sin(sky.moonElevationDeg * DEG);
    sky.skyLuminance = lum;
    sky.exposure = clamp(0.80 * Math.pow(lum + 0.0006, -0.6), 0.45, 90);
    sky.starsVisible = sky.sunElevationDeg < -6 && sky.cloudCover < 0.85;
    sky.milkyWay = sky.starsVisible && sky.moonIllum * Math.max(0, Math.sin(sky.moonElevationDeg * DEG)) < 0.25 && sky.cloudCover < 0.5;
    sky.zodiacalLight = sky.sunElevationDeg < -14 && sky.sunElevationDeg > -26 && sky.cloudCover < 0.4;
  }

  // -------------------------------------------------------------------------------------------
  // Render layer
  // -------------------------------------------------------------------------------------------
  if (!world.stage) return;

  const params = new URLSearchParams(location.search);
  const lowQ = params.get('skyq') === 'low';

  // Everything the renderer needs, kept in one object so nothing allocates per frame.
  const R = {
    ready: false, lut: null, noise: null, noiseData: null, dome: null, stars: null,
    domeMat: null, starMat: null, scene: null,
    t: 0, lastMinute: -1, driftE: 0, driftN: 0, ciDriftE: 0, ciDriftN: 0, stormDrift: 0,
    cel: new Float32Array(9), celInv: new Float32Array(9),
    sunDir: null, moonDir: null, sunCel: null,
    p: {
      cover: 0.3, base: 1000, top: 2100, dens: 1.1, cell: 9000, ci: 0.2, ciD: 0.5, ciH: 8000,
      storm: 0, front: 0, turb: 2.2, haze: 0.8, stormDist: 30000, stormBear: 300, frontPos: -60000
    },
    tmp: { sun: [0, 0, 0], cu: [0, 0, 0], ci: [0, 0, 0], st: [0, 0, 0], amb: [0, 0, 0], fog: [0, 0, 0] },
    flash: 0, flashT: 0, sunOcclusion: 1
  };

  world.stage.addLayer({
    id: 'sky',
    order: 5,

    init(stage) {
      try { build(stage); } catch (e) { console.error('[sky] init failed', e); this.frame = null; }
    },
    frame(stage, w, dt) { if (R.ready) tickRender(stage, w, dt); },
    dispose() {
      if (R.dome) R.dome.dispose();
      if (R.stars) R.stars.dispose();
      if (R.lut) R.lut.dispose();
      if (R.noise) R.noise.dispose();
      R.ready = false;
    }
  });

  function build(stage) {
    const scene = stage.scene;
    R.scene = scene;
    const rng = world.rng.stream('sky');

    // Noise field
    const NS = 256;
    R.noiseData = buildNoise(rng, NS);
    R.noise = new B.RawTexture(R.noiseData, NS, NS, B.Constants.TEXTUREFORMAT_RGBA, scene,
      true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
    R.noise.wrapU = R.noise.wrapV = B.Texture.WRAP_ADDRESSMODE;
    R.noise.anisotropicFilteringLevel = 4;

    // Scattering lookup
    B.Effect.ShadersStore['minjSkyLutPixelShader'] = LUT_FS;
    const size = lowQ ? { width: 160, height: 80 } : { width: 256, height: 128 };
    R.lut = new B.ProceduralTexture('minjSkyLut', size, 'minjSkyLut', scene, null, false, false,
      B.Constants.TEXTURETYPE_HALF_FLOAT);
    R.lut.wrapU = B.Texture.WRAP_ADDRESSMODE;
    R.lut.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    R.lut.refreshRate = 0;

    // Dome
    B.Effect.ShadersStore['minjSkyVertexShader'] = DOME_VS;
    B.Effect.ShadersStore['minjSkyFragmentShader'] = DOME_FS;
    R.domeMat = new B.ShaderMaterial('minjSky', scene, { vertex: 'minjSky', fragment: 'minjSky' }, {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uSunDir', 'uMoonDir', 'uSunDisc', 'uMoonDisc', 'uCuSun',
        'uCiSun', 'uStormSun', 'uAmb', 'uSunCel', 'uCu', 'uCu2', 'uCuDrift', 'uCi', 'uCiDrift',
        'uFront', 'uFrontN', 'uStorm', 'uStorm2', 'uStormN', 'uStormS', 'uEyeH', 'uNight',
        'uExposure', 'uContrast', 'uMw', 'uStarGain', 'uFlash', 'uCloudFar', 'uZodiac',
        'uSunSquash', 'uSunLift', 'uSeaFill', 'uTime', 'uCelInv'],
      samplers: ['uLut', 'uNoise']
    });
    R.domeMat.backFaceCulling = false;
    R.domeMat.disableDepthWrite = true;
    R.domeMat.setTexture('uLut', R.lut);
    R.domeMat.setTexture('uNoise', R.noise);
    R.dome = B.MeshBuilder.CreateSphere('minjSkyDome', { diameter: 2, segments: 20 }, scene);
    R.dome.material = R.domeMat;
    R.dome.infiniteDistance = true;
    R.dome.isPickable = false;
    R.dome.alwaysSelectAsActiveMesh = true;
    R.dome.doNotSyncBoundingInfo = true;

    // Stars
    B.Effect.ShadersStore['minjStarVertexShader'] = STAR_VS;
    B.Effect.ShadersStore['minjStarFragmentShader'] = STAR_FS;
    R.starMat = new B.ShaderMaterial('minjStars', scene, { vertex: 'minjStar', fragment: 'minjStar' }, {
      attributes: ['position', 'aTint', 'aMag'],
      uniforms: ['worldViewProjection', 'uCel', 'uPix', 'uNight', 'uStarGain', 'uTime'],
      needAlphaBlending: true
    });
    R.starMat.alphaMode = B.Constants.ALPHA_ADD;
    R.starMat.disableDepthWrite = true;
    R.starMat.backFaceCulling = false;
    R.starMat.fillMode = B.Material.PointFillMode;

    const n = STARS.length / 4;
    const pos = new Float32Array(n * 3), tint = new Float32Array(n * 3), mag = new Float32Array(n * 2);
    const idx = new Uint16Array(n);
    const tc = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const ra = STARS[i * 4] * 15 * DEG, dec = STARS[i * 4 + 1] * DEG;
      pos[i * 3] = Math.cos(dec) * Math.cos(ra);
      pos[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
      pos[i * 3 + 2] = Math.sin(dec);
      starTint(STARS[i * 4 + 3], tc);
      tint[i * 3] = tc[0]; tint[i * 3 + 1] = tc[1]; tint[i * 3 + 2] = tc[2];
      // Flux relative to a magnitude 1.6 star, compressed the way the dark adapted eye
      // compresses it, so Sirius is obviously the brightest without swamping the rest.
      mag[i * 2] = Math.pow(Math.pow(10, -0.4 * (STARS[i * 4 + 2] - 1.6)), 0.55);
      mag[i * 2 + 1] = rng.float();                                  // twinkle seed
      idx[i] = i;
    }
    R.stars = new B.Mesh('minjStars', scene);
    const vd = new B.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(R.stars);
    R.stars.setVerticesData('aTint', tint, false, 3);
    R.stars.setVerticesData('aMag', mag, false, 2);
    R.stars.material = R.starMat;
    R.stars.infiniteDistance = true;
    R.stars.isPickable = false;
    R.stars.alwaysSelectAsActiveMesh = true;
    R.stars.doNotSyncBoundingInfo = true;

    // Draw the dome after the rest of the opaque pass so early depth rejection pays for the
    // expensive pixels we never see. Stars are additive and land after that on their own.
    scene.setRenderingOrder(0, (a, b) => {
      const am = a.getMesh() === R.dome ? 1 : 0;
      const bm = b.getMesh() === R.dome ? 1 : 0;
      return am - bm;
    });

    // Preallocated so the frame path never allocates.
    R.sunDir = new B.Vector3(0, 1, 0);
    R.moonDir = new B.Vector3(0, 1, 0);
    R.sunCel = new B.Vector3(0, 1, 0);
    R.col = {};
    for (const k of ['sunDisc', 'moonDisc', 'cuSun', 'ciSun', 'stormSun', 'amb']) R.col[k] = new B.Color3(1, 1, 1);
    R.vec4 = {};
    for (const k of ['cu', 'cu2', 'ci', 'front', 'storm', 'storm2']) R.vec4[k] = new B.Vector4(0, 0, 0, 0);
    R.vec2 = {};
    for (const k of ['cuDrift', 'ciDrift', 'frontN', 'stormN', 'stormS']) R.vec2[k] = new B.Vector2(0, 0);
    R.ready = true;
  }

  // Bilinear read of the same noise the shader samples, so the sun can actually be dimmed by
  // the cloud that is drawn in front of it rather than by a guess.
  function noiseAt(u, v, ch) {
    const NS = 256;
    let x = (u % 1 + 1) % 1 * NS, y = (v % 1 + 1) % 1 * NS;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const x1 = (x0 + 1) % NS, y1 = (y0 + 1) % NS;
    const d = R.noiseData;
    const a = d[(y0 * NS + x0) * 4 + ch], b = d[(y0 * NS + x1) * 4 + ch];
    const c = d[(y1 * NS + x0) * 4 + ch], e = d[(y1 * NS + x1) * 4 + ch];
    return (lerp(lerp(a, b, fx), lerp(c, e, fx), fy)) / 255;
  }
  function cloudTowardSun(sx, sy, sz) {
    const p = R.p;
    if (p.cover <= 0.01 || sy < 0.02) return 1;
    const inv = 1 / p.cell;
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      const hf = (i + 0.5) / 3;
      const t = (p.base + (p.top - p.base) * hf) / sy;
      const pe = sx * t * inv, pn = sz * t * inv;
      const grp = noiseAt(pe * 0.34 + R.driftE * 0.34, pn * 0.34 + R.driftN * 0.34, 3);
      const bod = noiseAt(pe + R.driftE, pn + R.driftN, 0);
      const shape = smoothstep(0, 0.30, hf) * (1 - smoothstep(0.44, 1.08, hf));
      acc += Math.max(0, grp * 0.66 + bod * 0.34 - (1 - p.cover) - (1 - shape) * 0.40) * p.dens;
    }
    return clamp(Math.exp(-acc * 1.7), 0.05, 1);
  }

  function approach(cur, target, dt, tau, snap) {
    if (snap) return target;
    const k = 1 - Math.exp(-dt / tau);
    return cur + (target - cur) * k;
  }

  function tickRender(stage, w, dt) {
    const scene = stage.scene;
    const cam = scene.activeCamera || stage.camera;
    if (!cam) return;
    R.t += dt;

    // Sub tick time. One tick is ten sim minutes, which at 1x is two and a half degrees of solar
    // motion, so the sun has to be recomputed between ticks or sunrise arrives in steps.
    const frac = w.clock.paused ? 0 : clamp(w.clock.accumulator, 0, 1);
    const minute = w.clock.minuteOfDay + frac * 10;
    const absDay = w.clock.epochDay + w.clock.dayIndex;
    const snap = R.lastMinute < 0 || Math.abs(minute - R.lastMinute) > 30;
    R.lastMinute = minute;

    const s = solarPosition(w.clock.dayOfYear, minute);
    const m = moonPosition(absDay, minute);
    const sunY = Math.sin(s.alt), sunH = Math.cos(s.alt);
    R.sunDir.set(sunH * Math.sin(s.az), sunY, sunH * Math.cos(s.az));
    const moonH = Math.cos(m.alt);
    R.moonDir.set(moonH * Math.sin(m.az), Math.sin(m.alt), moonH * Math.cos(m.az));

    // Celestial frame
    const lst = siderealDeg(absDay, minute);
    celestialMatrix(lst, R.cel, R.celInv);
    R.sunCel.set(
      R.celInv[0] * R.sunDir.x + R.celInv[3] * R.sunDir.y + R.celInv[6] * R.sunDir.z,
      R.celInv[1] * R.sunDir.x + R.celInv[4] * R.sunDir.y + R.celInv[7] * R.sunDir.z,
      R.celInv[2] * R.sunDir.x + R.celInv[5] * R.sunDir.y + R.celInv[8] * R.sunDir.z
    );

    // Weather targets, smoothed. A change of synoptic state is a transition of every parameter.
    const wx = w.read('weather');
    const prof = (wx && PROFILES[wx.synoptic]) || DEFAULT_PROFILE;
    const cloudDrive = wx ? clamp(wx.cloud * 1.25, 0, 1) : 0.3;
    const tgtCover = clamp(prof.cover * 0.55 + cloudDrive * 0.75, 0, 1);
    const tau = 26;
    const p = R.p;
    p.cover = approach(p.cover, tgtCover, dt, tau, snap);
    p.base = approach(p.base, prof.base, dt, tau, snap);
    p.top = approach(p.top, prof.top, dt, tau, snap);
    p.dens = approach(p.dens, prof.dens, dt, tau, snap);
    p.cell = approach(p.cell, prof.cell, dt, tau, snap);
    p.ci = approach(p.ci, prof.ci, dt, tau, snap);
    p.ciD = approach(p.ciD, prof.ciD, dt, tau, snap);
    p.ciH = approach(p.ciH, prof.ciH, dt, tau, snap);
    p.storm = approach(p.storm, prof.storm, dt, tau * 1.5, snap);
    p.front = approach(p.front, prof.front, dt, tau, snap);
    p.turb = approach(p.turb, prof.turb * (wx ? (0.85 + wx.humidity * 0.5) : 1), dt, tau, snap);
    p.haze = approach(p.haze, prof.haze, dt, tau, snap);

    // Wind. windDirDeg is the direction the wind comes from, so cloud travels the other way.
    const windFrom = wx ? wx.windDirDeg : 60;
    const windKt = wx ? wx.windKt : 12;
    const toRad = (windFrom + 180) * DEG;
    const speed = windKt * 0.5144;
    // Drift is compressed against sim time on purpose: at 1x one real second is twenty sim
    // minutes, and honest advection at that rate is a smear rather than weather.
    const gain = w.clock.paused ? 0 : 3.0 * Math.pow(w.clock.speed.ticksPerSecond / 2, 0.55);
    const inv = 1 / p.cell;
    R.driftE += Math.sin(toRad) * speed * gain * dt * inv;
    R.driftN += Math.cos(toRad) * speed * gain * dt * inv;
    const ciInv = 1 / (p.cell * 3.2);
    R.ciDriftE += Math.sin(toRad) * speed * gain * 1.8 * dt * ciInv;
    R.ciDriftN += Math.cos(toRad) * speed * gain * 1.8 * dt * ciInv;
    R.stormDrift += dt * 0.004 * (w.clock.paused ? 0 : 1);

    // Storm cell: sits on the upwind bearing and closes on the island while the state holds.
    const hrs = wx ? wx.hoursInState : 0;
    p.stormBear = windFrom;
    p.stormDist = clamp(46000 - hrs * 3400, 11000, 60000);
    // Southerly change: a line that starts well to the south and crosses during the change.
    p.frontPos = -62000 + hrs * 12000;

    // ---- light and colour, from the same model the shader uses
    const t = R.tmp;
    sunlightAt(0, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, t.sun);
    sunlightAt(p.base + (p.top - p.base) * 0.55, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, t.cu);
    sunlightAt(p.ciH, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, t.ci);
    sunlightAt(6500, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, t.st);   // mid height of the tower

    const eyeH = clamp(cam.globalPosition ? cam.globalPosition.y : 40, 2, 800);
    skyRadiance(0, 1, 0, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, eyeH, t.amb);
    const zenLum = lumOf(t.amb);
    // Fog takes the colour of the horizon in the direction the camera is looking, which is why
    // looking west into a sunset gives warm haze and looking east gives cold.
    const fwd = cam.getForwardRay ? cam.getForwardRay().direction : null;
    let fx = fwd ? fwd.x : 0, fz = fwd ? fwd.z : 1;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    skyRadiance(fx * 0.985, 0.174, fz * 0.985, R.sunDir.x, R.sunDir.y, R.sunDir.z, p.turb, eyeH, t.fog);
    const horLum = lumOf(t.fog);

    let lum = (zenLum * 0.45 + horLum * 0.55) * (1 - 0.42 * p.cover);
    const moonLift = Math.max(0, R.moonDir.y) * m.illum;
    lum += 0.0016 * moonLift;
    // Partial adaptation: the exponent is below one on purpose, so night stays darker than day
    // instead of the whole thing flattening into a permanent grey noon.
    const exposure = clamp(0.80 * Math.pow(lum + 0.0006, -0.6), 0.45, 90);

    const night = smoothstep(-2.0, -9.0, s.alt / DEG);
    const moonPower = moonLift > 0.001 ? moonLift * 0.00075 : 0;
    R.sunOcclusion = cloudTowardSun(R.sunDir.x, Math.max(R.sunDir.y, 0.001), R.sunDir.z);

    // ---- lookup refresh. Only when the sky has actually moved.
    const key = Math.round(s.alt * 900) + Math.round(s.az * 240) * 4096 +
      Math.round(p.turb * 40) * 65536 + Math.round(moonPower * 4e6) * 131072;
    if (key !== R._lutKey) {
      R._lutKey = key;
      R.lut.setVector3('uSunDir', R.sunDir);
      R.lut.setVector3('uMoonDir', R.moonDir);
      R.lut.setFloat('uMoonPower', moonPower);
      R.lut.setFloat('uTurb', p.turb);
      R.lut.setFloat('uEyeH', eyeH);
      R.lut.setFloat('uAirglow', 0.00022);
      R.lut.resetRefreshCounter();
    }

    // ---- dome uniforms
    const dm = R.domeMat;
    const C = R.col, V4 = R.vec4, V2 = R.vec2;
    dm.setVector3('uSunDir', R.sunDir);
    dm.setVector3('uMoonDir', R.moonDir);
    dm.setVector3('uSunCel', R.sunCel);
    C.sunDisc.set(t.sun[0] * 2.6, t.sun[1] * 2.6, t.sun[2] * 2.6);
    dm.setColor3('uSunDisc', C.sunDisc);
    const moonVis = Math.max(0, smoothstep(-0.06, 0.03, R.moonDir.y)) * (0.25 + 0.75 * m.illum);
    const moonGain = 3.6 / exposure;
    C.moonDisc.set(1.02 * moonVis * moonGain, 1.00 * moonVis * moonGain, 0.94 * moonVis * moonGain);
    dm.setColor3('uMoonDisc', C.moonDisc);
    C.cuSun.set(t.cu[0], t.cu[1], t.cu[2]);
    dm.setColor3('uCuSun', C.cuSun);
    C.ciSun.set(t.ci[0], t.ci[1], t.ci[2]);
    dm.setColor3('uCiSun', C.ciSun);
    C.stormSun.set(t.st[0], t.st[1], t.st[2]);
    dm.setColor3('uStormSun', C.stormSun);
    C.amb.set(t.amb[0] * 1.5, t.amb[1] * 1.5, t.amb[2] * 1.5);
    dm.setColor3('uAmb', C.amb);

    V4.cu.set(1 / p.cell, p.cover, p.dens, p.base); dm.setVector4('uCu', V4.cu);
    V4.cu2.set(p.top, 5.4, 0.10, 0.35); dm.setVector4('uCu2', V4.cu2);
    V2.cuDrift.set(R.driftE, R.driftN); dm.setVector2('uCuDrift', V2.cuDrift);
    V4.ci.set(1 / (p.cell * 3.2), p.ci, p.ciD, p.ciH); dm.setVector4('uCi', V4.ci);
    V2.ciDrift.set(R.ciDriftE, R.ciDriftN); dm.setVector2('uCiDrift', V2.ciDrift);
    V4.front.set(p.front, p.frontPos, 0.10, 0.72); dm.setVector4('uFront', V4.front);
    V2.frontN.set(0, 1); dm.setVector2('uFrontN', V2.frontN);
    V4.storm.set(p.storm, p.stormDist, 13500, 900); dm.setVector4('uStorm', V4.storm);
    V4.storm2.set(4200, 15000, R.stormDrift, 0.05); dm.setVector4('uStorm2', V4.storm2);
    const sb = p.stormBear * DEG;
    V2.stormN.set(Math.sin(sb), Math.cos(sb)); dm.setVector2('uStormN', V2.stormN);
    V2.stormS.set(Math.cos(sb), -Math.sin(sb)); dm.setVector2('uStormS', V2.stormS);

    // Lightning: render side only, driven off accumulated render time so it never touches the
    // simulation, and only while there is a tower to light up.
    R.flashT -= dt;
    if (R.flashT <= 0) {
      R.flashT = 1.4 + ((Math.sin(R.t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 5.5;
      R.flash = p.storm > 0.15 ? 1 : 0;
    }
    R.flash *= Math.exp(-dt * 9);
    dm.setFloat('uFlash', R.flash * p.storm);

    dm.setFloat('uEyeH', eyeH);
    dm.setFloat('uNight', night);
    dm.setFloat('uExposure', exposure);
    dm.setFloat('uContrast', scene.imageProcessingConfiguration.contrast || 1.0);
    const nightGain = 1 / exposure;
    dm.setFloat('uMw', 0.150 * nightGain * clamp(1 - moonLift * 2.6, 0, 1) * clamp(1 - p.cover * 1.4, 0, 1));
    dm.setFloat('uStarGain', 0.34 * nightGain * clamp(1 - moonLift * 1.5, 0.2, 1) * clamp(1 - p.cover * 0.95, 0, 1));
    dm.setFloat('uCloudFar', 26000 + 90000 / (1 + p.haze * 2.2));
    dm.setFloat('uZodiac', 0.055 * nightGain * smoothstep(-13, -17, s.alt / DEG) * clamp(1 - p.cover * 2, 0, 1) * clamp(1 - moonLift * 3, 0, 1));
    // Bennett's refraction formula. About 34 arc minutes of lift at the horizon, which is very
    // nearly one solar diameter: the sun you watch clear the water off Point Lookout is already
    // geometrically below it.
    const elDeg = s.alt / DEG;
    const refrDeg = elDeg > -1.2 ? 0.0167 / Math.tan((elDeg + 7.31 / (elDeg + 4.4)) * DEG) : 0;
    dm.setFloat('uSunLift', clamp(refrDeg, 0, 0.62) * DEG);
    dm.setFloat('uSunSquash', 1 + 0.45 * smoothstep(3.0, -0.7, elDeg));
    dm.setFloat('uSeaFill', 1);
    dm.setFloat('uTime', R.t);
    dm.setMatrix3x3('uCelInv', R.celInv);

    // ---- stars
    R.starMat.setMatrix3x3('uCel', R.cel);
    R.starMat.setFloat('uPix', Math.max(1, stage.engine.getRenderHeight() / 900));
    R.starMat.setFloat('uNight', night);
    R.starMat.setFloat('uStarGain', 0.20 * clamp(exposure / 62, 0.4, 1.35) * clamp(1 - p.cover * 0.95, 0, 1));
    R.starMat.setFloat('uTime', R.t);

    // ---- scene lights, driven by the same physics
    const sun = stage.sun, hemi = stage.hemi;
    const sunLum = lumOf(t.sun) / SUN_I;
    const above = smoothstep(-0.9, 1.2, s.alt / DEG);
    if (sun) {
      const useMoon = above < 0.02 && R.moonDir.y > 0.02;
      if (useMoon) {
        sun.direction.set(-R.moonDir.x, -R.moonDir.y, -R.moonDir.z);
        sun.diffuse.set(0.55, 0.66, 0.92);
        sun.specular.set(0.5, 0.6, 0.9);
        sun.intensity = 0.30 * moonLift * exposure * 0.02;
      } else if (above > 0.001) {
        sun.direction.set(-R.sunDir.x, -R.sunDir.y, -R.sunDir.z);
        const mx = Math.max(1e-4, Math.max(t.sun[0], Math.max(t.sun[1], t.sun[2])));
        sun.diffuse.set(t.sun[0] / mx, t.sun[1] / mx, t.sun[2] / mx);
        sun.specular.copyFrom(sun.diffuse);
        sun.intensity = 5.0 * sunLum * exposure * above * R.sunOcclusion;
      } else {
        sun.intensity = 0;
      }
    }
    if (hemi) {
      const skyMix = 1 + 0.55 * p.cover;
      hemi.diffuse.set(
        clamp(t.amb[0] / (zenLum + 1e-5) * 0.55, 0, 2) * skyMix,
        clamp(t.amb[1] / (zenLum + 1e-5) * 0.55, 0, 2) * skyMix,
        clamp(t.amb[2] / (zenLum + 1e-5) * 0.55, 0, 2) * skyMix
      );
      hemi.groundColor.set(0.34 + 0.20 * sunLum, 0.30 + 0.16 * sunLum, 0.24 + 0.10 * sunLum);
      hemi.intensity = clamp((zenLum * 0.55 + horLum * 0.45) * exposure * 0.95 * (0.7 + 0.5 * p.cover), 0.02, 2.6);
    }
    scene.ambientColor.set(t.amb[0] * exposure * 0.12, t.amb[1] * exposure * 0.12, t.amb[2] * exposure * 0.12);

    // ---- aerial perspective. Twenty seven kilometres of island has to read as twenty seven.
    const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
    scene.fogMode = B.Scene.FOGMODE_EXP2;
    scene.fogDensity = clamp(2.05 / (visKm * 1000), 1.5e-5, 9e-4);
    const fogGain = exposure * 0.85;
    scene.fogColor.set(
      clamp(t.fog[0] * fogGain, 0, 1.6),
      clamp(t.fog[1] * fogGain, 0, 1.6),
      clamp(t.fog[2] * fogGain, 0, 1.6)
    );
    scene.clearColor.set(scene.fogColor.r, scene.fogColor.g, scene.fogColor.b, 1);

    R.exposureOut = exposure;
    sky.exposure = exposure;
    sky.sunThroughCloud = R.sunOcclusion;
  }
}
